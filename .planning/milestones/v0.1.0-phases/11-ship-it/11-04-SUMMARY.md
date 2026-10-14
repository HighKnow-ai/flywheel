---
phase: 11-ship-it
plan: 04
subsystem: distribution
tags: [github-actions, release, tauri-action, versioning, ci]
requires:
  - phase: 11-ship-it
    provides: "11-01 build:dist staging and the staging-before-cargo ordering; 11-02 owner decision record (slug, licence); 11-03 ci.yml step sequence"
provides:
  - ".github/workflows/release.yml, job release: a pushed v* tag builds, tests and publishes an unsigned aarch64 macOS release on macos-14"
  - "scripts/release/apply-tag-version.mjs: the tag is the version in tauri.conf.json, src-tauri/Cargo.toml and packages/desktop/package.json, or the script refuses and writes nothing"
  - "A conditional asset assertion: .dmg and .app.tar.gz always, .sig and latest.json as soon as tauri.conf.json carries createUpdaterArtifacts"
  - "First GitHub-runner evidence for ci.yml and open-core.yml (D-REV-56), and three defects it exposed, fixed"
affects: [11-05, 11-07, 11-08]
tech-stack:
  added: []
  patterns:
    - "A pipeline is proven by a throwaway tag, read back with gh release view, then deleted with its release"
    - "Release notes are real git history, capped at 200 subjects"
key-files:
  created:
    - .github/workflows/release.yml
    - scripts/release/apply-tag-version.mjs
    - scripts/release/apply-tag-version.test.mjs
  modified:
    - packages/core/tests/scope_marker_contract.rs
    - packages/sidecar/test/permission.test.mjs
    - .planning/DEFERRED-REVIEW.md
    - .planning/phases/11-ship-it/deferred-items.md
key-decisions:
  - "The asset assertion is conditional on createUpdaterArtifacts. 11-01 left it unset on purpose, so a four-asset assertion would fail every run until 11-05; a conditional one bites exactly when the config asks for updater artifacts."
  - "Release notes are capped with git log --max-count=200. With no previous tag the range is the whole history, which was 116,932 characters against GitHub's 125,000-character release-body limit."
  - "Fixed pre-existing red tests that blocked the release gate (Rule 3), but reverted two guessed fixes once the real cause was found: a fix that only moves the flake is not a fix."
requirements-completed: [DIST-01, DIST-02]
duration: "continuation segment ~2h 45m (02:08Z to 04:53Z); Tasks 1 and 2 were the previous executor's"
completed: 2026-10-13
status: complete
commits: 7
plan_head_before: 550e19539eacc1bbf1be4c2079daa6b1f810f645
actuals:
  tokens: 3855
  tasks: 3
  commits: 7
coverage:
  - id: D1
    description: "apply-tag-version.mjs stamps the tag into all three manifests, refuses a malformed tag before any write, is idempotent, leaves Cargo comments and the =2.11.5 / =2.4.0 pins intact"
    requirement: DIST-02
    verification:
      - kind: unit
        ref: "node --test scripts/release/apply-tag-version.test.mjs"
        status: pass
      - kind: e2e
        ref: "release run 38346874913, step 'Stamp the tag as the version' logged 'apply-tag-version: stamped 0.0.1-ci'; the dmg name carries 0.0.1-ci"
        status: pass
    human_judgment: false
  - id: D2
    description: "A pushed v* tag runs release.yml on a GitHub macos-14 runner end to end (stamp, sidecar staging, sidecar and cargo tests, release notes from history, tauri-action, asset assertion) and publishes a non-draft release with a .dmg and a .app.tar.gz"
    requirement: DIST-01
    verification:
      - kind: e2e
        ref: "gh run 38344857442 and 38346874913 on tag v0.0.1-ci, both conclusion success; gh release view listed the two assets"
        status: pass
    human_judgment: false
  - id: D3
    description: "The throwaway tag and release are gone: nothing a client could mistake for a release remains"
    verification:
      - kind: other
        ref: "gh release list empty; git ls-remote --tags origin empty; gh api repos/cymarechal/highknow-harness/releases length 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "ci.yml and open-core.yml are green on a GitHub macos-14 runner (D-REV-56)"
    verification:
      - kind: e2e
        ref: "ci.yml run 38346860234 and open-core.yml run 38346860235 at f306e6e, both success"
        status: pass
    human_judgment: false
  - id: D5
    description: "The release carries four assets including a signed latest.json that clients can update from"
    verification: []
    human_judgment: true
    rationale: "Not provable in this plan. 11-01 left createUpdaterArtifacts unset, so only two assets exist. Queued as D-REV-57 against plan 11-05, which adds the key and is the plan that makes the assertion bite."
