---
name: ccp-orchestrator
description: "CCP(Claude Control Plane) 플러그인 개발 8단계 하네스 오케스트레이터 — 자연어 접수→기획→검수→휴먼 승인(G1)→개발→QA→휴먼 승인(G2)→위키화 파이프라인으로 에이전트 팀을 조율. CCP 플러그인 개발·기획·검수·구현·QA·위키화, 라우터 작업, Antigravity/Codex 통합, codex-plugin-cc 미러링, 결과 수정·부분 재실행·업데이트·보완·다시 실행·이전 결과 개선·기획 다시·검수 다시·구현 다시·QA 다시·위키화 다시·하네스 재실행 요청 시 반드시 이 스킬을 사용. 승인 게이트 응답('승인', '개발 진행해', '위키화 진행해', '거부, 이 부분 수정')도 이 스킬로 처리."
---

# CCP Orchestrator — Claude Control Plane 개발 하네스

Claude Control Plane(CCP) 플러그인 개발을 8단계 파이프라인으로 조율한다:

```
자연어 접수 → 기획 → 검수 → 휴먼 승인(G1) → 개발 → QA → 휴먼 승인(G2) → 위키화
```

핵심 설계 원칙:
- **휴먼 승인 게이트 2개** — 개발 진입 전(G1)과 위키화 진입 전(G2)에 사용자 승인 없이는 절대 다음 단계로 진행하지 않는다. 승인 기록은 파일로 보존한다 (감사 추적).
- **위키화가 종착지** — 승인된 런의 산출물·결정·트러블슈팅은 claude-obsidian wiki vault에 지식그래프로 적재되어야 런이 완결된다.
- **incremental QA 유지** — QA는 별도 단계이지만, 개발 단계 안에서도 모듈 완성 즉시 검증한다 (전체 완성 후 1회 QA 금지).

## 실행 모드: 하이브리드 서브 에이전트

팀 옵트인(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) 미활성 전제로 서브 에이전트 패턴으로 실행한다. 에이전트 간 통신은 **파일 기반 인계 + 오케스트레이터 중재 + 재개(SendMessage)** 로 대체한다.

| 단계 | 실행 모드 | 참여자 (model) |
|------|----------|---------------|
| S1 자연어 접수 | 오케스트레이터 인라인 | — |
| S2 기획 | 서브 직렬 → 병렬 | spec-writer(opus) → scope-guard(haiku) ∥ ux-designer(sonnet) |
| S3 검수 | 서브 병렬 | architecture-reviewer(opus) ∥ token-economist(opus) ∥ license-auditor(opus) |
| S4 휴먼 승인 G1 | 오케스트레이터 인라인 (`AskUserQuestion`) | — |
| S5 개발 | 서브 직렬 + 재개 사이클 | plugin-scaffolder(sonnet) → adapter-engineer(sonnet) ⇄ harness-qa(sonnet, incremental) |
| S6 QA | 서브 단독 (재개) | harness-qa(sonnet, 전체 스위트) |
| S7 휴먼 승인 G2 | 오케스트레이터 인라인 (`AskUserQuestion`) | — |
| S8 위키화 | 서브 병렬 | claude-obsidian:wiki-ingest (N개 소스) |

모든 Agent 호출 prompt에는 브리핑 5요소를 포함한다: ① 목표(결과 정의) ② 이미 시도/룰아웃된 것 ③ 파일/라인 좌표 ④ 산출물 형식 ⑤ 보고 길이 한도. 에이전트 보고는 의도이지 결과가 아니므로, 핵심 산출물은 오케스트레이터가 직접 열어 검증한다.

## 산출물 번호 체계 (`_workspace/`)

