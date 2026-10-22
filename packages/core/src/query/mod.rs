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

pub mod sessions;
pub mod events;
pub mod fleet;
pub mod permissions;
pub mod progress;
pub mod recovery;
