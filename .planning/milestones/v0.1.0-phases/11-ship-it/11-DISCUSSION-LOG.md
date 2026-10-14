# Phase 11: Ship It - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-12
**Phase:** 11-Ship It
**Areas discussed:** Pre-flight (Apple account, matched todos), Release pipeline & signing, Update channel, Deferred-review drain, Open-core proof & public repo, Register owner-decisions

---

## Pre-flight

### Apple Developer account

| Option | Description | Selected |
|--------|-------------|----------|
| Not bought yet | $99/yr still to purchase; DIST-01 blocked until it exists | ✓ |
| Have it, not set up here | Account exists, cert/API key not on this machine or in CI | |
| Fully set up elsewhere | Cert + App Store Connect key already provisioned | |

**User's choice:** Not bought yet.
**Notes:** Independently confirmed — `security find-identity -v -p codesigning` reports 0 valid
identities and there is no `~/.tauri` key material. Drove D-185.

### The 10 matched pending todos

| Option | Description | Selected |
|--------|-------------|----------|
| Leave them as board issues | Phase 11 stays distribution + register redemption; drain later through Flywheel | ✓ |
| Fold the 2 security-ish ones | href-scheme validation and the SQL `format!` item ride along | |
| Fold all 10 | Phase 11 becomes ship + full quality drain | |

**User's choice:** Leave them as board issues.
**Notes:** Consistent with the standing ship-first position. All ten are itemised in CONTEXT.md's
`<deferred>` so nothing is lost.

---

## Release pipeline & signing

### Where the signed build is produced

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions, macOS runner | Release workflow on tag push; cert / notarization key / ed25519 key in repo secrets. Also makes DIST-03 continuously true | ✓ |
| Local on your Mac, scripted | One `npm run release` off the keychain; fastest, but nothing verifies the repo builds elsewhere | |
| Both — CI builds, you sign | CI proves clean-clone build, signing stays local; avoids putting the cert in GitHub | |

**User's choice:** GitHub Actions, macOS runner.
**Notes:** No `.github/` exists today — the workflow is greenfield.

### Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| arm64 only | One target, matches the only machine that runs it | ✓ |
| Universal (arm64 + x86_64) | Both in one bundle; doubles build time and needs a second sidecar triple | |

**User's choice:** arm64 only.

### Handling the unbought Apple account

| Option | Description | Selected |
|--------|-------------|----------|
| Build the whole pipeline unsigned-first | Everything lands and is verified against an ad-hoc-signed build; signing is a final gated plan | ✓ |
| Buy it first, then plan | Phase stops until the account is live | |
| Skip signing entirely for MVP | Ship with a right-click-Open workaround; knowingly fails criterion 1 | |

**User's choice:** Build the whole pipeline unsigned-first.
**Notes:** Only DIST-01 waits on the purchase. One plan carries a `checkpoint:human-action`.

### Release trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Git tag push (`v0.1.0`) | Tag is the single source of version, changelog, bundle version and manifest | ✓ |
| Manual workflow dispatch | Press the button, type the version; easier to debug, easier to desync | |
| You decide | Defer to planning | |

**User's choice:** Git tag push.

---

## Update channel (DIST-02)

### Manifest hosting

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Releases asset | `releases/latest/download/latest.json`; zero infrastructure, and the OSS app talks to github.com not to HighKnow | ✓ |
| A HighKnow-hosted endpoint | Enables staged rollout, but the OSS app phones home to commercial infrastructure | |
| GitHub Pages in-repo | Static manifest on a gh-pages branch; same substance, one more moving part | |

**User's choice:** GitHub Releases asset.
**Notes:** Chosen partly because it keeps DIST-04 honest. `tauri-plugin-updater` is not yet a
dependency.

### How an update is presented

