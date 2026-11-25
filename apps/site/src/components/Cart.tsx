import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { formatPrice } from "@restaurant-site-poc/menu-schema/pricing";
import type { Menu, MenuItem } from "@restaurant-site-poc/menu-schema";
import { cartReducer, priceLines, type CartLine } from "../lib/cart-state.ts";

interface Props {
  menu: Menu;
  storageKey: string;
}

/**
 * The only hydrated component on the site (an Astro island). Menu markup is
 * static HTML; "Add" buttons carry data-add-item and this island listens for
 * clicks with one delegated handler, so no per-item JS ships.
 */
export default function Cart({ menu, storageKey }: Props) {
  const [lines, dispatch] = useReducer(cartReducer, [] as CartLine[]);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [notice, setNotice] = useState("");
  const loaded = useRef(false);

  const items = useMemo(() => new Map(menu.categories.flatMap((c) => c.items).map((i) => [i.id, i])), [menu]);
  const priced = useMemo(() => priceLines(menu, lines), [menu, lines]);
  const count = priced.lines.reduce((n, l) => n + l.quantity, 0);
  const money = (c: number) => formatPrice(c, menu.currency);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as CartLine[];
      if (Array.isArray(saved)) dispatch({ type: "load", lines: saved });
    } catch {
      // ignore corrupt storage
    }
    loaded.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (loaded.current) localStorage.setItem(storageKey, JSON.stringify(lines));
  }, [lines, storageKey]);

  const add = useCallback(
    (item: MenuItem, selections?: Record<string, string[]>) => {
      dispatch({ type: "add", itemId: item.id, selections });
      setNotice(`Added ${item.name}`);
    },
    [],
  );

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const btn = (e.target as Element | null)?.closest<HTMLElement>("[data-add-item]");
      if (!btn) return;
      const item = items.get(btn.dataset.addItem ?? "");
      if (!item) return;
      if (item.modifierGroupIds.length > 0) setPicking(item);
      else add(item);
    }
    document.addEventListener("click", onClick);
    document.documentElement.dataset.cartReady = "true";
    return () => document.removeEventListener("click", onClick);
  }, [items, add]);

  const sheetOpen = open || picking !== null;
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setPicking(null);
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{notice}</p>
      <div className="cart-dock">
        <button type="button" className={`cart-fab${count > 0 ? " has-items" : ""}`} onClick={() => setOpen(true)} aria-label={`Open cart, ${count} items`}>
          <span className="cart-count" key={count}>{count}</span>
          <span className="cart-fab-label">{count > 0 ? "View order" : "Your order"}</span>
          {count > 0 && <span className="cart-fab-total">{money(priced.subtotal)}</span>}
        </button>
      </div>

      {picking && (
        <ModifierPicker
          item={picking}
          menu={menu}
          onCancel={() => setPicking(null)}
          onAdd={(sel) => {
            add(picking, sel);
            setPicking(null);
          }}
        />
      )}

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <aside className="sheet" role="dialog" aria-modal="true" aria-label="Your order" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden="true" />
            <header className="sheet-head">
              <h2>Your order</h2>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close cart">
                <CloseIcon />
              </button>
            </header>
            <div className="sheet-body">
              {priced.lines.length === 0 ? (
                <div className="cart-empty">
                  <p>Your cart is empty.</p>
                  <p className="muted small">Add a few things from the menu and they will show up here.</p>
                </div>
              ) : (
                <ul className="cart-lines">
                  {priced.lines.map((l) => (
                    <li key={l.key}>
                      <div className="cart-line-text">
                        <strong>{l.name}</strong>
                        {l.optionNames.length > 0 && <div className="muted small">{l.optionNames.join(", ")}</div>}
                      </div>
                      <div className="qty">
                        <button type="button" onClick={() => dispatch({ type: "setQty", key: l.key, quantity: l.quantity - 1 })} aria-label={`Remove one ${l.name}`}>−</button>
                        <span aria-label="quantity">{l.quantity}</span>
                        <button type="button" onClick={() => dispatch({ type: "setQty", key: l.key, quantity: l.quantity + 1 })} aria-label={`Add one ${l.name}`}>+</button>
                      </div>
                      <span className="line-total">{money(l.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sheet-foot">
              <div className="subtotal"><span>Subtotal</span><strong>{money(priced.subtotal)}</strong></div>
              <button type="button" className="btn btn-accent btn-block" disabled title="Demo: sample restaurant, no orders are placed">
                Checkout (demo, disabled)
              </button>
              <p className="muted small">Prices come from the menu data, not the browser; a real checkout re-prices on the server with the same priceCart().</p>
              {priced.lines.length > 0 && (
                <button type="button" className="link-btn" onClick={() => dispatch({ type: "clear" })}>Clear cart</button>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ModifierPicker({ item, menu, onAdd, onCancel }: {
  item: MenuItem;
  menu: Menu;
  onAdd: (selections: Record<string, string[]>) => void;
  onCancel: () => void;
}) {
  const groups = item.modifierGroupIds
    .map((id) => menu.modifierGroups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));
  const [sel, setSel] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, g.minSelect === 1 && g.maxSelect === 1 && g.options[0] ? [g.options[0].id] : []])),
  );
  const valid = groups.every((g) => {
    const n = sel[g.id]?.length ?? 0;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  const unit = item.price + groups.reduce((s, g) => s + g.options.filter((o) => sel[g.id]?.includes(o.id)).reduce((a, o) => a + o.priceDelta, 0), 0);

  function toggle(groupId: string, optionId: string, single: boolean) {
    setSel((prev) => {
      const cur = prev[groupId] ?? [];
      if (single) return { ...prev, [groupId]: [optionId] };
      return { ...prev, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
    });
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Customize ${item.name}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onAdd(sel);
        }}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <div>
            <h2>{item.name}</h2>
            {item.description && <p className="muted small sheet-sub">{item.description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">
        {groups.map((g) => {
          const single = g.maxSelect === 1;
          const chosen = sel[g.id] ?? [];
          return (
            <fieldset key={g.id} className="mod-group">
              <legend>
                <span className="mod-name">{g.name}</span>
                <span className={`mod-req${g.minSelect > 0 ? " is-required" : ""}`}>
                  {g.minSelect > 0 ? "Required" : "Optional"}
                  {!single ? `, up to ${g.maxSelect}` : ""}
                </span>
              </legend>
              {g.options.map((o) => (
                <label key={o.id} className="mod-option">
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={g.id}
                    checked={chosen.includes(o.id)}
                    disabled={!single && !chosen.includes(o.id) && chosen.length >= g.maxSelect}
                    onChange={() => toggle(g.id, o.id, single)}
                  />
                  <span className="mod-label">{o.name}</span>
                  {o.priceDelta > 0 && <span className="mod-price">+{formatPrice(o.priceDelta, menu.currency)}</span>}
                </label>
              ))}
            </fieldset>
          );
        })}
        </div>
        <div className="sheet-foot">
          <button type="submit" className="btn btn-accent btn-block" disabled={!valid}>
            Add to cart · {formatPrice(unit, menu.currency)}
          </button>
        </div>
      </form>
    </div>
  );
}
