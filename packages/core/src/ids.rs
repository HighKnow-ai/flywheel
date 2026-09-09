//! ULID generation (DATA-02). RED stub — see 01-01-PLAN.md Task 3.
//! Deliberately wrong: returns an empty string and never recognizes a ULID, so the
//! RED-phase tests in `tests/ids.rs` fail on their assertions, not on a missing symbol.

pub fn new_id() -> String {
    String::new()
}

pub fn is_ulid(_s: &str) -> bool {
    false
}
