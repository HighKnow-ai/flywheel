---
phase: 11-ship-it
plan: 08
subsystem: distribution
tags: [release, v0.1.0, v0.1.1, unsigned, updater, fresh-clone, dist-01, dist-02, dist-03]
requires:
  - phase: 11-ship-it
    provides: "11-02 owner decision (slug, consent); 11-04 release.yml; 11-05 updater keypair and four-asset release; 11-06 update banner; 11-07 deferred (unsigned)"
provides:
  - "v0.1.0 and v0.1.1: real, public, non-draft GitHub releases on HighKnow-ai/flywheel, each with .dmg, .app.tar.gz, .sig and latest.json. Both are meant to stay."
  - ".planning/phases/11-ship-it/11-RELEASE-EVIDENCE.md: the phase's evidence record"
  - "Cryptographic verification of both updater tarballs against the compiled public key, with tamper and cross-version controls"
  - "A README whose build command works for a stranger, and an allowlist that makes cargo test --workspace green again"
affects: [11-19, 11-20, 11-21]
status: complete-with-unmet-criteria
commits: 3
plan_head_before: 57e068147464bbe98263ecebca1ee5af081b8ae3
actuals:
  tokens: 7350
  tasks: 3
  commits: 3
key-files:
  created:
    - .planning/phases/11-ship-it/11-RELEASE-EVIDENCE.md
  modified:
    - README.md
    - packages/core/tests/epic_context_packet.rs
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "Task 1 (the publication checkpoint) was not re-asked. The owner had already made the repository public on 2026-10-13 and confirmed .planning is published unscrubbed (11-02-OWNER-DECISION.md); there was no decision left to make. The sweeps were still run and are on the record."
  - "The first v0.1.0 tag was deleted and re-cut, as the plan instructs for a failed release, because cargo test --workspace was deterministically red on main. The tag now points at 2f6d9d0, whose tree is main's plus two files, and which is not on main."
  - "v0.1.1 was cut on the evidence-recording commit rather than waiting for a commit from another plan: none was coming (sequential execution), and an empty commit was forbidden."
  - "Gatekeeper was not bypassed and not observed. spctl was asked about the unmodified artifact; the executable was started directly only to show the app runs, and that is labelled as not being the first-launch test."
requirements-completed: []
duration: "about 3 h, mostly waiting on three GitHub release runs"
completed: 2026-10-14
---

# Phase 11 Plan 08: v0.1.0 and v0.1.1 Summary

**Two real, signed-for-update, unsigned-by-Apple releases are public on `HighKnow-ai/flywheel`; the installed `v0.1.0` is on `/Applications` and runs; `v0.1.1` is on offer with a manifest signature that verifies against the compiled key. DIST-01 criterion 1 (no Gatekeeper warning) is NOT MET, and an installed client actually taking the update has NOT been observed.**

## What was done

- **Publication.** Already public by the owner's own act on 2026-10-13. Re-ran the credential sweeps: 0 credential-shaped paths over 1290 tracked files; 11 pattern matches in 7 files outside `.planning/`, every one inspected and a test fixture or UI placeholder; 5 more in `.planning/`, all prose. Unauthenticated `curl` of `LICENSE`, `NOTICE`, `README.md` and `releases/latest/download/latest.json`: 200 each. Licence reads `apache-2.0`.
- **`v0.1.0`.** Published 2026-10-14T01:36:12Z at `2f6d9d0`, non-draft, non-prerelease, four assets (dmg 47,012,635 B, tarball 48,118,099 B, `.sig` 408 B, `latest.json` 16,066 B). The downloaded dmg's sha256 matches GitHub's digest.
- **Install.** Downloaded unauthenticated, mounted, copied to `/Applications/Flywheel.app`, ejected. `CFBundleShortVersionString` is `0.1.0`, so the tag-as-version stamp took effect.
- **Fresh HTTPS clone (DIST-03).** Found and fixed a real defect: the README's last build command exited 1 for any contributor (details under Deviations).
- **`v0.1.1`.** Published 2026-10-14T02:02:38Z at `3024cc2`, first attempt, four assets, marked `Latest`. Manifest at the stable URL says `0.1.1`, has a `darwin-aarch64` entry, non-empty 408-character signature.
- **Signature verification, done for real.** `minisign-verify =0.2.5` (the crate `tauri-plugin-updater` already locks, built offline, nothing newly installed) against the public key in `tauri.conf.json`: both tarballs verify. Controls: a one-byte-tampered tarball fails, and the `v0.1.0` signature over the `v0.1.1` tarball fails.
- **Does the installed app reach the endpoint?** Started with an isolated `HOME` after `v0.1.1` existed, sampled with `lsof`: the process held TLS connections to `github.com` and `release-assets.githubusercontent.com`. Consistent with fetching `latest.json`; does not show the response was parsed or a banner drawn.

