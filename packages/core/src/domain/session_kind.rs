//! What kind of session an agent runs in, and the one way each kind is launched
//! (docs/mvp-spec.md §4.1, ADR 0001). Flywheel picks the Claude Code permission mode from the
//! session kind. The developer never picks it, and no command takes a mode from the renderer.

/// The MCP server whose tools let a shaping session write to the board, as Proposals only. A bare
/// `mcp__<server>` entry allows every tool that server offers. The shaping milestone registers the
/// server under this name.
pub const PROPOSAL_SERVER: &str = "flywheel-proposals";

/// The Proposal tools a shaping session may call, in Claude Code's `--allowedTools` syntax.
pub const PROPOSAL_TOOLS: [&str; 1] = ["mcp__flywheel-proposals"];

/// The MCP server every session that raises requests is wired to: it hosts the permission-prompt
/// tool and the Task board tools. Mirrors `MCP_SERVER_NAME` in
/// `packages/sidecar/src/mcp-permission-server.ts`.
pub const PERMISSION_SERVER: &str = "flywheel-permissions";

/// The Task board tools in `--allowedTools` syntax (`mcp__flywheel-permissions__task_list`, …),
/// so a Story session's checklist writes never wait on a permission card (issue #52).
pub fn task_tools() -> Vec<String> {
    crate::domain::task_tool::TASK_TOOL_NAMES.iter().map(|name| format!("mcp__{PERMISSION_SERVER}__{name}")).collect()
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
}

impl SessionKind {
    /// Every session kind, in a fixed order.
    pub const ALL: [SessionKind; 2] = [SessionKind::Story, SessionKind::Shaping];

    /// The launch flags this kind fixes.
    ///
    /// - A Story session runs in `acceptEdits` with every Bash command and the Task board tools
    ///   allowed, so it edits files
    ///   and runs builds and tests in its worktree without asking. Claude Code's own
    ///   working-directory boundary keeps writes inside the worktree, and the shim still asks for
    ///   every Gated action, because the shim intercepts the command itself, after Claude Code has
    ///   allowed it. Any other request raises a card.
    /// - A shaping session runs in `dontAsk`, which refuses whatever is not pre-approved instead of
    ///   prompting: it may read and call the Proposal tools, and nothing else — never Bash, and
    ///   never the Task tools, whose server it is not even wired to.
    pub fn launch_policy(self) -> LaunchPolicy {
        match self {
            SessionKind::Story => LaunchPolicy {
                permission_mode: "acceptEdits",
                allowed_tools: std::iter::once("Bash".to_string()).chain(task_tools()).collect(),
                disallowed_tools: Vec::new(),
                raises_requests: true,
            },
            SessionKind::Shaping => LaunchPolicy {
                permission_mode: "dontAsk",
                allowed_tools: READ_ONLY_TOOLS.iter().chain(PROPOSAL_TOOLS.iter()).map(|t| t.to_string()).collect(),
                disallowed_tools: WRITING_TOOLS.iter().map(|t| t.to_string()).collect(),
                raises_requests: false,
            },
        }
    }
}
