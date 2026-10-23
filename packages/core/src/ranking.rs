//! Manual rank / reorder key (D-11, BOARD-05), wrapping `fractional_index::FractionalIndex`.
//!
//! `rank` is a persisted `TEXT` column. `FractionalIndex::to_string()`/`from_string()` produce
//! and parse the hex-string form whose byte-comparison order matches `FractionalIndex`'s own
//! `Ord`, so `ORDER BY rank ASC` in SQL reproduces the crate's ordering exactly
//! (01-RESEARCH.md Flag 4). Moving one item rewrites one row — never a renumbering pass over the
//! list.
//!
//! **Watch item, not a bug (01-RESEARCH.md Pitfall 5):** repeatedly moving items to the same
//! boundary (e.g. always reordering to the very top of a band) grows the rank string without
//! bound — the documented tradeoff of fractional indexing, since each new boundary value must
//! encode strictly before/after the previous one. At this phase's scale — human-paced
//! reordering over roughly 1,000 items per project — that growth is immaterial and is not worth
//! a rebalancing job. Revisit only if an automated writer starts moving items to one boundary in
//! bulk (see T-01-22 in the plan's threat register).

use anyhow::{anyhow, Context};
use fractional_index::FractionalIndex;

/// Which direction a keyboard/programmatic reorder moves an item (`⌘↑`/`⌘↓`, D-11, BOARD-05).
/// Shared by `reorder_task`/`reorder_epic`/`reorder_issue` — the domain layer, not this enum,
/// owns computing the new rank from an item's neighbours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReorderDirection {
    Up,
    Down,
}

impl ReorderDirection {
    /// Parse the Tauri command layer's `"up"`/`"down"` string argument — the one seam between
    /// the renderer's keystroke (`⌘↑`/`⌘↓`) and this crate's own enum. The command handler
    /// passes through whatever the renderer sends; only this function decides what is valid.
    pub fn parse(value: &str) -> anyhow::Result<Self> {
        match value {
            "up" => Ok(Self::Up),
            "down" => Ok(Self::Down),
            other => Err(anyhow!(
                "unknown reorder direction {other:?} — expected \"up\" or \"down\""
            )),
        }
    }
}

/// Refuse anything that is not a rank this module could have written: a rank carried in a payload
/// (an accepted New Story or reorder Proposal, issue #127) is checked before it is stored.
pub fn check_rank(raw: &str) -> anyhow::Result<()> {
    FractionalIndex::from_string(raw).with_context(|| format!("{raw:?} is not a rank"))?;
    Ok(())
}

/// Compute a rank that sorts after `prev`, or the very first rank in an empty band if `prev` is
/// `None`. Used when appending a new item to the tail of a status band.
pub fn rank_after(prev: Option<&str>) -> anyhow::Result<String> {
    let next = match prev {
        Some(raw) => {
            let parsed = FractionalIndex::from_string(raw)
                .with_context(|| format!("failed to parse rank {raw:?}"))?;
            FractionalIndex::new_after(&parsed)
        }
        None => FractionalIndex::default(),
    };
    Ok(next.to_string())
}

/// Compute a rank that sorts before `next`, or the very first rank in an empty band if `next` is
/// `None`. The mirror image of [`rank_after`] — used when moving an item to the very front of an
/// existing list (a keyboard reorder onto the current head, or a future drag-to-top target).
pub fn rank_before(next: Option<&str>) -> anyhow::Result<String> {
    let prev = match next {
        Some(raw) => {
            let parsed = FractionalIndex::from_string(raw)
                .with_context(|| format!("failed to parse rank {raw:?}"))?;
            FractionalIndex::new_before(&parsed)
        }
        None => FractionalIndex::default(),
    };
    Ok(prev.to_string())
}

/// Compute a rank that sorts strictly between `prev` and `next` — both required, and required to
/// already be distinct and in order. Used for reordering an existing row between two neighbours
/// (a keyboard reorder, or a future drag target).
pub fn rank_between(prev: &str, next: &str) -> anyhow::Result<String> {
    let prev_idx = FractionalIndex::from_string(prev)
        .with_context(|| format!("failed to parse rank {prev:?}"))?;
    let next_idx = FractionalIndex::from_string(next)
        .with_context(|| format!("failed to parse rank {next:?}"))?;
    let between = FractionalIndex::new_between(&prev_idx, &next_idx).ok_or_else(|| {
        anyhow!("cannot compute a rank between {prev:?} and {next:?} — they must be distinct and in order")
    })?;
    Ok(between.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rank_after_none_then_after_that_is_ascending() {
        let first = rank_after(None).unwrap();
        let second = rank_after(Some(&first)).unwrap();
        assert!(first < second, "{first:?} should sort before {second:?}");
    }

    #[test]
    fn rank_between_sorts_strictly_between_its_bounds() {
        let a = rank_after(None).unwrap();
        let c = rank_after(Some(&a)).unwrap();
        let b = rank_between(&a, &c).unwrap();
        assert!(a < b, "{a:?} should sort before {b:?}");
        assert!(b < c, "{b:?} should sort before {c:?}");
    }

    #[test]
    fn rank_between_rejects_out_of_order_bounds() {
        let a = rank_after(None).unwrap();
        let c = rank_after(Some(&a)).unwrap();
        assert!(rank_between(&c, &a).is_err());
    }

    #[test]
    fn rank_before_none_then_before_that_is_descending() {
        let head = rank_before(None).unwrap();
        let new_head = rank_before(Some(&head)).unwrap();
        assert!(new_head < head, "{new_head:?} should sort before {head:?}");
    }

    #[test]
    fn rank_before_sorts_strictly_before_its_bound() {
        let a = rank_after(None).unwrap();
        let before_a = rank_before(Some(&a)).unwrap();
        assert!(before_a < a, "{before_a:?} should sort before {a:?}");
    }
}
