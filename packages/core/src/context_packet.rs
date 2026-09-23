//! `assemble_context_packet` / `render_prompt` (D-28): the genuine stub of Phase 4's
//! `ContextAssembler` — same signature, same "same board state always produces the same packet"
//! contract (ARCHITECTURE.md section 3). A pure query over the board: no model call, no network
//! call, no mutation of any kind. Every SQL statement below is a literal `&str`, bound through
//! `params![]` — never assembled by `format!`/string interpolation, matching `query/events.rs`'s
//! own discipline (T-01-01/T-01-23).
//!
//! Deliberately does NOT call `domain::worktree::base_ref_for_task` for the "no worktree yet"
//! case, despite that being the obvious-looking reuse target: that function calls
//! `domain::epic::ensure_epic_integration_branch`, which — for a task whose epic has no
//! integration branch cut yet — CUTS A REAL GIT BRANCH and writes `epics.integration_branch` as
//! a side effect. A preview must never do that (T-02-21, plan 02-04's "nothing happens until
//! Start Work fires" invariant, and this module's own "no model call and no network call of any
//! kind" contract extended to "no git call and no write of any kind"). [`predict_base_ref`]
//! below re-derives the identical hypothetical value read-only: the epic's already-cut
//! `integration_branch` if one exists, or exactly the name `ensure_epic_integration_branch` would
//! cut later (`branch::epic_integration_branch_name`) — never cutting it here.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::branch::{epic_integration_branch_name, task_branch_name};
use crate::compaction::{CompactedSummary, CompactionBoundary};
use crate::domain::session_summary::DecisionEntry;
use crate::domain::worktree::worktree_root;

/// The fully-qualified `report_summary` MCP tool name, exactly as `packages/sidecar/src/
/// mcp-permission-server.ts`'s `SUMMARY_TOOL_NAME` composes it (`mcp__${MCP_SERVER_NAME}__
/// ${REPORT_SUMMARY_TOOL_NAME}`) — declared once on THIS side of the pair; the sidecar declares
/// the other half. Both sides must agree exactly (T-04-17): a `<verify>` gate greps this file for
/// exactly one occurrence of the literal string.
pub const REPORT_SUMMARY_TOOL_NAME: &str = "mcp__flywheel-permissions__report_summary";

/// One acceptance criterion entry, in rank order — statement plus its verification hint (D-05).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CriterionEntry {
    pub statement: String,
    pub verification_hint: Option<String>,
}

/// The epic section, present only when the task has an epic (D-13) — an absent epic is `None` on
/// [`ContextPacket`], never an empty-string title (this file's own load-bearing contract, echoed
/// in `render_prompt`'s "omit the heading" rule below).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EpicSection {
    pub title: String,
    pub description: Option<String>,
}

/// One prior-session summary entry (D-65, CTX-01) — the packet's read-only projection of a
/// `session_summaries` row, in the same field shape [`crate::domain::session_summary::SummaryFields`]
/// was written with. Ordered oldest-first by [`assemble_context_packet`]'s own query, matching
/// `session_summaries`' own `created_at ASC, id ASC` read order (CTX-04's stable tie-break).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SummaryEntry {
    pub agent_run_id: String,
    pub changed_files: Vec<String>,
    pub changed_prose: Option<String>,
    pub remains: Option<String>,
    pub next_session_must_know: Option<String>,
    pub decisions: Vec<DecisionEntry>,
    pub auto_generated: bool,
    pub created_at: String,
}

/// The branch/worktree facts the run will actually use (WORK-01/WORK-02) — the resolved row's
/// values when a worktree already exists, or exactly what `domain::worktree::ensure_worktree`
/// would create otherwise (predicted, never created).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WorktreeFacts {
    pub branch: String,
    pub base_ref: String,
    pub path: String,
}

/// Both halves of the diff-so-far briefing (D-70, D-71, CTX-03) — the committed range from
/// `base_ref` to `HEAD`, and the working tree's own uncommitted state, kept as two labelled
/// sections rather than merged into one blob. `committed_stat`/`committed_paths` are
/// [`crate::git::DiffStat`]'s two fields verbatim; `working_tree_porcelain` is
/// `crate::git::git_status_porcelain`'s raw output verbatim. Carries no hunk body of any kind —
/// D-71's stat-plus-names shape is what keeps the packet's size bounded by the number of changed
/// files, never by how large any one change is.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiffSoFar {
    pub base_ref: String,
    pub committed_stat: String,
    pub committed_paths: Vec<String>,
    pub working_tree_porcelain: String,
}

