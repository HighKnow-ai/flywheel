//! D-51's supervisor-side half of the PATH shim: resolving the compiled `flywheel-shim` binary,
//! resolving the real system `git` ONCE (from the supervisor's own `PATH`, before any session is
//! spawned), and materialising a per-session shim directory whose `PATH`-prefix env entries make
//! every agent session's OWN `git` invocations — not just Flywheel's own `git_at` calls — retry
//! lock collisions through `git_retry::with_lock_retry` (D-51, criterion 4).
//!
//! This module NEVER shells out to `which` and never re-reads `PATH` per invocation the way the
//! shim BINARY (`packages/shim/src/main.rs`) is forbidden to — [`resolve_real_git`] runs on the
//! SUPERVISOR side, exactly once per spawned session, and its result becomes the
//! `FLYWHEEL_REAL_GIT` value the shim binary trusts unconditionally thereafter (T-03-04-02).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context};

use crate::runtime_protocol;

/// The compiled shim binary's file name, platform-appropriate.
fn shim_binary_file_name() -> &'static str {
    if cfg!(windows) {
        "flywheel-shim.exe"
    } else {
        "flywheel-shim"
    }
}

/// The name the installed PATH entry must carry so `argv[0]`'s dispatch sees `git` (never a
/// symlink — a symlink's `argv[0]` resolution is platform-dependent, per this plan's own
/// instruction; [`install_for_run`] hard-links or copies instead).
fn shadowed_git_entry_name() -> &'static str {
    if cfg!(windows) {
        "git.exe"
    } else {
        "git"
    }
}

/// The second shadowed name (plan 03-07, D-55/D-56) — installed through the EXACT SAME compiled
/// `flywheel-shim` binary as [`shadowed_git_entry_name`], per that plan's own dispatch (`argv[0]`
/// reads `rm` as well as `git`). Never a symlink, for the same `argv[0]`-resolution reason.
fn shadowed_rm_entry_name() -> &'static str {
    if cfg!(windows) {
        "rm.exe"
    } else {
        "rm"
    }
}

/// Resolve the compiled `flywheel-shim` binary: first next to the CURRENT executable (the
/// packaged Tauri app layout), then at `<workspace>/target/{debug,release}/flywheel-shim`
/// resolved from this crate's own `CARGO_MANIFEST_DIR` (the `tauri dev` layout). Fails loud,
/// naming every path probed, when neither resolves — never a silent skip, mirroring
/// `spawn_sidecar`'s own resolution failure shape.
pub fn resolve_shim_binary() -> anyhow::Result<PathBuf> {
    let bin_name = shim_binary_file_name();
    let mut probed: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let candidate = dir.join(bin_name);
            if candidate.is_file() {
                return Ok(candidate);
            }
            probed.push(candidate);
        }
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(workspace_root) = manifest_dir.parent().and_then(Path::parent) {
        // Check the profile this build was compiled under first, then the other — a `tauri dev`
        // session and a `cargo test` invocation are not guaranteed to share a profile.
        let profiles: [&str; 2] = if cfg!(debug_assertions) {
            ["debug", "release"]
        } else {
            ["release", "debug"]
        };
        for profile in profiles {
            let candidate = workspace_root.join("target").join(profile).join(bin_name);
            if candidate.is_file() {
                return Ok(candidate);
            }
            probed.push(candidate);
        }
    }

    bail!(
        "flywheel-shim binary not found; probed: {}",
        probed
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
}

/// Resolve the system `git` binary ONCE, by walking the supervisor's OWN `PATH` directories in
/// order — deliberately NOT a call into `git_retry`/`git_at` (this is plain resolution, not an
/// invocation), and deliberately NOT the shim's own resolution mechanism (the shim binary must
/// never do this itself; see `packages/shim/src/main.rs`'s own doc comment). Returns an absolute
/// path; a relative `PATH` entry is resolved to an absolute one via `canonicalize` where possible.
pub fn resolve_real_git() -> anyhow::Result<PathBuf> {
    let path_var = std::env::var_os("PATH")
        .context("PATH is not set in the supervisor's own environment")?;
    let name = shadowed_git_entry_name();

    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    bail!("git executable not found on the supervisor's own PATH");
}

