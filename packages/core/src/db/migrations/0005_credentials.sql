-- The credential boundary (D-39, AGNT-04): a global default credential path plus a per-project
-- override, and the application's first Settings surface (plan 02-09, recorded in 02-CONTEXT.md).
--
-- Owner decisions closing this schema's shape (plan 02-09 Task 1):
--   1. D-39: the choice between local Claude Code credentials and an explicit API key lives here,
--      as the *choice* — the secret itself (the API key value) is NEVER a column in this database
--      and never will be. It lives in the macOS Keychain, read by exactly one function in the
--      product (`credentials::resolve_credential`). This migration adds no column, table or index
--      capable of holding the key value; `api_key_configured_at` below stores only the date the
--      key was last stored, never the key itself.
--   2. `settings` is deliberately key/value, not a typed table with one column per setting — this
--      phase has exactly two settings (`global_credential_mode`, `api_key_configured_at`), and a
--      typed table for two rows would be speculative structure. `updated_by`/`updated_at` make
--      each row its own audit record for the GLOBAL scope, since a global setting has no natural
--      project to append a project-scoped `events` row against (`events.project_id` is NOT NULL —
--      migration `0002_board_schema.sql`). The PER-PROJECT override below (`projects.
--      credential_mode`) DOES have a natural project stream, so `domain::settings::
--      set_project_credential_mode` appends a real `events` row there; the global half does not,
--      by construction of this schema, not by omission.
--   3. `projects.credential_mode` is nullable, where NULL means "use the global default" — matching
--      this codebase's established "the schema, not app code, is the authority" idiom (`0002`'s
--      five-state workflow CHECK, `0003`'s `agent_runs.status` CHECK, `0004`'s permission-status
--      CHECK). An out-of-set value is rejected by SQLite itself via the CHECK constraint below, not
--      by a Rust-side guard a caller could bypass.

-- The product's first persisted settings (global scope only — see decision 2 above).
CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_by TEXT NOT NULL REFERENCES actors(id),
    updated_at TEXT NOT NULL
);

-- The per-project credential override (D-39). NULL means "use the global default" — the resolver
-- (`credentials::resolve_credential`) reads this first and falls back to `settings
-- .global_credential_mode` only when it is NULL. The secret itself is never a column here and
-- never will be: this column holds the CHOICE, the Keychain holds the VALUE.
ALTER TABLE projects ADD COLUMN credential_mode TEXT
    CHECK (credential_mode IS NULL OR credential_mode IN ('local', 'api_key'));
