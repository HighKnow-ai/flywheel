//! `assemble_epic_context_packet` / `render_epic_prompt` (D-87, plan 05-04): the declared sibling
//! of `context_packet.rs`, holding the SAME purity contract, restated here in the same words: **a
//! pure query over the board — no model call, no network call, no git call, no mutation of any
//! kind. Every SQL statement below is a literal `&str`, bound through `params![]` — never
//! assembled by `format!`/string interpolation.** D-87's packet inherits CTX-04's determinism
//! obligation exactly; a sibling that quietly relaxed it would be worse than no sibling.
//!
//! This is SHAPE-05's fact packet: what a reopened authoring session already knows about the
//! epic it is challenging — the epic's own facts, its task roster with current-revision criteria
//! (D-79: a superseded statement is visible to the developer and never to an agent, and this
//! packet is an agent-facing read), the assumptions a prior session distilled and Cyril accepted
//! (D-89), the proposals he already rejected (D-83, bounded by position per `compaction.rs`'s own
//! contract), and the stage each prior session reached.
//!
//! `assemble_epic_context_packet(conn, project_id, epic_id: Option<&str>)` — the `Option` is
//! load-bearing: SHAPE-01's primary case is an epic that does not exist yet, and a packet for
//! "nothing yet" is a real packet with every section absent, not an error.

use anyhow::Context;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::context_packet::CriterionEntry;
use crate::domain::authoring_proposal::ProposalPayload;

/// The most recent [`REJECTED_VERBATIM_WINDOW`] rejected proposals for an epic are carried whole;
/// everything older is folded to its `target_type` and its payload's title/statement alone. A
/// fixed count, the same instinct as `compaction::VERBATIM_WINDOW` — **bounded by position, never
/// by size**: no character count, no token count, no size ceiling anywhere in this module.
pub const REJECTED_VERBATIM_WINDOW: usize = 5;

/// The epic's own facts, present only when `epic_id` names a real epic — an absent epic is `None`
/// on [`EpicContextPacket`], never an empty-string title (mirrors `context_packet.rs`'s
/// `EpicSection`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EpicFacts {
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
}

/// One task under the epic — its key, title, status, and its **current-revision** criteria only
/// (`superseded_at IS NULL`, D-79). Reuses `context_packet::CriterionEntry` verbatim, the same
/// statement/verification-hint shape every other agent-facing criteria read already carries.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TaskRosterEntry {
    pub key: String,
    pub title: String,
    pub status: String,
    pub criteria: Vec<CriterionEntry>,
}

/// One accepted `assumption` proposal from a prior authoring run on this epic (D-89) — an
/// addressable row with its own assumption and answer fields, never a prose blob.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssumptionEntry {
    pub assumption: String,
    pub answer: String,
}

/// One rejected proposal, carried whole (within [`REJECTED_VERBATIM_WINDOW`] of the most recent).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RejectedProposalEntry {
    pub target_type: String,
    pub payload: ProposalPayload,
    pub rejection_reason: Option<String>,
    pub created_at: String,
}

/// One rejected proposal past the verbatim window — folded to its `target_type` and its payload's
/// title/statement alone (D-83's re-proposal guard needs to name what was rejected, not relitigate
/// why).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FoldedRejectedProposal {
    pub target_type: String,
    pub label: String,
    pub created_at: String,
}

/// The fold's own accounting of where it split the rejected-proposal list (mirrors
/// `compaction::CompactionBoundary`'s shape). `folded_count == 0` means nothing folded — an epic
/// with at most [`REJECTED_VERBATIM_WINDOW`] rejected proposals has no boundary to name.
///
/// WR-02 (plan 05-09 code review): `total` is the count of rows `REJECTED_PROPOSALS_SQL` actually
/// fetched, capped at `CONTEXT_PACKET_READ_LIMIT` (200) — for the astronomically unlikely epic
/// with more than 200 rejected proposals in its lifetime, `total` undercounts the true database
/// count. The fetch is newest-first, so the verbatim window and the sentence's own "most recent N"
/// framing are unaffected; only the folded tail's reported size could be short. Accepted the same
/// way `compaction.rs`'s own bounded reads are: an approximation that is honest about what it
/// rendered, never a claim about everything that ever happened.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RejectionBoundary {
    pub total: usize,
    pub verbatim_count: usize,
    pub folded_count: usize,
}

