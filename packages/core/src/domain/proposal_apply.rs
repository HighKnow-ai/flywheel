//! What an accepted Proposal does to the board (docs/mvp-spec.md §3, §5, issue #125).
//!
//! Accepting a Proposal used to record the decision and nothing else. This module is the effect:
//! [`apply_in_tx`] runs inside the deciding transaction of `proposal::accept_proposal` and
//! `proposal::accept_proposal_amended`, so the decision and its effect commit together or not at
//! all. It is never called on its own and decides nothing: who may accept is `proposal.rs`'s
//! question (human-only), what accepting does is this module's.
//!
//! One kind is applied today, the spec change: `amend` on an `epic` whose payload is a
//! [`SpecChange`] rewrites that one Epic field through `epic::update_epic_in_tx`. Every other kind is
//! still recorded only ([`Applied::RecordedOnly`]) until the Story that gives it its effect adds a
//! branch to [`apply_in_tx`] and, for a kind an agent files, a check to [`validate_payload`].
//!
//! A Roadmap change (issue #133, [`RoadmapChange`]) is what a roadmap Round proposes: create, amend,
//! reorder or retire a Milestone, add an Epic or drop one. Accepted, a new Milestone enters Shaping at
//! the end of the Roadmap, a new Epic enters Shaping at the end of the Milestone it names (the
//! Milestone after the Current one unless the agent named another), and a drop goes through the
//! state writers' own refusals: a Milestone holding an open Epic is not dropped, nor an Epic holding
//! an open Story.
//!
//! Slicing (issue #127) adds the Story kinds. A New Story (`create` on `story`, [`NewStory`]) is
//! created in Shaping inside the Proposal's own Epic at the rank it proposed, with its runs-after
//! marker and the one-line constraint behind it; the Proposal then names the Story it created
//! (`target_id`), so a New Story that runs after another New Story Proposal gets its marker once
//! both are accepted, in either order. A reorder (`reorder` on `story`) moves the Story to its
//! proposed rank; a retirement (`retire` on `story`) drops a Story still in Shaping. The marker is
//! informational and never blocks anything.
//!
//! Writing the Acceptance criteria (issue #128) adds the criterion kind. A New criterion (`create` on
//! `criterion`, [`NewCriterion`]) is created on a Story of the Proposal's Epic still in Shaping, then
//! its Check when it carries a command, both as the developer who accepted it. The criterion is not
//! accepted by this: in shaping, an accepted criterion is one whose Proposal was accepted, which
//! creates the row; its `accepted_by` stays empty until review. The Proposal then names the
//! criterion it created (`target_id`).
//!
//! An ADR draft (`create` on `adr`, issue #129) is checked here ([`AdrDraft`]) and has no effect on
//! the board beyond its acceptance: accepted, it is attached to its Epic, and the Epic's Story
//! packet carries it as full text until the repo holds the file (ADR 0002: Flywheel never writes
//! the repo outside a worktree).
//!
//! Judged-on changes (issue #163) are the Proposals that change what a Story is judged on
//! ([`is_judged_on`]): an Amend criterion, or an Amend Epic spec a Story session filed. Needs you lists
//! each as its own item, ranked with Review. An accepted Amend criterion (`amend` on `criterion`,
//! [`AmendCriterion`]) rewrites the statement and clears the criterion's acceptance; with a new Check
//! command the Check is replaced and reads not run, otherwise its last run is marked stale. It is
//! allowed while the Story is In review, and refused once the Story is closed.

use anyhow::Context;
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{json, Value};

use crate::domain::acceptance_criterion::{amend_criterion_in_tx, create_criterion_in_tx};
use crate::domain::check::{check_for_criterion, mark_last_run_stale_in_tx, set_check_in_tx};
use crate::domain::epic::{create_epic_in_tx, get_epic, set_epic_state_in_tx, update_epic_in_tx, EpicSpec, EpicState};
use crate::domain::milestone::{
    create_milestone_in_tx, get_milestone, move_milestone_in_tx, set_milestone_state_in_tx, update_milestone_in_tx,
    MilestoneState,
};
use crate::domain::proposal::{ProposalTarget, ProposalVerb};
use crate::domain::story::{create_story_in_tx, set_runs_after_in_tx, set_story_rank_in_tx, set_story_state_in_tx, StoryState};

/// The longest an Epic spec field may be: what the desktop's `epic_update` accepts too.
pub const MAX_SPEC_FIELD_LEN: usize = 20_000;

/// One of the Epic's four spec fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecField {
    Problem,
    Scope,
    OutOfScope,
    ExitTest,
}

impl SpecField {
    pub const ALL: [SpecField; 4] = [SpecField::Problem, SpecField::Scope, SpecField::OutOfScope, SpecField::ExitTest];

    /// The payload's `field` value, the same as the `epics` column.
    pub fn as_str(self) -> &'static str {
        match self {
            SpecField::Problem => "problem",
            SpecField::Scope => "scope",
            SpecField::OutOfScope => "out_of_scope",
            SpecField::ExitTest => "exit_test",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        SpecField::ALL.into_iter().find(|f| f.as_str() == value).with_context(|| {
            format!("{value:?} is not an Epic spec field; use problem, scope, out_of_scope or exit_test")
        })
    }

    /// The field's name as the developer reads it on the Epic card.
    pub fn label(self) -> &'static str {
        match self {
            SpecField::Problem => "Problem",
            SpecField::Scope => "Scope",
            SpecField::OutOfScope => "Out of scope",
            SpecField::ExitTest => "Exit test",
        }
    }

    fn slot(self, spec: &mut EpicSpec) -> &mut Option<String> {
        match self {
            SpecField::Problem => &mut spec.problem,
            SpecField::Scope => &mut spec.scope,
            SpecField::OutOfScope => &mut spec.out_of_scope,
            SpecField::ExitTest => &mut spec.exit_test,
        }
    }
}

/// A spec change's payload: the field it rewrites and its whole new text.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecChange {
    pub field: SpecField,
    pub text: String,
}

