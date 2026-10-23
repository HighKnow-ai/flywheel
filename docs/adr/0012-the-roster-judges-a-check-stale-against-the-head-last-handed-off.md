# The roster judges a Check stale against the head last handed off, not against git

Decided by Claude under Cyril's delegation in [Roster rows from one core read](https://github.com/HighKnow-ai/flywheel/issues/159). Relates to ADR-0009. A roster row shows "criteria x/y", where x counts the criteria the developer accepted, or whose Check passed and is not stale. Every row is read by one SQL statement (`query::roster::roster_rows`), so stale can't be judged against the branch head the way the Story view and the review card judge it (`domain::check::branch_head`, a `git rev-parse` in the Story's worktree). The roster judges it against the head the Story last handed off instead: its latest review's `head_sha`. A passed result that ran against another commit is stale. With no review yet, no head is known, and the result is not stale, as `CurrentResult::is_stale` already treats an unreadable head.

This holds because Flywheel records a Check run only at hand-off (`domain::handoff`), against the commit it hands off, in the same transaction that opens the review with that commit as its `head_sha`. So, for a Story In review or Merged, the head last handed off is the head its results ran against. It is also the head the branch is at, unless someone commits on it outside a session.

We rejected reading each Story's branch head from git on every roster read. That is one `git rev-parse` per Story with a worktree, run on every `board:changed`, which fires many times a minute while agents work. It also puts git, and a slow disk or a missing worktree, in the path of the board's most-read query. We also rejected passing the heads into the statement as a parameter. It keeps one statement but still needs the git reads, plus a second query to find which Stories have worktrees.

## Consequences

- A commit made on an In review Story's branch outside a session isn't seen as making its results stale on the roster until the next hand-off. The review card and Merge still read the live head, so Merge still counts such a result as failing.
- A Story sent back to Running keeps counting the Checks that passed at its last hand-off until it hands off again, though its branch may have moved since. The count is how far the Story was last judged done, not a live test result.
- The roster query reads no worktree and runs no process: it is literal SQL over indexes only, checked by `the_roster_query_walks_indexes_only`.
