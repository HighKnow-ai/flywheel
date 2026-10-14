---
phase: 11-ship-it
plan: 01
subsystem: distribution
tags: [tauri, bundling, sidecar, node-runtime, packaging]
requires: []
provides:
  - "build:dist npm script staging a verified Node runtime, flywheel-shim, launcher and prod-only sidecar resources"
  - "Flywheel.app whose sidecar acks a ping from outside the source tree"
  - "Flywheel_0.1.0_aarch64.dmg for aarch64-apple-darwin"
affects: [11-04, 11-05, 11-07]
tech-stack:
  added: []
  patterns:
    - "Generated externalBin launcher + staged Node runtime instead of a single-file pkg/nexe binary (D-192)"
key-files:
  created:
    - packages/sidecar/scripts/stage-runtime.mjs
    - packages/sidecar/scripts/launcher.sh
    - packages/sidecar/test/packaged-sidecar.test.mjs
  modified:
    - packages/sidecar/package.json
    - packages/sidecar/test/stub-invocation.test.mjs
    - packages/desktop/src-tauri/tauri.conf.json
    - .gitignore
  deleted:
    - packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin (untracked; regenerated on disk by build:dist)
key-decisions:
  - "No pkg/nexe: stage Node 22.23.3 (SHASUMS256-verified) + compiled dist/ + prod node_modules, because hook commands use process.execPath and import.meta.url siblings"
  - "createUpdaterArtifacts is NOT set in this plan: Tauri refuses to build without plugins.updater (pubkey); plan 11-05 owns the key and must add the flag with it"
requirements-completed: []
duration: ~45 min
completed: 2026-10-12
status: complete
commits: 3
plan_head_before: e9150a2cc5c39094817da90f398eade8ff4a8d31
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
coverage:
  - deliverable: "build:dist stages Node runtime, shim, launcher and resources"
    human_judgment: false
    verification:
      - kind: command
        ref: "npm --prefix packages/sidecar run build:dist && test -x binaries/flywheel-{sidecar,node,shim}-aarch64-apple-darwin"
        status: pass
  - deliverable: "Generated sidecar executables are untracked"
    human_judgment: false
    verification:
      - kind: command
        ref: "git ls-files | grep src-tauri/binaries/ (no hit); git check-ignore on generated paths"
        status: pass
  - deliverable: "Packaged Flywheel.app starts its sidecar outside the source tree"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/sidecar/test/packaged-sidecar.test.mjs"
        status: pass
  - deliverable: ".dmg for aarch64-apple-darwin"
    human_judgment: false
    verification:
      - kind: command
        ref: "npm --prefix packages/desktop run tauri build -> target/release/bundle/dmg/Flywheel_0.1.0_aarch64.dmg"
        status: pass
  - deliverable: ".app.tar.gz + .sig updater artifacts"
    human_judgment: false
    verification:
      - kind: command
        ref: "tauri build with a throwaway key and --config override (not committed config)"
        status: pass
---

# Phase 11 Plan 01: Packaged sidecar tracer Summary

A `Flywheel.app` built by `tauri build` now carries its own checksum-verified Node 22.23.3, the compiled sidecar `dist/`, production-only dependencies and `flywheel-shim`, and its sidecar acks a `ping` when run from a temp directory with no Flywheel source.

## What was built

- `stage-runtime.mjs` (run via `build:dist`): resolves the triple from `rustc -vV`, downloads the pinned Node tarball, verifies it against `SHASUMS256.txt` (one re-download, then refuse), builds `flywheel-shim --release`, stages `dist/` plus `npm ci --omit=dev --ignore-scripts` output, and copies `launcher.sh` to `binaries/flywheel-sidecar-<triple>`.
- `launcher.sh`: packaged branch (`flywheel-node` + `../Resources/sidecar/dist/index.js`, no PATH lookup) before the unchanged source-tree walk-up, then `exit 127`.
- `tauri.conf.json`: three `externalBin` entries, `resources` map, `targets: ["dmg","app"]`, `beforeBuildCommand` runs `build:dist` first.
- `.gitignore` + `git rm --cached`: no sidecar executable or staged resource is tracked.
- `stub-invocation.test.mjs` skips with a named reason when the launcher is not built.
- `packaged-sidecar.test.mjs`: copies the `.app` to `os.tmpdir()`, asserts the four bundle members and a `ok:true` ack from `Contents/MacOS/flywheel-sidecar`.

