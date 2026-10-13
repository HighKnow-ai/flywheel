---
phase: 07-the-board-tells-the-git-truth
plan: 08
subsystem: git-integration
tags: [rust, typescript, forge, github, gitlab, react, tanstack-query, tauri]

requires:
  - phase: 07-the-board-tells-the-git-truth (plan 07-03)
    provides: "forge::{Forge, ForgeState, CiResult, ForgeRequest, ForgeError}, forge_for_project, request_for_branch — the normalized model and dispatch this plan's commands and ForgeSection.tsx compose against"
  - phase: 07-the-board-tells-the-git-truth (plan 07-07)
    provides: "forge/transitions.rs's three event types and query::forge::latest_forge_baseline — the append-only log this plan's board_forge_flags/latest_unmet_criteria_count read, never re-deriving forge state independently"
provides:
  - "query::forge::{ForgeFlag, board_forge_flags, latest_unmet_criteria_count} — the board's bounded, log-only CI-failure/unmet-criteria rollup and the item panel's per-task unmet-criteria sibling read"
  - "commands/forge.rs — forge_request_for_task (live per-item read), board_forge_flags, settings_set_project_forge, project_forge_overrides (the Settings read half)"
  - "item-detail/ForgeSection.tsx — request state, CI result with a link out, the D-123 marker, three distinguishable CLI-error notices, absence when no forge is configured"
  - "board/BoardRow.tsx's fourth pill (ciFailed) and board/BoardView.tsx's useForgeFlags wiring"
  - "settings/SettingsSurface.tsx's fifth section, Forge Override"
  - "forge_probe --both — one command probing two forges, for LINK-08's live human check"
affects: [07-09]

actuals:
  tokens: 26353
  tasks: 3
  commits: 3
plan_head_before: c61a8b06bc6bec557c4c1bbc10c76c6ed6a2ba57

tech-stack:
  added: []
  patterns:
    - "Board-level rollup from the event log, never a live forge call: board_forge_flags reads the SAME forge.ci_failed/forge.state_changed/task.done_with_unmet_criteria events the poll job (07-07) already writes, via one query with its LIMIT applied in SQL (a bounded DISTINCT task_id subquery, two correlated per-task reads) — the board's paint path never shells out (T-07-08-04)."
    - "Item-panel vs board-row split: the SAME forge fact (a task's current CI/criteria state) is read through two different paths depending on caller — forge_request_for_task shells out live (D-75, one gh/glab call per panel open, affordable), board_forge_flags reads the log (bounded, affordable per row). Both derive from the SAME underlying observations; neither caches a verdict the other could disagree with."
    - "A tagged outcome DTO over a bare Option/Result: ForgeReadDto's eight variants (NoWorktree/NoForgeConfigured/NoRequest/Request/four CLI-error categories) replace what would otherwise be two nested Option/Result layers a frontend caller would have to re-derive meaning from — the renderer switches on one discriminant, never infers 'no request' vs 'no forge' from two different kinds of None."
    - "A per-project override section reads its OWN DTO list (ProjectForgeOverrideDto, carrying projectName), never the project roster directly — mirrors the existing credential-override section's shape exactly, and is what keeps a test exercising an unrelated Settings section from needing a forge-specific mock to suppress this one."

key-files:
  created:
    - packages/desktop/src-tauri/src/commands/forge.rs
    - packages/desktop/src/item-detail/ForgeSection.tsx
    - packages/desktop/src/item-detail/__tests__/forge-section.test.tsx
    - packages/desktop/src/board/__tests__/ci-flag.test.tsx
    - packages/core/tests/forge_board_flags.rs
  modified:
    - packages/core/src/query/forge.rs
    - packages/core/tests/bin/forge_probe.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/settings/SettingsSurface.tsx

