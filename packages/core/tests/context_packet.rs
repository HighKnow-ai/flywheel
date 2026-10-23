//! The Context packet (docs/mvp-spec.md §4.2, issue #51): every Story session is rebuilt from a
//! fixed, ordered packet read off the board and the Story's worktree. These tests pin the order,
//! the determinism, the ADR supersession walk, the summary collapse, the uncommitted-changes mark
//! and the size warning.

mod common;

use std::path::Path;
use std::process::Command;

use common::with_scratch_worktree_root;
use core::context_packet::{build_context_packet, context_packet_size, measure, SOFT_LIMIT_TOKENS};
use core::domain::acceptance_criterion::criteria_for_story;
use core::domain::check::{check_for_criterion, record_check_run, CheckResult, CheckRunRecord};
use core::domain::epic::{create_epic, update_epic, EpicSpec};
use core::domain::milestone::create_milestone;
use core::domain::proposal::{accept_proposal, file_proposal, reject_proposal, NewProposal, ProposalTarget, ProposalVerb};
use core::domain::round::{answer_round_question, post_round, AdrDraft, NewQuestion, NewRound, RoundAnswer};
use core::domain::session::{close_session, start_session, start_shaping_session, SessionStatus, ShapingSubject};
use core::domain::story::stories_in_epic;
use core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall};
use core::domain::session_summary::create_summary;
use core::domain::request_changes::request_changes;
use core::domain::review_decisions::{set_adr_decision, AdrDecision};
use core::domain::story::{create_story, set_story_state, write_story_by_hand, HandWrittenCriterion, Story, StoryState};
use core::domain::task::{add_task, set_task_note, set_task_state, TaskState};
use core::domain::worktree::ensure_worktree;
use rusqlite::Connection;

const SECTION_HEADINGS: [&str; 10] = [
    "## Standing instructions",
    "## Milestone and Epic",
    "## ADRs",
    "## Sibling Stories",
    "## The Story",
    "## Tasks",
    "## Review feedback and resume note",
    "## Session summaries",
    "## Diff so far",
    "## Closing instruction",
];

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn write(dir: &Path, rel: &str, body: &str) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

struct Fixture {
    conn: Connection,
    actor_id: String,
    story: Story,
    worktree: std::path::PathBuf,
    _repo: tempfile::TempDir,
}

/// A real repository, a Milestone with an exit test, an Epic with a spec, the Story under test
/// (written by hand, so Ready with criteria and one Check) and a sibling, and the Story's worktree
/// holding a supersession chain of ADRs, committed on the Story's branch.
fn fixture() -> Fixture {
    let (mut conn, actor_id, project, repo) = common::seeded_git_project();
    let m = create_milestone(&mut conn, &project.id, &actor_id, "Supervised execution", Some("A week of real work")).unwrap();
    let e = create_epic(&mut conn, &actor_id, &m.id, "Context packet").unwrap();
    update_epic(
        &mut conn,
        &actor_id,
        &e.id,
        "Context packet",
        &EpicSpec {
            problem: Some("Sessions lose the thread.".into()),
            scope: Some("Rebuild every session from the board.".into()),
            out_of_scope: Some("Compaction.".into()),
            exit_test: Some("A resumed session picks up where the last stopped.".into()),
        },
    )
    .unwrap();
    let story = write_story_by_hand(
        &mut conn,
        &actor_id,
        &e.id,
        "Build the packet",
        Some("The packet builder."),
        &[
            HandWrittenCriterion { statement: "Packets are byte-identical", check_command: Some("cargo test packet") },
            HandWrittenCriterion { statement: "Looks right", check_command: None },
        ],
    )
    .unwrap();
    create_story(&mut conn, &actor_id, &e.id, "Sibling work").unwrap();

    let wt = ensure_worktree(&mut conn, &story.id, &actor_id).unwrap();
    let worktree = std::path::PathBuf::from(&wt.path);
    git(&worktree, &["config", "user.email", "fixture@flywheel.test"]);
    git(&worktree, &["config", "user.name", "Fixture"]);
    write(&worktree, "docs/adr/0001-first.md", "# Use SQLite\n\nStatus: superseded by ADR-0002\n\nBody.\n");
    write(&worktree, "docs/adr/0002-second.md", "# Use Postgres\n\nSupersedes ADR-0001\n\nStatus: superseded by ADR-0003\n");
    write(&worktree, "docs/adr/0003-third.md", "# Use SQLite again\n\nSupersedes ADR-0002\n\nBody.\n");
    write(&worktree, "docs/adr/0004-old-name.md", "# Old naming\n\nBody.\n");
    write(&worktree, "docs/adr/0005-new-name.md", "# New naming\n\nSupersedes ADR-0004\n");
    write(&worktree, "docs/adr/0006-other.md", "# Unrelated decision\n");
    write(&worktree, "GLOSSARY.md", "# Glossary\n");
    git(&worktree, &["add", "."]);
    git(&worktree, &["commit", "-m", "adrs"]);

    Fixture { conn, actor_id, story, worktree, _repo: repo }
}

