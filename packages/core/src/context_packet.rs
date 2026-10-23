//! The Context packet (docs/mvp-spec.md §4.2, GLOSSARY.md "Context packet"): everything a new Story
//! session is rebuilt from, read off the board and the Story's worktree, so that ending a session
//! loses nothing. Every Story session starts from [`build_context_packet`]; there is no other
//! launch prompt and no `claude --resume`.
//!
//! The packet is ten sections in a fixed order, stable parts first so prompt caching works:
//! standing instructions; the Milestone and the Epic spec; the ADR index; sibling Stories; the
//! Story with its criteria and Checks; the Task checklist; review feedback and the resume note;
//! Session summaries; the diff so far; the closing instruction.
//!
//! Deterministic by construction: the same board state and the same worktree give a byte-identical
//! packet. Every list is read in a fixed order (rank then id, file name, creation time then id),
//! nothing reads the clock, and the diff is formatted here from git's per-file counts rather than
//! from `--stat`, whose layout depends on the terminal width.
//!
//! ADRs live in the repo, not on the board (ADR 0002): the index reads `docs/adr/` in the Story's
//! worktree (or the project's checkout before the worktree exists), follows `Supersedes ADR-NNNN`
//! and `Status: superseded by ADR-MMMM` lines, and lists only live ADRs. An ADR accepted on the
//! Epic that the worktree does not hold yet is sent as full text.

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use anyhow::Context;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::domain::adr_link::{adr_links_for_project, AdrLinkTarget};
use crate::domain::acceptance_criterion::criteria_for_story;
use crate::domain::check::{check_for_criterion, current_result, CheckResult};
use crate::domain::epic::get_epic;
use crate::domain::milestone::get_milestone;
use crate::domain::review::latest_review;
use crate::domain::session_summary::list_summaries_for_story;
use crate::domain::story::{get_story, stories_in_epic};
use crate::domain::task::tasks_for_story;
use crate::domain::worktree::{base_ref_for_story, porcelain_entries, worktree_for_story};
use crate::git;

/// Above this many estimated tokens the Story shows a soft warning. There is no hard budget.
pub const SOFT_LIMIT_TOKENS: usize = 20_000;

/// How many Session summaries the packet carries in full; older ones collapse to one line.
const SUMMARIES_IN_FULL: usize = 3;

/// The packet's size as the Story shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketSize {
    pub bytes: usize,
    /// A rough estimate: one token per four characters, rounded up.
    pub approx_tokens: usize,
    /// Whether `approx_tokens` is above [`SOFT_LIMIT_TOKENS`].
    pub over_soft_limit: bool,
}

/// Measure a packet.
pub fn measure(packet: &str) -> PacketSize {
    let approx_tokens = packet.chars().count().div_ceil(4);
    PacketSize { bytes: packet.len(), approx_tokens, over_soft_limit: approx_tokens > SOFT_LIMIT_TOKENS }
}

/// The size of the packet the Story's next session would start from, without a resume note (the
/// note is a one-off typed at Resume).
pub fn context_packet_size(conn: &Connection, story_id: &str) -> anyhow::Result<PacketSize> {
    Ok(measure(&build_context_packet(conn, story_id, "")?))
}

const STANDING_INSTRUCTIONS: &str = "\
You are the agent of one Story on a Flywheel board. This packet is everything you start from: it is \
rebuilt from the board and the Story's worktree for every session, so nothing from an earlier \
session's conversation reaches you except what is written here.

- Work only inside this Story's worktree, your current directory. Do not touch other branches or \
worktrees.
- The Story's Acceptance criteria are what you are judged on. Each Check is a shell command run from \
the worktree root at hand-off; exit 0 passes. You cannot edit or delete a Check. If you think one is \
wrong, say so in the hand-off's `check_objections`, naming its criterion by its number below; the \
developer reads it beside that Check at review.
- Keep the Task checklist current through the Flywheel board tools. If it is empty, first read the \
code and docs the Story touches, then write it as your plan. Do not add a Task to survey or explore \
the repo. At most one Task is doing at a time. Drop a Task with a one-line reason \
rather than deleting it.
- If section 7 below carries review feedback, the developer requested changes: before anything else, add \
one Task per review point to the checklist, keeping the Tasks already there, then work them.
- Keep the doing Task's note current through `task_update`: whenever you learn something the next \
session would otherwise have to find again (findings, file paths, decisions, what is left), write it \
there at once, and always when you finish or leave a Task. Each write replaces the whole note, and it \
is the only part of your work on a Task that outlives this session besides the worktree.
- You write to the board only through Proposals (`propose`), which do nothing until the developer \
accepts them. At most 3 open Proposals per session; `proposal_withdraw` takes one of yours back. A Proposal never pauses you; if you cannot go on without an \
answer, ask a question instead.
- Decisions about the code live in the repo: ADRs in `docs/adr/` and terms in `GLOSSARY.md`. Before \
writing an ADR, check the index below: either supersede a related ADR (open the new one with \
`Supersedes ADR-NNNN` and add `Status: superseded by ADR-MMMM` to the old one) or do not write a new \
one. Offer every ADR you add with its bar lines in the hand-off's `adrs`: why it is hard to reverse, why \
it would surprise a reader, which alternative lost, and the ADRs it relates to. They are shown beside \
it at review and never written into the file.
- Commit your work on the Story's branch as you go.
";

