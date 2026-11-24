#!/usr/bin/env node
// CCP — failure-path and large-output checks for the companion core.
//
// Drives the real companions against one stub CLI (written into a temp dir)
// and compares the foreground envelopes byte for byte, after masking the
// values that change per run (job_id, duration_ms, result_path).
//
// Every check runs in an isolated temp root: CCP_JOBS_DIR, CLAUDE_PROJECT_DIR
// and HOME all point inside it, and the stub is selected through CCP_*_BIN.
// Temp paths and stub file names must not contain the word "timeout": the
// pre-change classifier treated that word in a spawn error as a timeout.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as proc from '../../plugins/ccp/scripts/core/process.mjs';
import * as jobsApi from '../../plugins/ccp/scripts/core/jobs.mjs';
import * as orphan from '../../plugins/ccp/scripts/core/orphan.mjs';
import agy from '../../plugins/ccp/scripts/adapters/antigravity.mjs';
import codex from '../../plugins/ccp/scripts/adapters/codex.mjs';

// Absent until the module exists: a failed import must fail only the checks that need it.
const outcome = await import('../../plugins/ccp/scripts/core/outcome.mjs').catch(() => ({}));

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'plugins', 'ccp', 'scripts');
const COMPANIONS = { agy: join(SCRIPTS, 'antigravity-companion.mjs'), codex: join(SCRIPTS, 'codex-companion.mjs') };

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Temp root, stub CLI, environment
// ---------------------------------------------------------------------------

const ROOT = mkdtempSync(join(tmpdir(), 'ccp-fp-'));
const JOBS = join(ROOT, 'jobs');
const HOME_DIR = join(ROOT, 'home');
mkdirSync(join(HOME_DIR, '.gemini', 'antigravity-cli'), { recursive: true });
mkdirSync(JOBS, { recursive: true });

const MIB = 1024 * 1024;
const TRAP_EXIT = { hang_trap_0: 0, hang_trap_1: 1 };

// One stub for agy, codex and the mock adapter. Output modes never call
// process.exit: macOS pipes write asynchronously, so an exit right after a
// large write would truncate it. The exit code goes through process.exitCode.
const STUB_SOURCE = `
const fs = require('node:fs');
const a = process.argv.slice(2);
const mode = process.env.CCP_STUB_MODE || 'plain';
const bytes = Number(process.env.CCP_STUB_BYTES || 0);
const out = (s) => process.stdout.write(s);
const wait = () => setTimeout(() => {}, 60000); // bounded: a killed parent must not leave this process behind for good
const jsonl = (o) => JSON.stringify(o) + '\\n';
const agentMessage = jsonl({ type: 'item.completed', item: { type: 'agent_message', text: 'stub response' } });
const head = jsonl({ type: 'thread.started', thread_id: '22222222-2222-4222-8222-222222222222' }) + jsonl({ type: 'turn.started' });
const tail = jsonl({ type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 40 } });
const trapExit = { hang_trap_0: 0, hang_trap_1: 1 };
if (a.includes('--version')) {
  if (mode === 'version_hang') wait(); else out('stub 1.200.0\\n');
} else if (a[0] === 'login' && a[1] === 'status') {
  process.stderr.write('Logged in using a test stub\\n');
} else if (a.includes('--auth-check')) {
  out('OK\\n');
} else {
  const codex = a[0] === 'exec';
  if (mode === 'plain') out('plain text response\\n');
  else if (mode === 'plain_log') {
    fs.writeFileSync(a[a.indexOf('--log-file') + 1], 'Created conversation 33333333-3333-4333-8333-333333333333\\n');
    out('plain text response\\n');
  }
  else if (mode === 'jsonl') out(head + agentMessage + tail);
  else if (mode === 'exit2') { process.stderr.write('boom\\n'); process.exitCode = 2; }
  else if (mode === 'self_sigterm') process.kill(process.pid, 'SIGTERM');
  else if (mode === 'hang') wait();
  else if (mode in trapExit) { out('partial output\\n'); process.on('SIGTERM', () => process.exit(trapExit[mode])); wait(); }
  else if (mode === 'big') {
    if (codex) {
      const fixed = Buffer.byteLength(head + agentMessage + tail) + Buffer.byteLength(jsonl({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: '' } }));
      const filler = 'lorem ipsum dolor sit amet '.repeat(Math.ceil(bytes / 27)).slice(0, Math.max(0, bytes - fixed));
      out(head + jsonl({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: filler } }) + agentMessage + tail);
    } else {
      const line = 'the quick brown fox jumps over the lazy dog again and again, with no digits here\\n';
      out(line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes));
    }
  }
}
`;

