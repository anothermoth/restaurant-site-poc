import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import request from "supertest";
import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import type { FetchLike } from "@restaurant-site-poc/command-engine";
import { createApp } from "../src/app.ts";
import { collections } from "../src/store.ts";
import { EditService, seedVersion } from "../src/service.ts";
import { configFromEnv, type RuntimeConfig } from "../src/config.ts";

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017";
const seed = parseMenu(JSON.parse(readFileSync(new URL("../../../data/sample-restaurant.menu.json", import.meta.url), "utf8")));
const slug = seed.restaurant.slug;

let client: MongoClient;
let db: Db;
let published: Menu[];
let clock: Date;
let reply = "{}";
let failNext = false;
const fetchImpl = vi.fn<FetchLike>(async () => {
  if (failNext) {
    failNext = false;
    return { ok: false, status: 503, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 710, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 128 } } }) };
});
// Each distinct utterance misses the cache, so each one is a real (mocked) model call.
let n = 0;
const offGrammar = () => `make the smash burger a bit cheaper please ${++n}`;

async function setup(env: Record<string, string>) {
  await db.dropDatabase();
  const config: RuntimeConfig = configFromEnv(env);
  const service = new EditService({
    c: await collections(db),
    llm: { apiKey: "test", baseUrl: "https://llm.test/v1", model: "grok-4.20-0309-non-reasoning", maxTokens: 220 },
    fetchImpl,
    limits: config.limits,
    now: () => clock,
    onPublish: config.demo ? undefined : async (_s, menu) => (published.push(menu), { file: "memory" }),
  });
  await service.seed(slug, seed);
  return { service, config, app: createApp(service, { seedMenu: seed, config }) };
}

beforeAll(async () => {
  client = await new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 3000 }).connect();
  db = client.db(`rsp_test_credits_${process.pid}_${Date.now()}`);
});
afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});
beforeEach(() => {
  fetchImpl.mockClear();
  published = [];
  clock = new Date("2026-11-24T18:00:00Z");
  reply = JSON.stringify({ commands: [{ cmd: "adjust_price", itemId: "smash-burger", deltaCents: -100 }] });
});

describe("credits", () => {
  it("starts at the configured balance; parser and cache hits are free, a model call costs 1", async () => {
    const { app } = await setup({ CREDITS_DEFAULT: "5" });
    const get = async () => (await request(app).get(`/api/sites/${slug}`)).body.credits.balance;
    expect(await get()).toBe(5);
    await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" }).expect(200);
    expect(await get()).toBe(5);
    const u = "knock a buck off the smash burger";
    expect((await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: u })).body.change).toMatchObject({ source: "llm", credits: 1 });
    expect(await get()).toBe(4);
    expect((await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: u })).body.change).toMatchObject({ source: "llm-cache", credits: 0 });
    expect(await get()).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("at 0 credits pauses the AI fallback (no model call) but parser commands still work", async () => {
    const { app } = await setup({ CREDITS_DEFAULT: "1" });
    await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }).expect(200);
    const r = await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }).expect(200);
    expect(r.body).toMatchObject({ type: "refuse", blocked: "credits", credits: 0 });
    expect(r.body.message).toMatch(/out of AI credits.*Built-in phrases still work/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const p = await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: "86 the burrata" }).expect(200);
    expect(p.body.change).toMatchObject({ source: "parser", status: "pending" });
    expect((await request(app).get(`/api/sites/${slug}`)).body.credits.balance).toBe(0);
  });

  it("refunds the credit when the model call fails, and reset can't refill credits", async () => {
    const { app } = await setup({ CREDITS_DEFAULT: "3" });
    failNext = true;
    await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }).expect(500);
    expect((await request(app).get(`/api/sites/${slug}`)).body.credits.balance).toBe(3);
    await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }).expect(200);
    await request(app).post(`/api/sites/${slug}/reset`).expect(200);
    expect((await request(app).get(`/api/sites/${slug}`)).body.credits.balance).toBe(2);
  });

  it("reports real cost vs. credit revenue (margin), behind the admin token", async () => {
    const { app } = await setup({ ADMIN_TOKEN: "secret-test-token", CREDIT_PRICE_USD: "0.01" });
    await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() });
    await request(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() });
    await request(app).get(`/api/admin/margin`).expect(401);
    const m = (await request(app).get(`/api/admin/margin?days=1`).set("x-admin-token", "secret-test-token").expect(200)).body;
    const perCall = (582 * 1.25 + 128 * 0.2 + 20 * 2.5) / 1e6;
    expect(m.total).toMatchObject({ calls: 2, creditsCharged: 2, inputTokens: 1420, cachedInputTokens: 256, outputTokens: 40, revenueUsd: 0.02 });
    expect(m.total.costUsd).toBeCloseTo(2 * perCall, 6);
    expect(m.total.marginUsd).toBeCloseTo(0.02 - 2 * perCall, 6);
    expect(m.rows[0]).toMatchObject({ day: "2026-11-24", account: slug, calls: 2 });
    expect(m.today).toMatchObject({ day: "2026-11-24", calls: 2 });
    await request(app).put(`/api/admin/sites/${slug}/credits`).set("x-admin-token", "secret-test-token").send({ credits: 250 }).expect(200);
    expect((await request(app).get(`/api/sites/${slug}`)).body.credits.balance).toBe(250);
  });
});

