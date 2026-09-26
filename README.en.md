# Claude Control Plane (CCP)

> A Claude Code plugin that keeps Claude as the main control plane and delegates work to the Antigravity CLI and Codex CLI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

The Korean README is available at [한국어 README](./README.md).

## Overview

When Claude processes large context (codebases, logs, documentation) on its own, the main session burns through tokens quickly. CCP delegates this work to the Antigravity CLI and Codex CLI. It returns only a short summary and a result file path to the main session, preventing token accumulation.

There are three delegation paths: Claude itself, the Antigravity CLI for large-scale summarization and analysis, and the Codex CLI for code review and diff analysis. The router looks at signals such as input size and keywords in the request and suggests the appropriate path. By default it does not delegate automatically. Delegation happens only when the user specifies a slash command directly, or when the `auto_routing` setting is turned on. See the [Router](./docs/en/router.md) document for how the decision is made.

Antigravity delegation auto-approves the tool permissions agy requests by default. See the "Configuration and security" section of the [Getting started](./docs/en/getting-started.md) document for how to turn this off.

## Installation

Run the following commands to install the plugin and reload it.

```
/plugin marketplace add Kwon-Bum-Kyu/claude-control-plane
/plugin install ccp@claude-control-plane
/reload-plugins
```

Run the following commands to check the install and authentication status of the CLI you want to use.

```
/ccp:antigravity-setup
/ccp:codex-setup
```

See the [Getting started](./docs/en/getting-started.md) document for the Node.js version requirement and each CLI's install and authentication steps.

## Quick start

The following command delegates a summarization task to Antigravity.

```
/ccp:antigravity-rescue "Summarize the core structure of this repository"
```

The following command delegates a code review to Codex.

```
/ccp:codex-rescue "Review this PR's diff and point out potential bugs"
```

In both examples, only the summary and the result file path return to the main session. See the [Slash commands](./docs/en/slash-commands.md) document for the rest of the usage.

## Documentation

- [Getting started](./docs/en/getting-started.md): covers prerequisites, CLI installation and authentication, first delegation examples, and configuration and security.
- [Slash commands](./docs/en/slash-commands.md): documents the command list, flags, and the response envelope.
- [Router](./docs/en/router.md): documents how the 3-way routing decision works.
- [Architecture](./docs/en/architecture.md): documents the design principles and delegation path.
- [Troubleshooting](./docs/en/troubleshooting.md): documents error codes and frequently asked questions.

See the [CONTRIBUTING.md](./CONTRIBUTING.md) document for how to contribute.

Licensed under [MIT](./LICENSE).
