---
phase: 11-ship-it
verified: 2026-10-14T07:12:28Z
status: deferred
score: 3/3 re-scoped success criteria verified (DIST-01 descoped by owner decision, UNMET, not counted)
covered_files:
  - ".github/workflows/ci.yml"
  - ".github/workflows/open-core.yml"
  - ".github/workflows/release.yml"
  - ".planning/DEFERRED-REVIEW.md"
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - "ARCHITECTURE.md"
  - "LICENSE"
  - "README.md"
  - "packages/core/tests/worktree_lifecycle.rs"
  - "packages/desktop/src-tauri/src/commands/update.rs"
  - "packages/desktop/src-tauri/tauri.conf.json"
  - "packages/desktop/src/update/UpdateBanner.tsx"
covered_digest: "v1:sha256:4c88739ac402949dfc3f9f24abf0bc7297fc558901596949ea453d67b80ebd8b"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  reason: "Owner descoped DIST-01 on 2026-10-14; CI concluded green on main 9fa4543"
  gaps_closed: []
  gaps_remaining: []
  descoped: ["DIST-01 criterion 1 (unmet, not achieved, no later phase covers it)"]
  regressions: []
gaps: []
descoped:
  # The first-pass gap, preserved verbatim. It is NOT closed. It is out of scope by owner decision.
  - truth: "User installs a signed, notarized macOS build and opens it with no Gatekeeper warning. (ROADMAP SC 1 / DIST-01)"
    status: unmet-descoped
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
deferred: []   # DIST-01 has no later phase or milestone entry, so the Step 9b test is not met
advisory:
  - finding: "Phase Goal sentence ('installs like any other Mac application'), ROADMAP overview line 15 ('signed'), the [x] on plan 11-07 and '22/22 executed' were not amended after the descope"
    category: other
    reason: "Documents still imply the signing plan ran or the install is Mac-native. See the re-verification section."
    evidence_status: "file lines cited in the report"
  - finding: "D-REV-68 states the race as settled; its own reproduction recipe (--test-threads=8) did not fail in 8 of 8 runs here; three of the seven plans it names carry no flake mention"
    category: other
    reason: "Diagnosis is supported by source, not reproduced. Edit the entry to say so."
    evidence_status: "8 runs at 8 threads and 3 at 1 thread all green"
coincidental_reliance_items: []
---

# Phase 11: Ship It Verification Report

**Phase Goal:** Cyril installs Flywheel like any other Mac application and it keeps itself current, and another developer can clone the repository and build it.
**Verified:** 2026-10-14T07:12:28Z (re-verification); first pass 2026-10-14T06:53:42Z
**Status:** deferred (re-verified 2026-10-14T07:12:28Z against the new three-criterion scope; first pass was `gaps_found` 3/4)
**Re-verification:** Yes, after an owner-approved descope of DIST-01 and CI concluding green on `main`

## Re-verification 2026-10-14T07:12:28Z: NEW SCOPE (DIST-02, DIST-03, DIST-04)

**Result: 3 of 3 re-scoped success criteria verified. Status `deferred`, not `passed`.**
**DIST-01 is UNMET and DESCOPED. It was not achieved, and nothing below says it was.**

Everything under "First-pass report" further down is kept as written. Where this section corrects
the first pass, it says so.

### Why `deferred` and not `passed`

Project policy (`.claude/CLAUDE.md`, "Human verification is deferred until MVP"): a report that would
read `human_needed` reads `deferred`. This one would read `human_needed`, because:

- 22 register entries are `owner-question`, unanswered. I counted `status: owner-question` in
  `.planning/DEFERRED-REVIEW.md`: **22**. The set includes D-REV-24 (SC0, whether the built board
  reads as "bold and modern"). Its `owner_answer` is "Not answered ... not as passed". They stay open.
- DIST-02's update was observed by accessibility automation on a copy, not in place and not by the owner.
- D-REV-68 is `status: open`.

