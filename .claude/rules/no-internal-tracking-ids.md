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
| Step ID | `\bStep \d+\b` (단, 수치 의미가 아닐 때) — **작성 시점 가드 전용 (CI 미적용)** | `Step 0`·`Step 4` |
| 게이트 ID | `\bG-?B?\d+(-\d+)?\b`·`\bG\d+(-[A-Z])?\b` | `G1`·`G3`·`G-B24-3`·`G1-A` |
| 합격 기준 ID | `\bAC-?\d+(-[A-Z]\d*)?\b` | `AC-1`·`AC-9`·`AC-B24-4` |
| 실측 ID | `\bU\d+-[A-Z]\b` | `U7-A`·`U7-B`·`U7-C` |
| BLOCKER ID | `\bB-\d+\b` (검수 BLOCKER) | `B-1`·`B-2` |
| 결정 ID | `\bD\d+(-[A-Z])?\b`·`\bQ-B\d+-\d+\b`·`\bR\d+\b` | `D1`·`D5-A`·`Q-B24-1`·`R1` |
| 트러블 ID | `\bT\d+(-[a-z])?\b`·`\bC\d+\b`·`\bN\d+(-\d+)?\b`·`\bW\d+\b`·`\bX\d+\b`·`\bF\d+\b` | `T1~T8`·`C1~C10`·`N6`·`W4`·`X01`·`F16` |
| 단계 ID | `\bPhase \d+(-[A-Z])?\b`·`\bS\d+(-\d+(-[A-Z]+)?)?\b` | `Phase 5-A`·`S1-3-RT` |
| 원칙 번호 | `Principle \d+`·`원칙 \d+` (외부 인용 없이 단독 등장) — **작성 시점 가드 전용 (CI 미적용)** | `Principle 4 §4.1` |

> **두 패턴이 CI 게이트에서 제외되는 이유**: 두 패턴의 한정 조건 ("외부 인용 없이 단독 등장"·"수치 의미가 아닐 때") 은 자연어 판단이라 정규식으로 표현할 수 없다. 기계 검사에 넣으면 정당한 인용까지 위반으로 잡히고, 이를 예외로 풀면 예외 목록이 곧 허용 목록이 된다. 따라서 룰 (사람이 지키는 규범) 에는 남기고 CI 게이트에서만 제외한다.

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
| 감사 대상 리포트 경로 | `_workspace/04_router_report.md`·`_workspace/04_token_report.md` | harness-audit 라우터 감사 카테고리가 존재 여부를 검사하는 리포트 경로 (`plugins/ccp/scripts/harness-audit.js`). 파일 자체는 `_workspace/` 블랭킷 `.gitignore` 차단으로 공개 레포 추적 0 — CI 는 seed 파일을 생성해 검사를 통과시킨다 (`.github/workflows/ci.yml`). runtime 디스크 경로와 같은 성격이므로 경로 문자열의 공개 표면 등장을 보존. |

---

## 3. 적용 대상 파일 (Public Surface)

> **전제 갱신 (2026-09-07):** dev 레포와 공개 레포가 단일 공개 레포로 통합되면서, git 이 추적하는 파일은 전부 공개된다. 따라서 §3.2 의 의미는 **"비공개 보장"이 아니라 "§1 패턴 작성 허용"** 이다. `.claude/**` 와 `CLAUDE.md` 는 추적되어 공개되지만, 하네스 본진이므로 §1 패턴 작성은 계속 허용한다 (사용자 결정: 추적 ID 노출을 감수하고 공개). 반면 `_workspace/**`·`_workspace_archive_*/**`·`CLAUDE.local.md` 는 `.gitignore` 로 미추적이므로 실제로 미공개 상태다. `보고서/`·`연구노트/` 는 디스크에 실체가 없어 목록에서 제거했다.
>
> 아래 두 목록은 CI 잡 `guard-public-surface` 가 소비하는 `tools/repo-guard.patterns.json` 의 `scope`·`exclude` 배열과 **문자열 집합으로 일치해야 한다.** 한쪽만 바꾸면 메타 일치 검사가 실패한다.

### 3.1 강제 준수 (룰 차단)

