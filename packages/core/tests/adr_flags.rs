//! The Decisions section's flags and ADR decisions (docs/mvp-spec.md §6, §8, issue #164, ADR 0016).
//!
//! Three flags, read from git and never stored:
//! - an existing ADR with any changed line other than `Status:` reads "wording or supersede?";
//! - a new ADR whose number another file holds on the base branch's tip reads "renumber";
//! - a new ADR that says "Supersedes ADR-NNNN" while the old file lacks `Status: superseded by` reads
//!   "supersession line missing".
//!
//! Two decisions besides Keep, stored on the open review: **Not an ADR** and **Wrong decision** (what
//! is wrong, what it should be). While either is on a new ADR, Merge refuses; a request for changes
//! carries each one, and the renumber and supersession flags, to the next session as review points.
//! Neither sends the Story back by itself.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use flywheel_core::context_packet::build_context_packet;
use flywheel_core::domain::acceptance_criterion::{
    accept_criterion, create_criterion, criteria_for_story,
};
use flywheel_core::domain::check::set_check;
use flywheel_core::domain::handoff::hand_off;
use flywheel_core::domain::request_changes::request_changes;
use flywheel_core::domain::review::{latest_review, open_review};
use flywheel_core::domain::review_decisions::{
    review_decisions, set_adr_decision, AdrDecision, DecisionFlag, ReviewDecisions,
};
use flywheel_core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use flywheel_core::domain::story::{get_story, set_story_state, Story, StoryState};
use flywheel_core::domain::story_merge::{merge_story, MergeOptions};
use flywheel_core::domain::task::{add_task, set_task_state, TaskState};
use flywheel_core::domain::worktree::ensure_worktree;
use rusqlite::Connection;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(dir: &Path, path: &str, body: &str) {
    let file = dir.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, body).unwrap();
}

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

const WORDING: &str = "docs/adr/0001-use-sqlite.md";
const STATUS_ONLY: &str = "docs/adr/0002-status-only.md";
const MARKED_OLD: &str = "docs/adr/0003-marked.md";
const UNMARKED_OLD: &str = "docs/adr/0004-unmarked.md";
const SUPERSEDES_MARKED: &str = "docs/adr/0005-supersedes-marked.md";
const SUPERSEDES_UNMARKED: &str = "docs/adr/0006-supersedes-unmarked.md";
const CLASHING: &str = "docs/adr/0007-mine.md";
const LANDED_MEANWHILE: &str = "docs/adr/0007-landed-meanwhile.md";

struct Fixture {
    conn: Connection,
    human: String,
    repo: TempDir,
    story: Story,
    worktree: PathBuf,
}

impl Fixture {
    fn decisions(&self) -> ReviewDecisions {
        review_decisions(&self.conn, &self.story.id).unwrap()
    }

    fn flags(&self, path: &str) -> Vec<DecisionFlag> {
        let decisions = self.decisions();
        decisions
            .changes
            .iter()
            .find(|c| c.path == path)
            .unwrap_or_else(|| panic!("{path} is not a change"))
            .flags
            .clone()
    }

    fn decide(&mut self, path: &str, decision: AdrDecision) -> anyhow::Result<()> {
        let human = self.human.clone();
        set_adr_decision(&mut self.conn, &human, &self.story.id, path, &decision)
    }

    fn merge(&mut self) -> anyhow::Result<flywheel_core::domain::story_merge::MergeOutcome> {
        let human = self.human.clone();
        merge_story(
            &mut self.conn,
            &human,
            &self.story.id,
            MergeOptions::default(),
        )
    }

    fn state(&self) -> String {
        get_story(&self.conn, &self.story.id)
            .unwrap()
            .unwrap()
            .state
    }
}

fn wrong() -> AdrDecision {
    AdrDecision::WrongDecision {
        what_is_wrong: "It keeps the lock across the git call".into(),
        should_be: "Release the lock before any git call".into(),
    }
}

