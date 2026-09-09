//! `relay-client` is the open-core seam described in `ARCHITECTURE.md` §8
//! "Open-Core Module Boundary".
//!
//! It is a thin, OSS client that will one day read the event-log cursor
//! from `packages/core` and POST batches of events to a *configured* relay
//! URL, disabled by default. It contains zero commercial logic — no auth,
//! billing, or hosted-infra client code — and depends on nothing else in
//! this workspace.
//!
//! This crate holds no logic in this phase (Phase 1: The Board Is The
//! Store Of Record). Nothing in `packages/core` or `packages/desktop`
//! depends on it, and it depends on nothing in the commercial `relay` or
//! `cloud-app` packages, which do not exist in this repository. Its only
//! purpose right now is to keep the open/paid module boundary real from
//! the first commit, so the CI rule that OSS packages build with the
//! commercial packages absent has something concrete to check.
