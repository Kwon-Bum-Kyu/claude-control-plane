#!/usr/bin/env node
/**
 * Behavior check of the SubagentStop hook that finalizes orphaned job records.
 *
 * Each case writes job records into a fresh temporary job directory
 * (CCP_JOBS_DIR), runs the hook as a child process, and checks its exit code,
 * its stdout, and every record afterwards. Liveness uses real processes: this
 * test's own pid is alive, and the pid of a child that has already exited and
 * been reaped is dead. Age boundaries sit 60 seconds either side of each limit
 * so scheduling delays cannot flip a case. The default-limit cases take the
 * largest timeout the two adapters declare, so an adapter timeout that drifts
 * away from the hook's default fails this test.
 *
 * Every case directory also holds a control record that must be finalized,
 * which proves the hook actually scanned the directory instead of exiting
 * early.
 *
 * One case also runs the codex companion's result lookup on a record the hook
 * finalized, and checks that it reports the failure code with the hook's error
 * instead of reporting the job as still running. That companion is always the
 * one in this checkout, whichever hook is tested.
 *
 * Usage:  node tests/hooks/rescue-finalize-test.mjs [path-to-hook]
 *         (default: plugins/ccp/hooks/rescue-finalize.js)
 * Exit:   0 when there are no failures, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import codex from '../../plugins/ccp/scripts/adapters/codex.mjs';
import antigravity from '../../plugins/ccp/scripts/adapters/antigravity.mjs';

const GRACE_MS = 300000;
const MARGIN_MS = 60000;
const DEFAULT_TIMEOUT_MS = Math.max(...[codex, antigravity].flatMap((a) => [a.timeouts.foreground, a.timeouts.background]));
const LIVE_PID = process.pid;
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
const DEAD_PID = deadPid();
const CODEX_COMPANION = fileURLToPath(new URL('../../plugins/ccp/scripts/codex-companion.mjs', import.meta.url));
const DEFAULT_HOOK = fileURLToPath(new URL('../../plugins/ccp/hooks/rescue-finalize.js', import.meta.url));
const HOOK = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_HOOK;
const FAILED_ERROR = { code: 'CCP-TIMEOUT-001', reason: 'orphan_subagent_stop' };

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR2 = 2 * 3600 * 1000;

function codexRecord({ pid, startedAgo, params = {}, state = 'running' }) {
  return {
    job_id: 'fixture', mode: 'codex', state, created_at: ago(startedAgo), started_at: ago(startedAgo),
    completed_at: null, pid, exit_code: null, prompt: 'fixture', params, claude_session_id: null,
    stdout_path: 'stdout.log', stderr_path: 'stderr.log', result_path: null, error: null,
  };
}
const agyBgRecord = (o) => ({ ...codexRecord(o), mode: 'antigravity', status: o.state ?? 'running' });
function agyFgRecord({ startedAgo, params = {} }) {
  return {
    job_id: 'fixture', mode: 'antigravity', state: 'running', status: 'running', prompt: 'fixture', params,
    created_at: ago(startedAgo), started_at: ago(startedAgo), completed_at: null, result_path: null,
    summary_3lines: null, token_usage: null, error: null,
  };
}
const legacyRecord = ({ startedAgo }) => ({
  id: 'fixture', status: 'running', mode: 'foreground', started_at: ago(startedAgo), result_file_path: null,
});
const control = () => agyFgRecord({ startedAgo: HOUR2, params: {} });

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Returns a failure detail, or null when `after` is a correct finalization of `before`. */
function finalizedProblem(before, after) {
  for (const k of ['state', 'status']) {
    if (Object.hasOwn(before, k) && after[k] !== 'failed') return `${k} is ${JSON.stringify(after[k])}, expected failed`;
    if (!Object.hasOwn(before, k) && Object.hasOwn(after, k)) return `${k} key was added`;
  }
  if (typeof after.completed_at !== 'string' || !Number.isFinite(Date.parse(after.completed_at))) return 'completed_at is not a date';
  if (!same(after.error, FAILED_ERROR)) return `error is ${JSON.stringify(after.error)}`;
  const added = Object.keys(after).filter((k) => !Object.hasOwn(before, k));
  if (added.some((k) => !['completed_at', 'error'].includes(k))) return `unexpected new keys: ${added}`;
  const skip = new Set(['state', 'status', 'completed_at', 'error']);
  for (const k of Object.keys(before)) if (!skip.has(k) && !same(before[k], after[k])) return `${k} changed`;
  return null;
}

