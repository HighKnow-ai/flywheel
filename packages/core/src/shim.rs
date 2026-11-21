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
/// instruction; [`install_for_run`] copies instead).
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

/// Why a file cannot be the shim: `None` when it is a non-empty executable regular file.
///
/// A 0-byte file is the stand-in `tauri-build` copies from `binaries/flywheel-shim-<triple>` over
/// `target/<profile>/flywheel-shim` whenever the desktop crate's build script runs (the CI and gate
/// `rust` job `touch`es those stand-ins so the build script finds its `externalBin` files). It
/// exists, so `is_file()` is true, and running it fails with `PermissionDenied` — which is how
/// gate run 43842944203 failed. Picking it is never right, so it is refused by name.
fn unusable_reason(path: &Path) -> Option<&'static str> {
    let Ok(meta) = fs::metadata(path) else {
        return Some("missing");
    };
    if !meta.is_file() {
        return Some("not a file");
    }
    if meta.len() == 0 {
        return Some("empty (a build stand-in, not the compiled shim)");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Some("not executable");
        }
    }
    None
}

/// The first usable candidate, or an error naming every candidate probed and why each failed.
fn first_usable_shim(candidates: &[PathBuf]) -> anyhow::Result<PathBuf> {
    let mut probed: Vec<String> = Vec::new();
    for candidate in candidates {
        match unusable_reason(candidate) {
            None => return Ok(candidate.clone()),
            Some(reason) => probed.push(format!("{} ({reason})", candidate.display())),
        }
    }
    bail!(
        "flywheel-shim binary not found; probed: {}. An empty or non-executable file is a build \
         stand-in: run `cargo build -p flywheel-shim` after the desktop crate's build script",
        probed.join(", ")
    );
}

/// Resolve the compiled `flywheel-shim` binary: first next to the CURRENT executable (the
/// packaged Tauri app layout), then at `<workspace>/target/{debug,release}/flywheel-shim`
/// resolved from this crate's own `CARGO_MANIFEST_DIR` (the `tauri dev` layout). A candidate
/// that is empty or not executable is skipped (see [`unusable_reason`]). Fails loud, naming every
/// path probed and why it was refused, when none resolves — never a silent skip, mirroring
/// `spawn_sidecar`'s own resolution failure shape.
pub fn resolve_shim_binary() -> anyhow::Result<PathBuf> {
    let bin_name = shim_binary_file_name();
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            candidates.push(dir.join(bin_name));
            // A test binary runs from `<target>/<profile>/deps/`; the shim is built one level up.
            // Checking there first follows whatever target directory the build actually used
            // (`CARGO_TARGET_DIR` included), before the source-tree guess below can pick up a
            // stale binary from another build.
            if dir.file_name().is_some_and(|name| name == "deps") {
                if let Some(profile_dir) = dir.parent() {
                    candidates.push(profile_dir.join(bin_name));
                }
            }
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
            candidates.push(workspace_root.join("target").join(profile).join(bin_name));
        }
    }

    first_usable_shim(&candidates)
}

/// Resolve the system `git` binary ONCE, by walking the supervisor's OWN `PATH` directories in
/// order — deliberately NOT a call into `git_retry`/`git_at` (this is plain resolution, not an
/// invocation), and deliberately NOT the shim's own resolution mechanism (the shim binary must
/// never do this itself; see `packages/shim/src/main.rs`'s own doc comment). Returns an absolute
/// path; a relative `PATH` entry is resolved to an absolute one via `canonicalize` where possible.
pub fn resolve_real_git() -> anyhow::Result<PathBuf> {
    let path_var =
        std::env::var_os("PATH").context("PATH is not set in the supervisor's own environment")?;
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
    let path_var =
        std::env::var_os("PATH").context("PATH is not set in the supervisor's own environment")?;
    let name = shadowed_rm_entry_name();

    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    bail!("rm executable not found on the supervisor's own PATH");
}

