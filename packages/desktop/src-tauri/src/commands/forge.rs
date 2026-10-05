//! `forge_request_for_task` / `board_forge_flags` / `settings_set_project_forge` — phase 07 plan
//! 07-08's forge command surface. `forge_request_for_task` is the item panel's LIVE per-item read
//! (D-75's "derive at read time" discipline — it shells out to the user's own already-authenticated
//! `gh`/`glab` CLI on every call, never a cached verdict) and distinguishes all four `ForgeError`
//! categories from `flywheel_core::forge::ForgeError`, plus "no worktree yet" and "no forge
//! configured" (D-120), as a single tagged `outcome` the renderer switches on. `board_forge_flags`
//! is the board's bounded, log-only read (T-07-08-04: the board never shells out), delegating
//! straight to `flywheel_core::query::forge::board_forge_flags` with the cap applied here, before
//! the call, exactly as `agent_run_log_window` caps its own window.
//!
//! `CliFailed`'s stderr is logged with `eprintln!` and never crosses the IPC boundary (T-07-08-01)
//! — `ForgeReadDto` below carries the error *category* only, the same discipline `sidecar.rs`'s
//! `emit_persistence_failure_notice` already applies to OS error text.
//!
//! `settings_set_project_forge` validates `forge` against the fixed three-value vocabulary before
//! ever touching the database (T-07-08-02 — the renderer can select among
//! `github`/`gitlab`/`local`/clear, never name an arbitrary binary) and resolves the actor
//! server-side (T-01-04), mirroring `commands::settings::settings_set_credential_mode`'s own
//! validate-then-resolve-actor shape. `project_forge_overrides` is this surface's read half — the
//! Settings per-project forge select (D-119) needs to know each project's CURRENT override to
//! render a correct initial selection and to make "clearing back to Detected" a real, observable
//! action, not just a write with no readback; it is a thin per-project loop over
//! `flywheel_core::domain::settings::project_forge`, the exact shape
//! `commands::settings::settings_get`'s own `project_overrides` loop already uses for the
//! credential-mode override.

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// One normalised pull/merge request, projected for the renderer — mirrors
/// `flywheel_core::forge::ForgeRequest` field-for-field. `state`/`ci` serialize as their Rust
/// variant names (`ForgeState`/`CiResult` already derive `Serialize` with no `rename_all`) — the
/// SAME strings `forge::transitions::state_label`/`ci_label` write into `events.payload`, so there
/// is one source for these words, never a second mapping maintained here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRequestDto {
    pub state: flywheel_core::forge::ForgeState,
    pub ci: flywheel_core::forge::CiResult,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub ci_url: Option<String>,
    pub is_draft: bool,
    pub target_branch: String,
}

impl From<&flywheel_core::forge::ForgeRequest> for ForgeRequestDto {
    fn from(request: &flywheel_core::forge::ForgeRequest) -> Self {
        Self {
            state: request.state,
            ci: request.ci,
            number: request.number,
            title: request.title.clone(),
            url: request.url.clone(),
            ci_url: request.ci_url.clone(),
            is_draft: request.is_draft,
            target_branch: request.target_branch.clone(),
        }
    }
}

/// `forge_request_for_task`'s whole result, projected as one tagged `outcome` the renderer
/// switches on (never a bare `Result<Option<...>, String>`, which would collapse "no forge
/// configured" and "forge configured, no request yet" into the same shape a caller cannot tell
/// apart). `NoWorktree` is this command's own addition beyond the four `ForgeError` categories and
/// `request_for_branch`'s own `Option` — a task with no `worktrees` row yet (before "Start Work")
/// has no branch to ask the forge about at all, and `ForgeSection.tsx` treats it exactly like
/// `NoForgeConfigured`: render nothing (`WorktreeSummary.tsx`/`GitFactsSection.tsx`'s own "nothing
/// until a worktree exists" precedent, applied here). `CliFailed`/`MalformedJson` carry the error
/// **category** only — see this module's own header comment.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum ForgeReadDto {
    NoWorktree,
    NoForgeConfigured,
    NoRequest,
    /// `unmet_criteria` (D-123) is NOT a field of `ForgeRequest` itself — it is read separately
    /// from `query::forge::latest_unmet_criteria_count`, the SAME `task.done_with_unmet_criteria`
    /// event `board_forge_flags` folds into its own rollup. `0` when the task carries no such
    /// event (the common case — most requests were never merged with unmet criteria).
    Request { request: ForgeRequestDto, unmet_criteria: u32 },
    CliNotInstalled { cli: String },
    CliNotAuthenticated { cli: String },
    CliFailed { cli: String },
    MalformedJson { cli: String },
}

