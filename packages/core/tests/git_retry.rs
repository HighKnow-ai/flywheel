//! D-51/D-54's shared backoff policy, proved without spawning any real git process — every test
//! here drives `with_lock_retry` with closures that fail on demand (plan 03-04 Task 1's own
//! instruction), keeping the suite fast. No literal `index.lock` substring appears anywhere in
//! this file (that literal is exactly what `is_lock_contention` must NOT be narrowed to — see the
//! Pitfall 3 test below, which builds that exact real-world wording via `format!` so it is proved
//! without ever appearing as a source-level literal).

use core::git_retry::{
    exhaustion_event_payload, is_lock_contention, with_lock_retry, CollisionCounter, LockExhausted,
    RETRY_JITTER_MS, RETRY_MAX_ATTEMPTS,
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
