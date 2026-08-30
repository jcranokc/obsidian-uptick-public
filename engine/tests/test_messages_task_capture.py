from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "optional/messages-task-capture.py"
FIXTURE = ROOT / "engine/tests/fixtures/messages-task-capture.json"


class MessagesTaskCaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / ".obsidian/plugins/life-os").mkdir(parents=True)
        (self.vault / "2 Work/Tasks").mkdir(parents=True)
        (self.vault / "2 Work/Tasks/Task Inbox.md").write_text("# Task Inbox\n", encoding="utf-8")
        config = {
            "config": {
                "paths": {"taskInbox": "2 Work/Tasks/Task Inbox.md"},
                "messagesTaskCapture": {"enabled": True},
                "reminders": {
                    "statePath": "state.json",
                    "routes": [
                        {"tag": "#work", "list": "Work"},
                        {"tag": "#personal", "list": "Personal"},
                        {"tag": "#house", "list": "House"},
                    ],
                    "categoryInference": {
                        "enabled": True,
                        "cues": {"#work": ["salesforce"], "#personal": ["doctor"], "#house": ["grocery"]},
                    },
                    "tags": {
                        "notStarted": "#not-started", "blocked": "#blocked", "needsTriage": "#needs-triage",
                        "duration10": "#10min", "duration20": "#20min", "duration30": "#30min", "onPhone": "#on-phone",
                    },
                },
            }
        }
        (self.vault / ".obsidian/plugins/life-os/data.json").write_text(json.dumps(config), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_capture(self, *args):
        result = subprocess.run(
            ["python3", str(SCRIPT), "--vault", str(self.vault), "--scan", "--fixture", str(FIXTURE), *args],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_creates_categorized_parent_children_and_filters(self):
        result = self.run_capture()
        self.assertEqual(result["created"], 6)
        text = (self.vault / "2 Work/Tasks/Task Inbox.md").read_text(encoding="utf-8")
        self.assertIn("#work", text)
        self.assertIn("#not-started", text)
        self.assertIn("#on-phone", text)
        deployment = next(line for line in text.splitlines() if "deployment" in line.lower() and "^task-imessage-" in line)
        self.assertNotIn("#on-phone", deployment)
        self.assertIn("#needs-triage", text)
        self.assertNotIn("verification code", text)
        self.assertNotIn("Please send the report", text)

    def test_second_scan_is_idempotent(self):
        self.run_capture()
        result = self.run_capture()
        self.assertEqual(result["created"], 0)
        text = (self.vault / "2 Work/Tasks/Task Inbox.md").read_text(encoding="utf-8")
        self.assertEqual(text.count("^task-imessage-"), 6)


if __name__ == "__main__":
    unittest.main()
