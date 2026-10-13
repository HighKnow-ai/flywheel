---
phase: 11-ship-it
plan: 05
subsystem: distribution
tags: [tauri-updater, minisign, release, self-update, supply-chain]
requires:
  - phase: 11-ship-it
    provides: "11-02 owner decision (slug HighKnow-ai/flywheel); 11-04 release.yml and its conditional asset assertion"
provides:
  - "tauri-plugin-updater pinned =2.12.0, registered on the builder, no permission granted to the window"
  - "plugins.updater: the owner's minisign public key (id AB3536BDD39983C5) and exactly one endpoint, https://github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json"
  - "bundle.createUpdaterArtifacts: a release now publishes .app.tar.gz.sig and latest.json"
  - "update_check and update_install (commands/update.rs); install refuses by live-run count in Rust"
  - "release.yml signs with TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) from repository secrets"
affects: [11-06, 11-07, 11-08]
tech-stack:
  added: ["tauri-plugin-updater 2.12.0 (crates.io, owner tauri-bot, tauri-apps/plugins-workspace)"]
  patterns:
    - "A network seam as a private trait, so the guard in front of it is tested without a network"
    - "The live-run guard runs twice: before the fetch and between the download and the install"
key-files:
  created:
    - packages/desktop/src-tauri/src/commands/update.rs
  modified:
    - packages/desktop/src-tauri/Cargo.toml
    - Cargo.lock
    - packages/desktop/src-tauri/tauri.conf.json
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - .github/workflows/release.yml
    - .github/workflows/ci.yml
    - .gitignore
    - .planning/DEFERRED-REVIEW.md
    - .planning/phases/11-ship-it/deferred-items.md
key-decisions:
  - "Pin tauri-plugin-updater at exactly =2.12.0 (owner-approved). 2.13.x needs tauri ^2.12 and the owner refused to bump tauri, preserving D-181's =2.11.5 pin."
  - "update_install re-reads the live-run count after the download and before the install, not only before. A download takes long enough for a run to start, and the bytes sit only in memory until install, so a late refusal leaves nothing on disk."
  - "The live count is flywheel_core::dispatch::occupied_slots, not a new query and not the fleet read. The fleet read is banded and capped at 200 rows with running rows ordered after abandoned ones, so it can omit a live run; occupied_slots is a COUNT over the same running/blocked predicate, across every project, authoring runs included."
patterns-established:
  - "Secrets referenced once: both signing variables appear only in the tauri-action step's env"
requirements-completed: [DIST-02]
duration: "continuation segment, 2026-10-13 from the owner's approval to cleanup, about 2h dominated by a 14m37s cold desktop build and a 20m42s release run"
completed: 2026-10-13
status: complete
commits: 2
plan_head_before: 7ef7beef2a7a7b922e9f32798b542f8c2079090f
actuals:
  tokens: 17500
  tasks: 3
  commits: 2
coverage:
  - id: D1
    description: "tauri-plugin-updater is a pinned dependency that resolves against tauri =2.11.5"
    requirement: DIST-02
    verification:
      - kind: command
        ref: "cargo tree -p desktop -i tauri-plugin-updater: v2.12.0 under desktop; tauri v2.11.5, tauri-build 2.6.3 and notification 2.4.0 unchanged in Cargo.lock"
        status: pass
      - kind: command
        ref: "grep -vE '^\\s*#' Cargo.toml | grep -c 'tauri-plugin-updater = \"='  -> 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "update_install refuses while any run is live, names the count, fetches nothing, and a run that starts during the download still stops the install"
    requirement: DIST-02
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/update.rs tests a_live_run_refuses_with_its_count_and_nothing_is_fetched, a_blocked_run_counts_and_the_count_is_named_in_the_plural, a_run_that_starts_during_the_download_still_stops_the_install, with_no_live_run_the_update_is_downloaded_and_installed"
        status: pass
    human_judgment: false
  - id: D3
    description: "The window holds no updater permission, and the compiled config is one github.com endpoint plus a key"
    requirement: DIST-02
    verification:
      - kind: unit
        ref: "update.rs tests the_window_capability_grants_no_updater_permission, the_compiled_updater_config_is_one_github_endpoint_and_a_key"
        status: pass
      - kind: command
        ref: "strings target/debug/desktop | grep releases/latest/download/latest.json -> exactly one hit, the HighKnow-ai/flywheel URL; 0 hits for highknow-harness or cymarechal/flywheel"
        status: pass
    human_judgment: false
  - id: D4
    description: "A pushed tag produces four assets including a latest.json whose signature verifies against the compiled key's id"
    requirement: DIST-02
    verification:
      - kind: e2e
        ref: "Release run 38396587749 on throwaway tag v0.0.1-ci at 1882b14, success; gh release view listed .dmg, .app.tar.gz, .app.tar.gz.sig, latest.json; signature field byte-identical to the .sig asset; key id AB3536BDD39983C5 on both sides"
        status: pass
    human_judgment: false
  - id: D5
    description: "An installed older build actually fetches the manifest, verifies it and installs the newer version"
    requirement: DIST-02
    verification: []
    human_judgment: true
    rationale: "Needs two installed builds of different versions. The tests drive a fake source and the config is read, not exercised. Queued, not claimed."
