// CCP Router — 3-way 라우팅 결정 로직 (Claude / Gemini / Codex)
// 명세: plugins/ccp/skills/router/SKILL.md §"4축 결정 알고리즘"
// 데이터셋: _workspace/_router_test/EVAL_DATASET.md (50 케이스)
// 평가 진입점: _workspace/_router_test/router-eval.mjs
//
// B19 (Phase 6-A v0.2): hooks/router-suggest.js 가 본 모듈을 import 하여
//   UserPromptSubmit 시 사용자에게 추천 정보를 system reminder 로 주입한다.
//   자동 위임은 수행하지 않는다 (원칙 4 — 자동 fallback 금지).

const KW_GEMINI = [
  '요약', '전체 검토', '이 디렉토리', '전체 코드베이스', '전체 레포', '전체 프로젝트',
  '대용량 로그 파싱', '로그 분석', '디렉토리 전체', '모노레포', '코드베이스',
  '모든 마크다운', '모든 include', '파일 50개', '전체 API',
  'summary', 'review codebase', 'summarize',
];

const KW_CODEX = [
  '코드 리뷰', '리뷰', 'PR 검토', 'diff 검토', '버그 조사', '버그 찾아줘',
  '리팩터링 제안', '코드 품질',
  'review code', 'code review', 'audit diff', 'review this PR',
  'find the bug', 'investigate the bug',
];

const KW_CLAUDE = [
  '추가해줘', '수정', '리팩터', '한 줄 변경', '이 함수만', '체크아웃',
  '테스트 작성', '타입 추가', '주석 보강', '추가', '작성해줘',
  '방금', '위에서', '이전 응답', '실행한 명령',
  'edit', 'fix this line', 'rename this variable',
  'autofix', 'TODO 주석', '에러 메시지', '차이는', '차이 3가지',
];

const KW_MAIN_CONTEXT_BIND = ['방금', '위에서', '이전 응답', '실행한 명령'];

const TARGETS = Object.freeze(['claude', 'gemini', 'codex']);

function estimateTokens(text) {
  return Math.ceil(String(text || '').trim().split(/\s+/).filter(Boolean).length * 1.3);
}

function classify(input, opts = {}) {
  const text = String(input || '');
  const explicitTokens = opts.estimated_tokens;

  // A — 사용자 명시 (최우선)
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

  // B — 입력 크기
  const tokens = explicitTokens ?? estimateTokens(text);
  if (tokens > 30000) {
    const matchedX = KW_CODEX.filter((k) => text.includes(k));
    if (matchedX.length > 0) {
      return { target: 'codex', axis: 'B', reason: 'mid_review_codex_oversized', tokens, matched: matchedX };
    }
    return { target: 'gemini', axis: 'B', reason: 'too_large', tokens };
  }
  if (tokens >= 5000 && tokens <= 30000) {
    const matchedX = KW_CODEX.filter((k) => text.includes(k));
    if (matchedX.length > 0) {
      return { target: 'codex', axis: 'B', reason: 'mid_review_codex', tokens, matched: matchedX };
    }
  }

  return classifyByKeyword(text, tokens);
}

function classifyByKeyword(text, tokens) {
  const matchedG = KW_GEMINI.filter((k) => text.includes(k));
  const matchedX = KW_CODEX.filter((k) => text.includes(k));
  const matchedC = KW_CLAUDE.filter((k) => text.includes(k));
  const matchedBind = KW_MAIN_CONTEXT_BIND.filter((k) => text.includes(k));
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

  // 다중 매칭 — 우선순위 codex > gemini > claude
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

export { classify, estimateTokens, TARGETS, KW_GEMINI, KW_CODEX, KW_CLAUDE, KW_MAIN_CONTEXT_BIND };
