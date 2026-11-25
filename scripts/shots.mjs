/**
 * Desktop + mobile screenshots of the public site and the editor.
 *   node scripts/shots.mjs <prefix> [siteUrl] [editorUrl]
 */
import { chromium } from "playwright-core";
const [prefix = "after", SITE = "https://restaurant-site-poc.pages.dev", EDITOR = "https://restaurant-site-poc-editor.vercel.app"] = process.argv.slice(2);
const OUT = "docs/redesign";
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const views = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
for (const [name, opts] of Object.entries(views)) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${prefix}-site-home-${name}.png` });
  await p.goto(`${SITE}/menu/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${prefix}-site-menu-${name}.png` });
  await p.goto(EDITOR, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  if (prefix !== "before") await p.screenshot({ path: `${OUT}/${prefix}-editor-idle-${name}.png` });
  await p.fill("#cmd", "Change the price of the margarita to $16.50");
  await p.press("#cmd", "Enter");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/${prefix}-editor-${name}.png` });
  await ctx.close();

  if (prefix === "before") continue;
  // Click-to-target: select an item in the menu panel, then "make this $17".
  const ctx2 = await b.newContext(opts);
  const q = await ctx2.newPage();
  await q.goto(EDITOR, { waitUntil: "networkidle" });
  await q.waitForTimeout(800);
  if (name === "mobile") {
    await q.getByRole("button", { name: "Menu", exact: true }).click();
    await q.waitForTimeout(500);
    await q.screenshot({ path: `${OUT}/${prefix}-editor-menu-sheet-${name}.png` });
  }
  await q.getByRole("complementary", { name: "Menu items" }).getByRole("button", { name: /Hot Honey Pepperoni/ }).click();
  await q.waitForTimeout(700);
  await q.fill("#cmd", "make this $17");
  await q.press("#cmd", "Enter");
  await q.waitForTimeout(2500);
  await q.screenshot({ path: `${OUT}/${prefix}-editor-target-${name}.png` });
  await ctx2.close();
}
await b.close();
console.log("wrote", OUT);
