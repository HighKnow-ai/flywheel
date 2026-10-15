---
phase: 13-nothing-new-escapes-the-fence
verified: 2026-10-15T17:00:00Z
status: passed
score: 6/6 roadmap criteria verified (2 via owner overrides; 2 further clauses enforced downstream in Phase 16, no override)
covered_files: [".planning/REQUIREMENTS.md", ".planning/ROADMAP.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-01-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-01-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-02-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-02-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-03-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-03-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-04-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-04-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-05-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-05-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-06-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-06-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-07-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-07-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-08-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-08-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-09-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-09-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-10-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-10-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-11-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-11-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-12-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-12-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-13-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-13-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-14-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-14-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-15-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-15-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-16-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-16-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-17-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-17-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-18-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-18-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-UAT.md", "CLAUDE.md", "packages/core/src/compaction.rs", "packages/core/src/context_packet.rs", "packages/core/src/db/mod.rs", "packages/core/src/domain/actor.rs", "packages/core/src/domain/agent_run.rs", "packages/core/src/domain/authoring_proposal.rs", "packages/core/src/drift.rs", "packages/core/src/epic_context_packet.rs", "packages/core/src/forge/transitions.rs", "packages/core/src/schema_classification.rs", "packages/core/src/status_derivation.rs", "packages/core/tests/authority_human_only.rs", "packages/core/tests/context_packet_bound.rs", "packages/core/tests/drift.rs", "packages/core/tests/migration_safety.rs", "packages/core/tests/no_agent_status_write.rs", "packages/core/tests/pm_vocabulary_gate.rs", "packages/core/tests/proposal_no_promotion.rs", "packages/core/tests/spine_pin.rs", "packages/core/tests/table_classification.rs", "packages/desktop/src-tauri/src/commands/agent_run.rs", "packages/desktop/src/board/useBoardChangedInvalidation.ts", "packages/desktop/src/board/useBoardQuery.ts", "packages/desktop/src/state/keyboard.ts"]
covered_digest: "v1:sha256:f77cf29eef6f951175c497412e42985790b39e0a2b882c783064d2149438ea34"
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "the foreign-key chain above epics ends at the cycle table, which has no parent, and no other table references it"
    reason: "No cycles table exists until Phase 14; the spine-pin mechanism that will assert it is in place and will fail the moment epics.cycle_id is added. Clause moved to Phase 14 success criterion 1."
    accepted_by: "Cyril Marechal"
    accepted_at: "2026-10-15T00:00:00Z"
  - must_have: "A live, credential-spending planning run exists as a recorded artifact showing the planner naming real files"
    reason: "Requires the owner's own credentials and cannot be produced by an agent. Serves DRFT-01, whose home is Phase 15; the hand-typed path field stays until the artifact exists."
    accepted_by: "Cyril Marechal"
    accepted_at: "2026-10-15T00:00:00Z"
re_verification:
  previous_status: gaps_found
  previous_score: "2/6 roadmap criteria fully verified (4 partial)"
  gaps_closed:
    - "Criterion 4: decision_ids_on_record is one LIMIT-bound statement; a failed read is propagated and the caller omits the detector; PRIOR_AUTHORING_RUNS_SQL carries LIMIT ?2; drift.rs is in the unbounded-reads gate"
    - "Criterion 5: one shared useBoardChangedInvalidation hook; exactly three production subscribeBoardChanged callers (definition, the hook, the account-wide fleet subscription); dispatch cap on an account-scope subscription"
    - "Criterion 1: Gate 1 UPDATE side derived from canonical_tables(); allow-list entries are exact normalised statements; INSERT OR REPLACE / REPLACE INTO covered"
    - "Criterion 3: PM gate matches identifier components; status-write gate normalises column order, case and line breaks; migration-0023 FTS guard is behavioural (joins back to base rows, integrity-check)"
    - "Criterion 6 / DRFT-09: no-agent_runs.kind decision recorded as A-07, ROADMAP F6 line corrected"
    - "FNC-06: SURFACE_LAYERS orphan deleted"
  gaps_remaining: []
  regressions: []
