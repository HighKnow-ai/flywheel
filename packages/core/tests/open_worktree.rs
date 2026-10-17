//! LINK-11 coverage for `domain::worktree`'s D-130 additions (07-04-PLAN.md Task 1): every
//! bullet in the plan's `<behavior>` block — default/stored template resolution for both
//! surfaces, the empty-template rejection, argv construction with the token substituted inside a
//! single element, the no-token append case, whitespace-run collapsing, and the no-worktree-row
//! error. The space-and-semicolon case is asserted element-by-element on the returned vector,
//! proving the worktree path is never split and never becomes a second command (T-07-04-01).

mod common;

use core::domain::worktree::{
    open_command_template, resolve_open_argv, set_open_command_template, OpenSurface,
    DEFAULT_EDITOR_TEMPLATE, DEFAULT_TERMINAL_TEMPLATE, WORKTREE_PATH_TOKEN,
};
use core::ids::new_id;
use rusqlite::{params, Connection};

use common::seeded_project;

/// Insert a bare `worktrees` row for `story_id` at `path` — no real git worktree is needed since
/// `resolve_open_argv` only reads the row's `path` column, never touches the filesystem.
fn insert_worktree_row(
    conn: &Connection,
    story_id: &str,
    project_id: &str,
    actor_id: &str,
    path: &str,
) {
    conn.execute(
        "INSERT INTO worktrees (
            id, story_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, 'flywheel/fixture', 'main', 'active', ?5, ?6)",
        params![new_id(), story_id, project_id, path, actor_id, "2026-01-01T00:00:00.000Z"],
    )
    .expect("failed to insert worktree row");
}

#[test]
fn open_command_template_defaults_to_the_editor_constant_with_no_stored_row() {
    let (conn, _actor_id, _project) = seeded_project();
    let template =
        open_command_template(&conn, OpenSurface::Editor).expect("read should succeed");
    assert_eq!(template, DEFAULT_EDITOR_TEMPLATE);
}

#[test]
fn open_command_template_defaults_to_the_terminal_constant_with_no_stored_row() {
    let (conn, _actor_id, _project) = seeded_project();
    let template =
        open_command_template(&conn, OpenSurface::Terminal).expect("read should succeed");
    assert_eq!(template, DEFAULT_TERMINAL_TEMPLATE);
}

#[test]
fn open_command_template_returns_the_stored_value_once_set() {
    let (mut conn, actor_id, _project) = seeded_project();
    set_open_command_template(&mut conn, &actor_id, OpenSurface::Editor, "subl {worktree_path}")
        .expect("set should succeed");

    let template =
        open_command_template(&conn, OpenSurface::Editor).expect("read should succeed");
    assert_eq!(template, "subl {worktree_path}");

    // The other surface's default is unaffected by a write to this one — the two keys are
    // independent settings rows.
    let terminal_template =
        open_command_template(&conn, OpenSurface::Terminal).expect("read should succeed");
    assert_eq!(terminal_template, DEFAULT_TERMINAL_TEMPLATE);
}

#[test]
fn set_open_command_template_rejects_an_empty_or_whitespace_only_template_naming_the_surface() {
    let (mut conn, actor_id, _project) = seeded_project();

    let empty_err =
        set_open_command_template(&mut conn, &actor_id, OpenSurface::Editor, "").unwrap_err();
    assert!(empty_err.to_string().contains("editor"), "error should name the surface: {empty_err}");

    let whitespace_err =
        set_open_command_template(&mut conn, &actor_id, OpenSurface::Terminal, "   ").unwrap_err();
    assert!(
        whitespace_err.to_string().contains("terminal"),
        "error should name the surface: {whitespace_err}"
    );

    // Neither rejected write stored anything — the default still reads back.
    assert_eq!(
        open_command_template(&conn, OpenSurface::Editor).expect("read should succeed"),
        DEFAULT_EDITOR_TEMPLATE
    );
}

#[test]
fn resolve_open_argv_on_the_editor_default_substitutes_the_path_as_one_element() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = common::new_story(&mut conn, &project.id, &actor_id, "A Story");
    insert_worktree_row(&conn, &story.id, &project.id, &actor_id, "/a/b");

    let argv = resolve_open_argv(&conn, &story.id, OpenSurface::Editor)
        .expect("resolve_open_argv should succeed");
    assert_eq!(argv, vec!["code".to_string(), "/a/b".to_string()]);
}

#[test]
fn resolve_open_argv_on_a_template_with_no_token_appends_the_path_as_a_final_element() {
    let (mut conn, actor_id, project) = seeded_project();
    set_open_command_template(&mut conn, &actor_id, OpenSurface::Editor, "code")
        .expect("set should succeed");
    let story = common::new_story(&mut conn, &project.id, &actor_id, "A Story");
    insert_worktree_row(&conn, &story.id, &project.id, &actor_id, "/a/b");

    let argv = resolve_open_argv(&conn, &story.id, OpenSurface::Editor)
        .expect("resolve_open_argv should succeed");
    assert_eq!(argv, vec!["code".to_string(), "/a/b".to_string()]);
}

#[test]
fn resolve_open_argv_never_splits_a_path_containing_a_space_and_a_semicolon() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = common::new_story(&mut conn, &project.id, &actor_id, "A Story");
    let dangerous_path = "/a b/c; rm -rf x";
    insert_worktree_row(&conn, &story.id, &project.id, &actor_id, dangerous_path);

    let argv = resolve_open_argv(&conn, &story.id, OpenSurface::Terminal)
        .expect("resolve_open_argv should succeed");

    // "open -a Terminal {worktree_path}" → exactly four elements, the fourth carrying the whole
    // dangerous path verbatim — never split, never interpreted as a second command.
    assert_eq!(argv.len(), 4, "expected exactly 4 argv elements, got {argv:?}");
    assert_eq!(argv[0], "open");
    assert_eq!(argv[1], "-a");
    assert_eq!(argv[2], "Terminal");
    assert_eq!(argv[3], dangerous_path);
}

#[test]
fn resolve_open_argv_collapses_whitespace_runs_rather_than_producing_empty_elements() {
    let (mut conn, actor_id, project) = seeded_project();
    set_open_command_template(
        &mut conn,
        &actor_id,
        OpenSurface::Editor,
        &format!("code    {WORKTREE_PATH_TOKEN}"),
    )
    .expect("set should succeed");
    let story = common::new_story(&mut conn, &project.id, &actor_id, "A Story");
    insert_worktree_row(&conn, &story.id, &project.id, &actor_id, "/a/b");

    let argv = resolve_open_argv(&conn, &story.id, OpenSurface::Editor)
        .expect("resolve_open_argv should succeed");
    assert_eq!(argv, vec!["code".to_string(), "/a/b".to_string()]);
}

#[test]
fn resolve_open_argv_for_a_story_with_no_worktree_row_errors_naming_the_story() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = common::new_story(&mut conn, &project.id, &actor_id, "A Story With No Worktree");

    let err = resolve_open_argv(&conn, &story.id, OpenSurface::Editor).unwrap_err();
    assert!(
        err.to_string().contains(&story.id),
        "error should name the Story id {:?}, got: {err}",
        story.id
    );
}
