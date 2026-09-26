# Getting started

For an overview of CCP and the problem it solves, see the [README](../../README.en.md). This document explains how to install and authenticate the Antigravity CLI and the Codex CLI, and then run your first delegation.

## Prerequisites

- Node.js 20.19 or later is required (22.7 or later for the 22 series). The 4 hooks and the audit script use ESM syntax in `.js` files, relying on Node's module auto-detection.
- The Antigravity CLI (`agy`) must be 1.0.0 or later.
- The Codex CLI must be 0.122.0 or later.
- To use Antigravity delegation, either run `agy` interactively once to log in, or set the `ANTIGRAVITY_API_KEY` environment variable.
- To use Codex delegation, complete ChatGPT account authentication with `codex login`.
- The `setup` command checks only the Node.js major version. The 20.19 and 22.7 figures above are patch-level recommendations; the code does not enforce a check down to the patch version.

See the [README](../../README.en.md) for how to install the plugin (marketplace registration, install, and reload commands).

## Installing and authenticating the CLIs

### Antigravity CLI

Install it with the following command.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

After installation, confirm that `~/.local/bin` is included in `PATH`. There are two ways to authenticate.

- Run `agy` interactively once to log in.
- Set the `ANTIGRAVITY_API_KEY` environment variable.

### Codex CLI

Install it with one of the following.

```bash
brew install codex
```

```bash
npm install -g @openai/codex
```

Log in to your ChatGPT account with `codex login`. You can check the login status with `codex login status`. CCP reuses this command internally to determine whether you are authenticated.

## Verifying the install

After installing and authenticating, check the status with the two setup commands in the "Installation" section of the [README](../../README.en.md). See the "What setup checks" section of the [Troubleshooting](./troubleshooting.md) document for the order and content of what setup checks, and how it differs from the authentication check before a rescue call.

## Your first delegation

Delegation can run in two modes: foreground and background.

### Foreground delegation

```text
/ccp:antigravity-rescue "Summarize this log file"
```

It runs synchronously. When it completes, you get a response with the summary and the result file path immediately. See [Slash commands](./slash-commands.md) for the full flag list, their meaning, and the response format.

### Background jobs

```text
/ccp:antigravity-rescue "Summarize this log file" --background
```

Adding `--background` returns a response with a job identifier immediately, and the job keeps running in a separate process. Use the following two commands to check its progress and result.

```text
/ccp:antigravity-status <job_id>
/ccp:antigravity-result <job_id>
```

`status` checks whether the job has finished. `result` retrieves the summary and the result file path after the job finishes. See [Slash commands](./slash-commands.md) for both commands' arguments and response format.

### Delegating a code review

```text
/ccp:codex-rescue "Review this change's diff and find potential bugs"
```

Codex is strong at code review, bug investigation, and diff analysis. See [Slash commands](./slash-commands.md) for the meaning of Codex-only flags such as `--effort`, `--sandbox`, `--cwd`, and `--model`.

## Configuration and security

### Environment variables

| Variable | Purpose |
|------|------|
| `CCP_JOBS_DIR` | Forces the job storage directory to an absolute path. Takes priority over every other path resolution. |
| `CLAUDE_PROJECT_DIR` | The priority-1 value for determining the project root. |
| `CLAUDE_PROJECT_ROOT` | The priority-2 value for determining the project root. |
| `CLAUDE_PLUGIN_ROOT` | The plugin's own install path. Not used in job path resolution. |
| `CCP_AGY_BIN` | Overrides the `agy` binary path. |
| `CCP_CODEX_BIN` | Overrides the `codex` binary path. |
| `CCP_AGY_SKIP_PERMISSIONS` | An opt-out variable that turns off the automatic `--dangerously-skip-permissions` attachment. |
| `CCP_ENVELOPE_STRICT` | If `1`, throws an exception when the response format's self-validation fails. The default is to log a warning to stderr and continue. |
| `ANTIGRAVITY_API_KEY` | Authenticates Antigravity via API key. |
| `CLAUDE_SESSION_ID` | Recorded in the background job's metadata as the identifier of the calling session. Falls back to the parent process ID if absent. |
| `CI` | One of the headless-environment signals. |
| `CLAUDE_CODE_NONINTERACTIVE` | One of the headless-environment signals. |
| `CLAUDE_CODE_ENTRYPOINT` | One of the headless-environment signals. If it has a value and that value is not `cli`, it is judged headless. |

### Antigravity tool-permission auto-approval

Antigravity delegation attaches `--dangerously-skip-permissions` to both foreground and background calls by default. This flag auto-approves every tool-permission request the delegated `agy` model raises. In non-interactive execution mode there is no one to respond to the request, so without this flag every task that needs a tool is rejected and fails.

When handling untrusted input, such as content fetched from an external network, files outside the project, or content you did not write yourself, it is a good idea to also use the `--sandbox` flag. It limits the access scope of auto-approved tool calls. The exact behavior of `--sandbox` differs by CLI, so see [Slash commands](./slash-commands.md) for details.

To turn off auto-approval entirely, set the environment variable `CCP_AGY_SKIP_PERMISSIONS` to `0` before invoking the command. `false` and `no` mean the same thing and are case-insensitive. With this set, any task that needs a tool falls back to waiting for approval and fails.

## Next

- [Slash commands](./slash-commands.md)
- [Router](./router.md)
- [Architecture](./architecture.md)
- [Troubleshooting](./troubleshooting.md)
