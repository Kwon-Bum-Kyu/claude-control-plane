#!/usr/bin/env node
// repo-guard — deployment-boundary checks for this repository.
//
// This repository is published as a single public repo: whatever git tracks is
// what the world sees. These checks make that boundary mechanical instead of
// remembered. They run in CI (the authoritative copy) and, for anyone who has
// run `bootstrap`, in local git hooks as a faster first pass.
//
// Written from scratch. No scanner or regular-expression code is borrowed from
// another project. If borrowed code is ever added here, add the upstream
// licence text under LICENSES/ and update the attribution section of
// CONTRIBUTING.md at the same time.
//
// Pattern definitions live in repo-guard.patterns.json rather than in this
// file, so that this file itself stays inside the scans it performs.
//
// Subcommands:
//   ignore-coverage   the ignore rules and the tracked set agree
//   content           tracked content carries no host paths, secrets or personal data
//   public-surface    published files carry no maintainer-only identifiers
//   bootstrap         point git at .githooks
//
// Exit codes: 0 = all checks passed, 1 = violations found, 2 = the tool failed.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PATTERNS_PATH = resolve(HERE, 'repo-guard.patterns.json');

const argv = process.argv.slice(2);
const command = argv[0];
const FORMAT = argv.includes('--format') ? argv[argv.indexOf('--format') + 1] : 'text';

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
}

function fail(code, message) {
  const out = { ok: false, checks: [], error: { code, message } };
  if (FORMAT === 'json') console.log(JSON.stringify(out, null, 2));
  else console.error(`repo-guard: ${message}`);
  process.exit(2);
}

let patterns = null;
try {
  patterns = JSON.parse(readFileSync(PATTERNS_PATH, 'utf8'));
} catch {
  patterns = null;
}
if (!patterns) fail('patterns-unreadable', `cannot read or parse ${PATTERNS_PATH}`);

// ── helpers ──────────────────────────────────────────────────────────────────

function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      out += '[^/]*';
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + out + '$');
}

function maskAll(text, needle) {
  if (!needle) return text;
  return text.split(needle).join('x'.repeat(needle.length));
}

function maskRegExp(text, re) {
  return text.replace(new RegExp(re, 'g'), (m) => 'x'.repeat(m.length));
}

function isBinary(text) {
  return text.includes('\u0000');
}

function trackedFiles(commit) {
  const out = commit ? git(['ls-tree', '-r', '--name-only', commit]) : git(['ls-files']);
  return out.split('\n').filter(Boolean);
}

