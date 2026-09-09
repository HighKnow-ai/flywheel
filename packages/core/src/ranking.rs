//! Manual rank / reorder key (D-11, BOARD-05), wrapping `fractional_index::FractionalIndex`.
//!
//! `rank` is a persisted `TEXT` column. `FractionalIndex::to_string()`/`from_string()` produce
//! and parse the hex-string form whose byte-comparison order matches `FractionalIndex`'s own
//! `Ord`, so `ORDER BY rank ASC` in SQL reproduces the crate's ordering exactly
//! (01-RESEARCH.md Flag 4). Moving one item rewrites one row — never a renumbering pass over the
//! list.

use anyhow::{anyhow, Context};
use fractional_index::FractionalIndex;

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
}
