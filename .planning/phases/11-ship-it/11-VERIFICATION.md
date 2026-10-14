---
phase: 11-ship-it
verified: 2026-10-14T06:53:42Z
status: gaps_found
score: 3/4 must-haves verified
covered_files:
  - ".github/workflows/ci.yml"
  - ".github/workflows/open-core.yml"
  - ".github/workflows/release.yml"
  - ".planning/DEFERRED-REVIEW.md"
  - ".planning/REQUIREMENTS.md"
  - "ARCHITECTURE.md"
  - "LICENSE"
  - "README.md"
  - "packages/desktop/src-tauri/src/commands/update.rs"
  - "packages/desktop/src-tauri/tauri.conf.json"
  - "packages/desktop/src/update/UpdateBanner.tsx"
covered_digest: "v1:sha256:aa62c7741dd8183c93915b3c742b1e5cc157f5f88c1d356d5f943d7d3f653ea8"
behavior_unverified: 0
overrides_applied: 0
re_verification: null
gaps:
  - truth: "User installs a signed, notarized macOS build and opens it with no Gatekeeper warning. (ROADMAP SC 1 / DIST-01)"
    status: failed
    reason: "The build is ad-hoc signed only and is not notarized. Owner declined the Apple Developer purchase on 2026-10-13 (D-REV-60); plan 11-07 is `deferred` with zero tasks executed. A quarantined copy shows 'damaged and can't be opened' with only Move to Trash and Cancel. The only way in is the `xattr -cr` workaround."
    artifacts:
      - path: "/Applications/Flywheel.app"
        issue: "codesign: Signature=adhoc, TeamIdentifier=not set. spctl --assess exits 1 ('code has no resources but signature indicates they must be present'). Re-run by this verifier on 2026-10-14."
      - path: ".github/workflows/release.yml"
        issue: "No APPLE_* env group; line 81 comment defers it to plan 11-07."
      - path: "scripts/release/verify-gatekeeper.sh"
        issue: "Never written (plan 11-07 deferred). The directory holds only apply-tag-version.mjs, ax-drive.js, verify-appearance.mjs and verify-bundle-assets.sh."
    missing:
      - "Apple Developer ID Application certificate, notarization and stapling in release.yml (plan 11-07 Tasks 1-3)"
      - "A Gatekeeper verification run against the downloaded release artifact"
deferred: []
advisory: []
coincidental_reliance_items: []
---

# Phase 11: Ship It Verification Report

**Phase Goal:** Cyril installs Flywheel like any other Mac application and it keeps itself current, and another developer can clone the repository and build it.
**Verified:** 2026-10-14T06:53:42Z
**Status:** gaps_found
**Re-verification:** No, initial verification

## Verdict in one paragraph

Three of four ROADMAP success criteria hold on evidence this verifier checked itself. Criterion 1, the signed and notarized build, is **UNMET** and is recorded that way. The owner chose not to buy the Apple Developer account, and the shipped artifact is ad-hoc signed. That is a BLOCKER for DIST-01 and for a literal reading of the phase goal ("like any other Mac application"). It is a known, owner-decided gap, not a hidden one. Nothing in the phase artifacts claims otherwise. One further caveat matters for DIST-03 and DIST-04: the CI runs on the final tree have **not** concluded green. The push CI and Open core runs on the branch tip failed on a known flaky test. The runs on the merged `main` commit were still in progress when this report was written.

## Goal Achievement

### Observable Truths (ROADMAP success criteria are the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User installs a signed, notarized macOS build and opens it with no Gatekeeper warning | FAILED (BLOCKER) | See "Criterion 1" below. |
| 2 | User is offered a new release inside the app and updates without a manual reinstall | VERIFIED (automation-observed, on a copy; limit stated) | See "Criterion 2" below. |
| 3 | A developer clones the repository and builds a working desktop application by following the documented steps | VERIFIED, with an open CI caveat | See "Criterion 3" below. |
| 4 | The installed open-source application is fully functional standalone: no account, no network service, no feature gated behind either | VERIFIED | See "Criterion 4" below. |

