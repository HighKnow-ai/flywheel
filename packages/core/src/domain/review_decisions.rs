//! The review's Decisions section (docs/mvp-spec.md §8, issue #161, ADR 0010): what a Story changes in
//! the repo's knowledge, `docs/adr/` and `GLOSSARY.md`, listed apart from its code, with a count.
//!
//! Each ADR the branch adds is a card carrying:
//! - its **bar lines**: from the hand-off (stored on the review as `adr_notes`), or else from the ADR
//!   Proposal accepted on the Epic in shaping, or none. They are never read out of the file;
//! - its **related live ADRs**: the ADRs its "Relates to" line names, resolved against the ADRs live
//!   on the base branch (the supersession walk of the Context packet's index, read from git);
//! - the developer's decision on it ([`AdrDecision`], issue #164, ADR 0016): **Keep** by default, not
//!   stored; **Not an ADR** or **Wrong decision** (what is wrong, what it should be), stored on the open
//!   review by [`set_adr_decision`]. While either is on a new ADR, Merge refuses (`story_merge`).
//!
//! Each ADR change also carries its **flags** ([`DecisionFlag`], issue #164), read from git and never
//! stored: an existing ADR with a changed line other than `Status:` ("wording or supersede?"), a new
//! ADR whose number another file holds on the base branch's tip ("renumber"), and a new ADR that says
//! "Supersedes ADR-NNNN" while the old file, at the branch's head, has no `Status: superseded by`
//! line. [`ReviewDecisions::review_points`] turns the decisions and the last two flags into the review
//! points a request for changes carries (`request_changes`).
//!
//! [`review_decisions`] reads the board and git and writes nothing. Merge links each new ADR to the
//! Story by path ([`new_adr_paths`], `story_merge`), except one accepted in shaping, which keeps its
//! Epic Proposal.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::context_packet::{adr_line, adr_numbers, is_superseded_status, leading_number, live_adrs_at, supersedes_numbers};
use crate::domain::actor::assert_human_actor;
use crate::domain::proposal_apply::{is_adr_path, AdrBarLines, AdrDraft};
use crate::domain::review::{diff_to_open_review, open_review, open_review_in_tx};
use crate::domain::story::{get_story, StoryState};
use crate::domain::worktree::worktree_for_story;
use crate::domain::{now, record_event, EventScope};
use crate::git::{self, ReviewFile};

/// The repo's glossary, at the repository root.
pub const GLOSSARY_PATH: &str = "GLOSSARY.md";

/// Which kind of repo knowledge a change touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionKind {
    /// A file under `docs/adr/`.
    Adr,
    /// `GLOSSARY.md`.
    Glossary,
}

impl DecisionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DecisionKind::Adr => "adr",
            DecisionKind::Glossary => "glossary",
        }
    }

    /// The kind of decision a changed path is, or `None` for code.
    pub fn of(path: &str) -> Option<Self> {
        if path.starts_with("docs/adr/") {
            Some(DecisionKind::Adr)
        } else if path == GLOSSARY_PATH {
            Some(DecisionKind::Glossary)
        } else {
            None
        }
    }
}

/// Where a new ADR's bar lines came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarLinesSource {
    /// The hand-off's `adrs`.
    Handoff,
    /// The ADR Proposal accepted on the Epic in shaping.
    Shaping,
}

impl BarLinesSource {
    pub fn as_str(self) -> &'static str {
        match self {
            BarLinesSource::Handoff => "handoff",
            BarLinesSource::Shaping => "shaping",
        }
    }
}

/// The developer's decision on an ADR the branch adds (docs/mvp-spec.md §8, issue #164).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AdrDecision {
    /// The default: the ADR merges as written. Not stored.
    #[default]
    Keep,
    /// The decision does not belong in `docs/adr/`: the agent deletes the file.
    NotAnAdr,
    /// The decision itself is wrong: the agent changes the code and the ADR.
    WrongDecision { what_is_wrong: String, should_be: String },
}

