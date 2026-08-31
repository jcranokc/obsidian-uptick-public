#!/bin/zsh
# Run the opt-in Uptick Reminders bridge, then apply native Apple Reminders
# tags through the user's installed Shortcut. Designed for a LaunchAgent that
# runs every ten minutes; safe to run manually as well.
#
# Required environment:
#   VAULT=/absolute/path/to/your/vault
#
# Optional environment:
#   UPTICK_NATIVE_TAG_SHORTCUT="Uptick Apply Native Reminder Tags"
#   SHORTCUTS_BIN=/usr/bin/shortcuts

set -u

VAULT="${VAULT:?Set VAULT to your vault path}"
AUTOMATION="$VAULT/4 System/Automation"
LOG_DIR="$VAULT/4 System/Logs"
PYTHON="${PYTHON:-/usr/bin/python3}"
SHORTCUTS_BIN="${SHORTCUTS_BIN:-/usr/bin/shortcuts}"
NATIVE_TAG_SHORTCUT="${UPTICK_NATIVE_TAG_SHORTCUT:-Uptick Apply Native Reminder Tags}"
BRIDGE="$AUTOMATION/reminders-sync.py"
LOCK_DIR="$AUTOMATION/.uptick-reminders-sync.lock"

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -type f -name 'uptick-reminders-sync-*.log' -mtime +30 -delete 2>/dev/null || true
LOG_FILE="$LOG_DIR/uptick-reminders-sync-$(date +%Y-%m-%d).log"

if [[ ! -f "$BRIDGE" ]]; then
  print -r -- "$(date -Iseconds) failed: Reminders bridge not installed at $BRIDGE" >> "$LOG_FILE"
  exit 2
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -r -- "$(date -Iseconds) skipped: another Reminders sync is running" >> "$LOG_FILE"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

print -r -- "$(date -Iseconds) started" >> "$LOG_FILE"
if "$PYTHON" "$BRIDGE" --vault "$VAULT" --sync >> "$LOG_FILE" 2>&1; then
  :
else
  status=$?
  print -r -- "$(date -Iseconds) failed: Reminders bridge exit $status" >> "$LOG_FILE"
  exit "$status"
fi

# remindctl carries the portable projection, but the Shortcut applies native
# Apple Reminders tags. It is deliberately run only after a successful bridge.
if [[ ! -x "$SHORTCUTS_BIN" ]]; then
  print -r -- "$(date -Iseconds) native tags skipped: Shortcuts CLI unavailable" >> "$LOG_FILE"
  exit 0
fi
if ! "$SHORTCUTS_BIN" list 2>>"$LOG_FILE" | /usr/bin/grep -Fxq -- "$NATIVE_TAG_SHORTCUT"; then
  print -r -- "$(date -Iseconds) native tags skipped: Shortcut not installed ($NATIVE_TAG_SHORTCUT)" >> "$LOG_FILE"
  exit 0
fi

print -r -- "$(date -Iseconds) native tags started shortcut=\"$NATIVE_TAG_SHORTCUT\"" >> "$LOG_FILE"
if "$SHORTCUTS_BIN" run "$NATIVE_TAG_SHORTCUT" >> "$LOG_FILE" 2>&1; then
  print -r -- "$(date -Iseconds) native tags completed" >> "$LOG_FILE"
  exit 0
else
  status=$?
  print -r -- "$(date -Iseconds) failed: native tags exit $status" >> "$LOG_FILE"
  exit "$status"
fi
