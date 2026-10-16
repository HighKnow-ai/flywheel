# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Rendered in a macOS-native WebView inside a Tauri v2 desktop shell. It is a **macOS desktop
application**, not a website: macOS window chrome, the macOS menu bar, ⌘-based key idioms, and
native materials are all in scope. Windows and Linux are explicitly out of v1 (confirmed
2026-09-09).

## Stack

Locked before this record was written, in `.claude/CLAUDE.md` § Technology Stack:
Tauri v2 (Rust core, `rusqlite`/SQLite store of record) + a bundled Node.js sidecar hosting the
Claude Agent SDK + a React renderer. Supporting UI libraries already chosen:
`@tanstack/react-query` (server state), `@tanstack/react-virtual` (list virtualization),
`react-diff-view` and `@monaco-editor/react` (later phases), `@xyflow/react` (later phases),
Zustand or Jotai (local UI state only).

**Binding renderer constraint:** every Tauri `invoke`/`listen` call sits behind one thin adapter
module, so the same React tree can later be pointed at a REST/WebSocket relay client with a
single-file swap.

## Users

**Primary user: a solo developer running "loop engineering"** — continuously draining a backlog by
supervising many AI coding agents at once across many projects, rather than hand-driving one
terminal at a time. Cyril is the first user and the product is designed against his real project
structure.

The situation is sustained, high-frequency, expert desk work: the app is open all day on a
developer's own machine, alongside a terminal and an editor, and is returned to dozens of times an
hour. The job is *supervision* — knowing what every agent is doing, what is blocked, what needs a
human decision, and what to hand out next.

A future team audience (teammates sharing a git repository and sharing project state through a
relay) is a confirmed direction (decision D-20) but not a v1 audience.

## Product Purpose

Flywheel is an Agentic Development Environment: a desktop application that lets one developer
supervise many AI coding agents at once, across many projects, by multiplexing git worktrees.

Work is not organised as chat sessions or as files in a planning folder — it lives as epics, tasks
and issues on a project board that the agents read from *and write to*. The agent challenges the
developer Socratically while an epic is shaped, decomposes it into tasks, fans those tasks out into
isolated worktrees, executes them, and proposes new issues back onto the board as it learns.

Success is that a developer can keep more concurrent agent work in flight, with less lost context
and fewer abandoned threads, than they could by driving terminals by hand.

## Positioning

**Every unit of agent work is anchored to a structured board item with real acceptance criteria —
never a chat blob.** If everything else fails, this must hold.

The mechanism a neighbouring product could not truthfully copy: *the board is the
context-reconstitution mechanism that makes `/clear` free.* A worktree is a cheap, durable resource
owned by a task and outliving many agent sessions; an agent context is expensive, short-lived and
disposable. Chat-native tools cannot discard a context without losing the thread, so their contexts
rot. A board-native ADE can discard contexts constantly and lose nothing, because every new session
reconstitutes from the issue, its acceptance criteria, prior session summaries and the diff so far.

## Operating Context

- **Local-first, credentials-never-leave-the-desk.** Agents run as OS processes on the developer's
  own machine using their existing local agent credentials.
- **Always-on desk companion.** Open all day beside a terminal and an editor; glanced at constantly,
  read carefully occasionally.
- **Multi-project by default.** The user registers several of their own local git repositories as
  projects and moves between their boards. A single fleet-wide store, not one database per repo.
- **Rituals it must serve:** shaping an epic; decomposing it into tasks with acceptance criteria;
  handing work out; checking what is in flight; reviewing a diff; triaging agent-proposed issues.
- **Adjacent tools it sits beside:** the terminal, the editor, `git`, and the forge (GitHub).

## Capabilities and Constraints

**Confirmed for the first phase (the board itself):**
- A fixed three-level hierarchy — epic → task → issue — that cannot be reconfigured.
- A fixed workflow — Backlog → Todo → In Progress → In Review → Done — that cannot be customised.
- Acceptance criteria as discrete, individually checkable rows with their own identity, carried on
  tasks and epics but not on issues. Each is a checkable statement plus a verification hint.
- A human-readable per-project key (`FLY-142`) on every item alongside its ULID, because git branch
  names and commit trailers derive from it. It must be typeable, greppable and stable.
- Manual rank (fractional index) *and* a priority field; priority sorts first, manual rank orders
  within a priority band.
- A nullable coarse `estimate` that nothing aggregates — no velocity, no burndown, no capacity,
  nowhere in the UI. Retrospection comes from measured agent-run data, not human estimates.
- Every mutation is actor-attributed, with humans and agents as distinct actors of one model, and is
  written to an append-only event log in the same transaction as the row it updates.
- The item activity trail renders straight from that event log; there is deliberately no second,
  denormalised history table.

**Binding constraints:**
- **Rigidity is the feature.** Non-configurability is a product commitment, not an unfinished
  settings screen. Never design an affordance to customise the hierarchy or the workflow.
- **Performance is a design constraint, not a later optimisation.** Search, filter, reorder and
  navigation must feel instant on a project holding at least 1,000 items. Virtualised rendering and
  indexed queries from the first build.
- **Search, filter and sort execute as indexed SQL in the Rust core.** There is deliberately no
  second in-memory filtering implementation in the renderer — "the board disagrees with itself" is
  the trust failure this product cannot have.
