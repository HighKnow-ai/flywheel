# Phase 14 Owner Verdict: the Cycle region and state in colour

Plan 14-10, Task 2. Satisfies VIS-07 and ROADMAP success criterion 6 (the owner looked at the built application).

**Verdict: yes**

> "all good to me"

That is the owner's complete answer, verbatim, given on 2026-10-16.

## What was looked at

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| What he judged | The running application (`target/debug/desktop`), not the images. He launched it himself in his own terminal. |
| Appearance he viewed the running application in | **Dark** (the system appearance at launch). It is **not known** whether he switched to Light while looking. |
| Appearances shown to him as captured images | Both: Dark and Light. |
| Demonstration database | `/Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/target/demo-board/appdata/flywheel.db` |
| Lead epic on screen | FLY-1015 |
| Active Cycle | FLY-1 |
| Seed report (the re-seed he ran) | `cycles=5 epics=278 tasks=760 issues=9 running=2 blocked=1 failed=1 completed=1 abandoned=1 awaiting_review=1 proposals_pending=3 commits_ahead=1 dirty=1 merged=1 active_cycle=FLY-1 lead_epic=FLY-1015` |

Command he ran:

```
DEMO_SEED_ONLY=1 scripts/demo-board.sh && (cd packages/desktop && npm run dev &) && FLYWHEEL_APP_DATA_DIR=$PWD/target/demo-board/appdata FLYWHEEL_WORKTREE_ROOT=$PWD/target/demo-board/worktrees target/debug/desktop
```

## The record the verdict was formed against

- `screenshots/cycle-region-dark.png` (sha256 `bf09356558d05a97fb78a0f85e62eb2d00d724bc48a4c3169c756a8314d2680e`)
- `screenshots/cycle-region-light.png` (sha256 `02551ee07284dd5df96630756f2247e6e9291fcdb4ee1d4632e7a9b9a39eff04`)
- `screenshots/capture-manifest.json`: names the launched binary, its sha256, the opened database and the source commit `75d986ee` behind each image.

The images were captured by `scripts/capture-cycle-region.mjs` (commit `75d986ee`). They are the record of the application, not the thing judged.

## What the yes was given over

Before he answered, he was shown in writing: the known-open items below, the measured saturated-row figure, and the criterion 5 ordering question. He answered immediately after, so the yes was given with these known, not in ignorance of them.

**Measured saturated-row figure:** 0.19% of rows (14-09 SUMMARY, 14-DIRECTION.md).

**Known-open items.** Each is filed as a todo in `.planning/todos/pending/`; none is a Phase 14 defect.

1. The rail's "Needs decision" count is red beside the amber "Blocked" count (row pills were fixed in 14-09, the rail count was not).
2. The app shell's content child has no `min-width: 0` (`packages/desktop/src/App.tsx`, lines about 101 and 395).
3. The seeder's Cycle goals include the rest of the roadmap line (`Mode: mvp Depends on: ...`).
4. Epic rows draw no state at all, even FLY-1015, which has a running agent.
5. `ci_failed`, `merged` and the task-row proposal mark are not exercised anywhere on the demonstration board.
6. The dark needs-you wash is not visible and cannot be made visible inside the current contrast envelope: best reachable 4.79 against 4.43 shipped, bounded by the dark brand text lift. Recorded in `14-DIRECTION.md`. Changing it needs the envelope itself to change.
7. `scripts/demo-board.sh` prefers a stale release binary over the current debug build, so a bare run shows an old frontend. The capture script works around it; `demo-board.sh` was not fixed.

A further finding, filed after the verdict: each app launch against the demonstration database writes three false `agent_run.abandoned` events into the seeded runs' event trail, because 14-03's `BEFORE UPDATE` trigger cancels the reconciler's status write but not the event.

## Criterion 5: the ordering ruling

Criterion 5 requires the hierarchy statement to predate the work it governs. The owner was asked to rule on this and the yes followed. **He accepted the ordering as satisfied.** The facts underneath that acceptance:

- `14-HIERARCHY.md` was committed as `f853e244` on 2026-10-15 at 18:45 (plan 14-02).
- `packages/desktop/src/board/CycleRegion.tsx` was created as `a5c6f7d7` on 2026-10-15 at 18:20 (plan 14-01, the tracer slice).
- The statement is therefore **not a git ancestor** of the component, and the plan's own verify one-liner exits 1.
- The statement **does** predate every commit that shaped the three levels (`8db0e8d8` onward).
- No history was rewritten.
- Structural cause, for future phases: tracer-first plan ordering and criterion 5's statement-first ordering are in tension, and the phase plan did not reconcile them.

## Round

Round 1 of 1. The verdict is a yes, so no tuning round followed and nothing is appended beneath it.