describe("demo mode", () => {
  const demoEnv = { DEMO_MODE: "1", CREDITS_DEFAULT: "10", SANDBOX_IDLE_MINUTES: "60" };

  it("gives each visitor (cookie) a private sandbox that expires after an hour idle", async () => {
    const { app } = await setup(demoEnv);
    const a = request.agent(app);
    const b = request.agent(app);
    const pa = await a.post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" }).expect(200);
    expect(pa.headers["set-cookie"]?.[0]).toMatch(/^rsp_sid=[\w-]+; Path=\/; HttpOnly; SameSite=Lax/);
    await a.post(`/api/sites/${slug}/changes/${pa.body.change.id}/approve`).expect(200);

    // B can't see or approve A's change, and B's menu is untouched.
    await b.post(`/api/sites/${slug}/changes/${pa.body.change.id}/reject`).expect(404);
    const sb = (await b.get(`/api/sites/${slug}`)).body;
    expect(sb.draftVersion).toBe(1);
    expect(sb.slug).toBe(slug);
    expect((await a.get(`/api/sites/${slug}`)).body.draftVersion).toBe(2);

    // The real site is never edited, and each sandbox carries a TTL expiry.
    const sites = await db.collection("sites").find().toArray();
    expect(sites.find((s) => String(s._id) === slug)!.draftVersion).toBe(1);
    const boxes = sites.filter((s) => s.sandboxOf === slug);
    expect(boxes).toHaveLength(2);
    for (const s of boxes) expect(s.expiresAt.getTime() - clock.getTime()).toBe(60 * 60_000);
    const idx = await db.collection("sites").indexes();
    expect(idx.find((i) => i.key.expiresAt)).toMatchObject({ expireAfterSeconds: 0 });

    // Activity pushes the expiry back.
    clock = new Date(clock.getTime() + 30 * 60_000);
    await a.get(`/api/sites/${slug}`);
    const boxA = (await db.collection("sites").find({ sandboxOf: slug, draftVersion: 2 }).toArray())[0]!;
    expect(boxA.expiresAt.getTime() - clock.getTime()).toBe(60 * 60_000);
  });

  it("starts a fresh sandbox after the old one expired", async () => {
    const { app } = await setup(demoEnv);
    const a = request.agent(app);
    const p = await a.post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" });
    await a.post(`/api/sites/${slug}/changes/${p.body.change.id}/approve`).expect(200);
    await db.collection("sites").deleteMany({ sandboxOf: slug }); // what the TTL monitor does
    const s = (await a.get(`/api/sites/${slug}`)).body;
    expect(s).toMatchObject({ draftVersion: 1, history: [], credits: { balance: 10 } });
  });

  it("replaces a sandbox copied from an older seed menu (stale photo paths), keeping its credits", async () => {
    const { app } = await setup(demoEnv);
    const a = request.agent(app);
    const p = await a.post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" });
    await a.post(`/api/sites/${slug}/changes/${p.body.change.id}/approve`).expect(200);
    // Edits survive while the seed hasn't changed.
    expect((await a.get(`/api/sites/${slug}`)).body.draftVersion).toBe(2);

    // Simulate a sandbox created before a deploy that changed the seed: old SVG placeholder paths, no/old seedVersion.
    const sites = db.collection("sites");
    const old = (m: Menu): Menu => ({ ...m, restaurant: { ...m.restaurant, heroPhoto: { ...m.restaurant.heroPhoto!, src: "/img/hero.svg" } } });
    const box = (await sites.findOne({ sandboxOf: slug }))!;
    await sites.updateOne({ _id: box._id }, { $set: { draft: old(box.draft), published: old(box.published), credits: 7 }, $unset: { seedVersion: "" } });

    const s = (await a.get(`/api/sites/${slug}`)).body;
    expect(s).toMatchObject({ draftVersion: 1, history: [], credits: { balance: 7 } });
    expect(s.draft.restaurant.heroPhoto.src).toBe(seed.restaurant.heroPhoto!.src);
    expect((await a.get(`/api/sites/${slug}/published.json`)).body.restaurant.heroPhoto.src).toBe(seed.restaurant.heroPhoto!.src);
    expect(await sites.countDocuments({ sandboxOf: slug })).toBe(1);
  });

  it("reseeds the demo base site from a new seed, but never overwrites a real site", async () => {
    const { service } = await setup(demoEnv);
    const sites = db.collection("sites");
    await sites.updateOne({ _id: slug as never }, { $set: { "draft.restaurant.heroPhoto.src": "/img/hero.svg", seedVersion: "old" } });
    await service.seed(slug, seed);
    expect((await sites.findOne({ _id: slug as never }))!.draft.restaurant.heroPhoto.src).toBe("/img/hero.svg");
    await service.seed(slug, seed, { upgrade: true });
    const base = (await sites.findOne({ _id: slug as never }))!;
    expect(base.draft.restaurant.heroPhoto.src).toBe(seed.restaurant.heroPhoto!.src);
    expect(base.seedVersion).toBe(seedVersion(seed));
  });

  it("publishes to a per-sandbox preview, never the public site", async () => {
    const { app } = await setup(demoEnv);
    const a = request.agent(app);
    const p = await a.post(`/api/sites/${slug}/commands`).send({ utterance: "change the price of the margarita to $16.50" });
    await a.post(`/api/sites/${slug}/changes/${p.body.change.id}/approve`).expect(200);
    const pub = await a.post(`/api/sites/${slug}/publish`).expect(200);
    expect(pub.body).toMatchObject({ publishedVersion: 2, previewPath: "/published" });
    expect(published).toHaveLength(0);
    expect((await a.get(`/api/sites/${slug}/published.json`)).body.categories[1].items[0].price).toBe(1650);
    expect((await request(app).get(`/api/sites/${slug}/published.json`)).body.categories[1].items[0].price).toBe(1500);
    const real = await db.collection("sites").findOne({ _id: slug as never });
    expect(real!.published.categories[1].items[0].price).toBe(1500);
  });

  it("rate-limits model calls per session", async () => {
    const { app } = await setup({ ...demoEnv, LLM_RATE_PER_SESSION_HOUR: "2", LLM_RATE_PER_IP_HOUR: "100" });
    const a = request.agent(app);
    for (let i = 0; i < 2; i++) expect((await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() })).body.type).toBe("change");
    const r = await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() });
    expect(r.body).toMatchObject({ type: "refuse", blocked: "rate" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // A different visitor is not affected; the limit resets next hour.
    expect((await request.agent(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() })).body.type).toBe("change");
    clock = new Date(clock.getTime() + 3_600_000);
    expect((await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() })).body.type).toBe("change");
  });

  it("rate-limits model calls per IP across sessions", async () => {
    const { app } = await setup({ ...demoEnv, LLM_RATE_PER_SESSION_HOUR: "100", LLM_RATE_PER_IP_HOUR: "2" });
    for (let i = 0; i < 2; i++) await request.agent(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() });
    expect((await request.agent(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() })).body.blocked).toBe("rate");
  });

  it("stops all model calls once the global daily spend cap is hit, until the next UTC day", async () => {
    const { app } = await setup({ ...demoEnv, LLM_DAILY_CAP_USD: "0.001" });
    const a = request.agent(app);
    await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }); // ~$0.0008
    await request.agent(app).post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }); // ~$0.0016 total
    const r = await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() });
    expect(r.body).toMatchObject({ type: "refuse", blocked: "cap" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await a.post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" })).body.type).toBe("change");
    clock = new Date("2026-11-25T00:00:01Z");
    expect((await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() })).body.type).toBe("change");
  });

  it("closes admin routes without a token and hides other restaurants", async () => {
    const { app } = await setup(demoEnv);
    await request(app).get(`/api/admin/margin`).expect(401);
    await request(app).get(`/api/sites/someone-else`).expect(404);
    expect((await request(app).get(`/api/health`)).body).toEqual({ ok: true, demo: true });
  });

  describe("sessions page data", () => {
    const env = { ...demoEnv, ADMIN_TOKEN: "secret-test-token" };

    it("needs the admin token", async () => {
      const { app } = await setup(env);
      await request(app).get(`/api/admin/sessions`).expect(401);
      await request(app).get(`/api/admin/sessions`).set("x-admin-token", "wrong").expect(401);
      await request(app).get(`/api/admin/sessions`).set("x-admin-token", "secret-test-token").expect(200);
    });

    it("lists each sandbox with its requests, decisions and AI cost, and never stores IPs or cookies", async () => {
      const { app } = await setup(env);
      const a = request.agent(app);
      const b = request.agent(app);
      const p = await a.post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" }).set("x-forwarded-for", "203.0.113.9");
      await a.post(`/api/sites/${slug}/changes/${p.body.change.id}/approve`).expect(200);
      await a.post(`/api/sites/${slug}/undo`).send({}).expect(200);
      await b.get(`/api/sites/${slug}`); // a visitor who only looked
      clock = new Date(clock.getTime() + 5 * 60_000);
      await a.post(`/api/sites/${slug}/commands`).send({ utterance: offGrammar() }); // one real (mocked) model call

      const body = (await request(app).get(`/api/admin/sessions?days=1`).set("x-admin-token", "secret-test-token").expect(200)).body;
      expect(body.totals).toMatchObject({ sessions: 2, active: 2, withRequests: 1, requests: 2, approved: 1, undone: 1, aiCalls: 1 });
      const [first, second] = body.sessions;
      expect(first).toMatchObject({ requests: 2, proposed: 2, approved: 1, undone: 1, aiCalls: 1, active: true });
      expect(first.aiCostUsd).toBeGreaterThan(0);
      expect(first.utterances.map((u: { text: string }) => u.text)[0]).toBe("hide the wings");
      expect(first.createdAt).toBe("2026-11-24T18:00:00.000Z");
      expect(first.lastSeenAt).toBe("2026-11-24T18:05:00.000Z");
      expect(second).toMatchObject({ requests: 0, aiCalls: 0 });

      // The non-expiring summary holds only counts and times.
      const visits = await db.collection("visits").find().toArray();
      expect(visits).toHaveLength(2);
      const raw = JSON.stringify(visits);
      expect(raw).not.toMatch(/203\.0\.113\.9|hide the wings|rsp_sid/);
      expect(Object.keys(visits.find((v) => v.aiCalls)!).sort()).toEqual(["_id", "account", "aiCalls", "aiCostUsd", "counts", "createdAt", "lastSeenAt"]);
    });

    it("keeps the history after the sandbox and its events expire", async () => {
      const { app } = await setup(env);
      const a = request.agent(app);
      const p = await a.post(`/api/sites/${slug}/commands`).send({ utterance: "hide the wings" });
      await a.post(`/api/sites/${slug}/changes/${p.body.change.id}/approve`).expect(200);
      // What the TTL monitor does a day later.
      await Promise.all(["sites", "events", "changes"].map((c) => db.collection(c).deleteMany({ slug: { $regex: "~" } })));
      await db.collection("sites").deleteMany({ sandboxOf: slug });
      const body = (await request(app).get(`/api/admin/sessions`).set("x-admin-token", "secret-test-token").expect(200)).body;
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0]).toMatchObject({ active: false, requests: 1, approved: 1, utterances: [] });
    });
  });
});
