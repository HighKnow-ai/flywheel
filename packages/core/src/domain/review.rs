//! Reviews (docs/mvp-spec.md §8, issue #155): what the developer judges an In review Story on, and
//! the record of that judgement.
//!
//! A `reviews` row is opened by the hand-off, in the transaction that moves the Story to In review
//! ([`open_review_in_tx`], called by `handoff::complete_handoff`), with the diff's size and the
//! Tasks left open. It is closed by the developer: Merge (`story_merge::merge_story`) or a request
//! for changes (`request_changes::request_changes`, which keeps the comments; a bare In review →
//! Running move in `story::set_story_state_in_tx` closes it without any). A Story has at most one
//! open review.
//!
//! [`review_for_story`] is the review card's read model. Each criterion carries its Check chip and
//! whether it is **pre-ticked** (its Check passed at the branch's current head); a pre-tick only
//! suggests, and Merge still needs every criterion accepted by the developer. A Check **needs the
//! override** unless it passed at the current head: failed, timed out, not run and stale all count
//! as failing at Merge. A branch that would conflict with its base branch reads **Rebase needed**
//! ([`StoryReview::conflicts`], issue #158): Merge refuses it, and the card offers a request for
//! changes pre-filled with [`rebase_comment`].
//!
//! Issue #157 adds, in the spec's order: the failing Checks sorted failed and timed out first, each
//! Check carrying the handing-off agent's objections to it, and the changed files of the review's
//! diff (`base_sha...` the branch's head now), whose patches [`review_file_patch`] reads one file at
//! a time.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

use crate::domain::acceptance_criterion::criteria_for_story;
use crate::domain::check::{self, CheckResult};
use crate::domain::story::get_story;
use crate::domain::worktree::{porcelain_entries, worktree_for_story};
use crate::git::ReviewFile;
use crate::domain::now;
use crate::ids::new_id;

/// A `reviews` row.
#[derive(Debug, Clone, PartialEq)]
pub struct Review {
    pub id: String,
    pub project_id: String,
    pub story_id: String,
    pub session_id: Option<String>,
    pub opened_at: String,
    pub base_sha: String,
    pub head_sha: String,
    pub files: i64,
    pub added: i64,
    pub removed: i64,
    pub open_tasks: i64,
    pub check_objections: Value,
    pub adr_notes: Value,
    /// `None` while open, then `changes_requested` or `merged`.
    pub outcome: Option<String>,
    pub comments: Option<String>,
    /// The Checks a "Merge with failing Check" overrode; `None` when Merge needed no override.
    pub failing_checks_overridden: Option<Value>,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
    /// The developer's Not an ADR and Wrong decision marks on the ADRs the branch adds (issue #164):
    /// a JSON array, read with `review_decisions::stored_adr_decisions`. Keep is not stored.
    pub adr_decisions: Value,
}

const SELECT_REVIEWS: &str = "SELECT id, project_id, story_id, session_id, opened_at, base_sha, head_sha, files, added,
    removed, open_tasks, check_objections, adr_notes, outcome, comments, failing_checks_overridden, decided_by, decided_at,
    adr_decisions FROM reviews";

fn json_column(row: &Row, index: usize) -> rusqlite::Result<Value> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(e)))
}

fn row_to_review(row: &Row) -> rusqlite::Result<Review> {
    let overridden: Option<String> = row.get(15)?;
    Ok(Review {
        id: row.get(0)?,
        project_id: row.get(1)?,
        story_id: row.get(2)?,
        session_id: row.get(3)?,
        opened_at: row.get(4)?,
        base_sha: row.get(5)?,
        head_sha: row.get(6)?,
        files: row.get(7)?,
        added: row.get(8)?,
        removed: row.get(9)?,
        open_tasks: row.get(10)?,
        check_objections: json_column(row, 11)?,
        adr_notes: json_column(row, 12)?,
        outcome: row.get(13)?,
        comments: row.get(14)?,
        failing_checks_overridden: overridden
            .map(|text| serde_json::from_str(&text))
            .transpose()
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(15, rusqlite::types::Type::Text, Box::new(e)))?,
        decided_by: row.get(16)?,
        decided_at: row.get(17)?,
        adr_decisions: json_column(row, 18)?,
    })
}

/// The Story's open review, if it has one.
pub fn open_review(conn: &Connection, story_id: &str) -> anyhow::Result<Option<Review>> {
    conn.query_row(&format!("{SELECT_REVIEWS} WHERE story_id = ?1 AND outcome IS NULL"), params![story_id], row_to_review)
        .optional()
        .context("failed to read the Story's open review")
}

