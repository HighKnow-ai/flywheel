//! The credential boundary (D-39, AGNT-04, AGNT-03). This module is the ONE place in the product
//! that reads credential material — anything needing a credential calls [`resolve_credential`]
//! rather than reading the macOS Keychain (via the `keyring` crate) or the `settings` table
//! itself. The sidecar receives an already-resolved environment from the Rust core and never
//! reads Settings or the Keychain on its own (T-02-01, T-02-03 in `02-09-PLAN.md`'s threat model).
//!
//! Never shells out to a keychain command-line tool (`security add-generic-password` /
//! `security find-generic-password`): credential material passed as a command argument would
//! appear in a process listing, exactly the disclosure this module exists to prevent. The
//! `keyring` crate (native Rust bindings over Keychain Services) is the only access path.
//!
//! The only function that reads the stored secret back out is [`resolve_credential`], and it
//! returns the value only inside an [`ResolvedCredential::env`] map bound for one spawn — never as
//! a bare string a caller could log or print.

use std::collections::HashMap;

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::Connection;

use crate::domain::settings::{delete_setting, read_setting, upsert_setting};

/// Fixed Keychain service/account names (D-39) — declared once, never derived, never
/// per-project. The API key is a single, global secret; a per-project override only changes
/// which MODE a given project resolves to, never which key value is stored.
pub const KEYCHAIN_SERVICE: &str = "com.highknow.flywheel";
pub const KEYCHAIN_ACCOUNT: &str = "anthropic-api-key";

/// The `settings` row key `api_key_configured_at` is stored under — the date the key was last
/// stored, read from the database (never from the Keychain itself, which holds no timestamp).
const SETTING_API_KEY_CONFIGURED_AT: &str = "api_key_configured_at";

/// The environment variable name the API-key path sets on the spawned child (D-39, AGNT-04).
/// Named once, here, so no other module (the sidecar included — see `02-09-PLAN.md` Task 2's
/// structural gate) needs its own copy of this string.
pub const ANTHROPIC_API_KEY_ENV_VAR: &str = "ANTHROPIC_API_KEY";

/// D-39's two credential modes. Mirrors `projects.credential_mode`'s CHECK constraint and
/// `settings.global_credential_mode`'s stored value exactly — [`CredentialMode::as_str`] /
/// [`CredentialMode::parse`] are the only conversion points, so this enum and the stored string
/// can never independently drift.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialMode {
    /// The developer's own already-authenticated `claude login` session — Flywheel never reads,
    /// replays or stores that OAuth token itself (AGNT-03).
    Local,
    /// An explicit API key held in the macOS Keychain.
    ApiKey,
}

impl CredentialMode {
    pub fn as_str(self) -> &'static str {
        match self {
            CredentialMode::Local => "local",
            CredentialMode::ApiKey => "api_key",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        match value {
            "local" => Ok(CredentialMode::Local),
            "api_key" => Ok(CredentialMode::ApiKey),
            other => Err(anyhow!("unrecognised credential mode {other:?}")),
        }
    }
}

/// What [`resolve_credential`] hands the caller — never a bare secret. `env` is empty for
/// [`CredentialMode::Local`] (the child inherits the developer's own environment, where `claude`
/// resolves its own stored session exactly as it would in a terminal) and carries exactly one
/// entry (`ANTHROPIC_API_KEY_ENV_VAR`) for [`CredentialMode::ApiKey`].
pub struct ResolvedCredential {
    pub mode: CredentialMode,
    pub env: HashMap<String, String>,
}

/// A hand-written `Debug` impl — deriving one would print `env`'s values verbatim, which for
/// [`CredentialMode::ApiKey`] is the secret itself. Redacting here means an accidental `{:?}`,
/// `dbg!`, or a test's own `.expect()`/`.unwrap()` panic message can never leak the key value,
/// closing off a disclosure path `derive(Debug)` would otherwise leave open by construction.
impl std::fmt::Debug for ResolvedCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedCredential")
            .field("mode", &self.mode)
            .field("env_keys", &self.env.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// Build the fixed Keychain entry this module always reads/writes. The ONLY place in this crate
/// that constructs a `keyring::Entry` for the API key.
fn keychain_entry() -> anyhow::Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .context("failed to initialise the macOS Keychain entry for the Anthropic API key")
}

