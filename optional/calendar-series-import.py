#!/usr/bin/env python3
"""Turn active calendar recurring events into Uptick series notes.

    calendar-series-import.py [--apply]

Reads the TSV produced by the bulk recurrence dump (title, RRULE, start date)
and writes one note per distinct active series into 2 Work/Meetings/Recurring/.

WHAT IS SKIPPED, AND WHY
  - "Canceled:" titles: Exchange keeps the master around after cancellation.
  - RRULEs whose UNTIL has already passed: the series has ended.
  - FREQ=YEARLY: birthdays and anniversaries are date markers, not meetings.
  - All-day markers with no clock time (PTO blocks and similar).

Dry-run by default. Nothing is overwritten: a note that already exists is
reported and left alone, because the vault copy may carry hand-written agenda.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from uptick_private_config import load_private_env, load_series_rules


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
OUT = VAULT / "2 Work/Meetings/Recurring"
DUMP = Path(os.environ.get("UPTICK_SERIES_DUMP", "/tmp/uptick-recurring.tsv"))
TODAY = datetime.now()

DAY = {"MO": "monday", "TU": "tuesday", "WE": "wednesday",
       "TH": "thursday", "FR": "friday", "SA": "saturday", "SU": "sunday"}

try:
    MERGE, SKIP_TITLES = load_series_rules(VAULT)
except ValueError as exc:
    raise SystemExit(f"calendar-series-import: {exc}") from exc


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "series"


def safe_name(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|#^\[\]]+', "-", s).strip()[:70].strip(" -.")


def parse_start(raw: str):
    """'Wednesday, June 10, 2026 at 8:05:00 AM' -> (date, 'HH:MM')."""
    m = re.search(r"([A-Za-z]+ \d{1,2}, \d{4})(?:\s+at\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M))?", raw)
    if not m:
        return None, None
    try:
        d = datetime.strptime(m.group(1), "%B %d, %Y")
    except ValueError:
        return None, None
    t = None
    if m.group(2):
        try:
            t = datetime.strptime(m.group(2).strip(), "%I:%M:%S %p").strftime("%H:%M")
        except ValueError:
            t = None
    return d, t


def rrule_to_cadence(rrule: str):
    """RRULE -> (cadence, weekdays, extra fields) or None if unsupported."""
    parts = dict(kv.split("=", 1) for kv in rrule.split(";") if "=" in kv)
    freq = parts.get("FREQ", "")
    interval = int(parts.get("INTERVAL", "1") or 1)
    byday = [d.strip() for d in parts.get("BYDAY", "").split(",") if d.strip()]

    if freq == "WEEKLY":
        plain = [DAY[d] for d in byday if d in DAY]
        if not plain:
            return None
        if interval == 1:
            weekdays = {"monday", "tuesday", "wednesday", "thursday", "friday"}
            if set(plain) == weekdays:
                return ("weekdays", plain, {})
            return ("weekly", plain, {})
        if interval == 2:
            return ("biweekly", plain, {})
        return None

    if freq == "MONTHLY":
        dom = parts.get("BYMONTHDAY")
        if dom and dom.lstrip("-").isdigit():
            return ("monthly", [], {"day_of_month": int(dom)})
        # BYDAY=3WE -> third Wednesday
        for d in byday:
            m = re.match(r"^(-?\d+)([A-Z]{2})$", d)
            if m and m.group(2) in DAY:
                return ("monthly", [DAY[m.group(2)]], {"nth": int(m.group(1))})
        return None

    return None  # DAILY is rare here; YEARLY is filtered upstream


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    if not DUMP.exists():
        print(f"missing {DUMP} — run the recurrence dump first", file=sys.stderr)
        return 2

    seen: dict[tuple, dict] = {}
    for line in DUMP.read_text(encoding="utf-8", errors="replace").splitlines():
        cols = line.split("\t")
        if len(cols) < 3:
            continue
        title, rrule, start = cols[0].strip(), cols[1].strip(), cols[2].strip()
        if not title or not rrule:
            continue
        k = (title, rrule)
        rec = seen.setdefault(k, {"n": 0, "starts": []})
        rec["n"] += 1
        rec["starts"].append(start)

    skipped = {"cancelled": [], "expired": [], "yearly": [], "unsupported": [],
               "no_time": [], "not_a_meeting": []}
    series: dict[str, dict] = {}

    for (title, rrule), rec in seen.items():
        if re.match(r"^(canceled|cancelled)\s*:", title, re.I):
            skipped["cancelled"].append(title); continue
        m = re.search(r"UNTIL=(\d{8})", rrule)
        if m and datetime.strptime(m.group(1), "%Y%m%d") < TODAY:
            skipped["expired"].append(title); continue
        if "FREQ=YEARLY" in rrule:
            skipped["yearly"].append(title); continue
        if any(p.search(title) for p in SKIP_TITLES):
            skipped["not_a_meeting"].append(title); continue

        parsed = rrule_to_cadence(rrule)
        if not parsed:
            skipped["unsupported"].append(f"{title}  [{rrule}]"); continue
        cadence, weekdays, extra = parsed

        dates = [parse_start(s) for s in rec["starts"]]
        dates = [(d, t) for d, t in dates if d]
        if not dates:
            skipped["no_time"].append(title); continue
        dates.sort()
        last_date, _ = dates[-1]
        times = [t for _, t in dates if t]
        time = max(set(times), key=times.count) if times else ""
        if not time:
            skipped["no_time"].append(title); continue

        # Strip the year prefix some calendar providers use on re-issued series.
        clean = re.sub(r"^\s*20\d\d\s+", "", title).strip()
        name = clean
        for pat, merged in MERGE:
            if pat.search(clean):
                name = merged
                break

        s = series.setdefault(name, {
            "cadence": cadence, "weekdays": set(), "extra": extra,
            "time": time, "n": 0, "rrules": set(), "last": last_date,
            "titles": set(),
        })
        s["weekdays"].update(weekdays)
        s["n"] += rec["n"]
        s["rrules"].add(rrule)
        s["titles"].add(title)
        if last_date > s["last"]:
            s["last"] = last_date
        # A merged series covering the whole work week is a weekdays cadence.
        if s["cadence"] == "weekly" and s["weekdays"] >= {
                "monday", "tuesday", "wednesday", "thursday", "friday"}:
            s["cadence"] = "weekdays"

    created, existed = [], []
    OUT.mkdir(parents=True, exist_ok=True)

    for name, s in sorted(series.items()):
        path = OUT / f"{safe_name(name)}.md"
        if path.exists():
            order0 = ["monday", "tuesday", "wednesday", "thursday", "friday",
                      "saturday", "sunday"]
            existed.append((name, s["cadence"], s["time"],
                            ",".join(d[:3] for d in order0 if d in s["weekdays"])))
            continue
        order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        wd = [d for d in order if d in s["weekdays"]]
        lines = [
            "---",
            "type: recurring-meeting",
            f"series: {slug(name)}",
            f"cadence: {s['cadence']}",
            f"weekdays: [{', '.join(wd)}]",
            f'time: "{s["time"]}"',
            "duration:",
            "attendees:",
            "status: needs-confirmation",
            "project:",
            "source: calendar",
            f'source_rrule: "{sorted(s["rrules"])[0]}"',
            f"last_seen: {s['last'].strftime('%Y-%m-%d')}",
        ]
        if s["cadence"] == "biweekly":
            lines.append(f"anchor: {s['last'].strftime('%Y-%m-%d')}")
        for k, v in s["extra"].items():
            lines.append(f"{k}: {v}")
        lines += [
            "cssclasses:", "  - life-os", "  - max", "---", "",
            f"# {name}", "",
            "Standing series definition. Each occurrence gets its own note from",
            f"`4 System/Templates/Meeting.md` with `series: {slug(name)}`.", "",
            "> [!info] Imported from Calendar",
            "> Cadence came from the calendar's own recurrence rule, not from guesswork.",
            f"> - **Rule:** `{sorted(s['rrules'])[0]}`",
            f"> - **Occurrences on the calendar:** {s['n']}",
            f"> - **Most recent:** {s['last'].strftime('%Y-%m-%d')}",
        ]
        if len(s["titles"]) > 1:
            lines.append(f"> - **Merged from {len(s['titles'])} calendar series:** "
                         + "; ".join(sorted(s["titles"])[:6]))
        lines += [
            ">",
            "> `duration` and `attendees` are not in the recurrence rule — fill them in,",
            "> then change `status` to `active`.", "",
            "## Standing agenda", "",
            "## Participants", "",
            "## Notes", "",
        ]
        created.append(name)
        if a.apply:
            path.write_text("\n".join(lines), encoding="utf-8")

    verb = "created" if a.apply else "would create"
    print(f"\n=== {verb}: {len(created)} ===")
    for n in created:
        s = series[n]
        order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        wd = ",".join(d[:3] for d in order if d in s["weekdays"])
        print(f"  {n[:46]:<46} {s['cadence']:<9} {s['time']}  {wd}")

    print(f"\n=== already in the vault, left untouched: {len(existed)} ===")
    for n, cad, tm, wd in existed:
        print(f"  {n[:44]:<44} calendar says: {cad:<9} {tm}  {wd}")

    for k, v in skipped.items():
        if v:
            print(f"\n=== skipped ({k}): {len(v)} ===")
            for n in sorted(set(v))[:8]:
                print(f"  {n[:78]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
