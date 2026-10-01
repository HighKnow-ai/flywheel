//! Phase 12, plan 12-02, Tasks 1-2: Layer 3 — git's own `pre-push` hook, end to end against a
//! real throwaway local bare remote (D-63), plus every way the install can decline.
//!
//! D-63 — THE ONLY REMOTE THIS FILE MAY EVER TOUCH IS THE LOCAL BARE REPOSITORY EACH FIXTURE
//! CREATES INSIDE ITS OWN SCRATCH DIRECTORY. Never a network remote, never a named upstream.

use core::destructive::DestructiveCategory;
use core::domain::actor::local_human_actor_id;
use core::domain::project::register_project;
use core::git_hooks::{
    hooks_dir_for_repo, install_pre_push_hook, interception_layers_for, pre_push_hook_script,
    uninstall_pre_push_hook, PrePushInstall, PRE_PUSH_MARKER,
};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Serializes every call to [`with_scratch_envs`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT` and
/// `FLYWHEEL_RUNTIME_DIR` are process-global mutable state, and `cargo test` runs a binary's
/// `#[test]` fns concurrently by default (mirrors `permission_gate.rs`'s own
/// `WORKTREE_ROOT_ENV_LOCK`; this file's own static cannot race with that one — each `tests/*.rs`
/// file compiles to its own binary).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Set `FLYWHEEL_WORKTREE_ROOT` and `FLYWHEEL_RUNTIME_DIR` for the duration of `f`, serialized
/// against every other caller in this binary, so no test's `register_project`/`install_pre_push_
/// hook` call ever touches the real `~/Flywheel` worktree root or the real app-data runtime
/// directory.
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

/// A real `git init`-ed, config'd repository with no remote — enough for `install_pre_push_hook`
/// tests that never need to push.
fn fresh_repo(root: &Path) -> PathBuf {
    let dir = tempfile::tempdir_in(root).expect("failed to create scratch repo dir");
    let repo = dir.path().to_path_buf();
    std::mem::forget(dir);
    run_git_ok(root, &["init", "--initial-branch", "main", repo.to_str().unwrap()]);
    run_git_ok(&repo, &["config", "user.email", "git-hooks-test@flywheel.invalid"]);
    run_git_ok(&repo, &["config", "user.name", "Flywheel Git Hooks Test"]);
    repo
}

struct RemoteFixture {
    remote_path: PathBuf,
    work_path: PathBuf,
}

/// Build a throwaway bare remote plus a work tree, mirroring `createRepoWithRemote`
/// (`scripts/uat/lib/sidecar-harness.mjs`): bare init, work init, user email/name config, a
/// README commit, `remote add origin`, `push -u origin main`, then one push per `extra_branches`
/// entry.
fn create_repo_with_remote(root: &Path, extra_branches: &[&str]) -> RemoteFixture {
    let remote_path = root.join("remote.git");
    let work_path = root.join("work");

    run_git_ok(root, &["init", "--bare", "--initial-branch", "main", remote_path.to_str().unwrap()]);
    run_git_ok(root, &["init", "--initial-branch", "main", work_path.to_str().unwrap()]);
    run_git_ok(&work_path, &["config", "user.email", "git-hooks-test@flywheel.invalid"]);
    run_git_ok(&work_path, &["config", "user.name", "Flywheel Git Hooks Test"]);
    std::fs::write(work_path.join("README.md"), "# git_hooks_pre_push.rs scratch repo\n")
        .expect("failed to write README");
    run_git_ok(&work_path, &["add", "README.md"]);
    run_git_ok(&work_path, &["commit", "-m", "initial commit"]);
    run_git_ok(&work_path, &["remote", "add", "origin", remote_path.to_str().unwrap()]);
    run_git_ok(&work_path, &["push", "-u", "origin", "main"]);

    for branch in extra_branches {
        run_git_ok(&work_path, &["branch", branch]);
        run_git_ok(&work_path, &["push", "origin", branch]);
    }

    RemoteFixture { remote_path, work_path }
}

fn remote_ref(remote_path: &Path, branch: &str) -> Option<String> {
    let output = run_git(remote_path, &["rev-parse", "--verify", &format!("refs/heads/{branch}")]);
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Register `work_path` as a real Flywheel project (so the `pre-push` hook arrives by the real
/// install path, never a test-only shortcut) and return the project id.
fn register(worktree_root: &Path, runtime_dir: &Path, work_path: &Path, key_prefix: &str) -> String {
    with_scratch_envs(worktree_root, runtime_dir, || {
        let db_dir = tempfile::tempdir().expect("failed to create scratch db dir");
        let db_path = db_dir.path().join("flywheel.db");
        let backups_dir = db_dir.path().join("backups");
        std::mem::forget(db_dir);
        let mut conn = core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate");
        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
        let project = register_project(&mut conn, &actor_id, work_path, "Git Hooks Fixture", key_prefix)
            .expect("register_project should succeed");
        project.id
    })
}

/// A hostile `PATH` that cannot contain Flywheel's shim directory — a minimal, real Unix PATH,
/// deliberately not constructed by prefixing a shim directory onto anything.
const HOSTILE_PATH: &str = "/usr/bin:/bin";

/// Spawn `git <args>` in `repo` through the SYSTEM git binary resolved once via
/// [`core::shim::resolve_real_git`] (an absolute-path invocation, so Rust's own program lookup
/// never consults `PATH` either), with `PATH` overridden to [`HOSTILE_PATH`] and
/// `FLYWHEEL_PERMISSION_SOCKET` removed from the child's environment — proving the refusal below
/// does not depend on either.
fn run_git_hostile(repo: &Path, args: &[&str]) -> Output {
    let real_git = core::shim::resolve_real_git().expect("resolve_real_git should succeed in this environment");
    Command::new(&real_git)
        .current_dir(repo)
        .env("PATH", HOSTILE_PATH)
        .env_remove("FLYWHEEL_PERMISSION_SOCKET")
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn {real_git:?} {args:?} with a hostile env: {e}"))
}

// --- Task 1: the end-to-end slice ------------------------------------------------------------

#[test]
fn branch_deletion_push_is_refused_and_the_remote_ref_survives() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    const DOOMED_BRANCH: &str = "doomed-branch";
    let fixture = create_repo_with_remote(scratch.path(), &[DOOMED_BRANCH]);
    register(scratch.path(), runtime.path(), &fixture.work_path, "GHP1");

    let before = remote_ref(&fixture.remote_path, DOOMED_BRANCH);
    assert!(before.is_some(), "expected the extra branch to exist on the remote before the refused push");

    let output = run_git_hostile(&fixture.work_path, &["push", "origin", "--delete", DOOMED_BRANCH]);
    assert!(
        !output.status.success(),
        "expected `git push origin --delete {DOOMED_BRANCH}` to be refused, but it exited 0. stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("branch-deletion"),
        "expected the refusal to name category branch-deletion, got stderr: {stderr}"
    );

    let after = remote_ref(&fixture.remote_path, DOOMED_BRANCH);
    assert_eq!(
        before, after,
        "the remote ref must still resolve unchanged after the refused deletion — before={before:?} after={after:?}"
    );
}

#[test]
fn force_push_is_refused_and_the_remote_ref_is_unchanged() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    const REWRITE_BRANCH: &str = "rewrite-branch";
    let fixture = create_repo_with_remote(scratch.path(), &[REWRITE_BRANCH]);
    register(scratch.path(), runtime.path(), &fixture.work_path, "GHP2");

    let before = remote_ref(&fixture.remote_path, REWRITE_BRANCH).expect("branch should exist on the remote");

    // Rewrite history on the branch so the new tip does not descend from the remote's tip: amend
    // the branch's current (root) commit in place, producing a new object name with the same
    // parent — a sibling of the old tip, not a descendant of it.
    run_git_ok(&fixture.work_path, &["checkout", REWRITE_BRANCH]);
    run_git_ok(&fixture.work_path, &["commit", "--amend", "--allow-empty", "-m", "rewritten history"]);

    let output =
        run_git_hostile(&fixture.work_path, &["push", "--force", "origin", REWRITE_BRANCH]);
    assert!(
        !output.status.success(),
        "expected the force-push to be refused, but it exited 0. stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("force-push"),
        "expected the refusal to name category force-push, got stderr: {stderr}"
    );

    let after = remote_ref(&fixture.remote_path, REWRITE_BRANCH);
    assert_eq!(
        Some(before.clone()),
        after,
        "the remote ref's object name must be byte-identical before and after the refused force-push — before={before:?} after={after:?}"
    );
}

#[test]
fn ordinary_fast_forward_push_succeeds_and_the_remote_ref_advances() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let fixture = create_repo_with_remote(scratch.path(), &[]);
    register(scratch.path(), runtime.path(), &fixture.work_path, "GHP3");

    let before = remote_ref(&fixture.remote_path, "main").expect("main should exist on the remote");

    std::fs::write(fixture.work_path.join("second.txt"), "second commit\n").unwrap();
    run_git_ok(&fixture.work_path, &["add", "second.txt"]);
    run_git_ok(&fixture.work_path, &["commit", "-m", "second commit"]);

    let output = run_git_hostile(&fixture.work_path, &["push", "origin", "main"]);
    assert!(
        output.status.success(),
        "expected an ordinary fast-forward push to succeed. stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let after = remote_ref(&fixture.remote_path, "main").expect("main should still exist on the remote");
    assert_ne!(before, after, "the remote's main ref should have advanced to the new object name");
}

#[test]
fn status_and_version_exit_zero_with_no_flywheel_refusal_text() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let fixture = create_repo_with_remote(scratch.path(), &[]);
    register(scratch.path(), runtime.path(), &fixture.work_path, "GHP4");

    for args in [vec!["status", "--porcelain"], vec!["--version"]] {
        let output = run_git_hostile(&fixture.work_path, &args);
        assert!(
            output.status.success(),
            "expected `git {args:?}` to exit 0 in the hooked repository. stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!stderr.contains("flywheel"), "expected no Flywheel refusal text on stderr for `git {args:?}`, got: {stderr}");
    }
}

#[test]
fn branch_deletion_push_from_outside_the_worktree_root_is_not_gated() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    const DOOMED_BRANCH: &str = "doomed-branch-outside";
    let fixture = create_repo_with_remote(scratch.path(), &[DOOMED_BRANCH]);
    let hooks_path_value = {
        register(scratch.path(), runtime.path(), &fixture.work_path, "GHP5");
        let output = run_git(&fixture.work_path, &["config", "--get", "core.hooksPath"]);
        assert!(output.status.success(), "expected core.hooksPath to be configured after registration");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    // A second scratch repository, OUTSIDE this test's FLYWHEEL_WORKTREE_ROOT (a sibling temp
    // root, never nested under `scratch`), configured with the SAME core.hooksPath.
    let outside_scratch = tempfile::tempdir().expect("outside scratch dir");
    let outside = create_repo_with_remote(outside_scratch.path(), &[DOOMED_BRANCH]);
    run_git_ok(&outside.work_path, &["config", "core.hooksPath", &hooks_path_value]);

    let output = run_git_hostile(&outside.work_path, &["push", "origin", "--delete", DOOMED_BRANCH]);
    assert!(
        output.status.success(),
        "expected a branch-deletion push from OUTSIDE the worktree root to exit 0 (the developer's own terminal is never gated). stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn generated_script_shape_is_posix_and_carries_the_marker() {
    let script = pre_push_hook_script(
        Path::new("/usr/bin/git"),
        Path::new("/tmp/flywheel-shim/git"),
        Path::new("/tmp/flywheel-worktrees"),
    );

    assert!(script.starts_with("#!/bin/sh\n"), "expected the script's first line to be #!/bin/sh, got: {script}");
    assert!(script.contains(PRE_PUSH_MARKER), "expected the header comment to carry {PRE_PUSH_MARKER}");
    // "[[ " and "=~" are unambiguous bash-only syntax; "local"/"function" are deliberately NOT
    // checked here — this script's own English comments use both words in ordinary prose ("the
    // local object name", "this function is...") and a substring check would false-positive on
    // its own documentation, not on actual shell syntax.
    for bashism in ["[[ ", "=~"] {
        assert!(!script.contains(bashism), "expected no bash-only syntax ({bashism:?}) in the generated script");
    }
}

#[test]
fn generated_script_all_zero_test_is_a_pattern_not_a_hardcoded_literal() {
    let script = pre_push_hook_script(
        Path::new("/usr/bin/git"),
        Path::new("/tmp/flywheel-shim/git"),
        Path::new("/tmp/flywheel-worktrees"),
    );
    let forty_zeroes = "0".repeat(40);
    assert!(
        !script.contains(&forty_zeroes),
        "expected no run of 40 consecutive '0' characters in the generated script (the all-zeroes check must be a pattern test)"
    );
}

#[test]
fn install_fails_loudly_when_the_hook_file_is_removed_before_verification() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let project_id = "GHP-RACE-1";

    with_scratch_envs(scratch.path(), runtime.path(), || {
        let hook_path = hooks_dir_for_repo(project_id).expect("hooks_dir_for_repo").join("pre-push");

        // Watches for the hook file install writes and deletes it the instant it appears — the
        // config write that follows (step 5) spawns a `git` subprocess, which comfortably
        // outlasts this tight poll loop, making the race reliable rather than flaky.
        let watcher = std::thread::spawn({
            let hook_path = hook_path.clone();
            move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
                while std::time::Instant::now() < deadline {
                    if hook_path.is_file() {
                        let _ = std::fs::remove_file(&hook_path);
                        return true;
                    }
                    std::thread::sleep(std::time::Duration::from_micros(50));
                }
                false
            }
        });

        let result = install_pre_push_hook(&repo, project_id);
        let deleted = watcher.join().expect("watcher thread should not panic");
        assert!(deleted, "the watcher never observed the hook file being written — test setup is broken");

        let err = result.expect_err("install_pre_push_hook should fail when the hook file disappears before verification");
        let rendered = format!("{err:#}");
        assert!(
            rendered.contains("pre-push gate install verification failed"),
            "expected the verification-failure prefix, got: {rendered}"
        );
    });
}

