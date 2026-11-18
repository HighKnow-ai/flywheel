//! Landing (ADR 0042, issue #1757): Merge takes the project's landing mode. A project with a forge
//! lands by pull request (the default) or by a landing command and the Story waits in Landing; a
//! project with no forge keeps the local merge of ADR 0009.
//!
//! The forge CLI is a stub: a shell script named `gh` (and one named `glab`) in a scratch directory that records its calls
//! and answers from files, so no test touches a network or a real account. The remote is a local
//! bare repository, reached by its own path or through an `insteadOf` rewrite of a GitHub URL.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use flywheel_core::domain::handoff::hand_off;
use flywheel_core::domain::landing::{
    apply_request, landing_for_story, landing_plans, landing_tick, read_request, read_settings,
    refresh_landing, route_for, set_settings, LandingMode, LandingSettings, Route,
};
use flywheel_core::domain::review::{open_review, reviews_for_story};
use flywheel_core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use flywheel_core::domain::story::{get_story, set_story_state, Story, StoryState};
use flywheel_core::domain::story_drop::drop_story;
use flywheel_core::domain::story_merge::{
    merge_story_with, MergeMethod, MergeOptions, MergeOutcome,
};
use flywheel_core::domain::task::{add_task, set_task_state, TaskState};
use flywheel_core::domain::worktree::{ensure_worktree, worktree_for_story};
use flywheel_core::forge::{Forge, ForgeCli};
use flywheel_core::query::needs_you::needs_you;
use rusqlite::{params, Connection};
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

/// A stub `gh`. It records `$*` in `calls`, and answers from the files beside it: `signed-out`
/// makes `auth status` fail, `pr-state` holds the request's state (`OPEN`, `MERGED`, `CLOSED`; no
/// file means no request), `no-auto-merge` makes `pr merge` fail.
const STUB_GH: &str = r#"#!/bin/sh
dir=$(dirname "$0")
echo "$@" >> "$dir/calls"
case "$1 $2" in
  "auth status")
    if [ -f "$dir/signed-out" ]; then echo "You are not logged in. Run: gh auth login" >&2; exit 1; fi
    exit 0 ;;
  "pr view")
    if [ -f "$dir/pr-state" ]; then
      sha=""
      if [ -f "$dir/merge-sha" ]; then sha=",\"mergeCommit\":{\"oid\":\"$(cat "$dir/merge-sha")\"}"; fi
      printf '{"state":"%s","url":"https://github.com/acme/app/pull/7"%s}\n' "$(cat "$dir/pr-state")" "$sha"
    else
      echo 'no pull requests found for branch "x"' >&2; exit 1
    fi ;;
  "pr create")
    echo OPEN > "$dir/pr-state"; echo "https://github.com/acme/app/pull/7" ;;
  "pr merge")
    if [ -f "$dir/no-auto-merge" ]; then echo "auto merge is not allowed for this repository" >&2; exit 1; fi
    exit 0 ;;
esac
"#;

/// A stub `glab`, answering from the same files as the stub `gh` (`pr-state` holds `OPEN`, `MERGED`
/// or `CLOSED`, and the stub says `opened`, `merged` or `closed`). `view-opened-only` makes `mr view`
/// find open requests only, as `glab` may when it is given a branch. `host` records `GITLAB_HOST`.
const STUB_GLAB: &str = r#"#!/bin/sh
dir=$(dirname "$0")
echo "$@" >> "$dir/calls"
echo "${GITLAB_HOST-unset}" > "$dir/host"
state=""
if [ -f "$dir/pr-state" ]; then
  case "$(cat "$dir/pr-state")" in OPEN) state=opened ;; MERGED) state=merged ;; CLOSED) state=closed ;; esac
fi
sha=""
if [ -f "$dir/merge-sha" ]; then sha=",\"merge_commit_sha\":null,\"squash_commit_sha\":\"$(cat "$dir/merge-sha")\""; fi
body="{\"state\":\"$state\",\"web_url\":\"https://gitlab.com/acme/app/-/merge_requests/7\"$sha}"
case "$1 $2" in
  "auth status")
    if [ -f "$dir/signed-out" ]; then echo "x gitlab.com: no token found. Run glab auth login" >&2; exit 1; fi
    exit 0 ;;
  "mr view")
    if [ -z "$state" ] || { [ -f "$dir/view-opened-only" ] && [ "$state" != opened ]; }; then
      echo 'no open merge request available for "x"' >&2; exit 1
    fi
    echo "$body" ;;
  "mr list")
    if [ -z "$state" ]; then echo '[]'; else echo "[$body]"; fi ;;
  "mr create")
    echo OPEN > "$dir/pr-state"
    echo "Creating merge request for x into main"
    echo "https://gitlab.com/acme/app/-/merge_requests/7" ;;
  "mr merge")
    if [ -f "$dir/no-auto-merge" ]; then echo "auto-merge is not enabled for this project" >&2; exit 1; fi
    exit 0 ;;
