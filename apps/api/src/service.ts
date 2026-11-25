import { ObjectId } from "mongodb";
import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import {
  applyOps,
  CommandError,
  compile,
  editIdsForPath,
  llmFallback,
  OpError,
  parse,
  revertOps,
  selectedTarget,
  type ParseContext,
  type CacheStore,
  type ClarifyOption,
  type FetchLike,
  type LlmConfig,
  type MetaAction,
} from "@restaurant-site-poc/command-engine";
import type { ChangeDoc, Collections, SiteDoc } from "./store.ts";
import { DEFAULT_LIMITS, type Limits } from "./config.ts";

export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PublishHook {
  (slug: string, menu: Menu): Promise<{ file?: string; buildMs?: number; buildHook?: string }>;
}

export interface ServiceDeps {
  c: Collections;
  llm: LlmConfig | null;
  fetchImpl?: FetchLike;
  onPublish?: PublishHook;
  limits?: Partial<Limits>;
  now?: () => Date;
}

/** Who is asking: used for per-session / per-IP rate limits. The IP is stored only as a hash. */
export interface RequestCtx {
  sessionId?: string;
  ipHash?: string;
}

export type BlockReason = "credits" | "rate" | "cap" | "off";

/** Demo sandbox slugs look like `<site>~<session>`. */
export const SANDBOX_SEP = "~";
export const isSandbox = (slug: string) => slug.includes(SANDBOX_SEP);
export const accountOf = (slug: string) => slug.split(SANDBOX_SEP)[0]!;
const DAY_MS = 86_400_000;

export type ProposeResult =
  | { type: "change"; change: ChangeView; autoApproved: boolean }
  | { type: "meta"; action: MetaAction; message: string; change?: ChangeView }
  | { type: "clarify"; question: string; options: ClarifyOption[]; source: string; credits: number }
  | { type: "refuse"; message: string; source: string; credits: number; blocked?: BlockReason };

/**
 * What clients see. Token counts and dollar cost stay server-side (llm_calls and
 * the admin margin report); clients only see credits.
 */
export type ChangeView = Omit<ChangeDoc, "_id" | "usage" | "expiresAt"> & { id: string; highlight: string[] };

export function view(c: ChangeDoc): ChangeView {
  const { _id, usage: _usage, expiresAt: _exp, ...rest } = c;
  // Clients see the site slug, never the sandbox key.
  return { id: _id.toHexString(), ...rest, slug: accountOf(c.slug), credits: rest.credits ?? (c.source === "llm" ? 1 : 0), highlight: [...new Set(c.ops.flatMap((o) => editIdsForPath(o.path)))] };
}

function mongoCache(c: Collections): CacheStore {
  return {
    get: async (k) => (await c.llmCache.findOne({ _id: k }))?.reply ?? null,
    set: async (k, reply) => {
      await c.llmCache.updateOne({ _id: k }, { $set: { reply, createdAt: new Date() } }, { upsert: true });
    },
  };
}

export class EditService {
  constructor(private d: ServiceDeps) {}

  private get c() {
    return this.d.c;
  }

  get limits(): Limits {
    return { ...DEFAULT_LIMITS, ...this.d.limits };
  }

  private now() {
    return this.d.now ? this.d.now() : new Date();
  }

  /** Sandbox rows (changes, events) expire a day after they're written; the sandbox itself expires sooner. */
  private ttl(slug: string): { expiresAt?: Date } {
    return isSandbox(slug) ? { expiresAt: new Date(this.now().getTime() + DAY_MS) } : {};
  }

