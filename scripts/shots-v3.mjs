/* global window, document */
/**
 * Public-site visual pass screenshots (docs/redesign-v3): full-page home + menu at
 * 1440, 1280 and 390 wide, plus the editor preview (desktop + mobile).
 *   node scripts/shots-v3.mjs <before|after> [siteUrl] [editorUrl]
 */
import { chromium } from "playwright-core";
const [prefix = "after", SITE = "https://restaurant-site-poc.pages.dev", EDITOR = "https://restaurant-site-poc-editor.vercel.app"] = process.argv.slice(2);
const OUT = process.env.OUT ?? "docs/redesign-v3";
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const views = {
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const settle = async (p) => {
  // Scroll through so lazy images load, then back to the top.
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(500);
};
for (const [w, opts] of Object.entries(views)) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  for (const [name, path] of [["home", "/"], ["menu", "/menu/"]]) {
    await p.goto(SITE + path, { waitUntil: "networkidle" });
    await settle(p);
    await p.screenshot({ path: `${OUT}/${prefix}-${name}-${w}.png`, fullPage: true });
  }
  if (w !== "1280") {
    await p.goto(EDITOR, { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    // Scroll the preview to the pizza section, where photo-less and description-less items sit.
    await p.evaluate(() => {
      const el = document.querySelector('.pv [data-edit-id="category:pizza"]');
      const c = document.querySelector(".canvas");
      if (el && c) c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - 12;
    });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/${prefix}-editor-preview-${w}.png` });
  }
  await ctx.close();
}
await b.close();
console.log("wrote", OUT);
