//! `create_proposal` / `apply_proposal_created` / `accept_proposal` / `reject_proposal` /
//! `amend_proposal` / `accept_subtree` / `pending_proposals_for_run` (D-80/D-81/D-83/D-92/D-93/
//! D-94/D-95/D-96, plans 05-02 and 05-06): the staging write path, and every way a staged proposal
//! becomes real, rejected or corrected. Follows `domain::session_summary::create_summary`'s
//! discipline to the letter — every SQL statement here is a compile-time literal `&str` bound
//! through `params![]`/`named_params!`, and every identity field (`project_id`, `epic_id`, the
//! acting actor) is resolved from the `agent_runs` row INSIDE the write transaction, never accepted
//! as a caller argument (T-05-02-01): a caller cannot attribute a proposal to a run it does not
//! drive.
//!
//! This module never issues `INSERT INTO tasks`/`epics`/`acceptance_criteria` or
//! `UPDATE acceptance_criteria` — [`accept_proposal`]/[`accept_subtree`] materialise EXCLUSIVELY
//! through the canonical writers those tables already own (`domain::task`, `domain::epic`,
//! `domain::acceptance_criterion`'s own `_in_tx` siblings), matching T-05-02-03's and T-05-06-02's
//! mitigations. `authoring_proposals` rows themselves are never deleted (D-83) — a decided row is a
//! status transition, never a `DELETE FROM authoring_proposals`.
//!
//! Plan 06-01 (D-97/D-99/PROP-07): this table now serves TWO different callers — an epic-authoring
//! session (unchanged, above) and an ordinary task-EXECUTION run's `propose_item` MCP tool call.
//! An execution run stages exactly one row through the SAME [`create_proposal_in_tx`] write path,
//! carrying two additional provenance fields ([`ProposalProvenance`]) an authoring caller never
//! sets: `rationale` (the agent's own stated reason, stored verbatim) and `origin_log_offset` (a
//! turn pointer resolved SERVER-SIDE from `session_log::count_lines`, never accepted as a caller
//! argument — PROP-07 requires both fields be attributable to the run's own session log, not to
//! whatever an agent's tool-call arguments claim).
//!
//! Plan 06-03 (D-101/D-102/D-104): `status` is now a five-value vocabulary — `pending`,
//! `accepted`, `rejected`, `merged`, `deferred`. `merged` is where `domain::issue`'s own header
//! comment's reserved `merged_into_task` outcome is actually recorded: [`merge_proposal`] attaches
//! a child `issues` row to an existing task or epic through [`crate::domain::issue::create_issue_in_tx`],
//! the SAME canonical writer [`materialise_proposal`]'s `create`/`Issue` arm calls for a top-level
//! accept — two distinct call sites, never one branching on how it was triggered. `deferred` rows
//! ([`defer_proposal`]) are recallable: a deferred proposal mints no canonical row and stays in the
//! already-decided set a later triage run is primed with (D-102). [`reject_proposals_bulk`] and
//! [`defer_proposals_bulk`] are the two D-104 bulk paths — safe to batch precisely because neither
//! mints anything; no accept-all counterpart exists at any layer.
//!
//! Plan 06-04 (PROP-04, D-105/D-106/D-107): `duplicate_of`/`duplicate_score` are written by
//! [`create_proposal_in_tx`] alone, inside its own INSERT — the only place this module writes
//! either column at CREATE time. [`amend_proposal`] is the only OTHER writer, re-scoring the
//! amended content in the same UPDATE it already issues. Neither ever removes a row or changes any
//! other column because of a duplicate verdict — the flag ANNOTATES a row for a human's triage
//! pass, it never substitutes for one (D-107 rejected auto-drop/auto-reject/auto-merge outright).
//! The threshold this flag is compared against lives as a single constant in `query::search`
//! (`DUPLICATE_BM25_THRESHOLD`) — never a second copy of the comparison anywhere in this module.
//!
//! Plan 06-05 (PROP-05, D-109/D-110/D-111/D-112): [`PROPOSAL_LIMIT_PER_RUN`] fixes how many
//! proposals ONE agent run may EVER stage at 10 — a compile-time constant, never a settings key,
//! a `projects` column or an environment override. [`create_proposal_in_tx`] counts the run's own
//! rows with a plain `COUNT(*)` (every status, every verb — a rejected proposal still consumed a
//! human's attention) inside the SAME transaction as the INSERT that would otherwise run: at or
//! past the limit, no row is inserted, one `proposal.limit_exhausted` event is appended instead,
//! and [`ProposalOutcome::LimitExhausted`] is returned. The event still commits — a refusal is
//! never a silent rollback (T-06-22) — and `query::authoring::proposal_limit_notices` derives the
//! human-facing notice from these events on every read, never a second stored copy.

use anyhow::Context;
use rusqlite::{named_params, params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// D-81: the one verb vocabulary every proposal carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalVerb {
    Create,
    Amend,
    Delete,
}

impl ProposalVerb {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalVerb::Create => "create",
            ProposalVerb::Amend => "amend",
            ProposalVerb::Delete => "delete",
        }
    }

    pub fn from_db_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "create" => Ok(ProposalVerb::Create),
            "amend" => Ok(ProposalVerb::Amend),
            "delete" => Ok(ProposalVerb::Delete),
            other => Err(anyhow::anyhow!("unknown proposal verb {other:?}")),
        }
    }
}

/// The staging table's `target_type` vocabulary — matches the schema's own CHECK constraint in
/// migration `0015_proposal_triage_extension.sql` exactly (widened from `0011_authoring_staging.sql`
/// by D-97 to add `Issue`, the one new target type an execution-run's `propose_item` call can
/// stage that an authoring session never proposes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalTargetType {
    Epic,
    Task,
    Criterion,
    Assumption,
    Issue,
}

impl ProposalTargetType {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalTargetType::Epic => "epic",
            ProposalTargetType::Task => "task",
            ProposalTargetType::Criterion => "criterion",
            ProposalTargetType::Assumption => "assumption",
            ProposalTargetType::Issue => "issue",
        }
    }

    pub fn from_db_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "epic" => Ok(ProposalTargetType::Epic),
            "task" => Ok(ProposalTargetType::Task),
            "criterion" => Ok(ProposalTargetType::Criterion),
            "assumption" => Ok(ProposalTargetType::Assumption),
            "issue" => Ok(ProposalTargetType::Issue),
            other => Err(anyhow::anyhow!("unknown proposal target_type {other:?}")),
        }
    }
}

/// One proposal's content, serialised into `authoring_proposals.payload` as JSON with a `kind`
/// discriminant. Every variant carries DISCRETE NAMED fields — never one prose blob folding a
/// drafted criterion or assumption into another row's field, the structural form of this phase's
/// own prohibition against that.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposalPayload {
    Epic { title: String, description: Option<String> },
    Task { title: String, description: Option<String> },
    Criterion { statement: String, verification_hint: Option<String> },
    Assumption { assumption: String, answer: String },
    /// D-97/D-98 (plan 06-01): an execution-run's `propose_item` call staging an issue. The field
    /// is named `issue_kind`, NOT `kind` — this enum's own `#[serde(tag = "kind")]` already claims
    /// `kind` as the variant discriminant at the JSON level, and serde refuses to compile a
    /// variant field whose serialised name collides with the internal tag (`error: variant field
    /// name "kind" conflicts with internal tag`, verified this session). The MCP tool's own
    /// user/model-facing schema property stays named `kind` (`propose_item`'s `inputSchema`) —
    /// `mcp-permission-server.ts`'s `buildProposeItemPayload` renames it to `issue_kind` when it
    /// builds this wire shape, exactly once, at that translation boundary.
    Issue { title: String, body: Option<String>, issue_kind: String },
}

/// D-98: the four issue kinds a `propose_item` call may name when `target_type` is `issue` —
/// mirrors the MCP tool schema's own enum (`packages/sidecar/src/mcp-permission-server.ts`'s
/// `proposeItemToolDefinition.inputSchema.properties.kind`) exactly, so the two can never drift
/// apart.
pub const ISSUE_KINDS: [&str; 4] = ["bug", "idea", "question", "risk"];

impl ProposalPayload {
    pub fn target_type(&self) -> ProposalTargetType {
        match self {
            ProposalPayload::Epic { .. } => ProposalTargetType::Epic,
            ProposalPayload::Task { .. } => ProposalTargetType::Task,
            ProposalPayload::Criterion { .. } => ProposalTargetType::Criterion,
            ProposalPayload::Assumption { .. } => ProposalTargetType::Assumption,
            ProposalPayload::Issue { .. } => ProposalTargetType::Issue,
        }
    }

    /// The one human-readable string a decision turn (D-93/D-94) or an event payload's own
    /// `"label"` field quotes back — a title for `Epic`/`Task`/`Issue`, a statement for
    /// `Criterion`, the challenged assumption itself for `Assumption`.
    pub fn label(&self) -> &str {
        match self {
            ProposalPayload::Epic { title, .. } => title,
            ProposalPayload::Task { title, .. } => title,
            ProposalPayload::Criterion { statement, .. } => statement,
            ProposalPayload::Assumption { assumption, .. } => assumption,
            ProposalPayload::Issue { title, .. } => title,
        }
    }