key-decisions:
  - "The D-123 unmet-criteria count is read by a NEW per-task function, query::forge::latest_unmet_criteria_count, not carried on ForgeRequest or re-derived from board_forge_flags's bulk rollup — the plan's own DTO design for forge_request_for_task never named this field, but the <behavior> contract requires the marker, and pulling the whole project-scoped board rollup for one task's row would be the wrong shape. Reads the SAME task.done_with_unmet_criteria event board_forge_flags folds in."
  - "forge_request_for_task resolves Forge::Local via forge_for_project BEFORE calling request_for_branch, specifically so NoForgeConfigured and NoRequest are distinguishable DTO outcomes — request_for_branch's own Ok(None) collapses both cases, and the frontend's D-120 absence path needs to tell 'no forge' apart from 'forge configured, nothing open yet' even though both currently render identically (null)."
  - "project_forge_overrides (a 4th command beyond Task 1's declared 3) was added as a Rule 2 deviation — Task 2's own action text asks the Settings surface to show a per-project forge select whose value reflects the CURRENT override, and settings_set_project_forge is write-only; without a read half the control could only ever display 'Detected', making 'saves each, including clearing back to Detected' unverifiable by the user."

requirements-completed: [LINK-05, LINK-06, LINK-08]

coverage:
  - id: D1
    description: "With no forge configured, the forge section renders nothing at all — a genuinely empty container, not merely an absent label (D-120)"
    requirement: "LINK-08"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/forge-section.test.tsx#renders a genuinely empty container — zero children, not merely an absent label — for the no-forge-configured outcome"
        status: pass
    human_judgment: true
    rationale: "Proven at the component level with a mocked adapter (forgeRequestForTask resolves { outcome: \"noForgeConfigured\" }; the test asserts both toBeEmptyDOMElement() and container.children.length === 0). NOT independently verified end-to-end against a real running app with a real project that has no forge configured — no live UAT was performed in this plan. The backend half (forge_request_for_task resolving to NoForgeConfigured for a Forge::Local project without spawning any process) is build-verified only in this plan; the underlying no-spawn guarantee at the forge::request_for_branch layer was proven by 07-03's forge_degrade.rs suite, re-confirmed green in this plan's scoped run (see Verification Performed below), but commands/forge.rs's own mapping of that into NoForgeConfigured has no dedicated Rust-level test of its own."
  - id: D2
    description: "A request's CI result links out to the actual CI run (ciUrl), never the request's own URL or a repo-root link, when ciUrl is present"
    requirement: "LINK-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/forge-section.test.tsx#renders the %s CI result with a link out when ciUrl is present (Pending/Passed/Failed, each asserting href === the CI URL fixture)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/forge-section.test.tsx#renders the request's number, title and an external link to its URL (a DIFFERENT fixture URL, asserted separately)"
        status: pass
    human_judgment: true
    rationale: "Proven that ForgeSection.tsx renders request.ciUrl verbatim as the CI link's href, structurally distinct from request.url (the PR link) — two separate tests, two separate expected hrefs, no shared fixture value, so the component cannot pass by accidentally wiring the wrong field. NOT verified: that the ci_url VALUE itself (as populated by github.rs/gitlab.rs's normalize() functions) is actually the CI run and not some other forge-reported URL — that provenance is 07-03's own scope, proven by forge_normalize.rs's fixture-based tests against frozen real gh/glab JSON, not re-verified here. Also not verified: a live click-through in a real browser against a real CI run (deferred to Task 3's own <human-check>, end-of-phase UAT per workflow.human_verify_mode)."

duration: 86min
completed: 2026-10-02
status: complete
---

# Phase 7 Plan 8: The Forge On The Item Summary

**`ForgeSection.tsx` renders a task's forge request state, CI result and unmet-criteria marker (or nothing at all with no forge configured), a board-row CI-failure pill joins Blocked/Needs Decision, and `forge_probe --both` gives LINK-08's live check one command.**

## Performance

- **Duration:** 86 min
- **Started:** ~2026-10-02T11:33:00Z
- **Completed:** 2026-10-02T12:58:43Z
- **Tasks:** 3
- **Files modified:** 18 (5 created, 13 modified)

## Accomplishments

- `query::forge::board_forge_flags` — a bounded, log-only per-project CI-failure/unmet-criteria
  rollup (D-124/D-123) with its `LIMIT` applied in SQL to the distinct-task-id subquery, never
  after collecting; a malformed payload degrades to no flag for that task. `latest_unmet_criteria_count`
  is its per-task sibling, added beyond the plan's own DTO design (see Deviations) for the item
  panel's D-123 marker.
- `commands/forge.rs` — `forge_request_for_task` (a live per-item read distinguishing
  no-worktree / no-forge-configured / no-request / a request / four typed CLI-error categories,
  never leaking raw stderr across the IPC boundary), `board_forge_flags`, `settings_set_project_forge`,
  and `project_forge_overrides` (a Rule 2 deviation, the Settings read half)
