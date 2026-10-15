//! Behavior under test (05-04-PLAN.md Tasks 1 and 3): `epic_context_packet::assemble_epic_context_packet`
//! / `render_epic_prompt` — the epic-scoped sibling of `context_packet.rs`. Every case in the
//! plan's own `<action>`/`<acceptance_criteria>` list, plus the two properties that decay
//! silently rather than loudly (determinism, extended to a second scope, and boundedness as a
//! crate-wide gate) — both get a structural assertion here, not a comment.
//!
//! The `unbounded_reads` gate below scans `packages/core/src/query`, `epic_context_packet.rs` and
//! (since plan 13-02, FNC-05) `context_packet.rs`: `SUMMARIES_SQL` is no longer a tolerated debt, it
//! carries a LIMIT. `epic_roster`'s `EPIC_ROSTER_CEILING` exemption was closed by plan 05-04 Task 2.
//! The gate exists so a further unbounded read is never added silently to any of those files.

mod common;

use core::domain::acceptance_criterion::{create_criterion, revise_criterion};
use core::domain::agent_run::start_agent_run;
use core::domain::authoring_proposal::{create_proposal, ProposalPayload, ProposalProvenance, ProposalVerb};
use core::domain::authoring_session::start_authoring_run;
use core::domain::epic::create_epic;
use core::domain::project::create_project;
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use core::epic_context_packet::{
    assemble_epic_context_packet, render_epic_prompt, CONTEXT_PACKET_READ_LIMIT, PRIOR_AUTHORING_RUNS_LIMIT,
    REJECTED_VERBATIM_WINDOW,
};
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
    let proposal = create_proposal(conn, run_id, ProposalVerb::Create, payload, None, None, ProposalProvenance::NONE)
        .expect("create_proposal should succeed");
    conn.execute(
        "UPDATE authoring_proposals SET status = ?1, decided_by = ?2, decided_at = ?3, created_at = ?4 \
         WHERE id = ?5",
        params![status, actor_id, created_at, created_at, proposal.id],
    )
    .expect("UPDATE authoring_proposals should succeed");
    proposal.id
}

/// Stage an ALREADY-DECIDED proposal directly, bypassing `create_proposal`'s own
/// `PROPOSAL_LIMIT_PER_RUN` write-side rule (plan 06-05) — used ONLY by the two "bounded at read
/// limit" tests below, which need more rows under one run than that limit now permits through the
/// public API to pin `assemble_epic_context_packet`'s own READ-side bound (a property of that
/// read's pagination, not of proposal authoring). Otherwise mirrors `stage_and_decide`'s own
/// shape (payload + immediately-terminal status + a caller-chosen `created_at`).
fn seed_raw_decided_proposal(
    conn: &Connection,
    run_id: &str,
    project_id: &str,
    epic_id: &str,
    actor_id: &str,
    payload: &ProposalPayload,
    status: &str,
    created_at: &str,
) {
    let payload_json = serde_json::to_string(payload).expect("failed to serialise proposal payload");
    conn.execute(
        "INSERT INTO authoring_proposals (
            id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
            parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
            created_by, created_at, decided_by, decided_at, rationale, origin_log_offset,
            duplicate_of, duplicate_score
        ) VALUES (?1, ?2, ?3, ?4, 'create', ?5, NULL, NULL, ?6, ?7, ?8, NULL, NULL, \
            ?9, ?10, ?9, ?10, NULL, NULL, NULL, NULL)",
        params![
            core::ids::new_id(),
            run_id,
            project_id,
            epic_id,
            payload.target_type().as_str(),
            core::ids::new_id(),
            payload_json,
            status,
            actor_id,
            created_at,
        ],
    )
    .expect("failed to seed a raw decided proposal");
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

    let prompt = render_epic_prompt(&packet, None);
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

// --- Plan 05-13 (gap G-05-2's second half): the developer's stated premise, threaded through as
// `render_epic_prompt`'s second argument rather than a packet field — a session input, never
// board state, so the packet's own assembly/determinism/purity contracts stay untouched.

