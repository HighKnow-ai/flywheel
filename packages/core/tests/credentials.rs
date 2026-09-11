//! D-39/AGNT-04's credential boundary: the Keychain-backed API-key store, the two-level
//! (global/per-project) credential-mode setting, and `resolve_credential`'s single read point.
//! See `packages/sidecar/test/credentials.test.mjs` for the sidecar-side parity/argv-shape half.
//!
//! **Keychain safety.** `store_api_key`/`clear_api_key`/`resolve_credential`'s API-key mode all
//! operate on the SAME fixed Keychain entry (`credentials::KEYCHAIN_SERVICE`/`KEYCHAIN_ACCOUNT`)
//! the real, shipped product uses — there is no test-only service/account to redirect to, since
//! the plan's own functions hardcode these constants (D-39: one auditable place). To avoid ever
//! destroying a developer's own real, already-configured API key by running `cargo test` on their
//! machine, every Keychain-touching test in this file:
//!   1. First probes whether the Keychain is accessible at all (the plan's own precondition:
//!      `security list-keychains` returns at least the login keychain) — if not, the test prints
//!      an explicit skip reason and returns, never failing on an environment fact it cannot
//!      control (a headless CI runner with no keychain, for instance).
//!   2. Captures whatever value is ALREADY stored under the real entry (if any) before mutating
//!      it, and restores that exact value (or clears the entry if none existed) via a `Drop` guard
//!      that runs regardless of the test's own outcome — "no key configured" on this machine
//!      before the test ran is exactly the state it is restored to afterward.

mod common;

use core::credentials::{
    self, ANTHROPIC_API_KEY_ENV_VAR, CredentialMode, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE,
};
use core::domain::settings;
use rusqlite::{params, Connection};

const TEST_API_KEY_VALUE: &str = "sk-ant-test-fixture-0001";

/// The one Keychain entry every function under test in this file reads/writes — constructed the
/// same way `credentials.rs`'s own private `keychain_entry()` does, but from the test side, so
/// this file can inspect/restore state without a second copy of the service/account strings.
fn real_entry() -> keyring::Entry {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .expect("failed to construct the keychain entry under test")
}

/// Whether the macOS Keychain is reachable from this process at all, checked via a throwaway
/// entry under a DIFFERENT service name (never the real one) so the probe itself can never
/// disturb anything a real test below cares about.
fn keychain_accessible() -> bool {
    let probe = keyring::Entry::new("com.highknow.flywheel.credentials-test-probe", "probe");
    let Ok(probe) = probe else { return false };
    let ok = probe.set_password("probe-value").is_ok() && probe.get_password().is_ok();
    let _ = probe.delete_credential();
    ok
}

/// Serializes every Keychain-touching test in THIS binary. All of them read/write the SAME real
/// Keychain entry (`KEYCHAIN_SERVICE`/`KEYCHAIN_ACCOUNT`) — `cargo test` runs a binary's `#[test]`
/// fns concurrently by default, and two threads racing to set/get/delete the identical macOS
/// Keychain item concurrently is what produced an observed hang during this plan's own
/// implementation (multiple tests each waiting past 60s with no test ever completing). Each
/// `tests/*.rs` file compiles to its own binary, so this cannot race with any other test file's
/// own static (mirrors `permission_gate.rs`'s/`stop_lifecycle.rs`'s identical pattern for their
/// own process-global mutable state).
static KEYCHAIN_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Acquire [`KEYCHAIN_TEST_LOCK`] for the rest of the calling test, then skip (print a reason,
/// return) rather than fail when the Keychain is not accessible in this test environment — the
/// plan's own precondition. Every Keychain-touching test calls this first, and holds the lock for
/// its entire body (the `let` binding lives until the test function returns).
macro_rules! skip_unless_keychain_accessible {
    () => {
        let _keychain_lock = KEYCHAIN_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !keychain_accessible() {
            println!(
                "SKIPPED: {} — the macOS Keychain is not accessible in this test environment \
                 (`security list-keychains` did not resolve a usable store); the API-key half of \
                 this suite is skipped, not failed, per the plan's own precondition.",
                module_path!()
            );
            return;
        }
    };
}

/// Captures whatever value is already stored under the real, shipped Keychain entry before a
/// test mutates it, and restores that exact value (or clears the entry if none existed) on drop —
/// see this file's own top-of-file doc comment for why this exists.
struct KeychainRestoreGuard {
    previous: Option<String>,
}

impl KeychainRestoreGuard {
    fn capture() -> Self {
        let previous = real_entry().get_password().ok();
        Self { previous }
    }
}

impl Drop for KeychainRestoreGuard {
    fn drop(&mut self) {
        let entry = real_entry();
        match &self.previous {
            Some(value) => {
                let _ = entry.set_password(value);
            }
            None => {
                let _ = entry.delete_credential();
            }
        }
    }
}

fn setting_row_count_like(conn: &Connection, pattern: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM settings WHERE value LIKE ?1",
        params![pattern],
        |row| row.get(0),
    )
    .expect("failed to count settings rows")
}

