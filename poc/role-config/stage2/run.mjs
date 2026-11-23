#!/usr/bin/env node
// Stage 2: drive the real plugin core through entry.mjs (subprocess per call).
// Usage: node poc/role-config/stage2/run.mjs [--verbose]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvelope } from '../../../plugins/ccp/scripts/lib/envelope-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, 'entry.mjs');
const GOLDEN_STUBS = join(HERE, '..', '..', '..', 'tests', 'companion', 'golden', 'stubs');
const verbose = process.argv.includes('--verbose');
const TMP = mkdtempSync(join(tmpdir(), 'ccp-stage2-'));
const JOBS = join(TMP, 'jobs');
const WORK = join(TMP, 'work');
mkdirSync(WORK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A killed child whose parent is gone may linger as a zombie: count that as dead.
const alive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
const pids = new Set();
let seq = 0;

// One entry.mjs call. opts: { stub: 'imagegen'|'codex'|null, mode, config }
function call(role, args, opts = {}) {
  const argvFile = join(TMP, `argv-${++seq}.jsonl`);
  const env = { ...process.env, CCP_JOBS_DIR: JOBS, STAGE2_ARGV_FILE: argvFile };
  for (const k of ['CCP_ROLE_CONFIG', 'CCP_IMAGEGEN_BIN', 'CCP_CODEX_BIN', 'CCP_AGY_BIN', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PROJECT_ROOT', 'CCP_ENVELOPE_STRICT']) delete env[k];
  if (opts.stub === 'imagegen') { env.CCP_IMAGEGEN_BIN = join(HERE, 'stub-imagegen'); env.STAGE2_IMAGEGEN_MODE = opts.mode || 'ok'; }
  if (opts.stub === 'codex') { env.CCP_CODEX_BIN = join(HERE, 'stub-wrap'); env.STAGE2_WRAP_TARGET = join(GOLDEN_STUBS, 'codex'); }
  if (opts.config) env.CCP_ROLE_CONFIG = opts.config;
  const r = spawnSync(process.execPath, [ENTRY, role, ...args], { cwd: WORK, env, encoding: 'utf8', timeout: 60000 });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  let env_ = null;
  try { env_ = JSON.parse(lines[lines.length - 1]); } catch { /* not JSON */ }
  const calls = existsSync(argvFile) ? readFileSync(argvFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  for (const c of calls) pids.add(c.pid);
  return { code: r.status, env: env_, stderr: r.stderr, calls, argvFile };
}
// Argv of the one call that did the work (the stub's task call).
const taskArgv = (r, first) => r.calls.find((c) => (first ? c.argv[0] === first : true))?.argv || [];
const pair = (argv, flag, val) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] === val; };

async function waitState(role, jobId, opts, wanted = ['completed', 'failed', 'cancelled']) {
  for (let i = 0; i < 200; i++) {
    const r = call(role, ['status', jobId], opts);
    if (wanted.includes(r.env?.details?.state)) return r;
    await sleep(100);
  }
  return null;
}
const errLine = (e) => (e?.error ? `${e.error.code} "${e.error.message}" recovery=${e.error.recovery}` : `ok summary="${String(e?.summary ?? '').slice(0, 70)}"`);
const checks = (list) => list.filter(([ok]) => !ok).map(([, label]) => label);

const scenarios = [];
const sc = (id, kind, fn) => scenarios.push({ id, kind, fn });
const IMG = { stub: 'imagegen' };

sc('fg-image', 'must', async () => {
  const r = call('image', ['rescue', '--task', 'A lighthouse at dusk'], IMG);
  const e = r.env || {}; const argv = taskArgv(r); const out = argv[argv.indexOf('--out') + 1];
  const files = out && existsSync(out) ? readdirSync(out) : [];
  const bad = checks([
    [r.code === 0 && !e.error, `exit ${r.code} / error`], [pair(argv, '--model', 'image-model-x'), '--model'], [pair(argv, '--size', '1024x1024'), '--size'],
    [out && resolve(out).startsWith(JOBS), '--out is a job dir under CCP_JOBS_DIR'], [argv.at(-1) === 'A lighthouse at dusk', 'task text'],
    [files.includes('image-1.png') && files.includes('image-2.png'), 'files in --out'],
    [e.result_path && dirname(e.result_path) === out && existsSync(e.result_path), 'result_path in same dir'],
    [e.summary?.length <= 500 && /image-1\.png/.test(e.summary) && /image-2\.png/.test(e.summary), 'summary lists files'],
    [validateEnvelope(e).valid, 'validateEnvelope'], [!r.stderr.includes('[envelope-validate]'), 'no [envelope-validate] warning'],
  ]);
  return { bad, note: `job dir ${out ? 'ok' : 'none'}, details.mode=${e.details?.mode ?? '(absent)'}`, r };
});
sc('fg-image-quick', 'must', async () => {
  const r = call('image-quick', ['rescue', '--task', 'A paper boat'], IMG); const argv = taskArgv(r);
  return { bad: checks([[r.env?.exit_code === 0, 'success'], [argv.length > 0 && !argv.includes('--size'), 'no --size']]), note: `argv has ${argv.length} tokens`, r };
});
sc('fg-model-override', 'must', async () => {
  const r = call('image', ['rescue', '--model', 'other-model', '--task', 'A paper boat'], IMG); const argv = taskArgv(r);
  return { bad: checks([[pair(argv, '--model', 'other-model') && !argv.includes('image-model-x'), 'CLI model wins']]), note: 'cli model used', r };
});
sc('bg-image', 'must', async () => {
  const q = call('image', ['rescue', '--background', '--task', 'A lighthouse at dusk'], IMG);
  const id = q.env?.job_id; if (!id) return { bad: ['no job_id'], note: errLine(q.env), r: q };
  const s = await waitState('image', id, IMG);
  const res = call('image', ['result', id], IMG); const e = res.env || {};
  // The worker (not the rescue call) ran the stub: read the shared argv file again.
  const argv = readFileSync(q.argvFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).argv)[0] || [];
  const bad = checks([[q.env.status === 'queued', 'queued'], [s?.env.details.state === 'completed', `state ${s?.env.details.state}`], [!!e.summary && !!e.result_path, 'result summary+path'],
    [pair(argv, '--size', '1024x1024') && pair(argv, '--model', 'image-model-x'), 'role options in worker'], [argv[argv.indexOf('--out') + 1] === join(JOBS, id), '--out is the job dir']]);
  return { bad, note: `state=${s?.env.details.state}, worker saw --size`, r: res };
});
sc('bg-cancel', 'probe', async () => {
  const o = { stub: 'imagegen', mode: 'hang' };
  const q = call('image', ['rescue', '--background', '--task', 'x'], o); const id = q.env?.job_id;
  for (let i = 0; i < 50 && !existsSync(q.argvFile); i++) await sleep(100);
  const c = call('image', ['cancel', id], o); await sleep(400);
  const calls = readFileSync(q.argvFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); calls.forEach((x) => pids.add(x.pid));
  const s = call('image', ['status', id], o);
  return { note: `cancel: ${errLine(c.env)}; status state=${s.env?.details?.state}; stub alive=${alive(calls[0].pid)} (worker pid ${q.env.details.pid} alive=${alive(q.env.details.pid)})`, r: s };
});
sc('fg-cli-missing', 'probe', async () => { const r = call('image', ['rescue', '--task', 'x']); return { note: `${errLine(r.env)} action="${r.env?.error?.action}" details=${JSON.stringify(r.env?.details)}`, r }; });
sc('fg-cli-fails', 'probe', async () => { const r = call('image', ['rescue', '--task', 'x'], { stub: 'imagegen', mode: 'fail' }); return { note: `${errLine(r.env)} details=${JSON.stringify(r.env?.details)}`, r }; });
sc('fg-timeout', 'probe', async () => { const r = call('image', ['rescue', '--timeout-ms', '5000', '--task', 'x'], { stub: 'imagegen', mode: 'hang' }); return { note: `${errLine(r.env)} details=${JSON.stringify(r.env?.details)}`, r }; });
sc('fg-silent', 'probe', async () => { const r = call('image', ['rescue', '--task', 'x'], { stub: 'imagegen', mode: 'silent' }); return { note: `${errLine(r.env)} result_path=${!!r.env?.result_path}`, r }; });
sc('bg-silent', 'probe', async () => {
  const o = { stub: 'imagegen', mode: 'silent' };
  const id = call('image', ['rescue', '--background', '--task', 'x'], o).env?.job_id; const s = await waitState('image', id, o);
  const meta = JSON.parse(readFileSync(join(JOBS, id, 'meta.json'), 'utf8')); const files = readdirSync(join(JOBS, id)).filter((f) => f.endsWith('.png'));
  const res = call('image', ['result', id], o);
  return { note: `state=${s?.env.details.state} meta.error=${JSON.stringify(meta.error?.code)} exit_code=${meta.exit_code} files_on_disk=${files.length}; result: ${errLine(res.env)}`, r: res };
});
sc('unsupported-flag', 'probe', async () => { const r = call('image', ['rescue', '--effort', 'high', '--task', 'x'], IMG); return { note: `${errLine(r.env)} stub_called=${r.calls.length > 0}`, r }; });
sc('entry-errors', 'must', async () => {
  const cfg = join(TMP, 'no-model.json'); const base = JSON.parse(readFileSync(join(HERE, '..', 'variant-b', 'ccp.json'), 'utf8'));
  base.roles['image-no-model'] = { runner: 'imagegen', size: '512x512' }; writeFileSync(cfg, JSON.stringify(base));
  const cases = [['no-such-role', 'no-such-role', {}], ['broken-runner', 'ghost-cli', {}], ['broken-shape', 'broken-shape', {}], ['image-no-model', '{model}', { config: cfg }]];
  const bad = []; let last;
  for (const [role, want, o] of cases) {
    const r = call(role, ['rescue', '--task', 'x'], { stub: 'imagegen', ...o }); last = r;
    if (r.code === 0 || !r.env?.error || !r.env.error.message.includes(role) || !r.env.error.message.includes(want) || r.stderr.length > 0) bad.push(`${role}: ${errLine(r.env)} code=${r.code} stderr=${r.stderr.slice(0, 60)}`);
  }
  return { bad, note: '4 roles -> CCP-ROLE-001 envelopes, exit 1, empty stderr', r: last };
});

const CODEX = { stub: 'codex' };
sc('builtin-coding', 'must', async () => {
  const r = call('coding', ['rescue', '--task', 'Add pagination'], CODEX); const argv = taskArgv(r, 'exec');
  return { bad: checks([[r.env?.exit_code === 0 && !r.env.error, `success (${errLine(r.env)})`], [pair(argv, '-m', 'codex-5.6'), '-m codex-5.6'], [pair(argv, '-s', 'workspace-write'), '-s workspace-write'], [validateEnvelope(r.env || {}).valid, 'validateEnvelope']]), note: `details.mode=${r.env?.details?.mode}`, r };
});
sc('builtin-e2e', 'must', async () => {
  const q = call('e2e', ['rescue', '--background', '--task', 'Run checkout flow'], CODEX); const id = q.env?.job_id;
  if (!id) return { bad: ['no job_id'], note: errLine(q.env), r: q };
  const s = await waitState('e2e', id, CODEX); const meta = JSON.parse(readFileSync(join(JOBS, id, 'meta.json'), 'utf8'));
  return { bad: checks([[meta.params.timeoutMs === 1800000, `meta.params.timeoutMs=${meta.params.timeoutMs}`], [s?.env.details.state === 'completed', 'job completed']]), note: `job meta params.timeoutMs=${meta.params.timeoutMs} (worker uses it: runtime.mjs task-worker)`, r: s };
});
for (const [id, role] of [['builtin-research', 'research'], ['builtin-tuned-coding', 'tuned-coding'], ['builtin-claude', 'arch-review'], ['multi-target', 'brainstorm']]) {
  sc(id, 'probe', async () => { const r = call(role, ['rescue', '--task', 'x'], { stub: 'codex' }); return { note: `${errLine(r.env)} details=${JSON.stringify(r.env?.details)}`, r }; });
}

const rows = [];
try {
  for (const s of scenarios) {
    let out;
    try { out = await s.fn(); } catch (err) { out = { bad: [`threw: ${err.message}`], note: 'harness error' }; }
    const failed = s.kind === 'must' && out.bad?.length > 0;
    rows.push({ id: s.id, kind: s.kind, outcome: s.kind === 'probe' ? 'RECORDED' : failed ? 'FAIL' : 'PASS', note: failed ? out.bad.join('; ') : out.note, r: out.r });
  }
} finally {
  for (const p of pids) if (alive(p)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  const w = Math.max(...rows.map((r) => r.id.length));
  console.log(`${'scenario'.padEnd(w)}  kind   outcome   note`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(w)}  ${r.kind.padEnd(5)}  ${r.outcome.padEnd(8)}  ${r.note}`);
    if (verbose && r.r) console.log(`    envelope: ${JSON.stringify(r.r.env)}\n    exit=${r.r.code} stub calls=${JSON.stringify(r.r.calls.map((c) => c.argv))}\n    stderr=${JSON.stringify(r.r.stderr)}`);
  }
  rmSync(TMP, { recursive: true, force: true });
}
process.exit(rows.some((r) => r.outcome === 'FAIL') ? 1 : 0);