#[test]
fn a_stated_premise_carries_under_its_own_heading_and_the_closing_instruction_names_it() {
    let (conn, _actor_id, project) = seeded_project();
    let packet = assemble_epic_context_packet(&conn, &project.id, None)
        .expect("assembling a packet for epic_id = None should succeed");

    let prompt = render_epic_prompt(&packet, Some("Build a Socratic epic-authoring flow"));
    assert!(
        prompt.contains("Build a Socratic epic-authoring flow"),
        "the stated premise text must appear in the rendered prompt"
    );
    assert!(
        prompt.contains("## Developer's Premise") || prompt.contains("Premise"),
        "the premise must carry its own heading, not be folded into another section"
    );
    assert!(
        prompt.contains("challenge the developer's framing"),
        "with a premise present, the closing instruction must speak about challenging the \
         STATED framing, exactly as it did before this plan"
    );
    assert!(
        prompt.contains("challenge") && prompt.contains("decompose") && prompt.contains("criteria")
            && prompt.contains("only the developer advances between them"),
        "plan 05-45 (G-05-9): the opening prompt must name the three-stage shape once, even with \
         a premise present, got: {prompt:?}"
    );
}

#[test]
fn no_premise_carries_no_premise_heading_and_the_closing_instruction_asks_instead_of_naming_a_framing()
{
    let (conn, _actor_id, project) = seeded_project();
    let packet = assemble_epic_context_packet(&conn, &project.id, None)
        .expect("assembling a packet for epic_id = None should succeed");

    let prompt = render_epic_prompt(&packet, None);
    assert!(
        !prompt.contains("## Developer's Premise"),
        "no premise section heading should be emitted when no premise was supplied"
    );
    assert!(
        !prompt.contains("challenge the developer's framing"),
        "without a premise there is no framing to challenge — the gap's own evidence: the old \
         wording instructed the model to challenge a framing that was never captured"
    );
    assert!(
        prompt.contains("ask") && prompt.to_lowercase().contains("what") && prompt.to_lowercase().contains("build"),
        "the no-premise closing instruction must ask the developer what they want to build, \
         got: {prompt:?}"
    );
    assert!(
        prompt.contains("Do not propose tasks or criteria until the developer advances the stage."),
        "both wordings keep the existing prohibition on drafting a plan before the developer advances"
    );
    assert!(
        prompt.contains("challenge") && prompt.contains("decompose") && prompt.contains("criteria")
            && prompt.contains("only the developer advances between them"),
        "plan 05-45 (G-05-9): the opening prompt must name the three-stage shape once, even for a \
         wholly fresh epic with no premise, got: {prompt:?}"
    );
}

#[test]
fn a_blank_or_whitespace_only_premise_is_treated_exactly_like_no_premise_at_all() {
    let (conn, _actor_id, project) = seeded_project();
    let packet = assemble_epic_context_packet(&conn, &project.id, None)
        .expect("assembling a packet for epic_id = None should succeed");

    let blank_prompt = render_epic_prompt(&packet, Some("   \n\t  "));
    let absent_prompt = render_epic_prompt(&packet, None);
    assert_eq!(
        blank_prompt, absent_prompt,
        "a whitespace-only premise must render identically to no premise at all"
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
    assert_eq!(packet.task_roster[0].status, "todo");
    assert_eq!(packet.task_roster[0].criteria.len(), 1);
    assert_eq!(packet.task_roster[0].criteria[0].statement, "First criterion");
    assert_eq!(packet.task_roster[0].criteria[0].verification_hint.as_deref(), Some("run it"));

    let prompt = render_epic_prompt(&packet, None);
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

        let prompt = render_epic_prompt(&packet, None);
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
            ProposalPayload::Task { title: format!("proposal-{n:02}"), description: None, priority: None },
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

    let prompt = render_epic_prompt(&packet, None);
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
            ProposalPayload::Task { title: format!("proposal-{n:02}"), description: None, priority: None },
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
    let prompt = render_epic_prompt(&packet, None);
    assert!(prompt.contains(&sentence));
    assert!(prompt.contains("proposal-01 (older, summarized)") || prompt.contains("proposal-01"));
}

// WR-02 (plan 05-09 code review): both the rejected-proposal and answered-assumption reads used
// to have no LIMIT at all — an epic reshaped many times over its life would read its entire
// history on every packet assembly. These two tests prove both reads are now actually bounded at
// CONTEXT_PACKET_READ_LIMIT, not merely documented as bounded.

#[test]
fn rejected_proposals_read_is_bounded_at_the_context_packet_read_limit_and_keeps_the_newest() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Rejection-heavy epic", None)
        .expect("create_epic should succeed");
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "readOnly", &actor_id)
        .expect("start_authoring_run should succeed");

    let total = CONTEXT_PACKET_READ_LIMIT + 10;
    for n in 1..=total {
        seed_raw_decided_proposal(
            &conn,
            &run.id,
            &project.id,
            &epic.id,
            &actor_id,
            &ProposalPayload::Task { title: format!("proposal-{n:04}"), description: None, priority: None },
            "rejected",
            &format!("2026-06-{:02}T{:02}:{:02}:00Z", 1 + (n / 1440) % 28, (n / 60) % 24, n % 60),
        );
    }

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("assembling the packet should succeed");
    assert_eq!(
        packet.rejected.boundary.total as i64, CONTEXT_PACKET_READ_LIMIT,
        "the read itself must be capped at CONTEXT_PACKET_READ_LIMIT rows, not the whole \
         rejected-proposal history for this epic"
    );
    // The newest proposal (the highest ordinal, since created_at increases with n) must still be
    // present in the verbatim window — the LIMIT trims the TAIL of the newest-first read, never
    // the head.
    assert!(
        packet.rejected.verbatim.iter().any(|entry| match &entry.payload {
            ProposalPayload::Task { title, .. } => title == &format!("proposal-{total:04}"),
            _ => false,
        }),
        "the most recently rejected proposal must survive the bound"
    );
}

