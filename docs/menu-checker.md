# Menu checker (`@restaurant-site-poc/menu-checker` + `check-menu` CLI)

Deterministic rules:

| Rule | Severity | Auto-fix? |
|---|---|---|
| `price-outlier`: price ≥4x or ≤¼ of the category median; suggests the likely decimal slip ($185.00 → $18.50) | error | No: prices need a person |
| `empty-modifier-group`: a group with no options (an error if it's required and attached, because guests can't check out) | error / warning | Yes: remove the group and detach it |
| `duplicate-item`: same name after normalizing case, punctuation and `&` | warning | No |
| `missing-description`: empty (warning) or under 25 characters (info) | warning / info | No (the LLM can suggest copy) |
| `missing-photo` | warning | No |
| `missing-dietary-tags`: no tags at all, with keyword hints ("contains-dairy, contains-gluten, vegetarian?") | warning | **Never**: allergen claims must come from the kitchen |
| `inconsistent-naming`: ALL CAPS, all lowercase, stray whitespace | info | Yes: Title Case rename |
| `unused-modifier-group` | info | No |

The report has counts by severity, an at-a-glance 0-100 score, and every finding with a suggested action. `applySafeFixes()` returns a new menu (the input isn't mutated) and re-validates it with zod, so a fix can never produce an invalid menu.

**Optional LLM pass** (`--llm`): sends only the items the rules flagged for weak copy or missing tags to any **OpenAI-compatible** `/chat/completions` endpoint, asks for JSON, and validates the response with zod. Invalid JSON, schema failures and HTTP errors raise clear errors; suggestions for item ids that weren't sent are dropped. Without `OPENAI_API_KEY` the pass is **skipped cleanly** and no request is made. LLM suggestions are always `info` and never auto-applied.

I ran the LLM pass once against xAI's OpenAI-compatible API (`grok-4.20-0309-non-reasoning`) and committed the output to `data/menu-report.llm.json`; `/admin/report` shows it. It's a good illustration of why AI copy goes through approval: the model's rewrite for "Wood-Fired Wings" offered "classic buffalo or smoky BBQ sauce" and the chicken sandwich got a "brioche" bun. Neither is in the source menu.

```
$ npm run check-menu -- data/sample-restaurant.menu.json --fail-on none
Ember & Elm Kitchen (sample data): 17 items, score 59/100
1 errors, 7 warnings, 3 info, 4 auto-fixable

ERROR   price-outlier          "Truffle Pie" is $185.00, 10.0x above the Wood-Fired Pizza median.
        -> Looks like a decimal slip: did you mean $18.50? Category median is $18.50.
WARNING empty-modifier-group   Modifier group "Dressing" has no options but is attached to "Caesar Salad". [auto-fix]
...
```

CLI options: `--json <file>` (full report), `--fix <file>` (write the auto-fixed menu), `--llm`, `--fail-on error|warning|info|none` (exit code for CI gating; default `error`).
