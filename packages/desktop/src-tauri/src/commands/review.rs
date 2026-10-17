//! What survives of the review surface's command module after issue #38 deleted the surface:
//! `review_criteria_state`, the one read the acceptance-criteria list still composes (each current
//! criterion with its anchor and a staleness verdict re-derived from git). It takes a scope plus an
//! id and nothing else: the base ref, the head ref and the repository path are derived inside
//! `flywheel_core::review`. The changed-file reads, the merge, the epic roll-up, check-with-anchor
//! and the decline path went with the surface; the Review & merge reshape rebuilds them.
//!
//! The command is async so the git call runs off the main thread: it reads the board into an opaque
//! inputs value under the database lock (`criteria_with_anchors`), releases the lock, and only then
//! runs the git half (`finish_review_target`), which takes no connection.

use serde::Serialize;
use tauri::State;

use super::criterion::CriterionDto;
use super::ipc_error;

use crate::state::AppState;

/// The enum is the whole input-validation surface for the scope argument.
fn parse_scope(scope: &str) -> Result<flywheel_core::review::ReviewScope, String> {
    match scope {
        "task" => Ok(flywheel_core::review::ReviewScope::Task),
        "epic" => Ok(flywheel_core::review::ReviewScope::Epic),
        other => Err(format!("unknown review scope {other:?}: expected \"task\" or \"epic\"")),
    }
}

/// The evidence behind a checked criterion — mirrors `CriterionAnchor`. Staleness is not here: it
/// rides next to it on [`ReviewCriterionStateDto`], derived per read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorDto {
    pub path: String,
    pub side: String,
    pub line_start: u32,
    pub line_end: u32,
    pub sha: String,
}

/// `state` is `untouched`, `changed` (with `commits`), `movedOrChanged` or `unknown`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StalenessDto {
    pub state: String,
    pub commits: Option<u32>,
}

impl From<flywheel_core::review::AnchorStaleness> for StalenessDto {
    fn from(s: flywheel_core::review::AnchorStaleness) -> Self {
        use flywheel_core::review::AnchorStaleness as S;
        let (state, commits) = match s {
            S::Untouched => ("untouched", None),
            S::Changed { commits } => ("changed", Some(commits)),
            S::MovedOrChanged => ("movedOrChanged", None),
            S::Unknown => ("unknown", None),
        };
        Self { state: String::from(state), commits }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCriterionStateDto {
    pub criterion: CriterionDto,
    pub anchor: Option<AnchorDto>,
    pub staleness: Option<StalenessDto>,
}

/// Every current criterion of a task or epic with its anchor and a staleness verdict re-derived
/// from git on this call. Read-only; the DB lock is dropped before git runs.
#[tauri::command(async)]
pub fn review_criteria_state(
    state: State<AppState>,
    scope: String,
    item_id: String,
) -> Result<Vec<ReviewCriterionStateDto>, String> {
    let scope = parse_scope(&scope)?;
    let (inputs, rows) = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_criteria_state:lock", e))?;
        flywheel_core::review::criteria_with_anchors(&conn, scope, &item_id)
            .map_err(|e| ipc_error("review_criteria_state:read", e))?
    };
    let target = flywheel_core::review::finish_review_target(inputs).map_err(|e| ipc_error("review_criteria_state:finish", e))?;
    Ok(flywheel_core::review::with_staleness(&target, rows)
        .into_iter()
        .map(|e| ReviewCriterionStateDto {
            criterion: e.criterion.into(),
            anchor: e.anchor.map(|a| AnchorDto {
                path: a.path,
                side: a.side,
                line_start: a.line_start,
                line_end: a.line_end,
                sha: a.sha,
            }),
            staleness: e.staleness.map(StalenessDto::from),
        })
        .collect())
}
