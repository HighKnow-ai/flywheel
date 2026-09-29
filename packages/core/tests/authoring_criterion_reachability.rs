//! Gap G-05-9's finding, stated before any assertion in this file: **a staged proposal's id was
//! never returned to the agent that staged it, and no agent-visible tool could read it back, so
//! `propose_criterion` — whose `parent_proposal_id` is REQUIRED at `minLength: 1`
//! (`mcp-permission-server.ts:581-598`) — was unreachable in a fresh-epic session BY CONSTRUCTION.**
//! `stageAuthoringProposal` (`mcp-permission-server.ts:941-966`) resolves EVERY `propose_*` tool
//! call with the literal `{"staged": true}`, for any verb; the row's own id is minted Rust-side, in
//! `create_proposal_in_tx`, strictly AFTER that ack has already gone back to the agent. The agent's
//! only read tools were `board_search`, `epic_get` and `task_list` — none of them read
//! `authoring_proposals`. So a proposal could never become the parent of another proposal inside
//! its own session, and `Drafted criteria: 0` was not one live run's bad luck: it was the only
//! value the shipped design could produce. Live run `01M3ENQMC3E4M2HP7014MA84PX` was the first run
//! in this phase ever to get far enough to expose it (every prior live run died before the proposal
//! stage), and the agent diagnosed it correctly and unprompted in turn 8 of
//! `05-LIVE-CHALLENGE-TRANSCRIPT.md`.
//!
//! This round also corrects the gap's own framing. The gap asked whether D-07's invariant ("a
//! drafted criterion has no canonical parent until its own parent proposal is accepted") and
//! SHAPE-03's wording can both stand. They can: `accept_proposal_in_tx`'s D-96 implied-parent walk
//! (`authoring_proposal.rs:679-684`) already accepts a still-pending `parent_proposal_id` FIRST, in
//! the SAME transaction, before the criterion materialises — so a criterion drafted against an
//! unaccepted PROPOSAL never reaches `acceptance_criteria` with a dangling parent. The invariant was
//! never the blocker; the missing id was. The fix closed here is additive and reversible: a fourth
//! capped read tool / `readKind`, `list_proposals`, routed through the SAME `board_read` channel
//! `board_search`/`epic_get`/`task_list` already use, dispatched by `resolve_board_read` (this
//! file's own subject).
//!
//! Every fixture below seeds through the real domain functions this crate's other authoring suites
//! use (`common::seeded_project`, `authoring_session::start_authoring_run`,
//! `authoring_proposal::create_proposal`) — never a hand-rolled `INSERT` — mirroring
//! `authoring_board_read.rs`'s own discipline, and calls `resolve_board_read` directly, exactly as
//! both real callers (the desktop app's `handle_inbound_board_read_request` and the UAT bridge's
//! `answer-board-read`) do.

mod common;

use core::domain::authoring_proposal::{
    accept_proposal, create_proposal, ProposalPayload, ProposalVerb,
};
use core::domain::authoring_session::start_authoring_run;
use core::query::authoring::resolve_board_read;
use rusqlite::Connection;
use serde_json::json;

fn count_criteria(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0))
        .expect("count query should succeed")
}

