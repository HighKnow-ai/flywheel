//! The headless core: the desktop's command handlers, `AppState`, the real sidecar supervisor and
//! the `board:changed` event, served over a localhost WebSocket instead of a webview. The end-to-end
//! harness (`packages/desktop/e2e`) points the real renderer at it, so a test drives the real UI
//! against the real core and the real sidecar. Nothing here forks logic:
//!
//! - the handlers are the app's own, registered from the one `command_roster!` list and dispatched
//!   through Tauri's own IPC path (`tauri::test::get_ipc_response`), so argument decoding, `State`
//!   injection and error mapping are Tauri's;
//! - the sidecar is `sidecar::spawn_sidecar`, so board tool calls, permission requests and session
//!   closes go through the same reader task the app runs;
//! - events are Tauri's own `app.emit`, forwarded as they are.
//!
//! A development and test binary. It is never built by `cargo build`, `tauri build` or the release
//! bundle (`required-features = ["headless"]` in `Cargo.toml`), and a release-profile build of it
//! refuses to compile.
//!
//! SECURITY. It listens on 127.0.0.1 only, on an ephemeral port, and a connection must present the
//! random token it printed at start, so no other local process or web page can drive it. Everything
//! it touches is under one scratch root: a scratch git repository with a local bare remote, a
//! scratch SQLite database and a scratch worktree root. It never reads the developer's own
//! Flywheel data and never touches the keychain.
//!
//! PROTOCOL (JSON text frames). Client to core: `{"id": n, "cmd": "<command>", "args": {..}}`.
//! Core to client: `{"id": n, "ok": <value>}` or `{"id": n, "err": <value>}`, and, unprompted,
//! `{"event": "<name>", "payload": <value>}` for each event in [`FORWARDED_EVENTS`].
//!
//! TRACE. Every command that is not a read, and every board tool call an agent makes, is appended
//! to `<root>/trace.jsonl` as `{"from","to","label"}`, in the order it happened: the e2e flows
//! compare this to the sequence diagram in their flow doc (`docs/flows/`).

#[cfg(not(debug_assertions))]
compile_error!("flywheel-headless is a development and test binary; build it without --release");

use std::collections::HashSet;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use flywheel_desktop_lib::{commands, state::AppState};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Listener, Manager, WebviewWindowBuilder};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

/// The events the renderer's adapter listens to (`adapters/tauri.ts`); a vitest in `adapters/`
/// fails when the two lists differ.
const FORWARDED_EVENTS: &[&str] = &[
    "board:changed",
    "checks:progress",
    "agent:event",
    "menu:action",
];

/// The one call that is not an app command: empties the trace, so seeding stays out of a flow.
const TRACE_RESET: &str = "__trace_reset";

/// The other one: the next scheduler tick that reports changed git facts becomes one trace step.
const TRACE_ARM_TICK: &str = "__trace_arm_tick";

/// Commands that only read. They are left out of the trace: a flow's diagram names what changed the
/// board, and the polling a screen does around it is not a step. A command in neither this list nor
/// a diagram fails the flow, so a new command is classified on purpose, not by accident.
const READ_ONLY: &[&str] = &[
    "actor_list",
    "backend_capability_probe",
    "board_blocked_summary",
    "board_recovery_summary",
    "board_visit",
    "criterion_list",
    "dev_environment_get",
    "epic_list",
    "epic_shaping_rounds",
    "epic_shaping_session",
    "events_activity_trail",
    "events_since_cursor",
    "fleet_blocked_queue",
    "fleet_list",
    "fleet_waiting_rounds",
    "fleet_watch_run",
    "git_facts",
    "git_identifier_resolve",
    "git_truth_focus_story",
    "launch_environment",
    "menu_set_action_enabled",
    "milestone_list",
    "milestone_progress",
    "milestone_shaping_rounds",
    "milestone_shaping_session",
    "needs_you_list",
    "open_command_template",
    "permission_rules_list",
    "project_landing_get",
    "project_list",
    "proposal_list_for_triage",
    "proposal_list_pending",
    "review_file_patch",
    "roadmap_round_read",
    "roster_rows",
    "session_get",
    "session_log_window",
    "session_pending_permissions",
    "session_raw_window",
    "sessions_for_story",
    "sessions_pending_orphans",
    "settings_get",
    "story_context_packet_size",
    "story_get",
    "story_landing",
    "story_latest_session",
    "story_list",
    "story_list_for_project",
    "story_make_ready_offer",
    "story_review",
    "story_session_summaries",
    "story_stopped",
    "task_list",
    "worktree_inventory",
    "worktree_measure",
    "worktree_remove_check",
    "worktree_summary",
];

