---
phase: 11-ship-it
plan: 02
subsystem: distribution
tags: [license, apache-2.0, architecture, open-core, owner-decision]
requires: []
provides:
  - "Owner decision record: copyright, repository slug, publication consent"
  - "Verbatim Apache-2.0 LICENSE and NOTICE at the repository root"
  - "ARCHITECTURE.md sections 1-8, including the Open-Core Module Boundary anchor"
affects: [11-03, 11-05, 11-08]
tech-stack:
  added: []
  patterns:
    - "Open-core boundary written as checkable claims that a CI job (open-core.yml) turns into a gate"
key-files:
  created:
    - LICENSE
    - NOTICE
    - ARCHITECTURE.md
    - .planning/phases/11-ship-it/11-02-OWNER-DECISION.md
  modified: []
key-decisions:
  - "Option highknow-rename: copyright HighKnow, year 2026, repository to be renamed cymarechal/flywheel before any release"
  - "Updater endpoint slug for plan 11-05 is cymarechal/flywheel, not highknow-harness"
  - ".planning/ is published unscrubbed; the owner confirmed no credential, key, private endpoint or unconsented third-party name sits in it, with no exceptions"
requirements-completed: [DIST-03, DIST-04]
duration: ~15 min
completed: 2026-10-12
status: complete
commits: 3
plan_head_before: 647c950068d3ae5b07b578a64f74f00656cc8f7b
actuals:
  tokens: 6500
  tasks: 3
  commits: 3
coverage:
  - deliverable: "Apache-2.0 LICENSE verbatim, with NOTICE naming Flywheel, the holder and the bundled Node.js runtime"
    human_judgment: false
    verification:
      - kind: command
        ref: "grep 'Version 2.0, January 2004' LICENSE; grep appendix heading; wc -c LICENSE = 11358; grep Flywheel and node in NOTICE"
        status: pass
  - deliverable: "ARCHITECTURE.md sections 1-8 with the Open-Core Module Boundary anchor, both relay-client citations resolving"
    human_judgment: false
    verification:
      - kind: command
        ref: "grep -n 'Open-Core Module Boundary' ARCHITECTURE.md; heading count >= 8; grep ARCHITECTURE.md in relay-client README.md and Cargo.toml"
        status: pass
  - deliverable: "The three one-way calls on record"
    human_judgment: false
    verification:
      - kind: command
        ref: ".planning/phases/11-ship-it/11-02-OWNER-DECISION.md exists and carries the verbatim answers"
        status: pass
---

# Phase 11 Plan 02: Licence, architecture document and the three one-way calls Summary

The repository now carries the verbatim Apache-2.0 text with a NOTICE for HighKnow and the bundled Node.js runtime, an `ARCHITECTURE.md` whose section 8 is the document `packages/relay-client` cites, and the owner's three irreversible decisions on record.

## Owner decisions (Task 1), verbatim

Plan 11-05 reads the slug and plan 11-08 reads the publication consent from here. The same text is in `.planning/phases/11-ship-it/11-02-OWNER-DECISION.md`.

1. **Option id: `highknow-rename`**
   - Copyright holder: **HighKnow**
   - Repository slug: **rename to `cymarechal/flywheel`** before any release. This resolves the Harness.io name collision named as a hard constraint in PROJECT.md.
2. **Copyright year: 2026**
3. **`publish .planning unscrubbed: yes`** - the owner explicitly confirms no file under `.planning/` holds a credential, API key, private endpoint, or a third party's name used without consent. No named exceptions.

### Consequences for downstream plans

- **Plan 11-05:** the updater endpoint slug is **`cymarechal/flywheel`**, so the endpoint is `https://github.com/cymarechal/flywheel/releases/latest/download/latest.json`. It is NOT the current `highknow-harness`.
- **Hard prerequisite before plan 11-08 (and before any release): the `gh repo rename` is a pending owner action.** The repository is still `cymarechal/highknow-harness` and still private. This plan did not run `gh repo rename` or any other GitHub mutation. Until the owner renames it, the URL plan 11-05 compiles in points at a repository that does not exist under that name.
- **Plan 11-08:** publication consent is "yes, unscrubbed, no exceptions". Its pattern sweep still runs, because a sweep catches what consent cannot see.

## What was built

- `LICENSE`: the canonical Apache-2.0 text, 11,358 bytes, fetched from apache.org, with the appendix `[yyyy] [name of copyright owner]` placeholders left intact.
- `NOTICE`: `Flywheel`, `Copyright 2026 HighKnow`, and one line attributing the redistributed Node.js runtime (plan 11-01 stages it).
- `ARCHITECTURE.md`: sections 1-7 describe the tree as it is (process topology, workspace members with `packages/sidecar` stated as not a Cargo member, single database owner, event log, single IPC seam, supervision and shim, packaging). Section 8 states the open-core boundary as checkable claims and names `.github/workflows/open-core.yml`, which plan 11-03 creates, as the gate.
- `packages/relay-client/README.md` line 3 and the `Cargo.toml` `description` already cited `ARCHITECTURE.md` section 8 with the exact anchor text, so they needed no edit. They now resolve. Section 8 links forward to the crate README.

## Deviations from Plan

None - plan executed exactly as written. Task 1 was resolved by the owner's answer rather than by the executor; the continuation executor wrote the record.

One accuracy note, not a deviation: the plan said the only mention of the crate outside its directory is the `members` line. That holds for manifests, but `Cargo.lock` (derived from `members`) and the root `README.md` layout block also name it. Section 8 states the claim at manifest level and says so, so plan 11-03's gate is not asked to prove a falsehood.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- LICENSE, NOTICE, ARCHITECTURE.md and 11-02-OWNER-DECISION.md exist on disk.
- Commits 16b27b9, bbe5f5e and 8ae166a exist.
- All task `<verify>` commands and acceptance criteria pass. No source file gained an SPDX header.
