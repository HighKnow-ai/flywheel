//! The Environment Flywheel's hosted side is reached at (issue #786).
//!
//! An Environment is one whole copy of HighKnow's shared platform (`api`, accounts, sign-in).
//! Flywheel's hosted side is that platform, so in each Environment it talks to that Environment's
//! `api` hostname. Production is `api.highknow.ai`. Every other Environment lives on
//! `highknow.dev`, one label deep so one certificate covers it: staging at
//! `staging-api.highknow.dev`, and a temporary Environment named `env-<name>` at
//! `env-<name>-api.highknow.dev`. The scheme is restated here rather than imported, because nothing
//! in this repository may depend on HighKnow's private one.
//!
//! RELEASE BUILDS ARE LOCKED TO PRODUCTION AT COMPILE TIME. Everything that can name or choose a
//! non-production Environment is in [`dev`], which exists only under `debug_assertions`: Cargo's
//! dev profile (`tauri dev`, `cargo test`) has them and its release profile (`tauri build`) does
//! not. A release binary therefore holds no `highknow.dev` string and no way to choose, and
//! [`current`] there is production without reading anything. NOT A STYLE CHOICE: a runtime flag
//! would ship the non-production hostnames and the code that switches to them in every release.
//! `scripts/release/check-release-bundle.mjs` is the check that a release bundle holds neither.
//!
//! Nothing calls [`current`] for a network request yet: the open-source app reaches no hosted
//! service (ARCHITECTURE.md §8). It is the one place a hosted client asks where to go.

use rusqlite::Connection;

/// Production's name.
pub const PRODUCTION: &str = "production";

/// Production's `api` origin, the only origin a release build knows.
pub const PRODUCTION_API_ORIGIN: &str = "https://api.highknow.ai";

/// One Environment: its name (`production`, `staging`, `env-<name>`) and its `api` origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Environment {
    name: String,
    api_origin: String,
}

impl Environment {
    /// `production`, `staging`, or `env-<name>`.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The scheme and host of this Environment's `api`, with no trailing slash.
    pub fn api_origin(&self) -> &str {
        &self.api_origin
    }

    pub fn is_production(&self) -> bool {
        self.name == PRODUCTION
    }
}

/// Production.
pub fn production() -> Environment {
    Environment {
        name: PRODUCTION.to_string(),
        api_origin: PRODUCTION_API_ORIGIN.to_string(),
    }
}

/// The Environment this build talks to: in a development build the one last chosen on this
/// install ([`dev::chosen`]), in a release build production, always.
pub fn current(conn: &Connection) -> anyhow::Result<Environment> {
    #[cfg(debug_assertions)]
    {
        dev::chosen(conn)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = conn;
        Ok(production())
    }
}

/// The development builds' Environment picker: naming a non-production Environment, and the
/// choice persisted per install. Compiled only under `debug_assertions` (see the module comment).
#[cfg(debug_assertions)]
pub mod dev {
    use anyhow::Context;
    use chrono::Utc;
    use rusqlite::Connection;

    use super::{production, Environment, PRODUCTION};
    use crate::domain::settings::{read_setting, upsert_setting};

    /// The `settings` row holding the chosen Environment's name. The fleet database is one per
    /// install, so the choice is too. A release build never reads it, so a row a development
    /// build left behind in the same database cannot move a release off production.
    const SETTING_KEY: &str = "dev_environment";

    /// Staging's name.
    pub const STAGING: &str = "staging";

    /// The prefix every temporary Environment's name carries (HighKnow decision #726 item 6).
    pub const TEMPORARY_PREFIX: &str = "env-";

    /// The non-production zone. Every non-production hostname is one label under it.
    const ZONE: &str = "highknow.dev";

    /// A DNS label is at most 63 characters, and the longest one built here is
    /// `env-<name>-api`, so a temporary name is at most 63 - 4 - 4.
    pub const MAX_TEMPORARY_NAME_LEN: usize = 63 - TEMPORARY_PREFIX.len() - "-api".len();

    /// What the picker offers: production, staging, or a temporary Environment by name.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum Choice {
        Production,
        Staging,
        /// The name as typed, with or without its `env-` prefix.
        Temporary(String),
    }

    /// The Environment `choice` names, or why it names none. A temporary name is trimmed and
    /// lower-cased (DNS ignores case), may be typed with or without `env-`, and must then be
    /// lower-case letters, digits and inner hyphens, starting with a letter, short enough that
    /// `env-<name>-api` is one DNS label.
    pub fn resolve(choice: &Choice) -> Result<Environment, String> {
        match choice {
            Choice::Production => Ok(production()),
            Choice::Staging => Ok(non_production(STAGING.to_string())),
            Choice::Temporary(typed) => {
                let lowered = typed.trim().to_ascii_lowercase();
                let name = lowered.strip_prefix(TEMPORARY_PREFIX).unwrap_or(&lowered);
                validate_temporary_name(name)?;
                Ok(non_production(format!("{TEMPORARY_PREFIX}{name}")))
            }
        }
    }

    fn validate_temporary_name(name: &str) -> Result<(), String> {
        let len = name.chars().count();
        if len == 0 || len > MAX_TEMPORARY_NAME_LEN {
            return Err(format!(
                "a temporary Environment's name must be 1-{MAX_TEMPORARY_NAME_LEN} characters, got {len}"
            ));
        }
        let well_formed = name.starts_with(|c: char| c.is_ascii_lowercase())
            && !name.ends_with('-')
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !well_formed {
            return Err(format!(
                "a temporary Environment's name is lower-case letters, digits and inner hyphens, \
                 starting with a letter; got {name:?}"
            ));
        }
        Ok(())
    }

    /// `<name>-api.highknow.dev`: one label deep, never `api.<name>.highknow.dev`.
    fn non_production(name: String) -> Environment {
        let api_origin = format!("https://{name}-api.{ZONE}");
        Environment { name, api_origin }
    }

    /// The choice an Environment's stored name stands for.
    fn choice_for(name: &str) -> Choice {
        match name {
            PRODUCTION => Choice::Production,
            STAGING => Choice::Staging,
            other => Choice::Temporary(other.to_string()),
        }
    }

    /// The Environment last chosen on this install, or production when none has been. A stored
    /// name that no longer resolves (only a hand edit can write one) reads as production, the
    /// Environment a release build always uses, and is logged rather than failing every caller.
    pub fn chosen(conn: &Connection) -> anyhow::Result<Environment> {
        let Some(stored) = read_setting(conn, SETTING_KEY)? else {
            return Ok(production());
        };
        match resolve(&choice_for(&stored)) {
            Ok(environment) if environment.name() == stored => Ok(environment),
            _ => {
                eprintln!("flywheel: the stored Environment {stored:?} is not one Flywheel names; using production");
                Ok(production())
            }
        }
    }

    /// Persist `choice` for this install and return the Environment it names. Writes one
    /// `settings` row and no event: the choice is the install's, not any project's.
    pub fn choose(
        conn: &mut Connection,
        actor_id: &str,
        choice: &Choice,
    ) -> anyhow::Result<Environment> {
        let environment = resolve(choice).map_err(anyhow::Error::msg)?;
        let now = Utc::now().to_rfc3339();
        let tx = conn.transaction()?;
        upsert_setting(&tx, SETTING_KEY, environment.name(), actor_id, &now)?;
        tx.commit()
            .context("failed to commit the chosen Environment")?;
        Ok(environment)
    }
}
