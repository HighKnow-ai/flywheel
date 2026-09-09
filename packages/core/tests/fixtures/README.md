# Migration-safety fixtures (DATA-08)

`tests/migration_safety.rs` needs a database that sits exactly one schema version behind the
crate's current `MIGRATIONS` list (the "N-1 fixture"). No binary `.db` file is committed to this
repository for that purpose — a committed binary fixture goes stale silently the moment a new
migration is added, and nobody can tell from the diff whether it was regenerated correctly.

Instead, the fixture is **built in code, every test run**, from `core::db::migration_sources()` —
the exact ordered list of migration SQL strings `core::db::MIGRATIONS` itself compiles from (see
`packages/core/src/db/mod.rs`'s `migration_source_list`), not a hand-duplicated copy that could
silently go stale:

1. Call `core::db::migration_sources()` and drop the last entry — the N-1 fixture is "every
   migration except the newest."
2. Build a local `rusqlite_migration::Migrations` from that shortened list and run it against a
   fresh scratch file (a `tempfile::tempdir()`).
3. Insert a handful of known rows through the schema that migration N-1 leaves behind, and record
   their content so the test can assert byte-for-byte survival after the real `open_and_migrate`
   runs migration N against the same file.

## Regenerating this fixture when a new migration is added

There is nothing to regenerate by hand. When `packages/core/src/db/migrations/000X_*.sql` gains a
new file and `migration_source_list` in `packages/core/src/db/mod.rs` is updated to include it,
`tests/migration_safety.rs` automatically treats the *new* latest migration as "N" and everything
before it as "N-1" — the fixture-building code reads `migration_sources()`, which is the same list
the production `MIGRATIONS` static is built from, just truncated by one entry, so it can never
drift out of sync with the real schema.

## The deliberately-bad migration

The "a failing migration restores the file" test does not reuse any committed fixture either. It
takes `core::db::migration_sources()` (the real, full list) and appends one intentionally
malformed migration source (invalid SQL), builds a local `Migrations` from that, and drives it
through the same `open_and_migrate`-shaped restore path the production code exercises on a real
`to_latest` error — proving `restore_from_backup` runs on the real failure edge, not a
hand-simulated one.
