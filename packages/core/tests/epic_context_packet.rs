//! Behavior under test (05-04-PLAN.md Tasks 1 and 3): `epic_context_packet::assemble_epic_context_packet`
//! / `render_epic_prompt` — the epic-scoped sibling of `context_packet.rs`. Every case in the
//! plan's own `<action>`/`<acceptance_criteria>` list, plus the two properties that decay
//! silently rather than loudly (determinism, extended to a second scope, and boundedness as a
//! crate-wide gate) — both get a structural assertion here, not a comment.
//!
//! `STATE.md` carries two live warnings of this exact class: `context_packet.rs`'s own unbounded
//! `SUMMARIES_SQL` read (a real, recorded, Phase-4-owned debt — this plan does NOT fix it, and the
//! `unbounded_reads` gate below does not scan `context_packet.rs` at all, only
//! `packages/core/src/query`), and `epic_roster`'s now-closed `EPIC_ROSTER_CEILING` exemption
//! (closed by plan 05-04 Task 2). This file's `unbounded_reads` gate exists so a THIRD unbounded
//! read is never added silently to `packages/core/src/query`.

mod common;

use core::domain::acceptance_criterion::{create_criterion, revise_criterion};
use core::domain::agent_run::start_agent_run;
use core::domain::authoring_proposal::{create_proposal, ProposalPayload, ProposalVerb};
use core::domain::authoring_session::start_authoring_run;
use core::domain::epic::create_epic;
use core::domain::project::create_project;
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use core::epic_context_packet::{assemble_epic_context_packet, render_epic_prompt, REJECTED_VERBATIM_WINDOW};
use rusqlite::{params, Connection};

use common::{seeded_git_project, seeded_project};

/// Same discipline `tests/context_packet.rs` established: `FLYWHEEL_WORKTREE_ROOT` is
/// process-wide state, so any test in THIS file that needs a real git worktree (only the
/// superseded-criterion test does) must serialise access to it.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Stage a proposal and immediately mark it terminal via a direct `UPDATE` — test fixture setup
/// only, standing in for the `reject_proposal`/assumption-accept write paths plan 05-05 adds.
/// Mirrors `epic_roster.rs`'s own `insert_epic_with` precedent: bypassing a not-yet-built domain
/// function to construct an exact fixture state a real one cannot yet produce.
fn stage_and_decide(
    conn: &mut Connection,
    run_id: &str,
    payload: ProposalPayload,
    status: &str,
    actor_id: &str,
    created_at: &str,
) -> String {
    let proposal = create_proposal(conn, run_id, ProposalVerb::Create, payload, None, None)
        .expect("create_proposal should succeed");
    conn.execute(
        "UPDATE authoring_proposals SET status = ?1, decided_by = ?2, decided_at = ?3, created_at = ?4 \
         WHERE id = ?5",
        params![status, actor_id, created_at, created_at, proposal.id],
    )
    .expect("UPDATE authoring_proposals should succeed");
    proposal.id
}

#[test]
fn packet_for_epic_id_none_has_every_section_absent_and_no_epic_heading() {
    let (conn, _actor_id, project) = seeded_project();

    let packet = assemble_epic_context_packet(&conn, &project.id, None)
        .expect("assembling a packet for epic_id = None should succeed");
    assert!(packet.epic.is_none(), "epic section must be absent, not an empty-string title");
    assert!(packet.task_roster.is_empty());
    assert!(packet.answered_assumptions.is_empty());
    assert!(packet.rejected.verbatim.is_empty());
    assert!(packet.rejected.folded.is_empty());
    assert!(packet.prior_authoring_runs.is_empty());

    let prompt = render_epic_prompt(&packet);
    assert!(!prompt.contains("## Epic"), "no epic heading should be emitted for an absent epic");
    assert!(!prompt.contains("## Task Roster"));
    assert!(!prompt.contains("## Answered Assumptions"));
    assert!(!prompt.contains("## Rejected Proposals"));
    assert!(!prompt.contains("## Prior Authoring Sessions"));
    assert!(
        prompt.contains("## Your Task"),
        "the challenge-stage instruction has no omit case, even for a wholly fresh epic"
    );
}

