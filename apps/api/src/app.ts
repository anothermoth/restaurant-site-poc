import express from "express";
import type { Menu } from "@restaurant-site-poc/menu-schema";
import { EditService } from "./service.ts";
import { createRouter } from "./router.ts";
import { configFromEnv, type RuntimeConfig } from "./config.ts";

/** Express adapter over the shared router (the same router backs the Next.js route handler). */
export function createApp(service: EditService, opts: { seedMenu?: Menu; config?: RuntimeConfig } = {}) {
  const handle = createRouter(service, { seedMenu: opts.seedMenu, config: opts.config ?? configFromEnv({}) });
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", async (req, res) => {
    const url = new URL(req.originalUrl, "http://local");
    const r = await handle({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      body: req.body,
      header: (n) => req.get(n),
      ip: req.ip ?? "",
      secure: req.secure,
    });
    res.status(r.status).set(r.headers).json(r.body);
  });
  return app;
}
