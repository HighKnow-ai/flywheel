//! WORK-03 integration coverage (D-41/D-42/D-43): a real git repository, a real worktree, and the
//! full `remove_worktree_for_story`/`porcelain_entries` round trip — one test per `<behavior>`
//! bullet in `03-01-PLAN.md` Task 1.

mod common;

use common::with_scratch_worktree_root;

use std::path::Path;

use core::domain::worktree::{ensure_worktree, porcelain_entries, remove_worktree_for_story};

#[test]
fn removing_a_clean_worktree_deletes_it_from_disk_and_the_database_and_appends_one_event() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Removal story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
        let worktree_path = worktree.path.clone();

        assert!(Path::new(&worktree_path).exists(), "the worktree must exist before removal");

        remove_worktree_for_story(&mut conn, &story.id, &actor_id)
            .expect("removing a clean worktree must succeed");

        assert!(!Path::new(&worktree_path).exists(), "the worktree directory must be gone from disk");

        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE id = ?1",
                rusqlite::params![worktree.id],
                |row| row.get(0),
            )
            .expect("failed to count worktrees rows");
        assert_eq!(row_count, 0, "the worktrees row must be gone from the database");

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'worktree.removed' AND stream_id = ?1",
                rusqlite::params![worktree.id],
                |row| row.get(0),
            )
            .expect("failed to count worktree.removed events");
        assert_eq!(event_count, 1, "exactly one worktree.removed event must be appended");
    });
}

#[test]
fn removing_a_worktree_with_a_modified_file_is_refused_and_leaves_everything_in_place() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Dirty story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        let readme = Path::new(&worktree.path).join("README.md");
        std::fs::write(&readme, b"modified content\n").expect("failed to modify README.md");

        let err = remove_worktree_for_story(&mut conn, &story.id, &actor_id)
            .expect_err("removing a dirty worktree must fail");
        assert!(
            err.to_string().contains("1 uncommitted"),
            "the error should name the dirty count: {err}"
        );

        assert!(Path::new(&worktree.path).exists(), "the worktree directory must still exist");
        let contents = std::fs::read(&readme).expect("the modified file should still exist");
        assert_eq!(
            contents, b"modified content\n",
            "the modified file's content must be untouched"
        );

        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE id = ?1",
                rusqlite::params![worktree.id],
                |row| row.get(0),
            )
            .expect("failed to count worktrees rows");
        assert_eq!(row_count, 1, "the worktrees row must still be present");
    });
}

#[test]
fn removing_a_worktree_with_only_an_untracked_file_is_also_refused() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Untracked story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        let scratch = Path::new(&worktree.path).join("scratch.txt");
        std::fs::write(&scratch, b"untracked work\n").expect("failed to write the untracked file");

        remove_worktree_for_story(&mut conn, &story.id, &actor_id)
            .expect_err("an untracked file must count as work that would be lost");

        assert!(Path::new(&worktree.path).exists(), "the worktree directory must still exist");
        assert!(scratch.exists(), "the untracked file must still exist");
    });
}

#[test]
fn porcelain_entries_on_a_dirty_worktree_returns_one_entry_per_porcelain_line() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Check story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        std::fs::write(Path::new(&worktree.path).join("README.md"), b"changed\n")
            .expect("failed to modify README.md");
        std::fs::write(Path::new(&worktree.path).join("new.txt"), b"new\n")
            .expect("failed to write a new untracked file");

        let entries =
            porcelain_entries(Path::new(&worktree.path)).expect("porcelain_entries should succeed");
        assert_eq!(entries.len(), 2, "expected one entry per dirty file, got: {entries:?}");
        assert!(
            entries.iter().any(|e| e.path == "README.md"),
            "expected README.md in the entries: {entries:?}"
        );
        assert!(
            entries.iter().any(|e| e.path == "new.txt"),
            "expected new.txt in the entries: {entries:?}"
        );
    });
}

#[test]
fn worktree_summary_for_story_on_a_story_with_no_worktrees_row_returns_none() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "No worktree story");

        let summary = core::query::sessions::worktree_summary_for_story(&conn, &story.id)
            .expect("worktree_summary_for_story should succeed");
        assert!(summary.is_none(), "a Story with no worktree row must resolve to None");

        // Confirm remove_worktree_for_story itself also refuses cleanly on a missing row.
        remove_worktree_for_story(&mut conn, &story.id, &actor_id)
            .expect_err("remove_worktree_for_story must refuse when no worktree row exists");
    });
}

