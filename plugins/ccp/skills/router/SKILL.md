---
name: router
description: "CCP model router — 3-way delegation decision logic for Claude (main) vs Antigravity vs Codex. 4-axis priority: user-explicit > input-size > keyword > fallback. Use when deciding `/ccp:antigravity-rescue` / `/ccp:codex-rescue` invocation, evaluating routing, or guarding against router misclassification cost. **hooks/router-suggest.js injects recommendations on UserPromptSubmit. Headless auto-delegation is NOT performed (no automatic fallback for delegated calls).**"
---

# CCP Router — 3-way Routing Skill (Claude / Antigravity / Codex)

Decides whether to delegate work from the main Claude context. Acceptance criterion: zero misclassifications on the regression dataset (`tests/router/router-eval.mjs`).

**v0.3 scope:**
- The 4-axis algorithm in this SKILL.md is mirrored in code by `plugins/ccp/scripts/lib/router.mjs`. Both the recommendation hook and the regression suite import that single module (single SSOT).
- **Recommendation hook active**: `hooks/router-suggest.js` injects the decision as a system reminder on UserPromptSubmit (`[CCP-ROUTER-001]`). When the decision is `claude`, it is a no-op.
- **Canonical auto-routing (opt-in)**: in canonical interactive sessions, set `plugin.json#config.auto_routing: true` to let the router agent dispatch automatically (see docs/en/router.md in the CCP repository). Default is `false`.
- **No headless auto-delegation**: in headless mode the recommendation is shown only — the user must invoke the slash command directly (`/ccp:antigravity-rescue` / `/ccp:codex-rescue`).
- Regression dataset: `tests/router/router-eval.mjs` (codex / antigravity / claude classes + boundary false-positive guards). CI requires zero misclassifications.

## Trigger conditions

Apply this skill when any of the following holds:

- The user invokes `/ccp:antigravity-rescue` or `/ccp:antigravity-*` slash commands directly.
- Main context utilisation exceeds 75% and a new large task is incoming.
- The input contains delegation keywords such as "summarize", "review codebase", "this directory", or "large log".
- Attached files or text exceed 30,000 tokens.

If none of the above holds, do not apply the router — the main Claude handles the request directly.

## 4-axis decision algorithm

The router applies four axes in priority order. The first matching axis wins.

### A. User explicit (highest priority)

| Signal | Decision | reason |
|--------|----------|--------|
| `/ccp:antigravity-rescue` slash invocation (without `--fallback-claude`) | `antigravity` | `user_explicit_antigravity` |
| `/ccp:codex-rescue` slash invocation (without `--fallback-claude`) | `codex` | `user_explicit_codex` |
| `--fallback-claude` flag | `claude` | `user_explicit_claude` |
| `--force-claude` flag | `claude` | `user_explicit_claude` |
| `--effort` (codex-specific) | `codex` | `user_explicit_codex_option` |
| `--sandbox workspace-write` | `codex` | `user_explicit_codex_option` |
| Magic keyword `@antigravity` / `@ag` / `@안티` | `antigravity` | `user_explicit_antigravity_magic` |
| Legacy magic keyword `@gemini` / `@젬` / `@제미니` | `antigravity` | `user_explicit_antigravity_magic` |
| Magic keyword `@codex` / `@코덱` / `@코덱스` | `codex` | `user_explicit_codex_magic` |
| Magic keyword `@claude` / `@클` / `@클로드` | `claude` | `user_explicit_claude_magic` |
| Magic keyword `@auto` / `@자동` | (marker — fall through to B/C/D) | — |

Rows are checked top to bottom. A slash invocation that also carries `--fallback-claude` skips the slash rows and resolves to `claude` through the `--fallback-claude` row. User-explicit signals invalidate every other axis. Magic keywords are matched after `removeCodeBlocks` so keywords inside code fences do not trigger.

The `@gemini` / `@젬` / `@제미니` aliases are retained for backward compatibility after the upstream Gemini CLI EOL (2026-06-18) — they all route to the Antigravity backend now.

### B. Input size

