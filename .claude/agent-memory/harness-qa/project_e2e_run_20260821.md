---
name: project-e2e-run-20260821
description: CCP v0.3.0 실환경 E2E 테스트 런(RUN_ID e2e-20260821-000412) 진행 상태 — 방안 B, 스캐폴드 검증 완료
metadata:
  type: project
---

CCP v0.3.0 실환경 E2E 테스트 런이 진행 중이다. `RUN_ID=e2e-20260821-000412`, `E2E_ROOT=$HOME/ccp-e2e/e2e-20260821-000412`, `SAFE_DIR=$DEV_REPO/_workspace/05_e2e_evidence/e2e-20260821-000412`.

- **격리 방안**: 방안 A(`CLAUDE_CONFIG_DIR` 격리)가 P-0에서 FAIL(headless 인증 미승계, `.claude.json`에 `oauthAccount` 키 부재) → 사용자가 방안 B(기존 v0.2.2 일시 disable + 프로젝트 스코프 설치)로 전환 승인(`03_gate1_approval.md` "추가 결정").
- **P-2 분기 확정**: codex_arm=run, antigravity_arm=run → SD-C1″ 배타 규칙에 따라 **T-7(스트레스) 미실행 확정**(46회/$5 상한 유지 목적).
- **예산 원장**: `calls_cap=46`, `cost_cap_usd=5.00`, `warn_usd=4.00`. `run-case.sh`는 $5 도달 시 호출 자체를 거부(exit 5)하지만 $4 경고는 WARN 출력만 하고 P3 케이스 자동 다운그레이드는 **구현하지 않음**(스크립트가 케이스 우선순위를 모르므로 사람/오케스트레이터 판단에 위임 — 의도적 설계, 스펙 문언 "자동 강등"과는 문자 그대로 다름).
- **2026-08-23 harness-qa 스캐폴드 검증 완료**: `install.sh`·`teardown.sh`·`run-case.sh`·`record.sh`·`preflight.sh`·`env.sh` 전부 정적 검증(bash -n·코드 경로 추적) PASS. `src-copy` worktree가 dev HEAD(`fbba14e`)와 marketplace.json name 필드 1개만 다름을 실측 확인. 치명 결함 0건, 경미 1건(install.sh 헤더 주석이 실제 코드 순서와 다름 — 기능 영향 없음). 판정 결과는 `_workspace/04_implementation_progress.md` "## 검증 1: 스캐폴드" 절.
- **다음 단계**: `install.sh` 실행(disable 구간 개시) — 아직 미실행. 이후 T-1~T-7 케이스 실행 + `05_qa_report.md`/`05_token_measurement.md`/`05_router_accuracy.md`/`05_verdict.md` 산출까지 harness-qa가 재개(SendMessage)로 계속 참여.

- **2026-08-23 검증 2(실행 1: 설치+T-1+T-2) 완료**: install.sh 원자 실행 성공(해시 11파일 전건 일치), T-1·T-2 전 스텝 PASS. **확정 네임스페이스는 `ccp:` 단일** — `/antigravity:*`(문서 135건 참조)는 도구 제한 대조 프로브(Bash/Task 제거 시 COMMAND_NOT_FOUND)로 존재하지 않음을 실증. T-2에서 O-0b 예측 불일치(D-006, S3) 확정 — 로컬 경로 marketplace(RR-1 worktree 사본) 설치 시 job 산출물이 캐시 경로가 아니라 marketplace 소스 워크트리(`src-copy`)에 기록됨, 원인은 `paths.mjs`의 `import.meta.url` 기반 계산. **git-remote(GitHub) 설치에서 재현되는지는 미검증 — 신규 OQ로 인계됨.** defects.jsonl 7건(D-001~D-007, 최고 S2) 전부 스키마 준수. 예산 12콜/$1.3757(46콜·$5 대비 여유). QA가 자체 발견한 신규 이슈 2건(하니스 자체 증적 품질, 플러그인 결함 아님): (1) `cases/T-1/validate-strict.txt`에 마스킹 미적용 `$HOME` 원문 잔존 — `validate-evidence.mjs`의 V-12가 `.cmd/.stdout.json/.stderr.txt/.meta.json` 4종 확장자만 스캔해 이 파일 형식은 검출 밖(검증기 커버리지 공백), (2) T-1 레코드 `calls:4`가 실제 5콜(s3 재시도, 최초 시도 폐기)과 불일치. 상세는 `_workspace/04_implementation_progress.md` "## 검증 2: 실행 1 증적".
- **2026-08-24 검증 3(실행 2: T-3+T-4+T-A) 완료**: T-4 PASS(4계열 완결), T-A PARTIAL(codex arm 대부분 PASS, antigravity foreground d-010), T-3 PARTIAL(음성 대조 계측기 무효 확인, AQ-1/OQ-H8 실측 확인). 신규 결함 D-008~D-011(최고 S1: D-010, antigravity 헤드리스 실행 중 agy 내부 모델의 셸 명령 시도가 print-mode 게이트에 자동 거부되어 통째 실패). 예산 33콜/$4.5935(`tally-calls.sh` SSOT와 정확히 일치, $4 경고선 초과 확인). 마스킹 확장 스캔(V-12를 `cases/<id>/` 전 파일 재귀로 확장) 코드 검증 완료, 신규 누출 3건(`s2.meta.json` flags[]·`invocation-strings.txt`·`product-permission-patterns.txt`) 소급 마스킹 확인. **가장 중요한 발견: D-010(S1)의 근본원인 증거인 원본 `agy.log`가 `evidence/`에 복사되지 않고 `$E2E_ROOT/src-copy/_workspace/_jobs/<id>/agy.log`에만 존재 — teardown의 `rm -rf $E2E_ROOT`가 실행되면 영구 소실. 다음 재개(teardown 진입 전) 최우선으로 이 로그를 `evidence/` 또는 `$SAFE_DIR`에 보존해야 함.** 상세는 `_workspace/04_implementation_progress.md` "## 검증 3: 실행 2 증적".
- **다음 단계**: 묶음 3 진입 가능(차단 요소 없음). 단 teardown 전 D-010 agy.log 보존이 최우선 선결 조건. 예산 상한 상향 여부는 오케스트레이터·사용자 협의 사안(QA 판정에 미반영). 치명 결함 0건 유지 중(단, 증적 소실 리스크 1건 별도 관리 필요).

**Why:** 이 런은 여러 세션에 걸쳐 SendMessage로 재개되는 단일 흐름이므로, 새 세션에서도 RUN_ID·방안·예산·분기 확정값을 다시 실측하지 않고 이 요약으로 문맥을 복구할 수 있어야 한다.

**How to apply:** 이 RUN_ID의 후속 검증 요청을 받으면 먼저 `_workspace/04_scaffold_progress.md`·`04_implementation_progress.md`·`evidence/env.json`을 다시 읽어 위 값들이 아직 유효한지(특히 host 재부팅·재실행으로 P-0/P-2가 재수행됐는지) 확인한 뒤 사용한다. 관련: [[feedback-static-only-verification]], [[feedback-header-comment-drift]].
