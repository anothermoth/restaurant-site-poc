import type { Report, Severity } from "./types.ts";

const COLORS: Record<Severity, string> = { error: "\x1b[31m", warning: "\x1b[33m", info: "\x1b[36m" };
const RESET = "\x1b[0m";

export function formatReport(report: Report, color = process.stdout.isTTY): string {
  const c = (s: Severity, t: string) => (color ? `${COLORS[s]}${t}${RESET}` : t);
  const lines = [
    `${report.restaurant.name}${report.restaurant.isSampleData ? " (sample data)" : ""}: ${report.itemCount} items, score ${report.score}/100`,
    `${report.summary.error} errors, ${report.summary.warning} warnings, ${report.summary.info} info, ${report.summary.autoFixable} auto-fixable`,
    "",
  ];
  for (const f of report.findings) {
    lines.push(`${c(f.severity, f.severity.toUpperCase().padEnd(7))} ${f.ruleId.padEnd(22)} ${f.message}${f.fix ? " [auto-fix]" : ""}`);
    if (f.suggestion) lines.push(`        -> ${f.suggestion}`);
  }
  lines.push("", report.llm.ran ? `LLM pass: ${report.llm.suggestionCount} suggestions from ${report.llm.model}` : `LLM pass skipped: ${report.llm.skippedReason ?? "not requested (use --llm)"}`);
  return lines.join("\n");
}
