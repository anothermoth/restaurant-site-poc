"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { costLine, creditsLabel } from "../lib/format.ts";
import type { ClarifyOption, SiteState } from "../lib/types.ts";
import { ChangeCard } from "./ChangeCard.tsx";
import { History } from "./History.tsx";
import { MicButton } from "./MicButton.tsx";
import { Preview } from "./Preview.tsx";

type Reply = { tone: "info" | "error" | "ok" | "warn"; text: string; detail?: string; options?: ClarifyOption[] };

const EXAMPLES = [
  "Change the price of the margarita to $16.50",
  "86 the burrata",
  "Mark the black bean burger as vegan",
  "We're closed on Mondays and Tuesdays",
  "Move the tiramisu to the top",
  "Make the smash burger a dollar cheaper",
];

export function Editor({ slug, siteUrl }: { slug: string; siteUrl?: string }) {
  const [state, setState] = useState<SiteState | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [speak, setSpeak] = useState(false);

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

  function submit(utterance: string, input: "voice" | "text") {
    if (!utterance.trim()) return;
    setText("");
    return run(
      () => api.propose(slug, utterance, input),
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

  if (!state) return <main className="admin"><p>{reply?.text ?? "Loading…"}</p></main>;
  const a = state.activity;
  const out = state.credits.balance <= 0;
  const publishedHref = state.demo ? "/published" : siteUrl;
  const unpublishedCount = state.history.filter((c) => c.status === "approved" && !c.published).length;

  return (
    <main className="admin">
      <div className="edit-bar" role="region" aria-label="Edit mode">
        <strong>Editing draft</strong>
        <span>
          v{state.draftVersion} · live v{state.publishedVersion}
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
        <span className="spacer" />
        {publishedHref && (
          <a href={publishedHref} target="_blank" rel="noreferrer">
            {state.demo ? "Your published preview ↗" : "Published site ↗"}
          </a>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !state.unpublished || !!state.pending}
          onClick={() => run(() => api.publish(slug), (r) => ({
                tone: "ok",
                text: r.previewPath
                  ? `Published version ${r.publishedVersion} to your private preview (the demo never changes the public site).`
                  : `Published version ${r.publishedVersion}${r.buildMs ? `, site rebuilt in ${(r.buildMs / 1000).toFixed(1)}s` : ""}.`,
              }))}
        >
          Publish
        </button>
      </div>

      {state.demo && (
        <p className="demo-note" role="note">
          Public demo: this is your own copy of a fictional restaurant&apos;s menu. It resets after {state.sandboxIdleMinutes} minutes of inactivity, and nothing you do changes the
          public site. Built-in phrases are free; requests that need the AI helper use 1 credit each.
        </p>
      )}
      <div className="cols">
        <section className="preview-col" aria-label="Preview">
          <p className="muted small">Preview of the draft{state.pending ? " with the pending change highlighted" : ""}. Visitors only see published versions.</p>
          <Preview menu={state.preview} highlight={state.pending?.highlight} />
        </section>

        <aside className="side-col">
          <section className="card">
            <h2>Tell me what to change</h2>
            <MicButton onTranscript={(t) => submit(t, "voice")} disabled={busy} />
            <form
              className="cmd-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(text, "text");
              }}
            >
              <label htmlFor="cmd" className="sr-only">Command</label>
              <input id="cmd" value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "86 the burrata"' autoComplete="off" disabled={busy} />
              <button type="submit" className="btn" disabled={busy || !text.trim()}>Send</button>
            </form>
            <div className="examples">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="chip-btn" onClick={() => setText(x)} disabled={busy}>
                  {x}
                </button>
              ))}
            </div>
            {reply && (
              <div className={`reply reply-${reply.tone}`} role="status">
                <p>{reply.text}</p>
                {reply.options && (
                  <div className="options">
                    {reply.options.map((o) => (
                      <button key={o.label} type="button" className="btn btn-small" onClick={() => submit(o.utterance, "text")} disabled={busy}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {reply.detail && <p className="muted small">{reply.detail}</p>}
              </div>
            )}
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
          </section>

          {state.pending && (
            <ChangeCard
              change={state.pending}
              busy={busy}
              onApprove={() => run(() => api.approve(slug, state.pending!.id), (c) => ({ tone: "ok", text: `Approved: ${c.summary.join("; ")}. Publish when you're ready.` }))}
              onReject={() => run(() => api.reject(slug, state.pending!.id), () => ({ tone: "info", text: "Rejected. Nothing changed." }))}
            />
          )}

          <section className="card">
            <h2>Edit history</h2>
            <History items={state.history} busy={busy} onUndo={(id) => run(() => api.undo(slug, id), (c) => ({ tone: "ok", text: `Undone: ${c.summary.join("; ")}.` }))} />
            <button type="button" className="link-btn" onClick={() => run(() => api.reset(slug), () => ({ tone: "info", text: "Demo reset to the sample menu." }))} disabled={busy}>
              Reset demo data
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
