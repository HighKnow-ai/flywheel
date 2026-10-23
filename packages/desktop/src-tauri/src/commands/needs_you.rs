//! `needs_you_list` (docs/mvp-spec.md §2 "Needs you", issue #156): one project's ranked list of what
//! waits on the developer, as `flywheel_core::query::needs_you` builds it. The board's Needs-you column
//! and the sidebar's project figure both read it, so the figure is always the list's length. A read: no
//! mutation, no emit.

use serde::Serialize;
use tauri::State;

use super::session::card_suggested_rule;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsYouRecordDto {
    /// `story`, `epic`, `milestone`, `roadmap`, or `project` for the Proposals row.
    pub kind: String,
    pub id: Option<String>,
    pub key: Option<String>,
    pub title: String,
    /// A Milestone's derived state, for Confirm exit test.
    pub state: Option<String>,
}

/// A pending request, shaped as the permission-request card takes it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsYouRequestDto {
    pub id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub destructive_category: Option<String>,
    /// The rule the card's Always allow field starts from; `None` for a Gated action or a question.
    pub suggested_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsYouRoundDto {
    pub round_id: String,
    pub round_number: i64,
    pub subject: String,
    pub waiting_on_you: bool,
    pub answered: i64,
    pub questions: i64,
}

/// The Proposals row's counts (issue #162): "n from m Stories", and where they land.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsYouProposalsDto {
    pub count: i64,
    pub stories: i64,
    pub epics: i64,
    pub roadmap: bool,
}

/// A judged-on change (issue #163): what it changes, before and after, and why.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsYouJudgedOnDto {
    pub proposal_id: String,
    /// `amend_criterion` or `amend_epic_spec`.
    pub change: String,
    pub criterion_id: Option<String>,
    /// `problem`, `scope`, `out_of_scope` or `exit_test`.
    pub field: Option<String>,
    pub before: Option<String>,
    pub after: String,
    pub check_before: Option<String>,
    /// `None`: the Check is kept, and its last run is marked stale.
    pub check_after: Option<String>,
    /// The Proposal's payload, which Edit starts from.
    pub payload: serde_json::Value,
    pub rationale: Option<String>,
    pub evidence: Option<String>,
    /// The key of the Story whose session filed it.
    pub filed_by: Option<String>,
}

/// One item. `kind` is `gated_action`, `permission_request`, `question`, `stopped`, `review`,
/// `judged_on`, `confirm_exit_test`, `proposals` or `shaping_round`; `rank` is its place in spec §2's order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsYouItemDto {
    pub kind: String,
    pub rank: u8,
    pub id: String,
    pub since: String,
    pub record: NeedsYouRecordDto,
    pub session_id: Option<String>,
    pub request: Option<NeedsYouRequestDto>,
    pub ending_reason: Option<String>,
    pub missing_worktree: bool,
    pub doing_task_title: Option<String>,
    pub exit_test: Option<String>,
    pub milestone_title: Option<String>,
    pub round: Option<NeedsYouRoundDto>,
    /// A Review item's Rebase needed (issue #158): the paths a merge would conflict in.
    pub conflicts: Vec<String>,
    pub proposals: Option<NeedsYouProposalsDto>,
    pub judged_on: Option<NeedsYouJudgedOnDto>,
}

impl From<flywheel_core::query::needs_you::NeedsYouItem> for NeedsYouItemDto {
    fn from(item: flywheel_core::query::needs_you::NeedsYouItem) -> Self {
        Self {
            kind: item.kind.as_str().to_string(),
            rank: item.kind.rank(),
            id: item.id,
            since: item.since,
            record: NeedsYouRecordDto {
                kind: item.record.kind.to_string(),
                id: item.record.id,
                key: item.record.key,
                title: item.record.title,
                state: item.record.state,
            },
            session_id: item.session_id,
            request: item.request.map(|r| NeedsYouRequestDto {
                suggested_rule: card_suggested_rule(&r.tool_name, r.input_payload.as_deref(), r.destructive_category.as_deref()),
                id: r.request_id,
                tool_name: r.tool_name,
                input_payload: r.input_payload,
                destructive_category: r.destructive_category,
            }),
            ending_reason: item.ending_reason,
            missing_worktree: item.missing_worktree,
            doing_task_title: item.doing_task_title,
            exit_test: item.exit_test,
            milestone_title: item.milestone_title,
            round: item.round.map(|r| NeedsYouRoundDto {
                round_id: r.round_id,
                round_number: r.round_number,
                subject: r.subject,
                waiting_on_you: r.waiting_on_you,
                answered: r.answered,
                questions: r.questions,
            }),
            conflicts: item.conflicts,
            proposals: item.proposals.map(|p| NeedsYouProposalsDto {
                count: p.count,
                stories: p.stories,
                epics: p.epics,
                roadmap: p.roadmap,
            }),
            judged_on: item.judged_on.map(|j| NeedsYouJudgedOnDto {
                proposal_id: j.proposal_id,
                change: j.change.to_string(),
                criterion_id: j.criterion_id,
                field: j.field,
                before: j.before,
                after: j.after,
                check_before: j.check_before,
                check_after: j.check_after,
                payload: j.payload,
                rationale: j.rationale,
                evidence: j.evidence,
                filed_by: j.filed_by,
            }),
        }
    }
}

/// Everything in `project_id` that waits on the developer, ranked. Read-only.
#[tauri::command]
pub fn needs_you_list(state: State<AppState>, project_id: String) -> Result<Vec<NeedsYouItemDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let items = flywheel_core::query::needs_you::needs_you(&conn, &project_id).map_err(|e| e.to_string())?;
    Ok(items.into_iter().map(Into::into).collect())
}
