// Turns a declared runner (ccp.json "runners") + a resolved role into an adapter
// object that passes core's assertAdapter. Role options reach buildArgs by closure.
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { renderArgv } from '../variant-b/resolve.mjs';

const CORE_FILES = new Set(['meta.json', 'run.log', 'stdout.log', 'stderr.log', 'result.txt']);
const DEFAULT_TIMEOUT_MS = 600000;

export function createRunnerAdapter(def, role, roleName) {
  const name = role.runner;
  // buildArgs and parseResult run in the same process for one call, so the job
  // directory seen by buildArgs can be remembered for parseResult.
  let jobDir = null;
  const text = (s) => (typeof s === 'string' ? s.trim() : '');

  return {
    id: name,
    bin: { envVar: `CCP_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BIN`, candidates: [], fallback: def.bin },
    version: { args: ['--version'], pattern: /(\d+\.\d+\.\d+)/, min: '0.0.0', notInstalledCode: 'CCP-RUNNER-002', tooOldCode: 'CCP-RUNNER-002' },
    auth: {
      probeArgs: ['--version'], successPattern: null, failureCode: 'CCP-RUNNER-002',
      rescueGate: 'detect', // no auth concept for a declared runner: never spawn a probe
      detect: () => 'none',
      classifyProbeFailure: () => 'status_nonzero',
    },
    supports: {
      subcommands: ['rescue', 'status', 'result', 'cancel', 'task-worker'],
      flags: {
        background: { key: 'background', type: 'bool' },
        'timeout-ms': { key: 'timeoutMs', type: 'int' },
        model: { key: 'model', type: 'string' },
        cwd: { key: 'cwd', type: 'string' },
        task: { key: 'task', type: 'string' },
        'job-id': { key: 'jobId', type: 'string' },
      },
      rejectFlags: [],
      validateFlagValue: () => null,
      resultIncompleteCode: (state) => (state === 'queued' || state === 'running' ? 'CCP-JOB-002' : 'CCP-JOB-004'),
      jobLookupCodes: { missing: 'CCP-JOB-001', corrupt: 'CCP-JOB-003' },
    },
    knownViolations: [],
    argStyle: 'task-flag',
    timeouts: { foreground: DEFAULT_TIMEOUT_MS, background: DEFAULT_TIMEOUT_MS, authProbe: 10000 },
    // core hands buildArgs only logFile (= <job dir>/<logFileName>), and only when
    // logFileName is set and, in the foreground, persistForeground is true.
    // Declaring a log file is the only way to learn the job directory.
    result: { fileName: 'result.txt', pathStyle: 'absolute', logFileName: 'run.log', persistForeground: true },
    errors: {
      'CCP-RUNNER-001': { message: 'The runner CLI exited with an error', action: 'See details.stderr_head, or run the CLI by hand.', recovery: 'retry' },
      'CCP-RUNNER-002': { message: 'The runner CLI could not be started', action: 'Install it, or point the runner bin env var at it.', recovery: 'user_action_required' },
    },
    details: {
      allowKeys: [],
      sanitizeScope: { success: true, background: true, error: true },
      modeFor: () => null, // the envelope schema's mode enum is closed to antigravity/codex/router
      extraFor(sub, c) {
        if (sub === 'rescue') return { job_id: c.jobId };
        if (sub === 'rescue-background') return { pid: c.pid };
        if (sub === 'rescue-failure') return { job_id: c.jobId, exit_code: c.exitCode, stderr_head: c.stderrHead };
        if (sub === 'status') return { job_id: c.jobId, state: c.meta.state, error_code: c.meta.error?.code };
        return {};
      },
    },
    messages: {
      fallbackSummary: `${name}: handle this task in main Claude.`,
      nextAction: (kind, jobId) => (kind === 'background' ? `Check status for ${jobId}.` : ''),
      missingArg: (sub) => ({ message: `${sub} requires an argument`, action: `Usage: entry.mjs ${roleName} ${sub} ...` }),
      retryHint: () => null,
      statusSummary: (jobId, meta) => `${name} job ${jobId} is ${meta.state}`,
      usage: (visible) => `Use one of: ${visible.join(' | ')}.`,
    },
    mcp: { listArgs: ['--mcp-list'], parseList: () => null, installCommand: () => ({ register: '', enable: '' }) },

    buildArgs({ prompt, model, logFile }) {
      jobDir = dirname(logFile);
      const vars = { ...role, model: model || role.model, task: prompt, job_dir: jobDir };
      const { argv, missing } = renderArgv(def.args, vars);
      if (missing.length > 0) throw new Error(`placeholder with no value: ${missing.join(', ')}`);
      return [...argv, ...(role.args || [])];
    },
    parseResult({ stdout }) {
      const files = readdirSync(jobDir).filter((f) => !CORE_FILES.has(f)).sort();
      const head = files.length > 0 ? `Generated ${files.length} file(s) in ${jobDir}: ${files.join(', ')}` : '';
      return { body: [head, text(stdout)].filter(Boolean).join('\n'), tokens: { input: 0, output: 0 }, meta: {} };
    },
    tokensFrom: (raw) => ({ input: raw?.input || 0, output: raw?.output || 0 }),
    estimateTokens: (t) => Math.ceil((t || '').length / 4),
    summarize: (body) => (typeof body === 'string' ? body.trim() : ''),
    classifyFailure: ({ error }) => (error?.code === 'ENOENT' ? 'CCP-RUNNER-002' : 'CCP-RUNNER-001'),
  };
}
