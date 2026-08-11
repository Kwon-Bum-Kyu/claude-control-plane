#!/usr/bin/env node
// Golden envelope baseline capture — companion core-integration.
//
// Runs every scenario in scenarios.mjs against both companions using the
// stub binaries in stubs/, and records stdout + stderr + exit_code for each
// as the current baseline envelope — the reference point that a later core
// integration must reproduce exactly (diff 0) to prove behavior preservation.
//
// Usage:
//   node tests/companion/golden/capture.mjs [--out <path>]
//
// Real-CLI/network access: none. Everything runs against the stub binaries
// in tests/companion/golden/stubs/.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCENARIOS } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const REAL_JOBS_DIR = join(REPO_ROOT, '_workspace', '_jobs');

const COMPANION = {
  antigravity: join(REPO_ROOT, 'plugins', 'ccp', 'scripts', 'antigravity-companion.mjs'),
  codex: join(REPO_ROOT, 'plugins', 'ccp', 'scripts', 'codex-companion.mjs'),
};
const STUB_BIN = {
  antigravity: join(HERE, 'stubs', 'agy'),
  codex: join(HERE, 'stubs', 'codex'),
};
const BIN_ENV_KEY = { antigravity: 'CCP_AGY_BIN', codex: 'CCP_CODEX_BIN' };
const MODE_ENV_KEY = { antigravity: 'CCP_GOLDEN_AGY_MODE', codex: 'CCP_GOLDEN_CODEX_MODE' };

// Keys that must never leak in from the invoking shell — every scenario sets
// them explicitly (or deliberately leaves them unset) for determinism.
const EXCLUDE_FROM_BASE_ENV = new Set([
  'CCP_AGY_BIN',
  'CCP_CODEX_BIN',
  'CCP_JOBS_DIR',
  'CCP_GOLDEN_AGY_MODE',
  'CCP_GOLDEN_CODEX_MODE',
  'ANTIGRAVITY_API_KEY',
]);

function baseEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!EXCLUDE_FROM_BASE_ENV.has(k)) out[k] = v;
  }
  return out;
}

function countRealJobs() {
  if (!existsSync(REAL_JOBS_DIR)) return 0;
  return readdirSync(REAL_JOBS_DIR).length;
}

function writeMetaFile(isolatedDir, jobId, meta) {
  const dir = join(isolatedDir, jobId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'meta.json');
  const body = typeof meta === 'string' ? meta : JSON.stringify(meta, null, 2);
  writeFileSync(path, body, 'utf8');
}

function parseEnvelope(stdout) {
  const lines = String(stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function runOne(scenario, run) {
  const cli = run.cli;
  const isolatedDir = mkdtempSync(join(tmpdir(), `ccp-golden-${cli}-`));
  let realRepoJobDir = null;
  const record = {
    id: scenario.id,
    title: scenario.title,
    cli,
    args: run.args,
  };

  try {
    // --- seed job meta (isolated dir; both companions read CCP_JOBS_DIR) ---
    if (run.meta !== undefined) {
      const meta = typeof run.meta === 'function' ? run.meta(isolatedDir) : run.meta;
      const jobId = run.args[run.args.length - 1];
      writeMetaFile(isolatedDir, jobId, meta);
    }
    if (run.resultFile) {
      const path = join(isolatedDir, run.resultFile.relPath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, run.resultFile.content, 'utf8');
    }

    // --- antigravity-only: the `result` subcommand reads from the real
    // repo tree regardless of CCP_JOBS_DIR (pre-existing isolation gap,
    // not in scope to fix here). Materialize + clean up a real file so this
    // one scenario can still capture a true success envelope without
    // leaving anything behind. ---
    if (run.realRepoResult) {
      const absPath = join(REPO_ROOT, run.realRepoResult.relPath);
      realRepoJobDir = dirname(absPath);
      if (existsSync(realRepoJobDir)) rmSync(realRepoJobDir, { recursive: true, force: true });
      mkdirSync(realRepoJobDir, { recursive: true });
      writeFileSync(absPath, run.realRepoResult.content, 'utf8');
    }

    // --- env ---
    const env = { ...baseEnv(), CCP_JOBS_DIR: isolatedDir };
    if (run.stubMode) {
      env[BIN_ENV_KEY[cli]] = STUB_BIN[cli];
      env[MODE_ENV_KEY[cli]] = run.stubMode;
    }
    if (run.authOk && cli === 'antigravity') {
      env.ANTIGRAVITY_API_KEY = 'golden-test-key';
    }

    const result = spawnSync(process.execPath, [COMPANION[cli], ...run.args], {
      encoding: 'utf8',
      env,
      timeout: 15000,
    });

    record.exit_code = result.status;
    record.stdout = result.stdout || '';
    record.stderr = result.stderr || '';
    record.envelope = parseEnvelope(result.stdout);
    record.spawn_error = result.error ? String(result.error.message) : null;

    // Background dispatch spawns a detached worker; give it a brief moment
    // to finish (the stub is synchronous and near-instant) so the
    // real-jobs contamination check below is meaningful.
    if (run.args.includes('--background')) {
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 400)']);
    }
  } finally {
    if (realRepoJobDir && existsSync(realRepoJobDir)) {
      rmSync(realRepoJobDir, { recursive: true, force: true });
    }
    rmSync(isolatedDir, { recursive: true, force: true });
  }

  return record;
}

function main() {
  const outArgIdx = process.argv.indexOf('--out');
  const outPath =
    outArgIdx !== -1 && process.argv[outArgIdx + 1]
      ? resolve(process.argv[outArgIdx + 1])
      : join(HERE, 'baseline', 'companion-baseline.json');

  const before = countRealJobs();

  const records = [];
  const failures = [];
  for (const scenario of SCENARIOS) {
    for (const run of scenario.runs) {
      try {
        const record = runOne(scenario, run);
        records.push(record);
        if (record.spawn_error) {
          failures.push({ id: scenario.id, cli: run.cli, reason: record.spawn_error });
        }
      } catch (err) {
        failures.push({ id: scenario.id, cli: run.cli, reason: String(err && err.stack || err) });
        records.push({
          id: scenario.id,
          title: scenario.title,
          cli: run.cli,
          args: run.args,
          exit_code: null,
          stdout: '',
          stderr: '',
          envelope: null,
          spawn_error: String(err),
        });
      }
    }
  }

  const after = countRealJobs();
  const contamination = after !== before;

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });

  const baseline = {
    captured_at: new Date().toISOString(),
    base_commit: (commit.stdout || '').trim() || null,
    real_jobs_before: before,
    real_jobs_after: after,
    contamination,
    scenario_count: SCENARIOS.length,
    run_count: records.length,
    failure_count: failures.length,
    scenarios: records,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');

  console.log(`Captured ${records.length} runs across ${SCENARIOS.length} scenarios.`);
  console.log(`real _workspace/_jobs count: before=${before} after=${after} contamination=${contamination}`);
  console.log(`baseline written to ${outPath}`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} run(s) hit a script-level error (spawn failure, not envelope content):`);
    for (const f of failures) console.log(`  - ${f.id} [${f.cli}]: ${f.reason}`);
  }
  if (contamination) {
    console.log('\nWARNING: real _workspace/_jobs job count changed during capture.');
  }

  process.exit(failures.length > 0 || contamination ? 1 : 0);
}

main();
