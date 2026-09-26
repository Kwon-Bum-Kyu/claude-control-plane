# 라우터

CCP 라우터는 사용자 프롬프트를 세 대상, 즉 Claude(메인 컨트롤 플레인), Antigravity, Codex 가운데 어디로 보낼지 결정합니다. 라우터의 결정 로직은 하나의 함수로 구현되어 있고, 추천 훅과 라우터 에이전트, 회귀 테스트가 이 함수를 함께 사용합니다. 그래서 이 문서에 적힌 결정 규칙과 실제 동작이 항상 일치합니다.

## 기본 동작

사용자가 `/ccp:antigravity-rescue` 또는 `/ccp:codex-rescue` 슬래시 커맨드를 직접 실행하면 이 결정 로직을 거치지 않고 항상 해당 CLI 로 위임됩니다. 슬래시 커맨드가 아닌 일반 프롬프트가 주어졌을 때만 아래에 설명하는 4축 결정 순서가 적용됩니다.

기본 상태에서 라우터의 결정은 자동으로 위임을 실행하지 않습니다. `UserPromptSubmit` 훅이 결정 결과를 안내 메시지로만 보여 주고, 실제 위임은 사용자가 안내를 보고 슬래시 커맨드를 직접 실행해야 이루어집니다. 결정을 자동으로 위임까지 이어지게 하는 방법은 "자동 라우팅 (opt-in)" 절에서 설명합니다.

## 결정 순서

라우터는 네 축을 순서대로 확인합니다. 앞선 축에서 결정이 나면 그 뒤의 축은 확인하지 않습니다.

### 축 A: 사용자 명시

가장 먼저 확인하는 축입니다. 다음 신호를 이 순서대로 확인합니다.

1. 프롬프트 안에 `/ccp:antigravity-rescue` 또는 `/ccp:codex-rescue` 문자열이 있고 `--fallback-claude` 가 없으면 해당 CLI 로 결정합니다. `--fallback-claude` 가 함께 있으면 이 조건은 건너뛰고 다음 조건에서 Claude 로 결정됩니다.
2. `--fallback-claude` 또는 `--force-claude` 가 있으면 Claude 로 결정합니다.
3. `--effort` 또는 `--sandbox workspace-write` 가 있으면 Codex 로 결정합니다.
4. 코드 블록을 제거한 텍스트에서 매직 키워드가 일치하면 그 키워드가 가리키는 대상으로 결정합니다. 매직 키워드는 아래 "매직 키워드" 절에서 설명합니다.

다음 명령으로 두 번째 조건을 직접 확인할 수 있습니다.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "이 코드 검토해줘 --force-claude"
```

이 프롬프트는 `--force-claude` 가 있어 Claude 로 결정됩니다.

### 축 B: 입력 크기

축 A 에서 결정이 나지 않으면 입력 크기를 봅니다. 라우터는 프롬프트를 공백 기준으로 나눈 단어 수에 1.3 을 곱하고 올림하여 토큰 수를 추정합니다.

- 추정 토큰이 5,000 미만이면 이 축에서는 결정하지 않고 축 C 로 넘어갑니다. 축 C 의 키워드 사전에 일치하는 단어가 하나도 없을 때에만 Claude 로 결정합니다(reason `too_small`). 따라서 짧은 프롬프트라도 키워드가 일치하면 그 대상으로 결정됩니다.
- 추정 토큰이 5,000 이상 30,000 이하이면, Codex 키워드 사전과 일치하는 단어가 있을 때만 Codex 로 결정합니다. 일치하지 않으면 축 C 로 넘어갑니다.
- 추정 토큰이 30,000 을 넘으면, Codex 키워드 사전과 일치하는 단어가 있으면 Codex 로, 없으면 Antigravity 로 결정합니다.

### 축 C: 키워드

축 A 와 축 B 에서 결정이 나지 않으면 네 종류의 키워드 사전과 프롬프트를 대조합니다. 사전의 내용은 아래 "키워드 사전" 절에서 설명합니다. 메인 컨텍스트 참조 사전과 일치하면 다른 사전의 일치 결과보다 우선해 Claude 로 결정합니다. 직전 응답이나 방금 실행한 명령을 참조하는 대화는 위임하면 문맥이 끊어지기 때문입니다.

### 축 D: 보수적 기본값

앞의 세 축 어디에도 걸리지 않으면 Claude 로 결정합니다. 이 결정의 reason_code 는 `AXIS_D_DEFAULT_CONSERVATIVE` 입니다. 축 B 의 "추정 토큰 5,000 미만" 결정은 이름과 달리 축 D 가 아니라 축 B 소속이며, reason_code 는 `AXIS_B_TOO_SMALL` 입니다.

## 키워드 사전

라우터는 네 개의 키워드 사전을 씁니다. 영어 어휘가 우선이고 한국어 어휘가 보조로 포함됩니다.

- Antigravity 사전: 대용량 요약과 코드베이스 전체 분석에 관련된 어휘 범주를 담습니다.
- Codex 사전: 코드 리뷰, 버그 조사, diff 분석에 관련된 어휘 범주를 담습니다.
- Claude 사전: 소규모 편집, 타입 추가, 테스트 작성에 관련된 어휘 범주를 담습니다.
- 메인 컨텍스트 참조 사전: 직전 응답이나 방금 실행한 명령을 가리키는 표현을 담습니다.

정확한 단어 목록은 코드가 기준입니다. 저장소의 `plugins/ccp/scripts/lib/router.mjs` 에서 확인할 수 있습니다.

사전과 프롬프트를 대조할 때는 정보성 문맥을 걸러냅니다. 일치한 단어의 앞뒤 80자 안에 "이게 뭐야", "how to use", "explain" 처럼 설명을 요청하는 표현이 있으면 그 일치는 무시합니다. 이 판단은 영어, 한국어, 일본어, 중국어 표현을 모두 인식합니다. 다음 두 명령으로 차이를 확인할 수 있습니다.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "코드 리뷰 부탁해"
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "리뷰가 무엇인가요 설명해주세요 궁금합니다 궁금합니다 궁금합니다"
```

