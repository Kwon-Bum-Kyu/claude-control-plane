---
description: Delegates work that Codex is strong at, such as code review, bug investigation, and diff analysis, to reduce main Claude context tokens.
argument-hint: <task> [--background] [--model NAME] [--effort low|medium|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude] [--mcp NAME[,NAME...]]
allowed-tools:
  - Bash
---

# /ccp:codex-rescue

Delegates work to a Codex CLI subagent to reduce main Claude context tokens. Only a summary and result file path are returned to the main agent (double-billing prevention — see docs/en/architecture.md in the CCP repository).

## Usage

```
/ccp:codex-rescue <task> [--background] [--model NAME] [--effort low|medium|high] [--sandbox read-only|workspace-write|danger-full-access] [--cwd DIR] [--timeout-ms N] [--fallback-claude] [--mcp NAME[,NAME...]]
```

| Argument | Description |
|------|------|
| `<task>` | Task description to delegate to Codex (required) |
| `--background` | Detached async execution. Returns `job_id` immediately, then retrieve via `/ccp:codex-status` and `/ccp:codex-result` |
| `--model NAME` | Model alias (for example `gpt-5-codex-medium`). Uses Codex default if omitted |
| `--effort low\|medium\|high` | Reasoning effort. Translated to `-c model_reasoning_effort=` (Codex has no direct flag) |
| `--sandbox MODE` | `read-only` (default) / `workspace-write` / `danger-full-access` |
| `--cwd DIR` | Codex working root (`-C` mapping) |
| `--timeout-ms N` | Foreground response timeout (default 600000). Passed to worker metadata for background jobs |
| `--fallback-claude` | Skip companion invocation. Main Claude handles the task directly (for reinvocation on the next turn after auth failure) |
| `--mcp NAME[,NAME...]` | Before delegating, run `codex mcp list --json` once and stop with `CCP-MCP-001` if any named MCP server is not registered, is disabled, or the list cannot be read. Comma-separated; each name starts with a letter or digit and uses only letters, digits, `.`, `_`, `-`. Skipped together with `--fallback-claude` |

If the task depends on a specific MCP server in Codex (for example a browser-automation server), add `--mcp <name>` so a missing or disabled server is reported before delegation instead of the delegated task failing quietly.

## Behavior

1. If `--fallback-claude` is present, return a fallback envelope immediately and skip companion invocation.
2. If `--mcp` is present, run `codex mcp list --json` once (30s timeout) and compare it with the named servers. Stop with `CCP-MCP-001` if any is not registered or disabled, or if the list cannot be read. Only server names and enabled states are read from the list output; it is never stored or echoed. A `--background` call goes through this step too, before any job is created.
3. Preflight: run `codex login status` (30s timeout). Emit `CCP-OAUTH-101` if not authenticated.
4. Foreground: call `codex exec --json --skip-git-repo-check -s <sandbox> -C <cwd> "<task>"` (stdin forcibly closed). Parse 4 JSONL events into summary, tokens, and thread_id.
5. Background: spawn a detached worker through `core/runtime.mjs:runBackground` (file-fd stdio). Return `{job_id, status:"queued"}` immediately.

## Invocation Pattern

The `codex-rescue` subagent (`agents/codex-rescue.md`) invokes the following single Bash pattern.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" rescue [--background] [--model NAME] [--effort LEVEL] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude] [--mcp NAME[,NAME...]] -- "<task>"
```

## Output (Foreground Success)

```json
{
  "summary": "≤500-char summary",
  "result_path": null,
  "tokens": { "input": 22397, "cached": 5504, "output": 24, "total": 16917 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "codex_thread_id": "019dda15-d027-77f3-ba78-84bb289d14a9",
    "duration_ms": 7245,
    "model": "gpt-5-codex-medium"
  }
}
```

## Output (Background Success)

```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "next_action": "Use /ccp:codex-status <job_id> to check progress, then /ccp:codex-result <job_id> when ready.",
  "details": { "mode": "codex", "pid": 32154 }
}
```

## Error Codes (Summary)

| Code | recovery | Recommended main-Claude response |
|------|:---:|----------------------|
| `CCP-SETUP-101` | abort | Show Codex CLI install guidance |
| `CCP-SETUP-102` | abort | Show Codex CLI upgrade guidance |
| `CCP-OAUTH-101` | fallback_claude | Use `AskUserQuestion` to offer re-auth, fallback, or cancel |
| `CCP-CODEX-001` | retry | Point to stderr logs and retry in main Claude |
| `CCP-CODEX-002` | retry | No JSONL response — rerun with verbose output |
| `CCP-MCP-001` | abort | Show the `action` commands (register or enable the MCP server) to the user, who runs them and then calls again. Do not run them on the user's behalf |
| `CCP-INVALID-001` | abort | Show usage |
| `CCP-TIMEOUT-001` | retry | Retry or recommend `--background` |

See the `errors` block in `plugins/ccp/scripts/adapters/codex.mjs` for the full catalog.

## Model Compatibility

Codex-only options such as `--effort` and `--sandbox <mode>` are listed per CLI in docs/en/slash-commands.md in the CCP repository. Antigravity rejects `--effort` with `CCP-INVALID-001`.

## Acceptance Criteria

- Foreground: respond within ~15s or return an error envelope.
- Background: return `job_id` within 1 second.
- Pass the envelope schema (`plugins/ccp/schemas/envelope.schema.json`) 100%.
- Main-context ingress ≤ 500 characters.

## Spec SSOT

- `plugins/ccp/schemas/envelope.schema.json`
- `plugins/ccp/scripts/adapters/codex.mjs` `errors` (error code SSOT, merged with `core/errors.mjs`'s shared catalog)
- `plugins/ccp/scripts/core/runtime.mjs:handleRescue` (dispatch logic shared across CLIs)
