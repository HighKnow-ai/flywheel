//! Stages (docs/mvp-spec.md §3, GLOSSARY.md "Stage", issue #123): the steps of shaping a record.
//! An Epic is shaped in three Stages, one after another (challenge the spec, slice it into Stories,
//! write the Acceptance criteria); a Milestone in one (its exit test). At most one Stage of a
//! subject is open at a time, and the developer closes it.
//!
//! The core opens a subject's first Stage when shaping starts on it ([`ensure_open_stage_in_tx`],
//! called inside `session::start_shaping_session`'s transaction). No agent writes a Stage.
//!
//! Issue #126: [`stage_status`] lists what is still open in a Stage (every unanswered question and
//! every undecided Proposal) and the empty spec fields, which are warnings and never block.
//! [`close_stage`] is the developer's alone: refused while anything is open, it closes the Stage,
//! opens the next one (Challenge the spec, then Slice into Stories, then Write the Acceptance
//! criteria) and ends the subject's live shaping session, all in one transaction, so the next Stage
//! starts from a fresh packet that names it. Nothing advances on its own.
//!
//! Issue #132: a Milestone's one Stage, Exit test, has no next Stage. Closing it moves the Milestone
//! from Shaping to Ready (`milestone::set_milestone_state_in_tx`) in the close's own transaction.
//!
//! Issue #128: an Epic's last Stage, Write the Acceptance criteria, also lists every Story still in
//! Shaping with no criterion (and an Epic with no Story left to make Ready). Closing it opens no
//! Stage: it moves those Stories and the Epic from Shaping to Ready in the same transaction.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::acceptance_criterion::criteria_for_story;
use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::epic::{set_epic_state_in_tx, EpicState};
use crate::domain::proposal::count_undecided_proposals_in_stage;
use crate::domain::milestone::{set_milestone_state_in_tx, MilestoneState};
use crate::domain::proposal_apply::{NewCriterion, NewStory, SpecChange};
use crate::domain::story::{get_story, set_story_state_in_tx, stories_in_epic, StoryState};
use crate::domain::session::{interrupt_session_in_tx, live_shaping_session, ShapingSubject};
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// A Stage's kind: which step of shaping it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StageKind {
    /// An Epic's first Stage: probe the problem, the scope, what is out of scope and the exit test.
    ChallengeSpec,
    /// An Epic's second Stage: slice it into Stories.
    Slice,
    /// An Epic's third Stage: write each Story's Acceptance criteria and Checks.
    Criteria,
    /// A Milestone's one Stage: challenge its exit test.
    ExitTest,
}

impl StageKind {
    /// An Epic's Stages, in order.
    pub const EPIC: [StageKind; 3] = [StageKind::ChallengeSpec, StageKind::Slice, StageKind::Criteria];

