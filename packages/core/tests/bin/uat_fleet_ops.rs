//! The bridge `scripts/uat/uat-12-fleet-live-reads.mjs` shells out to: the fleet's reads and writes,
//! driven through this crate's own domain and query functions against a scratch
//! `FLYWHEEL_APP_DATA_DIR` database (plan 11-15, register items D-REV-48, 49, 50, 55).
//!
//! The Tauri commands those items name (`fleet_list`, `fleet_blocked_queue`, `session_acknowledge`,
//! `session_answer_permission`, `worktree_reclaim`) live in the desktop crate, which needs an
//! `AppHandle` and a cold build of 13 minutes. Each is a thin wrapper over a function in THIS crate,
//! so this binary calls that function, the same way the other `uat_*` bridges do:
//!
//!   fleet_list                  -> `query::fleet::fleet_rows`, then `session_log::read_tail` per LIVE
//!                                  row (a four-line copy of the private `attach_activity` in
//!                                  `commands/fleet.rs`; the live-status set is repeated below)
//!   fleet_blocked_queue         -> `query::fleet::blocked_queue`
//!   session_acknowledge       -> `domain::session::acknowledge_run`
//!   session_answer_permission -> `domain::permission_request::answer_request` (its DB half; the
//!                                  sidecar relay and the `allow_always` rule write are not driven)
//!   worktree_reclaim            -> `domain::worktree::reclaim_worktrees` on a connection of its
//!                                  own, opened and given pragmas exactly as the command does
//!
//! What is NOT exercised by going through this binary: the `AppState` mutex, `spawn_blocking`, the
//! `board:changed` emit and the IPC serialisation. Those stay with the installed build.
//!
//! Read-shaped subcommands (`fleet-list`, `blocked-queue`) open the database the way the running
//! app's reads see it (plain open plus pragmas, no migration), so they can run while another
//! process reclaims. Every subcommand refuses to run without `FLYWHEEL_APP_DATA_DIR`, and
//! `reclaim` and `make-reclaimable` also refuse without `FLYWHEEL_WORKTREE_ROOT`, because the
//! default root is `~/Flywheel/`, the developer's real worktrees.
//!
//! Every subcommand prints ONE line of JSON on success (`reclaim` prints two, see below) and exits
//! 0; every failure is a message on stderr and a non-zero exit.
//!
//! Usage:
//!   uat_fleet_ops register-project <repo_path> <name> <key_prefix>
//!   uat_fleet_ops start-run <project_id> <title>
//!   uat_fleet_ops block-run <run_id>
//!   uat_fleet_ops finish-run <run_id> <completed|failed>
//!   uat_fleet_ops append-log <run_id> <line>
//!   uat_fleet_ops fleet-list
//!   uat_fleet_ops blocked-queue
//!   uat_fleet_ops acknowledge <run_id>
//!   uat_fleet_ops answer <request_id> <allow|deny>
//!   uat_fleet_ops make-reclaimable <project_id> <title>
//!   uat_fleet_ops reclaim <story_id>...     (prints {"event":"reclaim-start","ms":N} then the result)

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use core::domain::session::{close_session, start_session, SessionStatus};
use core::domain::story::{self, StoryState};
use core::domain::{actor, epic, milestone, permission_request, project, worktree};
use rusqlite::Connection;
use serde_json::json;