backlog_findings:
  - id: BL-1
    finding: "decision_ids_on_record truncates candidates past the 25th; the detector then reports a real out-of-window decision as FabricatedDecisionEcho (13-12's first prohibition, narrowed from read error to read error or cap overflow, not removed)"
    where: "packages/core/src/drift.rs:337-343,361-364 consumed at :233-245"
    blocks_roadmap_criterion: false
    why_not: "Criterion 4 says no unbounded read remains, and that is true. Reachability is narrow: the packet does not show the agent summaries older than the 25-summary window, so >25 distinct real out-of-window ids must be echoed in one summary."
    fix: "Return a typed 'incomplete' (caller maps to None) when candidates were truncated, or ignore echoed ids beyond the cap; add a 26-real-ids test"
  - id: BL-2
    finding: "no_agent_status_write.rs and proposal_no_promotion.rs do not strip a Rust trailing-backslash line continuation. Reproduced: 'UPDATE tasks SET \\<newline> status = ?1' normalises to a SET list of '\\status=?1' and is not flagged"
    where: "packages/core/tests/no_agent_status_write.rs:79-95; packages/core/tests/proposal_no_promotion.rs normalise_sql"
    blocks_roadmap_criterion: false
    why_not: "I re-scanned core, desktop-tauri and sidecar with continuations collapsed: the only tasks.status writer is domain/task.rs, and no canonical-table write sits outside its owner except the five allow-listed exact statements. The tree is clean; this is a latent gate weakness for Phase 14/16 code."
    fix: "Strip a trailing backslash before joining lines in both normalisers; add a continuation case to each planted-violation test"
  - id: BL-3
    finding: "Gate 1 matches only insert into / insert or replace into / replace into / update T set. INSERT OR IGNORE|ABORT|FAIL|ROLLBACK, UPDATE OR <action>, quoted or schema-qualified table names are not matched"
    where: "packages/core/tests/proposal_no_promotion.rs table_insert_patterns, canonical_update_patterns"
    blocks_roadmap_criterion: false
    fix: "Structural regex over normalised text, or add the missing OR-forms with planted cases"
  - id: BL-4
    finding: "PM-vocabulary idiom exclusion is per line and per word: Vec::with_capacity(team_capacity) is silent. 13-14's own truth ('a PM-shaped use of either word on a line that also holds the excluded literal is still an offender') is false for the same-word case; its test only passes because it uses a different word. Reproduced by tracing the matcher"
    where: "packages/core/tests/pm_vocabulary_gate.rs:134-144"
    blocks_roadmap_criterion: false
    why_not: "Grep of core, desktop, desktop-tauri and sidecar finds no forbidden word outside the two named idioms. Gate hardening."
    fix: "Make the exclusion occurrence-level (match span inside the literal span); plant Vec::with_capacity(team_capacity)"
  - id: BL-5
    finding: "CLAUDE.md:53 still says 'git >= 2.44'; git.rs MIN_SUPPORTED_GIT is (2, 54, 0) and its doc says 2.44 was an unbisected guess deliberately replaced. 13-18's prohibition ('must never state something the tree contradicts') is not met on this cell. The review's 'deadline-watched' objection is not valid: proc.rs still names its timeout Instant 'deadline'"
    where: "CLAUDE.md:53"
    blocks_roadmap_criterion: false
    fix: "Change the version cell to 'git >= 2.54' (cite MIN_SUPPORTED_GIT)"
  - id: BL-6
    finding: "Residual off-by-one pointer. The criterion-1 override still says the cycle-chain clause was 'moved to Phase 14 success criterion 1'. The clause is now carried, but by Phase 14 SC2 (ROADMAP.md, appended with a provenance note, commit 6ba782ba), not SC1. The original defect (nothing downstream carried the clause) is resolved; only the pointer in the override prose is wrong by one criterion"
    where: "13-VERIFICATION.md overrides[0].reason (owner's prose, left untouched); .planning/ROADMAP.md Phase 14 SC2"
    blocks_roadmap_criterion: false
    why_not: "Owner was offered the one-word correction (1 -> 2) in UAT test 2 and declined it. Accepted residual, recorded so it is not mistaken for an oversight. spine_pin.rs still fails when epics.cycle_id is added, and Phase 14 SC2 now owns the 'no parent, no other referrer' assertions"
    fix: "Optional: change 'criterion 1' to 'criterion 2' in the override reason"
