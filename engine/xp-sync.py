#!/usr/bin/env python3
"""The Uptick XP engine.

Reads the vault, computes every XP event that has become earnable, appends the
new ones to an append-only Markdown ledger, and regenerates the derived notes
under 4 System/Game/.

Design: 4 System/Game/Gamification Design.md

Rules this file must keep to:
  - Markdown is the source of truth. The ledger is the record; Character.md and
    everything else are derived and safe to delete.
  - This script NEVER writes to 2 Work/Tasks/Task Inbox.md. priority-task-sync.py
    is the only writer of task lines, so there is exactly one owner of that
    format. Difficulty is read from the [difficulty:: N] field it writes.
  - Every event carries a deterministic id, so re-running can never double-count
    and a missed day can always be caught up.
  - Local only. No network.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import statistics
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

# --------------------------------------------------------------- game config

# Defaults below are the shipped values. Anything the user has changed in the
# Uptick settings page overrides them — the plugin stores its config in
# .obsidian/plugins/life-os/data.json, and this reads the same file so a rate
# changed in the UI changes what the engine actually awards. There is one
# source of truth for these numbers, and it is not this file.

BASE_XP = {1: 10, 2: 25, 3: 50, 4: 100, 5: 200}
DIFF_LABEL = {1: "Trivial", 2: "Small", 3: "Standard", 4: "Hard", 5: "Epic"}

EARLY_MULT, ONTIME_MULT, LATE_MULT = 1.25, 1.00, 0.50
PRIORITY_BONUS_LEVELS = (1, 2)
PRIORITY_MULT = 1.25
STREAK_STEP, STREAK_CAP = 0.02, 1.30

DECAY_RATE = 0.10          # of base XP, per day overdue
DECAY_GRACE_DAYS = 1       # decay starts on the second day overdue
# Most days this job runs on schedule. When it has not — the machine was off,
# the agent was unloaded — the backlog is forgiven rather than charged in one
# lump. The system only bills for time it was actually watching.
MAX_CATCHUP_DAYS = 7
GLOBAL_DECAY_FRACTION = 0.25   # of the trailing 7-day earn rate

# Study
CARD_XP = {"easy": 3, "good": 3, "hard": 2, "again": 1}
NOTE_REVIEW_XP = 5
SESSION_BONUS_XP = 10
SESSION_MIN_CARDS = 10
CARD_XP_DAILY_CAP = 400

# Rituals
RITUAL_XP = {
    "intentions_early": 15, "intentions": 10, "worklog": 5, "eod": 20,
    "agenda": 10, "weekly": 75, "monthly": 200, "triaged": 25,
}
WORKLOG_DAILY_CAP = 4

# Levels
def level_threshold(n: int) -> int:
    """Total XP required to reach level n. Level 1 is where everyone starts."""
    if n <= 1:
        return 0
    return 50 * n * n + 50 * n


RANKS = ((100, "Ascended"), (75, "Legend"), (60, "Luminary"), (50, "Distinguished"),
         (40, "Principal"), (30, "Architect"), (20, "Specialist"),
         (10, "Technician"), (1, "Operator"))

# Reward bank
BANK_RATE = 250.0        # XP per $1
LEVEL_BONUS = 2.00       # dollars per level, times the level
MONTHLY_CEILING = 100.0

# Streak freezes
FREEZES_PER_MONTH = 2

TIER_XP = {"Bronze": 50, "Silver": 150, "Gold": 500,
           "Platinum": 1500, "Mythic": 5000, "Hidden": 0}

# ------------------------------------------------------------------- paths

class Paths:
    def __init__(self, vault: Path):
        self.vault = vault
        self.task_inbox = vault / "2 Work/Tasks/Task Inbox.md"
        self.daily = vault / "1 Capture/Daily"
        self.weekly = vault / "1 Capture/Weekly"
        self.monthly = vault / "1 Capture/Monthly"
        self.meetings = vault / "2 Work/Meetings"
        self.game = vault / "4 System/Game"
        self.ledger = self.game / "XP Ledger.md"
        self.character = self.game / "Character.md"
        self.quest = self.game / "Quest Log.md"
        self.achievements = self.game / "Achievements.md"
        self.bank = self.game / "Reward Bank.md"
        self.certs = self.game / "Certifications"
        self.state = vault / "4 System/Automation/xp-state.json"
        # A generated cache for the plugin, alongside calendar-cache.json and
        # weather-cache.json. The Markdown notes stay authoritative; this only
        # spares the UI from parsing a 258-row table on every redraw.
        self.ach_cache = vault / "4 System/Automation/achievements-cache.json"
        self.quest_cache = vault / "4 System/Automation/quest-cache.json"
        self.learnkit = vault / ".obsidian/plugins/learnkit/scheduling/flashcards.db"


def load_config(vault: Path) -> dict:
    """Settings written by the Uptick plugin, or {} when it has none yet."""
    data = vault / ".obsidian/plugins/life-os/data.json"
    if not data.exists():
        return {}
    try:
        return (json.loads(data.read_text(encoding="utf-8")) or {}).get("config") or {}
    except (json.JSONDecodeError, OSError):
        return {}


def apply_config(cfg: dict) -> list[str]:
    """Override the module-level constants from the plugin's settings.

    Returns the names of everything actually overridden, which is reported in
    the run summary — a rate quietly differing from the documented default is
    the kind of thing that is very confusing six months later.
    """
    changed: list[str] = []
    g = cfg.get("game") or {}
    b = cfg.get("bank") or {}
    a = cfg.get("achievements") or {}

    def take(target_name, value, cast=float):
        nonlocal changed
        if value is None:
            return
        globals()[target_name] = cast(value)
        changed.append(target_name)

    take("EARLY_MULT", g.get("earlyMultiplier"))
    take("LATE_MULT", g.get("lateMultiplier"))
    take("PRIORITY_MULT", g.get("priorityBonus"))
    take("STREAK_STEP", g.get("streakStep"))
    take("STREAK_CAP", g.get("streakCap"))
    take("DECAY_RATE", g.get("decayRate"))
    take("DECAY_GRACE_DAYS", g.get("decayGraceDays"), int)
    take("MAX_CATCHUP_DAYS", g.get("maxCatchupDays"), int)
    take("GLOBAL_DECAY_FRACTION", g.get("globalDecayFraction"))
    take("FREEZES_PER_MONTH", g.get("freezesPerMonth"), int)
    take("NOTE_REVIEW_XP", g.get("noteReviewXp"), int)
    take("SESSION_BONUS_XP", g.get("sessionBonusXp"), int)
    take("CARD_XP_DAILY_CAP", g.get("cardXpDailyCap"), int)
    take("BANK_RATE", b.get("rate"))
    take("LEVEL_BONUS", b.get("levelBonus"))
    take("MONTHLY_CEILING", b.get("monthlyCeiling"))

    if g.get("baseXp"):
        for k, v in g["baseXp"].items():
            try:
                BASE_XP[int(k)] = int(v)
            except (TypeError, ValueError):
                continue
        changed.append("BASE_XP")
    if g.get("ritualXp"):
        key_map = {"intentionsEarly": "intentions_early", "intentions": "intentions",
                   "worklog": "worklog", "eod": "eod", "agenda": "agenda",
                   "weekly": "weekly", "monthly": "monthly", "triaged": "triaged"}
        for k, v in g["ritualXp"].items():
            if k in key_map:
                RITUAL_XP[key_map[k]] = int(v)
        changed.append("RITUAL_XP")
    if g.get("cardXp"):
        for k, v in g["cardXp"].items():
            CARD_XP[str(k)] = int(v)
        changed.append("CARD_XP")
    if a.get("tierXp"):
        for k, v in a["tierXp"].items():
            TIER_XP[str(k)] = int(v)
        changed.append("TIER_XP")
    return changed


def atomic_write(path: Path, content: str) -> bool:
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        Path(tmp).replace(path)
    finally:
        if Path(tmp).exists():
            Path(tmp).unlink()
    return True


# -------------------------------------------------------------- task reading

TASK_RE = re.compile(r"^- \[([ xX])\] (.*)$")
DUE_RE = re.compile(r"📅\s*(\d{4}-\d{2}-\d{2})")
DONE_RE = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
CREATED_RE = re.compile(r"➕\s*(\d{4}-\d{2}-\d{2})")
DIFF_RE = re.compile(r"\[difficulty::\s*([1-5])\s*([!~]?)\s*\]")
PRIO_RE = re.compile(r"\[priority::\s*(\d+)\s*\]")
ID_RE = re.compile(r"\^(task-[A-Za-z0-9-]+)")
TAG_RE = re.compile(r"#[A-Za-z0-9_/-]+")
SOURCE_RE = re.compile(r"Source:\s*\[\[([^\]|]+)")


class Task(dict):
    pass


def read_tasks(paths: Paths) -> list[Task]:
    if not paths.task_inbox.exists():
        return []
    lines = paths.task_inbox.read_text(encoding="utf-8").splitlines()
    out: list[Task] = []
    for i, line in enumerate(lines):
        m = TASK_RE.match(line)
        if not m or "#task" not in m.group(2):
            continue
        body = m.group(2)
        # Provenance sits on the lines after the checkbox, up to the next task.
        j, extra = i + 1, []
        while j < len(lines) and lines[j].strip() and not TASK_RE.match(lines[j]):
            extra.append(lines[j])
            j += 1
        segment = "\n".join([line] + extra)
        tags = set(TAG_RE.findall(body))
        diff = DIFF_RE.search(body)
        tid = ID_RE.search(body)
        out.append(Task(
            id=tid.group(1) if tid else f"line-{i}",
            checked=m.group(1).lower() == "x",
            done="#done" in tags or m.group(1).lower() == "x",
            blocked="#blocked" in tags or "#dependency" in tags,
            tags=tags,
            difficulty=int(diff.group(1)) if diff else 3,
            difficulty_mark=diff.group(2) if diff else "",
            priority=int(PRIO_RE.search(body).group(1)) if PRIO_RE.search(body) else 10,
            due=DUE_RE.search(body).group(1) if DUE_RE.search(body) else None,
            done_on=DONE_RE.search(body).group(1) if DONE_RE.search(body) else None,
            created=CREATED_RE.search(body).group(1) if CREATED_RE.search(body) else None,
            source=SOURCE_RE.search(segment).group(1) if SOURCE_RE.search(segment) else None,
            text=body,
            segment=segment,
        ))
    return out


# ------------------------------------------------------------------- ledger

LEDGER_ROW_RE = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([+-]?\d+)\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*`([^`]+)`\s*\|$")


def read_ledger(paths: Paths) -> list[dict]:
    if not paths.ledger.exists():
        return []
    events = []
    for line in paths.ledger.read_text(encoding="utf-8").splitlines():
        m = LEDGER_ROW_RE.match(line.strip())
        if m:
            events.append({"date": m.group(1), "xp": int(m.group(2)),
                           "kind": m.group(3), "detail": m.group(4), "id": m.group(5)})
    return events


LEDGER_HEADER = """---
title: XP Ledger
type: log
automation: xp-sync
cssclasses:
  - life-os
  - max
