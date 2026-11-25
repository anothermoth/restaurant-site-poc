import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Menu } from "@restaurant-site-poc/menu-schema";
import type { PublishHook } from "./service.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

/**
 * Writes the published menu to data/published/<slug>.menu.json and, when
 * PUBLISH_BUILD=1, re-runs the Astro build against it (MENU_PATH).
 */
export function filePublisher(opts: { dir?: string; build?: boolean } = {}): PublishHook {
  const dir = opts.dir ?? join(ROOT, "data/published");
  return async (slug, menu: Menu) => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${slug}.menu.json`);
    writeFileSync(file, JSON.stringify(menu, null, 2) + "\n");
    if (!opts.build) return { file };
    const started = Date.now();
    await new Promise<void>((ok, fail) => {
      const p = spawn("npm", ["run", "build", "-w", "@restaurant-site-poc/site"], { cwd: ROOT, env: { ...process.env, MENU_PATH: file }, stdio: "ignore" });
      p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`site build exited ${code}`))));
      p.on("error", fail);
    });
    return { file, buildMs: Date.now() - started };
  };
}