## Verification run

- `npm --prefix packages/sidecar test`: 292 pass, 0 fail, 0 skipped (launcher present). With the launcher removed the three stub tests skip naming `build:dist`.
- `npm --prefix packages/sidecar test` packaged test: 2 pass, 0 skipped (not a skip). Temp copies cleaned up.
- `tauri build`: `Flywheel.app` + `Flywheel_0.1.0_aarch64.dmg`.
- Updater artifacts: with a throwaway key generated in scratch and a `--config` override, the same build also produced `Flywheel.app.tar.gz` and `.sig`, so the mechanism works once 11-05 supplies the real key. This was NOT done with the committed config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] beforeBuildCommand sidecar path**
- **Found during:** Task 3 (first `tauri build`)
- **Issue:** the plan's `--prefix ../../sidecar` is resolved from `packages/desktop`, not `src-tauri`, so it pointed at `threadfin/sidecar` (ENOENT).
- **Fix:** `--prefix ../sidecar`.
- **Files modified:** packages/desktop/src-tauri/tauri.conf.json
- **Commit:** fe4fc40

**2. [Rule 1 - Bug] Resources nested under `Resources/resources/sidecar`**
- **Found during:** Task 3 (packaged test exited 127)
- **Issue:** `"resources": ["resources/sidecar"]` keeps the `resources/` prefix inside the bundle, so the launcher's `../Resources/sidecar/dist/index.js` never existed. Exactly the packaged-branch bug the tracer exists to catch.
- **Fix:** map form `{"resources/sidecar": "sidecar"}`.
- **Files modified:** packages/desktop/src-tauri/tauri.conf.json
- **Commit:** fe4fc40

**3. [Rule 3 - Blocking] `createUpdaterArtifacts: true` cannot build yet**
- **Found during:** Task 3
- **Issue:** Tauri fails with `plugins > updater doesn't exist`; the updater pubkey and signing key belong to plan 11-05 (a human-action checkpoint). Generating the owner's production key here is out of scope.
- **Fix:** left `createUpdaterArtifacts` out of the committed config so the documented build command works. Plan 11-05 must add `createUpdaterArtifacts: true` together with `plugins.updater`. Plans 11-04 and 11-07 read it as "set by plan 11-01" — that assumption is now wrong and 11-05 must satisfy it.
- **Impact on plan truths:** the "exactly one `.dmg` and one `.app.tar.gz`" truth is met for the `.dmg` only on the committed config; the `.app.tar.gz` + `.sig` are proven only via the throwaway-key override.
- **Commit:** fe4fc40

**4. [Process] HEAD guard**
The worktree-mode agent-branch allow-list in the executor protocol does not apply: this run is a sequential executor on the owner's phase branch `cymarechal-devoteam/gsd-new-project-ade` (not a protected branch), as the spawn prompt directed.

**Total deviations:** 3 auto-fixed (2 bug, 1 blocking), 1 process note. **Impact:** the packaged branch is now actually proven; updater artifacts move to 11-05.

## Not verified

- The plan's verification line that `cargo build -p desktop` fails before staging was not exercised.
- No signing or notarization (plans 11-06/11-07).

## Known Stubs

None.

## Threat Flags

None. T-11-01/02/03 mitigations are implemented as written (pinned version + SHASUMS check, both-or-nothing packaged branch with no PATH lookup, `npm ci --omit=dev` staging).

## Self-Check: PASSED

Files exist (stage-runtime.mjs, launcher.sh, packaged-sidecar.test.mjs); commits d872cb0, 9877e0c, fe4fc40 exist; `commits: 3` measured from `plan_head_before`.