---

# Phase 11 Plan 05: The updater half Summary

**Flywheel can now see, verify and stage a newer release from `HighKnow-ai/flywheel`, and refuses in Rust, by naming the count, while any agent run is live. A throwaway tag proved a release now carries all four assets with a signature made by the owner's key. That an installed build actually updates itself has NOT been observed.**

## Performance

- **Tasks:** 3 of 3 (Task 1 and Task 2 were gates; Task 3 was the code)
- **Commits:** 2 (measured, `git rev-list --count 7ef7bee..HEAD`)
- **Files:** 9 production and config files, 2 planning files
- **Tests:** `cargo test -p desktop` 149 passed, 0 failed; `cargo build --workspace` green

## Accomplishments

- **Task 1, the legitimacy gate, answered and honoured.** Owner approved `=2.12.0`. Crates.io owner `tauri-bot`, repository `github.com/tauri-apps/plugins-workspace`, created 2023-05-24, about 11.9 million downloads; `tauri-plugin-update` is a 404 (no typosquat); `tauri-updater` is the official abandoned 2020-21 predecessor and not what was installed. `2.12.0` requires `tauri ^2.10`; `2.13.0`-`2.13.3` require `^2.12`. `cargo tree` shows it resolving under `tauri v2.11.5`. No `cargo add` ran before the answer. The lockfile gained 32 packages and lost no pin.
- **Task 2, the trust root, was the owner's.** The owner generated the keypair, set both secrets, and confirmed an off-machine copy of the key and password (Apple Passwords, key id `AB3536BDD39983C5` recorded). I never read, printed or recorded the private key or the password. `gh secret list` shows both names. `git ls-files` matches nothing named `updater.key`, and `git check-ignore` confirms `packages/desktop/updater.key` is ignored (`.gitignore:31:*.key`).
- **The compiled endpoint is exactly** `https://github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json`, found by `strings` on the built binary: one hit, and zero hits for either former slug.
- **`update_check`** takes no arguments and returns `{available, version, notes, currentVersion}`. A manifest that fails verification or cannot be fetched is an `Err` (`failed:update_check:check`), never "no update".
- **`update_install`** takes no arguments. It counts live runs, refuses with the count if non-zero, otherwise checks, downloads (the plugin verifies the ed25519 signature in `download`), counts again, then installs. The database mutex is taken and dropped inside `live_runs`, so it is never held across an `.await`.

### The four-asset proof (D-REV-57)

Throwaway tag `v0.0.1-ci` at `1882b14`, Release run `38396587749`, success, 20m42s. With `createUpdaterArtifacts` in the config the asset assertion required all four, and `gh release view` listed:

| Asset | Bytes |
| --- | --- |
| `Flywheel_0.0.1-ci_aarch64.dmg` | 47,000,025 |
| `Flywheel_aarch64.app.tar.gz` | 48,105,596 |
| `Flywheel_aarch64.app.tar.gz.sig` | 408 |
| `latest.json` | 16,403 |

Not a draft, not a prerelease. The `latest.json` body, with the 408-character signature and the 200-line notes shortened for reading (the release is deleted, so the full file no longer exists anywhere):