/// The Story's most recent review, open or closed: what section 7 of the Context packet reads the
/// latest request for changes from.
pub fn latest_review(conn: &Connection, story_id: &str) -> anyhow::Result<Option<Review>> {
    conn.query_row(
        &format!("{SELECT_REVIEWS} WHERE story_id = ?1 ORDER BY opened_at DESC, id DESC LIMIT 1"),
        params![story_id],
        row_to_review,
    )
    .optional()
    .context("failed to read the Story's latest review")
}

/// Every review of a Story, oldest first: its review history.
pub fn reviews_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Vec<Review>> {
    let mut stmt = conn.prepare(&format!("{SELECT_REVIEWS} WHERE story_id = ?1 ORDER BY opened_at, id"))?;
    let rows = stmt.query_map(params![story_id], row_to_review)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Story's reviews")
}

/// The size of a Story's diff against its base branch, and the two commits it compares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewDiff {
    pub base_sha: String,
    pub head_sha: String,
    pub files: i64,
    pub added: i64,
    pub removed: i64,
}

/// Read the diff `base_branch...head_sha` from the checkout at `path` (a Story's worktree shares
/// its repository's refs): files changed, lines added and removed. A binary file counts as a file.
pub fn read_review_diff(path: &Path, base_branch: &str, head_sha: &str) -> anyhow::Result<ReviewDiff> {
    let base_sha = crate::git::rev_parse_commit(path, &format!("refs/heads/{base_branch}"))
        .with_context(|| format!("could not read the base branch {base_branch:?}"))?;
    let files = crate::git::review_files(path, &base_sha, head_sha)?;
    let sum = |count: fn(&crate::git::ReviewFile) -> Option<u32>| files.iter().filter_map(count).map(i64::from).sum();
    Ok(ReviewDiff {
        base_sha,
        head_sha: head_sha.to_string(),
        files: files.len() as i64,
        added: sum(|f| f.added),
        removed: sum(|f| f.removed),
    })
}

/// The Tasks of a Story still open or doing: what "n Tasks not done" counts at review.
pub(crate) fn tasks_not_done(conn: &Connection, story_id: &str) -> anyhow::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM tasks WHERE story_id = ?1 AND state IN ('open', 'doing')", params![story_id], |r| {
        r.get(0)
    })
    .context("failed to count the Story's open Tasks")
}

/// Open a review of `story_id` inside the caller's transaction, with the hand-off's Check
/// objections (`check_objections`, issue #157) and ADR bar lines (`adr_notes`, ADR 0010), each a
/// JSON array. Refused while one is open: a review closes before the next one opens.
pub(crate) fn open_review_in_tx(
    tx: &Transaction,
    project_id: &str,
    story_id: &str,
    session_id: Option<&str>,
    diff: &ReviewDiff,
    check_objections: &Value,
    adr_notes: &Value,
) -> anyhow::Result<String> {
    let open_tasks = tasks_not_done(tx, story_id)?;
    let id = new_id();
    tx.execute(
        "INSERT INTO reviews (id, project_id, story_id, session_id, opened_at, base_sha, head_sha, files, added, removed, open_tasks,
                              check_objections, adr_notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id, project_id, story_id, session_id, now(), diff.base_sha, diff.head_sha, diff.files, diff.added, diff.removed, open_tasks,
            check_objections.to_string(),
            adr_notes.to_string()
        ],
    )
    .context("failed to open the review; a Story has one open review at a time")?;
    Ok(id)
}

/// The diff to open `story_id`'s review from, read from its worktree, when it has no open review (a
/// Story handed off before reviews existed); `None` when one is open. A decision taken on such a Story
/// opens its review first, so the decision has a row to land on.
pub(crate) fn diff_to_open_review(conn: &Connection, story_id: &str, story_key: &str) -> anyhow::Result<Option<ReviewDiff>> {
    if open_review(conn, story_id)?.is_some() {
        return Ok(None);
    }
    let worktree = worktree_for_story(conn, story_id)?
        .filter(|w| Path::new(&w.path).is_dir())
        .with_context(|| format!("{story_key} has no worktree on disk to review. Recreate it, or drop the Story."))?;
    let path = Path::new(&worktree.path);
    Ok(Some(read_review_diff(path, &worktree.base_branch, &check::worktree_head(path)?)?))
}

