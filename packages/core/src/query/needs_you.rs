//! Needs you (docs/mvp-spec.md §2 "Needs you", §7; GLOSSARY.md "Needs you"; issue #156): the ranked
//! list of everything waiting on the developer in one project. The board's column and the sidebar's
//! project figure read this one list, so the figure is always its length.
//!
//! Built from literal SQL (bound through `params![]`, never assembled with `format!`) and the existing
//! derivations, never from a stored state:
//!
//! 1. **Gated actions, permission requests and agent questions**, one item per pending request a live
//!    Story session holds (`query::permissions`' predicate), mixed by age.
//! 2. **Stopped Stories**: `query::sessions::stopped_session_for_story`, leaving out a stop the developer
//!    made (`stopped_by_developer`). A missing worktree (`query::recovery`) is a Stopped-kind item too,
//!    whose action is Recreate, and it stands in for the Story's other Story items.
//! 3. **Review**: Stories In review. One whose branch would conflict with its base branch carries the
//!    conflicting paths (`domain::review::conflicts_for_story`) and reads **Rebase needed** (issue #158).
//!    Ranked with them, each pending **judged-on change** (issue
//!    #163): a Proposal that changes what a Story is judged on, an Amend criterion or a Story session's
//!    Amend Epic spec (`query::judged_on_proposal!`), with its before and after. It is left out of
//!    the Proposals row.
//! 4. **Confirm exit test**: the core mirror of the renderer's `epicExitTestConfirmable` and
//!    `milestoneExitTestConfirmable` (`board/ConfirmExitTest.tsx`).
//! 5. **Proposals**: the pending Proposals Story sessions filed, as ONE item, "n from m Stories"
//!    (`crate::query::awaits_triage`, issue #162), waiting since the oldest. A judged-on change is left
//!    out: it is its own item (issue #163).
//! 6. **Shaping Round waiting**: an open Round a live session is held on (Waiting on you), or an open
//!    Round no live session of its subject is working on (it died, or never launched), a roadmap
//!    Round included. An open Round a live session is still working on waits on no one.
//!
//! Ranked by [`NeedsYouKind::rank`], then oldest first by `since`, then by the item's id, so the order
//! is total and two reads of an unchanged database agree. Nothing is reordered by hand.

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::domain::proposal::{duplicate_of, DuplicateOf};
use crate::domain::question::is_question;
use crate::query::recovery::missing_worktrees_for_project;
use crate::query::sessions::stopped_session_for_story;

/// What an item waits on the developer for, in spec §2's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NeedsYouKind {
    GatedAction,
    PermissionRequest,
    /// An agent's question (`AskUserQuestion`), answered rather than allowed.
    Question,
    /// A Stopped Story, or one whose worktree is missing (`NeedsYouItem::missing_worktree`).
    Stopped,
    Review,
    /// A Proposal that changes what a Story is judged on (issue #163), ranked with Review.
    JudgedOn,
    ConfirmExitTest,
    /// The Proposals filed during execution, as one row (issue #162).
    Proposals,
    ShapingRound,
}

impl NeedsYouKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NeedsYouKind::GatedAction => "gated_action",
            NeedsYouKind::PermissionRequest => "permission_request",
            NeedsYouKind::Question => "question",
            NeedsYouKind::Stopped => "stopped",
            NeedsYouKind::Review => "review",
            NeedsYouKind::JudgedOn => "judged_on",
            NeedsYouKind::ConfirmExitTest => "confirm_exit_test",
            NeedsYouKind::Proposals => "proposals",
            NeedsYouKind::ShapingRound => "shaping_round",
        }
    }

    /// The kind's place in spec §2's order; kinds that share a rank are mixed by age.
    pub fn rank(self) -> u8 {
        match self {
            NeedsYouKind::GatedAction
            | NeedsYouKind::PermissionRequest
            | NeedsYouKind::Question => 1,
            NeedsYouKind::Stopped => 2,
            NeedsYouKind::Review | NeedsYouKind::JudgedOn => 3,
            NeedsYouKind::ConfirmExitTest => 4,
            NeedsYouKind::Proposals => 5,
            NeedsYouKind::ShapingRound => 6,
        }
    }
}

