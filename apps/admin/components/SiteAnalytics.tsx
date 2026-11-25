"use client";
import { Analytics } from "@vercel/analytics/next";
import { isInternalPath } from "../lib/format.ts";

/** Vercel Web Analytics (cookieless page views). Internal pages are never counted. */
export function SiteAnalytics() {
  return <Analytics beforeSend={(e) => (isInternalPath(new URL(e.url).pathname) ? null : e)} />;
}
