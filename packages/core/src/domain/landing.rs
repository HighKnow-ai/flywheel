//! Landing (ADR 0042, issue #1757): what Merge does in a project that takes changes by pull request,
//! or by a landing command, instead of by a local merge.
//!
//! A project has a **landing mode**: `pull_request` (the default) or `command`. [`route_for`] turns
//! the setting and the URL of `origin` into one of three routes:
//!
//! - [`Route::Request`]: push the branch, open a pull request with auto-merge on, and move the
//!   Story to Landing ([`start_landing`]);
//! - [`Route::Command`]: run the project's landing command in the Story's worktree. A zero exit
//!   moves the Story to Landing when the project has a forge to ask, and to Merged when it has none;
//! - [`Route::Local`]: the local merge of ADR 0009, for a project with no remote on a known forge.
//!
//! A Landing Story waits for the forge. [`landing_plans`], [`read_request`] and [`apply_request`]
//! are the three phases of the cold tick's pass over every Landing Story, so the board connection is
//! held for database work only (ADR 0024): the request's own state (`OPEN`, `MERGED`, `CLOSED`)
//! decides, never ancestry, because a squash merge leaves the branch's commits off the base branch.
//! Merged completes the Story as the system actor. Closed without merging returns the Story to In
//! review with a note. A missing or signed-out CLI keeps the Story Landing and writes the note, and
//! the next pass tries again. Nothing here ever falls back to the local merge.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;

use crate::check_runner::{login_shell, run_in_shell, ShellOutcome};
use crate::domain::actor::{assert_human_actor, system_actor};
use crate::domain::review::{open_review_in_tx, ReviewDiff};
use crate::domain::story::{get_story, set_story_state_in_tx, Story, StoryState};
use crate::domain::story_merge::{
    finish_merge, new_adrs_of, refuse, LandingStarted, MergeDone, MergeMethod, MergeOutcome,
};
use crate::domain::worktree::{worktree_for_story, Worktree};
use crate::domain::{now, record_event, EventScope};
use crate::forge::{detect_forge, last_line, Forge, ForgeCli, ForgeError, RequestState};
use crate::git;

/// The longest a landing command may run.
const LANDING_COMMAND_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// The longest landing command Flywheel stores.
pub const LANDING_COMMAND_MAX_LEN: usize = 500;

/// What Merge does in a project.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandingMode {
    PullRequest,
    Command,
}

impl LandingMode {
    pub fn as_str(self) -> &'static str {
        match self {
            LandingMode::PullRequest => "pull_request",
            LandingMode::Command => "command",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        match value {
            "pull_request" => Ok(LandingMode::PullRequest),
            "command" => Ok(LandingMode::Command),
            other => anyhow::bail!("{other:?} is not a landing mode"),
        }
    }
}

/// A project's landing setting (the four columns of `projects`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandingSettings {
    pub mode: LandingMode,
    /// The shell command of `command` mode.
    pub command: Option<String>,
    /// The forge, when it is not read from the URL of `origin`.
    pub forge: Option<Forge>,
    /// The auto-merge method: `squash`, `merge` or `rebase`.
    pub method: String,
}

impl Default for LandingSettings {
    fn default() -> Self {
        Self {
            mode: LandingMode::PullRequest,
            command: None,
            forge: None,
            method: "squash".into(),
        }
    }
}

