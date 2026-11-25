import type { Change } from "../lib/types.ts";
import { costLine } from "../lib/format.ts";

/** Status words an owner would use. */
const STATUS: Record<Change["status"], string> = { pending: "Waiting", approved: "Saved", rejected: "Discarded", superseded: "Replaced", undone: "Undone" };

export function History({ items, onUndo, busy }: { items: Change[]; onUndo: (id: string) => void; busy?: boolean }) {
  if (!items.length) return <p className="muted small">No changes yet.</p>;
  return (
    <ol className="history">
      {items.map((c) => (
        <li key={c.id} className={`h-${c.status}`}>
          <div>
            <span className="h-summary">{c.summary.join("; ")}</span>
            <div className="muted small">
              <span className={`chip chip-${c.status}`}>{STATUS[c.status]}</span>
              {c.status === "approved" && <span className={`chip ${c.published ? "chip-live" : "chip-wait"}`}>{c.published ? "On your website" : "Not published yet"}</span>}
            </div>
            <div className="muted small h-meta">
              “{c.utterance}” · {c.input === "voice" ? "spoken" : "typed"} · {costLine(c.source, c.credits)}
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