const STUB = join(ROOT, 'stub-cli');
const STUB_NO_EXEC = join(ROOT, 'stub-cli-noexec');
writeFileSync(STUB, `#!${process.execPath}\n${STUB_SOURCE}`);
writeFileSync(STUB_NO_EXEC, `#!${process.execPath}\n${STUB_SOURCE}`);
chmodSync(STUB, 0o755);
chmodSync(STUB_NO_EXEC, 0o644);

function makeEnv({ mode, bytes, bin = STUB } = {}) {
  const env = { ...process.env };
  for (const k of ['ANTIGRAVITY_API_KEY', 'CCP_AGY_BIN', 'CCP_CODEX_BIN', 'CCP_MOCK_BIN']) delete env[k];
  return {
    ...env,
    CCP_JOBS_DIR: JOBS,
    CLAUDE_PROJECT_DIR: ROOT,
    HOME: HOME_DIR,
    CCP_AGY_BIN: bin,
    CCP_CODEX_BIN: bin,
    CCP_MOCK_BIN: bin,
    CCP_STUB_MODE: mode || 'plain',
    CCP_STUB_BYTES: String(bytes || 0),
  };
}

function parseLast(stdout) {
  try { return JSON.parse((stdout || '').trim().split('\n').pop()); } catch { return null; }
}

/** Run a companion subcommand against the stub. Returns { status, stdout, stderr, envelope }. */
function run(cli, args, opts = {}) {
  const r = spawnSync(process.execPath, [COMPANIONS[cli], ...args], { env: makeEnv(opts), encoding: 'utf8', timeout: 120000, maxBuffer: 64 * MIB });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, envelope: parseLast(r.stdout) };
}

const rescue = (cli, opts = {}, extra = []) => run(cli, ['rescue', ...extra, '--', 'stub task'], opts);

// ---------------------------------------------------------------------------
// Envelope masking (by key, never by value pattern)
// ---------------------------------------------------------------------------

function mask(value) {
  if (Array.isArray(value)) return value.map(mask);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'job_id' && typeof v === 'string') out[k] = '<JOB_ID>';
    else if (k === 'duration_ms' && typeof v === 'number') out[k] = '<MS>';
    else if (k === 'result_path' && typeof v === 'string') {
      const abs = isAbsolute(v) ? v : resolve(ROOT, v);
      const rel = abs.startsWith(JOBS + '/') ? '<JOBS>/' + abs.slice(JOBS.length + 1) : v;
      out[k] = rel.replace(/^<JOBS>\/[^/]+\//, '<JOBS>/<JOB_ID>/');
    } else out[k] = mask(v);
  }
  return out;
}

const masked = (r) => (r.envelope ? JSON.stringify(mask(r.envelope)) : `no envelope: ${(r.stdout || '').slice(0, 200)} ${(r.stderr || '').slice(0, 200)}`);

function checkEnvelope(name, r, expected) {
  const actual = masked(r);
  check(name, actual === expected, `\n    expected ${expected}\n    actual   ${actual}`);
}

// ---------------------------------------------------------------------------
// Background helpers
// ---------------------------------------------------------------------------

function killWorker(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function readMeta(jobId) {
  try { return JSON.parse(readFileSync(join(JOBS, jobId, 'meta.json'), 'utf8')); } catch { return null; }
}

function sleep(ms) { spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]); }

function waitForTerminalMeta(jobId, deadlineMs = 30000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const m = readMeta(jobId);
    if (m && (m.state === 'completed' || m.state === 'failed')) return m;
    sleep(250);
  }
  return readMeta(jobId);
}

/** Dispatch a background job and wait for its terminal meta. Returns { dispatch, jobId, meta }. */
function runBackground(cli, opts = {}, extra = []) {
  const dispatch = run(cli, ['rescue', '--background', ...extra, '--', 'stub task'], opts);
  const jobId = dispatch.envelope?.job_id ?? dispatch.envelope?.details?.job_id ?? null;
  try {
    return { dispatch, jobId, meta: jobId ? waitForTerminalMeta(jobId) : null };
  } finally {
    killWorker(dispatch.envelope?.details?.pid ?? null);
  }
}