---

# XP Ledger

```life-os
view: ledger
```

*Append-only, newest at the bottom. Every row carries a deterministic id, so
re-running the sync can never double-count and a missed day can always be
caught up. Written by `4 System/Automation/xp-sync.py` — do not edit by hand,
since [[4 System/Game/Character]] and [[4 System/Game/Quest Log]] are rebuilt
from this file.*

| Date | XP | Kind | Detail | Event id |
| --- | --- | --- | --- | --- |
"""


def cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ").strip()


def write_ledger(paths: Paths, events: list[dict]) -> str:
    rows = [f"| {e['date']} | {e['xp']:+d} | {e['kind']} | {cell(e['detail'])} | `{e['id']}` |"
            for e in events]
    return LEDGER_HEADER + "\n".join(rows) + "\n"


# ---------------------------------------------------------- daily note facts

def section_items(text: str, heading: str) -> list[str]:
    """Bullet items directly under a `## heading`, up to the next heading."""
    pattern = re.compile(rf"^#{{1,6}}\s+{re.escape(heading)}\s*$", re.M | re.I)
    m = pattern.search(text)
    if not m:
        return []
    rest = text[m.end():]
    stop = re.search(r"^#{1,6}\s+", rest, re.M)
    block = rest[:stop.start()] if stop else rest
    return [ln.strip()[2:].strip() for ln in block.splitlines()
            if ln.strip().startswith("- ") and ln.strip()[2:].strip()]


WORKLOG_TIME_RE = re.compile(r"^`(\d{1,2}):(\d{2})\s*(AM|PM)`", re.I)


def daily_facts(paths: Paths) -> dict[str, dict]:
    """Per-day ritual facts, keyed by ISO date."""
    facts: dict[str, dict] = {}
    if not paths.daily.exists():
        return facts
    for f in sorted(paths.daily.glob("*.md")):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", f.stem):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        priorities = section_items(text, "Priorities") + section_items(text, "Focus")
        worklog = section_items(text, "Work Log")
        completed = section_items(text, "Completed")
        tomorrow = section_items(text, "Notes for Tomorrow")
        # "Before 10:00" is judged from the first timestamped work-log entry,
        # the only clock the daily note actually records.
        earliest = None
        for entry in worklog:
            m = WORKLOG_TIME_RE.match(entry)
            if not m:
                continue
            hour = int(m.group(1)) % 12 + (12 if m.group(3).upper() == "PM" else 0)
            minute = int(m.group(2))
            stamp = hour * 60 + minute
            earliest = stamp if earliest is None else min(earliest, stamp)
        facts[f.stem] = {
            "intentions": len(priorities),
            "worklog": len(worklog),
            "eod": bool(completed and tomorrow),
            "earliest_minute": earliest,
        }
    return facts


def review_dates(folder: Path) -> set[str]:
    """Dates of review notes that actually contain something."""
    out = set()
    if not folder.exists():
        return out
    for f in sorted(folder.glob("*.md")):
        text = f.read_text(encoding="utf-8", errors="replace")
        body = re.sub(r"^---.*?^---", "", text, flags=re.S | re.M)
        body = re.sub(r"```life-os.*?```", "", body, flags=re.S)
        if any(ln.strip().startswith("- ") for ln in body.splitlines()):
            m = re.search(r"(\d{4}-\d{2}-\d{2})", f.stem) or re.search(
                r"date:\s*(\d{4}-\d{2}-\d{2})", text)
            if m:
                out.add(m.group(1))
    return out


# ------------------------------------------------------------ learnkit study

def read_learnkit(paths: Paths) -> tuple[list[dict], dict, dict]:
    """(analytics events, card states, cards) from LearnKit's snapshot."""
    if not paths.learnkit.exists():
        return [], {}, {}
    try:
        con = sqlite3.connect(f"file:{paths.learnkit}?mode=ro", uri=True)
        row = con.execute("SELECT payload FROM store_snapshot WHERE id = 1").fetchone()
        con.close()
    except sqlite3.Error:
        return [], {}, {}
    if not row:
        return [], {}, {}
    try:
        payload = json.loads(row[0])
    except json.JSONDecodeError:
        return [], {}, {}
    analytics = payload.get("analytics") or {}
    return (list(analytics.get("events") or []),
            dict(payload.get("states") or {}),
            dict(payload.get("cards") or {}))


