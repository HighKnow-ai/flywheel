//! LINK-05/LINK-06: proves `forge::github::normalize` and `forge::gitlab::normalize` against
//! frozen fixtures of real CLI output (`tests/fixtures/forge/`) plus a handful of inline JSON
//! literals for scenarios no single named fixture covers (the permutation test, the two
//! wrong-JSON-type degradation tests, and the two-requests-select-newest tests). No subprocess,
//! no network — both `normalize` functions take raw bytes directly, so this suite is hermetic.
//!
//! The three GitLab fixtures are each shaped like a real `glab mr view <iid> -F json` response
//! (the richer of the two GitLab shapes — it carries every field `gitlab::normalize` reads from
//! either half, including `state`/`iid`/`title`/`web_url`/`created_at`, which also appear
//! verbatim in a real `glab mr list` response). [`wrap_as_list`] wraps that same content in a
//! JSON array to stand in for the `mr list` half, so one fixture file drives both arguments to
//! `gitlab::normalize` without inventing a second, redundant file per scenario.

use std::fs;

use core::forge::{github, gitlab, CiResult, ForgeState};

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/tests/fixtures/forge/{name}.json", env!("CARGO_MANIFEST_DIR"));
    fs::read(&path).unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"))
}

fn wrap_as_list(view_json: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(view_json.len() + 2);
    out.push(b'[');
    out.extend_from_slice(view_json);
    out.push(b']');
    out
}

// ---------------------------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------------------------

#[test]
fn github_merged_regardless_of_closed_at_yields_merged() {
    let raw = fixture("gh-pr-merged");
    let request =
        github::normalize(&raw).expect("normalize should succeed").expect("expected a request");
    assert_eq!(request.state, ForgeState::Merged);
}

#[test]
fn github_empty_array_yields_no_request() {
    let raw = fixture("gh-pr-empty");
    let result = github::normalize(&raw).expect("normalize should succeed");
    assert!(result.is_none());
}

#[test]
fn github_all_skipped_rollup_yields_passed() {
    let raw = br#"[{
        "number": 9, "state": "OPEN", "url": "https://github.com/acme/widget/pull/9",
        "title": "x", "isDraft": false, "reviewDecision": "", "mergedAt": null, "closedAt": null,
        "baseRefName": "main", "createdAt": "2026-09-01T00:00:00Z",
        "statusCheckRollup": [
            {"conclusion": "SKIPPED", "status": "COMPLETED"},
            {"conclusion": "SKIPPED", "status": "COMPLETED"}
        ]
    }]"#;
    let request =
        github::normalize(raw).expect("normalize should succeed").expect("expected a request");
    assert_eq!(request.ci, CiResult::Passed);
}

#[test]
fn github_empty_status_check_rollup_yields_no_ci() {
    // gh-pr-merged.json's statusCheckRollup is [] — an empty rollup, not a missing one.
    let raw = fixture("gh-pr-merged");
    let request =
        github::normalize(&raw).expect("normalize should succeed").expect("expected a request");
    assert_eq!(request.ci, CiResult::None);
}

#[test]
fn github_failure_anywhere_in_rollup_yields_failed_across_permutations() {
    let make = |order: [&str; 3]| -> Vec<u8> {
        let checks: Vec<String> = order
            .iter()
            .map(|c| format!(r#"{{"conclusion": "{c}", "status": "COMPLETED"}}"#))
            .collect();
        format!(
            r#"[{{"number": 1, "state": "OPEN", "url": "u", "title": "t", "isDraft": false,
            "reviewDecision": "", "mergedAt": null, "closedAt": null, "baseRefName": "main",
            "createdAt": "2026-09-01T00:00:00Z", "statusCheckRollup": [{}]}}]"#,
            checks.join(",")
        )
        .into_bytes()
    };
    let permutations = [
        ["FAILURE", "SUCCESS", "SUCCESS"],
        ["SUCCESS", "FAILURE", "SUCCESS"],
        ["SUCCESS", "SUCCESS", "FAILURE"],
    ];
    for order in permutations {
        let raw = make(order);
        let request = github::normalize(&raw)
            .expect("normalize should succeed")
            .expect("expected a request");
        assert_eq!(request.ci, CiResult::Failed, "order {order:?} should yield Failed");
    }
}