/// Read a project's landing setting.
pub fn read_settings(conn: &Connection, project_id: &str) -> anyhow::Result<LandingSettings> {
    let (mode, command, forge, method): (String, Option<String>, Option<String>, String) = conn
        .query_row(
            "SELECT landing_mode, landing_command, forge, landing_method FROM projects WHERE id = ?1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .with_context(|| format!("project {project_id:?} not found"))?;
    Ok(LandingSettings {
        mode: LandingMode::parse(&mode)?,
        command,
        forge: forge.as_deref().and_then(Forge::parse),
        method,
    })
}

/// Write a project's landing setting, as the developer. A command is trimmed, one line, at most
/// [`LANDING_COMMAND_MAX_LEN`] characters, and `command` mode needs one. Appends a
/// `project.landing_set` event, and writes nothing when the setting is unchanged.
pub fn set_settings(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    settings: &LandingSettings,
) -> anyhow::Result<LandingSettings> {
    assert_human_actor(conn, actor_id)?;
    let command = settings
        .command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_string);
    if let Some(command) = &command {
        anyhow::ensure!(
            !command.contains('\n') && command.chars().count() <= LANDING_COMMAND_MAX_LEN,
            "The landing command must be one line of at most {LANDING_COMMAND_MAX_LEN} characters."
        );
    }
    anyhow::ensure!(
        settings.mode != LandingMode::Command || command.is_some(),
        "The command mode needs a landing command."
    );
    anyhow::ensure!(
        ["squash", "merge", "rebase"].contains(&settings.method.as_str()),
        "The merge method is squash, merge or rebase."
    );
    let before = read_settings(conn, project_id)?;
    let after = LandingSettings {
        mode: settings.mode,
        command,
        forge: settings.forge,
        method: settings.method.clone(),
    };
    if before == after {
        return Ok(after);
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE projects SET landing_mode = ?1, landing_command = ?2, forge = ?3, landing_method = ?4 WHERE id = ?5",
        params![
            after.mode.as_str(),
            after.command,
            after.forge.map(Forge::as_str),
            after.method,
            project_id
        ],
    )?;
    record_event(
        &tx,
        project_id,
        "project",
        project_id,
        EventScope::default(),
        actor_id,
        "project.landing_set",
        &serde_json::json!({
            "mode": after.mode.as_str(),
            "command": after.command,
            "forge": after.forge.map(Forge::as_str),
            "method": after.method,
            "label": format!("Landing mode set to {}", after.mode.as_str()),
        }),
        &now(),
    )?;
    tx.commit()?;
    Ok(after)
}

/// What Merge does for one project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// The local merge of ADR 0009.
    Local,
    /// Run this command in the worktree.
    Command(String),
    /// Open a request on this forge.
    Request(Forge),
}

/// The route of a project's Merge, from its setting and the URL of `origin`. Pure.
pub fn route_for(settings: &LandingSettings, remote_url: Option<&str>) -> anyhow::Result<Route> {
    match settings.mode {
        LandingMode::Command => match &settings.command {
            Some(command) => Ok(Route::Command(command.clone())),
            None => refuse("The project lands by a command, and it names none. Set the landing command, then merge again."),
        },
        LandingMode::PullRequest => {
            let forge = settings
                .forge
                .or_else(|| remote_url.and_then(detect_forge));
            match (forge, remote_url) {
                (Some(forge), Some(_)) => Ok(Route::Request(forge)),
                // A named forge needs a remote to push to.
                (Some(_), None) => refuse("The project lands by pull request and has no `origin` remote to push to."),
                (None, _) => Ok(Route::Local),
            }
        }
    }
}

/// What `start_landing` reads about the Story.
pub(crate) struct LandingInput<'a> {
    pub story: &'a Story,
    pub worktree: &'a Worktree,
    pub repo: &'a Path,
    pub head: &'a str,
    pub base: &'a str,
    pub overridden: Vec<Value>,
    /// A review to open now, for a Story handed off before reviews existed.
    pub diff: Option<ReviewDiff>,
    pub remote_url: Option<&'a str>,
}

