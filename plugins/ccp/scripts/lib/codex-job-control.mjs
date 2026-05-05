import { join } from 'node:path';
import {
  enqueueBackgroundJob,
  patchMeta,
  readMeta,
  waitForJob,
} from './codex-state.mjs';
import { spawnDetachedWorker, killPid, isAlive } from './codex-process.mjs';

/**
 * Background job dispatch - register meta + spawn a detached worker.
 * Called by the codex-companion 'rescue --background' entry point.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.mode             "codex" | "gemini"
 * @param {string} opts.workerScriptPath  task-worker entry script (codex-companion itself)
 * @param {string} opts.prompt
 * @param {object} [opts.params]
 * @param {string} [opts.cwd]
 * @param {string} [opts.claudeSessionId]
 * @param {string} [opts.nodeBin]        default: process.execPath
 * @returns {{ jobId: string, pid: number, meta: object }}
 */
export function dispatchBackgroundJob(opts) {
  const {
    jobsDir,
    mode,
    workerScriptPath,
    prompt,
    params = {},
    cwd,
    claudeSessionId,
    nodeBin = process.execPath,
  } = opts;
  const { jobId, dir, meta } = enqueueBackgroundJob({
    jobsDir,
    mode,
    prompt,
    params,
    claudeSessionId,
  });
  const stdoutPath = meta.stdout_path;
  const stderrPath = meta.stderr_path;
  // Worker args: task-worker <jobId>
  const args = [workerScriptPath, 'task-worker', jobId];
  const { pid } = spawnDetachedWorker({
    bin: nodeBin,
    args,
    cwd: cwd || process.cwd(),
    stdoutPath,
    stderrPath,
    env: { CCP_JOBS_DIR: jobsDir },
  });
  const next = patchMeta(jobsDir, jobId, { pid, state: 'running', started_at: new Date().toISOString() });
  return { jobId, pid, meta: next };
}

/**
 * Cancel an in-flight job. Sends SIGTERM, then moves meta to 'cancelled'.
 * @returns {{ ok: boolean, jobId: string, code?: string, error?: string }}
 */
export function cancelJob({ jobsDir, jobId }) {
  const meta = readMeta(jobsDir, jobId);
  if (!meta) {
    return { ok: false, jobId, code: 'CCP-JOB-404', error: 'Job not found' };
  }
  if (meta.state !== 'running' && meta.state !== 'queued') {
    return { ok: false, jobId, code: 'CCP-JOB-409', error: `Cannot cancel in current state (${meta.state})` };
  }
  if (meta.pid && isAlive(meta.pid)) {
    killPid(meta.pid);
  }
  patchMeta(jobsDir, jobId, {
    state: 'cancelled',
    completed_at: new Date().toISOString(),
  });
  return { ok: true, jobId };
}

/**
 * Polling wrapper - mirrors the companion-side awaitWithTimeout pattern
 */
export async function awaitJobResult({ jobsDir, jobId, timeoutMs, pollIntervalMs }) {
  return waitForJob({ jobsDir, jobId, timeoutMs, pollIntervalMs });
}

/**
 * Single job-state lookup
 */
export function snapshotJob(jobsDir, jobId) {
  return readMeta(jobsDir, jobId);
}