human_verification_resolved:
  source: 13-UAT.md
  completed: 2026-10-15T16:40:00Z
  result: "4 passed, 0 issues, Gaps section empty"
  items:
    - test: "Decide the two criterion clauses that cannot exist until Phase 16: (a) accepting an ADR refuses an agent at the database; (b) the 40-ADR / 30 KB PRD scale fixture"
      outcome: pass
      decision: "Owner chose enforcement downstream, NOT an override. (a) appended to Phase 16 SC4, (b) appended to Phase 16 SC5, each with a provenance note naming Phase 13 and the 2026-10-15 ruling (commit ad181714). overrides_applied stays 2."
    - test: "Confirm the criterion-1 override still reads as intended, given BL-6"
      outcome: pass
      decision: "Owner chose to append the cycle-table FK clause to Phase 14 SC2 (commit 6ba782ba) rather than amend the override. Residual off-by-one pointer (override says SC1) knowingly accepted; tracked as BL-6."
    - test: "Epic status after StatusPicker deletion"
      outcome: pass
      decision: "Deferral to Phase 14 confirmed. No shape chosen (neither derive-from-tasks nor a dedicated epic control). Phase 13 scoping to TASK status is correct on DRFT-04's text."
    - test: "Read the boundary sentence for a 200-summary task as the agent prompt shows it"
      outcome: pass
      decision: "Owner read it in rendered context and accepted. Session headings are numbered 1..25 window-relative in render_verbatim_summary_block / render_folded_summary_block, so the fold clause 1-20 / 21-25 matches what the reader sees. WR-10 closed on a human reading."
---

# Phase 13: Nothing New Escapes The Fence Verification Report (re-verification)

**Phase Goal:** Every structural guarantee the milestone is about to lean on is closed-world and asserted before the first new record type exists: the spine cannot erode, an unclassified table fails the build, authority is reachable only from a human, the context packet is bounded, and the fields nobody reads are gone rather than drafted.
**Verified:** 2026-10-15 (refreshed after human UAT)
**Status:** passed
**Re-verification:** Yes, after gap closure (plans 13-12 to 13-18). Prior report: commit 9996d94. Refreshed after UAT completion; see Refresh note.

## Refresh note (post-UAT)

This is a refresh, not a fresh verification. `verification.status` reported `stale` because `.planning/ROADMAP.md` is a covered input and changed after commit e2210999. I reproduced `git diff e2210999 HEAD`: it touches exactly `.planning/ROADMAP.md` and the new `13-UAT.md`. The working tree against e2210999 shows only those two plus `.planning/config.json` and `.planning/state.json`, neither of which is a covered input. So no source file, test file, PLAN or SUMMARY among the covered inputs changed. The four ROADMAP lines that moved:

1. Phase 13 `**Plans**:` line: bookkeeping ("7 gap-closure plans pending" to "all executed"). Not a success criterion.
2. Phase 14 SC2: cycle-table FK-chain clause appended, with provenance.
3. Phase 16 SC4: "accepting an ADR refuses an agent actor at the database", two-sided, appended.
4. Phase 16 SC5: 40-ADR / 30 KB PRD scale-fixture bound appended.

No Phase 13 success criterion text changed. I did not re-run the 18 test targets; the results below stand as recorded. `covered_files` now includes `13-UAT.md` and the digest was recomputed with `verification.fingerprint`.

**Substantive change since the last report.** The two clauses I flagged as carried by nothing (accepting an ADR refuses an agent at the database; the 40-ADR / 30 KB PRD scale fixture) are now enforced by Phase 16 SC4 and SC5, by owner decision, with no override. This is the strongest available resolution: the obligation sits in the criteria of the phase that creates the ADR and PRD tables, and is checked there. The cycle-table FK clause is likewise carried by Phase 14 SC2, which resolves the substance of BL-6. `overrides_applied` stays at 2 (cycle chain, live run); neither of the two Phase 16 clauses became an override.

## Verdict

All four gap groups from the first report are closed on the roadmap's own wording. I checked the tree, not the summaries. Every roadmap criterion verifies; criteria 1 and 6 each carry one owner-accepted override, and both are scoped to a clause that cannot exist yet. The four human-verification items are answered (4 passed, 0 issues).

What remains is not a roadmap-criterion failure. It is six backlog findings, all in gate strength or documentation, none of which is a violation in the tree today. Per the owner's standing rule (a phase closes on its roadmap criteria, and later findings become backlog issues), no further gap-closure round is recommended.

Two of the review's warnings I confirmed as real and two I weigh differently (below). One claim in the supplied evidence is off: `pm_vocabulary_gate` has 5 tests, not 12.

