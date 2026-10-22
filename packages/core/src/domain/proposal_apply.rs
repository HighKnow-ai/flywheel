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
//! An ADR draft (`create` on `adr`, issue #129) is checked here ([`AdrDraft`]) and has no effect on
//! the board beyond its acceptance: accepted, it is attached to its Epic, and the Epic's Story
//! packet carries it as full text until the repo holds the file (ADR 0002: Flywheel never writes
//! the repo outside a worktree).

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
    pub const REQUIRED_BAR_LINES: [(&'static str, &'static str); 3] = [
        ("hard_to_reverse", "why the decision is hard to reverse"),
        ("surprising", "why it would surprise a reader"),
        ("losing_alternative", "which alternative lost"),
    ];

    /// Read and check a payload `{ "path", "text", "hard_to_reverse", "surprising",
    /// "losing_alternative", "relates_to"? }`, every line trimmed and the text kept verbatim. A blank `relates_to` or one that
    /// says "none" is none. `at` prefixes the field a refusal names.
    pub fn from_payload_at(payload: &Value, at: &str) -> anyhow::Result<Self> {
        let text_of = |key: &str| -> Option<String> {
            payload.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
        };
        let path = text_of("path").with_context(|| format!("{at}`path` is missing: the ADR's path, docs/adr/NNNN-slug.md"))?;
        // The text is kept verbatim, as the Story will write it; only a blank one is refused.
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .filter(|t| !t.trim().is_empty())
            .map(str::to_string)
            .with_context(|| format!("{at}`text` is missing: the ADR's whole text"))?;
        let mut bar = Vec::with_capacity(3);
        for (key, says) in Self::REQUIRED_BAR_LINES {
            bar.push(text_of(key).with_context(|| {
                format!("{at}`{key}` is missing: an ADR carries the bar line saying {says}; without the first three bar lines there is no ADR")
            })?);
        }
        let relates_to = text_of("relates_to").filter(|r| !r.eq_ignore_ascii_case("none"));
        let [hard_to_reverse, surprising, losing_alternative] = <[String; 3]>::try_from(bar).expect("three bar lines");
        let draft = AdrDraft { path, text, hard_to_reverse, surprising, losing_alternative, relates_to };
        draft.check(at)?;
        Ok(draft)
    }

    /// [`Self::from_payload_at`] with no prefix.
    pub fn from_payload(payload: &Value) -> anyhow::Result<Self> {
        Self::from_payload_at(payload, "")
    }

    fn check(&self, at: &str) -> anyhow::Result<()> {
        let path = &self.path;
        anyhow::ensure!(
            path.starts_with("docs/adr/")
                && path.ends_with(".md")
                && path.len() > "docs/adr/.md".len()
                && !path.contains("..")
                && !path.contains('\\')
                && !path["docs/adr/".len()..].contains('/'),
            "{at}`path` {path:?} is not an ADR file: an ADR lives at docs/adr/NNNN-slug.md"
        );
        for (key, value, max) in [
            ("path", &self.path, MAX_ADR_LINE_LEN),
            ("text", &self.text, MAX_ADR_TEXT_LEN),
            ("hard_to_reverse", &self.hard_to_reverse, MAX_ADR_LINE_LEN),
            ("surprising", &self.surprising, MAX_ADR_LINE_LEN),
            ("losing_alternative", &self.losing_alternative, MAX_ADR_LINE_LEN),
        ] {
            anyhow::ensure!(value.chars().count() <= max, "{at}`{key}` is at most {max} characters");
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
            "text": self.text,
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

/// Check a payload for its kind, before it is filed or applied. Kinds this module does not check yet
/// pass unchecked.
pub fn validate_payload(verb: ProposalVerb, target: ProposalTarget, payload: &Value) -> anyhow::Result<()> {
    if is_spec_change(verb, target) {
        SpecChange::from_payload(payload)?;
    }
    if is_adr_draft(verb, target) {
        AdrDraft::from_payload(payload)?;
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
