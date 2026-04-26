---
name: router-implementation
description: "Claude vs Gemini 라우팅 결정 로직 구현 가이드. 입력 크기·키워드·사용자 명시·fallback 4축 분류. 라우터 분류 정확도 80%+ 합격 기준. 라우터 구현·라우팅 정책 작성 시 반드시 이 스킬을 사용."
---

# Router Implementation — 모델 라우터 구현 가이드

CCP의 라우터는 작업을 Claude 본체 처리 vs Gemini 위임으로 분류한다. 합격 기준은 정확도 80%+ (R3 완화).

## 라우팅 결정 4축

라우터는 다음 4축을 우선순위 순으로 적용:

### 1. 사용자 명시 (최우선)
사용자가 `/gemini:rescue`로 직접 호출 → 무조건 Gemini 위임
사용자가 `--no-gemini` 같은 플래그 명시 → 무조건 Claude 본체

### 2. 입력 크기
| 크기 | 결정 |
|------|------|
| < 5,000 토큰 | Claude 본체 (위임 비용이 절감보다 큼) |
| 5,000 ~ 50,000 토큰 | 키워드 기반 결정 (3축 적용) |
| > 50,000 토큰 | Gemini 위임 (1M 컨텍스트 활용) |

### 3. 키워드 매칭
**Gemini 우선 키워드:**
- "요약", "전체 검토", "디렉토리 분석", "summary", "review codebase"
- 대용량 파일 처리 패턴 (`*.log`, `*.csv`, 큰 텍스트 덩어리)

**Claude 우선 키워드:**
- "수정", "리팩터", "한 줄", "edit", "fix this line"
- 정확한 코드 변경, IDE 통합 작업

### 4. Fallback 경로 (실패 시)
- Gemini 호출 실패 (E_GEMINI_NOT_INSTALLED, E_OAUTH_EXPIRED, E_GEMINI_FAILED) → Claude 본체로 자동 복귀
- Fallback 발생 시 비용 로깅 (`_workspace/_logs/router_fallback.jsonl`)

## 분류 알고리즘 (의사 코드)

```
def route(task: str, user_flags: dict) -> Decision:
    # 1. 사용자 명시 (최우선)
    if user_flags.get("force_gemini"): return Decision("gemini", reason="user_explicit")
    if user_flags.get("no_gemini"):    return Decision("claude", reason="user_explicit")

    # 2. 입력 크기
    estimated_tokens = estimate_tokens(task)
    if estimated_tokens < 5000:    return Decision("claude", reason="too_small")
    if estimated_tokens > 50000:   return Decision("gemini", reason="too_large")

    # 3. 키워드 매칭
    if matches_gemini_keywords(task):  return Decision("gemini", reason="keyword_gemini")
    if matches_claude_keywords(task):  return Decision("claude", reason="keyword_claude")

    # 4. 기본값 (애매한 경우 Claude 본체 — 보수적)
    return Decision("claude", reason="default_conservative")
```

## Fallback 로직

```
def execute_with_fallback(decision: Decision, task: str):
    if decision.target == "claude":
        return claude_handle(task)

    # Gemini 위임 시도
    try:
        result = gemini_handle(task)
        if result.error:  raise GeminiError(result.error)
        return result
    except (GeminiNotInstalled, OAuthExpired, GeminiFailed) as e:
        log_fallback(decision, e)
        return claude_handle(task)  # Claude 복귀
```

## 정확도 측정 절차

token-economist의 `_workspace/02_router_accuracy_spec.md` 데이터셋을 사용:

1. 라벨된 케이스 N개 (≥30) 준비
2. `route(case)` 호출 → 결정 수집
3. 정답_라벨과 일치율 측정
4. **합격: 80%+**

미달 시:
- scope-guard에게 통보 (스코프 축소 검토)
- 키워드 사전 보강
- 임계값 조정 (5,000 → 8,000 등)

## 비용 로깅 형식

`_workspace/_logs/router_fallback.jsonl`:
```jsonl
{"ts":"2026-04-22T...","task":"...","decision":"gemini","reason":"too_large","fallback_to":"claude","fallback_reason":"E_OAUTH_EXPIRED","extra_cost_estimate":1234}
```

각 라인은 fallback 1건. 누적되면 라우터 정책 재조정의 근거가 됨.

## Why

라우터는 CCP의 핵심 가치 결정자다. 잘못 위임하면 R3가 발현되고 절감 효과가 무너진다. 4축 우선순위 구조는:
1. 사용자 의도를 항상 존중 (의외성 제거)
2. 입력 크기 기반 결정으로 명백한 케이스 빠르게 처리
3. 키워드는 경계 케이스에만 사용 (오버피팅 방지)
4. Fallback은 항상 동작 (Gemini 실패가 사용자에게 노출되지 않음)

## 산출물 위치

- 구현: `plugins/ccp/plugins/ccp/scripts/router.mjs` (또는 스킬 형태로 가이드 분리)
- 진행 보고: `_workspace/03_implementation_progress.md`
