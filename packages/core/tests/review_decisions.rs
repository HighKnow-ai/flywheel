//! The review's Decisions section (docs/mvp-spec.md §8, issue #161, ADR 0010): the Story's changes
//! to `docs/adr/` and `GLOSSARY.md`, listed apart from the code with a count. Each new ADR carries
//! its bar lines, from the hand-off or else from the ADR Proposal accepted in shaping, and the live
//! ADRs on the base branch its "Relates to" line names. Bar lines are never read out of the file.

mod common;

use std::path::Path;
use std::process::Command;

use common::with_scratch_worktree_root;
use core::domain::handoff::{hand_off_with, HandoffSummary};
use core::domain::proposal::{accept_proposal, file_proposal, NewProposal, ProposalTarget, ProposalVerb};
use core::domain::proposal_apply::AdrBarLines;
use core::domain::review_decisions::{review_decisions, BarLinesSource, DecisionKind, RelatedAdr};
use core::domain::session::{agent_actor_id, start_session};
use core::domain::story::{set_story_state, StoryState};
use core::domain::task::{add_task, set_task_state, TaskState};
use core::domain::worktree::ensure_worktree;
use serde_json::json;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
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

fn bar(path: &str, relates_to: Option<&str>) -> AdrBarLines {
    AdrBarLines {
        path: path.into(),
        hard_to_reverse: "Every review reads it".into(),
        surprising: "Bar lines usually live in the file".into(),
        losing_alternative: "Parsing the ADR file".into(),
        relates_to: relates_to.map(str::to_string),
    }
}

