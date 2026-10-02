//! The GitHub CLI adapter (D-117) — one of two independent adapters in `forge/` that must never
//! be written against the other's shape (Pitfall 1: GitHub's and GitLab's JSON are structurally
//! unrelated, and a normaliser written against one silently misclassifies the other). This file
//! never reads a GitLab-shaped field and never shells out to any CLI but `gh`.
//!
//! The mapping table this module implements (`07-CONTEXT.md`/`07-03-PLAN.md` `<decisions_resolved>`):
//! `state == "MERGED"` → [`ForgeState::Merged`] regardless of `closedAt`; `"CLOSED"` →
//! [`ForgeState::ClosedUnmerged`]; `"OPEN"` with `reviewDecision == "CHANGES_REQUESTED"` →
//! [`ForgeState::ChangesRequested`]; `"OPEN"` otherwise → [`ForgeState::Open`]; anything else (no
//! request, or an unrecognised/malformed `state`) → [`ForgeState::None`]. CI: an empty
//! `statusCheckRollup` → [`CiResult::None`]; any `conclusion` of `"FAILURE"`, `"TIMED_OUT"` or
//! `"CANCELLED"` → [`CiResult::Failed`]; else any check whose `status != "COMPLETED"` →
//! [`CiResult::Pending`]; else → [`CiResult::Passed`] (so an all-`"SKIPPED"` rollup is Passed).
//!
//! Every field is read defensively off a `serde_json::Value` — `.get(...).and_then(Value::as_str
//! /as_i64/as_bool)` with a defined fallback — never a typed `Deserialize` struct, following
//! `query/events.rs`'s own `row_to_event` precedent: a future `gh` version changing a field's type
//! degrades to a safe default, never panics and never silently reports a wrong definite value.

use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

use crate::forge::{CiResult, ForgeError, ForgeRequest, ForgeState};

/// The ONE `gh` process construction site in this file (PROC-02's sibling discipline for forge
/// CLIs). Both [`run_gh`] and the auth-status confirmation it makes on a non-zero exit call
/// through here — never a second construction site.
fn spawn_gh(repo_path: &Path, args: &[&str]) -> std::io::Result<Output> {
    // `.current_dir(repo_path)` so `gh` resolves the repository from the worktree rather than
    // from any ambient process directory (`supervisor_cwd.rs`'s own discipline, extended here to
    // a non-git CLI).
    Command::new("gh").current_dir(repo_path).args(args).output()
}

/// A rough, conservative heuristic for "this stderr describes an authentication problem" — never
/// the sole signal (see [`run_gh`]'s follow-up `gh auth status` confirmation), only the trigger
/// for checking.
fn looks_like_auth_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("auth") || lower.contains("not logged in") || lower.contains("401")
}

fn gh_auth_status_ok(repo_path: &Path) -> bool {
    spawn_gh(repo_path, &["auth", "status"]).map(|output| output.status.success()).unwrap_or(false)
}

