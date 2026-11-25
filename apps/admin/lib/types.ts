import type { Menu } from "@restaurant-site-poc/menu-schema";

export type { Menu };

export interface Op {
  path: string;
  before: unknown;
  after: unknown;
}

export interface Change {
  id: string;
  utterance: string;
  input: "voice" | "text";
  source: "parser" | "llm" | "llm-cache";
  commands: Array<{ cmd: string } & Record<string, unknown>>;
  ops: Op[];
  summary: string[];
  risk: "low" | "high";
  findings: { added: Finding[]; resolved: Finding[] };
  status: "pending" | "approved" | "rejected" | "superseded" | "undone";
  /** 1 if this change needed a real AI call, else 0. */
  credits: number;
  published: boolean;
  createdAt: string;
  highlight: string[];
}

export interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface SiteState {
  slug: string;
  draftVersion: number;
  publishedVersion: number;
  publishedAt: string | null;
  unpublished: boolean;
  settings: { autoApproveLowRisk: boolean };
  draft: Menu;
  preview: Menu;
  pending: Change | null;
  history: Change[];
  credits: { balance: number; perAiCall: number };
  activity: { parser: number; ai: number; aiCache: number };
  demo: boolean;
  sandboxIdleMinutes: number | null;
}

export interface ClarifyOption {
  label: string;
  utterance: string;
}

export type ProposeResult =
  | { type: "change"; change: Change; autoApproved: boolean }
  | { type: "meta"; action: string; message: string }
  | { type: "clarify"; question: string; options: ClarifyOption[]; source: string; credits: number }
  | { type: "refuse"; message: string; source: string; credits: number; blocked?: "credits" | "rate" | "cap" | "off" };

export interface PublishResult {
  publishedVersion: number;
  buildMs?: number;
  previewPath?: string;
}