fn event_payload(conn: &Connection, event_type: &str, stream_id: &str) -> String {
    conn.query_row(
        "SELECT payload FROM events WHERE event_type = ?1 AND stream_id = ?2 ORDER BY id DESC LIMIT 1",
        params![event_type, stream_id],
        |row| row.get(0),
    )
    .expect("expected an event row for this event_type/stream_id")
}

fn event_count(conn: &Connection, event_type: &str, stream_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = ?1 AND stream_id = ?2",
        params![event_type, stream_id],
        |row| row.get(0),
    )
    .expect("failed to count events")
}

// ---------------------------------------------------------------------------------------------
// CredentialMode
// ---------------------------------------------------------------------------------------------

#[test]
fn credential_mode_as_str_and_parse_round_trip_for_both_modes() {
    assert_eq!(CredentialMode::Local.as_str(), "local");
    assert_eq!(CredentialMode::ApiKey.as_str(), "api_key");
    assert!(matches!(CredentialMode::parse("local"), Ok(CredentialMode::Local)));
    assert!(matches!(CredentialMode::parse("api_key"), Ok(CredentialMode::ApiKey)));
    assert!(CredentialMode::parse("bogus").is_err());
}

// ---------------------------------------------------------------------------------------------
// Keychain storage surface (store_api_key / has_api_key / api_key_configured_at / clear_api_key)
// ---------------------------------------------------------------------------------------------

#[test]
fn store_api_key_never_writes_the_secret_to_the_database() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, _project) = common::seeded_project();

    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE)
        .expect("store_api_key should succeed");

    assert_eq!(
        setting_row_count_like(&conn, "sk-%"),
        0,
        "no settings row should ever hold a value shaped like the stored key"
    );
    // The real Keychain entry, not the database, holds the value.
    assert_eq!(real_entry().get_password().unwrap(), TEST_API_KEY_VALUE);
}

#[test]
fn has_api_key_reports_presence_without_returning_the_value() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, _project) = common::seeded_project();

    credentials::clear_api_key(&mut conn).expect("clear_api_key should succeed on an empty entry");
    assert!(!credentials::has_api_key().unwrap());

    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE)
        .expect("store_api_key should succeed");
    assert!(credentials::has_api_key().unwrap());
}

#[test]
fn api_key_configured_at_is_read_from_a_database_setting_not_the_keychain() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, _project) = common::seeded_project();

    assert_eq!(credentials::api_key_configured_at(&conn).unwrap(), None);

    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE)
        .expect("store_api_key should succeed");

    let configured_at = credentials::api_key_configured_at(&conn)
        .unwrap()
        .expect("configured_at should be Some after storing a key");
    // Read straight off the settings table too, proving it is a real database row, not a
    // recomputed/derived value from the Keychain call itself.
    let db_value: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'api_key_configured_at'",
            [],
            |row| row.get(0),
        )
        .expect("expected an api_key_configured_at settings row");
    assert_eq!(configured_at, db_value);
}

#[test]
fn clear_api_key_removes_the_keychain_entry_and_the_configured_at_date() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, _project) = common::seeded_project();

    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE)
        .expect("store_api_key should succeed");
    assert!(credentials::has_api_key().unwrap());

    credentials::clear_api_key(&mut conn).expect("clear_api_key should succeed");

    assert!(!credentials::has_api_key().unwrap());
    assert_eq!(credentials::api_key_configured_at(&conn).unwrap(), None);
}

#[test]
fn clear_api_key_on_an_already_absent_key_is_a_no_op_not_an_error() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, _actor_id, _project) = common::seeded_project();

    // Ensure absent first, then clear again — idempotent, never errors.
    credentials::clear_api_key(&mut conn).expect("first clear should succeed");
    credentials::clear_api_key(&mut conn).expect("clearing an already-absent key should be a no-op, not an error");
}

// ---------------------------------------------------------------------------------------------
// Global default / per-project override (domain::settings)
// ---------------------------------------------------------------------------------------------

