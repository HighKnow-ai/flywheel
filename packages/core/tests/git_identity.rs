//! Phase 7, plan 07-05, Task 1: LINK-04 coverage for `git_identity.rs`, every `<behavior>` bullet
//! proven against real `git init`-ed repositories carrying commits genuinely stamped by plan
//! 07-02's installed `commit-msg` hook — never a hand-written trailer line. Mirrors
//! `commit_msg_hook.rs`'s own fixture shape (`with_scratch_envs`/`register`-style helpers,
//! duplicated rather than shared since each `tests/*.rs` file compiles to its own binary).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

mod common;

use common::new_story;
use core::branch::story_branch_name;
use core::domain::actor::local_human_actor_id;
use core::domain::project::{register_project, Project};
use core::git_identity::{classify, resolve_identifier, GitIdentifier, IdentityResolution, ResolveOutcome};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_envs`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT` and
/// `FLYWHEEL_RUNTIME_DIR` are process-global mutable state (mirrors `commit_msg_hook.rs`'s own
/// `ENV_LOCK`; a distinct static since each `tests/*.rs` file is its own binary).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_envs<T>(worktree_root: &Path, runtime_dir: &Path, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates these vars while they're set, and this helper always clears them before returning.
    unsafe {
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root);
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime_dir);
    }
    let result = f();
    unsafe {
        std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
        std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
    }
    result
}

fn run_git(repo: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git -C {repo:?} {args:?}: {e}"))
}

