// CCP original (no adapted material — this is not a codex-plugin-cc file).
// One verdict for a delegated CLI run, shared by the foreground path and the
// background worker so both record the same state, code and exit_code for the
// same run. Rules apply in order and the first match wins: timeout, then run
// failure, then parse error, then success. A timeout is recognised by
// error.code === 'ETIMEDOUT' alone: the exit status can be anything (a CLI that
// traps SIGTERM may exit 0 with partial output) and an error message is free
// text, so neither can tell a timeout from a spawn failure. Pure: no imports,
// no I/O; the clock is read only by failedMetaPatch.

/**
 * Judge one run. `r` is core/process.mjs#runSync's return.
 * @returns {{kind:'timeout',code:string}|{kind:'failure',code:string}|{kind:'parse',code:string,parsed:object}|{kind:'success',parsed:object}}
 */
export function judgeRun(adapter, r, { logText = '' } = {}) {
  if (r.error?.code === 'ETIMEDOUT') return { kind: 'timeout', code: 'CCP-TIMEOUT-001' };
  if (r.error || r.status !== 0) {
    return { kind: 'failure', code: adapter.classifyFailure({ stdout: r.stdout, stderr: r.stderr, status: r.status, signal: r.signal, error: r.error }) };
  }
  const parsed = adapter.parseResult({ stdout: r.stdout, stderr: r.stderr, status: r.status, logText });
  return parsed.errorCode ? { kind: 'parse', code: parsed.errorCode, parsed } : { kind: 'success', parsed };
}

/**
 * meta.json patch for any run not judged a success.
 * exit_code is the CLI's status, or 1 when there is none or when a timeout or
 * run failure came back as 0; a parse error keeps 0. error.spawn_code is set
 * only for a failure that carries a string error code.
 */
export function failedMetaPatch(outcome, r, durationMs) {
  const exitCode = outcome.kind !== 'parse' && r.status === 0 ? 1 : (r.status ?? 1);
  const spawnCode = outcome.kind === 'failure' && typeof r.error?.code === 'string' ? { spawn_code: r.error.code } : {};
  return {
    state: 'failed',
    completed_at: new Date().toISOString(),
    exit_code: exitCode,
    error: { code: outcome.code, stderr_head: (r.stderr || '').slice(0, 500), ...spawnCode },
    duration_ms: durationMs,
  };
}
