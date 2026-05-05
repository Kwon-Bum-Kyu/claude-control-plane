import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

/**
 * Run the codex CLI synchronously in the foreground. Forces stdin closed.
 * @param {object} opts
 * @param {string} opts.bin    "codex" or an absolute path
 * @param {string[]} opts.args
 * @param {string} [opts.cwd]
 * @param {number} opts.timeoutMs
 * @returns {{ status: number|null, stdout: string, stderr: string, signal: string|null, error: Error|null }}
 */
export function runCodexSync({ bin, args, cwd, timeoutMs }) {
  const r = spawnSync(bin, args, {
    cwd: cwd || process.cwd(),
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    signal: r.signal || null,
    error: r.error || null,
  };
}

/**
 * Detached spawn - use file-fd stdio so the child survives even if the parent exits immediately.
 *
 * Key safeguards (validated empirically against codex CLI 0.122.x):
 *   1) stdio[0] = 'ignore'  -> prevents codex from hanging in a stdin wait loop
 *   2) stdio[1], stdio[2] = file fd  -> avoids immediate child death from SIGPIPE when using pipes
 *   3) child.unref()       -> the parent event loop does not wait for the child
 *
 * @param {object} opts
 * @param {string} opts.bin
 * @param {string[]} opts.args
 * @param {string} opts.cwd
 * @param {string} opts.stdoutPath
 * @param {string} opts.stderrPath
 * @param {Record<string,string>} [opts.env]  extra env merge (default: process.env)
 * @returns {{ pid: number, stdoutFd: number, stderrFd: number }}
 */
export function spawnDetachedWorker({ bin, args, cwd, stdoutPath, stderrPath, env }) {
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
  const child = spawn(bin, args, {
    cwd,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    env: { ...process.env, ...(env || {}) },
  });
  // Unref so the parent event loop does not wait for the child
  child.unref();
  // The child keeps its own file fds even after the parent closes them (POSIX)
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return { pid: child.pid, stdoutFd, stderrFd };
}

/**
 * Check whether a pid is alive (kill 0 signal)
 */
export function isAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Attempt to terminate a pid. SIGTERM -> SIGKILL after 1 second.
 * @returns {boolean} Whether termination was initiated successfully
 */
export function killPid(pid) {
  if (!isAlive(pid)) return true;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  // The caller decides whether to use a SIGKILL fallback - in this sync path, SIGTERM is enough
  return true;
}
