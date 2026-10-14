# Phase 6: Agents File Their Own Backlog - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-30
**Phase:** 6-agents-file-their-own-backlog
**Areas discussed:** Proposal channel & tool surface, Merge and defer semantics, Duplicate flagging, Per-run proposal limit

---

## Pre-discussion: matched todos

Four pending todos matched Phase 6 by keyword. All were presented and none folded.

| Option | Description | Selected |
|--------|-------------|----------|
| Fold none | All four are Phase-5 authoring/harness defects; record as reviewed-but-deferred | ✓ |
| Fold the adapter text-drop fix | `claude-code-adapter.ts:589-612` discards narration when one stream line carries text and `tool_use` | |
| Fold the live-run board-write defect | G-05-8: `AskUserQuestion` invisible and board unwritable in a live run, severity blocker | |

**User's choice:** Fold none.
**Notes:** The adapter text-drop defect was nonetheless carried into CONTEXT.md as a stated
constraint on D-99 — it is why the rationale field is required rather than derived from the turn.

---

## Proposal channel & tool surface

### Q1 — Where does an execution run's proposal live before triage?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `authoring_proposals` | Add `issue` to `target_type`, allow task-scoped origin; `issues` keeps zero status columns; `merged_into_task` becomes a proposal outcome. Reuses the one place where no-promotion is already structurally true (D-96) and reuses `TriageLane`/`ProposalRow`. | ✓ |
| Give `issues` the triage lifecycle | Honour `issue.rs:5` literally — the agent writes an `issues` row in `proposed`. But a proposed task or epic has no home there, so PROP-01 needs a second channel anyway. | |
| Split by target type | Tasks/epics to `authoring_proposals`, issues to `issues`. Each lands where it belongs, but two proposed-states to prove PROP-03 against and two triage surfaces. | |

**User's choice:** Extend `authoring_proposals` → **D-97**.
**Notes:** This resolves an apparent contradiction between Phase 1's reservation and Phase 5's
shipped table, rather than choosing between them.

### Q2 — What write-tool surface does an execution run get?

| Option | Description | Selected |
|--------|-------------|----------|
| One tool: `propose_item` | Single MCP tool, `target_type` ∈ {task, issue, epic}, one new `--allowedTools` entry mirroring `report_summary` (D-64/D-46). Authoring's six-tool family untouched. | ✓ |
| Reuse `propose_task`/`propose_epic`, add `propose_issue` | One vocabulary across run kinds, but the handlers assume an epic-scoped authoring socket and the stage-gate name-prefix regex would span two run kinds. | |
| Three new execution-scoped tools | No branching in authoring's handlers, but nine proposal tools against one staging table. | |

**User's choice:** One tool: `propose_item` → **D-98**.

### Q3 — What gets stored as PROP-07's "what prompted it"?

| Option | Description | Selected |
|--------|-------------|----------|
| Rationale field + turn pointer | Required named `rationale` in the payload plus the session sequence number, so triage can jump into the transcript at the producing turn. | ✓ |
| Required rationale field only | Cheapest and always present, but self-reported and uncheckable from the triage view. | |
| Turn pointer only | Real evidence rather than self-report, but the open adapter defect can leave the jump target a bare tool call with no stated reason. | |

**User's choice:** Both → **D-99**.

### Q4 — What form does the no-promotion proof take?

| Option | Description | Selected |
|--------|-------------|----------|
| Source gate + adversarial corpus | Rust source gate over agent-reachable modules plus an end-to-end corpus driving every verb. Mirrors D-62's own closing shape. | ✓ |
| Source gate only | Proves the code contains no such statement, not that no composition reaches the same effect. | |
| Adversarial corpus only | Covers only the paths someone thought to try — the exact gap the ROADMAP note names. | |

**User's choice:** Both → **D-100**.
**Notes:** Chose "Next area" at the continuation check, delegating the table-rename and
execution-session-tray questions to Claude's discretion.

---

## Merge and defer semantics

### Q1 — What does "merge into an existing item" do to the target?

