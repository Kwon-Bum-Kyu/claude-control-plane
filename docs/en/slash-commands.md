# Slash commands

This document covers the slash commands CCP provides, rescue flags, running a companion directly, `/ccp:audit`, and the shape of the response envelope. See [Getting started](./getting-started.md) for the install and authentication steps, and [Router](./router.md) for how prompts without a slash command are routed.

## Command list

CCP provides 9 slash commands under the `/ccp:` namespace. Each command file's stem is the command name. For example, the `antigravity-rescue.md` file becomes the `/ccp:antigravity-rescue` command.

| Command | Description | Arguments |
|---|---|---|
| `/ccp:antigravity-rescue` | Delegates large-scale summarization and analysis work to the Antigravity CLI (agy), reducing the main Claude context's token usage. | `<task> [--background] [--max-tokens N] [--files <glob>] [--timeout-ms N] [--fallback-claude] [--mcp NAME[,NAME...]] [--sandbox] [--cwd DIR]` |
| `/ccp:antigravity-status` | Checks the current status of an Antigravity job created with `--background`. | `<job_id>` |
| `/ccp:antigravity-result` | Retrieves the result of a completed Antigravity background job. | `<job_id>` |
| `/ccp:antigravity-setup` | Checks the Antigravity CLI (agy)'s install and authentication status, and shows install or re-authentication guidance on failure. | None |
| `/ccp:codex-rescue` | Delegates work Codex is strong at (code review, bug investigation, diff analysis), reducing the main Claude context's token usage. | `<task> [--background] [--model NAME] [--effort low\|medium\|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude] [--mcp NAME[,NAME...]]` |
| `/ccp:codex-status` | Checks the current status of a Codex job created with `--background`. | `<job_id>` |
| `/ccp:codex-result` | Retrieves the result of a completed Codex background job. | `<job_id>` |
| `/ccp:codex-setup` | Checks the Codex CLI's install and OAuth authentication status, and shows install or re-authentication guidance on failure. | `""`(no arguments) |
| `/ccp:audit` | A command ported from ecc's harness-audit.js. Scores CCP job records across 8 categories and writes a report. | `"[--since YYYY-MM-DD] [--format md\|json]"` |

## rescue flags

The flags `/ccp:antigravity-rescue` and `/ccp:codex-rescue` accept are as follows. Most flags have a real effect on only one of the two CLIs.

| Flag | Antigravity behavior | Codex behavior | Default |
|---|---|---|---|
| `--background` | A bool flag. If true, calls `runBackground`; otherwise `runForeground` (shared core logic between both CLIs). | Same. | false |
| `--fallback-claude` | A bool flag. If true, skips the companion call and immediately returns a success envelope with `mode: "fallback_claude"`. | Takes the same path, but `details.mode` is always `codex` regardless of subcommand. | false |
| `--mcp NAME[,NAME...]` | A string. Right before delegating, runs `agy mcp list` once and checks that every named MCP server is registered and enabled. If any is not registered, is disabled, or the list cannot be read, stops with `CCP-MCP-001`. Put the value after a space, as in `--mcp a,b`. | The same flow; only the list command is `codex mcp list --json`. | None (no check unless given) |
| `--sandbox` | A valueless bool flag. If present, appends bare `--sandbox` (no value) to the agy call. | A string enum (`read-only`, `workspace-write`, `danger-full-access`). An empty value or a boolean is normalized to `read-only` and passed as `-s <mode>`. | Antigravity: not attached unless given. Codex: `read-only`. |
| `--max-tokens N` | An integer. A soft constraint that appends an "(Answer within N tokens if possible)" hint after the prompt; not an agy flag itself. | Not declared. Giving it is rejected with `CCP-INVALID-001`. | 4000(Antigravity only) |
| `--timeout-ms N` | An integer. Both the foreground run and the background worker use this value as their timeout (shared core logic between both CLIs). Without it, the adapter's declared default for that path applies. | Same. | Adapter-declared: 600000 for both paths on both CLIs (allowed range 5000-3600000). A foreground call made through a slash command gets 540000, which the subagent adds. Running the companion directly uses 600000. |
| `--files <glob>` | A string. Checks for absolute-path traversal first, but even after passing that check, always rejects with `CCP-INVALID-001`("--files is not supported in the MVP"). | Not declared. Giving it is rejected with `CCP-INVALID-001`. | None |
| `--task` | A string. If given, used as the prompt value, taking priority over the positional argument. | Same. | None(if given, takes priority over the positional-argument prompt) |
| `--effort low\|medium\|high` | Declared as a bool flag, but always rejects with `CCP-INVALID-001`("`--effort` is not supported by Antigravity") regardless of the value. | A string enum. Converted to `-c model_reasoning_effort=<level>` and passed as a codex config override. | None |
| `--write` | Declared as a bool flag, but always rejects with `CCP-INVALID-001`("`--write` is not supported by Antigravity") regardless of the value. | Not declared. Giving it is rejected with `CCP-INVALID-001`. | None |
| `--cwd DIR` | A string. The delegated CLI runs in this directory; no separate flag is passed to agy. If it is not an existing directory, it is rejected with `CCP-INVALID-001` before the CLI runs. | A string. The working directory and the existence check are the same as Antigravity, and it is also passed to codex exec as `-C <dir>`. | `process.cwd()` for both CLIs. |
| `--model NAME` | Not declared. There is no model-selection flag, and giving it is rejected with `CCP-INVALID-001`. | A string. Passed to codex exec as `-m <model>`; if omitted, uses the codex CLI's own default model. | None(uses the codex CLI's own default if omitted) |

