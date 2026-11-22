#!/usr/bin/env node
// CCP — core adapter-contract test (extension-contract proof: adding a new
// CLI adapter should require zero changes to core/*.mjs).
//
// Five things this proves, each independently:
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
//   5. Flag declarations: the parsers classify tokens against each adapter's
//      declared flags, and the two real companions reject an undeclared flag
//      with CCP-INVALID-001 (run against the stub CLIs, never a real one).
//
// No plugins/ccp/scripts/core/*.mjs file was modified to add the mock
// adapter used in test 2 — that absence is the extension-contract proof itself.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterJobsForCurrentSession, currentSessionId } from '../../plugins/ccp/scripts/core/jobs.mjs';
import { assertAdapter } from '../../plugins/ccp/scripts/core/runtime.mjs';
import { parseArgsForAdapter } from '../../plugins/ccp/scripts/core/args.mjs';
import { killPid } from '../../plugins/ccp/scripts/core/process.mjs';
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

function runMock(args, { mode = 'ok', jobsDir, extraEnv = {}, unsetEnv = [], timeout = 10000 } = {}) {
  const env = { ...process.env };
  for (const k of unsetEnv) delete env[k];
  Object.assign(env, { CCP_MOCK_BIN: MOCK_STUB, CCP_MOCK_MODE: mode }, extraEnv);
  if (jobsDir) env.CCP_JOBS_DIR = jobsDir;
  const r = spawnSync(process.execPath, [MOCK_COMPANION, ...args], { encoding: 'utf8', env, timeout });
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

// Poll a background job's meta.json until it leaves queued/running, or the
// deadline passes. A fixed sleep would tie the test to the runner's load.
function waitForTerminalMeta(jobsDir, jobId, deadlineMs) {
  const metaPath = join(jobsDir, jobId, 'meta.json');
  const deadline = Date.now() + deadlineMs;
  let meta = null;
  while (Date.now() < deadline) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      meta = null;
    }
    if (meta && meta.state !== 'queued' && meta.state !== 'running') return meta;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 250)']);
  }
  return meta;
}

