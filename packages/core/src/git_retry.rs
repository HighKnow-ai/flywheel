//! D-54's single backoff-and-retry policy for git lock contention, D-52's per-repository spawn
//! floor, and the collision-counting/exhaustion-event machinery both lean on (D-53). This is the
//! ONE module in the workspace that owns a sleep-and-retry loop for git: `git::git_at`
//! (`packages/core/src/git.rs`) routes through [`with_lock_retry`], and the PATH shim binary
//! (`packages/shim/src/main.rs`) depends on this crate and calls the exact same executor — no
//! second policy exists anywhere else (enforced by `packages/core/tests/supervisor_cwd.rs`-style
//! source gates in `packages/core/tests/git_retry.rs`).
//!
//! **Two distinct mitigations, never collapsed into one.** [`SpawnFloor`] targets the
//! worktree-creation-time `config.lock` collision (D-52, WORK-05): the supervisor itself controls
//! *when* a spawn begins, so a real, unbypassable minimum gap between spawns against the same
//! repository is a guarantee, not a probability reduction. [`with_lock_retry`] targets commit-time
//! lock contention (D-51/D-54): the supervisor does NOT control when an agent decides to run `git
//! commit` inside its own session, so the only lever left is retrying the failed invocation itself
//! after a lock collision. The jitter [`retry_policy`] applies is inside the retry curve only —
//! never a substitute for the floor's own hard minimum.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The starting delay for the first retry after a lock collision, in milliseconds. Doubles on
/// each subsequent retry (`RETRY_BASE_MS << (attempt - 1)`). 200ms matches PITFALLS.md's own
/// suggested starting point (the primary-source `#55724` postmortem's 200ms/400ms/800ms curve).
pub const RETRY_BASE_MS: u64 = 200;

/// The total number of attempts [`with_lock_retry`] makes before giving up and returning
/// [`LockExhausted`] — one initial attempt plus `RETRY_MAX_ATTEMPTS - 1` retries. Five, not three,
/// because `#55724` observed 8 of 13 agents failing at 13-way parallelism, which a three-attempt
/// budget (PITFALLS.md's own baseline) would not reliably have covered.
pub const RETRY_MAX_ATTEMPTS: u32 = 5;

/// The upper bound, in milliseconds, of the uniform jitter added to every retry delay — applied
/// so that multiple agents backing off from the same collision do not all wake up and retry in
/// lockstep, re-colliding immediately. Applied inside the curve only; it is never a substitute for
/// [`SpawnFloor`]'s own hard minimum.
pub const RETRY_JITTER_MS: u64 = 120;

/// The minimum gap, in milliseconds, [`SpawnFloor::wait_turn`] enforces between two spawns against
/// the SAME repository (D-52, WORK-05) — a real guarantee the supervisor itself controls, not a
/// probability reduction. Targets the worktree-creation-time `config.lock` collision window,
/// distinct from the commit-time window [`with_lock_retry`] targets (see this module's own doc
/// comment above for why the two are never collapsed into one mitigation).
pub const SPAWN_FLOOR_MS: u64 = 400;

/// The base delay curve summed across all four retries this policy performs
/// (200 + 400 + 800 + 1600 = 3000ms), before jitter: the worst-case wall clock a caller waits
/// through a fully-exhausted retry budget is this sum plus up to `4 * RETRY_JITTER_MS` (480ms) of
/// jitter — about 3.48 seconds worst case. This is the number plan 03-12's session-feed retry row
/// tells the user they are waiting for.
fn retry_delay_ms(failed_attempt: u32) -> u64 {
    let base = RETRY_BASE_MS.saturating_mul(1u64 << (failed_attempt.saturating_sub(1)));
    base + jitter_ms()
}

/// A cheap, non-cryptographic source of jitter — this backoff curve has no security requirement on
/// its randomness, only a desynchronization one, so the current time's own sub-second precision is
/// sufficient and avoids adding a `rand`-family dependency to this crate for one call site.
fn jitter_ms() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()))
        .unwrap_or(0);
    nanos % RETRY_JITTER_MS.max(1)
}

