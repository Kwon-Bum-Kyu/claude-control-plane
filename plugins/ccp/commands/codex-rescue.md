---
description: 코드 리뷰·버그 조사·diff 분석 등 Codex 가 강한 작업을 위임하여 Claude 메인 컨텍스트 토큰을 절감합니다.
argument-hint: <task> [--background] [--model NAME] [--effort low|medium|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude]
allowed-tools:
  - Bash
---

# /ccp:codex-rescue

Codex CLI 서브에이전트로 작업을 위임해 메인 Claude 컨텍스트의 토큰을 절감합니다. 결과는 요약과 결과 파일 경로만 메인으로 반환합니다 (이중 청구 방지 — `_workspace/02_arch_decisions.md` 원칙 7).

## 사용법

```
/ccp:codex-rescue <task> [--background] [--model NAME] [--effort low|medium|high] [--sandbox read-only|workspace-write|danger-full-access] [--cwd DIR] [--timeout-ms N] [--fallback-claude]
```

| 인자 | 설명 |
|------|------|
| `<task>` | Codex 에 위임할 작업 설명 (필수) |
| `--background` | detached 비동기 실행. 즉시 `job_id` 반환. 이후 `/ccp:codex-status`·`/ccp:codex-result` 로 회수 |
| `--model NAME` | 모델 별칭 (예: `gpt-5-codex-medium`). 미지정 시 codex 기본값 |
| `--effort low\|medium\|high` | reasoning effort. `-c model_reasoning_effort=` 로 변환 (probe §1 — codex 는 직접 플래그 없음) |
| `--sandbox MODE` | `read-only` (기본) / `workspace-write` / `danger-full-access` |
| `--cwd DIR` | codex 작업 루트 (`-C` 매핑) |
| `--timeout-ms N` | foreground 응답 timeout (default 600000). background 는 worker 메타로 전달 |
| `--fallback-claude` | companion 호출 생략. 메인 Claude 가 직접 처리 (인증 실패 후 다음 턴 재호출용) |

## 실행 동작

1. `--fallback-claude` 가 있으면 즉시 fallback envelope 반환, companion 호출 생략.
2. preflight: `codex login status` (30s timeout, probe §2) — 미인증 시 `CCP-OAUTH-101` emit.
3. foreground: `codex exec --json --skip-git-repo-check -s <sandbox> -C <cwd> "<task>"` 호출 (stdin 강제 닫기, probe §3.2). JSONL 4 이벤트 파싱 → summary + tokens + thread_id.
4. background: `lib/codex_adapted/job-control.dispatchBackgroundJob` 로 detached worker spawn (file fd stdio, probe §4). 즉시 `{job_id, status:"queued"}` 반환.

## 호출 패턴

`codex-rescue` 서브에이전트(`agents/codex-rescue.md`)가 다음 단일 Bash 패턴으로 호출합니다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" rescue [--background] [--model NAME] [--effort LEVEL] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude] -- "<task>"
```

## 출력 (foreground 성공)

```json
{
  "summary": "≤500자 요약",
  "result_path": null,
  "tokens": { "input": 22397, "cached": 5504, "output": 24, "total": 16917 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "codex_thread_id": "019dda15-d027-77f3-ba78-84bb289d14a9",
    "duration_ms": 7245,
    "model": "gpt-5-codex-medium"
  }
}
```

## 출력 (background 성공)

```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "next_action": "Use /ccp:codex-status <job_id> to check progress, then /ccp:codex-result <job_id> when ready.",
  "details": { "mode": "codex", "pid": 32154 }
}
```

## 에러 코드 (요약)

| 코드 | recovery | 메인 Claude 권장 응답 |
|------|:---:|----------------------|
| `CCP-SETUP-101` | abort | Codex CLI 설치 안내 |
| `CCP-SETUP-102` | abort | Codex CLI 업그레이드 안내 |
| `CCP-OAUTH-101` | fallback_claude | `AskUserQuestion` 으로 재인증/fallback/취소 제시 |
| `CCP-CODEX-001` | retry | stderr 로그 안내 + Claude 본체 재시도 |
| `CCP-CODEX-002` | retry | JSONL 미응답 — verbose 재실행 |
| `CCP-CTX-001` | abort | 응답 1500 토큰 추정 초과 |
| `CCP-INVALID-001` | abort | 사용법 표시 |
| `CCP-TIMEOUT-001` | retry | 재시도 또는 `--background` 권장 |

전체 카탈로그는 `_workspace/01_error_messages.md` 참조.

## 모델 호환성

`--effort`/`--sandbox`/`--write` 등 codex 고유 옵션은 호환성 매트릭스(README §모델 호환성)를 따릅니다. gemini 측에서는 거부(`CCP-UNSUPPORTED-001`).

## 합격 기준

- foreground: P95×2 = 15s 내 응답 또는 에러 envelope (probe §2).
- background: 1초 내 `job_id` 반환.
- envelope schema (`plugins/ccp/schemas/envelope.schema.json`) 100% 통과.
- 메인 컨텍스트 유입 ≤ 500 자 (RC-1).

## 명세 SSOT

- `_workspace/06_codex_cli_probe.md` §1, §3
- `_workspace/06_codex_function_mapping.md` §3, §4
- `_workspace/01_error_messages.md`
