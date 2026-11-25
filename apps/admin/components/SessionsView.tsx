"use client";
import { useCallback, useEffect, useState } from "react";
import { formatChicago } from "../lib/format.ts";

interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  active: boolean;
  requests: number;
  approved: number;
  rejected: number;
  undone: number;
  published: number;
  clarify: number;
  refused: number;
  aiCalls: number;
  aiCostUsd: number;
  utterances: Array<{ at: string; type: string; text: string }>;
}
interface Sessions {
  days: number;
  generatedAt: string;
  totals: { sessions: number; active: number; withRequests: number; requests: number; approved: number; undone: number; published: number; aiCalls: number; aiCostUsd: number };
  sessions: Session[];
}

const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);

/** Internal: who tried the demo editor. Needs ADMIN_TOKEN. Times are America/Chicago. */
export function SessionsView() {
  const [token, setToken] = useState("");
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Sessions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: string, d: number) => {
    setError(null);
    const r = await fetch(`/api/admin/sessions?days=${d}`, { headers: t ? { "x-admin-token": t } : {} });
    const body = await r.json();
    if (!r.ok) return setError(body.error ?? `HTTP ${r.status}`);
    setData(body as Sessions);
  }, []);

  useEffect(() => {
    const t = sessionStorage.getItem("rsp-admin-token") ?? "";
    setToken(t);
    if (t) void load(t, 7);
  }, [load]);

  return (
    <main className="dev">
      <h1>Demo sessions (internal)</h1>
      <p className="muted">One row per visitor sandbox (a private browser session). No IP addresses or cookies are stored; typed requests are kept for a day, counts and times are kept for good. Times are Central (America/Chicago).</p>
      <form
        className="cmd-form"
        onSubmit={(e) => {
          e.preventDefault();
          sessionStorage.setItem("rsp-admin-token", token);
          void load(token, days);
        }}
      >
        <label htmlFor="tok" className="sr-only">Admin token</label>
        <input id="tok" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" autoComplete="off" />
        <label htmlFor="days" className="sr-only">Days</label>
        <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Last day</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button className="btn" type="submit">Load</button>
      </form>
      {error && <p className="reply reply-error">{error}</p>}
      {data && (
        <>
          <dl className="kpis">
            <div><dt>Sessions ({data.days} d)</dt><dd>{data.totals.sessions}</dd></div>
            <div><dt>Tried a change</dt><dd>{data.totals.withRequests}</dd></div>
            <div><dt>Active now</dt><dd>{data.totals.active}</dd></div>
            <div><dt>Requests</dt><dd>{data.totals.requests}</dd></div>
            <div><dt>Approved / undone</dt><dd>{data.totals.approved} / {data.totals.undone}</dd></div>
            <div><dt>Published</dt><dd>{data.totals.published}</dd></div>
            <div><dt>AI calls / cost</dt><dd>{data.totals.aiCalls} / {usd(data.totals.aiCostUsd)}</dd></div>
          </dl>
          <table className="diff">
            <thead>
              <tr><th>Session</th><th>Started</th><th>Last activity</th><th>Requests</th><th>Approved</th><th>Undone</th><th>Published</th><th>AI calls</th><th>AI cost</th><th>What they tried</th></tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}{s.active ? " ●" : ""}</td>
                  <td>{formatChicago(s.createdAt)}</td>
                  <td>{formatChicago(s.lastSeenAt)}</td>
                  <td>{s.requests}</td>
                  <td>{s.approved}</td>
                  <td>{s.undone}</td>
                  <td>{s.published}</td>
                  <td>{s.aiCalls}</td>
                  <td>{usd(s.aiCostUsd)}</td>
                  <td>{s.utterances.length ? s.utterances.map((u) => `“${u.text}”${u.type === "proposed" ? "" : ` (${u.type})`}`).join(" · ") : <span className="muted">(none on file)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.sessions.length && <p className="muted">No sessions in this window.</p>}
        </>
      )}
    </main>
  );
}