#[test]
fn packet_for_a_real_epic_includes_its_task_roster_with_current_criteria() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the thing", Some("Epic body"))
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Wire the packet", Some(&epic.id))
        .expect("create_task should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "First criterion", Some("run it"))
        .expect("create_criterion should succeed");

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("assembling a packet for a real epic should succeed");

    let epic_facts = packet.epic.clone().expect("epic section must be present");
    assert_eq!(epic_facts.title, "Ship the thing");
    assert_eq!(epic_facts.description.as_deref(), Some("Epic body"));
    assert_eq!(epic_facts.status, "backlog");

    assert_eq!(packet.task_roster.len(), 1);
    assert_eq!(packet.task_roster[0].title, "Wire the packet");
    assert_eq!(packet.task_roster[0].status, "backlog");
    assert_eq!(packet.task_roster[0].criteria.len(), 1);
    assert_eq!(packet.task_roster[0].criteria[0].statement, "First criterion");
    assert_eq!(packet.task_roster[0].criteria[0].verification_hint.as_deref(), Some("run it"));

    let prompt = render_epic_prompt(&packet);
    assert!(prompt.contains("## Epic"));
    assert!(prompt.contains("Ship the thing"));
    assert!(prompt.contains("## Task Roster"));
    assert!(prompt.contains("Wire the packet"));
    assert!(prompt.contains("First criterion"));
}

#[test]
fn a_superseded_criterion_is_absent_while_its_successor_is_present() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Locked epic", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Locked task", Some(&epic.id))
            .expect("create_task should succeed");
        let criterion = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Original wording",
            None,
        )
        .expect("create_criterion should succeed");

        // Lock the task (D-76): any agent_runs row, ever, for this task.
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        revise_criterion(&mut conn, &actor_id, &criterion.id, "Revised wording", None)
            .expect("revise_criterion should succeed and mint a successor, since the task is now locked");

        let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
            .expect("assembling the packet should succeed");
        assert_eq!(packet.task_roster.len(), 1);
        assert_eq!(
            packet.task_roster[0].criteria.len(),
            1,
            "only the current revision must appear, never the superseded predecessor"
        );
        assert_eq!(packet.task_roster[0].criteria[0].statement, "Revised wording");

        let prompt = render_epic_prompt(&packet);
        assert!(prompt.contains("Revised wording"));
        assert!(
            !prompt.contains("Original wording"),
            "a superseded statement must never reach an agent-facing prompt"
        );
    });
}

#[test]
fn rejected_fold_is_untouched_at_exactly_the_verbatim_window() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Rejection epic", None)
        .expect("create_epic should succeed");
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "readOnly", &actor_id)
        .expect("start_authoring_run should succeed");

    for n in 1..=REJECTED_VERBATIM_WINDOW {
        stage_and_decide(
            &mut conn,
            &run.id,
            ProposalPayload::Task { title: format!("proposal-{n:02}"), description: None },
            "rejected",
            &actor_id,
            &format!("2026-01-{n:02}T00:00:00Z"),
        );
    }

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("assembling the packet should succeed");
    assert_eq!(packet.rejected.verbatim.len(), REJECTED_VERBATIM_WINDOW);
    assert_eq!(packet.rejected.folded.len(), 0, "exactly the window's worth must fold nothing");
    assert_eq!(packet.rejected.boundary.folded_count, 0);
    assert!(packet.rejected.boundary.boundary_sentence().is_none());

    let prompt = render_epic_prompt(&packet);
    assert!(prompt.contains("## Rejected Proposals"));
    assert!(prompt.contains("not to be re-proposed") || prompt.contains("Do not re-propose"));
    assert!(!prompt.contains("summarized only"), "nothing folded means no boundary sentence at all");
}

