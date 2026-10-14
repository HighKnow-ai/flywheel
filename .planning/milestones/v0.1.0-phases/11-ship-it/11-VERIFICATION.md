---
phase: 11-ship-it
verified: 2026-10-14T07:21:03Z
status: deferred
score: 3/3 re-scoped success criteria verified (DIST-01 deferred out of the milestone by owner decision, UNMET, not counted)
covered_files:
  - ".github/workflows/ci.yml"
  - ".github/workflows/open-core.yml"
  - ".github/workflows/release.yml"
  - ".planning/DEFERRED-REVIEW.md"
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/STATE.md"
  - ".planning/phases/11-ship-it/11-01-PLAN.md"
  - ".planning/phases/11-ship-it/11-01-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-02-PLAN.md"
  - ".planning/phases/11-ship-it/11-02-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-03-PLAN.md"
  - ".planning/phases/11-ship-it/11-03-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-04-PLAN.md"
  - ".planning/phases/11-ship-it/11-04-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-05-PLAN.md"
  - ".planning/phases/11-ship-it/11-05-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-06-PLAN.md"
  - ".planning/phases/11-ship-it/11-06-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-07-PLAN.md"
  - ".planning/phases/11-ship-it/11-07-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-08-PLAN.md"
  - ".planning/phases/11-ship-it/11-08-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-09-PLAN.md"
  - ".planning/phases/11-ship-it/11-09-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-10-PLAN.md"
  - ".planning/phases/11-ship-it/11-10-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-11-PLAN.md"
  - ".planning/phases/11-ship-it/11-11-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-12-PLAN.md"
  - ".planning/phases/11-ship-it/11-12-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-13-PLAN.md"
  - ".planning/phases/11-ship-it/11-13-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-14-PLAN.md"
  - ".planning/phases/11-ship-it/11-14-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-15-PLAN.md"
  - ".planning/phases/11-ship-it/11-15-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-16-PLAN.md"
  - ".planning/phases/11-ship-it/11-16-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-17-PLAN.md"
  - ".planning/phases/11-ship-it/11-17-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-18-PLAN.md"
  - ".planning/phases/11-ship-it/11-18-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-19-PLAN.md"
  - ".planning/phases/11-ship-it/11-19-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-20-PLAN.md"
  - ".planning/phases/11-ship-it/11-20-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-21-PLAN.md"
  - ".planning/phases/11-ship-it/11-21-SUMMARY.md"
  - ".planning/phases/11-ship-it/11-22-PLAN.md"
  - ".planning/phases/11-ship-it/11-22-SUMMARY.md"
  - "ARCHITECTURE.md"
  - "Cargo.toml"
  - "LICENSE"
  - "NOTICE"
  - "README.md"
  - "packages/core/src/git.rs"
  - "packages/core/tests/worktree_lifecycle.rs"
  - "packages/desktop/src-tauri/src/commands/update.rs"
  - "packages/desktop/src-tauri/tauri.conf.json"
  - "packages/desktop/src/update/UpdateBanner.tsx"
  - "scripts/release/apply-tag-version.mjs"
  - "scripts/release/apply-tag-version.test.mjs"
covered_digest: "v1:sha256:97a634d2da3b6bf03ca8a7362c23dd677f189cd5a0704c61450ff12c84876f90"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: deferred
  previous_score: 3/3
  reason: "Third pass. Confirms the second-pass verdict and re-checks each of the orchestrator's seven claimed follow-ups against the files. Five hold fully, two hold only in part (see 'Follow-ups: what holds')."
  gaps_closed: []
  gaps_remaining: []
  descoped: ["DIST-01 criterion 1 (unmet, deferred out of this milestone, no phase or milestone entry exists for it)"]
  regressions: []