/// The board record an item is about.
#[derive(Debug, Clone, PartialEq)]
pub struct NeedsYouRecord {
    /// `story`, `epic`, `milestone`, `roadmap`, or `project` for the Proposals row.
    pub kind: &'static str,
    /// `None` for the Roadmap, which is the project's; the project's own id for the Proposals row.
    pub id: Option<String>,
    /// A Story's or an Epic's key; a Milestone and the Roadmap have none.
    pub key: Option<String>,
    /// The record's title; empty for the Roadmap, which the renderer names.
    pub title: String,
    /// A Milestone's state with In progress derived, for Confirm exit test (a Milestone in Shaping is
    /// confirmed, never declined); `None` for every other record.
    pub state: Option<String>,
}

/// A pending request an item answers: what its card shows.
#[derive(Debug, Clone, PartialEq)]
pub struct NeedsYouRequest {
    pub request_id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub destructive_category: Option<String>,
}

/// A Round an item is about.
#[derive(Debug, Clone, PartialEq)]
pub struct NeedsYouRound {
    pub round_id: String,
    pub round_number: i64,
    /// `epic`, `milestone` or `roadmap`.
    pub subject: String,
    /// A live session is held on it: Waiting on you. Otherwise no live session works it.
    pub waiting_on_you: bool,
    /// Questions answered and asked; for a roadmap Round, its Proposals decided and filed.
    pub answered: i64,
    pub questions: i64,
}

/// The Proposals row's counts: "n from m Stories", and where they land.
#[derive(Debug, Clone, PartialEq)]
pub struct NeedsYouProposals {
    /// Proposals awaiting triage.
    pub count: i64,
    /// The Stories whose sessions filed them.
    pub stories: i64,
    /// The Epics they land on.
    pub epics: i64,
    /// Whether any is a New Epic, landing on the Roadmap.
    pub roadmap: bool,
}

/// A judged-on change an item decides (issue #163): what it changes, before and after, and why.
#[derive(Debug, Clone, PartialEq)]
pub struct NeedsYouJudgedOn {
    pub proposal_id: String,
    /// `amend_criterion` or `amend_epic_spec`, as `propose` names the kind.
    pub change: &'static str,
    /// The criterion an Amend criterion rewrites.
    pub criterion_id: Option<String>,
    /// The Epic spec field an Amend Epic spec rewrites: `problem`, `scope`, `out_of_scope`, `exit_test`.
    pub field: Option<String>,
    /// The text as the board holds it now; `None` when the criterion is gone or the field is empty.
    pub before: Option<String>,
    /// The text the Proposal writes.
    pub after: String,
    /// An Amend criterion's Check command now, and the one it proposes (`None`: the Check is kept).
    pub check_before: Option<String>,
    pub check_after: Option<String>,
    /// The Proposal's payload, which Edit starts from.
    pub payload: serde_json::Value,
    /// The agent's why and evidence line.
    pub rationale: Option<String>,
    pub evidence: Option<String>,
    /// The key of the Story whose session filed it.
    pub filed_by: Option<String>,
    /// The pending change this one repeats (issue #165), when it is a duplicate: the card names it,
    /// as the triage drawer's card does, and accepting that one closes this one.
    pub duplicate: Option<DuplicateOf>,
}

/// One thing waiting on the developer.
#[derive(Debug, Clone, PartialEq)]
pub struct NeedsYouItem {
    pub kind: NeedsYouKind,
    /// The item's own id (the request's, the Story's, the Epic's, the Milestone's or the Round's): the
    /// last key of the ranking.
    pub id: String,
    /// Since when it has waited: the age the ranking reads within a rank.
    pub since: String,
    pub record: NeedsYouRecord,
    /// The session the item is about: the live one holding a request, or a Stopped Story's dead one.
    pub session_id: Option<String>,
    pub request: Option<NeedsYouRequest>,
    /// A Stopped Story's ending reason (`sessions.ending_reason`).
    pub ending_reason: Option<String>,
    /// A Stopped-kind item whose worktree is missing: its action is Recreate, not Resume.
    pub missing_worktree: bool,
    /// The title of a Story's *doing* Task, where the Story has one.
    pub doing_task_title: Option<String>,
    /// Confirm exit test: the exit test as written, and an Epic's Milestone.
    pub exit_test: Option<String>,
    pub milestone_title: Option<String>,
    pub round: Option<NeedsYouRound>,
    /// A Review item whose branch would conflict with its base branch: the paths. Rebase needed when not
    /// empty.
    pub conflicts: Vec<String>,
    pub proposals: Option<NeedsYouProposals>,
    pub judged_on: Option<NeedsYouJudgedOn>,
}

