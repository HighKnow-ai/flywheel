//! Behavior under test (01-01-PLAN.md Task 3):
//! - `new_id()` returns a 26-character string.
//! - 1,000 successive calls are strictly ascending and contain no duplicate.
//! - `is_ulid()` recognizes the 26-character Crockford-base32 shape.

use flywheel_core::ids::{is_ulid, new_id};
use std::collections::HashSet;

#[test]
fn new_id_returns_26_character_string() {
    let id = new_id();
    assert_eq!(id.len(), 26, "expected a 26-character ULID, got {id:?}");
}

#[test]
fn new_id_is_recognized_as_a_ulid() {
    let id = new_id();
    assert!(is_ulid(&id), "{id:?} should be recognized as a ULID");
}

#[test]
fn is_ulid_rejects_malformed_input() {
    assert!(!is_ulid(""));
    assert!(!is_ulid("too-short"));
    assert!(!is_ulid(&"0".repeat(25)));
    assert!(!is_ulid(&"0".repeat(27)));
    // 'I', 'L', 'O', 'U' are excluded from Crockford base32.
    assert!(!is_ulid("0IL21VR17BZ33DG1X564KV0YE"));
}

#[test]
fn one_thousand_successive_ids_are_ascending_and_unique() {
    let mut ids = Vec::with_capacity(1000);
    for _ in 0..1000 {
        ids.push(new_id());
    }

    let unique: HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len(), "expected no duplicate ULIDs");

    for pair in ids.windows(2) {
        assert!(
            pair[0] < pair[1],
            "expected strictly ascending ULIDs, but {:?} >= {:?}",
            pair[0],
            pair[1]
        );
    }
}