// --- Task 2: the install's failure modes -----------------------------------------------------

#[test]
fn install_refuses_a_preexisting_non_flywheel_hooks_path_without_displacing_it() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let developer_hooks_dir = scratch.path().join("developer-own-hooks");
    std::fs::create_dir_all(&developer_hooks_dir).expect("failed to create developer hooks dir");
    run_git_ok(&repo, &["config", "core.hooksPath", developer_hooks_dir.to_str().unwrap()]);

    let project_id = "GHP-REFUSE-1";
    with_scratch_envs(scratch.path(), runtime.path(), || {
        let result =
            install_pre_push_hook(&repo, project_id).expect("install_pre_push_hook should not error on a refusal path");
        match result {
            PrePushInstall::RefusedPreexistingHooksPath { existing } => {
                assert_eq!(existing, developer_hooks_dir.to_string_lossy());
            }
            other => panic!("expected RefusedPreexistingHooksPath, got {other:?}"),
        }

        let readback = run_git(&repo, &["config", "--get", "core.hooksPath"]);
        assert_eq!(
            String::from_utf8_lossy(&readback.stdout).trim(),
            developer_hooks_dir.to_string_lossy(),
            "core.hooksPath must still read back as the developer's own value"
        );

        let hooks_dir = hooks_dir_for_repo(project_id).expect("hooks_dir_for_repo");
        assert!(
            !hooks_dir.join("pre-push").exists(),
            "no file should be written under hooks_dir_for_repo when the install refuses"
        );
    });
}

