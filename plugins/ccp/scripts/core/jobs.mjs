// Portions adapted from openai/codex-plugin-cc
//   (plugins/codex/scripts/lib/state.mjs · plugins/codex/scripts/lib/tracked-jobs.mjs)
// Upstream commit 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Licensed under the Apache License 2.0 — see LICENSES/codex-plugin-cc-Apache-2.0.txt
// Modified by CCP contributors: English error messages; unified job directory layout;
// session-scoped job filtering; CLI-neutral job metadata shared by every adapter;
// added a read-time key-alias normalization layer (see readJobMeta below); writing
// the legacy `status` alias alongside `state` is opt-in per call (writeStatusAlias)
// so each adapter's pre-refactor on-disk shape — and whatever downstream reads it —
// is reproduced exactly rather than unified by default.
//
// License-isolation note: this file carries only the Apache-2.0-derived job-state
// implementation, generalized for multi-adapter use. A companion whose meta
// reader/writer is still CCP-original inline code (MIT) is not merged in here —
// it keeps its own implementation until it moves onto core, at which point it is
// wired in by thin delegation rather than by copying its text into this file.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Read a job metadata file exactly as stored on disk (no normalization).
 * @returns {{ status: 'missing'|'corrupt'|'ok', raw: object|null }}
 */
function readRawMetaResult(jobsDir, jobId) {
  const path = join(jobsDir, jobId, 'meta.json');
  if (!existsSync(path)) return { status: 'missing', raw: null };
  try {
    return { status: 'ok', raw: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { status: 'corrupt', raw: null };
  }
}

/** Back-compat helper for callers that don't need to distinguish missing vs corrupt. */
function readRawMeta(jobsDir, jobId) {
  return readRawMetaResult(jobsDir, jobId).raw;
}

/**
 * Read-time key-alias normalization. Older/other-adapter meta
 * shapes use `id`/`status`/`result_file_path`; the normalized shape used
 * everywhere downstream is `job_id`/`state`/`result_path`.
 *
 * Priority when both `status` and `state` are present and differ: `status`
 * wins (it is the field `hooks/rescue-finalize.js` writes on orphan
 * detection). This is the *read* side of that rule; the *write* side (below)
 * deliberately withholds the `status` key for adapters that never had it on
 * disk to begin with, so this branch is a no-op for those and only matters
 * once an alternate-shaped meta file (one that does carry `status`) is
 * normalized here.
 */
function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const hasStatus = Object.prototype.hasOwnProperty.call(raw, 'status') && raw.status !== undefined;
  const hasState = Object.prototype.hasOwnProperty.call(raw, 'state') && raw.state !== undefined;
  let state = raw.state;
  if (hasStatus && hasState && raw.status !== raw.state) state = raw.status;
  else if (hasStatus && !hasState) state = raw.status;
  return {
    ...raw,
    job_id: raw.job_id ?? raw.id ?? null,
    result_path: raw.result_path ?? raw.result_file_path ?? null,
    state,
  };
}

/**
 * Read a job metadata file, normalized. Returns null if missing or parse fails.
 * @param {string} jobsDir
 * @param {string} jobId
 */
export function readJobMeta(jobsDir, jobId) {
  const raw = readRawMeta(jobsDir, jobId);
  if (raw === null) return null;
  return normalizeMeta(raw);
}

/**
 * Same as readJobMeta, but distinguishes "no job directory" from "meta.json
 * exists but fails to parse" — some adapters use different error codes for
 * each (a lookup miss vs corrupted state), some collapse both to one code.
 * @param {string} jobsDir
 * @param {string} jobId
 * @returns {{ status: 'missing'|'corrupt'|'ok', meta: object|null }}
 */
export function lookupJobMeta(jobsDir, jobId) {
  const { status, raw } = readRawMetaResult(jobsDir, jobId);
  return { status, meta: status === 'ok' ? normalizeMeta(raw) : null };
}

/**
 * Write a job metadata file (atomic-style - temp-file -> rename pattern).
 * Writes exactly the keys given — callers own their own on-disk shape. Does
 * not itself decide whether a `status` alias belongs in `meta`; see
 * enqueueBackgroundJob/patchJobMeta's `writeStatusAlias` option for that.
 * @param {string} jobsDir
 * @param {string} jobId
 * @param {object} meta
 */
