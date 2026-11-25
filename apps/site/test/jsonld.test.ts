import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { menuJsonLd, restaurantJsonLd, serializeJsonLd } from "../src/lib/jsonld.ts";

const menu = parseMenu(JSON.parse(readFileSync(new URL("../../../data/sample-restaurant.menu.json", import.meta.url), "utf8")));
const site = "https://example.com";

describe("JSON-LD", () => {
  it("describes the restaurant with address and hours", () => {
    const ld = restaurantJsonLd(menu, site);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Restaurant");
    expect(ld.address.addressLocality).toBe("Springfield");
    expect(ld.openingHoursSpecification[0]!.dayOfWeek).toEqual(["Tuesday", "Wednesday", "Thursday"]);
    expect(ld.hasMenu).toBe("https://example.com/menu");
  });

  it("embeds a Menu with sections, items and decimal-string offers", () => {
    const ld = menuJsonLd(menu, site);
    expect(ld.hasMenuSection).toHaveLength(menu.categories.length);
    const pizza = ld.hasMenuSection.find((s) => s.name === "Wood-Fired Pizza")!;
    const margherita = pizza.hasMenuItem.find((i) => i.name === "Margherita")!;
    expect(margherita.offers).toEqual({ "@type": "Offer", price: "15.00", priceCurrency: "USD" });
    expect(margherita.suitableForDiet).toEqual(["https://schema.org/VegetarianDiet"]);
    expect(margherita.image).toBe("https://example.com/photos/margherita.jpg");
  });

  it("escapes < so menu text can't close the script tag", () => {
    expect(serializeJsonLd({ name: "</script><b>" })).not.toContain("</script>");
  });
});
