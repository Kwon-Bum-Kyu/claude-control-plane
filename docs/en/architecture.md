# Architecture

CCP is built from five principles and one envelope schema. This document covers the principles, the path delegation actually goes through, the boundary between the companion core and adapters, the error-code and envelope-validation scheme, job path resolution, hooks and subagents, and the origin of borrowed code. For the exact envelope key list and the full error-code table, see the [Slash commands](./slash-commands.md) and [Troubleshooting](./troubleshooting.md) documents, respectively.

## Principles

### Summary and path only

CCP returns only a short summary and a result-file path to the main session for a delegation result. When the summary exceeds a certain length, it is automatically truncated, preferring a sentence boundary, and the fact that it was truncated is marked in the envelope. The raw response from the CLI used for delegation is never included in the summary. When a result file is kept on disk, its path is returned along with the summary as `result_path`. A Codex foreground run keeps no result file unless the summary was truncated, and in that case `result_path` is `null`. The exact character-count cap and truncation rule are in the response-envelope section of the [Slash commands](./slash-commands.md) document.

### Subagent isolation

All three subagents (`antigravity-rescue`, `codex-rescue`, `router`) follow the same four rules: they do not read files directly, they return the envelope left on stdout by a fixed command to the caller verbatim, they do not judge its contents on their own, and they do not retry or substitute another means on failure. The code and prompts call this discipline the subagent isolation principle. The concrete tool permissions and the commands they run are in the 'Delegation path' and 'Subagents' sections below.

### No automatic fallback

Even when delegation fails, CCP does not silently retry with Claude or another CLI. Instead, the `recovery` value and `action` text in the error envelope tell the user what to do next, and the user must explicitly call it again. Hooks follow the same discipline: they only suggest a slash command and do not run it instead. The code and prompts call this discipline the no-automatic-fallback principle. The concrete meaning of each `recovery` value is in the 'Envelope and error-code scheme' section below.

### Hooks recommend only

None of the four hooks run the user's input flow on the user's behalf. They only attach a notice or marker at session start, prompt submission, right before context compaction, and subagent termination; they do not run `/compact` or a slash delegation in the user's place. The detailed list is in the 'Hooks' section below.

### One adapter per CLI

Antigravity and Codex are each declared by a single adapter file (`adapters/antigravity.mjs`, `adapters/codex.mjs`). A change that adds a new CLI must end with writing a new adapter file, leaving the shared core files unchanged. The exact boundary between the adapters and the core is in the 'Companion core and adapters' section below.

## Delegation path

`/ccp:antigravity-rescue` and `/ccp:codex-rescue` each run through the like-named subagent (`antigravity-rescue`, `codex-rescue`). Both subagents are declared with `tools:["Bash"]`, `disallowedTools:["mcp__*"]`, `model:haiku`, `background:false`. Each of them runs exactly one fixed command.

- `antigravity-rescue`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" rescue --task "<task>" [--background] [--max-tokens N] [--files <glob>] [--fallback-claude] [--mcp NAME[,NAME...]]`
- `codex-rescue`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" rescue [--background] [--model NAME] [--effort low|medium|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude] [--mcp NAME[,NAME...]] -- "<task>"`

The subagent only returns the envelope this command leaves on stdout to the caller as-is; it does not interpret the content or retry.

CCP has only three subagents in total: these two plus `router`. `/ccp:antigravity-status`, `/ccp:antigravity-result`, `/ccp:antigravity-setup`, `/ccp:codex-status`, `/ccp:codex-result`, `/ccp:codex-setup`, and `/ccp:audit` are not on this list, so their slash commands run the companion script or the audit script directly, without going through a subagent.

The `router` subagent has the same `tools`/`disallowedTools` configuration as the other two subagents, but it also explicitly blocks the `Task` tool. The conditions under which the `router-suggest.js` hook hands the decision to this subagent when a user submits a prompt are in the 'Hooks' section below. When delegation is handed to this subagent, it runs only `node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/router-decide.mjs" --prompt "<user prompt verbatim>" [--auto-routing on|off] [--no-auto-route]` and returns the resulting envelope as-is. The decision axes and reasoning are covered by the [Router](./router.md) document.

