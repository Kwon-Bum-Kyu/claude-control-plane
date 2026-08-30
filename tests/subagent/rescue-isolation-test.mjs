#!/usr/bin/env node
// CCP rescue subagent isolation check — exit-side regression.
//
// Contract under test:
//   A dispatched rescue subagent records exactly one `Bash` tool use in its
//   own transcript, and that single command matches its companion `rescue`
//   invocation pattern. No other Bash command is executed.
//
// Why it exists:
//   Main-context regression checks cannot see this. If a rescue subagent
//   reads raw files into its own context and forwards only an interpretation,
//   every main-context check still passes while the isolation the subagent
//   exists for is gone. This check looks at the subagent's own transcript.
//
// Input:
//   A Claude Code session directory, a `subagents/` directory, or a single
//   `agent-*.jsonl` transcript. `--latest` opts into auto-discovering the
//   newest session of the current project.
//
// Verdict and exit code:
//   PASS 0 · FAIL 1 · SKIP 2. SKIP means "not verifiable" — a missing
//   directory, an absent transcript, or an unparsable line. Absence of
//   evidence is never reported as compliance.
//
// Transcript layout is Claude Code local storage, not a public interface.
// If the layout does not match what this check expects, it exits SKIP
// instead of guessing.
//
// Run: node tests/subagent/rescue-isolation-test.mjs <session-dir>

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HELP_TEXT,
  SKIP_MESSAGES,
  tildify,
  tildifyAll,
  truncateCodepoints,
  shortTranscript,
  nonBashDisplayHint,
  printUsageError,
  renderHuman,
} from './lib/render.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Matches an agentType with an optional namespace prefix, capturing the
// adapter name (§1.5). Reused for both target identification and the
// --agent-type option's own validation.
const AGENT_TYPE_RE = /^(?:[A-Za-z0-9_-]+:)?(codex|antigravity)-rescue$/;

// Removes heredoc bodies for quoted delimiters only (§2.2 / §2.3). Declared
// once and shared by the structural view1 builder and scanChain(), both of
// which only ever call .replace() with it — never .test()/.exec() — so the
// shared `g` flag never leaks lastIndex state between calls.
const HEREDOC_RE = /<<-?\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\r?\n[\s\S]*?\r?\n\2(?=\s|$)/g;

// First-argument anchor for command-shape parsing (§2.2).
const INVOCATION_RE = /^\s*node\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(\S+)(?:\s+(\S+))?/;
const COMPANION_BASENAME_RE = /^(?:(codex|antigravity)-)?companion\.mjs$/;

// The only task-substitution form the agent definitions allow (§2.3).
const TASK_SUBST_RE = /\$\(\s*cat\s+<<HEREDOC\s*\)/g;

const AGENT_FILE_RE = /^agent-.+\.jsonl$/;

const DEFAULT_MAX_COMMAND_CHARS = 160;

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..', '..');
void REPO_ROOT; // path resolution is anchored on this file's own location, not process.cwd() (§5) — kept for readers; --latest is the sole cwd-based exception.

// ---------------------------------------------------------------------------
// scanChain — copied verbatim from 01_harness_spec.md §2.3. Do not edit.
// ---------------------------------------------------------------------------

/**
 * Left-to-right shell-quote scanner.
 * @param {string} command raw command text of a Bash tool use
 * @returns {{chained: boolean, unbalanced: boolean}}
 */
