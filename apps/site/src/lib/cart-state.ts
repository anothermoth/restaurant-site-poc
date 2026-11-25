import { priceCart, type CartLineInput, type PricedLine } from "@restaurant-site-poc/menu-schema/pricing";
import type { Menu } from "@restaurant-site-poc/menu-schema";

export interface CartLine extends CartLineInput {
  key: string;
}

export type CartAction =
  | { type: "add"; itemId: string; selections?: Record<string, string[]>; quantity?: number }
  | { type: "setQty"; key: string; quantity: number }
  | { type: "clear" }
  | { type: "load"; lines: CartLine[] };

export function lineKey(itemId: string, selections: Record<string, string[]> = {}): string {
  const norm = Object.keys(selections)
    .sort()
    .filter((g) => (selections[g] ?? []).length > 0)
    .map((g) => `${g}=${[...(selections[g] ?? [])].sort().join(",")}`)
    .join(";");
  return norm ? `${itemId}|${norm}` : itemId;
}

export function cartReducer(state: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      const key = lineKey(action.itemId, action.selections);
      const qty = action.quantity ?? 1;
      const existing = state.find((l) => l.key === key);
      if (existing) return state.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + qty) } : l));
      return [...state, { key, itemId: action.itemId, quantity: qty, selections: action.selections ?? {} }];
    }
    case "setQty":
      return action.quantity <= 0
        ? state.filter((l) => l.key !== action.key)
        : state.map((l) => (l.key === action.key ? { ...l, quantity: Math.min(50, action.quantity) } : l));
    case "clear":
      return [];
    case "load":
      return action.lines;
  }
}

/**
 * Prices the cart with the same priceCart() a server would use. Lines that no
 * longer price (item removed from the menu since it was saved) are dropped.
 */
export function priceLines(menu: Menu, lines: CartLine[]): { lines: Array<PricedLine & { key: string }>; subtotal: number } {
  const ok: Array<PricedLine & { key: string }> = [];
  for (const l of lines) {
    try {
      const priced = priceCart(menu, [l]).lines[0];
      if (priced) ok.push({ ...priced, key: l.key });
    } catch {
      // stale line; skip
    }
  }
  return { lines: ok, subtotal: ok.reduce((s, l) => s + l.lineTotal, 0) };
}