#[test]
fn rejected_fold_begins_one_past_the_verbatim_window_with_a_boundary_sentence() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Rejection epic plus one", None)
        .expect("create_epic should succeed");
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "readOnly", &actor_id)
        .expect("start_authoring_run should succeed");

    let total = REJECTED_VERBATIM_WINDOW + 1;
    for n in 1..=total {
        stage_and_decide(
            &mut conn,
            &run.id,
            ProposalPayload::Task { title: format!("proposal-{n:02}"), description: None },
            "rejected",
            &actor_id,
            &format!("2026-02-{n:02}T00:00:00Z"),
        );
    }

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("assembling the packet should succeed");
    assert_eq!(packet.rejected.verbatim.len(), REJECTED_VERBATIM_WINDOW);
    assert_eq!(packet.rejected.folded.len(), 1);
    assert_eq!(packet.rejected.boundary.total, total);
    assert_eq!(packet.rejected.boundary.verbatim_count, REJECTED_VERBATIM_WINDOW);
    assert_eq!(packet.rejected.boundary.folded_count, 1);

    // The oldest proposal (created_at "2026-02-01...", the lowest ordinal) is the one that folds,
    // since verbatim carries the most RECENT window and the read is ordered newest-first.
    assert_eq!(packet.rejected.folded[0].label, "proposal-01");
    assert!(
        packet.rejected.verbatim.iter().all(|entry| {
            match &entry.payload {
                ProposalPayload::Task { title, .. } => title != "proposal-01",
                _ => true,
            }
        }),
        "the folded (oldest) proposal must not also appear in the verbatim set"
    );

    let sentence = packet
        .rejected
        .boundary
        .boundary_sentence()
        .expect("one proposal past the window must produce a boundary sentence");
    let prompt = render_epic_prompt(&packet);
    assert!(prompt.contains(&sentence));
    assert!(prompt.contains("proposal-01 (older, summarized)") || prompt.contains("proposal-01"));
}

#[test]
fn two_assemblies_over_identical_board_state_are_partialeq_equal() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Determinism epic", Some("body"))
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Determinism task", Some(&epic.id))
        .expect("create_task should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "A criterion", None)
        .expect("create_criterion should succeed");

    let packet_a = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("first assembly should succeed");
    let packet_b = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("second assembly should succeed");
    assert_eq!(packet_a, packet_b, "two assemblies over an unchanged database must be structurally equal");
    assert_eq!(render_epic_prompt(&packet_a), render_epic_prompt(&packet_b));
}

