/**
 * README screenshots of the live site and editor:
 *   node scripts/readme-shots.mjs [siteUrl] [editorUrl]
 */
import { chromium } from "playwright-core";
const [SITE = "https://restaurant-site-poc.pages.dev", EDITOR = "https://restaurant-site-poc-editor.vercel.app"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const settle = (p) => p.waitForTimeout(700);

const desk = await b.newContext({ viewport: { width: 1280, height: 800 } });
let p = await desk.newPage();
await p.goto(`${SITE}/`, { waitUntil: "networkidle" });
await settle(p);
await p.screenshot({ path: "docs/screenshot-home.png" });
await p.goto(`${SITE}/admin/report/`, { waitUntil: "networkidle" });
await settle(p);
await p.screenshot({ path: "docs/screenshot-report.png" });
await desk.close();

const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p = await phone.newPage();
await p.goto(`${SITE}/menu/`, { waitUntil: "networkidle" });
await p.waitForSelector("html[data-cart-ready]");
await p.locator('[data-add-item="margherita"]').scrollIntoViewIfNeeded();
await p.click('[data-add-item="margherita"]');
await settle(p);
await p.screenshot({ path: "docs/screenshot-modifiers.png" });
await p.getByRole("button", { name: /add to cart/i }).click();
await p.click('[data-add-item="burrata"]');
await p.click('[data-add-item="skillet-cookie"]');
await p.getByRole("button", { name: /open cart/i }).click();
await settle(p);
await p.screenshot({ path: "docs/screenshot-cart.png" });
await phone.close();

const ed = await b.newContext({ viewport: { width: 1440, height: 900 } });
p = await ed.newPage();
await p.goto(EDITOR, { waitUntil: "networkidle" });
await settle(p);
await p.getByRole("complementary", { name: "Menu items" }).getByRole("button", { name: /Margherita/ }).click();
await settle(p);
await p.fill("#cmd", "make this $16.50");
await p.press("#cmd", "Enter");
await p.waitForSelector("section.change");
await p.waitForTimeout(1200);
await p.screenshot({ path: "docs/live-editor.png" });
await ed.close();
await b.close();
console.log("wrote README screenshots");
