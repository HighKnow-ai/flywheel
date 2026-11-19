# Merge lands by pull request by default, by a landing command when the project names one, and locally only without a forge

Decided by Cyril on 2026-11-18, on the issue "Merge in a pull-request-only repository lands by pull request, not on the local base branch". It amends ADR-0009: the local merge of ADR-0009 stays, but it is now the third route and no longer the only one.

A repository that takes changes by pull request only leaves a local merge commit that no one can push. Merge now has a **landing mode** for each project. Merge takes the same refusals in every mode (a live session, an unaccepted criterion, a held ADR, a dirty worktree, a failing Check). Only the git step changes.

## The three routes

- **Pull request (the default).** Merge pushes the Story's branch to `origin`, opens a pull request with `gh` (a merge request with `glab` on GitLab) and turns auto-merge on. The Story moves to **Landing**. The forge is found from the URL of `origin`: `github.com` is GitHub, `gitlab.com` is GitLab. An SSH URL (`git@host:path`, `ssh://`) and an HTTPS URL are both read. A project setting `forge` names the forge for any other host, for example a self-hosted GitLab.
- **Landing command.** A project that sets `landing.mode` to `command` names a shell command, for example `pnpm hk land`. Merge runs it in the Story's worktree in place of the local merge. Flywheel sets `FLYWHEEL_STORY_KEY`, `FLYWHEEL_STORY_BRANCH` and `FLYWHEEL_BASE_BRANCH`. A zero exit moves the Story to Landing when the project has a forge, and to Merged when it has none. A non-zero exit leaves the Story In review and shows the exit status and the last line of output.
- **Local merge (ADR-0009).** A project in pull request mode with no remote, or a remote on no known forge and no `forge` setting, keeps the local `--no-ff` merge unchanged.

## Landing

Landing is a Story state between In review and Merged. The worktree and the branch stay, and the review stays open. A `landings` row holds the forge, the request URL, the request's last state and one note for the developer.

Flywheel learns that the request merged by asking the forge. The cold tick of the git-truth scheduler runs `gh pr view <branch> --json state,url` (`glab mr view <branch> --output json` on GitLab) for each Landing Story, with the connection released while the CLI runs (ADR-0024). A "Check now" command asks the same question at once. No new daemon is added. The answer is the request's own state: `MERGED`, `CLOSED` or `OPEN` (`merged`, `closed` or `opened` on GitLab). It is never an ancestry test: a squash or rebase merge leaves the branch's commits off the base branch.

- **Merged:** the Story moves to Merged by the system actor. The worktree is removed. The local branch is deleted by compare-and-swap on its tip, without the ancestry check of ADR-0009. The new ADRs are linked as at a local merge. The `story.merged` event has the method `pull_request`.
- **Closed without merging:** the Story returns to In review with the note "The pull request was closed without merging." The developer merges again, which opens a new request, or requests changes.
- **Open:** nothing changes.

## Failures

A failure is always a Story error the developer can act on. Flywheel never falls back to the local merge on a failure, because that would write the commit the repository cannot take.

- `gh` is not on `PATH`: "Landing needs the GitHub CLI (`gh`). Install it, then merge again."
- `gh auth status` fails: "The GitHub CLI is not signed in. Run `gh auth login`, then merge again."
- The push is refused: the Story stays In review with git's refusal in words, never its raw output.
- `glab` is missing or not signed in: the same two refusals, naming `glab` and GitLab.
- Auto-merge cannot be turned on: the request stays open and the note says so, on both forges.
- During polling, a missing or signed-out CLI keeps the Story in Landing and sets the note. The next tick tries again.

## GitLab

Flywheel runs `glab mr create --source-branch B --target-branch T --title ... --description ... --yes` and then `glab mr merge B --auto-merge --squash --yes`. `--rebase` replaces `--squash` for the `rebase` method, and the `merge` method gives neither flag. `--auto-merge` merges when the pipeline succeeds. If `glab mr view` finds no request for a branch, Flywheel asks `glab mr list --source-branch B --all --output json`, because a closed or merged request may not show by branch. Flywheel sets `GITLAB_HOST` to the host of `origin`, so a self-hosted GitLab named by the `forge` setting is reached. These calls are pinned by a stub `glab` in the tests and not yet measured against a real `glab`.

## The setting

The setting is four columns on `projects`: `landing_mode` (`pull_request` or `command`, default `pull_request`), `landing_command`, `forge` (`github`, `gitlab` or empty for "detect") and `landing_method` (`squash`, `merge` or `rebase`, default `squash`; it is the `--auto` flag's method). The developer changes it in the project's menu, "Landing…". It is not a file in the repository, so a cloned repository cannot name a command that Flywheel then runs.

We rejected:

- **A file `.flywheel/project.json`.** A command read from the repository runs on a developer's machine without a decision by the developer.
- **Detecting a merge by ancestry.** It fails for squash and rebase merges.
- **A watcher process for requests.** The cold tick already runs each minute, and the answer is not time-critical.
- **Falling back to the local merge on a missing CLI.** It hides the problem and leaves a commit that cannot be pushed.

## Consequences

- A merged Story may wait minutes in Landing. The Epic is not Done until the request merges.
- Dropping a Landing Story does not close the request on the forge. The Drop dialog and the Story's landing note say that the request can still merge.
- A Story that landed by a command, with no request on the forge, is Merged when its head is on `origin/<base>`. After one hour with neither, it carries a note and reaches the needs-you list.
- A Landing Story with a failure note reaches the needs-you list. The merge commit of a request is the one the forge names, and the branch tip only when it names none.
- ADR-0009's rejection of `gh pr merge` no longer holds for projects with a forge. Flywheel still never pushes in the local route.

## Enforced by

- `packages/core/tests/story_landing.rs` `the_route_follows_the_setting_and_the_url_of_origin` `merge_pushes_the_branch_opens_a_request_with_auto_merge_and_the_story_is_landing`
