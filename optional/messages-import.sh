#!/bin/zsh
set -u

VAULT="${VAULT:?Set VAULT to your vault path}"
export VAULT   # the Python importers read this; without export they fall back to their default
PYTHON="/usr/bin/python3"
SCRIPT="$VAULT/4 System/Automation/messages-import.py"
THREAD_SCRIPT="$VAULT/4 System/Automation/messages-contact-threads.py"
LOG_DIR="$VAULT/4 System/Logs"
LOG="$LOG_DIR/messages-import.log"
LOCK="$LOG_DIR/messages-import.lock"
REBUILD_FLAG="$LOG_DIR/messages-import.rebuild"

mkdir -p "$LOG_DIR"
if [[ -e "$LOCK" ]]; then
  # A short-lived stale lock is safer to leave alone than to overlap a DB read.
  if [[ -n "$(find "$LOCK" -mmin +30 -print 2>/dev/null)" ]]; then
    rmdir "$LOCK" 2>/dev/null || exit 0
  else
    print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') skipped: importer already running" >> "$LOG"
    exit 0
  fi
fi
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') starting" >> "$LOG"
args=()
if [[ -e "$REBUILD_FLAG" ]]; then
  args+=(--rebuild --days 90)
fi
"$PYTHON" "$SCRIPT" $args >> "$LOG" 2>&1
rc=$?
print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') exit=$rc" >> "$LOG"
if [[ -e "$REBUILD_FLAG" && $rc -eq 0 ]]; then
  rm -f "$REBUILD_FLAG"
fi
if [[ $rc -eq 0 ]]; then
  "$PYTHON" "$THREAD_SCRIPT" >> "$LOG" 2>&1
  thread_rc=$?
  if [[ $thread_rc -ne 0 ]]; then
    print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') contact-thread exit=$thread_rc" >> "$LOG"
    rc=$thread_rc
  fi
fi
exit $rc
