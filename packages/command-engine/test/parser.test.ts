import { describe, expect, it } from "vitest";
import { match, normalizeUtterance, parse, parseDays, parseTime, score } from "../src/index.ts";
import { sample } from "./helpers.ts";

const menu = sample();
const cmds = (u: string) => {
  const r = parse(u, menu);
  if (r.kind !== "commands") throw new Error(`${u} -> ${JSON.stringify(r)}`);
  return r.commands;
};

describe("fuzzy matching", () => {
  it("tolerates speech-to-text misspellings and partial names", () => {
    expect(match(menu, "margarita").best?.id).toBe("margherita");
    expect(match(menu, "pepperoni").best?.id).toBe("hot-honey-pepperoni");
    expect(match(menu, "black bean burger").best?.id).toBe("veggie-burger");
    expect(match(menu, "desserts", "category").best?.id).toBe("desserts");
  });
  it("asks instead of guessing when names collide", () => {
    expect(match(menu, "caesar salad").ambiguous.map((a) => a.id).sort()).toEqual(["caesar", "caesar-2"]);
  });
  it("returns nothing for unrelated phrases", () => {
    expect(match(menu, "lobster thermidor").best).toBeUndefined();
    expect(score("", "x")).toBe(0);
  });
});

describe("deterministic parser", () => {
  it.each([
    ["Change the price of the margarita to $16.50", { cmd: "set_price", itemId: "margherita", price: 1650 }],
    ["make the truffle pie $18.50", { cmd: "set_price", itemId: "truffle-pie", price: 1850 }],
    ["wings are now 15 dollars", { cmd: "set_price", itemId: "wings", price: 1500 }],
    ["rename garlic knots to Garlic Butter Knots", { cmd: "rename_item", itemId: "garlic-knots", name: "Garlic Butter Knots" }],
    ["set the description of the wings to smoky wings with hot honey", { cmd: "set_description", itemId: "wings", text: "Smoky wings with hot honey." }],
    ["86 the burrata", { cmd: "hide_item", itemId: "burrata" }],
    ["tiramisu is sold out", { cmd: "hide_item", itemId: "tiramisu" }],
    ["bring back the tiramisu", { cmd: "show_item", itemId: "tiramisu" }],
    ["hide the desserts section", { cmd: "toggle_category", categoryId: "desserts", visible: false }],
    ["we're closed on mondays and tuesdays", { cmd: "set_hours", days: ["Mo", "Tu"], closed: true }],
    ["set hours on friday and saturday to 11am to 11pm", { cmd: "set_hours", days: ["Fr", "Sa"], opens: "11:00", closes: "23:00", closed: false }],
    ["on weekdays we're open 11:30 to 10", { cmd: "set_hours", days: ["Mo", "Tu", "We", "Th", "Fr"], opens: "11:30", closes: "22:00", closed: false }],
    ["mark the black bean burger as vegan", { cmd: "add_dietary_tag", itemId: "veggie-burger", tag: "vegan" }],
    ["the chicken sandwich contains dairy", { cmd: "add_dietary_tag", itemId: "chicken-sandwich", tag: "contains-dairy" }],
    ["remove the spicy tag from hot honey pepperoni", { cmd: "remove_dietary_tag", itemId: "hot-honey-pepperoni", tag: "spicy" }],
    ["change the tagline to Fired up since 2019", { cmd: "set_hero_text", text: "Fired up since 2019" }],
    ["move the tiramisu to the top", { cmd: "reorder", kind: "item", id: "tiramisu", to: "top" }],
    ["move salads above starters", { cmd: "reorder", kind: "category", id: "salads", to: "before", ref: "starters" }],
  ])("%s", (u, expected) => {
    expect(cmds(u)).toEqual([expected]);
  });

  it("strips fillers and politeness", () => {
    expect(normalizeUtterance("Um, okay, can you hide the wings please.")).toBe("hide the wings");
    expect(cmds("Hey, please 86 the wings!")).toEqual([{ cmd: "hide_item", itemId: "wings" }]);
  });

  it("splits chained requests into one atomic plan", () => {
    expect(cmds("hide the wings and then move tiramisu to the top").map((c) => c.cmd)).toEqual(["hide_item", "reorder"]);
  });

  it("recognizes meta commands", () => {
    expect(parse("undo that", menu)).toEqual({ kind: "meta", action: "undo" });
    expect(parse("publish", menu)).toEqual({ kind: "meta", action: "publish" });
    expect(parse("looks good", menu)).toEqual({ kind: "meta", action: "approve" });
    expect(parse("never mind", menu)).toEqual({ kind: "meta", action: "reject" });
  });

  it("clarifies collisions with options that re-run the request by id", () => {
    const r = parse("hide the caesar salad", menu);
    expect(r.kind).toBe("clarify");
    if (r.kind !== "clarify") return;
    expect(r.options.map((o) => o.utterance)).toEqual(expect.arrayContaining(["hide the caesar", "hide the caesar-2"]));
    expect(cmds("hide the caesar-2")).toEqual([{ cmd: "hide_item", itemId: "caesar-2" }]);
  });

  it("understands how owners say an item is sold out", () => {
    for (const u of ["We're out of the burrata", "we are out of burrata tonight", "Ran out of wings", "No more tiramisu today", "The wings are sold out tonight", "Hide the burrata for today"]) {
      const r = parse(u, menu);
      expect(r.kind, u).toBe("commands");
      if (r.kind === "commands") expect(r.commands[0]!.cmd, u).toBe("hide_item");
    }
  });

  it("returns none for requests outside the grammar (LLM fallback territory)", () => {
    for (const u of ["make the burgers a bit cheaper", "add a note that we have a patio", "hide the lobster"]) {
      expect(parse(u, menu).kind, u).toBe("none");
    }
  });

  it("parses days and times", () => {
    expect(parseDays("weekends")).toEqual(["Sa", "Su"]);
    expect(parseDays("monday through thursday")).toEqual(["Mo", "Tu", "We", "Th"]);
    expect(parseDays("someday")).toBeNull();
    expect(parseTime("10", true)).toBe("22:00");
    expect(parseTime("11", false)).toBe("11:00");
    expect(parseTime("noon", false)).toBe("12:00");
    expect(parseTime("9:30 p.m.", false)).toBe("21:30");
    expect(parseTime("25", false)).toBeNull();
  });
});