function runHook(jobsDir, { stdin, hook } = {}) {
  return spawnSync(process.execPath, [hook ?? HOOK], {
    input: stdin ?? JSON.stringify({ hook_event_name: 'SubagentStop', cwd: jobsDir }),
    env: { ...process.env, CCP_JOBS_DIR: jobsDir }, encoding: 'utf8', timeout: 20000,
  });
}
const runCompanion = (jobsDir, args) => spawnSync(process.execPath, [CODEX_COMPANION, ...args], {
  env: { ...process.env, CCP_JOBS_DIR: jobsDir }, encoding: 'utf8', timeout: 20000,
});

let pass = 0;
let fail = 0;
function report(name, problem) {
  if (problem) { fail++; console.log(`  FAIL ${name} — ${problem}`); } else { pass++; console.log(`  ok   ${name}`); }
}

const gone = () => {
  try { process.kill(DEAD_PID, 0); return 'pid still exists'; } catch (e) { return e.code === 'ESRCH' ? null : `kill 0 gave ${e.code}`; }
};
const pre = gone();
report('precondition: dead pid is gone', pre);
if (pre) { console.log(`Result: ${pass} pass, ${fail} fail`); process.exit(1); }

/**
 * records: { dirName: object | raw string }. expect: 'unchanged' | 'finalized' | 'raw' (bytes unchanged)
 * for the target `job-<n>`. Control record is always checked unless noControl.
 */