/// The publishing tools the shim also shadows, each with the env var naming its real binary
/// (`docs/mvp-spec.md` §4.1: `npm publish`, `cargo publish`, `gh pr merge`, `gh release`). Unlike
/// `git` and `rm` these are optional: a tool the supervisor cannot find is simply not shadowed.
const PUBLISHING_TOOLS: &[(&str, &str)] = &[
    ("npm", "FLYWHEEL_REAL_NPM"),
    ("cargo", "FLYWHEEL_REAL_CARGO"),
    ("gh", "FLYWHEEL_REAL_GH"),
];

/// Find `name` on the supervisor's own `PATH`, keeping the path as found: no `canonicalize`,
/// because rustup's `cargo` is a symlink to a multiplexer that dispatches on the name it runs as.
/// A directory under the runtime's own `shim/` root is a shadow directory, never a real binary:
/// resolving to one would make the shim exec itself forever.
fn find_on_supervisor_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let shim_root = runtime_protocol::runtime_dir()
        .ok()
        .map(|dir| dir.join("shim"));
    std::env::split_paths(&path_var)
        .filter(|dir| shim_root.as_ref().is_none_or(|root| !dir.starts_with(root)))
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file() && candidate.is_absolute())
}

/// Shadow every publishing tool found on the supervisor's `PATH` in `dir`, and return the
/// `FLYWHEEL_REAL_<NAME>` entries for the ones installed.
fn install_publishing_tools(dir: &Path, run_id: &str) -> anyhow::Result<HashMap<String, String>> {
    let mut env = HashMap::new();
    for (name, env_var) in PUBLISHING_TOOLS {
        let Some(real) = find_on_supervisor_path(name) else {
            continue;
        };
        install_shadow_entry(dir, name, run_id)?;
        verify_shadow_entry(dir, name, run_id)?;
        env.insert(env_var.to_string(), real.to_string_lossy().into_owned());
    }
    Ok(env)
}

fn shim_dir_for_run(run_id: &str) -> anyhow::Result<PathBuf> {
    Ok(runtime_protocol::runtime_dir()?.join("shim").join(run_id))
}

/// Copy the compiled shim binary in at `dir.join(entry_name)` (an own inode per entry), then mark
/// it executable on Unix — the shared install step both
/// [`shadowed_git_entry_name`] and [`shadowed_rm_entry_name`] use. A no-op if the entry already
/// exists.
fn install_shadow_entry(dir: &Path, entry_name: &str, run_id: &str) -> anyhow::Result<()> {
    let entry = dir.join(entry_name);
    if entry.is_file() {
        return Ok(());
    }
    let shim_bin = resolve_shim_binary()?;
    // NOT a hard link (issue #1861). A link shares the inode of the compiled `flywheel-shim`, so
    // every run's `git` and `rm` entry and the cargo artifact are ONE vnode. On macOS, unlinking a
    // link (a finished run's directory is removed) while another process execs that vnode gets the
    // exec SIGKILLed, with no output. A copy gives each entry its own inode, so nothing a run does
    // to its entry can touch another process's exec.
    fs::copy(&shim_bin, &entry).with_context(|| {
        format!("failed to install the shim entry at {entry:?} for run {run_id:?}")
    })?;

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

/// Verify that `dir.join(entry_name)` is actually usable as a shadowed shim entry: it exists, it
/// is a regular file (never a directory or a dangling path), it is non-empty, and — on Unix — it
/// carries at least one execute bit. Every failure `anyhow::bail!`s with the fixed, greppable
/// prefix `shim install verification failed` (a test can assert on it and a future reader can
/// find every site at once) plus the entry's full path, the run id, and which expectation was not
/// met, so the message is actionable wherever it eventually surfaces (the launch sheet, per
/// D-60).
///
/// Placed immediately after [`install_shadow_entry`] and called only from [`install_for_run`],
/// AFTER both `install_shadow_entry` calls have already returned. The ordering matters:
/// `install_shadow_entry` deliberately returns early when the entry already exists, so a
/// pre-existing broken entry is never re-installed and would otherwise be inherited silently by
/// this run. This verification pass is what makes that fast path safe to keep.
fn verify_shadow_entry(dir: &Path, entry_name: &str, run_id: &str) -> anyhow::Result<()> {
    let entry = dir.join(entry_name);

    if !entry.exists() {
        anyhow::bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} does not exist"
        );
    }
    if !entry.is_file() {
        anyhow::bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} is not a regular file"
        );
    }
    let metadata = fs::metadata(&entry).with_context(|| {
        format!("failed to read metadata for shadow entry {entry:?} for run {run_id:?}")
    })?;
    if metadata.len() == 0 {
        anyhow::bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} is zero bytes"
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 {
            anyhow::bail!(
                "shim install verification failed: entry {entry:?} for run {run_id:?} carries no execute bit (mode {mode:o})"
            );
        }
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
///
/// **D-60 (plan 03-25):** after plan 03-24, `pretooluse-hook.ts`'s PreToolUse hook denies EVERY
/// command — `npm test` and `cargo build` included — in a session whose shadow directory it
/// cannot prove (`shimShadowDirectoryProven`), not only destructive ones. Before this function
/// verified anything, `install_shadow_entry`'s `entry.is_file()` fast path meant a zero-byte
/// file, a non-executable file, or a stale binary all passed silently — a partial or corrupt
/// install would hand a session a shadow directory the hook could never prove, producing exactly
/// the silently-denying session D-60 forbids. [`verify_shadow_entry`] below closes that: a broken
/// entry now stops the install with a named, actionable error at spawn time rather than being
/// inherited. See `planning-archive:.planning/phases/03-nothing-lost-nothing-left-running/
/// 03-DESTRUCTIVE-GATE-BYPASS-CLASS.md` for the finding this responds to.
pub fn install_for_run(run_id: &str) -> anyhow::Result<PathBuf> {
    let dir = shim_dir_for_run(run_id)?;
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create shim directory {dir:?} for run {run_id:?}"))?;

    install_shadow_entry(&dir, shadowed_git_entry_name(), run_id)?;
    install_shadow_entry(&dir, shadowed_rm_entry_name(), run_id)?;

    verify_shadow_entry(&dir, shadowed_git_entry_name(), run_id)?;
    verify_shadow_entry(&dir, shadowed_rm_entry_name(), run_id)?;

    Ok(dir)
}