#[test]
fn packet_never_leaks_a_row_from_a_different_project() {
    let (mut conn, actor_id, project_a) = seeded_project();
    let project_b = create_project(&mut conn, &actor_id, "Second Project", "/repo-b", "SEC", "main")
        .expect("create_project should succeed");

    let epic_a = create_epic(&mut conn, &project_a.id, &actor_id, "Shared-shape epic", Some("A's body"))
        .expect("create_epic A should succeed");
    let task_a = create_task(&mut conn, &project_a.id, &actor_id, "Shared-shape task", Some(&epic_a.id))
        .expect("create_task A should succeed");
    create_criterion(&mut conn, &project_a.id, &actor_id, "task", &task_a.id, "A's criterion", None)
        .expect("create_criterion A should succeed");
    let run_a = start_authoring_run(&mut conn, &project_a.id, Some(&epic_a.id), "readOnly", &actor_id)
        .expect("start_authoring_run A should succeed");
    stage_and_decide(
        &mut conn,
        &run_a.id,
        ProposalPayload::Task { title: "A's rejected proposal".to_string(), description: None },
        "rejected",
        &actor_id,
        "2026-03-01T00:00:00Z",
    );

    let epic_b = create_epic(&mut conn, &project_b.id, &actor_id, "Shared-shape epic", Some("B's body"))
        .expect("create_epic B should succeed");
    let task_b = create_task(&mut conn, &project_b.id, &actor_id, "Shared-shape task", Some(&epic_b.id))
        .expect("create_task B should succeed");
    create_criterion(&mut conn, &project_b.id, &actor_id, "task", &task_b.id, "B's criterion", None)
        .expect("create_criterion B should succeed");
    let run_b = start_authoring_run(&mut conn, &project_b.id, Some(&epic_b.id), "readOnly", &actor_id)
        .expect("start_authoring_run B should succeed");
    stage_and_decide(
        &mut conn,
        &run_b.id,
        ProposalPayload::Task { title: "B's rejected proposal".to_string(), description: None },
        "rejected",
        &actor_id,
        "2026-03-01T00:00:00Z",
    );

    let packet = assemble_epic_context_packet(&conn, &project_a.id, Some(&epic_a.id))
        .expect("assembling project A's packet should succeed");

    assert_eq!(packet.epic.as_ref().unwrap().description.as_deref(), Some("A's body"));
    assert!(packet.task_roster.iter().all(|t| t.title == "Shared-shape task"));
    assert_eq!(packet.task_roster.len(), 1, "only project A's one task may appear");
    assert!(packet
        .task_roster
        .iter()
        .flat_map(|t| &t.criteria)
        .all(|c| c.statement == "A's criterion"));
    assert!(packet.rejected.verbatim.iter().all(|entry| match &entry.payload {
        ProposalPayload::Task { title, .. } => title == "A's rejected proposal",
        _ => true,
    }));

    let prompt = render_epic_prompt(&packet);
    assert!(!prompt.contains("B's body"));
    assert!(!prompt.contains("B's criterion"));
    assert!(!prompt.contains("B's rejected proposal"));
}

// --- Task 3(a): determinism, extended to a second scope, and write-freedom proven directly by a
// row-count snapshot rather than by grep.

#[test]
fn five_consecutive_assemblies_are_equal_byte_identical_and_write_nothing() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "epic-01", Some("epic-01 body"))
        .expect("create_epic should succeed");

    for n in 1..=3 {
        let task = create_task(&mut conn, &project.id, &actor_id, &format!("task-{n:02}"), Some(&epic.id))
            .expect("create_task should succeed");
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            &format!("criterion-{n:02}"),
            None,
        )
        .expect("create_criterion should succeed");
    }

    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "readOnly", &actor_id)
        .expect("start_authoring_run should succeed");

    for n in 1..=2 {
        stage_and_decide(
            &mut conn,
            &run.id,
            ProposalPayload::Assumption {
                assumption: format!("assumption-{n:02}"),
                answer: format!("answer-{n:02}"),
            },
            "accepted",
            &actor_id,
            &format!("2026-04-{n:02}T00:00:00Z"),
        );
    }

    let rejected_total = REJECTED_VERBATIM_WINDOW + 2;
    for n in 1..=rejected_total {
        stage_and_decide(
            &mut conn,
            &run.id,
            ProposalPayload::Criterion {
                statement: format!("rejected-criterion-{n:02}"),
                verification_hint: None,
            },
            "rejected",
            &actor_id,
            &format!("2026-05-{n:02}T00:00:00Z"),
        );
    }

    let count = |table: &str| -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .expect("count query should succeed")
    };
    let tables = ["epics", "tasks", "acceptance_criteria", "authoring_proposals", "events", "agent_runs"];
    let before: Vec<i64> = tables.iter().map(|t| count(t)).collect();

    let mut packets = Vec::with_capacity(5);
    let mut prompts = Vec::with_capacity(5);
    for _ in 0..5 {
        let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
            .expect("assembly should succeed");
        // Interleave with a read-only operation — never a write.
        let _ = count("epics");
        prompts.push(render_epic_prompt(&packet));
        packets.push(packet);
    }

    let after: Vec<i64> = tables.iter().map(|t| count(t)).collect();
    assert_eq!(before, after, "five assemblies (plus interleaved reads) must not change any row count");

    for packet in &packets[1..] {
        assert_eq!(packet, &packets[0], "all five packets must be PartialEq-equal");
    }
    for prompt in &prompts[1..] {
        assert_eq!(prompt, &prompts[0], "all five rendered prompts must be byte-identical");
    }
}

