# CCP 기여 안내

CCP(Claude Control Plane)에 기여해 주셔서 감사합니다. 이 문서는 시작 절차, 로컬 검증 방법, 커밋과 이슈 규칙, 차용 코드와 라이선스 관련 사항을 안내합니다.

## 시작하기

1. 이 저장소를 포크합니다.
2. 포크를 클론합니다.
3. 클론 직후 한 번, `node tools/repo-guard.mjs bootstrap`을 실행합니다. 로컬 Git 훅을 활성화하는 명령입니다(`git config core.hooksPath .githooks`를 대신 실행합니다).
4. 브랜치를 만듭니다(`feat/<주제>` 또는 `fix/<주제>` 형식을 권장합니다).
5. 변경 사항을 작성하고 테스트를 추가한 다음, 아래 로컬 검증을 실행합니다.
6. 자기 포크로 push 합니다.
7. 포크에서 이 저장소로 풀 리퀘스트를 보냅니다.

이 저장소는 공개 저장소 하나입니다. 커밋해서 push 하면 그 순간 공개되고, 되돌리는 커밋을 추가로 올려도 이미 공개된 내용은 회수되지 않습니다. push 전에 아래 로컬 검증을 반드시 실행합니다.

## 로컬 검증

다음 명령을 저장소 루트에서 실행합니다. CI가 실행하는 것과 같은 명령입니다.

테스트 5종입니다.

```
node tests/router/router-eval.mjs
node tests/router/router-suggest-test.mjs
node tests/companion/contract-test.mjs
node tests/companion/golden/diff.mjs --cli all
node tests/companion/truncation-probe.mjs
```

문법 검사입니다.

```
for f in $(find plugins/ccp/scripts -name '*.mjs') $(find plugins/ccp/hooks -name '*.js') plugins/ccp/scripts/harness-audit.js; do node --check "$f" || echo "FAIL $f"; done
```

가드 3종입니다.

```
node tools/repo-guard.mjs ignore-coverage
node tools/repo-guard.mjs content
node tools/repo-guard.mjs public-surface
```

`/ccp:audit`는 로컬 검증에 사용하지 않습니다. 새로 클론한 환경에는 감사할 job 기록이 없어서 `CCP-AUDIT-001`만 나옵니다.

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org) 형식을 권장합니다(`feat`, `fix`, `docs`, `refactor`, `test`, `chore` 등).

`commit-msg` 훅과 CI는 커밋 메시지 안의 Claude Code 세션 URL, 커밋 SHA, 신원 트레일러(`Signed-off-by` 등) 밖에 있는 이메일 주소를 거부합니다.

## DCO

이 프로젝트는 DCO(Developer Certificate of Origin) 서명을 권장합니다. 필수는 아닙니다.

```
git commit -s -m "feat: add new feature"
```

이 명령은 커밋 메시지에 다음 트레일러를 자동으로 추가합니다.

```
Signed-off-by: Your Name <you@example.com>
```

이 트레일러는 https://developercertificate.org의 DCO v1.1에 동의한다는 뜻입니다. CI는 이 서명이 있는지 검사하지 않습니다.

## 공개 표면 규칙

공개 표면에는 외부 독자가 의미를 추론할 수 없는 작업자 전용 식별자를 쓰지 않습니다. 적용 대상과 제외 대상, 치환 방식은 [`.claude/rules/no-internal-tracking-ids.md`](./.claude/rules/no-internal-tracking-ids.md)에 있고, `public-surface` 가드가 같은 목록으로 검사합니다.

## 로컬 훅의 한계

`.githooks/`의 훅 3종(`pre-commit`, `commit-msg`, `pre-push`)은 편의 장치이며 강제력이 없습니다. 부트스트랩을 실행하지 않은 환경에서는 아예 동작하지 않고, 실행한 환경에서도 `--no-verify`로 우회됩니다.

`pre-push` 훅은 push 대상 원격이 이 프로젝트의 공개 저장소일 때만 `main` 브랜치와 태그 외의 ref push를 거부합니다. 자기 포크로 가는 push는 이 제한을 받지 않습니다. 저장소 이름이 바뀌면 이 판별이 더 이상 맞지 않게 되어, 모든 push를 통과시키는 방향으로 실패합니다. 실제로 강제되는 것은 CI 검사와 아래 메인테이너 참고의 브랜치 보호 규칙뿐입니다.

## 이슈와 라벨

이슈를 만들 때는 다음 라벨 중 해당하는 것을 고릅니다.

`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`

## 차용 코드와 라이선스

본 프로젝트에 기여한 코드는 [MIT License](./LICENSE) 하에 배포됩니다. 풀 리퀘스트를 보내면 이 라이선스에 동의하는 것으로 간주합니다.

CCP는 다른 오픈소스 프로젝트의 코드를 일부 차용했습니다. 차용 파일과 상류 프로젝트, 라이선스의 대응 관계는 [아키텍처](./docs/ko/architecture.md) 문서의 '차용 코드' 절에서 확인할 수 있습니다. 차용 파일을 수정하거나 새 차용을 추가할 때는 그 절과 [`LICENSES/`](./LICENSES/) 디렉터리의 라이선스 원문을 함께 갱신합니다.

## 메인테이너 참고

이 저장소를 유지보수하는 사람은 별도의 개발 하네스를 씁니다. 그 작업 산출물이 쌓이는 디렉터리는 이 저장소에서 추적하지 않으므로, 클론한 환경에서는 빈 상태로 시작됩니다. 기여에 이 하네스 사용은 필요하지 않습니다.

`main` 브랜치는 보호되어 있습니다. 풀 리퀘스트를 거쳐야 하고, CI의 필수 검사를 모두 통과해야 하며, 관리자는 이 요구를 우회할 수 있습니다. 필수 검사 목록은 CI 워크플로우의 잡 이름과 매트릭스(Node 버전 등)를 그대로 참조하므로, 잡 이름이나 매트릭스를 바꾸면 브랜치 보호 규칙도 함께 갱신해야 합니다. `v`로 시작하는 태그도 보호되어 있어 삭제하거나 옮길 수 없습니다.

## 행동 강령

본 프로젝트는 모든 기여자에게 상호 존중과 건설적인 토론을 요청합니다. 부적절한 행동(괴롭힘, 차별, 인신공격)은 메인테이너가 즉시 차단합니다.

## 문의

- GitHub Issues: 일반 질문, 버그, 기능 제안
- 보안 취약점: GitHub Security Advisory(비공개)
