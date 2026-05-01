---
description: Codex CLI 설치·OAuth 상태를 검증하고 실패 시 설치/재인증 가이드를 제시합니다.
argument-hint: ""
allowed-tools:
  - Bash
---

# /ccp:codex-setup

Codex CLI 설치 여부와 OAuth 인증 상태를 검증합니다. 실패 시 설치·재인증 가이드를 한국어로 제시합니다.

## 사용법

```
/ccp:codex-setup
```

## 실행 동작

1. Node.js 버전 검증 (≥ v20). 미달 시 `CCP-SETUP-002`.
2. `codex --version` 실행 → 미설치 시 `CCP-SETUP-101`, < 0.122.0 시 `CCP-SETUP-102`.
3. `codex login status` 실행 (probe §5 — stderr 에 "Logged in using ChatGPT" 출력) → 인증 부재 시 `CCP-OAUTH-101`.
4. 모두 정상 → `details: {codex_version, node_version, mode: "codex"}` envelope.

## 호출 패턴

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" setup
```

## 출력 (성공)

```json
{
  "summary": "Codex CLI 0.122.0 인증 확인 완료. Logged in using ChatGPT",
  "result_path": null,
  "tokens": { "input": 0, "output": 0, "total": 0 },
  "exit_code": 0,
  "details": {
    "mode": "codex",
    "codex_version": "0.122.0",
    "node_version": "22.12.0"
  }
}
```

## 에러 코드

| 코드 | 원인 | recovery | 권장 응답 |
|------|------|:---:|----------|
| `CCP-SETUP-101` | Codex CLI 미설치 | abort | `brew install codex` 또는 `npm install -g @openai/codex` |
| `CCP-SETUP-102` | Codex CLI < 0.122.0 | abort | `brew upgrade codex` 또는 npm 재설치 |
| `CCP-SETUP-002` | Node.js < v20 | abort | nvm 사용 또는 공식 Node 다운로드 |
| `CCP-OAUTH-101` | Codex 인증 부재 | fallback_claude | `codex login` 실행 후 재시도 |

## 합격 기준

- 5초 내 응답 (probe §2: `codex login status` 0.106s + cold start 마진).
- 에러 시 한국어 가이드.

## 명세 SSOT

- `_workspace/06_codex_cli_probe.md` §1, §2, §5
- `_workspace/06_codex_function_mapping.md` §1
- `plugins/ccp/schemas/envelope.schema.json` (출력 self-validate)
