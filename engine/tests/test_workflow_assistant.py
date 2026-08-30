#!/usr/bin/env python3
"""Unit fixtures for the private workflow assistant's pure state logic."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("workflow_assistant", ROOT / "optional/workflow-assistant.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class WorkflowAssistantTests(unittest.TestCase):
    def test_parse_tasks_preserves_hierarchy_and_waiting_metadata(self):
        tasks = MODULE.parse_tasks(
            "# Task Inbox\n"
            "- [ ] Email parent 📅 2026-08-30 #task ^task-parent\n"
            "  - [x] Reply to sender 📅 2026-08-30 #task ^task-child\n"
            "- [ ] Waiting item 📅 2026-09-01 #task #blocked [follow-up:: 2026-09-05] [waiting-since:: 2026-08-20] ^task-wait\n"
        )
        self.assertEqual(tasks["task-child"]["parentId"], "task-parent")
        self.assertTrue(tasks["task-child"]["completed"])
        self.assertEqual(tasks["task-wait"]["followUpDate"], "2026-09-05")
        self.assertEqual(tasks["task-wait"]["waitingSince"], "2026-08-20")

    def test_local_suggestion_uses_learning_and_reports_evidence(self):
        cfg = {
            "routes": [{"tag": "#work", "list": "Work"}, {"tag": "#personal", "list": "Personal"}],
            "categoryInference": {"cues": {"#work": ["salesforce"], "#personal": ["doctor"]}},
            "tags": {"notStarted": "#not-started", "inProgress": "#in-progress", "duration20": "#20min", "onPhone": "#on-phone"},
        }
        state = {"workflow": {"learning": [{"cue": "sandbox", "tag": "#work", "weight": 2}]}}
        result = MODULE.local_suggestion({"title": "Review sandbox access", "raw": "Review sandbox access", "tags": []}, cfg, state)
        self.assertEqual(result["category"], "#work")
        self.assertEqual(result["source"], "local-cues")
        self.assertIn("sandbox", result["reason"])

    def test_approval_removes_queue_and_persists_private_learning(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            data = {"config": {"reminders": {"statePath": "state.json"}}}
            (vault / ".obsidian/plugins/life-os").mkdir(parents=True)
            (vault / ".obsidian/plugins/life-os/data.json").write_text(json.dumps(data), encoding="utf-8")
            (vault / "2 Work/Tasks/Task Inbox.md").parent.mkdir(parents=True)
            (vault / "2 Work/Tasks/Task Inbox.md").write_text("- [ ] Review sandbox ^task-a\n", encoding="utf-8")
            (vault / "state.json").write_text(json.dumps({"workflow": {"triageQueue": {"task-a": {}}}}), encoding="utf-8")
            result = MODULE.approve(vault, "task-a", "#work", "sandbox")
            self.assertTrue(result["ok"])
            saved = json.loads((vault / "state.json").read_text(encoding="utf-8"))
            self.assertNotIn("task-a", saved["workflow"]["triageQueue"])
            self.assertEqual(saved["workflow"]["learning"][0]["tag"], "#work")

    def test_waiting_dashboard_groups_items(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / ".obsidian/plugins/life-os").mkdir(parents=True)
            (vault / ".obsidian/plugins/life-os/data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {"tags": {"blocked": "#blocked", "dependency": "#dependency"}}}
            }), encoding="utf-8")
            (vault / "tasks.md").write_text(
                "- [ ] Late 📅 2026-08-30 #blocked [follow-up:: 2020-01-01] ^task-late\n"
                "- [ ] Unscheduled #dependency ^task-none\n", encoding="utf-8")
            result = MODULE.dashboard(vault)
            self.assertEqual(len(result["overdue"]), 1)
            self.assertEqual(len(result["undated"]), 1)
            self.assertEqual(len(result["byReason"]["blocked"]), 1)
            self.assertEqual(len(result["byReason"]["dependency"]), 1)

    def test_email_capture_is_idempotent_and_creates_children(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            plugin_dir = vault / ".obsidian/plugins/life-os"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {"statePath": "state.json"}}
            }), encoding="utf-8")
            script = ROOT / "optional/email-task-capture.py"
            args = ["python3", str(script), "--vault", str(vault), "--message-id", "m-1",
                    "--subject", "Review access", "--action", "Check sandbox", "--action", "Reply"]
            preview = subprocess.run(args + ["--preview"], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(preview.stdout)["actions"], ["Check sandbox", "Reply"])
            first = subprocess.run(args, capture_output=True, text=True, check=True)
            second = subprocess.run(args, capture_output=True, text=True, check=True)
            self.assertIn('"children": 2', first.stdout)
            self.assertIn('"duplicate": true', second.stdout)
            body = (vault / "tasks.md").read_text(encoding="utf-8")
            self.assertEqual(body.count("#task"), 3)
            self.assertIn("  - [ ] Check sandbox", body)
            incremental_args = ["python3", str(script), "--vault", str(vault), "--message-id", "m-1",
                                "--subject", "Review access", "--action", "New follow-up"]
            incremental = subprocess.run(incremental_args, capture_output=True, text=True, check=True)
            self.assertIn('"children": 1', incremental.stdout)
            self.assertEqual((vault / "tasks.md").read_text(encoding="utf-8").count("#task"), 4)

    def test_waiting_actions_preserve_original_task_and_record_reschedule(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            plugin_dir = vault / ".obsidian/plugins/life-os"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {
                    "statePath": "state.json", "tags": {"blocked": "#blocked", "dependency": "#dependency"}
                }}
            }), encoding="utf-8")
            (vault / "tasks.md").write_text("- [ ] Wait for vendor 📅 2026-09-01 #blocked [follow-up:: 2026-09-08] [waiting-since:: 2026-08-30] ^task-wait\n", encoding="utf-8")
            self.assertTrue(MODULE.waiting_action(vault, "task-wait", "reschedule", "2026-09-15")["ok"])
            self.assertIn("📅 2026-09-15", (vault / "tasks.md").read_text(encoding="utf-8"))
            self.assertTrue(MODULE.waiting_action(vault, "task-wait", "unblock")["ok"])
            body = (vault / "tasks.md").read_text(encoding="utf-8")
            self.assertNotIn("#blocked", body)
            self.assertNotIn("follow-up::", body)
            state = json.loads((vault / "state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["workflow"]["reschedules"]["task-wait"][0]["source"], "waiting-dashboard")

    def test_weekly_review_and_clear_activity_are_private_state_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            plugin_dir = vault / ".obsidian/plugins/life-os"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {
                    "statePath": "state.json", "tags": {"blocked": "#blocked", "dependency": "#dependency"}
                }}
            }), encoding="utf-8")
            (vault / "tasks.md").write_text("- [ ] Old task 📅 2020-01-01 ^task-old\n- [ ] Stale wait #dependency [waiting-since:: 2020-01-01] [follow-up:: 2020-01-02] ^task-stale\n", encoding="utf-8")
            (vault / "state.json").write_text(json.dumps({"workflow": {
                "activity": [{"kind": "sync", "at": "2026-08-30T00:00:00Z"}],
                "reschedules": {"task-old": [{"old": "2020-01-01", "new": "2020-01-02"}, {"old": "2020-01-02", "new": "2020-01-03"}]},
                "triageQueue": {"task-new": {"taskId": "task-new", "title": "Unsorted"}}
            }}), encoding="utf-8")
            review = MODULE.weekly_review(vault)
            kinds = {item["kind"] for item in review["recommendations"]}
            self.assertTrue({"triage", "overdue", "waiting", "reschedule-pattern"}.issubset(kinds))
            self.assertEqual(MODULE.clear_activity(vault)["cleared"], 1)
            saved = json.loads((vault / "state.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["workflow"]["activity"], [])
            self.assertEqual(len(saved["workflow"]["reschedules"]["task-old"]), 2)


if __name__ == "__main__":
    unittest.main()
