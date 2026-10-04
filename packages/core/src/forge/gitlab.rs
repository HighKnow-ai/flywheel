//! The GitLab CLI adapter (D-117) — the second of two independent adapters in `forge/` that must
//! never be written against the other's shape (Pitfall 1). This file never reads a GitHub-shaped
//! field (`statusCheckRollup`, `reviewDecision`) and never shells out to any CLI but GitLab's own.
//!
//! GitLab needs TWO subprocesses where GitHub needs one: `mr list` to find the newest matching
//! merge request's `iid`, then `mr view <iid>` for `head_pipeline`, which the list form does not
//! carry. The asymmetry is real, not an oversight — D-116's "network cost is decoupled from the
//! tick rate" makes the extra call affordable, since every forge read already lives on its own
//! slow cadence.
//!
//! The mapping table this module implements: `state == "merged"` → [`ForgeState::Merged`];
//! `"closed"` → [`ForgeState::ClosedUnmerged`]; `"opened"` → [`ForgeState::Open`]; anything else
//! → [`ForgeState::None`]. GitLab exposes no single review-decision field, so
//! [`ForgeState::ChangesRequested`] is unreachable on this arm by design, not by omission. CI:
//! `head_pipeline` null (or absent) → [`CiResult::None`]; `status` of `"failed"`/`"canceled"` →
//! [`CiResult::Failed`]; `"running"`/`"pending"`/`"created"` → [`CiResult::Pending`];
//! `"success"`/`"skipped"` → [`CiResult::Passed`]; any other value → [`CiResult::None`] (a
//! renamed status shows as a missing pill rather than a wrong one — RESEARCH.md assumption A1).
//!
//! Every field is read defensively off a `serde_json::Value`, never a typed `Deserialize`
//! struct — identical discipline to `github.rs`.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

use crate::forge::request_body::RequestDraft;
use crate::forge::{CiResult, ForgeError, ForgeRequest, ForgeState};

/// The ONE `glab` process construction site in this file. Both [`run_glab`] and the auth-status
/// confirmation it makes on a non-zero exit call through here.
fn spawn_glab(repo_path: &Path, args: &[&str]) -> std::io::Result<Output> {
    Command::new("glab").current_dir(repo_path).args(args).output()
}

fn looks_like_auth_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("auth") || lower.contains("not logged in") || lower.contains("401")
}

