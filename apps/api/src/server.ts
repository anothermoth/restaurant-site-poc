import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { createApp } from "./app.ts";
import { createRuntime } from "./runtime.ts";
import { filePublisher } from "./publish.ts";

const PORT = Number(process.env.PORT ?? 4000);
const seed = parseMenu(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../data/sample-restaurant.menu.json"), "utf8")));
const rt = await createRuntime(seed, { onPublish: filePublisher({ build: process.env.PUBLISH_BUILD === "1" }) });

createApp(rt.service, { seedMenu: seed, config: rt.config }).listen(PORT, () => {
  const L = rt.config.limits;
  console.log(
    `api on http://localhost:${PORT} (mongo ${process.env.MONGO_DB ?? "restaurant_site_poc"}; LLM fallback ${rt.llm ? `on: ${rt.llm.model}` : "off"}; ` +
      `${rt.config.demo ? "DEMO MODE, " : ""}${L.defaultCredits} credits/site, daily cap ${L.dailySpendCapUsd === null ? "none" : `$${L.dailySpendCapUsd}`})`,
  );
});