## Not met, stated plainly

- **DIST-01 criterion 1 (signed, notarized, no Gatekeeper warning): NOT MET.** `codesign` reports `Signature=adhoc`, `TeamIdentifier=not set`; `spctl --assess` rejects the bundle (exit 1) with "code has no resources but signature indicates they must be present"; `stapler` finds no ticket. Same for `v0.1.1`. `scripts/release/verify-gatekeeper.sh` does not exist (11-07 deferred), so the plan's verify command for it could not run. No bypass was attempted (no `xattr -d`, no `spctl --master-disable`, no re-signing). The Gatekeeper dialog itself was **not observed**; see D-REV-62.
- **DIST-02 (updates itself): the offer side is proven, the install side is not.** Nobody has watched an installed `0.1.0` become `0.1.1`. The four questions are in `11-RELEASE-EVIDENCE.md` section 7, marked PENDING the plan 11-21 owner pass.
- **A Finder first launch was not done**, for the Gatekeeper reason above. The executable was started directly (isolated `HOME`) and it ran, made its database and spawned `flywheel-node`. That proves the app works. It proves nothing about criterion 1.
- **`requirements-completed` is empty on purpose.** DIST-01 is unmet. DIST-03 was met on the tag's README but `main`'s README is still the broken one until `2f6d9d0` is merged. DIST-02 and DIST-04 were already marked complete by earlier plans and this plan does not widen that.
- **The updater signature is not Apple notarization.** It proves a payload came from key `AB3536BDD39983C5`. Neither is used in this plan as evidence for the other.

## Deviations from Plan

### Plan conflicts

**A. [Plan conflict] Task 1's `blocking-human` checkpoint was not raised.** Its question (publish the repository now?) had been answered and executed by the owner on 2026-10-13, and recorded. Raising it again would have asked about a one-way act that is already done. The sweeps it wanted presented were run and are in the evidence file; the owner can read them there.

**B. [Plan conflict] Task 3 expected a signed, notarized release and `verify-gatekeeper.sh`.** Neither exists (11-07 deferred). Replaced by direct `codesign`, `spctl` and `stapler` readings of the unmodified artifact, reported as a failure of the criterion rather than a pass.

**C. [Plan conflict] "Launch from Finder" was not done.** See above. Replaced by a direct executable launch against a scratch `HOME`, labelled as such.

**D. [Plan conflict] Task 4 step 3 said the update request "leaves a trace".** `commands/update.rs` writes no log, so the only trace was a socket sample. Recorded; no log line added (out of scope).

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `cargo test --workspace` was deterministically red on `main`, so the release job could not publish**
- **Found during:** Task 3, release run `38482840978` on the first `v0.1.0` tag at `32d4019`
- **Issue:** `epic_context_packet.rs:923` rejected `task_header` and `epic_header` in `packages/core/src/query/authoring.rs` as unbounded, un-allowlisted SELECTs. Plan 11-22 (`c1beffc`) added them without allowlist entries. `main`'s own CI and Open core runs were red on the same line. NOT the known intermittent flake; a re-run cannot pass it.
- **Fix:** two allowlist entries. Both reads are `query_row` keyed by a primary key (`WHERE id = ?1`), cardinality one, the shape `get_epic_for_agent` is already allowlisted for. The failed tag was deleted (no release had been published) and re-cut.
- **Verification:** `cargo test -p core --test epic_context_packet` 16 passed; every other core test target except `credentials.rs` (not run, per the known hazard) passed: 106 binaries ok, 0 failed; `cargo test --workspace --exclude core` ok. Needed because `cargo test --workspace` stops at the first failing binary and so can hide further reds.
- **Files modified:** `packages/core/tests/epic_context_packet.rs`
- **Commit:** `2f6d9d0`

