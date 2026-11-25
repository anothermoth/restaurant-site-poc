import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import { checkMenu } from "@restaurant-site-poc/menu-checker";
import { EditService, ServiceError } from "./service.ts";

const ProposeBody = z.object({ utterance: z.string().trim().min(1).max(400), input: z.enum(["voice", "text"]).default("text") });
const SettingsBody = z.object({ autoApproveLowRisk: z.boolean() }).partial();

export function createApp(service: EditService, opts: { seedMenu?: Menu } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/sites/:slug", async (req, res) => {
    res.json(await service.state(req.params.slug));
  });

  /** The published menu as JSON: what the Astro build (or any renderer) consumes. */
  app.get("/api/sites/:slug/published.json", async (req, res) => {
    const site = await service.site(req.params.slug);
    res.set("Cache-Control", "public, max-age=30").json(site.published);
  });

  app.get("/api/sites/:slug/report", async (req, res) => {
    const site = await service.site(req.params.slug);
    res.json(checkMenu(site.draft));
  });

  app.post("/api/sites/:slug/commands", async (req, res) => {
    const body = ProposeBody.parse(req.body);
    res.json(await service.propose(req.params.slug, body.utterance, body.input));
  });

  app.post("/api/changes/:id/approve", async (req, res) => {
    res.json(await service.approve(req.params.id));
  });
  app.post("/api/changes/:id/reject", async (req, res) => {
    res.json(await service.reject(req.params.id));
  });
  app.post("/api/sites/:slug/undo", async (req, res) => {
    const id = typeof req.body?.changeId === "string" ? req.body.changeId : undefined;
    res.json(await service.undo(req.params.slug, id));
  });
  app.post("/api/sites/:slug/publish", async (req, res) => {
    res.json(await service.publish(req.params.slug));
  });
  app.patch("/api/sites/:slug/settings", async (req, res) => {
    await service.setSettings(req.params.slug, SettingsBody.parse(req.body));
    res.json({ ok: true });
  });
  app.post("/api/sites/:slug/reset", async (req, res) => {
    if (!opts.seedMenu || req.params.slug !== opts.seedMenu.restaurant.slug) throw new ServiceError(404, "No seed for this site");
    await service.seed(req.params.slug, parseMenu(opts.seedMenu), { reset: true });
    res.json({ ok: true });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ServiceError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues[0]?.message ?? "Bad request" });
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });
  return app;
}
