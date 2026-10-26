//! Epic #59's exit test, walked in the domain (issue #128): a one-line idea becomes an Epic with
//! Ready Stories, each with Acceptance criteria and Checks, entirely in Flywheel.
//!
//! The agent's side goes through `shaping_tool` only, the way the sidecar relays a shaping session's
//! calls: `round_post`, `propose_spec_change`, `propose_story` and `propose_criterion`. The
//! developer's side is the domain writers the desktop's commands call: answering a Round, deciding a
//! Proposal, closing a Stage and starting the next Stage's session.

mod common;

use flywheel_core::domain::acceptance_criterion::criteria_for_story;
use flywheel_core::domain::check::check_for_criterion;
use flywheel_core::domain::epic::{self, get_epic};
use flywheel_core::domain::milestone;
use flywheel_core::domain::proposal::accept_proposal;
use flywheel_core::domain::round::accept_all_recommended;
use flywheel_core::domain::session::{start_shaping_session, ShapingSubject};
use flywheel_core::domain::session_kind::SessionKind;
use flywheel_core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome};
use flywheel_core::domain::stage::{close_stage, open_stage, stage_status, StageKind};
use flywheel_core::domain::story::stories_in_epic;
use rusqlite::Connection;
use serde_json::{json, Value};

struct Walk {
    conn: Connection,
    human: String,
    epic_id: String,
    session_id: String,
}

impl Walk {
    /// The developer presses Shape (or Close Stage starts the next Stage's session).
    fn shape(&mut self) {
        self.session_id = start_shaping_session(
            &mut self.conn,
            &ShapingSubject::Epic(self.epic_id.clone()),
            SessionKind::Shaping.launch_policy().permission_mode,
            &self.human,
        )
        .expect("a shaping session starts on the Epic")
        .id;
    }

    /// One agent call, as the sidecar relays it.
    fn agent(&mut self, tool: &str, args: Value) -> ShapingToolOutcome {
        let call = ShapingToolCall::parse(tool, &args).unwrap_or_else(|e| panic!("{tool} parses: {e:#}"));
        apply_shaping_tool_call(&mut self.conn, &self.session_id, "req", &call).unwrap_or_else(|e| panic!("{tool}: {e:#}"))
    }

    /// An agent Proposal tool, answered at once; the Proposal's id.
    fn propose(&mut self, tool: &str, args: Value) -> String {
        match self.agent(tool, args) {
            ShapingToolOutcome::Answered { result, .. } => result["proposal_id"].as_str().unwrap().to_string(),
            other => panic!("{tool} is answered at once: {other:?}"),
        }
    }

    /// The agent posts a one-question Round; the developer accepts the recommended answer.
    fn round(&mut self, title: &str) {
        let args = json!({
            "note": format!("Settles {title}."),
            "questions": [{
                "title": title,
                "question": format!("{title}?"),
                "grounding": "Read the Epic's one line",
                "recommended_answer": "Yes",
                "because": "It keeps the Epic small",
            }],
        });
        let round_id = match self.agent("round_post", args) {
            ShapingToolOutcome::Held { round_id, .. } => round_id,
            other => panic!("round_post is held: {other:?}"),
        };
        accept_all_recommended(&mut self.conn, &self.human, &round_id).unwrap();
    }

    fn accept(&mut self, proposal_id: &str) {
        accept_proposal(&mut self.conn, &self.human, proposal_id).unwrap();
    }

    /// The developer closes the open Stage, which must be `kind` and have nothing open.
    fn close(&mut self, kind: StageKind) {
        let stage = open_stage(&self.conn, &ShapingSubject::Epic(self.epic_id.clone())).unwrap().expect("an open Stage");
        assert_eq!(stage.kind, kind);
        let status = stage_status(&self.conn, &stage.id).unwrap();
        assert!(status.closable(), "{:?}", status.open_items);
        close_stage(&mut self.conn, &self.human, &stage.id).unwrap();
    }
}

