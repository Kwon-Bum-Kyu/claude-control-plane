# 아키텍처

CCP 는 다섯 개 원칙과 하나의 envelope 스키마로 구성됩니다. 이 문서에서는 원칙, 실제 위임 경로, companion 코어와 어댑터의 경계, 에러 코드와 envelope 검증 체계, job 경로 해석, 훅과 서브에이전트, 차용 코드 출처를 설명합니다. envelope 의 정확한 키 목록과 전체 에러 코드 표는 각각 [슬래시 커맨드](./slash-commands.md) 와 [문제 해결](./troubleshooting.md) 문서를 참고하시기 바랍니다.

## 원칙

### 요약과 경로만 반환

CCP 는 위임 결과로 짧은 요약과 결과 파일 경로만 메인 세션에 반환합니다. 요약이 일정 길이를 넘으면 문장 경계를 우선해 자동으로 잘리고, 잘렸다는 사실이 envelope 에 표시됩니다. 위임에 사용한 CLI 의 원문 응답은 요약에 포함하지 않습니다. 결과 파일을 디스크에 남긴 경우에는 그 경로를 `result_path` 로 함께 반환합니다. codex 의 포그라운드 실행은 요약이 잘리지 않으면 결과 파일을 남기지 않으며, 이때 `result_path` 는 `null` 입니다. 정확한 글자 수 상한과 절단 규칙은 [슬래시 커맨드](./slash-commands.md) 문서의 응답 envelope 절에 있습니다.

### 서브에이전트 격리

세 서브에이전트(`antigravity-rescue`, `codex-rescue`, `router`)는 모두 같은 네 가지 규칙을 따릅니다. 파일을 직접 열람하지 않으며, 정해진 명령이 표준출력에 남긴 envelope 을 원문 그대로 상위 호출자에게 반환합니다. 또한 그 내용을 독자적으로 판단하지 않고, 실패해도 재시도하거나 다른 수단으로 대체하지 않습니다. 코드와 프롬프트에서는 이 규율을 subagent isolation principle 이라고 합니다. 구체적인 도구 권한과 실행 명령은 아래 '위임 경로'와 '서브에이전트' 절에 있습니다.

### 자동 fallback 금지

위임이 실패해도 CCP 는 조용히 Claude 나 다른 CLI 로 다시 시도하지 않습니다. 대신 에러 envelope 의 `recovery` 값과 `action` 문구로 다음 조치를 안내합니다. 사용자가 명시적으로 다시 호출해야 합니다. 훅도 같은 규율에 따라 슬래시 커맨드만 추천하며 대신 실행하지 않습니다. 코드와 프롬프트에서는 이 규율을 no-automatic-fallback principle 이라고 합니다. `recovery` 값의 구체적인 뜻은 아래 'envelope 과 에러 코드 체계' 절에 있습니다.

### 훅은 추천만

네 개 훅은 모두 사용자 입력을 대신 처리하지 않습니다. 세션 시작, 프롬프트 제출, 컨텍스트 압축 직전, 서브에이전트 종료 시점에 안내나 표식을 덧붙일 뿐, `/compact` 나 슬래시 위임을 대신 실행하지 않습니다. 자세한 목록은 아래 '훅' 절에 있습니다.

### CLI 하나에 어댑터 하나

Antigravity 와 Codex 는 각각 하나의 어댑터 파일(`adapters/antigravity.mjs`, `adapters/codex.mjs`)로 선언합니다. 새 CLI 를 추가할 때는 새 어댑터 파일만 작성하고 공유 코어 파일은 수정하지 않습니다. 어댑터와 코어의 정확한 경계는 아래 'companion 코어와 어댑터' 절에 있습니다.

## 위임 경로

`/ccp:antigravity-rescue` 와 `/ccp:codex-rescue` 는 각각 이름이 같은 서브에이전트(`antigravity-rescue`, `codex-rescue`)를 거쳐 실행됩니다. 두 서브에이전트는 `tools:["Bash"]`, `disallowedTools:["mcp__*"]`, `model:haiku`, `background:false` 로 선언되어 있습니다. 각 서브에이전트가 실행하는 명령은 하나로 고정되어 있습니다.

