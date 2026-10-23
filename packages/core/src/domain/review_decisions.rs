//! The review's Decisions section (docs/mvp-spec.md §8, issue #161, ADR 0010): what a Story changes in
//! the repo's knowledge, `docs/adr/` and `GLOSSARY.md`, listed apart from its code, with a count.
//!
//! Each ADR the branch adds is a card carrying:
//! - its **bar lines**: from the hand-off (stored on the review as `adr_notes`), or else from the ADR
//!   Proposal accepted on the Epic in shaping, or none. They are never read out of the file;
//! - its **related live ADRs**: the ADRs its "Relates to" line names, resolved against the ADRs live
//!   on the base branch (the supersession walk of the Context packet's index, read from git);
//! - the developer's decision on it, **Keep** by default (the renderer's; nothing is stored for Keep).
//!
//! [`review_decisions`] reads the board and git and writes nothing. Merge links each new ADR to the
//! Story by path ([`new_adr_paths`], `story_merge`), except one accepted in shaping, which keeps its
//! Epic Proposal.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::context_packet::{adr_numbers, leading_number, live_adrs_at};
use crate::domain::proposal_apply::{is_adr_path, AdrBarLines, AdrDraft};
use crate::domain::review::open_review;
use crate::domain::story::get_story;
use crate::domain::worktree::worktree_for_story;
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
}

/// The Decisions section of a Story's review: its ADR changes by path, then its glossary change.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ReviewDecisions {
    pub changes: Vec<DecisionChange>,
}

impl ReviewDecisions {
    /// The count the section's heading shows.
    pub fn count(&self) -> usize {
        self.changes.len()
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

/// The ADR's `# ` heading at `rev`, or its file name when it has none.
fn adr_title(repo: &Path, rev: &str, path: &str) -> String {
    let fallback = || path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md").to_string();
    let Ok(out) = git::git_at(repo, &["show", &format!("{rev}:{path}")]) else { return fallback() };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(fallback)
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
    let (Some(base), Some(head)) = (base, head) else { return Ok(ReviewDecisions::default()) };

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
            })
        })
        .collect();
    changes.sort_by(|a, b| (a.kind == DecisionKind::Glossary, &a.path).cmp(&(b.kind == DecisionKind::Glossary, &b.path)));

    if changes.iter().any(|c| c.status == "A" && is_adr_path(&c.path)) {
        let notes: Vec<AdrBarLines> = review
            .as_ref()
            .and_then(|r| r.adr_notes.as_array())
            .map(|notes| notes.iter().filter_map(|n| AdrBarLines::from_payload(n).ok()).collect())
            .unwrap_or_default();
        let shaped = accepted_epic_adrs(conn, &story.epic_id)?;
        let live_at = base_tip.as_deref().unwrap_or(&base);
        let live: Vec<RelatedAdr> = live_adrs_at(repo, live_at)?
            .into_iter()
            .map(|a| RelatedAdr { path: a.path, title: a.title })
            .collect();
        for change in changes.iter_mut().filter(|c| c.status == "A" && is_adr_path(&c.path)) {
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
                title: adr_title(repo, &head, &change.path),
                bar_lines,
                bar_lines_from,
                related,
                proposal_id: proposal.map(|(id, _)| id.clone()),
            });
        }
    }
    Ok(ReviewDecisions { changes })
}
