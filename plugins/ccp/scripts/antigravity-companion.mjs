#!/usr/bin/env node
// CCP — Antigravity CLI (`agy`) companion script
// Subcommands: rescue | status | result | setup | preflight | task-worker
// Envelope contract: see plugins/ccp/schemas/envelope.schema.json
// Error codes:        see README §6 (CCP error code registry).
//
// Key differences from the legacy gemini-companion:
//   - `agy` does not expose `--output-format json`. stdout is the raw answer.
//   - Conversation ID is grep-extracted from `--log-file` cli.log:
//       I... server.go:747] Created conversation <UUIDv4>
//   - Token counts are not surfaced. We compute character-based estimates
//     (promptLength · Drip length × 0.25) and mark tokens.estimated = true.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
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
const MIN_ANTIGRAVITY_VERSION = '1.0.0';

// Conversion factor for char → token estimate.
// Empirical: English averages ~4 chars/token; Korean ~2 chars/token. 0.25 sits
// between them, matching the words×1.3 fallback used by ecc/CCP historically.
const CHARS_PER_TOKEN_INVERSE = 0.25;

// ---------------------------------------------------------------------------
// agy binary resolution
// ---------------------------------------------------------------------------

function resolveAgyBin() {
  const env = process.env.CCP_AGY_BIN;
  if (env && env.length > 0 && existsSync(env)) return env;
  const localBin = join(homedir(), '.local', 'bin', 'agy');
  if (existsSync(localBin)) return localBin;
  return 'agy';
}

const AGY_BIN = resolveAgyBin();

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
    tokens: tokens ?? { input: 0, output: 0, estimated: true },
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
// Error catalog — SSOT for CCP error codes (mirrored in README §6)
// ---------------------------------------------------------------------------

const FALLBACK_HINT_KO =
  ' To retry with the main Claude agent, re-enter the original prompt.';