// ---------------------------------------------------------------------------
// Foreground envelopes: the shapes every later change must keep
// ---------------------------------------------------------------------------

console.log('Foreground envelopes');

const AGY_FAIL_ACTION = 'Check agy.log in the job directory (the job_id is in the error details), or retry with the main Claude agent.';

checkEnvelope('agy foreground hang reports the timeout envelope', rescue('agy', { mode: 'hang' }, ['--timeout-ms', '5000']),
  '{"error":{"code":"CCP-TIMEOUT-001","message":"The Antigravity response timed out","action":"Retry, or run it asynchronously with `--background`.","recovery":"retry","details":{"mode":"antigravity","job_id":"<JOB_ID>","duration_ms":"<MS>","timeout_ms":5000}},"exit_code":1}');

checkEnvelope('codex foreground SIGTERM-trapping hang reports the timeout envelope', rescue('codex', { mode: 'hang_trap_0' }, ['--timeout-ms', '5000']),
  '{"error":{"code":"CCP-TIMEOUT-001","message":"Codex response timed out","action":"Retry or run asynchronously with `--background`.","recovery":"retry"},"exit_code":1,"details":{"mode":"codex","duration_ms":"<MS>","timeout_ms":5000}}');

checkEnvelope('agy foreground exit 2 reports the run-failure envelope', rescue('agy', { mode: 'exit2' }),
  `{"error":{"code":"CCP-AG-001","message":"Antigravity CLI failed to run","action":"${AGY_FAIL_ACTION}","recovery":"retry","details":{"job_id":"<JOB_ID>","exit_code":2}},"exit_code":1}`);

checkEnvelope('agy foreground spawn EACCES reports the run-failure envelope with a null exit code', rescue('agy', { bin: STUB_NO_EXEC }),
  `{"error":{"code":"CCP-AG-001","message":"Antigravity CLI failed to run","action":"${AGY_FAIL_ACTION}","recovery":"retry","details":{"job_id":"<JOB_ID>","exit_code":null}},"exit_code":1}`);

checkEnvelope('codex foreground exit 2 reports the run-failure envelope', rescue('codex', { mode: 'exit2' }),
  '{"error":{"code":"CCP-CODEX-001","message":"Failed to run Codex CLI","action":"Check stderr logs or retry in Claude.","recovery":"retry"},"exit_code":1,"details":{"mode":"codex","exit_code":2,"stderr_head":"boom\\n"}}');

checkEnvelope('codex foreground plain text reports the parse-error envelope', rescue('codex', { mode: 'plain' }),
  '{"error":{"code":"CCP-CODEX-002","message":"Could not find a valid JSONL event in the Codex response","action":"Check details.stdout_head (the first 200 characters Codex printed), then retry or handle it in Claude.","recovery":"retry"},"exit_code":1,"details":{"mode":"codex","stdout_head":"plain text response\\n"}}');

checkEnvelope('agy foreground plain text reports the success envelope', rescue('agy', { mode: 'plain' }),
  '{"summary":"plain text response","result_path":"<JOBS>/<JOB_ID>/result.md","tokens":{"input":0,"output":5,"estimated":true},"exit_code":0,"details":{"mode":"antigravity","job_id":"<JOB_ID>","antigravity_conversation_id":null}}');

checkEnvelope('codex foreground JSONL reports the success envelope', rescue('codex', { mode: 'jsonl' }),
  '{"summary":"stub response","result_path":null,"tokens":{"input":120,"cached":20,"output":40,"total":140},"exit_code":0,"details":{"mode":"codex","codex_thread_id":"22222222-2222-4222-8222-222222222222","duration_ms":"<MS>","model":null}}');

// ---------------------------------------------------------------------------
// Output size cap
// ---------------------------------------------------------------------------

console.log('\nLarge output');

const BIG = 2 * MIB + MIB / 4; // 2.25 MiB: over the old 1 MiB limit, far under the cap
const fileSize = (p) => { try { return statSync(isAbsolute(p) ? p : resolve(ROOT, p)).size; } catch { return -1; } };

{
  Object.assign(process.env, { CCP_STUB_MODE: 'big', CCP_STUB_BYTES: String(2 * MIB) });
  const r = proc.runSync({ bin: STUB, args: ['task'], timeoutMs: 60000 });
  check('runSync returns a 2 MiB output unchanged', r.status === 0 && r.error === null && r.stdout.length === 2 * MIB, `status=${r.status} error=${r.error?.code} len=${r.stdout.length}`);
  check('MAX_OUTPUT_BYTES is 256 MiB', proc.MAX_OUTPUT_BYTES === 256 * MIB, String(proc.MAX_OUTPUT_BYTES));
}