esac
"#;

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    repo: TempDir,
    bare: TempDir,
    stub: TempDir,
    story: Story,
    worktree: PathBuf,
    branch: String,
    cli: ForgeCli,
}

impl Fixture {
    fn repo(&self) -> &Path {
        self.repo.path()
    }

    fn state(&self) -> String {
        get_story(&self.conn, &self.story.id)
            .unwrap()
            .unwrap()
            .state
    }

    fn stub_file(&self, name: &str) -> PathBuf {
        self.stub.path().join(name)
    }

    fn calls(&self) -> Vec<String> {
        std::fs::read_to_string(self.stub_file("calls"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn set_request_state(&self, state: &str) {
        std::fs::write(self.stub_file("pr-state"), format!("{state}\n")).unwrap();
    }

    fn pushed_branch_head(&self) -> Option<String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(self.bare.path())
            .args([
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{}", self.branch),
            ])
            .output()
            .unwrap();
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn main_tip(&self) -> String {
        git(self.repo(), &["rev-parse", "refs/heads/main"])
    }

    fn settings(&mut self, settings: LandingSettings) {
        let human = self.human.clone();
        set_settings(&mut self.conn, &human, &self.project_id, &settings).unwrap();
    }

    fn merge(&mut self) -> anyhow::Result<MergeOutcome> {
        let human = self.human.clone();
        merge_story_with(
            &mut self.conn,
            &human,
            &self.story.id,
            MergeOptions::default(),
            &self.cli,
        )
    }

    /// One pass of what the cold tick does for this Story.
    fn poll(&mut self) -> bool {
        let plans = landing_plans(&self.conn, None).unwrap();
        assert_eq!(plans.len(), 1, "one Landing Story");
        let read = read_request(&self.cli, &plans[0]);
        apply_request(&mut self.conn, &plans[0], read).unwrap()
    }
}

/// An In review Story whose project has `origin` (a bare repository) and a stub `gh`.
/// `origin_url` is what `remote.origin.url` says: `None` names the bare repository's path, `Some`
/// is a URL that git rewrites to that path.
fn in_review(origin_url: Option<&str>) -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Parse the config");
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let worktree = PathBuf::from(&wt.path);
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let task = add_task(&mut conn, &agent, &story.id, "Write the parser").unwrap();
    set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();
    std::fs::write(worktree.join("feature.txt"), "parsed\n").unwrap();
    git(&worktree, &["add", "feature.txt"]);
    git(&worktree, &["commit", "-q", "-m", "Parse the config"]);
    hand_off(&mut conn, &session.id, "The parser is done.", "").unwrap();
    close_session(
        &mut conn,
        &session.id,
        SessionStatus::Completed,
        None,
        None,
        None,
    )
    .unwrap();

    let bare = tempfile::tempdir().unwrap();
    git(bare.path(), &["init", "-q", "--bare"]);
    match origin_url {
        None => git(
            repo.path(),
            &["remote", "add", "origin", bare.path().to_str().unwrap()],
        ),
        Some(url) => {
            git(repo.path(), &["remote", "add", "origin", url]);
            git(
                repo.path(),
                &[
                    "config",
                    &format!("url.{}.insteadOf", bare.path().display()),
                    url,
                ],
            );
            String::new()
        }
    };
    let stub = tempfile::tempdir().unwrap();
    let gh = stub.path().join("gh");
    std::fs::write(&gh, STUB_GH).unwrap();
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
    let glab = stub.path().join("glab");
    std::fs::write(&glab, STUB_GLAB).unwrap();
    std::fs::set_permissions(&glab, std::fs::Permissions::from_mode(0o755)).unwrap();
    let cli = ForgeCli::with_search_path(format!("{}:/usr/bin:/bin", stub.path().display()));
    Fixture {
        conn,
        human,
        project_id: project.id,
        repo,
        bare,
        stub,
        story,
        worktree,
        branch: wt.branch,
        cli,
    }
}

fn event_payload(conn: &Connection, story_id: &str, event_type: &str) -> serde_json::Value {
    let text: String = conn
        .query_row(
            "SELECT payload FROM events WHERE story_id = ?1 AND event_type = ?2 ORDER BY rowid DESC LIMIT 1",
            params![story_id, event_type],
            |r| r.get(0),
        )
        .unwrap_or_else(|e| panic!("no {event_type} event: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn pull_request_by(forge: Option<Forge>) -> LandingSettings {
    LandingSettings {
        forge,
        ..LandingSettings::default()
    }
}

fn command_mode(command: &str) -> LandingSettings {
    LandingSettings {
        mode: LandingMode::Command,
        command: Some(command.into()),
        ..LandingSettings::default()
    }
}

fn refusal(result: anyhow::Result<MergeOutcome>) -> String {
    format!("{}", result.expect_err("Merge should refuse"))
}

// --- Route -------------------------------------------------------------------------------------

#[test]
fn the_route_follows_the_setting_and_the_url_of_origin() {
    let default = LandingSettings::default();
    for (url, route) in [
        (
            "https://github.com/acme/app.git",
            Route::Request(Forge::Github),
        ),
        ("git@github.com:acme/app.git", Route::Request(Forge::Github)),
        (
            "ssh://git@gitlab.com/acme/app.git",
            Route::Request(Forge::Gitlab),
        ),
        (
            "https://gitlab.com/acme/app.git",
            Route::Request(Forge::Gitlab),
        ),
        ("https://git.example.com/acme/app.git", Route::Local),
        ("/srv/git/app.git", Route::Local),
    ] {
        assert_eq!(route_for(&default, Some(url)).unwrap(), route, "{url}");
    }
    assert_eq!(
        route_for(&default, None).unwrap(),
        Route::Local,
        "no remote"
    );
}

#[test]
fn a_setting_names_a_self_hosted_forge_and_needs_a_remote_to_push_to() {
    let gitlab = pull_request_by(Some(Forge::Gitlab));
    assert_eq!(
        route_for(&gitlab, Some("https://git.example.com/acme/app.git")).unwrap(),
        Route::Request(Forge::Gitlab)
    );
    let err = route_for(&gitlab, None).unwrap_err().to_string();
    assert!(err.contains("no `origin` remote"), "{err}");
}

#[test]
fn a_command_mode_route_is_the_command_wherever_the_remote_points() {
    let settings = command_mode("pnpm hk land");
    for url in [
        None,
        Some("https://github.com/acme/app.git"),
        Some("/srv/x.git"),
    ] {
        assert_eq!(
            route_for(&settings, url).unwrap(),
            Route::Command("pnpm hk land".into())
        );
    }
    let bare = LandingSettings {
        mode: LandingMode::Command,
        ..LandingSettings::default()
    };
    assert!(route_for(&bare, None)
        .unwrap_err()
        .to_string()
        .contains("names none"));
}

// --- Pull request mode -------------------------------------------------------------------------

#[test]
fn merge_pushes_the_branch_opens_a_request_with_auto_merge_and_the_story_is_landing() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        let head = git(&f.worktree, &["rev-parse", "HEAD"]);
        let old_main = f.main_tip();

        let outcome = f
            .merge()
            .expect("a Story of a GitHub project lands by request");

        assert_eq!(outcome.method, MergeMethod::PullRequest);
        let landing = outcome.landing.expect("the Story is Landing, not Merged");
        assert_eq!(
            landing.request_url.as_deref(),
            Some("https://github.com/acme/app/pull/7")
        );
        assert_eq!(landing.note, None);
        assert_eq!(f.state(), "landing");
        assert_eq!(
            f.pushed_branch_head().as_deref(),
            Some(head.as_str()),
            "the branch is on origin"
        );
        assert_eq!(
            f.main_tip(),
            old_main,
            "the local base branch is not written"
        );
        assert!(f.worktree.is_dir(), "the worktree waits for the request");
        assert!(worktree_for_story(&f.conn, &f.story.id).unwrap().is_some());
        assert!(
            open_review(&f.conn, &f.story.id).unwrap().is_some(),
            "the review stays open"
        );

        let calls = f.calls();
        assert_eq!(calls[0], "auth status");
        assert!(
            calls
                .iter()
                .any(|c| c.starts_with("pr create --base main --head flywheel/")),
            "{calls:?}"
        );
        assert!(
            calls.iter().any(
                |c| c.ends_with("pr/7 --auto --squash") || c.contains("pull/7 --auto --squash")
            ),
            "{calls:?}"
        );
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(
            (row.mode.as_str(), row.request_state.as_str()),
            ("pull_request", "open")
        );
        let event = event_payload(&f.conn, &f.story.id, "story.landing");
        assert_eq!(event["request_url"], "https://github.com/acme/app/pull/7");
        assert_eq!(event["branch"], f.branch.as_str());
    });
}

#[test]
fn the_merge_method_setting_picks_the_auto_merge_flag() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.settings(LandingSettings {
            method: "rebase".into(),
            ..LandingSettings::default()
        });
        f.merge().unwrap();
        assert!(
            f.calls().iter().any(|c| c.ends_with("--auto --rebase")),
            "{:?}",
            f.calls()
        );
    });
}

