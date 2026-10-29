//! WORK-07 (10-08, D-177, Pitfall 8): the bounded, link-safe size walk and its cache write.

mod common;

use common::with_scratch_worktree_root;

use std::os::unix::fs::symlink;
use std::path::Path;

use flywheel_core::domain::worktree::{
    ensure_worktree, worktree_size, worktree_size_limited, WORKTREE_WALK_MAX_DEPTH,
};
use flywheel_core::query::fleet::{record_worktree_size, worktree_measure_targets};
use rusqlite::params;

#[test]
fn a_tree_measures_to_at_least_the_blocks_of_its_files_and_is_not_bounded() {
    with_scratch_worktree_root(|root| {
        let tree = root.join("tree");
        std::fs::create_dir_all(tree.join("a/b")).unwrap();
        std::fs::write(tree.join("one.bin"), vec![1u8; 100_000]).unwrap();
        std::fs::write(tree.join("a/b/two.bin"), vec![2u8; 100_000]).unwrap();
        let size = worktree_size(&tree).unwrap();
        assert!(!size.bounded);
        assert!(
            size.bytes >= 200_000,
            "allocated size covers both files, got {}",
            size.bytes
        );
        // An empty-file sibling must not change the total by more than a block.
        let before = size.bytes;
        std::fs::write(tree.join("empty"), b"").unwrap();
        assert!(worktree_size(&tree).unwrap().bytes <= before + 4096);
    });
}

#[test]
fn a_symlink_loop_terminates_and_counts_the_link_itself() {
    with_scratch_worktree_root(|root| {
        let tree = root.join("loop");
        std::fs::create_dir_all(tree.join("d")).unwrap();
        symlink(&tree, tree.join("d/back")).unwrap(); // d/back -> the tree itself
        symlink(tree.join("d"), tree.join("self")).unwrap();
        let size = worktree_size(&tree).unwrap();
        assert!(
            !size.bounded,
            "a followed loop would run into a bound; an unfollowed one does not"
        );
    });
}

#[test]
fn a_link_pointing_outside_the_tree_contributes_nothing_from_outside() {
    with_scratch_worktree_root(|root| {
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("huge.bin"), vec![9u8; 5_000_000]).unwrap();
        let tree = root.join("tree");
        std::fs::create_dir_all(&tree).unwrap();
        symlink(&outside, tree.join("escape")).unwrap();
        let size = worktree_size(&tree).unwrap();
        assert!(
            size.bytes < 1_000_000,
            "the 5 MB behind the link must not be counted, got {}",
            size.bytes
        );
    });
}

#[test]
fn a_tree_deeper_than_the_depth_bound_reports_bounded() {
    with_scratch_worktree_root(|root| {
        let mut deep = root.join("deep");
        for _ in 0..(WORKTREE_WALK_MAX_DEPTH + 3) {
            deep = deep.join("d");
        }
        std::fs::create_dir_all(&deep).unwrap();
        assert!(worktree_size(&root.join("deep")).unwrap().bounded);
    });
}

#[test]
fn a_tree_with_more_entries_than_the_bound_reports_bounded() {
    with_scratch_worktree_root(|root| {
        let tree = root.join("wide");
        std::fs::create_dir_all(&tree).unwrap();
        for i in 0..20 {
            std::fs::write(tree.join(format!("f{i}")), b"x").unwrap();
        }
        assert!(worktree_size_limited(&tree, 10, 64).unwrap().bounded);
        assert!(
            !worktree_size_limited(&tree, 20, 64).unwrap().bounded,
            "exactly at the bound is not over it"
        );
    });
}

#[test]
fn a_path_outside_the_worktree_root_or_with_a_parent_segment_is_refused() {
    with_scratch_worktree_root(|root| {
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::write(elsewhere.path().join("f"), b"x").unwrap();
        assert!(worktree_size(elsewhere.path()).is_err());
        let sneaky = root.join("..").join(elsewhere.path().file_name().unwrap());
        assert!(worktree_size(&sneaky).is_err());
    });
}

#[test]
fn recording_a_size_writes_exactly_the_two_columns_of_the_one_row() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let a = common::new_story(&mut conn, &project.id, &actor, "a");
        let b = common::new_story(&mut conn, &project.id, &actor, "b");
        let wa = ensure_worktree(&mut conn, &a.id, &actor).unwrap();
        ensure_worktree(&mut conn, &b.id, &actor).unwrap();

        let read = |story: &str| -> (Option<i64>, Option<String>, String, String) {
            conn.query_row(
                "SELECT size_bytes, size_measured_at, path, status FROM worktrees WHERE story_id = ?1",
                params![story],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap()
        };
        assert_eq!(read(&a.id).0, None, "never measured reads NULL");

        assert!(record_worktree_size(&conn, &a.id, 4096, "2026-10-12T00:00:00Z").unwrap());
        let (size, at, path, status) = read(&a.id);
        assert_eq!(
            (size, at.as_deref()),
            (Some(4096), Some("2026-10-12T00:00:00Z"))
        );
        assert_eq!(
            (path, status),
            (wa.path, "active".to_string()),
            "nothing else changed"
        );
        assert_eq!(read(&b.id).0, None, "the sibling row is untouched");
        assert!(!record_worktree_size(&conn, "no-such-story", 1, "x").unwrap());
    });
}

/// WR-03: with more worktrees than the cap, "measure all" must reach the ones never measured and
/// then the stalest, not re-walk the first rows by id on every press.
#[test]
fn measure_all_over_the_cap_takes_the_never_measured_then_the_stalest() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let mut stories = Vec::new();
        for n in 0..4 {
            let st = common::new_story(&mut conn, &project.id, &actor, &format!("s{n}"));
            ensure_worktree(&mut conn, &st.id, &actor).unwrap();
            stories.push(st.id);
        }
        // stories[0] measured recently, stories[1] long ago, stories[2] and stories[3] never.
        record_worktree_size(&conn, &stories[0], 1, "2026-10-12T00:00:00Z").unwrap();
        record_worktree_size(&conn, &stories[1], 1, "2026-01-01T00:00:00Z").unwrap();

        let ids = |limit| -> Vec<String> {
            worktree_measure_targets(&conn, None, limit)
                .unwrap()
                .into_iter()
                .map(|t| t.story_id)
                .collect()
        };
        let first_two = ids(2);
        assert!(
            first_two.contains(&stories[2]) && first_two.contains(&stories[3]),
            "never measured first: {first_two:?}"
        );
        let three = ids(3);
        assert_eq!(three[2], stories[1], "then the stalest measurement");
        assert_eq!(ids(4).last(), Some(&stories[0]), "the freshest is last");
    });
}

/// Not part of the suite: `FLYWHEEL_WALK_BENCH=/path/to/repo cargo test -p core --test worktree_size
/// -- --ignored --nocapture` times one walk over a real tree (the repo root is made the worktree
/// root for the run so the containment check passes).
#[test]
#[ignore]
fn time_one_walk_over_a_real_repository() {
    let Ok(path) = std::env::var("FLYWHEEL_WALK_BENCH") else {
        return;
    };
    let _guard = common::WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    // SAFETY: serialised by the mutex above.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", &path) };
    let started = std::time::Instant::now();
    let size = worktree_size(Path::new(&path)).unwrap();
    println!(
        "walked {} bytes, bounded={}, in {:?}",
        size.bytes,
        size.bounded,
        started.elapsed()
    );
}
