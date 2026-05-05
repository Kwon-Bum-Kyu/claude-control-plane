# Third-Party Attribution

CCP (Claude Control Plane) 는 다음 오픈소스 프로젝트의 코드·패턴을 차용하거나 참조한다. 본 문서는 license-checklist L4 의무사항을 충족한다.

---

## 1. Borrowed (차용 — 코드 사본 포함)

### 1.1 everything-claude-code (ecc)

- **출처:** https://github.com/affaan-m/everything-claude-code
- **저작권:** © affaan-m (2025–)
- **라이선스:** MIT
- **Source commit:** `c7c7d37f2946d7497577408d19adaee6a8341ddc` (HEAD, snapshot 2026-04-30)
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

### 1.5 oh-my-claudecode (omc) — 매직 키워드 패턴 차용

- **출처:** https://github.com/Yeachan-Heo/oh-my-claudecode
- **저작권:** © Yeachan Heo (2025)
- **라이선스:** MIT (copyright preservation 의무)
- **Source commit:** `1e9f197bcc85602da87ad35b18d908a0575b8583`
- **Source file:** `src/features/magic-keywords.ts`
- **차용 결정:** 라우터 키워드 매칭 false positive 차단을 위한 패턴 프리미티브 5개만 차용. omc 의 enhancement action (ultrawork·search·analyze·ultrathink) 은 차용 범위 외.
- **차용 위치:** `plugins/ccp/scripts/lib/magic-keywords.mjs` (단일 파일)
- **차용 함수 5개 + 상수 2개:**

| 차용 식별자 | 종류 | 원본 위치 | 변경 사항 |
|------------|------|----------|----------|
| `removeCodeBlocks(text)` | 함수 | `magic-keywords.ts:20-22` | TS → JS, 로직 1:1 |
| `escapeRegExp(s)` | 함수 | `magic-keywords.ts:42-44` | TS → JS, 로직 1:1 |
| `hasActionableTrigger(text, trigger)` | 함수 | `magic-keywords.ts:46-62` | TS → JS, 로직 1:1 |
| `isInformationalKeywordContext(text, position, len)` | 함수 | `magic-keywords.ts:32-37` | TS → JS, 로직 1:1 |
| `INFORMATIONAL_INTENT_PATTERNS` | regex 배열 | `magic-keywords.ts:24-29` | 4개 패턴 (EN+KO+JA+ZH) 1:1 |
| `INFORMATIONAL_CONTEXT_WINDOW` | 상수 | `magic-keywords.ts:30` | 80 1:1 |
| `CODE_BLOCK_PATTERN`, `INLINE_CODE_PATTERN` | regex | `magic-keywords.ts:14-15` | 1:1 |

- **변경 범위:**
  1. TypeScript 타입 어노테이션 제거 (런타임 동작 동일)
  2. ES Module export 변환 (named export 6종)
  3. JSDoc 한 줄 보존
- **CCP 통합 지점:** `plugins/ccp/scripts/lib/router.mjs` 가 `hasActionableTrigger`·`removeCodeBlocks` 를 import 하여 4축 알고리즘 axis C (키워드 매칭) 에서 사용.
- **회귀 검증:** 스모크 테스트 5/5 + 70-case router regression suite 100% PASS.

### 1.6 MIT 라이선스 원문 (omc 적용)