fn positions(packet: &str) -> Vec<usize> {
    SECTION_HEADINGS
        .iter()
        .map(|h| packet.find(&format!("\n{h}\n")).unwrap_or_else(|| panic!("missing {h:?} in:\n{packet}")))
        .collect()
}

#[test]
fn the_same_board_state_gives_a_byte_identical_packet() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        add_task(&mut f.conn, &f.actor_id, &f.story.id, "Write the builder").unwrap();
        write(&f.worktree, "src/wip.rs", "// wip\n");
        let first = build_context_packet(&f.conn, &f.story.id, "Carry on").unwrap();
        let second = build_context_packet(&f.conn, &f.story.id, "Carry on").unwrap();
        assert_eq!(first, second);
        assert_eq!(first.as_bytes(), second.as_bytes());
    });
}

#[test]
fn sections_appear_in_the_spec_order_and_each_once() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        let packet = build_context_packet(&f.conn, &f.story.id, "Mind the tests").unwrap();
        let at = positions(&packet);
        assert!(at.windows(2).all(|w| w[0] < w[1]), "sections out of order: {at:?}\n{packet}");
        for h in SECTION_HEADINGS {
            assert_eq!(packet.matches(&format!("\n{h}\n")).count(), 1, "{h} appears once");
        }
    });
}

#[test]
fn milestone_and_epic_carry_the_exit_tests_spec_and_rejected_reasons() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let epic_id = f.story.epic_id.clone();
        let project_id = f.story.project_id.clone();
        let p = file_proposal(
            &mut f.conn,
            &f.actor_id,
            &NewProposal {
                project_id: &project_id,
                session_id: None,
                epic_id: Some(&epic_id),
                verb: ProposalVerb::Create,
                target: ProposalTarget::Story,
                target_id: None,
                payload: serde_json::json!({ "title": "Add a cache" }),
                rationale: Some("Faster"),
            },
        )
        .unwrap();
        reject_proposal(&mut f.conn, &f.actor_id, &p.id, Some("No caching in the MVP")).unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(packet.contains("Milestone: Supervised execution. Exit test: A week of real work\n"), "{packet}");
        for needle in ["Sessions lose the thread.", "Rebuild every session from the board.", "Compaction.", "A resumed session picks up"] {
            assert!(packet.contains(needle), "{needle} missing:\n{packet}");
        }
        assert!(packet.contains("No caching in the MVP"), "a rejection's reason is in the Epic's packet:\n{packet}");
    });
}

#[test]
fn only_the_live_adr_of_a_supersession_chain_is_listed() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let adrs = &packet[packet.find("\n## ADRs\n").unwrap()..packet.find("\n## Sibling Stories\n").unwrap()];
        assert!(adrs.contains("- docs/adr/0003-third.md: Use SQLite again\n"), "{adrs}");
        assert!(adrs.contains("- docs/adr/0005-new-name.md: New naming\n"), "{adrs}");
        assert!(adrs.contains("- docs/adr/0006-other.md: Unrelated decision\n"), "{adrs}");
        for dead in ["0001-first", "0002-second", "0004-old-name"] {
            assert!(!adrs.contains(dead), "superseded {dead} is listed:\n{adrs}");
        }
        assert!(adrs.contains("GLOSSARY.md"), "{adrs}");
        assert!(!adrs.contains("# Glossary"), "the glossary goes by path only:\n{adrs}");
    });
}

