---
name: router
description: "CCP model router — 3-way delegation decision logic for Claude (main) vs Gemini vs Codex. 4-axis priority: user-explicit > input-size > keyword > fallback. Use when deciding `/gemini:rescue` / `/ccp:codex-rescue` invocation, evaluating routing, or guarding against router misclassification cost. **hooks/router-suggest.js injects recommendations on UserPromptSubmit. Headless auto-delegation is NOT performed (no automatic fallback for delegated calls).**"
---

# CCP Router — 3-way Routing Skill (Claude / Gemini / Codex)

Decides whether to delegate work from the main Claude context. Acceptance criterion: overall accuracy ≥ 98% on the regression dataset, with per-class precision/recall ≥ 0.93.

**v0.2 scope:**
- The 4-axis algorithm in this SKILL.md is mirrored in code by `plugins/ccp/scripts/lib/router.mjs`. Both the recommendation hook and the regression suite import that single module (single SSOT).
- **Recommendation hook active**: `hooks/router-suggest.js` injects the decision as a system reminder on UserPromptSubmit (`[CCP-ROUTER-001]`). When the decision is `claude`, it is a no-op.
- **Canonical auto-routing (opt-in)**: in canonical interactive sessions, set `plugin.json#config.auto_routing: true` to let the router agent dispatch automatically (see README §5.3). Default is `false`.
- **No headless auto-delegation**: in headless mode the recommendation is shown only — the user must invoke the slash command directly (`/gemini:rescue` / `/ccp:codex-rescue`).
- Regression dataset: 70 cases (codex / gemini / claude classes + boundary false-positive guards).

## Trigger conditions

Apply this skill when any of the following holds:

- The user invokes `/gemini:rescue` or `/gemini:*` slash commands directly.
- Main context utilisation exceeds 75% and a new large task is incoming.
- The input contains delegation keywords such as "summarize", "review codebase", "this directory", or "large log".
- Attached files or text exceed 30,000 tokens.

If none of the above holds, do not apply the router — the main Claude handles the request directly.

## 4-axis decision algorithm

The router applies four axes in priority order. The first matching axis wins.

### A. User explicit (highest priority)

| Signal | Decision | reason |
|--------|----------|--------|
| `/gemini:rescue` slash invocation | `gemini` | `user_explicit_gemini` |
| `/ccp:codex-rescue` slash invocation | `codex` | `user_explicit_codex` |
| `--fallback-claude` flag | `claude` | `user_explicit_claude` |
| `--force-claude` flag (future) | `claude` | `user_explicit_claude` |
| `--effort` (codex-specific) | `codex` | `user_explicit_codex_option` |
| `--sandbox workspace-write` | `codex` | `user_explicit_codex_option` |
| Magic keyword `@gemini` / `@젬` / `@제미니` | `gemini` | `user_explicit_gemini_magic` |
| Magic keyword `@codex` / `@코덱` / `@코덱스` | `codex` | `user_explicit_codex_magic` |
| Magic keyword `@claude` / `@클` / `@클로드` | `claude` | `user_explicit_claude_magic` |
| Magic keyword `@auto` / `@자동` | (marker — fall through to B/C/D) | — |

User-explicit signals invalidate every other axis. Magic keywords are matched after `removeCodeBlocks` so keywords inside code fences do not trigger.

### B. Input size

| Estimated input tokens | review/diff keyword | Decision | reason |
|------------------------|---------------------|----------|--------|
| < 5,000 | — | `claude` | `too_small` (delegation cost > savings) |
| 5,000 – 30,000 | review / PR / diff / bug-investigation match | `codex` | `mid_review_codex` |
| 5,000 – 30,000 | otherwise | (proceed to axis C) | — |
| > 30,000 | — | `gemini` | `too_large` (1M context advantage) |

Token estimation: `words × 1.3` (see `token-budget-check` skill §2).

### C. Keyword matching

Keyword matching uses two helper primitives:

1. **`removeCodeBlocks`** strips ` ``` ... ``` ` and `` ` ... ` `` regions before matching, so a keyword inside example code does not trigger a false delegation.
2. **`hasActionableTrigger`** uses `\b ... \b` word-boundary matching for ASCII triggers and skips informational contexts (e.g. "what is review") via the `INFORMATIONAL_INTENT_PATTERNS` window.

Non-ASCII triggers fall back to substring matching but apply the same informational-intent guard. The full keyword dictionaries (including localised terms used by the primary user persona) live in `plugins/ccp/scripts/lib/router.mjs`.

#### Gemini-favoured keywords (large-context summary / analysis)
- `summarize`, `summary`, `review codebase`, `review the entire`, `whole directory`, `whole codebase`, `whole repo`, `whole project`, `entire codebase`, `monorepo`, `parse large log`, `log analysis`, `all markdown`, `all APIs`
- Attached files matching `*.log`, `*.csv`, `*.ndjson`, etc.

#### Codex-favoured keywords (code review / bugs / diff)
- `review code`, `code review`, `review this PR`, `audit diff`, `audit this diff`, `review the diff`, `find the bug`, `investigate the bug`, `refactoring proposal`, `code quality`
- `git diff` output or `*.patch` attachments

