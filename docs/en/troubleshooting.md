# Troubleshooting

This document summarizes the error codes and hook notices you encounter while using CCP, and what the setup command checks.

## Error codes

Every error is shown as the `error.code` value in the JSON envelope. A failed call does not return `result_path`. Check `stderr_head` or `stdout_head` inside `details` (present depending on the code), or the log files in the job directory (`_workspace/_jobs/<job_id>/`). Which field and log to check differs by code, and is written in the "Next action" column of the table below. For the error-code format, the catalog-merge rule, and details of the envelope structure, see [Architecture](./architecture.md).

| Code | CLI | Cause | Next action | recovery |
|------|----------|------|-----------|----------|
| CCP-INVALID-001 | Shared | Argument parsing failed. Passing an unsupported flag is also rejected with this code. See [Slash commands](./slash-commands.md) for which flag is rejected on which CLI | Check the usage and retry | abort |
| CCP-JOB-001 | Shared | The specified job_id could not be found. codex also handles corrupted job metadata with this code (it does not use CCP-JOB-003) | Double-check the job_id | abort |
| CCP-JOB-002 | Shared | The job has not finished yet. codex represents both queued and running states with this single code | Check the status with the status command, then retry | retry |
| CCP-JOB-003 | antigravity | The job metadata is corrupted (codex handles the same situation with CCP-JOB-001) | Delete the job directory and create a new job | abort |
| CCP-JOB-004 | Shared | The result file is missing. codex represents every not-completed state (failure, cancellation, and so on) with this code | Call rescue again | abort |
| CCP-JOB-409 | codex | Cannot cancel in the current state (antigravity has no cancel subcommand, so it never reaches this code) | Check the job status and retry | abort |
| CCP-TIMEOUT-001 | Shared | The CLI response did not finish in time. If a background job goes unresponsive for over 5 minutes, the hook that detects subagent termination may also forcibly terminate it with this code | Retry, or run asynchronously with `--background` | retry |
| CCP-SETUP-002 | Shared | The Node.js major version is below the requirement | Install or upgrade Node.js and run again. See [Getting started](./getting-started.md) for the exact minimum version | abort |
| CCP-SETUP-001 | antigravity | agy is not installed, or its version is below the minimum requirement | Install with `curl -fsSL https://antigravity.google/cli/install.sh \| bash` or upgrade with `agy update`, confirm `~/.local/bin` is in PATH, then run `/ccp:antigravity-setup` again | abort |
| CCP-OAUTH-001 | antigravity | antigravity authentication is missing or invalid | Authenticate by running `agy` interactively once, or switch to `/ccp:antigravity-rescue --fallback-claude "<original task>"`. See [Getting started](./getting-started.md) for the authentication-related environment variables | fallback |
| CCP-AG-001 | antigravity | The antigravity CLI run failed (the default classification for other failures) | Check `agy.log` in the job directory (the job_id is in the error details), or retry with the main Claude agent | retry |
| CCP-AG-002 | antigravity | The antigravity free-tier quota was exceeded | Retry later, or use `--fallback-claude` | fallback |
| CCP-API-001 | Currently does not occur | Declared in the catalog to mean the Claude Code version is below CCP's requirement, but no code actually checks this condition | Not applicable | abort |
| CCP-SETUP-101 | codex | The Codex CLI is not installed | Install with `brew install codex` or `npm install -g @openai/codex` and run again | abort |
| CCP-SETUP-102 | codex | The Codex CLI version is below the minimum requirement | Upgrade the Codex CLI and run again. See [Getting started](./getting-started.md) for the exact minimum version | abort |
| CCP-OAUTH-101 | codex | Codex authentication is required. codex actually checks the authentication state on every rescue call | Run `codex login`, or use `--fallback-claude` | fallback_claude |
| CCP-CODEX-001 | codex | The Codex CLI run failed. Every non-timeout failure is classified under this single code | For a background job, check `stderr.log` in the job directory; otherwise, retry from Claude | retry |
| CCP-CODEX-002 | codex | No valid JSONL event was found in the Codex response | Check `details.stdout_head` (the first 200 characters), then retry or handle it in Claude | retry |
| CCP-UNSUPPORTED-101 | Currently does not occur (codex) | Declared in the catalog to mean an option codex does not support, but codex's reject list is empty, so no call site actually emits this code | Not applicable | abort |
| CCP-AUDIT-001 | Audit (`/ccp:audit`) | There is no job data to audit | Adjust the `--since` range and retry | abort |
| CCP-AUDIT-002 | Audit (`/ccp:audit`) | Running the audit script failed (including a failure to write the report) | Retry later, or check the log | retry |
| CCP-INVALID-001 | Router (`router-decide.mjs`) | Ran without `--prompt` and without `prompt` on standard input (exit code 2) | Give `--prompt "<text>"`, or pass `{"prompt":"..."}` over standard input | user_action_required |
| CCP-ROUTER-001 | Router (`router-decide.mjs`) | An exception occurred during routing classification (exit code 3) | Do not rely on auto-routing; delegate directly with the slash command | abort |