// --- Task 3(b): boundedness as a crate-wide gate over `packages/core/src/query`.

/// Deliberate, named exceptions to the "every `SELECT` in `packages/core/src/query` carries a
/// `LIMIT`" rule — each one bounded some OTHER way (a `COUNT`/aggregate with no `GROUP BY` always
/// returns exactly one row; a `GROUP BY` over the fixed 5-value status domain or the fixed
/// pending/accepted/rejected proposal-status domain returns at most that many rows; a correlated
/// subquery joined or unioned into an already-`LIMIT`'d outer statement; a read filtered on a
/// `UNIQUE` column; a per-project board signal whose row count is bounded by the project's own
/// task count, not by an unbounded log). Named by the identifier that owns the `SELECT` (a
/// `const` name or a function name) so a rename or a genuinely new unbounded read both surface as
/// a real diff here, not a silent pass.
///
/// This allowlist does NOT include `context_packet.rs`'s own `SUMMARIES_SQL` — that file is
/// OUTSIDE `packages/core/src/query` (this gate's own scope) and is a real, already-recorded
/// `STATE.md` debt ("Bound the context packet before task histories get long", PROJECT.md Active
/// requirements). Widening this gate to also cover `context_packet.rs` and then allowlisting
/// `SUMMARIES_SQL` away would quietly fold a Phase-4-owned debt into this plan's own closure —
/// exactly what this plan's own action text forbids. `SUMMARIES_SQL` stays unfixed, named here
/// only so this gate is honest about what it is currently tolerating, not because the scanner
/// below ever reaches it.
const ALLOWED_UNBOUNDED_SELECTS: &[&str] = &[
    "WORKTREE_SUMMARY_SQL",     // agent_runs.rs — filtered on worktrees.task_id, a UNIQUE column
    "CRITERIA_JOIN",            // mod.rs — a correlated subquery LEFT JOINed into a LIMIT'd outer query
    "board_band_counts",        // mod.rs — GROUP BY over the fixed 5-value status domain
    "search_band_counts",       // search.rs — GROUP BY over the fixed 5-value status domain
    "FILTER_WHERE",             // filter.rs — json_each subqueries bounded by the caller's own JSON array
    "BLOCKED_TASK_IDS_SQL",     // permissions.rs — bounded by the project's own blocked-task count
    "BLOCKED_COUNT_SQL",        // permissions.rs — COUNT(*) with no GROUP BY, always one row
    "PENDING_REQUESTS_FOR_RUN_SQL", // permissions.rs — its own doc comment: "Do not reintroduce a LIMIT here"
    "RECOVERY_TASK_IDS_SQL",    // recovery.rs — bounded by the project's own recovery-item count
    "RECOVERY_COUNT_SQL",       // recovery.rs — COUNT(*) with no GROUP BY, always one row
    "MATCH_WHERE",              // search.rs — a WHERE-clause fragment, always spliced into a LIMIT'd query
    "epics_from_clause",        // search.rs — a FROM-subquery fragment, always spliced into a LIMIT'd query
    "tasks_from_clause",        // search.rs — a FROM-subquery fragment, always spliced into a LIMIT'd query
    "AGENT_TASK_CRITERIA_SQL",  // authoring.rs (plan 05-04) — bounded by one task's own criteria count,
                                 // the same un-LIMIT'd-by-design shape context_packet.rs's own CRITERIA_SQL uses
    "proposal_status_counts",   // authoring.rs (plan 05-04) — GROUP BY over the fixed 3-value proposal status domain
];

