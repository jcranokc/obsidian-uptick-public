#!/usr/bin/env python3
"""Dump the Python XP engine's output for a fixed set of inputs, as JSON.

This is the oracle half of the port's parity test. parity_test.js feeds the
same inputs to engine/uptick-engine.js and asserts the two agree exactly. It
exists because a port is only worth having if you can prove it did not change
any answers -- and XP is the kind of thing where a one-point drift on a
rounding boundary would go unnoticed for months.

Reads nothing and writes nothing outside stdout.
"""

import importlib.util
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# xp-sync does `from achievements import Stats` at call time, so the engine
# directory has to be importable.
sys.path.insert(0, str(ROOT / "engine"))
xp = load("xp_sync", ROOT / "engine/xp-sync.py")
ach = load("achievements", ROOT / "engine/achievements.py")

# Task lines chosen to exercise every branch: each difficulty, early/on-time/
# late, the priority bonus band and just outside it, blocked, no due date,
# markdown and tags that `short()` has to strip, and a very long title.
TASK_LINES = [
    "- [x] Ship the thing 📅 2026-03-10 ✅ 2026-03-08 [priority:: 3] [difficulty:: 3] #task ^task-a1",
    "- [x] Late and cheap 📅 2026-03-01 ✅ 2026-03-09 [priority:: 5] [difficulty:: 1] #task ^task-a2",
    "- [x] On the day 📅 2026-03-09 ✅ 2026-03-09 [priority:: 1] [difficulty:: 5] #task ^task-a3",
    "- [x] No due date at all ✅ 2026-03-09 [priority:: 2] [difficulty:: 4] #task ^task-a4",
    "- [x] Priority just outside the bonus 📅 2026-03-09 ✅ 2026-03-09 [priority:: 3] [difficulty:: 2] #task ^task-a5",
    "- [x] [[A Note|aliased link]] and **bold** ⏫ 📅 2026-03-09 ✅ 2026-03-09 [priority:: 1] [difficulty:: 2] #task #done ^task-a6",
    "- [x] " + ("verbose " * 40) + "📅 2026-03-09 ✅ 2026-03-09 [priority:: 4] [difficulty:: 3] #task ^task-a7",
    "- [ ] Overdue and open 📅 2026-03-01 [priority:: 2] [difficulty:: 3] #task ^task-b1",
    "- [ ] Overdue and blocked 📅 2026-02-01 [priority:: 1] [difficulty:: 5] #task #blocked ^task-b2",
    "- [ ] Overdue, no id, defaults apply 📅 2026-03-05 #task",
    "- [ ] Open with no due date [difficulty:: 4] #task ^task-b4",
    "- [ ] Ancient 📅 2025-01-01 [priority:: 1] [difficulty:: 5] #task ^task-b5",
    "- [ ] Exactly one day overdue after a blocked day 📅 2026-03-08 [priority:: 2] [difficulty:: 3] #task ^task-b6",
]

INBOX = "---\ncreated: 2026-01-01\n---\n\n# Task Inbox\n\n" + "\n".join(TASK_LINES) + "\n"

LEDGER = """| Date | XP | Kind | Detail | Event id |
| --- | --- | --- | --- | --- |
| 2026-03-01 | +50 | task | D3 Standard · on time · Something | `task:task-z1` |
| 2026-03-02 | -12 | decay | 3d overdue · D3 · Something else | `decay:task-z2:2026-03-02` |
| 2026-03-03 | +75 | weekly | Week reviewed | `weekly:2026-W10` |
| 2026-03-03 | +3 | study | 1 card | `study:2026-03-03:cards` |
"""


def tasks_from(text):
    """read_tasks takes a Paths object; give it one that points at a temp file."""
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / "2 Work/Tasks").mkdir(parents=True)
    (d / "2 Work/Tasks/Task Inbox.md").write_text(text, encoding="utf-8")
    return xp.read_tasks(xp.Paths(d))


def jsonable(t):
    out = {k: v for k, v in t.items() if k != "tags"}
    out["tags"] = sorted(t["tags"])
    return out


