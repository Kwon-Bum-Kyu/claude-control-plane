---
name: ccp-orchestrator
description: "Claude Control Plane 플러그인 개발 하네스 오케스트레이터. 기획→검수→개발 3-Phase 파이프라인으로 에이전트 팀을 조율하여 Antigravity CLI wrapper + 라우터 + ecc 가드레일을 구현. CCP 플러그인 개발, 라우터 작업, 토큰 절감 플러그인, Antigravity 통합, codex-plugin-cc 미러링, 플러그인 기획·검수·개발, 결과 수정·부분 재실행·업데이트·보완·다시 실행·이전 결과 개선·기획 다시·검수 다시·구현 다시·하네스 재실행 요청 시 반드시 이 스킬을 사용."
---

# CCP Orchestrator — Claude Control Plane 개발 하네스

Claude Control Plane(CCP) 공개 플러그인 개발을 3-Phase 파이프라인 (기획 → 검수 → 개발)으로 조율한다. 각 Phase는 별도 에이전트 팀으로 구성되며, Phase 전환 시 팀을 해체하고 다음 팀을 생성한다.

## 실행 모드: 에이전트 팀 (Phase별 재구성)

세션당 1팀 제약 때문에 Phase 전환마다 `TeamDelete` → `TeamCreate`. 산출물은 `_workspace/`에 파일로 인계된다.

## Phase별 팀 구성

| Phase | 팀 이름 | 팀원 | 핵심 산출물 |
|-------|--------|------|-----------|
| **기획** | planning-team | spec-writer, scope-guard, ux-designer | `01_prd.md`, `01_command_spec.md`, `01_subagent_spec.md`, `01_user_scenarios.md`, `01_backlog.md` |
| **검수** | review-team | architecture-reviewer, token-economist, license-auditor | `02_arch_review.md`, `02_token_scenarios.md`, `02_regression_cases.md`, `02_license_audit.md`, `02_dependency_manifest.md` |
| **개발** | dev-team | plugin-scaffolder, adapter-engineer, harness-qa | 실제 플러그인 코드 + `03_qa_report.md`, `03_token_measurement.md`, `03_mvp_verdict.md` |

## 워크플로우

### Phase 0: 컨텍스트 확인

기존 산출물 존재 여부를 확인하여 실행 모드를 결정:

1. `_workspace/` 디렉토리 존재 여부 확인
2. 실행 모드 결정:
   - **`_workspace/` 미존재** → 초기 실행. Phase 1로 진행
   - **`_workspace/` 존재 + 부분 수정 요청** (예: "PRD 다시", "라우터만 재구현") → 부분 재실행. 해당 Phase의 팀만 구성하고, 다른 Phase 산출물은 보존
   - **`_workspace/` 존재 + 새 입력 제공** → 새 실행. 기존 `_workspace/`를 `_workspace_archive_{YYYYMMDD_HHMMSS}/`로 이동한 뒤 Phase 1 진행
3. 부분 재실행 시: 이전 산출물 경로를 에이전트 프롬프트에 포함하여, 에이전트가 기존 결과를 읽고 피드백을 반영하도록 지시

### Phase 1: 기획 (Planning)

**팀 구성:**

```
TeamCreate(
  team_name: "planning-team",
  members: [
    {
      name: "spec-writer",
      agent_type: "spec-writer",
      model: "opus",
      prompt: "당신은 spec-writer입니다. _workspace/00_input/project_brief.md와 보고서/token-reduction-self-dev-reference.md §2~3을 읽고, prd-template + slash-command-template + subagent-template 스킬을 사용하여 PRD·슬래시 명세·서브에이전트 명세를 작성하세요. 모든 신규 기능은 scope-guard에게 SendMessage로 범위 판정을 요청하세요. ux-designer와 슬래시 UX를 협의하세요."
    },
    {
      name: "scope-guard",
      agent_type: "scope-guard",
      model: "opus",
      prompt: "당신은 scope-guard입니다. MVP 4개 핵심 항목 (Antigravity CLI wrapper, 라우터, ecc 가드레일, 토큰 실측) 외 모든 항목을 _workspace/01_backlog.md에 분리 기록하세요. spec-writer/ux-designer의 SendMessage로 들어온 신규 기능 후보를 즉시 판정하고 회신하세요."
    },
    {
      name: "ux-designer",
      agent_type: "ux-designer",
      model: "opus",
      prompt: "당신은 ux-designer입니다. spec-writer의 슬래시 명세 초안을 검토하고 사용자 시나리오·온보딩 흐름·에러 메시지·README 구조를 작성하세요. 산출물: _workspace/01_user_scenarios.md, 01_onboarding.md, 01_error_messages.md, 01_readme_outline.md. 한국어 우선."
    }
  ]
)
```