/// The fixed probe text `verify_shadow_entry_speaks_classification` classifies — CLASSIFIED,
/// never run: `--classify-invocation` is a pure mode (`packages/shim/src/main.rs`'s own module
/// doc comment) that never executes anything, never opens the permission socket and never writes
/// a file, so no `git` process is ever created here, no repository is read and no remote is
/// contacted (D-63). A safe, ordinary command is chosen deliberately over a destructive one
/// (planner_assumptions #3, plan 03-25): a destructive probe text would read, to any future
/// maintainer, as licence to run destructive commands during verification — the exact reading
/// that produced 03-DESTRUCTIVE-GATE-BYPASS-CLASS.md's recorded unauthorized push — and a safe
/// text is also the only one that exercises the two fields this probe actually checks.
const CLASSIFICATION_PROBE_TEXT: &str = "git status";

/// Run the installed shadow entry at `entry` ONCE, through its own `--classify-invocation` mode
/// (never through the shadowed dispatch — this is a direct invocation of the compiled binary,
/// naming the flag itself, exactly like `packages/sidecar/src/pretooluse-hook.ts`'s own caller
/// does), and require its answer to speak plan 03-24's CURRENT classification contract: a `safe`
/// verdict carrying both `textCanShadowPathResolution` and `namesGatedProgram` as booleans.
///
/// This proves three things the structural checks in [`verify_shadow_entry`] cannot: the entry is
/// genuinely the compiled shim (not merely a same-sized executable that happens to sit there), it
/// runs on this machine, and it speaks the CURRENT contract rather than an older one. That third
/// property is the one that matters most (D-59/D-60/T-03-25-03): `pretooluse-hook.ts` reads an
/// unreported field as the unsafe value, so a stale shim binary — every structural check green —
/// would otherwise produce exactly the silently-denying session D-60 forbids. A non-zero exit, no
/// parseable output, a category other than `safe`, or either field absent all `anyhow::bail!` with
/// the same fixed `shim install verification failed` prefix [`verify_shadow_entry`] uses, naming
/// the entry path, the run id, and which expectation was not met.
fn verify_shadow_entry_speaks_classification(entry: &Path, run_id: &str) -> anyhow::Result<()> {
    let output = std::process::Command::new(entry)
        .arg("--classify-invocation")
        .arg(CLASSIFICATION_PROBE_TEXT)
        .output()
        .with_context(|| {
            format!(
                "shim install verification failed: could not run the classification-contract probe against entry {entry:?} for run {run_id:?}"
            )
        })?;

    if !output.status.success() {
        bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} exited non-zero ({}) answering the classification-contract probe: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(first_line) = stdout.lines().find(|line| !line.trim().is_empty()) else {
        bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} printed no output answering the classification-contract probe"
        );
    };

    let parsed: serde_json::Value = serde_json::from_str(first_line.trim()).map_err(|e| {
        anyhow::anyhow!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} printed unparseable output ({e}) answering the classification-contract probe"
        )
    })?;

    if parsed.get("category").and_then(|v| v.as_str()) != Some("safe") {
        bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} did not answer the classification-contract probe with category \"safe\""
        );
    }
    if !parsed
        .get("textCanShadowPathResolution")
        .is_some_and(|v| v.is_boolean())
    {
        bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} is missing the textCanShadowPathResolution field — it predates plan 03-24's classification contract"
        );
    }
    if !parsed
        .get("namesGatedProgram")
        .is_some_and(|v| v.is_boolean())
    {
        bail!(
            "shim install verification failed: entry {entry:?} for run {run_id:?} is missing the namesGatedProgram field — it predates plan 03-24's classification contract"
        );
    }

    Ok(())
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
///
/// **D-59/D-60 (plan 03-25):** immediately after [`install_for_run`] returns and before
/// [`resolve_real_git`], this also runs [`verify_shadow_entry_speaks_classification`] against the
/// installed git entry — the ONE extra process this function pays per session spawn.
/// Deliberately NOT called from [`install_for_run`] itself: that keeps the cost at one process per
/// spawn and zero for callers that merely install a directory without ever spawning a session
/// (`packages/core/tests/lock_contention.rs` is the live example). A shim whose structural checks
/// all pass but that does not speak the CURRENT classification contract — a stale build predating
/// plan 03-24 — is refused here, at spawn time, rather than becoming the silently-denying session
/// D-60 forbids.
pub fn shim_env_for_run(run_id: &str) -> anyhow::Result<HashMap<String, String>> {
    let shim_dir = install_for_run(run_id)?;
    verify_shadow_entry_speaks_classification(&shim_dir.join(shadowed_git_entry_name()), run_id)?;
    let real_git = resolve_real_git()?;
    let real_rm = resolve_real_rm()?;
    let publishing_env = if cfg!(windows) {
        HashMap::new()
    } else {
        install_publishing_tools(&shim_dir, run_id)?
    };

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
    env.extend(publishing_env);
    Ok(env)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn write(dir: &Path, name: &str, bytes: &[u8], mode: u32) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        path
    }

    /// POSITIVE CONTROL for gate run 43842944203: the empty, non-executable stand-in that
    /// `tauri-build` leaves at `target/debug/flywheel-shim` is not picked; the real one behind it
    /// is, and with no real one the error names the stand-in and why.
    #[test]
    fn an_empty_stand_in_is_never_picked_over_a_real_shim() {
        let dir = tempfile::tempdir().unwrap();
        let stand_in = write(dir.path(), "stand-in", b"", 0o644);
        let real = write(dir.path(), "real", b"\x7fELF", 0o755);

        let picked = first_usable_shim(&[stand_in.clone(), real.clone()]).unwrap();
        assert_eq!(picked, real);

        let err = first_usable_shim(std::slice::from_ref(&stand_in))
            .unwrap_err()
            .to_string();
        assert!(err.contains("stand-in"), "{err}");
        assert!(err.contains("empty"), "{err}");
    }

    #[test]
    fn a_non_executable_or_missing_candidate_is_refused_with_its_reason() {
        let dir = tempfile::tempdir().unwrap();
        let no_exec = write(dir.path(), "no-exec", b"data", 0o644);
        let missing = dir.path().join("missing");
        let err = first_usable_shim(&[no_exec, missing])
            .unwrap_err()
            .to_string();
        assert!(err.contains("not executable"), "{err}");
        assert!(err.contains("missing"), "{err}");
    }
}
