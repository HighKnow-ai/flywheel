//! Bounded, read-only queries the command surface serves. Every statement in these modules is a
//! literal string bound through `params![]` — never assembled with string interpolation — so the
//! shape of every query is fixed at compile time and only the values a caller supplies change what
//! it matches (T-01-01, T-01-23).
//!
//! The board reads (Roadmap, roster, Needs you) are rebuilt by the board surface; the record reads
//! a surface needs today live beside their writers in `crate::domain`.

/// The one derivation of a Round Waiting on you (docs/mvp-spec.md §2 "Attention", issue #124), as a
/// literal SQL predicate over a `rounds` row aliased `r`: the Round is open, a call is held on it, and
/// the session holding that call is live. A held Round never writes `sessions.status = 'blocked'`,
/// and a dead session's call stays on the Round until a `round_wait` takes it over, so neither the
/// session's status nor `held_request_id` alone says it. Spliced with `concat!`, never `format!`.
macro_rules! round_waiting_on_you {
    () => {
        "(r.state = 'open' AND r.held_request_id IS NOT NULL AND EXISTS (SELECT 1 FROM sessions rs \
            WHERE rs.id = r.session_id AND rs.status IN ('running', 'blocked')))"
    };
}
pub(crate) use round_waiting_on_you;

/// A judged-on change (docs/mvp-spec.md §5, issue #163), as a literal SQL predicate over a `proposals`
/// row aliased `p`: an Amend criterion or an Amend Epic spec filed by a Story session (so in no shaping
/// Stage; shaping decides its spec changes in its Round). It changes what a Story is judged on, so it is
/// its own Needs-you item, never in the Proposals row. Mirrored by `domain::proposal_apply::is_judged_on`.
/// Spliced with `concat!`, never `format!`.
macro_rules! judged_on_proposal {
    () => {
        "(p.verb = 'amend' AND p.target_type IN ('criterion', 'epic') AND p.stage_id IS NULL \
            AND EXISTS (SELECT 1 FROM sessions js WHERE js.id = p.session_id AND js.kind = 'story'))"
    };
}
pub(crate) use judged_on_proposal;

/// The one derivation of a Proposal awaiting triage (docs/mvp-spec.md §5, issue #162), as a literal
/// SQL predicate over a `proposals` row aliased `p`: pending, filed by a Story session (so in no shaping
/// Stage), and not a judged-on change (`judged_on_proposal!`, issue #163), which is its own Needs-you
/// item. The Needs-you Proposals row, the triage drawer and each Epic row's "n Proposals" count this one
/// set.
macro_rules! awaits_triage {
    () => {
        concat!(
            "(p.state = 'pending' AND p.stage_id IS NULL \
            AND EXISTS (SELECT 1 FROM sessions ps WHERE ps.id = p.session_id AND ps.kind = 'story') \
            AND NOT ",
            crate::query::judged_on_proposal!(),
            ")"
        )
    };
}
pub(crate) use awaits_triage;

/// The one derivation of a Story the developer can Make Ready (docs/mvp-spec.md §2, issue #166), as a
/// literal SQL predicate over a `stories` row aliased `s` and its Epic aliased `e`: the Story is in
/// Shaping, its Epic's shaping is closed (Ready or In progress: an Epic still in Shaping makes its
/// Stories Ready when its criteria Stage closes), and it has at least one Acceptance criterion. The
/// roster's Make Ready, the Story view's and `story::make_ready`'s refusals all read this one rule.
macro_rules! can_make_ready {
    () => {
        "(s.state = 'shaping' AND e.state IN ('ready', 'in_progress') \
            AND EXISTS (SELECT 1 FROM acceptance_criteria mc WHERE mc.story_id = s.id))"
    };
}
pub(crate) use can_make_ready;

pub mod events;
pub mod fleet;
pub mod needs_you;
pub mod permissions;
pub mod progress;
pub mod recovery;
pub mod roster;
pub mod sessions;
