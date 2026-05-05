// CCP Router — 3-way routing decision logic (Claude / Gemini / Codex)
// Spec: plugins/ccp/skills/router/SKILL.md §"4-axis decision algorithm"
//
// hooks/router-suggest.js imports this module to inject a recommendation as
// system reminder on UserPromptSubmit. Headless auto-delegation is NOT
// performed (no automatic fallback for delegated calls).
//
// Dictionary policy:
//   - English keyword dictionaries are primary, Korean kept as auxiliary
//   - omc magic-keywords primitives integrated for false-positive suppression:
//     * removeCodeBlocks: skip keywords inside ``` ... ``` and `...` blocks
//     * hasActionableTrigger: word-boundary matching + informational intent skip
//   - KW_MAIN_CONTEXT_BIND extended with English variants

import {
  removeCodeBlocks,
  hasActionableTrigger,
  isInformationalKeywordContext,
} from './magic-keywords.mjs';

// English-primary dictionaries (Korean kept as auxiliary for 1st persona).
const KW_GEMINI = [
  // English (primary) — large-context summarization & directory-wide analysis
  'summarize', 'summary', 'review codebase', 'review the entire',
  'whole directory', 'whole codebase', 'whole repo', 'whole project',
  'entire directory', 'entire codebase', 'entire repository', 'monorepo',
  'parse large log', 'log analysis', 'all markdown', 'all includes',
  'fifty files', '50 files', 'all APIs',
  // Korean (auxiliary)
  '요약', '전체 검토', '이 디렉토리', '전체 코드베이스', '전체 레포', '전체 프로젝트',
  '대용량 로그 파싱', '로그 분석', '디렉토리 전체', '모노레포', '코드베이스',
  '모든 마크다운', '모든 include', '파일 50개', '전체 API',
];

const KW_CODEX = [
  // English (primary) — code review, bug investigation, diff analysis
  'review code', 'code review', 'review this PR', 'review the PR',
  'audit diff', 'audit this diff', 'review the diff',
  'find the bug', 'find a bug', 'investigate the bug', 'investigate this bug',
  'refactoring proposal', 'large refactor proposal', 'code quality',
  // Korean (auxiliary)
  '코드 리뷰', '리뷰', 'PR 검토', 'diff 검토', '버그 조사', '버그 찾아줘',
  '리팩터링 제안', '코드 품질',
];

const KW_CLAUDE = [
  // English (primary) — small edits, single-line changes, type/test additions
  'edit', 'fix this line', 'rename this variable', 'add a comment',
  'add a test', 'add type', 'add types', 'autofix', 'TODO comment',
  'error message', 'three differences',
  // Korean (auxiliary)
  '추가해줘', '수정', '리팩터', '한 줄 변경', '이 함수만', '체크아웃',
  '테스트 작성', '타입 추가', '주석 보강', '추가', '작성해줘',
  '방금', '위에서', '이전 응답', '실행한 명령',
  'TODO 주석', '에러 메시지', '차이는', '차이 3가지',
];

// Main-context-bind keywords — English (primary) + Korean (auxiliary).
// These force `claude` regardless of other matches because the input
// references the main Claude context (delegating would break continuity).
const KW_MAIN_CONTEXT_BIND = [
  // English (primary)
  'just now', 'just edited', 'just wrote', 'just ran',
  'above', 'previous response', 'previous output', 'last command',
  // Korean (auxiliary)
  '방금', '위에서', '이전 응답', '실행한 명령',
];

// Magic keywords (axis A, user-explicit, same priority as slash commands).
// Korean-first design with English duals. omc magic-keywords pattern: prefix
// + alias forms. Use removeCodeBlocks-stripped text for matching to avoid
// false positives inside code fences.
const KW_MAGIC_GEMINI = ['@gemini', '@젬', '@제미니'];
const KW_MAGIC_CODEX = ['@codex', '@코덱', '@코덱스'];
const KW_MAGIC_CLAUDE = ['@claude', '@클', '@클로드'];
const KW_MAGIC_AUTO = ['@auto', '@자동']; // not a target — triggers default 4-axis classification

