#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { safeParseMenu } from "@restaurant-site-poc/menu-schema";
import { applySafeFixes, checkMenu, checkMenuWithLlm, type Severity } from "./index.ts";
import { formatReport } from "./format.ts";

const USAGE = `Usage: check-menu <menu.json> [options]

Options:
  --json <file>       Write the full report as JSON
  --fix <file>        Apply safe auto-fixes and write the fixed menu
  --llm               Run the optional LLM pass (needs OPENAI_API_KEY; skipped cleanly otherwise)
  --fail-on <level>   Exit 1 if any finding at this level or worse: error | warning | info | none (default: error)
  -h, --help          Show this help`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "string" },
      fix: { type: "string" },
      llm: { type: "boolean", default: false },
      "fail-on": { type: "string", default: "error" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const parsed = safeParseMenu(JSON.parse(readFileSync(positionals[0]!, "utf8")));
  if (!parsed.success) {
    console.error("Menu failed schema validation:");
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    return 2;
  }
  const menu = parsed.data;
  const report = values.llm ? await checkMenuWithLlm(menu) : checkMenu(menu);
  console.log(formatReport(report));

  if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2) + "\n");
  if (values.fix) {
    const { menu: fixed, applied } = applySafeFixes(menu, report.findings);
    writeFileSync(values.fix, JSON.stringify(fixed, null, 2) + "\n");
    console.log(`\nApplied ${applied.length} safe fixes -> ${values.fix}`);
  }

  const failOn = values["fail-on"];
  if (failOn === "none") return 0;
  const order: Severity[] = ["error", "warning", "info"];
  const threshold = order.indexOf(failOn as Severity);
  if (threshold < 0) {
    console.error(`Unknown --fail-on level "${failOn}"`);
    return 2;
  }
  return report.findings.some((f) => f.source === "rule" && order.indexOf(f.severity) <= threshold) ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
