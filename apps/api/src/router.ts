import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { parseMenu, type Menu } from "@restaurant-site-poc/menu-schema";
import { checkMenu } from "@restaurant-site-poc/menu-checker";
import { EditService, SANDBOX_SEP, ServiceError } from "./service.ts";
import type { RuntimeConfig } from "./config.ts";

/**
 * Framework-free HTTP layer. Express (local) and Next.js route handlers (Vercel)
 * both adapt their request into `ApiRequest` and send back `ApiResponse`, so the
 * routes, validation, sessions and demo rules exist exactly once.
 */
export interface ApiRequest {
  method: string;
  /** Path starting with /api/ */
  path: string;
  query: URLSearchParams;
  body: unknown;
  header: (name: string) => string | undefined;
  ip: string;
  /** True when the request came over HTTPS (sets the Secure cookie flag). */
  secure: boolean;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

const ProposeBody = z.object({
  utterance: z.string().trim().min(1).max(400),
  input: z.enum(["voice", "text"]).default("text"),
  // The item or section the owner clicked in the menu panel ("make this $14").
  target: z.object({ kind: z.enum(["item", "category"]), id: z.string().min(1).max(80) }).optional(),
});
const SettingsBody = z.object({ autoApproveLowRisk: z.boolean() }).partial();
const CreditsBody = z.object({ credits: z.number().int().min(0).max(100_000) });
const UndoBody = z.object({ changeId: z.string().optional() }).optional();

export const SESSION_COOKIE = "rsp_sid";
const SID = /^[A-Za-z0-9_-]{16,64}$/;

function cookie(req: ApiRequest, name: string): string | undefined {
  for (const part of (req.header("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export const hashIp = (ip: string) => createHash("sha256").update(`rsp:${ip}`).digest("base64url").slice(0, 16);

interface Ctx {
  req: ApiRequest;
  params: Record<string, string>;
  /** The site this request acts on: the real site, or the visitor's sandbox copy in demo mode. */
  slug: () => Promise<string>;
  sessionId: string;
  ipHash: string;
}

type Handler = (ctx: Ctx) => Promise<unknown>;

export function createRouter(service: EditService, opts: { seedMenu?: Menu; config: RuntimeConfig }) {
  const { config, seedMenu } = opts;
  const routes: Array<{ method: string; re: RegExp; keys: string[]; h: Handler }> = [];
  const on = (method: string, pattern: string, h: Handler) => {
    const keys: string[] = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), "([^/]+)"))}$`);
    routes.push({ method, re, keys, h });
  };

  const requireAdmin = (req: ApiRequest) => {
    if (config.adminToken ? req.header("x-admin-token") !== config.adminToken : config.demo) {
      throw new ServiceError(401, "Admin token required");
    }
  };

  on("GET", "/api/health", async () => ({ ok: true, demo: config.demo }));

  on("GET", "/api/sites/:slug", async ({ slug }) => {
    const s = await slug();
    const state = await service.state(s);
    return { ...state, slug: s.split(SANDBOX_SEP)[0], demo: config.demo, sandboxIdleMinutes: config.demo ? config.sandboxIdleMs / 60_000 : null };
  });
  on("GET", "/api/sites/:slug/published.json", async ({ slug }) => (await service.site(await slug())).published);
  on("GET", "/api/sites/:slug/report", async ({ slug }) => checkMenu((await service.site(await slug())).draft));
  on("POST", "/api/sites/:slug/commands", async ({ slug, req, sessionId, ipHash }) => {
    const body = ProposeBody.parse(req.body);
    return service.propose(await slug(), body.utterance, body.input, { sessionId, ipHash }, body.target);
  });
  on("POST", "/api/sites/:slug/changes/:id/approve", async ({ slug, params }) => service.approve(params.id!, await slug()));
  on("POST", "/api/sites/:slug/changes/:id/reject", async ({ slug, params }) => service.reject(params.id!, await slug()));
  on("POST", "/api/sites/:slug/undo", async ({ slug, req }) => service.undo(await slug(), UndoBody.parse(req.body ?? undefined)?.changeId));
  on("POST", "/api/sites/:slug/publish", async ({ slug }) => {
    const s = await slug();
    const r = await service.publish(s);
    // In demo mode nothing is written or rebuilt: the sandbox's published menu is rendered by the admin at /published.
    return config.demo ? { ...r, previewPath: "/published" } : r;
  });
  on("PATCH", "/api/sites/:slug/settings", async ({ slug, req }) => {
    await service.setSettings(await slug(), SettingsBody.parse(req.body));
    return { ok: true };
  });
  on("POST", "/api/sites/:slug/reset", async ({ slug, params }) => {
    if (!seedMenu || params.slug !== seedMenu.restaurant.slug) throw new ServiceError(404, "No seed for this site");
    await service.seed(await slug(), parseMenu(seedMenu), { reset: true });
    return { ok: true };
  });

  // Internal: unit economics and credit top-ups. Needs ADMIN_TOKEN (and is closed in demo mode without one).
  on("GET", "/api/admin/margin", async ({ req }) => {
    requireAdmin(req);
    const days = Math.min(90, Math.max(1, Number(req.query.get("days") ?? 7) || 7));
    return service.margin({ days });
  });
  on("PUT", "/api/admin/sites/:slug/credits", async ({ req, params }) => {
    requireAdmin(req);
    const { credits } = CreditsBody.parse(req.body);
    await service.setCredits(params.slug!, credits);
    return { ok: true, credits };
  });

  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    let sessionId = cookie(req, SESSION_COOKIE);
    if (!sessionId || !SID.test(sessionId)) {
      sessionId = randomBytes(18).toString("base64url");
      headers["Set-Cookie"] = `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${req.secure ? "; Secure" : ""}`;
    }
    const sid = sessionId;
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(req.path);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
        let resolved: string | undefined;
        const slug = async () => {
          if (resolved) return resolved;
          const base = params.slug!;
          if (!config.demo) return (resolved = base);
          if (!seedMenu || base !== seedMenu.restaurant.slug) throw new ServiceError(404, `No site "${base}"`);
          // Keyed by a hash of the session cookie, so the cookie value never appears in data or logs.
          resolved = `${base}${SANDBOX_SEP}${createHash("sha256").update(`sbx:${sid}`).digest("base64url").slice(0, 22)}`;
          await service.touchSandbox(resolved, seedMenu, config.sandboxIdleMs);
          return resolved;
        };
        const body = await r.h({ req, params, slug, sessionId: sid, ipHash: hashIp(req.ip) });
        return { status: 200, body, headers };
      }
      return { status: 404, body: { error: "Not found" }, headers };
    } catch (err) {
      if (err instanceof ServiceError) return { status: err.status, body: { error: err.message }, headers };
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.issues[0]?.message ?? "Bad request" }, headers };
      console.error(err);
      return { status: 500, body: { error: "Internal error" }, headers };
    }
  };
}
