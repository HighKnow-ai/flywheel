# Phase 9: Planned Fan-Out That Does Not Collide - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn one epic into several agents working at once, with parallelism bounded by **real file-set
disjointness** rather than optimism — and enforced at the tool call, not trusted to the plan.

Delivers PLAN-01…PLAN-07 and AGNT-05:

- A pre-dispatch planning pass that attaches a declared file-set to each of an epic's tasks and
  groups them into waves (PLAN-01).
- A pairwise declared-file-set overlap check before dispatch, degrading only the colliding pair
  to sequential (PLAN-02, PLAN-03) and able to say why any two tasks were sequenced (PLAN-07).
- A tool-level pre-write hook that refuses a write outside the running task's declared file-set,
  surfaced as a scope event (PLAN-04, PLAN-05).
- A global cap on parallel width the dispatcher never exceeds (PLAN-06).
- Detected rate/session limits that pause dispatch and tell the user, rather than retrying
  blindly (AGNT-05).

**Fixed by prior decisions, not re-opened here:** worktree topology is task → epic integration
branch → main (PROJECT.md § Key Decisions). The planner decides fan-out width and wave grouping,
never topology. Claude Code only, behind the adapter seam, on local credentials.

**Not in this phase:** cross-project fleet supervision (Phase 10), packaging and signing
(Phase 11), any second agent backend.

</domain>

<decisions>
## Implementation Decisions

### File-set declaration

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

### Out-of-scope write

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

### Wave dispatch

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

### Cap & limit backoff

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The two failure modes this phase exists to prevent
- `.planning/research/PITFALLS.md` § "Pitfall 1: Worktree lock contention silently destroys agent
  work at fan-out" — `anthropics/claude-code#55724`, 8 of 13 agents failing at 13-way
  parallelism, plus auto-cleanup destroying the uncommitted diff. Already mitigated by
  `git_retry.rs`; read it before changing anything about spawn timing.
- `.planning/research/PITFALLS.md` § "Pitfall 2: Agents modify files outside their declared
  file-set" — the ~35% → ~4% figure behind PLAN-04, and the explicit instruction that the
  tool-level hook is a *companion* to the overlap guard, not an alternative (the overlap guard
  only ever sees what was declared).
- `.planning/research/PITFALLS.md` § Verification checklist — "verify a runtime tool-call-level
  hook actually blocks/flags out-of-scope writes, not just plan-time overlap checking" and
  "deliberately instruct a test agent to 'also clean up' an undeclared file".
- `.planning/research/PITFALLS.md` § on subscription-credential enforcement and concurrent
  session limits — the compliance-optics reason AGNT-05's visible backoff exists.

### Scope and success criteria
- `.planning/ROADMAP.md` § "Phase 9: Planned Fan-Out That Does Not Collide" — the five success
  criteria and the Notes paragraph establishing criteria 2 and 3 as companion mechanisms.
- `.planning/REQUIREMENTS.md` lines 111–117 (PLAN-01…PLAN-07) and line 75 (AGNT-05).

### Decisions this phase must not re-open
- `.planning/PROJECT.md` § Key Decisions — "Worktree topology is fixed: task → epic integration
  branch → main" and "Planner decides fan-out width and wave grouping, not topology".
- `.planning/PROJECT.md` § Context, "How GSD-core solves parallelism today" — the
  `execute-phase.md:595` pairwise `files_modified` overlap check this phase is modelled on, and
  the stated lesson that the partitioning key is file-set disjointness, not issue hierarchy.

### The hook discipline the scope hook must inherit
- `docs/destructive-gate-trust-boundary.md` § Layer 1 — the fail-closed composition rule for a
  `PreToolUse` hook: an unreported or non-boolean fact denies on its own account, and a hook that
  cannot establish its precondition never concludes the precondition is permissive. D-151's hook
  is the third hook in this family and must not be the one that relaxes the rule.

### The phase whose contract D-156 re-interprets
- `.planning/phases/08-review-and-merge-inside-flywheel/08-CONTEXT.md` and `.planning/ROADMAP.md`
  § Phase 8 success criterion 3 — per-task merge into the integration branch as a human act.
  Read before implementing D-156.

