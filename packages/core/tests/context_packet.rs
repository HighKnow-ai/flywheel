//! `assemble_context_packet`/`render_prompt` (plan 02-04 Task 1, D-28): every case in the plan's
//! `<behavior>` list as a named assertion. The determinism case is the load-bearing one — it
//! proves reproducibility, not mere constancy, by asserting the packet changes after a criterion
//! reorder and stays byte-identical otherwise.

mod common;

use core::context_packet::{assemble_context_packet, render_prompt};
use core::domain::acceptance_criterion::{create_criterion, reorder_criterion};
use core::domain::agent_run::start_agent_run;
use core::domain::epic::create_epic;
use core::domain::session_summary::{create_summary, DecisionEntry, SummaryFields};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;

// `cargo test` runs every `#[test]` fn in this file concurrently on separate OS threads by
// default, but `FLYWHEEL_WORKTREE_ROOT` is process-wide state — without serialising access, two
// tests' `set_var`/`remove_var` calls interleave and a thread can observe the wrong root mid-call
// (reproduced: `ensure_worktree` resolving against the real `~/Flywheel/` instead of the scratch
// dir this test just set). This mutex scopes the fix to this file alone — each `tests/*.rs`
// integration test file compiles to its own binary, so it cannot race with `worktree_lifecycle.rs`
// or any other file's own (much smaller, apparently-safe-by-luck) use of the same pattern.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above — only one test at a time ever has
    // this var set within this binary, and it is always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

#[test]
fn determinism_two_calls_are_byte_identical_and_a_reorder_changes_the_output() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the thing", Some("Epic body"))
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Wire the packet", Some(&epic.id))
            .expect("create_task should succeed");
        let c1 = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "First criterion",
            Some("run the test"),
        )
        .expect("create_criterion 1 should succeed");
        let c2 = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Second criterion",
            None,
        )
        .expect("create_criterion 2 should succeed");

        let packet_a = assemble_context_packet(&conn, &task.id).expect("first assembly should succeed");
        let packet_b = assemble_context_packet(&conn, &task.id).expect("second assembly should succeed");
        assert_eq!(packet_a, packet_b, "two calls against an unchanged database must be structurally equal");

        let prompt_a = render_prompt(&packet_a, "");
        let prompt_b = render_prompt(&packet_b, "");
        assert_eq!(prompt_a, prompt_b, "rendered prompts must be byte-identical across calls");
        assert_eq!(
            packet_a.criteria[0].statement, c1.statement,
            "criteria should read in rank order before any reorder"
        );
        assert_eq!(packet_a.criteria[1].statement, c2.statement);

        // Reorder: move c2 before c1 (append after nothing — to the very front is unsupported by
        // `reorder_criterion`, so move c1 to be after c2 instead, which still changes the order).
        reorder_criterion(&mut conn, &actor_id, &c1.id, Some(&c2.rank), None)
            .expect("reorder_criterion should succeed");

        let packet_c = assemble_context_packet(&conn, &task.id).expect("third assembly should succeed");
        let prompt_c = render_prompt(&packet_c, "");
        assert_ne!(
            prompt_a, prompt_c,
            "the rendered prompt must change after a criterion reorder — this is what proves \
             determinism rather than mere constancy"
        );
        assert_eq!(packet_c.criteria[0].statement, c2.statement, "c2 should now be first");
        assert_eq!(packet_c.criteria[1].statement, c1.statement, "c1 should now be second");
    });
}

#[test]
fn a_task_with_no_epic_yields_an_absent_epic_section() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No epic here", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.epic.is_none(), "epic section must be absent, not an empty-string title");

        let prompt = render_prompt(&packet, "");
        assert!(!prompt.contains("Epic Context"), "no epic heading should be emitted");
    });
}

#[test]
fn a_task_with_no_description_yields_an_absent_task_description() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Bare task", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(
            packet.task_description.is_none(),
            "task description must be absent, not an empty string, for a task with none"
        );
    });
}

#[test]
fn zero_criteria_yields_an_empty_list_and_render_prompt_omits_the_criteria_heading() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No criteria yet", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.criteria.is_empty());

        let prompt = render_prompt(&packet, "");
        assert!(
            !prompt.contains("Acceptance Criteria"),
            "an empty criteria section must render no heading at all, not an empty section"
        );
    });
}