gaps: []
descoped:
  # Preserved from the first pass. It is NOT closed. It is out of scope by owner decision.
  - truth: "User installs a signed, notarized macOS build and opens it with no Gatekeeper warning. (ROADMAP SC 1 / DIST-01)"
    status: unmet-descoped
    reason: "The build is ad-hoc signed only and is not notarized. Owner declined the $99/yr Apple Developer purchase on 2026-10-13 (D-REV-60); plan 11-07 is `deferred` with zero tasks executed. A quarantined copy shows 'damaged and can't be opened' with only Move to Trash and Cancel. The only way in is the `xattr -cr` workaround."
    artifacts:
      - path: "/Applications/Flywheel.app"
        issue: "Re-run 2026-10-14: `codesign -dv` gives Signature=adhoc, TeamIdentifier=not set."
      - path: ".github/workflows/release.yml"
        issue: "No APPLE_* env group (grep finds none)."
      - path: "scripts/release/verify-gatekeeper.sh"
        issue: "Never written (plan 11-07 deferred). scripts/release holds only apply-tag-version.mjs, its test, ax-drive.js, verify-appearance.mjs and verify-bundle-assets.sh."
    missing:
      - "Apple Developer ID Application certificate, notarization and stapling in release.yml (plan 11-07 Tasks 1-3)"
      - "A Gatekeeper verification run against the downloaded release artifact"
deferred: []   # DIST-01 has no later phase or milestone entry, so the Step 9b test is not met. It is `descoped`, not `deferred`, in the verifier's sense.
advisory:
  - finding: "ROADMAP.md:70 (the phase checklist) still reads 'Install Flywheel like any Mac app'. The Phase 11 Goal at line 1198 was amended; this line was not."
    category: other
    reason: "Same overstatement the second pass flagged, surviving in one place. Not a success criterion."
    evidence_status: "line cited"
  - finding: "ROADMAP.md:1337 progress table reads '22/22 | In Progress'; ROADMAP.md:1286 reads 'All 93 v1 requirements map to exactly one phase. No orphans'"
    category: other
    reason: "Plan 11-07 executed 0 tasks, and DIST-01 maps to no phase. The Plans line at 1218 was fixed; these two were not."
    evidence_status: "lines cited"
  - finding: "REQUIREMENTS.md:320 (DIST-03 traceability row) still says 'CI on the final tree had NOT concluded at verification time, and the repeated worktree_lifecycle failure is a real race, not a flake', while the box on line 144 is [x] and the bullet below it cites concluded green runs"
    category: other
    reason: "The file contradicts itself. The bullet was rewritten; the row was not."
    evidence_status: "lines cited"
  - finding: "REQUIREMENTS.md:325-327 coverage arithmetic: 'v1 requirements: 93 total / Mapped to phases: 93 / Unmapped: 1'. 93 + 1 is 94."
    category: other
    reason: "There are 93 requirement IDs (counted). The 'By Phase' table sums to 92 (15+15+8+9+5+7+10+5+8+7+3). Mapped should read 92."
    evidence_status: "counts shown in 'Documentation residue'"
  - finding: "DEFERRED-REVIEW.md frontmatter says `items: 67`; the body has 68 `- id:` lines and the dispositions line sums to 68"
    category: other
    reason: "Cosmetic frontmatter drift left by adding D-REV-68."
    evidence_status: "grep count 68, 0 duplicate ids"
  - finding: "D-REV-68 body: one sentence ('standing remedy was to re-run the job') appears twice in `why_deferred`, and the diagnosis paragraph still says 'passes locally (5 of 5 observed)' while the automatable block says 11 of 11"
    category: other
    reason: "Leftovers from the two corrections. Cosmetic; the entry is otherwise honest and says NOT REPRODUCED LOCALLY."
    evidence_status: "text read"
coincidental_reliance_items: []
---

# Phase 11: Ship It Verification Report

**Phase Goal (as amended 2026-10-14):** Cyril installs Flywheel from a GitHub release and it keeps itself current, and another developer can clone the repository and build it. The original wording, "installs like any other Mac application", is recorded in ROADMAP as NOT delivered.
**Verified:** 2026-10-14T07:21:03Z
**Status:** deferred
**Re-verification:** Yes. Third pass; initial pass was `gaps_found` 3/4, second pass `deferred` 3/3.

## Verdict

**3 of 3 re-scoped success criteria verified. Status `deferred`, not `passed`. DIST-01 is UNMET.**

This pass revises nothing about the verdict. It does change what is said about the documents: the
orchestrator's list of seven completed follow-ups is accurate on five items and incomplete on two
(and leaves five smaller residues). Those are warnings, not gaps. No success criterion depends on
them.

I started from the hypothesis that the phase had not delivered. For each re-scoped criterion I
re-ran the evidence instead of reading it from the earlier report. It held.

### Why `deferred` and not `passed`

