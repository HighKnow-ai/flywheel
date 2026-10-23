//! The bridge `scripts/uat/uat-18-execution-proposals.mjs` shells out to (issue #160): the board's half
//! of a running Story filing Proposals, driven through this crate's own domain functions against a
//! scratch `FLYWHEEL_APP_DATA_DIR` database, while the script drives the REAL sidecar and its MCP server
//! with a scripted fake agent.
//!
//! The Tauri commands the UAT exercises live in the desktop crate, which needs an `AppHandle`. Each is
//! a thin wrapper over a function in THIS crate, so this binary calls that function, as the other
//! `uat_*` bridges do:
//!
//!   story_start                    -> `domain::session::start_session` (creating the Story's worktree
//!                                     under the scratch `FLYWHEEL_WORKTREE_ROOT`) and
//!                                     `context_packet::build_context_packet`; the spawn request
//!                                     carries `SessionKind::Story`'s launch policy, as
//!                                     `spawn_request_in` builds it
//!   the board tool router          -> `domain::story_proposal_tool::apply_story_proposal_call`, answered
//!                                     as `commands::proposal::answer_story_proposal_tool_call` answers it
//!   proposal_list_for_story        -> `domain::proposal::proposals_filed_by_story`
//!   proposal_accept                -> `domain::proposal::accept_proposal`
//!   story_make_ready               -> `domain::story::make_ready` (issue #166)
//!   the sidecar's session_closed   -> `domain::session::close_session`
//!
//! Not exercised: the `AppState` mutex, the `board:changed` emit and the IPC serialisation.
//!
//! Every subcommand refuses to run without `FLYWHEEL_APP_DATA_DIR`, prints ONE line of JSON on
//! success and exits 0; every failure is a message on stderr and a non-zero exit.
//!
//! Usage:
//!   uat_review_ops seed <repo_path>
//!   uat_review_ops start-story <story_id>              (needs FLYWHEEL_WORKTREE_ROOT)
//!   uat_review_ops tool-call <run_id> <request_id> <tool> <args_json>
//!   uat_review_ops story-proposals <story_id>
//!   uat_review_ops accept <proposal_id>
//!   uat_review_ops make-ready <story_id>
//!   uat_review_ops session-closed <run_id>

use core::domain::proposal::{accept_proposal, proposals_filed_by_story};
use core::domain::session::{close_session, start_session, SessionStatus};
use core::domain::session_kind::SessionKind;
use core::domain::story::{self, StoryState};
use core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall, STORY_PROPOSAL_TOOL_NAMES};
use core::domain::{actor, epic, milestone, project};
use rusqlite::Connection;
use serde_json::{json, Value};

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn require_env(name: &str, why: &str) {
    if std::env::var_os(name).is_none() {
        fail(&format!("{name} is not set — {why}"));
    }
}

