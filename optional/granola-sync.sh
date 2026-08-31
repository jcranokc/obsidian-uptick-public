#!/bin/zsh
# Manual, idempotent Granola -> Obsidian sync.
# This intentionally runs only when invoked by the user while Codex OAuth/MCP
# access is available. It never scrapes Granola's local database.
set -u

VAULT="${VAULT:?Set VAULT to your vault path}"
ROOT="$VAULT/4 System/Automation"
CODEX_BIN="${CODEX_BIN:-$(command -v codex 2>/dev/null || true)}"
LOG_DIR="$VAULT/4 System/Logs"
LOCK_DIR="$ROOT/.granola-sync.lock"
STATE_FILE="$ROOT/granola-sync-state.json"
MIN_REMOTE_CHECK_SECONDS=600
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/granola-sync-$(date +%Y-%m-%d).log"

if [[ -d "$LOCK_DIR" ]]; then
  lock_pid="$(<"$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ "$lock_pid" == <-> ]] && kill -0 "$lock_pid" 2>/dev/null; then
    print -r -- "$(date -Iseconds) skipped: another sync is running (pid $lock_pid)" >> "$LOG_FILE"
    exit 0
  fi
  lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || date +%s) ))
  if (( lock_age > 600 )); then
    rm -f "$LOCK_DIR/pid"
    if rmdir "$LOCK_DIR" 2>/dev/null; then
      print -r -- "$(date -Iseconds) recovered stale lock" >> "$LOG_FILE"
    else
      print -r -- "$(date -Iseconds) skipped: stale lock could not be removed" >> "$LOG_FILE"
      exit 0
    fi
  else
    print -r -- "$(date -Iseconds) skipped: another sync is running (unidentified lock)" >> "$LOG_FILE"
    exit 0
  fi
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -r -- "$(date -Iseconds) skipped: another sync is running" >> "$LOG_FILE"
  exit 0
fi
print -r -- "$$" > "$LOCK_DIR/pid"
trap 'rm -f "$LOCK_DIR/pid" 2>/dev/null; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

print -r -- "$(date -Iseconds) started" >> "$LOG_FILE"
last_success="$(/usr/bin/python3 -c 'import json,sys,datetime; p=sys.argv[1];
try:
 d=json.load(open(p)); t=datetime.datetime.fromisoformat(d.get("last_success_at", "").replace("Z", "+00:00")); print(int(t.timestamp()))
except Exception: print(0)' "$STATE_FILE" 2>/dev/null || print 0)"
now_epoch="$(date +%s)"
if (( last_success > 0 && now_epoch - last_success < MIN_REMOTE_CHECK_SECONDS )); then
  print -r -- "$(date -Iseconds) preflight: no remote check needed yet (last successful check $(( now_epoch - last_success ))s ago)" >> "$LOG_FILE"
  exit 0
fi
print -r -- "$(date -Iseconds) preflight: remote check eligible" >> "$LOG_FILE"
if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then
  print -r -- "$(date -Iseconds) failed: Codex CLI not found; set CODEX_BIN or add codex to PATH" >> "$LOG_FILE"
  exit 2
fi
if "$CODEX_BIN" exec \
  --cd "$VAULT" \
  --sandbox workspace-write \
  --skip-git-repo-check \
  "Read $STATE_FILE if it exists, then use the configured Granola MCP to import only newly completed or changed meetings since its last_success_at into this vault. Follow AGENTS.md. Use granola_id as the deduplication key. Preserve human-authored content, write verbatim transcripts only under 3 Reference/Sources/Granola Transcripts/, write curated notes only under 2 Work/Meetings/Granola/, and create tasks only for explicit actionable commitments. If no meetings need processing, make no changes. Do not print transcript or email content; report only a short success/failure summary." \
  >> "$LOG_FILE" 2>&1; then
  printf '{"last_success_at":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_FILE"
  print -r -- "$(date -Iseconds) completed" >> "$LOG_FILE"
  exit 0
else
  status=$?
  print -r -- "$(date -Iseconds) failed: codex exit $status" >> "$LOG_FILE"
  exit "$status"
fi