#[test]
fn github_open_with_changes_requested_yields_changes_requested() {
    let raw = fixture("gh-pr-changes-requested-ci-failing");
    let request =
        github::normalize(&raw).expect("normalize should succeed").expect("expected a request");
    assert_eq!(request.state, ForgeState::ChangesRequested);
    assert_eq!(request.ci, CiResult::Failed);
}

#[test]
fn github_non_string_state_degrades_to_none_without_panicking() {
    let raw = br#"[{"number": 1, "state": 42, "url": "u", "title": "t", "isDraft": false,
        "reviewDecision": "", "mergedAt": null, "closedAt": null, "baseRefName": "main",
        "createdAt": "2026-09-01T00:00:00Z", "statusCheckRollup": []}]"#;
    let request =
        github::normalize(raw).expect("normalize should succeed").expect("expected a request");
    assert_eq!(request.state, ForgeState::None);
}

#[test]
fn github_two_requests_select_newest_deterministically() {
    let raw = br#"[
        {"number": 1, "state": "OPEN", "url": "u1", "title": "older", "isDraft": false,
         "reviewDecision": "", "mergedAt": null, "closedAt": null, "baseRefName": "main",
         "createdAt": "2026-01-01T00:00:00Z", "statusCheckRollup": []},
        {"number": 2, "state": "OPEN", "url": "u2", "title": "newer", "isDraft": false,
         "reviewDecision": "", "mergedAt": null, "closedAt": null, "baseRefName": "main",
         "createdAt": "2026-06-01T00:00:00Z", "statusCheckRollup": []}
    ]"#;
    let first =
        github::normalize(raw).expect("normalize should succeed").expect("expected a request");
    let second =
        github::normalize(raw).expect("normalize should succeed").expect("expected a request");
    assert_eq!(first.title, "newer");
    assert_eq!(first, second, "two consecutive calls must select the same element");
}

// ---------------------------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------------------------

#[test]
fn gitlab_null_head_pipeline_yields_no_ci_not_failed() {
    let view = fixture("glab-mr-merged-no-pipeline");
    let list = wrap_as_list(&view);
    let request = gitlab::normalize(&list, &view)
        .expect("normalize should succeed")
        .expect("expected a request");
    assert_eq!(request.ci, CiResult::None);
    assert_eq!(request.state, ForgeState::Merged);
}

#[test]
fn gitlab_opened_with_running_pipeline_yields_open_and_pending() {
    let view = fixture("glab-mr-open-ci-running");
    let list = wrap_as_list(&view);
    let request = gitlab::normalize(&list, &view)
        .expect("normalize should succeed")
        .expect("expected a request");
    assert_eq!(request.state, ForgeState::Open);
    assert_eq!(request.ci, CiResult::Pending);
}

#[test]
fn gitlab_closed_yields_closed_unmerged() {
    let view = fixture("glab-mr-closed");
    let list = wrap_as_list(&view);
    let request = gitlab::normalize(&list, &view)
        .expect("normalize should succeed")
        .expect("expected a request");
    assert_eq!(request.state, ForgeState::ClosedUnmerged);
}

#[test]
fn gitlab_non_string_state_degrades_to_none_without_panicking() {
    let list = br#"[{"iid": 1, "state": 7, "title": "t", "web_url": "u",
        "created_at": "2026-09-01T00:00:00.000Z"}]"#;
    let view: &[u8] = b"";
    let request = gitlab::normalize(list, view)
        .expect("normalize should succeed")
        .expect("expected a request");
    assert_eq!(request.state, ForgeState::None);
}

#[test]
fn gitlab_two_requests_select_newest_deterministically() {
    let list = br#"[
        {"iid": 1, "state": "opened", "title": "older", "web_url": "u1",
         "created_at": "2026-01-01T00:00:00.000Z"},
        {"iid": 2, "state": "opened", "title": "newer", "web_url": "u2",
         "created_at": "2026-06-01T00:00:00.000Z"}
    ]"#;
    let view: &[u8] = b"";
    let first = gitlab::normalize(list, view)
        .expect("normalize should succeed")
        .expect("expected a request");
    let second = gitlab::normalize(list, view)
        .expect("normalize should succeed")
        .expect("expected a request");
    assert_eq!(first.title, "newer");
    assert_eq!(first, second, "two consecutive calls must select the same element");
}
