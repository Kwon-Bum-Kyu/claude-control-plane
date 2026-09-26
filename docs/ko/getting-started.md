# 시작하기

CCP 의 소개와 CCP 가 해결하는 문제는 [README](../../README.md) 에 있습니다. 이 문서는 Antigravity CLI 와 Codex CLI 를 실제로 설치하고 인증한 뒤, 첫 위임을 실행하는 절차를 다룹니다.

## 사전 조건

- Node.js 20.19 이상(22 계열은 22.7 이상)이 필요합니다. 훅 4종과 감사 스크립트가 `.js` 확장자에 ESM 구문을 쓰고 있어, Node 의 모듈 자동 감지 기능에 의존하기 때문입니다.
- Antigravity CLI(`agy`) 는 1.0.0 이상이 필요합니다.
- Codex CLI 는 0.122.0 이상이 필요합니다.
- Antigravity 위임을 쓰려면 `agy` 를 한 번 대화형으로 실행해 로그인을 마치거나, `ANTIGRAVITY_API_KEY` 환경 변수를 설정해야 합니다.
- Codex 위임을 쓰려면 `codex login` 으로 ChatGPT 계정 인증을 마쳐야 합니다.
- `setup` 커맨드는 Node.js 의 메이저 버전만 검사합니다. 위에 적은 20.19 와 22.7 은 패치 단위 권장값이며, 코드가 패치 버전까지 강제로 검사하지는 않습니다.

플러그인 자체를 설치하는 방법(마켓플레이스 등록, 설치, 재적재 명령)은 [README](../../README.md) 를 참고하십시오.

## CLI 설치와 인증

### Antigravity CLI

다음 명령으로 설치합니다.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

설치 후 `~/.local/bin` 이 `PATH` 에 포함되어 있는지 확인하십시오. 인증은 두 가지 방법 중 하나를 씁니다.

- `agy` 를 한 번 대화형으로 실행해 로그인을 마칩니다.
- `ANTIGRAVITY_API_KEY` 환경 변수를 설정합니다.

### Codex CLI

다음 중 하나로 설치합니다.

```bash
brew install codex
```

```bash
npm install -g @openai/codex
```

인증은 `codex login` 으로 ChatGPT 계정에 로그인합니다. 로그인 상태는 `codex login status` 로 확인할 수 있으며, CCP 는 이 명령을 내부적으로 재사용해 인증 여부를 판단합니다.

## 설치 확인

설치와 인증을 마쳤으면 다음 두 커맨드로 상태를 확인합니다.

```text
/ccp:antigravity-setup
/ccp:codex-setup
```

두 커맨드는 각각 Node.js 버전, CLI 버전, 인증 상태를 확인하고 문제가 있으면 복구 방법을 안내하는 응답을 돌려줍니다. 앞서 적었듯이 `setup` 은 Node.js 의 메이저 버전만 봅니다. 인증 확인에 걸리는 시간은 Antigravity 가 최대 60초, Codex 가 최대 30초입니다.

## 첫 위임

두 CLI 는 rescue 호출 이전에 인증을 확인하는 방식이 다릅니다. Antigravity 는 매 rescue 호출 전에 저비용 존재 확인만 하고, 실제 프로브는 `setup` 을 실행할 때만 수행합니다. Codex 는 매 rescue 호출 전에도 실제 `codex login status` 왕복을 수행합니다.

### 포그라운드 위임

```text
/ccp:antigravity-rescue "이 로그 파일을 요약해줘"
```

동기 방식으로 실행되며, 완료되면 요약과 결과 파일 경로를 담은 응답을 곧바로 돌려받습니다. 플래그의 전체 목록과 의미, 응답의 정확한 형태는 [슬래시 커맨드](./slash-commands.md) 를 참고하십시오.

### 백그라운드 작업

```text
/ccp:antigravity-rescue "이 로그 파일을 요약해줘" --background
```

`--background` 를 붙이면 즉시 작업 식별자를 담은 응답을 받고, 작업은 별도 프로세스에서 계속 진행됩니다. 진행 상태와 결과는 다음 두 커맨드로 확인합니다.

```text
/ccp:antigravity-status <job_id>
/ccp:antigravity-result <job_id>
```

