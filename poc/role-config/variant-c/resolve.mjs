// 안 c: 내장 러너 + 사용자 러너 모듈. 모듈은 { bin, argv({ task, options, jobDir }) } 를 export 한다.
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBuiltin, BUILTIN_RUNNERS } from '../shared/builtin.mjs';

export async function resolve({ config, configDir, role, task, overrides = {}, jobDir }) {
  try {
    return { ok: true, commands: await expand(config, configDir, role, task, overrides, jobDir, []) };
  } catch (err) {
    return { ok: false, error: { message: err.message } };
  }
}

// 역할 이름 → 명령 목록. 문제가 있으면 역할 이름을 넣은 Error 를 던지고 resolve() 가 잡는다.
async function expand(config, dir, role, task, overrides, jobDir, seen) {
  const spec = config.roles?.[role];
  if (!spec || typeof spec !== 'object') throw new Error(`role "${role}" is not defined`);
  if (seen.includes(role)) throw new Error(`role "${role}" refers to itself`);
  if (spec.targets) {
    if (!Array.isArray(spec.targets) || spec.targets.length === 0) throw new Error(`role "${role}": targets must be a non-empty array`);
    const lists = await Promise.all(spec.targets.map((t, i) => typeof t === 'string'
      ? expand(config, dir, t, task, overrides, jobDir, [...seen, role])
      : single(config, dir, `${role}.targets[${i}]`, t, task, overrides, jobDir).then((c) => [c])));
    return lists.flat();
  }
  return [await single(config, dir, role, spec, task, overrides, jobDir)];
}

async function single(config, dir, label, spec, task, overrides, jobDir) {
  const { runner, model, effort, sandbox, timeout_ms = null, args, ...options } = { ...spec, ...overrides };
  if (typeof runner !== 'string') throw new Error(`role "${label}" has no runner and no targets`);
  if (BUILTIN_RUNNERS.includes(runner)) {
    const cmd = buildBuiltin(runner, { task, model, effort, sandbox, args });
    return { ...cmd, timeout_ms };
  }
  const file = config.runners?.[runner];
  if (!file) throw new Error(`role "${label}": runner "${runner}" is neither built-in nor defined in "runners"`);
  let mod;
  try {
    mod = await import(pathToFileURL(resolvePath(dir, file)).href);
  } catch (err) {
    throw new Error(`role "${label}": runner module "${file}" for "${runner}" failed to load: ${err.message}`);
  }
  if (typeof mod.bin !== 'string' || typeof mod.argv !== 'function') throw new Error(`role "${label}": runner module "${file}" must export bin and argv()`);
  try {
    return { bin: mod.bin, argv: [...mod.argv({ task, options: { model, ...options }, jobDir }), ...(args || [])], timeout_ms };
  } catch (err) {
    throw new Error(`role "${label}": runner "${runner}" argv() threw: ${err.message}`);
  }
}
