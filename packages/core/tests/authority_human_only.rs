//! FNC-03: authority is reachable only from a human (docs/mvp-spec.md §4.4, §8: "Acceptance is
//! human-only").
//!
//! An "authority transition" is a sign-off the developer owns: accepting (or withdrawing) an
//! Acceptance criterion, editing a Check, and deciding a Proposal. Each is enforced in two places at
//! once: the writer reads `actors.type` inside its own write transaction and refuses anything but
//! `'human'` (the behaviour half below), and no agent-reachable module may call the writer at all
//! (the source half below). The developer-only Story, Epic and Milestone moves (starting a Story,
//! requesting changes, merging, dropping, closing shaping, confirming an exit test, reordering the
//! Roadmap) are pinned by
//! the behaviour half too; their writers also serve the session's hand-off, so they are not in the
//! source half's list.
//!
//! Both directions are asserted in this one file, on purpose: a refusal test that lets an agent
//! through fails, and a not-blocked test that locks the human out fails too — the second is a hard
//! assert here, never a tolerated outcome. No env var, `cfg` switch or skip attribute turns
//! anything here off.

mod common;

use std::path::{Path, PathBuf};

use core::domain::acceptance_criterion::{accept_criterion, create_criterion, unaccept_criterion};
use core::domain::actor::{assert_human_actor, assert_human_actor_in_tx, local_human_actor_id, system_actor};
use core::domain::session::agent_actor_id;
use core::domain::check::{remove_check, set_check};
use core::domain::epic::{set_epic_state, EpicState};
use core::domain::milestone::{move_milestone, set_milestone_state, MilestoneState};
use core::domain::proposal::{accept_proposal, accept_proposal_amended, file_proposal, reject_proposal, NewProposal, ProposalTarget, ProposalVerb};
use core::domain::round::{accept_all_recommended, answer_round_question, post_round, NewQuestion, NewRound, RoundAnswer};
use core::domain::story::{set_story_state, StoryState};
use rusqlite::Connection;

// ============================================================================================
// Behaviour half — every authority writer, both directions
// ============================================================================================

/// Who is asking. `Human` is the seeded local human; the rest are every other way an actor id can
/// be wrong, each of which must be refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Who {
    Human,
    Agent,
    System,
    /// An id present in no `actors` row.
    Unknown,
    /// The empty string — what an absent id degrades to.
    Empty,
}

fn actor_id_for(conn: &Connection, who: Who) -> String {
    match who {
        Who::Human => local_human_actor_id(conn).expect("seeded human actor"),
        Who::Agent => agent_actor_id(conn).expect("seeded agent actor"),
        Who::System => system_actor(conn).expect("seeded system actor").id,
        Who::Unknown => "01ZZZZZZZZZZZZZZZZZZZZZZZZ".to_string(),
        Who::Empty => String::new(),
    }
}

/// What one attempt did: the outcome (error chain rendered) and the board state either side of it.
struct Trial {
    result: Result<(), String>,
    before: String,
    after: String,
}