#[test]
fn an_accepted_unmerged_adr_on_the_epic_is_sent_as_full_text() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let epic_id = f.story.epic_id.clone();
        let project_id = f.story.project_id.clone();
        let p = file_proposal(
            &mut f.conn,
            &f.actor_id,
            &NewProposal {
                project_id: &project_id,
                session_id: None,
                epic_id: Some(&epic_id),
                verb: ProposalVerb::Create,
                target: ProposalTarget::Adr,
                target_id: None,
                payload: serde_json::json!({
                    "path": "docs/adr/0007-packet.md",
                    "text": "# Build the packet in Rust\n\nThe core owns it.\n",
                    "hard_to_reverse": "Every session is rebuilt from it",
                    "surprising": "The sidecar drives sessions but does not build their packet",
                    "losing_alternative": "Building it in the sidecar",
                }),
                rationale: None,
            },
        )
        .unwrap();
        accept_proposal(&mut f.conn, &f.actor_id, &p.id).unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(packet.contains("docs/adr/0007-packet.md"), "{packet}");
        assert!(packet.contains("# Build the packet in Rust\n\nThe core owns it.\n"), "{packet}");

        // Once the worktree holds the file, it is in the index and no longer sent as text.
        write(&f.worktree, "docs/adr/0007-packet.md", "# Build the packet in Rust\n\nThe core owns it.\n");
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(packet.contains("- docs/adr/0007-packet.md: Build the packet in Rust\n"), "{packet}");
        assert!(!packet.contains("The core owns it."), "{packet}");
    });
}

/// Issue #129: an ADR offered as a question inside the Epic's shaping Round and answered Yes is an
/// accepted ADR Proposal on the Epic, so the Epic's Story packet carries it as full text; one
/// answered No reaches no packet.
#[test]
fn an_adr_accepted_in_a_shaping_round_reaches_the_epics_story_packet_as_full_text() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let session = start_shaping_session(&mut f.conn, &ShapingSubject::Epic(f.story.epic_id.clone()), "dontAsk", &f.actor_id)
            .unwrap();
        let offer = |n: u32, title: &str| NewQuestion {
            title: format!("Record ADR {n:04}"),
            question: format!("Record \"{title}\" as ADR {n:04}?"),
            grounding: "Read the ADR index".into(),
            recommended_answer: "Yes".into(),
            because: "It is hard to reverse".into(),
            adr: Some(AdrDraft {
                path: format!("docs/adr/{n:04}-round.md"),
                text: format!("# {title}\n\nDecided in the shaping Round.\n"),
                hard_to_reverse: "Every Story builds on it".into(),
                surprising: "A reader expects the opposite".into(),
                losing_alternative: "The opposite".into(),
                relates_to: None,
            }),
        };
        let round = post_round(
            &mut f.conn,
            &session.id,
            Some("req-1"),
            &NewRound { note: "Two decisions.".into(), questions: vec![offer(8, "Keep Rounds on the board"), offer(9, "Dropped idea")] },
        )
        .unwrap();
        answer_round_question(&mut f.conn, &f.actor_id, &round.questions[0].id, &RoundAnswer::Own("Yes".into())).unwrap();
        answer_round_question(&mut f.conn, &f.actor_id, &round.questions[1].id, &RoundAnswer::Own("No".into())).unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(packet.contains("write it verbatim at `docs/adr/0008-round.md`"), "{packet}");
        assert!(packet.contains("# Keep Rounds on the board\n\nDecided in the shaping Round.\n"), "{packet}");
        assert!(!packet.contains("Dropped idea"), "an ADR answered No reaches no packet:\n{packet}");
        assert!(!packet.contains("Every Story builds on it"), "the bar lines are never written into the file:\n{packet}");
    });
}

