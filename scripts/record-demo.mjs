/* global window, document */
/**
 * Records the demo video (docs/demo.webm, converted to demo.mp4/demo.gif by
 * scripts/demo-media.sh) and the README editor screenshots against the owner-first
 * editor (v2). Defaults to the live public demo; every request is a built-in phrase,
 * so the run never calls the AI model.
 *
 *   ADMIN_TOKEN=… node scripts/record-demo.mjs [editorUrl] [siteUrl]
 *
 * ADMIN_TOKEN (optional) sets this visitor's credits to 0 near the end to show the
 * "AI helper paused" state, and captures the internal margin view (/dev).
 * Speech recognition is simulated (headless Chrome has no mic): a stand-in
 * SpeechRecognition returns a scripted transcript when the mic button is released.
 * Everything after the transcript is the real stack.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";

const [ADMIN = "https://restaurant-site-poc-editor.vercel.app", SITE = "https://restaurant-site-poc.pages.dev"] = process.argv.slice(2);
const OUT = "docs";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const VID = "docs/.video-tmp";
rmSync(VID, { recursive: true, force: true });
mkdirSync(VID, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const size = { width: 1366, height: 860 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: VID, size } });
await context.addInitScript(() => {
  class FakeRecognition {
    start() {}
    stop() {
      const t = window.__nextTranscript ?? "";
      setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: t } }] });
        this.onend?.();
      }, 150);
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:rgba(17,17,17,.88);color:#fff;font:600 17px system-ui;padding:10px 18px;border-radius:12px;max-width:90%;text-align:center;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function speak(transcript) {
  await page.evaluate((t) => (window.__nextTranscript = t), transcript);
  const mic = page.getByRole("button", { name: "Hold to talk" });
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await pause(1300);
  await page.mouse.up();
}

async function type(text) {
  await page.fill("#cmd", "");
  await page.type("#cmd", text, { delay: 30 });
  await page.press("#cmd", "Enter");
}

const card = () => page.waitForSelector('section[aria-label="Pending change"]', { timeout: 20000 });
const approve = async () => {
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForSelector('section[aria-label="Pending change"]', { state: "detached" });
};
const more = async (item) => {
  await page.getByRole("button", { name: "More" }).click();
  await pause(500);
  await page.getByRole("menuitem", { name: item }).click();
};
const recent = () => page.getByRole("complementary", { name: "Recent changes" });

await page.goto(ADMIN, { waitUntil: "networkidle" });
// A new browser context is a new visitor, so this run starts from a fresh copy of the sample menu.
await pause(600);

await caption("The owner's editor: one question, a live preview of the site. Nothing goes live until you publish.");
await pause(3000);

await caption("Hold the mic: “Change the price of the margarita to $16.50” (a built-in phrase: free)");
await speak("Change the price of the margarita to $16.50");
await card();
await pause(2800);
await page.screenshot({ path: `${OUT}/editor-pending-price.png` });
await caption("Prices always wait for your OK. Approve saves it to the draft.");
await pause(1400);
await approve();
await pause(1400);

await caption("Or pick something from your menu, then just say what changed");
await page.getByRole("button", { name: /pick something from your menu/i }).click();
await pause(900);
await page.getByRole("complementary", { name: "Menu items" }).getByRole("button", { name: /Burrata/ }).click();
await pause(1200);
await type("86 it");
await card();
await pause(2200);
await page.screenshot({ path: `${OUT}/editor-click-to-target.png` });
await approve();
await pause(900);
await page.getByRole("button", { name: /^Clear selection/ }).click().catch(() => {});
await pause(500);

await caption("Two dishes match? It asks instead of guessing.");
await type("hide the caesar salad");
await page.waitForSelector(".reply .options");
await pause(2400);
await page.screenshot({ path: `${OUT}/editor-clarify.png` });
await page.locator(".reply .options button").first().click();
await card();
await pause(1400);
await caption("Discard: nothing changes");
await page.getByRole("button", { name: "Discard" }).click();
await pause(1600);

await caption("Recent changes, with one-tap undo (free)");
await more(/Recent changes/);
await pause(1000);
await recent().getByRole("button", { name: /Undo: Hide "Burrata/ }).click();
await pause(1800);
await page.screenshot({ path: `${OUT}/editor-history.png` });
await page.getByRole("button", { name: "Close recent changes" }).click();
await pause(600);

await caption("Publish: in the public demo it goes to your private preview, never the real site");
await page.locator(".topbar").getByRole("button", { name: /^Publish/ }).click();
await page.waitForSelector(".reply-ok >> text=Published", { timeout: 60000 });
await pause(2000);
await page.goto(`${ADMIN}/published`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-edit-id="category:pizza"]');
await pause(500);
await caption("Published preview: margherita now 16.50, burrata back after the undo");
await page.evaluate(() => document.querySelector('[data-edit-id="category:pizza"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
await pause(3000);
await page.screenshot({ path: `${OUT}/demo-published-preview.png` });

if (ADMIN_TOKEN) {
  // This visitor runs out of AI credits (set through the internal admin API).
  const sid = (await context.cookies(ADMIN)).find((c) => c.name === "rsp_sid").value;
  const sandbox = `ember-and-elm~${createHash("sha256").update(`sbx:${sid}`).digest("base64url").slice(0, 22)}`;
  const r = await fetch(`${ADMIN}/api/admin/sites/${encodeURIComponent(sandbox)}/credits`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
    body: JSON.stringify({ credits: 0 }),
  });
  if (!r.ok) throw new Error(`set credits: HTTP ${r.status}`);
  await page.goto(ADMIN, { waitUntil: "networkidle" });
  await caption("Out of AI credits: a request the built-in phrases don't cover pauses, with no model call…");
  await type("put the desserts right after the starters please");
  await page.waitForSelector(".reply-warn");
  await pause(2600);
  await page.screenshot({ path: `${OUT}/editor-credits-paused.png` });
  await caption("…and built-in phrases still work, free");
  await speak("Mark the black bean burger as vegan");
  await card();
  await pause(2600);
  await page.getByRole("button", { name: "Discard" }).click();
  await pause(600);
}

await caption("The public site (static Astro on Cloudflare Pages)");
await page.goto(SITE, { waitUntil: "networkidle" });
await caption("The public site (static Astro on Cloudflare Pages)");
await pause(2200);
await page.evaluate(() => window.scrollTo({ top: 760, behavior: "smooth" }));
await pause(2200);
await page.goto(`${SITE}/menu`, { waitUntil: "networkidle" });
await caption("The menu: a classic list, one photo per section, a cart island for ordering");
await pause(1800);
await page.evaluate(() => window.scrollTo({ top: 1250, behavior: "smooth" }));
await pause(2600);

await context.close();
if (ADMIN_TOKEN) {
  // Internal margin view (separate context, not in the video).
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 700 } });
  const p2 = await ctx2.newPage();
  await p2.addInitScript((t) => sessionStorage.setItem("rsp-admin-token", t), ADMIN_TOKEN);
  await p2.goto(`${ADMIN}/dev`, { waitUntil: "networkidle" });
  await p2.waitForSelector(".kpis");
  await p2.screenshot({ path: `${OUT}/dev-margin.png` });
  await ctx2.close();
}
await browser.close();
const [video] = readdirSync(VID).filter((f) => f.endsWith(".webm"));
renameSync(`${VID}/${video}`, `${OUT}/demo.webm`);
rmSync(VID, { recursive: true, force: true });
console.log("wrote docs/demo.webm and screenshots");
