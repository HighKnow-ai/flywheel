//! Phase 10 plan 10-07 (FLEET-05, D-174..D-176, D-181): operating-system notifications for an agent
//! that finishes or fails, and (issue #57, docs/mvp-spec.md §4.1) for a request still Waiting on you
//! after about 30 s while the app is unfocused.
//!
//! Waiting on you is not a transition. v0.1 announced a block once, on the `running` -> `blocked`
//! edge, three seconds after the request: the moment the developer had just started the work and
//! was still in the app. Nothing ever looked again, so a request still waiting after he left was
//! never announced, and the edge itself was lost whenever an answer reset the stored status while
//! other requests still waited. [`WaitingWatch`] instead re-reads the waiting requests from the
//! database on every poll and announces each one once, only after [`WAITING_NOTIFY_AFTER`] and only
//! while the window is unfocused.
//!
//! The same split `scheduler.rs` uses: the decisions are pure functions with the clock injected
//! ([`Coalescer`], [`should_suppress`], [`banner_body`]), and a thin shell ([`push`],
//! [`spawn_notify_task`]) owns the timer and the plugin call. The Rust core emits; the window is
//! granted nothing from the notification plugin (D-175), which a test on `capabilities/default.json`
//! enforces.
//!
//! A banner is text only. Click-through is out of scope for this phase (D-181) — no action handler
//! and no payload is attached.

use std::collections::{HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::state::AppState;

/// How long a burst is gathered before one banner is shown. A fan-out wave (up to 8) lands inside a
/// couple of seconds; this is long enough to merge it and short enough that a lone block is not
/// noticeably late.
pub const COALESCE_WINDOW: Duration = Duration::from_secs(3);
/// Longest tool name a banner body carries, in characters.
pub const TOOL_CAP: usize = 32;
/// More banners than this inside [`BURST_SPAN`] is logged (Pitfall 5: a macOS banner can park a
/// thread). Coalescing keeps the count low; this makes a regression visible.
const BURST_BOUND: usize = 6;
const BURST_SPAN: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_millis(500);

/// What a banner announces. `interrupted` (user-initiated) and `abandoned` (an application-restart
/// artefact) have no representation, so D-174's exclusions are enforced by the type rather than by
/// a filter someone can forget. `Waiting` is never pushed through the [`Coalescer`]: only
/// [`WaitingWatch`] builds it, from the requests that are waiting right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionKind {
    Waiting,
    Completed,
    Failed,
}

