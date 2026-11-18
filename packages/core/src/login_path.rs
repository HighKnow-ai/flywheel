//! The developer's login-shell `PATH`, resolved once at startup (issue #88).
//!
//! An app opened from Finder or the Dock inherits a minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`),
//! so `claude`, `npm`, `cargo` and `gh` in `~/.local/bin`, `/opt/homebrew/bin` or an npm prefix
//! are not found. [`adopt`] asks the developer's shell (`$SHELL`, `/bin/zsh` when unset) for its
//! `PATH` through the Check runner's shell spawner ([`crate::check_runner`]), each attempt bounded
//! by a timeout, and makes it this process's own `PATH`. It asks an interactive login shell first
//! (`-l -i`, standard input closed), because that is what the developer's terminal runs and tools
//! like `mise activate` live in `.zshrc`; then a login shell alone (`-l`, `.zprofile` only). Everything Flywheel spawns
//! inherits it from there: the sidecar, every session (the shim directory is prefixed onto it), the
//! shim's own real-binary lookups, and the Check runs.
//!
//! A shell that is slow, broken or prints no `PATH` cannot hang startup: past the timeout, or on
//! any failure, the next attempt runs, and after the last the inherited `PATH` is kept. Every
//! fallback carries a warning naming what was used. The Checks run with the adopted `PATH`.
//!
//! Two variables are taken from the login shell and no others: `PATH`, and `CLAUDE_CONFIG_DIR`
//! (issue #1758). Claude Code keys its stored login to the config folder when that variable is set,
//! so a `claude` spawned without the variable the developer's terminal has reads a different login,
//! which may have expired. `CLAUDE_CONFIG_DIR` is adopted only when this process has none: a value
//! the app was opened with is the developer's explicit choice.

use std::ffi::{OsStr, OsString};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use crate::check_runner::{login_shell, run_in_shell, ShellOutcome};

/// How long each attempt (interactive login shell, then login shell) gets to report its `PATH`.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

/// The markers the shell prints its `PATH` between, so whatever a profile or prompt prints around
/// it is ignored.
const MARKER: &str = "__FLYWHEEL_LOGIN_PATH__";

/// The markers around `CLAUDE_CONFIG_DIR`, on the same line as the `PATH`.
const CONFIG_MARKER: &str = "__FLYWHEEL_LOGIN_CLAUDE_CONFIG_DIR__";

/// The one variable besides `PATH` that Flywheel takes from the login shell (issue #1758).
pub const CLAUDE_CONFIG_DIR: &str = "CLAUDE_CONFIG_DIR";

/// The `PATH` Flywheel runs with, and the warning to show when it is not the login shell's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginPath {
    pub path: String,
    /// The login shell's `CLAUDE_CONFIG_DIR`, `None` when it sets none or could not be read.
    pub claude_config_dir: Option<String>,
    /// `Some` when the login shell's `PATH` could not be read and the inherited one was kept.
    pub warning: Option<String>,
}

static ADOPTED: OnceLock<LoginPath> = OnceLock::new();

/// Resolve the login shell's `PATH` and make it this process's `PATH`. Call it once, first thing
/// in `main`, before any thread is started: it writes the process environment.
pub fn adopt(timeout: Duration) -> LoginPath {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut resolved = resolve_with(&login_shell(), &[], &inherited, timeout);
    std::env::set_var("PATH", &resolved.path);
    let (dir, ignored) = config_dir_to_adopt(
        std::env::var_os(CLAUDE_CONFIG_DIR).as_deref(),
        resolved.claude_config_dir.as_deref(),
    );
    if let Some(dir) = dir {
        std::env::set_var(CLAUDE_CONFIG_DIR, dir);
    }
    if let Some(ignored) = ignored {
        resolved.warning = Some(match resolved.warning {
            Some(earlier) => format!("{earlier} {ignored}"),
            None => ignored,
        });
    }
    let _ = ADOPTED.set(resolved.clone());
    resolved
}