function findMagicKeyword(text, dict) {
  for (const kw of dict) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

const TARGETS = Object.freeze(['claude', 'gemini', 'codex']);

function estimateTokens(text) {
  return Math.ceil(String(text || '').trim().split(/\s+/).filter(Boolean).length * 1.3);
}

function classify(input, opts = {}) {
  const text = String(input || '');
  const explicitTokens = opts.estimated_tokens;

  // A — User explicit (highest priority)
  if (/\/ccp:codex-rescue\b/.test(text) && !/--fallback-claude/.test(text)) {
    return { target: 'codex', axis: 'A', reason: 'user_explicit_codex' };
  }
  if (/\/gemini:rescue\b/.test(text) && !/--fallback-claude/.test(text)) {
    return { target: 'gemini', axis: 'A', reason: 'user_explicit_gemini' };
  }
  if (/--fallback-claude\b/.test(text) || /--force-claude\b/.test(text)) {
    return { target: 'claude', axis: 'A', reason: 'user_explicit_claude' };
  }
  if (/--effort\b|--sandbox\s+workspace-write\b/.test(text)) {
    return { target: 'codex', axis: 'A', reason: 'user_explicit_codex_option' };
  }

  // Strip code blocks before keyword matching (false-positive guard).
  // User-explicit signals above are checked on raw text because slash commands
  // and CLI flags must not be obscured by code fences.
  const stripped = removeCodeBlocks(text);

  // A — Magic keyword (axis A, same priority as slash).
  // Checked AFTER removeCodeBlocks so magic keywords inside code fences are
  // ignored (false positive guard, identical to keyword-axis behavior).
  // `@auto` is a marker — it does not force a target, but signals user intent
  // to use the 4-axis classifier (B/C/D). It does not override anything.
  const magicGemini = findMagicKeyword(stripped, KW_MAGIC_GEMINI);
  if (magicGemini) {
    return { target: 'gemini', axis: 'A', reason: 'user_explicit_gemini_magic', matched: [magicGemini] };
  }
  const magicCodex = findMagicKeyword(stripped, KW_MAGIC_CODEX);
  if (magicCodex) {
    return { target: 'codex', axis: 'A', reason: 'user_explicit_codex_magic', matched: [magicCodex] };
  }
  const magicClaude = findMagicKeyword(stripped, KW_MAGIC_CLAUDE);
  if (magicClaude) {
    return { target: 'claude', axis: 'A', reason: 'user_explicit_claude_magic', matched: [magicClaude] };
  }
  // `@auto` falls through to B/C/D — explicit signal that user wants
  // automatic classification but does not pin the decision.

  // B — Input size
  const tokens = explicitTokens ?? estimateTokens(text);
  if (tokens > 30000) {
    const matchedX = matchKeywords(stripped, KW_CODEX);
    if (matchedX.length > 0) {
      return { target: 'codex', axis: 'B', reason: 'mid_review_codex_oversized', tokens, matched: matchedX };
    }
    return { target: 'gemini', axis: 'B', reason: 'too_large', tokens };
  }
  if (tokens >= 5000 && tokens <= 30000) {
    const matchedX = matchKeywords(stripped, KW_CODEX);
    if (matchedX.length > 0) {
      return { target: 'codex', axis: 'B', reason: 'mid_review_codex', tokens, matched: matchedX };
    }
  }

  return classifyByKeyword(stripped, tokens);
}

// Keyword matching with omc word-boundary + informational-intent guard.
// For ASCII-only triggers (English) we use hasActionableTrigger which respects
// `\b` word boundaries and skips informational contexts (e.g. "review가 뭐야?").
// For non-ASCII triggers (Korean) `\b` is unreliable, so we fall back to
// substring matching but still apply informational-intent skip via the
// stripped text passed to the caller.
function matchKeywords(text, dict) {
  const matched = [];
  for (const kw of dict) {
    if (isAsciiTrigger(kw)) {
      if (hasActionableTrigger(text, kw)) matched.push(kw);
    } else {
      // For non-ASCII (e.g. Korean) triggers, `\b` is unreliable, so we use
      // substring match but apply the omc informational-intent guard manually.
      const idx = text.indexOf(kw);
      if (idx >= 0 && !isInformationalKeywordContext(text, idx, kw.length)) {
        matched.push(kw);
      }
    }
  }
  return matched;
}

function isAsciiTrigger(s) {
  return /^[\x20-\x7E]+$/.test(s);
}

function classifyByKeyword(text, tokens) {
  const matchedG = matchKeywords(text, KW_GEMINI);
  const matchedX = matchKeywords(text, KW_CODEX);
  const matchedC = matchKeywords(text, KW_CLAUDE);
  const matchedBind = matchKeywords(text, KW_MAIN_CONTEXT_BIND);
  const hits = {
    gemini: matchedG.length,
    codex: matchedX.length,
    claude: matchedC.length,
    bind: matchedBind.length,
  };

  if (matchedBind.length > 0) {
    return { target: 'claude', axis: 'C', reason: 'main_context_bind', matched: matchedBind, hits };
  }

  if (matchedX.length > 0 && matchedG.length === 0 && matchedC.length === 0) {
    return { target: 'codex', axis: 'C', reason: 'keyword_codex', matched: matchedX };
  }
  if (matchedG.length > 0 && matchedX.length === 0 && matchedC.length === 0) {
    return { target: 'gemini', axis: 'C', reason: 'keyword_gemini', matched: matchedG };
  }
  if (matchedC.length > 0 && matchedX.length === 0 && matchedG.length === 0) {
    return { target: 'claude', axis: 'C', reason: 'keyword_claude', matched: matchedC };
  }

  // Multiple matches — priority codex > gemini > claude
  if (matchedX.length > 0) {
    return { target: 'codex', axis: 'C', reason: 'keyword_codex_priority', hits };
  }
  if (matchedG.length > 0) {
    return { target: 'gemini', axis: 'C', reason: 'keyword_gemini_priority', hits };
  }
  if (matchedC.length > 0) {
    return { target: 'claude', axis: 'C', reason: 'keyword_claude_priority', hits };
  }

  // D — fallback
  if (tokens < 5000) return { target: 'claude', axis: 'B', reason: 'too_small', tokens };
  return { target: 'claude', axis: 'D', reason: 'default_conservative', tokens };
}

export {
  classify,
  estimateTokens,
  TARGETS,
  KW_GEMINI, KW_CODEX, KW_CLAUDE, KW_MAIN_CONTEXT_BIND,
  KW_MAGIC_GEMINI, KW_MAGIC_CODEX, KW_MAGIC_CLAUDE, KW_MAGIC_AUTO,
};
