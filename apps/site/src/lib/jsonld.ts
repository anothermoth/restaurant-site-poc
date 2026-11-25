import { formatPrice, type Menu } from "@restaurant-site-poc/menu-schema";

const DIET: Record<string, string> = {
  vegan: "https://schema.org/VeganDiet",
  vegetarian: "https://schema.org/VegetarianDiet",
  "gluten-free": "https://schema.org/GlutenFreeDiet",
};

const DAY: Record<string, string> = {
  Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday",
};

function abs(site: string, path: string) {
  return new URL(path, site).toString();
}

/** schema.org Menu with sections, items and offers. Prices are decimal strings, never floats. */
export function menuJsonLd(menu: Menu, site: string) {
  return {
    "@type": "Menu",
    "@id": abs(site, "/menu#menu"),
    name: `${menu.restaurant.name} Menu`,
    inLanguage: "en",
    hasMenuSection: menu.categories.filter((c) => !c.hidden).map((c) => ({
      "@type": "MenuSection",
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      hasMenuItem: c.items
        .filter((i) => i.available)
        .map((i) => ({
          "@type": "MenuItem",
          name: i.name,
          ...(i.description ? { description: i.description } : {}),
          ...(i.photo ? { image: abs(site, i.photo.src) } : {}),
          offers: { "@type": "Offer", price: (i.price / 100).toFixed(2), priceCurrency: menu.currency },
          ...(i.dietaryTags.some((t) => DIET[t])
            ? { suitableForDiet: i.dietaryTags.filter((t) => DIET[t]).map((t) => DIET[t]) }
            : {}),
        })),
    })),
  };
}

export function restaurantJsonLd(menu: Menu, site: string, opts: { includeMenu?: boolean } = {}) {
  const r = menu.restaurant;
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": abs(site, "/#restaurant"),
    name: r.name,
    url: abs(site, "/"),
    ...(r.tagline ? { description: r.tagline } : {}),
    ...(r.phone ? { telephone: r.phone } : {}),
    servesCuisine: r.cuisine,
    ...(r.priceRange ? { priceRange: r.priceRange } : {}),
    ...(r.heroPhoto ? { image: abs(site, r.heroPhoto.src) } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: r.address.street,
      addressLocality: r.address.city,
      addressRegion: r.address.region,
      postalCode: r.address.postalCode,
      addressCountry: r.address.country,
    },
    openingHoursSpecification: r.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days.map((d) => DAY[d]),
      opens: h.opens,
      closes: h.closes,
    })),
    acceptsReservations: false,
    hasMenu: opts.includeMenu ? menuJsonLd(menu, site) : abs(site, "/menu"),
  };
}

/** Safe for a <script type="application/ld+json"> body: no "</script>" breakout. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function priceText(cents: number, currency: string) {
  return formatPrice(cents, currency);
}