#[test]
fn an_existing_worktree_reports_the_stored_row_not_a_fresh_derivation() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Has a worktree", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        // Corrupt the stored base_branch with a sentinel value no fresh derivation could ever
        // produce — if `assemble_context_packet` recomputed instead of reading the row, this
        // sentinel would never appear in the packet.
        conn.execute(
            "UPDATE worktrees SET base_branch = 'sentinel-not-a-real-branch' WHERE id = ?1",
            rusqlite::params![worktree.id],
        )
        .expect("failed to corrupt the worktree row for this test");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.worktree.branch, worktree.branch);
        assert_eq!(packet.worktree.path, worktree.path);
        assert_eq!(
            packet.worktree.base_ref, "sentinel-not-a-real-branch",
            "the packet must report the row's stored base_branch, not a freshly derived value"
        );
    });
}

#[test]
fn a_task_with_no_worktree_yet_predicts_exactly_what_ensure_worktree_would_create() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Predicted epic", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Not started yet", Some(&epic.id))
            .expect("create_task should succeed");

        let predicted = assemble_context_packet(&conn, &task.id)
            .expect("assembly should succeed")
            .worktree;

        // The preview must not have cut the epic's integration branch or written the column —
        // this is the mutation this module's header comment forbids.
        let integration_branch_before: Option<String> = conn
            .query_row(
                "SELECT integration_branch FROM epics WHERE id = ?1",
                rusqlite::params![epic.id],
                |row| row.get(0),
            )
            .expect("epic row should exist");
        assert!(
            integration_branch_before.is_none(),
            "assembling the packet must never cut the epic's integration branch"
        );
        assert!(
            !core::git::rev_parse_verify(repo_dir.path(), &predicted.base_ref)
                .expect("rev_parse_verify should succeed"),
            "the predicted branch name must not exist in the repository — nothing was actually cut"
        );

        let actual = ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        assert_eq!(predicted.branch, actual.branch, "predicted branch must match what was actually created");
        assert_eq!(predicted.path, actual.path, "predicted path must match what was actually created");
        assert_eq!(
            predicted.base_ref, actual.base_branch,
            "predicted base ref must match the base branch ensure_worktree actually resolved"
        );
    });
}

#[test]
fn render_prompt_appends_the_instruction_heading_only_when_non_empty() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Instruction task", None)
            .expect("create_task should succeed");
        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");

        let with_instruction = render_prompt(&packet, "Please be careful with the migration.");
        assert!(with_instruction.contains("Additional Instructions"));
        assert!(with_instruction.contains("Please be careful with the migration."));

        let with_empty = render_prompt(&packet, "");
        assert!(!with_empty.contains("Additional Instructions"));

        let with_whitespace = render_prompt(&packet, "   \n\t  ");
        assert!(
            !with_whitespace.contains("Additional Instructions"),
            "a whitespace-only instruction must be treated as empty"
        );
    });
}

#[test]
fn render_prompt_is_byte_identical_across_calls_for_the_same_packet_and_instruction() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Stable render", None)
            .expect("create_task should succeed");
        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");

        let first = render_prompt(&packet, "steer it this way");
        let second = render_prompt(&packet, "steer it this way");
        assert_eq!(first, second);
    });
}

#[test]
fn determinism_holds_with_summaries_present() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Summaries determinism", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let make_fields = |n: usize| SummaryFields {
            changed_files: vec![format!("src/file_{n}.rs")],
            changed_prose: Some(format!("session {n}")),
            remains: None,
            next_session_must_know: None,
            decisions: vec![],
            acknowledged_decisions: vec![],
            diff_ref: None,
            auto_generated: false,
        };

        for n in 0..3 {
            create_summary(&mut conn, &run.id, make_fields(n), &actor_id)
                .expect("create_summary should succeed");
        }

        let packet_a = assemble_context_packet(&conn, &task.id).expect("first assembly should succeed");
        let packet_b = assemble_context_packet(&conn, &task.id).expect("second assembly should succeed");
        assert_eq!(packet_a, packet_b, "two packets with summaries present must be structurally equal");
        assert_eq!(packet_a.summaries.len(), 3);

        let prompt_a = render_prompt(&packet_a, "");
        let prompt_b = render_prompt(&packet_b, "");
        assert_eq!(prompt_a, prompt_b, "rendered prompts with summaries present must be byte-identical");

        create_summary(&mut conn, &run.id, make_fields(3), &actor_id)
            .expect("fourth create_summary should succeed");
        let packet_c = assemble_context_packet(&conn, &task.id).expect("third assembly should succeed");
        assert_ne!(
            packet_a, packet_c,
            "recording a further summary must produce a packet that differs from the first — the \
             assembler reads board state on every call rather than caching"
        );
    });
}