## Hook notices

The following markers are notices that hooks and the router attach directly to text. Among these, CCP-ROUTER-001 is also used by `router-decide.mjs` as a JSON error code; for that case, see the error-code table above. For the details of the decision logic and conditions, see [Router](./router.md).

- CCP-ROUTER-001: a marker that only suggests the routing decision may be inefficient.
- CCP-ROUTER-002: a marker prepended to the summary of a result the router auto-delegated.
- CCP-META-WARN: a warning marker appended to a prompt suspected of headless automation.
- CCP-COMPACT-001: a notice marker attached when context usage exceeds the threshold.

## What setup checks

`/ccp:antigravity-setup` and `/ccp:codex-setup` check in the following order.

1. Checks the Node.js major version. If it is under 20, it stops with CCP-SETUP-002; it only looks at the major version, not the patch version (20.19, 22.7, and so on).
2. Checks the CLI's installation and version. If it falls short, antigravity stops with CCP-SETUP-001; codex stops with CCP-SETUP-101 if not installed, or CCP-SETUP-102 if the version falls short.
3. Checks authentication with an actual call. If there is no response within 60000ms for antigravity or 30000ms for codex, it is treated as a timeout.

The authentication setup checks and the authentication right before a rescue call are checked differently. antigravity only cheaply checks, on every rescue call, whether credentials exist; only setup verifies authentication with an actual CLI call. codex performs a call that actually checks the authentication state on every rescue call.

For the CLI installation and authentication commands themselves, see [Getting started](./getting-started.md).

## FAQ

- **What happens if I give `--write` to antigravity?** antigravity has declared `--write` as an unsupported flag, so it is always rejected with CCP-INVALID-001 regardless of the value. codex does not declare `--write`, so giving a value is silently ignored and produces no error.
- **Why is `--effort` rejected when given to antigravity?** antigravity has registered `--effort` as an unsupported flag, so it is always rejected with CCP-INVALID-001 regardless of the value. codex actually reflects this value in its CLI call.
- **I gave `--summary-only`, but the summary length stayed the same.** It is currently a no-op. Only antigravity declares this flag, and no handler reads this value.
- **`result_path` came back as null.** During a codex foreground rescue, when the summary is not truncated, no job record is left, so `result_path` is null. antigravity always leaves a job record even in the foreground, so the value is filled in.
- **The timeout for a codex background job differs from what I expected.** If `--timeout-ms` is not given separately, codex uses the same default for both foreground and background. A background-only default is declared, but it is not used in the execution path. See [Slash commands](./slash-commands.md) for the exact default.
- **The audit (`/ccp:audit`) score is lower than expected.** An environment installed from the marketplace may not have a `LICENSES/` directory, which can lower the borrowed-code documentation score. This is a difference due to the installation method, not a code defect.

## Reporting a bug

If this document does not resolve it, file an issue in the repository's issue tracker. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for how to write an issue and the list of labels that actually exist. When filing, including the command you ran, the error code you received, and the job_id (if any) helps narrow down the cause faster.

## Next

- [Getting started](./getting-started.md)
- [Slash commands](./slash-commands.md)
- [Router](./router.md)
- [Architecture](./architecture.md)
- [README](../../README.en.md)