#[test]
fn global_credential_mode_defaults_to_local_when_no_setting_row_exists() {
    let (conn, _actor_id, _project) = common::seeded_project();
    assert_eq!(settings::global_credential_mode(&conn).unwrap(), "local");
}

#[test]
fn set_global_credential_mode_persists_and_is_read_back() {
    let (mut conn, actor_id, _project) = common::seeded_project();
    settings::set_global_credential_mode(&mut conn, &actor_id, "api_key")
        .expect("set_global_credential_mode should succeed");
    assert_eq!(settings::global_credential_mode(&conn).unwrap(), "api_key");
}

#[test]
fn set_global_credential_mode_rejects_an_unrecognised_value() {
    let (mut conn, actor_id, _project) = common::seeded_project();
    let err = settings::set_global_credential_mode(&mut conn, &actor_id, "bogus")
        .expect_err("an unrecognised mode should be rejected");
    assert!(err.to_string().contains("bogus"));
}

#[test]
fn project_credential_mode_is_none_without_an_override() {
    let (conn, _actor_id, project) = common::seeded_project();
    assert_eq!(settings::project_credential_mode(&conn, &project.id).unwrap(), None);
}

#[test]
fn setting_a_project_override_different_from_the_global_default_persists_it_and_appends_an_event() {
    let (mut conn, actor_id, project) = common::seeded_project();
    // Global default stays "local" (the fresh-install default) — the override diverges from it.
    settings::set_project_credential_mode(&mut conn, &actor_id, &project.id, Some("api_key"))
        .expect("set_project_credential_mode should succeed");

    assert_eq!(
        settings::project_credential_mode(&conn, &project.id).unwrap(),
        Some("api_key".to_string())
    );
    assert_eq!(event_count(&conn, "project.credential_mode_set", &project.id), 1);

    let payload = event_payload(&conn, "project.credential_mode_set", &project.id);
    assert!(payload.contains("api_key"), "payload should name the mode: {payload}");
    assert!(
        !payload.to_lowercase().contains("sk-ant"),
        "payload must never carry a key-shaped value: {payload}"
    );
}

#[test]
fn setting_a_project_override_equal_to_the_global_default_clears_it_instead_of_storing_a_redundant_row() {
    let (mut conn, actor_id, project) = common::seeded_project();
    // Global default is "local" — setting the SAME value as a project override must clear
    // (leave NULL), not persist a redundant explicit "local" row.
    settings::set_project_credential_mode(&mut conn, &actor_id, &project.id, Some("local"))
        .expect("set_project_credential_mode should succeed");

    assert_eq!(settings::project_credential_mode(&conn, &project.id).unwrap(), None);

    let credential_mode: Option<String> = conn
        .query_row(
            "SELECT credential_mode FROM projects WHERE id = ?1",
            params![project.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(credential_mode, None, "the column itself must be NULL, not the string \"local\"");
}

#[test]
fn clearing_a_project_override_appends_an_event_naming_the_project() {
    let (mut conn, actor_id, project) = common::seeded_project();
    settings::set_project_credential_mode(&mut conn, &actor_id, &project.id, Some("api_key"))
        .expect("setting the override should succeed");
    settings::set_project_credential_mode(&mut conn, &actor_id, &project.id, None)
        .expect("clearing the override should succeed");

    assert_eq!(settings::project_credential_mode(&conn, &project.id).unwrap(), None);
    assert_eq!(event_count(&conn, "project.credential_mode_cleared", &project.id), 1);

    let payload = event_payload(&conn, "project.credential_mode_cleared", &project.id);
    assert!(
        payload.contains(&project.name),
        "the cleared-override event's label should name the project: {payload}"
    );
}

#[test]
fn an_out_of_set_projects_credential_mode_value_is_rejected_by_the_schema_not_application_code() {
    let (conn, _actor_id, project) = common::seeded_project();
    let result = conn.execute(
        "UPDATE projects SET credential_mode = 'bogus' WHERE id = ?1",
        params![project.id],
    );
    assert!(
        result.is_err(),
        "the CHECK constraint on projects.credential_mode should reject an out-of-set value"
    );
}

// ---------------------------------------------------------------------------------------------
// resolve_credential — the single read point
// ---------------------------------------------------------------------------------------------

#[test]
fn resolve_credential_in_local_mode_returns_an_empty_environment() {
    let (conn, _actor_id, project) = common::seeded_project();
    let resolved = credentials::resolve_credential(&conn, &project.id).expect("resolve_credential should succeed");
    assert!(matches!(resolved.mode, CredentialMode::Local));
    assert!(resolved.env.is_empty());
}

#[test]
fn resolve_credential_falls_back_to_the_global_default_without_a_project_override() {
    // This test READS the real Keychain — `resolve_credential` in api_key mode does — so it needs
    // the same two protections every other Keychain-touching test in this file already takes, and
    // was the one place they were missed. It looks like a pure database test and is not one.
    //
    // Without them it asserted an unstated precondition about the DEVELOPER'S MACHINE: "no key is
    // stored". That held until a human stored a key through the product's own Settings surface
    // (Phase 02 UAT test 5, 2026-09-11T10:24:01Z), after which `cargo test` failed 3/3 on a
    // machine whose code was correct. A suite that breaks because someone used the product is
    // reporting on the environment, not the code.
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    // ESTABLISH the precondition rather than assuming it. The guard above restores whatever was
    // here — including a real operator key — when this test returns, whatever its outcome.
    let _ = real_entry().delete_credential();

    let (mut conn, actor_id, project) = common::seeded_project();
    settings::set_global_credential_mode(&mut conn, &actor_id, "api_key").unwrap();
    // No project override set — the resolver must fall back to the global default, which is now
    // "api_key". No key is stored, so this must error (never silently fall back to local).
    let err = credentials::resolve_credential(&conn, &project.id)
        .expect_err("api_key mode with no key stored must error, not silently resolve local");
    assert!(err.to_string().contains(ANTHROPIC_API_KEY_ENV_VAR));
}

#[test]
fn resolve_credential_in_api_key_mode_with_a_key_stored_returns_exactly_one_env_entry() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, project) = common::seeded_project();

    settings::set_global_credential_mode(&mut conn, &actor_id, "api_key").unwrap();
    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE).unwrap();

    let resolved = credentials::resolve_credential(&conn, &project.id).expect("resolve_credential should succeed");
    assert!(matches!(resolved.mode, CredentialMode::ApiKey));
    assert_eq!(resolved.env.len(), 1);
    assert_eq!(
        resolved.env.get(ANTHROPIC_API_KEY_ENV_VAR).map(String::as_str),
        Some(TEST_API_KEY_VALUE)
    );
}