| 접두 | 단계 | 대표 파일 |
|------|------|----------|
| `00_intake/` | S1 자연어 접수 | `intake_brief.md` |
| `01_` | S2 기획 | `01_prd.md`, `01_command_spec.md`, `01_subagent_spec.md`, `01_backlog.md`, `01_scope_decisions.md`, `01_user_scenarios.md` |
| `02_` | S3 검수 | `02_arch_review.md`, `02_token_scenarios.md`, `02_regression_cases.md`, `02_license_audit.md` |
| `03_` | S4 게이트 1 | `03_gate1_approval.md` |
| `04_` | S5 개발 | `04_scaffold_progress.md`, `04_implementation_progress.md` |
| `05_` | S6 QA | `05_qa_report.md`, `05_token_measurement.md`, `05_router_accuracy.md`, `05_verdict.md` |
| `06_` | S7 게이트 2 | `06_gate2_approval.md` |
| `07_` | S8 위키화 | `07_wiki_run_summary.md` |

## 워크플로우

### Stage 0: 컨텍스트 확인 (실행 유형 판별)

기존 산출물과 게이트 상태를 확인하여 진입 지점을 결정한다:

1. `_workspace/` 산출물 존재 여부와 `03_gate1_approval.md` / `06_gate2_approval.md` 상태(pending/approved/rejected)를 확인
2. 진입 지점 결정:
   - **산출물 미존재** → 초기 실행. S1부터 진행
   - **게이트 pending + 사용자가 승인/거부 의사 표현** (예: "승인, 개발 진행해") → 해당 게이트(S4 또는 S7)부터 재개
   - **부분 수정 요청** (예: "PRD 다시", "라우터만 재구현", "QA만 다시") → 해당 단계만 재실행. 하위 산출물은 보존하되, 수정이 승인 이후 단계에 영향을 주면 해당 게이트를 다시 통과해야 한다 (예: 기획 수정 → G1 재승인 필요)
   - **새 입력 제공** → 새 실행. 기존 `_workspace/` 산출물을 `_workspace_archive_{YYYYMMDD_HHMMSS}/`로 이동 후 S1 진행
3. 부분 재실행 시: 이전 산출물 경로를 에이전트 prompt에 포함하여 기존 결과를 읽고 피드백을 반영하도록 지시

### Stage 1: 자연어 접수 (Intake) — 오케스트레이터 인라인

사용자의 자연어 요청을 구조화된 기획 입력으로 변환한다. 별도 에이전트를 쓰지 않는다.

1. 요청에서 추출: **작업 유형**(신규 기능/버그 수정/리팩터/문서), **대상 범위**(플러그인 모듈·파일), **성공 기준**(검증 가능한 형태로 변환), **제약**(공수·호환성·라이선스)
2. 판단에 사용한 **가정을 명시** — 해석이 갈리는 요청은 가정을 기록하고, 치명적 분기(구현 방향이 완전히 달라지는 경우)만 사용자에게 즉시 질문
3. `_workspace/00_intake/intake_brief.md` 작성 — 요청 원문, 구조화 결과, 가정 목록, 참고 자료 포인터(`_workspace/00_input/`, wiki vault)
4. 기존 지식 필요 시 wiki vault를 참조 (CLAUDE.local.md의 읽기 순서: `wiki/hot.md` → `wiki/index.md` → 개별 페이지)

### Stage 2: 기획 (Planning) — 서브 직렬 → 병렬

**1) spec-writer (opus) 직렬 호출:**
- 목표: `00_intake/intake_brief.md` 기반 PRD·슬래시 명세·서브에이전트 명세·스키마 작성 (prd-template·slash-command-template·subagent-template 스킬 사용)
- 산출물: `01_prd.md`, `01_command_spec.md`, `01_subagent_spec.md`, `01_schema.md`
- 범위 판단이 필요한 항목은 자체 결정하지 말고 `## 범위 판정 요청` 섹션에 나열하도록 지시

**2) scope-guard (haiku) ∥ ux-designer (sonnet) 병렬 호출** (`run_in_background: true` × 2, 단일 메시지):
- scope-guard: `01_*.md` 전체의 범위 적합성 판정 → `01_backlog.md`, `01_scope_decisions.md`
- ux-designer: 슬래시 UX·사용자 시나리오·에러 메시지·README 구조 → `01_user_scenarios.md`, `01_onboarding.md`, `01_error_messages.md`, `01_readme_outline.md`

