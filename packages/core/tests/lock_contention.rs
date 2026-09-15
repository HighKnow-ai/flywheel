//! WORK-04's authoritative reproduction (03-RESEARCH.md open question 1): ten concurrent commits
//! into TEN ALREADY-CREATED worktrees of one repository, driven through the real PATH shim by
//! spawning `commit_stress_harness` (`tests/bin/commit_stress_harness.rs`) N times concurrently —
//! never through `core::git::git_at`, which is the supervisor's own path and not what an agent's
//! own `git commit` takes. Setup (repo init + ten SEQUENTIAL worktree creations, asserted before
//! any commit is attempted) is explicitly NOT part of the measured window: this test is about
//! commit-time lock contention (D-51/D-54), not worktree-creation-time contention (D-52), and a
//! harness that creates worktrees and commits in the same tight parallel loop would validate D-52
//! while claiming to validate D-51 (RESEARCH.md Pitfall 2).
//!
//! A companion, evidence-only "no shim" case runs the identical ten-commit scenario with an
//! ordinary `PATH` and asserts only that the run completes — its landed-commit count is
//! machine-dependent by design and is printed, never asserted, so it can never turn this suite
//! red (that outcome would just mean this machine did not reproduce the contention, not that the
//! shim has no value).
//!
//! Plan 03-08 Task 3 layers a git-version floor guard on top of both tests below (reads
//! `core::git::git_version`, prints the installed version, and SKIPs below
//! `core::git::MIN_SUPPORTED_GIT`) — not yet present as of this task.

mod common;

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use core::git::{git_at, worktree_add, worktree_list, worktree_root_from_env};
use core::git_retry::{RETRY_BASE_MS, RETRY_MAX_ATTEMPTS};
use core::shim;

const WORKTREE_COUNT: usize = 10;

/// Serializes every call to [`with_scratch_env`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT` and
/// `FLYWHEEL_RUNTIME_DIR` are both process-global mutable state, and `cargo test` runs `#[test]`
/// functions within one binary concurrently by default (mirrors `stop_lifecycle.rs`'s own
/// `WORKTREE_ROOT_ENV_LOCK` and `git_retry.rs`'s own `RUNTIME_DIR_ENV_LOCK` — a `static` cannot be
/// shared across separate test binaries, so this binary needs its own copy of both).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_env<T>(f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let worktree_root = tempfile::tempdir().expect("failed to create scratch worktree root");
    let runtime_dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, and this helper always
    // clears both vars before returning.
    unsafe {
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root.path());
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime_dir.path());
    }
    let result = f();
    unsafe {
        std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
        std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
    }
    result
}

fn harness_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_commit_stress_harness"))
}

/// One child's parsed `SUMMARY branch=<branch> hash=<hash> exit=<code>` line — the ONE function in
/// this file that parses the shape `commit_stress_harness.rs`'s own header comment documents.
struct ChildSummary {
    branch: String,
    exit: i32,
}

fn parse_summary_line(stdout: &str) -> Option<ChildSummary> {
    for line in stdout.lines() {
        let Some(rest) = line.strip_prefix("SUMMARY ") else { continue };
        let mut branch = None;
        let mut exit = None;
        for field in rest.split_whitespace() {
            if let Some(v) = field.strip_prefix("branch=") {
                branch = Some(v.to_string());
            } else if let Some(v) = field.strip_prefix("exit=") {
                exit = v.parse::<i32>().ok();
            }
        }
        if let (Some(branch), Some(exit)) = (branch, exit) {
            return Some(ChildSummary { branch, exit });
        }
    }
    None
}

fn parse_resolved_git_line(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|l| l.strip_prefix("RESOLVED_GIT=").map(|v| v.to_string()))
}

/// The doc'd worst-case wall clock a single fully-exhausted retry budget waits through
/// (`git_retry.rs`'s own comment: 200+400+800+1600=3000ms before jitter), padded generously for
/// process-spawn/IO overhead across ten concurrently-retrying children — DERIVED from
/// `RETRY_MAX_ATTEMPTS`/`RETRY_BASE_MS` rather than a literal, so a later change to the retry curve
/// changes this deadline with it instead of silently making this test flaky.
fn stress_deadline() -> Duration {
    let base_curve_ms: u64 = (1..RETRY_MAX_ATTEMPTS)
        .map(|failed_attempt| RETRY_BASE_MS.saturating_mul(1u64 << (failed_attempt - 1)))
        .sum();
    Duration::from_millis(base_curve_ms.saturating_mul(4).saturating_add(10_000))
}

