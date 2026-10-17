# Flywheel MVP spec

This spec is the plan of record for the Flywheel MVP. It replaces `.planning/` (archived at the git tag `planning-archive`) and the v0.2.0 roadmap. It was written from the wayfinder map [Wayfinder: rework Flywheel's plan into an MVP](https://github.com/HighKnow-ai/flywheel/issues/4), and each section cites the tickets its decisions came from. Once this file is merged, it wins over those tickets wherever they disagree. A change to a decision is a PR to this file.

The backlog that builds it lives in GitHub Issues on `HighKnow-ai/flywheel`, in GitHub Milestones named after the Milestones in [section 10](#10-milestones). Read `GLOSSARY.md` first: every term in bold below is defined there, and code identifiers follow it exactly.

## 1. Purpose and the one-week exit test

Flywheel is a project board where one Developer shapes work with AI agents and has them carry it out. v0.1.0 wasn't usable: shaping in the app was worse than in a terminal, work ended up without Acceptance criteria, and the board didn't show a clear status. A walk of one real Epic through v0.1 was abandoned during execution, after 61 permission approvals, with review and merge never reached. The agent's thinking was strong. The surfaces and the plumbing between stages failed. ([Walk one real epic through the current build and log every blocker](https://github.com/HighKnow-ai/flywheel/issues/7))

The MVP is the whole model at minimum depth: every record type exists, each with the simplest challenge flow that works. One user (Cyril) plays every role.

**The MVP's exit test:** Cyril runs one week of real work across his own projects from Flywheel without dropping back to a bare Claude Code terminal. ([What does the one-week exit test count, and how is it logged?](https://github.com/HighKnow-ai/flywheel/issues/9))

- **Drop-back:** any interactive `claude` session on a counted project. It is detected as a transcript under `~/.claude/projects/` with `"entrypoint": "cli"` and a `cwd` inside a counted project or one of its worktrees. Flywheel's headless sessions record `"sdk-cli"` and don't count. Editors, git commands, running tests and quick hand edits don't count either.
- **Counted projects:** declared before the attempt starts. Two or more repos, at least one of them not Flywheel.
- **Week:** 5 working days within a 14-day window.
- **Minimum work:** at least 5 Stories merged through Flywheel's review, at least one from each counted project, and at least one Epic shaped from scratch in Flywheel and taken through to a merge.
- **Outcomes:**
  - **Pass**: zero drop-backs and the minimum work met.
  - **Fail**: at least one drop-back, with no exemptions. The reasons become issues to fix before the next attempt.
  - **Invalid**: no drop-back, but the minimum work wasn't reached for reasons outside Flywheel.

  Every attempt is a fresh 5 days. After a drop-back the attempt keeps going so the rest of the week still turns up blockers. An early abort is a fail, recorded with its reason.
- **Workaround:** a hand edit made because an agent couldn't do the job. Tallied and reported, but it doesn't fail the attempt.
- **Logging:**
  - A script in `scripts/exit-test/`, outside the app bundle, lists the `cli` transcripts for the counted projects over the attempt's dates.
  - Cyril writes one reason line per drop-back and the workaround tally in `docs/exit-test/<start-date>-attempt-<n>.md`.
  - The script also reads Flywheel's DB read-only for secondary numbers: Gated-action prompts, Proposals filed and accepted, and sessions ended by an error or refusal.

## 2. Board model

### Records

**Roadmap** → **Milestone** → **Epic** → **Story** → **Task**s, plus **Acceptance criteria** (each with an optional **Check**), **Proposals** and links to **ADRs**. There is no PRD record: the Epic spec replaces it.

- **Roadmap:** the ordered Milestones of a project. Cyril edits it directly. Agents change it only through Proposals. A new project starts empty, and Cyril writes the first Milestone. ([How do agents propose and revisit Milestones with Cyril in the MVP?](https://github.com/HighKnow-ai/flywheel/issues/28))
- **Milestone:** an outcome with an **Exit test** and no date. Every Epic sits in exactly one Milestone. A Milestone can't be dropped while it holds an open Epic. A Done Milestone is frozen, so later changes go into a new Milestone. The **Current Milestone** is the first one in Roadmap order that is neither Done nor Dropped, and reordering is how focus changes.
- **Epic:** a short spec (problem, scope, out of scope) plus an exit test. The spec lives on the board, not in the repo, because it describes work in flight. ([Do ADRs live as repo markdown or as board records?](https://github.com/HighKnow-ai/flywheel/issues/8))
- **Story:** a thin vertical slice inside one Epic. It owns one worktree and one branch, and it can never exist outside its Epic. A Story can carry a "runs after Story X" marker, which is informational and never blocks a start. ([What does shaping an Epic into Stories with an agent look and feel like?](https://github.com/HighKnow-ai/flywheel/issues/11))
- **Acceptance criterion:** a testable statement, anchored to exactly one Story, never orphaned.
- **Check:** see [4.4](#44-checks).
- **Task:** see [4.3](#43-tasks).
- **Proposal:** the only way an agent writes to the board. It does nothing until Cyril accepts it.

### States

([What states do Stories and Epics have, and how is "Needs you" ranked?](https://github.com/HighKnow-ai/flywheel/issues/20), [How do agents propose and revisit Milestones with Cyril in the MVP?](https://github.com/HighKnow-ai/flywheel/issues/28))

**Story state:** Shaping → Ready → Running → In review → Merged. From any state except Merged, a Story can be **Dropped**.

| Transition | When |
|---|---|
| Shaping → Ready | Cyril closes the Epic's criteria Stage |
| Ready → Running | Cyril starts the Story |
| Running → In review | the agent hands off (summary plus an up-to-date Task checklist). Flywheel runs the Checks, and the Story moves to In review **whatever the results are** |
| In review → Running | Cyril requests changes. A new session starts in the same worktree with the review comments |
| In review → Merged | Cyril clicks Merge and Flywheel merges. Merged means the merge commit is on the base branch and the worktree is removed. A conflict keeps the Story In review with a "rebase needed" item, handled as a request for changes |
| any → Dropped | Cyril ends it on purpose. The record stays readable, the worktree and branch are removed, and it counts as closed for its Epic |

Changing criteria after Shaping is done through a Proposal, and the Story keeps its state.

**Epic state:** Shaping → Ready → In progress → Done. Cyril closes Shaping and sets Done. Ready (no Story started) and In progress (some Story past Ready) are derived. When every Story is Merged or Dropped, a **Confirm exit test** item asks Cyril to confirm the Epic's exit test. Confirming makes the Epic Done. Declining keeps it In progress and reopens shaping. All Stories merging never closes an Epic on its own.

**Milestone state** mirrors the Epic's: Shaping → Ready → In progress → Done, plus Dropped from any state. Done only comes when Cyril confirms the exit test.

### Attention

Attention is worked out from the session and never stored as a state. It is shown in place of the state word, tinted.

- **Waiting on you:** a live session is blocked on Cyril by a Gated action, a permission request or an open shaping question. A request waits indefinitely, with no timeout and no auto-deny.
- **Stopped:** a Running Story with no live session and no hand-off. Its actions are Resume and Drop. A stop Cyril made himself still shows Stopped but stays out of Needs you.

### Needs you

The ranked list of everything waiting on Cyril in a project. The order is: live sessions held up first, then finished or dead work, then decisions about future work. Within a kind, oldest first. Nothing is reordered by hand.

1. Gated action and 2. Permission request, mixed and sorted by age
3. Stopped session (not stops Cyril made himself)
4. Review, merge conflicts included
5. Confirm exit test
6. Proposals filed during execution, as one row (see [section 5](#5-proposals-from-execution)). A Proposal that changes what a Story is judged on is its own item, ranked with Review.
7. Shaping Round waiting, including a pending roadmap Round

## 3. Shaping

([How does mattpocock/skills structure each stage, and can Flywheel borrow it?](https://github.com/HighKnow-ai/flywheel/issues/5), [What does shaping an Epic into Stories with an agent look and feel like?](https://github.com/HighKnow-ai/flywheel/issues/11), [How do agents propose and revisit Milestones with Cyril in the MVP?](https://github.com/HighKnow-ai/flywheel/issues/28))

Flywheel has one opinionated, built-in way of working, adapted from mattpocock/skills. Every record type is shaped by one primitive, grilling: the agent asks **Rounds** of numbered questions over a decision frontier, each question with a recommended answer. Swappable skill packs are out of scope.

### Shaping an Epic

- **Stages:** challenge the spec, then slice into Stories, then write the Acceptance criteria. Each Stage takes one or more Rounds. The agent posts the next Round once every question in the current one is answered.
- **Closing a Stage:** a Stage is closable when nothing in it is open: no unanswered question and no undecided Proposal. The criteria Stage also needs every accepted Story to have at least one accepted criterion. Even then **Cyril closes the Stage himself**. The close button lists whatever is still open, and nothing advances on its own.
- **Screen:** the board is the main surface.
  - The Epic card sits at the top, with Problem, Scope and Out of scope as fields and ADR and glossary chips.
  - Story columns hang off the Epic, left to right in execution order. Each Story's criteria are stacked underneath, with their Check as a chip or "judged at review".
  - Agent-noticed constraints show on the board (for example "shares `FeedRow.tsx`, runs after").
- **Proposals in shaping** are ghost cards (dashed, tinted) where they would land, with Accept / Amend / Reject. Rejected ones shrink and show struck through. They never go through an inbox.
- **The dock** holds the Rounds:
  - the agent's one-paragraph note for the Round
  - numbered question cards, each with a grounding line (what the agent read), a **pre-filled recommended answer** with a "because" line, and Accept or Answer differently
  - "Accept all recommended" for the Round

  An answered question folds to one line.
- **Durability:** every answer and decision is written to the board as it is made. A dead shaping session (a refusal, for example) loses nothing: the next session is rebuilt from the record being shaped and picks up the open Round.
- **Permissions:** shaping sessions are read-only plus the Proposal tools, and never raise a permission request. Anything that would write becomes a Proposal.
- **Checks** are written in the criteria Stage, as part of the criterion's Proposal. Shaping never produces Tasks.
- **ADRs in shaping** are offered as a question in the Round, with the draft and its bar lines (see [section 6](#6-adrs-and-repo-knowledge)). "Yes" creates an already-accepted Proposal attached to the Epic. "No" drops it.

### Shaping a Milestone and the Roadmap

- A Milestone has **one Stage, "Exit test"**, in the same dock. The agent challenges the exit test until it is observable, has no date, and can be told apart from neighbouring Milestones.
- Either side can start a Milestone. Cyril writes a one-line outcome, or an agent proposes one as a ghost row on the Roadmap strip. Both go into shaping.
- **The roadmap Round** is the only time an agent speaks up unprompted about the Roadmap. It has three triggers:
  - an Epic confirmed Done: one short Round on its Milestone (is the exit test still reachable, is an Epic missing or one to drop?)
  - a Milestone confirmed Done: one Roadmap Round (is the next Milestone still right? reorder, amend, retire or add?)
  - the "Revisit roadmap" button

  Nothing triggers a Round during execution.
- **A Round's output** is Proposals decided inline, or a "Roadmap still holds" line on the timeline.
- **The Round's packet**, stable parts first: every Milestone in order with its state and exit test, the Epics under each with their state and exit test, the ADR index, the triggering event, and the Roadmap Proposals Cyril rejected, with their reasons. It reads no Story detail or diffs.
- **Dismissing a Round** closes it with no change, until the next trigger.
- **Amending an exit test** after work started is an ordinary Proposal. The text changes, the change goes on the timeline and nothing is reopened.

## 4. Execution

### 4.1 Permissions

([How are agent permissions gated in the MVP?](https://github.com/HighKnow-ai/flywheel/issues/15), ADR 0001)

Allow by default inside the worktree. Review is the safety boundary. The gate catches accidents, not a hostile agent.

- **Auto-allowed:**
  - everything a Story session does inside its own worktree (`acceptEdits` plus a broad Bash allow)
  - read-only git calls, including Claude Code's own startup checks, silently and kept out of the feed
  - network access (`npm install`, `curl`)
  - `rebase` on the Story's own branch, and recursive `rm` inside the worktree
- **Asked once and remembered:** any other request gets a card with **Allow once** / **Always allow `<pattern>` in this project**. The pattern is pre-filled and editable, in Claude Code's syntax (`Bash(npm test:*)`). Rules are keyed by (project, tool, pattern). There is no session scope.
- **Gated actions:** asked every time with Allow once / Deny, and never covered by a rule. The backend enforces this. The list:
  - every `git push`
  - deleting a branch or worktree other than the Story's own
  - `reset --hard` and `clean -f`
  - rebase or `filter-branch` off the Story's own branch
  - recursive `rm` outside the worktree
  - publishing: `npm publish`, `cargo publish`, `gh pr merge`, `gh release`

  Gated actions are asked, not refused. Writes outside the worktree rely on Claude Code's own working-directory boundary.
- **Mechanism:**
  - The shim's classifier becomes a deny-list: `uncategorized` is removed, `-C <dir>` and `-c k=v` are skipped before matching, and plain `git push` and the publishing commands are added.
  - Flywheel picks one permission mode per session kind. There is no mode picker.
- **Where a waiting request surfaces:** on the Story card, at the top of the sidebar with a count, as an OS notification after about 30 s unanswered while the app is unfocused, and as the card in the session feed.

### 4.2 Context packet

([What is a Story session rebuilt from, and who catches an ADR that contradicts a live one?](https://github.com/HighKnow-ai/flywheel/issues/25))

Every Story session starts fresh from a fixed, ordered packet, stable parts first so prompt caching works:

1. Standing instructions
2. The Milestone title and exit test (one line), then the Epic spec in full
3. ADRs:
   - a one-line index (path and title) of every live ADR in the project, following supersession
   - accepted-but-unmerged ADRs attached to this Epic as full text
   - `GLOSSARY.md` by path only
4. Sibling Stories: title and state only
5. The Story, with each criterion's Check command and latest result
6. The Task checklist with states
7. Review feedback and the resume note, if any
8. Session summaries: the last 3 in full, older ones as one line ("N earlier sessions omitted")
9. The diff so far: stat and file names, no hunks. Uncommitted changes left by a stopped session are marked as such.
10. Closing instruction

**Session summaries** have two fields, *next session must know* and *decisions*. There is no hard size budget. The Story shows the packet's size, with a soft warning above about 20K tokens. The same board state always gives the same packet. Rejected Proposals' reasons are part of the Epic's packet. Compaction plays no part.

### 4.3 Tasks

([What are a Check and a Task checklist, and who keeps them current?](https://github.com/HighKnow-ai/flywheel/issues/23))

- The Story agent writes the checklist as its plan at the start of its first session. Cyril can add, edit, reorder or drop Tasks at any time.
- States: *open*, *doing*, *done*, *dropped* (with a one-line reason). At most one *doing*, which is what the roster shows as "what its agent is doing now".
- The agent updates Tasks through a board tool. Every change is written immediately, so a dead session keeps its checklist. Flywheel never infers ticks from the diff or the transcript.
- A flat ordered list, not linked to criteria. Open Tasks at hand-off only warn at review.
- After a request for changes, the checklist is kept, and the agent adds a Task per review point before starting.

### 4.4 Checks

- **What a Check is:** a shell command run from the worktree root. Exit 0 passes. The timeout defaults to 10 min, and a timeout is labelled *timed out*, not *failed*.
- **Who can edit it:** only Cyril, at any time. The Story agent can't edit or delete a Check. If it thinks one is wrong, it says so in its hand-off. A Check may name a test that doesn't exist yet.
- **The run of record:** at hand-off, Flywheel runs every Check in the worktree, one at a time, in plain shell, with network allowed and not under the deny-list. A failing Check doesn't stop the rest from running. The agent can run Checks any time for feedback, but those runs aren't recorded.
- **Results** are *not run*, *passed*, *failed* or *timed out*. Each is tied to the commit it ran against and marked *stale* if the branch moves. A result shows as the criterion's chip on the roster and the review card.
- **What a pass does:** it only pre-ticks its criterion. Cyril still accepts every criterion at review, and a criterion with no Check starts unticked ("judged at review").
- **Failing at merge:** a failing or timed-out Check needs an explicit, recorded "Merge with failing Check".
- **Re-runs:** Cyril can re-run all Checks from review. Editing a Check resets it to *not run*. An accepted criterion-changing Proposal marks the last run stale.

### 4.5 Stopped sessions and Resume

([What does a dead execution session keep, and how does it resume?](https://github.com/HighKnow-ai/flywheel/issues/26), [What does Claude Code's CLI offer for resuming a session and detecting a refusal?](https://github.com/HighKnow-ai/flywheel/issues/24))

- **Never `claude --resume`.** Resume is always a fresh session from the Context packet, and the adapter's `resumeSession` stays unsupported.
- **Ending reasons** are a best-effort label on Stopped, read from the result line and exit code: refusal, usage limit, API error, crash, app quit, stopped by Cyril, ended without hand-off, or unknown. Nothing branches on the reason. A clean exit without a hand-off counts as Stopped.
- **The worktree is left exactly as it is.** No WIP commit and no reset. Wiping the work is Cyril's call, through Drop.
- **Stub summary:** Flywheel writes a stub Session summary for a dead session: the reason, the *doing* Task and the last assistant message, truncated. It takes a slot in the last 3. The *doing* Task stays *doing*, and the packet tells the agent to re-verify it.
- **Resume** is always Cyril's click, with an optional one-line note.
- **Pending requests:** a pending Gated action or permission request expires with its session.
- **Session list:** the Story lists its sessions with ID, start and end, ending reason and summary, and each dead session's feed stays readable. The Claude session ID is stored for debugging only, and the transcript is never parsed.

### 4.6 Supervision

([Walk one real epic through the current build and log every blocker](https://github.com/HighKnow-ai/flywheel/issues/7), [Which existing subsystems are kept, frozen or deleted for the MVP?](https://github.com/HighKnow-ai/flywheel/issues/12))

- The session feed is readable: agent turns render as markdown, and tool results and Proposals render as structured rows. Hook, thinking-token and rate-limit noise stay out of it.
- A healthy run must not look stalled.
- Fleet and notifications are the Keep subsystems that get feature work: every live Story session across projects is visible from one place, and the sidebar carries each project's Needs-you count.

## 5. Proposals from execution

([How do Proposals filed during execution reach Cyril, and how are they triaged?](https://github.com/HighKnow-ai/flywheel/issues/27))

- **Targets:** execution Proposals target board records only. ADRs and glossary terms go through the Story's diff instead.
- **Never a pause:** a Proposal never pauses the agent that filed it. An agent that can't go on without an answer asks a question instead (Waiting on you).
- **One row:** Needs you has one "Proposals" row ("n from m Stories"). Its Triage button opens a drawer beside the roster, grouped by the record each Proposal lands on: each Epic, then "Roadmap · after this Milestone" for new Epics. The roster only carries an "n Proposals" marker on an Epic row.
- **Card:** each card shows the kind (New Story, Amend criterion, Reorder, Retire Story, New Epic, Amend Epic spec), the title, a diff for amendments, the agent's *why*, an evidence line, and the filing Story and time.
- **Judged-on changes skip the wait:** a Proposal that changes a Story's Acceptance criteria or the Epic spec is its own Needs-you item at once, with a before/after diff and Accept / Edit / Reject inline.
- **Soft cap:** 3 open Proposals per Story session. The board tool refuses a 4th and tells the agent to merge or withdraw one.
- **Duplicates** are flagged on the card. Accepting the original closes the duplicate and tells the Story that filed it.
- **What each accepted kind does:**

  | Kind | Effect |
  |---|---|
  | New Story | created in Shaping inside its Epic |
  | Amend criterion | changes the criterion and marks the last Check run stale |
  | Amend Epic spec | reaches every Story packet from the next session |
  | Reorder | changes the execution order |
  | Retire | drops the Story |
  | New Epic | created in Shaping, after the Current Milestone |

  A rejection's reason is kept in the Epic's packet.

## 6. ADRs and repo knowledge

(ADR 0002, [How does an agent propose an ADR, and how is it challenged?](https://github.com/HighKnow-ai/flywheel/issues/16), [Do ADRs live as repo markdown or as board records?](https://github.com/HighKnow-ai/flywheel/issues/8))

- **Where things live:** the board is the store of record for work. The managed project's repo (`docs/adr/`, `GLOSSARY.md`) is the store of record for knowledge about the code. The board only links to it.
- **One write path:** repo knowledge reaches the repo only through a Story's worktree, review and merge. During shaping, an ADR or glossary change is an accepted Proposal attached to the Epic, and the Epic's first Story writes it verbatim. Flywheel never commits outside a worktree.
- **Story agents write ADRs without asking**, in their worktree. Review is the only gate.
- **The bar lines:** every offered ADR carries four lines, shown beside it and never written into the file:
  - why it's hard to reverse
  - why it would surprise a reader
  - which alternative lost
  - "Relates to: ADR-NNNN… / none"

  Without the first three, there is no ADR. The packet tells the agent to check the ADR index and either supersede a related ADR or not write a new one.
- **Supersession:** a changed merged decision is a new ADR that opens "Supersedes ADR-NNNN", and the old one gets one `Status: superseded by ADR-MMMM` line in the same merge. Wording is fixed in place. Before merge, an accepted ADR changes by amending its Proposal.
- **No limit** on ADRs per Story.
- **Unlinked ADRs:** an ADR with no board link is shown as unlinked.

## 7. The board surface

([What does "clear project status at a glance" look like on the board?](https://github.com/HighKnow-ai/flywheel/issues/10), [How do agents propose and revisit Milestones with Cyril in the MVP?](https://github.com/HighKnow-ai/flywheel/issues/28))

The project screen, top to bottom:

1. **Roadmap strip:** one slim row per Milestone with name, state and a one-line exit test. Drag to reorder, ghost rows for Proposals, and click to switch the roster. There is no separate Roadmap screen.
2. **Milestone header:** the name, the next Milestone, the exit test as prose, and a stacked bar of Story states with "Epics done / Epics · Stories merged / Stories".
3. **Needs you:** ranked as in [section 2](#needs-you). Each item shows its kind, the record, a one-line detail (the literal command for a Gated action) and its actions: Allow once / Deny, Resume, Open review, Triage, Continue shaping.
4. **Since you last looked:** a timeline of events since Cyril's last visit, collapsed by default with the event count.
5. **Roster:**
   - one row per Epic, with its state, a stacked bar of its Stories, "n of m Stories merged" and markers for Proposals or shaping
   - each Story on one line under its Epic: state mark and word (or its attention flag), what its agent is doing now (the *doing* Task, or the diff size in review), then either an action button or "criteria x/y · tasks x/y"
   - rows that need Cyril tinted

The sidebar shows each project's Needs-you count and the running sessions in every project. Creating an Epic or a Story and moving a Story between Epics are reachable from visible controls, not only from the palette or a hidden key.

## 8. Review and merge

([What are a Check and a Task checklist, and who keeps them current?](https://github.com/HighKnow-ai/flywheel/issues/23), [How does an agent propose an ADR, and how is it challenged?](https://github.com/HighKnow-ai/flywheel/issues/16), [What states do Stories and Epics have, and how is "Needs you" ranked?](https://github.com/HighKnow-ai/flywheel/issues/20))

- **Order of the review:** failing or timed-out Checks first, with their output tail. Then every Acceptance criterion with its Check chip, pre-ticked when its Check passed. Cyril accepts each criterion himself. Acceptance is human-only.
- **Warnings:** open or *doing* Tasks show as "n Tasks not done". The handing-off agent's objections to a Check are shown with it.
- **Decisions section:** `docs/adr/` and `GLOSSARY.md` changes appear in their own section, with a count.
  - Each ADR card shows the bar lines and the related live ADRs inline, and offers **Keep** (the default), **Not an ADR** (the agent deletes the file) or **Wrong decision** (a short grilling inside the review, then a request for changes covering code and ADR).
  - A diff to an existing ADR other than its `Status:` line is flagged ("wording or supersede?").
  - An ADR number already taken on the default branch is flagged for the agent to renumber.
- **Actions:**
  - **Request changes** sends the Story back to Running with the comments.
  - **Re-run Checks** reruns them all.
  - **Merge** merges into the base branch, removes the worktree, links new ADRs to the Story by path and marks superseded ones. A failing or timed-out Check needs "Merge with failing Check", recorded on the Story. Merge is Cyril's action, not an agent Gated action.

## 9. Codebase plan

([Which existing subsystems are kept, frozen or deleted for the MVP?](https://github.com/HighKnow-ai/flywheel/issues/12), [Evolve the current codebase into the new model, or rebuild a lean core?](https://github.com/HighKnow-ai/flywheel/issues/13), ADR 0003, [Retire .planning/](https://github.com/HighKnow-ai/flywheel/issues/14))

**Path C:** same repo, plumbing kept, a new baseline schema, and the record domain and reshaped surfaces rewritten rather than edited. No data survives. v0.1 can't be upgraded: on first launch an old-schema DB is moved aside and the app starts empty. Identifiers follow `GLOSSARY.md` exactly (tables, Rust types, IPC commands, DTOs, components), with no `task`/`cycle`/`issue` aliases. `task` survives only as the Story checklist.

### Verdicts

| Verdict | Subsystems |
|---|---|
| **Keep** (feature work) | Fleet / search / project rail; Notifications & menu |
| **Keep** (fixes only) | DB + migrations + event log; IPC seam; Sidecar supervision; Claude Code adapter; Worktree lifecycle; Git lock retry / spawn floor; Crash/launch reconciliation; Git truth |
| **Reshape** (rewrite) | Record domain → Roadmap/Milestone/Epic/Story/Proposal; Acceptance criteria; Socratic authoring → shaping; Proposal tray → execution Proposals; Agent run + session UI; Context packet & summaries; Board UI; Item detail; Review & merge; Cycles → Milestone; destructive classifier + shim → deny-list; permission requests/rules → pattern rules |
| **Freeze** | Fan-out dispatcher, File-set scope fence, Launch sheet, Limit gate, Forge integration, Drift detection, Scheduler, Git identity & credentials, Settings surface, UI shell / keyboard / theme / legend, Packaging & release |
| **Delete** | Relay-client crate; Updater with its `release.yml` signing and `latest.json` steps; Provisional tier; unused release scripts (`ax-drive.js`, `verify-bundle-assets.sh`, `apply-tag-version.test.mjs`); `CycleRegion` and cycle UI; drift's cycle scope; `task_file_set_get` / `task_file_set_set`; Compaction; the PreToolUse "prove interception" hook and its bypass tests; `docs/destructive-gate-trust-boundary.md`; the launch-sheet permission-mode picker |

**Freeze rule:** frozen code only gets the minimal changes a reshape forces on it. It is triaged once, at the schema cut. A repair may only re-point it at Stories (`task_id` → `story_id`, same meaning). Anything that needs its meaning changed, or costs more than about half a day, is deleted on the spot and listed in the cut's PR.

### Order

1. **Delete pass**, on the current schema: the Delete list, the dropped gates and UAT, and the code of the reshaped surfaces that will be rewritten. Their history stays in git to borrow from.
2. **Schema cut**, in one Story: the squashed baseline (migrations 0001–0024 become one), the record domain, IPC and DTOs, old-DB move-aside, freeze triage, and the Keep modules re-pointed.
3. **Surfaces in blocker order:** permissions, supervision and execution, shaping, board, review.

**Always green:** every merge compiles and passes CI. The app only has to be usable once supervision lands. There is no dual model and no feature flags. `v0.1.1` stays tagged as the last usable build. A field a later surface needs is added as an ordinary migration after the baseline.

### Gates, UAT and tests

- **Source-scanning gates kept:** `supervisor_cwd`, `handler_roster`, `board_changed_payload`, `no_agent_status_write`, `authority_human_only`, `app_exit_ordering`, `session_closed_call_site`, `termination_atomicity_call_site`, `agent_run_stop_ordering`, `runtime_context_call_sites`, `table_classification`.
- **Gates deleted:** `spine_pin`, `pm_vocabulary_gate`, `estimate_absent`, `priority_is_opt_in`, `brand-rule`, `state-token-gate`, `board-changed-adoption`, the 6 unrun `*.browser.test.tsx` files, and the `?raw` text assertions in the TS finish/polish tests.
- **Gate policy:** no new source-scanning gate unless it protects the core value (human-only acceptance, criteria anchored to Stories).
- **UAT:**
  - *wired into CI (offline, no tokens):* `harness-supervision-gate`, uat-12. Also uat-13, unless fan-out is deleted at freeze triage.
  - *manual, pre-release only:* uat-01, 03, 05, 06, 07, 11. uat-03 is rewritten to the new gated list. The others survive only if they don't exercise the deleted hook or `uncategorized`.
  - *deleted:* uat-08 with `fake-authoring-claude`, 09, 10, 14, 15, and the `uat_authoring_ops` and `uat_seed_ui` bins. `run-all.sh` and the UAT README are cut down to what remains.
- **Tests:** a behaviour test of reshaped code is ported only if it pins an invariant the MVP still holds (human-only acceptance, criteria anchored to a Story, termination atomicity and similar). New code is built test-first.
- **Known latent race:** the unlocked `with_scratch_worktree_root` helper is copied across test files. It is fixed once, in the delete pass.

## 10. Milestones

Each Milestone is a GitHub Milestone, and its exit test is the GitHub Milestone's description.

| # | Milestone | Exit test |
|---|---|---|
| 1 | **Clean cut** | CI is green on a single baseline migration whose tables and types use only glossary names. Launching on a v0.1 database moves it aside and starts empty. Nothing on the Delete list or the dropped-gate and dropped-UAT lists remains in the tree. |
| 2 | **Supervised execution** | A Story written by hand, with criteria and Checks, runs in its own worktree from Start to In review, with Cyril following it in Flywheel. He meets no permission prompt other than Gated actions and remembered-rule first asks, never opens a terminal to see what the agent is doing, and can kill the session and Resume it with nothing lost. |
| 3 | **Shaping** | Cyril takes a one-line idea to an Epic with Ready Stories, each with accepted criteria and Checks, entirely in Flywheel's dock and board. He can also shape a Milestone's exit test and have a roadmap Round propose a change. |
| 4 | **Board and review** | A Story goes from Ready to Merged in Flywheel alone: Cyril sees it on the roster and in Needs you, triages its Proposals in the drawer, and reviews and merges it, handling an ADR it wrote in the Decisions section. |
| 5 | **One-week exit test** | The MVP exit test in [section 1](#1-purpose-and-the-one-week-exit-test) passes. |

The backlog for Milestones 1 and 2 is written down to Stories with Acceptance criteria and Checks. Milestones 3 to 5 have Epics with specs, and their Stories are sliced when each one becomes current.

## 11. Licensing and prompt attribution

The desktop app is open source. Shaping prompts adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) can ship, provided the licence notice ships with them ([How does mattpocock/skills structure each stage, and can Flywheel borrow it?](https://github.com/HighKnow-ai/flywheel/issues/5)). The Story that ships the first prompt adapted closely from it must also:

- add the MIT licence text, with its copyright line, to the repo (for example `LICENSES/mattpocock-skills.txt`)
- add a line naming the source and pointing at that file to a `NOTICE` file at the repo root
- include both in the app bundle's licence notices

## 12. Out of scope

- The rest of v0.2.0 (Phase 15 plans 15-08 to 15-10, Phases 16 to 18): already-merged code is judged by the verdicts above
- PRD as its own record type
- Apple signing, notarisation and a working self-updater
- Teams, cloud, the mobile/web relay, and scaffolding for any of them
- Swappable skill packs
- Scheduled automations, including resuming when a limit resets
- `claude --resume`, a refusal probe, an automated ADR-contradiction detector, a second reviewer agent
- Moving Flywheel's own plan from GitHub Issues into Flywheel: GitHub stays the plan of record until the MVP exit test passes
