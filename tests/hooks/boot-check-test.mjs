#!/usr/bin/env node
/**
 * Behavior check of the SessionStart boot-check hook.
 *
 * Every case runs the hook as a child process in a fresh environment holding
 * only HOME and PATH, both inside a new temporary root, so no CLI installed on
 * the machine running this test can be found. Stub CLIs use an absolute node
 * shebang. Expected messages are computed from the real adapter modules, not
 * copied. Some cases copy the hook and the scripts tree into a temporary tree
 * to add a broken adapter, add a mock adapter, or break a core module.
 *
 * Usage:  node tests/hooks/boot-check-test.mjs
 * Exit:   0 when there are no failures, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import antigravity from '../../plugins/ccp/scripts/adapters/antigravity.mjs';
import codex from '../../plugins/ccp/scripts/adapters/codex.mjs';

const PLUGIN = fileURLToPath(new URL('../../plugins/ccp/', import.meta.url));
const HOOK = join(PLUGIN, 'hooks', 'boot-check.js');
const MOCK_ADAPTER = fileURLToPath(new URL('../companion/mock/adapter.mjs', import.meta.url));
const PREFIX = '[CCP] Startup check: ';

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`ok   - ${name}`); }
  else { fail += 1; console.log(`FAIL - ${name}${detail ? `\n       ${detail}` : ''}`); }
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ccp-boot-'));
  mkdirSync(join(root, 'home', '.local', 'bin'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  return root;
}

function stub(path, { version = '1.0.0', status = 0, sleepMs = 0 }) {
  const body = sleepMs
    ? 'setTimeout(() => {}, ' + sleepMs + ');'
    : 'process.stdout.write(' + JSON.stringify(version + '\n') + '); process.exitCode = ' + status + ';';
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
}
const agyStub = (root, opts) => stub(join(root, 'home', '.local', 'bin', 'agy'), opts);
const codexStub = (root, opts) => stub(join(root, 'bin', 'codex'), opts);
const agyAuth = (root) => mkdirSync(join(root, 'home', '.gemini', 'antigravity-cli'), { recursive: true });

function runHook(root, hook = HOOK) {
  const env = { HOME: join(root, 'home'), PATH: join(root, 'bin') };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [hook], { input: '{}', env, encoding: 'utf8', timeout: 20000 });
  const out = r.stdout ? JSON.parse(r.stdout) : null;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, ms: Date.now() - t0, ctx: out?.hookSpecificOutput?.additionalContext };
}

function copyTree(root) {
  const t = join(root, 'tree');
  mkdirSync(join(t, 'hooks'), { recursive: true });
  copyFileSync(HOOK, join(t, 'hooks', 'boot-check.js'));
  cpSync(join(PLUGIN, 'scripts'), join(t, 'scripts'), { recursive: true });
  return t;
}

const cleanup = [];
const fresh = () => { const r = makeRoot(); cleanup.push(r); return r; };
const agySetup = '/ccp:antigravity-setup';
const codexSetup = '/ccp:codex-setup';

// 1 — neither CLI installed
{
  const r = runHook(fresh());
  check('neither CLI installed: exit 0 with one line naming both setup commands',
    r.status === 0 && r.ctx?.startsWith(PREFIX) && !r.ctx.includes(' · ') && r.ctx.includes(agySetup) && r.ctx.includes(codexSetup), r.stdout);
}

// 2 — only codex installed and sufficient
{
  const root = fresh(); codexStub(root, { version: '0.200.0' });
  const r = runHook(root);
  check('only codex installed: silent, no mention of the other CLI',
    r.status === 0 && r.stdout === '{}' && !/agy|antigravity/i.test(r.stdout), r.stdout);
}

// 3 — agy only, no auth
{
  const root = fresh(); agyStub(root, { version: '1.2.0' });
  const r = runHook(root);
  const want = `${PREFIX}${antigravity.errors[antigravity.auth.failureCode].message} — run \`${agySetup}\``;
  check('agy without authentication: exact auth guidance', r.status === 0 && r.ctx === want, r.stdout);
}

// 4 — agy too old
{
  const root = fresh(); agyStub(root, { version: '0.5.0' }); agyAuth(root);
  const r = runHook(root);
  const msg = antigravity.messages.versionTooOld('0.5.0', antigravity.version.min).message;
  check('agy too old: adapter too-old message only', r.status === 0 && r.ctx === `${PREFIX}${msg} — run \`${agySetup}\``, r.stdout);
}

// 5 — codex too old
{
  const root = fresh(); codexStub(root, { version: '0.50.0' });
  const r = runHook(root);
  const msg = codex.errors[codex.version.tooOldCode].message;
  check('codex too old: adapter too-old message only, no agy mention',
    r.status === 0 && r.ctx === `${PREFIX}${msg} — run \`${codexSetup}\`` && !/agy|antigravity/i.test(r.ctx), r.stdout);
}

// 6 — version probes hang
{
  const root = fresh(); agyStub(root, { sleepMs: 60000 }); codexStub(root, { sleepMs: 60000 });
  const r = runHook(root);
  check('hanging version probes: silent within 15 seconds', r.status === 0 && r.stdout === '{}' && r.ms < 15000, `${r.ms} ms ${r.stdout}`);
}

// 7 — hooks.json
{
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  check('SessionStart hook declares a 15 second timeout', hooks.SessionStart[0].hooks[0].timeout === 15);
  const keep = (cmd) => [{ matcher: '*', hooks: [{ type: 'command', command: cmd }] }];
  check('other hook entries are unchanged',
    JSON.stringify(hooks.UserPromptSubmit) === JSON.stringify(keep('node ${CLAUDE_PLUGIN_ROOT}/hooks/router-suggest.js')) &&
    JSON.stringify(hooks.SubagentStop) === JSON.stringify(keep('node ${CLAUDE_PLUGIN_ROOT}/hooks/rescue-finalize.js')));
}

// 8 — broken adapter file is skipped
{
  const root = fresh(); const t = copyTree(root);
  writeFileSync(join(t, 'scripts', 'adapters', 'broken.mjs'), 'export default {{{ ;\n');
  const base = runHook(fresh());
  const r = runHook(root, join(t, 'hooks', 'boot-check.js'));
  check('adapter with a syntax error is skipped without noise',
    r.status === 0 && r.ctx === base.ctx && r.ctx.includes(codexSetup) && !r.ctx.includes('broken') && !/Error|Node\.js v/.test(r.stderr), r.stderr + r.stdout);
}

// 9 — a new adapter file is checked with no hook change
{
  const root = fresh(); const t = copyTree(root);
  copyFileSync(MOCK_ADAPTER, join(t, 'scripts', 'adapters', 'mock.mjs'));
  const r = runHook(root, join(t, 'hooks', 'boot-check.js'));
  check('added adapter appears in the guidance', r.status === 0 && r.ctx?.includes('/ccp:mock-setup'), r.stdout);
}

// 10 — hook source names no specific CLI
{
  const src = readFileSync(HOOK, 'utf8');
  check('hook source has no CLI name or legacy helper', !/agy|antigravity|codex|resolveAgyBin|detectAuth|agyVersion/i.test(src));
}

// 11 — healthy install
{
  const root = fresh(); agyStub(root, { version: '1.2.0' }); agyAuth(root); codexStub(root, { version: '0.200.0' });
  const r = runHook(root);
  check('both CLIs healthy: silent and fast', r.status === 0 && r.stdout === '{}' && r.ms < 3000, `${r.ms} ms ${r.stdout}`);
}

// 12 — version command fails
{
  const root = fresh(); agyStub(root, { version: '1.2.0' }); agyAuth(root); codexStub(root, { version: '', status: 1 });
  const r = runHook(root);
  check('non-zero version exit counts as not installed and stays silent', r.status === 0 && r.stdout === '{}', r.stdout);
}

// 13 — core module fails to load
{
  const root = fresh(); const t = copyTree(root);
  writeFileSync(join(t, 'scripts', 'core', 'runtime.mjs'), 'export const x = {{{ ;\n');
  const r = runHook(root, join(t, 'hooks', 'boot-check.js'));
  check('unloadable core skips CLI checks quietly', r.status === 0 && r.stdout === '{}' && !/Error|Node\.js v/.test(r.stderr), r.stderr + r.stdout);
}

for (const r of cleanup) rmSync(r, { recursive: true, force: true });
console.log(`Result: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
