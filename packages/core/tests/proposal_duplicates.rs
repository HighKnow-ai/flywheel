//! Plan 06-04 (PROP-04, D-105/D-106/D-107): measures and pins
//! `core::query::search::DUPLICATE_BM25_THRESHOLD` against a seeded corpus (Task 2), then proves
//! the staging write path (`create_proposal_in_tx`/`amend_proposal`) writes the duplicate verdict
//! into `duplicate_of`/`duplicate_score` in the SAME transaction and the SAME statement that
//! stages the row (Task 3).
//!
//! Every seeded row goes through the real domain writers (`create_task`, `create_epic`,
//! `create_issue`, `create_proposal` + `reject_proposal`) — never hand-written SQL, which would
//! bypass the FTS5 sync triggers and measure a stale index (mirrors `tests/search_filter.rs`'s own
//! fixture discipline, `common/mod.rs`'s module doc comment).

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    amend_proposal, create_proposal, pending_proposals_for_run, reject_proposal, ProposalPayload,
    ProposalProvenance, ProposalVerb,
};
use core::domain::epic::create_epic;
use core::domain::issue::{create_issue, IssueParent};
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::search::{
    duplicate_candidate_for, duplicate_score_lookup, is_flagged_as_duplicate, DUPLICATE_BM25_THRESHOLD,
};
use rusqlite::{params, Connection};

use common::seeded_project;

/// Seed a RUNNING task-execution `agent_runs` row (mirrors `proposal_channel.rs`'s own
/// `seeded_execution_run`, copied rather than imported per this repo's established
/// self-contained-test-file precedent) so this file can stage proposals through the real
/// `create_proposal` write path.
fn seed_agent_run(conn: &mut Connection, project_id: &str, human_actor_id: &str) -> String {
    let task = create_task(conn, project_id, human_actor_id, "Fixture executor task", None)
        .expect("create_task should succeed");
    let agent_actor = agent_actor_id(conn).expect("seeded agent actor should exist");
    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![new_id(), project_id, task.id, human_actor_id, now],
            |row| row.get(0),
        )
        .expect("failed to insert fixture trigger");

    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', NULL, \
            NULL, NULL, ?6, ?7, NULL, NULL)",
        params![
            run_id,
            task.id,
            project_id,
            trigger_id,
            agent_actor,
            format!("/tmp/log-{run_id}.jsonl"),
            now,
        ],
    )
    .expect("failed to insert fixture agent_run");
    run_id
}

/// A throwaway agent run with NO task/epic subject at all (plan 06-05) — used only to give one
/// filler proposal its own `agent_run_id` so `PROPOSAL_LIMIT_PER_RUN` never trips on `seed_filler`.
/// Unlike `seed_agent_run`, this creates NO `tasks` row: calling `seed_agent_run` once PER filler
/// proposal would have inserted 20 extra "Fixture executor task" rows into `tasks`/`tasks_fts`,
/// perturbing the exact bm25 IDF statistics `DUPLICATE_BM25_THRESHOLD` was measured and pinned
/// against (found the hard way — a previous version of this fix did exactly that and flipped an
/// unrelated-pair case into a false positive). `triggers.target_task_id`/`target_epic_id` are both
/// nullable and the table's own CHECK only forbids both being NON-null together, so a trigger (and
/// the `agent_runs` row it backs) with NEITHER set is a valid row, not a workaround.
fn seed_throwaway_run(conn: &mut Connection, project_id: &str, actor_id: &str) -> String {
    let agent_actor = agent_actor_id(conn).expect("seeded agent actor should exist");
    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, NULL, NULL, 'user_action', NULL, 1, NULL, ?3, ?4) RETURNING id",
            params![new_id(), project_id, actor_id, now],
            |row| row.get(0),
        )
        .expect("failed to insert throwaway trigger");

    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, NULL, NULL, ?2, ?3, 'claude_code', ?4, 'running', NULL, 'default', \
            NULL, NULL, NULL, ?5, ?6, NULL, NULL)",
        params![run_id, project_id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl"), now],
    )
    .expect("failed to insert throwaway agent_run");
    run_id
}

