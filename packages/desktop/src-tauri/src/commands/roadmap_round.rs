//! `roadmap_revisit` / `roadmap_round_read` / `roadmap_round_dismiss` — the roadmap Round's command
//! surface (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #133).
//!
//! Revisit roadmap starts a project-level shaping session (`ShapingSubject::Roadmap`) on the project's
//! open roadmap Round, opening one when none is: no worktree, the project's checkout as its working
//! directory, `roadmap_packet` as its prompt and `SessionKind::Shaping`'s launch flags. On a project
//! whose open Round outlived its session, the same button starts the session that takes it over.
//!
//! The strip reads the open Round with its Proposals (ghost rows and struck-through rejections), and
//! the latest Round once none is open, so it can say the Roadmap still holds. Dismiss closes the open
//! Round with no change; when its session is held on it, the held call is answered once the lock is
//! released. Every handler resolves the human actor server-side (T-01-04) and emits `board:changed`.

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use flywheel_core::domain::roadmap_round::{describe_proposal, RoadmapRound};
use flywheel_core::domain::session::ShapingSubject;
use flywheel_core::domain::session_kind::SessionKind;

use super::proposal::ProposalDto;
use super::session::{fail_launch, send_gated_spawn, spawn_request_in};
use super::task::send_board_tool_answer;
use super::emit_board_changed;
use crate::state::AppState;

/// The roadmap session Revisit roadmap started.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapSessionDto {
    pub id: String,
    pub project_id: String,
    pub status: String,
    pub permission_mode: String,
}

/// A roadmap Round as the strip reads it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapRoundDto {
    pub id: String,
    pub number: i64,
    /// `open`, `closed` or `dismissed`.
    pub state: String,
    /// `revisit`, `epic_done` or `milestone_done`.
    pub trigger_type: String,
    /// "Revisit roadmap", "Epic FLY-3 done".
    pub trigger_label: String,
    /// Open with a LIVE session held on it until every Proposal is decided: Waiting on you.
    pub waiting_on_you: bool,
    /// The session that owns it is live (working, or held).
    pub session_live: bool,
    pub session_id: Option<String>,
    pub posted_at: String,
    pub closed_at: Option<String>,
    /// How many Proposals it filed: a closed Round with none is "Roadmap still holds".
    pub proposals_filed: i64,
    /// Issue #134: the Done triggers that came while it was open, each as a label ("Epic FLY-4 done").
    /// No Round of their own opened; the Round's next session reads them in its packet.
    pub noted_triggers: Vec<String>,
}

/// A Roadmap Proposal of the open Round, with the change in one line as the board names its records.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapProposalDto {
    #[serde(flatten)]
    pub proposal: ProposalDto,
    pub summary: String,
    /// The Milestone its ghost row sits under on the strip: the Milestone it changes, the new Epic's
    /// Milestone, or the dropped Epic's. `None` for a new Milestone, which sits at the end.
    pub anchor_milestone_id: Option<String>,
}

/// Where a Roadmap Proposal's ghost row sits: under the Milestone it lands on.
fn anchor_of(conn: &Connection, p: &flywheel_core::domain::proposal::Proposal) -> Option<String> {
    match (p.verb.as_str(), p.target_type.as_str()) {
        ("create", "milestone") => None,
        (_, "milestone") => p.target_id.clone(),
        ("create", "epic") => p.payload.get("milestone_id").and_then(|v| v.as_str()).map(str::to_string),
        ("retire", "epic") => p.target_id.as_deref().and_then(|id| {
            conn.query_row("SELECT milestone_id FROM epics WHERE id = ?1", [id], |r| r.get(0)).ok()
        }),
        _ => None,
    }
}

/// What the Roadmap strip reads about roadmap Rounds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapRoundViewDto {
    /// The open Round, if any.
    pub open: Option<RoadmapRoundDto>,
    /// The open Round's Proposals, oldest first, whatever their state.
    pub proposals: Vec<RoadmapProposalDto>,
    /// The latest Round once none is open: what it ended with.
    pub last: Option<RoadmapRoundDto>,
}

