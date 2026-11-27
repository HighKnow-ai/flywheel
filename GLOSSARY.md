# Flywheel

Flywheel is a project board where one developer shapes work with AI agents and has them carry it out. Agents suggest work and challenge the developer's thinking at every level; the developer decides.

## Board records

**Roadmap**:
The ordered list of Milestones for a project, shaped by the developer together with agents.
_Avoid_: Plan, schedule

**Milestone**:
An outcome the project is working towards, defined by an exit test rather than a date.
_Avoid_: Cycle, phase, sprint, release

**Current Milestone**:
The first Milestone in Roadmap order that is neither done nor dropped; reordering the Roadmap is how the developer changes it.
_Avoid_: Active milestone, focus

**Epic**:
A capability within a Milestone, described by a short spec covering the problem, the scope and what is out of scope.
_Avoid_: Feature, PRD

**Story**:
A thin vertical slice of user-visible behaviour within an Epic; the unit of work an agent executes in its own worktree.
_Avoid_: Ticket, task (for the executable unit)

**Story state**:
Where a Story is in its life: Shaping, Ready, Running, In review, then Landing (only when the project lands by request) and Merged, or Dropped. What its session is doing is not part of the state.
_Avoid_: Status (for the lifecycle), column

**Make Ready**:
The developer's move of one Story from Shaping to Ready once its Epic's shaping is closed, such as a New Story a running Story proposed; it needs at least one Acceptance criterion, and it never reopens the Epic's shaping.
_Avoid_: Promote, approve, reshape

**Dropped**:
The end state of a Story the developer has decided not to finish; its record stays readable and it counts as closed for its Epic.
_Avoid_: Cancelled, abandoned, closed

**Epic state**:
Where an Epic is in its life: Shaping, Ready, In progress, then Done once the developer confirms its Exit test.
_Avoid_: Status, complete

**Task**:
A checklist step inside a Story that the Story's agent writes, works through and keeps up to date; never written during Shaping, and not a board item of its own.
_Avoid_: Subtask, todo

**Acceptance criterion**:
A testable statement a Story must satisfy, judged against the Story's diff at review. In shaping, an *accepted criterion* is one whose Proposal was accepted, which creates it; it is accepted against the diff (`accepted_by`) only at review. A criterion is *met*, as the roster's "criteria x/y" counts it, once accepted, or once its Check passed and is not stale against the head the Story last handed off (ADR 0012).
_Avoid_: Validation, requirement, AC

**Check**:
An executable test or command attached to an Acceptance criterion that must pass. Run by Flywheel at hand-off; its result belongs to the commit it ran against, and is *stale* once the branch moves past that commit or an accepted Judged-on change rewrites its criterion.
_Avoid_: Validation, gate

**Review**:
The developer's judgement of a Story In review, opened by its hand-off and closed by Merge or a request for changes. It records the diff's size, the Tasks not done, the agent's Check objections and the bar lines of each ADR the Story wrote, at hand-off, and, at Merge, any failing Check the developer overrode. A Story has at most one open review (ADR 0010).
_Avoid_: PR, code review (for the record)

**Check objection**:
The handing-off agent's statement that a Check is wrong, naming the criterion it is on and why. Kept on the review and shown beside that Check; it never changes the Check's result, and only the developer can edit or override the Check.
_Avoid_: Dispute, waiver