Phase 09's report uses the same `deferred` status, so this follows precedent.

### Is the descope honest? My judgement: yes as a scoping call, with residual overstatements

I am not blessing it blindly. I checked each claim in the brief against the files.

**What holds (verified in the tree):**

| Claim | Check | Result |
|---|---|---|
| DIST-01 stays unticked | `REQUIREMENTS.md:139` reads `- [ ] **DIST-01**` | TRUE |
| Traceability says "NOT met and not reclassified" | `REQUIREMENTS.md:318` | TRUE, and it keeps the cost, the D-REV-60 and D-REV-62 references and the `xattr -cr` mitigation |
| ROADMAP SC 1 struck through with a deferral note | `ROADMAP.md:1204-1213`, `~~...~~`, "NOT met and is NOT reclassified as met" | TRUE |
| ROADMAP requirement line is `DIST-02, DIST-03, DIST-04` | `ROADMAP.md:1201` | TRUE |
| Plan 11-07 is still `deferred`, 0 tasks, no production file changed | `11-07-SUMMARY.md` frontmatter `status: deferred`, `tasks: 0`; `git diff 9fa4543 HEAD --name-only` outside `.planning/` is empty | TRUE |
| The 11-07 right-click-Open claim is corrected | SUMMARY now says "CORRECTED 2026-10-14 ... There is no Open button" | TRUE |
| No signing config was slipped in | `release.yml` has no `APPLE_*` group; `verify-gatekeeper.sh` still absent | TRUE |

The criterion was moved out of scope. It was not rewritten until it passed. The failing evidence is
still on the record. That is a legitimate owner scoping decision: the blocker is a $99/yr purchase the
owner declined, and the phase cannot code its way past it.

**What is still dishonest or stale. These are WARNINGS the orchestrator should fix before calling the phase done:**

1. **The Phase Goal sentence was not amended.** `ROADMAP.md:1198` still says "Cyril installs Flywheel
   like any other Mac application". That is not true today: a first-time user meets "damaged and can't
   be opened" with no Open button and must run `xattr -cr`. Three criteria were kept, but the goal
   their removed sibling embodied was left standing. **The honest reading is that this phase delivers
   its three retained criteria and does NOT deliver its headline install experience.** Amend the goal,
   or say that in the roadmap entry.
2. **`ROADMAP.md:15`** still says "Phase 11 ships a signed, self-updating macOS build". It is not signed.
3. **`ROADMAP.md:1250` ticks `- [x] 11-07-PLAN.md - Signed and notarized` and line 1218 says
   "22/22 plans executed".** Plan 11-07 executed **zero** tasks. A reader of the roadmap would conclude
   the signing plan ran. The progress table (line 1337) also reads `22/22`. Show 11-07 as deferred.
4. **DIST-01 has no destination.** Both documents say "a later milestone", but no later milestone or
   phase exists in ROADMAP.md, and DIST-01 is not in REQUIREMENTS.md's v2 section. It still sits in
   the v1 list, unticked. So the Step 9b "deferred to a later phase" test is NOT satisfied (I list it
   under `descoped`, not `deferred`). Until it has a named home, "deferred" can quietly become "dropped".
5. **`REQUIREMENTS.md` coverage block is now false.** Lines 326-327 say "Mapped to phases: 93 ✓",
   "Unmapped: 0". DIST-01 is mapped to no phase any more. `ROADMAP.md` "Requirement Coverage" says
   the same ("All 93 v1 requirements map to exactly one phase").
6. **`STATE.md:742`** still says "Phase 11 has a hard prerequisite ... an Apple Developer account".

### Observable truths, re-scoped

