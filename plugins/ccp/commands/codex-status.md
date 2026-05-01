---
description: "--background 으로 발행된 codex job 의 현재 상태를 조회합니다."
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /ccp:codex-status

background 로 등록된 codex job 의 진행 상태를 조회합니다 (queued / running / completed / failed / cancelled / timeout).

## 사용법

```
/ccp:codex-status <job_id>
```

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" status <job_id>
```

## 출력 (성공)

```json
{
  "summary": "job <uuid> state=running",
  "result_path": null,
  "tokens": { "input": 0, "output": 0, "total": 0 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "job_id": "<uuid>",
    "state": "running",
    "pid": 32154,
    "started_at": "2026-04-30T12:34:56.789Z",
    "completed_at": null
  }
}
```

## 에러 코드

| 코드 | 원인 | recovery |
|------|------|:---:|
| `CCP-JOB-001` | job_id 미존재 | abort |
| `CCP-JOB-003` | meta.json 손상 | abort |
| `CCP-INVALID-001` | job_id 인자 부재 | abort |

## 명세 SSOT

- `_workspace/06_codex_function_mapping.md` §3.1
- `plugins/ccp/scripts/lib/codex_adapted/state.mjs`
