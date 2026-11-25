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

/**
 * Three starter ideas in the owner's own words (all handled by the built-in phrases,
 * so they never use an AI credit). With an item selected they switch to short forms.
 */
export const SUGGESTIONS = ["We're out of the burrata", "The margherita is now $16.50", "We're closed on Mondays"];
export const SELECTED_SUGGESTIONS = ["Make it $", "We're out of this", "Rename it to "];

const editIdOf = (t: EditTarget | null) => (t ? (t.kind === "item" ? `item:${t.id}` : `category:${t.id}`) : undefined);

/**
 * Owner-first editor. One job on screen at a time: say or type a change, check it,
 * approve it, publish. The live preview of the site sits beside it (below it on a phone).
 * Everything else (browse the menu, recent changes, credits, settings, demo reset)
 * is one tap away behind "Pick from menu" and the ⋯ menu.
 */
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
    refresh().catch((e: Error) => setReply({ tone: "error", text: `Can't reach the editor service: ${e.message}` }));
  }, [refresh]);

  useEffect(() => {
    if (!moreOpen && !menuOpen && !historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMoreOpen(false);
      setMenuOpen(false);
      setHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, menuOpen, historyOpen]);

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
      setReply(null);
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
            ? { tone: "ok", text: `Saved. ${r.change.summary.join("; ")}. Publish when you're ready.`, detail: costLine(r.change.source, r.change.credits) }
            : { tone: "info", text: `Check the change: ${r.change.summary.join("; ")}.`, detail: costLine(r.change.source, r.change.credits) };
        if (r.type === "meta") return { tone: "ok", text: r.message };
        if (r.type === "clarify") return { tone: "info", text: r.question, options: r.options, detail: costLine(r.source, r.credits) };
        if (r.blocked) return { tone: "warn", text: r.message, detail: r.blocked === "credits" ? "No credit was used." : "No credit was used. Simple requests like the examples always work." };
        return { tone: "error", text: r.message, detail: costLine(r.source, r.credits) };
      },
    );
  }

  if (!state) return <main className="admin admin-loading"><p>{reply?.text ?? "Loading your site…"}</p></main>;
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
  const status = state.unpublished
    ? `${unpublishedCount || "Some"} change${unpublishedCount === 1 ? "" : "s"} saved, not on your website yet`
    : "Your website is up to date";
  const ideas = activeTarget ? SELECTED_SUGGESTIONS : SUGGESTIONS;
  // While a change waits for approval its card says it all; the reply only shows for questions and problems.
  const showReply = reply && (!state.pending || reply.options || reply.tone === "error" || reply.tone === "warn");

  return (
    <main className="admin">
      <header className="topbar" role="region" aria-label="Edit mode">
        <div className="tb-left">
          <span className="logo" aria-hidden="true">{state.preview.restaurant.name.charAt(0)}</span>
          <strong className="tb-title">{state.preview.restaurant.name}</strong>
        </div>
        <div className="tb-right">
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
                  ? `Published! Your demo website now shows version ${r.publishedVersion}. (The demo never changes the real site.)`
                  : `Published! Your website is updating${r.buildMs ? ` (done in ${(r.buildMs / 1000).toFixed(1)}s)` : ""}.`,
              }))
            }
          >
            Publish
            {canPublish && unpublishedCount > 0 && <span className="publish-count">{unpublishedCount}</span>}
          </button>
        </div>

        {moreOpen && (
          <>
            <div className="more-scrim" onClick={() => setMoreOpen(false)} aria-hidden="true" />
            <div className="more-menu" role="menu" aria-label="More options" onClick={() => setMoreOpen(false)}>
              <p className="more-status">{status}</p>
              {state.demo && <p className="more-demo">Private demo copy · resets after {state.sandboxIdleMinutes} min idle</p>}
              <button type="button" role="menuitem" className="more-item" onClick={() => setMenuOpen(true)}>
                Browse your menu
              </button>
              <button type="button" role="menuitem" className="more-item" onClick={() => setHistoryOpen(true)}>
                Recent changes{state.history.length ? <span className="count">{state.history.length}</span> : null}
              </button>
              {publishedHref && (
                <a role="menuitem" className="more-item" href={publishedHref} target="_blank" rel="noreferrer">
                  {state.demo ? "Your published preview ↗" : "Published site ↗"}
                </a>
              )}
              <p
                className={`more-credits${out ? " is-out" : ""}`}
                data-testid="credits"
                title={`Simple requests are free (${a.parser} so far). Only requests that need the AI helper use a credit (${a.ai} so far); repeated ones are reused for free (${a.aiCache}).`}
              >
                {creditsLabel(state.credits.balance)}
                {out ? " · AI helper paused" : ""}
              </p>
            </div>
          </>
        )}
      </header>

      <div className="workspace">
        <section className="assistant" aria-label="Make a change">
          <div className="assistant-inner">
            <h1 className="ask-title">What would you like to change?</h1>
            <p className="ask-sub">Type it, or hold the mic and say it, the way you&apos;d tell your staff. Nothing goes live until you publish.</p>

            <form
              className={`ask${busy ? " is-busy" : ""}`}
              onSubmit={(e) => {
                e.preventDefault();
                void submit(text, "text");
              }}
            >
              {activeTarget && selName && (
                <span className="target-chip">
                  <span className="target-kind">Changing</span>
                  {selName}
                  <button type="button" onClick={() => setTarget(null)} aria-label={`Clear selection ${selName}`}>
                    ×
                  </button>
                </span>
              )}
              <div className="ask-row">
                <label htmlFor="cmd" className="sr-only">What would you like to change?</label>
                <input
                  id="cmd"
                  ref={input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={activeTarget ? "What should change?" : "e.g. We're out of burrata"}
                  autoComplete="off"
                  enterKeyHint="send"
                  disabled={busy}
                />
                <button type="submit" className="btn-send" disabled={busy || !text.trim()} aria-label="Send">
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d="M10 16V4M5 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <MicButton onTranscript={(t) => submit(t, "voice")} disabled={busy} />
              </div>
            </form>

            {showReply && (
              <div className={`reply reply-${reply.tone}`} role="status">
                <p>{reply.text}</p>
                {reply.options && (
                  <div className="options">
                    {reply.options.map((o) => (
                      <button key={o.label} type="button" className="idea" onClick={() => submit(o.utterance, "text")} disabled={busy}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {reply.detail && <p className="reply-detail">{reply.detail}</p>}
              </div>
            )}

            {state.pending ? (
              <ChangeCard
                change={state.pending}
                menu={state.draft}
                busy={busy}
                onApprove={() => run(() => api.approve(slug, state.pending!.id), () => ({ tone: "ok", text: `Saved. Tap Publish when you're ready to put it on your website.` }))}
                onReject={() => run(() => api.reject(slug, state.pending!.id), () => ({ tone: "info", text: "Discarded. Nothing changed." }))}
              />
            ) : (
              <div className="ideas" aria-label="Suggestions">
                <p className="ideas-label">{activeTarget ? `Try, for ${selName}:` : "Try:"}</p>
                {ideas.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="idea"
                    onClick={() => {
                      setText(s);
                      input.current?.focus();
                    }}
                    disabled={busy}
                  >
                    “{s.trim()}{s.endsWith(" ") || s.endsWith("$") ? "…" : ""}”
                  </button>
                ))}
                <button type="button" className="pick-btn" onClick={() => setMenuOpen(true)}>
                  Or pick something from your menu
                </button>
              </div>
            )}

            {state.demo && (
              <p className="demo-note" role="note">
                Demo: this is your own private copy of a sample restaurant. It resets after {state.sandboxIdleMinutes} minutes of inactivity and never changes the real website.
              </p>
            )}
          </div>
        </section>

        <section className="canvas" aria-label="Preview" ref={canvas}>
          <p className="canvas-label">
            <span className={`canvas-dot${state.unpublished || state.pending ? " is-draft" : ""}`} aria-hidden="true" />
            {state.pending ? "Preview with your change highlighted" : state.unpublished ? "Preview · not published yet" : "Your website"}
          </p>
          <div className="canvas-frame">
            <Preview menu={state.preview} highlight={state.pending?.highlight} selected={editIdOf(activeTarget)} onPick={select} />
          </div>
        </section>
      </div>

      {menuOpen && (
        <>
          <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="sheet sheet-menu" aria-label="Menu items">
            <div className="sheet-head">
              <h2>Your menu</h2>
              <button type="button" className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                ×
              </button>
            </div>
            <MenuPanel menu={state.preview} target={activeTarget} onSelect={select} />
          </aside>
        </>
      )}

      {historyOpen && (
        <>
          <div className="scrim" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
          <aside className="sheet sheet-history" aria-label="Recent changes">
            <div className="sheet-head">
              <h2>Recent changes</h2>
              <button type="button" className="icon-btn" onClick={() => setHistoryOpen(false)} aria-label="Close recent changes">
                ×
              </button>
            </div>
            <div className="sheet-body">
              <p className="muted small">{status}.</p>
              <History items={state.history} busy={busy} onUndo={(id) => run(() => api.undo(slug, id), (c) => ({ tone: "ok", text: `Undone: ${c.summary.join("; ")}.` }))} />
              <h3 className="settings-title">Settings</h3>
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
                  Save small changes without asking (prices and allergy info still ask)
                </label>
              </div>
              {state.demo && (
                <button type="button" className="link-btn" onClick={() => run(() => api.reset(slug), () => ({ tone: "info", text: "Demo reset to the sample menu." }))} disabled={busy}>
                  Start the demo over
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