```
MIT License

Copyright (c) 2025 Yeachan Heo

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

### 1.3 codex-plugin-cc (Codex 통합 — 함수 단위 차용)

- **출처:** https://github.com/openai/codex-plugin-cc
- **저작권:** © OpenAI
- **라이선스:** Apache-2.0 (NOTICE 의무 발생 — `NOTICE` 파일 동봉)
- **Source commit:** `8e873d6f40511aa7d8081623d0b66804b7301de6` (refs/heads/release/v1.0.4, snapshot 2026-04-30)
- **차용 방식:** 함수 단위 차용 (5 파일을 `plugins/ccp/scripts/lib/codex-*.mjs` 로 평탄화)
- **차용 파일 및 변경 내역:** §6 표 참조

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

(현재 비어 있음. codex-plugin-cc 는 함수 단위 차용으로 §1.3 에 별도 등재.)

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

## 5. 스냅샷 추적성

차용 코드는 본 문서 §1 의 SHA, `NOTICE` 파일, `README` References 절의 3중 신호로 추적된다. 파일별 5필드 헤더는 v0.2.0 에서 제거되었으며 attribution 의무는 본 SSOT 가 단독 충족한다.

---

## 6. codex-plugin-cc 차용 파일 표 (함수 단위)

모든 차용 파일은 `plugins/ccp/scripts/lib/codex-*.mjs` 평탄화 레이아웃에 위치한다. 라이선스 의무는 본 표 + `NOTICE` + `README` References 절의 3중 신호로 충족.

| CCP 경로 | codex-plugin-cc 원본 | 라이선스 | Source SHA | 수정 범위 |
|---|---|---|---|---|
| `plugins/ccp/scripts/lib/codex-state.mjs` | `plugins/codex/scripts/lib/state.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | 영문 에러 메시지, `_workspace/_jobs/` 경로 통일, `mode:"codex"` 메타 필드 |
| `plugins/ccp/scripts/lib/codex-tracked-jobs.mjs` | `plugins/codex/scripts/lib/tracked-jobs.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | `CLAUDE_SESSION_ID` env var 필터, `codex resume --last` fallback 추가 |
| `plugins/ccp/scripts/lib/codex-process.mjs` | `plugins/codex/scripts/lib/process.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | file fd stdio 강제 (pipe 시 SIGPIPE 회피), `stdin: 'ignore'` 강제 |
| `plugins/ccp/scripts/lib/codex-args.mjs` | `plugins/codex/scripts/lib/args.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | `--timeout-ms` / `--poll-interval-ms` 옵션화 |
| `plugins/ccp/scripts/lib/codex-job-control.mjs` | `plugins/codex/scripts/lib/job-control.mjs` | Apache-2.0 | `8e873d6f40511aa7d8081623d0b66804b7301de6` | enqueue/dequeue/cancel 통합 인터페이스, envelope 6키 통합 |

**audit 강제:** `plugins/ccp/scripts/harness-audit.js` 의 `scoreBorrowedCodeDocumented()` 가 본 표의 6 차용 파일 경로 (codex 5 + omc 1) 가 ATTRIBUTION.md 에 모두 등재되어 있는지 검사 — 누락 시 `borrowed_code_documented` 카테고리 감점.

---

## 7. 변경 이력

| 날짜 | 변경 |
|------|------|
| 2026-04-26 | 초판 — ecc 차용 3개·codex-plugin-cc 참조 1개·런타임 2개 |
| 2026-04-30 | ecc Source SHA 캡처 (`c7c7d37f...`), codex-plugin-cc 를 §1.3 함수 단위 차용으로 승격 (Apache-2.0), §6 차용 파일 표 신설 (5 파일, SHA `8e873d6f...`) |
| 2026-05-04 | omc 매직 키워드 패턴 차용 추가 (§1.5, MIT, SHA `1e9f197b...`) |
| 2026-05-05 | codex_adapted SHA-of-this-adaptation 필드 채움 (`11f0aaf6...`), omc adaptation SHA 채움 (`c0cca1e0...`) |
| 2026-05-05 | 폴더 평탄화 (`lib/codex_adapted/` → `lib/codex-*.mjs`, `lib/omc_adapted/magic-keywords.mjs` → `lib/magic-keywords.mjs`). 파일별 5필드 헤더 제거. attribution 은 ATTRIBUTION.md + NOTICE + README References 3중 신호로 충족. audit 카테고리 `adapted_headers` → `borrowed_code_documented` 재설계 |
