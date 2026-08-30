#!/usr/bin/env node
// CCP rescue-isolation fixture regression — runs rescue-isolation-test.mjs
// against every committed fixture case and compares the projected --json
// output to tests/subagent/fixtures/expected.json.
//
// This is what runs in CI: subagent transcripts are local Claude Code
// session storage, not part of this repository, so the real-session check
// (rescue-isolation-test.mjs itself) cannot run there. This runner exercises
// the same judgment engine against committed, anonymized, synthetic
// transcripts instead.
//
// Unlike the engine it drives, this runner never exits SKIP: a fixture is
// always present, so a missing fixture or an engine SKIP on a normal case
// means the check itself is broken, not that a session was unverifiable.
//
// Pass threshold: all cases pass (0 misclassifications, same rule as
// tests/router/router-eval.mjs — no partial credit).
// Run: node tests/subagent/rescue-isolation-fixture-test.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const ENGINE_PATH = join(HERE, 'rescue-isolation-test.mjs');
const FIXTURES_DIR = join(HERE, 'fixtures');
const EXPECTED_PATH = join(FIXTURES_DIR, 'expected.json');

// Non-fixture cases (§6 of 01_harness_spec.md) — cannot be represented as a
// committed directory, so the runner synthesizes their input path/precondition.
const NON_FIXTURE_PATH_NOT_FOUND = 'skip-path-not-found';
const NON_FIXTURE_UNSUPPORTED_INPUT = 'skip-unsupported-input';
const UNSUPPORTED_INPUT_REF_CASE = 'compliant-codex-alias-cache-path';

function harnessBroken(message) {
  console.log(`# rescue-isolation fixture regression\n`);
  console.log(`HARNESS BROKEN: ${message}`);
  process.exitCode = 1;
}

function readExpected() {
  let raw;
  try {
    raw = readFileSync(EXPECTED_PATH, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${EXPECTED_PATH} (${e.code ?? e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${EXPECTED_PATH} is not valid JSON (${e.message})`);
  }
}

// --- deep equality (no external dependency) --------------------------------

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// --- projection (§6 / 01_schema.md §2.4) ------------------------------------

function projectActual(engineOutput) {
  return {
    verdict: engineOutput.verdict,
    exit_code: engineOutput.exit_code,
    totals: engineOutput.totals,
    agents: (engineOutput.agents ?? []).map((a) => ({
      agent_type: a.agent_type,
      verdict: a.verdict,
      bash_tool_use_count: a.bash_tool_use_count,
      companion_rescue_count: a.companion_rescue_count,
      violation_kinds: (a.violations ?? []).map((v) => v.kind),
      skip_reason: a.skip_reason,
    })),
    skip_reasons: [...new Set((engineOutput.skips ?? []).map((s) => s.reason))].sort(),
  };
}

function projectExpected(caseObj) {
  return {
    verdict: caseObj.verdict,
    exit_code: caseObj.exit_code,
    totals: caseObj.totals,
    agents: caseObj.agents,
    skip_reasons: [...caseObj.skip_reasons].sort(),
  };
}

// --- engine invocation -------------------------------------------------------

function runEngine(inputPath) {
  const r = spawnSync(process.execPath, [ENGINE_PATH, inputPath, '--json'], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: REPO_ROOT,
  });
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse((r.stdout || '').trim());
  } catch (e) {
    parseError = e;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, parsed, parseError };
}

// --- per-case resolution ------------------------------------------------------

// Returns { inputPath } on success, or { brokenReason } if a hard
// precondition for a non-fixture case is violated (must not run the engine).
function resolveCaseInput(name) {
  if (name === NON_FIXTURE_PATH_NOT_FOUND) {
    const candidate = join(FIXTURES_DIR, name);
    if (existsSync(candidate)) {
      return { brokenReason: `${candidate} must not exist (this case tests SKIP on a genuinely absent path) but it does` };
    }
    return { inputPath: candidate };
  }
  if (name === NON_FIXTURE_UNSUPPORTED_INPUT) {
    const subDir = join(FIXTURES_DIR, UNSUPPORTED_INPUT_REF_CASE, 'subagents');
    let entries;
    try {
      entries = readdirSync(subDir);
    } catch (e) {
      return { brokenReason: `cannot read reference case directory ${subDir} (${e.code ?? e.message})` };
    }
    const metaFile = entries.find((f) => f.endsWith('.meta.json'));
    if (!metaFile) {
      return { brokenReason: `reference case ${UNSUPPORTED_INPUT_REF_CASE} has no .meta.json file to point --path at` };
    }
    const metaPath = join(subDir, metaFile);
    let st;
    try {
      st = statSync(metaPath);
    } catch (e) {
      return { brokenReason: `cannot stat ${metaPath} (${e.code ?? e.message})` };
    }
    if (!st.isFile()) {
      return { brokenReason: `${metaPath} is not a file` };
    }
    return { inputPath: metaPath };
  }
  const dir = join(FIXTURES_DIR, name);
  if (!existsSync(dir)) {
    return { brokenReason: `fixture directory ${dir} does not exist` };
  }
  return { inputPath: dir };
}

// --- main ---------------------------------------------------------------------

let expected;
try {
  expected = readExpected();
} catch (e) {
  harnessBroken(e.message);
  process.exit(1);
}

if (!expected || typeof expected !== 'object' || !expected.cases || typeof expected.cases !== 'object') {
  harnessBroken(`${EXPECTED_PATH} has no top-level "cases" object`);
  process.exit(1);
}

const caseNames = Object.keys(expected.cases);
if (caseNames.length === 0) {
  harnessBroken(`${EXPECTED_PATH} has zero cases`);
  process.exit(1);
}

console.log('# rescue-isolation fixture regression\n');

let pass = 0;
let fail = 0;
const failures = [];

for (const name of caseNames) {
  const expectedCase = expected.cases[name];
  const resolution = resolveCaseInput(name);

  if (resolution.brokenReason) {
    fail += 1;
    failures.push({ name, detail: `HARNESS BROKEN — ${resolution.brokenReason}` });
    console.log(`- ❌ ${name} — HARNESS BROKEN: ${resolution.brokenReason}`);
    continue;
  }

  const run = runEngine(resolution.inputPath);
  if (run.parseError) {
    fail += 1;
    const detail = `engine did not print valid JSON (exit ${run.status}): ${run.parseError.message}\nstdout: ${(run.stdout || '').slice(0, 400)}\nstderr: ${(run.stderr || '').slice(0, 400)}`;
    failures.push({ name, detail });
    console.log(`- ❌ ${name} — ${detail.split('\n')[0]}`);
    continue;
  }

  const actual = projectActual(run.parsed);
  const wanted = projectExpected(expectedCase);
  if (deepEqual(actual, wanted)) {
    pass += 1;
    console.log(`- ✅ ${name}`);
  } else {
    fail += 1;
    const detail = `expected: ${JSON.stringify(wanted)}\nactual:   ${JSON.stringify(actual)}`;
    failures.push({ name, detail });
    console.log(`- ❌ ${name}`);
    console.log(`     ${detail.split('\n')[0]}`);
    console.log(`     ${detail.split('\n')[1]}`);
  }
}

const total = caseNames.length;
console.log(`\n## Result: ${pass}/${total} PASS`);

if (fail === 0) {
  console.log(`**Verdict: ✅ PASS (${pass}/${total})**`);
  process.exit(0);
} else {
  console.log(`**Verdict: ❌ FAIL (${pass}/${total}, ${fail} mismatched)**`);
  for (const f of failures) {
    console.log(`\n[${f.name}]\n${f.detail}`);
  }
  process.exit(1);
}