/// A byte-comparable picture of every table an authority writer can touch, plus the event count.
/// Static SQL per table — no table name is ever interpolated.
fn board_state(conn: &Connection) -> String {
    const QUERIES: [&str; 9] = [
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || IFNULL(answer, '') || IFNULL(answered_by, '') AS r FROM round_questions ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || state || IFNULL(held_request_id, '') AS r FROM rounds ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || state || rank || updated_at AS r FROM milestones ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || state || updated_at AS r FROM epics ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || state || updated_at AS r FROM stories ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || IFNULL(accepted_by, '') || updated_at AS r FROM acceptance_criteria ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || command || updated_at AS r FROM checks ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || state || IFNULL(decided_by, '') AS r FROM proposals ORDER BY id)",
        "SELECT COUNT(*) FROM events",
    ];
    QUERIES
        .iter()
        .map(|sql| {
            conn.query_row(sql, [], |row| row.get::<_, String>(0).or_else(|_| row.get::<_, i64>(0).map(|n| n.to_string())))
                .expect("board_state query")
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

fn trial(conn: &mut Connection, who: Who, act: impl FnOnce(&mut Connection, &str) -> anyhow::Result<()>) -> Trial {
    let actor = actor_id_for(conn, who);
    let before = board_state(conn);
    let result = act(conn, &actor).map_err(|e| format!("{e:#}"));
    let after = board_state(conn);
    Trial { result, before, after }
}

/// A project with one Story carrying one criterion. Returns `(conn, human, story_id, criterion_id)`.
fn criterion_fixture() -> (Connection, String, String, String) {
    let (mut conn, human, project) = common::seeded_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Wire up the focus trap");
    let criterion = create_criterion(&mut conn, &human, &story.id, "Focus returns on close.").expect("create_criterion");
    (conn, human, story.id, criterion.id)
}

fn run_accept_criterion(who: Who) -> Trial {
    let (mut conn, _, _, criterion_id) = criterion_fixture();
    trial(&mut conn, who, |c, actor| accept_criterion(c, actor, &criterion_id))
}

fn run_unaccept_criterion(who: Who) -> Trial {
    let (mut conn, human, _, criterion_id) = criterion_fixture();
    accept_criterion(&mut conn, &human, &criterion_id).expect("the human accepts first");
    trial(&mut conn, who, |c, actor| unaccept_criterion(c, actor, &criterion_id))
}

fn run_set_check(who: Who) -> Trial {
    let (mut conn, _, _, criterion_id) = criterion_fixture();
    trial(&mut conn, who, |c, actor| set_check(c, actor, &criterion_id, "cargo test focus", None).map(|_| ()))
}

fn run_remove_check(who: Who) -> Trial {
    let (mut conn, human, _, criterion_id) = criterion_fixture();
    set_check(&mut conn, &human, &criterion_id, "cargo test focus", None).expect("the human sets a Check first");
    trial(&mut conn, who, |c, actor| remove_check(c, actor, &criterion_id))
}

/// One pending Proposal filed by the agent. Returns `(conn, proposal_id)`.
fn filed_proposal() -> (Connection, String) {
    let (mut conn, _human, project) = common::seeded_project();
    let agent = agent_actor_id(&conn).expect("agent actor");
    let proposal = file_proposal(
        &mut conn,
        &agent,
        &NewProposal {
            project_id: &project.id,
            session_id: None,
            epic_id: None,
            verb: ProposalVerb::Create,
            target: ProposalTarget::Milestone,
            target_id: None,
            payload: serde_json::json!({ "title": "Ship the board" }),
            rationale: Some("the roadmap has no Milestone for it"),
        },
    )
    .expect("an agent may file a Proposal");
    (conn, proposal.id)
}

fn run_accept_proposal(who: Who) -> Trial {
    let (mut conn, proposal_id) = filed_proposal();
    trial(&mut conn, who, |c, actor| accept_proposal(c, actor, &proposal_id).map(|_| ()))
}

/// Amend (issue #125): the developer's edit and acceptance in one act.
fn run_accept_proposal_amended(who: Who) -> Trial {
    let (mut conn, proposal_id) = filed_proposal();
    let edited = serde_json::json!({ "title": "Ship the board, then the fleet" });
    trial(&mut conn, who, |c, actor| accept_proposal_amended(c, actor, &proposal_id, &edited).map(|_| ()))
}

fn run_reject_proposal(who: Who) -> Trial {
    let (mut conn, proposal_id) = filed_proposal();
    trial(&mut conn, who, |c, actor| reject_proposal(c, actor, &proposal_id, Some("not now")))
}

/// A Story moved, by the human, to `at`. Returns `(conn, story_id)`.
fn story_at(at: StoryState) -> (Connection, String) {
    let (mut conn, human, project) = common::seeded_project();
    let story = common::new_story(&mut conn, &project.id, &human, "A Story");
    let path: &[StoryState] = match at {
        StoryState::Shaping => &[],
        StoryState::Ready => &[StoryState::Ready],
        StoryState::Running => &[StoryState::Ready, StoryState::Running],
        StoryState::InReview => &[StoryState::Ready, StoryState::Running, StoryState::InReview],
        other => panic!("no fixture path to {other:?}"),
    };
    for step in path {
        set_story_state(&mut conn, &human, &story.id, *step).expect("fixture move");
    }
    (conn, story.id)
}

fn run_story_move(from: StoryState, to: StoryState, who: Who) -> Trial {
    let (mut conn, story_id) = story_at(from);
    trial(&mut conn, who, |c, actor| set_story_state(c, actor, &story_id, to))
}

fn run_start_story(who: Who) -> Trial {
    run_story_move(StoryState::Ready, StoryState::Running, who)
}

fn run_request_changes(who: Who) -> Trial {
    run_story_move(StoryState::InReview, StoryState::Running, who)
}

fn run_merge_story(who: Who) -> Trial {
    run_story_move(StoryState::InReview, StoryState::Merged, who)
}

fn run_drop_story(who: Who) -> Trial {
    run_story_move(StoryState::Running, StoryState::Dropped, who)
}

fn run_close_epic_shaping(who: Who) -> Trial {
    let (mut conn, human, project) = common::seeded_project();
    let story = common::new_story(&mut conn, &project.id, &human, "A Story");
    trial(&mut conn, who, |c, actor| set_epic_state(c, actor, &story.epic_id, EpicState::Ready))
}

fn run_confirm_milestone(who: Who) -> Trial {
    let (mut conn, human, project) = common::seeded_project();
    let m = core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "Ship it", Some("it ships"))
        .expect("create_milestone");
    trial(&mut conn, who, |c, actor| set_milestone_state(c, actor, &m.id, MilestoneState::Done))
}

/// Reordering the Roadmap moves the Current Milestone, so it is the developer's (spec §2).
fn run_move_milestone(who: Who) -> Trial {
    let (mut conn, human, project) = common::seeded_project();
    let first = core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "First", None).unwrap();
    let second = core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "Second", None).unwrap();
    trial(&mut conn, who, |c, actor| move_milestone(c, actor, &second.id, Some(&first.id)))
}

