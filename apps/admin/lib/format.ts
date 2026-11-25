import { formatPrice } from "@restaurant-site-poc/menu-schema/pricing";
import type { Op, Usage } from "./types.ts";

const DAY: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

export function formatHours(hours: Array<{ days: string[]; opens: string; closes: string }>): string {
  if (!hours.length) return "Closed all week";
  return hours.map((h) => `${h.days.map((d) => DAY[d] ?? d).join(", ")} ${h.opens}–${h.closes}`).join(" · ");
}

/** Human-readable value for the before/after diff. */
export function formatOpValue(op: Op, value: unknown, currency = "USD"): string {
  if (op.path.endsWith("/price") && typeof value === "number") return formatPrice(value, currency);
  if (op.path.endsWith("/available")) return value ? "Shown" : "Hidden";
  if (op.path.endsWith("/hidden")) return value ? "Hidden" : "Shown";
  if (op.path === "/restaurant/hours") return formatHours(value as Array<{ days: string[]; opens: string; closes: string }>);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (value === undefined || value === null || value === "") return "(empty)";
  return String(value);
}

export function fieldLabel(path: string): string {
  const [, kind, id, field] = path.split("/");
  if (kind === "items") return `${id} · ${field === "dietaryTags" ? "tags" : field}`;
  if (kind === "categories") return `section ${id} · ${field === "itemOrder" ? "order" : "visibility"}`;
  if (kind === "categoryOrder") return "section order";
  return `${id}`;
}

export function usd(n: number): string {
  return n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`;
}

export function costLine(source: string, usage: Usage | null | undefined): string {
  if (source === "parser") return "Matched instantly · no AI · $0";
  if (source === "llm-cache") return "AI answer from cache · $0";
  if (!usage) return "AI";
  return `AI fallback · ${usage.inputTokens} in (${usage.cachedInputTokens} cached) / ${usage.outputTokens} out · ${usd(usage.costUsd)} · ${usage.latencyMs} ms`;
}