| Option | Description | Selected |
|--------|-------------|----------|
| Banner you accept, installs on relaunch | Check on launch + periodically; version and changes named; user clicks Update | ✓ |
| Silent download, auto-apply on quit | No prompt; least friction, no way to decline a bad release | |
| Manual check in Settings only | Opt-in only, which criterion 2's "is offered" does not describe | |

**User's choice:** Banner you accept, installs on relaunch.

### Updating while agents are running

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse to apply, say why | Stages but will not restart while any run is live; banner names the count | ✓ |
| Apply on next quit, no special case | Rely on the existing shutdown path | |
| You decide | Let planning check Phase 3's shutdown guarantees | |

**User's choice:** Refuse to apply, say why.
**Notes:** Same invariant Phase 3 bought; reuses Phase 10's fleet live-run read.

### Download artifact

| Option | Description | Selected |
|--------|-------------|----------|
| `.dmg` to install, `.app.tar.gz` to update | Familiar drag-to-Applications plus the tarball the updater requires | ✓ |
| `.app.tar.gz` only | One artifact; less conventional, likely to run from ~/Downloads | |

**User's choice:** `.dmg` + `.app.tar.gz`.

---

## Deferred-review drain

### Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All of it, in one pass | Automate every `automatable: YES`, then one owner sitting. ~41 automatable items — larger than the shipping work | ✓ |
| Triage first, then drain the gate | Ship-blocking items in Phase 11, the rest become board issues | |
| Only items an installed build unlocks | Smallest phase; leaves ~35 automatable items unverified | |

**User's choice:** All of it, in one pass.
**Notes:** Chosen *against* the recommended smaller option — the October commitment is honoured in
full. Planning must size the phase accordingly.

### The 5 owner-decision items

| Option | Description | Selected |
|--------|-------------|----------|
| One sitting, before planning executes | They are requirements/design calls that change what gets built; answering late means rework | ✓ |
| One sitting, at the end against the build | The register's own protocol; better context for aesthetics, risks rework on the contract calls | |
| Split: contract calls now, taste calls later | D-REV-01/28/29 up front, aesthetics against the build | |

**User's choice:** One sitting, before planning executes — answered in this session (see below).

### Where survivors go

| Option | Description | Selected |
|--------|-------------|----------|
| Into Flywheel as board issues | Dogfood; the only thing that makes the v1 success metric concrete | ✓ |
| Stay in DEFERRED-REVIEW.md | No tooling change, re-opens the holding pen | |
| GitHub issues on the public repo | Fine for bugs, wrong for aesthetic judgements | |

**User's choice:** Into Flywheel as board issues.

### Does the drain gate the tag?

| Option | Description | Selected |
|--------|-------------|----------|
| No — tag ships, drain follows | Only ordering that makes D-REV-20/22/36/52/53 answerable at all | ✓ |
| Yes — nothing tags until the register closes | Strictest reading, but circular | |

**User's choice:** No — tag ships, drain follows.
**Notes:** Taken together with "all of it, in one pass": ship first, then drain completely.

---

## Open-core proof & public repo

### Does the repo go public?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, with `.planning/` included | All 663 tracked files; the planning record is the methodology made legible | ✓ |
| Yes, `.planning/` stripped first | History rewrite; breaks every doc path citing `.planning/` | |
| Not yet — ship the binary, repo stays private | Defers the open-source commitment | |

**User's choice:** Yes, with `.planning/` included.

### License

| Option | Description | Selected |
|--------|-------------|----------|
| Apache-2.0 | Standard for developer tooling, explicit patent grant, no constraint on the commercial relay | ✓ |
| MIT | Shortest, most permissive, no patent grant | |
| AGPL-3.0 | Protects the relay from a hosted clone; chills adoption of a desktop app | |

**User's choice:** Apache-2.0.
**Notes:** No `LICENSE` file exists in the repository today.

### The committed sidecar binary

| Option | Description | Selected |
|--------|-------------|----------|
| Build it, stop committing it | Compiles as part of the documented build; binary leaves the repo and enters .gitignore | ✓ |
| Keep committing it, document why | Fewest moving parts; asks a stranger to trust an unreproducible blob | |
| You decide | Let planning inspect how it is produced | |