/// Close the Story's open review with `outcome` and the developer's `comments`, as `actor_id`, inside
/// the caller's transaction. A Story with no open review (handed off before reviews existed) has
/// nothing to close.
pub(crate) fn close_review_in_tx(
    tx: &Transaction,
    story_id: &str,
    actor_id: &str,
    outcome: &str,
    failing_checks_overridden: Option<&Value>,
    comments: Option<&str>,
) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE reviews SET outcome = ?1, decided_by = ?2, decided_at = ?3, failing_checks_overridden = ?4, comments = ?5
         WHERE story_id = ?6 AND outcome IS NULL",
        params![outcome, actor_id, now(), failing_checks_overridden.map(Value::to_string), comments, story_id],
    )
    .context("failed to close the review")?;
    Ok(())
}

/// The handing-off agent's objection to a Check, as the review card shows it beside that Check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewObjection {
    pub why: String,
    /// The Check's command when the agent objected; it differs from the Check's own once the
    /// developer has edited the Check since.
    pub command: String,
}

/// A Check as the review card shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewCheck {
    pub check_id: String,
    pub criterion_id: String,
    pub command: String,
    pub result: CheckResult,
    /// The branch moved since this result ran.
    pub stale: bool,
    pub commit_sha: Option<String>,
    pub output_tail: Option<String>,
    /// The open review's objections to this Check, in the order the agent gave them.
    pub objections: Vec<ReviewObjection>,
}

impl ReviewCheck {
    /// Whether this Check passed at the branch's current head.
    pub fn passes(&self) -> bool {
        self.result == CheckResult::Passed && !self.stale
    }

    /// Where a failing Check sits on the card: failed and timed out first (their output tail is the
    /// news), then stale, then not run. Passed sorts last.
    fn failing_rank(&self) -> u8 {
        match (self.result, self.stale) {
            (CheckResult::Failed | CheckResult::TimedOut, false) => 0,
            (_, true) => 1,
            (CheckResult::NotRun, false) => 2,
            (CheckResult::Passed, false) => 3,
        }
    }

    /// The Check's state in words, as a refusal names it: `failed`, `timed out`, `not run`, `stale`.
    pub fn failing_words(&self) -> &'static str {
        match (self.result, self.stale) {
            (_, true) => "stale",
            (CheckResult::Failed, _) => "failed",
            (CheckResult::TimedOut, _) => "timed out",
            (CheckResult::NotRun, _) => "not run",
            (CheckResult::Passed, false) => "passed",
        }
    }

    /// The record a "Merge with failing Check" keeps of this Check.
    pub fn override_record(&self) -> Value {
        serde_json::json!({
            "check_id": self.check_id,
            "command": self.command,
            "result": self.result.as_str(),
            "stale": self.stale,
        })
    }
}

/// An Acceptance criterion as the review card shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewCriterion {
    pub id: String,
    pub statement: String,
    pub accepted: bool,
    pub accepted_at: Option<String>,
    /// Its Check passed at the current head: the card suggests accepting it. Never an acceptance.
    pub pre_ticked: bool,
    /// `None`: no Check, judged at review.
    pub check: Option<ReviewCheck>,
}

/// The review card's read model for one Story.
#[derive(Debug, Clone, PartialEq)]
pub struct StoryReview {
    pub story_id: String,
    pub story_key: String,
    pub story_state: String,
    /// The Story branch's head now, read from its worktree; `None` without a worktree on disk.
    pub head_sha: Option<String>,
    /// The open review; `None` for a Story not In review, or handed off before reviews existed.
    pub review: Option<Review>,
    pub criteria: Vec<ReviewCriterion>,
    /// Tasks open or doing now.
    pub open_tasks: i64,
    /// The Checks that need "Merge with failing Check": failed and timed out first, then stale, then
    /// not run, each group in criteria order.
    pub failing_checks: Vec<ReviewCheck>,
    /// A session of the Story is running or blocked.
    pub live_session: bool,
    /// Uncommitted paths in the Story's worktree, as `git status --porcelain` names them.
    pub uncommitted: Vec<String>,
    /// The base branch the Story merges into; `None` without a worktree.
    pub base_branch: Option<String>,
    /// The paths a merge into the base branch would conflict in, sorted: Rebase needed when not
    /// empty. Only an In review Story is checked.
    pub conflicts: Vec<String>,
    /// The changed files of the review's diff, `base_sha...` the branch's head now; empty without an
    /// open review.
    pub files: Vec<ReviewFile>,
}