#### Claude-favoured keywords
- `edit`, `fix this line`, `rename this variable`, `add a comment`, `add a test`, `add type`, `autofix`, `TODO comment`, `error message`

#### Main-context-bind keywords (override)
The following keywords override every codex / gemini match because they signal that the input depends on the main Claude turn — delegation would break continuity:

- `just now`, `just edited`, `just wrote`, `just ran`, `above`, `previous response`, `previous output`, `last command`

#### Match resolution
| Match | Decision | reason |
|-------|----------|--------|
| Main-context-bind keyword present | `claude` | `main_context_bind` |
| Gemini keywords only | `gemini` | `keyword_gemini` |
| Codex keywords only | `codex` | `keyword_codex` |
| Claude keywords only | `claude` | `keyword_claude` |
| Multiple matches (excluding bind) | priority codex > gemini > claude | `keyword_<chosen>_priority` |
| No match | (proceed to axis D) | — |

### D. Fallback (default)

| Situation | Decision | reason |
|-----------|----------|--------|
| Decision is codex but codex CLI is missing or unauthenticated | `claude` | `fallback_codex_unavailable` |
| Decision is gemini but Gemini OAuth is expired / quota-exceeded / CLI missing | `claude` | `fallback_gemini_unavailable` |
| All previous axes undecided | `claude` | `default_conservative` |

**Conservative default**: when in doubt, route to the main Claude. A wrong delegation triggers the router-misclassification cost.

## Decision object format

```json
{
  "target": "claude" | "gemini" | "codex",
  "reason": "user_explicit_gemini | user_explicit_codex | user_explicit_codex_option | user_explicit_claude | user_explicit_gemini_magic | user_explicit_codex_magic | user_explicit_claude_magic | too_small | mid_review_codex | too_large | keyword_gemini | keyword_codex | keyword_claude | keyword_codex_priority | keyword_gemini_priority | fallback_codex_unavailable | fallback_gemini_unavailable | default_conservative",
  "axis": "A" | "B" | "C" | "D",
  "estimated_input_tokens": 12345,
  "matched_keywords": ["review this PR", "audit diff"]
}
```

## No-auto-fallback rule

After the router decides `gemini` or `codex`, a failed delegation must NOT be retried automatically against the main Claude. Instead, the envelope presents the user with one of the following choices.

| Model | Failure cause | User choices |
|-------|---------------|--------------|
| gemini | OAuth expired / quota | `/gemini:setup --renew` or `/gemini:rescue --fallback-claude "<task>"` |
| codex | not authenticated | `codex login` then retry, or `/ccp:codex-rescue --fallback-claude "<task>"` |

Reasons for forbidding auto-fallback:
1. **Prevent double billing** — calling both the delegated CLI and the main Claude duplicates the prompt cost.
2. **Respect user intent** — explicit re-invocation guarantees the action is intentional.
3. **Debuggability** — the user knows why the main Claude was invoked.

## Anti-pattern in headless automation

In `claude -p` headless invocations, when the router recommends gemini/codex the model may accumulate meta-bypass attempts. An external 4-environment benchmark observed up to 12 such attempts in a single run — the direct cause of a net-negative token regression.

### Do not (avoid meta-bypass accumulation)

- ❌ probing `gemini-companion.mjs --help` / `rescue --help`
- ❌ triple entry-point search (`Skill ccp:gemini-rescue` → `Agent ccp:gemini-rescue` → companion direct call)
- ❌ retrying the same task with different variants (Korean → English → minimal case)
- ❌ source spelunking with `grep "rescue|--task"`

### Do (pre-script the slash)

- ✅ Pre-script the slash command: `claude -p "/gemini:rescue <task>" -- ...`
- ✅ On failure, retry once and surface the result to the user (`--fallback-claude` only when explicitly requested — no auto-fallback).

### Guard

- `hooks/router-suggest.js` detects keywords such as `headless`, `claude -p`, `script`, `automation` on UserPromptSubmit and adds a `[CCP-META-WARN]` notice.
- When the user/script invokes a slash command (`/gemini:rescue` etc.), the headless suspicion is cleared and only the standard `[CCP-ROUTER-001]` recommendation is emitted.

## Accuracy measurement procedure

Use the 70-case regression dataset that ships with this repo (codex / gemini / claude classes + boundary false-positive guards).

```
accuracy = (prediction == ground-truth label) / total
```

Acceptance criteria:

| Metric | Threshold |
|--------|-----------|
| Overall accuracy | ≥ 98% (1 miss allowed) |
| Clear-case accuracy | 100% |
| Boundary-case accuracy (alt label allowed) | ≥ 80% |
| False-positive guard accuracy | 100% |
| Claude / Gemini / Codex precision and recall | ≥ 0.93 each |
| Confusion matrix | 3×3 (claude / gemini / codex) |

If a metric falls below threshold, follow this remediation order:
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

- README §5 (router behavior) · §5.3 (canonical auto-routing opt-in)
