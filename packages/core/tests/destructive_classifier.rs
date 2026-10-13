//! D-56's classifier proof (AGNT-07, plan 03-07 Task 1): the category table, the fail-closed
//! default, the migration wiring, and the write-path guards `create_pending_request`/
//! `answer_request` carry for a destructive request. Task 2 extends this file with a `shim_gate`
//! module driving the built shim binary's own socket behaviour.
//!
//! See `packages/sidecar/test/destructive-gate.test.mjs` for the hook's own real-binary
//! measurement (Task 3).

mod common;

use core::destructive::{classify, DestructiveCategory, Verdict};
use core::domain::agent_run::start_agent_run;
use core::domain::permission_request::{
    answer_request, create_pending_request, DestructiveAllowAlwaysRejected,
};
use core::domain::task::create_task;
use rusqlite::Connection;

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — see
/// `permission_gate.rs`'s identical helper and its own doc comment for why: `cargo test` runs a
/// binary's `#[test]` fns concurrently by default, and `FLYWHEEL_WORKTREE_ROOT` is process-global
/// mutable state. Each `tests/*.rs` file compiles to its own binary, so this cannot race with any
/// other file's own, separate static.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Seed one project with one task and one `running` agent run — everything the two
/// `permission_request` integration tests below need.
fn seeded_running_run() -> (Connection, String, String) {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Gated task", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        (conn, actor_id, run.id)
    })
}