impl AdrDecision {
    pub fn as_str(&self) -> &'static str {
        match self {
            AdrDecision::Keep => "keep",
            AdrDecision::NotAnAdr => "not_an_adr",
            AdrDecision::WrongDecision { .. } => "wrong_decision",
        }
    }

    /// The decision as the card and a refusal name it.
    pub fn words(&self) -> &'static str {
        match self {
            AdrDecision::Keep => "Keep",
            AdrDecision::NotAnAdr => "Not an ADR",
            AdrDecision::WrongDecision { .. } => "Wrong decision",
        }
    }

    /// Whether this decision holds Merge: anything but Keep.
    pub fn holds_merge(&self) -> bool {
        *self != AdrDecision::Keep
    }

    /// The review point a request for changes carries for the ADR at `path`; `None` for Keep.
    pub fn review_point(&self, path: &str) -> Option<String> {
        match self {
            AdrDecision::Keep => None,
            AdrDecision::NotAnAdr => Some(format!("Delete `{path}`; keep the decision out of docs/adr.")),
            AdrDecision::WrongDecision { what_is_wrong, should_be } => Some(format!(
                "Wrong decision in `{path}`: {}. It should be: {}. Change the code and the ADR.",
                sentence(what_is_wrong),
                sentence(should_be)
            )),
        }
    }
}

/// The developer's words, trimmed, without a closing full stop (the review point adds its own).
fn sentence(text: &str) -> &str {
    text.trim().trim_end_matches('.').trim_end()
}

/// A decision stored on the open review (`reviews.adr_decisions`): never Keep.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAdrDecision {
    pub path: String,
    pub decision: AdrDecision,
}

/// The decisions stored in a review's `adr_decisions`, in stored order. An entry that no longer reads
/// as one is skipped.
pub fn stored_adr_decisions(value: &Value) -> Vec<StoredAdrDecision> {
    let text = |entry: &Value, key: &str| entry.get(key).and_then(Value::as_str).map(str::to_string);
    value
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let path = text(entry, "path")?;
                    let decision = match entry.get("decision").and_then(Value::as_str)? {
                        "not_an_adr" => AdrDecision::NotAnAdr,
                        "wrong_decision" => AdrDecision::WrongDecision {
                            what_is_wrong: text(entry, "what_is_wrong")?,
                            should_be: text(entry, "should_be")?,
                        },
                        _ => return None,
                    };
                    Some(StoredAdrDecision { path, decision })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn stored_entry(path: &str, decision: &AdrDecision) -> Value {
    match decision {
        AdrDecision::WrongDecision { what_is_wrong, should_be } => json!({
            "path": path,
            "decision": decision.as_str(),
            "what_is_wrong": what_is_wrong.trim(),
            "should_be": should_be.trim(),
        }),
        _ => json!({ "path": path, "decision": decision.as_str() }),
    }
}

/// What the Decisions section flags on an ADR change (issue #164). Read from git, never stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecisionFlag {
    /// An existing ADR with a changed line other than its `Status:` line: is this a wording fix, or a
    /// changed decision that should be a new ADR superseding it?
    WordingOrSupersede,
    /// A new ADR whose number another file holds on the base branch's tip.
    Renumber { number: u32, taken_by: String, base_branch: String },
    /// A new ADR supersedes ADR `number`, whose file at the branch's head has no
    /// `Status: superseded by` line.
    SupersessionLineMissing { superseded: String, number: u32 },
}

impl DecisionFlag {
    pub fn as_str(&self) -> &'static str {
        match self {
            DecisionFlag::WordingOrSupersede => "wording_or_supersede",
            DecisionFlag::Renumber { .. } => "renumber",
            DecisionFlag::SupersessionLineMissing { .. } => "supersession_line_missing",
        }
    }

    /// The review point a request for changes carries for this flag on the ADR at `path`. Wording or
    /// supersede? is the developer's own question, so it has none.
    pub fn review_point(&self, path: &str) -> Option<String> {
        match self {
            DecisionFlag::WordingOrSupersede => None,
            DecisionFlag::Renumber { taken_by, base_branch, .. } => Some(format!(
                "Renumber `{path}`: {} is already taken on {base_branch} by `{taken_by}`.",
                adr_label(path)
            )),
            DecisionFlag::SupersessionLineMissing { superseded, .. } => Some(format!(
                "Add a `Status: superseded by {}` line to `{superseded}`, which `{path}` supersedes.",
                adr_label(path)
            )),
        }
    }
}

