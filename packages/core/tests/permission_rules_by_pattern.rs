//! Story #47 (docs/mvp-spec.md §4.1, ADR 0001): permission rules are keyed by (project, tool,
//! pattern) in Claude Code's syntax, a matching rule allows a call only in its own project, the
//! backend refuses a rule that could match a Gated action, a Gated action is never approved by a
//! rule, and there is no session scope.

mod common;

use flywheel_core::domain::permission_rule::{check_rule, matching_rule, upsert_rule, GatedRuleRefused};
use flywheel_core::domain::project;
use flywheel_core::permission_pattern::{covers_gated_action, format_rule, matches, parse_rule, suggested_pattern};
use serde_json::json;

fn bash(command: &str) -> serde_json::Value {
    json!({ "command": command })
}

// --- Syntax ----------------------------------------------------------------------------------

#[test]
fn a_rule_reads_and_writes_in_claude_codes_syntax() {
    assert_eq!(parse_rule("Bash(npm test:*)").unwrap(), ("Bash".into(), "npm test:*".into()));
    assert_eq!(parse_rule("WebFetch").unwrap(), ("WebFetch".into(), "*".into()));
    assert_eq!(parse_rule(" Bash( cargo build ) ").unwrap(), ("Bash".into(), "cargo build".into()));
    assert!(parse_rule("Bash(npm test:*").is_err(), "an unclosed rule is refused");
    assert!(parse_rule("(npm test)").is_err(), "a rule must name a tool");
    assert_eq!(format_rule("Bash", "npm test:*"), "Bash(npm test:*)");
    assert_eq!(format_rule("WebFetch", "*"), "WebFetch");
}

#[test]
fn a_prefix_pattern_matches_the_command_and_its_extensions_on_a_word_boundary() {
    assert!(matches("Bash", "npm test:*", &bash("npm test")));
    assert!(matches("Bash", "npm test:*", &bash("npm test -- --watch")));
    assert!(matches("Bash", "npm test:*", &bash("npm   test  --watch")));
    assert!(!matches("Bash", "npm test:*", &bash("npm tester")));
    assert!(!matches("Bash", "npm test:*", &bash("npm run build")));
}

#[test]
fn an_exact_pattern_matches_only_that_command() {
    assert!(matches("Bash", "cargo build", &bash("cargo build")));
    assert!(!matches("Bash", "cargo build", &bash("cargo build --release")));
}

#[test]
fn a_pattern_never_stretches_over_a_chained_or_substituted_command() {
    for command in [
        "npm test && git push",
        "npm test; git push",
        "npm test | sh",
        "npm test $(git push)",
        "npm test `git push`",
        "npm test\ngit push",
    ] {
        assert!(!matches("Bash", "npm test:*", &bash(command)), "{command:?} must not match");
    }
}

#[test]
fn the_suggested_pattern_is_the_exact_command() {
    assert_eq!(suggested_pattern("Bash", &bash("npm  test")), "npm test");
    assert_eq!(suggested_pattern("Bash", &bash("npm test && ls")), "*");
    assert_eq!(suggested_pattern("WebFetch", &json!({ "url": "https://x" })), "*");
}

// --- Which patterns could cover a Gated action -----------------------------------------------

#[test]
fn patterns_that_could_match_a_gated_action_are_recognised() {
    for pattern in [
        "*",
        ":*",
        "git:*",
        "git push:*",
        "git push --force",
        "git reset:*",
        "git reset --hard",
        "git clean:*",
        "git branch:*",
        "git rebase:*",
        "git filter-branch:*",
        "rm:*",
        "rm -rf:*",
        "rm -rf build",
        "/usr/bin/git push:*",
        "FOO=1 git:*",
        "bash:*",
        "sh -c:*",
        "xargs:*",
        "sudo:*",
        "env:*",
        "env FOO=1 git:*",
        "timeout 60 git push:*",
        "timeout -s KILL 60 git push --force",
        "nice -n 5 rm -rf:*",
        "nohup git:*",
        "time git reset --hard",
        "timeout 60:*",
        "echo 'unclosed:*",
    ] {
        assert!(covers_gated_action("Bash", pattern, Some("main")), "{pattern:?} must be refused");
    }
}

#[test]
fn ordinary_patterns_do_not_cover_a_gated_action() {
    for pattern in [
        "npm test:*",
        "cargo test:*",
        "cargo build",
        "git status",
        "git log:*",
        "ls:*",
        "rm notes.txt",
        "npx vitest:*",
        "node scripts/x.mjs:*",
        "python -m pytest:*",
        "timeout 60 cargo test:*",
        "time cargo build",
        "nice -n 10 npm test:*",
        "env",
    ] {
        assert!(!covers_gated_action("Bash", pattern, Some("main")), "{pattern:?} must be allowed");
    }
    assert!(!covers_gated_action("WebFetch", "*", Some("main")), "only shell calls can be Gated");
}

// --- Stored rules ----------------------------------------------------------------------------