function scanChain(command) {
  const view1 = String(command)
    .trim()
    .replace(HEREDOC_RE, '<<HEREDOC')
    .replace(TASK_SUBST_RE, 'HEREDOCARG');

  let state = 'none';
  let chained = false;

  for (let i = 0; i < view1.length; i += 1) {
    const c = view1[i];
    const n = view1[i + 1];

    if (state === 'sq') {
      if (c === "'") state = 'none';
      continue;
    }

    if (state === 'dq') {
      if (c === '\\') { i += 1; continue; }
      if (c === '"') { state = 'none'; continue; }
      if (c === '`') { chained = true; continue; }
      if (c === '$' && n === '(') { chained = true; i += 1; continue; }
      continue;
    }

    // state === 'none'
    if (c === '\\') { i += 1; continue; }
    if (c === "'") { state = 'sq'; continue; }
    if (c === '"') { state = 'dq'; continue; }
    if (c === '`' || c === ';' || c === '|' || c === '\n' || c === '\r') { chained = true; continue; }
    if (c === '&') { chained = true; if (n === '&') i += 1; continue; } // `&&` and a lone `&` (background) are both chain operators
    if ((c === '$' || c === '<' || c === '>') && n === '(') { chained = true; i += 1; continue; }
  }

  return { chained, unbalanced: state !== 'none' };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

class SkipSignal extends Error {
  constructor(reason, detail, sourcePatch = {}) {
    super(detail);
    this.reason = reason;
    this.detail = detail;
    this.sourcePatch = sourcePatch;
  }
}

class UsageError extends Error {}

const HOME = homedir();

// tildify/tildifyAll/truncateCodepoints/shortTranscript are text-formatting
// helpers and live in ./lib/render.mjs (imported above); expandHome and
// buildCommandPreview stay here because they feed judgment/data, not display.
function expandHome(p) {
  if (typeof p === 'string' && p === '~') return HOME;
  if (typeof p === 'string' && p.startsWith('~/')) return join(HOME, p.slice(2));
  return p;
}

// command_preview builder (§1.6): heredoc body -> <<HEREDOC, then home ->
// ~, then literal newline escaping, then codepoint truncation.
function buildCommandPreview(command, maxChars) {
  let s = String(command ?? '').replace(HEREDOC_RE, '<<HEREDOC');
  s = tildifyAll(s);
  s = s.replace(/\r?\n/g, '\\n');
  const { text, truncated } = truncateCodepoints(s, maxChars);
  return { preview: text, truncated };
}

// SKIP_MESSAGES catalog (verbatim from 01_error_messages.md §2) lives in
// ./lib/render.mjs (imported above) and is reused here to build SkipSignal
// detail text.

function fsErrorToSkip(err, p) {
  if (err && err.code === 'ENOENT') return new SkipSignal('path_not_found', SKIP_MESSAGES.path_not_found({ path: tildify(p) }));
  return new SkipSignal('read_error', SKIP_MESSAGES.read_error({ path: tildify(p), errno: err?.code ?? 'unknown' }));
}

// ---------------------------------------------------------------------------
// Input resolution (§1.3, §1.4)
// ---------------------------------------------------------------------------

function enumerateSessionDir(sessionDir) {
  const subagentsDir = join(sessionDir, 'subagents');
  if (!existsSync(subagentsDir)) {
    throw new SkipSignal('missing_subagents_dir', SKIP_MESSAGES.missing_subagents_dir({ path: tildify(sessionDir) }), { kind: 'unresolved', path: tildify(sessionDir) });
  }
  let entries;
  try {
    entries = readdirSync(subagentsDir);
  } catch (e) {
    throw fsErrorToSkip(e, subagentsDir);
  }
  const files = entries.filter((f) => AGENT_FILE_RE.test(f)).sort().map((f) => join(subagentsDir, f));
  if (files.length === 0) {
    throw new SkipSignal('no_subagent_transcripts', SKIP_MESSAGES.no_subagent_transcripts(), { kind: 'session_dir', path: tildify(sessionDir) });
  }
  return { kind: 'session_dir', dir: sessionDir, files };
}

function resolveInput(rawPath) {
  const resolved = resolve(process.cwd(), rawPath);
  let st;
  try {
    st = statSync(resolved);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new SkipSignal('path_not_found', SKIP_MESSAGES.path_not_found({ path: rawPath }), { kind: 'unresolved', path: rawPath });
    }
    throw fsErrorToSkip(e, resolved);
  }

  if (st.isFile()) {
    if (resolved.endsWith('.jsonl')) {
      return { kind: 'transcript_file', dir: dirname(resolved), files: [resolved] };
    }
    throw new SkipSignal('unsupported_input', SKIP_MESSAGES.unsupported_input({ path: tildify(resolved) }), { kind: 'unresolved', path: tildify(resolved) });
  }

  if (st.isDirectory()) {
    if (basename(resolved) === 'subagents') {
      let entries;
      try {
        entries = readdirSync(resolved);
      } catch (e) {
        throw fsErrorToSkip(e, resolved);
      }
      const files = entries.filter((f) => AGENT_FILE_RE.test(f)).sort().map((f) => join(resolved, f));
      if (files.length === 0) {
        throw new SkipSignal('no_subagent_transcripts', SKIP_MESSAGES.no_subagent_transcripts(), { kind: 'subagents_dir', path: tildify(resolved) });
      }
      return { kind: 'subagents_dir', dir: resolved, files };
    }
    if (existsSync(join(resolved, 'subagents'))) {
      return enumerateSessionDir(resolved);
    }
    throw new SkipSignal('missing_subagents_dir', SKIP_MESSAGES.missing_subagents_dir({ path: tildify(resolved) }), { kind: 'unresolved', path: tildify(resolved) });
  }

  throw new SkipSignal('path_not_found', SKIP_MESSAGES.path_not_found({ path: rawPath }), { kind: 'unresolved', path: rawPath });
}