  /**
   * Creates the site if it doesn't exist. `reset` restores the seed menu but keeps the
   * credit balance, so resetting can't be used to refill credits.
   */
  async seed(slug: string, menu: Menu, { reset = false, expiresAt, sandboxOf }: { reset?: boolean; expiresAt?: Date; sandboxOf?: string } = {}) {
    const exists = await this.c.sites.findOne({ _id: slug });
    if (exists && !reset) {
      if (typeof exists.credits !== "number") await this.c.sites.updateOne({ _id: slug }, { $set: { credits: this.limits.defaultCredits } });
      return;
    }
    if (reset) await Promise.all([this.c.changes.deleteMany({ slug }), this.c.events.deleteMany({ slug })]);
    const now = this.now();
    const credits = typeof exists?.credits === "number" ? exists.credits : this.limits.defaultCredits;
    const doc: Omit<SiteDoc, "_id"> = {
      draft: menu,
      published: menu,
      draftVersion: 1,
      publishedVersion: 1,
      publishedAt: null,
      settings: { autoApproveLowRisk: false },
      credits,
      updatedAt: now,
      ...(expiresAt ? { expiresAt } : {}),
      ...(sandboxOf ? { sandboxOf } : {}),
    };
    await this.c.sites.replaceOne({ _id: slug }, doc, { upsert: true });
  }

  /** Creates the demo sandbox on first use and pushes its expiry back on every request. */
  async touchSandbox(slug: string, seedMenu: Menu, idleMs: number) {
    const expiresAt = new Date(this.now().getTime() + idleMs);
    const r = await this.c.sites.updateOne({ _id: slug }, { $set: { expiresAt } });
    if (r.matchedCount === 0) {
      try {
        await this.c.changes.deleteMany({ slug });
        await this.c.events.deleteMany({ slug });
        await this.c.sites.insertOne({
          _id: slug,
          draft: seedMenu,
          published: seedMenu,
          draftVersion: 1,
          publishedVersion: 1,
          publishedAt: null,
          settings: { autoApproveLowRisk: false },
          credits: this.limits.defaultCredits,
          updatedAt: this.now(),
          expiresAt,
          sandboxOf: accountOf(slug),
        });
      } catch (e) {
        // Two first requests raced; the other one created it.
        if (!(e && typeof e === "object" && "code" in e && e.code === 11000)) throw e;
      }
    }
  }

  async setCredits(slug: string, credits: number) {
    await this.site(slug);
    await this.c.sites.updateOne({ _id: slug }, { $set: { credits: Math.max(0, Math.floor(credits)) } });
  }

  async site(slug: string): Promise<SiteDoc> {
    const s = await this.c.sites.findOne({ _id: slug });
    if (!s) throw new ServiceError(404, `No site "${slug}"`);
    return s;
  }

  async pending(slug: string) {
    return this.c.changes.findOne({ slug, status: "pending" });
  }

  async state(slug: string) {
    const site = await this.site(slug);
    const pending = await this.pending(slug);
    const history = await this.c.changes.find({ slug, status: { $ne: "pending" } }).sort({ createdAt: -1 }).limit(30).toArray();
    let preview = site.draft;
    if (pending) {
      try {
        preview = applyOps(site.draft, pending.ops);
      } catch {
        preview = site.draft;
      }
    }
    return {
      slug,
      draftVersion: site.draftVersion,
      publishedVersion: site.publishedVersion,
      publishedAt: site.publishedAt,
      settings: site.settings,
      unpublished: site.draftVersion !== site.publishedVersion,
      draft: site.draft,
      preview,
      pending: pending ? view(pending) : null,
      history: history.map(view),
      credits: { balance: site.credits ?? this.limits.defaultCredits, perAiCall: 1 },
      activity: await this.activity(slug),
    };
  }

  /** How requests were resolved, for the admin bar. No dollar amounts. */
  async activity(slug: string) {
    const u = await this.usage(slug);
    return { parser: u.changesBySource.parser, ai: u.llmCalls, aiCache: u.changesBySource["llm-cache"] };
  }

