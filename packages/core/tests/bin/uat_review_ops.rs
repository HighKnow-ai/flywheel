//! The bridge `scripts/uat/uat-18-execution-proposals.mjs` (issue #160) and
//! `scripts/uat/uat-19-board-and-review.mjs` (issue #169) shell out to: the board's half of a running
//! Story filing Proposals, and of a Story's whole walk from Ready to Merged, driven through this crate's
//! own domain functions against a scratch `FLYWHEEL_APP_DATA_DIR` database, while the script drives the
//! REAL sidecar and its MCP server with a scripted fake agent.
//!
//! The Tauri commands the UATs exercise live in the desktop crate, which needs an `AppHandle`. Each is
//! a thin wrapper over a function in THIS crate, so this binary calls that function, as the other
//! `uat_*` bridges do:
//!
//!   story_start                    -> `domain::session::start_session` (creating the Story's worktree
//!                                     under the scratch `FLYWHEEL_WORKTREE_ROOT`) and
//!                                     `context_packet::build_context_packet`; the spawn request
//!                                     carries `SessionKind::Story`'s launch policy, as
//!                                     `spawn_request_in` builds it
//!   the board tool router          -> `commands::task::handle_inbound_board_tool_request`'s three
//!                                     routes for a Story session: `domain::task_tool`,
//!                                     `domain::story_proposal_tool` and `domain::handoff` (the
//!                                     hand-off and the feedback-only Check run), each answered as
//!                                     the desktop answers it
//!   the Story's Proposals          -> `domain::proposal::proposals_filed_by_story` (no screen lists
//!                                     them since issue #162; the UAT reads them to assert states)
//!   needs_you_list                 -> `query::needs_you::needs_you`
//!   proposal_list_for_triage       -> `domain::proposal::proposals_for_triage`
//!   proposal_accept / _reject      -> `domain::proposal::accept_proposal` / `reject_proposal`
//!   story_make_ready               -> `domain::story::make_ready` (issue #166)
//!   story_request_changes          -> `domain::request_changes::request_changes`, then the launch's
//!                                     database half (a session in the same worktree and its Context
//!                                     packet), as `request_changes_and_launch` does
//!   story_review                   -> `domain::review::review_for_story` and
//!                                     `domain::review_decisions::review_decisions`
//!   criterion_accept               -> `domain::acceptance_criterion::accept_criterion`
//!   story_adr_decide               -> `domain::review_decisions::set_adr_decision`
//!   story_merge                    -> `domain::story_merge::merge_story`
//!   the sidecar's session_closed   -> `domain::session::close_session`
//!
//! Not exercised: the `AppState` mutex, the `board:changed` emit and the IPC serialisation.
//!
//! Every subcommand refuses to run without `FLYWHEEL_APP_DATA_DIR`, prints ONE line of JSON on
//! success and exits 0; every failure is a message on stderr and a non-zero exit.
//!
//! Usage:
//!   uat_review_ops seed <repo_path>
//!   uat_review_ops seed-review <repo_path>
//!   uat_review_ops start-story <story_id>              (needs FLYWHEEL_WORKTREE_ROOT)
//!   uat_review_ops tool-call <run_id> <request_id> <tool> <args_json>
//!   uat_review_ops story-proposals <story_id>
//!   uat_review_ops needs-you <project_id>
//!   uat_review_ops triage <project_id>
//!   uat_review_ops accept <proposal_id>
//!   uat_review_ops reject <proposal_id> <reason>
//!   uat_review_ops make-ready <story_id>
//!   uat_review_ops request-changes <story_id> <comments> (needs FLYWHEEL_WORKTREE_ROOT)
//!   uat_review_ops review <story_id>
//!   uat_review_ops accept-criterion <criterion_id>
//!   uat_review_ops adr-decide <story_id> <path> keep|not_an_adr
//!   uat_review_ops merge <story_id>
//!   uat_review_ops adr-links <project_id>
//!   uat_review_ops session-closed <run_id>

use flywheel_core::domain::adr_link::{adr_links_for_project, AdrLinkTarget};
use flywheel_core::domain::handoff::{
    batch_as_tool_result, hand_off_with, handoff_as_tool_result, plan_feedback_run, run_checks, HandoffToolCall, HANDOFF_TOOL_NAMES,
};
use flywheel_core::domain::proposal::{accept_proposal, proposals_filed_by_story, proposals_for_triage, reject_proposal};
use flywheel_core::domain::review_decisions::{review_decisions, set_adr_decision, AdrDecision};
use flywheel_core::domain::session::{close_session, start_session, SessionStatus};
use flywheel_core::domain::session_kind::SessionKind;
use flywheel_core::domain::story::{self, HandWrittenCriterion, StoryState};
use flywheel_core::domain::story_merge::{merge_story, MergeOptions};
use flywheel_core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall, STORY_PROPOSAL_TOOL_NAMES};
use flywheel_core::domain::task_tool::{apply_task_tool_call, tasks_as_tool_result, TaskToolCall, TASK_TOOL_NAMES};
use flywheel_core::domain::{acceptance_criterion, actor, epic, milestone, project};
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
    let db_path = flywheel_core::db::default_db_path().unwrap_or_else(|e| fail(&format!("db path: {e:#}")));
    let backups = flywheel_core::db::default_backups_dir().unwrap_or_else(|e| fail(&format!("backups dir: {e:#}")));
    flywheel_core::db::open_and_migrate(&db_path, &backups).unwrap_or_else(|e| fail(&format!("open: {e:#}")))
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

