//! The bridge `scripts/uat/uat-17-roadmap-round.mjs` shells out to (issue #134): the board's half of
//! a roadmap Round, driven through this crate's own domain functions against a scratch
//! `FLYWHEEL_APP_DATA_DIR` database, while the script drives the REAL sidecar and its MCP server with
//! a scripted fake agent.
//!
//! The Tauri commands the UAT exercises live in the desktop crate, which needs an `AppHandle`. Each is
//! a thin wrapper over a function in THIS crate, so this binary calls that function, as the other
//! `uat_*` bridges do:
//!
//!   epic_confirm_done              -> `domain::confirm_done::confirm_epic_done`, then, for an opened
//!                                     Round, `start_shaping_session(Roadmap)` and
//!                                     `roadmap_packet::build_roadmap_packet`, the body of
//!                                     `commands::roadmap_round::revisit_roadmap`; the spawn request
//!                                     carries `SessionKind::Shaping`'s launch policy, as
//!                                     `spawn_request_in` builds it
//!   the board tool router          -> `domain::shaping_tool::apply_shaping_tool_call`, answered as
//!                                     `commands::shaping::answer_shaping_tool_call` answers it
//!   proposal_accept / _reject      -> `domain::proposal::{accept,reject}_proposal_released`, whose
//!                                     release answers the held `round_wait`
//!   the sidecar's session_closed   -> `domain::session::close_session`
//!
//! Not exercised: the `AppState` mutex, the `board:changed` emit and the IPC serialisation.
//!
//! Every subcommand refuses to run without `FLYWHEEL_APP_DATA_DIR`, prints ONE line of JSON on
//! success and exits 0; every failure is a message on stderr and a non-zero exit.
//!
//! Usage:
//!   uat_roadmap_ops seed <repo_path>
//!   uat_roadmap_ops shape-milestone <milestone_id>     (#132's milestone_shape)
//!   uat_roadmap_ops answer-round <milestone_id>        (Accept all recommended on its open Round)
//!   uat_roadmap_ops milestone <milestone_id>
//!   uat_roadmap_ops close-exit-test <milestone_id>     (stage_close on its Exit test Stage)
//!   uat_roadmap_ops confirm-epic <epic_id>
//!   uat_roadmap_ops tool-call <run_id> <request_id> <tool> <args_json>
//!   uat_roadmap_ops decide <proposal_id> <accept|reject>
//!   uat_roadmap_ops session-closed <run_id>
//!   uat_roadmap_ops roadmap <project_id>

use core::domain::confirm_done::{confirm_epic_done, DoneTrigger};
use core::domain::proposal::{accept_proposal_released, proposals_in_round, proposals_on_milestone, reject_proposal_released};
use core::domain::round::{accept_all_recommended, rounds_for_milestone};
use core::domain::stage::{close_stage, open_stage};
use core::domain::roadmap_round::{describe_proposal, latest_roadmap_round, noted_triggers};
use core::domain::session::{close_session, start_shaping_session, SessionStatus, ShapingSubject};
use core::domain::session_kind::SessionKind;
use core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome};
use core::domain::story::{self, StoryState};
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