fn main() {
    // The first thing the core does, so that a start that stalls names its phase (issue #1743).
    let clock = StartClock::new();
    clock.mark("main entered");
    let args: Vec<String> = std::env::args().collect();
    let root = match args.iter().position(|a| a == "--root") {
        Some(i) => PathBuf::from(args.get(i + 1).expect("--root takes a directory")),
        None => std::env::temp_dir().join(format!("flywheel-headless-{}", std::process::id())),
    };
    std::fs::create_dir_all(&root).expect("create the scratch root");
    let root = root.canonicalize().expect("resolve the scratch root");
    clock.mark("scratch root created");

    // Scratch data only, set before anything reads it: the database, the runtime directory and the
    // worktrees all live under `root`. The developer's own git configuration stays out of the
    // scratch repository, so a signing key or a hook cannot change a run.
    std::env::set_var("FLYWHEEL_APP_DATA_DIR", root.join("app-data"));
    std::env::set_var("FLYWHEEL_WORKTREE_ROOT", root.join("worktrees"));
    std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    // `--layout monorepo`: the scratch repository holds the project in its `flywheel/` folder, beside
    // other folders, as the HighKnow monorepo holds Flywheel (issue #1600). The default is a project
    // at the repository root.
    let monorepo = args
        .iter()
        .position(|a| a == "--layout")
        .and_then(|i| args.get(i + 1))
        .is_some_and(|v| v == "monorepo");
    // `--seed-only`: seed the scratch repository and exit. The harness runs this once for each layout and
    // copies the result for every start (`e2e/core.ts`): seeding is nine `git` processes, and at
    // background priority on a loaded Mac each one took a second or more, which was most of a start.
    if args.iter().any(|a| a == "--seed-only") {
        seed_repository(&root, monorepo, &clock);
        return;
    }
    // The app's first step, `startup::adopt_login_path`, before any thread starts. The login shell is
    // a stub that answers with the PATH it was started with: the developer's own shell (rc files,
    // `mise`, a keychain-backed helper) must not change a run, and nothing here may block on it.
    let shell = root.join("login-shell.sh");
    std::fs::write(
        &shell,
        "#!/bin/sh\n# Run the last argument (the `-c` command) in a plain sh: the PATH stays as inherited.\n\
         for last; do :; done\nexec /bin/sh -c \"$last\"\n",
    )
    .expect("write the stub login shell");
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755))
            .expect("make the stub login shell executable");
    }
    std::env::set_var("SHELL", &shell);
    flywheel_desktop_lib::startup::adopt_login_path();
    clock.mark("login path adopted");

    // A restart on the same root (a flow that crashes the core and starts it again) keeps the
    // repository it seeded the first time: the board's rows point at it.
    let repo = if root.join("repo").join(".git").exists() {
        clock.mark("repository found, not seeded");
        root.join("repo")
    } else {
        seed_repository(&root, monorepo, &clock)
    };
    let project = if monorepo {
        repo.join("flywheel")
    } else {
        repo.clone()
    };

    let app = mock_builder()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(flywheel_desktop_lib::command_roster!())
        .build(mock_context(noop_assets()))
        .expect("build the mock app");
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build the mock window");
    clock.mark("mock app and window built");

    // The app's own cold-start path (`startup::boot`): database, launch reconciliation, sidecar,
    // `AppState` and the scheduler. A flow that restarts this core on the same root proves what the
    // app does at launch. The trace records that it ran, so a diagram can show the order.
    let deadline = sidecar_deadline();
    clock.mark(&format!("booting: the sidecar has {deadline:?} to answer"));
    flywheel_desktop_lib::startup::boot_observed(app.handle(), &|step| clock.mark(step), deadline)
        .expect(
            "start the core: run `npm --prefix packages/desktop run e2e`, which stages the sidecar",
        );
    // Only a start that finds an earlier run's trace is a step of a flow: the first start of a root
    // has nothing to reconcile, and its seeding is not part of any flow.
    let trace_path = root.join("trace.jsonl");
    let restarted = trace_path.exists();
    let trace = Arc::new(Trace::open(&trace_path));
    if restarted {
        trace.step("core", "core", "launch_reconciliation");
    }
    let (events, _) = broadcast::channel::<String>(1024);
    for name in FORWARDED_EVENTS {
        let (events, trace) = (events.clone(), Arc::clone(&trace));
        app.listen_any(*name, move |event| {
            let payload: Value = serde_json::from_str(event.payload()).unwrap_or(Value::Null);
            // The scheduler's own emit (`scheduler.rs`): a tick that found the board's facts changed.
            if *name == "board:changed" && payload["entity"] == "git_facts" {
                trace.scheduler_tick();
            }
            if *name == "agent:event" && payload["type"] == "board_tool_request" {
                if let Some(tool) = payload["tool"].as_str() {
                    trace.step("agent", "core", tool);
                }
            }
            let _ = events.send(json!({ "event": name, "payload": payload }).to_string());
        });
    }

    let token = random_token();
    let handle = app.handle().clone();
    tauri::async_runtime::block_on(async move {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind localhost");
        let port = listener.local_addr().expect("bound address").port();
        clock.mark(&format!("listening on 127.0.0.1:{port}"));
        // The one line the harness reads. Everything else this process prints is a log line.
        println!(
            "{}",
            json!({ "ready": true, "port": port, "token": token, "repo": repo, "project": project, "root": root })
        );
        std::io::stdout().flush().ok();

        let server = serve(listener, window, events, trace, token);
        tokio::select! {
            _ = server => {}
            _ = shutdown_signal() => {}
        }
        // The app's own exit order: end every live agent session, then the sidecar.
        if let Some(state) = handle.try_state::<AppState>() {
            if let Some(sidecar) = state.sidecar.as_ref() {
                if let Err(err) = sidecar.shutdown_all_sessions() {
                    eprintln!("flywheel-headless: could not end the live sessions: {err:#}");
                }
                sidecar.kill();
            }
        }
    });
}

