---
phase: 11-ship-it
plan: 21
subsystem: distribution
tags: [deferred-review, owner-pass, board-filing, d-196, dist-01, dist-02, dist-03, dist-04]
requires:
  - phase: 11-ship-it
    provides: "11-08 to 11-20: the installed build and every automated closure the register is redeemed against"
provides:
  - ".planning/DEFERRED-REVIEW.md redeemed: 67 items, each with a final disposition, inline evidence and board keys"
  - ".planning/phases/11-ship-it/11-OWNER-PASS.md: the 67-row collation, the installed-build observations and the owner's answers"
  - "packages/core/tests/bin/file_board_items.rs: files epics, tasks, issues and criteria through the core's own write verbs, capped at schema 21"
  - "79 items on Flywheel's own board (THRE-1081 to THRE-1159): 3 epics, 48 tasks with 94 criteria, 28 issues"
  - "D-201 to D-207 in 11-CONTEXT.md; PLAN-04, the brand rule, README and release notes brought into line with them"
affects: [phase-11-verification, phase-12, ship]
status: complete
commits: 7
plan_head_before: 19cd83366ef33a6af5bbe1fa5a617d650acefdac
actuals:
  tokens: 60000
  tasks: 3
  commits: 7
tech-stack:
  added: []
  patterns:
    - "A maintenance binary opens the real database through core::db::open_and_migrate_with with a truncated migration list, so it never leaves the file ahead of the installed app"
    - "Board filing is data (a JSON payload) plus a tool that writes only through domain verbs and is idempotent by title"
key-files:
  created:
    - packages/core/tests/bin/file_board_items.rs
    - .planning/phases/11-ship-it/11-21-board-payload.json
    - .planning/phases/11-ship-it/11-21-board-filing.log
    - .github/release-install-note.md
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/Cargo.toml
    - .planning/DEFERRED-REVIEW.md
    - .planning/phases/11-ship-it/11-OWNER-PASS.md
    - .planning/phases/11-ship-it/11-CONTEXT.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md
    - packages/desktop/src/theme/__tests__/brand-rule.test.ts
    - README.md
    - .github/workflows/release.yml
key-decisions:
  - "D-201: PLAN-04 narrowed to the file-writing tools; a Bash write is detected and an observed breach holds the merge."
  - "D-202: ROADMAP Phase 8.1 criterion 3 says a group reveals its rows with a wipe (the text already read so since 2026-10-09)."
  - "D-203: the brand rule allows the developer's own turn in the feed; not moved to ink."
  - "D-204: five layout calls filed as decisions, none implemented. D-205: the xattr -cr workaround documented. D-206: the banner dismissal stays per session. D-207: filing by script after a sqlite3 .backup."
  - "The filing tool stops at schema 21, not 22, because the installed 0.1.1 has no migration 22."
  - "DIST-02 is unticked: the updater URL answers 404 while both releases are Pre-release. The marking was not changed; it is the owner's call."
requirements-completed: []
duration: "about 1 h 15 min for Task 3 (Tasks 1 and 2 ran in the earlier session)"
completed: 2026-10-14
---

# Phase 11 Plan 21: The owner pass and the register's redemption Summary

**The deferred-review register is closed to `redeemed` with 67 items accounted for, 79 survivors are real items on Flywheel's own board with acceptance criteria, and the phase closes with DIST-01 criterion 1 unmet, DIST-02 newly found broken, and 22 owner questions still unanswered.**

## What was done

**Task 1 (earlier session, `8e235d0`, `baeb4a8`, `edd62f8`).** The collation of every register item, and a scripted drive of the installed app through the accessibility tree that closed items the register had filed as "needs a person". It also found D-REV-65 (the fleet subject key opens nothing) and D-REV-66 (the banner dismissal does not survive a relaunch).

**Task 2 (checkpoint, answered by the owner on 2026-10-14).** The orchestrator relayed his answers. Section 6 of `11-OWNER-PASS.md` records them as relayed, not as a transcript of his own typing.

**Task 3 (this session).**

1. **Backup first.** `sqlite3 .backup` of `~/Library/Application Support/Flywheel/flywheel.db` to `/Users/cymarechal/flywheel-db-backup-2026-10-14.db`. **2,650,112 bytes (2.7 MB)**, integrity `ok`, `user_version` 18, 907 tasks, 13 epics, sha256 `b5a68f2840823c503fbc6c8f642c5aa7edb9cce0a8ac7133e2b74db251ef44ba`. Checked before any write.
2. **D1, D2, D3 applied with their decisions cited** (D-201, D-202, D-203). `brand-rule.test.ts` passes 4 of 4 after the spec and the allowlist were widened together.
3. **D5 documented.** README section "Installing a release", `.github/release-install-note.md`, a release-workflow step that adds the note to the release page (not to the body the update banner shows), and the release pages of `v0.1.0` and `v0.1.1` (prior bodies kept in the session scratch). The wording says the app is unsigned and names both releases as Pre-release.
4. **D7 filing.** `file_board_items` was run on a scratch copy first, then on the real database: 3 epics, 48 tasks, 28 issues, 94 criteria; the real database went from schema 18 to **21** (read back: `user_version` 21, integrity `ok`; tasks 907 to 955, epics 13 to 16, issues 161 to 189, criteria 15 to 109). It wrote only through `create_epic`, `create_task`, `update_task`, `set_priority`, `create_issue` and `create_criterion`.
5. **The register closed.** `status: redeemed`, `reviewed_at: 2026-10-14`, all 67 items kept with `status`, `prior_status`, `redeemed` (evidence inline) and `board_items`.

## Disposition counts (assert)