- `ForgeSection.tsx` — renders null for the three "nothing to show" outcomes (D-120's absence
  discipline), otherwise the request's number/title/state with a link out, the CI result (linked
  when `ciUrl` is present, nothing when there is no CI), the D-123 unresolved-criteria marker, and
  three distinguishable CLI-error notices. Mounted in `ItemDetailPanel.tsx` after `GitFactsSection`.
- `BoardRow.tsx`'s fourth pill (`ciFailed`), wired from `BoardView.tsx`'s `useForgeFlags(projectId)`
  read — reaches no status-column write (D-122)
- `SettingsSurface.tsx`'s fifth section, Forge Override — a four-value per-project select
  (Detected/GitHub/GitLab/Local only), reading its own `projectForgeOverrides` list
- `forge_probe --both <repo:branch> <repo:branch>` — one command, one exit code, for LINK-08's
  live human check; the original single-pair mode's output is byte-identical (smoke-tested)
- 29 new frontend tests (`forge-section.test.tsx` 21, `ci-flag.test.tsx` 8) and 8 new backend
  tests (`forge_board_flags.rs`)

## Task Commits

Each task was committed atomically:

1. **Task 1: The board-level flag read, and the two commands** - `19d5cb1` (feat)
2. **Task 2: The forge section, the row flag, and the Settings override** - `1c3ab1c` (feat)
3. **Task 3: The live two-forge check, as one command per forge** - `355e0eb` (feat)

_No separate RED/GREEN/REFACTOR commits: `workflow.tdd_mode` is off for this run, so the hard TDD
gate was not enforced. Both `tdd="true"` tasks were implemented with their proving tests written
and passing in the same commit as the implementation they prove — same convention 07-03/07-07
used._

## Files Created/Modified

- `packages/core/src/query/forge.rs` — `ForgeFlag`/`board_forge_flags`/`latest_unmet_criteria_count`
- `packages/desktop/src-tauri/src/commands/forge.rs` — the four-command forge surface
- `packages/desktop/src-tauri/src/{commands/mod.rs,main.rs}`, `capabilities/default.json` — registration
- `packages/core/tests/forge_board_flags.rs` — 8 tests over the rollup
- `packages/core/tests/bin/forge_probe.rs` — `--both` mode
- `packages/desktop/src/adapters/tauri.ts` — the four TS wrappers + DTOs
- `packages/desktop/src/board/useBoardQuery.ts` — `useForgeRequest`/`useForgeFlags`
- `packages/desktop/src/item-detail/ForgeSection.tsx` / `__tests__/forge-section.test.tsx`
- `packages/desktop/src/item-detail/ItemDetailPanel.tsx` — mounts `ForgeSection`
- `packages/desktop/src/board/BoardRow.tsx` / `__tests__/ci-flag.test.tsx` — the `ciFailed` pill
- `packages/desktop/src/board/BoardView.tsx` — `useForgeFlags` wiring (deviation, see below)
- `packages/desktop/src/legend/marks.ts` / `__tests__/legend.test.tsx` — the `ci-failed` mark (deviation)
- `packages/desktop/src/settings/SettingsSurface.tsx` — the Forge Override section

## Decisions Made

See `key-decisions` in the frontmatter — the D-123 per-task read added beyond the plan's own DTO
design, `forge_request_for_task`'s `Forge::Local`-check-before-dispatch ordering (so `NoForgeConfigured`
and `NoRequest` are distinguishable outcomes), and `project_forge_overrides` as a Rule 2 deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] No read command existed for the Settings surface's own per-project forge select**
- **Found during:** Task 2, implementing the Forge Override section's action text
- **Issue:** Task 1's declared command surface was write-only (`settings_set_project_forge`); the
  Settings surface cannot show which value is CURRENTLY selected for a project without a
  corresponding read, making "saves each, including clearing back to Detected" unverifiable by the
  user (a write with no readback).
- **Fix:** Added `commands::forge::project_forge_overrides` (reads `domain::settings::project_forge`
  once per registered project, mirroring `commands::settings::settings_get`'s own per-project loop
  for the credential override) and its TypeScript wrapper `projectForgeOverrides`.
