# CCP test suite

Three check families live here, one per subdirectory. Each is independent --
a change in one never requires touching the others.

- **`router/`** -- hook and classifier regression. `router-suggest-test.mjs`
  (19 hook scenarios), `router-eval.mjs` (72-case 3-way classifier accuracy,
  0 misclassifications required), `EVAL_DATASET.md` (dataset notes).
- **`companion/`** -- CLI adapter contract and golden-envelope regression.
  `contract-test.mjs` (adapter contract: adding a CLI adapter requires zero
  changes to `core/*.mjs`), `golden/diff.mjs` (envelope output vs. a
  committed baseline), `truncation-probe.mjs` (summary-truncation edge case).
