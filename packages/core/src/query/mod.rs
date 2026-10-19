//! Bounded, read-only queries the command surface serves. Every statement in these modules is a
//! literal string bound through `params![]` — never assembled with string interpolation — so the
//! shape of every query is fixed at compile time and only the values a caller supplies change what
//! it matches (T-01-01, T-01-23).
//!
//! The board reads (Roadmap, roster, Needs you) are rebuilt by the board surface; the record reads
//! a surface needs today live beside their writers in `crate::domain`.

pub mod agent_runs;
pub mod events;
pub mod fleet;
pub mod permissions;
pub mod recovery;
