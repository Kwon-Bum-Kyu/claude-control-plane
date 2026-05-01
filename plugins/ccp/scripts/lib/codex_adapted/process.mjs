// Adapted from: codex-plugin-cc plugins/codex/scripts/lib/process.mjs
// Source commit: 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Original license: Apache-2.0 (see ATTRIBUTION.md §1.3, NOTICE)
// Modifications: file fd stdio 강제 (probe §4 발견 — pipe 시 SIGPIPE 자식 사망), stdin: 'ignore' 강제 (probe §3.2 — codex 가 stdin 닫히지 않으면 무한 대기), 한국어 에러
// SHA-of-this-adaptation: <to be filled at B1 merge>

import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

/**
 * codex CLI foreground 동기 실행. stdin 강제 닫음.
 * @param {object} opts
 * @param {string} opts.bin    "codex" 또는 절대 경로
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
 * detached spawn — 부모가 즉시 exit 해도 자식이 살아남도록 file fd stdio 사용.
 * codex-plugin-cc 의 spawnDetachedTaskWorker 를 함수 단위 차용.
 *
 * 핵심 안전장치 (probe §4 검증):
 *   1) stdio[0] = 'ignore'  → codex 가 stdin 대기 무한루프 방지
 *   2) stdio[1], stdio[2] = file fd  → pipe 사용 시 SIGPIPE 로 자식 즉시 사망
 *   3) child.unref()       → 부모 event loop 가 자식을 기다리지 않음
 *
 * @param {object} opts
 * @param {string} opts.bin
 * @param {string[]} opts.args
 * @param {string} opts.cwd
 * @param {string} opts.stdoutPath
 * @param {string} opts.stderrPath
 * @param {Record<string,string>} [opts.env]  추가 env 병합 (기본: process.env)
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
  // 부모 이벤트 루프가 자식을 기다리지 않도록 unref
  child.unref();
  // file fd 는 부모가 닫아도 자식이 자체 fd 를 보유 (POSIX)
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return { pid: child.pid, stdoutFd, stderrFd };
}

/**
 * pid 가 살아있는지 확인 (kill 0 신호)
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
 * pid 종료 시도. SIGTERM → 1초 후 SIGKILL.
 * @returns {boolean} 성공 여부
 */
export function killPid(pid) {
  if (!isAlive(pid)) return true;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  // SIGKILL fallback 은 호출자가 결정 — 동기 환경에서는 간단히 SIGTERM 만
  return true;
}
