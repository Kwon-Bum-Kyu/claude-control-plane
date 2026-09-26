# Router

The CCP router decides which of three targets a user prompt should be sent to: Claude (the main control plane), Antigravity, or Codex. The router's decision logic is implemented as a single function, and the suggestion hook, the router agent, and the regression tests all use this function together. The decision rules in this document match the actual behavior.

## Default behavior

When a user runs the `/ccp:antigravity-rescue` or `/ccp:codex-rescue` slash command directly, delegation always goes to that CLI without going through this decision logic. The 4-axis decision order described below applies only when an ordinary prompt, not a slash command, is given.

By default, the router's decision does not automatically execute delegation. The `UserPromptSubmit` hook only shows the decision as a suggestion message; the actual delegation happens only after the user reviews the suggestion and runs the slash command themselves. The "Auto-routing (opt-in)" section below describes how to make the decision automatically carry through to delegation.

## Decision order

The router checks four axes in order. If an earlier axis produces a decision, the later axes are not checked.

### Axis A: explicit user signal

This is the first axis checked. It checks the following signals in this order.

1. If the prompt contains the string `/ccp:antigravity-rescue` or `/ccp:codex-rescue` and does not contain `--fallback-claude`, it is decided as that CLI. If `--fallback-claude` is also present, this condition is skipped and the next condition decides Claude.
2. If `--fallback-claude` or `--force-claude` is present, it is decided as Claude.
3. If `--effort` or `--sandbox workspace-write` is present, it is decided as Codex.
4. If a magic keyword matches in the text with code blocks removed, it is decided as the target that keyword points to. Magic keywords are described in the "Magic keywords" section below.

Run the following command to check the second condition.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "review this code --force-claude"
```

This prompt contains `--force-claude`, so it is decided as Claude.

### Axis B: input size

If axis A does not produce a decision, the router looks at the input size. It estimates the token count by splitting the prompt into words on whitespace, multiplying the word count by 1.3, and rounding up.

- If the estimated tokens are under 5,000, this axis does not decide and falls through to axis C. It decides Claude only when no word matches any of axis C's keyword dictionaries (reason `too_small`). So even a short prompt is decided as the matching target if a keyword matches.
- If the estimated tokens are between 5,000 and 30,000 inclusive, it decides Codex only when a word matches the Codex keyword dictionary. Otherwise it falls through to axis C.
- If the estimated tokens exceed 30,000, it decides Codex when a word matches the Codex keyword dictionary, and Antigravity otherwise.

### Axis C: keywords

If axes A and B do not produce a decision, the prompt is checked against four kinds of keyword dictionaries. The dictionaries' contents are described in the "Keyword dictionaries" section below. A match against the main-context-reference dictionary takes priority over a match in any other dictionary and decides Claude, because a conversation that references the previous response or a command just run would lose context if delegated.

### Axis D: conservative default

If none of the previous three axes match, it is decided as Claude. This decision's reason_code is `AXIS_D_DEFAULT_CONSERVATIVE`. Despite its name, axis B's "estimated tokens under 5,000" decision belongs to axis B, not axis D, and its reason_code is `AXIS_B_TOO_SMALL`.

## Keyword dictionaries

The router uses four keyword dictionaries. English vocabulary takes priority, with Korean vocabulary included as a supplement.

- Antigravity dictionary: contains vocabulary categories related to large-scale summarization and whole-codebase analysis.
- Codex dictionary: contains vocabulary categories related to code review, bug investigation, and diff analysis.
- Claude dictionary: contains vocabulary categories related to small edits, adding types, and writing tests.
- Main-context-reference dictionary: contains expressions that point to the previous response or a command just run.

The exact word lists are defined by the code. You can check them in the repository's `plugins/ccp/scripts/lib/router.mjs`.

When matching dictionaries against the prompt, informational context is filtered out. If, within 80 characters before or after the matched word, there is an expression asking for an explanation, such as "what is this", "how to use", or "explain", that match is ignored. This judgment recognizes expressions in English, Korean, Japanese, and Chinese. Run the following two commands to see how the results differ.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "please do a code review"
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "What is a code review? Please explain, I am curious, I am curious, I am curious."
```

The first prompt matches the Codex dictionary, so it is decided as Codex. The second prompt contains the same word, but because it is in a context asking for an explanation, the match is ignored.

## Magic keywords

A magic keyword is a notation that lets a user directly specify the intended target, regardless of size or dictionary matches. Within axis A, after checking slash mentions and options, code blocks are removed and magic keywords are checked.

- Antigravity: `@antigravity`, `@ag`, `@안티` (the older notations `@gemini`, `@젬`, `@제미니` are also recognized as the same target.)
- Codex: `@codex`, `@코덱`, `@코덱스`
- Claude: `@claude`, `@클`, `@클로드`
- `@auto`, `@자동`: a marker that does not point to any specific target. When this marker is present, it falls through to axes B, C, and D as-is.

Magic keywords have boundary rules. All magic keywords share a common leading boundary: if a letter, period, plus sign, or hyphen immediately precedes the keyword, it is not treated as a match. So `@ag` inside an e-mail-address-shaped string like `bob@agency` does not match. ASCII-only keywords (`@ag`, `@codex`, and so on) also have a trailing boundary: if a letter or hyphen follows, it is not treated as a match, so `@agent` does not match `@ag`. Korean keywords (`@안티`, `@코덱`, and so on) have no trailing boundary, because a Korean particle attaches directly after the keyword (for example, `@코덱스로 확인해줘`).

