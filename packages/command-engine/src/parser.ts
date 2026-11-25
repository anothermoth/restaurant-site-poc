import type { DietaryTag, Menu } from "@restaurant-site-poc/menu-schema";
import type { Command, Day, MetaAction } from "./commands.ts";
import { match, type Target } from "./match.ts";

/** A clarify choice. `utterance` re-runs the request with the exact id, so picking one is free. */
export interface ClarifyOption {
  label: string;
  utterance: string;
}

export type ParseResult =
  | { kind: "commands"; commands: Command[] }
  | { kind: "meta"; action: MetaAction }
  | { kind: "clarify"; question: string; options: ClarifyOption[] }
  | { kind: "none" };

/** Cleans speech-to-text output: fillers, politeness, trailing punctuation. */
export function normalizeUtterance(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/^(?:(?:hey|ok(?:ay)?|um+|uh+|so|please|can you|could you|i want to|i'd like to|let's|lets|go ahead and)[,\s]+)+/i, "")
    .replace(/[\s,]*\bplease\b[.!]?$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

const META: Array<[RegExp, MetaAction]> = [
  [/^(?:undo|undo (?:that|the last (?:change|edit))|go back|revert(?: that)?)$/i, "undo"],
  [/^(?:publish|publish (?:it|that|the site|changes)|go live|make it live|push it live)$/i, "publish"],
  [/^(?:approve|approve (?:it|that)|yes|yep|looks good|confirm|do it|ship it)$/i, "approve"],
  [/^(?:reject|reject (?:it|that)|no|nope|cancel|discard(?: that)?|never ?mind)$/i, "reject"],
];

const PRICE = String.raw`\$?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars|bucks|usd)?(?:\s*(?:and\s*)?(\d{1,2})\s*cents)?`;

export function parsePrice(m: RegExpMatchArray, i: number): number {
  const whole = Number(m[i]);
  const cents = m[i + 1] ? Number(m[i + 1]) : 0;
  return Math.round(whole * 100) + cents;
}

const TAG_WORDS: Array<[RegExp, DietaryTag]> = [
  [/^vegan$/, "vegan"],
  [/^veg(?:etarian|gie)$/, "vegetarian"],
  [/^gluten[- ]?free$|^gf$/, "gluten-free"],
  [/^dairy[- ]?free$/, "dairy-free"],
  [/^nut[- ]?free$/, "nut-free"],
  [/^spicy$|^hot$/, "spicy"],
  [/^(?:contains )?nuts?$|^peanuts?$/, "contains-nuts"],
  [/^(?:contains )?dairy$/, "contains-dairy"],
  [/^(?:contains )?gluten$/, "contains-gluten"],
  [/^(?:contains )?shellfish$/, "contains-shellfish"],
];
const TAG = String.raw`(vegan|vegetarian|veggie|gluten[- ]?free|gf|dairy[- ]?free|nut[- ]?free|spicy|nuts?|peanuts?|dairy|gluten|shellfish)`;

function tagOf(word: string): DietaryTag | undefined {
  const w = word.toLowerCase().trim();
  return TAG_WORDS.find(([re]) => re.test(w))?.[1];
}

const DAYS: Record<string, Day> = {
  mon: "Mo", monday: "Mo", tue: "Tu", tues: "Tu", tuesday: "Tu", wed: "We", wednesday: "We",
  thu: "Th", thur: "Th", thurs: "Th", thursday: "Th", fri: "Fr", friday: "Fr", sat: "Sa", saturday: "Sa", sun: "Su", sunday: "Su",
};
const ORDER: Day[] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function parseDays(text: string): Day[] | null {
  const t = text.toLowerCase().replace(/\b(on|every|the)\b/g, " ").replace(/s\b/g, "").trim();
  if (/^weekday$/.test(t)) return ["Mo", "Tu", "We", "Th", "Fr"];
  if (/^weekend$/.test(t)) return ["Sa", "Su"];
  if (/^(?:every ?day|daily|all week)$/.test(t)) return [...ORDER];
  const range = t.match(/^(\w+)\s*(?:through|thru|to|-)\s*(\w+)$/);
  if (range) {
    const a = DAYS[range[1]!];
    const b = DAYS[range[2]!];
    if (!a || !b) return null;
    const i = ORDER.indexOf(a);
    const j = ORDER.indexOf(b);
    return i <= j ? ORDER.slice(i, j + 1) : null;
  }
  const parts = t.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean);
  const out = parts.map((p) => DAYS[p.trim()]);
  return out.length && out.every(Boolean) ? (out as Day[]) : null;
}

const TIME = String.raw`(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)`;