**3) 범위 위반 반영:** scope-guard가 명세 본문에 남은 범위 초과 항목을 지목하면, spec-writer를 재개(SendMessage)하여 백로그 이관 반영 (1회).

**종료 조건:** `01_*.md` 산출물 전부 존재 + 모든 산출물에 `## 미결 사항` 섹션 명시.

### Stage 3: 검수 (Review) — 서브 병렬

3개 검수자를 병렬 호출 (`run_in_background: true` × 3, 단일 메시지):

- **architecture-reviewer (opus)**: `01_*.md` 전체에 arch-checklist 스킬 A1~A8 적용 → `02_arch_review.md`, `02_arch_decisions.md`. 수정 요청은 `02_arch_review.md`의 `## 수정 요청` 섹션에 기록 (G1에서 사용자에게 제시)
- **token-economist (opus)**: token-scenario-design + token-budget-check 스킬로 측정 시나리오·회귀 케이스·라우터 정확도 데이터셋 → `02_token_scenarios.md`, `02_regression_cases.md`, `02_router_accuracy_spec.md`
- **license-auditor (opus)**: license-checklist 스킬 L1~L9 적용 + 비밀 정보 누출 검사 → `02_license_audit.md`, `02_dependency_manifest.md`, `02_attribution_template.md`

**종료 조건:** 검수 산출물 전부 존재. **중대 결함(BLOCKER) 발견 시** S2로 복귀하여 수정 라운드 후 재검수 — 단, 복귀 여부가 모호하면 G1에서 사용자가 판단하도록 결함을 게이트 요약에 포함한다.

### Stage 4: 휴먼 승인 G1 (개발 진입 게이트)

**사용자 승인 없이 개발을 시작하지 않는다.** 자율 모드라도 이 게이트는 건너뛸 수 없다 — 파이프라인이 명시적으로 요구하는 사용자 결정 지점이다.

1. 게이트 요약 작성: 기획 핵심(범위·합격 기준), 검수 결과(BLOCKER/수정 요청/미결 사항), 예상 공수
2. `AskUserQuestion`으로 제시 — 선택지: **승인(개발 진행)** / **수정 후 재검수**(피드백 반영하여 S2 또는 S3 부분 재실행) / **중단**
3. 결과를 `_workspace/03_gate1_approval.md`에 기록: 상태(approved/rejected/pending), 일시, 사용자 피드백 원문, 조건부 승인 시 조건
4. 거부 시: 피드백을 해당 에이전트 재개 호출에 전달 → 수정 → 재검수 → G1 재제시
5. 세션이 게이트에서 끊기면 상태는 pending으로 남는다 — 다음 세션에서 Stage 0이 감지하여 게이트부터 재개

### Stage 5: 개발 (Development) — 서브 직렬 + incremental QA 사이클

**1) plugin-scaffolder (sonnet) 직렬 호출:**
- 목표: `01_*`·`02_*` 기반 매니페스트·슬래시·서브에이전트 정의·README/LICENSE 골격 (plugin-manifest-spec 스킬 사용)
- 진행 보고: `04_scaffold_progress.md`

**2) harness-qa (sonnet) 스폰 — 스캐폴드 즉시 검증:**
- 스캐폴드 구조·매니페스트 스키마 검증. 이 에이전트는 이후 incremental 사이클과 S6 전체 QA까지 **재개(SendMessage)로 컨텍스트를 유지**한다

**3) adapter-engineer (sonnet) 모듈 단위 직렬 사이클:**
- 구현 작업을 모듈 2~4개 묶음으로 분해 (예: companion 스크립트 / 라우터 / 훅·가드레일)
- 각 묶음: adapter-engineer 호출(첫 회) 또는 재개(이후) → 완료 시 harness-qa 재개로 즉시 검증(incremental-qa 스킬 M1~M5) → 결함 발견 시 adapter-engineer 재개로 수정 → 재검증 후 다음 묶음
- 진행 보고: `04_implementation_progress.md`

