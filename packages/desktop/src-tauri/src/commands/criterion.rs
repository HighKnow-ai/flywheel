//! `criterion_create` / `criterion_update` / `criterion_toggle` / `criterion_reorder` /
//! `criterion_delete` / `criterion_list` / `criterion_revise` / `criterion_revisions` — the
//! acceptance-criteria mutation and read surface (BOARD-02, BOARD-03). Every mutating handler
//! resolves `actor_id` server-side (T-01-04, never from a renderer-supplied claim), caps input
//! length (T-01-05), and emits `board:changed` after a successful mutation (D-04) — the
//! checked/total count rides `board_list`, so any surface showing it needs the same invalidation
//! every other mutation already triggers.
//!
//! `criterion_update` and `criterion_revise` (plan 04-10) both delegate to the domain layer's
//! `revise_criterion` — the one write path that decides whether an edit lands in place or mints
//! an appended revision (D-76/D-77). Neither command performs a lock check of its own: two
//! commands that both edit a criterion but disagree about immutability is exactly the drift this
//! consolidation prevents. `criterion_update` keeps its own pre-existing `None`-means-unchanged
//! patch contract (a caller may omit `statement`/`verification_hint` to leave it as-is) by
//! resolving the current row first, then passing the fully-resolved values through to
//! `revise_criterion` — so its unlocked-branch behaviour is unchanged from before this plan.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, project_of};

use crate::state::AppState;

const MAX_STATEMENT_LEN: usize = 1_000;
const MAX_HINT_LEN: usize = 1_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionDto {
    pub id: String,
    pub parent_type: String,
    pub parent_id: String,
    pub statement: String,
    pub verification_hint: Option<String>,
    pub checked: bool,
    pub rank: String,
    /// D-77's revision counter (plan 04-10) — 1 for a never-revised row, the predecessor's
    /// `revision + 1` for every successor `criterion_revise` mints.
    pub revision: i64,
    /// The chain root's id (plan 04-10) — `None` on a revision-1 row, `Some` on every successor.
    /// Non-null is what tells the renderer to show the "revised" marker (D-79).
    pub revision_of: Option<String>,
    /// `None` means this row is the current revision; a timestamp means a later revision exists
    /// and this row's `statement` is preserved history, never rewritten (plan 04-10, D-77).
    pub superseded_at: Option<String>,
}

impl From<flywheel_core::domain::acceptance_criterion::AcceptanceCriterion> for CriterionDto {
    fn from(criterion: flywheel_core::domain::acceptance_criterion::AcceptanceCriterion) -> Self {
        Self {
            id: criterion.id,
            parent_type: criterion.parent_type,
            parent_id: criterion.parent_id,
            statement: criterion.statement,
            verification_hint: criterion.verification_hint,
            checked: criterion.checked,
            rank: criterion.rank,
            revision: criterion.revision,
            revision_of: criterion.revision_of,
            superseded_at: criterion.superseded_at,
        }
    }
}

fn validate_statement(statement: &str) -> Result<(), String> {
    if statement.is_empty() || statement.len() > MAX_STATEMENT_LEN {
        return Err(format!(
            "criterion statement must be 1-{MAX_STATEMENT_LEN} characters, got {} characters",
            statement.len()
        ));
    }
    Ok(())
}

fn validate_hint(hint: &Option<String>) -> Result<(), String> {
    if let Some(h) = hint {
        if h.len() > MAX_HINT_LEN {
            return Err(format!(
                "verification hint must be at most {MAX_HINT_LEN} characters, got {} characters",
                h.len()
            ));
        }
    }
    Ok(())
}

/// Create a criterion on a task or an epic (D-07). `parent_type` other than `"task"`/`"epic"` is
/// rejected by the schema's CHECK constraint, not by this handler (BOARD-02, T-01-01).
#[tauri::command]
pub fn criterion_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    parent_type: String,
    parent_id: String,
    statement: String,
    verification_hint: Option<String>,
) -> Result<CriterionDto, String> {
    let statement = statement.trim().to_string();
    validate_statement(&statement)?;
    let verification_hint = verification_hint
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    validate_hint(&verification_hint)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let criterion = flywheel_core::domain::acceptance_criterion::create_criterion(
        &mut conn,
        &project_id,
        &actor_id,
        &parent_type,
        &parent_id,
        &statement,
        verification_hint.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, Some(project_id.as_str()), "criterion", Some(dto.id.as_str()));
    Ok(dto)
}

