#!/usr/bin/env node
// CCP — F-1 truncation-path validation harness (companion core-integration).
//
// Independent of tests/companion/golden/: the golden stubs' `ok` mode
// deliberately fails every real task call (see golden/stubs/agy's header),
// so they cannot exercise a long, successful CLI response — exactly the
// input F-1 (summary truncated at a sentence boundary, `summary_truncated`
// emitted only when true, full body preserved at `result_path`) needs to be
// driven through. This harness writes its own throwaway stub CLIs into a
// fresh temp directory per run (never touching golden/stubs/), points
// CCP_AGY_BIN / CCP_CODEX_BIN and CCP_JOBS_DIR at that same temp directory,
// and invokes the real companion entry points exactly like golden/capture.mjs
// does. It never seeds or reads golden/baseline/companion-baseline.json, so
// the golden 29-record baseline is unaffected by anything in this file.
//
// Usage:
//   node tests/companion/truncation-probe.mjs
//
// Real-CLI/network access: none. Everything runs against the throwaway
// stubs this script writes for itself. Exit code 0 = all checks passed.
//
// Covers PRD `01_prd.md` §5 AC-F1-1 through AC-F1-11. AC-F1-9's full-plugin
// grep is included for visibility but is a known partial: `core/errors.mjs`
// and two `commands/*.md` files still name `CCP-CTX-001` as of this batch —
// they are outside this batch's approved edit scope (see
// `_workspace/04_implementation_progress.md`), not an unnoticed miss.
//
// No JSON Schema engine is available in this dependency-free repo (no
// package.json, no node_modules — confirmed before writing this file). Per
// `01_schema.md` §7 SC-4, the project's own practice for this gap is to
// treat `lib/envelope-validate.mjs`'s hand-rolled `validateEnvelope()` as
// the schema's runtime proxy and cross-check the two stay in agreement —
// AC-F1-11 below follows that same practice rather than vendoring a new
// dependency for one test file.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEnvelope } from '../../plugins/ccp/scripts/lib/envelope-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'plugins', 'ccp', 'scripts');
const COMPANION = {
  antigravity: join(SCRIPTS_DIR, 'antigravity-companion.mjs'),
  codex: join(SCRIPTS_DIR, 'codex-companion.mjs'),
};
const SCHEMA_PATH = join(REPO_ROOT, 'plugins', 'ccp', 'schemas', 'envelope.schema.json');
const TASK_PROMPT = 'Summarize this directory';

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

function note(label, value) {
  console.log(`  note ${label}: ${value}`);
}

// ---------------------------------------------------------------------------
// fixtures — 02_token_scenarios.md §1.4. Sizes are approximate (the design
// doc's 180/1,200 figures describe intent, not a byte-exact contract); what
// matters for every check below is SHORT staying under the cap and the two
// LONG_* fixtures clearing it while exercising the sentence-boundary and
// whitespace-fallback paths respectively. Both LONG_* fixtures are kept on a
// single line (no \n) on purpose: antigravity's own summarize() keeps only
// the first 3 lines of the body, so a multi-line fixture would get clipped
// by the adapter before core's own boundary-cut logic ever runs on it.
// ---------------------------------------------------------------------------

function buildShort() {
  return 'This is a short delegated response. It stays well under the summary cap.';
}

function buildLongSentenced(minLen) {
  const sentence = 'The delegated response keeps growing until it must be cut at a sentence boundary. ';
  let out = '';
  while (out.length < minLen) out += sentence;
  return out.trim(); // ends in '.', no newlines
}

function buildLongUnsentenced(minLen) {
  // Korean, space-separated, with no sentence-terminal punctuation anywhere
  // — forces clampSummaryAtBoundary's whitespace-boundary fallback.
  const chunk = '이것은 문장부호가 전혀 없이 계속 이어지는 위임 응답 본문의 한 조각인데 ';
  let out = '';
  while (out.length < minLen) out += chunk;
  return out.trim(); // no '.', '!', '?', '…', '。', '！', '？' anywhere
}

