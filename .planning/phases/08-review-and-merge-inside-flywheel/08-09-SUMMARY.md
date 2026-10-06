---
phase: 08-review-and-merge-inside-flywheel
plan: 09
subsystem: review
tags: [rust, tauri, react, epic-scope, criteria-rollup, gap-closure]
status: complete
gap_closure: true

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "CriteriaRail and the epic scope toggle (08-06, 08-08); criterion_anchors table (08-02); the 08-VERIFICATION gap this closes"
provides:
  - "review::epic_task_rollup: read-only, connection-only query returning each task of an epic with checked/total/with_evidence/without_evidence over current criterion revisions"
  - "review_epic_task_rollup: one Tauri command taking an epic id and nothing else, registered in main.rs and the capability roster"
  - "reviewEpicTaskRollup adapter wrapper and useEpicTaskRollup hook"
  - "Epic-scope 'Task criteria roll-up' section in CriteriaRail (absent in task scope and for an epic with no tasks)"
affects: []

requirements-completed: [REVW-02]

duration: "~30 min"
completed: 2026-10-06

actuals:
  tokens: 7000
  tasks: 2
  commits: 2
plan_head_before: 4a541088c971dff5a84a4531712072b7b8b9038b

coverage:
  - deliverable: "Core roll-up query: per-task checked/total/evidence counts, current revisions only, rank-then-id order, empty for no tasks or unknown epic, read-only with no git spawn"
    verification:
      - kind: test
        ref: "packages/core/tests/criterion_anchors.rs (6 tests named rollup_*; file total 26 passing)"
        status: pass
    human_judgment: false
  - deliverable: "review_epic_task_rollup command registered in generate_handler! and the capability roster, signature carries an epic id only"
    verification:
      - kind: command
        ref: "grep -c 'commands::review::review_epic_task_rollup' main.rs = 1; grep -c review_epic_task_rollup default.json = 1; signature grep = 1; cargo build --workspace ok"
        status: pass
    human_judgment: false
  - deliverable: "Epic-scope rail section lists every task with count text; task scope renders nothing and issues no read; empty epic renders no heading or placeholder"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/criteria-rail.test.tsx (CriteriaRail epic roll-up, 3 cases)"
        status: pass
    human_judgment: false
  - deliverable: "WINDOWS.md row 28 closed"
    verification:
      - kind: command
        ref: "node gsd-tools.cjs windows fixed 28; open_count 19 -> 18, fixed_count 9 -> 10"
        status: pass
    human_judgment: false
  - deliverable: "Roll-up legibility beside a long diff at review width"
    human_judgment: true
    rationale: "Visual and ergonomic judgement; rides the existing end-of-phase rail-ergonomics check in 08-VERIFICATION's human_verification block. The packaged app was not driven."

key-files:
  created: []
  modified:
    - packages/core/src/review.rs
    - packages/core/tests/criterion_anchors.rs
    - packages/desktop/src-tauri/src/commands/review.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/review/useReviewQuery.ts
    - packages/desktop/src/review/CriteriaRail.tsx
    - packages/desktop/src/review/__tests__/criteria-rail.test.tsx
    - packages/desktop/src/review/__tests__/epic-request.test.tsx
    - packages/desktop/src/review/__tests__/merge-sheet.test.tsx
    - packages/desktop/src/review/__tests__/review-surface.test.tsx
    - .planning/WINDOWS.md

key-decisions:
  - "The roll-up carries no integrated marker (unlike forge::request_body's roll-up): that marker needs merge::is_integrated, which spawns git, and would put a subprocess back under the database lock (CR-01)."
  - "The command has no scope parameter: it is epic-only by construction, so the renderer supplies one id and nothing else."
  - "without_evidence is computed in Rust as checked - with_evidence rather than a fourth subquery, so the two always sum to checked."

---

# Phase 8 Plan 09: Epic Task Criteria Roll-Up Summary

**Epic scope in the review rail now lists every task of the epic with its checked-of-total criteria count and its checked-without-evidence count, read through one epic-id-only command over a git-free SQL query that counts current criterion revisions only. This closes D-132, the failed plan truth in 08-VERIFICATION, and WINDOWS.md row 28.**

## Accomplishments

