# Exit-test attempt 2, starting 2026-11-26

The owner runs this attempt. The rules are in [`docs/mvp-spec.md` section 1](../mvp-spec.md#1-purpose-and-the-one-week-exit-test): 5 working days in a 14-day window, two or more counted repositories with at least one that is not Flywheel, and no exemptions for drop-backs.

Attempt 1 lapsed. See [`2026-10-27-attempt-1.md`](2026-10-27-attempt-1.md). Tracking is the Epic "the one-week attempt", in the monorepo milestone "Flywheel M5: exit test".

Rename this file to `<start-date>-attempt-2.md` when the start date is known.

## Start conditions

Do not start before these are done:

- The end-to-end harness and the gate jobs have landed on `main`.
- The story "preflight the exit test on the monorepo layout" is closed.

Before day 1, run the preflight. It builds, checks the board DB and its backup, the counted projects, the drop-back script on the monorepo layout, the shim and the sidecar's `claude`, and prints a green/red table. It exits 1 on any red row:

```sh
node <monorepo>/flywheel/scripts/exit-test/preflight.mjs \
  --project <other counted project> --backup <copy of flywheel.db>
```

The row "drop-backs on the monorepo layout" shows two counts. They are not drop-backs. They come from a self-check: the preflight writes sample sessions in a temporary directory, in `flywheel/` and in other folders of each worktree. The first count is the sessions that the drop-back script counted in `flywheel/`. The second count is the sessions that it ignored in the other folders. The exit test counts only sessions from day 1.

It cannot run a Story in the app for you. Do that once after it is green: create a Story, let an agent work in its worktree, and merge it.

## Build under test

The newest release is older than the work on `main`, and the signed `.dmg` waits for the signing story. For attempt 2, build the app from a named commit of `main`, unsigned, on your Mac. Do it once, before the preflight and before day 1.

1. Quit Flywheel. The script refuses to run while it is open.
2. Pick the commit. Use the tip of `main`, or an older commit that has the fixes you need. Run `git fetch origin main` first.
3. From your own terminal, in the monorepo, run:

   ```sh
   node flywheel/scripts/exit-test/build-under-test.mjs --commit origin/main
   ```

   The build takes several minutes. The script does these steps in this order, and nothing else:

   - It copies the board DB, `~/Library/Application Support/Flywheel/flywheel.db`, to `~/Flywheel-backups/flywheel.db.<UTC date and time>`. It uses sqlite3's `.backup`, which is safe on an open DB. It does not change the DB.
   - It exports the commit with `git archive` into a new folder in `$TMPDIR`, so no local edit enters the build. It builds the app there with `tauri build --bundles app`, and runs `check-release-bundle.mjs`, the same refusal as the release job. It does not sign and it does not call the keychain.
   - It moves the installed `/Applications/Flywheel.app` to `~/Flywheel-backups/Flywheel.app.previous-<UTC date and time>`, and copies the new app to `/Applications/Flywheel.app`.
   - It runs `xattr -dr com.apple.quarantine /Applications/Flywheel.app`. This removes one attribute from that one app. A local build has none, so it normally does nothing. It does not change Gatekeeper or any other file.

   Pass `--applications <folder>` to install somewhere else, and `--backup-dir <folder>` to keep the backups somewhere else.
4. The script ends with four lines. Paste them here, in place of the placeholders:

- Commit: `6cb3d34f9e9801875307fcda4b98794a02915e8f` (`main`, built 2026-11-25 03:01 UTC, unsigned local build)
- Installed: `/Applications/Flywheel.app`
- Board backup: `/Users/cymarechal/Flywheel-backups/flywheel.db.20261125T030149Z`
- Previous app: `/Users/cymarechal/Flywheel-backups/Flywheel.app.previous-20261125T030149Z`

5. Run the preflight with `--backup <the Board backup path>` (see Start conditions). The preflight accepts the backup as it is.
6. Open Flywheel. macOS may show a first-run dialog for an unsigned app. If it says the app is damaged, run `xattr -cr /Applications/Flywheel.app`, as in the release note, and open it again.

### Go back to the previous build

Use this if the build under test cannot run the attempt. Quit Flywheel first. A restart after a restore starts the attempt over: the board goes back to its state at the backup, so changes made since then are lost.

```sh
node flywheel/scripts/exit-test/build-under-test.mjs restore \
  --backup <Board backup path> --previous-app <Previous app path>
```

It writes the backup over `flywheel.db` and removes the stale `-wal` and `-shm` files. It puts the previous app back in `/Applications`. It keeps what it replaced, as `flywheel.db.before-restore-<time>` and `Flywheel.app.under-test-<time>` in `~/Flywheel-backups`, so a restore deletes nothing. If you passed `--applications` or `--backup-dir` when you built, pass the same ones here.

To build a different commit, run the build command again with another `--commit`. Its backup is a new file.

Do not run an interactive `claude` session in a counted project before day 1. The drop-back script counts it.

## Counted projects

The owner declares these before day 1. Use the path of each project's main checkout, the one Flywheel registered. Flywheel is the folder `flywheel/` inside the monorepo, not the monorepo root.

- `<monorepo>/flywheel` (Flywheel)
- A second project, not Flywheel, declared by the owner on 2026-11-18. It is private, so its path is not written in this public file.

## Days

| Day | Date |
|---|---|
| 1 | 2026-11-26 |
| 2 | |
| 3 | |
| 4 | |
| 5 | |

## Drop-backs

To see the count at any time, run this from any directory. The path to the monorepo is only needed to find the script:

```sh
node <monorepo>/flywheel/scripts/exit-test/drop-backs.mjs \
  --project <monorepo>/flywheel \
  --project <path> \
  --from <first-day> --to "$(date +%F)"
```

Running the script, git, an editor or the tests does not count. Only an interactive `claude` session started in a counted project, or in one of its worktrees, counts. A session in another folder of the monorepo does not count.

When the week ends, run the script with `--to` set to the last day worked. Paste the output below. Write one reason line for each drop-back: what Flywheel could not do that sent you back to the terminal. If the script lists sessions started in a folder that no longer exists, check whether each was a removed worktree of a counted project. If it was, count it as a drop-back and say which.

```text
<script output>
```

| Session | Reason |
|---|---|
| | |

## Workarounds

A workaround is a hand edit that you made because an agent could not do the job. Count them here. They do not fail the attempt.

| Date | Project | What you edited and why the agent could not |
|---|---|---|
| | | |

Total: <n>

## Minimum work

- [ ] At least 5 Stories merged through Flywheel's review: <keys>
- [ ] At least one from each counted project: <keys per project>
- [ ] At least one Epic shaped from scratch in Flywheel and taken through to a merge: <key>

## Secondary numbers

Copy these from the "Flywheel DB" section of the script output: Gated-action prompts, Proposals filed and accepted, and sessions ended by an error or refusal.

## Outcome

Write one of these:

- **Pass**: zero drop-backs and the minimum work is met.
- **Fail**: at least one drop-back, or an early abort.
- **Invalid**: no drop-back, but the minimum work was not reached for reasons outside Flywheel.

Outcome: <Pass | Fail | Invalid>

Reason: <one line>

Issues filed for the next attempt: <links>
