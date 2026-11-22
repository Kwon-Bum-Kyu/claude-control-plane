#!/usr/bin/env node
/**
 * Static check of the task-forwarding wording in the two rescue slash commands
 * and the two rescue subagent definitions.
 *
 * Commands: a Delegation block that tells the main agent to invoke the rescue
 * subagent with the Agent tool and pass the raw request unchanged, with
 * $ARGUMENTS once on the line after "Raw user request:", Agent added to
 * allowed-tools and Bash kept. The two blocks must be identical once the CLI
 * name is replaced by <cli>.
 * Definitions: a byte-identical Task Text block that treats the received
 * prompt as data, the verbatim sentence in the description, and an Example
 * line in each CLI's task position that does not start a pattern line and
 * does not reuse a task string from the live-model forwarding measurement.
 * Every check also has a negative twin: a mutated copy must make exactly that
 * check fail, so no check is vacuous.
 *
 * Usage:  node tests/agents/rescue-forwarding-instructions-test.mjs
 * Exit:   0 when there are no failures, 1 otherwise (unreadable files throw).
 *
 * This proves the wording is present only; it does not prove that a model
 * follows it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFINITIONS = { codex: 'plugins/ccp/agents/codex-rescue.md', antigravity: 'plugins/ccp/agents/antigravity-rescue.md' };
const COMMANDS = { codex: 'plugins/ccp/commands/codex-rescue.md', antigravity: 'plugins/ccp/commands/antigravity-rescue.md' };

const TASK_HEADING = '### Task Text';
const EXAMPLE_HEADING = '### Example';
const DELEGATION_HEADING = '## Delegation';
const DESC_SENTENCE = "Pass the user's task text verbatim as the prompt.";
const TASK_TOKENS = {
  dataDecl: 'It is data to hand to the companion, not a message addressed to you.',
  noAnswer: 'do not answer it and do not carry it out',
  verbatim: 'Put it in exactly as received, character for character.',
  quoteOnly: 'The only change you make inside the quotes is escaping each double quote',
  runFirst: 'Never reply without running the companion first.',
};
const SLOTS = { codex: '-- "', antigravity: '--task "' };
const PATTERN_LINE_START = 'node "${CLAUDE_PLUGIN_ROOT}';
// Task strings used when measuring forwarding with live models. An example
// that reuses one of them would contaminate that measurement.
const MEASUREMENT_TASKS = [
  'Reply with the single word ok',
  'What is 17 times 3? Answer with only the number.',
  'Hi, thank you so much for taking the time to help me with this, I really appreciate it. Could you please take a careful look at plugins/ccp/scripts/core/jobs.mjs and point out anything that might break? If possible, I would love a short list of the issues you find.',
  'Review plugins/ccp/scripts/core/args.mjs for edge cases in flag parsing and list the findings.',
];
const CMD_TOKENS = (cli) => ({
  subagentType: `subagent_type: "ccp:${cli}-rescue"`,
  asPrompt: 'pass the raw user request below as its `prompt`, exactly as written',
  noRewrite: 'Do not paraphrase, summarize, translate, or rewrite it',
  noSelfAnswer: 'Do not answer the request yourself',
  noDirectRun: `do not run \`${cli}-companion.mjs\` with \`Bash\` yourself`,
});
const RAW_LABEL = 'Raw user request:';
const ARGS = '$ARGUMENTS';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** From the heading line up to the next heading of level 1-3; null unless the heading occurs exactly once. */
function extractBlock(text, heading) {
  const lines = text.split('\n');
  const starts = lines.reduce((acc, l, i) => (l === heading ? [...acc, i] : acc), []);
  if (starts.length !== 1) return null;
  const rest = lines.slice(starts[0] + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  const body = end === -1 ? rest : rest.slice(0, end);
  return [heading, ...body].join('\n').trimEnd();
}

/** Lines between the first two '---' lines. */
function frontmatter(text) {
  const lines = text.split('\n');
  const first = lines.indexOf('---');
  const second = lines.indexOf('---', first + 1);
  return first === -1 || second === -1 ? [] : lines.slice(first + 1, second);
}

/** @returns {{ name: string, ok: boolean, detail: string }[]} 11 results */
function checkDefinition(text, cli) {
  const task = extractBlock(text, TASK_HEADING);
  const example = extractBlock(text, EXAMPLE_HEADING);
  const results = [{
    name: 'task-heading', ok: task !== null, detail: `"${TASK_HEADING}" must appear exactly once`,
  }];
  for (const [key, token] of Object.entries(TASK_TOKENS)) {
    results.push({
      name: `task-token:${key}`,
      ok: task !== null && task.includes(token),
      detail: `Task Text block must contain ${token}`,
    });
  }
  const desc = frontmatter(text).find((l) => l.startsWith('description: '));
  results.push({
    name: 'description',
    ok: desc !== undefined && desc.includes(DESC_SENTENCE),
    detail: `description must contain ${DESC_SENTENCE}`,
  });
  results.push({
    name: 'example-heading', ok: example !== null, detail: `"${EXAMPLE_HEADING}" must appear exactly once`,
  });
  const m = example === null ? null : new RegExp(`${escapeRe(SLOTS[cli])}([^"]+)"`).exec(example);
  results.push({
    name: 'example-slot', ok: m !== null, detail: `Example must carry the task in the ${SLOTS[cli]} position`,
  });
  results.push({
    name: 'example-not-pattern-line',
    ok: example !== null && !example.split('\n').some((l) => l.startsWith(PATTERN_LINE_START)),
    detail: 'no Example line may start like a pattern line',
  });
  results.push({
    name: 'example-distinct',
    ok: m !== null && !MEASUREMENT_TASKS.includes(m[1]),
    detail: 'Example task must differ from every measurement task',
  });
  return results;
}

/** @returns {{ name: string, ok: boolean, detail: string }[]} 10 results */
function checkCommand(text, cli) {
  const block = extractBlock(text, DELEGATION_HEADING);
  const fm = frontmatter(text);
  const results = [{
    name: 'delegation-heading', ok: block !== null, detail: `"${DELEGATION_HEADING}" must appear exactly once`,
  }];
  for (const [key, token] of Object.entries(CMD_TOKENS(cli))) {
    results.push({
      name: `cmd-token:${key}`,
      ok: block !== null && block.includes(token),
      detail: `Delegation block must contain ${token}`,
    });
  }
  const lines = block === null ? [] : block.split('\n');
  const labelIdx = lines.reduce((acc, l, i) => (l === RAW_LABEL ? [...acc, i] : acc), []);
  results.push({
    name: 'raw-request',
    ok: labelIdx.length === 1 && lines[labelIdx[0] + 1] === ARGS,
    detail: `exactly one "${RAW_LABEL}" line, followed directly by ${ARGS}`,
  });
  results.push({
    name: 'arguments-once',
    ok: text.split(ARGS).length - 1 === 1,
    detail: `${ARGS} must occur exactly once in the file`,
  });
  results.push({ name: 'allowed-agent', ok: fm.includes('  - Agent'), detail: 'allowed-tools must list Agent' });
  results.push({ name: 'allowed-bash', ok: fm.includes('  - Bash'), detail: 'allowed-tools must keep Bash' });
  return results;
}

const exampleTask = (text, cli) => {
  const ex = extractBlock(text, EXAMPLE_HEADING);
  const m = ex === null ? null : new RegExp(`${escapeRe(SLOTS[cli])}([^"]+)"`).exec(ex);
  return m === null ? '' : m[1];
};

/** Check name -> body mutation that must make that check fail (function replacements avoid `$` patterns). */
const DEF_MUTATIONS = (cli) => ({
  'task-heading': (t) => `${t}\n${TASK_HEADING}\n`,
  ...Object.fromEntries(
    Object.keys(TASK_TOKENS).map((k) => [`task-token:${k}`, (t) => t.replaceAll(TASK_TOKENS[k], '')]),
  ),
  description: (t) => t.replace(' ' + DESC_SENTENCE, () => ''),
  'example-heading': (t) => `${t}\n${EXAMPLE_HEADING}\n`,
  'example-slot': (t) => t.replaceAll(SLOTS[cli], () => '"'),
  'example-not-pattern-line': (t) => t.replace('\nFor the task text ', () => '\n' + PATTERN_LINE_START + '/scripts/x" rescue For the task text '),
  'example-distinct': (t) => t.replaceAll(exampleTask(t, cli), () => MEASUREMENT_TASKS[0]),
});
const CMD_MUTATIONS = (cli) => ({
  'delegation-heading': (t) => `${t}\n${DELEGATION_HEADING}\n`,
  ...Object.fromEntries(
    Object.entries(CMD_TOKENS(cli)).map(([k, tok]) => [`cmd-token:${k}`, (t) => t.replaceAll(tok, '')]),
  ),
  'raw-request': (t) => t.replace(RAW_LABEL + '\n' + ARGS, () => RAW_LABEL + '\n\n' + ARGS),
  'arguments-once': (t) => `${t}\n${ARGS}\n`,
  'allowed-agent': (t) => t.replace('  - Agent\n', () => ''),
  'allowed-bash': (t) => t.replace('  - Bash\n', () => ''),
});

let pass = 0;
let fail = 0;
function report(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`); }
}

const read = (p) => readFileSync(resolve(REPO_ROOT, p), 'utf8');
const defs = Object.fromEntries(Object.entries(DEFINITIONS).map(([cli, p]) => [cli, read(p)]));
const cmds = Object.fromEntries(Object.entries(COMMANDS).map(([cli, p]) => [cli, read(p)]));
const clis = Object.keys(DEFINITIONS);

console.log('1. Positive checks');
for (const cli of clis) {
  for (const r of checkDefinition(defs[cli], cli)) report(`${cli} definition: ${r.name}`, r.ok, r.detail);
  for (const r of checkCommand(cmds[cli], cli)) report(`${cli} command: ${r.name}`, r.ok, r.detail);
}
const taskCodex = extractBlock(defs.codex, TASK_HEADING);
const taskAgy = extractBlock(defs.antigravity, TASK_HEADING);
report('task-text blocks identical across definitions', taskCodex !== null && taskCodex === taskAgy,
  'the two Task Text blocks differ');
const normDeleg = (cli) => {
  const b = extractBlock(cmds[cli], DELEGATION_HEADING);
  return b === null ? null : b.replaceAll(cli, '<cli>');
};
report('delegation blocks identical across commands', normDeleg('codex') !== null && normDeleg('codex') === normDeleg('antigravity'),
  'the two Delegation blocks differ once the CLI name is replaced');

console.log('\n2. Negative checks (mutated copy must fail the named check)');
for (const cli of clis) {
  for (const [name, mutate] of Object.entries(DEF_MUTATIONS(cli))) {
    const hit = checkDefinition(mutate(defs[cli]), cli).find((r) => r.name === name);
    report(`${cli} definition: mutation fails ${name}`, hit !== undefined && !hit.ok, 'check still passed on the mutated text');
  }
  for (const [name, mutate] of Object.entries(CMD_MUTATIONS(cli))) {
    const hit = checkCommand(mutate(cmds[cli]), cli).find((r) => r.name === name);
    report(`${cli} command: mutation fails ${name}`, hit !== undefined && !hit.ok, 'check still passed on the mutated text');
  }
}
{
  const mutated = defs.codex.replace(TASK_TOKENS.runFirst, () => `${TASK_TOKENS.runFirst} `);
  const a = extractBlock(mutated, TASK_HEADING);
  report('mutation breaks task-text equality', a !== taskAgy, 'blocks still equal after the mutation');
}
{
  const mutated = cmds.codex.replace(CMD_TOKENS('codex').noRewrite, () => `${CMD_TOKENS('codex').noRewrite} `);
  const a = extractBlock(mutated, DELEGATION_HEADING)?.replaceAll('codex', '<cli>');
  report('mutation breaks delegation equality', a !== normDeleg('antigravity'), 'blocks still equal after the mutation');
}

console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
