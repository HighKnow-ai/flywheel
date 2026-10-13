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
use core::dispatch::{
    launch_conflict, ready_tasks, why, AttentionCause, Observations, ReadinessRefusal, SequencingReason,
};
use core::domain::dispatch_plan::{
    approve_plan_with, create_draft_plan_in_tx, mark_needs_attention, replace_plan_tasks_in_tx, PlanTaskInput,
    EVENT_TASK_SEQUENCED,
};
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

// --- D-157: a widen that reaches a queued sibling leaves the record `why` reads --------------------

/// A declared task with no run: queued behind whatever its wave is waiting on.
fn queued(fx: &mut Fixture, title: &str, epic: &str, declared: &[&str]) -> String {
    let task = create_task(&mut fx.conn, &fx.project_id, &fx.actor, title, Some(epic)).unwrap();
    let entries: Vec<_> = declared.iter().map(|r| parse_entry(r).unwrap()).collect();
    declare_file_set(&mut fx.conn, &task.id, &entries, &fx.actor).unwrap();
    task.id
}

/// An APPROVED plan over `tasks` (task id, wave). The sets are disjoint, so approval writes no edge.
fn approved_plan(fx: &mut Fixture, epic: &str, tasks: &[(&str, u32)]) -> String {
    let tx = fx.conn.transaction().unwrap();
    let plan = create_draft_plan_in_tx(&tx, epic, None, &fx.actor, "2026-10-09T00:00:00Z").unwrap();
    let inputs: Vec<_> = tasks
        .iter()
        .map(|(id, wave)| PlanTaskInput { task_id: id.to_string(), wave: *wave, rationale: None })
        .collect();
    replace_plan_tasks_in_tx(&tx, &plan, &inputs).unwrap();
    tx.commit().unwrap();
    approve_plan_with(&mut fx.conn, &plan, &fx.actor, false, "2026-10-09T00:00:01Z").unwrap();
    plan
}

fn edge_rows(conn: &Connection) -> Vec<(String, String, String, String)> {
    let mut stmt = conn
        .prepare("SELECT before_task_id, after_task_id, cause, colliding_paths FROM dispatch_edges ORDER BY created_at, id")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn sequenced_events(conn: &Connection, task_id: &str) -> i64 {
    count(conn, "SELECT COUNT(*) FROM events WHERE task_id = ?1 AND event_type = ?2", params![task_id, EVENT_TASK_SEQUENCED])
}

/// A running A and a queued B in one wave of one approved plan, declared disjoint.
fn a_running_and_a_queued(fx: &mut Fixture) -> (Running, String, String) {
    let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
    let a = running(fx, "a", Some(&epic.id), &["src/a/"]);
    let b = queued(fx, "b", &epic.id, &["src/b/"]);
    let plan = approved_plan(fx, &epic.id, &[(&a.task_id, 1), (&b, 1)]);
    (a, b, plan)
}

/// D-REV-44. The launch body and the dispatcher must return ONE verdict for one pair, whatever the
/// filesystem. Both ask `launch_conflict`; the launch passes the repository's observed case flag and
/// the dispatcher's `readiness` reads the same flag from `Observations::case_insensitive`. The flag is
/// driven explicitly with BOTH values, never read off the host: a test that quietly relied on a
/// case-insensitive macOS runner would prove nothing about the case-sensitive repository this item is
/// about. `Src/a.rs` and `src/a.rs` are one file when folded and two when not.
#[test]
fn the_launch_and_the_dispatcher_agree_on_a_case_only_pair_for_either_case_flag() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
        let live = running(&mut fx, "live", None, &["Src/a.rs"]);
        let queued_task = queued(&mut fx, "queued", &epic.id, &["src/a.rs"]);
        let plan = approved_plan(&mut fx, &epic.id, &[(&queued_task, 1)]);

        for fold in [false, true] {
            let launch = launch_conflict(&fx.conn, &queued_task, &fx.project_id, fold, &[]).unwrap();
            let mut obs = Observations::default();
            obs.case_insensitive.insert(fx.project_id.clone(), fold);
            let dispatcher_would_start = ready_tasks(&fx.conn, &plan, &obs).unwrap().contains(&queued_task);

            assert_eq!(
                launch.is_none(),
                dispatcher_would_start,
                "fold={fold}: the launch said {launch:?} but the dispatcher's readiness disagreed"
            );
            if fold {
                assert_eq!(
                    launch,
                    Some(ReadinessRefusal::OverlapsInFlight {
                        task_id: live.task_id.clone(),
                        path: "src/a.rs".into()
                    })
                );
            } else {
                assert_eq!(launch, None, "two files on a case-sensitive repository: nothing to refuse");
            }
        }
    });
}

