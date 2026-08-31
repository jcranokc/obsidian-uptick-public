#!/bin/zsh
# Install or remove the local LaunchAgent that runs Uptick Reminders sync and
# native tag application every ten minutes. It never installs the Apple
# Shortcut itself: macOS must show the user the Shortcut installation prompt.

set -eu

usage() {
  cat <<'EOF'
Usage:
  zsh optional/install-uptick-reminders-sync.sh --vault /absolute/vault/path --install
  zsh optional/install-uptick-reminders-sync.sh --vault /absolute/vault/path --install --upgrade
  zsh optional/install-uptick-reminders-sync.sh --vault /absolute/vault/path --uninstall

Options:
  --shortcut-name NAME  Installed Apple Shortcut name
  --interval SECONDS    Run interval; default 600 (ten minutes)
  --upgrade             Replace installer-owned companion copies
  --install             Install/update the LaunchAgent
  --uninstall           Unload and remove only the LaunchAgent
EOF
}

VAULT=""
SHORTCUT_NAME="Uptick Apply Native Reminder Tags"
INTERVAL=600
ACTION=""
UPGRADE=0

while (( $# )); do
  case "$1" in
    --vault) VAULT="${2:-}"; shift 2 ;;
    --shortcut-name) SHORTCUT_NAME="${2:-}"; shift 2 ;;
    --interval) INTERVAL="${2:-}"; shift 2 ;;
    --install|--uninstall) ACTION="${1#--}"; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) print -u2 -- "Unknown option: $1"; usage; exit 2 ;;
  esac
done

if [[ -z "$VAULT" || -z "$ACTION" ]]; then
  usage
  exit 2
fi
if [[ ! "$INTERVAL" =~ '^[0-9]+$' ]] || (( INTERVAL < 60 )); then
  print -u2 -- "--interval must be a whole number of at least 60 seconds"
  exit 2
fi

VAULT="$(cd "$VAULT" && pwd)"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOMATION="$VAULT/4 System/Automation"
LABEL="com.uptick.reminders-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

if [[ "$ACTION" == "uninstall" ]]; then
  /bin/launchctl bootout "gui/$UID_VALUE" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  print -- "Removed $LABEL. Companion files, Reminder data, and the Shortcut were left in place."
  exit 0
fi

if ! command -v remindctl >/dev/null 2>&1; then
  print -u2 -- "remindctl is required before installing the scheduled Reminders sync."
  exit 2
fi

mkdir -p "$AUTOMATION" "$HOME/Library/LaunchAgents"
typeset -a companions
companions=(
  reminders-sync.py
  reminders-flag.applescript
  reminders-hierarchy.applescript
  messages-task-capture.py
  email-completion.py
  mail-sent-completions.applescript
  uptick-reminders-sync.sh
)

for name in "${companions[@]}"; do
  source_file="$SOURCE_DIR/$name"
  target_file="$AUTOMATION/$name"
  if [[ ! -f "$source_file" ]]; then
    print -u2 -- "Missing bundled companion: $source_file"
    exit 2
  fi
  if [[ -e "$target_file" && $UPGRADE -ne 1 ]] && ! cmp -s "$source_file" "$target_file"; then
    print -u2 -- "Refusing to overwrite $target_file. Re-run with --upgrade after reviewing local changes."
    exit 2
  fi
  cp "$source_file" "$target_file"
done
chmod +x "$AUTOMATION/uptick-reminders-sync.sh"

# Generate the plist with plistlib so spaces or special characters in a vault
# path cannot produce malformed XML.
/usr/bin/python3 - "$PLIST" "$AUTOMATION/uptick-reminders-sync.sh" "$VAULT" "$SHORTCUT_NAME" "$INTERVAL" <<'PY'
import plistlib
import sys
from pathlib import Path

plist_path, script, vault, shortcut, interval = sys.argv[1:]
payload = {
    "Label": "com.uptick.reminders-sync",
    "ProgramArguments": ["/bin/zsh", script],
    "EnvironmentVariables": {
        "VAULT": vault,
        "UPTICK_NATIVE_TAG_SHORTCUT": shortcut,
    },
    "StartInterval": int(interval),
    "RunAtLoad": True,
}
with Path(plist_path).open("wb") as handle:
    plistlib.dump(payload, handle)
PY

/bin/launchctl bootout "gui/$UID_VALUE" "$PLIST" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
/bin/launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

if /usr/bin/shortcuts list 2>/dev/null | /usr/bin/grep -Fxq -- "$SHORTCUT_NAME"; then
  shortcut_state="installed"
else
  shortcut_state="not installed yet; the bridge will run, but native tags will be skipped"
fi
print -- "Installed $LABEL every $INTERVAL seconds. Shortcut: $shortcut_state."
