# 변경 이력

이 파일에는 이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고, 버전 번호는 [Semantic Versioning](https://semver.org/)을 따릅니다.

각 버전 항목은 해당 태그의 커밋 이력을 바탕으로 작성합니다.

## [Unreleased]

## [v0.4.1] - 2026-09-27

### 추가

- `/ccp:codex-rescue`와 `/ccp:antigravity-rescue`에 `--mcp NAME[,NAME...]` 플래그를 추가했습니다. 위임 직전에 대상 CLI의 MCP 서버 등록 목록을 확인해, 적은 서버가 미등록이거나 비활성이거나 목록을 읽지 못하면 새 공용 에러 코드 `CCP-MCP-001`로 중단하고 직접 실행할 등록·활성화 명령을 안내합니다. 이에 따라 어댑터 계약에 `mcp.listArgs`, `mcp.parseList`, `mcp.installCommand`를 추가해 리프 키가 55개가 되었습니다.

### 수정

- `/ccp:audit`가 companion과 같은 job 경로와 결과 키(`result_path`)를 읽도록 고쳤습니다.
- 라우터의 매직 키워드 매칭에 경계 규칙을 추가해 이메일 형태 문자열 등에서 발생하던 부분 문자열 오탐을 없앴습니다.
- 헤드리스 자동화 경고가 단어 일부에 반응하던 오탐을 단어 경계 매칭으로 바로잡았습니다.
- 존재하지 않는 플래그와 커맨드를 가리키던 에러 안내 문구를 실제 안내에 맞게 고쳤습니다.
- `/ccp:audit` 설명을 실제 8개 카테고리 판정식에 맞췄습니다.

### 변경

- envelope 스키마의 `$id` 값을 저장소 경로로 바꿨습니다.
- `pre-push` 훅을 공개 레포로 가는 push에만 적용합니다. 자기 포크로 가는 push는 제한하지 않습니다.
- CI에 요약 절단 검사 스텝을 추가했습니다.
- background 호출에서 받기만 하고 쓰지 않던 `--poll-interval-ms` 값의 내부 전달 경로를 제거했습니다. 플래그는 계속 받지만 효과는 없습니다.
- 코드와 프롬프트에서 README 섹션 번호 참조를 파일 경로 참조로 바꿨습니다.
- 감사 커맨드 이름을 `ccp-audit`에서 `audit`으로 바꿨습니다.
- 개발용 비공개 레포와 공개 레포를 통합했습니다.

### 문서

- 한국어 문서를 기본 문서로 전환했습니다. `README.md`는 한국어이고 `README.en.md`는 영어입니다.

## [v0.4.0] - 2026-08-26

- companion 코어를 통합하고, 그 과정에서 발견한 결함을 수정했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.3.0...v0.4.0

## [v0.3.0] - 2026-06-15

- 위임 대상 CLI를 Gemini에서 Antigravity로 전환했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.2...v0.3.0

## [v0.2.2] - 2026-05-17

- gemini-companion의 rescue 호출에서 발생하던 인자 스코프 누수(ReferenceError)를 수정했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.1...v0.2.2

## [v0.2.1] - 2026-05-12

- 버전을 0.2.1로 올리고 marketplace 메타데이터를 동기화했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.0...v0.2.1

## [v0.2.0] - 2026-05-06

- 최초 태그 릴리스입니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/commits/v0.2.0

[Unreleased]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.4.1...HEAD
[v0.4.1]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.1
[v0.4.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.0
[v0.3.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.3.0
[v0.2.2]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.2
[v0.2.1]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.1
[v0.2.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.0