/// Issue #130: an accepted ADR is written by the Epic's first Story (ADR 0002, docs/mvp-spec.md §3), so only that
/// Story's packet carries its text; every later Story's packet names the file and the Story that writes it. A
/// Dropped first Story hands the write to the next one.
#[test]
fn only_the_epics_first_story_is_told_to_write_an_accepted_adr() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let epic_id = f.story.epic_id.clone();
        let project_id = f.story.project_id.clone();
        let p = file_proposal(
            &mut f.conn,
            &f.actor_id,
            &NewProposal {
                project_id: &project_id,
                session_id: None,
                epic_id: Some(&epic_id),
                verb: ProposalVerb::Create,
                target: ProposalTarget::Adr,
                target_id: None,
                payload: serde_json::json!({
                    "path": "docs/adr/0007-packet.md",
                    "text": "# Build the packet in Rust\n\nThe core owns it.\n",
                    "hard_to_reverse": "Every session is rebuilt from it",
                    "surprising": "The sidecar drives sessions but does not build their packet",
                    "losing_alternative": "Building it in the sidecar",
                }),
                rationale: None,
            },
        )
        .unwrap();
        accept_proposal(&mut f.conn, &f.actor_id, &p.id).unwrap();
        let sibling = core::domain::story::stories_in_epic(&f.conn, &epic_id).unwrap().remove(1);

        let first = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(first.contains("write it verbatim at `docs/adr/0007-packet.md`"), "{first}");
        let later = build_context_packet(&f.conn, &sibling.id, "").unwrap();
        assert!(!later.contains("The core owns it."), "a later Story is not sent the text:\n{later}");
        assert!(!later.contains("write it verbatim"), "{later}");
        assert!(
            later.contains(&format!(
                "Accepted for this Epic but not in the repo yet: `docs/adr/0007-packet.md`. {} writes it, the Epic's first Story; do not write it here.",
                f.story.key
            )),
            "{later}"
        );

        core::domain::story::set_story_state(&mut f.conn, &f.actor_id, &f.story.id, core::domain::story::StoryState::Dropped)
            .unwrap();
        let next = build_context_packet(&f.conn, &sibling.id, "").unwrap();
        assert!(next.contains("write it verbatim at `docs/adr/0007-packet.md`"), "the next Story takes the write over:\n{next}");
    });
}

#[test]
fn the_story_lists_siblings_criteria_checks_and_latest_results() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let criteria = criteria_for_story(&f.conn, &f.story.id).unwrap();
        let check = check_for_criterion(&f.conn, &criteria[0].id).unwrap().unwrap();
        let head = git(&f.worktree, &["rev-parse", "HEAD"]).trim().to_string();
        record_check_run(
            &mut f.conn,
            &check.id,
            &CheckRunRecord {
                commit_sha: &head,
                result: CheckResult::Failed,
                exit_code: Some(1),
                output_tail: None,
                started_at: "2999-01-01T00:00:00Z",
                ended_at: "2999-01-01T00:00:01Z",
            },
        )
        .unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let siblings = &packet[packet.find("\n## Sibling Stories\n").unwrap()..packet.find("\n## The Story\n").unwrap()];
        assert!(siblings.contains("Sibling work (Shaping)"), "{siblings}");
        assert!(!siblings.contains("Build the packet"), "the Story is not its own sibling:\n{siblings}");
        assert!(packet.contains("Packets are byte-identical"), "{packet}");
        assert!(packet.contains("Check: `cargo test packet`"), "{packet}");
        assert!(packet.contains(&format!("latest result: failed at {}", &head[..12])), "{packet}");
        assert!(packet.contains("Check: none (judged at review)"), "{packet}");
    });
}

#[test]
fn tasks_show_their_states_and_a_doing_task_is_to_be_reverified() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let a = add_task(&mut f.conn, &f.actor_id, &f.story.id, "Plan").unwrap();
        let b = add_task(&mut f.conn, &f.actor_id, &f.story.id, "Build").unwrap();
        let c = add_task(&mut f.conn, &f.actor_id, &f.story.id, "Cache").unwrap();
        set_task_state(&mut f.conn, &f.actor_id, &a.id, TaskState::Done, None).unwrap();
        set_task_state(&mut f.conn, &f.actor_id, &b.id, TaskState::Doing, None).unwrap();
        set_task_state(&mut f.conn, &f.actor_id, &c.id, TaskState::Dropped, Some("out of scope")).unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let tasks = &packet[packet.find("\n## Tasks\n").unwrap()..packet.find("\n## Review feedback").unwrap()];
        let plan = tasks.find("[done] Plan").expect("done task");
        let build = tasks.find("[doing] Build").expect("doing task");
        let cache = tasks.find("[dropped] Cache (out of scope)").expect("dropped task with reason");
        assert!(plan < build && build < cache, "{tasks}");
        assert!(tasks.contains("re-verify"), "{tasks}");
    });
}

