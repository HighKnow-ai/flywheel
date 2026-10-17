//! Behavior under test (11-19-PLAN.md, D-200 — a reversible project removal, never a delete):
//! - After migrating, `projects.hidden` exists, defaults to not-hidden, and a fresh project is shown.
//! - `hide_project` sets the flag and appends exactly one `project.hidden` event carrying the actor.
//! - Hiding twice appends no second event; restoring twice appends no second event.
//! - A hidden project is absent from `list_projects`, while its milestones, epics, stories,
//!   sessions, worktrees and events are all still there, and the counts are UNCHANGED by the hide (nothing is lost).
//! - `restore_project` round-trips: the project reappears with the same id, prefix, name and path.
//! - Registering a path whose marker names a hidden project restores it rather than duplicating it.
//! - Hiding or restoring an unknown project id is refused, and writes nothing.
//! - The listing reads (`fleet_rows`, `blocked_queue`, the worktree inventory and its measure
//!   targets, and the git-identity sha sweep) skip a hidden project and bring it back on restore.

mod common;

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::project::{create_project, hide_project, list_projects, register_project, restore_project, Project};
use core::git_identity::{resolve_identifier, GitIdentifier, ResolveOutcome};
use core::ids::new_id;
use core::query::fleet::{blocked_queue, fleet_rows, worktree_inventory_inputs, worktree_measure_targets};
use rusqlite::{params, Connection};

struct Fixture {
    conn: Connection,
    actor_id: String,
    dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let conn = open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    Fixture { conn, actor_id, dir }
}

fn project(f: &mut Fixture, name: &str, prefix: &str) -> Project {
    create_project(&mut f.conn, &f.actor_id, name, &format!("/repo/{prefix}"), prefix, "main")
        .expect("create_project should succeed")
}

fn count(conn: &Connection, table: &str, project_id: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE project_id = ?1"),
        params![project_id],
        |row| row.get(0),
    )
    .expect("count should succeed")
}

fn events_of(conn: &Connection, project_id: &str, event_type: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT actor_id FROM events WHERE project_id = ?1 AND event_type = ?2")
        .expect("prepare");
    stmt.query_map(params![project_id, event_type], |row| row.get::<_, String>(0))
        .expect("query")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect")
}

/// Give a project one Milestone, one Epic, one Story, one worktree and one session: every table a
/// "nothing is lost" claim has to cover. Returns the Story id and the session id.
fn seed_board(f: &mut Fixture, p: &Project) -> (String, String) {
    let story = common::new_story(&mut f.conn, &p.id, &f.actor_id, "A story");
    let worktree_id = new_id();
    f.conn
        .execute(
            "INSERT INTO worktrees (id, story_id, project_id, path, branch, base_branch, status, created_by, created_at)
             VALUES (?1, ?2, ?3, '/nonexistent/worktree', 'flywheel/x', 'main', 'active', ?4, '2026-01-01T00:00:00.000Z')",
            params![worktree_id, story.id, p.id, f.actor_id],
        )
        .expect("insert worktree");
    let run_id = new_id();
    f.conn
        .execute(
            "INSERT INTO sessions (id, worktree_id, story_id, project_id, adapter, actor_id, status,
                permission_mode, log_path, started_at)
             VALUES (?1, ?2, ?3, ?4, 'claude_code', ?5, 'running', 'acceptEdits', '/dev/null',
                '2026-10-13T00:00:00.000Z')",
            params![run_id, worktree_id, story.id, p.id, f.actor_id],
        )
        .expect("insert session");
    (story.id, run_id)
}

#[test]
fn migration_adds_hidden_defaulting_to_shown() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let hidden: i64 = f
        .conn
        .query_row("SELECT hidden FROM projects WHERE id = ?1", params![p.id], |row| row.get(0))
        .expect("the hidden column must exist");
    assert_eq!(hidden, 0, "a freshly created project is shown");
    assert_eq!(list_projects(&f.conn).unwrap().len(), 1);
}

#[test]
fn hide_sets_the_flag_and_appends_one_event_with_the_actor() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");

    hide_project(&mut f.conn, &f.actor_id, &p.id).expect("hide_project should succeed");

    let hidden: i64 = f
        .conn
        .query_row("SELECT hidden FROM projects WHERE id = ?1", params![p.id], |row| row.get(0))
        .unwrap();
    assert_eq!(hidden, 1);
    assert_eq!(events_of(&f.conn, &p.id, "project.hidden"), vec![f.actor_id.clone()]);
}