/// Issue #169: one Milestone holding Epic "Parsing", its shaping closed (Ready) and its exit test
/// written, with one Ready Story "Parser", written by hand with two criteria: one proven by a Check, one
/// judged at review. Merging that Story leaves every Story of the Epic Merged, so Confirm exit test is
/// due.
fn seed_review(repo: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let p = ok("create_project", project::create_project(&mut conn, &h, "Threadfin", repo, "FLY", "main"));
    let m = ok("create_milestone", milestone::create_milestone(&mut conn, &p.id, &h, "Board and review", None));
    let e = ok("create_epic", epic::create_epic(&mut conn, &h, &m.id, "Parsing"));
    let spec = epic::EpicSpec {
        problem: Some("One bad line stops the parse".into()),
        scope: Some("The parser".into()),
        out_of_scope: None,
        exit_test: Some("A file with a bad line parses, and the error names the line".into()),
    };
    ok("update_epic", epic::update_epic(&mut conn, &h, &e.id, "Parsing", &spec));
    ok("set_epic_state", epic::set_epic_state(&mut conn, &h, &e.id, epic::EpicState::Ready));
    let criteria = [
        HandWrittenCriterion { statement: "The parser lives in src/parser.rs", check_command: Some("test -f src/parser.rs") },
        HandWrittenCriterion { statement: "A parse error names the line", check_command: None },
    ];
    let s = ok("write_story_by_hand", story::write_story_by_hand(&mut conn, &h, &e.id, "Parser", None, &criteria));
    let criteria: Vec<Value> = ok("criteria_for_story", acceptance_criterion::criteria_for_story(&conn, &s.id))
        .into_iter()
        .map(|c| json!({ "id": c.id, "statement": c.statement }))
        .collect();
    json!({
        "projectId": p.id,
        "epicId": e.id,
        "epicKey": e.key,
        "story": { "id": s.id, "key": s.key, "title": s.title, "state": s.state },
        "criteria": criteria,
    })
}

/// Start the Story as the desktop's Start does: Ready to Running, its session and worktree, and the
/// spawn request the desktop would send the sidecar (its `env` is the caller's to supply).
fn start_story(story_id: &str) -> Value {
    require_env("FLYWHEEL_WORKTREE_ROOT", "start_session would create a worktree under ~/Flywheel/");
    let mut conn = open_conn();
    let h = human(&conn);
    ok("set_story_state", story::set_story_state(&mut conn, &h, story_id, StoryState::Running));
    launch(&mut conn, &h, story_id)
}

