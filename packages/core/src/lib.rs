//! Flywheel domain crate: schema, persistence, and the store-of-record write path.
//!
//! Owns the SQLite connection exclusively (no other crate in this workspace opens the
//! database file directly, per `ARCHITECTURE.md` Anti-Pattern 3 and D-03).

pub mod branch;
pub mod compaction;
pub mod context_packet;
pub mod credentials;
pub mod db;
pub mod destructive;
pub mod domain;
pub mod drift;
pub mod epic_context_packet;
pub mod file_set;
pub mod forge;
pub mod git;
pub mod git_facts;
pub mod git_hooks;
pub mod git_identity;
pub mod git_retry;
pub mod ids;
pub mod marker;
pub mod merge;
pub mod proc;
pub mod query;
pub mod ranking;
pub mod review;
pub mod runtime_protocol;
pub mod shim;
pub mod session_log;
