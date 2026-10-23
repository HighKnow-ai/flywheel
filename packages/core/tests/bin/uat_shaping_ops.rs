//! The bridge `scripts/uat/uat-16-epic-shaping.mjs` shells out to (issue #130): the board's half of
//! shaping one Epic from a one-line idea to Ready Stories, driven through this crate's own domain
//! functions against a scratch `FLYWHEEL_APP_DATA_DIR` database, while the script drives the REAL
//! sidecar and its MCP server with a scripted fake agent.
//!
//! The Tauri commands the UAT exercises live in the desktop crate, which needs an `AppHandle`. Each is
//! a thin wrapper over a function in THIS crate, so this binary calls that function, as the other
//! `uat_*` bridges do:
//!
//!   epic_shape / shaping_continue  -> `start_shaping_session(Epic)` and `build_shaping_packet`, the body
//!                                     of `commands::shaping::shape_subject`; Continue shaping first
//!                                     refuses an Epic with no Round, as `continue_epic` does. The spawn
//!                                     request carries `SessionKind::Shaping`'s launch policy, as
//!                                     `spawn_request_in` builds it
//!   the board tool router          -> `domain::shaping_tool::apply_shaping_tool_call`, answered as
//!                                     `commands::shaping::answer_shaping_tool_call` answers it
//!   round_accept / round_answer    -> `domain::round::answer_round_question`
//!   round_accept_all               -> `domain::round::accept_all_recommended`
//!   proposal_accept                -> `domain::proposal::accept_proposal_released`
//!   stage_close                    -> `domain::stage::close_stage`, then, for a Stage it opened, the
//!                                     next session as `close_stage_and_shape` starts it
//!   the sidecar's session_closed   -> `domain::session::apply_session_closed`, on the sidecar's own
//!                                     event, as `handle_inbound_session_closed` applies it
//!   a Story session's packet       -> `context_packet::build_context_packet`
//!
//! Not exercised: the `AppState` mutex, the `board:changed` emit and the IPC serialisation.
//!
//! Every subcommand refuses to run without `FLYWHEEL_APP_DATA_DIR`, prints ONE line of JSON on
//! success and exits 0; every failure is a message on stderr and a non-zero exit.
//!
//! Usage:
//!   uat_shaping_ops seed <repo_path>
//!   uat_shaping_ops shape <epic_id>                       (Shape on the Epic card)
//!   uat_shaping_ops continue <epic_id>                    (Continue shaping)
//!   uat_shaping_ops tool-call <run_id> <request_id> <tool> <args_json>
//!   uat_shaping_ops answer <question_id> recommended      (Accept on one question)
//!   uat_shaping_ops answer <question_id> own <text>       (the developer's own words)
//!   uat_shaping_ops accept-all <round_id>                 (Accept all recommended)
//!   uat_shaping_ops decide <proposal_id>                  (Accept on a ghost)
//!   uat_shaping_ops close-stage <epic_id>                 (Close Stage on the open one)
//!   uat_shaping_ops session-closed <event_json>
//!   uat_shaping_ops epic <epic_id>                        (what the Epic card and the dock read)
//!   uat_shaping_ops story-packet <story_id>

use core::domain::acceptance_criterion::criteria_for_story;
use core::domain::check::check_for_criterion;
use core::domain::proposal::{accept_proposal_released, proposals_on_epic};
use core::domain::round::{accept_all_recommended, answer_round_question, rounds_for_epic, AnswerOutcome, RoundAnswer};
use core::domain::session::{apply_session_closed, live_shaping_session, start_shaping_session, ShapingSubject};
use core::domain::session_kind::SessionKind;
use core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome};
use core::domain::stage::{close_stage, open_stage, stage_status, stages_for_epic};
use core::domain::story::stories_in_epic;
use core::domain::{actor, epic, milestone, project};
use rusqlite::Connection;
use serde_json::{json, Value};

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn open_conn() -> Connection {
    if std::env::var_os("FLYWHEEL_APP_DATA_DIR").is_none() {
        fail("FLYWHEEL_APP_DATA_DIR is not set — refusing to touch the real fleet database. Point it at a scratch directory.");
    }
    let db_path = core::db::default_db_path().unwrap_or_else(|e| fail(&format!("db path: {e:#}")));
    let backups = core::db::default_backups_dir().unwrap_or_else(|e| fail(&format!("backups dir: {e:#}")));
    core::db::open_and_migrate(&db_path, &backups).unwrap_or_else(|e| fail(&format!("open: {e:#}")))
}

fn human(conn: &Connection) -> String {
    actor::local_human_actor_id(conn).unwrap_or_else(|e| fail(&format!("human actor: {e:#}")))
}

fn ok<T>(what: &str, r: anyhow::Result<T>) -> T {
    r.unwrap_or_else(|e| fail(&format!("{what}: {e:#}")))
}