/// A Roadmap of two Milestones; the first, still in Shaping, holds two Ready Epics with an exit test each and
/// one Story each, already Merged: both Epics' exit tests can be confirmed.
fn seed(repo: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let p = ok("create_project", project::create_project(&mut conn, &h, "Threadfin", repo, "FLY", "main"));
    let m = ok(
        "create_milestone",
        milestone::create_milestone(&mut conn, &p.id, &h, "Shaping", Some("Cyril takes a one-line idea to Ready Stories in Flywheel")),
    );
    // The Milestone stays in Shaping: the UAT shapes its exit test, and closing that Stage makes it Ready.
    let next = ok("create_milestone", milestone::create_milestone(&mut conn, &p.id, &h, "Board and review", Some("A Story merges in Flywheel alone")));
    let mut epics = Vec::new();
    for (title, exit) in [("Rounds", "A Round is answered on the board"), ("Roadmap strip", "The Roadmap reads at a glance")] {
        let e = ok("create_epic", epic::create_epic(&mut conn, &h, &m.id, title));
        let mut spec = e.spec.clone();
        spec.exit_test = Some(exit.to_string());
        ok("update_epic", epic::update_epic(&mut conn, &h, &e.id, title, &spec));
        let s = ok("create_story", story::create_story(&mut conn, &h, &e.id, &format!("{title}: the one slice")));
        for to in [StoryState::Ready, StoryState::Running, StoryState::InReview, StoryState::Merged] {
            ok("set_story_state", story::set_story_state(&mut conn, &h, &s.id, to));
        }
        ok("set_epic_state", epic::set_epic_state(&mut conn, &h, &e.id, epic::EpicState::Ready));
        epics.push(json!({ "id": e.id, "key": e.key, "title": title }));
    }
    json!({ "projectId": p.id, "milestoneId": m.id, "nextMilestoneId": next.id, "epics": epics })
}

