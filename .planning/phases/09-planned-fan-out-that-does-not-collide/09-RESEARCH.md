# Phase 9: Planned Fan-Out That Does Not Collide - Research

**Researched:** 2026-10-09
**Domain:** Rust-core dispatcher (waves, ordering edges, width cap, auto-merge) + a Claude Code `PreToolUse` scope hook + backend rate-limit gating, inside the existing Tauri/Rust/Node-sidecar stack
**Confidence:** HIGH on the in-repo integration seams (every file named below was opened this session) and on hook behaviour (measured live this session against `claude 2.1.285`); MEDIUM on dispatcher design (reasoned from the seams, not yet built); LOW on the hard-limit wire shape (never observed live) and on the cap default (judgement).

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied verbatim from `09-CONTEXT.md`. Every decision below binds the planner. The "Reversibility" lines
are kept because they say what is costly to change.

### Locked Decisions

#### File-set declaration

- **D-147:** A task's declared file-set comes from a **pre-dispatch planning pass** — a short
  agent run over the epic, immediately before fan-out, that reads the repository as it is *now*
  and attaches a file-set to each already-existing task. It is deliberately NOT a field the
  Phase 5 `decompose` stage fills: a file-set forecast made at authoring time is stale by the
  time dispatch happens, and the overlap guarantee is only as good as the freshness of what it
  compares. `ProposalPayload::Task` stays `{ title, description }`.
  — **Reversibility:** costly — moving the declaration back into `decompose` later means a new
  `ProposalPayload::Task` variant field, a migration of `authoring_proposals` payload JSON, and
  the MCP tool schema in `mcp-permission-server.ts` changing shape in lockstep.

- **D-148:** A file-set entry is one of exactly **two forms**: an exact repo-relative path, or a
  directory prefix (e.g. `packages/core/src/domain/`). General globs are rejected. Overlap is
  therefore set intersection plus prefix containment — decidable and cheap, with no conservative
  "might overlap" verdict that sequences pairs which would not really have collided. One broad
  glob cannot quietly swallow the repository and make a task's scope meaningless.
  — **Reversibility:** costly — the stored shape is what the overlap check and the pre-write hook
  both match against; admitting globs later means migrating every stored file-set and replacing
  a decidable comparison with an over-approximating one.

- **D-149:** The pre-dispatch pass produces a **wave plan the user reviews and can edit** before
  any agent spawns — fix a wrong path, move a task between waves — then dispatches. A wrong
  file-set is the single error that silently voids the entire parallelism guarantee, so it gets
  one human look. Consistent with Phase 6's "nothing escapes without a human" triage gate.

- **D-150:** A task with **no declared file-set runs alone with the hook disarmed**. No
  declaration means no disjointness claim, so it can never share a wave; and there is nothing for
  the pre-write hook to check against, so it is not armed. This keeps today's single-task launch
  (Phase 2, `agent_run_start`) working unchanged for a task typed into QuickAdd ten seconds ago.
  Enforcement exists exactly where a declaration exists — never as an empty set that refuses
  every write.

#### Out-of-scope write

- **D-151:** The pre-write hook **denies** and the agent carries on. The refusal names the
  declared set, the attempt becomes a scope event, and the agent adapts within its scope. The
  hook never waits — it mirrors `stage-gate-hook.ts` exactly: standalone Node entry point,
  `FLYWHEEL_RUN_ID` read from its own environment and never from the hook payload, marker file
  read fresh per call, fail closed when the set cannot be established. This is what keeps
  disjointness a *fact*: a declared set can never widen underneath a sibling agent already
  running against it.

- **D-152:** A declared file-set **can be widened live**, from the scope event, and takes effect
  on the agent's very next tool call (the marker file is read fresh per call — no restart, no
  session reconstitution). The widen is **refused if the new path collides with any in-flight
  task's declared set**. That re-check is the load-bearing half: without it, live widening is
  exactly the hole D-151 exists to close.
  — **Reversibility:** costly — the in-flight overlap re-check needs a live view of every running
  task's current set; removing it later is easy, but adding it after dispatch logic has been
  written against "sets are immutable once dispatched" is not.

- **D-153:** A scope event appears in **two places**: a row in the live session feed (beside
  `PermissionRequestCard`) carrying the refused path and a **Widen** action, and a **count badge
  on the task row** on the board. Under fan-out the user is not watching any one session, so a
  task that hit the hook twenty times must not look identical on the board to one that never did.

- **D-154:** Repeated refusals **do not escalate**. Every refusal is denied, counted and
  surfaced; the run is never blocked or stopped on the user's behalf. An agent repeatedly asking
  is information, not a malfunction, and no threshold `N` has a principled value. The count on
  the task row is the signal; the user decides.

#### Wave dispatch

- **D-155:** Waves **auto-advance, with a pause the user controls**. One dispatch; as a wave
  drains, the next starts on its own, and the user can pause or stop at any point. Loop
  engineering does not work if the developer is the clock.
  — **Reversibility:** costly — the dispatcher's state machine (wave cursor, pause state, resume)
  is the spine of this phase; retrofitting auto-advance onto a step-per-wave design means
  rewriting it.

- **D-156:** A finished run's task branch **merges into the epic integration branch
  automatically when the dry run says the merge is clean**, and a conflict stops that task and
  asks the user. Wave 2 therefore branches off a base that actually contains wave 1 — which is
  the whole reason a wave boundary exists. `merge.rs` already provides the touch-nothing dry run
  (`plan_merge`) and the conflict path. **This changes what Phase 8 built:** per-task review
  before merge stops being mandatory during fan-out, and the review of record moves to the epic
  integration diff before the PR. Per-task review remains available, it is no longer a gate.
  — **Reversibility:** one-way — once a fan-out has auto-merged unreviewed task branches into
  epic integration branches, reinstating the per-task gate does not un-write that history; those
  epics' only review of record is the integration diff, and wave 2's commits are built on top of
  wave 1 commits that were never individually reviewed. Phase 8 success criterion 3 is
  re-interpreted, not revoked.

- **D-157:** The sequencing reason is **shown inline on the wave plan and recorded as an event**.
  Each sequenced pair names the colliding paths where the user approves the plan, and the same
  reason is written to the append-only event log so "why is this one waiting?" is still
  answerable a week later. PLAN-07 says the user can *ask*, which means after the fact too — and
  after a live widen (D-152), a recomputed answer and the answer that was actually acted on are
  not the same answer.
  — **Reversibility:** costly — the event shape lands in an append-only log; changing it later is
  a migration concern, not an edit.

- **D-158:** A colliding pair goes sequential **inside its wave**: both tasks stay in the wave,
  the second simply does not spawn until the first finishes, and every other task in the wave
  runs in parallel throughout. This is literally what ROADMAP success criterion 2 asks for —
  only that pair degrades. It requires ordering edges inside a wave, which the dispatcher must
  carry anyway for the width cap.
  — **Reversibility:** costly — "a wave is a set you spawn all at once" is a much simpler
  dispatcher; going back to it means re-deriving waves and changing the plan the user approved.

#### Cap & limit backoff

- **D-159:** The parallel cap is **one global number: concurrent agent sessions across every
  project**. It is the only cap that bounds what actually runs out — one Claude account's rate
  and session limits, and one machine. A per-project cap cannot do that (five projects at three
  each is fifteen sessions on one account). Stored following the `global_credential_mode`
  precedent in `domain/settings.rs`. A per-project ceiling stays additive for Phase 10.

- **D-160:** A rate or session limit **pauses new dispatch only**; every running session keeps
  going. A session mid-task holds uncommitted work and spent tokens — killing it loses both, and
  stopping in-flight work is not what the limit is asking for.

- **D-161:** The **warning tier already changes dispatch**: on `status: "allowed_warning"`, finish
  the wave that is running but do not auto-advance into the next one, and say why. A soft landing
  — the user is never cut off mid-wave with half an epic merged — and manual dispatch stays
  available if they judge the budget is fine. Uses `utilization` / `rateLimitType` the adapter
  already parses.

- **D-162:** Dispatch **auto-resumes at `resetsAt`**, with the wait and its reason visible and a
  resume-now action. `resetsAt` is a real timestamp off the wire, not a guess, and no probe is
  sent against the limit (a probe is a retry, which AGNT-05 rules out). `scheduler.rs` already
  owns the in-core tick that fires it.

### Claude's Discretion

The user picked a concrete option for all sixteen decisions; nothing was delegated. The following
were surfaced during the discussion and left unanswered — **planner/researcher should decide and
record, not re-ask the user**:

- The width cap's **default value**. Research anchors the ceiling: `anthropics/claude-code#55724`
  measured 8 of 13 agents failing at 13-way parallelism. Pick a default well under that and
  justify it from `SPAWN_FLOOR_MS` and the measured failure point.
- Whether **authoring runs count against the cap** (D-159 says "agent sessions"; an epic-authoring
  run is an agent session on the same account, which argues yes).
- What happens when **`resetsAt` is absent or malformed** on a limit event. D-162 forbids a probe;
  the honest fallback is manual resume, consistent with the fail-closed discipline everywhere else
  in this codebase.
- Whether the hook scopes **reads as well as writes**, or writes only. PLAN-04 says writes;
  reading a file outside the set is how an agent legitimately understands the code it is changing.
- Whether a denial message discloses the **whole declared set** or only that the path was refused.
  Disclosing the set helps the agent adapt; it is also model-adjacent data in a refusal path.
- Where the **file-set is stored** on the board (new table, column, or child rows), and whether it
  is versioned per dispatch.

### Deferred Ideas (OUT OF SCOPE)

- **Per-project parallel ceiling** on top of the global cap — raised while deciding D-159, and
  genuinely useful once Phase 10's cross-project fleet view exists. Additive to a global setting;
  belongs in Phase 10.
- **Scope summary on the Phase 8 review surface** ("this agent tried to leave its lane N times",
  read next to the diff) — considered for D-153 and set aside because it touches the largest
  surface in the app for information the task row already carries. A natural Phase 10 or
  post-MVP polish item.
- **Blocking or stopping a run that repeatedly fights its file-set** — rejected as D-154 because
  no threshold has a principled value. Revisit only with measured data from real fan-out runs.
- **Board-item ownership/lock checks** — `PITFALLS.md` Pitfall 6 notes that "the same declared
  file-set discipline applied to board data instead of source files" is an unsolved risk (an
  agent mutating a board item another in-flight task depends on). Out of scope here; this phase
  only scopes filesystem writes.
