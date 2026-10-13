---
phase: 11-ship-it
plan: 07
subsystem: macos-signing-and-notarization
tags: [distribution, gatekeeper, notarization, apple-developer, owner-declined, dist-01]
requires: ["11-04"]
provides: []
affects: [11-08 (verifies an UNSIGNED install; its Gatekeeper criterion is not met), the register (DIST-01 criterion 1)]
status: deferred
commits: 1
actuals:
  tokens: 0
  tasks: 0
  commits: 1
key-files:
  created:
    - .planning/phases/11-ship-it/11-07-SUMMARY.md
  modified: []
key-decisions:
  - "The owner declined the $99/yr Apple Developer Program purchase on 2026-10-13, so Task 1 cannot be performed and Tasks 2 and 3 cannot run. Recorded as `deferred`, NOT `halted`, deliberately: `halted` would set `blocked_by` on 11-08 and transitively strand 11-19, 11-20 and 11-21 — four of the six remaining plans, including the owner redemption pass. The owner's instruction was to ship unsigned and keep going, which is the opposite of stranding the phase."
  - "No signing configuration was written. Wiring empty `APPLE_*` secrets into `release.yml` would risk the pipeline that plans 11-04 and 11-05 proved green, for zero present benefit, since `tauri-action` cannot sign without a certificate. The config belongs in the same commit as the working secrets, whenever the account is bought."
requirements-completed: []
duration: 0 min
---

# Plan 11-07: macOS signing and notarization — DEFERRED, owner declined the purchase

**No tasks were executed. No production file was changed.** This SUMMARY exists to record an
owner decision and to keep the phase's dependency graph intact.

## What was asked and what was decided

Plan 11-07 is the one plan in Phase 11 gated on a purchase. Its own objective says so: *"This is
the one plan in the phase gated on a $99/yr purchase (D-185), and it is deliberately last."* Task 1
is `checkpoint:human-action` with `gate="blocking-human"` — enrol in the Apple Developer Program,
create a Developer ID Application certificate and an App Store Connect API key, and set six
repository secrets. Every step is the owner's; none can be automated.

Asked on 2026-10-13, the owner chose to **halt the plan and ship unsigned**, which D-185 had
already made the deliberate default.

## State verified at the time of the decision

- `security find-identity -v -p codesigning` → **0 valid identities found**.
- `gh secret list -R HighKnow-ai/flywheel` → only `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the updater keypair from plan 11-05). **No `APPLE_*`
  secret exists.**
- A free Apple account cannot notarize. This is why the plan is a purchase and not a configuration.
- Apple's identity verification typically takes 24-48 hours, so even an immediate approval could not
  have completed this plan on the same day.

## What is NOT true as a result

Stated plainly, because the phase must not imply otherwise:

- **DIST-01 criterion 1 is NOT met.** "A `.dmg` downloaded from the release is signed with a
  Developer ID Application certificate and notarized, and opening the installed application raises
  no Gatekeeper warning" is false. The `.dmg` is unsigned and un-notarized.
- A first-time user double-clicking the downloaded app **will** see a Gatekeeper warning and must
  use the right-click-Open workaround. Plan 11-08 must document that rather than pretend otherwise.
- Task 2 (signing and notarization env in `release.yml`) and Task 3 (the Gatekeeper verification
  script run against the downloaded artifact) were **not written**. There is no
  `scripts/release/verify-gatekeeper.sh`.

## Why `deferred` and not `halted`

`halted` is a load-bearing status: the phase plan index turns it into `blocked_by` on every
dependent plan. 11-08 depends on 11-07; 11-19 and 11-20 depend on 11-08; 11-21 depends on 11-08 and
on nearly everything else. Marking 11-07 `halted` would therefore have blocked 11-08, 11-19, 11-20
and 11-21 — four of the six remaining plans, including the owner redemption pass that exists to
settle exactly this kind of open item.

The owner's decision was to ship unsigned and continue, so `deferred` is the status that records
the truth without contradicting the instruction. The unmet criterion is carried in the register,
not hidden by a green checkbox.

## What happens next

- **Plan 11-08** proceeds against an **unsigned** build. Its install-from-release verification is
  still meaningful — the download, the mount, the copy to `/Applications`, the first launch — but
  its Gatekeeper criterion cannot pass and must be reported as unmet, not skipped.
- **D-REV-60** carries DIST-01 criterion 1 to the register.
- **If the account is bought later**, this plan runs as written: Task 1's six secrets, then Tasks 2
  and 3 unchanged. Nothing here forecloses it, which is why no half-finished signing config was
  committed.