`status` 는 작업이 끝났는지 확인하고, `result` 는 작업이 끝난 뒤 요약과 결과 파일 경로를 가져옵니다. 두 커맨드의 인자와 응답 형태는 [슬래시 커맨드](./slash-commands.md) 를 참고하십시오.

### 코드 리뷰 위임

```text
/ccp:codex-rescue "이 변경 사항의 diff 를 검토하고 잠재적인 버그를 찾아줘"
```

Codex 는 코드 리뷰, 버그 조사, diff 분석에 강점이 있습니다. `--effort`·`--sandbox`·`--cwd`·`--model` 같은 Codex 전용 플래그의 의미는 [슬래시 커맨드](./slash-commands.md) 를 참고하십시오.

## 설정과 보안

### 환경 변수

| 변수 | 용도 |
|------|------|
| `CCP_JOBS_DIR` | job 저장 디렉터리를 절대 경로로 강제 지정합니다. 다른 어떤 경로 판단보다 우선합니다. |
| `CLAUDE_PROJECT_DIR` | 프로젝트 루트를 판단하는 1순위 값입니다. |
| `CLAUDE_PROJECT_ROOT` | 프로젝트 루트를 판단하는 2순위 값입니다. |
| `CLAUDE_PLUGIN_ROOT` | 플러그인 자체의 설치 경로입니다. job 경로 계산에는 쓰이지 않습니다. |
| `CCP_AGY_BIN` | `agy` 바이너리 경로를 재지정합니다. |
| `CCP_CODEX_BIN` | `codex` 바이너리 경로를 재지정합니다. |
| `CCP_AGY_SKIP_PERMISSIONS` | `--dangerously-skip-permissions` 자동 부착을 끄는 옵트아웃 변수입니다. |
| `CCP_ENVELOPE_STRICT` | `1` 이면 응답 형식 자체 검증에 실패했을 때 예외를 던집니다. 기본값은 표준 에러에 경고만 남기고 계속 진행하는 것입니다. |
| `ANTIGRAVITY_API_KEY` | Antigravity 를 API 키 방식으로 인증합니다. |
| `CLAUDE_SESSION_ID` | 백그라운드 job 의 메타 정보에 호출한 세션의 식별자로 기록됩니다. 없으면 부모 프로세스 ID 로 대체합니다. |
| `CI` | 헤드리스 환경 신호 중 하나입니다. |
| `CLAUDE_CODE_NONINTERACTIVE` | 헤드리스 환경 신호 중 하나입니다. |
| `CLAUDE_CODE_ENTRYPOINT` | 헤드리스 환경 신호 중 하나입니다. 값이 있고 `cli` 가 아니면 헤드리스로 판정합니다. |

### Antigravity 도구 권한 자동 승인

Antigravity 위임은 기본으로 모든 호출(포그라운드와 백그라운드 모두)에 `--dangerously-skip-permissions` 를 붙입니다. 이 플래그는 위임된 `agy` 모델이 여는 모든 도구 권한 요청을 자동으로 승인합니다. 비대화형 실행 모드에는 그 요청에 응답할 사람이 없으므로, 이 플래그가 없으면 도구가 필요한 작업은 전부 거부된 채로 실패합니다.

신뢰하지 않는 입력을 다루는 작업, 예를 들어 외부 네트워크에서 가져온 내용이나 프로젝트 밖 파일, 직접 작성하지 않은 내용을 다루는 작업에는 `--sandbox` 플래그를 함께 쓰는 것을 권장합니다. 자동으로 승인된 도구 호출이 접근할 수 있는 범위를 제한하기 때문입니다. `--sandbox` 의 정확한 동작은 CLI 마다 다르며, 자세한 설명은 [슬래시 커맨드](./slash-commands.md) 를 참고하십시오.

자동 승인을 완전히 끄려면 커맨드를 호출하기 전에 환경 변수 `CCP_AGY_SKIP_PERMISSIONS` 를 `0` 으로 설정하십시오. `false` 나 `no` 도 같은 뜻으로 동작하며 대소문자를 구분하지 않습니다. 이렇게 설정하면 도구가 필요한 작업은 원래의 승인 대기 상태로 돌아가 실패합니다.

## 다음 문서

- [슬래시 커맨드](./slash-commands.md)
- [라우터](./router.md)
- [아키텍처](./architecture.md)
- [문제 해결](./troubleshooting.md)
