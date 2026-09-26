# 문제 해결

이 문서는 CCP 를 쓰는 중에 만날 수 있는 에러 코드와 훅 안내 메시지, 그리고 setup 커맨드가 확인하는 항목을 정리합니다.

## 에러 코드

모든 에러는 JSON envelope 의 `error.code` 값으로 나타납니다. 실패한 호출은 `result_path` 를 돌려주지 않습니다. 대신 `details` 안의 `stderr_head`나 `stdout_head`(코드에 따라 있는 경우), 또는 job 디렉터리(`_workspace/_jobs/<job_id>/`) 안의 로그 파일을 확인합니다. 어떤 필드와 로그를 봐야 하는지는 코드마다 다르며 아래 표의 "다음 행동" 칸에 적어 두었습니다. 에러 코드의 형식과 카탈로그 병합 규칙, envelope 구조의 세부 사항은 [아키텍처](./architecture.md)를 참고하십시오.

| 코드 | 발생 CLI | 원인 | 다음 행동 | recovery |
|------|----------|------|-----------|----------|
| CCP-INVALID-001 | 공용 | 인자 파싱에 실패했습니다. 지원하지 않는 플래그를 준 경우도 이 코드로 거부됩니다. 어떤 플래그가 어떤 CLI 에서 거부되는지는 [슬래시 커맨드](./slash-commands.md)를 참고하십시오 | 사용법을 확인하고 다시 시도합니다 | abort |
| CCP-JOB-001 | 공용 | 지정한 job_id 를 찾을 수 없습니다. codex 는 job 메타데이터가 손상된 경우도 이 코드로 처리합니다(CCP-JOB-003 을 쓰지 않습니다) | job_id 를 다시 확인합니다 | abort |
| CCP-JOB-002 | 공용 | job 이 아직 끝나지 않았습니다. codex 는 대기 중이거나 실행 중인 상태를 전부 이 코드로 나타냅니다 | status 커맨드로 상태를 확인한 뒤 다시 시도합니다 | retry |
| CCP-JOB-003 | antigravity | job 메타데이터가 손상되었습니다(codex 는 같은 상황도 CCP-JOB-001 로 처리합니다) | job 디렉터리를 삭제하고 새 job 을 만듭니다 | abort |
| CCP-JOB-004 | 공용 | 결과 파일이 없습니다. codex 는 완료되지 않은 상태(실패, 취소 등) 전부를 이 코드로 나타냅니다 | rescue 를 다시 호출합니다 | abort |
| CCP-JOB-409 | codex | 현재 상태에서는 취소할 수 없습니다(antigravity 는 cancel 서브커맨드가 없어 이 코드에 도달하지 않습니다) | job 상태를 확인하고 다시 시도합니다 | abort |
| CCP-TIMEOUT-001 | 공용 | CLI 응답이 시간 안에 끝나지 않았습니다. 백그라운드 job 이 응답 없이 5분을 넘기면 서브에이전트 종료를 감지하는 훅이 이 코드로 강제 종료 처리하기도 합니다 | 다시 시도하거나 `--background` 로 비동기 실행합니다 | retry |
| CCP-SETUP-002 | 공용 | Node.js 메이저 버전이 요구치 미만입니다 | Node.js 를 설치하거나 갱신하고 다시 실행합니다. 정확한 최소 버전은 [시작하기](./getting-started.md)를 참고하십시오 | abort |
| CCP-SETUP-001 | antigravity | agy 가 설치되어 있지 않거나 버전이 최소 요구치 미만입니다 | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` 로 설치하거나 `agy update` 로 갱신하고, `~/.local/bin` 이 PATH 에 있는지 확인한 뒤 `/ccp:antigravity-setup` 을 다시 실행합니다 | abort |
| CCP-OAUTH-001 | antigravity | antigravity 인증이 없거나 유효하지 않습니다 | `agy` 를 한 번 대화형으로 실행해 인증하거나 `/ccp:antigravity-rescue --fallback-claude "<원래 작업>"` 으로 전환합니다. 인증 관련 환경 변수는 [시작하기](./getting-started.md)를 참고하십시오 | fallback |
| CCP-AG-001 | antigravity | antigravity CLI 실행이 실패했습니다(그 외 실패의 기본 분류입니다) | job 디렉터리의 `agy.log` 를 확인하거나(에러 상세에 job_id 가 있습니다) 메인 Claude 에이전트로 다시 시도합니다 | retry |
| CCP-AG-002 | antigravity | antigravity 무료 등급 쿼터를 초과했습니다 | 나중에 다시 시도하거나 `--fallback-claude` 를 씁니다 | fallback |
| CCP-API-001 | 현재 발생하지 않음 | Claude Code 버전이 CCP 요구치 미만이라는 뜻으로 카탈로그에 선언되어 있지만, 이 조건을 실제로 검사하는 코드가 없습니다 | 해당 없음 | abort |
| CCP-SETUP-101 | codex | Codex CLI 가 설치되어 있지 않습니다 | `brew install codex` 또는 `npm install -g @openai/codex` 로 설치하고 다시 실행합니다 | abort |
| CCP-SETUP-102 | codex | Codex CLI 버전이 최소 요구치 미만입니다 | Codex CLI 를 갱신하고 다시 실행합니다. 정확한 최소 버전은 [시작하기](./getting-started.md)를 참고하십시오 | abort |
| CCP-OAUTH-101 | codex | Codex 인증이 필요합니다. codex 는 rescue 호출마다 실제로 인증 상태를 확인합니다 | `codex login` 을 실행하거나 `--fallback-claude` 를 씁니다 | fallback_claude |
| CCP-CODEX-001 | codex | Codex CLI 실행이 실패했습니다. 타임아웃이 아닌 실패는 전부 이 코드 하나로 분류됩니다 | 백그라운드 job 이면 job 디렉터리의 `stderr.log` 를 확인하고, 아니면 Claude 에서 다시 시도합니다 | retry |
| CCP-CODEX-002 | codex | Codex 응답에서 유효한 JSONL 이벤트를 찾지 못했습니다 | `details.stdout_head`(첫 200자)를 확인하고 다시 시도하거나 Claude 에서 처리합니다 | retry |
| CCP-UNSUPPORTED-101 | 현재 발생하지 않음(codex) | codex 가 지원하지 않는 옵션이라는 뜻으로 카탈로그에 선언되어 있지만, codex 는 거부 목록이 비어 있어 실제로 이 코드를 내보내는 호출부가 없습니다 | 해당 없음 | abort |
| CCP-AUDIT-001 | 감사(`/ccp:audit`) | 감사할 job 데이터가 없습니다 | `--since` 범위를 조정하고 다시 시도합니다 | abort |
| CCP-AUDIT-002 | 감사(`/ccp:audit`) | 감사 스크립트 실행이 실패했습니다(보고서 쓰기 실패를 포함합니다) | 나중에 다시 시도하거나 로그를 확인합니다 | retry |
| CCP-INVALID-001 | 라우터(`router-decide.mjs`) | `--prompt` 도, 표준 입력의 `prompt` 도 없이 실행했습니다(exit code 2) | `--prompt "<텍스트>"` 를 주거나 표준 입력으로 `{"prompt":"..."}` 를 넘깁니다 | user_action_required |
| CCP-ROUTER-001 | 라우터(`router-decide.mjs`) | 라우팅 분류 중에 예외가 발생했습니다(exit code 3) | 자동 라우팅에 기대지 말고 슬래시 커맨드로 직접 위임합니다 | abort |

## 훅 안내 메시지

다음 표식은 훅과 라우터가 텍스트에 직접 붙이는 안내입니다. 이 중 CCP-ROUTER-001 은 `router-decide.mjs` 가 JSON 에러 코드로도 쓰며, 그 경우는 위 에러 코드 표를 참고하십시오. 결정 로직과 조건의 자세한 내용은 [라우터](./router.md)를 참고하십시오.

- CCP-ROUTER-001: 라우팅 결정이 비효율적일 수 있다고 추천만 하는 표식입니다.
- CCP-ROUTER-002: 라우터가 자동으로 위임한 결과의 요약 앞에 붙는 표식입니다.
- CCP-META-WARN: 헤드리스 자동화가 의심되는 프롬프트에 덧붙는 경고 표식입니다.
- CCP-COMPACT-001: 컨텍스트 사용량이 임계치를 넘었을 때 붙는 안내 표식입니다.

## setup 이 확인하는 것

`/ccp:antigravity-setup` 과 `/ccp:codex-setup` 은 다음 순서로 확인합니다.

1. Node.js 메이저 버전을 확인합니다. 20 미만이면 CCP-SETUP-002 로 중단합니다. 패치 버전(20.19, 22.7 등)까지는 검사하지 않고 메이저 버전만 봅니다.
2. CLI 설치와 버전을 확인합니다. 미달이면 antigravity 는 CCP-SETUP-001, codex 는 설치 누락이면 CCP-SETUP-101, 버전 미달이면 CCP-SETUP-102 로 중단합니다.
3. 인증을 실제 호출로 확인합니다. antigravity 는 60000ms, codex 는 30000ms 안에 응답이 없으면 시간 초과로 처리합니다.

setup 이 확인하는 인증과 rescue 를 호출하기 직전에 확인하는 인증은 방식이 다릅니다. antigravity 는 rescue 호출마다 자격 증명이 존재하는지만 저비용으로 확인하고, 실제 CLI 호출로 인증을 확인하는 것은 setup 뿐입니다. codex 는 rescue 호출마다 실제로 인증 상태를 확인하는 호출을 수행합니다.

CLI 설치와 인증 명령 자체는 [시작하기](./getting-started.md)를 참고하십시오.

## 자주 묻는 질문

- **`--write` 를 antigravity 에 주면 어떻게 되나요?** antigravity 는 `--write` 를 지원하지 않는 플래그로 선언해 두어 값과 무관하게 항상 CCP-INVALID-001 로 거부합니다. codex 는 `--write` 를 선언하지 않으므로 값을 줘도 조용히 무시되고 에러가 나지 않습니다.
- **`--effort` 를 antigravity 에 주면 왜 거부되나요?** antigravity 는 `--effort` 를 지원하지 않는 플래그로 등록해 두어 값과 무관하게 항상 CCP-INVALID-001 로 거부합니다. codex 는 이 값을 실제로 CLI 호출에 반영합니다.
- **`--summary-only` 를 줬는데 요약 길이가 그대로입니다.** 현재는 no-op 입니다. antigravity 만 이 플래그를 선언하고 있고, 어떤 핸들러도 이 값을 읽지 않습니다.
- **`result_path` 가 null 로 돌아왔습니다.** codex 의 포그라운드 rescue 중 요약이 잘리지 않은 경우는 job 기록을 남기지 않아 `result_path` 가 null 입니다. antigravity 는 포그라운드에서도 항상 job 기록을 남겨 값이 채워집니다.
- **codex 백그라운드 job 의 타임아웃이 예상과 다릅니다.** `--timeout-ms` 를 따로 주지 않으면 codex 는 포그라운드와 백그라운드 모두 같은 기본값을 씁니다. 백그라운드 전용 기본값이 선언되어 있지만 실행 경로에서는 쓰이지 않습니다. 정확한 기본값은 [슬래시 커맨드](./slash-commands.md)를 참고하십시오.
- **감사(`/ccp:audit`) 점수가 예상보다 낮게 나옵니다.** 마켓플레이스로 설치한 환경에는 `LICENSES/` 디렉터리가 없을 수 있어 차용 코드 문서화 점수가 낮아질 수 있습니다. 이 항목은 설치 방식에 따른 차이이며 코드 결함이 아닙니다.

## 버그 신고

이 문서로 해결되지 않으면 저장소의 이슈 트래커에 등록합니다. 이슈 작성 방법과 실재하는 라벨 목록은 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하십시오. 등록할 때는 실행한 커맨드, 받은 에러 코드, job_id(있다면)를 함께 적으면 원인을 더 빠르게 좁힐 수 있습니다.

## 다음 문서

- [시작하기](./getting-started.md)
- [슬래시 커맨드](./slash-commands.md)
- [라우터](./router.md)
- [아키텍처](./architecture.md)
- [README](../../README.md)