const ERROR_CATALOG = {
  'CCP-SETUP-001': {
    message: 'Antigravity CLI (`agy`) is not installed',
    action:
      'Install with `curl -fsSL https://antigravity.google/cli/install.sh | bash`, ensure `~/.local/bin` is on PATH, then rerun `/antigravity:setup`.',
    recovery: 'abort',
  },
  'CCP-SETUP-002': {
    message: 'Your Node.js version is below the requirement',
    action: 'Install Node.js 20 or later, then rerun `/antigravity:setup`.',
    recovery: 'abort',
  },
  'CCP-OAUTH-001': {
    message: 'Antigravity authentication is missing or invalid',
    action:
      'Run `agy` once interactively to complete keyring sign-in, or export `ANTIGRAVITY_API_KEY`. Then rerun `/antigravity:setup`, or fall back with `/antigravity:rescue --fallback-claude "<original task>"`.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback',
  },
  'CCP-AG-001': {
    message: 'Antigravity CLI failed to run',
    action: 'Rerun with `--verbose` to inspect detailed logs, or retry with the main Claude agent.',
    recovery: 'retry',
  },
  'CCP-AG-002': {
    message: 'The Antigravity free-tier quota has been exceeded',
    action:
      'Try again later, or handle it with `/antigravity:rescue --fallback-claude "<original task>"`.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback',
  },
  'CCP-CTX-001': {
    message: 'The subagent response exceeded the summary threshold',
    action:
      'Retrieve only the summary with `/antigravity:result <job_id> --summary-only`.' +
      FALLBACK_HINT_KO,
    recovery: 'abort',
  },
  'CCP-ROUTER-001': {
    message: 'The routing decision may be inefficient',
    action: 'Use the main Claude agent on the next call, or use the `--force-claude` option.',
    recovery: 'abort',
  },
  'CCP-COMPACT-001': {
    message: 'Context usage has exceeded 75%',
    action: 'Manually compact the session with `/compact`, or delegate large work to `/antigravity:rescue`.',
    recovery: 'abort',
  },
  'CCP-API-001': {
    message: 'Your Claude Code version is below the CCP requirement',
    action: 'Update Claude Code to the latest version, then try again.',
    recovery: 'abort',
  },
  'CCP-JOB-001': {
    message: 'That job could not be found',
    action: 'Check the `job_id` again.',
    recovery: 'abort',
  },
  'CCP-JOB-002': {
    message: 'The job is not complete yet',
    action: 'Check the status with `/antigravity:status <job_id>`, then try again.',
    recovery: 'retry',
  },
  'CCP-JOB-003': {
    message: 'The job metadata is corrupted',
    action: 'Delete the job directory and create a new job.',
    recovery: 'abort',
  },
  'CCP-JOB-004': {
    message: 'The result file is missing',
    action: 'Run it again with a new `/antigravity:rescue` call.',
    recovery: 'abort',
  },
  'CCP-AUDIT-001': {
    message: 'There is no session data to audit',
    action: 'Adjust the `--since` range and try again.',
    recovery: 'abort',
  },
  'CCP-AUDIT-002': {
    message: 'The audit script failed to run',
    action: 'Try again later, or check the logs.',
    recovery: 'retry',
  },
  'CCP-INVALID-001': {
    message: 'Failed to parse arguments',
    action: 'Check the usage, then enter it again.',
    recovery: 'abort',
  },
  'CCP-TIMEOUT-001': {
    message: 'The Antigravity response timed out',
    action: 'Retry, or run it asynchronously with `--background`.',
    recovery: 'retry',
  },
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

// agy supports `--sandbox`; only Codex-only flags need to be rejected here.
const ANTIGRAVITY_UNSUPPORTED = new Set(['--effort', '--write']);

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (ANTIGRAVITY_UNSUPPORTED.has(tok)) {
      emitError('CCP-INVALID-001', {
        message: `\`${tok}\` is not supported by Antigravity`,
        action:
          'Check the compatibility matrix (README §Model Compatibility), and use Codex-only options with `/ccp:codex-rescue`.',
        details: { unsupported_flag: tok, suggested: '/ccp:codex-rescue' },
      });
    }
    if (tok === '--background') out.background = true;
    else if (tok === '--fallback-claude') out.fallbackClaude = true;
    else if (tok === '--summary-only') out.summaryOnly = true;
    else if (tok === '--renew') out.renew = true;
    else if (tok === '--sandbox') out.sandbox = true;
    else if (tok === '--max-tokens') out.maxTokens = parseInt(argv[++i], 10);
    else if (tok === '--timeout-ms') out.timeoutMs = parseInt(argv[++i], 10);
    else if (tok === '--poll-interval-ms') out.pollIntervalMs = parseInt(argv[++i], 10);
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
// Path traversal guard
// ---------------------------------------------------------------------------

function assertGlobInsidePluginRoot(glob) {
  if (!glob) return;
  if (!isAbsolute(glob)) return;
  const resolved = resolve(glob);
  if (!resolved.startsWith(PLUGIN_ROOT) && !resolved.startsWith(REPO_ROOT)) {
    emitError('CCP-INVALID-001', {
      message: 'The `--files` absolute path is outside the plugin root',
      action: 'Use a path inside the plugin root or a relative glob.',
      details: { glob_input: glob, plugin_root: PLUGIN_ROOT },
    });
  }
}

// ---------------------------------------------------------------------------
// Token estimation — char-based (Antigravity exposes no token counts)
// ---------------------------------------------------------------------------

function estimateTokensFromChars(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars * CHARS_PER_TOKEN_INVERSE);
}

function estimateTokensFromText(text) {
  if (!text || typeof text !== 'string') return 0;
  return estimateTokensFromChars(text.length);
}

