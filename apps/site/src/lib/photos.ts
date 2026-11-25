import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";
import type { Menu } from "@restaurant-site-poc/menu-schema";

/**
 * Menu photos live in data/photos (shared with the editor). Menu JSON refers to
 * them as "/photos/<name>.jpg"; at build time Astro turns each into responsive
 * AVIF/WebP variants. Any other src (e.g. a full URL) is rendered as-is.
 */
const files = import.meta.glob<{ default: ImageMetadata }>("../../../../data/photos/*.jpg", { eager: true });
const byName = new Map(Object.entries(files).map(([path, mod]) => [path.split("/").pop()!, mod.default]));

export function photoAsset(src: string | undefined): ImageMetadata | undefined {
  if (!src || !src.startsWith("/photos/")) return undefined;
  return byName.get(src.slice("/photos/".length));
}

/** A stable JPEG URL for Open Graph and JSON-LD (search engines and link previews). */
export async function photoUrl(src: string, width = 1200): Promise<string> {
  const asset = photoAsset(src);
  if (!asset) return src;
  return (await getImage({ src: asset, width: Math.min(width, asset.width), format: "jpg", quality: 80 })).src;
}

/** The menu with every photo src replaced by its built URL, for structured data. */
export async function withPhotoUrls(menu: Menu): Promise<Menu> {
  const hero = menu.restaurant.heroPhoto;
  return {
    ...menu,
    restaurant: { ...menu.restaurant, heroPhoto: hero ? { ...hero, src: await photoUrl(hero.src) } : undefined },
    categories: await Promise.all(
      menu.categories.map(async (c) => ({
        ...c,
        items: await Promise.all(c.items.map(async (i) => (i.photo ? { ...i, photo: { ...i.photo, src: await photoUrl(i.photo.src, 800) } } : i))),
      })),
    ),
  };
}
