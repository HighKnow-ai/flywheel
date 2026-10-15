---
phase: 14-cycles-on-screen-state-in-colour
reviewed: 2026-10-16
depth: standard
files_reviewed: 70
range: 2120f25e..HEAD
findings:
  critical: 0
  warning: 5
  info: 8
  total: 13
status: issues_found
---

# Phase 14: Code Review Report

Advisory review of the 70 source files changed under `packages/` and `scripts/`
during Phase 14, diffed against `2120f25e..HEAD`. Non-blocking.

## Summary

Every high-risk area this phase took on holds up under attack. No finding is Critical.

**`agent_runs` demo trigger** (`packages/core/tests/bin/demo_board.rs:620-631`) — plain
DDL built from ULIDs read back out of the demo database, so there is no injection
surface. It fires only for `NEW.status = 'abandoned'` on those ids, lives only in a
database the binary creates after requiring both `FLYWHEEL_APP_DATA_DIR` and
`FLYWHEEL_WORKTREE_ROOT`, and refuses any database that already holds a project. Its
failure mode is a silently ignored status write, not corruption. One theoretical hole,
not reproducible: pointed at a fresh install's real data directory that has no project
yet, it would seed there and install the trigger.

**Human-only close gate** (`packages/core/src/domain/cycle.rs:422`) — the actor check is
the first statement in `close_cycle`'s own transaction, and `cycle_close` takes no actor
argument, resolving it from the store. The IPC path cannot bypass it.

**Scope-drift tie rule** (`packages/core/src/query/cycle_scope.rs`) — the string
comparison over `to_rfc3339()` output is correct for the 0, 3, 6 and 9 digit fractional
forms, because `+` sorts below any digit.

**Epic deriver floor** (`packages/core/src/status_derivation.rs:249-300`) — an empty epic
returns `None` and never promotes; `max(candidate, current)` is correct; the `Unchanged`
task path is sound.

**CVD matrices** (`packages/desktop/src/theme/cvd.ts`) — the Machado values match the
published severity-1.0 tables.

The defects below are in the scripts, in the Cycle roster's visibility rules, and in two
tests that cannot fail.

## Warnings

### WR-01: `demo-board.sh` ignores a failed build and launches stale binaries

**File:** `scripts/demo-board.sh:44`, `:47` (also `:27`)

The script sets `set -uo pipefail` but not `-e`. It runs
`cargo build … 2>&1 | tail -3 | sed …` and never checks `PIPESTATUS`, so a failing build
prints three lines and the script carries on. The comment at lines 37-41 says a stale
binary is the worst failure mode. **This is a distinct aspect from the already-filed
release-over-debug preference** — that one is about which binary is preferred, this one
is about continuing at all after the build fails.

**Scenario:** `cargo build` fails on a half-edited working tree. The script finds the old
`target/debug/demo_board`, seeds, then finds an old `target/release/desktop` (which embeds
its own old frontend) and opens it. The `strings` checks still pass, because the old binary
honours the seams. The owner then judges colour on code that is not the working tree —
defeating the entire purpose of the demonstration board.

**Fix:**
```bash
cargo build -p core --bin demo_board -p desktop 2>&1 | tail -3 | sed 's/^/     /'
[ "${PIPESTATUS[0]}" -eq 0 ] || die "cargo build failed - refusing to seed or launch stale binaries"
```
Apply the same guard at line 47.

### WR-02: Spawned dev server is orphaned on several failure paths, in both scripts

**Files:** `scripts/capture-cycle-region.mjs:72-108`, `scripts/demo-board.sh:102-116`, `:168`

**Capture script:** `vite` is spawned at line 72, but `process.on("exit", restore)` is only
registered at line 108. Between those lines the script can leave `vite` running four ways:
- `fail("the dev server never listened")` at line 74 calls `process.exit` directly
- the `ground()` and `darkAt` throws at lines 81 and 85 are uncaught
- `isDark()` at line 96 throws when macOS Automation or Accessibility permission is
  missing — the most likely first-run failure
- in all of these the `restore` hook does not exist yet

Each leaves `npm run dev` running on port 1420. The next run's `listening()` then returns
true, silently reuses that orphan, and never reports it.

**Shell script:** `trap cleanup_dev_server EXIT` is installed at line 168, *after*
`start_dev_server_if_needed`. The `die` calls inside that function (lines 110 and 115 — for
example the 30-second timeout) run with `VITE_PID` already set but no trap installed.

**Fix:** in the capture script, move `process.on("exit", restore)` and the `SIGINT`/`SIGTERM`
handlers above the `spawn("npm", …)` call, and make `restore` tolerate `setDark` and
`originalDark` being undefined. In the shell script, install the trap before calling
`start_dev_server_if_needed`.

### WR-03: A planned Cycle ranked before the active Cycle is invisible and cannot be a close target

**Files:** `packages/core/src/domain/cycle.rs:66-72` (`ahead`),
`packages/desktop/src/board/CycleRegion.tsx:120-136`, `:147-148`,
`packages/desktop/src-tauri/src/commands/cycle.rs:135-147`

`ahead()` returns only planned Cycles *after* the active one. Planned Cycles before it
appear nowhere: not in the `later` list, not in `targets` for `CycleCloseDialog` — yet they
are counted in `total` and `listed`, so `truncated` stays false and nothing signals their
absence.

