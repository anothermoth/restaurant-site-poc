/**
 * Measures the token cost of the command pipeline on a fixed corpus of owner
 * requests: how many the free parser handles, and what the LLM fallback costs
 * for the rest. Runs the corpus twice to show cache hits.
 *
 *   XAI_API_KEY=... npx tsx scripts/measure-commands.ts > docs/token-costs.json
 */
import { readFileSync } from "node:fs";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { compile, llmConfigFromEnv, llmFallback, memoryCache, parse, systemPrompt } from "@restaurant-site-poc/command-engine";

const menu = parseMenu(JSON.parse(readFileSync("data/sample-restaurant.menu.json", "utf8")));
const CORPUS = [
  "Change the price of the margarita to $16.50",
  "make the truffle pie $18.50",
  "86 the burrata",
  "tiramisu is sold out",
  "bring back the wings",
  "hide the desserts section",
  "rename garlic knots to Garlic Butter Knots",
  "set the description of the wings to smoky wood-fired wings with hot honey",
  "mark the black bean burger as vegan",
  "the chicken sandwich contains dairy",
  "we're closed on mondays and tuesdays",
  "set hours on friday and saturday to 11am to 11pm",
  "change the tagline to Fired up since 2019",
  "move the tiramisu to the top",
  "raise the wings by $1",
  // phrasings outside the grammar -> LLM fallback
  "knock a dollar off the smash burger",
  "we don't have any more brussels sprouts today",
  "let's lead with the salads section",
  "can you put pizzas before starters on the menu",
  "the market greens are gluten free and vegan",
  "add a banner about our holiday party",
];

const config = llmConfigFromEnv();
if (!config) throw new Error("Set XAI_API_KEY to measure");
const cache = memoryCache();

async function pass(label: string) {
  const rows = [];
  for (const u of CORPUS) {
    const p = parse(u, menu);
    if (p.kind !== "none") {
      rows.push({ utterance: u, source: "parser", outcome: p.kind, commands: p.kind === "commands" ? p.commands : undefined, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 });
      continue;
    }
    const r = await llmFallback(u, menu, { config, cache });
    if (r.source === "unavailable") throw new Error(r.reason);
    const reply = r.reply;
    let valid: boolean | string = "n/a";
    if ("commands" in reply) {
      try {
        valid = compile(menu, reply.commands).summary.join("; ");
      } catch (e) {
        valid = `rejected: ${(e as Error).message}`;
      }
    }
    rows.push({
      utterance: u,
      source: r.source,
      outcome: "commands" in reply ? "commands" : "clarify" in reply ? "clarify" : "refuse",
      reply,
      compiled: valid,
      inputTokens: r.usage?.inputTokens ?? 0,
      cachedInputTokens: r.usage?.cachedInputTokens ?? 0,
      outputTokens: r.usage?.outputTokens ?? 0,
      costUsd: r.usage?.costUsd ?? 0,
      latencyMs: r.usage?.latencyMs,
    });
  }
  const llm = rows.filter((r) => r.source === "llm");
  const sum = (k: "inputTokens" | "cachedInputTokens" | "outputTokens" | "costUsd") => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    label,
    requests: rows.length,
    parser: rows.filter((r) => r.source === "parser").length,
    llmCalls: llm.length,
    cacheHits: rows.filter((r) => r.source === "llm-cache").length,
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    costUsd: Number(sum("costUsd").toFixed(6)),
    avgCostPerLlmCall: llm.length ? Number((sum("costUsd") / llm.length).toFixed(6)) : 0,
    rows,
  };
}

const first = await pass("cold cache");
const second = await pass("warm cache (same corpus again)");
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      model: config.model,
      maxTokens: config.maxTokens,
      systemPromptChars: systemPrompt(menu).length,
      pricesUsdPer1M: { input: 1.25, cachedInput: 0.2, output: 2.5, source: "xAI GET /v1/language-models, 2026-11-24" },
      passes: [first, second],
    },
    null,
    2,
  ),
);