    /// Plan 06-04 (D-105/D-107): the `(title, body)` text pair
    /// `query::search::duplicate_candidate_for` scores this payload against — the same
    /// title-ish/body-ish split every variant's own fields already carry, never a re-derivation
    /// of [`Self::label`] (which returns only ONE field, not the pair `bm25` weights
    /// separately). `Delete`-verb payloads are placeholders carrying empty text (see
    /// `create_proposal_in_tx`'s own comment on why `Delete` skips `validate_payload`) — an empty
    /// title degrades to "no candidate" inside `duplicate_candidate_for` itself, so this method
    /// needs no verb-aware branch of its own.
    pub fn duplicate_search_text(&self) -> (&str, Option<&str>) {
        match self {
            ProposalPayload::Epic { title, description } => (title, description.as_deref()),
            ProposalPayload::Task { title, description } => (title, description.as_deref()),
            ProposalPayload::Criterion { statement, verification_hint } => {
                (statement, verification_hint.as_deref())
            }
            ProposalPayload::Assumption { assumption, answer } => (assumption, Some(answer.as_str())),
            ProposalPayload::Issue { title, body, .. } => (title, body.as_deref()),
        }
    }
}

/// One `authoring_proposals` row, as read back after [`create_proposal`]/[`accept_proposal`]/
/// [`pending_proposals_for_run`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub agent_run_id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub verb: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub parent_proposal_id: Option<String>,
    pub position: String,
    pub payload: ProposalPayload,
    pub status: String,
    pub rejection_reason: Option<String>,
    pub materialised_id: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
    /// Plan 06-01 (PROP-07, D-99): the agent's own stated reason for this proposal, stored
    /// verbatim in its own column — never folded into `payload`. `None` for every authoring-run
    /// proposal (an authoring session's write tools carry no rationale field at all); `Some` for
    /// an execution-run `propose_item` call, which requires one.
    pub rationale: Option<String>,
    /// Plan 06-01 (PROP-07, D-99): the run's own session-log turn pointer at staging time,
    /// resolved SERVER-SIDE from `session_log::count_lines` — never read off the event. `None`
    /// for every authoring-run proposal (this field is execution-run-only); `Some(0)` is a real,
    /// meaningful value (a run whose log has no lines yet), never treated as a missing pointer.
    pub origin_log_offset: Option<i64>,
    /// Plan 06-01 (D-107): filled by plan 06-04's duplicate-scoring pass — always `NULL` from this
    /// plan's own write path.
    pub duplicate_of: Option<String>,
    /// Plan 06-01 (D-107): filled by plan 06-04's duplicate-scoring pass — always `NULL` from this
    /// plan's own write path.
    pub duplicate_score: Option<f64>,
}

// `pub(crate)` (plan 05-04, mirrors `query::ORDER_BY`'s own precedent in `query/mod.rs`):
// `query::authoring`'s board-level proposal reads (`list_pending_proposals`,
// `list_rejected_for_epic`) compose this exact column list and row mapper so a proposal's wire
// shape has exactly one definition in the crate, rather than a second, driftable copy.
pub(crate) const PROPOSAL_COLUMNS: &str = "id, agent_run_id, project_id, epic_id, verb, target_type, \
    target_id, parent_proposal_id, position, payload, status, rejection_reason, materialised_id, \
    created_by, created_at, decided_by, decided_at, rationale, origin_log_offset, duplicate_of, \
    duplicate_score";

pub(crate) fn row_to_proposal(row: &Row) -> rusqlite::Result<Proposal> {
    let payload_json: String = row.get(9)?;
    let payload: ProposalPayload = serde_json::from_str(&payload_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e))
    })?;

    Ok(Proposal {
        id: row.get(0)?,
        agent_run_id: row.get(1)?,
        project_id: row.get(2)?,
        epic_id: row.get(3)?,
        verb: row.get(4)?,
        target_type: row.get(5)?,
        target_id: row.get(6)?,
        parent_proposal_id: row.get(7)?,
        position: row.get(8)?,
        payload,
        status: row.get(10)?,
        rejection_reason: row.get(11)?,
        materialised_id: row.get(12)?,
        created_by: row.get(13)?,
        created_at: row.get(14)?,
        decided_by: row.get(15)?,
        decided_at: row.get(16)?,
        rationale: row.get(17)?,
        origin_log_offset: row.get(18)?,
        duplicate_of: row.get(19)?,
        duplicate_score: row.get(20)?,
    })
}

/// Plan 06-01 (PROP-07, D-99): the two provenance fields an execution-run `propose_item` call
/// carries that an authoring session's write tools never do. Threaded through
/// [`create_proposal`]/[`create_proposal_in_tx`] as one parameter (rather than two positional
/// `Option` arguments) so every call site states its intent once, at the call site, instead of
/// two easily-transposed trailing `None`s.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProposalProvenance {
    /// The agent's own stated reason for this proposal, stored verbatim. Validated (non-empty
    /// after trimming, within [`MAX_PROPOSAL_RATIONALE_LEN`]) wherever [`validate_payload`] already
    /// runs — a `Some` rationale is validated exactly like the payload it accompanies.
    pub rationale: Option<String>,
    /// The run's own session-log turn pointer, resolved server-side. Never computed by this
    /// struct itself — the caller (`apply_proposal_created`) resolves it via
    /// `session_log::count_lines` BEFORE opening the write transaction, so no filesystem read
    /// happens while the write lock is held.
    pub origin_log_offset: Option<i64>,
}

impl ProposalProvenance {
    /// Every existing authoring caller's value — no rationale, no turn pointer. Named (rather than
    /// relying on `Default::default()` at each call site) so every call site reads as a deliberate
    /// statement of "this proposal carries no execution-run provenance," not an accidental
    /// default.
    pub const NONE: ProposalProvenance = ProposalProvenance { rationale: None, origin_log_offset: None };
}

/// Plan 06-01 (PROP-07): the length ceiling a staged `rationale` must fit inside — mirrors
/// [`MAX_PROPOSAL_TEXT_LEN`]'s own value (1000) and the `propose_item` MCP tool schema's own
/// `rationale` `maxLength` (`packages/sidecar/src/mcp-permission-server.ts`), so the three can
/// never drift apart.
pub const MAX_PROPOSAL_RATIONALE_LEN: usize = 1000;

/// Plan 06-05 (PROP-05, D-109): the fixed ceiling on how many proposals ONE agent run may EVER
/// stage — deliberately a compile-time constant, never a settings key, a `projects` column or an
/// environment override, following D-69's own precedent (the verbatim-summary window was fixed at
/// 5 rather than exposed, because a knob nobody tunes still has to be tested at every value). The
/// 10th proposal a run stages succeeds; the 11th is refused — see
/// [`ProposalOutcome::LimitExhausted`] and [`create_proposal_in_tx`]'s own in-transaction
/// `COUNT(*)` check.
pub const PROPOSAL_LIMIT_PER_RUN: usize = 10;

/// Stage one proposal for `agent_run_id` (D-80/D-81/D-92). **`project_id`, `epic_id` and the
/// acting actor are resolved from the `agent_runs` row INSIDE this transaction** — this function's
/// own signature carries no `project_id`/`epic_id` parameter, so a caller cannot attribute a
/// proposal to a run it does not drive (T-05-02-01).
///
/// `position` is allocated with [`rank_after`] against the tail sibling sharing the same
/// `parent_proposal_id` (D-92's per-row granularity). Inserts the row with `status = 'pending'`,
/// appends one `proposal.created` event with a human-renderable payload (D-19), commits once.
///
/// `provenance` ([`ProposalProvenance`]) carries the two fields ONLY an execution-run's
/// `propose_item` call sets (plan 06-01, PROP-07) — every existing authoring caller passes
/// [`ProposalProvenance::NONE`].
pub fn create_proposal(
    conn: &mut Connection,
    agent_run_id: &str,
    verb: ProposalVerb,
    payload: ProposalPayload,
    target_id: Option<&str>,
    parent_proposal_id: Option<&str>,
    provenance: ProposalProvenance,
) -> anyhow::Result<Proposal> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let outcome = create_proposal_in_tx(
        &tx,
        agent_run_id,
        verb,
        payload,
        target_id,
        parent_proposal_id,
        provenance,
        &now,
    )?;
    // Commit BEFORE inspecting the outcome (plan 06-05): a refusal already appended its own
    // `proposal.limit_exhausted` event inside this same transaction, and that event must survive
    // regardless of how this function reports the refusal to ITS OWN caller — never a rollback
    // that quietly un-writes a real occurrence (T-06-22).
    tx.commit().context("failed to commit create_proposal transaction")?;
    match outcome {
        ProposalOutcome::Created(proposal) => Ok(proposal),
        // Plan 06-05 (D-111): reported as a real `Err`, never silently dropped and never folded
        // into `Ignored` (which means something different — malformed input, not "over budget").
        ProposalOutcome::LimitExhausted { limit, count } => Err(anyhow::anyhow!(
            "run {agent_run_id:?} has already staged {count} of {limit} allowed proposals — this \
             one was NOT staged; call report_summary and put it in the remains field instead"
        )),
        other => Err(anyhow::anyhow!(
            "create_proposal_in_tx returned an unexpected outcome for a direct create_proposal \
             call: {other:?}"
        )),
    }
}

