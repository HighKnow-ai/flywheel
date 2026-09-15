//! D-51/D-55's PATH shim binary. This binary is deliberately NOT built or invoked by cargo under
//! the names `git` or `rm` — `flywheel_core::shim::install_for_run` creates the on-disk entries
//! named `git` and `rm` (or `git.exe`/`rm.exe`) at spawn time by hard-linking/copying this
//! compiled binary. Dispatch reads `argv[0]` (never the cargo package/binary name) so both
//! shadowed names run the exact same compiled binary without a second build target.
//!
//! **Fail-closed, by construction, in three distinct ways (T-03-04-02, T-03-04-03):**
//! 1. An unrecognised `argv[0]` stem refuses to run anything at all (the `match`'s explicit
//!    unknown-name arm, never a fallback `if`).
//! 2. The real binary is resolved EXACTLY ONCE, from `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM` —
//!    asserted absolute and existing — and NEVER through a `PATH` lookup or a `which` invocation.
//!    A shim placed first on `PATH` under either name therefore cannot ever resolve to itself: it
//!    has no code path that reads `PATH` at all.
//! 3. Any resolution failure (the env var absent, empty, relative, or naming a non-existent file)
//!    exits non-zero with a message naming the variable, WITHOUT executing anything — never a
//!    silent passthrough.
//!
//! **D-55/D-56/D-58 (plan 03-07): the shim is the component that blocks indefinitely.** Before
//! executing either real binary, this process classifies its own argv through
//! `flywheel_core::destructive::classify` — the ONE compiled implementation of D-56's list, never
//! reimplemented here. A `Safe` verdict falls straight into the normal exec path with no
//! permission round trip at all. A `Destructive` verdict connects to the session's existing
//! permission socket (`FLYWHEEL_PERMISSION_SOCKET`, opened by the sidecar's
//! `mcp-permission-server.ts` BEFORE the backend is ever spawned) and reads its answer with a
//! plain blocking socket read — no read deadline is ever set on that socket anywhere in this
//! file, and this process holds no map, file or other record of a prior answer between
//! invocations, because every invocation is a brand-new OS process this binary starts fresh
//! (D-57's "no local cache", made true here by construction, not merely by omission). This is
//! deliberate: RESEARCH.md reproduced, live, that the backend's own `PreToolUse` hook layer
//! cancels a hook at its own configured deadline and lets the tool call through anyway under an
//! auto-accept permission mode — so a plain OS process the backend does not supervise is the only
//! place D-58's indefinite block can actually live.
//!
//! This binary writes at most one file (`<runtime>/contention/<run_id>.jsonl`, on lock-retry
//! exhaustion) and nothing else — no `rusqlite`/`Connection` reference anywhere in this file, the
//! same single-writer discipline `packages/sidecar/src/watchdog.ts` and
//! `packages/core/src/runtime_protocol.rs` already hold to.
//!
//! **`--classify-command <text>` (plan 03-07 Task 3):** a pure, side-effect-free classification
//! mode invoked directly by `packages/sidecar/src/pretooluse-hook.ts` — never through a shadowed
//! `PATH` entry, so `argv[0]` is whatever this binary was actually built/copied as. Checked FIRST,
//! before the `argv[0]`-stem dispatch below. Parses the raw bash command TEXT (which may chain
//! several commands with `&&`/`||`/`;`/`|`), resolves a program stem for each top-level segment
//! the same way the shadowed dispatch resolves its own name, and reaches the SAME
//! `destructive::classify` — so this mode can also catch a destructive `git`/`rm` invocation by
//! absolute path, which never resolves through this shim's own `PATH`-shadowed directory at all.
//! Prints exactly one word to stdout (`safe`, or one of `DestructiveCategory::as_str()`'s seven
//! destructive names) and never executes anything.

use std::env;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Output};

use flywheel_core::destructive::{classify, DestructiveCategory, Verdict};

/// What one real-git invocation attempt produced, captured so the retry executor can inspect
/// `stderr` for the lock-contention matcher while the ORIGINAL bytes are still forwarded verbatim
/// to this process's own stdout/stderr once the retry loop concludes.
struct CapturedOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<i32>,
}

