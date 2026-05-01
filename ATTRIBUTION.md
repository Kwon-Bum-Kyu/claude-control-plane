# Third-Party Attribution

CCP (Claude Control Plane) 는 다음 오픈소스 프로젝트의 코드·패턴을 차용하거나 참조한다. 본 문서는 license-checklist L4 의무사항을 충족한다.

---

## 1. Borrowed (차용 — 코드 사본 포함)

### 1.1 everything-claude-code (ecc)

- **출처:** https://github.com/affaan-m/everything-claude-code
- **저작권:** © affaan-m (2025–)
- **라이선스:** MIT
- **Source commit:** `c7c7d37f2946d7497577408d19adaee6a8341ddc` (HEAD, snapshot 2026-04-30 — B11 RESOLVED)
- **차용 파일 및 변경 내역:**

| CCP 경로 | ecc 원본 | 변경 사항 |
|----------|---------|----------|
| `plugins/ccp/hooks/suggest-compact.js` | `hooks/suggest-compact.js` | PreCompact + UserPromptSubmit 양쪽 등록, 자동 `/compact` 트리거 제거(원칙 4), 한국어 메시지화 |
| `plugins/ccp/skills/context-budget/SKILL.md` | `skills/strategic-compact/SKILL.md` | 50/75/90% 임계 안내, `CCP-COMPACT-001` 코드 적용 |
| `plugins/ccp/scripts/harness-audit.js` | `scripts/harness-audit.js` | 7카테고리 루브릭 → CCP 워크로드(envelope/router/secret_leak 등)로 재조정 |

### 1.2 MIT 라이선스 원문 (ecc 적용)

```
MIT License

Copyright (c) affaan-m

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### 1.3 codex-plugin-cc (B1 Codex 통합 — 함수 단위 차용)

- **출처:** https://github.com/openai/codex-plugin-cc
- **저작권:** © OpenAI
- **라이선스:** Apache-2.0 (NOTICE 의무 발생 — `NOTICE` 파일 동봉)
- **Source commit:** `8e873d6f40511aa7d8081623d0b66804b7301de6` (refs/heads/release/v1.0.4, snapshot 2026-04-30)
- **차용 결정:** B1-PRE 결정 #2 옵션 B — 함수 단위 차용 + `lib/codex_adapted/` 격리 + 헤더 5필드 의무
- **차용 파일 및 변경 내역:** §6 표 참조 (B1-S4-3 마감 시 SHA 확정)

### 1.4 Apache-2.0 라이선스 원문 (codex-plugin-cc 적용)

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

전문은 https://www.apache.org/licenses/LICENSE-2.0.txt 참조.

---

## 2. Inspired By (구조·패턴 참조 — 코드 차용 없음)

(B1 이전: codex-plugin-cc 가 본 절에 있었으나, B1 함수 단위 차용 결정으로 §1.3 으로 승격)

---

## 3. Runtime Dependencies (런타임 의존성 — 번들 없음)

| 패키지 | 라이선스 | 용도 |
|--------|---------|------|
| `@google/gemini-cli` (>=0.38.0) | Apache-2.0 | Gemini CLI 호출 (외부 설치, 번들 없음) |
| Node.js (>=20.0.0) | MIT | 런타임 환경 |

**Apache-2.0 NOTICE 의무**: `@google/gemini-cli` 는 사용자가 별도 설치하는 외부 CLI 이며 본 레포에 번들되지 않으므로 NOTICE 파일 동봉 의무가 발생하지 않는다. 사용자가 해당 패키지를 설치하면 npm 이 원본 NOTICE 를 자동 배포한다.

---

## 4. Trademarks

"Claude", "Claude Code" 는 Anthropic 의 상표이며, "Gemini" 는 Google 의 상표이다. 본 프로젝트는 상호운용성(interoperability) 을 위해 명목적으로(nominative use) 만 상표를 사용하며, Anthropic·Google 과 어떠한 제휴·승인 관계도 없다.

---

## 5. 스냅샷 추적성 (Phase 6+ 보강 권고)

ecc 차용 시점의 원본 커밋 SHA 는 Phase 6+ 에서 다음 형식으로 본 문서와 각 차용 파일 헤더에 기록한다:

```
// Originally from: github.com/affaan-m/everything-claude-code
// Source commit: <SHA>  (snapshot YYYY-MM-DD)
// Original license: MIT (see ATTRIBUTION.md)
```

MVP 시점에는 출처·라이선스만 명시하고, SHA 는 첫 공개 릴리스 직전 수집한다.

---

## 6. codex-plugin-cc 차용 파일 표 (B1 — 함수 단위)

> **상태:** B1-S1-3 사전 안 (SHA 미확정 행은 B1-S4-3 마감 시 채움). 모든 차용 파일은 `plugins/ccp/scripts/lib/codex_adapted/` 에 격리 + 5필드 헤더 의무.

| CCP 경로 | codex-plugin-cc 원본 | 라이선스 | Source SHA | 수정 범위 |
|---|---|---|---|---|
| `plugins/ccp/scripts/lib/codex_adapted/state.mjs` | `plugins/codex/scripts/lib/state.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | 한국어 에러 메시지, `_workspace/_jobs/` 경로 통일, `mode:"codex"` 메타 필드 |
| `plugins/ccp/scripts/lib/codex_adapted/tracked-jobs.mjs` | `plugins/codex/scripts/lib/tracked-jobs.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | `CLAUDE_SESSION_ID` env var 필터, `codex resume --last` fallback 추가 |
| `plugins/ccp/scripts/lib/codex_adapted/process.mjs` | `plugins/codex/scripts/lib/process.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | file fd stdio 강제 (pipe 시 SIGPIPE 회피), `stdin: 'ignore'` 강제 |
| `plugins/ccp/scripts/lib/codex_adapted/args.mjs` | `plugins/codex/scripts/lib/args.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | `--timeout-ms` / `--poll-interval-ms` 옵션화 (B17 동시 적용) |
| `plugins/ccp/scripts/lib/codex_adapted/job-control.mjs` | `plugins/codex/scripts/lib/job-control.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | enqueue/dequeue/cancel 통합 인터페이스, envelope 6키 통합 |

**헤더 의무 (5필드, 모든 파일 상단):**
```js
// Adapted from: codex-plugin-cc plugins/codex/scripts/lib/<file>.mjs
// Source commit: 8e873d6f40511aa7d8081623d0b66804b7301de6 (release/v1.0.4)
// Original license: Apache-2.0 (see ATTRIBUTION.md §1.3, NOTICE)
// Modifications: <파일별 §6 표 "수정 범위" 셀 그대로 복사>
// SHA-of-this-adaptation: <B1 머지 후 git rev-parse HEAD>
```

**audit 강제:** `plugins/ccp/scripts/harness-audit.js` 에 G1-I 검사 추가 (B1-S2-1) — 5 필드 누락 시 `plugin_compat` 카테고리 감점.

---

## 7. 변경 이력

| 날짜 | 변경 |
|------|------|
| 2026-04-26 | 초판 (S4-8) — ecc 차용 3개·codex-plugin-cc 참조 1개·런타임 2개 |
| 2026-04-30 | B1-S1-3 — ecc SHA 캡처 (`c7c7d37f...`, B11 RESOLVED), codex-plugin-cc §1.3 승격 (Apache-2.0), §6 차용 파일 사전 표 신설 (5 파일, SHA `8e873d6f...`) |
