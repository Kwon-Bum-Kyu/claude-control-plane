---
description: 완료된 codex background job 의 결과(요약 + 결과 파일 경로)를 회수합니다. 결과 원본은 envelope 에 포함되지 않습니다.
argument-hint: <job_id>
allowed-tools:
  - Bash
---

# /ccp:codex-result

완료된 codex job 의 결과를 회수합니다. 메인 컨텍스트로 유입되는 텍스트는 요약(≤500자) + 결과 파일 경로뿐이며, 본문은 사용자가 명시적으로 Read 할 때만 노출됩니다 (이중 청구 방지 — 원칙 7).

## 사용법

```
/ccp:codex-result <job_id>
```

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" result <job_id>
```

## 출력 (성공)

```json
{
  "summary": "≤500자 요약",
  "result_path": "_workspace/_jobs/<uuid>/result.txt",
  "tokens": { "input": 22397, "cached": 5504, "output": 124, "total": 17017 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "job_id": "<uuid>",
    "codex_thread_id": "019dda15-d027-77f3-ba78-84bb289d14a9",
    "duration_ms": 18430
  }
}
```

## 에러 코드

| 코드 | 원인 | recovery |
|------|------|:---:|
| `CCP-JOB-001` | job_id 미존재 | abort |
| `CCP-JOB-002` | job 진행 중 (queued/running) | retry |
| `CCP-JOB-004` | 결과 파일 유실 또는 실패 종료 | abort |
| `CCP-INVALID-001` | job_id 인자 부재 | abort |

## 명세 SSOT

- `_workspace/06_codex_function_mapping.md` §3
- `plugins/ccp/scripts/codex-companion.mjs:handleResult`