def study_events(events: list[dict]) -> list[dict]:
    """Turn LearnKit analytics into XP events, capped per day."""
    out: list[dict] = []
    card_xp_by_day: Counter[str] = Counter()
    session_seen: set[tuple[str, str]] = set()

    for ev in sorted(events, key=lambda e: (e.get("at") or 0, e.get("eventId") or 0)):
        kind = ev.get("kind")
        at = ev.get("at")
        if not at:
            continue
        day = datetime.fromtimestamp(at / 1000).date().isoformat()
        eid = ev.get("eventId")
        practice = ev.get("mode") == "practice"

        if kind == "review":
            result = str(ev.get("result") or "good").lower()
            xp = CARD_XP.get(result, 1)
            if practice:
                xp //= 2
            if xp <= 0:
                continue
            room = CARD_XP_DAILY_CAP - card_xp_by_day[day]
            if room <= 0:
                continue
            xp = min(xp, room)
            card_xp_by_day[day] += xp
            out.append({"date": day, "xp": xp, "kind": "study",
                        "detail": f"card reviewed ({result})", "id": f"study:{eid}"})

        elif kind == "note-review":
            out.append({"date": day, "xp": NOTE_REVIEW_XP, "kind": "study",
                        "detail": "note reviewed", "id": f"study:{eid}"})

        elif kind == "session":
            scope = str(ev.get("scope") or "deck")
            key = (day, scope)
            if key in session_seen:
                continue
            session_seen.add(key)
            out.append({"date": day, "xp": SESSION_BONUS_XP, "kind": "study",
                        "detail": f"study session ({scope})", "id": f"study:{eid}"})

        elif kind == "exam-attempt":
            pct = float(ev.get("finalPercent") or 0)
            q = int(ev.get("mcqCount") or 0) + int(ev.get("saqCount") or 0)
            if q >= 40:
                xp, band = min(300, round(50 + pct * 2.5)), "practice exam"
            elif q >= 15:
                xp, band = min(125, round(25 + pct * 1.0)), "test"
            else:
                xp, band = min(60, round(10 + pct * 0.5)), "quiz"
            out.append({"date": day, "xp": int(xp), "kind": "study",
                        "detail": f"{band} · {pct:.0f}% ({q} q)", "id": f"study:{eid}"})
    return out


# ------------------------------------------------------------------ task xp