/// The `CLAUDE_CONFIG_DIR` to put in this process's environment, and a warning when the login
/// shell's value is ignored. The shell's value is adopted only when the process has none (or an
/// empty one) and the value is an absolute path: a relative path, or an unexpanded `~/x`, would
/// resolve against the app's working directory (`/` from the Finder), never the shell's, so it can
/// not be what the terminal meant.
pub(crate) fn config_dir_to_adopt(
    current: Option<&OsStr>,
    from_shell: Option<&str>,
) -> (Option<String>, Option<String>) {
    if current.is_some_and(|c| !c.is_empty()) {
        return (None, None);
    }
    match from_shell.filter(|d| !d.is_empty()) {
        Some(dir) if Path::new(dir).is_absolute() => (Some(dir.to_string()), None),
        Some(dir) => (
            None,
            Some(format!(
                "Flywheel ignored your login shell's {CLAUDE_CONFIG_DIR} ({dir}) because it is not an \
                 absolute path. claude will use its default config folder, which may hold a different login."
            )),
        ),
        None => (None, None),
    }
}

/// What [`adopt`] resolved, or `None` when it was never called (tests, tools).
pub fn adopted() -> Option<&'static LoginPath> {
    ADOPTED.get()
}

/// Ask `shell` for its `PATH`, as an interactive login shell, then as a login shell, keeping
/// `inherited` when both fail. `env` is added to each attempt's environment.
pub(crate) fn resolve_with(
    shell: &Path,
    env: &[(&str, &Path)],
    inherited: &str,
    timeout: Duration,
) -> LoginPath {
    let interactive = match ask_path(shell, &["-l", "-i"], env, timeout) {
        Ok((path, claude_config_dir)) => {
            return LoginPath {
                path,
                claude_config_dir,
                warning: None,
            }
        }
        Err(why) => why,
    };
    match ask_path(shell, &["-l"], env, timeout) {
        Ok((path, claude_config_dir)) => LoginPath {
            claude_config_dir,
            warning: Some(format!(
                "Flywheel could not read your interactive login shell's PATH ({interactive}), so it used \
                 {} -l, which skips ~/.zshrc: {path}. Tools set up in ~/.zshrc may not be found.",
                shell.display()
            )),
            path,
        },
        Err(login) => LoginPath {
            path: inherited.to_string(),
            claude_config_dir: None,
            warning: Some(format!(
                "Flywheel could not read your login shell's PATH ({interactive}; then {login}), so it \
                 kept the PATH it was opened with: {inherited}. claude, npm, cargo or gh may not be found."
            )),
        },
    }
}

/// One attempt: `shell <flags> -c` printing its `PATH` between markers, or why it gave none.
fn ask_path(
    shell: &Path,
    flags: &[&str],
    env: &[(&str, &Path)],
    timeout: Duration,
) -> Result<(String, Option<String>), String> {
    let how = format!("{} {}", shell.display(), flags.join(" "));
    let command = format!(
        "printf '{MARKER}%s{MARKER}{CONFIG_MARKER}%s{CONFIG_MARKER}' \"$PATH\" \"$CLAUDE_CONFIG_DIR\""
    );
    let run = run_in_shell(shell, flags, env, Path::new("/"), &command, timeout)
        .map_err(|e| format!("{how} could not be started: {e}"))?;
    match run.outcome {
        ShellOutcome::TimedOut => {
            return Err(format!("{how} took longer than {}s", timeout.as_secs()))
        }
        ShellOutcome::Exited(Some(0)) => {}
        ShellOutcome::Exited(code) => {
            let code = code.map_or("a signal".to_string(), |c| format!("code {c}"));
            return Err(format!("{how} exited with {code}"));
        }
    }
    let tail = run.output_tail.as_str();
    let between = |marker: &str| {
        let end = tail.rfind(marker)?;
        let start = tail[..end].rfind(marker)? + marker.len();
        Some(&tail[start..end])
    };
    let config_dir = between(CONFIG_MARKER)
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string);
    match between(MARKER) {
        Some(path) if !path.trim().is_empty() => Ok((path.to_string(), config_dir)),
        _ => Err(format!("{how} printed no PATH")),
    }
}