#[test]
fn a_request_that_merged_on_the_forge_moves_the_story_to_merged_even_when_it_was_squashed() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        let head = git(&f.worktree, &["rev-parse", "HEAD"]);
        f.merge().unwrap();

        f.set_request_state("OPEN");
        assert!(!f.poll(), "an open request changes nothing");
        assert_eq!(f.state(), "landing");

        // The forge squashed the branch: its commits are not on the base branch.
        f.set_request_state("MERGED");
        assert_ne!(
            git(f.repo(), &["merge-base", &head, "refs/heads/main"]),
            head
        );
        assert!(f.poll());

        assert_eq!(f.state(), "merged");
        assert!(!f.worktree.exists(), "the worktree is removed");
        assert_eq!(
            git(f.repo(), &["branch", "--list", &f.branch]),
            "",
            "the branch is deleted"
        );
        assert!(worktree_for_story(&f.conn, &f.story.id).unwrap().is_none());
        let reviews = reviews_for_story(&f.conn, &f.story.id).unwrap();
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0].outcome.as_deref(), Some("merged"));
        let merged = event_payload(&f.conn, &f.story.id, "story.merged");
        assert_eq!(merged["method"], "pull_request");
        assert_eq!(merged["request_url"], "https://github.com/acme/app/pull/7");
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(row.request_state, "merged");
    });
}

