# CCP 시작하기

CCP (Claude Control Plane) 는 Claude 를 메인 컨트롤 플레인으로 두고, 무거운 컨텍스트 작업을 Gemini CLI (대용량 요약·로그 분석) 와 Codex CLI (코드 리뷰·diff 분석·버그 조사) 로 오프로드하는 Claude Code 플러그인입니다. 위임된 CLI 는 서브에이전트로 동작하며, 짧은 요약과 결과 파일 경로만 메인 컨텍스트로 돌아오므로 토큰 사용량이 한정됩니다.

이 문서는 5분 설치 절차와 4가지 표준 샘플을 안내합니다. 영어판은 [`docs/en/getting-started.md`](../en/getting-started.md) 입니다.

## 사전 조건

- Claude Code v2.1+
- Node.js >= 20.0
- Gemini 위임용: Gemini CLI >= 0.38.0 + Google 계정
- Codex 위임용: Codex CLI >= 0.122.0 + ChatGPT 계정

실제로 사용할 쪽의 CLI 만 설치하면 됩니다. 두 설정은 서로 독립적입니다.

## 설치

```text
/plugin marketplace add Kwon-Bum-Kyu/claude-control-plane
/plugin install ccp@claude-control-plane
/gemini:setup        # Gemini CLI · OAuth 진단
/ccp:codex-setup     # Codex CLI · OAuth 진단
```

두 `setup` 명령은 Node.js · 상위 CLI · OAuth 상태를 점검합니다. 미설치 시 정확한 복구 명령을 안내합니다. 일반적인 설치 명령:

```bash
# Gemini
npm install -g @google/gemini-cli@latest
gemini                            # 첫 인터랙티브 실행 시 브라우저로 Google OAuth 자동 시작
# (대체) export GEMINI_API_KEY="..."   # https://aistudio.google.com/apikey

# Codex
npm install -g @openai/codex
# 또는 brew install codex          # macOS
codex login                       # 브라우저로 ChatGPT 인증
# (브라우저 없음) codex login --device-auth
# (API key)      printenv OPENAI_API_KEY | codex login --with-api-key
```

## 설치 확인

라우터를 거치는 작은 요청을 실행해 보세요.

```text
/gemini:rescue "이 레포지토리의 README 를 3줄로 요약해"
```

3줄 요약 + 토큰 절감 추정 + `_workspace/_jobs/` 하위의 `result_path` 가 출력되면 정상입니다. 그렇지 않으면 [트러블슈팅](./troubleshooting.md) 을 참고하세요.

## 4가지 표준 샘플

### 1. 작은 입력 — 라우터 학습

```text
/gemini:rescue "이 레포지토리의 README 를 3줄로 요약해"
```

라우터가 입력 크기와 키워드를 분석해 Claude 또는 Gemini 로 분기합니다. 매우 작은 입력은 보통 Claude 가 처리합니다.

### 2. 큰 입력 — background job

```text
/gemini:rescue --background "/var/log/app/error.log 에서 최근 24시간 5xx 에러 Top 10 추출"
```

companion 이 `job_id` 를 즉시 반환합니다. 추적·회수:

```text
/gemini:status <job_id>
/gemini:result <job_id>
```

전체 Gemini 출력은 디스크에 저장되고, 한정된 요약만 Claude 로 회귀합니다.

### 3. 코드 리뷰 — Codex

```text
/ccp:codex-rescue --cwd $(pwd) -- "이 PR 의 git diff 를 검토해 잠재적 버그 5건 식별"
```

Codex 가 무거운 리뷰 추론을 처리합니다. 메인 Claude 컨텍스트는 ≤500자 요약 + `result_path` 만 받습니다.

### 4. 토큰 절감 감사

```text
/ccp:audit --since 7d
```

8 카테고리 점수 (`context_efficiency`, `cost_efficiency`, `router_accuracy`, `double_billing`, `fallback_health`, `plugin_compat`, `adapted_headers`, `secret_leak`) 를 마크다운 또는 JSON 으로 출력합니다.

## 다음 읽을거리

- [라우터 동작](./router.md) — 4축 결정과 영향 주는 방법
- [슬래시 커맨드 레퍼런스](./slash-commands.md) — 모든 명령·플래그·exit code
- [아키텍처](./architecture.md) — 7원칙과 envelope 스키마
- [트러블슈팅](./troubleshooting.md) — 에러 코드 카탈로그
