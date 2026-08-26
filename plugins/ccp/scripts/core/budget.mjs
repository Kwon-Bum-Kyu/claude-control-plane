// CCP — summary clamp + context budget check (CLI-neutral)
// The token *estimation formula* differs per CLI (chars×0.25 vs words×1.3),
// so it stays adapter-owned (`estimateTokens`). This module only owns the
// shared clamp/threshold mechanics.

const DEFAULT_SUMMARY_MAX_CHARS = 500;
const TRUNCATION_MARKER = '...(truncated)'; // 14 chars
const SENTENCE_BOUNDARY_MIN_RATIO = 0.6;
// Sentence-terminal characters clampSummaryAtBoundary treats as a cut point
// when immediately followed by whitespace or the end of the candidate slice
// — that trailing-whitespace requirement is what keeps a decimal ("3.14") or
// an abbreviation ("e.g.") from being mistaken for a sentence end.
const SENTENCE_END_CHARS = '.!?…。！？';

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
 * Cuts `text` to at most `maxChars`, preferring a sentence-end boundary
 * inside the budget over a mid-word hard cut. If the latest sentence end in
 * the budget falls before `SENTENCE_BOUNDARY_MIN_RATIO` of it (i.e. cutting
 * there would throw away most of the budget for no reason — a single early
 * terminator in an otherwise unpunctuated block), falls back to the last
 * whitespace boundary instead; with no whitespace either (unbroken long-form
 * text, e.g. Korean without spaces), keeps the hard cut as-is. Returned text
 * is always <= maxChars: `head` never exceeds `budget` chars,
 * `budget + TRUNCATION_MARKER.length === maxChars`, and every step below
 * only shrinks `head`, never grows it.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {{ text: string, truncated: boolean, originalLength: number }}
 */
export function clampSummaryAtBoundary(text, maxChars = DEFAULT_SUMMARY_MAX_CHARS) {
  const s = typeof text === 'string' ? text : '';
  if (s.length <= maxChars) return { text: s, truncated: false, originalLength: s.length };

  const budget = maxChars - TRUNCATION_MARKER.length;
  let head = s.slice(0, budget);

  let cut = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    if (!SENTENCE_END_CHARS.includes(head[i])) continue;
    const next = head[i + 1];
    if (next === undefined || /\s/.test(next)) {
      cut = i + 1;
      break;
    }
  }

  if (cut !== -1 && cut >= Math.floor(budget * SENTENCE_BOUNDARY_MIN_RATIO)) {
    head = head.slice(0, cut);
  } else {
    let lastWhitespace = -1;
    for (let i = head.length - 1; i >= 0; i--) {
      if (/\s/.test(head[i])) {
        lastWhitespace = i;
        break;
      }
    }
    if (lastWhitespace >= 0) head = head.slice(0, lastWhitespace);
    // else: no whitespace at all in the candidate slice — keep the hard cut.
  }

  return { text: head.trimEnd() + TRUNCATION_MARKER, truncated: true, originalLength: s.length };
}

/**
 * NOTE on the token axis: with the two shipped estimators (antigravity's
 * chars×0.25, codex's words×1.3) and the 500-char summary cap, the token
 * axis below cannot fire on its own — reaching tokenCap=1500 needs ~6,000
 * chars for antigravity or ~1,154 words for codex, both far past where the
 * length axis already trips at 500 chars. It stays in the contract (removing
 * it would drop `estimateTokens` to zero callers, shrinking the frozen
 * 52-key adapter contract) but is effectively inert today. Re-evaluate it if
 * `maxChars` grows past ~6,000 or an estimator formula changes.
 * @param {string} text
 * @param {object} opts
 * @param {(text: string) => number} opts.estimateTokens  adapter-supplied estimator
 * @param {number} opts.tokenCap
 * @param {number} [opts.maxChars]
 * @returns {{ exceeded: boolean, estimatedTokens: number, lengthChars: number }}
 */
export function checkContextBudget(text, { estimateTokens, tokenCap, maxChars = DEFAULT_SUMMARY_MAX_CHARS }) {
  const s = typeof text === 'string' ? text : '';
  const estimatedTokens = estimateTokens(s);
  const exceeded = estimatedTokens > tokenCap || s.length > maxChars;
  return { exceeded, estimatedTokens, lengthChars: s.length };
}

export { DEFAULT_SUMMARY_MAX_CHARS };