impl SpecChange {
    /// Read and check a payload `{ "field", "text" }`: a known field and a text that is neither blank
    /// nor longer than [`MAX_SPEC_FIELD_LEN`]. The text is trimmed.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        let field = payload.get("field").and_then(Value::as_str).context("a spec change needs `field`, a string")?;
        let field = SpecField::parse(field)?;
        let text = payload.get("text").and_then(Value::as_str).context("a spec change needs `text`, a string")?.trim();
        anyhow::ensure!(!text.is_empty(), "the proposed {} is empty", field.label());
        anyhow::ensure!(
            text.chars().count() <= MAX_SPEC_FIELD_LEN,
            "the proposed {} is at most {MAX_SPEC_FIELD_LEN} characters",
            field.label()
        );
        Ok(SpecChange { field, text: text.to_string() })
    }

    pub fn to_payload(&self) -> Value {
        json!({ "field": self.field.as_str(), "text": self.text })
    }
}

/// Whether a Proposal of `verb` on `target` is a spec change.
pub fn is_spec_change(verb: ProposalVerb, target: ProposalTarget) -> bool {
    verb == ProposalVerb::Amend && target == ProposalTarget::Epic
}

/// The longest an ADR draft's text may be.
pub const MAX_ADR_TEXT_LEN: usize = 20_000;

/// The longest an ADR draft's path or one of its bar lines may be.
pub const MAX_ADR_LINE_LEN: usize = 1_000;

/// An ADR draft (docs/mvp-spec.md §6, issue #129): the file a Story will write verbatim, at its
/// repo-relative path under `docs/adr/`, and the four bar lines shown beside it and never written
/// into it. Without the first three there is no ADR; "Relates to" may be none. It is the payload of
/// an ADR Proposal (`create` on `adr`) and what an ADR question in a Round offers.
#[derive(Debug, Clone, PartialEq)]
pub struct AdrDraft {
    /// `docs/adr/NNNN-slug.md`.
    pub path: String,
    /// The ADR's whole text, as the Story will write it.
    pub text: String,
    /// Why the decision is hard to reverse.
    pub hard_to_reverse: String,
    /// Why it would surprise a reader.
    pub surprising: String,
    /// Which alternative lost.
    pub losing_alternative: String,
    /// "Relates to: ADR-NNNN…"; `None` reads as none.
    pub relates_to: Option<String>,
}

impl AdrDraft {
    /// The three bar lines an ADR cannot go without, as `(payload key, what it says)`.
    pub const REQUIRED_BAR_LINES: [(&'static str, &'static str); 3] = AdrBarLines::REQUIRED;

    /// Read and check a payload `{ "path", "text", "hard_to_reverse", "surprising",
    /// "losing_alternative", "relates_to"? }`, every line trimmed and the text kept verbatim. A blank `relates_to` or one that
    /// says "none" is none. `at` prefixes the field a refusal names.
    pub fn from_payload_at(payload: &Value, at: &str) -> anyhow::Result<Self> {
        let bar = AdrBarLines::from_payload_at(payload, at)?;
        // The text is kept verbatim, as the Story will write it; only a blank one is refused.
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .filter(|t| !t.trim().is_empty())
            .map(str::to_string)
            .with_context(|| format!("{at}`text` is missing: the ADR's whole text"))?;
        anyhow::ensure!(text.chars().count() <= MAX_ADR_TEXT_LEN, "{at}`text` is at most {MAX_ADR_TEXT_LEN} characters");
        let AdrBarLines { path, hard_to_reverse, surprising, losing_alternative, relates_to } = bar;
        Ok(AdrDraft { path, text, hard_to_reverse, surprising, losing_alternative, relates_to })
    }

    /// [`Self::from_payload_at`] with no prefix.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        Self::from_payload_at(payload, "")
    }

    /// The draft's path and bar lines, without its text.
    pub fn bar_lines(&self) -> AdrBarLines {
        AdrBarLines {
            path: self.path.clone(),
            hard_to_reverse: self.hard_to_reverse.clone(),
            surprising: self.surprising.clone(),
            losing_alternative: self.losing_alternative.clone(),
            relates_to: self.relates_to.clone(),
        }
    }

    pub fn to_payload(&self) -> Value {
        json!({
            "path": self.path,
            "text": self.text,
            "hard_to_reverse": self.hard_to_reverse,
            "surprising": self.surprising,
            "losing_alternative": self.losing_alternative,
            "relates_to": self.relates_to,
        })
    }
}

/// Whether `path` names an ADR file: `docs/adr/<name>.md`, directly under `docs/adr/`.
pub fn is_adr_path(path: &str) -> bool {
    path.starts_with("docs/adr/")
        && path.ends_with(".md")
        && path.len() > "docs/adr/.md".len()
        && !path.contains("..")
        && !path.contains('\\')
        && !path["docs/adr/".len()..].contains('/')
}

/// An ADR's path and its four bar lines, without its text (docs/mvp-spec.md §6, issue #161): what a
/// hand-off says of each ADR its Story wrote, stored on the review (`reviews.adr_notes`) and shown
/// beside the ADR at review, never parsed out of the file (ADR 0010). [`AdrDraft`] is this plus the
/// text, and is checked the same way.
#[derive(Debug, Clone, PartialEq)]
pub struct AdrBarLines {
    /// `docs/adr/NNNN-slug.md`.
    pub path: String,
    /// Why the decision is hard to reverse.
    pub hard_to_reverse: String,
    /// Why it would surprise a reader.
    pub surprising: String,
    /// Which alternative lost.
    pub losing_alternative: String,
    /// "Relates to: ADR-NNNN…"; `None` reads as none.
    pub relates_to: Option<String>,
}

impl AdrBarLines {
    /// The three bar lines an ADR cannot go without, as `(payload key, what it says)`.
    pub const REQUIRED: [(&'static str, &'static str); 3] = [
        ("hard_to_reverse", "why the decision is hard to reverse"),
        ("surprising", "why it would surprise a reader"),
        ("losing_alternative", "which alternative lost"),
    ];

    /// Read and check `{ "path", "hard_to_reverse", "surprising", "losing_alternative",
    /// "relates_to"? }`, every line trimmed. A blank `relates_to` or one that says "none" is none.
    /// Any other key (an [`AdrDraft`]'s `text`) is ignored. `at` prefixes the field a refusal names.
    pub fn from_payload_at(payload: &Value, at: &str) -> anyhow::Result<Self> {
        let text_of = |key: &str| -> Option<String> {
            payload.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
        };
        let path = text_of("path").with_context(|| format!("{at}`path` is missing: the ADR's path, docs/adr/NNNN-slug.md"))?;
        let mut bar = Vec::with_capacity(3);
        for (key, says) in Self::REQUIRED {
            bar.push(text_of(key).with_context(|| {
                format!("{at}`{key}` is missing: an ADR carries the bar line saying {says}; without the first three bar lines there is no ADR")
            })?);
        }
        let relates_to = text_of("relates_to").filter(|r| !r.eq_ignore_ascii_case("none"));
        let [hard_to_reverse, surprising, losing_alternative] = <[String; 3]>::try_from(bar).expect("three bar lines");
        let lines = AdrBarLines { path, hard_to_reverse, surprising, losing_alternative, relates_to };
        lines.check(at)?;
        Ok(lines)
    }