| # | Truth | Status | Evidence (this pass) |
|---|-------|--------|----------------------|
| 1 | ~~Signed, notarized build opens with no Gatekeeper warning~~ (DIST-01) | **DESCOPED, UNMET** | Owner decision 2026-10-14. Not counted in the score, not counted as verified. First-pass evidence below is unchanged. |
| 2 | User is offered a new release in the app and updates without a manual reinstall (DIST-02) | VERIFIED, limits stated | Re-run today, see below |
| 3 | A developer clones the repository and builds a working desktop app from the documented steps (DIST-03) | VERIFIED | CI green on `main`, see below |
| 4 | The installed open-source app is fully functional standalone (DIST-04) | VERIFIED | Open core green on `main`, see below |

**Score: 3/3 re-scoped criteria verified. 0 present-but-behavior-unverified. DIST-01 excluded by owner decision, unmet.**

### New evidence, checked by this verifier

**CI has concluded green on `main`.** `gh run view` for both runs reports `headSha`
`9fa45439845f0a2b649167d43c64cafa97d3ab3c`, which equals `origin/main`, `status: completed`,
`conclusion: success`:

- CI, push, 38523539751: all steps success, including `cargo test --workspace` and
  `npm --prefix packages/desktop run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'`.
- Open core, push, 38523539858 (job `relay-absent`): "Delete the relay seam", "Remove it from the
  workspace members", "No source outside the crate references it", then `cargo build --workspace`,
  `cargo test --workspace`, sidecar tests, desktop tests and the renderer build, all success.

This **closes the first pass's main caveat for DIST-03 and DIST-04.** The README's five commands
(read from `origin/main`) match the `run:` lines of `ci.yml` command for command. `git diff 9fa4543 HEAD`
shows no change outside `.planning/`, so the tree that was built is the tree that is verified.

One honest limit. This is **one green sample of a suite with a known race (D-REV-68 below)**. The same
tree could go red on a re-run. The criterion (a stranger can build) does not depend on `cargo test`,
because the README never asks for it. But "CI is green" is a fact about that run, not a standing guarantee.

**DIST-02, re-checked rather than carried over:**

- `curl -sIL .../releases/latest/download/latest.json`: 302 to `v0.1.1/latest.json`, then **HTTP 200**.
  Manifest `version: 0.1.1`, platforms `darwin-aarch64` and `darwin-aarch64-app`, both signatures non-empty.
- `gh release list`: `v0.1.1` Latest, `v0.1.0` Pre-release. The endpoint depends on that. Re-marking
  `v0.1.1` Pre-release would bring the 404 back.
- `cargo test -p desktop update`: 7 passed. **Correction to the first pass:** that count includes one
  test that only matches the substring "update" (`build_preview_dto_performs_no_insert_update_or_delete`).
  There are **6** tests in `commands::update`. They cover refusal with live runs, a run that starts
  during the download, the plural count, a clean install, the compiled one-endpoint config, and the
  window capability granting no updater permission. All pass.
- Limits are as the first pass stated: the end-to-end update was automation on a copy, not the owner,
  not in place.

**DIST-04, re-checked:** the Open core run above is the evidence. Its structural gate fails the build if
anything outside the crate references `relay-client`. The first pass's network-client scan stands.

### D-REV-68: exists, and mostly honest. Two overstatements

Entry present at `.planning/DEFERRED-REVIEW.md:1652`, `status: open`. It names the false SAFETY comment
at line 18, says nothing enforces single-threaded execution, lists remedies, and says plainly that the
phase misdiagnosed the race as a flake. I confirmed from the source:

- The SAFETY comment is at `worktree_lifecycle.rs:18-19` and is false.
- `grep` for `serial_test`, `test-threads` and `RUST_TEST_THREADS` in the Cargo manifests, `.cargo/`
  and `.github/` finds nothing.
- Two `#[test]` functions in the binary both call `with_scratch_worktree_root`, which sets and removes
  a process-global variable. `git.rs:28` reads it. The failure signature (`NotFound` on a write into a
  worktree path) fits one test's tempdir being dropped while its sibling still uses it.

