# Dev-Only Rule — No Internal Tracking IDs in Public Surface

**범위:** 본 프로젝트 (claude-control-plane) 의 dev 환경 전용 룰. CCP 플러그인 자체에는 추가하지 않는다 (사용자 명시 2026-05-05).

**적용 우선순위:** Claude 가 본 레포에서 코드/문서 작성·수정 시 본 룰을 강제 준수한다. 위반 시 즉시 자체 수정.

---

## 0. 룰 도입 배경

본 dev 레포의 `_workspace/` 추적 시스템은 작업자(=KBK) 가 백로그·게이트·실측·결정을 단일 SSOT 로 관리하는 사적 도구다. 그러나 v0.2.0 작업 흐름에서 이 추적 ID 들이 **공개 대상 코드/문서 주석에 박혀 있어** 외부 사용자/컨트리뷰터가 의미를 추론할 수 없는 상태가 발견되었다 (`plugins/ccp/hooks/router-suggest.js` 한 파일에서만 10건+).

본 룰은 향후 작업에서 동일 누출이 발생하지 않도록 차단하는 사전 가드다.

---

## 1. 차단 대상 식별자 (정규식 패턴)

다음 패턴은 **공개 대상 표면 (Public Surface)** 에 절대 작성/추가하지 않는다.

### 1.1 백로그·게이트·실측 ID
| 카테고리 | 패턴 (regex) | 예시 |
|---------|------------|------|
| 백로그 ID | `\bB\d{1,3}(-\d+)?\b` | `B1`·`B19`·`B24-3`·`B25` |
| Step ID | `\bStep \d+\b` (단, 수치 의미가 아닐 때) | `Step 0`·`Step 4` |
| 게이트 ID | `\bG-?B?\d+(-\d+)?\b`·`\bG\d+(-[A-Z])?\b` | `G1`·`G3`·`G-B24-3`·`G1-A` |
| 합격 기준 ID | `\bAC-?\d+(-[A-Z]\d*)?\b` | `AC-1`·`AC-9`·`AC-B24-4` |
| 실측 ID | `\bU\d+-[A-Z]\b` | `U7-A`·`U7-B`·`U7-C` |
| BLOCKER ID | `\bB-\d+\b` (검수 BLOCKER) | `B-1`·`B-2` |
| 결정 ID | `\bD\d+(-[A-Z])?\b`·`\bQ-B\d+-\d+\b`·`\bR\d+\b` | `D1`·`D5-A`·`Q-B24-1`·`R1` |
| 트러블 ID | `\bT\d+(-[a-z])?\b`·`\bC\d+\b`·`\bN\d+(-\d+)?\b`·`\bW\d+\b`·`\bX\d+\b`·`\bF\d+\b` | `T1~T8`·`C1~C10`·`N6`·`W4`·`X01`·`F16` |
| 단계 ID | `\bPhase \d+(-[A-Z])?\b`·`\bS\d+(-\d+(-[A-Z]+)?)?\b` | `Phase 5-A`·`S1-3-RT` |
| 원칙 번호 | `Principle \d+`·`원칙 \d+` (외부 인용 없이 단독 등장) | `Principle 4 §4.1` |

### 1.2 워크스페이스 경로 참조
| 패턴 | 차단 사유 |
|------|---------|
| `_workspace/...` | dev 전용, public 미동기화 |
| `보고서/...` | dev 전용 |
| `연구노트/...` | dev 전용 |
| `_workspace_archive_*/...` | dev 전용 |

### 1.3 검수 결과 인용
- `architecture-reviewer` · `license-auditor` · `harness-qa` 등 dev 하네스 에이전트 결과 인용
- `_workspace/0X_*_review.md` · `_workspace/0X_*_verdict.md` 직접 참조

---

## 2. 보존 가능 식별자 (외부에서도 의미 유효)

다음은 **차단 대상 아님** — 공개 표면에 등장 가능.

