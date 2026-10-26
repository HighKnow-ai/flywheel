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
//!
//! The wait is bounded by `proc::GIT_TIMEOUT_SECS` (code review WR-02): a `git` invocation that
//! never exits is killed and surfaces as an `Err` after that ceiling instead of hanging forever.
//! A timeout is NOT lock contention — `git_retry::is_lock_contention` matches git's own
//! lock-failure stderr phrasings, which a timeout error never carries — so [`git_at`]'s retry
//! wrapper returns a timed-out call unchanged after exactly one attempt, never retrying it.

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
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo_path).args(args);
    // A credential prompt on a terminal device would block until the timeout kill; failing fast
    // is benign for every other call (none of them authenticates).
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    crate::proc::output_with_timeout(
        &mut cmd,
        None,
        std::time::Duration::from_secs(crate::proc::GIT_TIMEOUT_SECS),
        &format!("git -C {repo_path:?} {args:?}"),
    )
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

/// Run `git -C <repo_path> <args>` and return the raw [`Output`] whatever the exit status —
/// the caller reads `status` and `stdout` itself. Applies [`git_at`]'s two refusals (empty
/// `repo_path`, empty `args`) and nothing else.
///
/// Why this exists: [`git_at`] turns a non-zero exit into an `Err` and drops stdout, which
/// destroys exactly the two signals `git merge-tree` (exit 1 means conflict, with the conflicted
/// file list on stdout) and `git merge` carry. Plan 08-03's merge is built on this function.
/// Still routed through [`spawn_git`], so this file remains the workspace's only git construction
/// site.
pub fn git_output_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("git_output_at refused: repo_path must not be empty");
    }
    if args.is_empty() {
        bail!("git_output_at refused: args must not be empty");
    }
    spawn_git(repo_path, args)
}