    /// [`Self::from_payload_at`] with no prefix.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        Self::from_payload_at(payload, "")
    }

    fn check(&self, at: &str) -> anyhow::Result<()> {
        let path = &self.path;
        anyhow::ensure!(is_adr_path(path), "{at}`path` {path:?} is not an ADR file: an ADR lives at docs/adr/NNNN-slug.md");
        for (key, value) in [
            ("path", &self.path),
            ("hard_to_reverse", &self.hard_to_reverse),
            ("surprising", &self.surprising),
            ("losing_alternative", &self.losing_alternative),
        ] {
            anyhow::ensure!(value.chars().count() <= MAX_ADR_LINE_LEN, "{at}`{key}` is at most {MAX_ADR_LINE_LEN} characters");
        }
        if let Some(relates_to) = &self.relates_to {
            anyhow::ensure!(
                relates_to.chars().count() <= MAX_ADR_LINE_LEN,
                "{at}`relates_to` is at most {MAX_ADR_LINE_LEN} characters"
            );
        }
        Ok(())
    }

    pub fn to_payload(&self) -> Value {
        json!({
            "path": self.path,
            "hard_to_reverse": self.hard_to_reverse,
            "surprising": self.surprising,
            "losing_alternative": self.losing_alternative,
            "relates_to": self.relates_to,
        })
    }
}

/// Whether a Proposal of `verb` on `target` creates an ADR.
pub fn is_adr_draft(verb: ProposalVerb, target: ProposalTarget) -> bool {
    verb == ProposalVerb::Create && target == ProposalTarget::Adr
}

/// The longest a Milestone or Epic title may be in a Roadmap change.
pub const MAX_ROADMAP_TITLE_LEN: usize = 200;

/// The longest a Milestone exit test or a new Epic's problem may be in a Roadmap change.
pub const MAX_ROADMAP_TEXT_LEN: usize = 4_000;

/// A Roadmap change (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #133): what a
/// roadmap Round's `propose_roadmap_change` files and what accepting it does. Each is one Proposal
/// kind, a `(verb, target)` pair:
///
/// | Change | Proposal | Payload |
/// |---|---|---|
/// | `create_milestone` | create milestone | `title`, `exit_test`? |
/// | `amend_milestone` | amend milestone (target: it) | `title`?, `exit_test`?, at least one |
/// | `reorder_milestone` | reorder milestone (target: it) | `before_milestone_id`, or null for the end |
/// | `retire_milestone` | retire milestone (target: it) | none |
/// | `add_epic` | create epic | `milestone_id`, `title`, `problem`? |
/// | `drop_epic` | retire epic (target: it) | none |
#[derive(Debug, Clone, PartialEq)]
pub enum RoadmapChange {
    CreateMilestone { title: String, exit_test: Option<String> },
    AmendMilestone { milestone_id: String, title: Option<String>, exit_test: Option<String> },
    ReorderMilestone { milestone_id: String, before_milestone_id: Option<String> },
    RetireMilestone { milestone_id: String },
    AddEpic { milestone_id: String, title: String, problem: Option<String> },
    DropEpic { epic_id: String },
}

/// A trimmed, non-blank string field of `value`, or `None`; refused when longer than `max`.
fn optional_text(value: &Value, key: &str, max: usize, what: &str) -> anyhow::Result<Option<String>> {
    let Some(raw) = value.get(key).filter(|v| !v.is_null()) else { return Ok(None) };
    let text = raw.as_str().with_context(|| format!("`{key}` is not a string"))?.trim();
    anyhow::ensure!(text.chars().count() <= max, "{what} is at most {max} characters");
    Ok(if text.is_empty() { None } else { Some(text.to_string()) })
}

fn required_text(value: &Value, key: &str, max: usize, what: &str) -> anyhow::Result<String> {
    optional_text(value, key, max, what)?.with_context(|| format!("{what} (`{key}`) is missing or blank"))
}

fn required_id(value: &Value, key: &str, what: &str) -> anyhow::Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .with_context(|| format!("`{key}` is missing: the id of the {what}"))
}

