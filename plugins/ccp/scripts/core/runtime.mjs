// Portions adapted from openai/codex-plugin-cc (plugins/codex/scripts/lib/job-control.mjs)
// Upstream commit 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Licensed under the Apache License 2.0 — see LICENSES/codex-plugin-cc-Apache-2.0.txt
// Modified by CCP contributors: unified dispatch/cancel/snapshot interface emitting the
// shared JSON envelope; subcommand routing driven by adapter declarations.
//
// This is the single generic entry point every companion routes through.
// It knows about *operation names* (setup, rescue, status, result, cancel,
// preflight, task-worker) but never about CLI names — those come exclusively
// from the adapter object. Side effects (stdout writes, process.exit,
// filesystem writes, process spawning) live here and nowhere else; adapters
// only ever return plain values.
//
// Both shipped adapters are wired in below. Subcommands that only one
// adapter declares are dispatched conditionally on that adapter's own
// declarations — core never assumes every adapter supports the same surface.

import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

import { resolvePaths } from './paths.mjs';
import { mergeErrorCatalog } from './errors.mjs';
import { emitSuccess, emitBackground, emitError } from './envelope.mjs';
import { clampSummary, checkContextBudget, DEFAULT_SUMMARY_MAX_CHARS } from './budget.mjs';
import { parseArgsForAdapter, normalizeFlagName, pickInt, pickString, pickBool } from './args.mjs';
import { runSync, spawnDetachedWorker, isAlive, killPid } from './process.mjs';
import {
  readJobMeta,
  lookupJobMeta,
  writeJobMeta,
  ensureJobDir,
  patchJobMeta,
  enqueueBackgroundJob,
} from './jobs.mjs';

const MIN_NODE_MAJOR = 20;
const DEFAULT_POLL_INTERVAL_MS = 2000;
// Shared today (both adapters currently enforce the same 1500-token summary
// cap); if a future adapter needs a different cap, this moves to an
// adapter-declared field instead of staying a runtime constant.
const SUMMARY_TOKEN_CAP = 1500;

// ---------------------------------------------------------------------------
// assertAdapter — shallow contract check (no separate adapter JSON Schema file;
// adapters are build-time constants written by contributors, not runtime input)
//
// The contract is frozen at exactly 52 leaf keys (32 declarative + 20
// function — 17 required, 3 optional). CONTRACT below is the enumerable
// source of truth: every namespace lists exactly the keys an adapter may
// declare under it, and assertAdapter rejects anything outside that set
// (unknown-key check) as well as anything missing from the required subset.
// A field must be judged (a)/(b)/(c) and land here before any adapter may
// declare it — see the design notes' contract-freeze policy.
// ---------------------------------------------------------------------------

const CONTRACT = {
  top: ['id', 'bin', 'version', 'auth', 'supports', 'argStyle', 'timeouts', 'result', 'errors', 'details', 'knownViolations', 'messages'],
  topFunctions: ['buildArgs', 'parseResult', 'tokensFrom', 'estimateTokens', 'summarize', 'classifyFailure'],
  bin: ['envVar', 'candidates', 'fallback'],
  version: ['args', 'pattern', 'min', 'notInstalledCode', 'tooOldCode'],
  auth: {
    required: ['probeArgs', 'successPattern', 'failureCode', 'rescueGate'],
    requiredFunctions: ['detect', 'classifyProbeFailure'],
  },
  supports: {
    required: ['subcommands', 'flags', 'rejectFlags'],
    optional: ['jobMetaStatusAlias', 'jobLookupCodes'],
    requiredFunctions: ['validateFlagValue', 'resultIncompleteCode'],
    optionalFunctions: ['validateJobId'],
    // Only present on adapters whose argStyle is 'task-flag' (parseTaskFlagArgs
    // consults it) — 'dash-dash' adapters never need it. Not part of the
    // 52-key tally; documented here only so the unknown-key check knows it's legitimate.
  },
  timeouts: ['foreground', 'background', 'authProbe'],
  result: ['fileName', 'pathStyle', 'logFileName', 'persistForeground'],
  details: {
    required: ['allowKeys'],
    optional: ['nestErrorDetails'],
    requiredSub: ['sanitizeScope'], // declarative but nested one level further; existence-checked only
    requiredFunctions: ['modeFor', 'extraFor'],
  },
  messages: {
    required: ['fallbackSummary'],
    optional: ['versionTooOld', 'preflightSummary'],
    requiredFunctions: ['nextAction', 'missingArg', 'retryHint', 'statusSummary', 'usage'],
  },
};

const REQUIRED_ADAPTER_FUNCTIONS = CONTRACT.topFunctions;
const REQUIRED_NESTED_FUNCTIONS = [
  ...CONTRACT.auth.requiredFunctions.map((fn) => ['auth', fn]),
  ...CONTRACT.supports.requiredFunctions.map((fn) => ['supports', fn]),
  ...CONTRACT.details.requiredFunctions.map((fn) => ['details', fn]),
  ...CONTRACT.messages.requiredFunctions.map((fn) => ['messages', fn]),
];
// 6 top-level + 11 nested = 17 required functions total (matches the frozen
// contract's 20 function fields = 17 required + 3 optional: messages.versionTooOld,
// messages.preflightSummary, supports.validateJobId — called with `?.()` since
// only one shipped adapter needs each and a forced stub on the other would be
// dead code with no verifiable behavior).
const ERROR_CODE_RE = /^CCP-[A-Z]+-\d{3}$/;
const RECOVERY_ENUM = new Set(['retry', 'fallback_claude', 'abort', 'user_action_required']);
const RESCUE_GATE_ENUM = new Set(['detect', 'probe']);