# Daily notes chosen to hit every ritual branch: an early work log and a late
# one, the work-log cap, a complete end-of-day pair and a half-finished one,
# a day with headings but no bullets, and Focus as an alias for Priorities.
DAILY_NOTES = {
    "2026-03-01": ("## Priorities\n- ship it\n- review the thing\n\n"
                   "## Work Log\n- `9:15 AM` started early\n- `2:00 PM` later\n\n"
                   "## Completed\n- ship it\n\n## Notes for Tomorrow\n- follow up\n"),
    "2026-03-02": ("## Focus\n- one thing\n\n"
                   "## Work Log\n- `10:00 AM` exactly ten\n"),
    "2026-03-03": ("## Priorities\n- a\n\n## Work Log\n"
                   + "".join(f"- `{h}:00 PM` entry {h}\n" for h in range(1, 8))),
    "2026-03-04": "## Completed\n- done\n\n## Notes for Tomorrow\n",
    "2026-03-05": "## Priorities\n\n## Work Log\n\n",
    "2026-03-06": ("## Work Log\n- `12:30 AM` after midnight\n- no timestamp here\n"),
    "not-a-date": "## Priorities\n- ignored\n",
}

WEEKLY_NOTES = {
    "2026-W10": "---\ndate: 2026-03-02\n---\n\n## Review\n- went well\n",
    "2026-W11 - 2026-03-09": "## Review\n- also fine\n",
    "2026-W12 - 2026-03-16": "## Review\n\nnothing here, no bullets\n",
    "2026-W13 - 2026-03-23": "```life-os\nview: weekly\n- not a real bullet\n```\n",
}

MONTHLY_NOTES = {"2026-03": "---\ndate: 2026-03-31\n---\n\n- month done\n"}

# Study analytics covering both XP paths, the daily cap, practice halving,
# duplicate sessions, and each exam band including the .5 rounding boundary.
STUDY = (
    [{"kind": "review", "at": 1772000000000, "eventId": 1, "result": "easy"},
     {"kind": "review", "at": 1772000001000, "eventId": 2, "result": "again"},
     {"kind": "review", "at": 1772000002000, "eventId": 3, "result": "hard",
      "mode": "practice"},
     {"kind": "review", "at": 1772000003000, "eventId": 4, "result": "again",
      "mode": "practice"},
     {"kind": "review", "at": 1772000004000, "eventId": 5, "result": "unknown-grade"},
     {"kind": "note-review", "at": 1772000005000, "eventId": 6},
     {"kind": "session", "at": 1772000006000, "eventId": 7, "scope": "deck"},
     {"kind": "session", "at": 1772000007000, "eventId": 8, "scope": "deck"},
     {"kind": "session", "at": 1772000008000, "eventId": 9, "scope": "all"},
     {"kind": "exam-attempt", "at": 1772000009000, "eventId": 10,
      "finalPercent": 82.5, "mcqCount": 60, "saqCount": 0},
     {"kind": "exam-attempt", "at": 1772000010000, "eventId": 11,
      "finalPercent": 100, "mcqCount": 60, "saqCount": 0},
     {"kind": "exam-attempt", "at": 1772000011000, "eventId": 12,
      "finalPercent": 55.5, "mcqCount": 20, "saqCount": 0},
     {"kind": "exam-attempt", "at": 1772000012000, "eventId": 13,
      "finalPercent": 40, "mcqCount": 10, "saqCount": 0},
     {"kind": "unknown-kind", "at": 1772000013000, "eventId": 14},
     {"kind": "review", "at": 0, "eventId": 15, "result": "easy"}]
    # 200 reviews on one day, to run past CARD_XP_DAILY_CAP
    + [{"kind": "review", "at": 1772100000000 + i, "eventId": 100 + i, "result": "easy"}
       for i in range(200)]
)

