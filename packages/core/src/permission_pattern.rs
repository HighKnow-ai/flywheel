//! Permission-rule patterns in Claude Code's syntax (docs/mvp-spec.md §4.1, ADR 0001): what a
//! rule's pattern says, whether a tool call matches it, and whether it could ever cover a Gated
//! action.
//!
//! A rule is written `Tool(pattern)`: `Bash(npm test:*)` is tool `Bash`, pattern `npm test:*`. A
//! bare `Tool` (or `Tool(*)`) is the whole tool. For `Bash` a pattern is either an exact command
//! (`npm run build`) or a prefix ending in `:*` (`npm test:*` matches `npm test` and `npm test
//! --watch`, not `npm tester`). A narrower pattern on any other tool is stored but matches nothing
//! yet, so a rule never allows more than it says.
//!
//! [`covers_gated_action`] and [`call_is_gated`] are the only places this crate asks the
//! classifier ([`crate::destructive::classify`]) about a rule. Both go through [`words_are_gated`],
//! so when the classifier's list changes, every rule decision follows it.

use crate::destructive::{classify, Verdict};

/// The pattern that allows every input of a tool.
pub const WHOLE_TOOL: &str = "*";

/// The one tool whose input the classifier can judge.
const SHELL_TOOL: &str = "Bash";

/// Characters that chain, pipe, redirect or substitute. A rule never matches a command carrying
/// one, so `Bash(npm test:*)` cannot be stretched to `npm test && git push`.
const SHELL_OPERATORS: &[char] = &[';', '&', '|', '`', '\n', '\r', '>', '<', '$', '(', ')'];

/// Programs whose arguments are themselves a shell command line. A rule on one of them could reach
/// any command, Gated actions included, so the classifier cannot vouch for it. `env` joins them
/// only when it runs a program. Interpreters and tools such as `npx`, `node` or `python` are
/// ordinary programs here: a Gated action they run from inside still meets the classifier at
/// execution, through the shim.
const COMMAND_RUNNERS: &[&str] = &[
    "sh", "bash", "zsh", "dash", "fish", "ksh", "eval", "exec", "sudo", "doas", "su", "xargs",
    "command", "builtin", "parallel",
];

/// Wrappers that only prefix another command (`timeout 60 cargo test`). They are stripped and the
/// rest is classified, so `timeout 60 git push` is still Gated.
const PREFIX_WRAPPERS: &[&str] = &["time", "timeout", "nice", "nohup"];

/// Argument tails appended to a prefix pattern to probe what it could reach. They are probes, not
/// the Gated list: the classifier alone decides whether each completed command is Gated. Each tail
/// is a shape some Gated action takes after a program, a subcommand or a flag.
const PROBE_TAILS: &[&[&str]] = &[
    &["push"],
    &["push", "--force"],
    &["push", "--delete", "probe"],
    &["push", "origin", ":probe"],
    &["--force"],
    &["-f"],
    &["--delete", "probe"],
    &["-D", "probe"],
    &["origin", ":probe"],
    &["origin", "--force"],
    &["branch", "-D", "probe"],
    &["worktree", "remove", "probe"],
    &["remove", "probe"],
    &["reset", "--hard"],
    &["--hard"],
    &["clean", "-f"],
    &["rebase", "origin/probe"],
    &["origin/probe"],
    &["filter-branch"],
    &["-r", "/"],
    &["-rf", "/"],
    &["publish"],
    &["pr", "merge"],
    &["merge"],
    &["release", "create", "probe"],
    &["create", "probe"],
];

/// What a pattern says about a tool's input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pattern {
    /// Every input of the tool.
    WholeTool,
    /// Exactly this command.
    Exact(String),
    /// This command, or this command followed by more words.
    Prefix(String),
}

