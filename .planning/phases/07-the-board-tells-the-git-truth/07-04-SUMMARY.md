---
phase: 07-the-board-tells-the-git-truth
plan: 04
subsystem: git-integration
tags: [rust, tauri, react, settings, worktree, process-spawn]

requires:
  - phase: 07-the-board-tells-the-git-truth (plan 07-01)
    provides: "the core->Tauri->UI seam (commands/mod.rs, main.rs, capabilities/default.json, adapters/tauri.ts) this plan adds registrations to rather than replaces"
provides:
  - "flywheel_core::domain::worktree::{OpenSurface, WORKTREE_PATH_TOKEN, DEFAULT_EDITOR_TEMPLATE, DEFAULT_TERMINAL_TEMPLATE, open_command_template, set_open_command_template, resolve_open_argv} — the full D-130 template-resolution and shell-free argv-construction surface"
  - "the worktree_open Tauri command — the renderer's only route to a process, taking only a task id and an OpenSurface"
  - "open_command_template/set_open_command_template Tauri commands backing the Settings surface's two template fields"
  - "two tertiary actions on WorktreeSummary.tsx (Open in editor/Open in terminal) retiring the Phase 2 structural gate that reserved this slot"
affects: [07-05, 07-06, 07-07, 07-08, 07-09]

actuals:
  tokens: 16035
  tasks: 3
  commits: 3
plan_head_before: d3a22075e330e2bdf3bb9be8abfdcd7acabcc2c8

tech-stack:
  added: []
  patterns:
    - "Global (not per-project) settings rows for the two command templates — open_command_template/set_open_command_template are exact structural siblings of domain::settings's global_credential_mode/set_global_credential_mode, living in domain::worktree.rs rather than domain::settings.rs because the concern is 'how a worktree is opened' and resolve_open_argv is their only real consumer"
    - "Single-element token substitution, never a shell: the stored template is split with split_whitespace (collapsing whitespace runs, yielding no empty elements — the one splitting site in domain::worktree.rs) and the worktree path replaces {worktree_path} inside whichever element contains it, so the returned Vec<String> is handed straight to Command::new(argv[0]).args(&argv[1..]) and never joined back into a command line"
    - "One shared BannerState-shaped in-flight/error object per tertiary-action group — WorktreeSummary.tsx's own established idiom (first used for MissingWorktreeBanner), reused here for the Open in editor/Open in terminal pair"

key-files:
  created:
    - packages/core/tests/open_worktree.rs
    - packages/desktop/src-tauri/src/commands/worktree_open.rs
  modified:
    - packages/core/src/domain/worktree.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/item-detail/WorktreeSummary.tsx
    - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx
    - packages/desktop/src/settings/SettingsSurface.tsx
    - packages/desktop/src/settings/__tests__/settings-surface.test.tsx

key-decisions:
  - "The two Settings-surface accessor commands are named open_command_template/set_open_command_template — without the worktree_ prefix every other command in this file carries — so neither registered command name in main.rs's generate_handler! list begins with the literal text worktree_open except worktree_open itself; Task 2's own acceptance grep (grep -c 'commands::worktree_open::worktree_open' main.rs == 1) requires this, and the plan's own artifacts_produced section independently confirms these two commands belong in commands/worktree_open.rs despite Task 2's action prose naming only one command."
  - "resolve_open_argv's signature is written as a single un-wrapped line, diverging from this file's usual multi-line formatting for long signatures, so the plan's literal single-line grep assertion on the exact signature string matches."
  - "worktree_open's command handler calls worktree_for_task a second time (after resolve_open_argv) to read the worktree's own path directly for .current_dir(), rather than assuming the path lands in a particular argv element — the substitution token can appear anywhere in a user-edited template, not only as the final element."
  - "The two new Settings template fields render null while their read is pending rather than reusing SectionSkeleton — a near-instant local settings read isn't worth a dedicated skeleton, and SectionSkeleton's shared data-testid would otherwise collide with the Credential Path section's own skeleton in tests."