closed-automated 17, closed-by-decision 9, accepted-by-design 2, owner-question 22, filed-to-board 17. 17 + 9 + 2 + 22 + 17 = **67**.

## The phase's four success criteria, one by one

| # | Criterion | State | Artefact |
|---|---|---|---|
| 1 | Signed, notarized build opens with no Gatekeeper warning | **NOT MET.** The build is ad-hoc signed. The owner declined the Apple purchase (D-REV-60). The first screen a stranger sees is a "damaged" dialog with no Open button; `xattr -cr` is a workaround, not a fix. | `11-RELEASE-EVIDENCE.md` § 3; `11-OWNER-PASS.md` § 2.1; `11-21-gatekeeper-dialog.png` |
| 2 | Offered a new release inside the app and updates without a manual reinstall | **NOT MET for a real user today.** The mechanism was observed end to end by automation on a copy of the installed `0.1.0` (banner, install, relaunch into `0.1.1`). The owner did not watch it and it was not in place on `/Applications`. Since both releases were marked Pre-release the updater URL answers **404**, so no installed client can find an update (D-REV-67). | `11-OWNER-PASS.md` § 2.2; `11-21-about-after-update.png`; `curl -sIL` on the endpoint |
| 3 | A developer clones and builds by the documented steps | **Met on the tag, not yet on `main`.** A fresh HTTPS clone built a bundle after a README fix. `main` still has the old README and a red CI until the branch is merged. | `11-RELEASE-EVIDENCE.md` § 5 |
| 4 | Fully functional standalone | **Met by the CI proof.** `open-core.yml` deletes `packages/relay-client`, checks nothing references it, then builds, tests and builds the renderer. Not observed by a person using the app offline. | `.github/workflows/open-core.yml`, run 38346860235 |

## Unanswered (not passed)

22 `owner-question` items, each now a question issue on the board under THRE-1137: D-REV-05, 07, 08, 09, 10, 21, 23, 24 (SC0), 33, 34, 35, 36, 47, 48, 49, 50, 51, 52, 53, 54, 55, 63. SC0 ("bold and modern") is among them: the captures were shown and no verdict was given.

## Deviations from Plan

**1. [Rule 3 - Blocking] The register holds 67 items, not 55.** The plan's gates assert 55. Plans 11-06, 11-08 and 11-19 added items afterwards, this plan found D-REV-65 and 66, and the filing found D-REV-67. The gates were run against 67 and the tables assert 67.

**2. [Rule 2 - Missing critical] `open_and_migrate_with` added to `core::db`.** The owner's approval covered a migration to 21. This branch has a 22nd migration, and the plain `open_and_migrate` would have taken his file to 22, past the installed app. `open_and_migrate` now calls the new function with the full list; the tool passes a list cut at 21. `cargo test -p core --test migration_safety` passes (6 of 6). Commit `9415a85`.

**3. [Finding, not fixed] The updater endpoint answers 404 (D-REV-67).** Found while writing the release note. GitHub's `latest` skips Pre-releases and both releases are Pre-release. I did not change the marking: it is the owner's choice, made for a reason. DIST-02 is unticked and a priority-1 board task (THRE-1136) names the fix. **This needs an owner decision soon:** un-mark the newest release as Pre-release, or point the updater at an endpoint that serves Pre-releases.

**4. [Wording] D2 found the ROADMAP already amended.** Criterion 3 has read "reveals its rows by a top-down wipe" since 2026-10-09. I added the dated ruling and corrected the register's claim that it had never been amended.

**5. [Scope] The live release pages were edited.** D5 asked for the release notes. I added the note to the GitHub pages of `v0.1.0` and `v0.1.1` with `gh release edit`. `latest.json` (which the update banner reads) was checked and is unchanged. Neither release was deleted or un-marked.

**6. Not filed, by design.** BI-15 (closed by D-203) and BI-41 (done by D-205). BI-49 was filed as a gated, priority-4 task rather than a plain task.

**Total deviations:** 2 auto-fixed, 1 finding for the owner, 3 recorded notes. **Impact:** none on the owner's data beyond the approved 18 to 21 migration.

## Other things worth knowing

- **A stray process is still running.** `/Applications/Flywheel.app/Contents/MacOS/desktop` (pid 8172, started 12:40) and its sidecar are running against a scratch HOME in the session's scratchpad, not the owner's database. I did not start it in this session and did not stop it. It holds no handle on the real database (checked with `lsof`).
- **The 22 question issues cannot carry criteria** (issues have none in the schema), so each states "Done when: the owner's verdict and its date are written on this issue". The 48 tasks do carry criteria; 9 of them have one criterion because the second would have been filler.
- **Pre-existing uncommitted changes were left alone:** the Phase 05 transcripts, `08.1-VERIFICATION.md`, the deleted `.gitkeep`, `state.json`, `.flywheel/`, `.gsd/`, `milestone.lock`.
- `main` was not touched.

## Known Stubs

None.

## Threat Flags

None new. `file_board_items` writes to the real database but refuses without `--i-mean-the-real-database` (or an override directory) and refuses unless the schema reads 21. The new workflow step uses `GITHUB_TOKEN` to edit the release it just created.

## Self-Check: PASSED

Verified: `11-OWNER-PASS.md`, `DEFERRED-REVIEW.md`, `11-21-board-payload.json`, `11-21-board-filing.log`, `file_board_items.rs`, `.github/release-install-note.md` exist; commits `9415a85`, `a28f026`, `3ae8d3c`, `8771ce6` exist; 67 `^- id: D-REV-` entries and 67 `^| D-REV-` rows; `status: redeemed`; `reviewed_at` filled; DIST-01 criterion 1 still recorded unmet; real database reads schema 21, integrity ok, 955 tasks; backup readable.
