# CCP CHANGELOG

Claude Control Plane 플러그인 개발 하네스의 산출물 변경 이력. 형식은 [Keep a Changelog](https://keepachangelog.com/) 를 따른다. 일자는 KST.

> 코드 릴리즈 버전이 아닌 **문서·설계 산출물 마일스톤** 기준이다. 코드 릴리즈는 S2 진입 후 `plugin.json` 의 `version` (현재 `0.1.0` 예정)에서 별도 관리.

---

## [Unreleased] — Phase 3 S3 진입 준비

### 진입 조건
- ✅ G1 게이트 OPEN (2026-04-23)
- ✅ S2 스테이지 8건 전수 완료 (2026-04-26)
- ✅ G2 게이트 OPEN — `.claude-plugin/marketplace.json` + `plugins/ccp/plugin.json` JSON 유효성·경로 정합성 100% 통과

### S3에서 처리 예정
- companion 6종 구현 (S3-1~S3-6)
- 라우터 스킬 (S3-7), 서브에이전트 강화 (S3-8), 슬래시 5종 본문 강화 (S3-9)
- hooks 3종 구현 (S3-10), context-budget 스킬 포팅 (S3-11), audit 스크립트 (S3-12), OAuth fallback 메시지 (S3-13)

### 결정 대기 (scope-guard 판정)
- `schema_version` MVP 포함 여부 — 현행 합의: MVP 생략, Phase 6+ 도입 시 누락=`1.0.0` 후방 호환

---

## 2026-04-26 — S2 스캐폴드·매니페스트 8건 완료

### Added
- `.claude-plugin/marketplace.json` 보강 — `displayName`·`license` 필드 추가, 01_schema.md §3.5.1 골격 100% 일치 (S2-2)
- `plugins/ccp/.claude-plugin/plugin.json` 전면 보강 — `commands` 5종, `agents` 1종, `skills` 1종, `scripts` 2종, `minClaudeVersion`, `keywords` 추가 (S2-3)
- `_workspace/03_hook_strategy.md` 신규 — 4개 훅(UserPromptSubmit·PreCompact·SubagentStop·SessionStart) 사양 + 13 TC (S2-6)
- `_workspace/03_namespace_decision.md` 신규 — `/gemini:*` vs `/ccp:*` 분리 의사결정 트리 + Phase 6+ `/codex:*` 확장 규칙 (S2-7, M11 CLOSED)
- `.gitignore` 신규 — `_workspace/`·`보고서/`·`node_modules/`·`.env`·`.DS_Store` 등 license-checklist L5·L6 요구 사항 전수 (S2-8)

### Changed
- `_workspace/01_schema.md` §2.1·§2.2 envelope 에 `details` 서브오브젝트 + `additionalProperties: false` 명시 (S2-5, M3 원칙 2)
- `_workspace/01_command_spec.md` `/ccp:audit` 출력 예시의 `scores` 가 envelope 루트 → `details` 하위로 이동 (S2-5)
- `_workspace/01_error_messages.md` SSOT 선언 추가 — 17개 코드 정규식 `^CCP-[A-Z]+-[0-9]{3}$` 100% 매칭 확인 (S2-4, M2 원칙 1)
- `_workspace/02_regression_cases.md` RC-1·RC-7 의 `E_OAUTH_EXPIRED` 활성 참조 5건 → `CCP-OAUTH-001` 정정 (S2-4)
- `_workspace/02_token_scenarios.md` T6 의 `E_OAUTH_EXPIRED` 활성 참조 2건 → `CCP-OAUTH-001` 정정 (S2-4)

### Verified (incremental QA — S4-1 사전 검증)
- 3개 매니페스트 JSON 유효성: 3/3 PASS
- `plugin.json` commands·agents·hooks·skills 경로 실재성: 100% PASS
- 슬래시 네임스페이스 정규식 `^(gemini|ccp):[a-z]+$`: 5/5 PASS
- 에러 코드 17건 unique, 11 카테고리 매핑 완료

### S2 산출 합계
- 신규 파일 3건 (`03_hook_strategy.md`·`03_namespace_decision.md`·`.gitignore`)
- 보강 파일 4건 (marketplace.json·plugin.json·01_schema.md·01_command_spec.md·01_error_messages.md)
- 정정 파일 2건 (02_regression_cases.md·02_token_scenarios.md)

---

## 2026-04-25 — R19 engines 명시 완료 (C10)

### Added
- `plugins/ccp/plugin.json` 에 `engines` 블록 추가: `node >=20.0.0`, `gemini_cli >=0.38.0`.

### Changed
- **R19 CLOSED**: 버전 하한 근거는 `_workspace/03_gemini_cli_probe.md` 실측 결과 (Gemini CLI 0.38.2 에서 `stats.models.<model>.tokens` 7필드, UUIDv4 `session_id`, stream-json `result` 이벤트 `total_tokens`/`input_tokens`/`output_tokens` 평탄화 지원 확인). 공식 plugin.json 스키마가 `engines` 필드를 소비하지 않더라도 런타임 강제는 S3-6 companion `preflight` 서브커맨드가 `gemini --version` 파싱으로 수행한다.
- `_workspace/02_arch_decisions.md` 재개정 수행 완료 로그에 C10 행 추가, 미정정 잔여 표에서 R19 스트라이크스루 + 처리 완료 주석.
- `_workspace/03_task_plan.md` 헤더 상태 "R19 1건" → "S1 전체 CLOSED / 잔여 0건", §9 변경 이력 2026-04-25 행 추가, S4-8 합격 기준에 "README '설치 요구사항' 섹션 Node ≥ 20 / Gemini CLI ≥ 0.38.0 2줄 명시" 지시 승계.

### Rationale
- 공식 스키마 미지원 가능성에 대비한 2중 기록(매니페스트 선언 + README 명시 + preflight 런타임 검증) 으로 사용자 환경 부적합을 조기 차단.

---

## 2026-04-24 — R18 stderr 마스킹 DROP 확정 (C9)

### Added
- `_workspace/03_r18_decision.md` — R18 stderr 마스킹 regex 추가 권고의 DROP 판정 결정문. 실측 재검토 근거(§3), 판정 요약(§4), 기존 4중 방어선 매핑(§4.3), 트러블슈팅 노트와 재발 방지 3-step gate(§5), S3-1 구현 계약 재확인(§6), 연관 산출물 변경 범위(§7) 수록.

### Changed
- **R18 CLOSED (DROP 판정)**: stderr 마스킹 regex (`/var/folders/.*gemini-client-error.*\.json`, `GEMINI_CLI_IDE_AUTH_TOKEN=.*`) 를 `01_error_messages.md` 에 **추가하지 않는다**. 근거 4건:
  1. stderr 원본 파일은 `_workspace/_jobs/<uuid>/stderr` 로만 기록, `.gitignore` 공개 차단 (S2-8)
  2. envelope 는 stdout JSON 만 승격, raw stderr 는 envelope 로 유입되지 않음 (S3-1 설계)
  3. `/var/folders/*` 는 macOS 난수 해시 임시 폴더로 사용자 식별 정보 비포함
  4. `GEMINI_CLI_IDE_AUTH_TOKEN` 값은 stderr 에 찍히지 않음 (probe 샘플 전수 확인: `_probe/s1-4/samples/04_error_mode_stderr.log`)
- `_workspace/02_arch_decisions.md` §"미정정 잔여" R18 행 → 취소선 + "✅ CLOSED 2026-04-24 (C9) — DROP 판정" 주석
- `_workspace/02_arch_decisions.md` §"재개정 수행 완료 로그" → C9 행 추가
- `_workspace/03_gemini_cli_probe.md` §3 T6·T7·T8 → ⚠️ → ℹ️ 다운그레이드 + 재평가 주석 박스 + §5 R18 행 취소선 + §6 회귀 테스트 대체 케이스
- `_workspace/03_task_plan.md` 헤더 상태 → "S1 후속 잔여 R19 1건" 로 축소, §9 변경 이력에 C9 행 추가

### 근거 (Source of Truth)
- `_workspace/03_r18_decision.md` §3 실측 재검토 (3.1 `/var/folders`, 3.2 `GEMINI_CLI_IDE_AUTH_TOKEN`, 3.3 `[IDEClient]` 경고)
- `_workspace/_probe/s1-4/samples/04_error_mode_stderr.log` probe 원본
- `_workspace/02_license_audit.md` §L6 grep 패턴 0건 통과 및 권고 1 (`.gitignore` 필수)
- `_workspace/01_schema.md` §3.2 envelope 계약 (stdout JSON 전용 승격)

### Status
- **S1 후속 잔여**: ~~R18~~ ✅ DROP / R19 유지
- **다음 진입 가능**: R19 1건 처리 (README 요구사항 섹션) 또는 G2 게이트 검증(`/plugin install . --local`) 병행

---

## 2026-04-23 — Phase 3 S2-1·S2-2·S2-3 매니페스트 골격 (C8)

### Added (신규 12 파일)
- `_workspace/03_plugin_tree.md` — 권위 있는 디렉토리 트리 + codex-plugin-cc v1.0.4 diff 표 + 신규 파일 매핑 + G2 게이트 영향 분석
- `.claude-plugin/marketplace.json` — `name=claude-control-plane`, `plugins[ccp]` 1건
- `plugins/ccp/plugin.json` — `hooks: "./hooks/hooks.json"` 외부 참조, `permissions` 필드 부재 (C2/C3 준수)
- `plugins/ccp/hooks/hooks.json` — 4 이벤트(`UserPromptSubmit`/`SubagentStop`/`SessionStart`/`PreCompact`) × matcher/command 배열
- `.claude/settings.json` — `permissions.allow[]` 4건 (`Bash(...*)` wildcard, gemini probe + companion + audit)
- `plugins/ccp/commands/gemini-rescue.md` — stub, `--fallback-claude` 인자 (C7) 반영
- `plugins/ccp/commands/gemini-status.md` — stub
- `plugins/ccp/commands/gemini-result.md` — stub
- `plugins/ccp/commands/gemini-setup.md` — stub, OAuth probe 3단 (C7 R17) 반영
- `plugins/ccp/commands/ccp-audit.md` — stub
- `plugins/ccp/agents/gemini-rescue.md` — stub, `tools`/`disallowedTools`/`background:false` (C4/U6) 반영
- `plugins/ccp/skills/context-budget/SKILL.md` — stub

### Changed
- `_workspace/02_arch_decisions.md` §"재개정 수행 완료 로그" — C8 행 추가
- `_workspace/03_task_plan.md` §7 — G2 "🟡 선결 산출물 완료" 표시 + G2 OPEN 근거 박스 추가
- `_workspace/03_task_plan.md` §9 — 본 batch 변경 이력 추가

### Status
- **G2 게이트:** 🟡 선결 산출물 12 파일 완료. 사용자 호스트에서 `/plugin install . --local` 검증 잔여
- **다음 진입 가능:** S3 (핵심 구현 13건) — companion·라우터·훅·audit 본문 작성

---

## 2026-04-23 — Phase 3 S1-5 / R13·R17 시나리오 재설계 (C7)

### Added
- `_workspace/01_command_spec.md` `/gemini:rescue` — `--fallback-claude` 인자 신설 (R13 bg 경로의 다음 턴 사용자 재호출용)
- `_workspace/01_user_scenarios.md` 시나리오 3 §"Fallback 분기" — A-fg / A-bg 두 경로 명세 (`AskUserQuestion` 코드 예시 + `retryHint` envelope 예시)
- `_workspace/01_error_messages.md` `CCP-OAUTH-001` — "다음 행동 (foreground)" / "다음 행동 (background)" 두 행 분리

### Changed
- **R13 CLOSED**: 시나리오 3 분기 A 의 `[Y/n]` stdin 패턴 전면 제거. fg = `AskUserQuestion` 즉시 호출(3옵션), bg = `retryHint` envelope + 다음 턴 사용자 재호출
- **R17 CLOSED (C7 동시 처리)**: `/gemini:setup` 동작에서 `gemini auth status` 의존 제거 → env(`GEMINI_API_KEY`) + 파일(`~/.gemini/google_accounts.json`) + probe(`gemini -p "ping" -o json`) 3단 추정으로 교체. Bash 화이트리스트도 동기화
- `_workspace/01_error_messages.md` 출력 예시 — `--fallback=claude` (등호 형식) → `--fallback-claude "<원본 task>"` (kebab, `--background`/`--max-tokens`/`--files` 와 일관)
- `_workspace/02_arch_decisions.md` §"재개정 수행 완료 로그" — C7 행 추가, 미정정 잔여표에서 R13/R17 취소선 처리, 추가 발견 이슈(`gemini auth status`)도 closed 표기

### 근거 (Source of Truth)
- `_workspace/03_hook_feasibility.md` §1 S1-5 ❌ FAIL — slash command stdin-blocking 불가
- `_workspace/03_hook_feasibility.md` §6.3 — fg `AskUserQuestion` / bg envelope 권고 (R13 본문)
- `_workspace/03_gemini_cli_probe.md` §T4 — `gemini auth status` 미지원 (R17 근거)
- `_workspace/02_arch_decisions.md` §"재개정 수행 완료 로그" C7

### Status
- **잔여 P1**: ~~R13~~ ✅ / ~~R17~~ ✅ / R18 (마스킹 regex) / R19 (README engines)
- **다음 진입 가능**: P1-③ S2-1~S2-3 매니페스트 (`--fallback-claude` 인자가 commands stub 에 반영 가능)

---

## 2026-04-23 — Phase 3 S1 실측 후속 정정 (C1~C5)

### Added (신규)
- `_workspace/01_schema.md` §3.5.2 — `plugins/ccp/hooks/hooks.json` 예시 블록 (4개 이벤트 × matcher/command 배열)
- `_workspace/01_schema.md` §3.5.2 — `.claude/settings.json` 의 `permissions.allow[]` 예시 블록
- `_workspace/01_schema.md` §1.2 — `token_usage` 5개 필드 (`total`/`cached`/`thoughts`/`estimated`/`source`)
- `_workspace/01_subagent_spec.md` Frontmatter — `disallowedTools`, `background`, 무시 필드 금지 주석
- `_workspace/02_arch_decisions.md` — "재개정 수행 완료 로그 (2026-04-23)" 섹션 (C1~C5, 미정정 잔여 5건, 추가 발견 이슈)
- `_workspace/03_task_plan.md` §7 — 게이트 상태 컬럼, G1 OPEN 근거 박스
- `CHANGELOG.md` — 본 문서 신규

### Changed (정정)
- **U1 CLOSED**: `_workspace/01_schema.md` §3.5.2 `plugin.json.hooks` flat-key 객체 → `"./hooks/hooks.json"` 외부 참조 (Claude Code 공식 plugins-reference 스키마)
- **U2 CLOSED**: `_workspace/01_schema.md` §3.5.2 `plugin.json.permissions.bash[]` 블록 제거 → `.claude/settings.json` 분리 (`Bash(...*)` wildcard 형식)
- **U5 CLOSED**: `_workspace/01_schema.md` §1.2 `token_usage` 2필드 → 7필드 확장, `gemini_session_id` UUIDv4 패턴 강제
- **U6 CLOSED**: `_workspace/01_subagent_spec.md` 서브에이전트 frontmatter `allowed-tools` → `tools` + `disallowedTools` (4곳)
- `_workspace/01_schema.md` §1.4 예시 — 새 token_usage 스키마 일관성 보정
- `_workspace/01_schema.md` §3.5.3 디렉토리 트리 — `.claude/settings.json` + `hooks/hooks.json` + 3개 핸들러 명시
- `_workspace/01_schema.md` §3.5.4 미결 항목 — 2건 (hooks·permissions) CLOSED 마킹
- `_workspace/01_schema.md` §5 미결 사항 — 2건 (token_usage·gemini_session_id) CLOSED 마킹
- `_workspace/01_command_spec.md` 라인 50 권한 원칙 — `manifest의 permissions` → `.claude/settings.json permissions.allow[]`
- `_workspace/03_task_plan.md` §7 — G1 게이트 ✅ OPEN 표시
- `_workspace/03_task_plan.md` §8.1 — S1 fallback 4건 중 3건(U1·U2·U5) 비활성화 표시
- `_workspace/03_task_plan.md` §9, `CLAUDE.md` 변경 이력 — 본 정정 항목 추가

### 근거 (Source of Truth)
- `_workspace/03_hook_feasibility.md` §1·§2·§6 — U1·U2·U6 실측 (`code.claude.com/docs/en/hooks`, `…/plugins-reference`, `…/sub-agents`, `…/permissions`)
- `_workspace/03_gemini_cli_probe.md` §2.1·§4 — U5 실측 (CLI v0.38.2 `_workspace/_probe/s1-4/samples/`)
- `_workspace/02_arch_decisions.md` §"재개정 수행 완료 로그" — C1~C5 매핑

### Status
- **G1 게이트:** ⬜ → ✅ OPEN 2026-04-23
- **다음 진입 가능:** S2 (스캐폴드 + 매니페스트 생성)

---

## 2026-04-22 — Phase 1·2 초기 구성

### Added
- 3-Phase 파이프라인 (기획 → 검수 → 개발) 정의
- 9 에이전트 + 11 작업 스킬 + 1 오케스트레이터(`ccp-orchestrator`) 스켈레톤 배치
- `_workspace/01_*.md` 10개 — PRD, 커맨드 명세, 스키마, 에러 카탈로그, 서브에이전트 명세, 사용자 시나리오, scope 결정, 백로그, README outline, 온보딩
- `_workspace/02_*.md` 7개 — 아키텍처 리뷰·결정, 라이선스 감사, 토큰 시나리오, 회귀 케이스, 라우터 정확도, attribution 템플릿, 의존성 manifest
- `_workspace/03_task_plan.md` — S1~S4 36태스크 의존성 그래프
- `_workspace/03_hook_feasibility.md` — Claude Code 공식 hooks/permissions/sub-agents 문서 실측 (S1-1/2/3/5)
- `_workspace/03_gemini_cli_probe.md` — Gemini CLI v0.38.2 토큰·session_id 실측 (S1-4)

### Status
- Phase 1 ✅ 완료 / Phase 2 ✅ 완료 / Phase 3 S1 실측 80% (S1-3 runtime 잔여)
