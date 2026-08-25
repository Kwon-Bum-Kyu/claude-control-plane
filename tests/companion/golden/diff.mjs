#!/usr/bin/env node
// Golden envelope diff tool — companion core-integration.
//
// Re-runs capture.mjs into a fresh "after" snapshot, then compares it
// scenario-by-scenario against the committed baseline. Masking is scoped to
// the exact fields that are non-deterministic by construction — it must
// never swallow a fixed, test-seeded value (codex_thread_id,
// antigravity_conversation_id, and every other detail field are compared
// byte-exact). See the "masking" section below for the rule.
//
// Usage:
//   node tests/companion/golden/diff.mjs [--cli codex|antigravity|all] [--verbose]
//
// Exit code 0 = 0 diffs across the selected CLI scope. Non-zero = at least
// one scenario's stdout/stderr/exit_code differs after masking.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const BASELINE_PATH = join(HERE, 'baseline', 'companion-baseline.json');
const CAPTURE_SCRIPT = join(HERE, 'capture.mjs');

const argv = process.argv.slice(2);
const cliArgIdx = argv.indexOf('--cli');
const cliFilter = cliArgIdx !== -1 && argv[cliArgIdx + 1] ? argv[cliArgIdx + 1] : 'all';
const verbose = argv.includes('--verbose');

// --- masking -------------------------------------------------------------
//
// Rule: a field is masked only when its exact value could not have been
// known ahead of the call — i.e. it was minted fresh by the companion
// (background dispatch's randomUUID() job id and its pid), rather than
// echoed back from something the test already pinned in `args` (every
// status/result/cancel scenario passes its job id as a positional). This is
// checked per occurrence, by value, against the call's own `args` — not by a
// blanket "looks like a UUID" pattern, which is what previously let a
// mutated `codex_thread_id` slip through undetected.
//   - `job_id` (top-level or nested, e.g. under `details`): masked only when
//     that exact string is absent from `args` (freshly generated).
//   - `pid`: always masked when numeric — no current or plausible scenario
//     seeds a fixed numeric pid for the companion to echo back.
//   - `*_at` timestamps: masked only alongside a freshly-generated job_id in
//     the same object (every current scenario's timestamps come from a fixed
//     meta seed and must stay byte-exact; this only guards a future
//     "dispatch-then-read-back-live" scenario).
//   - `next_action`: has that object's own (unmasked) job_id value stripped
//     out, since it embeds the same id in prose.
//   - `result_path`: everything from the start of the path through the
//     mkdtemp leaf directory capture.mjs creates (`ccp-golden-<cli>-<rand>`)
//     is masked as one unit — not just the random suffix. The OS-specific
//     temp root ahead of it (`/var/folders/.../T` on macOS, `/tmp` on a
//     Linux CI runner, and macOS's `/private/var/folders` alias for the same
//     path) is host-dependent, so a baseline captured on one machine must
//     still diff-clean when re-checked on another. Everything after that
//     leaf directory, including the job-id subdirectory and filename, is a
//     fixed test fixture and stays byte-exact.
// Nothing else is ever masked — no blanket "any UUID-looking string" pass,
// so codex_thread_id / antigravity_conversation_id / every other detail key
// is always compared byte-exact.

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// Anchored at the start of the string and greedy up to the mkdtemp leaf name
// so it swallows the whole OS-specific prefix in one match, regardless of
// what that prefix looks like on the host that produced it.
const GOLDEN_TMPDIR_PREFIX_RE = /^.*ccp-golden-(?:codex|antigravity)-[A-Za-z0-9]+/;

function maskResultPath(value) {
  return typeof value === 'string' ? value.replace(GOLDEN_TMPDIR_PREFIX_RE, '<TMPDIR>') : value;
}