const CLOSING_INSTRUCTION: &str = "\
Re-read the Story's criteria and the Task checklist above, then continue from where the last \
session left off. If a Task is doing, re-verify it before building on it. When the Story is done, \
hand off for review with a Session summary in two fields, what the next session must know and the \
decisions made, and an up-to-date Task checklist. If you stop before that, leave the worktree in a \
state the next session can pick up from this packet alone.
";

/// The words for a Story state (GLOSSARY.md "Story state").
fn story_state_words(state: &str) -> &str {
    match state {
        "shaping" => "Shaping",
        "ready" => "Ready",
        "running" => "Running",
        "in_review" => "In review",
        "merged" => "Merged",
        "dropped" => "Dropped",
        other => other,
    }
}

pub(crate) fn non_blank(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

/// Build the Context packet a session of `story_id` starts from. `resume_note` is the developer's
/// optional one-line note; blank means none.
pub fn build_context_packet(conn: &Connection, story_id: &str, resume_note: &str) -> anyhow::Result<String> {
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    let epic = get_epic(conn, &story.epic_id)?.with_context(|| format!("Epic {:?} not found", story.epic_id))?;
    let milestone =
        get_milestone(conn, &epic.milestone_id)?.with_context(|| format!("Milestone {:?} not found", epic.milestone_id))?;
    let repo_path: String =
        conn.query_row("SELECT repo_path FROM projects WHERE id = ?1", params![story.project_id], |r| r.get(0))?;
    let worktree = worktree_for_story(conn, story_id)?;
    let worktree_dir = worktree.as_ref().map(|w| PathBuf::from(&w.path)).filter(|p| p.is_dir());
    let head = worktree_dir.as_deref().and_then(head_sha);

    let mut out = String::new();
    writeln!(out, "# Context packet: {} {}", story.key, story.title)?;

    // 1. Standing instructions
    section(&mut out, "Standing instructions");
    out.push_str(STANDING_INSTRUCTIONS);

    // 2. Milestone (one line) and the Epic spec in full
    section(&mut out, "Milestone and Epic");
    match non_blank(&milestone.exit_test) {
        Some(exit) => writeln!(out, "Milestone: {}. Exit test: {}", milestone.title, exit)?,
        None => writeln!(out, "Milestone: {}. Exit test: none written", milestone.title)?,
    }
    writeln!(out, "\n### Epic {} {}", epic.key, epic.title)?;
    for (label, value) in [
        ("Problem", &epic.spec.problem),
        ("Scope", &epic.spec.scope),
        ("Out of scope", &epic.spec.out_of_scope),
        ("Exit test", &epic.spec.exit_test),
    ] {
        writeln!(out, "\n{label}:\n{}", non_blank(value).unwrap_or("(not written)"))?;
    }
    let rejected = rejected_proposals(conn, &epic.id)?;
    if !rejected.is_empty() {
        out.push_str("\nRejected Proposals on this Epic (do not propose these again without new evidence):\n");
        for line in rejected {
            writeln!(out, "- {line}")?;
        }
    }

    // 3. ADRs
    section(&mut out, "ADRs");
    let docs_root = worktree_dir.clone().unwrap_or_else(|| PathBuf::from(&repo_path));
    let adrs = live_adrs(&docs_root.join("docs").join("adr"));
    let links = adr_links_for_project(conn, &story.project_id)?;
    if adrs.is_empty() {
        out.push_str("No live ADRs in `docs/adr/`.\n");
    } else {
        out.push_str("Every live ADR in the project, superseded ones left out:\n");
        for adr in &adrs {
            let mut linked: Vec<&str> = links
                .iter()
                .filter(|l| l.path == adr.path)
                .filter_map(|l| match &l.target {
                    AdrLinkTarget::Story(id) if *id == story.id => Some("this Story"),
                    AdrLinkTarget::Epic(id) if *id == epic.id => Some("this Epic"),
                    AdrLinkTarget::Milestone(id) if *id == milestone.id => Some("this Milestone"),
                    _ => None,
                })
                .collect();
            linked.sort_unstable();
            linked.dedup();
            if linked.is_empty() {
                writeln!(out, "- {}: {}", adr.path, adr.title)?;
            } else {
                writeln!(out, "- {}: {} (linked to {})", adr.path, adr.title, linked.join(", "))?;
            }
        }
    }
    // ADR 0002: an ADR accepted in shaping is written by the Epic's first Story, the first in execution order
    // that is not Dropped. Only its packet carries the text; a later Story's names the file and who writes it.
    let writer = stories_in_epic(conn, &epic.id)?.into_iter().find(|s| s.state != "dropped");
    for (path, text) in unmerged_epic_adrs(conn, &epic.id, &docs_root)? {
        match writer.as_ref().filter(|w| w.id != story.id) {
            Some(first) => writeln!(
                out,
                "\nAccepted for this Epic but not in the repo yet: `{path}`. {} writes it, the Epic's first Story; do not write it here.",
                first.key
            )?,
            None => {
                writeln!(out, "\nAccepted for this Epic but not in the repo yet; write it verbatim at `{path}`:\n")?;
                out.push_str("~~~markdown\n");
                out.push_str(text.trim_end());
                out.push_str("\n~~~\n");
            }
        }
    }
    if docs_root.join("GLOSSARY.md").is_file() {
        out.push_str("\nGlossary: `GLOSSARY.md`\n");
    } else {
        out.push_str("\nGlossary: no `GLOSSARY.md` yet.\n");
    }

    // 4. Sibling Stories
    section(&mut out, "Sibling Stories");
    let siblings: Vec<_> = stories_in_epic(conn, &epic.id)?.into_iter().filter(|s| s.id != story.id).collect();
    if siblings.is_empty() {
        out.push_str("None: this is the Epic's only Story.\n");
    }
    for s in siblings {
        writeln!(out, "- {} {} ({})", s.key, s.title, story_state_words(&s.state))?;
    }

    // 5. The Story, with each criterion's Check and latest result
    section(&mut out, "The Story");
    writeln!(out, "{} {} ({})", story.key, story.title, story_state_words(&story.state))?;
    if let Some(description) = non_blank(&story.description) {
        writeln!(out, "\n{description}")?;
    }
    out.push_str("\nAcceptance criteria:\n");
    let criteria = criteria_for_story(conn, story_id)?;
    if criteria.is_empty() {
        out.push_str("None written.\n");
    }
    for (i, criterion) in criteria.iter().enumerate() {
        // The id is what `propose`'s amend_criterion names (issue #160).
        writeln!(out, "{}. {} [criterion_id: {}]", i + 1, criterion.statement.trim(), criterion.id)?;
        match check_for_criterion(conn, &criterion.id)? {
            None => out.push_str("   Check: none (judged at review)\n"),
            Some(check) => {
                let current = current_result(conn, &check.id)?;
                let result = match (current.result, current.commit_sha.as_deref()) {
                    (CheckResult::NotRun, _) | (_, None) => "not run".to_string(),
                    (result, Some(sha)) => {
                        let short = &sha[..sha.len().min(12)];
                        let stale = match head.as_deref() {
                            Some(head) if head != sha => " (stale: the branch has moved since)",
                            // Issue #163: an accepted Amend criterion marks the last run stale.
                            _ if current.is_stale(head.as_deref()) => " (stale: the criterion changed since)",
                            _ => "",
                        };
                        format!("{} at {short}{stale}", result.as_str().replace('_', " "))
                    }
                };
                writeln!(out, "   Check: `{}`; latest result: {result}", check.command)?;
            }
        }
    }

    // 6. Tasks
    section(&mut out, "Tasks");
    let tasks = tasks_for_story(conn, story_id)?;
    if tasks.is_empty() {
        out.push_str("No Tasks yet. Write the checklist as your plan before you start.\n");
    }
    for task in &tasks {
        match task.dropped_reason.as_deref() {
            Some(reason) => writeln!(out, "- [{}] {} ({})", task.state, task.title, reason)?,
            None => writeln!(out, "- [{}] {}", task.state, task.title)?,
        }
        if let Some(note) = non_blank(&task.note) {
            writeln!(out, "  Note: {}", note.replace('\n', "\n  "))?;
        }
    }
    if tasks.iter().any(|t| t.state == "doing") {
        out.push_str(
            "\nThe doing Task was in progress when the last session ended: re-verify it before going on, \
             starting from its note rather than redoing what the note already records.\n",
        );
    }

    // 7. Review feedback and the resume note
    section(&mut out, "Review feedback and resume note");
    let feedback = changes_requested(conn, story_id)?;
    let note = resume_note.trim();
    if let Some(comments) = &feedback {
        writeln!(out, "The developer requested changes at review:\n\n{comments}\n")?;
        out.push_str(
            "Before anything else, add one Task per review point to the checklist above, keeping the Tasks \
             already there, then work them.\n",
        );
    }
    match (feedback.is_some(), note.is_empty()) {
        (false, true) => out.push_str("None.\n"),
        (true, true) => {}
        (true, false) => writeln!(out, "\nResume note: {note}")?,
        (false, false) => writeln!(out, "Resume note: {note}")?,
    }

    // 8. Session summaries
    section(&mut out, "Session summaries");
    let summaries = list_summaries_for_story(conn, story_id)?;
    let omitted = summaries.len().saturating_sub(SUMMARIES_IN_FULL);
    if summaries.is_empty() {
        out.push_str("None: this is the Story's first session.\n");
    }
    match omitted {
        0 => {}
        1 => out.push_str("1 earlier session omitted.\n"),
        n => writeln!(out, "{n} earlier sessions omitted.")?,
    }
    for (i, summary) in summaries.iter().enumerate().skip(omitted) {
        let stub = if summary.is_stub { " (stub: the session ended without handing off)" } else { "" };
        writeln!(out, "\n### Summary {} of {}{stub}", i + 1, summaries.len())?;
        writeln!(out, "Next session must know:\n{}", summary.next_session_must_know.trim_end())?;
        writeln!(out, "Decisions:\n{}", summary.decisions.trim_end())?;
    }

    // 9. The diff so far
    section(&mut out, "Diff so far");
    match (&worktree, worktree_dir.as_deref()) {
        (None, _) => out.push_str("No worktree yet: the Story's first session creates it.\n"),
        (Some(w), None) => writeln!(out, "The worktree is missing on disk at `{}`.", w.path)?,
        (Some(_), Some(dir)) => write_diff(&mut out, dir, &base_ref_for_story(conn, story_id)?)?,
    }

    // 10. Closing instruction
    section(&mut out, "Closing instruction");
    out.push_str(CLOSING_INSTRUCTION);
    Ok(out)
}

/// The comments of the developer's latest request for changes, while it is the Story's latest review:
/// once the next hand-off opens a review, they have been answered.
fn changes_requested(conn: &Connection, story_id: &str) -> anyhow::Result<Option<String>> {
    Ok(latest_review(conn, story_id)?
        .filter(|r| r.outcome.as_deref() == Some("changes_requested"))
        .and_then(|r| non_blank(&r.comments).map(str::to_string)))
}

pub(crate) fn section(out: &mut String, heading: &str) {
    out.push_str("\n## ");
    out.push_str(heading);
    out.push_str("\n\n");
}

fn head_sha(dir: &Path) -> Option<String> {
    let output = git::git_at(dir, &["rev-parse", "HEAD"]).ok()?;
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string()).filter(|s| !s.is_empty())
}

