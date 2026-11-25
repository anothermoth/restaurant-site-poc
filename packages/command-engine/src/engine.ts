import { formatPrice, parseMenu, type Menu, type MenuItem } from "@restaurant-site-poc/menu-schema";
import { runRules, type Finding } from "@restaurant-site-poc/menu-checker";
import { Command, RISKY, type Day } from "./commands.ts";
import { applyOps, getAt, OpError, type Op } from "./ops.ts";

export interface CompiledChange {
  commands: Command[];
  ops: Op[];
  /** Plain-language lines for the change card and the spoken reply. */
  summary: string[];
  risk: "low" | "high";
  /** Checker findings this change would introduce or resolve. */
  findings: { added: Finding[]; resolved: Finding[] };
  menu: Menu;
}

export class CommandError extends Error {}
class NoChange extends CommandError {}

const DAY_ORDER: Day[] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_NAME: Record<Day, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

function item(menu: Menu, id: string): MenuItem {
  for (const c of menu.categories) {
    const i = c.items.find((x) => x.id === id);
    if (i) return i;
  }
  throw new CommandError(`Unknown item "${id}"`);
}

function moveId(order: string[], id: string, to: "top" | "bottom" | "before" | "after", ref?: string): string[] {
  if (!order.includes(id)) throw new CommandError(`"${id}" isn't in that list`);
  const rest = order.filter((x) => x !== id);
  if (to === "top") return [id, ...rest];
  if (to === "bottom") return [...rest, id];
  if (!ref || !rest.includes(ref)) throw new CommandError(`Can't move ${to} "${ref ?? "?"}": not in the same list`);
  const at = rest.indexOf(ref) + (to === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Expands hours groups to one entry per day, applies the change, then regroups identical consecutive days. */
export function updateHours(hours: Menu["restaurant"]["hours"], days: Day[], value: { opens: string; closes: string } | null) {
  const perDay = new Map<Day, { opens: string; closes: string }>();
  for (const h of hours) for (const d of h.days) perDay.set(d, { opens: h.opens, closes: h.closes });
  for (const d of days) {
    if (value) perDay.set(d, value);
    else perDay.delete(d);
  }
  const out: Menu["restaurant"]["hours"] = [];
  for (const d of DAY_ORDER) {
    const v = perDay.get(d);
    if (!v) continue;
    const last = out[out.length - 1];
    const prevDay = DAY_ORDER[DAY_ORDER.indexOf(d) - 1];
    if (last && last.opens === v.opens && last.closes === v.closes && prevDay && last.days.at(-1) === prevDay) last.days.push(d);
    else out.push({ days: [d], opens: v.opens, closes: v.closes });
  }
  return out;
}

function compileOne(menu: Menu, cmd: Command): { ops: Op[]; summary: string } {
  const op = (path: string, after: unknown): Op => ({ path, before: getAt(menu, path), after });
  switch (cmd.cmd) {
    case "set_price": {
      const i = item(menu, cmd.itemId);
      return { ops: [op(`/items/${i.id}/price`, cmd.price)], summary: `${i.name}: price ${formatPrice(i.price, menu.currency)} → ${formatPrice(cmd.price, menu.currency)}` };
    }
    case "adjust_price": {
      const i = item(menu, cmd.itemId);
      const price = i.price + cmd.deltaCents;
      if (price < 0) throw new CommandError(`${i.name} can't go below $0`);
      return { ops: [op(`/items/${i.id}/price`, price)], summary: `${i.name}: price ${formatPrice(i.price, menu.currency)} → ${formatPrice(price, menu.currency)}` };
    }
    case "rename_item": {
      const i = item(menu, cmd.itemId);
      return { ops: [op(`/items/${i.id}/name`, cmd.name)], summary: `Rename "${i.name}" → "${cmd.name}"` };
    }
    case "set_description": {
      const i = item(menu, cmd.itemId);
      return { ops: [op(`/items/${i.id}/description`, cmd.text)], summary: `${i.name}: new description` };
    }
    case "hide_item":
    case "show_item": {
      const i = item(menu, cmd.itemId);
      const available = cmd.cmd === "show_item";
      return { ops: [op(`/items/${i.id}/available`, available)], summary: `${available ? "Show" : "Hide"} "${i.name}" ${available ? "on" : "from"} the menu` };
    }
    case "toggle_category": {
      const c = menu.categories.find((x) => x.id === cmd.categoryId);
      if (!c) throw new CommandError(`Unknown section "${cmd.categoryId}"`);
      return { ops: [op(`/categories/${c.id}/hidden`, !cmd.visible)], summary: `${cmd.visible ? "Show" : "Hide"} the ${c.name} section` };
    }
    case "set_hours": {
      if (!cmd.closed && (!cmd.opens || !cmd.closes)) throw new CommandError("Hours need an opening and closing time, or closed");
      if (!cmd.closed && cmd.opens! >= cmd.closes!) throw new CommandError(`Closing time ${cmd.closes} must be after opening ${cmd.opens}`);
      const days = DAY_ORDER.filter((d) => cmd.days.includes(d));
      const after = updateHours(menu.restaurant.hours, days, cmd.closed ? null : { opens: cmd.opens!, closes: cmd.closes! });
      const label = days.map((d) => DAY_NAME[d]).join(", ");
      return { ops: [op("/restaurant/hours", after)], summary: cmd.closed ? `Closed on ${label}` : `Hours on ${label}: ${cmd.opens}–${cmd.closes}` };
    }
    case "add_dietary_tag":
    case "remove_dietary_tag": {
      const i = item(menu, cmd.itemId);
      const adding = cmd.cmd === "add_dietary_tag";
      if (adding === i.dietaryTags.includes(cmd.tag)) throw new NoChange(`No change: "${i.name}" is ${adding ? "already" : "not"} tagged ${cmd.tag}`);
      const after = adding ? [...i.dietaryTags, cmd.tag] : i.dietaryTags.filter((t) => t !== cmd.tag);
      return { ops: [op(`/items/${i.id}/dietaryTags`, after)], summary: `${i.name}: ${adding ? "add" : "remove"} tag "${cmd.tag}"` };
    }
    case "set_hero_text":
      return { ops: [op("/restaurant/tagline", cmd.text)], summary: `Headline text → "${cmd.text}"` };
    case "reorder": {
      if (cmd.kind === "category") {
        const after = moveId(menu.categories.map((c) => c.id), cmd.id, cmd.to, cmd.ref);
        const cname = (id?: string) => menu.categories.find((c) => c.id === id)?.name ?? id;
        return { ops: [op("/categoryOrder", after)], summary: `Move the ${cname(cmd.id)} section ${cmd.ref ? `${cmd.to} ${cname(cmd.ref)}` : `to the ${cmd.to}`}` };
      }
      const cat = menu.categories.find((c) => c.items.some((i) => i.id === cmd.id));
      if (!cat) throw new CommandError(`Unknown item "${cmd.id}"`);
      const after = moveId(cat.items.map((i) => i.id), cmd.id, cmd.to, cmd.ref);
      const name = item(menu, cmd.id).name;
      return { ops: [op(`/categories/${cat.id}/itemOrder`, after)], summary: `Move "${name}" to ${cmd.to === "top" || cmd.to === "bottom" ? `the ${cmd.to} of ${cat.name}` : `${cmd.to} "${item(menu, cmd.ref!).name}"`}`.replace(" to before", " before").replace(" to after", " after") };
    }
  }
}

const key = (f: Finding) => `${f.ruleId}|${f.target.itemId ?? ""}|${f.target.modifierGroupId ?? ""}|${f.message}`;

/**
 * Compiles a plan atomically: every command is validated with zod, compiled
 * against the running result, and the final menu is re-validated with the
 * menu schema. If anything fails, nothing is applied.
 */
export function compile(menu: Menu, input: unknown[]): CompiledChange {
  if (input.length === 0) throw new CommandError("No commands");
  if (input.length > 10) throw new CommandError("Too many commands in one change");
  const commands = input.map((c) => {
    const r = Command.safeParse(c);
    if (!r.success) throw new CommandError(`Invalid command: ${r.error.issues[0]?.message ?? "unknown"}`);
    return r.data;
  });
  let working = menu;
  const ops: Op[] = [];
  const summary: string[] = [];
  const skipped: string[] = [];
  for (const cmd of commands) {
    try {
      const out = compileOne(working, cmd);
      const noop = out.ops.every((o) => JSON.stringify(o.before) === JSON.stringify(o.after));
      if (noop) throw new NoChange(`No change: ${out.summary}`);
      working = applyOps(working, out.ops);
      ops.push(...out.ops);
      summary.push(out.summary);
    } catch (e) {
      if (e instanceof OpError) throw new CommandError(e.message);
      // A command that's already true ("already tagged vegan") is skipped, not fatal,
      // as long as something else in the plan does real work.
      if (e instanceof NoChange) {
        skipped.push(e.message.replace(/^No change: /, ""));
        continue;
      }
      throw e;
    }
  }
  if (ops.length === 0) throw new CommandError(skipped.length === 1 ? `No change: ${skipped[0]}` : `No change: ${skipped.join("; ")}`);
  for (const s of skipped) summary.push(`(skipped, already so: ${s})`);
  let validated: Menu;
  try {
    validated = parseMenu(working);
  } catch (e) {
    throw new CommandError(`Result failed menu validation: ${(e as Error).message.slice(0, 200)}`);
  }
  const before = new Map(runRules(menu).map((f) => [key(f), f]));
  const after = new Map(runRules(validated).map((f) => [key(f), f]));
  return {
    commands,
    ops,
    summary,
    risk: commands.some((c) => RISKY.has(c.cmd)) ? "high" : "low",
    findings: {
      added: [...after].filter(([k]) => !before.has(k)).map(([, f]) => f),
      resolved: [...before].filter(([k]) => !after.has(k)).map(([, f]) => f),
    },
    menu: validated,
  };
}
