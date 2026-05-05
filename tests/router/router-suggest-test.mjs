#!/usr/bin/env node
// CCP router-suggest hook regression — 19 scenarios.
//
// Coverage:
//   - Recommendation baseline (S1~S6): 6 scenarios
//   - Headless heuristic (S7~S9): 3 scenarios
//   - Hook ↔ router-agent split responsibility + envelope defense (S10~S19): 10 scenarios
//
// Pass threshold: ≥18/19 (≥95%).
// Run: node tests/router/router-suggest-test.mjs

import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const HOOK_PATH = resolve(REPO_ROOT, 'plugins', 'ccp', 'hooks', 'router-suggest.js');
const ROUTER_DECIDE = resolve(REPO_ROOT, 'plugins', 'ccp', 'scripts', 'lib', 'router-decide.mjs');
const AGENT_PATH = resolve(REPO_ROOT, 'plugins', 'ccp', 'agents', 'router.md');

// --- helpers ---------------------------------------------------------------

function makePluginRoot(autoRouting) {
  const dir = mkdtempSync(resolve(tmpdir(), 'ccp-b24-'));
  mkdirSync(resolve(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    resolve(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'ccp', version: '0.1.0', config: { auto_routing: autoRouting } })
  );
  return dir;
}

function runHook({ input, raw, env }) {
  const stdin = raw ? input : JSON.stringify(input);
  const result = spawnSync('node', [HOOK_PATH], {
    input: stdin,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...(env || {}) },
  });
  return result.stdout || '';
}

