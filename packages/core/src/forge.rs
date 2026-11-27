//! The forge a project's remote lives on, and the one thing Flywheel asks of it: a request (a pull
//! request or a merge request) for a Story's branch, and that request's state (ADR 0042).
//!
//! The forge is found from the URL of `origin`; a project setting can name it when the host is not
//! `github.com` or `gitlab.com`. The work is done by the forge's own CLI (`gh`, `glab`), signed in
//! by the developer. Flywheel stores no forge token and calls no forge API itself.
//!
//! Every failure is a [`ForgeError`] whose text is the sentence the developer reads. Nothing here
//! falls back to a local merge: a missing or signed-out CLI is an error to act on, not a reason to
//! write a commit the repository cannot take.
//!
//! Both forges are built. GitHub goes through `gh pr ...`, GitLab through `glab mr ...`. The `glab`
//! calls are pinned by the stub in `tests/story_landing.rs`, not yet measured against a real `glab`
//! (ADR 0042, Consequences). A self-hosted GitLab is reached by `GITLAB_HOST`, which is the host of
//! the repository's `origin` (see [`ForgeCli::run_cli`]).

use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::login_path::find_on_path;
use crate::proc::{output_with_timeout, FORGE_CLI_TIMEOUT_SECS};

/// A forge Flywheel knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Forge {
    Github,
    Gitlab,
}

impl Forge {
    pub fn as_str(self) -> &'static str {
        match self {
            Forge::Github => "github",
            Forge::Gitlab => "gitlab",
        }
    }

    pub fn parse(value: &str) -> Option<Forge> {
        match value {
            "github" => Some(Forge::Github),
            "gitlab" => Some(Forge::Gitlab),
            _ => None,
        }
    }

    /// The CLI that talks to this forge.
    pub fn cli(self) -> &'static str {
        match self {
            Forge::Github => "gh",
            Forge::Gitlab => "glab",
        }
    }

    /// What the forge calls a request.
    pub fn request_word(self) -> &'static str {
        match self {
            Forge::Github => "pull request",
            Forge::Gitlab => "merge request",
        }
    }
}

/// The host of a git remote URL, lower case: `https://user@github.com/o/r.git`,
/// `ssh://git@github.com:22/o/r.git` and `git@github.com:o/r.git` all give `github.com`.
fn host_of(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = match url.split_once("://") {
        Some((_, rest)) => rest,
        None => url,
    };
    // The authority ends at the first `/`, and for the scp-like form (`host:path`) at the first `:`.
    let authority = rest.split('/').next().unwrap_or(rest);
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    let host = authority.split(':').next().unwrap_or(authority);
    let host = host.trim().to_lowercase();
    (!host.is_empty()).then_some(host)
}

/// The forge a remote URL names: `github.com` is GitHub and `gitlab.com` is GitLab, over HTTPS or
/// SSH. Any other host is `None`: a self-hosted GitLab is named by the project's `forge` setting,
/// never guessed from its host name.
pub fn detect_forge(remote_url: &str) -> Option<Forge> {
    match host_of(remote_url)?.as_str() {
        "github.com" | "www.github.com" => Some(Forge::Github),
        "gitlab.com" | "www.gitlab.com" => Some(Forge::Gitlab),
        _ => None,
    }
}

/// A request's state on the forge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestState {
    Open,
    Merged,
    Closed,
}

impl RequestState {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestState::Open => "open",
            RequestState::Merged => "merged",
            RequestState::Closed => "closed",
        }
    }
}

/// A request on the forge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub state: RequestState,
    pub url: String,
    /// The commit the forge made when it merged the request: the merge commit, or the squash or
    /// rebase result. `None` while the request is not merged, or when the forge names none.
    pub merge_commit: Option<String>,
}

/// A request Flywheel just opened, with the auto-merge step's own result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedRequest {
    pub url: String,
    /// `Some` when auto-merge could not be turned on: the request exists and waits for a human.
    pub auto_merge_problem: Option<String>,
}

/// Why a forge call did not give an answer. `Display` is the sentence the developer reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgeError {
    CliMissing(Forge),
    NotSignedIn(Forge),
    Failed(String),
}

impl fmt::Display for ForgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ForgeError::CliMissing(forge) => write!(
                f,
                "Landing needs the {} CLI (`{}`) and it is not installed or not on the PATH. Install it, then merge again.",
                forge_name(*forge),
                forge.cli()
            ),
            ForgeError::NotSignedIn(forge) => write!(
                f,
                "The {} CLI is not signed in. Run `{} auth login`, then merge again.",
                forge_name(*forge),
                forge.cli()
            ),
            ForgeError::Failed(reason) => f.write_str(reason),
        }
    }
}