/// The committed changes since `base` (stat and file names, never hunks), then the uncommitted
/// ones, marked as left by a stopped session.
fn write_diff(out: &mut String, dir: &Path, base: &str) -> anyhow::Result<()> {
    match git::review_files(dir, base, "HEAD") {
        Err(err) => writeln!(out, "Could not read the committed changes against `{base}`: {err:#}")?,
        Ok(files) if files.is_empty() => writeln!(out, "Nothing committed on this branch since `{base}`.")?,
        Ok(files) => {
            let (added, removed) = files.iter().fold((0u64, 0u64), |(a, r), f| {
                (a + u64::from(f.added.unwrap_or(0)), r + u64::from(f.removed.unwrap_or(0)))
            });
            writeln!(out, "Committed since `{base}`: {} files changed, +{added} -{removed}", files.len())?;
            for f in files {
                let path = match &f.old_path {
                    Some(old) => format!("{old} -> {}", f.path),
                    None => f.path.clone(),
                };
                if f.binary {
                    writeln!(out, "- {} {path} (binary)", f.status)?;
                } else {
                    writeln!(out, "- {} {path} (+{} -{})", f.status, f.added.unwrap_or(0), f.removed.unwrap_or(0))?;
                }
            }
        }
    }
    match porcelain_entries(dir) {
        Err(err) => writeln!(out, "\nCould not read the uncommitted changes: {err:#}")?,
        Ok(entries) if entries.is_empty() => {}
        Ok(mut entries) => {
            entries.sort_by(|a, b| a.path.cmp(&b.path).then_with(|| a.code.cmp(&b.code)));
            out.push_str(
                "\nUncommitted changes, left by a stopped session. Nobody has reviewed them: check each one \
                 before building on it.\n",
            );
            for e in entries {
                writeln!(out, "- {} {}", e.code.trim(), e.path)?;
            }
        }
    }
    Ok(())
}