The `--mcp` value is a comma-separated list of MCP server names. Leading and trailing spaces and empty items are dropped, and a repeated name is checked only once. A name must start with a letter or digit and may contain only letters, digits, `.`, `_`, and `-`. A value that breaks this rule, or an empty value, is rejected with `CCP-INVALID-001`. Names are compared with the registered list by exact, case-sensitive match. When given together with `--fallback-claude`, both the value check and the pre-check are skipped. A background call goes through the same pre-check before any job is created, and returns an error envelope instead of a `job_id` if the check fails. CCP never runs the register or enable command it suggests. Because the raw list output can contain secrets such as authentication headers, only server names and enabled states are read from it, and it is never stored or printed anywhere.

Codex rescue calls use a separator like `-- "the actual task string"`. Every token after this separator is treated as a positional argument, i.e. the prompt, not an option.

See the "Configuration and security" section of the [Getting started](./getting-started.md) document for the tool-permission auto-approval flag automatically attached to Antigravity calls and how to configure it.

## How undeclared flags are handled

Both companions classify arguments against the flags each CLI declares. If an undeclared flag appears before the `--` separator, it is rejected with `CCP-INVALID-001` before any work starts. Every token of two or more characters that starts with `-`, such as `--name`, `--name=value`, or `-x`, is covered, and the rejection reports only the first such flag. The flags marked "Not declared" in the table above fall under this rule too. Flag names are accepted only in the spelling shown in the table above (lowercase with `-`, such as `--timeout-ms` or `--job-id`); a camelCase spelling such as `--timeoutMs` is rejected as an undeclared flag.

The rejection envelope's `message` says which flag the CLI does not support, and its `action` lists the flags that CLI accepts. `details.unsupported_flag` (`error.details.unsupported_flag` for Antigravity) carries only the flag name. A value given as `--name=value` is never put in the envelope, because it may contain a secret.

Every token after `--` goes into the task text, even when it starts with `-`. A lone `-` is also treated as part of the task. If the task starts with `-`, put it after `--`, or on Antigravity pass it with `--task`.

Both CLIs also accept a declared flag in the `--name=value` form. When `--background` or `--fallback-claude` is given a value, `true` and `1` read as true, and `false` and `0` read as false. Any other bool flag given a value with `=` counts as on regardless of the value; for example, `--sandbox=false` on Antigravity still turns the sandbox on. The rule for a value separated by a space differs by CLI: Antigravity always reads the token after a string or integer flag as its value, while Codex reads it as the value only when it does not start with `-`. On Codex, give a value that starts with `-` as `--name=value`. On both CLIs, a bool flag never reads the following token as its value.

## status, result, setup

`/ccp:antigravity-status <job_id>` and `/ccp:codex-status <job_id>` check the current status of a job created with `--background`.

If the job you look up is `running` but the process that owns it has already exited, status records that job as `failed` by the same rule as the subagent-termination hook, then reports it. See the 'Hooks' section of the [Architecture](./architecture.md) document for the rule. result does not finalize records, so check the state with status before fetching a result.

`/ccp:antigravity-result <job_id>` and `/ccp:codex-result <job_id>` retrieve the summary and `result_path` of a completed job.

`/ccp:antigravity-setup` and `/ccp:codex-setup` take no arguments and check each CLI's install and authentication status.

The `status` and `result` handlers can also take the value as `--job-id <uuid>` instead of the positional argument `<job_id>` (read as `parsed.flags.jobId || parsed.positional[0]`). The positional argument is recommended; `--job-id` is an alternative. Both CLIs declare this flag.