function enforceContextBudget(text) {
  const est = estimateTokensFromText(text);
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

function jobLogPath(jobId) {
  return join(jobDir(jobId), 'agy.log');
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
// agy CLI helpers
// ---------------------------------------------------------------------------

function agyVersion() {
  const r = spawnSync(AGY_BIN, ['--version'], { encoding: 'utf8' });
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
  if (process.env.ANTIGRAVITY_API_KEY && process.env.ANTIGRAVITY_API_KEY.length > 0)
    return 'api_key';
  // keyring access is opaque; presence of agy config dir is a soft hint.
  const cliDir = join(homedir(), '.gemini', 'antigravity-cli');
  if (existsSync(cliDir)) return 'keyring';
  return null;
}

function probeAuth() {
  // Lightweight ping. agy resolves auth via keyring silent-auth or
  // ANTIGRAVITY_API_KEY. Cold start measured ~11s, so 60s headroom.
  const r = spawnSync(
    AGY_BIN,
    ['-p', 'ping'],
    { encoding: 'utf8', timeout: 60000 }
  );
  if (r.error) return { ok: false, reason: 'spawn_error' };
  if (r.status === 0) return { ok: true };
  const stderr = r.stderr || '';
  const stdout = r.stdout || '';
  if (/not logged in|sign in|authoriz|credential|login/i.test(stderr + stdout)) {
    return { ok: false, reason: 'auth_error' };
  }
  return { ok: false, reason: `exit_${r.status}` };
}

// ---------------------------------------------------------------------------
// Antigravity result parsing
// ---------------------------------------------------------------------------

function parseAgyLogMetrics(logFilePath) {
  // Best-effort grep on the cli.log written via `agy --log-file`.
  // Pattern source: empirically captured by Phase 7-A probe (see
  // _workspace/_probe/antigravity/PROBE_RESULT.md §4).
  const out = {
    conversation_id: null,
    input_chars: 0,
    output_chars: 0,
  };
  if (!logFilePath || !existsSync(logFilePath)) return out;
  let text = '';
  try {
    text = readFileSync(logFilePath, 'utf8');
  } catch {
    return out;
  }
  const convMatch = text.match(/Created conversation ([0-9a-f-]{36})/);
  if (convMatch && UUID_V4_RE.test(convMatch[1])) {
    out.conversation_id = convMatch[1];
  }
  const promptMatches = [...text.matchAll(/promptLength=(\d+)/g)];
  if (promptMatches.length > 0) {
    // Sum across all print-mode invocations recorded in this log (typically 1).
    out.input_chars = promptMatches.reduce((s, m) => s + (parseInt(m[1], 10) || 0), 0);
  }
  const dripMatches = [...text.matchAll(/Drip stopped:[^\n]*length=(\d+)/g)];
  if (dripMatches.length > 0) {
    // Each Drip line reports cumulative chars of one streamed step; the
    // largest value is the closest to the final response length.
    out.output_chars = dripMatches.reduce(
      (m, x) => Math.max(m, parseInt(x[1], 10) || 0),
      0
    );
  }
  return out;
}

function buildTokensFromMetrics(stdoutText, metrics) {
  // Prefer log-derived char counts; fall back to text length when the log
  // file is missing or empty (closed-source defense).
  const inputChars =
    metrics.input_chars > 0 ? metrics.input_chars : 0;
  const outputChars =
    metrics.output_chars > 0
      ? metrics.output_chars
      : typeof stdoutText === 'string'
      ? stdoutText.length
      : 0;
  return {
    input: estimateTokensFromChars(inputChars),
    output: estimateTokensFromChars(outputChars),
    estimated: true,
  };
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
// Subcommand: setup / preflight
// ---------------------------------------------------------------------------

function cmdSetup(_args) {
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitError('CCP-SETUP-002', {
      details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}` },
    });
  }
  const ver = agyVersion();
  if (!ver) emitError('CCP-SETUP-001');
  if (compareSemver(ver, MIN_ANTIGRAVITY_VERSION) < 0) {
    emitError('CCP-SETUP-001', {
      message: `Antigravity CLI is too old (current ${ver}, required ${MIN_ANTIGRAVITY_VERSION}+)`,
      action: 'Update it with `agy update`.',
      details: { agy_version: ver, required: `>=${MIN_ANTIGRAVITY_VERSION}` },
    });
  }
  const authMethod = detectAuthMethod();
  if (!authMethod) {
    emitError('CCP-OAUTH-001', {
      details: { agy_version: ver, auth_status: 'unknown', auth_method: null },
    });
  }
  const probe = probeAuth();
  if (!probe.ok) {
    emitError('CCP-OAUTH-001', {
      details: {
        agy_version: ver,
        auth_status: probe.reason === 'auth_error' ? 'invalid' : 'unknown',
        auth_method: authMethod,
        probe_reason: probe.reason,
      },
    });
  }
  emitSuccess({
    summary: 'Antigravity CLI installation and auth are OK',
    result_path: null,
    tokens: { input: 0, output: 0, estimated: true },
    details: { agy_version: ver, auth_status: 'valid', auth_method: authMethod },
  });
}

function cmdPreflight(_args) {
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitError('CCP-SETUP-002', {
      details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}` },
    });
  }
  const ver = agyVersion();
  if (!ver) emitError('CCP-SETUP-001');
  if (compareSemver(ver, MIN_ANTIGRAVITY_VERSION) < 0) {
    emitError('CCP-SETUP-001', {
      message: `Antigravity CLI is too old (current ${ver}, required ${MIN_ANTIGRAVITY_VERSION}+)`,
      action: 'Update it with `agy update`.',
      details: { agy_version: ver, required: `>=${MIN_ANTIGRAVITY_VERSION}` },
    });
  }
  const authMethod = detectAuthMethod();
  emitSuccess({
    summary: `preflight ok — agy ${ver}`,
    result_path: null,
    tokens: { input: 0, output: 0, estimated: true },
    details: { agy_version: ver, auth_method: authMethod },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: status
// ---------------------------------------------------------------------------

function cmdStatus(args) {
  const jobId = args.jobId ?? args._[0];
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    emitError('CCP-INVALID-001', {
      message: 'The `job_id` format is invalid (UUID v4 required)',
      action: 'Use the `job_id` exactly as returned by `/antigravity:rescue --background`.',
    });
  }
  if (!existsSync(jobDir(jobId))) emitError('CCP-JOB-001');
  const meta = readMeta(jobId);
  if (meta === 'CORRUPT' || !meta) emitError('CCP-JOB-003');
  emitSuccess({
    summary: `job ${meta.status}`,
    result_path: null,
    tokens: { input: 0, output: 0, estimated: true },
    details: {
      job_id: meta.id,
      status: meta.status,
      created_at: meta.created_at,
      started_at: meta.started_at ?? null,
      completed_at: meta.completed_at ?? null,
      next_action:
        meta.status === 'completed'
          ? `/antigravity:result ${meta.id}`
          : meta.status === 'failed'
          ? null
          : `/antigravity:status ${meta.id}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: result
// ---------------------------------------------------------------------------

function cmdResult(args) {
  const jobId = args.jobId ?? args._[0];
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    emitError('CCP-INVALID-001', {
      message: 'The `job_id` format is invalid (UUID v4 required)',
      action: 'Use the `job_id` exactly as returned by `/antigravity:status <job_id>`.',
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
    summary: meta.summary_3lines || '(No summary)',
    result_path: meta.result_file_path,
    tokens: meta.token_usage
      ? {
          input: meta.token_usage.input || 0,
          output: meta.token_usage.output || 0,
          estimated: meta.token_usage.estimated !== false,
        }
      : { input: 0, output: 0, estimated: true },
    details: {
      mode: 'antigravity',
      job_id: meta.id,
      antigravity_conversation_id: meta.antigravity_conversation_id ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: rescue — foreground & background dispatcher
// ---------------------------------------------------------------------------

function buildAgyArgs(prompt, { maxTokens, logFile, sandbox }) {
  // agy CLI v1.0.x supported flags:
  //   -p / --print / --prompt <string>
  //   --log-file <path>
  //   --print-timeout <duration>
  //   --sandbox
  //   --add-dir <path> (not used in MVP)
  // `--max-tokens` is not a flag; embed as a soft hint in the prompt body.
  const cappedPrompt = maxTokens
    ? `${prompt}\n\n(Answer within ${maxTokens} tokens if possible)`
    : prompt;
  const args = [];
  if (logFile) {
    args.push('--log-file', logFile);
  }
  if (sandbox) {
    args.push('--sandbox');
  }
  args.push('-p', cappedPrompt);
  return args;
}

const FOREGROUND_DEFAULT_TIMEOUT_MS = 600000;

function runAgySync(prompt, opts, timeoutMs) {
  const args = buildAgyArgs(prompt, opts);
  const r = spawnSync(AGY_BIN, args, {
    encoding: 'utf8',
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : FOREGROUND_DEFAULT_TIMEOUT_MS,
    env: process.env,
  });
  return r;
}

function cmdRescue(args) {
  const task = args.task ?? args._.join(' ').trim();
  if (!task) {
    emitError('CCP-INVALID-001', {
      message: '/antigravity:rescue requires a task argument',
      action: 'Example: `/antigravity:rescue "Summarize this directory"`',
    });
  }
  assertGlobInsidePluginRoot(args.files);

  // MVP: `--files` unsupported. agy's `--add-dir` mapping is on the roadmap.
  if (args.files) {
    emitError('CCP-INVALID-001', {
      message: '`--files` is not supported in the MVP',
      action:
        'Include file contents directly in the task body, or use the main Claude agent with `--fallback-claude`. `--add-dir` mapping is on the roadmap.',
    });
  }

  if (args.fallbackClaude) {
    emitSuccess({
      summary: 'Main Claude fallback path — companion call skipped',
      result_path: null,
      tokens: { input: 0, output: 0, estimated: true },
      details: { mode: 'fallback_claude', task },
    });
  }

  const maxTokens = Number.isFinite(args.maxTokens) ? args.maxTokens : DEFAULT_MAX_TOKENS;

  if (args.background) {
    return rescueBackground({
      task,
      maxTokens,
      files: args.files,
      sandbox: args.sandbox,
      timeoutMs: args.timeoutMs,
    });
  }
  return rescueForeground({
    task,
    maxTokens,
    files: args.files,
    sandbox: args.sandbox,
    timeoutMs: args.timeoutMs,
  });
}

function rescueForeground({ task, maxTokens, files, sandbox, timeoutMs }) {
  if (!detectAuthMethod()) emitError('CCP-OAUTH-001');

  const ver = agyVersion();
  if (!ver) emitError('CCP-SETUP-001');

  const jobId = randomUUID();
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });
  const logFile = jobLogPath(jobId);

  const meta = {
    id: jobId,
    status: 'running',
    prompt: task,
    mode: 'foreground',
    created_at: nowIso(),
    started_at: nowIso(),
    completed_at: null,
    antigravity_conversation_id: null,
    agy_version: ver,
    max_tokens: maxTokens,
    files: files ?? null,
    sandbox: !!sandbox,
    token_usage: null,
    result_file_path: null,
    summary_3lines: null,
    error: null,
  };
  writeMeta(jobId, meta);

  const r = runAgySync(task, { maxTokens, logFile, sandbox }, timeoutMs);
  if (r.error || r.status === null) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    meta.error = { code: 'CCP-TIMEOUT-001' };
    writeMeta(jobId, meta);
    emitError('CCP-TIMEOUT-001', { details: { job_id: jobId } });
  }

  const stderrText = r.stderr || '';
  const stdoutText = r.stdout || '';
  if (r.status !== 0) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    writeMeta(jobId, meta);
    if (/quota|429|rate limit/i.test(stderrText + stdoutText)) {
      emitError('CCP-AG-002', { details: { job_id: jobId, exit_code: r.status } });
    }
    if (/not logged in|sign in|authoriz|credential|login/i.test(stderrText + stdoutText)) {
      emitError('CCP-OAUTH-001', { details: { job_id: jobId, exit_code: r.status } });
    }
    emitError('CCP-AG-001', { details: { job_id: jobId, exit_code: r.status } });
  }

  const body = stdoutText;
  const metrics = parseAgyLogMetrics(logFile);
  const tokens = buildTokensFromMetrics(stdoutText, metrics);

  const resultRel = `_workspace/_jobs/${jobId}/result.md`;
  writeFileSync(resolve(REPO_ROOT, resultRel), body);

  const summary = makeSummary(body);
  enforceContextBudget(summary);

  meta.status = 'completed';
  meta.completed_at = nowIso();
  meta.token_usage = tokens;
  meta.result_file_path = resultRel;
  meta.summary_3lines = summary;
  meta.antigravity_conversation_id = metrics.conversation_id;
  writeMeta(jobId, meta);

  emitSuccess({
    summary,
    result_path: resultRel,
    tokens,
    details: {
      mode: 'antigravity',
      job_id: jobId,
      antigravity_conversation_id: metrics.conversation_id,
    },
  });
}

function rescueBackground({ task, maxTokens, files, sandbox, timeoutMs }) {
  const jobId = randomUUID();
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });

  const authMethod = detectAuthMethod();
  if (!authMethod) {
    emitError('CCP-OAUTH-001', {
      details: {
        retryHint: {
          renew: '/antigravity:setup --renew',
          fallback: `/antigravity:rescue --fallback-claude "${task.replace(/"/g, '\\"')}"`,
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
    antigravity_conversation_id: null,
    agy_version: agyVersion(),
    max_tokens: maxTokens,
    timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : null,
    files: files ?? null,
    sandbox: !!sandbox,
    token_usage: null,
    result_file_path: null,
    summary_3lines: null,
    error: null,
  };
  writeMeta(jobId, meta);

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
    next_action: `/antigravity:status ${jobId}`,
    details: { mode: 'background', pid: child.pid },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: task-worker (background child entrypoint)
// ---------------------------------------------------------------------------

function cmdTaskWorker(args) {
  const jobId = args.jobId;
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    process.exit(2);
  }
  const meta = readMeta(jobId);
  if (!meta || meta === 'CORRUPT') process.exit(2);
  meta.status = 'running';
  meta.started_at = nowIso();
  writeMeta(jobId, meta);

  const logFile = jobLogPath(jobId);
  const r = runAgySync(
    meta.prompt,
    { maxTokens: meta.max_tokens, logFile, sandbox: meta.sandbox },
    meta.timeout_ms
  );
  if (r.error || r.status === null) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    meta.error = { code: 'CCP-TIMEOUT-001' };
    writeMeta(jobId, meta);
    return;
  }

  const stderrText = r.stderr || '';
  const stdoutText = r.stdout || '';
  if (r.status !== 0) {
    meta.status = 'failed';
    meta.completed_at = nowIso();
    let code = 'CCP-AG-001';
    if (/quota|429|rate limit/i.test(stderrText + stdoutText)) code = 'CCP-AG-002';
    else if (/not logged in|sign in|authoriz|credential|login/i.test(stderrText + stdoutText))
      code = 'CCP-OAUTH-001';
    meta.error = { code };
    try {
      writeFileSync(join(jobDir(jobId), 'stderr.log'), stderrText);
    } catch {
      /* ignore */
    }
    writeMeta(jobId, meta);
    return;
  }

  const body = stdoutText;
  const metrics = parseAgyLogMetrics(logFile);
  const tokens = buildTokensFromMetrics(stdoutText, metrics);
  const resultRel = `_workspace/_jobs/${jobId}/result.md`;
  writeFileSync(resolve(REPO_ROOT, resultRel), body);

  meta.status = 'completed';
  meta.completed_at = nowIso();
  meta.token_usage = tokens;
  meta.result_file_path = resultRel;
  meta.summary_3lines = makeSummary(body);
  meta.antigravity_conversation_id = metrics.conversation_id;
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
        message: `Unknown subcommand: ${sub ?? '(none)'}`,
        action: 'Usage: antigravity-companion.mjs <rescue|status|result|setup|preflight> ...',
      });
  }
}

main();

export {
  ERROR_CATALOG,
  parseFlags,
  estimateTokensFromChars,
  estimateTokensFromText,
  makeSummary,
  parseAgyLogMetrics,
  buildTokensFromMetrics,
};
