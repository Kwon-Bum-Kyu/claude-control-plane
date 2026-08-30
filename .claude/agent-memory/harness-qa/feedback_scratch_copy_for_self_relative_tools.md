---
name: feedback-scratch-copy-for-self-relative-tools
description: 스크립트가 자기 위치(fileURLToPath(import.meta.url)) 기준으로 자원 경로를 산출하면, 그 스크립트를 바이트 동일 복사해 스크래치에 두고 실행하는 방식으로 보호된/미완성 디렉터리를 건드리지 않고도 실제 CLI 진입점을 검증할 수 있다
metadata:
  type: feedback
---

CCP rescue-isolation fixture 러너(`rescue-isolation-fixture-test.mjs`)는 `FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')` 로 자원 경로를 스크립트 자신의 위치 기준 상대 경로로 계산한다. 이 런의 QA 시점에는 `tests/subagent/fixtures/`가 다른 에이전트 작업 중이라 만들거나 읽을 수 없었는데, 러너 로직(deepEqual, 필드 투영, 2종 비-fixture 케이스 가드)을 코드만 읽고 신뢰하는 대신, 엔진·러너 두 `.mjs` 파일을 **바이트 동일**(`diff`로 확인)하게 스크래치 디렉터리로 복사한 뒤 그 복사본을 실행했다. 복사본의 `fileURLToPath(import.meta.url)`은 스크래치 경로로 해석되므로, 스크래치 안에 직접 합성한 `fixtures/`+`expected.json`을 대상으로 **실제 코드를 그대로** 실행할 수 있었다(로직을 재구현하지 않음).

**Why:** 이 방식이 없었다면 두 가지 나쁜 선택지만 남는다 — ① 코드를 읽고 "이렇게 동작할 것"이라고 추정만 하고 넘어가거나(존재 확인이지 동작 검증이 아님), ② 금지된 디렉터리(`tests/subagent/fixtures/`)에 임시로 파일을 만들었다 지우는 위험한 절차(다른 에이전트의 동시 작업과 충돌 가능, teardown 누락 위험)를 밟아야 한다. 자기 위치 기준 경로 해석은 원래 "레포 루트 어디서 실행해도 안전"하게 만들려는 설계 의도인데, 그 설계 의도를 거꾸로 이용해 "스크래치에서 실행해도 안전"하게 만들 수 있다.

**How to apply:** 검증 대상 스크립트가 `process.cwd()`가 아니라 자기 파일 위치 기준으로 경로를 산출하는지 먼저 확인한다(`fileURLToPath(import.meta.url)` 또는 `__dirname` 패턴 grep). 그렇다면: (1) 원본과 `diff`로 바이트 동일함을 확인하며 스크래치로 복사, (2) 복사본이 참조하는 상대 디렉터리(위 예의 `fixtures/`)를 스크래치 안에 직접 합성, (3) 복사본을 실행해 실제 CLI 동작을 검증. 이 기법은 보호된/공유/미완성 디렉터리를 건드리지 않고도 "존재 확인이 아니라 동작 검증"을 지킬 수 있게 해준다. 관련: [[project-ccp-subagent-isolation-run]].