Project policy (`.claude/CLAUDE.md`, "Human verification is deferred until MVP"): a report that would
read `human_needed` reads `deferred`. This one would, because:

- **22 register entries are `owner-question`** and unanswered (I counted `status: owner-question` in
  `.planning/DEFERRED-REVIEW.md`: 22). They include D-REV-24 (SC0, whether the built board reads as
  "bold and modern"). They stay open. None is recorded here as verified.
- DIST-02's update was observed by accessibility automation on a copy of the installed build, not in
  place on `/Applications` and not by the owner.
- D-REV-68 is `status: open`.

No UAT round is opened, per policy.

## Observable truths

| # | Truth | Status | Evidence (this pass) |
|---|-------|--------|----------------------|
| 1 | ~~Signed, notarized build opens with no Gatekeeper warning~~ (DIST-01) | **UNMET, deferred out of the milestone** | Not counted in the score. `codesign -dv /Applications/Flywheel.app`: `Signature=adhoc`, `TeamIdentifier=not set`. No `APPLE_*` in `release.yml`. `verify-gatekeeper.sh` absent. Nothing in the tree contradicts the earlier failing evidence. |
| 2 | User is offered a new release in the app and updates without a manual reinstall (DIST-02) | VERIFIED, limits stated | See Criterion 2. |
| 3 | A developer clones the repository and builds a working desktop app from the documented steps (DIST-03) | VERIFIED | See Criterion 3. |
| 4 | The installed open-source app is fully functional standalone (DIST-04) | VERIFIED | See Criterion 4. |

**Score: 3/3 re-scoped criteria. 0 present-but-behavior-unverified. DIST-01 excluded by owner decision, unmet.**

### Criterion 2: update offered and applied without a manual reinstall (DIST-02)

Checked today:

- `curl -sIL .../releases/latest/download/latest.json`: 302 to `releases/download/v0.1.1/latest.json`, then **HTTP 200**.
- `gh release list`: `v0.1.1` is Latest, `v0.1.0` is Pre-release. The endpoint depends on that. Re-marking
  `v0.1.1` Pre-release would bring the 404 back. `release.yml:94` sets `prerelease: false`, so future
  tags keep it working.
- `cargo test -p desktop update`: **7 passed**. One of them (`build_preview_dto_performs_no_insert_update_or_delete`)
  only matches the substring "update". The six in `commands::update` cover: refusal with a live run and
  nothing fetched, a run that starts during the download still stopping the install, the plural count,
  a clean download-and-install, the compiled one-endpoint config, and the window capability granting no
  updater permission. This is the behavior-dependent part of the truth (refusal and race), and it has
  named passing tests, so it is VERIFIED rather than presence-only.
- `vitest run src/update`: 11 passed.

Carried from earlier passes, not re-run: the minisign verification of the tarball against the compiled
public key, with a tampered-byte control (`11-RELEASE-EVIDENCE.md` § 6), and the end-to-end update
(`11-OWNER-PASS.md` § 2.2: banner named 0.1.1 on an installed 0.1.0, install-on-relaunch, relaunch read
`Version 0.1.1`).

**Limits, stated plainly:** the end-to-end run was driven by accessibility automation on a `ditto` copy,
not in place and not watched by the owner. The live-run count was exercised with database rows, not
processes. Banner dismissal lasts the session only (D-REV-66, kept by D-206). The 21 drained commits
after `v0.1.1` are in no released build; installed `/Applications/Flywheel.app` is 0.1.0.

### Criterion 3: clone and build from the documented steps (DIST-03)

- `gh run list --branch main`: CI run **38523539751** and Open core run **38523539858** are both
  `completed` / `success` at `headSha` `9fa4543`, which equals `origin/main`.
- `git diff 9fa4543 HEAD --name-only` outside `.planning/` is **empty**; the six changed files are all
  planning documents. The tree that was built is the tree verified.
- The README's five build commands (read from the working tree) are `npm --prefix packages/sidecar ci`,
  `npm --prefix packages/desktop ci`, `npm --prefix packages/sidecar run build:dist`, `cargo build --workspace`,
  and the `tauri build` with the `createUpdaterArtifacts:false` override. Every one appears as a `run:`
  line in `ci.yml`, in the same order.
- A real HTTPS clone built a bundle (`11-RELEASE-EVIDENCE.md` § 5) after a README fix. That record says
  the corrected command was not run from an empty `target/`; CI's fresh runner covers that.
