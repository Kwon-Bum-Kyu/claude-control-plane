---
description: Delegates heavy summarization, analysis, and large-context processing to Gemini CLI to reduce main Claude context tokens.
argument-hint: <task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
allowed-tools:
  - Bash
---

# /gemini:rescue

Delegates work to a Gemini CLI subagent to reduce main Claude context tokens. Only a 3-line summary and result file path are returned to the main agent (double-billing prevention — see README §4).

## Usage

```
/gemini:rescue <task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
```

| Argument | Description |
|------|------|
| `<task>` | Task description to delegate to Gemini (required) |
| `--background` | Detached async execution. Returns `job_id` immediately, then retrieve via `/gemini:status` and `/gemini:result` |
| `--max-tokens N` | Response token cap (default 4000) |
| `--files <glob>` | File glob for Gemini to reference |
| `--fallback-claude` | Skip companion invocation. Main Claude handles the task directly (for reinvocation on the next turn after OAuth failure) |

## Behavior

1. If `--fallback-claude` is present, return a `mode: "fallback_claude"` envelope immediately and skip companion invocation.
2. Preflight: the companion verifies Node.js ≥ v20, `gemini --version` ≥ 0.38.0, and OAuth credentials (`GEMINI_API_KEY` or `~/.gemini/google_accounts.json`).
3. Foreground: synchronous execution. The companion runs `gemini -p <task> -o json`, stores `result.md`, and returns an envelope with a 3-line summary plus token stats.
4. Background: creates a detached child process, persists `_workspace/_jobs/<uuid>/{meta.json,result.md,stderr.log}`, and returns `{job_id, status: "queued"}` within 1 second.

## Invocation Pattern

Invoked through the `gemini-rescue` subagent with the following single Bash pattern.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" rescue --task "<task>" [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
```

## Output (Foreground Success)

```json
{
  "summary": "≤3-line summary (hard cap: 500 chars)",
  "result_path": "_workspace/_jobs/<uuid>/result.md",
  "tokens": { "input": 12340, "output": 820 },
  "exit_code": 0,
  "details": { "mode": "gemini", "job_id": "<uuid>", "gemini_session_id": "<uuid|null>" }
}
```

## Output (Background Success)

```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "next_action": "/gemini:status <job_id>",
  "details": { "mode": "background", "pid": <number> }
}
```

## Error Codes (Summary)

| Code | recovery | Recommended main-Claude response |
|------|:---:|----------------------|
| `CCP-SETUP-001` | abort | Show Gemini CLI install guidance |
| `CCP-SETUP-002` | abort | Show Node.js ≥ v20 install guidance |
| `CCP-OAUTH-001` | fallback | Use `AskUserQuestion` to offer re-auth, `/gemini:rescue --fallback-claude`, or cancel |
| `CCP-GEMINI-002` | fallback | Explain quota limits and offer main-Claude fallback |
| `CCP-CTX-001` | abort | Response estimated above 1,500 tokens — recommend `/gemini:result <job_id> --summary-only` |
| `CCP-INVALID-001` | abort | Show usage |
| `CCP-TIMEOUT-001` | retry | Retry or recommend `--background` |

See the ERROR_CATALOG block in `plugins/ccp/scripts/gemini-companion.mjs` for the full catalog.

## Acceptance Criteria

- Foreground: respond within 15 seconds or return an error envelope.
- Background: return `job_id` within 1 second.
- All errors must use the common envelope (`error.code` regex `^CCP-[A-Z]+-[0-9]{3}$` matches 100%).
- Main-context ingress ≤ 500 characters.
- No automatic fallback — if Gemini fails, offer options to the user.

## Spec SSOT

- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
- `plugins/ccp/scripts/gemini-companion.mjs` ERROR_CATALOG (error code SSOT)
