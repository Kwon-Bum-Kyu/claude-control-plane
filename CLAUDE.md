# Claude Control Plane (CCP)

공개 Claude Code 플러그인 — Claude를 메인 컨트롤 플레인으로 두고 Antigravity(MVP), Codex(Phase 6+) CLI를 서브에이전트로 오케스트레이션한다. codex-plugin-cc 패턴을 미러링하여 사용자 학습 비용을 0으로 만들고, ecc 가드레일을 차용하여 토큰 회귀를 방지한다.

## 하네스: 전역 dev-pipeline 사용

**목표:** CCP 플러그인 개발을 전역 풀스택 개발 파이프라인 (자연어 접수 → 자료 수집 → 브레인스토밍 → 기획 → 휴먼 승인 G1 → 개발 → ralph QA → 휴먼 승인 G2 → 위키화·린트) 으로 진행한다. 개발·위키화 진입은 반드시 사용자 승인 게이트를 거치고, 승인된 런은 wiki vault 에 지식으로 적재되어야 완결된다.

**트리거:** CCP 플러그인 개발/기획/QA/위키화 관련 작업 요청, 그리고 승인 게이트 응답("승인", "개발 진행해", "위키화 진행해", "거부") 시 전역 `dev-pipeline` 스킬을 사용하라. 본 프로젝트는 자체 오케스트레이터를 두지 않는다 — dev-pipeline Phase 0 의 프로젝트 하네스 양보 판정에서 본 절은 "전역 하네스 사용 선언"으로 읽는다. 단순 질문(예: "이 파일 무슨 의미야?")은 직접 응답 가능.

**도메인 지식 스킬:** `.claude/skills/` 하위 11종 (arch-checklist·router-implementation·companion-script-pattern 등) 은 CCP 도메인 지식으로 유지된다. 파이프라인 에이전트 브리핑에 해당 `SKILL.md` 경로를 참고 문서로 전달할 수 있다.

**변경 이력:** `.claude/HARNESS_CHANGELOG.md` (CLAUDE.md 본문에는 누적하지 않음)

**참고 자료:**
- 입력 브리프: `_workspace/00_input/project_brief.md`
- 사전 리서치: `_workspace/00_input/research_brief.md`, `보고서/`
- 아카이브된 이전 분석: `_workspace_archive_20260421/`

**Dev 룰 (강제 준수):**
- `.claude/rules/no-internal-tracking-ids.md` — 작업자 전용 추적 ID (백로그·게이트·실측·결정 ID 등) 의 공개 표면 (`plugins/ccp/**` + 공개 문서 6종) 작성 금지. `_workspace/**`·`CLAUDE.local.md` 는 적용 제외 (dev 추적 본진).