**종료 조건:** 명세된 코드 산출물 전부 존재 + incremental 검증에서 미해결 결함 0건.

### Stage 6: QA — harness-qa 전체 스위트 (재개)

개발 단계에서 유지해 온 harness-qa를 재개하여 통합 스위트를 실행한다:

1. `02_token_scenarios.md`의 측정 시나리오 전체 실행 → `05_token_measurement.md`
2. `02_regression_cases.md`의 회귀 케이스 + 기존 회귀 baseline (`tests/router/` 하니스, harness-audit 점수) 실행 → `05_qa_report.md`, `05_router_accuracy.md`
3. 경계면 교차 비교 — 명세(`01_*`, `02_*`) ↔ 구현(`plugins/ccp/`) 시그니처·스키마·권한 대조
4. 합격/불합격 판정 → `05_verdict.md` (판정 근거·수치 포함)

**불합격 시:** adapter-engineer 재개로 수정 1루프 → 재QA. 재불합격이면 불합격 verdict 그대로 G2에 상정한다 (허위 합격 금지 — 판정 조작 대신 사용자 판단으로).

### Stage 7: 휴먼 승인 G2 (위키화 진입 게이트)

1. 게이트 요약 작성: QA verdict(수치 포함), 발견·해결된 결함, 잔존 리스크, 위키화 대상 산출물 목록
2. `AskUserQuestion`으로 제시 — 선택지: **승인(위키화 진행)** / **수정 후 재QA**(S5/S6 복귀) / **위키화 없이 종료**(런 보류)
3. 결과를 `_workspace/06_gate2_approval.md`에 기록 (형식은 G1과 동일)
4. QA 불합격 상태로 승인을 요청하는 경우, 불합격 사실을 요약 첫 줄에 명시한다

### Stage 8: 위키화 (Wiki-ization) — claude-obsidian ingest

승인된 런의 지식을 wiki vault에 적재한다. vault 경로는 `CLAUDE.local.md`의 Wiki Knowledge Base 절이 SSOT다.

1. **런 요약 작성** — `_workspace/07_wiki_run_summary.md`: 요청 원문 요약, 주요 결정과 근거, 트러블슈팅 로직, 산출물 인덱스, QA 수치, 게이트 기록(G1/G2 일시·피드백)
2. **소스 준비** — 런 요약 + 위키화 가치가 있는 SSOT 산출물(결정 문서·QA verdict 등)을 vault `.raw/`에 복사. 파일명에 날짜·런 식별 접두를 부여 (예: `R-{YYYYMMDD}-{주제}-*.md`)
3. **ingest 실행** — `claude-obsidian:wiki-ingest` 에이전트를 소스당 1개 병렬 디스패치 (소스 3개 이하면 단일 에이전트로 일괄 처리). 각 에이전트는 entity/concept 추출·wiki 페이지 생성·인덱스 갱신 후 생성/갱신 페이지 목록을 보고
4. **검증** — 오케스트레이터가 `wiki/index.md`(또는 `wiki/hot.md`) 갱신 여부를 직접 확인. 보고만 믿지 않는다
5. **하네스 이력 갱신** — `.claude/HARNESS_CHANGELOG.md`에 런 결과 1행 추가

**위키화 실패 시(vault 접근 불가 등):** `07_wiki_run_summary.md`를 로컬에 보존하고, 사용자에게 수동 ingest 절차("`.raw/`에 파일을 넣고 'ingest [파일명]'")를 안내한다. 런 자체는 완결로 처리하되 위키화 미완을 보고에 명시.

### 종료: 사용자 보고

1. 파이프라인 전체 결과 요약: QA verdict, 게이트 기록, 생성/갱신된 wiki 페이지, 백로그 변동
2. `_workspace/` 보존 (감사·후속 작업용)
3. 개선 피드백 기회 제공 (강요하지 않음)

