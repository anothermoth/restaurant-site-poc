import { formatPrice } from "@restaurant-site-poc/menu-schema/pricing";
import type { Op } from "./types.ts";

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

/** What a request cost the owner, in credits (never dollars). */
export function costLine(source: string, credits: number): string {
  if (source === "parser") return "Matched instantly · free";
  if (source === "llm-cache") return "AI answer reused · free";
  return credits ? `AI helper · ${credits} credit${credits === 1 ? "" : "s"}` : "free";
}

export function creditsLabel(balance: number): string {
  return `${balance} credit${balance === 1 ? "" : "s"} left`;
}
