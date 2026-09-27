// CCP — rescue `--mcp` pre-check helpers (CLI-neutral, pure).
// No I/O here: core/runtime.mjs runs the adapter's list command and passes the
// result in. Adapters own the list format (mcp.parseList) and the commands a
// user runs to fix a gap (mcp.installCommand); core never runs those commands.

const MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MCP_FLAG_INVALID = {
  message: 'Invalid --mcp value',
  action:
    'Pass one or more MCP server names separated by commas, e.g. `--mcp server-a,server-b`. ' +
    'Each name must start with a letter or digit and use only letters, digits, ".", "_" or "-".',
};

/**
 * @param {unknown} raw  flags.mcp as parsed: a string, `true` (dash-dash, no value) or `undefined` (task-flag, no value)
 * @returns {string[]|null}  trimmed, empty items dropped, de-duplicated in input order; null if empty or any name is invalid
 */
export function parseMcpNames(raw) {
  if (typeof raw !== 'string') return null;
  const names = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  return names.length > 0 && names.every((n) => MCP_NAME_RE.test(n)) ? names : null;
}

/**
 * Never reports a pass on a list it could not read.
 * @param {{ status: number|null, error: Error|null, stdout: string }} run  core/process.mjs#runSync result
 * @param {(stdout: string) => Array<{name: string, enabled: boolean}>|null} parseList  adapter.mcp.parseList
 * @returns {{ list: Array<{name: string, enabled: boolean}>, listError: null }
 *         | { list: null, listError: 'timeout'|'spawn_failed'|'exit_nonzero'|'unparseable' }}
 */
export function classifyMcpList(run, parseList) {
  if (run.error?.code === 'ETIMEDOUT') return { list: null, listError: 'timeout' };
  if (run.error || run.status === null) return { list: null, listError: 'spawn_failed' };
  if (run.status !== 0) return { list: null, listError: 'exit_nonzero' };
  const list = parseList(run.stdout);
  return list ? { list, listError: null } : { list: null, listError: 'unparseable' };
}

/**
 * Exact, case-sensitive name match.
 * @param {string[]} names
 * @param {Array<{name: string, enabled: boolean}>} list
 * @returns {{ missing: string[], disabled: string[] }}
 */
export function compareMcp(names, list) {
  const enabledByName = new Map(list.map((e) => [e.name, e.enabled]));
  return {
    missing: names.filter((n) => !enabledByName.has(n)),
    disabled: names.filter((n) => enabledByName.get(n) === false),
  };
}

/**
 * @param {{ missing: string[], disabled: string[] }} gaps  at least one non-empty
 * @param {(name: string) => { register: string, enable: string }} installCommand
 * @returns {{ message: string, action: string }}
 */
export function mcpNotReadyText({ missing, disabled }, installCommand) {
  const states = [...missing.map((n) => `${n} (not registered)`), ...disabled.map((n) => `${n} (disabled)`)];
  const steps = [...missing.map((n) => installCommand(n).register), ...disabled.map((n) => installCommand(n).enable)];
  const note = missing.length > 0 ? " Replace the placeholders with the server's launch command." : '';
  return {
    message: `Required MCP server(s) not ready: ${states.join(', ')}`,
    action: `Run the following yourself, then rerun the same rescue call: ${steps.map((s) => `\`${s}\``).join('; ')}.${note}`,
  };
}

/**
 * @param {string[]} names
 * @param {'timeout'|'spawn_failed'|'exit_nonzero'|'unparseable'} listError
 * @param {string} listCommand  `${adapter.bin.fallback} ${adapter.mcp.listArgs.join(' ')}`
 * @returns {{ message: string, action: string }}
 */
export function mcpListErrorText(names, listError, listCommand) {
  return {
    message: `Could not verify MCP server(s) ${names.join(', ')}: the MCP server list could not be read (${listError})`,
    action:
      `Run \`${listCommand}\` yourself to check that the server(s) are registered and enabled ` +
      '(update the CLI if the command is not recognized), then rerun the same rescue call, ' +
      'or rerun without --mcp to skip this check.',
  };
}