const FIXTURES = {
  SHORT: buildShort(),
  LONG_SENTENCED: buildLongSentenced(1200),
  LONG_UNSENTENCED: buildLongUnsentenced(1200),
};

// ---------------------------------------------------------------------------
// throwaway stub CLIs — written fresh into the isolated temp dir per probe
// run. Unlike golden/stubs/*, these DO simulate a successful real task call
// (that's the whole point — see the module header), always returning
// whichever fixture the env var below points at.
// ---------------------------------------------------------------------------

const AGY_STUB_SRC = `#!/usr/bin/env node
// truncation-probe throwaway stub — not golden/stubs/agy, never used there.
import { readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('agy version 1.2.0\\n'); process.exit(0); }
const pIndex = argv.indexOf('-p');
if (pIndex !== -1) {
  const prompt = argv[pIndex + 1] || '';
  if (prompt === 'ping') process.exit(0); // auth probe (unused — antigravity's rescueGate is 'detect')
  process.stdout.write(readFileSync(process.env.PROBE_FIXTURE_FILE, 'utf8'));
  process.exit(0);
}
process.stderr.write('truncation-probe stub agy: unhandled args ' + JSON.stringify(argv) + '\\n');
process.exit(1);
`;

const CODEX_STUB_SRC = `#!/usr/bin/env node
// truncation-probe throwaway stub — not golden/stubs/codex, never used there.
import { readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('codex-cli 0.130.0\\n'); process.exit(0); }
if (argv[0] === 'login' && argv[1] === 'status') { process.stderr.write('Logged in using ChatGPT\\n'); process.exit(0); }
if (argv[0] === 'exec') {
  const text = readFileSync(process.env.PROBE_FIXTURE_FILE, 'utf8');
  const threadId = '33333333-3333-4333-8333-333333333333';
  const events = [
    { type: 'thread.started', thread_id: threadId },
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text } },
    { type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 40 } },
  ];
  for (const ev of events) process.stdout.write(JSON.stringify(ev) + '\\n');
  process.exit(0);
}
process.stderr.write('truncation-probe stub codex: unhandled args ' + JSON.stringify(argv) + '\\n');
process.exit(1);
`;

function setupProbeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ccp-truncation-probe-'));
  const agyPath = join(dir, 'agy-stub.mjs');
  const codexPath = join(dir, 'codex-stub.mjs');
  writeFileSync(agyPath, AGY_STUB_SRC, 'utf8');
  writeFileSync(codexPath, CODEX_STUB_SRC, 'utf8');
  chmodSync(agyPath, 0o755);
  chmodSync(codexPath, 0o755);
  const jobsDir = join(dir, 'jobs');
  mkdirSync(jobsDir, { recursive: true });
  return { dir, jobsDir, stubBin: { antigravity: agyPath, codex: codexPath } };
}

function writeFixtureFile(dir, uniqueLabel, fixtureName) {
  const path = join(dir, `fixture-${uniqueLabel}.txt`);
  writeFileSync(path, FIXTURES[fixtureName], 'utf8');
  return path;
}

function parseEnvelope(stdout) {
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function countDirs(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).length;
}

/**
 * Runs one foreground `rescue` call against the real companion entry point.
 * @param {'antigravity'|'codex'} cli
 * @param {keyof typeof FIXTURES} fixtureName
 * @param {{ jobsDir: string, stubBin: Record<string,string> }} probeDir
 */
function runRescue(cli, fixtureName, probeDir) {
  const fixturePath = writeFixtureFile(probeDir.dir, `${cli}-${fixtureName}-${Date.now()}-${Math.random().toString(36).slice(2)}`, fixtureName);
  const binEnvKey = cli === 'antigravity' ? 'CCP_AGY_BIN' : 'CCP_CODEX_BIN';
  const env = {
    ...process.env,
    [binEnvKey]: probeDir.stubBin[cli],
    CCP_JOBS_DIR: probeDir.jobsDir,
    PROBE_FIXTURE_FILE: fixturePath,
    ANTIGRAVITY_API_KEY: 'probe-test-key', // satisfies antigravity's detect()-only rescueGate
  };
  const before = countDirs(probeDir.jobsDir);
  const r = spawnSync(process.execPath, [COMPANION[cli], 'rescue', TASK_PROMPT], { encoding: 'utf8', env, timeout: 15000 });
  const after = countDirs(probeDir.jobsDir);
  return {
    cli,
    fixtureName,
    fixtureBody: FIXTURES[fixtureName],
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    envelope: parseEnvelope(r.stdout),
    jobDirsCreated: after - before,
  };
}