/// A live shaping session on an Epic with a two-question Round posted by its agent. Returns
/// `(conn, round_id, first question id)`.
fn posted_round() -> (Connection, String, String) {
    let (mut conn, human, project) = common::seeded_project();
    let m = core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let e = core::domain::epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
    let session = core::domain::session::start_shaping_session(
        &mut conn,
        &core::domain::session::ShapingSubject::Epic(e.id),
        "dontAsk",
        &human,
    )
    .unwrap();
    let question = |n: u8| NewQuestion {
        title: format!("Q{n}"),
        question: format!("Question {n}?"),
        grounding: "Read the spec".into(),
        recommended_answer: "Yes".into(),
        because: "It is in scope".into(),
    };
    let round = post_round(
        &mut conn,
        &session.id,
        Some("req-1"),
        &NewRound { note: "Settles the scope.".into(), questions: vec![question(1), question(2)] },
    )
    .expect("the agent posts a Round");
    let first = round.questions[0].id.clone();
    (conn, round.id, first)
}

/// Answering a Round's question is the developer's (issue #123): an agent never answers its own.
fn run_answer_round_question(who: Who) -> Trial {
    let (mut conn, _, question_id) = posted_round();
    trial(&mut conn, who, |c, actor| answer_round_question(c, actor, &question_id, &RoundAnswer::Recommended).map(|_| ()))
}

fn run_accept_all_recommended(who: Who) -> Trial {
    let (mut conn, round_id, _) = posted_round();
    trial(&mut conn, who, |c, actor| accept_all_recommended(c, actor, &round_id).map(|_| ()))
}

/// The authority writers the source half guards, by function name. Adding one here without a case
/// below (or the reverse) fails `every_authority_writer_has_a_refusal_and_a_not_blocked_case`.
const AUTHORITY_WRITERS: [&str; 9] = [
    "accept_criterion",
    "unaccept_criterion",
    "set_check",
    "remove_check",
    "accept_proposal",
    "accept_proposal_amended",
    "reject_proposal",
    "answer_round_question",
    "accept_all_recommended",
];

