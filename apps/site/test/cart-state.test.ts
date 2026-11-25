import { describe, expect, it } from "vitest";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { cartReducer, lineKey, priceLines } from "../src/lib/cart-state.ts";
import { baseMenu } from "../../../packages/menu-schema/test/fixtures.ts";

const menu = parseMenu(baseMenu());

describe("cart state", () => {
  it("builds stable keys regardless of option order", () => {
    expect(lineKey("burger", { extras: ["bacon", "cheese"], size: ["large"] })).toBe(lineKey("burger", { size: ["large"], extras: ["cheese", "bacon"] }));
    expect(lineKey("salad")).toBe("salad");
    expect(lineKey("salad", { extras: [] })).toBe("salad");
  });

  it("merges identical lines and keeps different customizations apart", () => {
    let s = cartReducer([], { type: "add", itemId: "burger", selections: { size: ["small"] } });
    s = cartReducer(s, { type: "add", itemId: "burger", selections: { size: ["small"] } });
    s = cartReducer(s, { type: "add", itemId: "burger", selections: { size: ["large"] } });
    expect(s.map((l) => l.quantity)).toEqual([2, 1]);
  });

  it("removes a line at zero and caps quantity", () => {
    let s = cartReducer([], { type: "add", itemId: "salad" });
    s = cartReducer(s, { type: "setQty", key: "salad", quantity: 999 });
    expect(s[0]!.quantity).toBe(50);
    s = cartReducer(s, { type: "setQty", key: "salad", quantity: 0 });
    expect(s).toEqual([]);
  });

  it("prices from the menu and drops stale lines", () => {
    const lines = [
      { key: "a", itemId: "salad", quantity: 2 },
      { key: "b", itemId: "deleted-item", quantity: 1 },
      { key: "c", itemId: "burger", quantity: 1, selections: { size: ["large"] } },
    ];
    const priced = priceLines(menu, lines);
    expect(priced.lines.map((l) => l.key)).toEqual(["a", "c"]);
    expect(priced.subtotal).toBe(2 * 1000 + 1500);
  });
});