A companion can also be run directly, without going through a slash command or a subagent. You either give the CLI name as the first argument in the form `node plugins/ccp/scripts/companion.mjs <antigravity|codex> <subcommand> [...args]`, or run a CLI-fixed alias script (`antigravity-companion.mjs`, `codex-companion.mjs`) directly. `companion.mjs` only plays the role of selecting the adapter file (`adapters/antigravity.mjs` or `adapters/codex.mjs`) matching the CLI name it received as its first argument.

## Companion core and adapters

The companion is split into a shared core and a per-CLI adapter. The core is made up of several files.

- `core/paths.mjs`: resolves job paths.
- `core/envelope.mjs`: builds the envelope, self-validates it, and decides the exit code.
- `core/errors.mjs`: merges the shared error catalog with the adapter catalog.
- `core/jobs.mjs`: reads and writes job metadata, and filters it by session scope.
- `core/args.mjs`: parses flags.
- `core/mcp.mjs`: checks the rescue `--mcp` value, compares it with the MCP server list the adapter read, and builds the guidance text.
- `core/runtime.mjs`: handles per-subcommand processing, failure classification, and running background jobs.

The two adapters (`adapters/antigravity.mjs`, `adapters/codex.mjs`) declare values specific to each CLI: supported flags and rejected flags, the function that builds the command line (`buildArgs`), the function that reads CLI output (`parseResult`), the MCP server-list arguments and the functions that read that list and build the fix-up commands (`mcp`), timeouts, the error catalog, the binary-path environment variable, and so on. The core only reads these declared values to coordinate execution, and substitutes a safe default set by the core itself for any value an adapter does not declare.

There are two cases where this substitution actually takes effect.

First, the codex adapter declares 240000ms as `timeouts.background`, but the core's `handleRescue` always computes `timeouts.foreground` as the default timeout and stores it in the job metadata, regardless of foreground or background. Because this value is always already filled in, the `timeouts.background` fallback in `handleTaskWorker`, which actually runs the background worker, is never reached in the code path. So the effective timeout for a codex background job is not 240000ms, but 600000ms, the same as antigravity.

Second, whether job_id format validation happens depends on whether the adapter declares `validateJobId`. antigravity actually checks the format with a UUID v4 regular expression, but codex does not declare this function, so the core substitutes a pass whenever a value is present. This means codex's job_id has no format validation.

`tests/companion/contract-test.mjs` checks the field composition both adapters must declare on every run. This test fails if the core requires a field an adapter did not declare, or if an adapter adds a field the core does not know about.

When a rescue call is given `--mcp`, the core runs the MCP pre-check once, right after handling `--fallback-claude` and before the authentication check and the foreground/background split. It lists the target CLI's registered servers with the adapter's `mcp.listArgs`, and compares the declared names using only the server names and enabled states that `mcp.parseList` returns. Not registered, disabled, and an unreadable list all stop with the single code `CCP-MCP-001`, and `details.mcp` tells them apart. The commands the user should run are placeholder commands built by the adapter's `mcp.installCommand`, and the core never runs them. Because the raw list output can contain secrets such as authentication headers, it is passed only to `mcp.parseList` and is never left in logs, job directories, or the envelope. The check finishes before any job directory is created, so a call that fails it leaves nothing on disk.

## Envelope and error-code scheme

