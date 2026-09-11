---
phase: 02-one-agent-one-worktree-watched-live
plan: 10
subsystem: ui
tags: [react, typescript, rust, tauri, tanstack-query, zustand, keychain]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-09's settings_get/settings_set_credential_mode/settings_store_api_key/
      settings_clear_api_key/backend_capability_probe commands and their adapters/tauri.ts
      wrappers, and the Keychain-backed credentials.rs mechanism they front. Plan 02-05's
      permission_rules table, permission_rules_list/permission_rule_revoke commands and their
      adapters/tauri.ts wrappers. Plan 02-03's agent signal vocabulary (theme/tokens.ts,
      legend/marks.ts, state/keyboard.ts — including the open-settings binding this plan's Task 3
      wires up, registered but unmounted since 02-03)."
provides:
  - "SettingsSurface.tsx: the product's first Settings surface — global/per-project credential
    path, write-only API key field, non-blocking backend-unavailable notice"
  - "PermissionRulesTable.tsx: every allow-always rule across every registered project, listed
    with its project, tool, decision and date, and a Revoke action"
  - "Settings reachable exactly three ways (app menu Settings…/⌘,/command palette), all through
    the one open-settings action id"
  - "settings_set_credential_mode (Tauri command) and setCredentialMode (TS adapter) now accept
    mode: null for scope=\"project\", clearing an override back to \"use the global default\" —
    the domain layer already supported this; the command surface never exposed it before"
affects: []

# Actuals (#2632)
actuals:
  tokens: 15516
  tasks: 3
  commits: 3
  plan_head_before: 1be2cc63ec42758e0ca97f894de582eb9840dfac

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segmented-control-as-radiogroup, reused verbatim for the global two-value row and every
      per-project three-value row (adds a renderer-only 'default' value that maps to mode: null
      on the wire) — the same role=\"radiogroup\"/role=\"radio\" pattern
      launch-sheet/LaunchSheet.tsx's permission-mode control already established, not a new
      picker idiom"
    - "An empty array is ambiguous between 'still loading' and 'genuinely zero' — a fan-out
      table driven by a caller-supplied roster (PermissionRulesTable) takes an explicit
      loadingProjects boolean from the caller rather than inferring loading state from its own
      empty projects prop"
    - "Write-only field commits on blur/Enter (mirrors ItemDetailPanel.tsx's inline-editable
      title), not a page-level Save button — the one genuine draft-state exception on a surface
      whose every other control commits immediately"

key-files:
  created:
    - packages/desktop/src/settings/SettingsSurface.tsx
    - packages/desktop/src/settings/PermissionRulesTable.tsx
    - packages/desktop/src/settings/__tests__/settings-surface.test.tsx
  modified:
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src-tauri/src/commands/settings.rs
    - packages/desktop/src-tauri/src/menu.rs
    - packages/desktop/src-tauri/src/state.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/CommandPalette.tsx