- Reviewed-and-not-folded todo (flag only): *Forge resolution failures are not memoised, so they
  retry per worktree every tick* — fan-out multiplies this by wave width. A Phase 7 defect with its
  own fix; flagged so the planner knows fan-out makes it worse.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-01 | The planner decomposes an epic into tasks each declaring the set of files it expects to modify | Planning pass as an epic-scoped agent run + held `submit_plan` MCP call + `task_file_set_entries` child rows (§ Pattern 5, § Resolved Discretion #6) |
| PLAN-02 | Before dispatch, check every pair of candidate parallel tasks for declared file-set overlap | Pure `file_set::overlaps` (exact == exact, prefix contains path, prefix contains prefix) evaluated per wave at plan approval (§ Pattern 1) |
| PLAN-03 | On overlap only that pair goes sequential | Ordering edges inside a wave, satisfied by predecessor **merged** (§ Pattern 2, Pitfall 3) |
| PLAN-04 | A running agent is prevented at the tool level from writing outside its declared file-set | Third `PreToolUse` entry on `Write\|Edit\|MultiEdit\|NotebookEdit`; measured to hold under `bypassPermissions` and `acceptEdits` (§ Pattern 3, Measured Findings M1-M5) |
| PLAN-05 | The attempt is surfaced as a scope event, not silently blocked | Hook -> permission-socket notice -> `scope_denied` AgentEvent -> `task.scope_denied` event + feed row + task-row badge (§ Pattern 4) |
| PLAN-06 | The planner decides parallel width and the user can cap it globally | `settings` key `dispatch_max_parallel`; dispatcher counts DB-truth running sessions across all projects (§ Pattern 6, Resolved Discretion #1-#2) |
| PLAN-07 | User can see why any two tasks were scheduled sequentially | `dispatch_edges` projection + `task.sequenced` event written in the approval transaction; `dispatch_why` read (§ Pattern 2) |
| AGNT-05 | Rate/session limits are detected, backed off from, and surfaced | Rust consumer for the already-emitted `rate_limit` event + gate state + tick-driven resume (§ Pattern 7) |
</phase_requirements>

## Summary

Phase 9 is mostly a **Rust-core dispatcher** that re-uses seams that already exist: `SpawnFloor` for spawn timing, `merge.rs` for the dry-run-then-merge, `runtime_protocol.rs`-style fresh-per-call marker files, `stage-gate-hook.ts` as the hook template, `settings` for the global cap, `scheduler.rs` for the tick, and the already-parsed `rate_limit` AgentEvent. No new third-party package is needed anywhere. The genuinely new things are: (1) a small pure `file_set` module that is the **single** implementation of "is path P covered by entry E" and "do these two sets overlap"; (2) a scope marker + a third hook entry + a notice path so a refusal becomes a board event; (3) a declarative dispatcher (`decide(conn, now)` -> actions) driven by a tick; (4) a planning-pass agent run with one write-only MCP tool; (5) a Rust consumer for rate-limit events.

Three findings change the plan relative to what CONTEXT.md assumes, and the planner must carry them. **First, a crashing hook fails OPEN** — measured this session: a `PreToolUse` hook that exits 1 (uncaught exception) let the `Write` proceed. Every other hook in this family prints `deny` and `exit(2)` only on paths it anticipated; the scope hook must wrap its entire body so any throw denies. **Second, the Bash tool is not covered by a `Write|Edit|NotebookEdit` matcher**, so PLAN-04 as literally written ("prevented at the tool level from writing") is true for the file tools only; an agent can still `echo > file` or `sed -i`. The honest design is hook (preventive, file tools) plus a **detective backstop** at session close that diffs the worktree against the declared set and raises the same scope event as `detected after the fact`. **Third, the briefing never tells an agent to commit** (`render_prompt`'s only closing instruction is `report_summary`), so D-156's "merge the task branch" would silently merge nothing (`MergeRefusal::NothingToMerge`) for an agent that leaves work uncommitted, and wave 2 would branch from a base that lacks wave 1. Dispatched runs need an explicit commit instruction, and an uncommitted finish must stop that task rather than advance the wave.

The dispatcher should be **declarative and restart-safe**: all state lives in the database (`dispatch_plans`, `dispatch_plan_tasks`, `dispatch_edges`, existing `agent_runs`), and a single-flight tick recomputes "what should happen next" every time. A sequential pair's second task becomes ready only when its predecessor is **merged** (not merely finished), because the whole point of ordering the pair is that the second must branch from a base containing the first.

**Primary recommendation:** Build in this order as vertical slices — (A) `file_set` + overlap + wave-edge computation + migration (pure, fully testable), (B) the scope hook end-to-end on a *manually declared* file-set so criterion 3 is demonstrable before any planner exists, (C) cap + rate-limit gate, (D) the dispatcher state machine with auto-merge, (E) the planning pass, (F) UI — and make the live-binary hook measurement an automated, credential-gated test, not a human item.

## Project Constraints (from CLAUDE.md)

Extracted from `.claude/CLAUDE.md` (read this session). The planner must verify compliance; research below does not contradict any of them.

- **Local-first, local credentials only.** Agents run on the developer's machine with the developer's existing Claude credentials; nothing in this phase may require or introduce an `ANTHROPIC_API_KEY` dependency (memory: `flywheel-no-anthropic-api-key-dependency`). The planning pass is just another local-credential session.
- **Claude Code only, behind the adapter seam.** No supervisor code may branch on backend identity (AGNT-01). `rate_limit` handling in Rust must key on the normalised `AgentEvent`, not on Claude-specific wire text; the Claude-specific wire mapping stays in `claude-code-adapter.ts`.
- **Architecture must not foreclose** scheduled automations, teams, relay, extra backends. Consequence: dispatch state in tables + append-only events (relay-readable), dispatcher triggers go through the generic trigger record, global cap stored as a plain `settings` row with a per-project override addable later without schema change.
- **Human verification is deferred until MVP (Phase 11).** No `checkpoint:human-verify` tasks, no `/gsd-verify-work`, no UAT file. Any item that would need a human goes to `.planning/DEFERRED-REVIEW.md` with `truth`, `why_deferred`, `risk_if_wrong`, honest `automatable`. **Write the cheap test instead of deferring it** — the scope-hook live measurement and the "also clean up an undeclared file" check are automatable (see Validation Architecture). `checkpoint:decision` / `checkpoint:human-action` still apply.
- **Honest reporting.** A deferred or unobserved item must never be described as verified. The hard rate-limit wire shape is genuinely unobserved (see Assumptions A2) and the plan must say so in its own artifacts.
- **Tauri/Rust/Node-sidecar split.** Rust core owns the database and supervision; the sidecar owns driving sessions and must not open the SQLite file. The dispatcher therefore lives in Rust.
- **GSD workflow enforcement.** All edits go through a GSD command.
- **Tech-stack discipline:** `rusqlite` + `rusqlite_migration` (no hand-rolled schema versioning), system `git` CLI for worktree lifecycle, UI state in Zustand/TanStack Query split.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| File-set entry validation, overlap, containment | Rust core (`file_set.rs`) | Shim binary (exposes the same fn to the hook) | One implementation, so the plan-time overlap check and the run-time hook can never disagree (D-148) |
| Wave/edge computation and `why` | Rust core | Renderer (display only) | Pure, deterministic, unit-testable; renderer must never compute a verdict |
| Dispatcher state machine, cap, gate | Rust core + Tauri crate (`scheduler.rs` tick) | — | Needs DB + process spawn; CONTEXT: "D-159's cap belongs in the Rust core's dispatcher, not [the sidecar]" |
| Spawning a dispatched run | Tauri crate (reuses `agent_run_start` body + `send_spawn_request`) | Sidecar `spawn` op | Existing single gated spawn path (SpawnFloor) |
| Per-tool-call scope enforcement | Hook process (Node, spawned by `claude`) | Shim binary (`--scope-check`) + marker file written by Rust | Only layer that sees the tool call before it executes |
| Scope marker (armed/unarmed + set) | Rust core writes `<runtime>/scope/<runId>.json` | Hook reads fresh per call | Mirrors the stage marker; fresh-per-call read is what makes live widening free (D-152) |
| Scope event capture | Hook -> permission socket -> sidecar adapter -> Rust handler | Detective backstop at session close (Rust) | Event must land in the board, not only in a transcript (PITFALLS Pitfall 2) |
| Rate-limit wire parsing | Sidecar adapter (exists) | Rust consumes normalised `rate_limit` event | AGNT-01: no backend-specific branching in the supervisor |
| Auto-merge | Rust core (`merge.rs` halves) driven by dispatcher | — | Git-running half takes plain values, never a connection |
| Planning pass | Epic-scoped agent run (sidecar `spawn`) + MCP `submit_plan` | Rust core validates and stores | Agent proposes; Rust is the authority on validity and run kind |
| Wave-plan review, Widen action, count badge, cap control | Renderer (React) | Tauri commands | UI hint = yes; every verdict comes from Rust DTOs |

## Standard Stack

**No new external packages are recommended for this phase.** Everything below is already in the workspace. [VERIFIED: `packages/core/Cargo.toml`, `packages/sidecar/package.json`, `packages/desktop/package.json` read this session]

### Core (existing, reused)

| Library / module | Version | Purpose | Why standard here |
|------------------|---------|---------|-------------------|
| `rusqlite` | 0.40 (`bundled`) | Dispatch tables, file-set rows, events | Store-of-record rule: Rust core owns the DB |
| `rusqlite_migration` | 2.6 | Migration `0019_*` | CLAUDE.md: never hand-roll schema versioning; migrations registered in `db/mod.rs::migration_source_list` |
| `tokio-cron-scheduler` | 0.15 | Dispatcher tick job beside the four existing jobs | Already started from `main.rs`; "Home for the wave-advance trigger" (CONTEXT) |
| `serde_json`, `chrono`, `anyhow`, `sha2` | existing | Marker JSON, timestamps, errors | — |
| `flywheel_core::git_retry::SpawnFloor` | in-repo | Spawn spacing | Already enforced inside `SidecarHandle::send_spawn_request`; one-policy rule has source gates |
| `flywheel_core::merge` (`plan_merge_inputs`, `finish_plan`, `try_lock_epic`, `run_merge`, `record_merge_event`) | in-repo | D-156 auto-merge | Exactly the halves D-156 names |
| `flywheel_core::runtime_protocol` | in-repo | `scope` marker directory + atomic write | `atomic_write` is private to this module, so `write_scope_marker` must live here |
| `@modelcontextprotocol/sdk` | 1.30.0 (pinned) | `submit_plan` tool registration on the existing server | Already the only MCP server; no second server process |
| Node built-ins (`node:fs`, `node:net`, `node:path`) | Node 24.21.0 locally | Hook script, socket notice | Hooks are dependency-free today |
| Vitest 5.0.0 / Testing Library / TanStack Query 5.102.8 / Zustand 5.0.15 | existing | UI + tests | Existing conventions |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Hook calls `shim --scope-check` (one Rust matcher) | Re-implement containment in TS inside the hook, guarded by a shared conformance corpus | TS keeps the hook self-contained but creates two implementations of the D-148 predicate; drift between plan-time overlap and run-time enforcement is exactly the failure class this phase exists to prevent. `pretooluse-hook.ts` already shells to the shim for its classifier, so the shim route is the established pattern. |
| Declarative tick (`decide(conn, now)`) | Event-only in-memory state machine | Event-only state is lost on restart and races with manual launches; tick-recompute is idempotent and restart-safe. |
| Tick-driven resume at `resetsAt` | One-shot scheduled job per limit | A per-limit job must be persisted across restarts; a 5 s tick comparing `now >= paused_until` needs no persistence beyond one settings row. |
| Held-call `submit_plan` (answer carries validation errors) | Fire-and-forget `submit_plan` + validate later in the review sheet | Fire-and-forget is simpler but wastes the human review step on mechanical errors (e.g. a glob). Held-call is the existing `propose_item` request-and-answer pattern. |

**Installation:** none. **Version verification:** `claude --version` -> `2.1.285 (Claude Code)`, `node --version` -> `v24.21.0`, `git --version` -> `2.54.0`, `cargo --version` -> `1.98.1` (all run this session).

## Package Legitimacy Audit

No external packages are installed by this phase. The `package-legitimacy` seam was therefore not invoked. If the planner later adds a dependency (for example a path-normalisation crate), it must go through the gate and be flagged `[ASSUMED]` until it does; the recommendation here is to use `std::path` and `std::fs::canonicalize` instead.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Measured Findings (live, this session)

All run against the locally installed `claude 2.1.285 (Claude Code)` with `--model haiku`, in scratch directories, a `--settings`-injected `PreToolUse` hook on matcher `Write|Edit|MultiEdit|NotebookEdit`. Cost: about $0.035 per turn. These follow the repository's own precedent (`packages/sidecar/test/destructive-gate.test.mjs` measures by observable file effect, not transcript claims).

| # | Finding | Evidence |
|---|---------|----------|
| M1 | A hook printing `permissionDecision: "deny"` and `exit(2)` **blocks `Write`** under `--permission-mode bypassPermissions` and under `--permission-mode acceptEdits`; the positive control (hook prints `{}`) writes the file. `default` and `plan` were **not** measured. | `w1 mode=bypassPermissions hook=deny ... file_exists=NO`; `w2 mode=acceptEdits hook=deny ... file_exists=NO`; `w3 mode=bypassPermissions hook=control ... file_exists=YES`; repeat `w5 ... acceptEdits deny ... file_exists=NO` [VERIFIED: live probe] |
| M2 | **A crashing hook fails open.** A hook that throws (Node exit code 1, no decision printed) let the `Write` succeed. | `w4 mode=acceptEdits hook=crash ... file_exists=YES` [VERIFIED: live probe] |
| M3 | A denial reaches the model as a `tool_result` with `is_error: true`, text `PreToolUse:Write hook error: <permissionDecisionReason>`, and `tool_result_meta[0].non_execution_kind == "permission-rule"`. | Verbatim line: `{"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "PreToolUse:Write hook error: FLYWHEEL-SCOPE: path is outside the declared file-set [src/a.ts]", "is_error": true, "tool_use_id": "toolu_019TVnbPgRFKLx7eF7VY9N8R"}]}, ... "tool_result_meta": [{"id": "toolu_019TVnbPgRFKLx7eF7VY9N8R", "non_execution_kind": "permission-rule"}]}` [VERIFIED: live probe] |
| M4 | The hook payload carries an **absolute** `tool_input.file_path`, plus `cwd`, `permission_mode`, `tool_name`, `tool_use_id`. | Payload: `"cwd":"/private/tmp/.../probe/w1","permission_mode":"bypassPermissions","hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/private/tmp/.../w1/out.txt","content":"hello"},"tool_use_id":"toolu_019TV..."` [VERIFIED: live probe] |
| M5 | In 2.1.285 the `init` event's tool list contains file-writing tools `Edit`, `NotebookEdit`, `Write` (no `MultiEdit`), plus `Bash`, `EnterWorktree`, `ExitWorktree`, `Task`, `Workflow`. | `init.tools` printed from `w3.stream.jsonl` [VERIFIED: live probe] |
| M6 | `resetsAt` is Unix epoch **seconds**; a normal `allowed` event carries no top-level `utilization` (it is under `unifiedWindows`); and `overageStatus: "rejected"` appears on an event whose `status` is `"allowed"` — so the substring "rejected" is **not** a limit signal. | Verbatim: `{"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "resetsAt": 1791538200, "rateLimitType": "five_hour", "overageStatus": "rejected", "overageDisabledReason": "org_level_disabled", "isUsingOverage": false, "unifiedWindows": {"five_hour": {"utilization": 0.28, "resetsAt": 1791538200}, "seven_day": {"utilization": 0.31, "resetsAt": 1791806400}}}, ...}`; `1791538200` converts to `2026-10-09T09:30:00+00:00` [VERIFIED: live probe + python conversion] |
| M7 | Claude Code left no stray files in the run's cwd after a Write turn (important because `run_merge` refuses a dirty epic worktree). | `ls -la w1` empty, `w3` only `out.txt` [VERIFIED: live probe] |

## Resolved Discretion Items

CONTEXT.md left six items to research. Decisions, with provenance:

1. **Cap default and range.** Default **3**, validated range **1-8**, stored as `settings` key `dispatch_max_parallel` (same upsert/read helpers as `global_credential_mode`; a global setting writes no `events` row because `events.project_id` is `NOT NULL`, per the `settings.rs` module doc). Reasoning: `#55724` measured 8 of 13 agents failing at 13-way parallelism with **no** spawn staggering [CITED: `.planning/research/PITFALLS.md` Pitfall 1]; Flywheel now staggers at `SPAWN_FLOOR_MS` (400 ms per repository) and retries commit-time locks up to `RETRY_MAX_ATTEMPTS` (5), so git contention is already the *least* binding constraint. The binding constraints are the one account's session/rate limits (Pitfall 5, reported at "modest concurrent-session counts") and the user's own review bandwidth. Three agents ramp up in 0.8 s of floor time and leave 5+ slots of safety margin under the measured failure point. The range ceiling 8 is a judgement, not a measurement. `[ASSUMED]` (A1) — surface as a `checkpoint:decision` only if the planner wants the owner to pick; otherwise record it as decided.
2. **Do authoring runs count against the cap?** **Yes for occupancy, no for refusal.** The dispatcher computes occupied slots as `SELECT COUNT(*) FROM agent_runs WHERE status IN ('running','blocked')` across all projects, so an authoring session and a planning pass hold a slot on the same account. The cap only *gates the dispatcher's own spawns*; it never refuses a user-initiated authoring session or a manual `agent_run_start` (the user is the clock for those). The cap is therefore "the dispatcher never exceeds it," which is what success criterion 4 says. A manual launch can push the live count above the cap by one; the dispatcher simply spawns nothing until it falls.
3. **`resetsAt` absent/malformed.** Gate state becomes `paused` with `paused_until = NULL` and reason text "limit reached; reset time unknown", and **only a manual Resume** clears it. No probe, no timer guess. `resetsAt` is normalised defensively: a value `> 1e11` is treated as milliseconds (the live sample is seconds, but community docs describe milliseconds — A8), a non-number or non-positive value counts as absent. A `resetsAt` already in the past on a `rejected` event pauses for zero time and the next tick resumes; that is correct (the window has reset) and must not loop (see Pitfall 11).
4. **Reads vs writes.** **Writes only.** Matcher is the file-writing tools; reading outside the set is how an agent understands the code it is changing. Because the matcher is a tool-name regex and tool names vary by CLI version (M5: no `MultiEdit` in 2.1.285), keep `MultiEdit` in the regex defensively and fail closed on a matched tool whose input carries neither `file_path` nor `notebook_path`.
5. **Denial message content.** **Disclose the declared set**, truncated to the first 20 entries plus "and N more", plus the refused path made repo-relative. The set is already in the agent's own briefing (see Pattern 3), is the same repository's path names, and lets the agent adapt without guessing. Do not include any other run's data. Prefix the reason with a stable token (`FLYWHEEL-SCOPE:`) so a test or a backstop can recognise it.
6. **Storage and versioning.** File-set = **child rows** in a new table `task_file_set_entries` (not a JSON column), because the overlap and in-flight re-check queries are per-entry and CHECK constraints can enforce the two-form vocabulary. **Versioning is the event log, not a version column:** `task.file_set_declared`, `task.file_set_edited`, `task.file_set_widened` each carry `before`/`after` (the existing `field/before/after/label` payload idiom). What was *acted on* at dispatch is frozen separately in `dispatch_edges` (D-157), which is why a recomputed answer can differ from the acted-on answer without losing either.

## Architecture Patterns

### System Architecture Diagram

```
 USER
  | "Plan fan-out" on an epic (epic header)
  v
 dispatch_plan_create (Tauri cmd) --- ensure_epic_integration_branch (existing fn, idempotent, writes event)
  |                                    ensure_epic_worktree (merge.rs)  => repo "as it is now" = integration tip
  v
 PLANNING RUN  (agent_runs row: epic_id set, task_id NULL, authoring_stage NULL;
                 referenced by dispatch_plans.planning_run_id)
  sidecar "spawn" op, cwd = epic worktree, permission mode "default", --allowedTools submit_plan
  claude --reads repo--> MCP submit_plan(tasks:[{key, files[], wave, rationale}]) [HELD call]
                              |  Rust: run is a planning run? entries valid (file_set.rs)? keys in this epic?
                              v  answer ok | error text the agent can act on
  dispatch_plans(status=draft) + dispatch_plan_tasks + task_file_set_entries
  |
  v
 WAVE PLAN SHEET (renderer): edit paths / move task between waves; shows sequenced pairs + colliding paths
  | Approve & dispatch   --> ONE tx: freeze plan, write dispatch_edges (overlap per wave),
  |                          append task.sequenced events, status=running
  v
 DISPATCHER TICK  (scheduler.rs job ~5 s  +  nudge from handle_inbound_session_closed)  [single-flight]
   decide(conn, now) -> actions            (DB-only, no git, no subprocess)
     gate paused?            -> no Spawn actions (Merge actions still allowed)
     occupied >= cap?        -> no Spawn actions
     ready task?  (wave == cursor, all edge predecessors MERGED, no overlap with other plans' in-flight sets)
        -> Spawn(task)  : start_agent_run_recording_first -> arm_run_scope (writes marker armed|unarmed)
                          -> send_spawn_request (SpawnFloor 400 ms/repo)
     run completed & worktree clean & commits ahead?
        -> Merge(task)  : plan_merge_inputs(lock) -> finish_plan -> try_lock_epic -> run_merge -> record_merge_event(system actor)
     all tasks in wave merged/skipped? -> cursor += 1 (blocked by warning gate: "hold, say why")
  |
  v
 CLAUDE SESSION (one per task, in the task's worktree)
   every Write/Edit/NotebookEdit  --PreToolUse-->  scope-hook.js
        env: FLYWHEEL_RUN_ID, FLYWHEEL_RUNTIME_DIR (never from payload)
        shim --scope-check <marker> <file_path>   (single Rust matcher; canonicalises symlinks/..)
        marker <runtime>/scope/<runId>.json read FRESH:  unarmed -> {}   armed+inside -> {}   else deny(exit 2)
        deny => socket notice kind "scope_denied" (bounded wait) -----------------+
   rate_limit_event line (stream-json) --> adapter "rate_limit" AgentEvent --+     |
                                                                              v     v
 SIDECAR --stdout event lines--> Rust reader (sidecar.rs)  -- agent:event emit --> session feed
        handle_inbound_rate_limit : update gate (settings row) ; event only on state CHANGE
        handle_inbound_scope_denied: append task.scope_denied ; board:changed --> task-row badge
  Widen (human-only Tauri cmd): re-check against in-flight sets -> tx(file_set rows + event) -> rewrite marker
  Session close: detective backstop (porcelain + committed paths vs declared set) -> same scope event, flagged "detected after the fact"
```

### Recommended Project Structure

```
packages/core/src/
├── file_set.rs                 # NEW. FileSetEntry parse/validate, covers(), overlaps(), FILE_SET_FORMS const
├── dispatch.rs                 # NEW. pure: plan_waves/edges, why(), decide(conn, now) -> Vec<Action>, gate state
├── domain/dispatch_plan.rs     # NEW. tables' CRUD in *_in_tx style + events
├── domain/file_set.rs          # NEW (or fold into dispatch_plan.rs). declare/edit/widen with events
├── runtime_protocol.rs         # EDIT. SCOPE_DIR_NAME, ScopeMarker, write_scope_marker, clear_run_runtime_files += scope
├── db/migrations/0019_fan_out.sql   # NEW. task_file_set_entries, dispatch_plans, dispatch_plan_tasks, dispatch_edges, index
├── context_packet.rs           # EDIT. declared scope + commit instruction in render_prompt (deterministic, CTX-04)
packages/shim/src/main.rs       # EDIT. --scope-check mode calling flywheel_core::file_set
packages/sidecar/src/
├── scope-hook.ts               # NEW. stage-gate-hook.ts shape + try/catch around EVERYTHING
├── claude-code-adapter.ts      # EDIT. writeHookSettings(..., includeScopeGate), rate-limit status mapping, scope notice kind
├── mcp-permission-server.ts    # EDIT. submit_plan tool + socket kind; notice kind "scope_denied"
├── adapter.ts                  # EDIT. ScopeDeniedEvent, PlanSubmittedEvent
packages/desktop/src-tauri/src/
├── dispatch.rs (commands)      # NEW. plan create/get/edit/approve/pause/resume/stop, scope_widen, dispatch_why, cap get/set
├── scheduler.rs                # EDIT. fifth job: dispatcher tick (single-flight)
├── sidecar.rs                  # EDIT. two more inbound branches: rate_limit, scope_denied
├── commands/agent_run.rs       # EDIT. extract launch body so dispatcher and agent_run_start share it
packages/desktop/src/
├── dispatch/                   # NEW. WavePlanSheet, EpicDispatchControls
├── session/FeedRow.tsx         # EDIT. scope_denied row + Widen
├── board/BoardRow.tsx          # EDIT. scope count badge
└── settings/SettingsSurface.tsx# EDIT. parallel cap control
```

### Pattern 1: One matcher for the file-set predicate (D-148)

**What:** A pure module, no I/O except an optional canonicalisation helper, that is the only place "is path P covered by entry E" and "do sets A and B overlap" are written. Entries are exactly two forms, decided by an explicit trailing `/`: `file` (`packages/core/src/domain/task.rs`) or `dir` (`packages/core/src/domain/`).

**Validation (reject, never repair):** empty; absolute; contains `..` or a `.` segment; contains `//`; contains a backslash, NUL or control character; contains any of `* ? [ ] { }` (globs); equals the repository root (a `dir` entry of `/` or `./`); starts with `.git/` or is `.git`. At declare time against a worktree, a `file` form that exists as a directory is rejected with "did you mean `x/`" (a not-yet-existing file is fine, new files are the common case).

**Semantics:** `file` covers a path iff equal. `dir` covers a path iff the path starts with the dir string **including the trailing `/`** (so `packages/core/src/domain/` does not cover `packages/core/src/domain_x.rs`). Overlap: `file`/`file` equal; `file`/`dir` iff the dir covers the file; `dir`/`dir` iff one string is a prefix of the other. Compare case-folded when the repo's filesystem is case-insensitive (store `case_insensitive` in the marker from `git config core.ignorecase` at write time; v1 is macOS-only) — otherwise two tasks declaring `src/Foo.ts` and `src/foo.ts` look disjoint but collide on APFS (A5).

**Single-list discipline:** `FILE_SET_FORMS: [&str; 2] = ["file", "dir"]` in exactly one Rust constant and one migration `CHECK`, as `AUTHORING_STAGES`/`ISSUE_KINDS`/`WORKFLOW_STATES` do.

**Example (proposed shape; not existing code):**

```rust
// Source: proposed; modelled on branch.rs / merge.rs "plain values in, plain values out"
pub const FILE_SET_FORMS: [&str; 2] = ["file", "dir"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileSetEntry { File(String), Dir(String) } // Dir always ends with '/'

pub fn parse_entry(raw: &str) -> Result<FileSetEntry, EntryRefusal> { /* reject, never repair */ }
pub fn covers(entry: &FileSetEntry, rel_path: &str, fold_case: bool) -> bool { /* ... */ }
pub fn overlaps(a: &FileSetEntry, b: &FileSetEntry, fold_case: bool) -> bool { /* ... */ }
pub fn collisions<'a>(a: &'a [FileSetEntry], b: &'a [FileSetEntry], fold_case: bool)
    -> Vec<(&'a FileSetEntry, &'a FileSetEntry)> { /* names the colliding PAIRS for the "why" */ }
```

### Pattern 2: Waves, ordering edges, and "merged" as the edge-satisfied state (D-155, D-157, D-158)

**What:** A plan has numbered waves (agent-proposed, user-editable integers >= 1, contiguous after normalisation). Inside a wave, for every unordered pair that collides, an edge `before -> after` is created, oriented by the tasks' board rank order (a total order, so cycles are impossible). Edges are stored (`dispatch_edges`) and each also appends a `task.sequenced` event in the approval transaction. A task is **ready** when: its wave equals the plan's cursor; every predecessor edge's task is `merged` (or user-`skipped`); and it does not overlap any currently in-flight armed task in the same project (the cross-plan guard, using the same `in_flight_declared_sets` query D-152 needs).

**Why `merged`, not `completed`:** the only reason to order a colliding pair is that the second must start from a base that contains the first. Worktrees are cut lazily at spawn from the epic integration tip (`base_ref_for_task` -> `ensure_epic_integration_branch`), so if `B` spawns the moment `A`'s process exits but before `A` is merged, `B` is cut from a base without `A` and the declared collision reappears as a merge conflict — D-158 would hold on paper and fail in git.

**Wave advance:** when every task in the cursor wave is `merged` or `skipped`. A `failed`/`stopped`/`conflict`/`needs_attention` task **blocks the wave** and is surfaced; the user retries or skips it. The width cap is orthogonal: at any instant concurrency = `min(cap - occupied, ready tasks)`.

**Task states (single list, proposed):** `planned, waiting, running, finished, merging, merged, conflict, needs_attention, failed, stopped, held_by_limit, skipped`. Plan states: `draft, approved, running, paused, completed, aborted`; a partial unique index allows one live plan per epic.

**`why(a, b)`:** reads `dispatch_edges` (what was acted on) first; if no edge: "different waves" or "file-sets disjoint". After a widen that created a new edge, the cause is recorded (`cause = 'widen'`) so the recomputed answer and the acted-on answer are both inspectable.

### Pattern 3: The scope hook (D-151) — the stage-gate hook plus the lessons measured above

**Wiring:** a third `PreToolUse` entry in `writeHookSettings`, gated by a new boolean `includeScopeGate` in the same way `includeAuthoringStageGate` gates the second. Execution runs pass `true`; authoring runs keep their existing two entries; `includeScopeGate = false` default keeps `execution-hook-settings.test.mjs` green and each existing entry byte-identical.

**Arming is a fact written by Rust, never an absence:** every execution-run start writes `<runtime>/scope/<runId>.json` — `mode: "unarmed"` when the task has no declared entries (D-150: "never an empty set that refuses every write"), `mode: "armed"` with entries otherwise. The hook is always wired for execution runs; an **absent, unreadable, malformed, or unrecognised-version marker denies** (D-151 fail closed), `unarmed` is a no-opinion `{}`. This puts D-150 in exactly one place — a single `arm_run_scope(conn, run_id, task_id)` called from `start_agent_run_recording_first` — so no spawn path can forget it, and a marker-write failure aborts the start (the G-05-8(b) lesson from `start_authoring_run`: "A run that cannot record its stage must not start").

**Proposed marker shape (snake_case, like `AuthoringStageMarker`):**

```json
{ "version": 1, "mode": "armed", "worktree_root": "/Users/x/Flywheel/FLY/FLY-12",
  "case_insensitive": true,
  "entries": [ {"form":"dir","path":"packages/core/src/domain/"}, {"form":"file","path":"packages/core/src/lib.rs"} ],
  "written_at": "2026-10-09T08:00:00Z" }
```

**Hook body rules (all measured or established):**
- Wrap the **entire** `main` in try/catch and add `process.on("uncaughtException")`/`unhandledRejection` handlers that print the deny decision and `process.exit(2)` (M2: any other exit code proceeds). `stage-gate-hook.ts`'s `main()` has no catch, so it has the latent failure mode; do not copy that.
- Identity only from `FLYWHEEL_RUN_ID` / `FLYWHEEL_RUNTIME_DIR` in the hook's own environment (stage-gate precedent); the payload supplies only the path being checked.
- Extract the target by tool: `Write`/`Edit`/`MultiEdit` -> `tool_input.file_path`, `NotebookEdit` -> `tool_input.notebook_path`. A matched tool with no string path denies.
- The path is absolute (M4). Decide through the shim's `--scope-check` (single matcher), which resolves `..`, canonicalises the deepest existing ancestor (so a symlink inside the worktree pointing outside is "outside"), and then applies `covers`. On macOS `/tmp` is `/private/tmp` (visible in M4) — canonicalise the marker's `worktree_root` at write time.
- **Never rely on the hook payload's `cwd` for the worktree root**; use the marker's `worktree_root`, which Rust wrote.
- **Do not set a short `timeout` on the settings entry**: a timed-out hook does not block the call [CITED: code.claude.com/docs/en/hooks]. Keep the hook's own work bounded instead (notice wait <= ~500 ms, failure ignored).
- Exit-code and output shape are the proven ones: print `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"FLYWHEEL-SCOPE: ..."}}` then `process.exit(2)`.

**Agent-side priming:** `render_prompt` must list the declared set under a "Scope" heading for armed runs (deterministic, so the Phase 4 purity tests still hold) and, for dispatched runs, instruct committing. This reduces denials and fixes D-156 (Pitfall 4).

### Pattern 4: Making a refusal a board event (D-153, D-154, PLAN-05)

**Path:** the hook, after printing its decision, sends a fire-and-forget notice over `FLYWHEEL_PERMISSION_SOCKET` (already in the claude process environment, so inherited by hooks the way it is by the shim) with `kind: "scope_denied"`; `PermissionNoticePayload.kind` gains the new literal; `noticeToAgentEvent` maps it to a `scope_denied` AgentEvent (`runId` from the session closure, never the payload); `sidecar.rs`'s reader chain gets one more branch that calls `handle_inbound_scope_denied`, which appends `task.scope_denied` in one transaction (actor = the agent actor, the one who attempted it; payload `{label, path, tool, tool_use_id, outside_worktree}`), then emits `board:changed`. The feed row is rendered from the `agent:event` stream (`FeedRow.tsx`); the badge is `COUNT(*)` of that event type per task.

**Delivery is best effort, so a backstop is mandatory.** A lost notice would otherwise be exactly the "silent block" PLAN-05 forbids. Alternatives that avoid the socket were considered and rejected: deriving the event from the stream's `tool_result` text (M3) is not usable today because `normaliseStreamEvent` reads `toolResult.text` while the real block carries `content` (a string, M3) — verified by reading `claude-code-adapter.ts` and the captured stream — and string-matching CLI wording is brittle.

**Detective backstop (also covers the Bash gap):** at session close for an armed run, compute changed paths in the task worktree (committed since `base_branch` via `git::review_files`, plus uncommitted via `domain::worktree::porcelain_entries`) and raise `task.scope_denied` with `detected_after_the_fact: true` for any path outside the set. This is the same shape as the Phase 7 `task.outside_commit_detected` precedent. It is **detective, not preventive**, and the plan's artifacts must say so: `Bash` (`echo >`, `sed -i`, `npm install` touching lockfiles) is not covered by the file-tool matcher.

**Counting without log bloat:** record every refusal (D-154). Rows are tiny; do not coalesce. The aggregate for the board badge needs an index (Pitfall 9).

### Pattern 5: The planning pass (D-147, D-149)

**Run kind:** an `agent_runs` row with `epic_id` set, `task_id` NULL, `worktree_id` NULL, `authoring_stage` NULL. Existing authoring queries filter `authoring_stage IS NOT NULL` (`find_running_authoring_run`, `query/authoring.rs`), so a planning run is not mistaken for an authoring session. Do **not** add a run-kind column (that is an `agent_runs` table rebuild, as `0006`/`0010` show); identify the planning run by `dispatch_plans.planning_run_id`. `start_planning_run` mirrors `start_authoring_run` minus the stage marker.

**Process:** reuse the sidecar's ordinary `spawn` op with `worktreePath` = the epic integration worktree (`ensure_epic_worktree`), permission mode `"default"` (the authoring precedent: `AUTHORING_PERMISSION_MODE`), `--allowedTools` the single `submit_plan` tool name. The prompt is a new pure `render_planning_prompt` built from the existing `EpicContextPacket.task_roster` (keys, titles, criteria).

**Authority check is on the Rust side, not in the tool list.** The standalone MCP server lists **every** tool to **every** run (verified: `ListToolsRequestSchema` handler returns one fixed array including the authoring tools), so an execution agent can *see* `submit_plan`. `handle_inbound_submit_plan` must verify that the socket's run is a planning run in `running` status, that every `key` belongs to that run's epic, and refuse otherwise. Widen is not an MCP tool at all (human-only Tauri command, D-90 family).

**Held call:** model it on `propose_item`'s request-and-answer path and carry forward the plan 06-09 bug lesson — the execution `startSession` path once connected, wrote its payload and waited forever because no `onProposal` callback was wired; add a fake-claude test that goes through the real socket.

**Preconditions:** call `ensure_epic_integration_branch` (existing, idempotent, records its own event) before creating the epic worktree — this satisfies CONTEXT's "wave plan over an epic with no integration branch is a precondition failure" by making the dispatcher *satisfy* it through the sanctioned lazy-cut path rather than merely check it; `merge.rs` still never cuts.

### Pattern 6: Cap and occupancy (D-159, PLAN-06)

`occupied = COUNT(*) FROM agent_runs WHERE status IN ('running','blocked')` across all projects — database truth, not an in-memory counter, so it is correct after a restart and counts authoring/planning runs. Spawns per tick = `min(cap - occupied, ready)`. Because `agent_run_start` holds `state.db` across `git worktree add` (existing behaviour), the dispatcher should launch **one task per lock acquisition** and re-enter, never loop inside one acquisition. Run the whole tick on a blocking thread (`spawn_blocking`): `send_spawn_request` sleeps in `SpawnFloor::wait_turn`.

### Pattern 7: Rate-limit gate (AGNT-05, D-160/161/162)

**Detection (adapter, Claude-specific):** keep emitting `rate_limit` as today and add a normalised boolean-ish interpretation: `status === "rejected"` is the hard-limit signal [CITED: SDK/community docs; **never observed live**, A2]. Also treat an assistant message whose `errorCode` is `"rate_limit"` (the adapter already carries `errorCode`/`isApiErrorMessage`; `rate_limit` is a documented `SDKAssistantMessageError` value [CITED: code.claude.com/docs/en/agent-sdk/typescript]) as the same signal, because a hard limit may surface there rather than as a `rejected` event. Do **not** key on `overageStatus` (M6).

**State (Rust):** `gate = open | warning(rateLimitType, resetsAt) | paused(reason, paused_until?)`, persisted in the `settings` table (a global value; the event goes on the triggering run's project stream because `events.project_id` is `NOT NULL`). Write only on a **state change** — Claude emits a `rate_limit_event` per API response, so a per-event DB write is a write storm.

**Behaviour:** paused -> no new `Spawn` actions (and no new planning pass); `Merge` actions continue (local git, no backend); running sessions untouched (D-160). Warning -> do not advance the cursor, say why, offer "Advance now" (D-161). A run that dies because of the limit is `held_by_limit`, not `failed`; on resume the dispatcher starts a **fresh** run on the same worktree (D-30 always-fresh; WORK-08 worktree persists). Resume = `now >= paused_until` observed by the tick, or the Resume-now command; absent `paused_until` waits for manual resume (Resolved Discretion #3). Warning state expires when a later event for the same `rateLimitType` reports `allowed`, or when `resetsAt` passes — a `seven_day` warning must not hold auto-advance for days with no way out other than manual dispatch (Pitfall 10).

### Anti-Patterns to Avoid

- **Treating "finished" as "merged".** Breaks D-158 in git (Pattern 2).
- **A second copy of the containment predicate in TypeScript.** Plan-time and run-time verdicts will drift.
- **Encoding "disarmed" as an empty set or an absent marker.** An absent marker must deny; disarmed is an explicit `unarmed` mode.
- **Holding `state.db` across a subprocess or a `SpawnFloor` sleep** (rule in `merge.rs` and `scheduler.rs`; the type signature, not a comment, is the enforcement).
- **Using the hook payload for identity** (`runId`, worktree root).
- **Writing a DB row per `rate_limit_event`.**
- **Auto-committing on the agent's behalf** to make D-156 work: it rewrites authorship of the agent's output; instruct the agent and stop on an uncommitted finish instead.
- **Setting `tasks.status` from the dispatcher.** `merge.rs` documents "a status has exactly one owner per transition"; the wave-plan state is the dispatcher's own display.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Spawn spacing | A dispatcher-local sleep/jitter | `SidecarHandle::send_spawn_request` -> `SpawnFloor::wait_turn` | One-policy rule with source gates in `tests/git_retry.rs` and `tests/spawn_stagger.rs`; extend the gate to the dispatcher's file |
| Commit-time lock retry | A second backoff curve | `git::git_at` -> `with_lock_retry` | Same one-policy gate |
| The merge | A dispatcher-owned `git merge` | `merge::{plan_merge_inputs, finish_plan, try_lock_epic, run_merge, record_merge_event}` | Dry run, conflict path, dirty-tree refusal, per-epic guard and the integrated marker all exist; Phase 8's `is_integrated` reads the same `task.integrated` event |
| Atomic marker writes | `fs::write` | `runtime_protocol::atomic_write` (private; add `write_scope_marker` in that module) | A reader (the hook) must never observe a torn file |
| Scheduling/ticks | A `std::thread` + sleep loop | `tokio-cron-scheduler` job in `scheduler.rs` | Already started once from `main.rs` |
| Global setting storage | A new config file | `settings` table via `upsert_setting`/`read_setting` | `global_credential_mode` precedent; audit via `updated_by/updated_at` |
| Event append | Raw `INSERT INTO events` | `next_sequence` + `append_event` in the caller's transaction | DATA-01: projection and event commit together |
| Per-run socket plumbing | A new socket/server | The existing permission socket + `PermissionNoticePayload` kinds | "zero new socket, zero new spawned process, zero new `--mcp-config` entry" is the established bar |
| Path canonicalisation | String munging | `std::fs::canonicalize` on the deepest existing ancestor + `std::path` | Symlinks and `..` are where scope checks get bypassed |
| Pair enumeration | Clever interval structures | A nested loop per wave | Hundreds of tasks at most; O(n^2) per wave is fine (`ponytail:` comment with the ceiling) |

**Key insight:** every hard part of this phase already has an owner in the repo. The risk is not missing machinery, it is re-deriving a rule in a second place — the containment predicate, the spawn policy, the hook fail-closed discipline, the "disarmed" semantics.

## Common Pitfalls

### Pitfall 1: A crashing hook fails open
**What goes wrong:** the scope hook throws (bad JSON, missing shim, unreadable marker path), Node exits 1, and the write proceeds. **Measured**, not theoretical (M2).
**How to avoid:** top-level try/catch plus `uncaughtException`/`unhandledRejection` handlers that print the deny decision and exit 2. Add a test that deliberately makes every internal step throw and asserts exit code 2 and a deny body. Note `stage-gate-hook.ts` has the same latent shape; fixing it is optional scope but cheap.
**Warning signs:** a hook test that only covers the paths its author anticipated.

### Pitfall 2: The Bash tool is outside the matcher
**What goes wrong:** "also clean up" via `rm`, `sed -i`, `echo >`, or `npm install` changes undeclared files with the hook never firing; the plan claims "stopped at the tool level."
**How to avoid:** state the guarantee precisely (file-writing tools), ship the close-time detective backstop (Pattern 4), and write it into the verification artifact as a named residual. `EnterWorktree`/`ExitWorktree` tools exist in the 2.1.285 tool list (M5) and could move an agent's working directory; consider `--disallowedTools` for them on armed runs (effect unmeasured, A4) — flag rather than assume.
**Warning signs:** a success criterion phrased "cannot write" with a test that only exercises `Write`.

### Pitfall 3: Ordering a pair but cutting the second worktree from a stale base
**What goes wrong:** B starts when A's process exits; A is not yet merged; B's worktree (cut at spawn) lacks A; the "sequenced" pair conflicts at merge.
**How to avoid:** edge-satisfied means predecessor `merged` (Pattern 2). Also note `ensure_worktree` **reuses** an existing worktree row — a task that already has a worktree from an earlier run does not get a fresh base; the dispatcher must detect "worktree base predates the integration tip" and either refuse or surface it. Test with a real two-task git repo: assert wave 2's worktree contains wave 1's commit.

### Pitfall 4: The agent was never told to commit
**What goes wrong:** `render_prompt` ends with the `report_summary` closing requirement and never mentions committing. An agent that leaves work uncommitted gives `finish_plan` zero commits -> `MergeRefusal::NothingToMerge`, so D-156 merges nothing and wave 2 starts without wave 1's work.
**How to avoid:** for dispatched (armed) runs add a deterministic "commit your work on this branch before closing; do not push" instruction; at run end, if the worktree is dirty or the branch has zero commits ahead, set `needs_attention` and **do not advance the wave** (consistent with WORK-03's "never silently lose a would-be-lost change"). Never auto-commit.

### Pitfall 5: Auto-merge attributed to the human
**What goes wrong:** `review_merge_task` records the merge with `local_human_actor_id`; reusing that call from the dispatcher writes "a human merged this" for a merge nobody reviewed — a dishonest audit trail, and D-156 is explicitly one-way.
**How to avoid:** the dispatcher records with the **system actor** (`flywheel_core::domain::actor::system_actor`, already used by `scheduler.rs`) and an `auto: true` / `plan_id` field in the payload, while still emitting the existing `task.integrated` event type so Phase 8's integrated marker keeps working.

### Pitfall 6: Rate-limit "rejected" substring matching
**What goes wrong:** matching on the word "rejected" fires on `overageStatus: "rejected"` while `status` is `"allowed"` (M6) and pauses dispatch for an org that simply has overage disabled — on every event.
**How to avoid:** key strictly on top-level `status === "rejected"` and `errorCode === "rate_limit"`. Add the M6 line as a negative fixture.

### Pitfall 7: Case-insensitive filesystem
**What goes wrong:** `src/Foo.ts` vs `src/foo.ts` are disjoint strings and one file on APFS. Overlap check misses it; the hook allows an alias.
**How to avoid:** case-fold when `core.ignorecase` is true; carry the flag in the marker. A planning-prompt instruction to use the repo's existing casing is not a control.

### Pitfall 8: Dirty epic worktree blocks every later merge
**What goes wrong:** `run_merge` refuses when the integration worktree has uncommitted entries. A planning agent running with `cwd` = that worktree, or anything else writing there, strands every subsequent auto-merge as a refusal.
**How to avoid:** planning run is read-only (`default` mode, only `submit_plan` pre-approved); the planning run must be terminal before the first `Merge` action; M7 shows Claude itself leaves no stray files. Assert "epic worktree clean" before the first merge and surface a named cause.

### Pitfall 9: The board badge makes a 1,000-item board slow
**What goes wrong:** `COUNT(*) ... WHERE event_type = 'task.scope_denied' GROUP BY task_id` without a supporting index scans the whole event log; BOARD-08 has a 1,000-item perf test (`perf_seed_1000.rs`).
**How to avoid:** add `CREATE INDEX idx_events_type_task ON events (event_type, task_id)` in `0019`, and read the aggregate once per board read, not per row. Run `perf_seed_1000` after the migration.

### Pitfall 10: Stale warning gate holds auto-advance for days
**What goes wrong:** a `seven_day` `allowed_warning` at 0.81 has `resetsAt` three days out; "do not auto-advance" with no expiry freezes the loop engine.
**How to avoid:** warning state is keyed by `rateLimitType`, cleared by a later `allowed` for that type or by `resetsAt` passing; the UI always offers "Advance now" (D-161 already allows manual dispatch). Do not treat the warning as a pause of running work.

### Pitfall 11: Resume loop at a past `resetsAt`
**What goes wrong:** a `rejected` event carrying a `resetsAt` already in the past sets `paused_until` in the past; resume -> spawn -> immediate rejection -> pause -> resume, i.e. blind retry, which AGNT-05 rules out.
**How to avoid:** after a resume caused by time, the **next** `rejected` pauses with a backoff floor (for example require manual Resume on a second rejection within a few minutes) and says so. The tick itself must be idempotent and single-flight.

### Pitfall 12: Writes outside the worktree that Claude Code itself makes
**What goes wrong:** the CLI may write memory/plan files under its own config directory through the `Write` tool in some modes; an armed hook denies them and each denial becomes a badge increment, inflating the count the user relies on.
**How to avoid:** the denial payload carries `outside_worktree: bool` so the UI can separate "left its lane" from "left the repository"; observe a real multi-step run during the live measurement before deciding to special-case anything (A6). Do not whitelist paths speculatively.

### Pitfall 13: Fabricated state in each half of a two-sided contract
**What goes wrong:** the hook test hand-writes a marker; the Rust test asserts only a row; the product never writes the marker the hook needs (this exact failure shipped for the authoring stage: `authoring-stage-gate.test.mjs` doc comment, "for nine gap-closure rounds these two files each fabricated the other's state").
**How to avoid:** a `scope_marker_contract.rs` that drives the real `start_agent_run_recording_first` to write the marker and then spawns the **shipped** compiled hook against it (modelled on `authoring_stage_marker_contract.rs`).

### Pitfall 14: Cross-plan and manual-launch collisions
**What goes wrong:** the plan-level check only sees tasks in one plan. Two epics' plans, or a plan plus a manual launch, can touch the same files.
**How to avoid:** the readiness test includes the in-flight armed sets of *other* plans (same query as D-152). Undeclared manual launches cannot be checked (D-150 disarms them); say so, and rely on the merge conflict path.

### Pitfall 15: Lockfiles and manifests
**What goes wrong:** several tasks add dependencies; each legitimately touches `Cargo.lock`/`package-lock.json` through Bash, undeclared by a planner that did not think of it.
**How to avoid:** the planning prompt asks for manifests/lockfiles to be declared when a task adds a dependency; the detective backstop catches the rest; the D-156 conflict path stops the task.

## Code Examples

### Verbatim in-repo values these designs depend on

Each was read with the `Read` tool this session; the planner may copy them.

```text
packages/core/src/git_retry.rs:44      pub const SPAWN_FLOOR_MS: u64 = 400;
packages/core/src/git_retry.rs:31      pub const RETRY_MAX_ATTEMPTS: u32 = 5;
packages/core/src/git_facts.rs:28      pub const HOT_TICK_SECS: u64 = 5;
packages/core/src/git_facts.rs:73      pub const EVENT_OUTSIDE_COMMIT: &str = "task.outside_commit_detected";
packages/core/src/merge.rs:39          pub const EVENT_TASK_INTEGRATED: &str = "task.integrated";
packages/core/src/merge.rs:41          pub const EVENT_MERGE_ABORTED: &str = "task.merge_aborted";
packages/core/src/domain/settings.rs:23   const SETTING_GLOBAL_CREDENTIAL_MODE: &str = "global_credential_mode";
packages/core/src/runtime_protocol.rs:47  const STAGE_DIR_NAME: &str = "stage";
packages/desktop/src-tauri/src/commands/agent_run.rs:46
    const ACCEPTED_PERMISSION_MODES: [&str; 4] = ["acceptEdits", "default", "plan", "bypassPermissions"];
packages/desktop/src-tauri/src/commands/authoring.rs:57
    const AUTHORING_PERMISSION_MODE: &str = "default";
0010_authoring_runs.sql  status TEXT NOT NULL CHECK (status IN ('running', 'blocked', 'completed', 'failed', 'interrupted', 'abandoned')),
0010_authoring_runs.sql  authoring_stage TEXT CHECK (authoring_stage IS NULL OR authoring_stage IN ('challenge', 'decompose', 'criteria')),
0002_board_schema.sql    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
packages/core/src/db/mod.rs:39         include_str!("migrations/0018_criterion_anchors.sql"),   <- last registered; next is 0019
packages/sidecar/src/claude-code-adapter.ts:197-201
    export function writeHookSettings(
      runtimeDir: string,
      runId: string,
      includeAuthoringStageGate: boolean,
    ): string | undefined {
packages/sidecar/src/claude-code-adapter.ts:163
    export const AUTHORING_STAGE_GATE_MATCHER = `mcp__${MCP_SERVER_NAME}__(propose|amend|delete)_.*`;
packages/sidecar/src/adapter.ts:370-378
    export interface RateLimitEvent extends AgentEventBase {
      type: "rate_limit";
      status?: string;
      rateLimitType?: string;
      utilization?: number;
      surpassedThreshold?: number;
      resetsAt?: number;
      isUsingOverage?: boolean;
    }
```

Proposed new names (these are **proposals**, not existing values): settings key `dispatch_max_parallel`; gate settings keys `dispatch_gate_state` / `dispatch_paused_until`; event types `task.file_set_declared`, `task.file_set_edited`, `task.file_set_widened`, `task.sequenced`, `task.scope_denied`, `dispatch_plan.approved`, `dispatch_plan.paused`, `dispatch_plan.resumed`; matcher `Write|Edit|MultiEdit|NotebookEdit`; marker directory `scope`; socket notice kind `scope_denied`; migration `0019_fan_out.sql`.

### Third PreToolUse entry (extends the existing function; existing entries unchanged)

```typescript
// Source: proposed edit to packages/sidecar/src/claude-code-adapter.ts writeHookSettings
export const SCOPE_GATE_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

if (includeScopeGate) {
  preToolUse.push({
    matcher: SCOPE_GATE_MATCHER,
    hooks: [{ type: "command", command: `${process.execPath} ${scopeHookScriptPath()}` }],
    // deliberately NO "timeout": a timed-out PreToolUse hook does not block the call
  });
}
```

### Hook skeleton with the fail-open fix

```typescript
// Source: proposed; structure of stage-gate-hook.ts + the M2 lesson
const deny = (reason: string): never => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: `FLYWHEEL-SCOPE: ${reason}` } }));
  process.exit(2);
};
process.on("uncaughtException", (e) => deny(`scope hook error: ${String(e)}`));
process.on("unhandledRejection", (e) => deny(`scope hook error: ${String(e)}`));
async function main() {
  const payload = JSON.parse(await readStdin());             // throws -> handler -> deny
  const runId = process.env.FLYWHEEL_RUN_ID;                  // never payload.run_id
  const runtimeDir = process.env.FLYWHEEL_RUNTIME_DIR;
  if (!runId || !runtimeDir) return deny("run identity is not set");
  const target = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;
  if (typeof target !== "string" || target.length === 0) return deny("no target path in tool input");
  // marker read + shim --scope-check <marker> <target>  => allow | unarmed | deny(+entries)
}
main().catch((e) => deny(`scope hook error: ${String(e)}`));
```

### Dispatcher decision function (declarative, deterministic)

```rust
// Source: proposed; shape follows merge.rs "plain values" and scheduler.rs "read under lock, act outside"
pub enum Action { Spawn { task_id: String }, Merge { task_id: String }, AdvanceWave { plan_id: String },
                  Resume { plan_id: String }, MarkNeedsAttention { task_id: String, cause: String } }

/// DB-only: no git, no subprocess, no sleep. `now` is a parameter so tests need no clock.
pub fn decide(conn: &rusqlite::Connection, now_epoch_secs: i64) -> anyhow::Result<Vec<Action>> { /* ... */ }
```

### Rate-limit wire (negative and positive fixtures to freeze)

```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1791538200,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false}}
```
-> must **not** pause (M6, verbatim from the live run). The positive fixture (`"status":"rejected"`) is constructed from the documented shape, not observed (A2).

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| GSD-core downgrades the **whole wave** to sequential on any overlap (`execute-phase.md:595`) | Downgrade only the colliding pair, ordering edges inside the wave | This phase (D-158) | Needs per-pair edges and a "merged" readiness rule |
| Per-task human merge gate (Phase 8 SC3) | Dry-run-clean auto-merge during fan-out; review of record is the integration diff | This phase (D-156), one-way | Dispatcher must use the system actor and keep `task.integrated` |
| `rate_limit` event parsed but unused | Consumed by a gate | This phase | Adapter detection half already shipped (plan 05-37) |
| Hook family: stage gate, destructive gate | Third hook: scope gate | This phase | Must not relax the fail-closed rule (`docs/destructive-gate-trust-boundary.md`) |

**Deprecated/outdated:** `MultiEdit` is absent from the 2.1.285 tool list (M5); keep it in the matcher defensively but do not depend on it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cap default 3 and range 1-8 are sensible | Resolved Discretion #1 | Too low is a throughput complaint; too high risks account limits. Owner can change one constant. |
| A2 | A hard limit presents as top-level `rate_limit_info.status == "rejected"` and/or an assistant message with `error: "rate_limit"`; **never observed live**, built from SDK/community docs | Pattern 7, Pitfall 6 | Dispatcher never pauses on a real limit; AGNT-05 silently unmet. Mitigate: fixture-based tests now, mark the live shape as an unobserved residual in the phase artifacts and `DEFERRED-REVIEW.md` (`automatable: partly` — cannot force a limit on demand). |
| A3 | `PreToolUse` hooks also fire for tool calls made by sub-agents (`Task` tool) in the same session | Pattern 3 | An agent can escape scope through a sub-agent. Measure in the live test (one extra turn). |
| A4 | `--disallowedTools EnterWorktree ExitWorktree` is effective and harmless on armed runs | Pitfall 2 | Either a no-op or breaks an unrelated feature; measure before adopting. |
| A5 | APFS volumes are case-insensitive by default and `core.ignorecase` reflects it | Pattern 1, Pitfall 7 | Overlap/hook comparison wrong on case-variant paths. |
| A6 | Headless CLI runs may `Write` outside the worktree (memory/plan files) and would trigger denials | Pitfall 12 | Badge noise. Observe in a real multi-step live run before special-casing. |
| A7 | A `default`-mode, read-only planning run completes headlessly without stalling on a permission prompt | Pattern 5 | Planning pass blocks on a human prompt. Authoring sessions run in `default` today, which is supporting (not conclusive) evidence. |
| A8 | `resetsAt` is always epoch seconds (live sample) although community docs describe milliseconds | Resolved Discretion #3 | Wrong resume time by 1000x; the `> 1e11` normalisation is the guard. |
| A9 | `deny` also holds under `default` and `plan` permission modes | Pattern 3 | Armed runs launched in those modes are unenforced. Only `bypassPermissions` and `acceptEdits` were measured (M1). Extend the live test to all four accepted modes (`ACCEPTED_PERMISSION_MODES`). |
| A10 | Hook default timeout is 600 s and a timed-out hook does not block | Pattern 3 | Source is a summarising fetch of the official docs page; the repo's own `pretooluse-hook.ts` doc says the same, which corroborates but is also not a measurement. |
| A11 | The `~35% -> ~4%` scope-violation figure is a single-source practitioner datum | Summary | Motivation only; CONTEXT already says not to verify against it. |
| A12 | `unifiedWindows` (per-window utilization) is a stable field | Pattern 7 | Not required by any decision; adapter does not model it. Skip unless the UI wants it. |

## Open Questions

1. **Board status after an auto-merge.** `merge.rs` writes no status; after a fan-out the merged tasks would still read `in_progress`.
   - What we know: "a status has exactly one owner per transition"; LINK-07 moves status on forge events.
   - What's unclear: whether the owner wants the wave-plan state to be the only "done" signal until the epic PR.
   - Recommendation: dispatcher writes no `tasks.status`; show per-task dispatch state on the epic's wave view and the task row. Revisit with the user in Phase 10 if the board reads wrongly.
2. **Existing worktree reuse versus a fresh base** (Pitfall 3). `ensure_worktree` returns an existing row untouched.
   - Recommendation: for a dispatched task with an existing worktree whose `base_branch` tip predates the integration tip, mark `needs_attention` with that cause rather than rebasing; do not add rebase logic in this phase.
3. **`default`/`plan` permission modes for dispatched runs.** Which does the wave-plan sheet offer?
   - Recommendation: mirror `LaunchSheet`'s default (`acceptEdits` per D-36) and make the live hook test cover all four accepted modes; hide any mode where the hook is unproven.
4. **Does a hard limit end the session, or does the CLI retry internally?** Community reports mention `retry_delay_ms`/`max_retries` on API-retry events.
   - Recommendation: treat the first of {`status:"rejected"`, `errorCode:"rate_limit"`, a run closing `failed` with a rate-limit `terminalReason`} as the gate trigger; record whichever the first real occurrence shows in `DEFERRED-REVIEW.md`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | Live hook measurement test, planning pass | yes | 2.1.285 | Tests skip visibly (the `destructive-gate.test.mjs` `FLYWHEEL_REAL_CLAUDE_BIN` idiom) |
| Node.js | Sidecar, hook, tests | yes | v24.21.0 | — |
| `cargo`/rustc | Core, desktop crate, shim | yes | 1.98.1 | — |
| `git` | Worktrees, merge, backstop | yes | 2.54.0 | — |
| npm | Sidecar and desktop tests | yes | 11.19.0 | — |
| A way to force a real rate limit | Observing the hard-limit wire shape | no (cannot be produced on demand) | — | Fixture-built tests; record as unobserved residual (A2) |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** a live hard-limit observation — covered by fixtures plus an honest `DEFERRED-REVIEW.md` entry.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust: `cargo test` (integration tests in `packages/core/tests/*.rs`, helper `tests/common/mod.rs` incl. a real-git `seeded_git_project()` per Phase 8's validation doc); sidecar: `node --test test/*.test.mjs` after `tsc` (`npm test` in `packages/sidecar`); desktop: Vitest 5.0.0 + jsdom (+ browser configs) |
| Config file | Rust none; `packages/sidecar/package.json` `scripts.test`; `packages/desktop/vitest.config.ts` |
| Quick run command | `cargo test -p core --test <name>` · `cd packages/sidecar && npm test -- --test-name-pattern=<x>` (full: `npm test`) · `npm --prefix packages/desktop run test -- src/dispatch` |
| Full suite command | `cargo test --workspace` and `npm --prefix packages/sidecar test` and `npm --prefix packages/desktop test` and `npx --prefix packages/desktop tsc --noEmit` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-01 | Planning run submits entries; non-planning run's `submit_plan` is refused; invalid entry returns an actionable error; wave plan persisted as draft | integration + sidecar wire | `cargo test -p core --test dispatch_plan` · `npm --prefix packages/sidecar test` (`submit-plan-wire.test.mjs`) | no - Wave 0 |
| PLAN-02/03 | Overlap truth table (file/file, file/dir, dir/dir, trailing-slash, case-fold, glob/`..`/root rejected); only the colliding pair gets an edge; others unaffected | unit + integration | `cargo test -p core --test file_set_overlap` · `cargo test -p core --test dispatch_plan` | no - Wave 0 |
| PLAN-03 | Sequenced pair: B not ready until A **merged**; B's worktree contains A's commit (real git) | integration | `cargo test -p core --test dispatch_auto_merge` | no - Wave 0 |
| PLAN-04 | Shipped hook denies outside-set / symlink escape / `..`; allows inside; `unarmed` allows; absent/garbled marker denies; **every internal throw exits 2** | sidecar hook | `npm --prefix packages/sidecar test` (`scope-hook.test.mjs`) | no - Wave 0 |
| PLAN-04 | Write-side contract: real `start_agent_run_recording_first` writes the marker the shipped hook reads | integration | `cargo test -p core --test scope_marker_contract` | no - Wave 0 |
| PLAN-04 | **Live:** real `claude`, armed marker, prompt "also clean up `<undeclared file>`" -> file not created, tool_result is the `FLYWHEEL-SCOPE` denial, for each of the four accepted permission modes; sub-agent variant (A3) | live (credential-gated, skips visibly) | `cd packages/sidecar && node --test test/scope-hook-live.test.mjs` | no - Wave 0 |
| PLAN-05 | Hook notice -> `scope_denied` AgentEvent -> `task.scope_denied` row + `board:changed`; close-time backstop raises it for an undeclared `git add`ed path and an undeclared uncommitted path; lost notice still surfaced by the backstop | integration + sidecar | `cargo test -p core --test scope_events` · `npm --prefix packages/sidecar test` | no - Wave 0 |
| PLAN-05 | Feed row shows path + Widen; task row badge count; count of 20 differs visibly from 0 | component | `npm --prefix packages/desktop run test -- src/session/__tests__/feed-row.test.tsx src/board/__tests__/scope-badge.test.tsx` | extend / no |
| D-152 | Widen refused when the path collides with any in-flight set (cross-plan too); accepted widen rewrites the marker and the next hook call allows it | integration + sidecar | `cargo test -p core --test scope_widen` | no - Wave 0 |
| PLAN-06 | Dispatcher never exceeds cap, including occupancy from authoring/planning runs; cap setting persisted/validated 1-8; manual launch does not get refused | integration | `cargo test -p core --test dispatch_cap` | no - Wave 0 |
| PLAN-07 | `why(a,b)` returns colliding path pairs, survives a widen (acted-on vs recomputed), "different waves" and "disjoint" answers | integration | `cargo test -p core --test dispatch_plan -- why` | no - Wave 0 |
| AGNT-05 | `rejected` and `errorCode: rate_limit` pause spawns but not merges; running sessions untouched; `allowed_warning` holds the cursor; `overageStatus:"rejected"`+`status:"allowed"` does **not** pause; absent `resetsAt` waits for manual resume; resume at `resetsAt` with injected `now`; one DB write per state change | integration + adapter | `cargo test -p core --test dispatch_limit_gate` · `npm --prefix packages/sidecar test` (`rate-limit-wire.test.mjs`) | no - Wave 0 |
| D-155/156 | Auto-advance across waves in a real git repo; clean merge by system actor writes `task.integrated`; conflict stops the task and asks; uncommitted finish -> `needs_attention`; restart comes up `paused` | integration | `cargo test -p core --test dispatch_auto_merge` | no - Wave 0 |
| D-150 | Task with no entries: unarmed marker, `agent_run_start` unchanged, hook allows every write | integration | `cargo test -p core --test scope_marker_contract` | no - Wave 0 |
| source gates | Dispatcher spawn goes through `send_spawn_request`; one git construction site; no new launcher tokens | gate | `cargo test -p core --test spawn_stagger` (extend) · `--test supervisor_cwd` · `--test destructive_gate_no_new_launcher_tokens` | exist; extend |
| migration | `0019` registered once, ordered; N-1 fixture applies | gate | `cargo test -p core --test migration_safety` | exists |
| perf | 1,000-item board still within budget with the badge aggregate | perf | `cargo test -p core --test perf_seed_1000` | exists |
| UI | Wave plan sheet: shows sequenced pairs with colliding paths, edit path, move between waves, approve; dispatch controls; paused-with-reason line + Resume now; cap control | component | `npm --prefix packages/desktop run test -- src/dispatch src/settings` | no - Wave 0 |

### Sampling Rate

- **Per task commit:** the single targeted `cargo test -p core --test <name>` or `node --test` file, plus `cargo test -p core --test supervisor_cwd`.
- **Per wave merge:** `cargo test --workspace`, `npm --prefix packages/sidecar test`, `npm --prefix packages/desktop test`, `npx --prefix packages/desktop tsc --noEmit`.
- **Phase gate:** full suite green; the credential-gated live scope test run once against the installed `claude` (it is a script the agent can run, so it is **not** a deferred human item under CLAUDE.md).
- **Max feedback latency:** about 60 s for a targeted run.

### Wave 0 Gaps

- [ ] `packages/core/tests/file_set_overlap.rs` — PLAN-02 truth table, validation refusals
- [ ] `packages/core/tests/dispatch_plan.rs` — edges, waves, `why`, plan lifecycle events
- [ ] `packages/core/tests/dispatch_cap.rs`, `dispatch_limit_gate.rs`, `dispatch_auto_merge.rs` — PLAN-06, AGNT-05, D-155/156 (real git repo fixtures)
- [ ] `packages/core/tests/scope_marker_contract.rs`, `scope_events.rs`, `scope_widen.rs`
- [ ] `packages/sidecar/test/scope-hook.test.mjs` (+ conformance corpus JSON shared with the Rust matcher test), `scope-hook-live.test.mjs`, `rate-limit-wire.test.mjs`, `submit-plan-wire.test.mjs`
- [ ] `fake-claude.mjs` additions: emit a configurable `rate_limit_event`; call `submit_plan` through the real MCP socket
- [ ] Update `execution-hook-settings.test.mjs` (entry counts) and `spawn_stagger.rs` (extend the no-bypass gate to the dispatcher file)
- [ ] Framework install: none

## Security Domain

`security_enforcement` is enabled (absent = enabled); ASVS level 1, block on high (`.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local credentials unchanged; no new auth surface |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | Widen, approve, pause/resume are human-only Tauri commands with the actor resolved server-side (T-01-04); no MCP tool and no agent-reachable caller can widen a set; `submit_plan` authority is checked in Rust against the run's kind (the MCP tool list is not a control — verified it is global) |
| V5 Input Validation | **yes** | `file_set::parse_entry` rejects instead of repairing; tool args validated in Rust; hook treats payload path as untrusted; renderer never supplies a path to a git argv |
| V6 Cryptography | no | — |
| V7 Error handling & logging | yes | Hook fails closed; denial reasons are fixed-prefix; no filesystem path of the app-data directory crosses to the renderer (the `persist_failure_detail` rule) |
| V12 Files & resources | **yes** | Canonicalise before comparing; defeat `..` and symlink escape; run ids pass `is_ulid` before building marker paths (the `write_authoring_stage` precedent) |
| V14 Configuration | yes | `FLYWHEEL_RUN_ID`/`FLYWHEEL_RUNTIME_DIR` from the hook's environment only |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent writes outside its declared set via a file tool | Tampering | `PreToolUse` deny; shim matcher; measured to hold under `bypassPermissions`/`acceptEdits` (M1) |
| Agent writes outside its set via `Bash` | Tampering | **Not preventable by this matcher**; detective backstop at close; named residual (Pitfall 2) |
| Hook crash / timeout lets the call through | Elevation | Catch-all deny + exit 2 (M2); no short timeout |
| Spoofed run identity in the hook payload | Spoofing | Identity from environment only |
| Symlink/`..` escape from the worktree | Tampering | Canonicalise deepest existing ancestor; marker `worktree_root` canonical |
| Agent rewrites its own marker (`echo > .../scope/<id>.json` via Bash) | Tampering | Same accepted residual class as the stage marker; the close-time backstop reads git, not the marker, so it is independent |
| Execution agent calls `submit_plan` to rewrite scopes | Elevation | Rust-side run-kind check; the tool is visible to all runs |
| Widen race: two agents widen into each other | Tampering | In-flight re-check inside the same transaction as the write (D-152) |
| Event-log flood by a looping agent | DoS | Tiny rows, indexed; no coalescing (D-154); badge aggregate indexed |
| Rate-limit probing / retry storm | Abuse optics | Pause on first signal, no probe, no blind retry; backoff floor on a second rejection |

**Recommended documentation:** add a section to `docs/destructive-gate-trust-boundary.md` (D-62 item 3 precedent) recording what the scope hook is trusted to prove and what it structurally cannot see (Bash, sub-agent behaviour if A3 fails, marker tampering).

## Suggested Plan Slicing (non-binding)

Mode is `mvp` (vertical slices). Each slice ends in something runnable.

| Slice | Delivers | Depends on |
|-------|----------|-----------|
| A. `file_set` + migration `0019` + overlap/edge/`why` | PLAN-02, PLAN-03, PLAN-07 as pure, tested core | — |
| B. Scope marker + shim `--scope-check` + hook + settings wiring + notice + `task.scope_denied` + backstop + Widen + badge + feed row, driven by a **manually declared** set (small command `task_file_set_set`) | PLAN-04, PLAN-05, D-150, D-152, D-153; success criterion 3 demonstrable with no planner | A |
| C. Cap setting + rate-limit adapter mapping + Rust consumer + gate + pause/resume UI line | PLAN-06 (setting), AGNT-05 | — (parallel with A/B) |
| D. Dispatcher: plan tables CRUD, `decide`, tick job, launch-body extraction, auto-merge by system actor, commit instruction, restart-paused | D-155, D-156, D-158, PLAN-03/06 in force | A, B, C |
| E. Planning pass: `start_planning_run`, `render_planning_prompt`, `submit_plan` held call, draft plan | PLAN-01, D-147, D-149 | A, D |
| F. UI: wave plan sheet, epic dispatch controls, settings cap, copy | UI hint | D, E (components can start earlier against DTO fixtures) |

Slice B before E is deliberate: it proves the highest-risk claim (enforcement) against the real binary early and independently of the agent planner.

## Sources

### Primary (HIGH confidence)
- In-repo files read this session: `09-CONTEXT.md`, `REQUIREMENTS.md`, `.claude/CLAUDE.md`, `.planning/config.json`, `packages/sidecar/src/{stage-gate-hook,pretooluse-hook,claude-code-adapter,adapter,index,mcp-permission-server}.ts`, `packages/core/src/{git_retry,merge,runtime_protocol,branch,git_facts,context_packet}.rs`, `packages/core/src/domain/{settings,agent_run,authoring_session,worktree,epic,trigger}.rs`, `packages/desktop/src-tauri/src/{scheduler,state,sidecar}.rs`, `.../commands/{agent_run,authoring,review,settings}.rs`, migrations `0002`, `0010`, `0018`, `.planning/research/PITFALLS.md`, `.planning/phases/08-*/08-RESEARCH.md` and `08-VALIDATION.md` (format/precedent), `.planning/DEFERRED-REVIEW.md`.
- Live probes against `claude 2.1.285` (M1-M7), scratch directory only.
- `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json` — captured `allowed_warning` event.

### Secondary (MEDIUM confidence)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) — PreToolUse input fields, exit code 2 blocks, other non-zero codes do not, timed-out hook does not block (fetched through a summarising tool; M1/M2 corroborate the exit-code behaviour).
- [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) — `SDKAssistantMessageError` includes `rate_limit`, `overloaded`, `billing_error`; `SDKRateLimitEvent` is part of `SDKMessage` (full field table not present in the fetched excerpt).

### Tertiary (LOW confidence)
- [Rate limit event shape discussion](https://claudeissues.com/issue/41185-rate-limit-event-include-utilization-in-allowed-status) and [SDK type documentation gap](https://claudeissues.com/issue/26392-docs-agent-sdk-missing-sdkratelimitinfo-and-sdkratelimitevent-type-documentation) — `status` in {`allowed`, `allowed_warning`, `rejected`}; `resetsAt` described as milliseconds there but seconds in the live capture (M6).
- [claude -p empty result when `overageStatus` is `rejected`](https://claudeissues.com/issue/38673-claude-p-returns-empty-result-despite-valid-response-when-rate-limit-overagestat) — shows `overageStatus: "rejected"` is not the same as a hard stop (consistent with M6).
- [PreToolUse deny ignored for Edit (closed not planned)](https://claudeissues.com/issue/37210-pretooluse-hook-permissiondecision-deny-ignored-for-edit-tool-tool-executes-desp) — a reported enforcement failure on an older version; **not reproduced** on 2.1.285 for `Write` (M1) and `Edit` was not probed this session, so the live test must cover `Edit` and `NotebookEdit` explicitly.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all reused modules were opened.
- Architecture: MEDIUM — dispatcher and planning-pass shapes are designed from the seams, not yet built; the hook mechanics are HIGH (measured).
- Pitfalls: HIGH for M1-M7-backed items and the commit-instruction gap; MEDIUM for A3/A4/A6/A7/A9; LOW for the hard-limit wire (A2).

**Research date:** 2026-10-09
**Valid until:** 2026-10-23 for CLI-behaviour claims (the `claude` CLI ships frequently; re-run the live probes if the version changes); 30 days for in-repo seam claims.