```
plugins/**
docs/**
README.md
README.en.md
CHANGELOG.md
CONTRIBUTING.md
LICENSE
LICENSES/**
.github/**
tests/**
tools/repo-guard.mjs
```

- `tests/**` — 회귀·계약 검사 스크립트와 fixture. 공개 표면이다 (2026-08-30 추가).
- `tools/repo-guard.mjs` — 가드 스크립트 본체. 추적·공개되므로 스캔 대상으로 남긴다 (2026-09-07 추가).
- 목록은 디렉터리 단위 (`plugins/**`·`docs/**`) 로 적는다. 확장자별로 좁게 적으면 새 파일 형식이 조용히 검사 밖으로 빠진다.
- `.gitignore` 는 이 목록에 넣지 않는다. ignore 규칙 파일의 본문이 곧 ignore 대상 경로 문자열이라 §1.2 를 적용하면 원리적으로 통과할 수 없다. 대신 §1.1 패턴만 단일화 작업 시점에 1회 검사했다.
- 트리에 실재하지 않는 `NOTICE`·`ATTRIBUTION.md` 는 목록에서 제거했다 (실재하는 것은 `LICENSES/codex-plugin-cc-NOTICE.txt` 뿐이다).

### 3.2 룰 제외 (추적되나 §1 패턴 작성 허용)

```
_workspace/**
_workspace_archive_*/**
CLAUDE.local.md
CLAUDE.md
.claude/**
tools/repo-guard.patterns.json
```

- `_workspace/**`·`_workspace_archive_*/**`·`CLAUDE.local.md` — `.gitignore` 미추적. 작업자 SSOT 이며 식별자를 자유롭게 쓴다.
- `.claude/**` — 하네스 본진. 추적되어 공개되나 §1 패턴 작성은 허용한다. 본 룰 파일 자체도 여기에 속한다.
- `CLAUDE.md` — 프로젝트 하네스 트리거. 종전에는 §3.1 에도 §3.2 에도 없어 판정이 모호했다 (2026-09-07 명시).
- `tools/repo-guard.patterns.json` — §1 패턴 정의를 담는 데이터 파일. §3.1 을 적용하면 자기모순이 되므로 제외한다. 스크립트 본체는 §3.1 대상으로 남는다.

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

### 5.3 3단계 — Pre-commit / CI 게이트 (**활성**, 2026-09-07)
CI 잡 `guard-public-surface` (`.github/workflows/ci.yml`) 가 매 push·PR 에서 §3.1 목록에 §1.1·§1.2·§1.3 패턴 검사를 실행한다. 구현은 `tools/repo-guard.mjs public-surface`, 패턴 정의는 `tools/repo-guard.patterns.json` 이다. 같은 스크립트를 `.githooks/pre-commit` 이 스테이징 목록에 대해 먼저 실행하므로 위반은 대개 커밋 시점에 잡힌다.

- 로컬 git 훅은 `node tools/repo-guard.mjs bootstrap` 을 1회 실행해야 활성화되고 `--no-verify` 로 우회할 수 있다. **강제력이 있는 것은 CI 쪽뿐이다.**
- §1.1 의 `Step \d+`·`Principle \d+`(`원칙 \d+`) 두 패턴은 이 검사에서 제외된다 (§1.1 표 아래 사유 참조). CI 가 소비하는 패턴은 11 종이다.
- `.gitignore` 는 검사 범위에서 제외된다 (§3.1 부기 참조).

---

## 6. 변경 이력