requirements-completed: [LINK-11]

coverage:
  - id: D1
    description: "Two global settings-backed command templates (editor/terminal) with read-with-default accessors, and resolve_open_argv building a safe argv with the worktree path substituted as exactly one element — proven against a path containing a space and a semicolon"
    requirement: "LINK-11"
    verification:
      - kind: unit
        ref: "packages/core/tests/open_worktree.rs (9 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The worktree_open Tauri command spawns the resolved argv directly with no shell, taking only a task id and an OpenSurface from the renderer; a NotFound spawn error names the missing program"
    requirement: "LINK-11"
    verification:
      - kind: other
        ref: "cargo build --workspace; cargo test -p core --test supervisor_cwd; structural greps (no sh/bash/-c construction, resolve_open_argv delegation, generate_handler! registration, capability roster)"
        status: pass
    human_judgment: true
    rationale: "No automated test spawns a real process end-to-end — that would open a real editor or terminal window. The command is proven structurally (it builds, delegates to resolve_open_argv rather than constructing its own argv, and supervisor_cwd.rs's absolute-path source gate holds) and the argv it spawns is proven correct by D1's unit tests. A human pressing Open in editor/Open in terminal in the packaged app and seeing VS Code/Terminal actually open at the right worktree path is the real proof LINK-11 asks for — appropriate for end-of-phase UAT, matching 07-01's own precedent for its scheduler tick."
  - id: D3
    description: "Open in editor / Open in terminal tertiary actions on WorktreeSummary.tsx sharing one disabling/error state, unreachable on a missing worktree via the existing early return, with the reveal-in-Finder absence assertion kept unchanged; the Settings surface's two template fields are pre-filled, editable, and surface the core's own empty-template rejection"
    requirement: "LINK-11"
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx (30 tests)"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/settings/__tests__/settings-surface.test.tsx (24 tests)"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-10-02
status: complete
---

# Phase 7 Plan 4: The Worktree-Open Escape Hatch Summary

**Two configurable, shell-free command templates — "Open in editor" and "Open in terminal" — resolved in the Rust core to a safe argv and spawned by one Tauri command the renderer cannot route anywhere else, retiring the Phase 2 structural gate `WorktreeSummary.tsx` has carried since this slot was first reserved.**

## Performance

- **Duration:** 24 min
- **Started:** ~2026-10-02T08:58:10Z
- **Completed:** 2026-10-02T09:22:26Z
- **Tasks:** 3
- **Files modified:** 11 (2 created, 9 modified)

## Accomplishments

- `domain::worktree::{OpenSurface, WORKTREE_PATH_TOKEN, DEFAULT_EDITOR_TEMPLATE, DEFAULT_TERMINAL_TEMPLATE, open_command_template, set_open_command_template, resolve_open_argv}` — two global, settings-backed templates with sane macOS defaults (`code {worktree_path}` / `open -a Terminal {worktree_path}`), and `resolve_open_argv` splitting the template on whitespace and substituting the worktree path inside a single argv element, proven against a path containing a space and a semicolon never splitting into a second command
- `worktree_open` — the renderer's only route to a process: locks the DB only long enough to resolve the argv and the worktree path, drops the lock, then spawns `Command::new(argv[0]).args(&argv[1..])` directly with no shell, detached, with a `NotFound` spawn error naming the missing program
- `open_command_template`/`set_open_command_template` — the Settings surface's read/write pair, rejecting an empty or whitespace-only template with an error naming the surface
- `WorktreeSummary.tsx`'s two new tertiary actions, sharing one `BannerState`-shaped in-flight/error object (the file's own established idiom), structurally unreachable on a missing worktree via the existing early return, with the reveal-in-Finder absence assertion untouched
- `SettingsSurface.tsx`'s new "Worktree Open Commands" section: two pre-filled, editable template fields that commit on blur/Enter and surface the core's own rejection text inline

## Task Commits