/// Declares the case table AND, per transition, the labelled refusal / not-blocked pair — so the two
/// cannot drift apart, and a transition cannot be in the table without both of its tests.
macro_rules! authority_cases {
    ($($name:ident => $run:ident),* $(,)?) => {
        const TRANSITIONS: &[(&str, fn(Who) -> Trial)] = &[$((stringify!($name), $run as fn(Who) -> Trial)),*];

        $(
            mod $name {
                use super::*;

                #[test]
                fn an_agent_is_refused_and_nothing_is_written() {
                    let t = $run(Who::Agent);
                    assert!(t.result.is_err(), "{}: an agent actor must be refused, but the call succeeded", stringify!($name));
                    assert_eq!(t.before, t.after, "{}: a refused agent call must leave the board byte-for-byte unchanged", stringify!($name));
                }

                #[test]
                fn a_human_is_not_blocked_and_the_full_effect_lands() {
                    let t = $run(Who::Human);
                    assert!(t.result.is_ok(), "{}: the human must NOT be blocked, got {:?}", stringify!($name), t.result);
                    assert_ne!(t.before, t.after, "{}: the human's call returned Ok but wrote nothing", stringify!($name));
                }
            }
        )*
    };
}

authority_cases! {
    accept_criterion => run_accept_criterion,
    unaccept_criterion => run_unaccept_criterion,
    set_check => run_set_check,
    remove_check => run_remove_check,
    accept_proposal => run_accept_proposal,
    accept_proposal_amended => run_accept_proposal_amended,
    reject_proposal => run_reject_proposal,
    answer_round_question => run_answer_round_question,
    accept_all_recommended => run_accept_all_recommended,
    start_story => run_start_story,
    request_changes => run_request_changes,
    merge_story => run_merge_story,
    drop_story => run_drop_story,
    close_epic_shaping => run_close_epic_shaping,
    confirm_milestone => run_confirm_milestone,
    move_milestone => run_move_milestone,
}

/// The table names every writer in AUTHORITY_WRITERS, plus the seven developer-only moves.
const STATE_MOVES: [&str; 7] = [
    "start_story",
    "request_changes",
    "merge_story",
    "drop_story",
    "close_epic_shaping",
    "confirm_milestone",
    "move_milestone",
];

#[test]
fn every_authority_writer_has_a_refusal_and_a_not_blocked_case() {
    let mut in_table: Vec<&str> = TRANSITIONS.iter().map(|(name, _)| *name).collect();
    let mut declared: Vec<&str> = AUTHORITY_WRITERS.iter().chain(STATE_MOVES.iter()).copied().collect();
    in_table.sort_unstable();
    declared.sort_unstable();
    assert_eq!(in_table, declared, "the case table must name every writer and every developer-only move");
    assert_eq!(TRANSITIONS.len(), 16, "a transition was quietly dropped from coverage");
}

/// The session's hand-off is the one Story move that is not the developer's: an agent may make it,
/// and it is the only one an agent may make.
#[test]
fn the_hand_off_is_the_only_story_move_an_agent_may_make() {
    let t = run_story_move(StoryState::Running, StoryState::InReview, Who::Agent);
    assert!(t.result.is_ok(), "the session hands off: {:?}", t.result);
    assert_ne!(t.before, t.after);
    for from in [StoryState::Shaping, StoryState::Ready, StoryState::Running, StoryState::InReview] {
        for to in core::domain::story::StoryState::ALL {
            if core::domain::story::is_allowed_transition(from, to) && (from, to) != (StoryState::Running, StoryState::InReview) {
                assert!(core::domain::story::is_human_transition(from, to), "{from:?} -> {to:?} must be the developer's");
            }
        }
    }
}

/// Every wrong kind of actor, against every writer: refused, board unchanged, message says why.
fn assert_refused_everywhere(who: Who, message_contains: &str) {
    for (name, run) in TRANSITIONS {
        let t = run(who);
        let err = match &t.result {
            Err(e) => e,
            Ok(()) => panic!("{name}: a {who:?} actor must be refused, but the call succeeded"),
        };
        assert!(
            err.contains(message_contains),
            "{name}: a {who:?} actor was refused, but not with the expected reason {message_contains:?}: {err}"
        );
        assert_eq!(t.before, t.after, "{name}: a refused {who:?} call must leave the board unchanged");
    }
}

#[test]
fn the_system_actor_is_refused_not_treated_as_human() {
    assert_refused_everywhere(Who::System, "system");
}