## Roadmap criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Classification closed-world, spine pin, no-promotion corpus, FK chain ends at cycle table | VERIFIED (override on cycle clause) | table_classification 2, spine_pin 4, proposal_no_promotion 15 pass. Gate 1 UPDATE side is now `canonical_update_patterns()` derived from `canonical_tables()`; `derivation_gaps` fails loudly on an empty derivation. Allow-list is five exact statements, each with a reason. |
| 2 | Authority transitions refuse an agent at the DB, unreachable from agent code, two-sided; three past-gate sites disposed | VERIFIED (ADR clause carried by Phase 16 SC4, no override) | authority_human_only 28 pass. The status gate's `SCAN_ROOTS` are core, desktop-tauri and sidecar (read directly; I did not separately re-read Gate 6's roots). Past-gate sites dispositioned in 13-AUTHORITY-ALLOWLIST.md. |
| 3 | PM vocabulary gate; estimate gone; priority opt-in; status derived | VERIFIED (BL-2, BL-4 gate hardening) | pm_vocabulary_gate 5, estimate_absent 2, priority_is_opt_in 4, status_derivation 31, status_transitions 22 pass. Component-prefix matching catches `story_points_total`, `sprint_id`, `overdueCount`. My independent grep of core, desktop, desktop-tauri, sidecar and migrations finds only the `deadline` Instant in `proc.rs` and `agent_run.rs`. Migration-0023 guard now joins to base rows (`fts_match_base_titles`) and runs FTS5 integrity-check. |
| 4 | Bounded packet, boundary sentence, strictly smaller for small fixture, byte-identical with a superseded record, no unbounded read | VERIFIED on the literal "no unbounded read" (BL-1; 40-ADR / 30 KB clause carried by Phase 16 SC5, no override) | context_packet_bound 6, epic_context_packet 18, drift 40, compaction 21 pass. `PRIOR_AUTHORING_RUNS_SQL` ends `LIMIT ?2` bound to `PRIOR_AUTHORING_RUNS_LIMIT` (10); the epic prompt states no run count, so the cap contradicts no text. `decision_ids_on_record` is one statement with candidate list and `LIMIT` both bound; empty list issues none; read errors propagate and `agent_run.rs:455-466` maps `Err` to `None`, which omits the fabricated-echo detector. `src/drift.rs` is in `SCANNED_SINGLE_FILES` with a planted `pub fn` violation test. |
| 5 | Surface is one modelled value; a board change wakes only affected readers | VERIFIED | `activeSurface` sits beside `topLayer` in `state/keyboard.ts`, consumed by a flat `switch` in `App.tsx:305`; `SURFACE_LAYERS` is gone. Adoption gate: exactly three files may call `subscribeBoardChanged(` (definition, `useBoardChangedInvalidation`, `fleet/useFleet`), I confirmed no fourth by grep. Hook compares `payload.projectId` by exact equality; `account` scope for `CAP_KEY`; unroutable payload fails open, deliberately. vitest board-changed-adoption, board-changed-routing, surface-union: 35 pass. |
| 6 | Per-kind cap wording, legitimate decomposition not throttled, D-109 amendment recorded, live planning run recorded | VERIFIED (override on live run) | proposal_limit_per_kind 15, run_kind 17 pass. A-05 (D-109), A-06 (gate widening) and A-07 (no `agent_runs.kind`) recorded; ROADMAP F6 line now says `RunKind::classify` plus SQL mirrors. Live-run override: Phase 15 SC1 requires "observed working against a live backend and recorded as an artifact", so the destination is real. `13-LIVE-PLANNING-RUN.md` is still a placeholder, by design. |

## Gap group closure

| Group | Closed? | How I checked |
|-------|---------|---------------|
| 1 Unfinished bounding (13-12, 13-17) | Closed, with BL-1 | Read `drift.rs`, `epic_context_packet.rs`, the caller, the gate; ran drift and epic_context_packet. |
| 2 Gates narrower than docs (13-13, 13-14) | Substantially closed; two evasion shapes remain (BL-2, BL-3, BL-4) | Read all three matchers; traced the continuation form by hand (Python re-implementation of the status matcher returns not-flagged); re-scanned the three source trees with continuations collapsed and found no actual violation. |
| 3 FNC-07 at one site (13-15) | Closed | Grep and adoption gate; the hook is referenced on 37 production lines, three raw callers remain, all allow-listed with reasons. |
| 4 Two owner clauses (overrides) | Criterion 6 scoped correctly. Criterion 1's destination now carried by Phase 14 SC2 (override prose says SC1: BL-6 residual, owner-accepted) | ROADMAP Phase 14 SC1 and Phase 15 SC1 read directly. |

The deferred-items regression the first report found (dispatch cap going stale on a cross-project event) is closed: `useDispatchCap` uses `{ kind: "account" }`.

## Weighing the review's warnings