- `antigravity-rescue`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" rescue --task "<task>" [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]`
- `codex-rescue`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" rescue [--background] [--model NAME] [--effort low|medium|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude] -- "<task>"`

서브에이전트는 이 명령이 표준출력에 남긴 envelope 을 그대로 상위 호출자에게 반환합니다. 내용을 해석하거나 재시도하지 않습니다.

CCP 의 서브에이전트는 이 둘과 `router` 를 합쳐 세 개뿐입니다. `/ccp:antigravity-status`, `/ccp:antigravity-result`, `/ccp:antigravity-setup`, `/ccp:codex-status`, `/ccp:codex-result`, `/ccp:codex-setup`, `/ccp:audit` 는 이 목록에 없으므로, 슬래시 커맨드가 서브에이전트를 거치지 않고 companion 스크립트나 감사 스크립트를 직접 실행합니다.

`router` 서브에이전트는 `tools`·`disallowedTools` 구성이 다른 두 서브에이전트와 같되 `Task` 도구까지 명시적으로 차단합니다. 사용자 프롬프트 제출 시 어떤 조건에서 `router-suggest.js` 훅이 판단을 이 서브에이전트에게 넘기는지는 아래 '훅' 절에 있습니다. 위임이 이 서브에이전트로 넘어가면 `node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/router-decide.mjs" --prompt "<user prompt verbatim>" [--auto-routing on|off] [--no-auto-route]` 하나만 실행하고 그 결과 envelope 을 그대로 반환합니다. 결정 축과 판단 근거는 [라우터](./router.md) 문서가 다룹니다.

companion 은 슬래시 커맨드나 서브에이전트를 거치지 않고 직접 실행할 수도 있습니다. `node plugins/ccp/scripts/companion.mjs <antigravity|codex> <subcommand> [...args]` 형태로 CLI 이름을 첫 인자로 주거나, CLI 를 고정한 별칭 스크립트(`antigravity-companion.mjs`, `codex-companion.mjs`)를 바로 실행합니다. `companion.mjs` 는 첫 인자로 받은 CLI 이름에 따라 어댑터 파일(`adapters/antigravity.mjs` 또는 `adapters/codex.mjs`)을 선택하는 일만 합니다.

## companion 코어와 어댑터

companion 은 공유 코어와 CLI 별 어댑터로 나뉩니다. 코어는 여러 파일로 구성됩니다.

- `core/paths.mjs`: job 경로를 해석합니다.
- `core/envelope.mjs`: envelope 을 만들고 자체 검증하며 exit code 를 정합니다.
- `core/errors.mjs`: 공유 에러 카탈로그와 어댑터 카탈로그를 병합합니다.
- `core/jobs.mjs`: job 메타데이터를 읽고 쓰며 세션 범위로 걸러냅니다.
- `core/args.mjs`: 플래그를 파싱합니다.
- `core/runtime.mjs`: 서브커맨드별 처리, 실패 분류, 백그라운드 작업 실행을 담당합니다.

두 어댑터(`adapters/antigravity.mjs`, `adapters/codex.mjs`)는 각 CLI 에 고유한 값을 선언합니다. 지원 플래그와 거부 플래그, 명령줄을 만드는 함수(`buildArgs`), CLI 출력을 읽는 함수(`parseResult`), 타임아웃, 에러 카탈로그, 바이너리 경로 환경 변수 등입니다. 코어는 이 선언 값을 읽어 실행을 조율합니다. 어댑터가 값을 선언하지 않으면 코어의 안전한 기본값을 사용합니다.

이 대체가 실제로 작동하는 사례는 두 가지입니다.

첫 번째로, codex 어댑터는 `timeouts.background` 로 240000ms 를 선언하지만, 코어의 `handleRescue` 는 포그라운드와 백그라운드를 가리지 않고 항상 `timeouts.foreground` 를 타임아웃 기본값으로 계산해 job 메타데이터에 저장합니다. 이 값이 항상 채워져 있어 실제로 백그라운드 워커를 돌리는 `handleTaskWorker` 의 `timeouts.background` 폴백은 코드 경로상 절대 실행되지 않습니다. 따라서 codex 백그라운드 작업의 실제 타임아웃은 240000ms 가 아니라 antigravity 와 같은 600000ms 입니다.