| Estimated input tokens | review/diff keyword | Decision | reason |
|------------------------|---------------------|----------|--------|
| < 5,000 | — | `claude` | `too_small` (delegation cost > savings) |
| 5,000 – 30,000 | review / PR / diff / bug-investigation match | `codex` | `mid_review_codex` |
| 5,000 – 30,000 | otherwise | (proceed to axis C) | — |
| > 30,000 | — | `antigravity` | `too_large` (long-context backend) |

Token estimation: `words × 1.3` — a deliberately conservative heuristic that needs no tokenizer and therefore works in every environment.

### C. Keyword matching

Keyword matching uses two helper primitives:

1. **`removeCodeBlocks`** strips ` ``` ... ``` ` and `` ` ... ` `` regions before matching, so a keyword inside example code does not trigger a false delegation.
2. **`hasActionableTrigger`** uses `\b ... \b` word-boundary matching for ASCII triggers and skips informational contexts (e.g. "what is review") via the `INFORMATIONAL_INTENT_PATTERNS` window.

Non-ASCII triggers fall back to substring matching but apply the same informational-intent guard. The full keyword dictionaries (including localised terms used by the primary user persona) live in `plugins/ccp/scripts/lib/router.mjs`.

#### Antigravity-favoured keywords (large-context summary / analysis)
- `summarize`, `summary`, `review codebase`, `review the entire`, `whole directory`, `whole codebase`, `whole repo`, `whole project`, `entire codebase`, `monorepo`, `parse large log`, `log analysis`, `all markdown`, `all APIs`
- Attached files matching `*.log`, `*.csv`, `*.ndjson`, etc.

#### Codex-favoured keywords (code review / bugs / diff)
- `review code`, `code review`, `review this PR`, `audit diff`, `audit this diff`, `review the diff`, `find the bug`, `investigate the bug`, `refactoring proposal`, `code quality`
- `git diff` output or `*.patch` attachments

#### Claude-favoured keywords
- `edit`, `fix this line`, `rename this variable`, `add a comment`, `add a test`, `add type`, `autofix`, `TODO comment`, `error message`

#### Main-context-bind keywords (override)
The following keywords override every codex / antigravity match because they signal that the input depends on the main Claude turn — delegation would break continuity:

- `just now`, `just edited`, `just wrote`, `just ran`, `above`, `previous response`, `previous output`, `last command`

#### Match resolution
| Match | Decision | reason |
|-------|----------|--------|
| Main-context-bind keyword present | `claude` | `main_context_bind` |
| Antigravity keywords only | `antigravity` | `keyword_antigravity` |
| Codex keywords only | `codex` | `keyword_codex` |
| Claude keywords only | `claude` | `keyword_claude` |
| Multiple matches (excluding bind) | priority codex > antigravity > claude | `keyword_<chosen>_priority` |
| No match | (proceed to axis D) | — |

### D. Conservative default

| Situation | Decision | reason |
|-----------|----------|--------|
| All previous axes undecided | `claude` | `default_conservative` |

The router does not check CLI availability or authentication state at decision time; that is a separate, post-decision concern. If the chosen backend later fails to authenticate or run, the adapter surfaces its own error code (`CCP-OAUTH-001`, `CCP-OAUTH-101`, etc., see docs/en/troubleshooting.md in the CCP repository) with a `recovery` hint, and the router's `classify()` result is not revisited.

**Conservative default**: when in doubt, route to the main Claude. A wrong delegation triggers the router-misclassification cost.

## Decision object format

```json
{
  "target": "claude" | "antigravity" | "codex",
  "reason": "user_explicit_antigravity | user_explicit_codex | user_explicit_codex_option | user_explicit_claude | user_explicit_antigravity_magic | user_explicit_codex_magic | user_explicit_claude_magic | too_small | mid_review_codex | mid_review_codex_oversized | too_large | main_context_bind | keyword_antigravity | keyword_codex | keyword_claude | keyword_antigravity_priority | keyword_codex_priority | keyword_claude_priority | default_conservative",
  "axis": "A" | "B" | "C" | "D",
  "tokens": 12345,
  "matched": ["review this PR"]
}
```

`tokens` is present on input-size and fallback decisions, and `matched` on keyword and magic-keyword decisions; keyword decisions that resolve by priority carry per-class `hits` counts instead. `router-decide.mjs` wraps this object in a JSON envelope (see docs/en/router.md in the CCP repository).

## No-auto-fallback rule

