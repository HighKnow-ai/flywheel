//! LINK-08: a project with no forge remote degrades to local-only and spawns NOTHING at all —
//! proven by sabotage (a marker-file-writing `gh`/`glab` stub prepended to `PATH`), never by
//! reading the source — plus the stored `projects.forge` override forcing either direction
//! regardless of the repository's real origin host (D-119).

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use core::domain::settings::set_project_forge;
use core::forge::{forge_and_repo_path, forge_for_project, request_for_branch_at, Forge, ForgeError};

fn run_git(repo: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .status()
        .unwrap_or_else(|e| panic!("failed to spawn git -C {repo:?} {args:?}: {e}"));
    assert!(status.success(), "git -C {repo:?} {args:?} failed");
}

/// Serializes every test in this binary — `PATH` is process-global mutable state and `cargo test`
/// runs `#[test]` fns concurrently by default (mirrors `commit_msg_hook.rs`'s own `ENV_LOCK`; each
/// `tests/*.rs` file compiles to its own binary, so this static cannot race with that one).
/// Every test holds it for its WHOLE body, not just inside the `PATH` helpers: a test that spawns
/// `git` while another sits inside [`with_empty_path`] would otherwise find no `git` on `PATH`.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A handle onto the sabotaged-stub scratch directory. [`SabotageDir::invoked`] reports whether
/// the named CLI's stub actually ran, by checking the marker FILE it writes before exiting
/// non-zero — never by inspecting stdout/stderr, which this test's own caller does not observe.
struct SabotageDir {
    dir: tempfile::TempDir,
}

impl SabotageDir {
    fn invoked(&self, cli: &str) -> bool {
        self.dir.path().join(format!("{cli}.invoked")).exists()
    }
}

/// Write executable `gh`/`glab` shell stubs that each touch their own marker file and exit
/// non-zero, prepend their directory to `PATH` for the duration of `f` (the caller holds [`serial`]),
/// then restore the original `PATH` before returning. Proves
/// absence (or presence) of a spawn by sabotage — reading the marker file after `f` returns.
fn with_sabotaged_forge_clis<T>(f: impl FnOnce(&SabotageDir) -> T) -> T {

    let dir = tempfile::tempdir().expect("failed to create scratch stub dir");
    for cli in ["gh", "glab"] {
        let script_path = dir.path().join(cli);
        let marker_path = dir.path().join(format!("{cli}.invoked"));
        let script = format!("#!/bin/sh\ntouch '{}'\nexit 7\n", marker_path.display());
        std::fs::write(&script_path, script).expect("failed to write stub script");
        let mut perms = std::fs::metadata(&script_path).expect("stub metadata").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).expect("failed to chmod stub");
    }

    let original_path = std::env::var_os("PATH");
    let sabotaged = match &original_path {
        Some(p) => format!("{}:{}", dir.path().display(), p.to_string_lossy()),
        None => dir.path().display().to_string(),
    };
    // SAFETY: the caller holds `serial()`, which serializes every test in this binary, so no other
    // thread reads or mutates PATH while it's set, and this helper always restores it before returning.
    unsafe {
        std::env::set_var("PATH", &sabotaged);
    }

    let sabotage = SabotageDir { dir };
    let result = f(&sabotage);

    unsafe {
        match &original_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }
    result
}

/// Set `PATH` to an empty scratch directory (no `gh`/`glab` anywhere on it) for the duration of
/// `f` (the caller holds [`serial`]), then
/// restore the original `PATH`. Unlike [`with_sabotaged_forge_clis`] (proves a CLI was or was not
/// invoked), this proves what happens when the CLI genuinely cannot be found —
/// `ForgeError::CliNotInstalled`, the typed variant RESEARCH.md open question 3 names, which the
/// sabotage helper above can never exercise since its stub IS present on `PATH`.
fn with_empty_path<T>(f: impl FnOnce() -> T) -> T {
    let dir = tempfile::tempdir().expect("failed to create empty scratch PATH dir");
    let original_path = std::env::var_os("PATH");
    // SAFETY: the caller holds `serial()`, which serializes every test in this binary, so no other
    // thread reads or mutates PATH while it's set, and this helper always restores it before returning.
    unsafe {
        std::env::set_var("PATH", dir.path());
    }
    let result = f();
    unsafe {
        match &original_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }
    result
}

#[test]
fn no_origin_remote_resolves_to_local_forge() {
    let _serial = serial();
    let (conn, _actor_id, project, _repo_dir) = common::seeded_git_project();
    let forge = forge_for_project(&conn, &project.id).expect("forge_for_project should succeed");
    assert_eq!(forge, Forge::Local);
}

