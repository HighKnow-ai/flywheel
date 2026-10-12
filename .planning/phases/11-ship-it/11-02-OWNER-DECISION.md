# Phase 11 Plan 02: The three one-way calls (owner decision record)

Recorded 2026-10-12 from the owner's reply to Task 1's `blocking-human` decision checkpoint.
Plan 11-05 reads the slug from this file. Plan 11-08 reads the publication consent from this file.
Both halt without it.

## Answers, verbatim

1. **Option id: `highknow-rename`**
   - Copyright holder: **HighKnow**
   - Repository slug: **rename to `cymarechal/flywheel`** before any release. This resolves the
     Harness.io name collision named as a hard constraint in PROJECT.md.
2. **Copyright year: 2026**
3. **`publish .planning unscrubbed: yes`** - the owner explicitly confirms no file under
   `.planning/` holds a credential, API key, private endpoint, or a third party's name used
   without consent. No named exceptions.

## Values downstream plans must use

| Consumer | Value |
| -------- | ----- |
| Copyright line (`NOTICE`, LICENSE appendix usage) | `Copyright 2026 HighKnow` |
| Updater endpoint (plan 11-05, `plugins.updater.endpoints`) | `https://github.com/cymarechal/flywheel/releases/latest/download/latest.json` |
| Publication consent (plan 11-08, T-11-04) | yes, unscrubbed, no exceptions |

The updater endpoint is NOT `highknow-harness`. That slug is the current name of the repository and
must not be compiled into any binary.

## Pending owner action (hard prerequisite for plan 11-08)

The repository is still `cymarechal/highknow-harness` and still private. The rename to
`cymarechal/flywheel` has NOT happened. It is outside this plan's scope and no GitHub mutation was
made while executing it. The owner must run the rename (`gh repo rename flywheel` from the
repository, or the GitHub settings page) before the first release, and therefore before plan 11-08
publishes anything. Until the rename happens, the compiled updater URL in plan 11-05 points at a
repository that does not yet exist under that name.

## Reversibility

Each call is one-way once a release exists in the wild: a licence grant, a published history and a
trusted endpoint URL are irrecoverable after release.
