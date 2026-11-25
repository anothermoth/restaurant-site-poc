/* global window, document */
/**
 * Records the demo video and screenshots against a running stack. Two modes:
 * - DEMO_MODE=1 admin (`next start`, in-process API, :3000) with ADMIN_TOKEN set:
 *   publish goes to the visitor's private preview, and the run ends at 0 credits;
 * - otherwise: Express API (:4000) + admin + `astro preview` (:4321), publish rebuilds Astro.
 * Speech recognition is simulated in the recording (headless Chrome has no mic):
 * a stand-in SpeechRecognition returns a scripted transcript when the
 * push-to-talk button is released. Everything after the transcript is real.
 *
 *   CHROME_PATH=/usr/bin/google-chrome node scripts/record-demo.mjs
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";

const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3000";
const SITE = process.env.SITE_URL ?? "http://localhost:4321";
const OUT = "docs";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const DEMO = (await (await fetch(`${ADMIN}/api/health`)).json()).demo === true;
const VID = "docs/.video-tmp";
rmSync(VID, { recursive: true, force: true });
mkdirSync(VID, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, recordVideo: { dir: VID, size: { width: 1366, height: 860 } } });
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
      el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:rgba(17,17,17,.88);color:#fff;font:600 17px system-ui;padding:10px 18px;border-radius:12px;max-width:90%;text-align:center";
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
  await page.type("#cmd", text, { delay: 25 });
  await page.click('form.cmd-form button[type="submit"]');
}

await page.goto(ADMIN, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Reset demo data" }).click();
await pause(800);
await caption("Owner-facing editor (Next.js). Edits are previews until approved and published.");
await pause(2200);

await caption("🎙 Push-to-talk: “Change the price of the margarita to $16.50” (built-in phrase: free, no credit)");
await speak("Change the price of the margarita to $16.50");
await page.waitForSelector("section.change");
await page.locator('[data-edit-id="item:margherita.price"]').scrollIntoViewIfNeeded();
await pause(2600);
await page.screenshot({ path: `${OUT}/editor-pending-price.png` });
await caption("Prices always need approval. Approve → written to the draft (MongoDB, versioned).");
await page.getByRole("button", { name: "Approve" }).click();
await pause(1600);

await caption("Typed fallback: “86 the burrata”");
await type("86 the burrata");
await page.waitForSelector("section.change");
await pause(1800);
await page.getByRole("button", { name: "Approve" }).click();
await pause(1200);

await caption("Not a built-in phrase → AI fallback (1 credit): “knock a dollar off the smash burger”");
await type("knock a dollar off the smash burger");
await page.waitForSelector("section.change", { timeout: 15000 });
await page.locator('[data-edit-id="item:smash-burger.price"]').scrollIntoViewIfNeeded();
await pause(3200);
await page.screenshot({ path: `${OUT}/editor-llm-fallback.png` });
await page.getByRole("button", { name: "Approve" }).click();
await pause(1200);

await caption("Ambiguous name → it asks instead of guessing");
await type("hide the caesar salad");
await page.waitForSelector(".reply .options");
await pause(2000);
await page.screenshot({ path: `${OUT}/editor-clarify.png` });
await page.locator(".reply .options button").last().click();
await page.waitForSelector("section.change");
await pause(1400);
await caption("Reject: nothing changes");
await page.getByRole("button", { name: "Reject" }).click();
await pause(1400);

await caption("Undo from history (free, refuses if a later edit touched the same field)");
await page.getByRole("button", { name: /Undo: Hide "Burrata/ }).click();
await pause(1800);
await page.screenshot({ path: `${OUT}/editor-history.png`, fullPage: true });

if (DEMO) {
  await caption("Publish → your private preview (the public demo never changes the live site)");
  await page.locator(".edit-bar").getByRole("button", { name: "Publish" }).click();
  await page.waitForSelector(".reply-ok >> text=Published", { timeout: 60000 });
  await pause(1800);
  await page.goto(`${ADMIN}/published`, { waitUntil: "networkidle" });
  await page.locator('[data-edit-id="category:pizza"]').scrollIntoViewIfNeeded();
  await caption("Published preview: margherita $16.50, burrata back after the undo");
  await pause(2600);
  await page.screenshot({ path: `${OUT}/demo-published-preview.png` });

  // End state: this visitor has used up their credits. (Set through the internal admin API.)
  const sid = (await context.cookies(ADMIN)).find((c) => c.name === "rsp_sid").value;
  const sandbox = `ember-and-elm~${createHash("sha256").update(`sbx:${sid}`).digest("base64url").slice(0, 22)}`;
  const r = await fetch(`${ADMIN}/api/admin/sites/${encodeURIComponent(sandbox)}/credits`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
    body: JSON.stringify({ credits: 0 }),
  });
  if (!r.ok) throw new Error(`set credits: HTTP ${r.status}`);
  await page.goto(ADMIN, { waitUntil: "networkidle" });
  await caption("Out of credits → the AI helper pauses, with no model call…");
  await type("put the desserts right after the starters please");
  await page.waitForSelector(".reply-warn");
  await pause(2400);
  await page.screenshot({ path: `${OUT}/editor-credits-paused.png` });
  await caption("…and built-in phrases still work, free");
  await speak("Mark the black bean burger as vegan");
  await page.waitForSelector("section.change");
  await pause(2600);
} else {
  await caption("Publish → API writes the menu JSON and re-runs the Astro build");
  await page.locator(".edit-bar").getByRole("button", { name: "Publish" }).click();
  await page.waitForSelector(".reply-ok >> text=Published", { timeout: 60000 });
  await pause(2000);
  await caption("Published static site (Astro) now shows the approved changes");
  await page.goto(`${SITE}/menu#pizza`, { waitUntil: "networkidle" });
  await caption("Published static site (Astro) now shows the approved changes");
  await pause(3000);
}

await context.close();
if (DEMO && ADMIN_TOKEN) {
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
