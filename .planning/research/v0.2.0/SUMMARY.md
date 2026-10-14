# Project Research Summary: v0.2.0 "The Board Thinks With You"

**Researched:** 2026-10-14. **Confidence:** MEDIUM-HIGH overall. Facts about the code are HIGH. Design choices are MEDIUM. Live model behaviour is LOW, because nothing was run against a real model.

**Provenance:** synthesised by `gsd-research-synthesizer` from `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md` and `PITFALLS.md` in this directory. The synthesiser was blocked from writing files by a harness rule and returned its synthesis as text; the orchestrator wrote this file verbatim from that return. Nothing was summarised in transit. Two HTML entities (`&lt;textarea&gt;`) were decoded.

## Executive Summary

v0.2.0 adds three record types beside the fixed epic→task→issue spine: PRD, ADR and phase. It removes forms an agent could have drafted. It adds agent pre-review of a diff against acceptance criteria. It applies a dark-first, state-carrying colour direction. It also carries PLAN-01, AGNT-05 and DIST-01.

The researchers agree on four things:
- Almost no new dependencies are needed.
- `authoring_proposals` is already the single proposal channel (D-97).
- The spine tables are unchanged since migration 0002 and should stay that way.
- Every authority transition (sign-off, accept, check) is a human act on an immutable revision.

The main risk is repeating two failures already on record.
- **Phase 8.1:** 21 plans of polish came out "lifeless". The brief forbade fills, the closing criteria were mechanical, the one perceptual criterion (SC0) was deferred, and the comps were judged on FIXTURE rows with a lead epic named `test` (PITFALLS Pitfall 3).
- **The criteria composer:** 15 criteria across 907 tasks. Optional authoring with no consumer goes unused (Pitfall 5).

The opposite failure is also likely. A draft engine that turns 6 hand-written tasks into about 40 items to adjudicate adds work instead of removing it (Pitfall 1). The mitigations are structural tests: per-task acceptance, a draft cap, a field audit, and gates for "agents never check boxes" and "drafts are never consumed".

## Conflicts and rulings

### 1. Visual-last vs. what the developer asked for first (build-order revision)

**Case for visual-last.**
- Colour that carries state needs states to carry. PRD signed-off, ADR proposed, phase active, review verdict and `merged` don't exist until the records layer does.
- Colour applied before those exist lands on the old surfaces. That is what Phase 8.1 did.
- Fencing tests come before new tables, because new tables are invisible to the Phase 6 gate (Pitfall 4).
- The live proofs come before the draft engine, because drafting multiplies model calls against unproven limit behaviour (Pitfall 10).

**What it costs.** Following PITFALLS' order literally (fence, live proofs, records, drafts, review, visual), the first visibly different pixel appears after four phases of mostly invisible work. The developer's opening request was colour and life.

**Ruling: the sources bundled two different kinds of work.**
- *Polish* is hierarchy tuning, final values, the dark-first switch and per-surface refinement. It belongs last (ARCHITECTURE W7b).
- *The state-colour layer* is structure:
  - `legend/stateClasses.ts`
  - four tokens per class (`-ink`, `-fill`, `-wash`, `-on-fill`)
  - the single `StateMark` component
  - a source gate on `--state-*`
  - the colour-vision (CVD) distinguishability test
  - forced-colors fallbacks
  - the direction document that supersedes D-11

  ARCHITECTURE (T7, W7a) says this must land before the new surfaces so they are born on state tokens. It is also where saturated colour first appears.

**Placement for the roadmapper.** The first visible win is the phase/roadmap region (ARCHITECTURE W2).
- It has zero agent dependency.
- It is the first consumer of state colour.
- It delivers "progress and roadmap always on screen".
- It comes one phase after foundations, not five.

