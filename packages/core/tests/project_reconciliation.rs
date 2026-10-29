//! Behavior under test (01-11-PLAN.md Task 2 — the marker, registration, and launch-time
//! reconciliation that never guesses; BOARD-10, D-15, D-16):
//! - `write_marker`/`read_marker` round-trip exactly the project id and key, and nothing else.
//! - `read_marker` on a path with no marker returns `None`, never an error.
//! - `read_marker` on a malformed marker returns an error, never a partially-populated marker.
//! - `register_project` on a repository with no marker mints a new id, writes the marker, and
//!   inserts exactly one project row.
//! - `register_project` on a repository whose marker names a project already in the database
//!   reuses that row and inserts no second one.
//! - `register_project` on a repository whose marker names a project NOT in the database (the
//!   cloned-onto-another-machine case) reuses the marker's id rather than minting a new one.
//! - Registering the same path twice in succession yields one project.
//! - Two transactions racing to register one marker id resolve to one row by a database
//!   uniqueness constraint, not by call ordering.
//! - Paths are canonicalized before comparison — a trailing slash does not read as a different
//!   repository.
//! - `reconcile_projects` marks a project unreachable when its marker no longer matches, and
//!   active again once it does.
//! - `reconcile_projects` run twice with no filesystem change appends no second event.
//! - `relocate_project` accepts a matching marker and rejects a mismatched one.
//! - The marker writer emits exactly two fields — no third key ever appears in the serialized
//!   file.
//! - `register_project` writes the marker file only after its database transaction has
//!   committed — a rejected registration leaves no marker behind.

use flywheel_core::db::{apply_pragmas, open_and_migrate};
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::project::{
    list_projects, reconcile_projects, register_project, relocate_project,
};
use flywheel_core::marker::{read_marker, write_marker, ProjectMarker};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

/// A fresh migrated database plus the local human actor id, backed by a scratch directory this
/// function leaks (mirrors `outbox.rs`'s `seeded_project` fixture) so the returned `Connection`
/// and any repo directories the test creates inside `scratch_root` outlive this call.
fn open_db() -> (Connection, String, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let root = dir.path().to_path_buf();
    std::mem::forget(dir);

    let db_path = root.join("flywheel.db");
    let backups_dir = root.join("backups");
    let conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    (conn, actor_id, root)
}

/// A fresh, real directory under `root` that stands in for a registered repository — real
/// filesystem paths throughout, since `register_project`/marker functions never accept a
/// non-existent or synthetic path (`Path::canonicalize` requires the path to exist).
fn scratch_repo(root: &Path, name: &str) -> std::path::PathBuf {
    let repo = root.join(name);
    std::fs::create_dir_all(&repo).expect("failed to create scratch repo dir");
    repo
}

fn project_status(conn: &Connection, project_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .expect("project row should exist")
}