fn round_dto(conn: &Connection, r: RoadmapRound) -> Result<RoadmapRoundDto, String> {
    let proposals_filed: i64 = conn
        .query_row("SELECT COUNT(*) FROM proposals WHERE round_id = ?1", [&r.id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let noted_triggers = flywheel_core::domain::roadmap_round::noted_triggers(conn, &r.id)
        .map_err(|e| e.to_string())?
        .iter()
        .map(|t| t.label(conn))
        .collect();
    Ok(RoadmapRoundDto {
        noted_triggers,
        trigger_label: r.trigger.label(conn),
        trigger_type: r.trigger.as_str().to_string(),
        id: r.id,
        number: r.number,
        state: r.state,
        waiting_on_you: r.waiting_on_you,
        session_live: r.session_live,
        session_id: r.session_id,
        posted_at: r.posted_at,
        closed_at: r.closed_at,
        proposals_filed,
    })
}

/// Revisit roadmap (issue #133): start the roadmap Round's session.
#[tauri::command]
pub async fn roadmap_revisit(app: AppHandle, project_id: String) -> Result<RoadmapSessionDto, String> {
    // Waits on the sidecar (the spawn floor, an acknowledgement or a probe): on the blocking
    // pool, never the thread IPC dispatches on (issue #235).
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        roadmap_revisit_blocking(&state, &app, project_id)
    })
    .await
    .map_err(|e| super::ipc_error("roadmap_revisit:join", e))?
}

/// [`roadmap_revisit`]'s body, on the blocking pool.
fn roadmap_revisit_blocking(state: &AppState, app: &AppHandle, project_id: String) -> Result<RoadmapSessionDto, String> {
    let run_id = revisit_roadmap(&state.db, &project_id, flywheel_core::login_path::claude_bin, |repo_path, request| {
        send_gated_spawn(state, repo_path, request)
    })?;
    emit_board_changed(app, Some(&project_id), "session", Some(&run_id));
    Ok(RoadmapSessionDto {
        id: run_id,
        project_id,
        status: "running".to_string(),
        permission_mode: SessionKind::Shaping.launch_policy().permission_mode.to_string(),
    })
}

/// [`roadmap_revisit`]'s body, driven without a Tauri app handle: `shaping::shape_epic`'s shape.
/// `find_claude` runs before anything is created, so a missing `claude` writes nothing. The core
/// refuses a second live roadmap session inside the transaction that would insert the row, and opens
/// the Round (or takes the open one over) in it. A launch that fails after the row exists closes it
/// `failed`; the Round stays open for the next Revisit.
pub(crate) fn revisit_roadmap(
    db: &std::sync::Mutex<Connection>,
    project_id: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let repo_path: String = conn
        .query_row("SELECT repo_path FROM projects WHERE id = ?1", [project_id], |row| row.get(0))
        .map_err(|_| format!("project {project_id:?} not found"))?;
    find_claude()?;
    let env = crate::sidecar::resolved_env_for_run(&conn, project_id).map_err(|e| e.to_string())?;

    let kind = SessionKind::Shaping;
    let session = flywheel_core::domain::session::start_shaping_session(
        &mut conn,
        &ShapingSubject::Roadmap(project_id.to_string()),
        kind.launch_policy().permission_mode,
        &human,
    )
    .map_err(|e| e.to_string())?;
    let prompt = match flywheel_core::roadmap_packet::build_roadmap_packet(&conn, project_id) {
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

/// What confirming an exit test did (issue #134).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmDoneDto {
    /// `opened`: a roadmap Round opened on this trigger. `noted`: one was already open, and the
    /// trigger is noted on it.
    pub outcome: String,
    pub round_number: i64,
    /// The Round's session, when one started.
    pub session_id: Option<String>,
    /// Why the Round's session could not start (no `claude`, say): the record is Done all the same,
    /// and the Round waits on the strip for Continue.
    pub session_error: Option<String>,
}

/// What `epic_set_state` / `milestone_set_state` answer to `done`: confirming an exit test is its own
/// command, so it can never skip the roadmap Round it triggers (issue #134).
pub(crate) fn refuse_done_without_round(to: &str) -> Result<(), String> {
    if to == "done" {
        return Err("confirm the exit test instead (epic_confirm_done or milestone_confirm_done): confirming Done starts a roadmap Round".to_string());
    }
    Ok(())
}

/// Which exit test is confirmed.
pub(crate) enum Confirm<'a> {
    Epic(&'a str),
    Milestone(&'a str),
}

/// Confirm an Epic's exit test (issue #134): the Epic moves to Done and a short roadmap Round on its
/// Milestone starts, with its session, as Revisit roadmap starts one. Human-only.
#[tauri::command]
pub async fn epic_confirm_done(app: AppHandle, epic_id: String) -> Result<ConfirmDoneDto, String> {
    // Waits on the sidecar (the spawn floor, an acknowledgement or a probe): on the blocking
    // pool, never the thread IPC dispatches on (issue #235).
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        epic_confirm_done_blocking(&state, &app, epic_id)
    })
    .await
    .map_err(|e| super::ipc_error("epic_confirm_done:join", e))?
}

