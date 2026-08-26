---
name: incremental-qa
description: "CCP 모듈 단위 즉시 검증 절차. 전체 완성 후 1회 QA가 아니라 모듈 완성 즉시 검증. 경계면 교차 비교 (명세 ↔ 구현) 중심. QA·검증·테스트 작업 시 반드시 이 스킬을 사용."
user-invocable: false
---

# Incremental QA — 모듈 단위 즉시 검증 절차

CCP의 QA는 전체 완성 후 1회가 아니라 **모듈이 완성될 때마다 즉시 실행**한다. 이유는 qa-agent-guide의 핵심 원칙: 후반에 발견된 결함일수록 수정 비용이 커진다.

## 검증 사이클

```
adapter-engineer가 모듈 묶음 완성 → 종료 (진행 보고 기록)
   ↓ 오케스트레이터가 harness-qa 를 신규 스폰 (이전 검증 이력은 memory + 05_qa_report.md 로 인계)
harness-qa가 즉시 검증 시작
   ↓
모듈별 체크리스트 실행 (5분 초과 가능 명령은 run_in_background)
   ↓
결과를 _workspace/05_qa_report.md 에 누적 기록 + 요약 반환 → 종료
   ↓
회귀 발견 시 오케스트레이터가 adapter-engineer 를 결함 좌표와 함께 재호출하여 수정 중재 (다음 묶음 진입 차단)
```

> 각 호출은 완주형이다. 검증을 마치면 종료하고, 다음 묶음은 새 호출로 받는다. 서브 에이전트를 살려 둔 채 다음 모듈 완성을 기다리면 5분 캐시 TTL 을 넘겨 컨텍스트가 통째로 재작성된다. 그래서 검증 결과를 반환값에만 담지 않고 반드시 파일에 남긴다 — 다음 호출이 읽을 근거는 파일과 `memory` 뿐이다.

## 모듈별 체크리스트

### M1. plugin-scaffolder 완료 시
- [ ] `marketplace.json` JSON 유효
- [ ] `plugin.json` 필수 필드 모두 존재
- [ ] `commands/*.md`, `agents/*.md`, `hooks/*` 모두 매니페스트에 등록됨
- [ ] `.gitignore`에 비밀 정보 패턴 포함

### M2. antigravity-companion.mjs 완료 시
- [ ] foreground 모드: `node antigravity-companion.mjs task -- "test"` 실행 → JSON envelope 반환
- [ ] background 모드: `--background` 플래그 → job_id 반환, `.ccp/jobs/<id>.json` 생성 확인
- [ ] 인증 사전 검증: `agy` 미인증(keyring 미설정) 환경에서 호출 → `E_OAUTH_EXPIRED` envelope
- [ ] 출력 길이 가드: 큰 응답 강제 → 잘림 동작 확인
- [ ] JSON envelope 스키마 일치 (companion-script-pattern 참조)

### M3. router 완료 시
- [ ] 정답 라벨 데이터셋 (`_workspace/02_router_accuracy_spec.md`) 실행
- [ ] 정확도 ≥ 80% (미달 시 즉시 차단 신호)
- [ ] Fallback 동작: Antigravity 실패 시뮬레이션 → Claude 복귀 확인
- [ ] 비용 로깅: `_workspace/_logs/router_fallback.jsonl` 생성 확인

### M4. ecc 가드레일 포팅 완료 시
- [ ] `suggest-compact.js`: PreToolUse Edit/Write 50회 시뮬레이션 → stderr 리마인더
- [ ] `context-budget` 스킬: 트리거 키워드로 호출 → 토큰 추정 출력
- [ ] `harness-audit.js`: `/ccp:audit` 호출 → 7카테고리 점수 출력
- [ ] 모든 차용 코드: 원본 MIT 헤더 보존 확인

### M5. 슬래시 커맨드 동작 검증
- [ ] `/antigravity:rescue` 호출 → antigravity-rescue 서브에이전트 스폰
- [ ] `/antigravity:status <id>` → 메타 파일 반환
- [ ] `/antigravity:result <id>` → result.md 반환
- [ ] `/antigravity:setup` → 환경 검증 출력
- [ ] 명세(`01_command_spec.md`)와 실제 동작 100% 일치

## 경계면 교차 비교 (qa-agent-guide 원칙)

QA의 핵심은 "존재 확인"이 아니라 **두 인터페이스를 동시에 읽고 shape 비교**:

| 경계면 | 비교 대상 |
|--------|----------|
| 슬래시 명세 ↔ 실제 슬래시 | `01_command_spec.md` vs `commands/*.md` 동작 결과 |
| companion 출력 ↔ 라우터 입력 | JSON envelope 키 vs 라우터가 읽는 키 |
| 매니페스트 권한 ↔ 실제 도구 호출 | `permissions` 필드 vs 코드의 `Bash` 호출 |
| 에러 코드 표준 ↔ 실제 에러 | `companion-script-pattern` 표준 vs companion이 발생시킨 에러 |
| 시나리오 합격 기준 ↔ 측정 결과 | `02_token_scenarios.md` vs `05_token_measurement.md` |

## 회귀 발견 시 즉시 차단

회귀가 발견되면:
1. 오케스트레이터에게 결함 좌표(파일:라인)와 함께 즉시 보고 — 오케스트레이터가 adapter-engineer/plugin-scaffolder 를 결함 좌표와 함께 재호출하여 수정을 중재
2. `_workspace/05_qa_report.md`에 회귀 ID와 재현 절차 기록
3. 수정 후 재검증 사이클 반복

회귀 발견 시 다음 단계 작업 차단 권한 있음 (오케스트레이터에 보고).

## 토큰 측정 시나리오 실행

`_workspace/02_token_scenarios.md`의 T1~T5를 순서대로 실행:

```
1. baseline 측정 (Claude 단독, 동일 워크로드)
2. CCP 적용 측정 (Claude + 라우터)
3. 비교: B의 input_tokens ≤ A의 input_tokens × 0.85 ?
4. 결과를 _workspace/05_token_measurement.md에 기록
```

## MVP 합격 판정

`_workspace/05_verdict.md`에 다음 형식 (휴먼 승인 게이트 G2 상정 자료):

```markdown
## MVP 합격 판정

| 항목 | 기준 | 측정 | 판정 |
|------|------|------|------|
| 라우터 정확도 | ≥80% | 87% | ✅ |
| T1 토큰 절감 | ≥15% | 42% | ✅ |
| T2 토큰 절감 | ≥15% | 3% | ❌ (미달) |
| ... | | | |
| R1 회귀 | 0건 | 0건 | ✅ |
| R3 회귀 | 0건 | 1건 | ❌ |

## 최종 판정
- ✅ 합격 / ❌ 불합격
- 불합격 사유: T2 미달, R3 회귀 1건 발견
- 권고 조치: ...
```

## Why

전체 완성 후 1회 QA의 함정:
- 어디서 결함이 났는지 분리 어려움 (모듈 의존성 복잡)
- 수정 후 다른 모듈 영향 재검증 필요 (회귀 누적)
- 일정 후반에 결함 발견 → 일정 폭발

incremental QA는 모듈 단위에서 결함을 가둠. 모듈 묶음 완성 즉시 검증이 트리거되는 사이클이 핵심이다.

## 산출물 위치

- QA 리포트: `_workspace/05_qa_report.md`
- 토큰 측정: `_workspace/05_token_measurement.md`
- 라우터 정확도: `_workspace/05_router_accuracy.md`
- 합격 판정: `_workspace/05_verdict.md`
