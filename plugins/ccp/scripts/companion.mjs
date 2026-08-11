#!/usr/bin/env node
// CCP — unified companion entry point (canonical multi-CLI entry).
// Usage: node companion.mjs <cli> <subcommand> [...args]
//
// This file's only job is CLI-name resolution: it turns `<cli>` into an
// adapter module path and hands everything else to core/runtime.mjs, which
// never sees a literal CLI name. `codex-companion.mjs` (and, once it moves
// onto core, `antigravity-companion.mjs`) are thin aliases that call the
// same runtime with a fixed adapter instead of resolving `<cli>` from argv.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run } from './core/runtime.mjs';
import { mergeErrorCatalog } from './core/errors.mjs';
import { emitError } from './core/envelope.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);

// Adapter ids are file-basenames under adapters/ — keep this strict so a
// hostile-looking argv[0] can never turn into a path-traversal import.
const CLI_NAME_RE = /^[a-z][a-z0-9_-]*$/;

function bootstrapError(code, message, action) {
  // No adapter is resolved yet at this point, so there is nothing to merge —
  // this reuses the shared catalog only.
  emitError(mergeErrorCatalog({}), code, { message, action });
}

async function main() {
  const argv = process.argv.slice(2);
  const cli = argv[0];

  if (!cli || !CLI_NAME_RE.test(cli)) {
    bootstrapError(
      'CCP-INVALID-001',
      `Missing or invalid <cli> argument: ${cli || '(empty)'}`,
      'Usage: node companion.mjs <cli> <subcommand> [...args] — e.g. `node companion.mjs codex rescue "<task>"`.'
    );
    return;
  }

  const adapterPath = join(SCRIPT_DIR, 'adapters', `${cli}.mjs`);
  if (!existsSync(adapterPath)) {
    bootstrapError(
      'CCP-INVALID-001',
      `No adapter registered for cli "${cli}"`,
      'Supported CLIs are the files under scripts/adapters/.'
    );
    return;
  }

  const mod = await import(pathToFileURL(adapterPath).href);
  run(mod.default, argv.slice(1), { entryScriptPath: SCRIPT_PATH, workerArgsPrefix: [cli] });
}

main();