fn run_git_ok(repo: &Path, args: &[&str]) -> Output {
    let output = run_git(repo, args);
    assert!(
        output.status.success(),
        "git -C {repo:?} {args:?} failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// A real `git init`-ed, config'd repository with an initial commit on `main` and no remote.
fn fresh_repo(root: &Path) -> PathBuf {
    let dir = tempfile::tempdir_in(root).expect("failed to create scratch repo dir");
    let repo = dir.path().to_path_buf();
    std::mem::forget(dir);
    run_git_ok(root, &["init", "--initial-branch", "main", repo.to_str().unwrap()]);
    run_git_ok(&repo, &["config", "user.email", "git-identity-test@flywheel.invalid"]);
    run_git_ok(&repo, &["config", "user.name", "Flywheel Git Identity Test"]);
    std::fs::write(repo.join("README.md"), "# git_identity.rs scratch repo\n").expect("failed to write README");
    run_git_ok(&repo, &["add", "README.md"]);
    run_git_ok(&repo, &["commit", "-m", "initial commit"]);
    repo
}

/// Register `work_path` as a real Flywheel project (so the commit-msg hook arrives by the real
/// install path, never a test-only shortcut) on `conn`, returning `(actor_id, project)`.
fn open_registered_project(
    worktree_root: &Path,
    runtime_dir: &Path,
    conn: &mut Connection,
    work_path: &Path,
    key_prefix: &str,
) -> (String, Project) {
    with_scratch_envs(worktree_root, runtime_dir, || {
        let actor_id = local_human_actor_id(conn).expect("seeded human actor should exist");
        let project = register_project(conn, &actor_id, work_path, "Git Identity Fixture", key_prefix)
            .expect("register_project should succeed");
        (actor_id, project)
    })
}

fn open_scratch_db() -> Connection {
    let db_dir = tempfile::tempdir().expect("failed to create scratch db dir");
    let db_path = db_dir.path().join("flywheel.db");
    let backups_dir = db_dir.path().join("backups");
    std::mem::forget(db_dir);
    core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed")
}

/// Checkout `branch` (creating it from HEAD if needed) and make one commit, with `run_id` set as
/// `FLYWHEEL_RUN_ID` in the committing CHILD PROCESS's environment only.
fn commit_on_branch(repo: &Path, branch: &str, run_id: Option<&str>) {
    run_git_ok(repo, &["checkout", "-B", branch]);
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(["commit", "--allow-empty", "-m", "test commit"]);
    match run_id {
        Some(id) => {
            cmd.env("FLYWHEEL_RUN_ID", id);
        }
        None => {
            cmd.env_remove("FLYWHEEL_RUN_ID");
        }
    }
    let output = cmd.output().expect("failed to spawn git commit");
    assert!(
        output.status.success(),
        "git commit on branch {branch:?} failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn head_sha(repo: &Path) -> String {
    let output = run_git_ok(repo, &["rev-parse", "HEAD"]);
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn insert_worktree_row(conn: &Connection, story_id: &str, project_id: &str, actor_id: &str, branch: &str) {
    conn.execute(
        "INSERT INTO worktrees (id, story_id, project_id, path, branch, base_branch, status, created_by, created_at)
         VALUES (?1, ?2, ?3, '/tmp/unused-in-this-test', ?4, 'main', 'active', ?5, '2026-01-01T00:00:00.000Z')",
        params![core::ids::new_id(), story_id, project_id, branch, actor_id],
    )
    .expect("insert worktree row should succeed");
}

/// Every object's full name in `repo`, via `git cat-file --batch-all-objects`.
fn repo_object_shas(repo: &Path) -> Vec<String> {
    let output = run_git_ok(repo, &["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"]);
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

/// Find a real prefix shared by two or more objects in `repo`, confirmed against git's own
/// `rev-parse --disambiguate` output — never a fabricated ambiguity, the real output for a real
/// deliberately-short prefix (RESEARCH.md's own instruction: "do not fake git's answer").
fn find_ambiguous_prefix(repo: &Path) -> (String, usize) {
    let shas = repo_object_shas(repo);
    for len in 4..=10usize {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for sha in &shas {
            *counts.entry(sha[..len].to_string()).or_insert(0) += 1;
        }
        if let Some((prefix, _)) = counts.into_iter().find(|(_, c)| *c >= 2) {
            let output = run_git_ok(repo, &["rev-parse", &format!("--disambiguate={prefix}")]);
            let real_count = String::from_utf8_lossy(&output.stdout).lines().filter(|l| !l.is_empty()).count();
            if real_count >= 2 {
                return (prefix, real_count);
            }
        }
    }
    panic!("no ambiguous prefix found among {} objects — increase the commit count", shas.len());
}

// --- classify: the pure security boundary (T-07-05-01) ----------------------------------------

#[test]
fn classify_rejects_hex_shorter_than_the_seven_char_floor() {
    assert_eq!(classify("a1b2c3"), None);
}

#[test]
fn classify_accepts_hex_at_the_floor_and_a_full_length_sha() {
    assert!(matches!(classify("a1b2c3d"), Some(GitIdentifier::Sha(ref s)) if s == "a1b2c3d"));
    let full = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678";
    assert!(matches!(classify(full), Some(GitIdentifier::Sha(_))));
}

#[test]
fn classify_accepts_a_flywheel_namespaced_branch() {
    let input = "flywheel/fly-42-some-title";
    assert!(matches!(classify(input), Some(GitIdentifier::Branch(ref b)) if b == input));
}

#[test]
fn classify_rejects_everything_else() {
    for input in ["--upload-pack=/bin/sh", "", "   ", "main"] {
        assert_eq!(classify(input), None, "expected None for {input:?}");
    }
}

// --- resolve_identifier: branches, no git invocation -------------------------------------------

#[test]
fn resolve_identifier_for_a_story_branch_returns_the_owning_story() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (actor_id, project) = open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo, "GID1");

    let story = new_story(&mut conn, &project.id, &actor_id, "Branch resolves to story");
    let branch = story_branch_name(&story.key, &story.title);
    insert_worktree_row(&conn, &story.id, &project.id, &actor_id, &branch);

    let outcome = resolve_identifier(&conn, &GitIdentifier::Branch(branch)).expect("resolve_identifier");
    match outcome {
        ResolveOutcome::Resolved(IdentityResolution { project_id, item_kind, item_id, item_key, matched_sha, run_id }) => {
            assert_eq!(project_id, project.id);
            assert_eq!(item_kind, "story");
            assert_eq!(item_id, story.id);
            assert_eq!(item_key, story.key);
            assert_eq!(matched_sha, None);
            assert_eq!(run_id, None);
        }
        other => panic!("expected Resolved, got {other:?}"),
    }
}

// --- resolve_identifier: shas, against real stamped commits -------------------------------------

#[test]
fn resolve_identifier_for_a_stamped_sha_returns_the_story_and_run_id() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (actor_id, project) = open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo, "GID3");

    let story = new_story(&mut conn, &project.id, &actor_id, "Stamped commit resolves");
    let branch = story_branch_name(&story.key, &story.title);
    commit_on_branch(&repo, &branch, Some("run-xyz"));
    let full_sha = head_sha(&repo);

    let outcome =
        resolve_identifier(&conn, &GitIdentifier::Sha(full_sha.clone())).expect("resolve_identifier");
    match outcome {
        ResolveOutcome::Resolved(resolution) => {
            assert_eq!(resolution.project_id, project.id);
            assert_eq!(resolution.item_kind, "story");
            assert_eq!(resolution.item_id, story.id);
            assert_eq!(resolution.item_key, story.key);
            assert_eq!(resolution.matched_sha.as_deref(), Some(full_sha.as_str()));
            assert_eq!(resolution.run_id.as_deref(), Some("run-xyz"));
        }
        other => panic!("expected Resolved, got {other:?}"),
    }
}

#[test]
fn resolve_identifier_for_a_sha_with_no_trailer_returns_not_found() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (_actor_id, _project) = open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo, "GID4");

    run_git_ok(&repo, &["checkout", "main"]);
    run_git_ok(&repo, &["commit", "--allow-empty", "-m", "untracked commit"]);
    let full_sha = head_sha(&repo);

    let outcome = resolve_identifier(&conn, &GitIdentifier::Sha(full_sha)).expect("resolve_identifier");
    assert_eq!(outcome, ResolveOutcome::NotFound);
}

