//! `forge_probe <repo_path> <branch>` — the live GitHub/GitLab check plan 07-08's human check
//! invokes as ONE copy-pasteable command rather than a manual procedure.
//!
//! Opens no database: it takes a repository path directly, detects the forge from the origin
//! remote (`forge::detect_forge_from_origin` — never a stored per-project override, since there
//! is no project row here to read one from), and dispatches directly to the matching adapter's
//! `request_for_branch`, the identical normalised model the real database-backed dispatch
//! (`forge::request_for_branch`) produces for `Forge::GitHub`/`Forge::GitLab`.
//!
//! Prints the detected forge on the first line, then the `Debug` rendering of the normalised
//! `ForgeRequest` (or a line naming "no request" when none exists) — exits 0 on a clean verdict,
//! non-zero with the `Display` text of the specific `ForgeError` otherwise. Never panics: an
//! unparseable argument list is a usage message and a non-zero exit, not a crash.

use std::path::PathBuf;
use std::process::ExitCode;

use core::forge::{detect_forge_from_origin, github, gitlab, Forge};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let (repo_path, branch) = match (args.get(1), args.get(2)) {
        (Some(repo_path), Some(branch)) => (PathBuf::from(repo_path), branch.clone()),
        _ => {
            eprintln!("usage: forge_probe <repo_path> <branch>");
            return ExitCode::FAILURE;
        }
    };

    let forge = detect_forge_from_origin(&repo_path);
    println!("{forge:?}");

    let result = match forge {
        Forge::Local => Ok(None),
        Forge::GitHub => github::request_for_branch(&repo_path, &branch),
        Forge::GitLab => gitlab::request_for_branch(&repo_path, &branch),
    };

    match result {
        Ok(Some(request)) => {
            println!("{request:?}");
            ExitCode::SUCCESS
        }
        Ok(None) => {
            println!("no request found for branch {branch:?}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