/// The launch's database half for a Running Story, as `prepare_launch` does it: a session in the
/// Story's worktree (created on the first launch, reused after), its Context packet, and the spawn
/// request with `SessionKind::Story`'s launch policy, as `spawn_request_in` builds it.
fn launch(conn: &mut Connection, h: &str, story_id: &str) -> Value {
    let kind = SessionKind::Story;
    let policy = kind.launch_policy();
    let session = ok("start_session", start_session(conn, story_id, policy.permission_mode, h));
    let (path, branch): (String, String) = ok(
        "worktree",
        conn.query_row("SELECT path, branch FROM worktrees WHERE story_id = ?1", [story_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(anyhow::Error::from),
    );
    let prompt = ok("build_context_packet", flywheel_core::context_packet::build_context_packet(conn, story_id, ""));
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

/// One board tool call from the session, answered as the desktop's router answers it:
/// `{"answer": {"result": ..}}` or `{"answer": {"error": ..}}`. A Task, Proposal or hand-off tool; none
/// is held on the developer, so a call to anything else is a failure of the UAT. A hand-off runs every
/// Check in the worktree before it answers, as `commands::handoff` does on its own thread.
fn tool_call(run_id: &str, tool: &str, args: &str) -> Value {
    let mut conn = open_conn();
    let args: Value = serde_json::from_str(args).unwrap_or_else(|e| fail(&format!("args: {e}")));
    let result: anyhow::Result<Value> = if STORY_PROPOSAL_TOOL_NAMES.contains(&tool) {
        StoryProposalCall::parse(tool, &args).and_then(|call| apply_story_proposal_call(&mut conn, run_id, &call)).map(|o| o.result)
    } else if TASK_TOOL_NAMES.contains(&tool) {
        TaskToolCall::parse(tool, &args)
            .and_then(|call| apply_task_tool_call(&mut conn, run_id, &call))
            .map(|o| tasks_as_tool_result(&o.tasks))
    } else if HANDOFF_TOOL_NAMES.contains(&tool) {
        HandoffToolCall::parse(tool, &args).and_then(|call| match call {
            HandoffToolCall::ChecksRun => {
                let batch = run_checks(&plan_feedback_run(&conn, run_id)?)?;
                let mut result = batch_as_tool_result(&batch);
                result["recorded"] = Value::Bool(false);
                Ok(result)
            }
            HandoffToolCall::Handoff(summary) => hand_off_with(&mut conn, run_id, &summary).map(|o| handoff_as_tool_result(&o)),
        })
    } else {
        fail(&format!("{tool} is not a Task, Proposal or hand-off tool; the UAT's agent calls only those"));
    };
    let answer = match result {
        Ok(result) => json!({ "result": result }),
        Err(e) => json!({ "error": format!("{e:#}") }),
    };
    json!({ "answer": answer })
}

/// The Proposals the Story's sessions filed, in every state.
fn story_proposals(story_id: &str) -> Value {
    let conn = open_conn();
    let rows: Vec<Value> = ok("proposals_filed_by_story", proposals_filed_by_story(&conn, story_id))
        .into_iter()
        .map(|p| json!({ "id": p.id, "verb": p.verb, "targetType": p.target_type, "payload": p.payload, "state": p.state, "evidence": p.evidence }))
        .collect();
    json!({ "proposals": rows })
}

/// Needs you, as the board's column reads it: each item's kind, id and record, and what its card shows.
fn needs_you(project_id: &str) -> Value {
    let conn = open_conn();
    let items: Vec<Value> = ok("needs_you", flywheel_core::query::needs_you::needs_you(&conn, project_id))
        .into_iter()
        .map(|i| {
            json!({
                "kind": i.kind.as_str(),
                "id": i.id,
                "record": { "kind": i.record.kind, "id": i.record.id, "key": i.record.key, "title": i.record.title },
                "conflicts": i.conflicts,
                "proposals": i.proposals.map(|p| json!({ "count": p.count, "stories": p.stories, "epics": p.epics })),
                "judgedOn": i.judged_on.map(|j| json!({
                    "proposalId": j.proposal_id,
                    "change": j.change,
                    "criterionId": j.criterion_id,
                    "before": j.before,
                    "after": j.after,
                    "filedBy": j.filed_by,
                    "duplicateOf": j.duplicate.map(|d| d.proposal_id),
                })),
                "exitTest": i.exit_test,
            })
        })
        .collect();
    json!({ "items": items })
}

/// The triage drawer's list.
fn triage(project_id: &str) -> Value {
    let conn = open_conn();
    let rows: Vec<Value> = ok("proposals_for_triage", proposals_for_triage(&conn, project_id))
        .into_iter()
        .map(|t| {
            json!({
                "id": t.proposal.id,
                "verb": t.proposal.verb,
                "targetType": t.proposal.target_type,
                "payload": t.proposal.payload,
                "storyKey": t.story_key,
                "epicKey": t.epic_key,
                "evidence": t.proposal.evidence,
                "duplicateOf": t.duplicate.map(|d| d.proposal_id),
            })
        })
        .collect();
    json!({ "proposals": rows })
}

fn accept(proposal_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let applied = ok("accept_proposal", accept_proposal(&mut conn, &h, proposal_id));
    json!({ "applied": format!("{applied:?}") })
}

fn reject(proposal_id: &str, reason: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    ok("reject_proposal", reject_proposal(&mut conn, &h, proposal_id, Some(reason)));
    json!({ "rejected": proposal_id })
}

/// The developer's Make Ready on a Story (issue #166): its state after, and how many criteria it has.
fn make_ready(story_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    ok("make_ready", story::make_ready(&mut conn, &h, story_id));
    let s = ok("get_story", story::get_story(&conn, story_id)).unwrap_or_else(|| fail("the Story is gone"));
    let criteria = ok("criteria_for_story", acceptance_criterion::criteria_for_story(&conn, story_id));
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

/// The developer's Request changes: the comments close the review, the Story moves to Running, and a
/// fresh session starts in the same worktree from a packet that carries them.
fn request_changes(story_id: &str, comments: &str) -> Value {
    require_env("FLYWHEEL_WORKTREE_ROOT", "start_session would create a worktree under ~/Flywheel/");
    let mut conn = open_conn();
    let h = human(&conn);
    ok("request_changes", flywheel_core::domain::request_changes::request_changes(&mut conn, &h, story_id, comments));
    launch(&mut conn, &h, story_id)
}

/// The review card's read: the Story's state, its criteria with their Checks, what would hold Merge, and
/// the Decisions section.
fn review(story_id: &str) -> Value {
    let conn = open_conn();
    let r = ok("review_for_story", flywheel_core::domain::review::review_for_story(&conn, story_id));
    let d = ok("review_decisions", review_decisions(&conn, story_id));
    let criteria: Vec<Value> = r
        .criteria
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "statement": c.statement,
                "accepted": c.accepted,
                "preTicked": c.pre_ticked,
                "check": c.check.as_ref().map(|k| json!({ "command": k.command, "result": k.result.as_str(), "stale": k.stale })),
            })
        })
        .collect();
    let decisions: Vec<Value> = d
        .changes
        .iter()
        .map(|c| {
            json!({
                "kind": c.kind.as_str(),
                "path": c.path,
                "status": c.status,
                "flags": c.flags.iter().map(|f| f.as_str()).collect::<Vec<_>>(),
                "newAdr": c.new_adr.as_ref().map(|a| json!({
                    "title": a.title,
                    "barLinesFrom": a.bar_lines_from.map(|b| b.as_str()),
                    "hardToReverse": a.bar_lines.as_ref().map(|b| b.hard_to_reverse.clone()),
                    "decision": a.decision.as_str(),
                })),
            })
        })
        .collect();
    json!({
        "storyState": r.story_state,
        "open": r.review.is_some(),
        "files": r.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
        "criteria": criteria,
        "failingChecks": r.failing_checks.len(),
        "openTasks": r.open_tasks,
        "liveSession": r.live_session,
        "conflicts": r.conflicts,
        "decisions": decisions,
    })
}