#[test]
fn a_widen_reaching_a_queued_same_wave_task_is_accepted_and_records_edge_event_and_why() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let (a, b, plan) = a_running_and_a_queued(&mut fx);
        assert!(edge_rows(&fx.conn).is_empty(), "disjoint at approval: no edge yet");

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/b/deep.rs", &fx.actor).unwrap();
        assert!(matches!(outcome, WidenOutcome::Accepted { .. }), "a queued task is not in flight: {outcome:?}");

        let edges = edge_rows(&fx.conn);
        assert_eq!(edges.len(), 1, "exactly one edge for the pair");
        let (before, after, cause, stored) = &edges[0];
        assert_eq!((before.as_str(), after.as_str(), cause.as_str()), (a.task_id.as_str(), b.as_str(), "widen"));
        let stored: serde_json::Value = serde_json::from_str(stored).unwrap();
        assert_eq!(stored, serde_json::json!([{ "before": "src/b/deep.rs", "after": "src/b/" }]));
        assert_eq!(sequenced_events(&fx.conn, &b), 1, "exactly one sequenced event, on the waiting task");
        match why(&fx.conn, &plan, &a.task_id, &b).unwrap() {
            SequencingReason::Sequenced { before_task_id, after_task_id, cause, .. } => {
                assert_eq!((before_task_id, after_task_id, cause), (a.task_id.clone(), b.clone(), "widen".to_string()));
            }
            other => panic!("expected the sequenced answer, got {other:?}"),
        }
    });
}

/// D-REV-45: a widen into a task parked in a state `is_startable` would start must leave its edge.
fn set_state(fx: &mut Fixture, plan: &str, task: &str, state: &str) {
    fx.conn
        .execute(
            "UPDATE dispatch_plan_tasks SET state = ?3 WHERE plan_id = ?1 AND task_id = ?2",
            params![plan, task, state],
        )
        .unwrap();
}

#[test]
fn a_widen_reaching_a_task_parked_at_pre_spawn_attention_records_a_widen_edge() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let (a, b, plan) = a_running_and_a_queued(&mut fx);
        let cause = AttentionCause::LaunchFailed { error: "sidecar hiccup".into() };
        mark_needs_attention(&mut fx.conn, &plan, &b, &cause, &fx.actor).unwrap();

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/b/deep.rs", &fx.actor).unwrap();

        assert!(matches!(outcome, WidenOutcome::Accepted { .. }), "{outcome:?}");
        let edges = edge_rows(&fx.conn);
        assert_eq!(edges.len(), 1, "the parked task waits for the widener's merge: {edges:?}");
        assert_eq!((edges[0].0.as_str(), edges[0].1.as_str(), edges[0].2.as_str()), (a.task_id.as_str(), b.as_str(), "widen"));
        assert_eq!(sequenced_events(&fx.conn, &b), 1);
    });
}

#[test]
fn a_widen_reaching_a_task_that_needs_attention_after_its_run_records_no_edge() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let (a, b, plan) = a_running_and_a_queued(&mut fx);
        let cause = AttentionCause::Uncommitted { count: 1, first: "x".into() };
        mark_needs_attention(&mut fx.conn, &plan, &b, &cause, &fx.actor).unwrap();

        widen_file_set(&mut fx.conn, &a.task_id, "src/b/deep.rs", &fx.actor).unwrap();

        assert!(edge_rows(&fx.conn).is_empty(), "a post-run attention task is waiting on a merge, not a start");
    });
}

#[test]
fn a_widen_still_records_its_edge_for_every_previously_covered_queued_state() {
    for state in ["planned", "waiting", "held_by_limit"] {
        with_scratch_env(|_| {
            let mut fx = fixture();
            let (a, b, plan) = a_running_and_a_queued(&mut fx);
            set_state(&mut fx, &plan, &b, state);

            widen_file_set(&mut fx.conn, &a.task_id, "src/b/deep.rs", &fx.actor).unwrap();

            assert_eq!(edge_rows(&fx.conn).len(), 1, "state {state}: nothing narrowed");
            assert_eq!(sequenced_events(&fx.conn, &b), 1, "state {state}");
        });
    }
}

