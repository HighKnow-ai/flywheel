//! DRFT-06 (D-16, D-17, D-24, T-13-25): priority is an opt-in suggestion, never an agent write.
//!
//! The column, its CHECK and its sort position are unchanged. What this file fences is the WRITER:
//! the priority setters may be called from exactly five files, and an agent's only route to a
//! priority is a staged proposal that a human accepts. The gate is two-sided: the source half scans
//! the real tree, the firing half drives the SAME matcher over a planted violation, and the two
//! behaviour tests assert the agent is held to staging while the human is not blocked. A gate that
//! refused the agent but also blocked the human would be the Phase 12 failure mode.
//!
//! Self-contained in the house style of `pm_vocabulary_gate.rs`; this file lives outside every
//! scanned root, so its own literals are never a finding.

mod common;

use std::path::{Path, PathBuf};

use core::domain::actor::local_human_actor_id;
use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    accept_proposal, create_proposal, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::task::create_task;
use rusqlite::{params, Connection};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*')
}

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
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

/// The four functions that write a task's or an epic's priority.
const PRIORITY_WRITERS: [&str; 4] =
    ["set_priority(", "set_priority_in_tx(", "set_epic_priority(", "set_epic_priority_in_tx("];

/// The only files allowed to name a priority writer, each with its reason.
const ALLOWED_WRITER_FILES: [(&str, &str); 5] = [
    ("packages/core/src/domain/task.rs", "declares set_priority and set_priority_in_tx"),
    ("packages/core/src/domain/epic.rs", "declares set_priority and set_epic_priority_in_tx"),
    (
        "packages/core/src/domain/authoring_proposal.rs",
        "the acceptance path: a human accepting a staged suggestion applies it (D-16)",
    ),
    ("packages/desktop/src-tauri/src/commands/task.rs", "the human's own control: task_set_priority"),
    ("packages/desktop/src-tauri/src/commands/epic.rs", "the human's own control: epic_set_priority"),
];

/// The two domain modules that own the raw statement.
const RAW_UPDATE_FILES: [&str; 2] = ["packages/core/src/domain/task.rs", "packages/core/src/domain/epic.rs"];

