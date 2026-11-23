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
// Details sit at the envelope root for some adapters and under error.details for others: print whichever exists.
const det = (e) => JSON.stringify(e?.details ?? e?.error?.details ?? null);
const checks = (list) => list.filter(([ok]) => !ok).map(([, label]) => label);

// Config for the extra roles: variant-b's ccp.json plus roles that probe entry-level validation.
const CFG = join(TMP, 'extra-roles.json');
const baseCfg = JSON.parse(readFileSync(join(HERE, '..', 'variant-b', 'ccp.json'), 'utf8'));
Object.assign(baseCfg.roles, {
  'image-no-model': { runner: 'imagegen', size: '512x512' },
  'image-bad-timeout': { runner: 'imagegen', model: 'image-model-x', timeout_ms: 'abc' },
  'image-long': { runner: 'imagegen', model: 'image-model-x', timeout_ms: 7200000 },
  'e2e-long': { runner: 'codex', model: 'codex-5.6', timeout_ms: 7200000 },
});
writeFileSync(CFG, JSON.stringify(baseCfg));
const readMeta = (id) => JSON.parse(readFileSync(join(JOBS, id, 'meta.json'), 'utf8'));
const okEnv = (r) => r.code === 0 && !!r.env && !r.env.error && r.env.exit_code === 0;
let fgImageEnv = null;

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
    [e.summary?.length <= 500 && e.summary.startsWith(`Generated 2 file(s) in ${out}: image-1.png, image-2.png`), 'summary has the directory-listing line'],
    [validateEnvelope(e).valid, 'validateEnvelope'], [!r.stderr.includes('[envelope-validate]'), 'no [envelope-validate] warning'],
  ]);
  fgImageEnv = e;
  return { bad, note: 'passes validateEnvelope only (it ignores a missing details.mode: see schema-mode). Job dir reaches the runner only by deriving it from logFile (borrows result.logFileName/persistForeground; core never passes it to buildArgs); a CLI writing a file named run.log into --out would collide', r };
});
sc('fg-image-quick', 'must', async () => {
  const r = call('image-quick', ['rescue', '--task', 'A paper boat'], IMG); const argv = taskArgv(r);
  return { bad: checks([[okEnv(r), `exit ${r.code} / success`], [argv.length > 0 && !argv.includes('--size'), 'no --size']]), note: `argv has ${argv.length} tokens`, r };
});
sc('fg-model-override', 'must', async () => {
  const r = call('image', ['rescue', '--model', 'other-model', '--task', 'A paper boat'], IMG); const argv = taskArgv(r);
  return { bad: checks([[okEnv(r), `exit ${r.code} / success`], [pair(argv, '--model', 'other-model') && !argv.includes('image-model-x'), 'CLI model wins']]), note: 'cli model used', r };
});
sc('bg-image', 'must', async () => {
  const q = call('image', ['rescue', '--background', '--task', 'A lighthouse at dusk'], IMG);
  const id = q.env?.job_id; if (!id) return { bad: ['no job_id'], note: errLine(q.env), r: q };
  const s = await waitState('image', id, IMG);
  const res = call('image', ['result', id], IMG); const e = res.env || {};
  // The worker (not the rescue call) ran the stub: read the shared argv file again.
  const argv = readFileSync(q.argvFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).argv)[0] || [];
  const bad = checks([[q.env.status === 'queued', 'queued'], [s?.env.details.state === 'completed', `state ${s?.env.details.state}`], [okEnv(res), `result exit ${res.code} / success`], [!!e.summary && !!e.result_path && existsSync(e.result_path), 'result summary + result file on disk'],
    [pair(argv, '--size', '1024x1024') && pair(argv, '--model', 'image-model-x'), 'role options in worker'], [argv[argv.indexOf('--out') + 1] === join(JOBS, id), '--out is the job dir']]);
  const keys = Object.keys(readMeta(id).params || {}).join(',');
  return { bad, note: `state=${s?.env.details.state}. The worker re-reads ccp.json (core stores only params {${keys}}), so --size was not carried by core; editing the config between dispatch and worker changes the job`, r: res };
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
sc('fg-cli-missing', 'probe', async () => { const r = call('image', ['rescue', '--task', 'x']); return { note: `${errLine(r.env)} action="${r.env?.error?.action}" details=${det(r.env)}`, r }; });
sc('fg-cli-fails', 'probe', async () => { const r = call('image', ['rescue', '--task', 'x'], { stub: 'imagegen', mode: 'fail' }); return { note: `${errLine(r.env)} details=${det(r.env)}`, r }; });
sc('fg-timeout', 'probe', async () => { const r = call('image', ['rescue', '--timeout-ms', '5000', '--task', 'x'], { stub: 'imagegen', mode: 'hang' }); return { note: `${errLine(r.env)} details=${det(r.env)}`, r }; });
sc('fg-silent', 'probe', async () => { const r = call('image', ['rescue', '--task', 'x'], { stub: 'imagegen', mode: 'silent' }); return { note: `${errLine(r.env)} result_path=${!!r.env?.result_path}`, r }; });
sc('bg-silent', 'probe', async () => {
  const o = { stub: 'imagegen', mode: 'silent' };
  const id = call('image', ['rescue', '--background', '--task', 'x'], o).env?.job_id; const s = await waitState('image', id, o);
  const meta = JSON.parse(readFileSync(join(JOBS, id, 'meta.json'), 'utf8')); const files = readdirSync(join(JOBS, id)).filter((f) => f.endsWith('.png'));
  const res = call('image', ['result', id], o);
  const rt = readFileSync(join(HERE, '..', '..', '..', 'plugins', 'ccp', 'scripts', 'core', 'runtime.mjs'), 'utf8').split('\n');
  const ln = rt.findIndex((l) => /r\.status === 0 && r\.stdout\)/.test(l)) + 1;
  return { note: `state=${s?.env.details.state} meta.error=${JSON.stringify(meta.error?.code)} exit_code=${meta.exit_code} files_on_disk=${files.length}; result: ${errLine(res.env)}. Cause: core/runtime.mjs:${ln || '?'} worker needs non-empty stdout for success (fg-silent has no such check, so it succeeds); bg-image passes only because the stub prints file names`, r: res };
});
sc('unsupported-flag', 'probe', async () => { const r = call('image', ['rescue', '--effort', 'high', '--task', 'x'], IMG); return { note: `${errLine(r.env)} stub_called=${r.calls.length > 0}`, r }; });
sc('entry-errors', 'must', async () => {
  const cases = [['no-such-role', 'is not defined', {}], ['broken-runner', 'ghost-cli', {}], ['broken-shape', 'needs "runner" or "targets"', {}],
    ['image-no-model', 'needs a value for {model}', { config: CFG }], ['image-bad-timeout', 'timeout_ms must be a positive integer', { config: CFG }]];
  const bad = []; let last;
  for (const [role, frag, o] of cases) {
    const r = call(role, ['rescue', '--task', 'x'], { stub: 'imagegen', ...o }); last = r; const m = r.env?.error?.message || '';
    if (r.code !== 1 || r.env?.exit_code !== 1 || r.env?.error?.code !== 'CCP-ROLE-001' || !m.includes(`"${role}"`) && !m.includes(role) || !m.includes(frag) || r.stderr.length > 0) bad.push(`${role}: ${errLine(r.env)} code=${r.code} stderr=${r.stderr.slice(0, 60)}`);
  }
  return { bad, note: '5 roles -> exit 1, CCP-ROLE-001, role + reason named, empty stderr', r: last };
});
sc('entry-model-forms', 'must', async () => {
  const o = { stub: 'imagegen', config: CFG }; const bad = [];
  for (const [args, want] of [[['--model', 'foo'], 'foo'], [['--model=foo'], 'foo']]) {
    const r = call('image-no-model', ['rescue', ...args, '--task', 'x'], o);
    if (!okEnv(r) || !pair(taskArgv(r), '--model', want)) bad.push(`${args.join(' ')}: ${errLine(r.env)} code=${r.code}`);
  }
  const t = call('image-no-model', ['rescue', '--task', 'x', '--model'], o); // bare trailing --model = no override
  if (t.code !== 1 || t.env?.error?.code !== 'CCP-ROLE-001') bad.push(`trailing --model: ${errLine(t.env)} code=${t.code}`);
  return { bad, note: '--model v, --model=v accepted; trailing bare --model is not an override', r: t };
});
sc('timeout-routing', 'must', async () => {
  const stored = (role, extra, o) => { const q = call(role, ['rescue', '--background', ...extra, '--task', 'x'], o); return { id: q.env?.job_id, v: q.env?.job_id ? readMeta(q.env.job_id).params.timeoutMs : null }; };
  const d = stored('image-long', [], { stub: 'imagegen', config: CFG });
  const b = stored('e2e-long', [], { stub: 'codex', config: CFG });
  const w = stored('image-long', ['--timeout-ms', '9000'], { stub: 'imagegen', config: CFG });
  for (const [role, o, x] of [['image-long', { stub: 'imagegen', config: CFG }, d], ['e2e-long', { stub: 'codex', config: CFG }, b], ['image-long', { stub: 'imagegen', config: CFG }, w]]) await waitState(role, x.id, o);
  return { bad: checks([[d.v !== null && d.v === b.v, `declared ${d.v} vs built-in ${b.v}`], [w.v === 9000, `command-line --timeout-ms stored ${w.v}`]]), note: `timeout_ms 7200000 stored as ${d.v} (declared runner) and ${b.v} (built-in): same --timeout-ms path and clamp; command-line 9000 wins (stored ${w.v})`, r: null };
});
sc('schema-mode', 'probe', async () => {
  const sch = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'plugins', 'ccp', 'schemas', 'envelope.schema.json'), 'utf8')).$defs.details;
  const e = fgImageEnv || {}; const mode = e.details?.mode;
  const reqOk = sch.required.every((k) => e.details && k in e.details); const enumOk = sch.properties.mode.enum.includes(mode);
  return { note: `schema details.required=[${sch.required}] mode enum=[${sch.properties.mode.enum}]; declared-runner success envelope: required satisfied=${reqOk}, mode=${mode ?? '(absent)'} in enum=${enumOk}, validateEnvelope.valid=${validateEnvelope(e).valid}. Needs a plugin change: let the schema (and validateEnvelope's mode check) accept a runner-declared mode, or give modeFor a value in the enum`, r: null };
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
  return { bad: checks([[meta.params.timeoutMs === 1800000, `meta.params.timeoutMs=${meta.params.timeoutMs}`], [s?.env.details.state === 'completed', 'job completed']]), note: `verified from the stored job params in the background path (timeoutMs=${meta.params.timeoutMs}); no timeout was made to fire. Over-limit clamp: see timeout-routing`, r: s };
});
for (const [id, role] of [['builtin-research', 'research'], ['builtin-tuned-coding', 'tuned-coding'], ['builtin-claude', 'arch-review'], ['multi-target', 'brainstorm']]) {
  sc(id, 'probe', async () => { const r = call(role, ['rescue', '--task', 'x'], { stub: 'codex' }); return { note: `${errLine(r.env)} details=${det(r.env)}`, r }; });
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
