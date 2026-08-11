// CCP — summary clamp + context budget check (CLI-neutral)
// The token *estimation formula* differs per CLI (chars×0.25 vs words×1.3),
// so it stays adapter-owned (`estimateTokens`). This module only owns the
// shared clamp/threshold mechanics.

const DEFAULT_SUMMARY_MAX_CHARS = 500;

/**
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string}
 */
export function clampSummary(text, maxChars = DEFAULT_SUMMARY_MAX_CHARS) {
  const s = typeof text === 'string' ? text : '';
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 16) + '...(truncated)';
}

/**
 * @param {string} text
 * @param {object} opts
 * @param {(text: string) => number} opts.estimateTokens  adapter-supplied estimator
 * @param {number} opts.tokenCap
 * @param {number} [opts.maxChars]
 * @returns {{ violated: boolean, estimatedTokens: number, lengthChars: number }}
 */
export function checkContextBudget(text, { estimateTokens, tokenCap, maxChars = DEFAULT_SUMMARY_MAX_CHARS }) {
  const s = typeof text === 'string' ? text : '';
  const estimatedTokens = estimateTokens(s);
  const violated = estimatedTokens > tokenCap || s.length > maxChars;
  return { violated, estimatedTokens, lengthChars: s.length };
}

export { DEFAULT_SUMMARY_MAX_CHARS };
