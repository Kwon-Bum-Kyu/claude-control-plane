// CCP — shared error catalog + adapter overlay merge (CLI-neutral)
// Codes here are the ones conceptually shared across CLIs (job lookup,
// argument parsing, timeouts, context budget, Node version). An adapter's own
// `errors` field always wins on key collision — the adapter catalog
// overwrites the shared one so CLI-specific wording, e.g. a different slash
// name in `action`, is preserved.

export const SHARED_ERROR_CATALOG = {
  'CCP-INVALID-001': {
    message: 'Failed to parse arguments',
    action: 'Check the usage and try again.',
    recovery: 'abort',
  },
  'CCP-JOB-001': {
    message: 'Could not find that job',
    action: 'Check the job_id and try again.',
    recovery: 'abort',
  },
  'CCP-JOB-002': {
    message: 'The job has not finished yet',
    action: 'Check the job status and try again.',
    recovery: 'retry',
  },
  'CCP-JOB-003': {
    message: 'Job metadata is corrupted',
    action: 'Delete the job directory and create a new job.',
    recovery: 'abort',
  },
  'CCP-JOB-004': {
    message: 'The result file is missing',
    action: 'Rerun the rescue call.',
    recovery: 'abort',
  },
  'CCP-JOB-409': {
    message: 'Cannot cancel in the current state',
    action: 'Check the job state and try again.',
    recovery: 'abort',
  },
  'CCP-TIMEOUT-001': {
    message: 'The CLI response timed out',
    action: 'Retry or run asynchronously with --background.',
    recovery: 'retry',
  },
  'CCP-CTX-001': {
    message: 'Subagent response exceeded the summary threshold',
    action: 'Fetch only the summary and try again.',
    recovery: 'abort',
  },
  'CCP-SETUP-002': {
    message: 'Node.js version is below the requirement',
    action: 'Install Node.js 20+ and rerun.',
    recovery: 'abort',
  },
};

/**
 * @param {Record<string, {message:string, action:string, recovery:string}>} [adapterErrors]
 * @returns {Record<string, {message:string, action:string, recovery:string}>}
 */
export function mergeErrorCatalog(adapterErrors) {
  return { ...SHARED_ERROR_CATALOG, ...(adapterErrors || {}) };
}
