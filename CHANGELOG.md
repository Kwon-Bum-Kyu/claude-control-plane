# CCP CHANGELOG

Claude Control Plane plugin changelog. The format follows [Keep a Changelog](https://keepachangelog.com/). Dates are KST.

> The version field of `plugin.json` (currently `0.1.0`) tracks code releases. This file groups user-visible changes by date.

---

## 2026-05-05 — Borrowed-code layout flattened

### Changed
- `plugins/ccp/scripts/lib/codex_adapted/{state,tracked-jobs,process,args,job-control}.mjs` → `plugins/ccp/scripts/lib/codex-{state,tracked-jobs,process,args,job-control}.mjs` (5 files renamed via `git mv`, history preserved).
- `plugins/ccp/scripts/lib/omc_adapted/magic-keywords.mjs` → `plugins/ccp/scripts/lib/magic-keywords.mjs`.
- Per-file 5-field adaptation headers (Adapted from / Source commit / Original license / Modifications / SHA-of-this-adaptation) removed from all 6 borrowed files. Attribution is now satisfied by the 3-signal layout: `ATTRIBUTION.md` (SSOT) + `NOTICE` (Apache-2.0 §4(d) + MIT copyright preservation) + new `README` References section.
- `harness-audit.js` audit category `adapted_headers` → `borrowed_code_documented` (R-2 redesign): now verifies that each of the 6 borrowed file paths is referenced in `ATTRIBUTION.md`. Total max stays at 40, CI threshold (`≥ 33/40`) unchanged.
- Import paths in `codex-companion.mjs` (5 imports) and `lib/router.mjs` (1 import) updated to flat layout.
- `README.md` §7.2 reframed as "References" section with project links, license tags, and adapted file paths.

### Verified
- `tests/router/router-eval.mjs`: 70/70 (100%), no regression.
- `tests/router/router-suggest-test.mjs`: 19/19, no regression.
- `tests/router/u4-measure.mjs`: 84.3 tok mean, CV 0.00%, no regression.
- `harness-audit.js`: 8 categories total 36/40, `borrowed_code_documented` 5/5.
- License obligations re-checked: Apache-2.0 §4 (a/b/c/d) and MIT copyright preservation both met by the 3-signal layout.

---

## 2026-05-05 — Korean magic keywords for routing

### Added
- 4 magic-keyword dictionaries in `plugins/ccp/scripts/lib/router.mjs` (Korean + English duals): `@gemini`/`@젬`/`@제미니`, `@codex`/`@코덱`/`@코덱스`, `@claude`/`@클`/`@클로드`, `@auto`/`@자동`.
- `findMagicKeyword()` helper, axis-A magic branch (`removeCodeBlocks` applied first so keywords inside code fences do not trigger).
- 5 new regression cases (`F16~F20` — 4 Korean magic-keyword scenarios + 1 code-block false-positive guard) — dataset grows from 65 to 70 cases.
- `router-decide.mjs` reason-code mapping: `*_magic` → `AXIS_A_SLASH` (treated as user-explicit).
- `agents/router.md` description trigger phrasing now mentions magic keywords.

### Verified
- `tests/router/router-eval.mjs`: 70/70 (100%), all per-class P/R ≥ 0.93.
- `tests/router/router-suggest-test.mjs`: 19/19 (no regression).
- `tests/router/u4-measure.mjs`: forwarding overhead stays at ~84 tok mean, CV 0.00%.
- `harness-audit.js`: total 36/40 (≥33 threshold).
- Magic-keyword smoke: `@젬` / `@codex` / `@클로드` / `@auto` (fall-through) / code-block guard — 5/5.

---

## 2026-05-05 — Router agent + canonical auto-routing (opt-in)

### Added
- `plugins/ccp/agents/router.md` — deterministic-router subagent (`tools: ["Bash"]`, `disallowedTools: ["Task"]`, `model: haiku`). Forwarding wrapper only: runs `router-decide.mjs` and returns the JSON envelope verbatim. Includes a "Why Haiku" section explaining the model choice.
- `plugins/ccp/scripts/lib/router-decide.mjs` — single Bash entry point. Reads `--prompt`, calls `router.mjs#classify`, detects canonical/headless via multi-signal OR (`env.CI` / `env.CLAUDE_CODE_NONINTERACTIVE` / `env.CLAUDE_CODE_ENTRYPOINT`), reads `plugin.json#config.auto_routing`, emits a `details.mode === "router"` envelope with a 12-value `reason_code` enum and `headless_confident` boolean.
- `plugin.json#config.auto_routing: false` — opt-in config toggle (default off).
- `hooks/router-suggest.js` split responsibility — auto_routing on + canonical → hook is noop (router agent dispatches); all other cases → hook recommends as before.
- `schemas/envelope.schema.json` — new `auto_routed: boolean`, `details.mode: "router"` branch with `decision`/`target`/`axis`/`reason_code` enum/`headless_confident`.
- `envelope-validate.mjs` — runtime guard for the router envelope (enum-only `reason_code`, boolean-only `headless_confident`).
- `tests/router/router-suggest-test.mjs` expanded from 9 to 19 scenarios (split-responsibility, multi-signal headless, envelope cap, reason_code enum, false-pos/neg guards, opt-out, agent-frontmatter check).
- `tests/router/u4-measure.mjs` — forwarding-overhead measurement tool (3 tasks × N=3 samples).
- `README.md` §5.3 — opt-in activation guide for canonical auto-routing.

### Changed
- Routing logic is now shared by 3 entry points (recommendation hook, regression suite, router agent) via `router.mjs` — single SSOT.

### Verified
- 19-scenario hook regression: 19/19 (100%, ≥18/19 = 95% threshold).
- Forwarding-overhead measurement: mean 84.3 tok, CV 0.00% across 9 samples (target ≤ 250 tok mean, CV ≤ 10%).
- Existing regressions unaffected: `router-eval` 65/65, `harness-audit` 36/40.

---

## 2026-05-04 — Public docs and GitHub workflows

### Added
- `.github/workflows/ci.yml` — 4-job matrix on Node 20 and 22: lint (`node --check`), router-eval, router-suggest-test, harness-audit.
- `.github/workflows/release.yml` — automatic GitHub release on `v*.*.*` tags.
- `.github/PULL_REQUEST_TEMPLATE.md` and 4 issue templates (bug / feature / question / borrowed-code).
- `docs/en/` and `docs/ko/`: `getting-started.md`, `architecture.md`, `router.md`, `slash-commands.md`, `troubleshooting.md` (5 docs × 2 languages).
- `README.md` documentation links in the header.

---

## 2026-05-02 — Recommendation hook + larger regression dataset

### Added
- `hooks/router-suggest.js` — UserPromptSubmit hook. When the routing decision is `gemini` or `codex`, injects a `[CCP-ROUTER-001]` recommendation as a system reminder. When the decision is `claude`, no-op. No automatic delegation.
- Routing logic extracted to `plugins/ccp/scripts/lib/router.mjs` so the hook and `router-eval` share a single implementation.
- 14 new codex-favoured regression cases (`X01~X14`): slash invocations, `--effort`/`--sandbox` options, mid-size review prompts, multi-keyword cases. Dataset grows from 36 to 50 cases.

### Verified
- `router-eval`: 50/50 (100%), all per-class P/R ≥ 0.93. codex P/R = 1.000/1.000 after the codex class grew from 1 to 15 cases.
- 6-scenario hook regression: 6/6.
- `harness-audit`: 37/40.

---

## 2026-05-01 — Codex CLI integration

### Added
- `plugins/ccp/scripts/codex-companion.mjs` (~480 lines) — mirrors `gemini-companion.mjs` for codex.
- `plugins/ccp/scripts/lib/codex_adapted/` — 5 modules borrowed function-by-function from codex-plugin-cc (Apache-2.0): `state`, `tracked-jobs`, `process`, `args`, `job-control`. Each carries a 5-field adaptation header (Adapted from / Source commit / Original license / Modifications / SHA-of-this-adaptation).
- 4 slash commands: `/ccp:codex-{setup,rescue,status,result}`.
- `agents/codex-rescue.md` subagent.
- `schemas/envelope.schema.json` and `envelope-validate.mjs` — JSON-schema contract + runtime self-validation.
- `harness-audit.js` `scoreAdaptedHeaders()` category — 5-field header presence check on all `lib/codex_adapted/*` files.
- `NOTICE` file (Apache-2.0 obligation) and `ATTRIBUTION.md` §1.3·1.4·6 (codex-plugin-cc source mapping).
- 3-way router (Claude / Gemini / Codex). Foreground timeout flags (`--timeout-ms`, `--poll-interval-ms`) on both companions.

### Changed
- `gemini-companion.mjs` rejects codex-only options (`--effort`, `--sandbox`, `--write`, `--cwd`, `--model`) inline with `CCP-INVALID-001`.
- Token-stat envelope normalised to 4 fields (`input` / `cached` / `output` / `total`).

### Verified
- 36-case router regression: 36/36 (100%), all per-class P/R ≥ 0.93.
- `harness-audit`: 8 categories total 37/40 (`plugin_compat` 5/5, `adapted_headers` 5/5).

---

## 2026-04-28 — Foreground timeout raised to 10 minutes

### Changed
- `runGeminiSync` foreground timeout: 60s → 600s (10 min). Real user feedback showed 60s was too aggressive for moderately large prompts. Background mode and `probeOAuth` are unchanged (30s OAuth probe stays).

---

## 2026-04-27 — Plugin-manifest schema fix + token measurement unit

### Fixed
- `harness-audit.js` `scorePluginCompat()` now checks the 5 standard `plugin.json` fields (`name`, `version`, `description`, `author`, `license`) — previously checked non-standard `minClaudeVersion` / `engines` keys, leading to `plugin_compat: 0/5`. Score is now 5/5; total goes from 27/35 to 33/35.
- `cmdStatus`/`cmdResult` accept both `--job-id <id>` and positional `<id>` (previously the flag was parsed but unused, returning `INVALID`).

### Documented
- Token measurement unit clarified: Gemini CLI 0.38.x reports `tokens.input ≈ 10,441` even for trivial prompts (system prompt + tool registry are charged on every call). Compare savings on `output + thoughts` rather than `input`.

---

## 2026-04-26 — Public release prep

### Added
- `LICENSE` (MIT), `ATTRIBUTION.md`, `CONTRIBUTING.md`, README.
- `harness-audit.js` `scoreSecretLeak()` — grep guards for tokens, secrets, API keys.
- 7-category audit rubric: context_efficiency, cost_efficiency, router_accuracy, double_billing, fallback_health, plugin_compat, secret_leak.

---

## 2026-04-25 — Engines field declared

### Added
- `plugin.json` `engines.node >= 20.0.0`, `engines.gemini_cli >= 0.38.0`. Companion enforces these at runtime via `gemini --version` parsing in `preflight`.

---

## 2026-04-24 — Detached background spawn validated

### Verified
- Detached background spawn pattern: parent process exits immediately, child survives via `child.unref()` + file-fd stdio. `meta.json` transitions queued → running. stdout envelope is a 6-key JSON.
- stderr masking dropped — IDE tokens are not exposed in stderr, `/var/folders/*` paths use random hashes that do not identify the user, the envelope only promotes `stdout` JSON, and raw stderr is `.gitignore`-blocked.

---

## 2026-04-23 — Manifest scaffold

### Added
- `.claude-plugin/marketplace.json`, `plugins/ccp/.claude-plugin/plugin.json`, hooks/commands/agents/skills/scripts directory layout.
- 4 slash commands (`/gemini:{rescue,status,result,setup}` + `/ccp:audit`).
- 2 hooks (`suggest-compact.js`, `boot-check.js`).
- 2 skills (`router/SKILL.md`, `context-budget/SKILL.md`).

---

## 2026-04-22 — Project bootstrap

### Added
- Project brief, design principles, scope-guard backlog policy.
- 7 architecture principles: single error-code namespace; envelope as single contract surface; 3-line summary + result_path on disk; no automatic fallback; ≥ 2 hooks; 1M-context delegation; subagent isolation.
