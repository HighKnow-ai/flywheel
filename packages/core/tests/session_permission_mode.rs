//! One permission mode per session kind (docs/mvp-spec.md §4.1, ADR 0001, issue #48). The session
//! kind decides how Claude Code is launched; nothing the developer passes can change it.

use core::domain::session_kind::{SessionKind, PROPOSAL_TOOLS};
use core::permission_pattern::suggested_rule;

#[test]
fn a_story_session_accepts_edits_and_allows_every_bash_command_without_asking() {
    let policy = SessionKind::Story.launch_policy();
    assert_eq!(policy.permission_mode, "acceptEdits");
    assert_eq!(
        policy.allowed_tools,
        vec![
            "Bash",
            "mcp__flywheel-permissions__task_list",
            "mcp__flywheel-permissions__task_add",
            "mcp__flywheel-permissions__task_update",
        ],
        "the broad Bash allow is the whole tool, plus the Task board tools"
    );
    assert!(policy.disallowed_tools.is_empty());
    assert!(policy.raises_requests, "a Story session still raises a request for anything else");
}

#[test]
fn a_shaping_session_is_read_only_plus_the_proposal_tools_and_never_raises_a_request() {
    let policy = SessionKind::Shaping.launch_policy();
    // `dontAsk` denies whatever is not pre-approved instead of prompting.
    assert_eq!(policy.permission_mode, "dontAsk");
    assert!(!policy.raises_requests);
    assert_eq!(policy.allowed_tools, vec!["Read", "Glob", "Grep", "mcp__flywheel-proposals"], "read-only plus Proposals, exactly");
    assert!(!policy.allowed_tools.iter().any(|t| t.contains("task_")), "never the Task tools");
    for read_only in ["Read", "Glob", "Grep"] {
        assert!(policy.allowed_tools.iter().any(|t| t == read_only), "{read_only} must be allowed");
    }
    for proposal in PROPOSAL_TOOLS {
        assert!(policy.allowed_tools.iter().any(|t| t == proposal), "{proposal} must be allowed");
    }
    for writes in ["Bash", "Edit", "Write", "NotebookEdit"] {
        assert!(!policy.allowed_tools.iter().any(|t| t == writes), "{writes} must not be allowed");
        assert!(policy.disallowed_tools.iter().any(|t| t == writes), "{writes} must be denied outright");
    }
}

#[test]
fn every_session_kind_has_exactly_one_mode() {
    let modes: Vec<&str> = SessionKind::ALL.iter().map(|k| k.launch_policy().permission_mode).collect();
    assert_eq!(modes, vec!["acceptEdits", "dontAsk"]);
}

#[test]
fn the_card_pre_fills_the_exact_bash_command_or_the_whole_tool() {
    assert_eq!(suggested_rule("Bash", Some(r#"{"command":"npm  test --watch"}"#)), "Bash(npm test --watch)");
    assert_eq!(suggested_rule("Bash", Some(r#"{"command":"npm test && git push"}"#)), "Bash");
    assert_eq!(suggested_rule("WebFetch", Some(r#"{"url":"https://example.com"}"#)), "WebFetch");
    assert_eq!(suggested_rule("WebFetch", None), "WebFetch");
    assert_eq!(suggested_rule("Bash", Some("not json")), "Bash");
}