| 카테고리 | 예시 | 보존 사유 |
|---------|------|---------|
| 사용자 노출 에러 코드 | `CCP-ROUTER-001`·`CCP-META-WARN`·`CCP-INVALID-001`·`CCP-CTX-001` | 사용자 메시지 SSOT |
| 차용처 명시 | `ecc`·`omc`·`codex-plugin-cc`·`Apache-2.0`·`MIT` | Attribution 의무 |
| 기능명 | `auto_routing`·`canonical`·`headless`·`opt-in`·`opt-out` | 기능 의미 |
| 외부 문서 표준 | `JSON Schema draft-2020-12`·`UUIDv4`·`POSIX` | 표준 명세 |
| 버전·태그 | `v0.1.0`·`v0.2.0`·`v0.38.x` | 릴리스 표식 |
| Runtime 디스크 경로 | `_workspace/_jobs/`·`_workspace/_audits/`·`_workspace/_probe/` | companion·audit 가 사용자 호스트에 쓰는 실제 경로. `.gitignore` 차단으로 공개 레포 추적 0. result_path 안내·테스트 산출물 위치 설명에 사용 |
| 회귀 테스트 디렉터리 | `_workspace/_router_test/` | router 회귀 데이터셋·하니스 디렉터리. CI 가 실행하므로 git 추적 (`.gitignore` 예외). PR 체크리스트·workflow 에 명시적으로 등장. |
| 옵시디언 문서화 config | `.obsidian-doc.local.json` | 옵시디언 vault 설정 SSOT (vault path·차단 패턴 시드·치환 사전 path 등). dev 전용 — `.gitignore` 차단으로 공개 레포 추적 0. 변환 시점 가드 SSOT (작성 시점 가드 = 본 룰 §1 과 분리). |

---

## 3. 적용 대상 파일 (Public Surface)

### 3.1 강제 준수 (룰 차단)
- `plugins/ccp/scripts/**/*.mjs` (companion·router·lib)
- `plugins/ccp/scripts/**/*.js` (hooks·audit)
- `plugins/ccp/agents/*.md`
- `plugins/ccp/commands/*.md`
- `plugins/ccp/skills/**/SKILL.md`
- `plugins/ccp/schemas/*.json`
- `plugins/ccp/.claude-plugin/plugin.json`
- `plugins/ccp/hooks/*.{js,mjs,json}`
- `README.md` · `CHANGELOG.md` · `CONTRIBUTING.md` · `LICENSE` · `NOTICE` · `ATTRIBUTION.md`
- `docs/{en,ko}/*.md`
- `.github/**/*.{yml,md}`
- `tests/**` — 회귀·계약·격리 검사 스크립트와 fixture. prod 레포에 포함되는 공개 표면 (2026-08-30 추가)

### 3.2 룰 제외 (dev 추적 본진)
- `_workspace/**` — 작업자 SSOT, 식별자 자유 사용
- `_workspace_archive_*/**` — 아카이브
- `CLAUDE.local.md` — dev 로컬 컨텍스트, 식별자 자유
- `.claude/rules/**` — 본 룰 자체 포함
- `보고서/` · `연구노트/` — dev 참고 자료

---

## 4. 위반 시 처리

### 4.1 작성 시점 (사전 차단)
Claude 는 §3.1 적용 대상 파일에 §1 차단 패턴을 **작성하지 않는다**. 외부 사용자가 의미를 추론할 수 없는 작업자 전용 ID 는 다음 중 하나로 치환한다:

| 원안 | 치환 예시 |
|------|---------|
| `// B24 — multi-signal OR` | `// Multi-signal headless detection (canonical/headless dispatch)` |
| `// B19 + B24 W4 split-responsibility` | `// Hook recommends · agent dispatches (split responsibility)` |
| `// U7-B finding — always null inside hook` | `// process.stdin.isTTY is always null inside hook child process` |
| `// B21-3 (2026-05-03) — warn against meta-bypass` | `// Warn against meta-bypass when headless automation is suspected` |
| `Principle 4 §4.1` | `the auto-routing opt-in policy (see CONTRIBUTING.md)` 또는 인접 1줄 설명 |

