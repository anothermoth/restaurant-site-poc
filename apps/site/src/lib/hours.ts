const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
export const DAY_SHORT: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

/** "18:30" -> "6:30pm", "11:00" -> "11am". */
export function clock(t: string): string {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** ["Tu","We","Th"] -> "Tue–Thu"; non-consecutive days are listed. */
export function dayRange(days: readonly string[]): string {
  const idx = days.map((d) => ORDER.indexOf(d as (typeof ORDER)[number])).sort((a, b) => a - b);
  const consecutive = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -2) + 1);
  const names = idx.map((i) => DAY_SHORT[ORDER[i] ?? "Mo"]);
  if (consecutive && names.length > 2) return `${names[0]}–${names[names.length - 1]}`;
  return names.join(names.length === 2 ? " & " : ", ");
}

export function closedDays(hours: readonly { days: readonly string[] }[]): string[] {
  const open = new Set(hours.flatMap((h) => h.days));
  return ORDER.filter((d) => !open.has(d));
}
