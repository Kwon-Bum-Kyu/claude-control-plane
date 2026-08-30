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
- **`subagent/`** -- rescue subagent exit-side isolation. See below.

## Subagent isolation check

A dispatched rescue subagent (`ccp:codex-rescue`, `ccp:antigravity-rescue`)
must record exactly one `Bash` tool call in its own transcript, and that
command must be its companion `rescue` invocation -- no other Bash command.

This is stated for a foreground dispatch. A background dispatch is defined
to return from that same single companion call, but it has not been
observed yet, so read the rule as foreground-scoped until it has.

Every other check in this repository looks at the *main* Claude context.
None of them can see what a subagent did inside its own, isolated
transcript -- so a subagent that reads raw files into its own context and
forwards only an interpretation would leave every other check green while
the isolation it exists for is gone. This check reads the subagent's own
transcript instead of the main conversation, closing that blind spot.

### Why this runs locally, not in CI

Subagent transcripts live in Claude Code's local session storage
(`~/.claude/projects/<project>/<session>/subagents/`), not in this
repository -- a CI checkout has no session to read. The judging logic
itself (command-shape parsing, chain-scan, verdict rules) is still
regression-tested in CI against committed synthetic transcripts (see
"Fixture regression" below); only the real-session check requires a human
to run it after actually using a rescue command.

### Running it

1. Dispatch at least one rescue subagent in this project, e.g.
   `/ccp:codex-rescue ...` or `/ccp:antigravity-rescue ...`, so Claude Code
   writes a session with a `subagents/` directory.
2. Find that session directory (or stay in the same terminal and use
   `--latest` to auto-discover it).
3. Run the check and read the verdict:
   ```
   node tests/subagent/rescue-isolation-test.mjs <session-dir>
   # or:
   node tests/subagent/rescue-isolation-test.mjs --latest
   ```

Run `node tests/subagent/rescue-isolation-test.mjs --help` for the full
option list (`--agent-type`, `--json`, `--max-command-chars`, ...).

### Reading the result

| Verdict | Exit code | Meaning | Next action |
|---|:--:|---|---|
| **PASS** | `0` | Every target subagent recorded exactly one `Bash` call, and it matched its companion `rescue` invocation. | Nothing to do -- the contract held for this session. |
| **FAIL** | `1` | At least one target subagent violated the contract (extra `Bash` calls, wrong command shape, a chained command, a mismatched adapter, ...). | Read the listed violations. Do not edit this check to make it pass -- report the violation; fixing the offending agent is a separate change. |
| **SKIP** | `2` | Nothing could be verified: no target subagent in this session, unreadable/incomplete transcript evidence, or a Claude Code storage layout this check doesn't recognize. | **Treat as unverified, not as a pass.** Dispatch a rescue subagent and re-run, or -- if the storage layout changed -- file an issue with a redacted sample. |
| usage error | `64` | Bad arguments, or `<path>` missing without `--latest`. | Run `--help`. |

A SKIP result is never equivalent to a PASS. This check exists specifically
to catch a case where every other, main-context check stayed green while an
isolation violation happened out of sight -- reading a SKIP as "nothing
went wrong" reproduces exactly that blind spot. Quote the verdict word
itself ("SKIP") in QA notes and PR descriptions; do not paraphrase it as
"passed" or "clean."

### Fixture regression (CI-safe)

```
node tests/subagent/rescue-isolation-fixture-test.mjs
```

This runs the same judging engine (`rescue-isolation-test.mjs --json`)
against a fixed set of synthetic, anonymized transcripts committed under
`tests/subagent/fixtures/`, and compares the result to
`tests/subagent/fixtures/expected.json`. It is what actually runs in CI for
this check family, since it needs no local session.

The cases cover all three verdicts: compliant calls (every companion
entry-point shape, including a task passed through a heredoc), every
violation kind, every SKIP reason a directory can express, sessions that
mix two subagents, and false-positive traps -- shell metacharacters inside
quoted arguments, an escaped backtick in a task, and an unquoted pipe that
is a real pipe and must therefore be reported. One case deliberately has no
directory at all: the runner passes a path that does not exist, to check
that a missing path is reported as SKIP rather than as a failure. Do not
create that directory.

Unlike the real-session check, this runner never exits SKIP -- a fixture is
always present, so an unexpected SKIP here means the check itself is
broken, not that a real session was unverifiable. All cases must pass; there
is no partial-credit threshold (same rule as `router-eval.mjs`).

### Storage layout dependency

This check reads Claude Code's local session storage format -- session
directory -> `subagents/` -> `agent-*.jsonl` + `.meta.json` pairs ->
`message.content[]` tool-use blocks. That layout is Claude Code's internal
storage, not a documented public interface, and it can change between
Claude Code versions without notice.

When the layout doesn't match what this check expects, it exits SKIP
instead of guessing. A SKIP of that shape is a signal that the check may
need updating for a newer Claude Code version -- not that the isolation
contract held. File an issue with a redacted sample if you hit this.
