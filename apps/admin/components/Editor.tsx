"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EditTarget } from "../lib/api.ts";
import { costLine, creditsLabel } from "../lib/format.ts";
import type { ClarifyOption, SiteState } from "../lib/types.ts";
import { ChangeCard } from "./ChangeCard.tsx";
import { History } from "./History.tsx";
import { MenuPanel, targetName } from "./MenuPanel.tsx";
import { MicButton } from "./MicButton.tsx";
import { Preview } from "./Preview.tsx";

type Reply = { tone: "info" | "error" | "ok" | "warn"; text: string; detail?: string; options?: ClarifyOption[] };

/** Suggestion chips: a full example, or a short form when something is selected. */
const SUGGESTIONS: Array<{ label: string; text: string; selected?: string }> = [
  { label: "86 an item", text: "86 the burrata", selected: "86 it" },
  { label: "Change a price", text: "Change the price of the margarita to $16.50", selected: "Make this $" },
  { label: "Update hours", text: "We're closed on Mondays and Tuesdays" },
  { label: "Mark as vegan", text: "Mark the black bean burger as vegan", selected: "Mark this as vegan" },
  { label: "Move to top", text: "Move the tiramisu to the top", selected: "Move this to the top" },
  { label: "Rename", text: "Rename the garlic knots to Garlic Bread Knots", selected: "Rename this to " },
];

const editIdOf = (t: EditTarget | null) => (t ? (t.kind === "item" ? `item:${t.id}` : `category:${t.id}`) : undefined);

