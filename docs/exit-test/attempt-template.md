# Exit-test attempt <n>, starting <start-date>

Copy this file to `docs/exit-test/<start-date>-attempt-<n>.md` before the attempt starts, and fill in the counted projects then. The rules are in [`docs/mvp-spec.md` §1](../mvp-spec.md#1-purpose-and-the-one-week-exit-test): 5 working days within a 14-day window, two or more counted repos with at least one that isn't Flywheel, and no exemptions for drop-backs.

## Counted projects

Declared before the attempt starts. Use each repo's main checkout path, the one Flywheel registered.

- `<path>`
- `<path>`

## Days

| Day | Date |
|---|---|
| 1 | |
| 2 | |
| 3 | |
| 4 | |
| 5 | |

## Drop-backs

Run the script over the attempt's dates once the week is over (or once it is aborted):

```sh
node scripts/exit-test/drop-backs.mjs \
  --project <path> --project <path> \
  --from <first-day> --to <last-day>
```

It lists every interactive `claude` session on a counted project or one of its worktrees, and ignores Flywheel's own headless sessions. Paste its output below. Then open each listed transcript and write one reason line for each drop-back: what Flywheel couldn't do that sent you back to the terminal.

If the script lists sessions started in a directory that no longer exists, check whether each was a removed worktree of a counted project. Count it as a drop-back if it was, and say which.

```text
<script output>
```

| Session | Reason |
|---|---|
| | |

## Workarounds

A hand edit made because an agent couldn't do the job. Tallied here; it doesn't fail the attempt.

| Date | Project | What you edited and why the agent couldn't |
|---|---|---|
| | | |

Total: <n>

## Minimum work

- [ ] At least 5 Stories merged through Flywheel's review: <keys>
- [ ] At least one from each counted project: <keys per project>
- [ ] At least one Epic shaped from scratch in Flywheel and taken through to a merge: <key>

## Secondary numbers

From the script's "Flywheel DB" section: Gated-action prompts, Proposals filed and accepted, and sessions ended by an error or refusal.

## Outcome

One of **Pass** (zero drop-backs and the minimum work met), **Fail** (at least one drop-back, or an early abort), or **Invalid** (no drop-back, but the minimum work wasn't reached for reasons outside Flywheel).

Outcome: <Pass | Fail | Invalid>

Reason: <one line>

Issues filed for the next attempt: <links>