function resolveLatest(projectsRoot) {
  const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
  const projectDir = join(projectsRoot, slug);
  if (!existsSync(projectDir)) {
    throw new SkipSignal(
      'project_dir_not_found',
      SKIP_MESSAGES.project_dir_not_found({ projectsRoot: tildify(projectsRoot) }),
      { kind: 'unresolved', path: tildify(projectDir) }
    );
  }
  let sessionEntries;
  try {
    sessionEntries = readdirSync(projectDir, { withFileTypes: true });
  } catch (e) {
    throw fsErrorToSkip(e, projectDir);
  }
  let best = null;
  for (const entry of sessionEntries) {
    if (!entry.isDirectory()) continue;
    const subagentsDir = join(projectDir, entry.name, 'subagents');
    if (!existsSync(subagentsDir)) continue;
    let files;
    try {
      files = readdirSync(subagentsDir);
    } catch (e) {
      throw fsErrorToSkip(e, subagentsDir);
    }
    for (const f of files) {
      if (!AGENT_FILE_RE.test(f)) continue;
      const full = join(subagentsDir, f);
      let s;
      try {
        s = statSync(full);
      } catch (e) {
        throw fsErrorToSkip(e, full);
      }
      if (!best || s.mtimeMs > best.mtimeMs) best = { file: full, mtimeMs: s.mtimeMs };
    }
  }
  if (!best) {
    throw new SkipSignal('no_subagent_transcripts', SKIP_MESSAGES.no_subagent_transcripts(), { kind: 'unresolved', path: tildify(projectDir) });
  }
  return dirname(dirname(best.file)); // best.file = <session>/subagents/agent-x.jsonl
}

// ---------------------------------------------------------------------------
// Transcript parsing + tool_use collection (§2.1, §4)
// ---------------------------------------------------------------------------

function parseTranscriptFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw fsErrorToSkip(e, filePath);
  }
  const lines = raw.split(/\r?\n/);
  const records = [];
  const parseErrorLines = [];
  lines.forEach((line, idx) => {
    if (line.trim() === '') return; // blank line / trailing newline — not an error
    try {
      records.push(JSON.parse(line));
    } catch {
      parseErrorLines.push(idx + 1);
    }
  });
  return { records, parseErrorCount: parseErrorLines.length, parseErrorLines: parseErrorLines.slice(0, 5) };
}

function collectToolUses(records) {
  const bashBlocks = [];
  const otherBlocks = [];
  let structureWarnings = 0;
  const seenIds = new Set();

  for (const rec of records) {
    if (!rec || rec.type !== 'assistant') continue; // §2.1 / §4: only assistant records are in scope
    const content = rec.message?.content;
    if (!Array.isArray(content)) {
      structureWarnings += 1;
      continue;
    }
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const id = block.id;
      const hasValidId = typeof id === 'string' && id.length > 0;
      if (hasValidId) {
        if (seenIds.has(id)) continue; // dedup on non-empty string id (§2.1)
        seenIds.add(id);
      } else {
        structureWarnings += 1; // no dedup key — count individually, warn (§2.1)
      }
      const entry = { id: hasValidId ? id : null, name: block.name, block };
      if (block.name === 'Bash') {
        bashBlocks.push({ ...entry, command: block.input?.command });
      } else {
        otherBlocks.push(entry);
      }
    }
  }
  return { bashBlocks, otherBlocks, structureWarnings };
}