{
  const r = rescue('agy', { mode: 'big', bytes: BIG });
  const e = r.envelope;
  const rp = e?.result_path;
  check('agy foreground returns a success envelope for a 2.25 MiB output', !e?.error && e?.exit_code === 0 && e?.summary?.length <= 500 && (e.summary.length < 500 || e.summary_truncated === true), JSON.stringify(e)?.slice(0, 300));
  check('agy foreground result file holds every output byte', typeof rp === 'string' && fileSize(rp) === BIG, `size=${typeof rp === 'string' ? fileSize(rp) : rp}`);
  const meta = e?.details?.job_id ? readMeta(e.details.job_id) : null;
  check('agy foreground meta is completed', meta?.state === 'completed', JSON.stringify(meta)?.slice(0, 200));
}

{
  const { meta } = runBackground('agy', { mode: 'big', bytes: BIG });
  const rp = meta?.result_path;
  check('agy background completes a 2.25 MiB output without an error', meta?.state === 'completed' && meta.exit_code === 0 && !meta.error, JSON.stringify(meta)?.slice(0, 300));
  check('agy background result file holds every output byte', typeof rp === 'string' && fileSize(rp) === BIG, `size=${typeof rp === 'string' ? fileSize(rp) : rp}`);
}

{
  const fg = rescue('codex', { mode: 'big', bytes: BIG });
  check('codex foreground returns a success envelope for a 2.25 MiB JSONL output', !fg.envelope?.error && fg.envelope?.exit_code === 0 && !/CCP-TIMEOUT-001/.test(fg.stdout), (fg.stdout || '').slice(0, 300));
  const { meta, dispatch } = runBackground('codex', { mode: 'big', bytes: BIG });
  check('codex background completes a 2.25 MiB JSONL output without a timeout code', meta?.state === 'completed' && !meta.error && !/CCP-TIMEOUT-001/.test(dispatch.stdout), JSON.stringify(meta)?.slice(0, 300));
}

// ---------------------------------------------------------------------------
// Run judgement (pure)
// ---------------------------------------------------------------------------

console.log('\nRun judgement');