**작업 등록:**

```
TaskCreate(tasks: [
  { title: "PRD 작성", description: "prd-template 스킬 사용", assignee: "spec-writer" },
  { title: "슬래시 커맨드 명세", description: "/antigravity:rescue, status, result, setup, /ccp:audit", assignee: "spec-writer" },
  { title: "서브에이전트 명세", description: "antigravity-rescue 정의", assignee: "spec-writer" },
  { title: "MVP 범위 판정", description: "모든 기능 후보 분류", assignee: "scope-guard" },
  { title: "백로그 작성", description: "Phase 6+ 항목 (Codex, Ralph, 한국어 키워드)", assignee: "scope-guard" },
  { title: "사용자 시나리오 작성", description: "신규/숙련/실패 복구 3개", assignee: "ux-designer" },
  { title: "에러 메시지 카탈로그", description: "보고서 §5 R1~R6 매핑", assignee: "ux-designer" },
  { title: "README 구조 설계", description: "한국어 우선, 영어 부록", assignee: "ux-designer" }
])
```

**Phase 1 종료 조건:**
- `_workspace/01_*.md` 모든 산출물 존재
- 백로그에 최소 3개 항목 (Codex, Ralph, 한국어 키워드 포함) 기록됨
- 미결 사항(`## 미결 사항` 섹션)이 모든 산출물에 명시됨

**팀 정리:**
```
TeamDelete(team_name: "planning-team")
```

### Phase 2: 검수 (Review)

**팀 구성:**

```
TeamCreate(
  team_name: "review-team",
  members: [
    {
      name: "architecture-reviewer",
      agent_type: "architecture-reviewer",
      model: "opus",
      prompt: "당신은 architecture-reviewer입니다. _workspace/01_*.md를 모두 읽고, arch-checklist 스킬의 A1~A8을 적용하여 _workspace/02_arch_review.md를 작성하세요. 수정 요청 사항은 spec-writer에게 SendMessage로 통보하세요 (단, 기획 팀은 이미 정리됐으므로 SendMessage 대신 02_arch_review.md에 명시)."
    },
    {
      name: "token-economist",
      agent_type: "token-economist",
      model: "opus",
      prompt: "당신은 token-economist입니다. _workspace/01_*.md와 보고서 §3.3, §5를 읽고, token-scenario-design + token-budget-check 스킬을 사용하여 측정 시나리오 5~7개·회귀 케이스·라우터 정확도 데이터셋을 작성하세요. 산출물: _workspace/02_token_scenarios.md, 02_regression_cases.md, 02_router_accuracy_spec.md."
    },
    {
      name: "license-auditor",
      agent_type: "license-auditor",
      model: "opus",
      prompt: "당신은 license-auditor입니다. _workspace/01_*.md를 읽고 license-checklist 스킬의 L1~L9을 적용하여 _workspace/02_license_audit.md, 02_dependency_manifest.md, 02_attribution_template.md를 작성하세요. 비밀 정보 누출 검사를 포함하세요."
    }
  ]
)
```

**작업 등록:**

```
TaskCreate(tasks: [
  { title: "아키텍처 체크리스트 A1~A8 적용", assignee: "architecture-reviewer" },
  { title: "토큰 측정 시나리오 T1~T5 설계", assignee: "token-economist" },
  { title: "회귀 케이스 R1~R6 매핑", assignee: "token-economist" },
  { title: "라우터 정확도 데이터셋 (N≥30)", assignee: "token-economist" },
  { title: "라이선스 감사 L1~L9", assignee: "license-auditor" },
  { title: "의존성 매니페스트", assignee: "license-auditor" },
  { title: "비밀 정보 누출 검사", assignee: "license-auditor" }
])
```

