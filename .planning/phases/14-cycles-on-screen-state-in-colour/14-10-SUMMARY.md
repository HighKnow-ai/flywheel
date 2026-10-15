---
phase: 14-cycles-on-screen-state-in-colour
plan: 10
subsystem: state-vocabulary
tags: [owner-verdict, screenshots, capture, demonstration-board, vis-07]
requires: ["14-09"]
provides:
  - "scripts/capture-cycle-region.mjs: builds the desktop binary, stands it up on the demonstration database, photographs the window in Dark and Light at OS level, checks each image's ground against the shipped token, writes a manifest, restores the system appearance"
  - "14-OWNER-VERDICT.md: the owner's yes in his own words, committed with the two screenshots and the manifest in one commit (D-27)"
  - "Eight follow-up todos in .planning/todos/pending/, none carrying resolves_phase"
affects: []
tech-stack:
  added: []
  patterns: ["capture is scripted up to the judgement and never writes a verdict", "the verdict is committed in the same commit as the images it was formed against"]
key-files:
  created:
    - scripts/capture-cycle-region.mjs
    - .planning/phases/14-cycles-on-screen-state-in-colour/14-OWNER-VERDICT.md
    - .planning/phases/14-cycles-on-screen-state-in-colour/screenshots/cycle-region-dark.png
    - .planning/phases/14-cycles-on-screen-state-in-colour/screenshots/cycle-region-light.png
    - .planning/phases/14-cycles-on-screen-state-in-colour/screenshots/capture-manifest.json
  modified:
    - .planning/REQUIREMENTS.md
decisions:
  - "Verdict recorded as a yes with the owner's words verbatim: \"all good to me\". It was given after he was shown the known-open items, the 0.19% saturated-row figure and the criterion 5 ordering question."
  - "Criterion 5 recorded as accepted by the owner, with the git facts stated plainly: 14-HIERARCHY.md (f853e244, 18:45) is not an ancestor of CycleRegion.tsx (a5c6f7d7, 18:20); it does predate every commit that shaped the three levels. No history was rewritten."
  - "The verdict states that he viewed the running application in Dark only as far as is known, and was shown both appearances as images. It does not claim he viewed the running app in both."
requirements-completed: [VIS-07]
metrics:
  duration: "about 20 minutes of agent time, across two dispatches either side of the owner's checkpoint (the wait itself is excluded)"
  completed: 2026-10-16
status: complete
plan_head_before: 2bd3f99a
actuals:
  tokens: 9000
  tasks: 2
  commits: 3
---

# Phase 14 Plan 10: The owner's verdict on the running application Summary

The owner looked at the built application on the demonstration board and said yes, in his words "all good to me"; the verdict is committed with the Dark and Light screenshots and the capture manifest in one commit.

## What was done

**Task 1 (`75d986ee`).** `scripts/capture-cycle-region.mjs`, 207 lines, Node standard library plus the macOS tools `verify-appearance.mjs` already drives. It refuses to run without the demo database (naming `scripts/demo-board.sh`), builds the binary unconditionally, proves with `strings` that it honours the app-data seam, starts the dev server the debug binary needs, launches once, photographs the window in Dark then Light, checks each image's ground against `--surface-dominant` read from `tokens.css`, writes the manifest and restores the system appearance. It records no verdict.

**Task 2 (`54ebb22f`).** `14-OWNER-VERDICT.md`, committed with `cycle-region-dark.png`, `cycle-region-light.png` and `capture-manifest.json` in one commit.

## The verdict, and what it covers

**Verdict: yes.** Owner's words: "all good to me". Date 2026-10-16. Lead epic FLY-1015, active Cycle FLY-1, database `/Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/target/demo-board/appdata/flywheel.db`.

- He ran the application himself from his terminal and looked at it. The system appearance was Dark at launch; whether he switched to Light is **not known**. Both captured appearances were put in front of him as images. The record says exactly that.
- Before answering he was shown, in writing, seven known-open items, the 0.19% saturated-row figure and the criterion 5 ordering question. The yes followed immediately, so it was given with those known.
- Criterion 5: he accepted the ordering as satisfied. The facts are in the verdict file and in deviation 1 below, so the acceptance is auditable rather than only favourable.

## Capture manifest (quoted from `screenshots/capture-manifest.json`)

