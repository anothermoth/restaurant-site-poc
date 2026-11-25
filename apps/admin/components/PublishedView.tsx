"use client";
import { useEffect, useState } from "react";
import { applySafeFixes, checkMenu } from "@restaurant-site-poc/menu-checker";
import type { Menu } from "../lib/types.ts";
import { Preview } from "./Preview.tsx";

/**
 * Demo-mode "published site": the visitor's sandbox menu as last published, run
 * through the same safe auto-fixes as the Astro build and rendered with the
 * admin's preview components. A hosted serverless function can't run an Astro
 * build per visitor, so this stands in for the static site; it is not the Astro page.
 */
export function PublishedView({ slug }: { slug: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/sites/${slug}/published.json`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const m = (await r.json()) as Menu;
        setMenu(applySafeFixes(m, checkMenu(m).findings).menu);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);
  return (
    <main className="published">
      <p className="demo-note" role="note">
        Your published version, rendered from your sandbox. The real public site is a static Astro build; this preview uses the same menu data and the same safe auto-fixes.{" "}
        <a href="/">Back to the editor</a>
      </p>
      {error && <p>Couldn&apos;t load the published menu: {error}</p>}
      {menu ? <Preview menu={menu} published /> : !error && <p>Loading…</p>}
    </main>
  );
}
