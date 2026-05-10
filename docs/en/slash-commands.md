# Slash command reference

CCP exposes nine slash commands across three groups: Gemini delegation, Codex delegation, and the shared audit. Every command returns a JSON envelope with the same shape (see [architecture](./architecture.md#envelope-schema)).

## Gemini (large summaries and analysis)

| Command | Purpose |
|---|---|
| `/gemini:rescue <prompt>` | Delegate a heavy task to Gemini |
| `/gemini:status <job_id>` | Check a background job's status |
| `/gemini:result <job_id>` | Retrieve a completed job's summary and `result_path` |
| `/gemini:setup [--renew]` | Diagnose Gemini CLI and OAuth state |

## Codex (code review, diff, bug investigation)

| Command | Purpose |
|---|---|
| `/ccp:codex-rescue <prompt>` | Delegate code-reasoning work to Codex |
| `/ccp:codex-status <job_id>` | Check a background job's status |
| `/ccp:codex-result <job_id>` | Retrieve a completed job's summary and `result_path` |
| `/ccp:codex-setup` | Diagnose Codex CLI and OAuth state |

## Common

| Command | Purpose |
|---|---|
| `/ccp:audit [--since N --format md\|json]` | Score eight audit categories over the chosen time window |

The full markdown specs (description, examples, exit codes) live in `plugins/ccp/commands/*.md`.

## Flag matrix

| Flag | Gemini | Codex | Notes |
|---|:---:|:---:|---|
| `--background` | yes | yes | Returns `job_id` immediately |
| `--fallback-claude` | yes | yes | Override the router and run on Claude |
| `--timeout-ms N` | yes (default 600000) | yes (default 600000) | Foreground timeout |
| `--poll-interval-ms N` | yes (2000) | yes (2000) | Background polling cadence |
| `--max-tokens N` | yes (default 4000) | no | Gemini-only; rendered as a prompt suffix |
| `--files <glob>` | partial (backlog) | no | Gemini-only attachment |
| `--model NAME` | no | yes | Codex model alias |
| `--effort low\|medium\|high` | no, returns `CCP-INVALID-001` | yes (`-c model_reasoning_effort=...`) | Codex-only reasoning effort |
| `--sandbox MODE` | no, returns `CCP-INVALID-001` | yes (`read-only` / `workspace-write` / `danger-full-access`) | Codex sandbox |
| `--cwd DIR` | no | yes | Codex working directory |
| `--renew` | yes | (use `codex login` directly) | Re-auth guidance |

If you pass a Codex-only flag to `/gemini:rescue` (or vice versa), the companion rejects it inline with `CCP-INVALID-001`. This is intentional: it surfaces the wrong slash command early instead of silently dropping the flag.

## Three-way compatibility

| Capability | Claude | Gemini | Codex | Notes |
|---|:---:|:---:|:---:|---|
| `--background` | n/a | yes | yes | Claude is the main context, no async |
| `--model NAME` | `/model` slash | yes | yes | Claude uses the built-in `/model` |
| `--effort low\|medium\|high` | extended thinking | no | yes | Claude uses Option+T to toggle thinking |
| `--sandbox <mode>` | n/a (does not run) | no | yes | Codex only |
| `--write` | n/a | no | yes (alias for `--sandbox workspace-write`) | Codex shorthand |
| `--cwd DIR` | n/a (per turn) | no | yes (`-C`) | Codex only |
| `--max-tokens N` | n/a | yes (prompt suffix) | no | Gemini only |
| `--files <glob>` | (chat attachment) | partial (backlog) | no | Gemini backlog |
| `--resume-last` | n/a | partial (meta-file) | yes (`codex resume --last`) | Codex CLI native; scoped to current cwd (use `codex resume --all` for other dirs) |

## Examples

### Background job lifecycle

```text
/gemini:rescue --background "summarize the last 24h of /var/log/app/error.log"
# -> envelope.summary contains job_id
/gemini:status <job_id>     # queued / running / completed / failed
/gemini:result <job_id>     # summary + result_path
```

### Codex with explicit effort and sandbox

```text
/ccp:codex-rescue --effort high --sandbox workspace-write --cwd $(pwd) -- "find race conditions in the order pipeline"
```

### Audit a week's activity as JSON

```text
/ccp:audit --since 7d --format json
```

The envelope's `details.scores` field contains the per-category scores (0-5 each). Total is the sum across all categories that have a numeric score.

## Exit codes inside envelopes

The companion always returns exit-code `0` to Claude Code; the actual outcome is in the envelope's `exit_code` field. CI and automation should branch on `exit_code`, not on the OS-level shell exit.

## Related reading

- [Router behavior](./router.md) for how a slashless prompt is routed
- [Architecture](./architecture.md) for the envelope schema
- [Troubleshooting](./troubleshooting.md) for `CCP-INVALID-001` and friends