fn create_proposal_in_tx(
    tx: &Transaction,
    agent_run_id: &str,
    verb: ProposalVerb,
    payload: ProposalPayload,
    target_id: Option<&str>,
    parent_proposal_id: Option<&str>,
    provenance: ProposalProvenance,
    now: &str,
) -> anyhow::Result<ProposalOutcome> {
    let (project_id, epic_id, actor_id, run_task_id): (String, Option<String>, String, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id, actor_id, task_id FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;

    // Plan 06-05 (PROP-05, D-109/D-110): the count of every row THIS run has EVER staged —
    // regardless of status or verb, a rejected/deferred row still consumed a human's triage
    // attention (T-06-20) — read through `idx_authoring_proposals_run_status`'s leading column,
    // BEFORE the tail-position/validation/duplicate-lookup work below, and inside the SAME
    // transaction as the INSERT that would follow: a read-then-write gap here is exactly what
    // would make the limit advisory rather than real (D-110).
    let staged_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1",
            params![agent_run_id],
            |row| row.get(0),
        )
        .context("failed to count this run's staged proposals")?;

    if staged_count >= PROPOSAL_LIMIT_PER_RUN as i64 {
        // D-111/D-112/T-06-22: refused OUT LOUD, never a silent drop — one event per refusal, so
        // the trail records what was turned away (the refused proposal's own target type and
        // title), not merely that a refusal happened. No existence check before this append: that
        // would be an unindexed read on the refusal path for no gain.
        let sequence = next_sequence(tx, &project_id, "local")?;
        let event_payload = serde_json::json!({
            "field": "authoring_proposal",
            "limit": PROPOSAL_LIMIT_PER_RUN,
            "count": staged_count,
            "targetType": payload.target_type().as_str(),
            "title": payload.label(),
            "label": format!(
                "Refused a new {} proposal — this run already holds {staged_count} staged \
                 proposals (limit {PROPOSAL_LIMIT_PER_RUN})",
                payload.target_type().as_str()
            ),
        });
        append_event(
            tx,
            &project_id,
            "local",
            sequence,
            "agent_run",
            agent_run_id,
            run_task_id.as_deref(),
            epic_id.as_deref(),
            &actor_id,
            "proposal.limit_exhausted",
            &event_payload,
            now,
        )?;
        return Ok(ProposalOutcome::LimitExhausted { limit: PROPOSAL_LIMIT_PER_RUN, count: staged_count });
    }

    let tail_position: Option<String> = tx
        .query_row(
            "SELECT position FROM authoring_proposals \
             WHERE agent_run_id = ?1 AND parent_proposal_id IS ?2 \
             ORDER BY position DESC LIMIT 1",
            params![agent_run_id, parent_proposal_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the tail sibling's position")?;
    let position = rank_after(tail_position.as_deref())?;

    // WR-01 (plan 05-09 code review): the create path never enforced the same length/emptiness
    // bounds `amend_proposal` already does via this same `validate_payload` — an agent's
    // `propose_*` call (or a malformed inbound `proposal_created` event) could stage a row with
    // arbitrarily long text that would then materialise onto a canonical `tasks`/`epics`/
    // `acceptance_criteria` row unchecked. Validated here, before the INSERT, so every caller of
    // `create_proposal_in_tx` (both `create_proposal` and `apply_proposal_created`) gets the same
    // guarantee `amend_proposal` already has. Skipped for `Delete`: a delete proposal's payload is
    // a placeholder carrying the target's own type discriminant (see every `ProposalPayload::Task
    // { title: String::new(), .. }` delete-proposal construction in this crate's own tests) — the
    // content that actually matters for a delete is `target_id`, not the payload's text fields.
    if verb != ProposalVerb::Delete {
        validate_payload(&payload)?;
    }

    // Plan 06-01 (PROP-07): a `Some` rationale is validated exactly like the payload it
    // accompanies — non-empty after trimming, within MAX_PROPOSAL_RATIONALE_LEN — BEFORE the
    // INSERT, mirroring `validate_payload`'s own "no DB statement before every guard passes"
    // discipline. `None` (every authoring caller) is untouched.
    if let Some(rationale) = provenance.rationale.as_deref() {
        let trimmed = rationale.trim();
        anyhow::ensure!(!trimmed.is_empty(), "rationale must be non-empty after trimming");
        anyhow::ensure!(
            rationale.len() <= MAX_PROPOSAL_RATIONALE_LEN,
            "rationale must be at most {MAX_PROPOSAL_RATIONALE_LEN} characters, got {} characters",
            rationale.len()
        );
    }

    let id = new_id();
    let target_type = payload.target_type();
    let payload_json = serde_json::to_string(&payload).context("failed to serialise proposal payload")?;

    // Plan 06-04 (D-107): the duplicate flag is computed and written HERE — between identity
    // resolution above and the INSERT below — never in a follow-up UPDATE and never recomputed on
    // read. A detector error (or an FTS5 query-syntax rejection `duplicate_candidate_for` doesn't
    // already degrade internally) must not fail the staging call: `.ok().flatten()` mirrors this
    // same function's own `origin_log_offset` precedent a few lines above (`count_lines(...).ok()`)
    // — a scoring failure is not a reason to lose a real proposal.
    let (duplicate_title, duplicate_body) = payload.duplicate_search_text();
    let duplicate_candidate =
        crate::query::search::duplicate_candidate_for(tx, &project_id, None, duplicate_title, duplicate_body)
            .ok()
            .flatten();
    let (duplicate_of, duplicate_score): (Option<String>, Option<f64>) = match duplicate_candidate {
        Some(candidate) => (Some(candidate.id), Some(candidate.score)),
        None => (None, None),
    };

    tx.execute(
        "INSERT INTO authoring_proposals (
            id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
            parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
            created_by, created_at, decided_by, decided_at, rationale, origin_log_offset,
            duplicate_of, duplicate_score
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', NULL, NULL, ?11, ?12, NULL, \
            NULL, ?13, ?14, ?15, ?16)",
        params![
            id,
            agent_run_id,
            project_id,
            epic_id,
            verb.as_str(),
            target_type.as_str(),
            target_id,
            parent_proposal_id,
            position,
            payload_json,
            actor_id,
            now,
            provenance.rationale,
            provenance.origin_log_offset,
            duplicate_of,
            duplicate_score,
        ],
    )
    .context("failed to insert authoring_proposals row")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": null,
        "after": id,
        "verb": verb.as_str(),
        "targetType": target_type.as_str(),
        "label": format!("Proposed a new {}", target_type.as_str()),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "authoring_proposal",
        &id,
        None,
        epic_id.as_deref(),
        &actor_id,
        "proposal.created",
        &event_payload,
        now,
    )?;

    Ok(ProposalOutcome::Created(Proposal {
        id,
        agent_run_id: agent_run_id.to_string(),
        project_id,
        epic_id,
        verb: verb.as_str().to_string(),
        target_type: target_type.as_str().to_string(),
        target_id: target_id.map(str::to_string),
        parent_proposal_id: parent_proposal_id.map(str::to_string),
        position,
        payload,
        status: "pending".to_string(),
        rejection_reason: None,
        materialised_id: None,
        created_by: actor_id,
        created_at: now.to_string(),
        decided_by: None,
        decided_at: None,
        rationale: provenance.rationale,
        origin_log_offset: provenance.origin_log_offset,
        duplicate_of,
        duplicate_score,
    }))
}

/// What [`apply_proposal_created`] did with one inbound `proposal_created` event.
#[derive(Debug, Clone, PartialEq)]
pub enum ProposalOutcome {
    /// The event's `type` was not `proposal_created`, or it carried no `runId`, or the `runId` was
    /// not a well-formed ULID, or its content could not be parsed into a [`ProposalPayload`].
    /// Nothing was read from or written to the database.
    Ignored,
    /// The `runId` was a well-formed ULID, but it names no `agent_runs` row.
    UnknownRun,
    /// The run named by `runId` has already reached a terminal status.
    TerminalRun,
    /// One row was staged, attributed to the run's own project/epic/actor.
    Created(Proposal),
    /// Plan 06-05 (PROP-05, D-109/D-110/D-111): this run has already staged
    /// [`PROPOSAL_LIMIT_PER_RUN`] proposals — no row was inserted, and one
    /// `proposal.limit_exhausted` event was appended instead (still committed: a refusal is never
    /// a silent rollback). Carries both the fixed `limit` and the run's own observed `count` so
    /// the caller can name both in its refusal message without re-reading either.
    LimitExhausted { limit: usize, count: i64 },
}

/// Apply one inbound `proposal_created` event (the sidecar's own wire shape, mirroring
/// `domain::session_summary::apply_summary_reported`'s guard sequence exactly): wrong event type
/// is ignored, a missing `runId` is ignored, and a non-ULID `runId` is rejected with
/// [`ProposalOutcome::Ignored`] BEFORE any database statement is issued — a run id read off a
/// sidecar stdout line is exactly as trusted as any other value crossing that process boundary,
/// never more. `verb`/`targetType`/`payload` are read from the event; identity (`project_id`,
/// `epic_id`, the acting actor) is resolved ONLY from the `agent_runs` row the run id names,
/// exactly like [`create_proposal_in_tx`].
pub fn apply_proposal_created(
    conn: &mut Connection,
    event: &serde_json::Value,
) -> anyhow::Result<ProposalOutcome> {
    if event.get("type").and_then(|v| v.as_str()) != Some("proposal_created") {
        return Ok(ProposalOutcome::Ignored);
    }

    let Some(run_id) = event.get("runId").and_then(|v| v.as_str()) else {
        return Ok(ProposalOutcome::Ignored);
    };
    if !crate::ids::is_ulid(run_id) {
        return Ok(ProposalOutcome::Ignored);
    }

    let Some(verb_str) = event.get("verb").and_then(|v| v.as_str()) else {
        return Ok(ProposalOutcome::Ignored);
    };
    let Ok(verb) = ProposalVerb::from_db_str(verb_str) else {
        return Ok(ProposalOutcome::Ignored);
    };

    let Some(payload_value) = event.get("payload") else {
        return Ok(ProposalOutcome::Ignored);
    };
    let Ok(payload) = serde_json::from_value::<ProposalPayload>(payload_value.clone()) else {
        return Ok(ProposalOutcome::Ignored);
    };
    // WR-01: an inbound event whose payload parses but fails the same length/emptiness bounds
    // `amend_proposal` already enforces is malformed input crossing a process boundary, treated
    // exactly like every other guard above it — Ignored, never a panic, never a stored row.
    // `create_proposal_in_tx` also validates internally (defense in depth for its other caller,
    // `create_proposal`), but checking here BEFORE opening a transaction keeps this function's own
    // established "no DB statement before every guard passes" shape. Skipped for `Delete`, same
    // placeholder-payload reason `create_proposal_in_tx` skips it.
    if verb != ProposalVerb::Delete && validate_payload(&payload).is_err() {
        return Ok(ProposalOutcome::Ignored);
    }

    let target_id = event.get("targetId").and_then(|v| v.as_str());
    let parent_proposal_id = event.get("parentProposalId").and_then(|v| v.as_str());
    // Plan 06-01 (PROP-07, T-06-02): `rationale` is read off the event's TOP LEVEL (never out of
    // `payload`) — carried on the outer wire shape exactly like `mcp-permission-server.ts`'s
    // `AuthoringProposalPayload.rationale` doc comment states of itself. `None` for every
    // authoring-run event (the authoring write tools carry no such field).
    let rationale = event.get("rationale").and_then(|v| v.as_str()).map(str::to_string);

    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read agent_runs row before applying proposal_created")?;

    let Some(status) = status else {
        return Ok(ProposalOutcome::UnknownRun);
    };

    if matches!(status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
        return Ok(ProposalOutcome::TerminalRun);
    }

    // Plan 06-01 (PROP-07, T-06-02): the turn pointer is computed server-side from the run's own
    // durable session log, BEFORE `conn.transaction()` opens — so no filesystem read happens while
    // the write transaction holds the lock. Never read off the event: an agent's tool-call
    // arguments carry no sequence number, offset or identity of any kind (T-05-02-01's discipline,
    // extended here). A `count_lines` error degrades to `None` rather than failing the staging
    // call — a turn pointer is provenance, not a correctness requirement the whole call should
    // fail over.
    let origin_log_offset = crate::session_log::count_lines(run_id).ok().map(|n| n as i64);

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let provenance = ProposalProvenance { rationale, origin_log_offset };
    // Plan 06-05: `create_proposal_in_tx` now returns `ProposalOutcome` directly — `Created` or
    // `LimitExhausted` both forward unchanged, so this entry point never converts a refusal into
    // `Ignored` (which means something different: malformed input, never "over budget").
    let outcome = create_proposal_in_tx(
        &tx,
        run_id,
        verb,
        payload,
        target_id,
        parent_proposal_id,
        provenance,
        &now,
    )?;
    tx.commit()
        .context("failed to commit apply_proposal_created transaction")?;

    Ok(outcome)
}

/// What [`accept_proposal`] did.
#[derive(Debug, Clone, PartialEq)]
pub struct AcceptOutcome {
    pub proposal: Proposal,
    pub materialised_id: String,
}

/// A staged `amend`/`delete` (or a `create`/`criterion`'s parent link) names a canonical row that
/// no longer exists — because D-44's task deletion cascade, or some other path, ran underneath it
/// (`05-CONTEXT.md` Claude's Discretion). Never auto-rejected and never silently dropped (D-16):
/// this is a typed, downcastable error naming the missing row and its type, so the caller can
/// surface it as an explicit undecidable state rather than a generic failure.
#[derive(Debug, Clone, PartialEq)]
pub struct ProposalUndecidable {
    pub proposal_id: String,
    pub target_id: String,
    pub target_type: String,
}

impl std::fmt::Display for ProposalUndecidable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "authoring_proposal {:?} names a {} {:?} that no longer exists — undecidable, not \
             auto-rejected",
            self.proposal_id, self.target_type, self.target_id
        )
    }
}

