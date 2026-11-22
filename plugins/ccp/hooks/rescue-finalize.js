#!/usr/bin/env node
// CCP — rescue-finalize hook
// Event: SubagentStop (runs after every subagent stops; matcher "*")
// Behavior: finalize job records that are still `running` but can no longer
//           finish, marking them failed:
//           - a record with a worker pid, once that process no longer exists
//             (no age condition)
//           - a record without a pid (a foreground job record), once the job's
//             own timeout plus GRACE_MS has passed since it started
//           Only the state keys a record already has (`state`, `status`) are
//           rewritten; a key the record never had is not added.
// Failure-silent: no error blocks user flow.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TIMEOUT_MS = 600000; // job without a valid params.timeoutMs: the adapters' largest declared timeout
const GRACE_MS = 300000;           // after a timeout, time for the companion to stop the CLI and record the result

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// Job-directory resolution is shared with the companion scripts (see
// core/paths.mjs) so both sides always agree on where jobs live. Loaded
// dynamically, not with a static top-level import: a static import is
// hoisted and runs before any try/catch in this file can see it, so a
// missing or broken module would take this failure-silent hook down with
// it. On import failure, fall back to the pre-shared-module inline
// calculation this hook always used (same shape, minus CLAUDE_PROJECT_DIR
// and stdin-hint awareness) so orphan cleanup degrades rather than crashes.
async function resolveJobsDirSafe(projectDirHint) {
  try {
    const pathsModulePath = resolve(__dirname, '..', 'scripts', 'core', 'paths.mjs');
    const { resolveJobsDir } = await import(pathsModulePath);
    return resolveJobsDir({ projectDirHint });
  } catch {
    const repoRoot = process.env.CLAUDE_PROJECT_ROOT || projectDirHint || process.cwd();
    return process.env.CCP_JOBS_DIR || resolve(repoRoot, '_workspace', '_jobs');
  }
}

// Liveness uses core/process.mjs#isAlive (EPERM counts as alive). Loaded
// dynamically for the same failure-silent reason as core/paths.mjs above.
// If it cannot be loaded, every pid is treated as alive: records with a pid
// are left untouched rather than finalized on a guess.
async function loadIsAliveSafe() {
  try {
    const processModulePath = resolve(__dirname, '..', 'scripts', 'core', 'process.mjs');
    const { isAlive } = await import(processModulePath);
    return isAlive;
  } catch {
    return () => true;
  }
}

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

/** @returns {boolean} whether the record is an orphan at `now` (decision table rows 2-7) */
function isOrphan(meta, isAlive, now) {
  if (jobState(meta) !== 'running') return false;
  if (hasPid(meta)) return !isAlive(meta.pid);
  const started = typeof meta.started_at === 'string' ? Date.parse(meta.started_at) : NaN;
  if (!Number.isFinite(started)) return false;
  return now - started > timeoutOf(meta) + GRACE_MS;
}

/** @returns {object} a new record; only keys already present among state/status become 'failed' */
function finalized(cur, nowIso) {
  const next = { ...cur, completed_at: nowIso, error: { code: 'CCP-TIMEOUT-001', reason: 'orphan_subagent_stop' } };
  for (const key of ['state', 'status']) if (Object.hasOwn(cur, key)) next[key] = 'failed';
  return next;
}

// Re-read right before writing: the job's own process may have recorded its result after the first read (a worker writes its final state before it exits).
/** @returns {boolean} true when the record was rewritten */
function tryFinalize(jobDir, isAlive) {
  const metaPath = join(jobDir, 'meta.json');
  const meta = readMeta(metaPath);
  if (meta === null || !isOrphan(meta, isAlive, Date.now())) return false;
  const cur = readMeta(metaPath);
  if (cur === null || jobState(cur) !== 'running') return false;
  try {
    writeFileSync(metaPath, JSON.stringify(finalized(cur, new Date().toISOString()), null, 2));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const raw = readStdinSync();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }
  const projectDirHint = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : undefined;
  const JOBS_DIR = await resolveJobsDirSafe(projectDirHint);
  const isAlive = await loadIsAliveSafe();

  if (!existsSync(JOBS_DIR)) return emit({});
  let finalized = 0;
  let entries;
  try {
    entries = readdirSync(JOBS_DIR);
  } catch {
    return emit({});
  }
  for (const id of entries) {
    const dir = join(JOBS_DIR, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (tryFinalize(dir, isAlive)) finalized++;
  }
  emit({});
}

main().catch(() => emit({}));