**Conditions that keep it from being 8.1 again:**
1. It is built on a seeded demo board with every state live: running, blocked, failed, awaiting review, proposals pending, an epic mid-flight, 900+ items. The lead row is not junk.
2. A hierarchy statement ("this region is the focal point; these are the three levels") is an acceptance criterion.
3. An owner verdict on the BUILT surface, with a screenshot, is a roadmap success criterion. Adopting a comp cannot satisfy it (Pitfalls 3 and 14).
4. A signal-budget check exists as a heuristic: calm when healthy, loud when something needs the human. It does not replace the owner's verdict.

Confidence: MEDIUM-HIGH. The diagnosis of 8.1 comes from artifacts (HIGH). The W7a/W7b split is a judgement. The "earliest visible win" is my derivation from ARCHITECTURE's dependency graph.

**OPEN (product):** whether the developer accepts one foundation phase before seeing colour. The demo board and state tokens could be pulled into Phase 13 at the cost of a larger first phase.

### 2. PRD acceptance bar

**Option A: reuse `acceptance_criteria`.** ARCHITECTURE's migration `0026` widens `parent_type CHECK IN ('task','epic')` to include `'prd'`.
- *Gains:* per-item checking, the revision chain, anchors, derived coverage, and the existing one-writer gate.
- *Risk:* `DROP TABLE` fires an implicit DELETE, and `criterion_anchors` has `ON DELETE CASCADE` to criteria (0018). A naive rebuild can delete every anchor.
- *Mitigation:* the migration runner turns foreign keys off and runs `foreign_key_check` plus `integrity_check`, with a backup restore on failure (`db/mod.rs:81-90,131,158-182`). STACK's cascade claim is recalled, not re-fetched (MEDIUM), so a test must prove anchors survive. Model it on `migration_0015_rebuild_preserves_self_referential_parent_link` (`migration_safety.rs:305`).
- *Other risks:* column order must be preserved, because criteria are built from positional reads in "about eight places". Two indexes must be recreated. PITFALLS adds that it makes criteria polymorphic and breaks `CRITERIA_SQL`'s `parent_type = 'task'` assumption in agent-facing reads.

**Option B: flat Markdown checklist section.**
- No migration.
- It loses per-criterion checking and derived coverage, and invites "prose swells, bar does not".

**Recommendation: A, conditional on the anchor-preservation test passing in that phase's first plan.** Fall back to B if it fails. Also audit every agent-facing criteria read, and test that a PRD-parented criterion never appears in a task packet. A parallel `prd_bar_items` table would duplicate about 1,100 lines, which is worse. Confidence: MEDIUM. **OPEN (product):** the owner may decide the bar is prose.

### 3. One proposal mechanism or several

**Already unified** (ARCHITECTURE 5.1, verified in code):
- One table, `authoring_proposals` (D-97).
- One adjudication core: `accept_proposal_in_tx` and `materialise_proposal` (`authoring_proposal.rs:971,806`).
- One UI row, `ProposalRow`, used by all three hosts. Only `groupProposals` is triplicated byte-for-byte.
- Two thin entry doors into `create_proposal_in_tx`.

**Genuinely new or divergent:**
- Six `propose_/amend_/delete_` tools for authoring vs one `propose_item` for execution (D-98).
- The closed set of shapes `materialise_proposal` can produce.
- The 10-per-run cap applied to authoring by accident (F1).

**Check against STACK and FEATURES.**
- STACK would route PRD/ADR sections through `authoring_proposals`, with another `target_type` rebuild.
- FEATURES assumes the staging `CHECK` is rebuilt for PRD, ADR, phase and file-set kinds.
- ARCHITECTURE is better grounded and rules those out:
  - `validate_payload` caps title at 500 and text at 1000 characters (`authoring_proposal.rs:1394-1402`), and a PRD is pages.
  - Rows are terminal on decision and kept forever (D-83), so they are wrong for co-editing.
  - A rebuild must recreate `authoring_proposals_fts` and its three triggers (0016 header).

**Position:**
- Extend the one mechanism for spine drafts using payload variants under the existing `target_type` values. The `kind` discriminator is JSON, so there is no rebuild.
- Documents, file-sets and review findings keep their own stores.
- Unify them with four properties enforced by a registry gate: actor-attributed and evented in the same transaction; authority reachable only from a human command; volume bounded in the same transaction; nothing authoritative reads non-authoritative state.
- Do not add a `trait Adjudicable`. Revisit if a seventh agent-writable store appears or `materialise_proposal` passes about 12 arms.