/// [`epic_confirm_done`]'s body, on the blocking pool.
fn epic_confirm_done_blocking(state: &AppState, app: &AppHandle, epic_id: String) -> Result<ConfirmDoneDto, String> {
    confirm_command(state, app, Confirm::Epic(&epic_id))
}

/// Confirm a Milestone's exit test (issue #134): the Milestone moves to Done and a Roadmap Round
/// starts, with its session. Human-only.
#[tauri::command]
pub async fn milestone_confirm_done(app: AppHandle, milestone_id: String) -> Result<ConfirmDoneDto, String> {
    // Waits on the sidecar (the spawn floor, an acknowledgement or a probe): on the blocking
    // pool, never the thread IPC dispatches on (issue #235).
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        milestone_confirm_done_blocking(&state, &app, milestone_id)
    })
    .await
    .map_err(|e| super::ipc_error("milestone_confirm_done:join", e))?
}

/// [`milestone_confirm_done`]'s body, on the blocking pool.
fn milestone_confirm_done_blocking(state: &AppState, app: &AppHandle, milestone_id: String) -> Result<ConfirmDoneDto, String> {
    confirm_command(state, app, Confirm::Milestone(&milestone_id))
}

fn confirm_command(state: &AppState, app: &AppHandle, which: Confirm) -> Result<ConfirmDoneDto, String> {
    let (project_id, dto) = confirm_done(&state.db, which, flywheel_core::login_path::claude_bin, |repo_path, request| {
        send_gated_spawn(state, repo_path, request)
    })?;
    emit_board_changed(app, Some(&project_id), "round", None);
    Ok(dto)
}

/// [`epic_confirm_done`] / [`milestone_confirm_done`]'s body, driven without a Tauri app handle. The
/// confirmation commits first (the record is Done, the Round open or the trigger noted); then, for an
/// opened Round, its session starts through [`revisit_roadmap`], which takes the Round over. A launch
/// that fails leaves the Round open with no session, waiting for Continue, and says why. Returns the
/// project's id with the outcome.
pub(crate) fn confirm_done(
    db: &std::sync::Mutex<Connection>,
    which: Confirm,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<(String, ConfirmDoneDto), String> {
    use flywheel_core::domain::confirm_done::{confirm_epic_done, confirm_milestone_done, DoneTrigger};
    let outcome = {
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
        match which {
            Confirm::Epic(id) => confirm_epic_done(&mut conn, &human, id),
            Confirm::Milestone(id) => confirm_milestone_done(&mut conn, &human, id),
        }
        .map_err(|e| format!("{e:#}"))?
    };
    let round = outcome.round();
    let project_id = round.project_id.clone();
    let mut dto = ConfirmDoneDto {
        outcome: if matches!(outcome, DoneTrigger::Opened(_)) { "opened" } else { "noted" }.to_string(),
        round_number: round.number,
        session_id: None,
        session_error: None,
    };
    if let DoneTrigger::Opened(_) = outcome {
        match revisit_roadmap(db, &project_id, find_claude, send) {
            Ok(session_id) => dto.session_id = Some(session_id),
            Err(why) => dto.session_error = Some(why),
        }
    }
    Ok((project_id, dto))
}

/// The open roadmap Round with its Proposals, or the latest one once none is open.
#[tauri::command]
pub fn roadmap_round_read(state: State<AppState>, project_id: String) -> Result<RoadmapRoundViewDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    read_roadmap_round(&conn, &project_id)
}