/// Store `value` in the macOS Keychain (never in the database) and record the configured-at date
/// as a `settings` row. The database never sees the key itself — only the write timestamp.
pub fn store_api_key(conn: &mut Connection, actor_id: &str, value: &str) -> anyhow::Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("API key must not be empty"));
    }

    let entry = keychain_entry()?;
    entry
        .set_password(value)
        .context("failed to store the API key in the macOS Keychain")?;

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    upsert_setting(&tx, SETTING_API_KEY_CONFIGURED_AT, &now, actor_id, &now)?;
    tx.commit()
        .context("failed to commit store_api_key transaction")?;
    Ok(())
}

/// Remove the Keychain entry and clear the stored configured-at date. Idempotent: clearing an
/// already-absent key is not an error. Takes no `actor_id` — unlike `domain::settings`'s
/// credential-mode writes, this module's own storage-surface writes (`store_api_key`,
/// `clear_api_key`) never append an `events` row (the secret's presence/absence is Settings-
/// surface state, not activity-trail content — this module's own doc comment); `store_api_key`
/// accepts `actor_id` only to stamp `settings.updated_by` on the configured-at row it writes,
/// which `clear_api_key` deletes outright rather than updating, so it has no such column to stamp.
pub fn clear_api_key(conn: &mut Connection) -> anyhow::Result<()> {
    let entry = keychain_entry()?;
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {} // already absent — clearing is idempotent
        Err(err) => {
            return Err(anyhow::Error::new(err)
                .context("failed to delete the API key from the macOS Keychain"))
        }
    }

    let tx = conn.transaction()?;
    delete_setting(&tx, SETTING_API_KEY_CONFIGURED_AT)?;
    tx.commit()
        .context("failed to commit clear_api_key transaction")?;
    Ok(())
}

/// Whether a key is currently stored — never returns the value itself, only presence.
pub fn has_api_key() -> anyhow::Result<bool> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(anyhow::Error::new(err)
            .context("failed to query the macOS Keychain for the API key")),
    }
}

/// The date the key was stored, read from a database setting (never from the Keychain, which
/// holds no timestamp of its own).
pub fn api_key_configured_at(conn: &Connection) -> anyhow::Result<Option<String>> {
    read_setting(conn, SETTING_API_KEY_CONFIGURED_AT)
}

/// Resolve which credential a run in `project_id` should use, and the environment additions the
/// spawn should carry (D-39). Called ONCE per spawn, immediately before the spawn request is
/// built — never cached (T-02-41 in `02-09-PLAN.md`'s threat model): a cached credential would
/// outlive the setting that produced it, breaking the per-project override the moment a user
/// changes it mid-session.
///
/// For [`CredentialMode::ApiKey`] with no key stored, this returns a typed error naming the
/// missing environment variable rather than silently falling back to [`CredentialMode::Local`] —
/// T-02-42: silently billing the wrong account is exactly the failure D-39's per-project override
/// exists to prevent.
pub fn resolve_credential(conn: &Connection, project_id: &str) -> anyhow::Result<ResolvedCredential> {
    let override_mode = crate::domain::settings::project_credential_mode(conn, project_id)?;
    let mode_str = match override_mode {
        Some(m) => m,
        None => crate::domain::settings::global_credential_mode(conn)?,
    };
    let mode = CredentialMode::parse(&mode_str)?;

    match mode {
        CredentialMode::Local => Ok(ResolvedCredential {
            mode,
            env: HashMap::new(),
        }),
        CredentialMode::ApiKey => {
            let entry = keychain_entry()?;
            let value = entry.get_password().map_err(|err| match err {
                keyring::Error::NoEntry => anyhow!(
                    "credential mode is api_key but no {ANTHROPIC_API_KEY_ENV_VAR} is stored in \
                     the macOS Keychain — configure one in Settings"
                ),
                other => anyhow::Error::new(other)
                    .context("failed to read the API key from the macOS Keychain"),
            })?;
            let mut env = HashMap::new();
            env.insert(ANTHROPIC_API_KEY_ENV_VAR.to_string(), value);
            Ok(ResolvedCredential { mode, env })
        }
    }
}
