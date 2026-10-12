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
//! it is at most one spawn per project per tick. The epic-request path is stricter and does not
//! rely on that tolerance: [`epic_request_inputs`] reads only the stored override, and the
//! detection spawn waits in [`EpicRequestInputs::forge`], after the lock is released.

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
    let (stored, repo_path) = stored_forge_and_repo_path(conn, project_id)?;
    let forge = stored.unwrap_or_else(|| detect_forge_from_origin(&repo_path));
    Ok((forge, repo_path))
}

/// The board-only half of [`forge_and_repo_path`]: the stored override (`None` when
/// `projects.forge` is NULL and detection is still owed) and the repo path. Spawns nothing. A caller
/// holding the database lock uses this and runs [`detect_forge_from_origin`] itself after release.
pub fn stored_forge_and_repo_path(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<(Option<Forge>, PathBuf)> {
    let (repo_path, stored): (String, Option<String>) = conn
        .query_row(
            "SELECT repo_path, forge FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let forge = match stored.as_deref() {
        Some("github") => Some(Forge::GitHub),
        Some("gitlab") => Some(Forge::GitLab),
        Some("local") => Some(Forge::Local),
        // An out-of-vocabulary value cannot reach here — the CHECK constraint in
        // 0017_forge_setting.sql rejects it before it is ever stored — but a `None` falls
        // through to live detection, D-119's documented fallback.
        Some(_) | None => None,
    };
    Ok((forge, PathBuf::from(repo_path)))
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
/// adapter's own `create_request`. This is called from three places in the workspace, each a
/// deliberate, human-initiated action: the Tauri command that opens a task's request, and
/// [`open_epic_request_at`] (REVW-05), which opens an epic's and is itself called by the epic
/// command. An agent, a scheduler job or any MCP tool reaching `create_request` would have to add
/// another (D-118 rejected the agent path explicitly; `forge_degrade.rs`'s and
/// `supervisor_cwd.rs`'s own `<verify>` gates are what this crate already uses to assert an
/// absence like this one). No test counts the call sites, so this comment is the record, not a
/// gate.
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

/// Why an epic's integration branch cannot be proposed yet. Each is knowable from local reads, so
/// the action is refused by name before the forge is ever asked an unanswerable question
/// (T-08-05-04). A forge CLI that is absent or unauthenticated is only knowable by asking it, so it
/// is reported from [`ForgeError`] when the request is opened instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum EpicRequestBlocker {
    /// `epics.integration_branch` is NULL: nothing was ever merged into the epic.
    NoIntegrationBranch,
    /// The integration branch has no commits ahead of the project's default branch.
    NothingToPropose,
    /// The project's forge is the local (no forge) variant.
    NoForgeConfigured,
    /// The repository has no remote named `origin`.
    NoRemote,
}

/// What the board said about an epic's request, before any git runs. Private fields: an opaque
/// hand-off from [`epic_request_inputs`] to [`epic_request_blocker`], so a caller cannot substitute
/// a branch or a path between the board read and the git work, and the git half re-reads nothing.
#[derive(Debug, Clone)]
pub struct EpicRequestInputs {
    integration_branch: Option<String>,
    default_branch: String,
    /// The stored override, or `None` when detection from `origin` is still owed (a git spawn, so
    /// it is deferred to [`EpicRequestInputs::forge`] rather than done under the lock).
    stored_forge: Option<Forge>,
    detected_forge: std::cell::OnceCell<Forge>,
    repo_path: PathBuf,
}

impl EpicRequestInputs {
    /// Whether the epic has an integration branch cut. A board fact: no git.
    pub fn has_integration_branch(&self) -> bool {
        self.integration_branch.is_some()
    }

    /// The project's repository path, for the lock-free dispatch that follows.
    pub fn repo_path(&self) -> &std::path::Path {
        &self.repo_path
    }

    /// The project's effective forge: the stored override, else one bounded local
    /// `git remote get-url origin`, memoised so the blocker check and the dispatch agree. May spawn
    /// git, so call it only after the database lock is released.
    pub fn forge(&self) -> Forge {
        self.stored_forge.unwrap_or_else(|| *self.detected_forge.get_or_init(|| detect_forge_from_origin(&self.repo_path)))
    }
}

/// The database half of [`epic_request_preconditions`]: the epic's integration branch and its
/// project's default branch, forge override and repo path. Reads the board only and spawns no git,
/// so it is safe under the database lock.
pub fn epic_request_inputs(conn: &Connection, epic_id: &str) -> anyhow::Result<EpicRequestInputs> {
    let (project_id, integration_branch): (String, Option<String>) = conn
        .query_row(
            "SELECT project_id, integration_branch FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;
    let default_branch: String = conn
        .query_row("SELECT default_branch FROM projects WHERE id = ?1", params![project_id], |row| {
            row.get(0)
        })
        .with_context(|| format!("project {project_id:?} not found"))?;
    let (stored_forge, repo_path) = stored_forge_and_repo_path(conn, &project_id)?;
    Ok(EpicRequestInputs {
        integration_branch,
        default_branch,
        stored_forge,
        detected_forge: std::cell::OnceCell::new(),
        repo_path,
    })
}

/// The git half of [`epic_request_preconditions`]: check, in order, the four local preconditions
/// for proposing the epic's integration branch; `Ok(None)` means the action can be offered. Takes
/// no connection, so a caller can read the inputs under the database lock, release it, then call
/// this. The order is what makes the outcomes distinguishable.
pub fn epic_request_blocker(inputs: &EpicRequestInputs) -> anyhow::Result<Option<EpicRequestBlocker>> {
    let Some(branch) = &inputs.integration_branch else {
        return Ok(Some(EpicRequestBlocker::NoIntegrationBranch));
    };
    let default_branch = &inputs.default_branch;
    let repo_path = &inputs.repo_path;

    // A withheld figure (the default branch does not resolve) is an error, never a fabricated
    // "nothing to propose".
    let Some((ahead, _behind)) = crate::git::ahead_behind(repo_path, default_branch, branch)? else {
        anyhow::bail!("cannot compare {branch:?} with {default_branch:?}: the default branch does not resolve locally");
    };
    if ahead == 0 {
        return Ok(Some(EpicRequestBlocker::NothingToPropose));
    }
    if inputs.forge() == Forge::Local {
        return Ok(Some(EpicRequestBlocker::NoForgeConfigured));
    }
    if crate::git::git_at(repo_path, &["remote", "get-url", "origin"]).is_err() {
        return Ok(Some(EpicRequestBlocker::NoRemote));
    }
    Ok(None)
}

/// [`epic_request_inputs`] then [`epic_request_blocker`]. For core-internal and test use: it takes a
/// connection AND spawns git, so it must not be called from a command handler while the database
/// lock is held. The two halves exist for that.
pub fn epic_request_preconditions(
    conn: &Connection,
    epic_id: &str,
) -> anyhow::Result<Option<EpicRequestBlocker>> {
    epic_request_blocker(&epic_request_inputs(conn, epic_id)?)
}

/// What happened when an epic's request was opened. A partial result is its own variant so it can
/// never be presented as success (T-08-05-05).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum EpicRequestOutcome {
    /// Pushed (if needed) and a new request now exists.
    Opened(ForgeRequest),
    /// A request for this head is already open; nothing was pushed or created.
    AlreadyOpen(ForgeRequest),
    /// The push was refused. Nothing reached the remote and no request was created.
    PushRejected { detail: String },
    /// The branch IS on the remote but the request was not created.
    PushedButNotOpened { branch: String, detail: String },
}

/// Open a pull/merge request for an epic's integration branch (REVW-05): reuse an open request if
/// one exists, else push the head, then create the request. Connection-free like every function in
/// this module that shells out; `draft` comes from
/// [`request_body::assemble_epic_request_draft`], the same function that produced the preview.
///
/// Ordering is the point. The existing-request lookup runs first, so asking twice surfaces the
/// first request instead of creating a duplicate, and so an absent or unauthenticated forge CLI
/// fails here, as the existing [`ForgeError`] category, before anything is pushed. Only an open
/// request counts as "already open": a merged or closed one for the same head does not block a
/// new request.
///
/// The push runs against `repo_path`, the project's main checkout, never the epic worktree: the
/// generated pre-push hook's territory check lets a push from outside the configured worktree root
/// through untouched, whereas a push from inside the worktree would enter the force-push and
/// branch-deletion ancestry checks for no benefit. The push is plain, and a rejection is returned
/// to the user, never retried harder.
///
/// This writes no status column and registers no poll: nothing in the forge observation path is
/// keyed on an epic, and this phase ships the epic request read-only (D-122, D-145). The follow-up
/// it implies is an observer that carries an epic's tasks to Done when its request merges.
pub fn open_epic_request_at(
    forge: Forge,
    repo_path: &std::path::Path,
    draft: &request_body::RequestDraft,
) -> Result<EpicRequestOutcome, ForgeError> {
    if forge == Forge::Local {
        return Err(ForgeError::CliFailed {
            cli: "flywheel",
            stderr: format!("project at {repo_path:?} has no forge configured — cannot open a request"),
        });
    }

    if let Some(existing) = request_for_branch_at(forge, repo_path, &draft.head_branch)? {
        if matches!(existing.state, ForgeState::Open | ForgeState::ChangesRequested) {
            return Ok(EpicRequestOutcome::AlreadyOpen(existing));
        }
    }

    if let Err(e) = crate::git::push_branch(repo_path, "origin", &draft.head_branch) {
        return Ok(EpicRequestOutcome::PushRejected { detail: e.to_string() });
    }

    match create_request_at(forge, repo_path, draft) {
        Ok(request) => Ok(EpicRequestOutcome::Opened(request)),
        Err(e) => {
            // Raw CLI output is logged, never returned (T-08-05-03).
            let detail = match &e {
                ForgeError::CliFailed { cli, stderr } => {
                    eprintln!("{cli} could not open the request for {:?}: {stderr}", draft.head_branch);
                    format!("{cli} could not open the request")
                }
                other => other.to_string(),
            };
            Ok(EpicRequestOutcome::PushedButNotOpened { branch: draft.head_branch.clone(), detail })
        }
    }
}
