# Claude Control Plane (CCP)

> A Claude Code plugin that keeps Claude as the main control plane and orchestrates Gemini CLI and Codex CLI as subagents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.0-339933)](https://nodejs.org)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-%E2%89%A50.38.0-4285F4)](https://github.com/google-gemini/gemini-cli)
[![Codex CLI](https://img.shields.io/badge/Codex%20CLI-%E2%89%A50.122.0-000000)](https://github.com/openai/codex)

📚 **Docs**: [English](./docs/en/getting-started.md) · [한국어](./docs/ko/getting-started.md) · [README in Korean](./README.ko.md)

---

## 1. Introduction

### The problem CCP solves

Processing a large context (codebase, logs, documents) through Claude alone burns the main session's token budget quickly and exhausts your quota. CCP **delegates** that work to Gemini CLI or Codex CLI and returns only a 3-line summary plus a result-file path to the main session, **isolating Claude's token accumulation**.

### What it does

- **Automatic routing**: Decides between Claude (main) and delegation based on a 4-axis priority — user-explicit, input size, keywords, and a conservative fallback.
- **Isolated envelope**: Full Gemini/Codex output is written to disk; only a `summary` (≤ 500 chars) + `result_path` enters the main session.
- **Guardrails**: At 75% context utilisation, the user is *advised* (not forced) to run `/compact`. No automatic execution.
- **Audit**: `/ccp:audit` periodically checks envelope violations, router misclassification, and secret-leak signals.

### What it does not do (out of MVP scope)

- Ralph-loop automation
- ML-based classifier (current router is rule-based)
- Gemini Vision / multimodal input

### Target user

Solo developers and small-team leaders who frequently exhaust their Claude quota on large logs and codebases.

---

## 2. Install (5 min)

### Prerequisites

- Claude Code v2.1+
- Node.js ≥ 20.0
- **For Gemini delegation**: Gemini CLI ≥ 0.38.0 + a Google account (auto-prompted)
- **For Codex delegation**: Codex CLI ≥ 0.122.0 + a ChatGPT account (auto-prompted)

You only need the CLI for the side(s) you actually want to use.

### Install commands

```
/plugin marketplace add Kwon-Bum-Kyu/claude-control-plane
/plugin install ccp@claude-control-plane
/gemini:setup        # Diagnose Gemini CLI · OAuth status
/ccp:codex-setup     # Diagnose Codex CLI · OAuth status
```

`/gemini:setup` and `/ccp:codex-setup` automatically diagnose Node.js, the upstream CLI, and OAuth status. If anything is missing, they print the exact recovery command. Typical setup commands:

```bash
# Gemini
npm install -g @google/gemini-cli@latest
gemini                              # first interactive run → browser opens for Google OAuth
# (alternative) export GEMINI_API_KEY="..."   # AI Studio key: https://aistudio.google.com/apikey

# Codex
npm install -g @openai/codex
# or: brew install codex            # macOS
codex login                         # browser-based ChatGPT auth
# (no browser?) codex login --device-auth     # device-code flow
# (API key?)    printenv OPENAI_API_KEY | codex login --with-api-key
```

### Smoke test

```
/gemini:rescue "Summarize this repository's README in 3 lines"
```

If you see a 3-line summary + an estimated token saving + a `result_path` under `_workspace/_jobs/`, the plugin is healthy.

### If something fails

See the error-code table in [§6 Troubleshooting](#6-troubleshooting).

---

## 3. Quick start (4 canonical samples)

### Sample 1 — Small input (router warm-up)

```
/gemini:rescue "Summarize this repository's README in 3 lines"
```

The router inspects input size and keywords to decide between Claude and Gemini. Very small inputs typically stay on Claude.

### Sample 2 — Large log file (background job)

```
/gemini:rescue --background "Extract the top 10 5xx errors from /var/log/app/error.log over the last 24 hours"
```

The companion immediately returns a `job_id`. Track and retrieve:

```
/gemini:status <job_id>
/gemini:result <job_id>
```

The full Gemini output stays on disk; only a bounded summary is returned to Claude.

### Sample 3 — Code review (Codex)

```
/ccp:codex-rescue --cwd $(pwd) -- "Review this PR's git diff and identify 5 potential bugs"
```

Codex handles the heavy reviewing reasoning. The main Claude session sees only a ≤ 500-char summary + `result_path`.

### Sample 4 — Token-saving audit

```
/ccp:audit --since 7d
```

Outputs an 8-category score (`context_efficiency`, `cost_efficiency`, `router_accuracy`, `double_billing`, `fallback_health`, `plugin_compat`, `borrowed_code_documented`, `secret_leak`) as Markdown or JSON.

---

## 4. Slash command reference

### 4.1 Gemini (large summarization · analysis)

| Command | Summary |
|---|---|
| `/gemini:rescue <prompt>` | Delegate heavy work to Gemini |
| `/gemini:status <job_id>` | Check background job status |
| `/gemini:result <job_id>` | Retrieve a completed job's summary + path |
| `/gemini:setup [--renew]` | Diagnose Gemini CLI · OAuth |

### 4.2 Codex (code review · diff · bug investigation)

| Command | Summary |
|---|---|
| `/ccp:codex-rescue <prompt>` | Delegate code review or diff analysis to Codex |
| `/ccp:codex-status <job_id>` | Check background job status |
| `/ccp:codex-result <job_id>` | Retrieve a completed job's summary + path |
| `/ccp:codex-setup` | Diagnose Codex CLI · OAuth |

### 4.3 Common

| Command | Summary |
|---|---|
| `/ccp:audit [--since N --format md\|json]` | Audit token / envelope / routing health |

For detailed options see `plugins/ccp/commands/*.md`.

### 4.4 Key options

| Option | gemini | codex | Description |
|---|:---:|:---:|---|
| `--background` | ✅ | ✅ | Background execution; returns `job_id` immediately |
| `--fallback-claude` | ✅ | ✅ | Ignore the routing decision; route to the main Claude |
| `--timeout-ms N` | ✅ (default 600000) | ✅ (default 600000) | Foreground timeout |
| `--poll-interval-ms N` | ✅ (2000) | ✅ (2000) | Background polling interval |
| `--max-tokens N` | ✅ (default 4000) | ❌ | Gemini response token cap (translated into a prompt suffix) |
| `--files <glob>` | ⚠️ MVP unimplemented | ❌ | Gemini attached files |
| `--model NAME` | ❌ | ✅ | Codex model alias |
| `--effort low\|medium\|high` | ❌ `CCP-INVALID-001` | ✅ (`-c model_reasoning_effort=`) | Reasoning effort |
| `--sandbox MODE` | ❌ `CCP-INVALID-001` | ✅ (read-only / workspace-write / danger-full-access) | Codex sandbox |
| `--cwd DIR` | ❌ | ✅ | Codex working directory |
| `--renew` | ✅ | (n/a — use `codex login` directly) | OAuth re-auth flow |

### 4.5 Model compatibility matrix (3-way)

How `/ccp:codex-rescue` (codex), `/gemini:rescue` (gemini), and the main Claude (claude) compare across options and features:

| Option / feature | claude | gemini | codex | Notes |
|---|:---:|:---:|:---:|---|
| `--background` (async) | ❌ | ✅ | ✅ | claude is the main context, so n/a |
| `--wait` (background polling) | n/a | ✅ | ✅ | Both companions identical |
| `--timeout-ms N` | n/a | ✅ (default 600000) | ✅ (default 600000) | Foreground timeout |
| `--poll-interval-ms N` | n/a | ✅ (2000) | ✅ (2000) | Polling interval |
| `--model NAME` | †`/model` slash | ✅ | ✅ | claude uses Claude Code's `/model` slash |
| `--effort low\|medium\|high` | ‡extended thinking | ❌ `CCP-INVALID-001` | ✅ `-c model_reasoning_effort=<level>` | claude uses Option+T (extended-thinking toggle) |
| `--sandbox <mode>` | n/a (no execution) | ❌ | ✅ read-only / workspace-write / danger-full-access | codex only |
| `--write` | n/a | ❌ | ✅ (= `--sandbox workspace-write`) | codex readability alias |
| `--cwd DIR` | n/a (conversation turn) | ❌ | ✅ (`-C`) | codex only |
| `--max-tokens N` | n/a | ✅ (prompt-suffix translation) | ❌ | gemini only |
| `--files <glob>` | (conversation attachment) | ⚠️ MVP unimplemented | ❌ | gemini backlog |
| `--resume-last` | n/a | ⚠️ MVP unimplemented (meta-file imitation) | ✅ (`codex resume --last`) | codex CLI native support |
| OAuth probe | n/a | `gemini --version` + `~/.gemini/google_accounts.json` | `codex login status` | Both companions: 30 s timeout |

**Legend:** ✅ supported / ❌ rejected with `CCP-INVALID-001` or `CCP-UNSUPPORTED-001` / ⚠️ partial mapping / n/a not applicable
**Footnotes:**
- ‡ Claude extended thinking: `Option+T` toggle, or `alwaysThinkingEnabled` in `~/.claude/settings.json`
- † Claude `/model` slash: a Claude Code built-in command
- A gemini ❌ option leaking into args is rejected inline as `CCP-INVALID-001` (companion guard)

---

## 5. Router behavior (3-way)

The CCP router uses a **4-axis priority** to choose one of three routes — Claude / Gemini / Codex.

```
user-explicit (axis A) → input size (axis B) → keywords (axis C) → fallback (axis D)
   /gemini, /codex,        > 30K → Gemini    summary → gemini / review → codex    Claude (conservative)
   --effort, --sandbox     5K-30K + review → Codex
```

```
[user prompt]
       ↓
   [axis A]  /gemini:rescue · /ccp:codex-rescue · --fallback-claude · --effort · --sandbox
       ↓ (if absent)
   [axis B]  estimated_tokens > 30,000 → Gemini  (if a review keyword is also present → Codex)
              5,000 ≤ tokens ≤ 30,000 + review keyword → Codex
       ↓ (otherwise)
   [axis C]  main-context-bind keywords (just now / above / ...) → forces Claude
              other keywords by priority: codex (review/diff) > gemini (summary/large) > claude
       ↓ (no match)
   [axis D]  fallback → Claude (conservative)
```

- **Automated calibration**: 70-case offline regression dataset → **100% accuracy**, P/R ≥ 0.93 for every model.
- **Transparency**: every call surfaces the decision in `details.mode` (`gemini` | `codex`).
- **Recommendation hook (v0.2)**: on `UserPromptSubmit`, the decision is injected as a `[CCP-ROUTER-001]` system reminder. Headless auto-delegation is **not** performed — the user invokes the slash command themselves.

### 5.1 Token-saving pattern (canonical, recommended)

CCP's token-saving effect is strongest in the **interactive, slash-direct trigger** pattern:

```
✅ Recommended:  /gemini:rescue summarize the entire directory
✅ Recommended:  /ccp:codex-rescue review this PR diff
```

In this pattern, the envelope cap (≤ 500 chars) plus `result_path` persistence prevents the main Claude context from accumulating delegated output.

### 5.2 Headless automation guidance

Under `claude -p` headless invocations, models tend to probe delegation entry points and accumulate meta-bypass attempts (e.g. `Skill → Agent → companion --help`), which can grow tokens instead of shrinking them — observed in external benchmarks. To benefit from delegation in headless automation, use the following pattern.

```bash
# ✅ Recommended: pre-script the slash
claude -p "/gemini:rescue summarize the entire directory" -- ...
claude -p "/ccp:codex-rescue review this PR diff" -- ...

# ❌ Forbidden: rescue --help / Skill→Agent traversal / repeated prompt variations
```

The `router-suggest` hook detects keywords such as `headless`, `claude -p`, `script`, `automation`, `cron`, `CI` and auto-injects a `[CCP-META-WARN]` advisory (meta-bypass guard).

When in doubt, run `/ccp:audit` and check the `router_accuracy` category.

### 5.3 Canonical auto-routing (opt-in)

Default behavior is **recommendation only** (`[CCP-ROUTER-001]` reminder; the user invokes the slash). To automate routing in interactive (canonical) sessions, enable `plugin.json#config.auto_routing`:

```jsonc
// plugins/ccp/.claude-plugin/plugin.json
{
  "config": {
    "auto_routing": true   // Default false. Auto-delegation only when explicitly enabled.
  }
}
```

When enabled:

| Entry path | Behavior |
|---|---|
| canonical (interactive) | The router agent (`agents/router.md`, deterministic-router) is auto-invoked. If `decision != claude`, the `target` slash command is auto-typed on the next turn. The envelope sets `auto_routed: true`. |
| headless (`claude -p`, CI runner) | Auto-delegation is blocked; only the recommendation is shown. Multi-signal OR — `env.CI=true` / `env.CLAUDE_CODE_NONINTERACTIVE=1` / `env.CLAUDE_CODE_ENTRYPOINT≠cli` triggers the block. |
| Delegation failure (OAuth expired, CLI missing) | No automatic fallback. The envelope guides the user to re-invoke explicitly. |

Two ways to opt out:

1. `plugin.json#config.auto_routing: false` — default
2. `--no-auto-route` flag (per session)

Double-billing defenses — `auto_routed: true` in the envelope + the router agent's forwarding-only pattern + envelope free-text rejection (12-value `reason_code` enum) + measured forwarding overhead (~84 tok mean, CV 0%).

---

## 6. Troubleshooting

### 6.1 Gemini-side error codes

| Code | Frequency | Next action |
|---|:---:|---|
| `CCP-OAUTH-001` | ★★★ | Run `gemini` once to trigger OAuth (or set `GEMINI_API_KEY`), then re-run `/gemini:setup` |
| `CCP-SETUP-001` | ★★★ | `npm install -g @google/gemini-cli@latest` |
| `CCP-SETUP-002` | ★★ | Install Node.js 20+ (nvm recommended) |
| `CCP-GEMINI-001` | ★★ | Retry, or `/gemini:rescue --fallback-claude` |
| `CCP-CTX-001` | ★ | Summary length exceeded — shrink the input |
| `CCP-ROUTER-001` | ★ | Run `/ccp:audit` to inspect routing decisions |
| `CCP-COMPACT-001` | ★ | Run `/compact` manually |
| `CCP-JOB-001~004` | ★ | Re-check job state via `/gemini:status` |

### 6.2 Codex-side error codes

| Code | Frequency | Next action |
|---|:---:|---|
| `CCP-OAUTH-101` | ★★★ | Run `codex login` to auth ChatGPT, then re-run `/ccp:codex-setup` |
| `CCP-SETUP-101` | ★★★ | `brew install codex` or `npm install -g @openai/codex` |
| `CCP-SETUP-102` | ★★ | `brew upgrade codex` or npm reinstall (≥ 0.122.0 required) |
| `CCP-CODEX-001` | ★★ | Inspect stderr, then retry, or `/ccp:codex-rescue --fallback-claude` |
| `CCP-CODEX-002` | ★ | JSONL parse failure — retry with `--verbose` and inspect stderr |
| `CCP-JOB-001~004` | ★ | Re-check job state via `/ccp:codex-status` |
| `CCP-JOB-409` | ★ | Cannot cancel from current state — re-check and retry |
| `CCP-INVALID-001` | ★ | Codex-only options (`--effort`/`--sandbox`/`--write`) used on the gemini side — switch slash command |

### 6.3 Common

| Code | Frequency | Next action |
|---|:---:|---|
| `CCP-TIMEOUT-001` | ★★ | Retry, or use `--background` (foreground default 600 s) |
| `CCP-AUDIT-001~002` | ★ | Adjust `--since` range or inspect logs |

For the full catalog see the `ERROR_CATALOG` constants in `plugins/ccp/scripts/gemini-companion.mjs` and `codex-companion.mjs`.

### 6.4 FAQ

- **What's the Gemini free-tier limit?** 60 req/min on `gemini-2.5-pro`. Exact values follow Google account policy.
- **What's the Codex free-tier limit?** Bound to your ChatGPT Plus/Pro subscription quota. Exact values follow OpenAI policy.
- **OAuth expiry?** Google ~7 days, ChatGPT typically 30+ days. On expiry, `CCP-OAUTH-001` / `CCP-OAUTH-101` automatically guide you.
- **Permission errors with `npm i -g`?** Use nvm or `sudo`. nvm is recommended.
- **No browser available?** Gemini: set `GEMINI_API_KEY` (https://aistudio.google.com/apikey). Codex: `codex login --device-auth` (device-code flow), or `printenv OPENAI_API_KEY | codex login --with-api-key`.
- **`--effort` rejected on the gemini side?** Intentional — see compatibility matrix (§4.5). Use `/ccp:codex-rescue --effort high -- "<task>"` instead.
- **codex hangs reading stdin?** The companion forces `stdio: ['ignore', ...]` automatically. If you call `codex exec` manually, append `</dev/null`.
- **`Reading additional input from stdin...` in stderr?** Normal codex CLI output. Harmless — the companion absorbs it.

---

## 7. License & credits

### 7.1 This project

[MIT License](./LICENSE) — © 2026 CCP Contributors

### 7.2 References

- [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — Apache-2.0
- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) — MIT
- [everything-claude-code](https://github.com/affaan-m/everything-claude-code) — MIT

License texts: [`LICENSES/`](./LICENSES/)

### 7.3 Runtime dependencies

| Package | License | Bundled |
|---|---|:---:|
| `@google/gemini-cli` (≥ 0.38.0) | Apache-2.0 | external (user-installed) |
| `@openai/codex` (≥ 0.122.0) | Apache-2.0 | external (user-installed) |
| Node.js (≥ 20.0) | MIT | external |

No bundled binaries. External API terms (Google Gemini, OpenAI Codex, Anthropic Claude) are each user's responsibility.

---

## 8. Roadmap

Completed in v0.2:

- Router recommendation hook (decision auto-injected on `UserPromptSubmit`)
- 70-case routing regression dataset (including code-review cases)
- Token-saving measurement v0.2 (canonical / headless entry-path split)
- Canonical auto-routing opt-in (`plugin.json#config.auto_routing`)
- Korean routing magic keywords (`@젬` / `@코덱` / `@클로드` / `@자동`)

Under review / backlog:

- SessionEnd hook for background job meta cleanup (on user request)
- Role-based model assignment schema (let users map domains to codex / gemini / claude)
- Single-slash unified flow (background job → poll → result auto-recovery)

Release history: [GitHub Releases](https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases)

---

## 9. Contributing

GitHub Issues and Pull Requests are welcome in either English or Korean. Branch naming: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`. Commits should follow [Conventional Commits](https://www.conventionalcommits.org).

---

**License:** [MIT](./LICENSE) · Third-party license texts: [`LICENSES/`](./LICENSES/) · Korean README: [README.ko.md](./README.ko.md)
