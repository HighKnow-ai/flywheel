#!/usr/bin/env bash
# Exports the real Flywheel board to comps/comp-data.json so the 08.1 comps render at real density.
# Works off a COPY of the fleet database (never the live file) and selects named board columns only:
# no secrets table, no auth_ref, no event payloads. D-04 / T-08.1-10.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="${FLYWHEEL_APP_DATA_DIR:-$HOME/Library/Application Support/Flywheel}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# Copy the database with its WAL so the copy holds what the app last committed.
cp "$SRC_DIR/flywheel.db" "$SCRATCH/flywheel.db"
for ext in -wal -shm; do [ -f "$SRC_DIR/flywheel.db$ext" ] && cp "$SRC_DIR/flywheel.db$ext" "$SCRATCH/flywheel.db$ext"; done
DB="$SCRATCH/flywheel.db"

q() { sqlite3 -json "$DB" "$1" > "$SCRATCH/$2.json"; [ -s "$SCRATCH/$2.json" ] || echo '[]' > "$SCRATCH/$2.json"; }

q "SELECT p.id, p.key_prefix, p.name, p.default_branch, p.status FROM projects p" projects
q "SELECT id, project_id, key, title, status, priority, estimate, integration_branch FROM epics ORDER BY CAST(substr(key, instr(key,'-')+1) AS INTEGER)" epics
q "SELECT id, project_id, epic_id, key, title, status, priority, estimate FROM tasks ORDER BY CAST(substr(key, instr(key,'-')+1) AS INTEGER)" tasks
q "SELECT epic_id, status, COUNT(*) AS n FROM tasks GROUP BY epic_id, status" status_counts
q "SELECT w.task_id, t.key AS task_key, w.branch, w.base_branch, w.path, w.status FROM worktrees w JOIN tasks t ON t.id = w.task_id WHERE w.status = 'active' ORDER BY t.key" worktrees
q "SELECT c.id, c.parent_type, c.parent_id, t.key AS task_key, c.statement, c.verification_hint, c.checked, c.rank FROM acceptance_criteria c LEFT JOIN tasks t ON c.parent_type = 'task' AND t.id = c.parent_id ORDER BY c.parent_id, c.rank" criteria
q "SELECT ar.status, ar.task_id, ar.epic_id FROM agent_runs ar WHERE ar.status IN ('running','blocked')" live_runs
q "SELECT epic_id, COUNT(*) AS n FROM authoring_proposals WHERE status = 'pending' GROUP BY epic_id" pending_proposals
q "SELECT e.task_id, t.key AS task_key, e.event_type, e.occurred_at, a.display_name AS actor, a.type AS actor_type FROM events e JOIN actors a ON a.id = e.actor_id JOIN tasks t ON t.id = e.task_id WHERE e.task_id IN (SELECT task_id FROM worktrees WHERE status = 'active') ORDER BY e.occurred_at DESC" activity

# Merge, and read ahead/dirty live from git (local refs, as review.rs does) for each active worktree.
python3 - "$SCRATCH" "$HERE/comp-data.json" <<'PY'
import json, os, subprocess, sys
d, out = sys.argv[1], sys.argv[2]
load = lambda n: json.load(open(os.path.join(d, n + ".json")))
data = {n: load(n) for n in ["projects","epics","tasks","status_counts","worktrees","criteria","live_runs","pending_proposals","activity"]}

def git(path, *args):
    return subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, timeout=20)

data["diffs"] = {"real": [], "fixture": None}
for w in data["worktrees"]:
    p = w.pop("path")  # the filesystem path stays out of the committed artifact
    w["ahead"], w["dirty"] = None, None
    if not os.path.isdir(p):
        continue
    r = git(p, "rev-list", "--count", f"{w['base_branch']}..{w['branch']}")
    if r.returncode == 0:
        w["ahead"] = int(r.stdout.strip())
    s = git(p, "status", "--porcelain")
    if s.returncode == 0:
        w["dirty"] = bool(s.stdout.strip())
        if w["dirty"]:  # the real uncommitted diff, capped, for the review comp
            data["diffs"]["real"].append({"task_key": w["task_key"], "patch": "\n".join(git(p, "diff").stdout.splitlines()[:400])})

# No active task has commits ahead today, so the review comp needs a stand-in diff. It is a real
# commit from this repository, and every comp that shows it labels it FIXTURE.
FIXTURE_REF, FIXTURE_PATH = "1b65d20", "packages/desktop/src/review/CriteriaRail.tsx"
top = subprocess.run(["git", "-C", os.path.dirname(out), "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
fx = subprocess.run(["git", "-C", top, "show", "--format=%h %s", FIXTURE_REF, "--", FIXTURE_PATH], capture_output=True, text=True)
if fx.returncode == 0:
    lines = fx.stdout.splitlines()
    data["diffs"]["fixture"] = {"ref": FIXTURE_REF, "path": FIXTURE_PATH, "subject": lines[0], "patch": "\n".join(lines[1:401])}

data["activity"] = data["activity"][:80]
json.dump(data, open(out, "w"), indent=1, sort_keys=False)
print(f"epics={len(data['epics'])} tasks={len(data['tasks'])} worktrees={len(data['worktrees'])} criteria={len(data['criteria'])} -> {out}")
PY
