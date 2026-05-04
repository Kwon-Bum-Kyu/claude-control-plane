// Adapted from: codex-plugin-cc plugins/codex/scripts/lib/state.mjs
// Source commit: 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Original license: Apache-2.0 (see ATTRIBUTION.md §1.3, NOTICE)
// Modifications: localised error messages, unified _workspace/_jobs/ path, mode:"codex" meta field, folder layout aligned with gemini-companion
// SHA-of-this-adaptation: <to be filled at B1 merge>

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
 * Read a job metadata file. Returns null if missing or parse fails.
 * @param {string} jobsDir
 * @param {string} jobId
 */
export function readMeta(jobsDir, jobId) {
  const path = join(jobsDir, jobId, 'meta.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write a job metadata file (atomic-style - keep the codex-plugin-cc temp-file -> rename pattern).
 * @param {string} jobsDir
 * @param {string} jobId
 * @param {object} meta
 */
export function writeMeta(jobsDir, jobId, meta) {
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
 * Function-level adaptation of codex-plugin-cc's enqueueBackgroundTask.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.mode      "codex" | "gemini"
 * @param {string} opts.prompt
 * @param {object} [opts.params]  model/effort/sandbox, etc.
 * @param {string} [opts.claudeSessionId]
 * @returns {{ jobId: string, dir: string, meta: object }}
 */
export function enqueueBackgroundJob({ jobsDir, mode, prompt, params = {}, claudeSessionId }) {
  if (!mode || (mode !== 'codex' && mode !== 'gemini')) {
    throw new Error(`enqueueBackgroundJob: mode must be 'codex' or 'gemini', got ${mode}`);
  }
  const jobId = randomUUID();
  const dir = ensureJobDir(jobsDir, jobId);
  const meta = {
    job_id: jobId,
    mode,
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
  writeMeta(jobsDir, jobId, meta);
  return { jobId, dir, meta };
}

/**
 * Transition meta.state (queued -> running -> completed | failed | cancelled).
 * Uses a simple read-modify-write pattern to avoid concurrency conflicts (same as codex-plugin-cc).
 *
 * @param {string} jobsDir
 * @param {string} jobId
 * @param {object} patch  partial update (state, pid, exit_code, completed_at, etc.)
 */
export function patchMeta(jobsDir, jobId, patch) {
  const cur = readMeta(jobsDir, jobId);
  if (!cur) {
    throw new Error(`patchMeta: meta.json not found for jobId=${jobId}`);
  }
  const next = { ...cur, ...patch };
  writeMeta(jobsDir, jobId, next);
  return next;
}

/**
 * Poll until meta.state reaches a terminal state or times out.
 * Function-level adaptation of codex-plugin-cc's waitForSingleJobSnapshot.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.jobId
 * @param {number} opts.timeoutMs       total wait limit
 * @param {number} opts.pollIntervalMs  polling interval
 * @returns {Promise<object>} final meta
 */
export async function waitForJob({ jobsDir, jobId, timeoutMs, pollIntervalMs }) {
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const start = Date.now();
  while (true) {
    const meta = readMeta(jobsDir, jobId);
    if (meta && TERMINAL.has(meta.state)) return meta;
    if (Date.now() - start > timeoutMs) {
      return meta || { job_id: jobId, state: 'timeout', error: 'wait timeout' };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * List all job directories (sorted by created_at descending)
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
    const meta = readMeta(jobsDir, id);
    if (meta) jobs.push(meta);
  }
  jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return jobs;
}