impl std::error::Error for ProposalUndecidable {}

/// Read one `authoring_proposals` row by id, inside the caller's own transaction — the single
/// query every mutating function in this module reads through, so the 17-column projection has
/// exactly one shape here (mirrors [`PROPOSAL_COLUMNS`]'s own "one definition in the crate"
/// discipline).
fn fetch_proposal(tx: &Transaction, proposal_id: &str) -> anyhow::Result<Proposal> {
    let sql: String = ["SELECT ", PROPOSAL_COLUMNS, " FROM authoring_proposals WHERE id = ?1"].concat();
    tx.query_row(&sql, params![proposal_id], row_to_proposal)
        .with_context(|| format!("authoring_proposal {proposal_id:?} not found"))
}

/// `target_id` exists in the canonical table its `target_type` names — cardinality-one, no
/// `LIMIT` needed. An `Assumption` target has no canonical table at all (an accepted assumption
/// never materialises a board row — see [`materialise_proposal`]), so it is vacuously present.
fn target_row_exists(tx: &Transaction, target_type: ProposalTargetType, target_id: &str) -> anyhow::Result<bool> {
    let exists: Option<i64> = match target_type {
        ProposalTargetType::Task => tx
            .query_row("SELECT 1 FROM tasks WHERE id = ?1", params![target_id], |row| row.get(0))
            .optional()?,
        ProposalTargetType::Epic => tx
            .query_row("SELECT 1 FROM epics WHERE id = ?1", params![target_id], |row| row.get(0))
            .optional()?,
        ProposalTargetType::Criterion => tx
            .query_row(
                "SELECT 1 FROM acceptance_criteria WHERE id = ?1",
                params![target_id],
                |row| row.get(0),
            )
            .optional()?,
        ProposalTargetType::Assumption => return Ok(true),
        // Plan 06-01: no `amend`/`delete` path reaches an `issue` target in this plan (an
        // execution-run's `propose_item` call only ever builds `verb: "create"`), but this match
        // must stay exhaustive over every `ProposalTargetType` regardless of which verb combination
        // is reachable today — `issues` is a real canonical table since `0002_board_schema.sql`,
        // so this arm is a genuine check, not a placeholder.
        ProposalTargetType::Issue => tx
            .query_row("SELECT 1 FROM issues WHERE id = ?1", params![target_id], |row| row.get(0))
            .optional()?,
    };
    Ok(exists.is_some())
}

fn ensure_target_exists(
    tx: &Transaction,
    proposal: &Proposal,
    target_type: ProposalTargetType,
    target_id: &str,
) -> anyhow::Result<()> {
    if target_row_exists(tx, target_type, target_id)? {
        Ok(())
    } else {
        Err(ProposalUndecidable {
            proposal_id: proposal.id.clone(),
            target_id: target_id.to_string(),
            target_type: target_type.as_str().to_string(),
        }
        .into())
    }
}

fn require_target<'a>(proposal: &'a Proposal) -> anyhow::Result<&'a str> {
    proposal
        .target_id
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("{} proposal {:?} carries no target_id", proposal.verb, proposal.id))
}