#[test]
fn assembling_the_packet_never_mutates_triggers_worktrees_or_agent_runs_row_counts() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Row count epic", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Row count task", Some(&epic.id))
            .expect("create_task should succeed");

        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .expect("count query should succeed")
        };

        let (triggers_before, worktrees_before, agent_runs_before) =
            (count("triggers"), count("worktrees"), count("agent_runs"));

        assemble_context_packet(&conn, &task.id).expect("assembly should succeed");

        assert_eq!(count("triggers"), triggers_before);
        assert_eq!(count("worktrees"), worktrees_before);
        assert_eq!(count("agent_runs"), agent_runs_before);
    });
}

// --- Compaction wiring (plan 04-08, CTX-05): the folded/verbatim split in `render_prompt` and
// `ContextPacket.compaction`. Every summary's content below is tagged with a distinctive,
// index-specific marker string so the narrative-absence assertions can prove a folded summary's
// prose does not merely go unrendered somewhere else, but is genuinely gone from the output.

fn distinctive_summary_fields(n: usize) -> SummaryFields {
    SummaryFields {
        changed_files: vec![format!("distinctive/file-{n}.rs")],
        changed_prose: Some(format!("distinctive-prose-marker-{n}")),
        remains: Some(format!("distinctive-remains-marker-{n}")),
        next_session_must_know: Some(format!("distinctive-next-marker-{n}")),
        decisions: vec![DecisionEntry {
            id: format!("dec-{n}"),
            statement: format!("distinctive-decision-statement-{n}"),
        }],
        acknowledged_decisions: vec![],
        diff_ref: None,
        // Mark the very first (oldest) summary auto-generated so a 9-summary run always has an
        // auto-generated entry among the four that fold — exercises the marker-survives-the-fold
        // behaviour without needing a dedicated fixture.
        auto_generated: n == 0,
    }
}

fn create_task_with_n_summaries(
    conn: &mut rusqlite::Connection,
    project_id: &str,
    actor_id: &str,
    task_name: &str,
    n: usize,
) -> core::domain::task::Task {
    let task = create_task(conn, project_id, actor_id, task_name, None)
        .expect("create_task should succeed");
    ensure_worktree(conn, &task.id, actor_id).expect("ensure_worktree should succeed");
    let run = start_agent_run(conn, &task.id, "acceptEdits", actor_id)
        .expect("start_agent_run should succeed");
    for i in 0..n {
        create_summary(conn, &run.id, distinctive_summary_fields(i), actor_id)
            .expect("create_summary should succeed");
    }
    task
}

#[test]
fn four_summaries_render_a_flat_list_with_no_folded_subsection_heading_or_boundary_line() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task =
            create_task_with_n_summaries(&mut conn, &project.id, &actor_id, "Four summaries", 4);

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.compaction.total, 4);
        assert_eq!(packet.compaction.folded_count, 0, "four summaries must fold nothing");

        let prompt = render_prompt(&packet, "");
        assert!(!prompt.contains("Earlier sessions (folded)"));
        assert!(!prompt.contains("Recent sessions (verbatim)"));
        assert!(
            !prompt.contains("are folded;"),
            "no boundary sentence should be emitted when nothing folded"
        );
    });
}

#[test]
fn nine_summaries_render_a_folded_subsection_with_four_entries_a_boundary_line_and_a_verbatim_subsection_with_five_entries(
) {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task =
            create_task_with_n_summaries(&mut conn, &project.id, &actor_id, "Nine summaries", 9);

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.compaction.total, 9);
        assert_eq!(packet.compaction.folded_count, 4);
        assert_eq!(packet.compaction.verbatim_count, 5);

        let prompt = render_prompt(&packet, "");
        assert!(prompt.contains("### Earlier sessions (folded)"));
        assert!(prompt.contains("### Recent sessions (verbatim)"));
        assert!(
            prompt.contains("Summaries 1-4 are folded; 5-9 are carried verbatim."),
            "the boundary sentence must state both ranges as arithmetic: {prompt}"
        );

        // Exactly four "### Session" headers must appear before the folded heading's counterpart
        // boundary line, and the section overall must carry nine Session headers total.
        let session_header_count = prompt.matches("### Session ").count();
        assert_eq!(session_header_count, 9, "all nine sessions must be rendered, folded or not");
    });
}

