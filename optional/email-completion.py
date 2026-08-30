#!/usr/bin/env python3
"""Detect explicit completion statements in sent Apple Mail and close linked tasks.

This is deliberately conservative. It reads only new Sent messages, requires an
explicit completion phrase, and auto-completes only one uniquely associated open
task. IDs, message bodies, and match evidence stay in the private sync state.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any


DEFAULT = {
    "enabled": False, "scanSentMail": True, "autoCompleteUnique": True,
    "reviewAmbiguous": True, "lookbackHours": 48, "maxMessagesPerRun": 100,
    "explicitPhrases": ["completed", "done", "finished", "resolved", "handled", "taken care of", "submitted", "sent"],
    "negativePhrases": ["not done", "still working", "not yet", "will complete", "plan to complete", "need to finish"],
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def merge(base: dict[str, Any], extra: Any) -> dict[str, Any]:
    result = dict(base)
    if isinstance(extra, dict):
        for key, value in extra.items():
            result[key] = merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
    return result


def config(vault: Path) -> tuple[dict[str, Any], dict[str, Any], Path, Path]:
    raw = load_json(vault / ".obsidian/plugins/life-os/data.json", {})
    cfg = raw.get("config", {}) if isinstance(raw, dict) else {}
    reminders = cfg.get("reminders", {}) if isinstance(cfg.get("reminders"), dict) else {}
    assistant = cfg.get("workflowAssistant", {}) if isinstance(cfg.get("workflowAssistant"), dict) else {}
    completion = merge(DEFAULT, assistant.get("emailCompletion", {}))
    task_value = Path(str(cfg.get("paths", {}).get("taskInbox") or "2 Work/Tasks/Task Inbox.md"))
    task_file = task_value if task_value.is_absolute() else vault / task_value
    state_value = Path(str(reminders.get("statePath") or "4 System/Automation/reminders-sync-state.json"))
    state_file = state_value if state_value.is_absolute() else vault / state_value
    return completion, reminders, task_file, state_file


def load_state(path: Path) -> dict[str, Any]:
    state = load_json(path, {})
    if not isinstance(state, dict):
        state = {}
    workflow = state.setdefault("workflow", {})
    if not isinstance(workflow, dict):
        workflow = {}
        state["workflow"] = workflow
    workflow.setdefault("emailCompletion", {})
    workflow.setdefault("activity", [])
    workflow.setdefault("emailParents", {})
    return state


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def task_id(line: str) -> str | None:
    match = re.search(r"\^((?:task|reminder)-[A-Za-z0-9_-]+)", line or "")
    return match.group(1) if match else None


def tasks_from(text: str) -> dict[str, dict[str, Any]]:
    result = {}
    for index, line in enumerate(text.splitlines()):
        match = re.match(r"^(\s*)- \[([ xX])\]\s+(.+?)\s*$", line)
        ident = task_id(line)
        if not match or not ident:
            continue
        title = re.sub(r"\s+#[-\w]+|\s*\^task[-\w]+|\s*📅\s*20\d{2}-\d{2}-\d{2}", "", match.group(3)).strip()
        result[ident] = {"id": ident, "lineIndex": index, "completed": match.group(2).lower() == "x", "title": title}
    return result


def normalize_subject(value: str) -> str:
    value = re.sub(r"^(?:(?:re|fw|fwd)\s*:\s*)+", "", value or "", flags=re.I)
    return re.sub(r"\s+", " ", value).strip().casefold()


def new_message_text(body: str) -> str:
    kept = []
    for line in (body or "").replace("\r", "").splitlines():
        if re.match(r"^\s*>", line) or re.match(r"^\s*On .+wrote:\s*$", line, re.I):
            break
        if re.match(r"^\s*--\s*$", line):
            break
        kept.append(line)
    return "\n".join(kept).strip()


def completion_signal(body: str, rules: dict[str, Any]) -> tuple[bool, str]:
    text = new_message_text(body)
    negatives = [str(x).strip() for x in rules.get("negativePhrases", []) if str(x).strip()]
    if any(re.search(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", text, re.I) for phrase in negatives):
        return False, "negative or future completion language"
    positives = [str(x).strip() for x in rules.get("explicitPhrases", []) if str(x).strip()]
    for phrase in positives:
        if re.search(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", text, re.I):
            return True, phrase
    return False, "no explicit completion phrase"


def read_messages(ns: argparse.Namespace, rules: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    if ns.fixture:
        value = load_json(Path(ns.fixture), [])
        return value if isinstance(value, list) else [], None
    script = Path(__file__).with_name("mail-sent-completions.applescript")
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=float(rules.get("lookbackHours") or 48))
    if ns.since:
        try:
            since = dt.datetime.fromisoformat(ns.since.replace("Z", "+00:00"))
        except ValueError:
            pass
    try:
        result = subprocess.run(["/usr/bin/osascript", str(script), str(since.timestamp())], capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return [], str(exc)
    if result.returncode:
        return [], (result.stderr or result.stdout or "Apple Mail scan failed").strip()
    messages = []
    for chunk in result.stdout.split("\n---UPTICK-MESSAGE---\n"):
        head, marker, body = chunk.partition("\n---UPTICK-BODY---\n")
        fields = head.strip().split("\t")
        if len(fields) >= 4 and fields[0].strip():
            messages.append({"messageId": fields[0].strip(), "subject": fields[1].strip(), "date": fields[2].strip(), "inReplyTo": fields[3].strip(), "body": body.strip()})
    return messages, None


def linked_candidates(message: dict[str, Any], parents: dict[str, Any], tasks: dict[str, dict[str, Any]]) -> list[str]:
    reply_to = str(message.get("inReplyTo") or "").strip()
    subject = normalize_subject(str(message.get("subject") or ""))
    linked = []
    fallback = []
    for source_id, record in parents.items():
        if not isinstance(record, dict):
            continue
        candidate = str(record.get("parentId") or "")
        if candidate and candidate in tasks and not tasks[candidate]["completed"]:
            if reply_to and reply_to == str(source_id):
                linked.append(candidate)
            elif subject and subject == normalize_subject(str(record.get("subject") or "")):
                fallback.append(candidate)
    return list(dict.fromkeys(linked or fallback))


def process(vault: Path, ns: argparse.Namespace) -> dict[str, Any]:
    rules, _reminders, task_file, state_file = config(vault)
    if not rules.get("enabled", False) or not rules.get("scanSentMail", True):
        return {"ok": True, "skipped": True, "reason": "sent-mail completion is disabled"}
    state = load_state(state_file)
    workflow = state["workflow"]
    private = workflow["emailCompletion"]
    tasks = tasks_from(task_file.read_text(encoding="utf-8") if task_file.exists() else "")
    messages, error = read_messages(ns, rules)
    if error:
        workflow["activity"].append({"at": now(), "kind": "email-completion-error", "reason": error[:240]})
        save_state(state_file, state)
        return {"ok": False, "error": error}
    parents = workflow.get("emailParents", {})
    processed = set(private.get("processedMessageIds", []))
    queue = workflow.setdefault("emailCompletionReview", [])
    changed = {"scanned": 0, "completed": 0, "review": 0, "skipped": 0}
    limit = max(1, int(rules.get("maxMessagesPerRun") or 100))
    for message in messages[:limit]:
        message_id = str(message.get("messageId") or "")
        if not message_id or message_id in processed:
            continue
        changed["scanned"] += 1
        signal, evidence = completion_signal(str(message.get("body") or ""), rules)
        candidates = linked_candidates(message, parents, tasks) if signal else []
        event = {"at": now(), "kind": "email-completion-detected", "source": "sent-mail", "signal": evidence}
        if not signal:
            changed["skipped"] += 1
            event["result"] = "skipped"
        elif len(candidates) == 1 and rules.get("autoCompleteUnique", True):
            ident = candidates[0]
            lines = task_file.read_text(encoding="utf-8").splitlines()
            index = tasks[ident]["lineIndex"]
            lines[index] = re.sub(r"^(\s*- \[)\s(\])", r"\1x\2", lines[index])
            task_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
            tasks[ident]["completed"] = True
            changed["completed"] += 1
            event.update({"result": "auto-completed", "task": ident})
        else:
            changed["review"] += 1
            queue.append({"messageId": message_id, "subject": str(message.get("subject") or ""), "taskIds": candidates, "reason": evidence if signal else "no linked task", "createdAt": now()})
            event["result"] = "review"
        workflow["activity"].append(event)
        processed.add(message_id)
    private["processedMessageIds"] = list(processed)[-1000:]
    private["lastScanAt"] = now()
    workflow["activity"] = workflow["activity"][-2000:]
    save_state(state_file, state)
    return {"ok": True, **changed, "reviewQueue": len(queue)}


def review_action(vault: Path, message_id: str, ident: str, action: str) -> dict[str, Any]:
    """Approve or reject one private review item without exposing Mail IDs."""
    _rules, _reminders, task_file, state_file = config(vault)
    state = load_state(state_file)
    workflow = state["workflow"]
    queue = workflow.setdefault("emailCompletionReview", [])
    item = next((entry for entry in queue if str(entry.get("messageId")) == message_id), None)
    if not item:
        return {"ok": False, "error": "review item not found"}
    if action == "approve":
        if ident not in set(item.get("taskIds") or []):
            return {"ok": False, "error": "task is not a candidate for this message"}
        lines = task_file.read_text(encoding="utf-8").splitlines()
        tasks = tasks_from("\n".join(lines))
        task = tasks.get(ident)
        if not task:
            return {"ok": False, "error": "task not found"}
        lines[task["lineIndex"]] = re.sub(r"^(\s*- \[)\s(\])", r"\1x\2", lines[task["lineIndex"]])
        task_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    elif action != "reject":
        return {"ok": False, "error": "action must be approve or reject"}
    queue.remove(item)
    workflow["activity"].append({"at": now(), "kind": f"email-completion-{action}", "task": ident if action == "approve" else None})
    save_state(state_file, state)
    return {"ok": True, "action": action, "taskId": ident or None}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--scan", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--fixture")
    parser.add_argument("--since")
    parser.add_argument("--review-action", nargs=3, metavar=("MESSAGE", "TASK", "ACTION"))
    ns = parser.parse_args()
    vault = Path(ns.vault).expanduser().resolve()
    if not ns.scan:
        if ns.review_action:
            print(json.dumps(review_action(vault, *ns.review_action)))
            return 0
        parser.error("choose --scan or --review-action")
    if ns.dry_run:
        # Dry-run uses the same parser but never writes task or state files.
        rules, _reminders, task_file, _state_file = config(vault)
        messages, error = read_messages(ns, rules)
        print(json.dumps({"ok": not error, "dryRun": True, "scanned": len(messages), "error": error}))
        return 0 if not error else 2
    print(json.dumps(process(vault, ns)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
