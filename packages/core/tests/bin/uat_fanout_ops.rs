//! The bridge `scripts/uat/uat-13-fan-out-live.mjs` shells out to: the core half of a whole fan-out,
//! driven with the REAL dispatcher tick (`dispatch_exec::run_pass`) against a scratch database and a
//! scratch git repository (plan 11-16, register item D-REV-34).
//!
//! The one thing core cannot do is start an agent process, so `run_pass` takes a `spawn` closure. In
//! the desktop crate that closure is `launch_run_for_task`, which needs an `AppHandle`. Here the
//! closure does the same core steps the desktop launch body does, in the same order, and then PRINTS
//! the sidecar spawn request instead of sending it; the Node harness forwards that request to the
//! real sidecar process, which spawns the scripted fake `claude`. When a session closes, the harness
//! hands the sidecar's own `session_closed` event back through `session-closed`, which calls the
//! production consumer `domain::agent_run::apply_session_closed`.
//!
//! Mirrored from `commands/agent_run.rs::prepare_launch` + `start_agent_run_recording_first`
//! (desktop crate, `pub(crate)`, not linkable): `start_agent_run` under the SYSTEM actor,
//! `assemble_context_packet`, `render_prompt` with `DISPATCHED_COMMIT_INSTRUCTION`, the worktree path
//! read, `arm_scope_marker_with`, and the shim environment. NOT mirrored: the credential block, drift
//! warnings, criteria pinning, the per-repository spawn floor (`SidecarHandle::send_spawn_request`),
//! the `board:changed` emit. This bridge therefore proves the wiring from the tick to a running
//! session and back, not the desktop launch body itself.
//!
//! Every subcommand refuses to run without `FLYWHEEL_APP_DATA_DIR`, `FLYWHEEL_WORKTREE_ROOT` and
//! `FLYWHEEL_RUNTIME_DIR` (T-11-45): the defaults are the developer's real data, worktrees and
//! runtime directory.
//!
//! Usage:
//!   uat_fanout_ops setup <repo_path> <cap> <tasks_json>
//!       tasks_json: [{"title": "...", "file": "path/in/repo", "wave": 1}, ...]
//!   uat_fanout_ops tick                      (prints one `spawn-request` line per spawn, then `pass`)
//!   uat_fanout_ops session-closed <event_json>
//!   uat_fanout_ops state <plan_id>
//!
//! The planner-file-set arm (`scripts/uat/uat-14-planner-file-set.mjs`, phase 15 plan 02) reuses this
//! bridge for the PLANNING half of the same machinery, so nothing about `submit_plan` is re-implemented
//! in the script:
//!   uat_fanout_ops plan-setup <repo_path> <tasks_json>    tasks_json: [{"title": "..."}, ...]
//!   uat_fanout_ops plan-start <epic_id>                   the production `begin_planning_run` (real prompt)
//!   uat_fanout_ops plan-submit <run_id> <submission_json> resolve the run, then the production
//!                                                         `store_submitted_plan`; a refusal prints {"refused": text}
//!   uat_fanout_ops plan-readback <plan_id>                stored tasks, entries (in order), events, preview edges

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use core::context_packet::{assemble_context_packet, render_prompt, DISPATCHED_COMMIT_INSTRUCTION};
use core::dispatch_exec::run_pass;
use core::domain::actor::{local_human_actor_id, system_actor};
use core::domain::agent_run::{apply_session_closed, start_agent_run};
use core::domain::dispatch_plan::{
    approve_and_start, create_plan_for_epic, edit_draft_plan, preview_edges_with, read_plan, resolve_planning_run,
    store_submitted_plan, DraftEdit, SubmittedPlan,
};
use core::domain::epic::create_epic;
use core::domain::file_set::{arm_scope_marker_with, declare_file_set, list_entries_for_task, repo_is_case_insensitive};
use core::domain::project::register_project;
use core::domain::settings::set_dispatch_max_parallel;
use core::domain::task::create_task;
use core::domain::worktree::worktree_for_task;
use core::file_set::{entry_path, parse_entry};
use rusqlite::Connection;
use serde_json::json;

/// `commands/dispatch.rs::DISPATCH_PERMISSION_MODE`.
const DISPATCH_PERMISSION_MODE: &str = "acceptEdits";

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn require_env(name: &str, why: &str) {
    if std::env::var_os(name).is_none() {
        fail(&format!("{name} is not set - {why}"));
    }
}