/// A Story to hang a session or a worktree off: a Milestone and an Epic, then the Story, as a
/// developer would create them.
fn new_story(conn: &mut Connection, project_id: &str, actor_id: &str, title: &str) -> story::Story {
    let m = milestone::create_milestone(conn, project_id, actor_id, "UAT milestone", None)
        .unwrap_or_else(|e| fail(&format!("create_milestone: {e:#}")));
    let e = epic::create_epic(conn, actor_id, &m.id, "UAT epic").unwrap_or_else(|e| fail(&format!("create_epic: {e:#}")));
    story::create_story(conn, actor_id, &e.id, title).unwrap_or_else(|e| fail(&format!("create_story: {e:#}")))
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn require_env(name: &str, why: &str) {
    if std::env::var_os(name).is_none() {
        fail(&format!("{name} is not set — {why}"));
    }
}

fn epoch_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// The writing open: migrates, like every other harness bridge.
fn open_conn() -> Connection {
    require_env(
        "FLYWHEEL_APP_DATA_DIR",
        "refusing to touch the real fleet database. Point it at a scratch directory.",
    );
    let db_path = core::db::default_db_path().unwrap_or_else(|e| fail(&format!("db path: {e:#}")));
    let backups = core::db::default_backups_dir().unwrap_or_else(|e| fail(&format!("backups dir: {e:#}")));
    core::db::open_and_migrate(&db_path, &backups).unwrap_or_else(|e| fail(&format!("open: {e:#}")))
}

/// The reading open: a plain connection with the app's pragmas, never migrating. This is how
/// `worktree_reclaim` opens its own connection, and it is a fair stand-in for `state.db`.
fn open_plain() -> Connection {
    require_env(
        "FLYWHEEL_APP_DATA_DIR",
        "refusing to touch the real fleet database. Point it at a scratch directory.",
    );
    let db_path = core::db::default_db_path().unwrap_or_else(|e| fail(&format!("db path: {e:#}")));
    let conn = Connection::open(&db_path).unwrap_or_else(|e| fail(&format!("open: {e}")));
    core::db::apply_pragmas(&conn).unwrap_or_else(|e| fail(&format!("pragmas: {e:#}")));
    conn
}

fn human(conn: &Connection) -> String {
    actor::local_human_actor_id(conn).unwrap_or_else(|e| fail(&format!("local human actor: {e:#}")))
}

fn arg(args: &[String], i: usize, usage: &str) -> String {
    args.get(i).cloned().unwrap_or_else(|| fail(&format!("usage: uat_fleet_ops {usage}")))
}

/// `commands/fleet.rs::is_live`.
fn is_live(run_status: &str) -> bool {
    matches!(run_status, "running" | "blocked")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sub = args.first().map(String::as_str).unwrap_or("");
    match sub {
        "register-project" => {
            let usage = "register-project <repo_path> <name> <key_prefix>";
            let (repo, name, prefix) = (arg(&args, 1, usage), arg(&args, 2, usage), arg(&args, 3, usage));
            let mut conn = open_conn();
            let actor_id = human(&conn);
            let p = project::register_project(&mut conn, &actor_id, Path::new(&repo), &name, &prefix)
                .unwrap_or_else(|e| fail(&format!("register_project: {e:#}")));
            println!("{}", json!({ "projectId": p.id }));
        }
        "start-run" => {
            let usage = "start-run <project_id> <title>";
            let (project_id, title) = (arg(&args, 1, usage), arg(&args, 2, usage));
            require_env("FLYWHEEL_WORKTREE_ROOT", "start_session would create a worktree under ~/Flywheel/");
            let mut conn = open_conn();
            let actor_id = human(&conn);
            let s = new_story(&mut conn, &project_id, &actor_id, &title);
            let run = start_session(&mut conn, &s.id, "default", &actor_id)
                .unwrap_or_else(|e| fail(&format!("start_session: {e:#}")));
            println!("{}", json!({ "storyId": s.id, "runId": run.id }));
        }
        "block-run" => {
            let run_id = arg(&args, 1, "block-run <run_id>");
            let mut conn = open_conn();
            let actor_id = human(&conn);
            let req = permission_request::create_pending_request(
                &mut conn,
                &run_id,
                "Bash",
                Some(r#"{"command":"cargo test"}"#),
                &actor_id,
                None,
            )
            .unwrap_or_else(|e| fail(&format!("create_pending_request: {e:#}")));
            println!("{}", json!({ "requestId": req.id }));
        }
        "finish-run" => {
            let usage = "finish-run <run_id> <completed|failed>";
            let (run_id, status) = (arg(&args, 1, usage), arg(&args, 2, usage));
            let status = match status.as_str() {
                "completed" => SessionStatus::Completed,
                "failed" => SessionStatus::Failed,
                other => fail(&format!("status must be completed or failed, got {other:?}")),
            };
            let mut conn = open_conn();
            close_session(&mut conn, &run_id, status, None, None, None)
                .unwrap_or_else(|e| fail(&format!("close_session: {e:#}")));
            println!("{}", json!({ "closed": true }));
        }
        "append-log" => {
            let usage = "append-log <run_id> <line>";
            let (run_id, line) = (arg(&args, 1, usage), arg(&args, 2, usage));
            require_env("FLYWHEEL_APP_DATA_DIR", "refusing to write into the real session logs.");
            core::session_log::append_event_line(&run_id, &line)
                .unwrap_or_else(|e| fail(&format!("append_event_line: {e:#}")));
            println!("{}", json!({ "appended": true }));
        }
        "fleet-list" => {
            let started = epoch_ms();
            let conn = open_plain();
            let list = core::query::fleet::fleet_rows(&conn, 200)
                .unwrap_or_else(|e| fail(&format!("fleet_rows: {e:#}")));
            drop(conn);
            let rows: Vec<_> = list
                .rows
                .into_iter()
                .map(|r| {
                    let activity = if is_live(&r.run_status) {
                        core::session_log::read_tail(&r.session_id).map(|t| t.lines).unwrap_or_default()
                    } else {
                        Vec::new()
                    };
                    json!({
                        "sessionId": r.session_id,
                        "projectName": r.project_name,
                        "runStatus": r.run_status,
                        "fleetState": r.fleet_state,
                        "activityLines": activity,
                    })
                })
                .collect();
            println!(
                "{}",
                json!({ "totalRows": list.total_rows, "rows": rows, "startMs": started, "endMs": epoch_ms() })
            );
        }
        "blocked-queue" => {
            let conn = open_plain();
            let entries = core::query::fleet::blocked_queue(&conn, 200)
                .unwrap_or_else(|e| fail(&format!("blocked_queue: {e:#}")));
            let entries: Vec<_> = entries
                .into_iter()
                .map(|e| {
                    json!({
                        "requestId": e.request_id,
                        "sessionId": e.session_id,
                        "projectName": e.project_name,
                    })
                })
                .collect();
            println!("{}", json!({ "entries": entries }));
        }
        "acknowledge" => {
            let run_id = arg(&args, 1, "acknowledge <run_id>");
            let conn = open_conn();
            let changed = core::domain::session::acknowledge_run(&conn, &run_id)
                .unwrap_or_else(|e| fail(&format!("acknowledge_run: {e:#}")));
            println!("{}", json!({ "changed": changed }));
        }
        "answer" => {
            let usage = "answer <request_id> <allow|deny>";
            let (request_id, decision) = (arg(&args, 1, usage), arg(&args, 2, usage));
            // `commands/session.rs::db_decision_for`, for the two decisions this bridge needs.
            let db_decision = match decision.as_str() {
                "allow" => "allowed",
                "deny" => "denied",
                other => fail(&format!("decision must be allow or deny, got {other:?}")),
            };
            let mut conn = open_conn();
            let actor_id = human(&conn);
            let answered = permission_request::answer_request(&mut conn, &request_id, db_decision, &actor_id)
                .unwrap_or_else(|e| fail(&format!("answer_request: {e:#}")));
            println!("{}", json!({ "runId": answered.session_id }));
        }
        "make-reclaimable" => {
            let usage = "make-reclaimable <project_id> <title>";
            let (project_id, title) = (arg(&args, 1, usage), arg(&args, 2, usage));
            require_env("FLYWHEEL_WORKTREE_ROOT", "ensure_worktree would create a worktree under ~/Flywheel/");
            let mut conn = open_conn();
            let actor_id = human(&conn);
            let s = new_story(&mut conn, &project_id, &actor_id, &title);
            let wt = worktree::ensure_worktree(&mut conn, &s.id, &actor_id)
                .unwrap_or_else(|e| fail(&format!("ensure_worktree: {e:#}")));
            story::set_story_state(&mut conn, &actor_id, &s.id, StoryState::Dropped)
                .unwrap_or_else(|e| fail(&format!("set_story_state: {e:#}")));
            println!("{}", json!({ "storyId": s.id, "path": wt.path }));
        }
        "reclaim" => {
            let ids: Vec<String> = args.iter().skip(1).cloned().collect();
            if ids.is_empty() {
                fail("usage: uat_fleet_ops reclaim <story_id>...");
            }
            require_env("FLYWHEEL_WORKTREE_ROOT", "reclaim removes worktrees and the default root is ~/Flywheel/");
            // The actor is resolved on one connection, the batch runs on another, as the command does.
            let actor_id = human(&open_plain());
            let mut conn = open_plain();
            println!("{}", json!({ "event": "reclaim-start", "ms": epoch_ms() }));
            let outcomes = worktree::reclaim_worktrees(&mut conn, &ids, &actor_id);
            let end = epoch_ms();
            let outcomes: Vec<_> = outcomes
                .into_iter()
                .map(|o| {
                    json!({
                        "storyId": o.story_id,
                        "removed": o.removed,
                        "reason": o.reason.map(|r| r.as_str().to_string()),
                        "error": o.error,
                    })
                })
                .collect();
            println!("{}", json!({ "event": "reclaim-end", "ms": end, "outcomes": outcomes }));
        }
        _ => fail("usage: uat_fleet_ops <register-project|start-run|block-run|finish-run|append-log|fleet-list|blocked-queue|acknowledge|answer|make-reclaimable|reclaim> ..."),
    }
}