#[test]
fn every_decision_from_folded_summaries_appears_and_no_folded_prose_appears() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task_with_n_summaries(
            &mut conn,
            &project.id,
            &actor_id,
            "Folded decisions and prose",
            9,
        );

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt = render_prompt(&packet, "");

        // Folded entries are summaries 0..4 (0-based n), which fold under a nine-summary window.
        for n in 0..4 {
            assert!(
                prompt.contains(&format!("distinctive-decision-statement-{n}")),
                "folded summary {n}'s decision statement must survive the fold"
            );
            assert!(
                !prompt.contains(&format!("distinctive-prose-marker-{n}")),
                "folded summary {n}'s changed_prose must not appear anywhere in the rendered output"
            );
            assert!(
                !prompt.contains(&format!("distinctive-remains-marker-{n}")),
                "folded summary {n}'s remains text must not appear anywhere in the rendered output"
            );
            assert!(
                !prompt.contains(&format!("distinctive-next-marker-{n}")),
                "folded summary {n}'s next_session_must_know text must not appear anywhere in the \
                 rendered output"
            );
        }

        // Verbatim entries (4..9) keep every field, prose included.
        for n in 4..9 {
            assert!(prompt.contains(&format!("distinctive-prose-marker-{n}")));
            assert!(prompt.contains(&format!("distinctive-decision-statement-{n}")));
        }
    });
}

#[test]
fn every_changed_file_path_from_folded_summaries_appears_in_the_rendered_output() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task_with_n_summaries(
            &mut conn,
            &project.id,
            &actor_id,
            "Folded changed files",
            9,
        );

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt = render_prompt(&packet, "");

        for n in 0..4 {
            assert!(
                prompt.contains(&format!("distinctive/file-{n}.rs")),
                "folded summary {n}'s changed_files path must survive the fold"
            );
        }
    });
}

#[test]
fn a_folded_auto_generated_summary_still_renders_the_auto_generated_marker() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        // The oldest summary (n=0) is auto_generated: true per `distinctive_summary_fields`, and
        // falls inside the folded region for a nine-summary run.
        let task = create_task_with_n_summaries(
            &mut conn,
            &project.id,
            &actor_id,
            "Folded auto-generated marker",
            9,
        );

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.summaries[0].auto_generated);

        let prompt = render_prompt(&packet, "");
        assert!(
            prompt.contains("### Session 1 (auto-generated — no agent summary was recorded for this run)"),
            "the folded, auto-generated first session must still carry its marker: {prompt}"
        );
    });
}

#[test]
fn context_packet_compaction_reports_total_folded_and_verbatim_counts_and_ranges() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task_with_n_summaries(
            &mut conn,
            &project.id,
            &actor_id,
            "Compaction boundary fields",
            9,
        );

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.compaction.total, 9);
        assert_eq!(packet.compaction.folded_count, 4);
        assert_eq!(packet.compaction.verbatim_count, 5);
        assert_eq!(packet.compaction.folded_range, Some((1, 4)));
        assert_eq!(packet.compaction.verbatim_range, Some((5, 9)));
    });
}

#[test]
fn two_render_prompt_calls_for_the_same_packet_are_byte_identical_with_folding_in_effect() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task_with_n_summaries(
            &mut conn,
            &project.id,
            &actor_id,
            "Folding determinism",
            9,
        );

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt_a = render_prompt(&packet, "");
        let prompt_b = render_prompt(&packet, "");
        assert_eq!(
            prompt_a, prompt_b,
            "two render_prompt calls for the same packet must be byte-identical with folding in effect"
        );
    });
}

#[test]
fn two_assemble_context_packet_calls_against_an_unchanged_database_with_nine_summaries_return_equal_packets_including_equal_compaction(
) {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task_with_n_summaries(
            &mut conn,
            &project.id,
            &actor_id,
            "Compaction determinism",
            9,
        );

        let packet_a = assemble_context_packet(&conn, &task.id).expect("first assembly should succeed");
        let packet_b = assemble_context_packet(&conn, &task.id).expect("second assembly should succeed");
        assert_eq!(
            packet_a, packet_b,
            "two calls against an unchanged database must be structurally equal, compaction included"
        );
        assert_eq!(packet_a.compaction, packet_b.compaction);
    });
}

// ---- criterion evidence (D-142, plan 08-02) ---------------------------------------------------

use core::domain::acceptance_criterion::{check_criterion_with_anchor, revise_criterion, toggle_criterion, AnchorInput};

