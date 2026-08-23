---
name: feedback-validator-coverage-gap
description: 자동 검증 스크립트(validate-evidence.mjs 등)의 "0 violations" 결과를 곧이곧대로 신뢰하지 말고 스캔 대상 파일 확장자/범위부터 확인할 것
metadata:
  type: feedback
---

`bin/validate-evidence.mjs`가 V-12(마스킹 누락 검사)를 실행할 때 `cases/<id>/` 하위에서 `.cmd`·`.stdout.json`·`.stderr.txt`·`.meta.json` **4종 확장자만** 스캔하도록 구현돼 있었다(코드: 파일 스캔 루프의 정규식이 이 4종만 매칭). 그런데 실제 증적에는 이 4종에 속하지 않는 자유 형식 텍스트/JSON 파일(`validate-strict.txt`, `hash-compare.txt`, `plugin-details.txt` 등 케이스별 추가 증적)이 다수 존재하고, 그 중 하나(`cases/T-1/validate-strict.txt`)가 실제로 마스킹 누락 상태(`$HOME` 원문 잔존)였는데도 검증기는 "0 violations"를 보고했다.

**Why:** "자동 검증기가 통과했다"는 "증적이 실제로 규격을 지킨다"와 동치가 아니다 — 검증기 자신의 스캔 범위가 좁으면 통과가 곧 은폐가 된다. incremental QA의 핵심 원칙("존재 확인이 아니라 동작 검증")이 검증기 자신에게도 적용돼야 한다는 사례.

**How to apply:** 자동 검증/린터 스크립트의 결과를 신뢰하기 전에, 그 스크립트가 실제로 스캔하는 파일 목록(확장자 필터·디렉터리 범위)을 먼저 읽고, 증적 디렉터리의 전체 파일 목록과 대조해 "스캔 대상 밖에 있는 파일"이 있는지 확인한다. 특히 `find`/`readdir` + 정규식 필터로 파일을 고르는 검증기는 새로 추가된 자유 형식 증적 파일(케이스마다 다른 이름의 `.txt`/`.json`)을 놓치기 쉽다. 의심되면 `grep -rl "$HOME" <evidence-dir>`로 직접 원문 잔존을 재확인해 검증기 결과와 교차 검증한다(단, T-2류 명시적 예외 필드가 있는 스키마에서는 grep 자체가 false positive를 낼 수 있으므로 예외 목록을 먼저 확인). 관련: [[project-e2e-run-20260821]].
