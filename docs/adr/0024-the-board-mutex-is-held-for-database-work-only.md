# The board mutex is held for database work only

Decided by Claude under Cyril's delegation in [The git ticks never hold the board lock while git runs, so reads never stall](https://github.com/HighKnow-ai/flywheel/issues/215).

Every IPC command reads and writes the board through one shared connection behind `AppState.db`, a `Mutex<Connection>`. No code holds that mutex while git or any other process runs. Work that runs git takes one of two shapes:

- **Plan, git, write.** Read what the git work needs under the lock, release it, run git with no connection in scope, and take the lock again only to write what git showed. The git-truth ticks (`flywheel_core::git_tick`), the `git_facts` read and the criteria list's branch head work this way. The git half takes no `Connection` argument (`git_facts::read_git_facts`), so the type keeps it off the lock.
- **A side connection.** A command whose core function interleaves its reads, git and writes (a Start, a Resume, a Request changes, a Drop, a worktree Remove or Recreate, an ADR decision, the Needs-you list, the Context packet's size, resolving a pasted identifier, registering or relocating a project) runs on a connection of its own, opened on the same database file (`commands::side_connection`). Merge, Reclaim and the review card already did this. In WAL mode its reads run beside the shared connection's. Its writes are the core's own short transactions, and none of them is held across git.

The mutex used to serialise two such commands on one Story: two Starts could not both pass the Ready check. A per-Story lock (`commands::story_work`) does that now, so work on one Story never waits for work on another.

`packages/desktop/src-tauri/tests/scheduler_lock.rs` enforces this. Its lint reads the desktop and core sources, works out by fixpoint which functions can reach a process spawn, and fails on any such call made while the board guard is alive. It also runs the ticks against a stand-in `git` that parks, and requires that a board read completes while the tick is parked.

We rejected three alternatives:
- **A read-write lock or a connection pool in place of the mutex.** A tick writes, so it would still take the write side across git. And every command would change for a problem that is about where git runs, not about how many connections there are.
- **Splitting every core function that mixes git and writes into a plan and a write.** That is right for the ticks, which run every five seconds. For a launch it means splitting `start_session` and the Context packet builder, a large change for a call the developer makes by hand. The side connection gives the same guarantee without it.
- **Marking the remaining holders as accepted.** The issue's bar is that no code path holds the lock across git, and a list of exceptions would grow without anyone deciding to grow it.

## Consequences

- A Request changes no longer hides the Story from readers between its move to Running and its new session row. A reader can see it Stopped for the few database statements in between. No git runs in that window, since In review means the worktree exists.
- Writes on a side connection wait on SQLite's `busy_timeout` (5 s) instead of on the mutex. Because no write transaction is held across git, the wait is one statement long.
- ~~Synchronous commands still run on Tauri's main thread. A command that runs git there blocks IPC dispatch for as long as git runs, even though it no longer holds the lock. Moving those commands onto the blocking pool is a separate change.~~ Done in the amendment below.

## Amendment: git runs on the blocking pool, and Merge and Reclaim take the Story's lock

Decided by Claude under Cyril's delegation in [No IPC command runs git on the main thread, and Merge and Reclaim take the per-Story lock](https://github.com/HighKnow-ai/flywheel/issues/220).

A sync `#[tauri::command]` runs on the main thread. An async command's body runs on whichever runtime thread polls it. Releasing the lock was not enough: a command that runs git in either place still holds up every other IPC call for as long as git runs. So every command that reaches git or a process is `async`, and that work runs inside `tauri::async_runtime::spawn_blocking(..)`. The command reads what it needs first: the board file's path (`commands::board_path`) or a plan read under the lock. The blocking half then opens its side connection there (`commands::open_beside`).

Merge and Reclaim already ran on a side connection. Now they also take the Story's work lock (`review::merge_with_story_work`, `fleet::reclaim_with_story_work`), so neither can interleave with a Start, Drop or Request changes on the same Story. Reclaim takes one Story's lock at a time, so a batch never holds two and cannot deadlock against another command.

`packages/desktop/src-tauri/tests/command_threads.rs` enforces the first rule. Its lint lists every command that reaches a spawn other than inside a `spawn_blocking(..)` argument. Its behaviour test drives `needs_you_list` and a second command on one thread while a stand-in `git` parks the first, and requires the second to complete. `scheduler_lock.rs` shows that Merge and Reclaim wait on the Story's lock, and that a Start racing a Merge on one Story is serialised.

To make the commands reachable from integration tests, the desktop crate is now a library (`desktop_lib`) plus the `desktop` binary. `main.rs` still builds the app and owns `generate_handler!`.

We rejected `#[tauri::command(async)]` on the unchanged sync functions. That moves the body off the main thread, but onto a runtime worker, so git there still starves the runtime that every async command shares.

## Amendment: blocking waits count as process calls

Decided by Claude under Cyril's delegation in [Starting shaping or a roadmap Round never blocks other IPC while the spawn floor waits](https://github.com/HighKnow-ai/flywheel/issues/235).

A wait blocks the dispatch thread just as git does. That covers a `thread::sleep`, such as the sidecar's spawn floor, and a wait on a channel, a child or a thread (`.recv()` not awaited, `.recv_timeout(..)`, `.wait()`, `.join()`). The `command_threads` lint now seeds its fixpoint with these as well as with process spawns. The 12 commands it found are now async, and the wait runs on the blocking pool:
- the shaping and roadmap launches: `epic_shape`, `shaping_continue`, `milestone_shape`, `milestone_shaping_continue`, `roadmap_revisit`, `epic_confirm_done`, `milestone_confirm_done`
- `stage_close`, which waits on both an interrupt and the floor
- `session_stop`, `session_discard` and `orphan_kill`, which wait on an acknowledgement or a recheck
- `backend_capability_probe`

The `scheduler_lock` lock lint now counts these waits too. It found one more lock holder: `orphan_kill` slept through its recheck under the board lock. It now runs on a side connection.
