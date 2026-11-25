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
  type CacheStore,
  type ClarifyOption,
  type FetchLike,
  type LlmConfig,
  type MetaAction,
} from "@restaurant-site-poc/command-engine";
import type { ChangeDoc, Collections, SiteDoc } from "./store.ts";

export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PublishHook {
  (slug: string, menu: Menu): Promise<{ file?: string; buildMs?: number }>;
}

export interface ServiceDeps {
  c: Collections;
  llm: LlmConfig | null;
  fetchImpl?: FetchLike;
  onPublish?: PublishHook;
}

export type ProposeResult =
  | { type: "change"; change: ChangeView; autoApproved: boolean }
  | { type: "meta"; action: MetaAction; message: string; change?: ChangeView }
  | { type: "clarify"; question: string; options: ClarifyOption[]; source: string; usage?: ChangeDoc["usage"] }
  | { type: "refuse"; message: string; source: string; usage?: ChangeDoc["usage"] };

export type ChangeView = Omit<ChangeDoc, "_id"> & { id: string; highlight: string[] };

export function view(c: ChangeDoc): ChangeView {
  const { _id, ...rest } = c;
  return { id: _id.toHexString(), ...rest, highlight: [...new Set(c.ops.flatMap((o) => editIdsForPath(o.path)))] };
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

  async seed(slug: string, menu: Menu, { reset = false } = {}) {
    const exists = await this.c.sites.findOne({ _id: slug });
    if (exists && !reset) return;
    if (reset) await Promise.all([this.c.changes.deleteMany({ slug }), this.c.events.deleteMany({ slug })]);
    const now = new Date();
    await this.c.sites.replaceOne(
      { _id: slug },
      { draft: menu, published: menu, draftVersion: 1, publishedVersion: 1, publishedAt: null, settings: { autoApproveLowRisk: false }, updatedAt: now },
      { upsert: true },
    );
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
      usage: await this.usage(slug),
    };
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
    await this.c.events.insertOne({ slug, type, ...extra, at: new Date() });
  }

  async propose(slug: string, utterance: string, input: "voice" | "text" = "text"): Promise<ProposeResult> {
    const site = await this.site(slug);
    const parsed = parse(utterance, site.draft);

    if (parsed.kind === "meta") return this.meta(slug, parsed.action);
    if (parsed.kind === "clarify") {
      await this.log(slug, "clarify", { utterance });
      return { type: "clarify", question: parsed.question, options: parsed.options, source: "parser" };
    }

    let commands: unknown[];
    let source: ChangeDoc["source"] = "parser";
    let usage: ChangeDoc["usage"] = null;
    if (parsed.kind === "commands") {
      commands = parsed.commands;
    } else {
      const fb = await llmFallback(utterance, site.draft, { config: this.d.llm, cache: mongoCache(this.c), fetchImpl: this.d.fetchImpl });
      if (fb.source === "unavailable") {
        await this.log(slug, "refused", { utterance, detail: fb.reason });
        return { type: "refuse", message: `${fb.reason} Try "change the price of X to $12" or "hide X".`, source: "parser" };
      }
      source = fb.source;
      usage = fb.usage;
      const outcome = "commands" in fb.reply ? "commands" : "clarify" in fb.reply ? "clarify" : "refuse";
      if (fb.usage) await this.c.llmCalls.insertOne({ slug, utterance, outcome, usage: fb.usage, at: new Date() });
      if ("clarify" in fb.reply) {
        await this.log(slug, "clarify", { utterance });
        return { type: "clarify", question: fb.reply.clarify.question, options: fb.reply.clarify.options.map((o) => ({ label: o, utterance: o })), source, usage };
      }
      if ("refuse" in fb.reply) {
        await this.log(slug, "refused", { utterance, detail: fb.reply.refuse.reason });
        return { type: "refuse", message: fb.reply.refuse.reason, source, usage };
      }
      commands = fb.reply.commands;
    }

    let compiled;
    try {
      compiled = compile(site.draft, commands);
    } catch (e) {
      if (e instanceof CommandError) {
        await this.log(slug, "error", { utterance, detail: e.message });
        return { type: "refuse", message: e.message, source, usage };
      }
      throw e;
    }

    const now = new Date();
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
      published: false,
      createdAt: now,
      decidedAt: null,
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

  private async getChange(id: string): Promise<ChangeDoc> {
    if (!ObjectId.isValid(id)) throw new ServiceError(400, "Bad change id");
    const c = await this.c.changes.findOne({ _id: new ObjectId(id) });
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

  async approve(id: string): Promise<ChangeView> {
    const c = await this.getChange(id);
    if (c.status !== "pending") throw new ServiceError(409, `Change is ${c.status}`);
    const site = await this.site(c.slug);
    if (site.draftVersion !== c.baseVersion) throw new ServiceError(409, "The draft changed since this edit was proposed. Say it again to re-preview.");
    await this.writeDraft(c.slug, c.baseVersion, applyOps(site.draft, c.ops));
    const decidedAt = new Date();
    await this.c.changes.updateOne({ _id: c._id }, { $set: { status: "approved", decidedAt } });
    await this.log(c.slug, "approved", { changeId: c._id });
    return view({ ...c, status: "approved", decidedAt });
  }

  async reject(id: string): Promise<ChangeView> {
    const c = await this.getChange(id);
    if (c.status !== "pending") throw new ServiceError(409, `Change is ${c.status}`);
    const decidedAt = new Date();
    await this.c.changes.updateOne({ _id: c._id }, { $set: { status: "rejected", decidedAt } });
    await this.log(c.slug, "rejected", { changeId: c._id });
    return view({ ...c, status: "rejected", decidedAt });
  }

  /** Undo a specific approved change, or the latest one. Free: no model call. */
  async undo(slug: string, id?: string): Promise<ChangeView> {
    const c = id
      ? await this.getChange(id)
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
