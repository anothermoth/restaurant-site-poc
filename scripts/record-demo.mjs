/* global window, document */
/**
 * Records the demo video and screenshots against a running stack:
 *   mongod, API (:4000), admin (`next start`, :3000), and `astro preview` (:4321).
 * Speech recognition is simulated in the recording (headless Chrome has no mic):
 * a stand-in SpeechRecognition returns a scripted transcript when the
 * push-to-talk button is released. Everything after the transcript is real.
 *
 *   CHROME_PATH=/usr/bin/google-chrome node scripts/record-demo.mjs
 */
import { chromium } from "playwright-core";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";

const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3000";
const SITE = process.env.SITE_URL ?? "http://localhost:4321";
const OUT = "docs";
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

await caption("🎙 Push-to-talk: “Change the price of the margarita to $16.50” (parser match, $0)");
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

await caption("Not in the grammar → LLM fallback with a compact catalog: “knock a dollar off the smash burger”");
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

await caption("Publish → API writes the menu JSON and re-runs the Astro build");
await page.locator(".edit-bar").getByRole("button", { name: "Publish" }).click();
await page.waitForSelector(".reply-ok >> text=Published", { timeout: 60000 });
await pause(2000);

await caption("Published static site (Astro) now shows the approved changes");
await page.goto(`${SITE}/menu#pizza`, { waitUntil: "networkidle" });
await caption("Published static site (Astro) now shows the approved changes");
await pause(3000);

await context.close();
await browser.close();
const [video] = readdirSync(VID).filter((f) => f.endsWith(".webm"));
renameSync(`${VID}/${video}`, `${OUT}/demo.webm`);
rmSync(VID, { recursive: true, force: true });
console.log("wrote docs/demo.webm and screenshots");
