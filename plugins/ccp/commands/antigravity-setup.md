---
description: Verifies Antigravity CLI (`agy`) installation and authentication status, and shows install or re-auth guidance on failure.
argument-hint: "[--renew]"
allowed-tools:
  - Bash
---

# /ccp:antigravity-setup

Verifies Antigravity CLI installation and authentication status. On failure, it shows install or re-auth guidance (target: first successful invocation within 5 minutes for ≥ 90% of new users).

## Usage

```
/ccp:antigravity-setup [--renew]
```

| Argument | Description |
|------|------|
| `--renew` | Re-auth mode guidance (asks the user to run `agy` once to trigger keyring sign-in, or to set `ANTIGRAVITY_API_KEY`) |

## Behavior

1. Verify Node.js version (≥ v20). Emit `CCP-SETUP-002` if below requirement.
2. Run `agy --version`. Emit `CCP-SETUP-001` if missing or below 1.0.0.
3. **Two-stage auth status inference** (Antigravity uses keyring silent-auth; there is no `agy auth status` command):
   - (a) check whether env `ANTIGRAVITY_API_KEY` exists → `auth_method: "api_key"`
   - (b) check whether `~/.gemini/antigravity-cli/` exists → `auth_method: "keyring"`
   - (c) run the probe `agy -p "ping"` → inspect exit code and stderr/stdout for "not logged in" patterns
4. If any step signals invalid auth, emit `CCP-OAUTH-001` with re-auth guidance.
5. If all checks pass, return an envelope with `details: {agy_version, auth_status: "valid", auth_method}`.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" setup
```

## Output (Success)

```json
{
  "summary": "Antigravity CLI installed and authentication valid",
  "result_path": null,
  "tokens": { "input": 0, "output": 0, "estimated": true },
  "exit_code": 0,
  "details": {
    "agy_version": "1.0.2",
    "auth_status": "valid",
    "auth_method": "keyring"
  }
}
```

> **details placement rule:** Store `agy_version`, `auth_status`, and `auth_method` in the `details` subobject rather than at the envelope root to keep slash-command envelopes consistent.

## Error Codes

| Code | Cause | recovery | Recommended response |
|------|------|:---:|----------|
| `CCP-SETUP-001` | Antigravity CLI missing or < 1.0.0 | abort | `curl -fsSL https://antigravity.google/cli/install.sh \| bash`, ensure `~/.local/bin` is on PATH |
| `CCP-SETUP-002` | Node.js < v20 | abort | use nvm or install Node from the official distribution |
| `CCP-OAUTH-001` | Authentication missing or invalid | fallback | run `agy` once interactively (keyring sign-in) or set `ANTIGRAVITY_API_KEY`, then rerun `/ccp:antigravity-setup` |

## Acceptance Criteria

- Respond within 60 seconds (cold start ≈ 11 s).
- First-call success rate ≥ 90%.
- On error, provide guidance that makes the next action immediately clear.

## Spec SSOT

- `plugins/ccp/scripts/core/runtime.mjs:handleSetup`
- `plugins/ccp/scripts/adapters/antigravity.mjs` `bin` / `version` (CLI discovery + version-check config)
- `plugins/ccp/schemas/envelope.schema.json` (envelope contract)