fn rel(path: &Path, root: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

/// Every offence in one file: a priority writer named outside the allow-list, or a raw
/// `UPDATE tasks|epics SET priority` outside the two domain modules. Whole-line comments are
/// skipped, so prose may still name the functions.
fn priority_writer_offenders(rel_path: &str, body: &str) -> Vec<String> {
    let mut offenders = Vec::new();
    let allowed = ALLOWED_WRITER_FILES.iter().any(|(p, _)| *p == rel_path);
    let code: Vec<(usize, &str)> =
        body.lines().enumerate().filter(|(_, l)| !is_whole_line_comment(l)).collect();

    if !allowed {
        for (n, line) in &code {
            for call in PRIORITY_WRITERS {
                if line.contains(call) {
                    offenders.push(format!("{rel_path}:{}: names {call} outside the allow-list", n + 1));
                }
            }
        }
    }

    if !RAW_UPDATE_FILES.contains(&rel_path) {
        // Collapse whitespace across the whole code body so a statement split over lines still matches.
        let joined = code.iter().map(|(_, l)| *l).collect::<Vec<_>>().join(" ");
        let normal = joined.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
        for stmt in ["update tasks set priority", "update epics set priority"] {
            for _ in normal.matches(stmt) {
                offenders.push(format!("{rel_path}: raw `{stmt}` outside the domain modules"));
            }
        }
    }
    offenders
}

#[test]
fn only_the_human_command_and_the_acceptance_path_write_priority() {
    let root = workspace_root();
    let mut scanned = 0;
    let mut offenders = Vec::new();
    for tree in ["packages/core/src", "packages/desktop/src-tauri/src", "packages/sidecar/src"] {
        for (path, body) in sources_under(&root.join(tree)) {
            scanned += 1;
            offenders.extend(priority_writer_offenders(&rel(&path, &root), &body));
        }
    }
    assert!(scanned > 50, "the walker reached only {scanned} files, so the gate is not looking at the tree");
    for (file, _) in ALLOWED_WRITER_FILES {
        assert!(root.join(file).exists(), "allow-list names a file that no longer exists: {file}");
    }
    assert!(offenders.is_empty(), "priority has a writer outside the allow-list:\n  {}", offenders.join("\n  "));
}

#[test]
fn the_priority_writer_gate_fires_on_a_planted_call() {
    let planted = "fn sneaky(tx: &Transaction) {\n    set_priority_in_tx(tx, a, t, 4).unwrap();\n}\n";
    let found = priority_writer_offenders("packages/core/src/domain/agent_run.rs", planted);
    assert_eq!(found.len(), 1, "{found:?}");

    let planted_sql = "tx.execute(\"UPDATE   tasks\n SET priority = 4\", []);\n";
    let found = priority_writer_offenders("packages/core/src/domain/agent_run.rs", planted_sql);
    assert_eq!(found.len(), 1, "{found:?}");

    // The same text is silent in an allow-listed file, and prose naming the writer is silent anywhere.
    assert!(priority_writer_offenders("packages/core/src/domain/authoring_proposal.rs", planted).is_empty());
    let prose = "// set_priority_in_tx( is the writer\n";
    assert!(priority_writer_offenders("packages/core/src/domain/agent_run.rs", prose).is_empty());
}

fn priority_of(conn: &Connection, task_id: &str) -> i64 {
    conn.query_row("SELECT priority FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0)).unwrap()
}

fn priority_events(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM events WHERE event_type = 'task.priority_changed'", [], |r| r.get(0))
        .unwrap()
}

/// Serialises the scratch runtime dir `advance_stage` writes its stage marker into.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: serialised by RUNTIME_DIR_ENV_LOCK, and cleared before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

/// A board task at the default priority, and an agent run ready to stage proposals against it.
fn board_with_an_agent_run() -> (Connection, String, String, String) {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Existing", None).unwrap();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human).unwrap();
    advance_stage(&mut conn, &run.id, &human).unwrap();
    (conn, human, task.id, run.id)
}

fn suggest_priority(conn: &mut Connection, run_id: &str, task_id: &str, priority: i64) -> String {
    create_proposal(
        conn,
        run_id,
        ProposalVerb::Amend,
        ProposalPayload::Task { title: "Existing".to_string(), description: None, priority: Some(priority) },
        Some(task_id),
        None,
        ProposalProvenance { rationale: Some("It blocks the release.".to_string()), origin_log_offset: None },
    )
    .unwrap()
    .id
}

#[test]
fn an_agent_actor_cannot_write_priority_directly() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human, task_id, run_id) = board_with_an_agent_run();
        let agent = agent_actor_id(&conn).unwrap();
        assert_ne!(agent, human, "the seeded agent and human actors are distinct");
        let before = priority_of(&conn, &task_id);

        // The only route open to the agent is staging a suggestion.
        let proposal_id = suggest_priority(&mut conn, &run_id, &task_id, 4);

        let (status, created_by, decided_by): (String, String, Option<String>) = conn
            .query_row(
                "SELECT status, created_by, decided_by FROM authoring_proposals WHERE id = ?1",
                params![proposal_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "pending", "an agent's suggestion waits for a human");
        assert_eq!(created_by, agent);
        assert_eq!(decided_by, None);
        assert_eq!(priority_of(&conn, &task_id), before, "staging must not touch tasks.priority");
        assert_eq!(priority_events(&conn), 0, "no priority event exists until a human accepts");
    });
}

#[test]
fn a_human_accepting_a_priority_suggestion_is_not_blocked() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human, task_id, run_id) = board_with_an_agent_run();
        let proposal_id = suggest_priority(&mut conn, &run_id, &task_id, 4);

        let human = local_human_actor_id(&conn).unwrap();
        accept_proposal(&mut conn, &proposal_id, &human).expect("a human accepting a suggestion must not be refused");

        assert_eq!(priority_of(&conn, &task_id), 4);
        assert_eq!(priority_events(&conn), 1);
        let acting: String = conn
            .query_row("SELECT actor_id FROM events WHERE event_type = 'task.priority_changed'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(acting, human);
    });
}