/// A project on `repo` with one Milestone and one Epic that is a one-line idea: a title, nothing else.
fn seed(repo: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let p = ok("create_project", project::create_project(&mut conn, &h, "Threadfin", repo, "FLY", "main"));
    let m = ok("create_milestone", milestone::create_milestone(&mut conn, &p.id, &h, "Shaping", None));
    let e = ok("create_epic", epic::create_epic(&mut conn, &h, &m.id, "Feed rows show the agent's live verb"));
    json!({ "projectId": p.id, "milestoneId": m.id, "epicId": e.id, "epicKey": e.key, "title": e.title })
}

/// The spawn request the desktop's `shape_subject` sends for a shaping session: `SessionKind::Shaping`'s
/// launch policy and the Epic's shaping packet as its prompt (its `env` is the caller's to supply).
fn spawn_for(run_id: &str, prompt: String) -> Value {
    let kind = SessionKind::Shaping;
    let policy = kind.launch_policy();
    let policy_env: serde_json::Map<String, Value> = policy.env.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    json!({
        "spawn": {
            "op": "spawn",
            "runId": run_id,
            "prompt": prompt,
            "permissionMode": policy.permission_mode,
            "allowedTools": policy.allowed_tools,
            "disallowedTools": policy.disallowed_tools,
            "permissionPrompt": policy.raises_requests,
            "sessionKind": kind.as_str(),
        },
        "policyEnv": policy_env,
    })
}

/// Start a shaping session on the Epic and build its packet, as Shape (and Close Stage, for the next
/// Stage) does.
fn start_on(conn: &mut Connection, epic_id: &str) -> Value {
    let h = human(conn);
    let subject = ShapingSubject::Epic(epic_id.to_string());
    let session =
        ok("start_shaping_session", start_shaping_session(conn, &subject, SessionKind::Shaping.launch_policy().permission_mode, &h));
    let prompt = ok("build_shaping_packet", core::shaping_packet::build_shaping_packet(conn, &subject));
    spawn_for(&session.id, prompt)
}

fn shape(epic_id: &str) -> Value {
    let mut conn = open_conn();
    start_on(&mut conn, epic_id)
}

/// Continue shaping: refused for an Epic with no Round to continue from, as `continue_epic` refuses it.
fn continue_shaping(epic_id: &str) -> Value {
    let mut conn = open_conn();
    if ok("rounds_for_epic", rounds_for_epic(&conn, epic_id)).is_empty() {
        fail("this Epic has no Round to continue from; Shape it to start its first Round");
    }
    start_on(&mut conn, epic_id)
}

/// One board tool call from the session, answered as the desktop's shaping router answers it:
/// `{"answer": {"result": ..}}`, `{"answer": {"error": ..}}`, or `{"answer": null}` while held.
fn tool_call(run_id: &str, request_id: &str, tool: &str, args: &str) -> Value {
    let mut conn = open_conn();
    let args: Value = serde_json::from_str(args).unwrap_or_else(|e| fail(&format!("args: {e}")));
    let answer = match ShapingToolCall::parse(tool, &args).and_then(|call| apply_shaping_tool_call(&mut conn, run_id, request_id, &call)) {
        Ok(ShapingToolOutcome::Held { .. }) => Value::Null,
        Ok(ShapingToolOutcome::Answered { result, .. }) => json!({ "result": result }),
        Err(e) => json!({ "error": format!("{e:#}") }),
    };
    json!({ "answer": answer })
}

/// What the dock relays after an answer: the held call the answer settles, if it settled one.
fn released(outcome: AnswerOutcome) -> Value {
    let release = outcome.release.map(|r| json!({ "sessionId": r.session_id, "requestId": r.request_id, "answer": { "result": r.result } }));
    json!({ "round": outcome.round_id, "release": release })
}

fn answer(question_id: &str, how: &str, text: Option<&str>) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let given = match (how, text) {
        ("recommended", None) => RoundAnswer::Recommended,
        ("own", Some(text)) => RoundAnswer::Own(text.to_string()),
        _ => fail("answer: `recommended`, or `own <text>`"),
    };
    released(ok("answer_round_question", answer_round_question(&mut conn, &h, question_id, &given)))
}

fn accept_all(round_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    released(ok("accept_all_recommended", accept_all_recommended(&mut conn, &h, round_id)))
}

/// The developer accepts a Proposal; a held call it settles comes back as `release`.
fn decide(proposal_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let decided = ok("accept", accept_proposal_released(&mut conn, &h, proposal_id, None));
    let release = decided.release.map(|r| json!({ "sessionId": r.session_id, "requestId": r.request_id, "answer": { "result": r.result } }));
    json!({ "release": release })
}

/// Close Stage on the Epic's open Stage; for the Stage it opens, the next session starts on a fresh
/// packet, as `close_stage_and_shape` starts it.
fn close(epic_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let stage = ok("open_stage", open_stage(&conn, &ShapingSubject::Epic(epic_id.to_string())))
        .unwrap_or_else(|| fail("the Epic has no open Stage"));
    let closed = ok("close_stage", close_stage(&mut conn, &h, &stage.id));
    let next = closed.opened.as_ref().and_then(|s| s.epic_id.clone()).map(|id| start_on(&mut conn, &id));
    json!({
        "closed": closed.closed.kind.as_str(),
        "opened": closed.opened.map(|s| s.kind.as_str()),
        "madeReady": closed.made_ready,
        "endedSession": closed.ended_session,
        "next": next,
    })
}

