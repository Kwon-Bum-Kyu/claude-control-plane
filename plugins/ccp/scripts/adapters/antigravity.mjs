// CCP original (no adapted material — this is not a codex-plugin-cc file).
// Antigravity CLI (`agy`) adapter, ported from the pre-refactor standalone
// antigravity-companion.mjs. Every behavior below — including the ones that
// look like inconsistencies (mode present on some subcommands and absent on
// others, error details nested under `error` instead of at envelope root,
// the result file always living under the repo root regardless of
// CCP_JOBS_DIR) — is a faithful reproduction of that script's real,
// golden-verified output, not a design choice made fresh here. See the
// companion implementation progress log for the specific mapping between
// each adapter field and the original code it replaces.

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolvePaths } from '../core/paths.mjs';

const { PLUGIN_ROOT, REPO_ROOT } = resolvePaths();

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// English averages ~4 chars/token; Korean ~2 chars/token. 0.25 sits between
// them, matching the words×1.3 fallback used elsewhere in this codebase.
const CHARS_PER_TOKEN_INVERSE = 0.25;
const DEFAULT_MAX_TOKENS = 4000;
const FALLBACK_HINT = ' To retry with the main Claude agent, re-enter the original prompt.';

function estimateTokensFromChars(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars * CHARS_PER_TOKEN_INVERSE);
}

function detectAuthMethod() {
  if (process.env.ANTIGRAVITY_API_KEY && process.env.ANTIGRAVITY_API_KEY.length > 0) return 'api_key';
  // keyring access is opaque; presence of the agy config dir is a soft hint.
  if (existsSync(join(homedir(), '.gemini', 'antigravity-cli'))) return 'keyring';
  return null;
}

/** Best-effort grep over the cli.log text written via `agy --log-file`. */
function parseAgyLogMetrics(logText) {
  const out = { conversation_id: null, input_chars: 0, output_chars: 0 };
  if (!logText) return out;
  const convMatch = logText.match(/Created conversation ([0-9a-f-]{36})/);
  if (convMatch && UUID_V4_RE.test(convMatch[1])) out.conversation_id = convMatch[1];
  const promptMatches = [...logText.matchAll(/promptLength=(\d+)/g)];
  if (promptMatches.length > 0) out.input_chars = promptMatches.reduce((s, m) => s + (parseInt(m[1], 10) || 0), 0);
  const dripMatches = [...logText.matchAll(/Drip stopped:[^\n]*length=(\d+)/g)];
  if (dripMatches.length > 0) out.output_chars = dripMatches.reduce((m, x) => Math.max(m, parseInt(x[1], 10) || 0), 0);
  return out;
}

function buildRetryHint(task) {
  return {
    renew: '/antigravity:setup --renew',
    fallback: `/antigravity:rescue --fallback-claude "${String(task || '').replace(/"/g, '\\"')}"`,
  };
}

function statusNextAction(state, jobId) {
  if (state === 'completed') return `/antigravity:result ${jobId}`;
  if (state === 'failed') return null;
  return `/antigravity:status ${jobId}`;
}

const MISSING_ARG = {
  rescue: { message: '/antigravity:rescue requires a task argument', action: 'Example: `/antigravity:rescue "Summarize this directory"`' },
  status: { message: 'The `job_id` format is invalid (UUID v4 required)', action: 'Use the `job_id` exactly as returned by `/antigravity:rescue --background`.' },
  result: { message: 'The `job_id` format is invalid (UUID v4 required)', action: 'Use the `job_id` exactly as returned by `/antigravity:status <job_id>`.' },
};

