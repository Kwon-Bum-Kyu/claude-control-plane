#!/usr/bin/env node
// CCP — Gemini CLI companion script
// Subcommands: rescue | status | result | setup | preflight | task-worker
// Envelope contract: see plugins/ccp/schemas/envelope.schema.json
// Error codes:        see README §6 (CCP error code registry).

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
  // Block secrets. IDE tokens and similar values are already blocked by upstream
  // layers, but envelope details adds one more guard for defense-in-depth.
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
    message: 'Gemini CLI is not installed',
    action: 'Run `npm install -g @google/gemini-cli`, then rerun `/gemini:setup`.',
    recovery: 'abort',
  },
  'CCP-SETUP-002': {
    message: 'Your Node.js version is below the requirement',
    action: 'Install Node.js 20 or later, then rerun `/gemini:setup`.',
    recovery: 'abort',
  },
  'CCP-OAUTH-001': {
    message: 'The Gemini OAuth token is expired or invalid',
    action:
      'Re-authenticate with `/gemini:setup --renew`, or handle it with `/gemini:rescue --fallback-claude "<original task>"`.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback',
  },
  'CCP-GEMINI-001': {
    message: 'Gemini CLI failed to run',
    action: 'Rerun with `--verbose` to inspect detailed logs, or retry with the main Claude agent.',
    recovery: 'retry',
  },
  'CCP-GEMINI-002': {
    message: 'The Gemini free-tier quota has been exceeded',
    action:
      'Try again later, or handle it with `/gemini:rescue --fallback-claude "<original task>"`.' +
      FALLBACK_HINT_KO,
    recovery: 'fallback',
  },
  'CCP-CTX-001': {
    message: 'The subagent response exceeded the summary threshold',
    action:
      'Retrieve only the summary with `/gemini:result <job_id> --summary-only`.' +
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
    action: 'Manually compact the session with `/compact`, or delegate large work to `/gemini:rescue`.',
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
    action: 'Check the status with `/gemini:status <job_id>`, then try again.',
    recovery: 'retry',
  },
  'CCP-JOB-003': {
    message: 'The job metadata is corrupted',
    action: 'Delete the job directory and create a new job.',
    recovery: 'abort',
  },
  'CCP-JOB-004': {
    message: 'The result file is missing',
    action: 'Run it again with a new `/gemini:rescue` call.',
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
    message: 'The Gemini response timed out',
    action: 'Retry, or run it asynchronously with `--background`.',
    recovery: 'retry',
  },
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

// Reject immediately if Codex-only options leak into gemini-companion.
// Kept consistent with the compatibility matrix (README §Model Compatibility).
const GEMINI_UNSUPPORTED = new Set(['--effort', '--write', '--sandbox']);

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (GEMINI_UNSUPPORTED.has(tok)) {
      emitError('CCP-INVALID-001', {
        message: `\`${tok}\` is not supported by Gemini`,
        action: 'Check the compatibility matrix (README §Model Compatibility), and use Codex-only options with `/ccp:codex-rescue`.',
        details: { unsupported_flag: tok, suggested: '/ccp:codex-rescue' },
      });
    }
    if (tok === '--background') out.background = true;
    else if (tok === '--fallback-claude') out.fallbackClaude = true;
    else if (tok === '--summary-only') out.summaryOnly = true;
    else if (tok === '--renew') out.renew = true;
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
  // Check only absolute paths. Relative globs are allowed as intended patterns from cwd.
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
// Output size guard — estimated as words × 1.3
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
  // `gemini auth status` is unsupported by the CLI. Decide via a probe call.
  // timeout: measured spawnSync on macOS is 9.6 to 11.7s (cold start). 30s leaves headroom.
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

// In some environments Gemini CLI mixes a non-JSON warning into the first stdout
// line ("MCP issues detected.", etc.). Safely extract only the JSON body from the first `{` to the last `}`.
function extractJsonBlob(stdout) {
  const s = typeof stdout === 'string' ? stdout : '';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

function parseGeminiTokens(stdout) {
  // On CLI 0.38.2+ `-o json` output, sum `stats.models[*].tokens`.
  // On failure, fall back to a words × 1.3 estimate.
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
  // In `-o json` mode, prefer the `response` field; on failure use raw stdout.
  const blob = extractJsonBlob(stdout);
  try {
    const obj = blob ? JSON.parse(blob) : null;
    if (typeof obj?.response === 'string') return obj.response;
    if (typeof obj?.text === 'string') return obj.text;
  } catch {
    // keep plain text mode as-is
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
// Subcommand: setup / preflight
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
      message: `Gemini CLI is too old (current ${ver}, required ${MIN_GEMINI_VERSION}+)`,
      action: 'Update it with `npm install -g @google/gemini-cli@latest`.',
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
    summary: 'Gemini CLI installation and auth are OK',
    result_path: null,
    tokens: { input: 0, output: 0 },
    details: { gemini_version: ver, oauth_status: 'valid', auth_method: authMethod },
  });
}

// preflight = lightweight setup (no probe call). Internal pre-check for the companion.
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
      message: `Gemini CLI is too old (current ${ver}, required ${MIN_GEMINI_VERSION}+)`,
      action: 'Update it with `npm install -g @google/gemini-cli@latest`.',
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
// Subcommand: status
// ---------------------------------------------------------------------------

