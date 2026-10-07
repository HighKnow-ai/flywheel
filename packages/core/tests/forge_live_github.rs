//! UAT item 4 (REVW-05), against a REAL authenticated forge.
//!
//! `forge_live_chain.rs` already proves the whole open-request chain, and already has the exact
//! idempotency test this item names
//! (`epic_request_asked_twice_surfaces_the_existing_request_instead_of_creating_a_second`) — but
//! against a `gh` shell stub it writes itself. That stub answers `gh pr list` from a file it
//! controls, so what it cannot prove is the one thing UAT item 4 is about: that the SAME
//! idempotency holds when `gh` is the real CLI talking to the real GitHub API, where the lookup is
//! a live `--head` query, the push is a real network push, auth is real, and the default branch is
//! whatever the repository actually says it is.
//!
//! This file is that arm. It is `#[ignore]`d, so `cargo test` never runs it and CI never runs it:
//! it opens a real pull request on a real repository and must be asked for explicitly.
//!
//! ## Running it
//!
//! Once, to make the throwaway repository (nothing else in this project ever touches it):
//!
//! ```sh
//! gh repo create flywheel-uat --private --add-readme
//! ```
//!
//! Then, as often as you like:
//!
//! ```sh
//! FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat \
//!   cargo test -p core --test forge_live_github -- --ignored --nocapture
//! ```
//!
//! ## What it leaves behind
//!
//! Nothing, on a pass: it closes the pull request it opened and deletes the branch it pushed, in a
//! cleanup that runs on failure too. On a hard crash it can leave one `flywheel-uat/<timestamp>`
//! branch and one closed-or-open PR in that throwaway repository; both are named with the run's
//! timestamp, and nothing else in the repository is ever written. It never touches the default
//! branch, and it never force-pushes.

use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use core::forge::request_body::RequestDraft;
use core::forge::{
    open_epic_request_at, request_for_branch_at, EpicRequestOutcome, Forge, ForgeState,
};

const REPO_ENV: &str = "FLYWHEEL_UAT_GITHUB_REPO";

fn run(program: &str, cwd: Option<&Path>, args: &[&str]) -> (bool, String, String) {
    let mut cmd = Command::new(program);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = cmd
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn {program} {args:?}: {e}"));
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).trim().to_string(),
        String::from_utf8_lossy(&out.stderr).trim().to_string(),
    )
}

fn must(program: &str, cwd: Option<&Path>, args: &[&str]) -> String {
    let (ok, stdout, stderr) = run(program, cwd, args);
    assert!(ok, "{program} {args:?} failed: {stderr}");
    stdout
}

/// Fails with the exact missing precondition rather than a confusing downstream error — this test
/// is run by hand, so a precondition failure must read as an instruction.
fn preconditions() -> String {
    let repo = std::env::var(REPO_ENV).unwrap_or_else(|_| {
        panic!(
            "{REPO_ENV} is not set. Create a throwaway repository once with \
             `gh repo create flywheel-uat --private --add-readme`, then re-run with \
             {REPO_ENV}=<owner>/flywheel-uat"
        )
    });
    let (ok, _, stderr) = run("gh", None, &["auth", "status"]);
    assert!(ok, "`gh auth status` failed — authenticate first with `gh auth login`: {stderr}");
    repo
}

#[test]
#[ignore = "opens a real pull request on a real GitHub repository; run it by name — see this file's header"]
fn epic_request_asked_twice_against_real_github_surfaces_the_existing_request() {
    let repo = preconditions();

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let head = format!("flywheel-uat/{stamp}");

    let clone_dir = tempfile::tempdir().expect("scratch clone dir");
    let checkout = clone_dir.path().join("repo");
    must("gh", None, &["repo", "clone", &repo, &checkout.to_string_lossy(), "--", "--depth", "1"]);

    let default_branch = must(
        "gh",
        None,
        &["repo", "view", &repo, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
    );
    assert!(!default_branch.is_empty(), "could not read {repo}'s default branch");

    // One real commit on a branch of our own. Nothing else in the repository is written.
    must("git", Some(&checkout), &["checkout", "-b", &head]);
    std::fs::write(
        checkout.join(format!("flywheel-uat-{stamp}.txt")),
        format!("Flywheel UAT item 4, run {stamp}.\n"),
    )
    .expect("write marker file");
    must("git", Some(&checkout), &["add", "-A"]);
    must("git", Some(&checkout), &["commit", "-m", &format!("flywheel uat {stamp}")]);

    let draft = RequestDraft {
        title: format!("Flywheel UAT {stamp} — epic request idempotency"),
        body: format!(
            "Opened by `forge_live_github.rs` (Phase 08 UAT item 4) at run {stamp}.\n\n\
             This pull request is closed and its branch deleted by the same test run.\n"
        ),
        head_branch: head.clone(),
        target_branch: default_branch.clone(),
    };

    // Everything below is wrapped so the cleanup runs on a failed assertion too.
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let first = open_epic_request_at(Forge::GitHub, &checkout, &draft).expect("first open");
        let EpicRequestOutcome::Opened(opened) = first else {
            panic!("the first call must open a request, got {first:?}");
        };
        assert!(opened.number > 0, "the opened request carries no number: {opened:?}");
        assert_eq!(opened.target_branch, default_branch, "the request's base is not the default branch");
        println!("UAT-4 first call  -> Opened #{} {}", opened.number, opened.url);

        let second = open_epic_request_at(Forge::GitHub, &checkout, &draft).expect("second open");
        let EpicRequestOutcome::AlreadyOpen(existing) = second else {
            panic!("the second call must surface the existing request, got {second:?}");
        };
        println!("UAT-4 second call -> AlreadyOpen #{} {}", existing.number, existing.url);
        assert_eq!(
            existing.number, opened.number,
            "the second call surfaced a DIFFERENT request — a duplicate was created"
        );
        assert!(
            matches!(existing.state, ForgeState::Open | ForgeState::ChangesRequested),
            "the existing request is not open: {:?}",
            existing.state
        );

        // Read live, independently of the outcome type, that exactly one request exists for the head.
        let looked_up = request_for_branch_at(Forge::GitHub, &checkout, &head)
            .expect("live lookup")
            .expect("a request must exist for the pushed head");
        assert_eq!(looked_up.number, opened.number, "the live lookup found a different request");

        opened.number
    }));

    // Cleanup, best-effort and loud: a left-behind PR or branch must be visible, not silent.
    if let Ok(number) = &outcome {
        let (ok, _, stderr) = run("gh", Some(&checkout), &["pr", "close", &number.to_string(), "--delete-branch"]);
        if !ok {
            eprintln!("UAT-4 cleanup: could not close PR #{number} or delete {head}: {stderr}");
        }
    }
    let (_, _, _) = run("git", Some(&checkout), &["push", "origin", "--delete", &head]);

    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
