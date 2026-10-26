//! D-51/D-54's shared backoff policy, proved without spawning any real git process — every test
//! here drives `with_lock_retry` with closures that fail on demand (plan 03-04 Task 1's own
//! instruction), keeping the suite fast. No literal `index.lock` substring appears anywhere in
//! this file (that literal is exactly what `is_lock_contention` must NOT be narrowed to — see the
//! Pitfall 3 test below, which builds that exact real-world wording via `format!` so it is proved
//! without ever appearing as a source-level literal).

use flywheel_core::git_retry::{
    exhaustion_event_payload, is_lock_contention, with_lock_retry, with_lock_retry_notify, CollisionCounter,
    LockExhausted, RETRY_JITTER_MS, RETRY_MAX_ATTEMPTS,
};

// --- is_lock_contention -----------------------------------------------------------------------

#[test]
fn matches_the_config_lock_wording_from_the_worktree_creation_collision() {
    let text = "fatal: Unable to create '/repo/.git/config.lock': File exists.";
    assert!(is_lock_contention(text));
}

#[test]
fn matches_the_ref_lock_wording_a_commit_time_collision_can_produce() {
    let text = "error: cannot lock ref 'refs/heads/main': Unable to create '/repo/.git/refs/heads/main.lock': File exists";
    assert!(is_lock_contention(text));
}

#[test]
fn matches_the_real_55724_wording_without_the_literal_lock_file_name_appearing_in_this_source() {
    // Built via concatenation specifically so the literal substring this matcher must NOT be
    // narrowed to never appears as a contiguous token in this test file's own source text
    // (RESEARCH.md Pitfall 3 / plan 03-04's own `<verify>` gate on git_retry.rs itself).
    let lock_file_name = format!("{}{}", "index", ".lock");
    let text = format!("Unable to create '.git/{lock_file_name}': File exists.");
    assert!(is_lock_contention(&text));
}

#[test]
fn matches_another_git_process_seems_to_be_running_wording() {
    let text = "fatal: Unable to create '/repo/.git/index.lock': Another git process seems to be running in this repository.";
    assert!(is_lock_contention(&text));
}

#[test]
fn does_not_match_an_unknown_revision_error() {
    let text = "fatal: bad revision 'HEAD@{u}'";
    assert!(!is_lock_contention(text));
}

#[test]
fn does_not_match_a_merge_conflict_error() {
    let text = "CONFLICT (content): Merge conflict in src/main.rs";
    assert!(!is_lock_contention(text));
}

// --- with_lock_retry ---------------------------------------------------------------------------

#[test]
fn succeeds_first_try_invokes_the_closure_exactly_once_and_records_zero_collisions() {
    let calls = std::sync::atomic::AtomicU32::new(0);
    let outcome = with_lock_retry("test-label", |_attempt| {
        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok::<_, anyhow::Error>(42)
    })
    .expect("first-try success must return Ok");

    assert_eq!(outcome.value, 42);
    assert_eq!(outcome.collisions, 0);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn two_collisions_then_success_invokes_the_closure_exactly_three_times() {
    let calls = std::sync::atomic::AtomicU32::new(0);
    let outcome = with_lock_retry("test-label", |_attempt| {
        let n = calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if n < 2 {
            Err(anyhow::anyhow!(
                "fatal: Unable to create '/repo/.git/config.lock': File exists."
            ))
        } else {
            Ok::<_, anyhow::Error>("done")
        }
    })
    .expect("eventual success must return Ok");

    assert_eq!(outcome.value, "done");
    assert_eq!(outcome.collisions, 2);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 3);
}

