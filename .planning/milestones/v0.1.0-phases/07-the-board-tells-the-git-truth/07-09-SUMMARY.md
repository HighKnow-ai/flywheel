---
phase: 07-the-board-tells-the-git-truth
plan: 09
subsystem: git-integration
tags: [rust, typescript, forge, github, gitlab, react, tauri, tanstack-query]

requires:
  - phase: 07-the-board-tells-the-git-truth (plan 07-03)
    provides: "forge::{Forge, ForgeState, CiResult, ForgeRequest, ForgeError}, forge_for_project, request_for_branch — the normalized model and dispatch this plan's create_request becomes a sibling of"
  - phase: 07-the-board-tells-the-git-truth (plan 07-07)
    provides: "forge/transitions.rs's single edge detector — the mechanism this plan deliberately does NOT duplicate; opening a request writes no status itself"
  - phase: 07-the-board-tells-the-git-truth (plan 07-08)
    provides: "commands/forge.rs's ForgeRequestDto/ForgeReadDto shapes and ForgeSection.tsx's absence-is-the-design rendering, which this plan extends rather than replaces"
provides:
  - "forge::request_body::{RequestDraft, assemble_request_draft} — deterministic title/body/head/target assembly from a task's title, current-revision acceptance criteria and session summaries"
  - "forge::create_request dispatch point, and github::create_request / gitlab::create_request — opening a request on each forge with the body off argv (stdin for gh, an owner-only temp file for glab)"
  - "commands/forge.rs's forge_request_draft (read-only preview) and forge_open_request (the one mutating command) — forge_open_request re-assembles the draft itself, accepting only a task id"
  - "ForgeSection.tsx's open-request action: preview the title/body, confirm or cancel, then open — rendered exactly for the NoRequest outcome"
affects: []

actuals:
  tokens: 23200
  tasks: 3
  commits: 3
plan_head_before: 0b9c663

tech-stack:
  added: []
  patterns:
    - "Preview and send share one assembly function, by construction: forge_request_draft and forge_open_request both call assemble_request_draft with no other inputs, so the text a human approved is structurally the text that reaches the forge — the privacy prohibition (T-07-09-01) is satisfied by a type signature, not a promise. Mirrors context_packet.rs's own CTX-04 determinism discipline, now extended past 'no model call' to 'no git call, no network call, no mutation'."
    - "Body-off-argv is a per-forge transport choice, not a shared helper: GitHub's gh pr create reads --body-file - from stdin (run_gh grew an Option<&[u8]> stdin parameter); GitLab's glab mr create has no stdin-reading form, so write_description_tempfile writes an owner-only (0o600) NamedTempFile and passes --description-file <path>, removed before the function returns on every path. Both inherit credentials.rs's standing argv-disclosure reasoning, applied to a request body instead of a secret."
    - "A dispatch sibling, not a dispatch rewrite: forge::create_request mirrors request_for_branch's exact three-way match (Local errors with no spawn, GitHub/GitLab delegate), so the two dispatch points can never disagree about which forge a project talks to."
    - "Pure argv builders factored out for hermetic testing: github::create_request_args and gitlab::create_request_args are plain pure functions a test calls directly, so argv/stdin behavior is asserted without ever spawning gh or glab — the same precedent gitlab::normalize already set for fixture-driven testing."

key-files:
  created:
    - packages/core/src/forge/request_body.rs
    - packages/core/tests/forge_request_body.rs
  modified:
    - packages/core/src/forge/mod.rs
    - packages/core/src/forge/github.rs
    - packages/core/src/forge/gitlab.rs
    - packages/core/Cargo.toml
    - packages/core/tests/forge_normalize.rs
    - packages/desktop/src-tauri/src/commands/forge.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/item-detail/ForgeSection.tsx
    - packages/desktop/src/item-detail/__tests__/forge-section.test.tsx

key-decisions:
  - "assemble_request_draft reads criteria with its own literal SQL (statement/verification_hint/checked, filtered to superseded_at IS NULL, ordered by rank) rather than reusing context_packet.rs's CRITERIA_SQL or domain::acceptance_criterion::list_current_criteria — context_packet's query doesn't select checked, and the plan's own acceptance criteria require the literal superseded_at IS NULL predicate to live in this file. Session summaries DO reuse the existing reader (domain::session_summary::list_summaries_for_task) rather than a second query, per the plan's explicit instruction."
  - "Target branch is derived the same way git_facts.rs derives its ahead/behind comparison target (epic_integration_branch_name for an epic'd task, else the project's default_branch) rather than reading the epic's already-cut integration_branch column — confirmed by reading git_facts.rs's own D-25/D-26 implementation before writing this file's version, just without the origin/ prefix a base ref must not carry."
  - "tempfile was promoted from a core dev-dependency to a real one (Cargo.toml) because gitlab::create_request needs NamedTempFile in production code, not only in tests — already vetted and already used throughout this crate's test fixtures, so this is a manifest-section move, not a new dependency."
  - "forge_open_request packs its ForgeError into Err(String) as a stable \"<category>:<cli>\" string (e.g. cliNotInstalled:gh) rather than e.to_string() — ForgeError::CliFailed's Display includes the raw stderr, and this command's signature is fixed to Result<ForgeRequestDto, String>, so a controlled, stderr-free string is what keeps T-07-09-08's \"stderr never crosses the IPC boundary\" guarantee intact while still letting the renderer distinguish the three notices."

