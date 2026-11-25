import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { previewSrc } from "../components/Preview.tsx";

// Guards against menu data pointing at photos that don't ship: every photo path in a seed
// menu must resolve to a source JPEG (used by the Astro site), a WebP thumbnail in the
// editor's public folder (npm run photos:admin), and a credit in data/photos/sources.json.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const menus = readdirSync(path.join(root, "data")).filter((f) => f.endsWith(".menu.json"));
const sources = JSON.parse(readFileSync(path.join(root, "data/photos/sources.json"), "utf8")) as Record<string, unknown>;

describe("menu photo paths", () => {
  it("finds the seed menus", () => expect(menus.length).toBeGreaterThan(0));

  for (const file of menus) {
    it(`${file}: every photo resolves to a source JPEG, an editor WebP and a credit`, () => {
      const menu = parseMenu(JSON.parse(readFileSync(path.join(root, "data", file), "utf8")));
      const srcs = [menu.restaurant.heroPhoto?.src, ...menu.categories.flatMap((c) => c.items.map((i) => i.photo?.src))].filter((s): s is string => !!s);
      expect(srcs.length).toBeGreaterThan(0);
      const problems: string[] = [];
      for (const src of srcs) {
        const m = /^\/photos\/([a-z0-9-]+)\.jpg$/.exec(src);
        if (!m) {
          problems.push(`${src}: not a /photos/<name>.jpg path`);
          continue;
        }
        if (!existsSync(path.join(root, "data/photos", `${m[1]}.jpg`))) problems.push(`${src}: data/photos/${m[1]}.jpg missing`);
        const webp = previewSrc(src);
        if (!existsSync(path.join(root, "apps/admin/public", webp))) problems.push(`${src}: apps/admin/public${webp} missing (run npm run photos:admin)`);
        if (!sources[m[1]!]) problems.push(`${src}: no credit in data/photos/sources.json`);
      }
      expect(problems).toEqual([]);
    });
  }

  it("every source JPEG has an editor WebP", () => {
    const jpgs = readdirSync(path.join(root, "data/photos")).filter((f) => f.endsWith(".jpg"));
    const missing = jpgs.filter((f) => !existsSync(path.join(root, "apps/admin/public/photos", f.replace(/\.jpg$/, ".webp"))));
    expect(missing).toEqual([]);
  });
});

describe("hideBroken", () => {
  it("swaps a failed photo for a blank image once, so the placeholder tile shows", async () => {
    const { hideBroken } = await import("../components/Preview.tsx");
    const img = { dataset: {} as Record<string, string>, src: "/photos/gone.webp" } as unknown as HTMLImageElement;
    hideBroken({ currentTarget: img });
    expect(img.src).toMatch(/^data:image\/gif/);
    expect(img.dataset.broken).toBe("1");
    img.src = "x";
    hideBroken({ currentTarget: img });
    expect(img.src).toBe("x");
  });
});
