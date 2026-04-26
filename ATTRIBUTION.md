# Third-Party Attribution

CCP (Claude Control Plane) 는 다음 오픈소스 프로젝트의 코드·패턴을 차용하거나 참조한다. 본 문서는 license-checklist L4 의무사항을 충족한다.

---

## 1. Borrowed (차용 — 코드 사본 포함)

### 1.1 everything-claude-code (ecc)

- **출처:** https://github.com/affaan-m/everything-claude-code
- **저작권:** © affaan-m (2025–)
- **라이선스:** MIT
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

## 2. Inspired By (구조·패턴 참조 — 코드 차용 없음)

### 2.1 codex-plugin-cc

- **출처:** https://github.com/openai/codex-plugin-cc
- **저작권:** © OpenAI
- **라이선스:** MIT
- **참조 범위:** 플러그인 디렉토리 구조 (`plugins/<name>/{commands,agents,scripts,hooks,skills}/`), companion 스크립트 패턴 (서브커맨드 스타일 디스패치), envelope 응답 형식. 코드 사본은 포함하지 않음.

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

## 6. 변경 이력

| 날짜 | 변경 |
|------|------|
| 2026-04-26 | 초판 (S4-8) — ecc 차용 3개·codex-plugin-cc 참조 1개·런타임 2개 |
