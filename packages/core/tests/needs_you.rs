//! Needs you (docs/mvp-spec.md §2 "Needs you", issue #156): the ranked list of everything waiting on
//! the developer in one project, built by `query::needs_you::needs_you` from literal SQL and the
//! existing derivations.
//!
//! The order is the spec's: Gated actions, permission requests and agent questions mixed by age; then
//! Stopped Stories (a missing worktree is one of them, with Recreate); then Stories In review; then
//! Confirm exit test; then Shaping Rounds waiting. Within a kind, oldest first, and the item id breaks a
//! tie, so two reads of an unchanged database agree. A stop the developer made stays out.
//!
//! Records are made through the domain writers; sessions, requests, worktrees and Rounds are written
//! as rows with fixed timestamps, so the ages the ranking reads are the test's own.

mod common;

use core::domain::{epic, milestone, story};
use core::ids::new_id;
use core::query::needs_you::{needs_you, NeedsYouItem, NeedsYouKind};
use rusqlite::{params, Connection};

struct Board {
    conn: Connection,
    actor_id: String,
    project_id: String,
    milestone_id: String,
    epic_id: String,
}

fn board() -> Board {
    let (mut conn, actor_id, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "Board and review", Some("A Story merges in Flywheel alone"))
        .expect("create_milestone");
    let e = epic::create_epic(&mut conn, &actor_id, &m.id, "Roster and Needs you").expect("create_epic");
    Board { conn, actor_id, project_id: project.id, milestone_id: m.id, epic_id: e.id }
}

impl Board {
    fn epic(&mut self, title: &str) -> String {
        epic::create_epic(&mut self.conn, &self.actor_id, &self.milestone_id, title).expect("create_epic").id
    }

    /// A Story of `epic_id` in `state`, last touched at `at`.
    fn story_in(&mut self, epic_id: &str, title: &str, state: &str, at: &str) -> (String, String) {
        let s = story::create_story(&mut self.conn, &self.actor_id, epic_id, title).expect("create_story");
        self.conn
            .execute("UPDATE stories SET state = ?1, updated_at = ?2 WHERE id = ?3", params![state, at, s.id])
            .unwrap();
        (s.id, s.key)
    }

    fn story(&mut self, title: &str, state: &str, at: &str) -> (String, String) {
        let epic_id = self.epic_id.clone();
        self.story_in(&epic_id, title, state, at)
    }

    /// A Story session. `ended` with its ending reason, or live (`running`) when `None`.
    fn session(&mut self, story_id: &str, started_at: &str, ended: Option<(&str, &str)>) -> String {
        let id = new_id();
        let (status, ended_at, reason) = match ended {
            Some((at, reason)) => ("interrupted", Some(at), Some(reason)),
            None => ("running", None, None),
        };
        self.conn
            .execute(
                "INSERT INTO sessions (id, kind, story_id, project_id, actor_id, status, permission_mode, log_path, \
                 started_at, ended_at, ending_reason) VALUES (?1, 'story', ?2, ?3, ?4, ?5, 'acceptEdits', '/log', ?6, ?7, ?8)",
                params![id, story_id, self.project_id, self.actor_id, status, started_at, ended_at, reason],
            )
            .unwrap();
        id
    }

    /// A pending request on `session_id`, raised at `at`.
    fn request(&mut self, session_id: &str, story_id: &str, tool: &str, payload: &str, category: Option<&str>, at: &str) -> String {
        let id = new_id();
        self.conn
            .execute(
                "INSERT INTO permission_requests (id, session_id, story_id, project_id, tool_name, input_payload, status, \
                 destructive_category, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9)",
                params![id, session_id, story_id, self.project_id, tool, payload, category, self.actor_id, at],
            )
            .unwrap();
        id
    }

    fn worktree(&mut self, story_id: &str, status: &str, at: &str) {
        self.conn
            .execute(
                "INSERT INTO worktrees (id, story_id, project_id, path, branch, base_branch, status, created_by, created_at) \
                 VALUES (?1, ?2, ?3, '/wt', 'story/x', 'main', ?4, ?5, ?6)",
                params![new_id(), story_id, self.project_id, status, self.actor_id, at],
            )
            .unwrap();
    }