/// Parse a stored pattern. Refuses a pattern Flywheel cannot match faithfully: an empty one, one
/// with a `*` anywhere but a trailing `:*`, or a Bash pattern carrying a shell operator.
pub fn parse_pattern(tool: &str, pattern: &str) -> anyhow::Result<Pattern> {
    let pattern = pattern.trim();
    anyhow::ensure!(!pattern.is_empty(), "a permission rule needs a pattern");
    if pattern == WHOLE_TOOL {
        return Ok(Pattern::WholeTool);
    }
    let (body, prefix) = match pattern.strip_suffix(":*") {
        Some(body) => (body.trim_end(), true),
        None => (pattern, false),
    };
    anyhow::ensure!(
        !body.contains('*'),
        "{pattern:?} is not a pattern Flywheel can match: use an exact command, `prefix:*`, or `*`"
    );
    if tool == SHELL_TOOL {
        anyhow::ensure!(
            !body.contains(SHELL_OPERATORS),
            "{pattern:?} carries a shell operator; a rule names one plain command"
        );
    }
    if body.is_empty() {
        return Ok(Pattern::WholeTool);
    }
    let body = normalise_spaces(body);
    Ok(if prefix { Pattern::Prefix(body) } else { Pattern::Exact(body) })
}

/// Split `Tool(pattern)` into its tool and pattern. A bare `Tool` is the whole tool.
pub fn parse_rule(text: &str) -> anyhow::Result<(String, String)> {
    let text = text.trim();
    let (tool, pattern) = match text.find('(') {
        Some(open) => {
            let inner = text[open + 1..]
                .strip_suffix(')')
                .ok_or_else(|| anyhow::anyhow!("{text:?} is missing its closing parenthesis"))?;
            (text[..open].trim(), inner.trim())
        }
        None => (text, WHOLE_TOOL),
    };
    anyhow::ensure!(
        !tool.is_empty() && tool.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "{text:?} does not name a tool"
    );
    Ok((tool.to_string(), pattern.to_string()))
}

/// The rule as Claude Code writes it: `Bash(npm test:*)`, or a bare `Bash` for the whole tool.
pub fn format_rule(tool: &str, pattern: &str) -> String {
    if pattern == WHOLE_TOOL {
        tool.to_string()
    } else {
        format!("{tool}({pattern})")
    }
}

/// The pattern a request suggests when nobody edited it: the exact Bash command, or the whole tool
/// for any other tool.
pub fn suggested_pattern(tool: &str, input: &serde_json::Value) -> String {
    match bash_command(tool, input) {
        Some(command) if !command.contains(SHELL_OPERATORS) && !command.contains('*') => {
            normalise_spaces(command)
        }
        _ => WHOLE_TOOL.to_string(),
    }
}

/// Whether a call of `tool` with `input` matches `pattern`. An unparseable pattern matches nothing.
pub fn matches(tool: &str, pattern: &str, input: &serde_json::Value) -> bool {
    let Ok(parsed) = parse_pattern(tool, pattern) else { return false };
    if parsed == Pattern::WholeTool {
        return true;
    }
    let Some(command) = bash_command(tool, input) else { return false };
    if command.contains(SHELL_OPERATORS) {
        return false;
    }
    let command = normalise_spaces(command);
    match parsed {
        Pattern::WholeTool => true,
        Pattern::Exact(exact) => command == exact,
        Pattern::Prefix(prefix) => {
            command == prefix || command.strip_prefix(&prefix).is_some_and(|rest| rest.starts_with(' '))
        }
    }
}

/// Whether a rule of `tool` with `pattern` could match a Gated action. The backend refuses to store
/// such a rule, and never applies one it finds. An unparseable pattern counts as covering one.
pub fn covers_gated_action(tool: &str, pattern: &str, default_branch: Option<&str>) -> bool {
    if tool != SHELL_TOOL {
        return false;
    }
    let (body, is_prefix) = match parse_pattern(tool, pattern) {
        Ok(Pattern::WholeTool) | Err(_) => return true,
        Ok(Pattern::Exact(body)) => (body, false),
        Ok(Pattern::Prefix(body)) => (body, true),
    };
    let Some(words) = shell_words(&body) else { return true };
    if words_are_gated(&words, default_branch) {
        return true;
    }
    is_prefix
        && PROBE_TAILS.iter().any(|tail| {
            let mut probe = words.clone();
            probe.extend(tail.iter().map(|w| w.to_string()));
            words_are_gated(&probe, default_branch)
        })
}

