//! A project rooted in a subdirectory of a larger repository (cymarechal/highknow-mvp#551): the
//! developer registers `<repo>/flywheel`, not `<repo>`. Git sees one repository, so a Story's
//! worktree is a worktree of the whole repository; the project lives at the same subdirectory inside
//! it, and that is where the agent starts, where the Checks run, where the Context packet reads the
//! ADRs and the glossary, where the editor opens, and what the review's Decisions section reads
//! paths relative to. The board stays the one the subdirectory's `.flywheel/project.json` names.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use core::context_packet::build_context_packet;
use core::db::open_and_migrate;
use core::domain::acceptance_criterion::{accept_criterion, create_criterion, criteria_for_story};
use core::domain::actor::local_human_actor_id;
use core::domain::check::{set_check, CheckResult};
use core::domain::handoff::{hand_off_with, HandoffSummary};
use core::domain::project::{list_projects, register_project};
use core::domain::proposal_apply::AdrBarLines;
use core::domain::review::review_file_patch;
use core::domain::review_decisions::{review_decisions, BarLinesSource, DecisionFlag, DecisionKind};
use core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use core::domain::story::{get_story, set_story_state, StoryState};
use core::domain::story_merge::{merge_story, MergeOptions};
use core::domain::task::{add_task, set_task_state, TaskState};
use core::domain::worktree::{ensure_worktree, resolve_open_argv, OpenSurface};
use core::marker::read_marker;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(dir: &Path, path: &str, body: &str) {
    let file = dir.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, body).unwrap();
}

/// A repository whose root holds another product's file and whose `flywheel/` holds the project:
/// its own ADR, glossary and a file only a Check run from `flywheel/` can see.
fn monorepo() -> tempfile::TempDir {
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init", "-q", "--initial-branch=main"]);
    write(repo.path(), "README.md", "the larger repository\n");
    write(repo.path(), "flywheel/docs/adr/0001-first-decision.md", "# First decision\n");
    write(repo.path(), "flywheel/GLOSSARY.md", "# Glossary\n");
    write(repo.path(), "flywheel/only-in-the-project.txt", "here\n");
    git(repo.path(), &["add", "-A"]);
    git(repo.path(), &["commit", "-q", "-m", "initial commit"]);
    repo
}