**Score:** 3/4 truths verified. 0 present-but-behavior-unverified.

### Criterion 1: signed, notarized, no Gatekeeper warning. FAILED

Evidence this verifier collected:

- `codesign -dv /Applications/Flywheel.app` gives `Signature=adhoc` and `TeamIdentifier=not set`.
- `spctl --assess --type execute -vv` gives "code has no resources but signature indicates they must be present". This matches `11-RELEASE-EVIDENCE.md` § 3.
- `11-21-gatekeeper-dialog.png` (viewed) shows the French "Flywheel.app est endommagé et ne peut pas être ouvert", with only "Placer dans la corbeille" and "Annuler" as buttons. **No Open button exists.** The "right-click Open" workaround in the older 11-07 text does not apply.
- `release.yml` has no `APPLE_*` env group.
- `scripts/release/verify-gatekeeper.sh` does not exist.
- `gh secret list` per `11-RELEASE-EVIDENCE.md` § 1 shows only the two Tauri updater secrets.

The README now tells a stranger the true state: unsigned, "damaged" dialog, `xattr -cr`. That is a documented workaround, not a signed build. `v0.1.0` is marked Pre-release; `v0.1.1` was un-marked on 2026-10-14 to repair the updater endpoint.

Plan 11-07's SUMMARY does not overclaim. It says `status: deferred`, `tasks: 0`, "No production file was changed", and "DIST-01 criterion 1 is NOT met". I confirmed no signing config exists in the tree.

**This is not an override candidate.** The criterion's intent (a stranger opens the app without a warning) is not achieved by any alternative implementation. Only an Apple-account purchase closes it. No later phase in the milestone covers it (Phase 12 is the unrelated destructive-gate redesign), so it is not a deferred item either. It is an open gap that waits on an owner decision.

### Criterion 2: offered an update and updates without a manual reinstall. VERIFIED

- **Endpoint:** `curl -sIL https://github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json` returns a 302 to `releases/download/v0.1.1/latest.json`, then **HTTP 200**. The served manifest reads `version: 0.1.1` with a non-empty `darwin-aarch64` signature. `gh release list` shows `v0.1.1` as Latest and `v0.1.0` as Pre-release. The earlier 404 (D-REV-67) is resolved.
- **Signature:** `11-RELEASE-EVIDENCE.md` § 6 verified the tarball against the compiled pubkey with `minisign-verify =0.2.5`, with a tampered-byte control that fails. I did not re-run that. I did confirm that the pubkey and endpoint are compiled into `tauri.conf.json`.
- **Refusal while runs are live (behavior-dependent).** This verifier ran `cargo test -p desktop update`: 7 passed. They include `a_live_run_refuses_with_its_count_and_nothing_is_fetched`, `a_run_that_starts_during_the_download_still_stops_the_install`, `a_blocked_run_counts_and_the_count_is_named_in_the_plural` and `the_window_capability_grants_no_updater_permission`. `guarded_install` in `update.rs` reads the live count before fetching and again before installing.
- **Wiring:**
  - `update_check` and `update_install` are registered in `main.rs` lines 199-200.
  - They are exposed in the adapter at `tauri.ts` lines 1421 and 1434.
  - `UpdateBanner` is mounted from `App.tsx`.
  - `vitest src/update` plus `project-rail`: 28 passed.
- **End to end:** `11-OWNER-PASS.md` § 2.2 records banner naming 0.1.1, then install-on-relaunch, then relaunch showing `Version 0.1.1 (0.1.1)`. I viewed `11-21-about-after-update.png` and it shows exactly that.

Limits, stated plainly and not softened:

- The end-to-end run was driven by accessibility automation on a `ditto` **copy** of the installed 0.1.0, not in place on `/Applications` and not watched by the owner.
- The live-run count was exercised with database rows, not processes. The Rust refusal on a click was proven by unit test, not by the UI, because the button is disabled.
- Banner dismissal lasts the session only, not a relaunch (D-REV-66). The owner chose to keep it (D-206).
- The endpoint depends on the newest release not being marked Pre-release. `release.yml` sets `prerelease: false`, so future tags keep it working. A manual re-mark would break it again.