/// Whether this call is itself a Gated action, judged from its own input. A call the classifier
/// cannot read (unbalanced quotes, an empty segment) counts as Gated, so no rule answers it.
pub fn call_is_gated(tool: &str, input: &serde_json::Value, default_branch: Option<&str>) -> bool {
    let Some(command) = bash_command(tool, input) else { return false };
    command
        .split(|c| matches!(c, ';' | '&' | '|' | '\n'))
        .filter(|segment| !segment.trim().is_empty())
        .any(|segment| match shell_words(segment) {
            Some(words) => words_are_gated(&words, default_branch),
            None => true,
        })
}

/// The single call into the classifier. Leading `NAME=value` assignments and prefix wrappers are
/// skipped, a path is reduced to its program name, and a command runner counts as Gated because
/// what it runs is unknowable from its own words. Words with no program left (`timeout 60`) count
/// as Gated, since a prefix rule on them could reach anything.
fn words_are_gated(words: &[String], default_branch: Option<&str>) -> bool {
    let mut rest: &[String] = words;
    loop {
        while rest.first().is_some_and(|w| is_assignment(w)) {
            rest = &rest[1..];
        }
        let Some(first) = rest.first() else { return true };
        let program = program_name(first);
        if !PREFIX_WRAPPERS.contains(&program) {
            break;
        }
        rest = strip_wrapper(program, &rest[1..]);
    }
    let program = program_name(&rest[0]);
    let args = &rest[1..];
    if COMMAND_RUNNERS.contains(&program) {
        return true;
    }
    if program == "env" && args.iter().any(|a| !a.starts_with('-') && !is_assignment(a)) {
        return true;
    }
    classify(program, args, default_branch) != Verdict::Safe
}

fn program_name(word: &str) -> &str {
    word.rsplit('/').next().unwrap_or(word)
}

/// The words after a prefix wrapper's own flags and operands.
fn strip_wrapper<'a>(wrapper: &str, mut args: &'a [String]) -> &'a [String] {
    let takes_value: &[&str] = match wrapper {
        "timeout" => &["-s", "--signal", "-k", "--kill-after"],
        "nice" => &["-n", "--adjustment"],
        _ => &[],
    };
    while let Some(arg) = args.first() {
        if arg == "--" {
            args = &args[1..];
            break;
        }
        if !arg.starts_with('-') {
            break;
        }
        let skip = if takes_value.contains(&arg.as_str()) { 2 } else { 1 };
        args = &args[skip.min(args.len())..];
    }
    if wrapper == "timeout" && !args.is_empty() {
        args = &args[1..]; // the duration
    }
    args
}

fn bash_command<'a>(tool: &str, input: &'a serde_json::Value) -> Option<&'a str> {
    if tool != SHELL_TOOL {
        return None;
    }
    input.get("command").and_then(|c| c.as_str())
}

fn normalise_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_assignment(word: &str) -> bool {
    let Some((name, _)) = word.split_once('=') else { return false };
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Whitespace words honouring single and double quotes. `None` when a quote is left open.
fn shell_words(text: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut has_word = false;
    let (mut single, mut double) = (false, false);
    for c in text.chars() {
        match c {
            '\'' if !double => {
                single = !single;
                has_word = true;
            }
            '"' if !single => {
                double = !double;
                has_word = true;
            }
            c if c.is_whitespace() && !single && !double => {
                if has_word {
                    words.push(std::mem::take(&mut current));
                    has_word = false;
                }
            }
            c => {
                current.push(c);
                has_word = true;
            }
        }
    }
    if single || double {
        return None;
    }
    if has_word {
        words.push(current);
    }
    Some(words)
}