**Re-run Checks**:
The developer's act, from the review card, of running every Check of an In review Story again in its worktree without a session, each run recorded against the branch's head. Refused while a session of the Story is live.
_Avoid_: Retest, rerun (for an agent's own `checks_run`)

**Merge**:
The developer's act that ends a review. It needs every criterion accepted and no new ADR marked Not an ADR or Wrong decision, and a Check failed, timed out, not run or stale needs "Merge with failing Check". What it writes depends on the project's Landing mode: a pull request, a landing command, or (with no forge) a merge commit on the local base branch that removes the worktree and the branch and moves the Story to Merged (ADR 0009, ADR 0042).
_Avoid_: Ship, land

**Landing mode**:
The project's setting for what Merge does: **pull request** (the default: push the Story's branch and open a pull request with auto-merge on), **command** (run the project's landing command in the worktree) or, for a project with no remote on a known forge, the local merge. ADR 0042.

**Landing**:
The Story state after Merge pushed or ran the landing command and before the request merged. The worktree stays. Flywheel asks the forge for the request's state and moves the Story to Merged when it merged, or back to In review when it was closed without merging. ADR 0042.

**Request changes**:
The developer's act that ends a review without merging: the review closes with the developer's comments, the Story moves back to Running, and a fresh session starts in the same worktree from a Context packet that carries the comments. The Task checklist is kept, and the agent adds one Task per review point before going on. The review's ADR decisions and its Renumber and Supersession line missing flags go with the comments as "ADR review points", so the comments may be left empty when there are any. A launch that fails leaves the Story Stopped, with Resume.
_Avoid_: Reject, send back (as a name), reopen

**Rebase needed**:
What an In review Story reads when merging its branch into the base branch would conflict, with the conflicting paths. Merge refuses it; the review card offers a request for changes pre-filled with a comment naming those paths.
_Avoid_: Merge conflict (as a state), blocked

**Exit test**:
The prose statement that tells you a Milestone or Epic is done.
_Avoid_: Definition of done, success criteria

**ADR**:
A record of a hard-to-reverse decision with a real trade-off behind it, kept with the project's code and linked to the Milestone, Epic or Story where the decision came up.
_Avoid_: Decision log, design doc

**Bar lines**:
The four lines an ADR is offered with, shown beside it and never written into the file: why it is hard to reverse, why it would surprise a reader, which alternative lost, and which ADRs it relates to. Without the first three there is no ADR. In shaping they come with the draft; from a Story they come in its hand-off (ADR 0010).
_Avoid_: ADR metadata, front matter

**Decisions section**:
The part of a review that lists the Story's `docs/adr/` and `GLOSSARY.md` changes apart from its code, with a count. Each new ADR shows its bar lines, the live ADRs it relates to, and its ADR decision. Each change also shows its ADR flags.
_Avoid_: Knowledge diff

**ADR decision**:
The developer's verdict on an ADR a Story adds, taken at review: **Keep** (the default), **Not an ADR** (the agent deletes the file and keeps the decision out of `docs/adr/`) or **Wrong decision** (what is wrong and what it should be, a review point on both the code and the ADR). Not an ADR and Wrong decision are stored on the review and hold Merge; neither sends the Story back by itself. A request for changes carries them as review points (ADR 0016).
_Avoid_: ADR approval, ADR rejection

**ADR flag**:
What the Decisions section raises on an ADR change, read from git and never stored: **Wording or supersede?** (an existing ADR with a changed line other than `Status:`), **Renumber** (a new ADR whose number another file holds on the base branch's tip) and **Supersession line missing** (a new ADR supersedes one whose file has no `Status: superseded by` line). A flag never holds Merge; a request for changes carries Renumber and Supersession line missing as review points (ADR 0016).
_Avoid_: ADR warning, lint

**Proposal**:
A change suggested by an agent to any board record, ADR or glossary term (create, amend, reorder or retire it) that has no effect until the developer accepts it.
_Avoid_: Issue, suggestion, draft

**Duplicate Proposal**:
A pending Proposal from execution that repeats one already pending: the same kind on the same target (the same Story, criterion or Epic field), or a New Story or New Epic with the same title, any case, in the same Epic or Milestone. It holds no slot under the cap, and accepting either closes the other as "duplicate of <title>".
_Avoid_: Near-duplicate, similar Proposal

**Triage**:
Deciding the Proposals running Stories filed, each accepted, amended or rejected, in one drawer that groups them by the record each lands on; a Proposal that changes what a Story is judged on is decided on its own instead.
_Avoid_: Inbox, backlog grooming

**Judged-on change**:
A Proposal that changes what a Story is judged on: an Amend criterion, or an Amend Epic spec filed by a Story session. It is its own Needs-you item at once, ranked with Review, never in the Proposals row. Accepting an Amend criterion clears the criterion's acceptance, and either replaces its Check (which then reads not run) or marks the Check's last run stale (ADR 0015).
_Avoid_: Spec change (that is any Amend Epic spec, shaping's included), criterion edit

## Shaping

**Shaping**:
Turning a board record into something an agent can execute by having an agent challenge it with the developer, one Stage after another, until nothing in it is open. Under Autopilot, Shaping is Claude's unattended work that turns Ideation's outcome into Stories with criteria, Checks and blocking edges, and ends in one Epic Proposal.
_Avoid_: Authoring, planning, grooming, ticketing, breakdown

**Ideation**:
The developer's conversation with Claude where an idea is explored and every one-way decision is made: the roadmap Rounds, and an Epic's first Stage.
_Avoid_: Brainstorming, planning

**Stage**:
One step of shaping a record, which the developer closes once it has no open question and no undecided Proposal; an Epic has three (challenge the spec, slice it into Stories, write the Acceptance criteria), a Milestone has one (challenge the exit test).
_Avoid_: Phase, step

**Round**:
A batch of numbered questions the agent asks during a Stage, each with a recommended answer the developer can accept as it is or replace with their own.
_Avoid_: Turn, interview, questionnaire

## Agent work

**Agent**:
A live session: one that is running or Waiting on you, whether it carries out a Story or shapes a record. Every count of agents (the andon strip's, the sidebar's, All agents') is the number of live sessions; a Stopped Story or a session that has ended is not an agent.
_Avoid_: Run, lamp, worker (as a count)

**Waiting on you**:
A session that is live but can't go on until the developer answers it: a Gated action, a permission request, a question the agent asked, or an open shaping question.
_Avoid_: Blocked, paused

**Note to the agent**:
Free text that the developer sends to the live session of a Story. The agent takes it at its next turn boundary, never during a tool call. It reads sent, delivered, or not delivered when its session ended first.
_Avoid_: Message, chat, prompt, steer

**Quick Story**:
A Story written from one text field with one default criterion and started at once, in the Epic "Quick Stories" of its project.
_Avoid_: Ad-hoc task, scratch Story

**Stopped**:
A Running Story with no live session that never handed off for review; its worktree is left exactly as it was, and resuming it starts a new session from the Context packet rather than continuing the old one.
_Avoid_: Failed, interrupted, abandoned

**Needs you**:
The ranked list of everything waiting on the developer across a project, with the most urgent first. Autopilot adds the kinds Escalated, Parked, Epic Proposal and Yours.
_Avoid_: Inbox, queue, notifications

**Roster**:
The picked Milestone's Epics on the project board, each with its Stories as rows: a row's state or attention, what its agent is doing (or its diff in review), and its next action or "criteria x/y · tasks x/y".
_Avoid_: Backlog, list, kanban

**Context packet**:
Everything a new Story session is rebuilt from, read off the board and the worktree, so that ending a session loses nothing.
_Avoid_: Prompt, briefing, context

**Session summary**:
A short note a Story session leaves for the next one: what it must know and what was decided. When a session stops without handing off, Flywheel writes a stub in its place saying why it ended and where it was.
_Avoid_: Handoff note, recap

**Gated action**:
An action an agent may take only with the developer's explicit, one-off approval, because it leaves the Story's worktree or can't be undone; never covered by a standing rule.
_Avoid_: Destructive action, dangerous command

**Sandbox policy**:
The `sandbox` block of a project's own `.claude/settings.json`, turned on. Flywheel passes it to every session in that project with a strict network allow-list, and refuses a session whose sandbox isn't on before its first turn (ADR 0040).
_Avoid_: Sandbox config, permissions

## Autopilot

**Autopilot**:
The Flywheel mode in which an accepted Epic's Stories run, pass their Checks and land through the Merge gate without the developer clicking each step.
_Avoid_: Auto mode, unattended mode, bot, graph engineering

**Grant**:
The record, written when the developer accepts an Epic Proposal, that lets Autopilot start the Epic's Stories, accept a criterion on a passing Check, take a correction and merge through the Merge gate. Withdraw revokes it. It never covers a Gated action, a decision on a Proposal or a prepare-only merge.
_Avoid_: Permission, approval, token

**Epic Proposal**:
The one Proposal that ends unattended Shaping: an Epic with its Stories, laid out exceptions first, with the assumptions Claude made. Accepting it writes the grant; the other action is Send back to Shaping.
_Avoid_: Plan, breakdown

**Dispatcher**:
The deterministic part of Flywheel that starts the next Ready Story under Autopilot, within the session cap.
_Avoid_: Orchestrator, scheduler, Fan-out dispatcher (the frozen v0.1 term)

**Batch**:
A set of Stories landed together behind one Merge gate run.
_Avoid_: Train, release

**Batcher**:
The deterministic part of Flywheel that forms Batches, lands them, and removes a failing Story from a red one.
_Avoid_: Merger, lead

**Merge gate**:
The project's required CI check, which a Batch must pass to land.
_Avoid_: Gate (alone), CI

**Agent review**:
The model review a Story gets after its Checks pass.
_Avoid_: Review (alone), AI review

**Risk lane**:
The blast-radius class of a Story: contained, wide or one-way. It decides how far Autopilot may take the Story alone. A one-way Story is prepare-only.
_Avoid_: Lane (alone), risk score, confidence

**Prepare-only**:
Said of a Story that Autopilot builds to In review but never merges: every one-way Story, and every change to an owner-guarded doc. The developer merges it.
_Avoid_: Never taken, manual lane

**Shape check**:
The deterministic test an item must pass before Autopilot will take it.
_Avoid_: Readiness score, intake review

**Blocker**:
A Story, an Epic or a mirrored issue that must merge or close before a Story may start. The Dispatcher obeys it.
_Avoid_: Runs after (the retired informational marker), dependency (alone)

**Not-before date**:
The earliest day the Dispatcher may start a Story.
_Avoid_: Due date, schedule

**Spend cap**:
The most a Story may spend on paid runs and APIs. It is approved when the developer accepts the Story's Epic.
_Avoid_: Budget (alone), cost lane

**Correction record**:
What goes back with a returned Story: the verdict, the reason, the evidence and the scope of the fix.
_Avoid_: Feedback, review comments

**Escalation**:
A Needs you item raised when a Story fails its third correction, because the Story rather than its session is wrong.
_Avoid_: Failure, abort

**Parked**:
Said of a Story set aside under Autopilot because it needs a one-way decision that no record answers.
_Avoid_: Blocked, stuck

**Convention**:
A project-wide rule, with its Check and its line in the standing instructions, that every Story must satisfy.
_Avoid_: Policy, standard

**Run ledger**:
The append-only record of every Check result, Agent review and Correction record. The learning edge reads it.
_Avoid_: Log, history

**Learning edge**:
The path by which run results become permanent constraints on later runs, always as Proposals the developer accepts.
_Avoid_: Feedback loop, self-improvement

**Project adapter**:
The per-project settings Autopilot uses for the isolated checkout, scoped checks, Batch landing, the Merge gate status and the Risk lane rules.
_Avoid_: Repo adapter, integration, plugin

**Issue mirror**:
The copy of a project's accepted Milestones, Epics and Stories that Flywheel keeps in the forge's issue tracker. Only Flywheel writes the fields the board owns.
_Avoid_: Sync, two-way sync, issue integration

**Adopt** (an issue):
To make an existing forge issue the mirror of a new board record during onboarding. The issue keeps its number.
_Avoid_: Import (alone), migrate

**Intake Proposal**:
A Proposal made from an issue opened on the forge, not by Flywheel. It carries a pre-triage note and is decided in Triage, under "From GitHub" on a GitHub forge.
_Avoid_: Inbox item, imported issue

## People

**Developer**:
The single human using Flywheel, who acts as product owner, architect and developer in turn; these are activities, not separate people.
_Avoid_: User (ambiguous with end users of the product being built), architect (as a role)

## Hosted side

**Environment**:
One whole copy of HighKnow's hosted platform that Flywheel's hosted side talks to: production, staging, or a temporary one named `env-<name>`. A release build talks to production only; a development build talks to the one chosen in its hidden picker, persisted per install.
_Avoid_: Launch environment (the PATH Flywheel reads at startup), stage, server
