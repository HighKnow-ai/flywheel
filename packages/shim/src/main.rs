//! D-51/D-55's PATH shim binary. This binary is deliberately NOT built or invoked by cargo under
//! the names `git` or `rm` — `flywheel_core::shim::install_for_run` creates the on-disk entries
//! named `git` and `rm` (or `git.exe`/`rm.exe`) at spawn time by hard-linking/copying this
//! compiled binary. Dispatch reads `argv[0]` (never the cargo package/binary name) so both
//! shadowed names run the exact same compiled binary without a second build target. The
//! publishing tools `npm`, `cargo` and `gh` are shadowed the same way when the supervisor finds
//! them (`FLYWHEEL_REAL_NPM`/`_CARGO`/`_GH`), so `npm publish`, `cargo publish`, `gh pr merge` and
//! `gh release` reach the Gated-action deny-list too; every other invocation of them is `exec`ed
//! straight through.
//!
//! **The deny-list decides against the session** (`flywheel_core::destructive::classify_in`): the
//! Story's own branch and worktree (`FLYWHEEL_STORY_BRANCH`, `FLYWHEEL_WORKTREE_PATH`), the
//! default branch, the working directory, and — for `rebase`/`filter-branch` only — the branch the
//! real git reports checked out. Everything that is not a Gated action runs without asking.
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
//! **`send_notice` (plan 03-13, D-53): the shim's own "still retrying"/"I gave up" reports.**
//! Fire-and-forget, over the SAME `FLYWHEEL_PERMISSION_SOCKET` the destructive-action gate above
//! already opens a fresh connection to — 03-CONTEXT.md is explicit that the shim route through
//! the existing permission channel rather than inventing a second answering surface, and a notice
//! is the same shim talking to the same session. This is the ONE place in this binary where
//! failure is swallowed by construction rather than surfaced: a notice is a feed nicety, and a
//! broken or absent socket must never delay, fail or alter the git invocation it is reporting on
//! (T-03-13-02). `send_notice` never blocks waiting for an answer either — unlike
//! `request_permission` above, it writes its one line and returns without reading anything back,
//! because a notice has no answer to wait for.
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
//! destructive names) and never executes anything. **Its output is unchanged by plan 03-19** — see
//! `--classify-invocation` below, which is that plan's replacement runtime caller.
//!
//! **`--classify-invocation <text>` (plan 03-19 Task 1, narrowed by plan 03-20 Task 1):** checked
//! alongside `--classify-command`, before the `argv[0]`-stem dispatch, and reaches the SAME
//! `classify_raw_command_text`. Reports one thing more than `--classify-command` does:
//! `invokedBareName`, which is now TWO facts ANDed together, not one — the fact `pretooluse-hook.ts`
//! needs to decide whether the shim's own `PATH`-shadowed directory could ever have intercepted this
//! invocation at all:
//!
//! 1. the destructive segment's own program token names no path (no `/` in its raw token, after
//!    skipping any leading `NAME=VALUE` assignment tokens); AND
//! 2. nothing ELSEWHERE in the raw command text can pre-empt bash's own `PATH` search before it
//!    ever gets there — no shell function/alias/hash-table definition shadowing the name, and no
//!    `PATH` reassignment (`text_can_shadow_path_resolution`, plan 03-20/CR-01).
//!
//! Fact 1 alone is what plan 03-19 shipped; CR-01 found bash resolves functions and aliases (and a
//! `PATH=` prefix) BEFORE it ever performs a `PATH` search at all, so a token with no `/` can still
//! never reach this shim's shadow entry. `invokedBareName` now means "this shim's own shadowed
//! directory would actually be reached for this invocation", not merely "the token itself names no
//! path". Emits one line of JSON on stdout
//! (`{"category":"branch-deletion","program":"git","invokedBareName":true}` for a destructive
//! verdict) rather than a single word, so the shape is self-describing and can gain fields later
//! without breaking its reader. A missing or unreadable argument prints nothing to stdout and
//! exits non-zero, exactly as `--classify-command` does. After plan 03-19,
//! `pretooluse-hook.ts:112` calls this mode, not `--classify-command`. **The destructive arm above
//! is deliberately UNCHANGED by plan 03-24** — same three keys, same values — so every shipped
//! assertion about a destructive verdict keeps its present meaning.
//!
//! **The `safe` verdict (plan 03-24 Task 1, D-59/D-60/D-61):** `{"category":"safe"}` alone used to
//! be the whole shape — `pretooluse-hook.ts`'s safe branch trusted it unconditionally, with no
//! proof at all, while its non-safe branch already demanded a two-fact proof. That asymmetry let
//! eight ordinary launcher shapes (`sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`,
//! `setsid`) pass with strictly less scrutiny than a bare `git push --force`
//! (`03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`). The safe verdict now ALSO carries
//! `textCanShadowPathResolution` and `namesGatedProgram`:
//!
//! - `textCanShadowPathResolution` is the boolean OR of `text_can_shadow_path_resolution` (the
//!   pre-existing, whole-TOKEN scan `invoked_bare_name` already relies on, evaluated over both the
//!   raw text and its C1 quote-removed form), `raw_text_can_shadow_path_resolution` (the SAME six
//!   keywords, matched against the RAW text and its quote-removed form instead — the raw form
//!   exists because `tokenize_shell_words` returns an entire single-quoted `sh -c '…'` payload as
//!   ONE token, so a whole-token comparison can never see a `function`/`alias`/`eval`/… keyword
//!   hiding inside it), and `raw_text_word_formation_is_indeterminate` (plan 03-30's C3). **After
//!   plan 03-30's round-five correction, this field's `true` means one of two different things:**
//!   a shadow construct is genuinely PRESENT in the text (quote-removed or not), OR the scan
//!   CANNOT DETERMINE what words the text forms (a `$`, a backtick, or a letter-adjacent glob) and
//!   therefore refuses to report an absence it cannot prove. Its `false` is a claim of PROVEN
//!   absence, and that claim is sound only for DETERMINATE text — see
//!   the retired trust-boundary doc's C1-C4 contract for the exact scope.
//! - `namesGatedProgram` is `text_names_gated_program`: does the raw text (or its C1 quote-removed
//!   form) name one of the two programs `install_for_run` shadows (`git`, `rm`)? Not enumeration —
//!   that pair is closed and owned by another module entirely.
//!
//! `pretooluse-hook.ts`'s safe branch denies only when BOTH are true — text that can shadow PATH
//! resolution (or whose word formation cannot be determined) AND names a program this shim gates —
//! so `source .venv/bin/activate && pytest` (shadows, names neither) still defers, while a
//! shell-function shadow naming `git` does not, wherever it sits in the text, quoted or not (D-61).
//! Both fail-closed early returns of `classify_raw_command_text` (empty text, an `Unresolvable`
//! segment) report both fields `true` — the most restrictive reading, same discipline as the
//! destructive arm's own fail-closed shape.
//!
//! **What this binary is trusted to prove, and what it structurally cannot see, is recorded in
//! the retired trust-boundary doc** (D-62 item 3; superseded by ADR 0001, still in git history).

use std::env;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Output};

