---
name: project-ccp-subagent-isolation-run
description: CCP "서브에이전트 출구 측 회귀 기준 신설 런" — 전체 QA 완료(2026-08-30), AC-1~AC-12 전건 PASS, 합격
metadata:
  type: project
---

CCP 플러그인 개발 과정에서 "서브에이전트 출구 측 회귀 기준 신설 런" (rescue subagent isolation check, `tests/subagent/`)이 전체 QA(Stage 6)까지 완료됐다.

**진행 이력:**
- 묶음 ① (판정 엔진 + fixture 러너, fixture 세트 제외) — 불통과. `parseTranscriptFile`의 jsonl 본문 `readFileSync`가 try/catch 없이 무방비(HIGH, Q1-1) — 권한 오류 시 `read_error` SKIP 대신 전역 예외로 새어 `--json` 단독 출력 계약과 경로 치환 계약을 동시 위반.
- 묶음 ② (fixture 세트 40건 + `expected.json`) — 통과. 러너 42/42, C0~C3 전건 클린.
- 묶음 ③ (Q1-1 수정 + 파일 분리 946→772줄 엔진 + `lib/render.mjs` 262줄) — 통과. Q1-1 해소 확인, incremental 종료.
- **전체 QA (2026-08-30)** — **합격.** AC-1~AC-12 전건 PASS(12/12), 회귀 0건, 기존 CI 4종(router-eval/router-suggest/golden-diff/contract-test) 완전 일치, C0~C6 전건 PASS, fixture 42건 ↔ `expected.json` 1:1 매핑 확인. 산출물: `_workspace/05_qa_report.md`(## 전체 QA 절)·`05_token_measurement.md`·`05_router_accuracy.md`·`05_verdict.md`.

**Why:** MVP 합격 판정은 회귀 0건을 전제하므로, incremental QA에서 결함을 조기 차단(Q1-1)한 뒤에도 전체 QA에서 재발 여부와 12개 AC 전건을 독립적으로 재검증해야 신뢰할 수 있는 합격 판정이 된다. 이번 런은 "실행 근거와 함께 판정" 원칙을 지켜, 러너 인용에만 의존하지 않고 SKIP/PASS/FAIL fixture 다수를 엔진으로 직접 재실행했다.

**How to apply:** 이 런은 종결됐다. 후속 요청(G2 게이트 이후 위키화 등)이 오면 이 메모와 `05_verdict.md`를 먼저 확인할 것. 잔존 리스크는 O-1(background Bash 횟수 미관측, 문서상 foreground 한정으로 정직하게 스코프 축소됨)과 RC-6(3종 SKIP 사유 fixture 불가) — 둘 다 검수 단계에서 이미 범위 밖으로 확정된 사항이라 합격 판정에 영향 없음. [[feedback-scratch-copy-for-self-relative-tools]] · [[feedback-read-path-symmetry-check]] · [[feedback-json-echo-pipe-corruption]] 참고.
