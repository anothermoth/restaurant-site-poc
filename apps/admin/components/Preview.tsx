import { formatPrice } from "@restaurant-site-poc/menu-schema/pricing";
import type { Menu } from "../lib/types.ts";
import { formatHours } from "../lib/format.ts";

/**
 * Live preview of the restaurant site, rendered from the draft plus any pending
 * change. Every editable element carries the same data-edit-id the Astro site
 * uses; the ids a pending change touches are highlighted.
 */
export function Preview({ menu, highlight = [] }: { menu: Menu; highlight?: string[] }) {
  const hl = new Set(highlight);
  const cls = (id: string, base = "") => `${base}${hl.has(id) ? " hl" : ""}`.trim();
  const r = menu.restaurant;
  return (
    <div className="pv" style={{ ["--brand" as string]: r.brandColor }} aria-label="Site preview">
      <header className="pv-hero">
        <h1>{r.name}</h1>
        {r.tagline && (
          <p data-edit-id="restaurant.tagline" className={cls("restaurant.tagline")}>
            {r.tagline}
          </p>
        )}
        <p data-edit-id="restaurant.hours" className={cls("restaurant.hours", "pv-hours")}>
          {formatHours(r.hours)}
        </p>
      </header>
      <div data-edit-id="menu" className={cls("menu", "pv-menu")}>
        {menu.categories.map((c) => (
          <section key={c.id} data-edit-id={`category:${c.id}`} className={cls(`category:${c.id}`, c.hidden ? "pv-cat is-hidden" : "pv-cat")}>
            <h2>
              {c.name} {c.hidden && <span className="pv-flag">Hidden</span>}
            </h2>
            <ul>
              {c.items.map((i) => (
                <li key={i.id} data-edit-id={`item:${i.id}`} className={cls(`item:${i.id}`, i.available ? "pv-item" : "pv-item is-hidden")}>
                  <div>
                    <strong data-edit-id={`item:${i.id}.name`} className={cls(`item:${i.id}.name`)}>
                      {i.name}
                    </strong>
                    {!i.available && <span className="pv-flag">Hidden</span>}
                    {i.description && (
                      <p data-edit-id={`item:${i.id}.description`} className={cls(`item:${i.id}.description`)}>
                        {i.description}
                      </p>
                    )}
                    {i.dietaryTags.length > 0 && (
                      <p data-edit-id={`item:${i.id}.tags`} className={cls(`item:${i.id}.tags`, "pv-tags")}>
                        {i.dietaryTags.join(" · ")}
                      </p>
                    )}
                  </div>
                  <span data-edit-id={`item:${i.id}.price`} className={cls(`item:${i.id}.price`, "pv-price")}>
                    {formatPrice(i.price, menu.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
