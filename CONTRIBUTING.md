# Contributing to CCP

CCP (Claude Control Plane) 에 기여해 주셔서 감사합니다. 본 문서는 기여 절차와 라이선스 동의 방식을 안내합니다.

## 빠른 시작

0. 클론 직후 1회: `node tools/repo-guard.mjs bootstrap` — 로컬 git 훅을 활성화합니다 (`git config core.hooksPath .githooks` 를 대신 실행합니다)
1. 이슈 생성 또는 기존 이슈 확인 (한국어/영어 모두 환영)
2. 포크 → 브랜치 생성 (`feat/<topic>` 또는 `fix/<topic>`)
3. 변경 사항 작성, 테스트 추가, 로컬 검증 (`/ccp:audit`)
4. **DCO 서명 커밋** (`git commit -s`) — 아래 §DCO 참조
5. PR 생성 (한국어/영어 모두 가능)

## DCO (Developer Certificate of Origin)

본 프로젝트는 **DCO** 를 채택합니다. CLA(별도 서명) 는 요구하지 않습니다.

모든 커밋은 다음과 같이 `Signed-off-by` 트레일러를 포함해야 합니다:

```
git commit -s -m "feat: add new feature"
```

→ 커밋 메시지에 다음이 자동 추가됩니다:

```
Signed-off-by: Your Name <you@example.com>
```

이로써 https://developercertificate.org 의 DCO v1.1 에 동의한 것으로 간주됩니다.

## 커밋 메시지 규약

[Conventional Commits](https://www.conventionalcommits.org) 형식 권고:

| 타입 | 용도 |
|------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 |
| `refactor` | 코드 리팩토링 (동작 변경 없음) |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드·CI·기타 |

예: `feat(router): add Korean keyword detection`

## 코드 스타일

- ESM 모듈 (`.mjs`) 또는 `"type": "module"` 사용
- Node.js 내장 모듈 우선 (외부 npm 의존성은 PR 에서 정당화 필요)
- envelope 스키마는 [`plugins/ccp/schemas/envelope.schema.json`](./plugins/ccp/schemas/envelope.schema.json) SSOT 준수 (JSON Schema)
- 에러 코드는 `^CCP-[A-Z]+-[0-9]{3}$` 정규식 매칭

## 이슈 가이드

| 카테고리 | 라벨 |
|----------|------|
| 버그 | `bug` |
| 기능 제안 | `enhancement` |
| 문서 | `documentation` |
| 라우터 정확도 | `router` |
| Gemini CLI 호환성 | `gemini-cli` |
| 한국어 키워드 | `i18n-ko` |

## 이 레포의 배포 방식

이 레포는 **공개 레포 하나**입니다. 별도의 비공개 레포에서 내보내는 구조가 아니므로, **커밋해서 push 하면 그 순간 공개**됩니다. 되돌리는 커밋을 추가로 올려도 이미 공개된 내용은 회수되지 않습니다.

추적하지 않는 것은 두 부류뿐입니다 — (가) 이 레포를 개발하는 데 필요 없는 파일, (나) 비밀 정보나 개인정보를 담은 파일. 정확한 목록은 [`.gitignore`](./.gitignore) 에 있습니다.

### 릴리스 절차

1. 변경 사항을 커밋하고 `main` 에 올립니다. 태그를 push 하면 GitHub Release 가 생성됩니다.
2. CI 의 `guard-ignore`·`guard-content`·`guard-public-surface` 세 잡이 배포 경계를 검사합니다. 실패하면 내용을 되돌리는 커밋을 추가로 push 해 고칩니다.
3. **`git push --all` 을 쓰지 마십시오.** 이 명령은 로컬의 모든 브랜치를 한 번에 올려 의도하지 않은 이력을 공개합니다. `.githooks/pre-push` 가 `refs/heads/main` 과 `refs/tags/*` 외의 ref push 를 거부하지만, 이 훅은 위 0번 부트스트랩을 실행한 기기에서만 동작합니다.

### 로컬 훅의 한계

`.githooks/` 의 훅 3종은 **편의 장치이며 강제력이 없습니다.** 부트스트랩을 실행하지 않은 기기에서는 아예 동작하지 않고, 실행한 기기에서도 `--no-verify` 로 우회됩니다. 실제로 강제되는 것은 CI 쪽 검사뿐입니다. 이 사실을 숨기지 않고 적어 두는 이유는, 훅이 있다는 것만 보고 보호받고 있다고 오인하지 않게 하기 위해서입니다.

### 작성 규칙

공개 표면에는 외부 독자가 의미를 추론할 수 없는 작업자 전용 식별자를 쓰지 않습니다. 적용 대상과 제외 대상의 정확한 목록, 치환 방식은 [`.claude/rules/no-internal-tracking-ids.md`](./.claude/rules/no-internal-tracking-ids.md) 에 있고, `guard-public-surface` 잡이 같은 목록으로 검사합니다.

`tools/repo-guard.mjs` 는 자작 코드입니다. 외부 프로젝트의 스캐너나 정규식을 차용하지 않았습니다. 차용을 추가하시는 경우 [`LICENSES/`](./LICENSES/) 에 라이선스 원문을 넣고 아래 라이선스 절의 차용 매핑을 갱신해 주세요.

## 메인테이너용 참고

- **하네스**: 이 레포를 유지보수하는 사람은 전역 개발 하네스를 사용합니다. 그 설정은 추적되지 않는 로컬 파일에 있고, 하네스 산출물이 쌓이는 작업 디렉터리도 추적되지 않으므로 클론한 환경에서는 빈 상태로 시작됩니다. 기여에 하네스 사용은 필요하지 않습니다.
- **사전 승인 명령**: 이 레포를 Claude Code 로 열면 [`.claude/settings.json`](./.claude/settings.json) 의 명령 4개가 사전 승인됩니다. 메인테이너 편의 설정이므로 기여자는 자유롭게 무시하거나 재정의해도 됩니다.
- **이전 개발 이력**: 단일 레포로 통합하기 전의 작업 이력은 비공개 아카이브 레포 `https://github.com/Kwon-Bum-Kyu/claude-control-plane-dev` 에 보존되어 있습니다 (읽기 전용).

## 라이선스

본 프로젝트에 기여한 코드는 [MIT License](./LICENSE) 하에 배포됩니다. PR 을 보내시면 본 라이선스에 동의하시는 것으로 간주됩니다.

차용 파일 (ecc·omc·codex-plugin-cc) 을 수정하시거나 신규 차용을 추가하시는 경우, [`LICENSES/codex-plugin-cc-NOTICE.txt`](./LICENSES/codex-plugin-cc-NOTICE.txt) 의 차용 파일 매핑을 갱신해 주세요. 신규 상위 프로젝트 도입 시 라이선스 원문을 [`LICENSES/`](./LICENSES/) 에 추가해 주세요.

## 행동 강령

본 프로젝트는 모든 기여자에게 상호 존중과 건설적인 토론을 요청합니다. 부적절한 행동(괴롭힘, 차별, 인신공격) 은 즉시 메인테이너가 차단합니다.

## 문의

- GitHub Issues: 일반 질문·버그·기능 제안
- 보안 취약점: GitHub Security Advisory (private)

---

기여해 주셔서 감사합니다 🙏
