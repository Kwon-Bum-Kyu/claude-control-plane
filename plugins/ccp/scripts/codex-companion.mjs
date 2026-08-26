#!/usr/bin/env node
// CCP — thin alias for the codex CLI. Kept as its own file (instead of only
// `companion.mjs codex ...`) so existing settings.json permission patterns and
// command/agent specs that reference this filename stay valid.
// Subcommands / envelope contract / error codes: see plugins/ccp/scripts/adapters/codex.mjs.
import { fileURLToPath } from 'node:url';
import { run } from './core/runtime.mjs';
import adapter from './adapters/codex.mjs';

run(adapter, process.argv.slice(2), { entryScriptPath: fileURLToPath(import.meta.url), workerArgsPrefix: [] });