Antigravity actually validates that job_id satisfies the UUID v4 regex `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. Codex does not declare this validation function, so any non-empty value passes. Codex's job_id has no format check.

## Running a companion directly

The companion script declares more subcommands than the slash commands. You can run it directly in the following form.

```
node plugins/ccp/scripts/companion.mjs <antigravity|codex> <subcommand> [...args]
```

Or use the CLI-fixed aliases.

```
node plugins/ccp/scripts/antigravity-companion.mjs <subcommand> [...args]
node plugins/ccp/scripts/codex-companion.mjs <subcommand> [...args]
```

The subcommands Antigravity declares are `rescue`, `status`, `result`, `setup`, `preflight`. The subcommands Codex declares are `setup`, `rescue`, `status`, `result`, `cancel`.

`preflight` is Antigravity-only and has no slash command. It is meant to be called directly by harness scripts to pre-check authentication status.

`cancel` is Codex-only and has no slash command. It cancels an in-progress job. The worker process and the CLI it runs are in the same process group, so the termination signal (SIGTERM) goes to the whole group and the delegated CLI stops too. If the group cannot be signaled, only the worker process is signaled. A CLI that ignores the termination signal, or a child process that started its own process group, can be left running. Calling it on a job that cannot be canceled returns an error. See the "Error codes" section of the [Troubleshooting](./troubleshooting.md) document for the cause and remedy.

## /ccp:audit

`/ccp:audit` is a separate command that runs harness-audit.js directly, not through the companion path. Job path resolution follows the same rule as the companion (`resolvePaths`), and the report is written as an absolute path under `_workspace/_audits/`. The envelope's `result_path` and `summary` are also both absolute paths.

`--since` accepts only the `YYYY-MM-DD` format. Any other value is silently ignored and every job gets audited. `--format` is `md` or `json`, defaulting to `md`.

Job records that have only the legacy `result_file_path` key are also automatically normalized to `result_path` when read.

The audit scores 8 categories from 0 to 5; an `N/A` verdict is excluded from both the total and the maximum score.

| Category | Verdict |
|---|---|
| context_efficiency | The proportion of jobs where `summary_3lines` is absent or 500 characters or fewer, x 5 |
| cost_efficiency | The proportion of jobs where `token_usage.estimated` is false, x 5 |
| router_accuracy | 5 if `_workspace/04_router_report.md` exists, N/A otherwise(accuracy itself is not measured). |
| double_billing | The proportion of jobs where the summary is absent or the result file's byte size exceeds the summary length, x 5 |
| fallback_health | N/A if there are no jobs. 5 if there are 0 `CCP-OAUTH-001` occurrences, 3 if there are any(retry tracking is not yet implemented). |
| plugin_compat | The proportion of the 5 standard `plugin.json` fields that are present, x 5 |
| borrowed_code_documented | (existence of the 3 `LICENSES/` texts + existence of headers in the 5 Apache-borrowed files) / 2 x 5 |
| secret_leak | 5 if no secret pattern is found(Bearer, ANTIGRAVITY_API_KEY, GEMINI_API_KEY, values starting with AKIA, etc.), 0 if any is found |

If there are no jobs at all, it returns `CCP-AUDIT-001`. If creating or writing the report directory fails, it returns `CCP-AUDIT-002`. See the "Error codes" section of the [Troubleshooting](./troubleshooting.md) document for both codes' cause text and remedy.

In a marketplace install, the `LICENSES/` directory may be missing, so the borrowed_code_documented score can be 0 in that case.

## Response envelope

CCP's companion and audit script respond in one of three shapes: success, background acceptance, or error.

### Success

The success envelope's keys are frozen in the schema with `additionalProperties: false`, and there are only 7: `summary`, `summary_truncated`, `result_path`, `tokens`, `exit_code`, `auto_routed`, `details`. Of these, `summary`, `tokens`, and `exit_code` are required.

`tokens`'s shape differs by CLI. Antigravity's is `{ input, output, estimated: true }`, a value estimated by multiplying the character count by 0.25, while Codex's is `{ input, cached, output, total }`, with no `estimated` field, and it is a measured value. `total` is `max(0, input - cached) + output`, that is, only the newly-billed tokens with the cached portion excluded.

`details.mode`'s actual value depends on the subcommand for Antigravity. `rescue` and `result` are `antigravity`, background acceptance is `background`, and using `--fallback-claude` gives `fallback_claude`. `setup`, `preflight`, and `status` have no `mode` key in `details` at all. Codex is always `codex`, regardless of subcommand.

`result_path` becomes `null` only during a Codex foreground rescue where the summary was not truncated. This is because no job record is left at all in that case. Antigravity always leaves a job record even in the foreground, so `result_path` is always populated.

`summary` never exceeds 500 characters. If it would exceed 500, it is truncated first at a sentence boundary; if that boundary falls below 60% of the budget, it is truncated at a whitespace boundary instead; failing that, it is truncated at the specified length as-is. A `...(truncated)` marker is appended at the cut point, and only then is `summary_truncated` `true`. It is not explicitly set to `false` when not truncated. The full text remains in the file `result_path` points to.

### Background acceptance

When accepted with `--background`, the response takes a third shape that is not subject to schema validation: `{ job_id, status: "queued", next_action, details? }`.

### Error

An error envelope consists of `error.code`, `error.message`, `error.action`, `error.recovery`, and the top-level `exit_code`, `auto_routed`, `details`. See the "Envelope and error-code scheme" section of the [Architecture](./architecture.md) document for the meaning of the `recovery` value and the detailed structural differences between the two CLIs.

### Exit codes

The companion returns 0 on success and 1 on error, the same for both CLIs.

## Next

See the [Router](./router.md) document to learn how the router branches prompts without a slash command to a CLI.
