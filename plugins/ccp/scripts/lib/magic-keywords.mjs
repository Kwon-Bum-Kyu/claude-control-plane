const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

/** Remove code blocks from text for keyword detection */
function removeCodeBlocks(text) {
  return text.replace(CODE_BLOCK_PATTERN, '').replace(INLINE_CODE_PATTERN, '');
}

const INFORMATIONAL_INTENT_PATTERNS = [
  /\b(?:what(?:'s|\s+is)|what\s+are|how\s+(?:to|do\s+i)\s+use|explain|explanation|tell\s+me\s+about|describe)\b/i,
  /(?:뭐야|무엇(?:이야|인가요)?|어떻게|설명|사용법)/u,
  /(?:とは|って何|使い方|説明)/u,
  /(?:什么是|什麼是|怎(?:么|樣)用|如何使用|解释|說明|说明)/u,
];

const INFORMATIONAL_CONTEXT_WINDOW = 80;

function isInformationalKeywordContext(text, position, keywordLength) {
  const start = Math.max(0, position - INFORMATIONAL_CONTEXT_WINDOW);
  const end = Math.min(text.length, position + keywordLength + INFORMATIONAL_CONTEXT_WINDOW);
  const context = text.slice(start, end);
  return INFORMATIONAL_INTENT_PATTERNS.some((pattern) => pattern.test(context));
}

/** Escape regex metacharacters so a string matches literally inside new RegExp(). */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasActionableTrigger(text, trigger) {
  const pattern = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, 'gi');

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    if (isInformationalKeywordContext(text, match.index, match[0].length)) {
      continue;
    }

    return true;
  }

  return false;
}

export {
  removeCodeBlocks,
  escapeRegExp,
  hasActionableTrigger,
  isInformationalKeywordContext,
  INFORMATIONAL_INTENT_PATTERNS,
  INFORMATIONAL_CONTEXT_WINDOW,
};
