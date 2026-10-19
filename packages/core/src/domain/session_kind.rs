//! What kind of session an agent runs in, and the one way each kind is launched
//! (docs/mvp-spec.md §4.1, ADR 0001). Flywheel picks the Claude Code permission mode from the
//! session kind. The developer never picks it, and no command takes a mode from the renderer.

/// The MCP server that carries every board tool: the permission prompt, the Task tools, the
/// hand-off and the Check run, and later the Proposal tools. Mirrors `MCP_SERVER_NAME` in
/// `packages/sidecar/src/mcp-permission-server.ts`.
pub const BOARD_SERVER: &str = "flywheel-board";

/// The Proposal tools a shaping session may call, by the name `flywheel-board` registers them
/// under. None is registered yet: the shaping milestone adds them, one name each. Never a bare
/// `mcp__flywheel-board` entry, which would allow every board tool, the Task tools and the
/// hand-off included.
pub const PROPOSAL_TOOL_NAMES: [&str; 0] = [];

/// One board tool's name in `--allowedTools` syntax: `mcp__flywheel-board__<tool>`.
fn board_tool(name: &str) -> String {
    format!("mcp__{BOARD_SERVER}__{name}")
}

/// The Proposal tools in `--allowedTools` syntax.
pub fn proposal_tools() -> Vec<String> {
    PROPOSAL_TOOL_NAMES.iter().map(|name| board_tool(name)).collect()
}

/// The Story agent's board tools in `--allowedTools` syntax: the Task tools (issue #52), then the
/// Check run and the hand-off (issue #53), so none of them ever waits on a permission card.
pub fn story_board_tools() -> Vec<String> {
    crate::domain::task_tool::TASK_TOOL_NAMES
        .iter()
        .chain(crate::domain::handoff::HANDOFF_TOOL_NAMES.iter())
        .map(|name| board_tool(name))
        .collect()
}

/// The tools that only read, which a shaping session may call.
const READ_ONLY_TOOLS: [&str; 3] = ["Read", "Glob", "Grep"];

/// The tools that write or run commands. A shaping session is denied them outright, so a developer's
/// own Claude Code settings cannot allow them back in.
const WRITING_TOOLS: [&str; 4] = ["Bash", "Edit", "Write", "NotebookEdit"];

/// The kind of session an agent runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    /// Executes a Story inside its own worktree.
    Story,
    /// Shapes an Epic, a Milestone or the Roadmap with the developer, and writes only Proposals.
    Shaping,
}

/// How a session is launched: the Claude Code flags its kind fixes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPolicy {
    /// The value of `--permission-mode`.
    pub permission_mode: &'static str,
    /// The value of `--allowedTools`: tools that run without asking.
    pub allowed_tools: Vec<String>,
    /// The value of `--disallowedTools`: tools that are refused without asking.
    pub disallowed_tools: Vec<String>,
    /// Whether the session is wired to Flywheel's permission-prompt tool. A session that is not
    /// never raises a permission request: whatever its mode does not allow is refused.
    pub raises_requests: bool,
    /// Environment variables the kind sets on the spawn, over whatever the resolved env holds.
    pub env: Vec<(&'static str, String)>,
}

/// How long Claude Code lets an MCP tool call run, or sit silent, before aborting it: 7 days, in
/// milliseconds (issue #92). A permission request is a call to the permission-prompt tool that
/// blocks until the developer answers, and §4.1 says it waits with no timeout, but Claude Code's
/// defaults abort it after 30 minutes idle (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, stdio) or about
/// 28 hours (`MCP_TOOL_TIMEOUT`). Kept under 2^31 - 1 ms (about 24.8 days), past which a
/// JavaScript timer fires at once instead of never.
pub const MCP_TOOL_TIMEOUT_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// The env that keeps a permission request waiting past Claude Code's MCP tool timeouts. The idle
/// timeout is capped at `MCP_TOOL_TIMEOUT`, so both are raised.
fn waiting_request_env() -> Vec<(&'static str, String)> {
    let ms = MCP_TOOL_TIMEOUT_MS.to_string();
    vec![("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT", ms.clone()), ("MCP_TOOL_TIMEOUT", ms)]
}

impl SessionKind {
    /// Every session kind, in a fixed order.
    pub const ALL: [SessionKind; 2] = [SessionKind::Story, SessionKind::Shaping];

    /// The launch flags this kind fixes.
    ///
    /// - A Story session runs in `acceptEdits` with every Bash command and its board tools
    ///   allowed, so it edits files
    ///   and runs builds and tests in its worktree without asking. Claude Code's own
    ///   working-directory boundary keeps writes inside the worktree, and the shim still asks for
    ///   every Gated action, because the shim intercepts the command itself, after Claude Code has
    ///   allowed it. Any other request raises a card.
    /// - A shaping session runs in `dontAsk`, which refuses whatever is not pre-approved instead of
    ///   prompting: it may read and call the Proposal tools, and nothing else — never Bash, and
    ///   never the Task tools or the hand-off.
    /// - A Story session's MCP tool timeouts are raised to 7 days, so a request it raises waits
    ///   for the developer instead of failing on Claude Code's side. A shaping session raises no
    ///   request and keeps Claude Code's defaults.
    pub fn launch_policy(self) -> LaunchPolicy {
        match self {
            SessionKind::Story => LaunchPolicy {
                permission_mode: "acceptEdits",
                allowed_tools: std::iter::once("Bash".to_string()).chain(story_board_tools()).collect(),
                disallowed_tools: Vec::new(),
                raises_requests: true,
                env: waiting_request_env(),
            },
            SessionKind::Shaping => LaunchPolicy {
                permission_mode: "dontAsk",
                allowed_tools: READ_ONLY_TOOLS.iter().map(|t| t.to_string()).chain(proposal_tools()).collect(),
                disallowed_tools: WRITING_TOOLS.iter().map(|t| t.to_string()).collect(),
                raises_requests: false,
                env: Vec::new(),
            },
        }
    }
}