/// The sidecar's own `session_closed` event, applied as the desktop applies it.
fn session_closed(event: &str) -> Value {
    let mut conn = open_conn();
    let event: Value = serde_json::from_str(event).unwrap_or_else(|e| fail(&format!("event: {e}")));
    let outcome = ok("apply_session_closed", apply_session_closed(&mut conn, &event));
    json!({ "outcome": format!("{outcome:?}") })
}

/// What the Epic card and the shaping dock read: the Epic, its Stages, the open Stage's open items,
/// its Rounds with every answer, its Proposals, its Stories with their criteria and Checks, and its
/// live shaping session.
fn epic_view(epic_id: &str) -> Value {
    let conn = open_conn();
    let e = ok("get_epic", epic::get_epic(&conn, epic_id)).unwrap_or_else(|| fail("no such Epic"));
    let stages: Vec<Value> = ok("stages_for_epic", stages_for_epic(&conn, epic_id))
        .iter()
        .map(|s| json!({ "kind": s.kind.as_str(), "state": s.state }))
        .collect();
    let open = match ok("open_stage", open_stage(&conn, &ShapingSubject::Epic(epic_id.to_string()))) {
        Some(stage) => {
            let status = ok("stage_status", stage_status(&conn, &stage.id));
            let items: Vec<String> = status.open_items.iter().map(|i| i.label()).collect();
            json!({ "kind": stage.kind.as_str(), "openItems": items, "closable": status.closable() })
        }
        None => Value::Null,
    };
    let rounds: Vec<Value> = ok("rounds_for_epic", rounds_for_epic(&conn, epic_id))
        .iter()
        .map(|r| {
            let questions: Vec<Value> = r
                .questions
                .iter()
                .map(|q| {
                    json!({
                        "id": q.id, "title": q.title, "kind": if q.adr.is_some() { "adr" } else { "question" },
                        "answer": q.answer, "answeredWith": q.answered_with, "adrProposalId": q.adr_proposal_id,
                    })
                })
                .collect();
            json!({
                "id": r.id, "number": r.number, "stage": r.stage_kind.as_str(), "state": r.state, "sessionId": r.session_id,
                "heldRequestId": r.held_request_id, "waitingOnYou": r.waiting_on_you, "questions": questions,
            })
        })
        .collect();
    let proposals: Vec<Value> = ok("proposals_on_epic", proposals_on_epic(&conn, epic_id))
        .iter()
        .map(|p| json!({ "id": p.id, "targetType": p.target_type, "verb": p.verb, "state": p.state, "payload": p.payload }))
        .collect();
    let all = ok("stories_in_epic", stories_in_epic(&conn, epic_id));
    let key_of = |id: &str| all.iter().find(|s| s.id == id).map(|s| s.key.clone());
    let stories: Vec<Value> = all
        .iter()
        .map(|s| {
            let criteria: Vec<Value> = ok("criteria_for_story", criteria_for_story(&conn, &s.id))
                .iter()
                .map(|c| {
                    let check = ok("check_for_criterion", check_for_criterion(&conn, &c.id));
                    json!({
                        "statement": c.statement,
                        "check": check.as_ref().map(|k| k.command.clone()),
                        "timeoutSecs": check.as_ref().map(|k| k.timeout_secs),
                    })
                })
                .collect();
            json!({
                "id": s.id, "key": s.key, "title": s.title, "state": s.state,
                "runsAfter": s.runs_after_story_id.as_deref().and_then(key_of), "runsAfterReason": s.runs_after_reason,
                "criteria": criteria,
            })
        })
        .collect();
    let live = ok("live_shaping_session", live_shaping_session(&conn, &ShapingSubject::Epic(epic_id.to_string())));
    json!({
        "state": e.state,
        "spec": { "problem": e.spec.problem, "scope": e.spec.scope, "exitTest": e.spec.exit_test },
        "stages": stages, "open": open, "rounds": rounds, "proposals": proposals, "stories": stories, "liveSession": live,
    })
}

/// The Context packet a Story session starts from (no resume note).
fn story_packet(story_id: &str) -> Value {
    let conn = open_conn();
    json!({ "packet": ok("build_context_packet", core::context_packet::build_context_packet(&conn, story_id, "")) })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or_else(|| fail("missing argument; see the usage in this file's header"));
    let out = match arg(0) {
        "seed" => seed(arg(1)),
        "shape" => shape(arg(1)),
        "continue" => continue_shaping(arg(1)),
        "tool-call" => tool_call(arg(1), arg(2), arg(3), arg(4)),
        "answer" => answer(arg(1), arg(2), args.get(3).map(String::as_str)),
        "accept-all" => accept_all(arg(1)),
        "decide" => decide(arg(1)),
        "close-stage" => close(arg(1)),
        "session-closed" => session_closed(arg(1)),
        "epic" => epic_view(arg(1)),
        "story-packet" => story_packet(arg(1)),
        other => fail(&format!("unknown subcommand {other:?}")),
    };
    println!("{out}");
}
