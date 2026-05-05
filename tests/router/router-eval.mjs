#!/usr/bin/env node
// CCP router accuracy regression — 70-case 3-way classifier.
//
// The 4-axis algorithm specified in plugins/ccp/skills/router/SKILL.md is
// mirrored by plugins/ccp/scripts/lib/router.mjs. This script and
// plugins/ccp/hooks/router-suggest.js both import that single module.
//
// Dataset composition: claude / gemini / codex labels, boundary cases, and
// false-positive guards (code-block keywords, informational questions,
// English actionable keywords).

import { classify, TARGETS } from '../../plugins/ccp/scripts/lib/router.mjs';

const DATASET = [
  // C01~C16 — Claude 정답
  { id: 'C01', input: 'src/utils/format.ts의 formatDate 함수에 null 체크를 추가해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C02', input: '이 함수의 테스트를 Vitest로 작성해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C03', input: 'TypeScript에서 Readonly<T>와 const assertion의 차이는?', expected: 'claude', deciding_axis_expected: 'B' },
  { id: 'C04', input: 'package.json의 dependencies에 zod 4.0.0을 추가해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C05', input: '현재 브랜치 이름을 알려주고 main으로 체크아웃해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C06', input: '이 에러 메시지 "Cannot find module \'foo\'" 어떻게 고치지?', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C07', input: 'README.md에 설치 섹션을 추가해줘. 한국어로.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C08', input: '방금 수정한 코드 리뷰해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C09', input: 'const x = 1 + 1; 이 코드의 타입은?', expected: 'claude', deciding_axis_expected: 'B' },
  { id: 'C10', input: 'zod 스키마로 email 필드 검증을 추가해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C11', input: '이 PR의 제목과 설명을 draft로 작성해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C12', input: 'git log --oneline -10 보여줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C13', input: '방금 실행한 명령 왜 실패했지?', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C14', input: 'async/await와 Promise.then()의 차이 3가지만.', expected: 'claude', deciding_axis_expected: 'B' },
  { id: 'C15', input: '이 파일에서 TODO 주석 찾아서 리스트로 보여줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'C16', input: 'eslint 에러 전부 autofix로 고쳐줘.', expected: 'claude', deciding_axis_expected: 'C' },

  // G01~G15 — Gemini-favoured (G09 is codex-favoured: large diff review)
  { id: 'G01', input: '/gemini:rescue "이 디렉토리(src/**/*.ts, 12k LOC) 아키텍처 요약"', expected: 'gemini', deciding_axis_expected: 'A' },
  { id: 'G02', input: '/gemini:rescue --background "logs/production.log 15MB에서 ERROR 빈도 상위 10"', expected: 'gemini', deciding_axis_expected: 'A' },
  { id: 'G03', input: '이 전체 레포지토리를 3줄로 요약해줘.', expected: 'gemini', deciding_axis_expected: 'C', estimated_tokens: 80000 },
  { id: 'G04', input: 'docs/ 아래 모든 마크다운 읽고 공통 개념 10개 뽑아줘.', expected: 'gemini', deciding_axis_expected: 'C', estimated_tokens: 60000 },
  { id: 'G05', input: '이 디렉토리의 테스트 커버리지 현황 요약.', expected: 'gemini', deciding_axis_expected: 'C' },
  { id: 'G06', input: '대용량 로그 파싱: access.log 500MB에서 상위 엔드포인트 100개', expected: 'gemini', deciding_axis_expected: 'C' },
  { id: 'G07', input: '/gemini:rescue "이 모노레포의 패키지 의존성 그래프 요약"', expected: 'gemini', deciding_axis_expected: 'A' },
  { id: 'G08', input: 'node_modules 제외한 전체 프로젝트를 읽고 보안 리스크 식별해줘.', expected: 'gemini', deciding_axis_expected: 'C', estimated_tokens: 100000 },
  { id: 'G09', input: '이 PR의 diff 10,000줄 전체를 리뷰해줘.', expected: 'codex', deciding_axis_expected: 'B', estimated_tokens: 50000 },
  { id: 'G10', input: '프로젝트 전체 코드베이스에서 unused export 목록 뽑아줘.', expected: 'gemini', deciding_axis_expected: 'C' },
  { id: 'G11', input: '/gemini:rescue "이 10GB 데이터셋 CSV의 컬럼 스키마 요약"', expected: 'gemini', deciding_axis_expected: 'A' },
  { id: 'G12', input: '이 라이선스 파일 50개(LICENSE, COPYING 등) 모두 분석해서 호환성 표 만들어줘.', expected: 'gemini', deciding_axis_expected: 'C' },
  { id: 'G13', input: 'tsconfig.json부터 시작해서 모든 include 대상 파일 트리 요약.', expected: 'gemini', deciding_axis_expected: 'C' },
  { id: 'G14', input: '이 전체 API 문서(spec.yaml 8000줄)에서 breaking changes 식별해줘.', expected: 'gemini', deciding_axis_expected: 'B', estimated_tokens: 40000 },
  { id: 'G15', input: '이 디렉토리 전체를 읽고 아키텍처 다이어그램용 ASCII 트리 생성.', expected: 'gemini', deciding_axis_expected: 'C' },

  // B01~B05 — boundary cases (alt_label permitted)
  { id: 'B01', input: 'src/ 하위 3개 파일(총 200 LOC) 읽고 공통 패턴 찾아줘.', expected: 'claude', alt_label: 'gemini' },
  { id: 'B02', input: '이 README(~2000 words) 읽고 3줄 요약.', expected: 'claude', alt_label: 'gemini' },
  { id: 'B03', input: '이 파일(500 LOC) 리팩터링 계획 세워줘.', expected: 'claude', alt_label: 'gemini' },
  { id: 'B04', input: '개발 문서 5개(각 300 words) 읽고 일관성 검사.', expected: 'claude', alt_label: 'gemini' },
  { id: 'B05', input: '이 테스트 파일(1000 LOC)의 중복 테스트 식별.', expected: 'claude', alt_label: 'codex' },

  // X01~X14 — Codex-favoured cases (slash + option + mid_review_codex + multi-keyword)
  // X01~X03 axis A user_explicit_codex (slash) / X04~X05 axis A user_explicit_codex_option
  { id: 'X01', input: '/ccp:codex-rescue "src/auth/session.ts 코드 리뷰"', expected: 'codex', deciding_axis_expected: 'A' },
  { id: 'X02', input: '/ccp:codex-rescue --background "feature/payment 브랜치 PR 검토"', expected: 'codex', deciding_axis_expected: 'A' },
  { id: 'X03', input: '/ccp:codex-rescue "audit diff for security issues in lib/crypto"', expected: 'codex', deciding_axis_expected: 'A' },
  { id: 'X04', input: 'codex --effort high 로 이 모듈의 race condition 살펴봐 줘.', expected: 'codex', deciding_axis_expected: 'A' },
  { id: 'X05', input: '--sandbox workspace-write 모드로 마이그레이션 스크립트 점검 부탁해.', expected: 'codex', deciding_axis_expected: 'A' },
  // X06~X09 axis B mid_review_codex (5K~30K + review/PR/diff/버그조사 키워드)
  { id: 'X06', input: '이 PR diff 검토 (3,500 LOC) — 변경 의도와 잠재 버그를 짚어줘.', expected: 'codex', deciding_axis_expected: 'B', estimated_tokens: 12000 },
  { id: 'X07', input: '중간 크기 모듈(8000 LOC)의 버그 조사 부탁해. core/scheduler 쪽이야.', expected: 'codex', deciding_axis_expected: 'B', estimated_tokens: 18000 },
  { id: 'X08', input: '이 feature 브랜치의 diff 검토를 진행해줘. 안전성 위주로.', expected: 'codex', deciding_axis_expected: 'B', estimated_tokens: 22000 },
  { id: 'X09', input: 'services/payment 모듈 코드 품질 점검 (~6000 LOC).', expected: 'codex', deciding_axis_expected: 'B', estimated_tokens: 15000 },
  // X10~X12 axis C keyword_codex (small + 단일 codex 키워드)
  { id: 'X10', input: 'services/billing.ts 코드 리뷰 부탁드려요.', expected: 'codex', deciding_axis_expected: 'C' },
  { id: 'X11', input: '이 클래스의 버그 조사 진행 가능?', expected: 'codex', deciding_axis_expected: 'C' },
  { id: 'X12', input: '다음 patch 의 PR 검토만 빠르게 도와줘.', expected: 'codex', deciding_axis_expected: 'C' },
  // X13~X14 axis C keyword_codex_priority (codex + gemini 다중 매칭)
  { id: 'X13', input: '이 디렉토리의 결제 모듈을 코드 리뷰해줘.', expected: 'codex', deciding_axis_expected: 'C' },
  { id: 'X14', input: '전체 레포의 PR 검토 도와줘. 위험 변경 위주로.', expected: 'codex', deciding_axis_expected: 'C' },

  // F01~F05 — 코드 블록 안 키워드 false positive 가드 (removeCodeBlocks)
  // 사용자 의도는 코드 안 텍스트 매칭이 아니므로 정답은 claude 또는 의도 모델
  { id: 'F01', input: '이 함수 한 줄만 수정해줘:\n```js\n// review the previous output\nconst x = 1;\n```', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F02', input: '아래 한 줄 추가해줘:\n```py\ndef review(): pass  # 리뷰 함수 정의\n```', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F03', input: 'git status 결과를 알려줘. `find the bug` 라는 문자열은 무시해도 돼.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F04', input: '`code review` 라는 단어를 README에 추가해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F05', input: '아래 코드의 변수명만 바꿔줘:\n```ts\nconst review = "PR 검토";\n```', expected: 'claude', deciding_axis_expected: 'C' },

  // F06~F10 — 정보성 질문 false positive 가드 (INFORMATIONAL_INTENT_PATTERNS)
  // 키워드가 매칭되어도 informational context 안이면 claude
  { id: 'F06', input: '코드 리뷰가 뭐야?', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F07', input: 'what is code review and how to do it?', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F08', input: 'PR 검토 방법 설명해줘.', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F09', input: 'explain code audit process briefly', expected: 'claude', deciding_axis_expected: 'C' },
  { id: 'F10', input: '버그 조사가 뭐야? 사용법도 같이.', expected: 'claude', deciding_axis_expected: 'C' },

  // F11~F15 — English actionable keywords (English dictionary coverage)
  { id: 'F11', input: 'review this PR carefully and flag risky changes', expected: 'codex', deciding_axis_expected: 'C' },
  { id: 'F12', input: 'find the bug in src/main.go that causes the panic', expected: 'codex', deciding_axis_expected: 'C' },
  { id: 'F13', input: 'audit this diff for security issues', expected: 'codex', deciding_axis_expected: 'C' },
  { id: 'F14', input: 'summarize the entire codebase under src/', expected: 'gemini', deciding_axis_expected: 'C' },
  { id: 'F15', input: 'just edit this single line in config.ts', expected: 'claude', deciding_axis_expected: 'C' },

  // F16~F20 — magic keywords (Korean + English duals). axis A user-explicit (same priority as slash).
  { id: 'F16', input: '@젬 이 디렉토리 전체 정리해줘', expected: 'gemini', deciding_axis_expected: 'A' },
  { id: 'F17', input: '@코덱 이 PR 검토 부탁', expected: 'codex', deciding_axis_expected: 'A' },
  { id: 'F18', input: '@claude 방금 수정한 함수 다시 봐줘', expected: 'claude', deciding_axis_expected: 'A' },
  { id: 'F19', input: '@gemini summarize the README', expected: 'gemini', deciding_axis_expected: 'A' },
  // F20 — 매직 키워드가 코드 블록 안에 있으면 false positive 차단 (axis A 미발동)
  { id: 'F20', input: '아래 코드 한 줄 수정\n```\n// @젬 example here\n```\nconfig.ts 의 첫 줄 변경', expected: 'claude', deciding_axis_expected: 'C' },
];

// 채점
const rows = DATASET.map((c) => {
  const pred = classify(c.input, { estimated_tokens: c.estimated_tokens });
  const exact = pred.target === c.expected;
  const altOk = c.alt_label && pred.target === c.alt_label;
  const correct = exact || altOk;
  const axisHit = c.deciding_axis_expected ? pred.axis === c.deciding_axis_expected : null;
  return { ...c, pred, correct, exact, altOk, axisHit };
});

const total = rows.length;
const correctTotal = rows.filter((r) => r.correct).length;
const clear = rows.filter((r) => r.id.startsWith('C') || r.id.startsWith('G') || r.id.startsWith('X'));
const correctClear = clear.filter((r) => r.exact).length;
const boundary = rows.filter((r) => r.id.startsWith('B'));
const correctBoundary = boundary.filter((r) => r.correct).length;
const falsePositiveGuard = rows.filter((r) => r.id.startsWith('F'));
const correctFP = falsePositiveGuard.filter((r) => r.exact).length;

// 3-way 혼동행렬 (TARGETS 는 lib/router.mjs export 사용)
const matrix = {};
for (const a of TARGETS) {
  matrix[a] = {};
  for (const b of TARGETS) matrix[a][b] = 0;
}
for (const r of rows) matrix[r.expected][r.pred.target] += 1;

function precRecall(target) {
  const tp = matrix[target][target];
  const fp = TARGETS.filter((t) => t !== target).reduce((s, t) => s + matrix[t][target], 0);
  const fn = TARGETS.filter((t) => t !== target).reduce((s, t) => s + matrix[target][t], 0);
  const p = tp / (tp + fp || 1);
  const r = tp / (tp + fn || 1);
  return { tp, fp, fn, precision: p, recall: r };
}

const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;

console.log('# CCP router accuracy regression — 3-way result\n');
console.log('## 1. 케이스별 결과\n');
console.log('| ID | 정답 | 예측 | 결정축 | 축일치 | 정답여부 | reason |');
console.log('|----|:----:|:----:|:------:|:------:|:--------:|--------|');
for (const r of rows) {
  const axisCmp = r.axisHit === null ? '-' : (r.axisHit ? '✅' : '❌');
  const ok = r.correct ? '✅' : '❌';
  const altMark = r.altOk && !r.exact ? ' (alt)' : '';
  console.log(`| ${r.id} | ${r.expected} | ${r.pred.target}${altMark} | ${r.pred.axis} | ${axisCmp} | ${ok} | ${r.pred.reason} |`);
}

console.log('\n## 2. 합격 기준 매트릭스\n');
console.log('| 지표 | 측정 | 합격선 | 결과 |');
console.log('|------|:----:|:------:|:----:|');
console.log(`| 전체 정확도 | ${correctTotal}/${total} = ${fmtPct(correctTotal/total)} | ≥ 80% | ${correctTotal/total >= 0.80 ? '✅' : '❌'} |`);
console.log(`| 명확 케이스 정확도 (C+G, exact) | ${correctClear}/${clear.length} = ${fmtPct(correctClear/clear.length)} | ≥ 90% | ${correctClear/clear.length >= 0.90 ? '✅' : '❌'} |`);
console.log(`| 경계 케이스 정확도 (B, alt 허용) | ${correctBoundary}/${boundary.length} = ${fmtPct(correctBoundary/boundary.length)} | ≥ 60% | ${correctBoundary/boundary.length >= 0.60 ? '✅' : '❌'} |`);
console.log(`| False positive 가드 (F, exact) | ${correctFP}/${falsePositiveGuard.length} = ${fmtPct(correctFP/falsePositiveGuard.length)} | 100% | ${correctFP === falsePositiveGuard.length ? '✅' : '❌'} |`);
for (const t of TARGETS) {
  const pr = precRecall(t);
  console.log(`| ${t} Precision | ${pr.precision.toFixed(3)} (TP=${pr.tp}, FP=${pr.fp}) | ≥ 0.75 | ${pr.precision >= 0.75 ? '✅' : '❌'} |`);
  console.log(`| ${t} Recall    | ${pr.recall.toFixed(3)} (TP=${pr.tp}, FN=${pr.fn}) | ≥ 0.75 | ${pr.recall >= 0.75 ? '✅' : '❌'} |`);
}

console.log('\n## 3. 혼동 행렬 (3×3)\n');
console.log('|              | 예측 claude | 예측 gemini | 예측 codex |');
console.log('|--------------|:-----------:|:-----------:|:----------:|');
for (const a of TARGETS) {
  console.log(`| 실제 ${a.padEnd(7)} | ${matrix[a].claude} | ${matrix[a].gemini} | ${matrix[a].codex} |`);
}

const failed = rows.filter((r) => !r.correct);
console.log(`\n## 4. 오분류 케이스 (${failed.length}건)\n`);
if (failed.length === 0) console.log('없음.');
else for (const r of failed) console.log(`- ${r.id} 정답=${r.expected} 예측=${r.pred.target} (axis ${r.pred.axis}, ${r.pred.reason})`);

const allPass =
  correctTotal/total >= 0.80 &&
  correctClear/clear.length >= 0.90 &&
  correctBoundary/boundary.length >= 0.60 &&
  TARGETS.every((t) => {
    const pr = precRecall(t);
    return pr.precision >= 0.75 && pr.recall >= 0.75;
  });
console.log(`\n**Verdict: ${allPass ? '✅ PASS' : '❌ FAIL'}**`);
process.exit(allPass ? 0 : 1);
