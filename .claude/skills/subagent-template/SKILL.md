---
name: subagent-template
description: "Claude Code 플러그인 서브에이전트 정의 템플릿. 권한 화이트리스트·입출력 계약·요약 반환 강제 패턴. antigravity-rescue 등 서브에이전트 명세 작성 시 반드시 이 스킬을 사용."
user-invocable: false
---

# Subagent Template — 서브에이전트 정의 템플릿

CCP의 서브에이전트는 codex-plugin-cc의 `codex-rescue` 패턴을 따른다. 핵심은 **thin forwarding wrapper** — 거의 아무 일도 하지 않고 외부 CLI 호출만 담당.

## 정의 템플릿

```markdown
---
name: antigravity-rescue
description: "Antigravity CLI 호출 전용 서브에이전트. 메인 컨텍스트 격리를 위해 thin wrapper로만 동작."
allowed-tools: ["Bash"]
---

# Antigravity Rescue Subagent

당신은 Antigravity CLI 호출 전용 서브에이전트입니다.

## 절대 금지

- **파일 inspect·follow-up 금지**: Read 도구 사용 금지
- **Antigravity 응답을 메인에 직접 반환 금지**: 항상 요약 후 반환
- **자체 판단 금지**: 사용자 입력을 그대로 Antigravity에 전달

## 유일한 동작

`Bash` 도구로 다음 명령만 실행:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" task "<args>"
```

## 출력 포맷 (강제)

Bash 결과의 JSON envelope를 그대로 반환. 추가 설명·해석 금지.

```json
{
  "summary": "3줄 이내",
  "result_path": "...",
  "tokens": { "input": N, "output": M }
}
```

## 에러 처리

companion 스크립트가 에러 envelope 반환 시 그대로 메인에게 전달. 자체 재시도·보완 금지.
```

## 핵심 설계 원칙

### 1. Thin Forwarding Wrapper
서브에이전트는 거의 아무 일도 하지 않는다. 모든 로직은 `antigravity-companion.mjs`에. 이유: 서브에이전트의 프롬프트가 곧 토큰이고, 서브에이전트가 LLM 판단을 추가하면 부모 컨텍스트가 다시 그것을 해석하는 비용이 발생.

### 2. 권한 최소화
`allowed-tools: ["Bash"]`만. Read·Write를 추가하지 않는다. 이유: 서브에이전트가 파일을 읽으면 그 내용이 컨텍스트에 들어와 R1(이중 청구) 위험.

### 3. 출력 길이 강제
JSON envelope의 `summary`는 3줄 이내. companion 스크립트가 길이 가드를 강제. 서브에이전트는 이를 그대로 반환.

### 4. 에러 envelope 통일
모든 실패는 동일한 JSON envelope로. 자체 해석·재시도 금지.

## 검증 체크리스트

- [ ] `allowed-tools`가 최소 도구 집합 (Bash만)
- [ ] 본문에 "절대 금지" 섹션 존재
- [ ] Bash 호출 명령이 명시적으로 한 줄 (분기·조건 금지)
- [ ] 출력 포맷이 JSON envelope로 강제
- [ ] 자체 판단·재시도 금지 명시

## Why

codex-plugin-cc의 `codex-rescue`가 thin wrapper 패턴을 채택한 이유는 보고서 §1.1에서 확인됐다. 서브에이전트가 LLM 판단을 추가할수록 토큰이 늘고 격리 효과가 깨진다. CCP는 동일 원칙을 적용한다.

## 산출물 위치

- 명세: `_workspace/01_subagent_spec.md`
- 실제 정의 파일: `plugins/ccp/plugins/ccp/agents/antigravity-rescue.md`