export function Editor({ slug, siteUrl }: { slug: string; siteUrl?: string }) {
  const [state, setState] = useState<SiteState | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [speak, setSpeak] = useState(false);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const canvas = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setState(await api.state(slug)), [slug]);
  useEffect(() => {
    refresh().catch((e: Error) => setReply({ tone: "error", text: `Can't reach the API: ${e.message}` }));
  }, [refresh]);

  const say = useCallback(
    (r: Reply) => {
      setReply(r);
      if (speak && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(r.text));
      }
    },
    [speak],
  );

  // Bring what a pending change touches (or the selection) into view in the preview.
  const scrollToEditId = useCallback((id: string | undefined) => {
    if (!id || !canvas.current) return;
    const el = canvas.current.querySelector<HTMLElement>(`.pv [data-edit-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, []);
  const pendingId = state?.pending?.id;
  const pendingFocus = state?.pending?.highlight.find((h) => h.includes(".")) ?? state?.pending?.highlight[0];
  useEffect(() => {
    if (pendingId) scrollToEditId(pendingFocus);
  }, [pendingId, pendingFocus, scrollToEditId]);

  const select = useCallback(
    (t: EditTarget | null) => {
      setTarget(t);
      setMenuOpen(false);
      if (t) {
        scrollToEditId(editIdOf(t));
        input.current?.focus({ preventScroll: true });
      }
    },
    [scrollToEditId],
  );

  async function run<T>(fn: () => Promise<T>, ok?: (v: T) => Reply | null) {
    setBusy(true);
    try {
      const v = await fn();
      const r = ok?.(v);
      if (r) say(r);
      await refresh();
    } catch (e) {
      say({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function submit(utterance: string, inputKind: "voice" | "text") {
    if (!utterance.trim()) return;
    setText("");
    return run(
      () => api.propose(slug, utterance, inputKind, target ?? undefined),
      (r) => {
        if (r.type === "change")
          return r.autoApproved
            ? { tone: "ok", text: `Applied to the draft: ${r.change.summary.join("; ")}.`, detail: costLine(r.change.source, r.change.credits) }
            : { tone: "info", text: `Here's the preview: ${r.change.summary.join("; ")}. Approve or reject.`, detail: costLine(r.change.source, r.change.credits) };
        if (r.type === "meta") return { tone: "ok", text: r.message };
        if (r.type === "clarify") return { tone: "info", text: r.question, options: r.options, detail: costLine(r.source, r.credits) };
        if (r.blocked) return { tone: "warn", text: r.message, detail: r.blocked === "credits" ? "No credit was used." : "No credit was used. Built-in phrases are always free." };
        return { tone: "error", text: r.message, detail: costLine(r.source, r.credits) };
      },
    );
  }

  if (!state) return <main className="admin admin-loading"><p>{reply?.text ?? "Loading…"}</p></main>;
  const a = state.activity;
  const out = state.credits.balance <= 0;
  const publishedHref = state.demo ? "/published" : siteUrl;
  const unpublishedCount = state.history.filter((c) => c.status === "approved" && !c.published).length;
  const selName = targetName(state.preview, target);
  const canPublish = !busy && state.unpublished && !state.pending;
  const publishHint = state.pending
    ? "Approve or reject the pending change first"
    : !state.unpublished
      ? "Nothing new to publish"
      : `Publish ${unpublishedCount} approved change${unpublishedCount === 1 ? "" : "s"}`;
  const activeTarget = selName ? target : null;

  return (
    <main className="admin">
      <div className="edit-bar" role="region" aria-label="Edit mode">
        <div className="bar-left">
          <span className="logo" aria-hidden="true">{state.preview.restaurant.name.charAt(0)}</span>
          <strong className="bar-title">{state.preview.restaurant.name}</strong>
          <span className="draft-pill">
            <span className="dot" aria-hidden="true" />
            Editing draft
          </span>
          <span className="bar-meta">
            v{state.draftVersion} · live v{state.publishedVersion}
            {state.unpublished ? ` · ${unpublishedCount} unpublished` : " · up to date"}
          </span>
        </div>
        <div className="bar-right">
          {/* On phones these collapse into the "More" menu; on desktop they sit inline. */}
          <div className={`bar-more${moreOpen ? " is-open" : ""}`} onClick={() => setMoreOpen(false)}>
            <span className="more-status">
              Editing draft · v{state.draftVersion} · live v{state.publishedVersion}
              {state.unpublished ? ` · ${unpublishedCount} unpublished` : " · up to date"}
            </span>
            <span
              className={`cost${out ? " cost-out" : ""}`}
              data-testid="credits"
              title={`Built-in phrases are free (${a.parser} so far). Only requests that need the AI helper use a credit (${a.ai} so far); repeated ones are reused for free (${a.aiCache}).`}
            >
              {creditsLabel(state.credits.balance)}
              {out ? " · AI helper paused" : ""}
            </span>
            <button type="button" className="btn btn-ghost bar-menu" onClick={() => setMenuOpen(true)}>
              Menu
            </button>
            <button type="button" className="btn btn-ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
              History{state.history.length ? <span className="count">{state.history.length}</span> : null}
            </button>
            {publishedHref && (
              <a className="btn btn-ghost bar-link" href={publishedHref} target="_blank" rel="noreferrer">
                {state.demo ? "Your published preview ↗" : "Published site ↗"}
              </a>
            )}
          </div>
          <button type="button" className="btn btn-ghost more-btn" aria-label="More" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <circle cx="4.5" cy="10" r="1.6" fill="currentColor" />
              <circle cx="10" cy="10" r="1.6" fill="currentColor" />
              <circle cx="15.5" cy="10" r="1.6" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="btn btn-publish"
            disabled={!canPublish}
            title={publishHint}
            onClick={() =>
              run(() => api.publish(slug), (r) => ({
                tone: "ok",
                text: r.previewPath
                  ? `Published version ${r.publishedVersion} to your private preview (the demo never changes the public site).`
                  : `Published version ${r.publishedVersion}${r.buildMs ? `, site rebuilt in ${(r.buildMs / 1000).toFixed(1)}s` : ""}.`,
              }))
            }
          >
            Publish
            {canPublish && unpublishedCount > 0 && <span className="publish-count">{unpublishedCount}</span>}
          </button>
        </div>
      </div>
      {moreOpen && <div className="more-scrim" onClick={() => setMoreOpen(false)} aria-hidden="true" />}

      {state.demo && (
        <p className="demo-note" role="note">
          <strong>Public demo.</strong> Your own copy of a fictional restaurant&apos;s menu. It resets after {state.sandboxIdleMinutes} minutes of inactivity and never changes the public
          site. Built-in phrases are free; requests that need the AI helper use 1 credit each.
        </p>
      )}

      <div className="stage">
        <section className="canvas" aria-label="Preview" ref={canvas}>
          <div className="dock">
            <div className={`prompt${busy ? " is-busy" : ""}`}>
              <form
                className="cmd-form cmd-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(text, "text");
                }}
              >
                {activeTarget && selName && (
                  <span className="target-chip" title="Commands like “make this $14” apply to this">
                    <span className="target-kind">{activeTarget.kind === "item" ? "Item" : "Section"}</span>
                    {selName}
                    <button type="button" onClick={() => setTarget(null)} aria-label={`Clear selection ${selName}`}>
                      ×
                    </button>
                  </span>
                )}
                {activeTarget && <span className="chip-break" aria-hidden="true" />}
                <label htmlFor="cmd" className="sr-only">Command</label>
                <input
                  id="cmd"
                  ref={input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={activeTarget ? `What should change about ${selName}?` : "Tell me what to change, e.g. “86 the burrata”"}
                  autoComplete="off"
                  disabled={busy}
                />
                <MicButton onTranscript={(t) => submit(t, "voice")} disabled={busy} />
                <button type="submit" className="btn-send" disabled={busy || !text.trim()} aria-label="Send">
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d="M10 16V4M5 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </form>
            </div>

            {!state.pending && (
              <div className="suggestions" aria-label="Suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setText(activeTarget && s.selected ? s.selected : s.text);
                      input.current?.focus();
                    }}
                    disabled={busy}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* While a change is pending its card says it all; keep the reply for clarifications and errors. */}
            {reply && (!state.pending || reply.options || reply.tone === "error" || reply.tone === "warn") && (
              <div className={`reply reply-${reply.tone}`} role="status">
                <p>{reply.text}</p>
                {reply.options && (
                  <div className="options">
                    {reply.options.map((o) => (
                      <button key={o.label} type="button" className="chip-btn chip-choice" onClick={() => submit(o.utterance, "text")} disabled={busy}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {reply.detail && <p className="reply-detail">{reply.detail}</p>}
              </div>
            )}

            {state.pending && (
              <ChangeCard
                change={state.pending}
                busy={busy}
                onApprove={() => run(() => api.approve(slug, state.pending!.id), (c) => ({ tone: "ok", text: `Approved: ${c.summary.join("; ")}. Publish when you're ready.` }))}
                onReject={() => run(() => api.reject(slug, state.pending!.id), () => ({ tone: "info", text: "Rejected. Nothing changed." }))}
              />
            )}
          </div>

          <div className="canvas-preview">
            <Preview menu={state.preview} highlight={state.pending?.highlight} selected={editIdOf(activeTarget)} onPick={select} />
            <p className="canvas-note">Draft preview{state.pending ? " · pending change highlighted" : ""}. Visitors only see published versions.</p>
          </div>
        </section>

        <aside className={`sidebar${menuOpen ? " is-open" : ""}`} aria-label="Menu items">
          <div className="sidebar-head">
            <h2>Menu</h2>
            <button type="button" className="icon-btn sheet-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              ×
            </button>
          </div>
          <MenuPanel menu={state.preview} target={activeTarget} onSelect={select} />
        </aside>
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

        {historyOpen && (
          <aside className="drawer" aria-label="Edit history">
            <div className="sidebar-head">
              <h2>Edit history</h2>
              <button type="button" className="icon-btn" onClick={() => setHistoryOpen(false)} aria-label="Close history">
                ×
              </button>
            </div>
            <div className="drawer-body">
              <History items={state.history} busy={busy} onUndo={(id) => run(() => api.undo(slug, id), (c) => ({ tone: "ok", text: `Undone: ${c.summary.join("; ")}.` }))} />
              <div className="toggles">
                <label>
                  <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Read replies aloud
                </label>
                <label title="Prices and allergen tags always wait for approval">
                  <input
                    type="checkbox"
                    checked={state.settings.autoApproveLowRisk}
                    onChange={(e) => run(() => api.settings(slug, { autoApproveLowRisk: e.target.checked }))}
                  />{" "}
                  Auto-apply low-risk edits to the draft
                </label>
              </div>
              <button type="button" className="link-btn" onClick={() => run(() => api.reset(slug), () => ({ tone: "info", text: "Demo reset to the sample menu." }))} disabled={busy}>
                Reset demo data
              </button>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
