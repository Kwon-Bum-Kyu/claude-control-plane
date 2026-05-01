// Adapted from: codex-plugin-cc plugins/codex/scripts/lib/state.mjs
// Source commit: 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Original license: Apache-2.0 (see ATTRIBUTION.md §1.3, NOTICE)
// Modifications: 한국어 에러 메시지, _workspace/_jobs/ 경로 통일, mode:"codex" 메타 필드, gemini-companion 와 폴더 구조 일치
// SHA-of-this-adaptation: <to be filled at B1 merge>

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * job 메타파일 read. 미존재 또는 파싱 실패 시 null.
 * @param {string} jobsDir
 * @param {string} jobId
 */
export function readMeta(jobsDir, jobId) {
  const path = join(jobsDir, jobId, 'meta.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * job 메타파일 write (atomic 풍 — 임시파일 → rename 은 codex-plugin-cc 패턴 유지).
 * @param {string} jobsDir
 * @param {string} jobId
 * @param {object} meta
 */
export function writeMeta(jobsDir, jobId, meta) {
  const dir = join(jobsDir, jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'meta.json');
  writeFileSync(path, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

/**
 * job 디렉터리 보장. 없으면 생성, 있으면 그대로.
 */
export function ensureJobDir(jobsDir, jobId) {
  const dir = join(jobsDir, jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * background job 큐 진입 — 신규 jobId 생성 후 meta.json 을 queued 상태로 초기화한다.
 * codex-plugin-cc 의 enqueueBackgroundTask 를 함수 단위 차용.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.mode      "codex" | "gemini"
 * @param {string} opts.prompt
 * @param {object} [opts.params]  model/effort/sandbox 등
 * @param {string} [opts.claudeSessionId]
 * @returns {{ jobId: string, dir: string, meta: object }}
 */
export function enqueueBackgroundJob({ jobsDir, mode, prompt, params = {}, claudeSessionId }) {
  if (!mode || (mode !== 'codex' && mode !== 'gemini')) {
    throw new Error(`enqueueBackgroundJob: mode must be 'codex' or 'gemini', got ${mode}`);
  }
  const jobId = randomUUID();
  const dir = ensureJobDir(jobsDir, jobId);
  const meta = {
    job_id: jobId,
    mode,
    state: 'queued',
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    pid: null,
    exit_code: null,
    prompt,
    params,
    claude_session_id: claudeSessionId || null,
    stdout_path: join(dir, 'stdout.log'),
    stderr_path: join(dir, 'stderr.log'),
    result_path: null,
    error: null,
  };
  writeMeta(jobsDir, jobId, meta);
  return { jobId, dir, meta };
}

/**
 * meta.state 전이 (queued → running → completed | failed | cancelled).
 * 동시성 충돌 회피를 위해 read-modify-write 단순 패턴을 사용 (codex-plugin-cc 동일).
 *
 * @param {string} jobsDir
 * @param {string} jobId
 * @param {object} patch  부분 업데이트 (state, pid, exit_code, completed_at 등)
 */
export function patchMeta(jobsDir, jobId, patch) {
  const cur = readMeta(jobsDir, jobId);
  if (!cur) {
    throw new Error(`patchMeta: meta.json not found for jobId=${jobId}`);
  }
  const next = { ...cur, ...patch };
  writeMeta(jobsDir, jobId, next);
  return next;
}

/**
 * polling — meta.state 가 terminal 상태가 될 때까지 또는 timeout 까지 대기.
 * codex-plugin-cc 의 waitForSingleJobSnapshot 를 함수 단위 차용.
 *
 * @param {object} opts
 * @param {string} opts.jobsDir
 * @param {string} opts.jobId
 * @param {number} opts.timeoutMs       총 대기 한도
 * @param {number} opts.pollIntervalMs  polling 주기
 * @returns {Promise<object>} 최종 meta
 */
export async function waitForJob({ jobsDir, jobId, timeoutMs, pollIntervalMs }) {
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const start = Date.now();
  while (true) {
    const meta = readMeta(jobsDir, jobId);
    if (meta && TERMINAL.has(meta.state)) return meta;
    if (Date.now() - start > timeoutMs) {
      return meta || { job_id: jobId, state: 'timeout', error: 'wait timeout' };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * 모든 job 디렉터리 나열 (정렬: created_at 내림차순)
 */
export function listJobs(jobsDir) {
  if (!existsSync(jobsDir)) return [];
  const entries = readdirSync(jobsDir);
  const jobs = [];
  for (const id of entries) {
    const stat = (() => {
      try { return statSync(join(jobsDir, id)); } catch { return null; }
    })();
    if (!stat || !stat.isDirectory()) continue;
    const meta = readMeta(jobsDir, id);
    if (meta) jobs.push(meta);
  }
  jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return jobs;
}
