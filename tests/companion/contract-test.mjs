#!/usr/bin/env node
// CCP — core adapter-contract test (extension-contract proof: adding a new
// CLI adapter should require zero changes to core/*.mjs).
//
// Four things this proves, each independently:
//   1. assertAdapter accepts a well-formed third adapter (the mock) and
//      rejects malformed ones — unknown keys, missing required functions.
//   2. The mock adapter drives the *real* core/runtime.mjs dispatch path
//      (setup / rescue foreground+background / status / result /
//      task-worker) end to end, via a subprocess, exactly like the two
//      shipped companions do in golden capture.
//   3. The two shipped adapters' combined surface is exactly the 55-key
//      frozen contract — no more, no less (§2.5's "차집합 0" check, run here
//      so it stays enforced going forward instead of being a one-time audit).
//   4. The rescue `--mcp` pre-check's pure helpers (core/mcp.mjs) and each
//      shipped adapter's list parser behave correctly in isolation, with no
//      subprocess involved.
//
// No plugins/ccp/scripts/core/*.mjs file was modified to add the mock
// adapter used in test 2 — that absence is the extension-contract proof itself.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAdapter } from '../../plugins/ccp/scripts/core/runtime.mjs';
import { parseMcpNames, classifyMcpList, compareMcp } from '../../plugins/ccp/scripts/core/mcp.mjs';
import mockAdapter from './mock/adapter.mjs';
import codexAdapter from '../../plugins/ccp/scripts/adapters/codex.mjs';
import antigravityAdapter from '../../plugins/ccp/scripts/adapters/antigravity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const MOCK_COMPANION = join(HERE, 'mock', 'companion.mjs');
const MOCK_STUB = join(HERE, 'mock', 'stub-cli');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push({ name, detail });
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

// ---------------------------------------------------------------------------
// 1. assertAdapter positive + negative
// ---------------------------------------------------------------------------

console.log('1. assertAdapter — mock adapter shape');

check('valid mock adapter passes assertAdapter', throws(() => assertAdapter(mockAdapter)) === null);

{
  // Unknown-key negative test: a plausible typo (resutlIncompleteCode) must
  // be rejected at load time, not silently ignored.
  const broken = { ...mockAdapter, supports: { ...mockAdapter.supports } };
  delete broken.supports.resultIncompleteCode;
  broken.supports.resutlIncompleteCode = () => 'CCP-JOB-002';
  const err = throws(() => assertAdapter(broken));
  check('unknown key (typo) is rejected', err !== null && /unknown key/.test(err.message), err?.message);
}

{
  // Missing-required-function negative test.
  const broken = { ...mockAdapter, details: { ...mockAdapter.details } };
  delete broken.details.extraFor;
  const err = throws(() => assertAdapter(broken));
  check('missing required function (details.extraFor) is rejected', err !== null && /details\.extraFor/.test(err.message), err?.message);
}

{
  // auth.rescueGate enum negative test.
  const broken = { ...mockAdapter, auth: { ...mockAdapter.auth, rescueGate: 'sometimes' } };
  const err = throws(() => assertAdapter(broken));
  check("auth.rescueGate outside {'detect','probe'} is rejected", err !== null && /rescueGate/.test(err.message), err?.message);
}

{
  // supports.flags shape negative test.
  const broken = { ...mockAdapter, supports: { ...mockAdapter.supports, flags: { bad: { type: 'bool' } } } };
  const err = throws(() => assertAdapter(broken));
  check('supports.flags entry missing `key` is rejected', err !== null && /supports\.flags/.test(err.message), err?.message);
}

{
  // mcp.parseList missing negative test.
  const broken = { ...mockAdapter, mcp: { ...mockAdapter.mcp } };
  delete broken.mcp.parseList;
  const err = throws(() => assertAdapter(broken));
  check('missing required function (mcp.parseList) is rejected', err !== null && /mcp\.parseList/.test(err.message), err?.message);
}

{
  // mcp.installCommand missing negative test.
  const broken = { ...mockAdapter, mcp: { ...mockAdapter.mcp } };
  delete broken.mcp.installCommand;
  const err = throws(() => assertAdapter(broken));
  check('missing required function (mcp.installCommand) is rejected', err !== null && /mcp\.installCommand/.test(err.message), err?.message);
}

{
  // mcp.listArgs empty-array negative test.
  const broken = { ...mockAdapter, mcp: { ...mockAdapter.mcp, listArgs: [] } };
  const err = throws(() => assertAdapter(broken));
  check('empty mcp.listArgs is rejected', err !== null && /mcp\.listArgs/.test(err.message), err?.message);
}