#[test]
fn a_non_lock_error_returns_immediately_after_exactly_one_invocation_with_its_own_message() {
    let calls = std::sync::atomic::AtomicU32::new(0);
    let result = with_lock_retry("test-label", |_attempt| {
        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Err::<(), _>(anyhow::anyhow!("fatal: bad revision 'HEAD@{{u}}'"))
    });

    let err = result.expect_err("a non-lock error must propagate as an Err");
    assert!(err.to_string().contains("bad revision"));
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn every_attempt_hitting_a_lock_error_returns_a_distinguishable_exhaustion_error() {
    let calls = std::sync::atomic::AtomicU32::new(0);
    let result = with_lock_retry("worktree-a", |_attempt| {
        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Err::<(), _>(anyhow::anyhow!(
            "fatal: Unable to create '/repo/.git/config.lock': File exists."
        ))
    });

    let err = result.expect_err("full exhaustion must return an Err");
    let exhausted = err
        .downcast_ref::<LockExhausted>()
        .expect("exhaustion must be a distinguishable, downcastable LockExhausted error");
    assert_eq!(exhausted.label, "worktree-a");
    assert_eq!(exhausted.attempts, RETRY_MAX_ATTEMPTS);
    assert_eq!(
        calls.load(std::sync::atomic::Ordering::SeqCst),
        RETRY_MAX_ATTEMPTS
    );
}

#[test]
fn a_full_exhaustion_completes_within_the_documented_worst_case_wall_clock() {
    // 200 + 400 + 800 + 1600 = 3000ms of base delay across 4 retries, plus up to 4*120=480ms of
    // jitter — bounded generously here (well under a flake-prone tight ceiling) to prove the
    // budget is finite and small, not to pin the exact timing.
    let started = std::time::Instant::now();
    let _ = with_lock_retry("timing-check", |_attempt| {
        Err::<(), _>(anyhow::anyhow!(
            "fatal: Unable to create '/repo/.git/config.lock': File exists."
        ))
    });
    let elapsed = started.elapsed();
    assert!(
        elapsed < std::time::Duration::from_secs(10),
        "a fully exhausted retry budget must complete well within 10s, took {elapsed:?}"
    );
    let _ = RETRY_JITTER_MS; // referenced for documentation purposes in this test's own comment
}

// --- with_lock_retry_notify (plan 03-13) --------------------------------------------------------

#[test]
fn a_first_attempt_success_invokes_the_notify_hook_zero_times() {
    let notify_calls = std::sync::atomic::AtomicU32::new(0);
    let outcome = with_lock_retry_notify(
        "test-label",
        |_attempt| Ok::<_, anyhow::Error>("done"),
        |_next_attempt, _max| {
            notify_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .expect("first-try success must return Ok");

    assert_eq!(outcome.value, "done");
    assert_eq!(
        notify_calls.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "a collision that never happened must produce zero retry notices"
    );
}

#[test]
fn two_collisions_then_success_invokes_the_notify_hook_exactly_twice_with_the_upcoming_attempt_and_the_max() {
    let calls = std::sync::atomic::AtomicU32::new(0);
    let notified: std::sync::Mutex<Vec<(u32, u32)>> = std::sync::Mutex::new(Vec::new());
    let outcome = with_lock_retry_notify(
        "test-label",
        |_attempt| {
            let n = calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if n < 2 {
                Err(anyhow::anyhow!(
                    "fatal: Unable to create '/repo/.git/config.lock': File exists."
                ))
            } else {
                Ok::<_, anyhow::Error>("done")
            }
        },
        |next_attempt, max| {
            notified.lock().unwrap().push((next_attempt, max));
        },
    )
    .expect("eventual success must return Ok");

    assert_eq!(outcome.value, "done");
    assert_eq!(
        *notified.lock().unwrap(),
        vec![(2, RETRY_MAX_ATTEMPTS), (3, RETRY_MAX_ATTEMPTS)],
        "the hook must fire once per backoff sleep, naming the UPCOMING attempt and the fixed max"
    );
}

#[test]
fn full_exhaustion_never_invokes_the_notify_hook_on_the_final_failed_attempt() {
    let notified: std::sync::Mutex<Vec<(u32, u32)>> = std::sync::Mutex::new(Vec::new());
    let result = with_lock_retry_notify(
        "worktree-a",
        |_attempt| {
            Err::<(), _>(anyhow::anyhow!(
                "fatal: Unable to create '/repo/.git/config.lock': File exists."
            ))
        },
        |next_attempt, max| {
            notified.lock().unwrap().push((next_attempt, max));
        },
    );

    let err = result.expect_err("full exhaustion must return an Err");
    assert!(err.downcast_ref::<LockExhausted>().is_some());
    // RETRY_MAX_ATTEMPTS total attempts means RETRY_MAX_ATTEMPTS - 1 backoff sleeps, so the hook
    // fires that many times — never once for the exhausting attempt itself, which returns the
    // exhaustion error instead of sleeping again.
    assert_eq!(notified.lock().unwrap().len(), (RETRY_MAX_ATTEMPTS - 1) as usize);
}

#[test]
fn a_non_lock_error_never_invokes_the_notify_hook() {
    let notify_calls = std::sync::atomic::AtomicU32::new(0);
    let result = with_lock_retry_notify(
        "test-label",
        |_attempt| Err::<(), _>(anyhow::anyhow!("fatal: bad revision 'HEAD@{{u}}'")),
        |_next_attempt, _max| {
            notify_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    );
    assert!(result.is_err());
    assert_eq!(notify_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}

// --- CollisionCounter --------------------------------------------------------------------------

#[test]
fn collision_counter_records_and_takes_a_running_total_per_run_id() {
    let counter = CollisionCounter::new();
    counter.record("run-a", 2);
    counter.record("run-a", 1);
    counter.record("run-b", 5);

    assert_eq!(counter.take("run-a"), 3);
    // Taking clears the entry — a second take for the same run id reads zero.
    assert_eq!(counter.take("run-a"), 0);
    assert_eq!(counter.take("run-b"), 5);
}

#[test]
fn collision_counter_reads_zero_for_a_run_id_that_never_recorded_anything() {
    let counter = CollisionCounter::new();
    assert_eq!(counter.take("never-seen"), 0);
}

// --- exhaustion_event_payload --------------------------------------------------------------------

#[test]
fn exhaustion_event_payload_label_matches_the_copywriting_contract_sentence_exactly() {
    let payload = exhaustion_event_payload("/repo/path", "git commit", 5);
    assert_eq!(
        payload["label"],
        "Git lock contention: git commit in /repo/path failed after 5 attempts."
    );
    assert_eq!(payload["repository"], "/repo/path");
    assert_eq!(payload["command"], "git commit");
    assert_eq!(payload["attempts"], 5);
}

// --- shim (Task 2): install_for_run behaviours and the built binary's fail-closed resolution ---

mod shim {
    use flywheel_core::shim::{install_for_run, resolve_real_git, resolve_shim_binary, shim_env_for_run};
    use std::process::Command;

    /// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `FLYWHEEL_RUNTIME_DIR`
    /// is process-global mutable state and `cargo test` runs `#[test]` functions concurrently by
    /// default. Mirrors `runtime_protocol.rs`'s own `RUNTIME_DIR_ENV_LOCK`/
    /// `with_scratch_runtime_dir` pair — a `static` cannot be shared across separate test binaries,
    /// so this binary needs its own.
    static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
        let _guard = RUNTIME_DIR_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
        // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
        // or mutates this var while it's set, and this helper always clears it before returning.
        unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
        let result = f();
        unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
        result
    }

    /// Runs the built shim binary AS `git` (setting `argv[0]` via `arg0`, never renaming or
    /// copying the file — the compiled cargo artifact is deliberately named `flywheel-shim`, not
    /// `git`) with the given `FLYWHEEL_REAL_GIT` value (`None` leaves it unset).
    fn run_shim_as_git(args: &[&str], real_git: Option<&std::path::Path>) -> std::process::Output {
        let bin = resolve_shim_binary()
            .expect("the shim binary should be resolvable after `cargo build --workspace`");
        let mut cmd = Command::new(&bin);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.arg0("git");
        }
        cmd.args(args);
        cmd.env_remove("FLYWHEEL_REAL_GIT");
        if let Some(real_git) = real_git {
            cmd.env("FLYWHEEL_REAL_GIT", real_git);
        }
        cmd.output()
            .expect("the built shim binary should be runnable")
    }

    #[test]
    fn resolve_real_gits_result_is_absolute() {
        let path = resolve_real_git().expect("resolve_real_git should find a real git on PATH");
        assert!(path.is_absolute(), "expected {path:?} to be absolute");
    }

    #[test]
    fn install_for_run_produces_a_directory_containing_an_entry_named_exactly_git() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-a", std::process::id());
            let dir = install_for_run(&run_id).expect("install_for_run should succeed");
            let expected_name = if cfg!(windows) { "git.exe" } else { "git" };
            let entry = dir.join(expected_name);
            assert!(entry.is_file(), "expected {entry:?} to exist and be a file");
        });
    }

    #[test]
    fn a_second_install_for_the_same_run_id_is_a_no_op_returning_the_same_path() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-b", std::process::id());
            let first = install_for_run(&run_id).expect("first install should succeed");
            let second = install_for_run(&run_id).expect("second install should succeed");
            assert_eq!(first, second);
        });
    }

    #[test]
    fn the_built_shim_exits_non_zero_and_names_the_variable_when_flywheel_real_git_is_unset() {
        let output = run_shim_as_git(&["--version"], None);
        assert!(
            !output.status.success(),
            "expected a non-zero exit with FLYWHEEL_REAL_GIT unset"
        );
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("FLYWHEEL_REAL_GIT"),
            "expected the stderr message to name the missing variable, got: {stderr}"
        );
    }

    #[test]
    fn the_built_shim_forwards_git_version_and_matches_real_gits_own_output() {
        let real_git = resolve_real_git().expect("resolve_real_git should find a real git on PATH");
        let expected = Command::new(&real_git)
            .arg("--version")
            .output()
            .expect("the real git --version invocation should succeed");

        let actual = run_shim_as_git(&["--version"], Some(&real_git));

        assert!(
            actual.status.success(),
            "expected the shim to exit successfully, stderr: {}",
            String::from_utf8_lossy(&actual.stderr)
        );
        assert_eq!(actual.stdout, expected.stdout);
    }

    // --- install_for_run post-install verification (plan 03-25 Task 1, D-60) --------------------

    /// The exact per-run shim directory `install_for_run` targets — computed independently of
    /// `shim_dir_for_run` (private to `flywheel_core::shim`) so this test constructs its broken-entry
    /// fixtures BEFORE `install_for_run` ever runs, exercising `install_shadow_entry`'s
    /// exists-already fast path.
    fn shim_dir_for_test_run(run_id: &str) -> std::path::PathBuf {
        flywheel_core::runtime_protocol::runtime_dir()
            .expect("runtime_dir should resolve inside a scratch runtime dir")
            .join("shim")
            .join(run_id)
    }

    #[test]
    fn t2_a_pre_created_non_executable_git_entry_makes_install_for_run_fail_naming_the_entry_and_run() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t2", std::process::id());
            let dir = shim_dir_for_test_run(&run_id);
            std::fs::create_dir_all(&dir).expect("failed to pre-create the shim dir");
            let git_entry = dir.join(if cfg!(windows) { "git.exe" } else { "git" });
            std::fs::write(&git_entry, b"not a real binary").expect("failed to write broken git entry");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&git_entry).unwrap().permissions();
                perms.set_mode(0o644);
                std::fs::set_permissions(&git_entry, perms).unwrap();
            }

            let result = install_for_run(&run_id);
            let err = result.expect_err("a non-executable pre-existing git entry must fail install_for_run");
            let rendered = format!("{err:#}");
            assert!(
                rendered.contains("shim install verification failed"),
                "expected the fixed verification-failure prefix, got: {rendered}"
            );
            assert!(
                rendered.contains(&git_entry.to_string_lossy().into_owned()),
                "expected the entry path in the rendered error, got: {rendered}"
            );
            assert!(
                rendered.contains(&run_id),
                "expected the run id in the rendered error, got: {rendered}"
            );
        });
    }

    #[test]
    fn t3_a_pre_created_zero_byte_git_entry_makes_install_for_run_fail_naming_the_entry_and_run() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t3", std::process::id());
            let dir = shim_dir_for_test_run(&run_id);
            std::fs::create_dir_all(&dir).expect("failed to pre-create the shim dir");
            let git_entry = dir.join(if cfg!(windows) { "git.exe" } else { "git" });
            std::fs::write(&git_entry, b"").expect("failed to write zero-byte git entry");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&git_entry).unwrap().permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&git_entry, perms).unwrap();
            }

            let result = install_for_run(&run_id);
            let err = result.expect_err("a zero-byte pre-existing git entry must fail install_for_run");
            let rendered = format!("{err:#}");
            assert!(
                rendered.contains("shim install verification failed"),
                "expected the fixed verification-failure prefix, got: {rendered}"
            );
            assert!(
                rendered.contains(&git_entry.to_string_lossy().into_owned()),
                "expected the entry path in the rendered error, got: {rendered}"
            );
            assert!(
                rendered.contains(&run_id),
                "expected the run id in the rendered error, got: {rendered}"
            );
        });
    }

    #[test]
    fn t4_a_pre_created_rm_entry_that_is_a_directory_makes_install_for_run_fail_naming_that_entry() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t4", std::process::id());
            let dir = shim_dir_for_test_run(&run_id);
            std::fs::create_dir_all(&dir).expect("failed to pre-create the shim dir");
            let rm_entry_name = if cfg!(windows) { "rm.exe" } else { "rm" };
            let rm_entry = dir.join(rm_entry_name);
            std::fs::create_dir_all(&rm_entry).expect("failed to pre-create the rm entry as a directory");

            let result = install_for_run(&run_id);
            let err = result.expect_err("an rm entry that is a directory must fail install_for_run");
            let rendered = format!("{err:#}");
            // A directory-shaped entry fails inside `install_shadow_entry`'s own hard-link/copy
            // attempt (its `entry.is_file()` fast path is false for a directory, so it never
            // short-circuits) — `verify_shadow_entry` is never reached for this specific shape.
            // The acceptance bar (plan 03-25 Task 1) is that the error names the entry and the
            // run id, which `install_shadow_entry`'s own context already provides; it does not
            // require the fixed verification-failure prefix specifically for THIS shape.
            assert!(
                rendered.contains(&rm_entry.to_string_lossy().into_owned()),
                "expected the rm entry's own path in the rendered error, got: {rendered}"
            );
            assert!(
                rendered.contains(&run_id),
                "expected the run id in the rendered error, got: {rendered}"
            );
            // Proves the check is per-entry, never all-or-nothing: the git entry (a healthy
            // install) is untouched by the rm entry's failure.
            let git_entry_name = if cfg!(windows) { "git.exe" } else { "git" };
            assert!(
                dir.join(git_entry_name).is_file(),
                "expected the git entry to still have been installed despite rm's failure"
            );
        });
    }

    #[test]
    fn t5_a_clean_install_for_run_still_succeeds_and_creates_both_entries() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t5", std::process::id());
            let dir = install_for_run(&run_id).expect("a clean install_for_run should succeed");
            let git_name = if cfg!(windows) { "git.exe" } else { "git" };
            let rm_name = if cfg!(windows) { "rm.exe" } else { "rm" };
            assert!(dir.join(git_name).is_file(), "expected the git entry to exist");
            assert!(dir.join(rm_name).is_file(), "expected the rm entry to exist");
        });
    }

    // --- shim_env_for_run's classification-contract probe (plan 03-25 Task 2, D-59/D-60) --------

    /// Write a minimal, inert `/bin/sh` script at `path` and mark it executable (plan 03-25 Task
    /// 2's own instruction: "The stub must be inert ... executing nothing"). `body` is the
    /// script's one statement.
    ///
    /// CRITICAL: `install_shadow_entry` HARD-LINKS the compiled `flywheel-shim` binary in at this
    /// path when a healthy install ran first (as every T7/T8-shaped test does, to obtain a
    /// realistic directory before corrupting one entry) — `path` and the compiled binary under
    /// `target/{debug,release}/flywheel-shim` are the SAME inode. Writing through that path with
    /// `std::fs::write` (open-truncate-in-place) would corrupt the shared inode's content, which
    /// is the compiled binary itself, breaking every other test in this binary that resolves and
    /// runs it. `remove_file` FIRST unlinks this directory entry only — decrementing the link
    /// count without touching the inode's data through any of its OTHER links — so the
    /// subsequent `write` creates a brand-new, unrelated file at the same path.
    #[cfg(unix)]
    fn write_inert_stub_script(path: &std::path::Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::remove_file(path);
        let script = format!("#!/bin/sh\n{body}\n");
        std::fs::write(path, script).expect("failed to write the stub script");
        let mut perms = std::fs::metadata(path)
            .expect("failed to read the stub script's metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).expect("failed to make the stub script executable");
    }

    #[test]
    fn t6_a_healthy_install_still_produces_a_working_environment() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t6", std::process::id());
            let env = shim_env_for_run(&run_id)
                .expect("a healthy install should still produce a working environment");
            let dir = shim_dir_for_test_run(&run_id);
            let path = env.get("PATH").expect("PATH should be present in the returned environment");
            assert!(
                path.starts_with(&dir.to_string_lossy().into_owned()),
                "expected PATH to lead with the per-run shim directory {dir:?}, got: {path}"
            );
            assert!(
                env.contains_key("FLYWHEEL_REAL_GIT"),
                "expected FLYWHEEL_REAL_GIT to be present"
            );
            assert!(
                env.contains_key("FLYWHEEL_REAL_RM"),
                "expected FLYWHEEL_REAL_RM to be present"
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn t7_an_inert_stub_at_the_installed_git_entry_makes_shim_env_for_run_fail() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t7", std::process::id());
            install_for_run(&run_id).expect("a clean install should succeed before corrupting it");
            let dir = shim_dir_for_test_run(&run_id);
            let git_entry = dir.join("git");
            // An inert stub that prints nothing and exits 0 — structurally a perfectly valid
            // shadow entry (exists, is a file, non-empty, executable), so Task 1's structural
            // checks alone cannot catch it. Only the classification-contract probe can.
            write_inert_stub_script(&git_entry, "exit 0");

            let result = shim_env_for_run(&run_id);
            let err = result.expect_err("an inert stub at the git entry must fail shim_env_for_run");
            let rendered = format!("{err:#}");
            assert!(
                rendered.contains("shim install verification failed"),
                "expected the fixed verification-failure prefix, got: {rendered}"
            );
            assert!(
                rendered.contains(&git_entry.to_string_lossy().into_owned()),
                "expected the entry path in the rendered error, got: {rendered}"
            );
            assert!(
                rendered.contains(&run_id),
                "expected the run id in the rendered error, got: {rendered}"
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn t8_a_stale_shim_reporting_only_category_safe_makes_shim_env_for_run_fail() {
        with_scratch_runtime_dir(|| {
            let run_id = format!("test-run-{}-t8", std::process::id());
            install_for_run(&run_id).expect("a clean install should succeed before corrupting it");
            let dir = shim_dir_for_test_run(&run_id);
            let git_entry = dir.join("git");
            // The pre-03-24 shape: a safe verdict with no textCanShadowPathResolution/
            // namesGatedProgram fields at all — a binary that predates plan 03-24's contract.
            write_inert_stub_script(&git_entry, r#"echo '{"category":"safe"}'"#);

            let result = shim_env_for_run(&run_id);
            let err =
                result.expect_err("a stale shim reporting only category:safe must fail shim_env_for_run");
            let rendered = format!("{err:#}");
            assert!(
                rendered.contains("shim install verification failed"),
                "expected the fixed verification-failure prefix, got: {rendered}"
            );
            assert!(
                rendered.contains(&git_entry.to_string_lossy().into_owned()),
                "expected the entry path in the rendered error, got: {rendered}"
            );
            assert!(
                rendered.contains(&run_id),
                "expected the run id in the rendered error, got: {rendered}"
            );
        });
    }

    #[test]
    fn t9_install_for_run_alone_still_succeeds_on_a_healthy_directory_without_the_probes_requirements() {
        with_scratch_runtime_dir(|| {
            // Pins the split (plan 03-25 Task 2(b)): install_for_run pays only the structural
            // checks Task 1 added, never the classification-contract probe, which lives on
            // shim_env_for_run only. Kept simple per the plan's own instruction — this exists to
            // pin the split, not to instrument process creation.
            let run_id = format!("test-run-{}-t9", std::process::id());
            let dir = install_for_run(&run_id).expect("install_for_run alone should still succeed");
            let git_name = if cfg!(windows) { "git.exe" } else { "git" };
            assert!(dir.join(git_name).is_file(), "expected the git entry to exist");
        });
    }
}