- **Core query (ab960cc).** `epic_task_rollup(conn, epic_id)` is one prepared statement: tasks of the epic ordered by rank then id, with three correlated subqueries over `acceptance_criteria` sharing `superseded_at IS NULL` (total, checked, checked-with-an-anchor). `without_evidence` is derived in Rust. An unknown epic or an epic with no tasks returns an empty vector. The doc comment records why it is read-only, why it spawns no git, and why it has no integrated marker.
- **One command, registered twice (ab960cc).** `review_epic_task_rollup(state, epic_id)` takes the lock, calls the query, releases it, maps rows to `EpicTaskRollupRowDto`. It is in `generate_handler!` and in the capability roster (name plus one sentence in the same style as its neighbours).
- **Adapter, hook, rail (ab960cc).** `reviewEpicTaskRollup`, `epicTaskRollupQueryKey`, `useEpicTaskRollup` (copied from `useEpicRequestDraft`: `enabled`-gated, one `subscribeBoardChanged` invalidation, `staleTime: 0`, no polling). `CriteriaRail` calls the hook with `scope === "epic"`, so task scope issues no read, and renders a `region` named "Task criteria roll-up" only when the array is non-empty. Rows read `{key} {title}` over `{checked}/{total} criteria checked` or `no criteria`, with `, N without evidence` appended only when above zero. Tokens only, no hex.
- **Tests.** Six `rollup_*` core tests (counts and evidence split, no-criteria zeros, superseded revision excluded via a locked revise, empty and unknown epic, equal-rank task-id order stable across two reads, other epic's tasks not counted). Three vitest cases (epic lists both tasks and counts, task scope has no region and zero calls, empty epic has no region or heading). The other three adapter mock factories gained a `reviewEpicTaskRollup` entry.
- **Ledger (7d3ea4e).** `windows fixed 28` via the ledger's own mechanism.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | ab960cc | Roll-up query, command, registration, adapter, hook, rail section, tests |
| 2 | 7d3ea4e | WINDOWS.md row 28 closed |

## Phase-8 invariants re-proved after the change

| Proof | Observed |
| ----- | -------- |
| `UPDATE (tasks\|epics)` across `merge.rs`, `review.rs`, `request_body.rs`, `commands/review.rs`, `commands/forge.rs` | 0, 0, 0, 0, 0 |
| `--force`, `force-with-lease`, `--delete` in `git.rs` | 0 |
| Write verb or `crate::git` / `crate::merge` inside `epic_task_rollup` | 0 |
| Roll-up command signature `(state: State<AppState>, epic_id: String)` | exactly 1 match |

## Verification

- `cargo test -p core --test criterion_anchors`: 26 passed (20 baseline + 6). `... rollup`: 6 passed.
- `cargo build --workspace`: ok (one pre-existing dead-code warning in `agent_run.rs`, not this plan's).
- `cargo test --workspace -- --skip credential --skip api_key`: exit 0, 97 suites ok, 0 failed (same suite count as 08-08; the `credentials` binary blocks on the macOS keychain unattended, pre-existing per 08-03).
- Review vitest set named in 08-VERIFICATION (`src/review`, `review-doors`, `session-surface`): 160 passed, which is the 157 baseline plus 3. `src/review` alone is 99 passed across 5 files; the plan's 157 figure counts the two extra files.
- `npx tsc --noEmit`: clean.
- Greps: command path in `main.rs` = 1; `review_epic_task_rollup` lines in `capabilities/default.json` = 1 (the roster entry and the explanatory sentence share the file's single description line, as for every neighbour); `reviewEpicTaskRollup` in `epic-request.test.tsx` = 1.
- WINDOWS.md: row 28 `fixed` with `resolved_at`; `open_count` 19 -> 18, `fixed_count` 9 -> 10; `grep -c '| open |'` = 18.

## Deviations from Plan

None - plan executed exactly as written.

One test was reshaped while writing, not a deviation from the plan's behavior list: the superseded-revision case first used an unlocked task, where `revise_criterion` edits in place and creates no revision. It now locks the task with `start_agent_run` (as the existing 08-02 revise test does) so a real superseded row exists, and asserts the roll-up counts the successor once, with its inherited check and anchor.

## Issues Encountered

- A borrow error on the first compile (`stmt` dropped while the `query_map` temporary was live); fixed by collecting into a local before returning.

## Known Stubs

None.

## Threat Flags

None beyond the plan's `<threat_model>`. T-08-09-01 (epic id only, parameterised, read-only), T-08-09-02 (no subprocess under the lock) and T-08-09-04 (superseded revisions excluded, named test) are mitigated as planned.

## Follow-up

- Still open from 08-VERIFICATION and not this plan's scope: CR-03 keyboard activation (plan 08-10), CR-01 lock split and CR-02 error categories (plan 08-11), and the six human checks.
- The packaged app was not driven; roll-up legibility is covered by the existing end-of-phase rail-ergonomics check.

## Self-Check: PASSED

All 12 modified source files and `.planning/WINDOWS.md` exist and are tracked; commits ab960cc and 7d3ea4e are in `git log`; `git rev-list --count` from `plan_head_before` is 2.
