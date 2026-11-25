import { describe, expect, it, vi } from "vitest";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { checkMenuWithLlm, llmConfigFromEnv, type FetchLike } from "../src/index.ts";
import { baseMenu } from "../../menu-schema/test/fixtures.ts";

function weakMenu() {
  const m = baseMenu();
  m.categories[0]!.items[0]!.description = "";
  return parseMenu(m);
}

const config = { apiKey: "test-key", baseUrl: "https://llm.example/v1", model: "test-model" };

function fakeFetch(content: string, ok = true): FetchLike & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content } }] }) }));
}

describe("llm config", () => {
  it("returns null without a key", () => {
    expect(llmConfigFromEnv({})).toBeNull();
    expect(llmConfigFromEnv({ OPENAI_API_KEY: "  " })).toBeNull();
  });
  it("reads base url and model with defaults", () => {
    expect(llmConfigFromEnv({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://api.x.ai/v1/" })).toEqual({
      apiKey: "k",
      baseUrl: "https://api.x.ai/v1",
      model: "gpt-4o-mini",
    });
  });
});

describe("llm pass", () => {
  it("is skipped cleanly with no key, and makes no request", async () => {
    const fetchImpl = fakeFetch("{}");
    const report = await checkMenuWithLlm(weakMenu(), { config: null, fetchImpl });
    expect(report.llm.ran).toBe(false);
    expect(report.llm.skippedReason).toMatch(/OPENAI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report.findings.some((f) => f.ruleId === "missing-description")).toBe(true);
  });

  it("turns validated suggestions into info findings and drops unknown item ids", async () => {
    const content = JSON.stringify({
      suggestions: [
        { itemId: "burger", rewrittenDescription: "A juicy beef patty with crisp lettuce and ripe tomato on a soft bun.", suggestedDietaryTags: ["contains-gluten", "contains-dairy"], rationale: "Description was empty." },
        { itemId: "made-up", rewrittenDescription: "Should be dropped entirely.", rationale: "x" },
      ],
    });
    const fetchImpl = fakeFetch(content);
    const report = await checkMenuWithLlm(weakMenu(), { config, fetchImpl });
    expect(report.llm).toMatchObject({ ran: true, model: "test-model", suggestionCount: 1 });
    const llm = report.findings.filter((f) => f.source === "llm");
    expect(llm).toHaveLength(1);
    expect(llm[0]!.fix).toBeUndefined();
    // already-present tag is not re-suggested
    expect(llm[0]!.suggestion).toContain("contains-dairy");
    expect(llm[0]!.suggestion).not.toContain("contains-gluten");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("burger");
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const content = "```json\n" + JSON.stringify({ suggestions: [] }) + "\n```";
    const report = await checkMenuWithLlm(weakMenu(), { config, fetchImpl: fakeFetch(content) });
    expect(report.llm.ran).toBe(true);
  });

  it("rejects output that fails the zod schema", async () => {
    const content = JSON.stringify({ suggestions: [{ itemId: "burger", rewrittenDescription: "short" }] });
    await expect(checkMenuWithLlm(weakMenu(), { config, fetchImpl: fakeFetch(content) })).rejects.toThrow(/schema validation/);
  });

  it("rejects non-JSON and HTTP errors", async () => {
    await expect(checkMenuWithLlm(weakMenu(), { config, fetchImpl: fakeFetch("not json") })).rejects.toThrow(/valid JSON/);
    await expect(checkMenuWithLlm(weakMenu(), { config, fetchImpl: fakeFetch("{}", false) })).rejects.toThrow(/HTTP 500/);
  });
});
