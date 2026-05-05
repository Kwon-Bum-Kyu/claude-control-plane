#!/usr/bin/env node
// CCP — Codex CLI companion script
// Subcommands: setup | rescue | status | result | cancel | task-worker
// Envelope contract: see plugins/ccp/schemas/envelope.schema.json
// Error codes:        see ERROR_CATALOG below (mirrored in README §6).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { parseArgs, pickInt, pickString, pickBool, buildCodexExecArgs } from './lib/codex-args.mjs';
import {
  enqueueBackgroundJob,
  patchMeta,
  readMeta as readMetaFromState,
  writeMeta as writeMetaFromState,
  ensureJobDir,
  waitForJob,
} from './lib/codex-state.mjs';
import { runCodexSync, spawnDetachedWorker, isAlive, killPid } from './lib/codex-process.mjs';
import { dispatchBackgroundJob, cancelJob, snapshotJob } from './lib/codex-job-control.mjs';
import { findLatestResumableJob } from './lib/codex-tracked-jobs.mjs';
import { assertEnvelope } from './lib/envelope-validate.mjs';

// ---------------------------------------------------------------------------
// Constants & paths (same pattern as gemini-companion)
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
const DEFAULT_TIMEOUT_MS = 240000; // codex_exec P95 ~7s × 2 + margin (measured)
const DEFAULT_POLL_INTERVAL_MS = 2000;
const PROBE_OAUTH_TIMEOUT_MS = 30000; // same as gemini (cold start buffer)
const FOREGROUND_TIMEOUT_MS = 600000; // 10 min — mirrors gemini-companion foreground default
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
  // background queued response — simple schema-bypass format (same as gemini-companion)
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
        message: `Unknown error code: ${code}`,
        action: 'This is an internal bug. Please report it as an issue.',
        recovery: 'abort',
      },
      exit_code: 1,
    });
    process.exit(1);
  }
  const merged = {
    code,
    message: opts.message ?? cat.message,
    action: opts.action ?? cat.action,
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
  // L6 — same policy as gemini-companion sanitizeDetails
  const blocked = /token|secret|api[_-]?key|authorization|password/i;
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (blocked.test(k) && k !== 'codex_thread_id') continue; // thread_id is not secret
    if (typeof v === 'string' && /Bearer\s+[A-Za-z0-9._-]+/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}

function normalizeTokens(tokens) {
  // codex usage has 3 fields (input/cached/output) -> CCP standard 4 fields (input/cached/output/total)
  if (!tokens || typeof tokens !== 'object') return { input: 0, output: 0 };
  const input = Number.isFinite(tokens.input) ? tokens.input : 0;
  const cached = Number.isFinite(tokens.cached) ? tokens.cached : 0;
  const output = Number.isFinite(tokens.output) ? tokens.output : 0;
  // total = newly billed tokens only (subtract cached reused tokens)
  const total = Math.max(0, input - cached) + output;
  return { input, cached, output, total };
}

// ---------------------------------------------------------------------------
// Error catalog — codex-side variants + shared codes
// ---------------------------------------------------------------------------

const FALLBACK_HINT_KO = ' Re-enter the original prompt to retry in Claude.';

const ERROR_CATALOG = {
  'CCP-SETUP-101': {
    message: 'Codex CLI is not installed',
    action: 'Run `brew install codex` or `npm install -g @openai/codex`, then rerun `/ccp:codex-setup`.',
    recovery: 'abort',
  },
  'CCP-SETUP-102': {
    message: 'Codex CLI version is below the requirement (>=0.122.0)',
    action: 'Update Codex CLI, then rerun `/ccp:codex-setup`.',
    recovery: 'abort',
  },
  'CCP-SETUP-002': {
    message: 'Node.js version is below the requirement',
    action: 'Install Node.js 20+ and rerun.',
    recovery: 'abort',
  },
  'CCP-OAUTH-101': {
    message: 'Codex authentication is required',
    action:
      'Authenticate with `codex login` or handle it with `/ccp:codex-rescue --fallback-claude "<original task>"`.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback_claude',
  },
  'CCP-CODEX-001': {
    message: 'Failed to run Codex CLI',
    action: 'Check stderr logs or retry in Claude.',
    recovery: 'retry',
  },
  'CCP-CODEX-002': {
    message: 'Could not find a valid JSONL event in the Codex response',
    action: 'Rerun with `--verbose` or check stderr logs.',
    recovery: 'retry',
  },
  'CCP-CTX-001': {
    message: 'Subagent response exceeded the summary threshold',
    action:
      'Fetch only the summary with `/ccp:codex-result <job_id> --summary-only`.' +
      FALLBACK_HINT_KO,
    recovery: 'abort',
  },
  'CCP-JOB-001': {
    message: 'Could not find that job',
    action: 'Check the job_id and try again.',
    recovery: 'abort',
  },
  'CCP-JOB-002': {
    message: 'The job has not finished yet',
    action: 'Check `/ccp:codex-status <job_id>` and try again.',
    recovery: 'retry',
  },
  'CCP-JOB-003': {
    message: 'Job metadata is corrupted',
    action: 'Delete the job directory and create a new job.',
    recovery: 'abort',
  },
  'CCP-JOB-004': {
    message: 'The result file is missing',
    action: 'Rerun with a new `/ccp:codex-rescue` call.',
    recovery: 'abort',
  },
  'CCP-JOB-409': {
    message: 'Cannot cancel in the current state',
    action: 'Check the job state and try again.',
    recovery: 'abort',
  },
  'CCP-INVALID-001': {
    message: 'Failed to parse arguments',
    action: 'Check the usage and try again.',
    recovery: 'abort',
  },
  'CCP-TIMEOUT-001': {
    message: 'Codex response timed out',
    action: 'Retry or run asynchronously with `--background`.',
    recovery: 'retry',
  },
  'CCP-UNSUPPORTED-101': {
    message: 'This option is not supported by codex',
    action: 'See the compatibility matrix (README §Model Compatibility).',
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
  // codex login status prints empty stdout and "Logged in using ChatGPT" to stderr
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
  // codex stream-json emits 4 events: thread.started / turn.started / item.completed / turn.completed
  const events = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // Ignore non-JSON lines (equivalent to extractJsonBlob)
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
    summary: `Codex CLI ${ver} authentication verified. ${auth.detail}`,
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
      message: 'rescue requires a PROMPT argument',
      action: 'Call it as `/ccp:codex-rescue "<task>"`.',
    });
  }

  if (flags.fallbackClaude) {
    emitSuccess({
      summary: 'fallback-claude: This task should be handled by main Claude.',
      tokens: { input: 0, output: 0, total: 0 },
      details: { mode: 'codex', fallback: true },
    });
  }

  // OAuth preflight check (shared by foreground/background)
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
      message: 'status requires a jobId argument',
      action: 'Call it as `/ccp:codex-status <job_id>`.',
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
      message: 'result requires a jobId argument',
      action: 'Call it as `/ccp:codex-result <job_id>`.',
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
  // Include only the summary in the envelope; expose the original via result_path
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
// Cancel subcommand
// ---------------------------------------------------------------------------

function handleCancel(parsed) {
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!jobId) {
    emitError('CCP-INVALID-001', {
      message: 'cancel requires a jobId argument',
      action: 'Call it as `/ccp:codex-cancel <job_id>`.',
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
    process.exit(64); // Missing argument — no envelope output (child stderr logs only)
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
  // Write result file
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
        message: `Unknown subcommand: ${cmd || '(empty)'}`,
        action: 'Use one of: setup | rescue | status | result | cancel.',
      });
  }
}

main();
