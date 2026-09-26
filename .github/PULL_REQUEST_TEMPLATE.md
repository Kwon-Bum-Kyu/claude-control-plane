<!-- CCP 기여에 감사합니다. 검토자가 빠르게 확인할 수 있도록 각 항목을 채워 주세요. -->

## 요약

<!-- 무엇을, 왜 바꿨는지 1~3줄로 적어 주세요. 관련 이슈는 `Fixes #123` 또는 `Refs #123` 으로 링크합니다. -->

-

## 테스트 계획

<!-- 실제로 확인한 절차를 적어 주세요. CI 는 .github/workflows/ci.yml 에 정의된 잡을 실행합니다. 로컬에서 실행한 것도 함께 적어 주세요. -->

- [ ] `plugins/ccp/scripts/` 아래에서 바뀐 `.mjs` 파일 전부 `node --check` 통과
- [ ] `node tests/router/router-eval.mjs`: 오분류 0건
- [ ] `node tests/router/router-suggest-test.mjs`: 실패 0건
- [ ] `node tests/companion/golden/diff.mjs --cli all`: diff 0
- [ ] `node tests/companion/contract-test.mjs`, `node tests/companion/truncation-probe.mjs`: 실패 0건
- [ ] 가드 3종(`node tools/repo-guard.mjs ignore-coverage`, `content`, `public-surface`) 통과
- [ ] 감사 점수는 CI 의 harness-audit 잡이 확인합니다(새로 클론한 트리에는 job 시드가 없어 로컬 실행으로는 검증할 수 없습니다)
- [ ] `.gitignore` 를 고쳤거나 `git rm --cached` 를 실행했거나 새 최상위 파일을 추가했다면, `guard-ignore` 가 초록인지 확인했습니다(무시 규칙 누락을 잡아내는 유일한 검사입니다)
- [ ] 영향받는 슬래시 커맨드(`/ccp:antigravity-*`, `/ccp:codex-*`, `/ccp:*`)를 수동으로 확인했습니다

## 차용 코드 체크리스트(해당 없으면 건너뜁니다)

<!-- 상류 코드를 차용한 파일을 건드릴 때만 채웁니다. 그 파일들은 선두 주석에 출처를 밝히고 있고,
     docs/en/architecture.md 가 전체 목록을 담고 있습니다. -->

- [ ] 새 상류 프로젝트를 들여왔다면 `LICENSES/` 에 라이선스 원문을 추가했습니다
- [ ] 차용 파일을 옮기거나 이름을 바꿨다면 같은 커밋에서 `docs/en/architecture.md` 와
      `docs/ko/architecture.md` 를 함께 고쳤습니다
- [ ] 차용한 Apache-2.0 파일을 고쳤다면 선두 주석이 여전히 상류 출처와 변경 내용을 정확히 담고 있습니다

## DCO 서명

<!--
아래 체크로 Developer Certificate of Origin(https://developercertificate.org/)에 서명함을 확인합니다.
`git commit -s` 로 커밋에 `Signed-off-by:` 트레일러를 추가할 수 있습니다.
-->

- [ ] 커밋에 `git commit -s` 로 서명했습니다

## 검토자에게

<!-- 선택 사항입니다: 특히 봐 주었으면 하는 부분, 다음 PR로 미룬 후속 작업 등을 적어 주세요. -->
