//! `start_authoring_run` / `current_stage` / `advance_stage` (D-84, D-88, D-90, plan 05-02): an
//! epic-authoring session's own lifecycle, sitting beside `domain::agent_run`'s task-execution
//! lifecycle rather than inside it — this module owns the stage vocabulary and the run's start,
//! `domain::agent_run` still owns everything about a run once it exists (the watchdog, the
//! heartbeat, cost tracking and reconciliation all apply unchanged, per D-84).
//!
//! D-88: the three-stage machine — `challenge -> decompose -> criteria` — is what makes "ask
//! before you plan" structural rather than a prompt instruction. During `challenge` there is
//! literally no proposal tool in the adapter's tool set (plan 05-03 wires that gate); this module
//! only carries the stage itself and the transition, so a plan asserting "no proposal row exists
//! before the stage advanced" has something to check the run's own row against.
//!
//! D-90: [`advance_stage`] takes a **human** actor id and has no agent-reachable caller anywhere
//! in this workspace — the agent may recommend advancing, but the human is the only one who calls
//! this function. A future tool handler must never call it directly; that would reopen the exact
//! failure D-88 exists to prevent.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::agent_run::{AgentRun, AgentRunStatus};
use crate::domain::event::{append_event, next_sequence};
use crate::domain::trigger::create_user_action_trigger_for_epic;
use crate::ids::new_id;
use crate::session_log::session_log_path;

/// D-88's three named stages — the single list every reader of `agent_runs.authoring_stage`
/// derives from. This constant and migration `0010_authoring_runs.sql`'s CHECK constraint are the
/// only two places these three names appear (mirroring `domain::WORKFLOW_STATES`'s own
/// single-list discipline).
pub const AUTHORING_STAGES: [&str; 3] = ["challenge", "decompose", "criteria"];

/// One value of D-88's stage machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoringStage {
    Challenge,
    Decompose,
    Criteria,
}

impl AuthoringStage {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthoringStage::Challenge => AUTHORING_STAGES[0],
            AuthoringStage::Decompose => AUTHORING_STAGES[1],
            AuthoringStage::Criteria => AUTHORING_STAGES[2],
        }
    }

    pub fn from_db_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "challenge" => Ok(AuthoringStage::Challenge),
            "decompose" => Ok(AuthoringStage::Decompose),
            "criteria" => Ok(AuthoringStage::Criteria),
            other => Err(anyhow::anyhow!("unknown authoring stage {other:?}")),
        }
    }

    /// D-90: the next stage in the fixed `challenge -> decompose -> criteria` order, or `None` at
    /// the last stage — there is nowhere further forward to go.
    fn next(self) -> Option<Self> {
        match self {
            AuthoringStage::Challenge => Some(AuthoringStage::Decompose),
            AuthoringStage::Decompose => Some(AuthoringStage::Criteria),
            AuthoringStage::Criteria => None,
        }
    }
}