/// One rejected Proposal on the Epic, as a line: what it proposed and the developer's reason.
pub(crate) fn rejected_proposals(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT verb, target_type, payload, rationale, rejection_reason FROM proposals
         WHERE epic_id = ?1 AND state = 'rejected' ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map(params![epic_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(verb, target, payload, rationale, reason)| {
            let payload: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
            let reason = reason.unwrap_or_else(|| "no reason given".to_string());
            // A spec change (issue #125) names the field it would have rewritten and the text.
            if let Ok(change) = crate::domain::proposal_apply::SpecChange::from_payload(&payload) {
                return format!("{verb} {target} {}: \"{}\"; rejected: {reason}", change.field.label(), change.text);
            }
            // A New criterion (issue #128) names its statement.
            if target == "criterion" {
                if let Ok(c) = crate::domain::proposal_apply::NewCriterion::from_payload(&payload) {
                    return format!("{verb} criterion \"{}\"; rejected: {reason}", c.statement);
                }
            }
            let what = payload
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or(rationale)
                .unwrap_or_default();
            let target = target.replace('_', " ");
            if what.trim().is_empty() {
                format!("{verb} {target}; rejected: {reason}")
            } else {
                format!("{verb} {target} \"{}\"; rejected: {reason}", what.trim())
            }
        })
        .collect())
}

