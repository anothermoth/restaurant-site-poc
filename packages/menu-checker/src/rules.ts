import { allItems, formatPrice, type Menu } from "@restaurant-site-poc/menu-schema";
import type { Finding } from "./types.ts";

export interface Rule {
  id: string;
  description: string;
  run(menu: Menu): Finding[];
}

const MIN_DESCRIPTION = 25;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SMALL_WORDS = new Set(["a", "an", "and", "of", "the", "with", "on", "in", "or", "&"]);

export function titleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/(^|-)(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase())))
    .join(" ");
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export const missingDescription: Rule = {
  id: "missing-description",
  description: "Items need a description that sells the dish; empty or very short ones convert worse.",
  run(menu) {
    return allItems(menu).flatMap(({ item, category }): Finding[] => {
      const d = item.description.trim();
      if (d.length === 0) {
        return [{
          ruleId: this.id, severity: "warning", source: "rule",
          message: `"${item.name}" has no description.`,
          target: { categoryId: category.id, itemId: item.id },
          suggestion: "Add 1-2 sentences: main ingredients, how it's cooked, and what it's served with.",
        } satisfies Finding];
      }
      if (d.length < MIN_DESCRIPTION) {
        return [{
          ruleId: this.id, severity: "info", source: "rule",
          message: `"${item.name}" has a very short description (${d.length} chars).`,
          target: { categoryId: category.id, itemId: item.id },
          suggestion: "Expand it with ingredients and preparation.",
        } satisfies Finding];
      }
      return [];
    });
  },
};

export const missingPhoto: Rule = {
  id: "missing-photo",
  description: "Items without a photo get skipped by hungry guests.",
  run(menu) {
    return allItems(menu)
      .filter(({ item }) => !item.photo)
      .map(({ item, category }) => ({
        ruleId: this.id, severity: "warning", source: "rule",
        message: `"${item.name}" has no photo.`,
        target: { categoryId: category.id, itemId: item.id },
        suggestion: "Add a well-lit photo, at least 480x360.",
      }));
  },
};

/**
 * Flags prices far from the category median. Uses a ratio band rather than
 * standard deviation because categories are small (3-10 items) and a single
 * typo like 18500 for 1850 would drag a mean-based threshold with it.
 */
export const priceOutlier: Rule = {
  id: "price-outlier",
  description: "A price far from the rest of its category is usually a typo (a missing decimal).",
  run(menu) {
    const findings: Finding[] = [];
    const HIGH = 4;
    const LOW = 0.25;
    for (const category of menu.categories) {
      if (category.items.length < 3) continue;
      // Median of the whole category: with 3+ items a single typo can't move it.
      const m = median(category.items.map((i) => i.price));
      if (m === 0) continue;
      for (const item of category.items) {
        const ratio = item.price / m;
        if (ratio < HIGH && ratio > LOW) continue;
        let suggestion = `Category median is ${formatPrice(m, menu.currency)}. Confirm the price.`;
        for (const factor of [10, 100]) {
          const candidate = ratio >= HIGH ? item.price / factor : item.price * factor;
          const r = candidate / m;
          if (r < HIGH && r > LOW) {
            suggestion = `Looks like a decimal slip: did you mean ${formatPrice(candidate, menu.currency)}? Category median is ${formatPrice(m, menu.currency)}.`;
            break;
          }
        }
        findings.push({
          ruleId: this.id, severity: "error", source: "rule",
          message: `"${item.name}" is ${formatPrice(item.price, menu.currency)}, ${ratio >= HIGH ? `${ratio.toFixed(1)}x above` : `${(1 / ratio).toFixed(1)}x below`} the ${category.name} median.`,
          target: { categoryId: category.id, itemId: item.id },
          suggestion,
        });
      }
    }
    return findings;
  },
};

export const duplicateItem: Rule = {
  id: "duplicate-item",
  description: "The same dish listed twice splits orders and confuses guests.",
  run(menu) {
    const byName = new Map<string, Array<{ itemId: string; categoryId: string; name: string }>>();
    for (const { item, category } of allItems(menu)) {
      const key = normalizeName(item.name);
      const list = byName.get(key) ?? [];
      list.push({ itemId: item.id, categoryId: category.id, name: item.name });
      byName.set(key, list);
    }
    const findings: Finding[] = [];
    for (const list of byName.values()) {
      if (list.length < 2) continue;
      const [first, ...rest] = list;
      for (const dup of rest) {
        findings.push({
          ruleId: this.id, severity: "warning", source: "rule",
          message: `"${dup.name}" (${dup.itemId}) duplicates "${first!.name}" (${first!.itemId}).`,
          target: { categoryId: dup.categoryId, itemId: dup.itemId },
          suggestion: "Merge them into one item, or rename one if they really differ.",
        });
      }
    }
    return findings;
  },
};

