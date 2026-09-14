# CLAUDE.md

이 파일은 Claude Code (claude.ai/code) 가 이 저장소의 코드를 다룰 때 참고하는 안내서다.

## 핵심 목표

Claude Control Plane (CCP) 은 Claude 를 메인 컨트롤 플레인으로 두고 Antigravity CLI (`agy`) 와 Codex CLI 를 서브에이전트로 위임 호출하는 Claude Code 플러그인이다. 플러그인 본체는 `plugins/ccp/`, 마켓플레이스 루트는 `.claude-plugin/marketplace.json` 이며 Node.js 20 이상이 필요하다.

풀려는 문제는 하나다. 큰 컨텍스트(코드베이스·로그·문서)를 Claude 혼자 처리하면 메인 세션의 토큰이 빠르게 소진된다. 그래서 그 작업을 외부 CLI 에 위임하고, 메인 세션에는 500자 이하의 요약과 결과 파일 경로만 돌려주어 메인 컨텍스트의 토큰 누적을 격리한다. 설계 판단은 전부 이 격리를 지키는 쪽으로 내린다.

- 위임 결과는 JSON envelope 한 장으로만 돌아온다. CLI 의 원본 출력은 디스크에 남기고 메인 컨텍스트에는 올리지 않는다.
- 위임이 실패해도 조용히 Claude 로 재시도하지 않는다. envelope 의 `recovery` 값을 보고 사용자가 다음 행동을 고른다.
- 훅은 추천만 하고 실행하지 않는다. `/compact` 도 위임도 자동으로 돌리지 않는다.
- 새 CLI 를 붙일 때 코어는 바뀌지 않는다. 어댑터 파일 하나로 끝나야 한다.

## 아키텍처 구조

### 위임 경로: 슬래시 → 서브에이전트 → companion → envelope

`/ccp:antigravity-rescue` 와 `/ccp:codex-rescue` 는 각각 `plugins/ccp/agents/<cli>-rescue.md` 서브에이전트를 통해 실행된다. 서브에이전트는 Bash 만 허용된 얇은 전달자로, 정해진 단일 명령 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/<cli>-companion.mjs" rescue ...`) 만 실행하고, companion 이 돌려준 envelope 을 해석·재시도·fallback 없이 그대로 반환한다. 이 격리가 플러그인의 존재 이유이므로, 서브에이전트에 Read 같은 도구를 추가하거나 companion 외의 Bash 실행을 허용하는 변경은 하지 않는다.

`status`·`result`·`setup`·`audit` 커맨드는 서브에이전트 없이 슬래시 핸들러가 스크립트를 직접 호출한다.

### companion 코어와 어댑터의 경계

```
scripts/companion.mjs <cli>            <cli> 를 adapters/<cli>.mjs 로 해석하는 일만 한다
scripts/<cli>-companion.mjs            어댑터를 고정한 얇은 별칭. settings.json 허용 패턴과 문서 참조를 유지하려고 남아 있다
scripts/core/runtime.mjs               모든 부수효과 (stdout·exit·파일·spawn) 와 작업 디스패치. CLI 이름을 알지 못한다
scripts/core/{args,jobs,process,paths,envelope,errors,budget}.mjs
scripts/adapters/{antigravity,codex}.mjs   순수 값만 반환하는 CLI 선언 (인자 구성·결과 파싱·토큰 계산·에러 카탈로그)
```

어댑터 계약은 정확히 52개의 리프 키로 동결되어 있고, `runtime.mjs#assertAdapter` 가 미지의 키와 필수 키 누락을 거부한다. `contract-test.mjs` 가 mock 어댑터로 "코어 무변경 확장" 을 증명하므로, 계약에 키를 더하는 변경은 두 어댑터·`runtime.mjs` 의 `CONTRACT` 상수·계약 테스트를 함께 고쳐야 한다.

