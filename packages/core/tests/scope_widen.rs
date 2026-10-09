//! D-152: a declared file-set can be widened live, and a widen can never grow into a sibling.
//!
//! The re-check against every in-flight declared set is the load-bearing half: a widen that is not
//! re-checked lets one agent's set grow underneath a sibling already running against those files,
//! which is exactly the hole the pre-write hook exists to close. The re-check runs in the same
//! transaction as the write.
//!
//! An undeclared manual launch has no declared set, so it cannot be checked against (D-150); the
//! merge-conflict path is the only guard left for it. The "other task" cases below are therefore
//! all declared tasks, in a plan or launched by hand.

mod common;

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRun, AgentRunStatus};
use core::domain::dispatch_plan::{create_draft_plan_in_tx, replace_plan_tasks_in_tx, PlanTaskInput};
use core::domain::epic::create_epic;
use core::domain::file_set::{
    arm_scope_marker, declare_file_set, list_entries_for_task, widen_file_set, WidenOutcome,
    WidenRefusal, EVENT_FILE_SET_WIDENED,
};
use core::domain::task::create_task;
use core::domain::worktree::worktree_for_task;
use core::file_set::{entry_path, parse_entry};
use core::runtime_protocol::read_scope_marker;
use rusqlite::{params, Connection};

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `FLYWHEEL_WORKTREE_ROOT` and `FLYWHEEL_RUNTIME_DIR` are process-global; one lock serialises both.
fn with_scratch_env<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let wt = tempfile::tempdir().expect("scratch worktree root");
    let rt = tempfile::tempdir().expect("scratch runtime dir");
    // SAFETY: the mutex above serialises every caller in this binary; both vars are cleared below.
    unsafe {
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", wt.path());
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", rt.path());
    }
    let result = f(rt.path());
    unsafe {
        std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
        std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
    }
    result
}

struct Fixture {
    conn: Connection,
    actor: String,
    project_id: String,
    _repo: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let (conn, actor, project, repo) = common::seeded_git_project();
    Fixture { conn, actor, project_id: project.id, _repo: repo }
}

struct Running {
    task_id: String,
    run: AgentRun,
    worktree: PathBuf,
}

/// A task with a declared set, a started run and an armed marker — as the app leaves it.
fn running(fx: &mut Fixture, title: &str, epic: Option<&str>, declared: &[&str]) -> Running {
    let task = create_task(&mut fx.conn, &fx.project_id, &fx.actor, title, epic).unwrap();
    if !declared.is_empty() {
        let entries: Vec<_> = declared.iter().map(|r| parse_entry(r).unwrap()).collect();
        declare_file_set(&mut fx.conn, &task.id, &entries, &fx.actor).unwrap();
    }
    let run = start_agent_run(&mut fx.conn, &task.id, "default", &fx.actor).unwrap();
    let wt = worktree_for_task(&fx.conn, &task.id).unwrap().expect("worktree exists");
    let worktree = std::fs::canonicalize(&wt.path).unwrap();
    arm_scope_marker(&fx.conn, &run.id, &task.id, &worktree).expect("arm");
    Running { task_id: task.id, run, worktree }
}

fn paths(conn: &Connection, task_id: &str) -> Vec<String> {
    list_entries_for_task(conn, task_id).unwrap().iter().map(|e| entry_path(e).to_string()).collect()
}

fn count(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> i64 {
    conn.query_row(sql, p, |r| r.get(0)).unwrap()
}

fn widened_events(conn: &Connection, task_id: &str) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare("SELECT payload FROM events WHERE task_id = ?1 AND event_type = ?2 ORDER BY sequence")
        .unwrap();
    stmt.query_map(params![task_id, EVENT_FILE_SET_WIDENED], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|p| serde_json::from_str(&p.unwrap()).unwrap())
        .collect()
}

fn marker_bytes(runtime: &Path, run_id: &str) -> Vec<u8> {
    std::fs::read(runtime.join("scope").join(format!("{run_id}.json"))).expect("marker file")
}

fn collision_of(outcome: WidenOutcome) -> (String, String, String) {
    match outcome {
        WidenOutcome::Refused(WidenRefusal::Collision { colliding_path, other_task_id, other_task_key, .. }) => {
            (colliding_path, other_task_id, other_task_key)
        }
        other => panic!("expected a collision refusal, got {other:?}"),
    }
}

