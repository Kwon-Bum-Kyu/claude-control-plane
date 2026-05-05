---
description: Verifies Codex CLI installation and OAuth status, and shows install or re-auth guidance on failure.
argument-hint: ""
allowed-tools:
  - Bash
---

# /ccp:codex-setup

Verifies Codex CLI installation and OAuth authentication status. On failure, it shows install or re-auth guidance.

## Usage

```
/ccp:codex-setup
```

## Behavior

1. Verify Node.js version (≥ v20). Emit `CCP-SETUP-002` if below requirement.
2. Run `codex --version`. Emit `CCP-SETUP-101` if missing, or `CCP-SETUP-102` if below 0.122.0.
3. Run `codex login status` (prints "Logged in using ChatGPT" to stderr). Emit `CCP-OAUTH-101` if unauthenticated.
4. If all checks pass, return an envelope with `details: {codex_version, node_version, mode: "codex"}`.

## Invocation Pattern

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" setup
```

## Output (Success)

```json
{
  "summary": "Codex CLI 0.122.0 auth verified. Logged in using ChatGPT",
  "result_path": null,
  "tokens": { "input": 0, "output": 0, "total": 0 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "codex_version": "0.122.0",
    "node_version": "22.12.0"
  }
}
```

## Error Codes

| Code | Cause | recovery | Recommended response |
|------|------|:---:|----------|
| `CCP-SETUP-101` | Codex CLI not installed | abort | `brew install codex` or `npm install -g @openai/codex` |
| `CCP-SETUP-102` | Codex CLI < 0.122.0 | abort | `brew upgrade codex` or reinstall with npm |
| `CCP-SETUP-002` | Node.js < v20 | abort | use nvm or install Node from the official distribution |
| `CCP-OAUTH-101` | Codex authentication missing | fallback_claude | run `codex login` and retry |

## Acceptance Criteria

- Respond within 5 seconds (`codex login status` typically returns in ~0.1s plus cold-start margin).
- Show actionable guidance on errors.

## Spec SSOT

- `plugins/ccp/scripts/codex-companion.mjs:cmdSetup`
- `plugins/ccp/schemas/envelope.schema.json` (output self-validation)
