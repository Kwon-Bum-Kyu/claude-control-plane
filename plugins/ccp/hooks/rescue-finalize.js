#!/usr/bin/env node
// CCP — rescue-finalize hook
// Event: SubagentStop (runs after every subagent stops; matcher "*")
// Behavior: finalize job records that are still `running` but can no longer
//           finish, marking them failed:
//           - a record with a pid (the process that owns the job: a background
//             worker, or the companion waiting on a foreground CLI), once that
//             process no longer exists (no age condition)
//           - a record without a pid (a record written before pids were
//             recorded), once the job's own timeout plus GRACE_MS has passed
//             since it started
//           Only the state keys a record already has (`state`, `status`) are
//           rewritten; a key the record never had is not added.
//           The rule lives in core/orphan.mjs, shared with the companions'
//           `status` subcommand. If core/orphan.mjs cannot be loaded, no
//           record is touched.
// Failure-silent: no error blocks user flow.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Orphan detection and finalization live in core/orphan.mjs, shared with the
// companions' `status` subcommand. Loaded dynamically for the same
// failure-silent reason as core/paths.mjs above. If it cannot be loaded (a
// missing or broken core module), the hook touches no record at all: it never
// finalizes on a rule it cannot see.
async function loadFinalizeSafe() {
  try {
    const orphanModulePath = resolve(__dirname, '..', 'scripts', 'core', 'orphan.mjs');
    const { finalizeIfOrphan } = await import(orphanModulePath);
    return finalizeIfOrphan;
  } catch {
    return null;
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
  const finalizeIfOrphan = await loadFinalizeSafe();
  if (!finalizeIfOrphan || !existsSync(JOBS_DIR)) return emit({});
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
    if (finalizeIfOrphan(dir, { reason: 'orphan_subagent_stop' })) finalized++;
  }
  emit({});
}

main().catch(() => emit({}));
