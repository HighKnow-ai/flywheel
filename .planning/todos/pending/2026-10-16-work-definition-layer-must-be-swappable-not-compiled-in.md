---
created: 2026-10-16T05:33:45.642Z
title: Work-definition layer must be swappable, not compiled in
area: core
severity: major
files:
  - packages/sidecar/src/adapter.ts
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/domain/authoring_session.rs
  - packages/core/src/domain/dispatch_plan.rs
  - packages/core/tests/bin/demo_board.rs
  - .planning/PROJECT.md
---

## Problem

Raised 2026-10-16, mid phase 15, after Cyril read v1.3.1 of
https://github.com/mattpocock/skills and judged it "what we're trying to achieve, already in
a granular form — we just need to make sure to give it the project management board view and
automations."

He asked whether GSD core is hardcoded into Flywheel. It is not, and that is worth recording
so the question is not re-asked:

- No shipped Rust/TS path imports or reads GSD. The only production mentions are comments:
  `packages/core/src/dispatch.rs:8` cites GSD-core as the *model* for the pairwise
  wave-downgrade rule, and `packages/core/src/shim.rs:234` cites a planning doc.
- `.planning/` is read only by dev-only test binaries — `packages/core/tests/bin/demo_board.rs`
  (declared dev-only at `packages/core/Cargo.toml:50`) and `file_board_items.rs`. demo_board
  maps Cycle = roadmap phase, Epic = `*-PLAN.md`, Issue = `todos/pending/*` one-way into a
  SEPARATE database, for the phase-14 demonstration board.
- The board schema is Flywheel's own (`0002_board_schema.sql`), not GSD's files.

**The actual gap is a different seam.** "The harness" is three seams, and only one exists:

1. **Which CLI runs the work** — REAL seam. `packages/sidecar/src/adapter.ts` defines
   `AgentAdapter` + `AdapterCapabilities` (`supportsResume`, `supportsAuthoring`), a
   normalised event stream, and the explicit invariant "no module outside this crate branches
   on a backend name". Two nails hold the door shut rather than a lock — see the sibling todo
   `2026-10-16-agent-runs-adapter-is-written-as-a-constant-never-threaded.md`.
2. **What methodology drives the work** — NO seam. The Socratic challenge stages, the epic
   context packet, and the dispatch prompts are compiled into Rust and TypeScript. Flywheel
   does not supervise a work-definition pack; it *embodies* one. Every phase that compiles
   another prompt or stage rule into core deepens this.
3. **Where board items come from** — only the dev-only demo importer above.

Seam 2 is the one Cyril's mattpocock/skills observation lands on, and the one the existing
v1 constraint ("No v1 decision may foreclose ... additional agent backends") does NOT cover:
that constraint is about seam 1 only.

The corroborating signal already on the board:
`.planning/todos/pending/2026-09-26-socratic-challenge-should-be-structured-like-gsd.md`
(parked for phase 5.1) asks for Socratic challenge to be restructured "the way GSD's own
questioning does" — i.e. Flywheel is already hand-rolling in Rust/TS what an external skill
pack would supply. That todo's resolution space changes if seam 2 exists: adopt a pack rather
than re-implement staged questioning in core. Note phase 15 plan 15-10 edits that file.

## Solution

TBD — needs a design pass, not an implementation guess. What is known:

- **mattpocock/skills is complementary, not competing.** It ships granular user-invoked and
  model-invoked skills, installs as a plugin across Claude Code / Copilot / Codex / Gemini
  CLI, and its coordination skills (`to-tickets`, `implement-spec`, `wayfinder`, `triage`)
  talk to *native issue trackers*. It has no board, no dashboard, and no scheduling — exactly
  the three things Flywheel is. The thesis "give it the board view and automations" is sound.
- Evidence caveat: assessed from the repository landing page, not from the v1.3.1 tag diff.
  Re-read the tag before committing to it as the pack.

Questions a design pass must answer:

- What is the unit of the seam? A pack manifest (skills + their invocation contract) that
  Flywheel reads, versus a prompt-template directory, versus an MCP surface the pack drives.
- Does a task's dispatch name a skill (`implement`, `tdd`, `diagnosing-bugs`) instead of
  carrying a compiled-in prompt? That would make the board item reference the work-definition
  by name, which is the board-native equivalent of what the pack already does by slash command.
- Where does the open/paid boundary fall relative to the pack? PROJECT.md already requires the
  OSS/commercial split to land on a clean module seam; a pluggable pack layer is probably on
  the OSS side.
- How does acceptance criteria authoring (this milestone's whole subject) survive the swap —
  the criteria contract is Flywheel's, the drafting *method* would be the pack's.

Explicitly NOT in scope for this todo: ripping out the existing compiled prompts. The
constraint is "do not foreclose", same as the agent-backend constraint it sits beside.