#[test]
fn install_refuses_a_preexisting_non_sample_pre_push_without_displacing_it() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());

    let default_hooks_dir = {
        let output = run_git_ok(&repo, &["rev-parse", "--git-path", "hooks"]);
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let p = Path::new(&raw);
        if p.is_absolute() { p.to_path_buf() } else { repo.join(p) }
    };
    std::fs::create_dir_all(&default_hooks_dir).expect("failed to create default hooks dir");
    let developer_hook_path = default_hooks_dir.join("pre-push");
    let developer_hook_contents = "#!/bin/sh\necho 'the developer wrote this hook'\nexit 0\n";
    std::fs::write(&developer_hook_path, developer_hook_contents).expect("failed to write developer hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&developer_hook_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&developer_hook_path, perms).unwrap();
    }

    let project_id = "GHP-REFUSE-2";
    with_scratch_envs(scratch.path(), runtime.path(), || {
        let result =
            install_pre_push_hook(&repo, project_id).expect("install_pre_push_hook should not error on a refusal path");
        match result {
            PrePushInstall::RefusedPreexistingPrePush { path } => {
                assert_eq!(path, developer_hook_path);
            }
            other => panic!("expected RefusedPreexistingPrePush, got {other:?}"),
        }

        let readback = run_git(&repo, &["config", "--get", "core.hooksPath"]);
        assert!(
            !readback.status.success(),
            "core.hooksPath must remain unset when the install refuses over a pre-existing pre-push"
        );

        let after = std::fs::read_to_string(&developer_hook_path).expect("developer hook should still exist");
        assert_eq!(after, developer_hook_contents, "the developer's hook file must be byte-identical afterwards");
    });
}