/// Resolves when stdin closes (the harness exited or crashed) or on SIGTERM or Ctrl-C.
async fn shutdown_signal() {
    use tokio::io::AsyncReadExt;
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
    let stdin_closed = async {
        let mut sink = [0u8; 256];
        let mut stdin = tokio::io::stdin();
        while matches!(stdin.read(&mut sink).await, Ok(n) if n > 0) {}
    };
    tokio::select! {
        _ = stdin_closed => {}
        _ = term.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
}

/// A scratch git repository with one commit on `main` and a local bare remote named `origin`:
/// what a registered project needs, and nothing of the developer's. Each git call is a phase of the
/// start: a slow `git` (a loaded machine, a throttled disk) shows as the call that took the time.
fn seed_repository(root: &Path, monorepo: bool, clock: &StartClock) -> PathBuf {
    let (remote, repo) = (root.join("remote.git"), root.join("repo"));
    let step = |dir: &Path, args: &[&str]| {
        git(dir, args);
        // The subcommand, and the key of a `config`: the paths are the scratch root's, and long.
        let name = match args {
            ["config", key, ..] => format!("config {key}"),
            _ => args[0].to_string(),
        };
        clock.mark(&format!("git {name} done"));
    };
    step(
        root,
        &[
            "init",
            "--bare",
            "--initial-branch",
            "main",
            remote.to_str().unwrap(),
        ],
    );
    step(
        root,
        &["init", "--initial-branch", "main", repo.to_str().unwrap()],
    );
    step(&repo, &["config", "user.email", "e2e@flywheel.invalid"]);
    step(&repo, &["config", "user.name", "Flywheel e2e"]);
    step(&repo, &["config", "commit.gpgsign", "false"]);
    std::fs::write(
        repo.join("README.md"),
        "# Flywheel e2e scratch repository\n",
    )
    .unwrap();
    if monorepo {
        for folder in ["flywheel", "other"] {
            std::fs::create_dir_all(repo.join(folder)).unwrap();
            std::fs::write(repo.join(folder).join("README.md"), format!("# {folder}\n")).unwrap();
        }
    }
    step(&repo, &["add", "."]);
    step(&repo, &["commit", "-m", "initial commit"]);
    step(
        &repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    step(&repo, &["push", "-u", "origin", "main"]);
    repo
}

/// Through `flywheel_core::git::git_at`, the one place a git command is built
/// (`packages/core/tests/supervisor_cwd.rs`); it fails on a non-zero exit with git's stderr.
fn git(dir: &Path, args: &[&str]) {
    flywheel_core::git::git_at(dir, args).unwrap_or_else(|e| panic!("{e:#}"));
}

/// The sidecar's readiness deadline, scaled by `FLYWHEEL_TEST_TIME_SCALE` as every test budget is (the
/// factor the gate sets for the runner, which is slower than a developer's machine). Unset, or not a
/// positive number, it is the app's own five seconds.
fn sidecar_deadline() -> std::time::Duration {
    let scale = std::env::var("FLYWHEEL_TEST_TIME_SCALE")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|f| f.is_finite() && *f > 0.0)
        .unwrap_or(1.0);
    flywheel_desktop_lib::sidecar::STARTUP_READINESS_TIMEOUT.mul_f64(scale)
}

/// One line on stderr for each phase of the start, with the wall clock and the time since `main`:
/// `flywheel-headless: [start] @<epoch ms> +<ms since main> ms <phase>`. The core's stderr is the
/// core's log, so a start that stalls leaves the last phase it reached in the harness's failure
/// output (`e2e/core-start.ts` reads these lines), where before it left an empty log (issue #1743).
/// The epoch lets the harness set the lines against its own clock: the time from its spawn to the
/// first line is the cost of loading the binary, which no line of the core can show.
struct StartClock {
    began: std::time::Instant,
}

impl StartClock {
    fn new() -> Self {
        Self {
            began: std::time::Instant::now(),
        }
    }

    fn mark(&self, phase: &str) {
        let epoch_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        eprintln!(
            "flywheel-headless: [start] @{epoch_ms} +{} ms {phase}",
            self.began.elapsed().as_millis()
        );
    }
}

/// 128 random bits from the OS, as hex.
fn random_token() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .expect("read /dev/urandom");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The append-only trace file. One line per step, written as it happens.
struct Trace {
    file: Mutex<std::fs::File>,
    tick_armed: AtomicBool,
}

impl Trace {
    fn open(path: &Path) -> Self {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .truncate(false)
            .open(path)
            .expect("create the trace file");
        Self {
            file: Mutex::new(file),
            tick_armed: AtomicBool::new(false),
        }
    }

    /// Forget everything so far: the harness seeds the board first, and the seeding is not a flow.
    fn reset(&self) {
        if let Ok(file) = self.file.lock() {
            let _ = file.set_len(0);
        }
    }

    /// The scheduler reported changed git facts. Traced once, and only after the harness armed it
    /// ([`TRACE_ARM_TICK`]): ticks run on the clock, not on a step, so an unarmed tick would land
    /// in the trace at a random place.
    fn scheduler_tick(&self) {
        if self.tick_armed.swap(false, Ordering::SeqCst) {
            self.step("scheduler", "core", "git_facts_tick");
        }
    }

    fn step(&self, from: &str, to: &str, label: &str) {
        // ONE `write`, with its newline. `writeln!(file, "{line}")` on a bare file is a `write` for each
        // piece the JSON formatter produces, so the harness, which reads this file while a flow runs, saw
        // half a line and `JSON.parse` threw "Unterminated string" (a flow of the gate runner, 2026-11-18).
        let mut line = json!({ "from": from, "to": to, "label": label }).to_string();
        line.push('\n');
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

async fn serve(
    listener: TcpListener,
    window: tauri::WebviewWindow<tauri::test::MockRuntime>,
    events: broadcast::Sender<String>,
    trace: Arc<Trace>,
    token: String,
) {
    let read_only: Arc<HashSet<&'static str>> = Arc::new(READ_ONLY.iter().copied().collect());
    while let Ok((stream, _)) = listener.accept().await {
        let (window, events, trace, token, read_only) = (
            window.clone(),
            events.clone(),
            Arc::clone(&trace),
            token.clone(),
            Arc::clone(&read_only),
        );
        tauri::async_runtime::spawn(async move {
            // The token is in the connection's query string. A page that does not hold it is refused
            // before the upgrade completes. The callback's `Err` type is tungstenite's, not ours.
            #[allow(clippy::result_large_err)]
            let check =
                |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
                    let query = request.uri().query().unwrap_or("");
                    if query
                        .split('&')
                        .any(|pair| pair == format!("token={token}"))
                    {
                        Ok(response)
                    } else {
                        let mut refusal =
                            ErrorResponse::new(Some("wrong or missing token".to_string()));
                        *refusal.status_mut() = StatusCode::FORBIDDEN;
                        Err(refusal)
                    }
                };
            let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, check).await else {
                return;
            };
            let (mut tx, mut rx) = socket.split();
            let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            let writer = tauri::async_runtime::spawn(async move {
                while let Some(frame) = out_rx.recv().await {
                    if tx.send(Message::text(frame)).await.is_err() {
                        break;
                    }
                }
            });
            let forward = {
                let (out_tx, mut events) = (out_tx.clone(), events.subscribe());
                tauri::async_runtime::spawn(async move {
                    while let Ok(frame) = events.recv().await {
                        if out_tx.send(frame).is_err() {
                            break;
                        }
                    }
                })
            };
            while let Some(Ok(message)) = rx.next().await {
                let Message::Text(text) = message else {
                    continue;
                };
                let Ok(call) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                let (window, out_tx, trace, read_only) = (
                    window.clone(),
                    out_tx.clone(),
                    Arc::clone(&trace),
                    Arc::clone(&read_only),
                );
                // Each call on its own task: a long command (a Start waiting on git) must not hold
                // up the reads the screen makes meanwhile, as in the app.
                tauri::async_runtime::spawn(async move {
                    let reply = dispatch(&window, &trace, &read_only, call).await;
                    let _ = out_tx.send(reply.to_string());
                });
            }
            forward.abort();
            writer.abort();
        });
    }
}

/// Run one command through Tauri's own IPC path and shape the reply.
async fn dispatch(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    trace: &Trace,
    read_only: &HashSet<&'static str>,
    call: Value,
) -> Value {
    let id = call["id"].clone();
    let Some(cmd) = call["cmd"].as_str().map(str::to_owned) else {
        return json!({ "id": id, "err": "a call names its command in `cmd`" });
    };
    // The harness's own control, not a command of the app: it is not in the roster.
    if cmd == TRACE_RESET {
        trace.reset();
        return json!({ "id": id, "ok": null });
    }
    if cmd == TRACE_ARM_TICK {
        trace.tick_armed.store(true, Ordering::SeqCst);
        return json!({ "id": id, "ok": null });
    }
    // Traced when it arrives: the order the renderer asked in is the order of the diagram.
    if !read_only.contains(cmd.as_str()) {
        trace.step("ui", "core", &cmd);
    }
    let request = InvokeRequest {
        cmd,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().expect("the app's own origin"),
        body: InvokeBody::Json(call.get("args").cloned().unwrap_or_else(|| json!({}))),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    let window = window.clone();
    // `get_ipc_response` blocks until the handler has answered, so it waits on the blocking pool.
    let answer = tokio::task::spawn_blocking(move || get_ipc_response(&window, request)).await;
    match answer {
        Ok(Ok(body)) => match body.deserialize::<Value>() {
            Ok(value) => json!({ "id": id, "ok": value }),
            Err(e) => json!({ "id": id, "err": format!("unreadable reply: {e}") }),
        },
        Ok(Err(err)) => json!({ "id": id, "err": err }),
        Err(e) => json!({ "id": id, "err": format!("the command panicked: {e}") }),
    }
}
