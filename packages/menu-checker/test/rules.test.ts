import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseMenu, type MenuInput } from "@restaurant-site-poc/menu-schema";
import { applySafeFixes, checkMenu, median, normalizeName, runRules, titleCase } from "../src/index.ts";
import { baseMenu } from "../../menu-schema/test/fixtures.ts";

const ids = (m: MenuInput) => runRules(parseMenu(m)).map((f) => `${f.ruleId}:${f.target.itemId ?? f.target.modifierGroupId}`);

describe("helpers", () => {
  it("normalizes names for duplicate matching", () => {
    expect(normalizeName("  Mac & Cheese!! ")).toBe("mac and cheese");
  });
  it("title-cases names, keeping small words lower", () => {
    expect(titleCase("  SAUSAGE  &  FENNEL ")).toBe("Sausage & Fennel");
    expect(titleCase("pizza of the day")).toBe("Pizza of the Day");
    expect(titleCase("wood-fired wings")).toBe("Wood-Fired Wings");
  });
  it("computes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("rules", () => {
  it("a clean menu has no findings", () => {
    expect(runRules(parseMenu(baseMenu()))).toEqual([]);
  });

  it("flags a missing or short description", () => {
    const m = baseMenu();
    m.categories[0]!.items[0]!.description = "";
    m.categories[0]!.items[1]!.description = "Greens.";
    const f = runRules(parseMenu(m)).filter((x) => x.ruleId === "missing-description");
    expect(f.map((x) => [x.target.itemId, x.severity])).toEqual([["burger", "warning"], ["salad", "info"]]);
  });

  it("flags a missing photo", () => {
    const m = baseMenu();
    delete m.categories[0]!.items[2]!.photo;
    expect(ids(m)).toEqual(["missing-photo:soup"]);
  });

  it("flags a decimal-slip price and suggests the likely price", () => {
    const m = baseMenu();
    m.categories[0]!.items[1]!.price = 10000;
    const [f] = runRules(parseMenu(m));
    expect(f!.ruleId).toBe("price-outlier");
    expect(f!.severity).toBe("error");
    expect(f!.suggestion).toContain("$10.00");
    expect(f!.fix).toBeUndefined();
  });

  it("flags a suspiciously cheap price", () => {
    const m = baseMenu();
    m.categories[0]!.items[2]!.price = 99;
    expect(ids(m)).toEqual(["price-outlier:soup"]);
  });

  it("skips price checks for tiny categories", () => {
    const m = baseMenu();
    m.categories[0]!.items = m.categories[0]!.items.slice(0, 2);
    m.categories[0]!.items[1]!.price = 99999;
    expect(ids(m)).toEqual([]);
  });

  it("flags duplicates regardless of case and punctuation", () => {
    const m = baseMenu();
    m.categories[0]!.items[2]!.name = "garden  salad!";
    expect(ids(m)).toContain("duplicate-item:soup");
  });

  it("flags empty modifier groups as errors when they block checkout", () => {
    const m = baseMenu();
    m.modifierGroups!.push({ id: "sauce", name: "Sauce", minSelect: 1, maxSelect: 1, options: [] });
    m.categories[0]!.items[1]!.modifierGroupIds = ["sauce"];
    const [f] = runRules(parseMenu(m));
    expect(f).toMatchObject({ ruleId: "empty-modifier-group", severity: "error", fix: { kind: "remove-modifier-group" } });
  });

  it("flags inconsistent casing with a safe rename fix", () => {
    const m = baseMenu();
    m.categories[0]!.items[2]!.name = "TOMATO SOUP";
    const [f] = runRules(parseMenu(m));
    expect(f).toMatchObject({ ruleId: "inconsistent-naming", fix: { kind: "rename-item", itemId: "soup", to: "Tomato Soup" } });
  });

  it("flags missing dietary tags with keyword hints but no auto-fix", () => {
    const m = baseMenu();
    m.categories[0]!.items[2]!.dietaryTags = [];
    const [f] = runRules(parseMenu(m));
    expect(f!.ruleId).toBe("missing-dietary-tags");
    expect(f!.suggestion).toContain("contains-dairy");
    expect(f!.suggestion).toContain("vegetarian?");
    expect(f!.fix).toBeUndefined();
  });

  it("flags unused modifier groups", () => {
    const m = baseMenu();
    m.categories[0]!.items[0]!.modifierGroupIds = ["size"];
    expect(ids(m)).toEqual(["unused-modifier-group:extras"]);
  });
});

describe("report and auto-fix on the sample restaurant", () => {
  const menu = parseMenu(JSON.parse(readFileSync(new URL("../../../data/sample-restaurant.menu.json", import.meta.url), "utf8")));
  const report = checkMenu(menu);

  it("finds the seeded problems", () => {
    const rules = new Set(report.findings.map((f) => f.ruleId));
    for (const r of ["price-outlier", "empty-modifier-group", "duplicate-item", "missing-description", "missing-photo", "missing-dietary-tags", "inconsistent-naming"]) {
      expect(rules, r).toContain(r);
    }
    expect(report.summary.error).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });

  it("applies only safe fixes and leaves prices and tags alone", () => {
    const { menu: fixed, applied } = applySafeFixes(menu, report.findings);
    expect(applied.length).toBe(report.summary.autoFixable);
    expect(fixed.modifierGroups.find((g) => g.id === "dressing")).toBeUndefined();
    const names = fixed.categories.flatMap((c) => c.items.map((i) => i.name));
    expect(names).toContain("Garlic Knots");
    // prices untouched
    expect(fixed.categories.flatMap((c) => c.items.map((i) => i.price))).toEqual(menu.categories.flatMap((c) => c.items.map((i) => i.price)));
    // input not mutated
    expect(menu.modifierGroups.find((g) => g.id === "dressing")).toBeDefined();
    // re-checking shows the fixed issues are gone
    const after = checkMenu(fixed);
    expect(after.summary.autoFixable).toBe(0);
    expect(after.score).toBeGreaterThan(report.score);
  });
});