fn args(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

// --- DestructiveCategory: exactly 8 variants, exact UI-SPEC key strings ---

#[test]
fn destructive_category_as_str_matches_the_ui_spec_consequence_copy_table_keys_exactly() {
    let expected = [
        "force-push",
        "branch-deletion",
        "default-branch-push",
        "hard-reset",
        "force-clean",
        "history-rewrite",
        "recursive-delete",
        "uncategorized",
    ];
    let actual: Vec<&str> = DestructiveCategory::all().iter().map(|c| c.as_str()).collect();
    assert_eq!(actual.len(), 8, "DestructiveCategory must have exactly 8 variants");
    assert_eq!(actual, expected, "as_str() values must match the UI-SPEC's table keys exactly");
}

#[test]
fn destructive_category_from_str_name_round_trips_every_variant() {
    for category in DestructiveCategory::all() {
        assert_eq!(DestructiveCategory::from_str_name(category.as_str()), Some(category));
    }
    assert_eq!(DestructiveCategory::from_str_name("not-a-real-category"), None);
}

// --- ForcePush: >=4 positive cases, varying flag form/position ---

#[test]
fn force_push_long_form_flag() {
    let verdict = classify("git", &args(&["push", "--force", "origin", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_short_form_flag() {
    let verdict = classify("git", &args(&["push", "-f", "origin", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_with_lease_long_form() {
    let verdict = classify("git", &args(&["push", "--force-with-lease", "origin", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_flag_appearing_before_the_remote_and_refspec() {
    let verdict = classify("git", &args(&["push", "-f", "origin", "feature"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_short_flag_clustered_with_set_upstream() {
    // `-uf` clusters `-u` (set-upstream) and `-f` (force) — expand_short_clusters must explode
    // this into `-u`, `-f` so the force detection still fires regardless of clustering.
    let verdict = classify("git", &args(&["push", "-uf", "origin", "feature"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

// --- ForcePush via a leading-plus refspec (T-03-14-02): git's own per-refspec force syntax,
// the same fail-open class as the delete gap above, found in the same function. ---

#[test]
fn force_push_leading_plus_refspec_with_explicit_destination() {
    let verdict = classify("git", &args(&["push", "origin", "+feature:feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_leading_plus_refspec_bare_branch_name() {
    let verdict = classify("git", &args(&["push", "origin", "+feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_leading_plus_refspec_refs_heads_qualified() {
    let verdict = classify(
        "git",
        &args(&["push", "origin", "+refs/heads/feature:refs/heads/feature"]),
        Some("main"),
    );
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForcePush));
}

#[test]
fn force_push_leading_plus_refspec_still_loses_to_branch_deletion() {
    // The delete family wins even when the deleted source is also plus-prefixed — delete
    // detection is not fooled by an irrelevant leading `+` on the positional it inspects.
    let verdict = classify("git", &args(&["push", "origin", "--delete", "+feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn safe_refspec_with_no_leading_plus_is_not_a_force_push() {
    let verdict = classify("git", &args(&["push", "origin", "feature:feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Safe);
}

// --- BranchDeletion: >=4 positive cases, long/short/capitalized-force forms ---

#[test]
fn branch_deletion_short_form_lowercase_d() {
    let verdict = classify("git", &args(&["branch", "-d", "old-feature"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn branch_deletion_capitalized_force_delete_form() {
    let verdict = classify("git", &args(&["branch", "-D", "old-feature"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn branch_deletion_long_form() {
    let verdict = classify("git", &args(&["branch", "--delete", "old-feature"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn branch_deletion_long_form_combined_with_force() {
    let verdict = classify("git", &args(&["branch", "--delete", "--force", "old-feature"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn branch_deletion_flag_appearing_after_the_branch_name() {
    let verdict = classify("git", &args(&["branch", "old-feature", "-D"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

// --- BranchDeletion via `push` (T-03-14-01): a remote branch deletion destroys strictly MORE
// than the local deletion above, and every spelling below is pinned so `classify_push`'s
// fail-closed contract holds for pushes the same way it already holds for `git branch`. ---

#[test]
fn delete_shaped_push_long_form_flag_on_a_non_default_branch() {
    let verdict = classify("git", &args(&["push", "origin", "--delete", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_short_form_flag_on_a_non_default_branch() {
    let verdict = classify("git", &args(&["push", "origin", "-d", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_empty_source_colon_refspec_on_a_non_default_branch() {
    let verdict = classify("git", &args(&["push", "origin", ":feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_flag_appearing_before_the_remote() {
    let verdict = classify("git", &args(&["push", "--delete", "origin", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_long_form_flag_with_refs_heads_qualified_branch() {
    let verdict =
        classify("git", &args(&["push", "origin", "--delete", "refs/heads/feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_colon_refspec_with_refs_heads_qualified_branch() {
    let verdict = classify("git", &args(&["push", "origin", ":refs/heads/feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_clustered_short_flags_still_wins_over_force() {
    // `-fd` clusters `-f` (force) and `-d` (delete) — expand_short_clusters explodes this into
    // `-f`, `-d`, and the delete check precedes the force check in classify_push, so the
    // deletion category (not ForcePush) is the one that wins.
    let verdict = classify("git", &args(&["push", "-fd", "origin", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

#[test]
fn delete_shaped_push_long_form_flag_takes_priority_over_default_branch_push_on_the_default_branch() {
    let verdict = classify("git", &args(&["push", "origin", "--delete", "main"]), Some("main"));
    assert_eq!(
        verdict,
        Verdict::Destructive(DestructiveCategory::BranchDeletion),
        "a delete-shaped push naming the default branch is reported as a deletion, not a push, \
         because the consequence sentence the user reads is selected by the category and \
         describing a deletion as a push would be materially wrong"
    );
}

#[test]
fn delete_shaped_push_colon_refspec_takes_priority_over_default_branch_push_on_the_default_branch() {
    let verdict = classify("git", &args(&["push", "origin", ":main"]), Some("main"));
    assert_eq!(
        verdict,
        Verdict::Destructive(DestructiveCategory::BranchDeletion),
        "a delete-shaped push naming the default branch is reported as a deletion, not a push, \
         because the consequence sentence the user reads is selected by the category and \
         describing a deletion as a push would be materially wrong"
    );
}

#[test]
fn delete_shaped_push_with_no_branch_named_still_classifies_as_branch_deletion() {
    // Fail-closed (this module's own rule): the shape is recognised even when the target is not.
    let verdict = classify("git", &args(&["push", "origin", "--delete"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::BranchDeletion));
}

// --- DefaultBranchPush: >=4 positive cases, various refspec shapes ---

#[test]
fn default_branch_push_bare_branch_name() {
    let verdict = classify("git", &args(&["push", "origin", "main"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::DefaultBranchPush));
}

#[test]
fn default_branch_push_via_refspec_destination() {
    let verdict = classify("git", &args(&["push", "origin", "HEAD:main"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::DefaultBranchPush));
}

#[test]
fn default_branch_push_via_refs_heads_qualified_form() {
    let verdict = classify("git", &args(&["push", "origin", "refs/heads/main"]), Some("main"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::DefaultBranchPush));
}

#[test]
fn default_branch_push_takes_priority_even_when_force_is_also_present() {
    let verdict = classify("git", &args(&["push", "--force", "origin", "main"]), Some("main"));
    assert_eq!(
        verdict,
        Verdict::Destructive(DestructiveCategory::DefaultBranchPush),
        "a push naming the default branch is DefaultBranchPush regardless of --force"
    );
}

#[test]
fn default_branch_push_with_a_different_default_branch_name() {
    let verdict = classify("git", &args(&["push", "origin", "trunk"]), Some("trunk"));
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::DefaultBranchPush));
}

// --- HardReset: >=4 positive cases ---

#[test]
fn hard_reset_bare() {
    let verdict = classify("git", &args(&["reset", "--hard"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HardReset));
}

#[test]
fn hard_reset_with_a_commit_ref() {
    let verdict = classify("git", &args(&["reset", "--hard", "HEAD~1"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HardReset));
}

#[test]
fn hard_reset_flag_after_other_flags() {
    let verdict = classify("git", &args(&["reset", "-q", "--hard", "origin/main"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HardReset));
}

#[test]
fn hard_reset_flag_appearing_last() {
    let verdict = classify("git", &args(&["reset", "HEAD~1", "--hard"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HardReset));
}

// --- ForceClean: >=4 positive cases, order/combination variations ---

#[test]
fn force_clean_fdx_in_declared_order() {
    let verdict = classify("git", &args(&["clean", "-f", "-d", "-x"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForceClean));
}

#[test]
fn force_clean_reordered_xdf() {
    let verdict = classify("git", &args(&["clean", "-x", "-d", "-f"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForceClean));
}

#[test]
fn force_clean_long_force_flag_combined_with_short_dx() {
    let verdict = classify("git", &args(&["clean", "--force", "-d", "-x"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForceClean));
}

#[test]
fn force_clean_clustered_short_flags() {
    // `-fdx` is a single clustered token — expand_short_clusters must explode it into
    // `-f`, `-d`, `-x` for the combination check to fire.
    let verdict = classify("git", &args(&["clean", "-fdx"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForceClean));
}

#[test]
fn force_clean_using_capital_x_ignored_only_variant() {
    let verdict = classify("git", &args(&["clean", "-f", "-d", "-X"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::ForceClean));
}

// --- HistoryRewrite: >=4 positive cases ---

#[test]
fn history_rewrite_filter_branch_subcommand() {
    let verdict = classify("git", &args(&["filter-branch", "--tree-filter", "rm secret"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HistoryRewrite));
}

#[test]
fn history_rewrite_rebase_onto_remote_tracking_branch() {
    let verdict = classify("git", &args(&["rebase", "origin/main"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HistoryRewrite));
}

#[test]
fn history_rewrite_rebase_onto_explicit_refs_remotes_ref() {
    let verdict = classify("git", &args(&["rebase", "refs/remotes/origin/main"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HistoryRewrite));
}

#[test]
fn history_rewrite_filter_branch_with_no_further_flags() {
    let verdict = classify("git", &args(&["filter-branch"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HistoryRewrite));
}

#[test]
fn history_rewrite_interactive_rebase_onto_remote_tracking_branch() {
    let verdict = classify("git", &args(&["rebase", "-i", "origin/develop"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::HistoryRewrite));
}

// --- RecursiveDelete: >=4 positive cases, spellings + clustering ---

#[test]
fn recursive_delete_short_flag_r() {
    let verdict = classify("rm", &args(&["-r", "build/"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::RecursiveDelete));
}

#[test]
fn recursive_delete_capital_r() {
    let verdict = classify("rm", &args(&["-R", "build/"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::RecursiveDelete));
}

#[test]
fn recursive_delete_long_form() {
    let verdict = classify("rm", &args(&["--recursive", "build/"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::RecursiveDelete));
}

#[test]
fn recursive_delete_combined_short_flag_cluster() {
    let verdict = classify("rm", &args(&["-rf", "build/"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::RecursiveDelete));
}

#[test]
fn recursive_delete_flag_after_the_path() {
    let verdict = classify("rm", &args(&["build/", "-r"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::RecursiveDelete));
}

// --- Safe: the full named-in-spec Safe list ---

#[test]
fn safe_ordinary_read_and_write_git_operations() {
    for subcommand in ["status", "log", "diff", "add", "commit"] {
        let verdict = classify("git", &args(&[subcommand]), None);
        assert_eq!(verdict, Verdict::Safe, "expected `git {subcommand}` to be Safe");
    }
}

#[test]
fn safe_plain_push_with_no_force_and_no_default_branch_target() {
    let verdict = classify("git", &args(&["push", "origin", "feature"]), Some("main"));
    assert_eq!(verdict, Verdict::Safe);
}

#[test]
fn safe_bare_push_with_no_positional_arguments() {
    let verdict = classify("git", &args(&["push"]), Some("main"));
    assert_eq!(verdict, Verdict::Safe);
}

#[test]
fn safe_plain_branch_listing_and_creation() {
    assert_eq!(classify("git", &args(&["branch"]), None), Verdict::Safe);
    assert_eq!(classify("git", &args(&["branch", "new-feature"]), None), Verdict::Safe);
}

#[test]
fn safe_non_recursive_file_removal() {
    let verdict = classify("rm", &args(&["file.txt"]), None);
    assert_eq!(verdict, Verdict::Safe);
}

#[test]
fn safe_reset_without_the_hard_flag() {
    assert_eq!(classify("git", &args(&["reset"]), None), Verdict::Safe);
    assert_eq!(classify("git", &args(&["reset", "--soft", "HEAD~1"]), None), Verdict::Safe);
}

#[test]
fn safe_local_rebase_with_no_remote_tracking_upstream() {
    assert_eq!(classify("git", &args(&["rebase", "main"]), None), Verdict::Safe);
    assert_eq!(classify("git", &args(&["rebase", "--continue"]), None), Verdict::Safe);
}

#[test]
fn safe_program_names_outside_git_and_rm_are_never_inspected() {
    // Only `git` and `rm` carry a destructive form in this workspace's threat model — every
    // other program name is Safe by construction (this module's own top doc comment).
    assert_eq!(classify("npm", &args(&["install"]), None), Verdict::Safe);
    assert_eq!(classify("ls", &args(&["-la"]), None), Verdict::Safe);
}

// --- Uncategorized: >=6 cases, the fail-closed default ---

#[test]
fn uncategorized_unknown_git_subcommand() {
    let verdict = classify("git", &args(&["frobnicate", "--whatever"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::Uncategorized));
}

#[test]
fn uncategorized_bare_git_with_no_subcommand_at_all() {
    let verdict = classify("git", &args(&[]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::Uncategorized));
}

#[test]
fn uncategorized_clean_with_only_the_force_flag() {
    // Some, but not all, of D-56's named `-fdx` combination — not confidently Safe either.
    let verdict = classify("git", &args(&["clean", "-f"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::Uncategorized));
}

#[test]
fn uncategorized_clean_with_only_directory_and_ignored_flags() {
    let verdict = classify("git", &args(&["clean", "-d", "-x"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::Uncategorized));
}

#[test]
fn uncategorized_a_second_unrecognised_subcommand() {
    let verdict = classify("git", &args(&["delete-everything"]), None);
    assert_eq!(verdict, Verdict::Destructive(DestructiveCategory::Uncategorized));
}

#[test]
fn uncategorized_deliberately_nonsensical_argument_vector() {
    // A malformed argv this classifier cannot confidently parse: the "subcommand" position is
    // itself a flag-shaped/injection-like token, matching no known git subcommand.
    let verdict = classify("git", &args(&["--", "$(rm -rf /)", "???"]), None);
    assert_eq!(
        verdict,
        Verdict::Destructive(DestructiveCategory::Uncategorized),
        "a nonsensical argv must fail closed into Uncategorized, never Safe"
    );
}

// --- migration wiring ---

#[test]
fn migration_source_list_registers_the_destructive_gate_column_exactly_once() {
    // Deviation (Rule 1): this test previously also asserted migration 0007 was the LAST
    // registered migration and that exactly seven migrations existed — both became false the
    // moment plan 04-01 appended `0008_session_summaries.sql` to the list. The
    // exactly-once-registered assertion for `destructive_category` is unrelated to list length
    // or position and remains meaningful; the length/position assertions are removed rather than
    // hardcoded to a new number, so the next migration addition does not require touching this
    // test again for a fact this test was never really about.
    let sources = core::db::migration_sources();
    let occurrences = sources.iter().filter(|s| s.contains("ADD COLUMN destructive_category")).count();
    assert_eq!(occurrences, 1, "destructive_category must be added by exactly one migration");
}

// --- create_pending_request: validates destructive_category against the enum's string set ---

#[test]
fn create_pending_request_accepts_every_valid_destructive_category() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    for category in DestructiveCategory::all() {
        let request = create_pending_request(
            &mut conn,
            &run_id,
            "Bash",
            Some("{\"command\":\"git push --force\"}"),
            &actor_id,
            Some(category.as_str()),
        )
        .unwrap_or_else(|e| panic!("expected {category:?} to be accepted, got: {e}"));
        assert_eq!(request.destructive_category.as_deref(), Some(category.as_str()));
        // Answer it so the run is unblocked before the next iteration raises another request.
        answer_request(&mut conn, &request.id, "denied", &actor_id)
            .expect("answer_request should succeed for the routine denied path");
    }
}

#[test]
fn create_pending_request_rejects_a_destructive_category_outside_the_enum_set() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let result = create_pending_request(
        &mut conn,
        &run_id,
        "Bash",
        None,
        &actor_id,
        Some("not-a-real-category"),
    );
    assert!(result.is_err(), "an out-of-set destructive_category must be rejected");
}

#[test]
fn create_pending_request_with_no_destructive_category_is_the_routine_variant() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let request = create_pending_request(&mut conn, &run_id, "Bash", None, &actor_id, None)
        .expect("create_pending_request should succeed for the routine variant");
    assert_eq!(request.destructive_category, None);
}

// --- answer_request: D-57's allow-always guard ---

#[test]
fn answer_request_rejects_allowed_always_for_a_request_carrying_a_destructive_category() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let request = create_pending_request(
        &mut conn,
        &run_id,
        "Bash",
        Some("{\"command\":\"git push --force\"}"),
        &actor_id,
        Some(DestructiveCategory::ForcePush.as_str()),
    )
    .expect("create_pending_request should succeed");

    let result = answer_request(&mut conn, &request.id, "allowed_always", &actor_id);
    let err = result.expect_err("allowed_always must be rejected for a destructive request");
    err.downcast_ref::<DestructiveAllowAlwaysRejected>()
        .expect("the error must be the typed DestructiveAllowAlwaysRejected, not a generic failure");

    // The row must still be genuinely pending afterward — the rejected attempt must not have
    // partially applied.
    let status: String = conn
        .query_row(
            "SELECT status FROM permission_requests WHERE id = ?1",
            rusqlite::params![request.id],
            |row| row.get(0),
        )
        .expect("permission_requests row should exist");
    assert_eq!(status, "pending", "a rejected allowed_always attempt must not change the row's status");
}

#[test]
fn answer_request_still_accepts_allowed_always_for_a_routine_non_destructive_request() {
    let (mut conn, actor_id, run_id) = seeded_running_run();
    let request = create_pending_request(&mut conn, &run_id, "Bash", None, &actor_id, None)
        .expect("create_pending_request should succeed");

    let answered = answer_request(&mut conn, &request.id, "allowed_always", &actor_id)
        .expect("allowed_always must still work for a routine (non-destructive) request");
    assert_eq!(answered.status, "allowed_always");
}

// --- shim_gate (Task 2): the built shim binary's own indefinite-block, allow/deny and
// no-cached-answer contract, driven against a real mock permission socket server. ---

mod shim_gate {
    use core::shim::resolve_shim_binary;
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixListener;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    fn resolve_system_rm() -> PathBuf {
        let path_var = std::env::var_os("PATH").expect("PATH should be set in the test environment");
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("rm");
            if candidate.is_file() {
                return candidate;
            }
        }
        panic!("system rm not found on PATH");
    }

    /// Mirrors [`resolve_system_rm`] for `git` — used by `run_shim_as_git`'s `FLYWHEEL_REAL_GIT`.
    fn resolve_system_git() -> PathBuf {
        let path_var = std::env::var_os("PATH").expect("PATH should be set in the test environment");
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("git");
            if candidate.is_file() {
                return candidate;
            }
        }
        panic!("system git not found on PATH");
    }

    /// A short, unique socket path — deliberately NOT under `std::env::temp_dir()`, whose
    /// per-user macOS path (`/var/folders/.../T/`) plus any descriptive label routinely exceeds
    /// `sockaddr_un`'s ~104-byte `SUN_LEN` limit. `/tmp` is short on every Unix this workspace
    /// targets; a process id plus a monotonic counter is enough uniqueness across this file's own
    /// concurrently-running tests.
    fn scratch_socket_path(_label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        PathBuf::from("/tmp").join(format!("fw-{}-{n}.sock", std::process::id()))
    }

    /// Spawn a background thread that accepts exactly ONE connection on `socket_path`, reads its
    /// one request line, and — if `decision` is `Some` — writes that decision back immediately;
    /// if `decision` is `None`, holds the connection open without ever answering, long past this
    /// file's own multi-second "still alive" assertion window, so that window observes the shim
    /// genuinely blocked rather than a socket that merely closed early.
    fn spawn_mock_permission_server(
        socket_path: PathBuf,
        decision: Option<&'static str>,
    ) -> std::thread::JoinHandle<serde_json::Value> {
        let listener =
            UnixListener::bind(&socket_path).expect("failed to bind the mock permission socket");
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("failed to accept the shim's connection");
            let mut reader = BufReader::new(stream.try_clone().expect("failed to clone the socket"));
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("failed to read the shim's request line");
            let parsed: serde_json::Value =
                serde_json::from_str(line.trim()).expect("the shim's request must be valid JSON");
            assert_eq!(parsed["toolName"], "Bash", "the shim always names the tool Bash");

            match decision {
                Some(decision) => {
                    let mut stream = stream;
                    let response = format!("{{\"decision\":\"{decision}\"}}\n");
                    stream
                        .write_all(response.as_bytes())
                        .expect("failed to write the mock decision");
                }
                None => {
                    std::thread::sleep(Duration::from_secs(10));
                }
            }
            parsed
        })
    }

    fn run_shim_as_rm(
        args: &[&str],
        real_rm: &std::path::Path,
        socket_path: &std::path::Path,
    ) -> std::process::Child {
        let bin = resolve_shim_binary()
            .expect("the shim binary should be resolvable after `cargo build --workspace`");
        let mut cmd = Command::new(&bin);
        cmd.arg0("rm");
        cmd.args(args);
        cmd.env("FLYWHEEL_REAL_RM", real_rm);
        cmd.env("FLYWHEEL_PERMISSION_SOCKET", socket_path);
        cmd.env_remove("FLYWHEEL_REAL_GIT");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.spawn().expect("the shim binary should be spawnable")
    }

    /// Mirrors [`run_shim_as_rm`] for `git` — Task 1's end-to-end proof that a delete-shaped push
    /// reaches the gate through the REAL built shim binary, not just through `classify` directly.
    fn run_shim_as_git(
        args: &[&str],
        real_git: &std::path::Path,
        socket_path: &std::path::Path,
        default_branch: &str,
        cwd: &std::path::Path,
    ) -> std::process::Child {
        let bin = resolve_shim_binary()
            .expect("the shim binary should be resolvable after `cargo build --workspace`");
        let mut cmd = Command::new(&bin);
        cmd.arg0("git");
        cmd.args(args);
        cmd.current_dir(cwd);
        cmd.env("FLYWHEEL_REAL_GIT", real_git);
        cmd.env("FLYWHEEL_PERMISSION_SOCKET", socket_path);
        cmd.env("FLYWHEEL_DEFAULT_BRANCH", default_branch);
        cmd.env_remove("FLYWHEEL_REAL_RM");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.spawn().expect("the shim binary should be spawnable")
    }

    #[test]
    fn an_allow_answer_executes_the_real_binary() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");
        let target = dir.path().join("marker.txt");
        std::fs::write(&target, b"delete me").expect("failed to write the marker file");

        let socket_path = scratch_socket_path("allow");
        let server = spawn_mock_permission_server(socket_path.clone(), Some("allow"));

        let child = run_shim_as_rm(&["-r", target.to_str().unwrap()], &real_rm, &socket_path);
        let output = child.wait_with_output().expect("the shim process should exit");

        assert!(
            output.status.success(),
            "expected the shim to exit successfully on allow, stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!target.exists(), "an allowed recursive rm must actually have deleted the file");
        server.join().expect("the mock server thread should not panic");
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn a_deny_answer_never_executes_the_real_binary() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");
        let target = dir.path().join("marker.txt");
        std::fs::write(&target, b"do not delete me").expect("failed to write the marker file");

        let socket_path = scratch_socket_path("deny");
        let server = spawn_mock_permission_server(socket_path.clone(), Some("deny"));

        let child = run_shim_as_rm(&["-r", target.to_str().unwrap()], &real_rm, &socket_path);
        let output = child.wait_with_output().expect("the shim process should exit");

        assert!(!output.status.success(), "expected a non-zero exit on deny");
        assert!(
            target.exists(),
            "a denied recursive rm must never have touched the file — checked by the side effect's absence, not the exit code alone"
        );
        server.join().expect("the mock server thread should not panic");
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn an_unanswered_socket_leaves_the_shim_blocked_with_no_side_effect() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");
        let target = dir.path().join("marker.txt");
        std::fs::write(&target, b"still here").expect("failed to write the marker file");

        let socket_path = scratch_socket_path("never-answers");
        let _server = spawn_mock_permission_server(socket_path.clone(), None);

        let mut child = run_shim_as_rm(&["-r", target.to_str().unwrap()], &real_rm, &socket_path);

        std::thread::sleep(Duration::from_secs(3));
        match child.try_wait().expect("try_wait should not error") {
            Some(status) => {
                panic!("expected the shim to still be blocked after 3s, but it exited with {status:?}")
            }
            None => {
                assert!(
                    target.exists(),
                    "the shim must not have executed anything while still waiting for an answer"
                );
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn two_consecutive_destructive_invocations_raise_two_distinct_request_ids() {
        let real_rm = resolve_system_rm();
        let dir = tempfile::tempdir().expect("failed to create a scratch directory");

        let first_target = dir.path().join("first.txt");
        std::fs::write(&first_target, b"one").expect("failed to write the first marker");
        let socket_a = scratch_socket_path("first");
        let server_a = spawn_mock_permission_server(socket_a.clone(), Some("allow"));
        let child_a = run_shim_as_rm(&["-r", first_target.to_str().unwrap()], &real_rm, &socket_a);
        let output_a = child_a.wait_with_output().expect("the first shim invocation should exit");
        assert!(output_a.status.success());
        let request_a = server_a.join().expect("server thread should not panic");
        let request_id_a = request_a["requestId"]
            .as_str()
            .expect("the request must carry a requestId")
            .to_string();

        let second_target = dir.path().join("second.txt");
        std::fs::write(&second_target, b"two").expect("failed to write the second marker");
        let socket_b = scratch_socket_path("second");
        let server_b = spawn_mock_permission_server(socket_b.clone(), Some("allow"));
        let child_b = run_shim_as_rm(&["-r", second_target.to_str().unwrap()], &real_rm, &socket_b);
        let output_b = child_b.wait_with_output().expect("the second shim invocation should exit");
        assert!(output_b.status.success());
        let request_b = server_b.join().expect("server thread should not panic");
        let request_id_b = request_b["requestId"]
            .as_str()
            .expect("the request must carry a requestId")
            .to_string();

        assert_ne!(
            request_id_a, request_id_b,
            "two destructive invocations must each raise their own new request id — no cached prior answer (D-57)"
        );

        let _ = std::fs::remove_file(&socket_a);
        let _ = std::fs::remove_file(&socket_b);
    }

    /// Task 1's end-to-end proof (T-03-14-01): the REAL built shim binary, invoked as `git` with a
    /// delete-shaped push, raises a real permission request over a real socket carrying
    /// `destructiveCategory: "branch-deletion"`, and a `deny` answer means the real git binary
    /// named by `FLYWHEEL_REAL_GIT` is never executed. The scratch repository needs no real
    /// remote — the point is that the gate fires BEFORE git is ever reached, so the command never
    /// has to be executable to prove the claim; that fact is established directly by asserting a
    /// non-zero exit (the denial) rather than any git-specific failure, together with the
    /// captured request line proving the gate is what actually fired.
    #[test]
    fn a_delete_shaped_push_raises_a_branch_deletion_request_and_is_never_executed_on_deny() {
        let real_git = resolve_system_git();
        let repo_dir = tempfile::tempdir().expect("failed to create a scratch repository");

        let run = |args: &[&str]| {
            Command::new(&real_git)
                .args(args)
                .current_dir(repo_dir.path())
                .output()
                .expect("real git should run for scratch repo setup")
        };
        assert!(run(&["init", "-q", "-b", "main"]).status.success());
        assert!(run(&["config", "user.name", "Test User"]).status.success());
        assert!(run(&["config", "user.email", "test@example.com"]).status.success());
        std::fs::write(repo_dir.path().join("README.md"), b"scratch\n")
            .expect("failed to write scratch file");
        assert!(run(&["add", "README.md"]).status.success());
        assert!(run(&["commit", "-q", "-m", "initial commit"]).status.success());
        assert!(run(&["checkout", "-q", "-b", "feature"]).status.success());
        assert!(run(&["checkout", "-q", "main"]).status.success());

        let socket_path = scratch_socket_path("git-delete-deny");
        let server = spawn_mock_permission_server(socket_path.clone(), Some("deny"));

        let child = run_shim_as_git(
            &["push", "origin", "--delete", "feature"],
            &real_git,
            &socket_path,
            "main",
            repo_dir.path(),
        );
        let output = child.wait_with_output().expect("the shim process should exit");

        assert!(
            !output.status.success(),
            "expected the shim to exit non-zero on deny, stdout: {}, stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        let request = server.join().expect("the mock server thread should not panic");
        assert_eq!(
            request["input"]["destructiveCategory"], "branch-deletion",
            "the wire payload's destructiveCategory must be branch-deletion for a delete-shaped push"
        );

        let _ = std::fs::remove_file(&socket_path);
    }
}
