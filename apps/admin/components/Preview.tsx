import { formatPrice } from "@restaurant-site-poc/menu-schema/pricing";
import type { Menu } from "../lib/types.ts";
import { formatHours } from "../lib/format.ts";

/** Menu photos ("/photos/x.jpg") are served to the editor as small WebP copies (npm run photos:admin). */
export function previewSrc(src: string): string {
  return src.startsWith("/photos/") ? src.replace(/\.jpe?g$/i, ".webp") : src;
}

/**
 * Live preview of the restaurant site, rendered from the draft plus any pending
 * change. Every editable element carries the same data-edit-id the Astro site
 * uses; the ids a pending change touches are highlighted. It mirrors the public
 * site's look (photo hero, serif headings, photo-forward menu rows).
 */
export function Preview({
  menu,
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
  const hl = new Set(highlight);
  // The published view drops hidden sections and items, exactly like the Astro menu page.
  const categories = published ? menu.categories.filter((c) => !c.hidden).map((c) => ({ ...c, items: c.items.filter((i) => i.available) })) : menu.categories;
  const cls = (id: string, base = "") => `${base}${hl.has(id) ? " hl" : ""}${selected === id ? " sel" : ""}`.trim();
  const r = menu.restaurant;
  return (
    <div className={onPick ? "pv pv-pickable" : "pv"} style={{ ["--brand" as string]: r.brandColor }} aria-label="Site preview">
      <header className="pv-hero">
        {r.heroPhoto && <img className="pv-hero-img" src={previewSrc(r.heroPhoto.src)} alt="" aria-hidden="true" />}
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
        {categories.map((c) => (
          <section key={c.id} data-edit-id={`category:${c.id}`} className={cls(`category:${c.id}`, c.hidden ? "pv-cat is-hidden" : "pv-cat")}>
            <h2 onClick={onPick ? () => onPick({ kind: "category", id: c.id }) : undefined}>
              {c.name} {c.hidden && <span className="pv-flag">Hidden</span>}
            </h2>
            <ul>
              {c.items.map((i) => (
                <li key={i.id} data-edit-id={`item:${i.id}`} className={cls(`item:${i.id}`, i.available ? "pv-item" : "pv-item is-hidden")}
                  onClick={onPick ? () => onPick({ kind: "item", id: i.id }) : undefined}
                >
                  <div className="pv-item-text">
                    <strong data-edit-id={`item:${i.id}.name`} className={cls(`item:${i.id}.name`)}>
                      {i.name}
                    </strong>
                    {!i.available && <span className="pv-flag">Hidden</span>}
                    {i.description && (
                      <p data-edit-id={`item:${i.id}.description`} className={cls(`item:${i.id}.description`)}>
                        {i.description}
                      </p>
                    )}
                    <div className="pv-meta">
                      <span data-edit-id={`item:${i.id}.price`} className={cls(`item:${i.id}.price`, "pv-price")}>
                        {formatPrice(i.price, menu.currency)}
                      </span>
                      {i.dietaryTags.length > 0 && (
                        <span data-edit-id={`item:${i.id}.tags`} className={cls(`item:${i.id}.tags`, "pv-tags")}>
                          {i.dietaryTags.join(" · ")}
                        </span>
                      )}
                    </div>
                  </div>
                  {i.photo && <img className="pv-thumb" src={previewSrc(i.photo.src)} alt={i.photo.alt} loading="lazy" decoding="async" />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