/// `taskId`'s live forge request (LINK-05, LINK-06, D-75), or one of the typed non-request
/// outcomes above. Shells out to the user's own already-authenticated `gh`/`glab` CLI on every
/// call — no cached verdict, never returns a credential or raw CLI stderr. For a task in a
/// `Forge::Local` project this resolves to `NoForgeConfigured` without spawning any process at
/// all.
///
/// Phase 07 plan 07-11: the mutex is released before the CLI runs, so a slow forge call cannot
/// block any other command. Resolves the worktree and the project's forge/repo path under the
/// lock, releases it with an explicit `drop`, dispatches lock-free through the connection-free
/// read seam in `flywheel_core::forge`, then — only for the request case — briefly re-acquires
/// the lock to read the unmet-criteria count.
#[tauri::command]
pub fn forge_request_for_task(
    state: State<AppState>,
    task_id: String,
) -> Result<ForgeReadDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let worktree_row: Option<(String, String)> = conn
        .query_row(
            "SELECT project_id, branch FROM worktrees WHERE task_id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((project_id, branch)) = worktree_row else {
        return Ok(ForgeReadDto::NoWorktree);
    };

    let (forge, repo_path) =
        flywheel_core::forge::forge_and_repo_path(&conn, &project_id).map_err(|e| e.to_string())?;
    if matches!(forge, flywheel_core::forge::Forge::Local) {
        // Correct to return from inside the lock here: Forge::Local spawns no process at all, so
        // nothing is held across anything.
        return Ok(ForgeReadDto::NoForgeConfigured);
    }
    drop(conn);

    match flywheel_core::forge::request_for_branch_at(forge, &repo_path, &branch) {
        Ok(None) => Ok(ForgeReadDto::NoRequest),
        Ok(Some(request)) => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let unmet_criteria =
                flywheel_core::query::forge::latest_unmet_criteria_count(&conn, &task_id)
                    .map_err(|e| e.to_string())?;
            drop(conn);
            Ok(ForgeReadDto::Request { request: ForgeRequestDto::from(&request), unmet_criteria })
        }
        Err(flywheel_core::forge::ForgeError::CliNotInstalled { cli }) => {
            Ok(ForgeReadDto::CliNotInstalled { cli: cli.to_string() })
        }
        Err(flywheel_core::forge::ForgeError::CliNotAuthenticated { cli }) => {
            Ok(ForgeReadDto::CliNotAuthenticated { cli: cli.to_string() })
        }
        Err(flywheel_core::forge::ForgeError::CliFailed { cli, stderr: cli_err_text }) => {
            eprintln!("forge CLI {cli} failed reading the request for task {task_id}: {cli_err_text}");
            Ok(ForgeReadDto::CliFailed { cli: cli.to_string() })
        }
        Err(flywheel_core::forge::ForgeError::MalformedJson { cli, detail }) => {
            eprintln!("forge CLI {cli} returned JSON this module could not read for task {task_id}: {detail}");
            Ok(ForgeReadDto::MalformedJson { cli: cli.to_string() })
        }
    }
}

/// One request draft, projected for the renderer (D-118, phase 07 plan 07-09) — mirrors
/// `flywheel_core::forge::request_body::RequestDraft` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestDraftDto {
    pub title: String,
    pub body: String,
    pub head_branch: String,
    pub target_branch: String,
}