// Structural judgment for a single Bash command (§2.2). Returns the "own
// kind" a command would contribute if no companion call is found anywhere
// in the agent, or null if the command's structure + adapter match cleanly
// (chain-scan is applied separately by the caller).
function judgeStructure(command, expectedAdapter) {
  const structView = String(command ?? '').trim().replace(HEREDOC_RE, '<<HEREDOC');
  const m = INVOCATION_RE.exec(structView);
  if (!m) return { kind: 'unexpected_invocation', adapter: null };

  const scriptPath = m[1] ?? m[2] ?? m[3];
  const tok1 = m[4];
  const tok2 = m[5];
  const base = basename(scriptPath);
  const bm = COMPANION_BASENAME_RE.exec(base);
  if (!bm) return { kind: 'not_companion_script', adapter: null };

  let adapter;
  let subcommand;
  if (bm[1]) {
    adapter = bm[1]; // thin alias: <adapter>-companion.mjs
    subcommand = tok1;
  } else {
    if (tok1 !== 'codex' && tok1 !== 'antigravity') {
      return { kind: 'unexpected_invocation', adapter: null }; // unified entry point, missing cli token
    }
    adapter = tok1;
    subcommand = tok2;
  }
  if (subcommand !== 'rescue') return { kind: 'wrong_subcommand', adapter };
  if (adapter !== expectedAdapter) return { kind: 'adapter_mismatch', adapter };
  return { kind: null, adapter };
}

function judgeBashCommand(command, expectedAdapter) {
  const struct = judgeStructure(command, expectedAdapter);
  const { chained, unbalanced } = scanChain(command);
  let ownKind = struct.kind;
  if (!ownKind && chained) ownKind = 'chained_command';
  return { isCompanionRescue: !ownKind, ownKind, unbalanced };
}

// nonBashDisplayHint (used only in the markdown report; never emitted in
// --json — stripped by jsonReplacer) lives in ./lib/render.mjs.

// ---------------------------------------------------------------------------
// Per-agent judgment (§2.4, §2.5)
// ---------------------------------------------------------------------------

