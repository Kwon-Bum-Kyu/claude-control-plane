---
description: Verifies Gemini CLI installation and OAuth status, and shows install or re-auth guidance on failure.
argument-hint: "[--renew]"
allowed-tools:
  - Bash
---

# /gemini:setup

Verifies Gemini CLI installation and OAuth authentication status. On failure, it shows install or re-auth guidance (AC-3 — first successful invocation within 5 minutes for ≥ 90% of new users).

## Usage

```
/gemini:setup [--renew]
```

| Argument | Description |
|------|------|
| `--renew` | Re-auth mode guidance (asks the user to run `gemini auth login`) |

## Behavior

1. Verify Node.js version (≥ v20). Emit `CCP-SETUP-002` if below requirement.
2. Run `gemini --version`. Emit `CCP-SETUP-001` if missing or below 0.38.0.
3. **Three-stage OAuth status inference** (`gemini auth status` is unsupported — R17 correction):
   - (a) check whether env `GEMINI_API_KEY` exists → `auth_method: "api_key"`
   - (b) check whether `~/.gemini/google_accounts.json` exists → `auth_method: "oauth"`
   - (c) run the probe `gemini -p "ping" -o json` → inspect exit code and stderr
4. If any step signals expired OAuth, emit `CCP-OAUTH-001` with re-auth guidance.
5. If all checks pass, return an envelope with `details: {gemini_version, oauth_status: "valid", auth_method}`.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup
```

## Output (Success)

```json
{
  "summary": "Gemini CLI installed and authentication valid",
  "result_path": null,
  "tokens": { "input": 0, "output": 0 },
  "exit_code": 0,
  "details": {
    "gemini_version": "0.38.2",
    "oauth_status": "valid",
    "auth_method": "oauth"
  }
}
```

> **S2-5 details placement rule (`_workspace/01_schema.md` §2.1):** Store `gemini_version`, `oauth_status`, and `auth_method` in the `details` subobject rather than at the envelope root to keep slash-command envelopes consistent.

## Error Codes

| Code | Cause | recovery | Recommended response |
|------|------|:---:|----------|
| `CCP-SETUP-001` | Gemini CLI missing or < 0.38.0 | abort | `npm install -g @google/gemini-cli@latest` |
| `CCP-SETUP-002` | Node.js < v20 | abort | use nvm or install Node from the official distribution |
| `CCP-OAUTH-001` | OAuth credentials missing or expired | fallback | run `gemini auth login`, then rerun `/gemini:setup` |

## Acceptance Criteria (PRD §7)

- Respond within 5 seconds.
- First-call success rate ≥ 90% (AC-3).
- On error, provide guidance that makes the next action immediately clear.

## Spec SSOT

- `_workspace/01_command_spec.md` §"/gemini:setup"
- `_workspace/03_gemini_cli_probe.md` §T4 (evidence that `gemini auth status` is unsupported)
- `_workspace/01_error_messages.md` `CCP-SETUP-001`, `CCP-SETUP-002`, `CCP-OAUTH-001`
- `_workspace/01_onboarding.md` (UX flow)