/// Patch a criterion's `statement`/`verification_hint` (`None` leaves a field unchanged). An
/// edit, not a check — never touches `checked` or `rank`. Delegates to the crate's one edit write
/// path (D-77, plan 04-10): this command performs no lock check of its own, resolving the
/// currently-stored value for whichever field is `None` so the domain call below always receives
/// the criterion's full post-edit statement/hint — the same values this handler used to compute
/// internally before the two edit paths were consolidated onto one function.
#[tauri::command]
pub fn criterion_update(
    state: State<AppState>,
    app: AppHandle,
    criterion_id: String,
    statement: Option<String>,
    verification_hint: Option<String>,
) -> Result<CriterionDto, String> {
    if let Some(s) = &statement {
        let trimmed = s.trim();
        if trimmed.is_empty() || trimmed.len() > MAX_STATEMENT_LEN {
            return Err(format!(
                "criterion statement must be 1-{MAX_STATEMENT_LEN} characters, got {} characters",
                trimmed.len()
            ));
        }
    }
    validate_hint(&verification_hint)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let (current_statement, current_hint): (String, Option<String>) = conn
        .query_row(
            "SELECT statement, verification_hint FROM acceptance_criteria WHERE id = ?1",
            [&criterion_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let resolved_statement = statement.as_deref().map(str::trim).unwrap_or(&current_statement);
    let resolved_hint = verification_hint.as_deref().or(current_hint.as_deref());

    let criterion = flywheel_core::domain::acceptance_criterion::revise_criterion(
        &mut conn,
        &actor_id,
        &criterion_id,
        resolved_statement,
        resolved_hint,
    )
    .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "acceptance_criteria", &criterion_id);
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(dto.id.as_str()));
    Ok(dto)
}

/// Revise a criterion (D-76/D-77, plan 04-10) — the developer-facing edit surface
/// `AcceptanceCriteriaList.tsx`'s inline edit affordance calls. Delegates straight to
/// `revise_criterion`, which decides whether this edit lands in place or mints a revision; this
/// command performs no lock check of its own — duplicating that decision here would create a
/// second authority on immutability, exactly what the crate's one-write-path design (D-77) exists
/// to prevent. Unlike `criterion_update`, both fields here are the caller's intended post-edit
/// values directly — no `None`-means-unchanged patch semantics — matching the edit affordance's
/// own always-has-both-fields-in-hand shape.
#[tauri::command]
pub fn criterion_revise(
    state: State<AppState>,
    app: AppHandle,
    criterion_id: String,
    statement: String,
    verification_hint: Option<String>,
) -> Result<CriterionDto, String> {
    let statement = statement.trim().to_string();
    validate_statement(&statement)?;
    let verification_hint = verification_hint
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    validate_hint(&verification_hint)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let criterion = flywheel_core::domain::acceptance_criterion::revise_criterion(
        &mut conn,
        &actor_id,
        &criterion_id,
        &statement,
        verification_hint.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "acceptance_criteria", &criterion_id);
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(dto.id.as_str()));
    Ok(dto)
}

/// `criterion_id`'s whole revision chain, newest first (D-79's expand-to-prior-text read, plan
/// 04-10) — what the "revised" marker's expand affordance reads. Read-only: no mutation, no
/// `board:changed` emit.
#[tauri::command]
pub fn criterion_revisions(state: State<AppState>, criterion_id: String) -> Result<Vec<CriterionDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let revisions =
        flywheel_core::domain::acceptance_criterion::list_revisions_for_root(&conn, &criterion_id)
            .map_err(|e| e.to_string())?;
    Ok(revisions.into_iter().map(CriterionDto::from).collect())
}

/// Flip a criterion's checked state — the signature interaction (01-UI-SPEC.md "Selected
/// Direction"). Advances the parent's checked/total count via the same `board_list` window every
/// other mutation invalidates (D-04).
#[tauri::command]
pub fn criterion_toggle(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<CriterionDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let criterion = flywheel_core::domain::acceptance_criterion::toggle_criterion(&mut conn, &actor_id, &criterion_id)
        .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "acceptance_criteria", &criterion_id);
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(dto.id.as_str()));
    Ok(dto)
}

