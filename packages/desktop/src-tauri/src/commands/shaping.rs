//! `epic_shape` / `epic_shaping_session` — the shaping command surface (docs/mvp-spec.md §3,
//! issue #122). Shape on an Epic in Shaping starts a shaping session on it: no worktree, its working
//! directory the project's own checkout, its packet `flywheel_core::shaping_packet`, and its launch
//! flags fixed by `SessionKind::Shaping` (read-only plus the Proposal tools, `dontAsk`, the board's
//! MCP server and no permission-prompt tool). Ending it is the session surface's ordinary Stop.
//!
//! Every handler resolves the human actor server-side (T-01-04) and emits `board:changed` after a
//! successful start, so the Epic card's Shape control turns into Open session.
//!
//! Rounds (issue #123): a shaping session's `round_post` reaches [`handle_shaping_tool_request`]
//! through the board tool router and is held. The dock answers its questions through
//! [`round_accept`], [`round_answer`] and [`round_accept_all`], each one transaction; the answer that
//! completes the Round answers the held call through `send_board_tool_answer`, once the lock is
//! released.

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, State};

use flywheel_core::domain::round::{AnswerOutcome, RoundAnswer, RoundRelease};
use flywheel_core::domain::session::ShapingSubject;
use flywheel_core::domain::session_kind::SessionKind;

use super::session::{fail_launch, send_gated_spawn, spawn_request_in};
use super::task::send_board_tool_answer;
use super::{emit_board_changed, project_of_locked, validate_text};
use crate::state::AppState;

/// A shaping session as Shape returns it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapingSessionDto {
    pub id: String,
    pub epic_id: String,
    pub status: String,
    pub permission_mode: String,
}

/// Shape on an Epic in Shaping (issue #122): start a shaping session on it.
#[tauri::command]
pub fn epic_shape(state: State<AppState>, app: AppHandle, epic_id: String) -> Result<ShapingSessionDto, String> {
    let run_id = shape_epic(&state.db, &epic_id, flywheel_core::login_path::claude_bin, |repo_path, request| {
        send_gated_spawn(&state, repo_path, request)
    })?;
    let project_id = project_of_locked(&state.db, "epics", &epic_id);
    emit_board_changed(&app, project_id.as_deref(), "session", Some(&run_id));
    Ok(ShapingSessionDto {
        id: run_id,
        epic_id,
        status: "running".to_string(),
        permission_mode: SessionKind::Shaping.launch_policy().permission_mode.to_string(),
    })
}

/// The Epic's live shaping session, if any: what the card's Open session control opens.
#[tauri::command]
pub fn epic_shaping_session(state: State<AppState>, epic_id: String) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::session::live_shaping_session(&conn, &ShapingSubject::Epic(epic_id)).map_err(|e| e.to_string())
}

/// A Stage as the Epic's shaping view reads it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDto {
    pub id: String,
    /// `challenge_spec`, `slice`, `criteria` or `exit_test`.
    pub kind: String,
    /// `open` or `closed`.
    pub state: String,
    pub rank: i64,
}

/// One question of a Round, with its answer once given.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundQuestionDto {
    pub id: String,
    pub number: i64,
    pub title: String,
    pub question: String,
    pub grounding: String,
    pub recommended_answer: String,
    pub because: String,
    pub answer: Option<String>,
    /// `recommended` or `own`, once answered.
    pub answered_with: Option<String>,
    pub answered_at: Option<String>,
}

/// A Round with its questions, in order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundDto {
    pub id: String,
    pub stage_id: String,
    pub stage_kind: String,
    pub number: i64,
    pub note: String,
    /// `open` or `answered`.
    pub state: String,
    /// Whether the session that posted it still waits on its answers.
    pub held: bool,
    pub posted_at: String,
    pub answered_at: Option<String>,
    pub questions: Vec<RoundQuestionDto>,
}

