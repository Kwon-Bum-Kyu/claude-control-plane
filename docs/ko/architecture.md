# 아키텍처

CCP 는 7원칙과 단일 envelope 스키마로 구성됩니다. 본 문서는 두 가지를 요약합니다. 스키마 SSOT 는 `plugins/ccp/schemas/envelope.schema.json` 입니다.

## 7원칙

### 1. 단일 에러 코드 네임스페이스

CCP 가 반환하는 모든 에러는 `CCP-<카테고리>-<NNN>` 형식 (예: `CCP-OAUTH-001`) 입니다. 카테고리: `OAUTH`, `SETUP`, `GEMINI`, `CODEX`, `CTX`, `ROUTER`, `JOB`, `INVALID`, `TIMEOUT`, `AUDIT`, `COMPACT`, `META`. 각 코드는 고정된 `action` 문자열과 `recovery` enum 에 매핑됩니다.

이유: 기계 파싱 가능한 에러와 예측 가능한 사용자 복구 절차. 영어 free-text 에러 누락 차단.

### 2. envelope 필수 필드

모든 슬래시 커맨드와 서브에이전트는 stdout 에 정확히 하나의 JSON 객체를 출력합니다 — 6키 스키마로 검증.

```json
{
  "summary": "...",            // string, ≤ 500자 (RC-1)
  "result_path": "...",        // string|null
  "tokens": {                  // 측정 단위 SSOT
    "input": 0,
    "output": 0,
    "cached": 0,
    "total": 0
  },
  "exit_code": 0,
  "details": { "mode": "gemini" }
}
```

에러는 `summary`/`tokens`/`result_path` 대신 `error` 객체 (필수 `code`/`message`/`action`/`recovery`) 를 가집니다. 두 companion 모두 출력 직전에 자기 검증합니다. 스키마 SSOT: `plugins/ccp/schemas/envelope.schema.json`.

### 3. 단일 디스크 영속 루트

모든 job 상태·원본 출력·감사 리포트는 `_workspace/_jobs/` 와 `_workspace/_audits/` 아래에 저장됩니다. companion 은 이 루트 밖에 쓰지 않습니다. 공개 레포에서는 gitignore 처리되어 사용자 job 내용이 누출되지 않습니다.

### 4. 자동 fallback 금지 (사용자 의도 재호출)

위임이 실패할 때 (OAuth 만료, CLI 미설치, 네트워크 오류 등) CCP 는 **조용히** Claude 나 다른 모델로 재시도하지 **않습니다**. 대신 envelope 이 `recovery` enum (`retry`, `fallback_claude`, `abort`, `user_action_required`) 과 `action` 문자열로 사용자가 무엇을 입력해야 하는지 알려줍니다. 사용자가 명시적으로 재호출합니다.

이유: 조용한 fallback 은 토큰 청구를 부풀리고 실제 실패를 숨깁니다. router-suggest 훅도 동일 원칙을 따릅니다 — 슬래시를 추천만, 실행은 안 합니다.

### 5. 2단계 훅 시그널

훅은 슬래시 커맨드를 보강하되 대체하지 않습니다.

- `UserPromptSubmit` → `router-suggest.js` 가 `[CCP-ROUTER-001]` 추천 (헤드리스 의심 시 `[CCP-META-WARN]` 추가) 주입.
- `PreCompact` → `suggest-compact.js` 가 메인 컨텍스트 75% / 90% 임계 도달 시 경고.

훅은 Claude Code 가 제공하는 JSON stdin 계약을 사용합니다. exec 기반 셸 훅 사용 금지.

### 6. 네임스페이스 이원화 (`/gemini:*` vs `/ccp:*`)

Gemini 커맨드는 자체 네임스페이스를 가집니다 — 사용자가 Gemini 를 무거운 요약 도구로 인식하는 멘탈 모델이 오래되어서. Codex 와 공통 커맨드는 `/ccp:*` — CCP 고유의 오케스트레이션이므로. 이 분리는 의도적이며 임의로 바뀌지 않습니다.

### 7. 서브에이전트 격리 강제

서브에이전트 (`gemini-rescue`, `codex-rescue`) 는 envelope 외 경로로는 메인 Claude 컨텍스트에 쓸 수 없습니다. CLI 의 verbose 출력도 결과 파일로 리다이렉션되며, 한정된 요약만 회귀합니다. 감사 카테고리 `double_billing` 과 `secret_leak` 이 이 격리 누출을 탐지합니다.

## 토큰 절감 패턴

CCP 의 토큰 절감 효과는 **canonical** 트리거에서 가장 강하게 작동합니다.

```text
✅  /gemini:rescue 이 디렉터리 요약
✅  /ccp:codex-rescue 이 PR diff 검토
```

이 패턴에서 envelope 캡 (≤500자) + `result_path` 영속화가 작동해 메인 Claude 컨텍스트의 Gemini 출력 누적을 차단합니다. 실측 (T5 fixture, N=2): 메인 846K + 오프로드 179K = 총 1,025K.

**헤드리스** 트리거 (`claude -p ...`, 스크립트 자동화) 에서는 모델이 위임 진입점을 탐색합니다 — `rescue --help` 호출, Skill → Agent → companion traversal, 변형 프롬프트 재시도 — 토큰이 오히려 2.1배 증가하는 사례가 있습니다. 헤드리스에서는 슬래시를 사전 스크립트화하세요.

```bash
# 권장: 슬래시 사전 스크립트화
claude -p "/gemini:rescue 이 디렉터리 요약"
claude -p "/ccp:codex-rescue 이 PR diff 검토"

# 금지: rescue --help 루프, Skill → Agent traversal, 동일 task 변형 재시도
```

router-suggest 훅이 헤드리스 의심 시 `[CCP-META-WARN]` 안내를 자동 주입합니다.

## 차용 코드

CCP 는 상위 프로젝트의 코드를 원본 라이선스 그대로 차용합니다. 라이선스 원문은 `LICENSES/` 디렉터리에 보존됩니다. harness audit 의 `borrowed_code_documented` 카테고리가 PR 마다 `LICENSES/` 의 라이선스 원문 존재 여부를 강제 검사합니다.

- **everything-claude-code (ecc)** — MIT — `hooks/suggest-compact.js`, `skills/context-budget/SKILL.md`, `scripts/harness-audit.js`
- **codex-plugin-cc** — Apache-2.0 — `scripts/lib/codex-{state,tracked-jobs,process,args,job-control}.mjs`
- **oh-my-claudecode (omc)** — MIT — `scripts/lib/magic-keywords.mjs`

라이선스 원문: `LICENSES/`.

## 관련 문서

- [라우터 동작](./router.md) — 4축 결정
- [슬래시 커맨드 레퍼런스](./slash-commands.md) — 모든 커맨드·플래그
- [트러블슈팅](./troubleshooting.md) — 에러 코드 카탈로그