fn open_conn() -> Connection {
    require_env("FLYWHEEL_APP_DATA_DIR", "refusing to touch the real fleet database. Point it at a scratch directory.");
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

/// A Roadmap of two Milestones; the Current one holds Epic "Parsing", its shaping closed (Ready), with a
/// Ready Story "Parser" (the one the UAT starts), a Story "Lexer" still in Shaping and a Ready Story
/// "Printer".
fn seed(repo: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let p = ok("create_project", project::create_project(&mut conn, &h, "Threadfin", repo, "FLY", "main"));
    let m = ok("create_milestone", milestone::create_milestone(&mut conn, &p.id, &h, "Board and review", None));
    let next = ok("create_milestone", milestone::create_milestone(&mut conn, &p.id, &h, "Relay", None));
    let e = ok("create_epic", epic::create_epic(&mut conn, &h, &m.id, "Parsing"));
    let mut stories = Vec::new();
    for (title, state) in [("Parser", Some(StoryState::Ready)), ("Lexer", None), ("Printer", Some(StoryState::Ready))] {
        let s = ok("create_story", story::create_story(&mut conn, &h, &e.id, title));
        if let Some(state) = state {
            ok("set_story_state", story::set_story_state(&mut conn, &h, &s.id, state));
        }
        stories.push(json!({ "id": s.id, "key": s.key, "title": title }));
    }
    ok("set_epic_state", epic::set_epic_state(&mut conn, &h, &e.id, epic::EpicState::Ready));
    json!({ "projectId": p.id, "epicId": e.id, "nextMilestoneId": next.id, "stories": stories })
}

/// Start the Story as the desktop's Start does: Ready to Running, its session and worktree, and the
/// spawn request the desktop would send the sidecar (its `env` is the caller's to supply).
fn start_story(story_id: &str) -> Value {
    require_env("FLYWHEEL_WORKTREE_ROOT", "start_session would create a worktree under ~/Flywheel/");
    let mut conn = open_conn();
    let h = human(&conn);
    ok("set_story_state", story::set_story_state(&mut conn, &h, story_id, StoryState::Running));
    let kind = SessionKind::Story;
    let policy = kind.launch_policy();
    let session = ok("start_session", start_session(&mut conn, story_id, policy.permission_mode, &h));
    let (path, branch): (String, String) = ok(
        "worktree",
        conn.query_row("SELECT path, branch FROM worktrees WHERE story_id = ?1", [story_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(anyhow::Error::from),
    );
    let prompt = ok("build_context_packet", core::context_packet::build_context_packet(&conn, story_id, ""));
    let policy_env: serde_json::Map<String, Value> = policy.env.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    json!({
        "spawn": {
            "op": "spawn",
            "runId": session.id,
            "prompt": prompt,
            "permissionMode": policy.permission_mode,
            "allowedTools": policy.allowed_tools,
            "disallowedTools": policy.disallowed_tools,
            "permissionPrompt": policy.raises_requests,
            "sessionKind": kind.as_str(),
        },
        "policyEnv": policy_env,
        "worktreePath": path,
        "branch": branch,
    })
}

/// One board tool call from the session, answered as the desktop's router answers a Story Proposal
/// tool: `{"answer": {"result": ..}}` or `{"answer": {"error": ..}}`. These tools are never held, so a
/// call to anything else is a failure of the UAT.
fn tool_call(run_id: &str, tool: &str, args: &str) -> Value {
    if !STORY_PROPOSAL_TOOL_NAMES.contains(&tool) {
        fail(&format!("{tool} is not a Story Proposal tool; the UAT's agent calls only propose and proposal_withdraw"));
    }
    let mut conn = open_conn();
    let args: Value = serde_json::from_str(args).unwrap_or_else(|e| fail(&format!("args: {e}")));
    let answer = match StoryProposalCall::parse(tool, &args).and_then(|call| apply_story_proposal_call(&mut conn, run_id, &call)) {
        Ok(outcome) => json!({ "result": outcome.result }),
        Err(e) => json!({ "error": format!("{e:#}") }),
    };
    json!({ "answer": answer })
}

/// The Proposals the Story's sessions filed, as the Story view lists them.
fn story_proposals(story_id: &str) -> Value {
    let conn = open_conn();
    let rows: Vec<Value> = ok("proposals_filed_by_story", proposals_filed_by_story(&conn, story_id))
        .into_iter()
        .map(|p| json!({ "id": p.id, "verb": p.verb, "targetType": p.target_type, "payload": p.payload, "state": p.state, "evidence": p.evidence }))
        .collect();
    json!({ "proposals": rows })
}

fn accept(proposal_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let applied = ok("accept_proposal", accept_proposal(&mut conn, &h, proposal_id));
    json!({ "applied": format!("{applied:?}") })
}

/// The developer's Make Ready on a Story (issue #166): its state after, and how many criteria it has.
fn make_ready(story_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    ok("make_ready", story::make_ready(&mut conn, &h, story_id));
    let s = ok("get_story", story::get_story(&conn, story_id)).unwrap_or_else(|| fail("the Story is gone"));
    let criteria = ok("criteria_for_story", core::domain::acceptance_criterion::criteria_for_story(&conn, story_id));
    let checks: i64 = ok(
        "count checks",
        conn.query_row(
            "SELECT COUNT(*) FROM checks k JOIN acceptance_criteria c ON c.id = k.criterion_id WHERE c.story_id = ?1",
            [story_id],
            |r| r.get(0),
        )
        .map_err(Into::into),
    );
    json!({ "state": s.state, "criteria": criteria.len(), "checks": checks })
}

fn session_closed(run_id: &str) -> Value {
    let mut conn = open_conn();
    ok("close_session", close_session(&mut conn, run_id, SessionStatus::Completed, None, None, None));
    json!({ "closed": run_id })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or_else(|| fail("missing argument; see the usage in this file's header"));
    let out = match arg(0) {
        "seed" => seed(arg(1)),
        "start-story" => start_story(arg(1)),
        "tool-call" => tool_call(arg(1), arg(3), arg(4)),
        "story-proposals" => story_proposals(arg(1)),
        "accept" => accept(arg(1)),
        "make-ready" => make_ready(arg(1)),
        "session-closed" => session_closed(arg(1)),
        other => fail(&format!("unknown subcommand {other:?}")),
    };
    println!("{out}");
}