fn git(repo: &std::path::Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git").arg("-C").arg(repo).args(args).output().expect("spawn git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct Evidence {
    conn: rusqlite::Connection,
    actor: String,
    repo: tempfile::TempDir,
    task_id: String,
    criterion_id: String,
    sha: String,
}

/// A task whose worktree row names the real `flywheel/task-rich` branch, with one criterion.
fn evidence_fixture() -> Evidence {
    let (mut conn, actor, project, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let sha = git(repo.path(), &["rev-parse", b.task_rich]);
    let task = create_task(&mut conn, &project.id, &actor, "Evidence", None).expect("task");
    let c = create_criterion(&mut conn, &project.id, &actor, "task", &task.id, "Keeps working", None)
        .expect("criterion");
    conn.execute(
        "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
         VALUES (?1, ?2, ?3, '/nonexistent/worktree', ?4, 'main', 'active', ?5, '2026-01-01T00:00:00.000Z')",
        rusqlite::params![core::ids::new_id(), task.id, project.id, b.task_rich, actor],
    )
    .expect("worktree row");
    Evidence { conn, actor, repo, task_id: task.id, criterion_id: c.id, sha }
}

fn anchor_keep() -> Option<AnchorInput> {
    Some(AnchorInput { path: "keep.txt".into(), side: "new".into(), line_start: 3, line_end: 5 })
}

fn prompt_of(e: &Evidence) -> String {
    render_prompt(&assemble_context_packet(&e.conn, &e.task_id).expect("assembly"), "")
}

#[test]
fn an_unchecked_criterion_renders_no_evidence_line() {
    let e = evidence_fixture();
    let prompt = prompt_of(&e);
    assert!(prompt.contains("- Keeps working"));
    assert!(!prompt.contains("Evidence:"), "{prompt}");
}

#[test]
fn a_criterion_checked_with_no_anchor_renders_no_evidence_line() {
    let mut e = evidence_fixture();
    check_criterion_with_anchor(&mut e.conn, &e.actor, &e.criterion_id, None, &e.sha).unwrap();
    assert!(!prompt_of(&e).contains("Evidence:"));
}

#[test]
fn a_checked_anchored_criterion_names_path_range_and_short_sha() {
    let mut e = evidence_fixture();
    check_criterion_with_anchor(&mut e.conn, &e.actor, &e.criterion_id, anchor_keep(), &e.sha).unwrap();
    let prompt = prompt_of(&e);
    let line = format!("  Evidence: keep.txt lines 3-5 (new side) at {}; that file is unchanged since", &e.sha[..7]);
    assert!(prompt.contains(&line), "{prompt}");
}

#[test]
fn a_stale_anchor_says_the_file_has_changed_since() {
    let mut e = evidence_fixture();
    check_criterion_with_anchor(&mut e.conn, &e.actor, &e.criterion_id, anchor_keep(), &e.sha).unwrap();
    git(e.repo.path(), &["checkout", "-q", "flywheel/task-rich"]);
    std::fs::write(e.repo.path().join("keep.txt"), "rewritten after the check\n").unwrap();
    git(e.repo.path(), &["commit", "-q", "-am", "later work"]);
    let prompt = prompt_of(&e);
    assert!(prompt.contains("that file has changed since (1 commit touched it)"), "{prompt}");
    assert!(prompt_of(&e).contains("Keeps working"), "the check stands; only the evidence ages");
}

#[test]
fn an_anchor_sha_that_no_longer_resolves_never_reads_as_untouched() {
    let mut e = evidence_fixture();
    let ghost = "0123456789abcdef0123456789abcdef01234567";
    check_criterion_with_anchor(&mut e.conn, &e.actor, &e.criterion_id, anchor_keep(), ghost).unwrap();
    let prompt = prompt_of(&e);
    assert!(prompt.contains("no longer exists, so whether the file changed is unknown"), "{prompt}");
    assert!(!prompt.contains("unchanged since"));
}

#[test]
fn two_consecutive_assemblies_with_an_anchor_are_byte_identical() {
    let mut e = evidence_fixture();
    check_criterion_with_anchor(&mut e.conn, &e.actor, &e.criterion_id, anchor_keep(), &e.sha).unwrap();
    let a = assemble_context_packet(&e.conn, &e.task_id).unwrap();
    let b = assemble_context_packet(&e.conn, &e.task_id).unwrap();
    assert_eq!(a, b);
    assert_eq!(render_prompt(&a, ""), render_prompt(&b, ""));
}

#[test]
fn unchecking_removes_the_evidence_line_again() {
    let mut e = evidence_fixture();
    check_criterion_with_anchor(&mut e.conn, &e.actor, &e.criterion_id, anchor_keep(), &e.sha).unwrap();
    toggle_criterion(&mut e.conn, &e.actor, &e.criterion_id).unwrap();
    assert!(!prompt_of(&e).contains("Evidence:"));
}

#[test]
fn a_superseded_revision_contributes_nothing_and_the_successor_keeps_the_evidence() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let sha = git(repo.path(), &["rev-parse", "HEAD"]);
        let task = create_task(&mut conn, &project.id, &actor, "Superseded", None).unwrap();
        let c = create_criterion(&mut conn, &project.id, &actor, "task", &task.id, "Original wording", None).unwrap();
        let anchor = Some(AnchorInput { path: "README.md".into(), side: "new".into(), line_start: 1, line_end: 1 });
        check_criterion_with_anchor(&mut conn, &actor, &c.id, anchor, &sha).unwrap();
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor).unwrap();
        revise_criterion(&mut conn, &actor, &c.id, "Revised wording", None).unwrap();

        let packet = assemble_context_packet(&conn, &task.id).unwrap();
        assert_eq!(packet.criteria.len(), 1);
        assert_eq!(packet.criteria[0].statement, "Revised wording");
        let prompt = render_prompt(&packet, "");
        assert!(!prompt.contains("Original wording"));
        assert!(prompt.contains("Evidence: README.md lines 1-1"), "{prompt}");
    });
}

