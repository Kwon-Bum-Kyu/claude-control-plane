---
description: 완료된 background job 의 결과(요약 + 결과 파일 경로)를 회수합니다. 결과 원본은 envelope 에 포함되지 않습니다.
argument-hint: <job_id> [--summary-only]
allowed-tools:
  - Bash
---

# /gemini:result

`/gemini:rescue --background` 으로 시작된 작업의 결과를 회수합니다. **결과 원본은 envelope 에 포함되지 않으며**, 메인 컨텍스트로 유입을 차단하기 위해 파일 경로만 반환됩니다 (R1 이중 청구 방지 — `_workspace/02_arch_decisions.md` 원칙 7).

## 사용법

```
/gemini:result <job_id> [--summary-only]
```

| 인자 | 설명 |
|------|------|
| `<job_id>` | 완료된 job 의 UUID v4 (필수) |
| `--summary-only` | 결과 파일을 열지 않고 요약만 반환 (`CCP-CTX-001` 회피용) |

## 실행 동작

1. UUID v4 패턴 검증.
2. `gemini-companion.mjs result <job_id>` 호출.
3. companion 이 `meta.status==completed` 확인 → `result_file_path` 와 3줄 요약 envelope 만 반환.

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" result <job_id> [--summary-only]
```

## 출력 (성공)

```json
{
  "summary": "≤3줄 요약 (500자 하드 캡)",
  "result_path": "_workspace/_jobs/<uuid>/result.md",
  "tokens": { "input": 12340, "output": 820 },
  "exit_code": 0,
  "details": { "job_id": "<uuid>", "gemini_session_id": "<uuid|null>" }
}
```

메인 Claude 는 `result_path` 를 사용자에게 전달하되, **자체적으로 Read 도구로 열지 않습니다** (사용자 명시 요청 시에만 부분 읽기 허용).

## 에러 코드

| 코드 | 원인 | recovery |
|------|------|:---:|
| `CCP-INVALID-001` | UUID 형식 위반 | abort |
| `CCP-JOB-001` | job 디렉토리 부재 | abort |
| `CCP-JOB-002` | 아직 실행 중 또는 실패 | retry — `/gemini:status` 로 대기 |
| `CCP-JOB-003` | meta.json 손상 | abort |
| `CCP-JOB-004` | meta 는 있으나 result.md 부재 | abort |

## 합격 기준

- 1초 내 응답.
- `result.md` 의 본문은 envelope 에 포함하지 않음 (메인 컨텍스트 보호 — RC-1 ≤ 500자).

## 명세 SSOT

- `_workspace/01_command_spec.md` §"/gemini:result"
- `_workspace/01_schema.md` §2.1 (envelope), §3.4 (비밀 정보 금지 규칙)
- `_workspace/01_error_messages.md`