/// The first executable file called `name` in an absolute directory of `path`.
pub fn find_on_path(name: &str, path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

/// The `claude` binary a session will spawn: `FLYWHEEL_CLAUDE_BIN` when it is set, as the
/// sidecar's `resolveClaudeBin()` does, otherwise `claude` on this process's `PATH`. The error is
/// the sentence the developer reads, naming the `PATH` that was searched.
pub fn claude_bin() -> Result<PathBuf, String> {
    claude_bin_in(
        std::env::var_os("FLYWHEEL_CLAUDE_BIN"),
        &std::env::var_os("PATH").unwrap_or_default(),
    )
}

/// `claude` on `path`, ignoring `FLYWHEEL_CLAUDE_BIN`: [`claude_bin`] with the `PATH` named.
pub fn claude_bin_on(path: impl AsRef<OsStr>) -> Result<PathBuf, String> {
    claude_bin_in(None, path.as_ref())
}

pub(crate) fn claude_bin_in(
    override_bin: Option<OsString>,
    path: &OsStr,
) -> Result<PathBuf, String> {
    let name = override_bin.filter(|b| !b.is_empty());
    match name {
        Some(bin) if Path::new(&bin).components().count() > 1 => {
            let bin = PathBuf::from(bin);
            if is_executable(&bin) {
                Ok(bin)
            } else {
                Err(format!(
                    "FLYWHEEL_CLAUDE_BIN points at {}, which is not an executable file.",
                    bin.display()
                ))
            }
        }
        name => {
            let name = name
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "claude".to_string());
            find_on_path(&name, path).ok_or_else(|| {
                format!(
                    "{name} was not found on the PATH Flywheel searched: {}. Install Claude Code, or add \
                     the folder it is in to PATH in your login shell profile (~/.zprofile), then reopen Flywheel.",
                    path.to_string_lossy()
                )
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FINDER_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

    fn executable(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A zsh profile directory whose `.zprofile` puts `bin` on `PATH`, as a developer's own does.
    fn profile_adding(bin: &Path) -> tempfile::TempDir {
        let profile = tempfile::tempdir().unwrap();
        std::fs::write(
            profile.path().join(".zprofile"),
            format!(
                "echo hello from the profile\nexport PATH=\"{}:$PATH\"\n",
                bin.display()
            ),
        )
        .unwrap();
        profile
    }

    #[test]
    fn the_login_shell_path_carries_an_entry_only_the_profile_adds() {
        let bin = tempfile::tempdir().unwrap();
        let profile = profile_adding(bin.path());

        let resolved = resolve_with(
            Path::new("/bin/zsh"),
            &[
                ("ZDOTDIR", profile.path()),
                ("PATH", Path::new(FINDER_PATH)),
            ],
            FINDER_PATH,
            Duration::from_secs(30),
        );

        assert_eq!(resolved.warning, None);
        assert!(
            std::env::split_paths(&resolved.path).any(|dir| dir == bin.path()),
            "{} should hold {}",
            resolved.path,
            bin.path().display()
        );
        assert!(
            !resolved.path.contains("hello"),
            "what the profile prints is not part of the PATH"
        );
    }

    /// The criterion's own shape: `claude` exists only on a profile-added `PATH`, the inherited
    /// `PATH` is Finder's, and it is still found.
    #[test]
    fn claude_found_only_on_the_profile_path_is_found_from_a_finder_path() {
        let bin = tempfile::tempdir().unwrap();
        executable(&bin.path().join("claude"), "#!/bin/sh\necho stub\n");
        let profile = profile_adding(bin.path());
        assert!(
            claude_bin_in(None, OsStr::new(FINDER_PATH)).is_err(),
            "not on Finder's PATH"
        );

        let resolved = resolve_with(
            Path::new("/bin/zsh"),
            &[
                ("ZDOTDIR", profile.path()),
                ("PATH", Path::new(FINDER_PATH)),
            ],
            FINDER_PATH,
            Duration::from_secs(30),
        );

        assert_eq!(
            claude_bin_in(None, OsStr::new(&resolved.path)),
            Ok(bin.path().join("claude"))
        );
    }

    /// What the developer's terminal sees: an entry only `.zshrc` adds (`mise activate`, say) is
    /// on the resolved PATH, with no warning.
    #[test]
    fn an_entry_only_the_zshrc_adds_is_found() {
        let profile_bin = tempfile::tempdir().unwrap();
        let rc_bin = tempfile::tempdir().unwrap();
        let profile = profile_adding(profile_bin.path());
        std::fs::write(
            profile.path().join(".zshrc"),
            format!(
                "echo hello from the rc\nexport PATH=\"{}:$PATH\"\nPROMPT='%~ > '\n",
                rc_bin.path().display()
            ),
        )
        .unwrap();

        let resolved = resolve_with(
            Path::new("/bin/zsh"),
            &[
                ("ZDOTDIR", profile.path()),
                ("PATH", Path::new(FINDER_PATH)),
            ],
            FINDER_PATH,
            Duration::from_secs(30),
        );

        assert_eq!(resolved.warning, None);
        let dirs: Vec<PathBuf> = std::env::split_paths(&resolved.path).collect();
        assert!(
            dirs.iter().any(|d| d == rc_bin.path()),
            "{} lacks the .zshrc entry",
            resolved.path
        );
        assert!(
            dirs.iter().any(|d| d == profile_bin.path()),
            "{} lacks the .zprofile entry",
            resolved.path
        );
    }

    /// An interactive shell that hangs (a `.zshrc` waiting on something) falls back to the login
    /// shell's PATH, with a warning naming it.
    #[test]
    fn a_hanging_zshrc_falls_back_to_the_login_shell_path_with_a_warning() {
        let profile_bin = tempfile::tempdir().unwrap();
        let profile = profile_adding(profile_bin.path());
        std::fs::write(profile.path().join(".zshrc"), "sleep 30\n").unwrap();

        let resolved = resolve_with(
            Path::new("/bin/zsh"),
            &[
                ("ZDOTDIR", profile.path()),
                ("PATH", Path::new(FINDER_PATH)),
            ],
            FINDER_PATH,
            Duration::from_secs(2),
        );

        assert!(
            std::env::split_paths(&resolved.path).any(|d| d == profile_bin.path()),
            "{}",
            resolved.path
        );
        let warning = resolved.warning.expect("a warning");
        assert!(warning.contains("-l, which skips ~/.zshrc"), "{warning}");
    }

    #[test]
    fn a_slow_login_shell_times_out_and_keeps_the_inherited_path_with_a_warning() {
        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("slow-shell");
        executable(&shell, "#!/bin/sh\nsleep 30\n");

        let started = std::time::Instant::now();
        let resolved = resolve_with(&shell, &[], FINDER_PATH, Duration::from_millis(500));

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "two attempts took {:?}",
            started.elapsed()
        );
        assert_eq!(resolved.path, FINDER_PATH);
        let warning = resolved.warning.expect("a warning");
        assert!(
            warning.contains("took longer") && warning.contains(FINDER_PATH),
            "{warning}"
        );
    }

    #[test]
    fn a_broken_or_missing_login_shell_keeps_the_inherited_path_with_a_warning() {
        let dir = tempfile::tempdir().unwrap();
        let broken = dir.path().join("broken-shell");
        executable(&broken, "#!/bin/sh\nexit 3\n");
        let silent = dir.path().join("silent-shell");
        executable(&silent, "#!/bin/sh\nexit 0\n");

        for shell in [broken, silent, dir.path().join("no-such-shell")] {
            let resolved = resolve_with(&shell, &[], FINDER_PATH, Duration::from_secs(10));
            assert_eq!(resolved.path, FINDER_PATH, "{}", shell.display());
            assert!(resolved.warning.is_some(), "{}", shell.display());
        }
    }

    /// Issue #1758: the terminal's `CLAUDE_CONFIG_DIR` (set in `.zshenv`/`.zshrc`) reaches the
    /// resolved environment, and nothing else the profile exports does.
    #[test]
    fn the_login_shell_claude_config_dir_is_resolved_and_no_other_variable() {
        let bin = tempfile::tempdir().unwrap();
        let profile = profile_adding(bin.path());
        std::fs::write(
            profile.path().join(".zshenv"),
            "export CLAUDE_CONFIG_DIR=/home/dev/.claude-work\nexport SECRET_TOKEN=hunter2\n",
        )
        .unwrap();

        let resolved = resolve_with(
            Path::new("/bin/zsh"),
            &[
                ("ZDOTDIR", profile.path()),
                ("PATH", Path::new(FINDER_PATH)),
            ],
            FINDER_PATH,
            Duration::from_secs(30),
        );

        assert_eq!(resolved.warning, None);
        assert_eq!(
            resolved.claude_config_dir.as_deref(),
            Some("/home/dev/.claude-work")
        );
        assert!(
            !format!("{resolved:?}").contains("hunter2"),
            "only PATH and CLAUDE_CONFIG_DIR are taken from the shell"
        );
    }

    #[test]
    fn a_login_shell_without_claude_config_dir_resolves_none() {
        let bin = tempfile::tempdir().unwrap();
        let profile = profile_adding(bin.path());
        // The test runner's own environment may carry the variable; the shell starts without it.
        let resolved = resolve_with(
            Path::new("/bin/zsh"),
            &[
                ("ZDOTDIR", profile.path()),
                ("PATH", Path::new(FINDER_PATH)),
                ("CLAUDE_CONFIG_DIR", Path::new("")),
            ],
            FINDER_PATH,
            Duration::from_secs(30),
        );
        assert_eq!(resolved.warning, None);
        assert_eq!(resolved.claude_config_dir, None);
    }

    /// An app opened from Finder has no `CLAUDE_CONFIG_DIR` and gains the shell's; one opened with
    /// a value (from a terminal) keeps its own; an empty shell value is not adopted.
    #[test]
    fn claude_config_dir_is_adopted_only_into_a_process_that_has_none() {
        let shell = Some("/home/dev/.claude-work");
        let adopted = Some("/home/dev/.claude-work".to_string());
        assert_eq!(config_dir_to_adopt(None, shell), (adopted.clone(), None));
        assert_eq!(
            config_dir_to_adopt(Some(OsStr::new("")), shell),
            (adopted, None)
        );
        assert_eq!(
            config_dir_to_adopt(Some(OsStr::new("/mine")), shell),
            (None, None)
        );
        assert_eq!(config_dir_to_adopt(None, None), (None, None));
        assert_eq!(config_dir_to_adopt(None, Some("")), (None, None));
    }

    /// A relative path or an unexpanded tilde cannot be what the terminal meant: it is ignored, and
    /// the warning names the value.
    #[test]
    fn a_relative_or_tilde_claude_config_dir_is_ignored_with_a_warning() {
        for bad in ["rel/.claude", ".claude", "~/x"] {
            let (dir, warning) = config_dir_to_adopt(None, Some(bad));
            assert_eq!(dir, None, "{bad}");
            let warning = warning.unwrap_or_else(|| panic!("no warning for {bad}"));
            assert!(
                warning.contains(bad) && warning.contains("absolute"),
                "{warning}"
            );
        }
        // The process's own value is never replaced, so there is nothing to warn about.
        assert_eq!(
            config_dir_to_adopt(Some(OsStr::new("/mine")), Some("~/x")),
            (None, None)
        );
    }

    #[test]
    fn a_missing_claude_names_the_path_that_was_searched() {
        let empty = tempfile::tempdir().unwrap();
        let path = format!("{}:{FINDER_PATH}", empty.path().display());
        let err = claude_bin_in(None, OsStr::new(&path)).unwrap_err();
        assert!(err.contains(&path), "{err}");

        let err = claude_bin_in(
            Some(empty.path().join("claude").into_os_string()),
            OsStr::new(&path),
        )
        .unwrap_err();
        assert!(err.contains("FLYWHEEL_CLAUDE_BIN"), "{err}");
    }

    #[test]
    fn a_file_that_is_not_executable_is_not_claude() {
        let bin = tempfile::tempdir().unwrap();
        std::fs::write(bin.path().join("claude"), "not a program").unwrap();
        assert!(claude_bin_in(None, bin.path().as_os_str()).is_err());
        executable(&bin.path().join("claude"), "#!/bin/sh\n");
        assert!(claude_bin_in(None, bin.path().as_os_str()).is_ok());
    }
}