key-decisions:
  - "settings_set_credential_mode's mode parameter widened from String to Option<String> — the
    domain function set_project_credential_mode already accepted mode: Option<&str> (None
    clears an override), but the Tauri command hardcoded Some(mode), so the per-project row's
    'Use global default' option had no way to actually fire. mode: None is rejected for
    scope=\"global\" (the global default itself cannot be cleared)."
  - "The API key field commits on blur/Enter rather than exposing a Save button — the surface's
    own stated invariant ('every field commits on interaction, no Save button, nothing to
    lose') is upheld by construction: the typed-but-uncommitted draft is the one real
    in-progress state this surface has, and committing it on the interaction that would
    otherwise abandon it keeps that invariant true without a page-level affordance."
  - "PermissionRulesTable takes an explicit loadingProjects prop from its caller instead of
    inferring 'still loading' from an empty projects array — the two states (roster still
    resolving vs. genuinely zero registered projects) both read as [] otherwise, which would
    have shown the wrong copy (the real empty-state text) during a load."
  - "Settings is checked first in App.tsx's content-area routing, ahead of the live session
    surface and the unreachable-project surface — it may be opened over either, since it is a
    global concern (credentials, permission rules) rather than a per-project one."

patterns-established:
  - "A Settings-surface segmented control's third 'default' option is a renderer-only value
    (never sent to the command surface as itself) that maps to null on the wire — the pattern
    for any future nullable per-scope override control this product adds."

requirements-completed: [AGNT-03, AGNT-04, AGNT-06]

coverage:
  - id: D1
    description: "The credential path: global two-value segmented control, write-only Keychain
      key field (masked, no reveal toggle, clears on save, Replace to overwrite), and the
      non-blocking backend-unavailable notice"
    requirement: "AGNT-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/settings/__tests__/settings-surface.test.tsx (Task 1's 12 cases, 'SettingsSurface — credential path' describe block)"
        status: pass
      - kind: other
        ref: "grep gate: zero occurrences of type=\"text\"/showPassword/revealKey in SettingsSurface.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "The per-project credential override — every registered project, the same
      control plus a third 'Use global default' option, selected when the project has no
      override and functionally able to clear one back to the default"
    requirement: "AGNT-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/settings/__tests__/settings-surface.test.tsx#every registered project renders a row with 'Use global default' selected when it has no override"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-38's allow-always rules are inspectable and revocable across every
      registered project, each row attributable to its own project (never read as global),
      with the exact empty-state copy and skeleton rows during a load"
    requirement: "AGNT-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/settings/__tests__/settings-surface.test.tsx (Task 2's 7 cases, 'SettingsSurface — permission rules' describe block)"
        status: pass
      - kind: other
        ref: "grep gate: revokePermissionRule occurs >=1 time in PermissionRulesTable.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "Settings is reachable exactly three ways — the native menu's Settings… item
      (⌘,), the global keystroke, and the command palette's generated entry — all dispatching
      through the one open-settings action id, and nowhere else"
    requirement: "AGNT-03"
    verification:
      - kind: unit
        ref: "packages/desktop/src/settings/__tests__/settings-surface.test.tsx (Task 3's 3 cases, 'Settings — reachable via menu, keyboard and palette' describe block)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace (unaffected — no Rust test exercises menu.rs/state.rs/main.rs directly; verified instead by the plan's own grep gates)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The plan's own manual verification: open Settings from the menu, from ⌘,, and
      from the palette in the real packaged app; save an API key and confirm it cannot be read
      back; grant an allow-always rule from a real permission request and confirm it appears in
      the table with its project and can be revoked"
    verification: []
    human_judgment: true
    rationale: "Every mechanism this claim depends on is unit-tested in isolation (the
      credential-path control, the write-only key field, the permission-rules fan-out read and
      revoke, the three-ways-in dispatch), but running the real packaged app has not been
      observed by a human yet. Deferred to end-of-phase UAT per
      workflow.human_verify_mode=end-of-phase, the same pattern every prior Phase 2 plan's
      SUMMARY used. Logged to .planning/WINDOWS.md (entry 7)."

duration: 45min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 10: The Settings Surface — Credential Path, Per-Project Override, and Revocable Allow-Always Rules Summary

**The product's first Settings surface: a global/per-project credential-path segmented control, a write-only Keychain-backed API key field that is never re-rendered, a cross-project permission-rules table with revoke, and one `open-settings` action id reachable from the app menu (⌘,), the keyboard, and the command palette — nowhere else.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3/3 completed
- **Files modified:** 12 (3 created, 9 modified)

## Accomplishments

- **`SettingsSurface.tsx`** (new): the same full-surface shell pattern as `SessionSurface.tsx` —
  `← Board`, project rail stays visible. The credential-path segmented control renders exactly
  `Local Claude Code Credentials` / `API Key`; selecting API Key reveals a masked input with no
  reveal toggle anywhere in the file (a structural grep gate, not just a test assertion). Saving
  clears the input and shows `API key configured on {date}.` with a `Replace` action; a rejected
  save keeps the typed value, shows an inline error, and never claims a key is configured
  (T-02-44). Every registered project gets its own row with the same control plus a third `Use
  global default` option. A missing backend binary renders the exact non-blocking notice under the
  credential path. Skeleton rows render under each section heading while its read is in flight.
- **`PermissionRulesTable.tsx`** (new): D-38's allow-always rules, fanned out across every
  registered project (`listPermissionRules` is per-project) and merged with each rule tagged by
  its own project's name — a rule can never be read as global (T-02-45). Empty state uses the
  exact "No rules yet…" copy; `Revoke` calls `revokePermissionRule` and re-reads rather than
  optimistically dropping the row; long project/tool names truncate.