---

# Phase 11 Plan 04: The release pipeline Summary

**A pushed `v*` tag now builds, tests and publishes an unsigned aarch64 macOS release from a clean clone on GitHub, the tag is the version in all three manifests, and that has been observed twice on a throwaway tag that is now deleted. The updater half (the `.sig` and `latest.json`) does not exist yet and waits on plan 11-05.**

## Performance

- **Duration:** continuation segment about 2h 45m, of which the first-ever GitHub runs and two root-cause hunts took most
- **Started (this segment):** 2026-10-13T02:08Z
- **Completed:** 2026-10-13T04:53Z
- **Tasks:** 3 of 3
- **Files modified:** 5 production/test files, 2 planning files

## Accomplishments

- **Task 3 done for real: the pipeline ran in CI and produced artifacts.** Throwaway tag `v0.0.1-ci`, run `38344857442` (success, at `46f0cef`) and run `38346874913` (success, at `f306e6e`, 12m50s). Every step green: stamp, checkout, Node, Rust, caches, both `npm ci`, `build:dist`, sidecar tests, `cargo test --workspace`, release notes, `tauri-action`, asset assertion.
- **The version came from the tag.** The stamp step logged `apply-tag-version: stamped 0.0.1-ci`, and the artifact is named `Flywheel_0.0.1-ci_aarch64.dmg`, so the tauri version in the built bundle is the tag's, not the hand-written `0.1.0`.
- **First GitHub-runner evidence for plans 11-03's workflows (D-REV-56), and it was red.** The branch had never reached origin; the first push registered the three workflow files and both went red on defects already in the tree. All three are fixed (see Deviations). At `f306e6e` ci.yml (run `38346860234`, includes `tauri build` and a 45,663,820-byte `flywheel-dmg` artifact) and open-core.yml (run `38346860235`) are green on a branch push. D-REV-56 is closed in the register with the honest caveat below.
- **Cleanup verified:** `gh release list` prints nothing, `git ls-remote --tags origin` prints nothing, the releases API returns length 0 with drafts included, no local `v0.0.1*` tag. Done twice, once per throwaway tag.

### What the two assets are, as `gh release view` reported them

| Asset | Size (run 38346874913) | Size (run 38344857442) |
| --- | --- | --- |
| `Flywheel_0.0.1-ci_aarch64.dmg` | 46,101,060 bytes | 46,103,638 bytes |
| `Flywheel_aarch64.app.tar.gz` | 45,857,998 bytes | 45,861,615 bytes |

Release: name `Flywheel v0.0.1-ci`, `isDraft: false`, `isPrerelease: false`. Body after the cap: 14,893 characters, 200 lines, real commit subjects (before the cap: 116,932 characters, 1,621 lines).

### Not met, stated plainly: four assets and the `latest.json` body

The plan's acceptance criteria require four assets and a quoted `latest.json` body. **Neither can exist in this plan.** The release has exactly the two assets above. There is no `.app.tar.gz.sig` and no `latest.json`, so there is no `signature` field to report as empty: the file itself is absent. This is not a failure of `release.yml`; `tauri-action` with `includeUpdaterJson: true` has nothing to publish because the bundle was built without updater artifacts. Plan 11-05 adds `createUpdaterArtifacts` together with the signing keypair. Until then the release is **unsigned and not updatable**, and this pipeline is **not complete**. Queued as D-REV-57.

## Task Commits

1. **Task 1: The tag is the version, in all three places** - `87ba749` (feat) - previous executor
2. **Task 2: The release workflow, unsigned** - `f2b04b5` (feat) - previous executor
3. **Task 3: Prove it on a throwaway tag** - produced these commits, because proving it found what was broken:
   - `2727b09` (fix) scope-marker contract tests follow the `spawn_prepared_run` extraction
   - `f7a176e` (fix) wait for the stubborn session's grandchild to leave the process table - **wrong cause, reverted**
   - `46f0cef` (fix) a zombie grandchild is terminated; a live one still fails - **wrong cause, reverted**
   - `b1275de` (fix) `permission.test` cleanup kills its own descendants, not every fake-claude - **the real cause**; also restores `stop.test.mjs` to its original
   - `f306e6e` (fix) cap the release notes at 200 commits

