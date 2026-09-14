---
description: Port of ecc harness-audit.js. Generates a report that scores token usage and context efficiency across 7 categories.
argument-hint: "[--since <date>] [--format md|json]"
allowed-tools:
  - Bash
---

# /ccp:audit

Generates an audit report that scores CCP token usage, context efficiency, router accuracy, OAuth recovery, and double-billing protection across 7 categories (`scripts/harness-audit.js`, ported from ecc `harness-audit.js`).

## Usage

```
/ccp:audit [--since <date>] [--format md|json]
```

| Argument | Description |
|------|------|
| `--since <date>` | Audit start date (`YYYY-MM-DD`, default: 7 days ago) |
| `--format md\|json` | Output format (default: `md`) |

## Behavior

1. Invoke `harness-audit.js`.
2. Scan `_workspace/_jobs/*/meta.json` and recent session logs.
3. Compute 7 category scores (0-5 each):
   - **Context Efficiency** — average `summary` length and main-context delta ≤ 500 chars compliance
   - **Cost Efficiency** — average token savings across measured tasks
   - **Router Accuracy** — accuracy on the routing regression dataset (≥ 80% PASS)
   - **Double-billing Detection** — verifies zero raw `result.md` leakage into main context
   - **Fallback Health** — user reinvocation success rate after OAuth expiry
   - **Plugin Compatibility** — compliance with `name`, `version`, `description`, `author`, `license` (5 standard plugin.json fields)
   - **Secret Leak Check** — grep for secrets in envelope `details` and verify `.gitignore` isolation
4. Persist the result to `_workspace/_audits/<YYYY-MM-DDTHHMMSSZ>.md` or `.json`.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/harness-audit.js" [--since <date>] [--format md|json]
```

## Output (Success)

```json
{
  "summary": "Total score 35/35. Warning categories: none",
  "result_path": "_workspace/_audits/2026-04-26T093000Z.md",
  "tokens": { "input": 0, "output": 0 },
  "exit_code": 0,
  "details": {
    "scores": {
      "context_efficiency": 5,
      "cost_efficiency": 4,
      "router_accuracy": 5,
      "double_billing": 5,
      "fallback_health": 5,
      "plugin_compat": 5,
      "secret_leak": 5
    }
  }
}
```

> **details placement rule:** Store the `scores` object in the `details` subobject, not at the envelope root.

## Error Codes

| Code | Cause | recovery |
|------|------|:---:|
| `CCP-AUDIT-001` | No audit target data | abort |
| `CCP-AUDIT-002` | harness-audit script failed | retry |

## Acceptance Criteria

- Respond within 30 seconds.
- Produce scores for all 7 categories (0 missing).
- Persist the report file under `_workspace/_audits/`.

## Spec SSOT

- `plugins/ccp/scripts/harness-audit.js` (scoring rubric + report writer)
- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
- README §4 (subagent isolation principle)
