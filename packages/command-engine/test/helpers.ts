import { readFileSync } from "node:fs";
import { parseMenu } from "@restaurant-site-poc/menu-schema";

export const sample = () =>
  parseMenu(JSON.parse(readFileSync(new URL("../../../data/sample-restaurant.menu.json", import.meta.url), "utf8")));
