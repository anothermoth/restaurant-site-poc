import { MongoClient } from "mongodb";
import type { Menu } from "@restaurant-site-poc/menu-schema";
import { llmConfigFromEnv } from "@restaurant-site-poc/command-engine";
import { collections } from "./store.ts";
import { EditService, type PublishHook } from "./service.ts";
import { createRouter } from "./router.ts";
import { configFromEnv } from "./config.ts";

/**
 * One service + router per process, shared by every request. On serverless
 * (Vercel) the module stays warm between invocations, so the Mongo connection
 * pool is reused instead of reconnecting on each request.
 */
export async function createRuntime(seedMenu: Menu, opts: { env?: Record<string, string | undefined>; onPublish?: PublishHook } = {}) {
  const env = opts.env ?? process.env;
  const config = configFromEnv(env);
  const client = await new MongoClient(env.MONGO_URL ?? "mongodb://127.0.0.1:27017", { maxPoolSize: 5 }).connect();
  const llm = llmConfigFromEnv(env);
  const service = new EditService({
    c: await collections(client.db(env.MONGO_DB ?? "restaurant_site_poc")),
    llm,
    limits: config.limits,
    // Demo publishes never write files or rebuild; they only update the sandbox.
    onPublish: config.demo ? undefined : (opts.onPublish ?? webhookPublisher(env.PUBLISH_HOOK_URL)),
  });
  await service.seed(seedMenu.restaurant.slug, seedMenu);
  return { client, service, config, llm, handle: createRouter(service, { seedMenu, config }) };
}

/**
 * Production publish: ping a static-host build hook (e.g. a Cloudflare Pages deploy hook).
 * The Astro build then fetches the published menu from MENU_URL.
 */
export function webhookPublisher(url: string | undefined): PublishHook | undefined {
  if (!url) return undefined;
  return async () => {
    const r = await fetch(url, { method: "POST" });
    return { buildHook: r.ok ? "triggered" : `failed (HTTP ${r.status})` };
  };
}