impl RoadmapChange {
    /// The `change` names the tool takes, in the order it lists them.
    pub const NAMES: [&'static str; 6] =
        ["create_milestone", "amend_milestone", "reorder_milestone", "retire_milestone", "add_epic", "drop_epic"];

    /// Whether a Proposal of `verb` on `target` is a Roadmap change. An `amend` on an `epic` is a
    /// spec change, never a Roadmap one.
    pub fn is_kind(verb: ProposalVerb, target: ProposalTarget) -> bool {
        matches!(
            (verb, target),
            (_, ProposalTarget::Milestone)
                | (ProposalVerb::Create, ProposalTarget::Epic)
                | (ProposalVerb::Retire, ProposalTarget::Epic)
        )
    }

    /// Read the tool's arguments: `change` names the kind, the other fields are its own.
    pub fn from_args(args: &Value) -> anyhow::Result<Self> {
        let change = args.get("change").and_then(Value::as_str).with_context(|| {
            format!("`change` is missing: one of {}", Self::NAMES.join(", "))
        })?;
        let (verb, target, target_id) = match change {
            "create_milestone" => (ProposalVerb::Create, ProposalTarget::Milestone, None),
            "amend_milestone" => (ProposalVerb::Amend, ProposalTarget::Milestone, Some(required_id(args, "milestone_id", "Milestone to amend")?)),
            "reorder_milestone" => {
                (ProposalVerb::Reorder, ProposalTarget::Milestone, Some(required_id(args, "milestone_id", "Milestone to move")?))
            }
            "retire_milestone" => {
                (ProposalVerb::Retire, ProposalTarget::Milestone, Some(required_id(args, "milestone_id", "Milestone to retire")?))
            }
            "add_epic" => {
                // With no Milestone named, the new Epic goes after the Current Milestone: an empty id
                // here, resolved against the board where it is filed (`roadmap_round`).
                return Ok(RoadmapChange::AddEpic {
                    milestone_id: args.get("milestone_id").and_then(Value::as_str).map(str::trim).unwrap_or("").to_string(),
                    title: required_text(args, "title", MAX_ROADMAP_TITLE_LEN, "the new Epic's title")?,
                    problem: optional_text(args, "problem", MAX_ROADMAP_TEXT_LEN, "the Epic's problem")?,
                });
            }
            "drop_epic" => (ProposalVerb::Retire, ProposalTarget::Epic, Some(required_id(args, "epic_id", "Epic to drop")?)),
            other => anyhow::bail!("`change` is {other:?}; use one of {}", Self::NAMES.join(", ")),
        };
        Self::from_proposal(verb, target, target_id.as_deref(), args)
    }

    /// Read a filed Proposal back. `payload` is checked as [`Self::to_payload`] writes it.
    pub fn from_proposal(verb: ProposalVerb, target: ProposalTarget, target_id: Option<&str>, payload: &Value) -> anyhow::Result<Self> {
        let target_of = |what: &str| -> anyhow::Result<String> {
            target_id.map(str::to_string).with_context(|| format!("this Roadmap change names the {what} it lands on"))
        };
        Ok(match (verb, target) {
            (ProposalVerb::Create, ProposalTarget::Milestone) => RoadmapChange::CreateMilestone {
                title: required_text(payload, "title", MAX_ROADMAP_TITLE_LEN, "the new Milestone's outcome")?,
                exit_test: optional_text(payload, "exit_test", MAX_ROADMAP_TEXT_LEN, "the exit test")?,
            },
            (ProposalVerb::Amend, ProposalTarget::Milestone) => {
                let title = optional_text(payload, "title", MAX_ROADMAP_TITLE_LEN, "the Milestone's title")?;
                let exit_test = optional_text(payload, "exit_test", MAX_ROADMAP_TEXT_LEN, "the exit test")?;
                anyhow::ensure!(
                    title.is_some() || exit_test.is_some(),
                    "an amended Milestone changes its `title`, its `exit_test` or both: give the new text"
                );
                RoadmapChange::AmendMilestone { milestone_id: target_of("Milestone")?, title, exit_test }
            }
            (ProposalVerb::Reorder, ProposalTarget::Milestone) => {
                let before = match payload.get("before_milestone_id") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(
                        v.as_str()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .context("`before_milestone_id` is the id of the Milestone to move before, or null for the end")?
                            .to_string(),
                    ),
                };
                RoadmapChange::ReorderMilestone { milestone_id: target_of("Milestone")?, before_milestone_id: before }
            }
            (ProposalVerb::Retire, ProposalTarget::Milestone) => {
                RoadmapChange::RetireMilestone { milestone_id: target_of("Milestone")? }
            }
            (ProposalVerb::Create, ProposalTarget::Epic) => RoadmapChange::AddEpic {
                milestone_id: required_id(payload, "milestone_id", "Milestone the Epic goes into")?,
                title: required_text(payload, "title", MAX_ROADMAP_TITLE_LEN, "the new Epic's title")?,
                problem: optional_text(payload, "problem", MAX_ROADMAP_TEXT_LEN, "the Epic's problem")?,
            },
            (ProposalVerb::Retire, ProposalTarget::Epic) => RoadmapChange::DropEpic { epic_id: target_of("Epic")? },
            (verb, target) => anyhow::bail!("{} on a {} is not a Roadmap change", verb.as_str(), target.as_str()),
        })
    }

    /// The Proposal this change files: its verb, target, target id and payload.
    pub fn to_proposal(&self) -> (ProposalVerb, ProposalTarget, Option<&str>, Value) {
        match self {
            RoadmapChange::CreateMilestone { title, exit_test } => {
                (ProposalVerb::Create, ProposalTarget::Milestone, None, json!({ "title": title, "exit_test": exit_test }))
            }
            RoadmapChange::AmendMilestone { milestone_id, title, exit_test } => (
                ProposalVerb::Amend,
                ProposalTarget::Milestone,
                Some(milestone_id),
                json!({ "title": title, "exit_test": exit_test }),
            ),
            RoadmapChange::ReorderMilestone { milestone_id, before_milestone_id } => (
                ProposalVerb::Reorder,
                ProposalTarget::Milestone,
                Some(milestone_id),
                json!({ "before_milestone_id": before_milestone_id }),
            ),
            RoadmapChange::RetireMilestone { milestone_id } => {
                (ProposalVerb::Retire, ProposalTarget::Milestone, Some(milestone_id), json!({}))
            }
            RoadmapChange::AddEpic { milestone_id, title, problem } => (
                ProposalVerb::Create,
                ProposalTarget::Epic,
                None,
                json!({ "milestone_id": milestone_id, "title": title, "problem": problem }),
            ),
            RoadmapChange::DropEpic { epic_id } => (ProposalVerb::Retire, ProposalTarget::Epic, Some(epic_id), json!({})),
        }
    }

    /// The change in one line, naming the records it touches as the board reads them: what a
    /// roadmap packet lists for a rejected or a filed Proposal.
    pub fn describe(&self, conn: &rusqlite::Connection) -> String {
        let milestone = |id: &str| {
            get_milestone(conn, id).ok().flatten().map_or_else(|| format!("Milestone {id}"), |m| format!("Milestone \"{}\"", m.title))
        };
        match self {
            RoadmapChange::CreateMilestone { title, exit_test } => match exit_test {
                Some(exit) => format!("New Milestone \"{title}\" (exit test: {exit})"),
                None => format!("New Milestone \"{title}\""),
            },
            RoadmapChange::AmendMilestone { milestone_id, title, exit_test } => {
                let mut parts = Vec::new();
                if let Some(title) = title {
                    parts.push(format!("title \"{title}\""));
                }
                if let Some(exit) = exit_test {
                    parts.push(format!("exit test \"{exit}\""));
                }
                format!("Amend {}: {}", milestone(milestone_id), parts.join(", "))
            }
            RoadmapChange::ReorderMilestone { milestone_id, before_milestone_id } => match before_milestone_id {
                Some(before) => format!("Move {} before {}", milestone(milestone_id), milestone(before)),
                None => format!("Move {} to the end of the Roadmap", milestone(milestone_id)),
            },
            RoadmapChange::RetireMilestone { milestone_id } => format!("Retire {}", milestone(milestone_id)),
            RoadmapChange::AddEpic { milestone_id, title, .. } => format!("New Epic \"{title}\" in {}", milestone(milestone_id)),
            RoadmapChange::DropEpic { epic_id } => match get_epic(conn, epic_id).ok().flatten() {
                Some(e) => format!("Drop Epic {} \"{}\"", e.key, e.title),
                None => format!("Drop Epic {epic_id}"),
            },
        }
    }
}

