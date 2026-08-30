#!/usr/bin/env python3
"""Export Apple Calendar events to a local cache the Uptick plugin reads.

Reads every calendar via AppleScript, including the Outlook/Exchange work
calendar.

Why not the EventKit bridge or the MCP:
  * The bridge holds write-only Calendar access, so it cannot read.
  * The MCP keys calendars by NAME. Two calendars here are both called
    "Calendar" — a personal one and the Outlook/Exchange one — so it silently
    returned only the first and the work calendar looked absent. Iterating by
    index is the only route that sees them all.
  * An Obsidian plugin cannot call an MCP server anyway, and AppleScript takes
    minutes, so a scheduled job writes JSON and the dashboard reads it.

Read-only: this never creates, edits, or deletes an event.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path


def require_vault() -> str:
    """The vault to operate on. Never guesses — a wrong guess writes into the
    wrong vault, which is worse than refusing to run."""
    v = os.environ.get("VAULT")
    if not v:
        raise SystemExit(
            "Set VAULT to your vault's path, e.g.\n"
            '  VAULT="$HOME/Documents/MyVault" python3 ' + os.path.basename(__file__))
    return v


VAULT = Path(require_vault())
BRIDGE = Path(os.environ.get("CALENDAR_BRIDGE", ""))
DUMP = VAULT / "4 System/Automation/calendar-dump.applescript"
CACHE = VAULT / "4 System/Automation/calendar-cache.json"

DAYS_BACK = 7
DAYS_FORWARD = 35

# Calendars that are not meetings. Holidays and birthdays are noise on a work
# dashboard, and "Scheduled Reminders" mirrors this vault's own task automation —
# surfacing it as a meeting would double-report the tasks.
EXCLUDED = {
    "Birthdays",
    "Siri Suggestions",
    "Scheduled Reminders",
    "US Holidays",
    "United States holidays",
    "Holidays in United States",
    "Korean Holidays 2024",
}


def parse_apple_date(s: str):
    """Parse AppleScript's `date string` form, e.g. 'Wednesday, August 19, 2026 at 2:00:00 PM'."""
    s = re.sub(r"\s+", " ", str(s or "")).replace("\u202f", " ").strip()
    s = re.sub(r"^[A-Za-z]+,\s*", "", s)          # drop weekday
    s = re.sub(r"\s+at\s+", " ", s, flags=re.I)   # 'at' separator
    for fmt in ("%B %d, %Y %I:%M:%S %p", "%B %d, %Y %H:%M:%S",
                "%d %B %Y %I:%M:%S %p", "%d %B %Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def fetch_events() -> tuple[list[dict], str | None]:
    """Read every calendar via AppleScript.

    Not the EventKit bridge: it has write-only access, and the MCP keys
    calendars by name — with two calendars both named "Calendar" it returns
    only the first, which silently hides the Outlook/Exchange work calendar.
    """
    if not DUMP.exists():
        return [], f"missing {DUMP}"
    try:
        p = subprocess.run(
            ["/usr/bin/osascript", str(DUMP), str(DAYS_BACK), str(DAYS_FORWARD)],
            capture_output=True, text=True, timeout=900,
        )
    except subprocess.TimeoutExpired:
        return [], "Calendar took too long to answer. Retry when Calendar.app is idle."
    if p.returncode != 0:
        return [], (p.stderr or "osascript failed").strip()[:300]

    events = []
    for line in p.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 10:
            continue
        idx, cal, uid, summary, start, end, allday, loc, att, desc = parts[:10]
        attendees = []
        for chunk in att.split(";"):
            chunk = chunk.strip()
            if not chunk:
                continue
            m = re.match(r"^(.*?)<(.*?)>$", chunk)
            if m:
                name, email = m.group(1).strip(), m.group(2).strip()
                attendees.append(name or email)
            elif chunk:
                attendees.append(chunk)
        events.append({
            "calendar_index": idx,
            "calendar_name": cal,
            "event_id": uid or f"{cal}:{summary}:{start}",
            "title": summary,
            "start_raw": start,
            "end_raw": end,
            "all_day": allday == "1",
            "location": loc or None,
            "attendees": attendees,
            "notes": desc or "",
        })
    return events, None


def main() -> int:
    items, err = fetch_events()
    if err:
        print(f"calendar-export: {err}", file=sys.stderr)
        return 3

    now = datetime.now().astimezone()
    win_start = (now - timedelta(days=DAYS_BACK)).replace(tzinfo=None)
    win_end = (now + timedelta(days=DAYS_FORWARD)).replace(tzinfo=None)
    seen: dict[tuple, dict] = {}
    skipped_excluded = 0
    out_of_window: list[str] = []

    for e in items:
        cal = e["calendar_name"]
        if cal in EXCLUDED:
            skipped_excluded += 1
            continue
        start = parse_apple_date(e["start_raw"])
        end = parse_apple_date(e["end_raw"])
        if not start:
            continue
        title = e["title"].strip()
        if not title:
            continue

        # AppleScript returns a recurring event ONCE, at its series start date,
        # rather than expanding occurrences into the window. Those masters land
        # months in the past and would show on the wrong day, so drop anything
        # outside the requested window. Recurring work meetings belong in
        # 2 Work/Meetings/Recurring as a Uptick series, which does expand.
        naive = start.replace(tzinfo=None)
        if not (win_start <= naive <= win_end):
            out_of_window.append(title)
            continue

        record = {
            "id": e["event_id"],
            "title": title,
            "calendar": cal,
            "calendar_index": e["calendar_index"],
            "start": start.astimezone().isoformat(timespec="seconds")
            if start.tzinfo else start.replace(tzinfo=now.tzinfo).isoformat(timespec="seconds"),
            "end": (end.replace(tzinfo=now.tzinfo).isoformat(timespec="seconds")
                    if end and not end.tzinfo else (end.isoformat(timespec="seconds") if end else None)),
            "all_day": e["all_day"],
            "location": e["location"],
            "attendees": e["attendees"],
            "notes": e["notes"][:2000],
            "organizer": None,
            "url": None,
        }

        # The same event synced by two accounts appears once per calendar.
        key = (title.lower(), record["start"])
        prior = seen.get(key)
        if prior:
            def weight(r):
                return len(r.get("attendees") or []) * 10 + len(r.get("notes") or "")
            if weight(record) <= weight(prior):
                continue
        seen[key] = record

    events = sorted(seen.values(), key=lambda x: x["start"])
    payload = {
        "generated": now.isoformat(timespec="seconds"),
        "source": "Calendar.app via AppleScript (sees every calendar, including Outlook/Exchange)",
        "window": {"days_back": DAYS_BACK, "days_forward": DAYS_FORWARD},
        "excluded_calendars": sorted(EXCLUDED),
        "events": events,
    }

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(CACHE)

    by_cal: dict[str, int] = {}
    for ev in events:
        by_cal[ev["calendar"]] = by_cal.get(ev["calendar"], 0) + 1

    print(json.dumps({
        "ok": True, "events": len(events), "raw": len(items),
        "deduped": len(items) - len(events) - skipped_excluded,
        "excluded": skipped_excluded, "by_calendar": by_cal,
        "recurring_masters_dropped": len(out_of_window),
        "note": "recurring events are not expanded by AppleScript; model them as a Uptick series",
        "cache": str(CACHE.relative_to(VAULT)),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
