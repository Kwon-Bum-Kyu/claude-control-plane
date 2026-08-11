// Golden envelope scenario definitions — companion core-integration baseline.
//
// Each entry describes one fixed-input call against one or both companions.
// `capture.mjs` executes every `runs[]` entry, seeding job meta (and, for the
// one antigravity case that needs it, a real repo-tree result file) before
// invoking the companion, then records stdout/stderr/exit_code as the
// baseline envelope for that scenario+CLI pair.
//
// Fixed UUIDs are used everywhere a job id is required so that repeat
// captures (and future before/after comparisons) are byte-for-byte
// reproducible instead of depending on a fresh randomUUID() each run.

export const MISSING_JOB_ID = '00000000-0000-4000-8000-000000000001';
export const COMPLETED_JOB_ID = '00000000-0000-4000-8000-000000000002';
export const RUNNING_JOB_ID = '00000000-0000-4000-8000-000000000003';
export const CORRUPT_JOB_ID = '00000000-0000-4000-8000-000000000004';
export const CANCEL_JOB_ID = '00000000-0000-4000-8000-000000000005';
export const FAILED_JOB_ID = '00000000-0000-4000-8000-000000000006';
export const NON_UUID_JOB_ID = 'not-a-real-uuid';

const AGY_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const CODEX_THREAD_ID = '11111111-1111-4111-8111-111111111111';

const AGY_COMPLETED_META = {
  id: COMPLETED_JOB_ID,
  status: 'completed',
  prompt: 'golden test prompt',
  mode: 'foreground',
  created_at: '2026-01-01T00:00:00.000Z',
  started_at: '2026-01-01T00:00:01.000Z',
  completed_at: '2026-01-01T00:00:05.000Z',
  antigravity_conversation_id: AGY_CONVERSATION_ID,
  agy_version: '1.2.0',
  max_tokens: 4000,
  files: null,
  sandbox: false,
  token_usage: { input: 250, output: 500, estimated: true },
  result_file_path: `_workspace/_jobs/${COMPLETED_JOB_ID}/result.md`,
  summary_3lines: 'golden stub line 1\ngolden stub line 2\ngolden stub line 3',
  error: null,
};

const AGY_RUNNING_META = {
  id: RUNNING_JOB_ID,
  status: 'running',
  prompt: 'golden test prompt',
  mode: 'foreground',
  created_at: '2026-01-01T00:00:00.000Z',
  started_at: '2026-01-01T00:00:01.000Z',
  completed_at: null,
  antigravity_conversation_id: null,
  agy_version: '1.2.0',
  max_tokens: 4000,
  files: null,
  sandbox: false,
  token_usage: null,
  result_file_path: null,
  summary_3lines: null,
  error: null,
};

// A terminal-but-not-completed state (failed/cancelled) — distinct from
// RUNNING_META above. antigravity's `result` has always collapsed every
// non-completed state into the same CCP-JOB-002 response (no separate
// "incomplete" code the way the other adapter has); this scenario pins that
// down for the states that were previously unrepresented in this file.
const AGY_FAILED_META = {
  id: FAILED_JOB_ID,
  status: 'failed',
  prompt: 'golden test prompt',
  mode: 'background',
  created_at: '2026-01-01T00:00:00.000Z',
  started_at: '2026-01-01T00:00:01.000Z',
  completed_at: '2026-01-01T00:00:05.000Z',
  antigravity_conversation_id: null,
  agy_version: '1.2.0',
  max_tokens: 4000,
  files: null,
  sandbox: false,
  token_usage: null,
  result_file_path: null,
  summary_3lines: null,
  error: { code: 'CCP-AG-001' },
};