impl NeedsYouItem {
    fn new(kind: NeedsYouKind, id: String, since: String, record: NeedsYouRecord) -> Self {
        Self {
            kind,
            id,
            since,
            record,
            session_id: None,
            request: None,
            ending_reason: None,
            missing_worktree: false,
            doing_task_title: None,
            exit_test: None,
            milestone_title: None,
            round: None,
            conflicts: Vec::new(),
            proposals: None,
            judged_on: None,
        }
    }
}

fn story_record(id: String, key: String, title: String) -> NeedsYouRecord {
    NeedsYouRecord {
        kind: "story",
        id: Some(id),
        key: Some(key),
        title,
        state: None,
    }
}

/// `query::permissions::PENDING_REQUESTS_FOR_RUN_SQL`'s predicate over the project's live Story sessions.
const REQUESTS_SQL: &str =
    "SELECT pr.id, pr.tool_name, pr.input_payload, pr.created_at, pr.destructive_category, \
        ar.id, s.id, s.key, s.title \
    FROM permission_requests pr \
    JOIN sessions ar ON ar.id = pr.session_id \
    JOIN stories s ON s.id = ar.story_id \
    WHERE ar.project_id = ?1 AND ar.kind = 'story' AND ar.status IN ('running', 'blocked') \
        AND pr.status = 'pending' AND pr.expired_at IS NULL";

const RUNNING_STORIES_SQL: &str = "SELECT id, key, title, updated_at, \
        (SELECT t.title FROM tasks t WHERE t.story_id = stories.id AND t.state = 'doing' LIMIT 1) \
    FROM stories WHERE project_id = ?1 AND state = 'running'";

/// A Story In review has waited since its last session ended (the hand-off), or, moved there by hand,
/// since the Story last changed.
const REVIEW_SQL: &str = "SELECT s.id, s.key, s.title, \
        COALESCE((SELECT MAX(r.ended_at) FROM sessions r WHERE r.story_id = s.id), s.updated_at) \
    FROM stories s WHERE s.project_id = ?1 AND s.state = 'in_review'";

/// A pending judged-on change (`judged_on_proposal!`), with what it changes as the board holds it now:
/// the criterion, its Story and its Check, or the Epic and its spec; and the Story that filed it.
const JUDGED_ON_SQL: &str = concat!(
    "SELECT p.id, p.target_type, p.payload, p.rationale, p.evidence, p.created_at, fs.key, \
        c.id, c.statement, k.command, cs.id, cs.key, cs.title, \
        e.id, e.key, e.title, e.problem, e.scope, e.out_of_scope, e.exit_test, p.duplicate_of \
    FROM proposals p \
    LEFT JOIN sessions ss ON ss.id = p.session_id \
    LEFT JOIN stories fs ON fs.id = ss.story_id \
    LEFT JOIN acceptance_criteria c ON p.target_type = 'criterion' AND c.id = p.target_id \
    LEFT JOIN checks k ON k.criterion_id = c.id \
    LEFT JOIN stories cs ON cs.id = c.story_id \
    LEFT JOIN epics e ON e.id = p.epic_id \
    WHERE p.project_id = ?1 AND p.state = 'pending' AND ",
    crate::query::judged_on_proposal!()
);

/// `epicExitTestConfirmable`: shaping closed (stored `ready`, read as Ready or In progress), at least one
/// Story, every Story Merged or Dropped. It has waited since its last Story changed.
const CONFIRM_EPICS_SQL: &str = "SELECT e.id, e.key, e.title, e.exit_test, m.title, \
        (SELECT MAX(s.updated_at) FROM stories s WHERE s.epic_id = e.id) \
    FROM epics e JOIN milestones m ON m.id = e.milestone_id \
    WHERE e.project_id = ?1 AND e.state = 'ready' \
        AND EXISTS (SELECT 1 FROM stories s WHERE s.epic_id = e.id) \
        AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.epic_id = e.id AND s.state NOT IN ('merged', 'dropped'))";

/// `milestoneExitTestConfirmable`: neither Done nor Dropped, and every Epic Done with a Dropped one left
/// out, at least one counted. It has waited since its last Epic changed.
const CONFIRM_MILESTONES_SQL: &str = "SELECT m.id, m.title, m.exit_test, \
        (SELECT MAX(e.updated_at) FROM epics e WHERE e.milestone_id = m.id AND e.state != 'dropped') \
    FROM milestones m \
    WHERE m.project_id = ?1 AND m.state NOT IN ('done', 'dropped') \
        AND EXISTS (SELECT 1 FROM epics e WHERE e.milestone_id = m.id AND e.state != 'dropped') \
        AND NOT EXISTS (SELECT 1 FROM epics e WHERE e.milestone_id = m.id AND e.state NOT IN ('done', 'dropped'))";