# Banking cases: an ordinary month, one that runs into the ceiling, a month
# of net-negative days, and a level run that accrues the bonus.
BANK_CASES = [
    ([], 1),
    ([{"date": "2026-03-01", "xp": 500, "kind": "task", "detail": "", "id": "a"}], 1),
    ([{"date": "2026-03-%02d" % d, "xp": 4000, "kind": "task", "detail": "", "id": str(d)}
      for d in range(1, 15)], 1),
    ([{"date": "2026-03-01", "xp": 100, "kind": "task", "detail": "", "id": "a"},
      {"date": "2026-03-01", "xp": -300, "kind": "decay", "detail": "", "id": "b"},
      {"date": "2026-03-02", "xp": 250, "kind": "task", "detail": "", "id": "c"}], 1),
    ([{"date": "2026-03-01", "xp": 1, "kind": "task", "detail": "", "id": "a"}], 6),
    ([{"date": "2026-02-28", "xp": 9000, "kind": "task", "detail": "", "id": "a"},
      {"date": "2026-03-01", "xp": 9000, "kind": "task", "detail": "", "id": "b"}], 1),
]

STREAKS = [
    ([], "2026-03-10", 0),
    (["2026-03-10"], "2026-03-10", 0),
    (["2026-03-08", "2026-03-09", "2026-03-10"], "2026-03-10", 0),
    (["2026-03-08", "2026-03-09"], "2026-03-10", 0),          # not earned today yet
    (["2026-03-06", "2026-03-08", "2026-03-09"], "2026-03-09", 1),   # one freeze
    (["2026-03-06", "2026-03-08", "2026-03-09"], "2026-03-09", 0),   # none
    (["2026-03-01", "2026-03-05", "2026-03-10"], "2026-03-10", 2),
    (["2026-03-09", "2026-03-09", "2026-03-10"], "2026-03-10", 0),   # duplicates
    (["2026-01-01", "2026-01-02", "2026-03-09", "2026-03-10"], "2026-03-10", 0),
]


