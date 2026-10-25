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
/// (plan 03-01 Task 3): reads every file under `packages/core/src` from disk, strips whole-line
/// `//` comments exactly as `supervisor_cwd.rs`'s own `is_whole_line_comment` does, and looks for
/// the quoted git-subcommand-argument form of a force flag, `stash`, or `commit` — the exact shape
/// every real git subcommand argument takes in this codebase's own `git_at` call sites
/// (`&["worktree", "remove", ...]`). Quoting the token is what distinguishes a genuine `git
/// commit`/`git stash`/`--force` invocation from an unrelated bare use of the word — `tx.commit()`
/// (a SQLite transaction method, no quotes) legitimately exists in `remove_worktree_for_story`
/// itself and must never trip this gate.
///
/// `stash` and `commit` are forbidden everywhere: Flywheel never commits or stashes on the agent's
/// behalf. The force flag has exactly ONE sanctioned site: the forced removal inside
/// `domain/story_drop.rs`'s `wipe_worktree_and_branch`. Drop is the one deliberate discard the spec
/// gives the developer (docs/mvp-spec.md §4.5: "The worktree is left exactly as it is. No WIP
/// commit and no reset. Wiping the work is Cyril's call, through Drop."), so the routine removal
/// path keeps refusing a dirty tree and Drop alone may wipe one. The gate also pins how Drop is
/// reached: `wipe_worktree_and_branch` is private, called once, from `drop_story`, after its
/// live-session refusal, and `drop_story` is called from one command, `story_drop` (which the
/// renderer reaches only through its confirmation step).
///
/// Two files hold the force token as DATA, not as an invocation: the Gated-action classifier
/// (`destructive.rs`) and the permission-pattern parser (`permission_pattern.rs`) read it in an
/// agent's command line to recognise a forced git command. They are named below and the gate
/// asserts they never run git themselves.
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
    /// written as plain string literals in this file — so this test file cannot trivially match its
    /// own source text.
    fn quoted(chars: &[char]) -> String {
        let quote = '"';
        let word: String = chars.iter().collect();
        format!("{quote}{word}{quote}")
    }

    fn force_token() -> String {
        quoted(&['-', '-', 'f', 'o', 'r', 'c', 'e'])
    }

    fn never_tokens() -> Vec<String> {
        vec![quoted(&['s', 't', 'a', 's', 'h']), quoted(&['c', 'o', 'm', 'm', 'i', 't'])]
    }

    /// Whether `line` holds `token` in argument position: a quoted string not followed by `:`. A
    /// quoted word followed by `:` is a map key (`json!({ "commit": sha })`), not a git argument.
    fn as_argument(line: &str, token: &str) -> bool {
        line.match_indices(token).any(|(at, _)| !line[at + token.len()..].trim_start().starts_with(':'))
    }

    /// Files that hold the force token only to recognise it in an agent's command line.
    const CLASSIFIERS: [&str; 2] = ["packages/core/src/destructive.rs", "packages/core/src/permission_pattern.rs"];

    /// The one file allowed a forced git invocation, and the function it must sit in.
    const DROP_FILE: &str = "packages/core/src/domain/story_drop.rs";
    const WIPE_FN: &str = "fn wipe_worktree_and_branch(";

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {dir:?}: {e}")) {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|x| x == "rs") {
                out.push(path);
            }
        }
    }

    /// `(relative path, 0-based line, line)` for every non-comment line of every `.rs` file under `dir`.
    fn code_lines(dir: &str) -> Vec<(String, usize, String)> {
        let root = workspace_root();
        let mut files = Vec::new();
        rust_files(&root.join(dir), &mut files);
        files.sort();
        let mut lines = Vec::new();
        for file in files {
            let rel = file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
            let contents = std::fs::read_to_string(&file).unwrap_or_else(|e| panic!("failed to read {file:?}: {e}"));
            for (idx, line) in contents.lines().enumerate() {
                if !is_whole_line_comment(line) {
                    lines.push((rel.clone(), idx, line.to_string()));
                }
            }
        }
        lines
    }

    /// The 0-based line range of the item whose signature contains `signature`, through its own
    /// closing `}` at column zero.
    fn item_range(file: &str, signature: &str) -> std::ops::Range<usize> {
        let contents = std::fs::read_to_string(workspace_root().join(file)).expect("read source");
        let lines: Vec<&str> = contents.lines().collect();
        let start = lines.iter().position(|l| l.contains(signature)).unwrap_or_else(|| panic!("{signature} not in {file}"));
        let end = lines[start..].iter().position(|l| l.trim_end() == "}").map(|o| start + o + 1).unwrap_or(lines.len());
        start..end
    }

    #[test]
    fn the_removal_call_chain_carries_no_force_stash_or_commit_git_subcommand_token() {
        let lines = code_lines("packages/core/src");
        let never = never_tokens();
        let stash_or_commit: Vec<String> = lines
            .iter()
            .filter(|(_, _, line)| never.iter().any(|t| as_argument(line, t)))
            .map(|(file, idx, line)| format!("{file}:{}: {}", idx + 1, line.trim()))
            .collect();
        assert!(stash_or_commit.is_empty(), "found a stash/commit git-subcommand token:\n{}", stash_or_commit.join("\n"));

        let force = force_token();
        let forced: Vec<&(String, usize, String)> = lines
            .iter()
            .filter(|(file, _, line)| as_argument(line, &force) && !CLASSIFIERS.contains(&file.as_str()))
            .collect();
        let wipe = item_range(DROP_FILE, WIPE_FN);
        assert!(
            forced.len() == 1 && forced[0].0 == DROP_FILE && wipe.contains(&forced[0].1),
            "the force token may appear in exactly one place, Drop's forced removal in {DROP_FILE}'s \
             `{WIPE_FN}`; found:\n{}",
            forced.iter().map(|(f, i, l)| format!("{f}:{}: {}", i + 1, l.trim())).collect::<Vec<_>>().join("\n")
        );
    }

    #[test]
    fn the_classifiers_hold_the_force_token_as_data_and_never_run_git() {
        for (file, _, line) in code_lines("packages/core/src") {
            if CLASSIFIERS.contains(&file.as_str()) {
                assert!(
                    !line.contains("git_at(") && !line.contains("git_output_at(") && !line.contains("Command::new"),
                    "{file} must only recognise the force flag, never run a command: {}",
                    line.trim()
                );
            }
        }
    }

    #[test]
    fn drops_forced_removal_is_reached_only_through_the_drop_command_after_its_live_session_refusal() {
        let wipe_call = "wipe_worktree_and_branch(";
        let core = code_lines("packages/core/src");
        let wipe_sites: Vec<&(String, usize, String)> =
            core.iter().filter(|(_, _, l)| l.contains(wipe_call) && !l.contains(WIPE_FN)).collect();
        let drop_fn = item_range(DROP_FILE, "pub fn drop_story(");
        assert!(
            wipe_sites.len() == 1 && wipe_sites[0].0 == DROP_FILE && drop_fn.contains(&wipe_sites[0].1),
            "`{WIPE_FN}` must have exactly one caller, inside `drop_story`; found {wipe_sites:?}"
        );
        assert!(
            !core.iter().any(|(f, _, l)| f == DROP_FILE && l.contains(&format!("pub {WIPE_FN}"))
                || f == DROP_FILE && l.contains(&format!("pub(crate) {WIPE_FN}"))),
            "`{WIPE_FN}` stays private to {DROP_FILE}"
        );
        let refusal = core
            .iter()
            .find(|(f, i, l)| f == DROP_FILE && drop_fn.contains(i) && l.contains("Stop the session first"))
            .expect("drop_story refuses a live session");
        assert!(refusal.1 < wipe_sites[0].1, "the live-session refusal comes before the wipe");

        let desktop = code_lines("packages/desktop/src-tauri/src");
        let drop_sites: Vec<&(String, usize, String)> =
            desktop.iter().filter(|(_, _, l)| l.contains("drop_story(")).collect();
        let command = item_range("packages/desktop/src-tauri/src/commands/story.rs", "pub async fn story_drop(");
        assert!(
            drop_sites.len() == 1
                && drop_sites[0].0 == "packages/desktop/src-tauri/src/commands/story.rs"
                && command.contains(&drop_sites[0].1),
            "`drop_story` must be called from the `story_drop` command alone; found {drop_sites:?}"
        );
        let core_callers: Vec<&(String, usize, String)> =
            core.iter().filter(|(f, _, l)| l.contains("drop_story(") && !(f == DROP_FILE && l.contains("pub fn drop_story("))).collect();
        assert!(core_callers.is_empty(), "nothing in the core calls `drop_story`; found {core_callers:?}");
    }
}
