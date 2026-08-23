---
name: feedback-evidence-survival-before-teardown
description: 격리 루트 내부에만 존재하는 원본 로그/파일을 인용해 심각도를 매긴 결함은, teardown의 rm -rf 전에 evidence/로 보존됐는지 반드시 확인할 것
metadata:
  type: feedback
---

E2E 하니스에서 최고 심각도(S1) 결함(D-010, antigravity 헤드리스 실행 중 내부 모델의 셸 명령 시도가 print-mode 확인 게이트에 자동 거부되어 실패)의 근본원인 근거는 `agy.log` 원문의 "soft-denying tool confirmation" 로그 줄이었다. 그런데 이 로그 파일은 `$E2E_ROOT/src-copy/_workspace/_jobs/<job_id>/agy.log`(격리 루트 **안**)에만 존재했고, `evidence/`나 `$SAFE_DIR`로 복사되지 않았다. `defects.jsonl`/진행 문서에는 그 내용을 **산문으로 인용**만 해 두었다. 문제는 `$E2E_ROOT`가 teardown 시점에 `rm -rf`로 통째 삭제된다는 것 — 즉 이 결함의 1차 근거는 teardown과 동시에 영구 소실되고, 이후 남는 것은 재현 불가능한 paraphrase뿐이다.

**Why:** `01_schema.md` §7.0/§7.1이 강제하는 순서(증적 보존 A-T1 → 검증 → 격리 루트 삭제)는 `evidence/` 디렉터리 자체에는 적용되지만, **`evidence/` 밖에 남아있는 호스트 로컬 원본 파일**(격리 루트 안의 job 산출물처럼)은 A-T1의 단순 복사(`cp -R evidence/. $SAFE_DIR/`) 대상이 아니다. 결함 기록자가 "발췌만 인용, 원본은 호스트 로컬"이라고 명시적으로 적어 둔 것 자체가 이 gap을 알고도 넘어간 신호이므로, QA가 놓치면 G2 승인 이후에야(또는 승인 자체가 이 근거 부재로 도전받을 때) 발견된다.

**How to apply:** 결함(특히 S1/S2급) evidence 필드에 `evidence/` 트리 밖의 경로(호스트 로컬 파일, 격리 루트 하위 경로 등)가 인용돼 있으면 즉시 (1) 그 파일이 아직 존재하는지 직접 확인하고, (2) 그 파일이 teardown(`rm -rf $E2E_ROOT` 등 파괴적 정리)의 사정권 안에 있는지 확인한 뒤, (3) 사정권 안이면 "teardown 진입 전 최우선으로 evidence/ 또는 $SAFE_DIR로 원본을 보존할 것"을 즉시 상위 보고에 포함한다. "산문으로 인용했으니 됐다"는 근거가 되지 않는다 — 원문 자체가 도전에 버티는 증거다. 관련: [[project-e2e-run-20260821]].
