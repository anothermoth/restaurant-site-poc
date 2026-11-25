import { createHash } from "node:crypto";
import { z } from "zod";
import { DIETARY_TAGS, type Menu } from "@restaurant-site-poc/menu-schema";
import { Command, SIGNATURES } from "./commands.ts";

/**
 * LLM fallback, used only when the deterministic parser misses.
 * Token thrift: a compact id=name catalog (not the menu), one-line command
 * signatures, JSON output, max_tokens kept low, and a cache keyed by the
 * normalized utterance + catalog hash so repeats cost nothing.
 */

export const LlmReply = z.union([
  z.object({ commands: z.array(Command).min(1).max(10) }),
  z.object({ clarify: z.object({ question: z.string().max(120), options: z.array(z.string().max(60)).max(4).default([]) }) }),
  z.object({ refuse: z.object({ reason: z.string().max(160) }) }),
]);
export type LlmReply = z.infer<typeof LlmReply>;

/** USD per 1M tokens. From xAI GET /v1/language-models on 2026-11-24 (prices there are in 1/10,000 USD per 1M). */
export const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "grok-4.20-0309-non-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4.3": { input: 1.25, cachedInput: 0.2, output: 2.5 },
};

export interface Usage {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
}

export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = (env.XAI_API_KEY ?? env.OPENAI_API_KEY)?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL ?? (env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1")).replace(/\/+$/, ""),
    model: env.LLM_MODEL ?? (env.XAI_API_KEY ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini"),
    maxTokens: Number(env.LLM_MAX_TOKENS ?? 220),
  };
}

export function catalog(menu: Menu): string {
  const items = menu.categories.flatMap((c) => c.items.map((i) => `${i.id}=${i.name}`)).join("|");
  const sections = menu.categories.map((c) => `${c.id}=${c.name}`).join("|");
  return `items: ${items}\nsections: ${sections}`;
}

export function systemPrompt(menu: Menu): string {
  return [
    "Turn a restaurant owner's edit request into JSON using ONLY these commands:",
    ...SIGNATURES,
    `tags: ${DIETARY_TAGS.join(",")}. Prices are integer cents. Times are 24h HH:MM.`,
    "Use ids from the catalog only. Text is plain (no HTML/CSS). Never invent prices or allergens the owner didn't say.",
    "Relative price changes use adjust_price. set_hero_text only when they ask to change the headline/tagline; banners, notes, photos, colors, layout etc. are not supported: refuse.",
    'Reply with exactly one of: {"commands":[{"cmd":...}]} | {"clarify":{"question":"...","options":["..."]}} if unclear or several items fit | {"refuse":{"reason":"..."}} if no command fits.',
    catalog(menu),
  ].join("\n");
}

export function cacheKey(utterance: string, menu: Menu, model: string): string {
  const norm = utterance.toLowerCase().replace(/[^a-z0-9$.: ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${model}\n${catalog(menu)}\n${norm}`).digest("hex").slice(0, 32);
}

export interface CacheStore {
  get(key: string): Promise<LlmReply | null>;
  set(key: string, value: LlmReply): Promise<void>;
}

export function memoryCache(): CacheStore {
  const m = new Map<string, LlmReply>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function costOf(model: string, input: number, cached: number, output: number): number {
  const p = PRICES[model] ?? PRICES["grok-4.20-0309-non-reasoning"]!;
  return ((input - cached) * p.input + cached * p.cachedInput + output * p.output) / 1_000_000;
}

export type FallbackResult =
  | { source: "llm"; reply: LlmReply; usage: Usage }
  | { source: "llm-cache"; reply: LlmReply; usage: null }
  | { source: "unavailable"; reason: string };

export async function llmFallback(
  utterance: string,
  menu: Menu,
  opts: { config: LlmConfig | null; cache: CacheStore; fetchImpl?: FetchLike; now?: () => number },
): Promise<FallbackResult> {
  if (!opts.config) return { source: "unavailable", reason: "I only understood the built-in phrases, and the AI fallback is off (no API key)." };
  const { config, cache } = opts;
  const key = cacheKey(utterance, menu, config.model);
  const hit = await cache.get(key);
  if (hit) return { source: "llm-cache", reply: hit, usage: null };

  const now = opts.now ?? Date.now;
  const started = now();
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: config.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(menu) },
        { role: "user", content: utterance.slice(0, 400) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed with HTTP ${res.status}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  const inputTokens = body.usage?.prompt_tokens ?? 0;
  const cachedInputTokens = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const outputTokens = body.usage?.completion_tokens ?? 0;
  const usage: Usage = {
    model: config.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costUsd: costOf(config.model, inputTokens, cachedInputTokens, outputTokens),
    latencyMs: now() - started,
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  let json: unknown;
  try {
    json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { source: "llm", reply: { refuse: { reason: "The AI reply wasn't valid JSON, so nothing was changed." } }, usage };
  }
  const parsed = LlmReply.safeParse(json);
  if (!parsed.success) {
    return { source: "llm", reply: { refuse: { reason: "The AI suggested something outside the allowed commands, so nothing was changed." } }, usage };
  }
  await cache.set(key, parsed.data);
  return { source: "llm", reply: parsed.data, usage };
}