impl From<Output> for CapturedOutput {
    fn from(output: Output) -> Self {
        Self {
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.status.code(),
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<OsString> = env::args_os().collect();

    // Task 3: checked BEFORE the argv[0]-stem dispatch below — a classify-command invocation
    // never dispatches to a real binary at all, and is never routed through a shadowed name.
    if args.get(1).and_then(|a| a.to_str()) == Some("--classify-command") {
        return run_classify_command(args.get(2));
    }

    let invoked_stem = args
        .first()
        .and_then(|argv0| Path::new(argv0).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned());

    match invoked_stem.as_deref() {
        Some("git") => run_git(&args[1..]),
        Some("rm") => run_rm(&args[1..]),
        other => {
            eprintln!(
                "flywheel-shim: refusing to run — invoked as {:?}, which this build does not dispatch to any known target",
                other.unwrap_or("<unreadable argv[0]>")
            );
            ExitCode::FAILURE
        }
    }
}

/// Resolve one absolute-path env var — the ONE place this binary ever learns which real
/// executable to run for a given shadowed name. Never falls back to a `PATH` lookup or a `which`
/// invocation (T-03-04-02): a missing, empty, relative, or dangling value is a hard failure, not a
/// degraded default.
fn resolve_real_binary_from_env(var_name: &str) -> Result<PathBuf, String> {
    let value = env::var_os(var_name).ok_or_else(|| format!("{var_name} is not set"))?;
    if value.is_empty() {
        return Err(format!("{var_name} is set but empty"));
    }
    let path = PathBuf::from(&value);
    if !path.is_absolute() {
        return Err(format!("{var_name} does not name an absolute path: {path:?}"));
    }
    if !path.is_file() {
        return Err(format!("{var_name} does not name an existing executable: {path:?}"));
    }
    Ok(path)
}

fn resolve_real_git_from_env() -> Result<PathBuf, String> {
    resolve_real_binary_from_env("FLYWHEEL_REAL_GIT")
}

fn resolve_real_rm_from_env() -> Result<PathBuf, String> {
    resolve_real_binary_from_env("FLYWHEEL_REAL_RM")
}

fn os_args_to_strings(args: &[OsString]) -> Vec<String> {
    args.iter().map(|a| a.to_string_lossy().into_owned()).collect()
}

fn reconstruct_command_text(program: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(program.to_string());
    parts.extend(args.iter().cloned());
    parts.join(" ")
}

/// What the permission round trip decided (D-55/D-58) — never cached, never reused; a fresh value
/// computed from a fresh socket connection on every single call.
enum PermissionOutcome {
    Allow,
    Deny,
    /// The round trip itself could not be completed (no socket configured, connection refused, a
    /// malformed answer). Carries a human-readable explanation. Always treated as a refusal to
    /// execute — never as an implicit allow (T-03-07-07).
    Error(String),
}

/// D-55/D-58: connect a FRESH Unix domain socket to `FLYWHEEL_PERMISSION_SOCKET`, send one
/// request line naming the raw command and its classified category, and read the answer with a
/// PLAIN BLOCKING socket read — no read deadline is ever set on this socket anywhere in this
/// function, and nothing here is written to or read from any file, map, or other value that could
/// outlive this one function call. Two calls in the same session, even for the byte-identical
/// command, each open their own fresh connection and each raise their own new request on the
/// sidecar side — there is no way for this function to answer itself from memory of an earlier
/// call, because it holds none.
fn request_permission(program: &str, string_args: &[String], category: DestructiveCategory) -> PermissionOutcome {
    let Some(socket_path) = env::var_os("FLYWHEEL_PERMISSION_SOCKET") else {
        return PermissionOutcome::Error(
            "FLYWHEEL_PERMISSION_SOCKET is not set — refusing a destructive command with nothing to ask".to_string(),
        );
    };

    let mut stream = match UnixStream::connect(&socket_path) {
        Ok(stream) => stream,
        Err(err) => {
            return PermissionOutcome::Error(format!(
                "failed to connect to the permission socket at {socket_path:?}: {err}"
            ))
        }
    };

    let command_text = reconstruct_command_text(program, string_args);
    let request_id = flywheel_core::ids::new_id();
    let payload = serde_json::json!({
        "requestId": request_id,
        "toolName": "Bash",
        "input": {
            "command": command_text,
            "destructiveCategory": category.as_str(),
        },
    });
    let mut line = payload.to_string();
    line.push('\n');
    if let Err(err) = stream.write_all(line.as_bytes()) {
        return PermissionOutcome::Error(format!("failed to send the permission request: {err}"));
    }

    // The load-bearing read (D-58): this call has no deadline. It returns only when the socket
    // answers, whenever that is — the whole reason this component, and not the backend's own
    // hook layer, is the one asked to wait.
    let mut reader = BufReader::new(stream);
    let mut response_line = String::new();
    match reader.read_line(&mut response_line) {
        Ok(0) => PermissionOutcome::Error("the permission socket closed before answering".to_string()),
        Ok(_) => match serde_json::from_str::<serde_json::Value>(response_line.trim()) {
            Ok(value) => match value.get("decision").and_then(|d| d.as_str()) {
                Some("allow") => PermissionOutcome::Allow,
                Some("deny") => PermissionOutcome::Deny,
                _ => PermissionOutcome::Error(format!(
                    "the permission socket returned an unrecognised answer: {response_line:?}"
                )),
            },
            Err(err) => PermissionOutcome::Error(format!(
                "the permission socket's answer did not parse as JSON: {err}"
            )),
        },
        Err(err) => PermissionOutcome::Error(format!("failed to read the permission socket's answer: {err}")),
    }
}

fn print_denied(category: DestructiveCategory) {
    eprintln!(
        "flywheel-shim: {} was declined — refusing to run this command",
        category.as_str()
    );
}

/// The shared D-55 gate every real-binary exec path runs through first: classify, and on a
/// destructive verdict, hold for the board's answer before ever touching `real_bin`. Returns
/// `Some(exit code)` when the caller must stop here (denied, or the round trip itself failed) —
/// `None` means "verdict was Safe, or was Destructive and the user allowed it," i.e. the caller's
/// own normal exec path should run.
fn destructive_gate(program: &str, string_args: &[String], default_branch: Option<&str>) -> Option<ExitCode> {
    let verdict = classify(program, string_args, default_branch);
    let Verdict::Destructive(category) = verdict else {
        return None;
    };

    match request_permission(program, string_args, category) {
        PermissionOutcome::Allow => None,
        PermissionOutcome::Deny => {
            print_denied(category);
            Some(ExitCode::FAILURE)
        }
        PermissionOutcome::Error(message) => {
            eprintln!("flywheel-shim: {message}");
            Some(ExitCode::FAILURE)
        }
    }
}

fn run_git(forwarded_args: &[OsString]) -> ExitCode {
    let real_git = match resolve_real_git_from_env() {
        Ok(path) => path,
        Err(message) => {
            eprintln!("flywheel-shim: {message}");
            return ExitCode::FAILURE;
        }
    };

    let string_args = os_args_to_strings(forwarded_args);
    let default_branch = env::var("FLYWHEEL_DEFAULT_BRANCH").ok();
    if let Some(exit_code) = destructive_gate("git", &string_args, default_branch.as_deref()) {
        return exit_code;
    }

    let command_text = reconstruct_command_text("git", &string_args);

    let mut last_output: Option<CapturedOutput> = None;
    let retry_result = flywheel_core::git_retry::with_lock_retry(&command_text, |_attempt| {
        let output = Command::new(&real_git)
            .args(forwarded_args)
            .output()
            .map_err(|e| anyhow::anyhow!("failed to spawn real git at {real_git:?}: {e}"))?;
        let stderr_text = String::from_utf8_lossy(&output.stderr).into_owned();
        let succeeded = output.status.success();
        last_output = Some(CapturedOutput::from(output));
        if succeeded {
            Ok(())
        } else {
            Err(anyhow::anyhow!(stderr_text))
        }
    });

    match retry_result {
        Ok(_outcome) => forward_and_exit(last_output),
        Err(err) => {
            if let Some(exhausted) = err.downcast_ref::<flywheel_core::git_retry::LockExhausted>() {
                let repository = env::current_dir()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| "<unresolved cwd>".to_string());
                write_contention_record(&repository, &command_text, exhausted.attempts);
            }
            forward_and_exit(last_output)
        }
    }
}

/// `rm` needs no lock-retry (that is a `git`-specific concern, D-51/D-54) — once the destructive
/// gate clears, this is a single plain invocation of the real binary.
fn run_rm(forwarded_args: &[OsString]) -> ExitCode {
    let real_rm = match resolve_real_rm_from_env() {
        Ok(path) => path,
        Err(message) => {
            eprintln!("flywheel-shim: {message}");
            return ExitCode::FAILURE;
        }
    };

    let string_args = os_args_to_strings(forwarded_args);
    if let Some(exit_code) = destructive_gate("rm", &string_args, None) {
        return exit_code;
    }

    let output = match Command::new(&real_rm).args(forwarded_args).output() {
        Ok(output) => output,
        Err(err) => {
            eprintln!("flywheel-shim: failed to spawn real rm at {real_rm:?}: {err}");
            return ExitCode::FAILURE;
        }
    };
    forward_and_exit(Some(CapturedOutput::from(output)))
}

/// Write the captured stdout/stderr of the LAST attempt through to this process's own streams —
/// so the agent sees exactly what a direct real-git invocation would have printed — then exit
/// with that same attempt's exit code. If no attempt ever ran (a spawn failure before any output
/// was captured), exit non-zero.
fn forward_and_exit(last_output: Option<CapturedOutput>) -> ExitCode {
    let Some(captured) = last_output else {
        return ExitCode::FAILURE;
    };
    let _ = std::io::stdout().write_all(&captured.stdout);
    let _ = std::io::stderr().write_all(&captured.stderr);
    match captured.exit_code {
        Some(code) => exit_code_from_i32(code),
        None => ExitCode::FAILURE,
    }
}

fn exit_code_from_i32(code: i32) -> ExitCode {
    let clamped = code.clamp(0, 255) as u8;
    ExitCode::from(clamped)
}

/// D-53: append one JSON line to `<runtime>/contention/<run_id>.jsonl` naming the repository, the
/// command and the attempt count, run id read from `FLYWHEEL_RUN_ID`. This is the ONLY file this
/// binary ever writes. A failure to resolve the runtime directory or to append the line is
/// swallowed here — the shim's job is to still exit with the real failure's own exit code
/// regardless of whether this bookkeeping write succeeds (mirrors `runtime_protocol.rs`'s own "one
/// session's I/O fault must never take anything else down" discipline, applied to a plain child
/// process rather than a background thread).
fn write_contention_record(repository: &str, command: &str, attempts: u32) {
    let Some(run_id) = env::var_os("FLYWHEEL_RUN_ID") else {
        return;
    };
    let run_id = run_id.to_string_lossy().into_owned();

    let Ok(runtime_dir) = flywheel_core::runtime_protocol::runtime_dir() else {
        return;
    };
    let dir = runtime_dir.join("contention");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    let record = serde_json::json!({
        "kind": "lock_exhausted",
        "repository": repository,
        "command": command,
        "attempts": attempts,
        "at": chrono::Utc::now().to_rfc3339(),
    });
    let Ok(mut line) = serde_json::to_string(&record) else {
        return;
    };
    line.push('\n');

    let path = dir.join(format!("{run_id}.jsonl"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}

// --- `--classify-command` mode (Task 3): pure classification over raw bash command text ---

/// Resolve a program "stem" out of a raw command-line token exactly the way the shadowed
/// dispatch resolves its own `argv[0]` — strips any leading path components, so
/// `/usr/bin/git push --force` and `git push --force` classify identically. This is precisely
/// what lets this mode catch a destructive `git`/`rm` invocation by absolute path, which never
/// resolves through this shim's own `PATH`-shadowed directory at all (T-03-07-05).
fn program_stem(token: &str) -> String {
    Path::new(token)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| token.to_string())
}

/// Split raw bash command text on its TOP-LEVEL `&&`/`||`/`;`/`|` control operators — each
/// resulting segment is classified independently, so a chained command
/// (`echo hi && git push --force`) cannot hide a destructive segment behind a harmless first one.
/// A quote character toggles "inside a quoted string" state so an operator appearing INSIDE a
/// quoted argument is never treated as a real separator. This is a pragmatic, not a fully
/// shell-grammar-correct, splitter — residual shell-quoting edge cases are a known, named
/// limitation of this mode (03-CONTEXT.md's own residual-gap framing), not a claim of complete
/// shell parsing.
fn split_top_level_segments(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' && !in_double {
            in_single = !in_single;
            current.push(c);
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            current.push(c);
            i += 1;
            continue;
        }
        if !in_single && !in_double {
            if c == '&' && chars.get(i + 1) == Some(&'&') {
                segments.push(std::mem::take(&mut current));
                i += 2;
                continue;
            }
            if c == '|' && chars.get(i + 1) == Some(&'|') {
                segments.push(std::mem::take(&mut current));
                i += 2;
                continue;
            }
            if c == ';' || c == '|' {
                segments.push(std::mem::take(&mut current));
                i += 1;
                continue;
            }
        }
        current.push(c);
        i += 1;
    }
    segments.push(current);
    segments
}

