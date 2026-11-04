//! Issue #786: the Environment a development build talks to — each tier's `api` origin, the typed
//! temporary name's rules, and the choice persisted per install. These run under Cargo's dev
//! profile, where `environment::dev` exists; a release build has no such module, and
//! `scripts/release/check-release-bundle.mjs` checks the bundle it produces.

mod common;

use flywheel_core::environment::dev::{choose, chosen, resolve, Choice, MAX_TEMPORARY_NAME_LEN};
use flywheel_core::environment::{current, production, PRODUCTION_API_ORIGIN};
use rusqlite::{params, Connection};

fn temporary(typed: &str) -> Result<(String, String), String> {
    resolve(&Choice::Temporary(typed.to_string()))
        .map(|e| (e.name().to_string(), e.api_origin().to_string()))
}

#[test]
fn each_tier_resolves_to_its_api_origin() {
    let prod = resolve(&Choice::Production).unwrap();
    assert_eq!(prod, production());
    assert_eq!(prod.api_origin(), "https://api.highknow.ai");
    assert_eq!(PRODUCTION_API_ORIGIN, "https://api.highknow.ai");
    assert!(prod.is_production());

    let staging = resolve(&Choice::Staging).unwrap();
    assert_eq!(staging.name(), "staging");
    assert_eq!(staging.api_origin(), "https://staging-api.highknow.dev");
    assert!(!staging.is_production());

    assert_eq!(
        temporary("demo").unwrap(),
        (
            "env-demo".to_string(),
            "https://env-demo-api.highknow.dev".to_string()
        )
    );
}

#[test]
fn a_temporary_name_may_be_typed_with_its_prefix_in_any_case_with_spaces() {
    for typed in ["demo", "env-demo", "  Demo ", "ENV-DEMO"] {
        assert_eq!(temporary(typed).unwrap().0, "env-demo", "{typed:?}");
    }
}

#[test]
fn a_temporary_name_that_is_not_one_dns_label_is_refused() {
    let longest = "a".repeat(MAX_TEMPORARY_NAME_LEN);
    let (_, origin) = temporary(&longest).unwrap();
    let label = origin
        .strip_prefix("https://")
        .and_then(|h| h.strip_suffix(".highknow.dev"))
        .unwrap();
    assert_eq!(
        label.len(),
        63,
        "the longest name fills one DNS label exactly"
    );

    let too_long = "a".repeat(MAX_TEMPORARY_NAME_LEN + 1);
    for typed in [
        "",
        "env-",
        "   ",
        too_long.as_str(),
        "1demo",
        "-demo",
        "demo-",
        "de.mo",
        "de mo",
        "dé",
        "demo.highknow.dev",
        "a/b",
    ] {
        assert!(temporary(typed).is_err(), "{typed:?} must be refused");
    }
}

#[test]
fn with_nothing_chosen_an_install_talks_to_production() {
    let (conn, _actor, _project) = common::seeded_project();
    assert_eq!(chosen(&conn).unwrap(), production());
    assert_eq!(current(&conn).unwrap(), production());
}

#[test]
fn a_choice_persists_and_is_what_current_returns() {
    let (mut conn, actor, _project) = common::seeded_project();
    let staging = choose(&mut conn, &actor, &Choice::Staging).unwrap();
    assert_eq!(staging.api_origin(), "https://staging-api.highknow.dev");
    assert_eq!(current(&conn).unwrap(), staging);

    let demo = choose(&mut conn, &actor, &Choice::Temporary("demo".into())).unwrap();
    assert_eq!(current(&conn).unwrap(), demo);

    choose(&mut conn, &actor, &Choice::Production).unwrap();
    assert_eq!(current(&conn).unwrap(), production());
}

#[test]
fn a_refused_choice_leaves_the_stored_one_alone() {
    let (mut conn, actor, _project) = common::seeded_project();
    choose(&mut conn, &actor, &Choice::Staging).unwrap();
    assert!(choose(&mut conn, &actor, &Choice::Temporary("not ok".into())).is_err());
    assert_eq!(current(&conn).unwrap().name(), "staging");
}

#[test]
fn choosing_writes_one_settings_row_and_no_event() {
    let (mut conn, actor, _project) = common::seeded_project();
    let events = |c: &Connection| {
        c.query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, i64>(0))
            .unwrap()
    };
    let before = events(&conn);
    choose(&mut conn, &actor, &Choice::Staging).unwrap();
    choose(&mut conn, &actor, &Choice::Temporary("demo".into())).unwrap();
    assert_eq!(events(&conn), before);
    let (value, by): (String, String) = conn
        .query_row(
            "SELECT value, updated_by FROM settings WHERE key = 'dev_environment'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((value.as_str(), by.as_str()), ("env-demo", actor.as_str()));
}

#[test]
fn a_stored_name_that_no_longer_resolves_reads_as_production() {
    let (conn, actor, _project) = common::seeded_project();
    for garbage in ["", "Staging", "env-", "env-not ok", "api.example.com"] {
        conn.execute(
            "INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('dev_environment', ?1, ?2, 'now')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![garbage, actor],
        )
        .unwrap();
        assert_eq!(current(&conn).unwrap(), production(), "{garbage:?}");
    }
}