#[test]
fn resolve_identifier_for_an_ambiguous_prefix_reports_the_real_match_count() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (_actor_id, _project) = open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo, "GID5");

    run_git_ok(&repo, &["checkout", "main"]);
    // 900 empty commits, message-varied so each produces a distinct commit object even though the
    // tree never changes — enough objects (birthday math over a 4-hex-digit space: roughly
    // 1-exp(-900^2/(2*65536)) ≈ 0.998) that a real prefix collision among real object names is
    // all but certain, proven below against git's own --disambiguate rather than assumed (and the
    // length loop below falls through to longer prefixes on the rare miss).
    for i in 0..900 {
        run_git_ok(&repo, &["commit", "--allow-empty", "-m", &format!("commit {i}")]);
    }

    let (prefix, expected_count) = find_ambiguous_prefix(&repo);

    let outcome = resolve_identifier(&conn, &GitIdentifier::Sha(prefix)).expect("resolve_identifier");
    assert_eq!(outcome, ResolveOutcome::AmbiguousPrefix { matches: expected_count });
}

#[test]
fn resolve_identifier_for_a_sha_present_in_two_registered_repositories_is_ambiguous_across_repositories() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo_a = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (actor_id, project_a) =
        open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo_a, "GID6A");

    let story = new_story(&mut conn, &project_a.id, &actor_id, "Shared commit");
    let branch = story_branch_name(&story.key, &story.title);
    commit_on_branch(&repo_a, &branch, Some("run-shared"));
    let full_sha = head_sha(&repo_a);

    // repo_b is a real clone of repo_a — the SAME commit object (trailers included) exists in
    // both, proving genuine cross-repository ambiguity rather than two repositories that merely
    // happen to share a sha by construction.
    let repo_b = scratch.path().join("repo-b-clone");
    run_git_ok(scratch.path(), &["clone", repo_a.to_str().unwrap(), repo_b.to_str().unwrap()]);
    let (_actor_id_b, _project_b) =
        open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo_b, "GID6B");

    let outcome = resolve_identifier(&conn, &GitIdentifier::Sha(full_sha)).expect("resolve_identifier");
    assert_eq!(outcome, ResolveOutcome::AmbiguousAcrossRepositories { repositories: 2 });
}

#[test]
fn resolve_identifier_for_a_sha_present_in_no_repository_returns_not_found() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (_actor_id, _project) = open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo, "GID7");

    let fabricated = "f".repeat(40);
    let outcome = resolve_identifier(&conn, &GitIdentifier::Sha(fabricated)).expect("resolve_identifier");
    assert_eq!(outcome, ResolveOutcome::NotFound);
}

#[test]
fn resolve_identifier_is_deterministic_across_two_calls_on_unchanged_input() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let mut conn = open_scratch_db();
    let (actor_id, project) = open_registered_project(scratch.path(), runtime.path(), &mut conn, &repo, "GID8");

    let story = new_story(&mut conn, &project.id, &actor_id, "Deterministic resolve");
    let branch = story_branch_name(&story.key, &story.title);
    commit_on_branch(&repo, &branch, Some("run-det"));
    let full_sha = head_sha(&repo);

    let first = resolve_identifier(&conn, &GitIdentifier::Sha(full_sha.clone())).expect("resolve_identifier");
    let second = resolve_identifier(&conn, &GitIdentifier::Sha(full_sha)).expect("resolve_identifier");
    assert_eq!(first, second);
}