#[test]
fn resolve_credential_in_api_key_mode_with_no_key_stored_names_the_missing_key_rather_than_falling_back() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, project) = common::seeded_project();

    credentials::clear_api_key(&mut conn).unwrap();
    settings::set_global_credential_mode(&mut conn, &actor_id, "api_key").unwrap();

    let err = credentials::resolve_credential(&conn, &project.id)
        .expect_err("resolve_credential must error, not silently fall back to local credentials");
    assert!(
        err.to_string().contains(ANTHROPIC_API_KEY_ENV_VAR),
        "the error must name the missing key: {err}"
    );
}

#[test]
fn a_project_override_takes_precedence_over_the_global_default() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, project) = common::seeded_project();

    // Global stays "local"; the project overrides to "api_key".
    settings::set_project_credential_mode(&mut conn, &actor_id, &project.id, Some("api_key")).unwrap();
    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE).unwrap();

    let resolved = credentials::resolve_credential(&conn, &project.id).expect("resolve_credential should succeed");
    assert!(matches!(resolved.mode, CredentialMode::ApiKey));
    assert_eq!(resolved.env.get(ANTHROPIC_API_KEY_ENV_VAR).map(String::as_str), Some(TEST_API_KEY_VALUE));
}

#[test]
fn changing_the_projects_mode_between_two_resolutions_yields_two_different_environments() {
    skip_unless_keychain_accessible!();
    let _guard = KeychainRestoreGuard::capture();
    let (mut conn, actor_id, project) = common::seeded_project();
    credentials::store_api_key(&mut conn, &actor_id, TEST_API_KEY_VALUE).unwrap();

    let first = credentials::resolve_credential(&conn, &project.id).expect("first resolve should succeed");
    assert!(first.env.is_empty(), "starts on the local default");

    settings::set_project_credential_mode(&mut conn, &actor_id, &project.id, Some("api_key")).unwrap();
    let second = credentials::resolve_credential(&conn, &project.id).expect("second resolve should succeed");
    assert_eq!(second.env.len(), 1, "switches to exactly one env entry after the override");

    assert_ne!(
        first.env.is_empty(),
        second.env.is_empty(),
        "resolve_credential must not have cached the first resolution — the two calls must disagree \
         once the setting between them changed"
    );
}