Code blocks are also excluded from matching. Magic keywords inside a code block wrapped in three backticks, or inline code wrapped in backticks, are ignored. This handling applies equally to matching against the keyword dictionaries in the "Keyword dictionaries" section above, not just to magic keywords.

Run the following command to check the leading-boundary rule.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "check the wording to send to bob@agency"
```

In this prompt, `@ag` is inside what looks like an e-mail address, so it is not recognized as a magic keyword, and the decision is not Antigravity.

```
node plugins/ccp/scripts/lib/router-decide.mjs --prompt "@codex please look at this diff"
```

In this prompt, `@codex` is recognized as a magic keyword, so axis A decides Codex.

## Auto-routing (opt-in)

Auto-routing is a setting that makes the router agent actually carry out delegation, instead of using the router's decision only as a hook suggestion. The default is off; it is turned on by changing the `config.auto_routing` value in the plugin manifest (`plugins/ccp/.claude-plugin/plugin.json`) to `true`.

Even when auto-routing is turned on, delegation does not happen when headless use is certain. If any one of the following three signals is true, it is judged as headless.

- When the environment variable `CI` has the value `true` or `1`
- When the environment variable `CLAUDE_CODE_NONINTERACTIVE` has the value `1` or `true`
- When the environment variable `CLAUDE_CODE_ENTRYPOINT` has a value and that value is not `cli`

`router-decide.mjs` is the CLI entry point that runs the router decision directly, and it accepts the following flags.

- `--prompt "<text>"`: the prompt to judge. You can also give it JSON with a `{prompt|user_prompt|input}` key over standard input.
- `--auto-routing on|off`: overrides the auto-routing setting for this session.
- `--no-auto-route`: turns off auto-routing for this single call only.

The `summary` value of a successful result returned by `router-decide.mjs` starts with the `[CCP-ROUTER-002]` marker. This marker is not an error code; it is a prefix indicating a successful routing decision.

The result's `auto_routed` value is computed as follows. Auto-routing is considered active only when it is turned on, headless is not confirmed, and the call has not opted out with `--no-auto-route`. In that state, `auto_routed` is `true` only when the decided target is not Claude. In every other case, it is `false`.

The result also carries a `reason_code` value. It is one of the following twelve.

| reason_code | Axis where it occurs |
|---|---|
| `AXIS_A_SLASH` | Axis A, slash mention or magic keyword match |
| `AXIS_A_OPTION` | Axis A, `--effort` or `--sandbox workspace-write` |
| `AXIS_A_FALLBACK_CLAUDE` | Axis A, `--fallback-claude` or `--force-claude` |
| `AXIS_B_OVERSIZED` | Axis B, when estimated tokens exceed 30,000 and there is no Codex keyword |
| `AXIS_B_MID_REVIEW` | Axis B, when estimated tokens are between 5,000 and 30,000, or exceed 30,000 with a Codex keyword present |
| `AXIS_B_TOO_SMALL` | Axis B, when estimated tokens are under 5,000 |
| `AXIS_C_KW_ANTIGRAVITY` | Axis C, Antigravity dictionary match |
| `AXIS_C_KW_CODEX` | Axis C, Codex dictionary match |
| `AXIS_C_KW_CLAUDE` | Axis C, Claude dictionary match |
| `AXIS_C_MAIN_CONTEXT_BIND` | Axis C, main-context-reference dictionary match |
| `AXIS_D_DEFAULT_CONSERVATIVE` | Axis D, when nothing else matches |
| `OPT_OUT_NO_AUTO_ROUTE` | When opted out for this call only with `--no-auto-route` |

## Headless warning

The headless warning is judged separately from auto-routing's headless determination. When the router has decided Antigravity or Codex and the hook is showing a suggestion message, if the prompt has an expression that suggests headless use, a phrase marked with `[CCP-META-WARN]` is appended after the suggestion message. Instead of meta-exploration such as `--help` or a route that goes through Skill to Agent, this phrase recommends running a companion script directly, such as `node plugins/ccp/scripts/codex-companion.mjs rescue --task <task>` or `node plugins/ccp/scripts/antigravity-companion.mjs rescue --task <task>`.

Headless use is suspected if one of the following conditions is true. If the prompt has a slash mention starting with `/ccp:codex-` or `/ccp:antigravity-`, it is not suspected as headless regardless of the conditions below.

- When the prompt has `headless`, `claude -p`, `automation`, `스크립트`, or `자동화`, matched with word boundaries. `cron` is checked without a trailing boundary, so it also covers `crontab`.
- When the prompt has the standalone, all-uppercase word `CI`. The lowercase `ci` is not judged.

## Overriding the decision

- Including the string `/ccp:antigravity-rescue` or `/ccp:codex-rescue` in the prompt decides that CLI.
- Adding a magic keyword (`@antigravity`, `@codex`, `@claude`, and so on) forces the decision to the intended target, regardless of size or dictionary match.
- Adding `--fallback-claude` or `--force-claude` forces Claude.
- In a session where auto-routing is on, you can change the session-level setting with `--auto-routing on|off`, or turn off auto-routing for this single call with `--no-auto-route`.
- Running the `/ccp:antigravity-rescue` or `/ccp:codex-rescue` slash command directly always delegates without going through the decision logic above at all.

## Next

The [Architecture](./architecture.md) document describes the router's full delegation path.