/// Start a new epic-authoring session (D-84, D-86). Unlike [`crate::domain::agent_run::start_agent_run`],
/// this creates no worktree and touches no task status — D-86 runs the session in the project's
/// already-registered main checkout, which is not a worktree.
///
/// `epic_id` is `None` for a wholly fresh epic (SHAPE-01's own case) or `Some` for reopening an
/// existing one (SHAPE-05). In ONE transaction: creates a `user_action` trigger with
/// `target_task_id` NULL and `target_epic_id = epic_id` ([`create_user_action_trigger_for_epic`]),
/// inserts the `agent_runs` row with `task_id` NULL, `worktree_id` NULL,
/// `authoring_stage = 'challenge'` and `status = 'running'`, appends one `agent_run.started`
/// event whose payload names the subject in human-renderable prose (D-19), and — as the LAST step
/// before `commit` — writes the runtime stage marker (G-05-8(b)).
///
/// **Why the marker write belongs here, and not anywhere later:** `agent_runs.authoring_stage` and
/// the marker file are two representations of one fact, read by two different processes, and the
/// window in which they can disagree must be zero. This follows [`transition_stage`]'s own
/// ordering rule (T-05-03-05) exactly, rather than inventing a second one: write the marker as the
/// last step before `commit`, and bail BEFORE `commit` on a write failure so the transaction rolls
/// back and no row is left without its marker. Before this change, the two disagreed for the whole
/// of the challenge stage — the entire window during which `stage-gate-hook.ts` is supposed to be
/// denying `propose_*` calls with an actionable reason. A run that cannot record its stage must not
/// start; a permissive fallback here would silently reopen the exact gap G-05-8(b) closes.
pub fn start_authoring_run(
    conn: &mut Connection,
    project_id: &str,
    epic_id: Option<&str>,
    permission_mode: &str,
    human_actor_id: &str,
) -> anyhow::Result<AgentRun> {
    let agent_id = crate::domain::agent_run::agent_actor_id(conn)?;
    let now = Utc::now().to_rfc3339();
    let run_id = new_id();
    let log_path = session_log_path(&run_id)?.to_string_lossy().into_owned();

    let tx = conn.transaction()?;

    let trigger_id =
        create_user_action_trigger_for_epic(&tx, project_id, epic_id, human_actor_id, &now)?;

    tx.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', NULL, ?6, NULL, NULL, NULL, ?7, ?8, NULL, 'challenge')",
        params![run_id, epic_id, project_id, trigger_id, agent_id, permission_mode, log_path, now],
    )
    .context("failed to insert agent_runs row for an authoring run")?;

    let subject_label = match epic_id {
        Some(epic_id) => format!("Started an epic-authoring session for {epic_id}"),
        None => "Started an epic-authoring session for a new epic".to_string(),
    };
    let sequence = next_sequence(&tx, project_id, "local")?;
    let started_payload = serde_json::json!({
        "field": "agent_run",
        "before": null,
        "after": run_id,
        "label": subject_label,
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "agent_run",
        &run_id,
        None,
        epic_id,
        &agent_id,
        "agent_run.started",
        &started_payload,
        &now,
    )?;

    // G-05-8(b), T-05-03-05's ordering rule applied to the start path: last step before commit —
    // see this function's own doc comment above.
    if let crate::runtime_protocol::RuntimeIo::WriteFailed(reason) =
        crate::runtime_protocol::write_authoring_stage(&run_id, AuthoringStage::Challenge.as_str())
    {
        anyhow::bail!(
            "failed to write the authoring stage runtime marker for {run_id:?}: {reason}"
        );
    }

    tx.commit()
        .context("failed to commit start_authoring_run transaction")?;

    Ok(AgentRun {
        id: run_id,
        worktree_id: None,
        task_id: None,
        epic_id: epic_id.map(|s| s.to_string()),
        project_id: project_id.to_string(),
        trigger_id,
        adapter: "claude_code".to_string(),
        actor_id: agent_id,
        status: AgentRunStatus::Running,
        external_session_id: None,
        permission_mode: permission_mode.to_string(),
        log_path,
        authoring_stage: Some(AuthoringStage::Challenge.as_str().to_string()),
    })
}

/// Read back `agent_run_id`'s current stage — `None` for a run that never carried one (an ordinary
/// task-execution run, or an authoring run predating this column).
pub fn current_stage(conn: &Connection, agent_run_id: &str) -> anyhow::Result<Option<AuthoringStage>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT authoring_stage FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read authoring_stage")?
        .flatten();
    raw.map(|value| AuthoringStage::from_db_str(&value)).transpose()
}