def parse_date(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def task_completion_events(tasks: list[Task], streak_on: dict[str, int]) -> list[dict]:
    out = []
    for t in tasks:
        if not t["done"] or not t["done_on"]:
            continue
        done, due = parse_date(t["done_on"]), parse_date(t["due"])
        base = BASE_XP[t["difficulty"]]
        if due is None or done == due:
            timing, label = ONTIME_MULT, "on time"
        elif done < due:
            timing, label = EARLY_MULT, "early"
        else:
            timing, label = LATE_MULT, "late"
        prio = PRIORITY_MULT if t["priority"] in PRIORITY_BONUS_LEVELS else 1.0
        streak = min(STREAK_CAP, 1 + STREAK_STEP * streak_on.get(t["done_on"], 0))
        xp = math.floor(base * timing * prio * streak + 0.5)
        out.append({"date": t["done_on"], "xp": int(xp), "kind": "task",
                    "detail": f"D{t['difficulty']} {DIFF_LABEL[t['difficulty']]} · {label}"
                              f" · {short(t['text'])}",
                    "id": f"task:{t['id']}"})
    return out


def short(text: str, n: int = 120) -> str:
    """Clean a task line down to its title, for a ledger detail.

    The ledger is a permanent record, so the limit is generous: a decay row
    that reads "... update field permissi…" is useless for as long as it exists.
    """
    clean = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", text)
    clean = re.sub(r"\[\[([^\]]*)\]\]", r"\1", clean)
    clean = re.sub(r"\[(?:priority|difficulty|ticket)::[^\]]*\]", "", clean)
    clean = re.sub(r"[📅✅➕⏳🛫]\s*\d{4}-\d{2}-\d{2}", "", clean)
    clean = re.sub(r"\^task-[A-Za-z0-9-]+", "", clean)
    clean = TAG_RE.sub("", clean)
    clean = re.sub(r"[⏫🔼🔽⏬🔺]", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean[:n] + ("…" if len(clean) > n else "")


def decay_events(tasks: list[Task], today: date, blocked_days: dict[str, int],
                 earn_by_day: dict[str, int], start: date,
                 cursor: dict[str, str]) -> list[dict]:
    """One event per overdue task per day, with all three caps applied.

    `cursor` records the last day already considered for each task, and it
    advances whether or not a charge was made. Without it, a task that spent
    three months blocked would be charged for every one of those days the
    moment it was unblocked — the instant debt the design exists to prevent.
    """
    raw: dict[str, list[dict]] = defaultdict(list)
    for t in tasks:
        if t["done"]:
            continue
        due = parse_date(t["due"])
        if not due:
            continue
        # Blocked stops the clock. The cursor still moves, so those days are
        # consumed rather than banked up to be charged on unblock.
        if t["blocked"]:
            cursor[t["id"]] = today.isoformat()
            continue
        base = BASE_XP[t["difficulty"]]
        first = max(due + timedelta(days=1 + DECAY_GRACE_DAYS), start)
        seen = parse_date(cursor.get(t["id"]))
        if seen is None:
            # First sighting. A task starts decaying from the day the engine
            # first observes it, never before — otherwise importing a task that
            # is already three weeks late charges three weeks of decay at once,
            # for a delay that happened before the system could see it.
            cursor[t["id"]] = today.isoformat()
            continue
        day = max(first, seen + timedelta(days=1),
                  today - timedelta(days=MAX_CATCHUP_DAYS - 1))
        blocked = blocked_days.get(t["id"], 0)
        while day <= today:
            # Escalation is capped by how long the system has been watching. A
            # task already 40 days overdue on day one starts at day one's rate,
            # not day forty's — the same reason there is no backfill.
            observed = (day - start).days + 1
            overdue_n = min((day - due).days - blocked, observed)
            if overdue_n > DECAY_GRACE_DAYS:
                amount = min(base, math.ceil(base * DECAY_RATE) * (overdue_n - DECAY_GRACE_DAYS))
                raw[day.isoformat()].append({
                    "date": day.isoformat(), "xp": -int(amount), "kind": "decay",
                    "detail": f"{overdue_n}d overdue · D{t['difficulty']} · {short(t['text'])}",
                    "id": f"decay:{t['id']}:{day.isoformat()}"})
            day += timedelta(days=1)
        cursor[t["id"]] = today.isoformat()

    # Global cap: a bad week cannot erase a good month.
    out: list[dict] = []
    for day_iso in sorted(raw):
        d = date.fromisoformat(day_iso)
        window = [earn_by_day.get((d - timedelta(days=k)).isoformat(), 0) for k in range(1, 8)]
        avg = sum(window) / 7 if any(window) else 0
        cap = max(10, int(avg * GLOBAL_DECAY_FRACTION))
        total = sum(-e["xp"] for e in raw[day_iso])
        if total <= cap:
            out.extend(raw[day_iso])
            continue
        scale = cap / total
        for e in raw[day_iso]:
            scaled = max(1, int(round(-e["xp"] * scale)))
            out.append({**e, "xp": -scaled, "detail": e["detail"] + " (capped)"})
    return out


def ritual_events(facts: dict[str, dict], weeklies: set[str],
                  monthlies: set[str]) -> list[dict]:
    out = []
    for day, f in sorted(facts.items()):
        if f["intentions"]:
            early = f["earliest_minute"] is not None and f["earliest_minute"] < 10 * 60
            key = "intentions_early" if early else "intentions"
            out.append({"date": day, "xp": RITUAL_XP[key], "kind": "ritual",
                        "detail": "what matters today" + (" (before 10:00)" if early else ""),
                        "id": f"ritual:{day}:intentions"})
        n = min(WORKLOG_DAILY_CAP, f["worklog"])
        if n:
            out.append({"date": day, "xp": RITUAL_XP["worklog"] * n, "kind": "ritual",
                        "detail": f"{n} work log entr{'y' if n == 1 else 'ies'}",
                        "id": f"ritual:{day}:worklog"})
        if f["eod"]:
            out.append({"date": day, "xp": RITUAL_XP["eod"], "kind": "ritual",
                        "detail": "end of day review", "id": f"ritual:{day}:eod"})
    for day in sorted(weeklies):
        out.append({"date": day, "xp": RITUAL_XP["weekly"], "kind": "ritual",
                    "detail": "weekly review", "id": f"ritual:{day}:weekly"})
    for day in sorted(monthlies):
        out.append({"date": day, "xp": RITUAL_XP["monthly"], "kind": "ritual",
                    "detail": "monthly review", "id": f"ritual:{day}:monthly"})
    return out


# ------------------------------------------------------------ derived state

def level_for(total_xp: int) -> int:
    n = 1
    while total_xp >= level_threshold(n + 1):
        n += 1
    return n


def rank_for(level: int) -> str:
    for floor, name in RANKS:
        if level >= floor:
            return name
    return "Operator"


def compute_streak(days: list[str], today: date, freezes: int) -> tuple[int, int, int]:
    """(current streak, longest streak, freezes spent).

    A freeze bridges one missing day without breaking the run, but does not
    itself count as a day earned — the streak is preserved, not inflated.
    """
    if not days:
        return 0, 0, 0
    active = sorted({date.fromisoformat(d) for d in days})
    longest = run = 1
    for prev, cur in zip(active, active[1:]):
        run = run + 1 if (cur - prev).days == 1 else 1
        longest = max(longest, run)

    have = set(active)
    earliest = active[0]
    # Not having earned yet today should not break yesterday's streak.
    cursor = today if today in have else today - timedelta(days=1)
    current = spent = 0
    while cursor >= earliest:
        if cursor in have:
            current += 1
        elif spent < freezes:
            spent += 1
        else:
            break
        cursor -= timedelta(days=1)
    return current, max(longest, current), spent


# ------------------------------------------------------------------- stats

SF_TERMS = {
    "deploy_tasks": ("deploy", "deployment", "release"),
    "sandbox_tasks": ("sandbox", "refresh"),
    "permission_tasks": ("permission", "profile", "sharing", "fls", "access"),
    "integration_tasks": ("integration", "mulesoft", "api", "endpoint"),
    "data_tasks": ("data load", "data remediation", "cleanup", "migration", "soql"),
    "bug_tasks": ("bug", "defect", "broken", "not working", "incorrectly"),
}



def countable_notes(vault: Path) -> int:
    """Notes a human wrote. Excludes plugin data and this engine's own output,
    which would otherwise unlock note achievements the moment it first ran."""
    skip_parts = {".obsidian", ".smart-env", ".claudian", ".agents", ".claude"}
    generated = vault / "4 System/Game"
    n = 0
    for f in vault.rglob("*.md"):
        if skip_parts & set(f.parts):
            continue
        if generated in f.parents:
            continue
        n += 1
    return n


def build_stats(tasks: list[Task], events: list[dict], facts: dict[str, dict],
                weeklies: set[str], monthlies: set[str], states: dict,
                lk_events: list[dict], paths: Paths, today: date,
                streak: int, longest: int, freezes_used: int,
                readiness: list[dict], manual: set[str],
                start_date: str, baseline: dict):
    """Stats the achievement predicates see.

    Everything is measured from `start_date` forward. Counts that describe the
    vault as it already stood — notes, meetings, cards that existed before the
    system was switched on — are measured against `baseline`, so "start at
    zero" means zero rather than an instant windfall for work done earlier.
    """
    from achievements import Stats
    s = Stats()

    def since(n: int, key: str) -> int:
        return max(0, n - int(baseline.get(key, 0)))

    facts = {d: f for d, f in facts.items() if d >= start_date}
    weeklies = {d for d in weeklies if d >= start_date}
    monthlies = {d for d in monthlies if d >= start_date}
    lk_events = [e for e in lk_events
                 if e.get("at") and datetime.fromtimestamp(e["at"] / 1000).date().isoformat() >= start_date]

    done = [t for t in tasks if t["done"] and t["done_on"] and t["done_on"] >= start_date]
    s.tasks_done = len(done)
    per_day = Counter(t["done_on"] for t in done)
    s.tasks_done_today = per_day.get(today.isoformat(), 0)
    s.max_tasks_day = max(per_day.values(), default=0)
    per_week = Counter(date.fromisoformat(d).isocalendar()[:2] for d in per_day.elements())
    s.max_tasks_week = max(per_week.values(), default=0)
    per_month = Counter(d[:7] for d in per_day.elements())
    s.max_tasks_month = max(per_month.values(), default=0)

    s.by_difficulty = dict(Counter(t["difficulty"] for t in done))
    s.hard_plus_done = sum(1 for t in done if t["difficulty"] >= 4)
    s.epics_done = sum(1 for t in done if t["difficulty"] == 5)
    s.xp_from_epics = sum(e["xp"] for e in events if e["kind"] == "task" and " D5 " in f" {e['detail']} ")
    by_day_diffs = defaultdict(set)
    for t in done:
        by_day_diffs[t["done_on"]].add(t["difficulty"])
    s.all_difficulties_one_day = any(len(v) == 5 for v in by_day_diffs.values())

    for t in done:
        d, u = parse_date(t["done_on"]), parse_date(t["due"])
        if u and d:
            if d < u:
                s.done_early += 1
            elif d > u:
                s.done_late += 1
                if (d - u).days > 30:
                    s.revived_30d += 1
                if (d - u).days > 90:
                    s.revived_90d += 1
                s.overdue_cleared += 1
        c = parse_date(t["created"])
        if c and d and c == d:
            s.done_same_day += 1

    cleared_day = Counter(t["done_on"] for t in done
                          if parse_date(t["due"]) and parse_date(t["done_on"])
                          and parse_date(t["done_on"]) > parse_date(t["due"]))
    s.max_overdue_cleared_day = max(cleared_day.values(), default=0)

    open_tasks = [t for t in tasks if not t["done"]]
    s.zero_overdue_now = not any(
        t["due"] and parse_date(t["due"]) and parse_date(t["due"]) < today and not t["blocked"]
        for t in open_tasks)

    s.streak, s.longest_streak, s.streak_freezes_used = streak, longest, freezes_used
    weekend = {date.fromisoformat(d) for d in per_day if date.fromisoformat(d).weekday() >= 5}
    s.weekend_pairs = sum(1 for d in weekend if d.weekday() == 5 and d + timedelta(days=1) in weekend)

    # study
    s.cards_reviewed = sum(1 for e in lk_events if e.get("kind") == "review")
    s.graded_again = sum(1 for e in lk_events
                         if e.get("kind") == "review" and str(e.get("result")).lower() == "again")
    s.notes_reviewed = sum(1 for e in lk_events if e.get("kind") == "note-review")
    s.cards_created = since(len(states), "cards")
    s.mature_cards = sum(1 for st in states.values()
                         if isinstance(st, dict) and (st.get("stabilityDays") or 0) > 30)
    exams = [e for e in lk_events if e.get("kind") == "exam-attempt"]
    for e in exams:
        q = int(e.get("mcqCount") or 0) + int(e.get("saqCount") or 0)
        pct = float(e.get("finalPercent") or 0)
        if q >= 40:
            s.full_exams_taken += 1
            s.best_full_exam_pct = max(s.best_full_exam_pct, pct)
        elif q >= 15:
            s.tests_taken += 1
            if pct >= 100:
                s.perfect_tests += 1
        else:
            s.quizzes_taken += 1
        s.best_exam_pct = max(s.best_exam_pct, pct)

    # rituals
    intent_days = sorted(d for d, f in facts.items() if f["intentions"])
    s.intention_days = len(intent_days)
    s.intention_streak = longest_run(intent_days)
    s.intentions_before_8 = sum(
        1 for d, f in facts.items()
        if f["intentions"] and f["earliest_minute"] is not None and f["earliest_minute"] < 8 * 60)
    s.worklog_entries = sum(f["worklog"] for f in facts.values())
    s.full_log_days = sum(1 for f in facts.values() if f["worklog"] >= WORKLOG_DAILY_CAP)
    s.eod_completes = sum(1 for f in facts.values() if f["eod"])
    full_house = sorted(d for d, f in facts.items()
                        if f["intentions"] and f["worklog"] >= WORKLOG_DAILY_CAP and f["eod"])
    s.full_house_days = len(full_house)
    s.full_house_streak = longest_run(full_house)

    s.weekly_reviews = len(weeklies)
    s.weekly_review_streak = len(weeklies)
    s.monthly_reviews = len(monthlies)
    s.monthly_review_streak = len(monthlies)

    # meetings
    if paths.meetings.exists():
        notes = list(paths.meetings.rglob("*.md"))
        s.meetings_imported = since(len(notes), "meetings")
        s.meetings_with_agenda = sum(
            1 for f in notes
            if section_items(f.read_text(encoding="utf-8", errors="replace"), "Agenda"))
    # Only meetings whose work was closed since the start date count — these
    # are achievements for finishing things, not for history already on disk.
    closed_since = Counter(t["source"] for t in done if t["source"])
    s.max_tasks_one_meeting = max(closed_since.values(), default=0)
    src_open = {t["source"] for t in tasks if t["source"] and not t["done"]}
    s.meetings_fully_closed = sum(1 for src in closed_since if src not in src_open)

    # salesforce craft
    for t in done:
        low = t["text"].lower()
        for field, terms in SF_TERMS.items():
            if any(term in low for term in terms):
                setattr(s, field, getattr(s, field) + 1)
        if re.search(r"\bREQ-\d+\b", t["text"], re.I):
            s.req_tasks += 1
        if "#salesforce" in t["tags"] or "salesforce" in low:
            s.salesforce_tasks += 1

    s.note_count = since(countable_notes(paths.vault), "notes")
    s.manual_difficulty = sum(1 for t in tasks if t["difficulty_mark"] == "!")
    s.achievements_unlocked = len(manual)
    design = paths.game / "Gamification Design.md"
    s.read_the_design = design.exists()

    # certifications
    if readiness:
        s.max_readiness = max(r["score"] for r in readiness)
        s.no_weak_domain = any(r.get("no_weak_domain") for r in readiness)
        s.full_blueprint_coverage = any(r.get("coverage", 0) >= 0.999 for r in readiness)
        s.readiness_no_retakes = any(r.get("no_retakes") and r["score"] >= 90 for r in readiness)
        s.study_plans = len(readiness)
        s.certs_passed = sum(1 for r in readiness if r.get("passed"))
        s.certs_first_try = sum(1 for r in readiness if r.get("passed") and r.get("first_try"))
        s.real_exams_sat = sum(r.get("real_attempts", 0) for r in readiness)
    return s


def longest_run(days: list[str]) -> int:
    if not days:
        return 0
    ds = sorted(date.fromisoformat(d) for d in days)
    best = run = 1
    for prev, cur in zip(ds, ds[1:]):
        run = run + 1 if (cur - prev).days == 1 else 1
        best = max(best, run)
    return best


# -------------------------------------------------------------- reward bank

def bank_summary(events: list[dict], levels_reached: int,
                 today: date | None = None) -> dict:
    """Net-daily-XP banking, monthly ceiling, never negative.

    `today` decides which month "this month" means. It used to call
    date.today() directly, which ignored --today and reported $0.00 for any
    run catching up an earlier month -- invisible in normal use, wrong every
    time the date was overridden.
    """
    today = today or date.today()
    by_day: dict[str, int] = defaultdict(int)
    for e in events:
        by_day[e["date"]] += e["xp"]
    per_month: dict[str, float] = defaultdict(float)
    total = 0.0
    for day in sorted(by_day):
        net = max(0, by_day[day])
        month = day[:7]
        room = MONTHLY_CEILING - per_month[month]
        if room <= 0:
            continue
        amount = min(room, net / BANK_RATE)
        per_month[month] += amount
        total += amount
    bonus = sum(LEVEL_BONUS * n for n in range(2, levels_reached + 1))
    return {"earned": round(total, 2), "level_bonus": round(bonus, 2),
            "total": round(total + bonus, 2),
            "this_month": round(per_month.get(today.isoformat()[:7], 0.0), 2)}


# ------------------------------------------------------- certification notes

FM_RE = re.compile(r"^---\n(.*?)\n---", re.S)
ROW_RE = re.compile(r"^\|(.+)\|\s*$")


def frontmatter(text: str) -> dict:
    m = FM_RE.match(text)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "-")):
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def table_rows(text: str, heading: str) -> list[list[str]]:
    """Data rows of the first Markdown table under `heading`."""
    m = re.search(rf"^#{{1,6}}\s+{re.escape(heading)}\s*$", text, re.M | re.I)
    if not m:
        return []
    rest = text[m.end():]
    stop = re.search(r"^#{1,6}\s+", rest, re.M)
    block = rest[:stop.start()] if stop else rest
    rows = []
    for line in block.splitlines():
        rm = ROW_RE.match(line.strip())
        if not rm:
            continue
        cells = [c.strip() for c in rm.group(1).split("|")]
        if all(set(c) <= set("-: ") for c in cells) or not any(cells):
            continue
        rows.append(cells)
    return rows[1:] if rows else []          # drop the header row


