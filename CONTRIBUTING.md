# Contributing to CCP

CCP (Claude Control Plane) 에 기여해 주셔서 감사합니다. 본 문서는 기여 절차와 라이선스 동의 방식을 안내합니다.

## 빠른 시작

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

## 라이선스

본 프로젝트에 기여한 코드는 [MIT License](./LICENSE) 하에 배포됩니다. PR 을 보내시면 본 라이선스에 동의하시는 것으로 간주됩니다.

ecc 차용 파일을 수정하시는 경우, 변경 사항을 [ATTRIBUTION.md](./ATTRIBUTION.md) §1.1 표에 추가해 주세요.

## 행동 강령

본 프로젝트는 모든 기여자에게 상호 존중과 건설적인 토론을 요청합니다. 부적절한 행동(괴롭힘, 차별, 인신공격) 은 즉시 메인테이너가 차단합니다.

## 문의

- GitHub Issues: 일반 질문·버그·기능 제안
- 보안 취약점: GitHub Security Advisory (private)

---

기여해 주셔서 감사합니다 🙏
