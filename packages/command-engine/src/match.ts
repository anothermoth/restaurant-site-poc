import type { Menu } from "@restaurant-site-poc/menu-schema";

export interface Target {
  kind: "item" | "category";
  id: string;
  name: string;
}

export interface MatchResult {
  best?: Target & { score: number };
  /** Close runners-up; non-empty means "ask, don't guess". */
  ambiguous: Array<Target & { score: number }>;
}

const STOP = new Set(["the", "a", "an", "our", "my", "please", "item", "dish", "on", "menu"]);

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

const sim = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

/**
 * Scores how well a spoken phrase names a target. Handles speech-to-text
 * misspellings ("margarita" → "Margherita") and partial names ("pepperoni"
 * → "Hot Honey Pepperoni") without an LLM.
 */
export function score(phrase: string, name: string): number {
  const p = norm(phrase);
  const n = norm(name);
  if (!p || !n) return 0;
  if (p === n) return 1;
  const whole = sim(p, n);
  const pw = p.split(" ");
  const nw = n.split(" ");
  // each spoken word matched to its best name word
  const wordScore = pw.reduce((s, w) => s + Math.max(...nw.map((x) => sim(w, x))), 0) / pw.length;
  const coverage = Math.min(1, pw.length / nw.length);
  const contains = n.includes(p) ? 0.9 : 0;
  return Math.max(whole, contains, wordScore * (0.75 + 0.25 * coverage));
}

export function targets(menu: Menu): Target[] {
  return [
    ...menu.categories.flatMap((c) => c.items.map((i) => ({ kind: "item" as const, id: i.id, name: i.name }))),
    ...menu.categories.map((c) => ({ kind: "category" as const, id: c.id, name: c.name })),
  ];
}

export function match(menu: Menu, phrase: string, kind?: Target["kind"], threshold = 0.72): MatchResult {
  const scored = targets(menu)
    .filter((t) => !kind || t.kind === kind)
    .map((t) => ({ ...t, score: Math.max(score(phrase, t.name), norm(phrase) === norm(t.id.replace(/-/g, " ")) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < threshold) return { ambiguous: [] };
  const close = scored.filter((s) => s !== best && s.score >= threshold && best.score - s.score < 0.06);
  return close.length ? { ambiguous: [best, ...close].slice(0, 3) } : { best, ambiguous: [] };
}
