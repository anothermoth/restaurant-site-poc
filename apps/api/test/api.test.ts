import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import request from "supertest";
import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import type { FetchLike } from "@restaurant-site-poc/command-engine";
import { createApp } from "../src/app.ts";
import { collections } from "../src/store.ts";
import { EditService } from "../src/service.ts";

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017";
const seed = parseMenu(JSON.parse(readFileSync(new URL("../../../data/sample-restaurant.menu.json", import.meta.url), "utf8")));
const slug = seed.restaurant.slug;

let client: MongoClient;
let db: Db;
let app: ReturnType<typeof createApp>;
let service: EditService;
let published: Menu[] = [];
const llmReply = { content: "{}" };
const fetchImpl = vi.fn<FetchLike>(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: llmReply.content } }], usage: { prompt_tokens: 700, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 512 } } }),
}));

beforeAll(async () => {
  client = await new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 3000 }).connect();
  db = client.db(`rsp_test_${process.pid}_${Date.now()}`);
});
afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});
beforeEach(async () => {
  await db.dropDatabase();
  fetchImpl.mockClear();
  published = [];
  service = new EditService({
    c: await collections(db),
    llm: { apiKey: "test", baseUrl: "https://llm.test/v1", model: "grok-4.20-0309-non-reasoning", maxTokens: 220 },
    fetchImpl,
    onPublish: async (_s, menu) => {
      published.push(menu);
      return { file: "memory" };
    },
  });
  await service.seed(slug, seed);
  app = createApp(service, { seedMenu: seed });
});

const say = (utterance: string) => request(app).post(`/api/sites/${slug}/commands`).send({ utterance });
const price = (m: Menu, id: string) => m.categories.flatMap((c) => c.items).find((i) => i.id === id)!.price;

