# Troubleshooting

Every CCP error has a `CCP-<CATEGORY>-<NNN>` code, a one-line `message`, an `action` telling you what to type next, and a `recovery` enum. This page lists the codes you will most likely see, grouped by surface.

## Gemini-side errors

| Code | Frequency | What to do |
|---|:---:|---|
| `CCP-OAUTH-001` | very high | Run `gemini` once to trigger OAuth (or set `GEMINI_API_KEY`), then re-run `/gemini:setup` |
| `CCP-SETUP-001` | very high | `npm install -g @google/gemini-cli@latest` |
| `CCP-SETUP-002` | high | Install Node.js 20+ (nvm recommended) |
| `CCP-GEMINI-001` | high | Retry shortly, or use `/gemini:rescue --fallback-claude` |
| `CCP-CTX-001` | medium | `summary` exceeded 500 chars -- shrink the input |
| `CCP-ROUTER-001` | medium | Run `/ccp:audit` to inspect the router's decision |
| `CCP-COMPACT-001` | medium | Run `/compact` manually |
| `CCP-JOB-001` ... `CCP-JOB-004` | medium | `/gemini:status <job_id>` to recheck job state |

## Codex-side errors

| Code | Frequency | What to do |
|---|:---:|---|
| `CCP-OAUTH-101` | very high | Run `codex login`, then re-run `/ccp:codex-setup` |
| `CCP-SETUP-101` | very high | `brew install codex` or `npm install -g @openai/codex` |
| `CCP-SETUP-102` | high | `brew upgrade codex` (need >= 0.122.0) |
| `CCP-CODEX-001` | high | Inspect stderr in `result_path`, retry, or `--fallback-claude` |
| `CCP-CODEX-002` | medium | JSONL parse failure -- retry with `--verbose` and check stderr |
| `CCP-JOB-001` ... `CCP-JOB-004` | medium | `/ccp:codex-status <job_id>` to recheck |
| `CCP-JOB-409` | low | Job is in a state that cannot be cancelled; check status and retry |
| `CCP-INVALID-001` | low | A Codex-only flag (`--effort`, `--sandbox`, `--write`) was passed to `/gemini:rescue`. Use `/ccp:codex-rescue` instead. |

## Shared errors

| Code | Frequency | What to do |
|---|:---:|---|
| `CCP-TIMEOUT-001` | high | Retry, or run with `--background` (foreground default is 600s) |
| `CCP-AUDIT-001` / `CCP-AUDIT-002` | low | Adjust `--since` window or check the script log |

The full catalog is the `ERROR_CATALOG` constant inside `plugins/ccp/scripts/gemini-companion.mjs` and `codex-companion.mjs`.

## FAQ

**What are the free-tier limits?**
Gemini: ~60 req/min on `gemini-2.5-pro` for free Google accounts; the exact value follows Google's policy.
Codex: included in your ChatGPT Plus/Pro subscription quota; the exact value follows OpenAI's policy.

**How long do OAuth tokens last?**
Google ~7 days, ChatGPT typically 30+ days. Expiration surfaces as `CCP-OAUTH-001` / `CCP-OAUTH-101` automatically.

**`npm i -g` fails with permission errors.**
Use nvm to manage Node, or prefix with `sudo`. nvm is recommended.

**No browser available for login.**
- Gemini: set `GEMINI_API_KEY` (https://aistudio.google.com/apikey).
- Codex: `codex login --device-auth` (device-code flow), or `printenv OPENAI_API_KEY | codex login --with-api-key`.

**`--effort` is rejected by the Gemini side.**
That is intentional. `--effort` is Codex-only. Use `/ccp:codex-rescue --effort high -- "<task>"`. See the [compatibility matrix](./slash-commands.md#three-way-compatibility).

**Codex hangs reading stdin.**
The companion forces `stdio: ['ignore', ...]` to prevent this. If you call `codex exec` manually, append `</dev/null`.

**`Reading additional input from stdin...` appears on stderr.**
Normal Codex CLI behavior. Harmless -- the companion absorbs it.

## Setup checks

Both setup commands are idempotent. Run them whenever you suspect environment drift:

```text
/gemini:setup            # Node + Gemini CLI + OAuth
/gemini:setup --renew    # also re-prompts for OAuth
/ccp:codex-setup         # Node + Codex CLI + OAuth
```

Each prints the version it detected; mismatches against the documented minimums (`Node >= 20`, `Gemini >= 0.38.0`, `Codex >= 0.122.0`) are flagged with a `CCP-SETUP-*` code.

## When to file a bug

If an error code is missing, the action does not match what the message says, or a `CCP-CODEX-*` / `CCP-GEMINI-*` repeats after retry, file a bug using the issue template. Include the envelope JSON and the output of `/gemini:setup` and `/ccp:codex-setup`.

## Related reading

- [Router behavior](./router.md) for `CCP-ROUTER-001`
- [Slash command reference](./slash-commands.md) for `CCP-INVALID-001`
- [Architecture](./architecture.md) for the seven principles, including no-auto-fallback (Principle 4)
