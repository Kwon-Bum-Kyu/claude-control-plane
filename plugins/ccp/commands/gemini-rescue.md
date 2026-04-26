---
description: 무거운 요약·분석·대용량 문맥 처리 작업을 Gemini CLI로 위임하여 Claude 메인 컨텍스트 토큰을 절감합니다.
argument-hint: <task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
allowed-tools:
  - Bash
---

# /gemini:rescue

작업을 Gemini CLI 서브에이전트로 위임해 메인 Claude 컨텍스트의 토큰을 절감합니다. 결과는 3줄 요약과 결과 파일 경로만 메인으로 반환합니다 (이중 청구 방지 — `_workspace/02_arch_decisions.md` 원칙 7).

## 사용법

```
/gemini:rescue <task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
```

| 인자 | 설명 |
|------|------|
| `<task>` | Gemini 에 위임할 작업 설명 (필수) |
| `--background` | detached 비동기 실행. 즉시 `job_id` 반환. 이후 `/gemini:status`·`/gemini:result` 로 회수 |
| `--max-tokens N` | 응답 토큰 상한 (기본 4000) |
| `--files <glob>` | Gemini 가 참조할 파일 glob |
| `--fallback-claude` | companion 호출 생략. 메인 Claude 가 직접 처리 (OAuth 실패 후 다음 턴 재호출용) |

## 실행 동작

1. `--fallback-claude` 가 있으면 즉시 `mode: "fallback_claude"` envelope 반환, companion 호출 생략.
2. preflight: companion 이 Node.js ≥ v20, `gemini --version` ≥ 0.38.0, OAuth 자격 (`GEMINI_API_KEY` 또는 `~/.gemini/google_accounts.json`) 검증.
3. foreground: 동기 실행. companion 이 `gemini -p <task> -o json` 호출, `result.md` 저장, 3줄 요약 + 토큰 통계 envelope 반환.
4. background: detached child 프로세스 생성, `_workspace/_jobs/<uuid>/{meta.json,result.md,stderr.log}` 영속화, 1 초 내 `{job_id, status: "queued"}` 반환.

## 호출 패턴

`gemini-rescue` 서브에이전트를 통해 다음 단일 Bash 패턴으로 호출됩니다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" rescue --task "<task>" [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]
```

## 출력 (foreground 성공)

```json
{
  "summary": "≤3줄 요약 (500자 하드 캡)",
  "result_path": "_workspace/_jobs/<uuid>/result.md",
  "tokens": { "input": 12340, "output": 820 },
  "exit_code": 0,
  "details": { "mode": "gemini", "job_id": "<uuid>", "gemini_session_id": "<uuid|null>" }
}
```

## 출력 (background 성공)

```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "next_action": "/gemini:status <job_id>",
  "details": { "mode": "background", "pid": <number> }
}
```

## 에러 코드 (요약)

| 코드 | recovery | 메인 Claude 권장 응답 |
|------|:---:|----------------------|
| `CCP-SETUP-001` | abort | Gemini CLI 설치 안내 |
| `CCP-SETUP-002` | abort | Node.js ≥ v20 설치 안내 |
| `CCP-OAUTH-001` | fallback | `AskUserQuestion` 으로 ① 재인증 / ② `/gemini:rescue --fallback-claude` / ③ 취소 제시 |
| `CCP-GEMINI-002` | fallback | 쿼터 안내 + Claude 본체 fallback 옵션 제시 |
| `CCP-CTX-001` | abort | 응답이 1,500 토큰 추정 초과 — `/gemini:result <job_id> --summary-only` 권장 |
| `CCP-INVALID-001` | abort | 사용법 표시 |
| `CCP-TIMEOUT-001` | retry | 재시도 또는 `--background` 권장 |

전체 카탈로그는 `_workspace/01_error_messages.md` 참조.

## 합격 기준 (PRD §7)

- foreground: 15초 내 응답 또는 에러 envelope.
- background: 1초 내 `job_id` 반환.
- 모든 에러는 공통 envelope (`error.code` 정규식 `^CCP-[A-Z]+-[0-9]{3}$` 100% 매칭).
- 메인 컨텍스트 유입 ≤ 500 자 (RC-1).
- 자동 fallback 금지 (원칙 4) — Gemini 실패 시 사용자에게 옵션 제시.

## 명세 SSOT

- `_workspace/01_command_spec.md` §"/gemini:rescue"
- `_workspace/01_schema.md` §1.2 (`token_usage`), §2 (envelope)
- `_workspace/01_user_scenarios.md` 시나리오 1·2·3
- `_workspace/01_error_messages.md` (에러 카탈로그 SSOT)