### Criterion 3: a developer clones and builds from the documented steps. VERIFIED, caveat open

- `README.md` "Building from source" has five commands, with the `createUpdaterArtifacts:false` override explained. `ci.yml` runs the same commands, in the same order, on a fresh `macos-14` runner.
- That CI **did pass** on `fdb014d` (run 38499371754, all 14 steps green, including the override `tauri build`).
- A real stranger-style HTTPS clone built a bundle (`11-RELEASE-EVIDENCE.md` § 5). The first attempt failed on the signing key, which exposed a README defect. The README was fixed and the corrected command exited 0. The corrected command was **not** run from an empty `target/`. The record says so.
- `main` is now `9fa4543`, and its tree is byte-identical to branch tip `22c9dcc` (`git diff 22c9dcc 9fa4543` is empty). The fixed README (xattr note, override command) is on `origin/main`.
- `LICENSE` (Apache-2.0) and `NOTICE` exist on `main`. `ARCHITECTURE.md` § 8 holds the open-core boundary.

**Open caveat, not assumed green.** The runs on the final tree:

| Run | Commit | Result |
|-----|--------|--------|
| CI, push, 38523516775 | `22c9dcc` (branch tip) | **failure** |
| Open core, push, 38523516821 | `22c9dcc` | **failure** |
| Open core, pull_request, 38523522235 | `22c9dcc` | **failure** |
| CI, pull_request, 38523522245 | `22c9dcc` | in progress |
| CI and Open core, push, 38523539751 and 38523539858 | `9fa4543` (`main`) | **in progress at report time** |

The three failures share one cause. `cargo test --workspace` fails at `packages/core/tests/worktree_lifecycle.rs:100` (`a_worktree_survives_two_runs_with_an_epic`, "failed to write the dirty file: NotFound"). This is the "known flake" the SUMMARYs mention. I ran that test binary five times locally: 5 of 5 passed, so it is not deterministic.

The root cause is visible in the source. `with_scratch_worktree_root` sets and removes the **process-global** env var `FLYWHEEL_WORKTREE_ROOT`. Its SAFETY comment says "tests in this crate run single-threaded per binary". That is false: no `--test-threads=1`, no `RUST_TEST_THREADS`, no serial guard exists in the repo. Two tests in the same binary race on the variable. The flake has now hit at least four times: attempt 1 of Release run 38493244716, and the three failures above. It is mentioned in SUMMARYs as "known" and handled by re-run. It is not on the register and not a tracked defect.

Impact on the criterion: a stranger following the README never runs `cargo test`, so the documented build is unaffected. The claim "CI runs these same commands on every push" and the DIST-04 proof both go through that red-prone step. **The requirement-level statement "CI green on `main`" cannot be made until run 38523539751 and run 38523539858 conclude.** I mark the truth VERIFIED on the strength of the `fdb014d` green run, the stranger clone and the README/CI command match. I keep the REQUIREMENTS checkbox decision with the orchestrator.

### Criterion 4: standalone, no account, no network service, nothing gated. VERIFIED