/// Reorder a criterion between two neighbours (or to the tail when `next_rank` is omitted) —
/// `prev_rank`/`next_rank` are the neighbouring criteria's own `rank` values, as already held by
/// the caller's in-memory list.
#[tauri::command]
pub fn criterion_reorder(
    state: State<AppState>,
    app: AppHandle,
    criterion_id: String,
    prev_rank: Option<String>,
    next_rank: Option<String>,
) -> Result<CriterionDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let criterion = flywheel_core::domain::acceptance_criterion::reorder_criterion(
        &mut conn,
        &actor_id,
        &criterion_id,
        prev_rank.as_deref(),
        next_rank.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "acceptance_criteria", &criterion_id);
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(dto.id.as_str()));
    Ok(dto)
}

/// Delete a criterion (idempotent).
#[tauri::command]
pub fn criterion_delete(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    // Read before the delete: the row (and its project) is gone afterwards.
    let project_id = project_of(&conn, "acceptance_criteria", &criterion_id);
    flywheel_core::domain::acceptance_criterion::delete_criterion(&mut conn, &actor_id, &criterion_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(criterion_id.as_str()));
    Ok(())
}

/// List the CURRENT criteria for a task or an epic, in rank order — the read the item detail
/// panel's `AcceptanceCriteriaList` consumes. Read-only: no `board:changed` emission.
///
/// Deviation (Rule 1, plan 04-10): restricted from `list_criteria` (every row, superseded and
/// current alike) to `list_current_criteria` — plan 04-04's own D2 coverage already established
/// "every read path that shows criteria to a human or an agent sees current revisions only," but
/// this command was not among the paths that plan actually touched, because nothing could reach a
/// locked criterion's revise path from the UI yet. This plan adds that UI (the edit affordance
/// below), which makes the gap immediately observable: revising a criterion on a locked task would
/// otherwise leave the superseded row's stale statement rendered as a second, phantom list item
/// alongside its successor, and the header's checked/total badge would over-count. Superseded
/// wording stays reachable through `criterion_revisions` (the "revised" marker's own read) and
/// nowhere else this command's caller renders by default.
#[tauri::command]
pub fn criterion_list(state: State<AppState>, parent_type: String, parent_id: String) -> Result<Vec<CriterionDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let criteria =
        flywheel_core::domain::acceptance_criterion::list_current_criteria(&conn, &parent_type, &parent_id)
            .map_err(|e| e.to_string())?;
    Ok(criteria.into_iter().map(CriterionDto::from).collect())
}

/// [`flywheel_core::query::criterion_coverage::CriterionCoverage`] plus the task's project, which
/// the launch sheet's composed criteria form needs to create a criterion (the packet does not carry
/// it, and the renderer must not guess it from whichever project happens to be viewed).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCriterionCoverageDto {
    #[serde(flatten)]
    pub coverage: flywheel_core::query::criterion_coverage::CriterionCoverage,
    pub project_id: Option<String>,
}

/// D-12: whether a task has criteria coverage (current criteria or a pending draft), and how many
/// of its current criteria are judgement-only. Counts and a boolean only — the statements come from
/// the bounded `criterion_list`. Read-only: no `board:changed` emission.
#[tauri::command]
pub fn task_criterion_coverage(state: State<AppState>, task_id: String) -> Result<TaskCriterionCoverageDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let coverage = flywheel_core::query::criterion_coverage::criterion_coverage(&conn, &task_id)
        .map_err(|e| e.to_string())?;
    Ok(TaskCriterionCoverageDto { coverage, project_id: project_of(&conn, "tasks", &task_id) })
}

/// D-13: a deliberate "proceed without criteria". The actor is resolved server-side (T-15-28) and
/// the core asserts human actorhood in-transaction; the one effect is a `task.criteria_waived`
/// event — never a `tasks.status` write.
#[tauri::command]
pub fn task_criteria_waive(state: State<AppState>, app: AppHandle, task_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::acceptance_criterion::waive_criteria(&mut conn, &actor_id, &task_id)
        .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "tasks", &task_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "task", Some(task_id.as_str()));
    Ok(())
}
