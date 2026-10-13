---
phase: 11-ship-it
plan: 06
subsystem: desktop-update-ui
tags: [update-banner, tanstack-query, zustand, ipc-seam, dist-02]
requires:
  - phase: 11-ship-it
    provides: "11-05 update_check and update_install Tauri commands; install refuses in Rust by live-run count"
provides:
  - "updateCheck() and updateInstall() plus UpdateCheckDto and UpdateInstallDto at the one adapter seam"
  - "useUpdate() (checks on mount and every 6 hours) and useLiveRunCount()"
  - "UpdateBanner: dismissible, names version and notes, names the live-run count, shows a failed install"
  - "uiStore dismissedUpdateVersion (a version string) and its setter"
affects: [11-08, 11-21]
tech-stack:
  added: []
  patterns:
    - "Live-run count for display rides the shared fleet read; the authoritative refusal stays in Rust"
    - "Release notes are a React text child only, never HTML"
key-files:
  created:
    - packages/desktop/src/update/useUpdate.ts
    - packages/desktop/src/update/UpdateBanner.tsx
    - packages/desktop/src/update/update.css
    - packages/desktop/src/update/__tests__/update-banner.test.tsx
  modified:
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/fleet/useFleet.ts
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "The banner is position: fixed in the bottom-right corner, like the app's other toasts, not a row in the flex layout. #app-root is a flex row of rail and content, so a sibling row would have become a third column; a fixed element shows over every surface without moving the rack."
  - "Dismissal lives in the Zustand store as the dismissed version string, so it lasts for the window and a later version offers itself again. A relaunch asks again; it is not persisted to disk."
  - "The display count comes from the fleet read as the plan said. 11-05 found that read is capped at 200 rows, so when Rust refuses with a count the fleet read missed, the banner shows Rust's count instead."
  - "The update copy says nothing about signing or notarization. The release is unsigned by Apple; the Tauri updater key verifies the payload, which the banner does not claim either."
requirements-completed: [DIST-02]
duration: "about 20 min"
completed: 2026-10-13
status: complete
commits: 3
plan_head_before: 9c2b8a3171724de0e0cddf5ab27b54214fdffff5
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
coverage:
  - id: D1
    description: "The renderer reaches update_check and update_install only through adapters/tauri.ts, with DTO fields matching the Rust camelCase output"
    requirement: DIST-02
    verification:
      - kind: command
        ref: "npm run build (tsc, tsc browser-tests, vite build) green; grep of production source for @tauri-apps/ outside adapters/tauri.ts returns nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "A newer release is offered as a dismissible banner naming the version and notes; accept installs once and says a relaunch applies it; dismissal holds for that version only"
    requirement: DIST-02
    verification:
      - kind: unit
        ref: "packages/desktop/src/update/__tests__/update-banner.test.tsx (8 banner tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "With live runs the banner names the count and accept does not call updateInstall; a failed install shows its error and keeps the banner"
    requirement: DIST-02
    verification:
      - kind: unit
        ref: "update-banner.test.tsx: names the live-run count and does not install while agents run; shows Rust's refusal count...; shows a failed install's error and keeps the banner"
        status: pass
    human_judgment: false
  - id: D4
    description: "The banner is drawn by the real AppShell inside #app-root on the board and on a fresh install, and absent without an update"
    requirement: DIST-02
    verification:
      - kind: unit
        ref: "update-banner.test.tsx, describe 'UpdateBanner in the application shell' (3 tests); project-rail and unreachable-in-app suites still pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "An installed older build shows the banner, installs a newer release and runs it after relaunch; the corner placement reads well in a real window"
    requirement: DIST-02
    verification: []
    human_judgment: true
    rationale: "Needs two installed builds and a published newer release; WKWebView has no WebDriver for the look. Queued as D-REV-61, not claimed."
---

# Phase 11 Plan 06: The update banner Summary

**Flywheel now offers a newer release inside the running application as a dismissible banner naming the version and its notes. Accepting stages it for the next relaunch, and while any agent runs the banner says "N agents running" and installs nothing. That an installed build actually updates itself has NOT been observed.**

## Performance

- **Tasks:** 3 of 3
- **Commits:** 3 (measured, `git rev-list --count 9c2b8a3..HEAD`)
- **Tests:** `npx vitest run` in `packages/desktop`: 89 files, 1474 passed, 2 expected fail (pre-existing). `npm run build` green.
- **Not run:** the browser suites (`*.browser.test.tsx`). `App` now fetches `update_check` on mount, which outside Tauri is a rejected query and draws nothing, so I expect them unaffected, but I did not run them.

## Accomplishments

