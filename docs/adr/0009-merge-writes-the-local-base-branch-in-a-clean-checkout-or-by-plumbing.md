# Merge writes the local base branch, in a clean checkout or by plumbing, and never pushes

Decided by Claude under Cyril's delegation in [Merge an In review Story for real from its review card](https://github.com/HighKnow-ai/flywheel/issues/155). Relates to ADR-0002. Clicking Merge writes a `--no-ff` merge commit (the base branch's tip first, the Story branch second) on the project's **local** base branch. Merged means that commit is on the local base branch and the worktree is removed. Flywheel never pushes. How the commit is written depends on the developer's own checkout of the base branch, found with `git worktree list --porcelain`:

- **Checked out and clean** (no tracked file changed): `git merge --no-ff` runs in that checkout, so its working tree, index and commit hooks see the merge exactly as a hand merge. A failure is aborted and proved clean (`git::merge_no_ff`).
- **Checked out but dirty**: Merge refuses and names the changed files. Flywheel never stashes, commits or merges over the developer's uncommitted work.
- **Not checked out anywhere**: the same two-parent commit is built with plumbing (`merge-tree --write-tree`, `commit-tree`, then `update-ref` with the old tip as a compare-and-swap). No working tree or index is touched, and no hook runs (`git::merge_without_checkout`).

We rejected pushing the branch and merging with `gh pr merge`. It needs a remote, a forge and its credentials. It makes the OSS desktop app depend on a network service, and it turns Merge into an outward act that can't be taken back locally. Pushing stays the developer's own step. We also rejected always merging in the developer's main checkout, switching branches if needed. That moves the developer's HEAD and working tree under them, and it fails whenever they have work in progress on another branch.

## Consequences

- A conflict is found before anything is written (`git::merge_tree_check`). Merge refuses, naming the paths, and the Story stays In review, which is "rebase needed" (spec §2).
- In the plumbing case, `update-ref` refuses if the base branch moved after its tip was read, so a commit made meanwhile is never lost. The commit-msg and pre-merge-commit hooks don't run on that path. Review is the safety boundary (ADR-0001), not the hooks.
- The Story branch is deleted only when its tip is contained in the base branch, with a compare-and-swap delete on that tip. This is the safety of `git branch -d`, which can't be used itself: it checks the main checkout's HEAD, and in the plumbing case HEAD is not the base branch.
- Once the commit is on the base branch the Story is Merged, even if removing the worktree or the branch then fails. That failure is reported and left to the worktree reclaim. Retrying Merge would write a second merge commit.
- Repo knowledge still reaches the repo only through a Story's worktree, review and merge (ADR-0002). This decision only settles which checkout the merge commit is written through.