{
  const R = (o) => ({ status: 0, stdout: '', stderr: '', signal: null, error: null, ...o });
  const JSONL = '{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n';
  const adapters = [['agy', agy, 'CCP-AG-001'], ['codex', codex, 'CCP-CODEX-001']];
  const judge = (a, r) => { try { return outcome.judgeRun(a, r); } catch (e) { return { kind: `threw: ${e.message}` }; } };
  const patch = (o, r, ms = 7) => { try { return outcome.failedMetaPatch(o, r, ms); } catch (e) { return { threw: e.message }; } };
  const is = (name, got, kind, code) => check(name, got.kind === kind && (code === undefined || got.code === code), JSON.stringify(got).slice(0, 200));

  for (const [n, a] of adapters) is(`${n}: ETIMEDOUT is judged a timeout`, judge(a, R({ status: null, error: { code: 'ETIMEDOUT' } })), 'timeout', 'CCP-TIMEOUT-001');
  for (const [n, a, c] of adapters) {
    for (const [what, error] of [['ENOENT', { code: 'ENOENT', message: 'spawnSync x ENOENT' }], ['EACCES', { code: 'EACCES', message: 'spawnSync x EACCES' }], ['an error message naming a timeout', { code: 'EPERM', message: 'timed out timeout' }]]) {
      is(`${n}: spawn error (${what}) is a run failure`, judge(a, R({ status: null, error })), 'failure', c);
    }
    is(`${n}: exit status 2 is a run failure`, judge(a, R({ status: 2, stderr: 'boom\n' })), 'failure', c);
    is(`${n}: an external SIGTERM is a run failure, not a timeout`, judge(a, R({ status: null, signal: 'SIGTERM' })), 'failure', c);
    is(`${n}: ENOBUFS with exit 0 (the CLI trapped SIGTERM) is a run failure, not a success`, judge(a, R({ status: 0, stdout: JSONL, error: { code: 'ENOBUFS' } })), 'failure', c);
    is(`${n}: ENOBUFS is a run failure`, judge(a, R({ status: null, signal: 'SIGTERM', error: { code: 'ENOBUFS' } })), 'failure', c);
  }
  is('codex: exit 0 with plain text is a parse error', judge(codex, R({ stdout: 'plain text\n' })), 'parse', 'CCP-CODEX-002');
  is('codex: exit 0 with empty stdout is a parse error', judge(codex, R()), 'parse', 'CCP-CODEX-002');
  const empty = judge(agy, R());
  check('agy: exit 0 with empty stdout is a success with an empty body', empty.kind === 'success' && empty.parsed?.body === '', JSON.stringify(empty).slice(0, 200));
  is('agy: exit 0 with plain text is a success', judge(agy, R({ stdout: 'plain\n' })), 'success');
  is('codex: exit 0 with JSONL is a success', judge(codex, R({ stdout: JSONL })), 'success');
  for (const [n, a] of adapters) is(`${n}: ETIMEDOUT wins over exit 0 with parseable output`, judge(a, R({ status: 0, stdout: JSONL, error: { code: 'ETIMEDOUT' } })), 'timeout');

  const p1 = patch({ kind: 'timeout', code: 'CCP-TIMEOUT-001' }, R({ status: 0, error: { code: 'ETIMEDOUT' } }));
  check('failedMetaPatch has exactly the failed-record keys and an ISO completed_at',
    Object.keys(p1).sort().join() === 'completed_at,duration_ms,error,exit_code,state' && p1.state === 'failed' && p1.duration_ms === 7 &&
    typeof p1.completed_at === 'string' && new Date(p1.completed_at).toISOString() === p1.completed_at && p1.error?.code === 'CCP-TIMEOUT-001' && p1.error.stderr_head === '', JSON.stringify(p1));

  const t = { kind: 'timeout', code: 'CCP-TIMEOUT-001' };
  const f = { kind: 'failure', code: 'CCP-AG-001' };
  check('meta exit_code: a timeout never records 0 (0 to 1, null to 1, 9 stays 9)',
    patch(t, R({ status: 0 })).exit_code === 1 && patch(t, R({ status: null })).exit_code === 1 && patch(t, R({ status: 9 })).exit_code === 9);
  check('meta exit_code: a run failure never records 0', patch(f, R({ status: 0, error: { code: 'ENOBUFS' } })).exit_code === 1);

  const ea = patch(f, R({ status: null, error: { code: 'EACCES' } }));
  check('a spawn failure records exit_code 1 and spawn_code EACCES', ea.exit_code === 1 && ea.error.spawn_code === 'EACCES', JSON.stringify(ea));
  const noSpawn = [patch(f, R({ status: 2 })), patch(f, R({ status: null, signal: 'SIGTERM' })), patch(t, R({ status: null, error: { code: 'ETIMEDOUT' } })), patch({ kind: 'parse', code: 'CCP-CODEX-002' }, R())];
  check('exit status, signal, timeout and parse records carry no spawn_code', noSpawn.every((x) => x.error && !('spawn_code' in x.error)), JSON.stringify(noSpawn));

  const pe = patch({ kind: 'parse', code: 'CCP-CODEX-002' }, R({ stderr: 'x'.repeat(600) }));
  check('a parse error records exit_code 0, its own code and a 500-char stderr_head', pe.exit_code === 0 && pe.error?.code === 'CCP-CODEX-002' && pe.error.stderr_head.length === 500, JSON.stringify(pe).slice(0, 200));
}

// ---------------------------------------------------------------------------
// Runs recorded the same way in the foreground and in the background worker
// ---------------------------------------------------------------------------

console.log('\nRun records');

const AG_FAIL = 'CCP-AG-001';
const CX_FAIL = 'CCP-CODEX-001';
const CX_PARSE = 'CCP-CODEX-002';
const TIMEOUT = 'CCP-TIMEOUT-001';
const hasNo = (o, key) => !!o && !(key in o);
const sub = (s) => JSON.stringify(s)?.slice(0, 300);
const errCode = (r) => r.envelope?.error?.code;
const fgMeta = (r) => {
  const id = r.envelope?.details?.job_id ?? r.envelope?.error?.details?.job_id;
  return id ? readMeta(id) : null;
};
const bgFailed = (meta, code, exit) => meta?.state === 'failed' && meta.error?.code === code && meta.exit_code === exit && typeof meta.duration_ms === 'number';

