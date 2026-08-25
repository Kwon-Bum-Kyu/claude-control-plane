// CCP — envelope emit helpers (CLI-neutral)
// stdout writes and process.exit are core-exclusive. Adapters never call
// these directly — they return plain values and core/runtime.mjs passes
// them here.
//
// `lib/envelope-validate.mjs` itself is NOT modified here — its exported
// `validateEnvelope(env)` (data-only: returns {valid, errors}, no side
// effects) is reused as-is. What lives here is the *emit-time* wrapper around
// it: validation is always on for every adapter (no more per-adapter kill
// switch — see 04_implementation_progress.md for why that was reverted), and
// a violation only stays silent if it matches a `knownViolations` entry the
// adapter registered. An adapter with an empty `knownViolations` array gets
// every violation surfaced, same as always.

import { validateEnvelope } from '../lib/envelope-validate.mjs';
import { clampSummary as clamp } from './budget.mjs';

const SECRET_KEY_RE = /token|secret|api[_-]?key|authorization|password/i;
const BEARER_VALUE_RE = /Bearer\s+[A-Za-z0-9._-]+/i;

// `validateEnvelope`'s error strings are deterministic templates; matching
// against them (rather than re-deriving the check independently) is what
// lets this stay a thin wrapper instead of a second copy of the validator.
const RECOVERY_VIOLATION_RE = /^error\.recovery "(.*)" not in enum$/;
const MODE_ENUM_VIOLATION_RE = /^details\.mode "(.*)" not in \[/;

/**
 * Is this specific validateEnvelope error message covered by one of the
 * adapter's registered knownViolations entries? Only the two violation
 * categories the (frozen, unmodified) validator can actually detect —
 * recovery-outside-enum and mode-outside-enum — ever reach here; the other
 * two categories (nested error.details, missing details.mode) are
 * structurally invisible to it and never produce a message at all, so there
 * is nothing for this function to suppress for those regardless of how
 * complete the allowlist is.
 */
function isKnownViolation(message, envelope, knownViolations) {
  const recoveryMatch = RECOVERY_VIOLATION_RE.exec(message);
  if (recoveryMatch) {
    const value = recoveryMatch[1];
    const code = envelope.error?.code;
    return knownViolations.some((v) => v.path === 'error.recovery' && v.value === value && Array.isArray(v.codes) && v.codes.includes(code));
  }
  const modeMatch = MODE_ENUM_VIOLATION_RE.exec(message);
  if (modeMatch) {
    const value = modeMatch[1];
    return knownViolations.some((v) => v.path === 'details.mode' && v.rule !== 'missing' && v.value === value);
  }
  return false;
}

/**
 * @param {Record<string, any>} details
 * @param {string[]} [allowKeys]  keys exempt from the secret-key-name filter
 */
export function sanitizeDetails(details, allowKeys = []) {
  const allow = new Set(allowKeys);
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (SECRET_KEY_RE.test(k) && !allow.has(k)) continue;
    if (typeof v === 'string' && BEARER_VALUE_RE.test(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * @param {object} envelope
 * @param {Array} [knownViolations]  adapter's knownViolations allowlist
 */
function emit(envelope, knownViolations = []) {
  const result = validateEnvelope(envelope);
  if (!result.valid) {
    const unresolved = result.errors.filter((msg) => !isKnownViolation(msg, envelope, knownViolations));
    if (unresolved.length > 0) {
      const msg = `[envelope-validate] ${unresolved.join('; ')}`;
      if (process.env.CCP_ENVELOPE_STRICT === '1') throw new Error(msg);
      process.stderr.write(msg + '\n');
    }
  }
  process.stdout.write(JSON.stringify(envelope) + '\n');
}

/**
 * @param {object} opts
 * @param {string} opts.summary
 * @param {string|null} [opts.result_path]
 * @param {object} opts.tokens          already adapter.tokensFrom()-shaped — passed through as-is
 * @param {boolean} [opts.summary_truncated]  only ever added to the envelope when
 *   this is exactly `true` — never emitted as `false`. A caller that already
 *   ran the text through `budget.mjs#clampSummaryAtBoundary` passes its
 *   `truncated` flag straight through here; anything else (`false`,
 *   `undefined`) leaves the key out of the envelope entirely.
 * @param {object} [opts.details]
 * @param {string[]} [opts.allowKeys]
 * @param {boolean} [opts.sanitize]     adapter's details.sanitizeScope.success
 * @param {Array} [opts.knownViolations]  adapter's knownViolations allowlist
 */
export function emitSuccess({ summary, result_path, tokens, summary_truncated, details, allowKeys = [], sanitize = true, knownViolations = [] }) {
  const env = {
    summary: clamp(summary),
  };
  if (summary_truncated === true) env.summary_truncated = true;
  env.result_path = result_path ?? null;
  env.tokens = tokens;
  env.exit_code = 0;
  if (details && typeof details === 'object') {
    env.details = sanitize ? sanitizeDetails(details, allowKeys) : details;
  }
  emit(env, knownViolations);
  process.exit(0);
}

/**
 * background envelope is a third, schema-external form — never validated.
 * The bypass is intentional, not an oversight (see the design notes).
 */
export function emitBackground({ job_id, next_action, details, allowKeys = [], sanitize = true }) {
  const env = { job_id, status: 'queued', next_action };
  if (details && typeof details === 'object') {
    env.details = sanitize ? sanitizeDetails(details, allowKeys) : details;
  }
  process.stdout.write(JSON.stringify(env) + '\n');
  process.exit(0);
}

/**
 * @param {Record<string, {message:string, action:string, recovery:string}>} errorCatalog  merged shared+adapter catalog
 * @param {string} code
 * @param {object} [opts]
 * @param {string} [opts.message]
 * @param {string} [opts.action]
 * @param {object} [opts.details]
 * @param {string[]} [opts.allowKeys]
 * @param {boolean} [opts.sanitize]     adapter's details.sanitizeScope.error
 * @param {boolean} [opts.nestDetailsInError]  adapter's details.nestErrorDetails — one adapter
 *   (false/undefined) puts `details` at envelope root, another (true) nests it inside
 *   `error.details` (a known pre-existing divergence between adapters, preserved as-is)
 * @param {Array} [opts.knownViolations]  adapter's knownViolations allowlist
 */
export function emitError(errorCatalog, code, opts = {}) {
  const cat = errorCatalog[code];
  if (!cat) {
    emit(
      {
        error: {
          code: 'CCP-INVALID-001',
          message: `Unknown error code: ${code}`,
          action: 'This is an internal bug. Please report it as an issue.',
          recovery: 'abort',
        },
        exit_code: 1,
      },
      opts.knownViolations
    );
    process.exit(1);
  }
  const merged = {
    code,
    message: opts.message ?? cat.message,
    action: opts.action ?? cat.action,
    recovery: cat.recovery,
  };
  const detailsPayload =
    opts.details && typeof opts.details === 'object'
      ? opts.sanitize === false
        ? opts.details
        : sanitizeDetails(opts.details, opts.allowKeys || [])
      : null;
  if (detailsPayload && opts.nestDetailsInError) merged.details = detailsPayload;
  const env = { error: merged, exit_code: 1 };
  if (detailsPayload && !opts.nestDetailsInError) env.details = detailsPayload;
  emit(env, opts.knownViolations);
  process.exit(1);
}
