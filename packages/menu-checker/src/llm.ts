import { z } from "zod";
import { allItems, DietaryTag, type Menu } from "@restaurant-site-poc/menu-schema";
import type { Finding } from "./types.ts";

/** What the model must return. Validated with zod; anything else is rejected. */
export const LlmSuggestions = z.object({
  suggestions: z.array(
    z.object({
      itemId: z.string(),
      rewrittenDescription: z.string().min(10).max(280),
      suggestedDietaryTags: z.array(DietaryTag).default([]),
      rationale: z.string().max(300),
    }),
  ),
});
export type LlmSuggestions = z.infer<typeof LlmSuggestions>;

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  };
}

export type LlmResult =
  | { ran: true; model: string; findings: Finding[]; raw: LlmSuggestions }
  | { ran: false; skippedReason: string; findings: [] };

const SYSTEM = `You are a menu editor for independent restaurants.
Rewrite weak item descriptions so they are appetizing, specific and under 200 characters.
Rules:
- Only use ingredients or preparation already implied by the item name, description, or category. Never invent allergens, sourcing claims or prices.
- suggestedDietaryTags are hints for a human to confirm. Only include a tag if the text clearly supports it.
- Respond with JSON only, matching: {"suggestions":[{"itemId":string,"rewrittenDescription":string,"suggestedDietaryTags":string[],"rationale":string}]}
- Allowed dietary tags: ${DietaryTag.options.join(", ")}.`;

/** Items worth sending: weak descriptions or missing tags, flagged by the deterministic pass. */
export function pickCandidates(menu: Menu, ruleFindings: Finding[]) {
  const wanted = new Set(
    ruleFindings
      .filter((f) => f.ruleId === "missing-description" || f.ruleId === "missing-dietary-tags")
      .map((f) => f.target.itemId)
      .filter((id): id is string => Boolean(id)),
  );
  return allItems(menu)
    .filter(({ item }) => wanted.has(item.id))
    .map(({ item, category }) => ({
      itemId: item.id,
      name: item.name,
      category: category.name,
      description: item.description,
      dietaryTags: item.dietaryTags,
    }));
}

export async function runLlmPass(
  menu: Menu,
  ruleFindings: Finding[],
  opts: { config?: LlmConfig | null; fetchImpl?: FetchLike } = {},
): Promise<LlmResult> {
  const config = opts.config === undefined ? llmConfigFromEnv() : opts.config;
  if (!config) return { ran: false, skippedReason: "OPENAI_API_KEY not set; deterministic rules only.", findings: [] };
  const candidates = pickCandidates(menu, ruleFindings);
  if (candidates.length === 0) return { ran: false, skippedReason: "No items need copy help.", findings: [] };

  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({ restaurant: menu.restaurant.name, cuisine: menu.restaurant.cuisine, items: candidates }),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed with HTTP ${res.status}`);

  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM response had no message content");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("LLM did not return valid JSON");
  }
  const parsed = LlmSuggestions.safeParse(parsedJson);
  if (!parsed.success) throw new Error(`LLM JSON failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);

  const known = new Map(candidates.map((c) => [c.itemId, c]));
  const findings: Finding[] = parsed.data.suggestions
    .filter((s) => known.has(s.itemId)) // drop hallucinated ids
    .map((s) => {
      const c = known.get(s.itemId)!;
      const tags = s.suggestedDietaryTags.filter((t) => !c.dietaryTags.includes(t));
      return {
        ruleId: "llm-copy-suggestion",
        severity: "info",
        source: "llm",
        message: `AI suggestion for "${c.name}": ${s.rationale}`,
        target: { itemId: s.itemId },
        suggestion: `Description: "${s.rewrittenDescription}"${tags.length ? `. Tags to confirm: ${tags.join(", ")}` : ""}`,
      } satisfies Finding;
    });
  return { ran: true, model: config.model, findings, raw: parsed.data };
}
