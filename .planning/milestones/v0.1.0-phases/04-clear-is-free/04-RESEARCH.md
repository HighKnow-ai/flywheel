# Phase 4: `/clear` Is Free - Research

**Researched:** 2026-09-23
**Domain:** Deterministic context reconstitution over an existing Rust/SQLite board + Node sidecar/MCP write surface — no new external technology, a continuation of three phases' established internal patterns.
**Confidence:** HIGH

## Summary

This phase adds no new library, framework or external service. Every mechanism it needs —
transactional row-write-plus-event append, MCP tool servers relayed over a per-run Unix socket,
`git -C <path>` shelled through one wrapper function, SQLite CHECK-constraint table rebuilds,
capability-gated adapter methods — already exists in this codebase, built and tested across
Phases 1–3. The research task here is therefore not "what library should we use" but "which
existing function does this decision extend, and at which exact line." That mapping is what this
document provides, grounded by reading the actual source files CONTEXT.md's canonical-refs
section names.

The central engineering fact the planner must internalize: `assemble_context_packet` /
`render_prompt` in `packages/core/src/context_packet.rs` is a 241-line, already-shipped,
already-`PartialEq`-deriving pure query function `[VERIFIED: packages/core/src/context_packet.rs:1-17]`.
Its own header comment states the contract this phase must not break: "no model call, no network
call, **no git call and no write of any kind**." D-70's diff-so-far section is the first thing
that pressures that contract, and the correct resolution — confirmed by reading the codebase, not
assumed — is to add a git-shelling helper beside the ONE existing `git_at` wrapper in
`packages/core/src/git.rs`, and call it from a thin new function, keeping
`assemble_context_packet`'s own body a pure query while the *packet assembly* layer one level up
(the command handler, not the domain query) composes packet + diff-stat before handing both to
`render_prompt`. This keeps the tested "no git call inside this function" property true of the
literal function while still shipping D-70's requirement — a distinction the plan must state
explicitly, because the file's own doc comment is exactly specific enough to be violated by
accident.

