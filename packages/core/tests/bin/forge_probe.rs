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
//!
//! `--both <repo_path>:<branch> <repo_path>:<branch>` (plan 07-08 Task 3, LINK-08's live claim as
//! ONE invocation): probes each `<repo_path>:<branch>` pair in turn with the exact same single-pair
//! logic above, printing a labelled block per probe, and exits 0 only when BOTH probes completed
//! without a `ForgeError` — one command, one exit code, no manual comparison of two separate runs.
//! Does not add a second adapter, normaliser or mock forge: the automated suite
//! (`forge_normalize`, `forge_degrade`) already proves the mapping against frozen fixtures: what a
//! frozen fixture cannot prove is that the LIVE `gh`/`glab` invocations on this machine still emit
//! those shapes and still authenticate, which is the only thing this mode adds.

use std::path::PathBuf;
use std::process::ExitCode;

use core::forge::{detect_forge_from_origin, github, gitlab, Forge, ForgeRequest};

/// One single-pair probe's outcome, shared by the original two-argument mode and each pair of
/// `--both` — the SAME detection + dispatch this file has always run, factored out so `--both`
/// runs it twice rather than duplicating it.
fn probe(repo_path: &std::path::Path, branch: &str) -> (Forge, Result<Option<ForgeRequest>, core::forge::ForgeError>) {
    let forge = detect_forge_from_origin(repo_path);
    let result = match forge {
        Forge::Local => Ok(None),
        Forge::GitHub => github::request_for_branch(repo_path, branch),
        Forge::GitLab => gitlab::request_for_branch(repo_path, branch),
    };
    (forge, result)
}

/// Print one probe's result. `label` is `None` for the original single-pair mode (byte-identical
/// to this file's pre-`--both` output — nothing here changes what 07-03's own verification already
/// ran clean against), or `Some("first"|"second")` for `--both`'s two blocks, so each is
/// unambiguously attributable without a third invocation. Returns `true` when the probe completed
/// without a `ForgeError` (a real request, or genuinely no request — both are a clean verdict;
/// only a `ForgeError` is a probe failure).
fn print_probe_result(
    label: Option<&str>,
    branch: &str,
    forge: Forge,
    result: &Result<Option<ForgeRequest>, core::forge::ForgeError>,
) -> bool {
    let prefix = label.map(|l| format!("{l}: ")).unwrap_or_default();
    println!("{prefix}{forge:?}");
    match result {
        Ok(Some(request)) => {
            println!("{prefix}{request:?}");
            true
        }
        Ok(None) => {
            println!("{prefix}no request found for branch {branch:?}");
            true
        }
        Err(e) => {
            eprintln!("{prefix}{e}");
            false
        }
    }
}

/// Parse one `<repo_path>:<branch>` pair for `--both` — `repo_path` is an absolute filesystem
/// path and may itself contain `:` on no platform this product targets (macOS/Linux), so
/// splitting on the FIRST `:` is unambiguous; `branch` is everything after it (branch names may
/// validly contain `/`, which this does not split on).
fn parse_pair(arg: &str) -> Option<(PathBuf, String)> {
    let (path, branch) = arg.split_once(':')?;
    if path.is_empty() || branch.is_empty() {
        return None;
    }
    Some((PathBuf::from(path), branch.to_string()))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();

    if args.get(1).map(String::as_str) == Some("--both") {
        let (Some(first), Some(second)) = (args.get(2), args.get(3)) else {
            eprintln!("usage: forge_probe --both <repo_path>:<branch> <repo_path>:<branch>");
            return ExitCode::FAILURE;
        };
        let (Some((first_path, first_branch)), Some((second_path, second_branch))) =
            (parse_pair(first), parse_pair(second))
        else {
            eprintln!("usage: forge_probe --both <repo_path>:<branch> <repo_path>:<branch>");
            return ExitCode::FAILURE;
        };

        let (first_forge, first_result) = probe(&first_path, &first_branch);
        let (second_forge, second_result) = probe(&second_path, &second_branch);

        let first_ok = print_probe_result(Some("first"), &first_branch, first_forge, &first_result);
        let second_ok = print_probe_result(Some("second"), &second_branch, second_forge, &second_result);

        return if first_ok && second_ok { ExitCode::SUCCESS } else { ExitCode::FAILURE };
    }

    let (repo_path, branch) = match (args.get(1), args.get(2)) {
        (Some(repo_path), Some(branch)) => (PathBuf::from(repo_path), branch.clone()),
        _ => {
            eprintln!("usage: forge_probe <repo_path> <branch>");
            return ExitCode::FAILURE;
        }
    };

    let (forge, result) = probe(&repo_path, &branch);
    if print_probe_result(None, &branch, forge, &result) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