#[test]
fn a_refusal_never_fails_registration() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let fixture = create_repo_with_remote(scratch.path(), &[]);
    run_git_ok(&fixture.work_path, &["config", "core.hooksPath", scratch.path().join("developer-hooks").to_str().unwrap()]);
    std::fs::create_dir_all(scratch.path().join("developer-hooks")).unwrap();

    with_scratch_envs(scratch.path(), runtime.path(), || {
        let db_dir = tempfile::tempdir().expect("db dir");
        let db_path = db_dir.path().join("flywheel.db");
        let backups_dir = db_dir.path().join("backups");
        std::mem::forget(db_dir);
        let mut conn = core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate");
        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");

        let project = register_project(&mut conn, &actor_id, &fixture.work_path, "Refused Project", "GHP6")
            .expect("register_project must succeed even when the pre-push install refuses");

        assert!(!project.id.is_empty(), "expected a fully populated project id");
        assert_eq!(project.key_prefix, "GHP6");
        assert_eq!(project.name, "Refused Project");
        assert!(!project.repo_path.is_empty(), "expected a fully populated repo_path");
        assert_eq!(project.status, "active");
    });
}

#[test]
fn a_refusal_never_fails_registration_over_a_preexisting_pre_push() {
    // The companion to `a_refusal_never_fails_registration` above — that test covers the
    // pre-existing-`core.hooksPath` refusal arm, this one covers the pre-existing-`pre-push`
    // refusal arm. The plan's acceptance criterion is "with EITHER refusal condition in place",
    // so both arms need their own registration proof, not just one.
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let fixture = create_repo_with_remote(scratch.path(), &[]);

    let default_hooks_dir = {
        let output = run_git_ok(&fixture.work_path, &["rev-parse", "--git-path", "hooks"]);
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let p = Path::new(&raw);
        if p.is_absolute() { p.to_path_buf() } else { fixture.work_path.join(p) }
    };
    std::fs::create_dir_all(&default_hooks_dir).expect("failed to create default hooks dir");
    let developer_hook_path = default_hooks_dir.join("pre-push");
    std::fs::write(&developer_hook_path, "#!/bin/sh\nexit 0\n").expect("failed to write developer hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&developer_hook_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&developer_hook_path, perms).unwrap();
    }

    with_scratch_envs(scratch.path(), runtime.path(), || {
        let db_dir = tempfile::tempdir().expect("db dir");
        let db_path = db_dir.path().join("flywheel.db");
        let backups_dir = db_dir.path().join("backups");
        std::mem::forget(db_dir);
        let mut conn = core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate");
        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");

        let project = register_project(&mut conn, &actor_id, &fixture.work_path, "Refused Project 2", "GHP8")
            .expect("register_project must succeed even when the pre-push install refuses over a pre-existing pre-push");

        assert!(!project.id.is_empty(), "expected a fully populated project id");
        assert_eq!(project.key_prefix, "GHP8");
        assert_eq!(project.name, "Refused Project 2");
        assert!(!project.repo_path.is_empty(), "expected a fully populated repo_path");
        assert_eq!(project.status, "active");
    });
}

