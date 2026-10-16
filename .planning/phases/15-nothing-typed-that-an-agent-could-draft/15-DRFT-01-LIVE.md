# DRFT-01 live observation: the planner declares a per-task file-set

**What this artifact is.** A record of one real `claude` planning-run session, driven by
`node scripts/uat/uat-14-planner-file-set.mjs --live`, writing a plan through the production
`submit_plan` path.

## Scope: what this does and does not evidence

The measurement ran against the harness's **six-file scratch repository**, not against a real
codebase. The developer chose that target at the plan 15-04 decision checkpoint (`burn-both-now`,
scratch repo): no real repository was registered and no integration branch was cut.

It therefore evidences exactly one thing: **a live model, given a `git ls-files` listing, declares
file-sets from that listing rather than inventing a set, and the production writer stores them.**

It does **not** evidence file-set *quality* on a real codebase. Two limits make that explicit:

- The scratch epic's task titles name the files for two of the three tasks ("Parser: ... in
  `src/parser.rs`", "Renderer: ... in `src/render.rs`"). Declaring those is close to reading the
  title back. Only PLN-4 ("Docs: write the user guide") required the model to infer a path
  (`docs/guide.md`).
- With six files in the listing there is almost nothing to get wrong. Whether the model declares
  sensible, sufficiently wide sets in a repository with hundreds of paths, or answers `undeclared`
  when it should, is **not measured here**.

## Run identity

