"use client";
import { useEffect, useRef, useState } from "react";

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Push-to-talk with the browser's built-in speech recognition (free, no API
 * key). Hold to talk, release to send. Falls back to a hint when unsupported.
 */
export function MicButton({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const latest = useRef("");

  useEffect(() => {
    setSupported(getCtor() !== null);
  }, []);

  function start() {
    const Ctor = getCtor();
    if (!Ctor || listening || disabled) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = true;
    finalText.current = "";
    latest.current = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText.current += res[0].transcript;
        else live += res[0].transcript;
      }
      latest.current = (finalText.current + live).trim();
      setInterim(latest.current);
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      const text = finalText.current.trim() || latest.current;
      setInterim("");
      if (text) onTranscript(text);
    };
    rec.current = r;
    r.start();
    setListening(true);
  }
  function stop() {
    rec.current?.stop();
  }

  if (supported === false) {
    return (
      <span className="mic-off" title="Voice input needs a browser with speech recognition (Chrome, Edge or Safari)">
        <MicIcon />
        <span className="sr-only">Voice input needs a browser with speech recognition (Chrome, Edge or Safari). Type your change below instead.</span>
      </span>
    );
  }
  return (
    <div className="mic">
      <button
        type="button"
        className={`mic-btn${listening ? " is-live" : ""}`}
        aria-pressed={listening}
        aria-label={listening ? "Listening: release to send" : "Hold to talk"}
        disabled={disabled || supported === null}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={() => listening && stop()}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && start()}
        onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      >
        <MicIcon />
        <span className="mic-text">{listening ? "Listening… release to send" : "Hold to talk"}</span>
      </button>
      {interim && <p className="interim" aria-live="polite">{interim}</p>}
    </div>
  );
}

function MicIcon() {
  return (
    <span className="mic-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </span>
  );
}