- `LICENSE` and `NOTICE` exist. `ARCHITECTURE.md` holds the open-core boundary.

**Honest limit:** this is one green sample of a suite with a known race (D-REV-68). The criterion does
not depend on `cargo test`, because the README never asks a stranger to run it. "CI is green on main" is
a fact about that run, not a standing guarantee.

### Criterion 4: standalone, no account, no network service (DIST-04)

- `open-core.yml` run 38523539858 on `main` is success. It deletes `packages/relay-client`, strips it from
  the workspace members, fails the build on any reference, then builds and tests everything.
- I ran the reference scan locally: across `Cargo.toml`, `*.rs`, `*.ts`, `*.tsx`, `*.json` outside the
  crate and `.planning`, the only hit is `Cargo.toml:5`, the `members` line the job removes.
- Earlier passes scanned for network clients and found one production endpoint, the updater feed. A failed
  check surfaces as an error and never blocks the app. No login, account or license-key code is present.
  Not re-run in full this pass.

## Follow-ups: what holds, and what does not

The orchestrator listed seven follow-ups as done. I checked each against the file.

| # | Claim | Result |
|---|-------|--------|
| 1 | Goal amended; `ROADMAP.md:15` says UNSIGNED | **HOLDS** for line 1198 (goal, with an explicit amendment note) and line 15 ("ships an UNSIGNED, self-updating macOS build"). **PARTIAL:** `ROADMAP.md:70` still reads "Install Flywheel like any Mac app". |
| 2 | 11-07 shown `[~]` "DEFERRED, 0 tasks executed"; plan count "21/22 ... (22/22 have SUMMARYs)" | **HOLDS** at lines 1218 and 1250. **PARTIAL:** the progress table at `ROADMAP.md:1337` still reads `22/22 | In Progress`. |
| 3 | Coverage reads "Unmapped: 1 — DIST-01"; DIST-01 still `[ ]` | **HOLDS**: `REQUIREMENTS.md:139` is `- [ ]`, line 327 names the deferral, line 318 says "NOT met and not reclassified". **PARTIAL:** the arithmetic beside it is wrong (93 mapped + 1 unmapped), and `ROADMAP.md:1286` still says all 93 map to exactly one phase. |
| 4 | DIST-03 ticked `[x]` with concluded CI evidence; stale bullet rewritten | **HOLDS** for the box and bullet (lines 144-145). **NOT FIXED:** the traceability row at line 320 still says CI "had NOT concluded" and calls the failure "a real race". The evidence supports the tick; the row contradicts it. |
| 5 | `STATE.md` Apple prerequisite reads "HAD ... resolved by deferring it, not by meeting it" | **HOLDS** (`STATE.md:742`). `ROADMAP.md` Notes still say the account is "a real prerequisite to budget before this phase"; that is historical planning text, not a claim about the outcome. |
| 6 | D-REV-68 corrected on both counts | **HOLDS.** Plan list is 11-04, 11-05, 11-08, 11-10. The false "should fail today" claim is replaced by "NOT REPRODUCED LOCALLY ... passed 11 of 11". Cosmetic residue: a duplicated sentence and one stale "5 of 5". |
| 7 | Owner-decision and follow-ups sections preserved in this report | **HOLDS**, see the two sections below. |

Net: items 1, 2, 3 and 4 each leave one residue in a document the orchestrator did not touch. They are
the same class of overstatement the second pass found, now confined to four lines.

### Documentation residue (all WARNING, none blocks a criterion)

1. `ROADMAP.md:70` "Install Flywheel like any Mac app" (the phase checklist entry).
2. `ROADMAP.md:1337` progress table `22/22`.
3. `ROADMAP.md:1286` "All 93 v1 requirements map to exactly one phase".
4. `REQUIREMENTS.md:320` DIST-03 row: "CI ... had NOT concluded". Also line 321, the DIST-04 row, cites only the
   older run 38346860235; run 38523539858 on `main` is stronger evidence.
5. `REQUIREMENTS.md:325-327` "Mapped to phases: 93" should be 92 (counted: 93 IDs; the By Phase table sums to 92).
6. `DEFERRED-REVIEW.md` frontmatter `items: 67`; the file has 68.
7. D-REV-68's duplicated sentence and stale "5 of 5".

