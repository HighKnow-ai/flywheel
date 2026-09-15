//! The explicit-absolute-path git wrapper (PROC-02): the ONE place in this workspace that
//! constructs a `Command::new("git")`. `packages/core/tests/supervisor_cwd.rs` (plan 02-01 Task 3)
//! asserts this structurally — every other module that needs git shells out through here, never by
//! constructing its own `Command`.
//!
//! Every call passes `-C <repo_path>` as the FIRST two arguments, before any subcommand token, so
//! no subcommand can be misinterpreted as the path (PROC-02 ordering). `repo_path`/`args` are
//! validated non-empty before a process is ever spawned (PROC-02 empty). Every error is an
//! `anyhow::Error`, matching this crate's established `domain::task`/`domain::project` idiom —
//! non-zero git exit status becomes an `Err` carrying git's own stderr, never a silently-ignored
//! `Output`.

use std::path::Path;
use std::process::{Command, Output};

use anyhow::{anyhow, bail, Context};

/// The root every Flywheel-managed worktree lives under (D-23): `~/Flywheel/`, unless overridden
/// by `FLYWHEEL_WORKTREE_ROOT` — a test-only seam (see `crate::domain::worktree::worktree_root`),
/// never a user setting. [`worktree_add`] refuses to create a worktree outside this root.
pub fn worktree_root_from_env() -> std::path::PathBuf {
    if let Some(root) = std::env::var_os("FLYWHEEL_WORKTREE_ROOT") {
        return std::path::PathBuf::from(root);
    }
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Flywheel")
}

/// Run `git -C <repo_path> <args>`, returning the raw [`Output`] on a zero exit status.
/// Non-zero exit becomes an `Err` carrying git's own stderr — never a silently-ignored `Output`.
/// Rejects an empty `repo_path` or an empty `args` slice before spawning (PROC-02 empty).
pub fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("git_at refused: repo_path must not be empty");
    }
    if args.is_empty() {
        bail!("git_at refused: args must not be empty");
    }

    // `-C <repo_path>` is always the first two arguments, before any subcommand (PROC-02
    // ordering) — this crate's one and only `Command::new("git")` construction.
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to spawn git -C {repo_path:?} {args:?}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "git -C {repo_path:?} {args:?} failed (exit {:?}): {stderr}",
            output.status.code()
        ));
    }

    Ok(output)
}

/// `true` if `ref_name` resolves to a real ref/commit in `repo_path`, `false` otherwise. Never
/// errors on "ref does not exist" — that is exactly what `false` means; only a genuine failure to
/// invoke git at all propagates as an `Err`.
pub fn rev_parse_verify(repo_path: &Path, ref_name: &str) -> anyhow::Result<bool> {
    if repo_path.as_os_str().is_empty() {
        bail!("rev_parse_verify refused: repo_path must not be empty");
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--quiet", ref_name])
        .output()
        .with_context(|| format!("failed to spawn git -C {repo_path:?} rev-parse --verify {ref_name:?}"))?;
    Ok(output.status.success())
}

/// Create a worktree at `worktree_path` on a new branch `branch`, based on `base_ref`, inside
/// `repo_path`. Refuses (without spawning `git worktree add`) when:
/// - `worktree_path` equals `repo_path` (PROC-02 adjacency)
/// - `worktree_path` is not under the Flywheel worktree root (PROC-02 adjacency)
/// - `branch` already exists in the repository — the error text names the existing ref
///   (LINK-01 adjacency)
pub fn worktree_add(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
    base_ref: &str,
) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("worktree_add refused: repo_path must not be empty");
    }
    if worktree_path == repo_path {
        bail!("worktree_add refused: worktree_path {worktree_path:?} equals repo_path");
    }
    let root = worktree_root_from_env();
    if !worktree_path.starts_with(&root) {
        bail!(
            "worktree_add refused: worktree_path {worktree_path:?} is not under the Flywheel worktree root {root:?}"
        );
    }
    if rev_parse_verify(repo_path, branch)? {
        bail!("worktree_add refused: branch {branch:?} already exists in {repo_path:?}");
    }

    let worktree_path_str = worktree_path.to_string_lossy().into_owned();
    git_at(
        repo_path,
        &["worktree", "add", &worktree_path_str, "-b", branch, base_ref],
    )
}

/// The raw stdout of `git worktree list` in `repo_path`, one line per worktree. Callers that need
/// to assert a specific worktree is listed parse/search this text themselves — this function does
/// no parsing of its own, since the tracer test's assertion is "the derived branch appears in the
/// output," not a structured read.
pub fn worktree_list(repo_path: &Path) -> anyhow::Result<String> {
    let output = git_at(repo_path, &["worktree", "list"])?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The raw stdout of `git status --porcelain` in `worktree_path`, one line per dirty entry — no
/// parsing of its own (mirrors [`worktree_list`]'s "no parsing, caller's job" convention above).
/// An empty string means a clean tree. This is the ONE porcelain read in the workspace
/// (`domain::worktree::porcelain_entries` is the sole caller) — `WORK-03`'s ordering risk (D-43)
/// is closed by re-invoking this function inside `remove_worktree_for_task` itself rather than
/// trusting a caller's earlier read.
pub fn git_status_porcelain(worktree_path: &Path) -> anyhow::Result<String> {
    let output = git_at(worktree_path, &["status", "--porcelain"])?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Remove a worktree (WORK-03, D-41/D-42/D-43). Takes exactly two path parameters and no boolean,
/// option or flag of any kind — there is no parameter a caller could set to skip the dirty-tree
/// guard (D-43's "no escape hatch"). That guard itself lives one layer up, in
/// `domain::worktree::remove_worktree_for_task`, which re-reads porcelain and refuses BEFORE ever
/// calling this function — by the time this function runs, the caller has already verified the
/// tree is clean. This function performs only the same adjacency refusals [`worktree_add`]
/// already establishes, never a dirty-tree check of its own:
/// - `worktree_path` equals `repo_path`, or either path is empty (PROC-02 adjacency/empty)
/// - `worktree_path` is not under the Flywheel worktree root (PROC-02 adjacency)
pub fn worktree_remove(repo_path: &Path, worktree_path: &Path) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("worktree_remove refused: repo_path must not be empty");
    }
    if worktree_path.as_os_str().is_empty() {
        bail!("worktree_remove refused: worktree_path must not be empty");
    }
    if worktree_path == repo_path {
        bail!("worktree_remove refused: worktree_path {worktree_path:?} equals repo_path");
    }
    let root = worktree_root_from_env();
    if !worktree_path.starts_with(&root) {
        bail!(
            "worktree_remove refused: worktree_path {worktree_path:?} is not under the Flywheel worktree root {root:?}"
        );
    }

    let worktree_path_str = worktree_path.to_string_lossy().into_owned();
    git_at(repo_path, &["worktree", "remove", &worktree_path_str])
}