/// How long a request waits unanswered before a banner may announce it (docs/mvp-spec.md §4.1).
pub const WAITING_NOTIFY_AFTER: Duration = Duration::from_secs(30);
/// How often the waiting requests are re-read while the window is unfocused.
const WAITING_POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq)]
pub struct Transition {
    pub run_id: String,
    pub project_name: String,
    pub subject_label: String,
    pub kind: TransitionKind,
    /// Name of the tool a `Waiting` banner waits on. Deliberately the NAME only: a command, path
    /// or URL can carry a secret, and the OS notification centre persists and syncs off-device.
    pub tool: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Banner {
    Single { title: String, body: String },
    /// `kind` is `None` when the burst mixed kinds.
    Summary { count: usize, projects: Vec<String>, kind: Option<TransitionKind> },
}

impl Banner {
    /// The banner's text: `(title, body)`.
    pub fn text(&self) -> (String, String) {
        match self {
            Banner::Single { title, body } => (title.clone(), body.clone()),
            Banner::Summary { count, projects, kind: Some(TransitionKind::Waiting) } => {
                (format!("{count} requests are waiting on you"), projects.join(" · "))
            }
            Banner::Summary { count, projects, kind } => {
                let what = match kind {
                    Some(TransitionKind::Waiting) => "are waiting on you",
                    Some(TransitionKind::Completed) => "finished",
                    Some(TransitionKind::Failed) => "failed",
                    None => "changed state",
                };
                (format!("{count} agents {what}"), projects.join(" · "))
            }
        }
    }
}

fn single(t: &Transition) -> Banner {
    let (state, body) = match t.kind {
        TransitionKind::Waiting => (
            "is waiting on you",
            match &t.tool {
                Some(tool) => banner_body(tool),
                None => "Waiting on a permission request.".to_string(),
            },
        ),
        TransitionKind::Completed => ("has finished", "Ready for you to look at.".to_string()),
        TransitionKind::Failed => ("has failed", "The run ended with an error.".to_string()),
    };
    Banner::Single { title: format!("{} · {} {state}", t.project_name, t.subject_label), body }
}

fn cap(raw: &str, max: usize) -> String {
    // One line, single spaces: a banner is not the place for a multi-line command.
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut cut: String = flat.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

/// The banner body for a waiting request: the tool name and nothing else. Never any part of the tool's
/// input (command, path, URL): a capped command is still a command, and `export TOKEN=...` puts the
/// secret in the first few characters. The notification centre retains and syncs what it is given.
pub fn banner_body(tool_name: &str) -> String {
    // Issue #100: a question is the agent asking, not a tool waiting for permission.
    if flywheel_core::domain::question::is_question(tool_name) {
        return "The agent has a question for you.".to_string();
    }
    let tool = cap(tool_name, TOOL_CAP);
    if tool.is_empty() { "a tool".to_string() } else { tool }
}

/// A banner is withheld for exactly two reasons: the user's switch is off, or the user is already
/// looking at that run's session on a focused window. The fleet surface is not a watched run, so a
/// banner still fires while it is open (D-174).
pub fn should_suppress(enabled: bool, window_focused: bool, watched_run: Option<&str>, run_id: &str) -> bool {
    !enabled || (window_focused && watched_run == Some(run_id))
}

pub struct Coalescer {
    window: Duration,
    pending: Vec<(Instant, Transition)>,
    shown: VecDeque<Instant>,
}

impl Coalescer {
    pub fn new(window: Duration) -> Self {
        Self { window, pending: Vec::new(), shown: VecDeque::new() }
    }

    /// An identical run-and-kind pair inside the window collapses to one (Pitfall 3).
    pub fn push(&mut self, t: Transition, now: Instant) {
        if self.pending.iter().any(|(_, p)| p.run_id == t.run_id && p.kind == t.kind) {
            return;
        }
        self.pending.push((now, t));
    }

    /// True once the oldest pending transition has waited out the window.
    pub fn is_due(&self, now: Instant) -> bool {
        self.pending.first().is_some_and(|(at, _)| now.duration_since(*at) >= self.window)
    }

    /// Drain the burst if its window has closed, drop the transitions `keep` refuses, and fold the
    /// rest into one banner: a single transition reads as itself, several as one summary.
    pub fn take_due(&mut self, now: Instant, keep: impl Fn(&Transition) -> bool) -> Option<Banner> {
        if !self.is_due(now) {
            return None;
        }
        let kept: Vec<Transition> =
            self.pending.drain(..).map(|(_, t)| t).filter(|t| keep(t)).collect();
        match kept.as_slice() {
            [] => None,
            [only] => Some(single(only)),
            all => {
                let mut projects: Vec<String> = Vec::new();
                for t in all {
                    if !projects.contains(&t.project_name) {
                        projects.push(t.project_name.clone());
                    }
                }
                let kind = all.iter().all(|t| t.kind == all[0].kind).then_some(all[0].kind);
                Some(Banner::Summary { count: all.len(), projects, kind })
            }
        }
    }

    /// Records one banner shown; returns how many were shown inside [`BURST_SPAN`].
    fn record_shown(&mut self, now: Instant) -> usize {
        self.shown.push_back(now);
        while self.shown.front().is_some_and(|at| now.duration_since(*at) > BURST_SPAN) {
            self.shown.pop_front();
        }
        self.shown.len()
    }
}

/// One request Waiting on you, as the poll reads it: what a banner may name, and when it was raised.
/// Never the tool's input (see [`banner_body`]).
#[derive(Debug, Clone, PartialEq)]
pub struct WaitingRequest {
    pub request_id: String,
    pub project_name: String,
    pub story_key: String,
    pub tool_name: String,
    /// RFC 3339, as `permission_requests.created_at` stores it.
    pub created_at: String,
}

/// Which waiting requests have been announced. Pure: the clock, the focus and the switch are passed
/// in, and the waiting requests are whatever the database holds at that moment, so a request that
/// was answered simply stops being offered.
#[derive(Debug, Default)]
pub struct WaitingWatch {
    announced: HashSet<String>,
}

impl WaitingWatch {
    pub fn new() -> Self {
        Self::default()
    }

    /// The banner for the requests that have waited at least [`WAITING_NOTIFY_AFTER`] and were not
    /// yet announced, or `None`. Never while the window is focused: those requests stay unannounced
    /// and are offered again on the next poll, so leaving the app later still announces them. Each
    /// request is announced at most once.
    pub fn take_due(
        &mut self,
        waiting: &[WaitingRequest],
        now: chrono::DateTime<chrono::Utc>,
        window_focused: bool,
        enabled: bool,
    ) -> Option<Banner> {
        self.announced.retain(|id| waiting.iter().any(|w| &w.request_id == id));
        if window_focused || !enabled {
            return None;
        }
        let due: Vec<&WaitingRequest> = waiting
            .iter()
            .filter(|w| !self.announced.contains(&w.request_id) && has_waited_long_enough(&w.created_at, now))
            .collect();
        for w in &due {
            self.announced.insert(w.request_id.clone());
        }
        match due.as_slice() {
            [] => None,
            [only] => Some(Banner::Single {
                title: format!("{} · {} is waiting on you", only.project_name, only.story_key),
                body: banner_body(&only.tool_name),
            }),
            all => {
                let mut projects: Vec<String> = Vec::new();
                for w in all {
                    if !projects.contains(&w.project_name) {
                        projects.push(w.project_name.clone());
                    }
                }
                Some(Banner::Summary { count: all.len(), projects, kind: Some(TransitionKind::Waiting) })
            }
        }
    }
}

/// Whether a request raised at `created_at` has waited [`WAITING_NOTIFY_AFTER`] by `now`. A
/// timestamp that does not parse counts as old enough: announcing a request is better than missing it.
fn has_waited_long_enough(created_at: &str, now: chrono::DateTime<chrono::Utc>) -> bool {
    match chrono::DateTime::parse_from_rfc3339(created_at) {
        Ok(at) => {
            now.signed_duration_since(at.with_timezone(&chrono::Utc)).to_std().unwrap_or(Duration::ZERO)
                >= WAITING_NOTIFY_AFTER
        }
        Err(_) => true,
    }
}

/// One poll of the waiting requests, with every input explicit so a test can drive it. While the
/// window is focused it returns at once, without touching the database. Otherwise it reads the
/// waiting requests (the same derived read the queue shows) and the switch, then asks the watch.
pub fn waiting_tick(
    watch: &Mutex<WaitingWatch>,
    db: &Mutex<Connection>,
    now: chrono::DateTime<chrono::Utc>,
    window_focused: bool,
) -> Option<Banner> {
    if window_focused {
        return None;
    }
    let (waiting, enabled) = {
        let conn = db.lock().ok()?;
        let waiting: Vec<WaitingRequest> =
            flywheel_core::query::fleet::blocked_queue(&conn, flywheel_core::query::fleet::BLOCKED_QUEUE_MAX_LIMIT)
                .ok()?
                .into_iter()
                .map(|e| WaitingRequest {
                    request_id: e.request_id,
                    project_name: e.project_name,
                    story_key: e.story_key,
                    tool_name: e.tool_name,
                    created_at: e.created_at,
                })
                .collect();
        let enabled = flywheel_core::domain::settings::notifications_enabled(&conn).unwrap_or(true);
        (waiting, enabled)
    };
    watch.lock().ok()?.take_due(&waiting, now, window_focused, enabled)
}

/// One tick of the shell, with every input explicit so a test can drive it. The switch is read
/// from the database HERE, at fire time, so toggling it takes effect on the next transition with no
/// restart. A failed read degrades to enabled, like the setting itself.
pub fn tick(
    co: &Mutex<Coalescer>,
    db: &Mutex<Connection>,
    now: Instant,
    window_focused: bool,
    watched_run: Option<&str>,
) -> Option<Banner> {
    if !co.lock().ok()?.is_due(now) {
        return None;
    }
    let enabled = db
        .lock()
        .ok()
        .and_then(|conn| flywheel_core::domain::settings::notifications_enabled(&conn).ok())
        .unwrap_or(true);
    let mut co = co.lock().ok()?;
    let banner = co.take_due(now, |t| !should_suppress(enabled, window_focused, watched_run, &t.run_id))?;
    if co.record_shown(now) > BURST_BOUND {
        eprintln!("notify: more than {BURST_BOUND} banners in {}s", BURST_SPAN.as_secs());
    }
    Some(banner)
}

fn coalescer() -> &'static Mutex<Coalescer> {
    static CO: OnceLock<Mutex<Coalescer>> = OnceLock::new();
    CO.get_or_init(|| Mutex::new(Coalescer::new(COALESCE_WINDOW)))
}

/// Queue one transition. Infallible by signature: both call sites carry a must-never-panic
/// contract, so a poisoned lock is logged and swallowed here.
pub fn push(t: Transition) {
    match coalescer().lock() {
        Ok(mut co) => co.push(t, Instant::now()),
        Err(e) => eprintln!("notify: coalescer lock poisoned: {e}"),
    }
}

/// Closes the due window, if any, and shows its banner. Blocking by nature: `tick` locks the
/// database (which a scheduler tick can hold for a long time) and `.show()` is a synchronous call
/// into the OS that can park a thread (Pitfall 5), so this runs only on the blocking pool.
fn show_due_banner(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    // Focus is read in Rust at fire time: one source of truth, no race with a renderer report.
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    let watched = state.watched_run.lock().ok().and_then(|w| w.clone());
    let Some(banner) = tick(coalescer(), &state.db, Instant::now(), focused, watched.as_deref()) else {
        return;
    };
    let (title, body) = banner.text();
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notify: could not show a banner: {e}");
    }
}

