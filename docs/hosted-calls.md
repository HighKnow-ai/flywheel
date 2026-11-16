# Hosted calls

Every call from Flywheel to a HighKnow host is declared in this file. A HighKnow host is any
`*.highknow.ai` or `*.highknow.dev` host. [ADR 0041](adr/0041-every-call-to-a-highknow-host-is-declared-in-one-allowlist.md)
says why. `scripts/hosted-calls/check-hosted-calls.mjs` reads the table below and refuses a
HighKnow host in a Rust, TypeScript, JavaScript, shell, HTML or configuration file that no row
declares.

## Columns

| Column | Meaning |
|---|---|
| Host | The host name. `*` matches any characters, so `*-api.highknow.dev` matches `staging-api.highknow.dev` |
| Path prefix | The URL path the call starts with. `-` when no call is made |
| Purpose | Why Flywheel calls the host |
| Data sent | Exactly what leaves the machine. `none` when no call is made |
| Default | `on` or `opt-in` for a call that is made, `n/a` for a host that is declared and not called |
| Privacy policy | The public `https://` URL of the section that covers the call, `n/a` when no call is made |
| Status | `called` or `declared, not called` |

## Rules

- An update check is `on` by default. It sends the version and the platform and no identifier.
- Telemetry is `opt-in`. It is off until the user turns it on, in a screen that lists what is sent.
- A row with Status `called` has a Default of `on` or `opt-in`, a path prefix that starts with `/`, and an `https://` privacy policy URL.
- A change that adds a call adds its row in the same commit.

## Declared hosts

| Host | Path prefix | Purpose | Data sent | Default | Privacy policy | Status |
|---|---|---|---|---|---|---|
| api.highknow.ai | - | Production `api` origin, `PRODUCTION_API_ORIGIN` in `packages/core/src/environment.rs`. The one origin a release build knows | none | n/a | n/a | declared, not called |
| *-api.highknow.dev | - | Non-production Environments (`staging-api`, `env-<name>-api`). Debug builds only, a release build holds none | none | n/a | n/a | declared, not called |
| highknow.dev | - | The zone name that builds the non-production hosts. It is named in code and in the release-bundle check, and it is not a host Flywheel calls | none | n/a | n/a | declared, not called |
