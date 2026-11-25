// Zod-free on purpose: the browser cart imports this module, and keeping the
// schema library out of it keeps the island bundle small.
import type { Menu, MenuItem, ModifierGroup } from "./index.ts";

export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export interface CartLineInput {
  itemId: string;
  quantity: number;
  /** modifier group id -> chosen option ids */
  selections?: Record<string, string[]>;
}

export interface PricedLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  optionNames: string[];
}

export class CartError extends Error {}

/**
 * Prices a cart from the menu alone. The client only sends ids and quantities;
 * every price comes from the menu, so a tampered payload can't change a total.
 */
export function priceCart(menu: Menu, lines: CartLineInput[]): { lines: PricedLine[]; subtotal: number } {
  const items = new Map<string, MenuItem>();
  for (const c of menu.categories) for (const i of c.items) items.set(i.id, i);
  const groups = new Map<string, ModifierGroup>(menu.modifierGroups.map((g) => [g.id, g]));

  const priced = lines.map((line) => {
    const item = items.get(line.itemId);
    if (!item) throw new CartError(`unknown item "${line.itemId}"`);
    if (!item.available) throw new CartError(`"${item.name}" is not available`);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) {
      throw new CartError(`bad quantity for "${item.name}"`);
    }
    let unit = item.price;
    const optionNames: string[] = [];
    const selections = line.selections ?? {};
    for (const gid of Object.keys(selections)) {
      if (!item.modifierGroupIds.includes(gid)) throw new CartError(`"${item.name}" has no modifier group "${gid}"`);
    }
    for (const gid of item.modifierGroupIds) {
      const group = groups.get(gid);
      if (!group) throw new CartError(`unknown modifier group "${gid}"`);
      const chosen = selections[gid] ?? [];
      if (new Set(chosen).size !== chosen.length) throw new CartError(`duplicate option in "${group.name}"`);
      if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
        throw new CartError(`"${group.name}" needs ${group.minSelect}-${group.maxSelect} choices`);
      }
      for (const oid of chosen) {
        const opt = group.options.find((o) => o.id === oid);
        if (!opt) throw new CartError(`unknown option "${oid}" in "${group.name}"`);
        unit += opt.priceDelta;
        optionNames.push(opt.name);
      }
    }
    return {
      itemId: item.id,
      name: item.name,
      quantity: line.quantity,
      unitPrice: unit,
      lineTotal: unit * line.quantity,
      optionNames,
    };
  });
  return { lines: priced, subtotal: priced.reduce((s, l) => s + l.lineTotal, 0) };
}
