//! `update_check` / `update_install` — self-update (DIST-02, D-186, D-187, D-188).
//!
//! Both commands take NO arguments. The endpoint, the public key and the current version all come
//! from the compiled `plugins.updater` config, so a renderer cannot name an update source (T-11-14).
//! The window is granted no `updater:` permission, which keeps the plugin's own `plugin:updater|*`
//! commands unreachable from it; these two are the only way in, through `generate_handler!`.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use super::ipc_error;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckDto {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub current_version: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallDto {
    /// A newer version was downloaded, verified and installed; a relaunch applies it.
    pub staged: bool,
    /// An agent run is live, so nothing was staged.
    pub refused: bool,
    /// How many runs were live when the refusal was made; `0` when not refused.
    pub live_runs: u32,
    pub version: Option<String>,
    pub message: String,
}

impl UpdateInstallDto {
    fn refusal(live_runs: u32) -> Self {
        let noun = if live_runs == 1 { "agent run is" } else { "agent runs are" };
        Self {
            staged: false,
            refused: true,
            live_runs,
            version: None,
            message: format!("Not updating: {live_runs} {noun} still live. Update once they finish."),
        }
    }
}

/// Everything `update_install` needs from the network, behind one seam so the refusal can be
/// tested without one. `Pending` is whatever `check` found, handed on to `download` and `install`.
#[allow(async_fn_in_trait)]
trait UpdateSource {
    type Pending;
    async fn check(&self) -> Result<Option<(String, Self::Pending)>, String>;
    async fn download(&self, pending: &Self::Pending) -> Result<Vec<u8>, String>;
    fn install(&self, pending: &Self::Pending, bytes: Vec<u8>) -> Result<(), String>;
}

/// The live-run count, fleet-wide: `flywheel_core::dispatch::occupied_slots`, whose predicate is
/// the same `status IN ('running', 'blocked')` the fleet uses. The lock is taken and dropped here,
/// so no caller ever holds the database across an `.await`.
fn live_runs(db: &Mutex<rusqlite::Connection>) -> Result<u32, String> {
    let conn = db.lock().map_err(|e| ipc_error("update_install:lock", e))?;
    flywheel_core::dispatch::occupied_slots(&conn).map_err(|e| ipc_error("update_install:count", e))
}

/// D-188's enforcement point: the count is read in Rust BEFORE anything is fetched, and again after
/// the download and BEFORE anything is installed, because the download takes long enough for a run
/// to start. A refusal at either point leaves nothing on disk: the bytes live only in memory until
/// `install` is called. The banner's own check is display only.
async fn guarded_install<S: UpdateSource>(
    db: &Mutex<rusqlite::Connection>,
    source: &S,
) -> Result<UpdateInstallDto, String> {
    let live = live_runs(db)?;
    if live > 0 {
        return Ok(UpdateInstallDto::refusal(live));
    }
    let Some((version, pending)) = source.check().await? else {
        return Ok(UpdateInstallDto {
            staged: false,
            refused: false,
            live_runs: 0,
            version: None,
            message: "Already up to date.".into(),
        });
    };
    let bytes = source.download(&pending).await?;
    let live = live_runs(db)?;
    if live > 0 {
        return Ok(UpdateInstallDto::refusal(live));
    }
    source.install(&pending, bytes)?;
    Ok(UpdateInstallDto {
        staged: true,
        refused: false,
        live_runs: 0,
        message: format!("Flywheel {version} is installed. Relaunch to use it."),
        version: Some(version),
    })
}

struct GithubReleases(AppHandle);

impl UpdateSource for GithubReleases {
    type Pending = tauri_plugin_updater::Update;

    async fn check(&self) -> Result<Option<(String, Self::Pending)>, String> {
        let updater = self.0.updater().map_err(|e| ipc_error("update_install:updater", e))?;
        let found = updater.check().await.map_err(|e| ipc_error("update_install:check", e))?;
        Ok(found.map(|u| (u.version.clone(), u)))
    }