impl RejectionBoundary {
    /// The boundary as a sentence a person can say out loud, or `None` when nothing folded —
    /// mirrors `CompactionBoundary::boundary_sentence`'s own omit-when-empty contract.
    pub fn boundary_sentence(&self) -> Option<String> {
        if self.folded_count == 0 {
            return None;
        }
        let mut sentence = String::new();
        sentence.push_str("The ");
        sentence.push_str(&self.verbatim_count.to_string());
        sentence.push_str(" most recently rejected proposals are shown in full; ");
        sentence.push_str(&self.folded_count.to_string());
        if self.folded_count == 1 {
            sentence.push_str(" older rejected proposal is summarized only, by type and title/statement.");
        } else {
            sentence.push_str(" older rejected proposals are summarized only, by type and title/statement.");
        }
        Some(sentence)
    }
}

/// D-83's bounded rejected set — the ammunition SHAPE-05's challenge needs, folded by position
/// exactly like `compaction.rs`'s own contract.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RejectedSet {
    pub verbatim: Vec<RejectedProposalEntry>,
    pub folded: Vec<FoldedRejectedProposal>,
    pub boundary: RejectionBoundary,
}

/// One prior authoring run on this epic — its id, when it started/ended, and the stage it
/// reached, so the model can tell "we got as far as criteria last time" from "we never left
/// challenge". Plan 05-09: `summary_changed_prose` reads back this run's own closing summary
/// (`session_summaries`, via `agent_runs.exit_summary_id`) — the record D-64's guarantee
/// ("no authoring session ends without one") ensures always exists once the run reached a
/// terminal status. `None` only for a run still `running`/`blocked` when this packet is read.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AuthoringRunEntry {
    pub id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub stage_reached: Option<String>,
    pub summary_changed_prose: Option<String>,
}

/// The full epic-scoped context packet (D-87). Every field is data — [`render_epic_prompt`] is
/// the only place prose is produced, matching this crate's "derive at read time, never store"
/// rule.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EpicContextPacket {
    pub epic: Option<EpicFacts>,
    pub task_roster: Vec<TaskRosterEntry>,
    pub answered_assumptions: Vec<AssumptionEntry>,
    pub rejected: RejectedSet,
    pub prior_authoring_runs: Vec<AuthoringRunEntry>,
}

const EPIC_ROW_SQL: &str =
    "SELECT key, title, description, status FROM epics WHERE id = ?1 AND project_id = ?2";

const EPIC_TASKS_SQL: &str =
    "SELECT key, title, status, id FROM tasks WHERE epic_id = ?1 ORDER BY rank ASC, id ASC";

// D-79/P3, the load-bearing filter in this whole file: restricted to current revisions
// (`superseded_at IS NULL`). An agent-facing read must never see a superseded statement, no
// matter how a criterion was most recently edited.
const TASK_CRITERIA_SQL: &str = "SELECT statement, verification_hint, checked FROM acceptance_criteria \
    WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL \
    ORDER BY rank ASC, id ASC";

// WR-02 (plan 05-09 code review): both reads below used to carry no `LIMIT` at all — an epic
// reopened and reshaped many times over its life read its ENTIRE rejected-proposal and
// answered-assumption history into memory on every single "Continue Shaping" preview or real
// session start, regardless of how few of those rows `fold_rejected`'s own
// `REJECTED_VERBATIM_WINDOW` (5) actually renders verbatim afterward. Bounded generously above
// that window, matching `query::authoring`'s own `DEFAULT_LIMIT` convention (200) rather than
// inventing a third magic number.
pub const CONTEXT_PACKET_READ_LIMIT: i64 = 200;

// Ordered NEWEST-first (`DESC`) so the `LIMIT` keeps the most recently answered assumptions, not
// the oldest — the read-out below reverses the fetched rows back to ascending chronological order
// for `render_epic_prompt`'s stable narrative ordering, the same presentation the unbounded read
// always produced.
const ANSWERED_ASSUMPTIONS_SQL: &str = "SELECT payload FROM authoring_proposals \
    WHERE epic_id = ?1 AND status = 'accepted' AND target_type = 'assumption' \
    ORDER BY created_at DESC, id DESC LIMIT ?2";

