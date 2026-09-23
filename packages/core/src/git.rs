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

/// Spawn `git -C <repo_path> <args>` and return the raw [`Output`] regardless of exit status —
/// this crate's one and only `Command::new("git")` construction (`packages/core/tests/
/// supervisor_cwd.rs`'s own single-construction-site property, extended by plan 04-07 Task 1 to
/// cover this file's two callers rather than just [`git_at`]). `-C <repo_path>` is always the
/// first two arguments, before any subcommand (PROC-02 ordering). [`git_at`] wraps this with the
/// "non-zero exit is an `Err`" policy; [`rev_parse_verify`] wraps it with the "non-zero exit means
/// `false`" policy — both policies belong to the caller, never to this function.
fn spawn_git(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to spawn git -C {repo_path:?} {args:?}"))
}

/// Run `git -C <repo_path> <args>`, returning the raw [`Output`] on a zero exit status.
/// Non-zero exit becomes an `Err` carrying git's own stderr — never a silently-ignored `Output`.
/// Rejects an empty `repo_path` or an empty `args` slice before spawning (PROC-02 empty).
///
/// D-51/D-54 (plan 03-04): a lock-shaped failure (per `git_retry::is_lock_contention`) is retried
/// through `git_retry::with_lock_retry` — the SAME policy the PATH shim binary uses — before ever
/// surfacing as an error. The single [`spawn_git`] construction below is unchanged from before
/// this plan and still runs exactly once per attempt; `packages/core/tests/supervisor_cwd.rs`
/// asserts it is the only such construction in this crate. A non-lock failure (a real git error)
/// is returned unchanged after exactly one invocation — its message reads as itself, unaffected by
/// the retry wrapper.
pub fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("git_at refused: repo_path must not be empty");
    }
    if args.is_empty() {
        bail!("git_at refused: args must not be empty");
    }

    let label = format!("git -C {repo_path:?} {args:?}");
    let outcome = crate::git_retry::with_lock_retry(&label, |_attempt| {
        let output = spawn_git(repo_path, args)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "git -C {repo_path:?} {args:?} failed (exit {:?}): {stderr}",
                output.status.code()
            ));
        }

        Ok(output)
    })?;

    Ok(outcome.value)
}

/// `true` if `ref_name` resolves to a real ref/commit in `repo_path`, `false` otherwise. Never
/// errors on "ref does not exist" — that is exactly what `false` means; only a genuine failure to
/// invoke git at all propagates as an `Err`.
pub fn rev_parse_verify(repo_path: &Path, ref_name: &str) -> anyhow::Result<bool> {
    if repo_path.as_os_str().is_empty() {
        bail!("rev_parse_verify refused: repo_path must not be empty");
    }
    let output = spawn_git(repo_path, &["rev-parse", "--verify", "--quiet", ref_name])?;
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

/// One `git diff` read's stat text and changed-path list (D-70/D-71) — the shape the context
/// packet carries for the "committed since base" half of the diff-so-far section: a stat block
/// and a path list, never a hunk body. `stat` is git's own `--stat` output, byte for byte;
/// `changed_paths` is `--name-only`'s output split into individual paths.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffStat {
    pub stat: String,
    pub changed_paths: Vec<String>,
}