    /// The `stages.kind` value.
    pub fn as_str(self) -> &'static str {
        match self {
            StageKind::ChallengeSpec => "challenge_spec",
            StageKind::Slice => "slice",
            StageKind::Criteria => "criteria",
            StageKind::ExitTest => "exit_test",
        }
    }

    /// The kind a `stages.kind` value names.
    pub fn parse(value: &str) -> anyhow::Result<StageKind> {
        [StageKind::ChallengeSpec, StageKind::Slice, StageKind::Criteria, StageKind::ExitTest]
            .into_iter()
            .find(|kind| kind.as_str() == value)
            .with_context(|| format!("{value:?} is not a Stage kind"))
    }

    /// The Stage's name as the developer reads it.
    pub fn label(self) -> &'static str {
        match self {
            StageKind::ChallengeSpec => "Challenge the spec",
            StageKind::Slice => "Slice into Stories",
            StageKind::Criteria => "Write the Acceptance criteria",
            StageKind::ExitTest => "Exit test",
        }
    }

    /// The Stage that closing this one opens, or `None` for a subject's last Stage. Closing the last
    /// Stage makes the record Ready (issues #128 and #132) instead.
    pub fn next(self) -> Option<StageKind> {
        match self {
            StageKind::ChallengeSpec => Some(StageKind::Slice),
            StageKind::Slice => Some(StageKind::Criteria),
            StageKind::Criteria | StageKind::ExitTest => None,
        }
    }

    /// Which of its subject's Stages it is, in words, for the shaping packet.
    pub fn ordinal(self) -> &'static str {
        match self {
            StageKind::ChallengeSpec | StageKind::ExitTest => "first",
            StageKind::Slice => "second",
            StageKind::Criteria => "third",
        }
    }

    /// What the Stage is for, as the shaping session's standing instructions put it to the agent.
    pub fn purpose(self) -> &'static str {
        match self {
            StageKind::ChallengeSpec => {
                "probe the problem, the scope, what is out of scope and the exit test until each is clear, small \
                 enough to ship as one Epic and observable. Do not slice the Epic into Stories or write criteria yet."
            }
            StageKind::Slice => {
                "the spec has been challenged, and the answers to the Challenge the spec Rounds settle it. Slice the \
                 Epic into Stories: each one a thin vertical slice that ships and can be tested on its own, in the \
                 order they should run, with what each one runs after and why. Propose each Story with \
                 `propose_story`: its title, a description of what it ships and how it is tested, its place in the \
                 order (`after` or `before` a Story's key or a New Story's proposal_id; the end without either) and, \
                 when it must follow another, `runs_after` with a one-line `runs_after_reason` naming the constraint \
                 (\"shares `FeedRow.tsx`\"). The constraint is informational and never blocks. Move or retire a \
                 Story already on the Epic with `propose_story_order`. Both are answered at once; keep slicing \
                 without waiting for the developer's decision. Do not write Acceptance criteria yet. Reopen the \
                 spec only when a slice shows it is wrong, and then as a Proposal."
            }
            StageKind::Criteria => {
                "the Stories are sliced. For each Story, write its Acceptance criteria: observable statements of \
                 what is true once it ships, each with the Check command that proves it, or judged at review when \
                 no command can. Propose each criterion with `propose_criterion`: the Story's key, the statement \
                 and, when a command can prove it, `check`, the shell command run from the project's root that \
                 exits 0 once it holds; leave `check` out when the criterion is judged at review. It is answered \
                 at once; keep writing without waiting for the developer's decision. Every Story still in \
                 Shaping needs at least one criterion before the developer can close this Stage, which makes the \
                 Stories and the Epic Ready. Reslice only when a criterion shows a Story is wrong, and then as a \
                 Proposal."
            }
            StageKind::ExitTest => {
                "challenge the Milestone's exit test until it is observable, has no date and can be told apart \
                 from its neighbouring Milestones."
            }
        }
    }
}

/// One `stages` row.
#[derive(Debug, Clone, PartialEq)]
pub struct Stage {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub milestone_id: Option<String>,
    pub kind: StageKind,
    /// `open` or `closed`.
    pub state: String,
    pub rank: i64,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

const STAGE_COLUMNS: &str = "id, project_id, epic_id, milestone_id, kind, state, rank, opened_at, closed_at";

fn stage_from_row(row: &rusqlite::Row) -> rusqlite::Result<Stage> {
    let kind: String = row.get(4)?;
    Ok(Stage {
        id: row.get(0)?,
        project_id: row.get(1)?,
        epic_id: row.get(2)?,
        milestone_id: row.get(3)?,
        kind: StageKind::parse(&kind)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, e.into()))?,
        state: row.get(5)?,
        rank: row.get(6)?,
        opened_at: row.get(7)?,
        closed_at: row.get(8)?,
    })
}

