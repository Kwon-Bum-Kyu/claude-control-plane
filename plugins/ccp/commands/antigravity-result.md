---
description: Retrieves the result of a completed Antigravity background job (summary + result file path). Raw result content is not included in the envelope.
argument-hint: <job_id> [--summary-only]
allowed-tools:
  - Bash
---

# /antigravity:result

Retrieves the result of a job started with `/antigravity:rescue --background`. **Raw result content is not included in the envelope**, and only the file path is returned to prevent it from flowing into main context (double-billing prevention — see README §4).

## Usage

```
/antigravity:result <job_id> [--summary-only]
```

| Argument | Description |
|------|------|
| `<job_id>` | UUID v4 of the completed job (required) |
| `--summary-only` | Return only the summary without opening the result file (to avoid `CCP-CTX-001`) |

## Behavior

1. Validate the UUID v4 pattern.
2. Call `antigravity-companion.mjs result <job_id>`.
3. The companion verifies `meta.status==completed` and returns only an envelope with `result_file_path` plus a 3-line summary.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" result <job_id> [--summary-only]
```

## Output (Success)

```json
{
  "summary": "≤3-line summary (hard cap: 500 chars)",
  "result_path": "_workspace/_jobs/<uuid>/result.md",
  "tokens": { "input": 97, "output": 580, "estimated": true },
  "exit_code": 0,
  "details": { "mode": "antigravity", "job_id": "<uuid>", "antigravity_conversation_id": "<uuid|null>" }
}
```

Main Claude should pass `result_path` to the user, but **must not open it with a Read tool on its own** (partial reading is allowed only on explicit user request).

## Error Codes

| Code | Cause | recovery |
|------|------|:---:|
| `CCP-INVALID-001` | Invalid UUID format | abort |
| `CCP-JOB-001` | job directory missing | abort |
| `CCP-JOB-002` | still running or failed | retry — wait via `/antigravity:status` |
| `CCP-JOB-003` | meta.json corrupted | abort |
| `CCP-JOB-004` | meta exists but `result.md` is missing | abort |

## Acceptance Criteria

- Respond within 1 second.
- Do not include `result.md` body content in the envelope (main-context protection — summary ≤ 500 chars).

## Spec SSOT

- `plugins/ccp/scripts/antigravity-companion.mjs:cmdResult`
- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