/// An open Round, held by a live session (`round_waiting_on_you`) or with no live shaping session of its
/// subject at work on it. Counts as `fleet::WAITING_ROUNDS_SQL` counts them.
const ROUNDS_SQL: &str = concat!(
    "SELECT r.id, r.number, \
        CASE WHEN r.stage_id IS NULL THEN 'roadmap' WHEN st.milestone_id IS NOT NULL THEN 'milestone' ELSE 'epic' END, \
        e.id, e.key, e.title, m.id, m.title, r.posted_at, \
        CASE WHEN r.stage_id IS NULL \
            THEN (SELECT COUNT(*) FROM proposals pr WHERE pr.round_id = r.id AND pr.state != 'pending') \
            ELSE (SELECT COUNT(*) FROM round_questions q WHERE q.round_id = r.id AND q.answer IS NOT NULL) END, \
        CASE WHEN r.stage_id IS NULL \
            THEN (SELECT COUNT(*) FROM proposals pr WHERE pr.round_id = r.id) \
            ELSE (SELECT COUNT(*) FROM round_questions q WHERE q.round_id = r.id) END, ",
    crate::query::round_waiting_on_you!(),
    " AS held, \
        EXISTS (SELECT 1 FROM sessions ls WHERE ls.kind = 'shaping' AND ls.project_id = r.project_id \
            AND ls.status IN ('running', 'blocked') \
            AND ((st.epic_id IS NOT NULL AND ls.epic_id = st.epic_id) \
                OR (st.milestone_id IS NOT NULL AND ls.milestone_id = st.milestone_id) \
                OR (r.stage_id IS NULL AND ls.epic_id IS NULL AND ls.milestone_id IS NULL))) AS live \
    FROM rounds r \
    LEFT JOIN stages st ON st.id = r.stage_id \
    LEFT JOIN epics e ON e.id = st.epic_id \
    LEFT JOIN milestones m ON m.id = st.milestone_id \
    WHERE r.project_id = ?1 AND r.state = 'open' \
        AND (r.stage_id IS NULL OR st.epic_id IS NOT NULL OR st.milestone_id IS NOT NULL)"
);

/// The Proposals row: what awaits triage, counted in one statement; no row when nothing does.
const PROPOSALS_SQL: &str = concat!(
    "SELECT COUNT(*), COUNT(DISTINCT s.story_id), COUNT(DISTINCT p.epic_id), \
        COALESCE(MAX(p.epic_id IS NULL), 0), MIN(p.created_at) \
    FROM proposals p JOIN sessions s ON s.id = p.session_id \
    WHERE p.project_id = ?1 AND ",
    crate::query::awaits_triage!()
);