**Plan metadata:** the docs commit following this file.

## Files Created/Modified

- `.github/workflows/release.yml` - job `release` on `macos-14`, `permissions: contents: write`, trigger `push: tags: ['v*']` only; release notes now `--max-count=200`
- `scripts/release/apply-tag-version.mjs` and `.test.mjs` - from Task 1
- `packages/core/tests/scope_marker_contract.rs` - two source-text tests follow the refactor
- `packages/sidecar/test/permission.test.mjs` - `after()` scoped to the file's own descendants
- `.planning/DEFERRED-REVIEW.md` - D-REV-56 closed with evidence, D-REV-57 added
- `.planning/phases/11-ship-it/deferred-items.md` - two findings

## Decisions Made

- Conditional asset assertion (see key-decisions). The check is not weakened where it can be strict: with `createUpdaterArtifacts` in the config it demands all four.
- `release.yml` was not given `workflow_dispatch`, signing variables or `continue-on-error`, per the plan. `grep -c continue-on-error` is 0.
- Did not touch `ci.yml` or `open-core.yml`.

## Deviations from Plan

### Accepted by the owner before this segment

**A. [Plan conflict] No `.sig` / `latest.json` before plan 11-05.** Task 3 asked for four asset names and the `latest.json` body. 11-01 deliberately left `createUpdaterArtifacts` unset (tauri refuses to build updater artifacts without a signing key). Resolution accepted: the asset assertion requires `.dmg` and `.app.tar.gz` always and `.sig` and `latest.json` only when `tauri.conf.json` contains `createUpdaterArtifacts`. The two assets that can exist are proven; the other two are D-REV-57, pointing at 11-05.

**B. [Plan conflict] Repository slug is still `cymarechal/highknow-harness`.** 11-02's owner decision anticipated a rename to `cymarechal/flywheel` "before any release". It has not happened and is out of scope for 11-04. **Prerequisite for 11-05 and 11-08:** the updater endpoint URL in `tauri.conf.json` (11-05) must use the slug the release is actually published under, and `releases/latest/download/latest.json` resolves under whichever slug the repository has at release time. Rename the repository before either plan runs, or both will point at a path that 404s after the rename (GitHub redirects the web UI but not necessarily the updater's download).

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two stale source-text contract tests broke `cargo test --workspace`**
- **Found during:** Task 3, the first-ever GitHub run of ci.yml and open-core.yml
- **Issue:** `scope_marker_contract.rs` tests `start_agent_run_recording_first_arms_the_scope_...` and `the_spawn_request_carries_the_armed_fact_...` grep `agent_run.rs`. Plan 11-09 (`cf2cb20`) moved the `?` onto a `.map_err(fail_launch)` continuation line and moved the spawn request out of `launch_run_for_task` into `spawn_prepared_run`. Red locally as well; 11-09's own run did not exercise `-p core`.
- **Fix:** the tests follow the code. Both invariants are unchanged and still asserted (arm error propagates; `scopeArmed` comes from the run-start outcome, never recomputed), and `launch_run_for_task` is now additionally pinned to hand the outcome to `spawn_prepared_run`.
- **Files modified:** `packages/core/tests/scope_marker_contract.rs`
- **Verification:** `cargo test -p core --test scope_marker_contract` 23 passed; green in CI thereafter.
- **Commit:** `2727b09`