No ADRs exist in this repository; `docs/` holds exactly one document
(`destructive-gate-trust-boundary.md`). Requirements beyond the above are fully captured in the
decisions section.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`writeHookSettings`** (`packages/sidecar/src/claude-code-adapter.ts:165`) — writes the per-run
  `--settings` JSON holding the `PreToolUse` array. It already carries two conditional entries
  (`matcher: "Bash"` for the destructive gate, `AUTHORING_STAGE_GATE_MATCHER` for the authoring
  stage gate) plus a `SessionStart` entry. PLAN-04's scope hook is a **third entry with a
  write-capable-tool matcher**, not new plumbing. Note the established discipline: each addition
  leaves the existing entries byte-identical, and `includeAuthoringStageGate` shows the pattern
  for a per-run-kind conditional.
- **`stage-gate-hook.ts`** (`packages/sidecar/src/stage-gate-hook.ts`) — the exact structural
  template for the scope hook: standalone Node entry point, reads stdin fully before deciding,
  resolves `FLYWHEEL_RUN_ID` / `FLYWHEEL_RUNTIME_DIR` from **its own environment and never from
  the hook payload** (model-adjacent data must not name another run's state), reads
  `<runtimeDir>/stage/<runId>.json` **fresh per call** with no cache, and fails closed on an
  absent/unreadable/unrecognised marker. The scope hook wants `<runtimeDir>/scope/<runId>.json`
  with the same discipline — and the fresh-per-call read is precisely what makes D-152's live
  widening free.
- **`pretooluse-hook.ts`** (`packages/sidecar/src/pretooluse-hook.ts`) — the never-waits
  constraint and its source gate. A `PreToolUse` hook that has not exited by its configured
  timeout is cancelled and the tool call proceeds anyway. D-151's "deny, do not ask" is partly a
  consequence of this; a hook that blocks on a human is a cancellable interception point.
- **`git_retry.rs`** (`packages/core/src/git_retry.rs`) — `SpawnFloor` enforces a hard 400ms
  minimum gap between spawns against the *same repository* (D-52/WORK-05), and `with_lock_retry`
  owns the single backoff curve for commit-time lock contention. **Pitfall 1 is already
  mitigated**; the dispatcher must route spawns through `SpawnFloor::wait_turn` rather than
  inventing a second policy (source gates in `packages/core/tests/git_retry.rs` enforce the
  one-policy rule).
- **`rate_limit` AgentEvent** (`packages/sidecar/src/adapter.ts:370`, parsed at
  `claude-code-adapter.ts:942`) — the wire's `rate_limit_event` line carrying `status`,
  `resetsAt`, `rateLimitType`, `utilization`, already parsed and emitted with per-field degrade.
  **AGNT-05's detection half ships.** What is missing is the dispatcher consuming it (D-160,
  D-161, D-162).
- **`merge.rs`** (`packages/core/src/merge.rs`) — `plan_merge` is a dry run that touches nothing;
  `run_merge` runs in a worktree belonging to the **epic**, never the task's own worktree, so an
  agent working there cannot collide with it. Exactly the two halves D-156 needs. Note its stated
  rules: it writes no status column and never creates an integration branch (a merge into an epic
  with none cut is a refusal).
- **`scheduler.rs`** and **`domain/trigger.rs`** — the in-core tick and the generic trigger
  abstraction. Home for the wave-advance trigger (D-155) and the `resetsAt` resume (D-162).
- **Session feed + `PermissionRequestCard`** (`packages/desktop/src/session/`) — D-153's feed row
  with its Widen action sits beside an existing card that already renders an interception with an
  action on it.
- **`domain/settings.rs`** — `global_credential_mode` / `set_global_credential_mode` is the
  precedent for D-159's global cap: a single global setting with a project-level override added
  later without a schema change.
- **`task.outside_commit_detected`** (Phase 7 drift) — precedent for the shape of a
  "the agent did something outside its lane" event.

### Established Patterns

- **One-transaction writes.** Every board mutation commits the projection row, the per-origin
  event sequence and the event together or not at all (`domain/task.rs` module doc, DATA-01).
  A file-set write and its event follow the same rule. `create_task_in_tx`-style
  `*_in_tx` variants exist for composing into a caller's transaction — the pre-dispatch pass
  writing N file-sets wants one.
- **Fail closed, loudly, with a named cause.** Three hooks now; none of them concludes a
  precondition is permissive when it cannot establish it, and a broken install is a hard
  precondition failure rather than a session that silently denies everything with no named cause.