patterns-established:
  - "A mutating Tauri command that writes no status row at all: forge_open_request's only side effect besides the forge call is the board:changed emit — the status transition is entirely the next scheduler tick's job (plan 07-07's edge detector), so this command cannot create a second status-writing path for the same fact even by omission."

requirements-completed: [LINK-05]

coverage:
  - id: D1
    description: "Deterministic request draft assembly from the task's title, current-revision acceptance criteria (real checked state, superseded rows excluded) and session summaries, targeting the epic integration branch or the trunk"
    requirement: "LINK-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/forge_request_body.rs (11 tests)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/criteria_pin.rs, packages/core/tests/context_packet.rs (regression)"
        status: pass
    human_judgment: false
  - id: D2
    description: "create_request on both GitHub and GitLab adapters, with the body transported off argv (gh: stdin via --body-file -; glab: an owner-only temp file via --description-file), reusing each adapter's existing error mapping and normalize"
    requirement: "LINK-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/forge_normalize.rs (3 new tests: argv-never-carries-body x2, tempfile byte-for-byte + 0o600 permissions)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/forge_degrade.rs, packages/core/tests/supervisor_cwd.rs (regression)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Preview-then-open action on the item: pressing it shows the draft's title/body with confirm/cancel before anything is sent; confirming calls forgeOpenRequest with the task id alone; the three CLI-error notices render during an open failure and leave the preview open to retry; a success renders the new request with no separate banner"
    requirement: "LINK-05"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/forge-section.test.tsx (30 tests, up from 21)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The live arm: gh pr create / glab mr create actually succeeding end-to-end against a real, authenticated forge, with the real packaged app rendering the real result"
    verification: []
    human_judgment: true
    rationale: "No disposable GitHub/GitLab repository with an authenticated gh/glab CLI was available in this environment, and this plan's own correctness_note forbids creating a real request against this repository during verification. Mirrors 07-03's forge_probe precedent of deferring the live arm to an explicitly human-invoked check rather than exercising it during automated verification. Logged to .planning/WINDOWS.md as unrun-verify."

duration: 55min
completed: 2026-10-04
status: complete
---

# Phase 7 Plan 9: Preview, Then Open — The Board Item Becomes The Request Summary

**Deterministic PR/MR draft assembly from a task's title, criteria and session summaries, with a preview-then-confirm action that opens it on GitHub or GitLab with the body off argv.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-10-04T10:20:00Z
- **Completed:** 2026-10-04T11:15:00Z
- **Tasks:** 3
- **Files modified:** 13 (2 created, 11 modified)

## Accomplishments
- `assemble_request_draft` turns a task's title, current-revision acceptance criteria (with their real checked state, superseded revisions excluded) and chronological session summaries into one deterministic title/body/head/target draft — the same function the preview renders and the open command sends, so the two can never disagree.
- `github::create_request` and `gitlab::create_request` open a real request on each forge with the body transported off the command-line entirely: stdin for `gh pr create --body-file -`, an owner-only temporary file for `glab mr create --description-file <path>`. Neither adapter pushes a branch or shells to `git`.
- The item's forge section gained one action, present exactly when a forge is configured, a worktree exists and no request is open yet: press it, read the exact title and body Flywheel assembled, confirm or cancel, and — on confirm — the request opens with no separate success banner, no status write of its own, and the same three CLI-error notices the read path already uses if `gh`/`glab` fails.

## Task Commits

Each task was committed atomically:

1. **Task 1: Deterministic draft assembly** - `5ba5b20` (feat)
2. **Task 2: create_request on both adapters, body off argv** - `2d007ff` (feat)
3. **Task 3: Preview, then open — the action on the item** - `b71cbbd` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/core/src/forge/request_body.rs` - `RequestDraft`, `assemble_request_draft` — the pure, no-mutation draft assembler
- `packages/core/tests/forge_request_body.rs` - 11 tests covering every `<behavior>` bullet (determinism, target derivation, checklist state/order, criteria-revision exclusion, summary chronology, absence discipline, no-worktree error)
- `packages/core/src/forge/mod.rs` - declares `request_body`, adds `create_request` as `request_for_branch`'s dispatch sibling
- `packages/core/src/forge/github.rs` - `create_request`, `create_request_args`; `run_gh`/`spawn_gh` grew an optional stdin payload
- `packages/core/src/forge/gitlab.rs` - `create_request`, `create_request_args`, `write_description_tempfile`
- `packages/core/Cargo.toml` - `tempfile` promoted from `[dev-dependencies]` to `[dependencies]`
- `packages/core/tests/forge_normalize.rs` - 3 new hermetic tests: both adapters' argv never carries the body; the GitLab temp-file write preserves a tricky body byte-for-byte at `0o600`
- `packages/desktop/src-tauri/src/commands/forge.rs` - `RequestDraftDto`, `forge_request_draft` (read-only), `forge_open_request` (the one mutating command)
- `packages/desktop/src-tauri/src/main.rs` - registers both new commands
- `packages/desktop/src-tauri/capabilities/default.json` - documents both new commands in the command-roster description
- `packages/desktop/src/adapters/tauri.ts` - `RequestDraftDto`, `forgeRequestDraft`, `forgeOpenRequest`
- `packages/desktop/src/item-detail/ForgeSection.tsx` - `OpenRequestAction`, `CliErrorNotice` (factored out of the existing read-path switch), the `NoRequest` outcome now renders the action instead of nothing
- `packages/desktop/src/item-detail/__tests__/forge-section.test.tsx` - extended from 21 to 30 tests covering the preview/cancel/confirm/error/success cycle

## Decisions Made
- Criteria are read through this file's own literal SQL (not `context_packet.rs`'s `CRITERIA_SQL` or `domain::acceptance_criterion::list_current_criteria`) because the plan's own acceptance criteria require the `superseded_at IS NULL` predicate to live in `request_body.rs` directly, and the context packet's own query doesn't select `checked`. Session summaries DO reuse the existing `list_summaries_for_task` reader per the plan's explicit instruction not to write a second summary query.
- Target branch is derived exactly the way `git_facts.rs` derives its ahead/behind comparison target (confirmed by reading that file before writing this one), just without the `origin/` prefix a base ref must never carry.
- `forge_open_request` packs `ForgeError` into `Err(String)` as `"<category>:<cli>"` rather than `ForgeError`'s own `Display` (which includes raw stderr for `CliFailed`) — the command's signature is fixed to `Result<ForgeRequestDto, String>`, and a controlled string is what keeps the stderr off the IPC boundary while still letting the renderer distinguish the three notices.
- `tempfile` moved from `[dev-dependencies]` to `[dependencies]` in `packages/core/Cargo.toml` — it was already vetted and in use throughout this crate's test fixtures; `gitlab::create_request` now needs `NamedTempFile` in production code.

## Deviations from Plan

### Acceptance-criterion text vs. the real invariant (acceptance_criteria_note, same pattern 07-07/07-08 followed)

**1. `forge_open_request` carries an `app: AppHandle` parameter beyond the plan's literal `state: State<AppState>, task_id: String`**
- **Found during:** Task 3
- **Issue:** The plan's acceptance criteria state the parameter list is "exactly" `state`/`task_id`, but emitting `board:changed` on success requires an `AppHandle` — every other mutating command in this codebase that emits that event (`agent_run_stop`, `criterion_revise`, and others) takes the identical `app: AppHandle` parameter.
- **Fix:** Verified the real invariant instead of the literal text: `AppHandle` is a Tauri-injected parameter, never something the renderer supplies — the renderer's own call is `forgeOpenRequest(taskId)`, one argument. The actual constraint the criterion protects (no title/body/branch/target from the renderer) holds regardless of this Rust-side injected parameter. Logged to `.planning/WINDOWS.md` as a `deviation` entry.
- **Files modified:** `packages/desktop/src-tauri/src/commands/forge.rs`
- **Verification:** `forgeOpenRequest(taskId)` has exactly one call site in `ForgeSection.tsx`, passing one argument (asserted in `forge-section.test.tsx`'s `toHaveBeenCalledWith("task-1")` and `mock.calls[0]).toHaveLength(1)`); no command parameter is named `title`/`body`.

**2. Two literal greps in `<acceptance_criteria>` also match unrelated text, not the invariant they're named for**
- **Found during:** Task 3
- **Issue:** `grep -cE 'title: String|body: String'` over `commands/forge.rs` matches `RequestDraftDto.title`/`.body` (and the pre-existing `ForgeRequestDto.title`) — response DTO *output* fields, not renderer-supplied command *parameters*. `grep -c 'forgeOpenRequest'` over `ForgeSection.tsx` counts 4: the import statement, two doc-comment mentions, and the one real call site — not "one call site" literally.
- **Fix:** Verified the real invariants by reading the actual function signatures and call sites rather than reshaping the DTOs or stripping documentation to force a lower grep count. Confirmed: neither `#[tauri::command]` function has a parameter named `title` or `body`; `forgeOpenRequest(...)` is invoked exactly once (line 227 of `ForgeSection.tsx`).
- **Files modified:** None (no production code changed for this item)
- **Verification:** Manual inspection of both command signatures; `grep -n "forgeOpenRequest" ForgeSection.tsx` shows one `await forgeOpenRequest(taskId)` call site among the four matches.