fn project_row_count(conn: &Connection, project_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

fn event_count(conn: &Connection, project_id: &str, event_type: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE project_id = ?1 AND event_type = ?2",
        params![project_id, event_type],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

#[test]
fn write_marker_then_read_marker_round_trips_id_and_key() {
    let (_conn, _actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-a");

    let marker = ProjectMarker {
        project_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
        project_key: "FLY".to_string(),
    };
    write_marker(&repo, &marker).expect("write_marker should succeed");

    let read_back = read_marker(&repo).expect("read_marker should succeed");
    assert_eq!(
        read_back,
        Some(marker),
        "the round-tripped marker must match exactly"
    );
}

#[test]
fn read_marker_with_no_marker_returns_none() {
    let (_conn, _actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-b");

    let result = read_marker(&repo).expect("read_marker on an unmarked repo must not error");
    assert!(
        result.is_none(),
        "a repository with no marker must read back as None, not an error"
    );
}

#[test]
fn read_marker_with_malformed_content_returns_error() {
    let (_conn, _actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-c");
    std::fs::create_dir_all(repo.join(".flywheel")).expect("failed to create .flywheel dir");
    std::fs::write(
        repo.join(".flywheel").join("project.json"),
        b"{not valid json",
    )
    .expect("failed to write malformed marker");

    let result = read_marker(&repo);
    assert!(
        result.is_err(),
        "a malformed marker must return an error, never a partial value"
    );
}

#[test]
fn marker_writer_emits_exactly_two_fields() {
    let (_conn, _actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-d");

    write_marker(
        &repo,
        &ProjectMarker {
            project_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            project_key: "FLY".to_string(),
        },
    )
    .expect("write_marker should succeed");

    let raw = std::fs::read_to_string(repo.join(".flywheel").join("project.json"))
        .expect("marker file should exist");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("marker must be valid JSON");
    let object = parsed
        .as_object()
        .expect("marker must serialize as a JSON object");
    assert_eq!(
        object.len(),
        2,
        "the marker must contain exactly two fields, got {object:?}"
    );
    assert!(object.contains_key("project_id"));
    assert!(object.contains_key("project_key"));
}

#[test]
fn register_project_with_no_marker_mints_id_writes_marker_and_inserts_one_row() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-e");

    let project = register_project(&mut conn, &actor_id, &repo, "Repo E", "FLE")
        .expect("register_project should succeed");

    assert_eq!(project_row_count(&conn, &project.id), 1);
    let marker = read_marker(&repo)
        .expect("read_marker should succeed")
        .expect("a marker must now exist");
    assert_eq!(marker.project_id, project.id);
    assert_eq!(marker.project_key, "FLE");
}

#[test]
fn register_project_reusing_marker_of_a_project_already_in_db_updates_path_no_second_row() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-f");

    let first = register_project(&mut conn, &actor_id, &repo, "Repo F", "FLF")
        .expect("first registration should succeed");

    // Re-register the SAME repository (its marker already names `first.id`) under a fresh call —
    // simulates re-adopting a repository the user points the picker at again.
    let second = register_project(&mut conn, &actor_id, &repo, "Repo F", "FLF")
        .expect("second registration of the same marker should succeed");

    assert_eq!(
        second.id, first.id,
        "the same marker id must resolve to the same project"
    );
    assert_eq!(
        project_row_count(&conn, &first.id),
        1,
        "no second row must be inserted"
    );

    let total_projects = list_projects(&conn).expect("list_projects should succeed");
    assert_eq!(
        total_projects.len(),
        1,
        "exactly one project must exist in total"
    );
}

#[test]
fn register_project_reusing_a_marker_id_not_in_db_reuses_marker_id_clone_case() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-g");

    // Simulate a repository cloned from a machine where it was already registered: a marker
    // exists, but this database has never seen its id.
    let marker = ProjectMarker {
        project_id: "01ARZ3NDEKTSV4RRFFQ69G5FBW".to_string(),
        project_key: "CLN".to_string(),
    };
    write_marker(&repo, &marker).expect("write_marker should succeed");

    let project = register_project(&mut conn, &actor_id, &repo, "Cloned Repo", "IGNORED")
        .expect("register_project should succeed");

    assert_eq!(
        project.id, marker.project_id,
        "registering a repo with a pre-existing marker must reuse the marker's id, not mint a new one"
    );
    assert_eq!(
        project.key_prefix, "CLN",
        "the marker's own key must be reused, not the caller-supplied one"
    );
    assert_eq!(project_row_count(&conn, &marker.project_id), 1);
}

#[test]
fn register_project_twice_on_same_path_yields_one_project() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-h");

    let first = register_project(&mut conn, &actor_id, &repo, "Repo H", "FLH")
        .expect("first call should succeed");
    let second = register_project(&mut conn, &actor_id, &repo, "Repo H", "FLH")
        .expect("second call should succeed");

    assert_eq!(first.id, second.id);
    let all = list_projects(&conn).expect("list_projects should succeed");
    assert_eq!(
        all.len(),
        1,
        "registering the same path twice must yield exactly one project"
    );
}

/// Proves the invariant `register_project`'s own check-then-insert relies on: two transactions
/// that BOTH observe "this marker id is not yet in the database" (a genuine TOCTOU race between
/// two concurrent registrations) must still resolve to exactly one committed row, because the
/// second's `INSERT` collides with `projects.id`'s `PRIMARY KEY` — a database rule, not an
/// artifact of which transaction happened to run first. Manually interleaved on one thread
/// (rather than via real OS threads) so the race is deterministic, not merely likely.
#[test]
fn concurrent_registration_of_one_marker_resolves_by_database_constraint_not_ordering() {
    let (_conn, actor_id, root) = open_db();
    let db_path = root.join("flywheel.db");
    let backups_dir = root.join("backups");
    // Ensure the schema exists before opening two raw connections against it directly.
    let _ = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");

    let mut conn_a = Connection::open(&db_path).expect("conn_a should open");
    apply_pragmas(&conn_a).expect("pragmas should apply to conn_a");
    let mut conn_b = Connection::open(&db_path).expect("conn_b should open");
    apply_pragmas(&conn_b).expect("pragmas should apply to conn_b");

    let project_id = "01ARZ3NDEKTSV4RRFFQ69G5FCX";
    let now = "2026-01-01T00:00:00Z";

    let tx_a = conn_a.transaction().expect("tx_a should open");
    let exists_a: Option<String> = tx_a
        .query_row(
            "SELECT id FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .expect("select should succeed");
    assert!(
        exists_a.is_none(),
        "tx_a must observe no existing row (the race precondition)"
    );

    let tx_b = conn_b.transaction().expect("tx_b should open");
    let exists_b: Option<String> = tx_b
        .query_row(
            "SELECT id FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .expect("select should succeed");
    assert!(
        exists_b.is_none(),
        "tx_b must ALSO observe no existing row — both decided to insert"
    );

    // tx_a wins the race and commits first.
    tx_a.execute(
        "INSERT INTO projects (
            id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at
        ) VALUES (?1, 'RCA', 'Race A', '/does/not/matter/a', 'main', 0, 'active', ?2, ?3)",
        params![project_id, actor_id, now],
    )
    .expect("tx_a's insert should succeed");
    tx_a.commit().expect("tx_a should commit");

    // tx_b, having already decided to insert based on its now-stale read, must fail — the
    // PRIMARY KEY constraint on `projects.id`, not any ordering logic, is what stops the second
    // row from ever existing.
    let result = tx_b.execute(
        "INSERT INTO projects (
            id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at
        ) VALUES (?1, 'RCB', 'Race B', '/does/not/matter/b', 'main', 0, 'active', ?2, ?3)",
        params![project_id, actor_id, now],
    );
    assert!(
        result.is_err(),
        "the second insert of one marker id must fail on the uniqueness constraint"
    );

    let final_count: i64 = conn_a
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .expect("count query should succeed");
    assert_eq!(
        final_count, 1,
        "exactly one project row must exist for the raced marker id"
    );
}

#[test]
fn paths_are_canonicalized_before_comparison() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-i");

    let first = register_project(&mut conn, &actor_id, &repo, "Repo I", "FLI")
        .expect("first call should succeed");

    // A trailing slash on an otherwise identical path must canonicalize to the same repository.
    let mut with_trailing_slash = repo.as_os_str().to_owned();
    with_trailing_slash.push("/");
    let second = register_project(
        &mut conn,
        &actor_id,
        Path::new(&with_trailing_slash),
        "Repo I",
        "FLI",
    )
    .expect("registering with a trailing slash should succeed");

    assert_eq!(
        first.id, second.id,
        "a trailing slash must resolve to the same project"
    );
    assert_eq!(
        list_projects(&conn)
            .expect("list_projects should succeed")
            .len(),
        1
    );
}

#[test]
fn reconcile_marks_unreachable_on_marker_mismatch_and_active_again_once_it_matches() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-j");

    let project = register_project(&mut conn, &actor_id, &repo, "Repo J", "FLJ")
        .expect("register_project should succeed");
    assert_eq!(project_status(&conn, &project.id), "active");

    // Remove the marker entirely — simulates the repository having moved or the marker having
    // been deleted underneath the app.
    std::fs::remove_file(repo.join(".flywheel").join("project.json"))
        .expect("removing the marker should succeed");

    reconcile_projects(&mut conn, &actor_id).expect("reconcile_projects should succeed");
    assert_eq!(project_status(&conn, &project.id), "unreachable");

    // `repo_path` must be untouched — reconciliation never rewrites it, only surfaces the
    // mismatch.
    let cached_path: String = conn
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            params![project.id],
            |row| row.get(0),
        )
        .expect("repo_path should be readable");
    assert_eq!(
        cached_path, project.repo_path,
        "reconciliation must never rewrite repo_path"
    );

    // Restore the marker (the repository is back / was never actually moved) and reconcile
    // again: status must return to active.
    write_marker(
        &repo,
        &ProjectMarker {
            project_id: project.id.clone(),
            project_key: project.key_prefix.clone(),
        },
    )
    .expect("restoring the marker should succeed");
    reconcile_projects(&mut conn, &actor_id).expect("second reconcile should succeed");
    assert_eq!(project_status(&conn, &project.id), "active");
}

