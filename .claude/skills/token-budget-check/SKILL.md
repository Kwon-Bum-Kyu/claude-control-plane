---
name: token-budget-check
description: "토큰 예산·컨텍스트 사용량 추정 및 회귀 케이스 검증 절차. ecc context-budget 패턴 기반 (words×1.3 추정). 토큰 사용량 측정·이중 청구 검증·라우터 효율 평가 시 반드시 이 스킬을 사용."
---

# Token Budget Check — 토큰 예산 추정·검증 절차

CCP의 토큰 절감 가설(15%+) 검증을 위한 측정·추정 절차. ecc `context-budget` 패턴을 기반으로 한다.

## 토큰 추정 공식 (ecc 패턴)

```
estimated_tokens = word_count × 1.3
```

이유: 영어 평균 토큰 비율. 한국어는 ~2.5x, 코드는 ~1.5x. **보수적으로 추정하려면 1.5 사용.**

## 컨텍스트 버킷 분류

| 버킷 | 정의 | 예시 |
|------|------|------|
| **Always** | 매 세션마다 로드 | CLAUDE.md, MCP tool schemas |
| **Sometimes** | 키워드 트리거 시 로드 | 스킬, 일부 에이전트 정의 |
| **Rarely** | 명시 호출 시만 로드 | references/ 파일 |

> Always 버킷은 절대 5,000 토큰을 넘지 않게 관리. 넘으면 Sometimes 또는 Rarely로 이동.

## 회귀 케이스 검증 절차

### R1: 이중 청구 (서브에이전트 출력이 부모 컨텍스트로 흘러듦)

1. 서브에이전트 호출 직전 메인 컨텍스트 토큰 측정 (Tbefore)
2. 서브에이전트 호출 (foreground)
3. 호출 직후 메인 컨텍스트 토큰 측정 (Tafter)
4. ΔT = Tafter - Tbefore가 명세된 "3줄 요약+경로"의 추정 토큰 (~50)을 크게 넘으면 **R1 발현**

### R2: 무료 티어 해석 오류

1. Antigravity 호출 시 max-tokens(prompt-suffix) 명시 여부 확인
2. 응답 길이 가드 동작 확인 (초과 시 잘라냄)
3. 서브에이전트가 Antigravity 원본 응답을 그대로 반환하지 않고 재요약하는지 확인

### R3: 라우터 오판 비용

1. 정답 라벨이 있는 분류 데이터셋 N개 (≥30) 준비
2. 라우터 실행 → 분류 결과 ↔ 정답 비교
3. 정확도 = 일치 / 전체. **80% 미만 = R3 발현**
4. 오판 시나리오에서 fallback이 발생하는지 (Antigravity 실패 → Claude 복귀) 확인

### R5: strategic-compact 약한 시그널

1. PreToolUse Edit/Write 50회 시뮬레이션 (스크립트 자동화)
2. stderr에 리마인더 출력 확인
3. 자동 호출이 명세에 포함된 경우 실제 `/compact` 발화 확인

## 측정 도구 권장

- `ccusage` 등 토큰 사용량 CLI (보고서 §8.3 권장)
- Claude Code의 `/cost` 또는 세션 종료 통계
- 자체 로깅: `antigravity-companion.mjs` 호출 전후 토큰 기록

## 합격 기준 (MVP)

| 항목 | 기준 |
|------|------|
| 라우터 정확도 | ≥ 80% |
| 동일 워크로드 토큰 절감 | ≥ 15% |
| R1~R3, R5, R6 회귀 | 0건 |
| Always 버킷 토큰 | ≤ 5,000 |

## Why

ecc·omc가 표방한 30~50% 절감이 검증 불가로 판정된 이유(보고서 §5)는 측정 절차의 부재였다. CCP는 동일한 함정을 피하기 위해 **모든 합격 기준을 사전 정의된 측정 절차로 검증**한다. 측정이 곧 신뢰의 기반이다.

## 참조

- ecc context-budget: https://github.com/affaan-m/everything-claude-code/blob/main/skills/context-budget/SKILL.md
- 보고서 §2.1, §5 (검증 부재 문제)
