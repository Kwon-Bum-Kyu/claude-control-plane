/**
 * Argument parser - normalizes the codex-side option signature to the same structure as gemini-companion.
 * Example usage: parseArgs(['rescue', '--background', '--timeout-ms', '300000', '--', 'prompt'])
 *
 * @param {string[]} argv  process.argv.slice(2) format
 * @returns {{ command: string, flags: Record<string, string|boolean>, positional: string[] }}
 */
export function parseArgs(argv) {
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

/** kebab-case -> camelCase normalization (e.g. timeout-ms -> timeoutMs) */
function normalizeFlag(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

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
 * Argument builder for codex CLI invocation
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.cwd
 * @param {string} [opts.model]
 * @param {string} [opts.sandbox]   read-only | workspace-write | danger-full-access
 * @param {string} [opts.effort]    low | medium | high (config override path)
 * @param {boolean} [opts.skipGitRepoCheck]
 * @returns {string[]}
 */
export function buildCodexExecArgs(opts) {
  const args = ['exec', '--json'];
  if (opts.skipGitRepoCheck !== false) args.push('--skip-git-repo-check');
  if (opts.sandbox) args.push('-s', opts.sandbox);
  else args.push('-s', 'read-only');
  if (opts.cwd) args.push('-C', opts.cwd);
  if (opts.model) args.push('-m', opts.model);
  if (opts.effort) {
    args.push('-c', `model_reasoning_effort=${opts.effort}`);
  }
  if (typeof opts.prompt === 'string' && opts.prompt.length > 0) {
    args.push(opts.prompt);
  }
  return args;
}
