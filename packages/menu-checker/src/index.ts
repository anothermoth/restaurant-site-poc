import { allItems, type Menu } from "@restaurant-site-poc/menu-schema";
import { ALL_RULES, type Rule } from "./rules.ts";
import { runLlmPass, type FetchLike, type LlmConfig } from "./llm.ts";
import { SEVERITY_ORDER, type Finding, type Report } from "./types.ts";

export * from "./types.ts";
export * from "./rules.ts";
export * from "./fix.ts";
export * from "./llm.ts";

const PENALTY = { error: 10, warning: 4, info: 1 } as const;

export function runRules(menu: Menu, rules: Rule[] = ALL_RULES): Finding[] {
  return rules
    .flatMap((r) => r.run(menu))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function buildReport(menu: Menu, findings: Finding[], llm: Report["llm"] = { ran: false, suggestionCount: 0 }): Report {
  const count = (s: Finding["severity"]) => findings.filter((f) => f.severity === s && f.source === "rule").length;
  const summary = {
    error: count("error"),
    warning: count("warning"),
    info: count("info"),
    total: findings.length,
    autoFixable: findings.filter((f) => f.fix).length,
  };
  const penalty = summary.error * PENALTY.error + summary.warning * PENALTY.warning + summary.info * PENALTY.info;
  return {
    restaurant: { slug: menu.restaurant.slug, name: menu.restaurant.name, isSampleData: menu.restaurant.isSampleData },
    itemCount: allItems(menu).length,
    summary,
    score: Math.max(0, 100 - penalty),
    findings,
    llm,
  };
}

/** Deterministic only. Pure and synchronous, so it can run at site build time. */
export function checkMenu(menu: Menu): Report {
  return buildReport(menu, runRules(menu));
}

/** Rules plus the optional LLM pass. The LLM pass is skipped cleanly without a key. */
export async function checkMenuWithLlm(
  menu: Menu,
  opts: { config?: LlmConfig | null; fetchImpl?: FetchLike } = {},
): Promise<Report> {
  const ruleFindings = runRules(menu);
  const llm = await runLlmPass(menu, ruleFindings, opts);
  return buildReport(
    menu,
    [...ruleFindings, ...llm.findings],
    llm.ran
      ? { ran: true, model: llm.model, suggestionCount: llm.findings.length }
      : { ran: false, skippedReason: llm.skippedReason, suggestionCount: 0 },
  );
}
export * from "./format.ts";