#[test]
fn hiding_twice_appends_no_second_event_and_restoring_twice_neither() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");

    hide_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    hide_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    assert_eq!(events_of(&f.conn, &p.id, "project.hidden").len(), 1);

    restore_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    restore_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    assert_eq!(events_of(&f.conn, &p.id, "project.restored").len(), 1);
}

#[test]
fn a_hidden_project_is_absent_from_the_list_but_every_row_it_owns_survives_a_hide() {
    let mut f = fixture();
    let keep = project(&mut f, "Keep", "KEP");
    let gone = project(&mut f, "Gone", "GON");
    seed_board(&mut f, &gone);

    let tables = ["milestones", "epics", "stories", "worktrees", "sessions"];
    let before: Vec<i64> = tables.iter().map(|t| count(&f.conn, t, &gone.id)).collect();
    let events_before = count(&f.conn, "events", &gone.id);
    assert!(before.iter().all(|n| *n >= 1), "the fixture must populate every table: {before:?}");

    hide_project(&mut f.conn, &f.actor_id, &gone.id).unwrap();

    let listed: Vec<String> = list_projects(&f.conn).unwrap().into_iter().map(|p| p.id).collect();
    assert_eq!(listed, vec![keep.id.clone()], "the hidden project must not be listed");

    let after: Vec<i64> = tables.iter().map(|t| count(&f.conn, t, &gone.id)).collect();
    assert_eq!(before, after, "hiding must not change a single row count");
    // The only addition is the hide's own event: the trail grows, it never shrinks.
    assert_eq!(count(&f.conn, "events", &gone.id), events_before + 1);
    // A by-id lookup still resolves the hidden project: restore and history depend on it.
    let name: String = f
        .conn
        .query_row("SELECT name FROM projects WHERE id = ?1", params![gone.id], |row| row.get(0))
        .expect("a hidden project must still resolve by id");
    assert_eq!(name, "Gone");
}

#[test]
fn restore_round_trips_the_same_project() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");

    hide_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    assert!(list_projects(&f.conn).unwrap().is_empty());

    restore_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    let listed = list_projects(&f.conn).unwrap();
    assert_eq!(listed, vec![p]);
}

#[test]
fn registering_the_path_of_a_hidden_project_restores_it_instead_of_duplicating_it() {
    let mut f = fixture();
    let repo = f.dir.path().join("repo-hidden");
    std::fs::create_dir_all(&repo).unwrap();

    let first = register_project(&mut f.conn, &f.actor_id, &repo, "Hidden Repo", "HID").unwrap();
    hide_project(&mut f.conn, &f.actor_id, &first.id).unwrap();
    assert!(list_projects(&f.conn).unwrap().is_empty());

    let again = register_project(&mut f.conn, &f.actor_id, &repo, "Hidden Repo", "HID").unwrap();

    assert_eq!(again.id, first.id, "the marker must resolve to the hidden project, not a new one");
    let listed = list_projects(&f.conn).unwrap();
    assert_eq!(listed.len(), 1, "exactly one project, and it is shown again");
    assert_eq!(listed[0].id, first.id);
    let rows: i64 = f.conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
    assert_eq!(rows, 1, "no duplicate row was created");
    assert_eq!(events_of(&f.conn, &first.id, "project.restored").len(), 1);
}

#[test]
fn hiding_or_restoring_an_unknown_project_is_refused_and_writes_nothing() {
    let mut f = fixture();
    let events_before: i64 = f.conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();

    assert!(hide_project(&mut f.conn, &f.actor_id, "01ARZ3NDEKTSV4RRFFQ69G5FAV").is_err());
    assert!(restore_project(&mut f.conn, &f.actor_id, "01ARZ3NDEKTSV4RRFFQ69G5FAV").is_err());

    let events_after: i64 = f.conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
    assert_eq!(events_before, events_after);
}

/// Make the seeded run wait on a pending permission request, so `blocked_queue` has a row for it.
fn block_run(f: &Fixture, p: &Project, story_id: &str, run_id: &str) {
    f.conn.execute("UPDATE sessions SET status = 'blocked' WHERE id = ?1", params![run_id]).unwrap();
    f.conn
        .execute(
            "INSERT INTO permission_requests (id, session_id, story_id, project_id, tool_name, status, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, 'Bash', 'pending', ?5, '2026-10-13T00:00:01Z')",
            params![new_id(), run_id, story_id, p.id, f.actor_id],
        )
        .unwrap();
}

