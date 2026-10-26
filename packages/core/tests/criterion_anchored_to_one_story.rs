//! Core value: every Acceptance criterion belongs to exactly one Story, and is never orphaned
//! (docs/mvp-spec.md §2). Pinned in both directions, like `authority_human_only.rs`:
//!
//! - behaviour: a criterion cannot be created without an existing Story, the schema refuses a NULL
//!   or dangling `story_id`, and no writer moves a criterion to another Story;
//! - source: no statement anywhere in the shipped trees updates `acceptance_criteria.story_id`, so
//!   a later writer cannot re-anchor a criterion without failing this build.
//!
//! This is a new source-scanning gate, allowed by the gate policy (docs/mvp-spec.md §9) because it
//! protects a core value: criteria anchored to Stories.

mod common;

use std::path::{Path, PathBuf};

use flywheel_core::domain::acceptance_criterion::{amend_criterion, create_criterion, criteria_for_story, get_criterion};
use rusqlite::params;

#[test]
fn a_criterion_is_created_under_its_story_and_lists_only_there() {
    let (mut conn, human, project) = common::seeded_project();
    let a = common::new_story(&mut conn, &project.id, &human, "Story A");
    let b = common::new_story(&mut conn, &project.id, &human, "Story B");
    let c = create_criterion(&mut conn, &human, &a.id, "Saving shows a toast.").unwrap();
    assert_eq!(c.story_id, a.id);
    assert_eq!(criteria_for_story(&conn, &a.id).unwrap().len(), 1);
    assert!(criteria_for_story(&conn, &b.id).unwrap().is_empty(), "a criterion belongs to one Story only");
}

#[test]
fn a_criterion_needs_an_existing_story() {
    let (mut conn, human, _project) = common::seeded_project();
    let err = create_criterion(&mut conn, &human, "01ZZZZZZZZZZZZZZZZZZZZZZZZ", "Orphaned.").unwrap_err();
    assert!(format!("{err:#}").contains("not found"), "{err:#}");
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0, "nothing was written for the refused criterion");
}

#[test]
fn the_schema_refuses_a_null_or_dangling_story() {
    let (mut conn, human, project) = common::seeded_project();
    let a = common::new_story(&mut conn, &project.id, &human, "Story A");
    let insert = |story: Option<&str>| {
        conn.execute(
            "INSERT INTO acceptance_criteria (id, story_id, statement, rank, created_by, created_at, updated_at)
             VALUES (?1, ?2, 'raw', 'a0', ?3, 'now', 'now')",
            params![flywheel_core::ids::new_id(), story, human],
        )
    };
    assert!(insert(None).is_err(), "story_id is NOT NULL");
    assert!(insert(Some("01ZZZZZZZZZZZZZZZZZZZZZZZZ")).is_err(), "story_id references stories");
    assert!(insert(Some(&a.id)).is_ok(), "the control row with a real Story is accepted");
}

#[test]
fn amending_a_criterion_keeps_its_story_and_a_story_with_criteria_cannot_vanish_under_them() {
    let (mut conn, human, project) = common::seeded_project();
    let a = common::new_story(&mut conn, &project.id, &human, "Story A");
    let c = create_criterion(&mut conn, &human, &a.id, "First wording.").unwrap();
    amend_criterion(&mut conn, &human, &c.id, "Second wording.").unwrap();
    let after = get_criterion(&conn, &c.id).unwrap().unwrap();
    assert_eq!((after.story_id.as_str(), after.statement.as_str()), (a.id.as_str(), "Second wording."));
    assert!(
        conn.execute("DELETE FROM stories WHERE id = ?1", params![a.id]).is_err(),
        "the foreign key keeps a Story with criteria from leaving them orphaned"
    );
}

// --- source half -------------------------------------------------------------------------------

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().and_then(Path::parent).expect("workspace root").to_path_buf()
}

fn sources_under(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if !path.file_name().is_some_and(|n| n == "node_modules" || n == "dist") {
                sources_under(&path, out);
            }
        } else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx") {
            let body = std::fs::read_to_string(&path).unwrap_or_default();
            out.push((path, body));
        }
    }
}

/// Lines that update `acceptance_criteria` and name `story_id` within the same statement. Code lines
/// of a file are joined (whole-line comments dropped) so a statement split across lines is seen whole.
fn reanchor_offenders(path: &str, body: &str) -> Vec<String> {
    let code: String =
        body.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join(" ");
    let lower = code.to_lowercase();
    let mut offenders = Vec::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find("update acceptance_criteria") {
        let start = from + at;
        let statement_end = lower[start..].find(['"', ';']).map(|e| start + e).unwrap_or(lower.len());
        if lower[start..statement_end].contains("story_id") {
            offenders.push(format!("{path}: {}", &code[start..statement_end.min(start + 160)]));
        }
        from = start + 1;
    }
    offenders
}

#[test]
fn no_shipped_statement_re_anchors_a_criterion() {
    let root = workspace_root();
    let mut files = Vec::new();
    for dir in ["packages/core/src", "packages/desktop/src-tauri/src", "packages/sidecar/src"] {
        sources_under(&root.join(dir), &mut files);
    }
    assert!(files.len() > 30, "walked only {} files; the walker is broken", files.len());
    let offenders: Vec<String> =
        files.iter().flat_map(|(p, b)| reanchor_offenders(&p.to_string_lossy(), b)).collect();
    assert!(
        offenders.is_empty(),
        "a criterion belongs to exactly one Story for its whole life; these statements move one:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn the_re_anchor_gate_fires_on_a_planted_statement() {
    let planted = "tx.execute(\n  \"UPDATE acceptance_criteria\n   SET story_id = ?1 WHERE id = ?2\", p)?;\n";
    assert_eq!(reanchor_offenders("planted.rs", planted).len(), 1);
    assert!(reanchor_offenders("planted.rs", "// UPDATE acceptance_criteria SET story_id = ?1\n").is_empty());
    assert!(reanchor_offenders("planted.rs", "\"UPDATE acceptance_criteria SET statement = ?1\"").is_empty());
}
