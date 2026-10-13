# Phase 11 Plan 02: The three one-way calls (owner decision record)

Recorded 2026-10-12 from the owner's reply to Task 1's `blocking-human` decision checkpoint.
Plan 11-05 reads the slug from this file. Plan 11-08 reads the publication consent from this file.
Both halt without it.

## Answers, verbatim

1. **Option id: `highknow-rename`**
   - Copyright holder: **HighKnow**
   - Repository slug: **transfer to the `HighKnow-ai` org and rename to `HighKnow-ai/flywheel`** before any release. This resolves the
     Harness.io name collision named as a hard constraint in PROJECT.md.
2. **Copyright year: 2026**
3. **`publish .planning unscrubbed: yes`** - the owner explicitly confirms no file under
   `.planning/` holds a credential, API key, private endpoint, or a third party's name used
   without consent. No named exceptions.

## Values downstream plans must use

| Consumer | Value |
| -------- | ----- |
| Copyright line (`NOTICE`, LICENSE appendix usage) | `Copyright 2026 HighKnow` |
| Updater endpoint (plan 11-05, `plugins.updater.endpoints`) | `https://github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json` |
| Publication consent (plan 11-08, T-11-04) | yes, unscrubbed, no exceptions |

The updater endpoint is NOT `highknow-harness` and NOT `cymarechal/flywheel`. Both are former names
of this repository and neither may be compiled into any binary. The live slug is
`HighKnow-ai/flywheel` - see the completion note below.

## Owner action COMPLETED 2026-10-13

The owner created the `HighKnow-ai` organisation (https://github.com/HighKnow-ai) and decided the
project should live there rather than under a personal account. Executed the same day, before plan
11-05 compiled any endpoint:

- **Transferred and renamed** `cymarechal/highknow-harness` to **`HighKnow-ai/flywheel`**
  (`POST /repos/.../transfer` with `new_name=flywheel`). This resolves the Harness.io name collision
  PROJECT.md names as a hard constraint - the public name carries no "harness".
- **Made public**, on the owner's explicit decision, after a mechanical credential scan of all
  tracked files found nothing (the only pattern hit is `sk-ant-should-never-appear-anywhere`, a
  deliberate negative-test sentinel in `packages/sidecar/test/permission.test.mjs` asserting that a
  key never leaks). This also removes the Actions-minutes ceiling: a private repo on the free org
  plan gets 2,000 minutes/month billed at 10x for macOS, roughly 200 macOS-minutes, which plans
  11-08 and 11-20 would have strained. A public repo gets unlimited Actions.
- **Local `origin` updated** to `git@github.com:HighKnow-ai/flywheel.git`, fetch verified.
- **Workflows indexed: 3.** `release.yml` needed no edit - it names no owner, using
  `tauri-apps/tauri-action@v0` with `secrets.GITHUB_TOKEN`, so it followed the transfer unchanged.

Two consequences downstream plans must not be surprised by:

- **GitHub reports no licence for the repository yet** (`licenseInfo: null`). `LICENSE` and `NOTICE`
  exist on `cymarechal-devoteam/gsd-new-project-ade` but not on `main`, so GitHub's detector has not
  seen them. The repository is public now, so a visitor sees no licence badge until the branch
  merges. Not a defect in plan 11-02's work.
- **Actions secrets do not survive a transfer.** None existed (the release is unsigned by design,
  D-185), so nothing was lost. Plan 11-07 is the first plan that needs secrets, and it must set the
  notarization secrets on `HighKnow-ai/flywheel`, not on the old personal repository.

## Reversibility

Each call is one-way once a release exists in the wild: a licence grant, a published history and a
trusted endpoint URL are irrecoverable after release.
