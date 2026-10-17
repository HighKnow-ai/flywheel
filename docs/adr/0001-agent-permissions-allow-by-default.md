# Agent permissions: allow by default inside the worktree

Decided in [How are agent permissions gated in the MVP?](https://github.com/HighKnow-ai/flywheel/issues/15). A Story agent may do anything inside its own worktree without asking. Only a short list of **Gated actions** asks the developer: anything that leaves the worktree or can't be undone, such as `git push`, deleting other branches or worktrees, `reset --hard`, `clean -f`, rewriting history off the Story's own branch, recursive `rm` outside the worktree, and publishing commands. A Gated action is asked every time and is never covered by a remembered rule. Shaping sessions are read-only and never ask.

The gate defends against a cooperative agent's accidents, not against a hostile agent. Review and merge are the real safety boundary, and the worktree is disposable. We gave up the bypass-proof design (a PreToolUse hook that refused any command the shim could not provably intercept, documented in `docs/destructive-gate-trust-boundary.md`) because, together with a fail-closed classifier, it produced 61 approvals in 46 minutes and drove the developer back to a terminal. That fails the MVP's exit test outright.

## Consequences

- The shim's classifier becomes a deny-list. Unknown git subcommands are allowed, and the `uncategorized` category is removed.
- A remembered rule is keyed by project, tool and command pattern, not by whole tool name.
- Flywheel picks the Claude Code permission mode for each session kind. The per-run mode picker is removed.
- Hardening against an adversarial agent (sandboxing, a path fence for Bash) can come back later as a separate decision, without undoing this one.