export const emptyModifierGroup: Rule = {
  id: "empty-modifier-group",
  description: "A modifier group with no options renders an empty picker (and blocks checkout if required).",
  run(menu) {
    return menu.modifierGroups
      .filter((g) => g.options.length === 0)
      .map((g) => {
        const usedBy = allItems(menu).filter(({ item }) => item.modifierGroupIds.includes(g.id)).map(({ item }) => item.name);
        const blocking = g.minSelect > 0 && usedBy.length > 0;
        return {
          ruleId: this.id,
          severity: blocking ? "error" : "warning",
          source: "rule",
          message: `Modifier group "${g.name}" has no options${usedBy.length ? ` but is attached to ${usedBy.map((n) => `"${n}"`).join(", ")}` : ""}.${blocking ? " Guests can't check out these items." : ""}`,
          target: { modifierGroupId: g.id },
          suggestion: "Add options, or remove the group. Auto-fix removes it and detaches it from items.",
          fix: { kind: "remove-modifier-group", modifierGroupId: g.id },
        } satisfies Finding;
      });
  },
};

export const inconsistentNaming: Rule = {
  id: "inconsistent-naming",
  description: "Names should share one casing style and have no stray whitespace.",
  run(menu) {
    const findings: Finding[] = [];
    for (const { item, category } of allItems(menu)) {
      const letters = item.name.replace(/[^\p{L}]/gu, "");
      const issues: string[] = [];
      if (item.name !== item.name.trim() || /\s{2,}/.test(item.name)) issues.push("extra whitespace");
      if (letters.length > 3 && letters === letters.toUpperCase()) issues.push("ALL CAPS");
      else if (letters.length > 0 && letters === letters.toLowerCase()) issues.push("all lowercase");
      if (issues.length === 0) continue;
      const to = titleCase(item.name);
      if (to === item.name) continue;
      findings.push({
        ruleId: this.id, severity: "info", source: "rule",
        message: `"${item.name}" uses ${issues.join(" and ")}; the rest of the menu is Title Case.`,
        target: { categoryId: category.id, itemId: item.id },
        suggestion: `Rename to "${to}".`,
        fix: { kind: "rename-item", itemId: item.id, to },
      });
    }
    return findings;
  },
};

/**
 * Dietary and allergen tags are a safety claim, so this rule never auto-fixes:
 * it only asks a human to confirm. Hints come from obvious keywords.
 */
const MEAT = /\b(beef|chicken|pork|bacon|sausage|pepperoni|anchov|fish|shrimp|wings?|ham|steak|turkey)\b/i;
const DAIRY = /\b(cheese|mozzarella|parmesan|cream|butter|buttermilk|gelato|burrata|fontina|mascarpone|milk)\b/i;
const GLUTEN = /\b(bun|bread|sourdough|crouton|dough|crust|ladyfinger|flour|pasta)s?\b/i;

export const missingDietaryTags: Rule = {
  id: "missing-dietary-tags",
  description: "Guests filter by diet and allergens; untagged items are invisible to them.",
  run(menu) {
    return allItems(menu)
      .filter(({ item }) => item.dietaryTags.length === 0)
      .map(({ item, category }) => {
        const text = `${item.name} ${item.description}`;
        const hints: string[] = [];
        if (DAIRY.test(text)) hints.push("contains-dairy");
        if (GLUTEN.test(text)) hints.push("contains-gluten");
        if (!MEAT.test(text) && text.trim().length > item.name.length) hints.push("vegetarian?");
        return {
          ruleId: this.id, severity: "warning", source: "rule",
          message: `"${item.name}" has no dietary or allergen tags.`,
          target: { categoryId: category.id, itemId: item.id },
          suggestion: hints.length
            ? `Confirm with the kitchen. The description suggests: ${hints.join(", ")}.`
            : "Confirm tags with the kitchen (not auto-fixed: allergen info must come from a person).",
        } satisfies Finding;
      });
  },
};

export const unusedModifierGroup: Rule = {
  id: "unused-modifier-group",
  description: "Modifier groups nobody uses are clutter in the editor.",
  run(menu) {
    const used = new Set(allItems(menu).flatMap(({ item }) => item.modifierGroupIds));
    return menu.modifierGroups
      .filter((g) => !used.has(g.id))
      .map((g) => ({
        ruleId: this.id, severity: "info", source: "rule",
        message: `Modifier group "${g.name}" is not attached to any item.`,
        target: { modifierGroupId: g.id },
        suggestion: "Attach it to an item or delete it.",
      }));
  },
};

export const ALL_RULES: Rule[] = [
  priceOutlier,
  emptyModifierGroup,
  duplicateItem,
  missingDescription,
  missingPhoto,
  missingDietaryTags,
  inconsistentNaming,
  unusedModifierGroup,
];