fn require_scratch() {
    require_env("FLYWHEEL_APP_DATA_DIR", "refusing to touch the real fleet database. Point it at a scratch directory.");
    require_env("FLYWHEEL_WORKTREE_ROOT", "refusing to create worktrees under ~/Flywheel/. Point it at a scratch directory.");
    require_env("FLYWHEEL_RUNTIME_DIR", "refusing to write markers into the real runtime directory. Point it at a scratch directory.");
}

fn open_conn() -> Connection {
    require_scratch();
    let db_path = core::db::default_db_path().unwrap_or_else(|e| fail(&format!("db path: {e:#}")));
    let backups = core::db::default_backups_dir().unwrap_or_else(|e| fail(&format!("backups dir: {e:#}")));
    core::db::open_and_migrate(&db_path, &backups).unwrap_or_else(|e| fail(&format!("open: {e:#}")))
}

fn arg(args: &[String], i: usize, usage: &str) -> String {
    args.get(i).cloned().unwrap_or_else(|| fail(&format!("usage: uat_fanout_ops {usage}")))
}

/// The environment a dispatched session is spawned with: the shim env, the runtime-protocol keys and
/// the default branch, built by the same core functions `resolved_env_for_run` and
/// `merge_shim_env_for_run` use (sans credential block), plus the one fake-agent key.
fn session_env(conn: &Connection, project_id: &str, run_id: &str, commit_file: Option<&str>) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = BTreeMap::new();
    env.extend(core::shim::shim_env_for_run(run_id).unwrap_or_else(|e| fail(&format!("shim env: {e:#}"))));
    let runtime = core::runtime_protocol::runtime_dir().unwrap_or_else(|e| fail(&format!("runtime dir: {e:#}")));
    env.insert("FLYWHEEL_RUNTIME_DIR".into(), runtime.to_string_lossy().into_owned());
    env.insert("FLYWHEEL_HEARTBEAT_STALE_MS".into(), core::runtime_protocol::HEARTBEAT_STALE_MS.to_string());
    env.insert("FLYWHEEL_HEARTBEAT_POLL_MS".into(), core::runtime_protocol::HEARTBEAT_POLL_MS.to_string());
    let default_branch: String = conn
        .query_row("SELECT default_branch FROM projects WHERE id = ?1", [project_id], |r| r.get(0))
        .unwrap_or_else(|e| fail(&format!("default branch: {e}")));
    env.insert("FLYWHEEL_DEFAULT_BRANCH".into(), default_branch);
    if let Some(file) = commit_file {
        env.insert("FLYWHEEL_FAKE_COMMIT_FILE".into(), file.to_string());
    }
    env
}

