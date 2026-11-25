import type { Change, Menu } from "../lib/types.ts";
import { costLine, fieldLabel, formatOpValue, plainRows } from "../lib/format.ts";

/**
 * The change waiting for the owner's OK, in plain words: what changes, old value
 * crossed out, new value, one big Approve. The technical diff, menu-checker effects
 * and what the request cost sit behind "Details".
 */
export function ChangeCard({ change, menu, onApprove, onReject, busy }: { change: Change; menu?: Menu; onApprove: () => void; onReject: () => void; busy?: boolean }) {
  const rows = menu ? plainRows(change, menu) : change.ops.map((op) => ({ key: op.path, what: fieldLabel(op.path), before: formatOpValue(op, op.before), after: formatOpValue(op, op.after) }));
  const fixes = change.findings.resolved.length;
  return (
    <section className="review" aria-label="Pending change">
      <p className="review-eyebrow">Check this change</p>
      {/* The rows already say what changes; the sentence is for changes without before/after values (like reordering). */}
      <h2 className={rows.length ? "sr-only" : "review-title"}>{change.summary.join(" · ")}</h2>
      {rows.length > 0 && (
        <dl className="review-rows">
          {rows.map((r) => (
            <div key={r.key} className="review-row">
              <dt>{r.what}</dt>
              <dd>
                <span className="before">{r.before}</span>
                <span className="arrow" aria-hidden="true">→</span>
                <span className="after">{r.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {change.risk === "high" && <p className="review-note">Prices and allergy info always wait for your OK.</p>}
      {fixes > 0 && <p className="review-good">✓ This also fixes {fixes === 1 ? "a problem" : `${fixes} problems`} on your menu.</p>}
      <div className="review-actions">
        <button type="button" className="btn btn-go" onClick={onApprove} disabled={busy}>
          Approve
        </button>
        <button type="button" className="btn btn-quiet" onClick={onReject} disabled={busy}>
          Discard
        </button>
      </div>
      <details className="review-details">
        <summary>Details</summary>
        <p className="muted small">You asked: “{change.utterance}”</p>
        <table className="diff">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {change.ops.map((op) => (
              <tr key={op.path}>
                <td>
                  <code>{fieldLabel(op.path)}</code>
                </td>
                <td>{formatOpValue(op, op.before)}</td>
                <td>{formatOpValue(op, op.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(change.findings.resolved.length > 0 || change.findings.added.length > 0) && (
          <div className="findings">
            {change.findings.resolved.map((f) => (
              <p key={`r-${f.ruleId}-${f.message}`} className="ok">✓ Fixes: {f.message}</p>
            ))}
            {change.findings.added.map((f) => (
              <p key={`a-${f.ruleId}-${f.message}`} className={`warn sev-${f.severity}`}>⚠ Menu check: {f.message}</p>
            ))}
          </div>
        )}
        <p className="muted small">{change.risk === "high" ? "Needs approval · price/allergen" : "Low risk"} · {costLine(change.source, change.credits)}</p>
      </details>
    </section>
  );
}