/// Materialise one proposal's content into the canonical table its `target_type` names, through
/// the writer that already owns that table — never a local `INSERT`/`UPDATE` of this module's own
/// (T-05-02-03, extended here to every verb/target_type combination). `parent_outcome` is `Some`
/// only for a `create`/`criterion` proposal whose `parent_proposal_id` was just accepted (or was
/// already accepted) by the caller — see [`accept_proposal_in_tx`]'s implied-parent walk.
fn materialise_proposal(
    tx: &Transaction,
    proposal: &Proposal,
    parent_outcome: Option<&AcceptOutcome>,
    now: &str,
) -> anyhow::Result<String> {
    match (proposal.verb.as_str(), &proposal.payload) {
        ("create", ProposalPayload::Task { title, .. }) => {
            let epic_id = proposal.epic_id.as_deref();
            let task = crate::domain::task::create_task_in_tx(
                tx,
                &proposal.project_id,
                &proposal.created_by,
                title,
                epic_id,
                now,
            )?;
            Ok(task.id)
        }
        ("create", ProposalPayload::Epic { title, description }) => {
            let epic = crate::domain::epic::create_epic_in_tx(
                tx,
                &proposal.project_id,
                &proposal.created_by,
                title,
                description.as_deref(),
                now,
            )?;
            Ok(epic.id)
        }
        ("create", ProposalPayload::Criterion { statement, verification_hint }) => {
            let parent = parent_outcome.ok_or_else(|| {
                anyhow::anyhow!("criterion proposal {:?} carries no parent_proposal_id", proposal.id)
            })?;
            let parent_type = parent.proposal.target_type.as_str();
            anyhow::ensure!(
                matches!(parent_type, "task" | "epic"),
                "criterion proposal {:?}'s parent proposal targets {parent_type:?}, expected task \
                 or epic",
                proposal.id
            );
            let criterion = crate::domain::acceptance_criterion::create_criterion_in_tx(
                tx,
                &proposal.project_id,
                &proposal.created_by,
                parent_type,
                &parent.materialised_id,
                statement,
                verification_hint.as_deref(),
                now,
            )?;
            Ok(criterion.id)
        }
        // D-89: an accepted assumption is reasoning about the epic, not an item on it — accepted
        // staging history is the whole record, so there is no canonical row to point at.
        // `materialised_id` self-references the proposal's own id, which is what makes a second
        // accept idempotent (the "already accepted" branch in `accept_proposal_in_tx` reads it
        // back unchanged).
        ("create", ProposalPayload::Assumption { .. }) => Ok(proposal.id.clone()),
        // D-97 (plan 06-03): accepting a proposed issue mints ONE top-level `issues` row —
        // `IssueParent::None` — through the same canonical writer `merge_proposal_in_tx` calls
        // below. This is a SEPARATE call site from the merge path (06-RESEARCH.md Pitfall 5): the
        // two are never conflated into one function that branches on how it was triggered.
        ("create", ProposalPayload::Issue { title, body, issue_kind }) => {
            let issue = crate::domain::issue::create_issue_in_tx(
                tx,
                &proposal.project_id,
                &proposal.created_by,
                title,
                body.as_deref(),
                issue_kind,
                crate::domain::issue::IssueParent::None,
                now,
            )?;
            Ok(issue.id)
        }
        ("amend", ProposalPayload::Criterion { statement, verification_hint }) => {
            let target_id = require_target(proposal)?;
            ensure_target_exists(tx, proposal, ProposalTargetType::Criterion, target_id)?;
            // T-05-06-02: the ONLY mechanism through which an amend reaches a criterion — never a
            // local `UPDATE acceptance_criteria` — so the lock check and the revision chain stay
            // this module's single source of truth.
            let criterion = crate::domain::acceptance_criterion::revise_criterion_in_tx(
                tx,
                &proposal.created_by,
                target_id,
                statement,
                verification_hint.as_deref(),
                now,
            )?;
            Ok(criterion.id)
        }
        ("amend", ProposalPayload::Task { title, description }) => {
            let target_id = require_target(proposal)?;
            ensure_target_exists(tx, proposal, ProposalTargetType::Task, target_id)?;
            crate::domain::task::update_task_in_tx(
                tx,
                &proposal.created_by,
                target_id,
                Some(title.as_str()),
                description.as_deref(),
                now,
            )?;
            Ok(target_id.to_string())
        }
        ("amend", ProposalPayload::Epic { title, description }) => {
            let target_id = require_target(proposal)?;
            ensure_target_exists(tx, proposal, ProposalTargetType::Epic, target_id)?;
            crate::domain::epic::update_epic_in_tx(
                tx,
                &proposal.created_by,
                target_id,
                Some(title.as_str()),
                description.as_deref(),
                now,
            )?;
            Ok(target_id.to_string())
        }
        ("delete", _) => {
            let target_id = require_target(proposal)?;
            match proposal.target_type.as_str() {
                "task" => {
                    ensure_target_exists(tx, proposal, ProposalTargetType::Task, target_id)?;
                    crate::domain::task::delete_task_in_tx(tx, &proposal.created_by, target_id, now)?;
                }
                "epic" => {
                    ensure_target_exists(tx, proposal, ProposalTargetType::Epic, target_id)?;
                    crate::domain::epic::delete_epic_in_tx(tx, &proposal.created_by, target_id, now)?;
                }
                "criterion" => {
                    ensure_target_exists(tx, proposal, ProposalTargetType::Criterion, target_id)?;
                    crate::domain::acceptance_criterion::delete_criterion_in_tx(
                        tx,
                        &proposal.created_by,
                        target_id,
                        now,
                    )?;
                }
                other => anyhow::bail!("cannot delete a {other:?} target"),
            }
            Ok(target_id.to_string())
        }
        (verb, payload) => anyhow::bail!(
            "accepting a {verb:?} proposal for {:?} is not supported",
            payload.target_type().as_str()
        ),
    }
}

/// Accept one proposal, inside a transaction the caller already owns — [`accept_proposal`] and
/// [`accept_subtree`] both call this, so the implied-parent walk and the idempotent-already-
/// accepted branch exist in exactly one place. Reads the row FRESH from the database every call
/// (never trusts a caller-supplied copy), so a self-recursive implied-parent walk always sees the
/// parent's just-written status.
///
/// D-96's implied-parent accept: when `parent_proposal_id` names a still-`pending` proposal, that
/// parent is accepted FIRST, in this SAME transaction, before this proposal materialises — so the
/// tree this builds can never reference a row that does not exist. Only a criterion may carry a
/// parent, and only a task or epic proposal may BE one (T-05-06-07), so this recursion is bounded
/// to depth one by construction, not by a counter.
///
/// An already-`accepted` proposal is a no-op: the existing `materialised_id` is returned unchanged,
/// no second canonical row is written, and no second `proposal.accepted` event is appended. Any
/// other non-`pending` status (i.e. `rejected`) is an error naming that status — a decided row is
/// terminal (D-83).
fn accept_proposal_in_tx(
    tx: &Transaction,
    proposal_id: &str,
    human_actor_id: &str,
    now: &str,
) -> anyhow::Result<AcceptOutcome> {
    let proposal = fetch_proposal(tx, proposal_id)?;

    if proposal.status == "accepted" {
        let materialised_id = proposal.materialised_id.clone().ok_or_else(|| {
            anyhow::anyhow!("authoring_proposal {proposal_id:?} is accepted but carries no materialised_id")
        })?;
        return Ok(AcceptOutcome { proposal, materialised_id });
    }
    anyhow::ensure!(
        proposal.status == "pending",
        "authoring_proposal {proposal_id:?} is not pending (status = {:?})",
        proposal.status
    );

    let parent_outcome = match &proposal.parent_proposal_id {
        Some(parent_id) => Some(accept_proposal_in_tx(tx, parent_id, human_actor_id, now)?),
        None => None,
    };

    let materialised_id = materialise_proposal(tx, &proposal, parent_outcome.as_ref(), now)?;

    tx.execute(
        "UPDATE authoring_proposals SET status = 'accepted', materialised_id = ?1, \
         decided_by = ?2, decided_at = ?3 WHERE id = ?4",
        params![materialised_id, human_actor_id, now, proposal_id],
    )
    .context("failed to mark authoring_proposal accepted")?;

    let sequence = next_sequence(tx, &proposal.project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": "pending",
        "after": "accepted",
        "materialisedId": materialised_id,
        "label": format!("Accepted a {} proposal", proposal.target_type),
    });
    append_event(
        tx,
        &proposal.project_id,
        "local",
        sequence,
        "authoring_proposal",
        proposal_id,
        None,
        proposal.epic_id.as_deref(),
        human_actor_id,
        "proposal.accepted",
        &event_payload,
        now,
    )?;

    let mut accepted_proposal = proposal;
    accepted_proposal.status = "accepted".to_string();
    accepted_proposal.materialised_id = Some(materialised_id.clone());
    accepted_proposal.decided_by = Some(human_actor_id.to_string());
    accepted_proposal.decided_at = Some(now.to_string());

    Ok(AcceptOutcome { proposal: accepted_proposal, materialised_id })
}

/// Accept a pending proposal (D-92, D-96) across every verb and target type. In ONE transaction:
/// reads the pending row (and, per D-96, any still-pending ancestor), materialises it through the
/// canonical writer its `target_type` already owns, sets `status = 'accepted'`, `materialised_id`,
/// `decided_by` and `decided_at`, and appends one `proposal.accepted` event. The row is never
/// deleted (D-83). The **human** actor supplied here is recorded as `decided_by`; `created_by`
/// stays the proposing agent actor untouched — the audit trail's whole point.
///
/// Accepting an already-accepted proposal is a no-op returning the existing `materialised_id`.
/// Accepting a proposal whose `target_id` names a row that no longer exists returns
/// [`ProposalUndecidable`]. See [`accept_proposal_in_tx`] for the full contract.
pub fn accept_proposal(
    conn: &mut Connection,
    proposal_id: &str,
    human_actor_id: &str,
) -> anyhow::Result<AcceptOutcome> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let outcome = accept_proposal_in_tx(&tx, proposal_id, human_actor_id, &now)?;
    tx.commit().context("failed to commit accept_proposal transaction")?;
    Ok(outcome)
}

