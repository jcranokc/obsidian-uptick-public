#!/usr/bin/env python3
"""Regression checks for the public/private Uptick distribution boundary."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OPTIONAL = ROOT / "optional"
FAILURES: list[str] = []


def check(label: str, condition: bool) -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        FAILURES.append(label)


def run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True, check=False)


ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
for private_file in (".uptick-private.env", ".uptick-series-rules.json", ".uptick-release-audit-terms"):
    check(f"{private_file} is ignored", private_file in ignore)

calendar = (OPTIONAL / "calendar-push.py").read_text(encoding="utf-8")
audit = (OPTIONAL / "task-audit.py").read_text(encoding="utf-8")
series = (OPTIONAL / "calendar-series-import.py").read_text(encoding="utf-8")
priority = (ROOT / "engine/priority-task-sync.py").read_text(encoding="utf-8")
wrapper = (OPTIONAL / "task-audit.sh").read_text(encoding="utf-8")
private_config = (OPTIONAL / "uptick_private_config.py").read_text(encoding="utf-8")

for key in ("UPTICK_CALENDAR_ID", "UPTICK_REMINDER_LIST_ID", "UPTICK_OWNER_PATTERN", "UPTICK_ASSIGNEE_MARKERS", "UPTICK_SERIES_RULES_FILE"):
    check(f"public helpers use {key}", key in (calendar + audit + series + priority + private_config))

hardcoded_target = re.compile(
    r"^\s*(?:TARGET_CALENDAR_ID|REMINDER_LIST|CALENDAR_TARGET)\s*=\s*['\"][0-9A-Fa-f-]{36}['\"]",
    re.M,
)
check("no integration target has a UUID default", not hardcoded_target.search(calendar + "\n" + audit))
check("calendar target fails closed", "Set UPTICK_CALENDAR_ID" in calendar)
check("task audit skips unconfigured Reminder writes", "if REMINDER_LIST and c[\"due\"]" in audit)
check("task-audit wrapper invokes the shipped helper", '"$ROOT/task-audit.py"' in wrapper)
check("task-audit wrapper uses generic lock naming", ".uptick-task-audit.lock" in wrapper)
check("series rules are private configuration", "load_series_rules(VAULT)" in series)

with tempfile.TemporaryDirectory() as tmp:
    vault = Path(tmp)
    note = vault / "2 Work/Meetings/example.md"
    note.parent.mkdir(parents=True)
    note.write_text("---\ntype: meeting\nmeeting_date: 2026-09-01\ntime: '09:00'\n---\n# Example\n", encoding="utf-8")
    env = {**os.environ, "VAULT": str(vault)}
    proc = run([sys.executable, str(OPTIONAL / "calendar-push.py"), "--note", "2 Work/Meetings/example.md"], env)
    payload = json.loads(proc.stdout)
    check("calendar push blocks without a private target", proc.returncode == 3 and "UPTICK_CALENDAR_ID" in payload.get("blocked", ""))

    rules = vault / "4 System/Automation/.uptick-series-rules.json"
    rules.parent.mkdir(parents=True, exist_ok=True)
    rules.write_text(json.dumps({"merge": [{"pattern": "daily check-in", "title": "Daily Check-in"}], "skipTitles": ["^vacation$"]}), encoding="utf-8")
    config = rules.with_name(".uptick-private.env")
    config.write_text("UPTICK_SERIES_RULES_FILE=4 System/Automation/.uptick-series-rules.json\n", encoding="utf-8")
    env["PYTHONPATH"] = str(OPTIONAL)
    proc = run([sys.executable, "-c", "import os; from uptick_private_config import load_private_env, load_series_rules; from pathlib import Path; vault=Path(os.environ['VAULT']); load_private_env(vault); assert len(load_series_rules(vault)[0]) == 1"], env)
    check("private series rules load without public defaults", proc.returncode == 0)

with tempfile.TemporaryDirectory() as tmp:
    vault = Path(tmp)
    env = {**os.environ, "PYTHONPATH": str(OPTIONAL)}
    proc = run([sys.executable, str(OPTIONAL / "task-audit.py"), "--vault", str(vault), "--dry-run"], env)
    today_review = vault / "1 Capture/Daily"
    check("task-audit dry run leaves no review or state files", proc.returncode == 0 and not today_review.exists() and not (vault / "4 System/Automation").exists())

manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
versions = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))
check("manifest is the public 0.7.0 release", manifest["version"] == "0.7.0" and "0.7.0" in versions)

print(f"\n{len(FAILURES)} failure(s)" if FAILURES else "\nALL CHECKS PASSED")
raise SystemExit(bool(FAILURES))