// --- the shipped hook, as in scope_marker_contract --------------------------------------------

fn hook_allows(run_id: &str, runtime: &Path, target: &Path) -> bool {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap();
    let hook = root.join("packages/sidecar/dist/scope-hook.js");
    assert!(hook.is_file(), "expected the built scope hook at {hook:?} — run `npm --prefix packages/sidecar run build`");
    let shim = core::shim::resolve_shim_binary().expect("run `cargo build --workspace` first");
    let payload = serde_json::json!({
        "hook_event_name": "PreToolUse",
        "tool_name": "Write",
        "tool_input": { "file_path": target, "content": "x" },
        "cwd": "/somewhere/else",
        "permission_mode": "bypassPermissions",
    })
    .to_string();
    let mut child = Command::new("node")
        .arg(hook)
        .env_remove("FLYWHEEL_RUN_ID")
        .env("FLYWHEEL_RUN_ID", run_id)
        .env("FLYWHEEL_RUNTIME_DIR", runtime)
        .env("FLYWHEEL_SHIM_BIN", shim)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn node");
    child.stdin.as_mut().unwrap().write_all(payload.as_bytes()).unwrap();
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();
    out.status.code() == Some(0) && String::from_utf8_lossy(&out.stdout).trim() == "{}"
}

// --- acceptance ---------------------------------------------------------------------------------

#[test]
fn an_accepted_widen_adds_a_row_one_event_and_rewrites_the_marker() {
    with_scratch_env(|runtime| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let rows_before = count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![a.task_id]);

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "docs/notes.md", &fx.actor).unwrap();

        assert_eq!(outcome, WidenOutcome::Accepted { entries: vec!["src/a/".into(), "docs/notes.md".into()] });
        assert_eq!(
            count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![a.task_id]),
            rows_before + 1
        );
        let events = widened_events(&fx.conn, &a.task_id);
        assert_eq!(events.len(), 1, "exactly one widen event");
        assert_eq!(events[0]["before"], serde_json::json!(["src/a/"]));
        assert_eq!(events[0]["after"], serde_json::json!(["src/a/", "docs/notes.md"]));
        let marker = read_scope_marker(&a.run.id).expect("marker present");
        assert!(marker.entries.iter().any(|e| e.path == "docs/notes.md"), "the marker carries the new entry");
        let _ = runtime;
    });
}

#[test]
fn the_widened_path_is_allowed_by_the_shipped_hook_on_the_very_next_call() {
    with_scratch_env(|runtime| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let target = a.worktree.join("docs/notes.md");
        assert!(!hook_allows(&a.run.id, runtime, &target), "denied before the widen");

        widen_file_set(&mut fx.conn, &a.task_id, "docs/notes.md", &fx.actor).unwrap();

        assert!(hook_allows(&a.run.id, runtime, &target), "allowed after the widen, no restart in between");
        assert!(!hook_allows(&a.run.id, runtime, &a.worktree.join("docs/other.md")), "only the widened path");
    });
}

#[test]
fn widening_with_a_path_already_covered_stores_nothing_new() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/a/", &fx.actor).unwrap();
        assert_eq!(outcome, WidenOutcome::Accepted { entries: vec!["src/a/".into()] });
        assert!(widened_events(&fx.conn, &a.task_id).is_empty(), "an unchanged set appends no event");
    });
}

// --- refusal ------------------------------------------------------------------------------------

#[test]
fn a_collision_with_a_running_task_in_the_same_plan_is_refused_naming_path_and_task() {
    with_scratch_env(|runtime| {
        let mut fx = fixture();
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
        let a = running(&mut fx, "a", Some(&epic.id), &["src/a/"]);
        let b = running(&mut fx, "b", Some(&epic.id), &["src/b/"]);
        let tx = fx.conn.transaction().unwrap();
        let plan = create_draft_plan_in_tx(&tx, &epic.id, None, &fx.actor, "2026-10-09T00:00:00Z").unwrap();
        let inputs: Vec<_> = [&a, &b]
            .iter()
            .map(|t| PlanTaskInput { task_id: t.task_id.clone(), wave: 1, rationale: None })
            .collect();
        replace_plan_tasks_in_tx(&tx, &plan, &inputs).unwrap();
        tx.commit().unwrap();
        let rows = count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![a.task_id]);
        let before = marker_bytes(runtime, &a.run.id);

        let (path, other, key) = collision_of(widen_file_set(&mut fx.conn, &a.task_id, "src/b/deep.rs", &fx.actor).unwrap());

        assert_eq!(path, "src/b/");
        assert_eq!(other, b.task_id);
        assert!(!key.is_empty());
        assert_eq!(count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![a.task_id]), rows);
        assert_eq!(marker_bytes(runtime, &a.run.id), before, "a refusal leaves the marker byte-identical");
        assert!(widened_events(&fx.conn, &a.task_id).is_empty());
    });
}