/// Sum the number of JSON lines in `<runtime>/contention/<run_id>.jsonl` — the ONLY lock-collision
/// evidence externally observable from this test, since the shim (`packages/shim/src/main.rs`)
/// writes this file ONLY on full retry-budget exhaustion, never on an individual collision a later
/// attempt recovered from. A run with zero individual collisions and a run where every commit
/// succeeded on its first attempt both read 0 here — this counts EXHAUSTION events, not raw
/// collisions, which is why it is printed as evidence rather than asserted on.
fn count_exhaustion_events(run_id: &str) -> u64 {
    let Ok(runtime_dir) = core::runtime_protocol::runtime_dir() else {
        return 0;
    };
    let path = runtime_dir.join("contention").join(format!("{run_id}.jsonl"));
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return 0;
    };
    contents.lines().filter(|l| !l.trim().is_empty()).count() as u64
}

/// Initialise one real repository (via `common::seeded_git_project`) and create `WORKTREE_COUNT`
/// worktrees on `WORKTREE_COUNT` branches, SEQUENTIALLY, asserting each exists before moving on —
/// sequential and pre-asserted per RESEARCH.md Pitfall 2's own instruction: setup is not part of
/// the measured window. Returns the repo's `TempDir` (kept alive for the test's duration) and the
/// `(branch, worktree_path)` pairs created.
fn setup_repo_and_worktrees() -> (tempfile::TempDir, Vec<(String, PathBuf)>) {
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let worktree_root = worktree_root_from_env();

    let mut branches_and_paths = Vec::with_capacity(WORKTREE_COUNT);
    for i in 0..WORKTREE_COUNT {
        let branch = format!("stress-{i}");
        let worktree_path = worktree_root.join(format!("wt-{i}"));
        worktree_add(repo_dir.path(), &worktree_path, &branch, "main")
            .unwrap_or_else(|e| panic!("worktree_add failed for branch {branch:?}: {e:#}"));
        assert!(
            worktree_path.is_dir(),
            "worktree {worktree_path:?} should exist immediately after creation"
        );
        branches_and_paths.push((branch, worktree_path));
    }

    let listing = worktree_list(repo_dir.path()).expect("worktree_list should succeed");
    for (branch, _) in &branches_and_paths {
        assert!(
            listing.contains(branch.as_str()),
            "expected `git worktree list` to report branch {branch:?} before any commit was attempted, got:\n{listing}"
        );
    }

    (repo_dir, branches_and_paths)
}

#[test]
fn ten_concurrent_commits_into_one_repository_keep_every_commit_and_every_worktree() {
    with_scratch_env(|| {
        let (repo_dir, branches_and_paths) = setup_repo_and_worktrees();

        let run_id = format!("lock-contention-{}", std::process::id());
        let shim_dir = shim::install_for_run(&run_id).expect("install_for_run should succeed");
        let mut child_env = shim::shim_env_for_run(&run_id).expect("shim_env_for_run should succeed");
        // FLYWHEEL_RUN_ID is normally set by the sidecar adapter, not by `shim_env_for_run` — set
        // it ourselves so the shim's own contention bookkeeping (D-53) has somewhere to write.
        child_env.insert("FLYWHEEL_RUN_ID".to_string(), run_id.clone());

        let started = Instant::now();

        // Spawn ALL ten children first, collecting the handles, BEFORE waiting on any of them —
        // never spawn-and-wait per child, which would serialise the very concurrency under test.
        let mut children: Vec<(usize, String, Child)> = Vec::with_capacity(WORKTREE_COUNT);
        for (i, (branch, worktree_path)) in branches_and_paths.iter().enumerate() {
            let marker = format!("marker-{i}");
            let child = Command::new(harness_path())
                .arg(worktree_path)
                .arg(branch)
                .arg(&marker)
                .envs(child_env.clone())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap_or_else(|e| panic!("failed to spawn child {i} for branch {branch:?}: {e}"));
            children.push((i, branch.clone(), child));
        }

        // Wait on all ten with a shared, derived deadline — one watcher thread per child feeding
        // one channel, so a hung child fails this test loudly rather than hanging the suite
        // (T-03-08-04).
        let (tx, rx) = mpsc::channel();
        for (i, branch, child) in children {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let result = child.wait_with_output();
                let _ = tx.send((i, branch, result));
            });
        }
        drop(tx);

        let deadline = stress_deadline();
        let deadline_instant = started + deadline;
        let mut summaries: Vec<(usize, String, ChildSummary)> = Vec::with_capacity(WORKTREE_COUNT);
        for _ in 0..WORKTREE_COUNT {
            let remaining = deadline_instant.saturating_duration_since(Instant::now());
            let (i, branch, wait_result) = rx.recv_timeout(remaining).unwrap_or_else(|_| {
                panic!("timed out waiting for a child to finish within the derived deadline {deadline:?}")
            });
            let output = wait_result.unwrap_or_else(|e| panic!("failed to wait for child {i} ({branch}): {e}"));
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

            // Assertion 1: every child exited 0 — printing stderr on failure so the run is
            // diagnosable rather than merely red.
            assert!(
                output.status.success(),
                "child {i} (branch {branch:?}) exited non-zero ({:?}); stderr:\n{stderr}",
                output.status.code()
            );

            let summary = parse_summary_line(&stdout).unwrap_or_else(|| {
                panic!("child {i} (branch {branch:?}) printed no parseable SUMMARY line, stdout:\n{stdout}")
            });
            assert_eq!(summary.exit, 0, "child {i}'s own reported exit status should be 0");

            // Assertion 4: every child's reported resolved `git` path is inside the shim
            // directory — if even one child bypassed the shim, name it here.
            let resolved_git = parse_resolved_git_line(&stdout).unwrap_or_else(|| {
                panic!("child {i} (branch {branch:?}) printed no RESOLVED_GIT line, stdout:\n{stdout}")
            });
            assert!(
                resolved_git.starts_with(&shim_dir.to_string_lossy().into_owned()),
                "child {i} (branch {branch:?}) resolved git at {resolved_git:?}, expected it inside the shim directory {shim_dir:?}"
            );

            summaries.push((i, branch, summary));
        }

        let elapsed = started.elapsed();
        println!("STRESS_ELAPSED={elapsed:?} (deadline {deadline:?})");

        // Assertion 2: each branch's tip commit message equals THAT CHILD's own marker — reading
        // the tip, never counting commits, since counting would pass even if two children raced
        // onto the same branch.
        for (i, branch, summary) in &summaries {
            assert_eq!(&summary.branch, branch, "child {i}'s own reported branch should match what it was told");
            let message_output = git_at(repo_dir.path(), &["log", branch.as_str(), "-1", "--format=%s"])
                .unwrap_or_else(|e| panic!("failed to read branch {branch:?}'s tip commit message: {e:#}"));
            let message = String::from_utf8_lossy(&message_output.stdout).trim().to_string();
            let expected_marker = format!("marker-{i}");
            assert_eq!(
                message, expected_marker,
                "branch {branch:?}'s tip commit message should equal child {i}'s own marker"
            );
        }

        // Assertion 3: `git worktree list` still reports all ten worktrees — the second half of
        // `#55724`'s failure (a lock collision "fixed" by an auto-cleanup that deleted the
        // worktree), and the assertion that makes this test about data loss, not just exit codes.
        let listing_after = worktree_list(repo_dir.path()).expect("worktree_list should succeed after the run");
        for (branch, worktree_path) in &branches_and_paths {
            assert!(
                listing_after.contains(&worktree_path.to_string_lossy().into_owned()),
                "expected `git worktree list` to still report {worktree_path:?} (branch {branch:?}) after the run, got:\n{listing_after}"
            );
        }

        // Print, never assert, the total observed collision evidence.
        let exhaustion_events = count_exhaustion_events(&run_id);
        println!("OBSERVED_LOCK_EXHAUSTION_EVENTS={exhaustion_events}");
    });
}

