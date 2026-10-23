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
//!
//! Continue shaping (issue #124): [`shaping_continue`] starts a fresh session on an Epic whose
//! Rounds outlived the session that posted them. Its packet carries every Round with its answers and
//! tells the agent to call `round_wait`, which takes the open Round over and is held like a
//! `round_post`, or is answered at once when the Round is already complete.
//!
//! Milestones (issue #132): [`milestone_shape`], [`milestone_shaping_session`],
//! [`milestone_shaping_rounds`] and [`milestone_shaping_continue`] are the Epic's commands for a
//! Milestone's one Stage, Exit test, with the Milestone's packet. [`stage_close`] closes it too, which
//! makes the Milestone Ready and starts no further session.

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
    /// `question`, or `adr` for an ADR offered inside the Round (issue #129), answered Yes or No.
    pub kind: String,
    /// An ADR question's draft and its bar lines.
    pub adr: Option<AdrDraftDto>,
    /// The accepted ADR Proposal an ADR question's Yes filed.
    pub adr_proposal_id: Option<String>,
}

/// An ADR draft as the dock shows it (issue #129): the file and the four bar lines beside it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdrDraftDto {
    pub path: String,
    pub text: String,
    pub hard_to_reverse: String,
    pub surprising: String,
    pub losing_alternative: String,
    /// `None` reads as "none".
    pub relates_to: Option<String>,
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
    /// Issue #124: open with a LIVE session held on it, so Waiting on you. An open Round whose session
    /// died is not, though its answers are still taken.
    pub waiting_on_you: bool,
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
    /// The ADRs linked to the Epic, by repo-relative path (issue #129): its ADR chips once merged.
    pub adr_links: Vec<String>,
    /// The Epic's accepted ADR and glossary Proposals, oldest first (issue #129): its ADR and
    /// glossary chips before a Story writes them into the repo.
    pub accepted_knowledge: Vec<super::proposal::ProposalDto>,
    /// What is still open in the open Stage (issue #126): what the Close Stage button lists. `None`
    /// before shaping has opened a Stage.
    pub open_stage_status: Option<StageStatusDto>,
    /// The Epic's Stories in execution order (issue #127): its Story columns, beside the ghost
    /// columns of its pending New Story Proposals.
    pub stories: Vec<super::story::StoryDto>,
}

/// One item that keeps a Stage open.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenItemDto {
    /// `question`, `proposal`, `story_without_criterion` (issue #128: a Story still in Shaping with no
    /// criterion) or `no_story` (issue #128: the Epic has no Story to make Ready).
    pub kind: String,
    /// The question's, the Proposal's or the Story's id; empty for `no_story`.
    pub id: String,
    /// The item in words: "Question 2 of Round 1 is unanswered: Audience".
    pub label: String,
    /// A question's Round and number; `None` otherwise.
    pub round: Option<i64>,
    pub number: Option<i64>,
    /// A question's title, what a Proposal would do ("change the Problem"), or the Story's title.
    pub title: String,
    /// The Story's key, for `story_without_criterion`.
    pub story_key: Option<String>,
}

/// What is still open in a Stage, and whether the developer may close it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageStatusDto {
    pub stage_id: String,
    pub open_items: Vec<OpenItemDto>,
    /// Empty spec fields, listed but never blocking.
    pub warnings: Vec<String>,
    /// The Stage closing this one opens (`slice`, `criteria`), or `None` for the last Stage.
    pub next: Option<String>,
    /// Whether closing this Stage makes its record Ready instead of opening a next one: an Epic's
    /// Criteria with its Stories (issue #128), a Milestone's Exit test (issue #132).
    pub makes_ready: bool,
    pub closable: bool,
}

