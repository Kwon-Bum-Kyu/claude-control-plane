# 변경 이력

이 파일에는 이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고, 버전 번호는 [Semantic Versioning](https://semver.org/)을 따릅니다.

각 버전 항목은 해당 태그의 커밋 이력을 바탕으로 작성합니다.

## [Unreleased]

### 수정

- CLI 출력이 1 MiB를 넘으면 정상으로 끝난 위임도 `CCP-TIMEOUT-001`로 보고되던 문제를 고쳤습니다. 이제 표준출력과 표준에러 합계 256 MiB까지는 정상 처리하고, 그보다 크면 시간 초과가 아니라 실행 실패(`CCP-AG-001`, `CCP-CODEX-001`)로 보고합니다. 제한 시간 전에 다른 이유로 종료 신호를 받은 CLI도 이제 실행 실패로 보고합니다.
- 같은 실행 결과를 포그라운드와 백그라운드가 다르게 판정하던 문제를 고쳤습니다. codex가 JSONL 이벤트 없이 끝나면 백그라운드도 포그라운드처럼 `CCP-CODEX-002`로 기록합니다(이전에는 평문이면 빈 결과로 완료, 빈 출력이면 `CCP-CODEX-001`). antigravity가 아무것도 출력하지 않고 정상 종료하면 백그라운드도 포그라운드처럼 요약 `(empty)`로 완료합니다(이전에는 `CCP-AG-001` 실패).
- 위 변경으로 codex 백그라운드 job이 JSONL이 아닌 평문으로 끝났을 때 `/ccp:codex-result`가 빈 본문 대신 `CCP-JOB-004`를 돌려줍니다.
- 백그라운드 작업이 CLI를 실행하지 못한 경우(실행 권한 없음, 경로 없음 등)를 `CCP-TIMEOUT-001`로 기록하던 문제를 고쳤습니다. 이제 포그라운드와 같은 실행 실패 코드로 기록하고, job 기록의 `error.spawn_code`에 원인(`EACCES` 등)을 남깁니다.
- antigravity 포그라운드 job 기록이 실패 원인 코드를 남기지 않던 문제를 고쳤습니다. 실패하면 백그라운드와 같은 모양으로 `exit_code`, `error.code`, `duration_ms`를 기록하고, 성공해도 `exit_code`와 `duration_ms`를 남깁니다.
- 세션 시작 점검이 Antigravity CLI만 확인해, codex만 쓰는 사용자에게도 매 세션 agy 미설치와 인증 없음 안내가 가던 문제를 고쳤습니다. 이제 설치된 CLI만 점검해 버전이 낮거나 인증이 없을 때 안내하고, 지원 CLI가 하나도 설치되어 있지 않을 때만 setup 커맨드를 한 줄로 안내합니다. 두 CLI 모두 버전이 최소 요구치보다 낮으면 새로 안내합니다. codex 인증은 세션 시작 때 확인하지 않습니다.
- 세션 시작 점검에 훅 자체의 시간 상한이 없어, CLI 버전 확인이 멈추면 세션의 첫 응답이 그만큼 늦어지던 문제를 고쳤습니다. CLI마다 5초, 점검 전체는 15초가 상한입니다.
- `/ccp:antigravity-setup`, `/ccp:codex-setup`의 버전 확인에 시간 상한이 없던 문제를 고쳤습니다. 인증 확인과 같은 시간(antigravity 60초, codex 30초)이 지나면 반환합니다.

### 변경

- 골든 envelope 비교 스크립트가 capture 단계에서 결과 파일을 얻지 못하면, 예외로 끝나는 대신 capture의 종료 코드와 출력 전체를 보이고 종료 코드 2로 끝납니다.
- CI와 로컬 검증에 실행 결과 판정, 세션 시작 점검 훅, 골든 비교 진단 검사 3종을 추가했습니다.

## [v0.5.0] - 2026-11-22

### 수정

- codex `cancel`이 작업 프로세스만 종료하고 그 프로세스가 실행한 Codex CLI는 계속 돌던 문제를 고쳤습니다. 이제 작업 프로세스 그룹 전체에 종료 신호를 보냅니다.
- 백그라운드 job 기록의 세션 식별자가 호출마다 다른 부모 프로세스 ID로 남던 문제를 고쳤습니다. Claude Code가 넘기는 `CLAUDE_CODE_SESSION_ID`를 먼저 읽고, 없으면 `CLAUDE_SESSION_ID`, 그다음 부모 프로세스 ID를 씁니다.
- `/ccp:antigravity-status`와 `/ccp:codex-status`가 맡은 프로세스가 이미 종료된 job을 `running`으로 보여 주던 문제를 고쳤습니다. status가 조회하기 전에 `SubagentStop` 훅과 같은 규칙으로 그 job을 `failed`로 기록합니다.
- antigravity 포그라운드 job 기록에 companion 프로세스의 pid를 남깁니다. 이전에는 중단된 포그라운드 job이 시작 후 타임아웃에 5분을 더한 시간이 지나야 정리됐고, 이제는 그 프로세스가 종료되면 바로 정리됩니다.
- codex에서 `--fallback-claude=false`가 fallback을 켜던 문제를 고쳤습니다.

### 변경

- 호환성 변경: 이전 버전에서 오류 없이 받던 플래그 일부가 이제 `CCP-INVALID-001` 오류가 됩니다. companion이 각 CLI가 선언하지 않은 플래그를 작업을 시작하기 전에 거부하기 때문입니다. 해당하는 것은 antigravity의 `--summary-only`, `--poll-interval-ms`, `--renew`(받기만 하고 효과가 없어 선언을 뺐습니다)와 `--model`, codex의 `--write`, `--max-tokens`, `--files`, `--summary-only`, 그리고 codex가 받아 오던 `--timeoutMs`·`--jobId` 같은 camelCase 철자의 플래그 이름입니다(이제 `--timeout-ms`·`--job-id`처럼 선언한 철자만 받습니다). `-x`처럼 대시 하나로 시작하는 토큰도 `--` 앞에 두면 거부되므로, `-`로 시작하는 과제는 `--` 뒤에 두거나 antigravity에서는 `--task`로 넘깁니다.
- 선언하지 않은 플래그를 받았을 때의 동작이 바뀌었습니다. 이전에는 antigravity가 그 플래그를 과제 문자열에 섞거나 버렸고, codex는 읽은 뒤 버리거나 다음 토큰을 값으로 삼켜 과제가 사라졌습니다. 이제 거부 응답이 지원하지 않는 플래그 이름(`unsupported_flag`)과 그 CLI가 받는 플래그 목록을 알려 주며, 플래그 값은 싣지 않습니다. `--` 뒤의 토큰은 계속 과제로 넘어갑니다.
- codex의 `--background`와 `--fallback-claude`가 뒤의 토큰을 값으로 읽지 않습니다. 이전에는 `--` 없이 `--background 과제`처럼 쓰면 과제의 첫 단어를 이 플래그의 값으로 삼켰습니다.
- 에러 카탈로그에서 내보내는 곳이 없던 `CCP-UNSUPPORTED-101`을 삭제했습니다.

### 추가

- antigravity가 `--cwd DIR`을 받아 위임한 CLI를 그 디렉터리에서 실행합니다. 두 CLI 모두 존재하지 않는 디렉터리를 주면 `CCP-INVALID-001`로 거부합니다.
- antigravity가 선언한 플래그를 `--name=value` 형태로도 받습니다. `--background`·`--fallback-claude`는 값을 참·거짓으로 읽고, 그 밖의 bool 플래그는 값과 무관하게 켜진 것으로 보므로 `--sandbox=false`도 샌드박스를 켭니다.
- codex가 `status`·`result`·`cancel`의 `--job-id`를 선언합니다. 문서가 안내하던 대안 형식이 미선언 플래그 거부 뒤에도 그대로 동작합니다.
- antigravity rescue 서브에이전트의 허용 명령에 `--sandbox`와 `--cwd DIR`을 넣었습니다. 이전에는 사용자가 준 `--sandbox`가 명령 플래그로 빠지지 못하고 과제 문자열에 남았습니다.

## [v0.4.5] - 2026-11-22

### 수정

- `SubagentStop` 훅(`rescue-finalize.js`)이 작업 프로세스가 살아 있는지 확인하지 않고 시작 후 5분이 지난 `running` job을 `failed`로 바꾸던 문제를 고쳤습니다. 정상적으로 진행 중인 포그라운드 job(기본 타임아웃 10분)과 백그라운드 job이 실패로 표시될 수 있었습니다. 이제 작업 프로세스 pid가 기록된 job은 그 프로세스가 종료됐을 때만, pid가 없는 job은 그 job의 타임아웃에 5분을 더한 시간이 지났을 때만 정리하며, 원래 기록에 있던 상태 키만 바꿉니다.
- rescue 서브에이전트가 받은 과제를 줄여서 companion에 넘기거나, 질문처럼 읽히는 과제에 companion을 실행하지 않고 직접 답하던 문제를 고쳤습니다. 두 서브에이전트 정의가 받은 과제를 companion에 넘길 데이터로 다루고, 줄이거나 고치지 않고 그대로 명령에 넣으며, companion을 실행하지 않은 채 답하지 않도록 지시합니다.

### 변경

- 고아 job 정리 대상에 codex 백그라운드 job을 포함했습니다. 작업 프로세스가 종료됐는데 `running`으로 남은 codex job은 이제 `failed`로 기록되고, `/ccp:codex-result`는 진행 중(`CCP-JOB-002`) 대신 실패 코드(`CCP-JOB-004`)를 돌려줍니다. 이전에는 정리 대상에서 빠져 `running`으로 남았습니다. 업데이트 전부터 이 상태로 남아 있던 기록도 다음 정리 때 `failed`가 됩니다. codex 포그라운드 실행은 job 기록을 남기지 않으므로 해당하지 않습니다.
- pid가 없는 포그라운드 job(antigravity)의 정리 한도를 시작 후 5분에서 그 job의 타임아웃에 5분을 더한 시간으로 늘렸습니다. 예를 들어 슬래시 커맨드로 실행한 포그라운드 호출은 14분, companion을 직접 실행한 호출은 15분이 지나야 정리됩니다.
- CI에 `rescue-finalize.js` 동작 검사 단계를 추가했습니다.
- `/ccp:codex-rescue`와 `/ccp:antigravity-rescue`가 메인 Claude에게 Agent 도구로 rescue 서브에이전트를 호출하고 사용자의 원래 요청을 바꾸지 않고 넘기라고 지시합니다. 두 커맨드의 허용 도구에 `Agent`를 추가했습니다.
- CI에 rescue 과제 전달 지시 검사 단계를 추가했습니다.

## [v0.4.4] - 2026-11-02

### 수정

- rescue 서브에이전트(`codex-rescue`, `antigravity-rescue`)가 companion을 Bash 도구의 기본 제한 시간(2분, `timeout`을 주지 않을 때)으로 실행해, 2분이 넘는 포그라운드 위임이 envelope 없이 백그라운드로 넘어가던 문제를 고쳤습니다. 두 서브에이전트는 이제 Bash `timeout`을 600000(Bash 도구의 최대 제한 시간)으로 지정하고, Bash가 명령을 백그라운드로 넘겼다는 안내를 받으면 그대로 반환하며 companion을 다시 실행하지 않습니다.
- 슬래시 커맨드로 실행한 포그라운드 호출에 사용자가 `--timeout-ms`를 주지 않으면 서브에이전트가 `rescue` 바로 뒤에 `--timeout-ms 540000`을 붙입니다. CLI가 시간 안에 끝나지 않으면 Bash `timeout`(600000)보다 먼저 `CCP-TIMEOUT-001` envelope이 돌아옵니다. 백그라운드 호출과 companion 직접 실행의 기본값은 600000 그대로입니다.

### 변경

- `/ccp:antigravity-rescue`의 인자 안내와 서브에이전트 허용 패턴에 `--timeout-ms N`을 노출했습니다. companion은 이미 이 플래그를 받고 있었습니다.
- CI에 rescue 서브에이전트 정의의 필수 지시를 확인하는 검사 단계를 추가했습니다.

## [v0.4.3] - 2026-10-20

### 수정

- 위임한 CLI가 타임아웃으로 종료될 때 `CCP-TIMEOUT-001` 대신 일반 실행 실패 코드(`CCP-AG-001` 등)로 보고되던 문제를 고쳤습니다. 코어가 spawn 결과의 신호만 보고 타임아웃을 판정해, SIGTERM을 받고 정리 후 자체 종료 코드로 끝나는 CLI(antigravity)의 타임아웃을 놓치고 있었습니다. 이제 spawn 결과의 `ETIMEDOUT` 코드를 기준으로 판정하며, 포그라운드와 백그라운드 경로 모두에 적용됩니다.
- 백그라운드 워커가 어댑터의 `timeouts.background` 선언을 쓰지 않고 항상 포그라운드 기본값을 쓰던 문제를 고쳤습니다. `--timeout-ms`를 주지 않으면 포그라운드 실행과 백그라운드 워커가 각자 선언된 기본값을 씁니다. codex 어댑터의 `timeouts.background`는 240000에서 600000으로 올려 실제 동작은 종전과 같게 유지했습니다(실제 백그라운드 작업이 390초를 넘긴 기록이 있어 240000이 적용되면 중단됩니다).

## [v0.4.2] - 2026-10-12

### 제거

- 컨텍스트 사용량 경고 훅 `suggest-compact.js`와 `context-budget` 스킬, 에러 카탈로그의 `CCP-COMPACT-001` 항목을 제거했습니다. 훅은 컨텍스트 창을 200K로 가정해 1M 창이 기본인 현재 모델에서 사용량을 잘못 계산했고, Claude Code가 컨텍스트 경고와 statusline 사용량 표시를 자체 제공하므로 플러그인이 같은 기능을 중복할 이유가 없어졌습니다. `PreCompact` 시점의 안내는 Claude Code가 그 이벤트의 `additionalContext` 출력을 받지 않아 실제로는 전달되지 않던 상태였습니다. 위임 추천은 `router-suggest.js`가 계속 담당합니다.

## [v0.4.1] - 2026-09-27

### 추가

- `/ccp:codex-rescue`와 `/ccp:antigravity-rescue`에 `--mcp NAME[,NAME...]` 플래그를 추가했습니다. 위임 직전에 대상 CLI의 MCP 서버 등록 목록을 확인해, 적은 서버가 미등록이거나 비활성이거나 목록을 읽지 못하면 새 공용 에러 코드 `CCP-MCP-001`로 중단하고 직접 실행할 등록·활성화 명령을 안내합니다. 이에 따라 어댑터 계약에 `mcp.listArgs`, `mcp.parseList`, `mcp.installCommand`를 추가해 리프 키가 55개가 되었습니다.

### 수정

- `/ccp:audit`가 companion과 같은 job 경로와 결과 키(`result_path`)를 읽도록 고쳤습니다.
- 라우터의 매직 키워드 매칭에 경계 규칙을 추가해 이메일 형태 문자열 등에서 발생하던 부분 문자열 오탐을 없앴습니다.
- 헤드리스 자동화 경고가 단어 일부에 반응하던 오탐을 단어 경계 매칭으로 바로잡았습니다.
- 존재하지 않는 플래그와 커맨드를 가리키던 에러 안내 문구를 실제 안내에 맞게 고쳤습니다.
- `/ccp:audit` 설명을 실제 8개 카테고리 판정식에 맞췄습니다.

### 변경

- envelope 스키마의 `$id` 값을 저장소 경로로 바꿨습니다.
- `pre-push` 훅을 공개 레포로 가는 push에만 적용합니다. 자기 포크로 가는 push는 제한하지 않습니다.
- CI에 요약 절단 검사 스텝을 추가했습니다.
- background 호출에서 받기만 하고 쓰지 않던 `--poll-interval-ms` 값의 내부 전달 경로를 제거했습니다. 플래그는 계속 받지만 효과는 없습니다.
- 코드와 프롬프트에서 README 섹션 번호 참조를 파일 경로 참조로 바꿨습니다.
- 감사 커맨드 이름을 `ccp-audit`에서 `audit`으로 바꿨습니다.
- 개발용 비공개 레포와 공개 레포를 통합했습니다.

### 문서

- 한국어 문서를 기본 문서로 전환했습니다. `README.md`는 한국어이고 `README.en.md`는 영어입니다.

## [v0.4.0] - 2026-08-26

- companion 코어를 통합하고, 그 과정에서 발견한 결함을 수정했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.3.0...v0.4.0

## [v0.3.0] - 2026-06-15

- 위임 대상 CLI를 Gemini에서 Antigravity로 전환했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.2...v0.3.0

## [v0.2.2] - 2026-05-17

- gemini-companion의 rescue 호출에서 발생하던 인자 스코프 누수(ReferenceError)를 수정했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.1...v0.2.2

## [v0.2.1] - 2026-05-12

- 버전을 0.2.1로 올리고 marketplace 메타데이터를 동기화했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.0...v0.2.1

## [v0.2.0] - 2026-05-06

- 최초 태그 릴리스입니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/commits/v0.2.0

[Unreleased]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.5.0...HEAD
[v0.5.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.5.0
[v0.4.5]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.5
[v0.4.4]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.4
[v0.4.3]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.3
[v0.4.2]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.2
[v0.4.1]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.1
[v0.4.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.0
[v0.3.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.3.0
[v0.2.2]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.2
[v0.2.1]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.1
[v0.2.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.0