#[test]
fn answered_assumptions_read_is_bounded_at_the_context_packet_read_limit_and_keeps_the_newest() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Assumption-heavy epic", None)
        .expect("create_epic should succeed");
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "readOnly", &actor_id)
        .expect("start_authoring_run should succeed");

    let total = CONTEXT_PACKET_READ_LIMIT + 10;
    for n in 1..=total {
        seed_raw_decided_proposal(
            &conn,
            &run.id,
            &project.id,
            &epic.id,
            &actor_id,
            &ProposalPayload::Assumption {
                assumption: format!("assumption-{n:04}"),
                answer: format!("answer-{n:04}"),
            },
            "accepted",
            &format!("2026-07-{:02}T{:02}:{:02}:00Z", 1 + (n / 1440) % 28, (n / 60) % 24, n % 60),
        );
    }

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("assembling the packet should succeed");
    assert_eq!(
        packet.answered_assumptions.len() as i64, CONTEXT_PACKET_READ_LIMIT,
        "the read itself must be capped at CONTEXT_PACKET_READ_LIMIT rows"
    );
    // Reversed back to ascending order for presentation — the LAST entry must be the newest
    // assumption actually staged, proving the bound kept the most recent rows, not the oldest.
    assert_eq!(
        packet.answered_assumptions.last().map(|a| a.assumption.as_str()),
        Some(format!("assumption-{total:04}").as_str()),
        "the most recently answered assumption must survive the bound and sort last"
    );
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
    assert_eq!(render_epic_prompt(&packet_a, None), render_epic_prompt(&packet_b, None));
    // Plan 05-13: the same property extended to a second scope — a `Some(premise)` argument must
    // render byte-identically across two renders of the SAME packet and the SAME premise text.
    assert_eq!(
        render_epic_prompt(&packet_a, Some("Build a thing")),
        render_epic_prompt(&packet_b, Some("Build a thing")),
        "two renders of the same packet and the same premise must be byte-identical"
    );
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
        ProposalPayload::Task { title: "A's rejected proposal".to_string(), description: None, priority: None },
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
        ProposalPayload::Task { title: "B's rejected proposal".to_string(), description: None, priority: None },
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

    let prompt = render_epic_prompt(&packet, None);
    assert!(!prompt.contains("B's body"));
    assert!(!prompt.contains("B's criterion"));
    assert!(!prompt.contains("B's rejected proposal"));
}

// --- Plan 05-10 Task 1: the end-to-end priming assertion — reopening a primed epic produces a
// prompt containing the roster, the answered assumptions, the rejected set and the
// do-not-re-propose sentence, all at once, the way a real reopened session actually reads it.
// (Individual sections are each covered above; this test is the journey, proving the three never
// silently stop fitting together in the SAME assembled packet.)