/// Confirm the Epic Done; for an opened Round, start its session as Revisit roadmap does and return
/// the spawn request the desktop would send the sidecar (its `env` is the caller's to supply).
fn confirm_epic(epic_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let outcome = ok("confirm_epic_done", confirm_epic_done(&mut conn, &h, epic_id));
    let round = outcome.round().clone();
    let DoneTrigger::Opened(_) = outcome else {
        return json!({ "outcome": "noted", "round": round.number });
    };
    let session = ok(
        "start_shaping_session",
        start_shaping_session(
            &mut conn,
            &ShapingSubject::Roadmap(round.project_id.clone()),
            SessionKind::Shaping.launch_policy().permission_mode,
            &h,
        ),
    );
    let prompt = ok("build_roadmap_packet", core::roadmap_packet::build_roadmap_packet(&conn, &round.project_id));
    let mut out = spawn_for(&session.id, prompt);
    out["outcome"] = json!("opened");
    out["round"] = json!(round.number);
    out
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

/// The developer decides a Proposal; a held `round_wait` it settles comes back as `release`.
fn decide(proposal_id: &str, verdict: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let decided = match verdict {
        "accept" => ok("accept", accept_proposal_released(&mut conn, &h, proposal_id, None)),
        "reject" => ok("reject", reject_proposal_released(&mut conn, &h, proposal_id, Some("Not in this Milestone"))),
        other => fail(&format!("decide: {other:?} is not accept or reject")),
    };
    let release = decided.release.map(|r| json!({ "sessionId": r.session_id, "requestId": r.request_id, "answer": { "result": r.result } }));
    json!({ "release": release })
}

/// The spawn request the desktop's `shaping_launch` sends for a session of `subject`: `SessionKind::Shaping`'s
/// launch policy and the subject's shaping packet as its prompt (its `env` is the caller's to supply).
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

/// Shape a Milestone's exit test (#132's `milestone_shape`): start its shaping session, which opens the
/// Exit test Stage, on its shaping packet.
fn shape_milestone(milestone_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let subject = ShapingSubject::Milestone(milestone_id.to_string());
    let session = ok(
        "start_shaping_session",
        start_shaping_session(&mut conn, &subject, SessionKind::Shaping.launch_policy().permission_mode, &h),
    );
    let prompt = ok("build_shaping_packet", core::shaping_packet::build_shaping_packet(&conn, &subject));
    spawn_for(&session.id, prompt)
}

/// The developer answers the Milestone's open Round with every recommended answer (Accept all
/// recommended); the held `round_post` it settles comes back as `release`.
fn answer_round(milestone_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let round = ok("rounds_for_milestone", rounds_for_milestone(&conn, milestone_id))
        .into_iter()
        .find(|r| r.state == "open")
        .unwrap_or_else(|| fail("the Milestone has no open Round"));
    let outcome = ok("accept_all_recommended", accept_all_recommended(&mut conn, &h, &round.id));
    let release = outcome.release.map(|r| json!({ "sessionId": r.session_id, "requestId": r.request_id, "answer": { "result": r.result } }));
    json!({ "round": round.number, "release": release })
}

/// The Milestone as its shaping left it: state, exit test, and its pending Proposals.
fn milestone_view(milestone_id: &str) -> Value {
    let conn = open_conn();
    let m = ok("get_milestone", milestone::get_milestone(&conn, milestone_id)).unwrap_or_else(|| fail("no such Milestone"));
    let pending: Vec<Value> = ok("proposals_on_milestone", proposals_on_milestone(&conn, milestone_id))
        .iter()
        .filter(|p| p.state == "pending")
        .map(|p| json!({ "id": p.id, "payload": p.payload }))
        .collect();
    json!({ "state": m.state, "exitTest": m.exit_test, "pending": pending })
}

/// The developer closes the Milestone's Exit test Stage: it moves to Ready (#132).
fn close_exit_test(milestone_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let stage = ok("open_stage", open_stage(&conn, &ShapingSubject::Milestone(milestone_id.to_string())))
        .unwrap_or_else(|| fail("the Milestone has no open Stage"));
    let closed = ok("close_stage", close_stage(&mut conn, &h, &stage.id));
    json!({ "closed": closed.closed.id, "endedSession": closed.ended_session })
}

fn session_closed(run_id: &str) -> Value {
    let mut conn = open_conn();
    ok("close_session", close_session(&mut conn, run_id, SessionStatus::Completed, None, None, None));
    json!({ "closed": run_id })
}

/// What the Roadmap reads now: the latest roadmap Round, how it ended, its Proposals and the noted
/// triggers; every Milestone with its Epics.
fn roadmap(project_id: &str) -> Value {
    let conn = open_conn();
    let round = ok("latest_roadmap_round", latest_roadmap_round(&conn, project_id)).map(|r| {
        let proposals: Vec<Value> = ok("proposals_in_round", proposals_in_round(&conn, &r.id))
            .iter()
            .map(|p| json!({ "id": p.id, "summary": describe_proposal(&conn, p), "state": p.state }))
            .collect();
        let ended: Option<String> = conn
            .query_row(
                "SELECT json_extract(payload, '$.label') FROM events WHERE stream_type = 'round' AND stream_id = ?1
                 AND event_type IN ('round.closed', 'round.dismissed') ORDER BY sequence DESC LIMIT 1",
                [&r.id],
                |row| row.get(0),
            )
            .ok();
        let noted: Vec<String> = ok("noted_triggers", noted_triggers(&conn, &r.id)).iter().map(|t| t.label(&conn)).collect();
        json!({
            "number": r.number, "state": r.state, "trigger": r.trigger.as_str(), "triggerLabel": r.trigger.label(&conn),
            "proposals": proposals, "ended": ended, "noted": noted,
        })
    });
    let milestones: Vec<Value> = ok("roadmap", milestone::roadmap(&conn, project_id))
        .iter()
        .map(|m| {
            let epics: Vec<Value> = ok("epics", epic::epics_in_milestone(&conn, &m.id))
                .iter()
                .map(|e| json!({ "key": e.key, "title": e.title, "state": e.state }))
                .collect();
            json!({ "id": m.id, "title": m.title, "state": m.state, "epics": epics })
        })
        .collect();
    json!({ "round": round, "milestones": milestones })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or_else(|| fail("missing argument; see the usage in this file's header"));
    let out = match arg(0) {
        "seed" => seed(arg(1)),
        "shape-milestone" => shape_milestone(arg(1)),
        "answer-round" => answer_round(arg(1)),
        "milestone" => milestone_view(arg(1)),
        "close-exit-test" => close_exit_test(arg(1)),
        "confirm-epic" => confirm_epic(arg(1)),
        "tool-call" => tool_call(arg(1), arg(2), arg(3), arg(4)),
        "decide" => decide(arg(1), arg(2)),
        "session-closed" => session_closed(arg(1)),
        "roadmap" => roadmap(arg(1)),
        other => fail(&format!("unknown subcommand {other:?}")),
    };
    println!("{out}");
}