#[test]
fn an_unknown_actor_id_is_refused_as_not_found() {
    assert_refused_everywhere(Who::Unknown, "not found");
}

#[test]
fn an_empty_actor_id_is_refused_as_not_found_never_defaulted_to_the_local_human() {
    assert_refused_everywhere(Who::Empty, "not found");
}

/// A passing Check run never accepts its criterion: acceptance stays the developer's act.
#[test]
fn a_passing_check_run_does_not_accept_its_criterion() {
    let (mut conn, human, _, criterion_id) = criterion_fixture();
    let check = set_check(&mut conn, &human, &criterion_id, "true", None).expect("set_check");
    let now = chrono::Utc::now().to_rfc3339();
    core::domain::check::record_check_run(
        &mut conn,
        &check.id,
        &core::domain::check::CheckRunRecord {
            commit_sha: "abc123",
            result: core::domain::check::CheckResult::Passed,
            exit_code: Some(0),
            output_tail: None,
            started_at: &now,
            ended_at: &now,
        },
    )
    .expect("record_check_run");
    let criterion = core::domain::acceptance_criterion::get_criterion(&conn, &criterion_id).unwrap().unwrap();
    assert_eq!(criterion.accepted_by, None, "a passed Check pre-ticks at review; it never accepts");
}

// --- the helper itself, both directions ---

#[test]
fn the_helper_accepts_only_a_human_and_names_what_it_refused() {
    let (mut conn, human, _project) = common::seeded_project();
    let agent = agent_actor_id(&conn).unwrap();
    let system = system_actor(&conn).unwrap().id;

    assert_human_actor(&conn, &human).expect("a human actor must pass");

    let tx = conn.transaction().unwrap();
    assert_human_actor_in_tx(&tx, &human).expect("a human actor must pass inside a transaction");

    let agent_err = format!("{:#}", assert_human_actor_in_tx(&tx, &agent).unwrap_err());
    assert!(agent_err.contains(&agent) && agent_err.contains("agent"), "must name the id and its type: {agent_err}");

    let system_err = format!("{:#}", assert_human_actor_in_tx(&tx, &system).unwrap_err());
    assert!(system_err.contains(&system) && system_err.contains("system"), "must name the id and its type: {system_err}");

    for missing in ["", "no-such-actor"] {
        let err = format!("{:#}", assert_human_actor_in_tx(&tx, missing).unwrap_err());
        assert!(err.contains("not found"), "{missing:?} must be refused as not found: {err}");
    }
}

