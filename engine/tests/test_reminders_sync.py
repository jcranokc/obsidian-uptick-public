#!/usr/bin/env python3
"""Pure projection tests for the optional Apple Reminders bridge."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("reminders_sync", ROOT / "optional/reminders-sync.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

cfg = mod.merge(mod.DEFAULT_CONFIG, {
    "inboxList": "Inbox", "waitingList": "Waiting",
    "routes": [
        {"tag": "#work", "list": "Work", "listId": ""},
        {"tag": "#personal", "list": "Personal", "listId": ""},
        {"tag": "#house", "list": "House", "listId": ""},
    ],
})
fails = []
checks = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global checks
    checks += 1
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{'  ' + detail if not condition and detail else ''}")
    if not condition:
        fails.append(label)


check("clean title removes tags and generated metadata",
      mod.clean_title("⏫ Review release #work 📅 2026-08-29") == "Review release")
check("work route", mod.route_for(["#work"], cfg)["name"] == "Work")
check("blocked route", mod.route_for(["#blocked"], cfg)["name"] == "Waiting")
check("dependency route", mod.route_for(["#blocked", "#dependency"], cfg)["status"] == "#dependency")
check("waiting projection carries follow-up tag",
      "#follow-up" in mod.projection_from_task({"raw": "Wait #blocked", "text": "Wait", "due": "2026-09-01", "followUpDate": "2026-09-08", "difficulty": 3}, cfg)["tags"])
check("unknown route goes to inbox", mod.route_for(["#unknown"], cfg)["name"] == "Inbox")
check("unknown route is triaged", mod.route_for(["#unknown"], cfg)["status"] == "#needs-triage")
check("task fallback includes triage tag",
      "#needs-triage" in mod.projection_from_task({"text": "Unknown task", "difficulty": 3}, cfg)["tags"])
check("high-confidence work cue routes task",
      mod.projection_from_task({"raw": "Review Salesforce release", "text": "Review Salesforce release", "difficulty": 3}, cfg)["list"] == "Work")
check("work inference replaces the triage fallback with a canonical category tag",
      (lambda tags: "#work" in tags and "#needs-triage" not in tags)(
          mod.effective_tags({"raw": "Review Salesforce release #needs-triage", "text": "Review Salesforce release", "difficulty": 3}, cfg)))
check("high-confidence personal cue routes task",
      mod.projection_from_task({"raw": "Schedule couples therapy", "text": "Schedule couples therapy", "difficulty": 3}, cfg)["list"] == "Personal")
check("high-confidence household cue routes task",
      mod.projection_from_task({"raw": "Buy groceries", "text": "Buy groceries", "difficulty": 3}, cfg)["list"] == "House")
check("ambiguous cues remain triaged",
      mod.projection_from_task({"raw": "Discuss Salesforce during therapy", "text": "Discuss Salesforce during therapy", "difficulty": 3}, cfg)["list"] == "Inbox")
check("disabled inference preserves triage fallback",
      mod.projection_from_task({"raw": "Review Salesforce release", "text": "Review Salesforce release", "difficulty": 3,
                                "completed": False}, mod.merge(cfg, {"categoryInference": {"enabled": False}}))["list"] == "Inbox")
custom_cfg = mod.merge(cfg, {"routes": cfg["routes"] + [{"tag": "#class", "list": "Class", "listId": ""}],
                             "categoryInference": {"cues": {"#class": "coursework, assignment"}}})
check("custom route accepts editable cue text",
      mod.projection_from_task({"raw": "Finish coursework assignment", "text": "Finish coursework assignment", "difficulty": 3}, custom_cfg)["list"] == "Class")
peer_tasks = mod.parse_tasks(
    "- [ ] Write release notes #work ^task-detailed\n"
    "- [ ] Write release notes #needs-triage ^task-short\n"
)
peer_hints = mod.peer_category_hints(peer_tasks, cfg)
check("exact-title sibling inherits one unambiguous category",
      mod.projection_from_task(peer_tasks["task-short"], cfg, peer_hints["write release notes"])["list"] == "Work")
parsed = mod.parse_tasks("- [ ] Work task #work ^task-work\n")
check("raw category tag routes task", mod.projection_from_task(parsed["task-work"], cfg)["list"] == "Work")
check("valid configuration has no errors", mod.validate_config({**cfg, "enabled": True}) == [])
check("duplicate managed tags are rejected", bool(mod.validate_config({**cfg, "tags": {**cfg["tags"], "duration20": "#10min"}})))

task = {"text": "Review release #work #10min #20min", "details": "Confirm checklist",
        "due": "2026-09-01", "priority": "high", "flagged": True,
        "completed": False, "difficulty": 4}
projection = mod.projection_from_task(task, cfg)
check("exactly one duration tag", sum(tag in projection["tags"] for tag in ("#10min", "#20min", "#30min")) == 1)
check("explicit first duration tag is retained", "#10min" in projection["tags"] and "#20min" not in projection["tags"])
check("highest priority renders as flag marker", "🔺" in mod.render_task("task-1", {**projection, "flagged": True}))
check("AppleScript flag output preserves true and false values",
      mod.parse_flag_values("one\ttrue\ntwo\tfalse\n") == {"one": True, "two": False})

reminder = {"id": "r-1", "title": "Buy supplies", "notes": "#house #20min\nPick up filters",
            "dueDate": "2026-09-02T05:00:00Z", "listName": "House", "priority": "medium",
            "isFlagged": False, "isCompleted": False}
remote = mod.projection_from_reminder(reminder, cfg)
check("reminder list becomes category", "#house" in remote["tags"])
check("reminder tags are not duplicated in details", remote["details"] == "Pick up filters")
check("reminder date is normalized", remote["due"] == "2026-09-02")

mail_cfg = mod.merge(cfg, {"mail": {"enabled": True}})
mail_task = {**task, "url": "message://%3CExample|Inbox|1%3E"}
check("mail URL is retained only when enabled",
      mod.projection_from_task(mail_task, mail_cfg)["url"].startswith("message://"))

parsed = mod.parse_tasks("# Tasks\n\n- [ ] Review release 📅 2026-09-01 #work #task ^task-abc123\n  Details: Confirm checklist\n")
check("stable task ID parses", "task-abc123" in parsed)
check("details child parses", parsed["task-abc123"]["details"] == "Confirm checklist")
check("difficulty property parses", mod.parse_tasks("- [ ] Small task [difficulty:: 2] ^task-small")["task-small"]["difficulty"] == 2)
check("rendered task retains stable ID", "^task-abc123" in mod.render_task("task-abc123", projection))

captured_commands = []
original_command = mod.command
mod.command = lambda args, dry_run=False: captured_commands.append(args) or {}
mod.edit_reminder("reminder-1", {"title": "Close parent", "list": "Work", "notes": "", "completed": True}, False)
mod.edit_reminder("reminder-1", {"title": "Reopen parent", "list": "Work", "notes": "", "completed": False}, False)
mod.command = original_command
check("completion propagation uses complete/incomplete commands",
      "--complete" in captured_commands[0] and "--incomplete" in captured_commands[1])
tree = mod.parse_tasks(
    "- [x] Parent ^task-parent\n"
    "  - [ ] Child ^task-child\n"
    "    - [ ] Grandchild ^task-grandchild\n"
)
check("parent completion reaches nested descendants",
      mod.descendant_ids(tree, "task-parent") == {"task-child", "task-grandchild"})

if fails:
    raise SystemExit(f"{len(fails)} reminders projection checks failed")
print(f"\n{checks} reminders projection checks passed")