/// The at-most-one-parent-at-a-time target [`merge_proposal`] attaches a child issue to —
/// mirrors [`crate::domain::issue::IssueParent`]'s own guarantee (`Task`/`Epic`, never both) so a
/// caller cannot name two parents for the same merge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeTarget {
    Task(String),
    Epic(String),
}

impl MergeTarget {
    fn target_type(&self) -> ProposalTargetType {
        match self {
            MergeTarget::Task(_) => ProposalTargetType::Task,
            MergeTarget::Epic(_) => ProposalTargetType::Epic,
        }
    }

    fn target_id(&self) -> &str {
        match self {
            MergeTarget::Task(id) | MergeTarget::Epic(id) => id,
        }
    }

    fn as_issue_parent(&self) -> crate::domain::issue::IssueParent {
        match self {
            MergeTarget::Task(id) => crate::domain::issue::IssueParent::Task(id.clone()),
            MergeTarget::Epic(id) => crate::domain::issue::IssueParent::Epic(id.clone()),
        }
    }
}

/// What [`merge_proposal`] did (D-101) — the decided [`Proposal`] plus the id of the child
/// `issues` row it created, mirroring [`AcceptOutcome`]'s shape.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeOutcome {
    pub proposal: Proposal,
    pub issue_id: String,
}

/// Build the merged issue's body from the proposal's own description/body AND its `rationale`
/// (D-101's `<behavior>`) as two discrete labelled parts — never one prose blob that loses which
/// is which. Either part may be absent (an authoring-session proposal carries no `rationale`;
/// a description/body is itself optional); the result is `None` only when both are absent.
fn build_merged_issue_body(description: Option<&str>, rationale: Option<&str>) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(description) = description {
        parts.push(format!("Description: {description}"));
    }
    if let Some(rationale) = rationale {
        parts.push(format!("Rationale: {rationale}"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

/// Merge one proposal into `target`, inside a transaction the caller already owns — mirrors
/// [`accept_proposal_in_tx`]'s shape exactly. Reads the row FRESH (never trusts a caller-supplied
/// copy). A proposal already `merged` is idempotent: the recorded `issue_id` is returned
/// unchanged rather than creating a second issue. Any other non-`pending` status (`accepted`,
/// `rejected`, `deferred`) is refused — a decided row is terminal (D-83), and a proposal already
/// materialised through a DIFFERENT path has no `issue_id` this outcome could honestly report.
fn merge_proposal_in_tx(
    tx: &Transaction,
    actor_id: &str,
    proposal_id: &str,
    target: &MergeTarget,
    now: &str,
) -> anyhow::Result<MergeOutcome> {
    let proposal = fetch_proposal(tx, proposal_id)?;

    if proposal.status == "merged" {
        let issue_id = proposal.materialised_id.clone().ok_or_else(|| {
            anyhow::anyhow!(
                "authoring_proposal {proposal_id:?} is merged but carries no materialised_id"
            )
        })?;
        return Ok(MergeOutcome { proposal, issue_id });
    }
    anyhow::ensure!(
        proposal.status == "pending",
        "authoring_proposal {proposal_id:?} is not pending (status = {:?}) — a decided proposal \
         cannot be merged",
        proposal.status
    );

    ensure_target_exists(tx, &proposal, target.target_type(), target.target_id())?;

    let (title, description, issue_kind): (&str, Option<&str>, &str) = match &proposal.payload {
        ProposalPayload::Task { title, description } => (title.as_str(), description.as_deref(), "idea"),
        ProposalPayload::Epic { title, description } => (title.as_str(), description.as_deref(), "idea"),
        ProposalPayload::Issue { title, body, issue_kind } => {
            (title.as_str(), body.as_deref(), issue_kind.as_str())
        }
        other => anyhow::bail!(
            "cannot merge a {:?} proposal — merge accepts only task, epic or issue payloads",
            other.target_type().as_str()
        ),
    };
    let body = build_merged_issue_body(description, proposal.rationale.as_deref());

    let issue = crate::domain::issue::create_issue_in_tx(
        tx,
        &proposal.project_id,
        actor_id,
        title,
        body.as_deref(),
        issue_kind,
        target.as_issue_parent(),
        now,
    )?;

    tx.execute(
        "UPDATE authoring_proposals SET status = 'merged', materialised_id = ?1, decided_by = ?2, \
         decided_at = ?3 WHERE id = ?4",
        params![issue.id, actor_id, now, proposal_id],
    )
    .context("failed to mark authoring_proposal merged")?;

    let sequence = next_sequence(tx, &proposal.project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": "pending",
        "after": "merged",
        "targetType": target.target_type().as_str(),
        "targetId": target.target_id(),
        "materialisedId": issue.id,
        "label": format!("Merged a {} proposal into {}", proposal.target_type, target.target_id()),
    });
    append_event(
        tx,
        &proposal.project_id,
        "local",
        sequence,
        "authoring_proposal",
        proposal_id,
        None,
        proposal.epic_id.as_deref(),
        actor_id,
        "proposal.merged",
        &event_payload,
        now,
    )?;

    let mut merged = proposal;
    merged.status = "merged".to_string();
    merged.materialised_id = Some(issue.id.clone());
    merged.decided_by = Some(actor_id.to_string());
    merged.decided_at = Some(now.to_string());

    Ok(MergeOutcome { proposal: merged, issue_id: issue.id })
}

/// Merge a pending task or epic (or issue) proposal into an existing task or epic (D-101): creates
/// one child `issues` row under `target` through the canonical writer that table already owns,
/// setting `status = 'merged'` and `materialised_id` to the new issue's id. The target row's own
/// columns are never touched — no `UPDATE tasks`/`epics` is issued anywhere on this path. Merging
/// an already-merged proposal is idempotent; merging into a target that no longer exists returns
/// [`ProposalUndecidable`]. See [`merge_proposal_in_tx`] for the full contract.
pub fn merge_proposal(
    conn: &mut Connection,
    actor_id: &str,
    proposal_id: &str,
    target: &MergeTarget,
) -> anyhow::Result<MergeOutcome> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let outcome = merge_proposal_in_tx(&tx, actor_id, proposal_id, target, &now)?;
    tx.commit().context("failed to commit merge_proposal transaction")?;
    Ok(outcome)
}

/// Defer a proposal, inside a transaction the caller already owns (D-102). Mints nothing in any
/// canonical table — the whole point of a defer pile that never becomes backlog spam. Idempotent
/// on an already-`deferred` row (returned unchanged, no second event); refused on any other
/// non-`pending` status, naming the current status.
fn defer_proposal_in_tx(
    tx: &Transaction,
    actor_id: &str,
    proposal_id: &str,
    now: &str,
) -> anyhow::Result<Proposal> {
    let existing = fetch_proposal(tx, proposal_id)?;

    if existing.status == "deferred" {
        return Ok(existing);
    }
    anyhow::ensure!(
        existing.status == "pending",
        "authoring_proposal {proposal_id:?} is not pending (status = {:?}) — a decided proposal \
         cannot be deferred",
        existing.status
    );

    tx.execute(
        "UPDATE authoring_proposals SET status = 'deferred', decided_by = ?1, decided_at = ?2 \
         WHERE id = ?3",
        params![actor_id, now, proposal_id],
    )
    .context("failed to mark authoring_proposal deferred")?;

    let sequence = next_sequence(tx, &existing.project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": "pending",
        "after": "deferred",
        "label": format!("Deferred a {} proposal", existing.target_type),
    });
    append_event(
        tx,
        &existing.project_id,
        "local",
        sequence,
        "authoring_proposal",
        proposal_id,
        None,
        existing.epic_id.as_deref(),
        actor_id,
        "proposal.deferred",
        &event_payload,
        now,
    )?;

    let mut deferred = existing;
    deferred.status = "deferred".to_string();
    deferred.decided_by = Some(actor_id.to_string());
    deferred.decided_at = Some(now.to_string());
    Ok(deferred)
}

/// Defer a pending proposal (D-102): moves it out of the pending queue to `status = 'deferred'`,
/// mints no row in any canonical table, and stays recallable — it joins the already-decided set a
/// later triage run is primed with. Deferring an already-deferred proposal is idempotent;
/// deferring an accepted, rejected or merged proposal is refused, naming the current status.
pub fn defer_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str) -> anyhow::Result<Proposal> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let proposal = defer_proposal_in_tx(&tx, actor_id, proposal_id, &now)?;
    tx.commit().context("failed to commit defer_proposal transaction")?;
    Ok(proposal)
}