#[test]
fn a_collision_with_a_running_task_outside_any_plan_is_refused_the_same_way() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a (planned elsewhere)", None, &["src/a/"]);
        let b = running(&mut fx, "b (manual launch)", None, &["lib/"]);
        let (path, other, _) = collision_of(widen_file_set(&mut fx.conn, &a.task_id, "lib/", &fx.actor).unwrap());
        assert_eq!(path, "lib/");
        assert_eq!(other, b.task_id);
    });
}

#[test]
fn a_collision_with_a_task_whose_run_is_not_running_is_accepted() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let b = running(&mut fx, "b", None, &["src/b/"]);
        close_agent_run(&mut fx.conn, &b.run.id, AgentRunStatus::Completed, None, None, None).unwrap();

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/b/x.rs", &fx.actor).unwrap();
        assert!(matches!(outcome, WidenOutcome::Accepted { .. }), "only in-flight sets constrain a widen: {outcome:?}");
    });
}

#[test]
fn an_invalid_entry_is_refused_with_the_same_cause_the_declare_path_names() {
    with_scratch_env(|runtime| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let before = marker_bytes(runtime, &a.run.id);
        let expected = parse_entry("src/*.rs").unwrap_err().to_string();

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/*.rs", &fx.actor).unwrap();

        match outcome {
            WidenOutcome::Refused(WidenRefusal::InvalidEntry { cause, .. }) => assert_eq!(cause, expected),
            other => panic!("expected an invalid-entry refusal, got {other:?}"),
        }
        assert_eq!(paths(&fx.conn, &a.task_id), vec!["src/a/"]);
        assert_eq!(marker_bytes(runtime, &a.run.id), before);
    });
}

#[test]
fn of_two_sequential_widens_of_one_path_the_first_wins_and_the_second_is_refused() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let b = running(&mut fx, "b", None, &["src/b/"]);

        let first = widen_file_set(&mut fx.conn, &a.task_id, "shared/x.rs", &fx.actor).unwrap();
        assert!(matches!(first, WidenOutcome::Accepted { .. }));

        let (path, other, _) = collision_of(widen_file_set(&mut fx.conn, &b.task_id, "shared/x.rs", &fx.actor).unwrap());
        assert_eq!(path, "shared/x.rs");
        assert_eq!(other, a.task_id);
        assert_eq!(paths(&fx.conn, &b.task_id), vec!["src/b/"], "the loser's set is untouched");
    });
}

#[test]
fn a_refusal_leaves_no_partially_written_row_or_event() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        let _b = running(&mut fx, "b", None, &["src/b/"]);
        let rows = count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries", []);
        let events = count(&fx.conn, "SELECT COUNT(*) FROM events", []);

        widen_file_set(&mut fx.conn, &a.task_id, "src/b/", &fx.actor).unwrap();

        assert_eq!(count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries", []), rows);
        assert_eq!(count(&fx.conn, "SELECT COUNT(*) FROM events", []), events);
    });
}

#[test]
fn a_committed_widen_whose_marker_cannot_be_rewritten_is_reported_not_swallowed() {
    with_scratch_env(|runtime| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        // Make the marker directory unwritable by replacing it with a file.
        let scope = runtime.join("scope");
        std::fs::remove_dir_all(&scope).unwrap();
        std::fs::write(&scope, b"not a directory").unwrap();

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "docs/n.md", &fx.actor).unwrap();

        match outcome {
            WidenOutcome::MarkerNotRewritten { entries, error } => {
                assert_eq!(entries, vec!["src/a/", "docs/n.md"], "names what succeeded");
                assert!(!error.is_empty());
            }
            other => panic!("expected a partial outcome, got {other:?}"),
        }
        assert_eq!(paths(&fx.conn, &a.task_id), vec!["src/a/", "docs/n.md"], "the database half did commit");
    });
}