function judgeAgent({ transcriptFile, agentType, adapter, maxCommandChars }) {
  const { records, parseErrorCount } = parseTranscriptFile(transcriptFile);
  const { bashBlocks, otherBlocks, structureWarnings: idWarnings } = collectToolUses(records);

  let structureWarnings = idWarnings;
  const judged = bashBlocks.map((b) => {
    const j = judgeBashCommand(b.command, adapter);
    if (j.unbalanced) structureWarnings += 1;
    return { ...b, ...j };
  });

  const companionRescueCount = judged.filter((b) => b.isCompanionRescue).length;
  const firstIdx = judged.findIndex((b) => b.isCompanionRescue);

  const violations = [];
  judged.forEach((b, i) => {
    let kind = null;
    if (firstIdx !== -1) {
      if (i !== firstIdx) kind = 'extra_bash'; // §2.4 rule 2/4: content of the extra call is irrelevant
    } else if (b.ownKind) {
      kind = b.ownKind; // §2.4 rule 3: no valid call anywhere — each command reports its own structural kind
    }
    if (kind) {
      const { preview, truncated } = buildCommandPreview(b.command, maxCommandChars);
      violations.push({ kind, tool_use_id: b.id, tool_name: 'Bash', command_preview: preview, truncated });
    }
  });

  const otherByName = new Map();
  for (const o of otherBlocks) {
    otherByName.set(o.name, (otherByName.get(o.name) ?? 0) + 1);
    violations.push({
      kind: 'non_bash_tool',
      tool_use_id: o.id,
      tool_name: o.name,
      command_preview: null,
      truncated: false,
      _displayHint: nonBashDisplayHint(o.block),
    });
  }
  // non_bash_tool violations sort last, by tool name ascending (§2.7).
  violations.sort((a, b) => {
    const aNonBash = a.kind === 'non_bash_tool';
    const bNonBash = b.kind === 'non_bash_tool';
    if (aNonBash !== bNonBash) return aNonBash ? 1 : -1;
    if (aNonBash && bNonBash) return a.tool_name.localeCompare(b.tool_name);
    return 0; // Bash violations keep transcript-occurrence order (already correct from the forEach above)
  });

  const otherToolUse = [...otherByName.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  let verdict;
  let skipReason = null;
  if (violations.length > 0) {
    verdict = 'fail';
  } else if (parseErrorCount > 0) {
    verdict = 'skip';
    skipReason = 'transcript_parse_error';
  } else if (structureWarnings > 0) {
    verdict = 'skip';
    skipReason = 'structure_mismatch';
  } else if (bashBlocks.length === 0) {
    verdict = 'skip';
    skipReason = 'no_bash_tool_use';
  } else {
    verdict = 'pass';
  }

  const transcript = shortTranscript(transcriptFile);
  const skipMessage = skipReason ? SKIP_MESSAGES[skipReason]({ transcript }) : null;

  return {
    agent_type: agentType,
    adapter,
    transcript,
    verdict,
    bash_tool_use_count: bashBlocks.length,
    companion_rescue_count: companionRescueCount,
    other_tool_use: otherToolUse,
    violations,
    parse_errors: parseErrorCount,
    skip_reason: skipReason,
    _skipMessage: skipMessage,
  };
}

// ---------------------------------------------------------------------------
// meta.json identification (§2.1 target matching, §4)
// ---------------------------------------------------------------------------

function identifyTranscript(transcriptFile, allowedAdapters) {
  const metaPath = transcriptFile.replace(/\.jsonl$/, '.meta.json');
  const transcript = shortTranscript(transcriptFile);
  if (!existsSync(metaPath)) {
    return { unidentified: true, reason: 'missing_meta', detail: SKIP_MESSAGES.missing_meta({ transcript }) };
  }
  let raw;
  try {
    raw = readFileSync(metaPath, 'utf8');
  } catch (e) {
    throw fsErrorToSkip(e, metaPath);
  }
  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return { unidentified: true, reason: 'meta_parse_error', detail: SKIP_MESSAGES.meta_parse_error({ transcript }) };
  }
  if (typeof meta.agentType !== 'string' || meta.agentType.length === 0) {
    return { unidentified: true, reason: 'missing_agent_type', detail: SKIP_MESSAGES.missing_agent_type({ transcript }) };
  }
  const m = AGENT_TYPE_RE.exec(meta.agentType);
  if (!m) return { nonTarget: true };
  const adapter = m[1];
  if (!allowedAdapters.has(adapter)) return { nonTarget: true };
  return { target: true, agentType: meta.agentType, adapter };
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
//
// HELP_TEXT lives in ./lib/render.mjs (imported above).

function parseArgs(argv) {
  const opts = {
    path: null,
    latest: false,
    projectsRoot: null,
    agentTypes: [],
    json: false,
    maxCommandChars: DEFAULT_MAX_COMMAND_CHARS,
    help: false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--help':
        opts.help = true;
        break;
      case '--latest':
        opts.latest = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--projects-root': {
        const v = argv[i += 1];
        if (v === undefined) throw new UsageError('--projects-root requires a value.');
        opts.projectsRoot = v;
        break;
      }
      case '--agent-type': {
        const v = argv[i += 1];
        if (v === undefined) throw new UsageError('--agent-type requires a value.');
        opts.agentTypes.push(v);
        break;
      }
      case '--max-command-chars': {
        const v = argv[i += 1];
        if (v === undefined) throw new UsageError('--max-command-chars requires a value.');
        if (!/^\d+$/.test(v)) throw new UsageError(`--max-command-chars must be a non-negative integer, got "${v}".`);
        opts.maxCommandChars = parseInt(v, 10);
        break;
      }
      default:
        if (a.startsWith('--')) throw new UsageError(`Unknown option: ${a}`);
        positionals.push(a);
    }
  }
  if (positionals.length > 1) {
    throw new UsageError(`Unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
  }
  opts.path = positionals[0] ?? null;
  return opts;
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------
//
// printUsageError/renderHuman (and everything renderHuman calls) live in
// ./lib/render.mjs (imported above).

function jsonReplacer(key, value) {
  if (key.startsWith('_')) return undefined;
  return value;
}

function output(result, opts, projectsRootTilde) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, jsonReplacer, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(result, projectsRootTilde) + '\n');
  }
}

function emptyResult(verdict, exitCode, source) {
  return {
    schema_version: 1,
    verdict,
    exit_code: exitCode,
    checked_at: new Date().toISOString(),
    source,
    totals: { targets: 0, pass: 0, fail: 0, skip: 0, unidentified: 0, parse_errors: 0 },
    agents: [],
    skips: [],
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const DEFAULT_PROJECTS_ROOT = join(HOME, '.claude', 'projects');

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    printUsageError(e.message);
    process.exitCode = 64;
    return;
  }

  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    process.exitCode = 0;
    return;
  }

  if (!opts.latest && !opts.path) {
    printUsageError('<path> is required unless --latest is given.');
    process.exitCode = 64;
    return;
  }

  let allowedAdapters = new Set(['codex', 'antigravity']);
  if (opts.agentTypes.length > 0) {
    allowedAdapters = new Set();
    for (const v of opts.agentTypes) {
      const m = AGENT_TYPE_RE.exec(v);
      if (!m) {
        printUsageError(`--agent-type value "${v}" is not a recognized rescue agentType (expected .../codex-rescue or .../antigravity-rescue).`);
        process.exitCode = 64;
        return;
      }
      allowedAdapters.add(m[1]);
    }
  }

  const resolvedBy = opts.latest ? 'latest' : 'argument';
  let projectsRootTilde = null;
  let inputInfo;

  try {
    if (opts.latest) {
      const projectsRoot = expandHome(opts.projectsRoot ?? DEFAULT_PROJECTS_ROOT);
      projectsRootTilde = tildify(projectsRoot);
      const sessionDir = resolveLatest(projectsRoot);
      inputInfo = enumerateSessionDir(sessionDir);
    } else {
      projectsRootTilde = tildify(DEFAULT_PROJECTS_ROOT);
      inputInfo = resolveInput(opts.path);
    }
  } catch (e) {
    if (e instanceof SkipSignal) {
      const source = {
        kind: e.sourcePatch.kind ?? 'unresolved',
        path: e.sourcePatch.path ?? null,
        resolved_by: resolvedBy,
        transcripts_found: 0,
      };
      const result = emptyResult('skip', 2, source);
      result.skips.push({ reason: e.reason, detail: e.detail });
      output(result, opts, projectsRootTilde);
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  const transcriptsFound = inputInfo.files.length;
  const source = {
    kind: inputInfo.kind,
    path: tildify(inputInfo.dir),
    resolved_by: resolvedBy,
    transcripts_found: transcriptsFound,
  };

  const agents = [];
  const skips = [];
  let unidentifiedCount = 0;
  let parseErrorsTotal = 0;

  for (const file of inputInfo.files) {
    let ident;
    try {
      ident = identifyTranscript(file, allowedAdapters);
    } catch (e) {
      if (e instanceof SkipSignal) {
        const result = emptyResult('skip', 2, { ...source });
        result.skips.push({ reason: e.reason, detail: e.detail });
        output(result, opts, projectsRootTilde);
        process.exitCode = 2;
        return;
      }
      throw e;
    }
    if (ident.unidentified) {
      unidentifiedCount += 1;
      skips.push({ reason: ident.reason, detail: ident.detail });
      continue;
    }
    if (ident.nonTarget) continue;

    let agent;
    try {
      agent = judgeAgent({
        transcriptFile: file,
        agentType: ident.agentType,
        adapter: ident.adapter,
        maxCommandChars: opts.maxCommandChars,
      });
    } catch (e) {
      if (e instanceof SkipSignal) {
        const result = emptyResult('skip', 2, { ...source });
        result.skips.push({ reason: e.reason, detail: e.detail });
        output(result, opts, projectsRootTilde);
        process.exitCode = 2;
        return;
      }
      throw e;
    }
    agents.push(agent);
    parseErrorsTotal += agent.parse_errors;
    if (agent.verdict === 'skip') {
      skips.push({ reason: agent.skip_reason, detail: agent._skipMessage });
    }
  }

  // §1.5: 0 targets is only reported as its own reason when we're not
  // already explaining the gap via unidentified files.
  if (agents.length === 0 && unidentifiedCount === 0) {
    skips.push({ reason: 'no_target_agents', detail: SKIP_MESSAGES.no_target_agents({ n: transcriptsFound }) });
  }

  const totals = {
    targets: agents.length,
    pass: agents.filter((a) => a.verdict === 'pass').length,
    fail: agents.filter((a) => a.verdict === 'fail').length,
    skip: agents.filter((a) => a.verdict === 'skip').length,
    unidentified: unidentifiedCount,
    parse_errors: parseErrorsTotal,
  };

  let verdict;
  if (totals.fail > 0) verdict = 'fail';
  else if (totals.targets === 0 || totals.skip > 0 || totals.unidentified > 0) verdict = 'skip';
  else verdict = 'pass';
  const exitCode = { fail: 1, skip: 2, pass: 0 }[verdict];

  const result = {
    schema_version: 1,
    verdict,
    exit_code: exitCode,
    checked_at: new Date().toISOString(),
    source,
    totals,
    agents,
    skips,
  };

  output(result, opts, projectsRootTilde);
  process.exitCode = exitCode;
}

try {
  main();
} catch (e) {
  // §4: unexpected exception — one line to stderr, no stack, exit 2 (SKIP).
  process.stderr.write(`Unexpected error: ${e?.message ?? String(e)}\n`);
  process.exitCode = 2;
}