/// ADR Proposals accepted on the Epic whose file the repo checkout does not hold yet, as
/// `(path, full text)`.
fn unmerged_epic_adrs(conn: &Connection, epic_id: &str, docs_root: &Path) -> anyhow::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, payload FROM proposals WHERE epic_id = ?1 AND target_type = 'adr' AND state = 'accepted'
         ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map(params![epic_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = Vec::new();
    for (id, payload) in rows {
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        let path = value.get("path").and_then(|v| v.as_str()).map(str::trim).filter(|p| !p.is_empty());
        if let Some(path) = path {
            if docs_root.join(path).is_file() {
                continue;
            }
        }
        let text = ["text", "body", "content"]
            .iter()
            .find_map(|k| value.get(*k).and_then(|v| v.as_str()))
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string_pretty(&value).unwrap_or_default());
        out.push((path.map(str::to_string).unwrap_or_else(|| format!("(no path given; Proposal {id})")), text));
    }
    Ok(out)
}

/// One live ADR in the index.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AdrEntry {
    /// Repo-relative, `docs/adr/<file>`.
    pub(crate) path: String,
    pub(crate) title: String,
}

/// Every ADR in `adr_dir` that nothing supersedes, in file-name order. An ADR is superseded when it
/// carries a `Status: superseded by …` line, or when another ADR names its number on a
/// `Supersedes ADR-NNNN` line. A missing directory is an empty index.
pub(crate) fn live_adrs(adr_dir: &Path) -> Vec<AdrEntry> {
    let Ok(read) = std::fs::read_dir(adr_dir) else { return Vec::new() };
    let mut names: Vec<String> = read
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".md"))
        .collect();
    names.sort();
    let files = names.into_iter().filter_map(|name| {
        let text = std::fs::read_to_string(adr_dir.join(&name)).ok()?;
        Some((name, text))
    });
    live_adrs_of(files)
}