fn glab_auth_status_ok(repo_path: &Path) -> bool {
    spawn_glab(repo_path, &["auth", "status"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Run GitLab's CLI with `args` in `repo_path`, returning raw stdout bytes on success. Error
/// mapping mirrors `github.rs`'s `run_gh` exactly: spawn `NotFound` → `CliNotInstalled`, a
/// non-zero exit whose stderr looks auth-related AND is confirmed by a failing follow-up
/// `auth status` → `CliNotAuthenticated`, anything else → `CliFailed` carrying stderr.
fn run_glab(repo_path: &Path, args: &[&str]) -> Result<Vec<u8>, ForgeError> {
    let output = match spawn_glab(repo_path, args) {
        Ok(output) => output,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(ForgeError::CliNotInstalled { cli: "glab" });
        }
        Err(e) => return Err(ForgeError::CliFailed { cli: "glab", stderr: e.to_string() }),
    };

    if output.status.success() {
        return Ok(output.stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if looks_like_auth_error(&stderr) && !glab_auth_status_ok(repo_path) {
        return Err(ForgeError::CliNotAuthenticated { cli: "glab" });
    }
    Err(ForgeError::CliFailed { cli: "glab", stderr })
}

/// Select the newest entry of a `mr list`-shaped JSON array by its `created_at` field
/// (lexicographic order on an RFC3339 timestamp is chronological order) — shared by
/// [`request_for_branch`]'s live selection and [`normalize`]'s fixture-driven selection, so the
/// two never pick different elements for the same input.
fn newest_by_created_at(array: &[Value]) -> Option<&Value> {
    array.iter().max_by_key(|entry| {
        entry.get("created_at").and_then(Value::as_str).unwrap_or("").to_string()
    })
}

/// The two-subprocess read: `mr list` to find the newest MR's `iid`, then `mr view <iid>` for
/// `head_pipeline`. A list with no `iid` field (defensively handled, should not occur in
/// practice) skips the view call and lets [`normalize`] degrade `head_pipeline` to absent.
pub fn request_for_branch(repo_path: &Path, branch: &str) -> Result<Option<ForgeRequest>, ForgeError> {
    let list_raw = run_glab(repo_path, &["mr", "list", "--source-branch", branch, "-F", "json"])?;

    let list_value: Value = serde_json::from_slice(&list_raw)
        .map_err(|e| ForgeError::MalformedJson { cli: "glab", detail: e.to_string() })?;
    let array = list_value.as_array().cloned().unwrap_or_default();
    let iid = newest_by_created_at(&array).and_then(|entry| entry.get("iid")).and_then(Value::as_i64);

    let view_raw = match iid {
        Some(iid) => {
            let iid_str = iid.to_string();
            run_glab(repo_path, &["mr", "view", &iid_str, "-F", "json"])?
        }
        None => Vec::new(),
    };

    normalize(&list_raw, &view_raw)
}

/// Normalise one `mr list` response plus (when available) its matching `mr view` response into
/// at most one [`ForgeRequest`] — no subprocess, no network, hermetic against fixtures. A
/// non-array or empty `list_raw` array is `Ok(None)`, never an error. `view_raw` may be empty
/// (the live-arm's "no `iid` found" case or a fixture that only exercises the list half) — an
/// empty `view_raw` degrades `head_pipeline` to absent, i.e. [`CiResult::None`], never a parse
/// error.
pub fn normalize(list_raw: &[u8], view_raw: &[u8]) -> Result<Option<ForgeRequest>, ForgeError> {
    let list_value: Value = serde_json::from_slice(list_raw)
        .map_err(|e| ForgeError::MalformedJson { cli: "glab", detail: e.to_string() })?;
    let Some(array) = list_value.as_array() else {
        return Ok(None);
    };
    if array.is_empty() {
        return Ok(None);
    }
    let newest = newest_by_created_at(array).expect("array is non-empty, checked above");

    let state_raw = newest.get("state").and_then(Value::as_str).unwrap_or("");
    let state = match state_raw {
        "merged" => ForgeState::Merged,
        "closed" => ForgeState::ClosedUnmerged,
        "opened" => ForgeState::Open,
        _ => ForgeState::None,
    };

    let view_value: Option<Value> = if view_raw.is_empty() {
        None
    } else {
        Some(
            serde_json::from_slice(view_raw)
                .map_err(|e| ForgeError::MalformedJson { cli: "glab", detail: e.to_string() })?,
        )
    };

    // `head_pipeline` is `null` when no pipeline has run against the head SHA — treated
    // identically to "the key is absent": both degrade to `CiResult::None`, never a parse error.
    let head_pipeline =
        view_value.as_ref().and_then(|v| v.get("head_pipeline")).filter(|p| !p.is_null());
    let ci = match head_pipeline {
        None => CiResult::None,
        Some(pipeline) => {
            let status = pipeline.get("status").and_then(Value::as_str).unwrap_or("");
            match status {
                "failed" | "canceled" => CiResult::Failed,
                "running" | "pending" | "created" => CiResult::Pending,
                "success" | "skipped" => CiResult::Passed,
                _ => CiResult::None,
            }
        }
    };
    let ci_url =
        head_pipeline.and_then(|p| p.get("web_url")).and_then(Value::as_str).map(str::to_string);

    Ok(Some(ForgeRequest {
        state,
        ci,
        number: newest.get("iid").and_then(Value::as_i64).unwrap_or(0),
        title: newest.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
        url: newest.get("web_url").and_then(Value::as_str).unwrap_or("").to_string(),
        ci_url,
        // Neither `mr list` nor `mr view`'s fields this module reads carry a draft flag.
        is_draft: false,
        target_branch: view_value
            .as_ref()
            .and_then(|v| v.get("target_branch"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }))
}

/// Build the `glab mr create` argument vector for `draft` given the path the description was
/// already written to — pure, no I/O, so a test can assert the exact argv [`create_request`]
/// builds without spawning `glab`. The body itself is never an element of this vector
/// (T-07-09-01/T-07-09-02): only the path it was written to is. `--yes` so the call never blocks
/// on an interactive prompt inside this background-capable process. `pub` (rather than
/// crate-private) solely so `tests/forge_normalize.rs`, an external integration-test binary, can
/// assert on it hermetically without spawning `glab`.
pub fn create_request_args(draft: &RequestDraft, description_path: &str) -> Vec<String> {
    vec![
        "mr".to_string(),
        "create".to_string(),
        "--source-branch".to_string(),
        draft.head_branch.clone(),
        "--target-branch".to_string(),
        draft.target_branch.clone(),
        "--title".to_string(),
        draft.title.clone(),
        "--description-file".to_string(),
        description_path.to_string(),
        "--yes".to_string(),
    ]
}

/// Write `body` to a fresh owner-only (unix `0o600`) temporary file and return it — factored out
/// of [`create_request`] so `tests/forge_normalize.rs`, an external integration-test binary, can
/// assert the body survives this exact write byte-for-byte without spawning `glab` at all.
/// `pub` for that reason alone.
pub fn write_description_tempfile(body: &str) -> Result<tempfile::NamedTempFile, ForgeError> {
    let mut tmp = tempfile::NamedTempFile::new().map_err(|e| ForgeError::CliFailed {
        cli: "glab",
        stderr: format!("failed to create a temporary file for the description: {e}"),
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = tmp.as_file().set_permissions(std::fs::Permissions::from_mode(0o600)) {
            return Err(ForgeError::CliFailed {
                cli: "glab",
                stderr: format!("failed to restrict the description temp file's permissions: {e}"),
            });
        }
    }

    tmp.write_all(body.as_bytes()).map_err(|e| ForgeError::CliFailed {
        cli: "glab",
        stderr: format!("failed to write the description to a temp file: {e}"),
    })?;

    Ok(tmp)
}

/// Open a merge request on GitLab (D-118) by writing `draft.body` to an owner-only temporary
/// file and passing its path — `glab mr create` has no stdin-reading form, unlike `gh pr
/// create`'s `--body-file -` (the same reasoning `credentials.rs` records against passing a
/// secret where a process listing would disclose it, applied here to the body instead). The
/// temporary file is removed before this function returns, on every path — success or error —
/// because its binding's scope ends (via an explicit `drop`) before the result is evaluated.
/// Pushes no branch and runs no `git` of any kind: a branch the forge does not have yet is
/// `glab`'s own error, surfaced below as [`ForgeError::CliFailed`]. Reads the created request
/// back through this adapter's own [`request_for_branch`] so the returned [`ForgeRequest`]
/// carries the forge's own view of state, number and CI rather than being assumed.
pub fn create_request(repo_path: &Path, draft: &RequestDraft) -> Result<ForgeRequest, ForgeError> {
    let tmp = write_description_tempfile(&draft.body)?;
    let path = tmp.path().to_string_lossy().into_owned();

    let args = create_request_args(draft, &path);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let create_result = run_glab(repo_path, &args_ref);

    // Remove the temp file now, before this function returns down either path below.
    drop(tmp);

    create_result?;

    request_for_branch(repo_path, &draft.head_branch)?.ok_or_else(|| ForgeError::CliFailed {
        cli: "glab",
        stderr: format!(
            "glab mr create reported success but no request was found for branch {:?} afterward",
            draft.head_branch
        ),
    })
}
