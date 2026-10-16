---
created: 2026-10-16T05:33:45.642Z
title: agent_runs.adapter is written as a constant, never threaded
area: core
severity: minor
files:
  - packages/sidecar/src/index.ts:142
  - packages/core/src/domain/dispatch_plan.rs:1301
  - packages/core/src/domain/agent_run.rs:265
  - packages/core/src/domain/agent_run.rs:314
  - packages/core/src/domain/authoring_session.rs:114
  - packages/core/src/domain/authoring_session.rs:165
---

## Problem

Found 2026-10-16 while answering Cyril's question "can we ensure the harness we are using is
easily interchangeable?" (see sibling todo
`2026-10-16-work-definition-layer-must-be-swappable-not-compiled-in.md`).

The agent-backend seam is real and well kept: `packages/sidecar/src/adapter.ts` defines
`AgentAdapter` + `AdapterCapabilities` and asserts that no module outside the sidecar branches
on a backend name. `agent_runs.adapter` exists as a genuine discriminator column —
`0003_agent_runtime.sql:71` describes it as "AGNT-01's backend-name discriminator, defaulted to
the only adapter this phase implements."

But the column is never *written* as a variable. Every insert site hardcodes the string
literal:

- `packages/core/src/domain/dispatch_plan.rs:1301`
- `packages/core/src/domain/agent_run.rs:265` and `:314`
- `packages/core/src/domain/authoring_session.rs:114` and `:165`

and the sidecar constructs exactly one adapter unconditionally:

- `packages/sidecar/src/index.ts:142` — `const adapter = new ClaudeCodeAdapter();`

So the schema is multi-backend ready while the writers are not. A second adapter could be
added without any core refactor, but the rows it produced would claim to be `claude_code` runs,
and nothing would route a dispatch to it. The door is nailed shut rather than locked.

This does not break anything today — Claude Code is the only v1 backend by explicit
constraint, and the column defaults correctly. It is logged because the cost of opening it is
near zero now and grows with every new insert site that copies the literal.

## Solution

Thread the adapter name instead of spelling it:

1. Give the Rust core one source for the active backend name (a constant or a resolved
   setting), and pass it as a bound parameter at the five insert sites rather than inlining
   `'claude_code'`.
2. In the sidecar, resolve the adapter through a small registry keyed by that same name,
   so `index.ts` picks an adapter rather than constructing the only one. The
   `AdapterCapabilities` gate already handles "this adapter cannot do that" correctly.
3. Add a gate test in the spirit of the existing `pm_vocabulary_gate` / `handler_roster`
   pins: fail if a new `INSERT INTO agent_runs` spells a backend name as a literal.

Keep it to plumbing — no second adapter is implied, and v1 stays Claude Code only per
PROJECT.md's Agent backend constraint. The point is that adding one later should not require
touching five domain modules.
