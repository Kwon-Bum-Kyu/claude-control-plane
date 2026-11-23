// Variant a: roles onto built-in runners + raw args. No way to add a runner.
import { buildBuiltin, BUILTIN_RUNNERS } from '../shared/builtin.mjs';

// image / image-quick need a runner CCP does not know; variant a cannot add one.
export const unsupported = {
  image: 'runners are fixed to codex/antigravity/claude; "args" cannot turn them into imagegen-cli',
  'image-default-size': 'same: no way to declare a new runner, so no imagegen-cli command',
};

// Flatten a role into single-target specs. Returns { specs } or { error }.
function expand(config, name, overrides, seen = []) {
  const role = config.roles?.[name];
  if (!role || typeof role !== 'object') return { error: `role "${name}" is not defined` };
  if (seen.includes(name)) return { error: `role "${name}" refers to itself via targets` };
  if (Array.isArray(role.targets)) {
    const specs = [];
    for (const t of role.targets) {
      const sub = typeof t === 'string'
        ? expand(config, t, overrides, [...seen, name])
        : { specs: [{ ...t, ...overrides, _role: name }] };
      if (sub.error) return { error: `role "${name}": ${sub.error}` };
      specs.push(...sub.specs);
    }
    return { specs };
  }
  if (!role.runner) return { error: `role "${name}" has neither "runner" nor "targets"` };
  return { specs: [{ ...role, ...overrides, _role: name }] };
}

export function resolve({ config, role, task, overrides = {} }) {
  const { specs, error } = expand(config, role, overrides);
  if (error) return { ok: false, error: { message: error } };
  const commands = [];
  for (const s of specs) {
    if (!BUILTIN_RUNNERS.includes(s.runner)) {
      return { ok: false, error: { message: `role "${s._role}": unknown runner "${s.runner}" (built-in: ${BUILTIN_RUNNERS.join(', ')})` } };
    }
    try {
      const { bin, argv } = buildBuiltin(s.runner, { task, model: s.model, effort: s.effort, sandbox: s.sandbox, args: s.args });
      commands.push({ bin, argv, timeout_ms: s.timeout_ms ?? null });
    } catch (e) {
      return { ok: false, error: { message: `role "${s._role}": ${e.message}` } };
    }
  }
  return { ok: true, commands };
}
