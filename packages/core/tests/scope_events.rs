//! PLAN-05 (phase 09 plan 09-02): a refused out-of-set write is a board event, not a silent block.
//!
//! Two paths raise `task.scope_denied`, and the board must be able to tell them apart:
//!
//! - the **hook path**: the PreToolUse scope hook refuses a file-tool write and sends a notice that
//!   the Rust reader turns into a row (`record_scope_denied`);
//! - the **backstop path**: at session close the declared set is compared with what git says
//!   changed (`scope_backstop_*`), which is what makes "no refusal is silent" a claim rather than a
//!   hope when a notice is lost.
//!
//! # What the two halves together do and do not cover
//!
//! **Preventive for the file-writing tools only; detective for everything else.** The hook matcher
//! is `Write|Edit|MultiEdit|NotebookEdit`; a write made through `Bash` (`echo >`, `sed -i`, a
//! package manager rewriting a lockfile) never reaches the hook, so it is only *detected* at close.
//!
//! **The residual, stated plainly: a change created and then reverted inside one session is covered
//! by neither half.** The hook never saw it (it was made through `Bash`) and by close the tree is
//! clean, so git has nothing to report. Nothing here claims the guarantee is total.

mod common;

use common::with_scratch_worktree_root;

use std::path::{Path, PathBuf};
use std::process::Command;

use core::domain::agent_run::{start_agent_run, AgentRun};
use core::domain::file_set::{
    declare_file_set, record_backstop_denials, record_scope_denied, ScopeDenial, EVENT_SCOPE_DENIED,
};
use core::domain::task::create_task;
use core::domain::worktree::worktree_for_task;
use core::drift::{scope_backstop_findings, scope_backstop_git, scope_backstop_inputs};
use core::file_set::parse_entry;
use core::query::scope::scope_denied_counts;
use rusqlite::{params, Connection};

struct Fixture {
    conn: Connection,
    actor: String,
    project_id: String,
    _repo: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let (conn, actor, project, repo) = common::seeded_git_project();
    Fixture { conn, actor, project_id: project.id, _repo: repo }
}

/// A task with a started run (and therefore a real worktree). `declared` is stored BEFORE the run
/// starts, as the app does.
fn task_with_run(fx: &mut Fixture, title: &str, declared: &[&str]) -> (String, AgentRun, PathBuf) {
    let task = create_task(&mut fx.conn, &fx.project_id, &fx.actor, title, None).unwrap();
    if !declared.is_empty() {
        let entries: Vec<_> = declared.iter().map(|r| parse_entry(r).unwrap()).collect();
        declare_file_set(&mut fx.conn, &task.id, &entries, &fx.actor).unwrap();
    }
    let run = start_agent_run(&mut fx.conn, &task.id, "default", &fx.actor).unwrap();
    let wt = worktree_for_task(&fx.conn, &task.id).unwrap().expect("worktree exists after run start");
    (task.id, run, PathBuf::from(wt.path))
}

fn denial(path: &str, outside: bool, after_the_fact: bool) -> ScopeDenial {
    ScopeDenial {
        path: path.to_string(),
        tool: "Write".to_string(),
        tool_use_id: "toolu_1".to_string(),
        outside_worktree: outside,
        detected_after_the_fact: after_the_fact,
    }
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("spawn git");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
}

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn denial_rows(conn: &Connection, task_id: &str) -> Vec<(i64, String, serde_json::Value)> {
    let mut stmt = conn
        .prepare("SELECT sequence, actor_id, payload FROM events WHERE task_id = ?1 AND event_type = ?2 ORDER BY sequence")
        .unwrap();
    stmt.query_map(params![task_id, EVENT_SCOPE_DENIED], |r| {
        let payload: String = r.get(2)?;
        Ok((r.get(0)?, r.get(1)?, serde_json::from_str(&payload).unwrap()))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

// --- Task 1: the refusal travels ---------------------------------------------------------------

#[test]
fn a_refusal_appends_one_row_attributed_to_the_runs_agent_actor() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, run, _wt) = task_with_run(&mut fx, "t", &["src/a/"]);

        let recorded = record_scope_denied(&mut fx.conn, &run.id, &denial("src/b.rs", false, false)).unwrap();
        assert_eq!(recorded.as_deref(), Some(task_id.as_str()), "returns the task the row belongs to");

        let rows = denial_rows(&fx.conn, &task_id);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, run.actor_id, "the actor is the agent that attempted it, not the local human");
        assert_ne!(rows[0].1, fx.actor);
        let p = &rows[0].2;
        assert_eq!(p["path"], "src/b.rs");
        assert_eq!(p["tool"], "Write");
        assert_eq!(p["tool_use_id"], "toolu_1");
        assert_eq!(p["run_id"], run.id);
        assert_eq!(p["outside_worktree"], false);
        assert_eq!(p["detected_after_the_fact"], false);
        assert!(p["label"].as_str().unwrap().contains("src/b.rs"), "the label names the refused path");
    });
}

