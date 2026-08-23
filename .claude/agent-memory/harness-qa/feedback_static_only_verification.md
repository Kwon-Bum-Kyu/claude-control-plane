---
name: feedback-static-only-verification
description: E2E 하니스 스캐폴드 검증 시 실환경 변경 스크립트는 절대 실행하지 않되, 스크립트 자체가 non-mutating을 문서화·보증하는 경우는 실행 가능
metadata:
  type: feedback
---

E2E 테스트 하니스(`bin/install.sh`·`bin/teardown.sh`)를 검증할 때 오케스트레이터가 "어떤 스크립트도 실행하지 마라"고 지시하는 경우가 있다. 이는 실환경(사용자의 실제 `~/.claude` 플러그인 레지스트리)을 변경하는 명령(disable/enable, marketplace add/remove, install/uninstall, `rm -rf`)을 포함한 스크립트를 가리킨다.

**구분 기준**: 스크립트 자신의 docstring/헤더 주석이 "이 스크립트는 evidence/를 변경하지 않고 리포트만 한다(this script never mutates ..., it only reports)"고 명시하고 있고, 실제로 파일시스템 쓰기 없이 읽기만 하는 경우(`bin/validate-evidence.mjs`가 그 예)는 정적 검증의 연장으로 실행해도 된다. `bash -n`(구문 검사) / `node --check`도 마찬가지로 안전.

**Why:** 이번 라운드(CCP E2E RUN `e2e-20260821-000412`)에서 install.sh/teardown.sh는 실환경(기존 v0.2.2 disable, 사용자 레지스트리)을 건드리므로 절대 실행 금지였지만, `validate-evidence.mjs`는 읽기 전용이 코드로 보증돼 있어 실행해 재현성(V-1 위반 9건이 스캐폴더 자체 보고와 정확히 일치)을 확인할 수 있었다. 이 구분을 못 하면 과도하게 검증을 축소(전부 읽기만)하거나, 반대로 위험을 무릅쓰고 파괴적 스크립트를 실행하는 실수를 할 수 있다.

**How to apply:** "스크립트 실행 금지" 지시를 받으면 (1) 지시가 가리키는 스크립트가 실환경/실데이터를 변경하는지 먼저 판별하고, (2) 변경하지 않는다고 스스로 문서화하며 실질적으로도 읽기 전용인 보조 스크립트(검증기·린터·구문검사)는 그 근거를 명시한 뒤 실행해 실측 근거를 확보한다. 애매하면 실행하지 않고 코드 추적(정적 분석)으로 대체한다.