#[test]
fn a_one_line_epic_becomes_ready_stories_with_criteria_and_checks() {
    let (mut conn, human, project) = common::seeded_project();
    let checkout = tempfile::tempdir().unwrap();
    conn.execute("UPDATE projects SET repo_path = ?1 WHERE id = ?2", rusqlite::params![checkout.path().to_string_lossy(), project.id])
        .unwrap();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    // The one-line idea: a title and nothing else.
    let e = epic::create_epic(&mut conn, &human, &m.id, "Feed rows show the agent's live verb").unwrap();
    let mut w = Walk { conn, human, epic_id: e.id, session_id: String::new() };

    // Stage 1: challenge the spec.
    w.shape();
    w.round("Who reads the feed");
    for (field, text) in [
        ("problem", "A feed row says what a tool did, never what the agent is doing now."),
        ("scope", "The feed row's verb while a tool call runs."),
        ("exit_test", "A running tool call reads as its live verb in the feed."),
    ] {
        let id = w.propose("propose_spec_change", json!({ "field": field, "text": text, "why": "Round 1" }));
        w.accept(&id);
    }
    w.close(StageKind::ChallengeSpec);

    // Stage 2: slice into Stories.
    w.shape();
    let verbs = w.propose(
        "propose_story",
        json!({ "title": "Live verbs for board tools", "description": "Each board tool reads as a live verb; tested in tool-verbs." }),
    );
    let row = w.propose(
        "propose_story",
        json!({
            "title": "The feed row shows the live verb",
            "description": "The row swaps to the live verb while the call runs; tested in feed-row.",
            "runs_after": verbs, "runs_after_reason": "reads its verbs",
        }),
    );
    w.accept(&verbs);
    w.accept(&row);
    w.close(StageKind::Slice);

    // Stage 3: write the Acceptance criteria and their Checks.
    w.shape();
    let stories = stories_in_epic(&w.conn, &w.epic_id).unwrap();
    assert_eq!(stories.len(), 2);
    for s in &stories {
        let checked = w.propose(
            "propose_criterion",
            json!({ "story": s.key, "statement": format!("{} is tested", s.title), "check": format!("npm test -- {}", s.key) }),
        );
        let judged = w.propose("propose_criterion", json!({ "story": s.key, "statement": format!("{} reads plainly", s.title) }));
        w.accept(&checked);
        w.accept(&judged);
    }
    w.close(StageKind::Criteria);

    // The exit test: Ready Stories, each with criteria and Checks, in a Ready Epic.
    assert_eq!(get_epic(&w.conn, &w.epic_id).unwrap().unwrap().state, "ready");
    let stories = stories_in_epic(&w.conn, &w.epic_id).unwrap();
    assert_eq!(
        stories.iter().map(|s| (s.title.as_str(), s.state.as_str())).collect::<Vec<_>>(),
        [("Live verbs for board tools", "ready"), ("The feed row shows the live verb", "ready")]
    );
    assert_eq!(stories[1].runs_after_story_id.as_deref(), Some(stories[0].id.as_str()));
    for s in &stories {
        let criteria = criteria_for_story(&w.conn, &s.id).unwrap();
        assert_eq!(criteria.len(), 2, "{}", s.key);
        assert!(criteria.iter().all(|c| c.accepted_by.is_none()), "accepted at review, not in shaping");
        let check = check_for_criterion(&w.conn, &criteria[0].id).unwrap().expect("the first criterion has its Check");
        assert_eq!(check.command, format!("npm test -- {}", s.key));
        assert_eq!(check_for_criterion(&w.conn, &criteria[1].id).unwrap(), None, "the second is judged at review");
    }
    let spec = get_epic(&w.conn, &w.epic_id).unwrap().unwrap().spec;
    assert!(spec.problem.is_some() && spec.scope.is_some() && spec.exit_test.is_some());
}