/// The shared guarded-transition body [`advance_stage`] and [`return_to_stage`] both call (plan
/// 05-03, finishing what plan 05-02 left as a bare `UPDATE`). ONE transaction:
///
/// 1. Read the current stage FRESH, inside this transaction — never from a caller-supplied value,
///    so the guard below is checked against what the row actually holds right now.
/// 2. `compute_next(current)` decides the target stage — [`advance_stage`] walks `.next()`,
///    [`return_to_stage`] takes the caller's own target unconditionally (D-90: going back asserts
///    nothing about the target being earlier than `current`).
/// 3. The `UPDATE` is guarded with `WHERE id = ?1 AND authoring_stage = ?2` (`?2` bound to the
///    JUST-READ `current`) — this is what makes a concurrent double-transition fail loudly
///    (`rows_affected != 1`) rather than silently racing past a stage.
/// 4. `append_event` records the transition — a human-renderable sentence naming both stages
///    (D-19).
/// 5. **Only now**, as the LAST step before `commit`, is the runtime marker
///    ([`crate::runtime_protocol::write_authoring_stage`]) written. This ordering is deliberate
///    (T-05-03-05): the marker and the row must never be able to disagree. Writing it any earlier
///    risks a marker showing the NEW stage while a later failure (e.g. the `UPDATE` itself, or
///    `append_event`) rolls the row back to the OLD one — a committed-on-disk stage the database
///    never actually reached. Writing it here means a marker-write failure returns an `Err`
///    BEFORE `commit` is ever called, so the transaction rolls back and the row simply never
///    moves — exactly the "marker-write failure treated as a transaction failure" contract this
///    plan requires.
fn transition_stage(
    conn: &mut Connection,
    agent_run_id: &str,
    compute_next: impl FnOnce(AuthoringStage) -> anyhow::Result<AuthoringStage>,
    human_actor_id: &str,
    event_type: &str,
    label: impl FnOnce(&str, &str) -> String,
) -> anyhow::Result<AuthoringStage> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, task_id, epic_id, current_raw): (String, Option<String>, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT project_id, task_id, epic_id, authoring_stage FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;

    anyhow::ensure!(
        task_id.is_none(),
        "agent_run {agent_run_id:?} is a task-execution run, not an authoring session"
    );

    let current = current_raw
        .as_deref()
        .map(AuthoringStage::from_db_str)
        .transpose()?
        .ok_or_else(|| anyhow::anyhow!("agent_run {agent_run_id:?} carries no authoring_stage"))?;

    let next = compute_next(current)?;

    let rows_affected = tx
        .execute(
            "UPDATE agent_runs SET authoring_stage = ?1 WHERE id = ?2 AND authoring_stage = ?3",
            params![next.as_str(), agent_run_id, current.as_str()],
        )
        .context("failed to write the guarded authoring_stage transition")?;
    anyhow::ensure!(
        rows_affected == 1,
        "agent_run {agent_run_id:?}'s authoring_stage changed concurrently — refusing to overwrite it"
    );

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "authoring_stage",
        "before": current.as_str(),
        "after": next.as_str(),
        "label": label(current.as_str(), next.as_str()),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "agent_run",
        agent_run_id,
        None,
        epic_id.as_deref(),
        human_actor_id,
        event_type,
        &payload,
        &now,
    )?;

    // T-05-03-05: last step before commit — see this function's own doc comment above.
    if let crate::runtime_protocol::RuntimeIo::WriteFailed(reason) =
        crate::runtime_protocol::write_authoring_stage(agent_run_id, next.as_str())
    {
        anyhow::bail!(
            "failed to write the authoring stage runtime marker for {agent_run_id:?}: {reason}"
        );
    }

    tx.commit()
        .context("failed to commit authoring_stage transition")?;

    Ok(next)
}

/// D-89 (plan 05-05): the distillation instruction [`advance_stage`] returns exactly once — when
/// the transition just landed on the far side of `challenge` (i.e. `challenge -> decompose`). The
/// command layer sends this text as an `authoring_turn`, asking the agent to distil what it
/// challenged into staged `propose_assumption` rows — one call per assumption, never a list, and
/// never prose folded into another row's field (`PITFALLS.md` pitfall 3's general rule, applied
/// here). Those rows go through the SAME accept/amend path as every other proposal (D-92), which
/// is what makes the model's reading of the conversation *correctable rather than authoritative*
/// (D-89's own sentence) — the only reason a distilled record is acceptable at all.
#[derive(Debug, Clone, PartialEq)]
pub struct DistillationInstruction {
    pub text: String,
}

/// The distillation instruction's own fixed text (D-89) — names `propose_assumption` by its exact
/// tool name and states the one-call-per-assumption rule explicitly, so the agent never has to
/// guess either. Also states what the rows are FOR (a draft the developer decides on, primed into
/// a later session only once accepted) — the framing D-89 says is what makes a distilled record
/// acceptable at all.
const DISTILLATION_INSTRUCTION_TEXT: &str = "Before we move on: call `propose_assumption` once for \
    EACH assumption you challenged in this stage, each call carrying that one assumption and the \
    answer I gave you — one tool call per assumption, never a single call carrying a list, and \
    never folding more than one assumption's text into a single call. These rows are a DRAFT of \
    your own reasoning: I will accept, amend or reject each one myself, and only the ones I accept \
    will be primed into a later session on this epic. Go ahead now.";

