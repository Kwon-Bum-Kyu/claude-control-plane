---
name: router
description: "CCP model router — 3-way delegation decision logic for Claude (main) vs Gemini vs Codex. 4-axis priority: user-explicit > input-size > keyword > fallback. Use when deciding `/gemini:rescue` / `/ccp:codex-rescue` invocation, evaluating routing, or guarding against R3 misclassification cost. **v0.2 (B19 RESOLVED): hooks/router-suggest.js injects recommendations on UserPromptSubmit. Auto-delegation is NOT performed (Principle 4 — no automatic fallback).**"
---

# CCP Router — 3-way Routing Skill (Claude / Gemini / Codex)

Decides whether to delegate work from the main Claude context. Acceptance criterion: accuracy ≥ 80% (`_workspace/02_router_accuracy_spec.md` §0.3, AC-2).

**v0.2 scope (B19 RESOLVED — 2026-05-02, decision #4 option C Phase 1):**
- The 4-axis algorithm in this SKILL.md is mirrored in code by `plugins/ccp/scripts/lib/router.mjs`. Verified by router-eval 65/65 (100%, N5 — 2026-05-04).
- **Recommendation hook active**: `hooks/router-suggest.js` injects the decision as a system reminder on UserPromptSubmit (`[CCP-ROUTER-001]`). When the decision is `claude`, it is a no-op.
- **No auto-delegation**: only the recommendation is shown; the user must invoke the slash command directly (`/gemini:rescue` / `/ccp:codex-rescue`) — Principle 4 (no automatic fallback).
- B20·N5 dataset: 65 cases (codex 18 / gemini 16 / claude 26 + 5 boundary).

## Trigger conditions

Apply this skill when any of the following holds:

- The user invokes `/gemini:rescue` or `/gemini:*` slash commands directly.
- Main context utilisation exceeds 75% and a new large task is incoming.
- The input contains delegation keywords such as "summarize", "review codebase", "this directory", or "large log".
- Attached files or text exceed 30,000 tokens (PRD §5.1(2) threshold).

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

User-explicit signals invalidate every other axis.

### B. Input size

| Estimated input tokens | review/diff keyword | Decision | reason |
|------------------------|---------------------|----------|--------|
| < 5,000 | — | `claude` | `too_small` (delegation cost > savings) |
| 5,000 – 30,000 | review / PR / diff / bug-investigation match | `codex` | `mid_review_codex` |
| 5,000 – 30,000 | otherwise | (proceed to axis C) | — |
| > 30,000 | — | `gemini` | `too_large` (1M context advantage) |

Token estimation: `words × 1.3` (see `token-budget-check` skill §2).

### C. Keyword matching

Keyword matching uses two omc-derived primitives (N4, MIT, see `ATTRIBUTION.md` §1.5):

1. **`removeCodeBlocks`** strips ` ``` ... ``` ` and `` ` ... ` `` regions before matching, so a keyword inside example code does not trigger a false delegation.
2. **`hasActionableTrigger`** uses `\b ... \b` word-boundary matching for ASCII triggers and skips informational contexts (e.g. "what is review") via the `INFORMATIONAL_INTENT_PATTERNS` window.

Non-ASCII triggers fall back to substring matching but apply the same informational-intent guard. The full keyword dictionaries (including localised terms used by the primary user persona) live in `plugins/ccp/scripts/lib/router.mjs`.

#### Gemini-favoured keywords (large-context summary / analysis)
- `summarize`, `summary`, `review codebase`, `review the entire`, `whole directory`, `whole codebase`, `whole repo`, `whole project`, `entire codebase`, `monorepo`, `parse large log`, `log analysis`, `all markdown`, `all APIs`
- Attached files matching `*.log`, `*.csv`, `*.ndjson`, etc.

#### Codex-favoured keywords (code review / bugs / diff)
- `review code`, `code review`, `review this PR`, `audit diff`, `audit this diff`, `review the diff`, `find the bug`, `investigate the bug`, `refactoring proposal`, `code quality`
- `git diff` output or `*.patch` attachments

> **Note (decision #3):** the review slash (`/codex review`) is split into v0.2 (B18). This skill only pre-classifies the keyword; activation is deferred.

#### Claude-favoured keywords
- `edit`, `fix this line`, `rename this variable`, `add a comment`, `add a test`, `add type`, `autofix`, `TODO comment`, `error message`

#### Main-context-bind keywords (override)
The following keywords override every codex / gemini match because they signal that the input depends on the main Claude turn — delegation would break continuity (R3):

- `just now`, `just edited`, `just wrote`, `just ran`, `above`, `previous response`, `previous output`, `last command`

(Validated by B1 case C08 — main-context-bind expressions force `claude`.)

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

**Conservative default**: when in doubt, route to the main Claude. A wrong delegation triggers R3 (router misclassification cost).

## Decision object format

```json
{
  "target": "claude" | "gemini" | "codex",
  "reason": "user_explicit_gemini | user_explicit_codex | user_explicit_codex_option | user_explicit_claude | too_small | mid_review_codex | too_large | keyword_gemini | keyword_codex | keyword_claude | keyword_codex_priority | keyword_gemini_priority | fallback_codex_unavailable | fallback_gemini_unavailable | default_conservative",
  "axis": "A" | "B" | "C" | "D",
  "estimated_input_tokens": 12345,
  "matched_keywords": ["review this PR", "audit diff"]
}
```

## No-auto-fallback rule

**Core principle (Principle 4 — `_workspace/02_arch_decisions.md`):**
After the router decides `gemini` or `codex`, a failed delegation must NOT be retried automatically against the main Claude. Instead, the envelope presents the user with one of the following choices.

| Model | Failure cause | User choices |
|-------|---------------|--------------|
| gemini | OAuth expired / quota | `/gemini:setup --renew` or `/gemini:rescue --fallback-claude "<task>"` |
| codex | not authenticated | `codex login` then retry, or `/ccp:codex-rescue --fallback-claude "<task>"` |

Reasons for forbidding auto-fallback:
1. **Prevent R1 (double billing)** — calling both the delegated CLI and the main Claude duplicates the prompt cost.
2. **Respect user intent** — explicit re-invocation guarantees the action is intentional.
3. **Debuggability** — the user knows why the main Claude was invoked.

## ⚠️ Anti-pattern in headless automation (B21-3, 2026-05-03)

In `claude -p` headless invocations, when the router recommends gemini/codex the model may accumulate meta-bypass attempts. B9 §8.5.4 (`ccp_report.md`) reports 12 such attempts in a single run — the direct cause of the 2.1× net negative token regression.

### Do not (avoid meta-bypass accumulation)

- ❌ probing `gemini-companion.mjs --help` / `rescue --help`
- ❌ triple entry-point search (`Skill ccp:gemini-rescue` → `Agent ccp:gemini-rescue` → companion direct call)
- ❌ retrying the same task with different variants (Korean → English → minimal case)
- ❌ source spelunking with `grep "rescue|--task"`

### Do (pre-script the slash)

- ✅ Pre-script the slash command: `claude -p "/gemini:rescue <task>" -- ...`
- ✅ Direct companion invocation: `node plugins/ccp/scripts/gemini-companion.mjs rescue --task <task>`
- ✅ On failure, retry once and surface the result to the user (`--fallback-claude` only when explicitly requested — no auto-fallback).

### Guard

- `hooks/router-suggest.js` (B19 + B21-3) detects keywords such as `headless`, `claude -p`, `script`, `automation` on UserPromptSubmit and adds a `[CCP-META-WARN]` notice.
- When the user/script invokes a slash command (`/gemini:rescue` etc.), the headless suspicion is cleared and only the standard `[CCP-ROUTER-001]` recommendation is emitted.

## Accuracy measurement procedure

Use the 65-case dataset in `_workspace/_router_test/EVAL_DATASET.md` §2 (B20·N5 — codex 18 / gemini 16 / claude 26 / 5 boundary; F01~F15 false-positive guards).

```
accuracy = (prediction == ground-truth label) / 65
```

Acceptance criteria (PRD §7 AC-2 — N5 update):

| Metric | Threshold |
|--------|-----------|
| Overall accuracy | ≥ 98% (1 miss allowed) |
| Clear-case accuracy (C / G / X) | 100% |
| Boundary-case accuracy (B, alt label allowed) | ≥ 80% |
| False-positive guard accuracy (F01~F15) | 100% |
| Claude / Gemini / Codex precision and recall | ≥ 0.93 each |
| Confusion matrix | 3×3 (claude / gemini / codex) |

If a metric falls below threshold, follow this remediation order:
1. Augment the keyword dictionary with the misclassified core terms.
2. Adjust thresholds (5K → 8K, or 30K → 25K).
3. Re-label the boundary cases.
4. If still below threshold, notify `scope-guard` and consider removing auto routing entirely (manual slash only).

## Phase 6+ / v0.3 backlog (`_workspace/01_backlog.md`)

Out of scope for v0.2:

- Korean magic-keyword auto-detection (`@gemini`, `@codex`, `@claude`, `@auto`) — B25 (Phase 6+, blocked by B24).
- Cost / latency multi-objective optimisation.
- ML-based classifier (current implementation is rule-based).
- review / adversarial-review slash (B18) — depends on git diff extraction.
- Auto-delegation (option D — invoke the slash without user confirm) — B24 Phase 6+, originally proposed for v0.1.0 but architecture-reviewer issued HOLD (`_workspace/07_n9_architecture_review.md`).

## Why

The router is the core logic that determines CCP's token-saving effect. The 4-axis priority structure is designed to:

1. **Always respect user intent** — eliminate surprises.
2. **Resolve obvious cases quickly** — input-size thresholds collapse boundary ambiguity.
3. **Use keywords only at the margin** — prevent over-fitting.
4. **Conservative default** — when in doubt, Claude (a wrong delegation manifests as R3).

## Artefact locations

- This skill: `plugins/ccp/skills/router/SKILL.md`
- Accuracy dataset spec: `_workspace/02_router_accuracy_spec.md`
- Eval driver: `_workspace/_router_test/router-eval.mjs` (65 cases)
- Router code mirror: `plugins/ccp/scripts/lib/router.mjs`
- omc primitives (N4, MIT): `plugins/ccp/scripts/lib/omc_adapted/magic-keywords.mjs`

## References

- `_workspace/01_prd.md` §5.1(2)
- `_workspace/02_router_accuracy_spec.md`
- `_workspace/02_arch_decisions.md` Principle 4 (no auto-fallback)
- `ATTRIBUTION.md` §1.5 (omc adaptation)
- `.claude/skills/router-implementation/SKILL.md` (meta-skill)