const BIG_CAP = proc.MAX_OUTPUT_BYTES + 4 * MIB;
{
  const fg = rescue('agy', { mode: 'big', bytes: BIG_CAP });
  check('agy foreground over the output cap reports a run failure, not a timeout', !!fg.envelope && errCode(fg) === AG_FAIL && !/CCP-TIMEOUT-001|timed out/i.test(fg.stdout || ''), sub(fg.envelope) || (fg.stderr || '').slice(0, 200));
}
{
  const { meta, dispatch } = runBackground('codex', { mode: 'big', bytes: BIG_CAP });
  check('codex background over the output cap records a failed run with spawn_code ENOBUFS', bgFailed(meta, CX_FAIL, 1) && meta.error.spawn_code === 'ENOBUFS' && !/CCP-TIMEOUT-001/.test(dispatch.stdout), sub(meta));
}

for (const [n, c] of [['agy', AG_FAIL], ['codex', CX_FAIL]]) {
  const fg = rescue(n, { mode: 'self_sigterm' });
  check(`${n} foreground self-SIGTERM reports a run failure, not a timeout`, errCode(fg) === c, sub(fg.envelope));
  const { meta } = runBackground(n, { mode: 'self_sigterm' });
  check(`${n} background self-SIGTERM records a run failure without spawn_code`, meta?.state === 'failed' && meta.error?.code === c && hasNo(meta.error, 'spawn_code'), sub(meta));
}

{
  const fgA = rescue('agy', { mode: 'hang' }, ['--timeout-ms', '5000']);
  const fgC = rescue('codex', { mode: 'hang_trap_0' }, ['--timeout-ms', '5000']);
  check('real timeouts report the timeout code in the foreground', errCode(fgA) === TIMEOUT && errCode(fgC) === TIMEOUT);
  const a = runBackground('agy', { mode: 'hang_trap_1' }, ['--timeout-ms', '5000']);
  const c = runBackground('codex', { mode: 'hang_trap_0' }, ['--timeout-ms', '5000']);
  check('agy background timeout records a failed run with exit_code 1', bgFailed(a.meta, TIMEOUT, 1), sub(a.meta));
  check('codex background timeout records a failed run with exit_code 1', bgFailed(c.meta, TIMEOUT, 1), sub(c.meta));
}

{
  const fg = rescue('codex', { mode: 'plain' });
  const bg = runBackground('codex', { mode: 'plain' });
  check('codex plain text reports the parse error in the foreground', errCode(fg) === CX_PARSE, sub(fg.envelope));
  check('codex plain text records a failed run with exit_code 0 in the background', bgFailed(bg.meta, CX_PARSE, 0), sub(bg.meta));
  const res = bg.jobId ? run('codex', ['result', bg.jobId]) : { envelope: null };
  check('result of a failed background job reports an incomplete job', errCode(res) === 'CCP-JOB-004', sub(res.envelope));
}

{
  const fg = rescue('codex', { mode: 'empty' });
  const bg = runBackground('codex', { mode: 'empty' });
  check('codex empty output reports the parse error in the foreground', errCode(fg) === CX_PARSE, sub(fg.envelope));
  check('codex empty output records the parse error in the background', bgFailed(bg.meta, CX_PARSE, 0), sub(bg.meta));
}

{
  const fg = rescue('agy', { mode: 'empty' });
  const bg = runBackground('agy', { mode: 'empty' });
  check('agy empty output is a success with an (empty) summary in the foreground', !fg.envelope?.error && fg.envelope?.summary === '(empty)', sub(fg.envelope));
  check('agy empty output completes in the background with an (empty) summary', bg.meta?.state === 'completed' && !bg.meta.error && bg.meta.summary_3lines === '(empty)', sub(bg.meta));
}

{
  const fg = rescue('agy', { mode: 'exit2' });
  check('agy exit 2 foreground meta records the failure', bgFailed(fgMeta(fg), AG_FAIL, 2), sub(fgMeta(fg)));
  const bg = runBackground('agy', { mode: 'exit2' });
  check('agy exit 2 background meta records the failure without spawn_code', bgFailed(bg.meta, AG_FAIL, 2) && hasNo(bg.meta?.error, 'spawn_code'), sub(bg.meta));
}

