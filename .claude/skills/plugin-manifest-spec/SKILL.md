---
name: plugin-manifest-spec
description: "Claude Code 플러그인 매니페스트 스키마 표준 — .claude-plugin/marketplace.json, plugins/{name}/plugin.json 작성 규칙. 슬래시·서브에이전트·훅 등록 방식. 매니페스트 작성·검토·검증 작업 시 반드시 이 스킬을 사용."
user-invocable: false
---

# Plugin Manifest Spec — Claude Code 플러그인 매니페스트 표준

CCP 플러그인의 매니페스트 파일 작성 시 따라야 할 스키마와 규칙. codex-plugin-cc v1.0.4 구조를 기준으로 한다.

## 디렉토리 구조 (codex-plugin-cc 대칭)

```
plugin-root/
├── .claude-plugin/
│   └── marketplace.json          # 마켓 매니페스트
└── plugins/
    └── ccp/
        ├── plugin.json           # 플러그인 매니페스트
        ├── agents/
        │   └── antigravity-rescue.md  # 서브에이전트 정의
        ├── commands/
        │   ├── rescue.md         # /ccp:rescue 또는 /antigravity:rescue
        │   ├── status.md
        │   ├── result.md
        │   └── setup.md
        ├── scripts/
        │   ├── antigravity-companion.mjs
        │   └── harness-audit.js
        ├── hooks/
        │   └── suggest-compact.js
        └── skills/
            └── context-budget/
                └── SKILL.md
```

## marketplace.json 최소 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | string | 마켓 식별자 |
| `version` | string | semver |
| `plugins` | array | 마켓이 제공하는 플러그인 목록 |

## plugin.json 최소 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | string | 플러그인 식별자 (슬래시 prefix가 됨) |
| `version` | string | semver |
| `description` | string | 한 줄 설명 |
| `commands` | array | 슬래시 커맨드 목록 |
| `agents` | array | 서브에이전트 목록 |
| `hooks` | object | 훅 등록 (PreCompact, PreToolUse 등) |
| `permissions` | object | 도구 화이트리스트 |
| `engines` | object | Node.js 버전 핀 등 |

## 슬래시 커맨드 정의 (commands/*.md)

frontmatter:
```yaml
---
description: "한 줄 설명. 트리거 키워드 포함."
allowed-tools: ["Bash", "Read"]
---
```

본문은 Claude가 슬래시 호출 시 실행할 지시. Agent 도구로 서브에이전트 스폰을 명시 가능.

## 서브에이전트 정의 (agents/*.md)

frontmatter:
```yaml
---
name: antigravity-rescue
description: "Antigravity CLI 호출 전용 서브에이전트. Bash 화이트리스트만 허용."
allowed-tools: ["Bash"]
---
```

본문은 서브에이전트의 역할·금지사항·출력 포맷.

## 검증 체크리스트

- [ ] `marketplace.json` 존재, JSON 유효
- [ ] `plugin.json` 존재, 필수 필드 모두 포함
- [ ] 슬래시 네이밍 충돌 없음 (`antigravity`, `ccp` 등 다른 플러그인과)
- [ ] `permissions`에 명시된 도구만 허용 (over-permission 금지)
- [ ] `engines.node` 버전 핀 명시
- [ ] 비밀 정보(`*.env`, OAuth 캐시)는 `.gitignore`에 포함

## Why

매니페스트는 플러그인 시스템의 진입점이다. 잘못 작성하면 플러그인이 로드되지 않거나, 권한 오버로 보안 위험이 발생한다. codex-plugin-cc 대칭 구조를 따르는 이유는 사용자가 codex-plugin-cc를 이미 사용 중일 가능성이 높고, 학습 비용을 0에 가깝게 만들기 위함이다.

## 참조

- codex-plugin-cc 실제 구조: https://github.com/openai/codex-plugin-cc
- 보고서 §1.1 (codex-plugin-cc 구조 확인 사실)
