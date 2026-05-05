# Architecture

CCP is built around seven principles and one common envelope schema. This page summarizes both. The schema SSOT is `plugins/ccp/schemas/envelope.schema.json`.

## The seven principles

### 1. Single error-code namespace

Every error returned by CCP follows `CCP-<CATEGORY>-<NNN>` (for example `CCP-OAUTH-001`). Categories: `OAUTH`, `SETUP`, `GEMINI`, `CODEX`, `CTX`, `ROUTER`, `JOB`, `INVALID`, `TIMEOUT`, `AUDIT`, `COMPACT`, `META`. Each code maps to a fixed `action` string and `recovery` enum.

Why: machine-parseable errors and predictable user remediation; no English-only free-text errors slipping through.

### 2. Required envelope fields

Every slash command and subagent emits exactly one JSON object on stdout, validated against a 6-key schema:

```json
{
  "summary": "...",            // string, <= 500 chars (RC-1)
  "result_path": "...",        // string|null
  "tokens": {                  // measurement-unit SSOT
    "input": 0,
    "output": 0,
    "cached": 0,
    "total": 0
  },
  "exit_code": 0,
  "details": { "mode": "gemini" }
}
```

Errors swap `summary`/`tokens`/`result_path` for an `error` object whose `code`/`message`/`action`/`recovery` fields are required. Both companions validate their own output before returning. Schema source: `plugins/ccp/schemas/envelope.schema.json`.

### 3. Single disk persistence root

All job state, raw output, and audit reports live under `_workspace/_jobs/` and `_workspace/_audits/`. Companions never write outside this root. The directory is gitignored in the public repository so user job content does not leak.

### 4. No automatic fallback (user-intent re-invocation)

When delegation fails (OAuth expired, CLI missing, network error, ...), CCP **does not** silently retry on Claude or another model. Instead, the envelope returns a `recovery` enum (`retry`, `fallback_claude`, `abort`, `user_action_required`) and an `action` string telling the user what to type. The user re-invokes deliberately.

Why: silent fallback inflates token bills and hides real failures. The router-suggest hook follows the same rule -- it suggests a slash command, never executes one.

### 5. Two-stage hook signals

Hooks reinforce, never replace, the slash commands.

- `UserPromptSubmit` -> `router-suggest.js` injects a `[CCP-ROUTER-001]` recommendation (and, if headless intent is detected, a `[CCP-META-WARN]` notice).
- `PreCompact` -> `suggest-compact.js` warns when the main context exceeds 75% / 90% of the budget.

Hooks use the Claude Code-supplied JSON stdin contract; no exec-based shell hooks.

### 6. Namespace split (`/gemini:*` vs `/ccp:*`)

Gemini commands sit under their own namespace because users have a long-standing mental model of Gemini as a heavy-summary tool. Codex and shared commands sit under `/ccp:*` because they are CCP-specific orchestration. This split is deliberate and not subject to ad-hoc renaming.

### 7. Subagent isolation is enforced

Subagents (`gemini-rescue`, `codex-rescue`) cannot write into the main Claude context except through the envelope. Even verbose CLI output is redirected to the result file; only the bounded summary travels back. Audit categories `double_billing` and `secret_leak` are dedicated to detecting leaks of this isolation.

## Token-saving patterns

CCP's token saving works strongest in **canonical** triggers:

```text
✅  /gemini:rescue summarize this directory
✅  /ccp:codex-rescue review this PR diff
```

In this pattern the envelope cap (<= 500 chars) plus `result_path` persistence prevents Claude's main context from accumulating Gemini's full output. Field measurement (T5 fixture, N=2): main 846K + offload 179K = 1,025K total.

In **headless** triggers (`claude -p ...`, scripted automation), models tend to probe delegation entry points -- calling `rescue --help`, traversing Skill -> Agent -> companion, retrying with prompt variations -- and tokens can grow 2.1x instead of shrinking. For headless use, pre-script the slash command:

```bash
# Recommended: pre-scripted slash
claude -p "/gemini:rescue summarize this directory"
claude -p "/ccp:codex-rescue review the PR diff"

# Forbidden: rescue --help loops, Skill -> Agent traversal, repeated prompt variations
```

The router-suggest hook auto-injects a `[CCP-META-WARN]` advisory when it detects headless intent.

## Borrowed code

CCP borrows code from upstream projects under their original licenses. Full license texts are preserved in the `LICENSES/` directory. The harness audit's `borrowed_code_documented` category enforces, at every PR, that each upstream license text is present in `LICENSES/`.

- **everything-claude-code (ecc)** -- MIT -- `hooks/suggest-compact.js`, `skills/context-budget/SKILL.md`, `scripts/harness-audit.js`
- **codex-plugin-cc** -- Apache-2.0 -- `scripts/lib/codex-{state,tracked-jobs,process,args,job-control}.mjs`
- **oh-my-claudecode (omc)** -- MIT -- `scripts/lib/magic-keywords.mjs`

License texts: `LICENSES/`.

## Related reading

- [Router behavior](./router.md) for the four-axis decision
- [Slash command reference](./slash-commands.md) for all commands and flags
- [Troubleshooting](./troubleshooting.md) for the error-code catalog