/// [`live_adrs`] as committed at `rev` in the repository at `repo`, read without a checkout (issue
/// #161: the review resolves an ADR's "Relates to" against the base branch). Two git reads: the
/// file names, and only the lines the walk looks at (a `# ` title, a line naming a supersession),
/// in file order, which is all [`live_adrs_of`] reads.
pub(crate) fn live_adrs_at(repo: &Path, rev: &str) -> anyhow::Result<Vec<AdrEntry>> {
    let listed = crate::git::git_at(repo, &["ls-tree", "-z", "--name-only", rev, "docs/adr/"])?;
    let mut names: Vec<String> = String::from_utf8_lossy(&listed.stdout)
        .split('\0')
        .filter_map(|p| p.strip_prefix("docs/adr/"))
        .filter(|n| n.ends_with(".md") && !n.contains('/'))
        .map(str::to_string)
        .collect();
    names.sort();
    let grep = crate::git::git_output_at(
        repo,
        &["grep", "--no-line-number", "--no-column", "--no-color", "-z", "-I", "-i", "-E", "-e", "^[[:space:]]*#[[:space:]]", "-e", "supersed", rev, "--", "docs/adr/"],
    )?;
    // Exit 1 is "no line matched"; anything else is a failure.
    anyhow::ensure!(grep.status.code().is_some_and(|c| c <= 1), "could not read the ADRs at {rev}");
    let mut texts: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    let prefix = format!("{rev}:docs/adr/");
    for line in String::from_utf8_lossy(&grep.stdout).lines() {
        let Some((file, text)) = line.split_once('\0') else { continue };
        if let Some(name) = file.strip_prefix(&prefix) {
            let body = texts.entry(name.to_string()).or_default();
            body.push_str(text);
            body.push('\n');
        }
    }
    Ok(live_adrs_of(names.into_iter().map(|name| {
        let text = texts.remove(&name).unwrap_or_default();
        (name, text)
    })))
}

/// The supersession walk over ADR files given as `(file name, text)` in file-name order.
fn live_adrs_of(files: impl Iterator<Item = (String, String)>) -> Vec<AdrEntry> {
    struct Parsed {
        name: String,
        number: Option<u32>,
        title: String,
        marked_superseded: bool,
    }
    let mut parsed = Vec::new();
    let mut superseded_numbers = BTreeSet::new();
    for (name, text) in files {
        let number = leading_number(&name);
        let mut title = None;
        let mut marked_superseded = false;
        for line in text.lines() {
            let trimmed = line.trim();
            if title.is_none() {
                if let Some(t) = trimmed.strip_prefix("# ") {
                    title = Some(t.trim().to_string());
                }
            }
            let lower = trimmed.trim_matches(|c: char| c == '*' || c == '_' || c == '-' || c == '>' || c == ' ').to_lowercase();
            if lower.starts_with("status:") && lower.contains("superseded by") {
                marked_superseded = true;
            }
            if let Some(at) = lower.find("supersedes") {
                for n in adr_numbers(&lower[at + "supersedes".len()..]) {
                    if Some(n) != number {
                        superseded_numbers.insert(n);
                    }
                }
            }
        }
        let title = title.unwrap_or_else(|| name.trim_end_matches(".md").to_string());
        parsed.push(Parsed { name, number, title, marked_superseded });
    }
    parsed
        .into_iter()
        .filter(|p| !p.marked_superseded && !p.number.is_some_and(|n| superseded_numbers.contains(&n)))
        .map(|p| AdrEntry { path: format!("docs/adr/{}", p.name), title: p.title })
        .collect()
}

pub(crate) fn leading_number(name: &str) -> Option<u32> {
    let digits: String = name.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// The ADR numbers named in `text` as `ADR-NNNN` / `ADR NNNN` / `ADR-0007-slug`, in order.
pub(crate) fn adr_numbers(text: &str) -> Vec<u32> {
    let mut numbers = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("adr") {
        rest = &rest[at + 3..];
        let after = rest.trim_start_matches(['-', ' ', '_', '#']);
        let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(n) = digits.parse() {
            numbers.push(n);
        }
    }
    numbers
}

#[cfg(test)]
mod tests {
    use super::adr_numbers;

    #[test]
    fn adr_numbers_reads_every_spelling() {
        assert_eq!(adr_numbers(" adr-0001"), vec![1]);
        assert_eq!(adr_numbers(" adr 0002 and adr-0003-slug.md"), vec![2, 3]);
        assert_eq!(adr_numbers(" [adr-0004](0004-x.md)"), vec![4]);
        assert!(adr_numbers(" nothing").is_empty());
    }
}
