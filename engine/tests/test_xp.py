#!/usr/bin/env python3
"""Integration test for xp-sync.py against a synthetic vault."""
import importlib.util, json, shutil, subprocess, sys, tempfile
from pathlib import Path

# The engine sits one level up from the tests, in either layout.
AUTO = next(p for p in (Path(__file__).resolve().parent.parent,
                        Path(__file__).resolve().parent.parent.parent / "4 System/Automation")
            if (p / "xp-sync.py").exists())
ENGINE_SPEC = importlib.util.spec_from_file_location("uptick_xp", AUTO / "xp-sync.py")
ENGINE = importlib.util.module_from_spec(ENGINE_SPEC)
assert ENGINE_SPEC.loader is not None
ENGINE_SPEC.loader.exec_module(ENGINE)
fails = []

def check(label, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"   {extra}" if not cond and extra else ""))
    if not cond: fails.append(label)

def make_vault(root: Path):
    for d in ["2 Work/Tasks", "1 Capture/Daily", "1 Capture/Weekly", "1 Capture/Monthly",
              "2 Work/Meetings", "4 System/Game/Certifications", "4 System/Automation"]:
        (root / d).mkdir(parents=True, exist_ok=True)
    for f in ["xp-sync.py", "achievements.py", "exam-readiness.py"]:
        shutil.copy(AUTO / f, root / "4 System/Automation" / f)
    (root / "4 System/Game/Gamification Design.md").write_text("# design\n", encoding="utf-8")

def tasks(rows):
    out = ["---\ncreated: 2026-01-01\n---\n\n# Task Inbox\n"]
    for r in rows: out.append(r)
    return "\n".join(out) + "\n"

def run(root, today, extra=None):
    cmd = [sys.executable, str(root / "4 System/Automation/xp-sync.py"),
           "--vault", str(root), "--today", today] + (extra or [])
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout, p.stderr); raise SystemExit(f"xp-sync failed on {today}")
    return json.loads(p.stdout)

root = Path(tempfile.mkdtemp(prefix="xpvault-"))
make_vault(root)
inbox = root / "2 Work/Tasks/Task Inbox.md"

print("Day 1 — start at zero")
inbox.write_text(tasks([
    "- [ ] Ship the thing 📅 2026-03-10 [priority:: 3] [difficulty:: 3] #task ^task-aaa",
    "- [ ] Old forgotten job 📅 2026-01-01 [priority:: 5] [difficulty:: 2] #task ^task-bbb",
    "- [ ] Waiting on vendor 📅 2026-01-05 [priority:: 4] [difficulty:: 4] #task #blocked ^task-ccc",
    "- [ ] Waiting on approval 📅 2026-01-05 [priority:: 4] [difficulty:: 4] #task #dependency ^task-ddd",
]), encoding="utf-8")
r1 = run(root, "2026-03-01")
check("starts at zero XP", r1["total_xp"] == 0, str(r1["total_xp"]))
check("starts at level 1", r1["level"] == 1)
check("no retroactive decay for a task 60 days overdue", r1["new_by_kind"].get("decay", 0) == 0)

print("\nDay 3 — decay begins and escalates")
r3 = run(root, "2026-03-03")
r4 = run(root, "2026-03-04")
r5d = run(root, "2026-03-05")