fn strip_comment_lines(source: &str) -> String {
    source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A coarse, deliberately conservative split of `source` into top-level chunks — one per
/// `const`/`fn`/`pub fn`/`pub(crate) fn` declared at column 0. Good enough to keep a
/// `.concat()`-joined, multi-literal `SELECT ... LIMIT` statement (this crate's own idiom) inside
/// ONE chunk, so appending a `LIMIT` fragment via a separate string literal is still detected as
/// belonging to the same read — the granularity this gate needs, not a full SQL parse.
fn split_into_chunks(source: &str) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in source.lines() {
        let is_boundary = !line.starts_with(' ')
            && !line.starts_with('\t')
            && (line.starts_with("fn ")
                || line.starts_with("pub fn ")
                || line.starts_with("pub(crate) fn ")
                || line.starts_with("const ")
                || line.starts_with("pub const ")
                || line.starts_with("pub(crate) const "));
        if is_boundary && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Every double-quoted string-literal's CONTENTS in `chunk`, concatenated in order — this is what
/// `SELECT`/`LIMIT` are matched against, never the chunk's raw source text, so a Rust identifier
/// that happens to CONTAIN the substring `SELECT` (`ITEM_SELECT_LIST`, `AGENT_TASK_CRITERIA_SQL`
/// would not, but the point stands) can never produce a false positive — only text a query
/// literally sends to SQLite counts.
fn extract_string_literals(chunk: &str) -> String {
    let mut result = String::new();
    let mut in_string = false;
    let mut chars = chunk.chars();
    while let Some(c) = chars.next() {
        if in_string {
            if c == '\\' {
                if let Some(escaped) = chars.next() {
                    result.push(escaped);
                }
                continue;
            }
            if c == '"' {
                in_string = false;
                continue;
            }
            result.push(c);
        } else if c == '"' {
            in_string = true;
        }
    }
    result
}

/// The identifier a chunk's own `SELECT` should be named by in [`ALLOWED_UNBOUNDED_SELECTS`] —
/// the token immediately following `fn `/`const ` (skipping any `pub`/`pub(crate)` prefix) on the
/// chunk's first line, up to the first `(`, `:` or whitespace.
fn chunk_identifier(chunk: &str) -> String {
    let first_line = chunk.lines().next().unwrap_or_default();
    let after_keyword = if let Some(rest) = first_line.split("fn ").nth(1) {
        rest
    } else if let Some(rest) = first_line.split("const ").nth(1) {
        rest
    } else {
        first_line
    };
    after_keyword
        .split(|c: char| c == '(' || c == ':' || c.is_whitespace())
        .next()
        .unwrap_or("<unknown>")
        .to_string()
}

#[test]
fn unbounded_reads_in_query_module_are_all_named_in_the_allowlist() {
    let query_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/query");
    let mut offenders = Vec::new();

    for entry in std::fs::read_dir(&query_dir).expect("reading src/query should succeed") {
        let entry = entry.expect("reading a src/query dir entry should succeed");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("reading a src/query file should succeed");
        let stripped = strip_comment_lines(&source);

        for chunk in split_into_chunks(&stripped) {
            let literal_text = extract_string_literals(&chunk);
            if !literal_text.contains("SELECT") {
                continue;
            }
            if literal_text.contains("LIMIT") {
                continue;
            }
            let identifier = chunk_identifier(&chunk);
            if !ALLOWED_UNBOUNDED_SELECTS.contains(&identifier.as_str()) {
                offenders.push(format!(
                    "{}: {identifier} contains a SELECT with no LIMIT and is not in ALLOWED_UNBOUNDED_SELECTS",
                    path.display()
                ));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "unbounded, unallowlisted SELECT(s) found under packages/core/src/query:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn rejected_proposal_read_names_the_epic_status_index_columns() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/epic_context_packet.rs"),
    )
    .expect("reading epic_context_packet.rs should succeed");
    assert!(
        source.contains("epic_id = ?1 AND status = 'rejected'"),
        "the rejected-set read must filter on epic_id and status, matching \
         idx_authoring_proposals_epic_status's own leading columns"
    );
    assert!(
        source.contains("ORDER BY created_at DESC"),
        "the rejected-set read must order by created_at DESC, the index's own trailing column"
    );
}