impl StoryReview {
    /// The criteria the developer has not accepted yet.
    pub fn unaccepted(&self) -> impl Iterator<Item = &ReviewCriterion> {
        self.criteria.iter().filter(|c| !c.accepted)
    }

    /// The request for changes Rebase needed pre-fills, or `None` when the branch merges cleanly.
    pub fn rebase_comment(&self) -> Option<String> {
        match (&self.base_branch, self.conflicts.is_empty()) {
            (Some(base), false) => Some(rebase_comment(base, &self.conflicts)),
            _ => None,
        }
    }
}

/// The comment a Rebase needed request for changes starts from, naming the base branch and every
/// conflicting path.
pub fn rebase_comment(base_branch: &str, conflicts: &[String]) -> String {
    format!(
        "Rebase needed: merging into {base_branch} would conflict in {}. Rebase this branch on {base_branch}, resolve \
         those conflicts, and re-run the Checks before handing off.",
        conflicts.join(", ")
    )
}

fn repo_path(conn: &Connection, project_id: &str) -> anyhow::Result<String> {
    conn.query_row("SELECT repo_path FROM projects WHERE id = ?1", params![project_id], |r| r.get(0))
        .context("failed to read the project's repository")
}

/// Rebase needed for `story_id`, without the rest of the card: the paths a merge of its branch's head
/// into its base branch would conflict in. Empty for a Story not In review or without a worktree on
/// disk. What Needs you labels a Review item by.
pub fn conflicts_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Vec<String>> {
    let Some(story) = get_story(conn, story_id)? else { return Ok(Vec::new()) };
    if story.state != "in_review" {
        return Ok(Vec::new());
    }
    let Some(worktree) = worktree_for_story(conn, story_id)?.filter(|w| Path::new(&w.path).is_dir()) else {
        return Ok(Vec::new());
    };
    let head = check::worktree_head(Path::new(&worktree.path))?;
    Ok(merge_conflicts(Path::new(&repo_path(conn, &story.project_id)?), &worktree.base_branch, &head))
}

/// The paths merging `head` into the base branch would conflict in, read with `git merge-tree` in the
/// project's repository (nothing is written). Best-effort: the card must still open when git cannot
/// answer, so a failure reads as no conflict and Merge's own check refuses later.
fn merge_conflicts(repo: &Path, base_branch: &str, head: &str) -> Vec<String> {
    let check = crate::git::rev_parse_commit(repo, &format!("refs/heads/{base_branch}"))
        .and_then(|base_tip| crate::git::merge_tree_check(repo, &base_tip, head));
    match check {
        Ok(crate::git::MergePrecheck::Conflicts(paths)) => paths,
        Ok(_) => Vec::new(),
        Err(e) => {
            eprintln!("review card: could not check {head} against {base_branch} for conflicts: {e:#}");
            Vec::new()
        }
    }
}

/// The review card for `story_id`: criteria with their Check chips and pre-ticks, the Tasks not
/// done, the failing Checks, and what would stop a Merge now. Reads git (the worktree's head and
/// status) but writes nothing.
pub fn review_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<StoryReview> {
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    let worktree = worktree_for_story(conn, story_id)?;
    let on_disk = worktree.as_ref().map(|w| Path::new(&w.path)).filter(|p| p.is_dir());
    let head_sha = on_disk.map(check::worktree_head).transpose()?;
    let uncommitted = match on_disk {
        Some(path) => porcelain_entries(path)?.into_iter().map(|e| e.path).collect(),
        None => Vec::new(),
    };

    let review = open_review(conn, story_id)?;
    let objections = review.as_ref().map(|r| objections_by_criterion(&r.check_objections)).unwrap_or_default();

    let mut criteria = Vec::new();
    let mut failing_checks = Vec::new();
    for c in criteria_for_story(conn, story_id)? {
        let check = match check::check_for_criterion(conn, &c.id)? {
            Some(k) => {
                let current = check::current_result(conn, &k.id)?;
                Some(ReviewCheck {
                    check_id: k.id,
                    criterion_id: c.id.clone(),
                    command: k.command,
                    result: current.result,
                    stale: current.is_stale(head_sha.as_deref()),
                    commit_sha: current.commit_sha,
                    output_tail: current.output_tail,
                    objections: objections.iter().filter(|(id, _)| *id == c.id).map(|(_, o)| o.clone()).collect(),
                })
            }
            None => None,
        };
        if let Some(k) = check.as_ref().filter(|k| !k.passes()) {
            failing_checks.push(k.clone());
        }
        criteria.push(ReviewCriterion {
            pre_ticked: check.as_ref().is_some_and(ReviewCheck::passes),
            id: c.id,
            statement: c.statement,
            accepted: c.accepted_by.is_some(),
            accepted_at: c.accepted_at,
            check,
        });
    }

    failing_checks.sort_by_key(ReviewCheck::failing_rank);

    let files = match (&review, review_checkout(conn, story_id, on_disk)?) {
        (Some(r), Some(path)) => {
            crate::git::review_files(&path, &r.base_sha, head_sha.as_deref().unwrap_or(&r.head_sha))?
        }
        _ => Vec::new(),
    };

    let live_session: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sessions WHERE story_id = ?1 AND status IN ('running', 'blocked'))",
        params![story_id],
        |r| r.get(0),
    )?;

    let base_branch = worktree.as_ref().map(|w| w.base_branch.clone());
    let conflicts = match (story.state == "in_review", &base_branch, &head_sha) {
        (true, Some(base), Some(head)) => merge_conflicts(Path::new(&repo_path(conn, &story.project_id)?), base, head),
        _ => Vec::new(),
    };

    Ok(StoryReview {
        story_id: story.id,
        story_key: story.key,
        story_state: story.state,
        head_sha,
        review,
        criteria,
        open_tasks: tasks_not_done(conn, story_id)?,
        failing_checks,
        live_session,
        uncommitted,
        base_branch,
        conflicts,
        files,
    })
}