describe("relative prices", () => {
  it("parses raises, cuts and knock-offs as adjust_price (code does the math)", () => {
    expect(cmds("raise the wings by $1")).toEqual([{ cmd: "adjust_price", itemId: "wings", deltaCents: 100 }]);
    expect(cmds("lower the price of margherita by $1.50")).toEqual([{ cmd: "adjust_price", itemId: "margherita", deltaCents: -150 }]);
    expect(cmds("knock $2 off the smash burger")).toEqual([{ cmd: "adjust_price", itemId: "smash-burger", deltaCents: -200 }]);
  });
});

describe("click-to-target (selected item or section as context)", () => {
  const item = { target: { kind: "item" as const, id: "margherita" } };
  const one = (u: string, ctx = item) => {
    const r = parse(u, menu, ctx);
    if (r.kind !== "commands") throw new Error(`expected commands for "${u}", got ${r.kind}`);
    expect(r.commands).toHaveLength(1);
    return r.commands[0];
  };

  it("resolves pronouns to the selected item", () => {
    expect(one("make this $14")).toEqual({ cmd: "set_price", itemId: "margherita", price: 1400 });
    expect(one("change the price of it to $13")).toEqual({ cmd: "set_price", itemId: "margherita", price: 1300 });
    expect(one("hide this")).toEqual({ cmd: "hide_item", itemId: "margherita" });
    expect(one("move this before the burrata")).toEqual({ cmd: "reorder", kind: "item", id: "margherita", to: "before", ref: "burrata" });
  });

  it("accepts bare commands when something is selected", () => {
    expect(one("$14")).toEqual({ cmd: "set_price", itemId: "margherita", price: 1400 });
    expect(one("14.50")).toEqual({ cmd: "set_price", itemId: "margherita", price: 1450 });
    expect(one("86")).toEqual({ cmd: "hide_item", itemId: "margherita" });
    expect(one("sold out")).toEqual({ cmd: "hide_item", itemId: "margherita" });
    expect(one("it's back")).toEqual({ cmd: "show_item", itemId: "margherita" });
    expect(one("raise by $1")).toEqual({ cmd: "adjust_price", itemId: "margherita", deltaCents: 100 });
    expect(one("rename to Classic Margherita")).toEqual({ cmd: "rename_item", itemId: "margherita", name: "Classic Margherita" });
    expect(one("mark as vegan")).toEqual({ cmd: "add_dietary_tag", itemId: "margherita", tag: "vegan" });
    expect(one("move to the top")).toEqual({ cmd: "reorder", kind: "item", id: "margherita", to: "top" });
  });

  it("handles owner phrasing with a selection: rename this, out of this, hide it tonight", () => {
    expect(one("rename this to Classic Margherita")).toEqual({ cmd: "rename_item", itemId: "margherita", name: "Classic Margherita" });
    expect(one("call it Classic Margherita")).toEqual({ cmd: "rename_item", itemId: "margherita", name: "Classic Margherita" });
    expect(one("we're out of this")).toEqual({ cmd: "hide_item", itemId: "margherita" });
    expect(one("hide this for today")).toEqual({ cmd: "hide_item", itemId: "margherita" });
    // A named item still wins: this is not "rename the selection to 'the wings to X'".
    expect(one("rename the wings to Hot Wings")).toEqual({ cmd: "rename_item", itemId: "wings", name: "Hot Wings" });
  });

  it("still lets a named item win over the selection", () => {
    expect(one("86 the burrata")).toEqual({ cmd: "hide_item", itemId: "burrata" });
  });

  it("works for a selected section", () => {
    expect(one("hide this", { target: { kind: "category", id: "salads" } } as never)).toEqual({ cmd: "toggle_category", categoryId: "salads", visible: false });
  });

  it("ignores pronouns and bare commands without a valid selection", () => {
    expect(parse("make this $14", menu).kind).toBe("none");
    expect(parse("$14", menu).kind).toBe("none");
    expect(parse("$14", menu, { target: { kind: "item", id: "no-such-item" } }).kind).toBe("none");
    // An item-only command can't apply to a selected section.
    expect(parse("make this $14", menu, { target: { kind: "category", id: "salads" } }).kind).toBe("none");
  });
});