/** Finds the boundary in the original fixture text where a run's summary was cut. */
function findCutBoundaryOk(summaryWithoutMarker, fixtureBody) {
  const len = summaryWithoutMarker.length;
  if (!fixtureBody.startsWith(summaryWithoutMarker)) return false;
  const nextChar = fixtureBody[len];
  return nextChar === undefined || /\s/.test(nextChar);
}

// ---------------------------------------------------------------------------
// AC-F1-10 / RC-F1-9 — output-contract prevention layer, buildArgs unit calls
// ---------------------------------------------------------------------------

console.log('1. AC-F1-10 — output-contract prompt suffix in buildArgs (unit calls, no CLI spawned)');

{
  const antigravityAdapterPath = join(SCRIPTS_DIR, 'adapters', 'antigravity.mjs');
  const codexAdapterPath = join(SCRIPTS_DIR, 'adapters', 'codex.mjs');
  const { default: antigravityAdapter } = await import(antigravityAdapterPath);
  const { default: codexAdapter } = await import(codexAdapterPath);

  const OUTPUT_CONTRACT_NEEDLE = 'open with a summary of at most 3 lines and 500 characters';

  const agyArgsDefault = antigravityAdapter.buildArgs({ prompt: 'x' });
  check(
    'antigravity buildArgs (default maxTokens) includes the output contract in the -p value',
    agyArgsDefault[agyArgsDefault.length - 1].includes(OUTPUT_CONTRACT_NEEDLE),
    JSON.stringify(agyArgsDefault)
  );

  const agyArgsZeroTokens = antigravityAdapter.buildArgs({ prompt: 'x', maxTokens: 0 });
  check(
    'antigravity buildArgs (maxTokens: 0) still includes the output contract — independent of the token-hint branch',
    agyArgsZeroTokens[agyArgsZeroTokens.length - 1].includes(OUTPUT_CONTRACT_NEEDLE),
    JSON.stringify(agyArgsZeroTokens)
  );

  check(
    'antigravity auth.probeArgs is untouched by the output contract (does not go through buildArgs)',
    JSON.stringify(antigravityAdapter.auth.probeArgs) === JSON.stringify(['-p', 'ping']),
    JSON.stringify(antigravityAdapter.auth.probeArgs)
  );

  const codexArgs = codexAdapter.buildArgs({ prompt: 'x' });
  check(
    'codex buildArgs includes the output contract in the prompt argument',
    codexArgs[codexArgs.length - 1].includes(OUTPUT_CONTRACT_NEEDLE),
    JSON.stringify(codexArgs)
  );
}

// ---------------------------------------------------------------------------
// AC-F1-1 ~ AC-F1-8 — end-to-end truncation behavior
// ---------------------------------------------------------------------------

console.log('\n2. AC-F1-1 ~ AC-F1-8 — foreground rescue, long response (sentence-boundary path)');

