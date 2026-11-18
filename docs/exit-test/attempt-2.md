# Exit-test attempt 2, starting <start-date>

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

- Commit: `<sha>`
- How it was installed: `<for example, the .dmg from that commit's release workflow>`
- Board backup: `<path to the copy of flywheel.db>`

Do not run an interactive `claude` session in a counted project before day 1. The drop-back script counts it.

## Counted projects

The owner declares these before day 1. Use the path of each project's main checkout, the one Flywheel registered. Flywheel is the folder `flywheel/` inside the monorepo, not the monorepo root.

- `<monorepo>/flywheel` (Flywheel)
- A second project, not Flywheel, declared by the owner on 2026-11-18. It is private, so its path is not written in this public file.

## Days

| Day | Date |
|---|---|
| 1 | |
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
