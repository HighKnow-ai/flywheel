# Flywheel

Flywheel is a project board where one developer shapes work with AI agents and has them carry it out. Agents suggest work and challenge the developer's thinking at every level; the developer decides.

## Board records

**Roadmap**:
The ordered list of Milestones for a project, shaped by the developer together with agents.
_Avoid_: Plan, schedule

**Milestone**:
An outcome the project is working towards, defined by an exit test rather than a date.
_Avoid_: Cycle, phase, sprint, release

**Epic**:
A capability within a Milestone, described by a short spec covering the problem, the scope and what is out of scope.
_Avoid_: Feature, PRD

**Story**:
A thin vertical slice of user-visible behaviour within an Epic; the unit of work an agent executes in its own worktree.
_Avoid_: Ticket, task (for the executable unit)

**Story state**:
Where a Story is in its life: Shaping, Ready, Running, In review, then Merged or Dropped. What its session is doing is not part of the state.
_Avoid_: Status (for the lifecycle), column

**Dropped**:
The end state of a Story the developer has decided not to finish; its record stays readable and it counts as closed for its Epic.
_Avoid_: Cancelled, abandoned, closed

**Epic state**:
Where an Epic is in its life: Shaping, Ready, In progress, then Done once the developer confirms its Exit test.
_Avoid_: Status, complete

**Task**:
A checklist step inside a Story that the agent works through and keeps up to date; not a board item of its own.
_Avoid_: Subtask, todo

**Acceptance criterion**:
A testable statement a Story must satisfy, judged against the Story's diff at review.
_Avoid_: Validation, requirement, AC

**Check**:
An executable test or command attached to an Acceptance criterion that must pass.
_Avoid_: Validation, gate

**Exit test**:
The prose statement that tells you a Milestone or Epic is done.
_Avoid_: Definition of done, success criteria

**ADR**:
A record of a hard-to-reverse decision with a real trade-off behind it, kept with the project's code and linked to the Milestone, Epic or Story where the decision came up.
_Avoid_: Decision log, design doc

**Proposal**:
A change suggested by an agent to any board record, ADR or glossary term (create, amend, reorder or retire it) that has no effect until the developer accepts it.
_Avoid_: Issue, suggestion, draft

## Agent work

**Waiting on you**:
A session that is live but can't go on until the developer answers it: a Gated action, a permission request, or an open shaping question.
_Avoid_: Blocked, paused

**Stopped**:
A Running Story with no live session that never handed off for review; its worktree is intact and it can be resumed.
_Avoid_: Failed, interrupted, abandoned

**Needs you**:
The ranked list of everything waiting on the developer across a project, with the most urgent first.
_Avoid_: Inbox, queue, notifications

**Gated action**:
An action an agent may take only with the developer's explicit, one-off approval, because it leaves the Story's worktree or can't be undone; never covered by a standing rule.
_Avoid_: Destructive action, dangerous command

## People

**Developer**:
The single human using Flywheel, who acts as product owner, architect and developer in turn; these are activities, not separate people.
_Avoid_: User (ambiguous with end users of the product being built), architect (as a role)