function readTracked(path, source) {
  try {
    if (source.kind === 'commit') return git(['show', `${source.commit}:${path}`]);
    if (source.kind === 'index') return git(['show', `:${path}`]);
    return readFileSync(resolve(ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

function scan(text, patternList) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const p of patternList) {
      const m = lines[i].match(new RegExp(p.re));
      if (m) found.push({ line: i + 1, pattern: p.id, excerpt: m[0].slice(0, 80) });
    }
  }
  return found;
}

function report(checks) {
  const ok = checks.every((c) => c.ok);
  if (FORMAT === 'json') {
    console.log(JSON.stringify({ ok, checks }, null, 2));
  } else {
    for (const c of checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  (${c.violations.length} violation(s))`);
      for (const v of c.violations) {
        console.log(v.line
          ? `  ${v.path}:${v.line}: [${v.pattern}] ${v.excerpt}`
          : `  ${v.path}: [${v.pattern}] ${v.excerpt}`);
      }
    }
  }
  process.exit(ok ? 0 : 1);
}

// ── ignore-coverage ──────────────────────────────────────────────────────────

function ignoreCoverage() {
  const cfg = patterns.ignoreCoverage;
  const violations = [];

  // A tracked file that the ignore rules also match means the two disagree.
  const contradictory = git(['ls-files', '--cached', '--ignored', '--exclude-standard'])
    .split('\n').filter(Boolean);
  for (const path of contradictory) {
    violations.push({ path, pattern: 'tracked-but-ignored', excerpt: 'tracked while matching an ignore rule' });
  }

  // A tracked path that should never be tracked, whatever the ignore rules say.
  for (const path of trackedFiles(null)) {
    for (const re of cfg.trackedPathDeny) {
      if (new RegExp(re).test(path)) {
        violations.push({ path, pattern: 'denied-path', excerpt: re });
      }
    }
  }

  // A rule that must exist even when no matching file is on disk right now.
  // Nothing else catches a dropped rule until the file reappears, by which
  // point it is already a candidate for tracking.
  for (const probe of cfg.mustBeIgnored) {
    let ignored = true;
    try {
      git(['check-ignore', '-q', '--', probe]);
    } catch {
      ignored = false;
    }
    if (!ignored) {
      violations.push({ path: probe, pattern: 'missing-ignore-rule', excerpt: 'no ignore rule covers this path' });
    }
  }

  report([{ id: 'ignore-coverage', ok: violations.length === 0, violations }]);
}

// ── content ──────────────────────────────────────────────────────────────────

function contentCheck() {
  const cfg = patterns.content;
  const violations = [];

  const msgIdx = argv.indexOf('--commit-msg');
  if (msgIdx !== -1) {
    const file = argv[msgIdx + 1];
    if (!file || !existsSync(file)) fail('missing-message-file', `commit message file not found: ${file}`);
    let text = readFileSync(file, 'utf8');
    // An identity trailer is the one place a commit message is supposed to
    // carry an address, and this repository requires a sign-off on every
    // commit. Mask the address there and nothing else on the line, so a host
    // path smuggled into a trailer still fails.
    const trailers = patterns.commitMessage.identityTrailers || [];
    if (trailers.length) {
      const re = new RegExp(`^(${trailers.join('|')}):([^<]*)<([^>]+)>\\s*$`, 'gim');
      text = text.replace(re, (_m, name, who, addr) => `${name}:${who}<${'x'.repeat(addr.length)}>`);
    }
    const all = [...cfg.patterns, ...patterns.commitMessage.patterns];
    for (const hit of scan(text, all)) violations.push({ path: file, ...hit });
    report([{ id: 'content', ok: violations.length === 0, violations }]);
    return;
  }

  const commitIdx = argv.indexOf('--commit');
  const source = commitIdx !== -1
    ? { kind: 'commit', commit: argv[commitIdx + 1] }
    : argv.includes('--staged') ? { kind: 'index' } : { kind: 'worktree' };

  let files;
  if (source.kind === 'commit') {
    files = trackedFiles(source.commit);
  } else if (source.kind === 'index') {
    files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
  } else {
    files = trackedFiles(null);
  }

  const excluded = new Set(cfg.excludeFiles || []);
  for (const path of files) {
    if (excluded.has(path)) continue;
    let text = readTracked(path, source);
    if (text === null || isBinary(text)) continue;
    // Exceptions mask the allowed token first, so that a line carrying both an
    // allowed and a blocked token still reports the blocked one.
    for (const e of cfg.exceptions || []) {
      if (e.paths.includes(path)) text = maskAll(text, e.token);
    }
    for (const hit of scan(text, cfg.patterns)) violations.push({ path, ...hit });
  }

  report([{ id: 'content', ok: violations.length === 0, violations }]);
}

// ── public-surface ───────────────────────────────────────────────────────────

function metaConsistency() {
  // The rule document and this tool must describe the same two lists. If they
  // drift, one of them is lying to whoever reads it.
  const doc = resolve(ROOT, patterns.ruleDoc);
  if (!existsSync(doc)) {
    return [{ path: patterns.ruleDoc, pattern: 'meta', excerpt: 'rule document not found' }];
  }
  const text = readFileSync(doc, 'utf8');
  const blocks = [...text.matchAll(/```\n([\s\S]*?)```/g)]
    .map((m) => m[1].trim().split('\n').map((s) => s.trim()).filter(Boolean));
  const cfg = patterns.publicSurface;
  const same = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  const out = [];
  if (!blocks.some((b) => same(b, cfg.scope))) {
    out.push({ path: patterns.ruleDoc, pattern: 'meta', excerpt: 'no list in the rule matches the scope this tool uses' });
  }
  if (!blocks.some((b) => same(b, cfg.exclude))) {
    out.push({ path: patterns.ruleDoc, pattern: 'meta', excerpt: 'no list in the rule matches the exclusions this tool uses' });
  }
  return out;
}

function exceptionHygiene() {
  // An exception that no longer matches anything is dead weight in an
  // allowlist, and an allowlist that only ever grows stops being a boundary.
  // Removing the stale entry is the fix, not widening it.
  const out = [];
  const check = (label, entry, matches) => {
    const hit = entry.paths.some((p) => {
      const text = readTracked(p, { kind: 'worktree' });
      return text !== null && matches(text);
    });
    if (!hit) {
      out.push({
        path: entry.paths.join(', '),
        pattern: 'unused-exception',
        excerpt: `${label} exception no longer matches anything in its scope`,
      });
    }
  };
  for (const e of patterns.content.exceptions || []) {
    check('content', e, (t) => t.includes(e.token));
  }
  for (const e of patterns.publicSurface.exceptions || []) {
    check('public-surface', e, (t) => new RegExp(e.re).test(t));
  }
  return out;
}

function publicSurface() {
  const cfg = patterns.publicSurface;
  const scope = cfg.scope.map(globToRegExp);
  const exclude = cfg.exclude.map(globToRegExp);
  const inScope = (p) => scope.some((r) => r.test(p)) && !exclude.some((r) => r.test(p));

  const commitIdx = argv.indexOf('--commit');
  const source = commitIdx !== -1 ? { kind: 'commit', commit: argv[commitIdx + 1] } : { kind: 'worktree' };
  const files = trackedFiles(source.kind === 'commit' ? source.commit : null);

  const contentViolations = [];
  const pathViolations = [];
  const allowLiteral = new Set(cfg.workspaceLiteralAllowList || []);

  for (const path of files) {
    // File names are published too, so an identifier can hide in a path.
    for (const p of cfg.patterns) {
      if (p.id === 'review-cite') continue;
      const m = path.match(new RegExp(p.re));
      if (m) pathViolations.push({ path, pattern: p.id, excerpt: m[0] });
    }

    if (!inScope(path)) continue;
    let text = readTracked(path, source);
    if (text === null || isBinary(text)) continue;

    for (const token of cfg.preservedTokens || []) text = maskAll(text, token);
    for (const e of cfg.exceptions || []) {
      if (e.paths.includes(path)) text = maskRegExp(text, e.re);
    }
    // Allow-listed files may name the working directory in decomposed form,
    // but never as a path with a separator.
    if (allowLiteral.has(path) && cfg.workspaceLiteral) {
      text = maskRegExp(text, cfg.workspaceLiteral + '(?!/)');
    }

    for (const hit of scan(text, cfg.patterns)) contentViolations.push({ path, ...hit });
  }

  const meta = metaConsistency();
  const stale = exceptionHygiene();
  report([
    { id: 'public-surface', ok: contentViolations.length === 0, violations: contentViolations },
    { id: 'public-surface-paths', ok: pathViolations.length === 0, violations: pathViolations },
    { id: 'rule-check-meta', ok: meta.length === 0, violations: meta },
    { id: 'exception-hygiene', ok: stale.length === 0, violations: stale },
  ]);
}

// ── bootstrap ────────────────────────────────────────────────────────────────

function bootstrap() {
  git(['config', 'core.hooksPath', '.githooks']);
  console.log('repo-guard: local git hooks enabled (core.hooksPath = .githooks)');
  console.log('repo-guard: hooks are a convenience, not a guarantee — --no-verify bypasses them, and CI is what actually enforces the boundary.');
  process.exit(0);
}

// ── dispatch ─────────────────────────────────────────────────────────────────

switch (command) {
  case 'ignore-coverage': ignoreCoverage(); break;
  case 'content': contentCheck(); break;
  case 'public-surface': publicSurface(); break;
  case 'bootstrap': bootstrap(); break;
  default:
    console.error('usage: repo-guard.mjs <ignore-coverage|content|public-surface|bootstrap>'
      + ' [--staged] [--commit <sha>] [--commit-msg <file>] [--format json]');
    process.exit(2);
}
