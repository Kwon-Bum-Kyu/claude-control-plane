// Portions adapted from openai/codex-plugin-cc (plugins/codex/scripts/lib/args.mjs)
// Upstream commit 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Licensed under the Apache License 2.0 — see LICENSES/codex-plugin-cc-Apache-2.0.txt
// Modified by CCP contributors: added --timeout-ms / --poll-interval-ms options;
// generalized the parser for multi-CLI use behind an adapter-declared arg style
// (`argStyle: 'dash-dash'`); added a second, independent `argStyle: 'task-flag'`
// parser (see parseTaskFlagArgs below) side by side with it for adapters using
// named-flag call conventions — the two are placed next to each other and
// selected, never merged into one parser.

/**
 * Dash-dash style argument parser (adapter `argStyle: 'dash-dash'` — a CLI
 * whose call convention marks the prompt with a `-- "<prompt>"` separator).
 * Example usage: parseDashDashArgs(['rescue', '--background', '--timeout-ms', '300000', '--', 'prompt'])
 *
 * @param {string[]} argv  process.argv.slice(2) format
 * @returns {{ command: string, flags: Record<string, string|boolean>, positional: string[] }}
 */
export function parseDashDashArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { command: '', flags: {}, positional: [] };
  }
  const command = argv[0];
  const rest = argv.slice(1);
  const flags = {};
  const positional = [];

  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i];
    if (tok === '--') {
      // All following tokens are positional
      positional.push(...rest.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        flags[normalizeFlag(tok.slice(2, eq))] = tok.slice(eq + 1);
      } else {
        const key = normalizeFlag(tok.slice(2));
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (tok.startsWith('-') && tok.length > 1) {
      const key = normalizeFlag(tok.slice(1));
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(tok);
    }
  }

  return { command, flags, positional };
}

/**
 * Task-flag style argument parser (adapter `argStyle: 'task-flag'` — a CLI
 * whose call convention uses a fixed set of named flags, some boolean, some
 * consuming the next token as their value, with everything else falling
 * through to the positional/prompt list). Unlike the dash-dash parser this
 * one is not purely generic: which flag names exist and what shape each
 * takes is CLI vocabulary, so it comes from `adapter.supports.flags`
 * rather than being inferred from `--flag value` / `--flag` shape alone —
 * core stays unaware of what any individual flag name means. (`flags` also
 * doubles as the doc/usage-generation list a dash-dash adapter would use it
 * for — one declaration, not two.)
 *
 * @param {{ supports: { flags: Record<string, {key:string, type:'bool'|'int'|'string'}> } }} adapter
 * @param {string[]} argv
 * @returns {{ command: string, flags: Record<string, string|number|boolean>, positional: string[] }}
 */
export function parseTaskFlagArgs(adapter, argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { command: '', flags: {}, positional: [] };
  }
  const command = argv[0];
  const rest = argv.slice(1);
  const spec = adapter.supports.flags || {};
  const flags = {};
  const positional = [];

  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i];
    if (tok === '--') {
      positional.push(...rest.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const entry = spec[tok.slice(2)];
      if (entry) {
        if (entry.type === 'bool') {
          flags[entry.key] = true;
        } else if (entry.type === 'int') {
          i += 1;
          flags[entry.key] = Number.parseInt(rest[i], 10);
        } else {
          i += 1;
          flags[entry.key] = rest[i];
        }
        continue;
      }
    }
    positional.push(tok);
  }

  return { command, flags, positional };
}

/** kebab-case -> camelCase normalization (e.g. timeout-ms -> timeoutMs) */
function normalizeFlag(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Exported alias — used by core/runtime.mjs to match a `--flag-name` string
 * (with leading dashes already stripped by the caller) against parsed.flags keys. */
export const normalizeFlagName = normalizeFlag;

/**
 * Extract an integer option (with default)
 * @param {Record<string, any>} flags
 * @param {string} key
 * @param {number} fallback
 * @param {{ min?: number, max?: number }} [bounds]
 */
export function pickInt(flags, key, fallback, bounds = {}) {
  const raw = flags[key];
  if (raw === undefined || raw === true) return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return fallback;
  if (bounds.min !== undefined && n < bounds.min) return bounds.min;
  if (bounds.max !== undefined && n > bounds.max) return bounds.max;
  return n;
}

/** Extract a string option */
export function pickString(flags, key, fallback = '') {
  const raw = flags[key];
  if (raw === undefined || raw === true) return fallback;
  return String(raw);
}

/** Extract a boolean option (accepts true/false/1/0) */
export function pickBool(flags, key, fallback = false) {
  const raw = flags[key];
  if (raw === undefined) return fallback;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return fallback;
}

/**
 * Select the right parser for an adapter's declared `argStyle` — the two
 * parsers are placed side by side in core and selected, never merged.
 * @param {{argStyle: string}} adapter
 * @param {string[]} argv
 */
export function parseArgsForAdapter(adapter, argv) {
  switch (adapter.argStyle) {
    case 'dash-dash':
      return parseDashDashArgs(argv);
    case 'task-flag':
      return parseTaskFlagArgs(adapter, argv);
    default:
      throw new Error(
        `core/args.mjs: unsupported argStyle "${adapter.argStyle}" for adapter "${adapter.id}"`
      );
  }
}