- **No v1 decision may foreclose** scheduled automations, team collaboration, a mobile/web relay, or
  additional agent backends.
- **The open/paid boundary must fall on a clean module seam.** The desktop app is open source; the
  cloud/relay/teams layer is commercial.
- **Terminology is fixed:** project, epic, task, issue, acceptance criterion, worktree, agent run,
  session, artifact, actor, event.

**Explicitly undecided:**
- The estimate scale itself (S/M/L vs Fibonacci).
- Whether the project key prefix is derived from the repository name or user-chosen, and whether it
  stays editable once items exist.
- Whether search spans projects or is per-project.

## Brand Commitments

The product is **"Flywheel" by HighKnow**. The name is fixed. "Harness" was rejected because it
collides with Harness.io, a large company in the identical category.

**Pinned brand colour: `#3c64dd`** = `hsl(225, 70%, 55%)`. Supplied by the owner on 2026-09-09 as
"main color", and independently pinned in HighKnow's existing token file (`tailwind-preset.css`,
"PINNED BY THE OWNER, 2026-08-17: *Keep my main color*"), where it is recorded as having been read
out of the logo. It outranks any direction that cannot carry it.

**The pin is on the hue, not on the hex** — the owner's own recorded rule: *"a brand that cannot be
read on its own product surface has not been honoured by being pasted in unchanged."* The precedent
set alongside it is `--color-brand-lift: #7d99ff`, the same hue lifted for a dark ground because
`#3c64dd` measures 3.66:1 on near-black and fails AA for body text. Flywheel inherits the rule, and
derives its own lifts where its own grounds require them.

**The HighKnow mark** (`logo.svg`, 1024×1024, `rx=200`): a lightbulb whose filament is a brain, with
**H** and **K** formed by the two hemispheres. White line-art of uniform weight with rounded joins,
drawn as filled outlines rather than strokes, on a brand-blue rounded square. This is the **company**
mark. Whether Flywheel ships it as its own product mark, or earns a distinct one under it, is an open
decision for the owner.

**Inherited house method** — demonstrated by the existing token file and adopted here as discipline,
not as values:
- Contrast ratios are **measured and recorded at the point of decision**, and re-verified by a
  runnable assertion rather than by the comment claiming it.
- Every colour token carries **exactly one meaning**; giving a reserved signal a second job spends it.
- Secondary text on a tinted surface is **tinted from that surface's hue, never neutral grey**.
- Type is **self-hosted for reproducibility**, so an approval on one machine renders identically on
  another.
- **Exactly one easing curve** across the product.
- **Meaning never rests on colour alone** — every state carries an icon or a label too.

**Not inherited: the sibling product's token values.** `tailwind-preset.css` is HighKnow's
*call-capture* product — its light "companion" scale and dark "overlay" scale were derived from that
product's scenes (a panel floating over a customer's video tile; a sit-and-read summary surface).
Flywheel's scene is a dense, all-day, keyboard-driven board on a developer's macOS desktop, and its
own scale must be derived from that scene. Public Sans, the neutral ramps, and the semantic accents
(`--color-absent`, `--color-warn`, `--color-error`) are precedent to reason from, not defaults to
adopt.

**Decided (2026-10-07):** Flywheel ships under the HighKnow lightbulb-brain mark. Flywheel earning
its own mark under the HighKnow name stays available if it ever gets a commercial identity of its
own. Only the app icon, the About item and the first-run and project-rail surfaces render a logo.

(The visual world itself was settled on 2026-09-09 in an Impeccable direction round and lives in
`planning-archive:.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md`, not here — a visual world is
not product truth.)

## Evidence on Hand

- Real project artifacts to design against: this repository's former `.planning/` structure (git tag
  `planning-archive`) — a real
  roadmap of 11 phases, 93 requirements, and phase context documents. This is genuine content of
  exactly the shape the board must hold, and it is the honest source for demonstration data.
- **No customers, benchmarks, pricing, testimonials, uptime figures, or performance measurements
  exist.** None may be fabricated. The "1,000 items with no perceptible lag" figure is a
  *requirement to meet*, not a measured result to advertise.
- No screenshots, logos, or marketing material exist yet.

## Product Principles

1. **The board is the store of record.** If the board and any other surface disagree about what
   happened, the board is right and the other surface is a bug.
2. **Rigidity over configurability.** A fixed hierarchy and a fixed workflow are the product. Every
   settings affordance not shipped is a decision, not an omission.
3. **Anchored, never conversational.** Every unit of agent work points at a structured item with
   real acceptance criteria. Nothing important lives only in a chat transcript.
4. **Attribution is not optional.** Every change names its actor and its moment. Humans and agents
   are peers in one actor model, and the trail is readable by a person, not just by a sync engine.
5. **Supervision speed is the felt quality.** This is expert software used all day at high
   frequency; keystroke latency, information density and predictable focus outrank first-run charm.

## Accessibility & Inclusion

- **Full keyboard operability is a hard product requirement (BOARD-07), not an accessibility
  nicety.** Board navigation and every common item action must be drivable entirely from the
  keyboard, with a ⌘K command palette as the discoverable escape hatch so coverage is never gated on
  memorising bindings.
- Beyond that, no product-specific standard (WCAG level, screen-reader target, localisation) has
  been established. Undecided, not waived.