const probeDir = setupProbeDir();
try {
  for (const cli of ['antigravity', 'codex']) {
    const r = runRescue(cli, 'LONG_SENTENCED', probeDir);
    const env = r.envelope;

    check(`[${cli}] AC-F1-1 exit_code === 0 and stdout is a success envelope`, r.status === 0 && env && 'summary' in env && !('error' in env), JSON.stringify(env));

    if (cli === 'codex') {
      // codex's summarize() is an identity function, so core's own
      // checkContextBudget/clampSummaryAtBoundary is guaranteed to fire here.
      check('[codex] AC-F1-2 summary_truncated === true', env?.summary_truncated === true, JSON.stringify(env));
    } else {
      // antigravity's own summarize() already hard-clips to <=500 chars
      // before core ever sees the text (adapters/antigravity.mjs — a
      // pre-existing, out-of-round-scope adapter-side clamp), so core's
      // truncation path is not guaranteed to trigger on this CLI. Per
      // 02_token_scenarios.md TS-1 item 5, that is not a failure — recorded
      // as an observation, not a check().
      note('[antigravity] summary_truncated observed as', JSON.stringify(env?.summary_truncated));
    }

    check(`[${cli}] AC-F1-3 summary.length <= 500`, typeof env?.summary === 'string' && env.summary.length <= 500, `len=${env?.summary?.length}`);

    if (env?.summary_truncated === true) {
      check(`[${cli}] AC-F1-4 summary ends with the truncation marker`, env.summary.endsWith('...(truncated)'), env.summary);
    }

    check(`[${cli}] AC-F1-5 result_path is non-null and the file exists`, typeof env?.result_path === 'string' && existsSync(env.result_path), env?.result_path);

    if (typeof env?.result_path === 'string' && existsSync(env.result_path)) {
      const fileContent = readFileSync(env.result_path, 'utf8');
      // AC-F1-6, corrected per arch-review M-1: compared against the
      // adapter-extracted body (parsedRes.body), which for both stubs here
      // is byte-identical to the raw fixture — not against `summary`.
      check(`[${cli}] AC-F1-6 result file holds the full body, not the truncated summary`, fileContent === r.fixtureBody, `len file=${fileContent.length} len fixture=${r.fixtureBody.length}`);
    }

    if (env?.summary_truncated === true) {
      const withoutMarker = env.summary.slice(0, env.summary.length - '...(truncated)'.length);
      const lastChar = withoutMarker[withoutMarker.length - 1];
      const endsOnSentence = '.!?…。！？'.includes(lastChar) || lastChar === '\n';
      check(
        `[${cli}] AC-F1-7 cut lands on a sentence boundary (or falls back to a whitespace boundary)`,
        endsOnSentence || findCutBoundaryOk(withoutMarker, r.fixtureBody),
        JSON.stringify({ withoutMarker: withoutMarker.slice(-40) })
      );
    }
  }

  console.log('\n3. AC-F1-8 — short response leaves summary_truncated unset (bytewise no-op path)');
  for (const cli of ['antigravity', 'codex']) {
    const r = runRescue(cli, 'SHORT', probeDir);
    check(`[${cli}] AC-F1-8 no summary_truncated key at all (not even false)`, r.envelope && !('summary_truncated' in r.envelope), JSON.stringify(r.envelope));
    check(`[${cli}] SHORT summary equals the fixture body verbatim (no clamping applied)`, r.envelope?.summary === r.fixtureBody, r.envelope?.summary);
  }

  console.log('\n4. AC-F1-7 (whitespace fallback) — codex, no sentence-terminal punctuation in the fixture');
  {
    const r = runRescue('codex', 'LONG_UNSENTENCED', probeDir);
    const env = r.envelope;
    check('[codex] LONG_UNSENTENCED still succeeds and truncates', r.status === 0 && env?.summary_truncated === true, JSON.stringify(env));
    if (env?.summary_truncated === true) {
      const withoutMarker = env.summary.slice(0, env.summary.length - '...(truncated)'.length);
      const lastChar = withoutMarker[withoutMarker.length - 1];
      check(
        '[codex] no sentence-terminal char in the fixture, so the cut is NOT a sentence boundary — must be a whitespace boundary instead',
        !'.!?…。！？'.includes(lastChar) && findCutBoundaryOk(withoutMarker, r.fixtureBody),
        JSON.stringify({ lastChar, withoutMarker: withoutMarker.slice(-40) })
      );
    }
  }

  console.log('\n5. Supplementary — truncation-triggered persistence for a stateless-foreground adapter (H-3)');
  {
    const shortRun = runRescue('codex', 'SHORT', probeDir);
    check('[codex] SHORT leaves job dir count unchanged (stateless fast path preserved)', shortRun.jobDirsCreated === 0, `created=${shortRun.jobDirsCreated}`);

    const longRun = runRescue('codex', 'LONG_SENTENCED', probeDir);
    check('[codex] LONG_SENTENCED creates exactly 1 new job dir (truncation-triggered persistence)', longRun.jobDirsCreated === 1, `created=${longRun.jobDirsCreated}`);
    if (typeof longRun.envelope?.result_path === 'string') {
      const jobDir = dirname(longRun.envelope.result_path);
      const metaPath = join(jobDir, 'meta.json');
      check('[codex] that directory has no meta.json (no lifecycle owner — a known, recorded limitation, not a fix)', !existsSync(metaPath), metaPath);
    }
  }
} finally {
  rmSync(probeDir.dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// AC-F1-9 — full-plugin grep for CCP-CTX-001 (see module header re: the two
// known, out-of-scope-this-batch doc hits + core/errors.mjs's shared entry)
// ---------------------------------------------------------------------------

console.log('\n6. AC-F1-9 — grep -rn "CCP-CTX-001" plugins/');
{
  const grep = spawnSync('grep', ['-rn', 'CCP-CTX-001', join(REPO_ROOT, 'plugins')], { encoding: 'utf8' });
  const hits = (grep.stdout || '').trim().split('\n').filter(Boolean);
  check('AC-F1-9 grep finds 0 hits (literal PRD wording)', hits.length === 0, `${hits.length} hit(s):\n    ${hits.join('\n    ')}`);
  // The check above is expected to legitimately FAIL right now — see the
  // module header. Emitter-side confirmation (the part this batch actually
  // owns) instead:
  const codeGrep = spawnSync('grep', ['-rln', 'CCP-CTX-001', join(SCRIPTS_DIR), join(REPO_ROOT, 'plugins', 'ccp', 'hooks')], { encoding: 'utf8' });
  const codeHits = (codeGrep.stdout || '').trim().split('\n').filter(Boolean).filter((f) => !f.endsWith('errors.mjs'));
  check('no emitter code (outside core/errors.mjs\'s shared catalog) references CCP-CTX-001', codeHits.length === 0, JSON.stringify(codeHits));
}

// ---------------------------------------------------------------------------
// AC-F1-11 — schema + self-validator agreement (no JSON Schema engine
// available in this repo — see module header)
// ---------------------------------------------------------------------------

console.log('\n7. AC-F1-11 — schema declaration + self-validator agreement');
{
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const prop = schema.$defs?.successEnvelope?.properties?.summary_truncated;
  check('schema declares successEnvelope.properties.summary_truncated as {type: boolean, const: true}', prop?.type === 'boolean' && prop?.const === true, JSON.stringify(prop));

  const truncatedEnvelope = { summary: 'x'.repeat(486) + '...(truncated)', summary_truncated: true, result_path: '/tmp/x/result.txt', tokens: { input: 1, output: 1 }, exit_code: 0, details: { mode: 'codex', codex_thread_id: null } };
  const r1 = validateEnvelope(truncatedEnvelope);
  check('validateEnvelope() accepts a truncated envelope (summary_truncated: true)', r1.valid, JSON.stringify(r1.errors));

  const noKeyEnvelope = { summary: 'short', tokens: { input: 1, output: 1 }, exit_code: 0 };
  const r2 = validateEnvelope(noKeyEnvelope);
  check('validateEnvelope() accepts an envelope with the key entirely absent', r2.valid, JSON.stringify(r2.errors));

  const falseEnvelope = { summary: 'short', summary_truncated: false, tokens: { input: 1, output: 1 }, exit_code: 0 };
  const r3 = validateEnvelope(falseEnvelope);
  check('validateEnvelope() REJECTS summary_truncated: false (matches the schema\'s const:true)', !r3.valid && r3.errors.some((e) => e.includes('summary_truncated')), JSON.stringify(r3.errors));
}

// ---------------------------------------------------------------------------

console.log(`\nResult: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(fail > 0 ? 1 : 0);