### Auto-fixed Issues

**3. [Rule 3 - Blocking] `tempfile` was a dev-only dependency; `gitlab::create_request` needs it in production code**
- **Found during:** Task 2
- **Issue:** `cargo build -p core` failed with `cannot find module or crate 'tempfile'` the moment `gitlab.rs` (non-test code) called `tempfile::NamedTempFile`.
- **Fix:** Moved the existing `tempfile = "3"` line from `[dev-dependencies]` to `[dependencies]` in `packages/core/Cargo.toml` — no version change, no new crate.
- **Files modified:** `packages/core/Cargo.toml`
- **Verification:** `cargo build -p core` and `cargo build --workspace` both exit 0.
- **Committed in:** `2d007ff` (Task 2 commit)

---

**Total deviations:** 2 acceptance-criterion text substitutions (documented per `acceptance_criteria_note`, following 07-07/07-08's precedent), 1 auto-fixed blocking issue (Rule 3).
**Impact on plan:** None of the three affected production correctness or scope. The AppHandle parameter and the dependency promotion were both necessary for the feature to work at all; the grep-literalism items were verified against the real invariant rather than the letter of the text.

## Issues Encountered
None beyond the deviations above.

## What Was Verified, and What Was Not

**Verified (automated, this session):**
- Draft assembly is deterministic, targets the right branch, excludes superseded criteria, reflects real checked state, and errors (never assembles an empty head branch) when a task has no worktree — 11 unit tests.
- Neither adapter's argv ever carries the request body; GitLab's temp-file write preserves a body containing newlines, backticks and a leading hyphen byte-for-byte, with `0o600` permissions — hermetic unit tests, no `gh`/`glab` spawned.
- The UI shows the title and body before sending anything; Cancel sends nothing; Confirm calls `forgeOpenRequest` with the task id alone (one argument, asserted directly); a CLI failure during confirm renders the matching notice and leaves the preview open; a success renders the opened request with no separate banner — 30 component tests against a mocked IPC boundary.
- `cargo build --workspace`, `npm run build`, and the full desktop suite (638/638, up from the stated 629 baseline by the 9 tests this plan added) all pass. The known `proposal-keyboard.test.tsx` flake did not appear this run.
- `cargo test -p core --test forge_request_body/forge_normalize/forge_degrade/criteria_pin/context_packet/supervisor_cwd` all pass.

**NOT verified (coverage D4, logged to `.planning/WINDOWS.md`):**
- The live arm — an actual `gh pr create`/`glab mr create` succeeding against a real, authenticated forge, and the real packaged desktop app showing the result. No disposable test repository with an authenticated `gh`/`glab` CLI was available in this environment, and the plan's own `<correctness_note>` forbids creating a real request against this repository during verification. This mirrors 07-03's `forge_probe` precedent: the live check is a human-invoked step, not something this execution run could safely exercise. **Recommended before shipping:** with a real forge-backed task and `gh`/`glab` authenticated, click "Open request" once in the real app and confirm the resulting PR/MR's title and body match what was previewed.
- `cargo test --workspace` was intentionally not run by this executor per the dispatch instructions (reported as unreliable in this environment); `cargo build --workspace` passed and every individually-named test binary passed.

## User Setup Required
None - no external service configuration required. (Opening a real request does require the user's own `gh`/`glab` CLI to already be installed and authenticated, per D-117 — unchanged from plan 07-03/07-08.)

## Next Phase Readiness
- LINK-05 is now fully closed: both the read half (07-03/07-08) and the create half (this plan) are built, tested, and wired. REQUIREMENTS.md should flip LINK-05 to complete.
- This is the last plan of Phase 7 (The Board Tells The Git Truth) — all ten LINK requirements this phase owns (LINK-02 through LINK-11) should now be checked off assuming prior plans' own summaries are accurate.
- Open follow-up: a human smoke test of the live create arm (coverage D4 above) against a real forge before this ships to end users.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-04*

## Self-Check: PASSED
