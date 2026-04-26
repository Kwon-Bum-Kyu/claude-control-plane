# Claude Control Plane (CCP)

공개 Claude Code 플러그인 — Claude를 메인 컨트롤 플레인으로 두고 Gemini(MVP), Codex(Phase 6+) CLI를 서브에이전트로 오케스트레이션한다. codex-plugin-cc 패턴을 미러링하여 사용자 학습 비용을 0으로 만들고, ecc 가드레일을 차용하여 토큰 회귀를 방지한다.

## 하네스: Claude Control Plane (CCP) 플러그인 개발

**목표:** Claude를 메인 컨트롤 플레인으로 두고 Gemini(MVP)·Codex(Phase 6+)를 CLI wrapper 서브에이전트로 오케스트레이션하는 공개 플러그인을 기획→검수→개발 3-Phase로 구축

**트리거:** CCP 플러그인 개발/기획/검수/개발/QA 관련 작업 요청 시 `ccp-orchestrator` 스킬을 사용하라. 단순 질문(예: "이 파일 무슨 의미야?")은 직접 응답 가능.

**참고 자료:**
- 입력 브리프: `_workspace/00_input/project_brief.md`
- 사전 리서치: `_workspace/00_input/research_brief.md`, `보고서/`
- 아카이브된 이전 분석: `_workspace_archive_20260421/`

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-04-22 | 초기 구성 (3-Phase 파이프라인, 9 에이전트, 11 작업 스킬 + 1 오케스트레이터) | 전체 | CCP 플러그인 공개 레포 개발 하네스 신규 구축 |
| 2026-04-23 | Phase 3 S1 실측 + G1 게이트 OPEN. U1·U2·U5·U6 정정 수행(C1~C5) | `_workspace/01_schema.md`, `_workspace/01_subagent_spec.md`, `_workspace/01_command_spec.md`, `_workspace/02_arch_decisions.md`, `_workspace/03_task_plan.md` | 공식 Claude Code plugins-reference·hooks·sub-agents 문서 실측 결과 반영. S2(스캐폴드) 진입 준비 완료. 상세는 `CHANGELOG.md` 참조. |
| 2026-04-24 | S1-3-RT detached companion proto 실측 완료, U4 runtime CLOSED (C6) | `_workspace/_probe/s1-3/PROBE_RESULT.md`, `_workspace/02_arch_decisions.md`, `_workspace/03_task_plan.md` | 사용자 호스트(macOS/Node v22.12.0) 실측: AC-1 부모 exit 후 자식 sleep 30 생존, AC-2 meta.json queued→running 전이, AC-3 stdout envelope 6키 전수 PASS. background MVP 포함 확정, S3-1 spawn 패턴 고정. |
| 2026-04-24 | R18 stderr 마스킹 regex DROP 확정 (C9) | `_workspace/03_r18_decision.md` 신규, `_workspace/02_arch_decisions.md`, `_workspace/03_gemini_cli_probe.md`, `_workspace/03_task_plan.md`, `CHANGELOG.md` | 실측 재검토 결과 IDE 토큰 값 stderr 미노출, `/var/folders/*` 난수 해시로 사용자 식별 불가, envelope 는 stdout JSON 만 승격(raw stderr 유입 경로 없음), stderr 원본은 `.gitignore` 차단. 4중 방어선 이미 가동 중 → 마스킹 regex 불필요. 재발 방지 3-step gate 결정문 §5 에 기록. S1 후속 잔여 R19 1건으로 축소. |
| 2026-04-25 | R19 engines 명시 완료 (C10). S1 후속 권고 전수 CLOSED (잔여 0건) | `plugins/ccp/plugin.json` (`engines.node >=20.0.0`, `engines.gemini_cli >=0.38.0`), `_workspace/02_arch_decisions.md` C10 행, `_workspace/03_task_plan.md` 헤더·S4-8·§9, `CHANGELOG.md` | Gemini CLI 0.38.x 실측 의존(`stats.models.<model>.tokens` 7필드, UUIDv4 `session_id`, stream-json 평탄화)을 매니페스트에 선언. 공식 스키마 미소비 대비 런타임 강제는 S3-6 companion `preflight` 서브커맨드가 `gemini --version` 파싱으로 수행, README 명시는 S4-8 에 위임. |
| 2026-04-26 | S4 (QA·공개) 전 태스크 완료 — MVP 합격 (AC-1~7 PASS) | `_workspace/04_*` 8건 (envelope/router/token/regression/onboarding/license/principles/mvp_verdict), `LICENSE`/`README.md`/`ATTRIBUTION.md`/`CONTRIBUTING.md` 4 파일, `01_backlog.md` (B1~B12 12건 동결), `plugins/ccp/hooks/suggest-compact.js`+`scripts/harness-audit.js` attribution 헤더 보강 | S4-2 envelope 15/15·S4-3 라우터 36/36·S4-4 T1·T3 평균 99.7%·S4-5 RC 7/7·S4-6 5분 룰·S4-7 L1~L9 (C-01 BLOCKER 해소)·S4-8 공개 문서·S4-9 7원칙 7/7·S4-10 백로그 동결. CCP v0.1.0 공개 푸시 가능 상태. |
| 2026-04-26 | 레포 분리 전략 결정 (옵션 B 채택) — Dev(private) / Public 두 레포 운영 | `_workspace/04_repo_split_decision.md` 신규 | 단일 레포 `.gitignore` 의존 시 누출 위험. Dev 레포에 현 디렉터리 전체(하네스 포함) private 푸시 → 개인 테스트 → clean copy 로 Public 레포 분기. Phase 5-A 진입. |
