//! D-22/D-23 (phase 15): the deterministic pre-filter a DRAFTED acceptance criterion passes before
//! it can be staged. [`lint_statement`] answers one question about one string — does this
//! statement carry a defect an agent can fix on its next attempt — and nothing else.
//!
//! Pure: no connection, no configuration, no settings key (the `file_set.rs` / `merge.rs`
//! convention). Every rule is a function of the statement string alone, so the verdict a drafting
//! agent gets and the verdict a test gets can never disagree.
//!
//! [`lint_statement`] REJECTS, never repairs (`file_set::parse_entry`'s discipline): it returns the
//! refusal, never a corrected string, because a repaired draft is a criterion nobody wrote. The
//! offending statement travels back verbatim inside the refusal.
//!
//! The lint judges agent-drafted text only. Applied to a human's own typed criterion the same rule
//! set is advice, never a gate (D-25): nothing in this module can make a human-authored statement
//! unsaveable, and nothing here is called from a human write path.

use std::fmt;

/// Compound corpus: a whole word or phrase that joins two claims into one criterion. One criterion
/// is one checkable claim. A `;` also fires the rule (see [`lint_statement`]).
pub const CONJUNCTIONS: [&str; 6] = ["and", "also", "plus", "as well as", "along with", "additionally"];

/// Vague-verb corpus: a word or phrase that names no checkable behaviour ("works", "handles it
/// correctly", "is user-friendly"). Hyphens read as spaces, so `user friendly` covers both spellings.
pub const VAGUE_TERMS: [&str; 30] = [
    "work",
    "works",
    "working",
    "correct",
    "correctly",
    "proper",
    "properly",
    "appropriate",
    "appropriately",
    "handle",
    "handles",
    "handled",
    "support",
    "supports",
    "ensure",
    "ensures",
    "as expected",
    "user friendly",
    "intuitive",
    "robust",
    "seamless",
    "seamlessly",
    "good",
    "nice",
    "easy",
    "easily",
    "efficient",
    "efficiently",
    "reasonable",
    "fast",
];

/// Observable-marker corpus: a verb that names something a reader can see happen. A statement with
/// none of these, no digit and no quoted literal names no observable ([`CriterionRefusal::NoObservable`]).
pub const OBSERVABLE_MARKERS: [&str; 44] = [
    "returns",
    "return",
    "shows",
    "show",
    "displays",
    "display",
    "renders",
    "render",
    "emits",
    "emit",
    "writes",
    "write",
    "appends",
    "append",
    "rejects",
    "reject",
    "refuses",
    "refuse",
    "fails",
    "fail",
    "errors",
    "logs",
    "contains",
    "contain",
    "equals",
    "lists",
    "list",
    "produces",
    "creates",
    "create",
    "deletes",
    "removes",
    "stores",
    "persists",
    "records",
    "sends",
    "responds",
    "exits",
    "prints",
    "reports",
    "opens",
    "blocks",
    "never",
    "without",
];

/// Why [`lint_statement`] refused a statement. Each variant carries the statement verbatim and the
/// token that fired (empty for [`CriterionRefusal::NoObservable`], which fires on an absence), and
/// renders one sentence an agent can act on in the same run through [`fmt::Display`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CriterionRefusal {
    /// Joins two claims. Split it into one criterion per claim.
    Compound { statement: String, token: String },
    /// Names no checkable behaviour. Replace the vague term with what a reader would see.
    VagueVerb { statement: String, token: String },
    /// Names nothing a reader could observe: no result, no output, no count, no quoted value.
    NoObservable { statement: String },
}

impl fmt::Display for CriterionRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CriterionRefusal::Compound { statement, token } => write!(
                f,
                "criterion refused as compound: it joins two claims with {token:?}. Split it into one \
                 criterion per claim and draft each again. Statement: {statement}"
            ),
            CriterionRefusal::VagueVerb { statement, token } => write!(
                f,
                "criterion refused as vague: {token:?} names no checkable behaviour. Say what a reader \
                 would see happen instead, and draft it again. Statement: {statement}"
            ),
            CriterionRefusal::NoObservable { statement } => write!(
                f,
                "criterion refused: it names no observable result (no result, output, count or quoted \
                 value). State what can be seen when it holds, and draft it again. Statement: {statement}"
            ),
        }
    }
}

impl std::error::Error for CriterionRefusal {}

/// Lowercase words joined by single spaces, with a space at each end, so a whole-word or
/// whole-phrase test is one `contains(" term ")`. Every non-alphanumeric character is a separator.
fn normalised(statement: &str) -> String {
    let lowered = statement.to_lowercase();
    let words: Vec<&str> = lowered.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    format!(" {} ", words.join(" "))
}

fn first_term<'a>(haystack: &str, corpus: &[&'a str]) -> Option<&'a str> {
    corpus.iter().copied().find(|term| haystack.contains(&format!(" {term} ")))
}

/// Lint one drafted criterion statement. `Ok(())` means no rule fired; it never means the
/// statement is good. Rules run in a fixed order and the first to fire is the one reported:
/// compound, then vague verb, then no observable.
pub fn lint_statement(statement: &str) -> Result<(), CriterionRefusal> {
    let words = normalised(statement);

    if statement.contains(';') {
        return Err(CriterionRefusal::Compound { statement: statement.to_string(), token: ";".to_string() });
    }
    if let Some(token) = first_term(&words, &CONJUNCTIONS) {
        return Err(CriterionRefusal::Compound { statement: statement.to_string(), token: token.to_string() });
    }
    if let Some(token) = first_term(&words, &VAGUE_TERMS) {
        return Err(CriterionRefusal::VagueVerb { statement: statement.to_string(), token: token.to_string() });
    }
    let has_literal = statement.chars().any(|c| c.is_ascii_digit() || matches!(c, '"' | '`' | '“' | '”'));
    if !has_literal && first_term(&words, &OBSERVABLE_MARKERS).is_none() {
        return Err(CriterionRefusal::NoObservable { statement: statement.to_string() });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_rule_class_fires_and_a_clean_statement_passes() {
        assert!(matches!(
            lint_statement("Rejects an empty title and logs the refusal"),
            Err(CriterionRefusal::Compound { ref token, .. }) if token == "and"
        ));
        assert!(matches!(
            lint_statement("The importer handles malformed rows"),
            Err(CriterionRefusal::VagueVerb { ref token, .. }) if token == "handles"
        ));
        assert!(matches!(
            lint_statement("The retry budget is configurable"),
            Err(CriterionRefusal::NoObservable { .. })
        ));
        // Hyphenated vague term, matched case-insensitively.
        assert!(matches!(lint_statement("The panel is User-Friendly"), Err(CriterionRefusal::VagueVerb { .. })));
        assert_eq!(lint_statement("Rejects an empty title with a named error"), Ok(()));
        assert_eq!(lint_statement("The 31st draft is refused"), Ok(()));
    }

    #[test]
    fn a_refusal_carries_the_statement_verbatim_and_never_a_repair() {
        let statement = "  Works AND  scales  ";
        let refusal = lint_statement(statement).unwrap_err();
        assert!(refusal.to_string().contains(statement));
    }
}
