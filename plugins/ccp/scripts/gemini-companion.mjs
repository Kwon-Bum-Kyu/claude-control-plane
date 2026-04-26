#!/usr/bin/env node
// CCP — Gemini CLI companion script
// Mirrors codex-plugin-cc's codex-companion.mjs structure.
// Subcommands: rescue | status | result | setup | preflight | task-worker
// Envelope contract: see _workspace/01_schema.md §2 and §3.
// Error codes:        see _workspace/01_error_messages.md (SSOT).

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Constants & paths
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

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUMMARY_MAX_CHARS = 500;
const SUMMARY_TOKEN_CAP = 1500;
const DEFAULT_MAX_TOKENS = 4000;
const MIN_NODE_MAJOR = 20;
const MIN_GEMINI_VERSION = '0.38.0';

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope) + '\n');
}

function emitSuccess({ summary, result_path, tokens, details }) {
  const env = {
    summary: clampSummary(summary),
    result_path: result_path ?? null,
    tokens: tokens ?? { input: 0, output: 0 },
    exit_code: 0,
  };
  if (details && typeof details === 'object') env.details = details;
  emit(env);
  process.exit(0);
}

function emitBackground({ job_id, next_action, details }) {
  const env = {
    job_id,
    status: 'queued',
    next_action,
  };
  if (details && typeof details === 'object') env.details = details;
  emit(env);
  process.exit(0);
}

function emitError(code, opts = {}) {
  const cat = ERROR_CATALOG[code];
  if (!cat) {
    emit({
      error: {
        code: 'CCP-INVALID-001',
        message_ko: `알 수 없는 에러 코드: ${code}`,
        action_ko: '내부 버그입니다. 이슈로 보고해주세요.',
        recovery: 'abort',
      },
      exit_code: 1,
    });
    process.exit(1);
  }
  const merged = {
    code,
    message_ko: opts.message_ko ?? cat.message_ko,
    action_ko: opts.action_ko ?? cat.action_ko,
    recovery: cat.recovery,
  };
  if (opts.details && typeof opts.details === 'object')
    merged.details = sanitizeDetails(opts.details);
  emit({ error: merged, exit_code: 1 });
  process.exit(1);
}

function clampSummary(text) {
  const s = typeof text === 'string' ? text : '';
  if (s.length <= SUMMARY_MAX_CHARS) return s;
  return s.slice(0, SUMMARY_MAX_CHARS - 16) + '...(truncated)';
}