#[test]
fn no_origin_remote_spawns_no_forge_process_at_all() {
    let _serial = serial();
    let (conn, _actor_id, project, _repo_dir) = common::seeded_git_project();
    with_sabotaged_forge_clis(|sabotage| {
        let (forge, repo_path) = forge_and_repo_path(&conn, &project.id)
            .expect("forge_and_repo_path should succeed with no forge configured");
        assert_eq!(forge, Forge::Local, "no origin remote must resolve to local");
        let result = request_for_branch_at(forge, &repo_path, "main")
            .expect("request_for_branch_at should succeed with no forge configured");
        assert!(result.is_none());
        assert!(!sabotage.invoked("gh"), "gh must never be invoked for a local-only project");
        assert!(!sabotage.invoked("glab"), "glab must never be invoked for a local-only project");
    });
}

#[test]
fn stored_local_override_forces_local_even_with_github_origin() {
    let _serial = serial();
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    run_git(repo_dir.path(), &["remote", "add", "origin", "git@github.com:acme/widget.git"]);
    set_project_forge(&mut conn, &actor_id, &project.id, Some("local"))
        .expect("set_project_forge should succeed");

    let forge = forge_for_project(&conn, &project.id).expect("forge_for_project should succeed");
    assert_eq!(forge, Forge::Local);

    with_sabotaged_forge_clis(|sabotage| {
        let (forge, repo_path) = forge_and_repo_path(&conn, &project.id)
            .expect("forge_and_repo_path should succeed under a forced local override");
        assert_eq!(forge, Forge::Local, "the stored 'local' override must resolve to local");
        let result = request_for_branch_at(forge, &repo_path, "main")
            .expect("request_for_branch_at should succeed under a forced local override");
        assert!(result.is_none());
        assert!(!sabotage.invoked("gh"), "the stored 'local' override must suppress gh entirely");
        assert!(
            !sabotage.invoked("glab"),
            "the stored 'local' override must suppress glab entirely"
        );
    });
}

#[test]
fn stored_github_override_forces_github_path_even_for_self_hosted_host() {
    let _serial = serial();
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    run_git(
        repo_dir.path(),
        &["remote", "add", "origin", "https://git.acme-corp.example/widget/widget.git"],
    );
    set_project_forge(&mut conn, &actor_id, &project.id, Some("github"))
        .expect("set_project_forge should succeed");

    let forge = forge_for_project(&conn, &project.id).expect("forge_for_project should succeed");
    assert_eq!(forge, Forge::GitHub, "a 'github' override must win over a self-hosted origin host");

    with_sabotaged_forge_clis(|sabotage| {
        let (forge, repo_path) = forge_and_repo_path(&conn, &project.id)
            .expect("forge_and_repo_path should succeed for a github override");
        // The sabotaged `gh` stub exits non-zero, so this is an `Err` — the point of this test is
        // that `gh` was invoked AT ALL, which the stored override forces despite the self-hosted
        // origin host `detect_forge_from_origin` alone would never have matched to GitHub.
        let _ = request_for_branch_at(forge, &repo_path, "main");
        assert!(sabotage.invoked("gh"), "the stored 'github' override must dispatch to gh");
        assert!(!sabotage.invoked("glab"), "the 'github' override must never invoke glab");
    });
}

#[test]
fn forced_github_override_with_gh_absent_from_path_yields_cli_not_installed() {
    let _serial = serial();
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    run_git(repo_dir.path(), &["remote", "add", "origin", "git@github.com:acme/widget.git"]);
    set_project_forge(&mut conn, &actor_id, &project.id, Some("github"))
        .expect("set_project_forge should succeed");

    let (forge, repo_path) =
        forge_and_repo_path(&conn, &project.id).expect("forge_and_repo_path should succeed");
    with_empty_path(|| {
        let err = request_for_branch_at(forge, &repo_path, "main")
            .expect_err("gh absent from PATH must be a typed error, never a silent success");
        assert!(
            matches!(err, ForgeError::CliNotInstalled { cli: "gh" }),
            "expected CliNotInstalled, got {err:?}"
        );
    });
}

#[test]
fn forced_gitlab_override_with_glab_absent_from_path_yields_cli_not_installed() {
    let _serial = serial();
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    run_git(repo_dir.path(), &["remote", "add", "origin", "git@gitlab.com:acme/widget.git"]);
    set_project_forge(&mut conn, &actor_id, &project.id, Some("gitlab"))
        .expect("set_project_forge should succeed");

    let (forge, repo_path) =
        forge_and_repo_path(&conn, &project.id).expect("forge_and_repo_path should succeed");
    with_empty_path(|| {
        let err = request_for_branch_at(forge, &repo_path, "main")
            .expect_err("glab absent from PATH must be a typed error, never a silent success");
        assert!(
            matches!(err, ForgeError::CliNotInstalled { cli: "glab" }),
            "expected CliNotInstalled, got {err:?}"
        );
    });
}