#[test]
fn a_request_closed_without_merging_returns_the_story_to_in_review_with_a_note_and_merge_opens_a_new_one(
) {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.merge().unwrap();
        f.set_request_state("CLOSED");
        assert!(f.poll());

        assert_eq!(f.state(), "in_review");
        assert!(f.worktree.is_dir(), "nothing was removed");
        assert!(open_review(&f.conn, &f.story.id).unwrap().is_some());
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(row.request_state, "closed");
        assert!(row.note.unwrap().contains("closed without merging"));
        event_payload(&f.conn, &f.story.id, "story.landing_closed");

        f.merge().expect("the developer merges again");
        assert_eq!(f.state(), "landing");
        let creates = f
            .calls()
            .into_iter()
            .filter(|c| c.starts_with("pr create"))
            .count();
        assert_eq!(creates, 2, "the closed request is not reused");
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!((row.request_state.as_str(), row.note), ("open", None));
    });
}

#[test]
fn an_open_request_is_reused_and_auto_merge_that_cannot_be_turned_on_is_a_note_not_a_refusal() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.set_request_state("OPEN");
        std::fs::write(f.stub_file("no-auto-merge"), "").unwrap();
        let outcome = f.merge().unwrap();
        assert!(
            !f.calls().iter().any(|c| c.starts_with("pr create")),
            "{:?}",
            f.calls()
        );
        let note = outcome.landing.unwrap().note.unwrap();
        assert!(note.contains("Auto-merge could not be turned on"), "{note}");
        assert_eq!(f.state(), "landing");
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(row.note.as_deref(), Some(note.as_str()));
    });
}

#[test]
fn a_missing_cli_refuses_with_the_step_to_take_and_never_merges_locally() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.cli = ForgeCli::with_search_path(f.repo().to_str().unwrap());
        let old_main = f.main_tip();
        let text = refusal(f.merge());
        assert!(
            text.contains("`gh`") && text.contains("Install it"),
            "{text}"
        );
        assert_eq!(f.state(), "in_review");
        assert_eq!(f.main_tip(), old_main, "no local merge commit");
        assert!(f.worktree.is_dir());
        assert_eq!(f.pushed_branch_head(), None, "nothing was pushed");
    });
}

#[test]
fn a_cli_that_is_not_signed_in_refuses_before_anything_is_pushed() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        std::fs::write(f.stub_file("signed-out"), "").unwrap();
        let text = refusal(f.merge());
        assert!(text.contains("gh auth login"), "{text}");
        assert_eq!(f.state(), "in_review");
        assert_eq!(f.pushed_branch_head(), None);
        assert!(!f.calls().iter().any(|c| c.starts_with("pr create")));
    });
}

#[test]
fn a_refused_push_leaves_the_story_in_review_and_opens_no_request() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(None);
        f.settings(pull_request_by(Some(Forge::Github)));
        git(
            f.repo(),
            &["remote", "set-url", "origin", "/no/such/remote.git"],
        );
        let text = refusal(f.merge());
        assert!(text.contains("was not pushed"), "{text}");
        assert_eq!(f.state(), "in_review");
        assert!(!f.calls().iter().any(|c| c.starts_with("pr create")));
    });
}

