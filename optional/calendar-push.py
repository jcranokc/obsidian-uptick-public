#!/usr/bin/env python3
"""Push an Obsidian meeting note to a configured Apple Calendar target.

USAGE
    calendar-push.py --note "2 Work/Meetings/2026-08-20 - Sprint Planning.md" [--apply]

Dry-run by default. Nothing is written to Calendar without --apply.

SAFETY — read this before changing anything here.

No event may be created until an explicit calendar target is configured; never
guess from a similarly named calendar.

So this script refuses to write unless ALL of the following hold:

  1. The bridge has FULL calendar access. With write-only access macOS exposes a
     single placeholder calendar (VIRTUAL_APP_CALENDAR_UUID) and a write would
     land somewhere opaque.
  2. UPTICK_CALENDAR_ID resolves to a calendar the bridge can actually see.
  3. That calendar's source/title matches TARGET_EXPECT — proof we resolved the
     intended configured calendar and not a similarly named one.

If any check fails the script explains which one and exits non-zero. It never
falls back to "the first writable calendar".
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from uptick_private_config import load_private_env


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
load_private_env(VAULT)
BRIDGE = Path(os.environ.get("CALENDAR_BRIDGE", ""))

# Local-only ID for the explicit calendar target. An empty default is safe.
TARGET_CALENDAR_ID = os.environ.get("UPTICK_CALENDAR_ID", "").strip()

# Substrings that must appear in the resolved calendar's title or source for it
# to be accepted as the configured target. Deliberately strict.
TARGET_EXPECT = tuple(
    filter(None, os.environ.get("UPTICK_CALENDAR_MATCH", "icloud,exchange,office365,outlook").lower().split(",")))

DEFAULT_MINUTES = 30


def bridge(command: str, payload=None) -> dict:
    args = [str(BRIDGE), command]
    if payload is not None:
        args.append(payload if isinstance(payload, str) else json.dumps(payload))
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "bridge timed out"}
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": (p.stderr or p.stdout or "no output").strip()[:300]}


def frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm: dict = {}
    for line in text[4:end].split("\n"):
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if not m:
            continue
        key, raw = m.group(1), m.group(2).strip()
        if raw.startswith("[") and raw.endswith("]"):
            inner = raw[1:-1].strip()
            fm[key] = [v.strip().strip('"').strip("'") for v in inner.split(",") if v.strip()]
        else:
            fm[key] = raw.strip('"').strip("'")
    return fm


def section(text: str, heading: str) -> str:
    m = re.search(rf"^#{{2,6}}\s+{re.escape(heading)}\s*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    nxt = re.search(r"^#{1,6}\s+", rest, re.M)
    return (rest[: nxt.start()] if nxt else rest).strip()


CONTACTS = VAULT / "3 Reference/People/Apple Contacts"


def resolve_attendees(entries) -> list[dict]:
    """Turn stored attendee links into {name, email} pairs.

    Attendees are stored as "[[contact-note|Display Name]]" so the address is
    owned by the contact note (Apple Contacts is the source of truth) rather
    than copied into every meeting. A plain string is kept as a name with no
    address — it will not be invited.
    """
    out: list[dict] = []
    for raw in entries if isinstance(entries, list) else [entries]:
        s = str(raw).strip()
        m = re.match(r"^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$", s)
        if not m:
            out.append({"name": s, "email": None, "note": None})
            continue
        target, alias = m.group(1).strip(), (m.group(2) or "").strip()
        note = CONTACTS / f"{target}.md"
        if not note.exists():
            hits = list(CONTACTS.glob(f"{target}.md")) or [
                p for p in CONTACTS.glob("*.md") if p.stem.lower() == target.lower()
            ]
            note = hits[0] if hits else None
        email = None
        if note and note.exists():
            fm = frontmatter(note.read_text(encoding="utf-8"))
            emails = fm.get("emails") or []
            if isinstance(emails, str):
                emails = [emails]
            email = next((e for e in emails if e), None)
        out.append({"name": alias or target, "email": email,
                    "note": str(note.relative_to(VAULT)) if note else None})
    return out


def verify_target() -> tuple[bool, str, dict | None]:
    if not TARGET_CALENDAR_ID:
        return False, "Set UPTICK_CALENDAR_ID in private Uptick configuration before creating events.", None
    status = bridge("calendar-access-status")
    if not status.get("can_write_events"):
        return False, f"bridge cannot write (status={status.get('status')!r})", None
    if not status.get("can_read_events"):
        return (
            False,
            "bridge has WRITE-ONLY calendar access, so the target cannot be verified. "
            "macOS exposes only a placeholder calendar in this mode and a write would "
            "go somewhere opaque. Grant full Calendar access in System Settings > "
            "Privacy & Security > Calendars, then retry.",
            None,
        )

    listing = bridge("list-calendar-calendars")
    items = listing.get("items") or []
    match = next((c for c in items if c.get("calendar_id") == TARGET_CALENDAR_ID), None)
    if not match:
        names = ", ".join(f"{c.get('title')} [{c.get('calendar_id')}]" for c in items) or "none"
        return (
            False,
            f"target {TARGET_CALENDAR_ID} not found. Visible calendars: {names}. "
            "Set UPTICK_CALENDAR_ID to a visible calendar ID; do not substitute "
            "a similarly named calendar.",
            None,
        )

    blob = f"{match.get('title','')} {match.get('source_title','')}".lower()
    if not any(tok in blob for tok in TARGET_EXPECT):
        return (
            False,
            f"target resolved to {match.get('title')!r} (source "
            f"{match.get('source_title')!r}), which does not match the configured "
            f"calendar expectation {TARGET_EXPECT}. Refusing to write.",
            match,
        )
    return True, "target verified", match


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--note", required=True, help="vault-relative path to a meeting note")
    ap.add_argument("--apply", action="store_true", help="actually create the event")
    a = ap.parse_args()

    path = VAULT / a.note
    if not path.exists():
        print(f"calendar-push: note not found: {path}", file=sys.stderr)
        return 2

    text = path.read_text(encoding="utf-8")
    fm = frontmatter(text)
    if str(fm.get("type", "")) != "meeting":
        print(f"calendar-push: {a.note} is not type: meeting", file=sys.stderr)
        return 2
    if fm.get("calendar_event_id"):
        print(json.dumps({"ok": True, "skipped": "already pushed",
                          "event_id": fm["calendar_event_id"]}))
        return 0

    date = str(fm.get("meeting_date") or fm.get("date") or "")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        print(f"calendar-push: no usable meeting_date in {a.note}", file=sys.stderr)
        return 2

    time = str(fm.get("time") or "").strip()
    if not re.match(r"^\d{1,2}:\d{2}$", time):
        print(f"calendar-push: {a.note} has no time; refusing to invent one", file=sys.stderr)
        return 2

    minutes = int(str(fm.get("duration") or DEFAULT_MINUTES) or DEFAULT_MINUTES)
    start = datetime.fromisoformat(f"{date}T{time}:00").astimezone()
    end = start + timedelta(minutes=minutes)

    attendees = resolve_attendees(fm.get("attendees") or [])
    invitees = [a["email"] for a in attendees if a.get("email")]
    unaddressed = [a["name"] for a in attendees if not a.get("email")]
    notes_parts = []
    for h in ("Context", "Agenda"):
        body = section(text, h)
        if body:
            notes_parts.append(f"{h}:\n{body}")
    notes_parts.append(f"Obsidian note: {a.note}")
    notes = "\n\n".join(notes_parts)[:4000]

    ok, why, cal = verify_target()
    plan = {
        "title": str(fm.get("title") or path.stem),
        "calendar_id": TARGET_CALENDAR_ID,
        "start": start.isoformat(timespec="seconds"),
        "end": end.isoformat(timespec="seconds"),
        "notes": notes,
        "location": fm.get("location") or None,
        "all_day": False,
        # Addresses drive the Exchange invite. Anyone without one is reported
        # rather than silently dropped.
        "attendees": invitees,
    }

    if not ok:
        print(json.dumps({"ok": False, "blocked": why, "attendees": attendees,
                          "no_email": unaddressed, "would_create": plan}, indent=2))
        return 3

    if not a.apply:
        print(json.dumps({"ok": True, "dry_run": True, "target": cal,
                          "attendees": attendees,
                          "no_email": unaddressed,
                          "would_create": plan}, indent=2))
        return 0

    created = bridge("create-calendar-event", plan)
    if not created or created.get("ok") is False:
        print(json.dumps({"ok": False, "error": created}, indent=2), file=sys.stderr)
        return 4

    event_id = created.get("event_id") or created.get("id")
    if event_id:
        # Record the link so a second run cannot create a duplicate event.
        updated = re.sub(r"^(---\n)", rf"\1calendar_event_id: {event_id}\n", text, count=1)
        path.write_text(updated, encoding="utf-8")

    print(json.dumps({"ok": True, "created": created, "event_id": event_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
