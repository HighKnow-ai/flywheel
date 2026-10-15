//! DRFT-04 (phase 13 plan 07, Task 3; T-13-30): `tasks.status` has one writer.
//!
//! Two halves, as the plan's house style asks. The source gate fails the build if any module
//! outside `domain/task.rs` (`set_task_status_in_tx`) issues a raw `UPDATE tasks SET status`, and
//! its planted-violation twin proves the matcher can fail. The behaviour tests pin the two trigger
//! points (worktree create and remove) and the deletion of the write that used to live in
//! `start_agent_run` (D-13, F5): a run starting is not a status signal.
//!
//! Self-contained per this repo's precedent (`pm_vocabulary_gate.rs`): carries its own copies of
//! `workspace_root`/`is_whole_line_comment`/`sources_under`. No env var, `cfg` switch or `#[ignore]`
//! turns the gate off.

mod common;

use std::path::{Path, PathBuf};

use core::domain::agent_run::{agent_actor_id, start_agent_run};
use core::domain::task::{create_task, set_task_status};
use core::domain::worktree::{ensure_worktree, remove_worktree_for_task};
use core::git_facts::tracked_worktrees;
use core::query::events::activity_trail;
use core::status_derivation::{derive_status, Derivation};
use rusqlite::Connection;

// --- Shared source-scanning helpers (copied from `pm_vocabulary_gate.rs`) ---

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "node_modules" || n == "dist") {
                    continue;
                }
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths
        .into_iter()
        .map(|p| {
            let body = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}

// --- The gate ---

const SCAN_ROOTS: [&str; 3] = ["packages/core/src", "packages/desktop/src-tauri/src", "packages/sidecar/src"];

/// The one file allowed to hold the statement: the shared status writer.
const THE_WRITER: &str = "packages/core/src/domain/task.rs";

/// The epic equivalent (D-13): `epics.status` has one writer too, `set_epic_status_in_tx`, reached
/// through the epic deriver. There is no human-reachable path left (D-14).
const THE_EPIC_WRITER: &str = "packages/core/src/domain/epic.rs";

/// The matcher both the real gate and the planted-violation test drive. Skips whole-line comments
/// and migrations. Same normalising shape as `priority_is_opt_in.rs`: the code lines are joined,
/// whitespace is collapsed and the text lowercased, so letter case and line breaks are no way
/// around it. Every `update tasks set` is then cut at the next ` where ` (or closing `"`) and
/// flagged when `status` is assigned anywhere in that SET list, so column order is no way around
/// it either. Pushes one `{path}: raw tasks.status write: {SET list}` per offending statement.
fn scan_body_for_raw_status_writes(path: &Path, body: &str, table: &str, hits: &mut Vec<String>) {
    if path.to_string_lossy().contains("src/db/migrations/") {
        return;
    }
    let code = body.lines().filter(|l| !is_whole_line_comment(l)).collect::<Vec<_>>().join(" ");
    let normal = code.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let stmt = format!("update {table} set");
    for (i, _) in normal.match_indices(&stmt) {
        let rest = &normal[i + stmt.len()..];
        let set_list = rest.split(" where ").next().unwrap_or(rest).split('"').next().unwrap_or(rest);
        let compact: String = set_list.chars().filter(|c| !c.is_whitespace()).collect();
        if compact.starts_with("status=") || compact.contains(",status=") {
            hits.push(format!("{}: raw {table}.status write:{}", path.display(), set_list));
        }
    }
}

#[test]
fn no_module_outside_set_task_status_in_tx_writes_tasks_status() {
    let root = workspace_root();
    let mut hits = Vec::new();
    for rel in SCAN_ROOTS {
        let files = sources_under(&root.join(rel));
        assert!(!files.is_empty(), "{rel} yielded no source files: the gate would be scanning nothing");
        for (path, body) in files {
            scan_body_for_raw_status_writes(&path, &body, "tasks", &mut hits);
        }
    }
    hits.sort();
    let outside: Vec<&String> = hits.iter().filter(|h| !h.contains(THE_WRITER)).collect();
    assert!(
        outside.is_empty(),
        "a raw `UPDATE tasks SET status` exists outside {THE_WRITER}. `tasks.status` has one writer, \
         `set_task_status_in_tx`, reached through the deriver and `request_changes` \
         (the rule documented on `set_task_status_in_tx`; DRFT-04, D-13). Offenders:\n{}",
        outside.iter().map(|h| h.as_str()).collect::<Vec<_>>().join("\n")
    );
    assert_eq!(hits.len(), 1, "the writer itself must still exist, exactly once: {hits:?}");
}

/// The epic path: exactly one `UPDATE epics SET status`, inside `set_epic_status_in_tx` (D-13).
#[test]
fn no_module_outside_set_epic_status_in_tx_writes_epics_status() {
    let root = workspace_root();
    let mut hits = Vec::new();
    for rel in SCAN_ROOTS {
        for (path, body) in sources_under(&root.join(rel)) {
            scan_body_for_raw_status_writes(&path, &body, "epics", &mut hits);
        }
    }
    hits.sort();
    let outside: Vec<&String> = hits.iter().filter(|h| !h.contains(THE_EPIC_WRITER)).collect();
    assert!(
        outside.is_empty(),
        "a raw `UPDATE epics SET status` exists outside {THE_EPIC_WRITER}. `epics.status` has one \
         writer, `set_epic_status_in_tx`, reached through the epic deriver (D-13). Offenders:\n{}",
        outside.iter().map(|h| h.as_str()).collect::<Vec<_>>().join("\n")
    );
    assert_eq!(hits.len(), 1, "the epic writer itself must still exist, exactly once: {hits:?}");
}

#[test]
fn the_epic_status_write_gate_fires_on_a_planted_raw_update() {
    let planted = "tx.execute(\"UPDATE epics SET updated_at = ?1, status = ?2 WHERE id = ?3\", p);";
    let mut hits = Vec::new();
    scan_body_for_raw_status_writes(Path::new("packages/core/src/domain/planted.rs"), planted, "epics", &mut hits);
    assert_eq!(hits.len(), 1, "{hits:?}");
    let mut other = Vec::new();
    scan_body_for_raw_status_writes(Path::new("src/x.rs"), planted, "tasks", &mut other);
    assert!(other.is_empty(), "an epics statement is not a tasks write: {other:?}");
    let mut touch = Vec::new();
    scan_body_for_raw_status_writes(Path::new("src/x.rs"), "\"UPDATE epics SET integration_branch = ?1 WHERE id = ?2\"", "epics", &mut touch);
    assert!(touch.is_empty(), "no status column: {touch:?}");
}

fn status_hits(path: &str, body: &str) -> Vec<String> {
    let mut hits = Vec::new();
    scan_body_for_raw_status_writes(Path::new(path), body, "tasks", &mut hits);
    hits
}

#[test]
fn the_status_write_gate_fires_on_a_planted_raw_update() {
    let planted = "fn sneaky(tx: &Transaction) {\n    // UPDATE tasks SET status = 'done' (a comment is not a write)\n    tx.execute(\"UPDATE tasks SET status = 'in_progress' WHERE id = ?1\", [id]).unwrap();\n}\n";
    let hits = status_hits("packages/core/src/domain/planted.rs", planted);
    assert_eq!(hits.len(), 1, "exactly the one real statement, not the comment: {hits:?}");
    assert!(hits[0].contains("planted.rs"));

    let migration = status_hits("packages/core/src/db/migrations/0099_x.rs", planted);
    assert!(migration.is_empty(), "migrations are skipped");

    // WR-03: `status` anywhere in the SET list, not only first.
    let reordered = "tx.execute(\"UPDATE tasks SET updated_at = ?1, status = ?2 WHERE id = ?3\", p);";
    assert_eq!(status_hits("src/x.rs", reordered).len(), 1, "status after another column");

    let split = "tx.execute(\n    \"UPDATE tasks\n     SET updated_at = ?1,\n         status = ?2\n     WHERE id = ?3\",\n    p);";
    assert_eq!(status_hits("src/x.rs", split).len(), 1, "statement split across three lines");

    let lower_split = "update tasks\n  set status = 'done'\n  where id = ?1";
    assert_eq!(status_hits("src/x.rs", lower_split).len(), 1, "lowercase and split");

    // The allow-listed `updated_at`-only touch (`acceptance_criterion.rs`) is not a status write.
    let touch = "\"UPDATE tasks SET updated_at = ?1 WHERE id = ?2\"";
    assert_eq!(status_hits("src/x.rs", touch).len(), 0, "no status column");

    // Two statements in one body: only the status one is flagged, and its SET list does not bleed
    // into the neighbour.
    let two = "\"UPDATE tasks SET rank = ?1 WHERE id = ?2\"; \"UPDATE tasks SET title = ?1 WHERE id = ?2\"";
    assert_eq!(status_hits("src/x.rs", two).len(), 0, "neighbouring statements stay silent");

    let comment = "// UPDATE tasks SET updated_at = ?1, status = ?2 WHERE id = ?3";
    assert_eq!(status_hits("src/x.rs", comment).len(), 0, "whole-line comment");
}

// --- The trigger points and the deleted write ---

static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `FLYWHEEL_WORKTREE_ROOT` is process-wide state; serialise every test that creates a worktree.
fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK`; cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

fn status_of(conn: &Connection, task_id: &str) -> String {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |r| r.get(0)).unwrap()
}

fn events_of(conn: &Connection, task_id: &str, event_type: &str) -> Vec<core::query::events::EventRow> {
    activity_trail(conn, "task", task_id, 500, 0)
        .unwrap()
        .into_iter()
        .filter(|e| e.event_type == event_type)
        .collect()
}

#[test]
fn creating_a_worktree_moves_todo_to_in_progress_in_the_same_transaction() {
    with_scratch_worktree_root(|| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &human, "Create edge", None).unwrap();
        assert_eq!(status_of(&conn, &task.id), "todo");

        ensure_worktree(&mut conn, &task.id, &human).expect("ensure_worktree");

        assert_eq!(status_of(&conn, &task.id), "in_progress");
        let moves = events_of(&conn, &task.id, "task.status_changed");
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].payload["before"], "todo");
        assert_eq!(moves[0].payload["after"], "in_progress");
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", [&task.id], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    });
}

#[test]
fn removing_a_worktree_never_un_starts_the_work() {
    with_scratch_worktree_root(|| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &human, "Remove edge", None).unwrap();
        ensure_worktree(&mut conn, &task.id, &human).expect("ensure_worktree");
        assert_eq!(status_of(&conn, &task.id), "in_progress");

        remove_worktree_for_task(&mut conn, &task.id, &human).expect("remove");

        assert_eq!(status_of(&conn, &task.id), "in_progress", "the floor holds it");
        assert_eq!(events_of(&conn, &task.id, "task.status_changed").len(), 1);
    });
}

#[test]
fn starting_a_run_appends_its_started_event_and_no_status_event() {
    with_scratch_worktree_root(|| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &human, "Run edge", None).unwrap();
        ensure_worktree(&mut conn, &task.id, &human).expect("ensure_worktree");
        let before = events_of(&conn, &task.id, "task.status_changed").len();

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &human).expect("start_agent_run");

        assert_eq!(events_of(&conn, &task.id, "agent_run.started").len(), 1);
        assert_eq!(events_of(&conn, &task.id, "task.status_changed").len(), before);
        let agent = agent_actor_id(&conn).unwrap();
        assert!(
            events_of(&conn, &task.id, "task.status_changed").iter().all(|e| e.actor_id != agent),
            "no status event is ever attributed to the agent actor"
        );
        assert!(!run.id.is_empty());
    });
}

#[test]
fn starting_a_run_leaves_a_todo_band_to_the_deriver() {
    with_scratch_worktree_root(|| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &human, "Run is not a signal", None).unwrap();
        ensure_worktree(&mut conn, &task.id, &human).expect("ensure_worktree");
        // The worktree exists but the band is somehow still `todo` (set back through the writer).
        set_task_status(&mut conn, &human, &task.id, "todo").unwrap();

        start_agent_run(&mut conn, &task.id, "acceptEdits", &human).expect("start_agent_run");

        assert_eq!(status_of(&conn, &task.id), "todo", "the run starting is not a status signal");
    });
}

#[test]
fn a_cold_tick_derives_every_tracked_worktree_once() {
    with_scratch_worktree_root(|| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &human, "Tick edge", None).unwrap();
        ensure_worktree(&mut conn, &task.id, &human).expect("ensure_worktree");
        set_task_status(&mut conn, &human, &task.id, "todo").unwrap();

        // What the scheduler's cold tick does: every tracked worktree, one derivation each.
        let mut changed = 0;
        for w in tracked_worktrees(&conn, false).unwrap() {
            if matches!(derive_status(&mut conn, &human, &w.task_id, None).unwrap(), Derivation::Wrote(_)) {
                changed += 1;
            }
        }
        assert_eq!(changed, 1);
        assert_eq!(status_of(&conn, &task.id), "in_progress");

        // The next tick has nothing to say: at most one board-changed notice per real change.
        for w in tracked_worktrees(&conn, false).unwrap() {
            assert_eq!(derive_status(&mut conn, &human, &w.task_id, None).unwrap(), Derivation::Unchanged);
        }
    });
}

// --- D-19: the picker is a deletion, and a deletion can be asserted ---

/// Close the loop from the Rust side (D-19): the human-reachable status control is gone from the
/// desktop tree, and nothing imports it. A refusal in a component would have to be interrogated;
/// an absent file cannot be.
#[test]
fn no_status_picker_component_exists_in_the_desktop_tree() {
    let deleted = "StatusPicker";
    let mut found_files = Vec::new();
    let mut importers = Vec::new();
    for (path, body) in sources_under(&workspace_root().join("packages/desktop/src")) {
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if stem == deleted {
            found_files.push(path.display().to_string());
        }
        for (n, line) in body.lines().enumerate() {
            let t = line.trim_start();
            if t.starts_with("//") || t.starts_with('*') || t.starts_with("/*") {
                continue;
            }
            if line.contains(deleted) {
                importers.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
            }
        }
    }
    assert!(found_files.is_empty(), "the status picker file is back: {found_files:?}");
    assert!(importers.is_empty(), "something outside a comment still names the status picker:\n{}", importers.join("\n"));
}