**Scenario:** Cycles C1, C2, C3 are planned and the owner calls `start_cycle(C3)`. The writer
has no ordering rule and the unique index only constrains actives. C2 then sits above the
active C3, shown nowhere. When C3 is closed, C2 cannot be chosen as an epic's destination,
and with no reorder IPC the owner cannot fix it.

Reachable from core code, not from the shipped UI — no IPC start path exists yet. It becomes
reachable the moment a start command lands.

**Fix:** pick one rule. Either enforce it in the writer (`start_cycle` refuses when a planned
Cycle has a lower rank), or show it (render all planned Cycles and use all of them as move
targets). Add a test for the first-planned-while-another-is-active case.

### WR-04: A test assertion that cannot fail, and a stale comment above it

**File:** `packages/desktop/src/board/__tests__/browser/forced-colors.browser.test.tsx:190`
(comment at `:173-175`)

```ts
expect((chip!.textContent ?? "").trim() !== "" || chip!.getAttribute("aria-label"), `${label}: no word`).toBeTruthy();
```

The chip was found at line 185 by `[aria-label^="${label}"]`, so `getAttribute("aria-label")`
is always non-empty and the right-hand side of the `||` is always truthy. The "keeps a word"
claim therefore holds even if the printed word is deleted. The comment at lines 173-175 still
says Needs Decision and CI failed "still spend `--destructive-strip`", which plan 14-09 removed.

**Fix:**
```ts
expect((chip!.textContent ?? "").trim(), `${label}: no drawn word`).toContain(label.split(" ")[0]);
```
Update or delete the stale comment.

### WR-05: `reorder_cycle` counts closed Cycles as neighbours (latent)

**File:** `packages/core/src/domain/cycle.rs:330-338`

The neighbour query filters only on `project_id`. `cycle_roster` hides `state = 'closed'`, so
moving an open Cycle past a closed neighbour swaps it with something the roster cannot show,
and the owner sees nothing happen. `tests/cycle_roster.rs` never reorders next to a closed
Cycle. Latent: `reorder_cycle` has no non-test caller today.

**Fix:** add `AND state != 'closed'` to the neighbour SELECT, with a test covering a reorder
across a closed Cycle.

## Info

**IN-01: `scopeDrift` on `later` lines is always null.**
`packages/desktop/src-tauri/src/commands/cycle.rs:141`,
`packages/desktop/src/board/CycleRegion.tsx:127-131`. `later` holds planned Cycles and drift
needs a `cycle.started` event; a Cycle cannot return to planned, so it is always null.
`cycle_region` still runs one `cycle_scope_drift` query per later line — up to 500 event scans
while holding the DB mutex — and the UI branch is dead. `cycle-region.test.tsx:794` tests a
state that cannot occur. Drop `scope_drift` from `CycleLineDto`, or document the exception.

**IN-02: Multi-window mis-grouping.** `scripts/capture-cycle-region.mjs:112-118` —
`{position, size} of every window` flattens to `x1,y1,x2,y2,w1,h1,w2,h2`. The code groups by
fours, correct only for exactly one window. Query one window, or read position and size per
window.

**IN-03: Writer edges left open.** `close_cycle` accepts `state == 'planned'`, going
`planned` → `closed` and skipping `active`. `create_cycle` accepts empty or unbounded goals —
only the UI clamps. `exit_criteria` is in the DDL and the DTO, but no writer sets it and
nothing renders it.

**IN-04: `capabilities/default.json` roster text is stale.** Still lists the deleted
`task_set_status` and `epic_set_status`, and omits `cycle_region` and `cycle_close`.
Documentation only, but it is billed as the audit roster.

**IN-05: Double screen-reader announcement.** `OrphanRecoveryModal.tsx:239-243` — the glyph is
now a `role="img"` named "Running" beside the visible "Running (from a previous session)".
Before this phase it was `aria-hidden`. Pass a variant without the image role, or restore
`aria-hidden`.

**IN-06: `launch_reconciliation_leaves_the_live_rows_live` mutates global env.**
`packages/core/tests/demo_board.rs:298` calls `set_var("FLYWHEEL_APP_DATA_DIR", …)` and never
restores it, contradicting the file header (lines 6-7) which states no process-global env is
used. `scratch()` also `mem::forget`s every temp dir, so each run leaves several seeded
databases and worktrees in the temp directory.

**IN-07: The roster pin counts commands, not names.**
`packages/desktop/src-tauri/tests/handler_roster.rs:21-24` says a stray `*_set_status` writer
"moves this number", but deleting one command and adding another keeps the count at 145 and
passes. A fair reading of what D-14 asked for; the comment overstates it. Pin the names, or
soften the comment.

**IN-08: Dev-tool minor issues.** `tests/bin/demo_board.rs:259-260` slices `&line[a+6..b]`
without checking `b >= a+6`, so a line with `</name>` before `<name>` panics.
`capture-cycle-region.mjs:146` uses `screencapture -R`, which captures a screen *region* rather
than the window, so an overlapping notification or window can land in a committed PNG. Use
`screencapture -l <windowid>`.

---

_Reviewed: 2026-10-16 · Reviewer: gsd-code-reviewer · Depth: standard · Advisory, non-blocking_