use flywheel_core::destructive::{
    classify_in, DestructiveCategory, GateContext, Verdict, DEFAULT_BRANCH_ENV, STORY_BRANCH_ENV, WORKTREE_ENV,
};

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

    // Task 3 (plan 03-07) / Task 1 (plan 03-19): checked BEFORE the argv[0]-stem dispatch below —
    // neither classify mode ever dispatches to a real binary, and neither is ever routed through a
    // shadowed name.
    if args.get(1).and_then(|a| a.to_str()) == Some("--classify-command") {
        return run_classify_command(args.get(2));
    }
    if args.get(1).and_then(|a| a.to_str()) == Some("--classify-invocation") {
        return run_classify_invocation(args.get(2));
    }
    if args.get(1).and_then(|a| a.to_str()) == Some("--gate-push") {
        return run_gate_push(&args[2..]);
    }

    let invoked_stem = args
        .first()
        .and_then(|argv0| Path::new(argv0).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned());

    match invoked_stem.as_deref() {
        Some("git") => run_git(&args[1..]),
        Some("rm") => run_rm(&args[1..]),
        Some(name @ ("npm" | "cargo" | "gh")) => run_passthrough(name, &args[1..]),
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

/// The session context the deny-list decides against, read from the environment Flywheel set at
/// spawn: the default branch, the Story's own branch and worktree, this process's working
/// directory, and a lookup of the checked-out branch that asks the real git (only ever called for
/// `rebase` and `filter-branch`).
fn gate_context() -> GateContext {
    let non_empty = |name: &str| env::var(name).ok().filter(|value| !value.is_empty());
    let real_git = resolve_real_git_from_env().ok();
    GateContext {
        default_branch: non_empty(DEFAULT_BRANCH_ENV),
        story_branch: non_empty(STORY_BRANCH_ENV),
        worktree: non_empty(WORKTREE_ENV).map(PathBuf::from),
        cwd: env::current_dir().ok(),
        head_branch: real_git.map(|real_git| {
            Box::new(move |dir: &Path| {
                let output = Command::new(&real_git)
                    .arg("-C")
                    .arg(dir)
                    .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
                    .output()
                    .ok()?;
                let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (output.status.success() && !branch.is_empty()).then_some(branch)
            }) as Box<dyn Fn(&Path) -> Option<String>>
        }),
    }
}

/// `npm`, `cargo` and `gh`: gate the publishing subcommands, then replace this process with the
/// real binary named by `FLYWHEEL_REAL_<NAME>` so output streams and signals behave exactly as a
/// direct invocation would.
fn run_passthrough(name: &str, forwarded_args: &[OsString]) -> ExitCode {
    use std::os::unix::process::CommandExt;

    let var_name = format!("FLYWHEEL_REAL_{}", name.to_ascii_uppercase());
    let real_bin = match resolve_real_binary_from_env(&var_name) {
        Ok(path) => path,
        Err(message) => {
            eprintln!("flywheel-shim: {message}");
            return ExitCode::FAILURE;
        }
    };

    let string_args = os_args_to_strings(forwarded_args);
    if let Some(exit_code) = destructive_gate(name, &string_args) {
        return exit_code;
    }

    // `arg0(name)` keeps a multiplexing binary (rustup's `cargo` proxy) dispatching as `name`.
    let err = Command::new(&real_bin).arg0(name).args(forwarded_args).exec();
    eprintln!("flywheel-shim: failed to exec real {name} at {real_bin:?}: {err}");
    ExitCode::FAILURE
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

/// D-53/T-03-13-02: send ONE fire-and-forget notice line on the permission socket the session
/// already has open — never a second answering surface, per this file's own module doc comment.
/// `kind` is either `"git_retry"` (sent before each backoff sleep) or `"git_lock_exhausted"` (sent
/// once, after the final failed attempt); `payload` carries that notice's own fields (attempt/max,
/// or the total attempt count) alongside `repository`/`command`. This function's whole body is
/// deliberately failure-swallowing by construction — no `?` operator and no `unwrap` appear
/// anywhere below: every step that can fail returns early through a plain `let ... else { return
/// }` guard instead, because a notice grants nothing and a broken or absent socket must never
/// delay, fail or alter the git invocation it is reporting on.
fn send_notice(kind: &str, mut payload: serde_json::Map<String, serde_json::Value>) {
    let Some(socket_path) = env::var_os("FLYWHEEL_PERMISSION_SOCKET") else {
        return;
    };
    let Some(run_id) = env::var_os("FLYWHEEL_RUN_ID") else {
        return;
    };
    let Ok(mut stream) = UnixStream::connect(&socket_path) else {
        return;
    };

    payload.insert("kind".to_string(), serde_json::Value::String(kind.to_string()));
    payload.insert(
        "runId".to_string(),
        serde_json::Value::String(run_id.to_string_lossy().into_owned()),
    );
    let mut line = serde_json::Value::Object(payload).to_string();
    line.push('\n');
    let _ = stream.write_all(line.as_bytes());
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
fn destructive_gate(program: &str, string_args: &[String]) -> Option<ExitCode> {
    let verdict = classify_in(program, string_args, &gate_context());
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

/// `--gate-push <category-name> <token>...` (plan 12-04 Task 1): checked BEFORE the `argv[0]`-stem
/// dispatch, alongside the two `--classify-*` modes above — git's own `pre-push` hook (`packages/
/// core/src/git_hooks.rs`) invokes the shim binary under its own filename, so the stem `match`
/// would otherwise reach the "refusing to run — invoked as …" arm and never see this flag.
///
/// Reuses the EXISTING `request_permission`/`print_denied` unchanged — this mode contains no
/// socket connection, request construction, or JSON serialization of its own, and never resolves
/// `FLYWHEEL_REAL_GIT`, never resolves `FLYWHEEL_REAL_RM`, and never execs anything. Its whole job
/// is to turn a category name plus a handful of tokens describing a git push into exactly the same
/// permission round trip `destructive_gate` already performs for an intercepted `git`/`rm`
/// invocation (D-55/D-58's fresh-connection, no-deadline contract lives there, not here).
fn run_gate_push(args: &[OsString]) -> ExitCode {
    let Some(category_name) = args.first().and_then(|a| a.to_str()) else {
        eprintln!("flywheel-shim: --gate-push requires a category name as its first argument");
        return ExitCode::FAILURE;
    };
    let Some(category) = DestructiveCategory::from_str_name(category_name) else {
        eprintln!("flywheel-shim: --gate-push received an unrecognised category name: {category_name:?}");
        return ExitCode::FAILURE;
    };

    let tokens = os_args_to_strings(&args[1..]);
    if tokens.is_empty() {
        eprintln!(
            "flywheel-shim: --gate-push requires at least one token describing the git command being gated"
        );
        return ExitCode::FAILURE;
    }

    match request_permission("git", &tokens, category) {
        PermissionOutcome::Allow => ExitCode::SUCCESS,
        PermissionOutcome::Deny => {
            print_denied(category);
            ExitCode::FAILURE
        }
        PermissionOutcome::Error(message) => {
            eprintln!("flywheel-shim: {message}");
            ExitCode::FAILURE
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
    if let Some(exit_code) = destructive_gate("git", &string_args) {
        return exit_code;
    }

    let command_text = reconstruct_command_text("git", &string_args);
    // Resolved ONCE and reused by both notices below (D-53) — the retry notice and the
    // exhaustion notice/contention record must all name the exact same repository string.
    let repository = env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "<unresolved cwd>".to_string());

    let mut last_output: Option<CapturedOutput> = None;
    let retry_result = flywheel_core::git_retry::with_lock_retry_notify(
        &command_text,
        |_attempt| {
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
        },
        |next_attempt, max_attempts| {
            // D-53/UI-SPEC "Git lock-retry transient row": one fire-and-forget notice per
            // backoff sleep, never on a first-attempt success (this hook is never called for
            // one) and never on the final exhausting attempt (the exhaustion branch below sends
            // its own, distinct notice instead).
            let mut payload = serde_json::Map::new();
            payload.insert("attempt".to_string(), serde_json::json!(next_attempt));
            payload.insert("max".to_string(), serde_json::json!(max_attempts));
            payload.insert("repository".to_string(), serde_json::json!(repository));
            payload.insert("command".to_string(), serde_json::json!(command_text));
            send_notice("git_retry", payload);
        },
    );

    match retry_result {
        Ok(_outcome) => forward_and_exit(last_output),
        Err(err) => {
            if let Some(exhausted) = err.downcast_ref::<flywheel_core::git_retry::LockExhausted>() {
                write_contention_record(&repository, &command_text, exhausted.attempts);
                let mut payload = serde_json::Map::new();
                payload.insert("repository".to_string(), serde_json::json!(repository));
                payload.insert("command".to_string(), serde_json::json!(command_text));
                payload.insert("attempts".to_string(), serde_json::json!(exhausted.attempts));
                send_notice("git_lock_exhausted", payload);
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
    if let Some(exit_code) = destructive_gate("rm", &string_args) {
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

/// True when `token` is a leading `NAME=VALUE` shell assignment: its first `=` is preceded by a
/// non-empty name matching `[A-Za-z_][A-Za-z0-9_]*`. `--flag=value` and `/usr/bin/x=y` are NOT
/// assignments — a `-` or `/` cannot open (or appear in) a valid shell identifier — so this can
/// never misclassify a real program token or flag as an assignment (plan 03-20 Task 1(b)).
fn is_assignment_token(token: &str) -> bool {
    let Some(eq_pos) = token.find('=') else {
        return false;
    };
    let name = &token[..eq_pos];
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Outcome of resolving a segment's own program token — used only by `classify_raw_command_text`.
enum ProgramResolution {
    /// No destructive program token at all in this segment — only assignments/wrappers with
    /// nothing following, `command -v`/`-V` naming something to describe rather than run, or an
    /// empty segment. Contributes nothing to classification, as if the segment were absent.
    None,
    /// The program token was found at this index.
    Found(usize),
    /// A wrapper's own argument shape makes it impossible to safely determine what (if anything)
    /// this segment executes. Under the Gated-action deny-list (ADR 0001) the segment contributes
    /// no verdict, and the caller reports both shadow facts `true` for the whole text, mirroring
    /// the empty-text path in `classify_raw_command_text` (coordinator review, round 4, as
    /// narrowed by ADR 0001). Two shapes produce this: `env -S STRING` (GNU) — `-S`
    /// splits its single string argument into an entirely new argument list, shell-style,
    /// including possible NAME=VALUE/`PATH=` assignments and even further flags, which this
    /// pragmatic tokenizer cannot safely re-parse a second time — and any OTHER, unrecognised
    /// `env` flag, which defaults to fail-closed rather than being silently skipped as though
    /// harmless. That default is the point: three consecutive findings (CR-01, then
    /// `command`/`builtin`, then this one) were each produced by a wrapper token this file had
    /// not yet learned about being treated as harmless-by-omission. An unrecognised `env` flag
    /// (BSD's `-P altpath`, `-C altwd`, `-0`, `-v`, or any future addition to either `env`
    /// implementation) now fails closed instead of silently becoming the assumed program name.
    ///
    /// **Reached from TWO passes as of plan 03-32 (round seven):** `classify_raw_command_text`'s
    /// segment loop resolves this variant once over the segment's RAW `tokenize_shell_words`
    /// output (the pass this doc comment describes above, unchanged), and once more over the
    /// SAME segment's `shell_quote_removed` output, mirroring the safe-verdict's own C1-C4 retry
    /// discipline. The raw pass alone is positional and single-pass: it recognises the wrapper
    /// token `env` by exact string equality at a segment's own leading position, so a
    /// backslash-split `env` (`e\nv`, round six) never equals the literal string `env` and the
    /// wrapper is never recognised at all — the second, quote-removed pass is what catches it.
    /// (Round seven's OTHER half — an `env` wrapper nested inside a launcher's opaque quoted
    /// payload, e.g. `sh -c 'env -S "…"'` — is not reachable by retrying THIS segment's own
    /// tokenization at all, since the whole payload is one opaque token to both passes; that half
    /// is closed instead by `raw_text_names_path_defeating_wrapper`'s (C6, plan 03-35, superseding
    /// round seven's C5) presence-anywhere scan, feeding only `text_can_shadow`, never this
    /// resolution.)
    Unresolvable,
}

/// Resolve the index of a segment's own program token, skipping past constructs that shift where
/// the "real" program name sits in `tokens` without themselves being that program:
///
/// - any leading run of `NAME=VALUE` shell assignment tokens (`PATH=/usr/bin git …` → `git`); and
/// - a leading `env` wrapper token, plus its own recognised flags and leading `NAME=VALUE`
///   argument tokens (`env PATH=/usr/bin git …` → `git`) — `env`'s own PATH-search bypass
///   (measured during 03-20 planning: `PATH=/usr/bin` alone does not defeat the shim, because the
///   assignment is scoped to the single command that follows via a real `PATH` search, but `env`
///   performs that same search itself over its OWN environment, and if `env`'s environment
///   carries a `PATH=` override — via `env PATH=/usr/bin …` — the search bypasses this shim's
///   shadowed directory exactly as a direct assignment does; `env` is unwrapped so `PATH=` inside
///   its own argument list is visible to `classify` and `text_can_shadow_path_resolution` the same
///   way a shell-level assignment is). `env`'s own flags (coordinator review, round 4 — covers
///   both BSD's and GNU's option sets, since this classifier runs on either):
///     - `--` ends `env`'s own option processing; whatever follows is resolved exactly as if `--`
///       were never there (`env -- git push --force` → `git`).
///     - `-i`/`--ignore-environment` clears the ENTIRE environment (including `PATH`) before the
///       target runs — the target may still be findable if `env`'s own remaining NAME=VALUE
///       arguments re-add a `PATH`, but the shim's OWN shadow directory is never on that
///       from-scratch `PATH` — `command -p`'s exact class. Unwrapped normally (the real program's
///       category is still reported), but ALSO registered as a global
///       `text_can_shadow_path_resolution` trigger (below) so `invokedBareName` is forced `false`.
///     - `-u NAME`/`--unset=NAME` removes exactly one variable. When `NAME` is literally `PATH`
///       this is `-i`-equivalent (same trigger, below) — cheap and exact to detect, since it is a
///       plain token/exact-string comparison, not a guess. Any OTHER `NAME` leaves `PATH` intact,
///       so the shim is still reached exactly as an unwrapped `env` would be — no trigger.
///     - `-S STRING`/`--split-string(=STRING)` and any OTHER, unrecognised `-`-prefixed token
///       produce [`ProgramResolution::Unresolvable`] immediately (see its own doc comment) rather
///       than treating the flag or its argument as the program; and
/// - a leading `command` wrapper token, plus its own `-p`/`-v`/`-V` flags and any `NAME=VALUE`
///   tokens that follow it (`command git push --force` → `git`; `command -p git push --force` →
///   `git`) — `command`'s whole purpose is to force name resolution PAST shell functions/aliases,
///   so the word `command` itself is never the program being run (03-REVIEW.md new CR-01, round
///   2). `command`'s own flags never take a separate argument, so a run of `-`-prefixed tokens
///   immediately following it is safe to skip PURELY FOR TOKENIZATION — but `-v`/`-V` carry a
///   DIFFERENT security property than `-p` (and than no flag at all), handled specially below:
///   they make `command` a QUERY that never executes its argument at all, so this function
///   returns [`ProgramResolution::None`] (no program token in this segment) the instant either is
///   seen, rather than continuing on to treat the name being described as the program invoked
///   (coordinator review, round 3: `command -v git` was misclassified as an invocation of `git` in
///   the round-2 fix, which broke `scripts/uat/uat-05-concurrent-commits.mjs`'s own
///   `command -v git` resolution probe — see that file and `scripts/uat/README.md`); and
/// - a leading `builtin` wrapper token (`builtin git push --force` → `git`) — same reasoning:
///   `builtin` names a shell builtin to invoke, never the destructive program itself.
///
/// These four constructs (assignments, `env`, `command`, `builtin`) can nest and repeat in any
/// order and combination — `command env git …`, `env command git …`, `PATH=/tmp command git …` —
/// so this loops until none of them match at the current position, rather than checking each
/// exactly once. Each iteration MUST advance `idx` by at least one token (the loop only continues
/// on a positive match, or returns directly), so this always terminates.
fn resolve_segment_program_index(tokens: &[String]) -> ProgramResolution {
    let mut idx = 0;
    loop {
        while idx < tokens.len() && is_assignment_token(&tokens[idx]) {
            idx += 1;
        }
        match tokens.get(idx).map(String::as_str) {
            Some("env") => {
                idx += 1;
                loop {
                    while idx < tokens.len() && is_assignment_token(&tokens[idx]) {
                        idx += 1;
                    }
                    match tokens.get(idx).map(String::as_str) {
                        Some("--") => {
                            idx += 1;
                            break;
                        }
                        Some("-i") | Some("--ignore-environment") => {
                            idx += 1;
                        }
                        Some("-u") | Some("--unset") => {
                            idx += 1;
                            if idx >= tokens.len() {
                                // `-u`/`--unset` with no NAME argument at all — malformed, and
                                // there is nothing left to classify as the program either.
                                return ProgramResolution::Unresolvable;
                            }
                            if token_word_formation_is_indeterminate(&tokens[idx]) {
                                // Deviation (Rule 1, plan 03-35 Task 3): the NAME argument's word
                                // formation cannot be determined, so whether it names `PATH` is
                                // undecidable — break WITHOUT consuming it, leaving it in place to
                                // be resolved (deliberately misresolved) as this segment's own
                                // program token. `destructive::classify` reports `Safe` for an
                                // unrecognised name, and `raw_text_names_path_defeating_wrapper`
                                // (C6) independently reports `textCanShadowPathResolution: true`
                                // for the same text via its own matching NAME-position check.
                                // Unlike the flag position above, the NAME position carries NO
                                // dash-carrying requirement — a variable name is not dash-prefixed,
                                // so any indeterminate token here is genuinely undecidable.
                                break;
                            }
                            idx += 1; // consume NAME itself (its identity is checked separately,
                                      // by text_can_shadow_path_resolution, for the PATH case)
                        }
                        Some(t) if t.starts_with("--unset=") => {
                            let remainder = &t["--unset=".len()..];
                            if token_word_formation_is_indeterminate(remainder) {
                                // Same undecidable-NAME reasoning as the `-u NAME` arm above,
                                // applied to the `--unset=NAME` single-token spelling.
                                break;
                            }
                            idx += 1;
                        }
                        Some(t) if t == "-S" || t.starts_with("--split-string") => {
                            return ProgramResolution::Unresolvable;
                        }
                        Some(t) if t.starts_with('-') => {
                            // Any other/unrecognised env flag (BSD's -P/-C/-0/-v, or a future
                            // addition to either implementation) — do not guess what it does.
                            return ProgramResolution::Unresolvable;
                        }
                        _ => break,
                    }
                }
            }
            Some("command") => {
                idx += 1;
                while idx < tokens.len()
                    && (tokens[idx].starts_with('-') || is_assignment_token(&tokens[idx]))
                {
                    if tokens[idx] == "-v" || tokens[idx] == "-V" {
                        return ProgramResolution::None;
                    }
                    idx += 1;
                }
            }
            Some("builtin") => {
                idx += 1;
            }
            _ => break,
        }
    }
    if idx < tokens.len() {
        ProgramResolution::Found(idx)
    } else {
        ProgramResolution::None
    }
}

/// True when the raw command TEXT contains any construct that can pre-empt bash's `PATH` search
/// for a later bare-name invocation — a shell function definition, an alias, a hashed path, a
/// pulled-in definition, a `PATH` reassignment (plan 03-20/CR-01), a `builtin` wrapper, a
/// `command -p` invocation (03-REVIEW.md new CR-01, round 2), or an `env -i`/`env -u PATH`
/// invocation (coordinator review, round 4). `command -v`/`-V` and `env -S`/an unrecognised `env`
/// flag are deliberately NOT handled here — they never execute their argument at all (or cannot be
/// safely determined to), so `resolve_segment_program_index` already removes that segment from
/// classification entirely before `classify` (or this function) is ever consulted about it (round
/// 3: grouping a report-only or unparseable flag with an execution-defeating one here would repeat
/// the exact tokenization-vs-security-property conflation round 2 made in the OTHER function).
/// Deliberately fires on PRESENCE anywhere in `text`, quoted or not, never on whether the
/// construct precedes the destructive segment: `split_top_level_segments` is itself only a
/// pragmatic approximation of shell grammar (see its own doc comment), so positional ordering is
/// too weak a foundation for a security decision here, and over-triggering costs only a
/// deny-instead-of-ask on a destructive command — the pre-03-19 behaviour — while under-triggering
/// costs an ungated force-push.
///
/// Triggers, each naming the resolution step it defeats:
/// - a `(` followed by optional whitespace then `)`, scanned over the raw characters — the shell
///   function definition shape (`git() {` and `git () {` both match; `$(git ...)` and `(cd sub &&
///   ...)` do not, because in both the character immediately after `(` is never `)`).
/// - a token equal to `function` — the paren-less function-definition form.
/// - a token equal to `alias` — alias expansion.
/// - a token equal to `hash` — bash's own command hash table (`hash -p`).
/// - a token equal to `eval`, `source`, or exactly `.` — arbitrary definitions pulled in from
///   elsewhere.
/// - a token equal to `builtin` — MEASURED: `builtin <prog>` looks `<prog>` up ONLY among actual
///   shell builtins, never performing a `PATH` search at all, so this shim's shadow entry can
///   never be reached for it — unlike `command`/`env` (below), which still route through a real
///   `PATH` search for anything that is not itself a builtin. `builtin` is unwrapped by
///   `resolve_segment_program_index` (so the real target's category is still reported, never
///   `Safe`), but is ALSO an unconditional trigger here, so `invokedBareName` is forced `false`
///   regardless of environment correctness (03-REVIEW.md new CR-01, round 2 — property 3).
/// - `command` immediately followed (among its own run of `-`-prefixed flag tokens) by a bare
///   `-p` — MEASURED (`command -p git …`): `-p` forces bash to search a hardcoded default `PATH`
///   (e.g. `/bin:/usr/bin`) that can never contain this shim's per-run shadow directory, an
///   unconditional bypass independent of how correctly the shim's own environment is wired.
///   Plain `command <prog>` (no `-p`) is deliberately NOT a trigger by itself: MEASURED, it still
///   bypasses only shell functions/aliases and performs a genuine `PATH` search for anything that
///   is not itself a builtin — exactly where this shim's shadow entry sits — so `invokedBareName`
///   for a bare `command git …` still reflects the ordinary case once
///   `resolve_segment_program_index` has unwrapped it to `git` (03-REVIEW.md new CR-01, round 2 —
///   property 1). `-v`/`-V` are NOT triggers here — see this function's own doc comment above and
///   `resolve_segment_program_index`'s handling of them, which removes the segment from
///   classification entirely (round 3: they only ever describe, never execute). (`command
///   <realbuiltin> …`, e.g. `command builtin git …`, is a rarer nested case this file does not
///   attempt to special-case further; see the module's own residual-gap framing.)
/// - `env` followed (before any program token, anywhere among its own recognised flags/assignments)
///   by `-i`/`--ignore-environment` — MEASURED (`env -i git …`): clears the ENTIRE environment,
///   including `PATH`, before the target runs, so the shim's own shadow directory can never be on
///   whatever `PATH` (if any) the target ends up seeing — the exact same "double failure" class as
///   `command -p` (coordinator review, round 4).
/// - `env` followed by `-u PATH` or `--unset=PATH` (exact token match on the name, never a guess)
///   — MEASURED: unsetting `PATH` specifically is `-i`-equivalent for this shim's purposes.
///   `-u`/`--unset` naming any OTHER variable is deliberately NOT a trigger: `PATH` survives
///   untouched, so the shim is reached exactly as a plain `env git …` would be.
/// - the substring `PATH=` anywhere in the text — defeats the `PATH` search itself, whether via a
///   leading assignment (`PATH=/usr/bin git …`) or `export PATH=…`.
///
/// Keyword triggers are whole-TOKEN equality over `split_top_level_segments`/`tokenize_shell_words`
/// — never substring matching — so `unaliased-thing` or a path component containing `hash` never
/// trips them.
fn text_can_shadow_path_resolution(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '(' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && chars[j] == ')' {
                return true;
            }
        }
        i += 1;
    }

    if text.contains("PATH=") {
        return true;
    }

    const KEYWORD_TRIGGERS: [&str; 6] = ["function", "alias", "hash", "eval", "source", "builtin"];
    for segment in split_top_level_segments(text) {
        let tokens = tokenize_shell_words(&segment);
        let mut i = 0;
        while i < tokens.len() {
            let token = &tokens[i];
            if token == "." || KEYWORD_TRIGGERS.contains(&token.as_str()) {
                return true;
            }
            if token == "command" {
                let mut j = i + 1;
                while j < tokens.len() && tokens[j].starts_with('-') {
                    if tokens[j] == "-p" {
                        return true;
                    }
                    j += 1;
                }
            }
            if token == "env" {
                // Mirrors resolve_segment_program_index's own env-flag walk (including its
                // two-token consumption of `-u NAME`/`--unset NAME`) closely enough to agree on
                // where each flag's own argument ends — a scan that stopped at an unrecognised
                // token here, mistaking a `-u`/`--unset` NAME argument for the program token,
                // would silently miss a LATER `-u PATH` in the same flag run (e.g.
                // `env -u FOO -u PATH git …`).
                let mut j = i + 1;
                loop {
                    while j < tokens.len() && is_assignment_token(&tokens[j]) {
                        j += 1;
                    }
                    match tokens.get(j).map(String::as_str) {
                        Some("--") => break,
                        Some("-i") | Some("--ignore-environment") => return true,
                        Some("-u") | Some("--unset") => {
                            if tokens.get(j + 1).map(String::as_str) == Some("PATH") {
                                return true;
                            }
                            j += 2; // consume the flag AND its NAME argument together
                        }
                        Some(t) if t.strip_prefix("--unset=") == Some("PATH") => return true,
                        Some(t) if t.starts_with('-') => j += 1,
                        _ => break,
                    }
                }
            }
            i += 1;
        }
    }

    false
}

/// Removes shell quoting and backslash-escaping from `text` with NO quoting-context tracking at
/// all — every `'` and every `"` character is dropped outright, and every backslash `\` is dropped
/// along with the character immediately following it, which is pushed verbatim (a trailing
/// backslash at the end of input is dropped with nothing following it). **C1 — quote removal,
/// performed context-free** (the retired trust-boundary doc): this is deliberately
/// unfaithful to any single shell's grammar. The text handed to this scanner may be re-parsed by a
/// NESTED shell at a depth this function has no way to know — inside an outer `sh -c '…'` payload,
/// for example — so a context-sensitive removal that correctly left a backslash literal inside
/// single quotes would MISS exactly the nested case round five reproduced (`e\val` splitting
/// `eval` inside an outer single-quoted payload). Over-triggering is the intended direction,
/// consistent with D-61's own recorded discipline.
fn shell_quote_removed(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '\'' | '"' => continue,
            '\\' => {
                if let Some(next) = chars.next() {
                    result.push(next);
                }
            }
            _ => result.push(c),
        }
    }
    result
}

/// True when `c` counts as an identifier character for this scanner's word-boundary checks — ASCII
/// alphanumeric or `_`. Shared by [`raw_text_contains_word`] (word-boundary checks) and
/// [`raw_text_word_formation_is_indeterminate`] (glob-adjacency checks, C3) so the two scanners
/// agree on what counts as a "letter run" rather than drifting apart.
fn is_identifier_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// True when `word` appears anywhere in `chars` with a non-identifier character (or a text
/// boundary — start/end of the slice) on BOTH sides, where an identifier character is ASCII
/// alphanumeric or `_` ([`is_identifier_char`]). The shared raw-text matching primitive
/// [`text_names_gated_program`] and [`raw_text_can_shadow_path_resolution`] both build on: unlike
/// the whole-TOKEN equality `text_can_shadow_path_resolution` uses, this scans the RAW characters
/// directly, so it can see inside a single-quoted payload `tokenize_shell_words` would otherwise
/// return as one opaque token (plan 03-24, D-61).
fn raw_text_contains_word(chars: &[char], word: &str) -> bool {
    let word_chars: Vec<char> = word.chars().collect();
    let word_len = word_chars.len();
    if word_len == 0 || chars.len() < word_len {
        return false;
    }
    for start in 0..=(chars.len() - word_len) {
        if chars[start..start + word_len] != word_chars[..] {
            continue;
        }
        let before_ok = start == 0 || !is_identifier_char(chars[start - 1]);
        let after_idx = start + word_len;
        let after_ok = after_idx == chars.len() || !is_identifier_char(chars[after_idx]);
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// True when `token`'s own characters contain `word` with a non-identifier character (or a token
/// boundary) on both sides — [`raw_text_contains_word`] applied to a single token's own character
/// slice instead of the whole raw text. Exact token equality (`token == word`) is the special case
/// where the token IS the word; this is the general, promoted form of wrapper-token recognition
/// **C6** (the retired trust-boundary doc) is built on — the word-boundary treatment
/// `git`/`rm` ([`text_names_gated_program`]) and the six `KEYWORD_TRIGGERS`
/// ([`raw_text_can_shadow_path_resolution`]) have had since plan 03-24, which `env`/`command`
/// lacked until round eight. A path prefix (`/usr/bin/env`) is recognised because `/` is not an
/// identifier character ([`is_identifier_char`]), so it counts as a boundary exactly like a space
/// or a quote would.
fn token_names_word(token: &str, word: &str) -> bool {
    let chars: Vec<char> = token.chars().collect();
    raw_text_contains_word(&chars, word)
}

/// True when `token`'s own word formation cannot be determined — reuses **C3**'s own named
/// character set (`$`, a backtick, `*`, `?`, `[`, `{`, `}`,
/// the retired trust-boundary doc) deliberately, so the two scanners can never drift
/// apart: a character that can complete or reassemble a keyword in the middle of ordinary text is
/// equally capable of reassembling a wrapper's own flag or `--unset` NAME argument. Unlike
/// [`raw_text_word_formation_is_indeterminate`] (C3), this makes NO adjacency test: at a flag or
/// NAME position there is no letter run to weld onto — the whole token IS the thing being
/// determined, not a fragment of a longer word.
fn token_word_formation_is_indeterminate(token: &str) -> bool {
    token.contains('$')
        || token.contains('`')
        || token.contains('*')
        || token.contains('?')
        || token.contains('[')
        || token.contains('{')
        || token.contains('}')
}

/// D-59/D-61 (plan 03-24): does the raw command TEXT name one of the two programs
/// `flywheel_core::shim::install_for_run` shadows — `git` or `rm`, fixed by
/// `shadowed_git_entry_name`/`shadowed_rm_entry_name`? This is NOT enumeration: the pair is
/// closed and defined by another module entirely, which is why D-59's ban on lengthening the
/// launcher token list in `resolve_segment_program_index` does not reach it.
///
/// Matching discipline, chosen to over-trigger rather than under-trigger per D-61's own note:
/// scans the RAW text, quoted regions included, case-sensitively, via [`raw_text_contains_word`]
/// — a match requires a non-identifier character (or a text boundary) on both sides of the name.
/// That boundary rule is what keeps `digit`, `legitimate`, `format` and `warm` from matching
/// while `sh -c 'git push'`, `.gitignore`, `/usr/bin/git`, `git-lfs` and `xargs rm` all do. A
/// false positive costs one deny on a command that mentions a gated program; a false negative
/// costs an ungated force-push.
///
/// **Soundness class, narrowed by CR-01/plan 03-33
/// (the retired trust-boundary doc):** a `false` means neither `git` nor `rm` appears
/// as a word-bounded literal in the raw text or in [`shell_quote_removed`]'s output — and NOTHING
/// MORE. It does NOT mean the shell will not FORM one of those words: `{gi,}t push --force`
/// classifies `namesGatedProgram:false` (no contiguous literal `git`), even though bash resolves
/// the first word to the literal `git` via ordinary brace expansion this function never models —
/// confirmed live, `echo {gi,}t push --force` prints `git t push --force`. C3's brace-adjacency
/// trigger (`raw_text_word_formation_is_indeterminate`) does NOT repair this claim: it feeds
/// `textCanShadowPathResolution`, never this function's own `namesGatedProgram`. Folding
/// indeterminacy into THIS function was considered and rejected — it would make an indeterminate
/// `eval "$(direnv hook bash)"` report a gated program and start denying, destroying the Group 4
/// falsifiability companions the whole corpus depends on. This residual is carried, not silently
/// closed — see the trust-boundary document's `## Named residuals` table.
///
/// **C2 — union matching over the raw text and the quote-removed text**
/// (the retired trust-boundary doc): the name is matched against BOTH the raw
/// characters and [`shell_quote_removed`]'s output, and a match in either form is a match — round
/// five's `g""it` splits the name only in the raw form, and the quote-removed form is what catches
/// it. `raw_text_contains_word`'s own boundary rule is preserved over BOTH forms, since deleting
/// quote/backslash characters can only join a word, never split one — the union never loses a
/// match the raw form already had.
fn text_names_gated_program(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let quote_removed: Vec<char> = shell_quote_removed(text).chars().collect();
    ["git", "rm"].iter().any(|name| {
        raw_text_contains_word(&chars, name) || raw_text_contains_word(&quote_removed, name)
    })
}

/// D-59/D-61 (plan 03-24): a raw-text companion to [`text_can_shadow_path_resolution`], used ONLY
/// by the safe verdict's reported `textCanShadowPathResolution` field — never by
/// `invoked_bare_name`, which keeps exactly its pre-existing token-based meaning. Applies the SAME
/// six shadow-construct keywords the existing scan uses — `function`, `alias`, `hash`, `eval`,
/// `source` and `builtin` — but matches them against the RAW text via [`raw_text_contains_word`]
/// instead of as whole tokens over `split_top_level_segments`/`tokenize_shell_words`. Deliberately
/// EXCLUDES the bare `.` trigger: unbounded in raw text it would match every path and every
/// version number, over-triggering past the point of usefulness. The existing `()`-character scan
/// and the `PATH=` substring check inside `text_can_shadow_path_resolution` already fire on raw
/// text and need no raw-text companion here.
///
/// This function exists because of a measured tokenizer property: `tokenize_shell_words` strips
/// quotes and only splits on whitespace OUTSIDE them, so the entire single-quoted payload of
/// `sh -c '…'` arrives as ONE token, and no whole-token keyword comparison can ever see inside it.
/// D-61's stated discipline is to fire on presence anywhere in the text, quoted or not, so the
/// safe branch needs this raw form.
///
/// **C2 — union matching over the raw text and the quote-removed text**
/// (the retired trust-boundary doc): each keyword is matched against BOTH the raw
/// characters and [`shell_quote_removed`]'s output, and a match in either form is a match — round
/// five's `e""val`/`e\val` split the keyword only in the raw form, and the quote-removed form is
/// what catches it.
fn raw_text_can_shadow_path_resolution(text: &str) -> bool {
    const KEYWORD_TRIGGERS: [&str; 6] = ["function", "alias", "hash", "eval", "source", "builtin"];
    let chars: Vec<char> = text.chars().collect();
    let quote_removed: Vec<char> = shell_quote_removed(text).chars().collect();
    KEYWORD_TRIGGERS.iter().any(|kw| {
        raw_text_contains_word(&chars, kw) || raw_text_contains_word(&quote_removed, kw)
    })
}

/// **C3 — indeterminate word formation reports "can shadow"**
/// (the retired trust-boundary doc, WR-03 ruling): a CLOSED, POSITIVE ENUMERATION of
/// four NAMED bash word-formation mechanisms — not a general inversion. Operates on
/// [`shell_quote_removed`]'s output and returns `true` when that text contains: (1) a `$` anywhere
/// (parameter expansion, command substitution, arithmetic expansion, ANSI-C `$'…'` quoting); (2) a
/// backtick anywhere (command substitution); (3) a `*`, `?` or `[` immediately adjacent — before OR
/// after — to an ASCII alphanumeric character or `_` ([`is_identifier_char`], shared with
/// [`raw_text_contains_word`] so the two scanners agree on what counts as a letter run) — pathname
/// globbing that can complete a keyword; or (4) — added by plan 03-33, closing CR-01 — a `{`
/// immediately PRECEDED BY an [`is_identifier_char`], or a `}` immediately FOLLOWED BY an
/// [`is_identifier_char`] — brace expansion that can weld its alternatives onto an adjacent letter
/// run (`al{i,}as` expands to `alias alas`, measured live to genuinely define a shell alias under
/// `expand_aliases`).
///
/// This enumeration explicitly does NOT cover tilde expansion, process substitution's own
/// `<(`/`>(` forms, or any future word-formation construct outside this named list. A mechanism
/// outside the four is a boundary failure (the retired trust-boundary doc's "The rule
/// for round six"), not a gap this function silently excuses.
///
/// This function never claims a shadow construct was FOUND — it reports that the scan CANNOT
/// DETERMINE what words the shell will form, and the field it feeds answers "cannot prove" rather
/// than "absent", which is the correction round five forced. The glob rule's purpose: a glob that
/// interrupts a run of letters can be completed into a keyword by a filename in the working
/// directory, while a glob sitting next to a dot or a slash is an ordinary path pattern and must
/// stay deferrable — or the gate would refuse `git add` on a wildcard (the WR-03 falsifiability
/// row: `git add *.rs` must still defer, proving C3 was not silently turned into a genuine
/// inversion).
///
/// The brace rule is DELIBERATELY ASYMMETRIC — `{` looks BACKWARD only, `}` looks FORWARD only —
/// unlike the glob rule's symmetric "before or after" test, and requires no comma or `..` inside
/// the group. This asymmetry is what keeps `git add src/{a,b}.rs` and `mkdir -p src/{a,b}`
/// determinate (their `{`/`}` sit next to `/` and `.`, never a letter) while still catching
/// `al{i,}as` and `{gi,}t`. A symmetric rule would fire on both of those ordinary path-brace
/// idioms; a comma requirement would need a matching-brace scan whose own soundness class would
/// then have to be written into the trust-boundary document — the parser this contract exists to
/// avoid. Accepted, priced friction from this asymmetric rule: `xargs -I{} rm {}` moves from
/// `false` to `true` because `{` immediately follows `I` — recorded here as a decision, not parsed
/// away with brace-group matching.
fn raw_text_word_formation_is_indeterminate(text: &str) -> bool {
    let quote_removed: Vec<char> = shell_quote_removed(text).chars().collect();
    if quote_removed.contains(&'$') || quote_removed.contains(&'`') {
        return true;
    }
    for (i, &c) in quote_removed.iter().enumerate() {
        if c != '*' && c != '?' && c != '[' {
            continue;
        }
        let before_is_letter = i > 0 && is_identifier_char(quote_removed[i - 1]);
        let after_is_letter = i + 1 < quote_removed.len() && is_identifier_char(quote_removed[i + 1]);
        if before_is_letter || after_is_letter {
            return true;
        }
    }
    for (i, &c) in quote_removed.iter().enumerate() {
        if c == '{' && i > 0 && is_identifier_char(quote_removed[i - 1]) {
            return true;
        }
        if c == '}' && i + 1 < quote_removed.len() && is_identifier_char(quote_removed[i + 1]) {
            return true;
        }
    }
    false
}

/// **C6 — a PATH-defeating wrapper token is recognised by word-boundary containment, over both
/// text forms** (the retired trust-boundary doc, plan 03-35, round eight): true when a
/// TOKEN containing a word-bounded `env` or `command` ([`token_names_word`]) appears ANYWHERE in
/// `text` — over both the raw form and [`shell_quote_removed`]'s output, the SAME C2 union C1-C5
/// already use — followed, among its own recognised flag run, by the wrapper's own PATH-defeating
/// or indeterminate flag. C6 SUPERSEDES round seven's C5 (`raw_text_names_opaque_env_reparse`,
/// superseded — see the retired trust-boundary doc's "Named residuals" table): C5
/// recognised the wrapper token by exact string equality, which four rounds in a row (five through
/// eight) each defeated by a fresh word-formation mechanism that produced the token without
/// producing the literal string — brace expansion (`{env,}`), a path prefix (`/usr/bin/env`). C6 is
/// a strict superset of C5 (token equality is the boundary-contained case where the token is
/// exactly the name), so every round-six and round-seven assertion keeps its meaning.
///
/// This function does NOT feed `invoked_bare_name` — C4's own rule is that only C1's quote removal
/// widens that fact, never a presence-anywhere scan. It feeds ONLY the safe verdict's own
/// `text_can_shadow` binding in [`classify_raw_command_text`].
///
/// **`env`'s flag walk**, mirroring `text_can_shadow_path_resolution`'s own `env` branch (and C5's
/// before it) so the scanners agree on where each flag's own argument ends, widened with the two
/// flags that function already recognised at the token level but could never see inside an opaque
/// payload, plus the fail-closed extension this round adds: leading `NAME=VALUE` assignment tokens
/// are skipped; `--` ends `env`'s own option processing (this occurrence's walk stops without
/// reporting `true`); `-i`/`--ignore-environment` reports `true` immediately (clearing the whole
/// environment, `PATH` included, is unconditionally PATH-defeating); `-u`/`--unset` reports `true`
/// when its NAME argument is a word-bounded `PATH` ([`token_names_word`]), otherwise consumes the
/// flag and its NAME argument and continues; a `--unset=NAME` token reports `true` under the same
/// NAME test on its own remainder, otherwise advances past it; `-S`/`--split-string` or any OTHER
/// unrecognised `-`-prefixed token reports `true` (C5's own opaque-reparse/unrecognised-flag
/// catch-all, unchanged); and — the fail-closed extension, C3's philosophy applied to a flag
/// position rather than a new idea — a token that is neither an assignment nor dash-prefixed, but
/// whose word formation [`token_word_formation_is_indeterminate`] cannot determine AND which itself
/// carries a `-` character, reports `true`: it stands where `env`'s own flag belongs and cannot be
/// read as a flag OR as a program name. The `-`-carrying requirement is what keeps
/// `env {git,} push --force` deferring (measured; `{git,}` bears no `-`, so it is a program token,
/// not a flag, and the real shell reaches this shim through an ordinary `PATH` search for it).
/// Anything else breaks out of THIS `env` occurrence's own walk (not the whole scan), and the outer
/// loop continues at the next token index, so a LATER, unrelated `env` occurrence in the same text
/// is still found.
///
/// **`command`'s flag walk**, new to C6 (C5 covered only `env`): a token equal to `-v` or `-V`
/// breaks the walk WITHOUT reporting `true` — these make `command` a QUERY that never executes its
/// argument at all, the exact distinction `resolve_segment_program_index`'s own round-3 correction
/// already records, and the reason `command -v git` — both a corpus Group 4 falsifiability
/// companion and a live probe inside `scripts/uat/uat-05-concurrent-commits.mjs` — must keep
/// deferring. A token equal to `-p` reports `true` (forces a hardcoded default `PATH` search that
/// can never contain this shim's shadow directory). A token satisfying both
/// [`token_word_formation_is_indeterminate`] and carrying a `-` reports `true`, the same
/// fail-closed extension as `env`'s walk. Any other dash-prefixed token or assignment advances past
/// it; anything else breaks this occurrence's own walk.
fn raw_text_names_path_defeating_wrapper(text: &str) -> bool {
    for form in [text.to_string(), shell_quote_removed(text)] {
        let tokens = tokenize_shell_words(&form);
        let mut i = 0;
        while i < tokens.len() {
            if token_names_word(&tokens[i], "env") {
                let mut j = i + 1;
                loop {
                    while j < tokens.len() && is_assignment_token(&tokens[j]) {
                        j += 1;
                    }
                    match tokens.get(j).map(String::as_str) {
                        Some("--") => break,
                        Some("-i") | Some("--ignore-environment") => {
                            return true;
                        }
                        Some("-u") | Some("--unset") => {
                            let names_path = tokens
                                .get(j + 1)
                                .is_some_and(|name| token_names_word(name, "PATH"));
                            if names_path {
                                return true;
                            }
                            j += 2;
                        }
                        Some(t) if t.starts_with("--unset=") => {
                            let remainder = &t["--unset=".len()..];
                            if token_names_word(remainder, "PATH") {
                                return true;
                            }
                            j += 1;
                        }
                        Some(t) if t == "-S" || t.starts_with("--split-string") => {
                            return true;
                        }
                        Some(t) if t.starts_with('-') => {
                            return true;
                        }
                        Some(t)
                            if token_word_formation_is_indeterminate(t) && t.contains('-') =>
                        {
                            return true;
                        }
                        _ => break,
                    }
                }
            } else if token_names_word(&tokens[i], "command") {
                let mut j = i + 1;
                loop {
                    match tokens.get(j).map(String::as_str) {
                        Some("-v") | Some("-V") => break,
                        Some("-p") => return true,
                        Some(t)
                            if token_word_formation_is_indeterminate(t) && t.contains('-') =>
                        {
                            return true;
                        }
                        Some(t) if t.starts_with('-') || is_assignment_token(t) => {
                            j += 1;
                        }
                        _ => break,
                    }
                }
            }
            i += 1;
        }
    }
    false
}

/// The result of classifying raw command text: the verdict itself, plus — when destructive — the
/// program name and bare-name status of the segment that produced it (plan 03-19 Task 1, narrowed
/// by plan 03-20 Task 1). Computed together so `--classify-invocation` needs no second scan of the
/// same text; `--classify-command` simply reads `.verdict` and ignores the rest, leaving its own
/// output byte-for-byte unchanged.
struct ClassifiedInvocation {
    verdict: Verdict,
    /// Present only when `verdict` is `Destructive`: the program stem of the destructive segment
    /// (`program_stem(first)` — the same resolution the shadowed `argv[0]` dispatch uses, after
    /// skipping any leading `NAME=VALUE` assignment tokens).
    program: Option<String>,
    /// Present only when `verdict` is `Destructive`: whether that segment's program token names no
    /// path (`!first.contains('/')`) AND nothing in the raw text can divert bash's name resolution
    /// away from a `PATH` search before reaching it (`!shadowable`). Both facts must hold for this
    /// to be `true` — the exact class the shim's own shadow entry could actually intercept at
    /// runtime (plan 03-20/CR-01: a shadowed `git` function or an overridden `PATH` never reaches
    /// the shim at all, even though the token itself has no `/`).
    ///
    /// **C4 — the bare-name fact resolves quoting but never refuses on indeterminacy**
    /// (the retired trust-boundary doc): `shadowable` is widened by C1's quote removal
    /// — `text_can_shadow_path_resolution` applied to BOTH the raw text and its quote-removed form
    /// — because a shadow keyword that survives quote removal genuinely defeats the `PATH` search
    /// Layer 2 depends on. It is deliberately NOT widened by C3's indeterminacy (a
    /// `$`/backtick/letter-adjacent glob): an expansion sitting in an ARGUMENT does not defeat a
    /// `PATH` search, and carrying indeterminacy into this fact would convert Layer 2's "ask a
    /// human" into Layer 1's "refuse" for an ordinary destructive command such as a force-push
    /// naming a branch through a variable — weakening the exact sentence AGNT-07 is written on.
    invoked_bare_name: bool,
    /// Reported only on the `Safe` verdict (plan 03-24, D-59/D-61): the boolean OR of
    /// `text_can_shadow_path_resolution` (over the raw text AND — since plan 03-30's C1 — its
    /// quote-removed form) and `raw_text_can_shadow_path_resolution` — whether ANYTHING in the raw
    /// command text, token-level or raw-quoted-payload, can pre-empt bash's own `PATH` search
    /// before it happens. Both fail-closed early returns below (empty text, an `Unresolvable`
    /// segment) set this `true` — the most restrictive reading. `shadowable` (used for
    /// `invoked_bare_name`, above) is ALSO widened by C1's quote removal, but this field alone is
    /// further widened by C3's indeterminate-word-formation predicate — see
    /// `ClassifiedInvocation::invoked_bare_name`'s own doc comment for why C4 keeps that predicate
    /// out of `shadowable`.
    text_can_shadow: bool,
    /// Reported only on the `Safe` verdict (plan 03-24, D-59/D-61): whether the raw command text
    /// names one of the two programs `install_for_run` shadows (`text_names_gated_program`). Both
    /// fail-closed early returns below set this `true` as well.
    names_gated_program: bool,
}

/// Classify raw bash command TEXT: split into top-level segments, classify each through the SAME
/// `destructive::classify_in` the shadowed dispatch uses, and return the first Gated verdict
/// found — `Safe` when no segment is a Gated action. The classifier is a deny-list (ADR 0001), so
/// text it cannot read is not a Gated action: empty text is `Safe`, and a segment whose wrapper
/// this tokenizer cannot resolve ([`ProgramResolution::Unresolvable`] — `env -S …`, an
/// unrecognised `env` flag) contributes nothing, exactly as an empty segment does. Both still
/// report the two shadow facts `true`, the most restrictive reading of what the text could do.
fn classify_raw_command_text(text: &str, ctx: &GateContext) -> ClassifiedInvocation {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return ClassifiedInvocation {
            verdict: Verdict::Safe,
            program: None,
            invoked_bare_name: false,
            text_can_shadow: true,
            names_gated_program: true,
        };
    }

    // Computed ONCE over the whole trimmed text, not per-segment: the shadowing constructs this
    // detects (a function definition, an alias, `PATH=`, …) affect name resolution for the REST of
    // the command text they appear in, not just their own segment. `quote_removed` is C1's
    // context-free quote/backslash removal (the retired trust-boundary doc), computed
    // exactly once here and reused by both the `shadowable` and `text_can_shadow` bindings below.
    let quote_removed = shell_quote_removed(trimmed);
    // C4: widened by quote removal (a shadow keyword surviving it genuinely defeats a real `PATH`
    // search), never by C3's indeterminacy — see `ClassifiedInvocation::invoked_bare_name`.
    let shadowable = text_can_shadow_path_resolution(trimmed)
        || text_can_shadow_path_resolution(&quote_removed);
    // Safe-verdict-only facts (plan 03-24, D-59/D-61) — computed once here so a `Safe` return
    // below and every fail-closed early return above/below can report them without a second scan.
    // C3's indeterminacy predicate is folded in HERE ONLY, never into `shadowable` — see
    // `ClassifiedInvocation::invoked_bare_name`'s own doc comment for why C4 keeps it out.
    let text_can_shadow = shadowable
        || raw_text_can_shadow_path_resolution(trimmed)
        || text_can_shadow_path_resolution(&quote_removed)
        || raw_text_word_formation_is_indeterminate(trimmed)
        // C6 (the retired trust-boundary doc, plan 03-35, round eight): a PATH-defeating
        // `env`/`command` wrapper token, recognised by word-boundary containment rather than exact
        // string equality, detected by presence anywhere in the raw or quote-removed text — closes
        // round eight's word-formation gap (brace expansion, a path prefix) in
        // resolve_segment_program_index's own wrapper recognition, and supersedes round seven's C5
        // (`raw_text_names_opaque_env_reparse`) as a strict superset of it.
        || raw_text_names_path_defeating_wrapper(trimmed);
    let names_gated_program = text_names_gated_program(trimmed);
    let mut unresolvable = false;

    for segment in split_top_level_segments(trimmed) {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let tokens = tokenize_shell_words(segment);
        // Round seven's own second pass (plan 03-32): retry the wrapper-token recognition against
        // THIS segment's quote-removed form, mirroring the safe-verdict's own C1-C4 retry
        // discipline. `resolve_segment_program_index`'s raw-text pass below (unchanged) remains the
        // ONLY source of the `Found` index — this retry only marks the segment unresolvable when
        // the quote-removed form resolves to `Unresolvable` and the raw form did not already catch
        // it (see `ProgramResolution::Unresolvable`'s own doc comment for why both passes are
        // needed).
        if let ProgramResolution::Unresolvable =
            resolve_segment_program_index(&tokenize_shell_words(&shell_quote_removed(segment)))
        {
            unresolvable = true;
            continue;
        }
        // Skip leading `NAME=VALUE` assignment tokens (and, past them, a leading `env` wrapper plus
        // ITS OWN leading assignment arguments) when choosing the segment's program token, so
        // `PATH=/usr/bin git push --force` AND `env PATH=/usr/bin git push --force` both resolve
        // their program as `git`, not the mis-stemmed `bin` or the wrapper `env` itself (plan 03-20
        // Task 1(b), row 6 of CR-01, widened for the `env` form measured during this task). A
        // segment carrying no program token at all is skipped, exactly as an empty segment already
        // was. A segment `resolve_segment_program_index` could not safely resolve contributes no
        // verdict, and marks the whole text unresolvable for the two shadow facts.
        let prog_idx = match resolve_segment_program_index(&tokens) {
            ProgramResolution::None => continue,
            ProgramResolution::Unresolvable => {
                unresolvable = true;
                continue;
            }
            ProgramResolution::Found(index) => index,
        };
        let first = &tokens[prog_idx];
        let stem = program_stem(first);
        let rest: Vec<String> = tokens[prog_idx + 1..].to_vec();
        if let verdict @ Verdict::Destructive(_) = classify_in(&stem, &rest, ctx) {
            return ClassifiedInvocation {
                verdict,
                program: Some(stem),
                invoked_bare_name: !first.contains('/') && !shadowable,
                text_can_shadow,
                names_gated_program,
            };
        }
    }

    ClassifiedInvocation {
        verdict: Verdict::Safe,
        program: None,
        invoked_bare_name: false,
        text_can_shadow: text_can_shadow || unresolvable,
        names_gated_program: names_gated_program || unresolvable,
    }
}

/// The `--classify-command <text>` mode's own entry point (Task 3). Never executes anything,
/// never opens the permission socket, never writes any file — a pure function of its one string
/// argument plus the session environment [`gate_context`] reads. Prints exactly one word to
/// stdout: `safe`, or one of `DestructiveCategory::as_str()`'s names. A missing or unreadable
/// argument prints nothing to stdout and exits non-zero.
fn run_classify_command(command_text_arg: Option<&OsString>) -> ExitCode {
    let Some(command_text) = command_text_arg.and_then(|s| s.to_str()) else {
        eprintln!("flywheel-shim: --classify-command requires the command text as its argument");
        return ExitCode::FAILURE;
    };

    match classify_raw_command_text(command_text, &gate_context()).verdict {
        Verdict::Safe => println!("safe"),
        Verdict::Destructive(category) => println!("{}", category.as_str()),
    }
    ExitCode::SUCCESS
}

/// The `--classify-invocation <text>` mode's own entry point (plan 03-19 Task 1). Reaches the SAME
/// `classify_raw_command_text` as `--classify-command`, but additionally reports what
/// `pretooluse-hook.ts` needs in order to decide whether the shim can intercept the command: the
/// program name of the destructive segment, and whether that segment invoked it by bare name.
/// Never executes anything, never opens the permission socket, never writes any file — a pure
/// function of its one string argument plus the session environment, exactly like
/// `--classify-command`. A missing or unreadable argument prints nothing to stdout and exits
/// non-zero.
fn run_classify_invocation(command_text_arg: Option<&OsString>) -> ExitCode {
    let Some(command_text) = command_text_arg.and_then(|s| s.to_str()) else {
        eprintln!("flywheel-shim: --classify-invocation requires the command text as its argument");
        return ExitCode::FAILURE;
    };

    let classified = classify_raw_command_text(command_text, &gate_context());
    let output = match classified.verdict {
        // plan 03-24 (D-59/D-61): the safe verdict now carries the two text facts the hook's safe
        // branch needs to establish its own D-61 deny rule. The Destructive arm below is
        // deliberately UNCHANGED — same three keys, same values, as before this plan.
        Verdict::Safe => serde_json::json!({
            "category": "safe",
            "textCanShadowPathResolution": classified.text_can_shadow,
            "namesGatedProgram": classified.names_gated_program,
        }),
        Verdict::Destructive(category) => serde_json::json!({
            "category": category.as_str(),
            "program": classified.program,
            "invokedBareName": classified.invoked_bare_name,
        }),
    };
    println!("{output}");
    ExitCode::SUCCESS
}
