---
name: context-budget
description: "메인 Claude 컨텍스트 토큰 예산을 추정·경고하는 스킬. UserPromptSubmit·PreCompact 훅에서 호출되어 50/75/90% 임계 초과 시 압축·위임 권고 주입. 컨텍스트 사용량이 50%를 넘었거나 대용량 작업 직전 검토 시 반드시 사용."
---

# Context Budget Skill

CCP 메인 Claude 컨텍스트 토큰 예산을 추정하고, 임계값을 넘었을 때 자발적 압축(`/compact`) 또는 Gemini 위임(`/gemini:rescue`) 을 사용자에게 권고한다.

## Attribution

본 스킬은 **ecc (External Claude Code) 의 `strategic-compact` 패턴**을 포팅한 것이다.

- 원본 출처: ecc strategic-compact (보고서 §3.3)
- 라이선스: MIT (원본 허용 라이선스)
- 변경 사항: CCP 명명 규칙(`CCP-COMPACT-001`) 적용, 한국어 메시지화, 자동 `/compact` 트리거 제거 (원칙 4 — 사용자 의도 우선)
- 상세 attribution: `ATTRIBUTION.md` 참조 (S4-8 산출 예정)

## 트리거 조건

본 스킬을 적용하는 경우:

- 메인 컨텍스트 사용량 추정값이 **50% 이상**
- 사용자가 대용량 첨부 파일 또는 long prompt 입력 직전
- `UserPromptSubmit` / `PreCompact` 훅이 발화

50% 미만에서는 트리거하지 않는다 (불필요한 알람 방지).

## 토큰 추정 공식

```
estimated_tokens = words × 1.3
```

근거: `.claude/skills/token-budget-check/SKILL.md` §2. 정확한 토크나이저 호출보다 `words×1.3` 휴리스틱이 충분히 보수적이며 모든 환경에서 동작한다.

## 임계값 매트릭스

| 사용률 | 레벨 | 권고 메시지 |
|-------|------|------------|
| < 50% | OK | (트리거 안 함) |
| 50% ~ 75% | INFO | "컨텍스트 사용량 50% 이상. 새로운 대형 작업은 `/gemini:rescue` 위임을 고려하세요." |
| 75% ~ 90% | WARNING (`CCP-COMPACT-001`) | "75% 도달 — `/compact` 로 수동 압축하거나 대형 작업을 `/gemini:rescue` 로 위임하세요." |
| ≥ 90% | CRITICAL (`CCP-COMPACT-001`) | "90% 임박 — `/compact` 또는 `/gemini:rescue --background` 권장." |

`decision: "block"` 은 사용하지 않음 — 사용자 흐름을 차단하지 않는다 (원칙 4).

## 자동 /compact 금지 규칙

ecc 원본은 strategic-compact 자동 트리거를 포함하지만, CCP 는 다음 이유로 **자동 호출을 금지**한다.

1. 사용자 의도 존중 — `/compact` 는 사용자가 명시적으로 호출해야 함
2. 이중 청구(R1) 방지 — 자동 압축 후 사용자가 같은 작업을 재요청하면 토큰이 두 배
3. 디버깅 가능성 — 사용자가 "왜 압축됐지?" 를 추적 가능

자동 압축 트리거는 `_workspace/01_backlog.md` Phase 6+ 백로그로 동결.

## 통합 지점

- `plugins/ccp/hooks/suggest-compact.js` — UserPromptSubmit·PreCompact 훅에서 본 스킬의 임계값 매트릭스를 사용
- `plugins/ccp/scripts/gemini-companion.mjs` — companion 응답 출력 가드 (`enforceContextBudget`) 가 같은 1,500 토큰·500 자 임계 적용

## 합격 기준 (회귀 케이스 — `_workspace/02_regression_cases.md`)

- RC-1 `main_context_delta ≤ 500` — 메인 컨텍스트 유입 500자 이하 보장
- 75% 도달 시 `additionalContext` 메시지 1회 주입
- 사용자 prompt 원본을 `additionalContext` 에 echo 금지

## 명세 SSOT

- `_workspace/02_arch_decisions.md` 원칙 5 (2+ 훅) · 원칙 4 (자동 fallback 금지)
- `_workspace/03_hook_feasibility.md` §1 UserPromptSubmit 사양
- `_workspace/03_hook_strategy.md` §2.1 (suggest-compact 사양)
- `_workspace/02_token_scenarios.md` T1~T7 토큰 절감 기준
- `.claude/skills/token-budget-check/SKILL.md` (메타 스킬)
