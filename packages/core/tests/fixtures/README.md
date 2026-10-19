# Migration-safety fixtures (DATA-08)

`tests/migration_safety.rs` needs a database that sits one schema version behind a newer migration
list (the "N-1" database). No binary `.db` file is committed for that purpose — a committed binary
fixture goes stale silently, and nobody can tell from the diff whether it was regenerated correctly.

The migration list starts at the MVP baseline (ADR 0003), so the "N-1" database is **built in code,
every test run**: a fresh scratch file is opened through the real `open_and_migrate` (the baseline),
a known row is inserted, and `open_and_migrate_with` then runs `core::db::migration_sources()` plus
one more ordinary migration (an added nullable column, the shape ADR 0003 names for fields
discovered after the cut). The test asserts the row survives and the pre-migration backup is
byte-identical to the file before the run.

When a real migration is added after the baseline, nothing here needs regenerating: the tests read
`migration_sources()`, the same list the production `MIGRATIONS` static is built from.

A v0.1 database is a different case: it is never migrated, it is moved aside
(`tests/legacy_database_moved_aside.rs` builds its own hand-written slice of the v0.1 schema).

## The deliberately-bad migration

The "a failing migration restores the file" test does not reuse any committed fixture either. It
takes `core::db::migration_sources()` (the real, full list) and appends one intentionally
malformed migration source (invalid SQL), builds a local `Migrations` from that, and drives it
through the same `open_and_migrate`-shaped restore path the production code exercises on a real
`to_latest` error — proving `restore_from_backup` runs on the real failure edge, not a
hand-simulated one.