- `open-core.yml` deletes `packages/relay-client`, strips it from `Cargo.toml` members, greps that no source references it, then runs `cargo build`, `cargo test --workspace`, the sidecar and desktop tests, and the renderer build. This verifier ran the same grep locally: the only non-comment hit outside the crate is the `members` line the job removes.
- The job passed on `fdb014d` (run 38499371752). The cited run `38346860235` (commit `f306e6e`) is also green.
- No workspace dependency on the crate appears in any `Cargo.toml` (`grep relay` finds only the members line).
- A scan for network clients (`reqwest`, `ureq`, `fetch('http…`, `https://`) in `core`, `desktop/src`, `src-tauri/src` and `sidecar` finds exactly one production endpoint: the updater feed in `tauri.conf.json` and `update.rs`. A failed check surfaces as an error and never blocks the app. No login, account or license-key code is present.
- Same caveat as criterion 3: the Open core run on the `22c9dcc` tip failed on the flake above, and the `9fa4543` run is in progress. The tagged commit `3024cc2` (v0.1.1) also has a failed Open core run. I did not diagnose that failure, but it sits in the same `cargo test --workspace` step.

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/ci.yml` | Clean-clone build mirroring README | VERIFIED | Matches README commands and order. |
| `.github/workflows/open-core.yml` | Relay-absent proof | VERIFIED | Structural check fails the build on any reference. |
| `.github/workflows/release.yml` | Tag-driven release, updater json | VERIFIED, unsigned | Builds dmg, tarball, `.sig`, `latest.json`; asserts them after publishing. No Apple signing. |
| `scripts/release/apply-tag-version.mjs` | Tag becomes version | VERIFIED | `node --test`: 4 of 4 pass. |
| `packages/desktop/src-tauri/src/commands/update.rs` | Check, install, live-run refusal | VERIFIED | 7 unit tests pass; registered; no updater permission granted to the window. |
| `packages/desktop/src/update/UpdateBanner.tsx` | Banner | VERIFIED | Mounted in `App.tsx`; tests pass. |
| `LICENSE`, `NOTICE`, `README.md`, `ARCHITECTURE.md` § 8 | OSS identity and build docs | VERIFIED | All on `origin/main`. |
| `scripts/release/verify-gatekeeper.sh` | Gatekeeper proof | MISSING | Never written; plan 11-07 deferred. |
| Apple signing and notarization | DIST-01 criterion 1 | MISSING | See Criterion 1. |

## Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| `UpdateBanner` | `update_check` / `update_install` | WIRED | via `adapters/tauri.ts` 1421 and 1434, handlers in `main.rs` 199-200. |
| `update_install` | live-run count | WIRED | `flywheel_core::dispatch::occupied_slots`, read before fetch and before install. |
| `tauri.conf.json` endpoint | published `latest.json` | WIRED | HTTP 200 serving 0.1.1 at verification time. |
| `open-core.yml` | relay crate absence | WIRED | Deletes the crate; nothing else references it. |
| `release.yml` | Apple signing | NOT_WIRED | Deliberately absent. |

## Requirements Coverage

Every ID from the plan frontmatter is accounted for. There are no orphans: REQUIREMENTS.md maps exactly DIST-01..04 to Phase 11.

| Requirement | Source plans | Status | Evidence |
|-------------|--------------|--------|----------|
| DIST-01 | 11-01, 11-04, 11-07, 11-08, 11-20, 11-21 | **UNMET (BLOCKED)** | Criterion 1 above. REQUIREMENTS.md leaves the box unticked, which is correct. |
| DIST-02 | 11-04, 11-05, 11-06, 11-08, 11-21 | **MET**, with stated limits | Criterion 2 above. |
| DIST-03 | 11-01, 11-02, 11-03, 11-08, 11-21 | **MET on evidence; final-tree CI pending** | Criterion 3 above. |
| DIST-04 | 11-02, 11-03, 11-08 to 11-19, 11-21 | **MET on evidence; final-tree CI pending** | Criterion 4 above. |

## Anti-Patterns and Execution Anomalies Checked

| Item | Finding |
|------|---------|
| `TBD`, `FIXME`, `XXX` in files touched by `(11-*)` commits (126 files) | None. |
| Plan 11-07 claims | Honest: `deferred`, `tasks: 0`, no production file changed. **Stale wording (warning):** its SUMMARY still says a user "must use the right-click-Open workaround". Plan 11-21 reproduced that no such button exists. The correction lives in the register and README, not in that SUMMARY. |
| 11-05 concurrent executors | History is linear: `9b40e87`, `1882b14`, `1d32ce1`, `2950d85`. The updater plugin is pinned `=2.12.0`. The 7 update tests pass. No duplicate artifacts. |
| 11-11 stalled executor | Task 1 (`47e9f68` red, `695f19b` green, `07be615` UI) and Task 2 (`4847a62` red, `fed188c` green) all exist. `dispatch_auto_merge`: 64 passed. `stuck-task.test.tsx`: 5 passed. |
| Register id uniqueness | 67 `- id:` lines, 0 duplicates. D-REV-63 and 64 are present; 61 and 62 appear once each. |
| 11-06 tests after code | Disclosed. The tests pass and the behavior is exercised. The red-first guarantee is weaker than 11-22's. `tdd_mode` is false. |
| Register frontmatter arithmetic | It says "filed-to-board 17". The body has 16 `filed-to-board` and 1 `closed` (D-REV-67). The total of 67 is right, but the `closed` disposition is missing from the frontmatter vocabulary line. Cosmetic. |
| REQUIREMENTS.md staleness | DIST-02 is ticked `[x]`, yet its second bullet still reads "Unticked 2026-10-14 ... endpoint answers 404". The traceability row has the resolution; the bullet is stale. DIST-03's traceability row still says "`main` still has the old README until the branch merges". It has merged. |
| Release vs. drained work | `v0.1.1` is at `3024cc2`. The 21 later commits (project soft-hide and migration 0022, the 11-20 asset scripts, the xattr README) are in no released build. Installed `/Applications/Flywheel.app` is `0.1.0`. A `v0.1.2` would carry them. This is not a criterion failure. |

## Register Redemption (the phase's extra gate)

- `.planning/DEFERRED-REVIEW.md`: `status: redeemed`, 67 items.
- Body statuses (counted from the file): 17 closed-automated, 9 closed-by-decision, 2 accepted-by-design, 16 filed-to-board, 1 closed, **22 owner-question**. The sum is 67.
- The 22 owner-questions are D-REV-05, 07, 08, 09, 10, 21, 23, 24, 33, 34, 35, 36, 47 to 55 and 63. Each carries `owner_answer: Not answered ... not as passed`. This report keeps them open and does not count them as verified.
- Spot-checked D-REV-09, 10, 47: each has a physical or aesthetic reason, and the automatable half was already closed by named tests. That is consistent with the project rule against "hard to automate recorded as needs a human".
- Board filing: `11-21-board-filing.log` ends `DONE epics=3 tasks=48 issues=28 criteria=94`. The register cites `THRE-` ids.
- `11-FINISH-REVIEW.md` discloses that **no finish reviewer returned `ship`**: nine runs, nine `fix`, 58 material fixes. The fixed groups were not re-reviewed. That is an honest record, not a pass.
- `deferred-items.md` records `it.fails` expectations (approve-error visibility, fleet selection loss, session "Starting session..." text). These are tracked known defects, consistent with the "2 expected fail" in the orchestrator's counts.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Update refusal, live-run race, capability denial | `cargo test -p desktop update` | 7 passed | PASS |
| Banner and project rail | `vitest run src/update src/projects/__tests__/project-rail.test.tsx` | 28 passed | PASS |
| Stuck-task retry/skip UI | `vitest run stuck-task.test.tsx` | 5 passed | PASS |
| Scope-breach and auto-merge guards (D-REV-41/42) | `cargo test -p core --test dispatch_auto_merge` | 64 passed | PASS |
| Project soft-hide (D-200) | `cargo test -p core --test project_hide` | 10 passed | PASS |
| Tag-version stamping | `node --test scripts/release/apply-tag-version.test.mjs` | 4 passed | PASS |
| `worktree_lifecycle`, five repeat runs | `cargo test -p core --test worktree_lifecycle` | 5 of 5 pass locally; red on CI | FLAKY |
| Updater endpoint live | `curl -sIL …/latest/download/latest.json` | HTTP 200 | PASS |

The orchestrator's full-suite figures (106 binaries, 1393 tests, desktop jsdom 1484 passed, browser 129 passed, `tsc` clean) are taken as stated. I did not re-run the full suites. `credentials.rs` is excluded because it writes to the real Keychain.

## Human Verification

None opened, per the standing policy. The items that would have read `human_needed` are the 22 `owner-question` register entries plus the owner's own in-place observation of the update. They sit in `.planning/DEFERRED-REVIEW.md` and on the board as unanswered. They are neither passed nor verified here.

## Gaps Summary

**One BLOCKER, owner-decided:** DIST-01 criterion 1. The build is not Apple-signed or notarized, so a stranger meets a "damaged" dialog with no Open button and must run `xattr -cr`. It closes only with an Apple Developer purchase and plan 11-07's work. It is not deferred to a later phase, and no override is proposed.

**Warnings, none blocking the verdict:**

1. The CI runs on the final tree (`9fa4543`) were not concluded at report time. The branch-tip runs failed on a **real test-isolation race**: parallel tests share the process-global `FLYWHEEL_WORKTREE_ROOT`, and the SAFETY comment's premise is false. It is untracked and handled by re-run. Fix: serialise those tests or pass the root per call. Until the `9fa4543` runs go green, do not tick DIST-03 or DIST-04 on a "CI green on main" basis. Re-run the failed jobs or fix the race first.
2. REQUIREMENTS.md carries two stale statements (the DIST-02 "Unticked" bullet and the DIST-03 traceability text). The 11-07 SUMMARY carries a stale right-click-Open claim. The register frontmatter omits the `closed` disposition.
3. `v0.1.1` predates 21 commits of drained work. Cut a release before calling the drained fixes "installed".
4. The update flow was observed by automation on a copy, not in place and not by the owner.

---

_Verified: 2026-10-14T06:53:42Z_
_Verifier: Claude (gsd-verifier)_

---

## Owner decision on closure (2026-10-14)

This report returned `gaps_found` at 3/4. **The owner closed the phase on 3/4 with DIST-01
criterion 1 recorded as unmet.** That is a decision, not a reclassification: nothing below is
rewritten, and the criterion is not marked passed anywhere.

**Why closing is the honest outcome here.** The gap is not undone work. DIST-01 criterion 1
requires a Developer ID Application certificate and notarization, which require an Apple Developer
Program membership ($99/yr). The owner was asked on 2026-10-13, with the cost stated, and declined;
plan 11-07 is recorded `deferred` with zero tasks executed and no production file changed
(D-REV-60). On 2026-10-14 the consequence turned out to be worse than the register had assumed -
an ad-hoc, linker-signed bundle with no sealed resources produces macOS's "damaged and can't be
opened" dialog with no Open button, not the softer "unidentified developer" prompt that the
right-click-Open workaround addresses (D-REV-62). The owner was told, and chose to mark `v0.1.0`
Pre-release and document `xattr -cr` rather than buy the account now.

A `/gsd-plan-phase 11 --gaps` cycle would therefore produce a plan whose only task is the Apple
enrolment - which is plan 11-07, already written and already deferred. Running it would add
ceremony, not progress.

**What closing does NOT mean:**
- DIST-01 stays `[ ]` in REQUIREMENTS.md and unmet in the traceability table.
- The 22 `owner-question` items in the register stay open and unanswered, including SC0.
- D-REV-68 (the `worktree_lifecycle` race, misdiagnosed as a flake for the whole phase) stays open.
- CI on the final tree (`9fa4543`) had not concluded when this was written.
- Plan 11-07 remains ready to run unchanged the moment an Apple account exists.

## Code review gate (2026-10-14)

The `code-review` capability hook is active and advisory (`onError: skip`). **The owner chose to
skip it**, on the grounds that this phase already carries unusually strong coverage: 106 core test
binaries and 1393 tests with zero failures, the full desktop jsdom and browser suites, nine
`impeccable-finish-reviewer` runs producing 58 findings with a disposition on each, and this
adversarial verification pass. Recorded as deliberately skipped, not silently dropped.
