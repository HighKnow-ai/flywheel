//! LINK-11's command surface (D-130, 07-04-PLAN.md Task 2): `worktree_open` is the renderer's
//! only route to a process — the renderer itself holds no shell capability at all
//! (`capabilities/default.json`'s own header comment). It locks `AppState.db` only long enough to
//! have `packages/core` resolve the full argv from the stored template and the Story's own
//! worktree, drops the lock, then spawns that argv directly with no shell interpreter of any
//! kind. The renderer supplies only a Story id and one of two enum surfaces — no program name,
//! argument or path ever crosses the IPC boundary (T-07-04-02).
//!
//! `open_command_template`/`set_open_command_template` are the Settings surface's read/write pair
//! for the two stored templates (D-130) — thin command wrappers over
//! `flywheel_core::domain::worktree::open_command_template`/`set_open_command_template`, exact
//! structural siblings of `commands::settings`'s `settings_get`/`settings_set_credential_mode`.
//! Named without the `worktree_` prefix the other commands in this file carry so that no other
//! registered command name in `main.rs`'s `generate_handler!` list begins with the literal text
//! `worktree_open` except [`worktree_open`] itself.

use tauri::State;

use crate::state::AppState;

/// Spawn `story_id`'s worktree-open argv for `surface` (D-130). Resolves the argv inside
/// `packages/core` from the stored template and the Story's own `worktrees` row, then spawns it
/// directly — `Command::new(&argv[0]).args(&argv[1..])`, never a shell, never a joined command
/// line (T-07-04-01). The spawn is detached: this command does not wait on the child, since the
/// user's editor or terminal outliving the call is the point (T-07-04-04), and the database lock
/// is dropped before the spawn so a slow or hanging editor can never hold the connection.
///
/// The `.current_dir(worktree_path)` parameter is named `worktree_path` so
/// `packages/core/tests/supervisor_cwd.rs`'s absolute-path source gate holds by name as well as
/// in fact (T-07-04-03) — the path comes from the `worktrees` row this application wrote, never
/// from the renderer.
///
/// A spawn error of kind `NotFound` is mapped to an error naming the program that was not found,
/// so a template pointing at a missing editor reports *which* program is missing rather than a
/// generic failure (T-07-04-05); any other spawn error is mapped to its own text.
#[tauri::command]
pub async fn worktree_open(
    state: State<'_, AppState>,
    story_id: String,
    surface: flywheel_core::domain::worktree::OpenSurface,
) -> Result<(), String> {
    let (argv, worktree_path) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let argv = flywheel_core::domain::worktree::resolve_open_argv(&conn, &story_id, surface)
            .map_err(|e| e.to_string())?;
        // Read the worktree's own path directly for `.current_dir()` below, rather than
        // guessing which argv element it landed in — the token can appear anywhere in the
        // template, not only as the final element.
        let worktree = flywheel_core::domain::worktree::worktree_for_story(&conn, &story_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("no worktree exists for Story {story_id:?}"))?;
        // The project's directory in the worktree, the same one the argv names.
        (argv, worktree.project_dir().to_string_lossy().into_owned())
        // The lock guard drops here, at the end of this block — before the spawn below.
    };

    // The spawn runs on the blocking pool, never the thread IPC dispatches on (issue #220).
    tauri::async_runtime::spawn_blocking(move || spawn_open(&argv, &worktree_path))
        .await
        .map_err(|e| super::ipc_error("worktree_open:join", e))?
}

/// Spawn the resolved `argv` in `worktree_path`, without waiting for it.
fn spawn_open(argv: &[String], worktree_path: &str) -> Result<(), String> {
    let Some((program, args)) = argv.split_first() else {
        return Err("resolved an empty argv — nothing to spawn".to_string());
    };

    std::process::Command::new(program)
        .args(args)
        .current_dir(worktree_path)
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                format!("couldn't find \"{program}\" — check the command template in Settings")
            }
            _ => e.to_string(),
        })?;

    Ok(())
}

/// `surface`'s stored open-command template, or its own default when unset (D-130) — the
/// Settings surface's pre-filled field value. Read-only. Thin wrapper over
/// `flywheel_core::domain::worktree::open_command_template`.
#[tauri::command]
pub fn open_command_template(
    state: State<AppState>,
    surface: flywheel_core::domain::worktree::OpenSurface,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::worktree::open_command_template(&conn, surface)
        .map_err(|e| e.to_string())
}

/// Set `surface`'s stored open-command template (D-130). `actor_id` is resolved server-side
/// (T-01-04), never accepted from the renderer. Rejects an empty or whitespace-only template —
/// the core's own rejection text surfaces to the Settings field rather than storing it. Thin
/// wrapper over `flywheel_core::domain::worktree::set_open_command_template`.
#[tauri::command]
pub fn set_open_command_template(
    state: State<AppState>,
    surface: flywheel_core::domain::worktree::OpenSurface,
    template: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::worktree::set_open_command_template(
        &mut conn, &actor_id, surface, &template,
    )
    .map_err(|e| e.to_string())
}
