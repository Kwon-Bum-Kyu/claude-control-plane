#!/usr/bin/env node
// 역할 설정 구조 PoC 1단계(표현력): 시나리오 × 안을 전부 해석해 비교표를 출력한다.
// 어떤 CLI 도 실행하지 않는다. 각 안의 resolve() 가 "실행될 명령"을 돌려주면 기대값과 대조만 한다.
//
// 사용법: node poc/role-config/run.mjs [--variant a|b|c] [--verbose]
//
// 안 하나의 구성 (variant-<x>/):
//   ccp.json      사용자가 쓰는 설정 파일
//   user/         사용자가 쓰는 그 밖의 파일 (필요한 안만)
//   resolve.mjs   CCP 쪽에 들어갈 해석 코드. 아래를 export 한다.
//     resolve({ config, configDir, role, task, overrides, jobDir })
//       → { ok: true, commands: [{ bin, argv, timeout_ms }] } | { ok: false, error: { message } }
//     unsupported (선택) = { '<시나리오 id>': '<이 안의 방식으로는 표현할 수 없는 이유>' }

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const JOB_DIR = 'jobs/example-job';
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const only = argv.includes('--variant') ? argv[argv.indexOf('--variant') + 1] : null;

const { scenarios } = JSON.parse(readFileSync(join(ROOT, 'scenarios.json'), 'utf8'));

function countLines(path) {
  if (!existsSync(path)) return 0;
  if (statSync(path).isDirectory()) return readdirSync(path).reduce((n, f) => n + countLines(join(path, f)), 0);
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0).length;
}

// 기대값과 다른 점을 문자열 목록으로 돌려준다. 빈 목록이면 통과.
function check(scenario, result) {
  const { expect, input } = scenario;
  if (!result || typeof result.ok !== 'boolean') return ['resolve() did not return { ok }'];
  if (!expect.ok) {
    if (result.ok) return ['expected an error, got commands'];
    const message = String(result.error?.message || '');
    return expect.errorIncludes.filter((s) => !message.includes(s)).map((s) => `error message lacks "${s}": ${message}`);
  }
  if (!result.ok) return [`expected commands, got error: ${result.error?.message}`];
  const commands = result.commands || [];
  if (commands.length !== expect.commands.length) return [`expected ${expect.commands.length} command(s), got ${commands.length}`];
  const problems = [];
  const left = [...commands];
  for (const want of expect.commands) {
    const i = left.findIndex((c) => c.bin === want.bin);
    if (i === -1) { problems.push(`no command with bin "${want.bin}"`); continue; }
    const [got] = left.splice(i, 1);
    const has = (s) => got.argv.some((a) => String(a).includes(s.replace('<JOB_DIR>', JOB_DIR)));
    for (const s of want.argvIncludes || []) if (!has(s)) problems.push(`${want.bin}: argv lacks "${s}"`);
    for (const s of want.argvExcludes || []) if (has(s)) problems.push(`${want.bin}: argv must not contain "${s}"`);
    if (!has(input.task)) problems.push(`${want.bin}: argv lacks the task text`);
    if ('timeout_ms' in want && got.timeout_ms !== want.timeout_ms) problems.push(`${want.bin}: timeout_ms ${got.timeout_ms}, expected ${want.timeout_ms}`);
  }
  return problems;
}

const variants = readdirSync(ROOT)
  .filter((d) => d.startsWith('variant-') && existsSync(join(ROOT, d, 'resolve.mjs')) && existsSync(join(ROOT, d, 'ccp.json')))
  .filter((d) => !only || d === `variant-${only}`)
  .sort();
if (variants.length === 0) { console.error('no variant found'); process.exit(1); }

const table = {}; // table[scenarioId][variant] = { status, notes }
let failed = 0;
for (const v of variants) {
  const dir = join(ROOT, v);
  const config = JSON.parse(readFileSync(join(dir, 'ccp.json'), 'utf8'));
  const mod = await import(pathToFileURL(join(dir, 'resolve.mjs')).href);
  for (const sc of scenarios) {
    let cell;
    if (mod.unsupported?.[sc.id]) {
      cell = { status: '표현 불가', notes: [mod.unsupported[sc.id]] };
    } else {
      let result;
      let notes;
      try {
        result = await mod.resolve({ config, configDir: dir, role: sc.input.role, task: sc.input.task, overrides: sc.input.overrides || {}, jobDir: JOB_DIR });
        notes = check(sc, result);
      } catch (err) {
        notes = [`resolve() threw: ${err.message}`];
      }
      cell = { status: notes.length === 0 ? 'PASS' : 'FAIL', notes, result };
      if (notes.length > 0) failed++;
    }
    (table[sc.id] ||= {})[v] = cell;
  }
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)));
console.log(pad('시나리오', 22) + variants.map((v) => pad(v, 12)).join(''));
for (const sc of scenarios) console.log(pad(sc.id, 22) + variants.map((v) => pad(table[sc.id][v].status, 12)).join(''));
console.log('');
console.log(pad('사용자 작성 줄 수', 22) + variants.map((v) => pad(String(countLines(join(ROOT, v, 'ccp.json')) + countLines(join(ROOT, v, 'user'))), 12)).join(''));
console.log(pad('CCP 구현 줄 수', 22) + variants.map((v) => pad(String(readdirSync(join(ROOT, v)).filter((f) => f.endsWith('.mjs')).reduce((n, f) => n + countLines(join(ROOT, v, f)), 0)), 12)).join(''));

for (const sc of scenarios) {
  for (const v of variants) {
    const cell = table[sc.id][v];
    if (cell.status !== 'PASS') console.log(`\n[${cell.status}] ${v} / ${sc.id} (${sc.desc})\n  - ${cell.notes.join('\n  - ')}`);
    if (verbose && cell.result?.ok) for (const c of cell.result.commands) console.log(`\n${v} / ${sc.id}: ${c.bin} ${JSON.stringify(c.argv)}${c.timeout_ms ? ` (timeout_ms=${c.timeout_ms})` : ''}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