impl From<flywheel_core::domain::stage::StageStatus> for StageStatusDto {
    fn from(s: flywheel_core::domain::stage::StageStatus) -> Self {
        use flywheel_core::domain::stage::OpenItem;
        Self {
            closable: s.closable(),
            makes_ready: s.closes_the_record(),
            stage_id: s.stage.id,
            open_items: s
                .open_items
                .iter()
                .map(|item| {
                    let (kind, id, round, number, title, story_key) = match item {
                        OpenItem::Question { question_id, round, number, title, .. } => {
                            ("question", question_id.clone(), Some(*round), Some(*number), title.clone(), None)
                        }
                        OpenItem::Proposal { proposal_id, summary } => {
                            ("proposal", proposal_id.clone(), None, None, summary.clone(), None)
                        }
                        OpenItem::StoryWithoutCriterion { story_id, key, title } => {
                            ("story_without_criterion", story_id.clone(), None, None, title.clone(), Some(key.clone()))
                        }
                        OpenItem::NoStory => ("no_story", String::new(), None, None, item.label(), None),
                    };
                    OpenItemDto { kind: kind.to_string(), id, label: item.label(), round, number, title, story_key }
                })
                .collect(),
            warnings: s.warnings,
            next: s.next.map(|k| k.as_str().to_string()),
        }
    }
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
            waiting_on_you: r.waiting_on_you,
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
                    kind: if q.adr.is_some() { "adr" } else { "question" }.to_string(),
                    adr: q.adr.map(|a| AdrDraftDto {
                        path: a.path,
                        text: a.text,
                        hard_to_reverse: a.hard_to_reverse,
                        surprising: a.surprising,
                        losing_alternative: a.losing_alternative,
                        relates_to: a.relates_to,
                    }),
                    adr_proposal_id: q.adr_proposal_id,
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
    let open_stage_status = match stages.iter().find(|s| s.state == "open") {
        Some(open) => Some(flywheel_core::domain::stage::stage_status(conn, &open.id).map_err(|e| e.to_string())?.into()),
        None => None,
    };
    let (accepted, proposals): (Vec<_>, Vec<_>) = proposals.into_iter().partition(|p| p.state == "accepted");
    let adr_links = flywheel_core::domain::adr_link::adr_links_for_project(conn, &epic.project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|l| matches!(&l.target, flywheel_core::domain::adr_link::AdrLinkTarget::Epic(id) if id == epic_id))
        .map(|l| l.path)
        .collect();
    let stories = flywheel_core::domain::story::stories_in_epic(conn, epic_id).map_err(|e| e.to_string())?;
    Ok(EpicShapingDto {
        open_stage_status,
        stories: stories.into_iter().map(Into::into).collect(),
        proposals: proposals.into_iter().map(Into::into).collect(),
        adr_links,
        accepted_knowledge: accepted
            .into_iter()
            .filter(|p| p.target_type == "adr" || p.target_type == "glossary_term")
            .map(Into::into)
            .collect(),
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
/// routes it: `(Some(answer), _)` to answer at once (a refusal with its reason, a filed Proposal, or a
/// `round_wait` on a Round already answered, with every answer), or `(None, project)` when the call is
/// held until the developer answers the Round it posted or took over. The project is `Some` whenever
/// the board may have changed.
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
        // Issue #125: a Proposal never holds the agent. Issue #124: nor does a round_wait on an answered Round.
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

/// Continue shaping (issue #124): start a fresh shaping session on an Epic whose earlier session
/// ended with a Round open, or after it. The packet is rebuilt from the board, so it carries every
/// Round with its answers and tells the agent to call `round_wait` on the open one. Refused for an
/// Epic with no Round yet (Shape starts that one) and, like Shape, for one already being shaped.
#[tauri::command]
pub fn shaping_continue(state: State<AppState>, app: AppHandle, epic_id: String) -> Result<ShapingSessionDto, String> {
    let run_id = continue_epic(&state.db, &epic_id, flywheel_core::login_path::claude_bin, |repo_path, request| {
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

/// [`shaping_continue`]'s body: [`shape_epic`] once the Epic is known to have a Round to continue.
pub(crate) fn continue_epic(
    db: &std::sync::Mutex<Connection>,
    epic_id: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let rounds = flywheel_core::domain::round::rounds_for_epic(&conn, epic_id).map_err(|e| e.to_string())?;
        if rounds.is_empty() {
            return Err("this Epic has no Round to continue from; Shape it to start its first Round".to_string());
        }
    }
    shape_epic(db, epic_id, find_claude, send)
}

/// What Close Stage did (issue #126): the Stage it opened and the session it started on it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCloseDto {
    pub closed_stage_id: String,
    /// The Stage the close opened; `None` when the closed Stage was its record's last and made it
    /// Ready (a Milestone's Exit test, issue #132; an Epic's Criteria, issue #128).
    pub opened: Option<StageDto>,
    /// The Stories closing an Epic's Criteria Stage made Ready, by id (issue #128); empty otherwise.
    pub made_ready: Vec<String>,
    /// The next Stage's shaping session, started from a fresh packet; `None` when it could not start,
    /// and when no Stage follows: the record is Ready, and nothing is left to shape.
    pub session: Option<ShapingSessionDto>,
    /// Why the next Stage's session did not start, when it did not. The Stage is closed regardless;
    /// Shape starts the session.
    pub launch_error: Option<String>,
    /// Set when the session that worked the closed Stage was recorded as ended but its process could
    /// not be confirmed stopped.
    pub sidecar_warning: Option<String>,
}

/// Close Stage (issue #126): the developer closes the Epic's open Stage once nothing in it is open,
/// which opens the next Stage, ends the session that worked the closed one and starts the next
/// Stage's shaping session from a fresh packet. Human-only: the actor is resolved here, and the core
/// refuses any other inside its transaction.
#[tauri::command]
pub fn stage_close(state: State<AppState>, app: AppHandle, stage_id: String) -> Result<StageCloseDto, String> {
    let dto = close_stage_and_shape(
        &state.db,
        &stage_id,
        |session_id| match state.sidecar.as_ref() {
            Some(sidecar) => sidecar.interrupt_run(session_id).map_err(|e| e.to_string()),
            None => Ok(()),
        },
        flywheel_core::login_path::claude_bin,
        |repo_path, request| send_gated_spawn(&state, repo_path, request),
    )?;
    let project_id = project_of_locked(&state.db, "stages", &dto.closed_stage_id);
    emit_board_changed(&app, project_id.as_deref(), "stage", Some(&dto.closed_stage_id));
    Ok(dto)
}

/// [`stage_close`]'s body, driven without a Tauri app handle. The close is one core transaction
/// (`stage::close_stage`): it refuses while anything is open and ends the live session in the same
/// write. Only once that has committed and the lock is released is the ended session's process
/// interrupted (which may block on the sidecar), then the next Stage's session started as Shape
/// starts one. A session that cannot start leaves the Stage closed and says why.
pub(crate) fn close_stage_and_shape(
    db: &std::sync::Mutex<Connection>,
    stage_id: &str,
    interrupt: impl FnOnce(&str) -> Result<(), String>,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<StageCloseDto, String> {
    let closed = {
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
        flywheel_core::domain::stage::close_stage(&mut conn, &human, stage_id).map_err(|e| format!("{e:#}"))?
    };
    let sidecar_warning = closed.ended_session.as_deref().and_then(|id| interrupt(id).err()).map(|e| {
        format!("Flywheel recorded the last Stage's session as ended, but could not confirm its agent process stopped: {e}")
    });
    let opened = closed.opened.as_ref().map(|s| StageDto {
        id: s.id.clone(),
        kind: s.kind.as_str().to_string(),
        state: s.state.clone(),
        rank: s.rank,
    });
    let (session, launch_error) = match closed.opened.as_ref().and_then(|s| s.epic_id.as_ref()) {
        Some(epic_id) => match shape_epic(db, epic_id, find_claude, send) {
            Ok(id) => (
                Some(ShapingSessionDto {
                    id,
                    epic_id: epic_id.clone(),
                    status: "running".to_string(),
                    permission_mode: SessionKind::Shaping.launch_policy().permission_mode.to_string(),
                }),
                None,
            ),
            Err(why) => (None, Some(why)),
        },
        None => (None, None),
    };
    Ok(StageCloseDto {
        closed_stage_id: closed.closed.id,
        opened,
        made_ready: closed.made_ready,
        session,
        launch_error,
        sidecar_warning,
    })
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
    shape_subject(db, &ShapingSubject::Epic(epic_id.to_string()), find_claude, send)
}

/// [`milestone_shape`]'s body (issue #132): [`shape_epic`] for a Milestone, whose session opens its
/// one Stage, Exit test, and starts from the Milestone's packet.
pub(crate) fn shape_milestone(
    db: &std::sync::Mutex<Connection>,
    milestone_id: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    shape_subject(db, &ShapingSubject::Milestone(milestone_id.to_string()), find_claude, send)
}

/// Start a shaping session on `subject`: [`shape_epic`]'s and [`shape_milestone`]'s shared body.
fn shape_subject(
    db: &std::sync::Mutex<Connection>,
    subject: &ShapingSubject,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let (sql, id, noun) = match subject {
        ShapingSubject::Epic(id) => (
            "SELECT e.project_id, p.repo_path FROM epics e JOIN projects p ON p.id = e.project_id WHERE e.id = ?1",
            id,
            "Epic",
        ),
        ShapingSubject::Milestone(id) => (
            "SELECT m.project_id, p.repo_path FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = ?1",
            id,
            "Milestone",
        ),
        ShapingSubject::Roadmap(_) => return Err("the Roadmap is shaped through Revisit roadmap".to_string()),
    };
    let (project_id, repo_path): (String, String) = conn
        .query_row(sql, rusqlite::params![id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|_| format!("{noun} {id:?} not found"))?;
    find_claude()?;
    // Resolved before the row exists: a missing API key must not leave a `running` row behind.
    let env = crate::sidecar::resolved_env_for_run(&conn, &project_id).map_err(|e| e.to_string())?;

    let kind = SessionKind::Shaping;
    let session = flywheel_core::domain::session::start_shaping_session(
        &mut conn,
        subject,
        kind.launch_policy().permission_mode,
        &human,
    )
    .map_err(|e| e.to_string())?;
    let prompt = match flywheel_core::shaping_packet::build_shaping_packet(&conn, subject) {
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

/// A Milestone's shaping session as Shape returns it (issue #132).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneShapingSessionDto {
    pub id: String,
    pub milestone_id: String,
    pub status: String,
    pub permission_mode: String,
}

impl MilestoneShapingSessionDto {
    fn running(id: String, milestone_id: String) -> Self {
        Self {
            id,
            milestone_id,
            status: "running".to_string(),
            permission_mode: SessionKind::Shaping.launch_policy().permission_mode.to_string(),
        }
    }
}

/// Shape on a Milestone in Shaping (issue #132): start a shaping session on its exit test.
#[tauri::command]
pub fn milestone_shape(state: State<AppState>, app: AppHandle, milestone_id: String) -> Result<MilestoneShapingSessionDto, String> {
    let run_id = shape_milestone(&state.db, &milestone_id, flywheel_core::login_path::claude_bin, |repo_path, request| {
        send_gated_spawn(&state, repo_path, request)
    })?;
    let project_id = project_of_locked(&state.db, "milestones", &milestone_id);
    emit_board_changed(&app, project_id.as_deref(), "session", Some(&run_id));
    Ok(MilestoneShapingSessionDto::running(run_id, milestone_id))
}

/// The Milestone's live shaping session, if any (issue #132).
#[tauri::command]
pub fn milestone_shaping_session(state: State<AppState>, milestone_id: String) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::session::live_shaping_session(&conn, &ShapingSubject::Milestone(milestone_id))
        .map_err(|e| e.to_string())
}

/// Continue shaping a Milestone (issue #132): [`shaping_continue`] for a Milestone whose Rounds
/// outlived the session that posted them.
#[tauri::command]
pub fn milestone_shaping_continue(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
) -> Result<MilestoneShapingSessionDto, String> {
    let run_id = continue_milestone(&state.db, &milestone_id, flywheel_core::login_path::claude_bin, |repo_path, request| {
        send_gated_spawn(&state, repo_path, request)
    })?;
    let project_id = project_of_locked(&state.db, "milestones", &milestone_id);
    emit_board_changed(&app, project_id.as_deref(), "session", Some(&run_id));
    Ok(MilestoneShapingSessionDto::running(run_id, milestone_id))
}

/// [`milestone_shaping_continue`]'s body: [`shape_milestone`] once the Milestone has a Round to continue.
pub(crate) fn continue_milestone(
    db: &std::sync::Mutex<Connection>,
    milestone_id: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let rounds = flywheel_core::domain::round::rounds_for_milestone(&conn, milestone_id).map_err(|e| e.to_string())?;
        if rounds.is_empty() {
            return Err("this Milestone has no Round to continue from; Shape it to start its first Round".to_string());
        }
    }
    shape_milestone(db, milestone_id, find_claude, send)
}

/// What a Milestone's shaping view reads (issue #132): the Milestone, its one Stage, every Round,
/// its exit-test Proposals and what is still open in the Stage.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneShapingDto {
    pub milestone: super::roadmap::MilestoneDto,
    pub stages: Vec<StageDto>,
    pub rounds: Vec<RoundDto>,
    /// The Milestone's undecided and rejected exit-test Proposals, oldest first: a ghost over the exit
    /// test and struck-through lines. An accepted one is in the exit test it rewrote.
    pub proposals: Vec<super::proposal::ProposalDto>,
    /// What is still open in the open Stage: what the Close Stage button lists. `None` before shaping
    /// has opened the Stage, and once it is closed.
    pub open_stage_status: Option<StageStatusDto>,
}

/// The Milestone's Stage, Rounds and Proposals (issue #132): what its dock shows.
#[tauri::command]
pub fn milestone_shaping_rounds(state: State<AppState>, milestone_id: String) -> Result<MilestoneShapingDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    read_milestone_shaping(&conn, &milestone_id)
}

pub(crate) fn read_milestone_shaping(conn: &Connection, milestone_id: &str) -> Result<MilestoneShapingDto, String> {
    let milestone = flywheel_core::domain::milestone::get_milestone(conn, milestone_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Milestone {milestone_id:?} not found"))?;
    let current = flywheel_core::domain::milestone::current_milestone(conn, &milestone.project_id).map_err(|e| e.to_string())?;
    let milestone = super::roadmap::to_dto(conn, milestone, current.as_ref().map(|c| c.id.as_str()))?;
    let stages = flywheel_core::domain::stage::stages_for_milestone(conn, milestone_id).map_err(|e| e.to_string())?;
    let rounds = flywheel_core::domain::round::rounds_for_milestone(conn, milestone_id).map_err(|e| e.to_string())?;
    let proposals =
        flywheel_core::domain::proposal::proposals_on_milestone(conn, milestone_id).map_err(|e| e.to_string())?;
    let open_stage_status = match stages.iter().find(|s| s.state == "open") {
        Some(open) => Some(flywheel_core::domain::stage::stage_status(conn, &open.id).map_err(|e| e.to_string())?.into()),
        None => None,
    };
    Ok(MilestoneShapingDto {
        milestone,
        stages: stages
            .into_iter()
            .map(|s| StageDto { id: s.id, kind: s.kind.as_str().to_string(), state: s.state, rank: s.rank })
            .collect(),
        rounds: rounds.into_iter().map(RoundDto::from).collect(),
        // Only exit-test changes ghost over the exit test: an Amend Milestone with only `exit_test` set
        // (`propose_exit_test`). A roadmap Round's other Milestone changes are its strip's ghost rows.
        proposals: proposals
            .into_iter()
            .filter(|p| p.state != "accepted" && is_exit_test_change(p))
            .map(Into::into)
            .collect(),
        open_stage_status,
    })
}

/// Whether a Proposal on a Milestone changes its exit test alone (issue #132).
fn is_exit_test_change(p: &flywheel_core::domain::proposal::Proposal) -> bool {
    p.verb == "amend"
        && p.payload.get("exit_test").is_some_and(|t| t.is_string())
        && p.payload.get("title").is_none_or(|t| t.is_null())
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
            assert!(round.waiting_on_you);
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
            assert!(!read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap().rounds[0].waiting_on_you);
        });
    }

    /// Issue #129: the dock reads an ADR question's draft and bar lines, and once it is answered Yes
    /// the Epic card reads the accepted ADR beside the ADRs linked to the Epic, as chips.
    #[test]
    fn an_adr_question_reads_with_its_draft_and_its_yes_shows_on_the_epic_card() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let args = serde_json::json!({
                "note": "One decision to record.",
                "questions": [{
                    "kind": "adr", "title": "Record the store", "question": "Record it as ADR 0005?",
                    "grounding": "docs/adr/0002", "recommended_answer": "Yes", "because": "It is hard to reverse",
                    "adr": {
                        "path": "docs/adr/0005-store.md", "text": "# The board is the store\n",
                        "hard_to_reverse": "Every Story reads it", "surprising": "Notes usually live in the repo",
                        "losing_alternative": "A .planning/ folder",
                    },
                }],
            });
            let (answer, _) = answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-3", "round_post", &args);
            assert_eq!(answer, None, "the Round is held");
            {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                let project: String =
                    conn.query_row("SELECT project_id FROM epics WHERE id = ?1", [&epic_id], |r| r.get(0)).unwrap();
                flywheel_core::domain::adr_link::link_adr(
                    &mut conn,
                    &human,
                    &project,
                    "docs/adr/0002-repo-holds-code-knowledge.md",
                    &flywheel_core::domain::adr_link::AdrLinkTarget::Epic(epic_id.clone()),
                )
                .unwrap();
            }

            let view = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap();
            let q = &view.rounds[0].questions[0];
            assert_eq!(q.kind, "adr");
            let adr = q.adr.as_ref().expect("the draft reaches the dock");
            assert_eq!(adr.path, "docs/adr/0005-store.md");
            assert_eq!(adr.losing_alternative, "A .planning/ folder");
            assert_eq!(adr.relates_to, None);
            assert_eq!(view.adr_links, ["docs/adr/0002-repo-holds-code-knowledge.md"]);
            assert!(view.accepted_knowledge.is_empty());

            answer_and_release(&db, |conn, human| {
                flywheel_core::domain::round::answer_round_question(conn, human, &q.id, &RoundAnswer::Own("Yes".into()))
            })
            .unwrap();
            let view = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap();
            let q = &view.rounds[0].questions[0];
            assert_eq!(q.answer.as_deref(), Some("Yes"));
            assert_eq!(view.accepted_knowledge.len(), 1, "the accepted ADR is a chip on the Epic card");
            let accepted = &view.accepted_knowledge[0];
            assert_eq!((accepted.target_type.as_str(), accepted.state.as_str()), ("adr", "accepted"));
            assert_eq!(q.adr_proposal_id.as_deref(), Some(accepted.id.as_str()));
            assert!(view.proposals.is_empty(), "an accepted ADR is never a ghost");
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

    /// Issue #124: Stop mid-Round, Continue shaping, and the fresh session's `round_wait` is held on the
    /// open Round, then released by the last answer, with every answer.
    #[test]
    fn continue_shaping_starts_a_session_whose_round_wait_is_released_by_the_last_answer() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let err = continue_epic(&db, &epic_id, found_claude, |_, _| panic!("nothing to continue")).unwrap_err();
            assert!(err.contains("no Round to continue"), "{err}");

            let first = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            answer_shaping_tool_call(&mut db.lock().unwrap(), &first, "req-1", "round_post", &round_args());
            let round = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap().rounds.remove(0);
            answer_and_release(&db, |conn, human| {
                flywheel_core::domain::round::answer_round_question(conn, human, &round.questions[0].id, &RoundAnswer::Recommended)
            })
            .unwrap();
            crate::commands::session::stop_session_recording_first(&mut db.lock().unwrap(), &first, || Ok(())).unwrap();
            assert!(!read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap().rounds[0].waiting_on_you, "no live session");

            let mut sent = None;
            let next = continue_epic(&db, &epic_id, found_claude, |_, request| {
                sent = Some(request.clone());
                Ok(())
            })
            .expect("Continue shaping starts a session");
            assert_ne!(next, first);
            let prompt = sent.unwrap()["prompt"].as_str().unwrap().to_string();
            assert!(prompt.contains("Answer (your recommendation, accepted): Yes"), "{prompt}");
            assert!(prompt.contains("`round_wait`"), "{prompt}");

            let (answer, changed) =
                answer_shaping_tool_call(&mut db.lock().unwrap(), &next, "req-2", "round_wait", &serde_json::json!({}));
            assert_eq!(answer, None, "round_wait is held");
            assert!(changed.is_some());
            assert!(read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap().rounds[0].waiting_on_you);

            let last = answer_and_release(&db, |conn, human| {
                flywheel_core::domain::round::answer_round_question(conn, human, &round.questions[1].id, &RoundAnswer::Recommended)
            })
            .unwrap();
            let release = last.release.expect("the last answer releases round_wait");
            assert_eq!((release.session_id.as_str(), release.request_id.as_str()), (next.as_str(), "req-2"));
            assert_eq!(release_answer(&release)["result"]["answers"].as_array().unwrap().len(), 2);
        });
    }

    #[test]
    fn a_round_post_while_a_round_is_open_is_refused_naming_round_wait() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-1", "round_post", &round_args());
            let (answer, _) = answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-2", "round_post", &round_args());
            assert!(answer.unwrap()["error"].as_str().unwrap().contains("round_wait"));
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

    fn open_status(db: &std::sync::Mutex<Connection>, epic_id: &str) -> StageStatusDto {
        read_epic_shaping(&db.lock().unwrap(), epic_id).unwrap().open_stage_status.expect("an open Stage")
    }

    /// Issue #126: the view lists what is open in the Stage, and Close Stage is refused until nothing is.
    #[test]
    fn the_view_lists_what_is_open_and_close_stage_is_refused_until_nothing_is() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            assert!(read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap().open_stage_status.is_none(), "no Stage before Shape");
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-1", "round_post", &round_args());

            let status = open_status(&db, &epic_id);
            assert!(!status.closable);
            assert_eq!(status.next.as_deref(), Some("slice"));
            let labels: Vec<&str> = status.open_items.iter().map(|i| i.label.as_str()).collect();
            assert_eq!(
                labels,
                ["Question 1 of Round 1 is unanswered: Audience", "Question 2 of Round 1 is unanswered: Surface"]
            );
            assert_eq!(status.warnings.len(), 3, "Problem, Scope and Exit test are empty: {:?}", status.warnings);

            let err = close_stage_and_shape(&db, &status.stage_id, |_| panic!("nothing to interrupt"), found_claude, |_, _| {
                panic!("nothing may be spawned")
            })
            .unwrap_err();
            assert!(err.contains("Question 2 of Round 1 is unanswered: Surface"), "{err}");
            assert_eq!(flywheel_core::domain::session::live_shaping_session(&db.lock().unwrap(), &ShapingSubject::Epic(epic_id.clone())).unwrap(), Some(run_id));
        });
    }

    /// Closing the Stage ends the session that worked it, interrupts its process once the close has
    /// committed, and starts the next Stage's session from a packet that names it.
    #[test]
    fn close_stage_opens_the_next_stage_and_starts_its_session_from_a_fresh_packet() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let first = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let stage_id = open_status(&db, &epic_id).stage_id;

            let mut interrupted = None;
            let mut sent = None;
            let dto = close_stage_and_shape(
                &db,
                &stage_id,
                |session| {
                    let conn = db.lock().expect("the lock is released before the interrupt");
                    let status: String =
                        conn.query_row("SELECT status FROM sessions WHERE id = ?1", [session], |r| r.get(0)).unwrap();
                    interrupted = Some((session.to_string(), status));
                    Ok(())
                },
                found_claude,
                |_, request| {
                    sent = Some(request.clone());
                    Ok(())
                },
            )
            .expect("Close Stage");

            assert_eq!(interrupted, Some((first.clone(), "interrupted".to_string())), "recorded first, then interrupted");
            let opened = dto.opened.as_ref().expect("Slice opens");
            assert_eq!((opened.kind.as_str(), opened.rank), ("slice", 2));
            assert!(dto.made_ready.is_empty());
            assert_eq!(dto.launch_error, None);
            assert_eq!(dto.sidecar_warning, None);
            let next = dto.session.expect("the next Stage's session started");
            assert_ne!(next.id, first);
            let prompt = sent.expect("one spawn")["prompt"].as_str().unwrap().to_string();
            assert!(prompt.contains("This session works the second Stage, Slice into Stories"), "{prompt}");

            let view = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap();
            let stages: Vec<(&str, &str)> = view.stages.iter().map(|s| (s.kind.as_str(), s.state.as_str())).collect();
            assert_eq!(stages, [("challenge_spec", "closed"), ("slice", "open")]);
        });
    }

    #[test]
    fn a_next_session_that_cannot_start_leaves_the_stage_closed_and_says_why() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let stage_id = open_status(&db, &epic_id).stage_id;
            let dto = close_stage_and_shape(&db, &stage_id, |_| Err("sidecar gone".into()), found_claude, |_, _| {
                Err("spawn boom".to_string())
            })
            .expect("the close itself succeeds");
            assert!(dto.session.is_none());
            assert!(dto.launch_error.as_deref().is_some_and(|e| e.contains("spawn boom")), "{:?}", dto.launch_error);
            assert!(dto.sidecar_warning.as_deref().is_some_and(|w| w.contains("sidecar gone")), "{:?}", dto.sidecar_warning);
            assert_eq!(open_status(&db, &epic_id).next.as_deref(), Some("criteria"), "the Slice Stage is open");
        });
    }

    /// A Milestone in Shaping with a first-draft exit test, in a project whose checkout is a plain directory.
    fn shaping_milestone() -> (std::sync::Mutex<Connection>, String, tempfile::TempDir) {
        let (db, epic_id, checkout) = shaping_epic();
        let milestone_id: String =
            db.lock().unwrap().query_row("SELECT milestone_id FROM epics WHERE id = ?1", [&epic_id], |r| r.get(0)).unwrap();
        (db, milestone_id, checkout)
    }

    /// Issue #132: Shape on a Milestone starts a session from the Milestone's packet, which opens its one
    /// Stage, Exit test; its view reads the Stage, the Round and the ghost, and Close Stage makes it Ready.
    #[test]
    fn shape_on_a_milestone_opens_exit_test_and_close_stage_makes_it_ready() {
        with_scratch(|| {
            let (db, milestone_id, _checkout) = shaping_milestone();
            let err = continue_milestone(&db, &milestone_id, found_claude, |_, _| panic!("nothing to continue")).unwrap_err();
            assert!(err.contains("no Round to continue"), "{err}");

            let mut sent = None;
            let run_id = shape_milestone(&db, &milestone_id, found_claude, |_, request| {
                sent = Some(request.clone());
                Ok(())
            })
            .expect("Shape starts a session");
            let prompt = sent.unwrap()["prompt"].as_str().unwrap().to_string();
            assert!(prompt.starts_with("# Shaping packet: Milestone Shaping\n"), "{prompt}");

            let view = read_milestone_shaping(&db.lock().unwrap(), &milestone_id).unwrap();
            assert_eq!(view.milestone.state, "shaping");
            let stages: Vec<(&str, &str)> = view.stages.iter().map(|s| (s.kind.as_str(), s.state.as_str())).collect();
            assert_eq!(stages, [("exit_test", "open")]);
            let status = view.open_stage_status.expect("the open Stage's status");
            assert!(status.closable, "nothing is open yet");
            assert_eq!(status.next, None);

            answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-1", "round_post", &round_args());
            let args = serde_json::json!({ "text": "A one-line idea becomes Ready Stories.", "why": "Round 1" });
            let (answer, changed) =
                answer_shaping_tool_call(&mut db.lock().unwrap(), &run_id, "req-2", "propose_exit_test", &args);
            assert_eq!(answer.expect("answered at once")["result"]["state"], "pending");
            assert!(changed.is_some());
            let view = read_milestone_shaping(&db.lock().unwrap(), &milestone_id).unwrap();
            assert!(view.rounds[0].waiting_on_you);
            assert_eq!(view.proposals.len(), 1, "the ghost over the exit test");
            let status = view.open_stage_status.unwrap();
            assert!(!status.closable);
            assert_eq!(status.open_items.len(), 3, "two questions and the Proposal");

            {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                flywheel_core::domain::round::accept_all_recommended(&mut conn, &human, &view.rounds[0].id).unwrap();
                flywheel_core::domain::proposal::accept_proposal(&mut conn, &human, &view.proposals[0].id).unwrap();
            }
            let view = read_milestone_shaping(&db.lock().unwrap(), &milestone_id).unwrap();
            assert!(view.proposals.is_empty(), "an accepted Proposal is in the exit test it rewrote");
            assert_eq!(view.milestone.exit_test.as_deref(), Some("A one-line idea becomes Ready Stories."));

            let stage_id = view.open_stage_status.unwrap().stage_id;
            let mut interrupted = None;
            let dto = close_stage_and_shape(
                &db,
                &stage_id,
                |session| {
                    interrupted = Some(session.to_string());
                    Ok(())
                },
                found_claude,
                |_, _| panic!("no Stage follows Exit test, so no session starts"),
            )
            .expect("Close Stage");
            assert_eq!(interrupted, Some(run_id));
            assert!(dto.opened.is_none());
            assert!(dto.session.is_none());
            assert_eq!(dto.launch_error, None);
            let view = read_milestone_shaping(&db.lock().unwrap(), &milestone_id).unwrap();
            assert_eq!(view.milestone.state, "ready");
            assert!(view.open_stage_status.is_none());
            assert_eq!(
                flywheel_core::domain::session::live_shaping_session(&db.lock().unwrap(), &ShapingSubject::Milestone(milestone_id)).unwrap(),
                None
            );
        });
    }

    /// Issue #128: the Criteria Stage lists each Story with no criterion, and closing it makes the
    /// Stories and the Epic Ready, opens no Stage and starts no session.
    #[test]
    fn closing_the_criteria_stage_makes_the_epic_ready_and_starts_no_session() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let story = {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                flywheel_core::domain::story::create_story(&mut conn, &human, &epic_id, "Parser").unwrap()
            };
            shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            for _ in 0..2 {
                let stage_id = open_status(&db, &epic_id).stage_id;
                // Each close starts the next Stage's session.
                close_stage_and_shape(&db, &stage_id, |_| Ok(()), found_claude, |_, _| Ok(())).unwrap();
            }
            let status = open_status(&db, &epic_id);
            assert_eq!((status.next.as_deref(), status.makes_ready, status.closable), (None, true, false));
            let item = &status.open_items[0];
            assert_eq!(
                (item.kind.as_str(), item.id.as_str(), item.story_key.as_deref(), item.title.as_str()),
                ("story_without_criterion", story.id.as_str(), Some(story.key.as_str()), "Parser")
            );

            {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                flywheel_core::domain::acceptance_criterion::create_criterion(&mut conn, &human, &story.id, "It parses").unwrap();
            }
            let status = open_status(&db, &epic_id);
            assert!(status.closable);
            let dto = close_stage_and_shape(&db, &status.stage_id, |_| Ok(()), || panic!("no session starts"), |_, _| {
                panic!("nothing may be spawned")
            })
            .unwrap();
            assert!(dto.opened.is_none());
            assert_eq!(dto.made_ready, vec![story.id.clone()]);
            assert!(dto.session.is_none() && dto.launch_error.is_none());
            let view = read_epic_shaping(&db.lock().unwrap(), &epic_id).unwrap();
            assert!(view.open_stage_status.is_none(), "no Stage is open");
            assert_eq!(view.stories[0].state, "ready");
        });
    }
}
