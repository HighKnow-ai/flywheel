//! Flywheel domain crate: schema, persistence, and the store-of-record write path.
//!
//! Owns the SQLite connection exclusively (no other crate in this workspace opens the
//! database file directly, per `ARCHITECTURE.md` Anti-Pattern 3 and D-03).

pub mod db;
pub mod ids;
