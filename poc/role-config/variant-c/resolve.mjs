// 안 c: 내장 러너 + 사용자 러너 모듈. 모듈은 { bin, argv({ task, options, jobDir }) } 를 export 한다.
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBuiltin, BUILTIN_RUNNERS } from '../shared/builtin.mjs';

export async function resolve({ config, configDir, role, task, overrides = {}, jobDir }) {
  try {
    const spec = config.roles?.[role];
    if (!spec || typeof spec !== 'object') throw new Error('is not defined');
    if (spec.targets && (!Array.isArray(spec.targets) || spec.targets.length === 0)) throw new Error('targets must be a non-empty array');
    return { ok: true, commands: await Promise.all((spec.targets ?? [spec]).map((t) => single({ ...t, ...overrides }))) };
  } catch (err) {
    return { ok: false, error: { message: `role "${role}": ${err.message}` } };
  }

  async function single({ runner, model, effort, sandbox, timeout_ms, args, ...options }) {
    if (typeof runner !== 'string') throw new Error('has no runner and no targets');
    if (BUILTIN_RUNNERS.includes(runner)) return { ...buildBuiltin(runner, { task, model, effort, sandbox, args }), timeout_ms };
    const file = config.runners?.[runner];
    if (!file) throw new Error(`runner "${runner}" is neither built-in nor defined in "runners"`);
    const mod = await import(pathToFileURL(resolvePath(configDir, file)).href);
    if (typeof mod.bin !== 'string' || typeof mod.argv !== 'function') throw new Error(`runner module "${file}" must export bin and argv()`);
    return { bin: mod.bin, argv: [...mod.argv({ task, options: { model, ...options }, jobDir }), ...(args || [])], timeout_ms };
  }
}
