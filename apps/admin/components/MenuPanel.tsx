"use client";
import { useMemo, useState } from "react";
import { formatPrice } from "@restaurant-site-poc/menu-schema/pricing";
import type { EditTarget } from "../lib/api.ts";
import type { Menu } from "../lib/types.ts";
import { previewSrc } from "./Preview.tsx";

/**
 * The menu as a searchable list. Clicking an item or section makes it the
 * command target, so the owner can say "make this $14" or just "86".
 */
export function MenuPanel({ menu, target, onSelect }: { menu: Menu; target: EditTarget | null; onSelect: (t: EditTarget | null) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const sections = useMemo(
    () =>
      menu.categories
        .map((c) => ({
          ...c,
          items: query ? c.items.filter((i) => `${i.name} ${i.description ?? ""}`.toLowerCase().includes(query) || c.name.toLowerCase().includes(query)) : c.items,
        }))
        .filter((c) => c.items.length > 0 || c.name.toLowerCase().includes(query)),
    [menu, query],
  );
  const isSel = (kind: EditTarget["kind"], id: string) => target?.kind === kind && target.id === id;
  const toggle = (t: EditTarget) => onSelect(isSel(t.kind, t.id) ? null : t);

  return (
    <div className="menu-panel">
      <div className="mp-search">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu" aria-label="Search the menu" />
      </div>
      <p className="mp-hint">Select an item, then say “make this $14” or “86 it”.</p>
      {sections.length === 0 && <p className="mp-empty">No items match “{q}”.</p>}
      {sections.map((c) => (
        <section key={c.id} className="mp-section">
          <button
            type="button"
            className={`mp-cat${isSel("category", c.id) ? " is-sel" : ""}`}
            aria-pressed={isSel("category", c.id)}
            onClick={() => toggle({ kind: "category", id: c.id })}
          >
            <span>{c.name}</span>
            {c.hidden ? <span className="mp-flag">Hidden</span> : <span className="mp-count">{c.items.length}</span>}
          </button>
          <ul>
            {c.items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className={`mp-item${isSel("item", i.id) ? " is-sel" : ""}${i.available ? "" : " is-off"}`}
                  aria-pressed={isSel("item", i.id)}
                  onClick={() => toggle({ kind: "item", id: i.id })}
                >
                  {i.photo ? <img src={previewSrc(i.photo.src)} alt="" /> : <span className="mp-noimg" aria-hidden="true" />}
                  <span className="mp-name">{i.name}</span>
                  <span className="mp-price">{i.available ? formatPrice(i.price, menu.currency) : "86’d"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Display name for the current target, or null if it no longer exists. */
export function targetName(menu: Menu, t: EditTarget | null): string | null {
  if (!t) return null;
  if (t.kind === "category") return menu.categories.find((c) => c.id === t.id)?.name ?? null;
  return menu.categories.flatMap((c) => c.items).find((i) => i.id === t.id)?.name ?? null;
}