def main():
    tasks = tasks_from(INBOX)
    today = date(2026, 3, 10)
    start = date(2026, 3, 4)

    streak_on = {"2026-03-08": 0, "2026-03-09": 6, "2026-03-10": 15}
    earn_by_day = {"2026-03-0%d" % k: 40 * k for k in range(3, 10)}

    # A cursor that has already seen most tasks, so decay actually fires rather
    # than every task being a first sighting.
    cursor = {t["id"]: "2026-03-07" for t in tasks}
    cursor.pop("task-b5", None)          # leave one unseen, to test first-sighting
    blocked_days = {"task-b1": 2, "task-b6": 1}

    out = {
        # The fixture travels with the answers, so the JS side cannot drift
        # from it by reconstructing the inputs itself.
        "_fixture": {"task_lines": TASK_LINES, "inbox": INBOX, "ledger": LEDGER,
                     "streak_on": streak_on, "earn_by_day": earn_by_day,
                     "blocked_days": blocked_days, "cursor": cursor,
                     "today": today.isoformat(), "start": start.isoformat(),
                     "cap_inbox": CAP_INBOX, "cap_earn": CAP_EARN,
                     "daily_notes": DAILY_NOTES, "weekly_notes": WEEKLY_NOTES,
                     "monthly_notes": MONTHLY_NOTES, "study": STUDY,
                     "streaks": STREAKS, "bank_cases": BANK_CASES,
                     "stats_states": STATS_STATES, "stats_meetings": STATS_MEETINGS,
                     "stats_readiness": STATS_READINESS, "stats_manual": STATS_MANUAL,
                     "stats_baseline": STATS_BASELINE, "stats_start": STATS_START,
                     "stats_note_count": 3,
                     "ach_cases": ACH_CASES, "snap_cases": SNAP_CASES},
        "level_threshold": [xp.level_threshold(n) for n in range(1, 30)],
        "level_for": [xp.level_for(v) for v in
                      [0, 1, 99, 100, 199, 200, 599, 600, 1180, 1500, 25000, 500000]],
        "rank_for": [xp.rank_for(n) for n in [1, 9, 10, 19, 20, 29, 30, 39, 40, 49,
                                              50, 59, 60, 74, 75, 99, 100, 140]],
        "short": [xp.short(line) for line in TASK_LINES],
        "read_tasks": [jsonable(t) for t in tasks],
        "read_ledger": xp.read_ledger(_ledger_paths(LEDGER)),
        "completion_events": xp.task_completion_events(tasks, streak_on),
        "decay_events": xp.decay_events(tasks, today, blocked_days, earn_by_day,
                                        start, dict(cursor)),
        "cursor_after_decay": _cursor_after(tasks, today, blocked_days,
                                            earn_by_day, start, cursor),
        "cell": [xp.cell(s) for s in ["plain", "has | pipe", "has\nnewline", "  padded  "]],
        "section_items": {h: xp.section_items(DAILY_NOTES["2026-03-01"], h)
                          for h in ["Priorities", "Work Log", "Completed",
                                    "Notes for Tomorrow", "Missing", "priorities"]},
        "daily_facts": _daily_facts(),
        "weekly_dates": sorted(_review_dates(WEEKLY_NOTES)),
        "monthly_dates": sorted(_review_dates(MONTHLY_NOTES)),
        "ritual_events": xp.ritual_events(_daily_facts(),
                                          _review_dates(WEEKLY_NOTES),
                                          _review_dates(MONTHLY_NOTES)),
        "study_events": xp.study_events(STUDY),
        "streaks": [list(xp.compute_streak(d, date.fromisoformat(t), f))
                    for d, t, f in STREAKS],
        "longest_run": [xp.longest_run(d) for d, _, _ in STREAKS],
        "iso_year_week": [list(date.fromisoformat(d).isocalendar()[:2]) for d in
                          ["2026-01-01", "2025-12-29", "2026-12-31", "2027-01-03",
                           "2026-03-09", "2024-12-30", "2021-01-01"]],
        "bank": [xp.bank_summary(e, n) for e, n in BANK_CASES],
        "stats": _stats(),
        "catalog": [[slug, name, tier, cat,
                     None if pred is None else
                     ({"f": True} if isinstance(pred, ach.F) else {"t": pred.target})]
                    for slug, name, tier, cat, pred in ach.CATALOG],
        "evaluate": [[list(r) for r in ach.evaluate(_stats_from(v), set(already))]
                     for v, already in ACH_CASES],
        "snapshot": [ach.snapshot(_stats_from(v), unlocked, {"first-blood": "Complete your first task"})
                     for v, unlocked in SNAP_CASES],
        "stats_defaults": {k: (sorted(v) if isinstance(v, set) else v)
                           for k, v in vars(ach.Stats()).items()
                           if not k.startswith("_")},
        "decay_events_capped": _capped(),
    }
    json.dump(out, sys.stdout, ensure_ascii=False, sort_keys=True)


# 1246 / 7 * 0.25 == 44.5 exactly: truncating gives a cap of 44, rounding 45.
CAP_EARN = {"2026-03-09": 400, "2026-03-08": 300, "2026-03-07": 200,
            "2026-03-06": 150, "2026-03-05": 100, "2026-03-04": 60,
            "2026-03-03": 36}

CAP_LINES = [
    f"- [ ] Overdue heavy {i} 📅 2026-02-20 [priority:: 1] [difficulty:: 5] #task ^task-c{i}"
    for i in range(6)
]
CAP_INBOX = "---\ncreated: 2026-01-01\n---\n\n# Task Inbox\n\n" + "\n".join(CAP_LINES) + "\n"


def _capped():
    """Decay large enough that the global cap binds and has to scale it down."""
    ts = tasks_from(CAP_INBOX)
    cursor = {t["id"]: "2026-03-09" for t in ts}
    return xp.decay_events(ts, date(2026, 3, 10), {}, CAP_EARN,
                           date(2026, 3, 4), cursor)


STATS_STATES = {"c1": {"stabilityDays": 40}, "c2": {"stabilityDays": 3}}
STATS_MEETINGS = {"One.md": "## Agenda\n- talk about it\n",
                  "Two.md": "no agenda here\n"}