#[test]
fn a_stored_rule_allows_a_matching_call_in_its_project_and_not_in_another() {
    let (mut conn, actor_id, project_a) = common::seeded_project();
    let project_b = project::create_project(&mut conn, &actor_id, "Other", "/other", "OTH", "main").unwrap();

    let rule = upsert_rule(&mut conn, &project_a.id, "Bash", "npm test:*", &actor_id).unwrap();
    assert_eq!((rule.tool.as_str(), rule.pattern.as_str()), ("Bash", "npm test:*"));

    let hit = matching_rule(&conn, &project_a.id, "Bash", &bash("npm test -- --watch")).unwrap();
    assert_eq!(hit.map(|r| r.id), Some(rule.id.clone()), "the rule allows a matching call in its project");

    assert!(matching_rule(&conn, &project_b.id, "Bash", &bash("npm test")).unwrap().is_none(), "never another project");
    assert!(matching_rule(&conn, &project_a.id, "Bash", &bash("npm run build")).unwrap().is_none(), "never another command");
    assert!(matching_rule(&conn, &project_a.id, "Read", &bash("npm test")).unwrap().is_none(), "never another tool");
}

#[test]
fn a_whole_tool_rule_on_a_non_shell_tool_allows_every_call_of_that_tool() {
    let (mut conn, actor_id, project) = common::seeded_project();
    upsert_rule(&mut conn, &project.id, "WebFetch", "*", &actor_id).unwrap();
    let hit = matching_rule(&conn, &project.id, "WebFetch", &json!({ "url": "https://example.com" })).unwrap();
    assert!(hit.is_some());
}

#[test]
fn the_backend_refuses_to_store_a_rule_that_could_match_a_gated_action() {
    let (mut conn, actor_id, project) = common::seeded_project();
    for pattern in ["*", "git push:*", "git:*", "rm -rf:*", "bash -c:*", "sh:*", "xargs:*", "timeout 60 git push:*"] {
        let err = upsert_rule(&mut conn, &project.id, "Bash", pattern, &actor_id)
            .expect_err("a rule covering a Gated action must be refused");
        assert!(err.downcast_ref::<GatedRuleRefused>().is_some(), "{pattern:?}: {err}");
        assert!(check_rule(&conn, &project.id, "Bash", pattern).is_err());
    }
    let rows: i64 = conn.query_row("SELECT COUNT(*) FROM permission_rules", [], |r| r.get(0)).unwrap();
    assert_eq!(rows, 0, "a refused rule writes nothing");
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM events WHERE event_type = 'permission_rule.granted'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(events, 0, "a refused rule appends no event");
}

#[test]
fn the_backend_stores_rules_on_interpreters_and_prefix_wrappers() {
    let (mut conn, actor_id, project) = common::seeded_project();
    for pattern in ["npx vitest:*", "node scripts/x.mjs:*", "python -m pytest:*", "timeout 60 cargo test:*"] {
        upsert_rule(&mut conn, &project.id, "Bash", pattern, &actor_id)
            .unwrap_or_else(|e| panic!("{pattern:?} must be stored: {e}"));
    }
    assert!(matching_rule(&conn, &project.id, "Bash", &bash("timeout 60 cargo test -p core")).unwrap().is_some());
    assert!(
        matching_rule(&conn, &project.id, "Bash", &bash("timeout 60 git push")).unwrap().is_none(),
        "a wrapped Gated action is still asked"
    );
}

#[test]
fn a_gated_action_is_never_approved_even_when_a_broad_rule_exists() {
    let (mut conn, actor_id, project) = common::seeded_project();
    // The backend refuses these rules, so plant them the way a stale or hand-edited database could.
    for pattern in ["*", "git:*", "rm:*"] {
        conn.execute(
            "INSERT INTO permission_rules (id, project_id, tool, pattern, created_by, created_at) \
             VALUES (?1, ?2, 'Bash', ?3, ?4, '2026-01-01T00:00:00Z')",
            rusqlite::params![flywheel_core::ids::new_id(), project.id, pattern, actor_id],
        )
        .unwrap();
    }
    for command in ["git push --force", "git reset --hard", "rm -rf /tmp/x", "npm test && git push --force"] {
        assert!(
            matching_rule(&conn, &project.id, "Bash", &bash(command)).unwrap().is_none(),
            "{command:?} is a Gated action and must raise a request"
        );
    }
    // A narrow rule stored alongside still allows its own calls.
    upsert_rule(&mut conn, &project.id, "Bash", "npm test:*", &actor_id).unwrap();
    assert!(matching_rule(&conn, &project.id, "Bash", &bash("npm test")).unwrap().is_some());
}

#[test]
fn no_session_scoped_rule_exists_in_the_schema() {
    let (conn, _actor_id, _project) = common::seeded_project();
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info('permission_rules') ORDER BY cid").unwrap();
    let columns: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(columns, ["id", "project_id", "tool", "pattern", "created_by", "created_at"]);
    let other_rule_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE '%rule%' AND name != 'permission_rules'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(other_rule_tables, 0, "no second rule table can carry a session scope");
}