/// `true` when `text` (the stringified error from a failed git invocation) matches git's general
/// lock-failure shape for ANY lock file — never a literal file name. Matches on the text
/// containing a lock-file token AND one of git's own lock-failure phrasings (case-insensitive):
/// "file exists", "unable to create", "cannot lock ref", or "another git process seems to be
/// running". A plain git failure (an unknown revision, a merge conflict) never matches.
///
/// Deliberately broader than the literal commit-time index lock: `#34645`'s worktree-creation
/// collision names a different file (`config.lock`), and a per-worktree index means the contended
/// file at commit time is often a ref lock or a gc-related lock instead (RESEARCH.md Pitfalls 2
/// and 3). Narrowing this match to one literal lock file name would miss both.
pub fn is_lock_contention(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    if !lower.contains(".lock") {
        return false;
    }
    const LOCK_FAILURE_PHRASES: [&str; 4] = [
        "file exists",
        "unable to create",
        "cannot lock ref",
        "another git process seems to be running",
    ];
    LOCK_FAILURE_PHRASES.iter().any(|phrase| lower.contains(phrase))
}

/// The result of a [`with_lock_retry`] call that eventually succeeded — carries the collision
/// count so far (zero when `f` succeeded on its very first invocation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryOutcome<T> {
    pub value: T,
    pub collisions: u32,
}

/// D-53's typed exhaustion error: every attempt within [`RETRY_MAX_ATTEMPTS`] hit a lock
/// collision. Carries the label the caller passed to [`with_lock_retry`] and the total attempt
/// count, so a caller can distinguish this from an ordinary git failure (which is returned
/// unchanged, never wrapped) and raise D-53's board-visible event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockExhausted {
    pub label: String,
    pub attempts: u32,
}

impl std::fmt::Display for LockExhausted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "git lock retry exhausted for {:?} after {} attempts",
            self.label, self.attempts
        )
    }
}

impl std::error::Error for LockExhausted {}

/// Invoke `f` (passed the 1-based attempt number) and return its value the first time it
/// succeeds — `f` is NEVER invoked again after a success. On a NON-lock error, `f`'s error is
/// returned unchanged after exactly one invocation — a real git failure is never retried, and its
/// message is preserved verbatim (`git_at`'s own error text reads as itself). On a lock-shaped
/// error (per [`is_lock_contention`]), the collision counter increments, the caller sleeps the
/// next delay in the curve (see [`retry_delay_ms`]), and the attempt repeats until
/// [`RETRY_MAX_ATTEMPTS`] is reached, at which point a [`LockExhausted`] error is returned instead
/// of the underlying lock error, carrying `label` and the final attempt count.
///
/// A thin wrapper over [`with_lock_retry_notify`] with a no-op notify hook — every EXISTING caller
/// (`git::git_at`, this crate's own test suite) keeps this exact two-argument signature and
/// behaviour, unchanged by plan 03-13's addition below.
pub fn with_lock_retry<T, F>(label: &str, f: F) -> anyhow::Result<RetryOutcome<T>>
where
    F: FnMut(u32) -> anyhow::Result<T>,
{
    with_lock_retry_notify(label, f, |_next_attempt, _max_attempts| {})
}

/// D-53/plan 03-13: the same contract as [`with_lock_retry`], with one additional hook —
/// `on_retry(next_attempt, max_attempts)` is invoked exactly once per backoff sleep, immediately
/// BEFORE the sleep begins. Never invoked on a first-attempt success (a collision that never
/// happened produces no notice at all), never on a non-lock error, and never on the exhaustion
/// path itself (the caller distinguishes that case from this function's own `Err` via the
/// [`LockExhausted`] downcast, exactly as [`with_lock_retry`] already documents) — this hook fires
/// ONLY on the "still retrying" transition, which is the ONE place [`with_lock_retry`] used to
/// have no observable moment at all. The PATH shim (`packages/shim/src/main.rs`) is the one real
/// caller that supplies a non-empty hook (a fire-and-forget permission-socket notice, per
/// `03-UI-SPEC.md`'s "Git lock-retry transient row"); [`with_lock_retry`] itself passes a no-op,
/// so every other caller in this workspace is unaffected by this addition.
pub fn with_lock_retry_notify<T, F, N>(label: &str, mut f: F, mut on_retry: N) -> anyhow::Result<RetryOutcome<T>>
where
    F: FnMut(u32) -> anyhow::Result<T>,
    N: FnMut(u32, u32),
{
    let mut collisions: u32 = 0;
    for attempt in 1..=RETRY_MAX_ATTEMPTS {
        match f(attempt) {
            Ok(value) => return Ok(RetryOutcome { value, collisions }),
            Err(err) => {
                let text = format!("{err:#}");
                if !is_lock_contention(&text) {
                    return Err(err);
                }
                collisions += 1;
                if attempt == RETRY_MAX_ATTEMPTS {
                    return Err(anyhow::Error::new(LockExhausted {
                        label: label.to_string(),
                        attempts: attempt,
                    }));
                }
                on_retry(attempt + 1, RETRY_MAX_ATTEMPTS);
                std::thread::sleep(Duration::from_millis(retry_delay_ms(attempt)));
            }
        }
    }
    unreachable!("the loop above always returns on its final iteration (attempt == RETRY_MAX_ATTEMPTS)");
}