impl From<flywheel_core::forge::request_body::RequestDraft> for RequestDraftDto {
    fn from(draft: flywheel_core::forge::request_body::RequestDraft) -> Self {
        Self {
            title: draft.title,
            body: draft.body,
            head_branch: draft.head_branch,
            target_branch: draft.target_branch,
        }
    }
}

/// Read-only preview of the draft [`forge_open_request`] would send (D-118's "show them the body
/// first" requirement) — locks the connection and returns
/// `flywheel_core::forge::request_body::assemble_request_draft`'s own result, calling nothing
/// else and writing nothing. Pure by construction: its signature takes no title, no body, no
/// branch — a caller cannot influence what this returns beyond choosing which task to preview.
#[tauri::command]
pub fn forge_request_draft(
    state: State<AppState>,
    task_id: String,
) -> Result<RequestDraftDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let draft = flywheel_core::forge::request_body::assemble_request_draft(&conn, &task_id)
        .map_err(|e| e.to_string())?;
    Ok(RequestDraftDto::from(draft))
}

/// Open a pull/merge request for `task_id` (D-118) — the ONE action in this product that
/// publishes board content to a possibly public forge, and the one Tauri command this plan adds
/// alongside the read-only preview above. **Accepts no title and no body from the renderer**: it
/// re-assembles the draft itself with the SAME `assemble_request_draft` function
/// [`forge_request_draft`] just showed the user, so the published text is the previewed text by
/// construction (T-07-09-01), never by trust. Writes no status of its own — the move to In
/// Review is plan 07-07's poll observing the new request through the one edge detector (D-121);
/// this command's only side effect beyond the forge call itself is the board-refresh event
/// emitted below, which lets the section and the board refresh through the existing invalidation
/// path.
/// `ForgeError` maps onto the same four categories [`forge_request_for_task`] already uses,
/// packed into the `Err(String)` this command's signature is fixed to as `"<category>:<cli>"` —
/// never the CLI's raw stderr, which stays in the `eprintln!` below (T-07-09-08, mirroring this
/// module's own header comment).
///
/// Phase 07 plan 07-11: the mutex is released before the CLI runs, so a slow forge call cannot
/// block any other command. Assembles the draft and resolves the forge/repo path under the lock,
/// releases it, then dispatches lock-free through the connection-free open seam in
/// `flywheel_core::forge`.
#[tauri::command]
pub fn forge_open_request(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
) -> Result<ForgeRequestDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let draft = flywheel_core::forge::request_body::assemble_request_draft(&conn, &task_id)
        .map_err(|e| e.to_string())?;

    let project_id: String = conn
        .query_row("SELECT project_id FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let (forge, repo_path) =
        flywheel_core::forge::forge_and_repo_path(&conn, &project_id).map_err(|e| e.to_string())?;
    drop(conn);

    let result = flywheel_core::forge::create_request_at(forge, &repo_path, &draft);

    match result {
        Ok(request) => {
            app.emit(
                "board:changed",
                serde_json::json!({ "entity": "task", "id": task_id }),
            )
            .ok();
            Ok(ForgeRequestDto::from(&request))
        }
        Err(flywheel_core::forge::ForgeError::CliNotInstalled { cli }) => {
            Err(format!("cliNotInstalled:{cli}"))
        }
        Err(flywheel_core::forge::ForgeError::CliNotAuthenticated { cli }) => {
            Err(format!("cliNotAuthenticated:{cli}"))
        }
        Err(flywheel_core::forge::ForgeError::CliFailed { cli, stderr: cli_err_text }) => {
            eprintln!("forge CLI {cli} failed opening a request for task {task_id}: {cli_err_text}");
            Err(format!("cliFailed:{cli}"))
        }
        Err(flywheel_core::forge::ForgeError::MalformedJson { cli, detail }) => {
            eprintln!(
                "forge CLI {cli} returned JSON this module could not read opening a request for task {task_id}: {detail}"
            );
            Err(format!("malformedJson:{cli}"))
        }
    }
}