**2. [Rule 1 - Bug] The README's documented build command failed for every contributor**
- **Found during:** Task 3, the fresh HTTPS clone
- **Issue:** `tauri build` produced the `.app`, `.dmg` and `.app.tar.gz` and then exited 1: "A public key has been found, but no private key." `tauri.conf.json` sets `createUpdaterArtifacts` (11-05) and a contributor has no signing key. `ci.yml` already had the workaround; the README did not.
- **Fix:** the last command now carries `-- --config '{"bundle":{"createUpdaterArtifacts":false}}'`, with a paragraph on why. Re-run in the same clone: exit 0 in 226 s.
- **Files modified:** `README.md`
- **Commit:** `2f6d9d0`
- **Caveat:** the corrected command ran against a tree the failing one had already built, so a fully cold run of it was not timed. The clone tested `main`, which still carries the old README.

**Total deviations:** 4 plan conflicts, 2 auto-fixed (1 Rule 3, 1 Rule 1). **Impact:** deviation 1 cost one failed release run and one tag deletion/re-cut; the failed run published nothing.

## Things the owner needs to know

1. **`main` is still red and its README still wrong.** The two releases are cut from `cymarechal-devoteam/gsd-new-project-ade` (`2f6d9d0`, `3024cc2`), not from `main`. The tag's tree is `main`'s plus `README.md` and `epic_context_packet.rs`. A merge of that branch into `main` fixes both; I did not merge to `main`. Until then GitHub's "this commit does not belong to a branch of this repository" is not shown (the branch is pushed) but a visitor on `main` sees the broken README.
2. **A pre-existing `/Applications/Flywheel.app` was replaced.** It was modified at 23:31Z on 2026-10-13 during this plan's run, reported `0.1.0`, was ad-hoc signed, and I did not install it. I moved it (did not delete it) to the executor scratchpad: `/private/tmp/claude-501/-Users-cymarechal-orca-workspaces-HighKnow-harness-threadfin/5b4e8b4d-fde8-47df-bd88-fd3d2f961ed0/scratchpad/replaced/Flywheel.app.preexisting`. That is a temp directory and may be cleared.
3. **Another tag/release exists beyond what you approved.** You approved `v0.1.0`; the plan also required `v0.1.1` (an update with nothing to offer proves nothing). Its notes are one docs commit subject. Deleting it would put `releases/latest` back on `v0.1.0` and remove what the update check is meant to find, so it was left.
4. **Known flake hit once:** release run `38493244716` attempt 1 failed `worktree_lifecycle.rs:100`; re-running the failed job passed, as instructed.
5. **Two leftovers in temp, not in the repository:** scratch clone and build output under the scratchpad (several GB); a `verify` helper binary. Nothing outside the scratchpad and `/Applications` was changed on this machine.

## Register

`DEFERRED-REVIEW.md`: D-REV-60 gained first-hand confirmation; D-REV-61 notes its preconditions are now met and what was and was not seen; **D-REV-62 added** for the Finder first-launch / Gatekeeper dialog (physical reason: the OS dialog and quarantine come from a browser download; includes the unverified inference that the dialog may be the "damaged" form and the right-click-Open workaround may not work on this macOS).

## Known Stubs

None. No placeholder text in any file this plan changed.

## Threat Flags

None new. T-11-24 (publication disclosure): sweeps recorded, nothing found. T-11-25 (failed release left at `releases/latest`): the failed `v0.1.0` published nothing and its tag was deleted; both final releases are `isDraft=false, isPrerelease=false`. T-11-26 (empty signature): `v0.1.1` signature non-empty and independently verified, not inferred from a green workflow.

## Next Phase Readiness

- **11-21 (owner pass)** has real material now: install is on `/Applications`, `v0.1.1` is on offer, and the four update questions plus D-REV-62 are written down.
- **11-19 / 11-20** are unblocked by this plan.
- The merge of the branch to `main` is the owner's step and fixes CI and the README at once.

## Self-Check: PASSED

- `.planning/phases/11-ship-it/11-RELEASE-EVIDENCE.md` and this file exist on disk.
- Commits present: `2f6d9d0`, `3024cc2`, `db46603` (`git rev-list --count 57e0681..HEAD` = 3 before this file).
- `gh repo view` PUBLIC; `gh release view v0.1.0` and `v0.1.1`: non-draft, non-prerelease, four assets each; `v0.1.1` is `Latest`; tags exist on origin.
- `/Applications/Flywheel.app` reports `0.1.0`.
- Verify items that could not pass and are recorded as unmet rather than skipped: `verify-gatekeeper.sh` (does not exist), criterion 1.