#[test]
fn a_second_widen_reaching_the_same_queued_task_writes_no_second_edge_and_is_accepted() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let (a, b, _plan) = a_running_and_a_queued(&mut fx);
        widen_file_set(&mut fx.conn, &a.task_id, "src/b/one.rs", &fx.actor).unwrap();
        let first = edge_rows(&fx.conn);

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/b/two.rs", &fx.actor).unwrap();

        assert!(matches!(outcome, WidenOutcome::Accepted { .. }), "bookkeeping must not fail a scope grant: {outcome:?}");
        assert_eq!(edge_rows(&fx.conn), first, "the first answer is the frozen one, byte for byte");
        assert_eq!(sequenced_events(&fx.conn, &b), 1);
        assert_eq!(paths(&fx.conn, &a.task_id), vec!["src/a/", "src/b/one.rs", "src/b/two.rs"]);
    });
}

#[test]
fn a_widen_refused_for_a_running_sibling_writes_no_edge_and_no_event() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
        let a = running(&mut fx, "a", Some(&epic.id), &["src/a/"]);
        let b = running(&mut fx, "b", Some(&epic.id), &["src/b/"]);
        approved_plan(&mut fx, &epic.id, &[(&a.task_id, 1), (&b.task_id, 1)]);

        collision_of(widen_file_set(&mut fx.conn, &a.task_id, "src/b/x.rs", &fx.actor).unwrap());

        assert!(edge_rows(&fx.conn).is_empty());
        assert_eq!(sequenced_events(&fx.conn, &b.task_id), 0);
        assert_eq!(paths(&fx.conn, &a.task_id), vec!["src/a/"]);
    });
}

#[test]
fn a_widen_reaching_a_queued_task_in_another_wave_writes_no_edge() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
        let a = running(&mut fx, "a", Some(&epic.id), &["src/a/"]);
        let b = queued(&mut fx, "b", &epic.id, &["src/b/"]);
        approved_plan(&mut fx, &epic.id, &[(&a.task_id, 1), (&b, 2)]);

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/b/x.rs", &fx.actor).unwrap();

        assert!(matches!(outcome, WidenOutcome::Accepted { .. }));
        assert!(edge_rows(&fx.conn).is_empty(), "different waves never run together");
        assert_eq!(sequenced_events(&fx.conn, &b), 0);
    });
}

#[test]
fn a_widen_on_a_task_in_no_live_plan_writes_no_edge() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
        let a = running(&mut fx, "a", Some(&epic.id), &["src/a/"]);
        let b = queued(&mut fx, "b", &epic.id, &["src/b/"]);

        let outcome = widen_file_set(&mut fx.conn, &a.task_id, "src/b/x.rs", &fx.actor).unwrap();

        assert!(matches!(outcome, WidenOutcome::Accepted { .. }));
        assert!(edge_rows(&fx.conn).is_empty(), "no plan, no sequencing to explain");
        assert_eq!(sequenced_events(&fx.conn, &b), 0);
    });
}

#[test]
fn a_widen_that_reaches_nobody_writes_no_edge() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let (a, b, _plan) = a_running_and_a_queued(&mut fx);

        widen_file_set(&mut fx.conn, &a.task_id, "docs/notes.md", &fx.actor).unwrap();

        assert!(edge_rows(&fx.conn).is_empty());
        assert_eq!(sequenced_events(&fx.conn, &b), 0);
    });
}

#[test]
fn the_widen_and_its_record_land_together_or_not_at_all() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let (a, b, _plan) = a_running_and_a_queued(&mut fx);
        // Make the sequenced event impossible to append: the whole widen must then roll back.
        fx.conn
            .execute_batch(
                "CREATE TEMP TRIGGER no_sequenced BEFORE INSERT ON events
                 WHEN NEW.event_type = 'task.sequenced'
                 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
            )
            .unwrap();

        let result = widen_file_set(&mut fx.conn, &a.task_id, "src/b/x.rs", &fx.actor);

        assert!(result.is_err(), "a widen that cannot record why it sequenced something does not widen");
        assert_eq!(paths(&fx.conn, &a.task_id), vec!["src/a/"], "no entry row");
        assert!(widened_events(&fx.conn, &a.task_id).is_empty(), "no widen event");
        assert!(edge_rows(&fx.conn).is_empty(), "no edge");
        assert_eq!(sequenced_events(&fx.conn, &b), 0);
    });
}