**Overstatement 1: the entry's own reproduction recipe did not reproduce it.** It says running with
`--test-threads=8` "should fail today". I ran that binary **8 times at `--test-threads=8`: 8 of 8
passed** (0.45 s each), and 3 of 3 passed at `--test-threads=1`. With the 5 of 5 from the first pass,
that is 16 green local runs. The data race is real in the source. That it is *the* cause of the CI
failures is a strong inference that I have not reproduced. The entry states it as settled. It should say
"not reproduced locally".

**Overstatement 2: the list of plans that recorded it as a flake is too long.** The entry names 11-04,
05, 08, 10, 16, 19 and 20. I found the flake language in 11-04, 11-05, 11-08 and 11-10 only. 11-16,
11-19 and 11-20 contain no mention in their SUMMARY or PLAN files. The pattern is still real, and 11-05
shows it hitting `forge_degrade` and `worktree_lifecycle` as well as `authoring_lifecycle`, but three
named plans are not supported.

### The "five stale documents": four fixed, one half-fixed

| Document | State |
|---|---|
| REQUIREMENTS DIST-02 "Unticked ... 404" bullet | FIXED. Now "Resolved 2026-10-14", HTTP 200 verified (matches my curl). |
| REQUIREMENTS DIST-03 traceability row ("main still has the old README") | FIXED in the row. |
| **REQUIREMENTS DIST-03 bullet (line 145) and checkbox (line 144)** | **STALE.** Still reads "Left unticked ... `main` still carries the old, broken README and a red CI". `main` has the fixed README and green CI. The checkbox is `[ ]` while the traceability row says "Met on evidence". The file contradicts itself. The row also still says CI "had NOT concluded", which is now false. The evidence now supports ticking DIST-03, but that edit is the orchestrator's. |
| 11-07-SUMMARY right-click-Open claim | FIXED. |
| Register frontmatter dispositions | FIXED. `17+9+2+22+16+1+1 = 68` matches the body: 68 `- id:` lines, 0 duplicates, statuses 17/9/2/22/16/1 closed/1 open. |

DIST-04's row still cites run 38346860235 only. It could cite 38523539858 on `main`.

### DIST-01 record (unchanged, restated)

DIST-01 criterion 1 is **UNMET**. The bundle is ad-hoc signed (`Signature=adhoc`, `TeamIdentifier=not
set`), is not notarized, and macOS reports it damaged with no Open button. `xattr -cr` is a workaround,
not a signed build. No file in the tree makes it otherwise. The owner descoped it on 2026-10-14. That
changes what this phase is *required* to deliver. It does not change what the phase *delivered*.

### Open items that remain open

- 22 `owner-question` register entries (D-REV-05, 07, 08, 09, 10, 21, 23, 24, 33, 34, 35, 36, 47 to 55,
  63). Not passed, not verified.
- D-REV-68, race unfixed and unreproduced locally.
- DIST-01, unmet, no named destination.
- Stale roadmap and requirements text listed above.
- Update flow never observed by the owner or in place.
- The 21 drained commits after `v0.1.1` are in no released build.

### Actions for the orchestrator

1. Amend the Phase 11 Goal sentence and `ROADMAP.md:15`, and show 11-07 as deferred (line 1250) so "22/22 executed" is not read as the signing plan having run.
2. Give DIST-01 a named home (a v2 entry or a named future milestone), and correct the "Unmapped: 0" block.
3. Fix `REQUIREMENTS.md` DIST-03: tick it or say why not, and drop the stale bullet text and the "had NOT concluded" phrase.
4. Edit D-REV-68 to say "not reproduced locally in 16 runs" and trim the plan list to 11-04, 05, 08, 10.
5. Then mark Phase 11 closed. No gap-closure plan is needed.

---

# First-pass report (2026-10-14T06:53:42Z), preserved as written

*Superseded where this section above says so. Criterion 1 below was scored FAILED and a 3/4 score was
given. That framing is replaced by the re-scoped result above. The evidence is not retracted.*

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