{
  // mcp unknown-key (typo) negative test — original keys kept intact.
  const broken = { ...mockAdapter, mcp: { ...mockAdapter.mcp, listArg: ['--mcp-list'] } };
  const err = throws(() => assertAdapter(broken));
  check('unknown key (mcp.listArg typo) is rejected', err !== null && /unknown key "mcp\.listArg"/.test(err.message), err?.message);
}

// ---------------------------------------------------------------------------
// 2. end-to-end dispatch through the real core, via subprocess
// ---------------------------------------------------------------------------

console.log('\n2. mock adapter — end-to-end dispatch (core/runtime.mjs, unmodified)');

function runMock(args, { mode = 'ok', jobsDir } = {}) {
  const env = { ...process.env, CCP_MOCK_BIN: MOCK_STUB, CCP_MOCK_MODE: mode };
  if (jobsDir) env.CCP_JOBS_DIR = jobsDir;
  const r = spawnSync(process.execPath, [MOCK_COMPANION, ...args], { encoding: 'utf8', env, timeout: 10000 });
  let envelope = null;
  try {
    envelope = JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    /* leave null */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, envelope };
}

{
  const r = runMock(['setup']);
  check('setup succeeds against the stub', r.status === 0 && r.envelope?.summary?.includes('1.2.0'), JSON.stringify(r.envelope));
}

{
  const r = runMock(['setup'], { mode: 'not_installed' });
  check('setup fails with CCP-SETUP-901 when the stub reports not-installed', r.status === 1 && r.envelope?.error?.code === 'CCP-SETUP-901', JSON.stringify(r.envelope));
}

{
  const r = runMock(['rescue', '--', 'hello mock']);
  check(
    'rescue (foreground) runs the stub and returns its response',
    r.status === 0 && r.envelope?.summary === 'mock response: hello mock',
    JSON.stringify(r.envelope)
  );
}

{
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-mock-contract-'));
  try {
    const dispatch = runMock(['rescue', '--background', '--', 'background task'], { jobsDir });
    const jobId = dispatch.envelope?.job_id;
    check('rescue --background returns a job_id', typeof jobId === 'string' && jobId.length > 0, JSON.stringify(dispatch.envelope));

    // Give the detached worker a moment to finish (the stub is synchronous and near-instant).
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 400)']);

    const status = runMock(['status', jobId], { jobsDir });
    check('status reports completed after the worker finishes', status.envelope?.details?.state === 'completed' || status.envelope?.summary?.includes('completed'), JSON.stringify(status.envelope));

    const result = runMock(['result', jobId], { jobsDir });
    check(
      'result returns the worker output',
      result.status === 0 && result.envelope?.summary === 'mock response: background task',
      JSON.stringify(result.envelope)
    );
  } finally {
    rmSync(jobsDir, { recursive: true, force: true });
  }
}

// rescue --mcp pre-check, dispatched through the same stub. Fixture: alpha is
// registered and enabled, beta is registered and disabled, gamma is never
// registered.
const mcpProbeRuns = [];

{
  const r = runMock(['rescue', '--mcp', 'alpha', '--', 'x']);
  mcpProbeRuns.push(r);
  check('rescue --mcp alpha runs the stub once every named server is registered and enabled', r.status === 0 && r.envelope?.summary === 'mock response: x', JSON.stringify(r.envelope));
}

{
  const r = runMock(['rescue', '--mcp', 'gamma', '--', 'x']);
  mcpProbeRuns.push(r);
  const ok =
    r.status === 1 &&
    r.envelope?.error?.code === 'CCP-MCP-001' &&
    r.envelope?.error?.recovery === 'abort' &&
    JSON.stringify(r.envelope?.details?.mcp) === JSON.stringify({ missing: ['gamma'], disabled: [] }) &&
    (r.envelope?.error?.action || '').includes('mock-cli mcp add gamma');
  check('rescue --mcp gamma stops with CCP-MCP-001 when the named server is not registered', ok, JSON.stringify(r.envelope));
}

{
  const r = runMock(['rescue', '--mcp', 'beta', '--', 'x']);
  mcpProbeRuns.push(r);
  const ok =
    r.status === 1 &&
    r.envelope?.error?.code === 'CCP-MCP-001' &&
    JSON.stringify(r.envelope?.details?.mcp) === JSON.stringify({ missing: [], disabled: ['beta'] }) &&
    (r.envelope?.error?.action || '').includes('mock-cli mcp enable beta');
  check('rescue --mcp beta stops with CCP-MCP-001 when the named server is registered but disabled', ok, JSON.stringify(r.envelope));
}

