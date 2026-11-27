//! Launching a Story's session. One interface, [`launch`], for every way a session starts; the
//! process-facing steps (the claude binary, the credential environment, the PATH shim, the spawn
//! request) sit behind [`LaunchPort`], which the desktop app fulfils.
//!
//! Only the attended mode exists: a developer pressed Start or Resume.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::domain::session_kind::SessionKind;
use crate::domain::story::StoryState;

/// Who is at the keyboard when the launch happens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Attended,
}

/// Why a session is launched. Each intent carries its own entry rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Intent<'a> {
    /// Ready, then Running (docs/mvp-spec.md §2).
    Start { instruction: &'a str },
    /// A Stopped Story gets a fresh session; its state does not move (§4.5).
    Resume { note: &'a str },
}

/// A launch that went out: the session row exists and the spawn request was sent.
#[derive(Debug)]
pub struct Launched(pub StartRunOutcome);

/// A launch that did not go out, with the sentence to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused(pub String);

impl From<String> for Refused {
    fn from(reason: String) -> Self {
        Refused(reason)
    }
}

/// The process-facing steps of a launch. `send` is the one place a spawn request leaves the app.
pub trait LaunchPort {
    /// Refuse, naming the `PATH` searched, when there is no `claude` to spawn (issue #88).
    fn find_claude(&mut self) -> Result<(), String>;
    /// The credential and the environment additions for a spawn on `project_id` (D-39).
    fn resolve_env(
        &mut self,
        conn: &Connection,
        project_id: &str,
    ) -> anyhow::Result<HashMap<String, String>>;
    fn merge_shim(&mut self, env: &mut HashMap<String, String>, run_id: &str)
        -> anyhow::Result<()>;
    /// Must not be called under the board mutex: the per-repository spawn floor sleeps inside it.
    fn send(&mut self, repo_path: &str, request: &serde_json::Value) -> Result<(), String>;
}

/// Launch a session on `story_id`. The caller holds the Story's work lock and passes a connection
/// that is not the board mutex's. The Story moves to Running only once the spawn request went out:
/// a launch that fails leaves it as it was, its session `failed` and its worktree in place.
pub fn launch(
    conn: &mut Connection,
    port: &mut impl LaunchPort,
    story_id: &str,
    intent: Intent<'_>,
    mode: Mode,
) -> Result<Launched, Refused> {
    match mode {
        Mode::Attended => launch_attended(conn, port, story_id, intent),
    }
}

fn launch_attended(
    conn: &mut Connection,
    port: &mut impl LaunchPort,
    story_id: &str,
    intent: Intent<'_>,
) -> Result<Launched, Refused> {
    let instruction = match intent {
        Intent::Start { instruction } => {
            let current = crate::domain::story::get_story(conn, story_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Story {story_id:?} not found"))?
                .state;
            if current != StoryState::Ready.as_str() {
                return Err(Refused(format!(
                    "Start needs a Ready Story; this one is {current}"
                )));
            }
            instruction
        }
        Intent::Resume { note } => {
            if crate::query::sessions::stopped_session_for_story(conn, story_id)
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Err(Refused(
                    "Resume needs a Stopped Story: Running, with no live session".to_string(),
                ));
            }
            note
        }
    };
    port.find_claude()?;
    let outcome = launch_session(conn, port, story_id, SessionKind::Story, instruction)?;
    if matches!(intent, Intent::Start { .. }) {
        let human = crate::domain::actor::local_human_actor_id(conn).map_err(|e| e.to_string())?;
        crate::domain::story::set_story_state(conn, &human, story_id, StoryState::Running)
            .map_err(|e| {
                format!("the session started, but the Story could not move to Running: {e}")
            })?;
    }
    Ok(Launched(outcome))
}

/// The session row and the spawn, with no entry rule: for a caller whose own state move already
/// decided the Story may run (Request changes).
pub fn launch_session(
    conn: &mut Connection,
    port: &mut impl LaunchPort,
    story_id: &str,
    kind: SessionKind,
    instruction: &str,
) -> Result<StartRunOutcome, String> {
    let PreparedLaunch {
        outcome,
        repo_path,
        env,
    } = prepare_launch(conn, port, story_id, kind, instruction)?;
    spawn_prepared_run(conn, port, &outcome, env, kind, &repo_path)?;
    Ok(outcome)
}

/// What [`start_session_recording_first`] produced: the DB-only half of a start's outcome,
/// everything the process-facing half needs without touching the database again.
#[derive(Debug)]
pub struct StartRunOutcome {
    pub run_id: String,
    pub worktree_path: String,
    /// Where the session runs: the project's directory in the worktree. It is `worktree_path`
    /// itself unless the project is a subdirectory of a larger repository.
    pub working_dir: String,
    /// The Story's own branch, checked out in `worktree_path`.
    pub branch: String,
    pub prompt: String,
}

/// Performs, in exactly this order:
/// 1. `start_session` (the worktree and the session row).
/// 2. `build_context_packet`, with the instruction as its resume note.
/// 3. the read of the session's worktree: its path, the project's directory in it, and its branch.
///
/// Steps 2-3 run AFTER the session row exists, so an error from either closes that row `failed`
/// before it propagates (D-REV-46): a `running` row with no session behind it would read as live
/// until the app restarts.
pub fn start_session_recording_first(
    conn: &mut Connection,
    story_id: &str,
    permission_mode: &str,
    instruction: &str,
    human_actor_id: &str,
) -> Result<StartRunOutcome, String> {
    let run =
        crate::domain::session::start_session(conn, story_id, permission_mode, human_actor_id)
            .map_err(|e| e.to_string())?;

    let built = (|| -> Result<(String, String, String, String), String> {
        let prompt = crate::context_packet::build_context_packet(conn, story_id, instruction)
            .map_err(|e| e.to_string())?;
        // A Story has one worktree, and `start_session` just ensured it.
        let worktree = crate::domain::worktree::worktree_for_story(conn, story_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                format!("the worktree of the session just started on Story {story_id:?} is gone")
            })?;
        let working_dir = worktree.project_dir().to_string_lossy().into_owned();
        Ok((prompt, worktree.path, working_dir, worktree.branch))
    })();
    let (prompt, worktree_path, working_dir, branch) = match built {
        Ok(v) => v,
        Err(why) => return Err(fail_launch(conn, &run.id, why)),
    };

    Ok(StartRunOutcome {
        run_id: run.id,
        worktree_path,
        working_dir,
        branch,
        prompt,
    })
}

