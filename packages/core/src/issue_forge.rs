//! The port the Issue mirror writes through: issues on a forge, one call per write. [`GhIssueForge`]
//! is the adapter over the `gh` CLI; [`fake::FakeIssueForge`] is the adapter tests use.
//!
//! Each method is one write and costs the forge one request of its write budget, apart from
//! `add_sub_issue`, which first reads the child's id.

use std::path::{Path, PathBuf};

use crate::forge::{last_line, ForgeCli, ForgeError};

/// Where the mirror writes: the forge repository (`owner/name`) and a directory `gh` runs in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirrorTarget {
    pub repo: String,
    pub workdir: PathBuf,
}

/// Why Flywheel closes an issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    Completed,
    NotPlanned,
}

impl CloseReason {
    pub fn as_str(self) -> &'static str {
        match self {
            CloseReason::Completed => "completed",
            CloseReason::NotPlanned => "not_planned",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "completed" => Some(CloseReason::Completed),
            "not_planned" => Some(CloseReason::NotPlanned),
            _ => None,
        }
    }
}

pub trait IssueForge {
    fn ensure_label(&self, target: &MirrorTarget, label: &str) -> Result<(), ForgeError>;
    /// Create an issue with one label and return its number.
    fn create_issue(
        &self,
        target: &MirrorTarget,
        title: &str,
        body: &str,
        label: &str,
    ) -> Result<u64, ForgeError>;
    /// Set title and body, and swap `remove_label` for `add_label`.
    fn edit_issue(
        &self,
        target: &MirrorTarget,
        number: u64,
        title: &str,
        body: &str,
        add_label: &str,
        remove_label: &str,
    ) -> Result<(), ForgeError>;
    fn close_issue(
        &self,
        target: &MirrorTarget,
        number: u64,
        reason: CloseReason,
    ) -> Result<(), ForgeError>;
    fn add_sub_issue(
        &self,
        target: &MirrorTarget,
        parent: u64,
        child: u64,
    ) -> Result<(), ForgeError>;
}

/// `owner/name` of a GitHub remote URL: `https://github.com/o/r.git` and `git@github.com:o/r.git`
/// both give `o/r`. `None` for any other host.
pub fn github_slug(remote_url: &str) -> Option<String> {
    crate::forge::detect_forge(remote_url).filter(|f| *f == crate::forge::Forge::Github)?;
    let url = remote_url.trim();
    let path = match url.split_once("://") {
        Some((_, rest)) => rest.split_once('/').map(|(_, path)| path)?,
        None => url.split_once(':').map(|(_, path)| path)?,
    };
    let path = path.trim_matches('/').trim_end_matches(".git");
    let mut parts = path.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    (!owner.is_empty() && !name.is_empty() && parts.next().is_none())
        .then(|| format!("{owner}/{name}"))
}

/// The `gh` CLI, signed in by the developer.
pub struct GhIssueForge<'a> {
    cli: &'a ForgeCli,
}

impl<'a> GhIssueForge<'a> {
    pub fn new(cli: &'a ForgeCli) -> Self {
        Self { cli }
    }

    fn run(&self, workdir: &Path, args: &[&str], what: &str) -> Result<String, ForgeError> {
        let out = self.cli.run_gh(workdir, args)?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(ForgeError::Failed(format!(
                "The GitHub CLI could not {what}: {}",
                last_line(&out.stderr)
            )))
        }
    }
}

impl IssueForge for GhIssueForge<'_> {
    fn ensure_label(&self, target: &MirrorTarget, label: &str) -> Result<(), ForgeError> {
        match self.run(
            &target.workdir,
            &["label", "create", label, "--repo", &target.repo],
            "create a label",
        ) {
            Err(ForgeError::Failed(reason)) if reason.contains("already exists") => Ok(()),
            other => other.map(|_| ()),
        }
    }

    fn create_issue(
        &self,
        target: &MirrorTarget,
        title: &str,
        body: &str,
        label: &str,
    ) -> Result<u64, ForgeError> {
        let out = self.run(
            &target.workdir,
            &[
                "issue",
                "create",
                "--repo",
                &target.repo,
                "--title",
                title,
                "--body",
                body,
                "--label",
                label,
            ],
            "create an issue",
        )?;
        out.lines()
            .last()
            .and_then(|url| url.trim().rsplit('/').next())
            .and_then(|n| n.parse().ok())
            .ok_or_else(|| {
                ForgeError::Failed("The GitHub CLI did not name the issue it created.".into())
            })
    }

    fn edit_issue(
        &self,
        target: &MirrorTarget,
        number: u64,
        title: &str,
        body: &str,
        add_label: &str,
        remove_label: &str,
    ) -> Result<(), ForgeError> {
        let number = number.to_string();
        let mut args = vec![
            "issue",
            "edit",
            &number,
            "--repo",
            &target.repo,
            "--title",
            title,
            "--body",
            body,
            "--add-label",
            add_label,
        ];
        if remove_label != add_label && !remove_label.is_empty() {
            args.extend(["--remove-label", remove_label]);
        }
        self.run(&target.workdir, &args, "edit an issue")
            .map(|_| ())
    }

    fn close_issue(
        &self,
        target: &MirrorTarget,
        number: u64,
        reason: CloseReason,
    ) -> Result<(), ForgeError> {
        let number = number.to_string();
        let reason = match reason {
            CloseReason::Completed => "completed",
            CloseReason::NotPlanned => "not planned",
        };
        self.run(
            &target.workdir,
            &[
                "issue",
                "close",
                &number,
                "--repo",
                &target.repo,
                "--reason",
                reason,
            ],
            "close an issue",
        )
        .map(|_| ())
    }

    fn add_sub_issue(
        &self,
        target: &MirrorTarget,
        parent: u64,
        child: u64,
    ) -> Result<(), ForgeError> {
        let child_path = format!("repos/{}/issues/{child}", target.repo);
        let id = self.run(
            &target.workdir,
            &["api", &child_path, "--jq", ".id"],
            "read an issue",
        )?;
        let parent_path = format!("repos/{}/issues/{parent}/sub_issues", target.repo);
        let field = format!("sub_issue_id={id}");
        self.run(
            &target.workdir,
            &["api", "-X", "POST", &parent_path, "-F", &field],
            "link a sub-issue",
        )
        .map(|_| ())
    }
}