{
  const r = runMock(['rescue', '--mcp', 'alpha', '--', 'x'], { mode: 'mcp_unreadable' });
  mcpProbeRuns.push(r);
  const ok = r.status === 1 && r.envelope?.error?.code === 'CCP-MCP-001' && JSON.stringify(r.envelope?.details?.mcp) === JSON.stringify({ list_error: 'unparseable' });
  check('rescue --mcp alpha stops with CCP-MCP-001 when the server list cannot be parsed', ok, JSON.stringify(r.envelope));
}

{
  const r = runMock(['rescue', '--mcp', 'gamma', '--', 'x'], { mode: 'auth_fail' });
  mcpProbeRuns.push(r);
  check(
    'the MCP pre-check runs before the auth gate, so an auth failure never masks a missing server',
    r.status === 1 && r.envelope?.error?.code === 'CCP-MCP-001',
    JSON.stringify(r.envelope)
  );
}

{
  const r = runMock(['rescue', '--', 'x'], { mode: 'mcp_unreadable' });
  mcpProbeRuns.push(r);
  check(
    'rescue without --mcp never triggers the pre-check, even when the list would be unreadable',
    r.status === 0 && r.envelope?.summary === 'mock response: x',
    JSON.stringify(r.envelope)
  );
}

{
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-mock-mcp-contract-'));
  try {
    const r = runMock(['rescue', '--background', '--mcp', 'gamma', '--', 'x'], { jobsDir });
    mcpProbeRuns.push(r);
    const ok = r.status === 1 && r.envelope?.error?.code === 'CCP-MCP-001' && r.envelope?.job_id === undefined && readdirSync(jobsDir).length === 0;
    check('rescue --background --mcp gamma fails before any job directory is created', ok, JSON.stringify({ error: r.envelope?.error, jobsDirEntries: readdirSync(jobsDir) }));
  } finally {
    rmSync(jobsDir, { recursive: true, force: true });
  }
}

