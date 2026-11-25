import type { Collection, Db, ObjectId } from "mongodb";
import type { Menu } from "@restaurant-site-poc/menu-schema";
import type { Command, LlmReply, Op, Usage } from "@restaurant-site-poc/command-engine";
import type { Finding } from "@restaurant-site-poc/menu-checker";

export interface SiteDoc {
  _id: string; // slug
  draft: Menu;
  published: Menu;
  /** Optimistic concurrency: every draft write must match the version it was based on. */
  draftVersion: number;
  publishedVersion: number;
  publishedAt: Date | null;
  settings: { autoApproveLowRisk: boolean };
  updatedAt: Date;
}

export type ChangeSource = "parser" | "llm" | "llm-cache";
export type ChangeStatus = "pending" | "approved" | "rejected" | "superseded" | "undone";

export interface ChangeDoc {
  _id: ObjectId;
  slug: string;
  utterance: string;
  input: "voice" | "text";
  source: ChangeSource;
  commands: Command[];
  ops: Op[];
  summary: string[];
  risk: "low" | "high";
  findings: { added: Pick<Finding, "ruleId" | "severity" | "message">[]; resolved: Pick<Finding, "ruleId" | "severity" | "message">[] };
  baseVersion: number;
  status: ChangeStatus;
  usage: Usage | null;
  published: boolean;
  createdAt: Date;
  decidedAt: Date | null;
}

/** Append-only edit log: every proposal, decision, undo and publish. */
export interface EventDoc {
  slug: string;
  type: "proposed" | "approved" | "rejected" | "undone" | "published" | "clarify" | "refused" | "error";
  changeId?: ObjectId;
  utterance?: string;
  detail?: string;
  at: Date;
}

/** One row per real model call (cache hits don't create rows), for the cost meter. */
export interface LlmCallDoc {
  slug: string;
  utterance: string;
  outcome: "commands" | "clarify" | "refuse";
  usage: Usage;
  at: Date;
}

export interface LlmCacheDoc {
  _id: string;
  reply: LlmReply;
  createdAt: Date;
}

export interface Collections {
  sites: Collection<SiteDoc>;
  changes: Collection<ChangeDoc>;
  events: Collection<EventDoc>;
  llmCalls: Collection<LlmCallDoc>;
  llmCache: Collection<LlmCacheDoc>;
}

export async function collections(db: Db): Promise<Collections> {
  const c: Collections = {
    sites: db.collection<SiteDoc>("sites"),
    changes: db.collection<ChangeDoc>("changes"),
    events: db.collection<EventDoc>("events"),
    llmCalls: db.collection<LlmCallDoc>("llm_calls"),
    llmCache: db.collection<LlmCacheDoc>("llm_cache"),
  };
  await Promise.all([
    c.changes.createIndex({ slug: 1, createdAt: -1 }),
    c.changes.createIndex({ slug: 1, status: 1 }),
    c.events.createIndex({ slug: 1, at: -1 }),
    c.llmCalls.createIndex({ slug: 1, at: -1 }),
    c.llmCache.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }),
  ]);
  return c;
}