function runDecide({ args, env }) {
  const result = spawnSync('node', [ROUTER_DECIDE, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...(env || {}) },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

function readAgentFrontmatter() {
  return execFileSync('node', [
    '-e',
    `const fs=require('fs'); const txt=fs.readFileSync(${JSON.stringify(AGENT_PATH)},'utf8'); const m=txt.match(/^---\\n([\\s\\S]*?)\\n---/); process.stdout.write(m?m[1]:'')`,
  ], { encoding: 'utf8' });
}

// --- cases -----------------------------------------------------------------

const CASES = [
  // === Recommendation baseline (S1~S6) ===
  {
    id: 'S1-gemini-slash',
    label: 'baseline: explicit /gemini:rescue → ROUTER-001 emit, no META-WARN',
    run: () => runHook({ input: { prompt: '/gemini:rescue 이 디렉토리 전체 요약' } }),
    expect: (out) => /CCP-ROUTER-001/.test(out) && !/CCP-META-WARN/.test(out),
  },
  {
    id: 'S2-codex-slash',
    label: 'baseline: explicit /ccp:codex-rescue → ROUTER-001 emit, no META-WARN',
    run: () => runHook({ input: { prompt: '/ccp:codex-rescue 이 PR diff 검토 부탁' } }),
    expect: (out) => /CCP-ROUTER-001/.test(out) && /codex/.test(out) && !/CCP-META-WARN/.test(out),
  },
  {
    id: 'S3-claude-noop',
    label: 'baseline: decision claude → noop (empty output)',
    run: () => runHook({ input: { prompt: 'TODO 주석 추가해줘' } }),
    expect: (out) => out.trim() === '{}',
  },
  {
    id: 'S4-keyword-codex',
    label: 'baseline: keyword match codex → ROUTER-001 emit',
    run: () => runHook({ input: { prompt: '이 diff 검토해줘' } }),
    expect: (out) => /CCP-ROUTER-001/.test(out) && /codex/.test(out),
  },
  {
    id: 'S5-main-context-bind',
    label: 'baseline: main-context-bind keyword → claude noop',
    run: () => runHook({ input: { prompt: '방금 수정한 함수 다시 봐줘' } }),
    expect: (out) => out.trim() === '{}',
  },
  {
    id: 'S6-parse-fail',
    label: 'baseline: JSON parse failure → silent noop',
    run: () => runHook({ input: 'NOT_JSON_AT_ALL', raw: true }),
    expect: (out) => out.trim() === '{}',
  },

  // === Headless heuristic (S7~S9) ===
  {
    id: 'S7-headless-suspect-gemini',
    label: 'headless: no slash + headless keyword + gemini decision → inject META-WARN',
    run: () => runHook({ input: { prompt: '이 디렉토리 전체 요약 (headless 자동화 스크립트로 처리)' } }),
    expect: (out) => /CCP-ROUTER-001/.test(out) && /CCP-META-WARN/.test(out) && /gemini-companion\.mjs/.test(out),
  },
  {
    id: 'S8-headless-suspect-codex',
    label: 'headless: `claude -p` keyword + codex decision → META-WARN with codex-companion hint',
    run: () => runHook({ input: { prompt: 'claude -p 으로 코드 리뷰 자동화 돌리는 중인데 이 PR 검토' } }),
    expect: (out) => /CCP-ROUTER-001/.test(out) && /CCP-META-WARN/.test(out) && /codex-companion\.mjs/.test(out),
  },
  {
    id: 'S9-slash-overrides-headless',
    label: 'headless: explicit slash overrides headless keyword → no META-WARN',
    run: () => runHook({ input: { prompt: '/gemini:rescue headless 자동화로 이 디렉토리 요약' } }),
    expect: (out) => /CCP-ROUTER-001/.test(out) && !/CCP-META-WARN/.test(out),
  },

  // === Hook ↔ router-agent split + envelope defense (S10~S19) ===
  {
    id: 'S10-auto-routing-on-canonical-gemini',
    label: 'split: auto_routing on + canonical → hook noop (router agent dispatches), router-decide auto_routed=true',
    run: () => {
      const root = makePluginRoot(true);
      const canonicalEnv = { CLAUDE_PLUGIN_ROOT: root, CI: '', CLAUDE_CODE_NONINTERACTIVE: '', CLAUDE_CODE_ENTRYPOINT: '' };
      try {
        const hook = runHook({
          input: { prompt: '이 디렉토리 전체 요약' },
          env: canonicalEnv,
        });
        const decide = runDecide({
          args: ['--prompt', '이 디렉토리 전체 요약'],
          env: canonicalEnv,
        });
        return { hook, decide: decide.stdout };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (r) => r.hook.trim() === '{}' && /"auto_routed":true/.test(r.decide) && /"decision":"gemini"/.test(r.decide),
  },
  {
    id: 'S11-auto-routing-on-explicit-claude-noop',
    label: 'split: auto_routing on + decision=claude → router-decide auto_routed=false (or absent)',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', 'TODO 주석 추가해줘'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '', CLAUDE_CODE_NONINTERACTIVE: '' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (out) => /"auto_routed":false/.test(out) && /"decision":"claude"/.test(out),
  },
  {
    id: 'S12-headless-CI-blocks-auto',
    label: 'multi-signal: CI=true + auto_routing on → headless_confident=true, auto_routed=false',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', '이 PR 검토'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: 'true' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (out) => /"headless_confident":true/.test(out) && /"auto_routed":false/.test(out),
  },
  {
    id: 'S13-heuristic-fallback-recommendation-only',
    label: 'fallback: heuristic only (no env) + auto_routing on → hook recommendation only (no auto-delegation)',
    run: () => {
      const root = makePluginRoot(true);
      try {
        // hook 측면: env 없음 + canonical → noop (router agent 가 처리)
        const hook = runHook({
          input: { prompt: '이 디렉토리 전체 요약 (headless 자동화 스크립트)' },
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '', CLAUDE_CODE_NONINTERACTIVE: '' },
        });
        // router-decide 측면: heuristic 만 있고 환경 신호 없음 → headless_confident=false, auto_routed=true
        const decide = runDecide({
          args: ['--prompt', '이 디렉토리 전체 요약 (headless 자동화 스크립트)'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '', CLAUDE_CODE_NONINTERACTIVE: '' },
        });
        return { hook, decide: decide.stdout };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    // §4.4 보강안 (08_u7b §4.3): heuristic 매칭만으로는 자동 위임 차단 안 함 — env 확정 신호만 차단.
    // hook 은 canonical 로 판정 → noop (router agent 차례). decide 는 auto_routed=true 정상.
    expect: (r) => r.hook.trim() === '{}' && /"headless_confident":false/.test(r.decide) && /"auto_routed":true/.test(r.decide),
  },
  {
    id: 'S14-r1-summary-cap-300chars',
    label: 'envelope cap: router-decide summary ≤ 300 chars (main-context absorption cap)',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', 'review the entire codebase and summarize all the markdown files in this monorepo'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (out) => {
      try {
        const env = JSON.parse(out);
        return typeof env.summary === 'string' && env.summary.length <= 300;
      } catch { return false; }
    },
  },
  {
    id: 'S15-reason-code-enum-only',
    label: 'enum: reason_code is one of 12 enum values (free text 0)',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', '이 PR 검토'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (out) => {
      try {
        const env = JSON.parse(out);
        const ENUM = new Set([
          'AXIS_A_SLASH', 'AXIS_A_OPTION', 'AXIS_A_FALLBACK_CLAUDE',
          'AXIS_B_OVERSIZED', 'AXIS_B_MID_REVIEW', 'AXIS_B_TOO_SMALL',
          'AXIS_C_KW_GEMINI', 'AXIS_C_KW_CODEX', 'AXIS_C_KW_CLAUDE', 'AXIS_C_MAIN_CONTEXT_BIND',
          'AXIS_D_DEFAULT_CONSERVATIVE', 'OPT_OUT_NO_AUTO_ROUTE',
        ]);
        return ENUM.has(env?.details?.reason_code);
      } catch { return false; }
    },
  },
  {
    id: 'S16-false-pos-headless-keyword-in-task',
    label: 'heuristic false-pos: "review this automation script" task → not blocked when CI absent',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', '이 자동화 스크립트 코드 리뷰해줘'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '', CLAUDE_CODE_NONINTERACTIVE: '' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    // env 신호 없음 → headless_confident=false → auto_routed 가능 (§4.4 보강안)
    expect: (out) => /"headless_confident":false/.test(out) && /"auto_routed":true/.test(out),
  },
  {
    id: 'S17-claude-p-env-blocks-no-slash',
    label: 'heuristic false-neg: `claude -p` env (CLAUDE_CODE_NONINTERACTIVE) + no slash → auto_routed=false',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', '이 PR 검토'],
          env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_CODE_NONINTERACTIVE: '1' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (out) => /"headless_confident":true/.test(out) && /"auto_routed":false/.test(out),
  },
  {
    id: 'S18-router-agent-no-task-tool',
    label: 'agent frontmatter: router agent disallows Task tool and restricts tools to ["Bash"]',
    run: () => readAgentFrontmatter(),
    expect: (fm) => /tools:\s*\["Bash"\]/.test(fm) && /disallowedTools:\s*\["mcp__\*",\s*"Task"\]/.test(fm),
  },
  {
    id: 'S19-no-auto-route-opt-out',
    label: 'opt-out: --no-auto-route → auto_routed=false + reason_code=OPT_OUT_NO_AUTO_ROUTE',
    run: () => {
      const root = makePluginRoot(true);
      try {
        const decide = runDecide({
          args: ['--prompt', '이 디렉토리 전체 요약', '--auto-routing', 'on', '--no-auto-route'],
          env: { CLAUDE_PLUGIN_ROOT: root, CI: '' },
        });
        return decide.stdout;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    expect: (out) => /"auto_routed":false/.test(out) && /"reason_code":"OPT_OUT_NO_AUTO_ROUTE"/.test(out),
  },
];

// --- runner ----------------------------------------------------------------

let pass = 0;
let fail = 0;
const failures = [];

console.log('# router-suggest + router-decide regression\n');

for (const c of CASES) {
  let result;
  try {
    result = c.run();
  } catch (err) {
    result = `RUN_ERROR: ${err?.message ?? 'unknown'}`;
  }
  let ok = false;
  try {
    ok = c.expect(result);
  } catch {
    ok = false;
  }
  if (ok) {
    pass++;
    console.log(`- ✅ ${c.id} — ${c.label}`);
  } else {
    fail++;
    const dump = typeof result === 'string' ? result : JSON.stringify(result);
    failures.push({ id: c.id, label: c.label, output: dump });
    console.log(`- ❌ ${c.id} — ${c.label}`);
    console.log(`     output: ${String(dump).slice(0, 240)}`);
  }
}

const total = CASES.length;
const rate = (pass / total) * 100;
console.log(`\n## Result: ${pass}/${total} PASS (${rate.toFixed(1)}%)`);

// Pass threshold: ≥95% (≥18/19).
const passThreshold = Math.ceil(total * 0.95);
if (pass >= passThreshold) {
  console.log(`**Verdict: ✅ PASS (${pass}/${total} ≥ ${passThreshold}/${total} = 95%)**`);
  process.exit(0);
} else {
  console.log(`**Verdict: ❌ FAIL (${pass}/${total} < ${passThreshold}/${total} = 95%)**`);
  for (const f of failures) {
    console.log(`\n[${f.id}] ${f.label}\noutput: ${f.output}`);
  }
  process.exit(1);
}
