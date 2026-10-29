//! One permission mode per session kind (docs/mvp-spec.md §4.1, ADR 0001, issue #48). The session
//! kind decides how Claude Code is launched; nothing the developer passes can change it.

use flywheel_core::domain::session_kind::{proposal_tools, SessionKind, BOARD_SERVER};
use flywheel_core::permission_pattern::suggested_rule;

#[test]
fn a_story_session_accepts_edits_and_allows_every_bash_command_without_asking() {
    let policy = SessionKind::Story.launch_policy();
    assert_eq!(policy.permission_mode, "acceptEdits");
    assert_eq!(
        policy.allowed_tools,
        vec![
            "Bash",
            "mcp__flywheel-board__task_list",
            "mcp__flywheel-board__task_add",
            "mcp__flywheel-board__task_update",
            "mcp__flywheel-board__checks_run",
            "mcp__flywheel-board__handoff",
            "mcp__flywheel-board__propose",
            "mcp__flywheel-board__proposal_withdraw",
        ],
        "the broad Bash allow is the whole tool, plus the Story agent's board tools"
    );
    assert!(policy.disallowed_tools.is_empty());
    assert!(
        policy.raises_requests,
        "a Story session still raises a request for anything else"
    );
}

#[test]
fn a_shaping_session_is_read_only_plus_the_proposal_tools_and_never_raises_a_request() {
    let policy = SessionKind::Shaping.launch_policy();
    // `dontAsk` denies whatever is not pre-approved instead of prompting.
    assert_eq!(policy.permission_mode, "dontAsk");
    assert!(!policy.raises_requests);
    assert_eq!(policy.allowed_tools[..3], ["Read", "Glob", "Grep"]);
    assert_eq!(
        policy.allowed_tools[3..],
        proposal_tools()[..],
        "read-only plus Proposals, exactly"
    );
    assert!(
        !policy
            .allowed_tools
            .iter()
            .any(|t| t.contains("task_") || t.contains("handoff")),
        "never the Task tools or the hand-off"
    );
    assert!(
        !policy
            .allowed_tools
            .iter()
            .any(|t| t == &format!("mcp__{BOARD_SERVER}")),
        "never every board tool at once"
    );
    for read_only in ["Read", "Glob", "Grep"] {
        assert!(
            policy.allowed_tools.iter().any(|t| t == read_only),
            "{read_only} must be allowed"
        );
    }
    for proposal in proposal_tools() {
        assert!(
            policy.allowed_tools.contains(&proposal),
            "{proposal} must be allowed"
        );
    }
    for writes in ["Bash", "Edit", "Write", "NotebookEdit"] {
        assert!(
            !policy.allowed_tools.iter().any(|t| t == writes),
            "{writes} must not be allowed"
        );
        assert!(
            policy.disallowed_tools.iter().any(|t| t == writes),
            "{writes} must be denied outright"
        );
    }
    // Issue #122: Rounds are the only way a shaping session asks.
    assert!(
        policy
            .disallowed_tools
            .iter()
            .any(|t| t == "AskUserQuestion"),
        "a shaping session asks only in Rounds"
    );
}

#[test]
fn a_session_kind_round_trips_through_its_column_value() {
    for kind in SessionKind::ALL {
        assert_eq!(SessionKind::parse(kind.as_str()), Some(kind));
    }
    assert_eq!(SessionKind::Shaping.as_str(), "shaping");
    assert_eq!(SessionKind::parse("chat"), None);
}

#[test]
fn every_session_kind_has_exactly_one_mode() {
    let modes: Vec<&str> = SessionKind::ALL
        .iter()
        .map(|k| k.launch_policy().permission_mode)
        .collect();
    assert_eq!(modes, vec!["acceptEdits", "dontAsk"]);
}