envelope 은 `plugins/ccp/schemas/envelope.schema.json` 이 SSOT 이다 (`summary` 500자 이하, `result_path`, `tokens`, `exit_code`, `details.mode`. 에러는 `error.{code,message,action,recovery}`). 요약이 한도를 넘으면 core 가 문장 경계에서 자르고 `summary_truncated: true` 를 표시하며, 전문은 `result_path` 에 남는다. 에러 코드는 `CCP-<카테고리>-<NNN>` 형식으로, `core/errors.mjs` 의 공통 카탈로그와 어댑터의 `errors` 를 병합해 쓴다.

job 경로는 `core/paths.mjs` 가 결정한다. 우선순위는 `CCP_JOBS_DIR` → `CLAUDE_PROJECT_DIR` → `CLAUDE_PROJECT_ROOT` → 호출자 힌트 → `process.cwd()` 이며, 플러그인의 물리 설치 위치 (`CLAUDE_PLUGIN_ROOT`) 는 job 경로 계산에 쓰지 않는다. 마켓플레이스 설치본은 캐시 디렉터리라서 갱신 시 사라질 수 있기 때문이다. 산출물은 `_workspace/_jobs/<uuid>/` 에, 감사 리포트는 `_workspace/_audits/` 에 쓰인다.

### 라우터: classify 하나를 세 소비자가 공유한다

`scripts/lib/router.mjs#classify` 가 3-way (claude / antigravity / codex) 결정의 유일한 구현이다. 4축 우선순위는 사용자 명시 → 입력 크기 → 키워드 → 보수적 fallback (Claude) 이고, 키워드 사전은 영어가 주, 한국어가 보조이며 `magic-keywords.mjs` 가 코드 블록 안의 키워드와 정보성 문맥을 걸러 오탐을 줄인다.

- `hooks/router-suggest.js` (UserPromptSubmit): 결정을 `[CCP-ROUTER-001]` 시스템 리마인더로 주입만 한다. 헤드리스 자동화가 의심되는 키워드가 있으면 `[CCP-META-WARN]` 을 덧붙인다.
- `scripts/lib/router-decide.mjs`: `agents/router.md` 와 테스트가 쓰는 결정적 CLI 진입점. `plugin.json#config.auto_routing` (기본 false) 이 켜진 canonical 세션에서만 자동 위임하며, 헤드리스 여부는 `CI`·`CLAUDE_CODE_NONINTERACTIVE`·`CLAUDE_CODE_ENTRYPOINT` 환경 변수의 OR 로 판정한다 (`stdin.isTTY` 는 훅 자식 프로세스에서 항상 null 이라 쓰지 않는다).
- `tests/router/*`: 회귀 데이터셋. 키워드 사전을 바꾸면 `router-eval.mjs` 가 오분류 0건을 유지해야 한다.

### 훅 (`plugins/ccp/hooks/hooks.json`)

SessionStart `boot-check.js` (Node·CLI 버전·인증 사전 점검), UserPromptSubmit `suggest-compact.js` + `router-suggest.js`, PreCompact `suggest-compact.js` (컨텍스트 75% 임계 안내), SubagentStop `rescue-finalize.js` (5분 넘게 running 상태인 job 을 failed 로 정리). 네 훅 모두 Claude Code 의 JSON stdin 계약을 쓰고, 실패해도 사용자 흐름을 막지 않는다.

### 커맨드 네임스페이스와 문서 대칭

커맨드 파일의 stem 이 곧 커맨드 이름이다 (`commands/audit.md` → `/ccp:audit`). 네임스페이스는 `/ccp:*` 하나이며, 대상 CLI 는 `antigravity-`·`codex-` 접두사로 구분한다. `docs/en/` 과 `docs/ko/` 는 같은 파일명으로 쌍을 이루고 `README.md` 와 `README.ko.md` 도 마찬가지이므로, 한쪽을 고치면 다른 쪽도 맞춘다.

### 차용 코드의 출처 표기

