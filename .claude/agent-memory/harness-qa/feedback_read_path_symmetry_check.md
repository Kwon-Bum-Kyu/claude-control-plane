---
name: feedback-read-path-symmetry-check
description: 같은 종류 파일(meta.json, jsonl 본문 등)을 읽는 여러 코드 경로 중 하나만 에러 래핑돼 있는 비대칭을 의도적으로 탐침할 것 — 정상 케이스만으로는 안 잡힌다
metadata:
  type: feedback
---

CCP rescue-isolation 판정 엔진 QA에서, `.meta.json` 읽기(`identifyTranscript`)는 `try { readFileSync } catch { throw fsErrorToSkip(e, metaPath) }` 로 정상 래핑돼 있었지만, 바로 옆의 jsonl 트랜스크립트 본문 읽기(`parseTranscriptFile`)는 같은 패턴이 빠져 있어 `readFileSync` 가 예외를 그대로 던졌다. 두 함수는 같은 파일 안에, 같은 목적(파일을 읽어 판정 근거로 삼음)으로 존재해서 코드를 훑어보면 "당연히 같은 방식으로 처리됐겠지" 하고 넘어가기 쉽다. `chmod 000 <jsonl>` 로 실제 트리거해 보고서야 비대칭이 드러났다 — 코드 읽기만으로는 두 함수의 시그니처가 비슷해 보여 놓치기 쉬웠다.

**Why:** 정상 입력 fixture(읽기 가능한 파일)만으로 회귀 스위트를 채우면 이런 비대칭은 영원히 드러나지 않는다. 에러 카탈로그(SKIP 사유 enum 등)에 특정 실패 유형이 "정의돼 있다"는 사실이 "모든 발생 지점에서 실제로 그 분류가 적용된다"는 뜻은 아니다 — [[feedback-validator-coverage-gap]]과 같은 계열의 함정("카탈로그/스캐너가 정의는 하되 실제로 도달 못 하는 코드 경로가 있다")이지만 이번엔 검증기가 아니라 **판정 대상 코드 자체**에서 발생했다.

**How to apply:** 에러 처리 표(§4 류 문서)에 나열된 각 에러 유형에 대해, "이 유형을 유발하는 파일 읽기가 코드 안에 몇 군데 있고, 그중 실제로 이 분류 경로로 이어지는 곳이 몇 군데인가"를 grep으로 세어본다(`fsErrorToSkip`처럼 공용 헬퍼가 있으면 그 헬퍼를 호출하는 지점의 목록과, `readFileSync`/`statSync` 등 원시 호출 지점의 목록을 대조). 헬퍼를 안 쓰는 원시 호출이 남아 있으면 그 지점에 대해 실제로 실패를 주입(`chmod 000`, 존재하지 않는 심볼릭 링크 등)해 SKIP/에러 카탈로그가 그 경로에서도 발현되는지 확인한다. 특히 "형제 함수"(같은 파일, 비슷한 이름, 비슷한 목적)가 여러 개 있는 코드에서 하나만 검증하고 넘어가지 않는다.
