---
name: license-checklist
description: "공개 레포 배포를 위한 라이선스·의존성·비밀 정보 누출 감사 체크리스트 (L1~L9). ecc·codex-plugin-cc 차용 코드 검증. 라이선스 감사·공개 적합성 검토 시 반드시 이 스킬을 사용."
---

# License Checklist — 공개 레포 라이선스·의존성 감사

CCP가 공개 레포(MIT 가정)로 배포될 때 차용·참조한 코드의 라이선스 호환성과 비밀 정보 누출 위험을 검증한다.

## 체크리스트 (L1~L9)

### L1. ecc `suggest-compact.js` 차용
- **차용 범위:** 훅 스크립트 코드
- **검증:**
  - [ ] 원본 MIT 라이선스 헤더 보존
  - [ ] 파일 상단에 출처 코멘트 (`Originally from: github.com/affaan-m/everything-claude-code`)
  - [ ] README "Inspired by / Borrowed from" 섹션에 명시

### L2. ecc `context-budget` 스킬 차용
- 동일 검증 (L1과 같음)

### L3. ecc `harness-audit.js` 차용
- 동일 검증
- 추가: 7카테고리 루브릭이 CCP 워크로드에 맞게 재조정됐는지

### L4. codex-plugin-cc 구조 참조
- **유의:** "구조 참조"는 차용이 아님 (저작권 대상 아님)
- 단, README "Inspired by" 섹션에 명시 (커뮤니티 예의)

### L5. Antigravity CLI 외부 호출
- **유형:** 외부 CLI 런타임 호출 (npm 의존성 아님 — 코드 번들·차용 없음, ATTRIBUTION 대상 아님)
- **검증:**
  - [ ] README에 설치 명령 명시 (`curl -fsSL https://antigravity.google/cli/install.sh | bash`)
  - [ ] 최소 버전 요구 명시 (≥ 1.0.0)
  - [ ] 런타임 외부 호출이므로 라이선스 차용 의무 없음 확인

### L6. Node.js 버전 요구사항
- **검증:**
  - [ ] `package.json`의 `engines.node` 핀 (예: `>=18.0.0`)
  - [ ] README에 명시
  - [ ] CI에서 해당 버전으로 테스트

### L7. Claude Code 플러그인 시스템 버전
- **검증:**
  - [ ] 지원 Claude Code 버전 README 명시
  - [ ] 플러그인 API 변경 시 호환성 테스트 절차 정의

### L8. 비밀 정보 누출 검사
- **검증:**
  - [ ] `.gitignore`에 `.env`, `*.key`, OAuth 캐시 디렉토리 포함
  - [ ] 코드 grep: API 키 패턴, OAuth 토큰 패턴, 이메일 주소
  - [ ] 커밋 히스토리 grep (가능하면)
  - [ ] 예시 코드의 placeholder 명확 (예: `YOUR_API_KEY`)

### L9. 한국어 README의 라이선스 표기
- **검증:**
  - [ ] 한국어 README에 라이선스 명시 (영어 LICENSE와 일치)
  - [ ] 차용 출처 한국어로도 명시

## 비밀 정보 누출 검사 grep 패턴

```bash
# API 키 패턴
grep -rE "(sk-|api_key|API_KEY|GEMINI_API_KEY|ANTIGRAVITY_API_KEY)\s*[:=]\s*['\"][^'\"]+['\"]" .

# OAuth 토큰
grep -rE "(access_token|refresh_token)\s*[:=]\s*['\"][^'\"]+['\"]" .

# 이메일
grep -rE "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" --exclude-dir=node_modules --exclude-dir=.git
```

## 의존성 매니페스트 형식

`_workspace/02_dependency_manifest.md`:

```markdown
| 이름 | 버전 | 라이선스 | 용도 | 호환성 |
|------|------|----------|------|--------|
| Antigravity CLI (`agy`) | ≥ 1.0.0 | 외부 CLI | 런타임 호출 (번들 아님) | ✅ 차용 의무 없음 |
| node | >=18.0.0 | MIT | 런타임 | ✅ |
```

## 귀속 표기 템플릿

`_workspace/02_attribution_template.md`:

```markdown
## Attribution

This project borrows code from the following projects (all MIT-licensed):
- [everything-claude-code](https://github.com/affaan-m/everything-claude-code) — `suggest-compact.js`, `context-budget` skill, `harness-audit.js`

Inspired by:
- [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — directory structure and subagent patterns
```

## Why

공개 레포는 한 번 잘못 푸시하면 회수가 어렵다. L8(비밀 정보)은 특히 치명적 — OAuth 토큰이 커밋에 들어가면 즉시 회수해도 캐시·포크에 남는다. 사전 체크리스트가 가장 저렴한 방어선이다.

## 산출물 위치

- 감사 결과: `_workspace/02_license_audit.md`
- 의존성 매니페스트: `_workspace/02_dependency_manifest.md`
- 귀속 템플릿: `_workspace/02_attribution_template.md`
