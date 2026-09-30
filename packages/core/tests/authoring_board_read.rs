//! Behavior under test (05-18-PLAN.md Task 2, gap G-05-1's closure): `query::authoring::
//! resolve_board_read` — the ONE board-read dispatch plan 05-18 extracted so the desktop app and
//! the UAT harness bridge can never drift into two copies of the scope resolution, the clamp
//! arithmetic or the unknown-kind guard. This suite pins the shipped shape, not the
//! pre-extraction one — every test calls `resolve_board_read` directly, exactly as both real
//! callers do.
//!
//! Widened plan 05-44 (gap G-05-9): the fourth `readKind`, `list_proposals`, gets its own clamp
//! and truncation coverage beside the pre-existing three — `authoring_criterion_reachability.rs`
//! owns the reachability finding itself (the id round-trip and the D-96 implied-parent accept);
//! this file owns only `list_proposals`'s own dispatch arithmetic, mirroring how
//! `board_read_clamps_an_enormous_limit_and_flags_truncation` already covers `list_tasks`'s.
//!
//! Every fixture seeds through the real domain functions this crate's other authoring suites use
//! (`common::seeded_project`, `project::create_project`, `epic::create_epic`, `task::create_task`,
//! `authoring_session::start_authoring_run`) — never a hand-rolled `INSERT` — mirroring
//! `authoring_measurement.rs`'s own discipline.

mod common;

use core::domain::authoring_proposal::{create_proposal, ProposalPayload, ProposalProvenance, ProposalVerb};
use core::domain::authoring_session::start_authoring_run;
use core::domain::epic::create_epic;
use core::domain::project;
use core::domain::task::create_task;
use core::query::authoring::{resolve_board_read, MAX_LIMIT};
use serde_json::json;

/// A `get_epic` event naming the SECOND project's epic id, issued against the FIRST project's
/// run, returns an answer whose `found` is `false` and whose `epic` is null — the event's own
/// claim about which epic to read is honoured, but the scope it is read within comes from the
/// run's row, never from anything the event itself claims (T-05-05-03 / T-05-18-01).
#[test]
fn board_read_scope_comes_from_the_run_not_the_event() {
    let (mut conn, actor_id, project_a) = common::seeded_project();
    let project_b = project::create_project(&mut conn, &actor_id, "Other Co", "/repo-b", "OTH", "main")
        .expect("create_project should succeed");
    let epic_b = create_epic(&mut conn, &project_b.id, &actor_id, "Other project's epic", None)
        .expect("create_epic should succeed");

    let run = start_authoring_run(&mut conn, &project_a.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");

    let event = json!({ "readKind": "get_epic", "epicId": epic_b.id });
    let answer =
        resolve_board_read(&conn, &run.id, &event).expect("resolve_board_read should succeed");

    assert_eq!(answer["found"], json!(false));
    assert_eq!(answer["epic"], json!(null));
}

/// A `list_tasks` event asking for far more rows than the module's own ceiling allows returns at
/// most that ceiling's worth of rows, and a request against the same epic with a tighter limit
/// says so through its `truncated` flag. The ceiling asserted against is the query module's own
/// exported `MAX_LIMIT` constant — never a hard-coded number duplicated in this test.
#[test]
fn board_read_clamps_an_enormous_limit_and_flags_truncation() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "An epic with several tasks", None)
        .expect("create_epic should succeed");
    for i in 0..3 {
        create_task(&mut conn, &project.id, &actor_id, &format!("task {i}"), Some(&epic.id))
            .expect("create_task should succeed");
    }
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");

    let enormous_event =
        json!({ "readKind": "list_tasks", "epicId": epic.id, "limit": i64::MAX });
    let enormous_answer = resolve_board_read(&conn, &run.id, &enormous_event)
        .expect("resolve_board_read should succeed for an enormous limit");
    let enormous_tasks = enormous_answer["tasks"]
        .as_array()
        .expect("tasks should be an array");
    assert!(
        enormous_tasks.len() as i64 <= MAX_LIMIT,
        "an enormous requested limit must never return more than MAX_LIMIT rows, got {}",
        enormous_tasks.len(),
    );

    let tight_event = json!({ "readKind": "list_tasks", "epicId": epic.id, "limit": 1 });
    let tight_answer = resolve_board_read(&conn, &run.id, &tight_event)
        .expect("resolve_board_read should succeed for a tight limit");
    assert_eq!(tight_answer["truncated"], json!(true));
    assert_eq!(
        tight_answer["tasks"]
            .as_array()
            .expect("tasks should be an array")
            .len(),
        1,
    );
}