/// What the Epic's shaping view reads: the Epic, its Stages in order and every Round, oldest first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicShapingDto {
    pub epic: super::epic::EpicDto,
    pub stages: Vec<StageDto>,
    pub rounds: Vec<RoundDto>,
    /// The Epic's undecided and rejected Proposals, oldest first (issue #125): ghost fields and
    /// struck-through lines. An accepted one is in the field it rewrote.
    pub proposals: Vec<super::proposal::ProposalDto>,
}

impl From<flywheel_core::domain::round::Round> for RoundDto {
    fn from(r: flywheel_core::domain::round::Round) -> Self {
        Self {
            id: r.id,
            stage_id: r.stage_id,
            stage_kind: r.stage_kind.as_str().to_string(),
            number: r.number,
            note: r.note,
            state: r.state,
            held: r.held_request_id.is_some(),
            posted_at: r.posted_at,
            answered_at: r.answered_at,
            questions: r
                .questions
                .into_iter()
                .map(|q| RoundQuestionDto {
                    id: q.id,
                    number: q.number,
                    title: q.title,
                    question: q.question,
                    grounding: q.grounding,
                    recommended_answer: q.recommended_answer,
                    because: q.because,
                    answer: q.answer,
                    answered_with: q.answered_with,
                    answered_at: q.answered_at,
                })
                .collect(),
        }
    }
}

/// The Epic's Stages and Rounds (issue #123): what the dock shows.
#[tauri::command]
pub fn epic_shaping_rounds(state: State<AppState>, epic_id: String) -> Result<EpicShapingDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    read_epic_shaping(&conn, &epic_id)
}

pub(crate) fn read_epic_shaping(conn: &Connection, epic_id: &str) -> Result<EpicShapingDto, String> {
    let epic = flywheel_core::domain::epic::get_epic(conn, epic_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Epic {epic_id:?} not found"))?;
    let epic = super::epic::to_dto(conn, epic)?;
    let stages = flywheel_core::domain::stage::stages_for_epic(conn, epic_id).map_err(|e| e.to_string())?;
    let rounds = flywheel_core::domain::round::rounds_for_epic(conn, epic_id).map_err(|e| e.to_string())?;
    let proposals = flywheel_core::domain::proposal::proposals_on_epic(conn, epic_id).map_err(|e| e.to_string())?;
    Ok(EpicShapingDto {
        proposals: proposals.into_iter().filter(|p| p.state != "accepted").map(Into::into).collect(),
        epic,
        stages: stages
            .into_iter()
            .map(|s| StageDto { id: s.id, kind: s.kind.as_str().to_string(), state: s.state, rank: s.rank })
            .collect(),
        rounds: rounds.into_iter().map(RoundDto::from).collect(),
    })
}

/// Accept a question's recommended answer as it is (issue #123). Human-only.
#[tauri::command]
pub fn round_accept(state: State<AppState>, app: AppHandle, question_id: String) -> Result<(), String> {
    let outcome = answer_and_release(&state.db, |conn, human| {
        flywheel_core::domain::round::answer_round_question(conn, human, &question_id, &RoundAnswer::Recommended)
    })?;
    settle(&app, outcome);
    Ok(())
}

/// Answer a question in the developer's own words (issue #123). Human-only.
#[tauri::command]
pub fn round_answer(state: State<AppState>, app: AppHandle, question_id: String, answer: String) -> Result<(), String> {
    validate_text("answer", &answer, flywheel_core::domain::round::MAX_ROUND_TEXT_LEN)?;
    let outcome = answer_and_release(&state.db, |conn, human| {
        flywheel_core::domain::round::answer_round_question(conn, human, &question_id, &RoundAnswer::Own(answer.clone()))
    })?;
    settle(&app, outcome);
    Ok(())
}

/// Accept the recommended answer of every question still open in a Round (issue #123). Questions
/// only: no Proposal is decided here. Human-only.
#[tauri::command]
pub fn round_accept_all(state: State<AppState>, app: AppHandle, round_id: String) -> Result<(), String> {
    let outcome = answer_and_release(&state.db, |conn, human| {
        flywheel_core::domain::round::accept_all_recommended(conn, human, &round_id)
    })?;
    settle(&app, outcome);
    Ok(())
}

/// Run one answer as the local human, with the lock released before anything is relayed.
pub(crate) fn answer_and_release(
    db: &std::sync::Mutex<Connection>,
    answer: impl FnOnce(&mut Connection, &str) -> anyhow::Result<AnswerOutcome>,
) -> Result<AnswerOutcome, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    answer(&mut conn, &human).map_err(|e| format!("{e:#}"))
}