/// Every tracked path in the repository holding `repo_path`, repository-relative, in `git ls-files`
/// order. `-z` so a path with a newline or non-ASCII bytes arrives unquoted. Tracked files only:
/// gitignored build output and untracked secrets are never listed (T-15-08).
pub fn tracked_files(repo_path: &Path) -> anyhow::Result<Vec<String>> {
    let output = git_at(repo_path, &["ls-files", "-z"])?;
    Ok(output
        .stdout
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect())
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

/// Where `project_path` sits in its repository, relative to the repository's root and without a
/// trailing slash: '' when the project is the repository's root, `flywheel` when it is registered
/// at `<repo>/flywheel` (cymarechal/highknow-mvp#551). A worktree of the repository holds the
/// project at the same place, so this is what joins a worktree's root to the project's directory.
/// `git rev-parse --show-prefix` rather than stripping `--show-toplevel` from the path, because
/// the two can differ by a symlink or by case on a case-insensitive filesystem; git's own answer
/// cannot.
pub fn project_subdir(project_path: &Path) -> anyhow::Result<String> {
    let output = git_at(project_path, &["rev-parse", "--show-prefix"])?;
    Ok(String::from_utf8_lossy(&output.stdout).trim_end_matches(['\n', '\r']).trim_end_matches('/').to_string())
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
/// diff --no-renames --stat <range>` for the stat text, `git diff --no-renames --name-only
/// <range>` for the path list. The only parsing this function performs is splitting the
/// name-only text on `'\n'` and dropping empty elements — mirrors [`worktree_list`]'s own "no
/// parsing of its own" note. A base ref that does not resolve returns an `Err` carrying git's own
/// stderr, never an empty success; a branch with nothing ahead of its base returns `Ok` with both
/// fields empty, never an error.
///
/// `--no-renames` (plan 04-11) is load-bearing, not a style choice: with rename detection on,
/// `--name-only` reports a moved file under its NEW path alone, so an honest agent claim of the
/// file's old path would never match. Disabled, a move is reported as a delete-plus-add — both
/// the old and the new path appear in `changed_paths` — so either side of a legitimate rename
/// matches the claimed-files drift detector, and the detector never cries wolf on a real move.
///
/// D-71: the stat and the path list are what the packet carries, never hunk bodies — the agent is
/// standing in the worktree it is briefed about, and the packet's size must depend only on how
/// many files changed, not on how large any one change is.
pub fn diff_stat_and_names(repo_path: &Path, base_ref: &str) -> anyhow::Result<DiffStat> {
    let range = format!("{base_ref}...HEAD");

    let stat_output = git_at(repo_path, &["diff", "--no-renames", "--stat", &range])?;
    let stat = String::from_utf8_lossy(&stat_output.stdout).into_owned();

    let names_output = git_at(repo_path, &["diff", "--no-renames", "--name-only", &range])?;
    let names_text = String::from_utf8_lossy(&names_output.stdout).into_owned();
    let changed_paths: Vec<String> =
        names_text.split('\n').filter(|line| !line.is_empty()).map(str::to_string).collect();

    Ok(DiffStat { stat, changed_paths })
}

/// One changed file in a review (Phase 8, REVW-01/REVW-02). `status` is git's leading status
/// letter (`M`, `A`, `D`, `R`, `C`, `T`), never the similarity-suffixed form. `old_path` is
/// `Some` only for a rename/copy. A binary file carries `binary: true` and no counts.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ReviewFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    pub binary: bool,
}

/// The changed files in `<base>...<head>` (three dots: compared against the merge-base, so only
/// what `head` itself changed shows up) with status, rename source and line counts.
///
/// Two reads through [`git_at`]: `diff -z --name-status -M` and `diff -z --numstat -M`. `-z`
/// keeps spaces and odd bytes in paths intact (no C-quoting); `-M` turns a move into one `R`
/// entry instead of a delete plus an add. Both reads emit files in the same order, so they are
/// parsed separately and zipped by position.
///
/// This is additive: [`diff_stat_and_names`] keeps its `--no-renames` semantics and its `--stat`
/// text because `drift.rs` depends on exactly those.
pub fn review_files(repo_path: &Path, base: &str, head: &str) -> anyhow::Result<Vec<ReviewFile>> {
    changed_files(repo_path, base, head, false)
}

/// [`review_files`] for the project at `project_dir` alone: only the files under it, each path
/// relative to it (`git diff --relative`). For a project at its repository's root this is the same
/// list; for one registered at a subdirectory of a larger repository
/// (cymarechal/highknow-mvp#551) it is what reads `docs/adr/` and `GLOSSARY.md` as the project's
/// own, where [`review_files`] names them `flywheel/docs/adr/...`.
pub fn project_review_files(project_dir: &Path, base: &str, head: &str) -> anyhow::Result<Vec<ReviewFile>> {
    changed_files(project_dir, base, head, true)
}

fn changed_files(repo_path: &Path, base: &str, head: &str, relative: bool) -> anyhow::Result<Vec<ReviewFile>> {
    let range = format!("{base}...{head}");
    let read = |format: &str| {
        let mut args = vec!["diff", "-z", format, "-M"];
        if relative {
            args.push("--relative");
        }
        args.push(&range);
        git_at(repo_path, &args)
    };
    let names = read("--name-status")?;
    let nums = read("--numstat")?;
    let names = String::from_utf8_lossy(&names.stdout).into_owned();
    let nums = String::from_utf8_lossy(&nums.stdout).into_owned();

    // name-status: `<status>\0<path>\0` or, for R/C, `<status>\0<old>\0<new>\0`.
    let mut entries: Vec<(String, Option<String>, String)> = Vec::new();
    let mut fields = names.split('\0').filter(|f| !f.is_empty());
    while let Some(token) = fields.next() {
        let letter = token.chars().next().map(String::from).unwrap_or_default();
        if letter == "R" || letter == "C" {
            let old = fields.next().context("name-status rename missing old path")?;
            let new = fields.next().context("name-status rename missing new path")?;
            entries.push((letter, Some(old.to_string()), new.to_string()));
        } else {
            let path = fields.next().context("name-status entry missing path")?;
            entries.push((letter, None, path.to_string()));
        }
    }

    // numstat: `<added>\t<removed>\t<path>\0`, or `<added>\t<removed>\t\0<old>\0<new>\0`.
    let mut counts: Vec<(Option<u32>, Option<u32>, bool)> = Vec::new();
    let mut fields = nums.split('\0').filter(|f| !f.is_empty());
    // An empty third column (rename) leaves the head field ending in a tab, so it is not empty and
    // survives the filter; the two path fields that follow it are consumed below.
    while let Some(head_field) = fields.next() {
        let mut cols = head_field.splitn(3, '\t');
        let added = cols.next().unwrap_or("");
        let removed = cols.next().unwrap_or("");
        let path_col = cols.next().unwrap_or("");
        if path_col.is_empty() {
            // rename/copy: the old and new path follow as their own NUL fields
            fields.next();
            fields.next();
        }
        if added == "-" && removed == "-" {
            counts.push((None, None, true));
        } else {
            counts.push((added.parse().ok(), removed.parse().ok(), false));
        }
    }

    if entries.len() != counts.len() {
        bail!(
            "review_files: name-status ({}) and numstat ({}) disagree on the file count for {range}",
            entries.len(),
            counts.len()
        );
    }

    Ok(entries
        .into_iter()
        .zip(counts)
        .map(|((status, old_path, path), (added, removed, binary))| ReviewFile {
            path,
            old_path,
            status,
            added,
            removed,
            binary,
        })
        .collect())
}

/// One file's patch text for `<base>...<head>`. Both paths of a rename must be passed (`old_path`
/// as the second pathspec): with rename detection on and a pathspec naming only the new path, git
/// has no old side to pair it with and reports the file as newly added, losing the rename.
///
/// `path` and `old_path` are relative to the repository's root, as [`review_files`] names them,
/// whatever directory `repo_path` is: each pathspec carries `:(top,literal)`, so the patch is the
/// same read from a worktree's root or from a project registered at a subdirectory of its
/// repository (cymarechal/highknow-mvp#551), and a file named like a pathspec magic string is
/// still read as itself. `--no-ext-diff`/`--no-textconv` keep repository config from running
/// helpers while reading.
pub fn review_patch(
    repo_path: &Path,
    base: &str,
    head: &str,
    path: &str,
    old_path: Option<&str>,
) -> anyhow::Result<String> {
    if path.is_empty() {
        bail!("review_patch refused: path must not be empty");
    }
    if path.contains('\0') || old_path.is_some_and(|p| p.is_empty() || p.contains('\0')) {
        bail!("review_patch refused: path must not contain a NUL byte");
    }
    let range = format!("{base}...{head}");
    let pathspecs: Vec<String> =
        std::iter::once(path).chain(old_path).map(|p| format!(":(top,literal){p}")).collect();
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U3", "-M", range.as_str(), "--"];
    args.extend(pathspecs.iter().map(String::as_str));
    let out = git_at(repo_path, &args)?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Ahead/behind counts between `branch` and `target_ref` (D-116, LINK-02, Phase 7 plan 07-01).
/// Returns `Ok(None)` when `target_ref` does not resolve locally — a withheld figure, never a
/// fabricated zero, so the caller can tell "level" (`Some((0, 0))`) from "cannot measure" (`None`).
/// Otherwise runs `git rev-list --left-right --count <target_ref>...<branch>`: `--left-right`
/// splits the symmetric difference by side (left = `target_ref`-only commits = `behind`, right =
/// `branch`-only commits = `ahead`), and `--count` means this function parses two
/// whitespace-separated integers from a known-shape stdout line, mirroring
/// [`git_status_porcelain`]'s one-call, no-further-parsing convention.
pub fn ahead_behind(
    repo_path: &Path,
    target_ref: &str,
    branch: &str,
) -> anyhow::Result<Option<(u32, u32)>> {
    if !rev_parse_verify(repo_path, target_ref)? {
        return Ok(None);
    }
    let range = format!("{target_ref}...{branch}");
    let output = git_at(repo_path, &["rev-list", "--left-right", "--count", &range])?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let behind: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let ahead: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Ok(Some((ahead, behind)))
}

/// Fetch `origin` in `repo_path` (D-116), skipping without fetching when the repository has no
/// remote configured at all — `git remote`'s stdout is empty in that case, which is not an error.
/// Returns `Ok(true)` when a fetch actually ran, `Ok(false)` when it was skipped.
pub fn fetch_origin(repo_path: &Path) -> anyhow::Result<bool> {
    let remotes = git_at(repo_path, &["remote"])?;
    if String::from_utf8_lossy(&remotes.stdout).trim().is_empty() {
        return Ok(false);
    }
    git_at(repo_path, &["fetch", "--quiet", "origin"])?;
    Ok(true)
}

/// The RFC3339 modification time of `FETCH_HEAD` in `repo_path` (D-116), or `Ok(None)` when the
/// repository has never fetched. Resolves the path via `git rev-parse --git-path FETCH_HEAD`
/// rather than hand-deriving `.git`'s location, so a linked worktree's shared git dir resolves
/// correctly too; the result may be relative (joined onto `repo_path`) or absolute (an absolute
/// `rel` makes `Path::join` replace `repo_path` outright), both handled by the same join.
pub fn last_fetch_at(repo_path: &Path) -> anyhow::Result<Option<String>> {
    let output = git_at(repo_path, &["rev-parse", "--git-path", "FETCH_HEAD"])?;
    let rel = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let path = repo_path.join(rel);
    match std::fs::metadata(&path) {
        Ok(meta) => {
            let modified =
                meta.modified().context("FETCH_HEAD metadata carries no modified time")?;
            let datetime: chrono::DateTime<chrono::Utc> = modified.into();
            Ok(Some(datetime.to_rfc3339()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).context("failed to read FETCH_HEAD metadata"),
    }
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

/// The verdict of a merge dry run (plan 08-03, REVW-04).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum MergePrecheck {
    Clean,
    /// The conflicted paths, sorted and deduplicated.
    Conflicts(Vec<String>),
}

/// Would merging `source` into `target` conflict? Answered without writing anything.
///
/// Three verified facts. `git merge-tree --write-tree` writes objects only: it mutates no ref, no
/// index and no working tree, so this is safe to run against a repository an agent is using.
/// Without `--no-messages` its informational text also lands on stdout after a blank line, which
/// would pollute the path list — hence that flag. And it needs git 2.38, which
/// [`MIN_SUPPORTED_GIT`] already clears.
///
/// Exit 0 is clean, exit 1 with a tree oid on stdout is a conflict (then the conflicted paths, NUL
/// separated). Anything else is a real error, never confused with a conflict: a corrupt repository
/// exits 128, and an unknown ref exits 1 too (verified) but with an empty stdout.
pub fn merge_tree_check(repo_path: &Path, target: &str, source: &str) -> anyhow::Result<MergePrecheck> {
    let output = git_output_at(
        repo_path,
        &["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", target, source],
    )?;
    match output.status.code() {
        Some(0) => Ok(MergePrecheck::Clean),
        Some(1) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let mut fields = stdout.split('\0');
            // A real conflict starts with the written tree oid. An unknown ref ALSO exits 1 but
            // prints nothing on stdout, so the oid is what tells the two apart.
            let oid = fields.next().unwrap_or("");
            if oid.len() < 40 || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
                let stderr = String::from_utf8_lossy(&output.stderr);
                bail!("merge dry run of {source:?} into {target:?} failed (no conflict result): {stderr}");
            }
            let mut files: Vec<String> =
                fields.take_while(|f| !f.is_empty()).map(str::to_string).collect();
            files.sort();
            files.dedup();
            Ok(MergePrecheck::Conflicts(files))
        }
        code => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("merge dry run of {source:?} into {target:?} failed (exit {code:?}): {stderr}")
        }
    }
}

/// Merge `source` into the branch checked out in `worktree` with `--no-ff`, so every integration
/// has a durable merge commit. Returns whether a commit was created (`false` = the target already
/// contained `source`).
///
/// Any failure — a conflict, a hook refusal, a transport error — runs
/// [`merge_abort_if_in_progress`] and returns an error saying the merge was rolled back (or, if
/// the tree cannot be proven clean afterwards, saying that instead). The message is one argv
/// element: there is no shell here. The commit hooks are deliberately left to run.
pub fn merge_no_ff(worktree: &Path, source: &str, message: &str) -> anyhow::Result<bool> {
    let outcome = git_output_at(worktree, &["merge", "--no-ff", "--no-stat", "-m", message, source]);
    let failure = match &outcome {
        Ok(out) if out.status.success() => None,
        Ok(out) => {
            eprintln!(
                "merge of {source:?} in {worktree:?} failed: {}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            Some(format!("git exited {:?}", out.status.code()))
        }
        Err(e) => Some(format!("{e:#}")),
    };
    if let Some(reason) = failure {
        let err = match merge_abort_if_in_progress(worktree) {
            Ok(_) => anyhow!(
                "merge of {source:?} failed and was rolled back ({reason}); {worktree:?} was re-checked clean"
            ),
            Err(unclean) => anyhow!(
                "merge of {source:?} failed ({reason}) and the rollback could not be verified: {unclean:#}"
            ),
        };
        return Err(err);
    }
    let out = outcome?;
    Ok(!String::from_utf8_lossy(&out.stdout).contains("Already up to date"))
}

/// Abort a merge left in progress in `worktree` (a crash, a hook refusal), then PROVE the tree is
/// clean by re-reading porcelain. Returns whether it aborted anything; a tree that is still dirty
/// afterwards is an error naming the path — a merge path that cannot show a clean tree must say
/// so rather than report success or report that nothing happened.
pub fn merge_abort_if_in_progress(worktree: &Path) -> anyhow::Result<bool> {
    let in_progress = rev_parse_verify(worktree, "MERGE_HEAD")?;
    if in_progress {
        git_at(worktree, &["merge", "--abort"])?;
    }
    let dirty = crate::domain::worktree::porcelain_entries(worktree)?;
    if !dirty.is_empty() {
        bail!(
            "worktree {worktree:?} is not clean after the merge was aborted ({} entries, first: {:?})",
            dirty.len(),
            dirty[0].path
        );
    }
    Ok(in_progress)
}

/// The commit `rev` names in `repo_path`, as a full oid. `--verify --end-of-options` so a ref name
/// that looks like an option is never read as one, and anything that is not one commit is an error.
pub fn rev_parse_commit(repo_path: &Path, rev: &str) -> anyhow::Result<String> {
    let spec = format!("{rev}^{{commit}}");
    let out = git_at(repo_path, &["rev-parse", "--verify", "--end-of-options", &spec])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The checkout that has `branch` checked out, if any: the main working tree or a linked worktree,
/// read from `git worktree list --porcelain` (ADR 0009). A bare entry or a detached HEAD never
/// matches. `None` when no working tree has the branch checked out.
pub fn checkout_of_branch(repo_path: &Path, branch: &str) -> anyhow::Result<Option<std::path::PathBuf>> {
    let out = git_at(repo_path, &["worktree", "list", "--porcelain", "-z"])?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let wanted = format!("branch refs/heads/{branch}");
    let mut current: Option<&str> = None;
    for field in text.split('\0') {
        if let Some(path) = field.strip_prefix("worktree ") {
            current = Some(path);
        } else if field == wanted {
            return Ok(current.map(std::path::PathBuf::from));
        }
    }
    Ok(None)
}

/// The tracked files with uncommitted changes in the checkout at `path`, staged or not
/// (`status --porcelain --untracked-files=no`). Untracked files are left out: they are the
/// developer's own, and a merge that would overwrite one refuses by itself.
pub fn tracked_changes(path: &Path) -> anyhow::Result<Vec<String>> {
    let out = git_at(path, &["status", "--porcelain", "-z", "--untracked-files=no"])?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|f| f.len() > 3)
        .map(|f| f[3..].to_string())
        .collect())
}

/// Build the `--no-ff` merge of `source` into `refs/heads/<target>` without a checkout (ADR 0009):
/// `merge-tree --write-tree` writes the merged tree, `commit-tree` the two-parent commit (the
/// target's tip first, then `source`), and `update-ref` moves the branch only if it still points
/// at the tip the commit was built on, so a commit that lands on the branch meanwhile is never
/// lost. Writes no index and no working tree, and runs no hook. Returns the merge commit.
///
/// A conflict is an error naming the paths; nothing but unreachable objects is written then.
pub fn merge_without_checkout(repo_path: &Path, target: &str, source: &str, message: &str) -> anyhow::Result<String> {
    let target_ref = format!("refs/heads/{target}");
    let old_tip = rev_parse_commit(repo_path, &target_ref)?;
    let source_sha = rev_parse_commit(repo_path, source)?;
    let out = git_output_at(repo_path, &["merge-tree", "--write-tree", "-z", "--no-messages", &old_tip, &source_sha])?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let mut fields = stdout.split('\0');
    let tree = fields.next().unwrap_or("").trim().to_string();
    match out.status.code() {
        Some(0) if !tree.is_empty() => {}
        Some(1) if !tree.is_empty() => {
            // `-z` without `--name-only`: each conflicted entry is `<mode> <oid> <stage>\t<path>`.
            let mut paths: Vec<String> = fields
                .take_while(|f| !f.is_empty())
                .filter_map(|f| f.split_once('\t').map(|(_, p)| p.to_string()))
                .collect();
            paths.sort();
            paths.dedup();
            bail!("merging {source:?} into {target:?} conflicts in {}", paths.join(", "));
        }
        code => bail!(
            "merge of {source:?} into {target:?} failed (exit {code:?}): {}",
            String::from_utf8_lossy(&out.stderr)
        ),
    }
    let commit = git_at(repo_path, &["commit-tree", &tree, "-p", &old_tip, "-p", &source_sha, "-m", message])?;
    let commit = String::from_utf8_lossy(&commit.stdout).trim().to_string();
    git_at(repo_path, &["update-ref", "-m", message, &target_ref, &commit, &old_tip])
        .with_context(|| format!("{target:?} moved while the merge was built; nothing was merged"))?;
    Ok(commit)
}

/// Delete `refs/heads/<branch>` after a merge, the way `git branch -d` would refuse to lose work:
/// only when its tip is `expected` and `expected` is contained in `into`. `branch -d` itself is not
/// usable here: it checks against the main checkout's HEAD, which after a merge without a checkout
/// is not the base branch (ADR 0009). The delete is a compare-and-swap on `expected`.
pub fn delete_merged_branch(repo_path: &Path, branch: &str, expected: &str, into: &str) -> anyhow::Result<()> {
    let merged = spawn_git(repo_path, &["merge-base", "--is-ancestor", expected, into])?;
    if !merged.status.success() {
        bail!("{branch:?} is not contained in {into:?}; it was kept");
    }
    git_at(repo_path, &["update-ref", "-d", &format!("refs/heads/{branch}"), expected])?;
    Ok(())
}

/// Check out an already-existing `branch` into a new worktree at `worktree_path`. Copies
/// [`worktree_add`]'s three refusals; [`worktree_add`] itself cannot be reused because it always
/// creates a branch and refuses one that exists. Prunes first so a stale registration (directory
/// deleted by hand) self-heals.
pub fn worktree_add_existing(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("worktree_add_existing refused: repo_path must not be empty");
    }
    if worktree_path == repo_path {
        bail!("worktree_add_existing refused: worktree_path {worktree_path:?} equals repo_path");
    }
    let root = worktree_root_from_env();
    if !worktree_path.starts_with(&root) {
        bail!(
            "worktree_add_existing refused: worktree_path {worktree_path:?} is not under the Flywheel worktree root {root:?}"
        );
    }
    git_at(repo_path, &["worktree", "prune"])?;
    let worktree_path_str = worktree_path.to_string_lossy().into_owned();
    git_at(repo_path, &["worktree", "add", &worktree_path_str, branch])
}

/// A plain `git push <remote> <branch>`: nothing in this argv can rewrite or delete remote
/// history, and a rejected non-fast-forward is surfaced, never retried harder. Raw stderr is
/// logged and mapped to a named error rather than returned.
pub fn push_branch(repo_path: &Path, remote: &str, branch: &str) -> anyhow::Result<()> {
    let out = git_output_at(repo_path, &["push", remote, branch])?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    eprintln!("push of {branch:?} to {remote:?} failed: {stderr}");
    let lower = stderr.to_lowercase();
    if lower.contains("non-fast-forward") || lower.contains("fetch first") || lower.contains("[rejected]") {
        bail!("push of {branch:?} to {remote:?} was rejected: the remote has commits this branch lacks");
    }
    if lower.contains("authentication")
        || lower.contains("could not read username")
        || lower.contains("permission denied")
        || lower.contains("terminal prompts disabled")
    {
        bail!("push of {branch:?} to {remote:?} failed: authentication was refused");
    }
    bail!("push of {branch:?} to {remote:?} failed (exit {:?})", out.status.code())
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