def load_certifications(paths: Paths, states: dict, cards: dict,
                        today: date) -> list[dict]:
    """Compute readiness for every certification note that has a blueprint."""
    try:
        import importlib.util
        import sys as _sys
        spec = importlib.util.spec_from_file_location(
            "exam_readiness", Path(__file__).parent / "exam-readiness.py")
        er = importlib.util.module_from_spec(spec)
        # Must be registered before exec: @dataclass resolves the defining
        # module through sys.modules, and raises AttributeError without it.
        _sys.modules[spec.name] = er
        spec.loader.exec_module(er)
    except Exception as exc:
        print(json.dumps({"warning": f"exam-readiness unavailable: {exc}"}))
        return []

    out = []
    if not paths.certs.exists():
        return out
    for f in sorted(paths.certs.glob("*.md")):
        if f.stem.startswith("_"):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        fm = frontmatter(text)
        exam_date = parse_date(fm.get("exam_date") or "")
        pass_mark = float(fm.get("pass_mark") or 65)

        domains, scopes = {}, {}
        for row in table_rows(text, "Blueprint"):
            if len(row) < 3 or row[0].startswith("**") or not row[0]:
                continue
            pct = re.search(r"(\d+(?:\.\d+)?)\s*%", row[1] or "")
            if not pct:
                continue
            domains[row[0]] = float(pct.group(1)) / 100.0
            scopes[row[0]] = row[2]
        if not domains:
            continue

        bp = er.Blueprint(name=fm.get("title", f.stem), pass_mark=pass_mark,
                          domains=domains, version=fm.get("blueprint_version", ""))

        # A card is attributed to a domain by its LearnKit group — which is what
        # the `G` field in the deck note writes — falling back to the blueprint's
        # scope matched against the source note path. Matching against the card
        # id, as an earlier version did, never matched anything and left every
        # domain reading zero cards.
        lower_domains = {d.lower(): d for d in domains}
        deck_cards = []
        for cid, card in cards.items():
            if not isinstance(card, dict):
                continue
            domain = None
            for g in (card.get("groups") or []):
                domain = lower_domains.get(str(g).strip().lower())
                if domain:
                    break
            if domain is None:
                src = str(card.get("sourceNotePath") or "").lower()
                domain = next((d for d, sc in scopes.items()
                               if sc and sc.lower() in src), None)
            if domain is None:
                continue
            st = states.get(cid) or {}
            last = st.get("lastReviewed")
            elapsed = ((today - datetime.fromtimestamp(last / 1000).date()).days
                       if last else 0)
            deck_cards.append(er.Card(
                domain=domain,
                stability_days=float(st.get("stabilityDays") or 0),
                days_since_review=max(0, elapsed),
                lapses_30d=int(st.get("lapses") or 0),
                seen=str(st.get("stage")) not in ("new", "None", "")))
        cards_for_bp = deck_cards

        attempts, attempt_rows, seen_ids = [], [], Counter()
        for row in table_rows(text, "Practice attempts"):
            if len(row) < 5 or not row[0]:
                continue
            pct = re.search(r"(\d+(?:\.\d+)?)", row[4] or "")
            qs = re.search(r"(\d+)", row[3] or "")
            when = parse_date(row[0])
            if not (pct and qs and when):
                continue
            tid = row[2] or f"row{len(attempts)}"
            a = er.Attempt(test_id=tid, score=float(pct.group(1)),
                           questions=int(qs.group(1)),
                           days_ago=max(0, (today - when).days),
                           prior_attempts=seen_ids[tid])
            attempts.append(a)
            attempt_rows.append({
                "date": row[0], "source": row[1], "test_id": tid,
                "questions": a.questions, "score": a.score,
                "prior": a.prior_attempts, "days_ago": a.days_ago,
                "adjusted": round(er.adjusted_score(a), 1)})
            seen_ids[tid] += 1

        real = [r for r in table_rows(text, "Real exam attempts") if len(r) >= 3 and r[0]]
        passed = any("pass" in (r[2] or "").lower() for r in real)
        days_idle = 0
        if cards_for_bp:
            days_idle = min(c.days_since_review for c in cards_for_bp)
        days_left = (exam_date - today).days if exam_date else 30

        r = er.readiness(cards_for_bp, attempts, bp, max(1, days_left), days_idle)
        out.append({
            "file": f, "name": bp.name, "score": r.score, "band": r.band(),
            "coverage": r.coverage, "mastery": r.mastery, "performance": r.performance,
            "consistency": r.consistency, "composite": r.composite,
            "blockers": r.blockers, "binding": r.binding,
            "mastery_by_domain": r.mastery_by_domain, "days_left": days_left,
            "exam_date": fm.get("exam_date"), "pass_mark": pass_mark,
            "cards": len(cards_for_bp), "attempts": len(attempts),
            "attempts_log": attempt_rows,
            "no_weak_domain": all(m >= 0.5 for m in r.mastery_by_domain.values()),
            "no_retakes": all(a.prior_attempts == 0 for a in attempts) if attempts else False,
            "passed": passed, "real_attempts": len(real),
            "first_try": passed and len(real) == 1,
        })
    return out


