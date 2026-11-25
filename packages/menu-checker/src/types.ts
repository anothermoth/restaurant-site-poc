export type Severity = "error" | "warning" | "info";

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface FindingTarget {
  categoryId?: string;
  itemId?: string;
  modifierGroupId?: string;
}

export type FixAction =
  | { kind: "rename-item"; itemId: string; to: string }
  | { kind: "remove-modifier-group"; modifierGroupId: string };

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  target: FindingTarget;
  /** Human-readable proposal. Never applied automatically unless `fix` is set. */
  suggestion?: string;
  /** Present only for fixes that are safe to apply without a human (no prices, no dietary claims). */
  fix?: FixAction;
  source: "rule" | "llm";
}

export interface Report {
  restaurant: { slug: string; name: string; isSampleData: boolean };
  itemCount: number;
  summary: { error: number; warning: number; info: number; total: number; autoFixable: number };
  /** 100 minus weighted penalties, floored at 0. A rough at-a-glance number, not a science. */
  score: number;
  findings: Finding[];
  llm: { ran: boolean; model?: string; skippedReason?: string; suggestionCount: number };
}
