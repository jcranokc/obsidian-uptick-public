#!/bin/zsh
# Life OS XP sync. Recomputes earnable XP, appends new events to the ledger,
# and regenerates the notes under 4 System/Game/.
#
# Runs AFTER priority-task-sync, which owns the [difficulty:: N] field this
# reads. Safe to run any number of times a day: every event carries a stable id
# and re-running never double-counts.
set -u
VAULT="${VAULT:?Set VAULT to your vault path}"
ROOT="$VAULT/4 System/Automation"
LOG_DIR="$VAULT/4 System/Logs"
LOCK_DIR="$ROOT/.xp-sync.lock"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/xp-sync-$(date +%Y-%m-%d).log"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -r -- "$(date -Iseconds) skipped: another sync is running" >> "$LOG_FILE"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM
print -r -- "$(date -Iseconds) started" >> "$LOG_FILE"
# Priorities and difficulties first, so the XP pass reads current fields.
/usr/bin/python3 "$ROOT/priority-task-sync.py" --vault "$VAULT" >> "$LOG_FILE" 2>&1
if /usr/bin/python3 "$ROOT/xp-sync.py" --vault "$VAULT" >> "$LOG_FILE" 2>&1; then
  print -r -- "$(date -Iseconds) completed" >> "$LOG_FILE"
  exit 0
else
  status=$?
  print -r -- "$(date -Iseconds) failed: xp-sync exit $status" >> "$LOG_FILE"
  exit "$status"
fi
