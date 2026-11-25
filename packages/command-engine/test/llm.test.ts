import { describe, expect, it, vi } from "vitest";
import { cacheKey, catalog, costOf, llmConfigFromEnv, llmFallback, memoryCache, systemPrompt, type FetchLike } from "../src/index.ts";
import { sample } from "./helpers.ts";

const menu = sample();
const config = { apiKey: "k", baseUrl: "https://llm.test/v1", model: "grok-4.20-0309-non-reasoning", maxTokens: 220 };

function fake(content: string, usage = { prompt_tokens: 600, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 0 } }) {
  return vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage }) }));
}

describe("prompt is compact", () => {
  it("sends an id=name catalog, not the menu", () => {
    const p = systemPrompt(menu);
    expect(catalog(menu)).toContain("margherita=Margherita");
    expect(p).not.toContain("San Marzano"); // no descriptions
    expect(p).not.toContain("priceDelta");
    expect(p.length).toBeLessThan(2000);
  });
});

describe("llmFallback", () => {
  it("is unavailable without a key and makes no request", async () => {
    const f = fake("{}");
    const r = await llmFallback("x", menu, { config: null, cache: memoryCache(), fetchImpl: f });
    expect(r.source).toBe("unavailable");
    expect(f).not.toHaveBeenCalled();
  });

  it("validates commands, records usage and cost, and caches by normalized utterance", async () => {
    const f = fake(JSON.stringify({ commands: [{ cmd: "set_price", itemId: "smash-burger", price: 1400 }] }));
    const cache = memoryCache();
    const r = await llmFallback("Make the smash burger a dollar cheaper", menu, { config, cache, fetchImpl: f });
    expect(r.source).toBe("llm");
    if (r.source !== "llm") return;
    expect(r.usage.inputTokens).toBe(600);
    expect(r.usage.costUsd).toBeCloseTo((600 * 1.25 + 40 * 2.5) / 1e6, 10);
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.max_tokens).toBe(220);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });

    const again = await llmFallback("make the smash burger a dollar cheaper!", menu, { config, cache, fetchImpl: f });
    expect(again.source).toBe("llm-cache");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("turns off-vocabulary or malformed output into a refusal (and doesn't cache it)", async () => {
    const cache = memoryCache();
    const bad = await llmFallback("paint it red", menu, { config, cache, fetchImpl: fake(JSON.stringify({ commands: [{ cmd: "set_css", css: "body{}" }] })) });
    expect(bad.source === "llm" && "refuse" in bad.reply).toBe(true);
    const junk = await llmFallback("paint it red", menu, { config, cache, fetchImpl: fake("<html>") });
    expect(junk.source === "llm" && "refuse" in junk.reply).toBe(true);
    expect(await cache.get(cacheKey("paint it red", menu, config.model))).toBeNull();
  });

  it("passes clarify and refuse through", async () => {
    const r = await llmFallback("change the burger", menu, { config, cache: memoryCache(), fetchImpl: fake(JSON.stringify({ clarify: { question: "Which burger?", options: ["Double Smash Burger", "Black Bean Burger"] } })) });
    expect(r.source === "llm" && "clarify" in r.reply).toBe(true);
  });

  it("prices cached input tokens at the cached rate", () => {
    expect(costOf("grok-4.20-0309-non-reasoning", 1000, 800, 0)).toBeCloseTo((200 * 1.25 + 800 * 0.2) / 1e6, 12);
  });

  it("reads xAI config from env with low max_tokens by default", () => {
    expect(llmConfigFromEnv({})).toBeNull();
    expect(llmConfigFromEnv({ XAI_API_KEY: "x" })).toMatchObject({ baseUrl: "https://api.x.ai/v1", model: "grok-4.20-0309-non-reasoning", maxTokens: 220 });
  });
});
