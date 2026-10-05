//! The normalised forge model (D-117, D-119, LINK-05, LINK-06, LINK-08, phase 07 plan 07-03).
//!
//! Three things this header states explicitly, mirroring `drift.rs`'s own three-rule header:
//!
//! First, [`ForgeState`] and [`CiResult`] **ARE the CONV-06 seam** — the named boundary a future
//! webhook transport will produce values into without any consumer changing. [`github::normalize`]
//! and [`gitlab::normalize`] are the only two functions that construct a [`ForgeRequest`] today;
//! CONV-06 swaps what feeds them, never what they produce or what a consumer reads from them.
//!
//! Second, nothing in this module holds, stores or transmits a forge credential (D-117,
//! inheriting `credentials.rs`'s standing rule against passing a secret where a process listing
//! could disclose it). `gh` and `glab` own their own authentication; no secret crosses argv, and
//! no HTTP client exists anywhere in this workspace.
//!
//! Third, nothing here caches a verdict. [`request_for_branch_at`] is derived fresh on every call
//! — following `drift.rs`'s own D-75 "derive at read time" discipline — so a cached forge state
//! can never disagree with the forge itself.
//!
//! Fourth (phase 07 plan 07-11, closing verification Gap 1 / code review CR-01): resolution and
//! dispatch are separate functions, deliberately. [`forge_and_repo_path`] takes a `&Connection`
//! and issues no forge CLI call and no network call — that is what the resolution/dispatch split
//! exists to guarantee, and on its stored-override arms it spawns no process at all; but on its
//! detection fallback (a project whose `projects.forge` is NULL) it spawns one bounded local
//! `git remote get-url origin`. [`request_for_branch_at`] and [`create_request_at`] spawn a
//! subprocess and take no `Connection` at all. A database lock must never be alive while a forge
//! CLI runs — the app has exactly one `AppState.db` mutex guarding every Tauri command, and a
//! function that took both a connection and ran an unbounded network call was the only way a
//! caller COULD hold that lock across one. With no such function left, a caller must resolve
//! under the lock, release it, and dispatch lock-free — the shape is unrepresentable, not just
//! avoided. The detection fallback's one bounded local `git` spawn is tolerated running under the
//! lock (all three call sites hold it there) rather than split out to its own lock-free phase: a
//! local config read, bounded by `GIT_TIMEOUT_SECS`, cannot produce the unbounded freeze this
//! split exists to prevent, and [`forge_and_repo_path`]'s own callers memoise it per project, so
//! it is at most one spawn per project per tick.

use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{params, Connection};
use serde::Serialize;

pub mod github;
pub mod gitlab;
pub mod request_body;
pub mod transitions;

/// Which forge (if any) a project talks to (D-119) — `Forge::Local` means no forge is configured
/// and nothing is ever shelled out to for that project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Forge {
    GitHub,
    GitLab,
    Local,
}

/// The normalised pull/merge request lifecycle state (LINK-05) — part of the CONV-06 seam, see
/// module header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ForgeState {
    /// No request exists for this branch.
    None,
    Open,
    /// Open, with changes requested by a reviewer. GitHub-only: GitLab exposes no single
    /// review-decision field, so this variant is unreachable on the GitLab arm by design.
    ChangesRequested,
    /// GitHub `MERGED` maps here regardless of `closedAt` — merged always wins over closed.
    Merged,
    /// Closed without merging.
    ClosedUnmerged,
}

/// The normalised CI result (LINK-06) — part of the CONV-06 seam, see module header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum CiResult {
    /// No CI ran against this request's head (an empty `statusCheckRollup`, or GitLab's
    /// `head_pipeline: null`).
    None,
    Pending,
    /// All checks completed successfully — an all-`SKIPPED` GitHub rollup also normalises here.
    Passed,
    Failed,
}

/// One normalised pull/merge request (LINK-05, LINK-06) — the shape both [`github::normalize`]
/// and [`gitlab::normalize`] produce.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ForgeRequest {
    pub state: ForgeState,
    pub ci: CiResult,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub ci_url: Option<String>,
    pub is_draft: bool,
    pub target_branch: String,
}

