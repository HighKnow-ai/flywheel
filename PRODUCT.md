# Product

<!-- impeccable:product-schema 1 -->

> **Provenance.** Rewritten on 2026-10-21 for issue #102 with `impeccable init`, from `docs/mvp-spec.md`,
> `GLOSSARY.md`, `CLAUDE.md` and the owner's written input on issue #102 and Epic #97. Init's interview
> could not run in that session (no question tool was available to the agent), so nothing here comes
> from a fresh interview: every fact is taken from those documents, and the few that are inferences are
> marked *(inferred)*. `docs/mvp-spec.md` wins wherever this file and it disagree. Records and states
> use the glossary's terms exactly.

## Platform

web

Rendered in a macOS WebView (WKWebView) inside a Tauri v2 desktop shell. It is a **macOS desktop
application**, not a website: macOS window chrome, the macOS menu bar, ⌘-based key idioms and native
materials are all in scope. Desktop only in v1; Windows, Linux, mobile and web are out of v1.

## Stack

Decided in `CLAUDE.md` § Technology Stack: Tauri v2 (Rust core, SQLite through `rusqlite` as the store
of record) with a bundled Node.js sidecar that drives the developer's own `claude` binary, and a React
renderer. UI libraries installed: `@tanstack/react-query` (server state only), `@tanstack/react-virtual`,
`react-diff-view`, Zustand (UI state only), `lucide-react` for icons. Not installed, and not to be planned
on without an install that actually runs: Monaco, `@xyflow/react`.

**Binding renderer constraint:** every Tauri `invoke`/`listen` call goes through one adapter module
(`packages/desktop/src/adapters/tauri.ts`), so the same React tree can later point at a relay client.

## Users

**One Developer**, who acts as product owner, architect and developer in turn (glossary: Developer).
Cyril is the first user and every role in the MVP. He runs "loop engineering": draining a backlog with
AI agents across several of his own projects instead of hand-driving one terminal at a time.

The situation is sustained expert desk work. Flywheel is open all day beside a terminal and an editor,
glanced at constantly and read carefully now and then. The job splits in two:

- **Shaping:** turning an idea into an Epic with Stories, Acceptance criteria and Checks, with an agent
  challenging each record until nothing in it is open.
- **Supervision:** knowing at a glance what every Story session is doing, what is Waiting on you, what is
  Stopped, what is In review, and how far the Current Milestone has come.

A team audience sharing a project through a relay is a possible later direction, not a v1 audience.

## Product Purpose

Flywheel is a project board where one Developer shapes work with AI agents and has them carry it out.
Agents suggest work and challenge the Developer's thinking at every level; the Developer decides.

The board holds a **Roadmap** of **Milestones**; each Milestone holds **Epics**; each Epic holds
**Stories**. A Story is the unit an agent executes, in its own git worktree and branch. It carries
**Acceptance criteria**, each with an optional **Check**, and its agent keeps a **Task** checklist.
Agents change the board only through **Proposals** the Developer accepts.

**Success, in the MVP's own exit test:** Cyril runs one week of real work across his own projects from
Flywheel without dropping back to a bare Claude Code terminal.

## Positioning

**Every unit of agent work is anchored to a structured board record with real Acceptance criteria,
never a chat blob.** If everything else fails, this must hold.

