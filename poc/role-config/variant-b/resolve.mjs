// 변형 b: 내장 러너 + 선언형 커스텀 러너(runners 의 argv 템플릿).
// 템플릿: 문자열 속 {key} 는 값으로 치환, 값이 없으면 오류. 배열 항목은 선택 그룹이며
// 안의 {key} 가 하나라도 비면 그룹 전체가 빠진다.
import { buildBuiltin, BUILTIN_RUNNERS } from '../shared/builtin.mjs';

function render(item, vars, missing) {
  if (Array.isArray(item)) {
    const own = new Set();
    const out = item.flatMap((x) => render(x, vars, own));
    return own.size > 0 ? [] : out;
  }
  return [item.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? (missing.add(k), ''))];
}

/** 템플릿을 argv 로 펼친다. 필수 자리표시자 중 값이 없는 것의 이름을 missing 으로 돌려준다 (2단계도 사용). */
export function renderArgv(args, vars) {
  const missing = new Set();
  const argv = args.flatMap((x) => render(x, vars, missing));
  return { argv, missing: [...missing] };
}

function build(spec, { config, task, overrides, jobDir }) {
  const merged = { ...spec, ...overrides };
  const { runner, timeout_ms } = merged;
  if (typeof runner !== 'string') throw new Error('needs "runner" or "targets"');
  if (BUILTIN_RUNNERS.includes(runner)) return { ...buildBuiltin(runner, { ...merged, task }), timeout_ms };
  const def = config.runners?.[runner];
  if (!def) throw new Error(`runner "${runner}" is neither built-in nor declared in "runners"`);
  const { argv, missing } = renderArgv(def.args, { ...merged, task, job_dir: jobDir });
  if (missing.length > 0) throw new Error(`runner "${runner}" template has a required placeholder with no value: ${missing.map((k) => `{${k}}`).join(', ')}`);
  return { bin: def.bin, argv: [...argv, ...(merged.args || [])], timeout_ms };
}

export function resolve({ config, role, task, overrides = {}, jobDir }) {
  try {
    const spec = config.roles?.[role];
    if (!spec || typeof spec !== 'object') throw new Error('is not defined in ccp.json');
    if (spec.targets && !Array.isArray(spec.targets)) throw new Error('"targets" must be an array');
    return { ok: true, commands: (spec.targets ?? [spec]).map((t) => build(t, { config, task, overrides, jobDir })) };
  } catch (err) {
    return { ok: false, error: { message: `role "${role}": ${err.message}` } };
  }
}