def cert_milestone_events(certs: list[dict]) -> list[dict]:
    out = []
    for c in certs:
        text = c["file"].read_text(encoding="utf-8", errors="replace")
        slug = c["file"].stem
        for n, row in enumerate(table_rows(text, "Real exam attempts")):
            if len(row) < 3 or not row[0]:
                continue
            when = parse_date(row[0])
            pct = re.search(r"(\d+(?:\.\d+)?)", row[1] or "")
            if not (when and pct):
                continue
            score = float(pct.group(1))
            result = (row[2] or "").lower()
            predicted = float(re.search(r"(\d+)", row[3]).group(1)) if len(row) > 3 and re.search(r"(\d+)", row[3] or "") else 0.0
            parts = {"sat the exam": 500}
            if "pass" in result:
                parts["passed"] = 2500
                if n == 0:
                    parts["first attempt"] = 1000
                margin = int(round(20 * (score - c["pass_mark"])))
                if margin > 0:
                    parts["margin"] = margin
                if predicted >= 85:
                    parts["model agreed"] = 250
            else:
                partial = int(round(10 * max(0.0, score - 40)))
                if partial:
                    parts["partial credit"] = partial
            total = sum(parts.values())
            detail = f"{c['name']} · {score:.0f}% · " + ", ".join(f"{k} {v}" for k, v in parts.items())
            out.append({"date": when.isoformat(), "xp": int(total), "kind": "milestone",
                        "detail": detail, "id": f"exam:{slug}:{when.isoformat()}:{n}"})
    return out


# ---------------------------------------------------------------- rendering

def bar(fraction: float, width: int = 24) -> str:
    filled = max(0, min(width, round(fraction * width)))
    return "█" * filled + "░" * (width - filled)


def render_character(today: date) -> str:
    """The Character note.

    Thin, like the Quest Log: the plugin renders it from quest-cache.json so it
    looks like the rest of Uptick. Frontmatter still carries level, XP and
    streak, because that is what other panels read.
    """
    return f"""---
title: Character
type: dashboard
automation: xp-sync
updated: {today.isoformat()}
level: {{level}}
total_xp: {{total}}
streak: {{streak}}
cssclasses:
  - life-os
  - max
---

# Character

```life-os
view: character
```

*Derived from [[4 System/Game/XP Ledger]] on every sync. Safe to delete — it
will be rebuilt. Rules: [[4 System/Game/Gamification Design]].*
"""


def render_quest(today: date) -> str:
    """The Quest Log note.

    Deliberately thin: the numbers are rendered by the Uptick plugin from
    quest-cache.json, so the page matches the rest of the app. An earlier
    version wrote the whole dashboard as Markdown, which meant every progress
    bar was a fenced code block labelled "Plain text".
    """
    return f"""---
title: Quest Log
type: dashboard
automation: xp-sync
updated: {today.isoformat()}
cssclasses:
  - life-os
  - max
---

# Quest Log

```life-os
view: quest
```

*Rendered by the Uptick plugin. Level, XP and streak come from
[[4 System/Game/Character]]; the full event history is
[[4 System/Game/XP Ledger]].*
"""


def study_stats(cards: dict, states: dict, today: date) -> dict:
    """Deck counts for the Home study card, so the dashboard can show what is
    due without the plugin needing to open LearnKit's SQLite store itself."""
    end_of_day = datetime.combine(today, datetime.max.time()).timestamp() * 1000
    start_of_day = datetime.combine(today, datetime.min.time()).timestamp() * 1000
    total = due = overdue = new = mature = 0
    by_deck: dict[str, dict] = {}
    for cid, card in cards.items():
        if not isinstance(card, dict):
            continue
        total += 1
        groups = card.get("groups") or []
        deck = str(groups[0]) if groups else "Ungrouped"
        d = by_deck.setdefault(deck, {"deck": deck, "cards": 0, "due": 0, "new": 0})
        d["cards"] += 1
        st = states.get(cid) or {}
        stage = str(st.get("stage") or "new")
        when = st.get("due")
        if stage == "new":
            new += 1
            d["new"] += 1
        if float(st.get("stabilityDays") or 0) > 30:
            mature += 1
        if when is not None and float(when) <= end_of_day:
            due += 1
            d["due"] += 1
            if float(when) < start_of_day and stage != "new":
                overdue += 1
    return {"total": total, "due": due, "overdue": overdue, "new": new,
            "mature": mature, "reviewed": total - new,
            "decks": sorted(by_deck.values(), key=lambda d: -d["cards"])}


def quest_cache(certs: list[dict], tasks: list[Task], events: list[dict],
                today: date, bank: dict, character: dict,
                study: dict) -> dict:
    """Everything the Quest Log view draws, in one structured file."""
    open_tasks = [t for t in tasks if not t["done"]]
    overdue = []
    for t in open_tasks:
        due = parse_date(t["due"])
        if not due or due >= today or t["blocked"]:
            continue
        days = (today - due).days
        base = BASE_XP[t["difficulty"]]
        cost = min(base, math.ceil(base * DECAY_RATE) * max(0, days - DECAY_GRACE_DAYS))
        if cost <= 0:
            continue          # still inside the one day of grace
        overdue.append({"text": short(t["text"], 90), "difficulty": t["difficulty"],
                        "due": t["due"], "days": days, "cost": cost, "id": t["id"]})
    overdue.sort(key=lambda r: -r["cost"])

    week_start = (today - timedelta(days=today.weekday())).isoformat()
    month_start = today.replace(day=1).isoformat()
    by_kind: dict[str, int] = defaultdict(int)
    for e in events:
        by_kind[e["kind"]] += e["xp"]

    # A sparkline of the last 30 days of net XP, so the page shows a shape and
    # not just a number.
    trail = []
    for k in range(29, -1, -1):
        d = (today - timedelta(days=k)).isoformat()
        trail.append({"date": d,
                      "xp": sum(e["xp"] for e in events if e["date"] == d)})

    return {
        "updated": today.isoformat(),
        "character": character,
        "bank": bank,
        "sources": [{"kind": k, "label": l, "xp": by_kind.get(k, 0)} for k, l in (
            ("task", "Tasks"), ("study", "Study"), ("ritual", "Rituals"),
            ("milestone", "Milestones"), ("achievement", "Achievements"),
            ("decay", "Overdue decay"))],
        "totals": {
            "week": sum(e["xp"] for e in events if e["date"] >= week_start),
            "month": sum(e["xp"] for e in events if e["date"] >= month_start),
            "all": sum(e["xp"] for e in events),
        },
        "trail": trail,
        "ranks": [{"floor": f, "name": n} for f, n in sorted(RANKS)],
        "study": study,
        "certifications": [{
            "name": c["name"], "score": c["score"], "band": c["band"],
            "coverage": c["coverage"], "mastery": c["mastery"],
            "performance": c["performance"], "consistency": c["consistency"],
            "composite": c["composite"], "days_left": c["days_left"],
            "exam_date": c["exam_date"], "pass_mark": c["pass_mark"],
            "cards": c["cards"], "attempts": c["attempts"],
            "attempts_log": c.get("attempts_log") or [],
            "pass_mark": c["pass_mark"],
            "path": str(c["file"].relative_to(c["file"].parents[3]))
                    if len(c["file"].parents) > 3 else c["file"].name,
            "blockers": [{"reason": r, "ceiling": ceil,
                          "binding": (r, ceil) in c["binding"]}
                         for r, ceil in c["blockers"]],
            "domains": [{"name": d, "mastery": m}
                        for d, m in sorted(c["mastery_by_domain"].items(),
                                           key=lambda kv: kv[1])],
        } for c in certs],
        "tasks": {"open": len(open_tasks),
                  "blocked": sum(1 for t in open_tasks if t["blocked"]),
                  "overdue": len(overdue)},
        "bleeding": overdue[:12],
        "recent": [{"date": e["date"], "xp": e["xp"], "detail": e["detail"],
                    "slug": e["id"].replace("ach:", "")}
                   for e in events if e["kind"] == "achievement"][-10:],
    }


