# relay-client

This crate is the open-core seam described in `ARCHITECTURE.md` §8 "Open-Core Module Boundary".

It holds no logic in this phase (Phase 1: The Board Is The Store Of Record) and has zero
dependencies. In a later milestone it will read the event-log cursor exposed by `packages/core`
and POST batches to a *configured* relay URL — disabled by default, with zero commercial logic
(no auth, billing, or hosted-infra client code) living client-side.

Neither `packages/core` nor `packages/desktop` depends on this crate, and this crate depends on
neither the (not-yet-existing) commercial `relay` server nor `cloud-app`. The open-source packages
in this repository build and run correctly with this crate present but unused — the module
boundary is real from the first commit.
