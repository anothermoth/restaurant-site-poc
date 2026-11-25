import { z } from "zod";
import { DietaryTag } from "@restaurant-site-poc/menu-schema";

/**
 * The only way in. Every edit, whether parsed from speech by regex or proposed
 * by the LLM, must be one of these. Targets are schema ids (never selectors or
 * HTML), and free text is plain text with markup rejected.
 */
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64);
const PlainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[<>{}]|javascript:|url\(/i.test(s), "plain text only: no markup, CSS or URLs");
export const Day = z.enum(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
export type Day = z.infer<typeof Day>;
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Command = z.discriminatedUnion("cmd", [
  z.object({ cmd: z.literal("set_price"), itemId: Id, price: z.number().int().min(0).max(100_000) }),
  /** Relative change: the model says "a dollar less", the code does the math from the live price. */
  z.object({ cmd: z.literal("adjust_price"), itemId: Id, deltaCents: z.number().int().min(-10_000).max(10_000).refine((n) => n !== 0) }),
  z.object({ cmd: z.literal("rename_item"), itemId: Id, name: PlainText(60) }),
  z.object({ cmd: z.literal("set_description"), itemId: Id, text: PlainText(280) }),
  z.object({ cmd: z.literal("hide_item"), itemId: Id }),
  z.object({ cmd: z.literal("show_item"), itemId: Id }),
  z.object({ cmd: z.literal("toggle_category"), categoryId: Id, visible: z.boolean() }),
  z.object({
    cmd: z.literal("set_hours"),
    days: z.array(Day).min(1).max(7),
    opens: Time.optional(),
    closes: Time.optional(),
    closed: z.boolean().default(false),
  }),
  z.object({ cmd: z.literal("add_dietary_tag"), itemId: Id, tag: DietaryTag }),
  z.object({ cmd: z.literal("remove_dietary_tag"), itemId: Id, tag: DietaryTag }),
  z.object({ cmd: z.literal("set_hero_text"), text: PlainText(160) }),
  z.object({
    cmd: z.literal("reorder"),
    kind: z.enum(["item", "category"]),
    id: Id,
    to: z.enum(["top", "bottom", "before", "after"]),
    ref: Id.optional(),
  }),
]);
export type Command = z.infer<typeof Command>;
export type CommandName = Command["cmd"];

/** Prices and allergen/dietary claims always wait for an explicit owner approval. */
export const RISKY: ReadonlySet<CommandName> = new Set(["set_price", "adjust_price", "add_dietary_tag", "remove_dietary_tag"]);

/** Meta commands are handled by the service, never compiled to ops. They cost nothing. */
export const MetaAction = z.enum(["undo", "publish", "approve", "reject"]);
export type MetaAction = z.infer<typeof MetaAction>;

/** One-line signatures, shared by the LLM prompt and the docs (kept short on purpose: tokens). */
export const SIGNATURES = [
  "set_price{itemId,price:int cents}",
  "adjust_price{itemId,deltaCents:int, negative=cheaper}",
  "rename_item{itemId,name}",
  "set_description{itemId,text<=280}",
  "hide_item{itemId}",
  "show_item{itemId}",
  "toggle_category{categoryId,visible:bool}",
  "set_hours{days:[Mo..Su],opens?:HH:MM,closes?:HH:MM,closed?:bool}",
  "add_dietary_tag{itemId,tag}",
  "remove_dietary_tag{itemId,tag}",
  "set_hero_text{text<=160}",
  "reorder{kind:item|category,id,to:top|bottom|before|after,ref?}",
];
