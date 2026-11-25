// Zod-free display helpers shared by the public site and the editor preview, so both
// show a dish the same way: plain-word dietary notes, menu-style prices, one feature photo per section.
import type { DietaryTag, MenuItem } from "./index.ts";

const DIET: Partial<Record<DietaryTag, string>> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  "gluten-free": "Gluten-free",
  "dairy-free": "Dairy-free",
  "nut-free": "Nut-free",
  spicy: "Spicy",
};

/** Menu-card price: "14" or "9.50", the way printed menus set it (the cart and JSON-LD keep full currency). */
export function menuPrice(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Dietary tags as plain words. "Vegan" makes "Vegetarian" redundant, so it is dropped. */
export function dietWords(tags: readonly string[]): string[] {
  const words = tags.filter((t) => t in DIET && !(t === "vegetarian" && tags.includes("vegan"))).map((t) => DIET[t as DietaryTag]!);
  return [...new Set(words)];
}

/** "Contains dairy & gluten" / "Contains dairy, gluten & nuts", or null. */
export function allergenLine(tags: readonly string[]): string | null {
  const a = tags.filter((t) => t.startsWith("contains-")).map((t) => t.slice("contains-".length));
  if (!a.length) return null;
  return `Contains ${a.length === 1 ? a[0] : `${a.slice(0, -1).join(", ")} & ${a.at(-1)}`}`;
}

/** The photo that represents a section: the first shown item that has one. */
export function featureItem<T extends Pick<MenuItem, "photo" | "available">>(items: readonly T[]): T | undefined {
  return items.find((i) => i.available && i.photo);
}
