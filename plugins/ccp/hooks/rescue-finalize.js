#!/usr/bin/env node
// CCP — rescue-finalize hook
// Event: SubagentStop
// Behavior: right after the antigravity-rescue (or codex-rescue) subagent stops, if
//           a job under the job directory is stuck running, finalize it as failed
//           to clean up the orphan.
// Failure-silent: no error blocks user flow.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // Consider running jobs older than 5 minutes as orphaned

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

function tryFinalize(jobDir) {
  const metaPath = join(jobDir, 'meta.json');
  if (!existsSync(metaPath)) return false;
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return false;
  }
  // Read side: `status` is an opt-in alias that only antigravity's meta
  // carries (adapter.supports.jobMetaStatusAlias). Keying orphan detection
  // off it alone is deliberate — an adapter that does not write the alias is
  // opting out of this cleanup, and reading `state` as a fallback here would
  // newly start finalizing that adapter's stalled jobs. That is a behavior
  // change, not a path fix, so it stays out.
  if (meta.status !== 'running') return false;
  const started = meta.started_at ? Date.parse(meta.started_at) : NaN;
  if (!Number.isFinite(started)) return false;
  if (Date.now() - started < STALE_THRESHOLD_MS) return false;
  // Write side: mirror the finalized value into `state` as well. Any meta
  // reaching this point carries the alias, and the two keys are contracted
  // to mirror each other — leaving `state` at 'running' would keep a
  // finalized job reporting itself as still running to `…:status`.
  meta.status = 'failed';
  meta.state = 'failed';
  meta.completed_at = new Date().toISOString();
  meta.error = { code: 'CCP-TIMEOUT-001', reason: 'orphan_subagent_stop' };
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
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
    if (tryFinalize(dir)) finalized++;
  }
  emit({});
}

main().catch(() => emit({}));