// Issue #96: each Task's note sits under it, and the standing instructions ask the agent to keep
// the doing Task's note current.
#[test]
fn each_tasks_note_sits_under_it_and_the_agent_is_told_to_keep_it_current() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let a = add_task(&mut f.conn, &f.actor_id, &f.story.id, "Survey the repo").unwrap();
        add_task(&mut f.conn, &f.actor_id, &f.story.id, "Build").unwrap();
        set_task_state(&mut f.conn, &f.actor_id, &a.id, TaskState::Doing, None).unwrap();
        set_task_note(&mut f.conn, &f.actor_id, &a.id, "Read src/lib.rs.\nLeft: tests/.").unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let tasks = &packet[packet.find("\n## Tasks\n").unwrap()..packet.find("\n## Review feedback").unwrap()];
        assert!(tasks.contains("- [doing] Survey the repo\n  Note: Read src/lib.rs.\n  Left: tests/.\n- [open] Build\n"), "{tasks}");
        assert!(!tasks.contains("Note: \n"), "a Task without a note shows none: {tasks}");

        let standing = &packet[..packet.find("\n## Milestone and Epic").unwrap()];
        assert!(standing.contains("Keep the doing Task's note current through `task_update`"), "{standing}");
        assert!(standing.contains("always when you finish or leave a Task"), "{standing}");
        assert_eq!(packet, build_context_packet(&f.conn, &f.story.id, "").unwrap(), "still deterministic");
    });
}

#[test]
fn summaries_beyond_the_last_three_collapse_to_one_line() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let run = start_session(&mut f.conn, &f.story.id, "acceptEdits", &f.actor_id).unwrap();
        for i in 1..=5 {
            create_summary(&mut f.conn, &run.id, &format!("must-know {i}"), &format!("decision {i}")).unwrap();
        }
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(packet.contains("2 earlier sessions omitted"), "{packet}");
        for i in 1..=2 {
            assert!(!packet.contains(&format!("must-know {i}\n")), "summary {i} should be collapsed:\n{packet}");
        }
        for i in 3..=5 {
            assert!(packet.contains(&format!("must-know {i}")), "summary {i} in full:\n{packet}");
            assert!(packet.contains(&format!("decision {i}")), "{packet}");
        }
        let three = packet.find("must-know 3").unwrap();
        let five = packet.find("must-know 5").unwrap();
        assert!(three < five, "oldest first");
    });
}

#[test]
fn the_resume_note_appears_only_when_given() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        let with = build_context_packet(&f.conn, &f.story.id, "  Re-run the migration first.  ").unwrap();
        assert!(with.contains("Resume note: Re-run the migration first.\n"), "{with}");
        let without = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(!without.contains("Resume note:"), "{without}");
    });
}

/// The section between `## Review feedback and resume note` and the next heading.
fn review_section(packet: &str) -> &str {
    let start = packet.find("\n## Review feedback and resume note\n").expect("section 7");
    let end = packet.find("\n## Session summaries\n").expect("section 8");
    &packet[start..end]
}

/// Issue #158: after a request for changes, section 7 carries the review's comments in full, with the
/// instruction to add one Task per review point before anything else (spec §4.3); the resume note,
/// when given, follows them.
#[test]
fn a_request_for_changes_puts_its_comments_in_section_seven() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        set_story_state(&mut f.conn, &f.actor_id, &f.story.id, StoryState::Running).unwrap();
        set_story_state(&mut f.conn, &f.actor_id, &f.story.id, StoryState::InReview).unwrap();
        request_changes(&mut f.conn, &f.actor_id, &f.story.id, "Name the line in each error.\nCover an empty file.").unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "Start with the empty file.").unwrap();
        let section = review_section(&packet);
        assert!(section.contains("The developer requested changes at review:\n\nName the line in each error.\nCover an empty file.\n"), "{section}");
        assert!(section.contains("add one Task per review point"), "{section}");
        assert!(section.contains("Resume note: Start with the empty file."), "{section}");
        assert!(packet.contains("the developer requested changes: before anything else, add one Task per review point"), "{packet}");
        assert_eq!(packet, build_context_packet(&f.conn, &f.story.id, "Start with the empty file.").unwrap(), "still deterministic");
    });
}