#[test]
fn uninstall_unsets_core_hooks_path_it_wrote_and_is_a_no_op_for_a_foreign_value() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let fixture = create_repo_with_remote(scratch.path(), &[]);

    // `register` manages `with_scratch_envs` itself — called bare here (never nested inside a
    // second `with_scratch_envs`, since `std::sync::Mutex` is not re-entrant and a nested lock on
    // the same thread would deadlock).
    register(scratch.path(), runtime.path(), &fixture.work_path, "GHP7");

    let before = run_git_ok(&fixture.work_path, &["config", "--get", "core.hooksPath"]);
    assert!(!String::from_utf8_lossy(&before.stdout).trim().is_empty(), "expected core.hooksPath to be set after registration");

    let result = uninstall_pre_push_hook(&fixture.work_path);
    assert!(result.is_ok(), "uninstall_pre_push_hook should succeed: {result:?}");

    let after = run_git(&fixture.work_path, &["config", "--get", "core.hooksPath"]);
    assert!(!after.status.success(), "expected core.hooksPath to read back unset after uninstall");

    // No-op arm: a foreign core.hooksPath (pointing at a directory with no PRE_PUSH_MARKER
    // script) must never be unset by this function.
    let foreign_dir = scratch.path().join("foreign-hooks");
    std::fs::create_dir_all(&foreign_dir).unwrap();
    run_git_ok(&fixture.work_path, &["config", "core.hooksPath", foreign_dir.to_str().unwrap()]);

    let result = uninstall_pre_push_hook(&fixture.work_path);
    assert!(result.is_ok(), "uninstall_pre_push_hook should return Ok on the no-op arm too: {result:?}");

    let readback = run_git_ok(&fixture.work_path, &["config", "--get", "core.hooksPath"]);
    assert_eq!(
        String::from_utf8_lossy(&readback.stdout).trim(),
        foreign_dir.to_string_lossy(),
        "a foreign core.hooksPath must be left untouched"
    );
}

