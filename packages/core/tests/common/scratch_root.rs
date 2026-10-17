//! The one scratch worktree-root helper every test binary shares (issue #42).
//!
//! `FLYWHEEL_WORKTREE_ROOT` is process-global mutable state, and `cargo test` runs a binary's tests
//! on parallel threads: unserialised, one test's root vanished under another mid-write (the race
//! PR #18 fixed once in `worktree_lifecycle.rs`). Every caller goes through this one helper, so
//! the lock below serialises every reader and writer of the var in the process.
//!
//! This file depends only on `std` and `tempfile`, so the desktop crate's unit tests include the
//! same source through a `#[path]` module instead of keeping a copy.

use std::path::Path;
use std::sync::Mutex;

/// Public so the one test that sets the var to a non-scratch path (`worktree_size.rs`'s ignored
/// walk bench) still serialises against every helper call.
#[allow(dead_code)]
pub static WORKTREE_ROOT_ENV_LOCK: Mutex<()> = Mutex::new(());

/// Run `f` with `FLYWHEEL_WORKTREE_ROOT` pointing at a fresh scratch directory, holding the
/// process-wide lock for the whole call. `f` receives that root; the var is cleared and the
/// directory deleted before the lock is released.
#[allow(dead_code)]
pub fn with_scratch_worktree_root<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the lock above serialises every caller in this process, and this helper always
    // clears the var before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f(dir.path());
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}