/// Evidence gathering, NOT a guarantee — this test's only assertion is that every child could be
/// waited on; how many of the ten actually landed is machine-dependent and is printed, never
/// asserted, so it can never be the thing that turns this suite red.
#[test]
fn companion_no_shim_ten_concurrent_commits_is_evidence_only_and_never_a_gate() {
    with_scratch_env(|| {
        let (_repo_dir, branches_and_paths) = setup_repo_and_worktrees();
        let started = Instant::now();

        let mut children: Vec<(usize, String, Child)> = Vec::with_capacity(WORKTREE_COUNT);
        for (i, (branch, worktree_path)) in branches_and_paths.iter().enumerate() {
            let marker = format!("marker-{i}");
            let child = Command::new(harness_path())
                .arg(worktree_path)
                .arg(branch)
                .arg(&marker)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap_or_else(|e| panic!("failed to spawn child {i} for branch {branch:?}: {e}"));
            children.push((i, branch.clone(), child));
        }

        let (tx, rx) = mpsc::channel();
        for (i, branch, child) in children {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let result = child.wait_with_output();
                let _ = tx.send((i, branch, result));
            });
        }
        drop(tx);

        let deadline = stress_deadline();
        let deadline_instant = started + deadline;
        let mut landed = 0usize;
        for _ in 0..WORKTREE_COUNT {
            let remaining = deadline_instant.saturating_duration_since(Instant::now());
            let Ok((i, branch, wait_result)) = rx.recv_timeout(remaining) else {
                println!(
                    "NO_SHIM_LANDED={landed}/{WORKTREE_COUNT} (a child timed out — evidence only, not a failure)"
                );
                return;
            };
            match wait_result {
                Ok(output) if output.status.success() => landed += 1,
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    println!("no-shim child {i} (branch {branch:?}) did not land: {stderr}");
                }
                Err(e) => println!("no-shim child {i} (branch {branch:?}) could not be waited on: {e}"),
            }
        }

        println!(
            "NO_SHIM_LANDED={landed}/{WORKTREE_COUNT} in {:?} (evidence only, never a gate)",
            started.elapsed()
        );
    });
}