- **WR-03 (cap truncation, criterion 4).** Confirmed in code. The failure mode 13-12 set out to remove was narrowed from "any read error" to "cap overflow", not removed, and the new test asserts only that the extra id is "never considered". I do not count it against criterion 4: the criterion is about unbounded reads, and this read is bounded. Severity is low because the packet never shows the agent summaries older than the 25-summary window, so an agent must echo more than 25 distinct real out-of-window ids. Recorded as BL-1.
- **WR-05 (CLAUDE.md:53).** Half right. `git >= 2.44` contradicts `MIN_SUPPORTED_GIT = 2.54` and 13-18's own prohibition is not met on that cell (BL-5). "Deadline-watched" is not wrong: `proc.rs` still calls its timeout Instant `deadline` and the PM gate names that exclusion. The roadmap's CLAUDE.md reconciliation named four entries (Monaco, xyflow, git2, Agent SDK); all four are true in the tree.
- **WR-01 line continuation.** Confirmed by trace and by re-implementing the matcher. It is a real hole in the exact evasion class 13-13 and 13-14 said they closed, and their planted tests only use a newline inside the literal. It does not fail criteria 2 or 3 today because the tree has no such write (BL-2).
- **WR-04.** Confirmed: 13-14's second truth is false for the same-word case (BL-4).

## Requirements coverage

All 11 IDs appear in a PLAN's `requirements:` and in REQUIREMENTS.md, which maps exactly these 11 to Phase 13. No orphans.

| Requirement | Status | Evidence / caveat |
|-------------|--------|-------------------|
| FNC-01 | SATISFIED | spine_pin; cycle clause under override |
| FNC-02 | SATISFIED | classification closed-world; Gate 1 both sides derived (BL-3 residue) |
| FNC-03 | SATISFIED for existing transitions | 10 writers two-sided; "accepting an ADR" has no writer yet, now carried by Phase 16 SC4 (UAT 1) |
| FNC-04 | SATISFIED | component-prefix gate (A-06); BL-4 hardening |
| FNC-05 | SATISFIED | all reads bounded; 40-ADR / 30 KB fixture carried by Phase 16 SC5 (UAT 1); BL-1 |
| FNC-06 | SATISFIED | `activeSurface` beside `topLayer`; orphan removed |
| FNC-07 | SATISFIED | three-caller adoption gate |
| DRFT-04 | SATISFIED (tasks) | single `UPDATE tasks SET status` writer in `task.rs`; unmet-criteria event in the deriver; epic status is an owner-filed decision |
| DRFT-05 | SATISFIED | migration 0023, estimate_absent |
| DRFT-06 | SATISFIED | priority_is_opt_in; MCP schema carries no `priority`, so the end-to-end path is core-tested only |
| DRFT-09 | SATISFIED | per-kind cap; A-07 records the no-column decision |

## Anti-patterns

No unreferenced `TBD/FIXME/XXX` found in the files I read. The six backlog findings above are the only items; none is a blocker against a roadmap criterion.

## Behavioral spot-checks (I ran these)

| Command | Result |
|---------|--------|
| `cargo test -p core --test` drift, pm_vocabulary_gate, context_packet_bound, no_agent_status_write, proposal_no_promotion, table_classification, spine_pin, authority_human_only | 8 targets, 108 passed, 0 failed |
| `cargo test -p core --test` status_derivation, status_transitions, migration_schema_too_far_ahead, epic_context_packet, compaction, estimate_absent, migration_safety, priority_is_opt_in, proposal_limit_per_kind, run_kind | 10 targets, 147 passed, 0 failed |
| `npx vitest run` board-changed-adoption, board-changed-routing, surface-union | 3 files, 35 passed |
| Python re-implementation of `scan_body_for_raw_status_writes` on a backslash-continued `UPDATE tasks SET \ status = ?1` | not flagged (confirms BL-2) |
| Independent scan of core, desktop-tauri, sidecar for writes to the five canonical tables, continuations collapsed | all inside owner files or the five exact allow-list entries |

I did not re-run the full renderer suite or the intermittent `request-changes.test.tsx` (pre-existing from phase 08.1); I rely on the supplied figures for those.

## Human verification

Completed. All four items were answered by the owner in `13-UAT.md` (4 passed, 0 issues); see `human_verification_resolved` in the frontmatter. Open items that remain are product decisions deferred out of Phase 13, not Phase 13 gaps: epic status after the StatusPicker deletion (Phase 14, no shape chosen), and the BL-6 off-by-one pointer in the criterion-1 override prose (owner declined the one-word correction).
---

_Verified: 2026-10-15_
_Verifier: Claude (gsd-verifier)_