/// Run `gh <args>` in `repo_path`, returning raw stdout bytes on success. A spawn error of kind
/// `NotFound` is [`ForgeError::CliNotInstalled`]; a non-zero exit whose stderr looks
/// auth-related, CONFIRMED by a follow-up `gh auth status` invocation also failing, is
/// [`ForgeError::CliNotAuthenticated`]; any other non-zero exit is [`ForgeError::CliFailed`]
/// carrying stderr.
fn run_gh(repo_path: &Path, args: &[&str]) -> Result<Vec<u8>, ForgeError> {
    let output = match spawn_gh(repo_path, args) {
        Ok(output) => output,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(ForgeError::CliNotInstalled { cli: "gh" });
        }
        Err(e) => return Err(ForgeError::CliFailed { cli: "gh", stderr: e.to_string() }),
    };

    if output.status.success() {
        return Ok(output.stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if looks_like_auth_error(&stderr) && !gh_auth_status_ok(repo_path) {
        return Err(ForgeError::CliNotAuthenticated { cli: "gh" });
    }
    Err(ForgeError::CliFailed { cli: "gh", stderr })
}

/// The one GitHub subprocess this adapter needs (GitLab's equivalent needs two — see
/// `gitlab.rs`'s own header comment). Fields requested mirror RESEARCH.md's live-probed shape.
pub fn request_for_branch(repo_path: &Path, branch: &str) -> Result<Option<ForgeRequest>, ForgeError> {
    let raw = run_gh(
        repo_path,
        &[
            "pr",
            "list",
            "--head",
            branch,
            "--state",
            "all",
            "--limit",
            "5",
            "--json",
            "number,state,url,title,isDraft,reviewDecision,mergedAt,closedAt,baseRefName,createdAt,statusCheckRollup",
        ],
    )?;
    normalize(&raw)
}

/// Fold `statusCheckRollup`'s elements into one [`CiResult`] — a reduction over the collection
/// with no index arithmetic and no reliance on element order: two `.any()` passes (failed, then
/// pending), each order-independent by construction, so a permutation of the same array always
/// yields the same result.
fn fold_ci(checks: &[Value]) -> CiResult {
    if checks.is_empty() {
        return CiResult::None;
    }
    let any_failed = checks.iter().any(|check| {
        matches!(
            check.get("conclusion").and_then(Value::as_str).unwrap_or(""),
            "FAILURE" | "TIMED_OUT" | "CANCELLED"
        )
    });
    if any_failed {
        return CiResult::Failed;
    }
    let any_pending = checks
        .iter()
        .any(|check| check.get("status").and_then(Value::as_str).unwrap_or("") != "COMPLETED");
    if any_pending {
        return CiResult::Pending;
    }
    CiResult::Passed
}

/// Normalise one `gh pr list --json ...` response (a JSON array) into at most one
/// [`ForgeRequest`] — no subprocess, no network, hermetic against a fixture. A non-array or empty
/// array is `Ok(None)`, never an error (an empty result is not malformed JSON). Among multiple
/// requests for the same source branch, the element with the lexicographically-newest `createdAt`
/// (an RFC3339 timestamp, so lexicographic order is chronological order) is selected — ties are
/// resolved deterministically by `Iterator::max_by_key` (the last maximum), so two calls on the
/// same input always select the same element.
pub fn normalize(raw: &[u8]) -> Result<Option<ForgeRequest>, ForgeError> {
    let value: Value = serde_json::from_slice(raw)
        .map_err(|e| ForgeError::MalformedJson { cli: "gh", detail: e.to_string() })?;

    let Some(array) = value.as_array() else {
        return Ok(None);
    };
    if array.is_empty() {
        return Ok(None);
    }

    let newest = array
        .iter()
        .max_by_key(|entry| entry.get("createdAt").and_then(Value::as_str).unwrap_or("").to_string())
        .expect("array is non-empty, checked above");

    let state_raw = newest.get("state").and_then(Value::as_str).unwrap_or("");
    let review_decision = newest.get("reviewDecision").and_then(Value::as_str).unwrap_or("");
    let state = match state_raw {
        "MERGED" => ForgeState::Merged,
        "CLOSED" => ForgeState::ClosedUnmerged,
        "OPEN" if review_decision == "CHANGES_REQUESTED" => ForgeState::ChangesRequested,
        "OPEN" => ForgeState::Open,
        _ => ForgeState::None,
    };

    let rollup = newest.get("statusCheckRollup").and_then(Value::as_array);
    let ci = rollup.map(|checks| fold_ci(checks)).unwrap_or(CiResult::None);
    let ci_url = rollup
        .and_then(|checks| checks.first())
        .and_then(|check| check.get("detailsUrl"))
        .and_then(Value::as_str)
        .map(str::to_string);

    Ok(Some(ForgeRequest {
        state,
        ci,
        number: newest.get("number").and_then(Value::as_i64).unwrap_or(0),
        title: newest.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
        url: newest.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
        ci_url,
        is_draft: newest.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        target_branch: newest.get("baseRefName").and_then(Value::as_str).unwrap_or("").to_string(),
    }))
}
