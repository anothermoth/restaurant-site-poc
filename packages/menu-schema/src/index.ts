import { z } from "zod";

/**
 * Money is stored as integer cents everywhere. Floats never touch prices,
 * so totals are exact and comparisons in the checker are stable.
 */
export const Cents = z.number().int().nonnegative();

export const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "gluten-free",
  "dairy-free",
  "nut-free",
  "spicy",
  "contains-nuts",
  "contains-dairy",
  "contains-gluten",
  "contains-shellfish",
] as const;
export const DietaryTag = z.enum(DIETARY_TAGS);
export type DietaryTag = z.infer<typeof DietaryTag>;

const Id = z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase kebab-case");

export const ModifierOption = z.object({
  id: Id,
  name: z.string().min(1),
  /** Price added to the item when this option is chosen. */
  priceDelta: Cents.default(0),
  dietaryTags: z.array(DietaryTag).default([]),
});
export type ModifierOption = z.infer<typeof ModifierOption>;

export const ModifierGroup = z
  .object({
    id: Id,
    name: z.string().min(1),
    minSelect: z.number().int().nonnegative().default(0),
    maxSelect: z.number().int().positive().default(1),
    options: z.array(ModifierOption),
  })
  .refine((g) => g.minSelect <= g.maxSelect, {
    message: "minSelect cannot exceed maxSelect",
    path: ["minSelect"],
  });
export type ModifierGroup = z.infer<typeof ModifierGroup>;

export const Photo = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Photo = z.infer<typeof Photo>;

export const MenuItem = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(""),
  price: Cents,
  photo: Photo.optional(),
  dietaryTags: z.array(DietaryTag).default([]),
  /** Ids of modifier groups defined at the menu level, so groups can be shared across items. */
  modifierGroupIds: z.array(Id).default([]),
  available: z.boolean().default(true),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const Category = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().optional(),
  /** Hidden sections stay in the data (so they can be shown again) but don't render. */
  hidden: z.boolean().default(false),
  items: z.array(MenuItem),
});
export type Category = z.infer<typeof Category>;

export const OpeningHours = z.object({
  days: z.array(z.enum(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"])).min(1),
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
});

export const Restaurant = z.object({
  slug: Id,
  name: z.string().min(1),
  tagline: z.string().optional(),
  cuisine: z.array(z.string()).min(1),
  /** Marks fictional data so it can never be mistaken for a real business. */
  isSampleData: z.boolean().default(false),
  phone: z.string().optional(),
  url: z.string().url().optional(),
  priceRange: z.string().optional(),
  address: z.object({
    street: z.string(),
    city: z.string(),
    region: z.string(),
    postalCode: z.string(),
    country: z.string().length(2),
  }),
  hours: z.array(OpeningHours).default([]),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#b4321f"),
  heroPhoto: Photo.optional(),
});
export type Restaurant = z.infer<typeof Restaurant>;

export const Menu = z
  .object({
    restaurant: Restaurant,
    currency: z.string().length(3).default("USD"),
    modifierGroups: z.array(ModifierGroup).default([]),
    categories: z.array(Category).min(1),
  })
  .superRefine((menu, ctx) => {
    const groupIds = new Set(menu.modifierGroups.map((g) => g.id));
    const seen = new Set<string>();
    menu.categories.forEach((cat, ci) => {
      cat.items.forEach((item, ii) => {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate item id "${item.id}"`,
            path: ["categories", ci, "items", ii, "id"],
          });
        }
        seen.add(item.id);
        item.modifierGroupIds.forEach((gid, gi) => {
          if (!groupIds.has(gid)) {
            ctx.addIssue({
              code: "custom",
              message: `unknown modifier group "${gid}"`,
              path: ["categories", ci, "items", ii, "modifierGroupIds", gi],
            });
          }
        });
      });
    });
  });
export type Menu = z.infer<typeof Menu>;
/** The shape you write in JSON (defaults not yet applied). */
export type MenuInput = z.input<typeof Menu>;

export function parseMenu(input: unknown): Menu {
  return Menu.parse(input);
}

export function safeParseMenu(input: unknown) {
  return Menu.safeParse(input);
}

export function allItems(menu: Menu): Array<{ item: MenuItem; category: Category }> {
  return menu.categories.flatMap((category) => category.items.map((item) => ({ item, category })));
}

export * from "./pricing.ts";