#[test]
fn twenty_refusals_are_twenty_rows_in_attempt_order_with_distinct_sequences() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, run, _wt) = task_with_run(&mut fx, "t", &["src/a/"]);
        for i in 0..20 {
            record_scope_denied(&mut fx.conn, &run.id, &denial(&format!("src/f{i:02}.rs"), false, false)).unwrap();
        }
        let rows = denial_rows(&fx.conn, &task_id);
        assert_eq!(rows.len(), 20, "nothing coalesced, nothing dropped (D-154)");
        let seqs: Vec<i64> = rows.iter().map(|r| r.0).collect();
        assert!(seqs.windows(2).all(|w| w[0] < w[1]), "per-origin sequence is strictly increasing: {seqs:?}");
        for (i, r) in rows.iter().enumerate() {
            assert_eq!(r.2["path"], format!("src/f{i:02}.rs"), "feed order is attempt order");
        }
    });
}

#[test]
fn an_unknown_run_writes_nothing() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, _run, _wt) = task_with_run(&mut fx, "t", &["src/a/"]);
        let recorded = record_scope_denied(&mut fx.conn, "01ZZZZZZZZZZZZZZZZZZZZZZZZ", &denial("x", false, false)).unwrap();
        assert_eq!(recorded, None);
        assert!(denial_rows(&fx.conn, &task_id).is_empty());
    });
}

#[test]
fn the_outside_worktree_flag_is_stored_and_an_absolute_path_is_never() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, run, _wt) = task_with_run(&mut fx, "t", &["src/a/"]);
        record_scope_denied(&mut fx.conn, &run.id, &denial("src/b.rs", false, false)).unwrap();
        record_scope_denied(
            &mut fx.conn,
            &run.id,
            &denial("/Users/someone/.claude/projects/memory/notes.md", true, false),
        )
        .unwrap();
        let rows = denial_rows(&fx.conn, &task_id);
        assert_eq!(rows[0].2["outside_worktree"], false);
        assert_eq!(rows[1].2["outside_worktree"], true);
        let stored = rows[1].2["path"].as_str().unwrap();
        assert!(!stored.starts_with('/') && !stored.contains("someone"), "no absolute path is stored: {stored}");
        assert_eq!(stored, "notes.md", "an outside path keeps only its file name");
    });
}

#[test]
fn counts_omit_a_task_with_no_refusals_and_group_the_rest() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (t1, r1, _) = task_with_run(&mut fx, "one", &["src/a/"]);
        let (t2, r2, _) = task_with_run(&mut fx, "two", &["src/b/"]);
        let (t3, _r3, _) = task_with_run(&mut fx, "three: no refusals", &["src/c/"]);
        for _ in 0..3 {
            record_scope_denied(&mut fx.conn, &r1.id, &denial("x.rs", false, false)).unwrap();
        }
        record_scope_denied(&mut fx.conn, &r2.id, &denial("y.rs", false, true)).unwrap();

        let counts = scope_denied_counts(&fx.conn, &fx.project_id, 100).unwrap();
        let get = |id: &str| counts.iter().find(|c| c.task_id == id).map(|c| c.count);
        assert_eq!(get(&t1), Some(3));
        assert_eq!(get(&t2), Some(1));
        assert_eq!(get(&t3), None, "a task with no refusals is absent, not present with a zero");
        assert_eq!(counts.len(), 2);
    });
}

#[test]
fn counts_are_capped_server_side() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        for n in 0..3 {
            let (_t, run, _) = task_with_run(&mut fx, &format!("t{n}"), &["src/a/"]);
            record_scope_denied(&mut fx.conn, &run.id, &denial("x.rs", false, false)).unwrap();
        }
        assert_eq!(scope_denied_counts(&fx.conn, &fx.project_id, 2).unwrap().len(), 2, "the caller's limit applies");
        assert_eq!(scope_denied_counts(&fx.conn, &fx.project_id, 0).unwrap().len(), 1, "a non-positive limit still reads a bounded window");
    });
}

#[test]
fn the_count_query_is_one_grouped_literal() {
    let src = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/query/scope.rs")).unwrap();
    let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    assert_eq!(code.matches("FROM events").count(), 1, "exactly one read of the event log per call");
    assert!(code.contains("GROUP BY"), "the aggregate is grouped in SQL, not folded per row");
    assert!(!code.contains("format!"), "no SQL assembled by string formatting");
}

// --- Task 2: the detective backstop ------------------------------------------------------------

fn paths(findings: &[core::drift::ScopeBackstopFinding]) -> Vec<String> {
    let mut v: Vec<String> = findings.iter().map(|f| f.path.clone()).collect();
    v.sort();
    v
}

#[test]
fn a_committed_path_outside_the_set_is_one_finding_and_one_inside_is_none() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, _run, wt) = task_with_run(&mut fx, "t", &["src/inside/"]);
        write(&wt, "src/inside/a.rs", "a");
        write(&wt, "src/outside/b.rs", "b");
        git(&wt, &["add", "-A"]);
        git(&wt, &["commit", "-m", "work"]);
        let findings = scope_backstop_findings(&fx.conn, &task_id).unwrap();
        assert_eq!(paths(&findings), vec!["src/outside/b.rs"]);
    });
}