The second load-bearing fact: the MCP write-surface question CONTEXT.md leaves as Claude's
Discretion (D-64's `report_summary` tool — new server vs. new tool on the existing server vs. new
sidecar op) has a single answer once the actual code is read. `mcp-permission-server.ts` opens a
**per-run** Unix socket (`flywheel-permission-${randomUUID()}.sock`, one per `startSession` call)
`[VERIFIED: packages/sidecar/src/mcp-permission-server.ts:143]`, and its standalone MCP server
process already registers its tool list from a `tools: []` array inside one `ListToolsRequestSchema`
handler `[VERIFIED: packages/sidecar/src/mcp-permission-server.ts:234-239]` — the MCP protocol
supports multiple tools per server natively; nothing about the one-tool-today shape is a structural
limit. Adding `report_summary` as a **second tool on the same server, relayed as a second message
kind over the same per-run socket** (exactly the precedent Plan 03-13/D-53 already set for the PATH
shim's git-retry notice) requires zero new `--mcp-config` entry, zero new spawned process, and zero
new socket-lifecycle code — only a second `case` in the tool-call handler and a second payload shape
on the wire. This is a `MEDIUM`-confidence architectural recommendation (the actual choice is
correctly left to the planner/builder per D-64's own discretion note), but it is the option the
existing code already argues for most strongly, and the research below shows why the two rejected
alternatives (a second MCP server process, a new sidecar stdio op) each require reproducing
machinery — socket lifecycle or argv wiring — that already exists and works.

**Primary recommendation:** Extend, never replace, four already-shipped surfaces —
`context_packet.rs` (packet contents), `mcp-permission-server.ts` (write surface), `git.rs` (diff
reads), and the `apply_session_closed` / `handle_inbound_session_closed` pair in
`packages/core/src/domain/agent_run.rs` / `packages/desktop/src-tauri/src/commands/agent_run.rs`
(fallback synthesis trigger point) — following each file's own stated invariants to the letter,
because every one of them has a `<verify>`-gated test suite already asserting those invariants and
a plan that violates one will fail CI, not just review.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Context packet assembly (task/epic/criteria/worktree facts) | Rust core (`context_packet.rs`) | — | Already the shipped D-28 stub; a pure SQL query, no I/O beyond `rusqlite` |
| Diff-so-far (committed + uncommitted, D-70/D-71) | Rust core (new fn beside `git_at` in `git.rs`) | Command-handler layer (composes packet + diff before `render_prompt`) | `git.rs` is the one file allowed to construct `Command::new("git")` (PROC-02); the pure-query file must stay pure |
| Summary write (`report_summary`, D-64) | Node sidecar (MCP tool call, per-run socket) | Rust core (domain handler writing the row + event in one transaction) | The agent process only ever reaches the board through the sidecar's MCP surface (ARCHITECTURE §6 Anti-Pattern 2); the transactional write itself is Rust-core-owned, matching every other mutation in this codebase |
| Fallback (`auto_generated`) summary synthesis | Rust core (`apply_session_closed` / its caller `handle_inbound_session_closed`) | — | Already the exactly-once terminal-event consumer for every session regardless of close reason; the natural "did a summary land? if not, synthesize" checkpoint |
| Compaction (verbatim window + fold) | Rust core (new pure function beside `context_packet.rs`, or a sibling module) | — | D-68: no model anywhere; a pure fold over `Vec<SessionSummary>`, same purity class as `assemble_context_packet` itself |
| Drift detection (D-72/D-73) | Rust core (derive-at-read-time, per `query/events.rs`'s own discipline) | — | Re-derived on every packet assembly, never stored (D-75); matches `query/events.rs`'s stated house rule verbatim |
| Discard verb + launch-sheet pre-fill (D-66/D-67) | Desktop/React (`SessionSurface.tsx`, `LaunchSheet.tsx`) | Rust core (the same `agent_run_preview`/`agent_run_start` commands already wired) | D-27's launch sheet already exists as the target surface; no new surface |
| Criteria revision (D-77/D-78/D-79) | Rust core (`acceptance_criterion.rs` extension + migration) | Desktop/React (`AcceptanceCriteriaList.tsx`) | Schema-is-the-authority pattern (Phase 1); a superseded-row link, not app-code enforcement |
| Multi-cycle test harness (CTX-07) | Rust integration tests (`packages/core/tests/`) primary, sidecar `node --test` secondary | — | `ContextPacket` already derives `PartialEq` — the determinism half needs no agent at all; the cycle-driving half needs `fake-claude.mjs` or a real session per the still-open discretion item |

## Standard Stack

No new external dependency is introduced by this phase. Every mechanism below is an existing,
already-pinned dependency in this workspace, confirmed by reading the actual manifest files this
session.

### Core (already present — no version change)
| Library | Version (as pinned in this repo) | Purpose | Why no change needed |
|---------|------|---------|--------------|
| `rusqlite` | `0.40` with `bundled, serde_json, chrono` features `[VERIFIED: packages/core/Cargo.toml:27]` | Embedded SQLite in the Rust core | New tables/columns are additive migrations against the same driver; no new capability required |
| `rusqlite_migration` | `2.6` `[VERIFIED: packages/core/Cargo.toml:28]` | Versioned schema migrations | Migration `0008` (new `session_summaries` table) and the `acceptance_criteria`/`agent_runs` additive columns (D-77/D-78) are ordinary `up()` steps in the same crate already vendored |
| `@modelcontextprotocol/sdk` | `1.30.0` `[VERIFIED: packages/sidecar/package.json:16, cross-checked via \`npm view @modelcontextprotocol/sdk version\` returning 1.30.0]` | MCP tool server (sidecar-hosted) | Confirmed current; multi-tool-per-server is a base MCP capability this SDK version already exposes (the existing file registers one tool via a `tools: []` array — extending that array needs no SDK upgrade) |
| System `git` CLI | measured minimum `2.54.0` on this machine `[VERIFIED: packages/core/src/git.rs:182, "the version measured on this machine"]` | Diff-so-far (D-70/D-71), worktree lifecycle | `git diff --stat`/`--name-only` and `git status --porcelain` are both ordinary invocations of the git CLI already shelled out to via `git_at`; no new git feature is required |

### Supporting (no new packages — extension points only)
| Component | Extends | When to Use |
|-----------|---------|-------------|
| `packages/core/src/git.rs`'s `git_at` wrapper | Add a `diff_stat_and_names(repo_path, base_ref) -> anyhow::Result<(String, Vec<String>)>`-shaped sibling function, following `git_status_porcelain`'s exact "no parsing of its own" convention | D-71's `--stat` + changed-path list, D-70's committed-range section |
| `packages/sidecar/src/mcp-permission-server.ts` | Second tool registration (`report_summary`) in the same `tools: []` array, second `case` in the `CallToolRequestSchema` handler, second payload `kind` on the same per-run socket | D-64's write surface |
| `packages/core/src/domain/acceptance_criterion.rs` | New `revise_criterion(conn, actor_id, criterion_id, new_statement) -> AcceptanceCriterion` alongside existing `create_criterion`/`update_criterion`/`toggle_criterion`/`reorder_criterion` — same one-`conn.transaction()` shape | D-77 |
| `packages/core/src/domain/agent_run.rs`'s `apply_session_closed` | Extend to check for an existing `session_summaries` row keyed by `agent_run_id`; if absent, synthesize one flagged `auto_generated` from the diff + event log, in the SAME transaction `close_agent_run` already opens | D-64's fallback |

### Alternatives Considered (already resolved by the code, not by this research)
| Instead of | Could use | Why rejected |
|------------|-----------|--------------|
| Second tool on the existing MCP server (recommended) | A brand-new, second standalone MCP server process for `report_summary` | Requires a second `--mcp-config` server entry, a second spawned process per session, and a second socket-lifecycle implementation — `mcp-permission-server.ts`'s existing per-run-socket machinery is reusable wholesale, this would duplicate it |
| Second tool on the existing MCP server | A new op on the sidecar's own stdio protocol (like `spawn`/`interrupt`/`permission_answer`) `[VERIFIED: packages/sidecar/src/index.ts:143-225, the full op switch]` | That protocol is Rust-core ↔ sidecar-process control plane (spawn/kill/ping/shutdown), not an agent-facing tool surface; the agent process itself never speaks this protocol directly — routing a model-emitted tool call through it would require a new bridge the MCP path doesn't need |
| A pure Rust fold for compaction (D-68, already decided) | A model-written epoch summary | Explicitly rejected in CONTEXT.md D-68 against PITFALLS.md pitfall 3's own named failure mode; no research changes this |

**Installation:** none — no new dependency to add to any manifest.

## Package Legitimacy Audit

**Not applicable.** This phase installs no new package in any ecosystem. Every component referenced
above is an already-pinned dependency, confirmed present in `packages/core/Cargo.toml` and
`packages/sidecar/package.json` by direct read this session. If the planner's task decomposition
surfaces a genuine new dependency need during implementation (e.g., a compaction algorithm helper
crate), route it back through this gate before adding it — none is anticipated by this research.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────────────────┐
                     │                    Rust core (Tauri)                     │
                     │                                                           │
  Discard action ───►│  agent_run_preview / agent_run_start (existing commands) │
  (LaunchSheet.tsx,   │        │                                                 │
   D-66/D-67)         │        ▼                                                 │
                     │  assemble_context_packet(task_id)  [pure query, existing] │
                     │        │                                                 │
                     │        ├──► NEW: diff_stat_and_names(worktree, base_ref)  │
                     │        │      (git.rs sibling of git_at — committed range │
                     │        │       + working-tree porcelain, D-70)           │
                     │        │                                                 │
                     │        ├──► NEW: fetch last-N session_summaries          │
                     │        │      + NEW: compact_summaries() pure fold (D-68)│
                     │        │                                                 │
                     │        └──► NEW: derive drift warnings (D-72/D-73/D-75)  │
                     │               re-derived every call, never stored        │
                     │        │                                                 │
                     │        ▼                                                 │
                     │  render_prompt(packet, instruction)  [existing + new     │
                     │   sections: summaries, compaction boundary, diff, drift] │
                     │        │                                                 │
                     └────────┼─────────────────────────────────────────────────┘
                              │  startSession(prompt, env, runId)
                              ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │              Node sidecar (per-run process)              │
                     │                                                           │
                     │  claude-code-adapter.ts spawns:                          │
                     │   1. `claude` CLI (headless, stream-json)                │
                     │   2. startPermissionServer() → per-run Unix socket       │
                     │       (flywheel-permission-<uuid>.sock, existing)        │
                     │                                                           │
                     │  `claude` itself spawns the STANDALONE MCP server        │
                     │  process per --mcp-config, hosting BOTH tools now:       │
                     │    - approve_action (existing, AGNT-06)                  │
                     │    - report_summary (NEW, D-64) ─┐                       │
                     │                                    │ same socket,        │
                     │                                    │ second `kind`       │
                     │                                    ▼                     │
                     │  sidecar relays the tool call as a NEW AgentEvent        │
                     │  (e.g. `summary_reported`, carries `runId` per the       │
                     │  existing AgentEventBase.runId contract) over stdout     │
                     └────────┼─────────────────────────────────────────────────┘
                              │  stdout JSON line
                              ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │        Rust core sidecar reader loop (existing)          │
                     │  sidecar.rs's reader task, alongside the existing        │
                     │  `session_closed` branch (line ~1127) — NEW branch for   │
                     │  `summary_reported` calling a NEW domain handler that:   │
                     │   1. opens one conn.transaction() (matches              │
                     │      acceptance_criterion.rs / permission_request.rs)    │
                     │   2. writes the session_summaries row                    │
                     │   3. next_sequence + append_event in the SAME tx         │
                     │   4. commits                                             │
                     │                                                           │
                     │  SessionClosedEvent.reason arrives later (exactly once,  │
                     │  existing) → handle_inbound_session_closed → checks: was │
                     │  a summary row already written for this agent_run_id?    │
                     │  NO → synthesize one from diff + events, flag            │
                     │  auto_generated (D-64's fallback)                        │
                     └───────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions only — no restructuring)
```
packages/core/src/
├── context_packet.rs        # extend: packet gains summaries/compaction/drift/diff fields
├── git.rs                   # extend: diff_stat_and_names() sibling of git_at
├── compaction.rs            # NEW: pure fold, no I/O — compact_summaries(&[SessionSummary]) -> CompactedHistory
├── drift.rs                 # NEW: pure detectors, no I/O — detect_drift(packet_inputs) -> Vec<DriftWarning>
├── domain/
│   ├── session_summary.rs   # NEW: create_summary/list_summaries/synthesize_fallback_summary
│   ├── acceptance_criterion.rs  # extend: revise_criterion()
│   └── agent_run.rs          # extend: apply_session_closed checks for existing summary before synth
└── db/migrations/
    └── 0008_session_summaries_and_revisions.sql  # NEW table + additive columns

packages/sidecar/src/
├── mcp-permission-server.ts  # extend: second tool `report_summary`, second socket message kind
└── claude-code-adapter.ts    # extend: relay report_summary calls as a new AgentEvent variant

packages/desktop/src-tauri/src/
├── sidecar.rs                 # extend: reader-loop branch for the new event
└── commands/agent_run.rs      # extend: new domain handler call site

packages/desktop/src/
├── launch-sheet/LaunchSheet.tsx        # extend: render summaries/compaction boundary/diff/drift
├── session/SessionSurface.tsx          # extend: discard verb (D-66/D-67)
├── item-detail/AcceptanceCriteriaList.tsx  # extend: "revised" marker (D-79)
└── item-detail/RunsSection.tsx         # likely surface for rendered summaries (open per CONTEXT.md discretion)
```

### Pattern 1: One-transaction row-write-plus-event (already the house style)
**What:** Every mutation in this codebase opens exactly one `conn.transaction()`, writes the
projection row, calls `next_sequence` + `append_event` inside the SAME transaction, then commits.
**When to use:** The `report_summary` handler's row write, and `revise_criterion`'s row write —
both are new mutations and must follow this shape or they break the DATA-01 invariant every
existing table already upholds.
**Example (the actual pattern, quoted from the real file this phase's new code must match):**
```rust
// Source: packages/core/src/domain/acceptance_criterion.rs (module header, verbatim)
// "each mutation opens exactly one `conn.transaction()` and commits the projection row and its
//  event together (DATA-01), following `task.rs::create_task`'s shape."
```
```rust
// Source: packages/core/src/domain/permission_request.rs:212, 343 — append_event called inside
// the same transaction as the row write, for both create_pending_request and answer_request.
```

### Pattern 2: The one-and-only `git_at` construction site
**What:** `packages/core/src/git.rs` is the ONE place in the workspace allowed to construct
`Command::new("git")`, structurally asserted by `packages/core/tests/supervisor_cwd.rs`
`[VERIFIED: packages/core/src/git.rs:1-4, module header]`. Every call passes `-C <repo_path>` as
the first two arguments before any subcommand token (PROC-02 ordering).
**When to use:** D-70/D-71's diff-so-far read. Add a sibling function next to
`git_status_porcelain` — do not add a second `Command::new("git")` site anywhere else, or the
existing structural test fails the build.
**Example:**
```rust
// Source: packages/core/src/git.rs:140-143 (the exact convention the new diff function must copy)
pub fn git_status_porcelain(worktree_path: &Path) -> anyhow::Result<String> {
    let output = git_at(worktree_path, &["status", "--porcelain"])?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
```
A new `diff_stat_and_names` should follow this exact shape: call `git_at(repo_path, &["diff",
"--stat", &format!("{base}...HEAD")])` for the committed section and reuse the already-existing
`git_status_porcelain` for the uncommitted section (D-70 explicitly says to reuse this parse, not
re-derive it — `[CITED: 04-CONTEXT.md D-70, "D-42 already renders git status --porcelain rows...
the untracked-file shape exists to reuse"]`).

### Pattern 3: Capability-gated adapter methods
**What:** A method an adapter does not implement rejects with `CapabilityUnsupportedError` rather
than throwing an unhandled exception or silently no-op'ing.
**When to use:** If `report_summary`-style tool exposure is adapter-specific (Claude Code has it;
a future Codex/Gemini adapter might not), add a capability flag to `AdapterCapabilities` mirroring
the existing `supportsResume`/`supportsPermissionPrompt`/`supportsCostReporting` shape.
**Example:**
```typescript
// Source: packages/sidecar/src/adapter.ts (verbatim shape, existing)
export interface AdapterCapabilities {
  supportsResume: boolean;
  supportsPermissionPrompt: boolean;
  supportsCostReporting: boolean;
}
```
A `supportsSummaryReporting: boolean` field follows this exact convention. When `false`, the
Supervisor should expect `auto_generated` fallback summaries to be the *only* kind ever produced
for that adapter — not an error path, since D-64's fallback is designed to cover exactly this case.

### Pattern 4: Per-run socket scoping closes the spoofing question for `report_summary`
**What:** `startPermissionServer` opens a socket with a fresh UUID per `startSession` call
`[VERIFIED: packages/sidecar/src/mcp-permission-server.ts:143, "flywheel-permission-${randomUUID()}.sock"]`.
Because this socket is created inside the SAME Node closure that already knows `options.runId`
(from `StartSessionOptions`), and every `AgentEvent` this sidecar emits already carries a `runId:
string` field on its base shape `[VERIFIED: packages/sidecar/src/adapter.ts:17-18]`, the `run_id`
a `report_summary` call is attributed to must be **derived from the socket/session context the
call arrived on, never accepted as a tool-call argument.** This closes a real security question
before it is asked: an argument-supplied `run_id`/`task_id` would let a compromised or
confused agent process attribute a summary (and its `decisions` list, which D-73's read-back
trusts) to a run it is not actually driving.
**When to use:** The `report_summary` MCP tool's input schema should carry only `changed`,
`remains`, `next_session_must_know`, `decisions` — never an id field for the run/task it belongs
to. The Rust-core-side handler resolves `agent_run_id` from the connection/event context that
carried the call up from the sidecar, exactly as `handle_inbound_permission_request` already does
for `permission_request` events today.

### Anti-Patterns to Avoid
- **Adding a second `Command::new("git")` construction site anywhere outside `git.rs`:** breaks a
  structural test (`supervisor_cwd.rs`) that exists specifically to prevent this.
- **Accepting a caller-supplied `run_id`/`task_id` argument on the `report_summary` tool schema:**
  defeats the per-run-socket scoping property that makes the write surface trustworthy (see
  Pattern 4).
- **Storing a computed drift verdict as a column:** D-75 explicitly rejects this — re-derive on
  every read, matching `query/events.rs`'s "derive at read time, never store" rule.
- **Calling `assemble_context_packet` and expecting it to have already read git state:** the
  function's own header comment says it makes "no git call... of any kind" — the diff must be
  fetched by the caller (the command handler) and passed alongside the packet into whatever
  composes the final `render_prompt` input, or the function's tested contract breaks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema-versioned migrations | A hand-rolled "has this migration run" table | `rusqlite_migration` (`2.6`, already vendored) | Already used for every prior migration; a bespoke tracker for just this phase would fork the migration story |
| CHECK-constrained column addition (D-77's `revision` column needs no CHECK, but any adjacent status/enum work does) | An `ALTER TABLE ... ADD CONSTRAINT` (SQLite cannot do this) | The CREATE-TABLE-`_new`/INSERT/DROP/RENAME sequence already worked out in `0006_recovery_statuses.sql` | SQLite genuinely cannot alter a CHECK constraint in place; this migration is the copy-paste template, already verified against a real `sqlite3` binary for the foreign-key-toggle gotcha |
| Git diff parsing | A custom diff-hunk parser | `git diff --stat` / `--name-only` raw stdout, unparsed, exactly like `worktree_list`'s "no parsing of its own" convention | The packet never embeds hunks (D-71) — there is nothing to parse beyond a stat block and a path list |
| MCP tool server plumbing | A second bespoke IPC channel for the agent to write summaries | The existing per-run Unix socket + MCP `tools: []` array | Already built, already tested, already has the exact "second message kind on one socket" precedent from D-53 |
| Detecting agent-vs-board contradiction | An LLM call comparing prose | D-72/D-73's three fact-based detectors (file-list diff, `diff_ref` staleness, criteria-revision pin) plus D-73's id-echo read-back | CONTEXT.md already rejected the model-based alternative explicitly (non-deterministic, unverifiable across 5 cycles) — this is settled, not open |

**Key insight:** Every "don't hand-roll" item in this phase is really "don't build a second
version of a mechanism that already exists two directories away." The phase's actual risk is not
missing library knowledge — it is accidentally duplicating `git.rs`'s git-shelling, `events.rs`'s
derive-at-read-time discipline, or `mcp-permission-server.ts`'s socket relay, each of which has its
own test suite that a duplicate implementation would not inherit.

## Common Pitfalls

### Pitfall 1: Context rot reborn inside the fix for context rot (PITFALLS.md pitfall 3 — the project-killer this phase owns)
**What goes wrong:** Session-summary quality degrades across successive summarize-then-resummarize
cycles; specific function names, rejected alternatives and decisions collapse into vaguer prose
each pass, and a fresh agent "re-derives" a conclusion it has no reasoning trail for.
**Why it happens:** This is a structural property of LLM-produced compressed context, not an
implementation bug — the same physics the product's whole `/clear`-is-free thesis is betting
against, one layer down `[CITED: .planning/research/PITFALLS.md pitfall 3]`.
**How to avoid:** Everything CONTEXT.md's D-64 through D-79 chain already encodes: append-only
summaries (never overwritten), a pure-Rust compaction fold with no model anywhere (D-68), criteria
that are structured, immutable-per-revision fields never folded into prose (D-77/D-79), the diff as
ground truth alongside any narrative (D-70/D-71), and fact-based (never semantic) drift detectors
(D-72/D-73). The plan must not "solve" any part of this with a model call, even a small one, at
compaction time or at drift-detection time — that is precisely PITFALLS.md's named failure
resurrected inside the fix.
**Warning signs:** A plan task that says "have the model re-summarize the last N summaries into a
shorter epoch summary" or "have the model check whether the new session's stated understanding
matches the decisions" — both are the exact rejected alternatives named in D-68 and D-72/D-73.

### Pitfall 2: Breaking `context_packet.rs`'s "no git call" contract by accident
**What goes wrong:** A well-intentioned edit adds a `git_at` call directly inside
`assemble_context_packet`, because that is the obvious place to add "the diff." This silently
breaks a tested purity property (`ContextPacket` is used elsewhere as a preview with "nothing
happens until Start Work fires," per the file's own header comment about `predict_base_ref`) and
couples a fast board-only preview to a git subprocess spawn.
**Why it happens:** The function's job (assemble everything the agent needs) and its purity
contract (no I/O beyond `rusqlite`) look like they're in tension once D-70 is added, and the path
of least resistance is to just add the call.
**How to avoid:** Keep `assemble_context_packet` itself pure. Add the diff fetch as a sibling step
the *caller* (`agent_run_preview` / `agent_run_start` command handlers) performs and passes into
whatever renders the final prompt — the header comment's own reasoning (a preview must never
mutate anything or spawn a process) applies just as much to spawning `git diff` as it did to
cutting a branch.
**Warning signs:** A new `git_at`/`Command::new` call appearing inside `context_packet.rs` itself,
or a test for `agent_run_preview` that now takes measurably longer / shells out where it didn't
before.

### Pitfall 3: Treating the `report_summary` tool's argument shape as freely revisable later
**What goes wrong:** CONTEXT.md's D-64 flags this reversibility cost explicitly: "the tool's name
and argument shape become part of what every session is prompted to call." Once shipped, changing
the shape is not a local refactor — it changes what every future agent invocation is told to send.
**Why it happens:** Early implementations tend to under-specify a tool schema and patch it once
real sessions reveal gaps.
**How to avoid:** Lock the four-field shape (`changed` as file-list-plus-prose, `remains`,
`next_session_must_know`, `decisions` as a list) from D-65 before writing the MCP tool's
`inputSchema` — this is not an incremental decision, it is the one D-65 already made and priced as
"one-way — the field set is a migration."
**Warning signs:** A plan task that treats the `report_summary` schema as a "first pass, refine
later" deliverable.

### Pitfall 4: Multi-cycle test that only exercises session 1 → 2
**What goes wrong:** PITFALLS.md's own "Looks Done But Isn't" checklist names this directly:
context reconstitution is often "tested" only on the first handoff, which is exactly the case
where accumulated drift has not yet had a chance to appear.
**Why it happens:** A single-cycle test is much cheaper to write and "looks" like coverage.
**How to avoid:** CTX-07 requires at least five cycles — build the synthetic harness (driven by
`fake-claude.mjs` or a real session, per the still-open discretion item) so the SAME task runs
through five real `report_summary` calls and asserts acceptance criteria are byte-identical at the
end, not just after cycle one.
**Warning signs:** A test file with one `#[test]` function that starts a session, ends it, starts a
second, and calls that "CTX-07 covered."

## Code Examples

### The determinism property that already exists — write this test first
```rust
// Source: packages/core/tests/context_packet.rs:34-... (existing, verbatim shape)
// This is the load-bearing case the plan should extend, not replace: two calls against an
// unchanged database are byte-identical; a criterion reorder changes the output.
#[test]
fn determinism_two_calls_are_byte_identical_and_a_reorder_changes_the_output() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        // ... create_epic / create_task / create_criterion, then:
        // assert_eq!(assemble_context_packet(&conn, &task.id)?, assemble_context_packet(&conn, &task.id)?);
    });
}
```
CTX-04's determinism claim is provable today with zero agent involvement, exactly as
CONTEXT.md's Specific Ideas note: `ContextPacket` already derives `PartialEq`. Extend this same
test file with summaries/compaction/diff/drift fields as they're added — do not write a parallel
determinism test elsewhere.

### The one-transaction write shape new mutations must copy
```rust
// Source: packages/core/src/domain/permission_request.rs (module header, verbatim)
// "one `conn.transaction()`, the row write, `next_sequence` + `append_event` inside it, one
//  commit" — copy this shape for the new session_summaries row write and for revise_criterion.
```

### The MCP tool registration shape to extend
```typescript
// Source: packages/sidecar/src/mcp-permission-server.ts:232-251 (existing shape, paraphrase-free
// structure — the actual tool list and call-handler switch, extend both with a second entry)
const server = new Server({ name: MCP_SERVER_NAME, version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [ /* existing approve_action entry */ /* NEW: report_summary entry */ ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // existing approve_action branch; NEW: report_summary branch relays over the same socket
  // with a distinct `kind` field, mirroring PermissionNoticePayload's own `kind` discriminator
  // (packages/sidecar/src/mcp-permission-server.ts:70-78).
});
```

## State of the Art

Not applicable in the "library X was superseded by Y" sense — nothing in this phase's dependency
set has changed. The relevant "old vs. current approach" axis is internal to this project's own
history:

| Prior approach (Phase 2 stub) | Current approach (this phase) | When changed | Impact |
|--------------------------------|-------------------------------|---------------|--------|
| `assemble_context_packet` returns task/epic/criteria/worktree only (D-28) | Gains summaries, compaction boundary, diff-so-far, drift warnings (D-64–D-75) | This phase | `render_prompt` gains new sections following its existing "omit the heading rather than emit empty" rule |
| Native `--resume`/`--continue` deliberately unimplemented (D-30) | Unchanged — every Start Work is still a fresh session | N/A | CTX-08 ("discard and start fresh in one action") is nearly satisfied by this pre-existing choice, per CONTEXT.md's own note |
| `agent_runs.status` has no `abandoned`-adjacent "did this produce a summary" signal | New: a summary-presence check inside `apply_session_closed` | This phase | The fallback synthesis trigger point |

**Deprecated/outdated:** nothing in this phase deprecates prior work; it is additive to Phase 2's
D-28 stub by that stub's own design ("a genuine stub of this phase's ContextAssembler... Phase 4
adds inputs, it does not replace them" — CONTEXT.md canonical-refs).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `report_summary` should be a second tool on the existing `mcp-permission-server.ts` process rather than a new server or a new sidecar op | Architecture Patterns, Standard Stack Alternatives | Low-medium: this is explicitly Claude's Discretion per CONTEXT.md, and the recommendation is grounded in reading the actual per-run-socket and multi-tool-registration code, but the planner/builder could reasonably choose a new server for cleaner separation; if so, the socket-lifecycle code must be duplicated deliberately, not accidentally |
| A2 | A new `supportsSummaryReporting` capability flag should be added to `AdapterCapabilities` | Architecture Patterns (Pattern 3) | Low: matches an established convention exactly, but the field name itself is invented for this document, not read from any spec |
| A3 | The diff-fetch for D-70/D-71 belongs in the command-handler layer (`agent_run_preview`/`agent_run_start`), not inside `assemble_context_packet` itself | Summary, Architecture Patterns (Pattern 2), Pitfall 2 | Medium: this is the single most consequential structural call in this research; if the planner instead extends `assemble_context_packet`'s own signature to accept a git-reading callback, that is also defensible, but changes the function's tested purity guarantee and its existing unit tests' assumptions |
| A4 | `revise_criterion` and the new `session_summaries` domain functions can be net-new files/functions without touching `acceptance_criterion.rs`'s or `agent_run.rs`'s existing tested functions' bodies | Standard Stack (Supporting), Recommended Project Structure | Low: consistent with every prior phase's stated pattern of extending via new functions, not editing proven ones, but not verified against a specific line-level diff since the functions do not exist yet |
| A5 | Migration `0008` is the correct next number | Recommended Project Structure | Low: `packages/core/src/db/migrations/` currently ends at `0007_destructive_gate.sql` `[VERIFIED: directory listing this session]`; a concurrent phase or hotfix could claim 0008 first, in which case renumber |

**If this table is empty:** N/A — see rows above. All five assumptions are architecture-shape
recommendations resolving genuinely open Claude's-Discretion items from CONTEXT.md; none contradicts
a locked decision (D-64–D-79 remain the authority CONTEXT.md states them to be).

## Open Questions

CONTEXT.md's own `<decisions>` section already enumerates the phase's Claude's Discretion items in
detail (multi-cycle harness driver, `report_summary`'s exact home, D-66's bounded-wait duration,
whether ARCHITECTURE §3 items 5–7 join the packet, where summaries render, what `auto_generated`
may claim, renamed-file handling in the integrity check, whether a fired detector is
acknowledgeable, and `tauri dev` vs. packaged `.app` behavior). This research does not re-litigate
those — CONTEXT.md is explicit that the researcher and planner should resolve them against the
decisions and canonical references, not re-ask the user. The items below are the ones this
research's code-reading surfaced as needing an explicit planner call that CONTEXT.md's discretion
list does not already name:

1. **Does the `report_summary` tool's relay need a synchronous ack, or can it be fire-and-forget?**
   - What we know: the existing `PermissionRequestPayload` round trip blocks indefinitely waiting
     for a human decision; the existing `PermissionNoticePayload` (git-retry) is fire-and-forget
     with no answer at all `[VERIFIED: packages/sidecar/src/mcp-permission-server.ts:70-78]`.
     `report_summary` is neither — it needs a fast, synchronous (sub-second) round trip so the
     agent's closing MCP tool call resolves with a real success/failure, but does not need to wait
     on any human.
   - What's unclear: whether the existing socket-relay code path can be reused unmodified for a
     "answer immediately once the Rust-core write commits" shape, or needs a small third code path
     alongside the two existing ones.
   - Recommendation: model it as a bounded-wait variant of the existing held-request path (same
     `pending` map, but the "answer" is generated synchronously by the domain write completing
     rather than by a human clicking a button) rather than inventing a third socket message
     protocol.

2. **Where does `diff_stat_and_names`'s `base_ref` argument come from when a task's worktree does
   not yet exist (the D-28 "predicted, never created" case)?**
   - What we know: `assemble_context_packet` already handles the no-worktree-yet case by predicting
     branch/base_ref/path without creating anything `[VERIFIED: packages/core/src/context_packet.rs:147-177]`.
   - What's unclear: a diff-so-far is meaningless before a worktree exists (there is no working
     directory to diff) — D-70/D-71 implicitly assume a worktree already exists, which is true for
     every discard/resume case (D-66/D-67's flagship path) but not for the very first Start Work on
     a task.
   - Recommendation: gate the new diff section on `existing_worktree.is_some()`, mirroring
     `render_prompt`'s existing "omit the heading rather than emit an empty section" rule for a
     task with no epic or no criteria.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| System `git` CLI | D-70/D-71 diff-so-far | Yes | Measured minimum `2.54.0` on the machine this codebase's own tests were run against `[VERIFIED: packages/core/src/git.rs:182]` | None needed — already the phase's own established floor |
| SQLite (via `rusqlite`'s `bundled` feature) | New migration `0008`, all summary/revision reads and writes | Yes | Whatever `rusqlite 0.40`'s `bundled` feature vendors — deterministic across machines by design `[VERIFIED: packages/core/Cargo.toml:27, and STACK.md's stated rationale for the bundled feature]` | None needed |
| `@modelcontextprotocol/sdk` | `report_summary` tool registration | Yes | `1.30.0`, confirmed both by reading `package.json` and via `npm view` this session | None needed |
| Node.js sidecar runtime | Hosts the extended `claude-code-adapter.ts` / `mcp-permission-server.ts` | Yes | Whatever LTS the sidecar is already built against (unchanged by this phase) | None needed |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none — this phase adds no new external dependency and every
tool it needs is already present and already exercised by Phase 1–3's own test suites.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust core, workspace-wide integration tests in `packages/core/tests/`) + `vitest run` (desktop) + `node --test` (sidecar) `[VERIFIED: packages/desktop/package.json "test": "vitest run"; packages/sidecar/package.json "test" script]` |
| Config file | `packages/core/Cargo.toml` (workspace member), `packages/desktop/package.json`, `packages/sidecar/package.json` — no separate test-runner config file for any of the three |
| Quick run command | `cargo test -p core --test context_packet` (packet/compaction/drift unit-level); `npx vitest run <file>` (desktop component); `node --test test/mcp-permission-server.test.mjs` (sidecar, once such a file exists) |
| Full suite command | `cargo test --workspace`; `npm run test` in `packages/desktop`; `npm run test` in `packages/sidecar` (already builds first per its own script) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-01 | Every session ends with a written structured summary (agent-authored or fallback) | integration | `cargo test -p core --test session_summary_lifecycle` | ❌ Wave 0 |
| CTX-02 | Summaries are append-only; no UPDATE of an existing row | unit | `cargo test -p core --test session_summary_lifecycle -- append_only` | ❌ Wave 0 |
| CTX-03 | Packet includes task/epic/criteria/summaries/diff, no chat transcript | integration | `cargo test -p core --test context_packet` (extend existing file) | ✅ (existing file extended) |
| CTX-04 | Two assemblies of unchanged state are byte-identical | unit | `cargo test -p core --test context_packet -- determinism` | ✅ (existing test, extend fields) |
| CTX-05 | Verbatim window is 5, compaction boundary is visible/statable | unit | `cargo test -p core --test compaction` | ❌ Wave 0 |
| CTX-06 | Fact-based drift detectors fire on file-list mismatch, staleness, criteria-revision pin mismatch, decision-id echo mismatch | unit | `cargo test -p core --test drift` | ❌ Wave 0 |
| CTX-07 | 5+ session cycles, acceptance criteria verifiably unchanged | integration (Rust primary; sidecar `fake-claude.mjs`-driven cycle harness secondary, per open discretion item) | `cargo test -p core --test five_cycle_reconstitution` | ❌ Wave 0 — the phase's explicit research-flagged deliverable |
| CTX-08 | Discard + fresh session on same worktree, one action, no board state lost | desktop component + integration | `npx vitest run session/SessionSurface.test.tsx` | ❌ Wave 0 (extend if a `SessionSurface` test file already exists — check before creating) |
| BOARD-03 | Criteria immutable once locked; edit creates a revision, not an overwrite | unit | `cargo test -p core --test criteria` (extend existing file — it already exists per this research's own read) | ✅ (existing file, extend) |

### Sampling Rate
- **Per task commit:** the narrowest `cargo test -p core --test <file>` / `vitest run <file>` for
  the file just touched.
- **Per wave merge:** `cargo test --workspace` plus both package-level `npm run test` invocations.
- **Phase gate:** full suite green, PLUS the five-cycle CTX-07 test specifically, before
  `/gsd:verify-work` — this is the phase's own named "do not ship without evidence" gate
  (ROADMAP.md Notes, quoted in CONTEXT.md's phase description).

### Wave 0 Gaps
- [ ] `packages/core/tests/session_summary_lifecycle.rs` — covers CTX-01/CTX-02
- [ ] `packages/core/tests/compaction.rs` — covers CTX-05, exercising `compact_summaries()` as a
      pure function with no database at all (fastest possible test for this behavior)
- [ ] `packages/core/tests/drift.rs` — covers CTX-06's three fact-based detectors plus D-73's
      id-echo read-back
- [ ] `packages/core/tests/five_cycle_reconstitution.rs` — covers CTX-07; this is the phase's
      headline deliverable per the ROADMAP Notes research flag and must exist before the phase is
      considered done, independent of anything else in this table
- [ ] Desktop test coverage for the discard verb (CTX-08) and the compaction-boundary/drift
      rendering on `LaunchSheet.tsx` — check `packages/desktop/src/session/__tests__/` and
      `packages/desktop/src/launch-sheet/__tests__/` for existing files before creating new ones
- [ ] A decision on whether CTX-07's cycles are driven by `fake-claude.mjs` (deterministic, fast,
      matches WINDOWS.md's flakiness caution) or real `claude` sessions (matches Phase 3's own
      precedent of proving process-level guarantees with real spawned processes) — CONTEXT.md
      leaves this open; the planner must pick one explicitly rather than let it default silently

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Single local user, no auth surface changes in this phase |
| V3 Session Management | No | Not a web-session concept; `agent_runs`/`worktrees` are not ASVS "sessions" |
| V4 Access Control | Yes | The `report_summary` write surface must be scoped to exactly the calling run's own `agent_run_id`/`task_id`, derived from the per-run socket/event context — never accepted as a tool-call argument (see Architecture Patterns, Pattern 4). This is the concrete instance of ARCHITECTURE.md's Anti-Pattern 2 ("agents never write directly to Task/Epic; a scoped SessionSummary row is the sanctioned target") for this phase specifically. |
| V5 Input Validation | Yes | The `report_summary` tool's four fields (`changed`, `remains`, `next_session_must_know`, `decisions`) need bounded-size validation (an unbounded `decisions` list or an oversized `changed` prose field would itself become a compaction/drift-detector correctness problem, not just a resource one) before the row is written |
| V6 Cryptography | No | No new secret, credential or cryptographic material is introduced by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A compromised/confused agent process attributes a `report_summary` call to a different `run_id`/`task_id` than the one it is actually driving | Spoofing | Derive `agent_run_id` from the per-run socket/event context (already-established pattern for `permission_request`), never from a tool-call argument — see Architecture Patterns Pattern 4 |
| An agent's claimed `changed` file list disagrees with the real `git diff --name-only` for its range, either from dishonesty or from a stale/racing summary | Tampering / Repudiation | D-72's integrity-check detector, already specified — compare claimed list against `git diff --name-only`, surface a warning, never silently trust the claim |
| A `decisions` list entry references an id that was never actually recorded on the board (a fabricated echo) | Tampering | D-73's id-matching read-back — an entry that does not correspond to a real accumulated `decisions` id, or whose echoed `changed` list contradicts the entry it claims to reference, fires the same surfaced warning as any other detector |
| An SQL injection via a `report_summary` field making its way into a literal-`&str`-only query surface | Tampering | Not a real risk given this codebase's existing discipline — every SQL statement is a compile-time literal bound through `params![]` `[VERIFIED: packages/core/src/context_packet.rs:20, "use rusqlite::{params, ...}"; packages/core/src/domain/acceptance_criterion.rs module header]`; the new `session_summaries` write must follow the identical pattern, which the code review gate (`code_review: true` in `.planning/config.json`) will check |

## Sources

### Primary (HIGH confidence — read directly this session)
- `packages/core/src/context_packet.rs` (full file) — D-28's existing packet/prompt implementation and its stated purity contract
- `packages/core/src/git.rs` (full file) — the one `git_at` construction site, `git_status_porcelain`, `MIN_SUPPORTED_GIT`
- `packages/core/src/db/migrations/0002_board_schema.sql`, `0003_agent_runtime.sql`, `0006_recovery_statuses.sql` — schema shape, CHECK-constraint rebuild pattern, the "Phase 4's revisioning is an additive column" comment
- `packages/core/src/domain/acceptance_criterion.rs`, `packages/core/src/domain/permission_request.rs`, `packages/core/src/domain/agent_run.rs`, `packages/core/src/query/events.rs` — the one-transaction write pattern, derive-at-read-time discipline, `apply_session_closed`'s existing terminal-event hook
- `packages/core/src/session_log.rs` — the durable JSONL pointer-not-blob pattern the `auto_generated` fallback synthesizer draws on
- `packages/sidecar/src/mcp-permission-server.ts`, `packages/sidecar/src/adapter.ts`, `packages/sidecar/src/claude-code-adapter.ts`, `packages/sidecar/src/index.ts` — the per-run socket, `AgentEventBase.runId`, `AdapterCapabilities`, `buildClaudeArgv`'s `--mcp-config` shape, the sidecar's own stdio op switch
- `packages/desktop/src-tauri/src/sidecar.rs`, `packages/desktop/src-tauri/src/commands/agent_run.rs` — `handle_inbound_session_closed`, `persist_event_line`, the reader-loop dispatch site for a new event kind
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx`, `packages/desktop/src/item-detail/RunsSection.tsx` — existing rendering conventions the new sections must match
- `packages/core/tests/context_packet.rs`, `packages/core/tests/criteria.rs` — existing test shape/fixtures to extend
- `packages/core/Cargo.toml`, `packages/sidecar/package.json` — pinned dependency versions
- `.planning/phases/04-clear-is-free/04-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — required reading, phase decisions and history

### Secondary (MEDIUM confidence)
- `npm view @modelcontextprotocol/sdk version` — confirmed `1.30.0` matches the pinned manifest version (registry lookup, cross-checked against the file already read, not a fresh discovery)
- `.planning/research/ARCHITECTURE.md` §§2, 3, 5, 6 and Anti-Patterns — the pre-existing architecture research this phase's CONTEXT.md decisions were argued against; read directly this session for the sections not already fully quoted in CONTEXT.md
- `.planning/research/PITFALLS.md` Pitfall 3 (full text) — read directly this session

### Tertiary (LOW confidence)
- crates.io lookup for `rusqlite_migration`'s latest version was attempted and failed (network
  restriction in this environment); the pinned `2.6` in `Cargo.toml` is treated as current and
  sufficient since no new migration-crate capability is needed by this phase — this is a
  no-observation, not a verified-absent-newer-version claim.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every version claim is a direct file read, cross-checked once against the npm registry
- Architecture: HIGH — every extension point is grounded in an actual file read this session (line-cited), not inferred from CONTEXT.md's prose alone
- Pitfalls: HIGH — pitfall 3 is quoted verbatim from the project's own already-vetted research artifact, which is itself this phase's explicit specification per CONTEXT.md's canonical-refs

**Research date:** 2026-09-23
**Valid until:** No external expiry — this research is grounded in the current state of this
repository's own source files, which only changes when this phase's own plans land. Re-verify only
if a concurrent phase's plan touches `context_packet.rs`, `git.rs`, `mcp-permission-server.ts`, or
the migrations directory before this phase's plans do.