describe("edit flow", () => {
  it("proposes from the parser (no model call), previews, approves, publishes", async () => {
    const p = await say("change the price of the margarita to $16.50").expect(200);
    expect(p.body.type).toBe("change");
    expect(p.body.change).toMatchObject({ source: "parser", risk: "high", status: "pending", credits: 0, summary: ["Margherita: price $15.00 → $16.50"] });
    expect(p.body.change.highlight).toContain("item:margherita.price");
    expect(fetchImpl).not.toHaveBeenCalled();

    const s1 = await request(app).get(`/api/sites/${slug}`).expect(200);
    expect(price(s1.body.preview, "margherita")).toBe(1650);
    expect(price(s1.body.draft, "margherita")).toBe(1500); // not applied until approved

    await request(app).post(`/api/sites/${slug}/changes/${p.body.change.id}/approve`).expect(200);
    const s2 = await request(app).get(`/api/sites/${slug}`).expect(200);
    expect(price(s2.body.draft, "margherita")).toBe(1650);
    expect(s2.body.unpublished).toBe(true);
    expect((await request(app).get(`/api/sites/${slug}/published.json`)).body.categories[1].items[0].price).toBe(1500);

    const pub = await request(app).post(`/api/sites/${slug}/publish`).expect(200);
    expect(pub.body.publishedVersion).toBe(2);
    expect(price(published[0]!, "margherita")).toBe(1650);
    expect((await request(app).get(`/api/sites/${slug}/published.json`)).body.categories[1].items[0].price).toBe(1650);
  });

  it("rejects leave the draft untouched, and a new proposal supersedes the pending one", async () => {
    const a = await say("hide the wings").expect(200);
    const b = await say("hide the tiramisu").expect(200);
    const s = await request(app).get(`/api/sites/${slug}`);
    expect(s.body.pending.id).toBe(b.body.change.id);
    expect(s.body.history[0]).toMatchObject({ id: a.body.change.id, status: "superseded" });
    await request(app).post(`/api/sites/${slug}/changes/${b.body.change.id}/reject`).expect(200);
    await request(app).post(`/api/sites/${slug}/changes/${b.body.change.id}/approve`).expect(409);
    expect((await request(app).get(`/api/sites/${slug}`)).body.draftVersion).toBe(1);
  });

  it("supports voice meta commands: approve, undo, publish", async () => {
    await say("86 the burrata").expect(200);
    expect((await say("looks good")).body).toMatchObject({ type: "meta", action: "approve" });
    expect((await say("undo")).body).toMatchObject({ type: "meta", action: "undo", message: expect.stringContaining("Burrata") });
    const s = await request(app).get(`/api/sites/${slug}`);
    expect(s.body.draftVersion).toBe(3);
    expect(s.body.history[0].status).toBe("undone");
    expect((await say("publish")).body).toMatchObject({ type: "meta", action: "publish" });
  });

  it("refuses an undo that would clobber a later edit to the same field", async () => {
    const first = await say("make the wings $15").expect(200);
    await request(app).post(`/api/sites/${slug}/changes/${first.body.change.id}/approve`).expect(200);
    const second = await say("make the wings $16").expect(200);
    await request(app).post(`/api/sites/${slug}/changes/${second.body.change.id}/approve`).expect(200);
    const r = await request(app).post(`/api/sites/${slug}/undo`).send({ changeId: first.body.change.id }).expect(409);
    expect(r.body.error).toMatch(/later edit/);
  });

  it("refuses a stale approval (optimistic concurrency on the draft version)", async () => {
    const a = await say("hide the wings").expect(200);
    // simulate another writer bumping the draft
    await db.collection("sites").updateOne({ _id: slug as never }, { $inc: { draftVersion: 1 } });
    await request(app).post(`/api/sites/${slug}/changes/${a.body.change.id}/approve`).expect(409);
  });

  it("auto-approves low-risk edits when enabled, but never prices or allergens", async () => {
    await request(app).patch(`/api/sites/${slug}/settings`).send({ autoApproveLowRisk: true }).expect(200);
    expect((await say("hide the wings")).body.autoApproved).toBe(true);
    const risky = await say("mark the wings as spicy");
    expect(risky.body.autoApproved).toBe(false);
    expect(risky.body.change.status).toBe("pending");
  });

  it("falls back to the LLM only on a parser miss, logs tokens and cost, and caches", async () => {
    llmReply.content = JSON.stringify({ commands: [{ cmd: "set_price", itemId: "smash-burger", price: 1400 }] });
    const r = await say("knock a buck off the smash burger").expect(200);
    expect(r.body.change).toMatchObject({ source: "llm", risk: "high", credits: 1 });
    expect(r.body.change.usage).toBeUndefined(); // tokens and $ stay server-side
    expect(await db.collection("llm_calls").findOne({})).toMatchObject({ credits: 1, account: slug, usage: { inputTokens: 700, cachedInputTokens: 512, outputTokens: 30 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await request(app).post(`/api/sites/${slug}/changes/${r.body.change.id}/reject`);

    const again = await say("Knock a buck off the smash burger!").expect(200);
    expect(again.body.change.source).toBe("llm-cache");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    expect(again.body.change.credits).toBe(0);
    const s = (await request(app).get(`/api/sites/${slug}`)).body;
    expect(s.activity).toEqual({ parser: 0, ai: 1, aiCache: 1 });
    expect(s.credits).toEqual({ balance: 99, perAiCall: 1 });
    const m = await service.margin();
    expect(m.total).toMatchObject({ calls: 1, creditsCharged: 1, inputTokens: 700, outputTokens: 30, cacheHits: 1 });
    expect(m.total.costUsd).toBeCloseTo((188 * 1.25 + 512 * 0.2 + 30 * 2.5) / 1e6, 6);
  });

  it("never applies LLM output that fails validation", async () => {
    llmReply.content = JSON.stringify({ commands: [{ cmd: "set_price", itemId: "not-on-menu", price: 100 }] });
    const r = await say("make the lobster cheaper").expect(200);
    expect(r.body).toMatchObject({ type: "refuse" });
    llmReply.content = JSON.stringify({ commands: [{ cmd: "inject_html", html: "<b>hi</b>" }] });
    expect((await say("add a bold banner")).body.type).toBe("refuse");
    expect((await request(app).get(`/api/sites/${slug}`)).body.pending).toBeNull();
  });

  it("returns clarify with options that resolve by id", async () => {
    const r = await say("hide the caesar salad").expect(200);
    expect(r.body.type).toBe("clarify");
    // caesar-2 is the sample menu's planted duplicate; it ships hidden, so pick the visible one.
    const pick = r.body.options.find((o: { utterance: string }) => o.utterance.endsWith(" caesar"));
    expect((await say(pick.utterance)).body.change.commands).toEqual([{ cmd: "hide_item", itemId: "caesar" }]);
  });

  it("blocks publish while a change is pending, and validates input", async () => {
    await say("hide the wings");
    await request(app).post(`/api/sites/${slug}/publish`).expect(409);
    await say("").expect(400);
    await request(app).get(`/api/sites/nope`).expect(404);
    await request(app).post(`/api/sites/${slug}/changes/zzz/approve`).expect(400);
  });

  it("resets the demo site", async () => {
    const a = await say("hide the wings");
    await request(app).post(`/api/sites/${slug}/changes/${a.body.change.id}/approve`);
    await request(app).post(`/api/sites/${slug}/reset`).expect(200);
    const s = await request(app).get(`/api/sites/${slug}`);
    expect(s.body.draftVersion).toBe(1);
    expect(s.body.history).toEqual([]);
  });
});

describe("click-to-target", () => {
  const sayAbout = (utterance: string, target: unknown) => request(app).post(`/api/sites/${slug}/commands`).send({ utterance, target });

  it("resolves 'this' to the selected item in the parser, with no model call", async () => {
    const p = await sayAbout("make this $14", { kind: "item", id: "margherita" }).expect(200);
    expect(p.body.type).toBe("change");
    expect(p.body.change).toMatchObject({ source: "parser", credits: 0, summary: ["Margherita: price $15.00 → $14.00"] });
    expect(p.body.change.highlight).toContain("item:margherita.price");
    const bare = await sayAbout("86", { kind: "item", id: "burrata" }).expect(200);
    expect(bare.body.change.summary[0]).toMatch(/Burrata/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a malformed target", async () => {
    await sayAbout("make this $14", { kind: "page", id: "x" }).expect(400);
  });

  it("passes the selection to the AI helper as context when the parser can't handle it", async () => {
    llmReply.content = JSON.stringify({ commands: [{ cmd: "set_price", itemId: "wings", price: 1500 }] });
    const p = await sayAbout("bump this up to fifteen-ish", { kind: "item", id: "wings" }).expect(200);
    expect(p.body.change.source).toBe("llm");
    const sent = JSON.parse(String((fetchImpl.mock.calls[0]![1] as { body: string }).body)) as { messages: { role: string; content: string }[] };
    expect(sent.messages.at(-1)!.content).toContain('[Selected item: "Wood-Fired Wings" (id wings)]');
  });
});
