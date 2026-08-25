// CCP — core path resolution (CLI-neutral)
// Computes PLUGIN_ROOT / PROJECT_ROOT / JOBS_DIR the same way every companion
// entry point and the SubagentStop hook now compute them. No adapter or CLI
// name is referenced here — this module has nothing CLI-specific to know.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file always lives at <plugin>/scripts/core/paths.mjs, so walking up
// two levels lands on the plugin root regardless of which entry script (the
// unified multi-CLI entry, or any CLI-specific thin-alias entry) imported it.
const CORE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = resolve(CORE_DIR, '..', '..');

/**
 * Resolve the project a job belongs to — deliberately independent of
 * PLUGIN_ROOT, which names where the plugin's own assets live (its physical
 * install location), not where a project's job state should be written.
 * A marketplace install's PLUGIN_ROOT is a cache directory that can differ
 * per host and vanish on update; anchoring job state there mixes multiple
 * projects' jobs together and can silently drop them.
 *
 * Priority: CLAUDE_PROJECT_DIR, then CLAUDE_PROJECT_ROOT (a back-compat
 * alias for callers that already set it), then a caller-supplied hint (the
 * SubagentStop hook passes its stdin payload's cwd; a companion process
 * passes nothing here), then process.cwd() as the always-available final
 * fallback. Because the last resort always yields a value, every caller
 * converges on the same project root when none of the environment variables
 * are set and the hint is absent — the specific failure mode this
 * resolution exists to close.
 * @param {{ projectDirHint?: string }} [opts]
 * @returns {string}
 */
function resolveProjectRoot({ projectDirHint } = {}) {
  if (process.env.CLAUDE_PROJECT_DIR && process.env.CLAUDE_PROJECT_DIR.length > 0) {
    return resolve(process.env.CLAUDE_PROJECT_DIR);
  }
  if (process.env.CLAUDE_PROJECT_ROOT && process.env.CLAUDE_PROJECT_ROOT.length > 0) {
    return resolve(process.env.CLAUDE_PROJECT_ROOT);
  }
  if (typeof projectDirHint === 'string' && projectDirHint.length > 0) {
    return resolve(projectDirHint);
  }
  return process.cwd();
}

/**
 * Resolve the job storage directory. CCP_JOBS_DIR is an explicit override
 * and always wins regardless of the project-root chain above — both the
 * golden test harness (isolation) and the detached background worker (env
 * inheritance from its parent) depend on this being the top priority.
 * @param {{ projectDirHint?: string }} [opts]
 * @returns {string}
 */
export function resolveJobsDir(opts = {}) {
  if (process.env.CCP_JOBS_DIR && process.env.CCP_JOBS_DIR.length > 0) {
    return resolve(process.env.CCP_JOBS_DIR);
  }
  return resolve(resolveProjectRoot(opts), '_workspace', '_jobs');
}

/**
 * @param {{ projectDirHint?: string }} [opts]
 * @returns {{ PLUGIN_ROOT: string, PROJECT_ROOT: string, JOBS_DIR: string }}
 */
export function resolvePaths(opts = {}) {
  const PLUGIN_ROOT =
    process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.length > 0
      ? resolve(process.env.CLAUDE_PLUGIN_ROOT)
      : DEFAULT_PLUGIN_ROOT;
  const PROJECT_ROOT = resolveProjectRoot(opts);
  const JOBS_DIR = resolveJobsDir(opts);
  return { PLUGIN_ROOT, PROJECT_ROOT, JOBS_DIR };
}
