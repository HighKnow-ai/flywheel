//! A task's declared file-set (phase 09 plan 09-01, D-147/D-148): the scope the run-time hook
//! enforces (PLAN-04) and the plan-time overlap check compares (PLAN-02). In the module convention:
//! lock `AppState.db`, validate input shape before calling into the core, resolve the actor
//! server-side with `local_human_actor_id` (never from a renderer claim, T-01-04), map core errors
//! through [`ipc_error`], emit `board:changed` after a successful mutation.
//!
//! **`task_file_set_widen` is a human-only command** in the `advance_stage` family (T-09-01-08):
//! there is no MCP tool for it and no agent-reachable caller, so an agent can never widen its own
//! scope. It accepts neither a worktree path nor an absolute path — an entry is a repo-relative
//! string that `flywheel_core::file_set::parse_entry` either accepts as-is or REFUSES with a named
//! cause; nothing is ever repaired.

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, project_of};

use super::ipc_error;
use crate::state::AppState;

fn validate_task_id(task_id: &str) -> Result<(), String> {
    if flywheel_core::ids::is_ulid(task_id) {
        Ok(())
    } else {
        Err(format!("task id must be a 26-character ULID, got {task_id:?}"))
    }
}

/// The outcome of a widen, projected for the wire. The renderer renders this and decides nothing:
/// `status` is `accepted`, `refused` or `marker_not_rewritten`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidenResultDto {
    pub status: String,
    /// The task's full declared set after an accepted (or partially accepted) widen.
    pub entries: Vec<String>,
    /// A refusal's reason in words, ready to display.
    pub refusal: Option<String>,
    /// The other task's entry the candidate collided with.
    pub colliding_path: Option<String>,
    pub other_task_key: Option<String>,
    /// Set when the widen committed but the enforcement marker could not be rewritten.
    pub marker_error: Option<String>,
}

/// The longest entry string a widen accepts. `parse_entry` has no length bound of its own.
const MAX_ENTRY_CHARS: usize = 1024;

/// `fold_case` is the repository's case flag, supplied by the caller because reading it runs
/// `git config`, which must not run under `AppState.db` (D-REV-39 WR-07): [`task_file_set_widen`]
/// reads it before taking the lock.
pub(crate) fn widen_task_file_set(
    conn: &mut Connection,
    task_id: &str,
    entry: &str,
    actor_id: &str,
    fold_case: bool,
) -> Result<WidenResultDto, String> {
    use flywheel_core::domain::file_set::{widen_file_set_with, WidenOutcome, WidenRefusal};

    validate_task_id(task_id)?;
    if entry.chars().count() > MAX_ENTRY_CHARS {
        return Err(format!("a file-set entry holds at most {MAX_ENTRY_CHARS} characters"));
    }
    let dto = |status: &str| WidenResultDto {
        status: status.to_string(),
        entries: Vec::new(),
        refusal: None,
        colliding_path: None,
        other_task_key: None,
        marker_error: None,
    };
    match widen_file_set_with(conn, task_id, entry, actor_id, fold_case)
        .map_err(|e| ipc_error("task_file_set_widen:widen", e))?
    {
        WidenOutcome::Accepted { entries } => Ok(WidenResultDto { entries, ..dto("accepted") }),
        WidenOutcome::MarkerNotRewritten { entries, error } => Ok(WidenResultDto {
            entries,
            marker_error: Some(error),
            ..dto("marker_not_rewritten")
        }),
        WidenOutcome::Refused(WidenRefusal::InvalidEntry { entry, cause }) => Ok(WidenResultDto {
            refusal: Some(format!("file-set entry {entry:?} refused: {cause}")),
            ..dto("refused")
        }),
        WidenOutcome::Refused(WidenRefusal::Collision { entry, colliding_path, other_task_key, .. }) => {
            Ok(WidenResultDto {
                refusal: Some(format!(
                    "{entry} overlaps {colliding_path}, which {other_task_key} is running against"
                )),
                colliding_path: Some(colliding_path),
                other_task_key: Some(other_task_key),
                ..dto("refused")
            })
        }
    }
}

