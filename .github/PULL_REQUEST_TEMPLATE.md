<!-- Thanks for contributing to CCP. Fill out each section so reviewers can verify the change quickly. -->

## Summary

<!-- 1-3 bullets: what changed and why. Link related issues with `Fixes #123` or `Refs #123`. -->

-

## Test plan

<!-- Concrete verification steps. CI runs the four jobs below; list anything you ran locally as well. -->

- [ ] `node --check` passes for every changed `.mjs` under `plugins/ccp/scripts/`
- [ ] `node tests/router/router-eval.mjs` — 70/70 PASS (or unchanged baseline)
- [ ] `node tests/router/router-suggest-test.mjs` — ≥18/19 PASS (95%)
- [ ] `node plugins/ccp/scripts/harness-audit.js` — total ≥ 33/40
- [ ] Manual smoke test for any affected slash command (`/ccp:antigravity-*`, `/ccp:codex-*`, `/ccp:*`)
- [ ] `node tests/subagent/rescue-isolation-fixture-test.mjs` — fixture logic regression (all cases)

## Borrowed-code checklist (skip if N/A)

<!-- Required when touching files that carry adapted upstream code. Those files declare
     their origin in a header comment; `docs/en/architecture.md` lists them all. -->

- [ ] License text added to `LICENSES/` if a new upstream project is introduced
- [ ] If an adapted file moved or was renamed, `docs/en/architecture.md` and
      `docs/ko/architecture.md` were updated in the same commit
- [ ] If an adapted Apache-2.0 file changed, its header comment still describes the
      upstream origin and the modifications accurately

## DCO sign-off

<!--
By signing below you certify the Developer Certificate of Origin (https://developercertificate.org/).
Add a `Signed-off-by:` trailer to your commits with `git commit -s`.
-->

- [ ] I have signed off all commits with `git commit -s`

## Notes for reviewers

<!-- Optional: areas you want extra scrutiny on, follow-ups deferred to a later PR, etc. -->