/// The board's bounded, log-only CI-failure/unmet-criteria rollup for one project (D-124, D-123,
/// T-07-08-04) — mirrors `flywheel_core::query::forge::ForgeFlag` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeFlagDto {
    pub task_id: String,
    pub ci_failed: bool,
    pub unmet_criteria: u32,
}

impl From<flywheel_core::query::forge::ForgeFlag> for ForgeFlagDto {
    fn from(flag: flywheel_core::query::forge::ForgeFlag) -> Self {
        Self { task_id: flag.task_id, ci_failed: flag.ci_failed, unmet_criteria: flag.unmet_criteria }
    }
}

/// The server-side cap on `board_forge_flags`'s result (T-07-08-04) — applied here, before the
/// call into `packages/core`, exactly as `agent_run_log_window`'s own `LOG_WINDOW_MAX_LIMIT`
/// clamp is applied before `session_log::read_window`.
const BOARD_FORGE_FLAGS_CAP: usize = 200;

/// Every distinct task in `projectId` carrying an outstanding forge flag (D-124's board-row CI
/// pill, D-123's unmet-criteria marker's board-level rollup) — feeds `BoardRow.tsx`'s CI-failure
/// pill. Read-only, delegating straight to `query::forge::board_forge_flags`. The board never
/// shells out: this is a bounded read over the append-only `events` log, never a live forge call.
#[tauri::command]
pub fn board_forge_flags(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<ForgeFlagDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let flags =
        flywheel_core::query::forge::board_forge_flags(&conn, &project_id, BOARD_FORGE_FLAGS_CAP)
            .map_err(|e| e.to_string())?;
    Ok(flags.into_iter().map(ForgeFlagDto::from).collect())
}

/// Set (or clear) `projectId`'s forge override (D-119). `forge` must be exactly `"github"`,
/// `"gitlab"`, `"local"`, or `null` (clears back to detection) — rejected before the database is
/// ever touched, mirroring `commands::settings::settings_set_credential_mode`'s own
/// validate-then-resolve-actor shape. `actor_id` is resolved server-side (T-01-04), never accepted
/// from the renderer.
#[tauri::command]
pub fn settings_set_project_forge(
    state: State<AppState>,
    project_id: String,
    forge: Option<String>,
) -> Result<(), String> {
    if let Some(value) = forge.as_deref() {
        if value != "github" && value != "gitlab" && value != "local" {
            return Err(format!(
                "forge must be \"github\", \"gitlab\" or \"local\", got {value:?}"
            ));
        }
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::settings::set_project_forge(
        &mut conn,
        &actor_id,
        &project_id,
        forge.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One registered project's forge override, projected for the wire — mirrors
/// `commands::settings::ProjectCredentialOverrideDto`'s own shape exactly. `forge` is `None` when
/// the project has no override ("use detection").
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectForgeOverrideDto {
    pub project_id: String,
    pub project_name: String,
    pub forge: Option<String>,
}

/// Every registered project's forge override (D-119) — the Settings per-project forge select's
/// read half (`settings_set_project_forge` above is the write half). Read-only, delegating
/// straight to `domain::settings::project_forge` once per project, the same per-project loop shape
/// `commands::settings::settings_get` already uses for `project_credential_mode`.
#[tauri::command]
pub fn project_forge_overrides(
    state: State<AppState>,
) -> Result<Vec<ProjectForgeOverrideDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let projects =
        flywheel_core::domain::project::list_projects(&conn).map_err(|e| e.to_string())?;
    let mut overrides = Vec::with_capacity(projects.len());
    for project in projects {
        let forge = flywheel_core::domain::settings::project_forge(&conn, &project.id)
            .map_err(|e| e.to_string())?;
        overrides.push(ProjectForgeOverrideDto {
            project_id: project.id,
            project_name: project.name,
            forge,
        });
    }
    Ok(overrides)
}