impl std::error::Error for ForgeError {}

fn forge_name(forge: Forge) -> &'static str {
    match forge {
        Forge::Github => "GitHub",
        Forge::Gitlab => "GitLab",
    }
}

/// The last non-empty line of a CLI's output, cut to a length a notice can hold.
pub fn last_line(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let line = text
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("");
    line.chars().take(200).collect()
}

/// Runs the forge CLIs, found on `search_path`. Tests give it a directory of stub binaries; the
/// app gives it the process `PATH`, which the login shell's `PATH` replaced at start.
#[derive(Debug, Clone)]
pub struct ForgeCli {
    search_path: OsString,
}

impl ForgeCli {
    /// The process `PATH`, with the directories of `FLYWHEEL_FORGE_PATH` in front when it is set: the
    /// end-to-end harness's seam for a directory of stub `gh` binaries, which the login `PATH` the
    /// app adopts at start would otherwise hide, as `FLYWHEEL_CLAUDE_BIN` does for the agent.
    pub fn from_env() -> Self {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs: Vec<PathBuf> = std::env::var_os("FLYWHEEL_FORGE_PATH")
            .map(|extra| std::env::split_paths(&extra).collect())
            .unwrap_or_default();
        dirs.extend(std::env::split_paths(&path));
        Self {
            search_path: std::env::join_paths(dirs).unwrap_or(path),
        }
    }

    pub fn with_search_path(search_path: impl Into<OsString>) -> Self {
        Self {
            search_path: search_path.into(),
        }
    }

    fn run_cli(
        &self,
        forge: Forge,
        repo_path: &Path,
        args: &[&str],
    ) -> Result<std::process::Output, ForgeError> {
        let program: PathBuf =
            find_on_path(forge.cli(), &self.search_path).ok_or(ForgeError::CliMissing(forge))?;
        let mut cmd = Command::new(&program);
        // `glab` finds a self-hosted instance from `GITLAB_HOST`, and otherwise asks gitlab.com. The
        // host is the one `origin` names, so the project's own remote picks the instance. An `origin`
        // that is a path names no host, and the variable is left as it came.
        if forge == Forge::Gitlab {
            if let Some(host) = crate::git::remote_url(repo_path, "origin")
                .ok()
                .flatten()
                .and_then(|url| host_of(&url))
            {
                cmd.env("GITLAB_HOST", host);
            }
        }
        cmd.args(args)
            .current_dir(repo_path)
            .env("PATH", &self.search_path)
            .env("GH_PROMPT_DISABLED", "1")
            .env("NO_PROMPT", "1")
            .env("NO_COLOR", "1");
        output_with_timeout(
            &mut cmd,
            None,
            Duration::from_secs(FORGE_CLI_TIMEOUT_SECS),
            &format!("{} {}", forge.cli(), args.first().copied().unwrap_or("")),
        )
        .map_err(|e| {
            // The kind only: an OS error text can carry a path.
            ForgeError::Failed(format!(
                "The {} CLI could not run ({:?}).",
                forge.cli(),
                e.kind()
            ))
        })
    }

    /// One `gh` call, for the Issue mirror's adapter ([`crate::issue_forge`]).
    pub(crate) fn run_gh(
        &self,
        workdir: &Path,
        args: &[&str],
    ) -> Result<std::process::Output, ForgeError> {
        self.run_cli(Forge::Github, workdir, args)
    }

    /// Whether the CLI is installed and signed in. Nothing is written.
    pub fn ensure_ready(&self, forge: Forge, repo: &Path) -> Result<(), ForgeError> {
        let out = self.run_cli(forge, repo, &["auth", "status"])?;
        if out.status.success() {
            Ok(())
        } else {
            Err(ForgeError::NotSignedIn(forge))
        }
    }

    /// The request for `branch`, or `None` when the forge has none. Never matched by ancestry: the
    /// answer is the request's own state.
    pub fn request_for_branch(
        &self,
        forge: Forge,
        repo: &Path,
        branch: &str,
    ) -> Result<Option<Request>, ForgeError> {
        match forge {
            Forge::Github => self.github_request(repo, branch),
            Forge::Gitlab => self.gitlab_request(repo, branch),
        }
    }