| Option | Description | Selected |
|--------|-------------|----------|
| Attach as a child issue | `create_issue` with `IssueParent`; proposal closes `merged` with `materialised_id` set. Nothing already accepted is mutated. | ✓ |
| Append to the target's description | Fewest new rows, but a triage action then mutates an accepted item, possibly one with criteria locked by D-76/D-77. | |
| Add it as an acceptance criterion | Fits a missing condition of done, but D-76 locks criteria on first agent run, landing on the D-77/D-78 revision path. | |

**User's choice:** Attach as a child issue → **D-101**.

### Q2 — What does "defer" mean?

| Option | Description | Selected |
|--------|-------------|----------|
| A `deferred` status, recallable | Leaves the pending queue, stays per D-83, joins the primed decided set, mints no board row. No scheduler needed. | ✓ |
| Snooze until a date | A real "remind me later", but needs the unwired `tokio-cron-scheduler` and reintroduces surprise. | |
| Defer materialises an idea issue | Durable and visible without becoming work, but every defer grows the issues lane. | |

**User's choice:** A `deferred` status → **D-102**.
**Notes:** The deciding factor was PROP-05's chatty-agent case — a defer that minted a row each
time would be the backlog spam the ROADMAP note says collapses trust.

### Q3 — Does PROP-06's "dedicated view" mean a new surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated triage surface | A pane sibling to `SessionSurface.tsx`, project-scoped, with `TriageLane` as the board entry point carrying the count. | ✓ |
| Extend the existing board lane | Cheapest — everything already ships — but merge's target picker has to live in a 32px row. | |
| Modal over the board | No new route, but a poor home for a queue worked row by row and undeep-linkable. | |

**User's choice:** Dedicated triage surface → **D-103**.
**Notes:** Deliberately project-scoped; a cross-project queue is FLEET-01/02's work.

### Q4 — Does the surface get bulk actions?

| Option | Description | Selected |
|--------|-------------|----------|
| Bulk reject/defer, never bulk accept | Accept mints canonical rows and burns a per-project key (D-10) so stays deliberate; reject/defer mint nothing. Plan 05-06's accept-all source gate stays green. | ✓ |
| No bulk anything | SHAPE-04 as literally written; zero new risk but fifteen clicks to clear fifteen near-duplicates. | |
| Bulk everything via multi-select | Fastest, but puts an accept-all control into `packages/desktop/src`, failing the existing source gate. | |

**User's choice:** Bulk reject/defer only → **D-104**.
**Notes:** Chose "Next area"; keyboard bindings and whether `amend` applies to execution-run
proposals delegated to Claude's discretion.

---

## Duplicate flagging

### Q1 — What detects a duplicate?

| Option | Description | Selected |
|--------|-------------|----------|
| bm25 over the shipped FTS indexes | `tasks_fts`/`epics_fts`/`issues_fts` already exist with sync triggers; `search.rs` already escapes model-authored text against FTS5 syntax. Deterministic and local. | ✓ |
| Normalised-title near match | Most predictable and easiest to explain, but misses the same finding in different words. | |
| Both, FTS as the recall pass | Best precision, but two tunable thresholds and more to explain when a flag looks wrong. | |

**User's choice:** bm25 over the shipped indexes → **D-105**.
**Notes:** An embedding detector was ruled out before the question was asked — Flywheel
authenticates only through local Claude credentials, never an API key, and runs local-first.

### Q2 — What corpus is checked?

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical + pending + already-decided | Includes the rejected/deferred rows D-83 keeps; re-proposing a rejected idea is the most irritating duplicate. The decided half has no FTS index today. | ✓ |
| Canonical + pending | Both halves already indexed, but a rejected idea can be re-proposed unflagged on every run. | |
| Canonical only | Smallest and fastest, but two agents in one wave proposing the same follow-up both pass unflagged. | |

**User's choice:** All three sets → **D-106**.

### Q3 — Stored on the row, or computed on read?

| Option | Description | Selected |
|--------|-------------|----------|
| Stored at staging time | `duplicate_of`/`duplicate_score` written in the staging transaction. Provably pre-surfacing, deterministic to test, bounded. Row always still appears. | ✓ |
| Computed in the triage read | Always current and no migration, but an unbounded read shape per render — the pattern `unbounded_reads` exists to refuse. | |
| Stored, then refreshed on read | Most accurate, but two code paths for one number that can disagree. | |