fn accept_criterion(criterion_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    ok("accept_criterion", acceptance_criterion::accept_criterion(&mut conn, &h, criterion_id));
    json!({ "accepted": criterion_id })
}

fn adr_decide(story_id: &str, path: &str, decision: &str) -> Value {
    let decision = match decision {
        "keep" => AdrDecision::Keep,
        "not_an_adr" => AdrDecision::NotAnAdr,
        other => fail(&format!("unknown ADR decision {other:?}; this bridge takes keep or not_an_adr")),
    };
    let mut conn = open_conn();
    let h = human(&conn);
    ok("set_adr_decision", set_adr_decision(&mut conn, &h, story_id, path, &decision));
    json!({ "path": path, "decision": decision.as_str() })
}

/// The developer's Merge, with no failing Check to override.
fn merge(story_id: &str) -> Value {
    let mut conn = open_conn();
    let h = human(&conn);
    let o = ok("merge_story", merge_story(&mut conn, &h, story_id, MergeOptions::default()));
    let s = ok("get_story", story::get_story(&conn, story_id)).unwrap_or_else(|| fail("the Story is gone"));
    json!({
        "mergeCommit": o.merge_commit,
        "baseBranch": o.base_branch,
        "method": o.method.as_str(),
        "cleanupWarning": o.cleanup_warning,
        "adrsLinked": o.adrs_linked,
        "storyState": s.state,
    })
}

fn adr_links(project_id: &str) -> Value {
    let conn = open_conn();
    let links: Vec<Value> = ok("adr_links_for_project", adr_links_for_project(&conn, project_id))
        .into_iter()
        .map(|l| {
            let (kind, id) = match l.target {
                AdrLinkTarget::Milestone(id) => ("milestone", id),
                AdrLinkTarget::Epic(id) => ("epic", id),
                AdrLinkTarget::Story(id) => ("story", id),
            };
            json!({ "path": l.path, "kind": kind, "id": id })
        })
        .collect();
    json!({ "links": links })
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
        "seed-review" => seed_review(arg(1)),
        "start-story" => start_story(arg(1)),
        "tool-call" => tool_call(arg(1), arg(3), arg(4)),
        "story-proposals" => story_proposals(arg(1)),
        "needs-you" => needs_you(arg(1)),
        "triage" => triage(arg(1)),
        "accept" => accept(arg(1)),
        "reject" => reject(arg(1), arg(2)),
        "make-ready" => make_ready(arg(1)),
        "request-changes" => request_changes(arg(1), arg(2)),
        "review" => review(arg(1)),
        "accept-criterion" => accept_criterion(arg(1)),
        "adr-decide" => adr_decide(arg(1), arg(2), arg(3)),
        "merge" => merge(arg(1)),
        "adr-links" => adr_links(arg(1)),
        "session-closed" => session_closed(arg(1)),
        other => fail(&format!("unknown subcommand {other:?}")),
    };
    println!("{out}");
}
