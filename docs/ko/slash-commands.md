# 슬래시 커맨드

이 문서는 CCP가 제공하는 슬래시 커맨드, rescue 플래그, companion 직접 실행, `/ccp:audit`, 응답 envelope의 형태를 다룹니다. 설치와 인증 절차는 [시작하기](./getting-started.md) 문서를, 슬래시 없는 프롬프트의 라우팅 방식은 [라우터](./router.md) 문서를 참고하십시오.

## 커맨드 목록

CCP는 `/ccp:` 네임스페이스 아래 9개 슬래시 커맨드를 제공합니다. 각 커맨드 파일의 stem이 곧 커맨드 이름입니다. 예를 들어 `antigravity-rescue.md` 파일은 `/ccp:antigravity-rescue` 커맨드가 됩니다.

| 커맨드 | 설명 | 인자 |
|---|---|---|
| `/ccp:antigravity-rescue` | Antigravity CLI(agy)에 대용량 요약·분석 작업을 위임해 메인 Claude 컨텍스트의 토큰 사용을 줄입니다. | `<task> [--background] [--max-tokens N] [--files <glob>] [--fallback-claude]` |
| `/ccp:antigravity-status` | `--background`로 만든 Antigravity job의 현재 상태를 확인합니다. | `<job_id>` |
| `/ccp:antigravity-result` | 완료된 Antigravity 백그라운드 job의 결과를 가져옵니다. | `<job_id> [--summary-only]` |
| `/ccp:antigravity-setup` | Antigravity CLI(agy)의 설치와 인증 상태를 확인하고, 실패하면 설치나 재인증 안내를 보여줍니다. | 없음 |
| `/ccp:codex-rescue` | 코드 리뷰, 버그 조사, diff 분석처럼 Codex가 강점을 갖는 작업을 위임해 메인 Claude 컨텍스트의 토큰 사용을 줄입니다. | `<task> [--background] [--model NAME] [--effort low\|medium\|high] [--sandbox MODE] [--cwd DIR] [--timeout-ms N] [--fallback-claude]` |
| `/ccp:codex-status` | `--background`로 만든 Codex job의 현재 상태를 확인합니다. | `<job_id>` |
| `/ccp:codex-result` | 완료된 Codex 백그라운드 job의 결과를 가져옵니다. | `<job_id>` |
| `/ccp:codex-setup` | Codex CLI의 설치와 OAuth 인증 상태를 확인하고, 실패하면 설치나 재인증 안내를 보여줍니다. | `""`(인자 없음) |
| `/ccp:audit` | ecc의 harness-audit.js를 포팅한 커맨드로, CCP job 기록을 8개 카테고리로 채점하고 보고서를 작성합니다. | `"[--since YYYY-MM-DD] [--format md\|json]"` |

## rescue 플래그

`/ccp:antigravity-rescue`와 `/ccp:codex-rescue`가 받는 플래그는 다음과 같습니다. 대부분의 플래그는 한쪽 CLI에만 실제 효과가 있습니다.

