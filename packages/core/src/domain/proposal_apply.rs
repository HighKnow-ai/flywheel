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

use anyhow::Context;
use rusqlite::Transaction;
use serde_json::{json, Value};

use crate::domain::epic::{get_epic, update_epic_in_tx, EpicSpec};
use crate::domain::proposal::{ProposalTarget, ProposalVerb};

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

/// Check a payload for its kind, before it is filed or applied. Kinds this module does not apply yet
/// pass unchecked.
pub fn validate_payload(verb: ProposalVerb, target: ProposalTarget, payload: &Value) -> anyhow::Result<()> {
    if is_spec_change(verb, target) {
        SpecChange::from_payload(payload)?;
    }
    Ok(())
}

/// What applying did.
#[derive(Debug, Clone, PartialEq)]
pub enum Applied {
    /// The Epic field was rewritten.
    SpecChange { epic_id: String, field: SpecField },
    /// No effect for this kind yet: the decision alone was recorded.
    RecordedOnly,
}

/// The accepted Proposal being applied, as the deciding transaction read it.
pub(crate) struct Accepted<'a> {
    pub id: &'a str,
    pub verb: ProposalVerb,
    pub target: ProposalTarget,
    pub target_id: Option<&'a str>,
}

/// Apply `payload` (the Proposal's own, or the developer's amended one) inside the deciding
/// transaction, writing as `actor_id`, the developer who accepted it. An error rolls the decision
/// back with it.
pub(crate) fn apply_in_tx(tx: &Transaction, actor_id: &str, accepted: &Accepted, payload: &Value) -> anyhow::Result<Applied> {
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