def achievement_conditions(paths: Paths) -> dict[str, str]:
    """slug -> condition text, read from the catalog note.

    The wording lives in the note so there is one place to edit it; the popup
    and the browser both read it from here rather than restating it in code.
    """
    if not paths.achievements.exists():
        return {}
    import achievements as A
    by_name = {name: slug for slug, name, _t, _c, _p in A.CATALOG}
    out = {}
    for line in paths.achievements.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) >= 4 and cells[1].startswith("**"):
            slug = by_name.get(cells[1].strip("*"))
            if slug:
                out[slug] = cells[3]
    return out


def update_achievements_note(paths: Paths, snapshot: list[dict]) -> str | None:
    """Add Progress and Unlocked columns to the catalog note."""
    if not paths.achievements.exists():
        return None
    by_name = {r["name"]: r for r in snapshot}

    out, in_table = [], False
    for line in paths.achievements.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("| # | Achievement | Tier | Condition |"):
            out.append("| # | Achievement | Tier | Condition | Progress | Unlocked |")
            in_table = True
            continue
        if in_table and set(stripped) <= set("|-: ") and stripped.startswith("|"):
            out.append("|---|---|---|---|---|---|")
            continue
        if in_table and stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if len(cells) >= 4:
                row = by_name.get(cells[1].strip("*"))
                if not row:
                    out.append(line)
                    continue
                if row["unlocked"]:
                    prog, mark = "██████", f"✅ {row['unlocked']}"
                elif row["manual"]:
                    prog, mark = "—", "manual"
                else:
                    filled = int(round(row["progress"] * 6))
                    prog = ("█" * filled + "░" * (6 - filled)
                            + f" {row['progress']:.0%}")
                    mark = "—"
                out.append("| " + " | ".join(cells[:4] + [prog, mark]) + " |")
                continue
        if in_table and not stripped.startswith("|"):
            in_table = False
        out.append(line)
    return "\n".join(out) + "\n"