| Field | Value |
|-------|-------|
| Planning run id | `01M51NG5QWFJDH1QKXFEFST83V` |
| Model (from the session's `system` init event) | `claude-opus-5-5` |
| Claude Code | `2.1.292 (Claude Code)` |
| Captured at | 2026-10-16T06:13:54Z (session start 06:13:29Z) |
| Epic | `PLN-1` "Plan the fan-out" |
| Task keys given | `PLN-2` (Parser), `PLN-3` (Renderer), `PLN-4` (Docs) |
| Permission mode | `default`; `submit_plan` the only pre-approved tool; every other permission request denied |
| Session end | harness-initiated `interrupt` after `submit_plan` returned (`session_closed: interrupted`; the `result` event reads `error_during_execution`, which is the interrupt, not a model failure) |

## The listing the prompt carried

The `## Files In This Repository` section held **6 paths** and was **not truncated** (the declared
ceiling `PLANNING_LISTING_CEILING` is 2000; no "not shown" count appeared):

```
Cargo.toml
README.md
docs/guide.md
src/lib.rs
src/parser.rs
src/render.rs
```

The prompt (2698 characters) also carried the `undeclared` instruction paragraph, verified present
by the script's `prompt` check.

## The raw `submit_plan` payload, verbatim

This is the `input` of the model's own `mcp__flywheel-permissions__submit_plan` tool_use block
(event seq 32 of the session timeline):

```json
{
  "tasks": [
    {
      "key": "PLN-2",
      "files": ["src/parser.rs"],
      "wave": 1,
      "rationale": "Trailing-comma handling is confined to parse() in src/parser.rs; no dependency or module changes needed.",
      "undeclared": false
    },
    {
      "key": "PLN-3",
      "files": ["src/render.rs"],
      "wave": 1,
      "rationale": "Separator joining lives entirely in render() in src/render.rs; disjoint from the parser task.",
      "undeclared": false
    },
    {
      "key": "PLN-4",
      "files": ["docs/guide.md"],
      "wave": 2,
      "rationale": "The guide (docs/guide.md, currently a stub) should describe the final parser and renderer behaviour, so it waits for PLN-2 and PLN-3.",
      "undeclared": false
    }
  ],
  "excluded": []
}
```

The writer accepted it: `{"planId":"01M51NGXSFKN9YDNNHPD44BXBG"}`.

## Per task

| Task | Declared entries | Wave | Answered `undeclared`? | Rationale (model's words) |
|------|------------------|------|------------------------|---------------------------|
| PLN-2 | `src/parser.rs` | 1 | no | Trailing-comma handling is confined to parse() in src/parser.rs; no dependency or module changes needed. |
| PLN-3 | `src/render.rs` | 1 | no | Separator joining lives entirely in render() in src/render.rs; disjoint from the parser task. |
| PLN-4 | `docs/guide.md` | 2 | no | The guide (docs/guide.md, currently a stub) should describe the final parser and renderer behaviour, so it waits for PLN-2 and PLN-3. |

No task answered `undeclared`. That means the `undeclared` escape hatch was **not exercised live**:
this run shows the model declares when it can, not that it declines when it cannot.

## Declared paths absent from the prompt's listing

**None.** All 3 declared paths (`src/parser.rs`, `src/render.rs`, `docs/guide.md`) are present in the
6-path listing; 0 were absent. No invented path was observed. Given the scratch scale, this is a weak
negative: an invented path is easy to avoid when the listing is six lines long.

## Tools the model used, and `Bash`

Read from the session timeline (assistant `tool_use` blocks, in order):

1. `Bash` (seq 14), command: `for f in Cargo.toml README.md docs/guide.md src/lib.rs src/parser.rs src/render.rs; do echo "== $f"; cat "$f"; done` with description "Show repository file contents". **Denied** by the harness (it was not pre-approved).
2. `ToolSearch` (seq 17), query `select:mcp__flywheel-permissions__submit_plan` (loading the deferred MCP tool).
3. `Read` x4 (seq 20, 22, 24, 26): `src/parser.rs`, `src/render.rs`, `src/lib.rs`, `docs/guide.md`, each by absolute path inside the epic worktree.
4. `mcp__flywheel-permissions__submit_plan` (seq 32), the single submission.

**The model attempted `Bash` once, and it was refused.** It then recovered through `Read` without
asking again. That is the behaviour the research flag asked about: with `submit_plan` the only
pre-approved tool, read tools reached the model through the default permission path (no permission
request was raised for any `Read`), `Bash` was not available to it, and the planner still produced a
complete plan.

Separately, the harness recorded 9 further `Bash` permission requests (git status/log/remote/config
probes and an `ls-files --error-unmatch .claude/settings.local.json`) that do **not** correspond to
any assistant `tool_use` block. They were all denied and none affected the outcome. Their origin
(Claude Code's own start-up probing versus the sidecar) is not established by this run.

The model never used `Grep` or `Glob`; with six files it read every non-manifest file directly.

## The stored plan, read back from the database

Read back through the production reader (`plan-readback`) from the plan the writer stored, not
derived from the payload:

| Task | `files` | `wave` | `state` | Event actor | Event `after` |
|------|---------|--------|---------|-------------|---------------|
| PLN-2 | `["src/parser.rs"]` | 1 | `planned` | `agent` | `["src/parser.rs"]` |
| PLN-3 | `["src/render.rs"]` | 1 | `planned` | `agent` | `["src/render.rs"]` |
| PLN-4 | `["docs/guide.md"]` | 2 | `planned` | `agent` | `["docs/guide.md"]` |

Stored edges: **none** (`edges: []`). The three declared sets are pairwise disjoint, so no
file-collision edge was derived. PLN-4's wave 2 is the model's declared ordering, not a stored edge.

## Verdict per criterion-1 clause

ROADMAP Phase 15 success criterion 1:

- **(a) The planner declares each task's expected file-set, observed working against a live
  backend and recorded as an artifact.** `observed`. A real session stored a plan of 3 tasks, 3
  declared (3 paths, 3 present in `git ls-files`, 0 absent), 0 answered `undeclared`. Observed against
  the scratch tree only; see "Scope" above.
- **(b) The declared paths show as chips marked "drafted by the planner", derived from the event
  actor rather than stored.** `not-measured`. Owned by plan 15-05, which owns the chip surface. This
  run only confirms the data source exists: each task's `task.file_set_declared` event is
  agent-authored.
- **(c) The hand-typed path field is still there as the same form with no prefill.**
  `not-measured`. Owned by plan 15-05.

## Mechanism checks this live run exercised

`prompt` (observed), `stored` (observed: every task stored `planned`), `event` (observed:
agent-authored, null-`after` exactly when nothing declared). `refusals`, `order` and `edge` are
`not-measured` in `--live` by design; they belong to `--offline`, which passed in the same sitting.

## Provenance

The raw JSON evidence (prompt, listing, permission requests, submission event, read-back, report) was
written by the script to `--artifact`, and the session timeline by the harness. This document
reproduces the load-bearing parts verbatim. No credential-shaped value appears in this document:
the session ran under an isolated `CLAUDE_CONFIG_DIR` and no wire line was committed.