/// "ADR-0007" from `docs/adr/0007-slug.md`, keeping the file's own digits; the file name without a
/// number.
pub fn adr_label(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    let digits: String = name.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        name.trim_end_matches(".md").to_string()
    } else {
        format!("ADR-{digits}")
    }
}

/// A live ADR on the base branch that a new ADR relates to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelatedAdr {
    pub path: String,
    pub title: String,
}

/// A new ADR's card.
#[derive(Debug, Clone, PartialEq)]
pub struct NewAdr {
    /// Its `# ` heading at the branch's head, or its file name.
    pub title: String,
    /// `None`: neither the hand-off nor shaping gave any ("no bar lines").
    pub bar_lines: Option<AdrBarLines>,
    pub bar_lines_from: Option<BarLinesSource>,
    /// The live ADRs on the base branch its "Relates to" names, in the order named.
    pub related: Vec<RelatedAdr>,
    /// The ADR Proposal accepted on the Epic in shaping at this path, if any.
    pub proposal_id: Option<String>,
    /// The developer's decision on it, stored on the open review; Keep when none is.
    pub decision: AdrDecision,
}

/// One changed file of the Decisions section.
#[derive(Debug, Clone, PartialEq)]
pub struct DecisionChange {
    pub kind: DecisionKind,
    pub path: String,
    /// The path it was renamed or copied from.
    pub old_path: Option<String>,
    /// git's status letter: `A`, `M`, `D`, `R`, `C`, `T`.
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    /// Set for an ADR the branch adds.
    pub new_adr: Option<NewAdr>,
    /// What the section flags on it, in [`DecisionFlag`] order; always empty for the glossary.
    pub flags: Vec<DecisionFlag>,
}

/// The Decisions section of a Story's review: its ADR changes by path, then its glossary change.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ReviewDecisions {
    pub changes: Vec<DecisionChange>,
    /// The decisions stored on the open review, in stored order.
    pub decisions: Vec<StoredAdrDecision>,
}

impl ReviewDecisions {
    /// The count the section's heading shows.
    pub fn count(&self) -> usize {
        self.changes.len()
    }

    /// The decision stored on the ADR at `path`; Keep when none is.
    pub fn decision_on(&self, path: &str) -> AdrDecision {
        self.decisions.iter().find(|d| d.path == path).map(|d| d.decision.clone()).unwrap_or_default()
    }

    /// The review points a request for changes carries, by ADR path: each ADR's decision, then its
    /// renumber and supersession flags. An ADR marked Not an ADR is deleted, so its flags are moot. A
    /// decision on a path no longer in the diff still goes, last.
    pub fn review_points(&self) -> Vec<String> {
        let mut points = Vec::new();
        for change in &self.changes {
            let decision = self.decision_on(&change.path);
            points.extend(decision.review_point(&change.path));
            if decision != AdrDecision::NotAnAdr {
                points.extend(change.flags.iter().filter_map(|flag| flag.review_point(&change.path)));
            }
        }
        for stored in self.decisions.iter().filter(|d| !self.changes.iter().any(|c| c.path == d.path)) {
            points.extend(stored.decision.review_point(&stored.path));
        }
        points
    }
}

/// Whether a changed file is an ADR the branch adds.
pub fn is_new_adr(file: &ReviewFile) -> bool {
    file.status == "A" && is_adr_path(&file.path)
}

/// The paths of the ADRs a diff adds, in diff order.
pub fn new_adr_paths(files: &[ReviewFile]) -> Vec<String> {
    files.iter().filter(|f| is_new_adr(f)).map(|f| f.path.clone()).collect()
}