/// Optional packet extras composed one layer above [`assemble_context_packet`] — a struct rather
/// than a bare argument so a later plan (e.g. 04-10's drift field) can grow this without changing
/// [`assemble_context_packet_with_extras`]'s signature. `diff` is `None` when the caller has
/// nothing to attach (no worktree on disk yet, or a git error the caller chose to degrade rather
/// than propagate).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PacketExtras {
    pub diff: Option<DiffSoFar>,
}

/// The full context packet (D-28). Every field is data — no pre-rendered sentence is stored here;
/// [`render_prompt`] is the only place prose is produced, matching this crate's "derive at read
/// time, never store" rule (`query/events.rs`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ContextPacket {
    pub task_key: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub epic: Option<EpicSection>,
    pub criteria: Vec<CriterionEntry>,
    pub summaries: Vec<SummaryEntry>,
    /// Where `render_prompt`'s Prior Sessions section splits older sessions from recent ones
    /// (CTX-05) — computed once, here, by folding this packet's own `summaries` list through
    /// `crate::compaction`'s pure fold. A no-query, no-I/O derivation over data this function
    /// already read. Kept alongside the full `summaries` list rather than replacing it: this is a
    /// presentation of that list, not a substitute for it — the accumulated `decisions` list below
    /// and a later plan's drift detectors both need every summary regardless of where the fold
    /// falls.
    pub compaction: CompactionBoundary,
    /// Every decision entry from `summaries`, deduplicated by id (first occurrence wins, order
    /// preserved) — a pure fold over data this function already read, issuing no additional
    /// query (D-73). Complete regardless of how many summaries have folded under compaction,
    /// because compaction is lossless for decisions — which is why the closing read-back can be
    /// checked against this list at all.
    pub decisions: Vec<DecisionEntry>,
    /// Always `None` from [`assemble_context_packet`] itself (D-70/CTX-03) — this function makes
    /// no git call and its purity contract is unchanged by this field's existence. Populated only
    /// by [`assemble_context_packet_with_extras`], one layer above.
    pub diff: Option<DiffSoFar>,
    pub worktree: WorktreeFacts,
}

const TASK_ROW_SQL: &str =
    "SELECT project_id, epic_id, key, title, description FROM tasks WHERE id = ?1";

const EPIC_ROW_SQL: &str =
    "SELECT key, title, description, integration_branch FROM epics WHERE id = ?1";

// D-79/P3: restricted to current revisions (`superseded_at IS NULL`) — this is the load-bearing
// filter in the whole file. Putting a superseded statement in front of a model would hand it the
// drift directly; every agent-facing read must see current wording only, no matter how a criterion
// was most recently edited.
const CRITERIA_SQL: &str = "SELECT statement, verification_hint FROM acceptance_criteria \
    WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL \
    ORDER BY rank ASC, id ASC";

const SUMMARIES_SQL: &str = "SELECT agent_run_id, changed_files, changed_prose, remains, \
    next_session_must_know, decisions, auto_generated, created_at FROM session_summaries \
    WHERE task_id = ?1 ORDER BY created_at ASC, id ASC";

const WORKTREE_ROW_SQL: &str = "SELECT branch, base_branch, path FROM worktrees WHERE task_id = ?1";

const PROJECT_DEFAULT_BRANCH_SQL: &str = "SELECT default_branch FROM projects WHERE id = ?1";

const PROJECT_KEY_PREFIX_SQL: &str = "SELECT key_prefix FROM projects WHERE id = ?1";

/// One epic row's fields, read once and reused both for [`EpicSection`] and for
/// [`assemble_context_packet`]'s no-worktree-yet base-ref prediction — avoids a second query
/// against `epics` for the same row within one call.
struct EpicRow {
    key: String,
    title: String,
    description: Option<String>,
    integration_branch: Option<String>,
}

