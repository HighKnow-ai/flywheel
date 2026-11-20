# A new Story worktree gets the untracked files the project lists

Decided on 2026-11-20 (issue #1844, part of #1599). `git worktree add` checks out tracked files only. A project's Checks and dev servers then fail in a new worktree for lack of `.env` or `node_modules`.

## Decision

- **The list is a file in the project: `.flywheel/worktree-include`.** One path in each line, relative to the project's folder. A `#` starts a comment. The core reads it from the project's own folder when it makes a worktree, and puts each path in the same place of the worktree's project folder.
- **A plain line is copied. A `link: path` line is linked.** A copy is for a file the Story may change alone: `.env`, a local config. A link is for a large folder that nobody edits by hand: `node_modules`, a build cache. A link costs no time and no disk for each Story. A project that wants its own install in each worktree lists no `link:` line and runs the install in a Check.
- **The list never fails a worktree.** A path that is missing, refused or cannot be placed is left out, and the `worktree.created` event names it. A path that already exists in the worktree is never overwritten. An absolute path, a `..` part and a `.git` path are refused, because the list comes from the repository.
- **A placed path is added to the repository's `info/exclude`.** A link to a folder is not matched by `node_modules/` in `.gitignore`, so without this the worktree reads dirty and Merge refuses it.
- **A failed Check shows a "Dependencies missing" line** when its output tail holds a known marker (`Cannot find module`, `command not found`, `ModuleNotFoundError` and the like). The line names the list file. It is a text match on output the run already holds. No extra run, and no claim of a cause that the output does not show.

## Rejected alternatives

- **A setting in the board database.** It needs a Settings screen, a command and a migration for a list of paths. The paths are knowledge about the code, so they belong in the repository (ADR 0002), and they travel to a second machine with a clone.
- **Copy `node_modules`.** It costs minutes and gigabytes for each Story.
- **Run the project's install command for each worktree.** A command read from the repository runs without a decision by the developer (ADR 0042). A Check or the developer runs it.
- **Probe for `package.json` without `node_modules` before the first Check.** It knows one ecosystem only, and it gives a false line when the Check does not need the install.

## Consequences

- A project that needs a file lists it once. A Story that starts after that has it.
- The list is read from the project's folder in the repository, and the file may be committed or not.
- The `link:` mode shares the project's folder. A Story that changes a linked folder changes it for the project too.
- The line can miss a failure with an unusual message, and it can show for a Check that fails for another reason with the same words. It says "?" for that reason.

## Enforced by

- `packages/core/tests/worktree_include.rs` `a_new_worktree_of_a_subdirectory_project_gets_the_listed_files_and_reads_clean`
- `packages/core/src/worktree_include.rs` `the_list_has_copy_and_link_lines_and_refuses_paths_outside_the_project`
- `packages/desktop/e2e/flows/worktree-include.spec.ts` `a Story whose Check needs untracked files gets them in its worktree and a failed install is named`