/// An In review Story with one passing Check and its criterion accepted. The base branch holds ADRs
/// 0001 to 0004. The branch rewords 0001, edits only 0002's `Status:` line, and adds 0005 (superseding
/// 0003, which it marks), 0006 (superseding 0004, which it leaves unmarked) and 0007. After the
/// hand-off, another 0007 lands on the base branch.
fn in_review() -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    write(
        repo.path(),
        WORDING,
        "# Use SQLite\n\nStatus: accepted\n\nWe store the board in SQLite.\n",
    );
    write(
        repo.path(),
        STATUS_ONLY,
        "# Status only\n\nStatus: proposed\n\nBody.\n",
    );
    write(
        repo.path(),
        MARKED_OLD,
        "# Marked\n\nStatus: accepted\n\nBody.\n",
    );
    write(
        repo.path(),
        UNMARKED_OLD,
        "# Unmarked\n\nStatus: accepted\n\nBody.\n",
    );
    commit_all(repo.path(), "base ADRs");

    let story = common::new_story(&mut conn, &project.id, &human, "Decide things");
    let criterion = create_criterion(&mut conn, &human, &story.id, "It works").unwrap();
    set_check(&mut conn, &human, &criterion.id, "true", None).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let worktree = PathBuf::from(&wt.path);
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let task = add_task(&mut conn, &agent, &story.id, "Decide").unwrap();
    set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();

    write(
        &worktree,
        WORDING,
        "# Use SQLite\n\nStatus: accepted\n\nWe store the board and the outbox in SQLite.\n",
    );
    write(
        &worktree,
        STATUS_ONLY,
        "# Status only\n\n**Status:** accepted\n\nBody.\n",
    );
    write(
        &worktree,
        MARKED_OLD,
        "# Marked\n\nStatus: superseded by ADR-0005\n\nBody.\n",
    );
    write(
        &worktree,
        SUPERSEDES_MARKED,
        "# Supersedes the marked one\n\nSupersedes ADR-0003.\n",
    );
    write(
        &worktree,
        SUPERSEDES_UNMARKED,
        "# Supersedes the unmarked one\n\n- Supersedes [ADR-0004](0004-unmarked.md)\n",
    );
    write(&worktree, CLASHING, "# Mine\n\nStatus: accepted\n");
    write(&worktree, "src/lib.rs", "pub fn decide() {}\n");
    commit_all(&worktree, "Decide things");
    hand_off(&mut conn, &session.id, "Done.", "").unwrap();
    close_session(
        &mut conn,
        &session.id,
        SessionStatus::Completed,
        None,
        None,
        None,
    )
    .unwrap();

    // Another Story merged an ADR 0007 into the base branch since.
    write(repo.path(), LANDED_MEANWHILE, "# Landed meanwhile\n");
    commit_all(repo.path(), "Another Story's ADR");

    for c in criteria_for_story(&conn, &story.id).unwrap() {
        accept_criterion(&mut conn, &human, &c.id).unwrap();
    }
    Fixture {
        conn,
        human,
        repo,
        story,
        worktree,
    }
}