/// Assemble the deterministic context packet for `task_id` (D-28) — a pure query, never a model
/// call, never a mutation of any kind. Calling this twice against an unchanged database returns
/// two byte-identical packets (`ContextPacket` derives `PartialEq`); calling it after a criterion
/// is reordered returns the criteria in the new rank order, because this reads board state on
/// every call rather than caching.
pub fn assemble_context_packet(conn: &Connection, task_id: &str) -> anyhow::Result<ContextPacket> {
    let (project_id, epic_id, task_key, task_title, task_description): (
        String,
        Option<String>,
        String,
        String,
        Option<String>,
    ) = conn
        .query_row(TASK_ROW_SQL, params![task_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })
        .with_context(|| format!("task {task_id:?} not found"))?;

    let epic_row: Option<EpicRow> = match &epic_id {
        Some(id) => Some(
            conn.query_row(EPIC_ROW_SQL, params![id], |row| {
                Ok(EpicRow {
                    key: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    integration_branch: row.get(3)?,
                })
            })
            .with_context(|| format!("epic {id:?} not found"))?,
        ),
        None => None,
    };

    let epic = epic_row.as_ref().map(|e| EpicSection {
        title: e.title.clone(),
        description: e.description.clone(),
    });

    let mut criteria_stmt = conn.prepare(CRITERIA_SQL)?;
    let criteria = criteria_stmt
        .query_map(params![task_id], |row| {
            Ok(CriterionEntry {
                statement: row.get(0)?,
                verification_hint: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the task's acceptance criteria")?;
    drop(criteria_stmt);

    let mut summaries_stmt = conn.prepare(SUMMARIES_SQL)?;
    let summaries = summaries_stmt
        .query_map(params![task_id], |row| {
            let changed_files_json: String = row.get(1)?;
            let decisions_json: String = row.get(5)?;
            let auto_generated_int: i64 = row.get(6)?;
            let changed_files: Vec<String> =
                serde_json::from_str(&changed_files_json).unwrap_or_else(|_| Vec::new());
            let decisions: Vec<DecisionEntry> =
                serde_json::from_str(&decisions_json).unwrap_or_else(|_| Vec::new());
            Ok(SummaryEntry {
                agent_run_id: row.get(0)?,
                changed_files,
                changed_prose: row.get(2)?,
                remains: row.get(3)?,
                next_session_must_know: row.get(4)?,
                decisions,
                auto_generated: auto_generated_int != 0,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the task's session summaries")?;
    drop(summaries_stmt);

    // Pure fold over `summaries` (this function's own already-read data) — no query, no I/O.
    // This is the one call site of the two the crate's own `<verify>` gate expects; the other
    // lives in `render_prompt`, which folds the same list again to produce the rendered split.
    let compaction = crate::compaction::compact_summaries(&summaries).boundary;

    // Walk `summaries` oldest-first (their own read order, above) and collect every decision
    // entry, deduplicated by id — first occurrence wins, order preserved. Pure transform over
    // data already read; no additional query, no I/O (this file's own purity contract).
    let mut decisions: Vec<DecisionEntry> = Vec::new();
    let mut seen_decision_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for summary in &summaries {
        for decision in &summary.decisions {
            if seen_decision_ids.insert(decision.id.clone()) {
                decisions.push(decision.clone());
            }
        }
    }

    let existing_worktree: Option<(String, String, String)> = conn
        .query_row(WORKTREE_ROW_SQL, params![task_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .context("failed to look up the worktree for this task")?;

    let worktree = match existing_worktree {
        // For a task that already has a worktree, the branch and path reported are the ones
        // stored on the `worktrees` row, not freshly derived values (D-30: the row is the
        // authority on the topology that was actually created).
        Some((branch, base_branch, path)) => WorktreeFacts { branch, base_ref: base_branch, path },
        // For a task with no worktree yet, the branch and path reported are exactly what
        // `ensure_worktree` would create — predicted read-only, per this file's header comment.
        None => {
            let key_prefix: String = conn
                .query_row(PROJECT_KEY_PREFIX_SQL, params![project_id], |row| row.get(0))
                .with_context(|| format!("project {project_id:?} not found"))?;

            let branch = task_branch_name(&task_key, &task_title);
            let base_ref = match &epic_row {
                Some(e) => e
                    .integration_branch
                    .clone()
                    .unwrap_or_else(|| epic_integration_branch_name(&e.key, &e.title)),
                None => conn
                    .query_row(PROJECT_DEFAULT_BRANCH_SQL, params![project_id], |row| row.get(0))
                    .with_context(|| format!("project {project_id:?} not found"))?,
            };
            let path = worktree_root()
                .join(&key_prefix)
                .join(&task_key)
                .to_string_lossy()
                .into_owned();

            WorktreeFacts { branch, base_ref, path }
        }
    };

    Ok(ContextPacket {
        task_key,
        task_title,
        task_description,
        epic,
        criteria,
        summaries,
        compaction,
        decisions,
        diff: None,
        worktree,
    })
}

/// Attach [`PacketExtras`] to an otherwise-normal [`assemble_context_packet`] call (D-70, plan
/// 04-07 Task 2, 04-RESEARCH.md Pitfall 2/assumption A3). This wrapper is the ONLY place a
/// non-`None` `diff` ever reaches a `ContextPacket` — `assemble_context_packet` itself never calls
/// this function and never calls git. The git read that produced `extras.diff` (if any) happened
/// one layer up, in the command handler that composes the briefing (`agent_run_preview`/
/// `agent_run_start`), never here and never inside `assemble_context_packet`.
///
/// Determinism distinction (CTX-04): `assemble_context_packet` is byte-identical for two calls
/// against an unchanged database, full stop. THIS wrapper is byte-identical for an unchanged
/// database *and* unchanged `extras` — a worktree edited between two calls legitimately changes
/// the diff section it returns, and that is the diff being ground truth, not a determinism
/// failure. Callers must not mistake a changed `diff` field for a broken determinism contract.
pub fn assemble_context_packet_with_extras(
    conn: &Connection,
    task_id: &str,
    extras: PacketExtras,
) -> anyhow::Result<ContextPacket> {
    let mut packet = assemble_context_packet(conn, task_id)?;
    packet.diff = extras.diff;
    Ok(packet)
}

/// Render one **verbatim** Prior Sessions block — the full narrative fields plus decisions,
/// numbered by its position across the whole prior-sessions list (not restarting per subsection),
/// so the section reads in one continuous chronological sequence even when it is split across a
/// fold boundary.
fn render_verbatim_summary_block(out: &mut String, ordinal: usize, summary: &SummaryEntry) {
    out.push_str("### Session ");
    out.push_str(&ordinal.to_string());
    if summary.auto_generated {
        out.push_str(" (auto-generated — no agent summary was recorded for this run)");
    }
    out.push('\n');

    if !summary.changed_files.is_empty() {
        out.push_str("Changed: ");
        out.push_str(&summary.changed_files.join(", "));
        out.push('\n');
    }
    if let Some(prose) = &summary.changed_prose {
        out.push_str(prose);
        out.push('\n');
    }
    if let Some(remains) = &summary.remains {
        out.push_str("Remains: ");
        out.push_str(remains);
        out.push('\n');
    }
    if let Some(next) = &summary.next_session_must_know {
        out.push_str("Next session must know: ");
        out.push_str(next);
        out.push('\n');
    }
    for decision in &summary.decisions {
        out.push_str("- [");
        out.push_str(&decision.id);
        out.push_str("] ");
        out.push_str(&decision.statement);
        out.push('\n');
    }
    out.push('\n');
}

/// Render one **folded** Prior Sessions block (T-04-22) — ordinal, the `auto_generated` marker
/// when set, a comma-separated `Changed:` line, and decision bullets. Nothing else:
/// `CompactedSummary` has no field for `changed_prose`/`remains`/`next_session_must_know`, so
/// there is nothing here that could accidentally leak a folded summary's narrative text — a
/// structural guarantee, not a rendering convention this function could quietly violate.
fn render_folded_summary_block(out: &mut String, ordinal: usize, summary: &CompactedSummary) {
    out.push_str("### Session ");
    out.push_str(&ordinal.to_string());
    if summary.auto_generated {
        out.push_str(" (auto-generated — no agent summary was recorded for this run)");
    }
    out.push('\n');

    if !summary.changed_files.is_empty() {
        out.push_str("Changed: ");
        out.push_str(&summary.changed_files.join(", "));
        out.push('\n');
    }
    for decision in &summary.decisions {
        out.push_str("- [");
        out.push_str(&decision.id);
        out.push_str("] ");
        out.push_str(&decision.statement);
        out.push('\n');
    }
    out.push('\n');
}

/// Render the initial prompt text (D-28) — stable headings, stable ordering, and an omitted
/// heading rather than an empty section: no epic means no epic heading, no criteria means no
/// criteria heading, an empty (or whitespace-only) instruction means no instruction heading.
/// Never emits a placeholder such as a bare dash for a missing field. `render_prompt` for the
/// same packet and instruction returns byte-identical output across calls — nothing here reads
/// the clock, randomness, or any input other than its two arguments.
pub fn render_prompt(packet: &ContextPacket, instruction: &str) -> String {
    let mut out = String::new();

    out.push_str("# ");
    out.push_str(&packet.task_title);
    out.push('\n');

    if let Some(description) = &packet.task_description {
        out.push('\n');
        out.push_str(description);
        out.push('\n');
    }

    if let Some(epic) = &packet.epic {
        out.push_str("\n## Epic Context\n\n");
        out.push_str(&epic.title);
        out.push('\n');
        if let Some(description) = &epic.description {
            out.push('\n');
            out.push_str(description);
            out.push('\n');
        }
    }

    if !packet.criteria.is_empty() {
        out.push_str("\n## Acceptance Criteria\n\n");
        for criterion in &packet.criteria {
            out.push_str("- ");
            out.push_str(&criterion.statement);
            if let Some(hint) = &criterion.verification_hint {
                out.push_str(" (Verify: ");
                out.push_str(hint);
                out.push(')');
            }
            out.push('\n');
        }
    }

    if !packet.summaries.is_empty() {
        out.push_str("\n## Prior Sessions\n\n");

        // Second (and last) call site of the crate's compaction fold in this file — the boundary
        // computed here from `packet.summaries` is the same fold the assembler already ran over
        // the identical list, so the prompt's split and `ContextPacket.compaction` can never
        // disagree (T-04-23): both read only the list's length and order.
        let history = crate::compaction::compact_summaries(&packet.summaries);

        if history.boundary.folded_count == 0 {
            // Nothing folded (five or fewer summaries): the flat list, unchanged from before this
            // plan — no subsection headings, no boundary line.
            for (i, summary) in packet.summaries.iter().enumerate() {
                render_verbatim_summary_block(&mut out, i + 1, summary);
            }
        } else {
            out.push_str("### Earlier sessions (folded)\n\n");
            for (i, folded) in history.folded.iter().enumerate() {
                render_folded_summary_block(&mut out, i + 1, folded);
            }

            if let Some(sentence) = history.boundary.boundary_sentence() {
                out.push_str(&sentence);
                out.push('\n');
            }

            out.push_str("\n### Recent sessions (verbatim)\n\n");
            // Ordinals continue from where the folded block left off, so the section reads as one
            // continuous chronological sequence across the fold boundary rather than restarting.
            let verbatim_start = history.folded.len();
            for (i, summary) in history.verbatim.iter().enumerate() {
                render_verbatim_summary_block(&mut out, verbatim_start + i + 1, summary);
            }
        }
    }

    if !packet.decisions.is_empty() {
        out.push_str("\n## Decisions On Record\n\n");
        for decision in &packet.decisions {
            out.push_str("- [");
            out.push_str(&decision.id);
            out.push_str("] ");
            out.push_str(&decision.statement);
            out.push('\n');
        }
    }

    if let Some(diff) = &packet.diff {
        let committed_present = !diff.committed_stat.is_empty() || !diff.committed_paths.is_empty();
        let working_tree_present = !diff.working_tree_porcelain.is_empty();
        if committed_present || working_tree_present {
            out.push_str("\n## Diff So Far\n\n");

            if committed_present {
                out.push_str("### Committed since ");
                out.push_str(&diff.base_ref);
                out.push_str("\n\n");
                out.push_str(&diff.committed_stat);
                for path in &diff.committed_paths {
                    out.push_str("- ");
                    out.push_str(path);
                    out.push('\n');
                }
            }

            if working_tree_present {
                out.push_str("\n### Working tree (uncommitted)\n\n");
                out.push_str(&diff.working_tree_porcelain);
            }

            out.push_str(
                "\nYou are in this worktree — read any of these files directly for the full \
                 detail.\n",
            );
        }
    }

    let trimmed_instruction = instruction.trim();
    if !trimmed_instruction.is_empty() {
        out.push_str("\n## Additional Instructions\n\n");
        out.push_str(trimmed_instruction);
        out.push('\n');
    }

    // The one section with no omit case (D-64) — every session must be told how to close, even a
    // task with no criteria and no prior summaries. Placed last, so it is the final thing the
    // agent reads.
    out.push_str("\n## Closing Requirement\n\n");
    out.push_str("Call the `");
    out.push_str(REPORT_SUMMARY_TOOL_NAME);
    out.push_str("` tool as your final turn to record this session's closing summary. Pass ");
    out.push_str(
        "changed_files, changed_prose, remains and next_session_must_know describing this \
         session's own work, and set acknowledged_decisions to the ids — from the Decisions On \
         Record section above, if any — that you are working under.\n",
    );

    out
}