Confidence: HIGH that one store exists. MEDIUM on not unifying further.

### 4. The fourth encoding category (status / priority / estimate)

The developer explicitly selected these for agent drafting. The evidence points the other way, so treat this as a recommendation to the developer, not a settled fact.

- **Status:**
  - LINK-07 already derives it from git and forge state.
  - A drafted status is a second writer on a derived value.
  - `agent_run.rs:233` already writes `tasks.status` past the gate (F5).
- **Estimate:**
  - STACK found no reader of `estimate`.
  - FEATURES lists its consumer as unresolved.
  - PITFALLS calls a 3-valued estimate "fabricated precision".
- **Priority (0..4):** an agent has no ground truth for it.
- **FEATURES is more permissive than PITFALLS.** It would allow hover-reasoned priority and estimate suggestions on triage entry, with auto-apply off.

**Recommendation (MEDIUM):**
1. Derive status. Only backlog→todo "ready" is non-derivable, and it can ride the task's own accept.
2. Name a consumer for `estimate` or drop it from required flows.
3. Offer priority only as an opt-in suggestion at triage entry or on explicit request.
4. If the developer insists on all three, ARCHITECTURE's `TaskFields` payload plus `_in_tx` setters carries it cheaply. Restrict agent status to `backlog | todo` in `validate_payload`, not in the prompt.

**Evidence to show the developer:**
- LINK-07 exists.
- Nothing reads `estimate`.
- The 40-vs-6 chore arithmetic.
- The rule that each drafted field must name its downstream reader.

### 5. The visual direction supersedes D-11

D-11 says "No tinted rows. No status fills. No pills with backgrounds." It is enforced by:
- `brand-rule.test.ts`, with its allowlist and the rule against coloured side borders of 2px or more.
- The one-scheme rule with no `[data-theme]` (`legibility.browser.test.tsx:253-262`).
- The block-aware dark drift check (`contrast.test.ts:90,101,430`).
- Legend completeness (`legend/marks.ts`).

Saturated accents supersede D-11 and widen D-12. It needs a named decision with a SUPERSEDES table, and the spec, allowlist and tests must be amended together.

`brand-rule.test.ts` is already repaired this session, so ARCHITECTURE's F2 is resolved and no repair task is needed. Two implications remain:
- The test reads its spec by path, so the new direction document must sit where the repaired resolver finds it.
- Several `*.browser.test.tsx` files mention `.planning/phases` and will break on the next archive. Audit them.

**Does `StateMark` plus a source gate resolve the tension?** Partly.
- *Resolves:* the redundancy guarantee. If `StateMark` is the only consumer of `--state-*` and always renders glyph plus word or accessible name, "meaning never rests on colour" holds by construction rather than by about ten comments. Colour becomes the fastest channel, not the only one.
- *Does not resolve:*
  1. Red/green confusability. It needs the simulated protan/deutan/tritan test (T3).
  2. An everything-is-coloured screen, which is compliant and bad. It needs the signal budget and the owner's verdict.
  3. Wash contrast under text. The contrast test must enumerate every text role against every wash, per mode.
  4. Dense rows, where the word may be reduced to an accessible name.
  5. Migration of existing colour consumers (`RUN_STATUS_COLOR_ROLES`, `runStatus.ts:50-58`). `merged` has no colour role today.
  6. The ban on 2px state side rules. Use glyph colour plus wash.

**Ruling:** adopt it. Confidence: HIGH that it's feasible and stronger than comments. MEDIUM that it's sufficient. Treat it as one of four instruments: the gate, the CVD test, wash contrast enumeration, and the owner verdict on the built board.

### Disagreements not on the orchestrator's list

