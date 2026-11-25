import type { Change } from "../lib/types.ts";
import { costLine } from "../lib/format.ts";

export function History({ items, onUndo, busy }: { items: Change[]; onUndo: (id: string) => void; busy?: boolean }) {
  if (!items.length) return <p className="muted small">No edits yet.</p>;
  return (
    <ol className="history">
      {items.map((c) => (
        <li key={c.id} className={`h-${c.status}`}>
          <div>
            <span className={`chip chip-${c.status}`}>{c.status}</span>
            {c.published && <span className="chip chip-live">live</span>}
            <span className="h-summary">{c.summary.join("; ")}</span>
            <div className="muted small">
              “{c.utterance}” · {c.input} · {costLine(c.source, c.credits)}
            </div>
          </div>
          {c.status === "approved" && (
            <button type="button" className="btn btn-small" onClick={() => onUndo(c.id)} disabled={busy} aria-label={`Undo: ${c.summary.join("; ")}`}>
              Undo
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
