---
description: Delegates heavy summarization, analysis, and large-context processing to Antigravity CLI (`agy`) to reduce main Claude context tokens.
argument-hint: <task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
allowed-tools:
  - Bash
---

# /ccp:antigravity-rescue

Delegates work to an Antigravity CLI subagent to reduce main Claude context tokens. Only a 3-line summary and result file path are returned to the main agent (double-billing prevention — see README §4).

## Usage

```
/ccp:antigravity-rescue <task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
```

| Argument | Description |
|------|------|
| `<task>` | Task description to delegate to Antigravity (required) |
| `--background` | Detached async execution. Returns `job_id` immediately, then retrieve via `/ccp:antigravity-status` and `/ccp:antigravity-result` |
| `--max-tokens N` | Response token cap (default 4000) — embedded as a soft prompt hint, since `agy` has no `--max-tokens` flag |
| `--files <glob>` | File glob for Antigravity to reference (MVP: not yet wired into `--add-dir`) |
| `--fallback-claude` | Skip companion invocation. Main Claude handles the task directly (for reinvocation on the next turn after auth failure) |

## Behavior

1. If `--fallback-claude` is present, return a `mode: "fallback_claude"` envelope immediately and skip companion invocation.
2. Preflight: the companion verifies Node.js ≥ v20 and `agy --version` ≥ 1.0.0. Authentication relies on `agy`'s keyring silent-auth or `ANTIGRAVITY_API_KEY`.
3. Foreground: synchronous execution. The companion runs `agy --log-file <jobLog> -p <task>`, stores `result.md`, and returns an envelope with a 3-line summary plus character-based token estimates (`tokens.estimated: true`).
4. Background: creates a detached child process, persists `_workspace/_jobs/<uuid>/{meta.json,result.md,stderr.log,agy.log}`, and returns `{job_id, status: "queued"}` within 1 second.

## Security Notice — Automatic Tool-Permission Approval

Every call attaches `--dangerously-skip-permissions`, which auto-approves every tool-permission prompt the delegated `agy` model raises during this call (shell commands, file writes, etc.). This applies to both foreground and background calls. It is on by default because non-interactive `-p` mode has nobody to answer those prompts — without it, any task that needs a tool fails with a soft-denied confirmation.

When the task involves untrusted input (content fetched from the network, files from outside the project, or anything you did not author yourself), pass `--sandbox` as well to constrain what the auto-approved tool calls can reach.

To disable auto-approval entirely, set `CCP_AGY_SKIP_PERMISSIONS=0` (also accepts `false` / `no`, case-insensitive) in the environment before invoking this command. Tasks that need a tool will then fail with the original soft-denied-confirmation behavior instead of running unattended.

## Invocation Pattern

Invoked through the `antigravity-rescue` subagent with the following single Bash pattern.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" rescue --task "<task>" [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
```

## Output (Foreground Success)

```json
{
  "summary": "≤3-line summary (hard cap: 500 chars)",
  "result_path": "/absolute/path/to/project/_workspace/_jobs/<uuid>/result.md",
  "tokens": { "input": 97, "output": 580, "estimated": true },
  "exit_code": 0,
  "details": { "mode": "antigravity", "job_id": "<uuid>", "antigravity_conversation_id": "<uuid|null>" }
}
```

## Output (Background Success)

```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "next_action": "/ccp:antigravity-status <job_id>",
  "details": { "mode": "background", "pid": <number> }
}
```

## Error Codes (Summary)

| Code | recovery | Recommended main-Claude response |
|------|:---:|----------------------|
| `CCP-SETUP-001` | abort | Show Antigravity CLI install guidance (`curl -fsSL https://antigravity.google/cli/install.sh \| bash`) |
| `CCP-SETUP-002` | abort | Show Node.js ≥ v20 install guidance |
| `CCP-OAUTH-001` | fallback | Use `AskUserQuestion` to offer re-auth (run `agy` once), set `ANTIGRAVITY_API_KEY`, `/ccp:antigravity-rescue --fallback-claude`, or cancel |
| `CCP-AG-002` | fallback | Explain quota limits and offer main-Claude fallback |
| `CCP-INVALID-001` | abort | Show usage |
| `CCP-TIMEOUT-001` | retry | Retry or recommend `--background` |

See the `errors` block in `plugins/ccp/scripts/adapters/antigravity.mjs` for the full catalog.

## Acceptance Criteria

- Foreground: respond within the configured timeout (`--timeout-ms`, default 10 min) or return an error envelope.
- Background: return `job_id` within 1 second.
- All errors must use the common envelope (`error.code` regex `^CCP-[A-Z]+-[0-9]{3}$` matches 100%).
- Main-context ingress ≤ 500 characters.
- No automatic fallback — if Antigravity fails, offer options to the user.

## Spec SSOT

- `plugins/ccp/schemas/envelope.schema.json` (envelope contract — `details.mode === "antigravity"`)
- `plugins/ccp/scripts/adapters/antigravity.mjs` `errors` (error code SSOT, merged with `core/errors.mjs`'s shared catalog)
- `plugins/ccp/scripts/core/runtime.mjs:handleRescue` (dispatch logic shared across CLIs)
