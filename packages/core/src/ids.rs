//! ULID generation (DATA-02). Every entity id in this project comes from `new_id()`.

use once_cell::sync::Lazy;
use std::sync::Mutex;
use ulid::Generator;

/// Crockford base32 alphabet ULIDs are encoded with — excludes I, L, O, U to avoid
/// visual ambiguity with 1, 1, 0, V.
const CROCKFORD_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Process-wide monotonic generator so two `new_id()` calls in the same millisecond stay
/// strictly ascending, per `ulid::Generator`'s documented monotonic algorithm.
static GENERATOR: Lazy<Mutex<Generator>> = Lazy::new(|| Mutex::new(Generator::new()));

/// Generate a new client-side entity id: a 26-character, lexicographically sortable ULID.
///
/// Same-millisecond calls are guaranteed strictly ascending via the process-wide monotonic
/// generator. On the (astronomically unlikely) random-bits overflow within one millisecond,
/// we commit the overflow by incrementing rather than re-randomizing, to preserve strict
/// ordering rather than durability of "random" bits (`ulid::Generator::generate` docs).
pub fn new_id() -> String {
    let mut generator = GENERATOR.lock().expect("ULID generator mutex poisoned");
    let ulid = match generator.generate() {
        Ok(ulid) => ulid,
        Err(overflow) => overflow.commit_overflow_increment(),
    };
    ulid.to_string()
}

/// Check whether `s` has the 26-character Crockford-base32 shape of a ULID.
///
/// This is a shape check, not a full round-trip decode: every character must be a valid
/// Crockford base32 symbol (case-insensitive) and the string must be exactly 26 characters.
pub fn is_ulid(s: &str) -> bool {
    if s.len() != 26 {
        return false;
    }
    s.chars()
        .all(|c| CROCKFORD_ALPHABET.contains(c.to_ascii_uppercase()))
}