/// The ADR Proposals accepted on `epic_id` in shaping, as `(proposal id, draft)`, oldest first. A
/// payload that no longer reads as a draft is skipped.
pub fn accepted_epic_adrs(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<(String, AdrDraft)>> {
    let mut stmt = conn.prepare(
        "SELECT id, payload FROM proposals
         WHERE epic_id = ?1 AND verb = 'create' AND target_type = 'adr' AND state = 'accepted'
         ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map(params![epic_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Epic's accepted ADR Proposals")?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, payload)| {
            let value = serde_json::from_str(&payload).ok()?;
            AdrDraft::from_payload(&value).ok().map(|draft| (id, draft))
        })
        .collect())
}

/// The file at `path` in `rev`, or `None` when it cannot be read there.
fn file_at(repo: &Path, rev: &str, path: &str) -> Option<String> {
    git::git_at(repo, &["show", &format!("{rev}:{path}")]).ok().map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The ADR's `# ` heading in `text`, or its file name when it has none.
fn adr_title(text: Option<&str>, path: &str) -> String {
    text.and_then(|text| text.lines().find_map(|line| line.trim().strip_prefix("# ").map(|t| t.trim().to_string())))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md").to_string())
}

/// The file names directly under `docs/adr/` in `rev`.
fn adr_names_at(repo: &Path, rev: &str) -> anyhow::Result<Vec<String>> {
    let listed = git::git_at(repo, &["ls-tree", "-z", "--name-only", rev, "docs/adr/"])?;
    Ok(String::from_utf8_lossy(&listed.stdout)
        .split('\0')
        .filter_map(|p| p.strip_prefix("docs/adr/"))
        .filter(|n| n.ends_with(".md") && !n.contains('/'))
        .map(str::to_string)
        .collect())
}

/// Whether a patch changes a line other than a `Status:` line. Blank lines do not count.
fn rewords(patch: &str) -> bool {
    patch
        .lines()
        .skip_while(|line| !line.starts_with("@@"))
        .filter(|line| !line.starts_with("@@") && !line.starts_with('\\'))
        .filter_map(|line| line.strip_prefix('+').or_else(|| line.strip_prefix('-')))
        .map(adr_line)
        .any(|line| !line.is_empty() && !line.starts_with("status:"))
}

/// Whether an ADR's text carries a `Status: superseded by` line.
fn marked_superseded(text: &str) -> bool {
    text.lines().any(|line| is_superseded_status(&adr_line(line)))
}

/// The live ADRs `relates_to` names by number, each once, in the order named.
fn related_live_adrs(relates_to: &str, live: &[RelatedAdr]) -> Vec<RelatedAdr> {
    let mut related: Vec<RelatedAdr> = Vec::new();
    for n in adr_numbers(&relates_to.to_lowercase()) {
        for adr in live {
            let name = adr.path.strip_prefix("docs/adr/").unwrap_or(&adr.path);
            if leading_number(name) == Some(n) && !related.contains(adr) {
                related.push(adr.clone());
            }
        }
    }
    related
}

/// The Decisions section of `story_id`'s review. The diff is the open review's `base_sha` against
/// the Story branch's tip (or, without them, the base branch's tip and the review's head); a Story
/// whose commits cannot be read has an empty section.
pub fn review_decisions(conn: &Connection, story_id: &str) -> anyhow::Result<ReviewDecisions> {
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    let (repo_path, default_branch): (String, String) = conn.query_row(
        "SELECT repo_path, default_branch FROM projects WHERE id = ?1",
        params![story.project_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let repo = Path::new(&repo_path);
    if !repo.is_dir() {
        return Ok(ReviewDecisions::default());
    }
    let review = open_review(conn, story_id)?;
    let worktree = worktree_for_story(conn, story_id)?;
    let base_branch = worktree.as_ref().map_or(default_branch, |w| w.base_branch.clone());
    let commit = |rev: &str| git::rev_parse_commit(repo, rev).ok();
    let base_tip = commit(&format!("refs/heads/{base_branch}"));
    let head = worktree
        .as_ref()
        .and_then(|w| commit(&format!("refs/heads/{}", w.branch)))
        .or_else(|| review.as_ref().map(|r| r.head_sha.clone()));
    let base = review.as_ref().map(|r| r.base_sha.clone()).or_else(|| base_tip.clone());
    let decisions = review.as_ref().map(|r| stored_adr_decisions(&r.adr_decisions)).unwrap_or_default();
    let (Some(base), Some(head)) = (base, head) else { return Ok(ReviewDecisions { changes: Vec::new(), decisions }) };

    let mut changes: Vec<DecisionChange> = git::review_files(repo, &base, &head)?
        .into_iter()
        .filter_map(|f| {
            let kind = DecisionKind::of(&f.path)?;
            Some(DecisionChange {
                kind,
                path: f.path.clone(),
                old_path: f.old_path.clone(),
                status: f.status.clone(),
                added: f.added,
                removed: f.removed,
                new_adr: None,
                flags: Vec::new(),
            })
        })
        .collect();
    changes.sort_by(|a, b| (a.kind == DecisionKind::Glossary, &a.path).cmp(&(b.kind == DecisionKind::Glossary, &b.path)));
    let live_at = base_tip.as_deref().unwrap_or(&base);

    // Wording or supersede?: an existing ADR with a changed line other than its Status: line.
    for change in changes.iter_mut().filter(|c| c.kind == DecisionKind::Adr && matches!(c.status.as_str(), "M" | "R")) {
        let patch = git::review_patch(repo, &base, &head, &change.path, change.old_path.as_deref())?;
        if rewords(&patch) {
            change.flags.push(DecisionFlag::WordingOrSupersede);
        }
    }

    if changes.iter().any(|c| c.status == "A" && is_adr_path(&c.path)) {
        let notes: Vec<AdrBarLines> = review
            .as_ref()
            .and_then(|r| r.adr_notes.as_array())
            .map(|notes| notes.iter().filter_map(|n| AdrBarLines::from_payload(n).ok()).collect())
            .unwrap_or_default();
        let shaped = accepted_epic_adrs(conn, &story.epic_id)?;
        let live: Vec<RelatedAdr> = live_adrs_at(repo, live_at)?
            .into_iter()
            .map(|a| RelatedAdr { path: a.path, title: a.title })
            .collect();
        let new_paths: Vec<String> =
            changes.iter().filter(|c| c.status == "A" && is_adr_path(&c.path)).map(|c| c.path.clone()).collect();
        let on_base = adr_names_at(repo, live_at)?;
        // The ADRs at the branch's head that it does not add: the ones a new ADR can supersede.
        let older: Vec<String> = adr_names_at(repo, &head)?
            .into_iter()
            .map(|name| format!("docs/adr/{name}"))
            .filter(|path| !new_paths.contains(path))
            .collect();
        for change in changes.iter_mut().filter(|c| c.status == "A" && is_adr_path(&c.path)) {
            let name = change.path.strip_prefix("docs/adr/").unwrap_or(&change.path).to_string();
            let number = leading_number(&name);
            let text = file_at(repo, &head, &change.path);

            // Renumber: another file holds this number on the base branch's tip.
            if let Some(n) = number {
                if let Some(taken) = on_base.iter().find(|other| **other != name && leading_number(other) == Some(n)) {
                    change.flags.push(DecisionFlag::Renumber {
                        number: n,
                        taken_by: format!("docs/adr/{taken}"),
                        base_branch: base_branch.clone(),
                    });
                }
            }
            // Supersession line missing: an ADR this one supersedes has no Status: superseded by line.
            let mut superseded: Vec<u32> = Vec::new();
            for line in text.as_deref().unwrap_or_default().lines() {
                for n in supersedes_numbers(&adr_line(line)) {
                    if Some(n) != number && !superseded.contains(&n) {
                        superseded.push(n);
                    }
                }
            }
            for n in superseded {
                for old in older.iter().filter(|p| leading_number(p.strip_prefix("docs/adr/").unwrap_or(p)) == Some(n)) {
                    if file_at(repo, &head, old).is_some_and(|old_text| !marked_superseded(&old_text)) {
                        change.flags.push(DecisionFlag::SupersessionLineMissing { superseded: old.clone(), number: n });
                    }
                }
            }

            let proposal = shaped.iter().find(|(_, d)| d.path == change.path);
            let (bar_lines, bar_lines_from) = match notes.iter().find(|n| n.path == change.path) {
                Some(note) => (Some(note.clone()), Some(BarLinesSource::Handoff)),
                None => match proposal {
                    Some((_, draft)) => (Some(draft.bar_lines()), Some(BarLinesSource::Shaping)),
                    None => (None, None),
                },
            };
            let related = bar_lines
                .as_ref()
                .and_then(|b| b.relates_to.as_deref())
                .map(|r| related_live_adrs(r, &live))
                .unwrap_or_default();
            change.new_adr = Some(NewAdr {
                title: adr_title(text.as_deref(), &change.path),
                bar_lines,
                bar_lines_from,
                related,
                proposal_id: proposal.map(|(id, _)| id.clone()),
                decision: decisions.iter().find(|d| d.path == change.path).map(|d| d.decision.clone()).unwrap_or_default(),
            });
        }
    }
    Ok(ReviewDecisions { changes, decisions })
}

/// Set the developer's decision on the new ADR at `path` of `story_id`'s review, as `actor_id`: Keep
/// removes the stored one. Human-only; the Story must be In review and `path` an ADR its branch adds.
/// A Wrong decision needs both what is wrong and what it should be. Neither decision sends the Story
/// back by itself: Merge refuses while one is stored, and Request changes carries it to the agent.
pub fn set_adr_decision(
    conn: &mut Connection,
    actor_id: &str,
    story_id: &str,
    path: &str,
    decision: &AdrDecision,
) -> anyhow::Result<()> {
    assert_human_actor(conn, actor_id)?;
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    anyhow::ensure!(
        story.state == StoryState::InReview.as_str(),
        "Only a Story In review takes a decision on its ADRs, and {} is {}.",
        story.key,
        story.state.replace('_', " ")
    );
    if let AdrDecision::WrongDecision { what_is_wrong, should_be } = decision {
        anyhow::ensure!(
            !what_is_wrong.trim().is_empty() && !should_be.trim().is_empty(),
            "Wrong decision needs both: what is wrong, and what it should be."
        );
    }
    let section = review_decisions(conn, story_id)?;
    anyhow::ensure!(
        section.changes.iter().any(|c| c.path == path && c.new_adr.is_some()),
        "`{path}` is not an ADR this branch adds: only a new ADR takes Keep, Not an ADR or Wrong decision."
    );
    let diff = diff_to_open_review(conn, story_id, &story.key)?;

    let now = now();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(diff) = &diff {
        open_review_in_tx(&tx, &story.project_id, story_id, None, diff, &Value::Array(Vec::new()), &Value::Array(Vec::new()))?;
    }
    let (review_id, stored): (String, String) = tx
        .query_row("SELECT id, adr_decisions FROM reviews WHERE story_id = ?1 AND outcome IS NULL", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .context("failed to read the open review")?;
    let mut entries: Vec<Value> = serde_json::from_str::<Value>(&stored)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry.get("path").and_then(Value::as_str) != Some(path))
        .collect();
    if decision.holds_merge() {
        entries.push(stored_entry(path, decision));
    }
    tx.execute(
        "UPDATE reviews SET adr_decisions = ?1 WHERE id = ?2",
        params![Value::Array(entries).to_string(), review_id],
    )
    .context("failed to store the ADR decision")?;
    let label = match decision {
        AdrDecision::Keep => format!("Kept {path}"),
        _ => format!("Marked {path} {}", decision.words()),
    };
    let mut payload = stored_entry(path, decision);
    payload["review_id"] = json!(review_id);
    payload["label"] = json!(label);
    record_event(
        &tx,
        &story.project_id,
        "review",
        &review_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&story.epic_id) },
        actor_id,
        "review.adr_decided",
        &payload,
        &now,
    )?;
    tx.commit().context("failed to commit the ADR decision")?;
    Ok(())
}
