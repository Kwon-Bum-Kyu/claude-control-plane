---
description: Gemini CLI 설치·OAuth 상태를 검증하고 실패 시 설치/재인증 가이드를 제시합니다.
argument-hint: "[--renew]"
allowed-tools:
  - Bash
---

# /gemini:setup

Gemini CLI 설치 여부와 OAuth 인증 상태를 검증합니다. 실패 시 설치·재인증 가이드를 한국어로 제시합니다 (AC-3 — 신규 사용자 5분 내 첫 호출 ≥ 90%).

## 사용법

```
/gemini:setup [--renew]
```

| 인자 | 설명 |
|------|------|
| `--renew` | 재인증 모드 안내 (사용자에게 `gemini auth login` 실행 요청) |

## 실행 동작

1. Node.js 버전 검증 (≥ v20). 미달 시 `CCP-SETUP-002`.
2. `gemini --version` 실행 → 미설치 또는 < 0.38.0 시 `CCP-SETUP-001`.
3. **OAuth 상태 추정 3단** (`gemini auth status` 미지원 — R17 정정 결과):
   - (a) env `GEMINI_API_KEY` 존재 여부 → `auth_method: "api_key"`
   - (b) `~/.gemini/google_accounts.json` 파일 존재 여부 → `auth_method: "oauth"`
   - (c) probe 호출 `gemini -p "ping" -o json` → exit code + stderr 검사
4. 어느 하나라도 OAuth 만료 신호 → `CCP-OAUTH-001` + 재인증 안내.
5. 모두 정상 → `details: {gemini_version, oauth_status: "valid", auth_method}` envelope.

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup
```

## 출력 (성공)

```json
{
  "summary": "Gemini CLI 설치 및 인증 상태 정상",
  "result_path": null,
  "tokens": { "input": 0, "output": 0 },
  "exit_code": 0,
  "details": {
    "gemini_version": "0.38.2",
    "oauth_status": "valid",
    "auth_method": "oauth"
  }
}
```

> **S2-5 details 수납 규칙 (`_workspace/01_schema.md` §2.1):** `gemini_version`/`oauth_status`/`auth_method` 는 envelope 루트가 아닌 `details` 서브오브젝트에 수납. 슬래시간 envelope 일관성 유지.

## 에러 코드

| 코드 | 원인 | recovery | 권장 응답 |
|------|------|:---:|----------|
| `CCP-SETUP-001` | Gemini CLI 미설치 또는 < 0.38.0 | abort | `npm install -g @google/gemini-cli@latest` |
| `CCP-SETUP-002` | Node.js < v20 | abort | nvm 사용 또는 공식 Node 다운로드 |
| `CCP-OAUTH-001` | OAuth 자격 부재/만료 | fallback | `gemini auth login` 후 `/gemini:setup` 재실행 |

## 합격 기준 (PRD §7)

- 5초 내 응답.
- 첫 호출 성공률 ≥ 90% (AC-3).
- 에러 시 사용자가 다음 행동을 즉시 알 수 있도록 한국어 메시지 제공.

## 명세 SSOT

- `_workspace/01_command_spec.md` §"/gemini:setup"
- `_workspace/03_gemini_cli_probe.md` §T4 (`gemini auth status` 미지원 근거)
- `_workspace/01_error_messages.md` `CCP-SETUP-001`, `CCP-SETUP-002`, `CCP-OAUTH-001`
- `_workspace/01_onboarding.md` (UX 흐름)
