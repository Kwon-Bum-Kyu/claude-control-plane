#!/usr/bin/env node
// CCP — harness-audit script (port of ecc harness-audit.js)
// Subcommand entry: /ccp:audit [--since YYYY-MM-DD] [--format md|json]
// Output: JSON envelope (foreground success) + persisted report at _workspace/_audits/<ts>.{md,json}
//
// Originally derived from: github.com/affaan-m/everything-claude-code (scripts/harness-audit.js)
// Original license: MIT — see /ATTRIBUTION.md §1.1
// Modifications: 7-category rubric retuned for CCP workloads (envelope/router/secret_leak),
//                _workspace/_audits/ output path, foreground-success envelope wrapper.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.length > 0
    ? resolve(process.env.CLAUDE_PLUGIN_ROOT)
    : resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(PLUGIN_ROOT, '..', '..');
const JOBS_DIR =
  process.env.CCP_JOBS_DIR && process.env.CCP_JOBS_DIR.length > 0
    ? resolve(process.env.CCP_JOBS_DIR)
    : resolve(REPO_ROOT, '_workspace', '_jobs');
const AUDITS_DIR = resolve(REPO_ROOT, '_workspace', '_audits');

const SUMMARY_MAX_CHARS = 500;

// ---------------------------------------------------------------------------
// Envelope helpers (mirror gemini-companion.mjs contract)
// ---------------------------------------------------------------------------

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope) + '\n');
}

function emitSuccess({ summary, result_path, details }) {
  const env = {
    summary: clamp(summary),
    result_path: result_path ?? null,
    tokens: { input: 0, output: 0 },
    exit_code: 0,
  };
  if (details && typeof details === 'object') env.details = details;
  emit(env);
  process.exit(0);
}

function emitError(code, message_ko, action_ko, details) {
  const env = {
    error: {
      code,
      message_ko,
      action_ko,
      recovery: code === 'CCP-AUDIT-002' ? 'retry' : 'abort',
    },
    exit_code: 1,
  };
  if (details) env.error.details = details;
  emit(env);
  process.exit(1);
}