| # | Disagreement | Sources | Recommendation | Confidence |
|---|---|---|---|---|
| 6 | **PRD shape: fixed slots vs section rows vs one body blob** | FEATURES: fixed Shape Up slots. STACK: `document_sections` rows (heading plus `body_md`). ARCHITECTURE: one `prd_revisions.body` per revision. PITFALLS: no free body blob beyond the problem statement. | Closed, CHECK-named slots stored as revisioned rows (STACK's 0009-style revision design) in dedicated tables, adjudicated by a human-only transition on an immutable revision. This keeps per-slot amend/accept and avoids `authoring_proposals`' size bounds. ADRs keep fixed columns because their vocabulary is small and closed. No single source proposed exactly this, so it is a composition. **OPEN:** closed slots vs free headings. Closed is recommended because it blocks the wiki failure and custom fields. | MEDIUM (lowest of the new calls, reconstructed by composition) |
| 7 | **Where a proposed ADR lives** | PITFALLS: in staging only, with `adrs` holding human-materialised states. ARCHITECTURE: `propose_decision` writes `adrs.status = 'proposed'`, with an inbox read-union, human-only triggers and a frozen accepted body (verified in SQLite). | ARCHITECTURE's version, with PITFALLS' conditions attached: the writer is the only path to `proposed`, authority functions are unreachable from agent code (registry Gate B), and the no-promotion corpus is re-run with `adr` as a target. Confirm in records-phase research. | MEDIUM |
| 8 | **Can an agent verdict block a merge?** | FEATURES: it may hold, never release. ARCHITECTURE: advisory only, because blocking makes the agent an authority. | Advisory-only for v0.2.0. Hard invariant, source-gated: a verdict can never enable `dispatch_auto_merge`. Tightening later is possible, loosening is not. **OPEN (product).** | MEDIUM-HIGH |
| 9 | **`epics.phase_id` vs `phase_epics` link table** | STACK, FEATURES and PITFALLS: nullable `epics.phase_id`. ARCHITECTURE: link table. | Link table. ARCHITECTURE observed that the spine DDL is unchanged across 21 migrations, that `domain/epic.rs` is a canonical writer, and that composite FKs through a unique index on `epics(project_id,id)` close the same-project gap (executed on SQLite 3.51). Add a frozen-schema test. Rewrite PITFALLS' depth test for the link table. Re-run the probes in the repo harness, because the bundled engine is `libsqlite3-sys 0.38.2`. | HIGH on the recommendation. MEDIUM that the link table costs nothing at 1,000+ items, which is unmeasured |
| 10 | **Authoring cap vs open-drafts cap** | ARCHITECTURE raises authoring from 10 to a placeholder 100 via `const fn proposal_limit(kind)`. PITFALLS wants a fixed per-project cap on open drafts, with back-pressure. | Both are needed, since they are different quantities: a per-run production cap that doesn't throttle decomposition, and a per-project attention cap. Constants, not settings. Raising the first amends D-109 and must be recorded as an owner decision. **OPEN:** values. | MEDIUM |

## Key findings by source

**Stack** (HIGH inventory, MEDIUM sizes and CSP)
- Add `react-markdown` 10.1.0 and `remark-gfm` 4.0.1 (about 50 kB gzip together), and `diff` 9.0.0 (about 3 kB). They go in a lazy document chunk and feed the existing `react-diff-view`.
- Add no editor. The `<textarea>` pattern stays. CodeMirror 6 with `@codemirror/merge` is the pre-chosen escalation, on three triggers: sections longer than a screen, partial acceptance wanted without amending, or live inline suggestion.
- Add no colour library. Compute hex values once, offline.
- Render rules: no images, inert links, no `dangerouslySetInnerHTML`.
- Set a CSP in the phase that first renders agent-authored text. `tauri.conf.json` has `"csp": null`. The directive list is unverified (LOW-MEDIUM).
- No Rust crates are added.

**Features**
- *Must have:*
  - Staging extended for spine drafts.
  - File-set chips and picker, after the PLAN-01 live proof.
  - Criteria drafted by default, with criteria-less runs refused.
  - PRD record: closed slots, human sign-off on a named revision, optional per epic.
  - ADR record with an immutable accepted body and atomic supersession.
  - Phase record with a roadmap strip, carryover prompt and scope-change chip.
  - Anchored agent verdicts, distinct from the human check.
  - State-colour vocabulary.
  - The carried items.
- *Should have:*
  - Socratic PRD/ADR drafting.
  - Packet injection and CTX-06 contradiction flags.
  - Re-entry digest and a single explained next action.
- *Defer:*
  - Velocity, burndown, dates, portfolio views, templates, multi-approver sign-off, confidence scores, gamification.
  - Quick capture, phase exit criteria and ADR path-glob scoping go to v0.2.x.
- FEATURES defers the fresh-context reviewer. ARCHITECTURE's separate `review` run kind is fresh by construction, so treat it as in scope.

**Architecture**
- Separate tables per record, with `phase_epics`, `prd_epics` and `adr_epics` link tables.
- Authority triggers plus an `AUTHORITY_REGISTRY` gate with parts A, B and C.
- `agent_runs.kind`, added with `ADD COLUMN ... CHECK`, so there is no fourth rebuild.
- A sidecar `RunKindProfile` table.
- Write tools keep the `propose_/amend_/delete_` prefix, so the stage-gate matcher (`claude-code-adapter.ts:174`) covers them.
- The review run's subject is `review_task_id`, not `task_id`. Otherwise it pollutes `SUMMARIES_SQL` (`context_packet.rs:219-221`) and displaces the execution run in the fleet query (`query/fleet.rs:126`).
- The agent reads the diff through the same Rust functions as the UI (`review.rs:258,269`).
- Only a human call to `check_criterion_with_anchor` writes `checked`.
- A single `surface` union (closes WR-02).

**Pitfalls (ranked)**
1. Draft-and-accept becomes a chore.
2. Pre-review becomes a confidence machine.
3. The redesign still doesn't change the feeling.
4. The spine erodes.
5. The PRD becomes a wiki.
6. The context packet grows without bound.

Below those: the PM long tail, ADR neglect or flooding, a deleted fallback, the Socratic session turning into a chat blob, stale drafts, unfalsifiable criteria, closing on proxies, and the naming collision with GSD "phase".

Key preventions:
- No bulk-accept identifier anywhere (extend the `TriageSurface.tsx` source test).
- Success is measured on post-accept revision rate.
- No backfill sweep of the 907-task board.
- No aggregate "all met" badge.
- A three-valued verdict with `cannot_determine` first-class.
- A planted-defect harness that shows the false-"met" rate.
- A closed-world table classification test.
- A spine DDL pin.
- A forbidden-identifier gate: velocity, burndown, capacity, sprint, deadline, overdue, rollover.

## Pre-existing defects no requirement covers

All HIGH from reading the code. F1 was read, not executed, so confirm it with an 11-proposal authoring fixture first.

| ID | Defect | Evidence | Action |
|---|---|---|---|
| F1 | The 10-proposal cap hits authoring runs. The refusal tells the agent to "call report_summary", which is wrong for an authoring session. | `authoring_proposal.rs:319,406`; `commands/authoring.rs:1405-1411` | `const fn proposal_limit(kind)`, per-kind wording, and record the D-109 amendment |
| F3 | Criteria can't be drafted for an existing hand-made task. `materialise_proposal` requires a parent proposal. | `authoring_proposal.rs:836-839` | Allow `target_id` to carry the parent task/epic/PRD id on a criterion `create` |
| F4 | `set_priority` and `set_estimate` have no `_in_tx` form. | `task.rs:808,869`; `epic.rs:564,622`. `set_task_status_in_tx` exists at `task.rs:446`. | Add them, if Conflict 4 isn't adopted wholesale |
| F5 | `start_agent_run` writes `tasks.status` directly, past the Phase 6 gate. | `agent_run.rs:233`; `proposal_no_promotion.rs:81-87`; `acceptance_criterion.rs:778,782` | Allow-list or refactor these three sites before widening the gate |
| F6 | Run kind is inferred from column shape in four places. | `dispatch_plan.rs:1192`; `commands/dispatch.rs:703`; `query/authoring.rs:574`; `commands/authoring.rs:190` | Add `agent_runs.kind` and migrate the sites |
| F7 | An older build can't open a newer DB, so "reversible" means backup and restore. No test covers `DatabaseTooFarAhead`. | `db/mod.rs:81-90`; `rusqlite_migration-2.6.0/src/lib.rs:720` | Word reversibility requirements accordingly |
| F8 | The `board:changed` payload is discarded, so every subscriber invalidates on every event. | `adapters/tauri.ts:27-31`; `queryClient.ts` `staleTime: 0`; `epic_progress.rs:1-9` | Payload routing plus about 150 ms coalescing. The rate is unmeasured (MEDIUM). |
| F9 | Surfaces are chosen by a nested ternary outside the keyboard layer model. | `App.tsx` ~330-426; `uiStore.ts:227-247`; `state/keyboard.ts:502-511` | One surface union before the PRD/ADR surfaces |
| F10 | Draft file-sets are live at draft time, agent-attributed, before approval. The effect is restrictive only. | `dispatch_plan.rs:1131`; `sidecar.rs:984-1001` | Show "drafted by the planner", derived from the event actor |
| F11 | The capabilities roster string and 148 `commands::` entries are hand-maintained. | `capabilities/default.json`; `main.rs` | Treat the string as documentation. `generate_handler!` is the enforcement point. |

F2 (`brand-rule.test.ts`) is resolved, as noted above. There is also minor doc drift: PROJECT.md says the Phase 6 gate scans `packages/desktop/src`, but the code scans `sidecar/src`.

## Scale ceilings

- **The context packet is unbounded in two places today.**
  - `SUMMARIES_SQL` (`context_packet.rs:219`) has `ORDER BY created_at ASC` and no LIMIT.
  - Compaction folds past `VERBATIM_WINDOW = 5` but is "lossless for decisions and file paths", so the residue never shrinks.
  - `PRIOR_AUTHORING_RUNS_SQL` is a third tracked unbounded read.
  - PRD and ADR text adds more. This threatens "`/clear` is free".
- **D-69 rejected size ceilings.** Compaction has no character, token or size limit, because a ceiling moves the boundary for reasons the developer can't see. Any bound must therefore use:
  - fixed counts;
  - link-based inclusion (ADR in only if accepted, not superseded, and linked to the epic; PRD in as the problem statement plus only the bar items for this epic);
  - a visible boundary sentence in the CTX-05 style ("3 of 7 ADRs included: accepted, constrain this epic").
- "Truncate at N tokens" is rejected.
- The packet records PRD/ADR revision ids, so a later edit is a surfaced contradiction, not a silent change.
- Drafts and superseded records never enter the packet.
- Record content goes in a labelled data section, never in the instruction text.
- **A tension for requirements to resolve.** Bounding the existing terms conflicts with "lossless for decisions". Dropping acknowledged or superseded decisions from the folded residue is a deliberate decision and a research item.
- Do not allowlist `SUMMARIES_SQL` in the `unbounded_reads` gate. Fix it, and extend the gate to cover `context_packet.rs` and new PRD/ADR query modules.
- Add a scale test: 200 summaries, 40 ADRs and a 30 KB PRD stay under bound B, and adding a superseded ADR never grows the packet.
- A completed review run must leave `assemble_context_packet(task)` byte-identical.
- The roadmap fold must use `board_epic_progress` over all tasks, never the 200-row paged window.

## CLAUDE.md drift

STACK verified that four items in the project's stack table are not in the tree.

| Named in CLAUDE.md | Reality |
|---|---|
| `@monaco-editor/react` | Not installed. The v0.1.0 install line was never run. |
| `@xyflow/react` | Not installed. |
| `git2` | In no `Cargo.toml`. `review.rs` shells out to system `git`. |
| `@anthropic-ai/claude-agent-sdk` | Not a dependency. `claude-code-adapter.ts` spawns the user's `claude` binary. The sidecar's only runtime dependency is `@modelcontextprotocol/sdk` 1.30.0. |

Consequences:
- Don't plan on "reuse Monaco" or on `git2` for free diffs.
- Don't add the SDK. Its registry licence field is `SEE LICENSE IN README.md`, and its terms were not read.
- ARCHITECTURE 6.2 assumes `git2` for the file picker's path autocomplete. Use `git ls-files` unless the owner decides to add `git2`.
- Reconcile CLAUDE.md in the first phase's docs plan, because it is read as authoritative every session.

## Proposed phases 13-18 (a proposal the roadmapper may revise)

Numbering continues from v0.1.0's last phase, 12. This merges ARCHITECTURE Section 11 with PITFALLS' vocabulary. Confidence: MEDIUM.

**Phase 13: Fence, repairs and foundations. PLAN-01's live measurement starts here, on day one, in parallel.**
- Delivers:
  - Surface union (F9) and payload-aware `board:changed` (F8).
  - Frozen-spine test, closed-world table classification, and the authority registry gate.
  - Migrations 0023 to 0025 (phases; documents; run kinds plus `review_findings`).
  - `agent_runs.kind` and the four site migrations (F6).
  - `proposal_limit(kind)` (F1).
  - The sidecar run-profile table.
  - The packet bound plus scale test.
  - The forbidden-identifier gate.
  - `uat-14-plan-live.mjs --live`: planning prompt gains a `git ls-files` listing, `Read`/`Grep`/`Glob` allow-listed, `Bash` unlisted.
  - The CLAUDE.md reconciliation.
- Settle DIST-01 here: give it a named phase or an explicit deferral. The owner declined the purchase on 2026-10-13.
- Research flag: the packet-bound policy on decisions only.

**Phase 14: Phases, roadmap and the state vocabulary (the first visible win).**
- Delivers:
  - `phase.rs` and the progress fold.
  - `RoadmapRegion`, the carryover prompt and the scope-change chip.
  - The direction document superseding D-11.
  - `stateClasses`, the four tokens, `StateMark` and its gate.
  - The CVD test and forced-colors fallbacks.
  - The seeded demo board and an owner verdict on the built surface.
- Research flag: none. Standard patterns.

**Phase 15: Agent drafts everywhere and PLAN-01 closure.**
- Delivers:
  - F3 (and F4, if Conflict 4 is declined).
  - Per-task acceptance, the open-drafts cap, lint, stale-draft refusal.
  - Criteria drafted by default.
  - `FileSetEditor`.
  - Removal of the dead `dispatch_plan_create` door.
  - Extraction of the three `groupProposals` copies.
  - Instrumentation from the event log.
- The textarea stays until the live artifact exists.
- Research flag: yes, for live planner behaviour and the field audit.

**Phase 16: PRD and ADR.**
- Delivers:
  - The anchor-preservation test first, then the `0026` rebuild.
  - Revision model and authority triggers.
  - The Socratic PRD session.
  - `propose_decision`: at least 2 options, a small per-run cap, FTS duplicate flag.
  - Inbox union and bounded, revision-pinned packet sections.
  - The renderer plus CSP.
  - `PrdSurface` and `AdrSurface`.
- Research flag: yes, including the live harness and an owner quality verdict.

**Phase 17: Agent review (can run beside 16).**
- Delivers:
  - The no-self-grading gate and three-valued schema, first.
  - `submit_review`, the `review_read` kind, the `CriteriaRail` overlay and the fleet label.
  - A calibration harness and the manual "Pre-review" trigger.
- Research flag: yes, and it needs a live measurement.

**Phase 18: Visual application and carried items.**
- Delivers:
  - Polish and values.
  - The dark-first switch.
  - Re-entry digest and next action, if not already placed.
  - The signal-budget test.
  - A final owner verdict per surface on the demo board.
- Research flag: yes, design only.

**Ordering note.** PITFALLS puts the live proofs before records. ARCHITECTURE runs PLAN-01 in parallel from day one. The synthesis follows ARCHITECTURE, because only the textarea deletion needs the proof.

## The 12 open product decisions

Resolve each in requirements, or defer it deliberately.

1. **Force dark or follow the OS?** Option A makes `:root` dark with a light `@media` block. Option B uses `[data-theme]`. A is small and keeps test shapes. B is honest for "forced". Either way `DARK_BLOCK_START` and the drift parser change in lockstep. Recommendation: A unless forcing is wanted.
2. **Time-boxed or scope-boxed phase, and may one phase hold epics from more than one PRD?** All four sources lean scope-boxed and undated. Record "time-boxed deferred (CONV-04)". Allow many PRDs per phase.
3. **Does a `rejected` ADR status exist?** Recommend yes. It's negative knowledge and prevents re-proposal.
4. **Per-run ADR proposal cap and the authoring cap.** Placeholders are 3 and 100. PITFALLS suggests 1 or 2 for ADRs. Both amend D-109. OPEN.
5. **Is auto pre-review on by default?** Recommend off.
6. **PRD bar: real criteria or a checklist?** Recommend real criteria, conditional on the preservation test.
7. **May an agent verdict block a merge?** Recommend advisory-only, and never able to enable auto-merge.
8. **The fourth encoding category (status, priority, estimate).** A recommendation to the developer against an explicit selection.
9. **The user-facing noun for "phase".** It collides with GSD. Decide and record it.
10. **Citable keys for PRD and ADR (`ADR-7`).** A stored sequence needs a per-project counter. A derived ordinal needs archive-only rows. Recommend archive-only plus a derived ordinal.
11. **May an agent propose phase placement?** Defer. An optional `phase_id` hint on epic proposals is the cheap later route.
12. **DIST-01's home.** Name a phase or defer it explicitly. It must not stay unmapped.

Decisions 1, 2, 6, 8, 9 and 12 change phase boundaries or scope, so triage those first.

## Confidence and gaps

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH on inventory; MEDIUM on sizes and CSP | SQLite cascade-on-`DROP TABLE` is recalled, not re-fetched. Settle it with a test. |
| Features | MEDIUM | The loop-supervision UX section is synthesis. Notion and Height come from prior knowledge. |
| Architecture | HIGH on integration points; MEDIUM on design; LOW on live behaviour | Claude Code's default-mode handling of read tools vs `Bash` is unverified. |
| Pitfalls | MEDIUM | Codebase evidence is HIGH. Human-factors transfer is inferred. Several secondary figures should not be quoted (Dell'Acqua, the ICSA 2026 63%, Linear capacity). |

Gaps to carry into planning:
- Live planner behaviour, which a desk study can't settle. Use the `--live` measurement.
- AGNT-05 has never been observed against a real limit. State its status in Phase 15 requirements.
- No measured acceptance behaviour exists. Only the 1-of-42 amended datum is available, and it can't tell good drafting from reflex-accept. Instrument first.
- Whether Claude judging its own diff shows self-preference is unmeasured.
- What reads `estimate`.
- The policy for folding decisions in the packet.
- The re-entry digest and "one explained next action" are in no suggested phase's core scope. Assign or defer them.

## Where the synthesis is least certain

This file is a second-pass reconstruction: the synthesiser's first draft was lost to a tool block before it could be written, and it rebuilt the content from the four source files it had already read in full. The reasoning is the same; three items are flagged as lower confidence than the first pass.

- **The PRD shape recommendation (disagreement 6).** It is a composition of three sources, not something any of them proposed. Treat it as a proposal to challenge.
- **The ADR-location ruling (7).** Confident in the conditions, less so in preferring ARCHITECTURE over PITFALLS.
- **The phase-by-phase contents above.** A reconstruction. Items may have drifted slightly between phases compared with the first draft, such as where the re-entry digest sits.

Citations (file:line, D-numbers, F-numbers) are taken from the source files. Before quoting any of them in a requirement, check them against the originals in this directory.

---
*Synthesised: 2026-10-14 from STACK.md, FEATURES.md, ARCHITECTURE.md and PITFALLS.md*
