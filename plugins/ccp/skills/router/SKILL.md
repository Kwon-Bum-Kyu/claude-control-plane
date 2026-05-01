---
name: router
description: "CCP 모델 라우터 — Claude 본체 vs Gemini vs Codex 3-way 위임 결정 로직. 사용자 명시 > 입력 크기 > 키워드 > fallback 4축 우선순위. /gemini:rescue·/ccp:codex-rescue 호출 결정·라우팅 판단·R3 회피 검토 시 반드시 사용. **v0.2 (B19 RESOLVED): hooks/router-suggest.js UserPromptSubmit 추천 활성, 자동 위임은 미수행**."
---

# CCP Router — 3-way 라우팅 스킬 (Claude / Gemini / Codex)

CCP 메인 Claude 컨텍스트에서 작업 위임 여부를 판정한다. 합격 기준 정확도 ≥ 80% (`_workspace/02_router_accuracy_spec.md` §0.3, AC-2).

**v0.2 적용 범위 (B19 RESOLVED — 2026-05-02, 결정 #4 옵션 C Phase 1):**
- 본 SKILL.md 의 4축 알고리즘은 `plugins/ccp/scripts/lib/router.mjs` 가 코드로 미러링. router-eval 50/50 (100%) 검증 통과.
- **추천 훅 활성**: `hooks/router-suggest.js` 가 UserPromptSubmit 시 결정 결과를 system reminder 로 주입 (`[CCP-ROUTER-001]`). 결정이 `claude` 면 noop.
- **자동 위임 미수행**: 추천만 표시하고 사용자가 직접 슬래시 호출 (`/gemini:rescue` / `/ccp:codex-rescue`) — 원칙 4 (자동 fallback 금지) 준수.
- B20 데이터셋: 50 케이스 (codex 15 / gemini 14 / claude 21).

## 트리거 조건

다음 중 하나에 해당하면 본 스킬을 적용한다.

- 사용자가 `/gemini:rescue` 또는 `/gemini:*` 슬래시를 명시 입력
- 메인 컨텍스트 사용량 75%를 초과한 상태에서 새로운 대용량 작업이 들어옴
- 입력에 "이 디렉토리", "전체 검토", "요약", "대용량 로그" 등 Gemini 키워드 포함
- 첨부 파일·텍스트가 30,000 토큰을 초과 (PRD §5.1(2) 임계)

위 조건 어디에도 해당하지 않으면 라우터를 적용하지 않고 메인 Claude 가 직접 처리한다.

## 4축 결정 알고리즘

라우터는 4축을 우선순위 순으로 적용한다. 첫 번째로 매칭되는 축의 결정을 채택한다.

### A. 사용자 명시 (최우선)

| 신호 | 결정 | reason |
|------|------|--------|
| `/gemini:rescue` 슬래시 호출 | `gemini` | `user_explicit_gemini` |
| `/ccp:codex-rescue` 슬래시 호출 | `codex` | `user_explicit_codex` |
| `--fallback-claude` 플래그 | `claude` | `user_explicit_claude` |
| `--force-claude` 플래그 (향후) | `claude` | `user_explicit_claude` |
| `--effort` 명시 (codex 고유) | `codex` | `user_explicit_codex_option` |
| `--sandbox workspace-write` 명시 | `codex` | `user_explicit_codex_option` |

사용자 명시는 라우터의 다른 축을 모두 무효화한다.

### B. 입력 크기

| 추정 입력 토큰 | review/diff 키워드 | 결정 | reason |
|---|---|---|---|
| < 5,000 | — | `claude` | `too_small` (위임 비용이 절감보다 큼) |
| 5,000 ~ 30,000 | review/PR/diff/버그조사 키워드 매칭 | `codex` | `mid_review_codex` |
| 5,000 ~ 30,000 | 그 외 | (C 축으로 진행) | — |
| > 30,000 | — | `gemini` | `too_large` (1M 컨텍스트 활용) |

토큰 추정은 `words × 1.3` 공식 사용 (`token-budget-check` 스킬 §2 참조).

### C. 키워드 매칭

#### Gemini 우선 키워드 (대용량 요약·분석)
- "요약", "전체 검토", "이 디렉토리", "전체 코드베이스"
- "summary", "review codebase", "summarize"
- "대용량 로그 파싱", "로그 분석"
- 첨부 파일이 `*.log`, `*.csv`, `*.ndjson` 등 대용량 텍스트 패턴

#### Codex 우선 키워드 (코드 리뷰·버그·diff)
- "코드 리뷰", "리뷰", "PR 검토", "diff 검토", "git diff"
- "review code", "code review", "review this PR", "audit diff"
- "버그 조사", "버그 찾아줘", "find the bug", "investigate the bug"
- "리팩터링 제안 (대규모)", "코드 품질"
- `git diff` 출력 또는 `*.patch` 첨부

> **주의 (결정 #3):** review 슬래시(`/codex review`)는 v0.2 분리(B18). 본 라우터는 키워드만 미리 분리하고, 활성화는 v0.2.

#### Claude 우선 키워드
- "수정", "리팩터", "한 줄 변경", "이 함수만"
- "edit", "fix this line", "rename this variable"
- "테스트 작성", "타입 추가", "주석 보강"
- 메인 컨텍스트 의존 작업 ("방금", "위에서", "이전 응답")

#### 메인 컨텍스트 의존 키워드 (최우선 강등)
다음 키워드는 **메인 컨텍스트 작업**을 의미하므로 codex·gemini 키워드보다 우선해 `claude` 로 강제한다:

- "방금", "위에서", "이전 응답", "실행한 명령"

이는 입력이 메인 Claude 의 직전 턴에 의존함을 명시하는 신호이며, 위임 시 컨텍스트 단절로 R3 (라우터 오판 비용) 발현. (B1 검증 — C08 "방금 수정한 코드 리뷰해줘" 케이스)

#### 매칭 결과
| 매칭 | 결정 | reason |
|------|------|--------|
| 메인 컨텍스트 의존 키워드 매칭 (위 목록) | `claude` | `main_context_bind` |
| Gemini 키워드만 매칭 | `gemini` | `keyword_gemini` |
| Codex 키워드만 매칭 | `codex` | `keyword_codex` |
| Claude 키워드만 매칭 | `claude` | `keyword_claude` |
| 다중 매칭 (bind 제외) | 우선순위: codex > gemini > claude | `keyword_<선택>_priority` |
| 모두 미매칭 | (D 축으로 진행) | — |

### D. Fallback (기본값)

| 상황 | 결정 | reason |
|------|------|--------|
| 결정이 codex 인데 codex 미인증/CLI 미설치 | `claude` | `fallback_codex_unavailable` |
| 결정이 gemini 인데 Gemini OAuth 만료/쿼터/CLI 미설치 | `claude` | `fallback_gemini_unavailable` |
| 위 모든 축이 미결정 | `claude` | `default_conservative` |

**보수적 기본값**: 애매한 경우 메인 Claude 로 처리한다. 잘못된 위임은 R3 (라우터 오판 비용)을 발생시킨다.

## 결정 객체 포맷

```json
{
  "target": "claude" | "gemini" | "codex",
  "reason": "user_explicit_gemini | user_explicit_codex | user_explicit_codex_option | user_explicit_claude | too_small | mid_review_codex | too_large | keyword_gemini | keyword_codex | keyword_claude | keyword_codex_priority | keyword_gemini_priority | fallback_codex_unavailable | fallback_gemini_unavailable | default_conservative",
  "axis": "A" | "B" | "C" | "D",
  "estimated_input_tokens": 12345,
  "matched_keywords": ["코드 리뷰", "diff"]
}
```

## 자동 fallback 금지 규칙

**핵심 원칙 (원칙 4 — `_workspace/02_arch_decisions.md`):**
라우터가 `gemini` 또는 `codex` 로 결정한 후 위임 호출이 실패하면, 자동으로 Claude 본체로 재호출하지 않는다. 사용자에게 다음 중 하나를 선택하도록 envelope 으로 제시한다.

| 모델 | 실패 사유 | 사용자 선택지 |
|---|---|---|
| gemini | OAuth 만료/쿼터 | `/gemini:setup --renew` 또는 `/gemini:rescue --fallback-claude "<task>"` |
| codex | 인증 부재 | `codex login` 후 재시도 또는 `/ccp:codex-rescue --fallback-claude "<task>"` |

자동 fallback 을 금지하는 이유:
1. 이중 청구(R1) 방지 — 위임 호출 비용 + Claude 호출 비용 동시 발생 차단
2. 사용자 의도 존중 — 명시적 재호출이 의도성을 보장
3. 디버깅 가능성 — fallback 사유를 사용자가 인지

## 정확도 측정 절차

`_workspace/_router_test/EVAL_DATASET.md` §2 의 50 케이스 데이터셋을 사용 (B20 확장 — codex 15 / gemini 14 / claude 21).

```
정확도 = (예측 == 정답 라벨) 건수 / 50
```

합격 기준 (PRD §7 AC-2 — B1 v0.1 갱신):

| 지표 | 합격 기준 |
|------|---------|
| 전체 정확도 | ≥ 80% |
| 명확 케이스 (C01~C16, G01~G15) | ≥ 90% |
| 경계 케이스 (B01~B05) | ≥ 60% |
| Claude/Gemini/Codex Precision·Recall | ≥ 0.75 각각 (3-way 확장에 따라 0.80 → 0.75 완화) |
| 혼동 행렬 | 3×3 (claude/gemini/codex) |

미달 시 조치 순서:
1. 키워드 사전 보강 (오분류 케이스의 핵심 단어 추가)
2. 임계값 조정 (5K → 8K 또는 30K → 25K)
3. 경계 케이스 라벨 재검토
4. 그래도 미달 시 `scope-guard` 에 통보 → 자동 라우팅 제거 후 슬래시 수동 호출만 지원하는 안 검토

## Phase 6+ / v0.3 백로그 (`_workspace/01_backlog.md`)

현재 v0.2 라우터에서 제외된 기능:

- 한국어 매직 키워드 자동 감지 ("`@gemini`", "`@codex`", "`@claude`")
- 비용/지연 가중 다목적 최적화
- ML 분류기 (현재는 규칙 기반)
- review·adversarial-review 슬래시 (B18) — git diff 추출 로직 의존
- 라우터 자동 위임 (옵션 D — 추천 후 사용자 confirm 없이 슬래시 자동 실행, 원칙 4 위배 가능)

## Why

라우터는 CCP 의 토큰 절감 효과를 결정하는 핵심 로직이다. 4축 우선순위 구조는:

1. **사용자 의도 항상 존중** — 의외성 제거
2. **명백한 케이스 빠르게 처리** — 입력 크기 임계로 경계 모호성 해소
3. **키워드는 경계에만 사용** — 오버피팅 방지
4. **보수적 기본값** — 애매하면 Claude (잘못된 위임 = R3 발현)

## 산출물 위치

- 본 스킬: `plugins/ccp/skills/router/SKILL.md`
- 정확도 데이터셋: `_workspace/02_router_accuracy_spec.md`
- 측정 리포트(개발 후): `_workspace/04_router_report.md` (S4-3)

## 참조

- `_workspace/01_prd.md` §5.1(2)
- `_workspace/02_router_accuracy_spec.md`
- `_workspace/02_arch_decisions.md` 원칙 4 (자동 fallback 금지)
- `.claude/skills/router-implementation/SKILL.md` (메타 스킬)