/// Merge by request or by command: the git and forge step, then one board transaction.
pub(crate) fn start_landing(
    conn: &mut Connection,
    actor_id: &str,
    input: LandingInput<'_>,
    settings: &LandingSettings,
    route: Route,
    cli: &ForgeCli,
) -> anyhow::Result<MergeOutcome> {
    let LandingInput {
        story,
        worktree,
        repo,
        head,
        base,
        overridden,
        diff,
        remote_url,
    } = input;
    let (mode, forge, request_url, note) = match route {
        Route::Local => anyhow::bail!("a local merge does not land"),
        Route::Request(forge) => {
            cli.ensure_ready(forge, repo).or_else(refuse_forge)?;
            if let Err(e) = git::push_branch(repo, "origin", &worktree.branch) {
                return refuse(format!(
                    "{} was not pushed: {e}. Fix that, then merge again.",
                    story.key
                ));
            }
            let title = format!("{}: {}", story.key, story.title);
            let body = format!("Merged in Flywheel from {}.", worktree.branch);
            let opened = cli
                .open_request(
                    forge,
                    repo,
                    base,
                    &worktree.branch,
                    &title,
                    &body,
                    &settings.method,
                )
                .or_else(refuse_forge)?;
            (
                LandingMode::PullRequest,
                Some(forge),
                Some(opened.url),
                opened.auto_merge_problem,
            )
        }
        Route::Command(command) => {
            let run = run_in_shell(
                &login_shell(),
                &[],
                &[
                    ("FLYWHEEL_STORY_KEY", Path::new(&story.key)),
                    ("FLYWHEEL_STORY_BRANCH", Path::new(&worktree.branch)),
                    ("FLYWHEEL_BASE_BRANCH", Path::new(base)),
                ],
                &worktree.project_dir(),
                &command,
                LANDING_COMMAND_TIMEOUT,
            );
            match run {
                Err(_) => return refuse("The landing command could not be started."),
                Ok(run) => match run.outcome {
                    ShellOutcome::Exited(Some(0)) => {}
                    ShellOutcome::Exited(code) => {
                        return refuse(format!(
                            "The landing command `{command}` ended with {}. Last line: {}",
                            code.map_or("a signal".to_string(), |c| format!("exit status {c}")),
                            last_line(run.output_tail.as_bytes())
                        ))
                    }
                    ShellOutcome::TimedOut => {
                        return refuse(format!(
                            "The landing command `{command}` did not end in {} minutes and was stopped.",
                            LANDING_COMMAND_TIMEOUT.as_secs() / 60
                        ))
                    }
                },
            }
            let forge = settings.forge.or_else(|| remote_url.and_then(detect_forge));
            (LandingMode::Command, forge, None, None)
        }
    };

    let now = now();
    // A landing command with no forge to ask has nothing to wait for: the command is trusted to have
    // landed, and the Story is Merged now.
    let Some(forge) = forge else {
        let merge_commit = git::rev_parse_commit(repo, &format!("refs/heads/{base}"))
            .unwrap_or_else(|_| head.to_string());
        let new_adrs = new_adrs_of(conn, story, repo, &merge_commit, head)?;
        return finish_merge(
            conn,
            actor_id,
            MergeDone {
                story,
                worktree,
                repo,
                head,
                base,
                merge_commit,
                method: MergeMethod::Command,
                overridden,
                diff,
                new_adrs,
            },
        );
    };

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(diff) = &diff {
        open_review_in_tx(
            &tx,
            &story.project_id,
            &story.id,
            None,
            diff,
            &Value::Array(Vec::new()),
            &Value::Array(Vec::new()),
        )?;
    }
    set_story_state_in_tx(&tx, actor_id, &story.id, StoryState::Landing)?;
    let overridden_json = Value::Array(overridden.clone());
    tx.execute(
        "INSERT INTO landings (story_id, project_id, mode, forge, branch, base_branch, head_sha, request_url, request_state, note, failing_checks_overridden, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
         ON CONFLICT(story_id) DO UPDATE SET created_at = excluded.created_at, mode = excluded.mode, forge = excluded.forge, branch = excluded.branch,
           base_branch = excluded.base_branch, head_sha = excluded.head_sha, request_url = excluded.request_url,
           request_state = excluded.request_state, note = excluded.note,
           failing_checks_overridden = excluded.failing_checks_overridden, updated_at = excluded.updated_at",
        params![
            story.id,
            story.project_id,
            mode.as_str(),
            forge.as_str(),
            worktree.branch,
            base,
            head,
            request_url,
            if request_url.is_some() { "open" } else { "unknown" },
            note,
            overridden_json.to_string(),
            now
        ],
    )?;
    let label = match &request_url {
        Some(_) => format!("{} is landing: {} opened", story.key, forge.request_word()),
        None => format!("{} is landing: the landing command ran", story.key),
    };
    record_event(
        &tx,
        &story.project_id,
        "story",
        &story.id,
        EventScope {
            story_id: Some(&story.id),
            epic_id: Some(&story.epic_id),
        },
        actor_id,
        "story.landing",
        &serde_json::json!({
            "mode": mode.as_str(),
            "forge": forge.as_str(),
            "branch": worktree.branch,
            "base_branch": base,
            "request_url": request_url,
            "note": note,
            "failing_checks_overridden": overridden_json,
            "label": label,
        }),
        &now,
    )?;
    tx.commit()
        .context("the request is open, but the board could not record it")?;
    Ok(MergeOutcome {
        project_id: story.project_id.clone(),
        merge_commit: head.to_string(),
        base_branch: base.to_string(),
        method: if mode == LandingMode::Command {
            MergeMethod::Command
        } else {
            MergeMethod::PullRequest
        },
        failing_checks_overridden: overridden,
        cleanup_warning: None,
        adrs_linked: Vec::new(),
        landing: Some(LandingStarted {
            mode: mode.as_str().to_string(),
            request_url,
            note,
        }),
    })
}

