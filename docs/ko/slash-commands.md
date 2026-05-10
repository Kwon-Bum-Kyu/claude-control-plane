# 슬래시 커맨드 레퍼런스

CCP 는 9개 슬래시 커맨드를 3그룹으로 제공합니다 — Gemini 위임, Codex 위임, 공통 감사. 모든 커맨드는 동일한 형태의 JSON envelope 을 반환합니다 (자세한 형식: [아키텍처 — envelope 스키마](./architecture.md#envelope-스키마)).

## Gemini (대용량 요약·분석)

| 커맨드 | 용도 |
|---|---|
| `/gemini:rescue <prompt>` | Gemini 에 무거운 작업 위임 |
| `/gemini:status <job_id>` | background job 상태 조회 |
| `/gemini:result <job_id>` | 완료된 job 의 요약 + `result_path` 회수 |
| `/gemini:setup [--renew]` | Gemini CLI · OAuth 진단 |

## Codex (코드 리뷰·diff·버그 조사)

| 커맨드 | 용도 |
|---|---|
| `/ccp:codex-rescue <prompt>` | Codex 에 코드 추론 작업 위임 |
| `/ccp:codex-status <job_id>` | background job 상태 조회 |
| `/ccp:codex-result <job_id>` | 완료된 job 의 요약 + `result_path` 회수 |
| `/ccp:codex-setup` | Codex CLI · OAuth 진단 |

## 공통

| 커맨드 | 용도 |
|---|---|
| `/ccp:audit [--since N --format md\|json]` | 8 카테고리 점수를 시간 윈도 별로 산출 |

각 커맨드의 전체 명세 (설명·예제·exit code) 는 `plugins/ccp/commands/*.md` 에 있습니다.

## 플래그 매트릭스

| 플래그 | Gemini | Codex | 비고 |
|---|:---:|:---:|---|
| `--background` | ✅ | ✅ | `job_id` 즉시 반환 |
| `--fallback-claude` | ✅ | ✅ | 라우터 무시하고 Claude 로 처리 |
| `--timeout-ms N` | ✅ (default 600000) | ✅ (default 600000) | foreground timeout |
| `--poll-interval-ms N` | ✅ (2000) | ✅ (2000) | background polling 주기 |
| `--max-tokens N` | ✅ (default 4000) | ❌ | Gemini 전용, prompt suffix 변환 |
| `--files <glob>` | ⚠️ 백로그 | ❌ | Gemini 첨부 파일 |
| `--model NAME` | ❌ | ✅ | Codex 모델 별칭 |
| `--effort low\|medium\|high` | ❌ `CCP-INVALID-001` | ✅ (`-c model_reasoning_effort=...`) | Codex 전용 |
| `--sandbox MODE` | ❌ `CCP-INVALID-001` | ✅ (`read-only` / `workspace-write` / `danger-full-access`) | Codex 샌드박스 |
| `--cwd DIR` | ❌ | ✅ | Codex 작업 루트 |
| `--renew` | ✅ | (`codex login` 직접 사용) | OAuth 재인증 안내 |

`/gemini:rescue` 에 Codex 전용 플래그 (또는 그 반대) 가 들어오면 companion 이 인라인으로 `CCP-INVALID-001` 을 반환합니다. 의도된 동작이며, 잘못된 슬래시를 조기에 노출합니다.

## 3-way 호환성

| 기능 | Claude | Gemini | Codex | 비고 |
|---|:---:|:---:|:---:|---|
| `--background` | N/A | ✅ | ✅ | Claude 는 메인 컨텍스트, async 없음 |
| `--model NAME` | `/model` 슬래시 | ✅ | ✅ | Claude 는 내장 `/model` |
| `--effort low\|medium\|high` | extended thinking | ❌ | ✅ | Claude 는 Option+T |
| `--sandbox <mode>` | N/A | ❌ | ✅ | Codex 만 |
| `--write` | N/A | ❌ | ✅ (`--sandbox workspace-write` alias) | Codex 단축형 |
| `--cwd DIR` | N/A (turn 별) | ❌ | ✅ (`-C`) | Codex 만 |
| `--max-tokens N` | N/A | ✅ (prompt suffix) | ❌ | Gemini 만 |
| `--files <glob>` | (chat 첨부) | ⚠️ 백로그 | ❌ | Gemini 백로그 |
| `--resume-last` | N/A | ⚠️ meta-file 흉내 | ✅ (`codex resume --last`) | Codex CLI 네이티브; 현재 cwd 범위 한정 (다른 디렉토리는 `codex resume --all`) |

## 예제

### Background job 라이프사이클

```text
/gemini:rescue --background "/var/log/app/error.log 최근 24시간 요약"
# → envelope.summary 에 job_id
/gemini:status <job_id>     # queued / running / completed / failed
/gemini:result <job_id>     # 요약 + result_path
```

### Codex — effort + sandbox 명시

```text
/ccp:codex-rescue --effort high --sandbox workspace-write --cwd $(pwd) -- "주문 파이프라인의 race condition 식별"
```

### 1주일 감사 (JSON)

```text
/ccp:audit --since 7d --format json
```

envelope 의 `details.scores` 에 카테고리별 점수 (각 0~5) 가 들어 있습니다. 총점은 numeric score 카테고리들의 합입니다.

## envelope 의 exit_code

companion 은 항상 OS 레벨 exit-code 0 으로 종료합니다. 실제 결과는 envelope 의 `exit_code` 필드에 있습니다. CI · 자동화는 OS exit 가 아니라 envelope `exit_code` 로 분기해야 합니다.

## 관련 문서

- [라우터 동작](./router.md) — 슬래시 없는 프롬프트의 라우팅
- [아키텍처](./architecture.md) — envelope 스키마
- [트러블슈팅](./troubleshooting.md) — `CCP-INVALID-001` 등
