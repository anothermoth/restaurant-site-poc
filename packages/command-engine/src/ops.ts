import type { Menu, MenuItem } from "@restaurant-site-poc/menu-schema";

/**
 * A change is a list of ops on semantic paths. Each op stores before and after,
 * so undo is "set back to before" and is refused if the current value is no
 * longer "after" (someone changed it since). No model call is needed to undo.
 *
 * Paths:
 *   /items/<id>/{price|name|description|available|dietaryTags}
 *   /categories/<id>/{hidden|itemOrder}
 *   /categoryOrder
 *   /restaurant/{tagline|hours}
 */
export interface Op {
  path: string;
  before: unknown;
  after: unknown;
}

const ITEM_FIELDS = new Set(["price", "name", "description", "available", "dietaryTags"]);

function findItem(menu: Menu, id: string): MenuItem | undefined {
  for (const c of menu.categories) {
    const i = c.items.find((x) => x.id === id);
    if (i) return i;
  }
  return undefined;
}

export class OpError extends Error {}

export function getAt(menu: Menu, path: string): unknown {
  const [, kind, id, field] = path.split("/");
  if (kind === "items" && id && field && ITEM_FIELDS.has(field)) {
    const item = findItem(menu, id);
    if (!item) throw new OpError(`no item ${id}`);
    return structuredClone(item[field as keyof MenuItem]);
  }
  if (kind === "categories" && id) {
    const c = menu.categories.find((x) => x.id === id);
    if (!c) throw new OpError(`no category ${id}`);
    if (field === "hidden") return c.hidden;
    if (field === "itemOrder") return c.items.map((i) => i.id);
  }
  if (kind === "categoryOrder") return menu.categories.map((c) => c.id);
  if (kind === "restaurant" && (id === "tagline" || id === "hours")) return structuredClone(menu.restaurant[id]);
  throw new OpError(`path not editable: ${path}`);
}

/** Mutates `menu`. Callers clone first. */
export function setAt(menu: Menu, path: string, value: unknown): void {
  const [, kind, id, field] = path.split("/");
  if (kind === "items" && id && field && ITEM_FIELDS.has(field)) {
    const item = findItem(menu, id);
    if (!item) throw new OpError(`no item ${id}`);
    (item as unknown as Record<string, unknown>)[field] = structuredClone(value);
    return;
  }
  if (kind === "categories" && id) {
    const c = menu.categories.find((x) => x.id === id);
    if (!c) throw new OpError(`no category ${id}`);
    if (field === "hidden") {
      c.hidden = Boolean(value);
      return;
    }
    if (field === "itemOrder") {
      const order = value as string[];
      const byId = new Map(c.items.map((i) => [i.id, i]));
      if (order.length !== c.items.length || order.some((x) => !byId.has(x))) throw new OpError("item order mismatch");
      c.items = order.map((x) => byId.get(x)!);
      return;
    }
  }
  if (kind === "categoryOrder") {
    const order = value as string[];
    const byId = new Map(menu.categories.map((c) => [c.id, c]));
    if (order.length !== menu.categories.length || order.some((x) => !byId.has(x))) throw new OpError("category order mismatch");
    menu.categories = order.map((x) => byId.get(x)!);
    return;
  }
  if (kind === "restaurant" && id === "tagline") {
    menu.restaurant.tagline = value as string;
    return;
  }
  if (kind === "restaurant" && id === "hours") {
    menu.restaurant.hours = structuredClone(value) as Menu["restaurant"]["hours"];
    return;
  }
  throw new OpError(`path not editable: ${path}`);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function applyOps(menu: Menu, ops: Op[]): Menu {
  const next = structuredClone(menu);
  for (const op of ops) setAt(next, op.path, op.after);
  return next;
}

/**
 * Reverts ops in reverse order. Refuses (throws) if any path was changed by a
 * later edit, so an undo never silently clobbers newer work.
 */
export function revertOps(menu: Menu, ops: Op[]): Menu {
  const next = structuredClone(menu);
  for (const op of [...ops].reverse()) {
    if (!same(getAt(next, op.path), op.after)) {
      throw new OpError(`can't undo: ${op.path} was changed by a later edit`);
    }
    setAt(next, op.path, op.before);
  }
  return next;
}

/** Maps an op path to the data-edit-id attributes the site and preview render. */
export function editIdsForPath(path: string): string[] {
  const [, kind, id, field] = path.split("/");
  if (kind === "items") return [`item:${id}`, `item:${id}.${field === "dietaryTags" ? "tags" : field}`];
  if (kind === "categories") return [`category:${id}`];
  if (kind === "categoryOrder") return ["menu"];
  if (kind === "restaurant") return [`restaurant.${id}`];
  return [];
}
