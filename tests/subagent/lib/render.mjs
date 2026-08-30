// CCP rescue subagent isolation check — output/wording layer.
//
// This module holds every string constant and human-facing rendering
// function used by tests/subagent/rescue-isolation-test.mjs: the --help
// text, the SKIP message catalog (verbatim from 01_error_messages.md §2),
// the markdown report renderer, and small text-formatting helpers (home-dir
// tildification, codepoint-safe truncation, short transcript ids).
//
// Judgment logic (what counts as a violation, what a SKIP reason is) lives
// in the engine, not here. This file only turns already-decided data into
// text. Self-contained: no imports beyond Node built-ins.

import { homedir } from 'node:os';
import { basename } from 'node:path';

const HOME = homedir();

// ---------------------------------------------------------------------------
// Path / text formatting helpers
// ---------------------------------------------------------------------------

function tildify(p) {
  if (typeof p !== 'string' || !HOME) return p;
  return p === HOME || p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;
}

function tildifyAll(s) {
  if (typeof s !== 'string' || !HOME) return s;
  return s.split(HOME).join('~');
}

// Codepoint-safe truncation (avoids splitting UTF-16 surrogate pairs, §1.6).
function truncateCodepoints(s, maxChars) {
  if (maxChars <= 0) return { text: s, truncated: false };
  const chars = Array.from(s);
  if (chars.length <= maxChars) return { text: s, truncated: false };
  return { text: chars.slice(0, maxChars).join('') + '…', truncated: true };
}

// `transcript` field / display form: agent-<first 8 chars of id>….jsonl (§1.4, §3.1).
function shortTranscript(filePath) {
  const base = basename(filePath);
  const m = /^agent-([0-9a-fA-F]+)\.jsonl$/.exec(base);
  if (!m) return base;
  const id = m[1];
  const shortId = id.length > 8 ? id.slice(0, 8) + '…' : id;
  return `agent-${shortId}.jsonl`;
}

function shortAgentId(transcriptField) {
  return transcriptField.replace(/\.jsonl$/, '');
}

