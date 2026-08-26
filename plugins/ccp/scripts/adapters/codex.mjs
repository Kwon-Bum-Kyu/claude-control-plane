// Portions adapted from openai/codex-plugin-cc (plugins/codex/scripts/lib/args.mjs)
// Upstream commit 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Licensed under the Apache License 2.0 — see LICENSES/codex-plugin-cc-Apache-2.0.txt
// Modified by CCP contributors: exec argument builder kept CLI-specific and moved
// behind the adapter interface. Everything else in this file (JSONL event parsing,
// token normalization, error catalog, codex-specific detail/message suppliers) is
// CCP original code carried over from codex-companion.mjs, which was never itself
// part of the codex-plugin-cc import — only buildArgs() below traces back upstream.
//
// Fields on this adapter follow the frozen 52-key adapter contract (32
// declarative + 20 function — see core/runtime.mjs's CONTRACT and assertAdapter).
// messages.fallbackSummary is a plain string, not a function: neither
// adapter interpolates ctx into its --fallback-claude summary text.

const FALLBACK_HINT = ' Re-enter the original prompt to retry in Claude.';
// Prevention layer for the summary-truncation problem core/runtime.mjs now
// handles (sentence-boundary cut + summary_truncated flag + full body saved
// to result_path) — see adapters/antigravity.mjs's OUTPUT_CONTRACT for the
// full rationale (identical text, kept adapter-local rather than promoted to
// core since core stays agnostic to CLI-specific prompt-shaping choices).
// Especially relevant here: codex's own `summarize()` is an identity
// function, so its own leading summary is effectively what ends up in the
// envelope once truncation applies.
const OUTPUT_CONTRACT =
  '\n\n(Response format: open with a summary of at most 3 lines and 500 characters, then put the full detail below it.)';

function normalizeTokens(tokens) {
  // codex usage has 3 fields (input/cached/output) -> CCP standard 4 fields
  if (!tokens || typeof tokens !== 'object') return { input: 0, output: 0 };
  const input = Number.isFinite(tokens.input) ? tokens.input : 0;
  const cached = Number.isFinite(tokens.cached) ? tokens.cached : 0;
  const output = Number.isFinite(tokens.output) ? tokens.output : 0;
  const total = Math.max(0, input - cached) + output; // newly-billed tokens only
  return { input, cached, output, total };
}

function parseCodexJsonl(text) {
  // codex stream-json emits 4 events: thread.started / turn.started / item.completed / turn.completed
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* ignore non-JSON lines */ }
  }
  return events;
}