- **Three ways in, one action id**: `menu.rs` gained a `Settings…` item (⌘,) in the Flywheel app
  menu between About and Quit — the macOS preferences convention. `FORWARDED_MENU_ACTIONS`,
  `MenuHandles`/`::get`, and `MENU_ACTION_IDS` all extended by exactly one id. The command palette
  generates its entry from the binding table (no hand-written label). `App.tsx` routes the surface
  the same way the session surface is routed, checked first since Settings may open over whatever
  the content area was already showing.
- **Genuine mechanism gap closed**: `settings_set_credential_mode`'s `mode` parameter was `String`,
  always passing `Some(mode)` to the domain layer even though `set_project_credential_mode`
  already supported `mode: Option<&str>` (`None` clears an override). Without this fix, the
  per-project row's own "Use global default" option could never actually fire — widened to
  `Option<String>` (Rust) / `"local" | "api_key" | null` (TS), rejecting `None` only for
  `scope="global"` (which has no further fallback to defer to).

## Task Commits

Each task was committed atomically:

1. **Task 1: The credential path — global default, per-project override, write-only key field** — `288673e` (test)
2. **Task 2: Granted authority, listed and revocable** — `e62ec4b` (feat)
3. **Task 3: Three ways in, one action id — menu, ⌘, and the palette** — `6927999` (feat)

**Plan metadata:** (this commit)

_Note: Task 1 and Task 2 carry `tdd="true"` in the plan frontmatter, but each was implemented and
its full behavior-covering test suite written together in a single commit — matching every prior
Phase 2 plan's own recorded pattern for its own `tdd="true"` tasks (02-01/02-05/02-08/02-09-SUMMARY.md
all document the same convention). No separate RED-fails-first commit exists for this plan._

## Files Created/Modified

See `key-files` in frontmatter for the full list.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: widening
`settings_set_credential_mode`'s `mode` parameter to `Option<String>` — without it, the Settings
surface's own per-project "Use global default" control would have been decorative, showing the
correct initial state but unable to actually clear an override once changed away from it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `settings_set_credential_mode`/`setCredentialMode` never allowed clearing a project override back to the global default**
- **Found during:** Task 1, implementing the per-project row's `Use global default` option
- **Issue:** `commands/settings.rs`'s `settings_set_credential_mode` took `mode: String` and always
  passed `Some(mode.as_str())` to `domain::settings::set_project_credential_mode` — which already
  accepted `mode: Option<&str>` (plan 02-09), with `None` meaning "clear the override." The command
  layer never exposed that `None` path, so the per-project control's third option had no working
  mutation to call — `tsc` itself caught this (`setCredentialMode`'s existing type signature
  rejected `null`).
- **Fix:** Widened `settings_set_credential_mode`'s `mode` to `Option<String>` and
  `setCredentialMode`'s TS type to `"local" | "api_key" | null`. `scope="global"` still requires
  `Some` (rejected with an explicit error otherwise, since the global default has no further
  fallback); `scope="project"` forwards `mode.as_deref()` straight through to the already-capable
  domain function.
- **Files modified:** `packages/desktop/src-tauri/src/commands/settings.rs`,
  `packages/desktop/src/adapters/tauri.ts`
- **Verification:** `cargo build --workspace`, `cargo test --workspace` (15/15, unaffected), `npm
  --prefix packages/desktop run build` (clean, no `error TS`)
- **Committed in:** `288673e` (Task 1 commit)

**2. [Rule 1 - Bug] `PermissionRulesTable`'s initial loading state showed the empty-state copy before the project roster resolved**
- **Found during:** Task 2, writing the loading-state test ("skeleton rows, not the empty-state
  copy, while the rules read is in flight")
- **Issue:** The table's own `loading` flag was `rulesQuery.isPending && projects.length > 0` —
  while the CALLER's `useProjects()` was still resolving, `projects` reads as `[]` (identical to
  "genuinely zero registered projects"), so `loading` evaluated `false` and the table rendered the
  real empty-state copy immediately, before any project (and therefore any rule) had a chance to
  load. This would have shown "No rules yet" as a false negative on every first paint.
