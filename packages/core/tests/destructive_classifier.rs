//! The Gated-action deny-list (docs/mvp-spec.md §4.1, ADR 0001): one test per Gated action and per
//! allowed case, the migration wiring, and the write-path guards `create_pending_request`/
//! `answer_request` carry for a gated request. The `shim_gate` module drives the built shim
//! binary's own socket behaviour.

mod common;

use common::with_scratch_worktree_root;

use core::destructive::DestructiveCategory;
use core::domain::session::start_session;
use core::domain::permission_request::{
    answer_request, create_pending_request, DestructiveAllowAlwaysRejected,
};
use rusqlite::Connection;

/// Seed one project with one Story and one `running` agent run — everything the two
/// `permission_request` integration tests below need.
fn seeded_running_run() -> (Connection, String, String) {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Gated story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");
        (conn, actor_id, run.id)
    })
}

fn args(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

// --- The Gated-action deny-list (docs/mvp-spec.md §4.1, ADR 0001) ---
//
// One test per Gated action and per allowed case. The module name carries `destructive` so
// `cargo test -p core destructive` selects every one of them.

mod destructive_gated_actions {
    use super::args;
    use core::destructive::{classify, classify_in, DestructiveCategory, GateContext, Verdict};
    use std::path::{Path, PathBuf};

    const STORY: &str = "flywheel/s-1-gate";
    const WORKTREE: &str = "/flywheel-test/worktrees/s-1-gate";

    /// A Story session's context: its own branch, its own worktree as the working directory, and
    /// a HEAD on the Story's own branch.
    fn story_ctx() -> GateContext {
        story_ctx_at(Path::new(WORKTREE), STORY)
    }

    fn story_ctx_at(worktree: &Path, head: &'static str) -> GateContext {
        GateContext {
            default_branch: Some("main".to_string()),
            story_branch: Some(STORY.to_string()),
            worktree: Some(worktree.to_path_buf()),
            cwd: Some(worktree.to_path_buf()),
            head_branch: Some(Box::new(move |_dir: &Path| Some(head.to_string()))),
        }
    }

    fn git(argv: &[&str]) -> Verdict {
        classify_in("git", &args(argv), &story_ctx())
    }

    fn gated(category: DestructiveCategory) -> Verdict {
        Verdict::Destructive(category)
    }

    // --- the category vocabulary ---

    #[test]
    fn categories_are_exactly_the_gated_list_and_uncategorized_is_gone() {
        let expected = [
            "git-push",
            "force-push",
            "default-branch-push",
            "branch-deletion",
            "worktree-deletion",
            "hard-reset",
            "force-clean",
            "history-rewrite",
            "recursive-delete",
            "publish",
        ];
        let actual: Vec<&str> = DestructiveCategory::all().iter().map(|c| c.as_str()).collect();
        assert_eq!(actual, expected);
        assert_eq!(DestructiveCategory::from_str_name("uncategorized"), None);
    }

    #[test]
    fn from_str_name_round_trips_every_category() {
        for category in DestructiveCategory::all() {
            assert_eq!(DestructiveCategory::from_str_name(category.as_str()), Some(category));
        }
        assert_eq!(DestructiveCategory::from_str_name("not-a-real-category"), None);
    }

    // --- Gated: every `git push` ---

    #[test]
    fn gated_bare_push() {
        assert_eq!(git(&["push"]), gated(DestructiveCategory::Push));
    }

    #[test]
    fn gated_plain_push_of_the_story_branch() {
        assert_eq!(git(&["push", "origin", STORY]), gated(DestructiveCategory::Push));
        assert_eq!(git(&["push", "-u", "origin", "HEAD"]), gated(DestructiveCategory::Push));
    }

    #[test]
    fn gated_push_behind_dash_c_dir_and_dash_c_config() {
        assert_eq!(git(&["-C", "x", "-c", "a=b", "push"]), gated(DestructiveCategory::Push));
    }

    #[test]
    fn gated_push_behind_other_global_options() {
        assert_eq!(git(&["--no-pager", "push"]), gated(DestructiveCategory::Push));
        assert_eq!(git(&["--git-dir=/x/.git", "push"]), gated(DestructiveCategory::Push));
        assert_eq!(git(&["--work-tree", "/x", "push"]), gated(DestructiveCategory::Push));
        assert_eq!(git(&["-c", "core.hooksPath=/dev/null", "-C", "/x", "push", "origin", "f"]), gated(DestructiveCategory::Push));
    }

    #[test]
    fn gated_force_push_in_each_spelling() {
        for argv in [
            &["push", "--force", "origin", "f"][..],
            &["push", "-f", "origin", "f"],
            &["push", "-uf", "origin", "f"],
            &["push", "--force-with-lease", "origin", "f"],
            &["push", "--force-with-lease=f:abc", "origin", "f"],
            &["push", "origin", "+f"],
            &["push", "origin", "+f:f"],
            &["-C", "x", "push", "--force"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::ForcePush), "{argv:?}");
        }
    }

    #[test]
    fn gated_push_to_the_default_branch() {
        assert_eq!(git(&["push", "origin", "main"]), gated(DestructiveCategory::DefaultBranchPush));
        assert_eq!(git(&["push", "origin", "HEAD:main"]), gated(DestructiveCategory::DefaultBranchPush));
        assert_eq!(git(&["push", "origin", "HEAD:refs/heads/main"]), gated(DestructiveCategory::DefaultBranchPush));
        assert_eq!(git(&["push", "--force", "origin", "main"]), gated(DestructiveCategory::DefaultBranchPush));
    }

    #[test]
    fn gated_remote_branch_deletion_by_push() {
        for argv in [
            &["push", "origin", "--delete", "f"][..],
            &["push", "origin", "-d", "f"],
            &["push", "origin", ":f"],
            &["push", "origin", ":refs/heads/f"],
            &["push", "origin", ":main"],
            &["push", "-fd", "origin", "f"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::BranchDeletion), "{argv:?}");
        }
    }

    #[test]
    fn gated_push_without_any_story_context() {
        let none = GateContext::default();
        assert_eq!(classify_in("git", &args(&["push"]), &none), gated(DestructiveCategory::Push));
        assert_eq!(classify("git", &args(&["push", "origin", "main"]), Some("main")), gated(DestructiveCategory::DefaultBranchPush));
    }

    // --- Gated: deleting a branch or worktree other than the Story's own ---

    #[test]
    fn gated_deleting_another_branch() {
        for argv in [
            &["branch", "-d", "other"][..],
            &["branch", "-D", "other"],
            &["branch", "--delete", "other"],
            &["branch", "--delete", "--force", "other"],
            &["branch", "other", "-D"],
            &["branch", "-dr", "origin/other"],
            &["branch", "-D", STORY, "other"],
            &["-C", "x", "branch", "-D", "main"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::BranchDeletion), "{argv:?}");
        }
    }

    #[test]
    fn allowed_deleting_the_story_own_branch() {
        assert_eq!(git(&["branch", "-D", STORY]), Verdict::Safe);
        assert_eq!(git(&["branch", "-d", &format!("refs/heads/{STORY}")]), Verdict::Safe);
    }

    #[test]
    fn gated_branch_deletion_when_the_story_branch_is_unknown() {
        let none = GateContext::default();
        assert_eq!(classify_in("git", &args(&["branch", "-D", STORY]), &none), gated(DestructiveCategory::BranchDeletion));
    }

    #[test]
    fn allowed_branch_listing_creation_and_rename() {
        assert_eq!(git(&["branch"]), Verdict::Safe);
        assert_eq!(git(&["branch", "-a"]), Verdict::Safe);
        assert_eq!(git(&["branch", "--show-current"]), Verdict::Safe);
        assert_eq!(git(&["branch", "new-branch"]), Verdict::Safe);
        assert_eq!(git(&["branch", "-m", "renamed"]), Verdict::Safe);
    }

    #[test]
    fn gated_removing_another_worktree() {
        for argv in [
            &["worktree", "remove", "../other"][..],
            &["worktree", "remove", "--force", "/elsewhere/wt"],
            &["worktree", "remove", "-f", "-f", "/elsewhere/wt"],
            &["-C", "/elsewhere", "worktree", "remove", "wt"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::WorktreeDeletion), "{argv:?}");
        }
    }

    #[test]
    fn allowed_removing_the_story_own_worktree() {
        assert_eq!(git(&["worktree", "remove", WORKTREE]), Verdict::Safe);
        assert_eq!(git(&["worktree", "remove", "--force", "."]), Verdict::Safe);
    }

    #[test]
    fn allowed_other_worktree_subcommands() {
        assert_eq!(git(&["worktree", "list"]), Verdict::Safe);
        assert_eq!(git(&["worktree", "list", "--porcelain"]), Verdict::Safe);
        assert_eq!(git(&["worktree", "add", "../x", "-b", "y"]), Verdict::Safe);
        assert_eq!(git(&["worktree", "prune"]), Verdict::Safe);
    }

    // --- Gated: `reset --hard` and `clean -f` ---

    #[test]
    fn gated_hard_reset() {
        for argv in [
            &["reset", "--hard"][..],
            &["reset", "--hard", "HEAD~1"],
            &["reset", "-q", "--hard", "origin/main"],
            &["-C", "x", "reset", "--hard"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::HardReset), "{argv:?}");
        }
    }

    #[test]
    fn allowed_non_hard_reset() {
        assert_eq!(git(&["reset"]), Verdict::Safe);
        assert_eq!(git(&["reset", "--soft", "HEAD~1"]), Verdict::Safe);
        assert_eq!(git(&["reset", "HEAD", "file.txt"]), Verdict::Safe);
    }

    #[test]
    fn gated_force_clean() {
        for argv in [
            &["clean", "-f"][..],
            &["clean", "-fd"],
            &["clean", "-fdx"],
            &["clean", "-xdf"],
            &["clean", "--force"],
            &["clean", "-d", "--force", "build"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::ForceClean), "{argv:?}");
        }
    }

    #[test]
    fn allowed_clean_without_force() {
        assert_eq!(git(&["clean"]), Verdict::Safe);
        assert_eq!(git(&["clean", "-n"]), Verdict::Safe);
        assert_eq!(git(&["clean", "-nd"]), Verdict::Safe);
        assert_eq!(git(&["clean", "-dx"]), Verdict::Safe);
    }

    // --- Gated: rebase or filter-branch off the Story's own branch ---

    #[test]
    fn allowed_rebase_on_the_story_own_branch() {
        for argv in [
            &["rebase", "main"][..],
            &["rebase", "origin/main"],
            &["rebase", "-i", "origin/main"],
            &["rebase", "--onto", "main", "HEAD~3"],
            &["rebase", "main", STORY],
            &["rebase", "-x", "make test", "main"],
            &["rebase", "--continue"],
            &["rebase", "--abort"],
        ] {
            assert_eq!(git(argv), Verdict::Safe, "{argv:?}");
        }
    }

    #[test]
    fn gated_rebase_of_another_branch_named_explicitly() {
        assert_eq!(git(&["rebase", "main", "other"]), gated(DestructiveCategory::HistoryRewrite));
        assert_eq!(git(&["rebase", "--onto", "main", "base", "other"]), gated(DestructiveCategory::HistoryRewrite));
        assert_eq!(git(&["rebase", "--root", "other"]), gated(DestructiveCategory::HistoryRewrite));
    }

    #[test]
    fn gated_rebase_while_head_is_another_branch() {
        let ctx = story_ctx_at(Path::new(WORKTREE), "main");
        assert_eq!(classify_in("git", &args(&["rebase", "origin/main"]), &ctx), gated(DestructiveCategory::HistoryRewrite));
        assert_eq!(classify_in("git", &args(&["rebase", "-i", "HEAD~2"]), &ctx), gated(DestructiveCategory::HistoryRewrite));
    }

    #[test]
    fn gated_rebase_when_the_story_branch_is_unknown() {
        let none = GateContext::default();
        assert_eq!(classify_in("git", &args(&["rebase", "main"]), &none), gated(DestructiveCategory::HistoryRewrite));
    }

    #[test]
    fn gated_filter_branch_off_the_story_own_branch() {
        for argv in [
            &["filter-branch", "--tree-filter", "rm -f secrets", "--", "--all"][..],
            &["filter-branch", "--", "other"],
            &["filter-branch", "-f", "--msg-filter", "cat", "main"],
        ] {
            assert_eq!(git(argv), gated(DestructiveCategory::HistoryRewrite), "{argv:?}");
        }
        let elsewhere = story_ctx_at(Path::new(WORKTREE), "main");
        assert_eq!(classify_in("git", &args(&["filter-branch"]), &elsewhere), gated(DestructiveCategory::HistoryRewrite));
    }

    #[test]
    fn allowed_filter_branch_on_the_story_own_branch() {
        assert_eq!(git(&["filter-branch", "--msg-filter", "cat", "--", STORY]), Verdict::Safe);
        assert_eq!(git(&["filter-branch", "--msg-filter", "cat"]), Verdict::Safe);
    }

    // --- Gated: recursive `rm` outside the worktree ---

    fn rm(argv: &[&str]) -> Verdict {
        classify_in("rm", &args(argv), &story_ctx())
    }

    #[test]
    fn allowed_recursive_rm_inside_the_worktree() {
        let inside = format!("{WORKTREE}/build");
        for argv in [
            &["-rf", "build"][..],
            &["-r", "-f", "./target", "node_modules"],
            &["-R", "a/b/c"],
            &["--recursive", "build"],
            &["-rf", &inside],
            &["-rf", "build/../dist"],
            &["-rf", "--", "-odd-name"],
        ] {
            assert_eq!(rm(argv), Verdict::Safe, "{argv:?}");
        }
    }

    #[test]
    fn gated_recursive_rm_outside_the_worktree() {
        for argv in [
            &["-rf", "/flywheel-test/elsewhere"][..],
            &["-rf", "../other"],
            &["-rf", "build/../../other"],
            &["-r", "build", "/etc/x"],
            &["-rf", "."],
            &["-rf", WORKTREE],
            &["-rf", "/"],
        ] {
            assert_eq!(rm(argv), gated(DestructiveCategory::RecursiveDelete), "{argv:?}");
        }
    }

    #[test]
    fn gated_recursive_rm_when_the_worktree_is_unknown() {
        let none = GateContext::default();
        assert_eq!(classify_in("rm", &args(&["-rf", "build"]), &none), gated(DestructiveCategory::RecursiveDelete));
        assert_eq!(classify("rm", &args(&["-rf", "build"]), None), gated(DestructiveCategory::RecursiveDelete));
    }

    #[test]
    fn allowed_non_recursive_rm_anywhere() {
        assert_eq!(rm(&["file.txt"]), Verdict::Safe);
        assert_eq!(rm(&["-f", "/flywheel-test/elsewhere/file"]), Verdict::Safe);
    }

    #[test]
    fn recursive_rm_compares_resolved_paths_so_a_symlinked_worktree_still_counts_as_inside() {
        let root = tempfile::tempdir().expect("scratch dir");
        let real = root.path().join("real-wt");
        std::fs::create_dir_all(real.join("build")).unwrap();
        let link = root.path().join("link-wt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        // The worktree is recorded through the symlink; the shell's cwd is the resolved path.
        let ctx = GateContext {
            story_branch: Some(STORY.to_string()),
            worktree: Some(link.clone()),
            cwd: Some(real.canonicalize().unwrap()),
            ..GateContext::default()
        };
        assert_eq!(classify_in("rm", &args(&["-rf", "build"]), &ctx), Verdict::Safe);
        let outside: PathBuf = root.path().join("sibling");
        assert_eq!(
            classify_in("rm", &args(&["-rf", outside.to_str().unwrap()]), &ctx),
            gated(DestructiveCategory::RecursiveDelete)
        );
    }

    // --- Gated: publishing ---

    fn run(program: &str, argv: &[&str]) -> Verdict {
        classify_in(program, &args(argv), &story_ctx())
    }

    #[test]
    fn gated_npm_publish() {
        assert_eq!(run("npm", &["publish"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("npm", &["publish", "--access", "public"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("npm", &["--registry=https://r.example", "publish"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("npm", &["-w", "pkg", "publish"]), gated(DestructiveCategory::Publish));
    }

    #[test]
    fn gated_cargo_publish() {
        assert_eq!(run("cargo", &["publish"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("cargo", &["+nightly", "publish", "-p", "core"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("cargo", &["--config", "x=1", "publish"]), gated(DestructiveCategory::Publish));
    }

    #[test]
    fn gated_gh_pr_merge() {
        assert_eq!(run("gh", &["pr", "merge", "12", "--squash"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("gh", &["-R", "o/r", "pr", "merge"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("gh", &["pr", "--repo", "o/r", "merge", "12"]), gated(DestructiveCategory::Publish));
    }

    #[test]
    fn gated_gh_release() {
        assert_eq!(run("gh", &["release", "create", "v1.0.0"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("gh", &["release", "upload", "v1.0.0", "a.tgz"]), gated(DestructiveCategory::Publish));
        assert_eq!(run("gh", &["release", "delete", "v1.0.0"]), gated(DestructiveCategory::Publish));
    }

    #[test]
    fn allowed_ordinary_npm_cargo_and_gh_commands() {
        assert_eq!(run("npm", &["install"]), Verdict::Safe);
        assert_eq!(run("npm", &["test"]), Verdict::Safe);
        assert_eq!(run("npm", &["run", "publish-docs"]), Verdict::Safe);
        assert_eq!(run("npm", &["--prefix", "packages/desktop", "run", "build"]), Verdict::Safe);
        assert_eq!(run("cargo", &["test", "--workspace"]), Verdict::Safe);
        assert_eq!(run("cargo", &["build", "--release"]), Verdict::Safe);
        assert_eq!(run("gh", &["pr", "create", "--fill"]), Verdict::Safe);
        assert_eq!(run("gh", &["pr", "view", "12"]), Verdict::Safe);
        assert_eq!(run("gh", &["issue", "list"]), Verdict::Safe);
    }

    // --- Allowed: read-only git, including Claude Code's own startup checks ---

    #[test]
    fn allowed_read_only_git_calls() {
        for argv in [
            &["status"][..],
            &["status", "--porcelain"],
            &["log", "--oneline", "-5"],
            &["ls-files"],
            &["ls-files", "--others", "--exclude-standard"],
            &["rev-parse", "HEAD"],
            &["rev-parse", "--show-toplevel"],
            &["rev-parse", "--abbrev-ref", "HEAD"],
            &["diff"],
            &["diff", "--stat", "main...HEAD"],
            &["show", "HEAD"],
            &["config", "--get", "user.email"],
            &["remote", "get-url", "origin"],
            &["worktree", "list"],
            &["--no-optional-locks", "status", "--porcelain"],
            &["-c", "core.quotepath=false", "status"],
            &["-C", "/some/repo", "log", "-1"],
            &["-C", "/some/repo", "-c", "a=b", "rev-parse", "--is-inside-work-tree"],
        ] {
            assert_eq!(git(argv), Verdict::Safe, "{argv:?}");
        }
    }

    #[test]
    fn allowed_ordinary_writes_inside_the_worktree() {
        for argv in [
            &["add", "-A"][..],
            &["commit", "-m", "msg"],
            &["checkout", "-b", "x"],
            &["merge", "main"],
            &["stash"],
            &["fetch", "origin"],
            &["cherry-pick", "abc"],
        ] {
            assert_eq!(git(argv), Verdict::Safe, "{argv:?}");
        }
    }

    #[test]
    fn allowed_unknown_git_subcommands_and_bare_git() {
        assert_eq!(git(&["frobnicate", "--all"]), Verdict::Safe);
        assert_eq!(git(&["for-each-ref", "refs/heads"]), Verdict::Safe);
        assert_eq!(git(&[]), Verdict::Safe);
        assert_eq!(git(&["--version"]), Verdict::Safe);
        assert_eq!(git(&["-C", "x"]), Verdict::Safe);
    }

    #[test]
    fn allowed_every_other_program() {
        assert_eq!(run("ls", &["-la"]), Verdict::Safe);
        assert_eq!(run("curl", &["https://example.com"]), Verdict::Safe);
    }
}

// --- migration wiring ---

#[test]
fn migration_source_list_defines_the_destructive_gate_column_exactly_once() {
    // The schema of record is one baseline migration; `permission_requests.destructive_category`
    // must be declared in exactly one registered migration, never zero, never twice.
    let sources = core::db::migration_sources();
    let occurrences = sources.iter().map(|s| s.matches("destructive_category TEXT").count()).sum::<usize>();
    assert_eq!(occurrences, 1, "destructive_category must be defined by exactly one migration");
}

// --- create_pending_request: validates destructive_category against the enum's string set ---

#[test]
fn create_pending_request_accepts_every_valid_destructive_category() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    for category in DestructiveCategory::all() {
        let request = create_pending_request(
            &mut conn,
            &run_id,
            "Bash",
            Some("{\"command\":\"git push --force\"}"),
            &actor_id,
            Some(category.as_str()),
        )
        .unwrap_or_else(|e| panic!("expected {category:?} to be accepted, got: {e}"));
        assert_eq!(request.destructive_category.as_deref(), Some(category.as_str()));
        // Answer it so the run is unblocked before the next iteration raises another request.
        answer_request(&mut conn, &request.id, "denied", &actor_id)
            .expect("answer_request should succeed for the routine denied path");
    }
}

#[test]
fn create_pending_request_rejects_a_destructive_category_outside_the_enum_set() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let result = create_pending_request(
        &mut conn,
        &run_id,
        "Bash",
        None,
        &actor_id,
        Some("not-a-real-category"),
    );
    assert!(result.is_err(), "an out-of-set destructive_category must be rejected");
}

#[test]
fn create_pending_request_with_no_destructive_category_is_the_routine_variant() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let request = create_pending_request(&mut conn, &run_id, "Bash", None, &actor_id, None)
        .expect("create_pending_request should succeed for the routine variant");
    assert_eq!(request.destructive_category, None);
}

// --- answer_request: D-57's allow-always guard ---

#[test]
fn answer_request_rejects_allowed_always_for_a_request_carrying_a_destructive_category() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let request = create_pending_request(
        &mut conn,
        &run_id,
        "Bash",
        Some("{\"command\":\"git push --force\"}"),
        &actor_id,
        Some(DestructiveCategory::ForcePush.as_str()),
    )
    .expect("create_pending_request should succeed");

    let result = answer_request(&mut conn, &request.id, "allowed_always", &actor_id);
    let err = result.expect_err("allowed_always must be rejected for a destructive request");
    err.downcast_ref::<DestructiveAllowAlwaysRejected>()
        .expect("the error must be the typed DestructiveAllowAlwaysRejected, not a generic failure");

    // The row must still be genuinely pending afterward — the rejected attempt must not have
    // partially applied.
    let status: String = conn
        .query_row(
            "SELECT status FROM permission_requests WHERE id = ?1",
            rusqlite::params![request.id],
            |row| row.get(0),
        )
        .expect("permission_requests row should exist");
    assert_eq!(status, "pending", "a rejected allowed_always attempt must not change the row's status");
}

#[test]
fn answer_request_still_accepts_allowed_always_for_a_routine_non_destructive_request() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let request = create_pending_request(&mut conn, &run_id, "Bash", None, &actor_id, None)
        .expect("create_pending_request should succeed");

    let answered = answer_request(&mut conn, &request.id, "allowed_always", &actor_id)
        .expect("allowed_always must still work for a routine (non-destructive) request");
    assert_eq!(answered.status, "allowed_always");
}

// --- shim_gate (Task 2): the built shim binary's own indefinite-block, allow/deny and
// no-cached-answer contract, driven against a real mock permission socket server. ---

mod shim_gate {
    use core::shim::resolve_shim_binary;
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixListener;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    fn resolve_system_rm() -> PathBuf {
        let path_var = std::env::var_os("PATH").expect("PATH should be set in the test environment");
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("rm");
            if candidate.is_file() {
                return candidate;
            }
        }
        panic!("system rm not found on PATH");
    }

    /// Mirrors [`resolve_system_rm`] for `git` — used by `run_shim_as_git`'s `FLYWHEEL_REAL_GIT`.
    fn resolve_system_git() -> PathBuf {
        let path_var = std::env::var_os("PATH").expect("PATH should be set in the test environment");
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("git");
            if candidate.is_file() {
                return candidate;
            }
        }
        panic!("system git not found on PATH");
    }

    /// A short, unique socket path — deliberately NOT under `std::env::temp_dir()`, whose
    /// per-user macOS path (`/var/folders/.../T/`) plus any descriptive label routinely exceeds
    /// `sockaddr_un`'s ~104-byte `SUN_LEN` limit. `/tmp` is short on every Unix this workspace
    /// targets; a process id plus a monotonic counter is enough uniqueness across this file's own
    /// concurrently-running tests.
    fn scratch_socket_path(_label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        PathBuf::from("/tmp").join(format!("fw-{}-{n}.sock", std::process::id()))
    }

    /// Spawn a background thread that accepts exactly ONE connection on `socket_path`, reads its
    /// one request line, and — if `decision` is `Some` — writes that decision back immediately;
    /// if `decision` is `None`, holds the connection open without ever answering, long past this
    /// file's own multi-second "still alive" assertion window, so that window observes the shim
    /// genuinely blocked rather than a socket that merely closed early.
    fn spawn_mock_permission_server(
        socket_path: PathBuf,
        decision: Option<&'static str>,
    ) -> std::thread::JoinHandle<serde_json::Value> {
        let listener =
            UnixListener::bind(&socket_path).expect("failed to bind the mock permission socket");
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("failed to accept the shim's connection");
            let mut reader = BufReader::new(stream.try_clone().expect("failed to clone the socket"));
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("failed to read the shim's request line");
            let parsed: serde_json::Value =
                serde_json::from_str(line.trim()).expect("the shim's request must be valid JSON");
            assert_eq!(parsed["toolName"], "Bash", "the shim always names the tool Bash");

            match decision {
                Some(decision) => {
                    let mut stream = stream;
                    let response = format!("{{\"decision\":\"{decision}\"}}\n");
                    stream
                        .write_all(response.as_bytes())
                        .expect("failed to write the mock decision");
                }
                None => {
                    std::thread::sleep(Duration::from_secs(10));
                }
            }
            parsed
        })
    }

    fn run_shim_as_rm(
        args: &[&str],
        real_rm: &std::path::Path,
        socket_path: &std::path::Path,
    ) -> std::process::Child {
        let bin = resolve_shim_binary()
            .expect("the shim binary should be resolvable after `cargo build --workspace`");
        let mut cmd = Command::new(&bin);
        cmd.arg0("rm");
        cmd.args(args);
        cmd.env("FLYWHEEL_REAL_RM", real_rm);
        cmd.env("FLYWHEEL_PERMISSION_SOCKET", socket_path);
        cmd.env_remove("FLYWHEEL_REAL_GIT");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.spawn().expect("the shim binary should be spawnable")
    }

    /// Mirrors [`run_shim_as_rm`] for `git` — Task 1's end-to-end proof that a delete-shaped push
    /// reaches the gate through the REAL built shim binary, not just through `classify` directly.
    fn run_shim_as_git(
        args: &[&str],
        real_git: &std::path::Path,
        socket_path: &std::path::Path,
        default_branch: &str,
        cwd: &std::path::Path,
    ) -> std::process::Child {
        let bin = resolve_shim_binary()
            .expect("the shim binary should be resolvable after `cargo build --workspace`");
        let mut cmd = Command::new(&bin);
        cmd.arg0("git");
        cmd.args(args);
        cmd.current_dir(cwd);
        cmd.env("FLYWHEEL_REAL_GIT", real_git);
        cmd.env("FLYWHEEL_PERMISSION_SOCKET", socket_path);
        cmd.env("FLYWHEEL_DEFAULT_BRANCH", default_branch);
        cmd.env_remove("FLYWHEEL_REAL_RM");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.spawn().expect("the shim binary should be spawnable")
    }

    #[test]
    fn an_allow_answer_executes_the_real_binary() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");
        let target = dir.path().join("marker.txt");
        std::fs::write(&target, b"delete me").expect("failed to write the marker file");

        let socket_path = scratch_socket_path("allow");
        let server = spawn_mock_permission_server(socket_path.clone(), Some("allow"));

        let child = run_shim_as_rm(&["-r", target.to_str().unwrap()], &real_rm, &socket_path);
        let output = child.wait_with_output().expect("the shim process should exit");

        assert!(
            output.status.success(),
            "expected the shim to exit successfully on allow, stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!target.exists(), "an allowed recursive rm must actually have deleted the file");
        server.join().expect("the mock server thread should not panic");
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn a_deny_answer_never_executes_the_real_binary() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");
        let target = dir.path().join("marker.txt");
        std::fs::write(&target, b"do not delete me").expect("failed to write the marker file");

        let socket_path = scratch_socket_path("deny");
        let server = spawn_mock_permission_server(socket_path.clone(), Some("deny"));

        let child = run_shim_as_rm(&["-r", target.to_str().unwrap()], &real_rm, &socket_path);
        let output = child.wait_with_output().expect("the shim process should exit");

        assert!(!output.status.success(), "expected a non-zero exit on deny");
        assert!(
            target.exists(),
            "a denied recursive rm must never have touched the file — checked by the side effect's absence, not the exit code alone"
        );
        server.join().expect("the mock server thread should not panic");
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn an_unanswered_socket_leaves_the_shim_blocked_with_no_side_effect() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");
        let target = dir.path().join("marker.txt");
        std::fs::write(&target, b"still here").expect("failed to write the marker file");

        let socket_path = scratch_socket_path("never-answers");
        let _server = spawn_mock_permission_server(socket_path.clone(), None);

        let mut child = run_shim_as_rm(&["-r", target.to_str().unwrap()], &real_rm, &socket_path);

        std::thread::sleep(Duration::from_secs(3));
        match child.try_wait().expect("try_wait should not error") {
            Some(status) => {
                panic!("expected the shim to still be blocked after 3s, but it exited with {status:?}")
            }
            None => {
                assert!(
                    target.exists(),
                    "the shim must not have executed anything while still waiting for an answer"
                );
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn two_consecutive_destructive_invocations_raise_two_distinct_request_ids() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");

        let first_target = dir.path().join("first.txt");
        std::fs::write(&first_target, b"one").expect("failed to write the first marker");
        let socket_a = scratch_socket_path("first");
        let server_a = spawn_mock_permission_server(socket_a.clone(), Some("allow"));
        let child_a = run_shim_as_rm(&["-r", first_target.to_str().unwrap()], &real_rm, &socket_a);
        let output_a = child_a.wait_with_output().expect("the first shim invocation should exit");
        assert!(output_a.status.success());
        let request_a = server_a.join().expect("server thread should not panic");
        let request_id_a = request_a["requestId"]
            .as_str()
            .expect("the request must carry a requestId")
            .to_string();

        let second_target = dir.path().join("second.txt");
        std::fs::write(&second_target, b"two").expect("failed to write the second marker");
        let socket_b = scratch_socket_path("second");
        let server_b = spawn_mock_permission_server(socket_b.clone(), Some("allow"));
        let child_b = run_shim_as_rm(&["-r", second_target.to_str().unwrap()], &real_rm, &socket_b);
        let output_b = child_b.wait_with_output().expect("the second shim invocation should exit");
        assert!(output_b.status.success());
        let request_b = server_b.join().expect("server thread should not panic");
        let request_id_b = request_b["requestId"]
            .as_str()
            .expect("the request must carry a requestId")
            .to_string();

        assert_ne!(
            request_id_a, request_id_b,
            "two destructive invocations must each raise their own new request id — no cached prior answer (D-57)"
        );

        let _ = std::fs::remove_file(&socket_a);
        let _ = std::fs::remove_file(&socket_b);
    }

    /// Task 1's end-to-end proof (T-03-14-01): the REAL built shim binary, invoked as `git` with a
    /// delete-shaped push, raises a real permission request over a real socket carrying
    /// `destructiveCategory: "branch-deletion"`, and a `deny` answer means the real git binary
    /// named by `FLYWHEEL_REAL_GIT` is never executed. The scratch repository needs no real
    /// remote — the point is that the gate fires BEFORE git is ever reached, so the command never
    /// has to be executable to prove the claim; that fact is established directly by asserting a
    /// non-zero exit (the denial) rather than any git-specific failure, together with the
    /// captured request line proving the gate is what actually fired.
    #[test]
    fn a_delete_shaped_push_raises_a_branch_deletion_request_and_is_never_executed_on_deny() {
        let real_git = resolve_system_git();
        let repo_dir = tempfile::tempdir().expect("failed to create a scratch repository");

        let run = |args: &[&str]| {
            Command::new(&real_git)
                .args(args)
                .current_dir(repo_dir.path())
                .output()
                .expect("real git should run for scratch repo setup")
        };
        assert!(run(&["init", "-q", "-b", "main"]).status.success());
        assert!(run(&["config", "user.name", "Test User"]).status.success());
        assert!(run(&["config", "user.email", "test@example.com"]).status.success());
        std::fs::write(repo_dir.path().join("README.md"), b"scratch\n")
            .expect("failed to write scratch file");
        assert!(run(&["add", "README.md"]).status.success());
        assert!(run(&["commit", "-q", "-m", "initial commit"]).status.success());
        assert!(run(&["checkout", "-q", "-b", "feature"]).status.success());
        assert!(run(&["checkout", "-q", "main"]).status.success());

        let socket_path = scratch_socket_path("git-delete-deny");
        let server = spawn_mock_permission_server(socket_path.clone(), Some("deny"));

        let child = run_shim_as_git(
            &["push", "origin", "--delete", "feature"],
            &real_git,
            &socket_path,
            "main",
            repo_dir.path(),
        );
        let output = child.wait_with_output().expect("the shim process should exit");

        assert!(
            !output.status.success(),
            "expected the shim to exit non-zero on deny, stdout: {}, stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        let request = server.join().expect("the mock server thread should not panic");
        assert_eq!(
            request["input"]["destructiveCategory"], "branch-deletion",
            "the wire payload's destructiveCategory must be branch-deletion for a delete-shaped push"
        );

        let _ = std::fs::remove_file(&socket_path);
    }
}
