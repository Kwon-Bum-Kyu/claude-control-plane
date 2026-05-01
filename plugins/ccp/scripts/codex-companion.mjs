#!/usr/bin/env node
// CCP — Codex CLI companion script
// Mirrors gemini-companion.mjs structure with codex-specific adaptations.
// Subcommands: setup | rescue | status | result | cancel | task-worker
// Envelope contract: see _workspace/01_schema.md §2 + plugins/ccp/schemas/envelope.schema.json
// Error codes:        see _workspace/01_error_messages.md (SSOT) and ERROR_CATALOG below.
// Adapted decisions:  _workspace/06_codex_cli_probe.md (B1-S1-1) + _workspace/06_codex_function_mapping.md (B1-S1-2)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { parseArgs, pickInt, pickString, pickBool, buildCodexExecArgs } from './lib/codex_adapted/args.mjs';
import {
  enqueueBackgroundJob,
  patchMeta,
  readMeta as readMetaFromState,
  writeMeta as writeMetaFromState,
  ensureJobDir,
  waitForJob,
} from './lib/codex_adapted/state.mjs';
import { runCodexSync, spawnDetachedWorker, isAlive, killPid } from './lib/codex_adapted/process.mjs';
import { dispatchBackgroundJob, cancelJob, snapshotJob } from './lib/codex_adapted/job-control.mjs';
import { findLatestResumableJob } from './lib/codex_adapted/tracked-jobs.mjs';
import { assertEnvelope } from './lib/envelope-validate.mjs';

// ---------------------------------------------------------------------------
// Constants & paths (gemini-companion 와 동일 패턴)
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

const SUMMARY_MAX_CHARS = 500;
const SUMMARY_TOKEN_CAP = 1500;
const DEFAULT_TIMEOUT_MS = 240000; // probe §2 — codex_exec P95 7.242s × 2 + 마진
const DEFAULT_POLL_INTERVAL_MS = 2000;
const PROBE_OAUTH_TIMEOUT_MS = 30000; // gemini 와 동일 (cold start 여유)
const FOREGROUND_TIMEOUT_MS = 600000; // 사용자 큰 작업 허용 (gemini-companion B17 정책 미러)
const MIN_NODE_MAJOR = 20;
const MIN_CODEX_VERSION = '0.122.0';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function emit(envelope) {
  const safe = assertEnvelope(envelope);
  process.stdout.write(JSON.stringify(safe) + '\n');
}

function emitSuccess({ summary, result_path, tokens, details }) {
  const env = {
    summary: clampSummary(summary),
    result_path: result_path ?? null,
    tokens: normalizeTokens(tokens),
    exit_code: 0,
  };
  if (details && typeof details === 'object') env.details = sanitizeDetails(details);
  emit(env);
  process.exit(0);
}

function emitBackground({ job_id, next_action, details }) {
  // background queued 응답 — schema 우회 단순 형식 (gemini-companion 동일)
  const env = { job_id, status: 'queued', next_action };
  if (details && typeof details === 'object') env.details = sanitizeDetails(details);
  process.stdout.write(JSON.stringify(env) + '\n');
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
  const env = { error: merged, exit_code: 1 };
  if (opts.details && typeof opts.details === 'object') {
    env.details = sanitizeDetails(opts.details);
  }
  emit(env);
  process.exit(1);
}

function clampSummary(text) {
  const s = typeof text === 'string' ? text : '';
  if (s.length <= SUMMARY_MAX_CHARS) return s;
  return s.slice(0, SUMMARY_MAX_CHARS - 16) + '...(truncated)';
}

