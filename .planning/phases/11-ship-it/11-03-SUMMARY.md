---
phase: 11-ship-it
plan: 03
subsystem: distribution
tags: [github-actions, ci, open-core, readme, tauri]
requires:
  - phase: 11-ship-it
    provides: "11-01 build:dist staging script and the staging-before-cargo ordering; 11-02 ARCHITECTURE.md section 8, LICENSE, NOTICE"
provides:
  - ".github/workflows/ci.yml, job build: clean-clone build, test and unsigned tauri build on macos-14 on every push"
  - ".github/workflows/open-core.yml, job relay-absent: full build and test with packages/relay-client deleted and a non-comment reference gate"
  - "README.md Building from source, Licence and Architecture sections, with commands identical to ci.yml"
affects: [11-04, 11-07]
tech-stack:
  added: []
  patterns:
    - "A boundary proved by a job that deletes the thing and fails the build, not by a convention"
key-files:
  created:
    - .github/workflows/ci.yml
    - .github/workflows/open-core.yml
  modified:
    - README.md
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "Gate order in open-core.yml: delete crate, drop member, then grep. The root Cargo.toml members line is itself a reference, so the gate can only run once the sed has removed it. Cargo.lock is not searched: it is generated and cargo prunes it."
  - "sed -i.bak then rm instead of BSD-only sed -i '' so the step is portable."
requirements-completed: [DIST-03, DIST-04]
duration: ~10 min
completed: 2026-10-13
status: complete
commits: 3
plan_head_before: 57e8a8ddc2600f7ee255a25150d41d69288c676b
actuals:
  tokens: 2000
  tasks: 3
  commits: 3
coverage:
  - id: D1
    description: "ci.yml runs the clean-clone sequence with sidecar staging before every cargo step, and bundles the application"
    requirement: DIST-03
    verification:
      - kind: other
        ref: "node ordering check on ci.yml (build:dist before cargo build); grep -c continue-on-error = 0; non-comment 'tauri build' count = 1; YAML parses (14 steps)"
        status: pass
    human_judgment: false
  - id: D2
    description: "open-core.yml deletes packages/relay-client, removes its member, keeps Cargo.toml parseable, and gates non-comment references"
    requirement: DIST-04
    verification:
      - kind: other
        ref: "local dry run: sed + cargo metadata exit 0 with the crate moved away; gate returns zero hits; Cargo.toml restored (git diff --quiet)"
        status: pass
    human_judgment: false
  - id: D3
    description: "README documents staging before cargo, with the tauri_build reason, arm64 triple, Node download, Apache-2.0, ARCHITECTURE.md"
    requirement: DIST-03
    verification:
      - kind: other
        ref: "node ordering check on README.md; the five build commands match ci.yml run strings character for character"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both workflows go green on a real GitHub macos-14 runner"
    requirement: DIST-03
    verification: []
    human_judgment: true
    rationale: "A GitHub runner is the only place this is observable; neither workflow has run. Queued as D-REV-56 and redeemed by the first push."
---

# Phase 11 Plan 03: CI clean-clone build and open-core proof Summary

Two GitHub Actions workflows plus README amendments: `ci.yml` re-proves a clean-clone build and unsigned `tauri build` on every push, and `open-core.yml` deletes `packages/relay-client` and must still build and pass `cargo test --workspace`, with a non-comment grep gate on references to the crate.

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-10-13T01:48Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, README.md, DEFERRED-REVIEW.md)

## Accomplishments

- `ci.yml` (job `build`, `macos-14`): checkout, Node 22 with npm cache over both lockfiles, Rust stable plus `Swatinem/rust-cache`, then the README sequence: both `npm ci`, `build:dist` (commented with the `tauri_build::build()` reason), sidecar tests, `cargo build`, `cargo test`, desktop vitest, desktop build, `tauri build`, dmg upload for 7 days. Least-privilege `permissions: contents: read`, no secrets, no `continue-on-error`.
- `open-core.yml` (job `relay-absent`): `rm -rf packages/relay-client`, delete its `members` line, assert it is gone and `cargo metadata` still parses, then the grep gate, then the same build and test sequence through the desktop build. No feature flag or `optional` dependency is used to simulate absence.
- `README.md`: arm64 host-triple row, pinned-Node network note, a "Building from source" section in CI order with the reason for the order, sidecar test and the three optional browser suites under tests, and Architecture and Licence sections linking `ARCHITECTURE.md`, `LICENSE`, `NOTICE`.

## Task Commits

1. **Task 1: clean-clone build on every push** - `d892293` (feat)
2. **Task 2: open-core proof** - `1bded5a` (feat)
3. **Task 3: README** - `86c44ec` (docs)

**Plan metadata:** the following docs commit (SUMMARY, register entry, STATE, ROADMAP).

## Files Created/Modified

- `.github/workflows/ci.yml` - DIST-03 gate
- `.github/workflows/open-core.yml` - DIST-04 gate
- `README.md` - build-from-source documentation
- `.planning/DEFERRED-REVIEW.md` - D-REV-56 appended

## Decisions Made

- The grep gate runs after the `sed`, because the root `Cargo.toml` members line is a reference to the crate; it searches `Cargo.toml` and `package.json` as the root manifests and skips `Cargo.lock`, which cargo regenerates.
- `sed -i.bak` plus `rm` is used rather than macOS-only `sed -i ''`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `ci.yml` runs `build:dist` explicitly and `tauri build`'s `beforeBuildCommand` (from 11-01) runs it again, so staging happens twice. This is redundant, not wrong, and the explicit step is required because cargo needs the files first. Left as is.
- `open-core.yml` does not use `--locked`, so cargo rewrites `Cargo.lock` on the runner once the member is gone. Intended: the tree is a scratch checkout.

## Honest status of the claim

Neither workflow has been run on a GitHub runner. What was observed locally: both parse as YAML, the ordering checks pass, the open-core `sed` + `cargo metadata` pair exits 0 against a tree with the crate moved away, the gate finds zero references, and `Cargo.toml` was restored byte-identical. "CI proves DIST-03 on every push" becomes true on the first push; until then it is queued as D-REV-56, not claimed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

11-04's release workflow can reuse the `ci.yml` step sequence and add the signing identity there only. The first push of this branch redeems D-REV-56.

## Threat Flags

None. The threat register's T-11-07 mitigations hold: only `actions/*`, `dtolnay/rust-toolchain` and `Swatinem/rust-cache`, no write permissions, no secrets declared.

## Self-Check: PASSED

Files `.github/workflows/ci.yml`, `.github/workflows/open-core.yml`, `README.md` exist; commits `d892293`, `1bded5a`, `86c44ec` exist; `git rev-list --count 57e8a8d..HEAD` = 3 before this commit.