function maskEnvelope(node, args) {
  if (Array.isArray(node)) return node.map((v) => maskEnvelope(v, args));
  if (!node || typeof node !== 'object') return node;

  const rawJobId = typeof node.job_id === 'string' ? node.job_id : null;
  const jobIdIsFromInput = rawJobId !== null && args.includes(rawJobId);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'job_id' && typeof v === 'string') {
      out[k] = args.includes(v) ? v : '<JOB_ID>';
    } else if (k === 'pid' && typeof v === 'number') {
      out[k] = '<PID>';
    } else if (/_at$/.test(k) && typeof v === 'string' && ISO_TIMESTAMP_RE.test(v)) {
      out[k] = jobIdIsFromInput ? v : '<TIMESTAMP>';
    } else if (k === 'result_path' && typeof v === 'string') {
      out[k] = maskResultPath(v);
    } else if (k === 'next_action' && typeof v === 'string') {
      out[k] = rawJobId && !jobIdIsFromInput ? v.split(rawJobId).join('<JOB_ID>') : v;
    } else if (v && typeof v === 'object') {
      out[k] = maskEnvelope(v, args);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseEnvelopeLine(stdout) {
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

/**
 * @returns {{ exit_code:number, stdout:string, stderr:string }} a comparable,
 * masked projection of one captured record.
 */
function maskRecord(record) {
  const args = record.args || [];
  const env = record.envelope !== undefined ? record.envelope : parseEnvelopeLine(record.stdout);
  if (env === null) {
    // Not a parseable single-line JSON envelope (shouldn't happen for any
    // current scenario) — fall back to an exact, unmasked string compare
    // rather than silently treating it as a match.
    return { exit_code: record.exit_code, stdout: record.stdout, stderr: record.stderr };
  }
  const masked = maskEnvelope(env, args);
  return {
    exit_code: record.exit_code,
    stdout: JSON.stringify(masked),
    stderr: record.stderr, // stderr is expected empty/stable across all 27 baseline runs — compared byte-exact
  };
}

function keyOf(record) {
  return `${record.id}::${record.cli}::${JSON.stringify(record.args)}`;
}

function runCapture() {
  const outDir = mkdtempSync(join(tmpdir(), 'ccp-golden-diff-'));
  const outPath = join(outDir, 'after.json');
  const result = spawnSync(process.execPath, [CAPTURE_SCRIPT, '--out', outPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0 && result.status !== 1) {
    // capture.mjs exits 1 on script-level failures/contamination, which we
    // still want to surface below rather than treat as a hard crash here.
    console.error('capture.mjs crashed:\n' + (result.stderr || result.stdout || ''));
    process.exit(2);
  }
  const after = JSON.parse(readFileSync(outPath, 'utf8'));
  rmSync(outDir, { recursive: true, force: true });
  return after;
}

function main() {
  const before = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const after = runCapture();

  const beforeByKey = new Map(before.scenarios.map((r) => [keyOf(r), r]));
  const afterByKey = new Map(after.scenarios.map((r) => [keyOf(r), r]));

  const scope = cliFilter === 'all' ? null : cliFilter;
  const keys = [...beforeByKey.keys()].filter((k) => !scope || k.includes(`::${scope}::`));

  let diffCount = 0;
  let missingCount = 0;
  let checked = 0;

  for (const key of keys) {
    const b = beforeByKey.get(key);
    const a = afterByKey.get(key);
    if (!a) {
      missingCount += 1;
      console.log(`MISSING after-capture: ${key}`);
      continue;
    }
    checked += 1;
    const mb = maskRecord(b);
    const ma = maskRecord(a);
    const same = mb.exit_code === ma.exit_code && mb.stdout === ma.stdout && mb.stderr === ma.stderr;
    if (!same) {
      diffCount += 1;
      console.log(`DIFF: ${key}`);
      if (verbose || true) {
        console.log(`  exit_code: ${mb.exit_code} -> ${ma.exit_code}`);
        if (mb.stdout !== ma.stdout) {
          console.log(`  stdout (before): ${mb.stdout}`);
          console.log(`  stdout (after):  ${ma.stdout}`);
        }
        if (mb.stderr !== ma.stderr) {
          console.log(`  stderr (before): ${JSON.stringify(mb.stderr)}`);
          console.log(`  stderr (after):  ${JSON.stringify(ma.stderr)}`);
        }
      }
    }
  }

  console.log(`\nchecked=${checked} diff=${diffCount} missing_after=${missingCount} scope=${cliFilter}`);
  process.exit(diffCount > 0 || missingCount > 0 ? 1 : 0);
}

main();