/// Two typed variants distinguishing "the CLI is missing" from "the CLI is present but not
/// authenticated" (RESEARCH.md open question 3) — these are two different situations for the
/// user and must never collapse into one stringified error.
#[derive(Debug, Clone, PartialEq)]
pub enum ForgeError {
    /// Spawning the CLI failed with `ErrorKind::NotFound` — it is not on `PATH` at all.
    CliNotInstalled { cli: &'static str },
    /// The CLI is installed, but a follow-up `<cli> auth status` reports it is not authenticated.
    CliNotAuthenticated { cli: &'static str },
    /// The CLI exited non-zero for a reason that is neither of the above.
    CliFailed { cli: &'static str, stderr: String },
    /// The CLI's JSON output could not be read for the field this normaliser needed.
    MalformedJson { cli: &'static str, detail: String },
}

impl std::fmt::Display for ForgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ForgeError::CliNotInstalled { cli } => write!(
                f,
                "{cli} is not installed — install it to see request/CI state for this project"
            ),
            ForgeError::CliNotAuthenticated { cli } => {
                write!(f, "{cli} is installed but not authenticated — run `{cli} auth login`")
            }
            ForgeError::CliFailed { cli, stderr } => write!(f, "{cli} failed: {stderr}"),
            ForgeError::MalformedJson { cli, detail } => {
                write!(f, "{cli} returned JSON this module could not read: {detail}")
            }
        }
    }
}

impl std::error::Error for ForgeError {}

/// Detect the forge from `repo_path`'s origin remote (D-119). Any `Err` from `git remote
/// get-url origin` — including "no such remote" — or an empty URL is `Forge::Local`; "no remote →
/// local-only" is never an error (D-119, LINK-08). Matches the host substring of both the SSH
/// (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo.git`) forms.
pub fn detect_forge_from_origin(repo_path: &std::path::Path) -> Forge {
    let url = match crate::git::git_at(repo_path, &["remote", "get-url", "origin"]) {
        Ok(output) => String::from_utf8_lossy(&output.stdout).trim().to_string(),
        Err(_) => return Forge::Local,
    };
    if url.is_empty() {
        return Forge::Local;
    }
    if url.contains("github.com") {
        Forge::GitHub
    } else if url.contains("gitlab.com") {
        Forge::GitLab
    } else {
        Forge::Local
    }
}

/// `project_id`'s stored forge override and repo path in one read, so [`forge_for_project`] and
/// every dispatch caller never issue two separate queries for data that lives in the same row.
/// Takes a connection and issues no forge CLI call and no network call — the resolution half of
/// the resolution/dispatch split the module header's fourth rule states; callers resolve here,
/// release the lock, then dispatch through [`request_for_branch_at`] or [`create_request_at`],
/// neither of which takes a connection. On the stored-override arms (`projects.forge` is
/// `"github"`, `"gitlab"` or `"local"`) it spawns no process at all; but on the detection
/// fallback (`projects.forge` is `NULL`) it spawns one bounded local `git remote get-url origin`
/// via [`detect_forge_from_origin`], while this function's own caller still holds the database
/// lock — tolerated per the module header's fourth rule, since a local config read bounded by
/// `GIT_TIMEOUT_SECS` cannot produce the unbounded freeze the resolution/dispatch split exists to
/// prevent.
pub fn forge_and_repo_path(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<(Forge, PathBuf)> {
    let (repo_path, stored): (String, Option<String>) = conn
        .query_row(
            "SELECT repo_path, forge FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;
    let repo_path = PathBuf::from(repo_path);

    let forge = match stored.as_deref() {
        Some("github") => Forge::GitHub,
        Some("gitlab") => Forge::GitLab,
        Some("local") => Forge::Local,
        // An out-of-vocabulary value cannot reach here — the CHECK constraint in
        // 0017_forge_setting.sql rejects it before it is ever stored — but a `None` falls
        // through to live detection, D-119's documented fallback.
        Some(_) | None => detect_forge_from_origin(&repo_path),
    };
    Ok((forge, repo_path))
}

/// `project_id`'s effective forge: the stored `projects.forge` override when non-NULL (D-119),
/// else detected fresh from the project's origin remote.
pub fn forge_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Forge> {
    forge_and_repo_path(conn, project_id).map(|(forge, _repo_path)| forge)
}

/// The one dispatch point (D-117) for reading a forge's request state — and, as of plan 07-11,
/// connection-free: it takes an already-resolved `forge`/`repo_path` pair (see
/// [`forge_and_repo_path`]) rather than a database connection, so a caller resolves under the
/// lock, releases it, and calls this function with no lock held at all. `Forge::Local` returns
/// `Ok(None)` **without spawning any process at all**, `Forge::GitHub` delegates to
/// [`github::request_for_branch`], `Forge::GitLab` to [`gitlab::request_for_branch`]. This is the
/// ONE dispatch point in the workspace: `tests/bin/forge_probe.rs` calls through here too, rather
/// than carrying its own copy of this match.
pub fn request_for_branch_at(
    forge: Forge,
    repo_path: &std::path::Path,
    branch: &str,
) -> Result<Option<ForgeRequest>, ForgeError> {
    match forge {
        Forge::Local => Ok(None),
        Forge::GitHub => github::request_for_branch(repo_path, branch),
        Forge::GitLab => gitlab::request_for_branch(repo_path, branch),
    }
}

/// [`request_for_branch_at`]'s dispatch sibling (D-117, D-118) for opening a request — also
/// connection-free as of plan 07-11: takes an already-resolved `forge`/`repo_path` pair, never a
/// `Connection`, so this can be called with no lock held. Returns a no-forge-configured error for
/// `Forge::Local` **without spawning any process at all**, and otherwise delegates to the matching
/// adapter's own `create_request`. This is one of exactly two call sites of either adapter's
/// `create_request` in the whole workspace — the other is the one Tauri command that calls this
/// function — so an agent, a scheduler job or any MCP tool reaching `create_request` would have to
/// add a THIRD (D-118 rejected the agent path explicitly; `forge_degrade.rs`'s and
/// `supervisor_cwd.rs`'s own `<verify>` gates are what this crate already uses to assert an
/// absence like this one, extended here to this function).
pub fn create_request_at(
    forge: Forge,
    repo_path: &std::path::Path,
    draft: &request_body::RequestDraft,
) -> Result<ForgeRequest, ForgeError> {
    match forge {
        Forge::Local => Err(ForgeError::CliFailed {
            cli: "flywheel",
            stderr: format!(
                "project at {repo_path:?} has no forge configured — cannot open a request"
            ),
        }),
        Forge::GitHub => github::create_request(repo_path, draft),
        Forge::GitLab => gitlab::create_request(repo_path, draft),
    }
}
