import { useMemo } from "react";
import { allergenLine, dietWords, featureItem, menuPrice } from "@restaurant-site-poc/menu-schema/display";
import { applySafeFixes, checkMenu } from "@restaurant-site-poc/menu-checker";
import type { Menu } from "../lib/types.ts";
import { formatHours } from "../lib/format.ts";

/** Menu photos ("/photos/x.jpg") are served to the editor as small WebP copies (npm run photos:admin). */
export function previewSrc(src: string): string {
  return src.startsWith("/photos/") ? src.replace(/\.jpe?g$/i, ".webp") : src;
}

const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** A photo that fails to load shows its placeholder tile (the img background) instead of the browser's broken-image icon. */
export function hideBroken(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  if (img.dataset.broken) return;
  img.dataset.broken = "1";
  img.src = BLANK;
}

/**
 * Live preview of the restaurant site, rendered from the draft plus any pending
 * change. Every editable element carries the same data-edit-id the Astro site
 * uses; the ids a pending change touches are highlighted. It mirrors the public
 * site's look (photo hero, serif headings, photo-forward menu rows).
 */
export function Preview({
  menu: source,
  highlight = [],
  published = false,
  selected,
  onPick,
}: {
  menu: Menu;
  highlight?: string[];
  published?: boolean;
  /** data-edit-id of the item or section selected as the command target. */
  selected?: string;
  /** Clicking an item or section heading in the preview selects it. */
  onPick?: (target: { kind: "item" | "category"; id: string }) => void;
}) {
  // Show names the way they will publish: the same safe auto-fixes the site build applies
  // (e.g. "GARLIC KNOTS" -> "Garlic Knots"). The draft itself is unchanged; the menu list
  // still flags the raw name so the owner can fix it for good.
  const menu = useMemo(() => {
    if (published) return source;
    try {
      return applySafeFixes(source, checkMenu(source).findings).menu;
    } catch {
      return source;
    }
  }, [source, published]);
  const hl = new Set(highlight);
  // The published view drops hidden sections and items, exactly like the Astro menu page.
  const categories = published ? menu.categories.filter((c) => !c.hidden).map((c) => ({ ...c, items: c.items.filter((i) => i.available) })) : menu.categories;
  const cls = (id: string, base = "") => `${base}${hl.has(id) ? " hl" : ""}${selected === id ? " sel" : ""}`.trim();
  const r = menu.restaurant;
  return (
    <div className={onPick ? "pv pv-pickable" : "pv"} style={{ ["--brand" as string]: r.brandColor }} aria-label="Site preview">
      <header className="pv-hero">
        {r.heroPhoto && <img className="pv-hero-img" src={previewSrc(r.heroPhoto.src)} alt="" aria-hidden="true" onError={hideBroken} />}
        <div className="pv-hero-text">
          <h1>{r.name}</h1>
          {r.tagline && (
            <p data-edit-id="restaurant.tagline" className={cls("restaurant.tagline", "pv-tagline")}>
              {r.tagline}
            </p>
          )}
          <p data-edit-id="restaurant.hours" className={cls("restaurant.hours", "pv-hours")}>
            {formatHours(r.hours)}
          </p>
        </div>
      </header>
      <div data-edit-id="menu" className={cls("menu", "pv-menu")}>
        {categories.map((c, n) => {
          const feature = featureItem(c.items);
          return (
            <section key={c.id} data-edit-id={`category:${c.id}`} className={cls(`category:${c.id}`, c.hidden ? "pv-cat is-hidden" : "pv-cat")}>
              <header className="pv-cat-head">
                <h2 onClick={onPick ? () => onPick({ kind: "category", id: c.id }) : undefined}>
                  {c.name} {c.hidden && <span className="pv-flag">Hidden</span>}
                </h2>
                {c.description && <p className="pv-cat-note">{c.description}</p>}
              </header>
              <div className={`pv-body${feature ? " has-feature" : ""}${n % 2 ? " feature-left" : ""}`}>
                <ul>
                  {c.items.map((i) => {
                    const diet = dietWords(i.dietaryTags);
                    const allergens = allergenLine(i.dietaryTags);
                    return (
                      <li key={i.id} data-edit-id={`item:${i.id}`} className={cls(`item:${i.id}`, i.available ? "pv-item" : "pv-item is-hidden")}
                        onClick={onPick ? () => onPick({ kind: "item", id: i.id }) : undefined}
                      >
                        <div className="pv-line">
                          <strong data-edit-id={`item:${i.id}.name`} className={cls(`item:${i.id}.name`, "pv-name")}>
                            {i.name}
                          </strong>
                          {!i.available && <span className="pv-flag">Hidden</span>}
                          <span className="pv-leader" aria-hidden="true" />
                          <span data-edit-id={`item:${i.id}.price`} className={cls(`item:${i.id}.price`, "pv-price")}>
                            <span className="sr-only">$</span>
                            {menuPrice(i.price)}
                          </span>
                        </div>
                        {i.description && (
                          <p data-edit-id={`item:${i.id}.description`} className={cls(`item:${i.id}.description`, "pv-desc")}>
                            {i.description}
                          </p>
                        )}
                        {(diet.length > 0 || allergens) && (
                          <p data-edit-id={`item:${i.id}.tags`} className={cls(`item:${i.id}.tags`, "pv-notes")}>
                            {diet.map((d) => (
                              <span key={d} className={d === "Spicy" ? "pv-diet pv-spicy" : "pv-diet"}>
                                {d}
                              </span>
                            ))}
                            {allergens && <span className="pv-allergen">{allergens}</span>}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {feature?.photo && (
                  <figure className="pv-feature">
                    <img className="pv-thumb" src={previewSrc(feature.photo.src)} alt={feature.photo.alt} loading="lazy" decoding="async" onError={hideBroken} />
                    <figcaption>{feature.name}</figcaption>
                  </figure>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
