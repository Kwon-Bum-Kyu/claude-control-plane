#!/usr/bin/env node
// Checks how diff.mjs reports a capture.mjs run that failed or left no result
// file. A copy of diff.mjs runs inside a temporary root next to a fake
// capture.mjs and an empty baseline, so no real capture is involved.
//
// Usage: node tests/companion/golden/diff-capture-failure-test.mjs

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const FAKE_CAPTURE = `
import { writeFileSync } from 'node:fs';
process.stdout.write('fake-capture-stdout-marker\\n');
process.stderr.write('fake-capture-stderr-marker\\n');
if (process.env.FAKE_CAPTURE_WRITE === '1') {
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], '{"scenarios":[]}');
}
process.exitCode = Number(process.env.FAKE_CAPTURE_EXIT);
`;

const root = mkdtempSync(join(tmpdir(), 'ccp-diff-capture-failure-'));
const golden = join(root, 'tests', 'companion', 'golden');
mkdirSync(join(golden, 'baseline'), { recursive: true });
copyFileSync(join(HERE, 'diff.mjs'), join(golden, 'diff.mjs'));
writeFileSync(join(golden, 'baseline', 'companion-baseline.json'), '{"scenarios":[]}');
writeFileSync(join(golden, 'capture.mjs'), FAKE_CAPTURE);

function runDiff(exit, write) {
  const r = spawnSync(process.execPath, [join(golden, 'diff.mjs'), '--cli', 'all'], {
    encoding: 'utf8',
    env: { ...process.env, FAKE_CAPTURE_EXIT: String(exit), FAKE_CAPTURE_WRITE: write ? '1' : '0' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (ok) passed += 1;
  else { failed += 1; console.log(`  ${detail}`); }
}
const markers = (o) => o.includes('fake-capture-stdout-marker') && o.includes('fake-capture-stderr-marker');

try {
  const a = runDiff(3, false);
  check('capture exit 3 without result file exits 2 and reports status and output',
    a.status === 2 && a.out.includes('exit status 3') && markers(a.out) && !a.out.includes('Node.js v'), a.out);
  const b = runDiff(1, false);
  check('capture exit 1 without result file exits 2 and reports missing file',
    b.status === 2 && b.out.includes('exit status 1') && b.out.includes('missing') && markers(b.out) && !b.out.includes('Node.js v'), b.out);
  const c = runDiff(0, true);
  check('capture exit 0 with result file still compares normally',
    c.status === 0 && c.out.includes('checked=0 diff=0'), c.out);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\nResult: ${passed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