/// Per-run collision counts (D-53): collisions are counted and stay silent while retries succeed —
/// only exhaustion is ever surfaced as a board-visible event. `record`/`take` are the only two
/// operations; there is no way to peek without consuming, matching the "silent unless exhausted"
/// contract this counter exists to support.
#[derive(Debug, Default)]
pub struct CollisionCounter {
    counts: Mutex<HashMap<String, u32>>,
}

impl CollisionCounter {
    pub fn new() -> Self {
        Self {
            counts: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, u32>> {
        match self.counts.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Add `n` collisions to `run_id`'s running total.
    pub fn record(&self, run_id: &str, n: u32) {
        let mut counts = self.lock();
        *counts.entry(run_id.to_string()).or_insert(0) += n;
    }

    /// Remove and return `run_id`'s running total (zero if nothing was ever recorded).
    pub fn take(&self, run_id: &str) -> u32 {
        self.lock().remove(run_id).unwrap_or(0)
    }
}

/// D-53's exact board-visible payload for a lock-exhaustion event — produced ONCE here so the
/// activity-trail entry and the event payload can never drift from each other or from the
/// Copywriting Contract sentence plan 03-12 renders verbatim.
pub fn exhaustion_event_payload(repository: &str, command: &str, attempts: u32) -> serde_json::Value {
    let label =
        format!("Git lock contention: {command} in {repository} failed after {attempts} attempts.");
    serde_json::json!({
        "label": label,
        "repository": repository,
        "command": command,
        "attempts": attempts,
    })
}

/// D-52/WORK-05's per-repository spawn floor: no two spawns against the SAME repository may begin
/// closer together than [`SPAWN_FLOOR_MS`]. Keyed by repository path — two different repositories
/// never gate each other. This is a real guarantee, not a tendency: [`wait_turn`](Self::wait_turn)
/// sleeps the exact remainder (never a fixed sleep, never a probabilistic jitter alone) before
/// ever returning control to its caller.
#[derive(Debug)]
pub struct SpawnFloor {
    last_started: Mutex<HashMap<String, Instant>>,
    floor: Duration,
}

impl Default for SpawnFloor {
    fn default() -> Self {
        Self::new()
    }
}

impl SpawnFloor {
    pub fn new() -> Self {
        Self::with_floor(Duration::from_millis(SPAWN_FLOOR_MS))
    }

    /// A floor of `floor` instead of [`SPAWN_FLOOR_MS`]: a test that has to watch the wait (issue
    /// #235) makes it long enough to see.
    pub fn with_floor(floor: Duration) -> Self {
        Self { last_started: Mutex::new(HashMap::new()), floor }
    }

    /// Returns immediately on the first call for `repo_key`. On a subsequent call for the SAME
    /// key, blocks until at least [`SPAWN_FLOOR_MS`] has elapsed since the previous call for that
    /// key returned. A call for a DIFFERENT key is never delayed by this one. The sleep is
    /// performed WHILE NOT HOLDING the internal mutex — the lock is taken twice (once to compute
    /// the remaining wait, once afterward to record the new start time), so a floor check for one
    /// repository can never block a floor check for another behind a lock it does not need.
    pub fn wait_turn(&self, repo_key: &str) {
        let remaining = {
            let table = self.lock();
            table.get(repo_key).and_then(|&previous| {
                let floor = self.floor;
                let elapsed = previous.elapsed();
                if elapsed < floor {
                    Some(floor - elapsed)
                } else {
                    None
                }
            })
        };

        if let Some(remaining) = remaining {
            std::thread::sleep(remaining);
        }

        let mut table = self.lock();
        table.insert(repo_key.to_string(), Instant::now());
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Instant>> {
        match self.last_started.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}
