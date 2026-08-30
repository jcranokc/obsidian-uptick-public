#!/bin/zsh
# Refresh the dashboard photo gallery from Apple Photos.
#
# Originals are 10-40MB each and the vault syncs to other devices, so nothing
# full-resolution is ever written into it: photos are exported to a temp folder,
# downscaled with sips, and only the small versions are moved in. The cache is
# replaced wholesale each run so it does not grow without bound.
#
# Read-only with respect to the Photos library. Albums must be ordinary albums —
# AppleScript cannot see iCloud Shared Albums.
set -u
VAULT="${VAULT:?Set VAULT to your vault path}"
ROOT="$VAULT/4 System/Automation"
CACHE="$VAULT/4 System/Photo Cache"
LOG_DIR="$VAULT/4 System/Logs"
PER_ALBUM="${PHOTO_PER_ALBUM:-12}"
# The card renders around 700px wide; 1200 covers Retina without
# putting megabytes into a vault that syncs.
MAX_PX="${PHOTO_MAX_PX:-1200}"
# Set ALBUMS to the Photos albums you want mirrored into the vault.
ALBUMS=(${ALBUMS:-"Favorites"})

mkdir -p "$LOG_DIR" "$CACHE"
LOG="$LOG_DIR/photo-gallery-$(date +%Y-%m-%d).log"
find "$LOG_DIR" -name 'photo-gallery-*.log' -mtime +14 -delete 2>/dev/null || true

tmp="$(mktemp -d -t photo-gallery)"
trap 'rm -rf "$tmp"' EXIT INT TERM

print -r -- "$(date -Iseconds) started" >> "$LOG"

if ! /usr/bin/osascript "$ROOT/photo-gallery-export.applescript" "$tmp" "$PER_ALBUM" "${ALBUMS[@]}" >> "$LOG" 2>&1; then
  print -r -- "$(date -Iseconds) export failed — is Photos automation permitted?" >> "$LOG"
  exit 1
fi

count=0
staged="$tmp/small"
mkdir -p "$staged"
for f in "$tmp"/*.(jpeg|jpg|JPG|JPEG|png|PNG|heic|HEIC)(N); do
  base="$(basename "${f%.*}")"
  out="$staged/${base}.jpg"
  # -Z scales the longest edge, preserving aspect ratio.
  if /usr/bin/sips -s format jpeg -s formatOptions 60 -Z "$MAX_PX" "$f" --out "$out" >/dev/null 2>&1; then
    count=$((count + 1))
  fi
done

if (( count == 0 )); then
  print -r -- "$(date -Iseconds) nothing to publish; cache left untouched" >> "$LOG"
  exit 1
fi

# Only replace the live cache once new images exist, so a failed run never
# leaves the dashboard with an empty gallery.
rm -f "$CACHE"/*.jpg(N)
mv "$staged"/*.jpg "$CACHE"/ 2>/dev/null

bytes=$(du -sk "$CACHE" | cut -f1)
print -r -- "$(date -Iseconds) completed photos=$count cache=${bytes}KB" >> "$LOG"
print -r -- "{\"ok\":true,\"photos\":$count,\"cache_kb\":$bytes}"
