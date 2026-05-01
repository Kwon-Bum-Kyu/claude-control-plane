// CCP — envelope 6키 self-validator (B1-S2-2)
// schemas/envelope.schema.json 의 핵심 제약을 zero-deps 로 강제한다.
// 양 companion (gemini/codex) 출력 직전 호출되어 SSOT 위반 시 throw.
//
// 검사 항목 (audit cross-check 가능):
//  - oneOf success | error
//  - success: summary ≤ 500자, exit_code === 0, tokens {input, output} 필수
//  - error: code 패턴 ^CCP-[A-Z]+-\d{3}$, recovery enum, exit_code ≥ 1
//  - details.mode enum [gemini, codex] (있을 때만)

const ERROR_CODE_RE = /^CCP-[A-Z]+-\d{3}$/;
const RECOVERY_ENUM = new Set(['retry', 'fallback_claude', 'abort', 'user_action_required']);
const MODE_ENUM = new Set(['gemini', 'codex']);
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
      if (typeof e.message_ko !== 'string' || e.message_ko.length === 0) {
        errors.push('error.message_ko required');
      }
      if (typeof e.action_ko !== 'string' || e.action_ko.length === 0) {
        errors.push('error.action_ko required');
      }
      if (!RECOVERY_ENUM.has(e.recovery)) {
        errors.push(`error.recovery "${e.recovery}" not in enum`);
      }
    }
    if (typeof env.exit_code === 'number' && env.exit_code < 1) {
      errors.push('error envelope requires exit_code ≥ 1');
    }
  }

  if (env.details !== undefined) {
    if (!env.details || typeof env.details !== 'object') {
      errors.push('details must be object when present');
    } else if (env.details.mode !== undefined && !MODE_ENUM.has(env.details.mode)) {
      errors.push(`details.mode "${env.details.mode}" not in [gemini, codex]`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 출력 직전 강제 검증. 위반 시 stderr 경고 + 그대로 emit (개발 단계 차단 회피).
 * 환경변수 CCP_ENVELOPE_STRICT=1 일 때는 throw.
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