def bank_detail(paths: Paths, bank: dict, events: list[dict],
                today: date) -> dict:
    """Goals and spend history, parsed out of the (hand-editable) bank note.

    The tables stay the source of truth — goals are something you types — so
    this reads them rather than owning them.
    """
    out = {**bank, "goals": [], "ledger": [], "spent": 0.0,
           "available": 0.0, "rate": BANK_RATE, "ceiling": MONTHLY_CEILING,
           "level_bonus": LEVEL_BONUS, "daily": 0.0}
    if not paths.bank.exists():
        return out
    text = paths.bank.read_text(encoding="utf-8")

    for row in table_rows(text, "Ledger"):
        if len(row) < 3 or not row[0]:
            continue
        m = re.search(r"(-?)\s*\$?([\d,.]+)", row[1] or "")
        if not m:
            continue
        amount = float(m.group(2).replace(",", "")) * (-1 if m.group(1) else 1)
        out["ledger"].append({"date": row[0], "change": amount, "reason": row[2]})
        if amount < 0:
            out["spent"] += -amount
    out["available"] = max(0.0, bank["total"] - out["spent"])

    cutoff = (today - timedelta(days=30)).isoformat()
    recent = defaultdict(int)
    for e in events:
        if e["date"] >= cutoff:
            recent[e["date"]] += e["xp"]
    active_days = sum(1 for v in recent.values() if v > 0)
    out["daily"] = ((sum(max(0, v) for v in recent.values()) / 30.0) / BANK_RATE
                    if active_days >= 7 else 0.0)
    out["active_days"] = active_days

    filled = out["available"]
    for row in table_rows(text, "Goals"):
        if len(row) < 7 or not row[1] or row[1].startswith("*"):
            continue
        price = re.search(r"([\d,.]+)", row[2] or "")
        if not price:
            continue
        target = float(price.group(1).replace(",", ""))
        if target <= 0:
            continue
        got = min(filled, target)
        filled -= got
        out["goals"].append({
            "n": row[0], "name": row[1], "price": target, "banked": round(got, 2),
            "progress": round(got / target, 4),
            "remaining": round(target - got, 2),
            "eta_days": (int(-(-(target - got) // max(out["daily"], 1e-9)))
                         if out["daily"] > 0.005 and got < target else None),
            "status": "Complete" if got >= target else ("Active" if got > 0 or filled <= 0 else "Queued"),
        })
    return out


def update_bank_note(paths: Paths, bank: dict, events: list[dict],
                     today: date) -> str | None:
    """Refresh the Balance block and goal progress; leave everything else alone.

    Goal rows are rewritten in place line by line. An earlier version rebuilt
    the row from `table_rows`, which strips cell padding, so the replacement
    never matched the padded original and the goals silently never filled.
    """
    if not paths.bank.exists():
        return None
    text = paths.bank.read_text(encoding="utf-8")

    spent = 0.0
    for row in table_rows(text, "Ledger"):
        if len(row) >= 2:
            m = re.search(r"-\s*\$?([\d,.]+)", row[1] or "")
            if m:
                spent += float(m.group(1).replace(",", ""))
    available = max(0.0, bank["total"] - spent)

    balance = (f"| | |\n|---|---|\n"
               f"| Lifetime earned | ${bank['total']:,.2f} |\n"
               f"| Spent | ${spent:,.2f} |\n"
               f"| **Available** | **${available:,.2f}** |\n"
               f"| This month | ${bank['this_month']:,.2f} of ${MONTHLY_CEILING:,.2f} |")
    out = re.sub(r"(## Balance\n\n)\|.*?\n\n", rf"\1{balance}\n\n", text, flags=re.S)

    # Dollars a day, from the last 30 days of actual banking, for the ETA.
    cutoff = (today - timedelta(days=30)).isoformat()
    recent = defaultdict(int)
    for e in events:
        if e["date"] >= cutoff:
            recent[e["date"]] += e["xp"]
    # An ETA off two days of data reads "~7470 days", which is arithmetically
    # true and worse than saying nothing. Wait for a week of history.
    active_days = sum(1 for v in recent.values() if v > 0)
    daily = ((sum(max(0, v) for v in recent.values()) / 30.0) / BANK_RATE
             if active_days >= 7 else 0.0)

    lines, in_goals, filled = out.split("\n"), False, available
    for i, line in enumerate(lines):
        if line.startswith("## "):
            in_goals = line.strip() == "## Goals"
            continue
        if not in_goals or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 7 or not cells[1] or set(cells[0]) <= set("-: "):
            continue
        price = re.search(r"([\d,.]+)", cells[2] or "")
        if not price:
            continue
        target = float(price.group(1).replace(",", ""))
        if target <= 0:
            continue
        got = min(filled, target)
        filled -= got
        pct = f"{got / target:.0%}"
        if got >= target:
            status, eta = "Complete", "now"
        else:
            status = "Active" if got > 0 or filled <= 0 else "Queued"
            eta = (f"~{math.ceil((target - got) / daily)} days" if daily > 0.005
                   else f"needs {7 - active_days}d more data" if active_days < 7 else "—")
        lines[i] = ("| " + " | ".join([cells[0], cells[1], f"${target:,.2f}",
                                       f"${got:,.2f}", pct, eta, status]) + " |")
    return "\n".join(lines)


def load_state(paths: Paths) -> dict:
    if paths.state.exists():
        try:
            return json.loads(paths.state.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"blocked_days": {}, "blocked_since": {}, "last_run": None,
            "start_date": None}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--today", help="override today's date, for testing")
    ap.add_argument("--audit", action="store_true",
                    help="check the catalog note and achievements.py agree")
    ap.add_argument("--start", help="first day that earns XP (default: first run)")
    args = ap.parse_args()

    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    import achievements as A

    paths = Paths(Path(args.vault))
    overrides = apply_config(load_config(Path(args.vault)))
    today = date.fromisoformat(args.today) if args.today else date.today()
    state = load_state(paths)

    # Decided 2026-08-22: start at zero, no retroactive credit. The start date
    # is fixed on the first run and then never moves, so the history that
    # predates the system cannot leak in later as a sudden windfall.
    if args.start:
        state["start_date"] = args.start
    if not state.get("start_date"):
        state["start_date"] = today.isoformat()
    start_date = state["start_date"]

    if args.audit:
        note = paths.achievements.read_text(encoding="utf-8") if paths.achievements.exists() else ""
        names_note = set(re.findall(r"^\|\s*\d+\s*\|\s*\*\*(.+?)\*\*", note, re.M))
        names_code = {n for _s, n, _t, _c, _p in A.CATALOG}
        print(json.dumps({
            "catalog_entries": len(A.CATALOG),
            "auto_evaluated": A.auto_count(),
            "in_note_only": sorted(names_note - names_code),
            "in_code_only": sorted(names_code - names_note),
        }, indent=2, ensure_ascii=False))
        return 0

    tasks = read_tasks(paths)
    facts = daily_facts(paths)
    weeklies = review_dates(paths.weekly)
    monthlies = review_dates(paths.monthly)
    lk_events, states, cards = read_learnkit(paths)
    certs = load_certifications(paths, states, cards, today)

    # The world as it already stood, captured once. Achievements measure the
    # delta from here, not the absolute count.
    if not state.get("baseline"):
        state["baseline"] = {
            "notes": countable_notes(paths.vault),
            "meetings": len(list(paths.meetings.rglob("*.md"))) if paths.meetings.exists() else 0,
            "cards": len(states),
        }
    baseline = state["baseline"]

    existing = read_ledger(paths)
    known = {e["id"] for e in existing}

    # Streak must be known before task XP, because it is a multiplier. It is
    # computed from the ledger as it stands, so today's completions are scored
    # against the streak you brought into the day rather than one they create.
    prior_days = sorted({e["date"] for e in existing if e["xp"] > 0})
    streak_by_day: dict[str, int] = {}
    run = 0
    prev: date | None = None
    for d in prior_days:
        cur = date.fromisoformat(d)
        run = run + 1 if prev and (cur - prev).days == 1 else 1
        streak_by_day[d] = run - 1
        prev = cur

    earn_by_day: dict[str, int] = defaultdict(int)
    for e in existing:
        if e["xp"] > 0:
            earn_by_day[e["date"]] += e["xp"]

    # Blocked days accumulate in state; a blocked task's clock is stopped.
    blocked_days = dict(state.get("blocked_days") or {})
    blocked_since = dict(state.get("blocked_since") or {})
    last_run = state.get("last_run")
    elapsed = (today - date.fromisoformat(last_run)).days if last_run else 0
    for t in tasks:
        if t["blocked"]:
            if t["id"] not in blocked_since:
                blocked_since[t["id"]] = today.isoformat()
            elif elapsed > 0:
                blocked_days[t["id"]] = blocked_days.get(t["id"], 0) + elapsed
        else:
            blocked_since.pop(t["id"], None)

    candidates: list[dict] = []
    candidates += task_completion_events(tasks, streak_by_day)
    candidates += ritual_events(facts, weeklies, monthlies)
    candidates += study_events(lk_events)
    candidates += cert_milestone_events(certs)
    for e in candidates:
        if e["xp"] > 0:
            earn_by_day[e["date"]] += e["xp"]
    decay_cursor = dict(state.get("decay_cursor") or {})
    candidates += decay_events(tasks, today, blocked_days, earn_by_day,
                               date.fromisoformat(start_date), decay_cursor)

    candidates = [e for e in candidates if e["date"] >= start_date]
    new_events = [e for e in candidates if e["id"] not in known]
    ledger = existing + sorted(new_events, key=lambda e: (e["date"], e["id"]))

    # Achievements are evaluated against the world including the new events, and
    # pay their own XP, so they are resolved in a second pass.
    unlocked_dates = {e["id"].split(":", 1)[1]: e["date"]
                      for e in ledger if e["kind"] == "achievement"}
    total_days = sorted({e["date"] for e in ledger if e["xp"] > 0})
    freezes_left = FREEZES_PER_MONTH
    streak, longest, freezes_used = compute_streak(total_days, today, freezes_left)

    earned: list[tuple[str, str, str, int]] = []
    for _ in range(8):
        stats = build_stats(tasks, ledger, facts, weeklies, monthlies, states,
                            lk_events, paths, today, streak, longest, freezes_used,
                            certs, set(unlocked_dates), start_date, baseline)
        round_earned = A.evaluate(stats, set(unlocked_dates))
        if not round_earned:
            break
        earned += round_earned
        wave = [{"date": today.isoformat(), "xp": xp, "kind": "achievement",
                 "detail": f"{name} ({tier})", "id": f"ach:{slug}"}
                for slug, name, tier, xp in round_earned]
        new_events += wave
        ledger += wave
        for slug, _n, _t, _x in round_earned:
            unlocked_dates[slug] = today.isoformat()

    total = sum(e["xp"] for e in ledger)
    # Level is derived from the current total, not a historical high-water
    # mark. Decay can therefore lower a level, but never below level 1.
    level = level_for(total)
    bank = bank_summary(ledger, level, today)
    recent_ach = [e for e in ledger if e["kind"] == "achievement"]

    # Goals are parsed from the bank note, so this must run before the cache is
    # written and before the note is rewritten underneath it.
    bank_full = bank_detail(paths, bank, ledger, today)

    writes = {}
    writes[paths.ledger] = write_ledger(paths, ledger)
    writes[paths.character] = (render_character(today)
                               .replace("{level}", str(level))
                               .replace("{total}", str(total))
                               .replace("{streak}", str(streak)))
    writes[paths.quest] = render_quest(today)
    floor = level_threshold(level)
    ceil_ = level_threshold(level + 1)
    writes[paths.quest_cache] = json.dumps(quest_cache(
        certs, tasks, ledger, today, bank_full,
        {"level": level, "total": total, "rank": rank_for(level), "streak": streak,
         "longest": longest, "into": total - floor, "need": ceil_ - floor,
         "streak_bonus": round(min(STREAK_CAP, 1 + STREAK_STEP * streak), 2),
         "freezes_left": FREEZES_PER_MONTH - freezes_used,
         "freezes_total": FREEZES_PER_MONTH,
         "achievements": len(unlocked_dates), "achievements_auto": A.auto_count(),
         "today": sum(e["xp"] for e in ledger if e["date"] == today.isoformat())},
        study_stats(cards, states, today),
    ), indent=1, ensure_ascii=False) + "\n"
    conditions = achievement_conditions(paths)
    snapshot = A.snapshot(stats, unlocked_dates, conditions)
    ach_note = update_achievements_note(paths, snapshot)
    if ach_note:
        writes[paths.achievements] = ach_note
    writes[paths.ach_cache] = json.dumps({
        "updated": today.isoformat(),
        "unlocked": sum(1 for r in snapshot if r["unlocked"]),
        "auto_total": A.auto_count(),
        "total": len(snapshot),
        "achievements": snapshot,
    }, indent=1, ensure_ascii=False) + "\n"
    bank_note = update_bank_note(paths, bank, ledger, today)
    if bank_note:
        writes[paths.bank] = bank_note

    changed = []
    if not args.dry_run:
        for path, content in writes.items():
            if atomic_write(path, content):
                changed.append(path.name)
        state.update({"blocked_days": blocked_days, "blocked_since": blocked_since,
                      "decay_cursor": decay_cursor, "last_run": today.isoformat()})
        atomic_write(paths.state, json.dumps(state, indent=2, sort_keys=True) + "\n")

    print(json.dumps({
        "mode": "dry-run" if args.dry_run else "write",
        "start_date": start_date,
        "config_overrides": overrides,
        "baseline": baseline,
        "total_xp": total, "level": level, "rank": rank_for(level),
        "streak": streak, "bank": bank["total"],
        "new_events": len(new_events),
        "new_by_kind": dict(Counter(e["kind"] for e in new_events)),
        "ledger_events": len(ledger),
        "achievements_unlocked": len(unlocked_dates),
        "achievements_new": [n for _s, n, _t, _x in earned][:12],
        "certifications": [{"name": c["name"], "readiness": c["score"], "band": c["band"]}
                           for c in certs],
        "changed": changed,
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