**Phase 2 종료 조건:**
- 모든 검수 산출물 존재
- 아키텍처 수정 요청이 있다면 `_workspace/02_arch_review.md`에 spec-writer가 다음 라운드에 반영할 수 있도록 명시
- 라우터 정확도 데이터셋 ≥ 30 케이스
- 측정 시나리오 ≥ 5개 + 회귀 케이스 ≥ 4개

**팀 정리:**
```
TeamDelete(team_name: "review-team")
```

> **검수에서 중대한 결함 발견 시:** 사용자에게 보고 후 Phase 1로 복귀 (planning-team 재구성하여 수정).

### Phase 3: 개발 (Development)

**팀 구성:**

```
TeamCreate(
  team_name: "dev-team",
  members: [
    {
      name: "plugin-scaffolder",
      agent_type: "plugin-scaffolder",
      model: "opus",
      prompt: "당신은 plugin-scaffolder입니다. _workspace/01_*.md, 02_*.md를 모두 읽고, plugin-manifest-spec 스킬을 사용하여 plugins/ccp/ 디렉토리에 매니페스트·슬래시·서브에이전트·README·LICENSE를 작성하세요. license-auditor의 attribution 템플릿을 README에 포함하세요. 매 산출물 완료 시 harness-qa에게 SendMessage."
    },
    {
      name: "adapter-engineer",
      agent_type: "adapter-engineer",
      model: "opus",
      prompt: "당신은 adapter-engineer입니다. companion-script-pattern + router-implementation 스킬을 사용하여 antigravity-companion.mjs, router.mjs, suggest-compact.js, context-budget 스킬, harness-audit.js를 구현하세요. 모듈 단위 완성 즉시 harness-qa에게 SendMessage (incremental QA)."
    },
    {
      name: "harness-qa",
      agent_type: "harness-qa",
      model: "opus",
      prompt: "당신은 harness-qa입니다. incremental-qa 스킬의 M1~M5 체크리스트를 모듈 완성 즉시 적용하세요. _workspace/02_token_scenarios.md의 T1~T5와 02_regression_cases.md를 실행하여 03_qa_report.md, 03_token_measurement.md, 03_router_accuracy.md, 03_mvp_verdict.md를 작성하세요. 회귀 발견 시 즉시 SendMessage로 차단 신호."
    }
  ]
)
```

**작업 등록:**

```
TaskCreate(tasks: [
  { title: "플러그인 스캐폴드 (manifest, dirs)", assignee: "plugin-scaffolder" },
  { title: "슬래시 커맨드 파일 작성", assignee: "plugin-scaffolder" },
  { title: "antigravity-rescue 서브에이전트 정의", assignee: "plugin-scaffolder" },
  { title: "README + LICENSE", assignee: "plugin-scaffolder" },
  { title: "antigravity-companion.mjs 구현", assignee: "adapter-engineer" },
  { title: "router 구현", assignee: "adapter-engineer" },
  { title: "suggest-compact.js 포팅", assignee: "adapter-engineer" },
  { title: "context-budget 스킬 포팅", assignee: "adapter-engineer" },
  { title: "harness-audit.js 포팅", assignee: "adapter-engineer" },
  { title: "M1~M5 incremental QA", assignee: "harness-qa" },
  { title: "T1~T5 토큰 시나리오 실행", assignee: "harness-qa" },
  { title: "MVP 합격 판정", assignee: "harness-qa", depends_on: ["T1~T5 토큰 시나리오 실행"] }
])
```

**팀원 통신 규칙:**
- adapter-engineer가 모듈 완성 → SendMessage("module X completed") → harness-qa가 즉시 검증 시작
- harness-qa가 회귀 발견 → SendMessage로 즉시 차단 → adapter-engineer 수정 → 재검증
- plugin-scaffolder는 매니페스트 권한 필드 결정 시 adapter-engineer와 협의

**Phase 3 종료 조건:**
- `plugins/ccp/` 디렉토리에 모든 파일 존재 (스캐폴드 + 구현)
- `_workspace/03_mvp_verdict.md`에 합격/불합격 명시
- 합격: 라우터 정확도 ≥80%, T1~T5 중 4개 이상 합격, R1~R6 회귀 0건
- 불합격: 사용자에게 보고 후 다음 라운드 권고 (Phase 1 또는 2 복귀)