```json
{
  "version": "0.0.1-ci",
  "notes": "- feat(11-05): updater commands, endpoint, pubkey and signing env (D-186, D-188) ... (200 lines, 14947 chars)",
  "pub_date": "2026-10-13T12:40:24.819Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRh...(408 chars)",
      "url": "https://github.com/HighKnow-ai/flywheel/releases/download/v0.0.1-ci/Flywheel_aarch64.app.tar.gz"
    },
    "darwin-aarch64-app": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRh...(408 chars)",
      "url": "https://github.com/HighKnow-ai/flywheel/releases/download/v0.0.1-ci/Flywheel_aarch64.app.tar.gz"
    }
  }
}
```

The `signature` field is byte-identical to the `.sig` asset and decodes to `untrusted comment: signature from tauri secret key`; its minisign key id `AB3536BDD39983C5` equals the id of the public key compiled into `tauri.conf.json`. I checked the key id, not the cryptographic signature itself; the plugin does that on a client.

**Cleanup verified:** the release and tag are gone. `gh release list -R HighKnow-ai/flywheel` is empty, `git ls-remote --tags origin` is empty, the releases API (drafts included) has length 0, and there is no local `v0.0.*` tag. The tag was pushed and the release deleted by the same actor that committed `1882b14`, not by me (see Deviations); my own `gh release delete` returned "release not found".

D-REV-57 is closed in `DEFERRED-REVIEW.md` for what it asserted (four-asset publication), with the installed-client half recorded as not proven.

## Task Commits

1. **Task 1: `tauri-plugin-updater` at `=2.12.0`** - `9b40e87` (feat)
2. **Task 2: updater keypair** - no commit; owner action. Public key and slug are in `tauri.conf.json` via Task 3.
3. **Task 3: plugin, endpoint, refusal** - `1882b14` (feat). Committed by the coordinator, see Deviation C.

**Plan metadata:** the docs commit following this file.

## Public key, slug, backup (Task 2 acceptance record)

- **Public key (verbatim):** `dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCMzUzNkJERDM5OTgzQzUKUldURmc1blR2VFkxcTdnb0dwMHFIYWNsc1cwcFJSOXpwb3BaNjI3MDEySG5icVJxZGFaNVFzaFgK` (decodes to minisign key `RWTFg5nTvTY1q7goGp0qHaclsW0pRR9zpopZ627012HnbqRqdaZ5QshX`, id `AB3536BDD39983C5`). Identical to `~/.flywheel/updater.key.pub` apart from a trailing newline.
- **Slug:** `HighKnow-ai/flywheel`.
- **Off-machine backup:** the owner confirmed one exists for both the private key and its password. Neither is recorded here.

## Files Created/Modified

- `packages/desktop/src-tauri/src/commands/update.rs` - new: the two commands, the `UpdateSource` seam, six tests
- `packages/desktop/src-tauri/tauri.conf.json` - `plugins.updater` and `bundle.createUpdaterArtifacts`
- `packages/desktop/src-tauri/src/main.rs` - plugin registered on the builder (not in `.setup()`, where `panic = "abort"` would turn a failure into a silent crash); both commands in `generate_handler!`
- `packages/desktop/src-tauri/capabilities/default.json` - roster text only; `permissions` unchanged
- `.github/workflows/release.yml` - both signing variables in the `tauri-action` env, placeholder comment replaced
- `.github/workflows/ci.yml`, `.gitignore` - see Deviation C

## Decisions Made

See key-decisions. One clarification on the capability prose: the plan's check `grep -c "updater:"` must be `0`, so the roster sentence says "no permission from the updater plugin" instead of writing the literal prefix.

## Deviations from Plan

### Plan conflict, recorded for the coordinator

**A. [Plan conflict] The plan's keygen command does not work in this layout.** Step 1 of Task 2 says `npm --prefix packages/desktop exec -- tauri signer generate ...`. The `tauri` binary does not resolve that way here. The owner generated the keypair with `npx --yes @tauri-apps/cli signer generate --ci` instead. Anyone rotating the key should use that form.

**B. [Plan conflict] The plan said "reuse the fleet read".** It cannot be used for a safe count: `fleet_rows` is capped at 200 rows and orders `running` after `abandoned`, so a live run can fall off the end. I used `flywheel_core::dispatch::occupied_slots`, an existing function with the identical predicate, so no query was added. The intent (one derivation of "live", no new SQL) is kept.

### Auto-fixed Issues