#[test]
fn a_forge_named_by_the_setting_lands_a_remote_whose_host_is_not_known() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(None);
        f.settings(pull_request_by(Some(Forge::Github)));
        f.merge()
            .expect("origin is a path, the setting names GitHub");
        assert_eq!(f.state(), "landing");
    });
}

#[test]
fn a_project_with_no_forge_keeps_the_local_merge() {
    with_scratch_worktree_root(|_| {
        // `origin` is a bare path on no known forge, and no setting names one.
        let mut f = in_review(None);
        let old_main = f.main_tip();
        let outcome = f.merge().expect("the local merge of ADR 0009");
        assert!(matches!(
            outcome.method,
            MergeMethod::Checkout | MergeMethod::Plumbing
        ));
        assert!(outcome.landing.is_none());
        assert_ne!(f.main_tip(), old_main);
        assert_eq!(f.state(), "merged");
        assert!(f.calls().is_empty(), "no forge call");
        assert_eq!(f.pushed_branch_head(), None, "the local merge never pushes");
    });
}

// --- GitLab: the same paths through `glab` -----------------------------------------------------

const GITLAB_URL: &str = "https://gitlab.com/acme/app.git";
const MR_URL: &str = "https://gitlab.com/acme/app/-/merge_requests/7";

#[test]
fn a_gitlab_story_lands_by_merge_request_with_auto_merge_and_merges_when_the_request_does() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        let head = git(&f.worktree, &["rev-parse", "HEAD"]);
        let old_main = f.main_tip();

        let outcome = f
            .merge()
            .expect("a Story of a GitLab project lands by request");

        assert_eq!(outcome.method, MergeMethod::PullRequest);
        let landing = outcome.landing.expect("the Story is Landing");
        assert_eq!(landing.request_url.as_deref(), Some(MR_URL));
        assert_eq!(landing.note, None);
        assert_eq!(f.state(), "landing");
        assert_eq!(f.pushed_branch_head().as_deref(), Some(head.as_str()));
        assert_eq!(
            f.main_tip(),
            old_main,
            "the local base branch is not written"
        );
        let calls = f.calls();
        assert_eq!(calls[0], "auth status");
        let create = calls
            .iter()
            .find(|c| c.starts_with("mr create"))
            .expect("a merge request is created");
        assert!(
            create.contains(&format!("--source-branch {}", f.branch))
                && create.contains("--target-branch main")
                && create.contains("Parse the config")
                && create.contains("--description Merged in Flywheel from"),
            "{create}"
        );
        assert!(
            calls
                .iter()
                .any(|c| *c == format!("mr merge {} --auto-merge --squash --yes", f.branch)),
            "{calls:?}"
        );
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(
            (row.forge.as_deref(), row.request_state.as_str()),
            (Some("gitlab"), "open")
        );

        f.set_request_state("OPEN");
        assert!(!f.poll(), "an open request changes nothing");
        f.set_request_state("MERGED");
        assert!(f.poll());
        assert_eq!(f.state(), "merged");
        assert!(!f.worktree.exists());
        let merged = event_payload(&f.conn, &f.story.id, "story.merged");
        assert_eq!(merged["method"], "pull_request");
        assert_eq!(merged["request_url"], MR_URL);
    });
}

#[test]
fn the_merge_method_setting_picks_the_glab_merge_flag() {
    for (method, tail) in [
        ("rebase", "--auto-merge --rebase --yes"),
        ("merge", "--auto-merge --yes"),
    ] {
        with_scratch_worktree_root(|_| {
            let mut f = in_review(Some(GITLAB_URL));
            f.settings(LandingSettings {
                method: method.into(),
                ..LandingSettings::default()
            });
            f.merge().unwrap();
            assert!(
                f.calls()
                    .iter()
                    .any(|c| *c == format!("mr merge {} {tail}", f.branch)),
                "{method}: {:?}",
                f.calls()
            );
        });
    }
}

#[test]
fn a_gitlab_request_closed_without_merging_returns_the_story_to_in_review_with_a_note() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        f.merge().unwrap();
        f.set_request_state("CLOSED");
        assert!(f.poll());
        assert_eq!(f.state(), "in_review");
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(row.request_state, "closed");
        assert!(row.note.unwrap().contains("closed without merging"));

        f.merge().expect("the developer merges again");
        assert_eq!(f.state(), "landing");
        let creates = f
            .calls()
            .iter()
            .filter(|c| c.starts_with("mr create"))
            .count();
        assert_eq!(creates, 2, "the closed request is not reused");
    });
}

