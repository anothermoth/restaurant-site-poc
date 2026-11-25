import { describe, expect, it } from "vitest";
import { CommandError, compile, editIdsForPath, revertOps, updateHours } from "../src/index.ts";
import { sample } from "./helpers.ts";

const menu = sample();
const find = (m: typeof menu, id: string) => m.categories.flatMap((c) => c.items).find((i) => i.id === id)!;

describe("compile", () => {
  it("produces reversible ops, a summary, and a validated menu", () => {
    const c = compile(menu, [{ cmd: "set_price", itemId: "margherita", price: 1650 }]);
    expect(c.ops).toEqual([{ path: "/items/margherita/price", before: 1500, after: 1650 }]);
    expect(c.summary).toEqual(["Margherita: price $15.00 → $16.50"]);
    expect(find(c.menu, "margherita").price).toBe(1650);
    expect(find(menu, "margherita").price).toBe(1500); // input untouched
  });

  it("marks prices and allergen tags as high risk", () => {
    expect(compile(menu, [{ cmd: "set_price", itemId: "wings", price: 1500 }]).risk).toBe("high");
    expect(compile(menu, [{ cmd: "add_dietary_tag", itemId: "wings", tag: "spicy" }]).risk).toBe("high");
    expect(compile(menu, [{ cmd: "hide_item", itemId: "wings" }]).risk).toBe("low");
  });

  it("reports checker findings the change resolves or introduces", () => {
    const fixed = compile(menu, [{ cmd: "set_price", itemId: "truffle-pie", price: 1850 }]);
    expect(fixed.findings.resolved.map((f) => f.ruleId)).toContain("price-outlier");
    const broken = compile(menu, [{ cmd: "set_price", itemId: "margherita", price: 99900 }]);
    expect(broken.findings.added.map((f) => f.ruleId)).toContain("price-outlier");
  });

  it("is atomic: one bad command rejects the whole plan", () => {
    expect(() =>
      compile(menu, [
        { cmd: "hide_item", itemId: "wings" },
        { cmd: "set_price", itemId: "does-not-exist", price: 100 },
      ]),
    ).toThrow(CommandError);
  });

  it("rejects markup, unknown commands, bad ids and no-ops", () => {
    expect(() => compile(menu, [{ cmd: "rename_item", itemId: "wings", name: "<script>x</script>" }])).toThrow(/plain text/);
    expect(() => compile(menu, [{ cmd: "set_hero_text", text: "a {color:red}" }])).toThrow(/plain text/);
    expect(() => compile(menu, [{ cmd: "set_css", selector: "body" }])).toThrow(/Invalid command/);
    expect(() => compile(menu, [{ cmd: "hide_item", itemId: "../etc" }])).toThrow(/Invalid command/);
    expect(() => compile(menu, [{ cmd: "show_item", itemId: "wings" }])).toThrow(/No change/);
    expect(() => compile(menu, [])).toThrow(/No commands/);
  });

  it("rejects closing before opening", () => {
    expect(() => compile(menu, [{ cmd: "set_hours", days: ["Mo"], opens: "22:00", closes: "11:00" }])).toThrow(/after opening/);
  });

  it("reorders items within their category and sections overall", () => {
    const c = compile(menu, [{ cmd: "reorder", kind: "item", id: "tiramisu", to: "top" }]);
    expect(c.menu.categories.find((x) => x.id === "desserts")!.items[0]!.id).toBe("tiramisu");
    const s = compile(menu, [{ cmd: "reorder", kind: "category", id: "salads", to: "before", ref: "starters" }]);
    expect(s.menu.categories.map((x) => x.id)[0]).toBe("salads");
    expect(() => compile(menu, [{ cmd: "reorder", kind: "item", id: "tiramisu", to: "before", ref: "margherita" }])).toThrow(/same list/);
  });
});

describe("hours", () => {
  it("regroups consecutive days with the same hours", () => {
    const out = updateHours(menu.restaurant.hours, ["Mo"], { opens: "11:00", closes: "21:00" });
    expect(out[0]).toEqual({ days: ["Mo", "Tu", "We", "Th"], opens: "11:00", closes: "21:00" });
    expect(updateHours(out, ["Su"], null).flatMap((h) => h.days)).not.toContain("Su");
  });
});

describe("undo", () => {
  it("reverts ops and refuses when a later edit touched the same path", () => {
    const a = compile(menu, [{ cmd: "set_price", itemId: "wings", price: 1500 }]);
    expect(find(revertOps(a.menu, a.ops), "wings").price).toBe(1400);
    const b = compile(a.menu, [{ cmd: "set_price", itemId: "wings", price: 1600 }]);
    expect(() => revertOps(b.menu, a.ops)).toThrow(/later edit/);
  });

  it("maps ops to data-edit-id targets for the preview highlight", () => {
    expect(editIdsForPath("/items/wings/price")).toEqual(["item:wings", "item:wings.price"]);
    expect(editIdsForPath("/restaurant/hours")).toEqual(["restaurant.hours"]);
  });
});

describe("adjust_price and no-op tolerance", () => {
  it("computes relative prices from the live menu", () => {
    const c = compile(menu, [{ cmd: "adjust_price", itemId: "smash-burger", deltaCents: -100 }]);
    expect(c.ops[0]).toEqual({ path: "/items/smash-burger/price", before: 1500, after: 1400 });
    expect(c.risk).toBe("high");
    expect(() => compile(menu, [{ cmd: "adjust_price", itemId: "smash-burger", deltaCents: -9999 }])).toThrow(/below \$0/);
  });
  it("skips commands that are already true when others do real work", () => {
    const c = compile(menu, [
      { cmd: "add_dietary_tag", itemId: "market-greens", tag: "gluten-free" },
      { cmd: "add_dietary_tag", itemId: "market-greens", tag: "nut-free" },
    ]);
    expect(c.ops).toHaveLength(1);
    expect(c.summary[1]).toMatch(/skipped, already so/);
    expect(() => compile(menu, [{ cmd: "add_dietary_tag", itemId: "market-greens", tag: "vegan" }])).toThrow(/No change/);
  });
});
