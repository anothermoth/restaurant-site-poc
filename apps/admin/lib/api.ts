import type { Change, ProposeResult, PublishResult, SiteState } from "./types.ts";

/** The item or section selected in the menu panel; "this"/"it" in a command refers to it. */
export interface EditTarget {
  kind: "item" | "category";
  id: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  state: (slug: string) => call<SiteState>(`/api/sites/${slug}`),
  propose: (slug: string, utterance: string, input: "voice" | "text", target?: EditTarget) =>
    call<ProposeResult>(`/api/sites/${slug}/commands`, { method: "POST", body: JSON.stringify({ utterance, input, ...(target ? { target } : {}) }) }),
  approve: (slug: string, id: string) => call<Change>(`/api/sites/${slug}/changes/${id}/approve`, { method: "POST" }),
  reject: (slug: string, id: string) => call<Change>(`/api/sites/${slug}/changes/${id}/reject`, { method: "POST" }),
  undo: (slug: string, changeId?: string) => call<Change>(`/api/sites/${slug}/undo`, { method: "POST", body: JSON.stringify({ changeId }) }),
  publish: (slug: string) => call<PublishResult>(`/api/sites/${slug}/publish`, { method: "POST" }),
  settings: (slug: string, s: { autoApproveLowRisk: boolean }) => call(`/api/sites/${slug}/settings`, { method: "PATCH", body: JSON.stringify(s) }),
  reset: (slug: string) => call(`/api/sites/${slug}/reset`, { method: "POST" }),
};