// ----- phase 09 plan 09-07: the dispatched briefing -----------------------------------------

use core::context_packet::{DISPATCHED_COMMIT_INSTRUCTION, SCOPE_SECTION_HEADING};
use core::domain::file_set::declare_file_set;
use core::file_set::parse_entry;

fn task_with_declared(declared: &[&str]) -> (rusqlite::Connection, String, tempfile::TempDir) {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Scoped work", None).expect("task");
    if !declared.is_empty() {
        let entries: Vec<_> = declared.iter().map(|d| parse_entry(d).expect("entry")).collect();
        declare_file_set(&mut conn, &task.id, &entries, &actor_id).expect("declare");
    }
    (conn, task.id, repo_dir)
}

#[test]
fn a_declared_task_names_its_scope_and_every_entry_in_the_briefing() {
    with_scratch_worktree_root(|| {
        let (conn, task_id, _repo) = task_with_declared(&["src/lib/", "docs/guide.md"]);
        let prompt = render_prompt(&assemble_context_packet(&conn, &task_id).expect("packet"), "");
        assert!(prompt.contains(SCOPE_SECTION_HEADING));
        assert!(prompt.contains("- src/lib/\n"));
        assert!(prompt.contains("- docs/guide.md\n"));
    });
}

#[test]
fn an_unarmed_task_has_no_scope_section_and_no_entry_list() {
    with_scratch_worktree_root(|| {
        let (conn, task_id, _repo) = task_with_declared(&[]);
        let packet = assemble_context_packet(&conn, &task_id).expect("packet");
        assert!(packet.file_set.is_empty());
        let prompt = render_prompt(&packet, "");
        assert!(!prompt.contains(SCOPE_SECTION_HEADING));
        assert!(!prompt.contains("declares the files"));
    });
}

#[test]
fn the_commit_instruction_is_in_a_dispatched_briefing_and_not_in_a_user_launched_one() {
    with_scratch_worktree_root(|| {
        let (conn, task_id, _repo) = task_with_declared(&["a/"]);
        let packet = assemble_context_packet(&conn, &task_id).expect("packet");
        let dispatched = render_prompt(&packet, DISPATCHED_COMMIT_INSTRUCTION);
        let by_hand = render_prompt(&packet, "");
        assert!(dispatched.contains(DISPATCHED_COMMIT_INSTRUCTION));
        assert!(dispatched.contains("Do not push"));
        assert!(!by_hand.contains(DISPATCHED_COMMIT_INSTRUCTION));
    });
}

#[test]
fn the_same_board_state_renders_the_same_bytes_dispatched_or_not() {
    with_scratch_worktree_root(|| {
        let (conn, task_id, _repo) = task_with_declared(&["a/", "b.txt"]);
        for instruction in ["", DISPATCHED_COMMIT_INSTRUCTION] {
            let first = render_prompt(&assemble_context_packet(&conn, &task_id).expect("packet"), instruction);
            let second = render_prompt(&assemble_context_packet(&conn, &task_id).expect("packet"), instruction);
            assert_eq!(first, second);
        }
    });
}