    /// A shaping session on an Epic, a Milestone or the Roadmap (both `None`).
    fn shaping_session(&mut self, epic_id: Option<&str>, milestone_id: Option<&str>, live: bool) -> String {
        let id = new_id();
        let (status, ended_at) = if live { ("blocked", None) } else { ("interrupted", Some("2026-10-20T00:00:00Z")) };
        self.conn
            .execute(
                "INSERT INTO sessions (id, kind, epic_id, milestone_id, project_id, actor_id, status, permission_mode, \
                 log_path, started_at, ended_at) VALUES (?1, 'shaping', ?2, ?3, ?4, ?5, ?6, 'plan', '/log', \
                 '2026-10-19T00:00:00Z', ?7)",
                params![id, epic_id, milestone_id, self.project_id, self.actor_id, status, ended_at],
            )
            .unwrap();
        id
    }

    /// An open Round on the Epic's Challenge Stage (or a roadmap Round with `epic_id` `None`), posted at
    /// `at`, held by `session_id` when `held`.
    fn open_round(&mut self, epic_id: Option<&str>, session_id: Option<&str>, held: bool, at: &str) -> String {
        let stage_id = epic_id.map(|epic_id| {
            let stage_id = new_id();
            self.conn
                .execute(
                    "INSERT INTO stages (id, project_id, epic_id, kind, state, rank, opened_at) \
                     VALUES (?1, ?2, ?3, 'challenge_spec', 'open', 1, ?4)",
                    params![stage_id, self.project_id, epic_id, at],
                )
                .unwrap();
            stage_id
        });
        let id = new_id();
        let held_request_id = held.then(new_id);
        let trigger = if stage_id.is_none() { Some("revisit") } else { None };
        self.conn
            .execute(
                "INSERT INTO rounds (id, project_id, stage_id, session_id, number, note, state, held_request_id, posted_at, \
                 trigger_type) VALUES (?1, ?2, ?3, ?4, 1, 'note', 'open', ?5, ?6, ?7)",
                params![id, self.project_id, stage_id, session_id, held_request_id, at, trigger],
            )
            .unwrap();
        id
    }

    /// A Proposal filed by `session_id` on `epic_id` at `at`, in `state`; in a shaping Stage when `stage_id`.
    #[allow(clippy::too_many_arguments)]
    fn proposal(
        &mut self,
        session_id: &str,
        epic_id: Option<&str>,
        verb: &str,
        target: &str,
        state: &str,
        stage_id: Option<&str>,
        at: &str,
    ) -> String {
        let id = new_id();
        let decided_by = (state == "accepted" || state == "rejected").then(|| self.actor_id.clone());
        let withdrawn_at = (state == "withdrawn").then_some(at);
        self.conn
            .execute(
                "INSERT INTO proposals (id, project_id, session_id, epic_id, verb, target_type, payload, state, decided_by, \
                 created_by, created_at, stage_id, withdrawn_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, ?8, ?9, ?10, ?11, ?12)",
                params![id, self.project_id, session_id, epic_id, verb, target, state, decided_by, self.actor_id, at, stage_id, withdrawn_at],
            )
            .unwrap();
        id
    }

    fn list(&self) -> Vec<NeedsYouItem> {
        needs_you(&self.conn, &self.project_id).expect("needs_you")
    }
}

