# Router behavior

The CCP router decides whether a user prompt should be handled by Claude (the main control plane), Gemini (`/gemini:rescue`), or Codex (`/ccp:codex-rescue`). It uses a four-axis priority order: each axis can short-circuit the decision before lower-priority axes are consulted.

The router decision logic lives in a single shared module used by the recommendation hook, the offline regression dataset, and the router agent — so the behavior described here matches the runtime.

## The four axes

```
[user prompt]
     v
[axis A] explicit user signal       (slash command, --effort, --sandbox, --fallback-claude)
     v   (no match)
[axis B] input size                 (>30K -> Gemini, 5K-30K + review keyword -> Codex)
     v   (no match)
[axis C] keyword catalog            (codex > gemini > claude; main-context-bind forces claude)
     v   (no match)
[axis D] fallback                   (Claude, conservative default)
```

### Axis A — explicit user signal (highest priority)

The user is always right. The following inputs route deterministically:

| Signal | Decision |
|---|---|
| `/gemini:rescue ...` | Gemini |
| `/ccp:codex-rescue ...` | Codex |
| `--fallback-claude` | Claude (overrides any later axis) |
| `--effort` / `--sandbox` / `--write` / `--cwd` | Codex (Codex-only flags) |
| `--max-tokens` | Gemini (Gemini-only flag) |

### Axis B — input size

When the prompt has no explicit signal, the router estimates token count (`words * 1.3`) and applies size thresholds:

| Estimated tokens | Decision |
|---|---|
| `> 30,000` | Gemini (large summarization) |
| `5,000 - 30,000` and contains a review keyword (`review`, `diff`, `audit`, etc.) | Codex |
| Otherwise | falls through to axis C |

### Axis C — keyword catalog

If neither A nor B fires, the router scans the prompt for actionable English and Korean keywords, using `hasActionableTrigger` (word-boundary matching) and ignoring code blocks via `removeCodeBlocks`. Order of precedence:

1. **Main-context-bind keywords** (`just now`, `above`, `previous response`, `just (edited|wrote|ran)`, ...) -> **forces Claude**. These signal that the prompt depends on conversation state that delegation cannot see.
2. **Codex keywords** (`review`, `diff`, `bug`, `audit`, `refactor`, ...) -> Codex.
3. **Gemini keywords** (`summarize`, `extract`, `large file`, `log`, ...) -> Gemini.
4. **Claude keywords** (`explain`, `walk me through`, ...) -> Claude.

Any match inside a triple-backtick code block is ignored, and any match that occurs inside an `INFORMATIONAL_INTENT_PATTERNS` window (`what is X?`, `how does X work?`, ...) is downgraded to Claude. This blocks false positives where the keyword is descriptive rather than imperative.

### Axis D — conservative fallback

If none of the above matched, the router returns Claude. The reasoning: Claude is the main context, so a wrong delegation costs more than a missed delegation.

## Calibration

The router ships with a 65-case offline regression dataset. Current accuracy: **65/65 = 100%**, with precision/recall >= 0.93 for every model. CI runs the dataset on every PR.

## How to influence the decision

| Want | Do |
|---|---|
| Force Gemini regardless of size | Use `/gemini:rescue` |
| Force Codex regardless of size | Use `/ccp:codex-rescue` |
| Force Claude regardless of keywords | Add `--fallback-claude` |
| See what the router decided | Look at `details.mode` in the envelope or run `/ccp:audit` |

## The router-suggest hook (v0.2)

The router-suggest hook runs on `UserPromptSubmit`. It computes the same decision and, if the result is `gemini` or `codex`, injects a `[CCP-ROUTER-001]` system reminder suggesting the appropriate slash command. **It never auto-delegates.** The user always types the slash command themselves. This honors Principle 4 (no automatic fallback on delegation failure) while still nudging users toward the right tool.

When the prompt looks headless (`claude -p`, `automation`, `cron`, `CI`, ...) the hook additionally injects a `[CCP-META-WARN]` notice that recommends pre-scripting the slash command. See [token-saving patterns](./architecture.md#token-saving-patterns) for the rationale.

## Anti-patterns

- **Repeating a prompt with minor variations** to "find" a delegation entry point. The router is deterministic; the second attempt will route the same way.
- **Calling `/gemini:rescue --help` from inside a headless script** to discover flags. Cache the help output once and reference it; do not pay for it on every run.
- **Forcing Codex on small refactors** (`< 5K` tokens) when no review keyword is present. The size threshold exists because Codex's reasoning overhead is wasted on small edits.

## Related reading

- [Slash command reference](./slash-commands.md)
- [Architecture](./architecture.md) for the seven principles, including the no-auto-fallback rule
- [Troubleshooting](./troubleshooting.md) for `CCP-ROUTER-001` and friends