/// One `propose` call on session `session_id`, as the core runs it; the Proposal's id.
fn propose(conn: &mut Connection, session_id: &str, args: serde_json::Value) -> String {
    let mut args = args;
    if args["kind"] == "new_story" && args.get("criteria").is_none() {
        // Issue #166: a New Story carries at least one criterion.
        args["criteria"] = serde_json::json!([{ "statement": "It holds" }]);
    }
    args["why"] = serde_json::json!("found while working");
    args["evidence"] = serde_json::json!("src/packet.rs:1");
    let call = StoryProposalCall::parse("propose", &args).unwrap();
    let answer = apply_story_proposal_call(conn, session_id, &call).unwrap().result;
    answer["proposal_id"].as_str().unwrap().to_string()
}

/// Issue #165: the filing Story hears what became of its Proposals through its next packet, never a
/// live push. Section 7 names each Proposal its sessions filed that was decided since its last session
/// started: accepted, rejected with the reason, or closed as a duplicate. A pending or withdrawn one is
/// not there, and once a later session has started, neither is a decision it already heard.
#[test]
fn the_next_packet_names_the_proposals_decided_since_the_last_session() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        let first = start_session(&mut f.conn, &f.story.id, "acceptEdits", &f.actor_id).unwrap();
        let sibling = stories_in_epic(&f.conn, &f.story.epic_id).unwrap().into_iter().find(|s| s.id != f.story.id).unwrap();
        let recovery = propose(&mut f.conn, &first.id, serde_json::json!({ "kind": "new_story", "title": "Recovery" }));
        let comments = propose(&mut f.conn, &first.id, serde_json::json!({ "kind": "new_story", "title": "Comments" }));
        let duplicate = propose(&mut f.conn, &first.id, serde_json::json!({ "kind": "new_story", "title": "RECOVERY" }));
        let withdrawn = propose(&mut f.conn, &first.id, serde_json::json!({ "kind": "retire_story", "story": sibling.key }));
        let call = StoryProposalCall::parse("proposal_withdraw", &serde_json::json!({ "proposal_id": withdrawn })).unwrap();
        apply_story_proposal_call(&mut f.conn, &first.id, &call).unwrap();
        let pending = propose(&mut f.conn, &first.id, serde_json::json!({ "kind": "new_story", "title": "Still waiting" }));
        assert_ne!(pending, duplicate);

        // One decided while the session ran, one after it ended: neither reached the agent live.
        reject_proposal(&mut f.conn, &f.actor_id, &comments, Some("Out of scope")).unwrap();
        close_session(&mut f.conn, &first.id, SessionStatus::Completed, None, None, None).unwrap();
        accept_proposal(&mut f.conn, &f.actor_id, &recovery).unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let section = review_section(&packet);
        assert!(section.contains("Your Proposals decided since your last session:\n"), "{section}");
        assert!(section.contains("- New Story \"Recovery\": accepted\n"), "{section}");
        assert!(section.contains("- New Story \"Comments\": rejected: Out of scope\n"), "{section}");
        assert!(section.contains("- New Story \"RECOVERY\": closed as a duplicate of Recovery\n"), "{section}");
        assert!(!section.contains("Still waiting") && !section.contains(&sibling.title), "pending and withdrawn are not decisions: {section}");
        assert!(!section.contains("None."), "{section}");
        assert_eq!(packet, build_context_packet(&f.conn, &f.story.id, "").unwrap(), "still deterministic");

        // The next session heard them: the one after it does not hear them again.
        let second = start_session(&mut f.conn, &f.story.id, "acceptEdits", &f.actor_id).unwrap();
        let during = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(review_section(&during).contains("- New Story \"Recovery\": accepted"), "the session just started still hears them");
        close_session(&mut f.conn, &second.id, SessionStatus::Completed, None, None, None).unwrap();
        let later = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(!review_section(&later).contains("Your Proposals decided"), "{later}");
        assert!(later.contains("Section 7 names your Proposals decided since your last session"), "the agent is told where to look");
        assert!(review_section(&later).contains("None."), "{later}");
    });
}

