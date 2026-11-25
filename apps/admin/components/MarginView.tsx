"use client";
import { useCallback, useEffect, useState } from "react";

interface Totals {
  calls: number;
  creditsCharged: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgCostPerCallUsd: number;
  revenueUsd: number;
  marginUsd: number;
  marginPct: number | null;
}
interface Margin {
  days: number;
  creditPriceUsd: number;
  limits: { defaultCredits: number; dailySpendCapUsd: number | null; llmPerSessionHour: number | null; llmPerIpHour: number | null };
  today: { day: string; usd: number; calls: number };
  total: Totals & { cacheHits: number };
  rows: Array<Totals & { day: string; account: string }>;
}

const usd = (n: number) => (Math.abs(n) < 0.01 && n !== 0 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);

/** Internal view: real token cost vs. what the credits would bill. Needs ADMIN_TOKEN when one is set. */
export function MarginView() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Margin | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    setError(null);
    const r = await fetch("/api/admin/margin?days=30", { headers: t ? { "x-admin-token": t } : {} });
    const body = await r.json();
    if (!r.ok) return setError(body.error ?? `HTTP ${r.status}`);
    setData(body as Margin);
  }, []);

  useEffect(() => {
    const t = sessionStorage.getItem("rsp-admin-token") ?? "";
    setToken(t);
    void load(t);
  }, [load]);

  return (
    <main className="dev">
      <h1>Credits and margin (internal)</h1>
      <p className="muted">Real model cost per call, logged from the provider&apos;s token counts, against what the credits would bill. Owners only ever see credits.</p>
      <form
        className="cmd-form"
        onSubmit={(e) => {
          e.preventDefault();
          sessionStorage.setItem("rsp-admin-token", token);
          void load(token);
        }}
      >
        <label htmlFor="tok" className="sr-only">Admin token</label>
        <input id="tok" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token (if set)" autoComplete="off" />
        <button className="btn" type="submit">Load</button>
      </form>
      {error && <p className="reply reply-error">{error}</p>}
      {data && (
        <>
          <dl className="kpis">
            <div><dt>AI calls ({data.days} d)</dt><dd>{data.total.calls}</dd></div>
            <div><dt>Credits charged</dt><dd>{data.total.creditsCharged}</dd></div>
            <div><dt>Free cache hits</dt><dd>{data.total.cacheHits}</dd></div>
            <div><dt>Real cost</dt><dd>{usd(data.total.costUsd)}</dd></div>
            <div><dt>Avg cost / call</dt><dd>{usd(data.total.avgCostPerCallUsd)}</dd></div>
            <div><dt>Credit revenue @ {usd(data.creditPriceUsd)}</dt><dd>{usd(data.total.revenueUsd)}</dd></div>
            <div><dt>Margin</dt><dd>{usd(data.total.marginUsd)}{data.total.marginPct !== null ? ` (${data.total.marginPct}%)` : ""}</dd></div>
            <div>
              <dt>Today&apos;s spend / cap</dt>
              <dd>{usd(data.today.usd)} / {data.limits.dailySpendCapUsd === null ? "no cap" : usd(data.limits.dailySpendCapUsd)}</dd>
            </div>
          </dl>
          <table className="diff">
            <thead>
              <tr><th>Day (UTC)</th><th>Account</th><th>Calls</th><th>Tokens in (cached) / out</th><th>Cost</th><th>Revenue</th><th>Margin</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.day}-${r.account}`}>
                  <td>{r.day}</td>
                  <td>{r.account}</td>
                  <td>{r.calls}</td>
                  <td>{r.inputTokens} ({r.cachedInputTokens}) / {r.outputTokens}</td>
                  <td>{usd(r.costUsd)}</td>
                  <td>{usd(r.revenueUsd)}</td>
                  <td>{usd(r.marginUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