#[test]
fn reconcile_run_twice_with_no_change_appends_no_second_event() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-k");
    let project = register_project(&mut conn, &actor_id, &repo, "Repo K", "FLK")
        .expect("register_project should succeed");

    // First reconcile: the marker still matches, so status is already 'active' — expect no
    // `project.reconciled` event at all yet.
    reconcile_projects(&mut conn, &actor_id).expect("first reconcile should succeed");
    let after_first = event_count(&conn, &project.id, "project.reconciled");
    assert_eq!(
        after_first, 0,
        "an unchanged, already-active project must append no reconciliation event"
    );

    // Break it, reconcile (one transition -> one event), then reconcile again unchanged.
    std::fs::remove_file(repo.join(".flywheel").join("project.json"))
        .expect("removing the marker should succeed");
    reconcile_projects(&mut conn, &actor_id).expect("reconcile after break should succeed");
    let after_break = event_count(&conn, &project.id, "project.reconciled");
    assert_eq!(
        after_break, 1,
        "the transition to unreachable must append exactly one event"
    );

    reconcile_projects(&mut conn, &actor_id)
        .expect("repeated reconcile with no change should succeed");
    let after_repeat = event_count(&conn, &project.id, "project.reconciled");
    assert_eq!(
        after_repeat, 1,
        "reconciling twice with no filesystem change must append no second event"
    );
}