/// Everything in `project_id` that waits on the developer, ranked. An empty project returns nothing,
/// never an error.
pub fn needs_you(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<NeedsYouItem>> {
    let mut items = Vec::new();
    push_requests(conn, project_id, &mut items)?;
    let missing = missing_worktrees_for_project(conn, project_id)?;
    let missing_ids: Vec<&str> = missing.iter().map(|m| m.story_id.as_str()).collect();
    push_stopped(conn, project_id, &missing_ids, &mut items)?;
    for m in &missing {
        let mut item = NeedsYouItem::new(
            NeedsYouKind::Stopped,
            m.story_id.clone(),
            m.since.clone(),
            story_record(
                m.story_id.clone(),
                m.story_key.clone(),
                m.story_title.clone(),
            ),
        );
        item.missing_worktree = true;
        items.push(item);
    }
    push_review(conn, project_id, &missing_ids, &mut items)?;
    push_judged_on(conn, project_id, &mut items)?;
    push_confirm_exit_test(conn, project_id, &mut items)?;
    push_proposals(conn, project_id, &mut items)?;
    push_rounds(conn, project_id, &mut items)?;
    items.sort_by(|a, b| {
        (a.kind.rank(), a.since.as_str(), a.id.as_str()).cmp(&(
            b.kind.rank(),
            b.since.as_str(),
            b.id.as_str(),
        ))
    });
    Ok(items)
}

fn push_requests(
    conn: &Connection,
    project_id: &str,
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(REQUESTS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            let request = NeedsYouRequest {
                request_id: row.get(0)?,
                tool_name: row.get(1)?,
                input_payload: row.get(2)?,
                destructive_category: row.get(4)?,
            };
            let kind = if is_question(&request.tool_name) {
                NeedsYouKind::Question
            } else if request.destructive_category.is_some() {
                NeedsYouKind::GatedAction
            } else {
                NeedsYouKind::PermissionRequest
            };
            let mut item = NeedsYouItem::new(
                kind,
                request.request_id.clone(),
                row.get(3)?,
                story_record(row.get(6)?, row.get(7)?, row.get(8)?),
            );
            item.session_id = Some(row.get(5)?);
            item.request = Some(request);
            Ok(item)
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the requests waiting on you")?;
    items.extend(rows);
    Ok(())
}

fn push_stopped(
    conn: &Connection,
    project_id: &str,
    missing: &[&str],
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(RUNNING_STORIES_SQL)?;
    let running = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the project's Running Stories")?;
    for (id, key, title, updated_at, doing) in running {
        if missing.contains(&id.as_str()) {
            continue;
        }
        let Some(stopped) = stopped_session_for_story(conn, &id)? else {
            continue;
        };
        if stopped.ending_reason.as_deref() == Some("stopped_by_developer") {
            continue;
        }
        let since = stopped.ended_at.clone().unwrap_or(updated_at);
        let mut item = NeedsYouItem::new(
            NeedsYouKind::Stopped,
            id.clone(),
            since,
            story_record(id, key, title),
        );
        item.session_id = Some(stopped.session_id);
        item.ending_reason = stopped.ending_reason;
        item.doing_task_title = doing;
        items.push(item);
    }
    Ok(())
}

fn push_review(
    conn: &Connection,
    project_id: &str,
    missing: &[&str],
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(REVIEW_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            let id: String = row.get(0)?;
            Ok(NeedsYouItem::new(
                NeedsYouKind::Review,
                id.clone(),
                row.get(3)?,
                story_record(id, row.get(1)?, row.get(2)?),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Stories In review")?;
    for mut item in rows
        .into_iter()
        .filter(|item| !missing.contains(&item.id.as_str()))
    {
        item.conflicts = crate::domain::review::conflicts_for_story(conn, &item.id)?;
        items.push(item);
    }
    Ok(())
}

fn push_judged_on(
    conn: &Connection,
    project_id: &str,
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(JUDGED_ON_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            let id: String = row.get(0)?;
            let target: String = row.get(1)?;
            let payload: serde_json::Value =
                serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or(serde_json::Value::Null);
            let text = |key: &str| {
                payload
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            };
            let epic = NeedsYouRecord {
                kind: "epic",
                id: row.get(13)?,
                key: row.get(14)?,
                title: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                state: None,
            };
            let (change, record, criterion_id, field, before, after, check_before, check_after) =
                if target == "criterion" {
                    let story: Option<String> = row.get(10)?;
                    let record = match story {
                        Some(story) => story_record(story, row.get(11)?, row.get(12)?),
                        None => epic,
                    };
                    let criterion_id: Option<String> = row.get(7)?;
                    (
                        "amend_criterion",
                        record,
                        criterion_id.or_else(|| text("criterion_id")),
                        None,
                        row.get::<_, Option<String>>(8)?,
                        text("statement").unwrap_or_default(),
                        row.get::<_, Option<String>>(9)?,
                        text("check_command"),
                    )
                } else {
                    let field = text("field");
                    let column = match field.as_deref() {
                        Some("problem") => Some(16),
                        Some("scope") => Some(17),
                        Some("out_of_scope") => Some(18),
                        Some("exit_test") => Some(19),
                        _ => None,
                    };
                    let before = match column {
                        Some(i) => row
                            .get::<_, Option<String>>(i)?
                            .filter(|t| !t.trim().is_empty()),
                        None => None,
                    };
                    (
                        "amend_epic_spec",
                        epic,
                        None,
                        field,
                        before,
                        text("text").unwrap_or_default(),
                        None,
                        None,
                    )
                };
            let mut item =
                NeedsYouItem::new(NeedsYouKind::JudgedOn, id.clone(), row.get(5)?, record);
            item.judged_on = Some(NeedsYouJudgedOn {
                proposal_id: id,
                change,
                criterion_id,
                field,
                before,
                after,
                check_before,
                check_after,
                payload,
                rationale: row.get(3)?,
                evidence: row.get(4)?,
                filed_by: row.get(6)?,
                duplicate: None,
            });
            Ok((item, row.get::<_, Option<String>>(20)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the judged-on changes waiting")?;
    for (mut item, original) in rows {
        if let (Some(change), Some(original)) = (item.judged_on.as_mut(), original) {
            change.duplicate = duplicate_of(conn, &original)?;
        }
        items.push(item);
    }
    Ok(())
}

fn push_confirm_exit_test(
    conn: &Connection,
    project_id: &str,
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(CONFIRM_EPICS_SQL)?;
    let epics = stmt
        .query_map(params![project_id], |row| {
            let id: String = row.get(0)?;
            let record = NeedsYouRecord {
                kind: "epic",
                id: Some(id.clone()),
                key: Some(row.get(1)?),
                title: row.get(2)?,
                state: None,
            };
            let mut item =
                NeedsYouItem::new(NeedsYouKind::ConfirmExitTest, id, row.get(5)?, record);
            item.exit_test = row.get(3)?;
            item.milestone_title = Some(row.get(4)?);
            Ok(item)
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Epics whose exit test can be confirmed")?;
    items.extend(epics);

    let mut stmt = conn.prepare(CONFIRM_MILESTONES_SQL)?;
    let milestones = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Milestones whose exit test can be confirmed")?;
    for (id, title, exit_test, since) in milestones {
        let state = crate::domain::milestone::milestone_state(conn, &id)?;
        let record = NeedsYouRecord {
            kind: "milestone",
            id: Some(id.clone()),
            key: None,
            title,
            state: Some(state.as_str().to_string()),
        };
        let mut item = NeedsYouItem::new(NeedsYouKind::ConfirmExitTest, id, since, record);
        item.exit_test = exit_test;
        items.push(item);
    }
    Ok(())
}

fn push_rounds(
    conn: &Connection,
    project_id: &str,
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let mut stmt = conn.prepare(ROUNDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            let held: bool = row.get(11)?;
            let live: bool = row.get(12)?;
            if live && !held {
                return Ok(None);
            }
            let subject: String = row.get(2)?;
            let record = match subject.as_str() {
                "epic" => NeedsYouRecord {
                    kind: "epic",
                    id: row.get(3)?,
                    key: row.get(4)?,
                    title: row.get(5)?,
                    state: None,
                },
                "milestone" => NeedsYouRecord {
                    kind: "milestone",
                    id: row.get(6)?,
                    key: None,
                    title: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    state: None,
                },
                _ => NeedsYouRecord {
                    kind: "roadmap",
                    id: None,
                    key: None,
                    title: String::new(),
                    state: None,
                },
            };
            let round = NeedsYouRound {
                round_id: row.get(0)?,
                round_number: row.get(1)?,
                subject,
                waiting_on_you: held,
                answered: row.get(9)?,
                questions: row.get(10)?,
            };
            let mut item = NeedsYouItem::new(
                NeedsYouKind::ShapingRound,
                round.round_id.clone(),
                row.get(8)?,
                record,
            );
            item.round = Some(round);
            Ok(Some(item))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Rounds waiting")?;
    items.extend(rows.into_iter().flatten());
    Ok(())
}

fn push_proposals(
    conn: &Connection,
    project_id: &str,
    items: &mut Vec<NeedsYouItem>,
) -> anyhow::Result<()> {
    let (proposals, since) = conn
        .query_row(PROPOSALS_SQL, params![project_id], |row| {
            let counts = NeedsYouProposals {
                count: row.get(0)?,
                stories: row.get(1)?,
                epics: row.get(2)?,
                roadmap: row.get(3)?,
            };
            Ok((counts, row.get::<_, Option<String>>(4)?))
        })
        .context("failed to count the Proposals awaiting triage")?;
    let Some(since) = since.filter(|_| proposals.count > 0) else {
        return Ok(());
    };
    let record = NeedsYouRecord {
        kind: "project",
        id: Some(project_id.to_string()),
        key: None,
        title: String::new(),
        state: None,
    };
    let mut item = NeedsYouItem::new(
        NeedsYouKind::Proposals,
        project_id.to_string(),
        since,
        record,
    );
    item.proposals = Some(proposals);
    items.push(item);
    Ok(())
}
