---
description: --background 으로 발행된 job 의 현재 상태를 조회합니다.
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /gemini:status

`--background` 모드로 시작된 Gemini 작업의 진행 상태를 조회합니다.

## 사용법

```
/gemini:status <job_id>
```

| 인자 | 설명 |
|------|------|
| `<job_id>` | `/gemini:rescue --background` 응답의 UUID v4 (필수) |

## 실행 동작

1. UUID v4 패턴 검증 (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).
2. `gemini-companion.mjs status <job_id>` 호출 — companion 이 `_workspace/_jobs/<job_id>/meta.json` 을 읽음.
3. 메인 Claude 는 meta.json 을 직접 읽지 않습니다 — 권한 분리·스키마 변환 레이어 유지.

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" status <job_id>
```

## 출력 (성공)

```json
{
  "summary": "job <status>",
  "result_path": null,
  "tokens": { "input": 0, "output": 0 },
  "exit_code": 0,
  "details": {
    "job_id": "<uuid>",
    "status": "queued | running | completed | failed",
    "created_at": "2026-04-26T09:00:00Z",
    "started_at": "2026-04-26T09:00:01Z",
    "completed_at": "2026-04-26T09:00:12Z",
    "next_action": "/gemini:result <job_id> (status=completed 시)"
  }
}
```

## 에러 코드

| 코드 | 원인 | recovery |
|------|------|:---:|
| `CCP-INVALID-001` | UUID 형식 위반 | abort |
| `CCP-JOB-001` | job 디렉토리 부재 | abort |
| `CCP-JOB-003` | meta.json 파싱 실패 | abort |

## 합격 기준

- 1초 내 응답.
- `details.status` 필드는 `01_schema.md` §1.2 enum (`queued|running|completed|failed`)과 정확히 일치.

## 명세 SSOT

- `_workspace/01_command_spec.md` §"/gemini:status"
- `_workspace/01_schema.md` §1 Job 메타데이터
- `_workspace/01_error_messages.md`