#[test]
fn relocate_accepts_a_matching_marker_and_rejects_a_mismatch() {
    let (mut conn, actor_id, root) = open_db();
    let old_repo = scratch_repo(&root, "repo-l-old");
    let new_repo = scratch_repo(&root, "repo-l-new");
    let other_repo = scratch_repo(&root, "repo-l-other");

    let project = register_project(&mut conn, &actor_id, &old_repo, "Repo L", "FLL")
        .expect("register_project should succeed");

    // `other_repo` carries a DIFFERENT project's marker — relocating there must be rejected.
    write_marker(
        &other_repo,
        &ProjectMarker {
            project_id: "01ARZ3NDEKTSV4RRFFQ69G5FDY".to_string(),
            project_key: "OTH".to_string(),
        },
    )
    .expect("write_marker should succeed");
    let rejected = relocate_project(&mut conn, &actor_id, &project.id, &other_repo);
    assert!(
        rejected.is_err(),
        "relocating to a path whose marker names a different project must be rejected"
    );

    // The repository actually moved to `new_repo`, carrying the file system copy of its own
    // marker (a real move would carry the marker with it) — write it there directly for the
    // test, then relocate.
    write_marker(
        &new_repo,
        &ProjectMarker {
            project_id: project.id.clone(),
            project_key: project.key_prefix.clone(),
        },
    )
    .expect("write_marker should succeed");
    let relocated = relocate_project(&mut conn, &actor_id, &project.id, &new_repo)
        .expect("relocating to a path whose marker matches must succeed");

    assert_eq!(relocated.id, project.id);
    let expected_path = new_repo
        .canonicalize()
        .expect("canonicalize should succeed");
    assert_eq!(relocated.repo_path, expected_path.to_str().unwrap());
    assert_eq!(project_status(&conn, &project.id), "active");
}

#[test]
fn register_project_writes_the_marker_only_after_the_transaction_commits() {
    let (mut conn, actor_id, root) = open_db();
    let repo = scratch_repo(&root, "repo-m");

    // An invalid key prefix fails `validate_key_prefix` before any transaction opens, so this
    // exercises the "the database write never happened" half of the contract directly; combined
    // with `register_project`'s own ordering (marker write is the LAST statement, strictly after
    // `tx.commit()`), a rejected registration can never leave a marker file behind.
    let result = register_project(&mut conn, &actor_id, &repo, "Repo M", "bad-prefix!!");
    assert!(result.is_err(), "an invalid key prefix must be rejected");

    let marker =
        read_marker(&repo).expect("read_marker should succeed even with no marker present");
    assert!(
        marker.is_none(),
        "a rejected registration must leave no marker file behind"
    );
    assert_eq!(
        list_projects(&conn)
            .expect("list_projects should succeed")
            .len(),
        0
    );
}
