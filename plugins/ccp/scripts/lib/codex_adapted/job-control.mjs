// Adapted from: codex-plugin-cc plugins/codex/scripts/lib/job-control.mjs
// Source commit: 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Original license: Apache-2.0 (see ATTRIBUTION.md §1.3, NOTICE)
// Modifications: enqueue/dequeue/cancel 통합 인터페이스, envelope 6키 통합, CCP-* 에러 코드 매핑, 한국어 메시지
// SHA-of-this-adaptation: <to be filled at B1 merge>

import { join } from 'node:path';
import {
  enqueueBackgroundJob,
  patchMeta,
  readMeta,
  waitForJob,
} from './state.mjs';
import { spawnDetachedWorker, killPid, isAlive } from './process.mjs';

/**
 * background 작업 디스패치 — meta 등록 + detached worker spawn.
 * codex-companion 의 'rescue --background' 진입점이 호출한다.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.mode             "codex" | "gemini"
 * @param {string} opts.workerScriptPath  task-worker 진입 스크립트 (codex-companion 자체)
 * @param {string} opts.prompt
 * @param {object} [opts.params]
 * @param {string} [opts.cwd]
 * @param {string} [opts.claudeSessionId]
 * @param {string} [opts.nodeBin]        default: process.execPath
 * @returns {{ jobId: string, pid: number, meta: object }}
 */
export function dispatchBackgroundJob(opts) {
  const {
    jobsDir,
    mode,
    workerScriptPath,
    prompt,
    params = {},
    cwd,
    claudeSessionId,
    nodeBin = process.execPath,
  } = opts;
  const { jobId, dir, meta } = enqueueBackgroundJob({
    jobsDir,
    mode,
    prompt,
    params,
    claudeSessionId,
  });
  const stdoutPath = meta.stdout_path;
  const stderrPath = meta.stderr_path;
  // worker 인자: task-worker <jobId>
  const args = [workerScriptPath, 'task-worker', jobId];
  const { pid } = spawnDetachedWorker({
    bin: nodeBin,
    args,
    cwd: cwd || process.cwd(),
    stdoutPath,
    stderrPath,
    env: { CCP_JOBS_DIR: jobsDir },
  });
  const next = patchMeta(jobsDir, jobId, { pid, state: 'running', started_at: new Date().toISOString() });
  return { jobId, pid, meta: next };
}

/**
 * 진행 중 job 취소. SIGTERM 전송 후 meta 를 'cancelled' 로 전이.
 * @returns {{ ok: boolean, jobId: string, code?: string, error?: string }}
 */
export function cancelJob({ jobsDir, jobId }) {
  const meta = readMeta(jobsDir, jobId);
  if (!meta) {
    return { ok: false, jobId, code: 'CCP-JOB-404', error: '해당 job 을 찾을 수 없습니다' };
  }
  if (meta.state !== 'running' && meta.state !== 'queued') {
    return { ok: false, jobId, code: 'CCP-JOB-409', error: `현재 상태(${meta.state})에서는 취소할 수 없습니다` };
  }
  if (meta.pid && isAlive(meta.pid)) {
    killPid(meta.pid);
  }
  patchMeta(jobsDir, jobId, {
    state: 'cancelled',
    completed_at: new Date().toISOString(),
  });
  return { ok: true, jobId };
}

/**
 * polling wrapper — companion 측 awaitWithTimeout 패턴
 */
export async function awaitJobResult({ jobsDir, jobId, timeoutMs, pollIntervalMs }) {
  return waitForJob({ jobsDir, jobId, timeoutMs, pollIntervalMs });
}

/**
 * job state 단일 조회
 */
export function snapshotJob(jobsDir, jobId) {
  return readMeta(jobsDir, jobId);
}