{
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-mock-mcp-canary-'));
  try {
    const r = runMock(['rescue', '--background', '--mcp', 'alpha', '--', 'x'], { jobsDir });
    mcpProbeRuns.push(r);
    // Give the detached worker a moment to finish, then read every job artifact back.
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 400)']);
    const entries = readdirSync(jobsDir, { recursive: true });
    const fileContents = entries.map((entry) => {
      try {
        return readFileSync(join(jobsDir, entry), 'utf8');
      } catch {
        return '';
      }
    });
    const blob = mcpProbeRuns.map((run) => `${run.stdout || ''}${run.stderr || ''}`).join('') + fileContents.join('');
    check('no MCP pre-check run or background job artifact ever carries the fixture canary', !blob.includes('canary-0000'), '(redacted)');
  } finally {
    rmSync(jobsDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. frozen contract surface — union(shipped adapters) === 55-key contract
// ---------------------------------------------------------------------------

console.log('\n3. frozen contract — shipped-adapter surface vs. the 55-key contract');

const NAMESPACES = ['bin', 'version', 'auth', 'supports', 'timeouts', 'result', 'details', 'messages', 'mcp'];

function surfaceKeys(adapter) {
  const out = [];
  for (const [k, v] of Object.entries(adapter)) {
    if (NAMESPACES.includes(k) && v && typeof v === 'object') {
      for (const k2 of Object.keys(v)) out.push(`${k}.${k2}`);
    } else {
      out.push(k);
    }
  }
  return out;
}

// The 55-key frozen adapter contract, transcribed from core/runtime.mjs's
// CONTRACT. Kept as a literal list (not imported from core) so this test
// fails loudly if the two ever drift instead of silently agreeing with itself.
const FROZEN_CONTRACT = [
  'id',
  'bin.envVar', 'bin.candidates', 'bin.fallback',
  'version.args', 'version.pattern', 'version.min', 'version.notInstalledCode', 'version.tooOldCode',
  'auth.probeArgs', 'auth.successPattern', 'auth.failureCode', 'auth.rescueGate', 'auth.detect', 'auth.classifyProbeFailure',
  'supports.subcommands', 'supports.flags', 'supports.rejectFlags', 'supports.jobMetaStatusAlias', 'supports.jobLookupCodes',
  'supports.validateFlagValue', 'supports.resultIncompleteCode', 'supports.validateJobId',
  'knownViolations',
  'argStyle',
  'timeouts.foreground', 'timeouts.background', 'timeouts.authProbe',
  'result.fileName', 'result.pathStyle', 'result.logFileName', 'result.persistForeground',
  'errors',
  'details.allowKeys', 'details.nestErrorDetails', 'details.sanitizeScope', 'details.modeFor', 'details.extraFor',
  'messages.nextAction', 'messages.fallbackSummary', 'messages.missingArg', 'messages.retryHint',
  'messages.statusSummary', 'messages.usage', 'messages.versionTooOld', 'messages.preflightSummary',
  'mcp.listArgs', 'mcp.parseList', 'mcp.installCommand',
  'buildArgs', 'parseResult', 'tokensFrom', 'estimateTokens', 'summarize', 'classifyFailure',
];

{
  const contractSet = new Set(FROZEN_CONTRACT);
  check('frozen contract is exactly 55 keys', contractSet.size === 55, `got ${contractSet.size}`);

  const union = new Set([...surfaceKeys(codexAdapter), ...surfaceKeys(antigravityAdapter)]);
  const unknownInSurface = [...union].filter((k) => !contractSet.has(k));
  const missingFromSurface = [...contractSet].filter((k) => !union.has(k));

  check('shipped-adapter surface has 0 keys outside the contract', unknownInSurface.length === 0, JSON.stringify(unknownInSurface));
  check('shipped-adapter surface covers all 55 contracted keys', missingFromSurface.length === 0, JSON.stringify(missingFromSurface));
  check('union(codex, antigravity) === 55', union.size === 55, `got ${union.size}`);
}

// ---------------------------------------------------------------------------
// 4. MCP pre-check — pure helpers and shipped-adapter list parsers
// ---------------------------------------------------------------------------

console.log('\n4. MCP pre-check — pure helpers and shipped-adapter list parsers');

{
  const got = parseMcpNames(' alpha, ,alpha,beta');
  check('parseMcpNames trims, drops empty items, and de-dupes in input order', JSON.stringify(got) === JSON.stringify(['alpha', 'beta']), JSON.stringify(got));
}

{
  const invalidInputs = [',', '', true, undefined, '--task', 'alpha;x', 'a b', '-x', '.x'];
  const failures = invalidInputs.filter((v) => parseMcpNames(v) !== null).map((v) => JSON.stringify(v));
  check('parseMcpNames rejects every malformed input with null', failures.length === 0, JSON.stringify(failures));
}

{
  const got = compareMcp(['Alpha'], [{ name: 'alpha', enabled: true }]);
  check('compareMcp compares names case-sensitively', JSON.stringify(got) === JSON.stringify({ missing: ['Alpha'], disabled: [] }), JSON.stringify(got));
}

{
  const fixture = [{ name: 'alpha', enabled: true }, { name: 'beta', enabled: false }];
  const got = compareMcp(['alpha', 'beta', 'gamma'], fixture);
  check('compareMcp separates missing names from disabled ones', JSON.stringify(got) === JSON.stringify({ missing: ['gamma'], disabled: ['beta'] }), JSON.stringify(got));
}

{
  const cases = [
    [{ error: { code: 'ETIMEDOUT' }, status: null, signal: 'SIGTERM', stdout: '' }, () => [], { list: null, listError: 'timeout' }],
    [{ error: new Error('ENOENT'), status: null, stdout: '' }, () => [], { list: null, listError: 'spawn_failed' }],
    [{ error: null, status: null, signal: 'SIGKILL', stdout: '' }, () => [], { list: null, listError: 'spawn_failed' }],
    [{ error: null, status: 1, stdout: '' }, () => [], { list: null, listError: 'exit_nonzero' }],
    [{ error: null, status: 0, stdout: 'x' }, () => null, { list: null, listError: 'unparseable' }],
    [{ error: null, status: 0, stdout: 'x' }, () => [], { list: [], listError: null }],
  ];
  const failures = cases
    .map(([run, parseList, expected]) => ({ got: classifyMcpList(run, parseList), expected }))
    .filter(({ got, expected }) => JSON.stringify(got) !== JSON.stringify(expected));
  check('classifyMcpList classifies every list-read outcome, and never blocks an empty-but-parsed list', failures.length === 0, JSON.stringify(failures));
}

{
  const got = codexAdapter.mcp.parseList('[]');
  check('codex parseList treats [] as zero registered servers', JSON.stringify(got) === '[]', JSON.stringify(got));
}

{
  const malformed = ['not json', '', '{}', 'null', '[null]', '[{"name":""}]', '[{"enabled":true}]', '[{"name":"a","enabled":"no"}]'];
  const failures = malformed.filter((s) => codexAdapter.mcp.parseList(s) !== null).map((s) => JSON.stringify(s));
  check('codex parseList rejects every malformed stdout (all-or-nothing)', failures.length === 0, JSON.stringify(failures));
}

{
  const stdout =
    '[{"name":"alpha","enabled":true,"transport":{"type":"stdio","command":"fixture-server --key canary-0000"}},' +
    '{"name":"beta","enabled":false,"transport":{"type":"streamable_http","url":"https://example.invalid/mcp","http_headers":{"Authorization":"Bearer canary-0000"}}}]';
  const got = codexAdapter.mcp.parseList(stdout);
  const expected = [{ name: 'alpha', enabled: true }, { name: 'beta', enabled: false }];
  const shapeOk = JSON.stringify(got) === JSON.stringify(expected);
  const keysOk = Array.isArray(got) && got.every((e) => JSON.stringify(Object.keys(e)) === JSON.stringify(['name', 'enabled']));
  const noCanary = !JSON.stringify(got).includes('canary-0000');
  const defaulted = codexAdapter.mcp.parseList('[{"name":"a"}]');
  const defaultOk = JSON.stringify(defaulted) === JSON.stringify([{ name: 'a', enabled: true }]);
  check(
    'codex parseList reads only name/enabled from the fixture, drops the canary, and defaults a missing enabled to true',
    shapeOk && keysOk && noCanary && defaultOk,
    JSON.stringify({ got, shapeOk, keysOk, noCanary, defaulted })
  );
}

{
  const a = antigravityAdapter.mcp.parseList('No MCP servers configured.\n');
  const b = antigravityAdapter.mcp.parseList('no mcp servers configured');
  check('antigravity parseList treats the empty-state sentence as zero servers', JSON.stringify(a) === '[]' && JSON.stringify(b) === '[]', JSON.stringify({ a, b }));
}

{
  const table = 'NAME   TYPE   STATUS    COMMAND/URL\nalpha  stdio  enabled   fixture-server\nbeta   http   disabled  https://example.invalid/mcp?key=canary-0000';
  const got = antigravityAdapter.mcp.parseList(table);
  const codexEquivalent = codexAdapter.mcp.parseList('[{"name":"alpha","enabled":true},{"name":"beta","enabled":false}]');
  const convergesOk = JSON.stringify(got) === JSON.stringify(codexEquivalent);
  const noCanary = !JSON.stringify(got).includes('canary-0000');

  const ansiTable =
    'NAME   TYPE   STATUS    COMMAND/URL\nalpha  stdio  \x1b[32menabled\x1b[0m   fixture-server\nbeta   http   disabled  https://example.invalid/mcp';
  const ansiGot = antigravityAdapter.mcp.parseList(ansiTable);
  const ansiOk = JSON.stringify(ansiGot) === JSON.stringify(got);

  const headerOnly = antigravityAdapter.mcp.parseList('NAME   TYPE   STATUS    COMMAND/URL');
  const headerOnlyOk = JSON.stringify(headerOnly) === '[]';

  check(
    'antigravity parseList converges with codex on the same servers, drops the canary, strips ANSI SGR codes, and treats a header with no rows as zero servers',
    convergesOk && noCanary && ansiOk && headerOnlyOk,
    JSON.stringify({ got, convergesOk, noCanary, ansiGot, ansiOk, headerOnly, headerOnlyOk })
  );
}

{
  const malformed = [
    '',
    'unexpected output',
    'NAME   TYPE   STATUS    COMMAND/URL\nalpha  stdio  starting  fixture-server',
    'NAME   TYPE   STATUS    COMMAND/URL\nalpha  stdio',
    'No MCP servers configured.\nextra',
  ];
  const failures = malformed.filter((s) => antigravityAdapter.mcp.parseList(s) !== null).map((s) => JSON.stringify(s));
  check('antigravity parseList rejects every malformed stdout', failures.length === 0, JSON.stringify(failures));
}

{
  const failures = [];
  for (const adapter of [codexAdapter, antigravityAdapter]) {
    const { register, enable } = adapter.mcp.installCommand('x');
    const ok =
      typeof register === 'string' && register.length > 0 && register.includes('x') &&
      typeof enable === 'string' && enable.length > 0 && enable.includes('x') && /mcp enable x$/.test(enable);
    if (!ok) failures.push({ id: adapter.id, register, enable });
  }
  check('both adapters\' installCommand returns non-empty register/enable commands naming the server', failures.length === 0, JSON.stringify(failures));
}

// ---------------------------------------------------------------------------

console.log(`\nResult: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(fail > 0 ? 1 : 0);