After the router decides `antigravity` or `codex`, a failed delegation must NOT be retried automatically against the main Claude. Instead, the envelope presents the user with one of the following choices.

| Model | Failure cause | User choices |
|-------|---------------|--------------|
| antigravity | auth invalid / quota | `/ccp:antigravity-setup` or `/ccp:antigravity-rescue --fallback-claude "<task>"` |
| codex | not authenticated | `codex login` then retry, or `/ccp:codex-rescue --fallback-claude "<task>"` |

Reasons for forbidding auto-fallback:
1. **Prevent double billing** — calling both the delegated CLI and the main Claude duplicates the prompt cost.
2. **Respect user intent** — explicit re-invocation guarantees the action is intentional.
3. **Debuggability** — the user knows why the main Claude was invoked.

## Anti-pattern in headless automation

In `claude -p` headless invocations, when the router recommends antigravity/codex the model may accumulate meta-bypass attempts. An external 4-environment benchmark observed up to 12 such attempts in a single run — the direct cause of a net-negative token regression.

### Do not (avoid meta-bypass accumulation)

- ❌ probing `antigravity-companion.mjs --help` / `rescue --help`
- ❌ triple entry-point search (`Skill ccp:antigravity-rescue` → `Agent ccp:antigravity-rescue` → companion direct call)
- ❌ retrying the same task with different variants (Korean → English → minimal case)
- ❌ source spelunking with `grep "rescue|--task"`

### Do (pre-script the slash)

- ✅ Pre-script the slash command: `claude -p "/ccp:antigravity-rescue <task>" -- ...`
- ✅ On failure, retry once and surface the result to the user (`--fallback-claude` only when explicitly requested — no auto-fallback).

### Guard

- `hooks/router-suggest.js` detects keywords such as `headless`, `claude -p`, `automation`, `cron`, the Korean words for "script" and "automation", and a standalone uppercase `CI` on UserPromptSubmit and adds a `[CCP-META-WARN]` notice.
- When the user/script invokes a slash command (`/ccp:antigravity-rescue` etc.), the headless suspicion is cleared and only the standard `[CCP-ROUTER-001]` recommendation is emitted.

## Accuracy measurement procedure

Use the regression dataset that ships with this repo, `tests/router/router-eval.mjs` (codex / antigravity / claude classes + boundary false-positive guards).

```
accuracy = (prediction == ground-truth label) / total
```

Acceptance criteria:

The pass/fail gate is **zero misclassifications** (a boundary case counts as correct when it matches its alternate label). The script also prints a diagnostic table that is not part of the gate:

| Diagnostic metric | Printed threshold |
|-------------------|-------------------|
| Overall accuracy | ≥ 80% |
| Clear-case accuracy (exact) | ≥ 90% |
| Boundary-case accuracy (alt label allowed) | ≥ 60% |
| False-positive guard accuracy (exact) | 100% |
| Claude / Antigravity / Codex precision and recall | ≥ 0.75 each |
| Confusion matrix | 3×3 (claude / antigravity / codex) |

If any case is misclassified, follow this remediation order:
1. Augment the keyword dictionary with the misclassified core terms.
2. Adjust thresholds (5K → 8K, or 30K → 25K).
3. Re-label the boundary cases.
4. If still below threshold, consider removing auto routing entirely (manual slash only).

## Why

The router is the core logic that determines CCP's token-saving effect. The 4-axis priority structure is designed to:

1. **Always respect user intent** — eliminate surprises.
2. **Resolve obvious cases quickly** — input-size thresholds collapse boundary ambiguity.
3. **Use keywords only at the margin** — prevent over-fitting.
4. **Conservative default** — when in doubt, Claude (a wrong delegation manifests as router-misclassification cost).

## Artefact locations

- This skill: `plugins/ccp/skills/router/SKILL.md`
- Router code (single SSOT): `plugins/ccp/scripts/lib/router.mjs`
- Router agent (forwarding wrapper): `plugins/ccp/agents/router.md`
- Router CLI entry (for hook + regression): `plugins/ccp/scripts/lib/router-decide.mjs`
- Keyword primitives: `plugins/ccp/scripts/lib/magic-keywords.mjs`

## References

- docs/en/router.md in the CCP repository (router behavior, canonical auto-routing opt-in)