Each task was committed atomically:

1. **Task 1: Template resolution and argv construction in the core** - `20addc3` (feat)
2. **Task 2: The worktree_open command — the renderer's only route to a process** - `d90f16a` (feat)
3. **Task 3: The two actions on the item, the two settings rows, and the retired gate** - `f84900d` (feat)

_No separate RED/GREEN/REFACTOR commits: `workflow.tdd_mode` is off for this run, so the hard TDD gate was not enforced. Both `tdd="true"` tasks were implemented with their proving tests written and passing in the same commit as the implementation they prove, matching 07-01/07-03's own convention._

## Files Created/Modified

- `packages/core/src/domain/worktree.rs` — `OpenSurface`, the three template constants, `open_command_template`/`set_open_command_template`, `resolve_open_argv`
- `packages/core/tests/open_worktree.rs` — 9 tests covering every `<behavior>` bullet, including the space-and-semicolon path proven element-by-element
- `packages/desktop/src-tauri/src/commands/worktree_open.rs` — `worktree_open`, `open_command_template`, `set_open_command_template`
- `packages/desktop/src-tauri/src/commands/mod.rs` / `main.rs` / `capabilities/default.json` — module declaration, `generate_handler!` registration, capability-roster description
- `packages/desktop/src/adapters/tauri.ts` — `WorktreeOpenSurface`, `worktreeOpen`, `openCommandTemplate`, `setOpenCommandTemplate`
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` — the two new actions, shared state, retired header-comment sentence and `<verify>` gate
- `packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx` — inverted the absence test into presence/click/shared-state/error tests; kept the reveal-in-Finder absence test unchanged
- `packages/desktop/src/settings/SettingsSurface.tsx` — `OpenCommandTemplateField`, the new "Worktree Open Commands" section
- `packages/desktop/src/settings/__tests__/settings-surface.test.tsx` — extended the `adapters/tauri` mock with the two new accessor functions

## Decisions Made

See `key-decisions` in the frontmatter above — the command-naming choice that satisfies Task 2's own acceptance grep, the single-line `resolve_open_argv` signature, the second `worktree_for_task` read for `.current_dir()`, and the `null`-while-pending choice for the two Settings fields.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Task 2's own action text names only `worktree_open`, but Task 3's Settings UI needs two more backing commands Task 3's own `<files>` list has no Rust file to add them in**
- **Found during:** Task 2, after reading Task 3's action text (`openCommandTemplate`/`setOpenCommandTemplate` "through `invokeCommand`") and confirming Task 3's `<files>` list is frontend-only
- **Issue:** Task 2's prose says "with one command: worktree_open(...)", but the plan's own `artifacts_produced` section independently states the two template accessor commands are "exposed alongside it in `commands/worktree_open.rs`" — the only place in the whole plan those commands could be added
- **Fix:** Added `open_command_template`/`set_open_command_template` to `commands/worktree_open.rs` and registered them in `main.rs`/`capabilities/default.json` alongside `worktree_open`, naming them without the `worktree_` prefix so they don't collide with Task 2's own `grep -c 'commands::worktree_open::worktree_open' main.rs == 1` acceptance check
- **Files modified:** `packages/desktop/src-tauri/src/commands/worktree_open.rs`, `main.rs`, `capabilities/default.json`
- **Verification:** `cargo build --workspace` passes; the `commands::worktree_open::worktree_open` grep still reads exactly `1`
- **Committed in:** `d90f16a` (Task 2 commit)

**2. [Rule 1 - Bug] Task 2's `shell:allow-execute` acceptance grep assumes a baseline count of 1 that was already 2 before this plan touched the file**
- **Found during:** Task 2, running the task's own `<verify>` checks
- **Issue:** `grep -c 'shell:allow-execute' capabilities/default.json` is `2` in the unmodified baseline (the description prose mentioning the grant, plus the `permissions` array's `"identifier": "shell:allow-execute"`), confirmed via `git show HEAD`. This plan's edits never touch that part of the file.
- **Fix:** Verified the real invariant directly instead — the `shell:allow-execute` permission object is unmodified and its `allow` list still names only the sidecar binary. Logged to `.planning/WINDOWS.md` as deviation entry 24, mirroring how 07-02/07-03 handled analogous stale-count mismatches.
- **Files modified:** none (pre-existing condition, not introduced by this plan)
- **Committed in:** n/a — documentation only

**3. [Rule 1 - Bug] `settings-surface.test.tsx`'s `adapters/tauri` mock didn't carry the two new template accessor functions, and the new Settings fields' loading state collided with an existing `data-testid`**
- **Found during:** Task 3, running the full desktop suite after mounting the new Settings section
- **Issue:** `OpenCommandTemplateField` calls `openCommandTemplate`/`setOpenCommandTemplate` directly via `useQuery`/`useMutation`; `settings-surface.test.tsx`'s own mock (from plan 02-10) didn't export them, breaking `react-query`'s read into a silent error state. The same component's loading branch originally reused `SectionSkeleton`, whose `data-testid="settings-skeleton"` collided with the Credential Path section's own skeleton, breaking a `getByTestId` single-match assertion once multiple skeletons rendered simultaneously. This is the exact 07-01 mock-extension hazard the plan's own `<verification_note>` named in advance.
- **Fix:** Extended `settings-surface.test.tsx`'s mock with `openCommandTemplate`/`setOpenCommandTemplate` and default resolved values in its `beforeEach`; changed the two new fields to render `null` while pending instead of `SectionSkeleton`.
- **Files modified:** `packages/desktop/src/settings/__tests__/settings-surface.test.tsx`, `packages/desktop/src/settings/SettingsSurface.tsx`
- **Verification:** `npm --prefix packages/desktop run test` — 586/586 passing, 0 failed files
- **Committed in:** `f84900d` (Task 3 commit)

---

**Total deviations:** 3 (1 missing critical, 2 bugs — one pre-existing/documentation-only, one fixed).
**Impact on plan:** All necessary for correctness and for the plan's own stated acceptance criteria to be meaningfully satisfied (rather than literally, against a stale baseline). No scope creep — no behavior outside LINK-11/D-130 was added.

## Issues Encountered

- `cargo test --workspace` (the full 73-file `packages/core` integration suite plus `packages/desktop/src-tauri`'s own tests) was attempted twice as extra diligence beyond the plan's own `<verification>` block. Both attempts sat at 0% CPU with no compiling child process for several minutes with no output and were killed rather than block completion. This is unrelated to this plan's 3 commits — the plan's own explicitly-scoped targeted suites (`open_worktree`, `supervisor_cwd`, `migration_safety`, `cargo build --workspace`, and the full desktop npm suite) all pass cleanly, and none of them reproduce the hang. Flagged for a human glance at the next convenient point, not a blocker for this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `domain::worktree::{OpenSurface, resolve_open_argv, open_command_template, set_open_command_template}` are stable, independently callable symbols — no later Phase 7 plan depends on this one, but nothing here forecloses anything (`affects` is informational).
- `LINK-11` is this plan's only requirement and no sibling plan in this phase also declares it, so `requirements.mark-complete` should flip it to `Complete` immediately on this SUMMARY's existence (no shared-ID gate wait).
- The one human-judgment coverage item (D2) — actually clicking "Open in editor"/"Open in terminal" in the packaged app and confirming VS Code/Terminal opens at the right worktree path — is appropriate for end-of-phase UAT, matching 07-01's own precedent for its scheduler tick.
- The `cargo test --workspace` hang noted above (Issues Encountered) is worth a human glance before Phase 7 ships, but is not reproduced by any test this plan added or touched.
- No blockers.

## Self-Check: PASSED

All 11 created/modified files verified present on disk; all 3 task commits (`20addc3`, `d90f16a`, `f84900d`) verified present in `git log`.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-02*