#[test]
fn a_wording_edit_a_number_clash_and_a_missing_supersession_line_are_each_flagged_and_a_status_only_edit_is_not(
) {
    with_scratch_worktree_root(|_| {
        let f = in_review();

        assert_eq!(
            f.flags(WORDING),
            [DecisionFlag::WordingOrSupersede],
            "a changed line other than Status:"
        );
        assert!(
            f.flags(STATUS_ONLY).is_empty(),
            "only the Status: line changed"
        );
        assert!(
            f.flags(MARKED_OLD).is_empty(),
            "marked superseded: only its Status: line changed"
        );

        assert_eq!(
            f.flags(CLASHING),
            [DecisionFlag::Renumber {
                number: 7,
                taken_by: LANDED_MEANWHILE.into(),
                base_branch: "main".into()
            }],
            "0007 is taken on the base branch's tip by another file"
        );
        assert_eq!(
            f.flags(SUPERSEDES_UNMARKED),
            [DecisionFlag::SupersessionLineMissing {
                superseded: UNMARKED_OLD.into(),
                number: 4
            }],
            "0004 has no Status: superseded by line at the branch's head"
        );
        assert!(
            f.flags(SUPERSEDES_MARKED).is_empty(),
            "0003 carries its Status: superseded by line"
        );

        let points = f.decisions().review_points();
        assert_eq!(
            points,
            [
                "Add a `Status: superseded by ADR-0006` line to `docs/adr/0004-unmarked.md`, which \
                 `docs/adr/0006-supersedes-unmarked.md` supersedes."
                    .to_string(),
                "Renumber `docs/adr/0007-mine.md`: ADR-0007 is already taken on main by \
                 `docs/adr/0007-landed-meanwhile.md`."
                    .to_string(),
            ],
            "the renumber and supersession flags are review points; wording or supersede? is the developer's question"
        );
    });
}

#[test]
fn not_an_adr_and_wrong_decision_are_stored_on_the_review_and_keep_clears_them() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let new_adr = |f: &Fixture, path: &str| {
            f.decisions()
                .changes
                .into_iter()
                .find(|c| c.path == path)
                .unwrap()
                .new_adr
                .expect("a new ADR")
        };
        assert_eq!(
            new_adr(&f, CLASHING).decision,
            AdrDecision::Keep,
            "Keep is the default"
        );

        f.decide(CLASHING, AdrDecision::NotAnAdr).unwrap();
        f.decide(SUPERSEDES_MARKED, wrong()).unwrap();
        assert_eq!(new_adr(&f, CLASHING).decision, AdrDecision::NotAnAdr);
        assert_eq!(new_adr(&f, SUPERSEDES_MARKED).decision, wrong());
        assert_eq!(
            f.state(),
            "in_review",
            "Not an ADR does not send the Story back by itself"
        );
        let stored = open_review(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .adr_decisions;
        assert_eq!(stored.as_array().unwrap().len(), 2, "{stored}");

        f.decide(CLASHING, AdrDecision::Keep).unwrap();
        assert_eq!(new_adr(&f, CLASHING).decision, AdrDecision::Keep);
        let stored = open_review(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .adr_decisions;
        assert_eq!(
            stored.as_array().unwrap().len(),
            1,
            "Keep is not stored: {stored}"
        );

        let events: i64 = f
            .conn
            .query_row("SELECT COUNT(*) FROM events WHERE event_type = 'review.adr_decided' AND story_id = ?1", [&f.story.id], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 3, "each decision is on the record");
    });
}

#[test]
fn a_decision_is_refused_for_an_agent_a_path_that_is_not_a_new_adr_and_a_wrong_decision_missing_a_field(
) {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let agent = agent_actor_id(&f.conn).unwrap();
        assert!(
            set_adr_decision(
                &mut f.conn,
                &agent,
                &f.story.id,
                CLASHING,
                &AdrDecision::NotAnAdr
            )
            .is_err(),
            "human-only"
        );

        let err = f
            .decide(WORDING, AdrDecision::NotAnAdr)
            .unwrap_err()
            .to_string();
        assert!(err.contains("not an ADR this branch adds"), "{err}");
        let err = f
            .decide("src/lib.rs", AdrDecision::NotAnAdr)
            .unwrap_err()
            .to_string();
        assert!(err.contains("not an ADR this branch adds"), "{err}");

        let blank = AdrDecision::WrongDecision {
            what_is_wrong: "It is wrong".into(),
            should_be: "  ".into(),
        };
        let err = f.decide(CLASHING, blank).unwrap_err().to_string();
        assert!(
            err.contains("what is wrong") && err.contains("what it should be"),
            "{err}"
        );

        let stored = open_review(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .adr_decisions;
        assert_eq!(stored, serde_json::json!([]), "a refusal writes nothing");
    });
}

