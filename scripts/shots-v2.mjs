/**
 * Editor screenshots for the owner-first redesign (docs/redesign-v2).
 *   node scripts/shots-v2.mjs <before|after> [editorUrl]
 * Every request below is matched by the built-in parser, so no AI credits are used.
 */
import { chromium } from "playwright-core";
const [prefix = "after", EDITOR = "https://restaurant-site-poc-editor.vercel.app"] = process.argv.slice(2);
const OUT = process.env.OUT ?? "docs/redesign-v2";
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const views = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${prefix}-${name}.png` });
const ask = async (p, text) => {
  await p.fill("#cmd", text);
  await p.press("#cmd", "Enter");
  await p.waitForTimeout(2500);
};
for (const [name, opts] of Object.entries(views)) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.goto(EDITOR, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await shot(p, `idle-${name}`);
  await ask(p, "Change the margherita to $16.50");
  await shot(p, `review-${name}`);
  if (prefix === "before") {
    await ctx.close();
    continue;
  }
  await p.getByRole("button", { name: "Approve" }).click();
  await p.waitForTimeout(2000);
  await shot(p, `ready-${name}`);
  await p.getByRole("button", { name: "More" }).click();
  await p.waitForTimeout(400);
  await shot(p, `more-${name}`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /pick something from your menu/i }).click();
  await p.waitForTimeout(600);
  await shot(p, `menu-${name}`);
  await p.getByRole("complementary", { name: "Menu items" }).getByRole("button", { name: /Burrata/ }).click();
  await p.waitForTimeout(800);
  await shot(p, `selected-${name}`);
  await ctx.close();
}
await b.close();
console.log("wrote", OUT);