**팀 정리:**
```
TeamDelete(team_name: "dev-team")
```

### Phase 4: 사용자 보고 및 정리

1. `_workspace/03_mvp_verdict.md` 읽고 합격/불합격 요약
2. 사용자에게 다음 정보 보고:
   - MVP 합격 여부
   - 측정 결과 요약 (라우터 정확도, T1~T5 절감률)
   - 발견된 회귀 (있다면)
   - Phase 6+ 백로그 (`_workspace/01_backlog.md`)
   - 다음 권고 액션
3. `_workspace/` 보존 (감사·후속 작업용)
4. CLAUDE.md 변경 이력에 실행 결과 기록

## 데이터 흐름

```
_workspace/00_input/project_brief.md
        ↓
[planning-team] → _workspace/01_*.md
        ↓ (TeamDelete → TeamCreate)
[review-team] → _workspace/02_*.md
        ↓ (TeamDelete → TeamCreate)
[dev-team] → plugins/ccp/* + _workspace/03_*.md
        ↓
[오케스트레이터] → 사용자 보고
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| Phase 1 팀원 1명 실패 | 1회 재시작. 재실패 시 다른 팀원이 작업 흡수 (예: spec-writer 실패 시 ux-designer가 PRD 초안 작성) |
| Phase 2에서 중대한 아키텍처 결함 발견 | 사용자에게 보고 후 Phase 1로 복귀, 수정 라운드 |
| Phase 3에서 라우터 정확도 80% 미달 | scope-guard에게 통보 (단, scope-guard는 이미 정리됐으므로 `_workspace/01_backlog.md`에 직접 기록), 스코프 축소 검토 |
| 팀원 과반 실패 | 사용자에게 즉시 알리고 진행 여부 확인 |
| Phase 간 산출물 불일치 (예: PRD와 매니페스트가 다른 슬래시 명) | 개발 팀의 plugin-scaffolder가 검수 산출물 우선 적용, 차이를 `_workspace/03_drift_report.md`에 기록 |
| 타임아웃 | 현재까지 수집된 부분 결과로 진행, 미완료 항목 보고서에 명시 |

## 테스트 시나리오

### 정상 흐름

1. 사용자가 "CCP 하네스 실행"이라고 요청
2. Phase 0: `_workspace/`에 `00_input/project_brief.md` 확인 → 초기 실행
3. Phase 1: planning-team 구성, 8개 작업 분배, 30분 내 `01_*.md` 5개 생성, TeamDelete
4. Phase 2: review-team 구성, 7개 작업 분배, `02_*.md` 5개 생성, TeamDelete
5. Phase 3: dev-team 구성, 12개 작업, incremental QA 사이클로 `plugins/ccp/*` 코드 + `03_*.md` 4개 생성
6. Phase 4: MVP 합격 보고, 백로그 안내, CLAUDE.md 이력 갱신
7. 예상 결과: 합격 시 즉시 사용 가능한 CCP 플러그인 + 측정 결과 + Phase 6+ 백로그

### 에러 흐름 (라우터 정확도 미달)

1. Phase 1, 2 정상 완료
2. Phase 3에서 harness-qa가 라우터 정확도 75% 측정 → 80% 미달
3. SendMessage로 adapter-engineer에게 차단 통보
4. adapter-engineer가 키워드 사전 보강 → 재구현
5. 재측정 → 여전히 78% (개선됨, 미달)
6. `_workspace/03_mvp_verdict.md`에 불합격 명시
7. 오케스트레이터가 사용자에게 보고: "라우터 정확도 미달, 스코프 축소 권고 — Antigravity는 수동 슬래시만 지원, 자동 라우팅 제거"
8. 사용자 결정 대기

### 부분 재실행 흐름

1. 사용자가 "라우터 다시 구현해줘"
2. Phase 0: `_workspace/01_*`, `02_*` 존재 확인 → 부분 재실행
3. Phase 3만 실행 (planning, review 산출물 그대로 사용)
4. dev-team 구성하되 plugin-scaffolder는 작업 없음, adapter-engineer에 router 작업만, harness-qa는 router 검증만
5. 결과 갱신
