#!/usr/bin/env node
// CCP — boot-check hook
// Event: SessionStart (startup | resume | clear | compact)
// Behavior: run companion preflight — Node ≥ v20, agy --version ≥ 1.0.0,
//           and check auth (ANTIGRAVITY_API_KEY env or ~/.gemini/antigravity-cli/).
//           On failure, send English guidance via additionalContext; on success, noop.
// Failure-silent: the hook does not block session startup.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SUMMARY_MAX_CHARS = 500;
const MIN_NODE_MAJOR = 20;

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

function clamp(text) {
  if (!text) return '';
  return text.length <= SUMMARY_MAX_CHARS
    ? text
    : text.slice(0, SUMMARY_MAX_CHARS - 16) + '...(truncated)';
}

function nodeMajor() {
  const m = process.versions.node.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function resolveAgyBin() {
  const env = process.env.CCP_AGY_BIN;
  if (env && env.length > 0 && existsSync(env)) return env;
  const localBin = join(homedir(), '.local', 'bin', 'agy');
  if (existsSync(localBin)) return localBin;
  return 'agy';
}

function agyVersion() {
  const r = spawnSync(resolveAgyBin(), ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const m = (r.stdout || '').match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function detectAuth() {
  if (process.env.ANTIGRAVITY_API_KEY && process.env.ANTIGRAVITY_API_KEY.length > 0) return 'api_key';
  if (existsSync(join(homedir(), '.gemini', 'antigravity-cli'))) return 'keyring';
  return null;
}

function main() {
  readStdinSync();

  const issues = [];
  if (nodeMajor() < MIN_NODE_MAJOR) {
    issues.push(
      `Node.js ${process.versions.node} (CCP requires ≥ v${MIN_NODE_MAJOR}) — run \`/antigravity:setup\``
    );
  }
  const ver = agyVersion();
  if (!ver) {
    issues.push('Antigravity CLI (`agy`) not installed — `curl -fsSL https://antigravity.google/cli/install.sh | bash`, then run `/antigravity:setup`');
  }
  if (!detectAuth()) {
    issues.push('Antigravity authentication not found — run `agy` once interactively to complete keyring sign-in, or export `ANTIGRAVITY_API_KEY`, then run `/antigravity:setup`');
  }

  if (issues.length === 0) return emit({});

  const message = clamp(
    `[CCP] Startup check: ${issues.join(' · ')}`
  );

  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: message,
    },
  });
}

main();