#[test]
fn the_fleet_blocked_queue_and_worktree_reads_skip_a_hidden_project_and_restore_brings_it_back() {
    let mut f = fixture();
    let keep = project(&mut f, "Keep", "KEP");
    let gone = project(&mut f, "Gone", "GON");
    let (keep_story, keep_run) = seed_board(&mut f, &keep);
    let (gone_story, gone_run) = seed_board(&mut f, &gone);
    block_run(&f, &keep, &keep_story, &keep_run);
    block_run(&f, &gone, &gone_story, &gone_run);

    let fleet_projects = |f: &Fixture| -> Vec<String> {
        let mut ids: Vec<String> = fleet_rows(&f.conn, 50).unwrap().rows.into_iter().map(|r| r.project_id).collect();
        ids.sort();
        ids
    };
    let queue_projects = |f: &Fixture| -> Vec<String> {
        blocked_queue(&f.conn, 50).unwrap().into_iter().map(|e| e.project_id).collect::<Vec<_>>()
    };
    let inventory_stories = |f: &Fixture| -> Vec<String> {
        worktree_inventory_inputs(&f.conn, 50).unwrap().into_iter().map(|i| i.story_id).collect()
    };
    let measure_stories = |f: &Fixture| -> Vec<String> {
        worktree_measure_targets(&f.conn, None, 50).unwrap().into_iter().map(|t| t.story_id).collect()
    };

    // Baseline: both projects are everywhere.
    assert_eq!(fleet_projects(&f).len(), 2);
    assert_eq!(queue_projects(&f).len(), 2);
    assert_eq!(inventory_stories(&f).len(), 2);
    assert_eq!(measure_stories(&f).len(), 2);

    hide_project(&mut f.conn, &f.actor_id, &gone.id).unwrap();

    assert_eq!(fleet_projects(&f), vec![keep.id.clone()]);
    assert_eq!(queue_projects(&f), vec![keep.id.clone()]);
    assert_eq!(inventory_stories(&f), vec![keep_story.clone()]);
    assert_eq!(measure_stories(&f), vec![keep_story.clone()]);
    // By-id: the hidden project's one worktree still resolves, so reclaim and history keep working.
    assert!(core::query::fleet::worktree_inventory_input_for_story(&f.conn, &gone_story).unwrap().is_some());

    restore_project(&mut f.conn, &f.actor_id, &gone.id).unwrap();

    assert_eq!(fleet_projects(&f).len(), 2);
    assert_eq!(queue_projects(&f).len(), 2);
    assert_eq!(inventory_stories(&f).len(), 2);
    assert_eq!(measure_stories(&f).len(), 2);
}

#[test]
fn the_git_identity_sha_sweep_skips_a_hidden_project_and_restore_brings_it_back() {
    let mut f = fixture();
    // A real repository whose one commit carries a `Flywheel-Story` trailer: the sha sweep shells
    // out to git and resolves only a commit that names a Story of that project.
    let repo = f.dir.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let p = create_project(&mut f.conn, &f.actor_id, "Real", repo.to_str().unwrap(), "REA", "main").unwrap();
    let story = common::new_story(&mut f.conn, &p.id, &f.actor_id, "Stamped story");
    let trailer = format!("{}: {}", core::git_hooks::TRAILER_STORY_KEY, story.key.to_lowercase());
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first", "-m", &trailer],
    ] {
        let out = std::process::Command::new("git").arg("-C").arg(&repo).args(&args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }
    let sha = String::from_utf8(
        std::process::Command::new("git").arg("-C").arg(&repo).args(["rev-parse", "HEAD"]).output().unwrap().stdout,
    )
    .unwrap()
    .trim()
    .to_string();

    let by_sha = |f: &Fixture| resolve_identifier(&f.conn, &GitIdentifier::Sha(sha.clone())).unwrap();

    assert!(matches!(by_sha(&f), ResolveOutcome::Resolved(_)), "the shown project's commit must resolve");

    hide_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    assert_eq!(by_sha(&f), ResolveOutcome::NotFound, "a hidden project is not swept for a sha");

    restore_project(&mut f.conn, &f.actor_id, &p.id).unwrap();
    assert!(matches!(by_sha(&f), ResolveOutcome::Resolved(_)));
}
