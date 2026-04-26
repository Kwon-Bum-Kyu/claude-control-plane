---
name: arch-checklist
description: "CCP 아키텍처 검수 체크리스트 (A1~A8). codex-plugin-cc 대칭성·플러그인 시스템 호환성·서브에이전트 격리·OAuth fallback 검증. 아키텍처 리뷰·검수 작업 시 반드시 이 스킬을 사용."
---

# Arch Checklist — CCP 아키텍처 검수 체크리스트

기획 산출물(`_workspace/01_*`)의 아키텍처 정합성을 8개 항목으로 검증한다.

## 체크리스트 (A1~A8)

### A1. 디렉토리 구조 대칭성
**기준:** codex-plugin-cc v1.0.4 구조와 동일
```
.claude-plugin/marketplace.json
plugins/ccp/{plugin.json,agents/,commands/,scripts/,hooks/,skills/}
```
**판정:**
- ✅ 일치: 전체 구조 동일
- ⚠️ 부분: 일부 디렉토리 누락 또는 추가됨
- ❌ 불일치: 다른 패턴 채택

### A2. 슬래시 네이밍
**기준:** `/{plugin}:{action}` 형식. 다른 플러그인과 충돌 없음.
**판정 기준:**
- 충돌 검사: `codex`, `gemini`, `omc`, `ecc` 네임스페이스와 비교
- 일관성: 모든 슬래시가 동일 prefix 사용

### A3. 서브에이전트 권한 화이트리스트
**기준:** `allowed-tools`가 최소 도구 집합 (기본 Bash만, 명령어 패턴 제한)
**금지:** Read/Write/Edit/WebFetch가 서브에이전트에 허용된 경우 → R1 위험

### A4. 출력 포맷 강제
**기준:** 모든 서브에이전트·companion이 JSON envelope 반환
```json
{ "summary": "...", "result_path": "...", "tokens": {...} }
```
**필수 필드:** summary (≤3줄), result_path, tokens

### A5. foreground/background 분기
**기준:** companion 스크립트가 두 모드 모두 지원
- foreground: 동기 stdout
- background: detached child + job 메타 디스크 저장
- background는 `/gemini:status`, `/gemini:result`로 회수 가능

### A6. JSON 결과 정규화
**기준:** 에러 envelope 표준 정의
```json
{ "error": { "code": "E_*", "message": "...", "recovery": "..." } }
```
**검증:** 모든 에러 시나리오에서 동일 envelope 사용

### A7. 훅 이벤트 호환
**기준:** 공식 이벤트명만 사용 (PreCompact, PreToolUse, PostToolUse, SessionStart 등)
**참고:** Claude Code 공식 문서 hooks 섹션
**금지:** 비공식·실험적 이벤트 사용

### A8. OAuth fallback 경로
**기준:** Gemini OAuth 만료 시 Claude 본체로 자동 fallback
**필수 명세:**
- 사전 검증 (호출 전 토큰 유효성 체크)
- 재인증 안내 메시지 (ux-designer 작성 메시지 인용)
- Claude 복귀 트리거

## 판정 출력 형식

`_workspace/02_arch_review.md`에 다음 형식으로 기록:

```markdown
## A1. 디렉토리 구조 대칭성
- **판정:** ✅ / ⚠️ / ❌
- **근거:** {확인한 파일/명세 인용}
- **수정 요청:** {있다면 spec-writer에게 보낼 메시지}
```

## Why

체크리스트 기반 검수는 누락을 막고, 검수자 간 판정 차이를 줄인다. A1~A8은 보고서 §1.1(codex-plugin-cc 구조 확인 사실)과 §5(리스크 카탈로그)에서 도출된 핵심 항목들이다. 이 8개를 통과하면 개발 Phase에서 아키텍처 결함으로 인한 재작업 위험이 크게 줄어든다.

## 산출물 위치

`_workspace/02_arch_review.md`
