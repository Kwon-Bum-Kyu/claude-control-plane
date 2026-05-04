---
name: context-budget
description: "Estimates the main Claude context token budget and warns when usage crosses 50/75/90% thresholds. Invoked from UserPromptSubmit / PreCompact hooks. Apply when context utilisation exceeds 50% or before any large incoming task."
---

# Context Budget Skill

Estimates the main Claude context token budget and recommends voluntary compaction (`/compact`) or Gemini delegation (`/gemini:rescue`) when thresholds are crossed.

## Attribution

This skill is a port of **the `strategic-compact` pattern from ecc (External Claude Code)**.

- Source: ecc strategic-compact
- License: MIT (permissive — preserved in `ATTRIBUTION.md` §1.1)
- Modifications: applied CCP naming convention (`CCP-COMPACT-001`), translated messages, removed automatic `/compact` trigger (Principle 4 — user intent first)
- Full attribution: `ATTRIBUTION.md` §1.1

## Trigger conditions

Apply this skill when:

- Estimated main-context utilisation ≥ **50%**
- The user is about to attach a large file or send a long prompt
- `UserPromptSubmit` or `PreCompact` hook fires

Below 50% the skill does NOT trigger (avoids unnecessary alerts).

## Token estimation formula

```
estimated_tokens = words × 1.3
```

Rationale: see `.claude/skills/token-budget-check/SKILL.md` §2. The `words × 1.3` heuristic is sufficiently conservative and works in every environment without invoking a tokenizer.

## Threshold matrix

| Utilisation | Level | Recommendation |
|-------------|-------|----------------|
| < 50% | OK | (no trigger) |
| 50% – 75% | INFO | "Context usage above 50%. Consider delegating new large tasks via `/gemini:rescue`." |
| 75% – 90% | WARNING (`CCP-COMPACT-001`) | "75% reached — compact manually with `/compact`, or delegate large tasks via `/gemini:rescue`." |
| ≥ 90% | CRITICAL (`CCP-COMPACT-001`) | "90% imminent — `/compact` or `/gemini:rescue --background` recommended." |

`decision: "block"` is never used — the user flow is not interrupted (Principle 4).

## No auto `/compact` rule

The ecc original triggers strategic-compact automatically. CCP forbids automatic invocation for the following reasons:

1. **User intent**: `/compact` must be invoked explicitly.
2. **R1 (double billing) prevention**: if the user re-issues the same task after an automatic compaction, tokens are charged twice.
3. **Debuggability**: the user can answer "why did it compact?" without log spelunking.

The auto-compact trigger is frozen as a Phase 6+ backlog item in `_workspace/01_backlog.md`.

## Integration points

- `plugins/ccp/hooks/suggest-compact.js` — UserPromptSubmit / PreCompact hook consumes the threshold matrix above
- `plugins/ccp/scripts/gemini-companion.mjs` — companion output guard (`enforceContextBudget`) applies the same 1,500-token / 500-character cap

## Acceptance criteria (regression — `_workspace/02_regression_cases.md`)

- RC-1 `main_context_delta ≤ 500` — main-context inflow ≤ 500 chars
- At the 75% threshold, `additionalContext` is injected exactly once
- The user's raw prompt MUST NOT be echoed inside `additionalContext`

## Spec SSOT

- `_workspace/02_arch_decisions.md` Principle 5 (≥ 2 hooks) · Principle 4 (no auto-fallback)
- `_workspace/03_hook_feasibility.md` §1 UserPromptSubmit spec
- `_workspace/03_hook_strategy.md` §2.1 (suggest-compact spec)
- `_workspace/02_token_scenarios.md` T1~T7 token-saving criteria
- `.claude/skills/token-budget-check/SKILL.md` (meta-skill)