function assertKnownKeys(tag, label, obj, allowed) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`assertAdapter[${tag}]: unknown key "${label}.${key}" is not part of the frozen adapter contract`);
    }
  }
}

export function assertAdapter(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || adapter.id.length === 0) {
    throw new Error('assertAdapter: id must be a non-empty string');
  }
  const tag = adapter.id;

  // Unknown-key check — every namespace only accepts the keys the frozen
  // contract lists for it (plus, for `supports`, the parser-vocabulary
  // exception noted above).
  assertKnownKeys(tag, '<adapter>', adapter, [...CONTRACT.top, ...CONTRACT.topFunctions]);
  assertKnownKeys(tag, 'bin', adapter.bin, CONTRACT.bin);
  assertKnownKeys(tag, 'version', adapter.version, CONTRACT.version);
  assertKnownKeys(tag, 'auth', adapter.auth, [...CONTRACT.auth.required, ...CONTRACT.auth.requiredFunctions]);
  assertKnownKeys(tag, 'supports', adapter.supports, [
    ...CONTRACT.supports.required,
    ...CONTRACT.supports.optional,
    ...CONTRACT.supports.requiredFunctions,
    ...CONTRACT.supports.optionalFunctions,
    'flagSpec', // rejected explicitly below with a clearer message than a generic unknown-key throw
  ]);
  assertKnownKeys(tag, 'timeouts', adapter.timeouts, CONTRACT.timeouts);
  assertKnownKeys(tag, 'result', adapter.result, CONTRACT.result);
  assertKnownKeys(tag, 'details', adapter.details, [
    ...CONTRACT.details.required,
    ...CONTRACT.details.optional,
    ...CONTRACT.details.requiredSub,
    ...CONTRACT.details.requiredFunctions,
  ]);
  assertKnownKeys(tag, 'messages', adapter.messages, [
    ...CONTRACT.messages.required,
    ...CONTRACT.messages.optional,
    ...CONTRACT.messages.requiredFunctions,
  ]);
  if (adapter.supports && 'flagSpec' in adapter.supports) {
    throw new Error(`assertAdapter[${tag}]: supports.flagSpec was absorbed into supports.flags (Record<name,{key,type}>) — remove it`);
  }

  if (!Array.isArray(adapter.supports?.subcommands) || adapter.supports.subcommands.length === 0) {
    throw new Error(`assertAdapter[${tag}]: supports.subcommands must be a non-empty array`);
  }
  if (!adapter.supports?.flags || typeof adapter.supports.flags !== 'object' || Array.isArray(adapter.supports.flags)) {
    throw new Error(`assertAdapter[${tag}]: supports.flags must be a Record<name, {key, type}>`);
  }
  for (const [flagName, spec] of Object.entries(adapter.supports.flags)) {
    if (!spec || typeof spec.key !== 'string' || !['bool', 'int', 'string'].includes(spec.type)) {
      throw new Error(`assertAdapter[${tag}]: supports.flags["${flagName}"] must be {key: string, type: 'bool'|'int'|'string'}`);
    }
  }
  if (!RESCUE_GATE_ENUM.has(adapter.auth?.rescueGate)) {
    throw new Error(`assertAdapter[${tag}]: auth.rescueGate must be 'detect' or 'probe'`);
  }

  for (const fn of REQUIRED_ADAPTER_FUNCTIONS) {
    if (typeof adapter[fn] !== 'function') throw new Error(`assertAdapter[${tag}]: ${fn} must be a function`);
  }
  for (const [ns, fn] of REQUIRED_NESTED_FUNCTIONS) {
    if (typeof adapter[ns]?.[fn] !== 'function') throw new Error(`assertAdapter[${tag}]: ${ns}.${fn} must be a function`);
  }
  if (!Array.isArray(adapter.knownViolations)) {
    throw new Error(`assertAdapter[${tag}]: knownViolations must be an array`);
  }
  for (const v of adapter.knownViolations) {
    if (!v || typeof v.path !== 'string') throw new Error(`assertAdapter[${tag}]: each knownViolations entry needs a path`);
  }
  for (const [code, entry] of Object.entries(adapter.errors || {})) {
    if (!ERROR_CODE_RE.test(code)) throw new Error(`assertAdapter[${tag}]: error code "${code}" does not match ${ERROR_CODE_RE}`);
    if (!RECOVERY_ENUM.has(entry.recovery)) {
      const exempt = adapter.knownViolations.some(
        (v) => v.path === 'error.recovery' && v.value === entry.recovery && Array.isArray(v.codes) && v.codes.includes(code)
      );
      if (!exempt) throw new Error(`assertAdapter[${tag}]: error "${code}" has unrecognized recovery "${entry.recovery}"`);
    }
  }
  for (const key of ['foreground', 'background', 'authProbe']) {
    if (typeof adapter.timeouts?.[key] !== 'number' || adapter.timeouts[key] <= 0) {
      throw new Error(`assertAdapter[${tag}]: timeouts.${key} must be a positive number`);
    }
  }
}