The envelope schema follows JSON Schema draft-2020-12 (https://json-schema.org/draft/2020-12/schema). The schema file is `plugins/ccp/schemas/envelope.schema.json`, and its `$id` value is `https://raw.githubusercontent.com/Kwon-Bum-Kyu/claude-control-plane/main/plugins/ccp/schemas/envelope.schema.json` itself. For which keys the envelope has and which values `details.mode` can take, see the response-envelope section of the [Slash commands](./slash-commands.md) document.

The error-code format is `CCP-<CATEGORY>-<NNN>`. Scanning all the codes, the categories `INVALID`, `JOB`, `TIMEOUT`, `SETUP`, `OAUTH`, `AG`, `CODEX`, `ROUTER`, `COMPACT`, `API`, `AUDIT`, `UNSUPPORTED`, and `MCP` are observed.

Both adapters inherit the shared error catalog and then merge it with their own catalog. The merge rule is `{ ...the shared catalog, ...the adapter catalog }`, and when a key overlaps, the adapter's wording always wins. Of the shared catalog, `CCP-MCP-001` (MCP pre-check) is not overridden by either adapter; its `message` and `action` are filled in with state-specific wording at the call site.

The `recovery` values mean the following. `retry` means retrying the same request as-is may resolve it. `abort` means retrying will not resolve it, so the user must take a different action. `fallback_claude` means giving up on delegating to that CLI and handing it to the main Claude with `--fallback-claude`. `user_action_required` means the user must fix the input or configuration and run it again; currently `router-decide.mjs` uses this value when there is no input. These four values are the valid `recovery` enum the schema defines.

There are a few known deviations. antigravity's `CCP-OAUTH-001` and `CCP-AG-002` use `fallback`, which is outside the schema enum, as the `recovery` value (the valid value is `fallback_claude`). antigravity's `details.mode` also has values outside the schema enum in some execution forms. A background-acceptance response uses `background`, which points to the execution form rather than the CLI name, and a `--fallback-claude` call's response uses `fallback_claude`. `setup`, `preflight`, and `status` responses do not have a `mode` key inside `details` at all. The envelope self-validator has explicitly listed all these deviations as allowed, so it does not treat them as failures. As another deviation, where the two adapters place the error `details` also differs: antigravity nests `details` inside the `error` object, while codex puts `details` at the top level of the envelope. Because the schema has no `additionalProperties` constraint, the validator cannot catch this difference.

Both companions validate the envelope themselves right before writing it to stdout. Setting the environment variable `CCP_ENVELOPE_STRICT` to `1` throws an exception on validation failure; if it is not set (the default), only a warning is left on stderr and execution proceeds as-is.

## Job path resolution

The directory where jobs are stored (`JOBS_DIR`) follows a five-step priority order. If the absolute-path environment variable `CCP_JOBS_DIR` is present, everything else is ignored and this value is used. If not, it looks at `CLAUDE_PROJECT_DIR`, and if that is also absent, at `CLAUDE_PROJECT_ROOT`. If neither is present, it uses a hint passed by the caller (for example, the `cwd` the `SubagentStop` hook received over stdin), and if that is also absent, it falls back last to `process.cwd()`. This last value always exists.

`PLUGIN_ROOT` (the physical path where the plugin itself is installed) is independent of this priority order. If the `CLAUDE_PLUGIN_ROOT` environment variable is present, that value is used; otherwise, the directory two levels above the code file is used. Because this directory can disappear when a marketplace-installed plugin is updated, it is not used to compute job paths.

`/ccp:audit` now also uses the same path-resolution order as the companion. Audit reports are stored under `_workspace/_audits/`, a sibling directory of `JOBS_DIR`.

The composition of the artifacts left behind also differs by CLI. antigravity always leaves a job record even when run in the foreground: `meta.json`, `agy.log`, and `result.md` are created under `_workspace/_jobs/<uuid>/`. codex leaves `meta.json` and `result.txt` under `_workspace/_jobs/<uuid>/` only when run in the background. When run in the background, both CLIs additionally create `stdout.log` and `stderr.log` in the same directory. codex's foreground run leaves no record in principle, but as an exception, when the summary is truncated, a temporary directory is created with only `result.txt` and no `meta.json`. This directory has no owner managing its lifetime, so it is a known limitation that it keeps accumulating.

Job artifact paths are exposed by both adapters as absolute paths relative to `JOBS_DIR` (`pathStyle:'absolute'`). A branch that exposes them as repository-relative paths (`'repo-relative'`) also remains in the code, but it is an unused path, since no adapter currently declares it.

## Hooks

CCP registers four hooks. For `UserPromptSubmit`, `suggest-compact.js` runs first, then `router-suggest.js` runs next, in that order; `rescue-finalize.js` is registered for `SubagentStop`, `boot-check.js` for `SessionStart`, and `suggest-compact.js` for `PreCompact`.

- `boot-check.js` (`SessionStart`): pre-checks the Node.js version, whether agy is installed and its version, and the authentication state. If it finds a problem, it only shows a notice; if there is no problem, it does nothing. This check does not block session start.
- `router-suggest.js` (`UserPromptSubmit`): injects the routing decision as a `[CCP-ROUTER-001]` suggestion. If `auto_routing` is on and the session is judged canonical, or if the decision is `claude` in the first place, it injects nothing. In the former case, it hands that decision to the `router` subagent. It appends a `[CCP-META-WARN]` notice to a prompt suspected of headless automation.
- `suggest-compact.js` (`UserPromptSubmit`, `PreCompact`): when context usage exceeds the threshold, it recommends a manual `/compact` or delegation with a `[CCP-COMPACT-001]` notice. At the `PreCompact` point, it always shows the notice regardless of the threshold.
- `rescue-finalize.js` (`SubagentStop`): finds antigravity jobs that have stayed `running` for 5 minutes (300000ms) since they started, forcibly marks them `failed`, and records `CCP-TIMEOUT-001`. codex does not use this status key, so it is not a target of this cleanup.

All four hooks fail quietly. If stdin is not JSON or an exception occurs during processing, they write an empty object to stdout and exit as-is, so the user's input flow is not blocked.

## Subagents

CCP has only three subagents: `antigravity-rescue`, `codex-rescue`, `router`. All three are `tools:["Bash"]`, `model:haiku`, `background:false`, and include `mcp__*` in `disallowedTools`. `router` additionally, explicitly blocks the `Task` tool as well.

The three subagents each run only the single command written in the Delegation path section, and follow the four rules described in 'Subagent isolation' in the Principles section.

## Borrowed code

CCP borrows code from two open-source projects.

All 5 files borrowed under Apache-2.0 come from openai/codex-plugin-cc (upstream commit `8e873d6f40511aa7d8081623d0b66804b7301de6`, release/v1.0.4), and each file has a comment at the top declaring its origin.

| File | Upstream | License |
|------|------|---------|
| `plugins/ccp/scripts/core/args.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/args.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/core/jobs.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/state.mjs`, `tracked-jobs.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/core/process.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/process.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/core/runtime.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/job-control.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/adapters/codex.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/args.mjs` (only the `buildArgs` function) | Apache-2.0 |
| `plugins/ccp/scripts/adapters/antigravity.mjs` | None (CCP's own code) | Not applicable |
| `plugins/ccp/scripts/harness-audit.js` | Port of everything-claude-code's `harness-audit.js` | MIT |
| `plugins/ccp/hooks/suggest-compact.js` | everything-claude-code | MIT |
| `plugins/ccp/skills/context-budget/SKILL.md` | everything-claude-code | MIT |
| `plugins/ccp/scripts/lib/magic-keywords.mjs` | oh-my-claudecode | MIT |

The `LICENSES/` directory contains the 4 upstream license originals (`codex-plugin-cc-Apache-2.0.txt`, `codex-plugin-cc-NOTICE.txt`, `everything-claude-code-MIT.txt`, `oh-my-claudecode-MIT.txt`). For the license terms and the original attribution paragraph text, see the repository's `LICENSE` file and the [CONTRIBUTING](../../CONTRIBUTING.md) document.

## Next

- [README](../../README.en.md)
- [Getting started](./getting-started.md)
- [Slash commands](./slash-commands.md)
- [Router](./router.md)
- [Troubleshooting](./troubleshooting.md)