#[test]
fn an_uncommitted_outside_path_is_a_finding_including_inside_a_new_directory() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, _run, wt) = task_with_run(&mut fx, "t", &["src/inside/"]);
        write(&wt, "stray.txt", "x");
        write(&wt, "newdir/deep/x.rs", "x");
        write(&wt, "src/inside/ok.rs", "ok");
        let findings = scope_backstop_findings(&fx.conn, &task_id).unwrap();
        assert_eq!(paths(&findings), vec!["newdir/deep/x.rs", "stray.txt"], "untracked directories are expanded to files");
    });
}

#[test]
fn a_run_whose_every_change_is_inside_its_set_raises_nothing() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, _run, wt) = task_with_run(&mut fx, "t", &["src/inside/", "Cargo.lock"]);
        write(&wt, "src/inside/a.rs", "a");
        write(&wt, "Cargo.lock", "lock");
        git(&wt, &["add", "-A"]);
        git(&wt, &["commit", "-m", "work"]);
        write(&wt, "src/inside/b.rs", "b");
        assert!(scope_backstop_findings(&fx.conn, &task_id).unwrap().is_empty());
    });
}

#[test]
fn an_unarmed_run_raises_nothing_whatever_it_changed() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, _run, wt) = task_with_run(&mut fx, "t", &[]);
        write(&wt, "anything/at/all.rs", "x");
        git(&wt, &["add", "-A"]);
        git(&wt, &["commit", "-m", "work"]);
        write(&wt, "more.txt", "y");
        assert!(scope_backstop_inputs(&fx.conn, &task_id).unwrap().is_none(), "no declared set means no inputs");
        assert!(scope_backstop_findings(&fx.conn, &task_id).unwrap().is_empty());
    });
}

#[test]
fn a_lost_notice_is_still_surfaced_at_close_flagged_after_the_fact() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, run, wt) = task_with_run(&mut fx, "t", &["src/inside/"]);
        // A write made through a shell: the hook never saw it, so no notice was ever sent.
        write(&wt, "lockfile.json", "{}");

        // Exactly the steps the session-close handler runs, with the lock released around git.
        let inputs = scope_backstop_inputs(&fx.conn, &task_id).unwrap().expect("armed");
        let findings = scope_backstop_git(&inputs).unwrap();
        let recorded = record_backstop_denials(&mut fx.conn, &run.id, &paths(&findings)).unwrap();
        assert_eq!(recorded, 1);

        let rows = denial_rows(&fx.conn, &task_id);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].2["path"], "lockfile.json");
        assert_eq!(rows[0].2["detected_after_the_fact"], true);
        assert_eq!(rows[0].1, run.actor_id);
    });
}

#[test]
fn a_hook_denial_and_a_backstop_finding_for_one_path_are_two_rows_told_apart_by_the_flag() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, run, wt) = task_with_run(&mut fx, "t", &["src/inside/"]);
        record_scope_denied(&mut fx.conn, &run.id, &denial("src/outside/b.rs", false, false)).unwrap();
        // The agent then got the file written some other way; it is on disk at close.
        write(&wt, "src/outside/b.rs", "b");
        let findings = scope_backstop_findings(&fx.conn, &task_id).unwrap();
        record_backstop_denials(&mut fx.conn, &run.id, &paths(&findings)).unwrap();

        let rows = denial_rows(&fx.conn, &task_id);
        assert_eq!(rows.len(), 2, "they do not merge");
        let flags: Vec<bool> = rows.iter().map(|r| r.2["detected_after_the_fact"].as_bool().unwrap()).collect();
        assert_eq!(flags, vec![false, true]);
    });
}

#[test]
fn closing_twice_does_not_duplicate_a_backstop_finding() {
    with_scratch_worktree_root(|_| {
        let mut fx = fixture();
        let (task_id, run, wt) = task_with_run(&mut fx, "t", &["src/inside/"]);
        write(&wt, "stray.txt", "x");
        let findings = scope_backstop_findings(&fx.conn, &task_id).unwrap();
        assert_eq!(record_backstop_denials(&mut fx.conn, &run.id, &paths(&findings)).unwrap(), 1);
        assert_eq!(record_backstop_denials(&mut fx.conn, &run.id, &paths(&findings)).unwrap(), 0);
        assert_eq!(denial_rows(&fx.conn, &task_id).len(), 1);
    });
}

#[test]
fn the_backstop_compares_against_the_database_not_the_marker() {
    // Tampering with the per-run marker changes what the hook enforces, not what the backstop
    // compares against. The backstop module must not so much as name the marker reader.
    let src = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/drift.rs")).unwrap();
    let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    assert!(!code.contains("read_scope_marker"));
    assert!(code.contains("scope_backstop_findings"));
}
