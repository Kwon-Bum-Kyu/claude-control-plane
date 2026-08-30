---
name: feedback-json-echo-pipe-corruption
description: zsh 내장 echo로 --json 출력을 변수 보간·파이프하면 백틱/백슬래시가 재해석되어 가짜 JSON 파싱 실패가 재현된다 — 파일 리다이렉트로 재확인할 것
metadata:
  type: feedback
---

CLI 하니스의 `--json` 출력을 `out=$(cmd --json); echo "$out" | node -e '...'` 형태로 재파싱하면, 출력 문자열에 `\`` (이스케이프된 백틱) 같은 시퀀스가 있을 때 zsh 내장 `echo`가 그 백슬래시를 셸 단계에서 재해석해 JSON을 깨뜨린다. 결과로 `SyntaxError: Bad escaped character in JSON`이 발생하지만, 이것은 **셸 도구의 아티팩트지 검사 대상 CLI의 결함이 아니다.**

**Why:** `ccp-subagent-isolation-run` 전체 QA에서 AC-6(violation-* 7종) 검증 중 4건(`violation-chained-command`·`violation-adapter-mismatch`·`violation-not-companion-script`·`violation-unexpected-invocation`)이 이 경로로 "JSON 파싱 실패"처럼 보였다. 파일로 직접 리다이렉트(`cmd --json > file.json`)한 뒤 `node -e 'JSON.parse(fs.readFileSync(...))'`로 다시 검증하니 4건 전부 정상 파싱되고 기대값과 일치했다 — 실제로는 엔진이 유효한 JSON(`\\\`` = 이스케이프된 백슬래시 + 리터럴 백틱)을 내고 있었는데, `echo "$var"`가 그 백슬래시를 한 번 더 삼킨 것이었다. 이 착각을 그대로 결함으로 보고했다면 정상 동작하는 엔진에 허위 HIGH 결함을 씌울 뻔했다.

**How to apply:** CLI의 `--json`/기계용 출력을 검증할 때는 항상 `cmd --json > file` 직접 리다이렉트 후 파일을 파싱할 것. `$(...)` 캡처 후 `echo`로 재출력하거나 변수 보간으로 파이프에 흘리는 경로는 백틱·백슬래시가 포함된 페이로드(예: task 본문에 이스케이프된 백틱을 의도적으로 심은 fixture, `02_regression_cases.md` §1의 `TASK_Q`)에서 셸별로 다르게 깨질 수 있다. 이상 징후(SyntaxError 등)가 나오면 먼저 "이게 셸 왕복 때문 아닌가"부터 배제하고, 그다음에 엔진 결함으로 승격할 것.
