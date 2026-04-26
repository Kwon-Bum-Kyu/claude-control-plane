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
- Gemini CLI ≥ 0.38.0 (자동 안내됨)
- Google 계정 (Gemini OAuth)

### 설치 명령

```
/plugin marketplace add claude-control-plane
/plugin install ccp
/gemini:setup
```

`/gemini:setup` 이 Node.js·Gemini CLI·OAuth 상태를 자동 진단하고, 미설치 시 다음 명령을 안내합니다:

```bash
npm install -g @google/gemini-cli@latest
gemini auth login
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

### 샘플 3 — 절감량 감사

```
/ccp:audit --since 7d
```

7카테고리 점수 (envelope·router·secret_leak·context_budget·dependency·attribution·scope) 를 마크다운 리포트로 출력.

---

## 4. 슬래시 커맨드 레퍼런스

| 커맨드 | 요약 |
|--------|------|
| `/gemini:rescue <prompt>` | 무거운 작업을 Gemini 에 위임 (라우터가 자동 결정) |
| `/gemini:status <job_id>` | background job 상태 조회 |
| `/gemini:result <job_id>` | 완료된 job 의 요약+경로 회수 |
| `/gemini:setup [--renew]` | Gemini CLI·OAuth 환경 진단 |
| `/ccp:audit [--since N --format md\|json]` | 토큰·envelope·라우팅 감사 |

상세 옵션은 `plugins/ccp/commands/*.md` 를 참조하세요.

### 주요 옵션

| 옵션 | 적용 | 설명 |
|------|------|------|
| `--background` | rescue | 백그라운드 실행, `job_id` 즉시 반환 |
| `--fallback-claude` | rescue | 라우터 결정 무시, Claude 본체로 처리 |
| `--files <glob>` | rescue | Gemini 에 첨부할 파일 (플러그인 루트 내부만) |
| `--renew` | setup | OAuth 재인증 안내 |

---

## 5. 라우터 동작

CCP 라우터는 **4축 우선순위** 로 결정합니다:

```
사용자 명시 (axis A) → 입력 크기 (axis B) → 키워드 (axis C) → fallback (axis D)
       Gemini/Claude       >30K → Gemini       사전 18+24어         Claude (보수)
```

```
[사용자 프롬프트]
       ↓
   [axis A] /gemini:rescue --force-claude / --fallback-claude
       ↓ (없으면)
   [axis B] estimated_tokens > 30,000 → Gemini
       ↓ (이내)
   [axis C] 키워드 사전 (요약/리뷰/리팩터/코드베이스 등)
       ↓ (매칭 없으면)
   [axis D] fallback → Claude (보수적)
```

- **자동화 검증**: 36 케이스 데이터셋에서 정확도 100%, P/R ≥ 0.93 (`_workspace/04_router_report.md`).
- **투명성**: 모든 호출 결과 `details.mode` 필드에 결정 결과 노출.

오판 의심 시 `/ccp:audit` 으로 라우터 카테고리 점수를 확인하세요.

---

## 6. 트러블슈팅

### 자주 보는 에러 코드

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

전체 카탈로그는 `plugins/ccp/scripts/gemini-companion.mjs` `ERROR_CATALOG` 를 참조하세요.

### 자주 묻는 질문

- **Gemini 무료 티어 한도는?** 60 req/min (`gemini-2.5-pro`). 정확한 값은 Google 계정 정책에 따릅니다.
- **OAuth 만료 주기는?** Google 정책상 약 7일. 만료 시 `CCP-OAUTH-001` 가 자동 안내합니다.
- **권한 오류 (`npm i -g`)?** nvm 사용 또는 `sudo` 실행. nvm 권장.
- **브라우저 미접근 환경?** 환경변수 `GEMINI_API_KEY` 설정 또는 `gemini auth login --no-browser` 모드 활용.

---

## 7. 라이선스·크레딧

### 7.1 본 프로젝트

[MIT License](./LICENSE) — © 2026 CCP Contributors

### 7.2 차용 코드 (Borrowed)

- **everything-claude-code (ecc)** by affaan-m — MIT
  - `plugins/ccp/hooks/suggest-compact.js` (PreCompact 가드레일)
  - `plugins/ccp/skills/context-budget/SKILL.md` (컨텍스트 임계 안내)
  - `plugins/ccp/scripts/harness-audit.js` (감사 7카테고리 루브릭)
- 상세 변경 내역: [ATTRIBUTION.md](./ATTRIBUTION.md)

### 7.3 구조 참조 (Inspired by)

- **codex-plugin-cc** by OpenAI — MIT (디렉토리 구조·companion 패턴)

### 7.4 런타임 의존성

| 패키지 | 라이선스 | 번들 |
|--------|----------|:----:|
| `@google/gemini-cli` (≥0.38.0) | Apache-2.0 | 외부 (사용자 설치) |
| Node.js (≥20.0) | MIT | 외부 |

번들 바이너리 없음. 외부 API 약관 (Google Gemini, Anthropic Claude) 은 각 사용자 책임.

### 7.5 상표 면책

> Claude Control Plane 은 Anthropic·Google 과 무관한 독립 커뮤니티 프로젝트입니다. 'Claude', 'Gemini', 'Claude Code' 는 각 소유자의 상표이며, 본 프로젝트는 해당 도구와의 상호운용성(interoperability) 을 위해 명목적으로만 상표를 사용합니다.

---

## 8. 기여

기여 가이드, DCO 서명 방법, 커밋 규약은 [CONTRIBUTING.md](./CONTRIBUTING.md) 를 참조하세요.

한국어 이슈·PR 환영합니다. `feat/`, `fix/`, `docs/` 브랜치 명명 권장.

---

## 9. English Summary

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
