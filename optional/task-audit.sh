#!/bin/zsh
# Daily whole-vault you commitment audit. Uses a bounded local parser so
# unrelated MCP startup cannot block the daily job.
set -u
VAULT="${VAULT:?Set VAULT to your vault path}"
ROOT="$VAULT/4 System/Automation"
LOG_DIR="$VAULT/4 System/Logs"
LOCK_DIR="$ROOT/.uptick-task-audit.lock"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/uptick-task-audit-$(date +%Y-%m-%d).log"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -r -- "$(date -Iseconds) skipped: another audit is running" >> "$LOG_FILE"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM
print -r -- "$(date -Iseconds) started" >> "$LOG_FILE"
if /usr/bin/python3 "$ROOT/task-audit.py" --vault "$VAULT" >> "$LOG_FILE" 2>&1; then
  # The Reminders bridge is opt-in and exits successfully without work when
  # reminders.enabled is false. Keeping it in this existing lock-protected
  # runner prevents two task writers from racing the same inbox.
  if [ -f "$ROOT/reminders-sync.py" ]; then
    /usr/bin/python3 "$ROOT/reminders-sync.py" --vault "$VAULT" --sync >> "$LOG_FILE" 2>&1 || {
      status=$?
      print -r -- "$(date -Iseconds) failed: reminders bridge exit $status" >> "$LOG_FILE"
      exit "$status"
    }
  fi
  print -r -- "$(date -Iseconds) completed" >> "$LOG_FILE"
  exit 0
else
  status=$?
  print -r -- "$(date -Iseconds) failed: parser exit $status" >> "$LOG_FILE"
  exit "$status"
fi
