---
description: Checks the current status of an Antigravity job created with --background.
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /antigravity:status

Checks the progress state of an Antigravity job started in `--background` mode.

## Usage

```
/antigravity:status <job_id>
```

| Argument | Description |
|------|------|
| `<job_id>` | UUID v4 returned by `/antigravity:rescue --background` (required) |

## Behavior

1. Validate the UUID v4 pattern (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).
2. Call `antigravity-companion.mjs status <job_id>` — the companion reads `_workspace/_jobs/<job_id>/meta.json`.
3. Main Claude does not read `meta.json` directly, preserving the permission boundary and schema-conversion layer.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" status <job_id>
```

## Output (Success)

```json
{
  "summary": "job <status>",
  "result_path": null,
  "tokens": { "input": 0, "output": 0, "estimated": true },
  "exit_code": 0,
  "details": {
    "job_id": "<uuid>",
    "status": "queued | running | completed | failed",
    "created_at": "2026-05-28T09:00:00Z",
    "started_at": "2026-05-28T09:00:01Z",
    "completed_at": "2026-05-28T09:00:12Z",
    "next_action": "/antigravity:result <job_id> (when status=completed)"
  }
}
```

## Error Codes

| Code | Cause | recovery |
|------|------|:---:|
| `CCP-INVALID-001` | invalid UUID format | abort |
| `CCP-JOB-001` | job directory missing | abort |
| `CCP-JOB-003` | failed to parse `meta.json` | abort |

## Acceptance Criteria

- Respond within 1 second.
- `details.status` must be one of `queued|running|completed|failed`.

## Spec SSOT

- `plugins/ccp/scripts/core/runtime.mjs:handleStatus`
- `plugins/ccp/scripts/core/jobs.mjs` (job-meta read/write)
- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