## 데이터 흐름

```
사용자 자연어 요청
      ↓ (S1 인라인)
_workspace/00_intake/intake_brief.md
      ↓ (S2: spec-writer → scope-guard ∥ ux-designer)
_workspace/01_*.md
      ↓ (S3: 검수 3종 병렬)
_workspace/02_*.md
      ↓ (S4: AskUserQuestion) → 03_gate1_approval.md [approved]
      ↓ (S5: scaffolder → adapter ⇄ harness-qa incremental)
plugins/ccp/* + _workspace/04_*.md
      ↓ (S6: harness-qa 전체 스위트, 재개)
_workspace/05_*.md (verdict 포함)
      ↓ (S7: AskUserQuestion) → 06_gate2_approval.md [approved]
      ↓ (S8: 런 요약 → vault .raw/ → wiki-ingest 병렬)
wiki vault 페이지 + 07_wiki_run_summary.md + HARNESS_CHANGELOG 1행
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 서브 에이전트 1회 실패 | 1회 재시도. 재실패 시 해당 산출물 없이 진행하되 게이트 요약에 누락 명시 (사용자가 게이트에서 판단) |
| S3 검수 BLOCKER 발견 | S2 복귀 수정 라운드. 복귀/강행이 모호하면 G1에 결함 포함 상정 |
| G1/G2 거부 | 피드백을 해당 에이전트 재개 호출에 전달 → 수정 → 재검증 → 게이트 재제시. 거부 사유는 게이트 파일에 누적 기록 |
| 게이트에서 세션 중단 | 게이트 파일 pending 보존 → 다음 세션 Stage 0이 감지하여 게이트부터 재개 |
| S6 QA 불합격 | 수정 1루프 → 재QA → 재불합격 시 불합격 그대로 G2 상정 (허위 합격 금지) |
| 산출물 간 불일치 (명세↔구현) | 검수 산출물 우선 적용, 차이를 `04_implementation_progress.md`의 `## drift` 섹션에 기록 |
| 위키화 실패 | 런 요약 로컬 보존 + 수동 ingest 안내. 위키화 미완을 최종 보고에 명시 |
| 상충 데이터 | 삭제하지 않고 출처 병기 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: "라우터에 X 키워드 지원 추가해줘" (자연어)
2. S0: 산출물 확인 → 초기 실행 / S1: intake_brief 작성 (가정 명시)
3. S2~S3: 기획 4건 + 검수 3건 병렬 산출
4. S4: G1 요약 제시 → 사용자 승인 → `03_gate1_approval.md` [approved]
5. S5: 스캐폴드 → 모듈 2묶음 구현, 각 묶음 incremental QA 통과
6. S6: 전체 스위트 합격 → `05_verdict.md` [합격]
7. S7: G2 승인 → S8: 런 요약 ingest → wiki 페이지 2건 생성 확인 → 최종 보고

### 에러 흐름 (G1 거부)
1. S4에서 사용자가 "수정 후 재검수" 선택 + "범위가 너무 넓다" 피드백
2. `03_gate1_approval.md` [rejected + 사유] 기록
3. scope-guard 재개 → 범위 축소 판정 → spec-writer 재개 → 명세 수정
4. architecture-reviewer만 부분 재검수 → G1 재제시 → 승인 → 이후 정상 진행

### 게이트 재개 흐름 (세션 분리)
1. 이전 세션이 S4 게이트 제시 후 종료 (`03_gate1_approval.md` [pending])
2. 새 세션에서 사용자: "승인할게, 개발 진행해"
3. S0: pending 게이트 감지 → 승인 기록 갱신 → S5부터 진행

### 부분 재실행 흐름 (QA만 다시)
1. 사용자: "QA만 다시 돌려줘"
2. S0: `05_*` 존재 확인 → S6만 재실행 (harness-qa 신규 스폰, `02_*` 시나리오 + 구현 좌표 전달)
3. verdict 갱신 → G2 재제시
