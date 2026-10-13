#!/usr/bin/env bash
#
# reset-empty-trunk-fleet.sh — clear the Flywheel fleet state that was built while the
# project's trunk (main) pointed at c6bdc79 "first commit", a tree containing only README.md.
#
# Every worktree cut before main was fast-forwarded is empty, and none of it self-heals:
#   * ensure_worktree does an existence SELECT first and returns a stale row untouched;
#   * ensure_epic_integration_branch caches its result in epics.integration_branch.
# So the DB rows must go along with the git refs, or Flywheel keeps handing out empty worktrees.
#
# SURGICAL BY DESIGN. It touches only:
#   * worktrees under $WORKTREE_ROOT whose branch starts with flywheel/
#   * git branches matching flywheel/*
#   * the worktrees rows for those paths
#   * epics.integration_branch for epics whose branch is being deleted (set to NULL, re-cut lazily)
#   * agent_runs rows for the affected tasks
# It does NOT touch task statuses. 180 tasks read in_progress, but only three ever had a run —
# the rest is seeded board data and wiping it would destroy the board, not repair it.
#
# Usage:
#   ./reset-empty-trunk-fleet.sh              # dry run — prints the plan, changes nothing
#   ./reset-empty-trunk-fleet.sh --execute    # takes a DB backup, then performs it

set -euo pipefail

REPO="${FLYWHEEL_REPO:-/Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin}"
DB="${FLYWHEEL_DB:-$HOME/Library/Application Support/Flywheel/flywheel.db}"
WORKTREE_ROOT="${FLYWHEEL_WORKTREE_ROOT:-$HOME/Flywheel}"
EXECUTE=false
[ "${1:-}" = "--execute" ] && EXECUTE=true

say() { printf '%s\n' "$*"; }
run() {
  if $EXECUTE; then eval "$1"; else say "    would run: $1"; fi
}

if pgrep -f 'target/debug/desktop' >/dev/null 2>&1 || pgrep -f 'Flywheel.app/Contents/MacOS/Flywheel' >/dev/null 2>&1; then
  say "REFUSING: Flywheel is running. Quit it first — this edits the live database."
  exit 1
fi

[ -f "$DB" ] || { say "REFUSING: no database at $DB"; exit 1; }

say "=== Flywheel empty-trunk fleet reset ==="
say "repo: $REPO"
say "db:   $DB"
$EXECUTE && say "mode: EXECUTE" || say "mode: DRY RUN (pass --execute to apply)"
say

# --- 1. safety: refuse if any flywheel worktree holds real work ----------------
say "[1] checking the flywheel worktrees for work worth keeping"
UNSAFE=0
while read -r wt_path; do
  [ -n "$wt_path" ] || continue
  [ -d "$wt_path" ] || continue
  dirty=$(git -C "$wt_path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  ahead=$(git -C "$wt_path" rev-list --count "$(git -C "$REPO" rev-list --max-parents=0 HEAD)".."$wt_path/HEAD" 2>/dev/null || \
          git -C "$wt_path" rev-list --count HEAD 2>/dev/null || echo 0)
  commits=$(git -C "$wt_path" log --oneline 2>/dev/null | wc -l | tr -d ' ')
  say "    $wt_path — dirty:$dirty commits:$commits"
  if [ "$dirty" != "0" ] || [ "$commits" -gt 1 ]; then
    say "      ^ HAS WORK — refusing to remove this one"
    UNSAFE=1
  fi
done < <(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{p=$2} /^branch refs\/heads\/flywheel\//{print p}')

if [ "$UNSAFE" = "1" ]; then
  say
  say "REFUSING: at least one flywheel worktree has uncommitted changes or commits of its own."
  say "Inspect and save that work before re-running."
  exit 1
fi
say "    all clear — every flywheel worktree is empty scaffolding"
say

# --- 2. remove the worktrees ---------------------------------------------------
say "[2] removing flywheel worktrees"
while read -r wt_path; do
  [ -n "$wt_path" ] || continue
  say "    $wt_path"
  run "git -C '$REPO' worktree remove --force '$wt_path'"
done < <(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{p=$2} /^branch refs\/heads\/flywheel\//{print p}')
run "git -C '$REPO' worktree prune"
say

# --- 3. delete the flywheel branches -------------------------------------------
say "[3] deleting flywheel/* branches (all pinned at the empty root commit)"
# '**' not '*': for-each-ref matches with wildmatch under WM_PATHNAME, so a single '*' does NOT
# cross a slash. 'refs/heads/flywheel/*' silently matches the task branches and skips every
# flywheel/epic/... branch — which pairs with step 4 nulling epics.integration_branch to leave the
# board unable to start work at all, since ensure_epic_integration_branch (epic.rs:685) BAILS when
# the branch it wants to cut already exists.
for br in $(git -C "$REPO" for-each-ref --format='%(refname:short)' 'refs/heads/flywheel/**'); do
  say "    $br -> $(git -C "$REPO" rev-parse --short "$br")"
  run "git -C '$REPO' branch -D '$br'"
done
say

# --- 4. database ----------------------------------------------------------------
say "[4] database rows"
say "    worktrees rows to delete:"
sqlite3 "$DB" "select '      '||id||'  '||branch from worktrees where branch like 'flywheel/%';"
say "    epics to un-cache (integration_branch -> NULL, re-cut lazily from the new trunk):"
sqlite3 "$DB" "select '      '||key||'  '||integration_branch from epics where integration_branch like 'flywheel/%';"
say "    agent_runs rows to delete (including the phantom 'running' ones):"
sqlite3 "$DB" "select '      '||id||'  '||status from agent_runs;"

if $EXECUTE; then
  BACKUP="${DB%.db}.pre-reset-$(date +%Y%m%dT%H%M%S).db"
  say
  say "    backing up -> $BACKUP"
  sqlite3 "$DB" ".backup '$BACKUP'"
  sqlite3 "$DB" <<'SQL'
BEGIN;
DELETE FROM agent_runs WHERE task_id IN (SELECT task_id FROM worktrees WHERE branch LIKE 'flywheel/%');
DELETE FROM worktrees WHERE branch LIKE 'flywheel/%';
UPDATE epics SET integration_branch = NULL WHERE integration_branch LIKE 'flywheel/%';
COMMIT;
SQL
  say "    applied"
else
  say
  say "    (dry run — no database changes)"
fi
say

# --- 5. session logs ------------------------------------------------------------
say "[5] session logs from the empty-trunk runs"
SESSIONS="$HOME/Library/Application Support/Flywheel/sessions"
if [ -d "$SESSIONS" ]; then
  for f in "$SESSIONS"/*.jsonl; do
    [ -e "$f" ] || continue
    say "    $(basename "$f")  ($(wc -c < "$f" | tr -d ' ') bytes)"
    run "rm -f '$f'"
  done
fi
say

say "=== done ==="
$EXECUTE && say "Fleet reset. Start the app and press Start Work — the worktree should now contain the real tree." \
         || say "Dry run only. Re-run with --execute to apply."
