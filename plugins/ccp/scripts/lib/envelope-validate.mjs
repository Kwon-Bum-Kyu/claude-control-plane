// CCP — envelope 6-key self-validator
// Enforces the core constraints from schemas/envelope.schema.json with zero deps.
// Both companions (gemini / codex) call this just before stdout emit; SSOT
// violations cause a stderr warning (or throw under CCP_ENVELOPE_STRICT=1).
//
// Checks (cross-checkable by audit):
//   - oneOf success | error
//   - success: summary ≤ 500 chars, exit_code === 0, tokens {input, output} required
//   - error: code matches ^CCP-[A-Z]+-\d{3}$, recovery enum, exit_code ≥ 1
//   - details.mode enum [gemini, codex, router] (when present)
//   - auto_routed (when present): boolean only — auto-delegation consistency check
//   - details.reason_code (when mode=router): enum only — runtime defense

const ERROR_CODE_RE = /^CCP-[A-Z]+-\d{3}$/;
const RECOVERY_ENUM = new Set(['retry', 'fallback_claude', 'abort', 'user_action_required']);
const MODE_ENUM = new Set(['gemini', 'codex', 'router']);
const ROUTER_REASON_CODE_ENUM = new Set([
  'AXIS_A_SLASH',
  'AXIS_A_OPTION',
  'AXIS_A_FALLBACK_CLAUDE',
  'AXIS_B_OVERSIZED',
  'AXIS_B_MID_REVIEW',
  'AXIS_B_TOO_SMALL',
  'AXIS_C_KW_GEMINI',
  'AXIS_C_KW_CODEX',
  'AXIS_C_KW_CLAUDE',
  'AXIS_C_MAIN_CONTEXT_BIND',
  'AXIS_D_DEFAULT_CONSERVATIVE',
  'OPT_OUT_NO_AUTO_ROUTE',
]);
const ROUTER_DECISION_ENUM = new Set(['claude', 'gemini', 'codex']);
const ROUTER_AXIS_ENUM = new Set(['A', 'B', 'C', 'D']);
const SUMMARY_MAX = 500;

/**
 * @param {object} env
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEnvelope(env) {
  const errors = [];
  if (!env || typeof env !== 'object') {
    return { valid: false, errors: ['envelope is not an object'] };
  }
  const isError = 'error' in env;
  const isSuccess = 'summary' in env;
  if (isError && isSuccess) errors.push('envelope must be either success or error, not both');
  if (!isError && !isSuccess) errors.push('envelope missing summary (success) or error (error)');

  if (typeof env.exit_code !== 'number' || !Number.isInteger(env.exit_code)) {
    errors.push('exit_code must be integer');
  }

  if (isSuccess) {
    if (typeof env.summary !== 'string') errors.push('summary must be string');
    else if (env.summary.length > SUMMARY_MAX) {
      errors.push(`summary length ${env.summary.length} > ${SUMMARY_MAX}`);
    }
    if (env.exit_code !== 0) errors.push('success envelope requires exit_code === 0');
    if (!env.tokens || typeof env.tokens !== 'object') {
      errors.push('tokens object required');
    } else {
      for (const k of ['input', 'output']) {
        if (typeof env.tokens[k] !== 'number' || env.tokens[k] < 0) {
          errors.push(`tokens.${k} must be non-negative number`);
        }
      }
      for (const k of ['cached', 'total']) {
        if (env.tokens[k] !== undefined && (typeof env.tokens[k] !== 'number' || env.tokens[k] < 0)) {
          errors.push(`tokens.${k} must be non-negative number when present`);
        }
      }
    }
  }

  if (isError) {
    const e = env.error;
    if (!e || typeof e !== 'object') errors.push('error must be object');
    else {
      if (typeof e.code !== 'string' || !ERROR_CODE_RE.test(e.code)) {
        errors.push(`error.code "${e.code}" does not match ${ERROR_CODE_RE}`);
      }
      if (typeof e.message !== 'string' || e.message.length === 0) {
        errors.push('error.message required');
      }
      if (typeof e.action !== 'string' || e.action.length === 0) {
        errors.push('error.action required');
      }
      if (!RECOVERY_ENUM.has(e.recovery)) {
        errors.push(`error.recovery "${e.recovery}" not in enum`);
      }
    }
    if (typeof env.exit_code === 'number' && env.exit_code < 1) {
      errors.push('error envelope requires exit_code ≥ 1');
    }
  }

  if (env.auto_routed !== undefined && typeof env.auto_routed !== 'boolean') {
    errors.push(`auto_routed "${env.auto_routed}" must be boolean`);
  }

  if (env.details !== undefined) {
    if (!env.details || typeof env.details !== 'object') {
      errors.push('details must be object when present');
    } else if (env.details.mode !== undefined && !MODE_ENUM.has(env.details.mode)) {
      errors.push(`details.mode "${env.details.mode}" not in [gemini, codex, router]`);
    } else if (env.details.mode === 'router') {
      // Router branch — enum-only, no free text (runtime defense).
      if (env.details.decision !== undefined && !ROUTER_DECISION_ENUM.has(env.details.decision)) {
        errors.push(`details.decision "${env.details.decision}" not in [claude, gemini, codex]`);
      }
      if (env.details.axis !== undefined && !ROUTER_AXIS_ENUM.has(env.details.axis)) {
        errors.push(`details.axis "${env.details.axis}" not in [A, B, C, D]`);
      }
      if (env.details.reason_code !== undefined && !ROUTER_REASON_CODE_ENUM.has(env.details.reason_code)) {
        errors.push(`details.reason_code "${env.details.reason_code}" not in router enum`);
      }
      if (env.details.headless_confident !== undefined && typeof env.details.headless_confident !== 'boolean') {
        errors.push(`details.headless_confident must be boolean`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Final-gate validation just before emit. On violation we write to stderr and
 * return the envelope as-is (so we don't block dev workflows). When
 * CCP_ENVELOPE_STRICT=1 is set we throw instead.
 */
export function assertEnvelope(env) {
  const r = validateEnvelope(env);
  if (r.valid) return env;
  const msg = `[envelope-validate] ${r.errors.join('; ')}`;
  if (process.env.CCP_ENVELOPE_STRICT === '1') {
    throw new Error(msg);
  }
  process.stderr.write(msg + '\n');
  return env;
}
