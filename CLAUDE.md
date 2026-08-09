# Claude Control Plane (CCP)

공개 Claude Code 플러그인 — Claude를 메인 컨트롤 플레인으로 두고 Antigravity(MVP), Codex(Phase 6+) CLI를 서브에이전트로 오케스트레이션한다. codex-plugin-cc 패턴을 미러링하여 사용자 학습 비용을 0으로 만들고, ecc 가드레일을 차용하여 토큰 회귀를 방지한다.

## 하네스: Claude Control Plane (CCP) 플러그인 개발

**목표:** Claude를 메인 컨트롤 플레인으로 두고 Antigravity(MVP)·Codex(Phase 6+)를 CLI wrapper 서브에이전트로 오케스트레이션하는 공개 플러그인을 8단계 파이프라인 (자연어 접수→기획→검수→휴먼 승인→개발→QA→휴먼 승인→위키화)으로 구축. 개발·위키화 진입은 반드시 사용자 승인 게이트를 거치고, 승인된 런은 claude-obsidian wiki vault에 지식으로 적재되어야 완결된다.

**트리거:** CCP 플러그인 개발/기획/검수/개발/QA/위키화 관련 작업 요청, 그리고 승인 게이트 응답("승인", "개발 진행해", "위키화 진행해", "거부") 시 `ccp-orchestrator` 스킬을 사용하라. 단순 질문(예: "이 파일 무슨 의미야?")은 직접 응답 가능.

**변경 이력:** `.claude/HARNESS_CHANGELOG.md` (CLAUDE.md 본문에는 누적하지 않음)

**참고 자료:**
- 입력 브리프: `_workspace/00_input/project_brief.md`
- 사전 리서치: `_workspace/00_input/research_brief.md`, `보고서/`
- 아카이브된 이전 분석: `_workspace_archive_20260421/`

**Dev 룰 (강제 준수):**
- `.claude/rules/no-internal-tracking-ids.md` — 작업자 전용 추적 ID (백로그·게이트·실측·결정 ID 등) 의 공개 표면 (`plugins/ccp/**` + 공개 문서 6종) 작성 금지. `_workspace/**`·`CLAUDE.local.md` 는 적용 제외 (dev 추적 본진).