pub(crate) fn read_roadmap_round(conn: &Connection, project_id: &str) -> Result<RoadmapRoundViewDto, String> {
    use flywheel_core::domain::roadmap_round::{latest_roadmap_round, open_roadmap_round};
    let open = open_roadmap_round(conn, project_id).map_err(|e| e.to_string())?;
    let proposals = match &open {
        Some(round) => flywheel_core::domain::proposal::proposals_in_round(conn, &round.id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|p| RoadmapProposalDto {
                summary: describe_proposal(conn, &p),
                anchor_milestone_id: anchor_of(conn, &p),
                proposal: p.into(),
            })
            .collect(),
        None => Vec::new(),
    };
    let last = match &open {
        Some(_) => None,
        None => latest_roadmap_round(conn, project_id).map_err(|e| e.to_string())?,
    };
    Ok(RoadmapRoundViewDto {
        open: open.map(|r| round_dto(conn, r)).transpose()?,
        proposals,
        last: last.map(|r| round_dto(conn, r)).transpose()?,
    })
}

/// Dismiss the open roadmap Round (issue #133): it closes with no change. Human-only.
#[tauri::command]
pub fn roadmap_round_dismiss(state: State<AppState>, app: AppHandle, round_id: String) -> Result<(), String> {
    let outcome = {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
        flywheel_core::domain::roadmap_round::dismiss_roadmap_round(&mut conn, &human, &round_id)
            .map_err(|e| format!("{e:#}"))?
    };
    if let Some(release) = &outcome.release {
        send_board_tool_answer(&app, &release.session_id, &release.request_id, &super::shaping::release_answer(release));
    }
    emit_board_changed(&app, Some(&outcome.project_id), "round", Some(&round_id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::session::scratch_root;

    fn project() -> (std::sync::Mutex<Connection>, String, tempfile::TempDir) {
        let checkout = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut conn =
            flywheel_core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups")).unwrap();
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
        flywheel_core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", Some("It shapes")).unwrap();
        (std::sync::Mutex::new(conn), project.id, checkout)
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

    #[test]
    fn revisit_starts_a_read_only_session_in_the_checkout_on_the_roadmap_packet() {
        with_scratch(|| {
            let (db, project_id, checkout) = project();
            let mut sent = None;
            let run_id = revisit_roadmap(&db, &project_id, found_claude, |repo, request| {
                sent = Some((repo.to_string(), request.clone()));
                Ok(())
            })
            .expect("Revisit roadmap starts a session");
            let (repo, request) = sent.expect("one spawn request");
            let checkout = checkout.path().to_string_lossy().into_owned();
            assert_eq!(repo, checkout);
            assert_eq!(request["worktreePath"], serde_json::json!(checkout));
            assert_eq!(request["permissionMode"], "dontAsk");
            assert_eq!(request["runId"], serde_json::json!(run_id));
            let prompt = request["prompt"].as_str().unwrap();
            assert!(prompt.starts_with("# Roadmap packet: Threadfin"), "{prompt}");
            let allowed: Vec<String> = serde_json::from_value(request["allowedTools"].clone()).unwrap();
            for tool in ["propose_roadmap_change", "roadmap_holds", "round_wait"] {
                assert!(allowed.contains(&format!("mcp__flywheel-board__{tool}")), "{allowed:?}");
            }

            let view = read_roadmap_round(&db.lock().unwrap(), &project_id).unwrap();
            let open = view.open.expect("the Round is open");
            assert_eq!((open.number, open.trigger_type.as_str(), open.trigger_label.as_str()), (1, "revisit", "Revisit roadmap"));
            assert!(open.session_live);
            assert!(!open.waiting_on_you, "the agent is working, not waiting");
            assert!(view.last.is_none());
        });
    }

    /// An Epic in the project's Milestone, Ready, with one Story Merged: its exit test can be confirmed.
    fn closed_epic(db: &std::sync::Mutex<Connection>, project_id: &str, title: &str) -> String {
        use flywheel_core::domain::{epic, story};
        let mut conn = db.lock().unwrap();
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
        let m = flywheel_core::domain::milestone::roadmap(&conn, project_id).unwrap().remove(0);
        let e = epic::create_epic(&mut conn, &human, &m.id, title).unwrap();
        let s = story::create_story(&mut conn, &human, &e.id, "Only story").unwrap();
        for to in [story::StoryState::Ready, story::StoryState::Running, story::StoryState::InReview, story::StoryState::Merged] {
            story::set_story_state(&mut conn, &human, &s.id, to).unwrap();
        }
        epic::set_epic_state(&mut conn, &human, &e.id, epic::EpicState::Ready).unwrap();
        e.id
    }

    #[test]
    fn confirming_an_epic_done_starts_the_rounds_session_and_a_second_is_noted_on_the_band() {
        with_scratch(|| {
            let (db, project_id, _checkout) = project();
            let first = closed_epic(&db, &project_id, "Rounds");
            let second = closed_epic(&db, &project_id, "Roadmap");
            let mut sent = None;
            let (pid, dto) = confirm_done(&db, Confirm::Epic(&first), found_claude, |_, request| {
                sent = Some(request.clone());
                Ok(())
            })
            .unwrap();
            assert_eq!(pid, project_id);
            assert_eq!((dto.outcome.as_str(), dto.round_number, dto.session_error.as_deref()), ("opened", 1, None));
            let prompt = sent.expect("the Round's session starts")["prompt"].as_str().unwrap().to_string();
            assert!(prompt.contains("This Round is short, and on one Milestone: \"Shaping\""), "{prompt}");

            let (_, dto) = confirm_done(&db, Confirm::Epic(&second), found_claude, |_, _| panic!("no second session")).unwrap();
            assert_eq!((dto.outcome.as_str(), dto.round_number, dto.session_id.as_deref()), ("noted", 1, None));
            let view = read_roadmap_round(&db.lock().unwrap(), &project_id).unwrap();
            assert_eq!(view.open.unwrap().noted_triggers, ["Epic FLY-3 done"]);
        });
    }

    #[test]
    fn a_confirmation_whose_session_cannot_start_is_done_and_the_round_waits() {
        with_scratch(|| {
            let (db, project_id, _checkout) = project();
            let epic = closed_epic(&db, &project_id, "Rounds");
            let (_, dto) = confirm_done(&db, Confirm::Epic(&epic), || Err("claude is not on PATH".to_string()), |_, _| Ok(())).unwrap();
            assert_eq!(dto.outcome, "opened");
            assert_eq!(dto.session_error.as_deref(), Some("claude is not on PATH"));
            let view = read_roadmap_round(&db.lock().unwrap(), &project_id).unwrap();
            let open = view.open.expect("the Round waits for Continue");
            assert!(!open.session_live);
            assert_eq!(open.trigger_type, "epic_done");
            assert!(refuse_done_without_round("done").is_err());
            assert!(refuse_done_without_round("shaping").is_ok());
        });
    }

    #[test]
    fn a_proposal_shows_with_its_summary_and_dismiss_leaves_the_round_as_the_last_one() {
        with_scratch(|| {
            let (db, project_id, _checkout) = project();
            let run_id = revisit_roadmap(&db, &project_id, found_claude, |_, _| Ok(())).unwrap();
            let args = serde_json::json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" });
            let (answer, changed) = crate::commands::shaping::answer_shaping_tool_call(
                &mut db.lock().unwrap(),
                &run_id,
                "req-1",
                "propose_roadmap_change",
                &args,
            );
            assert_eq!(answer.unwrap()["result"]["state"], "pending");
            assert_eq!(changed.as_deref(), Some(project_id.as_str()));
            let (answer, _) = crate::commands::shaping::answer_shaping_tool_call(
                &mut db.lock().unwrap(),
                &run_id,
                "req-2",
                "round_wait",
                &serde_json::json!({}),
            );
            assert_eq!(answer, None, "held until every Proposal is decided");

            let view = read_roadmap_round(&db.lock().unwrap(), &project_id).unwrap();
            assert!(view.open.as_ref().unwrap().waiting_on_you);
            assert_eq!(view.proposals.len(), 1);
            assert_eq!(view.proposals[0].summary, "New Milestone \"Mobile\"");
            assert_eq!(view.proposals[0].proposal.state, "pending");

            let round_id = view.open.unwrap().id;
            let outcome = {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                flywheel_core::domain::roadmap_round::dismiss_roadmap_round(&mut conn, &human, &round_id).unwrap()
            };
            assert_eq!(outcome.release.unwrap().request_id, "req-2");
            let view = read_roadmap_round(&db.lock().unwrap(), &project_id).unwrap();
            assert!(view.open.is_none());
            let last = view.last.expect("the dismissed Round is the last one");
            assert_eq!((last.state.as_str(), last.proposals_filed), ("dismissed", 1));
        });
    }
}