- **Fix:** Added an explicit `loadingProjects` prop, set from the caller's own `projectsQuery.isPending`
  (`SettingsSurface.tsx`), and OR'd it into the loading condition — the table can now distinguish
  "roster still loading" from "roster resolved to zero" instead of inferring one ambiguous state
  from the other.
- **Files modified:** `packages/desktop/src/settings/PermissionRulesTable.tsx`,
  `packages/desktop/src/settings/SettingsSurface.tsx`
- **Verification:** `npm --prefix packages/desktop run test -- settings-surface` (all cases pass,
  including the loading-state and the zero-projects cases together)
- **Committed in:** `e62ec4b` (Task 2 commit)

**3. [Rule 2 - Missing critical] `state/uiStore.ts` needed `settingsOpen`/`setSettingsOpen`; `state/keyboard.ts`'s `MENU_ACTION_IDS` needed the new id**
- **Found during:** Task 3, wiring the Settings surface into `App.tsx`
- **Issue:** Neither file is in this plan's declared `files_modified` list, but the surface cannot
  be opened/closed without a cross-tree boolean (the same pattern `activeAgentRunId`/
  `launchSheetTaskId` already established for the session surface and the launch sheet), and the
  native-menu-to-renderer enable/disable sync (`state/menuSync.ts`'s `useMenuLayerSync`) reads
  `MENU_ACTION_IDS` to know which ids to push a verdict for.
- **Fix:** Added `settingsOpen: boolean` / `setSettingsOpen` to `uiStore.ts` (including
  `resetUiState`), and `"open-settings"` to `MENU_ACTION_IDS`.
- **Files modified:** `packages/desktop/src/state/uiStore.ts`, `packages/desktop/src/state/keyboard.ts`
- **Verification:** `npm --prefix packages/desktop run test` (292/292), `npm --prefix
  packages/desktop run build` (clean)
- **Committed in:** `6927999` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug fix, 1 Rule 2 missing-critical addition, 1 Rule 3
blocking-issue fix). **Impact on plan:** All three were necessary either to make the per-project
override control actually functional, to prevent a real false-negative render, or to wire the
surface at all. No scope creep beyond what each task's own action/behavior/acceptance criteria
already required.

## Known Stubs

None that block this plan's own goal.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None beyond what plan 02-09 already established (macOS Keychain access, an optional Anthropic API
key entered through this plan's own UI) — no new external service configuration required.

## Next Phase Readiness

- D-39's Settings surface and D-38's revocable permission-rules table are both fully implemented
  and tested — the last two Phase 2 UI surfaces this phase's ROADMAP success criteria named.
- **Requirements AGNT-03/AGNT-04/AGNT-06** are declared by this and sibling plans in this phase;
  per the shared-ID gate, each becomes `Complete` only once every declaring plan has a SUMMARY.
  This plan is the last to declare all three, so their gates resolve now that this SUMMARY exists.
- **Not yet human-observed:** the plan's own manual `<verification>` step (open Settings all three
  ways in the real packaged app, save/replace an API key and confirm it cannot be read back, grant
  a real allow-always rule from a permission request and confirm it appears in the table and can be
  revoked). Deferred to end-of-phase UAT per `workflow.human_verify_mode: end-of-phase`, the same
  pattern every prior Phase 2 plan's SUMMARY used. Logged to `.planning/WINDOWS.md` (entry 7).
- This is the last plan in Phase 2 — the phase's own `<verification>`/`<success_criteria>` should
  now be evaluated as a whole (a job for `/gsd-verify-work`, not this plan's own SUMMARY).

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 3 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 3 task
commits (`288673e`, `e62ec4b`, `6927999`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing: `npm --prefix packages/desktop
run test -- settings-surface` (22/22), full suite `npm --prefix packages/desktop run test`
(292/292, up from 270 before this plan), `npm --prefix packages/desktop run build` (clean, no
`error TS`), `cargo build --workspace` (clean), `cargo test --workspace` (full suite green, no
regressions), the no-unmask-affordance grep gate, the no-new-hex-colour grep gate, the
`revokePermissionRule` occurrence gate, the `main.rs`/`state.rs` `open-settings` occurrence gates.
The one item not re-run here is the plan's own manual `<verification>` step against the real
packaged app — genuinely out of reach in this environment, documented above and in
`.planning/WINDOWS.md` entry 7.