/// Realistic filler vocabulary — seeded so `bm25`'s IDF term has a real corpus to compute
/// against, rather than a degenerate one-document table (the score magnitude compresses toward
/// zero on a near-empty table, per SQLite's own `bm25` IDF formula).
const FILLER_TITLES: [&str; 20] = [
    "Update the changelog for the next release",
    "Refactor the settings page layout",
    "Add pagination to the activity list view",
    "Improve error messages on the submit form",
    "Clean up unused imports across the crate",
    "Write documentation for the public API",
    "Optimize the CI build pipeline caching",
    "Add a keyboard shortcut cheat sheet",
    "Bump dependency versions for security patches",
    "Rename the legacy config module",
    "Add telemetry for the onboarding flow",
    "Polish the empty-state illustrations",
    "Consolidate duplicate CSS utility classes",
    "Add a loading skeleton to the board",
    "Fix inconsistent button spacing",
    "Add unit tests for the ranking helper",
    "Improve the drag handle affordance",
    "Add a confirmation dialog before deleting",
    "Tighten the tab order for accessibility",
    "Add a tooltip explaining the priority icons",
];

/// Plan 06-05 (PROP-05): `_run_id` is intentionally UNUSED for the filler proposals below — each
/// one now stages under its own throwaway run (via `seed_agent_run`) rather than the caller's
/// `run_id`, so `FILLER_TITLES.len()` (20) filler proposals never collide with
/// `PROPOSAL_LIMIT_PER_RUN` (10) on any single run, least of all the run under test. The filler
/// proposals exist only to give `bm25`'s IDF term a real corpus and are rejected immediately —
/// which run staged them was never load-bearing for that purpose.
fn seed_filler(conn: &mut Connection, project_id: &str, actor_id: &str, _run_id: &str, n: usize) {
    for i in 0..n {
        let title = FILLER_TITLES[i % FILLER_TITLES.len()];
        create_task(conn, project_id, actor_id, title, None).expect("filler create_task");
        create_epic(conn, project_id, actor_id, title, None).expect("filler create_epic");
        create_issue(conn, project_id, actor_id, title, None, "idea", IssueParent::None)
            .expect("filler create_issue");
        let filler_run_id = seed_throwaway_run(conn, project_id, actor_id);
        let proposal = create_proposal(
            conn,
            &filler_run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: title.to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("filler create_proposal");
        reject_proposal(conn, &proposal.id, actor_id, Some("filler"))
            .expect("filler reject_proposal");
    }
}

/// One labelled measurement case: a canonical row seeded into `corpus`, and a query text scored
/// against the whole project's corpus. `is_near_duplicate` says which of the two labelled sets
/// this case belongs to — used only for reporting, never for a different code path.
struct Case {
    label: &'static str,
    corpus: &'static str, // "task" | "epic" | "issue" | "proposal"
    canonical_title: &'static str,
    canonical_body: Option<&'static str>,
    query_title: &'static str,
    query_body: Option<&'static str>,
}

/// Same finding, different wording — every entry here must score BELOW the pinned threshold.
const NEAR_DUPLICATE_PAIRS: &[Case] = &[
    Case {
        label: "task: retry budget ignoring configuration",
        corpus: "task",
        canonical_title: "Retry budget is hardcoded at three attempts",
        canonical_body: Some("The exponential backoff loop ignores the configured retry count and always retries exactly three times regardless of settings."),
        query_title: "Retry count ignores configuration and always retries three times",
        query_body: Some("Backoff logic never reads the configured retry budget, so it retries exactly three times no matter what the settings say."),
    },
    Case {
        label: "task: session expiry with no warning",
        corpus: "task",
        canonical_title: "Session token expires without a refresh warning",
        canonical_body: Some("Users are logged out silently when the JWT expires with no banner or notice beforehand."),
        query_title: "JWT expiry logs the user out with no warning banner",
        query_body: Some("No banner appears before the session token expires; the user is silently signed out when the token expires."),
    },
    Case {
        label: "epic: board virtualization for large lists",
        corpus: "epic",
        canonical_title: "Migrate the board to virtualization for large lists",
        canonical_body: Some("Board rendering slows down past a thousand rows because every row mounts a full DOM node."),
        query_title: "Board list needs virtualization to handle large row counts",
        query_body: Some("Rendering slows down badly once the board has over a thousand rows since every row mounts a full DOM node."),
    },
    Case {
        label: "epic: dark mode across the whole app",
        corpus: "epic",
        canonical_title: "Ship dark mode across the whole desktop app",
        canonical_body: Some("Every screen should respect a user-selected dark color theme, not just the board."),
        query_title: "Dark color theme should apply to every screen",
        query_body: Some("Right now dark mode only affects the board; the rest of the desktop app ignores the selected dark color theme."),
    },
    Case {
        label: "issue: flaky search suite in CI",
        corpus: "issue",
        canonical_title: "Flaky CI job fails intermittently on the search suite",
        canonical_body: Some("The search_filter test suite fails roughly one run in twenty with a timing-dependent assertion."),
        query_title: "Search suite intermittently fails in CI",
        query_body: Some("About one run in twenty, the search_filter test suite fails because of a timing-dependent assertion."),
    },
    Case {
        label: "issue: null assignee crashes epic roster",
        corpus: "issue",
        canonical_title: "Missing null check crashes the epic roster view",
        canonical_body: Some("Opening the epic roster crashes when an epic has no assignee set."),
        query_title: "Epic roster crashes on a null assignee",
        query_body: Some("The epic roster view crashes whenever an epic's assignee field is not set."),
    },
    Case {
        label: "proposal: rejected Slack notification restated",
        corpus: "proposal",
        canonical_title: "Add a Slack integration for board notifications",
        canonical_body: Some("Notify a Slack channel whenever a task moves to done."),
        query_title: "Board notifications should post to a Slack channel",
        query_body: Some("Whenever a task reaches done, notify the configured Slack channel."),
    },
    Case {
        label: "proposal: rejected CSV import restated",
        corpus: "proposal",
        canonical_title: "Support importing a CSV of tasks",
        canonical_body: Some("Let a user bulk-import tasks from a CSV file."),
        query_title: "Bulk task import from a CSV file",
        query_body: Some("Allow users to import many tasks at once from an uploaded CSV file."),
    },
];

/// Different findings that merely share common, generic project vocabulary (not the specific,
/// distinctive nouns each canonical row's own finding turns on) — every entry here must score AT
/// OR ABOVE the pinned threshold (i.e. NOT flagged). Deliberately avoids reusing the canonical
/// row's rare technical terms (`retry`/`budget`/`backoff`, `JWT`/`session token`/`banner`,
/// `virtualization`/`DOM`, `dark mode`/`theme`, `flaky`/`timing`, `null`/`assignee`,
/// `Slack`/`notify`, `CSV`/`import`) — reusing those would score this set nearly as high as the
/// near-duplicate set, since `bm25` rewards exactly those rare, shared, informative terms
/// (verified empirically before committing this fixture: see `06-04-SUMMARY.md`).
const UNRELATED_PAIRS: &[Case] = &[
    Case {
        label: "task: upload history view is not the retry-budget bug",
        corpus: "task",
        canonical_title: "Retry budget is hardcoded at three attempts",
        canonical_body: Some("The exponential backoff loop ignores the configured retry count and always retries exactly three times regardless of settings."),
        query_title: "Add a history view showing past upload tries and their timestamps",
        query_body: Some("A log so people can see when uploads happened and how they went, separate from any automatic retry mechanism."),
    },
    Case {
        label: "task: logout countdown page is not the silent-expiry bug",
        corpus: "task",
        canonical_title: "Session token expires without a refresh warning",
        canonical_body: Some("Users are logged out silently when the JWT expires with no banner or notice beforehand."),
        query_title: "Add a page showing how much time is left before logout",
        query_body: Some("Show a countdown so people know when they will be signed out, configurable in settings."),
    },
    Case {
        label: "epic: drag-and-drop reorder is not the virtualization epic",
        corpus: "epic",
        canonical_title: "Migrate the board to virtualization for large lists",
        canonical_body: Some("Board rendering slows down past a thousand rows because every row mounts a full DOM node."),
        query_title: "Add drag-and-drop reordering to the board rows",
        query_body: Some("People want to reorder rows by dragging them, a feature request unrelated to rendering performance."),
    },
    Case {
        label: "epic: accent color picker is not the dark-mode epic",
        corpus: "epic",
        canonical_title: "Ship dark mode across the whole desktop app",
        canonical_body: Some("Every screen should respect a user-selected dark color theme, not just the board."),
        query_title: "Add a custom accent color picker to settings",
        query_body: Some("Let users pick their own accent color, separate from the existing light and dark toggle."),
    },
    Case {
        label: "issue: slow pipeline duration is not the flaky-suite bug",
        corpus: "issue",
        canonical_title: "Flaky CI job fails intermittently on the search suite",
        canonical_body: Some("The search_filter test suite fails roughly one run in twenty with a timing-dependent assertion."),
        query_title: "The whole pipeline takes too long to finish on every push",
        query_body: Some("Fifteen minutes per push slows down iteration, a duration complaint rather than an intermittent failure."),
    },
    Case {
        label: "issue: large-roster pagination is not the null-assignee crash",
        corpus: "issue",
        canonical_title: "Missing null check crashes the epic roster view",
        canonical_body: Some("Opening the epic roster crashes when an epic has no assignee set."),
        query_title: "The roster stops paginating correctly past two hundred rows",
        query_body: Some("A large project's roster view breaks its paging once it grows past two hundred entries."),
    },
    Case {
        label: "proposal: Teams reminder is not the Slack notification proposal",
        corpus: "proposal",
        canonical_title: "Add a Slack integration for board notifications",
        canonical_body: Some("Notify a Slack channel whenever a task moves to done."),
        query_title: "Add a Microsoft Teams integration for reminders",
        query_body: Some("Send a reminder when a task has been waiting too long, a different chat platform and a different trigger entirely."),
    },
    Case {
        label: "proposal: printable board view is not the CSV import proposal",
        corpus: "proposal",
        canonical_title: "Support importing a CSV of tasks",
        canonical_body: Some("Let a user bulk-import tasks from a CSV file."),
        query_title: "Add a printable view of the whole board",
        query_body: Some("People want a formatted page they can print, a presentation feature with nothing to do with getting data onto the board."),
    },
];

/// Seed one project with `FILLER_TITLES.len()` filler rows in each of the four corpora, plus the
/// canonical row for every entry in `NEAR_DUPLICATE_PAIRS`/`UNRELATED_PAIRS` (a case's canonical
/// row is shared between its near-duplicate and unrelated sibling, so each distinct
/// `(corpus, canonical_title)` pair is only seeded once). Returns the open connection, actor id
/// and project id.
fn seed_measurement_corpus() -> (Connection, String, String) {
    let (mut conn, actor_id, project) = seeded_project();
    let run_id = seed_agent_run(&mut conn, &project.id, &actor_id);
    seed_filler(&mut conn, &project.id, &actor_id, &run_id, FILLER_TITLES.len());

    let mut seeded_canonical_titles: Vec<&'static str> = Vec::new();
    for case in NEAR_DUPLICATE_PAIRS.iter().chain(UNRELATED_PAIRS.iter()) {
        if seeded_canonical_titles.contains(&case.canonical_title) {
            continue;
        }
        seeded_canonical_titles.push(case.canonical_title);

        match case.corpus {
            "task" => {
                create_task(&mut conn, &project.id, &actor_id, case.canonical_title, None)
                    .expect("canonical create_task");
            }
            "epic" => {
                create_epic(
                    &mut conn,
                    &project.id,
                    &actor_id,
                    case.canonical_title,
                    case.canonical_body,
                )
                .expect("canonical create_epic");
            }
            "issue" => {
                create_issue(
                    &mut conn,
                    &project.id,
                    &actor_id,
                    case.canonical_title,
                    case.canonical_body,
                    "idea",
                    IssueParent::None,
                )
                .expect("canonical create_issue");
            }
            "proposal" => {
                let proposal = create_proposal(
                    &mut conn,
                    &run_id,
                    ProposalVerb::Create,
                    ProposalPayload::Task {
                        title: case.canonical_title.to_string(),
                        description: case.canonical_body.map(str::to_string),
                    },
                    None,
                    None,
                    ProposalProvenance::NONE,
                )
                .expect("canonical create_proposal");
                reject_proposal(&mut conn, &proposal.id, &actor_id, Some("already decided"))
                    .expect("canonical reject_proposal");
            }
            other => panic!("unknown corpus {other:?}"),
        }
    }

    (conn, actor_id, project.id)
}

/// The raw, UNTHRESHOLDED score for one case — `None` only when the query text matched literally
/// nothing at all in the whole project (no shared token whatsoever), which is itself a valid,
/// non-flagged outcome for an [`UNRELATED_PAIRS`] entry, printed rather than asserted against
/// directly since a total non-match carries no numeric score to compare.
fn observed_score(conn: &Connection, project_id: &str, case: &Case) -> Option<f64> {
    duplicate_score_lookup(conn, project_id, None, case.query_title, case.query_body)
        .expect("duplicate_score_lookup should not error")
        .map(|candidate| candidate.score)
}

/// The measurement this whole file exists to run: print every case's observed, unthresholded
/// score (`cargo test -p core --test proposal_duplicates -- --nocapture` to see the full table),
/// then assert the two sets actually separate — `DUPLICATE_BM25_THRESHOLD` is pinned in
/// `query::search` from exactly this fixture's output, recorded in that constant's own doc
/// comment (06-04-PLAN.md Task 2's own instruction: "the assertion messages must print the
/// entry's label and its observed score" on failure).
#[test]
fn threshold_separates_near_duplicates_from_unrelated_pairs_across_all_four_corpora() {
    let (conn, _actor_id, project_id) = seed_measurement_corpus();

    let near: Vec<(&str, Option<f64>)> = NEAR_DUPLICATE_PAIRS
        .iter()
        .map(|case| (case.label, observed_score(&conn, &project_id, case)))
        .collect();
    let unrelated: Vec<(&str, Option<f64>)> = UNRELATED_PAIRS
        .iter()
        .map(|case| (case.label, observed_score(&conn, &project_id, case)))
        .collect();

    eprintln!("NEAR_DUPLICATE_PAIRS observed scores:");
    for (label, score) in &near {
        eprintln!("  {score:?}  {label}");
    }
    eprintln!("UNRELATED_PAIRS observed scores:");
    for (label, score) in &unrelated {
        eprintln!("  {score:?}  {label}");
    }

    for (label, score) in &near {
        let score = score.unwrap_or_else(|| {
            panic!("near-duplicate case {label:?} matched nothing at all — cannot be flagged")
        });
        assert!(
            is_flagged_as_duplicate(score),
            "near-duplicate case {label:?} scored {score} which is NOT below \
             DUPLICATE_BM25_THRESHOLD ({DUPLICATE_BM25_THRESHOLD}) — the pinned threshold no \
             longer separates this set"
        );
    }

    for (label, score) in &unrelated {
        // A total non-match (`None`) is trivially "not flagged" — only a `Some` score needs the
        // threshold comparison checked.
        if let Some(score) = score {
            assert!(
                !is_flagged_as_duplicate(*score),
                "unrelated case {label:?} scored {score} which IS below \
                 DUPLICATE_BM25_THRESHOLD ({DUPLICATE_BM25_THRESHOLD}) — a false positive"
            );
        }
    }
}

/// Task 2's own required direct test: "a score exactly equal to the threshold is not flagged" —
/// asserted against the real production comparison [`is_flagged_as_duplicate`] runs, not inferred
/// from a fixture whose measured score happens to land near the boundary (float measurements from
/// two different corpora/fixtures are never guaranteed to hit an exact value).
#[test]
fn a_score_exactly_equal_to_the_threshold_is_not_flagged() {
    assert!(
        !is_flagged_as_duplicate(DUPLICATE_BM25_THRESHOLD),
        "a score exactly equal to DUPLICATE_BM25_THRESHOLD must not be flagged — the comparison \
         must be strict less-than, never less-than-or-equal"
    );
}

/// `duplicate_candidate_for` (the real, PUBLIC, thresholded entry point every caller outside this
/// test file uses) agrees with the raw scores above: every near-duplicate query returns
/// `Some`, every unrelated query returns `None`.
#[test]
fn duplicate_candidate_for_flags_near_duplicates_and_clears_unrelated_pairs() {
    let (conn, _actor_id, project_id) = seed_measurement_corpus();

    for case in NEAR_DUPLICATE_PAIRS {
        let candidate = duplicate_candidate_for(&conn, &project_id, None, case.query_title, case.query_body)
            .expect("duplicate_candidate_for should not error");
        assert!(
            candidate.is_some(),
            "near-duplicate case {:?} should be flagged by duplicate_candidate_for",
            case.label
        );
    }

    for case in UNRELATED_PAIRS {
        let candidate = duplicate_candidate_for(&conn, &project_id, None, case.query_title, case.query_body)
            .expect("duplicate_candidate_for should not error");
        assert!(
            candidate.is_none(),
            "unrelated case {:?} should NOT be flagged by duplicate_candidate_for, got {:?}",
            case.label,
            candidate
        );
    }
}

#[test]
fn scoring_against_an_empty_corpus_returns_none_with_no_error() {
    let (conn, _actor_id, project) = seeded_project();
    let candidate = duplicate_candidate_for(
        &conn,
        &project.id,
        None,
        "Anything at all restating some finding",
        Some("A body with more words describing the same finding."),
    )
    .expect("duplicate_candidate_for should not error against an empty corpus");
    assert!(candidate.is_none(), "an empty corpus must never produce a candidate");
}

#[test]
fn a_title_containing_fts5_query_syntax_degrades_to_no_candidate_rather_than_an_error() {
    let (mut conn, actor_id, project) = seeded_project();
    create_task(&mut conn, &project.id, &actor_id, "Fix crash on quit", None)
        .expect("create_task should succeed");

    // Every one of these characters is an FTS5 query-syntax operator when unescaped (`:` column
    // filter, `*` unquoted prefix, `-` exclusion, `(`/`)` grouping) — a model-authored title could
    // contain any of them. `to_fts5_prefix_phrase`'s per-word escaping (T-06-15) must degrade this
    // to "no candidate found", never a query-syntax error surfaced to the staging call.
    let candidate = duplicate_candidate_for(
        &conn,
        &project.id,
        None,
        "weird: title * with (parens) - and a dash",
        None,
    )
    .expect("an FTS5-syntax-heavy title must not error, only degrade to no candidate");
    assert!(
        candidate.is_none(),
        "adversarial punctuation should not coincidentally match the fixture's own task"
    );
}

// ============================================================================
// Task 3: the flag is written at STAGING time, in the SAME transaction and the
// SAME statement that creates the row.
// ============================================================================

// No body constant: the canonical task below is seeded via `create_task`, which (per
// `domain::task::create_task`'s own signature) never accepts a description — a task's own
// duplicate-detection surface is title-only, exactly as `DUPLICATE_BM25_THRESHOLD`'s doc comment
// in `query::search` records as this plan's own measured finding.
const RETRY_BUDGET_TITLE: &str = "Retry budget is hardcoded at three attempts";
const RETRY_BUDGET_NEAR_DUP_TITLE: &str = "Retry count ignores configuration and always retries three times";
const RETRY_BUDGET_NEAR_DUP_BODY: &str =
    "Backoff logic never reads the configured retry budget, so it retries exactly three times no matter what the settings say.";

const SLACK_PROPOSAL_TITLE: &str = "Add a Slack integration for board notifications";
const SLACK_PROPOSAL_BODY: &str = "Notify a Slack channel whenever a task moves to done.";
const SLACK_PROPOSAL_NEAR_DUP_TITLE: &str = "Board notifications should post to a Slack channel";
const SLACK_PROPOSAL_NEAR_DUP_BODY: &str = "Whenever a task reaches done, notify the configured Slack channel.";

/// A small, self-contained fixture for Task 3's staging-time assertions: `FILLER_TITLES.len()`
/// filler rows (so `bm25`'s IDF term has a real corpus, exactly like the Task 2 measurement
/// fixture) plus ONE canonical open task and ONE canonical REJECTED proposal, both using wording
/// this file's own Task 2 measurement already proved scores well below the pinned
/// `DUPLICATE_BM25_THRESHOLD` (`-21.0`) when restated. Returns `(conn, actor_id, project_id,
/// run_id)`.
fn seed_staging_fixture() -> (Connection, String, String, String) {
    let (mut conn, actor_id, project) = seeded_project();
    let run_id = seed_agent_run(&mut conn, &project.id, &actor_id);
    seed_filler(&mut conn, &project.id, &actor_id, &run_id, FILLER_TITLES.len());

    create_task(&mut conn, &project.id, &actor_id, RETRY_BUDGET_TITLE, None)
        .expect("canonical create_task should succeed");

    let slack_proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: SLACK_PROPOSAL_TITLE.to_string(),
            description: Some(SLACK_PROPOSAL_BODY.to_string()),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("canonical create_proposal should succeed");
    reject_proposal(&mut conn, &slack_proposal.id, &actor_id, Some("already decided"))
        .expect("canonical reject_proposal should succeed");

    (conn, actor_id, project.id, run_id)
}

#[test]
fn staging_flags_a_proposal_restating_an_existing_open_task() {
    let (mut conn, actor_id, project_id, run_id) = seed_staging_fixture();
    let _ = (actor_id, project_id);

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: RETRY_BUDGET_NEAR_DUP_TITLE.to_string(),
            description: Some(RETRY_BUDGET_NEAR_DUP_BODY.to_string()),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");

    assert!(proposal.duplicate_of.is_some(), "restating an open task must write duplicate_of");
    let score = proposal.duplicate_score.expect("a flagged proposal must carry a duplicate_score");
    assert!(
        is_flagged_as_duplicate(score),
        "the stored duplicate_score ({score}) must itself satisfy the flagging comparison"
    );
}

#[test]
fn staging_writes_null_duplicate_columns_when_nothing_scores_below_threshold() {
    let (mut conn, actor_id, project_id, run_id) = seed_staging_fixture();
    let _ = (actor_id, project_id);

    // Vocabulary that shares only generic project words with the fixture's canonical rows — the
    // same "different finding, common vocabulary" shape Task 2's UNRELATED_PAIRS uses.
    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: "Add a history view showing past upload tries and their timestamps".to_string(),
            description: Some(
                "A log so people can see when uploads happened, separate from any automatic retry mechanism."
                    .to_string(),
            ),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");

    assert!(proposal.duplicate_of.is_none(), "an unrelated proposal must not write duplicate_of");
    assert!(proposal.duplicate_score.is_none(), "an unrelated proposal must not write duplicate_score");
}

#[test]
fn staging_against_an_entirely_empty_project_writes_null_and_raises_no_error() {
    let (mut conn, actor_id, project) = seeded_project();
    let run_id = seed_agent_run(&mut conn, &project.id, &actor_id);

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: "Anything at all restating some finding".to_string(),
            description: Some("A body describing the same finding in different words.".to_string()),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal against an empty project must not error");

    let _ = actor_id;
    assert!(proposal.duplicate_of.is_none(), "an empty project can never produce a duplicate_of");
    assert!(proposal.duplicate_score.is_none(), "an empty project can never produce a duplicate_score");
}

#[test]
fn a_flagged_proposal_is_still_pending_and_returned_by_the_pending_read() {
    let (mut conn, actor_id, project_id, run_id) = seed_staging_fixture();
    let _ = (actor_id, project_id);

    let before_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM authoring_proposals", [], |row| row.get(0))
        .expect("counting authoring_proposals should succeed");

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: RETRY_BUDGET_NEAR_DUP_TITLE.to_string(),
            description: Some(RETRY_BUDGET_NEAR_DUP_BODY.to_string()),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");
    assert!(proposal.duplicate_of.is_some(), "fixture setup: this proposal must be flagged");

    let after_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM authoring_proposals", [], |row| row.get(0))
        .expect("counting authoring_proposals should succeed");
    assert_eq!(after_count, before_count + 1, "staging a flagged proposal must add exactly one row");

    let pending = pending_proposals_for_run(&conn, &run_id, 0).expect("pending_proposals_for_run should succeed");
    let found = pending
        .iter()
        .find(|p| p.id == proposal.id)
        .unwrap_or_else(|| panic!("flagged proposal {:?} must still appear in the pending read", proposal.id));
    assert_eq!(found.status, "pending", "a flagged proposal must never be auto-decided");
    assert_eq!(found.duplicate_of, proposal.duplicate_of, "the pending read must surface the same flag");
}

#[test]
fn staging_flags_against_an_already_rejected_proposal_not_only_canonical_items() {
    let (mut conn, actor_id, project_id, run_id) = seed_staging_fixture();
    let _ = (actor_id, project_id);

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: SLACK_PROPOSAL_NEAR_DUP_TITLE.to_string(),
            description: Some(SLACK_PROPOSAL_NEAR_DUP_BODY.to_string()),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");

    assert!(
        proposal.duplicate_of.is_some(),
        "restating an already-rejected proposal must still be flagged (D-106)"
    );
    assert!(proposal.duplicate_score.is_some());
}

#[test]
fn a_title_containing_fts5_syntax_stages_successfully_with_both_columns_null() {
    let (mut conn, actor_id, project) = seeded_project();
    let run_id = seed_agent_run(&mut conn, &project.id, &actor_id);
    let _ = actor_id;

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task {
            title: "weird: title * with (parens) - and a dash".to_string(),
            description: None,
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("staging an FTS5-syntax-heavy title must not error");

    assert!(proposal.duplicate_of.is_none());
    assert!(proposal.duplicate_score.is_none());
}

#[test]
fn amend_proposal_rescores_the_amended_content_and_never_flags_its_own_row() {
    let (mut conn, actor_id, project_id, run_id) = seed_staging_fixture();
    let _ = project_id;

    // Stage a proposal with unrelated content — not yet flagged.
    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "Add a tooltip for the priority icons".to_string(), description: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");
    assert!(proposal.duplicate_of.is_none(), "fixture setup: initial content must not be flagged");

    // Amend it to restate the fixture's own canonical open task — the amend must re-score and
    // flag it now.
    let amended = amend_proposal(
        &mut conn,
        &proposal.id,
        &actor_id,
        ProposalPayload::Task {
            title: RETRY_BUDGET_NEAR_DUP_TITLE.to_string(),
            description: Some(RETRY_BUDGET_NEAR_DUP_BODY.to_string()),
        },
    )
    .expect("amend_proposal should succeed");
    assert!(
        amended.proposal.duplicate_of.is_some(),
        "amending to restate an open task must flag the amended row"
    );

    // Re-amend to the EXACT SAME content the row already carries. If the exclusion of the
    // proposal's own id were broken, the row would now match ITSELF (identical text scores
    // maximally well) — assert it never does.
    let reamended = amend_proposal(
        &mut conn,
        &proposal.id,
        &actor_id,
        ProposalPayload::Task {
            title: RETRY_BUDGET_NEAR_DUP_TITLE.to_string(),
            description: Some(RETRY_BUDGET_NEAR_DUP_BODY.to_string()),
        },
    )
    .expect("re-amending to unchanged content should succeed");
    assert_ne!(
        reamended.proposal.duplicate_of.as_deref(),
        Some(proposal.id.as_str()),
        "a proposal must never be flagged as its own duplicate"
    );
    // The canonical open task is still the best real match and must still be found.
    assert!(
        reamended.proposal.duplicate_of.is_some(),
        "excluding the proposal's own row must not suppress a genuine match against a different row"
    );
}

/// Structural gate: `create_proposal_in_tx` must write `duplicate_of`/`duplicate_score` ONLY
/// through its own INSERT — never through a follow-up `UPDATE`. `amend_proposal`'s own,
/// pre-existing `UPDATE` (which legitimately re-scores on amend) is the one allowed exception,
/// matched by name so this gate does not have to parse Rust function boundaries.
#[test]
fn create_proposal_in_tx_never_issues_a_follow_up_update_for_duplicate_columns() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/domain/authoring_proposal.rs"),
    )
    .expect("reading authoring_proposal.rs should succeed");

    let offending_lines: Vec<&str> = source
        .lines()
        .map(str::trim_start)
        .filter(|line| !line.starts_with("//"))
        .filter(|line| line.contains("UPDATE") && line.contains("duplicate_of"))
        .collect();

    // Exactly one line may set duplicate_of via UPDATE: amend_proposal's own statement (which also
    // sets duplicate_score and payload in the same statement).
    assert_eq!(
        offending_lines.len(),
        1,
        "expected exactly one UPDATE statement naming duplicate_of (amend_proposal's own), found: {offending_lines:?}"
    );
    assert!(
        offending_lines[0].contains("duplicate_score"),
        "the one allowed UPDATE must be amend_proposal's own (sets both duplicate columns together): {:?}",
        offending_lines[0]
    );
}

