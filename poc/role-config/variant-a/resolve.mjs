// Variant a: roles onto built-in runners + raw args. No way to add a runner.
import { buildBuiltin } from '../shared/builtin.mjs';

// image / image-quick need a runner CCP does not know; variant a cannot add one.
export const unsupported = {
  image: 'runners are fixed to codex/antigravity/claude; "args" cannot turn them into imagegen-cli',
  'image-default-size': 'same: no way to declare a new runner, so no imagegen-cli command',
};

export function resolve({ config, role, task, overrides = {} }) {
  try {
    const spec = config.roles?.[role];
    if (!spec || typeof spec !== 'object') throw new Error('is not defined');
    if (!spec.runner && !Array.isArray(spec.targets)) throw new Error('has neither "runner" nor "targets"');
    const commands = (spec.targets ?? [spec]).map((t) => {
      const s = { ...t, ...overrides };
      return { ...buildBuiltin(s.runner, { ...s, task }), timeout_ms: s.timeout_ms };
    });
    return { ok: true, commands };
  } catch (e) {
    return { ok: false, error: { message: `role "${role}": ${e.message}` } };
  }
}
