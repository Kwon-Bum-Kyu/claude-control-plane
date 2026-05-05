# Router Regression Dataset — 70 cases

This dataset is used by `tests/router/router-eval.mjs` to verify the routing decisions of `plugins/ccp/scripts/lib/router.mjs`.

## 1. Composition

| Class | Cases | Share |
|-------|------:|------:|
| Claude-favoured (`C01~C16`, `B01~B05`) | 21 | 30.0% |
| Gemini-favoured (`G01~G15`, minus `G09` which is codex-favoured) | 14 | 20.0% |
| Codex-favoured (`G09`, `X01~X14`, magic keywords from `F16~F20`) | 19 | 27.1% |
| False-positive guards (`F01~F15`) | 15 | 21.4% |
| Boundary cases (`B01~B05`, alt label permitted) | 5 (overlaps with C class) | — |
| Magic-keyword (`F16~F20`) | 5 | 7.1% |

ID prefixes are kept stable across runs so debug output stays diffable.

## 2. Acceptance criteria

| Metric | Threshold |
|--------|-----------|
| Overall accuracy | ≥ 98% (1 miss allowed) |
| Clear-case accuracy | 100% |
| Boundary-case accuracy (alt label allowed) | ≥ 80% |
| False-positive guard accuracy | 100% |
| Per-class precision and recall (claude / gemini / codex) | ≥ 0.93 |

## 3. Class label rationale (selected examples)

### Claude (C01–C16)

Claude is the right target when the task is short, depends on the previous main-context turn, or is a single-line edit:

- `C01` — add null check to `formatDate` (single function, single edit)
- `C03` — TypeScript readonly vs const assertion (factual question, axis B `too_small`)
- `C08` — review **the code I just edited** ("방금" forces `main_context_bind`)
- `C16` — `eslint --fix` autofix (CLI invocation, claude keyword)

### Gemini (G01–G15, except G09)

Gemini is the right target for large-context summarization or directory-wide analysis:

- `G01` — slash command `/gemini:rescue` with explicit prompt (axis A user-explicit)
- `G03` — summarize the entire repository in 3 lines (`estimated_tokens` 80,000)
- `G06` — parse a 500MB access log (`large log` keyword + size)
- `G08` — read the whole project and identify security risks (100,000 tokens)

### Codex (G09 + X01–X14)

Codex is the right target for code review, diff analysis, and bug investigation:

- `G09` — review a 10,000-line PR diff (5,000 ≤ tokens ≤ 30,000 + review keyword → `mid_review_codex`)
- `X01–X03` — explicit `/ccp:codex-rescue` slash invocations (axis A)
- `X04` — `--effort high` flag (axis A user-explicit option)
- `X05` — `--sandbox workspace-write` flag (axis A user-explicit option)
- `X06–X09` — review/diff/bug-investigation prompts in the 5K–30K range
- `X10–X14` — multi-keyword cases (codex keyword wins over gemini under priority rules)

### Boundary cases (B01–B05)

Cases where two labels are acceptable. The runner accepts either `expected` or `alt_label`:

- `B01` — pattern-find across 3 small files (claude or gemini)
- `B05` — duplicate-test detection in a 1,000-line test file (claude or codex)

### Main-context-bind override

Triggered by phrases that anchor the task to the previous turn. These force `claude` regardless of other matches:

`방금` · `위에서` · `이전 응답` · `이전 출력` · `실행한 명령` · `just now` · `just edited` · `above` · `previous response` · `previous output` · `last command`

### False-positive guards (F01–F20)

- `F01–F05` — keywords inside ` ``` ` code blocks must NOT trigger delegation
- `F06–F10` — informational questions ("what is review?") must NOT trigger delegation
- `F11–F15` — English actionable keywords must trigger correctly
- `F16–F20` — magic keywords (`@gemini`, `@젬`, `@codex`, `@코덱`, `@claude`, `@auto`) trigger axis A

## 4. How to run

```bash
node tests/router/router-eval.mjs
```

The runner prints a per-case grading table, per-class precision/recall, and an overall verdict.