fn refuse_forge<T>(e: ForgeError) -> anyhow::Result<T> {
    refuse(e.to_string())
}

/// A Landing Story's row, for the Story's view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoryLanding {
    pub mode: String,
    pub forge: Option<String>,
    pub request_url: Option<String>,
    /// `unknown`, `open`, `merged` or `closed`.
    pub request_state: String,
    pub note: Option<String>,
}

/// The landing of a Story: a Landing Story's wait, or the note a closed request left on an In review
/// one. `None` for a Story that never landed.
pub fn landing_for_story(
    conn: &Connection,
    story_id: &str,
) -> anyhow::Result<Option<StoryLanding>> {
    conn.query_row(
        "SELECT mode, forge, request_url, request_state, note FROM landings WHERE story_id = ?1",
        params![story_id],
        |r| {
            Ok(StoryLanding {
                mode: r.get(0)?,
                forge: r.get(1)?,
                request_url: r.get(2)?,
                request_state: r.get(3)?,
                note: r.get(4)?,
            })
        },
    )
    .optional()
    .context("failed to read the Story's landing")
}

/// One Landing Story to ask the forge about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandingPlan {
    pub story_id: String,
    pub project_id: String,
    pub repo_path: String,
    pub branch: String,
    pub forge: Forge,
}

/// Phase one (database only): every Story in Landing, or just `only`.
pub fn landing_plans(conn: &Connection, only: Option<&str>) -> anyhow::Result<Vec<LandingPlan>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.project_id, p.repo_path, l.branch, l.forge
         FROM stories s JOIN landings l ON l.story_id = s.id JOIN projects p ON p.id = s.project_id
         WHERE s.state = 'landing' AND (?1 IS NULL OR s.id = ?1) AND l.forge IS NOT NULL",
    )?;
    let rows = stmt
        .query_map(params![only], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(story_id, project_id, repo_path, branch, forge)| {
            Some(LandingPlan {
                story_id,
                project_id,
                repo_path,
                branch,
                forge: Forge::parse(&forge)?,
            })
        })
        .collect())
}

/// What the forge said about a plan's request.
pub type RequestRead = Result<Option<crate::forge::Request>, ForgeError>;

/// Phase two (no connection): ask the forge.
pub fn read_request(cli: &ForgeCli, plan: &LandingPlan) -> RequestRead {
    cli.request_for_branch(plan.forge, Path::new(&plan.repo_path), &plan.branch)
}

/// Phase three (database, and the worktree's removal): act on the forge's answer. Returns whether
/// the board changed.
pub fn apply_request(
    conn: &mut Connection,
    plan: &LandingPlan,
    read: RequestRead,
) -> anyhow::Result<bool> {
    let Some(story) = get_story(conn, &plan.story_id)? else {
        return Ok(false);
    };
    // The Story may have been dropped while the CLI ran.
    if story.state != StoryState::Landing.as_str() {
        return Ok(false);
    }
    let actor = system_actor(conn)?.id;
    let now = now();
    let request = match read {
        Err(e) => return set_note(conn, &plan.story_id, Some(&e.to_string()), None, None, &now),
        Ok(None) if command_landing_without_request(conn, plan) => {
            return command_without_request(conn, plan, &story, &actor, &now);
        }
        Ok(None) => {
            return set_note(
                conn,
                &plan.story_id,
                Some(&format!(
                    "The forge has no request for {} yet.",
                    plan.branch
                )),
                None,
                None,
                &now,
            )
        }
        Ok(Some(request)) => request,
    };
    match request.state {
        RequestState::Open => set_note(
            conn,
            &plan.story_id,
            None,
            Some(&request.url),
            Some(RequestState::Open),
            &now,
        ),
        RequestState::Closed => {
            let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let note = format!(
                "The {} was closed without merging. Merge again to open a new one, or request changes.",
                plan.forge.request_word()
            );
            write_landing(
                &tx,
                &plan.story_id,
                Some(&note),
                Some(&request.url),
                Some(RequestState::Closed),
                &now,
            )?;
            set_story_state_in_tx(&tx, &actor, &plan.story_id, StoryState::InReview)?;
            record_event(
                &tx,
                &plan.project_id,
                "story",
                &plan.story_id,
                EventScope {
                    story_id: Some(&plan.story_id),
                    epic_id: Some(&story.epic_id),
                },
                &actor,
                "story.landing_closed",
                &serde_json::json!({
                    "request_url": request.url,
                    "label": format!("The {} of {} was closed without merging", plan.forge.request_word(), story.key),
                }),
                &now,
            )?;
            tx.commit()?;
            Ok(true)
        }
        RequestState::Merged => complete_merged(
            conn,
            plan,
            &story,
            &actor,
            Some(&request.url),
            // The forge's own merge commit. Only a forge that names none leaves the branch tip, which
            // is right for a fast-forward and wrong for a squash or rebase, so the tip is the fallback.
            request.merge_commit.as_deref(),
            &now,
        ),
    }
}