#[test]
fn reopening_a_primed_epic_produces_a_prompt_with_the_roster_assumptions_and_do_not_re_propose_sentence(
) {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the reopen flow", Some("Epic body"))
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Wire the door", Some(&epic.id))
        .expect("create_task should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Two doors exist", Some("read the plan"))
        .expect("create_criterion should succeed");

    // A first authoring run on this epic: an answered assumption, and a rejected proposal — the
    // exact two things D-83/D-89 exist to prime into the SECOND session.
    let run_1 = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &actor_id)
        .expect("start_authoring_run (first session) should succeed");
    stage_and_decide(
        &mut conn,
        &run_1.id,
        ProposalPayload::Assumption {
            assumption: "Should this ship behind a flag?".to_string(),
            answer: "No, ship it plainly.".to_string(),
        },
        "accepted",
        &actor_id,
        "2026-03-01T00:00:00Z",
    );
    stage_and_decide(
        &mut conn,
        &run_1.id,
        ProposalPayload::Task { title: "A task the developer already rejected".to_string(), description: None, priority: None },
        "rejected",
        &actor_id,
        "2026-03-01T00:01:00Z",
    );

    // Reopening: a SECOND authoring run against the SAME epic (SHAPE-05) — the same start path
    // with a subject, not a second flow.
    let run_2 = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &actor_id)
        .expect("start_authoring_run (reopened session) should succeed");
    assert_eq!(run_2.epic_id.as_deref(), Some(epic.id.as_str()));
    assert_eq!(
        run_2.authoring_stage.as_deref(),
        Some("challenge"),
        "a reopened run starts in challenge like any other (D-88) — the door does not skip it"
    );

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id))
        .expect("assembling the reopened epic's packet should succeed");
    let prompt = render_epic_prompt(&packet, None);

    // The task roster with its current-revision criteria.
    assert!(prompt.contains("## Task Roster"));
    assert!(prompt.contains("Wire the door"));
    assert!(prompt.contains("Two doors exist"));

    // The answered assumption from the first session.
    assert!(prompt.contains("## Answered Assumptions"));
    assert!(prompt.contains("Should this ship behind a flag?"));
    assert!(prompt.contains("No, ship it plainly."));

    // The rejected set, and the literal sentence telling the model not to re-propose it.
    assert!(prompt.contains("## Rejected Proposals"));
    assert!(prompt.contains("A task the developer already rejected"));
    assert!(
        prompt.contains("Do not re-propose any of them"),
        "the priming prompt must literally tell the model not to re-propose what was rejected"
    );

    // Both authoring runs on this epic are visible as prior sessions.
    assert!(prompt.contains("## Prior Authoring Sessions"));
    assert_eq!(packet.prior_authoring_runs.len(), 2);
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
        prompts.push(render_epic_prompt(&packet, None));
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

/// An epic with `n` authoring runs, `started_at` rising with the ordinal; returns the epic id.
fn epic_with_authoring_runs(conn: &mut Connection, project_id: &str, actor_id: &str, n: usize) -> String {
    let epic = create_epic(conn, project_id, actor_id, &format!("Epic with {n} runs"), None)
        .expect("create_epic should succeed");
    for ordinal in 1..=n {
        let run = start_authoring_run(conn, project_id, Some(&epic.id), "readOnly", actor_id)
            .expect("start_authoring_run should succeed");
        conn.execute(
            "UPDATE agent_runs SET started_at = ?1 WHERE id = ?2",
            params![format!("2026-05-01T00:{ordinal:02}:00Z"), run.id],
        )
        .expect("failed to date a seeded authoring run");
    }
    epic.id
}