/// Spec §5 "One row" (issue #162): the pending Proposals Story sessions filed are ONE item, "n from m
/// Stories", ranked after Confirm exit test and before the Shaping Rounds, waiting since the oldest. A
/// judged-on change (an amended criterion or Epic spec, issue #163) is not counted, nor a withdrawn or
/// decided Proposal, nor one a shaping session filed.
#[test]
fn proposals_from_execution_are_one_row_n_from_m_stories() {
    let mut b = board();
    let epic_id = b.epic_id.clone();
    let other_epic = b.epic("Other");
    let (a, _) = b.story("Files two", "running", "2026-10-01T00:00:00Z");
    let (c, _) = b.story_in(&other_epic, "Files one", "running", "2026-10-01T00:00:00Z");
    let sa = b.session(&a, "2026-10-01T00:00:00Z", None);
    let sa_old = b.session(&a, "2026-09-30T00:00:00Z", Some(("2026-09-30T01:00:00Z", "stopped_by_developer")));
    let sc = b.session(&c, "2026-10-01T00:00:00Z", None);
    b.proposal(&sa, Some(&epic_id), "create", "story", "pending", None, "2026-10-02T00:00:00Z");
    b.proposal(&sa_old, Some(&epic_id), "reorder", "story", "pending", None, "2026-10-01T05:00:00Z");
    b.proposal(&sc, None, "create", "epic", "pending", None, "2026-10-03T00:00:00Z");
    // Not counted: judged-on, withdrawn, decided.
    b.proposal(&sa, Some(&epic_id), "amend", "criterion", "pending", None, "2026-09-01T00:00:00Z");
    b.proposal(&sc, Some(&other_epic), "amend", "epic", "pending", None, "2026-09-01T00:00:00Z");
    b.proposal(&sa, Some(&epic_id), "create", "story", "withdrawn", None, "2026-09-01T00:00:00Z");
    b.proposal(&sc, Some(&other_epic), "create", "story", "accepted", None, "2026-09-01T00:00:00Z");
    // A shaping session's Proposal waits in its Stage, not here.
    let shaping = b.shaping_session(Some(&epic_id), None, true);
    let round = b.open_round(Some(&epic_id), Some(&shaping), true, "2026-09-01T00:00:00Z");
    let stage: String = b.conn.query_row("SELECT stage_id FROM rounds WHERE id = ?1", params![round], |r| r.get(0)).unwrap();
    b.proposal(&shaping, Some(&epic_id), "create", "story", "pending", Some(&stage), "2026-09-01T00:00:00Z");

    let items = b.list();
    let rows: Vec<&NeedsYouItem> = items.iter().filter(|i| i.kind == NeedsYouKind::Proposals).collect();
    assert_eq!(rows.len(), 1, "one row, whatever the count: {items:?}");
    let row = rows[0];
    let proposals = row.proposals.as_ref().expect("the row carries its counts");
    assert_eq!((proposals.count, proposals.stories), (3, 2), "3 from 2 Stories");
    assert_eq!((proposals.epics, proposals.roadmap), (1, true), "they land on one Epic and on the Roadmap");
    assert_eq!(row.since, "2026-10-01T05:00:00Z", "it has waited since the oldest");
    assert_eq!(row.record.kind, "project");
    assert_eq!(row.record.id.as_deref(), Some(b.project_id.as_str()));
    assert_eq!(NeedsYouKind::Proposals.rank(), 5);
    assert_eq!(NeedsYouKind::Proposals.as_str(), "proposals");
    let ranks: Vec<u8> = items.iter().map(|item| item.kind.rank()).collect();
    assert!(ranks.windows(2).all(|w| w[0] <= w[1]), "ranks never go down: {ranks:?}");
    let at = items.iter().position(|i| i.kind == NeedsYouKind::Proposals).unwrap();
    assert_eq!(items[at + 1].kind, NeedsYouKind::ShapingRound, "decisions about future work: Proposals, then the Round");
}

/// No pending Proposal from execution, no row: a judged-on change alone does not make one.
#[test]
fn no_proposals_row_without_a_pending_proposal_from_execution() {
    let mut b = board();
    let epic_id = b.epic_id.clone();
    let (a, _) = b.story("Files", "running", "2026-10-01T00:00:00Z");
    let sa = b.session(&a, "2026-10-01T00:00:00Z", None);
    b.proposal(&sa, Some(&epic_id), "amend", "criterion", "pending", None, "2026-10-02T00:00:00Z");
    b.proposal(&sa, Some(&epic_id), "create", "story", "rejected", None, "2026-10-02T00:00:00Z");
    let items = b.list();
    assert!(items.iter().all(|i| i.kind != NeedsYouKind::Proposals), "{items:?}");
}

fn kinds(items: &[NeedsYouItem]) -> Vec<NeedsYouKind> {
    items.iter().map(|item| item.kind).collect()
}