/// The stat text and changed-path list for the symmetric-difference range `<base_ref>...HEAD`
/// (D-71, PROC-02) — the changes on this branch since it diverged from `base_ref`, never every
/// change on either side. Two calls through [`git_at`] (never a second `Command::new("git")`
/// construction site), mirroring [`git_status_porcelain`]'s exact one-line-body convention: `git
/// diff --stat <range>` for the stat text, `git diff --name-only <range>` for the path list. The
/// only parsing this function performs is splitting the name-only text on `'\n'` and dropping
/// empty elements — mirrors [`worktree_list`]'s own "no parsing of its own" note. A base ref that
/// does not resolve returns an `Err` carrying git's own stderr, never an empty success; a branch
/// with nothing ahead of its base returns `Ok` with both fields empty, never an error.
///
/// D-71: the stat and the path list are what the packet carries, never hunk bodies — the agent is
/// standing in the worktree it is briefed about, and the packet's size must depend only on how
/// many files changed, not on how large any one change is.
pub fn diff_stat_and_names(repo_path: &Path, base_ref: &str) -> anyhow::Result<DiffStat> {
    let range = format!("{base_ref}...HEAD");

    let stat_output = git_at(repo_path, &["diff", "--stat", &range])?;
    let stat = String::from_utf8_lossy(&stat_output.stdout).into_owned();

    let names_output = git_at(repo_path, &["diff", "--name-only", &range])?;
    let names_text = String::from_utf8_lossy(&names_output.stdout).into_owned();
    let changed_paths: Vec<String> =
        names_text.split('\n').filter(|line| !line.is_empty()).map(str::to_string).collect();

    Ok(DiffStat { stat, changed_paths })
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

/// The concrete git version plan 03-08's lock-contention reproduction
/// (`packages/core/tests/lock_contention.rs`) was ACTUALLY executed against, rounded down to its
/// minor line. 03-RESEARCH.md's own assumption A1 proposed an older, unbisected 2.44 floor; this
/// constant deliberately replaces that guess with a measured one — this phase can only claim the
/// floor it actually exercised, and claiming an unbisected older version would record an
/// assumption as a guarantee. Lowering this constant requires re-running
/// `cargo test -p core --test lock_contention` against the lower version first.
pub const MIN_SUPPORTED_GIT: (u32, u32, u32) = (2, 54, 0);

/// Parse the numeric `(major, minor, patch)` triple out of the FIRST whitespace-delimited token in
/// `stdout` that looks like `<digits>.<digits>.<digits>...` — positional extraction, so a
/// vendor-suffixed string ("git version 2.39.5 (Apple Git-154)") parses correctly without ever
/// depending on splitting the whole line by whitespace count or parentheses.
fn parse_git_version_str(stdout: &str) -> anyhow::Result<(u32, u32, u32)> {
    for word in stdout.split_whitespace() {
        let cleaned: String = word.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let parts: Vec<&str> = cleaned.split('.').collect();
        if parts.len() >= 3 {
            if let (Ok(major), Ok(minor), Ok(patch)) =
                (parts[0].parse::<u32>(), parts[1].parse::<u32>(), parts[2].parse::<u32>())
            {
                return Ok((major, minor, patch));
            }
        }
    }
    bail!("could not parse a major.minor.patch triple out of git version output: {stdout:?}")
}

/// The installed git's version as a numeric `(major, minor, patch)` triple, routed through
/// [`git_at`] (never a second `Command::new("git")` construction site) as `git -C . --version` —
/// `--version` needs no real repository, so `.` is a valid `repo_path` regardless of this
/// process's own working directory. Returns a named error when the version string's shape is
/// unrecognised — never a default fallback, since silently defaulting would report a floor this
/// call never actually checked.
pub fn git_version() -> anyhow::Result<(u32, u32, u32)> {
    let output = git_at(Path::new("."), &["--version"]).context("failed to run git --version")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_git_version_str(&stdout)
}

#[cfg(test)]
mod git_version_tests {
    use super::*;

    #[test]
    fn vendor_suffixed_version_string_parses_to_the_right_triple() {
        let parsed = parse_git_version_str("git version 2.39.5 (Apple Git-154)")
            .expect("a vendor-suffixed version string should parse");
        assert_eq!(parsed, (2, 39, 5));
    }

    #[test]
    fn min_supported_git_is_referenced_and_shaped_like_a_real_version() {
        // Referenced here (not just declared above) so a change to MIN_SUPPORTED_GIT that breaks
        // its own documented shape is caught by this suite, not just by inspection.
        let (major, minor, _patch) = MIN_SUPPORTED_GIT;
        assert!(major >= 2, "expected a modern git major version, got {major}");
        assert!(minor <= 999, "expected a plausible minor version, got {minor}");
    }

    #[test]
    fn git_version_succeeds_against_the_installed_git() {
        git_version().expect("git_version should succeed against whatever git is installed");
    }
}