// --- the declare path re-checks nothing, so it refuses a task with a live run (D-152) -------------

fn declared_events(conn: &Connection, task_id: &str) -> i64 {
    count(
        conn,
        "SELECT COUNT(*) FROM events WHERE task_id = ?1 AND event_type = 'task.file_set_declared'",
        params![task_id],
    )
}

fn declare(fx: &mut Fixture, task_id: &str, raw: &[&str]) -> anyhow::Result<()> {
    let entries: Vec<_> = raw.iter().map(|r| parse_entry(r).unwrap()).collect();
    declare_file_set(&mut fx.conn, task_id, &entries, &fx.actor)
}

/// The refusal names the task, points at the widen, and writes nothing.
fn assert_declare_refused(fx: &mut Fixture, task_id: &str, raw: &[&str]) {
    let rows = count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![task_id]);
    let events = declared_events(&fx.conn, task_id);
    let stored = paths(&fx.conn, task_id);
    let key: String = fx.conn.query_row("SELECT key FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0)).unwrap();

    let err = declare(fx, task_id, raw).expect_err("a declare against a live task is refused");

    let message = format!("{err:#}");
    assert!(message.contains(&key), "names the task: {message}");
    assert!(message.to_lowercase().contains("widen"), "points at the widen: {message}");
    assert_eq!(count(&fx.conn, "SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![task_id]), rows);
    assert_eq!(declared_events(&fx.conn, task_id), events);
    assert_eq!(paths(&fx.conn, task_id), stored);
}

#[test]
fn replacing_the_set_of_a_task_with_a_running_run_is_refused_naming_the_task_and_the_widen() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        assert_declare_refused(&mut fx, &a.task_id, &["src/a/", "src/elsewhere/"]);
    });
}

#[test]
fn replacing_the_set_of_a_task_with_a_blocked_run_is_refused() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        fx.conn.execute("UPDATE agent_runs SET status = 'blocked' WHERE id = ?1", params![a.run.id]).unwrap();
        assert_declare_refused(&mut fx, &a.task_id, &["src/other/"]);
    });
}

#[test]
fn clearing_the_set_of_a_task_with_a_live_run_is_refused() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        assert_declare_refused(&mut fx, &a.task_id, &[]);
    });
}

#[test]
fn submitting_the_same_set_for_a_task_with_a_live_run_is_refused_too() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let a = running(&mut fx, "a", None, &["src/a/"]);
        assert_declare_refused(&mut fx, &a.task_id, &["src/a/"]);
    });
}

#[test]
fn replacing_the_set_of_a_task_whose_runs_have_all_ended_is_allowed() {
    for ended in ["completed", "failed", "interrupted", "abandoned"] {
        with_scratch_env(|_| {
            let mut fx = fixture();
            let a = running(&mut fx, "a", None, &["src/a/"]);
            fx.conn.execute("UPDATE agent_runs SET status = ?1 WHERE id = ?2", params![ended, a.run.id]).unwrap();

            declare(&mut fx, &a.task_id, &["src/new/"]).unwrap_or_else(|e| panic!("{ended}: {e:#}"));

            assert_eq!(paths(&fx.conn, &a.task_id), vec!["src/new/"], "{ended}");
        });
    }
}

#[test]
fn replacing_the_set_of_a_task_with_no_runs_is_allowed() {
    with_scratch_env(|_| {
        let mut fx = fixture();
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor, "E", None).unwrap();
        let b = queued(&mut fx, "b", &epic.id, &["src/b/"]);
        declare(&mut fx, &b, &["src/c/"]).unwrap();
        assert_eq!(paths(&fx.conn, &b), vec!["src/c/"]);
    });
}

/// T-09-06-02: the widen is human-only. No sidecar source (the MCP permission server, the adapters,
/// the hooks) may name it, so no agent-reachable tool can call it.
#[test]
fn no_sidecar_source_exposes_a_widen_tool() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("sidecar/src");
    let mut seen = 0;
    for entry in std::fs::read_dir(&src).expect("packages/sidecar/src") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("ts") {
            continue;
        }
        seen += 1;
        let text = std::fs::read_to_string(&path).unwrap().to_lowercase();
        assert!(!text.contains("file_set_widen") && !text.contains("filesetwiden"), "{path:?} names the widen");
    }
    assert!(seen > 0, "the gate must read at least one source file");
}