/// How long a Story that landed by a command may wait with no request on the forge before the
/// developer is told.
const COMMAND_NO_REQUEST_GRACE_SECS: i64 = 60 * 60;

fn command_landing_without_request(conn: &Connection, plan: &LandingPlan) -> bool {
    conn.query_row(
        "SELECT mode = 'command' FROM landings WHERE story_id = ?1",
        params![plan.story_id],
        |r| r.get(0),
    )
    .unwrap_or(false)
}

/// A landing command ran and the forge has no request for the branch. The command may have merged or
/// pushed straight to the base branch: when the branch's head is an ancestor of `origin/<base>`, the
/// Story is Merged (a merge or fast-forward landing; a squash needs a request to be seen at all).
/// Otherwise the Story waits quietly for an hour, then carries a note, which puts it in the
/// needs-you list, so it never waits silently for ever.
fn command_without_request(
    conn: &mut Connection,
    plan: &LandingPlan,
    story: &Story,
    actor: &str,
    now: &str,
) -> anyhow::Result<bool> {
    let (head, base, waited): (String, String, i64) = conn.query_row(
        "SELECT head_sha, base_branch, CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER)
         FROM landings WHERE story_id = ?1",
        params![plan.story_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<i64>>(2)?.unwrap_or(0))),
    )?;
    let repo = Path::new(&plan.repo_path);
    let on_base = git::fetch_origin(repo).is_ok()
        && git::git_output_at(
            repo,
            &[
                "merge-base",
                "--is-ancestor",
                &head,
                &format!("refs/remotes/origin/{base}"),
            ],
        )
        .map(|o| o.status.success())
        .unwrap_or(false);
    if on_base {
        let tip = git::rev_parse_commit(repo, &format!("refs/remotes/origin/{base}")).ok();
        return complete_merged(conn, plan, story, actor, None, tip.as_deref(), now);
    }
    if waited < COMMAND_NO_REQUEST_GRACE_SECS {
        return Ok(false);
    }
    set_note(
        conn,
        &plan.story_id,
        Some(&format!(
            "The landing command ran, but the forge has no {} for {} and its commits are not on {base} on origin. Check what the command did, then merge again or drop the Story.",
            plan.forge.request_word(),
            plan.branch
        )),
        None,
        None,
        now,
    )
}