#[test]
fn a_merged_gitlab_request_that_mr_view_hides_is_found_by_the_list() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        f.merge().unwrap();
        std::fs::write(f.stub_file("view-opened-only"), "").unwrap();
        f.set_request_state("MERGED");
        assert!(f.poll());
        assert_eq!(f.state(), "merged");
        assert!(
            f.calls()
                .iter()
                .any(|c| c.starts_with("mr list --source-branch ") && c.contains("--all")),
            "{:?}",
            f.calls()
        );
    });
}

#[test]
fn a_gitlab_open_request_is_reused_and_auto_merge_that_cannot_be_turned_on_is_a_note() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        f.set_request_state("OPEN");
        std::fs::write(f.stub_file("no-auto-merge"), "").unwrap();
        let outcome = f.merge().unwrap();
        assert!(!f.calls().iter().any(|c| c.starts_with("mr create")));
        let note = outcome.landing.unwrap().note.unwrap();
        assert!(note.contains("Auto-merge could not be turned on"), "{note}");
        assert!(note.contains("merge request on GitLab"), "{note}");
        assert_eq!(f.state(), "landing");
    });
}

#[test]
fn a_missing_glab_refuses_with_the_step_to_take_and_merges_nothing() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        f.cli = ForgeCli::with_search_path(f.repo().to_str().unwrap());
        let old_main = f.main_tip();
        let text = refusal(f.merge());
        assert!(
            text.contains("`glab`") && text.contains("Install it"),
            "{text}"
        );
        assert!(text.contains("GitLab"), "{text}");
        assert_eq!(f.state(), "in_review");
        assert_eq!(f.main_tip(), old_main);
        assert_eq!(f.pushed_branch_head(), None);
    });
}

#[test]
fn a_glab_that_is_not_signed_in_refuses_before_anything_is_pushed() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        std::fs::write(f.stub_file("signed-out"), "").unwrap();
        let text = refusal(f.merge());
        assert!(text.contains("glab auth login"), "{text}");
        assert_eq!(f.state(), "in_review");
        assert_eq!(f.pushed_branch_head(), None);
        assert!(!f.calls().iter().any(|c| c.starts_with("mr create")));
    });
}

#[test]
fn a_refused_push_to_gitlab_opens_no_merge_request() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(None);
        f.settings(pull_request_by(Some(Forge::Gitlab)));
        git(
            f.repo(),
            &["remote", "set-url", "origin", "/no/such/remote.git"],
        );
        let text = refusal(f.merge());
        assert!(text.contains("was not pushed"), "{text}");
        assert_eq!(f.state(), "in_review");
        assert!(!f.calls().iter().any(|c| c.starts_with("mr create")));
    });
}

#[test]
fn a_self_hosted_gitlab_named_by_the_setting_is_reached_through_the_host_of_origin() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://git.example.com/acme/app.git"));
        f.settings(pull_request_by(Some(Forge::Gitlab)));
        f.merge()
            .expect("the setting names GitLab for an unknown host");
        assert_eq!(f.state(), "landing");
        let host = std::fs::read_to_string(f.stub_file("host")).unwrap();
        assert_eq!(host.trim(), "git.example.com");

        // Polling uses the same host.
        std::fs::write(f.stub_file("host"), "").unwrap();
        f.set_request_state("MERGED");
        assert!(f.poll());
        let host = std::fs::read_to_string(f.stub_file("host")).unwrap();
        assert_eq!(host.trim(), "git.example.com");
    });
}

#[test]
fn a_gitlab_cli_that_goes_missing_while_landing_keeps_the_story_landing_with_a_note() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some(GITLAB_URL));
        f.merge().unwrap();
        let working = f.cli.clone();
        f.cli = ForgeCli::with_search_path(f.repo().to_str().unwrap());
        assert!(f.poll());
        assert_eq!(f.state(), "landing");
        let note = landing_for_story(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .note
            .unwrap();
        assert!(note.contains("`glab`"), "{note}");
        f.cli = working;
        f.set_request_state("OPEN");
        assert!(f.poll(), "the note clears");
    });
}

// --- Landing command ---------------------------------------------------------------------------