/// The longest a Story title may be: what the desktop's `story_create` accepts too.
pub const MAX_STORY_TITLE_LEN: usize = 500;

/// The longest a Story description may be.
pub const MAX_STORY_DESCRIPTION_LEN: usize = 20_000;

/// The longest a runs-after reason may be: one line.
pub const MAX_RUNS_AFTER_REASON_LEN: usize = 500;

/// What a New Story runs after (issue #127): a Story of the Epic, or another New Story Proposal on it
/// that may not be accepted yet. A Proposal is resolved to the Story it created once both are
/// accepted, whichever is accepted first.
#[derive(Debug, Clone, PartialEq)]
pub enum RunsAfter {
    Story(String),
    Proposal(String),
}

/// A New Story Proposal's payload (`create` on `story`, issue #127): the Story's title and
/// description, its rank in the Epic's execution order and what it runs after, with the one-line
/// constraint behind it ("shares `FeedRow.tsx`"). The Epic is the Proposal's own, never the
/// payload's: no Story is created outside the Epic it was proposed in.
#[derive(Debug, Clone, PartialEq)]
pub struct NewStory {
    pub title: String,
    pub description: Option<String>,
    /// Where it lands in the Epic's execution order; `None` puts it at the end. A Story session's
    /// follow-up Story (docs/mvp-spec.md §5) carries none.
    pub rank: Option<String>,
    /// What it runs after and why, or `None`.
    pub runs_after: Option<(RunsAfter, String)>,
}

impl NewStory {
    /// Read and check a payload `{ "title", "description"?, "rank"?, "runs_after_story_id"?,
    /// "runs_after_proposal_id"?, "runs_after_reason"? }`: a title, a parseable rank, at most one
    /// thing it runs after, and a reason exactly when it runs after something.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        let text = |key: &str| payload.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        let title = text("title").context("a New Story needs a `title`")?;
        anyhow::ensure!(title.chars().count() <= MAX_STORY_TITLE_LEN, "a Story title is at most {MAX_STORY_TITLE_LEN} characters");
        let description = text("description");
        if let Some(d) = description {
            anyhow::ensure!(
                d.chars().count() <= MAX_STORY_DESCRIPTION_LEN,
                "a Story description is at most {MAX_STORY_DESCRIPTION_LEN} characters"
            );
        }
        let rank = text("rank");
        if let Some(rank) = rank {
            crate::ranking::check_rank(rank)?;
        }
        let after = match (text("runs_after_story_id"), text("runs_after_proposal_id")) {
            (Some(_), Some(_)) => anyhow::bail!("a New Story runs after one thing: a Story or a New Story Proposal, not both"),
            (Some(id), None) => Some(RunsAfter::Story(id.to_string())),
            (None, Some(id)) => Some(RunsAfter::Proposal(id.to_string())),
            (None, None) => None,
        };
        let reason = text("runs_after_reason");
        let runs_after = match (after, reason) {
            (Some(after), Some(reason)) => {
                anyhow::ensure!(!reason.contains('\n'), "the runs-after reason is one line");
                anyhow::ensure!(
                    reason.chars().count() <= MAX_RUNS_AFTER_REASON_LEN,
                    "the runs-after reason is at most {MAX_RUNS_AFTER_REASON_LEN} characters"
                );
                Some((after, reason.to_string()))
            }
            (Some(_), None) => anyhow::bail!("a New Story that runs after another needs its one-line reason"),
            (None, Some(_)) => anyhow::bail!("a runs-after reason needs the Story it runs after"),
            (None, None) => None,
        };
        Ok(NewStory { title: title.to_string(), description: description.map(str::to_string), rank: rank.map(str::to_string), runs_after })
    }

    pub fn to_payload(&self) -> Value {
        let (story, proposal, reason) = match &self.runs_after {
            Some((RunsAfter::Story(id), reason)) => (Some(id), None, Some(reason)),
            Some((RunsAfter::Proposal(id), reason)) => (None, Some(id), Some(reason)),
            None => (None, None, None),
        };
        json!({
            "title": self.title,
            "description": self.description,
            "rank": self.rank,
            "runs_after_story_id": story,
            "runs_after_proposal_id": proposal,
            "runs_after_reason": reason,
        })
    }
}

/// Whether a Proposal of `verb` on `target` creates a Story.
pub fn is_new_story(verb: ProposalVerb, target: ProposalTarget) -> bool {
    verb == ProposalVerb::Create && target == ProposalTarget::Story
}

/// A reorder Proposal's payload (`reorder` on `story`, issue #127): the Story's new rank.
pub fn reorder_rank(payload: &Value) -> anyhow::Result<String> {
    let rank = payload.get("rank").and_then(Value::as_str).context("a reorder names the Story's new `rank`")?;
    crate::ranking::check_rank(rank)?;
    Ok(rank.to_string())
}

/// Check a payload for its kind, before it is filed or applied. Kinds this module does not check yet
/// pass unchecked. A Roadmap change's target is checked where it is filed (`roadmap_round`), since
/// the payload alone does not carry it.
pub fn validate_payload(verb: ProposalVerb, target: ProposalTarget, payload: &Value) -> anyhow::Result<()> {
    if is_spec_change(verb, target) {
        SpecChange::from_payload(payload)?;
    }
    if RoadmapChange::is_kind(verb, target) {
        let placeholder = Some("target");
        RoadmapChange::from_proposal(verb, target, placeholder, payload)?;
    }
    if is_adr_draft(verb, target) {
        AdrDraft::from_payload(payload)?;
    }
    if is_new_story(verb, target) {
        NewStory::from_payload(payload)?;
    }
    if verb == ProposalVerb::Reorder && target == ProposalTarget::Story {
        reorder_rank(payload)?;
    }
    if is_new_criterion(verb, target) {
        NewCriterion::from_payload(payload)?;
    }
    if is_amend_criterion(verb, target) {
        AmendCriterion::from_payload(payload)?;
    }
    Ok(())
}