fn waiting_watch() -> &'static Mutex<WaitingWatch> {
    static WATCH: OnceLock<Mutex<WaitingWatch>> = OnceLock::new();
    WATCH.get_or_init(|| Mutex::new(WaitingWatch::new()))
}

/// Polls the waiting requests and shows their banner, if one is due. Blocking for the same reasons
/// as [`show_due_banner`], so it too runs only on the blocking pool.
fn show_waiting_banner(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    let Some(banner) = waiting_tick(waiting_watch(), &state.db, chrono::Utc::now(), focused) else {
        return;
    };
    let (title, body) = banner.text();
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notify: could not show a banner: {e}");
    }
}

/// Starts the one task that closes each window and shows the banner. The async side only asks
/// whether a window is due (a brief in-memory lock); everything that can block goes to
/// `spawn_blocking`, so a held database mutex or a slow banner parks a pool thread, never a tokio
/// worker.
pub fn spawn_notify_task(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        let mut last_waiting_poll = Instant::now();
        loop {
            interval.tick().await;
            if last_waiting_poll.elapsed() >= WAITING_POLL {
                last_waiting_poll = Instant::now();
                let app = app.clone();
                if let Err(e) = tauri::async_runtime::spawn_blocking(move || show_waiting_banner(&app)).await {
                    eprintln!("notify: the waiting poll failed: {e}");
                }
            }
            let due = coalescer().lock().map(|co| co.is_due(Instant::now())).unwrap_or(false);
            if !due {
                continue;
            }
            let app = app.clone();
            if let Err(e) = tauri::async_runtime::spawn_blocking(move || show_due_banner(&app)).await {
                eprintln!("notify: the banner task failed: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(run: &str, project: &str, kind: TransitionKind) -> Transition {
        Transition {
            run_id: run.into(),
            project_name: project.into(),
            subject_label: "TASK-02".into(),
            kind,
            tool: None,
        }
    }

    fn after(start: Instant) -> Instant {
        start + COALESCE_WINDOW
    }

    fn drain(co: &mut Coalescer, now: Instant) -> Option<Banner> {
        co.take_due(now, |_| true)
    }

    #[test]
    fn the_window_is_three_seconds() {
        assert_eq!(COALESCE_WINDOW, Duration::from_secs(3));
    }

    #[test]
    fn a_window_that_has_not_closed_yields_nothing() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "api", TransitionKind::Completed), t0);
        assert_eq!(drain(&mut co, t0 + Duration::from_secs(1)), None);
        assert!(drain(&mut co, after(t0)).is_some());
    }

    #[test]
    fn one_transition_is_one_single_banner_naming_project_subject_and_state() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "api", TransitionKind::Completed), t0);
        let Some(Banner::Single { title, .. }) = drain(&mut co, after(t0)) else { panic!("not single") };
        assert_eq!(title, "api · TASK-02 has finished");
        assert_eq!(drain(&mut co, after(t0)), None, "the burst is drained");
    }

    #[test]
    fn the_state_word_follows_the_kind() {
        for (kind, word) in [
            (TransitionKind::Completed, "has finished"),
            (TransitionKind::Failed, "has failed"),
        ] {
            let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
            co.push(t("a", "api", kind), t0);
            let Some(Banner::Single { title, .. }) = drain(&mut co, after(t0)) else { panic!() };
            assert!(title.ends_with(word), "{title}");
        }
    }

    #[test]
    fn three_transitions_are_one_summary_with_distinct_projects() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "web", TransitionKind::Completed), t0);
        co.push(t("b", "api", TransitionKind::Completed), t0);
        co.push(t("c", "web", TransitionKind::Completed), t0);
        let banner = drain(&mut co, after(t0)).expect("a banner");
        assert_eq!(
            banner,
            Banner::Summary {
                count: 3,
                projects: vec!["web".into(), "api".into()],
                kind: Some(TransitionKind::Completed)
            }
        );
        assert_eq!(banner.text(), ("3 agents finished".to_string(), "web · api".to_string()));
    }

    #[test]
    fn a_mixed_burst_has_no_single_kind() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "web", TransitionKind::Completed), t0);
        co.push(t("b", "api", TransitionKind::Failed), t0);
        assert!(matches!(drain(&mut co, after(t0)), Some(Banner::Summary { kind: None, count: 2, .. })));
    }

    #[test]
    fn the_same_run_and_kind_twice_collapses_to_one() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "api", TransitionKind::Completed), t0);
        co.push(t("a", "api", TransitionKind::Completed), t0 + Duration::from_secs(1));
        assert!(matches!(drain(&mut co, after(t0)), Some(Banner::Single { .. })));
    }

    #[test]
    fn suppressed_transitions_are_dropped_and_the_rest_still_show() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "web", TransitionKind::Completed), t0);
        co.push(t("b", "api", TransitionKind::Completed), t0);
        let banner = co.take_due(after(t0), |tr| tr.run_id != "a");
        assert!(matches!(banner, Some(Banner::Single { .. })));
        co.push(t("a", "web", TransitionKind::Completed), t0);
        assert_eq!(co.take_due(after(t0), |_| false), None);
    }

    #[test]
    fn suppression_needs_the_switch_off_or_a_focused_window_on_that_very_run() {
        assert!(should_suppress(true, true, Some("r"), "r"));
        assert!(!should_suppress(true, false, Some("r"), "r"), "unfocused window");
        assert!(!should_suppress(true, true, Some("other"), "r"), "a different run is watched");
        assert!(!should_suppress(true, true, None, "r"), "the fleet surface is not a watched run");
        for focused in [true, false] {
            for watched in [None, Some("r"), Some("x")] {
                assert!(should_suppress(false, focused, watched, "r"), "switch off");
            }
        }
    }

    #[test]
    fn a_body_is_the_tool_name_alone_and_one_line() {
        assert_eq!(banner_body("Bash"), "Bash");
        assert_eq!(banner_body(""), "a tool");
        assert_eq!(banner_body("  \n "), "a tool");
        assert_eq!(banner_body("a\n  b\tc"), "a b c");
        let long = banner_body(&"x".repeat(500));
        assert!(long.chars().count() <= TOOL_CAP);
    }

    fn waiting(id: &str, project: &str, created_at: &str) -> WaitingRequest {
        WaitingRequest {
            request_id: id.into(),
            project_name: project.into(),
            story_key: "STO-1".into(),
            tool_name: "Bash".into(),
            created_at: created_at.into(),
        }
    }

    fn at(rfc3339: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(rfc3339).unwrap().with_timezone(&chrono::Utc)
    }

    const RAISED: &str = "2026-10-19T10:00:00+00:00";

    #[test]
    fn the_wait_before_a_banner_is_thirty_seconds() {
        assert_eq!(WAITING_NOTIFY_AFTER, Duration::from_secs(30));
    }

    #[test]
    fn a_request_is_announced_after_thirty_seconds_unanswered_while_unfocused() {
        let mut watch = WaitingWatch::new();
        let w = [waiting("r1", "api", RAISED)];
        assert_eq!(watch.take_due(&w, at("2026-10-19T10:00:29+00:00"), false, true), None, "29 s is too soon");
        let banner = watch.take_due(&w, at("2026-10-19T10:00:30+00:00"), false, true).expect("a banner at 30 s");
        assert_eq!(banner.text(), ("api · STO-1 is waiting on you".to_string(), "Bash".to_string()));
        assert_eq!(watch.take_due(&w, at("2026-10-19T10:05:00+00:00"), false, true), None, "announced once");
    }

    #[test]
    fn a_request_is_never_announced_while_the_app_is_focused_and_is_once_it_is_left() {
        let mut watch = WaitingWatch::new();
        let w = [waiting("r1", "api", RAISED)];
        for later in ["2026-10-19T10:00:30+00:00", "2026-10-19T10:10:00+00:00"] {
            assert_eq!(watch.take_due(&w, at(later), true, true), None, "focused: never");
        }
        assert!(watch.take_due(&w, at("2026-10-19T10:10:02+00:00"), false, true).is_some(), "left: announced");
    }

    #[test]
    fn an_answered_request_is_not_announced() {
        let mut watch = WaitingWatch::new();
        assert_eq!(watch.take_due(&[], at("2026-10-19T10:01:00+00:00"), false, true), None);
    }

    #[test]
    fn the_switch_off_announces_nothing() {
        let mut watch = WaitingWatch::new();
        let w = [waiting("r1", "api", RAISED)];
        assert_eq!(watch.take_due(&w, at("2026-10-19T10:01:00+00:00"), false, false), None);
    }

    #[test]
    fn several_due_requests_are_one_summary() {
        let mut watch = WaitingWatch::new();
        let w = [waiting("r1", "web", RAISED), waiting("r2", "api", RAISED), waiting("r3", "web", RAISED)];
        let banner = watch.take_due(&w, at("2026-10-19T10:01:00+00:00"), false, true).expect("a banner");
        assert_eq!(banner.text(), ("3 requests are waiting on you".to_string(), "web · api".to_string()));
    }

    #[test]
    fn a_waiting_banner_never_carries_the_tool_input() {
        let mut watch = WaitingWatch::new();
        let mut w = waiting("r1", "api", RAISED);
        w.tool_name = "Bash".into();
        let banner = watch.take_due(&[w], at("2026-10-19T10:01:00+00:00"), false, true).unwrap();
        assert_eq!(banner.text().1, "Bash");
    }

    /// Focused, the poll returns before it takes the database lock: a held lock cannot delay it.
    #[test]
    fn a_focused_poll_never_touches_the_database() {
        let db = seeded_db();
        let watch = Mutex::new(WaitingWatch::new());
        let _held = db.lock().unwrap();
        assert_eq!(waiting_tick(&watch, &db, at("2026-10-19T10:05:00+00:00"), true), None);
    }

    #[test]
    fn a_burst_past_the_bound_is_counted() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        let counts: Vec<usize> = (0..3).map(|i| co.record_shown(t0 + Duration::from_secs(i))).collect();
        assert_eq!(counts, vec![1, 2, 3]);
        assert_eq!(co.record_shown(t0 + Duration::from_secs(200)), 1, "old entries age out");
    }

    fn seeded_db() -> Mutex<Connection> {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn =
            flywheel_core::db::open_and_migrate(&dir.path().join("t.db"), &dir.path().join("backups"))
                .expect("migrate");
        std::mem::forget(dir);
        let actor = flywheel_core::domain::actor::local_human_actor_id(&conn).expect("actor");
        flywheel_core::domain::settings::set_notifications_enabled(&mut conn, &actor, true).expect("set");
        Mutex::new(conn)
    }

    #[test]
    fn the_switch_is_read_at_fire_time_so_a_toggle_needs_no_restart() {
        let db = seeded_db();
        let co = Mutex::new(Coalescer::new(COALESCE_WINDOW));
        let t0 = Instant::now();

        co.lock().unwrap().push(t("a", "api", TransitionKind::Completed), t0);
        assert!(tick(&co, &db, after(t0), false, None).is_some(), "on: the banner fires");

        {
            let mut conn = db.lock().unwrap();
            let actor = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
            flywheel_core::domain::settings::set_notifications_enabled(&mut conn, &actor, false).unwrap();
        }
        co.lock().unwrap().push(t("b", "api", TransitionKind::Completed), t0);
        assert!(tick(&co, &db, after(t0), false, None).is_none(), "off: the second one is honoured");
    }

    #[test]
    fn a_focused_watched_run_is_suppressed_at_fire_time_and_the_fleet_is_not() {
        let db = seeded_db();
        let co = Mutex::new(Coalescer::new(COALESCE_WINDOW));
        let t0 = Instant::now();
        co.lock().unwrap().push(t("a", "api", TransitionKind::Completed), t0);
        assert!(tick(&co, &db, after(t0), true, Some("a")).is_none());
        co.lock().unwrap().push(t("a", "api", TransitionKind::Completed), t0);
        assert!(tick(&co, &db, after(t0), true, None).is_some());
    }

    /// D-175's threat control, enforced rather than remembered: the window is granted nothing from
    /// the notification plugin. Looks at the granted permission identifiers, not the prose of the
    /// roster description (which names the commands that touch the setting).
    #[test]
    fn the_window_capability_grants_no_notification_permission() {
        let raw = include_str!("../capabilities/default.json");
        let caps: serde_json::Value = serde_json::from_str(raw).expect("capability file is JSON");
        let granted: Vec<String> = caps["permissions"]
            .as_array()
            .expect("permissions array")
            .iter()
            .map(|p| p.as_str().or_else(|| p["identifier"].as_str()).unwrap_or_default().to_string())
            .collect();
        assert!(!granted.is_empty());
        assert!(
            granted.iter().all(|g| !g.to_lowercase().contains("notification")),
            "a notification grant reached the window: {granted:?}"
        );
    }
}