#[test]
fn a_landing_command_runs_in_the_worktree_with_the_story_in_its_environment() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.settings(command_mode(
            "printf '%s %s %s' \"$FLYWHEEL_STORY_KEY\" \"$FLYWHEEL_STORY_BRANCH\" \"$FLYWHEEL_BASE_BRANCH\" > ran.txt",
        ));
        let outcome = f.merge().expect("the command exits 0");
        assert_eq!(outcome.method, MergeMethod::Command);
        assert!(
            outcome.landing.is_some(),
            "a forge is known, so the Story waits for its request"
        );
        assert_eq!(f.state(), "landing");
        let ran = std::fs::read_to_string(f.worktree.join("ran.txt")).unwrap();
        assert_eq!(ran, format!("{} {} main", f.story.key, f.branch));
        assert!(
            f.calls().is_empty(),
            "the command, not Flywheel, opened any request"
        );
        let row = landing_for_story(&f.conn, &f.story.id).unwrap().unwrap();
        assert_eq!(
            (row.mode.as_str(), row.request_state.as_str()),
            ("command", "unknown")
        );

        // The command opened the request on the forge: polling by branch finds it.
        f.set_request_state("MERGED");
        assert!(f.poll());
        assert_eq!(f.state(), "merged");
        assert_eq!(
            event_payload(&f.conn, &f.story.id, "story.merged")["method"],
            "pull_request"
        );
    });
}

#[test]
fn a_landing_command_that_fails_leaves_the_story_in_review_with_its_exit_status() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.settings(command_mode("echo nothing to land >&2; exit 3"));
        let text = refusal(f.merge());
        assert!(
            text.contains("exit status 3") && text.contains("nothing to land"),
            "{text}"
        );
        assert_eq!(f.state(), "in_review");
        assert!(f.worktree.is_dir());
        assert!(landing_for_story(&f.conn, &f.story.id).unwrap().is_none());
    });
}

#[test]
fn a_landing_command_with_no_forge_to_ask_merges_the_story_when_it_exits_zero() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(None);
        f.settings(command_mode("true"));
        let outcome = f.merge().unwrap();
        assert_eq!(outcome.method, MergeMethod::Command);
        assert!(outcome.landing.is_none());
        assert_eq!(f.state(), "merged");
        assert!(!f.worktree.exists());
        assert_eq!(
            event_payload(&f.conn, &f.story.id, "story.merged")["method"],
            "command"
        );
    });
}

// --- Polling failures --------------------------------------------------------------------------

#[test]
fn a_cli_that_goes_missing_or_signed_out_while_landing_keeps_the_story_landing_with_a_note() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.merge().unwrap();

        let working = f.cli.clone();
        f.cli = ForgeCli::with_search_path(f.repo().to_str().unwrap());
        assert!(f.poll(), "the note is new");
        assert_eq!(f.state(), "landing");
        let note = landing_for_story(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .note
            .unwrap();
        assert!(note.contains("Install it"), "{note}");
        assert!(!f.poll(), "the same note is not written twice");

        f.cli = working;
        f.set_request_state("OPEN");
        assert!(f.poll(), "the note clears");
        assert_eq!(
            landing_for_story(&f.conn, &f.story.id)
                .unwrap()
                .unwrap()
                .note,
            None
        );
    });
}

#[test]
fn the_cold_tick_and_check_now_both_complete_a_merged_request() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.merge().unwrap();
        f.set_request_state("MERGED");
        let cli = f.cli.clone();
        let story_id = f.story.id.clone();
        let project_id = f.project_id.clone();
        let shared = std::sync::Mutex::new(f.conn);
        let changed = landing_tick(&shared, &cli);
        assert_eq!(changed, std::collections::HashSet::from([Some(project_id)]));
        let mut conn = shared.into_inner().unwrap();
        assert_eq!(
            get_story(&conn, &story_id).unwrap().unwrap().state,
            "merged"
        );
        assert!(landing_tick(
            &std::sync::Mutex::new(Connection::open_in_memory().unwrap()),
            &cli
        )
        .is_empty());
        assert!(refresh_landing(&mut conn, &cli, &story_id)
            .unwrap()
            .is_some());
    });
}

// --- The setting -------------------------------------------------------------------------------

#[test]
fn the_setting_defaults_to_pull_request_and_is_the_developers_alone_to_change() {
    let (mut conn, human, project, _repo) = common::seeded_git_project();
    assert_eq!(
        read_settings(&conn, &project.id).unwrap(),
        LandingSettings::default()
    );

    let set = set_settings(
        &mut conn,
        &human,
        &project.id,
        &command_mode("  pnpm hk land  "),
    )
    .unwrap();
    assert_eq!(set.command.as_deref(), Some("pnpm hk land"), "trimmed");
    assert_eq!(read_settings(&conn, &project.id).unwrap(), set);
    let events = |c: &Connection| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM events WHERE event_type = 'project.landing_set'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(events(&conn), 1);
    set_settings(&mut conn, &human, &project.id, &set).unwrap();
    assert_eq!(events(&conn), 1, "an unchanged setting writes nothing");

    for bad in [
        LandingSettings {
            command: None,
            ..command_mode("x")
        },
        command_mode("one\ntwo"),
        LandingSettings {
            method: "fast-forward".into(),
            ..LandingSettings::default()
        },
    ] {
        assert!(set_settings(&mut conn, &human, &project.id, &bad).is_err());
    }
    let agent = agent_actor_id(&conn).unwrap();
    assert!(set_settings(&mut conn, &agent, &project.id, &LandingSettings::default()).is_err());
    assert_eq!(
        read_settings(&conn, &project.id).unwrap(),
        set,
        "refusals write nothing"
    );
}

