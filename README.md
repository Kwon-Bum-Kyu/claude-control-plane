# Claude Control Plane (CCP)

> Claude 를 메인 컨트롤 플레인으로 두고 Gemini CLI 를 서브에이전트로 오케스트레이션하는 **비공식 커뮤니티** Claude Code 플러그인.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.0-339933)](https://nodejs.org)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-%E2%89%A50.38.0-4285F4)](https://github.com/google-gemini/gemini-cli)

> ⚠️ **비공식 프로젝트**: CCP 는 Anthropic·Google 과 무관한 독립 커뮤니티 프로젝트입니다. "Claude", "Gemini", "Claude Code" 는 각 소유자의 상표이며, 본 프로젝트는 상호운용성 목적의 명목적 사용에 한합니다.

---

## 1. 소개

### CCP 가 해결하는 문제

대형 컨텍스트(코드베이스, 로그, 문서) 를 Claude 본체로 처리하면 메인 세션 토큰이 급증해 쿼터를 빠르게 소진합니다. CCP 는 이런 작업을 **Gemini CLI 에 위임**하고, 결과는 3줄 요약 + 디스크 경로로만 메인에 반환하여 **Claude 토큰 누계를 격리**합니다.

### 무엇을 하는가

- **자동 라우팅**: 입력 크기·키워드·사용자 의도·fallback 4축으로 Claude 본체 vs Gemini 위임을 자동 결정.
- **격리 envelope**: Gemini 응답 원문은 디스크에만 저장, 메인 세션엔 요약(≤500자) + `result_path` 만 전달.
- **가드레일**: 컨텍스트 75% 임계에서 사용자에게 자발적 `/compact` 권고 (자동 실행 금지).
- **감사**: `/ccp:audit` 으로 envelope 위반·라우터 오판·비밀 정보 누출을 정기 점검.

### 무엇을 하지 않는가 (MVP 범위 밖)

- Codex CLI 통합 (Phase 6+)
- Ralph 루프 자동화
- 한국어 매직 키워드 (`구조요청` 등)
- ML 기반 분류기 (현재는 규칙 기반)

### 대상 사용자

한국어 중심 개인 Pro 사용자 ~ 소규모 팀 리더. Claude 쿼터를 자주 소진하며 대형 로그·코드베이스를 다루는 워크로드.

---

## 2. 설치 (5분)

### 사전 조건

- Claude Code v1.0+ 설치
- Node.js ≥ 20.0
- **Gemini 사용**: Gemini CLI ≥ 0.38.0 + Google 계정 (자동 안내됨)
- **Codex 사용 (B1 신설)**: Codex CLI ≥ 0.122.0 + ChatGPT 계정 (자동 안내됨)

### 설치 명령

```
/plugin marketplace add claude-control-plane
/plugin install ccp
/gemini:setup        # gemini CLI·OAuth 진단
/ccp:codex-setup     # codex CLI·OAuth 진단 (B1)
```

`/gemini:setup` 과 `/ccp:codex-setup` 이 Node.js·각 CLI·OAuth 상태를 자동 진단합니다. 미설치 시 안내 명령:

```bash
# Gemini
npm install -g @google/gemini-cli@latest
gemini auth login

# Codex
brew install codex                  # macOS
# 또는 npm install -g @openai/codex
codex login                         # 브라우저로 ChatGPT 인증
```

### 성공 확인

```
/gemini:rescue "이 레포지토리의 README.md 를 3줄로 요약해"
```

3줄 요약 + 토큰 절감 추정 + `result_path` 가 출력되면 정상.

### 실패 시

[6. 트러블슈팅](#6-트러블슈팅) 섹션의 에러 코드 표를 참조하세요.

---

## 3. 빠른 시작

### 샘플 1 — README 요약 (작은 입력, 라우터 학습)

```
/gemini:rescue "이 레포지토리의 README.md 를 3줄로 요약해"
```

라우터가 입력 크기·키워드를 분석해 Claude 또는 Gemini 로 자동 분기합니다.

### 샘플 2 — 큰 로그 파일 위임 (대용량, background)

```
/gemini:rescue --background "/var/log/app/error.log 에서 최근 24시간 500 에러 Top 10 추출"
```

→ `job_id` 즉시 반환 → `/gemini:status <job_id>` 로 진행 확인 → `/gemini:result <job_id>` 로 요약 회수.

### 샘플 3 — 코드 리뷰 위임 (B1 신설)

```
/ccp:codex-rescue --cwd $(pwd) -- "이 PR 의 git diff 를 검토하고 잠재적 버그 5건 식별"
```

→ Codex 가 코드 리뷰에 강한 워크로드를 처리. 메인 컨텍스트로는 요약(≤500자) + `result_path` 만 회수.

### 샘플 4 — 절감량 감사

```
/ccp:audit --since 7d
```

8카테고리 점수 (context/cost/router/double_billing/fallback/plugin_compat/adapted_headers/secret_leak) 를 마크다운 리포트로 출력.

---

## 4. 슬래시 커맨드 레퍼런스

### 4.1 Gemini (대용량 요약·분석)

| 커맨드 | 요약 |
|--------|------|
| `/gemini:rescue <prompt>` | 무거운 작업을 Gemini 에 위임 |
| `/gemini:status <job_id>` | background job 상태 조회 |
| `/gemini:result <job_id>` | 완료된 job 의 요약+경로 회수 |
| `/gemini:setup [--renew]` | Gemini CLI·OAuth 환경 진단 |

### 4.2 Codex (코드 리뷰·diff·버그 조사) — B1 신설

| 커맨드 | 요약 |
|--------|------|
| `/ccp:codex-rescue <prompt>` | 코드 리뷰·diff 분석을 Codex 에 위임 |
| `/ccp:codex-status <job_id>` | background job 상태 조회 |
| `/ccp:codex-result <job_id>` | 완료된 job 의 요약+경로 회수 |
| `/ccp:codex-setup` | Codex CLI·OAuth 환경 진단 |

### 4.3 공통

| 커맨드 | 요약 |
|--------|------|
| `/ccp:audit [--since N --format md\|json]` | 토큰·envelope·라우팅 감사 |

상세 옵션은 `plugins/ccp/commands/*.md` 를 참조하세요.

### 4.4 주요 옵션

| 옵션 | gemini | codex | 설명 |
|------|:---:|:---:|------|
| `--background` | ✅ | ✅ | 백그라운드 실행, `job_id` 즉시 반환 |
| `--fallback-claude` | ✅ | ✅ | 라우터 결정 무시, Claude 본체로 처리 |
| `--timeout-ms N` | ✅ (default 600000) | ✅ (default 600000) | foreground timeout |
| `--poll-interval-ms N` | ✅ (2000) | ✅ (2000) | background polling 주기 |
| `--max-tokens N` | ✅ (default 4000) | ❌ | gemini 응답 토큰 상한 (prompt suffix 변환) |
| `--files <glob>` | ⚠️ MVP 미구현 (B13) | ❌ | gemini 첨부 파일 |
| `--model NAME` | ❌ | ✅ | codex 모델 별칭 |
| `--effort low\|medium\|high` | ❌ `CCP-INVALID-001` | ✅ (`-c model_reasoning_effort=`) | reasoning effort |
| `--sandbox MODE` | ❌ `CCP-INVALID-001` | ✅ (read-only/workspace-write/danger-full-access) | codex 샌드박스 |
| `--cwd DIR` | ❌ | ✅ | codex 작업 루트 |
| `--renew` | ✅ | (해당 없음 — `codex login` 직접 사용) | OAuth 재인증 안내 |

---

## 4.5 모델 호환성 매트릭스 (3-way)

`/ccp:codex-rescue` (codex), `/gemini:rescue` (gemini), Claude 본체(claude) 3 경로가 지원하는 옵션·기능 비교:

| 옵션 / 기능 | claude | gemini | codex | 비고 |
|---|:---:|:---:|:---:|---|
| `--background` (비동기) | ❌ | ✅ | ✅ | claude 는 메인 컨텍스트 본인이므로 N/A |
| `--wait` (background polling) | N/A | ✅ | ✅ | 양 companion 동일 |
| `--timeout-ms N` | N/A | ✅ (default 600000) | ✅ (default 600000) | foreground timeout |
| `--poll-interval-ms N` | N/A | ✅ (2000) | ✅ (2000) | polling 주기 |
| `--model NAME` | †`/model` 슬래시 | ✅ | ✅ | claude 는 Claude Code `/model` 슬래시로 변경 |
| `--effort low\|medium\|high` | ‡extended thinking | ❌ `CCP-INVALID-001` | ✅ `-c model_reasoning_effort=<level>` | claude 는 Option+T (extended thinking 토글) |
| `--sandbox <mode>` | N/A (실행 안 함) | ❌ | ✅ read-only/workspace-write/danger-full-access | codex 만 |
| `--write` | N/A | ❌ | ✅ (= `--sandbox workspace-write`) | codex 의 가독성 alias |
| `--cwd DIR` | N/A (대화 turn) | ❌ | ✅ (`-C`) | codex 만 |
| `--max-tokens N` | N/A | ✅ (prompt suffix 변환) | ❌ | gemini 만 |
| `--files <glob>` | (대화 첨부) | ⚠️ MVP 미구현 (B13) | ❌ | gemini 백로그 |
| `--resume-last` | N/A | ⚠️ MVP 미구현 (메타파일 흉내) | ✅ (`codex resume --last`) | codex 가 CLI 자체 지원 |
| OAuth 검증 | N/A | `gemini --version` + `~/.gemini/google_accounts.json` | `codex login status` (probe §5) | 양 companion 30s timeout |

**범례:** ✅ 지원 / ❌ `CCP-INVALID-001` 또는 `CCP-UNSUPPORTED-001` 거부 / ⚠️ 부분 매핑 / N/A 해당 없음
**각주:**
- ‡ Claude extended thinking: `Option+T` 토글 또는 `~/.claude/settings.json` 의 `alwaysThinkingEnabled`
- † Claude `/model` 슬래시: Claude Code 내장 명령
- gemini ❌ 표시 옵션이 인자로 새어 들어오면 즉시 `CCP-INVALID-001` (companion 인라인 거부, B1-S3-5)

자세한 결정 근거: [`ATTRIBUTION.md`](./ATTRIBUTION.md) §1.3·1.4·6 (Codex 통합 차용 함수 매핑)

---

## 5. 라우터 동작 (3-way — B1 확장)

CCP 라우터는 **4축 우선순위** 로 Claude / Gemini / Codex 3 경로 중 하나를 결정합니다.

```
사용자 명시 (axis A) → 입력 크기 (axis B) → 키워드 (axis C) → fallback (axis D)
   /gemini, /codex,        >30K → Gemini   요약→gemini / 리뷰→codex    Claude (보수)
   --effort, --sandbox     5K~30K + review→Codex
```

```
[사용자 프롬프트]
       ↓
   [axis A] /gemini:rescue / /ccp:codex-rescue / --fallback-claude / --effort / --sandbox
       ↓ (없으면)
   [axis B] estimated_tokens > 30,000 → Gemini  (review 키워드 동시 매칭 시 Codex)
            5,000 ≤ tokens ≤ 30,000 + review 키워드 → Codex
       ↓ (이내)
   [axis C] 메인 컨텍스트 의존 키워드 (방금/위에서/...) → Claude 강제
            그 외 키워드 사전: codex(코드 리뷰/diff) > gemini(요약/대용량) > claude
       ↓ (매칭 없으면)
   [axis D] fallback → Claude (보수적)
```

- **자동화 검증**: 50 케이스 데이터셋에서 정확도 **100%**, P/R ≥ 0.93 모든 모델.
- **투명성**: 모든 호출 결과 `details.mode` 필드에 결정 결과 노출 (`gemini` | `codex`).
- **추천 훅 활성** (B19, v0.2): UserPromptSubmit 시 결정 결과를 `[CCP-ROUTER-001]` system reminder 로 주입. 자동 위임은 미수행 — 사용자가 직접 슬래시 호출.

### 5.1 토큰 절감 패턴 (canonical 권장)

CCP 의 토큰 절감 효과는 **인터랙티브 슬래시 직접 트리거** 패턴에서 가장 강하게 작동합니다.

```
✅ 권장:  /gemini:rescue 이 디렉토리 전체 요약
✅ 권장:  /ccp:codex-rescue 이 PR diff 검토
```

이 패턴에서 envelope 캡(≤500자) + result_path 영속화가 작동해 메인 Claude 컨텍스트 토큰 누적을 차단합니다. 본 프로젝트 T5 fixture canonical 측정 (N=2): 메인 846K + 외부 오프로드 179K = 총 1,025K.

### 5.2 헤드리스 자동화 권고 패턴 (B21-3)

`claude -p` 헤드리스 호출에서는 모델이 위임 진입점을 탐색하다가 메타 우회(예: `Skill→Agent→companion --help`)를 12회까지 누적해 토큰이 오히려 2.1배 증가하는 사례가 보고되었습니다 (B9 §8.5.4). 헤드리스 자동화에서 위임 효과를 보려면 다음 패턴을 사용하세요.

```bash
# ✅ 권장 1: 슬래시 사전 스크립트화
claude -p "/gemini:rescue 이 디렉토리 전체 요약" -- ...

# ✅ 권장 2: companion 직접 호출 (메타 진입점 우회 차단)
node plugins/ccp/scripts/gemini-companion.mjs rescue --task "이 디렉토리 요약"
node plugins/ccp/scripts/codex-companion.mjs rescue --task "PR diff 검토"

# ❌ 금지: rescue --help / Skill→Agent 우회 / 동일 task 변형 재시도
```

`hooks/router-suggest.js` 가 `headless|claude -p|스크립트|자동화|automation|cron|CI` 키워드를 감지하면 `[CCP-META-WARN]` 안내를 자동 추가합니다.

오판 의심 시 `/ccp:audit` 으로 router_accuracy 카테고리 점수를 확인하세요.

---

## 6. 트러블슈팅

### 6.1 Gemini 측 에러 코드

| 코드 | 빈도 | 다음 행동 |
|------|:----:|----------|
| `CCP-OAUTH-001` | ★★★ | `gemini auth login` 후 `/gemini:setup` 재실행 |
| `CCP-SETUP-001` | ★★★ | `npm install -g @google/gemini-cli@latest` |
| `CCP-SETUP-002` | ★★ | Node.js 20+ 설치 (nvm 권장) |
| `CCP-GEMINI-001` | ★★ | 잠시 후 재시도 또는 `/gemini:rescue --fallback-claude` |
| `CCP-CTX-001` | ★ | summary 길이 초과 — 입력 축소 |
| `CCP-ROUTER-001` | ★ | `/ccp:audit` 으로 라우터 결정 검토 |
| `CCP-COMPACT-001` | ★ | `/compact` 수동 실행 |
| `CCP-JOB-001~004` | ★ | `/gemini:status` 로 job 상태 재확인 |

### 6.2 Codex 측 에러 코드 (B1 신설)

| 코드 | 빈도 | 다음 행동 |
|------|:----:|----------|
| `CCP-OAUTH-101` | ★★★ | `codex login` 으로 ChatGPT 인증 후 `/ccp:codex-setup` 재실행 |
| `CCP-SETUP-101` | ★★★ | `brew install codex` 또는 `npm install -g @openai/codex` |
| `CCP-SETUP-102` | ★★ | `brew upgrade codex` 또는 npm 재설치 (≥ 0.122.0 필요) |
| `CCP-CODEX-001` | ★★ | stderr 로그 확인 후 재시도 또는 `/ccp:codex-rescue --fallback-claude` |
| `CCP-CODEX-002` | ★ | JSONL 파싱 실패 — `--verbose` 또는 stderr 확인 후 재시도 |
| `CCP-JOB-001~004` | ★ | `/ccp:codex-status` 로 job 상태 재확인 |
| `CCP-JOB-409` | ★ | 현재 상태에서는 취소 불가 — 상태 확인 후 재시도 |
| `CCP-INVALID-001` | ★ | gemini 측에서 codex 전용 옵션(`--effort`/`--sandbox`/`--write`) 사용 시 — 슬래시 변경 |

### 6.3 공통

| 코드 | 빈도 | 다음 행동 |
|------|:----:|----------|
| `CCP-TIMEOUT-001` | ★★ | 재시도 또는 `--background` 권장 (foreground default 600s) |
| `CCP-AUDIT-001~002` | ★ | `--since` 범위 조정 또는 로그 확인 |

전체 카탈로그는 `plugins/ccp/scripts/gemini-companion.mjs`·`codex-companion.mjs` 의 `ERROR_CATALOG` 를 참조하세요.

### 6.4 자주 묻는 질문

- **Gemini 무료 티어 한도는?** 60 req/min (`gemini-2.5-pro`). 정확한 값은 Google 계정 정책에 따릅니다.
- **Codex 무료 티어 한도는?** ChatGPT Plus/Pro 구독에 포함된 사용량 한도를 따릅니다. 정확한 값은 OpenAI 정책에 따릅니다.
- **OAuth 만료 주기는?** Google ~7일, ChatGPT 는 보통 30일+. 만료 시 각각 `CCP-OAUTH-001`/`CCP-OAUTH-101` 가 자동 안내합니다.
- **권한 오류 (`npm i -g`)?** nvm 사용 또는 `sudo` 실행. nvm 권장.
- **브라우저 미접근 환경?** Gemini: `GEMINI_API_KEY` 또는 `gemini auth login --no-browser`. Codex: `codex login --device-auth` (장치 코드 흐름).
- **`--effort` 가 gemini 측에서 거부된다?** 의도된 동작 — 호환성 매트릭스(§4.5) 참고. codex 전용 옵션이므로 `/ccp:codex-rescue --effort high -- "<task>"` 형태로 사용하세요.
- **codex 가 stdin 무한 대기?** companion 이 자동으로 `stdio: ['ignore', ...]` 강제. 수동으로 `codex exec` 호출 시에는 `</dev/null` 필수.
- **`Reading additional input from stdin...` stderr 메시지?** codex CLI 의 정상 동작 (probe §3.2). 무해 — companion 이 자동 흡수합니다.

---

## 7. 라이선스·크레딧

### 7.1 본 프로젝트

[MIT License](./LICENSE) — © 2026 CCP Contributors

### 7.2 차용 코드 (Borrowed)

- **everything-claude-code (ecc)** by affaan-m — MIT (SHA `c7c7d37f...`, snapshot 2026-04-30)
  - `plugins/ccp/hooks/suggest-compact.js` (PreCompact 가드레일)
  - `plugins/ccp/skills/context-budget/SKILL.md` (컨텍스트 임계 안내)
  - `plugins/ccp/scripts/harness-audit.js` (감사 8카테고리 루브릭)
- **codex-plugin-cc** by OpenAI — Apache-2.0 (SHA `8e873d6f...`, release/v1.0.4) — **B1 신설, 함수 단위 차용**
  - `plugins/ccp/scripts/lib/codex_adapted/{state,tracked-jobs,process,args,job-control}.mjs`
  - 5필드 헤더 의무 (Adapted from / Source / License / Modifications / SHA), audit G1-I 강제 검사
  - Apache-2.0 NOTICE: [./NOTICE](./NOTICE)
- 상세 변경 내역: [ATTRIBUTION.md](./ATTRIBUTION.md)

### 7.3 런타임 의존성

| 패키지 | 라이선스 | 번들 |
|--------|----------|:----:|
| `@google/gemini-cli` (≥0.38.0) | Apache-2.0 | 외부 (사용자 설치) |
| `@openai/codex` (≥0.122.0) | Apache-2.0 | 외부 (사용자 설치) |
| Node.js (≥20.0) | MIT | 외부 |

번들 바이너리 없음. 외부 API 약관 (Google Gemini, OpenAI Codex, Anthropic Claude) 은 각 사용자 책임.

### 7.4 상표 면책

> Claude Control Plane 은 Anthropic·Google·OpenAI 와 무관한 독립 커뮤니티 프로젝트입니다. 'Claude', 'Gemini', 'Claude Code', 'Codex' 는 각 소유자의 상표이며, 본 프로젝트는 해당 도구와의 상호운용성(interoperability) 을 위해 명목적으로만 상표를 사용합니다.

---

## 8. v0.2 로드맵 (B1 분리 항목)

| ID | 항목 | 진입 조건 |
|---|---|---|
| B18 | codex review·adversarial-review 슬래시 | B1 합격 + git diff 추출 로직 설계 |
| B19 | 라우터 자동 위임 활성화 + UserPromptSubmit 추천 훅 | 추천 정확도 데이터 수집 |
| B20 | codex 신규 회귀 케이스 14건 추가 (50+ 데이터셋) | B19 진입 시 |
| B21 | 토큰 절감 v0.2 측정 (B9 실측 결과 통합) | B9 리포트 수신 + 측정 단위 SSOT 재검토 |
| B22 | SessionEnd 훅으로 background job 메타 정리 | 메타파일 잔존 사용자 보고 시 |
| B23 | options schema 도입 검토 | 옵션 종류 N+5 이상 추가 시 (현 13개) |

자세한 백로그: [GitHub Issues](https://github.com/) 또는 [`CHANGELOG.md`](./CHANGELOG.md) 참조

---

## 9. 기여

기여 가이드, DCO 서명 방법, 커밋 규약은 [CONTRIBUTING.md](./CONTRIBUTING.md) 를 참조하세요.

한국어 이슈·PR 환영합니다. `feat/`, `fix/`, `docs/` 브랜치 명명 권장.

---

## 10. English Summary

**What is CCP?** A community Claude Code plugin that uses Claude as the main control plane and offloads heavy-context tasks (large codebases, logs, doc summaries) to Gemini CLI. Gemini output is isolated to disk; only a 3-line summary + result path enters the main Claude session, preventing token-bill double-counting.

**Install (5 min):**

```
/plugin marketplace add claude-control-plane
/plugin install ccp
/gemini:setup
/gemini:rescue "summarize this README in 3 lines"
```

**Requirements:** Claude Code v1.0+, Node.js ≥ 20, Gemini CLI ≥ 0.38.0 (auto-prompted), Google account.

**Disclaimer:** Independent community project, not affiliated with or endorsed by Anthropic or Google. "Claude", "Gemini", and "Claude Code" are trademarks of their respective owners; used nominatively for interoperability only.

**Docs:** Korean-first. English translation welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

**License:** [MIT](./LICENSE) · See [ATTRIBUTION.md](./ATTRIBUTION.md) for third-party credits.
