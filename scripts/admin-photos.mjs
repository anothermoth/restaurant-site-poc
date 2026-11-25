// Builds small WebP copies of data/photos/*.jpg for the editor's live preview
// (apps/admin/public/photos). The Astro site makes its own AVIF/WebP at build time.
// Run after adding or replacing a photo: npm run photos:admin
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const src = path.resolve("data/photos");
const out = path.resolve("apps/admin/public/photos");
await mkdir(out, { recursive: true });
for (const f of (await readdir(src)).filter((f) => f.endsWith(".jpg"))) {
  const name = f.replace(/\.jpg$/, "");
  const width = name === "hero" || name === "room" ? 1600 : 480;
  const info = await sharp(path.join(src, f)).resize({ width, withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(out, `${name}.webp`));
  console.log(`${name}.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
}
