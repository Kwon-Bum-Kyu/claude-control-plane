#!/usr/bin/env node
/**
 * Static check of the two rescue subagent definitions.
 *
 * Verifies that each definition carries the Bash tool-call parameter block
 * (timeout value, foreground --timeout-ms rule, moved-to-background handling),
 * that both blocks are byte-identical, that the allowed command pattern
 * includes [--timeout-ms N], and that the tool whitelist stays Bash-only.
 * Every check also has a negative twin: a mutated copy of the definition must
 * make exactly that check fail, so no check is vacuous.
 *
 * Usage:  node tests/agents/rescue-timeout-instructions-test.mjs
 * Exit:   0 when there are no failures, 1 otherwise (unreadable files throw).
 *
 * This proves the wording is present only; it does not prove that a model
 * follows it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = {
  codex: 'plugins/ccp/agents/codex-rescue.md',
  antigravity: 'plugins/ccp/agents/antigravity-rescue.md',
};
const HEADING = '### Bash Tool Call Parameters';
const TOKENS = {
  timeoutParam: '`timeout: 600000`',
  unconditional: 'foreground and background calls alike',
  fgFlag: '`--timeout-ms 540000`',
  userValue: "pass the user's value unchanged",
  noBgFlag: 'Never add `--timeout-ms` to a `--background` call',
  flagPlace: 'immediately after `rescue`, before every other argument',
  movedNotice: 'moved to the background',
  noRerun: 'Do not run the companion again',
};
const PATTERN_FLAG = '[--timeout-ms N]';
const TOOLS_LINE = 'tools: ["Bash"]';

/** From the HEADING line up to the next heading of level 1-3; null unless HEADING occurs exactly once. */
function extractBlock(text) {
  const lines = text.split('\n');
  const starts = lines.reduce((acc, l, i) => (l === HEADING ? [...acc, i] : acc), []);
  if (starts.length !== 1) return null;
  const rest = lines.slice(starts[0] + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  const body = end === -1 ? rest : rest.slice(0, end);
  return [HEADING, ...body].join('\n').trimEnd();
}

/** All 11 checks for one definition file, passes included. */
function checkDefinition(text, cli) {
  const block = extractBlock(text);
  const results = [{
    name: 'heading',
    ok: block !== null,
    detail: `"${HEADING}" must appear exactly once`,
  }];
  for (const [key, token] of Object.entries(TOKENS)) {
    results.push({
      name: `token:${key}`,
      ok: block !== null && block.includes(token),
      detail: `block must contain ${token}`,
    });
  }
  const re = new RegExp(`^node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/scripts/${cli}-companion\\.mjs" rescue `);
  const patternLines = text.split('\n').filter((l) => re.test(l));
  results.push({
    name: 'pattern',
    ok: patternLines.length === 1 && patternLines[0].includes(PATTERN_FLAG),
    detail: `exactly one ${cli} pattern line containing ${PATTERN_FLAG} (found ${patternLines.length})`,
  });
  results.push({
    name: 'tools',
    ok: text.split('\n').includes(TOOLS_LINE),
    detail: `line ${TOOLS_LINE} must be present`,
  });
  return results;
}

/** Check name -> body mutation that must make that check fail. */
const MUTATIONS = {
  heading: (t) => `${t}\n${HEADING}\n`,
  ...Object.fromEntries(
    Object.keys(TOKENS).map((k) => [`token:${k}`, (t) => t.replaceAll(TOKENS[k], '')]),
  ),
  pattern: (t) => t.replaceAll(PATTERN_FLAG, ''),
  tools: (t) => t.replace(TOOLS_LINE, 'tools: ["Bash", "Read"]'),
};

let pass = 0;
let fail = 0;
function report(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`); }
}

const texts = Object.fromEntries(
  Object.entries(FILES).map(([cli, p]) => [cli, readFileSync(resolve(REPO_ROOT, p), 'utf8')]),
);

console.log('1. Positive checks');
for (const cli of Object.keys(FILES)) {
  for (const r of checkDefinition(texts[cli], cli)) report(`${cli}: ${r.name}`, r.ok, r.detail);
}
const blockCodex = extractBlock(texts.codex);
const blockAgy = extractBlock(texts.antigravity);
report('blocks identical across files', blockCodex !== null && blockCodex === blockAgy,
  'the two Bash Tool Call Parameters blocks differ');

console.log('\n2. Negative checks (mutated copy must fail exactly the named check)');
for (const cli of Object.keys(FILES)) {
  for (const [name, mutate] of Object.entries(MUTATIONS)) {
    const hit = checkDefinition(mutate(texts[cli]), cli).find((r) => r.name === name);
    report(`${cli}: mutation fails ${name}`, hit !== undefined && !hit.ok, 'check still passed on the mutated text');
  }
}
{
  const mutated = texts.codex.replace(TOKENS.noRerun, `${TOKENS.noRerun} `);
  const a = extractBlock(mutated);
  const b = extractBlock(texts.antigravity);
  report('mutation breaks block equality', a !== b, 'blocks still equal after the mutation');
}

console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