/// The literal reading of criterion 1's "leaves the worktree alone" (D-43, plan 03-01 Task 3):
/// snapshot the worktree's directory listing, the dirty file's own bytes, and the full
/// `worktrees` row BEFORE a refused removal, then assert all three are byte/value-identical
/// AFTER it — not just "the row count is still 1" (Task 1's own, weaker assertion).
#[test]
fn refusal_leaves_everything_untouched() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Untouched story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        let dirty_file = Path::new(&worktree.path).join("scratch.txt");
        std::fs::write(&dirty_file, b"do not lose this\n").expect("failed to write the dirty file");

        let listing_before = directory_listing(Path::new(&worktree.path));
        let dirty_bytes_before =
            std::fs::read(&dirty_file).expect("the dirty file should exist before the attempt");
        let row_before = worktrees_row(&conn, &worktree.id);

        remove_worktree_for_story(&mut conn, &story.id, &actor_id)
            .expect_err("removing a dirty worktree must be refused");

        let listing_after = directory_listing(Path::new(&worktree.path));
        assert_eq!(listing_before, listing_after, "the worktree's directory listing must be unchanged");

        let dirty_bytes_after =
            std::fs::read(&dirty_file).expect("the dirty file should still exist after the attempt");
        assert_eq!(dirty_bytes_before, dirty_bytes_after, "the dirty file's bytes must be unchanged");

        let row_after = worktrees_row(&conn, &worktree.id);
        assert_eq!(row_before, row_after, "the worktrees row must be byte-for-byte unchanged");
    });
}

/// A sorted directory listing (file names only, one level deep) — used only to prove a refused
/// removal changed nothing on disk, never as a structural read anywhere in production code.
fn directory_listing(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .expect("failed to read the worktree directory")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// The full `worktrees` row as a tuple, for a before/after equality snapshot.
fn worktrees_row(conn: &rusqlite::Connection, worktree_id: &str) -> (String, String, String, String, String, String, String) {
    conn.query_row(
        "SELECT id, story_id, project_id, path, branch, base_branch, status FROM worktrees WHERE id = ?1",
        rusqlite::params![worktree_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        },
    )
    .expect("worktrees row should exist")
}

/// D-43's "no escape hatch" as a source-scanning gate, in the style of `supervisor_cwd.rs`
/// (plan 03-01 Task 3): reads `packages/core/src/git.rs` and
/// `packages/core/src/domain/worktree.rs` from disk, strips whole-line `//` comments exactly as
/// `supervisor_cwd.rs`'s own `is_whole_line_comment` does, and asserts the removal call chain
/// contains no quoted git-subcommand-argument form of a force flag, `stash`, or `commit` — the
/// exact shape every real git subcommand argument takes in this codebase's own `git_at` call
/// sites (`&["worktree", "remove", ...]`). Quoting the token is what distinguishes a genuine `git
/// commit`/`git stash`/`--force` invocation from an unrelated bare use of the word — `tx.commit()`
/// (a SQLite transaction method, no quotes) legitimately exists in `remove_worktree_for_story`
/// itself and must never trip this gate.
mod no_escape_hatch {
    use std::path::{Path, PathBuf};

    fn is_whole_line_comment(line: &str) -> bool {
        line.trim_start().starts_with("//")
    }

    fn workspace_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("packages/core should have a parent")
            .parent()
            .expect("packages should have a parent")
            .to_path_buf()
    }

    /// The forbidden quoted tokens, assembled from character pieces at runtime rather than
    /// written as plain string literals in this file (per this plan's own `<action>` text) — so a
    /// future widening of this scan to include this test file cannot trivially match its own
    /// source text.
    fn forbidden_tokens() -> Vec<String> {
        let quote = '"';
        let force: String = ['-', '-', 'f', 'o', 'r', 'c', 'e'].into_iter().collect();
        let stash: String = ['s', 't', 'a', 's', 'h'].into_iter().collect();
        let commit: String = ['c', 'o', 'm', 'm', 'i', 't'].into_iter().collect();
        vec![
            format!("{quote}{force}{quote}"),
            format!("{quote}{stash}{quote}"),
            format!("{quote}{commit}{quote}"),
        ]
    }

    fn scan_for_forbidden_tokens(path: &Path, tokens: &[String]) -> Vec<String> {
        let contents =
            std::fs::read_to_string(path).unwrap_or_else(|e| panic!("failed to read {path:?}: {e}"));
        let mut hits = Vec::new();
        for (idx, raw_line) in contents.lines().enumerate() {
            if is_whole_line_comment(raw_line) {
                continue;
            }
            for token in tokens {
                if raw_line.contains(token.as_str()) {
                    hits.push(format!("{}:{}: {}", path.display(), idx + 1, raw_line.trim()));
                }
            }
        }
        hits
    }

    #[test]
    fn the_removal_call_chain_carries_no_force_stash_or_commit_git_subcommand_token() {
        let root = workspace_root();
        let tokens = forbidden_tokens();

        let mut hits = Vec::new();
        for file in [
            root.join("packages/core/src/git.rs"),
            root.join("packages/core/src/domain/worktree.rs"),
        ] {
            hits.extend(scan_for_forbidden_tokens(&file, &tokens));
        }

        assert!(
            hits.is_empty(),
            "found a force/stash/commit git-subcommand token in the worktree-removal call chain:\n{}",
            hits.join("\n")
        );
    }
}
