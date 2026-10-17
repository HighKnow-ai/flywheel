//! DRFT-04 / D-13, re-pointed at the MVP model: each record's state column has exactly one writer,
//! and no session writes one as a side effect.
//!
//! Two halves. The source gate fails the build if any module outside the owning domain writer issues
//! a raw `UPDATE stories|epics|milestones SET state`, and its planted-violation twin proves the
//! matcher can fail. The behaviour tests pin that a worktree being created or removed, and a session
//! starting, write no Story state: Story state moves only by the spec's transitions, through
//! `story::set_story_state`.
//!
//! Self-contained: carries its own copies of `workspace_root`/`is_whole_line_comment`/
//! `sources_under`. No env var, `cfg` switch or `#[ignore]` turns the gate off.

mod common;

use common::with_scratch_worktree_root;

use std::path::{Path, PathBuf};

use core::domain::agent_run::start_agent_run;
use core::domain::worktree::{ensure_worktree, remove_worktree_for_story};
use core::query::events::activity_trail;
use rusqlite::Connection;

// --- Shared source-scanning helpers ---

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

/// Each record table with a state column, and the one file allowed to write it.
const STATE_WRITERS: [(&str, &str); 3] = [
    ("stories", "packages/core/src/domain/story.rs"),
    ("epics", "packages/core/src/domain/epic.rs"),
    ("milestones", "packages/core/src/domain/milestone.rs"),
];

/// The matcher both the real gate and the planted-violation test drive. Skips whole-line comments
/// and migrations. The code lines are joined, whitespace collapsed and the text lowercased, so
/// letter case and line breaks are no way around it. Every `update <table> set` is cut at the next
/// ` where ` (or closing `"`) and flagged when `state` is assigned anywhere in that SET list, so
/// column order is no way around it either.
fn scan_body_for_raw_state_writes(path: &Path, body: &str, table: &str, hits: &mut Vec<String>) {
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
        if compact.starts_with("state=") || compact.contains(",state=") {
            hits.push(format!("{}: raw {table}.state write:{}", path.display(), set_list));
        }
    }
}

#[test]
fn each_state_column_has_exactly_one_writer() {
    let root = workspace_root();
    for (table, writer) in STATE_WRITERS {
        let mut hits = Vec::new();
        for rel in SCAN_ROOTS {
            let files = sources_under(&root.join(rel));
            assert!(!files.is_empty(), "{rel} yielded no source files: the gate would be scanning nothing");
            for (path, body) in files {
                scan_body_for_raw_state_writes(&path, &body, table, &mut hits);
            }
        }
        hits.sort();
        let outside: Vec<&String> = hits.iter().filter(|h| !h.contains(writer)).collect();
        assert!(
            outside.is_empty(),
            "a raw `UPDATE {table} SET state` exists outside {writer}, the one writer of {table}.state. \
             Offenders:\n{}",
            outside.iter().map(|h| h.as_str()).collect::<Vec<_>>().join("\n")
        );
        assert_eq!(hits.len(), 1, "the {table} writer itself must still exist, exactly once: {hits:?}");
    }
}

fn state_hits(path: &str, body: &str) -> Vec<String> {
    let mut hits = Vec::new();
    scan_body_for_raw_state_writes(Path::new(path), body, "stories", &mut hits);
    hits
}

#[test]
fn the_state_write_gate_fires_on_a_planted_raw_update() {
    let planted = "fn sneaky(tx: &Transaction) {\n    // UPDATE stories SET state = 'merged' (a comment is not a write)\n    tx.execute(\"UPDATE stories SET state = 'running' WHERE id = ?1\", [id]).unwrap();\n}\n";
    let hits = state_hits("packages/core/src/domain/planted.rs", planted);
    assert_eq!(hits.len(), 1, "exactly the one real statement, not the comment: {hits:?}");
    assert!(hits[0].contains("planted.rs"));

    assert!(state_hits("packages/core/src/db/migrations/0099_x.rs", planted).is_empty(), "migrations are skipped");

    let reordered = "tx.execute(\"UPDATE stories SET updated_at = ?1, state = ?2 WHERE id = ?3\", p);";
    assert_eq!(state_hits("src/x.rs", reordered).len(), 1, "state after another column");

    let split = "tx.execute(\n    \"UPDATE stories\n     SET updated_at = ?1,\n         state = ?2\n     WHERE id = ?3\",\n    p);";
    assert_eq!(state_hits("src/x.rs", split).len(), 1, "statement split across lines");

    assert_eq!(state_hits("src/x.rs", "update stories\n  set state = 'merged'\n  where id = ?1").len(), 1, "lowercase and split");
    assert_eq!(state_hits("src/x.rs", "\"UPDATE stories SET title = ?1 WHERE id = ?2\"").len(), 0, "no state column");
    assert_eq!(state_hits("src/x.rs", "// UPDATE stories SET state = ?2 WHERE id = ?3").len(), 0, "whole-line comment");

    let mut epic_hits = Vec::new();
    scan_body_for_raw_state_writes(Path::new("src/x.rs"), "\"UPDATE epics SET state = ?1 WHERE id = ?2\"", "epics", &mut epic_hits);
    assert_eq!(epic_hits.len(), 1, "the matcher works for every guarded table");
}

// --- The worktree and session edges write no Story state ---

fn state_of(conn: &Connection, story_id: &str) -> String {
    conn.query_row("SELECT state FROM stories WHERE id = ?1", [story_id], |r| r.get(0)).unwrap()
}

fn events_of(conn: &Connection, story_id: &str, event_type: &str) -> Vec<core::query::events::EventRow> {
    activity_trail(conn, "story", story_id, 500, 0)
        .unwrap()
        .into_iter()
        .filter(|e| e.event_type == event_type)
        .collect()
}

#[test]
fn creating_and_removing_a_worktree_writes_no_story_state() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "Worktree edges");
        ensure_worktree(&mut conn, &story.id, &human).expect("ensure_worktree");
        assert_eq!(state_of(&conn, &story.id), "shaping");
        remove_worktree_for_story(&mut conn, &story.id, &human).expect("remove");
        assert_eq!(state_of(&conn, &story.id), "shaping");
        assert!(events_of(&conn, &story.id, "story.state_changed").is_empty());
    });
}

#[test]
fn starting_a_session_appends_its_started_event_and_no_state_event() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "Session edge");

        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &human).expect("start_agent_run");

        assert_eq!(events_of(&conn, &story.id, "agent_run.started").len(), 1);
        assert!(events_of(&conn, &story.id, "story.state_changed").is_empty());
        assert_eq!(state_of(&conn, &story.id), "shaping", "a session starting is not a state signal");
        assert!(!run.id.is_empty());
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