    fn github_request(&self, repo: &Path, branch: &str) -> Result<Option<Request>, ForgeError> {
        let forge = Forge::Github;
        let out = self.run_cli(
            forge,
            repo,
            &["pr", "view", branch, "--json", "state,url,mergeCommit"],
        )?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).to_lowercase();
            if stderr.contains("no pull requests found") {
                return Ok(None);
            }
            if stderr.contains("gh auth login") || stderr.contains("authentication") {
                return Err(ForgeError::NotSignedIn(forge));
            }
            return Err(ForgeError::Failed(format!(
                "The GitHub CLI could not read the pull request: {}",
                last_line(&out.stderr)
            )));
        }
        let value: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|_| {
            ForgeError::Failed("The GitHub CLI answered with text that is not JSON.".into())
        })?;
        let state = match value.get("state").and_then(|s| s.as_str()) {
            Some("OPEN") => RequestState::Open,
            Some("MERGED") => RequestState::Merged,
            Some("CLOSED") => RequestState::Closed,
            other => {
                return Err(ForgeError::Failed(format!(
                "The GitHub CLI reported the pull request in a state Flywheel does not know ({}).",
                other.unwrap_or("none")
            )))
            }
        };
        let url = value
            .get("url")
            .and_then(|u| u.as_str())
            .unwrap_or_default()
            .to_string();
        let merge_commit = value
            .pointer("/mergeCommit/oid")
            .and_then(|o| o.as_str())
            .map(str::to_string);
        Ok(Some(Request {
            state,
            url,
            merge_commit,
        }))
    }

    /// The merge request for `branch`. `glab mr view <branch> --output json` answers `state`
    /// (`opened`, `merged`, `closed`, `locked`) and `web_url`. It may look only at open requests when
    /// it is given a branch, so a "no merge request" answer is asked again as
    /// `glab mr list --source-branch <branch> --all --output json`, whose first element is the newest.
    fn gitlab_request(&self, repo: &Path, branch: &str) -> Result<Option<Request>, ForgeError> {
        let forge = Forge::Gitlab;
        let out = self.run_cli(forge, repo, &["mr", "view", branch, "--output", "json"])?;
        let value: serde_json::Value = if out.status.success() {
            serde_json::from_slice(&out.stdout).map_err(|_| {
                ForgeError::Failed("The GitLab CLI answered with text that is not JSON.".into())
            })?
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr).to_lowercase();
            if stderr.contains("auth login") || stderr.contains("401") {
                return Err(ForgeError::NotSignedIn(forge));
            }
            if !stderr.contains("no merge request") && !stderr.contains("no open merge request") {
                return Err(ForgeError::Failed(format!(
                    "The GitLab CLI could not read the merge request: {}",
                    last_line(&out.stderr)
                )));
            }
            let listed = self.run_cli(
                forge,
                repo,
                &[
                    "mr",
                    "list",
                    "--source-branch",
                    branch,
                    "--all",
                    "--output",
                    "json",
                ],
            )?;
            if !listed.status.success() {
                return Err(ForgeError::Failed(format!(
                    "The GitLab CLI could not list the merge requests: {}",
                    last_line(&listed.stderr)
                )));
            }
            let all: serde_json::Value = serde_json::from_slice(&listed.stdout).map_err(|_| {
                ForgeError::Failed("The GitLab CLI answered with text that is not JSON.".into())
            })?;
            match all.as_array().and_then(|a| a.first()) {
                Some(first) => first.clone(),
                None => return Ok(None),
            }
        };
        let state = match value.get("state").and_then(|s| s.as_str()) {
            // `locked` is a request being merged right now.
            Some("opened") | Some("locked") => RequestState::Open,
            Some("merged") => RequestState::Merged,
            Some("closed") => RequestState::Closed,
            other => {
                return Err(ForgeError::Failed(format!(
                "The GitLab CLI reported the merge request in a state Flywheel does not know ({}).",
                other.unwrap_or("none")
            )))
            }
        };
        let url = value
            .get("web_url")
            .and_then(|u| u.as_str())
            .unwrap_or_default()
            .to_string();
        // `merge_commit_sha` is the merge commit; a squash merge has `squash_commit_sha`.
        let merge_commit = ["merge_commit_sha", "squash_commit_sha"]
            .iter()
            .filter_map(|k| value.get(*k).and_then(|v| v.as_str()))
            .find(|v| !v.is_empty())
            .map(str::to_string);
        Ok(Some(Request {
            state,
            url,
            merge_commit,
        }))
    }

    /// Open a request from `branch` into `base` and turn auto-merge on with `method`
    /// (`squash`, `merge` or `rebase`). An open request for the branch is reused, so a second Merge
    /// after a failed step does not open a second one.
    #[allow(clippy::too_many_arguments)]
    pub fn open_request(
        &self,
        forge: Forge,
        repo: &Path,
        base: &str,
        branch: &str,
        title: &str,
        body: &str,
        method: &str,
    ) -> Result<OpenedRequest, ForgeError> {
        let existing = self.request_for_branch(forge, repo, branch)?;
        let url = match existing {
            Some(Request {
                state: RequestState::Open,
                url,
                ..
            }) => url,
            _ => {
                let out = match forge {
                    Forge::Github => self.run_cli(
                        forge,
                        repo,
                        &[
                            "pr", "create", "--base", base, "--head", branch, "--title", title,
                            "--body", body,
                        ],
                    )?,
                    // `glab mr create` flags (glab 1.x): `--source-branch`, `--target-branch`,
                    // `--title`, `--description`, and `--yes` so it never prompts. The branch was
                    // pushed already, so `--push` is not given. The request's URL is its last line.
                    Forge::Gitlab => self.run_cli(
                        forge,
                        repo,
                        &[
                            "mr",
                            "create",
                            "--source-branch",
                            branch,
                            "--target-branch",
                            base,
                            "--title",
                            title,
                            "--description",
                            body,
                            "--yes",
                        ],
                    )?,
                };
                if !out.status.success() {
                    return Err(ForgeError::Failed(format!(
                        "The {} CLI could not open the {}: {}",
                        forge_name(forge),
                        forge.request_word(),
                        last_line(&out.stderr)
                    )));
                }
                last_line(&out.stdout)
            }
        };
        let merge_args: Vec<&str> = match forge {
            Forge::Github => {
                let flag = match method {
                    "merge" => "--merge",
                    "rebase" => "--rebase",
                    _ => "--squash",
                };
                vec!["pr", "merge", &url, "--auto", flag]
            }
            // `glab mr merge <branch> --auto-merge` merges when the pipeline succeeds (older glab
            // spelled it `--when-pipeline-succeeds`; `--auto-merge` is its default). `--squash` and
            // `--rebase` pick the method; the merge method has no flag. `--yes` skips the prompt.
            Forge::Gitlab => {
                let mut args = vec!["mr", "merge", branch, "--auto-merge"];
                match method {
                    "merge" => {}
                    "rebase" => args.push("--rebase"),
                    _ => args.push("--squash"),
                }
                args.push("--yes");
                args
            }
        };
        let auto_merge_problem = match self.run_cli(forge, repo, &merge_args) {
            Ok(out) if out.status.success() => None,
            Ok(out) => Some(format!(
                "Auto-merge could not be turned on ({}). Merge the {} on {}.",
                last_line(&out.stderr),
                forge.request_word(),
                forge_name(forge)
            )),
            Err(e) => Some(e.to_string()),
        };
        Ok(OpenedRequest {
            url,
            auto_merge_problem,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_detects_github_and_gitlab_over_https_and_ssh() {
        for (url, forge) in [
            ("https://github.com/acme/app.git", Some(Forge::Github)),
            (
                "https://user:token@github.com/acme/app",
                Some(Forge::Github),
            ),
            ("git@github.com:acme/app.git", Some(Forge::Github)),
            ("ssh://git@github.com/acme/app.git", Some(Forge::Github)),
            ("ssh://git@github.com:22/acme/app.git", Some(Forge::Github)),
            ("HTTPS://GitHub.com/acme/app", Some(Forge::Github)),
            ("https://gitlab.com/acme/app.git", Some(Forge::Gitlab)),
            ("git@gitlab.com:acme/sub/app.git", Some(Forge::Gitlab)),
            ("ssh://git@gitlab.com/acme/app.git", Some(Forge::Gitlab)),
        ] {
            assert_eq!(detect_forge(url), forge, "{url}");
        }
    }

    #[test]
    fn a_self_hosted_host_and_a_path_that_only_names_github_are_not_detected() {
        for url in [
            "https://git.example.com/acme/app.git",
            "git@gitlab.example.com:acme/app.git",
            "https://example.com/github.com/acme/app",
            "https://github.com.evil.example/acme/app",
            "/srv/git/app.git",
            "../app",
            "",
        ] {
            assert_eq!(detect_forge(url), None, "{url}");
        }
    }

    #[test]
    fn the_error_texts_name_the_cli_and_the_next_step() {
        let missing = ForgeError::CliMissing(Forge::Github).to_string();
        assert!(missing.contains("`gh`") && missing.contains("Install it"));
        let signed_out = ForgeError::NotSignedIn(Forge::Github).to_string();
        assert!(signed_out.contains("gh auth login"));
        let gitlab_out = ForgeError::NotSignedIn(Forge::Gitlab).to_string();
        assert!(gitlab_out.contains("glab auth login") && gitlab_out.contains("GitLab"));
    }
}
