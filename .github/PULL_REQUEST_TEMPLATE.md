<!-- CCP 기여를 환영합니다. 검토에 필요한 항목을 작성해 주세요. -->

## 요약

<!-- 변경 내용과 이유를 1~3줄로 작성합니다. 관련 이슈는 `Fixes #123` 또는 `Refs #123`으로 링크합니다. -->

-

## 테스트 계획

<!-- 확인한 절차를 작성합니다. CI는 .github/workflows/ci.yml에 정의된 잡을 실행합니다. 로컬에서 실행한 항목도 함께 작성합니다. -->

- [ ] `plugins/ccp/scripts/` 아래에서 바뀐 `.mjs` 파일 전부 `node --check` 통과
- [ ] `node tests/router/router-eval.mjs`: 오분류 0건
- [ ] `node tests/router/router-suggest-test.mjs`: 실패 0건
- [ ] `node tests/companion/golden/diff.mjs --cli all`: diff 0
- [ ] `node tests/companion/contract-test.mjs`, `node tests/companion/truncation-probe.mjs`: 실패 0건
- [ ] 가드 3종(`node tools/repo-guard.mjs ignore-coverage`, `content`, `public-surface`) 통과
- [ ] 감사 점수는 CI의 harness-audit 잡이 확인합니다(새로 클론한 트리에는 job 시드가 없어 로컬 실행으로는 검증할 수 없습니다)
- [ ] `.gitignore`를 고쳤거나 `git rm --cached`를 실행했거나 새 최상위 파일을 추가했다면, `guard-ignore`가 초록인지 확인했습니다(무시 규칙 누락을 잡아내는 유일한 검사입니다)
- [ ] 영향받는 슬래시 커맨드(`/ccp:antigravity-*`, `/ccp:codex-*`, `/ccp:*`)를 수동으로 확인했습니다

## 차용 코드 체크리스트(해당 없으면 건너뜁니다)

<!-- 상류 코드를 차용한 파일을 수정할 때 작성합니다. 해당 파일의 선두 주석에 출처가 있으며,
     전체 목록은 docs/en/architecture.md에 있습니다. -->

- [ ] 새 상류 프로젝트를 들여왔다면 `LICENSES/`에 라이선스 원문을 추가했습니다
- [ ] 차용 파일을 옮기거나 이름을 바꿨다면 같은 커밋에서 `docs/en/architecture.md`와
      `docs/ko/architecture.md`를 함께 고쳤습니다
- [ ] 차용한 Apache-2.0 파일을 고쳤다면 선두 주석이 여전히 상류 출처와 변경 내용을 정확히 담고 있습니다

## DCO 서명

<!--
아래 체크로 Developer Certificate of Origin(https://developercertificate.org/)에 서명함을 확인합니다.
`git commit -s`로 커밋에 `Signed-off-by:` 트레일러를 추가할 수 있습니다.
-->

- [ ] 커밋에 `git commit -s`로 서명했습니다

## 검토자에게

<!-- 선택 사항입니다. 검토를 원하는 부분이나 다음 PR로 미룬 후속 작업을 작성합니다. -->