/// Looking up an epic that exists in another project must be indistinguishable from looking up an
/// epic that does not exist at all — the difference between "not found" and "forbidden" is itself
/// a disclosure (05-RESEARCH.md's V4 row / T-05-05-03), so this asserts byte-identical equality
/// between the two answers, not merely that both are not-found.
#[test]
fn board_read_get_epic_outside_the_project_reads_not_found() {
    let (mut conn, actor_id, project_a) = common::seeded_project();
    let project_b =
        project::create_project(&mut conn, &actor_id, "Other Co", "/repo-b2", "OTB", "main")
            .expect("create_project should succeed");
    let epic_b = create_epic(&mut conn, &project_b.id, &actor_id, "Other project's epic", None)
        .expect("create_epic should succeed");

    let run = start_authoring_run(&mut conn, &project_a.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");

    let absent_answer = resolve_board_read(
        &conn,
        &run.id,
        &json!({ "readKind": "get_epic", "epicId": "does-not-exist-at-all" }),
    )
    .expect("resolve_board_read should succeed for an absent epic id");
    let other_project_answer = resolve_board_read(
        &conn,
        &run.id,
        &json!({ "readKind": "get_epic", "epicId": epic_b.id }),
    )
    .expect("resolve_board_read should succeed for another project's real epic id");

    assert_eq!(absent_answer, other_project_answer);
}

/// An event whose read kind the dispatch does not handle returns `Err`, whose rendered message
/// contains that string, and the test completes normally rather than unwinding — the dispatch
/// never panics on an unrecognised kind.
#[test]
fn board_read_unknown_kind_is_an_error_not_a_panic() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");

    let event = json!({ "readKind": "not_a_real_kind" });
    let result = resolve_board_read(&conn, &run.id, &event);

    let err = result.expect_err("an unrecognised read kind should be an Err, not a panic");
    assert!(
        err.to_string().contains("not_a_real_kind"),
        "the error message should name the offending kind, got: {err}",
    );
}

/// Plan 05-44 (gap G-05-9): `list_proposals`'s own clamp-and-truncate coverage, mirroring
/// `board_read_clamps_an_enormous_limit_and_flags_truncation`'s own `list_tasks` shape exactly — a
/// caller-supplied limit far above the module's own ceiling is clamped, and a tighter request
/// against the same staged proposals reports truncation through its `truncated` flag.
#[test]
fn list_proposals_clamps_an_enormous_limit_and_flags_truncation() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    for i in 0..3 {
        create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: format!("epic {i}"), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
    }

    let enormous_event = json!({ "readKind": "list_proposals", "limit": i64::MAX });
    let enormous_answer = resolve_board_read(&conn, &run.id, &enormous_event)
        .expect("resolve_board_read should succeed for an enormous limit");
    let enormous_proposals =
        enormous_answer["proposals"].as_array().expect("proposals should be an array");
    assert!(
        enormous_proposals.len() as i64 <= MAX_LIMIT,
        "an enormous requested limit must never return more than MAX_LIMIT rows, got {}",
        enormous_proposals.len(),
    );

    let tight_event = json!({ "readKind": "list_proposals", "limit": 1 });
    let tight_answer = resolve_board_read(&conn, &run.id, &tight_event)
        .expect("resolve_board_read should succeed for a tight limit");
    assert_eq!(tight_answer["truncated"], json!(true));
    assert_eq!(
        tight_answer["proposals"]
            .as_array()
            .expect("proposals should be an array")
            .len(),
        1,
    );
}

/// The arm's own documented edge case (`resolve_board_read`'s `peek_limit` comment): a request
/// already sitting at [`MAX_LIMIT`] cannot peek past it, so truncation at the EXACT ceiling reads
/// `false` even though more rows exist on disk — an accepted, documented edge case (more rows past
/// the ceiling are simply invisible, never returned unclamped), not a silent unbounded read.
#[test]
fn list_proposals_at_the_exact_ceiling_reports_truncated_false_per_the_documented_edge_case() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    for i in 0..(MAX_LIMIT + 1) {
        create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: format!("epic {i}"), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
    }

    let event = json!({ "readKind": "list_proposals", "limit": MAX_LIMIT });
    let answer = resolve_board_read(&conn, &run.id, &event)
        .expect("resolve_board_read should succeed at the exact ceiling");
    assert_eq!(
        answer["truncated"],
        json!(false),
        "a request already sitting at MAX_LIMIT cannot peek past it, so truncation at the exact \
         ceiling reads false — the documented edge case resolve_board_read's own doc comment names"
    );
    assert_eq!(
        answer["proposals"]
            .as_array()
            .expect("proposals should be an array")
            .len() as i64,
        MAX_LIMIT,
    );
}