| 날짜 | 변경 | 사유 |
|------|------|------|
| 2026-05-05 | 초안 작성 | 사용자 지시: "작업자만 알면 되는 내용들은 룰로 지정해서 주석으로 추가 못하도록 지정", "이것은 dev 용 룰이므로 ccp 에 추가할 필요 없음". `_workspace/`·`CLAUDE.local.md` 제외 + `plugins/ccp/**` 와 공개 문서 강제 준수. 1단계 (Claude 자율 준수) 만 즉시 활성, 2·3단계는 필요 시 추가. |
| 2026-05-05 | §2 보존 대상에 "Runtime 디스크 경로" 행 추가 (`_workspace/_jobs/`·`_workspace/_audits/`·`_workspace/_probe/`) | Public Surface Cleanup 진행 중 분기점. companion 이 background job 결과를 사용자 호스트 로컬에 쓰는 실제 디렉터리 경로 — `.gitignore` 차단으로 공개 레포 추적 0. dev 추적 ID 가 아니라 runtime 디스크 경로이므로 외부 사용자 result_path 안내 + 테스트 산출물 위치 설명에 보존 가능. dev 추적 문서 인용 (`_workspace/01_backlog.md`·`02_arch_decisions.md` 등) 만 차단 대상으로 좁힘. |
| 2026-05-08 | §1 정규식 13건을 `.obsidian-doc.local.json` 의 `blocked_patterns` 로 1회 복사 (변환 시점 가드 SSOT 분리). 본 룰은 작성 시점 가드 (strict block), config 는 변환 시점 가드 (interactive replacement). §2 보존 대상에 `.obsidian-doc.local.json` 행 추가. | 옵시디언 문서화 변환 시 외부 노출 방지. 향후 §1 변경 시 config 도 수동 동기화 필요 (drift 검사 미래 옵션). |
| 2026-08-30 | §3.1 강제 준수 목록에 `tests/**` 추가 | 서브에이전트 출구 측 회귀 기준 런의 라이선스 검수가 지적: `tests/` 는 prod 레포에 포함되는 공개 표면인데 §3.1 에 명시되어 있지 않아 보수적 적용에 의존하고 있었다. 사용자 승인(G1, 2026-08-30) 후 명시. fixture 디렉터리·`tests/README.md`·검사 스크립트 주석에 §1 패턴 작성 금지. |
| 2026-08-31 | §2 보존 대상에 "감사 대상 리포트 경로" 행 추가 (`_workspace/04_router_report.md`·`_workspace/04_token_report.md`) | 출구 측 격리 하니스 런의 인계 사항 해소. `harness-audit.js:162` 와 `ci.yml:107·132·134` 에 이 경로가 이미 등장하는데, §1.2 `_workspace/...` 패턴에 형식상 걸리면서 §2 예외로 등재되어 있지 않았다. 감사가 사용자 호스트에서 실제로 읽는 runtime 성격의 경로이고 파일 자체는 `.gitignore` 로 추적 0 이므로 보존 대상으로 확정. |
| 2026-09-07 | 단일 공개 레포 전환 반영. (ㄱ) §2 보존 표에서 `.obsidian-doc.local.json` 행 삭제 — 파일이 삭제되어 "변환 시점 가드 SSOT" 근거가 소멸. (ㄴ) §3 전제 갱신 — 추적 = 공개이므로 §3.2 의 의미를 "비공개 보장"에서 "§1 패턴 작성 허용"으로 재정의. (ㄷ) §3.2 제외 목록을 `.claude/rules/**` 에서 `.claude/**` 로 확장하고 `CLAUDE.md`·`tools/repo-guard.patterns.json` 추가. (ㄹ) §3.1 목록을 CI 검사 범위와 1:1 로 정렬 — 실재하지 않는 `NOTICE`·`ATTRIBUTION.md` 제거, `README.ko.md`·`tools/repo-guard.mjs` 추가, `.gitignore` 미포함. (ㅁ) §1.1 의 `Step`·`Principle` 두 패턴에 CI 미적용 표시와 사유 기록. (ㅂ) §5.3 을 미적용에서 활성으로 전환. | dev 레포와 공개 레포를 하나로 합치면서 `.claude/**`·`CLAUDE.md`·`tests/**` 가 공개 대상이 되었다. 사용자 결정으로 하네스 추적 ID 노출은 감수하되, 룰이 스스로 말하는 전제를 사실과 맞추고 룰 목록과 기계 검사의 범위를 일치시켰다. |
| 2026-09-26 | §3.1 목록의 `README.ko.md` 를 `README.en.md` 로 교체 | 문서 메인 언어를 한국어로 전환하면서 `README.md` 가 한국어판, `README.en.md` 가 영어 번역본이 되었다. `tools/repo-guard.patterns.json` 의 scope 도 같은 커밋에서 맞췄다. |