/// A minimal whitespace tokenizer honouring single/double quotes (not full shell-word expansion —
/// no variable substitution, no escaping beyond quote toggling). Sufficient to pull a program name
/// and its argv out of one already-isolated segment for `destructive::classify`.
fn tokenize_shell_words(segment: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut has_token = false;
    for c in segment.chars() {
        if c == '\'' && !in_double {
            in_single = !in_single;
            has_token = true;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            has_token = true;
            continue;
        }
        if c.is_whitespace() && !in_single && !in_double {
            if has_token {
                tokens.push(std::mem::take(&mut current));
                has_token = false;
            }
            continue;
        }
        current.push(c);
        has_token = true;
    }
    if has_token {
        tokens.push(current);
    }
    tokens
}

/// Classify raw bash command TEXT: split into top-level segments, classify each through the SAME
/// `destructive::classify` the shadowed dispatch uses, and return the first destructive verdict
/// found — `Safe` only if every segment is Safe. Empty text fails closed into `Uncategorized`
/// rather than being treated as trivially safe.
fn classify_raw_command_text(text: &str, default_branch: Option<&str>) -> Verdict {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Verdict::Destructive(DestructiveCategory::Uncategorized);
    }

    for segment in split_top_level_segments(trimmed) {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let tokens = tokenize_shell_words(segment);
        let Some(first) = tokens.first() else {
            continue;
        };
        let stem = program_stem(first);
        let rest: Vec<String> = tokens[1..].to_vec();
        if let verdict @ Verdict::Destructive(_) = classify(&stem, &rest, default_branch) {
            return verdict;
        }
    }

    Verdict::Safe
}

/// The `--classify-command <text>` mode's own entry point (Task 3). Never executes anything,
/// never opens the permission socket, never writes any file — a pure function of its one string
/// argument plus `FLYWHEEL_DEFAULT_BRANCH`. Prints exactly one word to stdout: `safe`, or one of
/// `DestructiveCategory::as_str()`'s seven destructive names. A missing/unreadable argument fails
/// closed, printing `uncategorized` and exiting non-zero — the hook's own caller treats a shim it
/// cannot invoke as destructive, never as permissive.
fn run_classify_command(command_text_arg: Option<&OsString>) -> ExitCode {
    let Some(command_text) = command_text_arg.and_then(|s| s.to_str()) else {
        println!("{}", DestructiveCategory::Uncategorized.as_str());
        return ExitCode::FAILURE;
    };

    let default_branch = env::var("FLYWHEEL_DEFAULT_BRANCH").ok();
    match classify_raw_command_text(command_text, default_branch.as_deref()) {
        Verdict::Safe => println!("safe"),
        Verdict::Destructive(category) => println!("{}", category.as_str()),
    }
    ExitCode::SUCCESS
}