function codexCompletedMeta(isolatedDir) {
  return {
    job_id: COMPLETED_JOB_ID,
    mode: 'codex',
    state: 'completed',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:01.000Z',
    completed_at: '2026-01-01T00:00:05.000Z',
    pid: null,
    exit_code: 0,
    prompt: 'golden test prompt',
    params: {},
    claude_session_id: null,
    stdout_path: `${isolatedDir}/${COMPLETED_JOB_ID}/stdout.log`,
    stderr_path: `${isolatedDir}/${COMPLETED_JOB_ID}/stderr.log`,
    result_path: `${isolatedDir}/${COMPLETED_JOB_ID}/result.txt`,
    summary_3lines: 'golden stub line 1\ngolden stub line 2\ngolden stub line 3',
    token_usage: { input: 120, cached: 20, output: 40, total: 140 },
    codex_thread_id: CODEX_THREAD_ID,
    duration_ms: 1234,
    error: null,
  };
}

function codexRunningMeta(isolatedDir) {
  return {
    job_id: RUNNING_JOB_ID,
    mode: 'codex',
    state: 'running',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:01.000Z',
    completed_at: null,
    pid: null,
    exit_code: null,
    prompt: 'golden test prompt',
    params: {},
    claude_session_id: null,
    stdout_path: `${isolatedDir}/${RUNNING_JOB_ID}/stdout.log`,
    stderr_path: `${isolatedDir}/${RUNNING_JOB_ID}/stderr.log`,
    result_path: null,
    error: null,
  };
}

function codexCancelMeta() {
  return {
    job_id: CANCEL_JOB_ID,
    mode: 'codex',
    state: 'running',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:01.000Z',
    completed_at: null,
    pid: 999999999,
    exit_code: null,
    prompt: 'golden test prompt',
    params: {},
    claude_session_id: null,
    stdout_path: null,
    stderr_path: null,
    result_path: null,
    error: null,
  };
}

// `meta` may be:
//   - an object  -> JSON.stringify'd into meta.json (valid meta)
//   - a string   -> written verbatim (used for the corrupted-JSON scenario)
//   - undefined  -> no meta.json written (job id stays "not found")
//
// `realRepoResult` (antigravity "result-completed" run only): the
// antigravity companion's `result` subcommand resolves `result_file_path`
// against the real repo root regardless of CCP_JOBS_DIR — a pre-existing
// isolation gap in the companion, out of scope for this bundle to fix.
// Capturing a true success envelope for that path requires a matching file
// to exist in the real repo tree; the capture script creates and removes it
// around the call so no contamination survives the run.