function scenario(name, { record, expect, stdin, extra, hook, jobsDirMissing, after, dir = 'job-x' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ccp-finalize-'));
  try {
    const jobsDir = jobsDirMissing ? join(root, 'nope') : join(root, 'jobs');
    const target = join(jobsDir, dir);
    const ctl = join(jobsDir, 'zz-control');
    const metaOf = (d) => join(d, 'meta.json');
    const ctlBefore = control();
    let before;
    let beforeBytes;
    if (!jobsDirMissing) {
      mkdirSync(target, { recursive: true });
      mkdirSync(ctl, { recursive: true });
      beforeBytes = typeof record === 'string' ? record : JSON.stringify(record, null, 2);
      writeFileSync(metaOf(target), beforeBytes);
      writeFileSync(metaOf(ctl), JSON.stringify(ctlBefore, null, 2));
      before = typeof record === 'string' ? null : record;
      extra?.(jobsDir);
    }
    const r = runHook(jobsDir, { stdin, hook });
    if (r.status !== 0) return report(name, `exit ${r.status}`);
    if (r.stdout !== '{}') return report(name, `stdout ${JSON.stringify(r.stdout)}`);
    if (jobsDirMissing) return report(name, existsSync(jobsDir) ? 'jobs dir was created' : null);
    const cProblem = finalizedProblem(ctlBefore, read(metaOf(ctl)));
    if (cProblem) return report(name, `control record: ${cProblem}`);
    const bytes = readFileSync(metaOf(target), 'utf8');
    let problem = null;
    if (expect === 'unchanged') problem = bytes === beforeBytes ? null : 'record was modified';
    else problem = finalizedProblem(before, JSON.parse(bytes));
    if (!problem && after) problem = after(jobsDir);
    return report(name, problem);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const LIMIT_540 = 540000 + GRACE_MS;
const LIMIT_DEF = DEFAULT_TIMEOUT_MS + GRACE_MS;

scenario('codex record, dead worker, started 10s ago: finalized without a status key',
  { record: codexRecord({ pid: DEAD_PID, startedAgo: 10000 }), expect: 'finalized' });
scenario('codex record, live worker, started 2h ago: unchanged',
  { record: codexRecord({ pid: LIVE_PID, startedAgo: HOUR2 }), expect: 'unchanged' });
scenario('antigravity background record, dead worker, started 10s ago: both keys finalized',
  { record: agyBgRecord({ pid: DEAD_PID, startedAgo: 10000 }), expect: 'finalized' });
scenario('antigravity background record, live worker, started 2h ago: unchanged',
  { record: agyBgRecord({ pid: LIVE_PID, startedAgo: HOUR2 }), expect: 'unchanged' });
scenario('no pid, timeoutMs 540000, 60s before the limit: unchanged',
  { record: agyFgRecord({ startedAgo: LIMIT_540 - MARGIN_MS, params: { timeoutMs: 540000 } }), expect: 'unchanged' });
scenario('no pid, timeoutMs 540000, 60s past the limit: finalized',
  { record: agyFgRecord({ startedAgo: LIMIT_540 + MARGIN_MS, params: { timeoutMs: 540000 } }), expect: 'finalized' });
scenario('no pid, no timeoutMs, 60s before the default limit: unchanged',
  { record: agyFgRecord({ startedAgo: LIMIT_DEF - MARGIN_MS }), expect: 'unchanged' });
scenario('no pid, no timeoutMs, 60s past the default limit: finalized',
  { record: agyFgRecord({ startedAgo: LIMIT_DEF + MARGIN_MS }), expect: 'finalized' });

for (const v of [0, -60000, '60000', null]) {
  const params = { timeoutMs: v };
  scenario(`no pid, timeoutMs ${JSON.stringify(v)}, 60s before the default limit: unchanged`,
    { record: agyFgRecord({ startedAgo: LIMIT_DEF - MARGIN_MS, params }), expect: 'unchanged' });
  scenario(`no pid, timeoutMs ${JSON.stringify(v)}, 60s past the default limit: finalized`,
    { record: agyFgRecord({ startedAgo: LIMIT_DEF + MARGIN_MS, params }), expect: 'finalized' });
}

scenario('legacy record with status only, past the default limit: status finalized, no state key',
  { record: legacyRecord({ startedAgo: HOUR2 }), expect: 'finalized' });
for (const s of ['completed', 'failed', 'cancelled', 'queued']) {
  scenario(`${s} record with a dead pid, started 2h ago: unchanged`,
    { record: agyBgRecord({ pid: DEAD_PID, startedAgo: HOUR2, state: s }), expect: 'unchanged' });
}
{
  const { started_at, ...noStart } = agyFgRecord({ startedAgo: HOUR2 });
  scenario('no pid, no started_at: unchanged', { record: noStart, expect: 'unchanged' });
}
scenario('no pid, unparseable started_at: unchanged',
  { record: { ...agyFgRecord({ startedAgo: HOUR2 }), started_at: 'not a date' }, expect: 'unchanged' });
scenario('corrupt meta.json: left as is, other records still processed',
  { record: '{"state": "running",', expect: 'unchanged' });
scenario('meta.json holding null: left as is, other records still processed',
  { record: 'null', expect: 'unchanged' });
scenario('non-directory entry: skipped, other records still processed', {
  record: codexRecord({ pid: LIVE_PID, startedAgo: HOUR2 }), expect: 'unchanged',
  extra: (d) => writeFileSync(join(d, 'stray.txt'), 'stray'),
  after: (d) => (readFileSync(join(d, 'stray.txt'), 'utf8') === 'stray' ? null : 'stray file modified'),
});
scenario('job directory does not exist: exit 0 with {}', { jobsDirMissing: true });
scenario('empty stdin: exit 0 with {}, records still processed',
  { record: codexRecord({ pid: LIVE_PID, startedAgo: HOUR2 }), expect: 'unchanged', stdin: '' });
scenario('malformed stdin: exit 0 with {}, records still processed',
  { record: codexRecord({ pid: LIVE_PID, startedAgo: HOUR2 }), expect: 'unchanged', stdin: '{not json' });

// Hook copied where its sibling modules do not exist: both dynamic imports fail.
{
  const copyRoot = mkdtempSync(join(tmpdir(), 'ccp-finalize-hook-'));
  try {
    mkdirSync(join(copyRoot, 'hooks'));
    const copy = join(copyRoot, 'hooks', 'rescue-finalize.mjs');
    copyFileSync(HOOK, copy);
    scenario('process module unavailable: records with a pid left untouched',
      { record: agyBgRecord({ pid: DEAD_PID, startedAgo: HOUR2 }), expect: 'unchanged', hook: copy });
  } finally {
    rmSync(copyRoot, { recursive: true, force: true });
  }
}

scenario('codex record finalized by the hook: result lookup reports CCP-JOB-004 with the hook\'s error', {
  record: codexRecord({ pid: DEAD_PID, startedAgo: 10000 }), expect: 'finalized', dir: 'job-31',
  after: (jobsDir) => {
    const r = runCompanion(jobsDir, ['result', 'job-31']);
    let out = {};
    try { out = JSON.parse(r.stdout.trim()); } catch { /* reported below */ }
    if (r.status !== 1) return `companion exit ${r.status}`;
    if (out.error?.code !== 'CCP-JOB-004') return `error.code ${out.error?.code}`;
    if (out.details?.state !== 'failed') return `details.state ${out.details?.state}`;
    return same(out.details?.error, FAILED_ERROR) ? null : `details.error ${JSON.stringify(out.details?.error)}`;
  },
});

const post = gone();
report('precondition: dead pid stayed gone', post);
console.log(`Result: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