// Names `idx_authoring_proposals_epic_status`'s own columns (`epic_id`, `status`, `created_at
// DESC`) in both `WHERE` and `ORDER BY` — the bounded rejected-set read is also an indexed one.
// Already newest-first, matching `fold_rejected`'s own "first REJECTED_VERBATIM_WINDOW entries are
// the most recent" contract — the added `LIMIT` only trims the tail this function already folds
// down to a label, never the verbatim window itself.
const REJECTED_PROPOSALS_SQL: &str = "SELECT target_type, payload, rejection_reason, created_at \
    FROM authoring_proposals WHERE epic_id = ?1 AND status = 'rejected' \
    ORDER BY created_at DESC, id DESC LIMIT ?2";

// Plan 05-09: LEFT JOIN session_summaries via agent_runs.exit_summary_id — the one pointer
// `domain::session_summary::insert_summary_row` keeps current — so a prior run's own closing
// summary reads back alongside the stage it reached. LEFT, not INNER: a run still in flight when
// this packet is assembled carries no exit_summary_id yet, and that must not drop the run from the
// list.
//
// Bounded (plan 13-12, FNC-05): `ORDER BY ... DESC LIMIT ?2` keeps the NEWEST runs, and the result
// stays newest-first, which is the order `render_epic_prompt` prints — so no outer re-sort wraps
// it (unlike `context_packet.rs`'s oldest-first `SUMMARIES_SQL`).
const PRIOR_AUTHORING_RUNS_SQL: &str = "SELECT ar.id, ar.started_at, ar.ended_at, \
    ar.authoring_stage, ss.changed_prose \
    FROM agent_runs ar LEFT JOIN session_summaries ss ON ss.id = ar.exit_summary_id \
    WHERE ar.epic_id = ?1 ORDER BY ar.started_at DESC, ar.id DESC LIMIT ?2";

/// The most prior authoring runs one epic packet carries. An epic accumulates one authoring run per
/// session over its whole lifetime, so this read used to grow with epic age; the FNC-05 criterion
/// ("no unbounded read of summaries, decisions or records remains") carries no epic-packet
/// carve-out. Nothing in the rendered prompt states a run count, so the cap contradicts no text.
pub const PRIOR_AUTHORING_RUNS_LIMIT: usize = 10;

/// Pull the payload's title/statement/assumption text alone, for the folded (pre-window) half of
/// the rejected set — the narrative half of the payload (a description, a verification hint, an
/// answer) is dropped entirely, not shortened, matching `compaction.rs`'s own "total for
/// narrative" contract.
fn payload_label(payload: &ProposalPayload) -> String {
    match payload {
        ProposalPayload::Epic { title, .. } => title.clone(),
        ProposalPayload::Task { title, .. } => title.clone(),
        ProposalPayload::Criterion { statement, .. } => statement.clone(),
        ProposalPayload::Assumption { assumption, .. } => assumption.clone(),
        // Plan 06-01: an execution-run `propose_item` proposal never reaches an epic's rejected
        // set (epic-scoped rejection folding is authoring-only), but the match must stay
        // exhaustive over every `ProposalPayload` variant regardless of which caller can produce
        // it — the same discipline `authoring_proposal.rs`'s own `materialise_proposal` catch-all
        // documents.
        ProposalPayload::Issue { title, .. } => title.clone(),
    }
}

struct RawRejectedProposal {
    target_type: String,
    payload: ProposalPayload,
    rejection_reason: Option<String>,
    created_at: String,
}

/// Fold `newest_first` past [`REJECTED_VERBATIM_WINDOW`] (D-83) — a pure function over data
/// already read, deciding the split by POSITION only: the first (most recent, since the input is
/// already ordered newest-first) `REJECTED_VERBATIM_WINDOW` entries are carried whole; everything
/// past that index is folded. No branch here inspects content, only position — the same discipline
/// `compaction::compact_summaries` holds for prior session summaries.
fn fold_rejected(newest_first: Vec<RawRejectedProposal>) -> RejectedSet {
    let total = newest_first.len();
    let verbatim_count = total.min(REJECTED_VERBATIM_WINDOW);

    let mut iter = newest_first.into_iter();
    let mut verbatim = Vec::with_capacity(verbatim_count);
    for raw in iter.by_ref().take(verbatim_count) {
        verbatim.push(RejectedProposalEntry {
            target_type: raw.target_type,
            payload: raw.payload,
            rejection_reason: raw.rejection_reason,
            created_at: raw.created_at,
        });
    }

    let folded: Vec<FoldedRejectedProposal> = iter
        .map(|raw| FoldedRejectedProposal {
            target_type: raw.target_type,
            label: payload_label(&raw.payload),
            created_at: raw.created_at,
        })
        .collect();
    let folded_count = folded.len();

    RejectedSet {
        verbatim,
        folded,
        boundary: RejectionBoundary { total, verbatim_count, folded_count },
    }
}