**C. [Rule 3 - Blocking] `ci.yml` would fail on every run, and a key file could be committed by accident**
- **Found during:** Task 3, when `createUpdaterArtifacts` entered `tauri.conf.json`
- **Issue:** `ci.yml` runs `tauri build` and holds no secret (fork PRs cannot), and tauri refuses to build updater artifacts without a signing key. Separately the plan's acceptance criterion needs `git check-ignore` to confirm a key path would be ignored, and `.gitignore` had no such rule.
- **Fix:** `ci.yml`'s build passes `--config '{"bundle":{"createUpdaterArtifacts":false}}'`; `.gitignore` gains `updater.key`, `updater.password`, `*.key`.
- **How it got into the tree, stated plainly:** I did not write these two changes, and I did not make the commit that contains them. While I was verifying Task 3, another actor working in this same tree committed my staged work together with these two edits as `1882b14` ("committed by the coordinator" in the key list above; I infer the coordinator from the style, I did not see it happen). I reviewed the diff afterwards, found both changes correct and necessary, and kept them. The same actor pushed the throwaway tag and deleted the release. My own `git commit` therefore found nothing to commit.
- **Files modified:** `.github/workflows/ci.yml`, `.gitignore`
- **Commit:** `1882b14`

**Total deviations:** 2 plan conflicts, 1 auto-fixed (Rule 3). **Impact:** none widened what the plan ships beyond keeping CI buildable and keeping a key file out of git.

## Authentication Gates

Task 1 and Task 2 were `blocking-human` gates, answered by the owner (version pin; keypair, secrets and backup). The throwaway tag push was pre-authorised by the owner.

## Issues Encountered

- **CI is red on this commit, and the cause is not in this plan.** On the tag push, ci.yml run `38396587795` failed `packages/core/tests/forge_degrade.rs` (`forced_gitlab_override_with_glab_absent_from_path_yields_cli_not_installed`, line 20) and open-core.yml run `38396587714` failed `packages/core/tests/worktree_lifecycle.rs` (`a_worktree_survives_two_runs_with_an_epic`, line 100). On the branch push of the same SHA, Open core (`38396663801`) was green and ci.yml (`38396663875`) was re-run by someone else and was still in progress when I stopped looking, so its final result is **unknown to me**. The Release run, which runs the same `cargo test --workspace`, passed. This is the same family as 11-04's `authoring_lifecycle` flake, now in three distinct tests; logged in `deferred-items.md`, not investigated.
- ci.yml's changed `tauri build` line (Deviation C) was exercised only by those runs; I did not see it complete green, so it is **not proven** that the override works.

## Known Stubs

None. No placeholder text in any file this plan changed.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: renderer-reachable-plugin-commands | `packages/desktop/src-tauri/src/main.rs` | Registering `tauri_plugin_updater` also registers the plugin's own `plugin:updater\|check/download/install/download_and_install` handlers. They are reachable from the window only if a capability grants `updater:*`; none does, and `the_window_capability_grants_no_updater_permission` fails the build if one is added. |

T-11-13 to T-11-16 and T-11-SC are mitigated as the plan specified. The signing variables appear only in the `tauri-action` env.

## Next Phase Readiness

- **11-06** (the banner) can call `update_check` and `update_install` through `generate_handler!`; the refusal carries `refused` and `liveRuns` for it to display. The banner's own check is display only.
- **11-07** adds the Apple group above the `tauri-action` step, where the comment marks the spot. The updater key is separate from Apple signing.
- **11-08** needs a green `cargo test --workspace` for the real `v0.1.0` tag and may need a re-run.
- **Open, for a person with two installed builds:** install an older signed build, publish a newer one, and watch the older one update. Nothing in this plan has done that.

## Self-Check: PASSED

- `packages/desktop/src-tauri/src/commands/update.rs` exists on disk.
- Both commits present: `9b40e87`, `1882b14` (`git rev-list --count 7ef7bee..HEAD` = 2).
- `cargo test -p desktop` 149 passed; `cargo build --workspace` green.
- `grep -c "updater:"` on the capability file = 0; `updater config ok` printed by the plan's node check; `update_check` present in `main.rs`; pin count = 1.
- `gh secret list` shows both signing names; `git ls-files | grep -c updater.key` = 0.
- Throwaway release and tag absent from origin; no local tag.
