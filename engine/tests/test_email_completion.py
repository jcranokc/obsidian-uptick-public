#!/usr/bin/env python3
"""Fixtures for conservative sent-mail completion detection."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "optional/email-completion.py"


class EmailCompletionTests(unittest.TestCase):
    def test_explicit_unique_completion_and_idempotency(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / ".obsidian/plugins/life-os").mkdir(parents=True)
            (vault / ".obsidian/plugins/life-os/data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {"statePath": "state.json"},
                    "workflowAssistant": {"enabled": True, "emailCompletion": {"enabled": True}}
                }
            }), encoding="utf-8")
            (vault / "tasks.md").write_text("- [ ] Send the report ^task-report\n", encoding="utf-8")
            (vault / "state.json").write_text(json.dumps({"workflow": {"emailParents": {
                "incoming-1": {"parentId": "task-report", "subject": "Report request"}
            }}}), encoding="utf-8")
            fixture = vault / "sent.json"
            fixture.write_text(json.dumps([{"messageId": "sent-1", "subject": "Re: Report request",
                                            "body": "I completed the report.\n\n> The old request was done."}]), encoding="utf-8")
            command = ["python3", str(SCRIPT), "--vault", str(vault), "--scan", "--fixture", str(fixture)]
            first = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(first.stdout)["completed"], 1)
            self.assertIn("[x] Send the report", (vault / "tasks.md").read_text(encoding="utf-8"))
            second = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(second.stdout)["completed"], 0)

    def test_negative_and_ambiguous_messages_do_not_auto_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / ".obsidian/plugins/life-os").mkdir(parents=True)
            (vault / ".obsidian/plugins/life-os/data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {"statePath": "state.json"},
                    "workflowAssistant": {"enabled": True, "emailCompletion": {"enabled": True}}
                }
            }), encoding="utf-8")
            (vault / "tasks.md").write_text("- [ ] Report A ^task-a\n- [ ] Report B ^task-b\n", encoding="utf-8")
            (vault / "state.json").write_text(json.dumps({"workflow": {"emailParents": {
                "incoming-a": {"parentId": "task-a", "subject": "Shared request"},
                "incoming-b": {"parentId": "task-b", "subject": "Shared request"}
            }}}), encoding="utf-8")
            fixture = vault / "sent.json"
            fixture.write_text(json.dumps([
                {"messageId": "sent-negative", "subject": "Re: Shared request", "body": "I will complete this tomorrow."},
                {"messageId": "sent-ambiguous", "subject": "Re: Shared request", "body": "I completed this."},
            ]), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), "--vault", str(vault), "--scan", "--fixture", str(fixture)], capture_output=True, text=True, check=True)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["completed"], 0)
            self.assertEqual(payload["review"], 1)
            self.assertEqual(payload["reviewQueue"], 1)
            self.assertNotIn("[x]", (vault / "tasks.md").read_text(encoding="utf-8"))
            state = json.loads((vault / "state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["workflow"]["emailCompletionReview"][0]["taskIds"], ["task-a", "task-b"])

    def test_review_approval_completes_selected_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / ".obsidian/plugins/life-os").mkdir(parents=True)
            (vault / ".obsidian/plugins/life-os/data.json").write_text(json.dumps({
                "config": {"paths": {"taskInbox": "tasks.md"}, "reminders": {"statePath": "state.json"}}
            }), encoding="utf-8")
            (vault / "tasks.md").write_text("- [ ] Report A ^task-a\n- [ ] Report B ^task-b\n", encoding="utf-8")
            (vault / "state.json").write_text(json.dumps({"workflow": {"emailCompletionReview": [
                {"messageId": "sent-ambiguous", "taskIds": ["task-a", "task-b"]}
            ]}}), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), "--vault", str(vault), "--review-action", "sent-ambiguous", "task-b", "approve"], capture_output=True, text=True, check=True)
            self.assertTrue(json.loads(result.stdout)["ok"])
            body = (vault / "tasks.md").read_text(encoding="utf-8")
            self.assertIn("[x] Report B", body)
            self.assertIn("[ ] Report A", body)


if __name__ == "__main__":
    unittest.main()
