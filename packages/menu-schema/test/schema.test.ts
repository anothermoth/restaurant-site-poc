import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CartError, formatPrice, parseMenu, priceCart, safeParseMenu } from "../src/index.ts";
import { baseMenu } from "./fixtures.ts";
import { allergenLine, dietWords, featureItem, menuPrice } from "../src/display.ts";

describe("menu schema", () => {
  it("parses the sample restaurant shipped in data/", () => {
    const json = JSON.parse(readFileSync(new URL("../../../data/sample-restaurant.menu.json", import.meta.url), "utf8"));
    const menu = parseMenu(json);
    expect(menu.restaurant.isSampleData).toBe(true);
    expect(menu.categories.length).toBeGreaterThan(3);
  });

  it("applies defaults", () => {
    const menu = parseMenu(baseMenu());
    expect(menu.currency).toBe("USD");
    expect(menu.categories[0]!.items[0]!.available).toBe(true);
    expect(menu.modifierGroups[1]!.minSelect).toBe(0);
  });

  it("rejects float prices", () => {
    const m = baseMenu();
    m.categories[0]!.items[0]!.price = 12.5;
    expect(safeParseMenu(m).success).toBe(false);
  });

  it("rejects duplicate item ids and unknown modifier groups", () => {
    const m = baseMenu();
    m.categories[0]!.items[1]!.id = "burger";
    m.categories[0]!.items[2]!.modifierGroupIds = ["nope"];
    const r = safeParseMenu(m);
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message);
    expect(messages).toContain('duplicate item id "burger"');
    expect(messages).toContain('unknown modifier group "nope"');
  });

  it("rejects unknown dietary tags", () => {
    const m = baseMenu();
    (m.categories[0]!.items[0]!.dietaryTags as string[]) = ["keto"];
    expect(safeParseMenu(m).success).toBe(false);
  });

  it("formats cents as currency", () => {
    expect(formatPrice(1850)).toBe("$18.50");
  });
});

describe("priceCart", () => {
  const menu = parseMenu(baseMenu());

  it("prices items and modifiers from the menu", () => {
    const { lines, subtotal } = priceCart(menu, [
      { itemId: "burger", quantity: 2, selections: { size: ["large"], extras: ["cheese", "bacon"] } },
      { itemId: "salad", quantity: 1 },
    ]);
    expect(lines[0]!.unitPrice).toBe(1200 + 300 + 100 + 200);
    expect(lines[0]!.optionNames).toEqual(["Large", "Cheese", "Bacon"]);
    expect(subtotal).toBe(1800 * 2 + 1000);
  });

  it("enforces required modifier groups", () => {
    expect(() => priceCart(menu, [{ itemId: "burger", quantity: 1 }])).toThrow(CartError);
  });

  it("rejects unknown items, options, groups and bad quantities", () => {
    expect(() => priceCart(menu, [{ itemId: "nope", quantity: 1 }])).toThrow(/unknown item/);
    expect(() => priceCart(menu, [{ itemId: "burger", quantity: 1, selections: { size: ["xl"] } }])).toThrow(/unknown option/);
    expect(() => priceCart(menu, [{ itemId: "salad", quantity: 1, selections: { size: ["small"] } }])).toThrow(/no modifier group/);
    expect(() => priceCart(menu, [{ itemId: "salad", quantity: 0 }])).toThrow(/bad quantity/);
    expect(() => priceCart(menu, [{ itemId: "salad", quantity: 1.5 }])).toThrow(/bad quantity/);
  });

  it("rejects too many choices", () => {
    expect(() =>
      priceCart(menu, [{ itemId: "burger", quantity: 1, selections: { size: ["small", "large"] } }]),
    ).toThrow(/needs 1-1/);
  });
});

describe("display helpers", () => {
  it("formats prices like a printed menu", () => {
    expect(menuPrice(1400)).toBe("14");
    expect(menuPrice(950)).toBe("9.50");
    expect(menuPrice(18550)).toBe("185.50");
  });
  it("turns tags into plain words", () => {
    expect(dietWords(["vegetarian", "spicy", "contains-dairy"])).toEqual(["Vegetarian", "Spicy"]);
    expect(dietWords(["vegan", "vegetarian", "gluten-free"])).toEqual(["Vegan", "Gluten-free"]);
    expect(allergenLine(["contains-dairy"])).toBe("Contains dairy");
    expect(allergenLine(["contains-dairy", "contains-gluten"])).toBe("Contains dairy & gluten");
    expect(allergenLine(["contains-dairy", "contains-gluten", "contains-nuts"])).toBe("Contains dairy, gluten & nuts");
    expect(allergenLine(["vegan"])).toBeNull();
  });
  it("picks the first shown item with a photo as the section feature", () => {
    const p = { src: "/photos/a.jpg", alt: "a" };
    expect(featureItem([{ available: true }, { available: false, photo: p }, { available: true, photo: p, id: "x" }] as never[])).toMatchObject({ id: "x" });
    expect(featureItem([{ available: true }] as never[])).toBeUndefined();
  });
});