- **Files modified:** `packages/desktop/src-tauri/src/commands/forge.rs`, `main.rs`,
  `capabilities/default.json`, `packages/desktop/src/adapters/tauri.ts`,
  `packages/desktop/src/settings/SettingsSurface.tsx`
- **Verification:** `cargo build --workspace` passes; `npm run build` passes; the full desktop
  suite (629/629) passes with this command registered and wired
- **Committed in:** `19d5cb1` (command), `1c3ab1c` (Settings surface consumer)

**2. [Rule 2 - Missing Critical] The D-123 unmet-criteria marker has no data source in the plan's own `forge_request_for_task` DTO design**
- **Found during:** Task 2, implementing `ForgeSection.tsx`'s own action text ("the unresolved
  acceptance-criteria marker naming the count when one is present")
- **Issue:** `ForgeRequest` (the forge-layer struct) has no unmet-criteria field — that fact lives
  only in a `task.done_with_unmet_criteria` event, which Task 1's own interfaces/action text never
  named as something `forge_request_for_task` reads
- **Fix:** Added `query::forge::latest_unmet_criteria_count` (a per-task sibling read over the
  SAME event `board_forge_flags` folds into its own rollup) and a Non-mirrored `unmet_criteria: u32`
  field on `ForgeReadDto::Request` (not on `ForgeRequestDto`, which stays an exact field-for-field
  mirror of `ForgeRequest` as its own doc comment states)
- **Files modified:** `packages/core/src/query/forge.rs`, `packages/desktop/src-tauri/src/commands/forge.rs`,
  `packages/desktop/src/adapters/tauri.ts`, `packages/desktop/src/item-detail/ForgeSection.tsx`
- **Verification:** `forge-section.test.tsx`'s two "unresolved acceptance criteria" tests pass
- **Committed in:** `19d5cb1` (backend read), `1c3ab1c` (DTO field + component)

**3. [Rule 3 - Blocking] `BoardRow.tsx`'s `ciFailed` prop needs real data to render in the running app, but `BoardView.tsx` is outside Task 2's declared `<files>`**
- **Found during:** Task 2, after writing `ci-flag.test.tsx` and confirming the acceptance grep
  `useForgeFlags` appears in `BoardRow.tsx` is satisfiable by a doc-comment mention alone (mirroring
  the established `blocked`/`needsDecision` precedent, where `BoardRow.tsx` never calls those hooks
  itself either — `BoardView.tsx` does, and passes booleans down)
- **Issue:** Without wiring `BoardView.tsx`, the pill's own `<behavior>` bullet ("A board row for a
  task with a CI-failure flag renders a pill") would be structurally unreachable in the real app —
  `ciFailed` would always default to `false`
- **Fix:** Added `useForgeFlags(projectId)` to `BoardView.tsx`, mirroring `blockedSummaryQuery`/
  `recoverySummaryQuery`'s exact shape, and passed `ciFailed={ciFailedTaskIds.has(row.item.id)}` plus
  an `onOpenCiFailed` handler identical in destination to the other two pills' handlers
- **Files modified:** `packages/desktop/src/board/BoardView.tsx`
- **Verification:** `npm run build` passes; `ci-flag.test.tsx` (8/8) and the full desktop suite
  (629/629) pass
- **Committed in:** `1c3ab1c`

