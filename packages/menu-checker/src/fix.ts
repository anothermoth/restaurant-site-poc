import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import type { Finding, FixAction } from "./types.ts";

export interface FixResult {
  menu: Menu;
  applied: FixAction[];
}

/**
 * Applies only the fixes rules marked as safe: renames for casing/whitespace
 * and removing empty modifier groups. Prices, duplicates and dietary tags are
 * left for a person. Returns a new menu; the input is not mutated.
 */
export function applySafeFixes(menu: Menu, findings: Finding[]): FixResult {
  const next: Menu = structuredClone(menu);
  const applied: FixAction[] = [];
  for (const f of findings) {
    const fix = f.fix;
    if (!fix || f.source !== "rule") continue;
    if (fix.kind === "rename-item") {
      for (const c of next.categories) {
        const item = c.items.find((i) => i.id === fix.itemId);
        if (item && item.name !== fix.to) {
          item.name = fix.to;
          applied.push(fix);
        }
      }
    } else if (fix.kind === "remove-modifier-group") {
      const before = next.modifierGroups.length;
      next.modifierGroups = next.modifierGroups.filter((g) => g.id !== fix.modifierGroupId);
      if (next.modifierGroups.length === before) continue;
      for (const c of next.categories) {
        for (const i of c.items) i.modifierGroupIds = i.modifierGroupIds.filter((id) => id !== fix.modifierGroupId);
      }
      applied.push(fix);
    }
  }
  // Re-validate so a fix can never produce an invalid menu.
  return { menu: parseMenu(next), applied };
}
