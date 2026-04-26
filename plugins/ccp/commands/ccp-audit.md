---
description: ecc harness-audit.js 포팅. 토큰 사용량/컨텍스트 효율을 7카테고리로 점수화한 리포트를 생성합니다.
argument-hint: "[--since <date>] [--format md|json]"
allowed-tools:
  - Bash
---

# /ccp:audit

CCP 의 토큰 사용량·컨텍스트 효율·라우터 정확도·OAuth 회복·이중 청구 방어를 7 카테고리로 점수화하여 감사 리포트를 생성합니다 (`scripts/harness-audit.js` — ecc `harness-audit.js` 포팅).

## 사용법

```
/ccp:audit [--since <date>] [--format md|json]
```

| 인자 | 설명 |
|------|------|
| `--since <date>` | 감사 기간 시작 (`YYYY-MM-DD`, 기본 7일 전) |
| `--format md\|json` | 출력 포맷 (기본 `md`) |

## 실행 동작

1. `harness-audit.js` 호출.
2. `_workspace/_jobs/*/meta.json` 과 최근 세션 로그를 스캔.
3. 7 카테고리 점수 산출 (각 0~5):
   - **Context Efficiency** — `summary` 길이 평균, RC-1 (`main_context_delta ≤ 500`) 준수율
   - **Cost Efficiency** — T1~T7 토큰 절감률 평균
   - **Router Accuracy** — 36 케이스 데이터셋 정확도 (≥ 80% PASS)
   - **Double-billing Detection (R1)** — `result.md` 원본 메인 유입 0건 검증
   - **Fallback Health (R6)** — OAuth 만료 후 사용자 재호출 성공률
   - **Plugin Compatibility (R4)** — `minClaudeVersion`·`engines.node`·`engines.gemini_cli` 충족도
   - **Secret Leak Check (L5·L6)** — envelope `details` 비밀 정보 grep, `.gitignore` 격리 확인
4. 결과를 `_workspace/_audits/<YYYY-MM-DDTHHMMSSZ>.md` 또는 `.json` 에 영속화.

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/harness-audit.js" [--since <date>] [--format md|json]
```

## 출력 (성공)

```json
{
  "summary": "전체 점수 35/35. 주의 카테고리: 없음",
  "result_path": "_workspace/_audits/2026-04-26T093000Z.md",
  "tokens": { "input": 0, "output": 0 },
  "exit_code": 0,
  "details": {
    "scores": {
      "context_efficiency": 5,
      "cost_efficiency": 4,
      "router_accuracy": 5,
      "double_billing": 5,
      "fallback_health": 5,
      "plugin_compat": 5,
      "secret_leak": 5
    }
  }
}
```

> **S2-5 details 수납 규칙:** `scores` 객체는 envelope 루트가 아닌 `details` 서브오브젝트에 수납.

## 에러 코드

| 코드 | 원인 | recovery |
|------|------|:---:|
| `CCP-AUDIT-001` | 감사 대상 데이터 없음 | abort |
| `CCP-AUDIT-002` | harness-audit 스크립트 실패 | retry |

## 합격 기준

- 30초 내 응답.
- 7 카테고리 모두 점수 산출 (누락 0건).
- 리포트 파일이 `_workspace/_audits/` 에 영속화.

## 명세 SSOT

- `_workspace/01_command_spec.md` §"/ccp:audit"
- `_workspace/02_arch_decisions.md` 원칙 7
- `_workspace/02_regression_cases.md` (RC-1~RC-7 검증 항목)