function sanitizeDetails(details) {
  // L6 스펙: 비밀 정보 차단. _workspace/03_r18_decision.md 결정 — IDE 토큰 등은
  // 4중 방어선으로 차단되지만 envelope details 에는 추가 보호선을 둔다.
  const blocked = /token|secret|api[_-]?key|authorization|password/i;
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (blocked.test(k)) continue;
    if (typeof v === 'string' && /Bearer\s+[A-Za-z0-9._-]+/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error catalog — SSOT mirror of _workspace/01_error_messages.md
// ---------------------------------------------------------------------------

const FALLBACK_HINT_KO =
  ' Claude 본체로 재시도하시려면 원문을 다시 입력하세요.';

const ERROR_CATALOG = {
  'CCP-SETUP-001': {
    message_ko: 'Gemini CLI가 설치되어 있지 않습니다',
    action_ko: '`npm install -g @google/gemini-cli` 실행 후 `/gemini:setup` 을 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-SETUP-002': {
    message_ko: 'Node.js 버전이 요구사항보다 낮습니다',
    action_ko: 'Node.js 20 이상을 설치한 후 `/gemini:setup` 을 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-OAUTH-001': {
    message_ko: 'Gemini OAuth 토큰이 만료되었거나 유효하지 않습니다',
    action_ko:
      '`/gemini:setup --renew` 로 재인증하거나 `/gemini:rescue --fallback-claude "<원본 task>"` 로 처리하세요.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback',
  },
  'CCP-GEMINI-001': {
    message_ko: 'Gemini CLI 실행에 실패했습니다',
    action_ko: '`--verbose` 로 재실행해 상세 로그를 확인하거나 Claude 본체로 재시도하세요.',
    recovery: 'retry',
  },
  'CCP-GEMINI-002': {
    message_ko: 'Gemini 무료 티어 쿼터를 초과했습니다',
    action_ko:
      '잠시 후 재시도하거나 `/gemini:rescue --fallback-claude "<원본 task>"` 로 처리하세요.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback',
  },
  'CCP-CTX-001': {
    message_ko: '서브에이전트 응답이 요약 임계를 초과했습니다',
    action_ko:
      '`/gemini:result <job_id> --summary-only` 로 요약만 회수하세요.' +
      FALLBACK_HINT_KO,
    recovery: 'abort',
  },
  'CCP-ROUTER-001': {
    message_ko: '라우팅 결정이 비효율적일 수 있습니다',
    action_ko: '다음 호출부터 Claude 본체로 처리하거나 `--force-claude` 옵션을 사용하세요.',
    recovery: 'abort',
  },
  'CCP-COMPACT-001': {
    message_ko: '컨텍스트 사용량이 75%를 넘었습니다',
    action_ko: '`/compact` 로 세션을 수동 압축하거나 대형 작업을 `/gemini:rescue` 로 위임하세요.',
    recovery: 'abort',
  },
  'CCP-API-001': {
    message_ko: 'Claude Code 버전이 CCP 요구사항보다 낮습니다',
    action_ko: 'Claude Code 를 최신 버전으로 업데이트한 뒤 재시도하세요.',
    recovery: 'abort',
  },
  'CCP-JOB-001': {
    message_ko: '해당 job 을 찾을 수 없습니다',
    action_ko: 'job_id 를 다시 확인하세요.',
    recovery: 'abort',
  },
  'CCP-JOB-002': {
    message_ko: 'job 이 아직 완료되지 않았습니다',
    action_ko: '`/gemini:status <job_id>` 로 상태를 확인한 뒤 다시 시도하세요.',
    recovery: 'retry',
  },
  'CCP-JOB-003': {
    message_ko: 'job 메타데이터가 손상되었습니다',
    action_ko: 'job 디렉터리를 삭제하고 새 job 을 생성하세요.',
    recovery: 'abort',
  },
  'CCP-JOB-004': {
    message_ko: '결과 파일이 유실되었습니다',
    action_ko: '새로운 `/gemini:rescue` 호출로 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-AUDIT-001': {
    message_ko: '감사할 세션 데이터가 없습니다',
    action_ko: '`--since` 범위를 조정해 다시 시도하세요.',
    recovery: 'abort',
  },
  'CCP-AUDIT-002': {
    message_ko: '감사 스크립트 실행에 실패했습니다',
    action_ko: '잠시 후 재시도하거나 로그를 확인하세요.',
    recovery: 'retry',
  },
  'CCP-INVALID-001': {
    message_ko: '인자 파싱에 실패했습니다',
    action_ko: '사용법을 확인한 뒤 다시 입력하세요.',
    recovery: 'abort',
  },
  'CCP-TIMEOUT-001': {
    message_ko: 'Gemini 응답이 지연되었습니다',
    action_ko: '재시도하거나 `--background` 로 비동기 실행하세요.',
    recovery: 'retry',
  },
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--background') out.background = true;
    else if (tok === '--fallback-claude') out.fallbackClaude = true;
    else if (tok === '--summary-only') out.summaryOnly = true;
    else if (tok === '--renew') out.renew = true;
    else if (tok === '--max-tokens') out.maxTokens = parseInt(argv[++i], 10);
    else if (tok === '--files') out.files = argv[++i];
    else if (tok === '--job-id') out.jobId = argv[++i];
    else if (tok === '--task') out.task = argv[++i];
    else if (tok === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    } else out._.push(tok);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path traversal guard (S3-3)
// ---------------------------------------------------------------------------

function assertGlobInsidePluginRoot(glob) {
  if (!glob) return;
  // 절대 경로일 때만 검사. 상대 glob 은 cwd 기준으로 의도된 패턴 허용.
  if (!isAbsolute(glob)) return;
  const resolved = resolve(glob);
  if (!resolved.startsWith(PLUGIN_ROOT) && !resolved.startsWith(REPO_ROOT)) {
    emitError('CCP-INVALID-001', {
      message_ko: '`--files` 절대 경로가 플러그인 루트를 벗어났습니다',
      action_ko: '플러그인 루트 내부 경로 또는 상대 glob 을 사용하세요.',
      details: { glob_input: glob, plugin_root: PLUGIN_ROOT },
    });
  }
}

// ---------------------------------------------------------------------------
// Output size guard (S3-2) — words×1.3 추정
// ---------------------------------------------------------------------------

function estimateTokens(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function enforceContextBudget(text) {
  const est = estimateTokens(text);
  const summaryLen = (text || '').length;
  if (est > SUMMARY_TOKEN_CAP || summaryLen > SUMMARY_MAX_CHARS) {
    emitError('CCP-CTX-001', {
      details: {
        estimated_tokens: est,
        summary_length_chars: summaryLen,
        threshold_tokens: SUMMARY_TOKEN_CAP,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Job meta helpers
// ---------------------------------------------------------------------------

function jobDir(jobId) {
  return join(JOBS_DIR, jobId);
}

function readMeta(jobId) {
  const p = join(jobDir(jobId), 'meta.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return 'CORRUPT';
  }
}

function writeMeta(jobId, meta) {
  mkdirSync(jobDir(jobId), { recursive: true });
  writeFileSync(join(jobDir(jobId), 'meta.json'), JSON.stringify(meta, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Gemini CLI helpers
// ---------------------------------------------------------------------------

function geminiVersion() {
  const r = spawnSync('gemini', ['--version'], { encoding: 'utf8' });
  if (r.status === null || r.error) return null;
  if (r.status !== 0) return null;
  const m = (r.stdout || '').match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function compareSemver(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function nodeMajor() {
  const m = process.versions.node.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function detectAuthMethod() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0)
    return 'api_key';
  const accountsPath = join(homedir(), '.gemini', 'google_accounts.json');
  if (existsSync(accountsPath)) return 'oauth';
  return null;
}

function probeOAuth() {
  // R17 — `gemini auth status` 미지원. probe 호출로 판정.
  // timeout: macOS 실측 spawnSync 9.6~11.7s (cold start). 30s 여유.
  const r = spawnSync(
    'gemini',
    ['-p', 'ping', '-o', 'json'],
    { encoding: 'utf8', timeout: 30000 }
  );
  if (r.error) return { ok: false, reason: 'spawn_error' };
  if (r.status === 0) return { ok: true };
  const stderr = r.stderr || '';
  if (/\[ERROR\]/.test(stderr) || /auth|login|credential/i.test(stderr)) {
    return { ok: false, reason: 'auth_error' };
  }
  return { ok: false, reason: `exit_${r.status}` };
}

// Gemini CLI 가 stdout 첫 줄에 비-JSON 경고("MCP issues detected." 등) 를 섞어
// 출력하는 환경이 있다. 첫 `{` ~ 마지막 `}` 슬라이스로 JSON 본문만 안전하게 추출.
function extractJsonBlob(stdout) {
  const s = typeof stdout === 'string' ? stdout : '';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

function parseGeminiTokens(stdout) {
  // CLI 0.38.2+ -o json 출력에서 stats.models[*].tokens 합산.
  // 실패 시 words×1.3 추정으로 fallback.
  const blob = extractJsonBlob(stdout);
  try {
    const obj = blob ? JSON.parse(blob) : null;
    const models = obj?.stats?.models;
    if (models && typeof models === 'object') {
      let input = 0,
        output = 0,
        total = 0,
        thoughts = 0;
      for (const v of Object.values(models)) {
        const t = v?.tokens || {};
        input += t.input || 0;
        output += t.candidates || 0;
        total += t.total || 0;
        thoughts += t.thoughts || 0;
      }
      return {
        input,
        output,
        total: total || null,
        thoughts: thoughts || null,
        estimated: false,
        source: 'cli_stats',
      };
    }
  } catch {
    // fall through
  }
  const text = typeof stdout === 'string' ? stdout : '';
  const est = estimateTokens(text);
  return {
    input: 0,
    output: est,
    total: null,
    thoughts: null,
    estimated: true,
    source: 'words_x_1_3',
  };
}

function extractGeminiBody(stdout) {
  // -o json 모드: response 필드를 우선, 실패 시 stdout 원본.
  const blob = extractJsonBlob(stdout);
  try {
    const obj = blob ? JSON.parse(blob) : null;
    if (typeof obj?.response === 'string') return obj.response;
    if (typeof obj?.text === 'string') return obj.text;
  } catch {
    // text 모드 그대로
  }
  return stdout;
}

function makeSummary(body) {
  const lines = (body || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  return clampSummary(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Subcommand: setup / preflight (S3-6)
// ---------------------------------------------------------------------------

function cmdSetup(_args) {
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitError('CCP-SETUP-002', {
      details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}` },
    });
  }
  const ver = geminiVersion();
  if (!ver) emitError('CCP-SETUP-001');
  if (compareSemver(ver, MIN_GEMINI_VERSION) < 0) {
    emitError('CCP-SETUP-001', {
      message_ko: `Gemini CLI 버전이 낮습니다 (현재 ${ver}, 필요 ${MIN_GEMINI_VERSION}+)`,
      action_ko: '`npm install -g @google/gemini-cli@latest` 로 업데이트하세요.',
      details: { gemini_version: ver, required: `>=${MIN_GEMINI_VERSION}` },
    });
  }
  const authMethod = detectAuthMethod();
  if (!authMethod) {
    emitError('CCP-OAUTH-001', {
      details: { gemini_version: ver, oauth_status: 'unknown', auth_method: null },
    });
  }
  const probe = probeOAuth();
  if (!probe.ok) {
    emitError('CCP-OAUTH-001', {
      details: {
        gemini_version: ver,
        oauth_status: 'expired',
        auth_method: authMethod,
        probe_reason: probe.reason,
      },
    });
  }
  emitSuccess({
    summary: 'Gemini CLI 설치 및 인증 상태 정상',
    result_path: null,
    tokens: { input: 0, output: 0 },
    details: { gemini_version: ver, oauth_status: 'valid', auth_method: authMethod },
  });
}

// preflight = lightweight setup (no probe call). companion 내부용 사전 체크.
function cmdPreflight(_args) {
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitError('CCP-SETUP-002', {
      details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}` },
    });
  }
  const ver = geminiVersion();
  if (!ver) emitError('CCP-SETUP-001');
  if (compareSemver(ver, MIN_GEMINI_VERSION) < 0) {
    emitError('CCP-SETUP-001', {
      message_ko: `Gemini CLI 버전이 낮습니다 (현재 ${ver}, 필요 ${MIN_GEMINI_VERSION}+)`,
      action_ko: '`npm install -g @google/gemini-cli@latest` 로 업데이트하세요.',
      details: { gemini_version: ver, required: `>=${MIN_GEMINI_VERSION}` },
    });
  }
  const authMethod = detectAuthMethod();
  emitSuccess({
    summary: `preflight ok — gemini ${ver}`,
    result_path: null,
    tokens: { input: 0, output: 0 },
    details: { gemini_version: ver, auth_method: authMethod },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: status (S3-4)
// ---------------------------------------------------------------------------

function cmdStatus(args) {
  const jobId = args.jobId ?? args._[0];
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    emitError('CCP-INVALID-001', {
      message_ko: 'job_id 형식이 올바르지 않습니다 (UUID v4 필요)',
      action_ko: '`/gemini:rescue --background` 응답의 job_id 를 그대로 사용하세요.',
    });
  }
  if (!existsSync(jobDir(jobId))) emitError('CCP-JOB-001');
  const meta = readMeta(jobId);
  if (meta === 'CORRUPT' || !meta) emitError('CCP-JOB-003');
  emitSuccess({
    summary: `job ${meta.status}`,
    result_path: null,
    tokens: { input: 0, output: 0 },
    details: {
      job_id: meta.id,
      status: meta.status,
      created_at: meta.created_at,
      started_at: meta.started_at ?? null,
      completed_at: meta.completed_at ?? null,
      next_action:
        meta.status === 'completed'
          ? `/gemini:result ${meta.id}`
          : meta.status === 'failed'
          ? null
          : `/gemini:status ${meta.id}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: result (S3-5)
// ---------------------------------------------------------------------------

function cmdResult(args) {
  const jobId = args.jobId ?? args._[0];
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    emitError('CCP-INVALID-001', {
      message_ko: 'job_id 형식이 올바르지 않습니다 (UUID v4 필요)',
      action_ko: '`/gemini:status <job_id>` 응답의 job_id 를 그대로 사용하세요.',
    });
  }
  if (!existsSync(jobDir(jobId))) emitError('CCP-JOB-001');
  const meta = readMeta(jobId);
  if (meta === 'CORRUPT' || !meta) emitError('CCP-JOB-003');
  if (meta.status !== 'completed') emitError('CCP-JOB-002');
  if (!meta.result_file_path || !existsSync(resolve(REPO_ROOT, meta.result_file_path))) {
    emitError('CCP-JOB-004', { details: { job_id: jobId } });
  }
  emitSuccess({
    summary: meta.summary_3lines || '(요약 없음)',
    result_path: meta.result_file_path,
    tokens: meta.token_usage
      ? { input: meta.token_usage.input || 0, output: meta.token_usage.output || 0 }
      : { input: 0, output: 0 },
    details: { job_id: meta.id, gemini_session_id: meta.gemini_session_id ?? null },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: rescue (S3-1) — foreground & background dispatcher
// ---------------------------------------------------------------------------

function buildGeminiArgs(prompt, { maxTokens, files }) {
  // Gemini CLI 0.38.x 실 플래그만 사용.
  // - `--max-output-tokens`/`--all-files` 미존재 → 인자 제외.
  // - maxTokens: prompt 내 문구로 soft hint, post-call enforceContextBudget 가 hard cap.
  // - files: MVP 미지원 (백로그 B12 — `--include-directories` 매핑 검토).
  const cappedPrompt = maxTokens
    ? `${prompt}\n\n(최대 ${maxTokens} 토큰 이내로 답변)`
    : prompt;
  return ['-p', cappedPrompt, '-o', 'json'];
}

function runGeminiSync(prompt, opts) {
  const r = spawnSync('gemini', buildGeminiArgs(prompt, opts), {
    encoding: 'utf8',
    timeout: 60000,
    env: process.env,
  });
  return r;
}

function cmdRescue(args) {
  const task = args.task ?? args._.join(' ').trim();
  if (!task) {
    emitError('CCP-INVALID-001', {
      message_ko: '/gemini:rescue 에는 task 인자가 필요합니다',
      action_ko: '예: `/gemini:rescue "이 디렉토리 요약해줘"`',
    });
  }
  assertGlobInsidePluginRoot(args.files);

  // MVP: --files 미지원 (Gemini CLI 0.38.x 매핑 부재). 백로그 B13.
  if (args.files) {
    emitError('CCP-INVALID-001', {
      message_ko: '`--files` 는 MVP 에서 지원되지 않습니다',
      action_ko: 'task 본문에 파일 내용을 직접 포함하거나, `--fallback-claude` 로 Claude 본체를 사용하세요. 추적: 백로그 B13.',
    });
  }

  if (args.fallbackClaude) {
    // R13 — companion 호출 생략, mode=fallback_claude envelope 만 반환.
    emitSuccess({
      summary: 'Claude 본체 fallback 경로 — companion 호출 생략',
      result_path: null,
      tokens: { input: 0, output: 0 },
      details: { mode: 'fallback_claude', task },
    });
  }

  const maxTokens = Number.isFinite(args.maxTokens) ? args.maxTokens : DEFAULT_MAX_TOKENS;

  // Background 분기 — detached child 띄우고 즉시 envelope 반환
  if (args.background) {
    return rescueBackground({ task, maxTokens, files: args.files });
  }

  // Foreground 분기
  return rescueForeground({ task, maxTokens, files: args.files });
}

function rescueForeground({ task, maxTokens, files }) {
  // OAuth 사전 검증은 일반 setup 보다 가볍게 — env/credential 파일만 확인.
  if (!detectAuthMethod()) emitError('CCP-OAUTH-001');

  const ver = geminiVersion();
  if (!ver) emitError('CCP-SETUP-001');

  const jobId = randomUUID();
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });

  const meta = {
    id: jobId,
    status: 'running',
    prompt: task,
    mode: 'foreground',
    created_at: nowIso(),
    started_at: nowIso(),
    completed_at: null,
    gemini_session_id: null,
    gemini_cli_version: ver,
    max_tokens: maxTokens,
    files: files ?? null,
    token_usage: null,
    result_file_path: null,
    summary_3lines: null,
    error: null,
  };
  writeMeta(jobId, meta);

  const r = runGeminiSync(task, { maxTokens, files });
  if (r.error || r.status === null) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    meta.error = { code: 'CCP-TIMEOUT-001' };
    writeMeta(jobId, meta);
    emitError('CCP-TIMEOUT-001', { details: { job_id: jobId } });
  }

  const stderrText = r.stderr || '';
  if (r.status !== 0) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    writeMeta(jobId, meta);
    if (/quota|429|rate limit/i.test(stderrText)) {
      emitError('CCP-GEMINI-002', { details: { job_id: jobId, exit_code: r.status } });
    }
    if (/auth|login|credential|oauth/i.test(stderrText)) {
      emitError('CCP-OAUTH-001', { details: { job_id: jobId, exit_code: r.status } });
    }
    emitError('CCP-GEMINI-001', { details: { job_id: jobId, exit_code: r.status } });
  }

  const stdoutText = r.stdout || '';
  const body = extractGeminiBody(stdoutText);
  const tokens = parseGeminiTokens(stdoutText);

  // S3-2 — 결과 본문 자체가 1500 토큰 초과면 envelope 에 통째로 싣지 않고
  // result.md 에 저장한 뒤 요약만 반환. 단 summary 자체가 한도 초과면 차단.
  const resultRel = `_workspace/_jobs/${jobId}/result.md`;
  writeFileSync(resolve(REPO_ROOT, resultRel), body);

  const summary = makeSummary(body);
  enforceContextBudget(summary);

  // session_id 추출 시도 (-o json 모드)
  let sessionId = null;
  try {
    const blob = extractJsonBlob(stdoutText);
    const obj = blob ? JSON.parse(blob) : null;
    if (obj?.session_id && /^[0-9a-f-]{36}$/i.test(obj.session_id)) sessionId = obj.session_id;
  } catch {
    /* ignore */
  }

  meta.status = 'completed';
  meta.completed_at = nowIso();
  meta.token_usage = tokens;
  meta.result_file_path = resultRel;
  meta.summary_3lines = summary;
  meta.gemini_session_id = sessionId;
  writeMeta(jobId, meta);

  emitSuccess({
    summary,
    result_path: resultRel,
    tokens: { input: tokens.input || 0, output: tokens.output || 0 },
    details: { mode: 'gemini', job_id: jobId, gemini_session_id: sessionId },
  });
}

function rescueBackground({ task, maxTokens, files }) {
  const jobId = randomUUID();
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });

  // OAuth 만료 시 background 도 즉시 차단 (R6)
  const authMethod = detectAuthMethod();
  if (!authMethod) {
    emitError('CCP-OAUTH-001', {
      details: {
        retryHint: {
          renew: '/gemini:setup --renew',
          fallback: `/gemini:rescue --fallback-claude "${task.replace(/"/g, '\\"')}"`,
        },
      },
    });
  }

  const meta = {
    id: jobId,
    status: 'queued',
    prompt: task,
    mode: 'background',
    created_at: nowIso(),
    started_at: null,
    completed_at: null,
    gemini_session_id: null,
    gemini_cli_version: geminiVersion(),
    max_tokens: maxTokens,
    files: files ?? null,
    token_usage: null,
    result_file_path: null,
    summary_3lines: null,
    error: null,
  };
  writeMeta(jobId, meta);

  // Detached child — task-worker 진입점
  const workerArgs = [fileURLToPath(import.meta.url), 'task-worker', '--job-id', jobId];
  const child = spawn(process.execPath, workerArgs, {
    detached: true,
    stdio: 'ignore',
    cwd: REPO_ROOT,
    env: { ...process.env, CCP_JOBS_DIR: JOBS_DIR },
  });
  child.unref();

  emitBackground({
    job_id: jobId,
    next_action: `/gemini:status ${jobId}`,
    details: { mode: 'background', pid: child.pid },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: task-worker (background child entrypoint)
// ---------------------------------------------------------------------------

function cmdTaskWorker(args) {
  const jobId = args.jobId;
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    // worker 는 stdout 로 envelope 반환하지 않음. meta.json 에만 기록.
    process.exit(2);
  }
  const meta = readMeta(jobId);
  if (!meta || meta === 'CORRUPT') process.exit(2);
  meta.status = 'running';
  meta.started_at = nowIso();
  writeMeta(jobId, meta);

  const r = runGeminiSync(meta.prompt, { maxTokens: meta.max_tokens, files: meta.files });
  if (r.error || r.status === null) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    meta.error = { code: 'CCP-TIMEOUT-001' };
    writeMeta(jobId, meta);
    return;
  }

  const stderrText = r.stderr || '';
  if (r.status !== 0) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    let code = 'CCP-GEMINI-001';
    if (/quota|429|rate limit/i.test(stderrText)) code = 'CCP-GEMINI-002';
    else if (/auth|login|credential|oauth/i.test(stderrText)) code = 'CCP-OAUTH-001';
    meta.error = { code };
    // stderr 원문은 stderr.log 에만 저장, meta 에는 코드만.
    try {
      writeFileSync(join(jobDir(jobId), 'stderr.log'), stderrText);
    } catch {
      /* ignore */
    }
    writeMeta(jobId, meta);
    return;
  }

  const stdoutText = r.stdout || '';
  const body = extractGeminiBody(stdoutText);
  const tokens = parseGeminiTokens(stdoutText);
  const resultRel = `_workspace/_jobs/${jobId}/result.md`;
  writeFileSync(resolve(REPO_ROOT, resultRel), body);

  let sessionId = null;
  try {
    const blob = extractJsonBlob(stdoutText);
    const obj = blob ? JSON.parse(blob) : null;
    if (obj?.session_id && /^[0-9a-f-]{36}$/i.test(obj.session_id)) sessionId = obj.session_id;
  } catch {
    /* ignore */
  }

  meta.status = 'completed';
  meta.completed_at = nowIso();
  meta.token_usage = tokens;
  meta.result_file_path = resultRel;
  meta.summary_3lines = makeSummary(body);
  meta.gemini_session_id = sessionId;
  writeMeta(jobId, meta);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const [, , sub, ...rest] = process.argv;
  const args = parseFlags(rest);
  switch (sub) {
    case 'rescue':
      return cmdRescue(args);
    case 'status':
      return cmdStatus(args);
    case 'result':
      return cmdResult(args);
    case 'setup':
      return cmdSetup(args);
    case 'preflight':
      return cmdPreflight(args);
    case 'task-worker':
      return cmdTaskWorker(args);
    default:
      emitError('CCP-INVALID-001', {
        message_ko: `알 수 없는 서브커맨드: ${sub ?? '(없음)'}`,
        action_ko: '사용법: gemini-companion.mjs <rescue|status|result|setup|preflight> ...',
      });
  }
}

main();

export { ERROR_CATALOG, parseFlags, estimateTokens, makeSummary };