/// After an answer committed: answer the held `round_post` call when the Round is complete, then
/// tell the renderer the board changed.
fn settle(app: &AppHandle, outcome: AnswerOutcome) {
    if let Some(release) = &outcome.release {
        send_board_tool_answer(app, &release.session_id, &release.request_id, &release_answer(release));
    }
    emit_board_changed(app, Some(&outcome.project_id), "round", Some(&outcome.round_id));
}

/// The `board_tool_answer` body that settles a held `round_post`: `{result}` with every answer.
pub(crate) fn release_answer(release: &RoundRelease) -> serde_json::Value {
    serde_json::json!({ "result": release.result })
}

/// The core's handling of one shaping tool call (issue #123), as `handle_inbound_board_tool_request`
/// routes it: `(Some(answer), _)` to answer at once (a refusal with its reason, or a filed Proposal),
/// or `(None, project)` when the call is held until the developer answers the Round it posted. The
/// project is `Some` whenever the board changed.
pub(crate) fn answer_shaping_tool_call(
    conn: &mut Connection,
    run_id: &str,
    request_id: &str,
    tool: &str,
    args: &serde_json::Value,
) -> (Option<serde_json::Value>, Option<String>) {
    use flywheel_core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome};
    match ShapingToolCall::parse(tool, args).and_then(|call| apply_shaping_tool_call(conn, run_id, request_id, &call)) {
        Ok(ShapingToolOutcome::Held { project_id, .. }) => (None, Some(project_id)),
        // Issue #125: a Proposal never holds the agent.
        Ok(ShapingToolOutcome::Answered { result, project_id }) => (Some(serde_json::json!({ "result": result })), Some(project_id)),
        // The reason goes to the agent so it can correct its call.
        Err(e) => (Some(serde_json::json!({ "error": format!("{e:#}") })), None),
    }
}

/// The Tauri-facing half of the shaping tools, called from `task.rs`'s board tool router: run the
/// call, answer it at once only when it was refused, and emit `board:changed` when a Round landed.
/// A held call is answered later, by [`settle`], once its Round's last question is answered. Must
/// never panic: a poisoned lock is a silent no-op, and the agent's call then ends with its session.
pub(crate) fn handle_shaping_tool_request(app: &AppHandle, run_id: &str, request_id: &str, tool: &str, args: &serde_json::Value) {
    let Some(state) = tauri::Manager::try_state::<AppState>(app) else { return };
    let (answer, changed) = {
        let Ok(mut conn) = state.db.lock() else { return };
        answer_shaping_tool_call(&mut conn, run_id, request_id, tool, args)
    };
    if let Some(answer) = answer {
        send_board_tool_answer(app, run_id, request_id, &answer);
    }
    if let Some(project_id) = changed {
        emit_board_changed(app, Some(&project_id), if tool == "round_post" { "round" } else { "proposal" }, None);
    }
}