// Best-effort human-readable hint for a non-Bash tool_use, used only in the
// markdown report (never emitted in --json — stripped by the engine's
// jsonReplacer, which drops every underscore-prefixed key).
function nonBashDisplayHint(block) {
  const candidates = ['file_path', 'path', 'pattern', 'command', 'query', 'url'];
  for (const key of candidates) {
    const val = block?.input?.[key];
    if (typeof val === 'string' && val.length > 0) {
      return `${block.name}("${tildifyAll(val)}")`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// SKIP message catalog — verbatim from 01_error_messages.md §2 (message col).
// ---------------------------------------------------------------------------

const SKIP_MESSAGES = {
  path_not_found: (ctx) => `No such file or directory: ${ctx.path}`,
  unsupported_input: (ctx) => `${ctx.path} is a file, but not an agent-*.jsonl transcript -- this check reads .jsonl transcripts only.`,
  missing_subagents_dir: (ctx) => `${ctx.path} has no subagents/ directory -- it doesn't look like a Claude Code session directory.`,
  no_subagent_transcripts: () => `subagents/ exists but contains no agent-*.jsonl files -- no subagent was ever dispatched in this session.`,
  no_target_agents: (ctx) => `Found ${ctx.n} subagent transcript(s), but none is ccp:codex-rescue or ccp:antigravity-rescue.`,
  missing_meta: (ctx) => `${ctx.transcript} has no matching .meta.json -- cannot tell which agent produced it.`,
  missing_agent_type: (ctx) => `${ctx.transcript}'s .meta.json has no agentType field.`,
  meta_parse_error: (ctx) => `${ctx.transcript}'s .meta.json is not valid JSON.`,
  transcript_parse_error: (ctx) => `One or more lines in ${ctx.transcript} could not be parsed -- this agent's evidence is incomplete.`,
  structure_mismatch: (ctx) => `${ctx.transcript}'s records don't match the expected Claude Code shape (message.content is not an array).`,
  no_bash_tool_use: (ctx) => `${ctx.transcript} has zero Bash tool calls -- the subagent may have aborted before it called its companion.`,
  read_error: (ctx) => `Could not read ${ctx.path} (${ctx.errno}).`,
  project_dir_not_found: (ctx) => `--latest found no project directory for this working directory under ${ctx.projectsRoot}.`,
  internal_error: () => `An unexpected error occurred while checking this transcript.`,
};

const SHORT_REASON = {
  path_not_found: 'session directory not found',
  unsupported_input: 'input path is not a valid transcript',
  missing_subagents_dir: 'session directory not found',
  no_subagent_transcripts: 'no subagent was ever dispatched in this session',
  no_target_agents: 'no ccp:codex-rescue / ccp:antigravity-rescue transcripts in this session',
  missing_meta: 'a subagent transcript has no matching .meta.json',
  missing_agent_type: "a subagent transcript's .meta.json has no agentType field",
  meta_parse_error: "a subagent transcript's .meta.json is not valid JSON",
  transcript_parse_error: 'a transcript could not be fully parsed',
  structure_mismatch: 'transcript layout no longer matches what this check expects',
  no_bash_tool_use: 'a target subagent recorded zero Bash tool calls',
  read_error: 'could not read a required file',
  project_dir_not_found: 'no project directory found under --projects-root for this working directory',
  internal_error: 'an unexpected error occurred',
};

// ---------------------------------------------------------------------------
// --help / usage text
// ---------------------------------------------------------------------------

const HELP_TEXT = `Usage:
  node tests/subagent/rescue-isolation-test.mjs <path> [options]
  node tests/subagent/rescue-isolation-test.mjs --latest [--projects-root <dir>] [options]

Checks that a dispatched rescue subagent (ccp:codex-rescue, ccp:antigravity-rescue)
recorded exactly one Bash tool call in its own transcript, and that the command
was its companion \`rescue\` invocation -- no other Bash command. This is an
exit-side check: it reads the subagent's own transcript, not the main
conversation, so it can catch a subagent that reads raw files into its own
context and only forwards an interpretation.

Arguments:
  <path>                    Session directory, \`subagents/\` directory, or a
                             single \`agent-*.jsonl\` transcript file. Required
                             unless --latest is given.

Options:
  --latest                  Auto-discover the newest session for the current
                             project instead of taking <path>. Opt-in only:
                             results are not reproducible across runs unless
                             a path is pinned.
  --projects-root <dir>     Root to search under with --latest.
                             Default: ~/.claude/projects
  --agent-type <id>         Restrict the check to this agentType. Repeatable.
                             Default: ccp:codex-rescue, ccp:antigravity-rescue
                             A value that is not a rescue agentType exits 64
                             (usage error) instead of silently checking
                             nothing. This option narrows what is checked, so
                             record the value you used next to the verdict.
  --json                    Print one JSON object instead of the markdown
                             report. Suppresses all human-readable output;
                             diagnostics go to stderr.
  --max-command-chars <n>   Truncate command previews in FAIL output to this
                             length. 0 = no truncation. Default: 160
  --help                    Show this message and exit 0.

Exit codes:
  0   PASS  -- every target subagent held the single-Bash contract.
  1   FAIL  -- at least one target subagent violated it.
  2   SKIP  -- could not verify anything (no target found, unreadable
              transcript, or an unrecognized storage layout).
  64  Usage error -- bad arguments or missing <path>.

Why SKIP exists:
  This check only proves a violation when it finds one. When it cannot read
  or find the evidence, staying silent would look exactly like a real pass --
  which is the blind spot this check exists to close. SKIP means
  "unverified," never "compliant." Do not report a SKIP result as a passing
  check in CI badges, PR checklists, or QA sign-off.

This check only runs locally: subagent transcripts live in Claude Code's
local session storage, not in this repository, so it cannot run in CI.
Run it after a session that dispatched a rescue command. See tests/README.md.
`;

function printUsageError(message) {
  process.stderr.write(
    'Usage:\n' +
      '  node tests/subagent/rescue-isolation-test.mjs <path> [options]\n' +
      '  node tests/subagent/rescue-isolation-test.mjs --latest [--projects-root <dir>] [options]\n\n' +
      `${message}\n` +
      'Run --help for the full option list.\n'
  );
}

// ---------------------------------------------------------------------------
// Markdown report rendering
// ---------------------------------------------------------------------------

function humanSourceLine(source, projectsRootTilde) {
  if (source.kind === 'unresolved') {
    return `source: unresolved (${source.path ?? 'n/a'})`;
  }
  const label = { session_dir: 'session dir', subagents_dir: 'subagents dir', transcript_file: 'transcript file' }[source.kind] ?? source.kind;
  let display = source.path;
  let redacted = false;
  if (display && projectsRootTilde && display.startsWith(projectsRootTilde + '/')) {
    const rest = display.slice(projectsRootTilde.length + 1).split('/');
    const shown = rest.length >= 2 ? [projectsRootTilde, '<project>', '<session>'] : [projectsRootTilde, '<project>'];
    display = shown.join('/');
    redacted = true;
  }
  return `source: ${label} (${display})${redacted ? ' [redacted]' : ''}`;
}

function renderViolationLine(v, agent) {
  const text = v.tool_name !== 'Bash' ? (v._displayHint ?? `${v.tool_name} call (no command text)`) : (v.command_preview ?? '');
  const annotation =
    v.kind === 'unexpected_invocation' ? ' (missing "node" prefix)' : v.kind === 'adapter_mismatch' ? ` (expected ${agent.adapter})` : '';
  return `     [${v.kind}] ${text}${annotation}`;
}

function renderAgentLines(agent) {
  const shortId = shortAgentId(agent.transcript);
  const lines = [];
  if (agent.verdict === 'pass') {
    lines.push(`- ✅ ${agent.agent_type} (${shortId}) — Bash ${agent.bash_tool_use_count}/${agent.bash_tool_use_count} companion rescue`);
  } else if (agent.verdict === 'fail') {
    const nonCompanion = agent.violations.filter((v) => v.tool_name === 'Bash').length;
    lines.push(`- ❌ ${agent.agent_type} (${shortId}) — Bash ${agent.bash_tool_use_count} (${nonCompanion} non-companion)`);
    for (const v of agent.violations) lines.push(renderViolationLine(v, agent));
  } else {
    lines.push(`- ⚠️ ${agent.agent_type} (${shortId}) — SKIP: ${agent._skipMessage ?? SKIP_MESSAGES[agent.skip_reason]?.({ transcript: agent.transcript }) ?? agent.skip_reason}`);
  }
  return lines;
}

function shortSkipReason(result) {
  if (result.skips.length > 0) return SHORT_REASON[result.skips[0].reason] ?? result.skips[0].reason;
  return 'unverified';
}

function renderVerdictLine(result) {
  if (result.verdict === 'pass') {
    const n = result.totals.targets;
    return `**Verdict: ✅ PASS (${n}/${n} agents held the single-Bash contract)**`;
  }
  if (result.verdict === 'fail') {
    return `**Verdict: ❌ FAIL (${result.totals.fail} agent(s) violated the single-Bash contract)**`;
  }
  const reason = shortSkipReason(result);
  return `**Verdict: ⚠️ SKIP -- not verified (${reason})**\n(this check did not confirm or deny the single-Bash contract for this session)`;
}

function renderHuman(result, projectsRootTilde) {
  const lines = [];
  lines.push('# rescue subagent isolation check');
  lines.push('');
  lines.push(humanSourceLine(result.source, projectsRootTilde));
  lines.push(`transcripts: ${result.totals.targets} target / ${result.totals.unidentified} unidentified`);
  lines.push('');
  for (const agent of result.agents) lines.push(...renderAgentLines(agent));
  lines.push('');
  lines.push(`## Result: ${result.totals.pass} PASS / ${result.totals.fail} FAIL / ${result.totals.skip} SKIP`);
  lines.push(renderVerdictLine(result));
  return lines.join('\n');
}

export {
  HELP_TEXT,
  SKIP_MESSAGES,
  SHORT_REASON,
  tildify,
  tildifyAll,
  truncateCodepoints,
  shortTranscript,
  nonBashDisplayHint,
  printUsageError,
  humanSourceLine,
  renderAgentLines,
  renderVerdictLine,
  renderHuman,
};