/// An in-memory forge that records every write with its time.
pub mod fake {
    use std::cell::RefCell;
    use std::time::Instant;

    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum Write {
        Label(String),
        Create {
            number: u64,
            title: String,
            body: String,
            label: String,
        },
        Edit {
            number: u64,
            title: String,
            body: String,
            add: String,
            remove: String,
        },
        Close {
            number: u64,
            reason: CloseReason,
        },
        SubIssue {
            parent: u64,
            child: u64,
        },
    }

    #[derive(Default)]
    pub struct FakeIssueForge {
        pub writes: RefCell<Vec<(Instant, Write)>>,
        /// Calls that fail before this many have been made, counted over every write.
        pub fail_next: RefCell<u32>,
        next_number: RefCell<u64>,
        pub first_number: u64,
    }

    impl FakeIssueForge {
        pub fn new(first_number: u64) -> Self {
            Self {
                first_number,
                ..Self::default()
            }
        }

        pub fn log(&self) -> Vec<Write> {
            self.writes
                .borrow()
                .iter()
                .map(|(_, w)| w.clone())
                .collect()
        }

        fn record(&self, write: Write) -> Result<(), ForgeError> {
            let mut fail = self.fail_next.borrow_mut();
            if *fail > 0 {
                *fail -= 1;
                return Err(ForgeError::Failed("the forge is down".into()));
            }
            self.writes.borrow_mut().push((Instant::now(), write));
            Ok(())
        }
    }

    impl IssueForge for FakeIssueForge {
        fn ensure_label(&self, _: &MirrorTarget, label: &str) -> Result<(), ForgeError> {
            self.record(Write::Label(label.into()))
        }

        fn create_issue(
            &self,
            _: &MirrorTarget,
            title: &str,
            body: &str,
            label: &str,
        ) -> Result<u64, ForgeError> {
            let number = {
                let next = self.next_number.borrow();
                self.first_number + *next
            };
            self.record(Write::Create {
                number,
                title: title.into(),
                body: body.into(),
                label: label.into(),
            })?;
            *self.next_number.borrow_mut() += 1;
            Ok(number)
        }

        fn edit_issue(
            &self,
            _: &MirrorTarget,
            number: u64,
            title: &str,
            body: &str,
            add_label: &str,
            remove_label: &str,
        ) -> Result<(), ForgeError> {
            self.record(Write::Edit {
                number,
                title: title.into(),
                body: body.into(),
                add: add_label.into(),
                remove: remove_label.into(),
            })
        }

        fn close_issue(
            &self,
            _: &MirrorTarget,
            number: u64,
            reason: CloseReason,
        ) -> Result<(), ForgeError> {
            self.record(Write::Close { number, reason })
        }

        fn add_sub_issue(
            &self,
            _: &MirrorTarget,
            parent: u64,
            child: u64,
        ) -> Result<(), ForgeError> {
            self.record(Write::SubIssue { parent, child })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::github_slug;

    #[test]
    fn it_reads_the_slug_of_a_github_remote() {
        for url in [
            "https://github.com/acme/app.git",
            "git@github.com:acme/app.git",
            "ssh://git@github.com/acme/app",
            "https://user:tok@github.com/acme/app/",
        ] {
            assert_eq!(github_slug(url).as_deref(), Some("acme/app"), "{url}");
        }
        assert_eq!(github_slug("https://gitlab.com/acme/app"), None);
        assert_eq!(github_slug("/srv/git/app.git"), None);
    }
}