/// Resolve the system `rm` binary ONCE, mirroring [`resolve_real_git`] exactly (plan 03-07,
/// D-55) — same PATH-walk, same never-shell-out-to-`which` discipline, same absolute-path result.
pub fn resolve_real_rm() -> anyhow::Result<PathBuf> {
    let path_var = std::env::var_os("PATH")
        .context("PATH is not set in the supervisor's own environment")?;
    let name = shadowed_rm_entry_name();

    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    bail!("rm executable not found on the supervisor's own PATH");
}

fn shim_dir_for_run(run_id: &str) -> anyhow::Result<PathBuf> {
    Ok(runtime_protocol::runtime_dir()?.join("shim").join(run_id))
}

/// Hard-link (falling back to a plain copy across a filesystem boundary) the compiled shim binary
/// in at `dir.join(entry_name)`, then mark it executable on Unix — the shared install step both
/// [`shadowed_git_entry_name`] and [`shadowed_rm_entry_name`] use. A no-op if the entry already
/// exists.
fn install_shadow_entry(dir: &Path, entry_name: &str, run_id: &str) -> anyhow::Result<()> {
    let entry = dir.join(entry_name);
    if entry.is_file() {
        return Ok(());
    }
    let shim_bin = resolve_shim_binary()?;
    if fs::hard_link(&shim_bin, &entry).is_err() {
        fs::copy(&shim_bin, &entry).with_context(|| {
            format!("failed to install the shim entry at {entry:?} for run {run_id:?}")
        })?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&entry)
            .with_context(|| format!("failed to read metadata for {entry:?}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&entry, perms)
            .with_context(|| format!("failed to make {entry:?} executable"))?;
    }

    Ok(())
}

/// Create `<runtime>/shim/<run_id>/` containing an entry named exactly `git` (or `git.exe` on
/// Windows) AND an entry named exactly `rm` (or `rm.exe`) — plan 03-07 installs the SECOND
/// shadowed name through the exact same compiled binary, never a second build target — and return
/// that directory's absolute path. Neither entry is ever a symlink, since a symlink's `argv[0]`
/// resolution is platform-dependent and this dispatch reads `argv[0]`. Re-installing for the same
/// run id is a no-op per entry: if an entry already exists, nothing is re-copied or re-linked for
/// it.
pub fn install_for_run(run_id: &str) -> anyhow::Result<PathBuf> {
    let dir = shim_dir_for_run(run_id)?;
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create shim directory {dir:?} for run {run_id:?}"))?;

    install_shadow_entry(&dir, shadowed_git_entry_name(), run_id)?;
    install_shadow_entry(&dir, shadowed_rm_entry_name(), run_id)?;

    Ok(dir)
}

/// The env-var additions a spawned session's environment must carry so its OWN `git` AND `rm`
/// invocations resolve to the shim first: `PATH` prefixed with the per-run shim directory, plus
/// `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM` set to the ONE absolute real-binary paths
/// [`resolve_real_git`]/[`resolve_real_rm`] each resolved. Installs the shim directory as a side
/// effect (via [`install_for_run`]) — a failure here (an unresolvable shim binary, an unresolvable
/// real git/rm, an unwritable runtime directory) propagates as an `Err` rather than silently
/// producing an unprotected session.
///
/// `FLYWHEEL_REAL_RM` is resolved here, alongside `FLYWHEEL_REAL_GIT`, rather than in
/// `sidecar.rs::resolved_env_for_run` — it needs `run_id` (for [`install_for_run`]'s per-run
/// directory), which does not exist at `resolved_env_for_run`'s own call time (D-39; see that
/// function's own doc comment). This mirrors 03-04's own established precedent for
/// `FLYWHEEL_REAL_GIT` exactly.
pub fn shim_env_for_run(run_id: &str) -> anyhow::Result<HashMap<String, String>> {
    let shim_dir = install_for_run(run_id)?;
    let real_git = resolve_real_git()?;
    let real_rm = resolve_real_rm()?;

    let existing_path = std::env::var("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ";" } else { ":" };
    let new_path = format!("{}{separator}{existing_path}", shim_dir.display());

    let mut env = HashMap::new();
    env.insert("PATH".to_string(), new_path);
    env.insert(
        "FLYWHEEL_REAL_GIT".to_string(),
        real_git.to_string_lossy().into_owned(),
    );
    env.insert(
        "FLYWHEEL_REAL_RM".to_string(),
        real_rm.to_string_lossy().into_owned(),
    );
    Ok(env)
}
