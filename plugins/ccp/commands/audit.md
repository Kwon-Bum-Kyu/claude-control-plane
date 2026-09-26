---
description: Port of ecc harness-audit.js. Scores CCP job records across 8 categories and writes a report.
argument-hint: "[--since YYYY-MM-DD] [--format md|json]"
allowed-tools:
  - Bash
---

# /ccp:audit

Generates an audit report that scores CCP token usage, context efficiency, router accuracy, OAuth recovery, and double-billing protection across 8 categories (`scripts/harness-audit.js`, ported from ecc `harness-audit.js`).

## Usage

```
/ccp:audit [--since <date>] [--format md|json]
```

| Argument | Description |
|------|------|
| `--since <date>` | Only jobs created on or after this date (`YYYY-MM-DD`). Default: no filter. A value that is not a date is ignored and every job is audited. |
| `--format md\|json` | Output format (default: `md`) |

## Behavior

1. Invoke `harness-audit.js`.
2. Resolve the job directory the same way every companion entry point does: `CCP_JOBS_DIR` → `CLAUDE_PROJECT_DIR` → `CLAUDE_PROJECT_ROOT` → the current working directory.
3. Read every `_workspace/_jobs/*/meta.json` (the legacy `result_file_path` key is still read and normalized to `result_path`).
4. Compute 8 category scores (0-5 each; `N/A` is excluded from both the total and the max):
   - **Context Efficiency** — share of jobs whose `summary_3lines` is missing or ≤ 500 chars, × 5
   - **Cost Efficiency** — share of jobs with `token_usage.estimated === false`, × 5
   - **Router Accuracy** — 5 if `_workspace/04_router_report.md` exists, else `N/A` (does not measure accuracy)
   - **Double-billing Detection** — share of jobs with no summary, or with a result file whose byte size exceeds the summary length, × 5
   - **Fallback Health** — `N/A` with no jobs; 5 with zero `CCP-OAUTH-001` errors, else 3
   - **Plugin Compatibility** — share of the 5 standard `plugin.json` fields present (`name`/`version`/`description`/`author`/`license`), × 5
   - **Borrowed-code Documentation** — average of (upstream license texts present in `LICENSES/`) and (Apache-2.0 adapted files carrying their upstream header), × 5
   - **Secret Leak Check** — 5 if no secret pattern appears in job metadata, else 0
5. Persist the report to an absolute path under `_workspace/_audits/<YYYY-MM-DDTHHMMSSZ>.md` or `.json`.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/harness-audit.js" [--since <date>] [--format md|json]
```

## Output (Success)

```json
{
  "summary": "Total score 38/40. 3 jobs scanned. Report: /abs/project/_workspace/_audits/2026-09-26T101500123Z.md",
  "result_path": "/abs/project/_workspace/_audits/2026-09-26T101500123Z.md",
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
      "borrowed_code_documented": 5,
      "secret_leak": 5
    },
    "jobs_count": 3,
    "since": null
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
- Produce a score or N/A for all 8 categories.
- Persist the report file under `_workspace/_audits/`.

## Spec SSOT

- `plugins/ccp/scripts/harness-audit.js` (scoring rubric + report writer)
- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
- docs/en/architecture.md in the CCP repository (subagent isolation principle)