STATS_READINESS = [
    {"score": 71.0, "no_weak_domain": True, "coverage": 1.0, "no_retakes": False,
     "passed": False, "first_try": False, "real_attempts": 0},
    {"score": 93.5, "no_weak_domain": False, "coverage": 0.5, "no_retakes": True,
     "passed": True, "first_try": True, "real_attempts": 2},
]
STATS_MANUAL = ["centurion", "first-blood"]
STATS_BASELINE = {"notes": 1, "meetings": 1, "cards": 0}
STATS_START = "2026-03-01"


# Stats states chosen to sit on thresholds: nothing done, exactly on a
# boundary, one short of it, and far past every target.
ACH_CASES = [
    ({}, []),
    ({"tasks_done": 1}, []),
    ({"tasks_done": 1}, ["first-blood"]),
    ({"tasks_done": 99}, []),
    ({"tasks_done": 100}, []),
    ({"tasks_done": 100000, "max_tasks_day": 999, "epics_done": 999,
      "hard_plus_done": 999, "zero_overdue_now": True, "streak": 999,
      "by_difficulty": {4: 50, 5: 50}, "best_exam_pct": 100.0,
      "max_readiness": 100.0, "all_difficulties_one_day": True}, []),
    ({"by_difficulty": {5: 1}}, []),
    ({"best_exam_pct": 99.5, "max_readiness": 89.999}, []),
]

SNAP_CASES = [
    ({}, {}),
    ({"tasks_done": 37, "by_difficulty": {4: 3, 5: 1}, "streak": 6,
      "max_readiness": 71.5}, {"first-blood": "2026-03-01"}),
]


def _stats_from(values):
    s = ach.Stats()
    for k, v in values.items():
        setattr(s, k, v)
    return s


def _stats():
    """build_stats over the shared fixture, with the pieces it needs."""
    tasks = tasks_from(INBOX)
    facts = _daily_facts()
    weeklies, monthlies = _review_dates(WEEKLY_NOTES), _review_dates(MONTHLY_NOTES)
    events = (xp.task_completion_events(tasks, {})
              + xp.ritual_events(facts, weeklies, monthlies)
              + xp.study_events(STUDY))
    d = _write(STATS_MEETINGS, "2 Work/Meetings")
    (d / "4 System/Game").mkdir(parents=True)
    (d / "4 System/Game/Gamification Design.md").write_text("# design\n", encoding="utf-8")
    (d / "Note.md").write_text("a note\n", encoding="utf-8")
    paths = xp.Paths(d)
    s = xp.build_stats(tasks, events, facts, weeklies, monthlies, STATS_STATES,
                       STUDY, paths, date(2026, 3, 10), 4, 9, 1,
                       STATS_READINESS, set(STATS_MANUAL),
                       STATS_START, STATS_BASELINE)
    out = {k: v for k, v in vars(s).items() if not k.startswith("_")}
    for k, v in list(out.items()):
        if isinstance(v, set):
            out[k] = sorted(v)
    return out


def _write(notes, sub):
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / sub).mkdir(parents=True)
    for stem, text in notes.items():
        (d / sub / f"{stem}.md").write_text(text, encoding="utf-8")
    return d


def _daily_facts():
    return xp.daily_facts(xp.Paths(_write(DAILY_NOTES, "1 Capture/Daily")))


def _review_dates(notes):
    d = _write(notes, "reviews")
    return xp.review_dates(d / "reviews")


def _ledger_paths(text):
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / "4 System/Game").mkdir(parents=True)
    (d / "4 System/Game/XP Ledger.md").write_text(text, encoding="utf-8")
    return xp.Paths(d)


def _cursor_after(tasks, today, blocked_days, earn_by_day, start, cursor):
    c = dict(cursor)
    xp.decay_events(tasks, today, blocked_days, earn_by_day, start, c)
    return c


if __name__ == "__main__":
    main()