/// The subject's open Stage, or `None`.
pub fn open_stage(conn: &Connection, subject: &ShapingSubject) -> anyhow::Result<Option<Stage>> {
    let (sql, id) = match subject {
        ShapingSubject::Epic(id) => (format!("SELECT {STAGE_COLUMNS} FROM stages WHERE epic_id = ?1 AND state = 'open'"), id),
        ShapingSubject::Milestone(id) => {
            (format!("SELECT {STAGE_COLUMNS} FROM stages WHERE milestone_id = ?1 AND state = 'open'"), id)
        }
        // Issue #133: the Roadmap is shaped in roadmap Rounds, which have no Stage.
        ShapingSubject::Roadmap(_) => return Ok(None),
    };
    conn.query_row(&sql, params![id], stage_from_row).optional().context("failed to read the open Stage")
}

/// Every Stage of an Epic, in order.
pub fn stages_for_epic(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<Stage>> {
    let mut stmt = conn.prepare(&format!("SELECT {STAGE_COLUMNS} FROM stages WHERE epic_id = ?1 ORDER BY rank, id"))?;
    let rows = stmt.query_map(params![epic_id], stage_from_row)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Epic's Stages")
}

/// Every Stage of a Milestone, in order: at most its one Exit test (issue #132).
pub fn stages_for_milestone(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<Stage>> {
    let mut stmt = conn.prepare(&format!("SELECT {STAGE_COLUMNS} FROM stages WHERE milestone_id = ?1 ORDER BY rank, id"))?;
    let rows = stmt.query_map(params![milestone_id], stage_from_row)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Milestone's Stages")
}

/// One `stages` row, or `None`.
pub fn get_stage(conn: &Connection, stage_id: &str) -> anyhow::Result<Option<Stage>> {
    conn.query_row(&format!("SELECT {STAGE_COLUMNS} FROM stages WHERE id = ?1"), params![stage_id], stage_from_row)
        .optional()
        .context("failed to read the Stage")
}

/// One thing still open in a Stage, which keeps it from closing.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpenItem {
    /// A question of the Stage's open Round, not answered yet.
    Question { question_id: String, round_id: String, round: i64, number: i64, title: String },
    /// A Proposal filed in the Stage, still pending.
    Proposal { proposal_id: String, summary: String },
    /// Issue #128, the Criteria Stage only: a Story of the Epic still in Shaping with no Acceptance
    /// criterion yet. Closing would make it Ready with nothing to judge it by. A Dropped Story does
    /// not count.
    StoryWithoutCriterion { story_id: String, key: String, title: String },
    /// Issue #128, the Criteria Stage only: the Epic has no Story left to make Ready, every one of
    /// them dropped or none sliced.
    NoStory,
}

impl OpenItem {
    /// The item as the developer reads it in the Close Stage list and in a refusal.
    pub fn label(&self) -> String {
        match self {
            OpenItem::Question { round, number, title, .. } => {
                format!("Question {number} of Round {round} is unanswered: {title}")
            }
            OpenItem::Proposal { summary, .. } => format!("A Proposal to {summary} is undecided"),
            OpenItem::StoryWithoutCriterion { key, title, .. } => format!("{key} “{title}” has no Acceptance criterion"),
            OpenItem::NoStory => "The Epic has no Story to make Ready".to_string(),
        }
    }
}

/// What is still open in a Stage, and what closing it would open.
#[derive(Debug, Clone, PartialEq)]
pub struct StageStatus {
    pub stage: Stage,
    /// Every unanswered question (by Round, then number), then every undecided Proposal (oldest
    /// first). The Stage closes only once this is empty.
    pub open_items: Vec<OpenItem>,
    /// The Stage's undecided Proposals, counted by `proposal::count_undecided_proposals_in_stage`.
    pub undecided_proposals: i64,
    /// Empty spec fields of the record being shaped, worth a look before closing. Never block.
    pub warnings: Vec<String>,
    /// The Stage closing this one opens; `None` for the last Stage.
    pub next: Option<StageKind>,
}

impl StageStatus {
    /// Whether the developer may close the Stage now: it is open, nothing in it is open, and closing
    /// it either opens a next Stage or makes the record Ready.
    pub fn closable(&self) -> bool {
        self.stage.state == "open" && self.open_items.is_empty() && (self.next.is_some() || self.closes_the_record())
    }

    /// Whether closing this Stage finishes shaping its record and makes it Ready: a Milestone's Exit
    /// test (issue #132), or an Epic's Write the Acceptance criteria, which makes its Shaping Stories
    /// and the Epic Ready (issue #128).
    pub fn closes_the_record(&self) -> bool {
        matches!(self.stage.kind, StageKind::ExitTest | StageKind::Criteria)
    }
}

/// What a Proposal in a Stage would do, in words: "change the Problem", "add the Story “Feed
/// row”", "move FLY-3 “Feed row” in the order", "retire FLY-3 “Feed row”", or its verb and target.
fn proposal_summary(conn: &Connection, verb: &str, target_type: &str, target_id: Option<&str>, payload: &str) -> String {
    let payload: serde_json::Value = serde_json::from_str(payload).unwrap_or(serde_json::Value::Null);
    if target_type == "epic" {
        if let Ok(change) = SpecChange::from_payload(&payload) {
            return format!("change the {}", change.field.label());
        }
    }
    if target_type == "story" {
        // Issue #127: a New Story names its title; a move or a retirement names the Story it moves.
        if verb == "create" {
            if let Ok(story) = NewStory::from_payload(&payload) {
                return format!("add the Story “{}”", story.title);
            }
        }
        let story = target_id.and_then(|id| get_story(conn, id).ok().flatten());
        if let Some(story) = story {
            match verb {
                "reorder" => return format!("move {} “{}” in the order", story.key, story.title),
                "retire" => return format!("retire {} “{}”", story.key, story.title),
                _ => {}
            }
        }
    }
    // Issue #132: an exit test proposed in a Milestone's shaping (an Amend Milestone with only it set).
    if verb == "amend" && target_type == "milestone" && payload.get("exit_test").is_some_and(|t| t.is_string()) {
        let title = payload.get("title").and_then(|t| t.as_str());
        return if title.is_some() { "change the title and the exit test".to_string() } else { "change the exit test".to_string() };
    }
    if target_type == "criterion" && verb == "create" {
        // Issue #128: a New criterion names its statement and the Story it is for.
        if let Ok(criterion) = NewCriterion::from_payload(&payload) {
            let key = get_story(conn, &criterion.story_id).ok().flatten().map(|s| s.key).unwrap_or(criterion.story_id);
            return format!("add the criterion “{}” to {key}", criterion.statement);
        }
    }
    format!("{verb} a {}", target_type.replace('_', " "))
}

/// What is still open in Stage `stage_id` (issue #126): the unanswered questions of its open Round,
/// its undecided Proposals, the empty spec fields as warnings, and the Stage closing it opens.
pub fn stage_status(conn: &Connection, stage_id: &str) -> anyhow::Result<StageStatus> {
    let stage = get_stage(conn, stage_id)?.with_context(|| format!("Stage {stage_id:?} not found"))?;
    let mut open_items = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT q.id, r.id, r.number, q.number, q.title FROM round_questions q JOIN rounds r ON r.id = q.round_id
         WHERE r.stage_id = ?1 AND q.answer IS NULL ORDER BY r.number, q.number",
    )?;
    let questions = stmt.query_map(params![stage_id], |r| {
        Ok(OpenItem::Question {
            question_id: r.get(0)?,
            round_id: r.get(1)?,
            round: r.get(2)?,
            number: r.get(3)?,
            title: r.get(4)?,
        })
    })?;
    for q in questions {
        open_items.push(q.context("failed to read the Stage's unanswered questions")?);
    }

    let undecided_proposals = count_undecided_proposals_in_stage(conn, stage_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, verb, target_type, target_id, payload FROM proposals WHERE stage_id = ?1 AND state = 'pending'
         ORDER BY created_at, id",
    )?;
    let proposals = stmt
        .query_map(params![stage_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Stage's undecided Proposals")?;
    for (proposal_id, verb, target, target_id, payload) in proposals {
        let summary = proposal_summary(conn, &verb, &target, target_id.as_deref(), &payload);
        open_items.push(OpenItem::Proposal { proposal_id, summary });
    }

    // Issue #128: closing the Criteria Stage makes every Story still in Shaping Ready, so each needs
    // a criterion first, and there must be one to make Ready. A Dropped Story does not count.
    if stage.kind == StageKind::Criteria {
        if let Some(epic_id) = &stage.epic_id {
            let open: Vec<_> = stories_in_epic(conn, epic_id)?.into_iter().filter(|s| s.state != "dropped").collect();
            if open.is_empty() {
                open_items.push(OpenItem::NoStory);
            }
            // A Story with an undecided criterion Proposal is already listed through that Proposal, which
            // names it; it comes back here if the Proposal is rejected.
            let proposed: Vec<String> = conn
                .prepare("SELECT payload FROM proposals WHERE stage_id = ?1 AND state = 'pending' AND verb = 'create' AND target_type = 'criterion'")?
                .query_map(params![stage_id], |r| r.get::<_, String>(0))?
                .filter_map(|p| p.ok())
                .filter_map(|p| NewCriterion::from_payload(&serde_json::from_str(&p).unwrap_or_default()).ok())
                .map(|c| c.story_id)
                .collect();
            for s in open.into_iter().filter(|s| s.state == "shaping" && !proposed.contains(&s.id)) {
                if criteria_for_story(conn, &s.id)?.is_empty() {
                    open_items.push(OpenItem::StoryWithoutCriterion { story_id: s.id, key: s.key, title: s.title });
                }
            }
        }
    }

    let mut warnings = Vec::new();
    let blank = |v: &Option<String>| v.as_deref().is_none_or(|v| v.trim().is_empty());
    if let Some(epic_id) = &stage.epic_id {
        let (problem, scope, exit_test): (Option<String>, Option<String>, Option<String>) = conn.query_row(
            "SELECT problem, scope, exit_test FROM epics WHERE id = ?1",
            params![epic_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        for (label, value) in [("Problem", problem), ("Scope", scope), ("Exit test", exit_test)] {
            if blank(&value) {
                warnings.push(format!("The {label} is not written yet"));
            }
        }
    } else if let Some(milestone_id) = &stage.milestone_id {
        let exit_test: Option<String> =
            conn.query_row("SELECT exit_test FROM milestones WHERE id = ?1", params![milestone_id], |r| r.get(0))?;
        if blank(&exit_test) {
            warnings.push("The exit test is not written yet".to_string());
        }
    }

    Ok(StageStatus { next: stage.kind.next(), stage, open_items, undecided_proposals, warnings })
}

/// What closing a Stage did.
#[derive(Debug, Clone, PartialEq)]
pub struct StageClosed {
    /// The Stage, now closed.
    pub closed: Stage,
    /// The next Stage, now open; `None` when the closed Stage was its record's last and made it Ready
    /// (a Milestone's Exit test, issue #132; an Epic's Criteria, issue #128).
    pub opened: Option<Stage>,
    /// The Stories closing an Epic's Criteria Stage made Ready, in execution order (issue #128); empty
    /// otherwise.
    pub made_ready: Vec<String>,
    /// The live shaping session the close ended, if one was live: it worked the closed Stage.
    pub ended_session: Option<String>,
}

/// Close Stage `stage_id` as the developer (issue #126) and open the next one, in one transaction.
/// Refused for any actor but a human, a Stage that is not open, and a Stage with anything still open
/// (the refusal names each item). Closing a record's last Stage opens none: an Epic's Write the
/// Acceptance criteria moves its Shaping Stories and the Epic to Ready (issue #128), a Milestone's
/// Exit test the Milestone (issue #132), in the same transaction. The subject's live shaping session
/// worked the closed Stage, so it ends here too:
/// the next Stage starts from a fresh session and packet. No held `round_post` call is left behind:
/// a call is held only on an open Round, and an open Round always has an unanswered question.
pub fn close_stage(conn: &mut Connection, actor_id: &str, stage_id: &str) -> anyhow::Result<StageClosed> {
    let at = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let status = stage_status(&tx, stage_id)?;
    let stage = &status.stage;
    anyhow::ensure!(stage.state == "open", "the {} Stage is already closed", stage.kind.label());
    if !status.open_items.is_empty() {
        let items: Vec<String> = status.open_items.iter().map(|i| format!("- {}", i.label())).collect();
        anyhow::bail!("the {} Stage still has open items:\n{}", stage.kind.label(), items.join("\n"));
    }
    if status.next.is_none() && !status.closes_the_record() {
        anyhow::bail!("the {} Stage is the last one; closing it is not available yet", stage.kind.label());
    }

    tx.execute(
        "UPDATE stages SET state = 'closed', closed_at = ?1, closed_by = ?2 WHERE id = ?3 AND state = 'open'",
        params![at, actor_id, stage_id],
    )
    .context("failed to close the Stage")?;
    record_event(
        &tx,
        &stage.project_id,
        "stage",
        stage_id,
        EventScope { story_id: None, epic_id: stage.epic_id.as_deref() },
        actor_id,
        "stage.closed",
        &serde_json::json!({
            "field": "state",
            "before": "open",
            "after": "closed",
            "kind": stage.kind.as_str(),
            "label": format!("Closed the {} Stage", stage.kind.label()),
        }),
        &at,
    )?;

    let mut made_ready = Vec::new();
    let opened_id = match status.next {
        Some(next) => Some(open_next_stage_in_tx(&tx, stage, next, actor_id, &at)?),
        // Issue #128: the Epic's Criteria Stage was its last, so its Stories and the Epic are Ready.
        None if stage.kind == StageKind::Criteria => {
            made_ready = make_ready_in_tx(&tx, stage, actor_id)?;
            None
        }
        None => {
            // Issue #132: the Milestone's Exit test was its only Stage, so its shaping is done.
            let milestone_id = stage.milestone_id.as_deref().context("the Exit test Stage shapes a Milestone")?;
            set_milestone_state_in_tx(
                &tx,
                actor_id,
                milestone_id,
                MilestoneState::Ready,
                serde_json::json!({ "label": "Closed the Exit test Stage: the Milestone is Ready", "stage_id": stage_id }),
            )?;
            None
        }
    };

    let subject = match (&stage.epic_id, &stage.milestone_id) {
        (Some(id), _) => ShapingSubject::Epic(id.clone()),
        (None, Some(id)) => ShapingSubject::Milestone(id.clone()),
        (None, None) => anyhow::bail!("Stage {stage_id:?} has no subject"),
    };
    let ended_session = live_shaping_session(&tx, &subject)?;
    if let Some(session_id) = &ended_session {
        interrupt_session_in_tx(&tx, session_id, actor_id)?;
    }

    let closed = get_stage(&tx, stage_id)?.context("the Stage just closed")?;
    let opened = match &opened_id {
        Some(id) => Some(get_stage(&tx, id)?.context("the Stage just opened")?),
        None => None,
    };
    tx.commit().context("failed to commit close_stage")?;
    Ok(StageClosed { closed, opened, made_ready, ended_session })
}

/// Issue #128: closing an Epic's Criteria Stage moves every Story of the Epic still in Shaping to
/// Ready, in execution order, then the Epic, through their own state writers and inside the close's
/// transaction, so a refusal from any of them refuses the close. A Dropped Story stays dropped. The
/// Stories made Ready, by id.
fn make_ready_in_tx(tx: &Transaction, closed: &Stage, actor_id: &str) -> anyhow::Result<Vec<String>> {
    let epic_id = closed.epic_id.as_deref().context("only an Epic's Stage makes its Stories Ready")?;
    let mut made_ready = Vec::new();
    for story in stories_in_epic(tx, epic_id)?.into_iter().filter(|s| s.state == "shaping") {
        set_story_state_in_tx(tx, actor_id, &story.id, StoryState::Ready)?;
        made_ready.push(story.id);
    }
    set_epic_state_in_tx(
        tx,
        actor_id,
        epic_id,
        EpicState::Ready,
        serde_json::json!({ "label": format!("Closed the {} Stage: the Epic is Ready", closed.kind.label()) }),
    )?;
    Ok(made_ready)
}

/// Open `next`, the Stage after `closed`, at the next rank, and append `stage.opened`. Returns its id.
fn open_next_stage_in_tx(tx: &Transaction, closed: &Stage, next: StageKind, actor_id: &str, at: &str) -> anyhow::Result<String> {
    // The next Stage takes the next rank: unique per (subject, kind), one open per subject.
    let opened_id = new_id();
    tx.execute(
        "INSERT INTO stages (id, project_id, epic_id, milestone_id, kind, state, rank, opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7)",
        params![opened_id, closed.project_id, closed.epic_id, closed.milestone_id, next.as_str(), closed.rank + 1, at],
    )
    .context("failed to open the next Stage")?;
    record_event(
        tx,
        &closed.project_id,
        "stage",
        &opened_id,
        EventScope { story_id: None, epic_id: closed.epic_id.as_deref() },
        actor_id,
        "stage.opened",
        &serde_json::json!({
            "field": "state",
            "before": null,
            "after": "open",
            "kind": next.as_str(),
            "label": format!("Opened the {} Stage", next.label()),
        }),
        at,
    )?;
    Ok(opened_id)
}

/// The open Stage of `subject` inside the caller's transaction, opening its first Stage when it has
/// none yet (an Epic's Challenge the spec, a Milestone's Exit test) and appending `stage.opened`.
/// Refused when every Stage of the subject is closed: nothing is left to shape.
pub(crate) fn ensure_open_stage_in_tx(
    tx: &Transaction,
    project_id: &str,
    subject: &ShapingSubject,
    actor_id: &str,
) -> anyhow::Result<String> {
    if let Some(stage) = open_stage(tx, subject)? {
        return Ok(stage.id);
    }
    let (epic_id, milestone_id, kind) = match subject {
        ShapingSubject::Epic(id) => (Some(id.as_str()), None, StageKind::ChallengeSpec),
        ShapingSubject::Milestone(id) => (None, Some(id.as_str()), StageKind::ExitTest),
        ShapingSubject::Roadmap(_) => anyhow::bail!("the Roadmap has no Stages: it is shaped in roadmap Rounds"),
    };
    let existing: i64 = tx.query_row(
        "SELECT COUNT(*) FROM stages WHERE epic_id IS ?1 AND milestone_id IS ?2",
        params![epic_id, milestone_id],
        |r| r.get(0),
    )?;
    anyhow::ensure!(existing == 0, "every Stage of this record is closed; there is nothing left to shape");

    let id = new_id();
    let at = now();
    tx.execute(
        "INSERT INTO stages (id, project_id, epic_id, milestone_id, kind, state, rank, opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', 1, ?6)",
        params![id, project_id, epic_id, milestone_id, kind.as_str(), at],
    )
    .context("failed to open the first Stage")?;
    record_event(
        tx,
        project_id,
        "stage",
        &id,
        EventScope { story_id: None, epic_id },
        actor_id,
        "stage.opened",
        &serde_json::json!({
            "field": "state",
            "before": null,
            "after": "open",
            "kind": kind.as_str(),
            "label": format!("Opened the {} Stage", kind.label()),
        }),
        &at,
    )?;
    Ok(id)
}
