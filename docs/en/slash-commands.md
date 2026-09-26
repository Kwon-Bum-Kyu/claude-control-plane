# Slash commands

This document covers the slash commands CCP provides, rescue flags, running a companion directly, `/ccp:audit`, and the shape of the response envelope. See [Getting started](./getting-started.md) for the install and authentication steps, and [Router](./router.md) for how prompts without a slash command are routed.

## Command list

CCP provides 9 slash commands under the `/ccp:` namespace. Each command file's stem is the command name. For example, the `antigravity-rescue.md` file becomes the `/ccp:antigravity-rescue` command.

| Command | Description | Arguments |
|---|---|---|
| `/ccp:antigravity-rescue` | Delegates large-scale summarization and analysis work to the Antigravity CLI (agy), reducing the main Claude context's token usage. | `<task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]` |
| `/ccp:antigravity-status` | Checks the current status of an Antigravity job created with `--background`. | `<job_id>` |
| `/ccp:antigravity-result` | Retrieves the result of a completed Antigravity background job. | `<job_id> [--summary-only]` |
| `/ccp:antigravity-setup` | Checks the Antigravity CLI (agy)'s install and authentication status, and shows install or re-authentication guidance on failure. | None |
| `/ccp:codex-rescue` | Delegates work Codex is strong at (code review, bug investigation, diff analysis), reducing the main Claude context's token usage. | `<task> [--background] [--model NAME] [--effort low\|medium\|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude]` |
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
| `--sandbox` | A valueless bool flag. If present, appends bare `--sandbox` (no value) to the agy call. | A string enum (`read-only`, `workspace-write`, `danger-full-access`). An empty value or a boolean is normalized to `read-only` and passed as `-s <mode>`. | Antigravity: not attached unless given. Codex: `read-only`. |
| `--max-tokens N` | An integer. A soft constraint that appends an "(Answer within N tokens if possible)" hint after the prompt; not an agy flag itself. | Not declared. `buildArgs`'s signature has no `maxTokens` parameter, so a value is entirely discarded if given. | 4000(Antigravity only) |
| `--timeout-ms N` | An integer. Both foreground and background requests compute their timeout from this value (shared core logic between both CLIs). | Same. | 600000(allowed range 5000-3600000) |
| `--files <glob>` | A string. Checks for absolute-path traversal first, but even after passing that check, always rejects with `CCP-INVALID-001`("--files is not supported in the MVP"). | Not declared. | None |
| `--task` | A string. If given, used as the prompt value, taking priority over the positional argument. | Same. | None(if given, takes priority over the positional-argument prompt) |
| `--effort low\|medium\|high` | Declared as a bool flag, but always rejects with `CCP-INVALID-001`("`--effort` is not supported by Antigravity") regardless of the value. | A string enum. Converted to `-c model_reasoning_effort=<level>` and passed as a codex config override. | None |
| `--write` | Declared as a bool flag, but always rejects with `CCP-INVALID-001`("`--write` is not supported by Antigravity") regardless of the value. | Neither declared nor registered as rejected. The value is parsed into `flags.write`, but `buildArgs` never reads it, so it is silently ignored(no error envelope). | None |
| `--cwd DIR` | Not declared. `buildArgs`'s signature has no `cwd` parameter. | A string. Passed to codex exec as `-C <dir>`. | Codex is `process.cwd()`. |
| `--model NAME` | Not declared. There is no model-selection flag. | A string. Passed to codex exec as `-m <model>`; if omitted, uses the codex CLI's own default model. | None(uses the codex CLI's own default if omitted) |

Codex rescue calls use a separator like `-- "the actual task string"`. Every token after this separator is treated as a positional argument, i.e. the prompt, not an option.

See the "Configuration and security" section of the [Getting started](./getting-started.md) document for the tool-permission auto-approval flag automatically attached to Antigravity calls and how to configure it.

## How undeclared flags are handled

The Antigravity parser absorbs undefined option tokens as-is into the prompt, i.e. the positional-argument list. Give it an undefined option, and that string becomes part of the prompt whole.

The Codex parser is different. It uses a generic parser that reads an option and its next value as a pair into the `flags` object, regardless of whether it is declared. So giving it an undefined option does not mix it into the prompt; it gets parsed, then silently disappears because no handler reads it.

## status, result, setup

`/ccp:antigravity-status <job_id>` and `/ccp:codex-status <job_id>` check the current status of a job created with `--background`.

`/ccp:antigravity-result <job_id> [--summary-only]` and `/ccp:codex-result <job_id>` retrieve the summary and `result_path` of a completed job. `--summary-only` is declared only by Antigravity, and is a complete no-op: it is only parsed, and the result-handling handler never reads this value anywhere. It currently has no effect. Codex does not declare this flag.

`/ccp:antigravity-setup` and `/ccp:codex-setup` take no arguments and check each CLI's install and authentication status.

The `status` and `result` handlers can also take the value as `--job-id <uuid>` instead of the positional argument `<job_id>` (read as `parsed.flags.jobId || parsed.positional[0]`). The positional argument is recommended; `--job-id` is an alternative.

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

`cancel` is Codex-only and has no slash command. It cancels an in-progress job. Calling it on a job that cannot be canceled returns an error. See the "Error codes" section of the [Troubleshooting](./troubleshooting.md) document for the cause and remedy.

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
