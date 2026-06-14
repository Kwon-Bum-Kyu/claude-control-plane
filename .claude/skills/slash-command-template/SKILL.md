---
name: slash-command-template
description: "Claude Code 플러그인 슬래시 커맨드 명세 작성 템플릿. 입력·출력·에러·권한 4축 구조. /antigravity:rescue 등 슬래시 커맨드 명세 작성 시 반드시 이 스킬을 사용."
---

# Slash Command Template — 슬래시 커맨드 명세 템플릿

CCP의 모든 슬래시 커맨드는 동일한 4축(입력·출력·에러·권한) 구조로 명세한다. codex-plugin-cc의 `/codex:rescue` 패턴을 기준으로 한다.

## 명세 템플릿

```markdown
## /antigravity:rescue

### 목적
{한 문장}

### 입력
| 인자 | 타입 | 필수 | 설명 | 예시 |
|------|------|------|------|------|
| `<task>` | string | yes | Antigravity에 위임할 작업 설명 | "이 디렉토리 요약해줘" |
| `--background` | flag | no | 비동기 실행 모드 | |
| `--max-tokens` | int | no | 응답 토큰 상한 | 4000 |

### 동작
1. `antigravity-companion.mjs`를 Bash로 호출
2. foreground 모드: 동기 stdout 스트리밍
3. background 모드: detached child + job ID 발급

### 출력 (foreground)
JSON envelope:
```json
{
  "summary": "3줄 이내 요약",
  "result_path": "_workspace/_jobs/<id>/result.md",
  "tokens": { "input": N, "output": M },
  "exit_code": 0
}
```

### 출력 (background)
```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "next_action": "/antigravity:status <job_id>"
}
```

### 에러 시나리오
| 코드 | 원인 | 사용자에게 표시할 메시지 |
|------|------|-------------------------|
| `E_ANTIGRAVITY_NOT_INSTALLED` | `agy` CLI 없음 | ux-designer 작성 메시지 |
| `E_OAUTH_EXPIRED` | OAuth 만료 | 재인증 안내 + Claude fallback |
| `E_INVALID_ARGS` | 인자 오류 | 사용법 표시 |

### 권한
- `allowed-tools: ["Bash"]`
- Bash 명령어 화이트리스트: `agy` 호출만 허용

### 합격 기준
- 정상 호출: 5초 안에 응답 또는 job ID 반환
- 에러: 모든 에러 envelope 일치, recovery 필드 포함
```

## 작성 원칙

- **모든 슬래시는 동일 4축 구조** (입력·출력·에러·권한). 누락 항목은 "없음"이라고 명시
- **JSON envelope는 모든 슬래시에서 통일**. envelope 변경은 architecture-reviewer 합의 필요
- **에러 메시지는 ux-designer 산출물 인용** (`01_error_messages.md`)
- **권한은 최소한**. allowed-tools에 Read·Write를 무조건 추가하지 말 것

## CCP 슬래시 목록 (MVP)

| 슬래시 | 역할 |
|--------|------|
| `/antigravity:rescue <task>` | Antigravity에 작업 위임 |
| `/antigravity:status <job_id>` | background job 상태 확인 |
| `/antigravity:result <job_id>` | background job 결과 회수 |
| `/antigravity:setup` | Antigravity CLI 설치/인증 검증 |
| `/ccp:audit` | harness-audit 실행 (7카테고리 점수) |

## Why

슬래시 커맨드는 사용자가 가장 직접적으로 만나는 인터페이스다. 인터페이스가 흔들리면 README·에러 메시지·내부 호출 코드가 모두 동기화 부담을 진다. 4축 구조 + JSON envelope 통일은 이 동기화 비용을 최소화한다.

## 산출물 위치

`_workspace/01_command_spec.md` (모든 슬래시 통합 명세)
