//! A separate binary spawned N TIMES CONCURRENTLY by `tests/lock_contention.rs` (WORK-04,
//! criterion 4) to drive one worktree's commit through whatever `git` its own `PATH` resolves —
//! never through `flywheel_core::git::git_at` (that is the supervisor's own path; no agent session
//! ever takes it) and never by constructing an absolute path to a specific binary. Every git
//! invocation below is a bare `Command::new("git")` relying on THIS process's inherited `PATH`,
//! exactly the way a real agent session's own `git commit` resolves.
//!
//! **Deliberately `.current_dir(<worktree>)`, never `-C <worktree>`.** This is a documented
//! deviation from this plan's literal wording (see 03-08-SUMMARY.md), made for two independent
//! reasons: (1) a real agent's own git invocations run from inside its worktree's cwd, never with
//! an explicit `-C` — cwd-scoped invocation is the more faithful model of what this test claims to
//! reproduce; and (2) `flywheel_core::destructive::classify_git` (plan 03-07) reads the FIRST argv
//! token as the subcommand with no handling for a leading global flag, so a `-C <path>` prefix
//! would be classified `Uncategorized`/destructive and block on a permission socket this
//! reproduction never sets up (03-07 landed after this plan was written). `.current_dir()` here is
//! exempt from PROC-02's ban on that method (`tests/supervisor_cwd.rs` scans only
//! `packages/core/src` and `packages/desktop/src-tauri/src`, never `tests/bin/`).
//!
//! Argv: `<worktree_path> <branch> <marker>`. Steps, in order: print the resolved `git` path
//! (walking this process's own `PATH` entries and reporting the first match — never a `which`
//! invocation); run `git --version`; write `<worktree>/stress-<marker>.txt`; `git add <file>`;
//! `git commit -m <marker>`; `git log -1 --format=%H` to capture the resulting commit hash.
//! Deliberately `log`, never `rev-parse` — `rev-parse` is absent from
//! `destructive::SAFE_GIT_SUBCOMMANDS` and would trip the exact same permission-gate problem `-C`
//! does; `log` is on that safe list and returns the identical hash for `-1`'s single line.
//!
//! Prints exactly one machine-readable summary line on stdout, in this fixed shape — parsed by
//! exactly one function (`parse_summary_line`) in `lock_contention.rs`:
//!
//!   SUMMARY branch=<branch> hash=<hex-or-empty> exit=<status>
//!
//! and one resolved-git-path line, printed once, before the first commit step:
//!
//!   RESOLVED_GIT=<absolute-path-or-not-found>
//!
//! On any step's failure, git's own stderr is printed verbatim to this process's own stderr and
//! the process exits with that step's own non-zero status. This binary performs NO worktree
//! creation, NO worktree removal and NO prune — its whole job is the commit, because that is the
//! contention window criterion 4 is about. Conflating it with worktree-creation-time contention
//! would validate D-52's window while claiming to validate D-51's (RESEARCH.md Pitfall 2).

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};

/// Walk this process's own `PATH` entries in order and return the first `git` (or `git.exe`)
/// found — never a `which` invocation, mirroring the supervisor-side shim resolver's own
/// discipline but implemented locally so this harness carries no dependency on the supervisor's
/// own shim module.
fn resolve_git_on_path() -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn run_git(worktree: &str, args: &[&str]) -> Output {
    Command::new("git")
        .current_dir(worktree)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git {args:?} in {worktree:?}: {e}"))
}

/// Print the one summary line this binary ever prints and exit with `code` — the single place
/// that happens, so the shape documented in this file's header comment can never drift from what
/// actually gets printed.
fn finish(branch: &str, hash: &str, code: i32) -> ! {
    println!("SUMMARY branch={branch} hash={hash} exit={code}");
    std::process::exit(code);
}

fn fail_step(branch: &str, output: &Output) -> ! {
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    let code = output.status.code().unwrap_or(1);
    finish(branch, "", code);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let worktree = args
        .get(1)
        .expect("usage: commit_stress_harness <worktree_path> <branch> <marker>");
    let branch = args.get(2).expect("missing branch argument");
    let marker = args.get(3).expect("missing marker argument");

    match resolve_git_on_path() {
        Some(path) => println!("RESOLVED_GIT={}", path.display()),
        None => println!("RESOLVED_GIT=<not found>"),
    }

    let version_output = run_git(worktree, &["--version"]);
    if !version_output.status.success() {
        fail_step(branch, &version_output);
    }

    let file_name = format!("stress-{marker}.txt");
    let file_path = PathBuf::from(worktree).join(&file_name);
    if let Err(e) = fs::write(&file_path, marker.as_bytes()) {
        eprintln!("failed to write {file_path:?}: {e}");
        finish(branch, "", 1);
    }

    let add_output = run_git(worktree, &["add", &file_name]);
    if !add_output.status.success() {
        fail_step(branch, &add_output);
    }

    let commit_output = run_git(worktree, &["commit", "-m", marker]);
    if !commit_output.status.success() {
        fail_step(branch, &commit_output);
    }

    // `log`, never `rev-parse` — see this file's own header comment for why.
    let hash_output = run_git(worktree, &["log", "-1", "--format=%H"]);
    if !hash_output.status.success() {
        fail_step(branch, &hash_output);
    }
    let hash = String::from_utf8_lossy(&hash_output.stdout).trim().to_string();

    finish(branch, &hash, 0);
}