/// One dispatcher launch: the core steps of the desktop launch body, then the request on stdout.
fn launch(db: &Mutex<Connection>, task_id: &str) -> Result<(), String> {
    let (repo_path, project_id): (String, String) = {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
        conn.query_row(
            "SELECT projects.repo_path, tasks.project_id FROM tasks JOIN projects ON projects.id = tasks.project_id WHERE tasks.id = ?1",
            [task_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    // `git config` runs with no lock held, as `observed_fold_case` does.
    let fold_case = repo_is_case_insensitive(Path::new(&repo_path));

    let mut conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let system = system_actor(&conn).map_err(|e| e.to_string())?.id;
    let run = start_agent_run(&mut conn, task_id, DISPATCH_PERMISSION_MODE, &system).map_err(|e| format!("{e:#}"))?;
    let packet = assemble_context_packet(&conn, task_id).map_err(|e| e.to_string())?;
    let prompt = render_prompt(&packet, DISPATCHED_COMMIT_INSTRUCTION);
    let worktree_path: String = conn
        .query_row("SELECT path FROM worktrees WHERE id = ?1", [run.worktree_id.as_deref().unwrap_or("")], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mode = arm_scope_marker_with(&conn, &run.id, task_id, Path::new(&worktree_path), fold_case)?;
    let declared = list_entries_for_task(&conn, task_id).map_err(|e| e.to_string())?;
    let commit_file = declared.first().map(|e| entry_path(e).to_string());
    let env = session_env(&conn, &project_id, &run.id, commit_file.as_deref());
    drop(conn);

    let request = json!({
        "id": run.id,
        "op": "spawn",
        "runId": run.id,
        "worktreePath": worktree_path,
        "prompt": prompt,
        "permissionMode": DISPATCH_PERMISSION_MODE,
        "scopeArmed": mode == core::runtime_protocol::ScopeMode::Armed,
        "env": env,
    });
    println!("{}", json!({ "event": "spawn-request", "taskId": task_id, "request": request }));
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str).unwrap_or("") {
        "setup" => {
            let usage = "setup <repo_path> <cap> <tasks_json>";
            let (repo, cap, tasks_json) = (arg(&args, 1, usage), arg(&args, 2, usage), arg(&args, 3, usage));
            let cap: u32 = cap.parse().unwrap_or_else(|_| fail("cap must be a number"));
            let specs: Vec<serde_json::Value> =
                serde_json::from_str(&tasks_json).unwrap_or_else(|e| fail(&format!("tasks_json: {e}")));
            let mut conn = open_conn();
            let human = local_human_actor_id(&conn).unwrap_or_else(|e| fail(&format!("human: {e:#}")));
            let project = register_project(&mut conn, &human, Path::new(&repo), "Fan-out", "FAN")
                .unwrap_or_else(|e| fail(&format!("register_project: {e:#}")));
            let epic = create_epic(&mut conn, &project.id, &human, "Fan out", None)
                .unwrap_or_else(|e| fail(&format!("create_epic: {e:#}")));
            set_dispatch_max_parallel(&mut conn, &human, cap).unwrap_or_else(|e| fail(&format!("cap: {e:#}")));

            let mut created = Vec::new();
            for spec in &specs {
                let title = spec["title"].as_str().unwrap_or_else(|| fail("task needs a title"));
                let file = spec["file"].as_str().unwrap_or_else(|| fail("task needs a file"));
                let wave = spec["wave"].as_u64().unwrap_or_else(|| fail("task needs a wave")) as u32;
                let task = create_task(&mut conn, &project.id, &human, title, Some(&epic.id))
                    .unwrap_or_else(|e| fail(&format!("create_task: {e:#}")));
                let entry = parse_entry(file).unwrap_or_else(|e| fail(&format!("entry {file:?}: {e:?}")));
                declare_file_set(&mut conn, &task.id, &[entry], &human).unwrap_or_else(|e| fail(&format!("declare: {e:#}")));
                created.push((task.id, title.to_string(), file.to_string(), wave));
            }
            let plan_id = create_plan_for_epic(&mut conn, &epic.id, &human).unwrap_or_else(|e| fail(&format!("plan: {e:#}")));
            let edits: Vec<DraftEdit> = created
                .iter()
                .map(|(id, _, _, wave)| DraftEdit { task_id: id.clone(), wave: Some(*wave), entries: None })
                .collect();
            edit_draft_plan(&mut conn, &plan_id, &edits, &human).unwrap_or_else(|e| fail(&format!("edit plan: {e:#}")));
            approve_and_start(&mut conn, &plan_id, &human).unwrap_or_else(|e| fail(&format!("approve: {e:#}")));
            let tasks: Vec<_> = created
                .iter()
                .map(|(id, title, file, wave)| json!({ "taskId": id, "title": title, "file": file, "wave": wave }))
                .collect();
            println!("{}", json!({ "projectId": project.id, "epicId": epic.id, "planId": plan_id, "tasks": tasks }));
        }
        "tick" => {
            let conn = open_conn();
            // The heartbeat the watchdog polls; the Node harness also touches it on the production cadence.
            let _ = core::runtime_protocol::touch_heartbeat();
            let system = system_actor(&conn).unwrap_or_else(|e| fail(&format!("system actor: {e:#}"))).id;
            let db = Mutex::new(conn);
            let report = run_pass(&db, chrono::Utc::now().timestamp(), &system, |_plan, task_id| launch(&db, task_id))
                .unwrap_or_else(|e| fail(&format!("run_pass: {e:#}")));
            println!(
                "{}",
                json!({
                    "event": "pass",
                    "spawned": report.spawned,
                    "merged": report.merged,
                    "advanced": report.advanced,
                    "failures": report.failures,
                    "actions": report.actions.iter().map(|a| format!("{a:?}")).collect::<Vec<_>>(),
                })
            );
        }
        "session-closed" => {
            let event: serde_json::Value =
                serde_json::from_str(&arg(&args, 1, "session-closed <event_json>")).unwrap_or_else(|e| fail(&format!("event: {e}")));
            let mut conn = open_conn();
            let outcome = apply_session_closed(&mut conn, &event).unwrap_or_else(|e| fail(&format!("apply_session_closed: {e:#}")));
            println!("{}", json!({ "outcome": format!("{outcome:?}") }));
        }
        "state" => {
            let plan_id = arg(&args, 1, "state <plan_id>");
            let conn = open_conn();
            let plan = read_plan(&conn, &plan_id).unwrap_or_else(|e| fail(&format!("read_plan: {e:#}"))).unwrap_or_else(|| fail("no such plan"));
            let mut stmt = conn
                .prepare(
                    "SELECT dpt.task_id, t.title, dpt.state, dpt.wave FROM dispatch_plan_tasks dpt JOIN tasks t ON t.id = dpt.task_id WHERE dpt.plan_id = ?1 ORDER BY dpt.wave, t.title",
                )
                .unwrap_or_else(|e| fail(&format!("prepare: {e}")));
            let tasks: Vec<_> = stmt
                .query_map([&plan_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?))
                })
                .unwrap_or_else(|e| fail(&format!("query: {e}")))
                .filter_map(Result::ok)
                .map(|(id, title, state, wave)| {
                    let wt = worktree_for_task(&conn, &id).ok().flatten();
                    json!({
                        "taskId": id, "title": title, "state": state, "wave": wave,
                        "worktreePath": wt.as_ref().map(|w| w.path.clone()),
                        "branch": wt.as_ref().map(|w| w.branch.clone()),
                    })
                })
                .collect();
            let runs: i64 = conn
                .query_row("SELECT COUNT(*) FROM agent_runs WHERE status IN ('running','blocked')", [], |r| r.get(0))
                .unwrap_or(-1);
            let integration: Option<String> = conn
                .query_row("SELECT integration_branch FROM epics LIMIT 1", [], |r| r.get(0))
                .unwrap_or(None);
            println!(
                "{}",
                json!({
                    "status": plan.status, "waveCursor": plan.wave_cursor, "liveRuns": runs,
                    "integrationBranch": integration, "tasks": tasks,
                })
            );
        }
        "plan-setup" => {
            let usage = "plan-setup <repo_path> <tasks_json>";
            let (repo, tasks_json) = (arg(&args, 1, usage), arg(&args, 2, usage));
            let specs: Vec<serde_json::Value> =
                serde_json::from_str(&tasks_json).unwrap_or_else(|e| fail(&format!("tasks_json: {e}")));
            let mut conn = open_conn();
            let human = local_human_actor_id(&conn).unwrap_or_else(|e| fail(&format!("human: {e:#}")));
            let project = register_project(&mut conn, &human, Path::new(&repo), "Planner", "PLN")
                .unwrap_or_else(|e| fail(&format!("register_project: {e:#}")));
            let epic = create_epic(&mut conn, &project.id, &human, "Plan the fan-out", Some("Measure the planner's file-set declarations"))
                .unwrap_or_else(|e| fail(&format!("create_epic: {e:#}")));
            let mut tasks = Vec::new();
            for spec in &specs {
                let title = spec["title"].as_str().unwrap_or_else(|| fail("task needs a title"));
                let task = create_task(&mut conn, &project.id, &human, title, Some(&epic.id))
                    .unwrap_or_else(|e| fail(&format!("create_task: {e:#}")));
                let key: String = conn
                    .query_row("SELECT key FROM tasks WHERE id = ?1", [&task.id], |r| r.get(0))
                    .unwrap_or_else(|e| fail(&format!("task key: {e}")));
                tasks.push(json!({ "taskId": task.id, "key": key, "title": title }));
            }
            println!("{}", json!({ "projectId": project.id, "epicId": epic.id, "tasks": tasks }));
        }
        "plan-start" => {
            let epic_id = arg(&args, 1, "plan-start <epic_id>");
            let conn = open_conn();
            let human = local_human_actor_id(&conn).unwrap_or_else(|e| fail(&format!("human: {e:#}")));
            let db = Mutex::new(conn);
            // "default": the same mode `commands/dispatch.rs::PLANNING_PERMISSION_MODE` launches with.
            let start = core::dispatch_exec::begin_planning_run(&db, &epic_id, &human, "default")
                .unwrap_or_else(|e| fail(&format!("begin_planning_run: {e:#}")));
            println!(
                "{}",
                json!({
                    "runId": start.run_id,
                    "worktreePath": start.worktree_path,
                    "repoPath": start.repo_path,
                    "prompt": start.prompt,
                })
            );
        }
        "plan-submit" => {
            let usage = "plan-submit <run_id> <submission_json>";
            let (run_id, submission) = (arg(&args, 1, usage), arg(&args, 2, usage));
            let plan: SubmittedPlan =
                serde_json::from_str(&submission).unwrap_or_else(|e| fail(&format!("submission_json: {e}")));
            let mut conn = open_conn();
            // Mirrors `sidecar.rs::process_inbound_submit_plan`: authority first, then the one writer.
            let outcome = resolve_planning_run(&conn, &run_id).map_err(|r| r.to_string()).and_then(|run| {
                store_submitted_plan(&mut conn, &run.run_id, &run.epic_id, &plan, &run.actor_id, &chrono::Utc::now().to_rfc3339())
                    .map_err(|r| r.to_string())
            });
            match outcome {
                Ok(plan_id) => println!("{}", json!({ "planId": plan_id })),
                Err(refused) => println!("{}", json!({ "refused": refused })),
            }
        }
        "plan-readback" => {
            let plan_id = arg(&args, 1, "plan-readback <plan_id>");
            let conn = open_conn();
            let mut stmt = conn
                .prepare(
                    "SELECT dpt.task_id, t.key, dpt.state, dpt.wave FROM dispatch_plan_tasks dpt
                       JOIN tasks t ON t.id = dpt.task_id WHERE dpt.plan_id = ?1 ORDER BY dpt.wave, t.rank, t.id",
                )
                .unwrap_or_else(|e| fail(&format!("prepare: {e}")));
            let rows: Vec<(String, String, String, i64)> = stmt
                .query_map([&plan_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .unwrap_or_else(|e| fail(&format!("query: {e}")))
                .filter_map(Result::ok)
                .collect();
            let key_of: BTreeMap<String, String> = rows.iter().map(|(id, key, _, _)| (id.clone(), key.clone())).collect();
            let mut tasks = Vec::new();
            for (task_id, key, state, wave) in &rows {
                let files: Vec<String> = list_entries_for_task(&conn, task_id)
                    .unwrap_or_else(|e| fail(&format!("entries: {e:#}")))
                    .iter()
                    .map(|e| entry_path(e).to_string())
                    .collect();
                let mut ev = conn
                    .prepare(
                        "SELECT e.payload, a.type FROM events e JOIN actors a ON a.id = e.actor_id
                          WHERE e.task_id = ?1 AND e.event_type = ?2 ORDER BY e.sequence",
                    )
                    .unwrap_or_else(|e| fail(&format!("prepare events: {e}")));
                let events: Vec<serde_json::Value> = ev
                    .query_map(rusqlite::params![task_id, core::domain::file_set::EVENT_FILE_SET_DECLARED], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .unwrap_or_else(|e| fail(&format!("events: {e}")))
                    .filter_map(Result::ok)
                    .map(|(payload, actor_type)| {
                        let p: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
                        json!({ "after": p["after"], "label": p["label"], "actorType": actor_type })
                    })
                    .collect();
                tasks.push(json!({ "key": key, "state": state, "wave": wave, "files": files, "events": events }));
            }
            let edges: Vec<serde_json::Value> = preview_edges_with(&conn, &plan_id, false)
                .unwrap_or_else(|e| fail(&format!("preview_edges: {e:#}")))
                .iter()
                .map(|e| {
                    json!({
                        "before": key_of.get(&e.before_task_id), "after": key_of.get(&e.after_task_id),
                        "cause": e.cause, "collidingPaths": e.colliding_paths,
                    })
                })
                .collect();
            println!("{}", json!({ "tasks": tasks, "edges": edges }));
        }
        other => fail(&format!("unknown subcommand {other:?}; see the header of uat_fanout_ops.rs")),
    }
}