/// THE load-bearing assertion (named for what it proves): a fresh-epic session can obtain the id of
/// a proposal it just staged, through the tool it actually has, and use that id to reach
/// `propose_criterion` — this test FAILS if the `list_proposals` arm this plan adds is removed,
/// because then `resolve_board_read` would return `Err("unknown board read kind \"list_proposals\"")`
/// instead of the epic's id, and the criterion below would have no `parent_proposal_id` to name.
#[test]
fn a_fresh_epic_session_reaches_propose_criterion_through_the_id_list_proposals_hands_back() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");

    // Stage an epic proposal — mirrors exactly what `propose_epic` does. Its id is minted here,
    // Rust-side, but (per this file's own finding) the shipped `propose_epic` tool never returned
    // it to the model that just called it.
    let epic_proposal = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Epic { title: "Reachability check epic".to_string(), description: None },
        None,
        None,
    )
    .expect("propose the epic");

    // The route an agent ACTUALLY has: a `list_proposals` board read, dispatched through the SAME
    // `resolve_board_read` both the desktop app and the UAT harness call — never a direct read of
    // `authoring_proposals` from this test.
    let answer = resolve_board_read(&conn, &run.id, &json!({ "readKind": "list_proposals" }))
        .expect("resolve_board_read(list_proposals) should succeed");
    let proposals = answer["proposals"].as_array().expect("proposals should be an array");
    assert_eq!(proposals.len(), 1, "expected exactly one pending proposal, got {proposals:?}");
    let returned_id = proposals[0]["id"].as_str().expect("id should be a string");
    assert_eq!(
        returned_id, epic_proposal.id,
        "the id list_proposals hands back must be the SAME id create_proposal minted — the two \
         representations of the same fact must agree"
    );
    assert_eq!(proposals[0]["targetType"], json!("epic"));

    // `propose_criterion` is now reachable: stage a criterion naming the STILL-PENDING epic
    // proposal's id as its `parent_proposal_id`. Plan 05-48 made this reachable directly from the
    // staging call's own tool result; `list_proposals` (proved below and exercised here to pin its
    // own reachability property) remains a second, still-valid way to obtain the same id.
    let criterion_proposal = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion {
            statement: "Reachability check criterion".to_string(),
            verification_hint: None,
        },
        None,
        Some(returned_id),
    )
    .expect("propose the criterion against the still-pending epic proposal's id");

    assert_eq!(count_criteria(&conn), 0, "a staged proposal must not materialise anything yet");

    // Accepting the CRITERION drives D-96's implied-parent walk: it accepts the still-pending epic
    // proposal FIRST, in the same transaction, then materialises the criterion against it.
    let outcome = accept_proposal(&mut conn, &criterion_proposal.id, &actor_id).expect(
        "accepting the criterion must succeed — D-96's implied-parent walk accepts the \
         still-pending epic proposal first",
    );
    assert!(!outcome.materialised_id.is_empty());
    assert_eq!(
        count_criteria(&conn),
        1,
        "the load-bearing assertion: a real acceptance_criteria row must exist once the criterion \
         proposal, staged against a still-pending parent's id obtained via list_proposals, is \
         accepted — this is exactly what `Drafted criteria: 0` could never produce"
    );
}

/// A run with nothing staged resolves `list_proposals` to an empty page with `truncated: false` —
/// never an error. An agent calling `proposal_list` (the MCP tool name `list_proposals` is
/// dispatched through) before it has proposed anything must see "you have proposed nothing yet",
/// not a failure.
#[test]
fn list_proposals_on_a_run_with_nothing_staged_is_an_empty_page_not_an_error() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");

    let answer = resolve_board_read(&conn, &run.id, &json!({ "readKind": "list_proposals" }))
        .expect("resolve_board_read(list_proposals) should succeed for a run with nothing staged");

    assert_eq!(answer["proposals"], json!([]));
    assert_eq!(answer["truncated"], json!(false));
}

/// V4 Access Control, asserted rather than asserted-about: a `list_proposals` read resolved for
/// run A's own id must not return a proposal staged by run B, even against the SAME project. Scope
/// comes from the `run_id` PARAMETER `resolve_board_read` receives, never from anything the event
/// itself claims.
#[test]
fn list_proposals_for_run_a_does_not_leak_run_bs_proposal() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run_a = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run (a) should succeed");
    let run_b = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run (b) should succeed");

    create_proposal(
        &mut conn,
        &run_b.id,
        ProposalVerb::Create,
        ProposalPayload::Epic { title: "Run B's own epic".to_string(), description: None },
        None,
        None,
    )
    .expect("propose an epic under run B");

    let answer_a = resolve_board_read(&conn, &run_a.id, &json!({ "readKind": "list_proposals" }))
        .expect("resolve_board_read(list_proposals) should succeed for run A");

    assert_eq!(
        answer_a["proposals"],
        json!([]),
        "run A must never see a proposal staged by run B, even against the same project"
    );
}
