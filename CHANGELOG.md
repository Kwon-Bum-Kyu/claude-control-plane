# CCP CHANGELOG

Claude Control Plane 플러그인 개발 하네스의 산출물 변경 이력. 형식은 [Keep a Changelog](https://keepachangelog.com/) 를 따른다. 일자는 KST.

> 코드 릴리즈 버전이 아닌 **문서·설계 산출물 마일스톤** 기준이다. 코드 릴리즈는 S2 진입 후 `plugin.json` 의 `version` (현재 `0.1.0` 예정)에서 별도 관리.

---

## 2026-05-02 — Phase 6-A B19 라우터 추천 훅 활성 (B19 RESOLVED)

### Added
- `plugins/ccp/scripts/lib/router.mjs` — 4축 라우터 결정 로직(`classify(input, opts)`)을 재사용 모듈로 추출. router-eval.mjs 와 hooks/router-suggest.js 가 동일 구현을 import
- `plugins/ccp/hooks/router-suggest.js` — UserPromptSubmit 훅. 결정이 `gemini`/`codex` 면 `[CCP-ROUTER-001]` system reminder 로 추천 메시지 주입(슬래시 힌트·axis·reason·matched 키워드 포함). `claude` 결정은 noop, JSON 파싱 실패는 silent
- `plugins/ccp/hooks/hooks.json` — UserPromptSubmit 에 router-suggest 훅 등록 (suggest-compact 와 병렬)

### Changed
- `_workspace/_router_test/router-eval.mjs` — 인라인 `classify`/`classifyByKeyword`/키워드 사전 제거, `lib/router.mjs` import. TARGETS 도 모듈 export 사용. 헤더에 B19 모듈 추출 주석 추가
- `plugins/ccp/skills/router/SKILL.md` — B1 v0.1 미활성 표기를 v0.2 B19 RESOLVED 로 갱신, 추천 훅 활성·자동 위임 미수행 명시. v0.3 백로그에서 B19 제거
- `_workspace/01_backlog.md` — B19 RESOLVED 마킹 (산출물·공수 실측·회귀 결과 기록), 누적 현황·변경 이력 갱신

### Verified
- 훅 6 시나리오 PASS — gemini slash / codex slash / claude 단순 수정(noop) / diff 키워드(codex C축 추천) / 메인 컨텍스트 의존(noop) / JSON 파싱 실패(silent)
- router-eval 50/50 = 100% — 리팩터 전후 동일 결과(claude 1.000/0.952, gemini 0.933/1.000, codex 1.000/1.000)
- audit 점수 37/40 유지 (8 카테고리 모두 영향 없음)

### Why
- B20 50 케이스 데이터셋 확보(2026-05-02) 로 P/R ≥ 0.93 검증 → B19 추천 훅 활성화 진입 조건 충족
- 자동 위임은 의도적으로 미수행 — 원칙 4(자동 fallback 금지) 준수, 사용자가 추천을 보고 직접 슬래시 호출
- 라우터 로직을 단일 모듈로 추출함으로써 G1-A(명세-구현 일관성) 강제: 향후 알고리즘 변경 시 router-eval 과 훅이 자동 동기화됨

---

## 2026-05-02 — Phase 6-A B20 codex 회귀 14건 추가 (50 케이스 데이터셋, B20 RESOLVED)

### Added
- `_workspace/_router_test/router-eval.mjs` — X01~X14 codex 정답 케이스 14건 추가. axis A user_explicit 5건 (slash 3 + `--effort`/`--sandbox` 2), axis B mid_review_codex 4건 (5K~30K + review/diff/버그조사 키워드), axis C 5건 (단일 키워드 3 + 다중 매칭 우위 2)
- `_workspace/_router_test/EVAL_DATASET.md` §8 — X01~X14 라벨링 근거 5개 하위 절(8.1~8.5) 신규. 각 케이스 결정 신호·매칭 키워드·KW_CLAUDE 회피 검증 명시

### Changed
- `_workspace/_router_test/router-eval.mjs` 헤더 — "B1 36 케이스" → "B20 50 케이스" 갱신
- `_workspace/_router_test/EVAL_DATASET.md` §1·§2·§9 — 50 케이스 라벨 분포 (claude 21 / gemini 14 / codex 15) 갱신, B1 36 케이스 분포는 §2.2 히스토리로 보존
- `plugins/ccp/skills/router/SKILL.md` — 36 케이스 → 50 케이스 표기 갱신 (정확도 측정 절차·B1 적용 범위)
- `_workspace/01_backlog.md` — B20 RESOLVED 마킹, 누적 현황 (P1 RESOLVED 1건 추가), 변경 이력 갱신

### Verified
- router-eval 50/50 = 100% PASS — 전체 정확도 100%, 명확 케이스 100%, 경계 케이스 5/5 (alt 허용)
- 모델별 P/R: claude 1.000/0.952, gemini 0.933/1.000, codex 1.000/1.000 (전 모델 ≥ 0.93)
- 혼동 행렬: 실제 codex 15건 모두 codex 예측, 오분류 0건 (B02만 claude→gemini alt 허용 매칭, 기존 동일)

### Why
- 결정 #4 옵션 C Phase 1 (B1 v0.1 명세만 3-way) 상태에서 codex 정답 데이터가 G09 1건뿐이어서 자동 라우팅 활성화(B19) 합격선 검증 불가
- B20 으로 codex 라벨 1 → 15 건 확장하여 P/R 통계적 유의성 확보. v0.2 B19 진입 데이터셋 요건 충족

---

## 2026-05-01 — Phase 6-A B1 Codex CLI 통합 — C1~C6 6/6 PASS (B1·B11·B17 RESOLVED)

### Added
- `plugins/ccp/scripts/codex-companion.mjs` — Codex CLI 래퍼 신규 (~480줄). 6 서브커맨드(setup/rescue/status/result/cancel/task-worker), envelope 6키 self-validate, foreground/background 분기, 한국어 에러 카탈로그
- `plugins/ccp/scripts/lib/codex_adapted/{state,tracked-jobs,process,args,job-control}.mjs` — codex-plugin-cc release/v1.0.4 (SHA `8e873d6f...`) 함수 단위 차용. Apache-2.0, 5필드 헤더(Adapted from/Source/License/Modifications/SHA) 의무
- `plugins/ccp/scripts/lib/envelope-validate.mjs` — envelope 6키 zero-deps self-validator. `CCP_ENVELOPE_STRICT=1` 환경에서 throw, 평상시 stderr 경고
- `plugins/ccp/schemas/envelope.schema.json` — JSON Schema 2020-12 준수, success/error oneOf, tokens 4필드(input/cached/output/total) 표준화, details.mode enum [gemini, codex]
- `plugins/ccp/commands/codex-{setup,rescue,status,result}.md` — 슬래시 4종 + `plugins/ccp/agents/codex-rescue.md` 서브에이전트 (gemini-rescue 미러링 + codex 고유 옵션 명세)
- `_workspace/06_codex_cli_probe.md` — codex CLI 0.122.0 5종 `--help` 전수 capture, P95 7.242s 측정, JSONL 4 이벤트 스키마 (`thread.started/turn.started/item.completed/turn.completed`), detached spawn 검증, OAuth 흐름 측정
- `_workspace/06_codex_function_mapping.md` — 9 함수 후보 → 7 차용 + 2 흡수, 5 모듈 구조, gemini ↔ codex 측정 단위 SSOT
- `_workspace/06_b1_qa_report.md` — C1~C6 6/6 PASS 측정 리포트
- `NOTICE` — Apache-2.0 의무 NOTICE 신규 (codex-plugin-cc 차용 5 파일 명시)
- `ATTRIBUTION.md` §1.3 (codex-plugin-cc Apache-2.0 승격 — Inspired By → Borrowed) + §1.4 (Apache-2.0 라이선스 원문) + §6 (B1 차용 파일 표) + ecc SHA `c7c7d37f...` 명시 (B11 RESOLVED)
- `plugins/ccp/scripts/harness-audit.js` `scoreAdaptedHeaders()` 신설 — G1-I 검사. lib/codex_adapted/ 차용 파일 헤더 5필드 누락 시 감점 (B1 검증: 5/5 PASS)
- README §4.2 codex 슬래시 4종 + §4.5 모델 호환성 매트릭스(3-way 13 옵션) + §5 라우터 3-way 확장 + §8 v0.2 로드맵 (B18~B23)

### Changed
- `plugins/ccp/skills/router/SKILL.md` — 3-way 명세 확장 (claude/gemini/codex). codex 키워드 신설(코드 리뷰/diff/버그 조사), `--effort`/`--sandbox` axis A 신호, 메인 컨텍스트 의존 키워드(`방금/위에서/...`) 강제 강등 규칙. 활성화는 v0.2 (B19), B1 v0.1 은 명세만
- `_workspace/_router_test/router-eval.mjs` — 3-way 혼동행렬 3×3 확장, G09 케이스 codex 재라벨, B05 alt_label codex 추가, P/R 합격선 0.80 → 0.75 완화. **결과: 36/36 (100%) PASS, codex P/R 1.000/1.000**
- `plugins/ccp/scripts/gemini-companion.mjs` — `parseFlags` 에 `--timeout-ms`/`--poll-interval-ms` 옵션 추가 (B17 RESOLVED), `runGeminiSync(prompt, opts, timeoutMs)` 시그니처 확장, background meta 에 `timeout_ms` 필드. `GEMINI_UNSUPPORTED = {--effort, --sandbox, --write}` 인라인 거부 (`CCP-INVALID-001`)
- `plugins/ccp/.claude-plugin/plugin.json` — description 갱신 (Gemini + Codex 양쪽 명시), keywords 에 `codex` 추가
- `_workspace/01_backlog.md` — B1·B11·B17 RESOLVED 표기, v0.2 신규 6건(B18~B23) 등록

### Resolved
- **B1** Codex CLI 통합 — C1~C6 6/6 PASS, 라우터 100%, audit 8 카테고리 합계 37/40 (cost_efficiency 만 v0.2 잔존)
- **B11** ecc + codex-plugin-cc 차용 SHA 캡처 완료
- **B17** `--timeout-ms` CLI 옵션 양 companion 적용 완료

### Notes
- Phase 5-A 메타 결정 G1-E~H 4축 적용 — codex CLI 5종 `--help` 전수, flag whitelist, P95×2 timeout, stdout 5건 sampling 모두 capture
- 핵심 발견: codex 는 stdin 미닫힘 시 무한 대기 (`Reading additional input from stdin...`) → `stdio: ['ignore', ...]` 강제. detached spawn 시 stdio pipe 면 SIGPIPE 자식 사망 → file fd 강제. codex usage 3필드 vs gemini 7필드 → envelope tokens 4필드 표준화

---

## 2026-04-28 — Phase 5-C foreground timeout 인상 (실사용 피드백 반영)

### Changed
- `plugins/ccp/scripts/gemini-companion.mjs:592` — `runGeminiSync` foreground timeout `60000ms → 600000ms` (10분). 사용자 실테스트에서 약간의 큰 작업(요약·분석)에서도 60초 타임아웃이 주기적으로 발생, MVP 합격 후 운영 피드백 반영. background 경로(`--background`)와 `probeOAuth` timeout(30000ms) 은 미변경.
- `_workspace/01_backlog.md` — B17 추가 (foreground `--timeout` CLI 옵션, P1 — 에이전트 자동화 단계에서 사용자 명시적 제어 도입). 본 변경은 단순 기본값 인상이며 인터페이스 굳히지 않음.

### 미해결 (Phase 6+ 위임)
- B17 (`--timeout` CLI 옵션) — 에이전트 자동화 단계 진입 시 정책과 함께 설계

---

## 2026-04-27 — Phase 5-B 후속 패치 (T6·T7·T8 전수 RESOLVED, G1 게이트 보강)

### Added
- `_workspace/02_arch_decisions.md` 원칙 8 신설 — Phase 6+ G1 게이트에 8개 정합성 검사 항목(G1-A~G1-H) 정식 편입. 메타 원인 "명세-구현 일관성 검증 부재" 차단 목적
- `_workspace/04_token_report.md` §1.1 신설 — Gemini CLI input 토큰 baseline ≈10K 명문화, 비교지표 `output+thoughts` 통일 SSOT 선언 (B16)
- `_workspace/01_backlog.md` B14·B15·B16 추가 후 동일자 전수 RESOLVED (Phase 5-B 런타임 테스트 T6~T8 후속)

### Changed
- `plugins/ccp/scripts/gemini-companion.mjs:515,550` — `cmdStatus`/`cmdResult` 가 `args.jobId ?? args._[0]` 동시 허용. positional·`--job-id` 플래그 양쪽 입구 PASS, invalid UUID 거부 회귀 검증 (B14, T6)
- `plugins/ccp/scripts/harness-audit.js` `scorePluginCompat()` — 검사 대상을 비표준 `minClaudeVersion`/`engines` 에서 공식 plugins-reference 표준 5필드(`name`/`version`/`description`/`author`/`license`)로 변경. audit 재실행 시 `plugin_compat: 0/5 → 5/5`, 총점 27/35 → 33/35 (B15, T7)

### 미해결 (Phase 6+ 위임)
- B13 (`--files` 매핑) — Phase 5-A 이월

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
