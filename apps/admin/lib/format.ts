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

const FIELD: Record<string, string> = { price: "Price", name: "Name", description: "Description", available: "On the menu", dietaryTags: "Tags", hidden: "Section" };

/**
 * A change in owner words: what is changing, and its value before and after.
 * Ordering changes have no meaningful before/after values, so they show only the sentence.
 */
export function plainRows(change: { ops: Op[]; summary: string[] }, menu: { currency?: string; categories: Array<{ id: string; name: string; items: Array<{ id: string; name: string }> }> }) {
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i.name] as const)));
  const cats = new Map(menu.categories.map((c) => [c.id, c.name] as const));
  return change.ops
    .filter((op) => !/\/(itemOrder|categoryOrder)$/.test(op.path) && op.path !== "/categoryOrder")
    .map((op) => {
      const [, kind, id, field] = op.path.split("/");
      let what: string;
      if (kind === "items") what = `${items.get(id!) ?? id} · ${FIELD[field!] ?? field}`;
      else if (kind === "categories") what = `${cats.get(id!) ?? id} section`;
      else if (op.path === "/restaurant/hours") what = "Opening hours";
      else what = (id ?? "").replace(/^./, (c) => c.toUpperCase());
      const value = (v: unknown) => (op.path.endsWith("/available") ? (v ? "Showing" : "Hidden") : formatOpValue(op, v, menu.currency));
      return { key: op.path, what, before: value(op.before), after: value(op.after) };
    });
}

/** Internal pages (margin, sessions) are left out of page-view analytics. */
export function isInternalPath(pathname: string): boolean {
  return /^\/(dev|admin)(\/|$)/.test(pathname);
}

/** A timestamp in the owner's time zone, e.g. "Nov 25, 2:31 PM CST". */
export function formatChicago(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