/// What applying did.
#[derive(Debug, Clone, PartialEq)]
pub enum Applied {
    /// The Epic field was rewritten.
    SpecChange { epic_id: String, field: SpecField },
    /// A Roadmap change (issue #133) landed on this Milestone or Epic: the one it created, amended,
    /// moved or dropped.
    Roadmap { record_id: String },
    /// A Story was created in Shaping inside the Proposal's Epic (issue #127).
    StoryCreated { story_id: String },
    /// A Story moved in its Epic's execution order (issue #127).
    StoryMoved { story_id: String },
    /// A Story was retired: Dropped (issue #127).
    StoryRetired { story_id: String },
    /// A criterion was created on its Story, with its Check when it carried one (issue #128).
    CriterionCreated { criterion_id: String, story_id: String },
    /// A criterion's statement was rewritten and its acceptance cleared; its Check was replaced, or its
    /// last run marked stale (issue #163).
    CriterionAmended { criterion_id: String, story_id: String },
    /// No effect for this kind yet: the decision alone was recorded.
    RecordedOnly,
}

/// The accepted Proposal being applied, as the deciding transaction read it.
pub(crate) struct Accepted<'a> {
    pub id: &'a str,
    pub project_id: &'a str,
    pub verb: ProposalVerb,
    pub target: ProposalTarget,
    pub target_id: Option<&'a str>,
    /// The Epic the Proposal was filed on (issue #127): where a New Story is created.
    pub epic_id: Option<&'a str>,
}

/// Apply `payload` (the Proposal's own, or the developer's amended one) inside the deciding
/// transaction, writing as `actor_id`, the developer who accepted it. An error rolls the decision
/// back with it.
pub(crate) fn apply_in_tx(tx: &Transaction, actor_id: &str, accepted: &Accepted, payload: &Value) -> anyhow::Result<Applied> {
    if RoadmapChange::is_kind(accepted.verb, accepted.target) {
        let change = RoadmapChange::from_proposal(accepted.verb, accepted.target, accepted.target_id, payload)?;
        return apply_roadmap_change(tx, actor_id, accepted, &change);
    }
    match (accepted.verb, accepted.target) {
        (ProposalVerb::Create, ProposalTarget::Story) => return apply_new_story(tx, actor_id, accepted, payload),
        (ProposalVerb::Create, ProposalTarget::Criterion) => return apply_new_criterion(tx, actor_id, accepted, payload),
        (ProposalVerb::Amend, ProposalTarget::Criterion) => return apply_amend_criterion(tx, actor_id, accepted, payload),
        (ProposalVerb::Reorder, ProposalTarget::Story) => {
            let story_id = accepted.target_id.context("a reorder names the Story it moves")?;
            story_in_epic(tx, story_id, accepted.epic_id)?;
            set_story_rank_in_tx(tx, actor_id, story_id, &reorder_rank(payload)?, Some(accepted.id))?;
            return Ok(Applied::StoryMoved { story_id: story_id.to_string() });
        }
        (ProposalVerb::Retire, ProposalTarget::Story) => {
            let story_id = accepted.target_id.context("a retirement names the Story it retires")?;
            let (key, state) = story_in_epic(tx, story_id, accepted.epic_id)?;
            // Retiring is for a Story not started yet, in Shaping or Ready (issue #160): it has no
            // worktree to wipe. A Story already started is dropped by the developer, through Drop.
            anyhow::ensure!(
                state == "shaping" || state == "ready",
                "{key} is {state}; only a Story not started yet (Shaping or Ready) is retired by a Proposal: drop it instead"
            );
            set_story_state_in_tx(tx, actor_id, story_id, StoryState::Dropped)?;
            return Ok(Applied::StoryRetired { story_id: story_id.to_string() });
        }
        _ => {}
    }
    if !is_spec_change(accepted.verb, accepted.target) {
        return Ok(Applied::RecordedOnly);
    }
    let change = SpecChange::from_payload(payload)?;
    let epic_id = accepted.target_id.context("a spec change names the Epic it amends")?;
    let epic = get_epic(tx, epic_id)?.with_context(|| format!("Epic {epic_id:?} not found"))?;
    let mut spec = epic.spec.clone();
    *change.field.slot(&mut spec) = Some(change.text.clone());
    update_epic_in_tx(
        tx,
        actor_id,
        epic_id,
        &epic.title,
        &spec,
        json!({
            "label": format!("Accepted a Proposal: rewrote the {}", change.field.label()),
            "field": change.field.as_str(),
            "proposal_id": accepted.id,
        }),
    )?;
    Ok(Applied::SpecChange { epic_id: epic_id.to_string(), field: change.field })
}

/// Apply an accepted Roadmap change through each record's own writer, so every refusal those writers
/// make (a Done Milestone is frozen, a Milestone holding an open Epic is not dropped, an Epic holding an
/// open Story is not dropped) refuses the acceptance too, and rolls the decision back with it.
fn apply_roadmap_change(tx: &Transaction, actor_id: &str, accepted: &Accepted, change: &RoadmapChange) -> anyhow::Result<Applied> {
    let detail = |label: String| json!({ "label": label, "proposal_id": accepted.id });
    let record_id = match change {
        RoadmapChange::CreateMilestone { title, exit_test } => {
            create_milestone_in_tx(
                tx,
                accepted.project_id,
                actor_id,
                title,
                exit_test.as_deref(),
                detail(format!("Accepted a Proposal: added Milestone \"{title}\", in Shaping")),
            )?
            .id
        }
        RoadmapChange::AmendMilestone { milestone_id, title, exit_test } => {
            let m = get_milestone(tx, milestone_id)?.with_context(|| format!("Milestone {milestone_id:?} not found"))?;
            let new_title = title.clone().unwrap_or(m.title.clone());
            let new_exit = exit_test.clone().or(m.exit_test.clone());
            update_milestone_in_tx(
                tx,
                actor_id,
                milestone_id,
                &new_title,
                new_exit.as_deref(),
                detail(format!("Accepted a Proposal: amended Milestone \"{new_title}\"")),
            )?;
            milestone_id.clone()
        }
        RoadmapChange::ReorderMilestone { milestone_id, before_milestone_id } => {
            move_milestone_in_tx(tx, actor_id, milestone_id, before_milestone_id.as_deref(), json!({ "proposal_id": accepted.id }))?;
            milestone_id.clone()
        }
        RoadmapChange::RetireMilestone { milestone_id } => {
            set_milestone_state_in_tx(
                tx,
                actor_id,
                milestone_id,
                MilestoneState::Dropped,
                detail("Accepted a Proposal: retired the Milestone".to_string()),
            )?;
            milestone_id.clone()
        }
        RoadmapChange::AddEpic { milestone_id, title, problem } => {
            let spec = EpicSpec { problem: problem.clone(), ..EpicSpec::default() };
            create_epic_in_tx(tx, actor_id, milestone_id, title, &spec, json!({ "proposal_id": accepted.id }))?.id
        }
        RoadmapChange::DropEpic { epic_id } => {
            set_epic_state_in_tx(tx, actor_id, epic_id, EpicState::Dropped, detail("Accepted a Proposal: dropped the Epic".to_string()))?;
            epic_id.clone()
        }
    };
    Ok(Applied::Roadmap { record_id })
}

