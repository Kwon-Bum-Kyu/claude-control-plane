# 트러블슈팅

CCP 의 모든 에러는 `CCP-<카테고리>-<NNN>` 코드, 한 줄 `message`, 다음에 입력할 `action`, 그리고 `recovery` enum 을 가집니다. 본 문서는 가장 빈번한 코드를 표면별로 정리합니다.

## Gemini 측 에러

| 코드 | 빈도 | 다음 행동 |
|---|:---:|---|
| `CCP-OAUTH-001` | ★★★ | `gemini` 한 번 실행해 OAuth 트리거 (또는 `GEMINI_API_KEY` 설정) 후 `/gemini:setup` 재실행 |
| `CCP-SETUP-001` | ★★★ | `npm install -g @google/gemini-cli@latest` |
| `CCP-SETUP-002` | ★★ | Node.js 20+ 설치 (nvm 권장) |
| `CCP-GEMINI-001` | ★★ | 잠시 후 재시도 또는 `/gemini:rescue --fallback-claude` |
| `CCP-CTX-001` | ★ | summary 가 500자 초과 — 입력 축소 |
| `CCP-ROUTER-001` | ★ | `/ccp:audit` 으로 라우터 결정 검토 |
| `CCP-COMPACT-001` | ★ | `/compact` 수동 실행 |
| `CCP-JOB-001` ~ `CCP-JOB-004` | ★ | `/gemini:status <job_id>` 로 job 상태 재확인 |

## Codex 측 에러

| 코드 | 빈도 | 다음 행동 |
|---|:---:|---|
| `CCP-OAUTH-101` | ★★★ | `codex login` 후 `/ccp:codex-setup` 재실행 |
| `CCP-SETUP-101` | ★★★ | `brew install codex` 또는 `npm install -g @openai/codex` |
| `CCP-SETUP-102` | ★★ | `brew upgrade codex` (≥ 0.122.0 필요) |
| `CCP-CODEX-001` | ★★ | `result_path` 의 stderr 확인 후 재시도 또는 `--fallback-claude` |
| `CCP-CODEX-002` | ★ | JSONL 파싱 실패 — `--verbose` 또는 stderr 확인 후 재시도 |
| `CCP-JOB-001` ~ `CCP-JOB-004` | ★ | `/ccp:codex-status <job_id>` 로 재확인 |
| `CCP-JOB-409` | ★ | 현 상태에서 취소 불가 — 상태 확인 후 재시도 |
| `CCP-INVALID-001` | ★ | Codex 전용 플래그 (`--effort`/`--sandbox`/`--write`) 가 `/gemini:rescue` 에 들어왔습니다 — `/ccp:codex-rescue` 사용 |

## 공통 에러

| 코드 | 빈도 | 다음 행동 |
|---|:---:|---|
| `CCP-TIMEOUT-001` | ★★ | 재시도 또는 `--background` (foreground default 600s) |
| `CCP-AUDIT-001` / `CCP-AUDIT-002` | ★ | `--since` 윈도 조정 또는 스크립트 로그 확인 |

전체 카탈로그는 `plugins/ccp/scripts/gemini-companion.mjs` 와 `codex-companion.mjs` 의 `ERROR_CATALOG` 상수에 있습니다.

## 자주 묻는 질문

**무료 티어 한도는?**
Gemini: 무료 Google 계정 기준 `gemini-2.5-pro` 가 분당 약 60 req. 정확한 값은 Google 정책에 따릅니다.
Codex: ChatGPT Plus/Pro 구독 사용량 한도에 포함. 정확한 값은 OpenAI 정책에 따릅니다.

**OAuth 만료 주기는?**
Google ~7일, ChatGPT 보통 30일+. 만료 시 `CCP-OAUTH-001` / `CCP-OAUTH-101` 가 자동 안내됩니다.

**`npm i -g` 권한 에러?**
nvm 사용 권장, 또는 `sudo` 실행. nvm 우선.

**브라우저 미접근 환경?**
- Gemini: `GEMINI_API_KEY` 환경변수 설정 (https://aistudio.google.com/apikey)
- Codex: `codex login --device-auth` (장치 코드 흐름) 또는 `printenv OPENAI_API_KEY | codex login --with-api-key`

**`--effort` 가 Gemini 측에서 거부된다?**
의도된 동작입니다. `--effort` 는 Codex 전용입니다. `/ccp:codex-rescue --effort high -- "<task>"` 형태로 사용하세요. [호환성 매트릭스](./slash-commands.md#3-way-호환성) 참고.

**Codex 가 stdin 에서 멈춘다?**
companion 이 `stdio: ['ignore', ...]` 를 강제합니다. `codex exec` 를 수동 호출하는 경우 `</dev/null` 을 붙이세요.

**`Reading additional input from stdin...` stderr 메시지?**
Codex CLI 의 정상 동작입니다. 무해하며 companion 이 자동 흡수합니다.

## setup 점검

두 setup 커맨드는 멱등합니다. 환경 변경이 의심될 때마다 실행하세요.

```text
/gemini:setup            # Node + Gemini CLI + OAuth
/gemini:setup --renew    # OAuth 재인증까지 안내
/ccp:codex-setup         # Node + Codex CLI + OAuth
```

각 setup 은 감지된 버전을 출력합니다. 문서화된 최소값 (`Node ≥ 20`, `Gemini ≥ 0.38.0`, `Codex ≥ 0.122.0`) 미달이면 `CCP-SETUP-*` 코드로 표시됩니다.

## 버그 신고 시점

에러 코드가 누락되었거나, action 이 message 와 맞지 않거나, `CCP-CODEX-*` / `CCP-GEMINI-*` 가 재시도 후에도 반복되면 issue 템플릿으로 신고해주세요. envelope JSON 과 `/gemini:setup` · `/ccp:codex-setup` 의 출력을 첨부해주세요.

## 관련 문서

- [라우터 동작](./router.md) — `CCP-ROUTER-001`
- [슬래시 커맨드 레퍼런스](./slash-commands.md) — `CCP-INVALID-001`
- [아키텍처](./architecture.md) — 7원칙 (자동 fallback 금지 포함)