### 4.2 수정 시점 (위반 발견)
Claude 는 §3.1 파일에서 §1 패턴을 발견하면 즉시 사용자에게 알리고 §4.1 치환 패턴 제안. 사용자 승인 후 일괄 치환.

### 4.3 사용자 명시 예외
사용자가 명시적으로 "ID 보존" 을 요청하면 본 룰을 그 작업 범위 내에서 보류한다. 단 보류 사유를 기록해야 한다.

---

## 5. 룰 강제 메커니즘

### 5.1 1단계 — Claude 자율 준수 (현재 활성)
본 문서 텍스트가 Claude 룰로 로드됨. Claude 가 §3.1 파일 작성·수정 시 §1 패턴을 자율 회피.

### 5.2 2단계 — PreToolUse 훅 (선택, 미적용)
필요 시 dev 환경에 PreToolUse 훅 추가하여 Edit/Write 도구 호출 직전 §1 패턴 검사. 위반 시 차단.

### 5.3 3단계 — Pre-commit / CI 게이트 (선택, 미적용)
필요 시 `.husky/pre-commit` 또는 dev 레포 CI 에 grep 검사 추가. 본 룰은 dev 레포에만 적용 (public 레포 CI 는 §3.1 표면 자체가 깨끗하므로 검사 불요).

---

## 6. 변경 이력

| 날짜 | 변경 | 사유 |
|------|------|------|
| 2026-05-05 | 초안 작성 | 사용자 지시: "작업자만 알면 되는 내용들은 룰로 지정해서 주석으로 추가 못하도록 지정", "이것은 dev 용 룰이므로 ccp 에 추가할 필요 없음". `_workspace/`·`CLAUDE.local.md` 제외 + `plugins/ccp/**` 와 공개 문서 강제 준수. 1단계 (Claude 자율 준수) 만 즉시 활성, 2·3단계는 필요 시 추가. |
| 2026-05-05 | §2 보존 대상에 "Runtime 디스크 경로" 행 추가 (`_workspace/_jobs/`·`_workspace/_audits/`·`_workspace/_probe/`) | Public Surface Cleanup 진행 중 분기점. companion 이 background job 결과를 사용자 호스트 로컬에 쓰는 실제 디렉터리 경로 — `.gitignore` 차단으로 공개 레포 추적 0. dev 추적 ID 가 아니라 runtime 디스크 경로이므로 외부 사용자 result_path 안내 + 테스트 산출물 위치 설명에 보존 가능. dev 추적 문서 인용 (`_workspace/01_backlog.md`·`02_arch_decisions.md` 등) 만 차단 대상으로 좁힘. |
| 2026-05-08 | §1 정규식 13건을 `.obsidian-doc.local.json` 의 `blocked_patterns` 로 1회 복사 (변환 시점 가드 SSOT 분리). 본 룰은 작성 시점 가드 (strict block), config 는 변환 시점 가드 (interactive replacement). §2 보존 대상에 `.obsidian-doc.local.json` 행 추가. | 옵시디언 문서화 변환 시 외부 노출 방지. 향후 §1 변경 시 config 도 수동 동기화 필요 (drift 검사 미래 옵션). |
| 2026-08-30 | §3.1 강제 준수 목록에 `tests/**` 추가 | 서브에이전트 출구 측 회귀 기준 런의 라이선스 검수가 지적: `tests/` 는 prod 레포에 포함되는 공개 표면인데 §3.1 에 명시되어 있지 않아 보수적 적용에 의존하고 있었다. 사용자 승인(G1, 2026-08-30) 후 명시. fixture 디렉터리·`tests/README.md`·검사 스크립트 주석에 §1 패턴 작성 금지. |