export function writeJobMeta(jobsDir, jobId, meta) {
  const dir = join(jobsDir, jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'meta.json');
  writeFileSync(path, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

/**
 * Ensure the job directory exists. Create it if missing.
 */
export function ensureJobDir(jobsDir, jobId) {
  const dir = join(jobsDir, jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Enter the background-job queue - create a new jobId, then initialize meta.json in queued state.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.cli       adapter id (whichever CLI's adapter is invoking this)
 * @param {string} opts.prompt
 * @param {object} [opts.params]  model/effort/sandbox, etc.
 * @param {string} [opts.claudeSessionId]
 * @param {boolean} [opts.writeStatusAlias]  mirror `state` into a `status` key too —
 *   the caller (core/runtime.mjs) decides this per adapter (adapter.supports.jobMetaStatusAlias),
 *   this function has no CLI-name branching of its own
 * @returns {{ jobId: string, dir: string, meta: object }}
 */
export function enqueueBackgroundJob({ jobsDir, cli, prompt, params = {}, claudeSessionId, writeStatusAlias = false }) {
  if (!cli) {
    throw new Error('enqueueBackgroundJob: cli (adapter id) is required');
  }
  const jobId = randomUUID();
  const dir = ensureJobDir(jobsDir, jobId);
  const meta = {
    job_id: jobId,
    mode: cli,
    state: 'queued',
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    pid: null,
    exit_code: null,
    prompt,
    params,
    claude_session_id: claudeSessionId || null,
    stdout_path: join(dir, 'stdout.log'),
    stderr_path: join(dir, 'stderr.log'),
    result_path: null,
    error: null,
  };
  if (writeStatusAlias) meta.status = meta.state;
  writeJobMeta(jobsDir, jobId, meta);
  return { jobId, dir, meta };
}

/**
 * Transition meta.state (queued -> running -> completed | failed | cancelled).
 * Uses a simple read-modify-write pattern to avoid concurrency conflicts.
 * Patches are applied to the *raw* on-disk object (not the normalized read
 * view) so callers never accidentally persist a normalized `status` alias.
 *
 * @param {string} jobsDir
 * @param {string} jobId
 * @param {object} patch  partial update (state, pid, exit_code, completed_at, etc.)
 * @param {object} [opts]
 * @param {boolean} [opts.writeStatusAlias]  when the patch changes `state`, also mirror
 *   it into `status` — same per-adapter opt-in as enqueueBackgroundJob, no CLI-name
 *   branching here either
 */
export function patchJobMeta(jobsDir, jobId, patch, opts = {}) {
  const cur = readRawMeta(jobsDir, jobId);
  if (!cur) {
    throw new Error(`patchJobMeta: meta.json not found for jobId=${jobId}`);
  }
  const next = { ...cur, ...patch };
  if (opts.writeStatusAlias && 'state' in patch) next.status = patch.state;
  writeJobMeta(jobsDir, jobId, next);
  return normalizeMeta(next);
}

/**
 * Poll until meta.state reaches a terminal state or times out.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.jobId
 * @param {number} opts.timeoutMs       total wait limit
 * @param {number} opts.pollIntervalMs  polling interval
 * @returns {Promise<object>} final normalized meta
 */
export async function waitForJob({ jobsDir, jobId, timeoutMs, pollIntervalMs }) {
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const start = Date.now();
  while (true) {
    const meta = readJobMeta(jobsDir, jobId);
    if (meta && TERMINAL.has(meta.state)) return meta;
    if (Date.now() - start > timeoutMs) {
      return meta || { job_id: jobId, state: 'timeout', error: 'wait timeout' };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * List all job directories (sorted by created_at descending), normalized.
 */
export function listJobs(jobsDir) {
  if (!existsSync(jobsDir)) return [];
  const entries = readdirSync(jobsDir);
  const jobs = [];
  for (const id of entries) {
    const stat = (() => {
      try { return statSync(join(jobsDir, id)); } catch { return null; }
    })();
    if (!stat || !stat.isDirectory()) continue;
    const meta = readJobMeta(jobsDir, id);
    if (meta) jobs.push(meta);
  }
  jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return jobs;
}

/**
 * Filter only jobs that belong to the current Claude session.
 * If env CLAUDE_SESSION_ID is missing, fall back to process.ppid.
 *
 * @param {object[]} jobs
 * @param {string} [sessionId]  explicit session ID
 */
export function filterJobsForCurrentSession(jobs, sessionId) {
  const sid = sessionId || process.env.CLAUDE_SESSION_ID || `ppid:${process.ppid}`;
  return jobs.filter((j) => {
    if (!j) return false;
    if (j.claude_session_id == null) return true; // Include unspecified jobs too (compatibility)
    return j.claude_session_id === sid;
  });
}

/**
 * Return the single most recent resumable job.
 *
 * @param {string} jobsDir
 * @param {object} [opts]
 * @param {string} [opts.cli]        adapter id filter (undefined = all)
 * @param {string} [opts.sessionId]
 * @returns {object|null}
 */
export function findLatestResumableJob(jobsDir, opts = {}) {
  const all = listJobs(jobsDir);
  let pool = filterJobsForCurrentSession(all, opts.sessionId);
  if (opts.cli) pool = pool.filter((j) => j.mode === opts.cli);
  pool = pool.filter((j) => j.state === 'completed' && j.result_path);
  // listJobs is already sorted by created_at descending
  return pool[0] || null;
}

/**
 * In-flight jobs for the current session (queued | running)
 */
export function findInflightJobs(jobsDir, opts = {}) {
  const all = listJobs(jobsDir);
  let pool = filterJobsForCurrentSession(all, opts.sessionId);
  if (opts.cli) pool = pool.filter((j) => j.mode === opts.cli);
  return pool.filter((j) => j.state === 'queued' || j.state === 'running');
}
