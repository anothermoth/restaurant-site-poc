import type { Change, ProposeResult, SiteState } from "./types.ts";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  state: (slug: string) => call<SiteState>(`/api/sites/${slug}`),
  propose: (slug: string, utterance: string, input: "voice" | "text") =>
    call<ProposeResult>(`/api/sites/${slug}/commands`, { method: "POST", body: JSON.stringify({ utterance, input }) }),
  approve: (id: string) => call<Change>(`/api/changes/${id}/approve`, { method: "POST" }),
  reject: (id: string) => call<Change>(`/api/changes/${id}/reject`, { method: "POST" }),
  undo: (slug: string, changeId?: string) => call<Change>(`/api/sites/${slug}/undo`, { method: "POST", body: JSON.stringify({ changeId }) }),
  publish: (slug: string) => call<{ publishedVersion: number; buildMs?: number }>(`/api/sites/${slug}/publish`, { method: "POST" }),
  settings: (slug: string, s: { autoApproveLowRisk: boolean }) => call(`/api/sites/${slug}/settings`, { method: "PATCH", body: JSON.stringify(s) }),
  reset: (slug: string) => call(`/api/sites/${slug}/reset`, { method: "POST" }),
};