export const SCENARIOS = [
  {
    id: 'rescue-task-missing',
    title: 'rescue (task argument missing)',
    runs: [
      { cli: 'antigravity', args: ['rescue'] },
      { cli: 'codex', args: ['rescue'] },
    ],
  },
  {
    id: 'rescue-effort-rejected',
    title: 'rescue --effort high (antigravity) — codex-only flag rejected globally',
    runs: [{ cli: 'antigravity', args: ['rescue', '--effort', 'high', 'golden task'] }],
  },
  {
    id: 'rescue-fallback-claude',
    title: 'rescue --fallback-claude "x" — skip companion, hand back to main Claude',
    runs: [
      { cli: 'antigravity', args: ['rescue', '--fallback-claude', 'x'] },
      // codex's generic flag parser consumes the next bare token as a flag
      // value unless `--` marks the positional boundary (agents/codex-rescue.md:26).
      { cli: 'codex', args: ['rescue', '--fallback-claude', '--', 'x'] },
    ],
  },
  {
    id: 'status-invalid-job-id',
    title: 'status <non-UUID job id>',
    runs: [
      { cli: 'antigravity', args: ['status', NON_UUID_JOB_ID] },
      { cli: 'codex', args: ['status', NON_UUID_JOB_ID] },
    ],
  },
  {
    id: 'status-unknown-job',
    title: 'status <well-formed but unseeded job id>',
    runs: [
      { cli: 'antigravity', args: ['status', MISSING_JOB_ID] },
      { cli: 'codex', args: ['status', MISSING_JOB_ID] },
    ],
  },
  {
    id: 'result-completed',
    title: 'result <completed job meta seed>',
    runs: [
      {
        cli: 'antigravity',
        args: ['result', COMPLETED_JOB_ID],
        meta: AGY_COMPLETED_META,
        realRepoResult: {
          relPath: `_workspace/_jobs/${COMPLETED_JOB_ID}/result.md`,
          content: 'golden stub antigravity result body\n',
        },
      },
      {
        cli: 'codex',
        args: ['result', COMPLETED_JOB_ID],
        meta: (isolatedDir) => codexCompletedMeta(isolatedDir),
        resultFile: {
          // resolved relative to the isolated CCP_JOBS_DIR at capture time
          relPath: `${COMPLETED_JOB_ID}/result.txt`,
          content: 'golden stub codex result body\n',
        },
      },
    ],
  },
  {
    id: 'result-running',
    title: 'result <in-progress job meta seed>',
    runs: [
      { cli: 'antigravity', args: ['result', RUNNING_JOB_ID], meta: AGY_RUNNING_META },
      { cli: 'codex', args: ['result', RUNNING_JOB_ID], meta: (isolatedDir) => codexRunningMeta(isolatedDir) },
    ],
  },
  {
    id: 'result-corrupted-meta',
    title: 'result <meta.json fails to parse>',
    runs: [
      { cli: 'antigravity', args: ['result', CORRUPT_JOB_ID], meta: '{not valid json' },
      { cli: 'codex', args: ['result', CORRUPT_JOB_ID], meta: '{not valid json' },
    ],
  },
  {
    id: 'setup-not-installed',
    title: 'setup — stub binary reports not installed',
    runs: [
      { cli: 'antigravity', args: ['setup'], stubMode: 'not_installed' },
      { cli: 'codex', args: ['setup'], stubMode: 'not_installed' },
    ],
  },
  {
    id: 'setup-outdated-version',
    title: 'setup — stub binary reports a version below the minimum requirement',
    runs: [
      { cli: 'antigravity', args: ['setup'], stubMode: 'old_version' },
      { cli: 'codex', args: ['setup'], stubMode: 'old_version' },
    ],
  },
  {
    id: 'rescue-background-dispatch',
    title: 'rescue --background "x" — stub binary reports an installed/authenticated CLI',
    runs: [
      { cli: 'antigravity', args: ['rescue', '--background', 'x'], stubMode: 'ok', authOk: true },
      { cli: 'codex', args: ['rescue', '--background', '--', 'x'], stubMode: 'ok' },
    ],
  },
  {
    id: 'preflight-or-cancel',
    title: 'preflight (antigravity) / cancel (codex) — CLI-specific subcommand',
    runs: [
      { cli: 'antigravity', args: ['preflight'], stubMode: 'ok', authOk: true },
      { cli: 'codex', args: ['cancel', CANCEL_JOB_ID], meta: () => codexCancelMeta() },
    ],
  },
  {
    id: 'unsupported-subcommand',
    title: 'call with a subcommand neither companion implements',
    runs: [
      { cli: 'antigravity', args: ['bogus-cmd'] },
      { cli: 'codex', args: ['bogus-cmd'] },
    ],
  },
  {
    id: 'status-effort-rejected',
    title: 'status --effort high (antigravity) — global reject flag holds outside rescue too',
    runs: [{ cli: 'antigravity', args: ['status', '--effort', 'high', MISSING_JOB_ID] }],
  },
  {
    id: 'rescue-files-path-traversal',
    title: 'rescue --files /etc/passwd (antigravity) — absolute path outside plugin root rejected',
    runs: [{ cli: 'antigravity', args: ['rescue', '--files', '/etc/passwd', 'golden task'] }],
  },
  {
    id: 'result-failed-state',
    title: 'result <job meta seeded as failed> (antigravity) — collapses to CCP-JOB-002, not a separate "incomplete" code',
    runs: [{ cli: 'antigravity', args: ['result', FAILED_JOB_ID], meta: AGY_FAILED_META }],
  },
  {
    id: 'setup-auth-invalid-probe',
    title: 'setup — stub binary reports installed + a content-classifiable "not logged in" probe failure (antigravity)',
    runs: [{ cli: 'antigravity', args: ['setup'], stubMode: 'invalid_auth', authOk: true }],
  },
];