/// [`epic_shape`]'s body, driven without a Tauri app handle. `find_claude` runs before anything is
/// created, so a missing `claude` refuses the Shape and writes nothing (issue #88). The core refuses
/// an Epic that is not in Shaping or already has a live shaping session, inside the transaction that
/// would insert the row. The spawn request goes out once the lock is released (the spawn floor
/// sleeps); a launch that fails after the row exists closes it `failed`, never left `running`.
pub(crate) fn shape_epic(
    db: &std::sync::Mutex<Connection>,
    epic_id: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let (project_id, repo_path): (String, String) = conn
        .query_row(
            "SELECT e.project_id, p.repo_path FROM epics e JOIN projects p ON p.id = e.project_id WHERE e.id = ?1",
            rusqlite::params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| format!("Epic {epic_id:?} not found"))?;
    find_claude()?;
    // Resolved before the row exists: a missing API key must not leave a `running` row behind.
    let env = crate::sidecar::resolved_env_for_run(&conn, &project_id).map_err(|e| e.to_string())?;

    let kind = SessionKind::Shaping;
    let session = flywheel_core::domain::session::start_shaping_session(
        &mut conn,
        &ShapingSubject::Epic(epic_id.to_string()),
        kind.launch_policy().permission_mode,
        &human,
    )
    .map_err(|e| e.to_string())?;
    let prompt = match flywheel_core::shaping_packet::build_epic_shaping_packet(&conn, epic_id) {
        Ok(prompt) => prompt,
        Err(e) => return Err(fail_launch(&mut conn, &session.id, e.to_string())),
    };
    drop(conn);

    let request = spawn_request_in(&session.id, &repo_path, &prompt, &env, kind);
    send(&repo_path, &request).map_err(|why| match db.lock() {
        Ok(mut conn) => fail_launch(&mut conn, &session.id, why),
        Err(_) => why,
    })?;
    Ok(session.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::session::scratch_root;

    /// A migrated database, a project whose checkout is a plain directory (a shaping session never
    /// touches git), a Milestone and an Epic in Shaping with no Story.
    fn shaping_epic() -> (std::sync::Mutex<Connection>, String, tempfile::TempDir) {
        let checkout = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut conn = flywheel_core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
            .unwrap();
        std::mem::forget(dir);
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
        let project = flywheel_core::domain::project::create_project(
            &mut conn,
            &human,
            "Threadfin",
            &checkout.path().to_string_lossy(),
            "FLY",
            "main",
        )
        .unwrap();
        let m = flywheel_core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
        let epic = flywheel_core::domain::epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
        (std::sync::Mutex::new(conn), epic.id, checkout)
    }

    fn with_scratch<T>(f: impl FnOnce() -> T) -> T {
        scratch_root::with_scratch_worktree_root(|_| {
            let runtime = tempfile::tempdir().unwrap();
            // SAFETY: serialised by the shared helper's lock and cleared before returning.
            unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path()) };
            let result = f();
            unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
            result
        })
    }

    fn found_claude() -> Result<std::path::PathBuf, String> {
        Ok(std::path::PathBuf::from("/opt/stub/claude"))
    }

    fn session_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn shape_starts_a_shaping_session_in_the_checkout_with_no_worktree() {
        with_scratch(|| {
            let (db, epic_id, checkout) = shaping_epic();
            let mut sent = None;
            let run_id = shape_epic(&db, &epic_id, found_claude, |repo, request| {
                sent = Some((repo.to_string(), request.clone()));
                Ok(())
            })
            .expect("Shape starts a session");

            let conn = db.lock().unwrap();
            let (kind, story, epic, worktree, status): (String, Option<String>, Option<String>, Option<String>, String) = conn
                .query_row(
                    "SELECT kind, story_id, epic_id, worktree_id, status FROM sessions WHERE id = ?1",
                    [&run_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();
            assert_eq!((kind.as_str(), story, epic.as_deref(), worktree, status.as_str()), ("shaping", None, Some(epic_id.as_str()), None, "running"));
            let worktrees: i64 = conn.query_row("SELECT COUNT(*) FROM worktrees", [], |r| r.get(0)).unwrap();
            assert_eq!(worktrees, 0, "shaping creates no worktree");

            let (repo, request) = sent.expect("one spawn request");
            let checkout = checkout.path().to_string_lossy().into_owned();
            assert_eq!(repo, checkout, "the spawn floor is keyed by the project's checkout");
            assert_eq!(request["worktreePath"], serde_json::json!(checkout), "the session runs in the checkout");
            assert_eq!(request["permissionMode"], "dontAsk");
            assert_eq!(request["permissionPrompt"], false, "no permission-prompt tool");
            let denied: Vec<String> = serde_json::from_value(request["disallowedTools"].clone()).unwrap();
            assert!(denied.iter().any(|t| t == "AskUserQuestion"), "Rounds are the only way to ask: {denied:?}");
            assert!(denied.iter().any(|t| t == "Bash"), "{denied:?}");
            assert!(request["env"].get(flywheel_core::destructive::WORKTREE_ENV).is_none(), "no worktree to fence");
            assert!(request["prompt"].as_str().unwrap().starts_with("# Shaping packet: Epic "));
            assert_eq!(request["runId"], serde_json::json!(run_id));
        });
    }

    #[test]
    fn shaping_without_claude_names_the_searched_path_and_writes_nothing() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let empty = tempfile::tempdir().unwrap();
            let searched = format!("{}:/usr/bin:/bin", empty.path().display());
            let err = shape_epic(&db, &epic_id, || flywheel_core::login_path::claude_bin_on(&searched), |_, _| {
                panic!("nothing may be spawned")
            })
            .expect_err("Shape is refused without claude");
            assert!(err.contains(&searched), "{err}");
            assert_eq!(session_count(&db.lock().unwrap()), 0);
        });
    }

    #[test]
    fn shaping_is_refused_for_an_epic_out_of_shaping_and_a_second_live_session() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let err = shape_epic(&db, &epic_id, found_claude, |_, _| panic!("no second spawn")).unwrap_err();
            assert!(err.contains("already has a live shaping session"), "{err}");

            let (db, epic_id, _checkout) = shaping_epic();
            {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                flywheel_core::domain::epic::set_epic_state(&mut conn, &human, &epic_id, flywheel_core::domain::epic::EpicState::Ready)
                    .unwrap();
            }
            let err = shape_epic(&db, &epic_id, found_claude, |_, _| panic!("nothing may be spawned")).unwrap_err();
            assert!(err.contains("only a record in Shaping is shaped"), "{err}");
            assert_eq!(session_count(&db.lock().unwrap()), 0);
        });
    }

    #[test]
    fn a_shaping_launch_whose_spawn_fails_leaves_no_running_row_and_shape_works_again() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let err = shape_epic(&db, &epic_id, found_claude, |_, _| Err("spawn boom".to_string())).unwrap_err();
            assert!(err.contains("spawn boom"), "{err}");
            let status: String =
                db.lock().unwrap().query_row("SELECT status FROM sessions", [], |r| r.get(0)).unwrap();
            assert_eq!(status, "failed");
            shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).expect("Shape works again");
        });
    }

    #[test]
    fn a_shaping_session_stops_through_the_session_surfaces_stop_without_a_summary() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let live = |db: &std::sync::Mutex<Connection>| {
                flywheel_core::domain::session::live_shaping_session(&db.lock().unwrap(), &ShapingSubject::Epic(epic_id.clone()))
                    .unwrap()
            };
            assert_eq!(live(&db), Some(run_id.clone()), "the card's Open session control finds it");

            let dto = crate::commands::session::stop_session_recording_first(&mut db.lock().unwrap(), &run_id, || Ok(()))
                .expect("Stop records the end");
            assert_eq!(dto.status, "interrupted");
            let summaries: i64 =
                db.lock().unwrap().query_row("SELECT COUNT(*) FROM session_summaries", [], |r| r.get(0)).unwrap();
            assert_eq!(summaries, 0, "a shaping session leaves no Session summary");
            assert_eq!(live(&db), None, "and the card offers Shape again");
        });
    }

    fn round_args() -> serde_json::Value {
        serde_json::json!({
            "note": "Settles the audience.",
            "questions": [
                { "title": "Audience", "question": "Is it for one developer?", "grounding": "GLOSSARY.md",
                  "recommended_answer": "Yes", "because": "One user in the MVP" },
                { "title": "Surface", "question": "Desktop only?", "grounding": "CLAUDE.md",
                  "recommended_answer": "Desktop only", "because": "v1 is desktop" },
            ],
        })
    }

    #[test]
    fn a_round_post_is_held_and_only_the_last_answer_releases_it_with_every_answer() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();

            let (answer, changed) =
                answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-7", "round_post", &round_args());
            assert_eq!(answer, None, "the call is held, not answered");
            assert!(changed.is_some(), "the board changed: a Round landed");

            let view = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap();
            assert_eq!(view.stages.len(), 1);
            assert_eq!(view.stages[0].kind, "challenge_spec");
            let round = &view.rounds[0];
            assert!(round.held);
            assert_eq!(round.questions[0].recommended_answer, "Yes");

            let first = answer_and_release(&db, |conn, human| {
                flywheel_core::domain::round::answer_round_question(conn, human, &round.questions[1].id, &RoundAnswer::Own("Desktop and web".into()))
            })
            .unwrap();
            assert_eq!(first.release, None);
            let last = answer_and_release(&db, |conn, human| {
                flywheel_core::domain::round::accept_all_recommended(conn, human, &round.id)
            })
            .unwrap();
            let release = last.release.expect("the last answer releases the held call");
            assert_eq!((release.session_id.as_str(), release.request_id.as_str()), (run_id.as_str(), "req-7"));
            let body = release_answer(&release);
            assert_eq!(body["result"]["answers"][0]["answer"], "Yes");
            assert_eq!(body["result"]["answers"][1]["answer"], "Desktop and web");
            assert!(!read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap().rounds[0].held);
        });
    }

    #[test]
    fn a_refused_round_post_is_answered_at_once_with_the_reason() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let (answer, changed) = answer_shaping_tool_call(
                &mut db.lock().unwrap(),
                &run_id,
                "req-1",
                "round_post",
                &serde_json::json!({ "note": "n", "questions": [] }),
            );
            assert!(answer.unwrap()["error"].as_str().unwrap().contains("at least one question"));
            assert_eq!(changed, None);
        });
    }

    #[test]
    fn a_spec_change_is_answered_at_once_and_reads_as_a_ghost_until_decided() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let args = serde_json::json!({ "field": "scope", "text": "The board only.", "why": "Round 1 narrowed it" });
            let (answer, changed) =
                answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-2", "propose_spec_change", &args);
            let answer = answer.expect("a Proposal never holds the agent");
            assert_eq!(answer["result"]["state"], "pending");
            assert!(changed.is_some(), "the board changed: a Proposal landed");

            let view = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap();
            assert_eq!(view.proposals.len(), 1);
            let ghost = &view.proposals[0];
            assert_eq!((ghost.state.as_str(), ghost.payload["field"].as_str()), ("pending", Some("scope")));
            assert_eq!(ghost.stage_id.as_deref(), Some(view.stages[0].id.as_str()));

            let mut conn = db.lock().unwrap();
            let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
            flywheel_core::domain::proposal::accept_proposal(&mut conn, &human, &ghost.id).unwrap();
            let view = read_epic_shaping(&conn, &epic_id).unwrap();
            assert!(view.proposals.is_empty(), "an accepted Proposal is in the field it rewrote");
            assert_eq!(view.epic.scope.as_deref(), Some("The board only."));
        });
    }

    #[test]
    fn a_shaping_session_reads_by_id_for_the_session_surface() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let run = flywheel_core::query::sessions::run_by_id(&db.lock().unwrap(), &run_id).unwrap().unwrap();
            assert_eq!(run.story_id, None);
            assert_eq!(run.status, "running");
        });
    }
}
