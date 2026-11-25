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
// MENU_PATH lets the API's publish step rebuild the site from the published menu.
const raw: unknown = process.env.MENU_PATH ? JSON.parse(readFileSync(process.env.MENU_PATH, "utf8")) : sample;
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