// ============================================================================================
// Source half — no agent-reachable module calls an authority writer
// ============================================================================================

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "node_modules" || n == "dist") {
                    continue;
                }
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths
        .into_iter()
        .map(|p| {
            let body = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}

const SCAN_ROOTS: [&str; 3] = ["packages/core/src", "packages/desktop/src-tauri/src", "packages/sidecar/src"];

/// A file permitted to call an authority writer, and why. `test_only` means every call must sit
/// below the file's first `#[cfg(test)]` line.
struct AllowedCaller {
    suffix: &'static str,
    reason: &'static str,
    test_only: bool,
}

/// The declaring domain modules and the Tauri command modules that put the act under the human's
/// own control (each resolves the actor server-side with `local_human_actor_id`). Nothing under
/// `packages/sidecar/src` — the process that drives an agent session — is, or may ever be, listed.
const ALLOWED_CALLERS: [AllowedCaller; 8] = [
    AllowedCaller { suffix: "packages/core/src/domain/acceptance_criterion.rs", reason: "declares accept_criterion / unaccept_criterion", test_only: false },
    AllowedCaller { suffix: "packages/core/src/domain/round.rs", reason: "declares answer_round_question / accept_all_recommended", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/shaping.rs", reason: "the human's answers in the Round dock", test_only: false },
    AllowedCaller { suffix: "packages/core/src/domain/check.rs", reason: "declares set_check / remove_check", test_only: false },
    AllowedCaller { suffix: "packages/core/src/domain/proposal.rs", reason: "declares accept_proposal / accept_proposal_amended / reject_proposal", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/criterion.rs", reason: "the human's acceptance and Check controls", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/proposal.rs", reason: "the human's Proposal decisions", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/session.rs", reason: "calls only from a #[cfg(test)] fixture", test_only: true },
];

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Does `line` call `writer`? A call is `<name>(` with no identifier character before the name, so
/// `accept_proposal_in_tx(` and `foo_accept_proposal(` are not calls to `accept_proposal`.
fn calls(line: &str, writer: &str) -> bool {
    let needle = format!("{writer}(");
    line.match_indices(&needle).any(|(i, _)| !line[..i].chars().next_back().is_some_and(is_ident_char))
}

/// The matcher both the real gate and its planted twin drive. `path` is the full path string.
fn authority_offenders(path: &str, body: &str) -> Vec<String> {
    let allowed = ALLOWED_CALLERS.iter().find(|a| path.ends_with(a.suffix));
    let first_test_line = body.lines().position(|l| l.trim() == "#[cfg(test)]");
    let mut offenders = Vec::new();
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        for writer in AUTHORITY_WRITERS {
            if !calls(line, writer) {
                continue;
            }
            let permitted = match allowed {
                None => false,
                Some(a) if a.test_only => first_test_line.is_some_and(|t| n > t),
                Some(_) => true,
            };
            if !permitted {
                offenders.push(format!("{path}:{}: {}", n + 1, line.trim()));
            }
        }
    }
    offenders
}

/// FNC-03's second place. The database refusal above is the guarantee; this gate is why an agent
/// never gets as far as asking.
///
/// Concurrency (the ordering edge, covered as a backstop rather than a test): the precondition is
/// a per-call, in-transaction read of `actors.type` for the actor THAT CALL names, so when a human
/// and an agent attempt the same transition at once each gets its own verdict from its own actor
/// and arrival order never decides who is refused. Proving that with two real connections needs a
/// scheduled interleaving; `lock_contention.rs` is the existing home if the owner wants it measured.
#[test]
fn no_agent_reachable_module_calls_an_authority_writer() {
    let root = workspace_root();
    let mut offenders = Vec::new();
    for dir in SCAN_ROOTS {
        for (path, body) in sources_under(&root.join(dir)) {
            offenders.extend(authority_offenders(&path.to_string_lossy(), &body));
        }
    }
    assert!(
        offenders.is_empty(),
        "an authority writer is called from a module that is not on the allow-list — FNC-03 keeps \
         sign-off reachable only from the human's own control. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_sidecar_tree_is_scanned_and_nothing_in_it_is_allow_listed() {
    let sidecar = workspace_root().join("packages/sidecar/src");
    assert!(
        !sources_under(&sidecar).is_empty(),
        "packages/sidecar/src (the process that drives an agent session) yielded no source files, \
         which would turn the gate off for the agent's own tree"
    );
    assert!(
        ALLOWED_CALLERS.iter().all(|a| !a.suffix.contains("packages/sidecar/")),
        "no file under packages/sidecar/src may call an authority writer"
    );
    assert!(ALLOWED_CALLERS.iter().all(|a| !a.reason.is_empty()), "every allow-list entry records why it is allowed");
}

#[test]
fn the_authority_gate_fires_on_a_planted_call() {
    let planted = "const outcome = accept_proposal(conn, id, actor);\n";
    assert_eq!(
        authority_offenders("packages/sidecar/src/planted.ts", planted).len(),
        1,
        "a call from outside the allow-list must be exactly one offender"
    );
    // The same body in an allowed file, in a comment, or as a longer identifier is not a call.
    assert!(authority_offenders("packages/desktop/src-tauri/src/commands/proposal.rs", planted).is_empty());
    assert!(authority_offenders("packages/sidecar/src/planted.ts", "// accept_proposal(conn);\n").is_empty());
    assert!(authority_offenders("packages/sidecar/src/planted.ts", "accept_proposal_in_tx(tx);\n").is_empty());
    // A test-only entry is permitted below its `#[cfg(test)]` line and an offender above it.
    let session = "packages/desktop/src-tauri/src/commands/session.rs";
    assert_eq!(authority_offenders(session, "accept_criterion(c);\n#[cfg(test)]\nmod t {}\n").len(), 1);
    assert!(authority_offenders(session, "#[cfg(test)]\nmod t { fn f() { accept_criterion(c); } }\n").is_empty());
}