  async usage(slug: string) {
    const [bySource, calls] = await Promise.all([
      this.c.changes.aggregate<{ _id: string; n: number }>([{ $match: { slug } }, { $group: { _id: "$source", n: { $sum: 1 } } }]).toArray(),
      this.c.llmCalls
        .aggregate<{ calls: number; input: number; cached: number; output: number; cost: number }>([
          { $match: { slug } },
          {
            $group: {
              _id: null,
              calls: { $sum: 1 },
              input: { $sum: "$usage.inputTokens" },
              cached: { $sum: "$usage.cachedInputTokens" },
              output: { $sum: "$usage.outputTokens" },
              cost: { $sum: "$usage.costUsd" },
            },
          },
        ])
        .toArray(),
    ]);
    const t = calls[0] ?? { calls: 0, input: 0, cached: 0, output: 0, cost: 0 };
    const src = Object.fromEntries(bySource.map((b) => [b._id, b.n]));
    return {
      changesBySource: { parser: src.parser ?? 0, llm: src.llm ?? 0, "llm-cache": src["llm-cache"] ?? 0 },
      llmCalls: t.calls,
      inputTokens: t.input,
      cachedInputTokens: t.cached,
      outputTokens: t.output,
      estimatedCostUsd: Number(t.cost.toFixed(6)),
    };
  }

  private async log(slug: string, type: Parameters<Collections["events"]["insertOne"]>[0]["type"], extra: { changeId?: ObjectId; utterance?: string; detail?: string } = {}) {
    await this.c.events.insertOne({ slug, type, ...extra, at: this.now(), ...this.ttl(slug) });
  }

  private dayKey() {
    return this.now().toISOString().slice(0, 10);
  }

  /** Today's (UTC) real model spend across every site and sandbox. */
  async spendToday(): Promise<{ day: string; usd: number; calls: number }> {
    const day = this.dayKey();
    const d = await this.c.counters.findOne({ _id: `spend:${day}` });
    return { day, usd: d?.usd ?? 0, calls: d?.n ?? 0 };
  }