#[test]
fn merge_is_refused_while_an_adr_is_marked_not_an_adr_or_wrong_decision() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        f.decide(CLASHING, AdrDecision::NotAnAdr).unwrap();
        f.decide(SUPERSEDES_MARKED, wrong()).unwrap();
        let main_before = git(f.repo.path(), &["rev-parse", "refs/heads/main"]);

        let err = f.merge().unwrap_err().to_string();
        assert!(
            err.contains("docs/adr/0005-supersedes-marked.md (Wrong decision)")
                && err.contains("docs/adr/0007-mine.md (Not an ADR)"),
            "{err}"
        );
        assert!(err.contains("Request changes"), "{err}");
        assert_eq!(f.state(), "in_review");
        assert_eq!(
            git(f.repo.path(), &["rev-parse", "refs/heads/main"]),
            main_before,
            "nothing merged"
        );

        f.decide(CLASHING, AdrDecision::Keep).unwrap();
        f.decide(SUPERSEDES_MARKED, AdrDecision::Keep).unwrap();
        f.merge()
            .expect("every ADR kept: the flags alone do not hold Merge");
        assert_eq!(f.state(), "merged");
        assert!(!f.worktree.is_dir());
    });
}

#[test]
fn request_changes_carries_the_adr_decisions_and_flags_to_the_next_packet_as_review_points() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        f.decide(CLASHING, AdrDecision::NotAnAdr).unwrap();
        f.decide(SUPERSEDES_MARKED, wrong()).unwrap();
        let human = f.human.clone();
        request_changes(
            &mut f.conn,
            &human,
            &f.story.id,
            "Name the line in each error.",
        )
        .unwrap();

        let comments = latest_review(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .comments
            .unwrap();
        assert_eq!(
            comments,
            "Name the line in each error.\n\n\
             ADR review points:\n\
             - Wrong decision in `docs/adr/0005-supersedes-marked.md`: It keeps the lock across the git call. It should be: \
             Release the lock before any git call. Change the code and the ADR.\n\
             - Add a `Status: superseded by ADR-0006` line to `docs/adr/0004-unmarked.md`, which \
             `docs/adr/0006-supersedes-unmarked.md` supersedes.\n\
             - Delete `docs/adr/0007-mine.md`; keep the decision out of docs/adr.",
            "by ADR path; an ADR that is not one is not renumbered"
        );
        assert_eq!(f.state(), "running");

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(
            packet.contains("- Delete `docs/adr/0007-mine.md`; keep the decision out of docs/adr."),
            "{packet}"
        );
        assert!(
            packet.contains("- Wrong decision in `docs/adr/0005-supersedes-marked.md`"),
            "{packet}"
        );
        assert!(packet.contains("add one Task per review point"), "{packet}");
    });
}

#[test]
fn the_adr_points_alone_are_enough_to_request_changes_and_nothing_at_all_is_not() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        // Make the branch flag-free so only the decision is a point: renumber the clash and mark 0004.
        git(&f.worktree, &["mv", CLASHING, "docs/adr/0008-mine.md"]);
        write(
            &f.worktree,
            UNMARKED_OLD,
            "# Unmarked\n\nStatus: superseded by ADR-0006\n\nBody.\n",
        );
        commit_all(&f.worktree, "renumber and mark");
        assert!(
            f.decisions().review_points().is_empty(),
            "{:?}",
            f.decisions().review_points()
        );

        let human = f.human.clone();
        let err = request_changes(&mut f.conn, &human, &f.story.id, "   ")
            .unwrap_err()
            .to_string();
        assert!(err.contains("needs a comment"), "{err}");

        f.decide(SUPERSEDES_MARKED, AdrDecision::NotAnAdr).unwrap();
        request_changes(&mut f.conn, &human, &f.story.id, "").unwrap();
        let comments = latest_review(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .comments
            .unwrap();
        assert_eq!(
            comments,
            "ADR review points:\n- Delete `docs/adr/0005-supersedes-marked.md`; keep the decision out of docs/adr."
        );
    });
}
