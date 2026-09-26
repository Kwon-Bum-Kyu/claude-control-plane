# Claude Control Plane (CCP)

> Claude 를 메인 컨트롤 플레인으로 두고 Antigravity CLI 와 Codex CLI 에 작업을 위임하는 Claude Code 플러그인입니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

영어 문서는 [English README](./README.en.md) 에서 확인할 수 있습니다.

## 소개

Claude 가 코드베이스, 로그, 문서처럼 큰 컨텍스트를 혼자 처리하면 메인 세션의 토큰이 빠르게 소진됩니다. CCP 는 이런 작업을 Antigravity CLI 와 Codex CLI 에 위임합니다. 메인 세션에는 짧은 요약과 결과 파일 경로만 돌려줘 토큰 누적을 막습니다.

위임 경로는 세 가지입니다. Claude 본체, 대용량 요약·분석을 맡는 Antigravity CLI, 코드 리뷰와 diff 분석을 맡는 Codex CLI 입니다. 라우터는 요청의 입력 크기와 키워드 등을 살펴 적절한 경로를 추천합니다. 기본 설정에서는 자동으로 위임하지 않습니다. 사용자가 슬래시 커맨드로 직접 지정하거나 `auto_routing` 설정을 켜면 위임합니다. [라우터](./docs/ko/router.md) 문서에서 결정 방식을 확인할 수 있습니다.

Antigravity 위임은 agy 가 요청하는 도구 권한을 기본적으로 자동 승인합니다. 이 동작을 끄는 방법은 [시작하기](./docs/ko/getting-started.md) 문서의 '설정과 보안' 절에서 확인할 수 있습니다.

## 설치

다음 명령으로 플러그인을 설치하고 다시 불러옵니다.

```
/plugin marketplace add Kwon-Bum-Kyu/claude-control-plane
/plugin install ccp@claude-control-plane
/reload-plugins
```

다음 명령으로 사용하려는 CLI 의 설치와 인증 상태를 진단합니다.

```
/ccp:antigravity-setup
/ccp:codex-setup
```

Node.js 버전 요구사항과 각 CLI 의 설치·인증 절차는 [시작하기](./docs/ko/getting-started.md) 문서에서 확인할 수 있습니다.

## 빠른 시작

다음 명령은 Antigravity 에 요약 작업을 위임합니다.

```
/ccp:antigravity-rescue "이 저장소의 핵심 구조를 요약해줘"
```

다음 명령은 Codex 에 코드 리뷰를 위임합니다.

```
/ccp:codex-rescue "이 PR 의 diff 를 검토하고 잠재적 버그를 알려줘"
```

두 예시 모두 메인 세션에는 요약과 결과 파일 경로만 돌아옵니다. 나머지 사용법은 [슬래시 커맨드](./docs/ko/slash-commands.md) 문서에서 확인할 수 있습니다.

## 문서

- [시작하기](./docs/ko/getting-started.md): 사전 조건, CLI 설치와 인증, 첫 위임 예시, 설정과 보안을 다룹니다.
- [슬래시 커맨드](./docs/ko/slash-commands.md): 커맨드 목록과 플래그, 응답 envelope 을 안내합니다.
- [라우터](./docs/ko/router.md): 3-way 라우팅 결정 방식을 안내합니다.
- [아키텍처](./docs/ko/architecture.md): 설계 원칙과 위임 경로를 안내합니다.
- [문제 해결](./docs/ko/troubleshooting.md): 에러 코드와 자주 묻는 질문을 안내합니다.

기여 방법은 [CONTRIBUTING.md](./CONTRIBUTING.md) 문서에서 확인할 수 있습니다.

라이선스는 [MIT](./LICENSE) 입니다.
