# 라우터 회귀 데이터셋

이 데이터셋은 `tests/router/router-eval.mjs` 가 `plugins/ccp/scripts/lib/router.mjs` 의 라우팅 결정을 검증하는 데 사용합니다.

## 1. 구성

| 클래스 | 케이스 | 비중 |
|-------|------:|------:|
| Claude 우세 (`C01~C16`, `B01~B05`) | 21 | 28.0% |
| Antigravity 우세 (`G01~G15`, `G09` 제외) | 14 | 18.7% |
| Codex 우세 (`G09`, `X01~X14`, `F16~F20` 중 매직 키워드 일부) | 19 | 25.3% |
| False-positive 가드 (`F01~F15`) | 15 | 20.0% |
| 경계 케이스 (`B01~B05`, alt_label 허용) | 5 (C 클래스와 중복) | 해당 없음 |
| 매직 키워드 (`F16~F20`) | 5 | 6.7% |
| 매직 키워드 경계 매칭 회귀 (`F21~F23`) | 3 | 4.0% |
| 네임스페이스 치환 회귀 고정 (`N02~N03`) | 2 | 2.7% |

케이스 ID 접두사는 실행마다 그대로 유지되어 디버그 출력을 비교하기 쉽습니다.

## 2. 합격 기준

게이트는 **오분류 0건**입니다(경계 케이스는 `alt_label` 값도 정답으로 허용합니다). 실행 결과에 함께 찍히는 전체 정확도·명확 케이스 정확도·경계 케이스 정확도·False positive 가드 정확도·클래스별 precision/recall(과거 참고 임계값 80%/90%/60%/0.75)은 진단용 출력일 뿐이며 게이트가 아닙니다. 즉 이 수치들이 임계값에 못 미쳐도, 오분류가 0건이면 통과입니다.

## 3. 클래스 라벨 근거 (예시)

### Claude (C01–C16)

작업이 짧거나, 직전 메인 컨텍스트 턴에 의존하거나, 한 줄짜리 수정이면 Claude 가 정답입니다.

- `C01`: `formatDate` 함수에 null 체크 추가(단일 함수, 단일 수정)
- `C03`: TypeScript readonly 와 const assertion 의 차이(사실 질문, axis B `too_small`)
- `C08`: **방금 수정한** 코드를 리뷰해줘("방금"이 `main_context_bind` 를 강제)
- `C16`: `eslint --fix` 자동 수정(CLI 실행, claude 키워드)

### Antigravity (G01–G15, G09 제외)

대용량 컨텍스트 요약이나 디렉터리 전체 분석이면 Antigravity 가 정답입니다.

- `G01`: `/ccp:antigravity-rescue` 슬래시 커맨드에 명시 프롬프트(axis A 사용자 명시)
- `G03`: 전체 레포지토리를 3줄로 요약(`estimated_tokens` 80,000)
- `G06`: 500MB 액세스 로그 파싱(`대용량 로그` 키워드 + 크기)
- `G08`: 전체 프로젝트를 읽고 보안 리스크 식별(100,000 토큰)

### Codex (G09 + X01–X14)

코드 리뷰, diff 분석, 버그 조사면 Codex 가 정답입니다.

- `G09`: 10,000줄 PR diff 리뷰(5,000 ≤ 토큰 ≤ 30,000 + review 키워드 → `mid_review_codex`)
- `X01–X03`: 명시적 `/ccp:codex-rescue` 슬래시 호출(axis A)
- `X04`: `--effort high` 플래그(axis A 사용자 명시 옵션)
- `X05`: `--sandbox workspace-write` 플래그(axis A 사용자 명시 옵션)
- `X06–X09`: 5K~30K 구간의 review/diff/버그조사 프롬프트
- `X10–X14`: 다중 키워드 케이스(우선순위 규칙에 따라 codex 키워드가 antigravity 키워드를 이김)

### 경계 케이스 (B01–B05)

두 라벨 모두 정답으로 인정되는 케이스입니다. 러너는 `expected` 또는 `alt_label` 둘 중 하나와 일치하면 정답으로 채점합니다.

- `B01`: 작은 파일 3개에서 공통 패턴 찾기(claude 또는 antigravity)
- `B05`: 1,000줄 테스트 파일의 중복 테스트 탐지(claude 또는 codex)

### Main-context-bind 우선 적용

직전 턴에 작업을 고정하는 표현이 있으면 다른 매칭과 무관하게 claude 로 강제합니다.

`방금` · `위에서` · `이전 응답` · `이전 출력` · `실행한 명령` · `just now` · `just edited` · `above` · `previous response` · `previous output` · `last command`

### False-positive 가드 (F01–F23)

- `F01–F05`: 코드 블록(` ``` `) 안의 키워드는 위임을 트리거하지 않아야 합니다
- `F06–F10`: 정보성 질문("리뷰가 뭐야?")은 위임을 트리거하지 않아야 합니다
- `F11–F15`: 영어 실행형 키워드는 정확히 트리거해야 합니다
- `F16–F20`: 매직 키워드(`@antigravity`, `@ag`, `@안티`, `@codex`, `@코덱`, `@claude`, `@auto`)는 axis A 를 트리거합니다. 레거시 `@gemini` / `@젬` / `@제미니` 는 상류 Gemini CLI EOL 이후 `@antigravity` 의 하위 호환 별칭으로 남아 있습니다.
- `F21–F23`: 매직 키워드 경계 매칭 회귀. 앞경계는 이메일 형태 문자열(`bob@agency...`)의 부분 문자열이 `@ag` 로 오인되지 않게 막고(`F21`), ASCII 키워드 뒤에 오는 한글 조사는 여전히 허용되며(`F22`), ASCII 키워드 뒤에 다른 단어 문자가 이어지면(`@agent` 는 `@ag` 가 아님) 매치되지 않습니다(`F23`).

### 네임스페이스 치환 회귀 고정 (N02–N03)

`/antigravity:*` → `/ccp:antigravity-*` 네임스페이스 수정 중 이 데이터셋의 다른 케이스가 다루지 않는 두 가지 속성을 고정합니다.

- `N02`: `--fallback-claude` 가 명시적 `/ccp:antigravity-rescue` 슬래시보다 우선합니다: `target === 'claude'`, `axis === 'A'`.
- `N03`: 옛 미등록 표기 `/antigravity:rescue` 는 더 이상 사용자 명시 의도로 인정되지 않습니다(`axis !== 'A'`. 입력에 키워드가 없어 최종적으로는 크기 축을 거쳐 claude 로 귀결되지만, 이 케이스가 지키는 것은 그 target 값이 아니라 axis 가 A 가 아니라는 사실입니다). 이 케이스는 데이터셋에서 유일하게 의도적으로 예외 처리된 곳입니다("`tests/` 어디에도 `/antigravity:` 문자열을 두지 않는다"는 원칙의 예외). 폐기된 표기가 폐기되었음을 증명하려면 그 표기 자체를 입력으로 써야 하기 때문입니다.

## 4. 실행 방법

```bash
node tests/router/router-eval.mjs
```

실행하면 케이스별 채점표, 클래스별 precision/recall, 최종 판정이 출력됩니다.