**4. [Rule 1 - Bug] Adding the `ci-failed` mark broke `legend.test.tsx`'s literal "fourteen entries" structural assertion**
- **Found during:** Task 2, running the full desktop suite after adding the mark to `legend/marks.ts`
- **Issue:** `legend.test.tsx`'s own structural test asserts the exact published agent-channel mark
  roster by count and content — a real, intentional guard (`MARKS` is "a published,
  always-reachable legend... no mark may exist that the legend does not define"), not a stale
  artifact; adding a genuinely new mark legitimately changes the count from 14 to 15
- **Fix:** Updated the test's expected count and list to include `ci-failed`, and updated its own
  header comment and `describe` title to name this plan and D-124
- **Files modified:** `packages/desktop/src/legend/__tests__/legend.test.tsx`
- **Verification:** `legend.test.tsx` passes (confirmed in the full desktop suite re-run, 629/629)
- **Committed in:** `1c3ab1c`

**5. [Rule 1 - Bug] The Forge Override section's initial design collided with an unrelated, pre-existing Settings test**
- **Found during:** Task 2, running the full desktop suite — `settings-surface.test.tsx`'s
  permission-rules test failed because `screen.findByText("Flywheel")` resolved to the NEW Forge
  Override row instead of the permission-rules table row it was written to find
- **Issue:** The section's first implementation iterated `projects` (the full roster) directly,
  rendering a project-name row unconditionally whenever `projects.length > 0` — unlike the
  pre-existing credential-override section, which iterates `settings.projectOverrides` (a DTO list
  a test can leave empty to suppress rendering without a forge-specific mock)
- **Fix:** Rewrote the section to map over `forgeOverrides` (the `projectForgeOverrides()` query
  result, which carries its own `projectName`), gated on `!forgeOverridesQuery.isPending &&
  forgeOverrides.length > 0` instead of `projects.length > 0` — the unrelated test's unmocked
  `projectForgeOverrides` import now rejects to an empty array, and the section renders nothing,
  exactly mirroring how that test's unmocked `settings.projectOverrides: []` already suppresses the
  credential section
- **Files modified:** `packages/desktop/src/settings/SettingsSurface.tsx`
- **Verification:** the full desktop suite (629/629, including `settings-surface.test.tsx`'s
  previously-failing test) passes
- **Committed in:** `1c3ab1c`

---

**Total deviations:** 5 auto-fixed (2 missing critical — a write-only command with no readback,
and a named must-have field absent from the plan's own DTO design; 2 bugs — a self-inflicted test
collision and a structural-count test needing an update that legitimately changed; 1 blocking — a
file outside the declared list needed for the task's own `<behavior>` to hold in the real app,
mirroring 07-03/07-07's own precedent for the identical situation).
**Impact on plan:** None affected scope or correctness beyond fixing what each deviation names.
Two (D-123's read, `project_forge_overrides`) fill a real gap in the plan's own command design;
the other three are corrections surfaced by running the real test suite, not scope creep.

## Issues Encountered — Verification Performed vs. Not Completed

**Read this section before trusting any "passed" claim elsewhere in this document — it is the
precise, honest account of what ran to completion in this session.**

**What ran to completion and is fully trustworthy:**
- `cargo build --workspace` — clean, multiple times, including after every subsequent edit
- `cargo build -p core --bin forge_probe` — clean
- `cargo test -p core --test forge_board_flags` — 8/8 passed
- `cargo test -p core --test forge_degrade --test status_transitions` — 6/6 + 21/21 passed (plan
  07-03/07-07's own regression suites, confirmed still green against this plan's changes)
- `npm --prefix packages/desktop run build` — clean (tsc + vite), multiple times
- `npm --prefix packages/desktop run test` (the FULL desktop suite, not a filtered subset) — ran
  to completion TWICE in this session. The first full run surfaced 2 failures (both deviations
  documented above, in `legend.test.tsx` and `settings-surface.test.tsx` — both caused by this
  plan's own changes, both fixed). The SECOND full run, after both fixes, completed clean:
  **44 test files passed, 629/629 tests passed, exit code 0.** This is a genuine, complete,
  trustworthy result — not a partial sample.
- `forge_probe`'s single-pair mode and `--both` mode were both smoke-tested by hand against real
  local git repositories (no forge configured) — exit 0, correct output shape, confirmed the
  single-pair mode's output is byte-identical to before this plan's changes.

**What did NOT run to completion — `cargo test --workspace` (the full Rust workspace suite):**
I attempted this three times in this session. Each attempt reached well into the suite — the
furthest run reached `outside_commit_detection.rs`, having run through dozens of test binaries
spanning `acceptance_criterion` through `outbox.rs` alphabetically (including, among many others,
`forge_board_flags`, `forge_degrade`, `forge_normalize`, `git_facts`, `git_hooks_pre_push`,
`git_identity`, `git_retry`, `hierarchy_workflow`, `launch_reconciliation`, `credentials`,
`outbox`) — **with zero failures recorded in any attempt, at any point.** I do not have a complete,
start-to-finish green run of this command in this session. Two of the three attempts I killed
myself, mistaking a slow-but-genuinely-working test binary (`credentials.rs`'s real macOS Keychain
I/O; later, ordinary git-subprocess-heavy fixtures) for a hang — a misjudgement, not a real stall;
each time I re-checked, the "stalled" process was mid-transition between two test binaries, not
stuck. The third attempt was stopped on the coordinator's explicit instruction, since the
coordinator runs this same gate after every wave and will run it again as the wave 6 post-merge
gate. **I am NOT claiming `cargo test --workspace` passed clean in this session — I am reporting
that it ran failure-free as far as I observed it, across three separate attempts covering most of
the suite, and that the coordinator owns the authoritative full run.**

**The two correctness properties the coordinator asked about specifically:**

1. **"Nothing at all renders when no forge is configured" (D-120).** Verified at the component
   level: `forge-section.test.tsx` has a dedicated test asserting `toBeEmptyDOMElement()` AND
   `container.children.length === 0` (not merely a `queryBy…` absence check) for the
   `noForgeConfigured` outcome, with a mocked adapter — this test passed, both the first time I ran
   it in isolation and in the full 629/629 suite run. The backend path
   (`forge_request_for_task` checking `Forge::Local` via `forge_for_project` before ever calling
   `request_for_branch`, so no forge CLI is spawned) is build-verified but has no dedicated Rust
   test of its own in this plan — the underlying "Local spawns nothing" guarantee it depends on was
   proven by 07-03's `forge_degrade.rs` (re-confirmed green here). **I did NOT perform a live,
   running-app visual check** (no packaged app, no real project with no forge, no screenshot) —
   that is outside what this session's tooling can do, and is the kind of check `/gsd-verify-work`
   or end-of-phase UAT is positioned to perform.

2. **"The CI link resolves to the actual run, not the request or the repo root" (LINK-06).**
   Verified structurally at the component level: two SEPARATE passing tests assert two DIFFERENT
   expected `href` values from two different fixture fields — one for the PR link
   (`request.url`, e.g. `.../pull/42`) and one for the CI link (`request.ciUrl`, e.g.
   `.../run/9`) — so the component cannot pass these tests by wiring the wrong field to either
   link. **What this does NOT verify:** that the `ciUrl` VALUE itself (as read from a real `gh`/`glab`
   CLI response) is genuinely the CI run's URL rather than some other forge-reported link — that is
   07-03's own scope (`github.rs`/`gitlab.rs`'s `normalize()` functions), proven by
   `forge_normalize.rs`'s fixture-based tests against frozen real CLI output, not re-verified by
   this plan. Nor does it include a live click-through in a real browser against a real CI run —
   that is Task 3's own named `<human-check>`, explicitly deferred to end-of-phase UAT
   (`workflow.human_verify_mode: end-of-phase`), matching 07-07's identical precedent for its own
   live-poll gap.

**Task 3's `<human-check>` (the live two-forge arm) was not performed in this session** — it
requires a real GitHub project and a real GitLab project the operator owns, each with an open
request on a `flywheel/`-namespaced branch, which this session has no access to provision. The
precondition (`gh auth status`/`glab auth status` both exit 0) WAS verified met on this machine
(both CLIs installed and authenticated) before Task 3's implementation began, so the command is
ready to run — but running it against real forge-hosted requests and comparing the printed state to
the item panel is a genuine human action, correctly deferred.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ForgeSection.tsx`/`board_forge_flags`/`forge_request_for_task` are stable, independently
  callable symbols — plan 07-09 (request creation) can compose against them with no further
  groundwork from this plan.
- `LINK-06` and `LINK-08` are this plan's own requirements, declared only by 07-03 (already
  summarized) and this plan — the shared-ID gate should flip both to `Complete` once this SUMMARY
  exists. `LINK-05` is also declared by 07-09, which has no SUMMARY yet, so it stays blocked until
  07-09 finishes (expected, not a blocker of this plan).
- **Open follow-up for end-of-phase UAT or a later gap-closure pass:** a complete, uninterrupted
  `cargo test --workspace` run in this environment, and Task 3's live two-forge `<human-check>`
  against real GitHub/GitLab projects — neither completed in this session for the reasons stated
  above under "Issues Encountered."

## Self-Check: PASSED

All created/modified files verified present on disk; all three task commits (`19d5cb1`, `1c3ab1c`,
`355e0eb`) verified present in `git log`.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-02*
