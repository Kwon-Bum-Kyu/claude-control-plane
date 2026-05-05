#!/usr/bin/env node
// CCP — boot-check hook
// Event: SessionStart (startup | resume | clear | compact)
// Behavior: run companion preflight — Node ≥ v20, gemini --version ≥ 0.38.0,
//           and check OAuth credentials (GEMINI_API_KEY env or ~/.gemini/google_accounts.json).
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

function geminiVersion() {
  const r = spawnSync('gemini', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const m = (r.stdout || '').match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function detectAuth() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0) return 'api_key';
  if (existsSync(join(homedir(), '.gemini', 'google_accounts.json'))) return 'oauth';
  return null;
}

function main() {
  readStdinSync();

  const issues = [];
  if (nodeMajor() < MIN_NODE_MAJOR) {
    issues.push(
      `Node.js ${process.versions.node} (CCP requires ≥ v${MIN_NODE_MAJOR}) — run \`/gemini:setup\``
    );
  }
  const ver = geminiVersion();
  if (!ver) {
    issues.push('Gemini CLI not installed — install `@google/gemini-cli` globally, then run `/gemini:setup`');
  }
  if (!detectAuth()) {
    issues.push('Gemini OAuth credentials not found — run `/gemini:setup`');
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