첫 번째 프롬프트는 Codex 사전과 일치해 Codex 로 결정됩니다. 두 번째 프롬프트는 같은 단어가 있어도 설명을 요청하는 문맥이므로 그 일치가 무시됩니다.

## 매직 키워드

매직 키워드는 사용자가 크기나 사전 일치와 무관하게 원하는 대상을 직접 지정하는 표기입니다. 축 A 에서 슬래시 언급과 옵션 다음, 코드 블록을 제거한 뒤에 확인합니다.

- Antigravity: `@antigravity`, `@ag`, `@안티` (예전 표기 `@gemini`, `@젬`, `@제미니` 도 같은 대상으로 인식합니다.)
- Codex: `@codex`, `@코덱`, `@코덱스`
- Claude: `@claude`, `@클`, `@클로드`
- `@auto`, `@자동`: 특정 대상을 가리키지 않는 표식입니다. 이 표식이 있으면 축 B·C·D 로 그대로 넘어갑니다.

매직 키워드에는 경계 규칙이 있습니다. 앞쪽에는 모든 매직 키워드에 공통으로 경계를 둡니다. 키워드 바로 앞에 문자, 마침표, 더하기, 하이픈이 있으면 매치로 보지 않습니다. 그래서 `bob@agency` 처럼 이메일 주소 형태의 문자열 안에 있는 `@ag` 는 매치되지 않습니다. ASCII 로 이루어진 키워드(`@ag`, `@codex` 등)는 뒤쪽에도 경계를 둡니다. 뒤에 문자나 하이픈이 오면 매치로 보지 않으므로 `@agent` 는 `@ag` 와 매치되지 않습니다. 한국어 키워드(`@안티`, `@코덱` 등)는 뒤쪽 경계를 두지 않습니다. 조사가 키워드 바로 뒤에 붙기 때문입니다(예: `@코덱스로 확인해줘`).

코드 블록도 매칭에서 제외합니다. 세 개의 백틱으로 감싼 코드 블록과 백틱으로 감싼 인라인 코드 안에 있는 매직 키워드는 무시합니다. 이 처리는 매직 키워드뿐 아니라 위 "키워드 사전" 절의 대조에도 똑같이 적용됩니다.

다음 명령으로 앞쪽 경계 규칙을 직접 확인할 수 있습니다.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "bob@agency 쪽에 전달할 문구 확인해줘"
```

이 프롬프트는 `@ag` 가 이메일 주소 안에 있어 매직 키워드로 매치되지 않으므로 Antigravity 로 결정되지 않습니다.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "@codex 이 diff 좀 봐줘"
```

이 프롬프트는 `@codex` 가 매직 키워드로 매치되어 축 A 에서 바로 Codex 로 결정됩니다.

## 자동 라우팅 (opt-in)

자동 라우팅은 라우터의 결정을 훅의 안내로만 쓰지 않고 라우터 에이전트가 실제로 위임까지 실행하게 하는 설정입니다. 기본값은 꺼짐이며, 플러그인 매니페스트(`plugins/ccp/.claude-plugin/plugin.json`)의 `config.auto_routing` 값을 `true` 로 바꿔야 켜집니다.

자동 라우팅이 켜져 있어도 헤드리스 사용이 확실하면 자동으로 위임하지 않습니다. 다음 세 가지 신호 가운데 하나라도 참이면 헤드리스로 확정합니다.

- 환경 변수 `CI` 의 값이 `true` 또는 `1` 일 때
- 환경 변수 `CLAUDE_CODE_NONINTERACTIVE` 의 값이 `1` 또는 `true` 일 때
- 환경 변수 `CLAUDE_CODE_ENTRYPOINT` 에 값이 있고 그 값이 `cli` 가 아닐 때

`router-decide.mjs` 는 라우터 결정을 직접 실행하는 CLI 진입점이며 다음 플래그를 받습니다.

- `--prompt "<텍스트>"`: 판단할 프롬프트입니다. 표준 입력으로 `{prompt|user_prompt|input}` 키를 가진 JSON 을 주는 방식도 됩니다.
- `--auto-routing on|off`: 이번 세션에서 자동 라우팅 설정을 재정의합니다.
- `--no-auto-route`: 이번 호출 한 번만 자동 라우팅을 끕니다.