// --- Review findings: command landings, the real merge commit, needs-you, Drop ----------------

#[test]
fn a_command_that_pushed_to_the_base_branch_without_a_request_ends_merged() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.settings(command_mode("git push -q origin HEAD:refs/heads/main"));
        f.merge().expect("the command exits 0");
        assert_eq!(f.state(), "landing");

        // No request exists on the forge, and the head is on origin/main.
        assert!(f.poll());
        assert_eq!(f.state(), "merged");
        assert!(!f.worktree.exists());
        let merged = event_payload(&f.conn, &f.story.id, "story.merged");
        assert_eq!(merged["method"], "pull_request");
    });
}

#[test]
fn a_command_that_landed_nothing_waits_quietly_then_needs_the_developer() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.settings(command_mode("true"));
        f.merge().unwrap();

        assert!(!f.poll(), "within the hour nothing is written");
        assert!(needs_you(&f.conn, &f.project_id).unwrap().is_empty());

        f.conn
            .execute(
                "UPDATE landings SET created_at = '2020-01-01T00:00:00Z' WHERE story_id = ?1",
                params![f.story.id],
            )
            .unwrap();
        assert!(f.poll());
        assert_eq!(f.state(), "landing");
        let note = landing_for_story(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .note
            .unwrap();
        assert!(
            note.contains("no pull request") && note.contains("drop the Story"),
            "{note}"
        );
        let items = needs_you(&f.conn, &f.project_id).unwrap();
        assert_eq!(items.len(), 1, "the stuck Story reaches the needs-you list");
        assert_eq!(items[0].id, f.story.id);
    });
}

#[test]
fn a_landing_story_with_a_cli_failure_note_is_in_needs_you_until_the_note_clears() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.merge().unwrap();
        assert!(needs_you(&f.conn, &f.project_id).unwrap().is_empty());
        let working = f.cli.clone();
        f.cli = ForgeCli::with_search_path(f.repo().to_str().unwrap());
        f.poll();
        assert_eq!(needs_you(&f.conn, &f.project_id).unwrap().len(), 1);
        f.cli = working;
        f.set_request_state("OPEN");
        f.poll();
        assert!(needs_you(&f.conn, &f.project_id).unwrap().is_empty());
    });
}

#[test]
fn a_merged_request_records_the_forges_merge_commit_not_the_branch_tip() {
    for (url, sha) in [
        (
            "https://github.com/acme/app.git",
            "1111111111111111111111111111111111111111",
        ),
        (GITLAB_URL, "2222222222222222222222222222222222222222"),
    ] {
        with_scratch_worktree_root(|_| {
            let mut f = in_review(Some(url));
            let head = git(&f.worktree, &["rev-parse", "HEAD"]);
            f.merge().unwrap();
            std::fs::write(f.stub_file("merge-sha"), format!("{sha}\n")).unwrap();
            f.set_request_state("MERGED");
            assert!(f.poll());
            let merged = event_payload(&f.conn, &f.story.id, "story.merged");
            assert_eq!(merged["merge_commit"], sha, "{url}");
            assert_ne!(merged["merge_commit"], head.as_str());
        });
    }
}

#[test]
fn a_merged_request_with_no_merge_commit_from_the_forge_falls_back_to_the_branch_tip() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        let head = git(&f.worktree, &["rev-parse", "HEAD"]);
        f.merge().unwrap();
        f.set_request_state("MERGED");
        assert!(f.poll());
        let merged = event_payload(&f.conn, &f.story.id, "story.merged");
        assert_eq!(merged["merge_commit"], head.as_str());
    });
}

#[test]
fn dropping_a_landing_story_says_its_request_is_still_open() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(Some("https://github.com/acme/app.git"));
        f.merge().unwrap();
        let human = f.human.clone();
        drop_story(&mut f.conn, &human, &f.story.id).unwrap();
        assert_eq!(f.state(), "dropped");
        let note = landing_for_story(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .note
            .unwrap();
        assert!(
            note.contains("still open") && note.contains("can still merge"),
            "{note}"
        );
    });
}
