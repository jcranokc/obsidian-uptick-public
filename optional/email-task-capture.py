#!/usr/bin/env python3
"""Turn one selected/imported email into an Obsidian parent task and children.

The caller supplies the already-selected Mail message metadata. This keeps Mail
selection in AppleScript/Shortcuts or the existing importer while making task
creation deterministic and deduplicated by message ID.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any


def load(vault: Path) -> tuple[dict[str, Any], Path]:
    raw = json.loads((vault / ".obsidian/plugins/life-os/data.json").read_text(encoding="utf-8"))
    config = raw.get("config", {})
    return config, vault / str(config.get("paths", {}).get("taskInbox", "2 Work/Tasks/Task Inbox.md"))


def safe(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def selected_message() -> dict[str, str]:
    """Read metadata and body for the first selected Apple Mail message."""
    script = Path(__file__).with_name("mail-selected-task.applescript")
    try:
        result = subprocess.run(["/usr/bin/osascript", str(script)], capture_output=True,
                                text=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"Apple Mail selection unavailable: {exc}") from exc
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "No Apple Mail message selected").strip())
    marker = "\n---UPTICK-BODY---\n"
    head, _, body = result.stdout.partition(marker)
    parts = head.strip().split("\t")
    if len(parts) < 3 or not parts[0].strip():
        raise RuntimeError("Apple Mail returned no selected message")
    return {"message_id": parts[0].strip(), "subject": parts[1].strip(), "url": parts[2].strip(), "body": body.strip()}


def extract_actions(subject: str, body: str) -> list[str]:
    """Conservatively extract action-like lines for the approval preview."""
    candidates: list[str] = []
    for raw in (body or "").splitlines():
        line = safe(re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", raw))
        if len(line) < 4 or len(line) > 240:
            continue
        if re.match(r"(?i)(please|can you|could you|would you|action|required|todo|follow up|reply|send|review|schedule|confirm|provide|complete|check|create|update|call|email|contact)\b", line):
            candidates.append(line)
    if not candidates:
        for sentence in re.split(r"(?<=[.!?])\s+", safe(body)):
            if re.match(r"(?i)(please|can you|could you|would you|we need|you need|remember to|follow up|reply|send|review|schedule|confirm|provide|complete|check|create|update|call|email|contact)\b", sentence):
                candidates.append(sentence[:240])
    return list(dict.fromkeys(candidates))[:5]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--message-id", default="")
    parser.add_argument("--subject", default="")
    parser.add_argument("--url", default="")
    parser.add_argument("--action", action="append", default=[])
    parser.add_argument("--due", default=None)
    parser.add_argument("--selected", action="store_true", help="use the first selected Apple Mail message")
    parser.add_argument("--preview", action="store_true", help="return extracted actions without writing tasks")
    ns = parser.parse_args()
    vault = Path(ns.vault).expanduser().resolve()
    if ns.selected:
        try:
            selected = selected_message()
        except RuntimeError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}))
            return 2
        ns.message_id = selected["message_id"]
        ns.subject = selected["subject"]
        ns.url = selected["url"]
        if not ns.action:
            ns.action = extract_actions(ns.subject, selected.get("body", ""))
    if not ns.message_id or not ns.subject:
        print(json.dumps({"ok": False, "error": "message ID and subject are required"}))
        return 2
    if ns.preview:
        print(json.dumps({"ok": True, "preview": True, "message_id": ns.message_id,
                          "subject": safe(ns.subject), "url": ns.url, "actions": [safe(x) for x in ns.action if safe(x)]}))
        return 0
    config, task_file = load(vault)
    reminder_cfg = config.get("reminders", {})
    state_file = Path(str(reminder_cfg.get("statePath", "4 System/Automation/reminders-sync-state.json")))
    if not state_file.is_absolute():
        state_file = vault / state_file
    state = {}
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        pass
    workflow = state.setdefault("workflow", {})
    parents = workflow.setdefault("emailParents", {})
    if ns.message_id in parents:
        record = parents[ns.message_id]
        parent_id = str(record.get("parentId") or "")
        existing_actions = [safe(str(item)).lower() for item in record.get("actions", []) if safe(str(item))]
        new_actions = []
        for action in ns.action:
            cleaned = safe(action)
            if cleaned and cleaned.lower() not in existing_actions and cleaned.lower() not in {x.lower() for x in new_actions}:
                new_actions.append(cleaned)
        if not new_actions:
            print(json.dumps({"ok": True, "duplicate": True, "parentId": parent_id, "children": 0}))
            return 0
        lines = task_file.read_text(encoding="utf-8").splitlines() if task_file.exists() else []
        parent_index = next((index for index, line in enumerate(lines) if f"^{parent_id}" in line), None)
        if parent_index is None:
            print(json.dumps({"ok": False, "error": "existing email parent task not found"}))
            return 2
        insert_at = parent_index + 1
        while insert_at < len(lines) and re.match(r"^\s{2,}- \[[ xX]\]", lines[insert_at]):
            insert_at += 1
        child_ids = list(record.get("childIds") or [])
        added_ids = []
        for action in new_actions:
            child_id = f"{parent_id}-{len(child_ids) + len(added_ids) + 1}"
            lines.insert(insert_at, f"  - [ ] {action} 📅 {ns.due or dt.date.today().isoformat()} #task #needs-triage ^{child_id}")
            insert_at += 1
            added_ids.append(child_id)
        task_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        record["childIds"] = child_ids + added_ids
        record["actions"] = list(record.get("actions") or []) + new_actions
        for child_id in added_ids:
            workflow.setdefault("emailLinks", {})[child_id] = ns.url or record.get("url", "")
        workflow.setdefault("activity", []).append({"at": dt.datetime.now(dt.timezone.utc).isoformat(), "kind": "email-captured", "parent": parent_id, "children": len(added_ids), "incremental": True})
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "duplicate": True, "parentId": parent_id, "children": len(added_ids), "taskFile": str(task_file)}))
        return 0

    date = ns.due or dt.date.today().isoformat()
    digest = hashlib.sha256(ns.message_id.encode()).hexdigest()[:12]
    parent_id = f"task-email-{digest}"
    parent = safe(ns.subject) or "Email follow-up"
    lines = task_file.read_text(encoding="utf-8").splitlines() if task_file.exists() else ["# Task Inbox", ""]
    child_ids = []
    lines.append(f"- [ ] {parent} 📅 {date} #task #needs-triage ^{parent_id}")
    for index, action in enumerate(ns.action):
        text = safe(action)
        if not text:
            continue
        child_id = f"{parent_id}-{index + 1}"
        child_ids.append(child_id)
        lines.append(f"  - [ ] {text} 📅 {date} #task #needs-triage ^{child_id}")
    task_file.parent.mkdir(parents=True, exist_ok=True)
    task_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    parents[ns.message_id] = {"parentId": parent_id, "childIds": child_ids, "actions": [safe(action) for action in ns.action if safe(action)], "subject": safe(ns.subject), "url": ns.url, "at": dt.datetime.now(dt.timezone.utc).isoformat()}
    workflow.setdefault("emailLinks", {})[parent_id] = ns.url
    for child_id in child_ids:
        workflow["emailLinks"][child_id] = ns.url
    workflow.setdefault("activity", []).append({"at": dt.datetime.now(dt.timezone.utc).isoformat(), "kind": "email-captured", "parent": parent_id, "children": len(ns.action)})
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "parentId": parent_id, "children": len(ns.action), "taskFile": str(task_file)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