`core/{args,jobs,process,runtime}.mjs` 와 `adapters/codex.mjs` 는 codex-plugin-cc (Apache-2.0) 코드를 포함하며, 파일 선두 주석에 상류 파일·커밋·수정 내역을 선언한다. `hooks/suggest-compact.js`·`skills/context-budget/`·`scripts/harness-audit.js` 는 everything-claude-code (MIT), `scripts/lib/magic-keywords.mjs` 는 oh-my-claudecode (MIT) 차용이다. 이 파일들을 편집할 때 선두 주석을 지우지 않고, 새 차용을 추가하면 `LICENSES/` 에 원문을 넣는다.

## 주요 명령어

`package.json` 이 없다. 모든 스크립트는 저장소 루트에서 `node` 로 직접 실행하며, 외부 npm 의존성 없이 Node 내장 모듈만 쓴다 (ESM `.mjs`).

### 클론 직후 1회

```bash
node tools/repo-guard.mjs bootstrap   # .githooks/ 를 core.hooksPath 로 등록한다
```

### 테스트 (CI 와 동일. 실제 CLI·네트워크 없이 전부 스텁으로 실행된다)

```bash
node tests/router/router-eval.mjs                  # 3-way 분류기 72케이스. 오분류 0건이어야 통과
node tests/router/router-suggest-test.mjs          # router-suggest 훅 19시나리오. 오분류 0건이어야 통과
node tests/companion/contract-test.mjs             # 어댑터 계약 15항목 (52키 동결, mock 어댑터가 실제 core 를 구동)
node tests/companion/golden/diff.mjs --cli all     # 골든 envelope 29시나리오. diff 0 이어야 통과
node tests/companion/truncation-probe.mjs          # 요약 절단 계약 30항목
```

- 골든 diff 를 CLI 하나만 돌리려면 `--cli codex` 또는 `--cli antigravity` 를 쓰고, 차이의 상세는 `--verbose` 로 본다. 스크립트 안의 개별 케이스만 골라 실행하는 옵션은 없다.
- companion 의 출력 동작을 의도적으로 바꾼 경우에만 `node tests/companion/golden/capture.mjs` 로 기준선 (`tests/companion/golden/baseline/companion-baseline.json`) 을 다시 캡처하고, 갱신된 시나리오가 의도한 변경과 일치하는지 diff 로 대조한다.

### 문법 검사와 배포 경계 가드 (CI 와 동일. push 전에 로컬에서 먼저 돌린다)

```bash
for f in $(find plugins/ccp/scripts -name '*.mjs') $(find plugins/ccp/hooks -name '*.js') plugins/ccp/scripts/harness-audit.js; do node --check "$f" || echo "FAIL $f"; done
node tools/repo-guard.mjs ignore-coverage   # .gitignore 규칙과 추적 집합이 일치하는지
node tools/repo-guard.mjs content           # 호스트 경로·비밀·개인정보가 없는지
node tools/repo-guard.mjs public-surface    # 공개 표면에 유지보수자 전용 식별자가 없는지
```

### 플러그인 스크립트 직접 실행

```bash
node plugins/ccp/scripts/companion.mjs <antigravity|codex> <setup|rescue|status|result|cancel|preflight> [...]
node plugins/ccp/scripts/antigravity-companion.mjs rescue --task "<task>" [--background]   # CLI 를 고정한 얇은 별칭
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "<text>"                            # 라우팅 결정을 envelope 으로 출력
node plugins/ccp/scripts/harness-audit.js --format json [--since YYYY-MM-DD]                # /ccp:audit 의 본체. job 이 없는 트리에서는 점수를 낼 수 없다
```

### 커밋

이 저장소는 공개 레포 하나라서 추적되는 파일은 push 하는 순간 공개된다. 커밋 메시지는 Conventional Commits 형식의 한국어 제목 한 줄로 쓴다. `commit-msg` 훅과 CI 가 메시지 안의 Claude Code 세션 URL 과 세션 식별자 트레일러, 커밋 SHA, 신원 트레일러 밖의 이메일 주소를 거부하므로 넣지 않는다. `pre-push` 훅은 `main` 과 태그 외의 ref push 를 거부하며, `git push --all` 은 쓰지 않는다.
