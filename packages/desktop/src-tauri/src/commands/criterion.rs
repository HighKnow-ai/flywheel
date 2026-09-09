//! `criterion_create` / `criterion_update` / `criterion_toggle` / `criterion_reorder` /
//! `criterion_delete` / `criterion_list` — the acceptance-criteria mutation and read surface
//! (BOARD-02). Every mutating handler resolves `actor_id` server-side (T-01-04, never from a
//! renderer-supplied claim), caps input length (T-01-05), and emits `board:changed` after a
//! successful mutation (D-04) — the checked/total count rides `board_list`, so any surface
//! showing it needs the same invalidation every other mutation already triggers.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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

fn emit_board_changed(app: &AppHandle, id: &str) {
    app.emit("board:changed", serde_json::json!({ "entity": "criterion", "id": id }))
        .ok();
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
    emit_board_changed(&app, &dto.id);
    Ok(dto)
}

/// Patch a criterion's `statement`/`verification_hint` (`None` leaves a field unchanged). An
/// edit, not a check — never touches `checked` or `rank`.
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
    let criterion = flywheel_core::domain::acceptance_criterion::update_criterion(
        &mut conn,
        &actor_id,
        &criterion_id,
        statement.as_deref().map(str::trim),
        verification_hint.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, &dto.id);
    Ok(dto)
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
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, &dto.id);
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
    drop(conn);

    let dto: CriterionDto = criterion.into();
    emit_board_changed(&app, &dto.id);
    Ok(dto)
}

/// Delete a criterion (idempotent).
#[tauri::command]
pub fn criterion_delete(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::acceptance_criterion::delete_criterion(&mut conn, &actor_id, &criterion_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    emit_board_changed(&app, &criterion_id);
    Ok(())
}

/// List every criterion for a task or an epic, in rank order — the read the item detail panel's
/// `AcceptanceCriteriaList` consumes. Read-only: no `board:changed` emission.
#[tauri::command]
pub fn criterion_list(state: State<AppState>, parent_type: String, parent_id: String) -> Result<Vec<CriterionDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let criteria = flywheel_core::domain::acceptance_criterion::list_criteria(&conn, &parent_type, &parent_id)
        .map_err(|e| e.to_string())?;
    Ok(criteria.into_iter().map(CriterionDto::from).collect())
}