/// The stored objections as `(criterion_id, objection)` pairs. An entry that does not parse is
/// skipped: the review card shows what it can.
fn objections_by_criterion(stored: &Value) -> Vec<(String, ReviewObjection)> {
    stored
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|o| {
            let text = |key: &str| o.get(key).and_then(Value::as_str).map(str::to_string);
            Some((text("criterion_id")?, ReviewObjection { why: text("why")?, command: text("command").unwrap_or_default() }))
        })
        .collect()
}

/// Where the review's diff is read from: the Story's worktree when it is on disk, else the
/// project's repository, which shares its refs.
fn review_checkout(conn: &Connection, story_id: &str, worktree: Option<&Path>) -> anyhow::Result<Option<std::path::PathBuf>> {
    if let Some(path) = worktree {
        return Ok(Some(path.to_path_buf()));
    }
    let repo: Option<String> = conn
        .query_row(
            "SELECT p.repo_path FROM projects p JOIN stories s ON s.project_id = p.id WHERE s.id = ?1",
            params![story_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(repo.map(std::path::PathBuf::from).filter(|p| p.is_dir()))
}

/// Where one review's patches are read from, resolved from the board without running git: the
/// open review's base, and the Story's worktree (or, without one on disk, the repository and the
/// head recorded at hand-off). A caller holding a shared connection resolves this, lets go of the
/// connection, then calls [`PatchSource::patch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchSource {
    checkout: std::path::PathBuf,
    base_sha: String,
    /// `None`: read the worktree's head when the patch is read.
    head_sha: Option<String>,
}

impl PatchSource {
    /// One changed file's patch, `base_sha...` the branch's head now, as `git diff` prints it.
    /// `old_path` is a rename's source.
    pub fn patch(&self, path: &str, old_path: Option<&str>) -> anyhow::Result<String> {
        let head = match &self.head_sha {
            Some(sha) => sha.clone(),
            None => check::worktree_head(&self.checkout)?,
        };
        crate::git::review_patch(&self.checkout, &self.base_sha, &head, path, old_path)
    }
}

/// Resolve where the open review of `story_id` reads its patches from. Runs no git.
pub fn review_patch_source(conn: &Connection, story_id: &str) -> anyhow::Result<PatchSource> {
    let review = open_review(conn, story_id)?.context("this Story has no open review")?;
    let worktree = worktree_for_story(conn, story_id)?;
    let on_disk = worktree.as_ref().map(|w| Path::new(&w.path)).filter(|p| p.is_dir());
    let checkout = review_checkout(conn, story_id, on_disk)?.context("neither the worktree nor the repository is on disk")?;
    Ok(PatchSource {
        checkout,
        base_sha: review.base_sha,
        head_sha: if on_disk.is_some() { None } else { Some(review.head_sha) },
    })
}

/// One changed file's patch in the open review's diff (`base_sha...` the branch's head now). The
/// range is read here, never taken from the caller.
pub fn review_file_patch(conn: &Connection, story_id: &str, path: &str, old_path: Option<&str>) -> anyhow::Result<String> {
    review_patch_source(conn, story_id)?.patch(path, old_path)
}