`router-decide.mjs` 가 돌려주는 성공 결과의 `summary` 값은 `[CCP-ROUTER-002]` 표식으로 시작합니다. 이 표식은 에러 코드가 아니라 성공한 라우팅 결정을 나타내는 접두어입니다.

결과의 `auto_routed` 값은 다음과 같이 계산됩니다. 먼저 자동 라우팅이 켜져 있고, 헤드리스가 확정되지 않았고, `--no-auto-route` 로 옵트아웃하지 않았을 때만 자동 라우팅이 활성 상태로 봅니다. 그 상태에서 결정된 대상이 Claude 가 아닐 때만 `auto_routed` 가 `true` 가 됩니다. 그 밖의 모든 경우에는 `false` 입니다.

결과에는 `reason_code` 값도 함께 담깁니다. 다음 열두 가지 중 하나입니다.

| reason_code | 발생하는 축 |
|---|---|
| `AXIS_A_SLASH` | 축 A, 슬래시 언급 또는 매직 키워드 일치 |
| `AXIS_A_OPTION` | 축 A, `--effort` 또는 `--sandbox workspace-write` |
| `AXIS_A_FALLBACK_CLAUDE` | 축 A, `--fallback-claude` 또는 `--force-claude` |
| `AXIS_B_OVERSIZED` | 축 B, 추정 토큰 30,000 초과이고 Codex 키워드가 없을 때 |
| `AXIS_B_MID_REVIEW` | 축 B, 추정 토큰 5,000~30,000 사이이거나 30,000 초과이면서 Codex 키워드가 있을 때 |
| `AXIS_B_TOO_SMALL` | 축 B, 추정 토큰 5,000 미만일 때 |
| `AXIS_C_KW_ANTIGRAVITY` | 축 C, Antigravity 사전 일치 |
| `AXIS_C_KW_CODEX` | 축 C, Codex 사전 일치 |
| `AXIS_C_KW_CLAUDE` | 축 C, Claude 사전 일치 |
| `AXIS_C_MAIN_CONTEXT_BIND` | 축 C, 메인 컨텍스트 참조 사전 일치 |
| `AXIS_D_DEFAULT_CONSERVATIVE` | 축 D, 어디에도 일치하지 않을 때 |
| `OPT_OUT_NO_AUTO_ROUTE` | `--no-auto-route` 로 이번 호출만 옵트아웃했을 때 |

## 헤드리스 경고

헤드리스 경고는 자동 라우팅의 헤드리스 판정과 다른 별개의 판단입니다. 라우터가 Antigravity 또는 Codex 로 결정했고 훅이 안내 메시지를 보여 줄 때, 프롬프트에 헤드리스 사용을 의심할 표현이 있으면 안내 메시지 뒤에 `[CCP-META-WARN]` 표식이 붙은 문구가 추가로 붙습니다. 이 문구는 `--help` 같은 메타 탐색이나 Skill 에서 Agent 로 우회하는 방식 대신, `node plugins/ccp/scripts/codex-companion.mjs rescue --task <task>` 또는 `node plugins/ccp/scripts/antigravity-companion.mjs rescue --task <task>` 처럼 companion 스크립트를 직접 실행하라고 안내합니다.

다음 조건 가운데 하나가 참이면 헤드리스 사용을 의심합니다. 다만 프롬프트에 `/ccp:codex-` 또는 `/ccp:antigravity-` 로 시작하는 슬래시 언급이 이미 있으면 아래 조건과 무관하게 의심하지 않습니다.

- 단어 경계를 지킨 `headless`, `claude -p`, `automation`, `스크립트`, `자동화` 가 프롬프트에 있을 때. `cron` 은 뒤쪽 경계 없이 확인하므로 `crontab` 도 포함합니다.
- 대문자로만 이루어진 단독 단어 `CI` 가 프롬프트에 있을 때. 소문자 `ci` 는 판정하지 않습니다.

## 판단 바꾸기

- 프롬프트에 `/ccp:antigravity-rescue` 또는 `/ccp:codex-rescue` 문자열을 포함하면 그 CLI 로 결정됩니다.
- 매직 키워드(`@antigravity`, `@codex`, `@claude` 등)를 넣으면 크기나 사전 일치와 무관하게 원하는 대상으로 결정을 강제합니다.
- `--fallback-claude` 또는 `--force-claude` 를 넣으면 Claude 로 강제합니다.
- 자동 라우팅이 켜진 세션에서는 `--auto-routing on|off` 로 세션 단위 설정을 바꾸거나, `--no-auto-route` 로 이번 호출 한 번만 자동 라우팅을 끌 수 있습니다.
- `/ccp:antigravity-rescue` 또는 `/ccp:codex-rescue` 슬래시 커맨드를 직접 실행하면 위 결정 로직 자체를 거치지 않고 항상 위임됩니다.

## 다음 문서

라우터가 위임하는 경로의 전체 구조는 [아키텍처](./architecture.md) 문서에서 설명합니다.
