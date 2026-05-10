# 라우터 동작

CCP 라우터는 사용자 프롬프트를 Claude (메인 컨트롤 플레인) · Gemini (`/gemini:rescue`) · Codex (`/ccp:codex-rescue`) 중 어느 경로로 보낼지 결정합니다. 4축 우선순위로 동작하며, 상위 축에서 결정이 나면 하위 축은 평가하지 않습니다.

라우터 결정 로직은 단일 모듈에 구현되어 있고 추천 훅·회귀 데이터셋·라우터 에이전트가 동일 모듈을 공유합니다. 본 문서의 동작과 런타임 동작이 일치합니다.

## 4축

```
[사용자 프롬프트]
     ↓
[축 A] 사용자 명시 신호    (슬래시, --effort, --sandbox, --fallback-claude)
     ↓ (매칭 없으면)
[축 B] 입력 크기           (>30K → Gemini, 5K~30K + review 키워드 → Codex)
     ↓ (매칭 없으면)
[축 C] 키워드 카탈로그     (codex > gemini > claude; main-context-bind 는 claude 강제)
     ↓ (매칭 없으면)
[축 D] fallback           (Claude, 보수적 기본값)
```

### 축 A — 사용자 명시 신호 (최우선)

사용자 명시는 항상 우선합니다.

| 신호 | 결정 |
|---|---|
| `/gemini:rescue ...` | Gemini |
| `/ccp:codex-rescue ...` | Codex |
| `--fallback-claude` | Claude (하위 축 무시) |
| `--effort` / `--sandbox` / `--write` / `--cwd` | Codex (Codex 전용 플래그) |
| `--max-tokens` | Gemini (Gemini 전용 플래그) |

### 축 B — 입력 크기

명시 신호가 없으면 라우터가 토큰 수를 추정 (`words * 1.3`) 하고 임계값을 적용합니다.

| 추정 토큰 | 결정 |
|---|---|
| `> 30,000` | Gemini (대용량 요약) |
| `5,000 ~ 30,000` + review/diff/audit 키워드 | Codex |
| 그 외 | 축 C 로 통과 |

### 축 C — 키워드 카탈로그

축 A·B 모두 매칭이 없으면, 라우터는 영어·한국어 actionable 키워드를 검사합니다. `hasActionableTrigger` 가 단어 경계 매칭을 적용하고, `removeCodeBlocks` 가 코드 블록 안의 키워드는 무시합니다. 우선순위:

1. **메인 컨텍스트 의존 키워드** (`방금`, `위에서`, `이전 답변`, `just now`, `above`, `previous response` 등) → **Claude 강제**. 위임이 볼 수 없는 대화 상태에 의존한다는 신호입니다.
2. **Codex 키워드** (`review`, `diff`, `bug`, `audit`, `refactor` 등) → Codex.
3. **Gemini 키워드** (`summarize`, `extract`, `요약`, `로그` 등) → Gemini.
4. **Claude 키워드** (`explain`, `walk through`, `설명해줘` 등) → Claude.

코드 블록 안 매칭은 무시되고, `INFORMATIONAL_INTENT_PATTERNS` 윈도 (`X 가 뭐야?`, `how does X work?` 등) 안의 매칭은 Claude 로 다운그레이드됩니다. 이는 키워드가 명령이 아니라 설명일 때의 false positive 를 차단합니다.

### 축 D — 보수적 fallback

위 모두 매칭이 없으면 Claude. 이유: Claude 는 메인 컨텍스트이므로, 잘못된 위임이 놓친 위임보다 더 비쌉니다.

## 정확도

라우터는 70 케이스 오프라인 회귀 데이터셋을 동봉합니다. 현 정확도: **70/70 = 100%**, 모든 모델 P/R ≥ 0.93. CI 가 모든 PR 에서 데이터셋을 실행합니다.

## 결정에 영향 주기

| 의도 | 방법 |
|---|---|
| 크기 무관하게 Gemini 강제 | `/gemini:rescue` |
| 크기 무관하게 Codex 강제 | `/ccp:codex-rescue` |
| 키워드 무관하게 Claude 강제 | `--fallback-claude` 추가 |
| 라우터 결정 확인 | envelope `details.mode` 또는 `/ccp:audit` |

## router-suggest 훅 (v0.2)

router-suggest 훅은 `UserPromptSubmit` 시 동작합니다. 동일한 결정을 계산해, 결과가 `gemini` 또는 `codex` 인 경우 `[CCP-ROUTER-001]` system reminder 로 적합한 슬래시 커맨드를 추천합니다. **자동 위임은 하지 않습니다.** 사용자가 직접 슬래시를 타이핑합니다. 원칙 4 (위임 실패 시 자동 fallback 금지) 와 정합합니다.

프롬프트가 헤드리스로 보이면 (`claude -p`, `automation`, `cron`, `CI` 등) 훅은 추가로 `[CCP-META-WARN]` 안내를 주입합니다 — 슬래시 사전 스크립트화 또는 companion 직접 호출을 권장합니다. 근거는 [아키텍처 — 토큰 절감 패턴](./architecture.md#토큰-절감-패턴) 참조.

## Anti-pattern

- **프롬프트를 사소하게 변형해 반복** — 위임 진입점을 "찾으려는" 시도. 라우터는 결정적이므로 두 번째 시도도 같은 결정을 합니다.
- **헤드리스 스크립트에서 `/gemini:rescue --help` 호출** — help 출력을 한 번 캐시하고 재사용하세요. 매 실행마다 비용을 지불할 이유가 없습니다.
- **review 키워드 없는 작은 리팩토링에 Codex 강제** (`< 5K` 토큰). 크기 임계가 있는 이유는 작은 편집에 Codex 의 추론 오버헤드가 낭비되기 때문입니다.

## 관련 문서

- [슬래시 커맨드 레퍼런스](./slash-commands.md)
- [아키텍처](./architecture.md) — 7원칙 (자동 fallback 금지 포함)
- [트러블슈팅](./troubleshooting.md) — `CCP-ROUTER-001` 등