두 번째로, job_id 형식 검증은 어댑터가 `validateJobId` 를 선언했는지에 따라 갈립니다. antigravity 는 UUID v4 정규식으로 실제 형식을 검사하지만, codex 는 이 함수를 선언하지 않아 코어가 값이 있으면 통과로 대체합니다. codex 의 job_id 는 형식 검증이 없다는 뜻입니다.

두 어댑터가 선언해야 하는 필드 구성은 `tests/companion/contract-test.mjs` 가 매 실행마다 검사합니다. 코어가 어댑터 미선언 필드를 요구하거나 어댑터가 코어에 없는 필드를 추가하면 테스트가 실패합니다.

## envelope 과 에러 코드 체계

envelope 스키마는 JSON Schema draft-2020-12(https://json-schema.org/draft/2020-12/schema)를 따르고, 스키마 파일은 `plugins/ccp/schemas/envelope.schema.json` 이며 그 `$id` 값은 `https://raw.githubusercontent.com/Kwon-Bum-Kyu/claude-control-plane/main/plugins/ccp/schemas/envelope.schema.json` 입니다. envelope 이 어떤 키를 갖는지, `details.mode` 가 어떤 값을 갖는지는 [슬래시 커맨드](./slash-commands.md) 문서의 응답 envelope 절을 참고하십시오.

에러 코드 형식은 `CCP-<카테고리>-<NNN>` 입니다. 코드 전체를 훑으면 `INVALID`, `JOB`, `TIMEOUT`, `SETUP`, `OAUTH`, `AG`, `CODEX`, `ROUTER`, `COMPACT`, `API`, `AUDIT`, `UNSUPPORTED` 카테고리가 관찰됩니다.

두 어댑터는 공유 에러 카탈로그를 상속한 뒤 자신의 카탈로그로 병합합니다. 병합 규칙은 `{ ...공유 카탈로그, ...어댑터 카탈로그 }` 이고, 키가 겹치면 어댑터 쪽 문구가 항상 이깁니다. 공유 카탈로그 중 `CCP-SETUP-002`(Node.js 버전 미달) 하나만 어느 어댑터도 재정의하지 않고 공유 문구를 그대로 씁니다.

`recovery` 값의 뜻은 다음과 같습니다. `retry` 는 같은 요청을 그대로 다시 시도하면 해결될 수 있다는 뜻입니다. `abort` 는 재시도로 해결되지 않으니 사용자가 다른 조치를 해야 한다는 뜻입니다. `fallback_claude` 는 그 CLI 위임을 포기하고 `--fallback-claude` 로 메인 Claude 에게 넘기라는 뜻입니다. `user_action_required` 는 사용자가 입력이나 설정을 고친 뒤 다시 실행해야 한다는 뜻이며, 현재는 `router-decide.mjs` 가 입력이 없을 때 이 값을 씁니다. 스키마에서 유효한 `recovery` enum 은 이 네 값입니다.

알려진 편차가 몇 가지 있습니다. antigravity 의 `CCP-OAUTH-001` 과 `CCP-AG-002` 는 `recovery` 값으로 스키마 enum 밖의 `fallback` 을 씁니다(유효한 값은 `fallback_claude` 입니다). antigravity 의 `details.mode` 도 일부 실행형태에서 스키마 enum 밖의 값을 갖습니다. 백그라운드 접수 응답에서는 CLI 이름이 아니라 실행형태를 가리키는 `background` 를 쓰고, `--fallback-claude` 호출 응답에서는 `fallback_claude` 를 씁니다. `setup`, `preflight`, `status` 응답에는 `details` 안에 `mode` 키 자체가 없습니다. envelope 자체 검증기는 이 편차들을 모두 허용 목록으로 명시해 두었으므로 실패로 처리하지 않습니다. 또 다른 편차로, 에러 `details` 를 담는 위치도 두 어댑터가 다릅니다. antigravity 는 `error` 객체 안에 `details` 를 중첩하고, codex 는 `details` 를 envelope 최상위에 둡니다. 스키마에 `additionalProperties` 제약이 없어 이 차이는 검증기가 잡아내지 못합니다.

두 companion 은 envelope 을 표준출력에 쓰기 직전에 자체 검증합니다. 환경 변수 `CCP_ENVELOPE_STRICT` 를 `1` 로 설정하면 검증 실패 시 예외를 던지고, 설정하지 않으면(기본값) 표준에러에 경고만 남기고 그대로 진행합니다.

## job 경로 해석

job 이 저장되는 디렉터리(`JOBS_DIR`)는 다섯 단계 우선순위를 따릅니다. 절대 경로 환경 변수 `CCP_JOBS_DIR` 이 있으면 나머지 전부를 무시하고 이 값을 씁니다. 없으면 `CLAUDE_PROJECT_DIR` 을 보고, 그마저 없으면 `CLAUDE_PROJECT_ROOT` 를 봅니다. 둘 다 없으면 호출자가 넘긴 힌트(예: `SubagentStop` 훅이 stdin 으로 받은 `cwd`)를 쓰고, 그마저 없으면 마지막 폴백으로 `process.cwd()` 를 씁니다. 마지막 값은 항상 존재합니다.

`PLUGIN_ROOT`(플러그인 자체가 설치된 물리 경로)는 이 우선순위와 무관합니다. `CLAUDE_PLUGIN_ROOT` 환경 변수가 있으면 그 값을, 없으면 코드 파일 기준 두 단계 위 디렉터리를 씁니다. 마켓플레이스로 설치된 플러그인은 갱신될 때 이 디렉터리가 사라질 수 있으므로 job 경로 계산에는 쓰지 않습니다.

`/ccp:audit` 도 이제 companion 과 같은 경로 해석 순서를 씁니다. 감사 보고서는 `JOBS_DIR` 의 형제 디렉터리인 `_workspace/_audits/` 아래에 저장됩니다.

CLI 별로 남기는 산출물의 구성도 다릅니다. antigravity 는 포그라운드로 실행해도 항상 job 기록을 남깁니다. `_workspace/_jobs/<uuid>/` 아래에 `meta.json`, `agy.log`, `result.md` 가 생깁니다. codex 는 백그라운드로 실행할 때만 `_workspace/_jobs/<uuid>/` 아래에 `meta.json`, `result.txt` 를 남깁니다. 백그라운드로 실행하면 두 CLI 모두 같은 디렉터리에 `stdout.log` 와 `stderr.log` 가 추가로 생깁니다. codex 의 포그라운드 실행은 원칙적으로 기록을 남기지 않지만, 요약이 잘렸을 때는 예외적으로 `meta.json` 없이 `result.txt` 만 있는 임시 디렉터리가 생깁니다. 이 디렉터리의 수명을 관리하는 주체가 없어 계속 쌓입니다. 이는 알려진 제약입니다.

job 산출물 경로는 두 어댑터 모두 `JOBS_DIR` 기준의 절대 경로(`pathStyle:'absolute'`)로 노출됩니다. 저장소 상대 경로로 노출하는 분기(`'repo-relative'`)도 코드에 남아 있지만 현재 어느 어댑터도 선언하지 않아 사용되지 않습니다.

## 훅

CCP 는 네 개의 훅을 등록합니다. `UserPromptSubmit` 에는 `suggest-compact.js` 다음에 `router-suggest.js` 가 이 순서로 실행되고, `SubagentStop` 에는 `rescue-finalize.js`, `SessionStart` 에는 `boot-check.js`, `PreCompact` 에는 `suggest-compact.js` 가 등록되어 있습니다.

- `boot-check.js`(`SessionStart`): Node.js 버전, agy 설치와 버전, 인증 상태를 미리 점검합니다. 문제를 찾으면 안내만 하고, 문제가 없으면 아무 것도 하지 않습니다. 이 점검은 세션 시작을 막지 않습니다.
- `router-suggest.js`(`UserPromptSubmit`): 라우팅 판단을 `[CCP-ROUTER-001]` 추천으로 주입합니다. `auto_routing` 이 켜져 있고 세션이 canonical 로 판정되면, 또는 판단이 애초에 `claude` 이면 아무 것도 주입하지 않습니다. 앞의 경우에는 그 판단을 `router` 서브에이전트에게 넘깁니다. 헤드리스 자동화가 의심되는 프롬프트에는 `[CCP-META-WARN]` 안내를 덧붙입니다.
- `suggest-compact.js`(`UserPromptSubmit`, `PreCompact`): 컨텍스트 사용량이 임계치를 넘으면 `[CCP-COMPACT-001]` 안내로 수동 `/compact` 나 위임을 권합니다. `PreCompact` 시점에는 임계치와 무관하게 항상 안내합니다.
- `rescue-finalize.js`(`SubagentStop`): antigravity job 중 상태가 계속 `running` 인 채로 시작 후 5분(300000ms) 이 지난 것을 찾아 `failed` 로 강제 종료 처리하고 `CCP-TIMEOUT-001` 을 기록합니다. codex 는 이 상태 키를 사용하지 않으므로 정리 대상에서 제외됩니다.

네 훅은 실패를 조용히 처리합니다. stdin 이 JSON 형식이 아니거나 처리 중 예외가 발생하면 빈 객체를 표준출력에 쓰고 종료합니다. 사용자의 입력 흐름은 막지 않습니다.

## 서브에이전트

CCP 의 서브에이전트는 세 개뿐입니다: `antigravity-rescue`, `codex-rescue`, `router`. 셋 다 `tools:["Bash"]`, `model:haiku`, `background:false` 이고 `disallowedTools` 에 `mcp__*` 를 포함합니다. `router` 는 여기에 더해 `Task` 도구도 명시적으로 차단합니다.

세 서브에이전트는 위임 경로 절에 적힌 명령 하나만 실행합니다. 원칙 절의 '서브에이전트 격리'에 설명한 네 가지 규칙도 따릅니다.

## 차용 코드

CCP 는 두 오픈소스 프로젝트의 코드를 차용합니다.

Apache-2.0 으로 차용된 파일 5개는 모두 openai/codex-plugin-cc(업스트림 커밋 `8e873d6f40511aa7d8081623d0b66804b7301de6`, release/v1.0.4)에서 왔고, 파일 선두에 출처를 밝히는 주석이 있습니다.

| 파일 | 상류 | 라이선스 |
|------|------|---------|
| `plugins/ccp/scripts/core/args.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/args.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/core/jobs.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/state.mjs`, `tracked-jobs.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/core/process.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/process.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/core/runtime.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/job-control.mjs` | Apache-2.0 |
| `plugins/ccp/scripts/adapters/codex.mjs` | codex-plugin-cc `plugins/codex/scripts/lib/args.mjs`(`buildArgs` 함수만) | Apache-2.0 |
| `plugins/ccp/scripts/adapters/antigravity.mjs` | 없음(CCP 자체 코드) | 해당 없음 |
| `plugins/ccp/scripts/harness-audit.js` | everything-claude-code 의 `harness-audit.js` 포트 | MIT |
| `plugins/ccp/hooks/suggest-compact.js` | everything-claude-code | MIT |
| `plugins/ccp/skills/context-budget/SKILL.md` | everything-claude-code | MIT |
| `plugins/ccp/scripts/lib/magic-keywords.mjs` | oh-my-claudecode | MIT |

`LICENSES/` 디렉터리에는 각 상류의 라이선스 원문 4개(`codex-plugin-cc-Apache-2.0.txt`, `codex-plugin-cc-NOTICE.txt`, `everything-claude-code-MIT.txt`, `oh-my-claudecode-MIT.txt`)가 들어 있습니다. 라이선스 조건과 부기 문단 원문은 저장소의 `LICENSE` 파일과 [CONTRIBUTING](../../CONTRIBUTING.md) 문서를 참고하십시오.

## 다음 문서

- [README](../../README.md)
- [시작하기](./getting-started.md)
- [슬래시 커맨드](./slash-commands.md)
- [라우터](./router.md)
- [문제 해결](./troubleshooting.md)