function sanitizeDetails(details) {
  // L6 — gemini-companion sanitizeDetails 와 동일 정책
  const blocked = /token|secret|api[_-]?key|authorization|password/i;
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (blocked.test(k) && k !== 'codex_thread_id') continue; // thread_id 는 비밀 아님
    if (typeof v === 'string' && /Bearer\s+[A-Za-z0-9._-]+/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}

function normalizeTokens(tokens) {
  // codex usage 3필드(input/cached/output) → CCP 표준 4필드(input/cached/output/total)
  if (!tokens || typeof tokens !== 'object') return { input: 0, output: 0 };
  const input = Number.isFinite(tokens.input) ? tokens.input : 0;
  const cached = Number.isFinite(tokens.cached) ? tokens.cached : 0;
  const output = Number.isFinite(tokens.output) ? tokens.output : 0;
  // total = 신규 청구분만 (cached 는 재사용분이므로 차감)
  const total = Math.max(0, input - cached) + output;
  return { input, cached, output, total };
}

// ---------------------------------------------------------------------------
// Error catalog — codex 측 변형 + 공용 코드
// ---------------------------------------------------------------------------

const FALLBACK_HINT_KO = ' Claude 본체로 재시도하시려면 원문을 다시 입력하세요.';

const ERROR_CATALOG = {
  'CCP-SETUP-101': {
    message_ko: 'Codex CLI가 설치되어 있지 않습니다',
    action_ko: '`brew install codex` 또는 `npm install -g @openai/codex` 실행 후 `/ccp:codex-setup` 을 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-SETUP-102': {
    message_ko: 'Codex CLI 버전이 요구사항(>=0.122.0)보다 낮습니다',
    action_ko: 'Codex CLI 를 업데이트한 후 `/ccp:codex-setup` 을 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-SETUP-002': {
    message_ko: 'Node.js 버전이 요구사항보다 낮습니다',
    action_ko: 'Node.js 20 이상을 설치한 후 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-OAUTH-101': {
    message_ko: 'Codex 인증이 필요합니다',
    action_ko:
      '`codex login` 으로 인증하거나 `/ccp:codex-rescue --fallback-claude "<원본 task>"` 로 처리하세요.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback_claude',
  },
  'CCP-CODEX-001': {
    message_ko: 'Codex CLI 실행에 실패했습니다',
    action_ko: 'stderr 로그를 확인하거나 Claude 본체로 재시도하세요.',
    recovery: 'retry',
  },
  'CCP-CODEX-002': {
    message_ko: 'Codex 응답에서 유효한 JSONL 이벤트를 찾을 수 없습니다',
    action_ko: '`--verbose` 로 재실행하거나 stderr 로그를 확인하세요.',
    recovery: 'retry',
  },
  'CCP-CTX-001': {
    message_ko: '서브에이전트 응답이 요약 임계를 초과했습니다',
    action_ko:
      '`/ccp:codex-result <job_id> --summary-only` 로 요약만 회수하세요.' +
      FALLBACK_HINT_KO,
    recovery: 'abort',
  },
  'CCP-JOB-001': {
    message_ko: '해당 job 을 찾을 수 없습니다',
    action_ko: 'job_id 를 다시 확인하세요.',
    recovery: 'abort',
  },
  'CCP-JOB-002': {
    message_ko: 'job 이 아직 완료되지 않았습니다',
    action_ko: '`/ccp:codex-status <job_id>` 로 상태를 확인한 뒤 다시 시도하세요.',
    recovery: 'retry',
  },
  'CCP-JOB-003': {
    message_ko: 'job 메타데이터가 손상되었습니다',
    action_ko: 'job 디렉터리를 삭제하고 새 job 을 생성하세요.',
    recovery: 'abort',
  },
  'CCP-JOB-004': {
    message_ko: '결과 파일이 유실되었습니다',
    action_ko: '새로운 `/ccp:codex-rescue` 호출로 재실행하세요.',
    recovery: 'abort',
  },
  'CCP-JOB-409': {
    message_ko: '현재 상태에서는 취소할 수 없습니다',
    action_ko: 'job 상태를 확인한 뒤 다시 시도하세요.',
    recovery: 'abort',
  },
  'CCP-INVALID-001': {
    message_ko: '인자 파싱에 실패했습니다',
    action_ko: '사용법을 확인한 뒤 다시 입력하세요.',
    recovery: 'abort',
  },
  'CCP-TIMEOUT-001': {
    message_ko: 'Codex 응답이 지연되었습니다',
    action_ko: '재시도하거나 `--background` 로 비동기 실행하세요.',
    recovery: 'retry',
  },
  'CCP-UNSUPPORTED-101': {
    message_ko: '해당 옵션은 codex 측에서 지원되지 않습니다',
    action_ko: '호환성 매트릭스(README §모델 호환성)를 참조하세요.',
    recovery: 'abort',
  },
};

// ---------------------------------------------------------------------------
// Helpers — codex CLI version / OAuth probe
// ---------------------------------------------------------------------------

function codexVersion() {
  const r = spawnSync('codex', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

function probeOAuth(timeoutMs = PROBE_OAUTH_TIMEOUT_MS) {
  // probe §5: codex login status 는 stdout=빈 문자열, stderr 에 "Logged in using ChatGPT" 출력
  const r = spawnSync('codex', ['login', 'status'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status === null || r.error) {
    return { ok: false, reason: 'spawn_failed', detail: r.error?.message || 'unknown' };
  }
  if (r.status !== 0) {
    return { ok: false, reason: 'status_nonzero', detail: (r.stderr || r.stdout || '').slice(0, 200) };
  }
  const blob = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (!/Logged in/i.test(blob)) {
    return { ok: false, reason: 'not_logged_in', detail: blob.slice(0, 200) };
  }
  return { ok: true, detail: blob.trim().split('\n')[0] };
}

// ---------------------------------------------------------------------------
// JSONL parser — codex exec --json stream
// ---------------------------------------------------------------------------

function parseCodexJsonl(text) {
  // probe §3.1: 4 이벤트 — thread.started / turn.started / item.completed / turn.completed
  const events = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // 비-JSON 라인은 무시 (extractJsonBlob 동등)
    }
  }
  return events;
}

function summarizeCodexEvents(events) {
  const out = {
    thread_id: null,
    text: '',
    tokens: { input: 0, output: 0 },
    raw_events: events.length,
  };
  for (const ev of events) {
    if (ev?.type === 'thread.started' && ev.thread_id) out.thread_id = ev.thread_id;
    if (ev?.type === 'item.completed' && ev.item?.type === 'agent_message') {
      out.text = String(ev.item.text || '');
    }
    if (ev?.type === 'turn.completed' && ev.usage) {
      out.tokens = {
        input: Number(ev.usage.input_tokens || 0),
        cached: Number(ev.usage.cached_input_tokens || 0),
        output: Number(ev.usage.output_tokens || 0),
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Setup subcommand
// ---------------------------------------------------------------------------

function handleSetup() {
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitError('CCP-SETUP-002', {
      details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}.0.0` },
    });
  }
  const ver = codexVersion();
  if (!ver) {
    emitError('CCP-SETUP-101');
  }
  if (compareSemver(ver, MIN_CODEX_VERSION) < 0) {
    emitError('CCP-SETUP-102', {
      details: { codex_version: ver, required: `>=${MIN_CODEX_VERSION}` },
    });
  }
  const auth = probeOAuth();
  if (!auth.ok) {
    emitError('CCP-OAUTH-101', { details: { probe_reason: auth.reason } });
  }
  emitSuccess({
    summary: `Codex CLI ${ver} 인증 확인 완료. ${auth.detail}`,
    tokens: { input: 0, output: 0, total: 0 },
    details: { mode: 'codex', codex_version: ver, node_version: process.versions.node },
  });
}

// ---------------------------------------------------------------------------
// Rescue subcommand (foreground / background)
// ---------------------------------------------------------------------------

function handleRescue(parsed) {
  const { flags, positional } = parsed;
  const prompt = positional.join(' ').trim();
  if (!prompt) {
    emitError('CCP-INVALID-001', {
      message_ko: 'rescue 는 PROMPT 인자가 필요합니다',
      action_ko: '`/ccp:codex-rescue "<task>"` 형식으로 호출하세요.',
    });
  }

  if (flags.fallbackClaude) {
    emitSuccess({
      summary: 'fallback-claude: Claude 본체에서 처리할 task 입니다.',
      tokens: { input: 0, output: 0, total: 0 },
      details: { mode: 'codex', fallback: true },
    });
  }

  // OAuth 사전 검증 (foreground/background 공통)
  const auth = probeOAuth();
  if (!auth.ok) {
    emitError('CCP-OAUTH-101', { details: { probe_reason: auth.reason } });
  }

  const cwd = pickString(flags, 'cwd', process.cwd());
  const model = pickString(flags, 'model', '');
  const effort = pickString(flags, 'effort', '');
  const sandbox = pickString(flags, 'sandbox', 'read-only');
  const timeoutMs = pickInt(flags, 'timeoutMs', FOREGROUND_TIMEOUT_MS, { min: 5000, max: 3600000 });
  const pollIntervalMs = pickInt(flags, 'pollIntervalMs', DEFAULT_POLL_INTERVAL_MS, { min: 200 });
  const isBg = pickBool(flags, 'background', false);

  if (isBg) {
    return runBackground({ prompt, cwd, model, effort, sandbox, timeoutMs, pollIntervalMs });
  }
  return runForeground({ prompt, cwd, model, effort, sandbox, timeoutMs });
}

function runForeground({ prompt, cwd, model, effort, sandbox, timeoutMs }) {
  const args = buildCodexExecArgs({ prompt, cwd, model, effort, sandbox });
  const start = Date.now();
  const r = runCodexSync({ bin: 'codex', args, cwd, timeoutMs });
  const duration = Date.now() - start;

  if (r.signal === 'SIGTERM' || (r.error && /timeout/i.test(String(r.error.message)))) {
    emitError('CCP-TIMEOUT-001', {
      details: { mode: 'codex', duration_ms: duration, timeout_ms: timeoutMs },
    });
  }
  if (r.status !== 0) {
    emitError('CCP-CODEX-001', {
      details: {
        mode: 'codex',
        exit_code: r.status,
        stderr_head: (r.stderr || '').slice(0, 200),
      },
    });
  }
  const events = parseCodexJsonl(r.stdout);
  if (events.length === 0) {
    emitError('CCP-CODEX-002', {
      details: { mode: 'codex', stdout_head: (r.stdout || '').slice(0, 200) },
    });
  }
  const summary = summarizeCodexEvents(events);
  enforceContextBudget(summary.text);
  emitSuccess({
    summary: summary.text || '(empty)',
    tokens: summary.tokens,
    details: {
      mode: 'codex',
      codex_thread_id: summary.thread_id,
      duration_ms: duration,
      model: model || null,
    },
  });
}

function runBackground({ prompt, cwd, model, effort, sandbox, timeoutMs, pollIntervalMs }) {
  const params = { model, effort, sandbox, timeoutMs };
  const claudeSessionId = process.env.CLAUDE_SESSION_ID || `ppid:${process.ppid}`;
  const { jobId, pid } = dispatchBackgroundJob({
    jobsDir: JOBS_DIR,
    mode: 'codex',
    workerScriptPath: SCRIPT_PATH,
    prompt,
    params,
    cwd,
    claudeSessionId,
  });
  emitBackground({
    job_id: jobId,
    next_action: `Use /ccp:codex-status ${jobId} to check progress, then /ccp:codex-result ${jobId} when ready.`,
    details: { mode: 'codex', pid },
  });
}

function enforceContextBudget(text) {
  const s = typeof text === 'string' ? text : '';
  const words = s.trim().split(/\s+/).filter(Boolean).length;
  const est = Math.ceil(words * 1.3);
  if (est > SUMMARY_TOKEN_CAP || s.length > SUMMARY_MAX_CHARS) {
    emitError('CCP-CTX-001', {
      details: { estimated_tokens: est, summary_length_chars: s.length },
    });
  }
}

// ---------------------------------------------------------------------------
// Status subcommand
// ---------------------------------------------------------------------------

function handleStatus(parsed) {
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!jobId) {
    emitError('CCP-INVALID-001', {
      message_ko: 'status 는 jobId 인자가 필요합니다',
      action_ko: '`/ccp:codex-status <job_id>` 형식으로 호출하세요.',
    });
  }
  const meta = snapshotJob(JOBS_DIR, jobId);
  if (!meta) {
    emitError('CCP-JOB-001', { details: { job_id: jobId } });
  }
  emitSuccess({
    summary: `job ${jobId} state=${meta.state}`,
    tokens: { input: 0, output: 0, total: 0 },
    details: {
      mode: 'codex',
      job_id: jobId,
      state: meta.state,
      pid: meta.pid,
      started_at: meta.started_at,
      completed_at: meta.completed_at,
    },
  });
}

// ---------------------------------------------------------------------------
// Result subcommand
// ---------------------------------------------------------------------------

function handleResult(parsed) {
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!jobId) {
    emitError('CCP-INVALID-001', {
      message_ko: 'result 는 jobId 인자가 필요합니다',
      action_ko: '`/ccp:codex-result <job_id>` 형식으로 호출하세요.',
    });
  }
  const meta = snapshotJob(JOBS_DIR, jobId);
  if (!meta) {
    emitError('CCP-JOB-001', { details: { job_id: jobId } });
  }
  if (meta.state === 'queued' || meta.state === 'running') {
    emitError('CCP-JOB-002', { details: { job_id: jobId, state: meta.state } });
  }
  if (meta.state !== 'completed') {
    emitError('CCP-JOB-004', {
      details: { job_id: jobId, state: meta.state, error: meta.error },
    });
  }
  if (!meta.result_path || !existsSync(meta.result_path)) {
    emitError('CCP-JOB-004', { details: { job_id: jobId, result_path: meta.result_path } });
  }
  // 본문은 summary 만 envelope 에 포함, 원본은 result_path 로 노출
  const summary = (meta.summary_3lines || '').slice(0, SUMMARY_MAX_CHARS);
  emitSuccess({
    summary,
    result_path: meta.result_path,
    tokens: meta.token_usage || { input: 0, output: 0, total: 0 },
    details: {
      mode: 'codex',
      job_id: jobId,
      codex_thread_id: meta.codex_thread_id || null,
      duration_ms: meta.duration_ms || null,
    },
  });
}

// ---------------------------------------------------------------------------
// Cancel subcommand (B1 신설)
// ---------------------------------------------------------------------------

function handleCancel(parsed) {
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!jobId) {
    emitError('CCP-INVALID-001', {
      message_ko: 'cancel 은 jobId 인자가 필요합니다',
      action_ko: '`/ccp:codex-cancel <job_id>` 형식으로 호출하세요.',
    });
  }
  const r = cancelJob({ jobsDir: JOBS_DIR, jobId });
  if (!r.ok) {
    if (r.code === 'CCP-JOB-404') emitError('CCP-JOB-001', { details: { job_id: jobId } });
    if (r.code === 'CCP-JOB-409') emitError('CCP-JOB-409', { details: { job_id: jobId } });
    emitError('CCP-CODEX-001', { details: { job_id: jobId, error: r.error } });
  }
  emitSuccess({
    summary: `job ${jobId} cancelled`,
    tokens: { input: 0, output: 0, total: 0 },
    details: { mode: 'codex', job_id: jobId, state: 'cancelled' },
  });
}

// ---------------------------------------------------------------------------
// Background task-worker — detached child entrypoint
// ---------------------------------------------------------------------------

function handleTaskWorker(parsed) {
  const jobId = parsed.positional[0];
  if (!jobId) {
    process.exit(64); // 인자 부재 — envelope 출력 없음 (자식 stderr 로그만)
  }
  const meta = readMetaFromState(JOBS_DIR, jobId);
  if (!meta) {
    process.exit(64);
  }
  const args = buildCodexExecArgs({
    prompt: meta.prompt,
    cwd: process.cwd(),
    model: meta.params?.model,
    effort: meta.params?.effort,
    sandbox: meta.params?.sandbox || 'read-only',
  });
  const start = Date.now();
  const r = runCodexSync({ bin: 'codex', args, cwd: process.cwd(), timeoutMs: meta.params?.timeoutMs || DEFAULT_TIMEOUT_MS });
  const duration = Date.now() - start;
  // 결과 파일 작성
  const resultPath = join(JOBS_DIR, jobId, 'result.txt');
  let summary = '';
  let tokens = { input: 0, output: 0, total: 0 };
  let threadId = null;
  let exitCode = r.status ?? 1;
  let errorPayload = null;

  if (r.status === 0 && r.stdout) {
    const events = parseCodexJsonl(r.stdout);
    const s = summarizeCodexEvents(events);
    summary = s.text || '(empty)';
    tokens = normalizeTokens(s.tokens);
    threadId = s.thread_id;
    writeFileSync(resultPath, summary, 'utf8');
    patchMeta(JOBS_DIR, jobId, {
      state: 'completed',
      completed_at: new Date().toISOString(),
      exit_code: 0,
      result_path: resultPath,
      summary_3lines: clampSummary(summary),
      token_usage: tokens,
      codex_thread_id: threadId,
      duration_ms: duration,
    });
  } else {
    errorPayload = {
      code: r.status === null ? 'CCP-TIMEOUT-001' : 'CCP-CODEX-001',
      stderr_head: (r.stderr || '').slice(0, 500),
    };
    patchMeta(JOBS_DIR, jobId, {
      state: 'failed',
      completed_at: new Date().toISOString(),
      exit_code: exitCode,
      error: errorPayload,
      duration_ms: duration,
    });
  }
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = parsed.command;
  switch (cmd) {
    case 'setup':
      return handleSetup();
    case 'rescue':
      return handleRescue(parsed);
    case 'status':
      return handleStatus(parsed);
    case 'result':
      return handleResult(parsed);
    case 'cancel':
      return handleCancel(parsed);
    case 'task-worker':
      return handleTaskWorker(parsed);
    default:
      emitError('CCP-INVALID-001', {
        message_ko: `알 수 없는 서브커맨드: ${cmd || '(empty)'}`,
        action_ko: 'setup | rescue | status | result | cancel 중 하나를 사용하세요.',
      });
  }
}

main();