**2. [Rule 3 - Blocking] `packages/sidecar` tests failed 6 of 11 runs on macos-14, always `stop.test.mjs` test 274 or 276**
- **Found during:** Task 3
- **Issue:** `permission.test.mjs`'s `after()` ran `pkill -f <fake-claude path>`. `node --test` runs files concurrently, so when that file finished it SIGTERMed the stubborn sessions `stop.test.mjs` still had in flight: the session closed early, its `node -e` grandchild survived (a failure message I added showed `ps stat S<`, alive and sleeping, not a zombie), and in test 276 session B closed too. `shutdown.test.mjs` and `watchdog.test.mjs` already carry comments warning against exactly this pattern.
- **Fix:** the cleanup kills only the file's own descendants (`pgrep -P`, recursive). After it, the sidecar step passed 5 of 5 executions.
- **Files modified:** `packages/sidecar/test/permission.test.mjs`
- **Commit:** `b1275de`
- **Two wrong attempts, recorded so nobody trusts them:** `f7a176e` polled for the grandchild to vanish (assumed reaping lag) and `46f0cef` accepted a zombie as terminated (assumed the same). Both were guesses; the second also weakened an assertion. The `ps` state it printed disproved the theory and led to the real cause, and `b1275de` restores `stop.test.mjs` byte-identical to `f2b04b5`. `git log` still shows the two; the net diff of `stop.test.mjs` against the plan's start is empty.

**3. [Rule 1 - Bug] Release notes would exceed GitHub's body limit on the real first release**
- **Found during:** Task 3, reading the throwaway release's body
- **Issue:** with no previous tag the range is the whole history: 116,932 characters, within 8,000 of GitHub's 125,000 limit. `v0.1.0` has the same shape and more commits.
- **Fix:** `git log --max-count=200`. Body is now 14,893 characters. Proven by the second throwaway tag.
- **Files modified:** `.github/workflows/release.yml`
- **Commit:** `f306e6e`

**Total deviations:** 2 accepted plan conflicts, 3 auto-fixed (2 Rule 3, 1 Rule 1). **Impact:** all three were pre-existing or latent defects that the plan's own task (run it for real) was designed to surface. None widened what the plan ships; `ci.yml` and `open-core.yml` are unmodified.

## Authentication Gates

The owner authorised the first push of the branch (about 1,363 commits, first time it reached origin), the throwaway tag, and the cleanup. Done as authorised: no force-push, `main` untouched.

## Issues Encountered

- **Stability is not proven.** One red remains in the base rate: `packages/core/tests/authoring_lifecycle.rs` `mark_abandoned_on_an_authoring_run_writes_a_fallback_summary_inside_its_own_transaction` failed once in about 8 `cargo test` executions (`failed to write the authoring stage runtime marker ... No such file or directory`, a runtime-directory race between concurrent tests). Logged in `deferred-items.md`, not fixed: not on the path of this plan's failures, and the cause is a guess. Expect an occasional red; re-running the failed job is the remedy. Because `release.yml` gates the artifact on `cargo test --workspace`, the real `v0.1.0` tag in 11-08 may need a re-run.
- ci.yml and open-core.yml use bare `on: push`, so a tag push fires them as well as release.yml (three macos-14 jobs per tag). Wasteful, not wrong. In `deferred-items.md`; plan 11-03's files.
- The workflow list shows two entries (CI, Open core); `Release` is registered by the tag push. Not a problem, noted because the owner's earlier diagnosis was "zero workflows indexed".

## Known Stubs

None. No placeholder text in any file this plan changed; the release notes are real history.

## Threat Flags

None new. `release.yml` holds `contents: write` only, no signing secret, and `tauri-action` is pinned to `@v0`. T-11-11's independent read-back is what the asset assertion does.

## Next Phase Readiness

- **11-05** adds `createUpdaterArtifacts` and the keypair. It must also: use the slug the repository will have at release time (Deviation B), and push a throwaway tag afterwards to redeem D-REV-57 (the assertion will then require all four).
- **11-07** adds the `APPLE_*` group above the `tauri-action` step, where the comment already marks the spot.
- **11-08** needs the repository renamed first (Deviation B), expects a possible re-run for the `authoring_lifecycle` flake, and gets release notes capped at 200 subjects.

## Self-Check: PASSED

- `.github/workflows/release.yml`, `scripts/release/apply-tag-version.mjs`, `scripts/release/apply-tag-version.test.mjs` exist on disk.
- All seven commits present: `87ba749 f2b04b5 2727b09 f7a176e 46f0cef b1275de f306e6e` (`git rev-list --count 550e195..HEAD` = 7).
- `release wiring ok`, staging before `cargo test`, `grep -c continue-on-error` = 0.
- Runs `38344857442` and `38346874913` conclusion success; `v0.0.1-ci` release and tag absent from origin.
