#!/usr/bin/env node
// CCP — router auto-delegation forwarding overhead measurement.
//
// Measures the size of the router-decide envelope that is absorbed into the
// main Claude context when the router agent auto-delegates. Compares against
// the manual-slash baseline so the absorption overhead can be capped.
//
// Method:
//   - Run 3 representative prompts × N=3 samples each.
//   - Estimate tokens from the envelope JSON character length (~4 chars/token).
//
// Pass thresholds:
//   - mean absorbed tokens ≤ 250 tok
//   - max CV across tasks ≤ 10%

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const ROUTER_DECIDE = resolve(REPO_ROOT, 'plugins', 'ccp', 'scripts', 'lib', 'router-decide.mjs');

const TASKS = [
  { id: 'T1', label: 'large-context summarization (gemini)', prompt: '이 디렉토리 전체 요약' },
  { id: 'T2', label: 'code review (codex)', prompt: '이 PR 검토해줘' },
  { id: 'T3', label: 'large-input forced (gemini)', prompt: 'review the entire codebase and summarize all the markdown files' },
];

const N = 3;

// rough per-character token estimate (~4 chars/token for ASCII-heavy JSON)
function estimateTokensFromChars(text) {
  return Math.ceil(String(text || '').length / 4);
}

function makePluginRoot(autoRouting) {
  const dir = mkdtempSync(resolve(tmpdir(), 'ccp-router-measure-'));
  mkdirSync(resolve(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    resolve(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'ccp', version: '0.1.0', config: { auto_routing: autoRouting } })
  );
  return dir;
}

function runDecide(prompt, root) {
  const result = spawnSync('node', [ROUTER_DECIDE, '--prompt', prompt], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, CI: '', CLAUDE_CODE_NONINTERACTIVE: '' },
  });
  return result.stdout || '';
}

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

// --- main ------------------------------------------------------------------

const root = makePluginRoot(true);
const results = [];

console.log('# Router auto-delegation forwarding overhead (N=3 per task, 3 tasks)\n');
console.log('Targets: mean absorbed tokens ≤ 250 tok, max CV ≤ 10%\n');

try {
  for (const task of TASKS) {
    const samples = [];
    for (let i = 0; i < N; i++) {
      const stdout = runDecide(task.prompt, root);
      const charLen = stdout.trim().length;
      const tok = estimateTokensFromChars(stdout);
      samples.push({ charLen, tok });
    }
    const charLens = samples.map((s) => s.charLen);
    const toks = samples.map((s) => s.tok);
    const m = mean(toks);
    const sd = stddev(toks);
    const cv = m > 0 ? sd / m : 0;
    results.push({ task, samples, mean: m, stddev: sd, cv });

    console.log(`## ${task.id} — ${task.label}`);
    console.log(`prompt: "${task.prompt}"`);
    console.log(`samples (chars): [${charLens.join(', ')}]`);
    console.log(`samples (tokens): [${toks.join(', ')}]`);
    console.log(`mean=${m.toFixed(1)} tok, stddev=${sd.toFixed(2)}, CV=${(cv * 100).toFixed(2)}%`);
    console.log();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

// --- summary ---------------------------------------------------------------

const allMeans = results.map((r) => r.mean);
const grandMean = mean(allMeans);
const maxCv = Math.max(...results.map((r) => r.cv));

console.log('---\n## Summary');
console.log(`grand mean (3 tasks × 3 samples): ${grandMean.toFixed(1)} tok`);
console.log(`max CV across tasks: ${(maxCv * 100).toFixed(2)}%`);

const PASS_TOK = 250;
const PASS_CV = 0.10;

const passTok = grandMean <= PASS_TOK;
const passCv = maxCv <= PASS_CV;

console.log('\n### Verdict');
console.log(`- mean tokens ≤ ${PASS_TOK} → ${passTok ? '✅' : '❌'} (${grandMean.toFixed(1)})`);
console.log(`- CV ≤ ${(PASS_CV * 100).toFixed(0)}% → ${passCv ? '✅' : '❌'} (${(maxCv * 100).toFixed(2)}%)`);

if (passTok && passCv) {
  console.log('\n**Verdict: ✅ PASS**');
  process.exit(0);
} else {
  console.log('\n**Verdict: ❌ FAIL**');
  process.exit(1);
}