// ---------------------------------------------------------------------------
// bin / version / auth probing — generic, driven entirely by adapter fields
// ---------------------------------------------------------------------------

function resolveBin(adapter) {
  const envVar = adapter.bin.envVar;
  if (envVar) {
    const v = process.env[envVar];
    if (v && v.length > 0 && existsSync(v)) return v;
  }
  for (const candidate of adapter.bin.candidates || []) {
    if (existsSync(candidate)) return candidate;
  }
  return adapter.bin.fallback;
}

function probeVersion(adapter, bin) {
  const r = runSync({ bin, args: adapter.version.args, timeoutMs: undefined });
  if (r.status === null || r.error || r.status !== 0) return null;
  const m = (r.stdout || '').match(adapter.version.pattern);
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

/**
 * A real subprocess probe (spawns `bin` with `auth.probeArgs`).
 *
 * `auth.successPattern` decides success/failure ONLY: `null` = exit code 0
 * alone; a RegExp = the pattern must also match stdout+stderr. It has no
 * say in *why* a probe failed — `auth.classifyProbeFailure` always owns
 * that (unconditionally required), because the failure-reason vocabulary
 * is CLI-specific either way and a core-level default would just be one
 * adapter's wording occupying the generic slot.
 */
function probeAuth(adapter, bin, timeoutMs) {
  const r = runSync({ bin, args: adapter.auth.probeArgs, timeoutMs });
  const classify = () => adapter.auth.classifyProbeFailure({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error });

  if (r.status === null || r.error) {
    return { ok: false, reason: classify(), detail: r.error?.message || 'unknown' };
  }
  if (adapter.auth.successPattern === null) {
    if (r.status === 0) return { ok: true, detail: '' };
    return { ok: false, reason: classify(), detail: (r.stderr || r.stdout || '').slice(0, 200) };
  }
  if (r.status !== 0) {
    return { ok: false, reason: classify(), detail: (r.stderr || r.stdout || '').slice(0, 200) };
  }
  const blob = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (!adapter.auth.successPattern.test(blob)) {
    return { ok: false, reason: classify(), detail: blob.slice(0, 200) };
  }
  return { ok: true, detail: blob.trim().split('\n')[0] };
}

/**
 * `setup` always runs the adapter's cheap, synchronous `auth.detect()` first;
 * if that already reports "nothing configured" a real probe never fires (an
 * adapter with no meaningful pre-check just has `detect()` always return a
 * truthy constant, so this collapses to "always probe" for it).
 */
function checkSetupAuth(adapter, bin, timeoutMs) {
  const method = adapter.auth.detect();
  if (!method) return { stage: 'detect', ok: false, method: null, reason: null, detail: '' };
  const probe = probeAuth(adapter, bin, timeoutMs);
  return { stage: 'probe', ok: probe.ok, method, reason: probe.reason, detail: probe.detail };
}

/**
 * `rescue`'s preflight gate is adapter-selectable: a real probe (matches one
 * adapter's pre-refactor behavior of a network round trip before every
 * rescue call) or the same cheap detect-only check `setup` uses first
 * (matches another adapter's pre-refactor behavior of never spawning a probe
 * before rescue, only before setup).
 */
function checkRescueAuth(adapter, bin, timeoutMs) {
  if (adapter.auth.rescueGate === 'detect') {
    const method = adapter.auth.detect();
    return { ok: !!method, method, reason: method ? null : 'not_detected', detail: '' };
  }
  return probeAuth(adapter, bin, timeoutMs);
}

function readTextFileSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function capitalize(s) {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/** `modeFor` may return null (no `mode` key at all for this call — a known,
 * preserved pre-refactor gap on some subcommands) — this is the only place
 * that convention is applied so every handler stays consistent. */
function baseDetails(adapter, subcommand, ctx) {
  const mode = adapter.details.modeFor(subcommand, ctx);
  return mode === null ? {} : { mode };
}

/**
 * `status`/`result` job-id validation. Optional per adapter: an adapter that
 * has never validated format (only presence) leaves `supports.validateJobId`
 * undefined and this collapses to a truthiness check. An adapter that does
 * validate format supplies the check, and this also naturally covers
 * "absent" (an undefined/empty jobId always fails a format test).
 */
function isValidJobId(adapter, jobId) {
  if (!jobId) return false;
  return adapter.supports.validateJobId ? adapter.supports.validateJobId(jobId) : true;
}

/** `extraFor`'s documented "no extra keys" return is `{}`; some call sites use
 * its result as the *entire* details value rather than spreading it into a
 * larger object, and for those an empty object must collapse to no `details`
 * key at all (one adapter includes `{job_id}` on job-lookup failures; another
 * has always emitted these bare). */
function detailsOrNull(obj) {
  return obj && Object.keys(obj).length > 0 ? obj : null;
}

function jobLookupDetails(adapter, jobId, reason) {
  return detailsOrNull(adapter.details.extraFor('job-lookup-fail', { jobId, reason }));
}

// ---------------------------------------------------------------------------
// envelope wrappers — pull adapter's sanitize policy so handlers don't repeat it
// ---------------------------------------------------------------------------

function emitSucc(ctx, { summary, result_path, tokens, details }) {
  emitSuccess({
    summary,
    result_path,
    tokens,
    details,
    allowKeys: ctx.adapter.details.allowKeys,
    sanitize: ctx.adapter.details.sanitizeScope.success,
    knownViolations: ctx.adapter.knownViolations,
  });
}

function emitBg(ctx, { job_id, next_action, details }) {
  emitBackground({
    job_id,
    next_action,
    details,
    allowKeys: ctx.adapter.details.allowKeys,
    sanitize: ctx.adapter.details.sanitizeScope.background,
  });
}

function emitErr(ctx, code, opts = {}) {
  emitError(ctx.errorCatalog, code, {
    ...opts,
    allowKeys: ctx.adapter.details.allowKeys,
    sanitize: ctx.adapter.details.sanitizeScope.error,
    nestDetailsInError: !!ctx.adapter.details.nestErrorDetails,
    knownViolations: ctx.adapter.knownViolations,
  });
}

// ---------------------------------------------------------------------------
// job-control — generalized from the upstream job-control module (see file header)
// ---------------------------------------------------------------------------

function dispatchBackgroundJob({ jobsDir, cli, workerScriptPath, workerArgsPrefix, prompt, params, cwd, claudeSessionId, writeStatusAlias, nodeBin = process.execPath }) {
  const { jobId, meta } = enqueueBackgroundJob({ jobsDir, cli, prompt, params, claudeSessionId, writeStatusAlias });
  const args = [workerScriptPath, ...workerArgsPrefix, 'task-worker', jobId];
  const { pid } = spawnDetachedWorker({
    bin: nodeBin,
    args,
    cwd: cwd || process.cwd(),
    stdoutPath: meta.stdout_path,
    stderrPath: meta.stderr_path,
    env: { CCP_JOBS_DIR: jobsDir },
  });
  const next = patchJobMeta(jobsDir, jobId, { pid, state: 'running', started_at: new Date().toISOString() }, { writeStatusAlias });
  return { jobId, pid, meta: next };
}

function cancelJobImpl({ jobsDir, jobId, writeStatusAlias }) {
  const meta = readJobMeta(jobsDir, jobId);
  if (!meta) return { ok: false, jobId, code: 'CCP-JOB-404', error: 'Job not found' };
  if (meta.state !== 'running' && meta.state !== 'queued') {
    return { ok: false, jobId, code: 'CCP-JOB-409', error: `Cannot cancel in current state (${meta.state})` };
  }
  if (meta.pid && isAlive(meta.pid)) killPid(meta.pid);
  patchJobMeta(jobsDir, jobId, { state: 'cancelled', completed_at: new Date().toISOString() }, { writeStatusAlias });
  return { ok: true, jobId };
}

/**
 * Where a job's on-disk artifacts (log file, result file) live. Two adapters,
 * two anchors: `'absolute'` respects the CCP_JOBS_DIR override; `'repo-relative'`
 * anchors under the repo root regardless of that override — a pre-existing
 * quirk of one adapter (its result file has never respected CCP_JOBS_DIR)
 * preserved as-is this round; not a design choice made here.
 * @returns {{ dir: string, resultPath: string }}
 */
function jobArtifactPaths(adapter, paths, jobId) {
  const dir =
    adapter.result.pathStyle === 'repo-relative'
      ? resolve(paths.REPO_ROOT, '_workspace', '_jobs', jobId)
      : join(paths.JOBS_DIR, jobId);
  return { dir, resultPath: join(dir, adapter.result.fileName) };
}

function exposedResultPath(adapter, paths, absoluteResultPath) {
  if (adapter.result.pathStyle !== 'repo-relative') return absoluteResultPath;
  const rel = absoluteResultPath.startsWith(paths.REPO_ROOT + '/')
    ? absoluteResultPath.slice(paths.REPO_ROOT.length + 1)
    : absoluteResultPath;
  return rel;
}

// ---------------------------------------------------------------------------
// subcommand handlers — generic, adapter-driven
// ---------------------------------------------------------------------------

function handleSetup(ctx) {
  const { adapter } = ctx;
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitErr(ctx, 'CCP-SETUP-002', { details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}.0.0` } });
  }
  const ver = probeVersion(adapter, ctx.bin);
  if (!ver) emitErr(ctx, adapter.version.notInstalledCode);
  if (compareSemver(ver, adapter.version.min) < 0) {
    const override = adapter.messages.versionTooOld?.(ver, adapter.version.min) || {};
    emitErr(ctx, adapter.version.tooOldCode, {
      message: override.message,
      action: override.action,
      details: adapter.details.extraFor('setup-version-too-old', { version: ver, required: `>=${adapter.version.min}` }),
    });
  }
  const authCheck = checkSetupAuth(adapter, ctx.bin, adapter.timeouts.authProbe);
  if (!authCheck.ok) {
    emitErr(ctx, adapter.auth.failureCode, {
      details: adapter.details.extraFor('setup-auth-fail', { stage: authCheck.stage, method: authCheck.method, reason: authCheck.reason, version: ver }),
    });
  }
  emitSucc(ctx, {
    summary: `${capitalize(adapter.id)} CLI ${ver} authentication verified. ${authCheck.detail || ''}`.trimEnd(),
    tokens: adapter.tokensFrom({ input: 0, output: 0, total: 0 }),
    details: { ...baseDetails(adapter, 'setup', {}), ...adapter.details.extraFor('setup-success', { version: ver, method: authCheck.method }) },
  });
}

function handlePreflight(ctx) {
  const { adapter } = ctx;
  if (nodeMajor() < MIN_NODE_MAJOR) {
    emitErr(ctx, 'CCP-SETUP-002', { details: { node_version: process.versions.node, required: `>=${MIN_NODE_MAJOR}.0.0` } });
  }
  const ver = probeVersion(adapter, ctx.bin);
  if (!ver) emitErr(ctx, adapter.version.notInstalledCode);
  if (compareSemver(ver, adapter.version.min) < 0) {
    const override = adapter.messages.versionTooOld?.(ver, adapter.version.min) || {};
    emitErr(ctx, adapter.version.tooOldCode, {
      message: override.message,
      action: override.action,
      details: adapter.details.extraFor('setup-version-too-old', { version: ver, required: `>=${adapter.version.min}` }),
    });
  }
  const method = adapter.auth.detect();
  emitSucc(ctx, {
    summary: adapter.messages.preflightSummary?.(ver) ?? `preflight ok — ${ver}`,
    tokens: adapter.tokensFrom({ input: 0, output: 0, total: 0 }),
    details: { ...baseDetails(adapter, 'preflight', {}), ...adapter.details.extraFor('preflight-success', { version: ver, method }) },
  });
}

function handleRescue(ctx, parsed) {
  const { adapter } = ctx;
  const { flags, positional } = parsed;
  // An explicit --task flag (one adapter's task-flag style supports one) wins
  // over the positional/prompt list; an adapter that never sets flags.task
  // gets a no-op here and always falls through to positional.
  const prompt = typeof flags.task === 'string' ? flags.task.trim() : positional.join(' ').trim();
  if (!prompt) {
    const hint = adapter.messages.missingArg('rescue');
    emitErr(ctx, 'CCP-INVALID-001', { message: hint.message, action: hint.action });
  }

  if (flags.fallbackClaude) {
    emitSucc(ctx, {
      summary: adapter.messages.fallbackSummary,
      tokens: adapter.tokensFrom({ input: 0, output: 0, total: 0 }),
      details: { ...baseDetails(adapter, 'rescue-fallback', { task: prompt }), ...adapter.details.extraFor('rescue-fallback', { task: prompt }) },
    });
    return;
  }

  const cwd = pickString(flags, 'cwd', process.cwd());
  const model = pickString(flags, 'model', '');
  const effort = pickString(flags, 'effort', '');
  // Raw passthrough, not pickString: `sandbox` is a string enum for one adapter
  // but a bare boolean toggle for another — each adapter's buildArgs owns
  // interpreting (and defaulting) its own shape.
  const sandbox = flags.sandbox;
  const maxTokens = pickInt(flags, 'maxTokens', undefined);
  const timeoutMs = pickInt(flags, 'timeoutMs', adapter.timeouts.foreground, { min: 5000, max: 3600000 });
  const pollIntervalMs = pickInt(flags, 'pollIntervalMs', DEFAULT_POLL_INTERVAL_MS, { min: 200 });
  const isBg = pickBool(flags, 'background', false);
  const params = { model, effort, sandbox, maxTokens, timeoutMs };

  const authCheck = checkRescueAuth(adapter, ctx.bin, adapter.timeouts.authProbe);
  if (!authCheck.ok) {
    const subcommand = isBg ? 'rescue-background-auth-fail' : 'rescue-auth-fail';
    emitErr(ctx, adapter.auth.failureCode, { details: detailsOrNull(adapter.details.extraFor(subcommand, { reason: authCheck.reason, task: prompt })) });
  }

  if (isBg) return runBackground(ctx, { prompt, cwd, params, pollIntervalMs });
  return runForeground(ctx, { prompt, cwd, params });
}

function runForeground(ctx, { prompt, cwd, params }) {
  const { adapter, paths } = ctx;

  // Some adapters persist a real job record even for a synchronous foreground
  // call — needed so the CLI can be given a `--log-file` path and so
  // `result_path` in the response points at something a later `/…:result`
  // call can still find. Others are fully stateless in the foreground: no
  // job id, no meta.json, no log file.
  let jobId = null;
  let logFile = null;
  const writeStatusAlias = !!adapter.supports.jobMetaStatusAlias;
  if (adapter.result.persistForeground) {
    jobId = randomUUID();
    ensureJobDir(paths.JOBS_DIR, jobId); // meta.json/log always live under JOBS_DIR (env-overridable);
    // the result file itself may be anchored elsewhere — see jobArtifactPaths.
    if (adapter.result.logFileName) logFile = join(paths.JOBS_DIR, jobId, adapter.result.logFileName);
    const initialMeta = {
      job_id: jobId,
      mode: adapter.id,
      state: 'running',
      prompt,
      params,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      result_path: null,
      summary_3lines: null,
      token_usage: null,
      error: null,
    };
    if (writeStatusAlias) initialMeta.status = initialMeta.state;
    writeJobMeta(paths.JOBS_DIR, jobId, initialMeta);
  }

  const args = adapter.buildArgs({ prompt, cwd, model: params.model, effort: params.effort, sandbox: params.sandbox, maxTokens: params.maxTokens, logFile });
  const start = Date.now();
  const r = runSync({ bin: ctx.bin, args, cwd, timeoutMs: params.timeoutMs });
  const duration = Date.now() - start;

  if (r.signal === 'SIGTERM' || (r.error && /timeout/i.test(String(r.error.message)))) {
    if (jobId) patchJobMeta(paths.JOBS_DIR, jobId, { state: 'failed', completed_at: new Date().toISOString(), error: { code: 'CCP-TIMEOUT-001' } }, { writeStatusAlias });
    emitErr(ctx, 'CCP-TIMEOUT-001', { details: { ...baseDetails(adapter, 'rescue', {}), job_id: jobId ?? undefined, duration_ms: duration, timeout_ms: params.timeoutMs } });
  }
  if (r.status !== 0) {
    if (jobId) patchJobMeta(paths.JOBS_DIR, jobId, { state: 'failed', completed_at: new Date().toISOString() }, { writeStatusAlias });
    const code = adapter.classifyFailure({ stdout: r.stdout, stderr: r.stderr, status: r.status, signal: r.signal, error: r.error });
    emitErr(ctx, code, {
      details: { ...baseDetails(adapter, 'rescue-failure', {}), ...adapter.details.extraFor('rescue-failure', { jobId, exitCode: r.status, stderrHead: (r.stderr || '').slice(0, 200) }) },
    });
  }

  const logText = logFile ? readTextFileSafe(logFile) : '';
  const parsedRes = adapter.parseResult({ stdout: r.stdout, stderr: r.stderr, status: r.status, logText });
  if (parsedRes.errorCode) {
    emitErr(ctx, parsedRes.errorCode, { details: { ...baseDetails(adapter, 'rescue', {}), ...(parsedRes.errorDetails || {}) } });
  }

  const summaryText = adapter.summarize(parsedRes.body || '');
  const budget = checkContextBudget(summaryText, { estimateTokens: adapter.estimateTokens, tokenCap: SUMMARY_TOKEN_CAP, maxChars: DEFAULT_SUMMARY_MAX_CHARS });
  if (budget.violated) {
    emitErr(ctx, 'CCP-CTX-001', { details: { estimated_tokens: budget.estimatedTokens, summary_length_chars: budget.lengthChars } });
  }

  let resultPathOut = null;
  if (jobId) {
    const { resultPath } = jobArtifactPaths(adapter, paths, jobId);
    writeFileSync(resultPath, summaryText, 'utf8');
    resultPathOut = exposedResultPath(adapter, paths, resultPath);
    patchJobMeta(
      paths.JOBS_DIR,
      jobId,
      {
        state: 'completed',
        completed_at: new Date().toISOString(),
        result_path: resultPathOut,
        summary_3lines: summaryText,
        token_usage: adapter.tokensFrom(parsedRes.tokens),
        ...(parsedRes.meta || {}),
      },
      { writeStatusAlias }
    );
  }

  emitSucc(ctx, {
    summary: summaryText || '(empty)',
    result_path: resultPathOut,
    tokens: adapter.tokensFrom(parsedRes.tokens),
    details: {
      ...baseDetails(adapter, 'rescue', {}),
      ...adapter.details.extraFor('rescue', { jobId, meta: parsedRes.meta, durationMs: duration, model: params.model }),
    },
  });
}

function runBackground(ctx, { prompt, cwd, params }) {
  const { adapter, paths } = ctx;
  const claudeSessionId = process.env.CLAUDE_SESSION_ID || `ppid:${process.ppid}`;
  const { jobId, pid } = dispatchBackgroundJob({
    jobsDir: paths.JOBS_DIR,
    cli: adapter.id,
    workerScriptPath: ctx.entryScriptPath,
    workerArgsPrefix: ctx.workerArgsPrefix,
    prompt,
    params,
    cwd,
    claudeSessionId,
    writeStatusAlias: !!adapter.supports.jobMetaStatusAlias,
  });
  emitBg(ctx, {
    job_id: jobId,
    next_action: adapter.messages.nextAction('background', jobId),
    details: { ...baseDetails(adapter, 'rescue-background', {}), ...adapter.details.extraFor('rescue-background', { pid }) },
  });
}

function handleStatus(ctx, parsed) {
  const { adapter, paths } = ctx;
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!isValidJobId(adapter, jobId)) {
    const hint = adapter.messages.missingArg('status');
    emitErr(ctx, 'CCP-INVALID-001', { message: hint.message, action: hint.action });
  }
  const { status, meta } = lookupJobMeta(paths.JOBS_DIR, jobId);
  if (status === 'missing') emitErr(ctx, adapter.supports.jobLookupCodes.missing, { details: jobLookupDetails(adapter, jobId, 'missing') });
  if (status === 'corrupt') emitErr(ctx, adapter.supports.jobLookupCodes.corrupt, { details: jobLookupDetails(adapter, jobId, 'corrupt') });
  emitSucc(ctx, {
    summary: adapter.messages.statusSummary(jobId, meta),
    tokens: adapter.tokensFrom({ input: 0, output: 0, total: 0 }),
    details: { ...baseDetails(adapter, 'status', {}), ...adapter.details.extraFor('status', { jobId, meta }) },
  });
}

function handleResult(ctx, parsed) {
  const { adapter, paths } = ctx;
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!isValidJobId(adapter, jobId)) {
    const hint = adapter.messages.missingArg('result');
    emitErr(ctx, 'CCP-INVALID-001', { message: hint.message, action: hint.action });
  }
  const { status, meta } = lookupJobMeta(paths.JOBS_DIR, jobId);
  if (status === 'missing') emitErr(ctx, adapter.supports.jobLookupCodes.missing, { details: jobLookupDetails(adapter, jobId, 'missing') });
  if (status === 'corrupt') emitErr(ctx, adapter.supports.jobLookupCodes.corrupt, { details: jobLookupDetails(adapter, jobId, 'corrupt') });
  // Which code (and which state families map to it) is adapter-owned: one
  // adapter splits queued/running (JOB-002) from every other non-completed
  // state (JOB-004, e.g. failed/cancelled); another's original collapsed all
  // of them into a single JOB-002 check. A shared two-branch `if` here would
  // silently impose one adapter's split on every adapter.
  if (meta.state !== 'completed') {
    const code = adapter.supports.resultIncompleteCode(meta.state);
    const subcommand = code === 'CCP-JOB-002' ? 'result-queued-or-running' : 'result-incomplete';
    emitErr(ctx, code, { details: detailsOrNull(adapter.details.extraFor(subcommand, { jobId, meta })) });
  }
  const resolvedResultPath =
    adapter.result.pathStyle === 'repo-relative' && meta.result_path && !meta.result_path.startsWith('/')
      ? resolve(paths.REPO_ROOT, meta.result_path)
      : meta.result_path;
  if (!resolvedResultPath || !existsSync(resolvedResultPath)) {
    emitErr(ctx, 'CCP-JOB-004', { details: adapter.details.extraFor('result-file-missing', { jobId, meta }) });
  }
  const summary = (meta.summary_3lines || '').slice(0, DEFAULT_SUMMARY_MAX_CHARS);
  emitSucc(ctx, {
    summary,
    result_path: meta.result_path,
    tokens: adapter.tokensFrom(meta.token_usage),
    details: {
      ...baseDetails(adapter, 'result', {}),
      job_id: jobId,
      ...adapter.details.extraFor('result', { meta }),
    },
  });
}

function handleCancel(ctx, parsed) {
  const { adapter, paths } = ctx;
  const jobId = parsed.flags.jobId || parsed.positional[0];
  if (!jobId) {
    const hint = adapter.messages.missingArg('cancel');
    emitErr(ctx, 'CCP-INVALID-001', { message: hint.message, action: hint.action });
  }
  const r = cancelJobImpl({ jobsDir: paths.JOBS_DIR, jobId, writeStatusAlias: !!adapter.supports.jobMetaStatusAlias });
  if (!r.ok) {
    if (r.code === 'CCP-JOB-404') emitErr(ctx, 'CCP-JOB-001', { details: { job_id: jobId } });
    if (r.code === 'CCP-JOB-409') emitErr(ctx, 'CCP-JOB-409', { details: { job_id: jobId } });
    // Unreachable in practice (cancelJobImpl only ever returns 404/409/ok) — the
    // shared, CLI-neutral fallback code is fixed here rather than sourced from
    // an adapter field, since no adapter can supply a value with real CLI-specific
    // variation for a branch that never runs.
    emitErr(ctx, 'CCP-INVALID-001', { message: `Unexpected cancel failure for job ${jobId}`, action: 'Check the job state and try again.', details: { job_id: jobId, error: r.error } });
  }
  emitSucc(ctx, {
    summary: `job ${jobId} cancelled`,
    tokens: adapter.tokensFrom({ input: 0, output: 0, total: 0 }),
    details: { ...baseDetails(adapter, 'cancel', {}), job_id: jobId, state: 'cancelled' },
  });
}

function handleTaskWorker(ctx, parsed) {
  const { adapter, paths } = ctx;
  const jobId = parsed.positional[0];
  if (!jobId) process.exit(64); // Missing argument — no envelope output (child stderr logs only)
  const meta = readJobMeta(paths.JOBS_DIR, jobId);
  if (!meta) process.exit(64);
  const writeStatusAlias = !!adapter.supports.jobMetaStatusAlias;

  const logFile = adapter.result.logFileName ? join(paths.JOBS_DIR, jobId, adapter.result.logFileName) : null;
  const args = adapter.buildArgs({
    prompt: meta.prompt,
    cwd: process.cwd(),
    model: meta.params?.model,
    effort: meta.params?.effort,
    sandbox: meta.params?.sandbox,
    maxTokens: meta.params?.maxTokens,
    logFile,
  });
  const start = Date.now();
  const r = runSync({ bin: ctx.bin, args, cwd: process.cwd(), timeoutMs: meta.params?.timeoutMs || adapter.timeouts.background });
  const duration = Date.now() - start;
  const { dir: artifactDir, resultPath } = jobArtifactPaths(adapter, paths, jobId);
  const exitCode = r.status ?? 1;

  if (r.status === 0 && r.stdout) {
    const logText = logFile ? readTextFileSafe(logFile) : '';
    const parsedRes = adapter.parseResult({ stdout: r.stdout, stderr: r.stderr, status: r.status, logText });
    const summary = adapter.summarize(parsedRes.body || '') || '(empty)';
    const tokens = adapter.tokensFrom(parsedRes.tokens);
    // For adapters whose result file lives outside JOBS_DIR (the
    // repo-relative anchor), that directory was never created by the
    // pre-dispatch ensureJobDir call above (which only ever targets
    // JOBS_DIR) — create it here so a CCP_JOBS_DIR override doesn't leave
    // the write with nowhere to land. A no-op (existsSync short-circuits)
    // whenever the two locations already coincide, which is every default,
    // non-overridden run.
    ensureJobDir(artifactDir, '');
    writeFileSync(resultPath, summary, 'utf8');
    patchJobMeta(
      paths.JOBS_DIR,
      jobId,
      {
        state: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
        result_path: exposedResultPath(adapter, paths, resultPath),
        summary_3lines: clampSummary(summary),
        token_usage: tokens,
        ...(parsedRes.meta || {}),
        duration_ms: duration,
      },
      { writeStatusAlias }
    );
  } else {
    const errorPayload = {
      code: r.status === null ? 'CCP-TIMEOUT-001' : adapter.classifyFailure({ stdout: r.stdout, stderr: r.stderr, status: r.status, signal: r.signal, error: r.error }),
      stderr_head: (r.stderr || '').slice(0, 500),
    };
    patchJobMeta(
      paths.JOBS_DIR,
      jobId,
      {
        state: 'failed',
        completed_at: new Date().toISOString(),
        exit_code: exitCode,
        error: errorPayload,
        duration_ms: duration,
      },
      { writeStatusAlias }
    );
  }
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// main dispatcher
// ---------------------------------------------------------------------------

/**
 * @param {object} adapter
 * @param {string[]} argv                     args after the subcommand slot (no CLI-name token)
 * @param {object} entryOpts
 * @param {string} entryOpts.entryScriptPath   script re-invoked for the detached task-worker child
 * @param {string[]} [entryOpts.workerArgsPrefix]  extra argv tokens the worker needs before
 *                                                  "task-worker <jobId>" (e.g. [adapter.id] for the
 *                                                  hybrid companion.mjs entry; [] for a thin alias)
 */
export function run(adapter, argv, entryOpts) {
  assertAdapter(adapter);
  const paths = resolvePaths();
  const errorCatalog = mergeErrorCatalog(adapter.errors);
  const ctx = {
    adapter,
    paths,
    errorCatalog,
    bin: resolveBin(adapter),
    entryScriptPath: entryOpts.entryScriptPath,
    workerArgsPrefix: entryOpts.workerArgsPrefix || [],
  };

  const parsed = parseArgsForAdapter(adapter, argv);
  const cmd = parsed.command;

  // Reject-flag check happens before subcommand resolution (global, not
  // subcommand-scoped) — this preserves each adapter's pre-refactor behavior
  // and stays a no-op for any adapter that declares an empty rejectFlags.
  for (const rf of adapter.supports.rejectFlags || []) {
    const key = normalizeFlagName(rf.flag.replace(/^--?/, ''));
    if (parsed.flags[key] !== undefined) {
      emitErr(ctx, 'CCP-INVALID-001', { message: rf.message, action: rf.action, details: rf.details });
    }
  }

  // Value-conditional flag validation (path traversal guard etc.).
  // A no-op for any adapter whose validateFlagValue always returns null.
  for (const [key, value] of Object.entries(parsed.flags)) {
    if (typeof value !== 'string') continue;
    const violation = adapter.supports.validateFlagValue(key, value);
    if (violation) {
      emitErr(ctx, violation.code, { message: violation.message, action: violation.action, details: violation.details });
    }
  }

  if (!adapter.supports.subcommands.includes(cmd)) {
    const visible = adapter.supports.subcommands.filter((s) => s !== 'task-worker');
    // messages.usage is required (not defaulted here) — the wording is CLI-specific
    // (one adapter names its own script file, another uses a generic "Use one
    // of: a | b | c." phrasing) and a core-level default would just be one
    // adapter's wording occupying the generic slot.
    emitErr(ctx, 'CCP-INVALID-001', {
      message: `Unknown subcommand: ${cmd || '(empty)'}`,
      action: adapter.messages.usage(visible),
    });
  }

  switch (cmd) {
    case 'setup':
      return handleSetup(ctx);
    case 'preflight':
      return handlePreflight(ctx);
    case 'rescue':
      return handleRescue(ctx, parsed);
    case 'status':
      return handleStatus(ctx, parsed);
    case 'result':
      return handleResult(ctx, parsed);
    case 'cancel':
      return handleCancel(ctx, parsed);
    case 'task-worker':
      return handleTaskWorker(ctx, parsed);
    default:
      // Unreachable — the supports.subcommands check above already rejected
      // anything not in the adapter's declared list.
      return emitErr(ctx, 'CCP-INVALID-001', { message: `Unhandled subcommand: ${cmd}`, action: 'Internal error — please report this.' });
  }
}
