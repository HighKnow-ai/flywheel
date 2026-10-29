//! The recovery statuses in the baseline schema (D-45, D-49, D-18): `worktrees.status` accepts
//! `missing` and `sessions.status` accepts `abandoned`, each CHECK constraint rejects anything
//! else, `worktrees.story_id` stays UNIQUE (one worktree per Story, WORK-08), and
//! `sessions.acknowledged_at` is a nullable column with no default.

mod common;

use flywheel_core::domain::session::SessionStatus;
use flywheel_core::ids::new_id;
use rusqlite::{params, Connection};

use common::{new_story, seeded_project};

fn insert_worktree(
    conn: &Connection,
    id: &str,
    story_id: &str,
    project_id: &str,
    status: &str,
    actor_id: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO worktrees (
            id, story_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'main', ?6, ?7, '2026-02-01T00:00:00.000Z')",
        params![
            id,
            story_id,
            project_id,
            format!("/tmp/{id}"),
            format!("branch-{id}"),
            status,
            actor_id
        ],
    )
}

fn insert_session(
    conn: &Connection,
    id: &str,
    story_id: &str,
    project_id: &str,
    actor_id: &str,
    status: &str,
) {
    conn.execute(
        "INSERT INTO sessions (
            id, story_id, worktree_id, project_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at
        ) VALUES (?1, ?2, NULL, ?3, 'claude_code', ?4, ?5, NULL, 'default', NULL, NULL, NULL, ?6,
                  '2026-02-01T00:00:00.000Z', NULL)",
        params![
            id,
            story_id,
            project_id,
            actor_id,
            status,
            format!("/tmp/log-{id}.jsonl")
        ],
    )
    .expect("failed to insert fixture session");
}

#[test]
fn worktrees_check_accepts_missing_and_rejects_a_bogus_status() {
    let (mut conn, actor_id, project) = seeded_project();

    let missing_story = new_story(&mut conn, &project.id, &actor_id, "missing wt story");
    insert_worktree(
        &conn,
        &new_id(),
        &missing_story.id,
        &project.id,
        "missing",
        &actor_id,
    )
    .expect("a worktree row with status='missing' should insert cleanly");
    let missing_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM worktrees WHERE status = 'missing'",
            [],
            |row| row.get(0),
        )
        .expect("count query should succeed");
    assert_eq!(
        missing_count, 1,
        "a worktree row with status='missing' should insert cleanly"
    );

    let bogus_story = new_story(&mut conn, &project.id, &actor_id, "bogus wt story");
    let result = insert_worktree(
        &conn,
        &new_id(),
        &bogus_story.id,
        &project.id,
        "bogus",
        &actor_id,
    );
    assert!(
        result.is_err(),
        "an INSERT with status='bogus' must be rejected by the CHECK constraint"
    );
}

#[test]
fn sessions_check_accepts_abandoned_and_rejects_a_bogus_status() {
    let (mut conn, actor_id, project) = seeded_project();

    let story = new_story(&mut conn, &project.id, &actor_id, "abandoned session story");
    let run_id = new_id();
    insert_session(&conn, &run_id, &story.id, &project.id, &actor_id, "running");
    conn.execute(
        "UPDATE sessions SET status = 'abandoned' WHERE id = ?1",
        params![run_id],
    )
    .expect("UPDATE ... SET status='abandoned' should succeed");
    let status: String = conn
        .query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .expect("row should exist");
    assert_eq!(status, "abandoned");

    let result = conn.execute(
        "UPDATE sessions SET status = 'bogus' WHERE id = ?1",
        params![run_id],
    );
    assert!(
        result.is_err(),
        "an UPDATE to status='bogus' must be rejected by the CHECK constraint"
    );
}

#[test]
fn worktrees_story_id_is_unique() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = new_story(&mut conn, &project.id, &actor_id, "one worktree per story");

    insert_worktree(
        &conn,
        &new_id(),
        &story.id,
        &project.id,
        "active",
        &actor_id,
    )
    .expect("the first worktree for a Story should insert");
    let second = insert_worktree(
        &conn,
        &new_id(),
        &story.id,
        &project.id,
        "active",
        &actor_id,
    );
    assert!(
        second.is_err(),
        "a second worktree for the same Story must be rejected (WORK-08)"
    );
}

#[test]
fn acknowledged_at_exists_is_nullable_and_defaults_to_null() {
    let (mut conn, actor_id, project) = seeded_project();

    let (notnull, dflt_value): (i64, Option<String>) = conn
        .query_row(
            "SELECT \"notnull\", dflt_value FROM pragma_table_info('sessions') WHERE name = 'acknowledged_at'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("acknowledged_at column should exist in sessions");
    assert_eq!(notnull, 0, "acknowledged_at must be nullable");
    assert!(
        dflt_value.is_none(),
        "acknowledged_at must carry no default value"
    );

    let story = new_story(&mut conn, &project.id, &actor_id, "ack story");
    for status in [
        "running",
        "blocked",
        "completed",
        "failed",
        "interrupted",
        "abandoned",
    ] {
        let id = new_id();
        insert_session(&conn, &id, &story.id, &project.id, &actor_id, status);
        let acknowledged_at: Option<String> = conn
            .query_row(
                "SELECT acknowledged_at FROM sessions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .expect("session row should exist");
        assert!(
            acknowledged_at.is_none(),
            "a {status} session must default acknowledged_at to NULL"
        );
    }
}

#[test]
fn session_status_abandoned_as_str_matches_the_check_constraint() {
    assert_eq!(SessionStatus::Abandoned.as_str(), "abandoned");
}
