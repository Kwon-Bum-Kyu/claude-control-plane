// 변형 b: 내장 러너 + 선언형 커스텀 러너(runners 의 argv 템플릿).
// 템플릿: 문자열 속 {key} 는 값으로 치환, 값이 없으면 오류. 배열 항목은 선택 그룹이며
// 안의 {key} 가 하나라도 비면 그룹 전체가 빠진다.
import { buildBuiltin, BUILTIN_RUNNERS } from '../shared/builtin.mjs';

const fail = (message) => ({ ok: false, error: { message } });
// 선택 그룹(배열)은 안의 {key} 가 하나라도 비면 통째로 빠지고, 그 외 문자열의 빈 {key} 는 missing 에 모인다.
function render(item, vars, missing) {
  if (Array.isArray(item)) {
    const own = new Set();
    const out = item.flatMap((x) => render(x, vars, own));
    return own.size > 0 ? [] : out;
  }
  let bad = false;
  const s = item.replace(/\{(\w+)\}/g, (_, k) => {
    if (vars[k] === undefined || vars[k] === null) { missing.add(k); bad = true; return ''; }
    return String(vars[k]);
  });
  return bad ? [] : [s];
}

/** 템플릿을 argv 로 펼친다. 필수 자리표시자 중 값이 없는 것의 이름을 missing 으로 돌려준다 (2단계도 사용). */
export function renderArgv(args, vars) {
  const missing = new Set();
  const argv = args.flatMap((x) => render(x, vars, missing));
  return { argv, missing: [...missing] };
}

function build(spec, name, ctx) {
  if (typeof spec === 'string') spec = ctx.config.roles?.[spec];
  if (!spec || typeof spec !== 'object') return fail(`role "${name}": target is not a role name or object`);
  const merged = { ...spec, ...ctx.overrides };
  const { runner } = merged;
  if (typeof runner !== 'string') return fail(`role "${name}": needs "runner" or "targets"`);
  const timeout_ms = merged.timeout_ms ?? null;
  try {
    if (BUILTIN_RUNNERS.includes(runner)) {
      return { ok: true, command: { ...buildBuiltin(runner, { ...merged, task: ctx.task }), timeout_ms } };
    }
    const def = ctx.config.runners?.[runner];
    if (!def) return fail(`role "${name}": runner "${runner}" is neither built-in nor declared in "runners"`);
    const vars = { ...merged, task: ctx.task, job_dir: ctx.jobDir };
    const { argv, missing } = renderArgv(def.args, vars);
    if (missing.length > 0) return fail(`role "${name}": runner "${runner}" template has a required placeholder with no value: ${missing.map((k) => `{${k}}`).join(', ')}`);
    return { ok: true, command: { bin: def.bin, argv: [...argv, ...(merged.args || [])], timeout_ms } };
  } catch (err) {
    return fail(`role "${name}": ${err.message}`);
  }
}

export function resolve({ config, role, task, overrides = {}, jobDir }) {
  const spec = config.roles?.[role];
  if (!spec || typeof spec !== 'object') return fail(`role "${role}" is not defined in ccp.json`);
  const ctx = { config, task, overrides, jobDir };
  const specs = Array.isArray(spec.targets) ? spec.targets : [spec];
  if (spec.targets && !Array.isArray(spec.targets)) return fail(`role "${role}": "targets" must be an array`);
  const commands = [];
  for (const t of specs) {
    const r = build(t, role, ctx);
    if (!r.ok) return r;
    commands.push(r.command);
  }
  return { ok: true, commands };
}