/// `(key, state)` of Story `story_id`, refused unless it sits in the Proposal's Epic.
fn story_in_epic(tx: &Transaction, story_id: &str, epic_id: Option<&str>) -> anyhow::Result<(String, String)> {
    let epic_id = epic_id.context("a Story Proposal is filed on the Epic the Story sits in")?;
    let (key, state, in_epic): (String, String, String) = tx
        .query_row("SELECT key, state, epic_id FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .with_context(|| format!("Story {story_id:?} not found"))?;
    anyhow::ensure!(in_epic == epic_id, "{key} is not in the Epic this Proposal was filed on");
    Ok((key, state))
}

/// The Story an accepted New Story Proposal created, or `None` while it is undecided or rejected.
fn story_created_by(tx: &Transaction, proposal_id: &str) -> anyhow::Result<Option<String>> {
    let row: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT state, target_id FROM proposals WHERE id = ?1 AND verb = 'create' AND target_type = 'story'",
            params![proposal_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(row.and_then(|(state, story)| (state == "accepted").then_some(story).flatten()))
}

/// Create the New Story in Shaping inside the Proposal's own Epic, at the rank it proposed, with its
/// runs-after marker and reason (issue #127). The Proposal then names the Story it created. A New
/// Story that runs after a Proposal not accepted yet gets its marker once that one is: any accepted
/// Story waiting on this Proposal gets its marker here.
fn apply_new_story(tx: &Transaction, actor_id: &str, accepted: &Accepted, payload: &Value) -> anyhow::Result<Applied> {
    let story = NewStory::from_payload(payload)?;
    let epic_id = accepted.epic_id.context("a New Story Proposal is filed on the Epic the Story goes into")?;
    let created = create_story_in_tx(tx, actor_id, epic_id, &story.title, story.description.as_deref(), story.rank.as_deref())?;
    tx.execute("UPDATE proposals SET target_id = ?1 WHERE id = ?2", params![created.id, accepted.id])
        .context("failed to record the Story the Proposal created")?;

    if let Some((after, reason)) = &story.runs_after {
        let after_story = match after {
            RunsAfter::Story(id) => Some(id.clone()),
            RunsAfter::Proposal(id) => story_created_by(tx, id)?,
        };
        if let Some(after_story) = after_story {
            set_runs_after_in_tx(tx, actor_id, &created.id, Some((&after_story, reason)), Some(accepted.id))?;
        }
    }

    // Stories accepted earlier that run after this Proposal: their marker can be set now.
    let mut stmt = tx.prepare(
        "SELECT p.id, p.payload, s.id FROM proposals p JOIN stories s ON s.id = p.target_id
         WHERE p.epic_id = ?1 AND p.verb = 'create' AND p.target_type = 'story' AND p.state = 'accepted'
           AND p.id != ?2 AND s.runs_after_story_id IS NULL ORDER BY p.created_at, p.id",
    )?;
    let waiting = stmt
        .query_map(params![epic_id, accepted.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (proposal_id, waiting_payload, story_id) in waiting {
        let Ok(waiting_story) = NewStory::from_payload(&serde_json::from_str(&waiting_payload).unwrap_or(Value::Null)) else { continue };
        if let Some((RunsAfter::Proposal(after), reason)) = &waiting_story.runs_after {
            if after == accepted.id {
                set_runs_after_in_tx(tx, actor_id, &story_id, Some((&created.id, reason)), Some(&proposal_id))?;
            }
        }
    }
    Ok(Applied::StoryCreated { story_id: created.id })
}

/// The longest a criterion statement may be.
pub const MAX_CRITERION_STATEMENT_LEN: usize = 2_000;

/// The longest a Check command may be: what the desktop's `check_set` accepts too.
pub const MAX_CHECK_COMMAND_LEN: usize = 2_000;

/// A New criterion Proposal's payload (`create` on `criterion`, issue #128): the Story it is anchored
/// to, its statement, and the Check command that proves it, or none when it is judged at review.
#[derive(Debug, Clone, PartialEq)]
pub struct NewCriterion {
    pub story_id: String,
    pub statement: String,
    pub check_command: Option<String>,
}

impl NewCriterion {
    /// Read and check a payload `{ "story_id", "statement", "check_command"? }`: a Story, a statement,
    /// and a command that is not blank when one is given. A blank or null command is judged at review.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        let text = |key: &str| payload.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        let story_id = text("story_id").context("a criterion names the `story_id` it is anchored to")?;
        let statement = text("statement").context("a criterion needs a `statement`")?;
        anyhow::ensure!(
            statement.chars().count() <= MAX_CRITERION_STATEMENT_LEN,
            "a criterion statement is at most {MAX_CRITERION_STATEMENT_LEN} characters"
        );
        let check_command = match payload.get("check_command") {
            None | Some(Value::Null) => None,
            Some(Value::String(c)) if c.trim().is_empty() => None,
            Some(Value::String(c)) => {
                anyhow::ensure!(
                    c.trim().chars().count() <= MAX_CHECK_COMMAND_LEN,
                    "a Check command is at most {MAX_CHECK_COMMAND_LEN} characters"
                );
                Some(c.trim().to_string())
            }
            Some(_) => anyhow::bail!("a criterion's `check_command` is a string, or null when it is judged at review"),
        };
        Ok(NewCriterion { story_id: story_id.to_string(), statement: statement.to_string(), check_command })
    }

    pub fn to_payload(&self) -> Value {
        let mut payload = json!({ "story_id": self.story_id, "statement": self.statement });
        if let Some(command) = &self.check_command {
            payload["check_command"] = json!(command);
        }
        payload
    }
}

/// Whether a Proposal of `verb` on `target` creates an Acceptance criterion.
pub fn is_new_criterion(verb: ProposalVerb, target: ProposalTarget) -> bool {
    verb == ProposalVerb::Create && target == ProposalTarget::Criterion
}

/// Create the criterion on its Story, then its Check when it has one, as the developer who accepted
/// it (issue #128): `set_check` is human-only, and the accepting human is who sets it. The criterion
/// is not accepted here: in shaping, an accepted criterion is one whose Proposal was accepted, and
/// `accepted_by` stays empty until review. The Proposal then names the criterion it created.
fn apply_new_criterion(tx: &Transaction, actor_id: &str, accepted: &Accepted, payload: &Value) -> anyhow::Result<Applied> {
    let criterion = NewCriterion::from_payload(payload)?;
    let (key, state) = story_in_epic(tx, &criterion.story_id, accepted.epic_id)?;
    anyhow::ensure!(state == "shaping", "{key} is {state}; criteria are written on a Story still in Shaping");
    let created = create_criterion_in_tx(tx, actor_id, &criterion.story_id, &criterion.statement)?;
    if let Some(command) = &criterion.check_command {
        set_check_in_tx(tx, actor_id, &created.id, command, None)?;
    }
    tx.execute("UPDATE proposals SET target_id = ?1 WHERE id = ?2", params![created.id, accepted.id])
        .context("failed to record the criterion the Proposal created")?;
    Ok(Applied::CriterionCreated { criterion_id: created.id, story_id: criterion.story_id })
}

/// An Amend criterion Proposal's payload (`amend` on `criterion`, issue #160): the criterion it
/// rewrites, its whole new statement, and the Check command that proves it, or none to keep the Check
/// as it is. A Story session files it on a criterion of its own Epic. Accepted, it is applied by
/// [`apply_amend_criterion`] (issue #163).
#[derive(Debug, Clone, PartialEq)]
pub struct AmendCriterion {
    pub criterion_id: String,
    pub statement: String,
    pub check_command: Option<String>,
}

impl AmendCriterion {
    /// Read and check a payload `{ "criterion_id", "statement", "check_command"? }`: a criterion, a
    /// statement, and a command that is not blank when one is given, held to [`NewCriterion`]'s limits.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        let criterion_id = required_id(payload, "criterion_id", "criterion to amend")?;
        let checked = NewCriterion::from_payload(&json!({
            "story_id": criterion_id,
            "statement": payload.get("statement").cloned().unwrap_or(Value::Null),
            "check_command": payload.get("check_command").cloned().unwrap_or(Value::Null),
        }))?;
        Ok(AmendCriterion { criterion_id, statement: checked.statement, check_command: checked.check_command })
    }

    pub fn to_payload(&self) -> Value {
        let mut payload = json!({ "criterion_id": self.criterion_id, "statement": self.statement });
        if let Some(command) = &self.check_command {
            payload["check_command"] = json!(command);
        }
        payload
    }
}

/// Whether a Proposal of `verb` on `target` amends an Acceptance criterion.
pub fn is_amend_criterion(verb: ProposalVerb, target: ProposalTarget) -> bool {
    verb == ProposalVerb::Amend && target == ProposalTarget::Criterion
}

/// Whether `proposal` changes what a Story is judged on (docs/mvp-spec.md §5, issue #163): an Amend
/// criterion or an Amend Epic spec filed by a Story session. Shaping files its changes in a Round, where
/// they are decided. Needs you lists each judged-on Proposal as its own item, ranked with Review, and
/// leaves it out of the Proposals row (`query::awaits_triage!`). Mirrors `query::judged_on_proposal!`.
pub fn is_judged_on(conn: &rusqlite::Connection, proposal: &crate::domain::proposal::Proposal) -> anyhow::Result<bool> {
    let verb = ProposalVerb::parse(&proposal.verb)?;
    let target = ProposalTarget::parse(&proposal.target_type)?;
    if !(is_amend_criterion(verb, target) || is_spec_change(verb, target)) || proposal.stage_id.is_some() {
        return Ok(false);
    }
    let Some(session_id) = &proposal.session_id else { return Ok(false) };
    let kind: Option<String> =
        conn.query_row("SELECT kind FROM sessions WHERE id = ?1", params![session_id], |r| r.get(0)).optional()?;
    Ok(kind.as_deref() == Some("story"))
}

/// Apply an accepted Amend criterion (issue #163): rewrite the statement, which clears the criterion's
/// acceptance; then, with a Check command that is not the Check's own, replace the Check, which resets
/// it to not run; otherwise mark the Check's last run stale. Runs are never deleted. The criterion must
/// sit in the Proposal's Epic, on a Story not closed: accepted while the Story is In review is allowed,
/// and Merge then holds until the criterion is judged again.
fn apply_amend_criterion(tx: &Transaction, actor_id: &str, accepted: &Accepted, payload: &Value) -> anyhow::Result<Applied> {
    let change = AmendCriterion::from_payload(payload)?;
    let story_id: String = tx
        .query_row("SELECT story_id FROM acceptance_criteria WHERE id = ?1", params![change.criterion_id], |r| r.get(0))
        .optional()?
        .with_context(|| format!("criterion {:?} not found", change.criterion_id))?;
    let (key, state) = story_in_epic(tx, &story_id, accepted.epic_id)?;
    anyhow::ensure!(!StoryState::parse(&state)?.is_closed(), "{key} is {state}; a closed Story's criteria stay as they are");
    amend_criterion_in_tx(
        tx,
        actor_id,
        &change.criterion_id,
        &change.statement,
        json!({ "label": "Accepted a Proposal: amended a criterion", "proposal_id": accepted.id }),
    )?;
    let current = check_for_criterion(tx, &change.criterion_id)?;
    match &change.check_command {
        Some(command) if current.as_ref().map(|c| c.command.as_str()) != Some(command.as_str()) => {
            set_check_in_tx(tx, actor_id, &change.criterion_id, command, current.map(|c| c.timeout_secs))?;
        }
        _ => {
            mark_last_run_stale_in_tx(tx, actor_id, &change.criterion_id, accepted.id)?;
        }
    }
    Ok(Applied::CriterionAmended { criterion_id: change.criterion_id, story_id })
}