#[test]
fn a_pre_push_sample_file_alone_does_not_trigger_the_refusal() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());

    // Every fresh `git init` ships a `pre-push.sample` — assert it is present (the fixture is
    // real, not hand-waved) and that it alone never trips the refusal.
    let default_hooks_dir = {
        let output = run_git_ok(&repo, &["rev-parse", "--git-path", "hooks"]);
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let p = Path::new(&raw);
        if p.is_absolute() { p.to_path_buf() } else { repo.join(p) }
    };
    assert!(
        default_hooks_dir.join("pre-push.sample").is_file(),
        "expected a fresh git init to ship pre-push.sample at {default_hooks_dir:?}"
    );
    assert!(
        !default_hooks_dir.join("pre-push").exists(),
        "expected no real pre-push entry alongside the sample"
    );

    let project_id = "GHP-SAMPLE-1";
    with_scratch_envs(scratch.path(), runtime.path(), || {
        let result = install_pre_push_hook(&repo, project_id).expect("install_pre_push_hook should succeed");
        match result {
            PrePushInstall::Installed { .. } => {}
            other => panic!("expected Installed (a .sample file must never trigger the refusal), got {other:?}"),
        }
    });
}

// --- Coverage-mapping smoke check (full coverage lives in destructive_gate_layer_coverage.rs) -

#[test]
fn interception_layers_for_is_total_over_destructive_category() {
    for category in DestructiveCategory::all() {
        assert!(
            !interception_layers_for(category).is_empty(),
            "DestructiveCategory::{category:?} has no interception layer named for it"
        );
    }
}
