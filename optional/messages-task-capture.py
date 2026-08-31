#!/usr/bin/env python3
"""Incrementally turn actionable incoming iMessages into Obsidian tasks.

This companion is intentionally local-first. It reads macOS Messages with a
read-only SQLite connection, keeps its cursor and source associations in the
private Reminders state file, and appends only normal Task Inbox checkboxes.
No message content or identifiers are emitted in command output.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

APPLE_EPOCH = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)
DEFAULT = {
    "enabled": False,
    "scanIncoming": True,
    "intervalMinutes": 10,
    "autoCreate": True,
    "localRulesFirst": True,
    "modelEnabled": False,
    "excludeSystemMessages": True,
    "excludedChats": [],
    "excludedSenders": [],
    "statePath": "4 System/Automation/reminders-sync-state.json",
    "todayOnly": True,
}
ACTION_RE = re.compile(
    r"(?i)\b(?:please|can you|could you|would you|need you to|remember to|"
    r"follow up|make sure|don't forget|do you mind|you should|you need to|"
    r"send|call|email|text|schedule|confirm|provide|complete|check|create|"
    r"update|pick up|buy|order|bring|take|fill|clean|submit|review)\b"
)
SYSTEM_RE = re.compile(r"(?i)(?:verification code|security code|one[- ]time password|reply stop|unsubscribe|authentication code)")
REACTION_RE = re.compile(r"(?i)^\s*(?:liked|loved|laughed|emphasized|reacted)\b")
URL_ONLY_RE = re.compile(r"^\s*https?://\S+\s*$", re.I)
DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def merge(base: dict[str, Any], extra: Any) -> dict[str, Any]:
    result = dict(base)
    if isinstance(extra, dict):
        result.update(extra)
    return result


def config(vault: Path) -> tuple[dict[str, Any], dict[str, Any], Path, Path]:
    raw = load_json(vault / ".obsidian/plugins/life-os/data.json", {})
    cfg = raw.get("config", {}) if isinstance(raw, dict) else {}
    capture = merge(DEFAULT, cfg.get("messagesTaskCapture", {}))
    reminders = cfg.get("reminders", {}) if isinstance(cfg.get("reminders"), dict) else {}
    task_value = Path(str(cfg.get("paths", {}).get("taskInbox") or "2 Work/Tasks/Task Inbox.md"))
    state_value = Path(str(reminders.get("statePath") or capture["statePath"]))
    task_path = task_value if task_value.is_absolute() else vault / task_value
    state_path = state_value if state_value.is_absolute() else vault / state_value
    return capture, reminders, task_path, state_path


def load_state(path: Path) -> dict[str, Any]:
    value = load_json(path, {})
    if not isinstance(value, dict):
        value = {}
    section = value.setdefault("messagesTaskCapture", {})
    if not isinstance(section, dict):
        section = {}
        value["messagesTaskCapture"] = section
    section.setdefault("lastRowid", 0)
    section.setdefault("processed", {})
    section.setdefault("runs", 0)
    return value


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def decode_date(value: Any) -> dt.datetime:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0
    if number > 1e14:
        number /= 1_000_000_000
    elif number > 1e11:
        number /= 1_000
    return (APPLE_EPOCH + dt.timedelta(seconds=number)).astimezone()


def decode_attributed_body(blob: Any) -> str:
    """Recover visible text from Apple's typedstream attributed body."""
    if not blob:
        return ""
    raw = bytes(blob)
    marker = b"NSString"
    candidates: list[str] = []
    start = 0
    while True:
        hit = raw.find(marker, start)
        if hit < 0:
            break
        cursor = hit + len(marker)
        for position in range(cursor, min(cursor + 32, len(raw))):
            width = 1
            length = raw[position] if position < len(raw) else 0
            if length == 0x81 and position + 3 <= len(raw):
                length, width = int.from_bytes(raw[position + 1:position + 3], "little"), 3
            elif length == 0x82 and position + 5 <= len(raw):
                length, width = int.from_bytes(raw[position + 1:position + 5], "little"), 5
            if not 1 <= length <= 1_000_000 or position + width + length > len(raw):
                continue
            try:
                value = raw[position + width:position + width + length].decode("utf-8").strip()
            except UnicodeDecodeError:
                continue
            if value and any(char.isalnum() for char in value) and not any(x in value for x in ("NSObject", "NSDictionary", "WHttpURL")):
                candidates.append(value)
        start = hit + 1
    return max(candidates, key=len) if candidates else ""


