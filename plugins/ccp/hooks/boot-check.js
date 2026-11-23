#!/usr/bin/env node
// CCP — boot-check hook
// Event: SessionStart (startup | resume | clear | compact)
// Behavior: check the Node version, then check every CLI declared by a file in
//           scripts/adapters/ (installed? version high enough? authenticated?).
//           A CLI that is not installed is not reported, unless none is installed.
//           Guidance is sent through additionalContext; with nothing to say the
//           output is an empty object.
// The adapter directory is the registry: adding an adapter file needs no change here.
// Failure-silent: the hook always exits 0 and never blocks session startup.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUMMARY_MAX_CHARS = 500;
const MIN_NODE_MAJOR = 20;
const BOOT_PROBE_TIMEOUT_MS = 5000; // upper bound for one CLI's version probe; not an adapter key
const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

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

const load = (path) => import(pathToFileURL(path).href);

/** Core helpers, or null when either module cannot be loaded (CLI checks are then skipped). */
async function loadCore() {
  try {
    const { runSync } = await load(join(SCRIPTS_DIR, 'core', 'process.mjs'));
    const { resolveBin, compareSemver } = await load(join(SCRIPTS_DIR, 'core', 'runtime.mjs'));
    return typeof runSync === 'function' && typeof resolveBin === 'function' && typeof compareSemver === 'function'
      ? { runSync, resolveBin, compareSemver }
      : null;
  } catch {
    return null;
  }
}

/** Adapters in file-name order; a file that fails to load or lacks a string id is skipped. */
async function loadAdapters() {
  let files;
  try {
    files = readdirSync(join(SCRIPTS_DIR, 'adapters')).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    return [];
  }
  const adapters = [];
  for (const f of files) {
    try {
      const a = (await load(join(SCRIPTS_DIR, 'adapters', f))).default;
      if (a && typeof a.id === 'string') adapters.push(a);
    } catch {
      // skipped: one broken adapter must not hide the others
    }
  }
  return adapters;
}

/** @returns {{ id: string, installed: boolean, issue: string|null }} */
function checkAdapter({ runSync, resolveBin, compareSemver }, a) {
  const r = runSync({ bin: resolveBin(a), args: a.version.args, timeoutMs: BOOT_PROBE_TIMEOUT_MS });
  if (r.error?.code === 'ETIMEDOUT') return { id: a.id, installed: true, issue: null }; // installed, not verified
  const ver = !r.error && r.status === 0 ? (r.stdout.match(a.version.pattern) || [])[1] : undefined;
  if (!ver) return { id: a.id, installed: false, issue: null };
  const setup = `run \`/ccp:${a.id}-setup\``;
  if (compareSemver(ver, a.version.min) < 0) {
    const msg = (a.messages.versionTooOld?.(ver, a.version.min) ?? a.errors[a.version.tooOldCode]).message;
    return { id: a.id, installed: true, issue: `${msg} — ${setup}` };
  }
  if (!a.auth.detect()) {
    return { id: a.id, installed: true, issue: `${a.errors[a.auth.failureCode].message} — ${setup}` };
  }
  return { id: a.id, installed: true, issue: null };
}

async function checkClis() {
  const core = await loadCore();
  if (!core) return [];
  const results = [];
  for (const a of await loadAdapters()) {
    try {
      results.push(checkAdapter(core, a));
    } catch {
      // skipped: a malformed adapter declaration affects only itself
    }
  }
  if (results.length > 0 && results.every((x) => !x.installed)) {
    const names = results.map((x) => `\`/ccp:${x.id}-setup\``).join(' or ');
    return [`no supported CLI is installed — install one, then run ${names}`];
  }
  return results.map((x) => x.issue).filter(Boolean);
}

async function main() {
  readStdinSync();

  const issues = [];
  if (nodeMajor() < MIN_NODE_MAJOR) {
    issues.push(`Node.js ${process.versions.node} is below the required v${MIN_NODE_MAJOR} — install Node.js ${MIN_NODE_MAJOR} or later`);
  }
  issues.push(...(await checkClis()));

  if (issues.length === 0) return emit({});

  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: clamp(`[CCP] Startup check: ${issues.join(' · ')}`),
    },
  });
}

main().catch(() => emit({}));