export default {
  id: 'antigravity',
  bin: { envVar: 'CCP_AGY_BIN', candidates: [join(homedir(), '.local', 'bin', 'agy')], fallback: 'agy' },
  version: {
    args: ['--version'],
    pattern: /(\d+\.\d+\.\d+)/,
    min: '1.0.0',
    notInstalledCode: 'CCP-SETUP-001',
    tooOldCode: 'CCP-SETUP-001', // same code as notInstalledCode — always has been for antigravity
  },
  // rescueGate: 'detect' — antigravity has never spawned a real probe before
  // rescue, only the cheap env/config-dir check (unlike codex, which does a
  // live probe before every rescue call, not just before setup).
  auth: {
    probeArgs: ['-p', 'ping'],
    successPattern: null, // judged by exit code 0 alone
    failureCode: 'CCP-OAUTH-001',
    rescueGate: 'detect',
    detect: detectAuthMethod,
    // Content-based reason classification for a failed probe (required
    // whenever successPattern is null — core's probeAuth has no generic
    // fallback for this judgment model). Distinguishes a real "not logged
    // in" response (auth_status: 'invalid' downstream) from any other
    // non-zero exit (auth_status: 'unknown') — this exact regex and the
    // spawn_error/auth_error/exit_N reason vocabulary are load-bearing:
    // setup's auth_status derivation keys off them.
    classifyProbeFailure({ status, stdout, stderr, error }) {
      if (error) return 'spawn_error';
      const blob = `${stderr || ''}${stdout || ''}`;
      if (/not logged in|sign in|authoriz|credential|login/i.test(blob)) return 'auth_error';
      return `exit_${status}`;
    },
  },

  supports: {
    subcommands: ['rescue', 'status', 'result', 'setup', 'preflight', 'task-worker'],
    // Doubles as (1) the task-flag parser's vocabulary — core/args.mjs
    // parseTaskFlagArgs consults this; core itself never sees these flag
    // names — and (2) the doc/usage-generation list a dash-dash adapter
    // would use `flags` for. One declaration, not two. `effort`/`write` are
    // declared here, boolean-typed, purely so the global rejectFlags check
    // below can see them as present without accidentally consuming a
    // following token as their "value" — the original parser never consumed
    // one either (it rejected before any value-consumption logic could run).
    flags: {
      background: { key: 'background', type: 'bool' },
      'fallback-claude': { key: 'fallbackClaude', type: 'bool' },
      'summary-only': { key: 'summaryOnly', type: 'bool' },
      renew: { key: 'renew', type: 'bool' },
      sandbox: { key: 'sandbox', type: 'bool' },
      'max-tokens': { key: 'maxTokens', type: 'int' },
      'timeout-ms': { key: 'timeoutMs', type: 'int' },
      'poll-interval-ms': { key: 'pollIntervalMs', type: 'int' },
      files: { key: 'files', type: 'string' },
      'job-id': { key: 'jobId', type: 'string' },
      task: { key: 'task', type: 'string' },
      effort: { key: 'effort', type: 'bool' },
      write: { key: 'write', type: 'bool' },
    },
    rejectFlags: [
      {
        flag: '--effort',
        message: '`--effort` is not supported by Antigravity',
        action: 'Check the compatibility matrix (README §Model Compatibility), and use Codex-only options with `/ccp:codex-rescue`.',
        details: { unsupported_flag: '--effort', suggested: '/ccp:codex-rescue' },
      },
      {
        flag: '--write',
        message: '`--write` is not supported by Antigravity',
        action: 'Check the compatibility matrix (README §Model Compatibility), and use Codex-only options with `/ccp:codex-rescue`.',
        details: { unsupported_flag: '--write', suggested: '/ccp:codex-rescue' },
      },
    ],
    validateJobId(jobId) {
      return UUID_V4_RE.test(jobId);
    },
    validateFlagValue(flag, value) {
      if (flag !== 'files') return null;
      if (isAbsolute(value)) {
        const resolved = resolve(value);
        if (!resolved.startsWith(PLUGIN_ROOT) && !resolved.startsWith(REPO_ROOT)) {
          return {
            code: 'CCP-INVALID-001',
            message: 'The `--files` absolute path is outside the plugin root',
            action: 'Use a path inside the plugin root or a relative glob.',
            details: { glob_input: value, plugin_root: PLUGIN_ROOT },
          };
        }
      }
      // MVP: `--files` unsupported once it passes the traversal check above.
      return {
        code: 'CCP-INVALID-001',
        message: '`--files` is not supported in the MVP',
        action: 'Include file contents directly in the task body, or use the main Claude agent with `--fallback-claude`. `--add-dir` mapping is on the roadmap.',
      };
    },
    // dir-missing and meta-corrupt were always two different codes for antigravity.
    jobLookupCodes: { missing: 'CCP-JOB-001', corrupt: 'CCP-JOB-003' },
    // antigravity's original had a single "not completed" check (`meta.status
    // !== 'completed'`) covering queued/running/failed/cancelled alike —
    // always JOB-002, never split out a JOB-004 "incomplete" case.
    resultIncompleteCode() {
      return 'CCP-JOB-002';
    },
    // antigravity's on-disk meta has always carried a `status` key mirroring
    // `state` (its original inline reader/writer never had any other shape).
    // `hooks/rescue-finalize.js` reads that key directly to detect orphaned
    // background jobs — without this, core's job-meta writer (built around
    // codex, which has never had a `status` key) leaves it out and orphan
    // cleanup silently stops working for antigravity. codex intentionally
    // does not set this: codex meta has never had `status`, and it must
    // stay that way so the same hook does not newly start treating stalled
    // codex jobs as orphans too — that would be new behavior, not a preserved one.
    jobMetaStatusAlias: true,
  },

  knownViolations: [
    // V-a — recovery value outside the schema enum, limited to two codes.
    { path: 'error.recovery', value: 'fallback', codes: ['CCP-OAUTH-001', 'CCP-AG-002'] },
    // V-b — error details nested inside the error object (details.nestErrorDetails:
    // true is the mechanism; this is the allowlist record of the resulting schema
    // deviation). Unqualified scope on purpose: the current scope really is "every
    // error envelope that carries details" — narrow this the moment the nesting
    // rule changes. Structurally invisible to the frozen validator either way
    // (no additionalProperties check), so this entry doesn't change stderr output;
    // it exists for allowlist completeness (consumed by the adapter's own schema-subset checker).
    { path: 'error.details', rule: 'nested', scope: 'all-error-emits' },
    // V-c — the --fallback-claude success path reports a mode outside the enum.
    { path: 'details.mode', value: 'fallback_claude', subcommand: 'rescue' },
    // V-d — details present without the required mode key, on setup/preflight/status.
    // Also structurally invisible to the frozen validator (only checks mode's
    // *value* when present, never its absence) — allowlist completeness only.
    { path: 'details.mode', rule: 'missing', subcommands: ['setup', 'preflight', 'status'] },
  ],

  argStyle: 'task-flag',
  timeouts: { foreground: 600000, background: 600000, authProbe: 60000 }, // ms — background mirrors foreground; probe has cold-start headroom

  result: {
    fileName: 'result.md',
    // 'repo-relative': the result file has always lived under REPO_ROOT
    // regardless of CCP_JOBS_DIR (a pre-existing isolation gap, out of scope
    // to fix this round — see the companion implementation progress log for
    // when this was discovered). meta.json and the CLI's own log file still
    // respect CCP_JOBS_DIR; only the result body's location is anchored here.
    pathStyle: 'repo-relative',
    logFileName: 'agy.log',
    // antigravity persists a real job record even for a synchronous foreground
    // call (needed for --log-file and so a later /…:result can find the body) —
    // codex's foreground rescue is fully stateless by contrast.
    persistForeground: true,
  },

  errors: {
    'CCP-SETUP-001': {
      message: 'Antigravity CLI (`agy`) is not installed',
      action: 'Install with `curl -fsSL https://antigravity.google/cli/install.sh | bash`, ensure `~/.local/bin` is on PATH, then rerun `/antigravity:setup`.',
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
        FALLBACK_HINT,
      recovery: 'fallback', // V-a — outside the schema's recovery enum, preserved (knownViolations)
    },
    'CCP-AG-001': {
      message: 'Antigravity CLI failed to run',
      action: 'Rerun with `--verbose` to inspect detailed logs, or retry with the main Claude agent.',
      recovery: 'retry',
    },
    'CCP-AG-002': {
      message: 'The Antigravity free-tier quota has been exceeded',
      action: 'Try again later, or handle it with `/antigravity:rescue --fallback-claude "<original task>"`.' + FALLBACK_HINT,
      recovery: 'fallback', // V-a — outside the schema's recovery enum, preserved (knownViolations)
    },
    'CCP-CTX-001': {
      message: 'The subagent response exceeded the summary threshold',
      action: 'Retrieve only the summary with `/antigravity:result <job_id> --summary-only`.' + FALLBACK_HINT,
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
    'CCP-JOB-001': { message: 'That job could not be found', action: 'Check the `job_id` again.', recovery: 'abort' },
    'CCP-JOB-002': { message: 'The job is not complete yet', action: 'Check the status with `/antigravity:status <job_id>`, then try again.', recovery: 'retry' },
    'CCP-JOB-003': { message: 'The job metadata is corrupted', action: 'Delete the job directory and create a new job.', recovery: 'abort' },
    'CCP-JOB-004': { message: 'The result file is missing', action: 'Run it again with a new `/antigravity:rescue` call.', recovery: 'abort' },
    'CCP-AUDIT-001': { message: 'There is no session data to audit', action: 'Adjust the `--since` range and try again.', recovery: 'abort' },
    'CCP-AUDIT-002': { message: 'The audit script failed to run', action: 'Try again later, or check the logs.', recovery: 'retry' },
    'CCP-INVALID-001': { message: 'Failed to parse arguments', action: 'Check the usage, then enter it again.', recovery: 'abort' },
    'CCP-TIMEOUT-001': { message: 'The Antigravity response timed out', action: 'Retry, or run it asynchronously with `--background`.', recovery: 'retry' },
  },

  details: {
    allowKeys: [],
    sanitizeScope: { success: false, background: false, error: true },
    // error details have always been nested under `error.details` for
    // antigravity, not at envelope root (V-b, preserved as-is).
    nestErrorDetails: true,
    modeFor(subcommand) {
      switch (subcommand) {
        case 'rescue':
        case 'result':
          return 'antigravity';
        case 'rescue-background':
          return 'background'; // run-mode value, not a CLI id — a pre-existing quirk, preserved
        case 'rescue-fallback':
          return 'fallback_claude'; // V-c — outside the mode enum, preserved
        default:
          return null; // setup / preflight / status: no mode key at all (V-d, preserved)
      }
    },
    extraFor(subcommand, ctx) {
      switch (subcommand) {
        case 'job-lookup-fail':
          return {}; // antigravity's lookup-miss errors have always been bare (no details at all)
        case 'rescue-fallback':
          return { task: ctx?.task };
        case 'rescue-auth-fail':
          return {}; // bare CCP-OAUTH-001, no details — matches rescueForeground's original call
        case 'rescue-background-auth-fail':
          return { retryHint: buildRetryHint(ctx?.task) };
        case 'rescue-failure':
          return { job_id: ctx?.jobId ?? null, exit_code: ctx?.exitCode ?? null };
        case 'rescue':
          return { job_id: ctx?.jobId ?? null, antigravity_conversation_id: ctx?.meta?.antigravity_conversation_id ?? null };
        case 'rescue-background':
          return { pid: ctx?.pid ?? null };
        case 'status':
          return {
            job_id: ctx?.jobId ?? null,
            status: ctx?.meta?.state ?? null,
            created_at: ctx?.meta?.created_at ?? null,
            started_at: ctx?.meta?.started_at ?? null,
            completed_at: ctx?.meta?.completed_at ?? null,
            next_action: statusNextAction(ctx?.meta?.state, ctx?.jobId),
          };
        case 'result':
          return { antigravity_conversation_id: ctx?.meta?.antigravity_conversation_id ?? null };
        case 'setup-version-too-old':
          return { agy_version: ctx?.version ?? null, required: ctx?.required ?? null };
        case 'setup-auth-fail':
          if (ctx?.stage === 'detect') return { agy_version: ctx?.version ?? null, auth_status: 'unknown', auth_method: null };
          return {
            agy_version: ctx?.version ?? null,
            auth_status: ctx?.reason === 'auth_error' ? 'invalid' : 'unknown',
            auth_method: ctx?.method ?? null,
            probe_reason: ctx?.reason ?? null,
          };
        case 'setup-success':
          return { agy_version: ctx?.version ?? null, auth_status: 'valid', auth_method: ctx?.method ?? null };
        case 'preflight-success':
          return { agy_version: ctx?.version ?? null, auth_method: ctx?.method ?? null };
        default:
          return {};
      }
    },
  },

  messages: {
    nextAction(kind, jobId) {
      if (kind === 'background') return `/antigravity:status ${jobId}`;
      return '';
    },
    retryHint(ctx) {
      return buildRetryHint(ctx?.task);
    },
    missingArg(subcommand) {
      return MISSING_ARG[subcommand] || { message: `${subcommand} requires an argument`, action: 'Check the usage and try again.' };
    },
    statusSummary(jobId, meta) {
      return `job ${meta.state}`;
    },
    preflightSummary(ver) {
      return `preflight ok — agy ${ver}`;
    },
    // The too-old message has always embedded the actual version numbers
    // (unlike codex's static catalog text), so it overrides at the call site.
    // Namespace home: `messages` (alongside missingArg/fallbackSummary/statusSummary),
    // not `version` — this is a user-facing string supplier, not version metadata.
    versionTooOld(ver, min) {
      return { message: `Antigravity CLI is too old (current ${ver}, required ${min}+)`, action: 'Update it with `agy update`.' };
    },
    usage(visibleSubcommands) {
      return `Usage: antigravity-companion.mjs <${visibleSubcommands.join('|')}> ...`;
    },
    // static string, not a function — neither adapter interpolates ctx into it.
    fallbackSummary: 'Main Claude fallback path — companion call skipped',
  },

  buildArgs({ prompt, maxTokens, logFile, sandbox }) {
    const effectiveMaxTokens = Number.isFinite(maxTokens) ? maxTokens : DEFAULT_MAX_TOKENS;
    const cappedPrompt = effectiveMaxTokens ? `${prompt}\n\n(Answer within ${effectiveMaxTokens} tokens if possible)` : prompt;
    const args = [];
    if (logFile) args.push('--log-file', logFile);
    if (sandbox) args.push('--sandbox');
    args.push('-p', cappedPrompt);
    return args;
  },

  parseResult({ stdout, logText }) {
    const metrics = parseAgyLogMetrics(logText);
    const inputChars = metrics.input_chars > 0 ? metrics.input_chars : 0;
    const outputChars = metrics.output_chars > 0 ? metrics.output_chars : typeof stdout === 'string' ? stdout.length : 0;
    return {
      body: stdout || '',
      tokens: { input: estimateTokensFromChars(inputChars), output: estimateTokensFromChars(outputChars), estimated: true },
      meta: { antigravity_conversation_id: metrics.conversation_id },
    };
  },

  tokensFrom(raw) {
    if (!raw || typeof raw !== 'object') return { input: 0, output: 0, estimated: true };
    const input = Number.isFinite(raw.input) ? raw.input : 0;
    const output = Number.isFinite(raw.output) ? raw.output : 0;
    return { input, output, estimated: raw.estimated !== false };
  },

  estimateTokens(text) {
    const s = typeof text === 'string' ? text : '';
    return estimateTokensFromChars(s.length);
  },

  summarize(body) {
    const lines = (body || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);
    const joined = lines.join('\n');
    const MAX = 500; // mirrors core's own clamp — redundant but idempotent, matches original makeSummary
    return joined.length <= MAX ? joined : joined.slice(0, MAX - 16) + '...(truncated)';
  },

  classifyFailure({ stdout, stderr }) {
    const blob = `${stderr || ''}${stdout || ''}`;
    if (/quota|429|rate limit/i.test(blob)) return 'CCP-AG-002';
    if (/not logged in|sign in|authoriz|credential|login/i.test(blob)) return 'CCP-OAUTH-001';
    return 'CCP-AG-001';
  },
};
