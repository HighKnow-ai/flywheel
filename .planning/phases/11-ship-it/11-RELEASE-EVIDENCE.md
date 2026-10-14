# Phase 11 Release Evidence (plan 11-08)

Recorded 2026-10-14 by the 11-08 executor. Everything below was observed by running a command,
unless it is marked INFERENCE or PENDING. Nothing here describes a deferred item as verified.

## What this release is, and is not

- `v0.1.0` is a real release on the public repository `HighKnow-ai/flywheel`. It is meant to stay.
- It is **UNSIGNED and NOT notarized by Apple**. Plan 11-07 is deferred: the owner declined the
  $99/yr Apple Developer Program purchase (D-REV-60).
- The **Tauri updater signature** (minisign key `AB3536BDD39983C5`) is a *separate* trust root. It
  proves an update payload came from the owner's key. It says nothing about Apple, Gatekeeper or
  notarization, and no line in this file uses one to claim the other.

## 1. Publication (plan Tasks 1 and 2)

**Task 1, the publication decision, was already answered before this plan ran.** The owner made the
repository public on 2026-10-13 after a mechanical credential scan, and confirmed in writing that
`.planning/` is published unscrubbed with no exceptions
(`.planning/phases/11-ship-it/11-02-OWNER-DECISION.md`). The visibility was not flipped by this plan.
The slug is `HighKnow-ai/flywheel`; a rename and transfer already happened (from
`cymarechal/highknow-harness`) before any release existed. No further rename was done.

Sweeps run on 2026-10-13 at about 23:10Z, before the first tag, over `git ls-files` at `57e0681`
(and the path and literal sweeps again over `origin/main` = `32d4019`, same result). The only commit
since is `2f6d9d0`, which touches `README.md` and one Rust test and adds no pattern match:

| Sweep | Pattern | Result |
| --- | --- | --- |
| Credential-shaped paths | `\.(p12\|p8\|key)$` and `(^\|/)\.env$` over 1290 tracked files | 0 paths |
| Secret literals, outside `.planning/` | `sk-ant-`, `ghp_`, `github_pat_`, `BEGIN [A-Z ]*PRIVATE KEY`, `AKIA[0-9A-Z]{16}` | 0 secrets. **11 pattern matches in 7 files, all inspected, all fixtures or placeholders:** `sk-ant-test-fixture-0001`, `sk-ant-test-key`, `sk-ant-bad`, `sk-ant-should-never-appear-anywhere`, `sk-ant-fake-test-key-not-real-...`, an input `placeholder="sk-ant-..."`, and two regexes that assert a key never leaks (`!/sk-ant-/.test(...)`). |
| Secret literals, inside `.planning/` (709 tracked files; not in the plan's sweep, which excludes it) | same | 4 files match, all prose describing the scan (`02-UAT.md`, `10-REVIEW.md`, `11-02-OWNER-DECISION.md`, `11-10-SUMMARY.md`) plus this plan's own file. No credential. |
| CI-held secrets | `gh secret list -R HighKnow-ai/flywheel` | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only. No `APPLE_*`. |

The plan said a sweep hit "stops this task and becomes a conversation". There were pattern matches,
no secrets, and the repository was already public by the owner's own act, so there was nothing left
to stop. The matches are listed so the owner can disagree.

Unauthenticated reads (no credential, plain `curl`), 2026-10-14T01:40Z:

| URL | HTTP |
| --- | --- |
| `raw.githubusercontent.com/HighKnow-ai/flywheel/main/LICENSE` | 200 |
| `.../main/NOTICE` | 200 |
| `.../main/README.md` | 200 |
| `github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json` (follows redirects) | 200 |

`gh repo view`: `PUBLIC`, licence `apache-2.0`.

## 2. v0.1.0 release (plan Task 3)

### It took two tags, and why

**Attempt 1: tag at `32d4019` (main's merge commit). Failed, deleted.** The `cargo test --workspace`
step of Release run `38482840978` failed in
`packages/core/tests/epic_context_packet.rs:923`
(`unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist`):

```
packages/core/src/query/authoring.rs: task_header contains a SELECT with no LIMIT and is not in ALLOWED_UNBOUNDED_SELECTS
packages/core/src/query/authoring.rs: epic_header contains a SELECT with no LIMIT and is not in ALLOWED_UNBOUNDED_SELECTS
```

This is **not** the known intermittent git-spawning flake. It is deterministic. Plan 11-22
(`c1beffc`) added the two header reads and not their allowlist entries. `main`'s own CI and Open core
runs (`38482629964`, `38482629973`) were red on the same line. A re-run could not pass. The job
had published nothing (`gh release list` empty), so the tag was deleted from origin and locally, per
the plan's instruction, and no release was left at `releases/latest`.

**Fix (`2f6d9d0`, `fix(11-08)`).** Both reads are `query_row` calls keyed by a primary key
(`WHERE id = ?1`), cardinality one by construction, the same shape `get_epic_for_agent` is already
allowlisted for. Two allowlist entries added with that reasoning. Local result: `cargo test -p core
--test epic_context_packet` 16 passed. Local full run of every core test target except
`credentials.rs` (which writes to the real Keychain and was not run): 106 test binaries, all `ok`,
none failed; `cargo test --workspace --exclude core`: all `ok`.

Because `cargo test --workspace` stops at the first failing test binary, the fix was proven by that
full local run, not only by the one test.

**Attempt 2: tag `v0.1.0` at `2f6d9d0`.** Release run `38493244716`. Attempt 1 of that run went red
in `worktree_lifecycle.rs:100` (`a_worktree_survives_two_runs_with_an_epic`), the **known** flake
family. Re-ran the failed job as instructed; attempt 2 concluded `success`. No step was skipped on
the passing attempt.

### What the tag points at, stated plainly

`2f6d9d0` is on branch `cymarechal-devoteam/gsd-new-project-ade`, **not on `main`**. Its tree is
byte-for-byte `main`'s tree (`32d4019`) plus the two files in `2f6d9d0`
(`git diff 32d4019 2f6d9d0 --stat`: `README.md`, `packages/core/tests/epic_context_packet.rs`,
10 insertions, 1 deletion). The tag therefore equals what a visitor sees on `main`, plus a test
allowlist and a README correction. **`main` itself stays red on `cargo test --workspace` and carries
the README defect until `2f6d9d0` is merged.** Merging to `main` was not done by this plan; it is
the owner's call.

### The release, as `gh release view` reported it

| Field | Value |
| --- | --- |
| Name | `Flywheel v0.1.0` |
| `isDraft` / `isPrerelease` | `false` / `false` |
| Published | 2026-10-14T01:36:12Z |
| `targetCommitish` | `2f6d9d074e24c8d164ea8db37b5aa91374e033b6` |
| URL | https://github.com/HighKnow-ai/flywheel/releases/tag/v0.1.0 |
| Body | 14,619 characters, real commit subjects |

| Asset | Bytes | sha256 (GitHub-reported digest) |
| --- | --- | --- |
| `Flywheel_0.1.0_aarch64.dmg` | 47,012,635 | `28dace70d1ed1de169f0513f3c78644700dc9672a77d9c9b9344deec156fde88` |
| `Flywheel_aarch64.app.tar.gz` | 48,118,099 | `9e2042d096a85b524cb344dfa9426e0480a4676820e5d49e8ca60a312d57b727` |
| `Flywheel_aarch64.app.tar.gz.sig` | 408 | `b24b97495008fb6ec6b75bc7f6cf0fc074d4cd8edb0246e9024c174d3172fd27` |
| `latest.json` | 16,066 | `3df5e637406645df564a5f63d5b8a5571556418ab956efe187a385289f02beaf` |

The `.dmg` downloaded unauthenticated (HTTP 200) hashed to the digest above.

### v0.1.0 updater signature, verified cryptographically

`latest.json` for `v0.1.0`: `version` `0.1.0`, platforms `darwin-aarch64` and `darwin-aarch64-app`,
each with a 408-character `signature` byte-identical to the `.sig` asset and a `url` of
`https://github.com/HighKnow-ai/flywheel/releases/download/v0.1.0/Flywheel_aarch64.app.tar.gz`.

Verified with `minisign-verify =0.2.5` (the exact crate and version `tauri-plugin-updater` locks in
`Cargo.lock`, built offline from the local registry cache, so nothing was newly installed), against the
public key compiled into `tauri.conf.json`:

```
SIGNATURE VERIFIES (48118099 bytes)
```

Control: the same tarball with one byte changed at offset 1000 gave `SIGNATURE FAILS: InvalidSignature`,
exit 1. So the check can fail and did not pass vacuously.

## 3. DIST-01 criterion 1, the Gatekeeper criterion: **NOT MET**

> "A `.dmg` downloaded from the release is signed with a Developer ID Application certificate and
> notarized, and opening the installed application raises no Gatekeeper warning."

**This is false for `v0.1.0` and is recorded as unmet.** `scripts/release/verify-gatekeeper.sh` does
not exist (plan 11-07 Task 3 was never run), so the plan's verify command for it could not run. Instead
the same questions were asked of the installed bundle directly, with no attempt to change the answer:

```
$ codesign -dv --verbose=2 /Applications/Flywheel.app
Identifier=desktop-c9fb790153c2e8ae
CodeDirectory v=20400 size=92984 flags=0x20002(adhoc,linker-signed) hashes=2902+0 location=embedded
Signature=adhoc
TeamIdentifier=not set

$ codesign --verify --deep --strict -v /Applications/Flywheel.app
/Applications/Flywheel.app: code has no resources but signature indicates they must be present

$ spctl --assess --type execute -vv /Applications/Flywheel.app
/Applications/Flywheel.app: code has no resources but signature indicates they must be present
(exit 1, assessment rejected)

$ xcrun stapler validate /Applications/Flywheel.app
Flywheel.app does not have a ticket stapled to it.
```

What this establishes: no Developer ID identity (`TeamIdentifier=not set`), no notarization ticket,
and `spctl`, the command Gatekeeper's verdict comes from, exits non-zero. The signature present is the
linker's ad-hoc one on the main executable only; it does not seal the bundle's resources, which is why
`codesign --verify` and `spctl` report "code has no resources but signature indicates they must be
present" rather than "unnotarized Developer ID".

No bypass was used. `xattr -d`, `spctl --master-disable`, and `codesign --force --deep -s -` were
**not** run on the installed bundle. The verdicts above are the unmodified artifact's.

**INFERENCE, not observed:** for a copy downloaded by a browser (which sets `com.apple.quarantine`), the
user-visible dialog is probably the "is damaged and can't be opened" form that unsigned arm64 Tauri apps
are known to show, not the milder "unidentified developer" form, and on this macOS (Darwin 25.6) the
old right-click-Open override may not be available, leaving System Settings > Privacy & Security >
"Open Anyway". The dialog was **not** observed: a `curl` download is not quarantined, and a quarantined
launch would put a modal alert on the owner's screen that cannot be dismissed safely from here ("Move
to Trash" is one of its buttons). Queued as D-REV-62.

## 4. Install, as far as it can be done without the owner

| Step | Result |
| --- | --- |
| Download `Flywheel_0.1.0_aarch64.dmg` from the release URL, unauthenticated | HTTP 200, 47,012,635 bytes, sha256 matches GitHub's digest |
| `hdiutil attach` | volume `Flywheel` containing `Flywheel.app`, an `Applications` symlink and `.VolumeIcon.icns`; image checksum verified |
| Copy `Flywheel.app` to `/Applications` (`ditto`, in place of a Finder drag) | copied |
| `hdiutil detach` | ejected |
| `defaults read /Applications/Flywheel.app/Contents/Info.plist CFBundleShortVersionString` | `0.1.0` (so `apply-tag-version.mjs` took effect in the release build) |

**A pre-existing `/Applications/Flywheel.app` was replaced.** It was modified 2026-10-14 07:31 local
(23:31Z on 2026-10-13, during this plan's run), reported `0.1.0`, was ad-hoc linker-signed, and was not
installed by this plan; its origin is unknown to me (a local build is likely). It was moved, not
deleted, to the executor's scratchpad `replaced/Flywheel.app.preexisting`
(`/private/tmp/claude-501/-Users-cymarechal-orca-workspaces-HighKnow-harness-threadfin/5b4e8b4d-fde8-47df-bd88-fd3d2f961ed0/scratchpad/replaced/`),
which is a temp directory and may be cleared. If the owner wanted that copy, it is there for now.

### First launch, as far as it was observed

**Not launched from Finder.** The plan asks for a Finder launch with every dialog recorded. A Finder
launch of this unsigned bundle is exactly the Gatekeeper interaction in section 3, which cannot be
completed or recorded without the owner (a modal alert, and possibly an administrator password for
"Open Anyway"). Queued as D-REV-62.

What was done instead, and what it proves and does not prove. The installed executable was started
directly, `HOME` pointed at an empty scratch directory so that it created a fresh database and could
not touch the owner's real `~/Library/Application Support/Flywheel`:

```
HOME=<scratch>/home /Applications/Flywheel.app/Contents/MacOS/desktop
```

- Process alive and healthy at 12 s and again at 25 s; state `SN`.
- Child process `flywheel-node` (the bundled sidecar runtime) spawned and stayed alive.
- A fresh `flywheel.db`, `-wal`, `-shm` and `runtime/` appeared under the scratch `HOME`.
- Terminated with SIGTERM; the process exited and no `flywheel-node` or `flywheel-sidecar` survived it.
- No stdout/stderr output at all.

This proves the installed bundle is a working application: it starts, creates its database and spawns
its sidecar. It does **not** prove the user-facing first launch. Starting the executable directly is
not subject to the Gatekeeper assessment that a LaunchServices launch of a quarantined copy gets, so
it cannot say anything about criterion 1, and it is not offered as such. The window's contents, the
About panel and any dialog were not seen. The sidecar's response to a `ping` was not checked.

## 5. DIST-03: a stranger's clone

Cloned `https://github.com/HighKnow-ai/flywheel.git` over HTTPS into a fresh directory, with the
credential helper disabled (no key, no token): clone succeeded, HEAD `32d4019`. Then the README's
"Building from source" commands, verbatim, in order:

```
npm --prefix packages/sidecar ci
npm --prefix packages/desktop ci
npm --prefix packages/sidecar run build:dist
cargo build --workspace
npm --prefix packages/desktop run tauri build
```

**Result: it did NOT work as documented.** The build ran 380 s on this machine (Rust and npm caches
warm, `target/` cold) and produced `Flywheel.app`, `Flywheel_0.1.0_aarch64.dmg` and
`Flywheel.app.tar.gz`, and then the last command **exited 1**:

```
A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

`tauri.conf.json` sets `bundle.createUpdaterArtifacts` (plan 11-05), and tauri refuses to finish a
build that makes updater artifacts without the signing key. A contributor does not have it. This is
the DIST-03 failure the plan warned about: a documented step that is wrong. `ci.yml` already works
around it with a `--config` override; the README never got it.

**Fix (`2f6d9d0`).** The README's last command now reads:

```
npm --prefix packages/desktop run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

and a paragraph explains why. The corrected command was then run in the same clone: **exit 0 in 226 s**
(incremental, so this is not a cold timing), producing the `.app`, the `.dmg` and the `.app.tar.gz`
under `target/release/bundle/`. One local obstacle during the re-run, not a README defect: the first
attempt's interrupted `bundle_dmg.sh` left its disk image mounted (`/Volumes/dmg.*`), which made the
second `bundle_dmg.sh` fail; detaching it fixed that. A contributor who interrupts a build can hit the
same.

Not verified: a fully cold run of the *corrected* command from an empty `target/` (the corrected
command ran against the tree the failed one had already built). The `v0.1.0` tag carries the corrected
README. The stranger clone tested `main`, which still has the old README.

<!-- gsd:write-continue -->