#[test]
fn prior_authoring_runs_are_bounded_and_keep_the_newest() {
    let (mut conn, actor_id, project) = seeded_project();
    let total = PRIOR_AUTHORING_RUNS_LIMIT + 5;
    let over = epic_with_authoring_runs(&mut conn, &project.id, &actor_id, total);
    let under = epic_with_authoring_runs(&mut conn, &project.id, &actor_id, PRIOR_AUTHORING_RUNS_LIMIT - 4);

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&over)).expect("assembly should succeed");
    assert_eq!(packet.prior_authoring_runs.len(), PRIOR_AUTHORING_RUNS_LIMIT);
    let oldest_kept = format!("2026-05-01T00:{:02}:00Z", total - PRIOR_AUTHORING_RUNS_LIMIT + 1);
    assert_eq!(packet.prior_authoring_runs[0].started_at, format!("2026-05-01T00:{total:02}:00Z"));
    assert_eq!(packet.prior_authoring_runs.last().unwrap().started_at, oldest_kept);

    let packet = assemble_epic_context_packet(&conn, &project.id, Some(&under)).expect("assembly should succeed");
    assert_eq!(packet.prior_authoring_runs.len(), PRIOR_AUTHORING_RUNS_LIMIT - 4);
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
/// `context_packet.rs` is inside this gate (plan 13-02, FNC-05). Its `SUMMARIES_SQL` is NOT in this
/// allowlist and is no longer a tolerated debt: it passes because it carries a LIMIT, fixed by
/// `compaction::SUMMARY_WINDOW`. Only that file's genuinely cardinality-one or one-row-bounded
/// reads are named below, each with its reason.
///
/// WR-02 (plan 05-09 code review): the scanner below also covers `epic_context_packet.rs`, which
/// sat silently outside the scanner's directory scope. Every still-unbounded read in that file is
/// named below with its own bounding justification; its authoring-run read carries a LIMIT and is
/// not listed (plan 13-12).
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
    "EPICS_MATCH_WHERE",        // search.rs — a WHERE-clause fragment, always spliced into a LIMIT'd query (split from MATCH_WHERE by 13-05)
    "TASKS_MATCH_WHERE",        // search.rs — as EPICS_MATCH_WHERE, for tasks_fts
    "epics_from_clause",        // search.rs — a FROM-subquery fragment, always spliced into a LIMIT'd query
    "tasks_from_clause",        // search.rs — a FROM-subquery fragment, always spliced into a LIMIT'd query
    "AGENT_TASK_CRITERIA_SQL",  // authoring.rs (plan 05-04) — bounded by one task's own criteria count,
                                 // the same un-LIMIT'd-by-design shape context_packet.rs's own CRITERIA_SQL uses
    "proposal_status_counts",   // authoring.rs (plan 05-04) — GROUP BY over the fixed 3-value proposal status domain
    "get_epic_for_agent",       // authoring.rs (plan 05-05) — query_row keyed by epics.id (PRIMARY KEY),
                                 // additionally scoped by project_id; at most one row by construction,
                                 // the same cardinality-one shape BLOCKED_COUNT_SQL/RECOVERY_COUNT_SQL
                                 // are already allowlisted for
    "EPIC_ROW_SQL",              // epic_context_packet.rs — query_row keyed by epics.id (PRIMARY KEY),
                                  // additionally scoped by project_id; at most one row by construction
    "EPIC_TASKS_SQL",            // epic_context_packet.rs — bounded by the one epic's own task count,
                                  // the same un-LIMIT'd-by-design shape AGENT_TASK_CRITERIA_SQL uses
    "TASK_CRITERIA_SQL",         // epic_context_packet.rs — bounded by one task's own current-revision
                                  // criteria count, the same shape AGENT_TASK_CRITERIA_SQL uses
    "board_epic_progress",      // epic_progress.rs (phase 08.1 plan 05) — three GROUP BY aggregates, DELIBERATELY
                                 // un-LIMIT'd: a row window is the defect that plan fixes (the unscoped board
                                 // read is 200 of 920 rows). Bounded by epics x 5 statuses, and by an explicit
                                 // EPIC_ROSTER_CEILING check that errors on truncation instead of cutting short
    "resolve_board_read",       // authoring.rs (plan 05-18, extracted from the desktop handler) —
                                  // its two inline SELECTs are both cardinality-one/aggregate: the
                                  // run's own project_id is a single row keyed by agent_runs' PRIMARY
                                  // KEY (the same shape get_epic_for_agent is already allowlisted
                                  // for), and the task COUNT(*) is a GROUP-BY-less aggregate (the
                                  // same shape BLOCKED_COUNT_SQL/RECOVERY_COUNT_SQL are allowlisted
                                  // for) — neither is a page read, so LIMIT does not apply to either
    "TASK_ROW_SQL",             // context_packet.rs (plan 13-02) — query_row keyed by tasks.id (PRIMARY KEY)
    "WORKTREE_ROW_SQL",         // context_packet.rs (plan 13-02) — query_row on worktrees.task_id, a UNIQUE column
    "PROJECT_DEFAULT_BRANCH_SQL", // context_packet.rs (plan 13-02) — query_row keyed by projects.id (PRIMARY KEY)
    "PROJECT_KEY_PREFIX_SQL",   // context_packet.rs (plan 13-02) — query_row keyed by projects.id (PRIMARY KEY)
    "CRITERIA_SQL",             // context_packet.rs (plan 13-02) — bounded by one task's own current-revision
                                 // criteria count, the AGENT_TASK_CRITERIA_SQL shape already allowlisted above
    "SUMMARIES_TOTAL_SQL",      // context_packet.rs (plan 13-02) — COUNT(*) with no GROUP BY, always one row
                                 // (`EPIC_ROW_SQL` there is already covered by its epic_context_packet.rs name)
    "task_header",              // authoring.rs (plan 11-22) — query_row keyed by tasks.id (PRIMARY KEY);
                                 // at most one row by construction, the get_epic_for_agent shape
    "epic_header",              // authoring.rs (plan 11-22) — query_row keyed by epics.id (PRIMARY KEY);
                                 // at most one row by construction, the get_epic_for_agent shape
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