def read_messages(db_path: Path, last_rowid: int, fixture: Path | None = None) -> list[dict[str, Any]]:
    if fixture:
        value = load_json(fixture, [])
        return [item for item in value if isinstance(item, dict) and not item.get("is_from_me")]
    if not db_path.exists():
        raise FileNotFoundError(f"Messages database not found: {db_path}")
    uri = f"file:{db_path.as_posix()}?mode=ro&immutable=1"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date, m.is_from_me,
                      h.uncanonicalized_id AS sender, c.chat_identifier AS chat
               FROM message m
               LEFT JOIN handle h ON h.ROWID = m.handle_id
               LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
               LEFT JOIN chat c ON c.ROWID = cmj.chat_id
               WHERE m.ROWID > ? ORDER BY m.ROWID ASC""", (last_rowid,)
        ).fetchall()
    finally:
        conn.close()
    return [{"rowid": int(row["rowid"]), "guid": str(row["guid"] or ""),
             "body": str(row["text"] or "").strip() or decode_attributed_body(row["attributedBody"]), "when": decode_date(row["date"]).isoformat(),
             "is_from_me": bool(row["is_from_me"]), "sender": str(row["sender"] or ""),
             "chat": str(row["chat"] or "")} for row in rows]


def clean_body(body: str) -> str:
    lines = []
    for line in (body or "").splitlines():
        if line.strip().startswith(">") or line.strip() == "--":
            break
        lines.append(line.strip())
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def actionable(body: str, cfg: dict[str, Any]) -> bool:
    text = clean_body(body)
    if not text or len(text) < 8 or len(text) > 1000:
        return False
    if cfg.get("excludeSystemMessages", True) and (SYSTEM_RE.search(text) or REACTION_RE.search(text) or URL_ONLY_RE.match(text)):
        return False
    return bool(ACTION_RE.search(text))


def extract_actions(body: str) -> list[str]:
    text = clean_body(body)
    sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", text) if x.strip()]
    selected = [x for x in sentences if ACTION_RE.search(x)]
    return list(dict.fromkeys(x[:240] for x in selected))[:5] or ([text[:240]] if ACTION_RE.search(text) else [])


def due_date(body: str) -> str | None:
    match = DATE_RE.search(body or "")
    return match.group(1) if match else None


def cue_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [x.strip().lower() for x in value.split(",") if x.strip()]
    return [str(x).strip().lower() for x in value] if isinstance(value, list) else []


def classify(text: str, reminders: dict[str, Any]) -> tuple[str, list[str]]:
    inference = reminders.get("categoryInference", {}) if isinstance(reminders.get("categoryInference"), dict) else {}
    cues = inference.get("cues", {}) if isinstance(inference.get("cues"), dict) else {}
    scores: dict[str, int] = {}
    evidence: dict[str, list[str]] = {}
    for route in reminders.get("routes", []):
        if not isinstance(route, dict):
            continue
        tag = str(route.get("tag") or "").strip()
        for cue in cue_values(cues.get(tag, cues.get(tag.lower(), []))):
            if re.search(r"(?<![\w-])" + re.escape(cue) + r"(?![\w-])", text, re.I):
                scores[tag] = scores.get(tag, 0) + 1
                evidence.setdefault(tag, []).append(cue)
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0].lower()))
    if ordered and (len(ordered) == 1 or ordered[0][1] > ordered[1][1]):
        return ordered[0][0], evidence.get(ordered[0][0], [])
    return "", []


def tags_for(text: str, category: str, reminders: dict[str, Any], duration: str | None = None,
             phone: bool | None = None, blocked: bool | None = None) -> list[str]:
    tags_cfg = reminders.get("tags", {}) if isinstance(reminders.get("tags"), dict) else {}
    tags = [category or str(tags_cfg.get("needsTriage") or "#needs-triage")]
    lower = text.lower()
    if phone is None:
        phone = not any(x in lower for x in ("deploy", "deployment", "install", "xcode", "in person")) and any(
            x in lower for x in ("self-port cli", "codex", "email", "text", "call", "message"))
    if phone:
        tags.append(str(tags_cfg.get("onPhone") or "#on-phone"))
    if blocked is None:
        blocked = any(x in lower for x in ("waiting", "wait for", "dependency", "blocked", "once they", "after they"))
    if blocked:
        tags.append(str(tags_cfg.get("blocked") or "#blocked"))
    else:
        tags.append(str(tags_cfg.get("notStarted") or "#not-started"))
    words = max(1, len(text.split()))
    duration_key = duration or ("duration10" if words <= 12 else "duration20" if words <= 28 else "duration30")
    if duration_key.startswith("#"):
        tags.append(duration_key)
    else:
        tags.append(str(tags_cfg.get(duration_key) or "#20min"))
    return list(dict.fromkeys(tags))


def priority_for(text: str) -> tuple[str, bool]:
    lower = text.lower()
    highest = any(x in lower for x in ("urgent", "asap", "immediately", "today"))
    high = highest or any(x in lower for x in ("important", "critical", "deadline"))
    return ("high" if high else "medium", highest)


def model_classification(text: str, vault: Path, reminders: dict[str, Any], capture: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    """Reuse the configured Uptick provider only when explicitly enabled."""
    if not capture.get("modelEnabled"):
        return {}
    module_path = Path(__file__).with_name("workflow-assistant.py")
    spec = importlib.util.spec_from_file_location("uptick_workflow_assistant", module_path)
    if not spec or not spec.loader:
        return {}
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        value = module.cloud_suggestion({"title": text[:240], "raw": text, "tags": []}, vault, local, True)
    except Exception:
        return {}
    return value if isinstance(value, dict) and value.get("cloud") == "used" else {}


def task_id(guid: str, action: str) -> str:
    digest = hashlib.sha256((guid + "\0" + action).encode()).hexdigest()[:12]
    return f"task-imessage-{digest}"


def render_task(ident: str, title: str, tags: list[str], due: str | None, priority: str, flagged: bool) -> str:
    marker = "⏫" if priority == "high" else "🔼"
    if flagged:
        marker = "🔺"
    date = f" 📅 {due}" if due else ""
    return f"- [ ] {marker} {title}{date} {' '.join(tags)} ^{ident}"


def scan(vault: Path, dry_run: bool = False, fixture: Path | None = None) -> dict[str, Any]:
    capture, reminders, task_path, state_path = config(vault)
    state = load_state(state_path)
    section = state["messagesTaskCapture"]
    if not capture.get("enabled", False):
        return {"ok": True, "skipped": True, "reason": "iMessage task capture is disabled", "created": 0}
    messages = read_messages(Path.home() / "Library/Messages/chat.db", int(section.get("lastRowid", 0) or 0), fixture)
    lines = task_path.read_text(encoding="utf-8").splitlines() if task_path.exists() else ["# Task Inbox", ""]
    existing_ids = set(re.findall(r"\^(task-imessage-[\w-]+)", "\n".join(lines)))
    created = 0
    filtered = 0
    processed = section.setdefault("processed", {})
    split_values = lambda value: {item.strip().casefold() for item in str(value or "").split(",") if item.strip()}
    excluded_chats = split_values(capture.get("excludedChats"))
    excluded_senders = split_values(capture.get("excludedSenders"))
    max_rowid = int(section.get("lastRowid", 0) or 0)
    for message in messages:
        rowid = int(message.get("rowid", 0) or 0)
        max_rowid = max(max_rowid, rowid)
        guid = str(message.get("guid") or f"fixture-{rowid}")
        if message.get("is_from_me") or guid in processed:
            continue
        # The cursor is an efficiency guard, not the privacy boundary. On a
        # first run (or after a reset) SQLite can return years of history;
        # production imports are limited to messages received on today's local
        # calendar date. Fixtures without a timestamp remain backwards-compatible.
        if capture.get("todayOnly", True) and message.get("when"):
            try:
                received = dt.datetime.fromisoformat(str(message["when"]).replace("Z", "+00:00")).astimezone()
            except (TypeError, ValueError):
                received = None
            if received is None or received.date() != dt.date.today():
                processed[guid] = {"status": "outside-today-window", "rowid": rowid}
                filtered += 1
                continue
        if str(message.get("chat") or "").casefold() in excluded_chats or str(message.get("sender") or "").casefold() in excluded_senders:
            processed[guid] = {"status": "excluded", "rowid": rowid}
            filtered += 1
            continue
        body = clean_body(str(message.get("body") or ""))
        if not actionable(body, capture):
            filtered += 1
            processed[guid] = {"status": "filtered", "rowid": rowid}
            continue
        actions = extract_actions(body)
        category, evidence = classify(body, reminders)
        local = {"category": category, "duration": None, "phone": None, "priority": "medium", "flagged": False}
        model = model_classification(body, vault, reminders, capture, local)
        category = str(model.get("category") or category)
        due = due_date(body)
        priority, flagged = priority_for(body)
        if str(model.get("priority") or "") in {"low", "medium", "high"}:
            priority = str(model["priority"])
        if isinstance(model.get("flagged"), bool):
            flagged = bool(model["flagged"])
        parent = task_id(guid, "parent")
        if parent not in existing_ids:
            lines.append(render_task(parent, body[:160], tags_for(body, category, reminders, model.get("duration"), model.get("phone")), due, priority, flagged))
            existing_ids.add(parent)
            created += 1
        children = []
        for action in actions:
            ident = task_id(guid, action)
            if ident in existing_ids:
                continue
            lines.append("  " + render_task(ident, action, tags_for(action, category, reminders, model.get("duration"), model.get("phone")), due, priority, flagged))
            existing_ids.add(ident)
            children.append(ident)
            created += 1
        processed[guid] = {"status": "created", "rowid": rowid, "parentId": parent,
                          "childIds": children, "category": category, "evidence": evidence}
    result = {"ok": True, "dryRun": dry_run, "scanned": len(messages), "created": created,
              "filtered": filtered, "duplicates": 0, "lastRowid": max_rowid}
    if not dry_run:
        if created:
            task_path.parent.mkdir(parents=True, exist_ok=True)
            task_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        section["lastRowid"] = max_rowid
        section["runs"] = int(section.get("runs", 0) or 0) + 1
        save_state(state_path, state)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--scan", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--reset-cursor", action="store_true")
    parser.add_argument("--fixture")
    ns = parser.parse_args()
    vault = Path(ns.vault).expanduser().resolve()
    capture, _reminders, _task_path, state_path = config(vault)
    if ns.status:
        state = load_state(state_path)["messagesTaskCapture"]
        print(json.dumps({"ok": True, "enabled": bool(capture.get("enabled")),
                          "lastRowid": state.get("lastRowid", 0), "runs": state.get("runs", 0)}))
        return 0
    if ns.reset_cursor:
        state = load_state(state_path)
        state["messagesTaskCapture"]["lastRowid"] = 0
        state["messagesTaskCapture"]["processed"] = {}
        save_state(state_path, state)
        print(json.dumps({"ok": True, "reset": True}))
        return 0
    if not ns.scan:
        print(json.dumps({"ok": False, "error": "choose --scan, --dry-run, --status, or --reset-cursor"}))
        return 2
    try:
        print(json.dumps(scan(vault, ns.dry_run, Path(ns.fixture) if ns.fixture else None)))
        return 0
    except (OSError, sqlite3.Error, RuntimeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
