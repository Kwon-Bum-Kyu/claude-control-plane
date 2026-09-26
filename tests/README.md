# CCP 테스트 스위트

서로 독립된 검사 계열이 두 가지 있습니다. 한쪽 하위 디렉터리를 바꿔도 다른 쪽은 그대로 둘 수 있습니다.

- **`router/`**: 훅과 분류기의 회귀를 검사합니다. `router-suggest-test.mjs`(라우터 추천 훅 시나리오, 오분류 0건이 게이트), `router-eval.mjs`(3-way 분류기 정확도, 오분류 0건이 게이트), `EVAL_DATASET.md`(데이터셋 설명 문서)로 구성됩니다.
- **`companion/`**: CLI 어댑터 계약과 골든 envelope를 회귀 검사합니다. `contract-test.mjs`(어댑터 계약 검사: 새 CLI 어댑터를 추가할 때 `core/*.mjs`를 한 글자도 고칠 필요가 없어야 한다는 것을 확인), `golden/diff.mjs`(envelope 출력을 커밋된 기준선과 비교, diff 0 건이 게이트), `truncation-probe.mjs`(요약 절단 경계 케이스, 실패 0건이 게이트)로 이루어집니다.
