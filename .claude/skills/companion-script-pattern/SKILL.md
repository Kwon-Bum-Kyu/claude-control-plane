---
name: companion-script-pattern
description: "antigravity-companion.mjs 등 외부 CLI 래퍼 스크립트 구현 패턴. codex-companion.mjs 미러링 — foreground/background 분기, JSON envelope, OAuth 사전 검증, job 메타 디스크 저장. CLI 래퍼·companion 스크립트 작성 시 반드시 이 스킬을 사용."
---

# Companion Script Pattern — CLI 래퍼 구현 패턴

`antigravity-companion.mjs`는 codex-plugin-cc의 `codex-companion.mjs`를 거울 구조로 미러링한다. 이 스킬은 그 핵심 패턴을 정의한다.

## 명령 인터페이스

```bash
node antigravity-companion.mjs <subcommand> [options] -- <task>
```

**서브커맨드:**
- `task` — 작업 위임 (foreground 또는 background)
- `task-worker` — background 모드의 자식 프로세스 진입점 (외부 호출 금지)
- `status <job_id>` — background job 상태 조회
- `result <job_id>` — background job 결과 회수
- `setup` — Antigravity CLI 설치/인증 검증

## foreground 흐름

```
사용자 → /antigravity:rescue
   ↓
antigravity-rescue 서브에이전트 (Bash만)
   ↓
node antigravity-companion.mjs task -- "<task>"
   ↓
1. 인증 사전 검증 (keyring/env 2단계 추론 — `agy auth status` 명령 없음)
   실패 → 에러 envelope 반환 (E_OAUTH_EXPIRED)
2. agy -p "<task>"  (max-tokens는 prompt-suffix로 변환, 기본 4000)
3. stdout 캡처 → 길이 가드 (max-tokens 추정 강제)
4. 결과 파일 저장 (_workspace/_jobs/<id>/result.md)
5. 요약 생성 (3줄 이내)
6. JSON envelope 반환:
   { summary, result_path, tokens, exit_code: 0 }
```

## background 흐름

```
사용자 → /antigravity:rescue --background
   ↓
node antigravity-companion.mjs task --background -- "<task>"
   ↓
1. job_id 생성 (UUID v4)
2. 메타 파일 작성: .ccp/jobs/<id>.json
   { id, status: "queued", task, created_at, pid: null }
3. detached child 생성:
   spawn(node, [companion, "task-worker", "--job-id", id], { detached: true, stdio: "ignore" })
4. child unref()
5. 즉시 반환:
   { job_id, status: "queued", next_action: "/antigravity:status <id>" }
```

자식 프로세스 (`task-worker`):
1. 메타 업데이트: status="running", pid=process.pid
2. agy -p "..." 실행
3. 결과 저장 + 메타 업데이트: status="done" / "error"

## JSON envelope 표준

### 성공
```json
{
  "summary": "≤3줄",
  "result_path": "_workspace/_jobs/<id>/result.md",
  "tokens": { "input": 1234, "output": 567 },
  "exit_code": 0
}
```

### 에러
```json
{
  "error": {
    "code": "E_OAUTH_EXPIRED",
    "message": "Antigravity 인증이 만료되었습니다.",
    "recovery": "터미널에서 'agy' 를 한 번 실행해 keyring 로그인을 완료한 뒤 재시도하세요."
  },
  "exit_code": 1
}
```

## 에러 코드 표준

| 코드 | 원인 | recovery |
|------|------|----------|
| `E_ANTIGRAVITY_NOT_INSTALLED` | `agy` 바이너리 없음 | 설치 가이드 URL |
| `E_OAUTH_EXPIRED` | 인증 만료 | `agy` 한 번 실행 (keyring sign-in) |
| `E_INVALID_ARGS` | 인자 오류 | 사용법 표시 |
| `E_ANTIGRAVITY_FAILED` | agy CLI 실행 실패 | stderr 메시지 |
| `E_TIMEOUT` | 타임아웃 | 재시도 또는 background 모드 권장 |

## OAuth 사전 검증 패턴

```javascript
// Antigravity는 keyring silent-auth — `agy auth status` 명령이 없다. 2단계 추론 + probe.
async function checkAuth() {
  if (process.env.ANTIGRAVITY_API_KEY) return { method: "api_key" };
  if (existsSync(join(homedir(), ".gemini", "antigravity-cli"))) return { method: "keyring" };
  // probe: agy -p "ping" 의 exit code / stderr 로 미인증 판정
  const probe = await execAsync('agy -p "ping"').catch((e) => e);
  if (probe.code === "ENOENT") throw new InstallError("E_ANTIGRAVITY_NOT_INSTALLED");
  if (/not logged in/i.test(probe.stderr || "")) throw new OAuthError("E_OAUTH_EXPIRED");
  return { method: "keyring" };
}
```

## 출력 길이 가드

- `agy -p` 호출 시 max-tokens를 prompt-suffix로 변환해 응답 길이를 제한 (agy는 `--max-output-tokens` 미지원)
- stdout 캡처 후 다시 한 번 토큰 추정 (`tokens(text) ≈ words×1.3`)
- 추정 토큰이 N의 1.5배 초과 시 잘라냄 + 경고 추가

## job 메타 스키마

`.ccp/jobs/<id>.json`:
```json
{
  "id": "<uuid>",
  "status": "queued|running|done|error",
  "task": "<원본 요청>",
  "created_at": "<ISO8601>",
  "started_at": "<ISO8601>|null",
  "completed_at": "<ISO8601>|null",
  "pid": <number>|null,
  "result_path": "<path>|null",
  "error": <error envelope>|null
}
```

## Why

codex-companion.mjs 패턴을 미러링하는 이유:
1. **사용자 학습 비용 0** — codex-plugin-cc 사용자가 즉시 이해
2. **검증된 패턴** — OpenAI 공식 플러그인이 이미 운영 중
3. **JSON envelope 표준화** — 라우터·QA가 일관된 인터페이스로 다룰 수 있음
4. **격리 강화** — background 모드의 detached child가 부모 컨텍스트와 완전 분리

자체 발명 대신 미러링하면 보고서 §5의 R3(라우터 오판), R6(OAuth) 위험을 codex 패턴에 검증된 방식으로 처리할 수 있다.

## 산출물 위치

- 스크립트: `plugins/ccp/plugins/ccp/scripts/antigravity-companion.mjs`
- 진행 보고: `_workspace/04_implementation_progress.md`

## 참조

- codex-companion.mjs 동작: 보고서 §1.1
- OAuth 흐름: self-dev 보고서 §3.3
