// Adapted from: codex-plugin-cc plugins/codex/scripts/lib/tracked-jobs.mjs
// Source commit: 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Original license: Apache-2.0 (see ATTRIBUTION.md §1.3, NOTICE)
// Modifications: CLAUDE_SESSION_ID env 필터, codex resume --last fallback (probe §1 — codex 는 picker/--last 직접 지원), 한국어 에러
// SHA-of-this-adaptation: <to be filled at B1 merge>

import { listJobs } from './state.mjs';

/**
 * 현 Claude 세션에 속한 job 만 필터.
 * env CLAUDE_SESSION_ID 가 없으면 process.ppid 기반 fallback (codex-plugin-cc 동일).
 *
 * @param {object[]} jobs
 * @param {string} [sessionId]  명시 세션 ID
 */
export function filterJobsForCurrentSession(jobs, sessionId) {
  const sid = sessionId || process.env.CLAUDE_SESSION_ID || `ppid:${process.ppid}`;
  return jobs.filter((j) => {
    if (!j) return false;
    if (j.claude_session_id == null) return true; // 미지정 job 도 포함 (호환)
    return j.claude_session_id === sid;
  });
}

/**
 * 가장 최근 resumable job 1건 반환.
 * codex-plugin-cc 의 findLatestResumableTaskJob 를 함수 단위 차용.
 * 우선순위:
 *   1) 메타파일 기반 (현 세션 + state == 'completed' + result_path 존재)
 *   2) (B1 v0.1: 미적용) codex resume --last fallback 은 v0.2 백로그 (B19 의존)
 *
 * @param {string} jobsDir
 * @param {object} [opts]
 * @param {string} [opts.mode]      'codex' | 'gemini' | undefined (전체)
 * @param {string} [opts.sessionId]
 * @returns {object|null}
 */
export function findLatestResumableJob(jobsDir, opts = {}) {
  const all = listJobs(jobsDir);
  let pool = filterJobsForCurrentSession(all, opts.sessionId);
  if (opts.mode) pool = pool.filter((j) => j.mode === opts.mode);
  pool = pool.filter((j) => j.state === 'completed' && j.result_path);
  // listJobs 는 created_at 내림차순으로 이미 정렬되어 있음
  return pool[0] || null;
}

/**
 * 현 세션의 진행 중 job 목록 (queued | running)
 */
export function findInflightJobs(jobsDir, opts = {}) {
  const all = listJobs(jobsDir);
  let pool = filterJobsForCurrentSession(all, opts.sessionId);
  if (opts.mode) pool = pool.filter((j) => j.mode === opts.mode);
  return pool.filter((j) => j.state === 'queued' || j.state === 'running');
}