| 플래그 | Antigravity 동작 | Codex 동작 | 기본값 |
|---|---|---|---|
| `--background` | bool 플래그입니다. 참이면 `runBackground`를, 아니면 `runForeground`를 호출합니다(두 CLI가 공유하는 core 로직입니다). | 동일합니다. | false |
| `--fallback-claude` | bool 플래그입니다. 참이면 companion 호출을 건너뛰고 `mode: "fallback_claude"` 성공 envelope을 즉시 반환합니다. | 같은 흐름을 타지만 `details.mode`는 서브커맨드와 무관하게 항상 `codex`입니다. | false |
| `--sandbox` | 값 없는 bool 플래그입니다. 존재하면 agy 호출에 값 없이 `--sandbox`만 덧붙입니다. | 문자열 열거형입니다(`read-only`, `workspace-write`, `danger-full-access`). 빈 값이나 불리언으로 주면 `read-only`로 정규화되어 `-s <mode>`로 전달됩니다. | Antigravity는 끄면 붙지 않습니다. Codex는 `read-only`입니다. |
| `--max-tokens N` | 정수입니다. 프롬프트 뒤에 "(Answer within N tokens if possible)" 힌트를 덧붙이는 소프트 제약이며, agy 자체 플래그는 아닙니다. | 선언하지 않습니다. `buildArgs` 시그니처에 `maxTokens` 파라미터가 없어 값을 줘도 완전히 버려집니다. | 4000(Antigravity 전용) |
| `--timeout-ms N` | 정수입니다. 포그라운드·백그라운드 요청 모두 이 값으로 타임아웃을 계산합니다(두 CLI가 공유하는 core 로직입니다). | 동일합니다. | 600000(허용 범위 5000~3600000) |
| `--files <glob>` | 문자열입니다. 절대경로 순회 검사를 먼저 하지만, 그 검사를 통과해도 항상 `CCP-INVALID-001`("--files is not supported in the MVP")로 거부합니다. | 선언하지 않습니다. | 없음 |
| `--task` | 문자열입니다. 값이 있으면 위치 인자보다 우선하는 프롬프트 값으로 씁니다. | 동일합니다. | 없음(주면 위치 인자 프롬프트보다 우선합니다) |
| `--effort low\|medium\|high` | bool 플래그로 선언되어 있지만, 값과 무관하게 항상 `CCP-INVALID-001`("`--effort` is not supported by Antigravity")로 거부합니다. | 문자열 열거형입니다. `-c model_reasoning_effort=<level>`로 변환되어 codex 설정 오버라이드로 전달됩니다. | 없음 |
| `--write` | bool 플래그로 선언되어 있지만, 값과 무관하게 항상 `CCP-INVALID-001`("`--write` is not supported by Antigravity")로 거부합니다. | 선언도, 거부 등록도 하지 않습니다. 값이 `flags.write`로 파싱은 되지만 `buildArgs`가 전혀 읽지 않아 조용히 무시됩니다(에러 envelope 없이). | 없음 |
| `--cwd DIR` | 선언하지 않습니다. `buildArgs` 시그니처에 `cwd` 파라미터가 없습니다. | 문자열입니다. `-C <dir>`로 codex exec에 전달됩니다. | Codex는 `process.cwd()`입니다. |
| `--model NAME` | 선언하지 않습니다. 모델 선택 플래그가 없습니다. | 문자열입니다. `-m <model>`로 codex exec에 전달되며, 생략하면 codex CLI 자체 기본 모델을 씁니다. | 없음(생략 시 codex 자체 기본값) |

Codex rescue 호출은 `-- "실제 과제 문자열"`처럼 구분자를 씁니다. 이 구분자 뒤에 오는 모든 토큰은 옵션이 아니라 위치 인자, 즉 프롬프트로 취급됩니다.

Antigravity 호출에 자동으로 붙는 도구 권한 자동 승인 플래그와 그 설정 방법은 [시작하기](./getting-started.md) 문서의 '설정과 보안' 절을 참고하십시오.

## 선언하지 않은 플래그의 처리

Antigravity 파서는 정의되지 않은 옵션 토큰을 프롬프트, 즉 위치 인자 목록에 그대로 흡수합니다. 정의되지 않은 옵션을 주면 그 문자열이 통째로 프롬프트의 일부가 됩니다.

Codex 파서는 다릅니다. 선언 여부와 무관하게 옵션과 그 다음 값을 한 쌍으로 읽어 `flags` 객체에 저장하는 범용 파서를 씁니다. 따라서 정의되지 않은 옵션을 주면 프롬프트에 섞이지 않고 파싱된 뒤 어떤 핸들러도 읽지 않아 조용히 사라집니다.

## status·result·setup

`/ccp:antigravity-status <job_id>`와 `/ccp:codex-status <job_id>`는 `--background`로 만든 job의 현재 상태를 확인합니다.

