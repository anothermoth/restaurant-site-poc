import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { llmConfigFromEnv } from "@restaurant-site-poc/command-engine";
import { createApp } from "./app.ts";
import { collections } from "./store.ts";
import { EditService } from "./service.ts";
import { filePublisher } from "./publish.ts";

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017";
const DB = process.env.MONGO_DB ?? "restaurant_site_poc";
const PORT = Number(process.env.PORT ?? 4000);

const seed = parseMenu(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../data/sample-restaurant.menu.json"), "utf8")));
const client = await new MongoClient(MONGO_URL).connect();
const llm = llmConfigFromEnv();
const service = new EditService({
  c: await collections(client.db(DB)),
  llm,
  onPublish: filePublisher({ build: process.env.PUBLISH_BUILD === "1" }),
});
await service.seed(seed.restaurant.slug, seed);
createApp(service, { seedMenu: seed }).listen(PORT, () => {
  console.log(`api on http://localhost:${PORT} (mongo ${DB}; LLM fallback ${llm ? `on: ${llm.model}` : "off"})`);
});