export function parseTime(text: string, fallbackPm: boolean): string | null {
  const t = text.toLowerCase().replace(/\./g, "").trim();
  if (t === "noon") return "12:00";
  if (t === "midnight") return "23:59";
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? "00";
  if (h > 23 || Number(min) > 59) return null;
  let mer = m[3];
  if (!mer && h <= 12) mer = h === 12 || fallbackPm ? "pm" : "am";
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function hours(daysText: string, opensText: string, closesText: string): Command | null {
  const days = parseDays(daysText);
  // Restaurants open in the morning/midday and close in the evening when the owner omits am/pm.
  const opensHour = Number(opensText.match(/\d+/)?.[0] ?? 0);
  const opens = parseTime(opensText, opensHour >= 1 && opensHour <= 4);
  const closes = parseTime(closesText, true);
  if (!days || !opens || !closes) return null;
  return { cmd: "set_hours", days, opens, closes, closed: false };
}

type Resolve = (phrase: string, kind?: Target["kind"]) => Target | { clarify: ClarifyOption[] } | null;

interface Rule {
  re: RegExp;
  build(m: RegExpMatchArray, resolve: Resolve): Command | { clarify: ClarifyOption[] } | null;
}

const ITEM = "(?:the\\s+)?(.+?)";

const RULES: Rule[] = [
  // relative price: "raise the wings by $1", "knock $2 off the burger", "make the knots a dollar cheaper"
  {
    re: new RegExp(`^(raise|increase|bump|lower|reduce|drop|cut)\\s+(?:the\\s+)?(?:price\\s+of\\s+)?${ITEM}\\s+by\\s+${PRICE}$`, "i"),
    build(m, resolve) {
      const t = resolve(m[2]!, "item");
      if (!t || "clarify" in t) return t;
      const cents = parsePrice(m, 3);
      return cents ? { cmd: "adjust_price", itemId: t.id, deltaCents: /raise|increase|bump/i.test(m[1]!) ? cents : -cents } : null;
    },
  },
  {
    re: new RegExp(`^(?:knock|take)\\s+${PRICE}\\s+off\\s+(?:the\\s+price\\s+of\\s+)?${ITEM}$`, "i"),
    build(m, resolve) {
      const t = resolve(m[3]!, "item");
      if (!t || "clarify" in t) return t;
      const cents = parsePrice(m, 1);
      return cents ? { cmd: "adjust_price", itemId: t.id, deltaCents: -cents } : null;
    },
  },
  // prices
  ...[
    new RegExp(`^(?:set|change|make|update|raise|lower|drop)?\\s*(?:the\\s+)?price\\s+(?:of|for|on)\\s+${ITEM}\\s+(?:to|at)\\s+${PRICE}$`, "i"),
    new RegExp(`^(?:make|set|change|update|raise|lower|drop)\\s+${ITEM}\\s+(?:to\\s+)?(?:cost\\s+)?${PRICE}$`, "i"),
    new RegExp(`^${ITEM}\\s+(?:should\\s+)?(?:costs?|is|be|are|now)\\s+(?:now\\s+)?${PRICE}(?:\\s+now)?$`, "i"),
  ].map<Rule>((re) => ({
    re,
    build(m, resolve) {
      if (!/\$|\d\.\d|dollar|buck|cent/i.test(m[0]) && !/price|cost/i.test(m[0])) return null;
      const t = resolve(m[1]!, "item");
      if (!t || "clarify" in t) return t;
      return { cmd: "set_price", itemId: t.id, price: parsePrice(m, 2) };
    },
  })),
  // rename
  ...[
    new RegExp(`^(?:rename|re-name)\\s+${ITEM}\\s+(?:to|as)\\s+["']?(.+?)["']?$`, "i"),
    new RegExp(`^change\\s+(?:the\\s+)?name\\s+of\\s+${ITEM}\\s+to\\s+["']?(.+?)["']?$`, "i"),
    new RegExp(`^call\\s+${ITEM}\\s+["']?(.+?)["']?\\s+instead$`, "i"),
  ].map<Rule>((re) => ({
    re,
    build(m, resolve) {
      const t = resolve(m[1]!, "item");
      if (!t || "clarify" in t) return t;
      return { cmd: "rename_item", itemId: t.id, name: m[2]!.trim() };
    },
  })),
  // description
  ...[
    new RegExp(`^(?:set|change|update|make)\\s+(?:the\\s+)?description\\s+(?:of|for|on)\\s+${ITEM}\\s+(?:to|say)\\s+["']?(.+?)["']?$`, "i"),
    new RegExp(`^describe\\s+${ITEM}\\s+as\\s+["']?(.+?)["']?$`, "i"),
  ].map<Rule>((re) => ({
    re,
    build(m, resolve) {
      const t = resolve(m[1]!, "item");
      if (!t || "clarify" in t) return t;
      const text = m[2]!.trim();
      return { cmd: "set_description", itemId: t.id, text: text.charAt(0).toUpperCase() + text.slice(1) + (/[.!]$/.test(text) ? "" : ".") };
    },
  })),
  // hero text
  {
    re: /^(?:set|change|update|make)\s+(?:the\s+)?(?:tagline|headline|hero text|hero|slogan|subtitle)\s+(?:to|say|read)\s+["']?(.+?)["']?$/i,
    build: (m) => ({ cmd: "set_hero_text", text: m[1]!.trim() }),
  },
  // hours
  {
    re: /^(?:we(?:'re| are|re)\s+)?closed\s+(?:on\s+)?(.+)$/i,
    build(m) {
      const days = parseDays(m[1]!);
      return days ? { cmd: "set_hours", days, closed: true } : null;
    },
  },
  {
    re: new RegExp(`^(?:set\\s+|change\\s+)?(?:the\\s+)?hours\\s+(?:on|for)\\s+(.+?)\\s+(?:to\\s+)?${TIME}\\s*(?:-|to|until|till|through)\\s*${TIME}$`, "i"),
    build: (m) => hours(m[1]!, m[2]!, m[3]!),
  },
  {
    re: new RegExp(`^(?:we(?:'re| are|re)\\s+|we'll be\\s+)?open\\s+(?:from\\s+)?${TIME}\\s*(?:-|to|until|till)\\s*${TIME}\\s+(?:on\\s+)?(.+)$`, "i"),
    build: (m) => hours(m[3]!, m[1]!, m[2]!),
  },
  {
    re: new RegExp(`^(?:on\\s+)?(.+?)\\s+(?:we(?:'re| are|re)\\s+)?open\\s+(?:from\\s+)?${TIME}\\s*(?:-|to|until|till)\\s*${TIME}$`, "i"),
    build: (m) => hours(m[1]!, m[2]!, m[3]!),
  },
  // dietary tags
  {
    re: new RegExp(`^(?:remove|take off|drop)\\s+(?:the\\s+)?${TAG}\\s+(?:tag\\s+|label\\s+)?(?:from|on)\\s+${ITEM}$`, "i"),
    build(m, resolve) {
      const tag = tagOf(m[1]!);
      const t = resolve(m[2]!, "item");
      if (!tag || !t || "clarify" in t) return t && "clarify" in t ? t : null;
      return { cmd: "remove_dietary_tag", itemId: t.id, tag };
    },
  },
  {
    re: new RegExp(`^${ITEM}\\s+(?:is not|isn't|is no longer)\\s+${TAG}$`, "i"),
    build(m, resolve) {
      const tag = tagOf(m[2]!);
      const t = resolve(m[1]!, "item");
      if (!tag || !t || "clarify" in t) return t && "clarify" in t ? t : null;
      return { cmd: "remove_dietary_tag", itemId: t.id, tag };
    },
  },
  {
    re: new RegExp(`^(?:mark|tag|label|flag)\\s+${ITEM}\\s+(?:as\\s+)?(?:being\\s+)?(?:contains\\s+|containing\\s+)?${TAG}$`, "i"),
    build(m, resolve) {
      const tag = tagOf(m[2]!);
      const t = resolve(m[1]!, "item");
      if (!tag || !t || "clarify" in t) return t && "clarify" in t ? t : null;
      return { cmd: "add_dietary_tag", itemId: t.id, tag };
    },
  },
  {
    re: new RegExp(`^add\\s+(?:a\\s+|the\\s+)?${TAG}\\s+(?:tag\\s+|label\\s+)?to\\s+${ITEM}$`, "i"),
    build(m, resolve) {
      const tag = tagOf(m[1]!);
      const t = resolve(m[2]!, "item");
      if (!tag || !t || "clarify" in t) return t && "clarify" in t ? t : null;
      return { cmd: "add_dietary_tag", itemId: t.id, tag };
    },
  },
  {
    re: new RegExp(`^${ITEM}\\s+(?:contains?|has|have)\\s+(nuts?|peanuts?|dairy|gluten|shellfish)$`, "i"),
    build(m, resolve) {
      const tag = tagOf(m[2]!);
      const t = resolve(m[1]!, "item");
      if (!tag || !t || "clarify" in t) return t && "clarify" in t ? t : null;
      return { cmd: "add_dietary_tag", itemId: t.id, tag };
    },
  },
  // reorder
  {
    re: new RegExp(`^(?:move|put)\\s+${ITEM}\\s+(?:to\\s+)?(?:the\\s+)?(top|bottom|first|last|start|end)(?:\\s+of\\s+.+)?$`, "i"),
    build(m, resolve) {
      const t = resolve(m[1]!);
      if (!t || "clarify" in t) return t;
      const to = /top|first|start/i.test(m[2]!) ? "top" : "bottom";
      return { cmd: "reorder", kind: t.kind, id: t.id, to };
    },
  },
  {
    re: new RegExp(`^(?:move|put)\\s+${ITEM}\\s+(before|above|ahead of|after|below|under)\\s+(?:the\\s+)?(.+)$`, "i"),
    build(m, resolve) {
      const t = resolve(m[1]!);
      if (!t || "clarify" in t) return t;
      const ref = resolve(m[3]!, t.kind);
      if (!ref || "clarify" in ref) return ref;
      const to = /before|above|ahead/i.test(m[2]!) ? "before" : "after";
      return { cmd: "reorder", kind: t.kind, id: t.id, to, ref: ref.id };
    },
  },
  // hide / show (after tags so "x is not vegan" isn't read as hide)
  {
    re: new RegExp(`^(?:hide|remove|take off|take down|86|eighty[- ]six|pull)\\s+${ITEM}(?:\\s+(?:from|off)\\s+(?:the\\s+)?(?:menu|site|website))?(?:\\s+for now|\\s+today)?$`, "i"),
    build(m, resolve) {
      const t = resolve(m[1]!.replace(/\s+(?:section|category)$/i, ""), /section|category/i.test(m[1]!) ? "category" : undefined);
      if (!t || "clarify" in t) return t;
      return t.kind === "item" ? { cmd: "hide_item", itemId: t.id } : { cmd: "toggle_category", categoryId: t.id, visible: false };
    },
  },
  {
    re: new RegExp(`^${ITEM}\\s+(?:is|are)\\s+(?:sold out|out of stock|unavailable|gone)(?:\\s+today|\\s+for now)?$`, "i"),
    build(m, resolve) {
      const t = resolve(m[1]!, "item");
      if (!t || "clarify" in t) return t;
      return { cmd: "hide_item", itemId: t.id };
    },
  },
  {
    re: new RegExp(`^(?:show|unhide|bring back|restore|put back)\\s+${ITEM}(?:\\s+(?:on|to)\\s+(?:the\\s+)?(?:menu|site|website))?$`, "i"),
    build(m, resolve) {
      const t = resolve(m[1]!.replace(/\s+(?:section|category)$/i, ""), /section|category/i.test(m[1]!) ? "category" : undefined);
      if (!t || "clarify" in t) return t;
      return t.kind === "item" ? { cmd: "show_item", itemId: t.id } : { cmd: "toggle_category", categoryId: t.id, visible: true };
    },
  },
  {
    re: new RegExp(`^${ITEM}\\s+(?:is|are)\\s+(?:back|available)(?:\\s+again)?$`, "i"),
    build(m, resolve) {
      const t = resolve(m[1]!, "item");
      if (!t || "clarify" in t) return t;
      return { cmd: "show_item", itemId: t.id };
    },
  },
];

/**
 * Deterministic fast path: regex grammar plus fuzzy name matching. Free, instant
 * and repeatable. Returns "none" when nothing matches so the caller can decide
 * whether to spend tokens on the LLM fallback.
 */
export function parse(utterance: string, menu: Menu): ParseResult {
  const text = normalizeUtterance(utterance);
  if (!text) return { kind: "none" };
  for (const [re, action] of META) if (re.test(text)) return { kind: "meta", action };

  const resolve: Resolve = (phrase, kind) => {
    const r = match(menu, phrase, kind);
    if (r.best) return r.best;
    if (r.ambiguous.length) {
      return {
        clarify: r.ambiguous.map((a) => ({
          label: `${a.name} (${a.id})`,
          utterance: text.replace(phrase, a.id),
        })),
      };
    }
    return null;
  };

  // Multi-command: "hide the wings and then move tiramisu to the top" / "...; ..."
  const clauses = text.split(/\s*(?:;|,?\s+and then\s+|,?\s+then\s+|,?\s+and also\s+)\s*/i).filter(Boolean);
  const commands: Command[] = [];
  for (const clause of clauses) {
    let hit: Command | { clarify: ClarifyOption[] } | null = null;
    for (const rule of RULES) {
      const m = clause.match(rule.re);
      if (!m) continue;
      hit = rule.build(m, resolve);
      if (hit) break;
    }
    if (!hit) return { kind: "none" };
    if ("clarify" in hit) return { kind: "clarify", question: "Which one did you mean?", options: hit.clarify };
    commands.push(hit);
  }
  return { kind: "commands", commands };
}