/// Assemble the deterministic epic-scoped context packet (D-87) — a pure query, never a model
/// call, never a git call, never a mutation of any kind. `epic_id = None` returns a packet with
/// every section absent (SHAPE-01's fresh-epic case), not an error. `epic_id = Some(id)` naming an
/// epic outside `project_id` (or naming no epic at all) is a genuine caller error and returns
/// `Err`, never a silently cross-project packet — every read below is additionally scoped by the
/// epic's own id, which is unique across every project, so no row from another project can ever
/// be read into this packet regardless.
pub fn assemble_epic_context_packet(
    conn: &Connection,
    project_id: &str,
    epic_id: Option<&str>,
) -> anyhow::Result<EpicContextPacket> {
    let Some(epic_id) = epic_id else {
        return Ok(EpicContextPacket {
            epic: None,
            task_roster: Vec::new(),
            answered_assumptions: Vec::new(),
            rejected: RejectedSet {
                verbatim: Vec::new(),
                folded: Vec::new(),
                boundary: RejectionBoundary { total: 0, verbatim_count: 0, folded_count: 0 },
            },
            prior_authoring_runs: Vec::new(),
        });
    };

    let (key, title, description, status): (String, String, Option<String>, String) = conn
        .query_row(EPIC_ROW_SQL, params![epic_id, project_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .context("epic not found in this project")?;
    let epic = Some(EpicFacts { key, title, description, status });

    let mut task_stmt = conn.prepare(EPIC_TASKS_SQL)?;
    let tasks: Vec<(String, String, String, String)> = task_stmt
        .query_map(params![epic_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the epic's task roster")?;

    let mut task_roster = Vec::with_capacity(tasks.len());
    for (key, title, status, task_id) in tasks {
        let mut criteria_stmt = conn.prepare(TASK_CRITERIA_SQL)?;
        let criteria = criteria_stmt
            .query_map(params![task_id], |row| {
                Ok(CriterionEntry {
                    statement: row.get(0)?,
                    verification_hint: row.get(1)?,
                    checked: row.get::<_, i64>(2)? != 0,
                    anchor: None,
                    anchor_staleness: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("failed to read a roster task's acceptance criteria")?;
        task_roster.push(TaskRosterEntry { key, title, status, criteria });
    }

    let mut assumptions_stmt = conn.prepare(ANSWERED_ASSUMPTIONS_SQL)?;
    let mut assumption_payloads: Vec<String> = assumptions_stmt
        .query_map(params![epic_id, CONTEXT_PACKET_READ_LIMIT], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read answered assumption proposals")?;
    // The SQL reads newest-first so the LIMIT keeps the most recent rows — reverse back to
    // ascending chronological order here, matching the unbounded read's original presentation.
    assumption_payloads.reverse();

    let mut answered_assumptions = Vec::with_capacity(assumption_payloads.len());
    for payload_json in assumption_payloads {
        let payload: ProposalPayload =
            serde_json::from_str(&payload_json).context("failed to parse an assumption proposal payload")?;
        match payload {
            ProposalPayload::Assumption { assumption, answer } => {
                answered_assumptions.push(AssumptionEntry { assumption, answer });
            }
            other => {
                anyhow::bail!(
                    "expected an assumption proposal payload, found a {:?} payload instead",
                    other.target_type()
                );
            }
        }
    }

    let mut rejected_stmt = conn.prepare(REJECTED_PROPOSALS_SQL)?;
    let raw_rejected: Vec<RawRejectedProposal> = rejected_stmt
        .query_map(params![epic_id, CONTEXT_PACKET_READ_LIMIT], |row| {
            let target_type: String = row.get(0)?;
            let payload_json: String = row.get(1)?;
            let rejection_reason: Option<String> = row.get(2)?;
            let created_at: String = row.get(3)?;
            Ok((target_type, payload_json, rejection_reason, created_at))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read rejected proposals for this epic")?
        .into_iter()
        .map(|(target_type, payload_json, rejection_reason, created_at)| {
            let payload: ProposalPayload = serde_json::from_str(&payload_json)
                .context("failed to parse a rejected proposal payload")?;
            Ok(RawRejectedProposal { target_type, payload, rejection_reason, created_at })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let rejected = fold_rejected(raw_rejected);

    let mut runs_stmt = conn.prepare(PRIOR_AUTHORING_RUNS_SQL)?;
    let prior_authoring_runs = runs_stmt
        .query_map(params![epic_id, PRIOR_AUTHORING_RUNS_LIMIT as i64], |row| {
            Ok(AuthoringRunEntry {
                id: row.get(0)?,
                started_at: row.get(1)?,
                ended_at: row.get(2)?,
                stage_reached: row.get(3)?,
                summary_changed_prose: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read prior authoring runs for this epic")?;

    Ok(EpicContextPacket { epic, task_roster, answered_assumptions, rejected, prior_authoring_runs })
}

/// Render the epic-scoped priming prompt (D-87) — stable headings, stable ordering, and an
/// omitted heading rather than an empty section, mirroring `context_packet.rs::render_prompt`'s
/// own contract: an absent epic emits no epic heading, an empty roster emits no roster heading.
/// Byte-identical across calls for the same packet and the same `premise` — nothing here reads
/// the clock, randomness, or any input other than its two arguments.
///
/// `premise` (plan 05-13, closing gap G-05-2's second half) is the developer's own stated framing
/// for the session — a SESSION INPUT, never board state, so it is a parameter here rather than a
/// field on [`EpicContextPacket`] itself: the packet's own assembly, determinism and purity
/// contracts are unchanged by this widening. Trimmed and treated as absent when blank, exactly
/// like every other optional section this function renders. When present, it gets its own section
/// immediately before the closing task section; when absent, the closing section's own wording
/// asks the developer what they want to build instead of naming a framing that was never
/// supplied — the fix for the gap's own evidence: a wholly fresh epic used to be told to
/// "challenge the developer's framing" when no framing existed to challenge.
pub fn render_epic_prompt(packet: &EpicContextPacket, premise: Option<&str>) -> String {
    let mut out = String::new();

    if let Some(epic) = &packet.epic {
        out.push_str("## Epic\n\n");
        out.push_str(&epic.title);
        out.push('\n');
        if let Some(description) = &epic.description {
            out.push('\n');
            out.push_str(description);
            out.push('\n');
        }
        out.push_str("\nStatus: ");
        out.push_str(&epic.status);
        out.push('\n');
    }

    if !packet.task_roster.is_empty() {
        out.push_str("\n## Task Roster\n\n");
        for task in &packet.task_roster {
            out.push_str("- [");
            out.push_str(&task.key);
            out.push_str("] ");
            out.push_str(&task.title);
            out.push_str(" (");
            out.push_str(&task.status);
            out.push_str(")\n");
            for criterion in &task.criteria {
                out.push_str("  - ");
                out.push_str(&criterion.statement);
                if let Some(hint) = &criterion.verification_hint {
                    out.push_str(" (Verify: ");
                    out.push_str(hint);
                    out.push(')');
                }
                out.push('\n');
            }
        }
    }

    if !packet.answered_assumptions.is_empty() {
        out.push_str("\n## Answered Assumptions\n\n");
        out.push_str(
            "These were already asked and answered in a prior session on this epic — do not \
             ask them again.\n\n",
        );
        for assumption in &packet.answered_assumptions {
            out.push_str("- ");
            out.push_str(&assumption.assumption);
            out.push_str(" — ");
            out.push_str(&assumption.answer);
            out.push('\n');
        }
    }

    if !packet.prior_authoring_runs.is_empty() {
        out.push_str("\n## Prior Authoring Sessions\n\n");
        for run in &packet.prior_authoring_runs {
            out.push_str("- Session ");
            out.push_str(&run.id);
            out.push_str(" started ");
            out.push_str(&run.started_at);
            match &run.ended_at {
                Some(ended) => {
                    out.push_str(", ended ");
                    out.push_str(ended);
                }
                None => out.push_str(", never ended"),
            }
            match &run.stage_reached {
                Some(stage) => {
                    out.push_str(" — reached the ");
                    out.push_str(stage);
                    out.push_str(" stage.\n");
                }
                None => out.push_str(".\n"),
            }
            if let Some(summary) = &run.summary_changed_prose {
                out.push_str("  Summary: ");
                out.push_str(summary);
                out.push('\n');
            }
        }
    }

    let rejected_present = !packet.rejected.verbatim.is_empty() || !packet.rejected.folded.is_empty();
    if rejected_present {
        out.push_str("\n## Rejected Proposals\n\n");
        out.push_str(
            "Every proposal below was rejected by the developer in a prior session on this \
             epic. Do not re-propose any of them — if the developer's framing has genuinely \
             changed, that is a new proposal, not a repeat.\n\n",
        );
        for entry in &packet.rejected.verbatim {
            out.push_str("- [");
            out.push_str(&entry.target_type);
            out.push_str("] ");
            out.push_str(&payload_label(&entry.payload));
            if let Some(reason) = &entry.rejection_reason {
                out.push_str(" — rejected: ");
                out.push_str(reason);
            }
            out.push('\n');
        }
        for entry in &packet.rejected.folded {
            out.push_str("- [");
            out.push_str(&entry.target_type);
            out.push_str("] ");
            out.push_str(&entry.label);
            out.push_str(" (older, summarized)\n");
        }
        if let Some(sentence) = packet.rejected.boundary.boundary_sentence() {
            out.push_str(&sentence);
            out.push('\n');
        }
    }

    let premise = premise.map(str::trim).filter(|p| !p.is_empty());

    if let Some(premise) = premise {
        out.push_str("\n## Developer's Premise\n\n");
        out.push_str(premise);
        out.push('\n');
    }

    // The one section with no omit case — every priming prompt must state the job, even for a
    // wholly fresh epic with every other section absent. Its wording splits on whether a premise
    // was supplied (plan 05-13): with one, there is a real framing to challenge; without one, the
    // model is told plainly that none exists yet and that its first move is to ask, never to
    // invent a framing on the developer's behalf.
    out.push_str("\n## Your Task\n\n");
    if premise.is_some() {
        out.push_str(
            "You are in the challenge stage of a Socratic epic-authoring session. Your job this \
             stage is to challenge the developer's framing, not to draft a plan — no proposal tool \
             exists in this stage, and nothing you say here can write to the board. A good turn \
             surfaces an assumption the developer has not stated, or names a risk that the epic's \
             existing contents (above, if any) already contradict. Do not propose tasks or criteria \
             until the developer advances the stage.\n",
        );
        out.push_str(
            "This session has three stages — challenge, then decompose, then criteria — and only \
             the developer advances between them; each advance will bring its own instruction \
             saying what that stage wants.\n",
        );
    } else {
        out.push_str(
            "You are in the challenge stage of a Socratic epic-authoring session, and no framing \
             has been supplied yet. Your first move is to ask the developer what they want to \
             build — do not invent a framing to challenge on their behalf, and do not draft a \
             plan. No proposal tool exists in this stage, and nothing you say here can write to \
             the board; that stays true once the developer does answer. Do not propose tasks or \
             criteria until the developer advances the stage.\n",
        );
        out.push_str(
            "This session has three stages — challenge, then decompose, then criteria — and only \
             the developer advances between them; each advance will bring its own instruction \
             saying what that stage wants.\n",
        );
    }

    out
}

/// The most tracked paths a planning prompt lists (D-69 house style: one declared count, never a
/// byte or token ceiling). A repository with more says how many it left out, so the model knows its
/// listing is partial and searches rather than assuming a path does not exist.
pub const PLANNING_LISTING_CEILING: usize = 2000;

/// Plan 09-08 (PLAN-01, D-147): the briefing the pre-dispatch planning run is spawned with — the
/// epic's goal, every task with its key, title and criteria, then the instruction to read the
/// repository as it is NOW and call `submit_plan`. Pure and deterministic over the packet, like
/// [`render_epic_prompt`].
///
/// Tasks already past `todo` are listed for context only: the plan covers backlog and todo tasks,
/// and the Rust side refuses any other key. Two requests here exist because the overlap check can
/// only compare what is declared: manifests and lockfiles (several tasks that add a dependency each
/// legitimately touch the same one), and a stated reason for every task left out (so none vanishes
/// quietly).
///
/// `file_listing` is the repository's tracked paths, produced by the caller from `git ls-files`
/// ([`crate::git::tracked_files`]) so this function stays pure. It is listed up to
/// [`PLANNING_LISTING_CEILING`] and the prompt states how many were not shown.
pub fn render_planning_prompt(packet: &EpicContextPacket, file_listing: &[String]) -> String {
    let mut out = String::new();

    out.push_str("## Epic\n\n");
    if let Some(epic) = &packet.epic {
        out.push_str(&epic.title);
        out.push('\n');
        if let Some(description) = &epic.description {
            out.push('\n');
            out.push_str(description);
            out.push('\n');
        }
    }

    let plannable = |status: &str| matches!(status, "backlog" | "todo");
    out.push_str("\n## Tasks To Plan\n\n");
    for task in packet.task_roster.iter().filter(|t| plannable(&t.status)) {
        push_task(&mut out, task);
    }
    if packet.task_roster.iter().any(|t| !plannable(&t.status)) {
        out.push_str("\n## Already Under Way (context only, do not plan these)\n\n");
        for task in packet.task_roster.iter().filter(|t| !plannable(&t.status)) {
            push_task(&mut out, task);
        }
    }

    out.push_str("\n## Files In This Repository\n\n");
    if file_listing.is_empty() {
        out.push_str("(no tracked files)\n");
    }
    for path in file_listing.iter().take(PLANNING_LISTING_CEILING) {
        out.push_str(path);
        out.push('\n');
    }
    if file_listing.len() > PLANNING_LISTING_CEILING {
        out.push_str(&format!(
            "\n{} more tracked paths are not shown here; search the working directory for anything \
             you do not see above.\n",
            file_listing.len() - PLANNING_LISTING_CEILING
        ));
    }

    out.push_str("\n## Your Task\n\n");
    out.push_str(
        "You are planning how the tasks above can run at the same time. Read the repository as it is \
         now, in this working directory, and for EACH task above decide the exact files it expects to \
         modify and the wave it belongs in. Then call `submit_plan` once.\n\n\
         This is a read-only job: do not modify any file, do not run builds or tests that write, and do \
         not call any other Flywheel tool. Reading, searching and listing are what it needs.\n\n",
    );
    out.push_str(
        "For each task give `files`: repository-relative paths in exactly two forms. An exact file, such \
         as `src/lib.rs`, or a directory prefix ending in `/`, such as `src/api/`. General globs \
         (`*`, `?`, `[`, `{`) are rejected, as are absolute paths, `..` segments and the repository \
         root. Prefer exact files; use a directory prefix only when the task really owns the directory. \
         A file list that is too small voids the guarantee that tasks in one wave cannot collide, so \
         when in doubt include the file.\n\n",
    );
    out.push_str(
        "The `## Files In This Repository` section above lists what exists; treat it as the authority \
         for paths. When you cannot determine which files a task will modify, set `undeclared` to true \
         on that task and give it an empty `files` list. That is the honest answer and the task stays \
         in the plan; an invented file set is worse than none, because the overlap check would trust \
         it.\n\n",
    );
    out.push_str(
        "Declare manifests and lockfiles (`Cargo.toml`, `Cargo.lock`, `package.json`, \
         `package-lock.json` and the like) for every task that adds or upgrades a dependency. Several \
         tasks that each add a dependency all touch the same lockfile, and it is a collision the \
         overlap check cannot see unless you declare it.\n\n",
    );
    out.push_str(
        "Give each task a `wave`, starting at 1. Tasks in one wave run at the same time; only tasks \
         whose files overlap wait for each other. Put a task in a later wave when it needs the result \
         of an earlier task, not merely because it is large. Give each task a one-line `rationale`.\n\n",
    );
    out.push_str(
        "Name every task above. If you believe a task should not be part of this plan, list it under \
         `excluded` with a `reason` the developer will read; a task you neither plan nor exclude is \
         left out and shown as unexplained.\n\n",
    );
    out.push_str(
        "`submit_plan` stores a draft for the developer to review and edit; it starts nothing. If it \
         returns an error, the message names what to fix: correct it and call `submit_plan` again with \
         the whole plan.\n",
    );
    out
}

fn push_task(out: &mut String, task: &TaskRosterEntry) {
    out.push_str("- [");
    out.push_str(&task.key);
    out.push_str("] ");
    out.push_str(&task.title);
    out.push_str(" (");
    out.push_str(&task.status);
    out.push_str(")\n");
    for criterion in &task.criteria {
        out.push_str("  - ");
        out.push_str(&criterion.statement);
        if let Some(hint) = &criterion.verification_hint {
            out.push_str(" (Verify: ");
            out.push_str(hint);
            out.push(')');
        }
        out.push('\n');
    }
}
