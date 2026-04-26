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
  // RC-1 — summary 길이 ≤ 500 자 / total summary length stays small
  if (jobs.length === 0) return { score: 0, n: 0, note: 'no jobs' };
  const compliant = jobs.filter(
    (j) => !j.summary_3lines || j.summary_3lines.length <= 500
  ).length;
  const ratio = compliant / jobs.length;
  return {
    score: Math.round(ratio * 5),
    n: jobs.length,
    note: `${compliant}/${jobs.length} jobs ≤ 500자`,
  };
}

function scoreCostEfficiency(jobs) {
  // 토큰 통계 존재 비율 (실제 절감률은 S4-4 측정 리포트에서 확정)
  if (jobs.length === 0) return { score: 0, n: 0, note: 'no jobs' };
  const measured = jobs.filter(
    (j) => j.token_usage && j.token_usage.estimated === false
  ).length;
  const ratio = measured / jobs.length;
  return {
    score: Math.round(ratio * 5),
    n: jobs.length,
    note: `${measured}/${jobs.length} jobs CLI stats 실측`,
  };
}

function scoreRouterAccuracy() {
  // S4-3 리포트(_workspace/04_router_report.md) 존재 시 인용, 없으면 N/A
  const report = resolve(REPO_ROOT, '_workspace', '04_router_report.md');
  if (!existsSync(report)) return { score: null, note: 'router report 미작성 (S4-3 대기)' };
  return { score: 5, note: 'router report 작성 완료' };
}

function scoreDoubleBilling(jobs) {
  // R1 — meta.summary_3lines 의 길이가 result_file_path 본문 크기보다 작아야 함
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
  // R6 — OAuth 만료 후 사용자 재호출 회복률 추정.
  // 여기서는 OAuth 에러 코드 비율과 사용자 재호출(--fallback-claude) 카운트로 근사.
  if (jobs.length === 0) return { score: null, note: 'no jobs' };
  const oauth = jobs.filter((j) => j.error?.code === 'CCP-OAUTH-001').length;
  if (oauth === 0) return { score: 5, note: 'OAuth 에러 0건' };
  return { score: 3, note: `OAuth 에러 ${oauth}건 — 재호출 추적 미구현(P1)` };
}

function scorePluginCompat() {
  // R4 — plugin.json 의 minClaudeVersion / engines 필드 존재 검증
  const pluginJson = resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
  if (!existsSync(pluginJson)) return { score: 0, note: 'plugin.json 부재' };
  let obj;
  try {
    obj = JSON.parse(readFileSync(pluginJson, 'utf8'));
  } catch {
    return { score: 0, note: 'plugin.json 파싱 실패' };
  }
  const has = (k) => k in (obj || {});
  const checks = [
    has('minClaudeVersion'),
    has('engines') && obj.engines?.node,
    has('engines') && obj.engines?.gemini_cli,
  ];
  const ok = checks.filter(Boolean).length;
  return { score: Math.round((ok / checks.length) * 5), note: `${ok}/3 fields 충족` };
}

function scoreSecretLeak(jobs) {
  // L5·L6 — meta.json / summary_3lines / details 에 비밀 정보 패턴 grep
  const blocked = /(Bearer\s+[A-Za-z0-9._-]+|GEMINI_API_KEY|AKIA[0-9A-Z]{16})/i;
  let leaks = 0;
  for (const j of jobs) {
    const blob = JSON.stringify(j);
    if (blocked.test(blob)) leaks++;
  }
  return {
    score: leaks === 0 ? 5 : 0,
    n: jobs.length,
    note: leaks === 0 ? '비밀 정보 누출 0건' : `${leaks}건 누출 의심`,
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown({ scores, jobs, since, generatedAt }) {
  const lines = [];
  lines.push(`# CCP Audit Report`);
  lines.push('');
  lines.push(`- 생성 시각: ${generatedAt}`);
  lines.push(`- 감사 범위: ${since ? `since ${since}` : '전체 jobs'}`);
  lines.push(`- 스캔된 job 수: ${jobs.length}`);
  lines.push('');
  lines.push('## 7 카테고리 점수');
  lines.push('');
  lines.push('| 카테고리 | 점수 (0~5) | 비고 |');
  lines.push('|---------|----------|------|');
  for (const [k, v] of Object.entries(scores)) {
    lines.push(`| ${k} | ${v.score ?? 'N/A'} | ${v.note ?? ''} |`);
  }
  lines.push('');
  lines.push('## 명세 SSOT');
  lines.push('- `_workspace/01_command_spec.md` §"/ccp:audit"');
  lines.push('- `_workspace/02_regression_cases.md` (RC-1~RC-7)');
  lines.push('- `_workspace/02_arch_decisions.md` 원칙 7 (서브에이전트 격리)');
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
      '감사할 세션 데이터가 없습니다',
      args.since
        ? `--since ${args.since} 이후 _workspace/_jobs/ 에 meta.json 이 없습니다.`
        : '_workspace/_jobs/ 가 비어있거나 부재합니다.'
    );
  }

  const scoreEntries = {
    context_efficiency: scoreContextEfficiency(jobs),
    cost_efficiency: scoreCostEfficiency(jobs),
    router_accuracy: scoreRouterAccuracy(),
    double_billing: scoreDoubleBilling(jobs),
    fallback_health: scoreFallbackHealth(jobs),
    plugin_compat: scorePluginCompat(),
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
    return emitError('CCP-AUDIT-002', '감사 스크립트 실행에 실패했습니다', '잠시 후 재시도하세요.', {
      stage: 'write_report',
      reason: err.message,
    });
  }

  // details.scores 는 점수만 평탄화 (상세는 리포트 파일에)
  const flatScores = {};
  for (const [k, v] of Object.entries(scoreEntries)) flatScores[k] = v.score;

  emitSuccess({
    summary: `전체 점수 ${totalScore}/${maxScore}. 스캔된 job ${jobs.length}건. 리포트: ${resultRel}`,
    result_path: resultRel,
    details: { scores: flatScores, jobs_count: jobs.length, since: args.since ?? null },
  });
}

main();