/// Close a session whose launch failed after its row was inserted, and hand `why` back for the
/// caller to return. The one place that decides what a failed launch leaves behind: a `failed`
/// row, never a `running` one (D-REV-46). Best-effort on the close itself: the original failure is
/// the error worth reporting.
pub fn fail_launch(conn: &mut Connection, run_id: &str, why: String) -> String {
    let _ = crate::domain::session::close_session(
        conn,
        run_id,
        crate::domain::session::SessionStatus::Failed,
        None,
        None,
        None,
    );
    why
}

/// Everything the database half of a launch produced; [`spawn_prepared_run`] finishes the
/// process-facing half from it.
pub struct PreparedLaunch {
    pub outcome: StartRunOutcome,
    pub repo_path: String,
    pub env: HashMap<String, String>,
}

/// The database half of a launch: actor, credential, the live-session refusal, the session row.
pub fn prepare_launch(
    conn: &mut Connection,
    port: &mut impl LaunchPort,
    story_id: &str,
    kind: SessionKind,
    instruction: &str,
) -> Result<PreparedLaunch, String> {
    let initiator_id =
        crate::domain::actor::local_human_actor_id(conn).map_err(|e| e.to_string())?;

    // Resolve the credential BEFORE any session/worktree state is created (D-39, T-02-42): a
    // missing API key must never leave behind a `running` row and a worktree nothing spawns into.
    // `repo_path` keys the per-repository spawn floor (D-52).
    let (project_id, repo_path): (String, String) = conn
        .query_row(
            "SELECT stories.project_id, projects.repo_path
             FROM stories
             JOIN projects ON projects.id = stories.project_id
             WHERE stories.id = ?1",
            rusqlite::params![story_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let env = port
        .resolve_env(conn, &project_id)
        .map_err(|e| e.to_string())?;

    // A second agent in the same worktree corrupts the work: a Story whose own session is live
    // refuses, before anything is created.
    let live: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM sessions WHERE story_id = ?1 AND status IN ('running', 'blocked'))",
            rusqlite::params![story_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if live {
        return Err(
            "This Story already has a running or blocked session. A second agent in the same \
                    worktree would corrupt the work, so this launch is refused."
                .to_string(),
        );
    }

    let outcome = start_session_recording_first(
        conn,
        story_id,
        kind.launch_policy().permission_mode,
        instruction,
        &initiator_id,
    )?;
    Ok(PreparedLaunch {
        outcome,
        repo_path,
        env,
    })
}

/// The process-facing half of a launch, after [`prepare_launch`] inserted the session row: the shim
/// env merge, then the spawn request through the port's one gated path.
///
/// D-51: the shim's per-run directory is keyed by the session id, which only exists from
/// `prepare_launch` on, so a shim-install failure here refuses the spawn. `conn` is the launch's
/// own side connection, never the board mutex's guard: the spawn floor sleeps inside `send`
/// (T-03-04-05, issue #215).
pub fn spawn_prepared_run(
    conn: &mut Connection,
    port: &mut impl LaunchPort,
    outcome: &StartRunOutcome,
    mut env: HashMap<String, String>,
    kind: SessionKind,
    repo_path: &str,
) -> Result<(), String> {
    port.merge_shim(&mut env, &outcome.run_id)
        .map_err(|e| fail_launch(conn, &outcome.run_id, e.to_string()))?;
    // The Gated-action deny-list allows a recursive `rm` inside, and deleting or rewriting, only the
    // Story's own worktree and branch, so the shim needs to know which ones those are.
    env.insert(
        crate::destructive::WORKTREE_ENV.to_string(),
        outcome.worktree_path.clone(),
    );
    env.insert(
        crate::destructive::STORY_BRANCH_ENV.to_string(),
        outcome.branch.clone(),
    );

    let request = spawn_request(outcome, &env, kind);
    port.send(repo_path, &request)
        .map_err(|why| fail_launch(conn, &outcome.run_id, why))
}

/// The sidecar's `spawn` request for a session of `kind`. The kind alone fixes the permission mode,
/// the allowed and refused tools, and whether the session may raise a permission request
/// ([`SessionKind::launch_policy`]); the sidecar turns them into Claude Code flags and decides none
/// of them.
pub fn spawn_request(
    outcome: &StartRunOutcome,
    env: &HashMap<String, String>,
    kind: SessionKind,
) -> serde_json::Value {
    spawn_request_in(
        &outcome.run_id,
        &outcome.working_dir,
        &outcome.prompt,
        env,
        kind,
    )
}

/// [`spawn_request`] for a session that runs in `cwd`: a Story session's worktree, or the project's
/// checkout for a shaping session, which has no worktree (issue #122). The sidecar's field keeps
/// its `worktreePath` name; it is the session's working directory either way.
pub fn spawn_request_in(
    run_id: &str,
    cwd: &str,
    prompt: &str,
    env: &HashMap<String, String>,
    kind: SessionKind,
) -> serde_json::Value {
    let policy = kind.launch_policy();
    // The kind's own env wins over the resolved one: nothing upstream can lower a Story session's
    // MCP tool timeouts (issue #92).
    let mut env = env.clone();
    env.extend(
        policy
            .env
            .iter()
            .map(|(name, value)| (name.to_string(), value.clone())),
    );
    serde_json::json!({
        "id": run_id,
        "op": "spawn",
        "runId": run_id,
        "worktreePath": cwd,
        "prompt": prompt,
        "permissionMode": policy.permission_mode,
        "allowedTools": policy.allowed_tools,
        "disallowedTools": policy.disallowed_tools,
        "permissionPrompt": policy.raises_requests,
        // The board's MCP server lists each kind only its own tools (issue #123).
        "sessionKind": kind.as_str(),
        "env": env,
    })
}