#[test]
fn a_project_in_a_subdirectory_creates_worktrees_runs_a_story_and_keeps_its_board() {
    with_scratch_worktree_root(|_| {
        let runtime = tempfile::tempdir().unwrap();
        // SAFETY: the worktree-root lock held by this closure serialises every test in this binary.
        unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path()) };

        let repo = monorepo();
        let root = repo.path().canonicalize().unwrap();
        let project_dir = root.join("flywheel");

        let db = tempfile::tempdir().unwrap();
        let mut conn = open_and_migrate(&db.path().join("flywheel.db"), &db.path().join("backups")).unwrap();
        let human = local_human_actor_id(&conn).unwrap();

        // The board: registered at the subdirectory, its marker there, committed like any other file.
        let project = register_project(&mut conn, &human, &project_dir, "Flywheel", "FLY").unwrap();
        assert_eq!(Path::new(&project.repo_path), project_dir);
        let marker = read_marker(&project_dir).unwrap().expect("the marker is written in the subdirectory");
        assert_eq!(marker.project_id, project.id);
        assert!(!root.join(".flywheel").exists(), "nothing is written at the repository's root");
        git(&root, &["add", "flywheel/.flywheel/project.json"]);
        git(&root, &["commit", "-q", "-m", "register the project"]);

        let story = common::new_story(&mut conn, &project.id, &human, "Write the second decision");
        let criterion = create_criterion(&mut conn, &human, &story.id, "The project's file is there").unwrap();
        // Passes only when run from the project's directory, not from the worktree's root.
        set_check(&mut conn, &human, &criterion.id, "test -f only-in-the-project.txt && test -d docs/adr", None).unwrap();
        set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();

        // The worktree is the whole repository's; the project sits at the same subdirectory in it.
        let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
        let wt_root = PathBuf::from(&wt.path);
        assert!(wt_root.join("README.md").is_file(), "the worktree is a worktree of the whole repository");
        let wt_project = wt.project_dir();
        assert_eq!(wt_project, wt_root.join("flywheel"), "the agent works in the project's directory");
        assert_eq!(
            read_marker(&wt_project).unwrap().map(|m| m.project_id),
            Some(project.id.clone()),
            "the worktree's project directory names the same board"
        );

        // The editor and the terminal open where the agent works.
        let argv = resolve_open_argv(&conn, &story.id, OpenSurface::Editor).unwrap();
        assert_eq!(argv.last().map(String::as_str), Some(wt_project.to_str().unwrap()));

        // The Context packet reads the project's ADRs and glossary, not the repository root's.
        let packet = build_context_packet(&conn, &story.id, "").unwrap();
        assert!(packet.contains("docs/adr/0001-first-decision.md"), "the project's ADR is listed:\n{packet}");
        assert!(packet.contains("Glossary: `GLOSSARY.md`"), "the project's glossary is found:\n{packet}");

        // The agent's session: it writes an ADR and code in the project's directory and hands off.
        let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
        let agent = agent_actor_id(&conn).unwrap();
        let task = add_task(&mut conn, &agent, &story.id, "Write it").unwrap();
        set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();
        write(&wt_project, "docs/adr/0002-second-decision.md", "# Second decision\n");
        write(&wt_project, "docs/adr/0001-first-decision.md", "# First decision\n\nReworded.\n");
        write(&wt_project, "src/lib.rs", "pub fn second() {}\n");
        git(&wt_project, &["add", "-A", "."]);
        git(&wt_project, &["commit", "-q", "-m", "second decision"]);

        let summary = HandoffSummary {
            next_session_must_know: "Done.".into(),
            decisions: String::new(),
            adrs: vec![AdrBarLines {
                path: "docs/adr/0002-second-decision.md".into(),
                hard_to_reverse: "Every later Story reads it".into(),
                surprising: "It lives in a subdirectory".into(),
                losing_alternative: "Rooting the project at the repository".into(),
                relates_to: Some("ADR-0001".into()),
            }],
            check_objections: Vec::new(),
        };
        let outcome = hand_off_with(&mut conn, &session.id, &summary).unwrap();
        let results: Vec<CheckResult> = outcome.batch.outcomes.iter().map(|o| o.result).collect();
        assert_eq!(
            results,
            [CheckResult::Passed],
            "the Check runs from the project's directory: {}",
            outcome.batch.outcomes[0].output_tail
        );

        // The review's Decisions section reads the project's `docs/adr/`, with project-relative paths.
        let decisions = review_decisions(&conn, &story.id).unwrap();
        let changes: Vec<(&str, DecisionKind, &str)> =
            decisions.changes.iter().map(|c| (c.path.as_str(), c.kind, c.status.as_str())).collect();
        assert_eq!(
            changes,
            [
                ("docs/adr/0001-first-decision.md", DecisionKind::Adr, "M"),
                ("docs/adr/0002-second-decision.md", DecisionKind::Adr, "A"),
            ]
        );
        assert_eq!(
            decisions.changes[0].flags,
            [DecisionFlag::WordingOrSupersede],
            "the reworded ADR's patch is read at its project path"
        );
        let new_adr = decisions.changes[1].new_adr.as_ref().expect("a new ADR");
        assert_eq!(new_adr.title, "Second decision");
        assert_eq!(new_adr.bar_lines_from, Some(BarLinesSource::Handoff));
        let related: Vec<&str> = new_adr.related.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(related, ["docs/adr/0001-first-decision.md"]);

        // The review card names files from the repository's root and reads each one's patch.
        let patch = review_file_patch(&conn, &story.id, "flywheel/src/lib.rs", None).unwrap();
        assert!(patch.contains("pub fn second"), "{patch}");

        // Merge lands the work on the base branch, under the subdirectory.
        close_session(&mut conn, &session.id, SessionStatus::Completed, None, None, None).unwrap();
        for c in criteria_for_story(&conn, &story.id).unwrap() {
            accept_criterion(&mut conn, &human, &c.id).unwrap();
        }
        let merged = merge_story(&mut conn, &human, &story.id, MergeOptions { with_failing_checks: false }).unwrap();
        assert_eq!(merged.adrs_linked, ["docs/adr/0002-second-decision.md"], "the new ADR is linked by its project path");
        assert_eq!(get_story(&conn, &story.id).unwrap().unwrap().state, "merged");
        assert!(project_dir.join("docs/adr/0002-second-decision.md").is_file(), "merged into the checkout");
        assert!(!wt_root.exists(), "the worktree is removed");

        // Still one board, at the subdirectory.
        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(Path::new(&projects[0].repo_path), project_dir);

        unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    });
}
