#!/bin/zsh
# Consolidated inbound sync for the Uptick vault.
#
# These three steps had no schedule at all before: the email import only ran
# when Obsidian happened to be open, the calendar cache only refreshed when run
# by hand, and newly imported Granola notes were never reshaped to the meeting
# template. Order matters — the calendar cache is what lets a Granola note be
# matched to its invite, so it is refreshed first.
#
#   1. calendar-export.py       configured local calendars -> calendar-cache.json
#   2. email-import.py          Mail -> Email References (body, recipients, summary)
#   3. granola-fill-template.py new Granola notes -> the meeting template
#   4. photo-gallery-sync.sh    Apple Photos albums -> downscaled dashboard cache
#   5. weather-fetch.py         Visual Crossing -> weather-cache.json
#
# Task creation is deliberately NOT here: task-audit.py owns that and runs
# on its own schedule, so ownership rules and
# deduplication stay in one place.
#
# Every step is idempotent and safe to re-run. A step that fails is logged and
# does not stop the ones after it.
set -u
VAULT="${VAULT:?Set VAULT to your vault path}"
ROOT="$VAULT/4 System/Automation"
LOG_DIR="$VAULT/4 System/Logs"
LOCK="$ROOT/.vault-sync.lock"
PY=/usr/bin/python3

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -type f -name 'vault-sync-*.log' -mtime +30 -delete 2>/dev/null || true
LOG="$LOG_DIR/vault-sync-$(date +%Y-%m-%d).log"

if ! mkdir "$LOCK" 2>/dev/null; then
  print -r -- "$(date -Iseconds) skipped: already running" >> "$LOG"; exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

print -r -- "$(date -Iseconds) started" >> "$LOG"
overall=0

step() {
  local name="$1"; shift
  print -r -- "$(date -Iseconds) [$name] running" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    print -r -- "$(date -Iseconds) [$name] ok" >> "$LOG"
  else
    local rc=$?
    print -r -- "$(date -Iseconds) [$name] FAILED rc=$rc" >> "$LOG"
    overall=1
  fi
}

step calendar "$PY" "$ROOT/calendar-export.py"
step email    "$PY" "$ROOT/email-import.py"
step granola  "$PY" "$ROOT/granola-fill-template.py" --apply
# Refreshes the dashboard gallery. Runs last because it is cosmetic — a failure
# here must not hold up mail or calendar.
step photos   /bin/zsh "$ROOT/photo-gallery-sync.sh"
# Cheap and fast; refreshed alongside everything else so the band is current.
step weather  "$PY" "$ROOT/weather-fetch.py"

print -r -- "$(date -Iseconds) completed status=$overall" >> "$LOG"
exit "$overall"