**These files are in `covered_files`.** Editing any of them changes `covered_digest` and returns the report to
`stale`. Fix them first, then regenerate the fingerprint (command in the closing note), or accept the warnings
and leave them. Do not hand-edit `covered_digest`.

## Register and ground truth

- `.planning/DEFERRED-REVIEW.md`: `status: redeemed`; **68** `- id:` lines, **0 duplicates**. Body statuses:
  17 closed-automated, 9 closed-by-decision, 2 accepted-by-design, **22 owner-question**, 16 filed-to-board,
  1 closed (D-REV-67), 1 open (D-REV-68). 17+9+2+22+16+1+1 = 68.
- The 22 owner-questions are D-REV-05, 07, 08, 09, 10, 21, 23, 24, 33, 34, 35, 36, 47 to 55 and 63. Each stays
  open, not passed.
- **D-REV-68 is accurate on substance.** I re-read the source: `worktree_lifecycle.rs:16-24` sets and removes the
  process-global `FLYWHEEL_WORKTREE_ROOT` in `with_scratch_worktree_root`; two `#[test]` functions in the same
  binary call it (lines 78 and 83, with the second calling it again at line 87); `git.rs:27-28` reads it; the
  SAFETY comment at line 18 asserts single-threaded execution; and a grep for `serial_test`, `test-threads` and
  `RUST_TEST_THREADS` in the Cargo manifests, `.cargo/` and `.github/` finds nothing. The race is established by the
  source and three CI failures, **not reproduced locally**, as the entry now says.
- Orchestrator-supplied ground truth, taken as stated and **not re-run by me**: core 106 binaries, 1393 tests, 0
  failures (`credentials.rs` skipped, it writes to the real Keychain); desktop jsdom 90 files / 1484 passed / 2 expected
  fail; browser 16 files / 129 passed; `tsc --noEmit` clean; `cargo build --workspace` green. I re-ran only the
  targeted checks named in Criteria 2 to 4, plus `node --test scripts/release/apply-tag-version.test.mjs` (4 of 4 pass).
- `TBD`, `FIXME`, `XXX` scan over the workflows, `update.rs`, `UpdateBanner.tsx`, `tauri.conf.json`, README,
  ARCHITECTURE and `scripts/release/*`: none.

## Required artifacts and key links

| Artifact / link | Status | Details |
|---|---|---|
| `.github/workflows/ci.yml` | VERIFIED | Matches README commands; run 38523539751 success on `main`. |
| `.github/workflows/open-core.yml` | VERIFIED | Run 38523539858 success; structural reference gate. |
| `.github/workflows/release.yml` | VERIFIED, unsigned | `prerelease: false`; no `APPLE_*`. |
| `scripts/release/apply-tag-version.mjs` | VERIFIED | 4 of 4 tests pass. |
| `commands/update.rs` and `UpdateBanner.tsx` | VERIFIED | 6 update tests plus 11 banner tests pass; no updater permission on the window. |
| `tauri.conf.json` endpoint to published `latest.json` | WIRED | HTTP 200 serving 0.1.1 at verification time. |
| `open-core.yml` to relay crate absence | WIRED | Nothing outside the crate references it. |
| `scripts/release/verify-gatekeeper.sh` | MISSING | Plan 11-07 deferred. |
| `release.yml` to Apple signing | NOT_WIRED | Deliberately absent. |

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| DIST-01 | **UNMET, deferred out of the milestone** | Box `[ ]` at `REQUIREMENTS.md:139`; traceability row 318 says "NOT met and not reclassified". Maps to no phase and has no named destination beyond "a later milestone". |
| DIST-02 | MET, limits stated | Criterion 2. |
| DIST-03 | MET | Criterion 3. Box ticked. |
| DIST-04 | MET | Criterion 4. |

No orphaned requirements: the By Phase table maps exactly DIST-02, 03, 04 to Phase 11.

## Is the DIST-01 descope honest? Yes, as a scoping call

The criterion was moved out of scope; it was not rewritten until it passed. DIST-01 stays `[ ]`. The traceability row
says unmet. The ROADMAP criterion is struck through with "NOT met and is NOT reclassified as met". Plan 11-07 is
`deferred`, `tasks: 0`. The diff from `9fa4543` to HEAD touches only planning files, so no signing config was slipped in.
The blocker is a $99/yr purchase the owner declined and the phase cannot code its way past.

