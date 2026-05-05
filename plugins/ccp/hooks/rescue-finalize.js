#!/usr/bin/env node
// CCP — rescue-finalize hook
// Event: SubagentStop
// Behavior: right after the gemini-rescue subagent stops, if
//           _workspace/_jobs/<id>/meta.json is stuck at status=running, finalize it as failed
//           to clean up the orphan.
// Failure-silent: no error blocks user flow.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
const JOBS_DIR =
  process.env.CCP_JOBS_DIR || resolve(REPO_ROOT, '_workspace', '_jobs');
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

function tryFinalize(jobDir) {
  const metaPath = join(jobDir, 'meta.json');
  if (!existsSync(metaPath)) return false;
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return false;
  }
  if (meta.status !== 'running') return false;
  const started = meta.started_at ? Date.parse(meta.started_at) : NaN;
  if (!Number.isFinite(started)) return false;
  if (Date.now() - started < STALE_THRESHOLD_MS) return false;
  meta.status = 'failed';
  meta.completed_at = new Date().toISOString();
  meta.error = { code: 'CCP-TIMEOUT-001', reason: 'orphan_subagent_stop' };
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return true;
  } catch {
    return false;
  }
}

function main() {
  // The input payload is unused — only scan JOBS_DIR.
  readStdinSync();
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

main();
