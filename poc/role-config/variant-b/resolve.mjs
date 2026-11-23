// 변형 b: 내장 러너 + 선언형 커스텀 러너(runners 의 argv 템플릿).
// 템플릿: 문자열 속 {key} 는 값으로 치환, 값이 없으면 오류. 배열 항목은 선택 그룹이며
// 안의 {key} 가 하나라도 비면 그룹 전체가 빠진다.
import { buildBuiltin, BUILTIN_RUNNERS } from '../shared/builtin.mjs';

const fail = (message) => ({ ok: false, error: { message } });
const MISSING = Symbol('missing');

function render(item, vars) {
  if (Array.isArray(item)) {
    const out = item.flatMap((x) => render(x, vars));
    return out.includes(MISSING) ? [] : out;
  }
  let missing = false;
  const s = item.replace(/\{(\w+)\}/g, (_, k) => {
    if (vars[k] === undefined || vars[k] === null) { missing = true; return ''; }
    return String(vars[k]);
  });
  return [missing ? MISSING : s];
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
    const argv = def.args.flatMap((x) => render(x, vars));
    const bad = argv.indexOf(MISSING);
    if (bad !== -1) return fail(`role "${name}": runner "${runner}" template has a required placeholder with no value`);
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