/// Reject a pending proposal, inside a transaction the caller already owns — factored out so
/// [`reject_proposals_bulk`] can loop it over a bounded set in ONE transaction, mirroring
/// [`accept_proposal_in_tx`]'s/[`defer_proposal_in_tx`]'s identical factoring reason. Sets
/// `status = 'rejected'`, records the optional `reason` and the deciding actor, appends one
/// `proposal.rejected` event. Rejecting an already-decided proposal is an error naming the
/// existing status, never a silent overwrite of an earlier decision.
fn reject_proposal_in_tx(
    tx: &Transaction,
    proposal_id: &str,
    human_actor_id: &str,
    reason: Option<&str>,
    now: &str,
) -> anyhow::Result<Proposal> {
    let existing = fetch_proposal(tx, proposal_id)?;
    anyhow::ensure!(
        existing.status == "pending",
        "authoring_proposal {proposal_id:?} is not pending (status = {:?}) — a decided proposal \
         cannot be rejected a second time",
        existing.status
    );

    tx.execute(
        "UPDATE authoring_proposals SET status = 'rejected', rejection_reason = ?1, \
         decided_by = ?2, decided_at = ?3 WHERE id = ?4",
        params![reason, human_actor_id, now, proposal_id],
    )
    .context("failed to mark authoring_proposal rejected")?;

    let sequence = next_sequence(tx, &existing.project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": "pending",
        "after": "rejected",
        "reason": reason,
        "label": format!("Rejected a {} proposal", existing.target_type),
    });
    append_event(
        tx,
        &existing.project_id,
        "local",
        sequence,
        "authoring_proposal",
        proposal_id,
        None,
        existing.epic_id.as_deref(),
        human_actor_id,
        "proposal.rejected",
        &event_payload,
        now,
    )?;

    let mut rejected = existing;
    rejected.status = "rejected".to_string();
    rejected.rejection_reason = reason.map(str::to_string);
    rejected.decided_by = Some(human_actor_id.to_string());
    rejected.decided_at = Some(now.to_string());
    Ok(rejected)
}

/// Reject a pending proposal (D-93). One transaction: sets `status = 'rejected'`, records the
/// optional `reason` and the deciding human actor, appends one `proposal.rejected` event, and
/// leaves the row in place forever (D-83) — never deleted, never overwritten again. Rejecting a
/// proposal with pending children does not touch them: a drafted criterion under a rejected task
/// stays `pending` and decidable on its own (D-92's per-row granularity). Rejecting an
/// already-decided proposal is an error naming the existing status, never a silent overwrite of
/// an earlier decision. The caller (the command layer) is responsible for relaying this decision
/// to the live session as an `authoring_turn` via [`crate::domain::authoring_session::render_decision_turn`]
/// — this function is DB-only, exactly like [`accept_proposal`].
pub fn reject_proposal(
    conn: &mut Connection,
    proposal_id: &str,
    human_actor_id: &str,
    reason: Option<&str>,
) -> anyhow::Result<Proposal> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let rejected = reject_proposal_in_tx(&tx, proposal_id, human_actor_id, reason, &now)?;
    tx.commit().context("failed to commit reject_proposal transaction")?;
    Ok(rejected)
}

/// What [`amend_proposal`] did — the amended [`Proposal`] plus the label its PRE-amendment payload
/// carried, which the command layer needs to render D-94's decision turn (the wording names both
/// what the agent originally proposed and what the developer replaced it with) without a second
/// read racing this one's write.
#[derive(Debug, Clone, PartialEq)]
pub struct AmendOutcome {
    pub original_label: String,
    pub proposal: Proposal,
}

const MAX_PROPOSAL_TITLE_LEN: usize = 500;
const MAX_PROPOSAL_TEXT_LEN: usize = 1000;

/// Validate an amended payload with the same rules the tool schemas apply (D-81's action text):
/// non-empty title/statement/assumption, length bounds matching `commands/epic.rs`'s
/// `MAX_TITLE_LEN` (500) and `commands/criterion.rs`'s `MAX_STATEMENT_LEN`/`MAX_HINT_LEN` (1000) —
/// so an amendment cannot introduce text the agent's own tool would have been refused for
/// (T-05-06-05).
fn validate_payload(payload: &ProposalPayload) -> anyhow::Result<()> {
    match payload {
        ProposalPayload::Epic { title, description } | ProposalPayload::Task { title, description } => {
            anyhow::ensure!(
                !title.is_empty() && title.len() <= MAX_PROPOSAL_TITLE_LEN,
                "title must be 1-{MAX_PROPOSAL_TITLE_LEN} characters, got {} characters",
                title.len()
            );
            if let Some(d) = description {
                anyhow::ensure!(
                    d.len() <= MAX_PROPOSAL_TEXT_LEN,
                    "description must be at most {MAX_PROPOSAL_TEXT_LEN} characters, got {} characters",
                    d.len()
                );
            }
        }
        ProposalPayload::Criterion { statement, verification_hint } => {
            anyhow::ensure!(
                !statement.is_empty() && statement.len() <= MAX_PROPOSAL_TEXT_LEN,
                "statement must be 1-{MAX_PROPOSAL_TEXT_LEN} characters, got {} characters",
                statement.len()
            );
            if let Some(h) = verification_hint {
                anyhow::ensure!(
                    h.len() <= MAX_PROPOSAL_TEXT_LEN,
                    "verification hint must be at most {MAX_PROPOSAL_TEXT_LEN} characters, got {} \
                     characters",
                    h.len()
                );
            }
        }
        ProposalPayload::Assumption { assumption, answer } => {
            anyhow::ensure!(
                !assumption.is_empty() && assumption.len() <= MAX_PROPOSAL_TEXT_LEN,
                "assumption must be 1-{MAX_PROPOSAL_TEXT_LEN} characters, got {} characters",
                assumption.len()
            );
            anyhow::ensure!(
                answer.len() <= MAX_PROPOSAL_TEXT_LEN,
                "answer must be at most {MAX_PROPOSAL_TEXT_LEN} characters, got {} characters",
                answer.len()
            );
        }
        // Plan 06-01 (D-97/D-98): the recorded answer to the issues-payload-shape discretion
        // item — `title` gets the same bound every other title-carrying variant does, `body` gets
        // the same bound every other description-carrying variant does, and `issue_kind` must be
        // one of ISSUE_KINDS (mirroring the MCP tool schema's own `kind` enum).
        ProposalPayload::Issue { title, body, issue_kind } => {
            anyhow::ensure!(
                !title.is_empty() && title.len() <= MAX_PROPOSAL_TITLE_LEN,
                "title must be 1-{MAX_PROPOSAL_TITLE_LEN} characters, got {} characters",
                title.len()
            );
            if let Some(b) = body {
                anyhow::ensure!(
                    b.len() <= MAX_PROPOSAL_TEXT_LEN,
                    "body must be at most {MAX_PROPOSAL_TEXT_LEN} characters, got {} characters",
                    b.len()
                );
            }
            anyhow::ensure!(
                ISSUE_KINDS.contains(&issue_kind.as_str()),
                "issue_kind must be one of {ISSUE_KINDS:?}, got {issue_kind:?}"
            );
        }
    }
    Ok(())
}

/// Amend a pending proposal (D-94) — edit the staged row's `payload` and leave it `pending`. The
/// board receives nothing at this moment: amending does not accept. `payload`'s `target_type` must
/// match the proposal's existing one (an amend corrects the drafted content, never repurposes the
/// row to a different kind of thing). The event carries BOTH the agent's original payload and the
/// developer's replacement (D-19's human-renderable trail), so the activity trail shows what
/// changed, not only the end state. Amending an already-decided proposal is an error, mirroring
/// [`reject_proposal`]'s identical discipline. The caller relays this to the live session via
/// [`crate::domain::authoring_session::render_decision_turn`] — this function is DB-only.
pub fn amend_proposal(
    conn: &mut Connection,
    proposal_id: &str,
    human_actor_id: &str,
    payload: ProposalPayload,
) -> anyhow::Result<AmendOutcome> {
    validate_payload(&payload)?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing = fetch_proposal(&tx, proposal_id)?;
    anyhow::ensure!(
        existing.status == "pending",
        "authoring_proposal {proposal_id:?} is not pending (status = {:?}) — a decided proposal \
         cannot be amended",
        existing.status
    );
    anyhow::ensure!(
        payload.target_type() == existing.payload.target_type(),
        "amend_proposal cannot change a proposal's target type ({:?} -> {:?})",
        existing.payload.target_type().as_str(),
        payload.target_type().as_str()
    );

    let original_label = existing.payload.label().to_string();
    let original_payload_json =
        serde_json::to_value(&existing.payload).unwrap_or(serde_json::Value::Null);
    let new_payload_json = serde_json::to_value(&payload).unwrap_or(serde_json::Value::Null);
    let payload_json = serde_json::to_string(&payload).context("failed to serialise amended payload")?;

    // Plan 06-04 (D-107): re-score the amended content the same way staging does — `Some(proposal_id)`
    // as the exclusion so this proposal's OWN row (which still carries its pre-amendment payload
    // until the UPDATE below commits) never matches itself. Written in the SAME UPDATE that already
    // exists here, never a second statement; a detector error degrades to NULL, mirroring
    // `create_proposal_in_tx`'s identical `.ok().flatten()` precedent.
    let (duplicate_title, duplicate_body) = payload.duplicate_search_text();
    let duplicate_candidate = crate::query::search::duplicate_candidate_for(
        &tx,
        &existing.project_id,
        Some(proposal_id),
        duplicate_title,
        duplicate_body,
    )
    .ok()
    .flatten();
    let (duplicate_of, duplicate_score): (Option<String>, Option<f64>) = match duplicate_candidate {
        Some(candidate) => (Some(candidate.id), Some(candidate.score)),
        None => (None, None),
    };

    tx.execute(
        "UPDATE authoring_proposals SET payload = ?1, duplicate_of = ?2, duplicate_score = ?3 WHERE id = ?4",
        params![payload_json, duplicate_of, duplicate_score, proposal_id],
    )
    .context("failed to amend authoring_proposal payload")?;

    let sequence = next_sequence(&tx, &existing.project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "payload",
        "before": original_payload_json,
        "after": new_payload_json,
        "label": format!("Amended a {} proposal", existing.target_type),
    });
    append_event(
        &tx,
        &existing.project_id,
        "local",
        sequence,
        "authoring_proposal",
        proposal_id,
        None,
        existing.epic_id.as_deref(),
        human_actor_id,
        "proposal.amended",
        &event_payload,
        &now,
    )?;

    tx.commit().context("failed to commit amend_proposal transaction")?;

    let mut amended = existing;
    amended.payload = payload;
    amended.duplicate_of = duplicate_of;
    amended.duplicate_score = duplicate_score;
    Ok(AmendOutcome { original_label, proposal: amended })
}

