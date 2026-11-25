import { readFileSync } from "node:fs";
import sample from "../../../../data/sample-restaurant.menu.json";
import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import { applySafeFixes, checkMenu, type Report } from "@restaurant-site-poc/menu-checker";

/**
 * Build-time publish pipeline:
 *   validate (zod) -> deterministic checks -> apply safe auto-fixes -> render.
 * Anything not safe to fix (prices, duplicates, allergen tags) is published as-is
 * and surfaced on /admin/report for the owner to decide.
 */
// MENU_PATH (a file, used by the local Express publish step) or MENU_URL (the API's
// /published.json, used by a hosted build hook) rebuild the site from the published menu.
async function loadMenu(): Promise<unknown> {
  if (process.env.MENU_PATH) return JSON.parse(readFileSync(process.env.MENU_PATH, "utf8"));
  if (process.env.MENU_URL) {
    const res = await fetch(process.env.MENU_URL);
    if (!res.ok) throw new Error(`MENU_URL returned HTTP ${res.status}`);
    return res.json();
  }
  return sample;
}
const raw = await loadMenu();
export const sourceMenu: Menu = parseMenu(raw);
export const reportBeforeFixes: Report = checkMenu(sourceMenu);
const fixed = applySafeFixes(sourceMenu, reportBeforeFixes.findings);
export const menu: Menu = fixed.menu;
export const appliedFixes = fixed.applied;
export const reportAfterFixes: Report = checkMenu(menu);

/** Just what the cart island needs to price orders, so the serialized props stay small. */
export const cartMenu: Menu = {
  ...menu,
  restaurant: { ...menu.restaurant, heroPhoto: undefined, hours: [] },
  categories: menu.categories.map((c) => ({
    ...c,
    description: undefined,
    items: c.items.map((i) => ({ ...i, description: "", photo: undefined, dietaryTags: [] })),
  })),
};