- **The seam.** `updateCheck()` and `updateInstall()` in `adapters/tauri.ts`, with interfaces copied from the Rust DTOs. The real `UpdateInstallDto` is `{staged, refused, liveRuns, version, message}`; the plan guessed a discriminator plus `liveRunCount`, and the Rust source won. The doc comment on `updateInstall` states that Rust is the enforcement point and the renderer's check is display only.
- **The hook.** `useUpdate()` runs on mount and every 6 hours, with the same figure as the stale time so a window-focus refetch cannot turn every alt-tab into a network call, and `retry: false` so a failed check is quiet. `useLiveRunCount()` counts `running` and `blocked` rows from the shared fleet read.
- **The banner.** Renders nothing without an update or when the version equals `dismissedUpdateVersion`. Otherwise: version, current version, notes, "Install on relaunch", "Not now". With live runs it names the count ("2 agents running. The update waits until they finish.") and the accept button is disabled with that line as its accessible description. A failed install shows its error in an alert and keeps the banner. A Rust refusal the fleet read missed shows Rust's count and re-reads the fleet.
- **The mount.** One element, `updateBannerNode`, shared by the board branch and the fresh-install branch of `AppShell`, inside `#app-root`, not a Surface. A comment records the first-run decision (mount it: that user is the most likely to hold a stale first download).
- **Threat T-11-17.** Notes render as a React text child; a test feeds `<img onerror>` and an anchor and asserts neither becomes an element.

## Task Commits

1. **Task 1: adapter wrappers** - `2cd333b` (feat)
2. **Task 2: hook, banner, css, store** - `301b601` (feat)
3. **Task 3: mount in the shell** - `37a4edc` (feat)

**Plan metadata:** the docs commit following this file (SUMMARY, STATE, ROADMAP, REQUIREMENTS, DEFERRED-REVIEW).

## Deviations from Plan

### Plan conflicts

**A. [Plan conflict] The Task 1 grep gate counts tests and comments.** The plan's check `grep -rl "@tauri-apps/" src ... | grep -v adapters/tauri.ts | wc -l` must be `0`, but it returns `3`: `adapters/__tests__/changes-request-adapter.test.ts` (a `vi.mock` of the module) and comments in `settings-surface.test.tsx` and `permission-card.test.tsx`. All three pre-date this plan. Restricted to production source (excluding `__tests__`) the count is `0`, which is what T-11-19 actually asks. Not widened or "fixed".

**B. [Plan conflict] "Reuse the fleet read" for the count.** Done as written for display, but 11-05 established that read is capped and can omit a live run. The banner therefore also shows Rust's own count from a refusal when the fleet read showed none. Rust remains the guard.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing tests that mount `App` mock the adapter without `fleetList`/`updateCheck`.**
- **Found during:** Task 2, planning the mount
- **Issue:** `useFleet` passed `queryFn: fleetList` eagerly, so reading a missing export from a `vi.mock` factory would throw during render in `project-rail`, `unreachable-in-app`, `menu-bridge` and `jump` tests.
- **Fix:** `useFleet`'s `queryFn` is now `() => fleetList()` (lazy), and `useUpdate`'s is `() => updateCheck()`. A missing export fails the query, not the render. No test mock was edited.
- **Files modified:** `packages/desktop/src/fleet/useFleet.ts` (not in the plan's file list)
- **Verification:** full desktop suite, 1474 passed
- **Commit:** `301b601`

**2. [Rule 1 - Bug] Test isolation: `App` shares one module-level QueryClient.** My first shell test passed an "absent" case against the previous test's cached "present" answer. The shell tests now call `appQueryClient.clear()` before each. **Commit:** `37a4edc`

**Total deviations:** 2 plan conflicts, 2 auto-fixed. **Impact:** one extra file touched (`useFleet.ts`, a one-line lazy wrapper).

### Process note

The tests were written after the banner code, not before it, so there was no observed red step for Task 2. The tests do bite: removing the disabled guard or the version comparison fails them by inspection of the assertions (`updateInstall` not called; a different version re-offered), but I did not run a mutation check.

## Known limits, stated plainly

- **Dismissal is per window, not per install.** It lives in the Zustand store, so a relaunch offers the same version again. The plan's wording ("remembered for that version only") fits either reading; persistence to disk would be one `localStorage` key if the owner wants it.
- **The banner's look is unreviewed.** It is a fixed bottom-right card using existing tokens and the drawn-action buttons; no one has seen it in a real window.
- **The fleet count is capped** (see Deviation B).

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the two commands were 11-05's.

## Next Phase Readiness

- 11-08 verifies an installed, unsigned build; the banner will be there to observe once a newer release exists. The installed-client half is queued as **D-REV-61** in `DEFERRED-REVIEW.md` (automatable once 11-08's build exists), next to D-REV-57 and D-REV-60.

## Self-Check: PASSED

- Files exist: `useUpdate.ts`, `UpdateBanner.tsx`, `update.css`, `update-banner.test.tsx`.
- Commits present: `2cd333b`, `301b601`, `37a4edc` (`git rev-list --count 9c2b8a3..HEAD` = 3).
- `grep -c UpdateBanner App.tsx` = 2; `grep -c dismissedUpdateVersion uiStore.ts` = 4; `grep -cE "10px|9px|8px" update.css` = 0.
- `npx vitest run src/update src/projects`: 28 passed. Full desktop suite: 1474 passed. `npm run build` green.