def decay_rows(root):
    led = (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8")
    return [l for l in led.splitlines() if "| decay |" in l]

rows = decay_rows(root)
check("overdue task is charged decay", len(rows) >= 2, f"{len(rows)} rows")
amounts = [int(r.split("|")[2].strip()) for r in rows]
check("every decay charge is negative", all(a < 0 for a in amounts), str(amounts))
check("decay escalates day over day", amounts[-1] < amounts[0], str(amounts))

led = (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8")
check("blocked task absent from ledger", "Waiting on vendor" not in led)
check("dependency task absent from ledger", "Waiting on approval" not in led)
check("overdue task present in ledger", "Old forgotten job" in led)

print("\nIdempotency")
before = led
r4b = run(root, "2026-03-04")
check("re-running the same day adds nothing", r4b["new_events"] == 0, str(r4b["new_events"]))
check("ledger byte-identical on re-run",
      (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8") == before)

print("\nCompletion pays, timing scales")
inbox.write_text(tasks([
    "- [x] Ship the thing 📅 2026-03-10 [priority:: 3] [difficulty:: 3] #task ✅ 2026-03-05 ^task-aaa",
    "- [ ] Old forgotten job 📅 2026-01-01 [priority:: 5] [difficulty:: 2] #task ^task-bbb",
    "- [ ] Waiting on vendor 📅 2026-01-05 [priority:: 4] [difficulty:: 4] #task #blocked ^task-ccc",
]), encoding="utf-8")
r5 = run(root, "2026-03-05")
led = (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8")
early = [l for l in led.splitlines() if "Ship the thing" in l]
check("completing a task pays XP (D3 x1.25 early = 63)",
      bool(early) and "| +63 |" in early[0], early[0] if early else "no row")
check("early completion is labelled", "early" in (early[0] if early else ""))

print("\nLevels follow current XP")
peak = r5["level"]
inbox.write_text(tasks([
    "- [x] Ship the thing 📅 2026-03-10 [priority:: 3] [difficulty:: 3] #task ✅ 2026-03-05 ^task-aaa",
    "- [ ] Old forgotten job 📅 2026-01-01 [priority:: 5] [difficulty:: 2] #task ^task-bbb",
] + [f"- [ ] Rotting task {i} 📅 2026-02-01 [priority:: 8] [difficulty:: 5] #task ^task-r{i}"
     for i in range(12)]), encoding="utf-8")
last = None
for day in ["2026-03-06", "2026-03-08", "2026-03-12", "2026-03-20", "2026-04-05"]:
    last = run(root, day)
check("heavy neglect drives XP down", last["total_xp"] < r5["total_xp"], str(last["total_xp"]))
check("the configured threshold reaches its level",
      ENGINE.level_for(ENGINE.level_threshold(3)) == 3)
check("dropping below a threshold loses that level",
      ENGINE.level_for(ENGINE.level_threshold(3) - 1) == 2)
check("derived level follows decayed XP rather than a historical peak",
      last["level"] == ENGINE.level_for(last["total_xp"]),
      f"peak={peak} total={last['total_xp']} level={last['level']}")

print("\nGlobal decay cap")
led = (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8")
check("decay is capped, not unbounded", "(capped)" in led)

print("\nBank never goes negative")
check("bank floors at zero", last["bank"] >= 0, str(last["bank"]))

print("\nUnblocking does not create instant debt")
# The real path: the task stays in the inbox, blocked, while the engine runs
# daily. Its clock is stopped, so unblocking starts one day's charge, not one
# per day it spent waiting.
root2 = Path(tempfile.mkdtemp(prefix="xpvault2-"))
make_vault(root2)
inbox2 = root2 / "2 Work/Tasks/Task Inbox.md"
blocked_line = "- [ ] Waiting on vendor 📅 2026-01-05 [priority:: 4] [difficulty:: 4] #task #blocked ^task-ccc"
inbox2.write_text(tasks([blocked_line]), encoding="utf-8")
for day in ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
            "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]:
    run(root2, day)
led2 = (root2 / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8")
check("a blocked task never accrues decay while blocked",
      "Waiting on vendor" not in led2)

inbox2.write_text(tasks([blocked_line.replace(" #blocked", "")]), encoding="utf-8")
run(root2, "2026-03-11")
rows = [l for l in (root2 / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8").splitlines()
        if "Waiting on vendor" in l]
check("unblocking charges at most one day, not the whole wait",
      len(rows) <= 1, f"{len(rows)} rows")
run(root2, "2026-03-12")
rows2 = [l for l in (root2 / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8").splitlines()
         if "Waiting on vendor" in l]
check("an unblocked task then decays one day at a time",
      len(rows2) - len(rows) <= 1, f"{len(rows)} -> {len(rows2)}")

print("\nA long sync outage is forgiven, not billed")
inbox3 = root / "2 Work/Tasks/Task Inbox.md"
inbox3.write_text(tasks([
    "- [ ] Neglected 📅 2026-01-01 [priority:: 5] [difficulty:: 3] #task ^task-neg"]),
    encoding="utf-8")
run(root, "2026-04-07")
before_rows = len([l for l in (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8").splitlines()
                   if "Neglected" in l])
run(root, "2026-09-01")   # engine off for five months
after_rows = len([l for l in (root / "4 System/Game/XP Ledger.md").read_text(encoding="utf-8").splitlines()
                  if "Neglected" in l])
check("a five-month outage charges at most the catch-up window",
      after_rows - before_rows <= 7, f"{after_rows - before_rows} days charged")
shutil.rmtree(root2, ignore_errors=True)

print(f"\n{'ALL CHECKS PASSED' if not fails else str(len(fails)) + ' FAILED'}")
shutil.rmtree(root, ignore_errors=True)
sys.exit(1 if fails else 0)