function cmdStatus(args) {
  const jobId = args.jobId ?? args._[0];
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    emitError('CCP-INVALID-001', {
      message: 'The `job_id` format is invalid (UUID v4 required)',
      action: 'Use the `job_id` exactly as returned by `/gemini:rescue --background`.',
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
// Subcommand: result
// ---------------------------------------------------------------------------

function cmdResult(args) {
  const jobId = args.jobId ?? args._[0];
  if (!jobId || !UUID_V4_RE.test(jobId)) {
    emitError('CCP-INVALID-001', {
      message: 'The `job_id` format is invalid (UUID v4 required)',
      action: 'Use the `job_id` exactly as returned by `/gemini:status <job_id>`.',
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
      ? { input: meta.token_usage.input || 0, output: meta.token_usage.output || 0 }
      : { input: 0, output: 0 },
    details: { job_id: meta.id, gemini_session_id: meta.gemini_session_id ?? null },
  });
}

// ---------------------------------------------------------------------------
// Subcommand: rescue — foreground & background dispatcher
// ---------------------------------------------------------------------------

function buildGeminiArgs(prompt, { maxTokens, files }) {
  // Use only real Gemini CLI 0.38.x flags.
  // - `--max-output-tokens`/`--all-files` do not exist, so omit them.
  // - `maxTokens`: a soft hint in the prompt text; post-call `enforceContextBudget` is the hard cap.
  // - `files`: unsupported in MVP (backlog: file-context injection mapping).
  const cappedPrompt = maxTokens
    ? `${prompt}\n\n(Answer within ${maxTokens} tokens if possible)`
    : prompt;
  return ['-p', cappedPrompt, '-o', 'json'];
}

const FOREGROUND_DEFAULT_TIMEOUT_MS = 600000; // 10 min — allow large foreground tasks

function runGeminiSync(prompt, opts, timeoutMs) {
  const r = spawnSync('gemini', buildGeminiArgs(prompt, opts), {
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
      message: '/gemini:rescue requires a task argument',
      action: 'Example: `/gemini:rescue "Summarize this directory"`',
    });
  }
  assertGlobInsidePluginRoot(args.files);

  // MVP: `--files` is unsupported (no Gemini CLI 0.38.x mapping yet).
  if (args.files) {
    emitError('CCP-INVALID-001', {
      message: '`--files` is not supported in the MVP',
      action: 'Include file contents directly in the task body, or use the main Claude agent with `--fallback-claude`. File-context injection is on the roadmap.',
    });
  }

  if (args.fallbackClaude) {
    // Skip the companion call and return only a `mode=fallback_claude` envelope.
    emitSuccess({
      summary: 'Main Claude fallback path — companion call skipped',
      result_path: null,
      tokens: { input: 0, output: 0 },
      details: { mode: 'fallback_claude', task },
    });
  }

  const maxTokens = Number.isFinite(args.maxTokens) ? args.maxTokens : DEFAULT_MAX_TOKENS;

  // Background branch — launch a detached child and return an envelope immediately
  if (args.background) {
    return rescueBackground({ task, maxTokens, files: args.files });
  }

  // Foreground branch
  return rescueForeground({ task, maxTokens, files: args.files });
}

function rescueForeground({ task, maxTokens, files }) {
  // OAuth pre-check is lighter than full setup — only inspect env/credential files.
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

  const r = runGeminiSync(task, { maxTokens, files }, args.timeoutMs);
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

  // If the result body itself exceeds 1500 tokens, do not place it directly
  // in the envelope. Save it to `result.md` and return only a summary.
  // If the summary itself exceeds the limit, block it.
  const resultRel = `_workspace/_jobs/${jobId}/result.md`;
  writeFileSync(resolve(REPO_ROOT, resultRel), body);

  const summary = makeSummary(body);
  enforceContextBudget(summary);

  // Try to extract `session_id` (`-o json` mode)
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

  // If OAuth is expired, block background mode immediately too
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
    timeout_ms: Number.isFinite(args.timeoutMs) ? args.timeoutMs : null,
    files: files ?? null,
    token_usage: null,
    result_file_path: null,
    summary_3lines: null,
    error: null,
  };
  writeMeta(jobId, meta);

  // Detached child — task-worker entrypoint
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
    // The worker does not return an envelope via stdout. Record only in `meta.json`.
    process.exit(2);
  }
  const meta = readMeta(jobId);
  if (!meta || meta === 'CORRUPT') process.exit(2);
  meta.status = 'running';
  meta.started_at = nowIso();
  writeMeta(jobId, meta);

  const r = runGeminiSync(meta.prompt, { maxTokens: meta.max_tokens, files: meta.files }, meta.timeout_ms);
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
    // Store raw stderr only in `stderr.log`; keep only the code in meta.
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
        message: `Unknown subcommand: ${sub ?? '(none)'}`,
        action: 'Usage: gemini-companion.mjs <rescue|status|result|setup|preflight> ...',
      });
  }
}

main();

export { ERROR_CATALOG, parseFlags, estimateTokens, makeSummary };
