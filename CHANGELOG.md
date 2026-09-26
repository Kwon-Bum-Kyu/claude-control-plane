# 변경 이력

이 파일은 이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 를 따르고, 버전 번호는 [Semantic Versioning](https://semver.org/) 을 따릅니다.

각 버전 항목은 해당 태그의 커밋 이력을 근거로 합니다.

## [Unreleased]

### 수정

- `/ccp:audit` 가 companion 과 같은 job 경로와 결과 키(`result_path`)를 읽도록 고쳤습니다.
- 라우터의 매직 키워드 매칭에 경계 규칙을 추가해서 이메일 형태 문자열 같은 부분 문자열 오탐을 없앴습니다.
- 헤드리스 자동화 경고가 단어 일부에 반응하던 부분 문자열 오탐을 단어 경계 매칭으로 고쳤습니다.
- 존재하지 않는 플래그와 커맨드를 가리키던 에러 안내 문구를 실재하는 안내로 고쳤습니다.
- `/ccp:audit` 설명을 실제 8개 카테고리 판정식과 일치하도록 고쳤습니다.

### 변경

- envelope 스키마의 `$id` 값을 실제 저장소 경로로 바꿨습니다.
- `pre-push` 훅의 적용 범위를 공개 레포로 가는 push 로 좁혔습니다. 자기 포크로 가는 push 는 제한하지 않습니다.
- CI 에 요약 절단 검사 스텝을 추가했습니다.
- 코드와 프롬프트 안의 README 섹션 번호 참조를 파일 경로 참조로 바꿨습니다.
- 감사 커맨드 이름을 `ccp-audit` 에서 `audit` 으로 바꿨습니다.
- 개발용 비공개 레포와 공개 레포를 하나로 합쳤습니다.

### 문서

- 한국어 문서를 메인으로 전환했습니다. `README.md` 는 한국어, `README.en.md` 는 영어입니다.

## [v0.4.0] - 2026-08-26

- companion 코어를 통합하고, 통합 과정에서 발견한 결함을 수정했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.3.0...v0.4.0

## [v0.3.0] - 2026-06-15

- 위임 대상 CLI 를 Gemini 에서 Antigravity 로 전환했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.2...v0.3.0

## [v0.2.2] - 2026-05-17

- gemini-companion 의 rescue 호출에서 발생하던 인자 스코프 누수(ReferenceError)를 고쳤습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.1...v0.2.2

## [v0.2.1] - 2026-05-12

- 버전을 0.2.1 로 올리고 marketplace 메타데이터를 동기화했습니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.2.0...v0.2.1

## [v0.2.0] - 2026-05-06

- 최초 태그 릴리스입니다.

**전체 변경 이력**: https://github.com/Kwon-Bum-Kyu/claude-control-plane/commits/v0.2.0

[Unreleased]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/compare/v0.4.0...HEAD
[v0.4.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.4.0
[v0.3.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.3.0
[v0.2.2]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.2
[v0.2.1]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.1
[v0.2.0]: https://github.com/Kwon-Bum-Kyu/claude-control-plane/releases/tag/v0.2.0