function clamp(text) {
  if (!text) return '';
  return text.length <= SUMMARY_MAX_CHARS
    ? text
    : text.slice(0, SUMMARY_MAX_CHARS - 16) + '...(truncated)';
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { format: 'md' };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--since') out.since = argv[++i];
    else if (tok === '--format') out.format = argv[++i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Job collection
// ---------------------------------------------------------------------------

function readJobs(sinceTs) {
  if (!existsSync(JOBS_DIR)) return [];
  const out = [];
  let entries;
  try {
    entries = readdirSync(JOBS_DIR);
  } catch {
    return [];
  }
  for (const id of entries) {
    const dir = join(JOBS_DIR, id);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const metaPath = join(dir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      continue;
    }
    if (sinceTs) {
      const created = Date.parse(meta.created_at || '');
      if (Number.isFinite(created) && created < sinceTs) continue;
    }
    out.push(meta);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7-category scoring
// ---------------------------------------------------------------------------

function scoreContextEfficiency(jobs) {
  // RC-1 — summary length <= 500 chars / total summary length stays small
  if (jobs.length === 0) return { score: 0, n: 0, note: 'no jobs' };
  const compliant = jobs.filter(
    (j) => !j.summary_3lines || j.summary_3lines.length <= 500
  ).length;
  const ratio = compliant / jobs.length;
  return {
    score: Math.round(ratio * 5),
    n: jobs.length,
    note: `${compliant}/${jobs.length} jobs <= 500 chars`,
  };
}

function scoreCostEfficiency(jobs) {
  // Ratio of jobs with token stats present (actual savings rate finalized in the S4-4 measurement report)
  if (jobs.length === 0) return { score: 0, n: 0, note: 'no jobs' };
  const measured = jobs.filter(
    (j) => j.token_usage && j.token_usage.estimated === false
  ).length;
  const ratio = measured / jobs.length;
  return {
    score: Math.round(ratio * 5),
    n: jobs.length,
    note: `${measured}/${jobs.length} jobs with measured CLI stats`,
  };
}

function scoreRouterAccuracy() {
  // Cite the S4-3 report (_workspace/04_router_report.md) if present; otherwise N/A
  const report = resolve(REPO_ROOT, '_workspace', '04_router_report.md');
  if (!existsSync(report)) return { score: null, note: 'router report not written (waiting on S4-3)' };
  return { score: 5, note: 'router report completed' };
}

function scoreDoubleBilling(jobs) {
  // R1 — meta.summary_3lines must be shorter than the result_file_path body size
  if (jobs.length === 0) return { score: 0, n: 0, note: 'no jobs' };
  let safe = 0;
  for (const j of jobs) {
    if (!j.summary_3lines) {
      safe++;
      continue;
    }
    if (!j.result_file_path) continue;
    const abs = resolve(REPO_ROOT, j.result_file_path);
    if (!existsSync(abs)) continue;
    let bodyLen = 0;
    try {
      bodyLen = statSync(abs).size;
    } catch {
      continue;
    }
    if (j.summary_3lines.length < bodyLen) safe++;
  }
  return {
    score: jobs.length > 0 ? Math.round((safe / jobs.length) * 5) : 0,
    n: jobs.length,
    note: `${safe}/${jobs.length} jobs summary < body`,
  };
}

function scoreFallbackHealth(jobs) {
  // R6 — Estimate recovery rate after user re-invocation following OAuth expiry.
  // Here we approximate it with the OAuth error-code ratio and user re-invocation (--fallback-claude) count.
  if (jobs.length === 0) return { score: null, note: 'no jobs' };
  const oauth = jobs.filter((j) => j.error?.code === 'CCP-OAUTH-001').length;
  if (oauth === 0) return { score: 5, note: '0 OAuth errors' };
  return { score: 3, note: `${oauth} OAuth errors - re-invocation tracking not implemented (P1)` };
}

function scorePluginCompat() {
  // R4 — Verify compliance with the official plugin.json schema.
  // In Phase 5-A T5, minClaudeVersion/engines were confirmed as nonstandard keys and removed
  // (`_workspace/05_phase5a_install_troubleshooting.md` §T5). Therefore this check
  // validates only the 5 standard keys from the official plugins-reference (B15 / 2026-04-27).
  const pluginJson = resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
  if (!existsSync(pluginJson)) return { score: 0, note: 'plugin.json missing' };
  let obj;
  try {
    obj = JSON.parse(readFileSync(pluginJson, 'utf8'));
  } catch {
    return { score: 0, note: 'plugin.json parse failed' };
  }
  const nonEmpty = (k) => {
    const v = obj?.[k];
    if (v == null) return false;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return Boolean(v);
  };
  const checks = [
    nonEmpty('name'),
    nonEmpty('version'),
    nonEmpty('description'),
    nonEmpty('author'),
    nonEmpty('license'),
  ];
  const ok = checks.filter(Boolean).length;
  return {
    score: Math.round((ok / checks.length) * 5),
    note: `${ok}/${checks.length} standard fields present (name/version/description/author/license)`,
  };
}

function scoreAdaptedHeaders() {
  // G1-I (added in B1) — borrowed files under lib/codex_adapted/ require a 5-field header.
  // Missing headers break license traceability by diverging from ATTRIBUTION §6 / NOTICE.
  const dir = resolve(PLUGIN_ROOT, 'scripts', 'lib', 'codex_adapted');
  if (!existsSync(dir)) {
    return { score: null, note: 'lib/codex_adapted/ missing (pre-B1 stage)' };
  }
  const required = [
    /^\/\/ Adapted from:/m,
    /^\/\/ Source commit:/m,
    /^\/\/ Original license:/m,
    /^\/\/ Modifications:/m,
    /^\/\/ SHA-of-this-adaptation:/m,
  ];
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') || f.endsWith('.js'));
  if (files.length === 0) return { score: null, note: 'lib/codex_adapted/ is empty' };
  let pass = 0;
  const failed = [];
  for (const f of files) {
    const head = readFileSync(join(dir, f), 'utf8').slice(0, 1024);
    const ok = required.every((re) => re.test(head));
    if (ok) pass += 1;
    else failed.push(f);
  }
  const score = Math.round((pass / files.length) * 5);
  const note =
    failed.length === 0
      ? `${pass}/${files.length} files have the 5-field header`
      : `${pass}/${files.length} pass, missing: ${failed.join(', ')}`;
  return { score, note };
}

function scoreSecretLeak(jobs) {
  // L5·L6 — grep secret-pattern matches in meta.json / summary_3lines / details
  const blocked = /(Bearer\s+[A-Za-z0-9._-]+|GEMINI_API_KEY|AKIA[0-9A-Z]{16})/i;
  let leaks = 0;
  for (const j of jobs) {
    const blob = JSON.stringify(j);
    if (blocked.test(blob)) leaks++;
  }
  return {
    score: leaks === 0 ? 5 : 0,
    n: jobs.length,
    note: leaks === 0 ? '0 secret leaks' : `${leaks} suspected leaks`,
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown({ scores, jobs, since, generatedAt }) {
  const lines = [];
  lines.push(`# CCP Audit Report`);
  lines.push('');
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push(`- Audit scope: ${since ? `since ${since}` : 'all jobs'}`);
  lines.push(`- Jobs scanned: ${jobs.length}`);
  lines.push('');
  lines.push('## 7 Category Scores');
  lines.push('');
  lines.push('| Category | Score (0-5) | Note |');
  lines.push('|---------|----------|------|');
  for (const [k, v] of Object.entries(scores)) {
    lines.push(`| ${k} | ${v.score ?? 'N/A'} | ${v.note ?? ''} |`);
  }
  lines.push('');
  lines.push('## Spec SSOT');
  lines.push('- `_workspace/01_command_spec.md` §"/ccp:audit"');
  lines.push('- `_workspace/02_regression_cases.md` (RC-1~RC-7)');
  lines.push('- `_workspace/02_arch_decisions.md` Principle 7 (subagent isolation)');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sinceTs = args.since ? Date.parse(args.since) : null;
  const jobs = readJobs(sinceTs);

  if (jobs.length === 0) {
    return emitError(
      'CCP-AUDIT-001',
      'No session data available to audit',
      args.since
        ? `No meta.json exists in _workspace/_jobs/ since ${args.since}.`
        : '_workspace/_jobs/ is empty or missing.'
    );
  }

  const scoreEntries = {
    context_efficiency: scoreContextEfficiency(jobs),
    cost_efficiency: scoreCostEfficiency(jobs),
    router_accuracy: scoreRouterAccuracy(),
    double_billing: scoreDoubleBilling(jobs),
    fallback_health: scoreFallbackHealth(jobs),
    plugin_compat: scorePluginCompat(),
    adapted_headers: scoreAdaptedHeaders(),
    secret_leak: scoreSecretLeak(jobs),
  };

  const numericScores = Object.values(scoreEntries)
    .map((v) => v.score)
    .filter((s) => Number.isFinite(s));
  const totalScore = numericScores.reduce((a, b) => a + b, 0);
  const maxScore = numericScores.length * 5;

  const generatedAt = new Date().toISOString();
  const tsForFile = generatedAt.replace(/[:.]/g, '').replace(/Z$/, 'Z');

  mkdirSync(AUDITS_DIR, { recursive: true });
  let resultRel;
  try {
    if (args.format === 'json') {
      resultRel = `_workspace/_audits/${tsForFile}.json`;
      writeFileSync(
        resolve(REPO_ROOT, resultRel),
        JSON.stringify({ scores: scoreEntries, jobs_count: jobs.length, since: args.since ?? null, generated_at: generatedAt }, null, 2)
      );
    } else {
      resultRel = `_workspace/_audits/${tsForFile}.md`;
      writeFileSync(
        resolve(REPO_ROOT, resultRel),
        renderMarkdown({ scores: scoreEntries, jobs, since: args.since, generatedAt })
      );
    }
  } catch (err) {
    return emitError('CCP-AUDIT-002', 'Failed to run the audit script', 'Retry shortly.', {
      stage: 'write_report',
      reason: err.message,
    });
  }

  // details.scores flattens scores only; detailed output stays in the report file
  const flatScores = {};
  for (const [k, v] of Object.entries(scoreEntries)) flatScores[k] = v.score;

  emitSuccess({
    summary: `Total score ${totalScore}/${maxScore}. ${jobs.length} jobs scanned. Report: ${resultRel}`,
    result_path: resultRel,
    details: { scores: flatScores, jobs_count: jobs.length, since: args.since ?? null },
  });
}

main();