`/ccp:antigravity-result <job_id> [--summary-only]`와 `/ccp:codex-result <job_id>`는 완료된 job의 요약과 `result_path`를 가져옵니다. `--summary-only`는 Antigravity만 선언하며, 파싱만 되고 결과 처리 핸들러가 이 값을 어디에서도 읽지 않는 완전한 no-op입니다. 현재는 효과가 없습니다. Codex는 이 플래그를 선언하지 않습니다.

`/ccp:antigravity-setup`과 `/ccp:codex-setup`은 인자를 받지 않고 각 CLI의 설치와 인증 상태를 점검합니다.

`status`와 `result` 핸들러는 위치 인자 `<job_id>` 대신 `--job-id <uuid>`로도 값을 받을 수 있습니다(`parsed.flags.jobId || parsed.positional[0]`로 읽습니다). 위치 인자 사용을 권장하며 `--job-id`는 대안입니다.

Antigravity는 job_id가 UUID v4 정규식 `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`을 만족하는지 실제로 검사합니다. Codex는 이 검사 함수를 선언하지 않아 값이 있기만 하면 통과합니다. Codex의 job_id에는 형식 검사가 없습니다.

## companion 직접 실행

companion 스크립트는 슬래시 커맨드보다 많은 서브커맨드를 선언합니다. 다음 형태로 직접 실행할 수 있습니다.

```
node plugins/ccp/scripts/companion.mjs <antigravity|codex> <subcommand> [...args]
```

또는 CLI를 고정한 별칭을 씁니다.

```
node plugins/ccp/scripts/antigravity-companion.mjs <subcommand> [...args]
node plugins/ccp/scripts/codex-companion.mjs <subcommand> [...args]
```

Antigravity가 선언하는 서브커맨드는 `rescue`, `status`, `result`, `setup`, `preflight`입니다. Codex가 선언하는 서브커맨드는 `setup`, `rescue`, `status`, `result`, `cancel`입니다.

`preflight`는 Antigravity 전용이며 슬래시 커맨드가 없습니다. 하네스 스크립트가 인증 상태를 사전 점검할 때 직접 호출하는 용도입니다.

`cancel`은 Codex 전용이며 슬래시 커맨드가 없습니다. 진행 중인 job을 취소합니다. 취소할 수 없는 상태에서 호출하면 오류를 반환합니다. 원인과 조치는 [문제 해결](./troubleshooting.md) 문서의 '에러 코드' 절을 참고하십시오.

## /ccp:audit

`/ccp:audit`는 companion 경로를 쓰지 않고 harness-audit.js를 직접 실행하는 별도 커맨드입니다. job 경로 해석은 companion과 같은 규칙(`resolvePaths`)을 따르며, 보고서는 `_workspace/_audits/` 아래에 절대 경로로 기록됩니다. envelope의 `result_path`와 `summary`도 모두 절대 경로입니다.

`--since`는 `YYYY-MM-DD` 형식만 받습니다. 그 밖의 값은 오류 없이 무시되고 모든 job을 감사합니다. `--format`은 `md` 또는 `json`이며 기본값은 `md`입니다.

예전 `result_file_path` 키만 가진 job 기록도 `result_path`로 자동 정규화되어 읽힙니다.

감사는 0에서 5점 사이로 8개 카테고리를 채점합니다. `N/A` 판정은 합계와 만점 모두에서 제외됩니다.

| 카테고리 | 판정 |
|---|---|
| context_efficiency | `summary_3lines`가 없거나 500자 이하인 job의 비율 × 5 |
| cost_efficiency | `token_usage.estimated`가 false인 job의 비율 × 5 |
| router_accuracy | `_workspace/04_router_report.md`가 있으면 5점, 없으면 N/A입니다(정확도를 실측하지 않습니다). |
| double_billing | 요약이 없거나 결과 파일 바이트 수가 요약 길이보다 큰 job의 비율 × 5 |
| fallback_health | job이 없으면 N/A입니다. `CCP-OAUTH-001`이 0건이면 5점, 있으면 3점입니다(재호출 추적은 아직 구현되지 않았습니다). |
| plugin_compat | `plugin.json`의 표준 5개 필드가 존재하는 비율 × 5 |
| borrowed_code_documented | (`LICENSES/` 3종 존재 + Apache 5개 파일 헤더 존재) / 2 × 5 |
| secret_leak | 비밀 패턴(Bearer, ANTIGRAVITY_API_KEY, GEMINI_API_KEY, AKIA로 시작하는 값 등)이 없으면 5점, 있으면 0점 |