/// Structural gate: `duplicate_candidate_for` is called from exactly two sites in this module —
/// `create_proposal_in_tx` (staging) and `amend_proposal` (re-scoring) — never a third, driftable
/// call site recomputing the flag somewhere else (D-107's "never on read").
#[test]
fn duplicate_candidate_for_is_called_from_exactly_two_sites() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/domain/authoring_proposal.rs"),
    )
    .expect("reading authoring_proposal.rs should succeed");

    let call_count = source
        .lines()
        .map(str::trim_start)
        .filter(|line| !line.starts_with("//"))
        .filter(|line| line.contains("duplicate_candidate_for("))
        .count();

    assert_eq!(
        call_count, 2,
        "expected exactly two call sites (create_proposal_in_tx + amend_proposal), found {call_count}"
    );
}

#[test]
fn staging_flags_a_proposal_restating_an_existing_open_epic() {
    let (mut conn, actor_id, project) = seeded_project();
    let run_id = seed_agent_run(&mut conn, &project.id, &actor_id);
    seed_filler(&mut conn, &project.id, &actor_id, &run_id, FILLER_TITLES.len());
    create_epic(
        &mut conn,
        &project.id,
        &actor_id,
        "Migrate the board to virtualization for large lists",
        Some("Board rendering slows down past a thousand rows because every row mounts a full DOM node."),
    )
    .expect("canonical create_epic should succeed");

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Epic {
            title: "Board list needs virtualization to handle large row counts".to_string(),
            description: Some(
                "Rendering slows down badly once the board has over a thousand rows since every row mounts a full DOM node."
                    .to_string(),
            ),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");

    assert!(proposal.duplicate_of.is_some(), "restating an open epic must write duplicate_of");
    assert!(proposal.duplicate_score.is_some());
}

#[test]
fn staging_flags_a_proposal_restating_an_existing_open_issue() {
    let (mut conn, actor_id, project) = seeded_project();
    let run_id = seed_agent_run(&mut conn, &project.id, &actor_id);
    seed_filler(&mut conn, &project.id, &actor_id, &run_id, FILLER_TITLES.len());
    create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Flaky CI job fails intermittently on the search suite",
        Some("The search_filter test suite fails roughly one run in twenty with a timing-dependent assertion."),
        "bug",
        IssueParent::None,
    )
    .expect("canonical create_issue should succeed");

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Issue {
            title: "Search suite intermittently fails in CI".to_string(),
            body: Some(
                "About one run in twenty, the search_filter test suite fails because of a timing-dependent assertion."
                    .to_string(),
            ),
            issue_kind: "bug".to_string(),
        },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal should succeed");

    assert!(proposal.duplicate_of.is_some(), "restating an open issue must write duplicate_of");
    assert!(proposal.duplicate_score.is_some());
}