**User's choice:** Stored at staging time → **D-107**.

### Q4 — Does the agent learn it proposed a duplicate?

| Option | Description | Selected |
|--------|-------------|----------|
| Tell it — return the candidate | `propose_item` resolves with `staged` plus the candidate's key and title. D-93's shape; also relieves pressure on the per-run limit. | ✓ |
| Stay silent — keep `{"staged": true}` | Uniform result shape across run kinds, but the agent cannot notice it is repeating itself. | |
| Refuse to stage a duplicate | Queue never carries duplicates, but that is auto-dropping, which PROP-04 does not ask for. | |

**User's choice:** Tell it → **D-108**.
**Notes:** Chose "Next area"; the threshold value and whether the decided set gets its own FTS
table delegated to Claude's discretion, the threshold explicitly because it wants measurement.

---

## Per-run proposal limit

All four questions were presented as one set, being mutually independent.

### Q1 — What is the cap, and is it configurable?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed constant, not configurable | ~10 per run, one named constant. Follows D-69's own fixed-window precedent. | ✓ |
| Global setting with a default | Tunable, but a new settings surface and a value tests stop being able to assume. | |
| Per-project setting | Matches differing repos, but a `projects` column, a settings UI and a fixture value everywhere. | |

**User's choice:** Fixed constant → **D-109**.

### Q2 — Where is it enforced?

| Option | Description | Selected |
|--------|-------------|----------|
| Rust core, in the staging transaction | `COUNT(*)` on the existing `(agent_run_id, status)` index, inside the write. Unraceable, survives sidecar restart. | ✓ |
| Sidecar tool layer | Fastest refusal, but an in-memory counter `watchdog.ts` resets on restart and any other writer bypasses. | |
| Both | Defence in depth like D-55's hook-plus-shim, but two counters that can disagree. | |

**User's choice:** Rust core, in the transaction → **D-110**.

### Q3 — What does the agent get on the tripping call?

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse loudly, point at the summary | Tool error naming the limit; the agent puts the rest in `report_summary`'s `remains` (D-65). | ✓ |
| Stage it, mark it over-limit | Nothing discarded, but the limit stops limiting — spam in the queue with a label. | |
| Refuse silently | Smallest contract change, but PROP-05 explicitly asks for the opposite. | |

**User's choice:** Refuse loudly → **D-111**.

### Q4 — How is the user told?

| Option | Description | Selected |
|--------|-------------|----------|
| An `events` row, display re-derived | D-74/D-75 applied verbatim; follows D-53's count-all-surface-exhaustion rule. | ✓ |
| An OS notification | Lets you intervene mid-run, but that channel is FLEET-05's work. | |
| Only in the run's output | Zero plumbing, but invisible unless you were watching that run. | |

**User's choice:** An `events` row → **D-112**.

---

## Claude's Discretion

Explicitly delegated by the user across the four continuation checks, plus items surfaced during
discussion and left open. Full list with rationale in `06-CONTEXT.md` under
`### Claude's Discretion`:

- Renaming `authoring_proposals` now that it serves both run kinds.
- A live proposal tray on an executing agent's session surface.
- Keyboard bindings for the four triage verbs.
- Whether `amend` (D-94) applies to an execution-run proposal.
- The bm25 threshold value — wants measurement, not a guessed number.
- Whether the decided set gets its own FTS5 table or is title-matched.
- The `issues` payload shape for an `issue`-target proposal (`kind` ∈ bug/idea/question/risk).
- What happens to a pending proposal when its run is abandoned (D-49).

## Deferred Ideas

- Cross-project proposal queue — FLEET-01/02.
- OS notification on throttle or proposal arrival — FLEET-05.
- `deferred_until` snooze — needs the stubbed `tokio-cron-scheduler` trigger machinery.
- Defer-as-idea-issue — a later refinement if the deferred pile proves to be where ideas die.
