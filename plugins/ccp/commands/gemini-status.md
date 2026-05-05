---
description: Checks the current status of a job created with --background.
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /gemini:status

Checks the progress state of a Gemini job started in `--background` mode.

## Usage

```
/gemini:status <job_id>
```

| Argument | Description |
|------|------|
| `<job_id>` | UUID v4 returned by `/gemini:rescue --background` (required) |

## Behavior

1. Validate the UUID v4 pattern (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).
2. Call `gemini-companion.mjs status <job_id>` — the companion reads `_workspace/_jobs/<job_id>/meta.json`.
3. Main Claude does not read `meta.json` directly, preserving the permission boundary and schema-conversion layer.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" status <job_id>
```

## Output (Success)

```json
{
  "summary": "job <status>",
  "result_path": null,
  "tokens": { "input": 0, "output": 0 },
  "exit_code": 0,
  "details": {
    "job_id": "<uuid>",
    "status": "queued | running | completed | failed",
    "created_at": "2026-04-26T09:00:00Z",
    "started_at": "2026-04-26T09:00:01Z",
    "completed_at": "2026-04-26T09:00:12Z",
    "next_action": "/gemini:result <job_id> (when status=completed)"
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

- `plugins/ccp/scripts/gemini-companion.mjs:cmdStatus`
- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