job이 하나도 없으면 `CCP-AUDIT-001`을 반환합니다. 보고서 디렉터리 생성이나 쓰기가 실패하면 `CCP-AUDIT-002`를 반환합니다. 두 코드의 원인 문구와 조치는 [문제 해결](./troubleshooting.md) 문서의 '에러 코드' 절을 참고하십시오.

마켓플레이스에서 설치한 경우에는 `LICENSES/` 디렉터리가 없을 수 있어 borrowed_code_documented 점수가 0이 될 수 있습니다.

## 응답 envelope

CCP의 companion과 감사 스크립트는 세 가지 형태 중 하나로 응답합니다: 성공, 백그라운드 접수, 에러입니다.

### 성공

성공 envelope의 키는 스키마에서 `additionalProperties: false`로 고정되어 있으며 다음 7개뿐입니다: `summary`, `summary_truncated`, `result_path`, `tokens`, `exit_code`, `auto_routed`, `details`. 이 중 `summary`, `tokens`, `exit_code` 세 개는 필수입니다.

`tokens`의 모양은 CLI마다 다릅니다. Antigravity는 `{ input, output, estimated: true }`이며, 문자 수에 0.25를 곱해 추정한 값입니다. Codex는 `{ input, cached, output, total }`이며 `estimated` 필드가 없고 실측값입니다. `total`은 `max(0, input - cached) + output`, 즉 캐시분을 제외한 신규 과금 토큰만 더한 값입니다.

`details.mode`의 실제 값은 Antigravity에서 서브커맨드에 따라 달라집니다. `rescue`와 `result`는 `antigravity`, 백그라운드 접수는 `background`, `--fallback-claude`를 쓴 경우는 `fallback_claude`입니다. `setup`, `preflight`, `status`는 `details`에 `mode` 키 자체가 없습니다. Codex는 서브커맨드와 무관하게 항상 `codex`입니다.

`result_path`는 Codex의 포그라운드 rescue 중 요약이 잘리지 않은 경우에만 `null`이 됩니다. 이 경우 job 기록 자체를 남기지 않기 때문입니다. Antigravity는 포그라운드도 항상 job 기록을 남기므로 `result_path`가 항상 채워집니다.

`summary`는 500자를 넘지 않습니다. 500자를 넘으면 문장 경계에서 우선 자르고, 문장 경계가 예산의 60% 미만 지점이면 공백 경계로 자르고, 그마저 없으면 지정된 길이에서 그대로 자릅니다. 잘린 자리에는 `...(truncated)` 표시가 붙고, 이때만 `summary_truncated`가 `true`입니다. 잘리지 않았을 때 `false`를 명시하지는 않습니다. 전문은 `result_path`가 가리키는 파일에 남습니다.

### 백그라운드 접수

`--background`로 접수되면 스키마 검증 대상이 아닌 세 번째 형태로 응답합니다: `{ job_id, status: "queued", next_action, details? }`.

### 에러

에러 envelope은 `error.code`, `error.message`, `error.action`, `error.recovery`와 최상위의 `exit_code`, `auto_routed`, `details`로 구성됩니다. `recovery` 값의 의미와 두 CLI 사이의 세부 구조 차이는 [아키텍처](./architecture.md) 문서의 'envelope과 에러 코드 체계' 절을 참고하십시오.

### exit code

companion은 두 CLI 공통으로 성공 시 0, 에러 시 1을 반환합니다.

## 다음 문서

라우터가 슬래시 없는 프롬프트를 어떻게 CLI로 분기하는지 알아보려면 [라우터](./router.md) 문서를 참고하십시오.
