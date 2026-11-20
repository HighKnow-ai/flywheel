//! Issue #1844 (ADR 0043): a new Story worktree gets the untracked files the project lists in
//! `.flywheel/worktree-include`, in the project's folder, also when the project is a subdirectory
//! of its repository, and the worktree reads clean.

mod common;

use std::path::Path;
use std::process::Command;

use common::with_scratch_worktree_root;
use flywheel_core::db::open_and_migrate;
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::project::register_project;
use flywheel_core::domain::worktree::ensure_worktree;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(dir: &Path, path: &str, body: &str) {
    let file = dir.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, body).unwrap();
}

#[test]
fn a_new_worktree_of_a_subdirectory_project_gets_the_listed_files_and_reads_clean() {
    with_scratch_worktree_root(|_| {
        let runtime = tempfile::tempdir().unwrap();
        // SAFETY: the worktree-root lock held by this closure serialises every test in this binary.
        unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path()) };

        let repo = tempfile::tempdir().unwrap();
        let root = repo.path().canonicalize().unwrap();
        git(&root, &["init", "-q", "--initial-branch=main"]);
        write(&root, "README.md", "the larger repository\n");
        write(&root, "app/.gitignore", "node_modules/\n.env\n");
        write(
            &root,
            "app/.flywheel/worktree-include",
            ".env\nlink: node_modules\n",
        );
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-q", "-m", "initial commit"]);
        let project_dir = root.join("app");
        write(&project_dir, ".env", "TOKEN=abc\n");
        write(
            &project_dir,
            "node_modules/dep/index.js",
            "module.exports = 1;\n",
        );

        let db = tempfile::tempdir().unwrap();
        let mut conn =
            open_and_migrate(&db.path().join("flywheel.db"), &db.path().join("backups")).unwrap();
        let human = local_human_actor_id(&conn).unwrap();
        let project = register_project(&mut conn, &human, &project_dir, "App", "APP").unwrap();
        git(&root, &["add", "app/.flywheel/project.json"]);
        git(&root, &["commit", "-q", "-m", "register the project"]);
        let story = common::new_story(&mut conn, &project.id, &human, "Run the app");

        let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();

        let in_wt = wt.project_dir();
        assert_eq!(
            std::fs::read_to_string(in_wt.join(".env")).unwrap(),
            "TOKEN=abc\n"
        );
        assert!(in_wt.join("node_modules/dep/index.js").is_file());
        assert!(std::fs::symlink_metadata(in_wt.join("node_modules"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(git(Path::new(&wt.path), &["status", "--porcelain"]), "");
        let payload: String = conn
            .query_row(
                "SELECT payload FROM events WHERE event_type = 'worktree.created'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            payload.contains("\"included\"") && payload.contains(".env"),
            "{payload}"
        );
    });
}
