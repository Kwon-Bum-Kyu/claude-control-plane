// CCP original (no adapted material — this is not a codex-plugin-cc file).
// Orphaned-job finalization shared by the SubagentStop hook
// (hooks/rescue-finalize.js) and the companions' `status` subcommand
// (core/runtime.mjs), so both always apply the same rule. A record is an orphan
// when it still says `running` but can no longer finish:
//   - it has a pid (the process that owns the job: a background worker, or the
//     companion waiting on a foreground CLI) and that process no longer exists —
//     no age condition;
//   - it has no pid (a record written before pids were recorded) and its own
//     timeout plus GRACE_MS has passed since it started.
// Only the state keys a record already has (`state`, `status`) are rewritten.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlive } from './process.mjs';

const DEFAULT_TIMEOUT_MS = 600000; // record without a valid params.timeoutMs: the adapters' largest declared timeout
const GRACE_MS = 300000;           // after a timeout, time for the companion to stop the CLI and record the result

/** @returns {object|null} the parsed record, or null when missing, unreadable, or not an object */
function readMeta(metaPath) {
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    return meta !== null && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

/** Same read priority as core/jobs.mjs normalizeMeta: `status` first, then `state`. */
function jobState(meta) {
  return meta.status ?? meta.state;
}

function hasPid(meta) {
  return Number.isInteger(meta.pid) && meta.pid > 0;
}

function timeoutOf(meta) {
  const t = meta.params?.timeoutMs;
  return Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
}

/** @returns {boolean} whether the record is an orphan at `now` */
function isOrphan(meta, now) {
  if (jobState(meta) !== 'running') return false;
  if (hasPid(meta)) return !isAlive(meta.pid);
  const started = typeof meta.started_at === 'string' ? Date.parse(meta.started_at) : NaN;
  if (!Number.isFinite(started)) return false;
  return now - started > timeoutOf(meta) + GRACE_MS;
}

/** @returns {object} a new record; only keys already present among state/status become 'failed' */
function finalized(cur, nowIso, reason) {
  const next = { ...cur, completed_at: nowIso, error: { code: 'CCP-TIMEOUT-001', reason } };
  for (const key of ['state', 'status']) if (Object.hasOwn(cur, key)) next[key] = 'failed';
  return next;
}

/**
 * Mark one job record failed when it is an orphan at this moment.
 * Never throws for a missing, unreadable, unparsable, non-object, or unwritable
 * meta.json — each of those returns false.
 * @param {string} jobDir  directory that holds the job's meta.json
 * @param {{ reason: string }} opts  written as error.reason ('orphan_subagent_stop' from the hook, 'orphan_status' from status)
 * @returns {boolean} true when meta.json was rewritten
 */
export function finalizeIfOrphan(jobDir, { reason }) {
  const metaPath = join(jobDir, 'meta.json');
  const meta = readMeta(metaPath);
  if (meta === null || !isOrphan(meta, Date.now())) return false;
  // Re-read right before writing: the job's own process may have recorded its result after the first read (a worker writes its final state before it exits).
  const cur = readMeta(metaPath);
  if (cur === null || jobState(cur) !== 'running') return false;
  try {
    writeFileSync(metaPath, JSON.stringify(finalized(cur, new Date().toISOString(), reason), null, 2));
    return true;
  } catch {
    return false;
  }
}
