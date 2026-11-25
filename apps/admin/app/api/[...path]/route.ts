import type { NextRequest } from "next/server";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { createRuntime } from "@restaurant-site-poc/api/runtime";
import sample from "../../../../../data/sample-restaurant.menu.json";

/**
 * The API, served by Next.js route handlers (how it runs on Vercel). It is the
 * same framework-free router the Express server uses locally. Set API_URL to
 * proxy to a separate Express server instead (see next.config.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
const g = globalThis as typeof globalThis & { __rspRuntime?: Promise<Runtime> };

function getRuntime(): Promise<Runtime> {
  if (!g.__rspRuntime) {
    g.__rspRuntime = createRuntime(parseMenu(sample)).catch((e: unknown) => {
      g.__rspRuntime = undefined; // retry on the next request (e.g. MongoDB was briefly unreachable)
      throw e;
    });
  }
  return g.__rspRuntime;
}

async function handler(req: NextRequest): Promise<Response> {
  let body: unknown;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const text = await req.text();
    if (text.length > 32_768) return Response.json({ error: "Request too large" }, { status: 413 });
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }
  const url = new URL(req.url);
  // Vercel sets x-real-ip / x-forwarded-for itself; clients can't spoof them there.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  let rt: Runtime;
  try {
    rt = await getRuntime();
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The database is unavailable. Try again in a moment." }, { status: 503 });
  }
  const r = await rt.handle({
    method: req.method,
    path: url.pathname,
    query: url.searchParams,
    body,
    header: (n) => req.headers.get(n) ?? undefined,
    ip,
    secure: url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
  });
  return Response.json(r.body, { status: r.status, headers: r.headers });
}

export { handler as GET, handler as POST, handler as PATCH, handler as PUT };
