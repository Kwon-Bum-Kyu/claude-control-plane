// PoC 공용: 내장 러너의 실행 명령을 만든다. 모든 안이 이 함수를 써서
// 내장 러너 부분의 차이를 없애고, 설정 구조의 차이만 비교되게 한다.
//
// codex·antigravity 는 플러그인의 실제 어댑터 buildArgs 를 그대로 호출한다.
// 아래 두 가지는 아직 확인되지 않은 가정이다.
//   - agy 가 `--model <slug>` 를 받는다 (현재 antigravity 어댑터는 모델 플래그를 선언하지 않는다)
//   - claude 는 `claude --model <model> -p <task>` 헤드리스 호출로 붙인다 (claude 어댑터는 아직 없다)

import codex from '../../../plugins/ccp/scripts/adapters/codex.mjs';
import antigravity from '../../../plugins/ccp/scripts/adapters/antigravity.mjs';

export const BUILTIN_RUNNERS = ['codex', 'antigravity', 'claude'];

/**
 * @param {string} runner  BUILTIN_RUNNERS 중 하나
 * @param {{ task: string, model?: string, effort?: string, sandbox?: string, args?: string[] }} opts
 * @returns {{ bin: string, argv: string[] }}
 */
export function buildBuiltin(runner, { task, model, effort, sandbox, args = [] }) {
  if (runner === 'codex') {
    const argv = codex.buildArgs({ prompt: task, model, effort, sandbox });
    argv.splice(argv.length - 1, 0, ...args); // 프롬프트가 마지막 요소로 남게 그 앞에 넣는다
    return { bin: codex.bin.fallback, argv };
  }
  if (effort) throw new Error(`runner "${runner}" does not support effort`);
  if (runner === 'antigravity') {
    const argv = antigravity.buildArgs({ prompt: task, sandbox: Boolean(sandbox) });
    // `-p <prompt>` 는 마지막 두 요소로 남아야 한다 (어댑터 주석 참고).
    argv.splice(argv.length - 2, 0, ...(model ? ['--model', model] : []), ...args);
    return { bin: antigravity.bin.fallback, argv };
  }
  if (runner === 'claude') {
    return { bin: 'claude', argv: [...(model ? ['--model', model] : []), ...args, '-p', task] };
  }
  throw new Error(`unknown built-in runner "${runner}"`);
}
