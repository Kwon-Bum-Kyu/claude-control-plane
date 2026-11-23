#!/usr/bin/env node
// node entry.mjs <role> <subcommand> [...args]
// Resolves a role from ccp.json and drives the REAL plugin core with it.
// Built-in runner keys with no flag in the real adapter are passed on as flags
// (every role key becomes `--<kebab-key>`) and the real core answers; nothing is dropped here.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../../../plugins/ccp/scripts/core/runtime.mjs';
import { emitError } from '../../../plugins/ccp/scripts/core/envelope.mjs';
import { mergeErrorCatalog } from '../../../plugins/ccp/scripts/core/errors.mjs';
import { renderArgv } from '../variant-b/resolve.mjs';
import { createRunnerAdapter } from './runner-adapter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTERS = join(HERE, '..', '..', '..', 'plugins', 'ccp', 'scripts', 'adapters');
const CATALOG = {
  ...mergeErrorCatalog({}),
  'CCP-ROLE-001': { message: 'Invalid role configuration', action: 'Fix the role in ccp.json.', recovery: 'abort' },
  'CCP-ROLE-002': { message: 'Not supported in stage 2', action: 'Use a role with a single codex, antigravity or declared runner.', recovery: 'abort' },
};
const die = (code, message, action) => emitError(CATALOG, code, { message, action });

const [roleName, sub, ...rest] = process.argv.slice(2);
if (!roleName || !sub) die('CCP-INVALID-001', 'Usage: entry.mjs <role> <subcommand> [...args]', 'Pass a role name and a subcommand.');

let config;
const configPath = process.env.CCP_ROLE_CONFIG || join(HERE, '..', 'variant-b', 'ccp.json');
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  die('CCP-ROLE-001', `Cannot read the role config: ${err.message}`, 'Check CCP_ROLE_CONFIG or variant-b/ccp.json.');
}

const role = config.roles?.[roleName];
if (!role || typeof role !== 'object' || Array.isArray(role)) die('CCP-ROLE-001', `role "${roleName}" is not defined in the config`, 'Add it under "roles".');
if (role.targets !== undefined) die('CCP-ROLE-002', `role "${roleName}" has "targets" (fan-out); multi-target roles are not supported in stage 2`, 'Use a single-runner role.');
if (typeof role.runner !== 'string') die('CCP-ROLE-001', `role "${roleName}" needs "runner" or "targets"`, 'Add a "runner" string.');

const entryOpts = { entryScriptPath: fileURLToPath(import.meta.url), workerArgsPrefix: [roleName] };
const kebab = (k) => k.replace(/_/g, '-');

if (role.runner === 'claude') {
  die('CCP-ROLE-002', `role "${roleName}" uses the built-in runner "claude", which has no adapter in stage 2`, 'Use codex, antigravity or a declared runner.');
} else if (role.runner === 'codex' || role.runner === 'antigravity') {
  const adapter = (await import(pathToFileURL(join(ADAPTERS, `${role.runner}.mjs`)).href)).default;
  const flags = [];
  if (sub === 'rescue') { // role values first, so flags typed on the command line win (last one parsed wins)
    for (const [k, v] of Object.entries(role)) {
      if (k === 'runner' || v === false) continue;
      flags.push(`--${kebab(k)}`);
      if (v !== true) flags.push(typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }
  run(adapter, [sub, ...flags, ...rest], entryOpts);
} else {
  const def = config.runners?.[role.runner];
  if (!def) die('CCP-ROLE-001', `role "${roleName}": runner "${role.runner}" is neither built-in nor declared in "runners"`, 'Declare it under "runners".');
  if (typeof def.bin !== 'string' || !Array.isArray(def.args)) die('CCP-ROLE-001', `runner "${role.runner}" needs "bin" (string) and "args" (array)`, 'Fix the runner declaration.');
  if (sub === 'rescue') { // fail with an envelope here, not with a throw inside core's buildArgs
    const cli = rest.indexOf('--model');
    const { missing } = renderArgv(def.args, { ...role, ...(cli >= 0 ? { model: rest[cli + 1] } : {}), task: 'x', job_dir: 'x' });
    if (missing.length > 0) die('CCP-ROLE-001', `role "${roleName}": runner "${role.runner}" needs a value for ${missing.map((k) => `{${k}}`).join(', ')}`, `Set it on the role or on the command line.`);
  }
  run(createRunnerAdapter(def, role, roleName), [sub, ...rest], entryOpts);
}
