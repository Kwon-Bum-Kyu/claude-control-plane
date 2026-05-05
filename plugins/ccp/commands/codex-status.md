---
description: "Checks the current status of a codex job created with --background."
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /ccp:codex-status

Checks the progress state of a codex job created in background mode (queued / running / completed / failed / cancelled / timeout).

## Usage

```
/ccp:codex-status <job_id>
```

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" status <job_id>
```

## Output (Success)

```json
{
  "summary": "job <uuid> state=running",
  "result_path": null,
  "tokens": { "input": 0, "output": 0, "total": 0 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "job_id": "<uuid>",
    "state": "running",
    "pid": 32154,
    "started_at": "2026-04-30T12:34:56.789Z",
    "completed_at": null
  }
}
```

## Error Codes

| Code | Cause | recovery |
|------|------|:---:|
| `CCP-JOB-001` | job_id does not exist | abort |
| `CCP-JOB-003` | meta.json is corrupted | abort |
| `CCP-INVALID-001` | missing job_id argument | abort |

## Spec SSOT

- `plugins/ccp/scripts/lib/codex-state.mjs`
- `plugins/ccp/schemas/envelope.schema.json`