#[test]
fn the_card_pre_fills_the_exact_bash_command_or_the_whole_tool() {
    assert_eq!(
        suggested_rule("Bash", Some(r#"{"command":"npm  test --watch"}"#)),
        "Bash(npm test --watch)"
    );
    assert_eq!(
        suggested_rule("Bash", Some(r#"{"command":"npm test && git push"}"#)),
        "Bash"
    );
    assert_eq!(
        suggested_rule("WebFetch", Some(r#"{"url":"https://example.com"}"#)),
        "WebFetch"
    );
    assert_eq!(suggested_rule("WebFetch", None), "WebFetch");
    assert_eq!(suggested_rule("Bash", Some("not json")), "Bash");
}

/// Ask the compiled board MCP server, over its own stdio protocol, for the name it registers under
/// and the tools it lists. This is the server Claude Code spawns from `--mcp-config`, so what it
/// answers here is what an `--allowedTools` entry has to match at runtime.
fn board_server_registration(kind: SessionKind) -> (String, Vec<String>) {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};

    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../sidecar/dist/mcp-permission-server.js");
    assert!(
        script.exists(),
        "{} is missing: run `npm --prefix packages/sidecar run build:dist` first",
        script.display()
    );
    // The socket is only dialled when a tool is called; listing tools never touches it.
    let mut child = Command::new("node")
        .arg(&script)
        .arg("/nonexistent/flywheel-board-test.sock")
        .arg(kind.as_str())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("node must be on PATH to run the board MCP server");
    let mut stdin = child.stdin.take().unwrap();
    for message in [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"flywheel-test","version":"0"}}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
    ] {
        writeln!(stdin, "{message}").unwrap();
    }
    let (mut server_name, mut tools) = (None, None);
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let reply: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        match reply["id"].as_i64() {
            Some(1) => {
                server_name = reply["result"]["serverInfo"]["name"]
                    .as_str()
                    .map(str::to_string)
            }
            Some(2) => {
                tools = Some(
                    reply["result"]["tools"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|t| t["name"].as_str().unwrap().to_string())
                        .collect(),
                );
                break;
            }
            _ => {}
        }
    }
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    (
        server_name.expect("the server answered initialize"),
        tools.expect("the server answered tools/list"),
    )
}

/// Every board tool a session kind pre-approves is one the board server actually registers, under
/// the name it actually registers as: a renamed server or tool would otherwise leave the allow-list
/// silently pointing at nothing, and every call would wait on a permission card instead.
#[test]
fn every_allowed_board_tool_is_one_the_board_server_registers() {
    for kind in SessionKind::ALL {
        let (server, tools) = board_server_registration(kind);
        assert_eq!(
            server, BOARD_SERVER,
            "the Rust launch policy and the server agree on the server's name"
        );
        let prefix = format!("mcp__{server}__");
        let allowed = kind.launch_policy().allowed_tools;
        for allowed in allowed.iter().filter(|t| t.starts_with("mcp__")) {
            let tool = allowed.strip_prefix(&prefix).unwrap_or_else(|| {
                panic!("{kind:?} allows {allowed:?}, which is not a tool of the {server} server")
            });
            assert!(
                tools.iter().any(|t| t == tool),
                "{kind:?} allows {allowed:?}, but {server} registers only {tools:?}"
            );
        }
        // Every board tool the server lists to this kind is pre-approved for it, so none waits on a
        // permission card (a shaping session has no card to wait on at all).
        for tool in tools.iter().filter(|t| *t != "approve_action") {
            assert!(
                allowed.contains(&format!("{prefix}{tool}")),
                "a {kind:?} session must pre-approve {tool}"
            );
        }
    }
    // Issue #123: each kind is listed only its own tools.
    let (_, shaping) = board_server_registration(SessionKind::Shaping);
    assert_eq!(
        shaping,
        [
            "round_post",
            "round_wait",
            "propose_spec_change",
            "propose_roadmap_change",
            "roadmap_holds",
            "propose_story",
            "propose_story_order",
            "propose_exit_test",
            "propose_criterion"
        ],
        "a shaping session sees its Round and Proposal tools and nothing else"
    );
    let (_, story) = board_server_registration(SessionKind::Story);
    assert!(
        !story.iter().any(|t| t == "round_post"),
        "a Story session never sees round_post: {story:?}"
    );
    // Issue #160: a Story session files and withdraws its own Proposals; a shaping session never sees either.
    for tool in ["propose", "proposal_withdraw"] {
        assert!(
            story.iter().any(|t| t == tool),
            "a Story session sees {tool}: {story:?}"
        );
        assert!(
            !shaping.iter().any(|t| t == tool),
            "a shaping session never sees {tool}: {shaping:?}"
        );
    }
}

/// Issue #92: a permission request is an MCP tool call that blocks until the developer answers, and
/// Claude Code aborts an MCP tool call past `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (30 minutes for a
/// stdio server) or `MCP_TOOL_TIMEOUT` (about 28 hours). A Story session raises both to at least
/// 7 days, and stays at or under Node's 2^31 - 1 ms timer ceiling, past which a timer fires at once.
#[test]
fn a_story_session_keeps_a_request_waiting_past_claude_codes_mcp_tool_timeouts() {
    const SEVEN_DAYS_MS: u64 = 7 * 24 * 60 * 60 * 1000;
    const NODE_TIMER_CEILING_MS: u64 = (1 << 31) - 1;
    let policy = SessionKind::Story.launch_policy();
    let names: Vec<&str> = policy.env.iter().map(|(name, _)| *name).collect();
    assert_eq!(
        names,
        ["CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT", "MCP_TOOL_TIMEOUT"]
    );
    for (name, value) in &policy.env {
        let ms: u64 = value.parse().expect("milliseconds");
        assert!(ms >= SEVEN_DAYS_MS, "{name}={ms} is under 7 days");
        assert!(
            ms <= NODE_TIMER_CEILING_MS,
            "{name}={ms} would overflow a Node timer"
        );
    }
}