/// Advance `agent_run_id` to the next stage (D-88, D-90) — `challenge -> decompose -> criteria`,
/// erroring at the last stage rather than wrapping or no-opping. Returns the new stage alongside
/// D-89's distillation instruction, present ONLY when this transition just left `challenge` (i.e.
/// the new stage is `decompose`) — advancing out of `decompose` (into `criteria`) returns `None`.
/// Distillation is a REQUEST, not a precondition (D-90): this function's own job is done the
/// moment the row transitions; delivering the returned instruction as a live `authoring_turn` is
/// the command layer's job, and its own success or failure never unwinds this transition.
///
/// **Takes a human actor id and has no agent-reachable caller anywhere in this workspace**: D-90
/// gives Cyril — the developer — the SOLE advance gate. An agent that could end its own challenge
/// stage would be able to end it on the first turn, which is the exact failure D-88 exists to
/// prevent; the agent may only ever RECOMMEND advancing (in the conversation itself), never call
/// this function. `packages/core/tests/authoring_stage.rs`'s own source-scanning gate asserts no
/// file under `packages/sidecar/src` names this function — this is the one mechanism the whole
/// phase depends on.
pub fn advance_stage(
    conn: &mut Connection,
    agent_run_id: &str,
    human_actor_id: &str,
) -> anyhow::Result<(AuthoringStage, Option<DistillationInstruction>)> {
    let next = transition_stage(
        conn,
        agent_run_id,
        |current| {
            current.next().ok_or_else(|| {
                anyhow::anyhow!("agent_run {agent_run_id:?} is already at the last authoring stage")
            })
        },
        human_actor_id,
        "authoring_run.stage_changed",
        |before, after| format!("Advanced from {before} to {after}"),
    )?;

    let distillation = if next == AuthoringStage::Decompose {
        Some(DistillationInstruction { text: DISTILLATION_INSTRUCTION_TEXT.to_string() })
    } else {
        None
    };

    Ok((next, distillation))
}

/// D-93/D-94 (plan 05-05 Task 3(c)): one developer decision on a proposal, as the turn
/// [`render_decision_turn`] renders it. Plan 05-06 owns the write path that constructs this and
/// relays the rendered text via `SidecarHandle::send_authoring_turn`; this module owns only the
/// relay's WORDING, so the two are argued and tested independently of who ends up calling it.
#[derive(Debug, Clone, PartialEq)]
pub enum ProposalDecisionTurn {
    /// D-93: a rejection is an invitation to propose something better, never a verdict to argue
    /// with — `reason` is the developer's own, optional explanation.
    Rejected { target_type: String, label: String, reason: Option<String> },
    /// D-94: an amendment is the developer's OWN text, which the next batch of drafts should move
    /// toward rather than repeating the original.
    Amended { target_type: String, original_label: String, new_text: String },
}

/// Render one [`ProposalDecisionTurn`] into the text a live authoring session receives as an
/// `authoring_turn` (D-93/D-94). A pure function — no I/O, no transaction, no clock read — so its
/// wording is unit-testable independent of the write path that will eventually call it.
pub fn render_decision_turn(decision: &ProposalDecisionTurn) -> String {
    match decision {
        ProposalDecisionTurn::Rejected { target_type, label, reason } => {
            let mut text = format!("I rejected the {target_type} proposal \"{label}\".");
            if let Some(reason) = reason {
                text.push_str(&format!(" Reason: {reason}."));
            }
            text.push_str(
                " This isn't a verdict to argue with — if you still think this is the right \
                 shape, propose something better that answers the reason above.",
            );
            text
        }
        ProposalDecisionTurn::Amended { target_type, original_label, new_text } => {
            format!(
                "I amended the {target_type} proposal \"{original_label}\" to: \"{new_text}\". \
                 This is my own text, not a suggestion to consider — move your next drafts toward \
                 it rather than repeating the original."
            )
        }
    }
}

/// Return `agent_run_id` to an earlier (or, degenerately, the same) stage (D-90) — going back is
/// ALWAYS allowed and leaves every already-staged proposal untouched (D-83's proposals live in
/// their own table, keyed by `agent_run_id`, never touched by this function). This function
/// asserts nothing about `stage` being earlier than the run's current stage beyond it being a
/// valid stage NAME (`AuthoringStage::from_db_str`) — D-90 says the return is free, and a cost on
/// the return is what would make D-88's rigidity bite. **Takes a human actor id, for the exact
/// same reason [`advance_stage`] does**: this is the other half of the one gate D-90 reserves for
/// the developer, and no file under `packages/sidecar/src` may name it either.
pub fn return_to_stage(
    conn: &mut Connection,
    agent_run_id: &str,
    stage: &str,
    human_actor_id: &str,
) -> anyhow::Result<AuthoringStage> {
    let target = AuthoringStage::from_db_str(stage)?;
    transition_stage(
        conn,
        agent_run_id,
        move |_current| Ok(target),
        human_actor_id,
        "authoring_run.stage_returned",
        |before, after| format!("Returned from {before} to {after}"),
    )
}