  /** Counts a hit in a fixed one-hour window and says whether it's over the limit. */
  private async overLimit(key: string, max: number | null): Promise<boolean> {
    if (max === null) return false;
    const hour = Math.floor(this.now().getTime() / 3_600_000);
    const r = await this.c.counters.findOneAndUpdate(
      { _id: `rate:${key}:${hour}` },
      { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((hour + 2) * 3_600_000) } },
      { upsert: true, returnDocument: "after" },
    );
    return (r?.n ?? 1) > max;
  }

  /**
   * The gate in front of every paid model call (cache hits never reach it):
   * daily spend cap → rate limits → take 1 credit. Returns a block reason or null.
   */
  private async gate(slug: string, ctx: RequestCtx): Promise<{ reason: BlockReason; message: string } | null> {
    const L = this.limits;
    if (L.dailySpendCapUsd !== null && (await this.spendToday()).usd >= L.dailySpendCapUsd) {
      return { reason: "cap", message: "The AI helper is paused for today because the demo hit its daily spending cap." };
    }
    if ((ctx.sessionId && (await this.overLimit(`s:${ctx.sessionId}`, L.llmPerSessionHour))) || (ctx.ipHash && (await this.overLimit(`ip:${ctx.ipHash}`, L.llmPerIpHour)))) {
      return { reason: "rate", message: "That's a lot of AI requests in a short time, so the AI helper is paused for a bit." };
    }
    const took = await this.c.sites.updateOne({ _id: slug, credits: { $gte: 1 } }, { $inc: { credits: -1 } });
    if (took.modifiedCount === 0) return { reason: "credits", message: "You're out of AI credits, so the AI helper is paused." };
    return null;
  }

  private async recordSpend(usd: number) {
    const day = this.dayKey();
    await this.c.counters.updateOne(
      { _id: `spend:${day}` },
      { $inc: { n: 1, usd }, $setOnInsert: { expiresAt: new Date(Date.parse(day) + 8 * DAY_MS) } },
      { upsert: true },
    );
  }

  /**
   * Internal unit economics: real token cost vs. credits charged, per day and per account.
   * Never exposed to editors; the admin route needs ADMIN_TOKEN.
   */
  async margin({ days = 7 }: { days?: number } = {}) {
    const since = new Date(this.now().getTime() - days * DAY_MS);
    const rows = await this.c.llmCalls
      .aggregate<{ _id: { day: string; account: string }; calls: number; credits: number; costUsd: number; input: number; cached: number; output: number }>([
        { $match: { at: { $gte: since } } },
        {
          $group: {
            _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$at" } }, account: { $ifNull: ["$account", "$slug"] } },
            calls: { $sum: 1 },
            credits: { $sum: { $ifNull: ["$credits", 1] } },
            costUsd: { $sum: "$usage.costUsd" },
            input: { $sum: "$usage.inputTokens" },
            cached: { $sum: "$usage.cachedInputTokens" },
            output: { $sum: "$usage.outputTokens" },
          },
        },
        { $sort: { "_id.day": -1, "_id.account": 1 } },
      ])
      .toArray();
    const price = this.limits.creditPriceUsd;
    const shape = (r: { calls: number; credits: number; costUsd: number; input: number; cached: number; output: number }) => {
      const revenueUsd = r.credits * price;
      const marginUsd = revenueUsd - r.costUsd;
      return {
        calls: r.calls,
        creditsCharged: r.credits,
        inputTokens: r.input,
        cachedInputTokens: r.cached,
        outputTokens: r.output,
        costUsd: round(r.costUsd),
        avgCostPerCallUsd: r.calls ? round(r.costUsd / r.calls) : 0,
        revenueUsd: round(revenueUsd),
        marginUsd: round(marginUsd),
        marginPct: revenueUsd ? Math.round((marginUsd / revenueUsd) * 1000) / 10 : null,
      };
    };
    const total = rows.reduce((a, r) => ({ calls: a.calls + r.calls, credits: a.credits + r.credits, costUsd: a.costUsd + r.costUsd, input: a.input + r.input, cached: a.cached + r.cached, output: a.output + r.output }), { calls: 0, credits: 0, costUsd: 0, input: 0, cached: 0, output: 0 });
    const cacheHits = await this.c.changes.countDocuments({ source: "llm-cache", createdAt: { $gte: since } });
    return {
      days,
      creditPriceUsd: price,
      limits: this.limits,
      today: await this.spendToday(),
      total: { ...shape(total), cacheHits },
      rows: rows.map((r) => ({ day: r._id.day, account: r._id.account, ...shape(r) })),
    };
  }

  async propose(
    slug: string,
    utterance: string,
    input: "voice" | "text" = "text",
    ctx: RequestCtx = {},
    target?: ParseContext["target"],
  ): Promise<ProposeResult> {
    const site = await this.site(slug);
    // Deterministic first: the parser resolves "this"/"it" and bare commands ("$14") to the selection.
    const parsed = parse(utterance, site.draft, { target });
    const selected = selectedTarget(site.draft, { target });

    if (parsed.kind === "meta") return this.meta(slug, parsed.action);
    if (parsed.kind === "clarify") {
      await this.log(slug, "clarify", { utterance });
      return { type: "clarify", question: parsed.question, options: parsed.options, source: "parser", credits: 0 };
    }

    let commands: unknown[];
    let source: ChangeDoc["source"] = "parser";
    let usage: ChangeDoc["usage"] = null;
    let credits = 0;
    if (parsed.kind === "commands") {
      commands = parsed.commands;
    } else {
      let blocked: { reason: BlockReason; message: string } | null = null;
      let charged = false;
      let fb;
      try {
        // Only if the parser can't: the model gets the selection as plain context.
        const llmUtterance = selected ? `[Selected ${selected.kind}: "${selected.name}" (id ${selected.id})] ${utterance}` : utterance;
        fb = await llmFallback(llmUtterance, site.draft, {
          config: this.d.llm,
          cache: mongoCache(this.c),
          fetchImpl: this.d.fetchImpl,
          beforeCall: async () => {
            blocked = await this.gate(slug, ctx);
            charged = !blocked;
            return blocked?.message ?? null;
          },
        });
      } catch (e) {
        // The model call failed after we took a credit: give it back.
        if (charged) await this.c.sites.updateOne({ _id: slug }, { $inc: { credits: 1 } });
        throw e;
      }
      if (fb.source === "unavailable") {
        const b = blocked as { reason: BlockReason; message: string } | null;
        await this.log(slug, "refused", { utterance, detail: fb.reason });
        return {
          type: "refuse",
          message: `${fb.reason} Built-in phrases still work, for example "change the price of X to $12", "hide X" or "mark X as vegan".`,
          source: "parser",
          credits: 0,
          blocked: b?.reason ?? "off",
        };
      }
      source = fb.source;
      usage = fb.usage;
      credits = fb.usage ? 1 : 0;
      const outcome = "commands" in fb.reply ? "commands" : "clarify" in fb.reply ? "clarify" : "refuse";
      if (fb.usage) {
        await this.c.llmCalls.insertOne({ slug, account: accountOf(slug), utterance, outcome, usage: fb.usage, credits, at: this.now() });
        await this.recordSpend(fb.usage.costUsd);
      }
      if ("clarify" in fb.reply) {
        await this.log(slug, "clarify", { utterance });
        return { type: "clarify", question: fb.reply.clarify.question, options: fb.reply.clarify.options.map((o) => ({ label: o, utterance: o })), source, credits };
      }
      if ("refuse" in fb.reply) {
        await this.log(slug, "refused", { utterance, detail: fb.reply.refuse.reason });
        return { type: "refuse", message: fb.reply.refuse.reason, source, credits };
      }
      commands = fb.reply.commands;
    }

    let compiled;
    try {
      compiled = compile(site.draft, commands);
    } catch (e) {
      if (e instanceof CommandError) {
        await this.log(slug, "error", { utterance, detail: e.message });
        return { type: "refuse", message: e.message, source, credits };
      }
      throw e;
    }

    const now = this.now();
    await this.c.changes.updateMany({ slug, status: "pending" }, { $set: { status: "superseded", decidedAt: now } });
    const slim = (f: { ruleId: string; severity: "error" | "warning" | "info"; message: string }) => ({ ruleId: f.ruleId, severity: f.severity, message: f.message });
    const doc: ChangeDoc = {
      _id: new ObjectId(),
      slug,
      utterance,
      input,
      source,
      commands: compiled.commands,
      ops: compiled.ops,
      summary: compiled.summary,
      risk: compiled.risk,
      findings: { added: compiled.findings.added.map(slim), resolved: compiled.findings.resolved.map(slim) },
      baseVersion: site.draftVersion,
      status: "pending",
      usage,
      credits,
      published: false,
      createdAt: now,
      decidedAt: null,
      ...this.ttl(slug),
    };
    await this.c.changes.insertOne(doc);
    await this.log(slug, "proposed", { changeId: doc._id, utterance });

    // Risky edits (prices, allergens) never auto-apply, whatever the setting.
    if (site.settings.autoApproveLowRisk && doc.risk === "low") {
      const approved = await this.approve(doc._id.toHexString());
      return { type: "change", change: approved, autoApproved: true };
    }
    return { type: "change", change: view(doc), autoApproved: false };
  }

  private async meta(slug: string, action: MetaAction): Promise<ProposeResult> {
    if (action === "publish") {
      const r = await this.publish(slug);
      return { type: "meta", action, message: `Published version ${r.publishedVersion}.` };
    }
    if (action === "undo") {
      const c = await this.undo(slug);
      return { type: "meta", action, message: `Undid: ${c.summary.join("; ")}`, change: c };
    }
    const p = await this.pending(slug);
    if (!p) return { type: "meta", action, message: "There's no pending change." };
    const c = action === "approve" ? await this.approve(p._id.toHexString()) : await this.reject(p._id.toHexString());
    return { type: "meta", action, message: `${action === "approve" ? "Approved" : "Rejected"}: ${c.summary.join("; ")}`, change: c };
  }

  /** `slug`, when given, must own the change (demo sandboxes can't touch each other's changes). */
  private async getChange(id: string, slug?: string): Promise<ChangeDoc> {
    if (!ObjectId.isValid(id)) throw new ServiceError(400, "Bad change id");
    const c = await this.c.changes.findOne({ _id: new ObjectId(id), ...(slug ? { slug } : {}) });
    if (!c) throw new ServiceError(404, "No such change");
    return c;
  }

  /** Writes the draft only if nobody else wrote it since `expectedVersion`. */
  private async writeDraft(slug: string, expectedVersion: number, draft: Menu) {
    const r = await this.c.sites.updateOne(
      { _id: slug, draftVersion: expectedVersion },
      { $set: { draft: parseMenu(draft), updatedAt: new Date() }, $inc: { draftVersion: 1 } },
    );
    if (r.matchedCount === 0) throw new ServiceError(409, "The draft changed since this edit was proposed. Say it again to re-preview.");
  }

  async approve(id: string, slug?: string): Promise<ChangeView> {
    const c = await this.getChange(id, slug);
    if (c.status !== "pending") throw new ServiceError(409, `Change is ${c.status}`);
    const site = await this.site(c.slug);
    if (site.draftVersion !== c.baseVersion) throw new ServiceError(409, "The draft changed since this edit was proposed. Say it again to re-preview.");
    await this.writeDraft(c.slug, c.baseVersion, applyOps(site.draft, c.ops));
    const decidedAt = new Date();
    await this.c.changes.updateOne({ _id: c._id }, { $set: { status: "approved", decidedAt } });
    await this.log(c.slug, "approved", { changeId: c._id });
    return view({ ...c, status: "approved", decidedAt });
  }

  async reject(id: string, slug?: string): Promise<ChangeView> {
    const c = await this.getChange(id, slug);
    if (c.status !== "pending") throw new ServiceError(409, `Change is ${c.status}`);
    const decidedAt = new Date();
    await this.c.changes.updateOne({ _id: c._id }, { $set: { status: "rejected", decidedAt } });
    await this.log(c.slug, "rejected", { changeId: c._id });
    return view({ ...c, status: "rejected", decidedAt });
  }

  /** Undo a specific approved change, or the latest one. Free: no model call. */
  async undo(slug: string, id?: string): Promise<ChangeView> {
    const c = id
      ? await this.getChange(id, slug)
      : await this.c.changes.findOne({ slug, status: "approved" }, { sort: { decidedAt: -1 } });
    if (!c) throw new ServiceError(404, "Nothing to undo");
    if (c.status !== "approved") throw new ServiceError(409, `Change is ${c.status}`);
    const site = await this.site(c.slug);
    let reverted: Menu;
    try {
      reverted = revertOps(site.draft, c.ops);
    } catch (e) {
      if (e instanceof OpError) throw new ServiceError(409, e.message);
      throw e;
    }
    await this.writeDraft(c.slug, site.draftVersion, reverted);
    await this.c.changes.updateOne({ _id: c._id }, { $set: { status: "undone" } });
    await this.log(c.slug, "undone", { changeId: c._id });
    return view({ ...c, status: "undone" });
  }

  async publish(slug: string) {
    const site = await this.site(slug);
    if (await this.pending(slug)) throw new ServiceError(409, "Approve or reject the pending change before publishing.");
    const publishedAt = new Date();
    const r = await this.c.sites.updateOne(
      { _id: slug, draftVersion: site.draftVersion },
      { $set: { published: site.draft, publishedVersion: site.draftVersion, publishedAt } },
    );
    if (r.matchedCount === 0) throw new ServiceError(409, "The draft changed while publishing; try again.");
    await this.c.changes.updateMany({ slug, status: "approved", published: false }, { $set: { published: true } });
    const hook = this.d.onPublish ? await this.d.onPublish(slug, site.draft) : {};
    await this.log(slug, "published", { detail: `v${site.draftVersion}` });
    return { publishedVersion: site.draftVersion, publishedAt, ...hook };
  }

  async setSettings(slug: string, settings: Partial<SiteDoc["settings"]>) {
    await this.site(slug);
    const $set = Object.fromEntries(Object.entries(settings).map(([k, v]) => [`settings.${k}`, v]));
    await this.c.sites.updateOne({ _id: slug }, { $set });
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
