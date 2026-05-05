---
description: Retrieves the result of a completed codex background job (summary + result file path). Raw result content is not included in the envelope.
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /ccp:codex-result

Retrieves the result of a completed codex job. The only text allowed into main context is the summary (≤500 chars) plus the result file path, and the body is exposed only when the user explicitly asks to read it (double-billing prevention — Principle 7).

## Usage

```
/ccp:codex-result <job_id>
```

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" result <job_id>
```

## Output (Success)

```json
{
  "summary": "≤500-char summary",
  "result_path": "_workspace/_jobs/<uuid>/result.txt",
  "tokens": { "input": 22397, "cached": 5504, "output": 124, "total": 17017 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "job_id": "<uuid>",
    "codex_thread_id": "019dda15-d027-77f3-ba78-84bb289d14a9",
    "duration_ms": 18430
  }
}
```

## Error Codes

| Code | Cause | recovery |
|------|------|:---:|
| `CCP-JOB-001` | job_id does not exist | abort |
| `CCP-JOB-002` | job still in progress (queued/running) | retry |
| `CCP-JOB-004` | result file missing or job ended in failure | abort |
| `CCP-INVALID-001` | missing job_id argument | abort |

## Spec SSOT

- `plugins/ccp/scripts/codex-companion.mjs:handleResult`
- `plugins/ccp/schemas/envelope.schema.json`
