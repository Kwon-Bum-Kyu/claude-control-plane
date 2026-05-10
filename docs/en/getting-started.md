# Getting started with CCP

CCP (Claude Control Plane) is a Claude Code plugin that keeps Claude as the main control plane and offloads heavy-context work to Gemini CLI (large summaries, log analysis) and Codex CLI (code review, diff analysis, bug investigation). The delegated CLIs run as subagents; only a short summary plus a result-file path enters Claude's main context, so token usage stays bounded.

This page walks you through the five-minute setup and the four canonical samples.

## Prerequisites

- Claude Code v2.1+
- Node.js >= 20.0
- For Gemini delegation: Gemini CLI >= 0.38.0 and a Google account
- For Codex delegation: Codex CLI >= 0.122.0 and a ChatGPT account

You only need the CLI for the side(s) you actually want to use. Both setups are independent.

## Install

```text
/plugin marketplace add Kwon-Bum-Kyu/claude-control-plane
/plugin install ccp@claude-control-plane
/gemini:setup        # diagnoses Gemini CLI and OAuth
/ccp:codex-setup     # diagnoses Codex CLI and OAuth
```

The two `setup` commands inspect Node.js, the upstream CLI, and OAuth state. If anything is missing they print the exact remediation command. Typical install commands the setups will reference:

```bash
# Gemini
npm install -g @google/gemini-cli@latest
gemini                            # first interactive run triggers Google OAuth in your browser
# (alternative) export GEMINI_API_KEY="..."   # https://aistudio.google.com/apikey

# Codex
npm install -g @openai/codex
# or: brew install codex           # macOS
codex login                       # opens a browser for ChatGPT auth
# (no browser?) codex login --device-auth
# (API key?)    printenv OPENAI_API_KEY | codex login --with-api-key
```

## Gemini authentication modes (OAuth vs API key)

Gemini CLI supports two distinct authentication paths, and they have **different free-tier quotas and model availability**:

| Mode | Login | Free-tier quota | Pro models? |
|---|---|---|---|
| **OAuth** (Code Assist for individuals) | First `gemini` run opens a browser | 60 RPM / 1,000 RPD aggregated across all models | Limited (default routing is Flash; `gemini-2.5-pro` typically requires paid Google AI Pro/Ultra as of 2026-04) |
| **API key** (AI Studio) | `export GEMINI_API_KEY="..."` | Per-model limits (Flash 10 RPM / 250 RPD, Flash-Lite 15 RPM / 1,000 RPD, etc.) | Pro requires paid tier |

Pick OAuth for casual interactive use; pick API key when you want predictable per-model quotas or are running headless. CCP detects whichever you set up.

## Confirm the install

Run a small request that exercises the router:

```text
/gemini:rescue "summarize the README of this repository in three lines"
```

You should see a three-line summary, an estimated token saving, and a `result_path` pointing into `_workspace/_jobs/`. If you do not, jump to [troubleshooting](./troubleshooting.md).

## Four canonical samples

### 1. Small input — let the router learn

```text
/gemini:rescue "summarize the README of this repository in three lines"
```

The router weighs input size and keywords and picks Claude or Gemini accordingly. For tiny inputs it usually keeps the work on Claude.

### 2. Large input — background job

```text
/gemini:rescue --background "from /var/log/app/error.log extract the top 10 5xx errors in the last 24 hours"
```

The companion returns a `job_id` immediately. Track and collect with:

```text
/gemini:status <job_id>
/gemini:result <job_id>
```

The full Gemini output is written to disk; only the bounded summary returns to Claude.

### 3. Code review — Codex

```text
/ccp:codex-rescue --cwd $(pwd) -- "review this PR's git diff and identify five potential bugs"
```

Codex handles the heavy review reasoning. The main Claude context only sees the `<= 500` character summary and a `result_path`.

### 4. Audit token savings

```text
/ccp:audit --since 7d
```

Produces a Markdown (or JSON) report scoring eight categories: `context_efficiency`, `cost_efficiency`, `router_accuracy`, `double_billing`, `fallback_health`, `plugin_compat`, `borrowed_code_documented`, `secret_leak`.

## What to read next

- [Router behavior](./router.md) — how the four-axis decision works and how to influence it
- [Slash command reference](./slash-commands.md) — every command, flag, and exit code
- [Architecture](./architecture.md) — the seven design principles and the envelope schema
- [Troubleshooting](./troubleshooting.md) — error codes (`CCP-OAUTH-001`, `CCP-SETUP-001`, ...) and their remediations