#[test]
fn the_review_lists_adr_and_glossary_changes_apart_and_each_new_adr_carries_its_bar_lines_and_related_live_adrs() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, repo) = common::seeded_git_project();
        // The base branch: ADR 0001 superseded by 0002, which is live, and a glossary.
        write(repo.path(), "docs/adr/0001-use-sqlite.md", "# Use SQLite\n\nStatus: superseded by ADR-0002\n");
        write(repo.path(), "docs/adr/0002-repo-holds-knowledge.md", "# The repo holds knowledge\n\nSupersedes ADR-0001\n");
        write(repo.path(), "GLOSSARY.md", "# Glossary\n\n**Story**: a unit of work.\n");
        commit_all(repo.path(), "base ADRs");

        let story = common::new_story(&mut conn, &project.id, &human, "Reviews");
        // An ADR accepted while shaping the Epic, which this Story writes verbatim.
        let shaped = file_proposal(
            &mut conn,
            &human,
            &NewProposal {
                project_id: &project.id,
                session_id: None,
                epic_id: Some(&story.epic_id),
                verb: ProposalVerb::Create,
                target: ProposalTarget::Adr,
                target_id: None,
                payload: json!({
                    "path": "docs/adr/0004-shaped.md",
                    "text": "# Shaped in a Round\n",
                    "hard_to_reverse": "Shaping settled it",
                    "surprising": "It came from a Round",
                    "losing_alternative": "Leaving it to the Story",
                    "relates_to": "ADR-0002",
                }),
                rationale: None,
            },
        )
        .unwrap();
        accept_proposal(&mut conn, &human, &shaped.id).unwrap();

        set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
        let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
        let worktree = Path::new(&wt.path);
        let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
        let agent = agent_actor_id(&conn).unwrap();
        let task = add_task(&mut conn, &agent, &story.id, "Write it").unwrap();
        set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();

        // The branch: three new ADRs, a reworded existing one, the glossary and code.
        write(
            worktree,
            "docs/adr/0003-reviews.md",
            "# Reviews are a board record\n\nHard to reverse: this line is in the file and is not read.\n",
        );
        write(worktree, "docs/adr/0004-shaped.md", "# Shaped in a Round\n");
        write(worktree, "docs/adr/0005-bare.md", "# Written without bar lines\n");
        write(worktree, "docs/adr/0002-repo-holds-knowledge.md", "# The repo holds knowledge\n\nSupersedes ADR-0001\n\nReworded.\n");
        write(worktree, "GLOSSARY.md", "# Glossary\n\n**Story**: a unit of work.\n**Review**: a board record.\n");
        write(worktree, "src/review.rs", "pub fn review() {}\n");
        commit_all(worktree, "Reviews");

        let summary = HandoffSummary {
            next_session_must_know: "Done.".into(),
            decisions: String::new(),
            // 0001 is superseded on the base branch and 0009 does not exist: neither is a related live ADR.
            adrs: vec![bar("docs/adr/0003-reviews.md", Some("ADR-0001, ADR-0002 and ADR-0009"))],
        };
        hand_off_with(&mut conn, &session.id, &summary).unwrap();

        let decisions = review_decisions(&conn, &story.id).unwrap();
        assert_eq!(decisions.count(), 5, "four ADR changes and the glossary; the code is not a decision");

        let paths: Vec<(&str, DecisionKind, &str)> =
            decisions.changes.iter().map(|c| (c.path.as_str(), c.kind, c.status.as_str())).collect();
        assert_eq!(
            paths,
            [
                ("docs/adr/0002-repo-holds-knowledge.md", DecisionKind::Adr, "M"),
                ("docs/adr/0003-reviews.md", DecisionKind::Adr, "A"),
                ("docs/adr/0004-shaped.md", DecisionKind::Adr, "A"),
                ("docs/adr/0005-bare.md", DecisionKind::Adr, "A"),
                ("GLOSSARY.md", DecisionKind::Glossary, "M"),
            ],
            "ADRs first, by path, then the glossary"
        );

        let card = |path: &str| {
            decisions.changes.iter().find(|c| c.path == path).unwrap().new_adr.clone()
        };
        assert!(card("docs/adr/0002-repo-holds-knowledge.md").is_none(), "an edited ADR is not a new one");
        assert!(card("GLOSSARY.md").is_none());

        let handed = card("docs/adr/0003-reviews.md").expect("a new ADR");
        assert_eq!(handed.title, "Reviews are a board record");
        assert_eq!(handed.bar_lines_from, Some(BarLinesSource::Handoff));
        assert_eq!(handed.bar_lines, Some(bar("docs/adr/0003-reviews.md", Some("ADR-0001, ADR-0002 and ADR-0009"))));
        assert_eq!(
            handed.related,
            [RelatedAdr { path: "docs/adr/0002-repo-holds-knowledge.md".into(), title: "The repo holds knowledge".into() }],
            "only the live ADRs on the base branch it names"
        );

        let from_shaping = card("docs/adr/0004-shaped.md").expect("a new ADR");
        assert_eq!(from_shaping.bar_lines_from, Some(BarLinesSource::Shaping));
        assert_eq!(from_shaping.bar_lines.as_ref().unwrap().hard_to_reverse, "Shaping settled it");
        assert_eq!(from_shaping.related.len(), 1);
        assert_eq!(from_shaping.proposal_id.as_deref(), Some(shaped.id.as_str()), "accepted in shaping");

        let bare = card("docs/adr/0005-bare.md").expect("a new ADR");
        assert_eq!(bare.bar_lines, None, "no bar lines: none in the hand-off, none accepted in shaping");
        assert_eq!(bare.bar_lines_from, None);
        assert!(bare.related.is_empty());
        assert_eq!(bare.proposal_id, None);
    });
}

#[test]
fn a_story_without_decisions_has_an_empty_section() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "Code only");
        set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
        let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
        write(Path::new(&wt.path), "src/lib.rs", "pub fn f() {}\n");
        commit_all(Path::new(&wt.path), "code");

        let decisions = review_decisions(&conn, &story.id).unwrap();
        assert_eq!(decisions.count(), 0);
        assert!(decisions.changes.is_empty());
    });
}