/// WR-02 (plan 05-09 code review): a single file path is scanned exactly like one entry of a
/// scanned directory — [`unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist`]
/// treats `epic_context_packet.rs` as a one-file "directory" alongside every `.rs` file under
/// `src/query`, so both are checked by the identical chunk/literal/allowlist logic below.
fn scan_file_for_unbounded_selects(path: &std::path::Path, offenders: &mut Vec<String>) {
    let source = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("reading {} should succeed: {e}", path.display()));
    scan_source_for_unbounded_selects(&path.display().to_string(), &source, offenders);
}

/// The scanner proper, over source text already in memory — shared by the real-tree gate and by
/// [`the_unbounded_reads_gate_fires_on_a_planted_violation`], so the two-sided proof drives the
/// same logic the gate does.
fn scan_source_for_unbounded_selects(label: &str, source: &str, offenders: &mut Vec<String>) {
    let stripped = strip_comment_lines(source);

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
                "{label}: {identifier} contains a SELECT with no LIMIT and is not in ALLOWED_UNBOUNDED_SELECTS"
            ));
        }
    }
}

#[test]
fn unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let query_dir = manifest_dir.join("src/query");
    let mut offenders = Vec::new();

    for entry in std::fs::read_dir(&query_dir).expect("reading src/query should succeed") {
        let entry = entry.expect("reading a src/query dir entry should succeed");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        scan_file_for_unbounded_selects(&path, &mut offenders);
    }

    // WR-02: `epic_context_packet.rs` sat in the identical blind spot `context_packet.rs` is
    // explicitly, deliberately NOT swept into (see this file's own module doc comment and
    // `ALLOWED_UNBOUNDED_SELECTS`'s doc comment) — silently outside this gate's directory scope.
    // Scanned here, one file, with the same logic, so a fourth unbounded read is never added
    // silently to THIS file either.
    scan_file_for_unbounded_selects(&manifest_dir.join("src/epic_context_packet.rs"), &mut offenders);

    // FNC-05: `context_packet.rs` is no longer exempt. `SUMMARIES_SQL` passes by carrying a LIMIT.
    scan_file_for_unbounded_selects(&manifest_dir.join("src/context_packet.rs"), &mut offenders);

    assert!(
        offenders.is_empty(),
        "unbounded, unallowlisted SELECT(s) found under packages/core/src/query or in \
         epic_context_packet.rs or context_packet.rs:\n{}",
        offenders.join("\n")
    );
}

/// The other half of the gate. Without it the clean-tree assertion above passes trivially on a
/// scanner that never fires. A planted unbounded `SELECT` under an unallowlisted name is exactly
/// one offender; a bounded one and an allowlisted one are silent.
#[test]
fn the_unbounded_reads_gate_fires_on_a_planted_violation() {
    let planted = "\
const PLANTED_UNBOUNDED_SQL: &str = \"SELECT id FROM session_summaries WHERE task_id = ?1\";
const PLANTED_BOUNDED_SQL: &str = \"SELECT id FROM session_summaries WHERE task_id = ?1 LIMIT ?2\";
const SUMMARIES_TOTAL_SQL: &str = \"SELECT COUNT(*) FROM session_summaries WHERE task_id = ?1\";
";
    let mut offenders = Vec::new();
    scan_source_for_unbounded_selects("planted.rs", planted, &mut offenders);
    assert_eq!(offenders.len(), 1, "expected exactly the planted violation, got {offenders:?}");
    assert!(offenders[0].contains("PLANTED_UNBOUNDED_SQL"), "offender was {offenders:?}");
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
