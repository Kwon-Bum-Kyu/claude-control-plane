// CCP — core path resolution (CLI-neutral)
// Computes PLUGIN_ROOT / REPO_ROOT / JOBS_DIR the same way every companion
// entry point has always computed them. No adapter or CLI name is referenced
// here — this module has nothing CLI-specific to know.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file always lives at <plugin>/scripts/core/paths.mjs, so walking up
// two levels lands on the plugin root regardless of which entry script (the
// unified multi-CLI entry, or any CLI-specific thin-alias entry) imported it.
const CORE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = resolve(CORE_DIR, '..', '..');

/**
 * @returns {{ PLUGIN_ROOT: string, REPO_ROOT: string, JOBS_DIR: string }}
 */
export function resolvePaths() {
  const PLUGIN_ROOT =
    process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.length > 0
      ? resolve(process.env.CLAUDE_PLUGIN_ROOT)
      : DEFAULT_PLUGIN_ROOT;
  const REPO_ROOT = resolve(PLUGIN_ROOT, '..', '..');
  const JOBS_DIR =
    process.env.CCP_JOBS_DIR && process.env.CCP_JOBS_DIR.length > 0
      ? resolve(process.env.CCP_JOBS_DIR)
      : resolve(REPO_ROOT, '_workspace', '_jobs');
  return { PLUGIN_ROOT, REPO_ROOT, JOBS_DIR };
}