function summarizeCodexEvents(events) {
  const out = { thread_id: null, text: '', tokens: { input: 0, output: 0 } };
  for (const ev of events) {
    if (ev?.type === 'thread.started' && ev.thread_id) out.thread_id = ev.thread_id;
    if (ev?.type === 'item.completed' && ev.item?.type === 'agent_message') out.text = String(ev.item.text || '');
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

const MISSING_ARG = {
  rescue: { message: 'rescue requires a PROMPT argument', action: 'Call it as `/ccp:codex-rescue "<task>"`.' },
  status: { message: 'status requires a jobId argument', action: 'Call it as `/ccp:codex-status <job_id>`.' },
  result: { message: 'result requires a jobId argument', action: 'Call it as `/ccp:codex-result <job_id>`.' },
  cancel: { message: 'cancel requires a jobId argument', action: 'Call it as `/ccp:codex-cancel <job_id>`.' },
};

export default {
  id: 'codex',
  bin: { envVar: 'CCP_CODEX_BIN', candidates: [], fallback: 'codex' },
  version: { args: ['--version'], pattern: /(\d+\.\d+\.\d+)/, min: '0.122.0', notInstalledCode: 'CCP-SETUP-101', tooOldCode: 'CCP-SETUP-102' },
  auth: {
    probeArgs: ['login', 'status'],
    successPattern: /Logged in/i,
    failureCode: 'CCP-OAUTH-101',
    // codex has always done a live `codex login status` round trip before
    // every rescue call, not just before setup — declared explicitly rather
    // than left as an implicit core default.
    rescueGate: 'probe',
    // codex has no cheap pre-check distinct from the real probe (unlike antigravity's
    // env/config-presence check) — always-truthy so setup's two-stage gate collapses
    // to "always run the real probe", matching codex's original single-stage flow.
    detect() { return 'oauth'; },
    // Failure-reason vocabulary for a probe that returned ok:false. This is
    // exactly what core's probeAuth used to hardcode as its "generic" path —
    // moved here because that vocabulary was always codex's own, not a
    // CLI-neutral default.
    classifyProbeFailure({ status, error }) {
      if (status === null || error) return 'spawn_failed';
      if (status !== 0) return 'status_nonzero';
      return 'not_logged_in'; // only reachable when successPattern didn't match despite exit 0
    },
  },

  supports: {
    subcommands: ['setup', 'rescue', 'status', 'result', 'cancel', 'task-worker'],
    // Documentation/usage-generation shape (this adapter's own dash-dash
    // parser is fully generic and does not consult this table for parsing —
    // only the task-flag style does). Kept accurate anyway: one declaration,
    // not a second table duplicating the same flag list.
    flags: {
      background: { key: 'background', type: 'bool' },
      cwd: { key: 'cwd', type: 'string' },
      model: { key: 'model', type: 'string' },
      effort: { key: 'effort', type: 'string' },
      sandbox: { key: 'sandbox', type: 'string' },
      'timeout-ms': { key: 'timeoutMs', type: 'int' },
      'poll-interval-ms': { key: 'pollIntervalMs', type: 'int' },
      'fallback-claude': { key: 'fallbackClaude', type: 'bool' },
    },
    rejectFlags: [],
    // codex has no value-conditional flag guard today (that is antigravity's --files traversal check)
    validateFlagValue() { return null; },
    // codex never distinguished "no job directory" from "meta.json fails to parse" —
    // both collapse to the same lookup-miss code.
    jobLookupCodes: { missing: 'CCP-JOB-001', corrupt: 'CCP-JOB-001' },
    // codex has always split "not completed" by state family: queued/running
    // (still in flight) get JOB-002, everything else (failed/cancelled) gets
    // JOB-004.
    resultIncompleteCode(state) {
      return state === 'queued' || state === 'running' ? 'CCP-JOB-002' : 'CCP-JOB-004';
    },
  },

  knownViolations: [
    // details present without the required `mode` key. codex's node/version/auth
    // preflight errors and job-lookup errors predate details.modeFor and were never
    // retrofitted. Preserved as-is (a known, pre-existing schema gap), not corrected
    // in this run — see the companion architecture notes for the full rationale.
    { path: 'details.mode', rule: 'missing', subcommands: ['setup', 'rescue', 'status', 'result'] },
  ],

  argStyle: 'dash-dash',
  timeouts: { foreground: 600000, background: 240000, authProbe: 30000 }, // ms; background ~= codex_exec P95 + margin
  // codex is fully stateless in the foreground (no job id, no meta.json, no log
  // file) — persistForeground: false keeps runForeground's job-record path a
  // no-op for it, matching its original fire-and-forget behavior exactly.
  result: { fileName: 'result.txt', pathStyle: 'absolute', logFileName: null, persistForeground: false },

  errors: {
    'CCP-SETUP-101': { message: 'Codex CLI is not installed', action: 'Run `brew install codex` or `npm install -g @openai/codex`, then rerun `/ccp:codex-setup`.', recovery: 'abort' },
    'CCP-SETUP-102': { message: 'Codex CLI version is below the requirement (>=0.122.0)', action: 'Update Codex CLI, then rerun `/ccp:codex-setup`.', recovery: 'abort' },
    'CCP-OAUTH-101': {
      message: 'Codex authentication is required',
      action: 'Authenticate with `codex login` or handle it with `/ccp:codex-rescue --fallback-claude "<original task>"`.' + FALLBACK_HINT,
      recovery: 'fallback_claude',
    },
    'CCP-CODEX-001': { message: 'Failed to run Codex CLI', action: 'Check stderr logs or retry in Claude.', recovery: 'retry' },
    'CCP-CODEX-002': { message: 'Could not find a valid JSONL event in the Codex response', action: 'Rerun with `--verbose` or check stderr logs.', recovery: 'retry' },
    'CCP-JOB-002': { message: 'The job has not finished yet', action: 'Check `/ccp:codex-status <job_id>` and try again.', recovery: 'retry' },
    'CCP-JOB-004': { message: 'The result file is missing', action: 'Rerun with a new `/ccp:codex-rescue` call.', recovery: 'abort' },
    'CCP-JOB-409': { message: 'Cannot cancel in the current state', action: 'Check the job state and try again.', recovery: 'abort' },
    'CCP-TIMEOUT-001': { message: 'Codex response timed out', action: 'Retry or run asynchronously with `--background`.', recovery: 'retry' },
    'CCP-UNSUPPORTED-101': { message: 'This option is not supported by codex', action: 'See the compatibility matrix (README §Model Compatibility).', recovery: 'abort' },
  },

  details: {
    allowKeys: ['codex_thread_id'],
    sanitizeScope: { success: true, background: true, error: true },
    modeFor() { return 'codex'; },
    // CLI-specific extra detail keys beyond {mode, job_id}, varying per subcommand —
    // preserves each CLI's current per-subcommand detail shape rather than unifying them.
    extraFor(subcommand, ctx) {
      switch (subcommand) {
        case 'rescue-fallback':
          return { fallback: true };
        case 'job-lookup-fail':
          return { job_id: ctx?.jobId ?? null };
        case 'rescue-auth-fail':
        case 'rescue-background-auth-fail':
        case 'setup-auth-fail':
          return { probe_reason: ctx?.reason ?? null };
        case 'rescue-failure':
          return { exit_code: ctx?.exitCode ?? null, stderr_head: ctx?.stderrHead ?? '' };
        case 'rescue':
          return { codex_thread_id: ctx?.meta?.codex_thread_id ?? null, duration_ms: ctx?.durationMs ?? null, model: ctx?.model || null };
        case 'rescue-background':
          return { pid: ctx?.pid ?? null };
        case 'status':
          return {
            job_id: ctx?.jobId ?? null,
            state: ctx?.meta?.state ?? null,
            pid: ctx?.meta?.pid ?? null,
            started_at: ctx?.meta?.started_at ?? null,
            completed_at: ctx?.meta?.completed_at ?? null,
          };
        case 'result-queued-or-running':
          return { job_id: ctx?.jobId ?? null, state: ctx?.meta?.state ?? null };
        case 'result-incomplete':
          return { job_id: ctx?.jobId ?? null, state: ctx?.meta?.state ?? null, error: ctx?.meta?.error ?? null };
        case 'result-file-missing':
          return { job_id: ctx?.jobId ?? null, result_path: ctx?.meta?.result_path ?? null };
        case 'result':
          return { codex_thread_id: ctx?.meta?.codex_thread_id || null, duration_ms: ctx?.meta?.duration_ms || null };
        case 'setup-version-too-old':
          return { codex_version: ctx?.version ?? null, required: ctx?.required ?? null };
        case 'setup-success':
          return { codex_version: ctx?.version ?? null, node_version: process.versions.node };
        default:
          return {};
      }
    },
  },

  messages: {
    nextAction(kind, jobId) {
      if (kind === 'background') return `Use /ccp:codex-status ${jobId} to check progress, then /ccp:codex-result ${jobId} when ready.`;
      return '';
    },
    retryHint() { return null; }, // codex has no retryHint feature today (that's antigravity's rescueBackground)
    // the exact "missing argument" message/action text, which embeds CLI-specific slash names.
    missingArg(subcommand) {
      return MISSING_ARG[subcommand] || { message: `${subcommand} requires an argument`, action: 'Check the usage and try again.' };
    },
    // job status line — codex has always echoed job_id + state together (no job-specific noun).
    statusSummary(jobId, meta) { return `job ${jobId} state=${meta.state}`; },
    // Unsupported-subcommand guidance. This was core's generic fallback text —
    // moved here because it was always codex's own phrasing, not CLI-neutral.
    usage(visibleSubcommands) { return `Use one of: ${visibleSubcommands.join(' | ')}.`; },
    // the --fallback-claude short-circuit's summary text (CLI-specific wording, preserved
    // as-is). Static string, not a function — neither adapter interpolates ctx into it.
    fallbackSummary: 'fallback-claude: This task should be handled by main Claude.',
  },

  buildArgs({ prompt, cwd, model, effort, sandbox, skipGitRepoCheck }) {
    // `sandbox` is a string enum for codex (read-only / workspace-write /
    // danger-full-access). core passes it through raw — a bare boolean
    // (e.g. from a flag with no value) or an empty/absent value both
    // normalize to the same 'read-only' default a real mode name would.
    const sandboxMode = typeof sandbox === 'string' && sandbox.length > 0 ? sandbox : 'read-only';
    const args = ['exec', '--json'];
    if (skipGitRepoCheck !== false) args.push('--skip-git-repo-check');
    args.push('-s', sandboxMode);
    if (cwd) args.push('-C', cwd);
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
    if (typeof prompt === 'string' && prompt.length > 0) args.push(prompt + OUTPUT_CONTRACT);
    return args;
  },

  parseResult({ stdout }) {
    const events = parseCodexJsonl(stdout);
    if (events.length === 0) {
      return { body: '', tokens: { input: 0, output: 0 }, meta: {}, errorCode: 'CCP-CODEX-002', errorDetails: { stdout_head: (stdout || '').slice(0, 200) } };
    }
    const s = summarizeCodexEvents(events);
    return { body: s.text, tokens: s.tokens, meta: { codex_thread_id: s.thread_id } };
  },

  tokensFrom(raw) { return normalizeTokens(raw); },

  estimateTokens(text) {
    const s = typeof text === 'string' ? text : '';
    return Math.ceil(s.trim().split(/\s+/).filter(Boolean).length * 1.3);
  },

  summarize(body) { return typeof body === 'string' ? body : ''; },

  // codex does not sub-classify non-zero exits (unlike antigravity's quota/auth
  // regex pair) — every non-timeout failure is CCP-CODEX-001.
  classifyFailure() { return 'CCP-CODEX-001'; },
};
