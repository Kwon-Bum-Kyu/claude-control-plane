#!/usr/bin/env node
// CCP — core adapter-contract test (extension-contract proof: adding a new
// CLI adapter should require zero changes to core/*.mjs).
//
// Three things this proves, each independently:
//   1. assertAdapter accepts a well-formed third adapter (the mock) and
//      rejects malformed ones — unknown keys, missing required functions.
//   2. The mock adapter drives the *real* core/runtime.mjs dispatch path
//      (setup / rescue foreground+background / status / result /
//      task-worker) end to end, via a subprocess, exactly like the two
//      shipped companions do in golden capture.
//   3. The two shipped adapters' combined surface is exactly the 52-key
//      frozen contract — no more, no less (§2.5's "차집합 0" check, run here
//      so it stays enforced going forward instead of being a one-time audit).
//
// No plugins/ccp/scripts/core/*.mjs file was modified to add the mock
// adapter used in test 2 — that absence is the extension-contract proof itself.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAdapter } from '../../plugins/ccp/scripts/core/runtime.mjs';
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

// ---------------------------------------------------------------------------
// 3. frozen contract surface — union(shipped adapters) === 52-key contract
// ---------------------------------------------------------------------------

console.log('\n3. frozen contract — shipped-adapter surface vs. the 52-key contract');

const NAMESPACES = ['bin', 'version', 'auth', 'supports', 'timeouts', 'result', 'details', 'messages'];

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

// The 52-key frozen adapter contract, transcribed from core/runtime.mjs's
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
  'buildArgs', 'parseResult', 'tokensFrom', 'estimateTokens', 'summarize', 'classifyFailure',
];

{
  const contractSet = new Set(FROZEN_CONTRACT);
  check('frozen contract is exactly 52 keys', contractSet.size === 52, `got ${contractSet.size}`);

  const union = new Set([...surfaceKeys(codexAdapter), ...surfaceKeys(antigravityAdapter)]);
  const unknownInSurface = [...union].filter((k) => !contractSet.has(k));
  const missingFromSurface = [...contractSet].filter((k) => !union.has(k));

  check('shipped-adapter surface has 0 keys outside the contract', unknownInSurface.length === 0, JSON.stringify(unknownInSurface));
  check('shipped-adapter surface covers all 52 contracted keys', missingFromSurface.length === 0, JSON.stringify(missingFromSurface));
  check('union(codex, antigravity) === 52', union.size === 52, `got ${union.size}`);
}

// ---------------------------------------------------------------------------

console.log(`\nResult: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(fail > 0 ? 1 : 0);