{
  const fg = rescue('codex', { mode: 'exit2' });
  const bg = runBackground('codex', { mode: 'exit2' });
  check('codex exit 2 reports the run failure in the foreground', errCode(fg) === CX_FAIL, sub(fg.envelope));
  check('codex exit 2 records the run failure in the background', bgFailed(bg.meta, CX_FAIL, 2), sub(bg.meta));
}

{
  const fg = rescue('agy', { bin: STUB_NO_EXEC });
  check('agy spawn EACCES reports the run failure in the foreground', errCode(fg) === AG_FAIL, sub(fg.envelope));
  const bg = runBackground('agy', { bin: STUB_NO_EXEC });
  check('agy spawn EACCES records exit_code 1 and spawn_code EACCES in the background', bgFailed(bg.meta, AG_FAIL, 1) && bg.meta.error.spawn_code === 'EACCES', sub(bg.meta));

  const { jobId } = jobsApi.enqueueBackgroundJob({ jobsDir: JOBS, cli: 'codex', prompt: 'x', params: {} });
  spawnSync(process.execPath, [COMPANIONS.codex, 'task-worker', jobId], { env: makeEnv({ bin: STUB_NO_EXEC }), encoding: 'utf8', timeout: 60000 });
  const m = readMeta(jobId);
  check('codex worker spawn EACCES records the run failure with spawn_code EACCES', bgFailed(m, CX_FAIL, 1) && m.error.spawn_code === 'EACCES', sub(m));
}

{
  const fg = rescue('agy', { mode: 'plain' });
  const fm = fgMeta(fg);
  const bg = runBackground('agy', { mode: 'plain' });
  check('agy plain foreground meta records exit_code 0 and a duration', fm?.state === 'completed' && fm.exit_code === 0 && typeof fm.duration_ms === 'number', sub(fm));
  check('agy plain background meta matches the foreground record', bg.meta?.state === fm?.state && bg.meta?.summary_3lines === fm?.summary_3lines && bg.meta?.exit_code === 0 && typeof bg.meta?.duration_ms === 'number', sub(bg.meta));
}

{
  const CONVERSATION = '33333333-3333-4333-8333-333333333333';
  const fm = fgMeta(rescue('agy', { mode: 'plain_log' }));
  const { meta } = runBackground('agy', { mode: 'plain_log' });
  check('agy foreground meta carries the conversation id from the CLI log', fm?.antigravity_conversation_id === CONVERSATION, sub(fm));
  check('agy background meta carries the conversation id from the CLI log', meta?.antigravity_conversation_id === CONVERSATION, sub(meta));
}

// ---------------------------------------------------------------------------
// Mock adapter variants (values only; the contract keys do not change)
// ---------------------------------------------------------------------------

console.log('\nAdapter variants');

const VARIANT = join(HERE, 'mock', 'variant-companion.mjs');
function runVariant(variant, args, opts = {}, timeout = 60000) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [VARIANT, ...args], { env: { ...makeEnv(opts), CCP_MOCK_VARIANT: variant }, encoding: 'utf8', timeout });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, envelope: parseLast(r.stdout), ms: Date.now() - t0 };
}

{
  const before = new Set(readdirSync(JOBS));
  const r = runVariant('persist-parse-error', ['rescue', '--', 'stub task']);
  const jobId = readdirSync(JOBS).filter((d) => !before.has(d)).find((d) => readMeta(d)?.mode === 'mock') ?? null;
  const m = jobId ? readMeta(jobId) : null;
  check('a parse error in a job with a foreground record reports its code', errCode(r) === 'CCP-MOCK-002', sub(r.envelope) || r.stderr.slice(0, 200));
  check('that job is recorded failed with the parse code, not left running', m?.state === 'failed' && m.error?.code === 'CCP-MOCK-002', sub(m));
  const fin = jobId ? orphan.finalizeIfOrphan(join(JOBS, jobId), { reason: 'orphan_status' }) : null;
  check('orphan finalization leaves that record alone', fin === false && readMeta(jobId)?.error?.code === 'CCP-MOCK-002', `fin=${fin} ${sub(readMeta(jobId))}`);
}

{
  const r = runVariant('short-probe', ['setup'], { mode: 'version_hang' }, 10000);
  check('setup with a hanging version probe returns the not-installed error within 3 seconds', errCode(r) === 'CCP-SETUP-901' && r.ms < 3000, `ms=${r.ms} ${sub(r.envelope)}`);
}

// ---------------------------------------------------------------------------

rmSync(ROOT, { recursive: true, force: true });
console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