- **Single-list discipline.** A vocabulary (`AUTHORING_STAGES`, `ISSUE_KINDS`,
  `WORKFLOW_STATES`) appears in exactly one Rust constant and one migration CHECK constraint, and
  matchers are built from the same constant the server registers against so the two cannot drift.
  A file-set entry-form vocabulary (D-148) should follow this.
- **The git-running half takes plain values, never a connection** (`merge.rs`, `forge/`) — so a
  caller cannot hold the database lock across a subprocess. The dispatcher spawns processes; this
  rule binds it.
- **Human-only transitions have no agent-reachable caller.** `advance_stage` takes a human actor
  id and is called from nowhere an agent can reach (D-90). D-149's dispatch gate and D-152's
  widen approval belong in that family.
- **Event log is append-only and per-origin sequenced** — D-157's sequencing-reason event and
  D-153's scope event land there.

### Integration Points

- `packages/desktop/src-tauri/src/commands/agent_run.rs:628` — `agent_run_start` is today's
  single-task launch. The wave dispatcher is a new caller of the same spawn path; D-150 means this
  command keeps working for a task with no file-set.
- `packages/sidecar/src/index.ts:142` — the sidecar's `sessions: Map<string, Promise<void>>`
  already supports several concurrent sessions structurally. Nothing caps the width today;
  D-159's cap belongs in the Rust core's dispatcher, not here.
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` — the existing launch surface; the wave plan
  review (D-149) is its epic-level sibling.
- `packages/desktop/src/board/` — `BoardRow.tsx` / `EpicHeaderRow.tsx` for D-153's count badge and
  the dispatch entry point on an epic.
- `packages/core/src/branch.rs` + `epic.integration_branch_created` — the integration branch
  D-156 merges into must exist before dispatch; a wave plan over an epic with no integration
  branch cut is a precondition failure, and `merge.rs` will refuse rather than cut one.

</code_context>

<specifics>
## Specific Ideas

- The GSD-core `execute-phase.md:595` pairwise overlap check is the explicit model for PLAN-02 —
  including its reason for existing: the planner's file forecast is *frequently wrong*. The
  Flywheel version differs in one deliberate way: GSD downgrades the **whole wave** to sequential
  on any collision; D-158 downgrades **only the colliding pair**.
- The `~35% → ~4%` scope-violation figure is a single-source practitioner data point, flagged
  LOW-MEDIUM confidence in `PITFALLS.md`. It motivates the hook; it is not a benchmark to verify
  against.
- Verification idea carried from `PITFALLS.md`: deliberately instruct a test agent to "also clean
  up" an undeclared file and assert the hook refuses it and a scope event lands. That is an
  automatable check, not a human one.

</specifics>

<deferred>
## Deferred Ideas

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

### Reviewed Todos (not folded)

The `todo.match-phase 9` matcher returned 9 candidates. Eight are keyword false positives — none
touches fan-out, file-sets, waves, scope enforcement or backend limits:

- *Adapter drops assistant text when a stream line carries text and tool_use* — adapter parsing
  bug, unrelated to dispatch.
- *Socratic challenge should be structured like GSD's questioning* — Phase 5 authoring.
- *Handoff sheet drops questions the agent asked* — Phase 4 context packet.
- *Forge-sourced URLs reach an anchor href without scheme validation* — Phase 7 forge security.
- *git_identity builds a table name into SQL with format!* — core convention fix.
- *Subprocess timeout guard leaks reader threads under a sustained forge outage* — Phase 7.
- *Live-chain tests inconsistently assert that the fake CLI was actually reached* — test hygiene.
- *Timeout-boundary race misreports a child that just finished as TimedOut* — core timeout logic.

One is plausibly amplified by this phase and was **reviewed but not folded**:

- *Forge resolution failures are not memoised, so they retry per worktree every tick* — fan-out
  multiplies this by wave width, so a forge outage during a wide wave means N worktrees × retries
  per tick. Not folded because it is a Phase 7 defect with its own fix, not a fan-out decision;
  **flagged here so the planner knows fan-out makes it worse** and can decide whether a wide wave
  is an acceptable trigger for it.

</deferred>

---

*Phase: 9-Planned Fan-Out That Does Not Collide*
*Context gathered: 2026-10-09*