The mechanism a chat-native tool cannot copy: *the board is what makes `/clear` free.* A worktree is
cheap and durable and belongs to its Story across many sessions; an agent context is expensive and
disposable. Every new Story session is rebuilt from a **Context packet** read off the board and the
worktree (the Epic spec, the Story and its criteria with their Check results, the Task checklist with
each Task's note, the last **Session summaries**, the diff so far). Ending a session loses nothing, so
Flywheel can end sessions freely, and Resume is always a fresh session from that packet.

## Operating Context

- **Local-first.** Agents run on the Developer's machine with his existing Claude Code credentials.
  Credentials never leave the desk.
- **Multi-project.** Several local git repositories registered as projects, one fleet-wide store.
- **Records and states** (glossary terms, fixed):
  - Story state: Shaping → Ready → Running → In review → Merged, or Dropped from any state but Merged.
  - Epic state and Milestone state: Shaping → Ready → In progress → Done (Milestones can also be
    Dropped). Done only when the Developer confirms the Exit test.
  - Task states: open, doing, done, dropped (with a reason). At most one doing: that is "what its agent
    is doing now".
  - Check results: not run, passed, failed, timed out; stale when the branch moves.
- **Attention, worked out from the session and never stored:** **Waiting on you** (a live session held
  by a Gated action, a permission request, a question the agent asked, or an open shaping question) and
  **Stopped** (a Running Story with no live session and no hand-off). Attention is shown in place of the
  state word.
- **Needs you:** the ranked list of everything waiting on the Developer in a project, oldest first
  within a kind: Gated actions and permission requests, Stopped sessions, reviews, Confirm exit test,
  Proposals, shaping Rounds.
- **Rituals it must serve:**
  - shaping a Milestone's Exit test and an Epic in Stages and Rounds of numbered questions with
    recommended answers, in a dock beside the board;
  - starting a Ready Story, following its session feed, answering what it is Waiting on you for,
    stopping it and resuming it;
  - glancing at project progress: the Current Milestone, its Epics and their Stories by state;
  - reviewing a Story In review against its criteria and Checks, and merging it;
  - triaging Proposals filed during execution.
- **Permissions:** allow by default inside the Story's worktree; a permission request outside it is
  asked once with **Allow once** / **Always allow `<pattern>` in this project**; a **Gated action**
  (every `git push`, destructive git, deleting outside the worktree, publishing) is asked every time
  with Allow once / Deny and never covered by a rule.
- **Adjacent tools:** the terminal, the editor, `git` and GitHub. GitHub Issues stays Flywheel's own
  plan of record until the MVP exit test passes.

## Capabilities and Constraints

- **One opinionated way of working.** Fixed records, fixed states, one shaping primitive (grilling).
  No configurable workflow, no swappable skill packs.
- **Human-only decisions.** Accepting a criterion at review, merging, closing a Stage, confirming an
  Exit test and accepting a Proposal are the Developer's actions, never an agent's.
- **A Story's agent writes its Task checklist** in its first session, after reading the code the Story
  touches; the Developer can edit it at any time. Flywheel never infers ticks from the diff.
- **Checks** are shell commands run by Flywheel at hand-off; a result belongs to the commit it ran on.
- **The session feed is readable:** agent turns as markdown, tool calls and Proposals as structured
  rows, noise left out. A healthy run must not look stalled.
- **Every action the flow needs has a visible control**, not only a palette entry or a hidden key
  (spec §7, Epic #97).
- **Architecture:** no v1 decision may foreclose scheduled automations, teams, a relay, or more agent
  backends; Claude Code is the only backend in v1, behind an adapter interface. The open-source desktop
  app and the commercial cloud layer meet on a clean module seam.
- **Undecided:** the visual world that replaces "Mission Control" (Story #103); the layout of the
  Roadmap strip and roster (Epic M4 "Board and review").

## Brand Commitments

The product is **"Flywheel" by HighKnow**. The name is fixed ("Harness" collides with Harness.io).

**Pinned brand colour: `#3c64dd`** (`hsl(225, 70%, 55%)`), read from the HighKnow logo and pinned by the
owner. **The pin is on the hue, not on the hex:** where `#3c64dd` cannot be read on a surface (it measures
3.66:1 on near-black), the same hue is lifted until it can, and the lift is recorded.

**Mark:** Flywheel ships under the HighKnow lightbulb-brain mark (decided 2026-10-07). Only the app icon,
the About item and the first-run and sidebar surfaces render a logo.

**House method, kept from the HighKnow token file:**
- Contrast is **measured and recorded at the point of decision**, and re-verified by a runnable
  assertion, not by a comment.
- **Meaning never rests on colour alone:** every state carries an icon or a word too.
- Every colour token carries exactly one meaning.
- Type is self-hosted, so an approval on one machine renders identically on another.

**Decided 2026-10-21 (issue #102 input):** the "Mission Control" visual world is **replaced, not
refined**, and all design work goes through the `impeccable` skill. Its look is evidence for the new
direction, not a constraint on it. Its specific rules (no filled buttons, the brand spent only on
progress, square rows, no tinted rows) no longer bind.

## Evidence on Hand

- **Real content to design against:** Flywheel's own backlog in GitHub Issues (Milestones M1 to M5,
  Epics #45 to #65 and #97, their Stories), and the archived `.planning/` tree at the git tag
  `planning-archive`.
- **Owner feedback from the M2 runs:** issue #102 ("navigation is difficult … nothing really stands out
  … elements I expect to be clickable are not … randomly opens the agent … very few icons … I cannot
  quantify project progress at a glance") and Epic #97's comment (writing Milestones, Epics and Stories
  by hand was tedious; no Check was ever added in three runs).
- **Renders of the built app:** `docs/design/critique-2026-10/` (light and dark, every M2 screen), made
  from the real components over seeded data (`packages/desktop/src/test/critique/`).
- **No customers, benchmarks, pricing, testimonials or performance measurements exist.** None may be
  fabricated.

## Product Principles

1. **The board is the store of record.** If the board and any other surface disagree, the board is right
   and the other surface is a bug.
2. **Anchored, never conversational.** Every unit of agent work points at a Story with real Acceptance
   criteria; nothing important lives only in a transcript.
3. **The Developer decides.** Agents propose and ask; acceptance, merge and every Gated action are the
   Developer's explicit, visible act.
4. **Supervision at a glance.** What needs the Developer, what is running and how far the Milestone has
   come must be readable in one look, without opening anything. *(inferred from the #102 input and spec
   §7)*
5. **Predictable over clever.** A click goes where it says, and nothing opens on its own. *(inferred
   from the #102 input)*

## Accessibility & Inclusion

- **Meaning never on colour alone** and **measured contrast** are binding (Brand Commitments).
- Every action the flow needs is reachable from a visible control; the keyboard is an accelerator, not
  the only path.
- No further standard (WCAG level, screen-reader target, localisation) has been set: undecided, not
  waived.
