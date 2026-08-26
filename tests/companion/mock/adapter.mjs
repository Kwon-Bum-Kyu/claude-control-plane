// CCP — mock CLI adapter (extension proof, not a shipped adapter).
//
// This file is the deliverable for the extension-contract proof ("adding a
// new CLI = one adapter file, zero core diff"): it is written using *only*
// the 52 leaf keys the frozen adapter contract defines (see core/runtime.mjs's
// CONTRACT). No core/*.mjs file was touched to make this adapter
// work — if that ever stops being true, the contract has a gap and needs a
// judged (a)/(b)/(c) field addition, not a workaround here.
//
// This mock is intentionally small: it exercises setup / rescue (foreground
// + background) / status / result / task-worker against a fake CLI binary
// (tests/companion/mock/stub-cli) so contract-test.mjs can prove the whole
// dispatch path — not just object-shape validation — works with an adapter
// core has never seen before.

export default {
  id: 'mock',
  bin: { envVar: 'CCP_MOCK_BIN', candidates: [], fallback: 'mock-cli' },
  version: { args: ['--version'], pattern: /(\d+\.\d+\.\d+)/, min: '1.0.0', notInstalledCode: 'CCP-SETUP-901', tooOldCode: 'CCP-SETUP-902' },

  auth: {
    probeArgs: ['--auth-check'],
    successPattern: /OK/i,
    failureCode: 'CCP-OAUTH-901',
    rescueGate: 'probe',
    detect() {
      return 'mock-auth';
    },
    classifyProbeFailure({ status, error }) {
      if (status === null || error) return 'spawn_failed';
      if (status !== 0) return 'status_nonzero';
      return 'pattern_mismatch';
    },
  },

  supports: {
    subcommands: ['setup', 'rescue', 'status', 'result', 'task-worker'],
    flags: {
      background: { key: 'background', type: 'bool' },
      'timeout-ms': { key: 'timeoutMs', type: 'int' },
    },
    rejectFlags: [],
    validateFlagValue() {
      return null;
    },
    resultIncompleteCode(state) {
      return state === 'queued' || state === 'running' ? 'CCP-JOB-002' : 'CCP-JOB-004';
    },
    jobLookupCodes: { missing: 'CCP-JOB-001', corrupt: 'CCP-JOB-001' },
  },

  knownViolations: [],
  argStyle: 'dash-dash',
  timeouts: { foreground: 30000, background: 30000, authProbe: 10000 },
  result: { fileName: 'result.txt', pathStyle: 'absolute', logFileName: null, persistForeground: false },

  errors: {
    'CCP-SETUP-901': { message: 'Mock CLI is not installed', action: 'Install the mock CLI and retry.', recovery: 'abort' },
    'CCP-SETUP-902': { message: 'Mock CLI version is below the requirement', action: 'Update the mock CLI and retry.', recovery: 'abort' },
    'CCP-OAUTH-901': { message: 'Mock authentication is required', action: 'Authenticate the mock CLI and retry.', recovery: 'fallback_claude' },
    'CCP-MOCK-001': { message: 'Mock CLI run failed', action: 'Check stderr logs or retry.', recovery: 'retry' },
  },

  details: {
    allowKeys: [],
    sanitizeScope: { success: true, background: true, error: true },
    modeFor() {
      // No mode key on any envelope — the frozen (unmodified) envelope
      // validator's mode enum is closed to [antigravity, codex, router], and
      // this mock deliberately doesn't need to claim membership in it to
      // prove the extension contract works.
      return null;
    },
    extraFor(subcommand, ctx) {
      if (subcommand === 'rescue') return { job_id: ctx?.jobId ?? null };
      if (subcommand === 'rescue-background') return { pid: ctx?.pid ?? null };
      return {};
    },
  },

  messages: {
    nextAction(kind, jobId) {
      if (kind === 'background') return `Check status for ${jobId}.`;
      return '';
    },
    fallbackSummary: 'mock: this task should be handled by main Claude.',
    missingArg(subcommand) {
      return { message: `${subcommand} requires an argument`, action: 'See usage.' };
    },
    retryHint() {
      return null;
    },
    statusSummary(jobId, meta) {
      return `mock job ${jobId} is ${meta.state}`;
    },
    usage(visibleSubcommands) {
      return `Usage: mock-cli <${visibleSubcommands.join('|')}> ...`;
    },
  },

  buildArgs({ prompt }) {
    return ['run', prompt];
  },

  parseResult({ stdout }) {
    return { body: stdout || '', tokens: { input: 0, output: 0 }, meta: {} };
  },

  tokensFrom(raw) {
    return { input: raw?.input || 0, output: raw?.output || 0 };
  },

  estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  },

  summarize(body) {
    return typeof body === 'string' ? body.trim() : '';
  },

  classifyFailure() {
    return 'CCP-MOCK-001';
  },
};