/// The Story's request merged (or its commits reached the base branch): clean up and move it to Merged.
fn complete_merged(
    conn: &mut Connection,
    plan: &LandingPlan,
    story: &Story,
    actor: &str,
    url: Option<&str>,
    merge_commit: Option<&str>,
    now: &str,
) -> anyhow::Result<bool> {
    let Some(worktree) = worktree_for_story(conn, &plan.story_id)? else {
        return set_note(
            conn,
            &plan.story_id,
            Some("The request merged, but the Story has no worktree record to clean up. Drop the Story to close it."),
            None,
            None,
            now,
        );
    };
    let (head, base, overridden): (String, String, String) = conn.query_row(
        "SELECT head_sha, base_branch, failing_checks_overridden FROM landings WHERE story_id = ?1",
        params![plan.story_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let overridden: Vec<Value> = serde_json::from_str(&overridden).unwrap_or_default();
    let repo = Path::new(&plan.repo_path);
    let base_tip =
        git::rev_parse_commit(repo, &format!("refs/heads/{base}")).unwrap_or_else(|_| head.clone());
    let new_adrs = new_adrs_of(conn, story, repo, &base_tip, &head).unwrap_or_default();
    if let Some(url) = url {
        conn.execute(
            "UPDATE landings SET request_url = ?1 WHERE story_id = ?2",
            params![url, plan.story_id],
        )?;
    }
    finish_merge(
        conn,
        actor,
        MergeDone {
            story,
            worktree: &worktree,
            repo,
            head: &head,
            base: &base,
            merge_commit: merge_commit.map_or_else(|| head.clone(), str::to_string),
            method: MergeMethod::PullRequest,
            overridden,
            diff: None,
            new_adrs,
        },
    )?;
    Ok(true)
}

/// Write the note and the request's last state on a Story's landing row, only when something
/// differs (a tick that learns nothing new writes nothing).
fn write_landing(
    tx: &Transaction,
    story_id: &str,
    note: Option<&str>,
    url: Option<&str>,
    state: Option<RequestState>,
    now: &str,
) -> anyhow::Result<bool> {
    let changed = tx.execute(
        "UPDATE landings SET note = ?1, request_url = COALESCE(?2, request_url),
           request_state = COALESCE(?3, request_state), updated_at = ?4
         WHERE story_id = ?5 AND (note IS NOT ?1 OR request_url IS NOT COALESCE(?2, request_url)
           OR request_state IS NOT COALESCE(?3, request_state))",
        params![note, url, state.map(RequestState::as_str), now, story_id],
    )?;
    Ok(changed > 0)
}

fn set_note(
    conn: &mut Connection,
    story_id: &str,
    note: Option<&str>,
    url: Option<&str>,
    state: Option<RequestState>,
    now: &str,
) -> anyhow::Result<bool> {
    let tx = conn.transaction()?;
    let changed = write_landing(&tx, story_id, note, url, state, now)?;
    tx.commit()?;
    Ok(changed)
}

/// The cold tick's pass over every Landing Story. The board mutex is held only to read the plans
/// and the database file's path; the forge CLI, and the git that completing a merge runs, use a
/// connection of the tick's own (issue #215, ADR 0024). Returns every project whose board changed
/// (`None` for a project that could not be resolved).
pub fn landing_tick(db: &Mutex<Connection>, cli: &ForgeCli) -> HashSet<Option<String>> {
    // Phase one, under the lock: the plans, and where the database file is.
    let (plans, path) = {
        let Ok(conn) = db.lock() else {
            eprintln!("landing tick: the board database lock was poisoned, skipping this tick");
            return HashSet::new();
        };
        let plans = landing_plans(&conn, None).unwrap_or_else(|e| {
            eprintln!("landing tick: failed to read the Landing Stories: {e:#}");
            Vec::new()
        });
        (plans, conn.path().map(str::to_string))
    };
    if plans.is_empty() {
        return HashSet::new();
    }
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        eprintln!("landing tick: the board database has no file to open a second connection on");
        return HashSet::new();
    };
    // Phase two, with no connection in scope: the CLI.
    let reads: Vec<_> = plans.iter().map(|p| read_request(cli, p)).collect();
    // Phase three, on a connection beside the shared one: apply_request may fetch and read git.
    let mut changed = HashSet::new();
    let mut conn = match Connection::open(&path)
        .map_err(anyhow::Error::from)
        .and_then(|c| crate::db::apply_pragmas(&c).map(|()| c))
    {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("landing tick: failed to open a connection beside the board: {e:#}");
            return changed;
        }
    };
    for (plan, read) in plans.iter().zip(reads) {
        match apply_request(&mut conn, plan, read) {
            Ok(true) => {
                changed.insert(Some(plan.project_id.clone()));
            }
            Ok(false) => {}
            Err(e) => eprintln!(
                "landing tick: failed to record the request of Story {}: {e:#}",
                plan.story_id
            ),
        }
    }
    changed
}

/// "Check now": ask the forge about one Story at once, on a connection of the caller's own.
/// Returns the Story's landing afterwards, or `None` when the Story is not Landing.
pub fn refresh_landing(
    conn: &mut Connection,
    cli: &ForgeCli,
    story_id: &str,
) -> anyhow::Result<Option<StoryLanding>> {
    for plan in landing_plans(conn, Some(story_id))? {
        let read = read_request(cli, &plan);
        apply_request(conn, &plan, read)?;
    }
    landing_for_story(conn, story_id)
}
