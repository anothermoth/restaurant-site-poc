import type { Menu } from "@restaurant-site-poc/menu-schema";

export type { Menu };

export interface Op {
  path: string;
  before: unknown;
  after: unknown;
}

export interface Usage {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
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
  usage: Usage | null;
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
  usage: {
    changesBySource: { parser: number; llm: number; "llm-cache": number };
    llmCalls: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface ClarifyOption {
  label: string;
  utterance: string;
}

export type ProposeResult =
  | { type: "change"; change: Change; autoApproved: boolean }
  | { type: "meta"; action: string; message: string }
  | { type: "clarify"; question: string; options: ClarifyOption[]; source: string; usage?: Usage | null }
  | { type: "refuse"; message: string; source: string; usage?: Usage | null };