#[test]
fn an_empty_project_needs_nothing() {
    let b = board();
    assert!(b.list().is_empty());
}

/// Spec §2: live sessions held up first, then finished or dead work, then decisions about future work,
/// whatever order the records were written in.
#[test]
fn the_kinds_rank_in_spec_order_whatever_their_ages() {
    let mut b = board();
    // Oldest first: the Round, then the Epic to confirm, the review, the Stopped Story, the request.
    let round_epic = b.epic("Rounds");
    b.open_round(Some(&round_epic), None, false, "2026-10-01T00:00:00Z");

    let done_epic = b.epic("Shipped already");
    b.conn.execute("UPDATE epics SET state = 'ready' WHERE id = ?1", params![done_epic]).unwrap();
    b.story_in(&done_epic, "Merged one", "merged", "2026-10-02T00:00:00Z");

    let (review, _) = b.story("Handed off", "in_review", "2026-10-03T00:00:00Z");
    b.session(&review, "2026-10-03T00:00:00Z", Some(("2026-10-03T01:00:00Z", "handed_off")));

    let (stopped, _) = b.story("Crashed", "running", "2026-10-04T00:00:00Z");
    b.session(&stopped, "2026-10-04T00:00:00Z", Some(("2026-10-04T01:00:00Z", "crash")));

    let (waiting, _) = b.story("Asks", "running", "2026-10-05T00:00:00Z");
    let live = b.session(&waiting, "2026-10-05T00:00:00Z", None);
    b.request(&live, &waiting, "Bash", r#"{"command":"git push origin main"}"#, Some("default-branch-push"), "2026-10-05T01:00:00Z");

    let items = b.list();
    assert_eq!(
        kinds(&items),
        vec![
            NeedsYouKind::GatedAction,
            NeedsYouKind::Stopped,
            NeedsYouKind::Review,
            NeedsYouKind::ConfirmExitTest,
            NeedsYouKind::ShapingRound,
        ]
    );
    let ranks: Vec<u8> = items.iter().map(|item| item.kind.rank()).collect();
    assert!(ranks.windows(2).all(|w| w[0] <= w[1]), "ranks never go down: {ranks:?}");
}

/// Gated actions, permission requests and questions are one rank, mixed by age; each request is its own
/// item, and the item carries what its card needs.
#[test]
fn requests_and_questions_mix_by_age_oldest_first() {
    let mut b = board();
    let (a, a_key) = b.story("First", "running", "2026-10-01T00:00:00Z");
    let (c, _) = b.story("Second", "running", "2026-10-01T00:00:00Z");
    let sa = b.session(&a, "2026-10-01T00:00:00Z", None);
    let sc = b.session(&c, "2026-10-01T00:00:00Z", None);
    let question = b.request(&sc, &c, "AskUserQuestion", r#"{"questions":[{"question":"Which?"}]}"#, None, "2026-10-01T03:00:00Z");
    let gated = b.request(&sa, &a, "Bash", r#"{"command":"git push --force"}"#, Some("force-push"), "2026-10-01T02:00:00Z");
    let permission = b.request(&sa, &a, "Bash", r#"{"command":"npm test"}"#, None, "2026-10-01T01:00:00Z");

    let items = b.list();
    assert_eq!(
        kinds(&items),
        vec![NeedsYouKind::PermissionRequest, NeedsYouKind::GatedAction, NeedsYouKind::Question]
    );
    let ids: Vec<&str> = items.iter().map(|i| i.request.as_ref().unwrap().request_id.as_str()).collect();
    assert_eq!(ids, vec![permission.as_str(), gated.as_str(), question.as_str()]);

    let first = &items[0];
    assert_eq!(first.record.id.as_deref(), Some(a.as_str()));
    assert_eq!(first.record.key.as_deref(), Some(a_key.as_str()));
    assert_eq!(first.record.title, "First");
    assert_eq!(first.session_id.as_deref(), Some(sa.as_str()));
    assert_eq!(first.since, "2026-10-01T01:00:00Z");
    let gated_item = &items[1];
    assert_eq!(gated_item.request.as_ref().unwrap().destructive_category.as_deref(), Some("force-push"));
    assert_eq!(gated_item.request.as_ref().unwrap().input_payload.as_deref(), Some(r#"{"command":"git push --force"}"#));
}

/// A request on a session that has ended waits on no one, and an answered one is gone.
#[test]
fn only_pending_requests_on_live_sessions_count() {
    let mut b = board();
    let (s, _) = b.story("Ended", "running", "2026-10-01T00:00:00Z");
    let dead = b.session(&s, "2026-10-01T00:00:00Z", Some(("2026-10-01T02:00:00Z", "stopped_by_developer")));
    b.request(&dead, &s, "Bash", r#"{"command":"ls"}"#, None, "2026-10-01T01:00:00Z");
    let (t, _) = b.story("Answered", "running", "2026-10-01T00:00:00Z");
    let live = b.session(&t, "2026-10-01T00:00:00Z", None);
    let answered = b.request(&live, &t, "Bash", r#"{"command":"ls"}"#, None, "2026-10-01T01:00:00Z");
    b.conn.execute("UPDATE permission_requests SET status = 'allowed' WHERE id = ?1", params![answered]).unwrap();
    assert!(b.list().is_empty(), "{:?}", b.list());
}

/// Spec §2 "Attention": a stop the developer made still reads Stopped, but stays out of Needs you.
#[test]
fn a_stop_the_developer_made_is_left_out() {
    let mut b = board();
    let (mine, _) = b.story("I stopped it", "running", "2026-10-01T00:00:00Z");
    b.session(&mine, "2026-10-01T00:00:00Z", Some(("2026-10-01T01:00:00Z", "stopped_by_developer")));
    let (crashed, _) = b.story("It crashed", "running", "2026-10-01T00:00:00Z");
    let dead = b.session(&crashed, "2026-10-01T00:00:00Z", Some(("2026-10-01T02:00:00Z", "crash")));

    let items = b.list();
    assert_eq!(kinds(&items), vec![NeedsYouKind::Stopped]);
    assert_eq!(items[0].record.id.as_deref(), Some(crashed.as_str()));
    assert_eq!(items[0].session_id.as_deref(), Some(dead.as_str()));
    assert_eq!(items[0].ending_reason.as_deref(), Some("crash"));
    assert_eq!(items[0].since, "2026-10-01T02:00:00Z");
    assert!(!items[0].missing_worktree);
}

/// A Running Story whose session is live is not Stopped, and a Story that never started is not either.
#[test]
fn a_live_or_unstarted_story_is_not_stopped() {
    let mut b = board();
    let (live, _) = b.story("Working", "running", "2026-10-01T00:00:00Z");
    b.session(&live, "2026-10-01T00:00:00Z", None);
    b.story("Ready", "ready", "2026-10-01T00:00:00Z");
    assert!(b.list().is_empty());
}

/// Issue #156: a missing worktree (`query::recovery`) is a Stopped-kind item whose action is Recreate. It
/// replaces the Story's other Story items, so one Story is never two rows asking two things.
#[test]
fn a_missing_worktree_is_a_stopped_item_with_recreate() {
    let mut b = board();
    let (s, _) = b.story("Lost its tree", "running", "2026-10-01T00:00:00Z");
    b.session(&s, "2026-10-01T00:00:00Z", Some(("2026-10-01T05:00:00Z", "crash")));
    b.worktree(&s, "missing", "2026-10-01T00:00:00Z");
    let (fine, _) = b.story("Its tree is fine", "in_review", "2026-10-01T00:00:00Z");
    b.worktree(&fine, "active", "2026-10-01T00:00:00Z");
    let (gone, _) = b.story("Merged long ago", "merged", "2026-10-01T00:00:00Z");
    b.worktree(&gone, "missing", "2026-10-01T00:00:00Z");

    let items = b.list();
    assert_eq!(kinds(&items), vec![NeedsYouKind::Stopped, NeedsYouKind::Review]);
    assert_eq!(items[0].record.id.as_deref(), Some(s.as_str()));
    assert!(items[0].missing_worktree, "its action is Recreate");
}

#[test]
fn stories_in_review_are_oldest_hand_off_first() {
    let mut b = board();
    let (late, _) = b.story("Late", "in_review", "2026-10-01T00:00:00Z");
    b.session(&late, "2026-10-01T00:00:00Z", Some(("2026-10-03T00:00:00Z", "handed_off")));
    let (early, _) = b.story("Early", "in_review", "2026-10-09T00:00:00Z");
    b.session(&early, "2026-10-01T00:00:00Z", Some(("2026-10-02T00:00:00Z", "handed_off")));
    // Moved to In review by hand: no session, so its age is when the Story last changed.
    let (by_hand, _) = b.story("By hand", "in_review", "2026-10-02T12:00:00Z");

    let items = b.list();
    let ids: Vec<&str> = items.iter().map(|i| i.record.id.as_deref().unwrap()).collect();
    assert_eq!(ids, vec![early.as_str(), by_hand.as_str(), late.as_str()]);
    assert!(items.iter().all(|i| i.kind == NeedsYouKind::Review));
}

/// Notes from #134: an Epic at six of six Stories merged still reads In progress, with no sign it waits
/// on the developer. Needs you lists it, mirroring `epicExitTestConfirmable`.
#[test]
fn an_epic_whose_stories_are_all_merged_or_dropped_asks_to_confirm_its_exit_test() {
    let mut b = board();
    let epic_id = b.epic_id.clone();
    b.conn.execute("UPDATE epics SET state = 'ready', exit_test = 'Cyril sees it' WHERE id = ?1", params![epic_id]).unwrap();
    b.story("Merged", "merged", "2026-10-01T00:00:00Z");
    b.story("Dropped", "dropped", "2026-10-02T00:00:00Z");

    // Not yet: an Epic with a Story still open, one still in Shaping, one with no Story, a Done one.
    let open = b.epic("Still open");
    b.conn.execute("UPDATE epics SET state = 'ready' WHERE id = ?1", params![open]).unwrap();
    b.story_in(&open, "Merged", "merged", "2026-10-01T00:00:00Z");
    b.story_in(&open, "Running", "running", "2026-10-01T00:00:00Z");
    let shaping = b.epic("Shaping");
    b.story_in(&shaping, "Merged", "merged", "2026-10-01T00:00:00Z");
    let empty = b.epic("Empty");
    b.conn.execute("UPDATE epics SET state = 'ready' WHERE id = ?1", params![empty]).unwrap();
    let done = b.epic("Done");
    b.story_in(&done, "Merged", "merged", "2026-10-01T00:00:00Z");
    b.conn.execute("UPDATE epics SET state = 'done' WHERE id = ?1", params![done]).unwrap();

    let items: Vec<NeedsYouItem> = b.list().into_iter().filter(|i| i.kind == NeedsYouKind::ConfirmExitTest).collect();
    assert_eq!(items.len(), 1, "{items:?}");
    let item = &items[0];
    assert_eq!(item.record.kind, "epic");
    assert_eq!(item.record.id.as_deref(), Some(epic_id.as_str()));
    assert_eq!(item.exit_test.as_deref(), Some("Cyril sees it"));
    assert_eq!(item.milestone_title.as_deref(), Some("Board and review"));
    assert_eq!(item.since, "2026-10-02T00:00:00Z", "it has waited since its last Story closed");
}

/// Mirrors `milestoneExitTestConfirmable`: open, and every Epic Done with a Dropped one left out.
#[test]
fn a_milestone_whose_epics_are_all_done_asks_to_confirm_its_exit_test() {
    let mut b = board();
    let epic_id = b.epic_id.clone();
    let dropped = b.epic("Dropped one");
    b.conn.execute("UPDATE milestones SET state = 'ready' WHERE id = ?1", params![b.milestone_id]).unwrap();
    b.conn.execute("UPDATE epics SET state = 'done', updated_at = '2026-10-05T00:00:00Z' WHERE id = ?1", params![epic_id]).unwrap();
    b.conn.execute("UPDATE epics SET state = 'dropped' WHERE id = ?1", params![dropped]).unwrap();
    let other = milestone::create_milestone(&mut b.conn, &b.project_id, &b.actor_id, "Not yet", None).unwrap();
    epic::create_epic(&mut b.conn, &b.actor_id, &other.id, "Open").unwrap();

    let items = b.list();
    assert_eq!(kinds(&items), vec![NeedsYouKind::ConfirmExitTest]);
    assert_eq!(items[0].record.kind, "milestone");
    assert_eq!(items[0].record.id.as_deref(), Some(b.milestone_id.as_str()));
    assert_eq!(items[0].record.state.as_deref(), Some("in_progress"));
    assert_eq!(items[0].exit_test.as_deref(), Some("A Story merges in Flywheel alone"));
    assert_eq!(items[0].since, "2026-10-05T00:00:00Z");
}

/// Notes from #134: when a launch fails, the Round waits with no session. A held Round, an open Round
/// whose session died, one never launched and a pending roadmap Round are each an item; an open Round a
/// live session is still working on is not waiting on anyone.
#[test]
fn rounds_waiting_with_or_without_a_live_session_are_items() {
    let mut b = board();
    let held_epic = b.epic("Held");
    let held_session = b.shaping_session(Some(&held_epic), None, true);
    let held = b.open_round(Some(&held_epic), Some(&held_session), true, "2026-10-01T00:00:00Z");

    let dead_epic = b.epic("Dead session");
    let dead_session = b.shaping_session(Some(&dead_epic), None, false);
    let dead = b.open_round(Some(&dead_epic), Some(&dead_session), true, "2026-10-02T00:00:00Z");

    let never_epic = b.epic("Never launched");
    let never = b.open_round(Some(&never_epic), None, false, "2026-10-03T00:00:00Z");

    let roadmap = b.open_round(None, None, false, "2026-10-04T00:00:00Z");

    let working_epic = b.epic("Working");
    let working_session = b.shaping_session(Some(&working_epic), None, true);
    b.open_round(Some(&working_epic), Some(&working_session), false, "2026-10-00T00:00:00Z");

    let items = b.list();
    assert!(items.iter().all(|i| i.kind == NeedsYouKind::ShapingRound));
    let rounds: Vec<&str> = items.iter().map(|i| i.round.as_ref().unwrap().round_id.as_str()).collect();
    assert_eq!(rounds, vec![held.as_str(), dead.as_str(), never.as_str(), roadmap.as_str()]);
    let waiting: Vec<bool> = items.iter().map(|i| i.round.as_ref().unwrap().waiting_on_you).collect();
    assert_eq!(waiting, vec![true, false, false, false], "only the held Round is Waiting on you");
    assert_eq!(items[0].record.kind, "epic");
    assert_eq!(items[0].record.id.as_deref(), Some(held_epic.as_str()));
    assert_eq!(items[3].record.kind, "roadmap");
    assert_eq!(items[3].record.id, None);
}

/// The ranking is total: equal ages fall back to the item id, so two reads agree byte for byte.
#[test]
fn equal_ages_are_ordered_by_id_and_reads_are_deterministic() {
    let mut b = board();
    for title in ["One", "Two", "Three", "Four"] {
        b.story(title, "in_review", "2026-10-01T00:00:00Z");
    }
    let first = b.list();
    let ids: Vec<String> = first.iter().map(|i| i.id.clone()).collect();
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(ids, sorted);
    assert_eq!(first, b.list());
}

/// Another project's work never shows here.
#[test]
fn another_projects_items_stay_out() {
    let mut b = board();
    b.story("Here", "in_review", "2026-10-01T00:00:00Z");
    let other = core::domain::project::create_project(&mut b.conn, &b.actor_id, "Other", "/other", "OTH", "main").unwrap();
    let m = milestone::create_milestone(&mut b.conn, &other.id, &b.actor_id, "M", None).unwrap();
    let e = epic::create_epic(&mut b.conn, &b.actor_id, &m.id, "E").unwrap();
    let s = story::create_story(&mut b.conn, &b.actor_id, &e.id, "There").unwrap();
    b.conn.execute("UPDATE stories SET state = 'in_review' WHERE id = ?1", params![s.id]).unwrap();
    let items = b.list();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].record.title, "Here");
}
