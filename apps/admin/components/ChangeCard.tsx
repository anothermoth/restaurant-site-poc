import type { Change } from "../lib/types.ts";
import { costLine, fieldLabel, formatOpValue } from "../lib/format.ts";

export function ChangeCard({ change, onApprove, onReject, busy }: { change: Change; onApprove: () => void; onReject: () => void; busy?: boolean }) {
  return (
    <section className="card change" aria-label="Pending change">
      <header className="change-head">
        <h2>Pending change</h2>
        {change.risk === "high" ? (
          <span className="badge badge-risk" title="Prices and allergen/dietary tags always need your approval">Needs approval · price/allergen</span>
        ) : (
          <span className="badge">Low risk</span>
        )}
      </header>
      <p className="muted small">“{change.utterance}”</p>
      <ul className="summary">
        {change.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
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
              <td className="before">{formatOpValue(op, op.before)}</td>
              <td className="after">{formatOpValue(op, op.after)}</td>
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
            <p key={`a-${f.ruleId}-${f.message}`} className={`warn sev-${f.severity}`}>⚠ Checker: {f.message}</p>
          ))}
        </div>
      )}
      <p className="muted small">{costLine(change.source, change.credits)}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy}>
          Approve
        </button>
        <button type="button" className="btn" onClick={onReject} disabled={busy}>
          Reject
        </button>
      </div>
    </section>
  );
}
