import { listJobs } from './codex-state.mjs';

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
 * Priority:
 *   1) Metadata-based (current session + state == 'completed' + result_path present)
 *   2) (Not yet wired) codex resume --last fallback remains a future enhancement
 *
 * @param {string} jobsDir
 * @param {object} [opts]
 * @param {string} [opts.mode]      'codex' | 'gemini' | undefined (all)
 * @param {string} [opts.sessionId]
 * @returns {object|null}
 */
export function findLatestResumableJob(jobsDir, opts = {}) {
  const all = listJobs(jobsDir);
  let pool = filterJobsForCurrentSession(all, opts.sessionId);
  if (opts.mode) pool = pool.filter((j) => j.mode === opts.mode);
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
  if (opts.mode) pool = pool.filter((j) => j.mode === opts.mode);
  return pool.filter((j) => j.state === 'queued' || j.state === 'running');
}