What the descope does and does not change: it changes what this phase was *required* to deliver. It does not change what
it *delivered*. A first-time user of this build meets "damaged and can't be opened" with no Open button and needs
`xattr -cr`. The honest reading is that this phase delivers three retained criteria and does not deliver a
Mac-native install experience. The amended Goal now says so.

## Owner decision on closure (2026-10-14), preserved

The first pass returned `gaps_found` at 3/4. **The owner closed the phase on 3/4 with DIST-01 criterion 1
recorded as unmet.** A decision, not a reclassification.

Why: the gap is not undone work. DIST-01 needs a Developer ID Application certificate and notarization, which need an
Apple Developer Program membership ($99/yr). The owner was asked on 2026-10-13 with the cost stated and declined; plan
11-07 is `deferred` with zero tasks and no production file changed (D-REV-60). On 2026-10-14 the consequence proved
worse than assumed: an ad-hoc, linker-signed bundle with no sealed resources produces macOS's "damaged" dialog with no Open
button, not the "unidentified developer" prompt that right-click-Open addresses (D-REV-62). The owner chose to mark
`v0.1.0` Pre-release and document `xattr -cr`. A `/gsd-plan-phase 11 --gaps` cycle would produce only plan 11-07,
already written and already deferred.

What closing does NOT mean: DIST-01 stays `[ ]` and unmet; the 22 `owner-question` items stay open including SC0; D-REV-68
stays open; plan 11-07 remains ready to run unchanged once an Apple account exists. (The original note that CI on
`9fa4543` "had not concluded" is superseded: it concluded green, see Criterion 3.)

## Code review gate (2026-10-14), preserved

The `code-review` capability hook is active and advisory (`onError: skip`). **The owner chose to skip it**, on the grounds
that the phase already carries strong coverage: 106 core test binaries and 1393 tests with zero failures, the full desktop
jsdom and browser suites, nine `impeccable-finish-reviewer` runs producing 58 findings with a disposition each, and the
adversarial verification passes. Recorded as deliberately skipped, not silently dropped. Note from
`11-FINISH-REVIEW.md`: no finish reviewer returned `ship` (nine runs, nine `fix`), and the fixed groups were not re-reviewed.
That is an honest record, not a pass.

## Re-verification follow-ups completed by the orchestrator (2026-10-14), preserved and qualified

1. Phase Goal and `ROADMAP.md:15` amended (see the table above for the one remaining line, `:70`).
2. Plan 11-07 shown `[~]`; plan count reads "21/22 plans executed; 11-07 deferred with 0 tasks (22/22 have SUMMARYs)"
   (progress table `:1337` still reads 22/22).
3. Coverage reads "Unmapped: 1 — DIST-01" (arithmetic beside it needs 92, not 93).
4. DIST-03 ticked `[x]` with CI runs 38523539751 and 38523539858 on `main` at `9fa4543` (the traceability row still
   carries the old "NOT concluded" text).
5. `STATE.md` Apple prerequisite reworded to "HAD ... resolved by deferring it, not by meeting it".
6. D-REV-68 corrected: plan list narrowed to 11-04, 11-05, 11-08, 11-10; "should fail today" replaced with "NOT
   REPRODUCED LOCALLY ... passed 11 of 11". Overstating how widely a wrong belief was held is the same failure as
   understating it.

## Open items that remain open, deliberately

- DIST-01: unmet, no named milestone.
- 22 `owner-question` register items including SC0.
- D-REV-68: race unfixed and unreproduced locally.
- Update flow never observed by the owner or in place.
- The 21 drained commits after `v0.1.1` are in no released build.
- The documentation residue listed above.

## Human verification

None opened, per the standing policy. Items that would have read `human_needed` sit in `.planning/DEFERRED-REVIEW.md` and on
the board, unanswered, neither passed nor verified here.

## Gaps summary

No gaps against the three retained criteria. One owner-decided unmet requirement (DIST-01). Seven documentation warnings, none
affecting a criterion. The remaining decision for the owner or orchestrator is whether to fix the seven residues before
completing the phase, which requires regenerating the fingerprint, or to complete with them recorded here.

---

_Verified: 2026-10-14T07:21:03Z_
_Verifier: Claude (gsd-verifier)_
