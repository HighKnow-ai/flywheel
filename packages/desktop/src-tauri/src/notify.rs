//! Phase 10 plan 10-07 (FLEET-05, D-174..D-176, D-181): operating-system notifications for an agent
//! that blocks, finishes or fails.
//!
//! The same split `scheduler.rs` uses: the decisions are pure functions with the clock injected
//! ([`Coalescer`], [`should_suppress`], [`banner_body`]), and a thin shell ([`push`],
//! [`spawn_notify_task`]) owns the timer and the plugin call. The Rust core emits; the window is
//! granted nothing from the notification plugin (D-175), which a test on `capabilities/default.json`
//! enforces.
//!
//! A banner is text only. Click-through is out of scope for this phase (D-181) — no action handler
//! and no payload is attached.

use std::collections::VecDeque;
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

/// The three notifiable transitions. `interrupted` (user-initiated) and `abandoned` (an
/// application-restart artefact) have no representation, so D-174's exclusions are enforced by the
/// type rather than by a filter someone can forget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionKind {
    Blocked,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Transition {
    pub run_id: String,
    pub project_name: String,
    pub subject_label: String,
    pub kind: TransitionKind,
    /// Name of the tool a `Blocked` transition waits on. Deliberately the NAME only: a command, path
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
            Banner::Summary { count, projects, kind } => {
                let what = match kind {
                    Some(TransitionKind::Blocked) => "are blocked",
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
        TransitionKind::Blocked => (
            "is blocked",
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

/// The banner body for a blocked run: the tool name and nothing else. Never any part of the tool's
/// input (command, path, URL): a capped command is still a command, and `export TOKEN=...` puts the
/// secret in the first few characters. The notification centre retains and syncs what it is given.
pub fn banner_body(tool_name: &str) -> String {
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

/// Starts the one task that closes each window and shows the banner.
pub fn spawn_notify_task(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        loop {
            interval.tick().await;
            let Some(state) = app.try_state::<AppState>() else { continue };
            // Focus is read in Rust at fire time: one source of truth, no race with a renderer report.
            let focused = app
                .get_webview_window("main")
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false);
            let watched = state.watched_run.lock().ok().and_then(|w| w.clone());
            let Some(banner) = tick(coalescer(), &state.db, Instant::now(), focused, watched.as_deref())
            else {
                continue;
            };
            let (title, body) = banner.text();
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                eprintln!("notify: could not show a banner: {e}");
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
            (TransitionKind::Blocked, "is blocked"),
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
        co.push(t("a", "api", TransitionKind::Blocked), t0);
        co.push(t("a", "api", TransitionKind::Blocked), t0 + Duration::from_secs(1));
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

    #[test]
    fn a_blocked_banner_never_carries_the_tool_input() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        let mut tr = t("a", "api", TransitionKind::Blocked);
        tr.tool = Some("Bash".into());
        co.push(tr, t0);
        let Some(banner) = drain(&mut co, after(t0)) else { panic!() };
        let (title, body) = banner.text();
        assert_eq!(body, "Bash");
        assert_eq!(title, "api · TASK-02 is blocked");
    }

    #[test]
    fn a_blocked_transition_without_a_tool_still_has_a_body() {
        let (mut co, t0) = (Coalescer::new(COALESCE_WINDOW), Instant::now());
        co.push(t("a", "api", TransitionKind::Blocked), t0);
        let Some(Banner::Single { body, .. }) = drain(&mut co, after(t0)) else { panic!() };
        assert!(!body.is_empty());
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