/// Widen a task's declared file-set by one entry, live; takes effect on the agent's next tool call.
/// Refused when the entry overlaps any in-flight task's set. Human-only — see this module's doc
/// comment: no MCP tool, no agent-reachable caller, actor resolved here.
#[tauri::command]
pub fn task_file_set_widen(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    entry: String,
) -> Result<WidenResultDto, String> {
    // Read the repository path under a short lock, drop it, run `git config`, then re-lock (the shape
    // the worktree reclaim path uses). An unreadable task reads `false`; the widen reports the error.
    let repo_path = state
        .db
        .lock()
        .ok()
        .and_then(|conn| flywheel_core::domain::file_set::task_repo_path(&conn, &task_id).ok());
    let fold_case = repo_path
        .is_some_and(|p| flywheel_core::domain::file_set::repo_is_case_insensitive(std::path::Path::new(&p)));
    let mut conn = state.db.lock().map_err(|e| ipc_error("task_file_set_widen:lock", e))?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("task_file_set_widen:actor", e))?;
    let result = widen_task_file_set(&mut conn, &task_id, &entry, &actor_id, fold_case)?;
    if result.status != "refused" {
        let project_id = project_of(&conn, "tasks", &task_id);
        emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    }
    Ok(result)
}

/// One task's refusal count for the board badge. Tasks with none are not sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeFlagDto {
    pub task_id: String,
    pub count: i64,
}

/// The server-side cap on one board sweep of refusal counts.
const SCOPE_FLAGS_WINDOW: i64 = 1000;

/// Per-task scope-refusal counts for one project, read once per board read. Read-only: a project
/// id in and nothing else; the window is capped here.
#[tauri::command]
pub fn board_scope_flags(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<ScopeFlagDto>, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("board_scope_flags:lock", e))?;
    let counts = flywheel_core::query::scope::scope_denied_counts(&conn, &project_id, SCOPE_FLAGS_WINDOW)
        .map_err(|e| ipc_error("board_scope_flags:read", e))?;
    Ok(counts.into_iter().map(|c| ScopeFlagDto { task_id: c.task_id, count: c.count }).collect())
}

/// One declaration of a task's file-set, as the log recorded it. `draftedByAgent` on the wire is the core's
/// verdict (the declaring actor's kind), never something the renderer works out for itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSetDeclarationDto {
    pub actor_name: String,
    #[serde(rename = "draftedByAgent")]
    pub agent_drafted: bool,
    pub declared_at: String,
    pub before: Vec<String>,
    pub entries: Vec<String>,
    pub undeclared: bool,
}

/// The latest declaration of a task's set flat, plus the older ones. A task nobody declared has no
/// provenance at all (the command returns `None`), so no author is invented for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSetProvenanceDto {
    #[serde(flatten)]
    pub latest: FileSetDeclarationDto,
    pub history: Vec<FileSetDeclarationDto>,
    pub history_truncated: bool,
}

fn declaration_dto(d: flywheel_core::query::file_set_provenance::FileSetDeclaration) -> FileSetDeclarationDto {
    FileSetDeclarationDto {
        actor_name: d.actor_name,
        agent_drafted: d.agent_drafted,
        declared_at: d.declared_at,
        before: d.before,
        entries: d.entries,
        undeclared: d.undeclared,
    }
}

/// Who declared a task's file-set and whether an agent did, derived from the event log (D-19).
/// Read-only; a task id and nothing else.
#[tauri::command]
pub fn task_file_set_provenance(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<FileSetProvenanceDto>, String> {
    validate_task_id(&task_id)?;
    let conn = state.db.lock().map_err(|e| ipc_error("task_file_set_provenance:lock", e))?;
    let provenance = flywheel_core::query::file_set_provenance::file_set_provenance(&conn, &task_id)
        .map_err(|e| ipc_error("task_file_set_provenance:read", e))?;
    Ok(provenance.map(|p| FileSetProvenanceDto {
        latest: declaration_dto(p.latest),
        history: p.history.into_iter().map(declaration_dto).collect(),
        history_truncated: p.history_truncated,
    }))
}

/// The most tracked paths one autocomplete read returns. A repository bigger than this is told so
/// through `not_shown`; the list is never silently cut.
pub const MAX_TRACKED_PATHS: usize = 5000;

/// The repository's tracked paths for the file-set chip editor's autocomplete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedPathsDto {
    pub paths: Vec<String>,
    /// How many tracked paths were left out because the list is bounded.
    pub not_shown: usize,
}

