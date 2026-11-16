# Every call to a HighKnow host is declared in one allowlist

Decided on 2026-11-16 (issue #1695, owner decision Q64). Flywheel will call services that HighKnow runs: an update check, telemetry, and later a hosted version. Today it calls none. The open-source app must stay one a user can trust, so each call is declared before it exists.

## Decision

- **Update checks are on by default.** An update check sends the version and the platform and nothing else. It carries no identifier: no install ID, no user ID, no machine name.
- **Telemetry is opt-in.** It is off until the user turns it on. The screen that turns it on lists exactly what is sent. A change to what is sent changes that list in the same commit.
- **One allowlist.** Every call from Flywheel to a HighKnow host is a row in [`docs/hosted-calls.md`](../hosted-calls.md). A HighKnow host is any `*.highknow.ai` or `*.highknow.dev` host, and the origin in `PRODUCTION_API_ORIGIN`. A row names the host, the path prefix, the purpose, the data sent, the default (`on` or `opt-in`) and the public privacy policy URL that covers the call.
- **A host named in code is a host declared.** `PRODUCTION_API_ORIGIN` and the non-production hosts are rows with the status `declared, not called`, until a call uses them.

## The check

`scripts/hosted-calls/check-hosted-calls.mjs` reads the allowlist. It scans the Rust, TypeScript, JavaScript, shell, HTML and configuration files under `flywheel/` for HighKnow hosts. It refuses a host that no row matches, and a row that is not well formed (a `called` row needs a default of `on` or `opt-in`, a path and an `https://` policy URL). `scripts/hosted-calls/test/check-hosted-calls.test.mjs` is the positive control: an undeclared host fails and a declared one passes. The `uat` job in `.github/workflows/ci.yml` runs both.

## Rejected alternatives

- **A lint on the HTTP client only.** A call can be written with any client, or built from a constant. A scan for the host catches it whatever the client.
- **An allowlist in Rust code.** The privacy policy and a reviewer read a table, not a source file. A table is also one file for the Rust core and the sidecar.
- **An opt-out for telemetry.** The owner chose consent first.

## Consequences

- A new call needs a row first. The review of that row is where the data sent and the privacy policy section are checked.
- A host that is only named in a comment or a test needs a row too. That is cheap, and it means no call hides behind a string.
- The check finds a host by name. A host built at run time from parts is not found. A reviewer holds that line, and the release-bundle check (`scripts/release/check-release-bundle.mjs`) still holds a release binary to the production origin.

## Enforced by

- `scripts/hosted-calls/check-hosted-calls.mjs`, run by the `uat` job in `.github/workflows/ci.yml`.
- `scripts/hosted-calls/test/check-hosted-calls.test.mjs`, run by the same job.