    async fn download(&self, pending: &Self::Pending) -> Result<Vec<u8>, String> {
        // The plugin verifies the ed25519 signature against the compiled pubkey in here.
        pending.download(|_, _| {}, || {}).await.map_err(|e| ipc_error("update_install:download", e))
    }

    fn install(&self, pending: &Self::Pending, bytes: Vec<u8>) -> Result<(), String> {
        pending.install(bytes).map_err(|e| ipc_error("update_install:install", e))
    }
}

/// Ask the release feed whether a newer version exists. A manifest that fails signature
/// verification or cannot be fetched is an `Err`, never "no update" (T-11-13).
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateCheckDto, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| ipc_error("update_check:updater", e))?;
    let found = updater.check().await.map_err(|e| ipc_error("update_check:check", e))?;
    Ok(match found {
        Some(u) => UpdateCheckDto { available: true, version: Some(u.version), notes: u.body, current_version },
        None => UpdateCheckDto { available: false, version: None, notes: None, current_version },
    })
}

/// Download, verify and install a newer version for the next relaunch — refusing while any agent
/// run is live. This is the enforcement point for D-188; the banner's own check is display only.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateInstallDto, String> {
    guarded_install(&state.db, &GithubReleases(app)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Counts every call, so a refusal can be shown to have touched nothing.
    #[derive(Default)]
    struct Fake {
        checks: Cell<u32>,
        downloads: Cell<u32>,
        installs: Cell<u32>,
        /// Start a run between the download and the install, as a real download's duration allows.
        start_run_during_download: Option<std::sync::Arc<Mutex<rusqlite::Connection>>>,
    }

    impl UpdateSource for Fake {
        type Pending = ();
        async fn check(&self) -> Result<Option<(String, ())>, String> {
            self.checks.set(self.checks.get() + 1);
            Ok(Some(("9.9.9".into(), ())))
        }
        async fn download(&self, _: &()) -> Result<Vec<u8>, String> {
            self.downloads.set(self.downloads.get() + 1);
            if let Some(db) = &self.start_run_during_download {
                insert_run(&mut db.lock().unwrap(), "running");
            }
            Ok(vec![1, 2, 3])
        }
        fn install(&self, _: &(), _: Vec<u8>) -> Result<(), String> {
            self.installs.set(self.installs.get() + 1);
            Ok(())
        }
    }

    fn seeded_db() -> rusqlite::Connection {
        let dir = tempfile::tempdir().unwrap();
        let conn = flywheel_core::db::open_and_migrate(&dir.path().join("t.db"), &dir.path().join("b")).unwrap();
        // Keep the tempdir alive for the connection's lifetime: the database file is opened by path.
        std::mem::forget(dir);
        conn
    }

    /// A bare run row (no task, no epic: the shape of an authoring or planning run), which the
    /// fleet-wide count must include. Registers the project on the first call.
    fn insert_run(conn: &mut rusqlite::Connection, status: &str) {
        let human = flywheel_core::domain::actor::local_human_actor_id(conn).unwrap();
        let agent = flywheel_core::domain::agent_run::agent_actor_id(conn).unwrap();
        let now = "2026-10-13T00:00:00.000Z";
        let project_id = match conn.query_row("SELECT id FROM projects LIMIT 1", [], |r| r.get::<_, String>(0)) {
            Ok(id) => id,
            Err(_) => {
                flywheel_core::domain::project::create_project(conn, &human, "Update test", "/tmp/update-test", "UPD", "main")
                    .unwrap()
                    .id
            }
        };
        let (trigger_id, run_id) = (flywheel_core::ids::new_id(), flywheel_core::ids::new_id());
        conn.execute(
            "INSERT INTO triggers (id, project_id, target_task_id, source, config, enabled, last_fired_at, created_by, created_at) \
             VALUES (?1, ?2, NULL, 'user_action', NULL, 1, NULL, ?3, ?4)",
            rusqlite::params![trigger_id, project_id, human, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_runs (id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status, \
                external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path, started_at, ended_at) \
             VALUES (?1, NULL, NULL, ?2, ?3, 'claude_code', ?4, ?5, NULL, 'default', NULL, NULL, NULL, '/tmp/update-test.jsonl', ?6, NULL)",
            rusqlite::params![run_id, project_id, trigger_id, agent, status, now],
        )
        .unwrap();
    }

    #[tokio::test]
    async fn a_live_run_refuses_with_its_count_and_nothing_is_fetched() {
        let db = Mutex::new(seeded_db());
        insert_run(&mut db.lock().unwrap(), "running");
        let fake = Fake::default();
        let out = guarded_install(&db, &fake).await.unwrap();
        assert!(out.refused && !out.staged);
        assert_eq!(out.live_runs, 1);
        assert!(out.message.contains("1 agent run is still live"), "{}", out.message);
        assert_eq!((fake.checks.get(), fake.downloads.get(), fake.installs.get()), (0, 0, 0));
    }

    #[tokio::test]
    async fn a_blocked_run_counts_and_the_count_is_named_in_the_plural() {
        let db = Mutex::new(seeded_db());
        insert_run(&mut db.lock().unwrap(), "running");
        insert_run(&mut db.lock().unwrap(), "blocked");
        insert_run(&mut db.lock().unwrap(), "completed");
        let out = guarded_install(&db, &Fake::default()).await.unwrap();
        assert_eq!(out.live_runs, 2);
        assert!(out.message.contains("2 agent runs are still live"), "{}", out.message);
    }

    #[tokio::test]
    async fn with_no_live_run_the_update_is_downloaded_and_installed() {
        let db = Mutex::new(seeded_db());
        insert_run(&mut db.lock().unwrap(), "completed");
        let fake = Fake::default();
        let out = guarded_install(&db, &fake).await.unwrap();
        assert!(out.staged && !out.refused);
        assert_eq!(out.version.as_deref(), Some("9.9.9"));
        assert_eq!((fake.checks.get(), fake.downloads.get(), fake.installs.get()), (1, 1, 1));
    }

    #[tokio::test]
    async fn a_run_that_starts_during_the_download_still_stops_the_install() {
        let db = std::sync::Arc::new(Mutex::new(seeded_db()));
        let fake = Fake { start_run_during_download: Some(db.clone()), ..Fake::default() };
        let out = guarded_install(&db, &fake).await.unwrap();
        assert!(out.refused && !out.staged);
        assert_eq!(out.live_runs, 1);
        assert_eq!((fake.downloads.get(), fake.installs.get()), (1, 0));
    }

    /// T-11-14, enforced rather than remembered: the window holds no `updater:` permission, so the
    /// plugin's own `plugin:updater|*` commands are unreachable from it. Looks at the granted
    /// identifiers, not the roster prose, which names these commands.
    #[test]
    fn the_window_capability_grants_no_updater_permission() {
        let raw = include_str!("../../capabilities/default.json");
        let caps: serde_json::Value = serde_json::from_str(raw).expect("capability file is JSON");
        let granted: Vec<String> = caps["permissions"]
            .as_array()
            .expect("permissions array")
            .iter()
            .map(|p| p.as_str().or_else(|| p["identifier"].as_str()).unwrap_or_default().to_string())
            .collect();
        assert!(!granted.is_empty());
        assert!(
            granted.iter().all(|g| !g.to_lowercase().contains("updater")),
            "an updater grant reached the window: {granted:?}"
        );
    }

    /// T-11-13: one github.com endpoint over https, a real key, no HighKnow-operated host.
    #[test]
    fn the_compiled_updater_config_is_one_github_endpoint_and_a_key() {
        let raw = include_str!("../../tauri.conf.json");
        let conf: serde_json::Value = serde_json::from_str(raw).expect("tauri.conf.json is JSON");
        let u = &conf["plugins"]["updater"];
        assert!(!u["pubkey"].as_str().unwrap_or_default().is_empty());
        let endpoints = u["endpoints"].as_array().expect("endpoints array");
        assert_eq!(endpoints.len(), 1);
        assert_eq!(
            endpoints[0].as_str(),
            Some("https://github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json")
        );
    }
}