| | Dark | Light |
|---|---|---|
| Image | `cycle-region-dark.png` | `cycle-region-light.png` |
| sha256 | `bf09356558d05a97...d2680e` | `02551ee07284dd5d...a39eff04` |
| Captured | 2026-10-15T13:43:14Z | 2026-10-15T13:43:19Z |
| Ground token / share | `#0a0a0a` / 0.448 | `#ffffff` / 0.49 |

Binary `target/debug/desktop` (debug, built this run, sha256 `db3b6a76...ffd10b6`), source head `75d986ee`, no dirty files. The stale release binary (mtime 2026-10-12) was named in the manifest as not used. Database path in the manifest equals the path above, the one `scripts/demo-board.sh` prints. System appearance before the run was Dark and was restored.

## Deviations from Plan

**1. [Plan text - reported, not a pass] Criterion 5 ordering.** `14-HIERARCHY.md` (`f853e244`, 2026-10-15 18:45, plan 14-02) is not a git ancestor of `CycleRegion.tsx` (`a5c6f7d7`, 18:20, plan 14-01's tracer slice). The statement predates every commit that shaped the three levels (`8db0e8d8` onward). Cause for future phases: tracer-first ordering and criterion 5's statement-first ordering are in tension and the phase plan did not reconcile them. The owner ruled it satisfied. No history was rewritten.

**2. [Plan text] The verdict-commit verify one-liner cannot pass as written.** `git log -1 --name-only -- <verdict file>` lists only the path it is limited to, so its `.png` count is always 0. Run instead as `git show --name-only --format= <commit that last touched the verdict> | grep -c '\.png'`, which returned 2. No assertion was weakened; the same fact was measured without the pathspec limiting the output.

**3. [Rule 1 - found by this plan] Each app launch writes three false `agent_run.abandoned` events** into the seeded runs' event trail, because 14-03's `BEFORE UPDATE` trigger cancels the reconciler's status write but not the event (first noted as a residue in 14-03's SUMMARY). Filed as a todo; not fixed here (out of scope: a core change on a plan whose job is a verdict).

**4. [Environment] The application was not relaunched and nothing was re-captured** after the verdict, on instruction: the owner may still have the app running, and a second launch rewrites the seeded runs.

**5. [Plan text] Not run.** The desktop suite and the theme gates in Task 2's verify list were not re-run in this dispatch: the verdict is a yes, so no verdict-driven change was made and this dispatch touched only planning files and the capture script. Last run green in 14-09.

## Follow-ups filed (`.planning/todos/pending/`, commit `e6ae435d`)

None carries `resolves_phase`.

1. `2026-10-16-rail-needs-decision-count-is-red-beside-amber-blocked.md`
2. `2026-10-16-app-shell-content-child-has-no-min-width-zero.md`
3. `2026-10-16-demo-seeder-cycle-goals-include-rest-of-roadmap-line.md`
4. `2026-10-16-epic-rows-draw-no-state-even-with-a-running-agent.md`
5. `2026-10-16-demo-board-does-not-exercise-ci-failed-merged-or-proposal-mark.md`
6. `2026-10-16-dark-needs-you-wash-not-visible-inside-contrast-envelope.md`
7. `2026-10-16-demo-board-script-prefers-stale-release-binary.md`
8. `2026-10-16-app-launch-writes-false-abandoned-events-on-demo-runs.md`

## Requirements

VIS-07 marked complete (checkbox and traceability row). VIS-03, VIS-04 and VIS-06 were already `[x]` and `Complete`; plan 14-09 marked them once its SUMMARY existed, so the shared-ID gate had nothing left to refuse. REQUIREMENTS.md still lists VIS-07 as re-asserted in later phases' success criteria; that is the requirements file's own mapping, not a routing of this verdict.

## Known Stubs

None.

## Threat Flags

None. A capture script and planning documents; no new endpoint, auth path or schema change. T-14-10-07: the capture opened only the demonstration database, named in the manifest.

## Self-Check: PASSED

`scripts/capture-cycle-region.mjs`, `14-OWNER-VERDICT.md`, both PNGs and the manifest exist; commits `75d986ee`, `54ebb22f` and `e6ae435d` are in `git log`; `git rev-list --count 2bd3f99a..HEAD` was 3 at write time. The verdict file contains an explicit `**Verdict: yes**` line, quotes his words, names a `.png`, and `grep -ciE "phase 18|later phase|defer"` over it returns 0.