pub(crate) fn bound_tracked_paths(mut paths: Vec<String>) -> TrackedPathsDto {
    let not_shown = paths.len().saturating_sub(MAX_TRACKED_PATHS);
    paths.truncate(MAX_TRACKED_PATHS);
    TrackedPathsDto { paths, not_shown }
}

/// The plan's repository's tracked paths, for autocomplete. The mechanism is `git ls-files` through
/// `flywheel_core::git::tracked_files` (a deadline-watched system `git` child): tracked files only, so
/// gitignored output and untracked secrets are never offered, and no libgit2 or filesystem walk is
/// involved (CLAUDE.md). Takes a plan id and nothing else; the repository path is resolved here.
#[tauri::command]
pub fn repo_tracked_paths(state: State<AppState>, plan_id: String) -> Result<TrackedPathsDto, String> {
    if !flywheel_core::ids::is_ulid(&plan_id) {
        return Err(format!("plan id must be a 26-character ULID, got {plan_id:?}"));
    }
    // Short lock for the path, dropped before the git subprocess runs (D-REV-39 WR-07).
    let repo_path = {
        let conn = state.db.lock().map_err(|e| ipc_error("repo_tracked_paths:lock", e))?;
        flywheel_core::domain::dispatch_plan::plan_repo_path(&conn, &plan_id)
            .map_err(|e| ipc_error("repo_tracked_paths:repo", e))?
    };
    let paths = flywheel_core::git::tracked_files(std::path::Path::new(&repo_path))
        .map_err(|e| ipc_error("repo_tracked_paths:ls-files", e))?;
    Ok(bound_tracked_paths(paths))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh migrated database with one project and one task. Returns the connection, the human
    /// actor id and the task id.
    fn seeded() -> (Connection, String, String) {
        let dir = tempfile::tempdir().expect("scratch dir");
        let db_path = dir.path().join("flywheel.db");
        let backups_dir = dir.path().join("backups");
        std::mem::forget(dir);
        let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
            .expect("open_and_migrate should succeed");
        let actor = flywheel_core::domain::actor::local_human_actor_id(&conn).expect("human actor");
        let project = flywheel_core::domain::project::create_project(
            &mut conn, &actor, "Test Project", "/repo", "FLY", "main",
        )
        .expect("create_project");
        let task = flywheel_core::domain::task::create_task(&mut conn, &project.id, &actor, "T", None)
            .expect("create_task");
        (conn, actor, task.id)
    }

    #[test]
    fn a_widen_with_no_collision_is_accepted_and_returns_the_new_set() {
        let (mut conn, actor, task_id) = seeded();
        let entry = flywheel_core::file_set::parse_entry("a/").unwrap();
        flywheel_core::domain::file_set::declare_file_set(&mut conn, &task_id, &[entry], &actor).unwrap();
        let r = widen_task_file_set(&mut conn, &task_id, "b.rs", &actor, false).unwrap();
        assert_eq!(r.status, "accepted");
        assert_eq!(r.entries, vec!["a/".to_string(), "b.rs".to_string()]);
        assert!(r.refusal.is_none());
    }

    #[test]
    fn a_glob_widen_is_a_refusal_the_renderer_can_show_not_an_ipc_error() {
        let (mut conn, actor, task_id) = seeded();
        let r = widen_task_file_set(&mut conn, &task_id, "src/*.rs", &actor, false).unwrap();
        assert_eq!(r.status, "refused");
        assert!(r.refusal.unwrap().contains("glob"));
    }

    #[test]
    fn a_malformed_task_id_and_an_oversized_entry_are_refused_before_the_database() {
        let (mut conn, actor, task_id) = seeded();
        assert!(widen_task_file_set(&mut conn, "../x", "a.rs", &actor, false).unwrap_err().contains("task id"));
        let long = "a".repeat(MAX_ENTRY_CHARS + 1);
        assert!(widen_task_file_set(&mut conn, &task_id, &long, &actor, false).is_err());
    }

    #[test]
    fn the_widen_handler_accepts_no_actor_and_no_path_argument() {
        let source = include_str!("file_set.rs");
        let code: Vec<&str> = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect();
        let start = code
            .iter()
            .position(|l| l.trim_start().starts_with("pub fn task_file_set_widen("))
            .expect("the task_file_set_widen command handler must exist");
        let mut signature = String::new();
        for line in &code[start..] {
            signature.push_str(line);
            signature.push(' ');
            if line.contains('{') {
                break;
            }
        }
        assert!(!signature.contains("actor"), "no renderer-supplied actor: {signature}");
        assert!(!signature.contains("marker"), "no marker path: {signature}");
        assert!(!signature.contains("worktree"), "no worktree path: {signature}");
    }

    #[test]
    fn the_scope_flags_handler_accepts_a_project_id_and_nothing_else() {
        let source = include_str!("file_set.rs");
        let code: Vec<&str> = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect();
        let start = code
            .iter()
            .position(|l| l.trim_start().starts_with("pub fn board_scope_flags("))
            .expect("the board_scope_flags command handler must exist");
        let mut signature = String::new();
        for line in &code[start..] {
            signature.push_str(line);
            signature.push(' ');
            if line.contains('{') {
                break;
            }
        }
        assert!(signature.contains("project_id"));
        for banned in ["path", "task_id", "limit", "actor"] {
            assert!(!signature.contains(banned), "no {banned} argument: {signature}");
        }
    }

    #[test]
    fn a_tracked_path_list_over_the_bound_is_cut_and_says_how_many_were_left_out() {
        let all: Vec<String> = (0..MAX_TRACKED_PATHS + 3).map(|i| format!("f/{i}.rs")).collect();
        let bounded = bound_tracked_paths(all);
        assert_eq!(bounded.paths.len(), MAX_TRACKED_PATHS);
        assert_eq!(bounded.not_shown, 3);
        assert_eq!(bound_tracked_paths(vec!["a.rs".into()]).not_shown, 0);
    }

    #[test]
    fn the_provenance_wire_flattens_the_latest_declaration_and_names_the_agent_flag_for_the_renderer() {
        let dto = FileSetProvenanceDto {
            latest: FileSetDeclarationDto {
                actor_name: "Claude".into(),
                agent_drafted: true,
                declared_at: "t".into(),
                before: vec![],
                entries: vec!["a.rs".into()],
                undeclared: false,
            },
            history: vec![],
            history_truncated: false,
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["draftedByAgent"], true);
        assert_eq!(json["entries"], serde_json::json!(["a.rs"]));
        assert_eq!(json["historyTruncated"], false);
    }

    #[test]
    fn the_provenance_and_tracked_path_handlers_take_an_id_and_nothing_else() {
        let source = include_str!("file_set.rs");
        let code: Vec<&str> = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect();
        for (name, id) in [("pub fn task_file_set_provenance(", "task_id"), ("pub fn repo_tracked_paths(", "plan_id")] {
            let start = code.iter().position(|l| l.trim_start().starts_with(name)).expect(name);
            let mut signature = String::new();
            for line in &code[start..] {
                signature.push_str(line);
                signature.push(' ');
                if line.contains('{') {
                    break;
                }
            }
            assert!(signature.contains(id), "{name}: {signature}");
            for banned in ["actor", "worktree", "repo_path", "pattern"] {
                assert!(!signature.contains(banned), "{name} must not take {banned}: {signature}");
            }
        }
    }
}