/// What [`accept_subtree`] did (D-95) — how many rows were newly accepted in this call (the root
/// plus every pending drafted criterion under it) versus how many were already decided and
/// skipped, so the surface can say what happened rather than just refreshing.
#[derive(Debug, Clone, PartialEq)]
pub struct AcceptSubtreeOutcome {
    pub root_materialised_id: String,
    pub accepted_count: i64,
    pub skipped_count: i64,
}

/// Accept a subtree — a proposed task together with its drafted criteria (D-95, the ONE bulk path
/// this module offers). One transaction: the root task proposal first (so
/// [`accept_proposal_in_tx`]'s own implied-parent rule has nothing left to do for its children),
/// then every proposal whose `parent_proposal_id` is this root, in staging `position` order.
///
/// `root_proposal_id` MUST name a `task` proposal — any other `target_type` is refused with a
/// typed error, never generalised: the moment the subtree unit becomes "any node and its
/// descendants", a root at the epic level is a tray-wide accept-all wearing a different name
/// (D-95's own reasoning).
///
/// Already-decided members (the root or any child) are SKIPPED, not errors — a developer who
/// accepted one criterion individually and then reaches for the subtree action gets the rest, not
/// a refusal. A subtree that is already fully decided (root and every child) returns
/// `accepted_count: 0` and appends no event.
pub fn accept_subtree(
    conn: &mut Connection,
    root_proposal_id: &str,
    human_actor_id: &str,
) -> anyhow::Result<AcceptSubtreeOutcome> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let root = fetch_proposal(&tx, root_proposal_id)?;
    anyhow::ensure!(
        root.target_type == "task",
        "accept_subtree's root must be a task proposal, got a {:?} proposal",
        root.target_type
    );

    let mut accepted_count: i64 = 0;
    let mut skipped_count: i64 = 0;

    let root_materialised_id = if root.status == "pending" {
        let outcome = accept_proposal_in_tx(&tx, root_proposal_id, human_actor_id, &now)?;
        accepted_count += 1;
        outcome.materialised_id
    } else {
        skipped_count += 1;
        root.materialised_id.clone().ok_or_else(|| {
            anyhow::anyhow!("a decided task proposal {root_proposal_id:?} carries no materialised_id")
        })?
    };

    let children_sql: String = [
        "SELECT ",
        PROPOSAL_COLUMNS,
        " FROM authoring_proposals WHERE parent_proposal_id = ?1 ORDER BY position ASC, id ASC",
    ]
    .concat();
    let mut children_stmt = tx.prepare(&children_sql)?;
    let children: Vec<Proposal> = children_stmt
        .query_map(params![root_proposal_id], row_to_proposal)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the subtree's drafted criteria")?;
    drop(children_stmt);

    for child in children {
        if child.status != "pending" {
            skipped_count += 1;
            continue;
        }
        accept_proposal_in_tx(&tx, &child.id, human_actor_id, &now)?;
        accepted_count += 1;
    }

    tx.commit().context("failed to commit accept_subtree transaction")?;

    Ok(AcceptSubtreeOutcome { root_materialised_id, accepted_count, skipped_count })
}

/// The default and maximum row counts [`pending_proposals_for_run`] will ever return — the
/// `DEFAULT_LIMIT`/`MAX_LIMIT`/clamp idiom `commands/board.rs` establishes, applied here at the
/// domain layer from the first line rather than retrofitted (T-05-02-04).
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;

/// What a bulk triage verb did (D-104) — how many rows it decided versus how many it skipped
/// because they were already terminal, mirroring [`AcceptSubtreeOutcome`]'s identical
/// decided/skipped shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BulkDecisionOutcome {
    pub decided: usize,
    pub skipped: Vec<String>,
}

/// Reject every pending id in `proposal_ids`, in ONE transaction (D-104 — the first of the two
/// bulk paths this module offers; per D-104 no bulk-accept path exists at any layer, because
/// reject and defer are the two verbs safe to batch precisely because neither mints anything).
///
/// An empty slice returns a zero-count outcome without opening a transaction, writing a row or
/// appending an event. A slice longer than [`MAX_LIMIT`] is refused, naming the ceiling, rather
/// than silently truncated. Every other id is peeked with [`fetch_proposal`] before being decided:
/// an already-terminal id (accepted, rejected, merged or deferred) is collected into `skipped`
/// rather than failing the whole batch; every id actually decided goes through
/// [`reject_proposal_in_tx`], so `decided_by`/`decided_at` are set exactly as a single-row reject
/// would set them.
pub fn reject_proposals_bulk(
    conn: &mut Connection,
    actor_id: &str,
    proposal_ids: &[String],
    reason: Option<&str>,
) -> anyhow::Result<BulkDecisionOutcome> {
    anyhow::ensure!(
        (proposal_ids.len() as i64) <= MAX_LIMIT,
        "cannot bulk-reject more than {MAX_LIMIT} proposals at once, got {}",
        proposal_ids.len()
    );
    if proposal_ids.is_empty() {
        return Ok(BulkDecisionOutcome { decided: 0, skipped: Vec::new() });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let mut decided = 0usize;
    let mut skipped = Vec::new();

    for proposal_id in proposal_ids {
        let existing = fetch_proposal(&tx, proposal_id)?;
        if existing.status != "pending" {
            skipped.push(proposal_id.clone());
            continue;
        }
        reject_proposal_in_tx(&tx, proposal_id, actor_id, reason, &now)?;
        decided += 1;
    }

    tx.commit().context("failed to commit reject_proposals_bulk transaction")?;
    Ok(BulkDecisionOutcome { decided, skipped })
}

/// Defer every pending id in `proposal_ids`, in ONE transaction — behaves identically to
/// [`reject_proposals_bulk`] (D-104), looping [`defer_proposal_in_tx`] over the bounded set
/// instead. An already-`deferred` id is skipped exactly like any other already-terminal id here
/// (unlike a single-row [`defer_proposal`] call, which treats an already-deferred row as
/// idempotent rather than skipped) — a bulk call only ever counts ids it actually decided THIS
/// call as `decided`.
pub fn defer_proposals_bulk(
    conn: &mut Connection,
    actor_id: &str,
    proposal_ids: &[String],
) -> anyhow::Result<BulkDecisionOutcome> {
    anyhow::ensure!(
        (proposal_ids.len() as i64) <= MAX_LIMIT,
        "cannot bulk-defer more than {MAX_LIMIT} proposals at once, got {}",
        proposal_ids.len()
    );
    if proposal_ids.is_empty() {
        return Ok(BulkDecisionOutcome { decided: 0, skipped: Vec::new() });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let mut decided = 0usize;
    let mut skipped = Vec::new();

    for proposal_id in proposal_ids {
        let existing = fetch_proposal(&tx, proposal_id)?;
        if existing.status != "pending" {
            skipped.push(proposal_id.clone());
            continue;
        }
        defer_proposal_in_tx(&tx, actor_id, proposal_id, &now)?;
        decided += 1;
    }

    tx.commit().context("failed to commit defer_proposals_bulk transaction")?;
    Ok(BulkDecisionOutcome { decided, skipped })
}

/// Every pending proposal staged for `agent_run_id`, newest first — bounded per
/// `DEFAULT_LIMIT`/`MAX_LIMIT` regardless of what the caller requests: a `limit` of `0` or less
/// falls back to [`DEFAULT_LIMIT`], and any value is clamped to [`MAX_LIMIT`] before the query
/// runs (a caller-supplied 10,000,000 clamps to `MAX_LIMIT`, never reaches the database as-is).
pub fn pending_proposals_for_run(
    conn: &Connection,
    agent_run_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<Proposal>> {
    let resolved_limit = if limit <= 0 { DEFAULT_LIMIT } else { limit }.min(MAX_LIMIT);

    let sql = format!(
        "SELECT {PROPOSAL_COLUMNS} FROM authoring_proposals \
         WHERE agent_run_id = :run_id AND status = 'pending' \
         ORDER BY created_at DESC, id DESC LIMIT :limit"
    );
    let mut stmt = conn.prepare(&sql)?;
    let proposals = stmt
        .query_map(
            named_params! { ":run_id": agent_run_id, ":limit": resolved_limit },
            row_to_proposal,
        )?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read pending proposals for run")?;
    Ok(proposals)
}