// Kill a detached worker's whole process group so a still-hanging stub child
// goes down with it; fall back to the pid alone if the group is already gone.
function killWorker(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

{
  // A spawnSync timeout sends SIGTERM. A CLI that traps it and exits with its
  // own status (instead of dying from the signal) must still be reported as a
  // timeout, not as a generic run failure.
  const r = runMock(['rescue', '--timeout-ms', '5000', '--', 'slow task'], { mode: 'hang_trap_sigterm', timeout: 20000 });
  check(
    'rescue (foreground) reports CCP-TIMEOUT-001 when the stub traps SIGTERM and exits on its own',
    r.status === 1 && r.envelope?.error?.code === 'CCP-TIMEOUT-001',
    JSON.stringify(r.envelope)
  );
}

{
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-mock-contract-'));
  let workerPid = null;
  try {
    // No --timeout-ms: the detached worker must fall back to the adapter's
    // timeouts.background (5000ms here), not to the foreground value (30000ms).
    const dispatch = runMock(['rescue', '--background', '--', 'slow background task'], { mode: 'hang_trap_sigterm', jobsDir });
    const jobId = dispatch.envelope?.job_id;
    workerPid = dispatch.envelope?.details?.pid ?? null;
    // The stub's 5000ms timeout plus worker startup must finish well inside this deadline.
    const meta = waitForTerminalMeta(jobsDir, jobId, 20000);
    check(
      'background worker falls back to timeouts.background when --timeout-ms is absent',
      meta?.state === 'failed',
      JSON.stringify({ state: meta?.state ?? null })
    );
    check(
      'background worker reports CCP-TIMEOUT-001 when the stub traps SIGTERM and exits on its own',
      meta?.error?.code === 'CCP-TIMEOUT-001',
      JSON.stringify(meta?.error ?? null)
    );
  } finally {
    killWorker(workerPid);
    rmSync(jobsDir, { recursive: true, force: true });
  }
}

{
  // The stricter case: the CLI prints partial output and reports *success*
  // (exit 0) from its SIGTERM handler. The worker must still record a
  // timeout, never a completed job built from the partial output.
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-mock-contract-'));
  let workerPid = null;
  try {
    const dispatch = runMock(['rescue', '--background', '--', 'slow background task'], { mode: 'hang_trap_sigterm', jobsDir, extraEnv: { CCP_MOCK_TRAP_EXIT: '0' } });
    const jobId = dispatch.envelope?.job_id;
    workerPid = dispatch.envelope?.details?.pid ?? null;
    const meta = waitForTerminalMeta(jobsDir, jobId, 20000);
    check(
      'background worker reports CCP-TIMEOUT-001 even when the stub exits 0 with partial output on SIGTERM',
      meta?.state === 'failed' && meta?.error?.code === 'CCP-TIMEOUT-001',
      JSON.stringify({ state: meta?.state ?? null, error: meta?.error ?? null })
    );
  } finally {
    killWorker(workerPid);
    rmSync(jobsDir, { recursive: true, force: true });
  }
}

// cancel must reach the delegated CLI, not only the detached worker that waits on it.
{
  const root = mkdtempSync(join(tmpdir(), 'ccp-mock-cancel-'));
  const jobsDir = join(root, 'jobs');
  const pidFile = join(root, 'stub.pid');
  let workerPid = null;
  let stubPid = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
  try {
    const dispatch = runMock(['rescue', '--background', '--timeout-ms', '60000', '--', 'x'], { mode: 'hang_trap_sigterm', jobsDir, extraEnv: { CCP_MOCK_PID_FILE: pidFile } });
    const jobId = dispatch.envelope?.job_id;
    workerPid = dispatch.envelope?.details?.pid ?? null;
    for (let end = Date.now() + 10000; Date.now() < end && !/^\d+$/.test(readFileOr(pidFile)); ) await sleep(250);
    stubPid = Number.parseInt(readFileOr(pidFile), 10) || null;
    const c = runMock(['cancel', jobId], { jobsDir });
    for (let end = Date.now() + 5000; stubPid && Date.now() < end && !gone(stubPid); ) await sleep(100);
    let state = null;
    try { state = JSON.parse(readFileSync(join(jobsDir, jobId, 'meta.json'), 'utf8')).state; } catch { /* unreadable */ }
    check(
      'cancel stops the delegated CLI along with its worker (whole process group)',
      c.status === 0 && stubPid !== null && gone(stubPid) && state === 'cancelled',
      JSON.stringify({ cancelStatus: c.status, stubPid, stubGone: stubPid ? gone(stubPid) : null, state })
    );
  } finally {
    killWorker(workerPid);
    if (stubPid) { try { process.kill(stubPid, 'SIGKILL'); } catch { /* already gone */ } }
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // A plain child is not a process-group leader: the group signal fails and killPid must signal the pid alone.
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  try {
    await new Promise((r) => child.once('spawn', r));
    const exited = new Promise((r) => child.once('exit', (code, signal) => r(signal)));
    const ret = killPid(child.pid);
    const signal = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    check('killPid falls back to the single pid when the pid does not lead a process group', ret === true && signal === 'SIGTERM', JSON.stringify({ ret, signal }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

{
  // Session id precedence recorded by a background job: the documented
  // CLAUDE_CODE_SESSION_ID, then the older CLAUDE_SESSION_ID, then ppid:<pid>.
  // The inherited values are unset so the result does not depend on the runner.
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-mock-contract-'));
  const unsetEnv = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID'];
  const envs = [{ CLAUDE_CODE_SESSION_ID: 'sess-new' }, { CLAUDE_SESSION_ID: 'sess-old' }, {}, { CLAUDE_CODE_SESSION_ID: 'sess-new', CLAUDE_SESSION_ID: 'sess-old' }];
  const got = [];
  const pids = [];
  try {
    for (const extraEnv of envs) {
      const d = runMock(['rescue', '--background', '--', 'x'], { jobsDir, unsetEnv, extraEnv });
      pids.push(d.envelope?.details?.pid ?? null);
      const meta = waitForTerminalMeta(jobsDir, d.envelope?.job_id, 20000);
      got.push(meta?.claude_session_id ?? null);
    }
    check(
      'background job records CLAUDE_CODE_SESSION_ID, then CLAUDE_SESSION_ID, then ppid:<pid>',
      got[0] === 'sess-new' && got[1] === 'sess-old' && /^ppid:\d+$/.test(String(got[2])) && got[3] === 'sess-new',
      JSON.stringify(got)
    );
  } finally {
    for (const pid of pids) killWorker(pid);
    rmSync(jobsDir, { recursive: true, force: true });
  }
}

{
  const saved = { a: process.env.CLAUDE_CODE_SESSION_ID, b: process.env.CLAUDE_SESSION_ID };
  try {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-a';
    delete process.env.CLAUDE_SESSION_ID;
    const ids = filterJobsForCurrentSession([{ id: 'a', claude_session_id: 'sess-a' }, { id: 'b', claude_session_id: 'sess-b' }, { id: 'n', claude_session_id: null }]).map((j) => j.id);
    check(
      'filterJobsForCurrentSession defaults to currentSessionId()',
      currentSessionId() === 'sess-a' && JSON.stringify(ids) === JSON.stringify(['a', 'n']),
      JSON.stringify({ sid: currentSessionId(), ids })
    );
  } finally {
    if (saved.a === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = saved.a;
    if (saved.b === undefined) delete process.env.CLAUDE_SESSION_ID; else process.env.CLAUDE_SESSION_ID = saved.b;
  }
}

function readFileOr(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
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
// 5. flag declarations — parser classification and the real companions
// ---------------------------------------------------------------------------
// The parsers classify every token against the adapter's declared flags: a
// declared flag is read (also as --name=value), an undeclared one is reported
// by name in `unknown`, and everything after `--` is task text. The real
// companions then reject a reported flag with CCP-INVALID-001 before any CLI
// is started. The stub CLIs are always selected so a real CLI never runs.

console.log('\n5. flag declarations — parser classification and the real companions');

const COMPANIONS = {
  antigravity: join(REPO_ROOT, 'plugins', 'ccp', 'scripts', 'antigravity-companion.mjs'),
  codex: join(REPO_ROOT, 'plugins', 'ccp', 'scripts', 'codex-companion.mjs'),
};
const GOLDEN_STUBS = { antigravity: join(HERE, 'golden', 'stubs', 'agy'), codex: join(HERE, 'golden', 'stubs', 'codex') };
const ADAPTERS = { antigravity: antigravityAdapter, codex: codexAdapter };
const CLIS = ['antigravity', 'codex'];

/** Real companion against the golden stubs (never a real CLI), isolated jobs dir. */
function runCompanion(cli, args, { jobsDir, extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    CCP_JOBS_DIR: jobsDir,
    CCP_AGY_BIN: GOLDEN_STUBS.antigravity, CCP_GOLDEN_AGY_MODE: 'ok',
    CCP_CODEX_BIN: GOLDEN_STUBS.codex, CCP_GOLDEN_CODEX_MODE: 'ok',
    ANTIGRAVITY_API_KEY: 'test-key',
    ...extraEnv,
  };
  const r = spawnSync(process.execPath, [COMPANIONS[cli], ...args], { encoding: 'utf8', env, timeout: 15000 });
  let envelope = null;
  try {
    envelope = JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    /* leave null */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, envelope };
}
/** Error details live at envelope root for codex/mock and under error.details for antigravity. */
const errDetails = (env) => env?.details ?? env?.error?.details ?? null;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const errCode = (r) => r.envelope?.error?.code;
const rejectedWith = (r, flag) => r.status === 1 && errCode(r) === 'CCP-INVALID-001' && errDetails(r.envelope)?.unsupported_flag === flag;

/** Run fn with a private jobs directory that is always removed afterwards. */
function withJobsDir(fn) {
  const jobsDir = mkdtempSync(join(tmpdir(), 'ccp-flags-contract-'));
  try {
    return fn(jobsDir);
  } finally {
    rmSync(jobsDir, { recursive: true, force: true });
  }
}
const readMeta = (jobsDir, id) => JSON.parse(readFileSync(join(jobsDir, id, 'meta.json'), 'utf8'));

// (a) behavior that exists before and after the classification change
{
  const sameFlags = (got, want) => {
    const gk = Object.keys(got).sort();
    const wk = Object.keys(want).sort();
    return JSON.stringify(gk) === JSON.stringify(wk) && gk.every((k) => Object.is(got[k], want[k]));
  };
  const tables = {
    codex: [
      [['rescue', '--mcp', '--', 'x'], { mcp: true }, ['x']],
      [['rescue', '--fallback-claude', '--', 'x'], { fallbackClaude: true }, ['x']],
      [['rescue', '--timeout-ms', '5000', '--', 'x'], { timeoutMs: '5000' }, ['x']],
      [['rescue', '--mcp=alpha', '--', 'x'], { mcp: 'alpha' }, ['x']],
      [['rescue', '--background', '--mcp', 'alpha', '--', 'x'], { background: true, mcp: 'alpha' }, ['x']],
      [['rescue', '--sandbox', 'workspace-write', '--', 'x'], { sandbox: 'workspace-write' }, ['x']],
      [['rescue', '--fallback-claude=false', '--', 'x'], { fallbackClaude: 'false' }, ['x']],
      [['rescue', '--', '--not-a-flag', 'x'], {}, ['--not-a-flag', 'x']],
      [['status', '--job-id', 'abc'], { jobId: 'abc' }, []],
    ],
    antigravity: [
      [['rescue', 'x', '--mcp'], { mcp: undefined }, ['x']],
      [['rescue', '--effort', 'high', 'x'], { effort: true }, ['high', 'x']],
      [['rescue', '--fallback-claude', 'x'], { fallbackClaude: true }, ['x']],
      [['rescue', '--fallback-claude', '--', 'x'], { fallbackClaude: true }, ['x']],
      [['rescue', '--task', 'abc'], { task: 'abc' }, []],
      [['rescue', '--timeout-ms', '1234', '--', 'x'], { timeoutMs: 1234 }, ['x']],
      [['rescue', '--background', '--mcp', 'alpha', 'x'], { background: true, mcp: 'alpha' }, ['x']],
      [['rescue', '--files', '/etc/passwd', 'golden task'], { files: '/etc/passwd' }, ['golden task']],
      [['rescue', '--', '--x', 'y'], {}, ['--x', 'y']],
      [['status', '--job-id', 'abc'], { jobId: 'abc' }, []],
    ],
  };
  for (const cli of ['codex', 'antigravity']) {
    const bad = [];
    for (const [argv, flags, positional] of tables[cli]) {
      const got = parseArgsForAdapter(ADAPTERS[cli], argv);
      if (!sameFlags(got.flags, flags) || JSON.stringify(got.positional) !== JSON.stringify(positional)) {
        bad.push({ argv, flags: got.flags, positional: got.positional });
      }
    }
    check(`parser keeps the pre-existing behavior for declared flags (${cli})`, bad.length === 0, JSON.stringify(bad));
  }
}

// (b) classification: undeclared flags are reported by name, --name=value is read
{
  const bad = [];
  const expectRow = (cli, argv, want) => {
    const got = parseArgsForAdapter(ADAPTERS[cli], argv);
    const ok =
      (!('flags' in want) || JSON.stringify(got.flags) === JSON.stringify(want.flags)) &&
      (!('positional' in want) || JSON.stringify(got.positional) === JSON.stringify(want.positional)) &&
      (!('unknown' in want) || JSON.stringify(got.unknown) === JSON.stringify(want.unknown)) &&
      (!want.noText || !JSON.stringify(got).includes(want.noText));
    if (!ok) bad.push({ cli, argv, got });
  };
  expectRow('codex', ['rescue', '--background', 'task'], { flags: { background: true }, positional: ['task'], unknown: [] });
  expectRow('codex', ['rescue', '--jobId', 'x', '--', 't'], { unknown: ['--jobId'] });
  expectRow('antigravity', ['rescue', '--timeout-ms=1234', '--task=abc', '--mcp=x'], { flags: { timeoutMs: 1234, task: 'abc', mcp: 'x' }, unknown: [] });
  expectRow('antigravity', ['rescue', '--zzz=1', '--', 't'], { unknown: ['--zzz'] });
  expectRow('antigravity', ['rescue', '--background=false', '--', 't'], { flags: { background: 'false' } });
  expectRow('antigravity', ['rescue', '--model', 'gpt', '--', 't'], { unknown: ['--model'], positional: ['gpt', 't'] });
  expectRow('antigravity', ['rescue', '--constructor', '--', 't'], { unknown: ['--constructor'] });
  for (const cli of CLIS) {
    expectRow(cli, ['rescue', '-x', '--', 't'], { unknown: ['-x'] });
    expectRow(cli, ['rescue', '-', 't'], { positional: ['-', 't'], unknown: [] });
    expectRow(cli, ['rescue', '--', '-x', '--y'], { positional: ['-x', '--y'], unknown: [] });
    expectRow(cli, ['rescue', '--secret=TOPSECRET', '--', 't'], { unknown: ['--secret'], noText: 'TOPSECRET' });
  }
  check('parser reports undeclared flags by name and reads --name=value', bad.length === 0, JSON.stringify(bad));
}

// (c) the real companions
withJobsDir((jobsDir) => {
  const run = (cli, args) => runCompanion(cli, args, { jobsDir });
  {
    const bad = CLIS.map((cli) => ({ cli, r: run(cli, ['rescue', '--zz-undeclared', '--', 'task']) }))
      .filter(({ cli, r }) => !(rejectedWith(r, '--zz-undeclared') && r.envelope.error.message === `\`--zz-undeclared\` is not supported by ${capitalize(cli)}`))
      .map(({ cli, r }) => ({ cli, status: r.status, envelope: r.envelope }));
    check('both companions reject the same undeclared flag with the same code and message shape', bad.length === 0, JSON.stringify(bad));
  }
  {
    const agy = run('antigravity', ['rescue', '--model', 'x', '--', 'task']);
    const cdx = run('codex', ['rescue', '--model', 'x', '--', 'task']);
    check('--model is rejected by antigravity and accepted by codex', rejectedWith(agy, '--model') && cdx.status === 0, JSON.stringify({ agy: agy.envelope, codexStatus: cdx.status, codex: cdx.envelope }));
  }
  {
    const bad = CLIS.map((cli) => ({ cli, r: run(cli, ['rescue', '-x', '--', 'task']) })).filter(({ r }) => !rejectedWith(r, '-x'));
    check('a single-dash token before -- is rejected by both companions', bad.length === 0, JSON.stringify(bad.map(({ cli, r }) => ({ cli, envelope: r.envelope }))));
  }
  {
    const runs = [
      ['antigravity', ['rescue', '--help'], '--help'],
      ['antigravity', ['rescue', '--task', 't', '--cwd-typo', '/tmp'], '--cwd-typo'],
      ['codex', ['rescue', '--help'], '--help'],
      ['codex', ['rescue', '--write', 'task'], '--write'],
    ];
    const bad = runs.map(([cli, args, flag]) => ({ cli, args, flag, r: run(cli, args) })).filter(({ r, flag }) => !rejectedWith(r, flag));
    check('--help and misspelled flags are rejected instead of being delegated or swallowed', bad.length === 0, JSON.stringify(bad.map(({ cli, args, r }) => ({ cli, args, envelope: r.envelope }))));
  }
  {
    const bad = [];
    for (const cli of CLIS) {
      const { flags, rejectFlags } = ADAPTERS[cli].supports;
      const rejected = new Set(rejectFlags.map((rf) => rf.flag.replace(/^--?/, '')));
      const names = Object.keys(flags).filter((n) => !rejected.has(n)).map((n) => `--${n}`).join(', ');
      const want = `Supported flags: ${names}. To pass task text that starts with "-", put it after "--".`;
      const got = run(cli, ['rescue', '--zz-undeclared', '--', 'task']).envelope?.error?.action;
      if (got !== want) bad.push({ cli, got, want });
    }
    check('the supported-flag list in the rejection is built from the adapter declarations', bad.length === 0, JSON.stringify(bad));
  }
  {
    const bad = CLIS.map((cli) => ({ cli, r: run(cli, ['rescue', '--secret=TOPSECRET', '--', 'task']) }))
      .filter(({ r }) => `${r.stdout}${r.stderr}`.includes('TOPSECRET') || !(r.stdout || '').includes('--secret'));
    check('a --name=value rejection never echoes the value', bad.length === 0, JSON.stringify(bad.map(({ cli, r }) => ({ cli, stdout: r.stdout, stderr: r.stderr }))));
  }
});

{
  // Tokens after `--` are task text even when they start with `-`. Each CLI gets its own jobs directory
  // because the check reads the recorded prompt back.
  const prompts = {};
  const notRejected = [];
  withJobsDir((jobsDir) => {
    const r = runCompanion('antigravity', ['rescue', '--', '--not-a-flag', 'task'], { jobsDir });
    if (errCode(r) === 'CCP-INVALID-001') notRejected.push('antigravity');
    const ids = readdirSync(jobsDir);
    prompts.antigravity = ids.length === 1 ? readMeta(jobsDir, ids[0]).prompt : `job dirs: ${ids.length}`;
  });
  withJobsDir((jobsDir) => {
    const r = runCompanion('codex', ['rescue', '--background', '--', '--not-a-flag', 'task'], { jobsDir });
    if (errCode(r) === 'CCP-INVALID-001') notRejected.push('codex');
    const jobId = r.envelope?.job_id;
    if (jobId) {
      waitForTerminalMeta(jobsDir, jobId, 20000);
      prompts.codex = readMeta(jobsDir, jobId).prompt;
    }
  });
  const mock = runMock(['rescue', '--', '--not-a-flag', 'task']);
  check(
    'tokens after -- reach the task even when they start with -',
    prompts.antigravity === '--not-a-flag task' && prompts.codex === '--not-a-flag task' &&
      mock.envelope?.summary === 'mock response: --not-a-flag task' && notRejected.length === 0,
    JSON.stringify({ prompts, notRejected, mock: mock.envelope })
  );
}

{
  const flags = antigravityAdapter.supports.flags;
  const gone = ['summary-only', 'poll-interval-ms', 'renew', 'model'].filter((n) => Object.hasOwn(flags, n));
  const cwdOk = JSON.stringify(flags.cwd) === JSON.stringify({ key: 'cwd', type: 'string' });
  const bad = withJobsDir((jobsDir) =>
    [['--summary-only'], ['--poll-interval-ms', '5'], ['--renew']]
      .map((f) => ({ f, r: runCompanion('antigravity', ['rescue', ...f, '--', 't'], { jobsDir }) }))
      .filter(({ f, r }) => !rejectedWith(r, f[0]))
      .map(({ f, r }) => ({ f, envelope: r.envelope })));
  check('antigravity no longer declares the no-op flags and declares --cwd', gone.length === 0 && cwdOk && bad.length === 0, JSON.stringify({ gone, cwd: flags.cwd, bad }));
}

{
  const problems = withJobsDir((jobsDir) => {
    const out = [];
    mkdirSync(join(jobsDir, 'job-a'));
    writeFileSync(join(jobsDir, 'job-a', 'meta.json'), JSON.stringify({
      job_id: 'job-a', mode: 'codex', state: 'completed', created_at: new Date().toISOString(), started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(), pid: null, exit_code: 0, prompt: 'p', params: {}, claude_session_id: null,
      stdout_path: 'stdout.log', stderr_path: 'stderr.log', result_path: null, error: null,
    }));
    const st = runCompanion('codex', ['status', '--job-id', 'job-a'], { jobsDir });
    if (!(st.status === 0 && st.envelope?.details?.state === 'completed' && st.envelope?.details?.job_id === 'job-a')) out.push({ status: st.envelope });
    const rs = runCompanion('codex', ['result', '--job-id', 'job-missing'], { jobsDir });
    if (errCode(rs) !== 'CCP-JOB-001') out.push({ result: rs.envelope });
    for (const f of [['--write'], ['--max-tokens', '5'], ['--summary-only']]) {
      const r = runCompanion('codex', ['rescue', ...f, '--', 't'], { jobsDir });
      if (!rejectedWith(r, f[0])) out.push({ f, envelope: r.envelope });
    }
    return out;
  });
  check('codex keeps --job-id and rejects --write, --max-tokens, --summary-only', problems.length === 0, JSON.stringify(problems));
}

{
  const PATTERN_LINE_RE = (cli) => new RegExp(`^node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/scripts/${cli}-companion\\.mjs" rescue `);
  /** Flags named on the one allowed-pattern line that the adapter does not declare, or rejects. */
  const patternFlagGaps = (text, cli, adapter) => {
    const lines = text.split('\n').filter((l) => PATTERN_LINE_RE(cli).test(l));
    if (lines.length !== 1) return [`pattern lines found: ${lines.length}`];
    const rejected = new Set(adapter.supports.rejectFlags.map((rf) => rf.flag.replace(/^--?/, '')));
    const names = [...lines[0].matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
    return names.filter((n) => !Object.hasOwn(adapter.supports.flags, n) || rejected.has(n));
  };
  const agentText = (cli) => readFileSync(join(REPO_ROOT, 'plugins', 'ccp', 'agents', `${cli}-rescue.md`), 'utf8');
  const gaps = CLIS.map((cli) => ({ cli, gaps: patternFlagGaps(agentText(cli), cli, ADAPTERS[cli]) })).filter((g) => g.gaps.length > 0);
  check("every flag in a rescue subagent's allowed pattern is declared and not rejected", gaps.length === 0, JSON.stringify(gaps));

  const missed = CLIS.filter((cli) => {
    const tampered = agentText(cli).split('\n')
      .map((l) => (PATTERN_LINE_RE(cli).test(l) ? l.replace(' [--background]', ' [--bogus] [--background]') : l))
      .join('\n');
    return !patternFlagGaps(tampered, cli, ADAPTERS[cli]).includes('bogus');
  });
  check('the pattern check catches a flag the adapter does not declare', missed.length === 0, JSON.stringify(missed));
}

{
  const read = (...p) => readFileSync(join(REPO_ROOT, 'plugins', 'ccp', ...p), 'utf8');
  const cmdLines = read('commands', 'antigravity-rescue.md').split('\n').map((l) => l.trimStart());
  const groups = {
    'argument-hint': cmdLines.filter((l) => l.startsWith('argument-hint:')),
    usage: cmdLines.filter((l) => l.startsWith('/ccp:antigravity-rescue <task>')),
    invocation: cmdLines.filter((l) => l.startsWith('node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" rescue')),
  };
  const lacking = Object.entries(groups)
    .filter(([, ls]) => ls.length === 0 || ls.some((l) => !l.includes('[--sandbox]') || !l.includes('[--cwd DIR]')))
    .map(([name]) => name);
  const sharedClaim = read('agents', 'codex-rescue.md').includes('shared by both companions');
  const summaryOnly = read('commands', 'antigravity-result.md').includes('--summary-only');
  check('command and subagent wording matches the declarations', !sharedClaim && !summaryOnly && lacking.length === 0, JSON.stringify({ sharedClaim, summaryOnly, lacking }));
}

check("codex's error catalog no longer carries CCP-UNSUPPORTED-101", !Object.hasOwn(codexAdapter.errors, 'CCP-UNSUPPORTED-101'));

{
  const bad = [];
  for (const cli of CLIS) {
    withJobsDir((jobsDir) => {
      const existing = mkdtempSync(join(tmpdir(), 'ccp-flags-cwd-'));
      try {
        const missing = runCompanion(cli, ['rescue', '--cwd', join(jobsDir, 'no-such-dir'), '--', 'x'], { jobsDir });
        const leftover = readdirSync(jobsDir);
        if (!(missing.status === 1 && errCode(missing) === 'CCP-INVALID-001' &&
          missing.envelope.error.message === 'The `--cwd` directory does not exist or is not a directory' && leftover.length === 0)) {
          bad.push({ cli, missing: missing.envelope, leftover });
        }
        const present = runCompanion(cli, ['rescue', '--cwd', existing, '--', 'x'], { jobsDir });
        if (errCode(present) === 'CCP-INVALID-001') bad.push({ cli, present: present.envelope });
      } finally {
        rmSync(existing, { recursive: true, force: true });
      }
    });
  }
  check('--cwd must name an existing directory on both companions', bad.length === 0, JSON.stringify(bad));
}

withJobsDir((jobsDir) => {
  const bad = [];
  for (const cli of CLIS) {
    const t = runCompanion(cli, ['rescue', '--fallback-claude=true', '--', 'x'], { jobsDir });
    if (!(t.status === 0 && t.envelope?.summary === ADAPTERS[cli].messages.fallbackSummary)) bad.push({ cli, true: t.envelope });
    const f = runCompanion(cli, ['rescue', '--fallback-claude=false', '--', 'x'], { jobsDir });
    if (f.envelope?.summary === ADAPTERS[cli].messages.fallbackSummary || errCode(f) === 'CCP-INVALID-001') bad.push({ cli, false: f.envelope });
  }
  check('--fallback-claude=false and =true mean the same thing on both companions', bad.length === 0, JSON.stringify(bad));
});

// ---------------------------------------------------------------------------

console.log(`\nResult: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(fail > 0 ? 1 : 0);