/// Issue #164: an ADR marked Not an ADR or Wrong decision at review reaches section 7 as a review
/// point after the developer's comments, under "ADR review points:", so the agent adds a Task for it.
#[test]
fn adr_decisions_at_review_reach_section_seven_as_review_points() {
    with_scratch_worktree_root(|_| {
        let mut f = fixture();
        set_story_state(&mut f.conn, &f.actor_id, &f.story.id, StoryState::Running).unwrap();
        set_story_state(&mut f.conn, &f.actor_id, &f.story.id, StoryState::InReview).unwrap();
        set_adr_decision(&mut f.conn, &f.actor_id, &f.story.id, "docs/adr/0006-other.md", &AdrDecision::NotAnAdr).unwrap();
        let wrong = AdrDecision::WrongDecision { what_is_wrong: "SQLite cannot hold the fleet".into(), should_be: "Keep SQLite, with WAL".into() };
        set_adr_decision(&mut f.conn, &f.actor_id, &f.story.id, "docs/adr/0003-third.md", &wrong).unwrap();
        request_changes(&mut f.conn, &f.actor_id, &f.story.id, "Cover an empty file.").unwrap();

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let section = review_section(&packet);
        assert!(
            section.contains(
                "The developer requested changes at review:\n\nCover an empty file.\n\nADR review points:\n\
                 - Wrong decision in `docs/adr/0003-third.md`: SQLite cannot hold the fleet. It should be: Keep SQLite, with WAL. \
                 Change the code and the ADR.\n\
                 - Delete `docs/adr/0006-other.md`; keep the decision out of docs/adr.\n"
            ),
            "{section}"
        );
        assert!(section.contains("add one Task per review point"), "{section}");
    });
}

#[test]
fn a_story_never_sent_back_has_no_review_feedback() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(review_section(&packet).contains("None."), "{packet}");
        assert!(!packet.contains("requested changes at review"), "{packet}");
    });
}

#[test]
fn the_diff_lists_committed_files_and_marks_uncommitted_changes_from_a_stopped_session() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        write(&f.worktree, "docs/half_done.md", "// half\n");
        write(&f.worktree, "GLOSSARY.md", "# Glossary\n\nEdited.\n");
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let diff = &packet[packet.find("\n## Diff so far\n").unwrap()..packet.find("\n## Closing instruction\n").unwrap()];
        assert!(diff.contains("docs/adr/0003-third.md"), "committed files are listed:\n{diff}");
        assert!(diff.contains("left by a stopped session"), "{diff}");
        assert!(diff.contains("docs/half_done.md"), "{diff}");
        let marked = diff.find("left by a stopped session").unwrap();
        assert!(diff.find("docs/half_done.md").unwrap() > marked, "the untracked file sits under the mark:\n{diff}");
        assert!(!diff.contains("// half"), "no hunks:\n{diff}");
    });
}

#[test]
fn a_clean_worktree_has_no_uncommitted_mark() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(!packet.contains("left by a stopped session"), "{packet}");
    });
}

#[test]
fn a_story_without_a_worktree_still_gets_a_packet() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let story = common::new_story(&mut conn, &project.id, &actor_id, "No worktree yet");
    let packet = build_context_packet(&conn, &story.id, "").unwrap();
    let at = positions(&packet);
    assert!(at.windows(2).all(|w| w[0] < w[1]));
    assert!(packet.contains("No worktree yet"), "{packet}");
}

#[test]
fn an_unknown_story_is_an_error() {
    let (conn, _, _) = common::seeded_project();
    assert!(build_context_packet(&conn, "no-such-story", "").is_err());
}

#[test]
fn the_size_warns_above_about_twenty_thousand_tokens() {
    assert_eq!(SOFT_LIMIT_TOKENS, 20_000);
    let small = measure("abcd".repeat(100).as_str());
    assert_eq!(small.bytes, 400);
    assert_eq!(small.approx_tokens, 100);
    assert!(!small.over_soft_limit);
    let at_limit = measure("abcd".repeat(20_000).as_str());
    assert!(!at_limit.over_soft_limit, "exactly at the limit is not over it");
    let big = measure("abcd".repeat(20_001).as_str());
    assert!(big.over_soft_limit);
}

#[test]
fn the_story_size_is_the_packet_without_a_resume_note() {
    with_scratch_worktree_root(|_| {
        let f = fixture();
        let size = context_packet_size(&f.conn, &f.story.id).unwrap();
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert_eq!(size, measure(&packet));
    });
}
