#!/usr/bin/env python3
"""Private workflow-assistant primitives for Uptick.

This companion deliberately keeps user-specific state outside the public
repository's normal data files.  It is useful from launchd, the plugin, and
fixtures without requiring a network service.  Model calls are opt-in via
``--send`` and reuse optional/llm.py's existing provider configuration.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


DEFAULT = {
    "version": 1,
    "enabled": False,
    "triage": {"enabled": True, "cloud": True, "requireApproval": True},
    "waiting": {"enabled": True, "followUpTag": "#follow-up", "defaultDays": 7},
    "activity": {"enabled": True, "retention": "permanent"},
    "email": {"enabled": True, "previewRequired": True, "parentTasks": True},
    "weeklyReview": {"enabled": True, "guided": True, "noteSection": "Uptick workflow review"},
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def merge(base: dict[str, Any], extra: Any) -> dict[str, Any]:
    result = dict(base)
    if not isinstance(extra, dict):
        return result
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge(result[key], value)
        else:
            result[key] = value
    return result


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def load_config(vault: Path) -> dict[str, Any]:
    raw = load_json(vault / ".obsidian/plugins/life-os/data.json", {})
    config = raw.get("config", {}) if isinstance(raw, dict) else {}
    return merge(DEFAULT, config.get("workflowAssistant", {}))


def load_reminders_config(vault: Path) -> dict[str, Any]:
    raw = load_json(vault / ".obsidian/plugins/life-os/data.json", {})
    config = raw.get("config", {}) if isinstance(raw, dict) else {}
    defaults = {
        "statePath": "4 System/Automation/reminders-sync-state.json",
        "inboxList": "Inbox", "waitingList": "Waiting",
        "routes": [{"tag": "#work", "list": "Work"}, {"tag": "#personal", "list": "Personal"}, {"tag": "#house", "list": "House"}],
        "tags": {"notStarted": "#not-started", "inProgress": "#in-progress", "blocked": "#blocked", "dependency": "#dependency", "needsTriage": "#needs-triage", "duration10": "#10min", "duration20": "#20min", "duration30": "#30min", "onPhone": "#on-phone", "followUp": "#follow-up"},
        "categoryInference": {"enabled": True, "minMatches": 1, "cues": {}},
    }
    return merge(defaults, config.get("reminders", {}))


def task_path(vault: Path) -> Path:
    raw = load_json(vault / ".obsidian/plugins/life-os/data.json", {})
    config = raw.get("config", {}) if isinstance(raw, dict) else {}
    paths = config.get("paths", {}) if isinstance(config.get("paths"), dict) else {}
    value = Path(str(paths.get("taskInbox") or "2 Work/Tasks/Task Inbox.md"))
    return value if value.is_absolute() else vault / value


def state_path(vault: Path, reminder_cfg: dict[str, Any]) -> Path:
    value = Path(str(reminder_cfg.get("statePath") or "4 System/Automation/reminders-sync-state.json"))
    return value if value.is_absolute() else vault / value


def load_state(vault: Path, reminder_cfg: dict[str, Any]) -> dict[str, Any]:
    value = load_json(state_path(vault, reminder_cfg), {})
    if not isinstance(value, dict):
        value = {}
    value.setdefault("version", 1)
    value.setdefault("links", {})
    value.setdefault("workflow", {})
    workflow = value["workflow"]
    if not isinstance(workflow, dict):
        workflow = {}
        value["workflow"] = workflow
    workflow.setdefault("triageQueue", {})
    workflow.setdefault("learning", [])
    workflow.setdefault("reschedules", {})
    workflow.setdefault("activity", [])
    workflow.setdefault("emailParents", {})
    workflow.setdefault("waiting", {})
    return value


def save_state(vault: Path, reminder_cfg: dict[str, Any], state: dict[str, Any]) -> None:
    path = state_path(vault, reminder_cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def append_activity(state: dict[str, Any], event: dict[str, Any]) -> None:
    """Append a safe, human-readable event; IDs remain private state only."""
    activity = state["workflow"].setdefault("activity", [])
    activity.append({"at": now(), **event})


def clean_title(value: str) -> str:
    value = re.sub(r"\[\[(?:[^\]|]+)(?:\|[^\]]+)?\]\]", "", value or "")
    value = re.sub(r"\s+#[-\w]+", "", value or "")
    value = re.sub(r"\s*\^task[-\w]+", "", value)
    value = re.sub(r"\s*📅\s*20\d{2}-\d{2}-\d{2}", "", value)
    value = re.sub(r"\[[^\]]+::[^\]]+\]", "", value)
    value = re.sub(r"[⏫🔼🔽⏬🔺]", "", value)
    return re.sub(r"\s+", " ", value).strip(" .;:-")[:240]


def tags(value: str) -> list[str]:
    return re.findall(r"(?<!\w)#[\w-]+", value or "")


def task_id(value: str) -> str | None:
    found = re.search(r"\^((?:task|reminder)-[A-Za-z0-9_-]+)", value or "")
    return found.group(1) if found else None


def parse_tasks(text: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    lines = text.splitlines()
    stack: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = re.match(r"^(\s*)- \[([ xX])\]\s+(.+?)\s*$", line)
        if not match:
            continue
        ident = task_id(match.group(3))
        if not ident:
            continue
        indent = len(match.group(1).expandtabs(2))
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else None
        body = match.group(3)
        due = re.search(r"📅\s*(20\d{2}-\d{2}-\d{2})", body)
        follow = re.search(r"\[follow-up::\s*(20\d{2}-\d{2}-\d{2})\s*\]", body, re.I)
        waiting = re.search(r"\[waiting-since::\s*(20\d{2}-\d{2}-\d{2})\s*\]", body, re.I)
        item = {
            "id": ident,
            "line": line,
            "lineIndex": index,
            "indent": indent,
            "parentId": parent,
            "raw": body,
            "title": clean_title(body),
            "tags": tags(body),
            "due": due.group(1) if due else None,
            "followUpDate": follow.group(1) if follow else None,
            "waitingSince": waiting.group(1) if waiting else None,
            "completed": match.group(2).lower() == "x",
        }
        result[ident] = item
        stack.append((indent, ident))
    return result


def read_tasks(vault: Path) -> tuple[Path, str, dict[str, dict[str, Any]]]:
    path = task_path(vault)
    text = path.read_text(encoding="utf-8") if path.exists() else "# Task Inbox\n"
    return path, text, parse_tasks(text)


def route_tags(cfg: dict[str, Any]) -> set[str]:
    return {str(x.get("tag") or "").lower() for x in cfg.get("routes", []) if isinstance(x, dict)}


def cue_match(text: str, cue: str) -> bool:
    return bool(re.search(r"(?<![\w-])" + re.escape(cue) + r"(?![\w-])", text, re.I))


def learned_scores(text: str, state: dict[str, Any]) -> dict[str, int]:
    scores: dict[str, int] = {}
    for rule in state["workflow"].get("learning", []):
        if not isinstance(rule, dict) or not rule.get("cue") or not rule.get("tag"):
            continue
        if cue_match(text, str(rule["cue"])):
            tag = str(rule["tag"]).lower()
            scores[tag] = scores.get(tag, 0) + int(rule.get("weight") or 1)
    return scores


def local_suggestion(task: dict[str, Any], reminder_cfg: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    text = " ".join(str(task.get(k) or "") for k in ("raw", "title"))
    cues_cfg = reminder_cfg.get("categoryInference", {})
    cues = cues_cfg.get("cues", {}) if isinstance(cues_cfg, dict) else {}
    scores = learned_scores(text, state)
    evidence: dict[str, list[str]] = {}
    for route in reminder_cfg.get("routes", []):
        if not isinstance(route, dict):
            continue
        tag = str(route.get("tag") or "").lower()
        values = cues.get(tag, cues.get(str(route.get("tag") or ""), []))
        if isinstance(values, str):
            values = values.split(",")
        for cue in values if isinstance(values, list) else []:
            if cue_match(text, str(cue).strip()):
                scores[tag] = scores.get(tag, 0) + 1
                evidence.setdefault(tag, []).append(str(cue).strip())
    for rule in state["workflow"].get("learning", []):
        if isinstance(rule, dict) and rule.get("cue") and rule.get("tag") and cue_match(text, str(rule["cue"])):
            evidence.setdefault(str(rule["tag"]).lower(), []).append(str(rule["cue"]))
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    best = ordered[0] if ordered else ("", 0)
    tied = len(ordered) > 1 and ordered[1][1] == best[1]
    try:
        minimum = max(1, int(cues_cfg.get("minMatches", 1))) if isinstance(cues_cfg, dict) else 1
    except (TypeError, ValueError):
        minimum = 1
    category = best[0] if best[1] >= minimum and not tied else ""
    known = reminder_cfg.get("tags", {})
    existing = {x.lower() for x in task.get("tags", [])}
    durations = [str(known.get(k) or "") for k in ("duration10", "duration20", "duration30")]
    duration = next((x for x in durations if x.lower() in existing), str(known.get("duration20") or "#20min"))
    status = str(known.get("inProgress") if str(known.get("inProgress")).lower() in existing else known.get("notStarted") or "#not-started")
    phone_cues = cues_cfg.get("phoneCues", ["self-port cli", "codex", "email", "text", "call", "message"]) if isinstance(cues_cfg, dict) else []
    not_phone_cues = cues_cfg.get("notPhoneCues", ["deploy", "deployment", "install", "xcode", "in person"]) if isinstance(cues_cfg, dict) else []
    phone = str(known.get("onPhone") or "#on-phone").lower() in existing
    if not phone and isinstance(phone_cues, list) and isinstance(not_phone_cues, list):
        phone = any(cue_match(text, str(cue)) for cue in phone_cues) and not any(
            cue_match(text, str(cue)) for cue in not_phone_cues
        )
    priority = "high" if "⏫" in str(task.get("raw")) or "🔺" in str(task.get("raw")) else "low" if "🔽" in str(task.get("raw")) else "medium"
    return {
        "category": category,
        "duration": duration,
        "phone": phone,
        "priority": priority,
        "flagged": "🔺" in str(task.get("raw")),
        "confidence": "high" if category and best[1] >= 2 else "medium" if category else "low",
        "reason": ", ".join(evidence.get(category, [])) or "No unambiguous local category evidence",
        "source": "local-cues",
        "status": status,
    }


def allowed_category(value: Any, reminder_cfg: dict[str, Any]) -> str:
    candidate = str(value or "").strip().lower()
    allowed = {str(route.get("tag") or "").lower() for route in reminder_cfg.get("routes", []) if isinstance(route, dict)}
    return candidate if candidate in allowed else ""


def clamp_model(value: dict[str, Any], local: dict[str, Any], reminder_cfg: dict[str, Any]) -> dict[str, Any]:
    duration_values = {str(reminder_cfg.get("tags", {}).get(k) or "") for k in ("duration10", "duration20", "duration30")}
    duration = str(value.get("duration") or "")
    if duration not in duration_values:
        duration = local.get("duration")
    priority = str(value.get("priority") or "").lower()
    if priority not in {"low", "medium", "high"}:
        priority = local.get("priority", "medium")
    return {
        "category": allowed_category(value.get("category"), reminder_cfg),
        "duration": duration,
        "phone": value.get("phone") if isinstance(value.get("phone"), bool) else bool(local.get("phone")),
        "priority": priority,
        "flagged": value.get("flagged") if isinstance(value.get("flagged"), bool) else bool(local.get("flagged")),
        "reason": str(value.get("reason") or local.get("reason") or "Model provided no reason")[:240],
    }


def cloud_suggestion(task: dict[str, Any], vault: Path, local: dict[str, Any], send: bool) -> dict[str, Any]:
    assistant = load_config(vault)
    if not send or not assistant.get("enabled", False) or not assistant.get("triage", {}).get("enabled", True) or not assistant.get("triage", {}).get("cloud", True):
        return {**local, "cloud": "not-requested"}
    reminder_cfg = load_reminders_config(vault)
    module_path = Path(__file__).with_name("llm.py")
    spec = importlib.util.spec_from_file_location("uptick_llm", module_path)
    if not spec or not spec.loader:
        return {**local, "cloud": "unavailable", "cloudError": "llm.py is missing"}
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    provider = module.Provider.load(vault)
    ok, reason = provider.preflight()
    if not ok:
        return {**local, "cloud": "unavailable", "cloudError": reason}
    prompt = {
        "task": str(task.get("title") or ""),
        "details": clean_title(str(task.get("raw") or ""))[:500],
        "tags": task.get("tags", []),
        "allowed_categories": [str(x.get("tag")) for x in load_reminders_config(vault).get("routes", []) if isinstance(x, dict)],
        "output": {"category": "tag or empty", "duration": "#10min/#20min/#30min", "phone": "boolean", "priority": "low/medium/high", "reason": "short"},
    }
    try:
        raw = provider.complete("Return JSON only. Classify this task conservatively:\n" + json.dumps(prompt))
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("model response was not an object")
        return {**local, **clamp_model(value, local, reminder_cfg), "confidence": "model-review", "source": "cloud", "cloud": "used"}
    except Exception as exc:  # the local recommendation remains usable
        return {**local, "cloud": "unavailable", "cloudError": str(exc)}


def build_triage(vault: Path, send: bool = False, persist: bool = True) -> dict[str, Any]:
    assistant = load_config(vault)
    reminder_cfg = load_reminders_config(vault)
    state = load_state(vault, reminder_cfg)
    _, _, tasks = read_tasks(vault)
    routes = route_tags(reminder_cfg)
    blocked = {str(reminder_cfg.get("tags", {}).get(k) or "").lower() for k in ("blocked", "dependency")}
    queue = {}
    for ident, task in tasks.items():
        current = {x.lower() for x in task["tags"]}
        if task["completed"] or routes.intersection(current) or blocked.intersection(current):
            continue
        if str(reminder_cfg.get("tags", {}).get("needsTriage") or "#needs-triage").lower() not in current and not assistant.get("triage", {}).get("enabled", True):
            continue
        local = local_suggestion(task, reminder_cfg, state)
        queue[ident] = {"taskId": ident, "title": task["title"], "suggestion": cloud_suggestion(task, vault, local, send), "updatedAt": now()}
    state["workflow"]["triageQueue"] = queue
    if persist:
        append_activity(state, {"kind": "triage", "result": "suggestions", "count": len(queue)})
        save_state(vault, reminder_cfg, state)
    return {"ok": True, "count": len(queue), "queue": queue}


def record_reschedule(vault: Path, ident: str, old: str | None, new: str | None, source: str, reason: str = "") -> None:
    reminder_cfg = load_reminders_config(vault)
    state = load_state(vault, reminder_cfg)
    history = state["workflow"].setdefault("reschedules", {}).setdefault(ident, [])
    if old == new:
        return
    history.append({"at": now(), "old": old, "new": new, "source": source, "reason": reason})
    append_activity(state, {"kind": "reschedule", "task": ident, "source": source})
    save_state(vault, reminder_cfg, state)


def dashboard(vault: Path) -> dict[str, Any]:
    reminder_cfg = load_reminders_config(vault)
    _, _, tasks = read_tasks(vault)
    blocked = {str(reminder_cfg.get("tags", {}).get(k) or "").lower() for k in ("blocked", "dependency")}
    waiting = [task for task in tasks.values() if blocked.intersection(x.lower() for x in task["tags"]) and not task["completed"]]
    today = dt.date.today().isoformat()
    by_reason = {
        "blocked": [x for x in waiting if str(reminder_cfg.get("tags", {}).get("blocked") or "#blocked").lower() in {tag.lower() for tag in x.get("tags", [])}],
        "dependency": [x for x in waiting if str(reminder_cfg.get("tags", {}).get("dependency") or "#dependency").lower() in {tag.lower() for tag in x.get("tags", [])}],
    }
    return {"ok": True, "overdue": [x for x in waiting if x.get("followUpDate") and x["followUpDate"] < today], "upcoming": [x for x in waiting if x.get("followUpDate") and x["followUpDate"] >= today], "undated": [x for x in waiting if not x.get("followUpDate")], "aging": [x for x in waiting if x.get("waitingSince") and x["waitingSince"] < today], "byReason": by_reason}


def replace_date_marker(line: str, marker: str, value: str | None) -> str:
    pattern = rf"\s*\[{re.escape(marker)}::\s*20\d{{2}}-\d{{2}}-\d{{2}}\s*\]"
    line = re.sub(pattern, "", line, flags=re.I)
    return f"{line.rstrip()} [{marker}:: {value}]" if value else line.rstrip()


def task_line_with_action(line: str, task: dict[str, Any], reminder_cfg: dict[str, Any], action: str, value: str = "") -> str:
    tags_cfg = reminder_cfg.get("tags", {})
    if action == "follow-up":
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", value):
            raise ValueError("follow-up date must be YYYY-MM-DD")
        return replace_date_marker(line, "follow-up", value)
    if action == "reschedule":
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", value):
            raise ValueError("new due date must be YYYY-MM-DD")
        updated = re.sub(r"\s*📅\s*20\d{2}-\d{2}-\d{2}", "", line)
        return f"{updated.rstrip()} 📅 {value}"
    if action == "unblock":
        updated = line
        for key in ("blocked", "dependency"):
            tag = str(tags_cfg.get(key) or "")
            if tag:
                updated = re.sub(rf"\s+{re.escape(tag)}(?=\s|$)", "", updated, flags=re.I)
        updated = replace_date_marker(updated, "follow-up", None)
        updated = replace_date_marker(updated, "waiting-since", None)
        return updated.rstrip()
    if action == "archive":
        updated = re.sub(r"^(\s*- \[)\s(\])", r"\1x\2", line)
        if "#archived" not in updated.lower():
            updated = f"{updated.rstrip()} #archived"
        return updated
    raise ValueError("unsupported Waiting action")


def waiting_action(vault: Path, ident: str, action: str, value: str = "") -> dict[str, Any]:
    reminder_cfg = load_reminders_config(vault)
    path, text, tasks = read_tasks(vault)
    task = tasks.get(ident)
    if not task:
        return {"ok": False, "error": "task not found"}
    try:
        updated = task_line_with_action(text.splitlines()[task["lineIndex"]], task, reminder_cfg, action, value)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    lines = text.splitlines()
    lines[task["lineIndex"]] = updated
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    state = load_state(vault, reminder_cfg)
    if action == "reschedule":
        history = state["workflow"].setdefault("reschedules", {}).setdefault(ident, [])
        if task.get("due") != value:
            history.append({"at": now(), "old": task.get("due"), "new": value, "source": "waiting-dashboard", "reason": ""})
    append_activity(state, {"kind": "waiting-action", "action": action, "task": ident})
    save_state(vault, reminder_cfg, state)
    return {"ok": True, "taskId": ident, "action": action, "value": value}


def weekly_review(vault: Path) -> dict[str, Any]:
    reminder_cfg = load_reminders_config(vault)
    state = load_state(vault, reminder_cfg)
    _, _, tasks = read_tasks(vault)
    today = dt.date.today().isoformat()
    waiting = dashboard(vault)
    blocked_tags = {str(reminder_cfg.get("tags", {}).get(k) or "").lower() for k in ("blocked", "dependency")}
    recommendations: list[dict[str, Any]] = []
    for item in state["workflow"].get("triageQueue", {}).values():
        recommendations.append({"kind": "triage", "taskId": item.get("taskId"), "title": item.get("title"), "reason": "Uncategorized task is awaiting approval"})
    for task in tasks.values():
        if task.get("completed") or not task.get("due") or blocked_tags.intersection(x.lower() for x in task.get("tags", [])):
            continue
        if task["due"] < today:
            recommendations.append({"kind": "overdue", "taskId": task["id"], "title": task["title"], "reason": f"Due {task['due']}"})
    for task in waiting.get("aging", []):
        recommendations.append({"kind": "waiting", "taskId": task["id"], "title": task["title"], "reason": "Waiting follow-up is aging"})
    for ident, events in state["workflow"].get("reschedules", {}).items():
        if len(events) > 1:
            recommendations.append({"kind": "reschedule-pattern", "taskId": ident, "title": tasks.get(ident, {}).get("title", "Task"), "reason": f"Rescheduled {len(events)} times"})
    return {
        "ok": True,
        "today": today,
        "recommendations": recommendations,
        "counts": {
            "triage": len(state["workflow"].get("triageQueue", {})),
            "overdue": sum(1 for item in recommendations if item["kind"] == "overdue"),
            "waiting": len(waiting.get("aging", [])),
            "reschedules": sum(len(x) for x in state["workflow"].get("reschedules", {}).values()),
        },
    }


def clear_activity(vault: Path) -> dict[str, Any]:
    reminder_cfg = load_reminders_config(vault)
    state = load_state(vault, reminder_cfg)
    count = len(state["workflow"].get("activity", []))
    state["workflow"]["activity"] = []
    save_state(vault, reminder_cfg, state)
    return {"ok": True, "cleared": count}


def apply_triage_suggestion(vault: Path, ident: str, suggestion: dict[str, Any]) -> bool:
    path, text, tasks = read_tasks(vault)
    task = tasks.get(ident)
    if not task:
        return False
    reminder_cfg = load_reminders_config(vault)
    tags_cfg = reminder_cfg.get("tags", {})
    managed = [str(tags_cfg.get(key) or "") for key in (
        "needsTriage", "notStarted", "inProgress", "duration10", "duration20", "duration30", "onPhone")]
    route_tags = [str(route.get("tag") or "") for route in reminder_cfg.get("routes", []) if isinstance(route, dict)]
    updated = task["raw"]
    for tag in managed + route_tags:
        if tag:
            updated = re.sub(rf"\s+{re.escape(tag)}(?=\s|$)", "", updated, flags=re.I)
    category = allowed_category(suggestion.get("category"), reminder_cfg)
    if category:
        updated = f"{updated.rstrip()} {category}"
    status = str(suggestion.get("status") or tags_cfg.get("notStarted") or "#not-started")
    allowed_status = {str(tags_cfg.get(key) or "") for key in ("notStarted", "inProgress")}
    updated = f"{updated.rstrip()} {status if status in allowed_status else str(tags_cfg.get('notStarted') or '#not-started')}"
    duration = str(suggestion.get("duration") or tags_cfg.get("duration20") or "#20min")
    allowed_duration = {str(tags_cfg.get(key) or "") for key in ("duration10", "duration20", "duration30")}
    updated = f"{updated.rstrip()} {duration if duration in allowed_duration else str(tags_cfg.get('duration20') or '#20min')}"
    if suggestion.get("phone") and tags_cfg.get("onPhone"):
        updated = f"{updated.rstrip()} {tags_cfg['onPhone']}"
    updated = re.sub(r"\s+(⏫|🔼|🔽|🔺)", "", updated)
    icon = "🔺" if suggestion.get("flagged") else "⏫" if suggestion.get("priority") == "high" else "🔽" if suggestion.get("priority") == "low" else "🔼"
    lines = text.splitlines()
    # The task body is already present in the original line; replace it while
    # preserving indentation and checkbox state.
    prefix = task["line"][:len(task["line"]) - len(task["raw"])]
    lines[task["lineIndex"]] = prefix.rstrip() + " " + icon + " " + updated
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return True


def approve(vault: Path, ident: str, category: str, cue: str = "") -> dict[str, Any]:
    reminder_cfg = load_reminders_config(vault)
    state = load_state(vault, reminder_cfg)
    queue = state["workflow"].setdefault("triageQueue", {})
    record = queue.get(ident, {})
    if category and not apply_triage_suggestion(vault, ident, {**record.get("suggestion", {}), "category": category}):
        return {"ok": False, "error": "task not found"}
    queue.pop(ident, None)
    if category and cue:
        state["workflow"].setdefault("learning", []).append({
            "cue": cue.strip().lower(), "tag": category.strip().lower(), "weight": 2,
            "source": "user", "at": now(),
        })
    append_activity(state, {"kind": "triage-approved", "task": ident, "category": category})
    save_state(vault, reminder_cfg, state)
    return {"ok": True, "taskId": ident, "suggestion": record.get("suggestion", {})}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--triage", action="store_true")
    parser.add_argument("--send", action="store_true", help="allow the configured AI provider to receive minimal triage fields")
    parser.add_argument("--waiting-dashboard", action="store_true")
    parser.add_argument("--weekly-review", action="store_true")
    parser.add_argument("--waiting-action", nargs=3, metavar=("TASK", "ACTION", "VALUE"))
    parser.add_argument("--clear-activity", action="store_true")
    parser.add_argument("--record-reschedule", nargs=4, metavar=("TASK", "OLD", "NEW", "SOURCE"))
    parser.add_argument("--approve", nargs=3, metavar=("TASK", "CATEGORY", "CUE"))
    ns = parser.parse_args()
    vault = Path(ns.vault).expanduser().resolve()
    if ns.triage:
        print(json.dumps(build_triage(vault, ns.send)))
        return 0
    if ns.waiting_dashboard:
        print(json.dumps(dashboard(vault)))
        return 0
    if ns.weekly_review:
        print(json.dumps(weekly_review(vault)))
        return 0
    if ns.waiting_action:
        print(json.dumps(waiting_action(vault, *ns.waiting_action)))
        return 0
    if ns.clear_activity:
        print(json.dumps(clear_activity(vault)))
        return 0
    if ns.approve:
        print(json.dumps(approve(vault, *ns.approve)))
        return 0
    if ns.record_reschedule:
        ident, old, new, source = ns.record_reschedule
        record_reschedule(vault, ident, old or None, new or None, source)
        print(json.dumps({"ok": True}))
        return 0
    parser.error("choose --triage, --waiting-dashboard, --weekly-review, --waiting-action, --clear-activity, or --record-reschedule")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