**User's choice:** Build it, stop committing it.
**Notes:** Surfaced during scouting — `binaries/flywheel-sidecar-aarch64-apple-darwin` is tracked
in git, which made criterion 3 a half-truth.

### How DIST-04 is proven

| Option | Description | Selected |
|--------|-------------|----------|
| A build with `relay-client` deleted | CI builds the workspace without it and runs the full suite; makes the seam a compile-time fact | ✓ |
| Offline run + no-auth audit | Proves behaviour, not structure | |
| Both | Two checks, more phase weight | |

**User's choice:** A build with `relay-client` deleted.

---

## Register owner-decisions

### D-REV-01 — AGNT-07 vs the shipped refusal

| Option | Description | Selected |
|--------|-------------|----------|
| Narrow AGNT-07 to match the refusal | The requirement is the side that is wrong; rewording costs a sentence | ✓ |
| Make the hook defer to the shim's socket | Keeps AGNT-07 literally true; real work in the subsystem that has bricked the product once | |
| Both — refuse by default, ask when a socket exists | Most faithful to intent, largest surface | |

**User's choice:** Narrow AGNT-07 to match the refusal. → **D-197**

### D-REV-13 + D-REV-30 — the 01-UI-SPEC amendment family

| Option | Description | Selected |
|--------|-------------|----------|
| Amend the spec to match the product | Blank 0/0 and no-priority tails, new Done copy becomes contract, type-micro to 11px, key alignment unchanged | ✓ |
| Keep the contract, change the product | Preserves Phase 1's authority, undoes reviewer-driven improvements | |
| Amend copy only, leave density alone | Only the Done warning is reconciled; spec stays stale on the rest | |

**User's choice:** Amend the spec to match the product. → **D-198**

### D-REV-28 — brand colour use

| Option | Description | Selected |
|--------|-------------|----------|
| Widen the rule, fix the anchor widget | Permitted list gains text links, run status, authoring stage; the 2px brand side-border becomes a neutral control edge | ✓ |
| Hold the rule, move everything to ink | Strongest brand discipline, touches five surfaces | |
| You decide at planning | Inventory every consumer first | |

**User's choice:** Widen the rule, fix the anchor widget. → **D-199**

### D-REV-29 — removing a project

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-hide, reversible | Hidden flag; board, worktrees and history stay in SQLite and can be restored | ✓ |
| Hard delete with confirmation | Reclaims space, contradicts "nothing lost" | |
| Soft-hide now, purge later | Defers the part that contradicts the promise | |

**User's choice:** Soft-hide, reversible. → **D-200**

---

## Claude's Discretion

Nothing was answered "you decide". Within the locked decisions, planning owns the workflow file
layout and action versions, `pkg` vs `nexe` for the sidecar binary, the update-check interval,
changelog generation, the shape of the `relay-client`-deleted CI job, and the batching order of the
~41 automatable register items.

## Deferred Ideas

- Universal / Intel builds, Windows and Linux bundles.
- Homebrew cask or any channel beyond GitHub Releases.
- Staged rollout / release channels (foreclosed by D-186's choice of a static manifest).
- Marketing site, landing page, screenshots, README-as-front-door polish — offered as a discussion
  area and declined.
- D-REV-25's junk `test` epic (181 tasks, no criteria) — offered as a discussion area and declined;
  it becomes a Flywheel board issue per D-196.
- A real purge for hidden projects — deliberately unbuilt, not merely deferred.
- All ten matched pending todos (itemised in CONTEXT.md `<deferred>`).

### Discovered during this discussion, not a user idea

- **`ARCHITECTURE.md` does not exist** although `packages/relay-client/README.md` cites it as §8
  "Open-Core Module Boundary". Recorded in CONTEXT.md as a live DIST-03 gap for planning to close.
