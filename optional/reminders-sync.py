#!/usr/bin/env python3
"""Local, opt-in two-way bridge between an Obsidian task inbox and Reminders.

The bridge deliberately has a small JSON protocol. Uptick owns configuration in
.obsidian/plugins/life-os/data.json; this process owns the private link state.
No IDs or source paths are written into reminder titles or notes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    from llm import Provider, LlmError
except ImportError:  # pragma: no cover - standalone test harnesses
    Provider = None  # type: ignore[assignment]
    LlmError = RuntimeError  # type: ignore[assignment,misc]

REMINDCTL = os.environ.get("REMINDCTL") or shutil.which("remindctl") or "/opt/homebrew/bin/remindctl"
DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    "enabled": False,
    "inboxList": "Inbox",
    "quickWinsList": "Quick Wins",
    "quickWinsFilter": {
        "enabled": True,
        "durationTags": ["#10min", "#10-minute"],
        "includePastDue": True,
        "includeCompleted": False,
        "excludeLists": ["Waiting", "Repeat"],
    },
    "waitingList": "Waiting",
    "excludedLists": ["Repeat"],
    "routes": [
        {"tag": "#work", "list": "Work", "listId": ""},
        {"tag": "#personal", "list": "Personal", "listId": ""},
        {"tag": "#house", "list": "House", "listId": ""},
    ],
    "autoIntake": {"enabled": True, "aiEnabled": True, "minConfidence": "high"},
    "maxCreatesPerRun": 50,
    "categoryInference": {
        # These are deliberately narrow, high-confidence signals. The bridge
        # never sends task text to an AI service and leaves ties in Inbox.
        "enabled": True,
        "minMatches": 1,
        "cues": {
            "#work": [
                "salesforce", "mulesoft", "azure", "workday", "sharepoint",
                "crm", "jira", "sprint", "rollout", "release notes", "sso",
                "client", "integration", "trailhead", "all hands",
            ],
            "#personal": [
                "therapy", "counseling", "therapist", "doctor", "nurse",
                "medical", "health", "prayer", "retreat", "relationship",
                "couples", "family", "medication",
            ],
            "#house": [
                "grocery", "groceries", "trash", "laundry", "dishwasher",
                "dishes", "dog", "pet", "household", "home repair", "lawn",
                "garden", "utilities",
            ],
        },
        "phoneCues": ["self-port cli", "codex", "email", "text", "call", "message"],
        "notPhoneCues": ["deploy", "deployment", "install", "xcode", "in person"],
    },
    "tags": {
        "notStarted": "#not-started", "inProgress": "#in-progress",
        "blocked": "#blocked", "dependency": "#dependency",
        "needsTriage": "#needs-triage", "duration10": "#10min",
        "duration20": "#20min", "duration30": "#30min", "onPhone": "#on-phone",
        "followUp": "#follow-up",
    },
    "priorityMap": {"highest": 1, "high": 3, "medium": 5, "low": 8},
    "mail": {"enabled": False, "shortcutName": "Open Obsidian Task Email"},
    "statePath": "4 System/Automation/reminders-sync-state.json",
    "conflictResolution": "reminders-wins",
    "workflowAssistant": {
        "enabled": False,
        "waiting": {"followUpTag": "#follow-up"},
        "activity": {"enabled": True, "retention": "permanent"},
    },
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def descendant_ids(tasks: dict[str, dict[str, Any]], parent_id: str) -> set[str]:
    """Return every descendant so nested Obsidian/native Reminder trees close together."""
    found: set[str] = set()
    frontier = [parent_id]
    while frontier:
        current = frontier.pop()
        children = [ident for ident, candidate in tasks.items()
                    if candidate.get("parentId") == current and ident not in found]
        found.update(children)
        frontier.extend(children)
    return found


def run_json(args: list[str], timeout: int = 30) -> Any:
    # AppleScript/SQLite text can contain a NUL; never pass that byte to exec.
    args = [str(value).replace("\x00", "") for value in args]
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        if p.returncode != 0:
            return {"error": (p.stderr or p.stdout or f"exit {p.returncode}").strip()}
        return json.loads(p.stdout or "null")
    except FileNotFoundError:
        return {"error": f"remindctl not found at {REMINDCTL}"}
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return {"error": str(exc)}


def merge(base: dict[str, Any], over: Any) -> dict[str, Any]:
    out = dict(base)
    if not isinstance(over, dict):
        return out
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(vault: Path) -> dict[str, Any]:
    path = vault / ".obsidian/plugins/life-os/data.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        config = raw.get("config", {}) if isinstance(raw, dict) else {}
        result = merge(DEFAULT_CONFIG, config.get("reminders", {}))
        result["_workflowAssistant"] = config.get("workflowAssistant", {})
        return result
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_CONFIG)


def validate_config(cfg: dict[str, Any]) -> list[str]:
    """Return actionable configuration errors before any Reminders writes."""
    errors: list[str] = []
    routes = cfg.get("routes") if isinstance(cfg.get("routes"), list) else []
    route_tags: set[str] = set()
    for route in routes:
        if not isinstance(route, dict):
            errors.append("Each category route must be an object.")
            continue
        tag = str(route.get("tag") or "").strip().lower()
        list_name = str(route.get("list") or "").strip()
        if not re.fullmatch(r"#[a-z0-9][a-z0-9-]*", tag) or not list_name:
            errors.append("Each category route needs a valid #tag and list name.")
        if tag in route_tags:
            errors.append(f"Duplicate category route tag: {tag}")
        route_tags.add(tag)
    tags = cfg.get("tags") if isinstance(cfg.get("tags"), dict) else {}
    managed = ("notStarted", "inProgress", "blocked", "dependency", "needsTriage",
               "duration10", "duration20", "duration30", "onPhone", "followUp")
    seen: set[str] = set()
    for key in managed:
        tag = str(tags.get(key) or "").strip().lower()
        if not re.fullmatch(r"#[a-z0-9][a-z0-9-]*", tag):
            errors.append(f"Invalid {key} tag.")
        if tag in seen:
            errors.append(f"Duplicate managed tag: {tag}")
        seen.add(tag)
    required_lists = ("inboxList", "waitingList")
    if cfg.get("enabled") and any(not str(cfg.get(key) or "").strip() for key in required_lists):
        errors.append("Enabled sync needs Inbox and Waiting lists.")
    quick_filter = cfg.get("quickWinsFilter") if isinstance(cfg.get("quickWinsFilter"), dict) else {}
    if cfg.get("enabled") and not quick_filter.get("enabled", True) and not str(cfg.get("quickWinsList") or "").strip():
        errors.append("A physical Quick Wins list is required when the derived filter is disabled.")
    configured_names = [target["name"] for target in configured_lists(cfg)]
    if len(configured_names) != len(set(configured_names)):
        errors.append("Synced Reminders list names must be unique.")
    if any(name.lower() == "repeat" for name in configured_names):
        errors.append("Repeat is Apple-only and cannot be a synced list.")
    if cfg.get("conflictResolution") != "reminders-wins":
        errors.append("Only conflictResolution=reminders-wins is supported.")
    return list(dict.fromkeys(errors))


def state_path(vault: Path, cfg: dict[str, Any]) -> Path:
    path = Path(str(cfg.get("statePath") or DEFAULT_CONFIG["statePath"]))
    return path if path.is_absolute() else vault / path


def load_state(vault: Path, cfg: dict[str, Any]) -> dict[str, Any]:
    try:
        value = json.loads(state_path(vault, cfg).read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            return {}
        workflow = value.setdefault("workflow", {})
        if isinstance(workflow, dict):
            workflow.setdefault("triageQueue", {})
            workflow.setdefault("learning", [])
            workflow.setdefault("reschedules", {})
            workflow.setdefault("activity", [])
            workflow.setdefault("emailParents", {})
            workflow.setdefault("waiting", {})
        value.setdefault("tombstones", {})
        value.setdefault("links", {})
        return value
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "links": {}, "tombstones": {}, "lastSyncAt": None}


def save_state(vault: Path, cfg: dict[str, Any], state: dict[str, Any]) -> None:
    path = state_path(vault, cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def email_url_for_task(state: dict[str, Any], task_id: str) -> str:
    """Resolve a private email capture link without putting the locator in task text."""
    workflow = state.get("workflow", {}) if isinstance(state, dict) else {}
    parents = workflow.get("emailParents", {}) if isinstance(workflow, dict) else {}
    for record in parents.values() if isinstance(parents, dict) else []:
        if not isinstance(record, dict):
            continue
        if record.get("parentId") == task_id or task_id in (record.get("childIds") or []):
            return str(record.get("url") or "")
    links = workflow.get("emailLinks", {}) if isinstance(workflow, dict) else {}
    return str(links.get(task_id) or "") if isinstance(links, dict) else ""


def activity(state: dict[str, Any], kind: str, **fields: Any) -> None:
    workflow = state.setdefault("workflow", {})
    workflow.setdefault("activity", []).append({"at": now(), "kind": kind, **fields})


def reschedule(state: dict[str, Any], task_id: str, old: Any, new: Any, source: str) -> None:
    if old is None or old == new:
        return
    state.setdefault("workflow", {}).setdefault("reschedules", {}).setdefault(task_id, []).append(
        {"at": now(), "old": old, "new": new, "source": source, "reason": ""}
    )


def list_records() -> list[dict[str, Any]]:
    result = run_json([REMINDCTL, "list", "--json"])
    return result if isinstance(result, list) else []


def authorization_status() -> dict[str, Any]:
    value = run_json([REMINDCTL, "status", "--json"])
    return value if isinstance(value, dict) else {"error": "could not read Reminders authorization"}


def configured_lists(cfg: dict[str, Any]) -> list[dict[str, str]]:
    values = []
    for key in ("inboxList", "quickWinsList", "waitingList"):
        if cfg.get(key):
            values.append({"name": str(cfg[key]), "id": str(cfg.get(key + "Id") or "")})
    for route in cfg.get("routes", []):
        if isinstance(route, dict) and route.get("list"):
            values.append({"name": str(route["list"]), "id": str(route.get("listId") or "")})
    unique: dict[str, dict[str, str]] = {v["name"]: v for v in values}
    return list(unique.values())


def reminders_for(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for target in configured_lists(cfg):
        args = [REMINDCTL, "list", "--json"]
        if target["id"]:
            args += ["--list-id", target["id"]]
        else:
            args += [target["name"]]
        value = run_json(args)
        if isinstance(value, list):
            found.extend(value)
    return found


def reminder_snapshot(cfg: dict[str, Any]) -> dict[str, Any]:
    """Read every managed list and Repeat as a safety boundary.

    Repeat is never projected or edited. It is read only so moving a linked
    reminder into the Apple-only list cannot be mistaken for a deletion.
    """
    rows: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    failed: list[str] = []
    for target in configured_lists(cfg):
        args = [REMINDCTL, "list", "--json"]
        args += (["--list-id", target["id"]] if target["id"] else [target["name"]])
        value = run_json(args)
        if isinstance(value, list):
            rows.extend(value)
        else:
            failed.append(target["name"])
    for name in cfg.get("excludedLists", ["Repeat"]):
        if not str(name).strip():
            continue
        value = run_json([REMINDCTL, "list", "--json", str(name)])
        if isinstance(value, list):
            excluded.extend(value)
        else:
            failed.append(str(name))
    return {"rows": rows, "excluded": excluded, "failed": failed,
            "complete": not failed}


def clean_title(value: str) -> str:
    value = re.sub(r"^\s*20\d{2}-\d{2}-\d{2}\s*-\s*[^:]{18,}:\s*", "", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"\s+#[-\w]+", "", value)
    value = re.sub(r"\s*\^task[-\w]+", "", value)
    value = re.sub(r"\[\[(?:[^\]|]+)(?:\|[^\]]+)?\]\]", "", value)
    value = re.sub(r"\[(?:priority|difficulty|ticket)::[^\]]*\]", "", value)
    value = re.sub(r"\[(?:follow-up|waiting-since)::[^\]]*\]", "", value, flags=re.I)
    value = re.sub(r"\s*📅\s*20\d{2}-\d{2}-\d{2}", "", value)
    value = re.sub(r"[⏫🔼🔽⏬🔺]", "", value)
    value = re.sub(r"\s+\([^)]{1,80}\)\s*$", "", value)
    value = re.sub(r"\s+", " ", value).strip(" .;:-")
    return value[:240]


def tag_tokens(value: str) -> list[str]:
    return re.findall(r"(?<!\w)#[\w-]+", value or "")


def _normalized_tag(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower().lstrip("#"))


def quick_wins_filter(cfg: dict[str, Any]) -> dict[str, Any]:
    value = cfg.get("quickWinsFilter") if isinstance(cfg.get("quickWinsFilter"), dict) else {}
    tags = value.get("durationTags")
    if not isinstance(tags, list) or not tags:
        tags = [str(cfg.get("tags", {}).get("duration10", "#10min")), "#10-minute"]
    excludes = value.get("excludeLists")
    if not isinstance(excludes, list):
        excludes = []
    excludes = list(dict.fromkeys(str(item).strip().lower() for item in excludes if str(item).strip()))
    waiting = str(cfg.get("waitingList") or "Waiting").strip().lower()
    if waiting and waiting not in excludes:
        excludes.append(waiting)
    for item in (cfg.get("excludedLists") or ["Repeat"]):
        normalized = str(item or "").strip().lower()
        if normalized and normalized not in excludes:
            excludes.append(normalized)
    return {
        "enabled": bool(value.get("enabled", True)),
        "durationTags": list(dict.fromkeys(str(item).strip() for item in tags if str(item).strip())),
        "includePastDue": bool(value.get("includePastDue", True)),
        "includeCompleted": bool(value.get("includeCompleted", False)),
        "excludeLists": excludes,
    }


def reminder_local_due_date(reminder: dict[str, Any]) -> dt.date | None:
    value = reminder.get("dueDate") or reminder.get("due")
    if not value:
        return None
    text = str(value).strip()
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            return dt.date.fromisoformat(text[:10])
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone()
    return parsed.date()


def has_quick_wins_duration_tag(reminder: dict[str, Any], cfg: dict[str, Any]) -> bool:
    text = " ".join(str(reminder.get(key) or "") for key in ("title", "notes"))
    accepted = {_normalized_tag(tag) for tag in quick_wins_filter(cfg)["durationTags"]}
    tokens = {_normalized_tag(tag) for tag in tag_tokens(text)}
    if accepted.intersection(tokens):
        return True
    # Apple tag entry and human-authored notes sometimes spell the same tag as
    # "#10-minute" or "#10 min". Match those forms without treating ordinary
    # numbers such as 100 minutes as a ten-minute tag.
    return bool(re.search(r"(?<![\w#])#?10\s*-?\s*(?:min(?:ute)?s?)(?!\w)", text, re.I))


def is_quick_wins_candidate(reminder: dict[str, Any], cfg: dict[str, Any], today: dt.date | None = None) -> bool:
    """Return whether a reminder belongs in the derived Quick Wins view.

    This is deliberately a read-only projection. It never changes the
    reminder's owning Apple list and therefore cannot create duplicate items.
    """
    policy = quick_wins_filter(cfg)
    if not policy["enabled"]:
        return str(reminder.get("listName") or "").strip().lower() == str(cfg.get("quickWinsList") or "Quick Wins").strip().lower()
    list_name = str(reminder.get("listName") or "").strip().lower()
    if list_name in set(policy["excludeLists"]):
        return False
    if not policy["includeCompleted"] and bool(reminder.get("isCompleted") or reminder.get("completed")):
        return False
    if not has_quick_wins_duration_tag(reminder, cfg):
        return False
    due = reminder_local_due_date(reminder)
    if due is None:
        return False
    current = today or dt.date.today()
    return due <= current if policy["includePastDue"] else due == current


def quick_wins_candidates(reminders: list[dict[str, Any]], cfg: dict[str, Any], today: dt.date | None = None) -> list[dict[str, Any]]:
    """Build a stable, explainable Quick Wins projection from source lists."""
    candidates = [item for item in reminders if isinstance(item, dict) and is_quick_wins_candidate(item, cfg, today)]
    return sorted(candidates, key=lambda item: (
        reminder_local_due_date(item) or dt.date.max,
        str(item.get("title") or "").lower(),
        str(item.get("id") or ""),
    ))


def due_from_text(value: str) -> str | None:
    match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", value or "")
    return match.group(1) if match else None


def cue_values(value: Any) -> list[str]:
    """Normalize editable category cues without making config syntax fragile."""
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(
        item.strip().lower() for item in value
        if isinstance(item, str) and item.strip()
    ))


def cue_match(text: str, cue: str) -> bool:
    return bool(re.search(r"(?<![\w-])" + re.escape(cue) + r"(?![\w-])", text, re.I))


def inferred_route_tag(task: dict[str, Any], cfg: dict[str, Any], tags: list[str]) -> str:
    """Return one safe inferred category tag, or an empty string when unsure.

    Explicit category/status tags are authoritative. Inference is intentionally
    local and explainable: each configured cue is matched as a whole word or
    phrase, a category needs the configured minimum count, and a tie falls
    back to Inbox rather than making a silent category decision.
    """
    inference = cfg.get("categoryInference") if isinstance(cfg.get("categoryInference"), dict) else {}
    if not inference.get("enabled", True):
        return ""
    tags_lower = {tag.lower() for tag in tags}
    blocked = str(cfg["tags"].get("blocked", "#blocked")).lower()
    dependency = str(cfg["tags"].get("dependency", "#dependency")).lower()
    if blocked in tags_lower or dependency in tags_lower:
        return ""
    routes = [route for route in cfg.get("routes", []) if isinstance(route, dict) and route.get("tag")]
    route_tags = {str(route["tag"]).lower() for route in routes}
    if route_tags.intersection(tags_lower):
        return ""
    try:
        minimum = max(1, int(inference.get("minMatches", 1)))
    except (TypeError, ValueError):
        minimum = 1
    cues = inference.get("cues") if isinstance(inference.get("cues"), dict) else {}
    source = "\n".join(str(task.get(key) or "") for key in ("raw", "text", "details"))
    scores: list[tuple[int, str]] = []
    for route in routes:
        tag = str(route["tag"])
        values = cue_values(cues.get(tag, cues.get(tag.lower(), [])))
        score = sum(1 for cue in values if cue_match(source, cue))
        if score:
            scores.append((score, tag))
    if not scores:
        return ""
    scores.sort(reverse=True)
    best_score, best_tag = scores[0]
    if best_score < minimum or len(scores) > 1 and scores[1][0] == best_score:
        return ""
    return best_tag


def route_for(tags: list[str], cfg: dict[str, Any]) -> dict[str, str]:
    tags_lower = {tag.lower() for tag in tags}
    blocked = str(cfg["tags"].get("blocked", "#blocked")).lower()
    dependency = str(cfg["tags"].get("dependency", "#dependency")).lower()
    if blocked in tags_lower or dependency in tags_lower:
        return {"name": str(cfg.get("waitingList") or "Waiting"), "id": "", "status": dependency if dependency in tags_lower else blocked}
    for route in cfg.get("routes", []):
        if isinstance(route, dict) and str(route.get("tag", "")).lower() in tags_lower:
            return {"name": str(route.get("list") or "Inbox"), "id": str(route.get("listId") or ""), "status": ""}
    return {"name": str(cfg.get("inboxList") or "Inbox"), "id": "", "status": str(cfg["tags"].get("needsTriage", "#needs-triage"))}


def effective_tags(task: dict[str, Any], cfg: dict[str, Any], category_hint: str = "") -> list[str]:
    # `text` is the cleaned display title; route from the raw task body so
    # category/status tags survive title normalization.
    tags = tag_tokens(task.get("raw", task.get("text", "")))
    known = cfg["tags"]
    inferred = inferred_route_tag(task, cfg, tags)
    if not inferred and category_hint:
        route_tags = {
            str(route.get("tag") or "").lower()
            for route in cfg.get("routes", []) if isinstance(route, dict)
        }
        tags_lower = {tag.lower() for tag in tags}
        blocked = str(known["blocked"]).lower()
        dependency = str(known["dependency"]).lower()
        hint = category_hint.strip().lower()
        if hint in route_tags and not route_tags.intersection(tags_lower) and blocked not in tags_lower and dependency not in tags_lower:
            inferred = hint
    if inferred:
        triage = str(known["needsTriage"]).lower()
        tags = [tag for tag in tags if tag.lower() != triage]
        tags.append(inferred)
    durations = [str(known[k]) for k in ("duration10", "duration20", "duration30")]
    selected = [tag for tag in tags if tag in durations]
    if not selected:
        difficulty = int(task.get("difficulty") or 3)
        selected = [str(known["duration10"] if difficulty <= 2 else known["duration20"] if difficulty == 3 else known["duration30"])]
    status_tags = [str(known["notStarted"]), str(known["inProgress"])]
    was_in_progress = str(known["inProgress"]) in tags
    tags = [tag for tag in tags if tag not in durations and tag not in status_tags] + selected[:1]
    if not task.get("completed"):
        blocked = str(known["blocked"])
        dependency = str(known["dependency"])
        tags.append(str(known["inProgress"]) if was_in_progress and blocked not in tags and dependency not in tags
                    else str(known["notStarted"]) if blocked not in tags and dependency not in tags else blocked)
    return list(dict.fromkeys(tags))


def projection_from_task(task: dict[str, Any], cfg: dict[str, Any], category_hint: str = "") -> dict[str, Any]:
    tags = effective_tags(task, cfg, category_hint)
    route = route_for(tags, cfg)
    if route["status"] and route["status"] not in tags:
        tags = sorted(set(tags) | {route["status"]})
    if route["name"] == str(cfg.get("waitingList") or "Waiting") and task.get("followUpDate"):
        follow_up_tag = str(cfg["tags"].get("followUp", "#follow-up"))
        if follow_up_tag not in tags:
            tags.append(follow_up_tag)
    due = task.get("due")
    if route["name"] == str(cfg.get("waitingList") or "Waiting") and task.get("followUpDate"):
        due = task["followUpDate"]
    title = clean_title(str(task.get("text") or "Task"))
    details = str(task.get("details") or "").strip()
    mail_enabled = bool((cfg.get("mail") or {}).get("enabled"))
    return {"title": title, "details": details, "due": task.get("due") or due,
            "reminderDue": due,
            "followUpDate": task.get("followUpDate"), "waitingSince": task.get("waitingSince"),
            "list": route["name"], "tags": sorted(tags),
            "priority": str(task.get("priority") or "medium"), "flagged": bool(task.get("flagged")),
            "completed": bool(task.get("completed")), "url": str(task.get("url") or "") if mail_enabled else ""}


def peer_category_hints(tasks: dict[str, dict[str, Any]], cfg: dict[str, Any]) -> dict[str, str]:
    """Reuse an unambiguous sibling's category for exact duplicate titles.

    Imported notes occasionally yield a detailed task and a short duplicate.
    When the detailed task has an explicit or high-confidence category, copying
    that category to its exact-title sibling is safer than guessing from a
    person's name or a generic verb. Conflicting categories deliberately yield
    no hint.
    """
    route_tags = {
        str(route.get("tag") or "").lower()
        for route in cfg.get("routes", []) if isinstance(route, dict) and route.get("tag")
    }
    by_title: dict[str, set[str]] = {}
    for task in tasks.values():
        if task.get("completed"):
            continue
        category_tags = route_tags.intersection(tag.lower() for tag in effective_tags(task, cfg))
        if len(category_tags) == 1:
            by_title.setdefault(str(task.get("text") or "").lower(), set()).update(category_tags)
    return {title: next(iter(tags)) for title, tags in by_title.items() if len(tags) == 1}


def projection_from_reminder(reminder: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    notes = str(reminder.get("notes") or "")
    tags = tag_tokens(notes)
    list_name = str(reminder.get("listName") or "Inbox")
    configured_route_tags = {str(route.get("tag") or "").lower() for route in cfg.get("routes", []) if isinstance(route, dict)}
    if list_name not in {str(cfg.get("inboxList") or "Inbox"), str(cfg.get("quickWinsList") or "Quick Wins")}:
        tags = [tag for tag in tags if tag.lower() not in configured_route_tags]
    route_tags = set()
    for route in cfg.get("routes", []):
        if isinstance(route, dict) and str(route.get("list") or "") == list_name:
            route_tag = str(route.get("tag") or "")
            tags.append(route_tag)
            route_tags.add(route_tag.lower())
    if list_name == str(cfg.get("quickWinsList") or "Quick Wins"):
        quick = "#quick-win"
        if quick not in tags:
            tags.append(quick)
        if str(cfg["tags"].get("duration10", "#10min")) not in tags:
            tags.append(str(cfg["tags"].get("duration10", "#10min")))
    elif list_name == str(cfg.get("waitingList") or "Waiting"):
        blocked = str(cfg["tags"].get("blocked", "#blocked"))
        dependency = str(cfg["tags"].get("dependency", "#dependency"))
        if blocked not in tags and dependency not in tags:
            tags.append(blocked)
        follow_up = str(cfg["tags"].get("followUp", "#follow-up"))
        if follow_up not in tags:
            tags.append(follow_up)
    elif list_name == str(cfg.get("inboxList") or "Inbox"):
        triage = str(cfg["tags"].get("needsTriage", "#needs-triage"))
        if not route_tags.intersection(tag.lower() for tag in tags) and triage not in tags:
            tags.append(triage)
    details = re.sub(r"(?<!\w)#[\w-]+", "", notes)
    if "obsidian_task_id=" in notes:
        details = ""  # legacy internal metadata is migrated out of Notes
    due = str(reminder.get("dueDate") or "")[:10] or None
    tags = sorted(set(filter(None, tags)))
    duration_values = [str(cfg["tags"].get(key, "")) for key in ("duration10", "duration20", "duration30")]
    existing_durations = [tag for tag in duration_values if tag in tags]
    tags = [tag for tag in tags if tag not in duration_values]
    tags.append(existing_durations[0] if existing_durations else str(cfg["tags"].get("duration20", "#20min")))
    mail_enabled = bool((cfg.get("mail") or {}).get("enabled"))
    waiting = list_name == str(cfg.get("waitingList") or "Waiting")
    return {"title": clean_title(str(reminder.get("title") or "Task")), "details": details.strip(),
            "due": due, "reminderDue": due, "followUpDate": due if waiting else None, "waitingSince": None,
            "list": list_name, "tags": sorted(set(filter(None, tags))),
            "priority": str(reminder.get("priority") or "none"), "flagged": bool(reminder.get("isFlagged")),
            "completed": bool(reminder.get("isCompleted")), "url": str(reminder.get("url") or "") if mail_enabled else ""}


def parse_tasks(text: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    lines = text.splitlines()
    stack: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = re.match(r"^(\s*)- \[([ xX])\]\s+(.+?)(?:\s+\^((?:task|reminder)-[\w-]+))?\s*$", line)
        if not match:
            continue
        task_id = match.group(4)
        if not task_id:
            continue
        indent = len(match.group(1).expandtabs(2))
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent_id = stack[-1][1] if stack else None
        stack.append((indent, task_id))
        body = match.group(3)
        details = ""
        if index + 1 < len(lines):
            child = re.match(r"^\s{2,}(?:[-*]\s+)?Details:\s*(.*)$", lines[index + 1], re.I)
            if child:
                details = child.group(1).strip()
        difficulty_match = re.search(r"\[difficulty::\s*(\d+)\]", body, re.I)
        url_match = re.search(r"(?:message|x-apple-data-detectors)://[^\s)\]]+", body)
        follow = re.search(r"\[follow-up::\s*(20\d{2}-\d{2}-\d{2})\s*\]", body, re.I)
        waiting_since = re.search(r"\[waiting-since::\s*(20\d{2}-\d{2}-\d{2})\s*\]", body, re.I)
        result[task_id] = {"id": task_id, "line": line, "lineIndex": index, "parentId": parent_id,
                           "raw": body, "text": clean_title(body), "details": details,
                           "due": due_from_text(body), "followUpDate": follow.group(1) if follow else None,
                           "waitingSince": waiting_since.group(1) if waiting_since else None,
                           "completed": match.group(2).lower() == "x",
                           "difficulty": int(difficulty_match.group(1)) if difficulty_match else 3,
                           "priority": "high" if "⏫" in body or "🔺" in body else "low" if "🔽" in body else "medium",
                           "flagged": "🔺" in body, "url": url_match.group(0) if url_match else ""}
    return result


def prepare_waiting_metadata(tasks: dict[str, dict[str, Any]], cfg: dict[str, Any]) -> None:
    assistant = cfg.get("_workflowAssistant") if isinstance(cfg.get("_workflowAssistant"), dict) else {}
    waiting_cfg = assistant.get("waiting") if isinstance(assistant.get("waiting"), dict) else {}
    if assistant and assistant.get("enabled") is False:
        return
    try:
        days = max(1, int(waiting_cfg.get("defaultDays", 7)))
    except (TypeError, ValueError):
        days = 7
    today = dt.date.today()
    blocked = str(cfg["tags"].get("blocked", "#blocked")).lower()
    dependency = str(cfg["tags"].get("dependency", "#dependency")).lower()
    for task in tasks.values():
        tagset = {str(tag).lower() for tag in task.get("tags", [])}
        is_waiting = blocked in tagset or dependency in tagset
        if is_waiting and not task.get("followUpDate"):
            task["followUpDate"] = (today + dt.timedelta(days=days)).isoformat()
        if is_waiting and not task.get("waitingSince"):
            task["waitingSince"] = today.isoformat()
        if not is_waiting and task.get("followUpDate"):
            task["followUpDate"] = None
            task["waitingSince"] = None


def task_id_for(reminder_id: str) -> str:
    return "task-reminder-" + hashlib.sha256(reminder_id.encode()).hexdigest()[:12]


def list_id_for(reminder: dict[str, Any], cfg: dict[str, Any]) -> str:
    current = str(reminder.get("listName") or "")
    for target in configured_lists(cfg):
        if target["name"] == current and target["id"]:
            return target["id"]
    return current


def command(args: list[str], dry_run: bool = False) -> dict[str, Any]:
    value = run_json(args)
    return value if isinstance(value, dict) else {"value": value}


def render_task(task_id: str, projection: dict[str, Any], original: str | None = None) -> str:
    marker = "x" if projection.get("completed") else " "
    priority = {"high": "⏫", "medium": "🔼", "low": "🔽"}.get(str(projection.get("priority") or "medium"), "")
    if projection.get("flagged"):
        priority = "🔺"
    tags = " ".join(sorted(set(projection.get("tags") or [])))
    suffix = f" 📅 {projection['due']}" if projection.get("due") else ""
    preserved = ""
    if original:
        tokens = re.findall(r"\[\[[^\]]+\]\]|\[(?:priority|difficulty|ticket)::[^\]]+\]", original)
        preserved = (" " + " ".join(dict.fromkeys(tokens))) if tokens else ""
    workflow = []
    if projection.get("followUpDate"):
        workflow.append(f"[follow-up:: {projection['followUpDate']}]")
    if projection.get("waitingSince"):
        workflow.append(f"[waiting-since:: {projection['waitingSince']}]")
    metadata = " " + " ".join(workflow) if workflow else ""
    return f"- [{marker}] {priority + ' ' if priority else ''}{projection.get('title') or 'Task'}{suffix}{(' ' + tags) if tags else ''}{metadata}{preserved} ^{task_id}"


def reminder_notes(projection: dict[str, Any]) -> str:
    details = str(projection.get("details") or "").strip()
    tags = " ".join(sorted(set(projection.get("tags") or [])))
    return (details + ("\n" if details and tags else "") + tags).strip()


def parse_flag_values(value: str) -> dict[str, bool]:
    """Parse the small ID/flag table returned by the local AppleScript."""
    flags: dict[str, bool] = {}
    for line in value.splitlines():
        reminder_id, separator, flag = line.partition("\t")
        if separator and reminder_id:
            flags[reminder_id] = flag.strip().lower() == "true"
    return flags


def reminder_flags(reminder_ids: list[str]) -> dict[str, bool]:
    """Read Apple-only flag state for already-configured reminders.

    `remindctl` deliberately omits the flag field from its JSON. Reading it in
    one local AppleScript call preserves two-way flag sync without treating
    every flagged reminder as changed on each scheduled run.
    """
    script = Path(__file__).with_name("reminders-flag.applescript")
    if not script.exists() or not reminder_ids:
        return {}
    try:
        result = subprocess.run(["/usr/bin/osascript", str(script), "--read", *reminder_ids],
                                capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    return parse_flag_values(result.stdout) if result.returncode == 0 else {}


def set_flags(values: dict[str, bool]) -> None:
    """Apply changed flags in one AppleScript pass instead of one pass each."""
    if not values:
        return
    script = Path(__file__).with_name("reminders-flag.applescript")
    if not script.exists():
        return
    args = ["/usr/bin/osascript", str(script), "--set"]
    for reminder_id, flagged in values.items():
        args.extend([reminder_id, "true" if flagged else "false"])
    try:
        subprocess.run(args,
                       capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass


def edit_reminder(reminder_id: str, projection: dict[str, Any], dry_run: bool) -> None:
    if dry_run:
        return
    args = [REMINDCTL, "edit", reminder_id, "--title", str(projection.get("title") or "Task"),
            "--list", str(projection.get("list") or "Inbox"),
            "--notes", reminder_notes(projection)]
    reminder_due = projection.get("reminderDue") or projection.get("due")
    if reminder_due:
        args += ["--due", str(reminder_due)]
    if projection.get("priority") in {"low", "medium", "high"}:
        args += ["--priority", str(projection["priority"])]
    if projection.get("url"):
        args += ["--url", str(projection["url"])]
    else:
        args += ["--clear-url"]
    args += ["--complete" if projection.get("completed") else "--incomplete"]
    command(args)


def add_reminder(projection: dict[str, Any], dry_run: bool) -> dict[str, Any] | None:
    if dry_run:
        return None
    args = [REMINDCTL, "add", str(projection.get("title") or "Task"), "--list", str(projection.get("list") or "Inbox"),
            "--notes", reminder_notes(projection)]
    if projection.get("due"):
        args += ["--due", str(projection["due"])]
    if projection.get("priority") in {"low", "medium", "high"}:
        args += ["--priority", str(projection["priority"])]
    if projection.get("url"):
        args += ["--url", str(projection["url"])]
    args += ["--json"]
    value = command(args)
    if value.get("id"):
        set_flags({str(value["id"]): bool(projection.get("flagged"))})
        return value
    return None


def add_child_reminder(parent_id: str, projection: dict[str, Any], dry_run: bool) -> dict[str, Any] | None:
    if dry_run:
        return None
    script = Path(__file__).with_name("reminders-hierarchy.applescript")
    if not script.exists():
        return None
    try:
        result = subprocess.run(["/usr/bin/osascript", str(script), "--child", parent_id,
                                 str(projection.get("title") or "Task")],
                                capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    child_id = (result.stdout or "").strip()
    return {"id": child_id} if result.returncode == 0 and child_id else None


def run_email_completion(vault: Path, dry_run: bool) -> dict[str, Any]:
    """Process new Sent Mail before reconciliation so completion propagates now."""
    helper = Path(__file__).with_name("email-completion.py")
    if not helper.exists():
        return {"ok": True, "skipped": True, "reason": "email completion helper is not installed"}
    args = [sys.executable, str(helper), "--vault", str(vault), "--scan"]
    if dry_run:
        args.append("--dry-run")
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": str(exc)}
    try:
        value = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        value = {"ok": False, "error": (result.stderr or result.stdout or "email completion returned invalid JSON").strip()}
    if result.returncode and value.get("ok") is not False:
        value = {**value, "ok": False, "error": result.stderr.strip() or "email completion failed"}
    return value


def run_message_task_capture(vault: Path, dry_run: bool) -> dict[str, Any]:
    """Create new iMessage tasks before reading the Task Inbox projection."""
    helper = Path(__file__).with_name("messages-task-capture.py")
    if not helper.exists():
        return {"ok": True, "skipped": True, "reason": "iMessage task capture helper is not installed"}
    args = [sys.executable, str(helper), "--vault", str(vault), "--scan"]
    if dry_run:
        args.append("--dry-run")
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": str(exc)}
    try:
        value = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        value = {"ok": False, "error": (result.stderr or result.stdout or "iMessage capture returned invalid JSON").strip()}
    if result.returncode and value.get("ok") is not False:
        value = {**value, "ok": False, "error": result.stderr.strip() or "iMessage capture failed"}
    return value


def prune_tombstones(state: dict[str, Any]) -> None:
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
    tombstones = state.setdefault("tombstones", {})
    for task_id, record in list(tombstones.items()):
        try:
            stamp = dt.datetime.fromisoformat(str(record.get("deletedAt", "")).replace("Z", "+00:00"))
        except (TypeError, ValueError, AttributeError):
            stamp = cutoff
        if stamp < cutoff:
            tombstones.pop(task_id, None)


def deletion_candidates(tasks: dict[str, dict[str, Any]], links: dict[str, Any],
                        reminders: dict[str, Any], excluded_ids: set[str],
                        snapshot_complete: bool) -> list[str]:
    if not snapshot_complete:
        return []
    result: list[str] = []
    for task_id, link in links.items():
        rid = str(link.get("reminderId") or "") if isinstance(link, dict) else ""
        if not rid or rid in reminders or rid in excluded_ids or task_id not in tasks:
            continue
        result.append(task_id)
    return result


def remove_deleted_tasks(lines: list[str], tasks: dict[str, dict[str, Any]], links: dict[str, Any],
                         candidates: list[str], state: dict[str, Any], dry_run: bool) -> tuple[set[str], list[str]]:
    """Remove only bridge-owned open tasks; hold manual hierarchies for review."""
    removed: set[str] = set()
    held: list[str] = []
    indexes: set[int] = set()
    for task_id in candidates:
        task = tasks.get(task_id)
        if not task:
            continue
        descendants = descendant_ids(tasks, task_id)
        manual_children = [child for child in descendants
                           if not links.get(child, {}).get("reminderId")
                           or links.get(child, {}).get("origin", "markdown") == "markdown"]
        if manual_children:
            held.append(task_id)
            activity(state, "reminder-deletion-review", task=task_id, reason="manual child content")
            continue
        ids = {task_id} | descendants
        for ident in ids:
            candidate = tasks.get(ident)
            if not candidate:
                continue
            if candidate.get("completed"):
                # Completed Markdown history remains, but the link is tombstoned
                # so the missing native item is never recreated.
                removed.add(ident)
                continue
            indexes.add(int(candidate["lineIndex"]))
            link = links.get(ident, {})
            details_idx = int(candidate["lineIndex"]) + 1
            if link.get("detailsManaged") and details_idx < len(lines) and re.match(r"^\s{2,}(?:[-*]\s+)?Details:", lines[details_idx], re.I):
                indexes.add(details_idx)
            removed.add(ident)
        activity(state, "reminder-deleted", task=task_id, reminderId=links.get(task_id, {}).get("reminderId"),
                 preserved=bool(task.get("completed")))
    if not dry_run:
        for index in sorted(indexes, reverse=True):
            if index < len(lines):
                lines.pop(index)
    for task_id in removed:
        link = links.pop(task_id, {})
        rid = str(link.get("reminderId") or "")
        state.setdefault("tombstones", {})[task_id] = {
            "taskId": task_id, "reminderId": rid, "deletedAt": now(),
            "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)).isoformat().replace("+00:00", "Z"),
            "list": link.get("projection", {}).get("list"), "restorable": True,
            "preserveTask": bool(tasks.get(task_id, {}).get("completed")),
            "projection": link.get("projection", {}),
        }
    return removed, held


def incoming_intake(projection: dict[str, Any], cfg: dict[str, Any], vault: Path | None = None,
                    state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Deterministic, explainable intake cleanup; model rewording is optional."""
    if projection.get("list") not in {str(cfg.get("inboxList") or "Inbox"), str(cfg.get("quickWinsList") or "Quick Wins")}:
        return projection
    text = f"{projection.get('title', '')} {projection.get('details', '')}"
    task = {"raw": text, "text": projection.get("title", ""), "details": projection.get("details", "")}
    inferred = inferred_route_tag(task, cfg, tag_tokens(text))
    if inferred:
        for route in cfg.get("routes", []):
            if isinstance(route, dict) and str(route.get("tag", "")).lower() == inferred.lower():
                projection["list"] = str(route.get("list") or projection["list"])
                projection["tags"] = sorted(set(projection.get("tags", [])) | {inferred})
                break
    if projection.get("list") == str(cfg.get("quickWinsList") or "Quick Wins"):
        projection["tags"] = sorted(set(projection.get("tags", [])) | {"#quick-win", str(cfg["tags"].get("duration10", "#10min"))})
    if projection.get("list") == str(cfg.get("inboxList") or "Inbox") and not inferred:
        projection["tags"] = sorted(set(projection.get("tags", [])) | {str(cfg["tags"].get("needsTriage", "#needs-triage"))})
    auto = cfg.get("autoIntake") if isinstance(cfg.get("autoIntake"), dict) else {}
    if inferred and auto.get("enabled", True) and auto.get("aiEnabled", True) and vault and Provider:
        provider = Provider.load(vault)
        ready, _ = provider.preflight()
        if ready:
            prompt = json.dumps({"title": projection.get("title", ""), "details": projection.get("details", ""),
                                 "category": inferred, "instruction": "Return JSON with concise action title only; do not add dates or commitments."})
            try:
                raw = provider.complete(prompt, system="You clean task wording. Return only JSON: {\"title\": string}.", max_tokens=120)
                match = re.search(r"\{.*\}", raw, re.S)
                candidate = json.loads(match.group(0)) if match else {}
                title = clean_title(str(candidate.get("title") or ""))
                if title and len(title) <= 160 and not any(x in title.lower() for x in ("today", "tomorrow", "assign", "remind me")):
                    projection["title"] = title
                    if state is not None:
                        activity(state, "reminder-reworded", source="configured-provider", category=inferred)
            except (LlmError, OSError, json.JSONDecodeError, AttributeError, TypeError):
                if state is not None:
                    activity(state, "reminder-reword-skipped", source="configured-provider", reason="provider unavailable or invalid response")
    return projection


def restore_deletion(vault: Path, cfg: dict[str, Any], task_id: str, dry_run: bool) -> dict[str, Any]:
    state = load_state(vault, cfg)
    record = state.get("tombstones", {}).get(task_id)
    if not isinstance(record, dict) or not record.get("restorable"):
        return {"ok": False, "error": "No restorable deletion found for that task."}
    projection = dict(record.get("projection") or {})
    if not projection:
        return {"ok": False, "error": "Deletion record has no task projection."}
    created = add_reminder(projection, dry_run)
    if dry_run:
        return {"ok": True, "dryRun": True, "task": task_id}
    if not created:
        return {"ok": False, "error": "Could not recreate the Reminder."}
    data_path = vault / ".obsidian/plugins/life-os/data.json"
    try:
        raw = json.loads(data_path.read_text(encoding="utf-8"))
        task_path = Path(raw.get("config", {}).get("paths", {}).get("taskInbox", "2 Work/Tasks/Task Inbox.md"))
    except (OSError, json.JSONDecodeError):
        task_path = Path("2 Work/Tasks/Task Inbox.md")
    task_file = task_path if task_path.is_absolute() else vault / task_path
    text = task_file.read_text(encoding="utf-8") if task_file.exists() else "# Task Inbox\n"
    lines = text.splitlines()
    lines.append(render_task(task_id, projection))
    if projection.get("details"):
        lines.append(f"  Details: {projection['details']}")
    task_file.parent.mkdir(parents=True, exist_ok=True)
    task_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    state.setdefault("links", {})[task_id] = {"reminderId": created["id"], "projection": projection,
                                               "origin": "reminder", "detailsManaged": bool(projection.get("details")), "lastSyncAt": now()}
    state["tombstones"].pop(task_id, None)
    activity(state, "reminder-restored", task=task_id, reminderId=created["id"])
    save_state(vault, cfg, state)
    return {"ok": True, "restored": task_id, "reminderId": created["id"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--setup-recommended", action="store_true")
    parser.add_argument("--sync", action="store_true")
    parser.add_argument("--migrate-legacy", action="store_true",
                        help="clean and link existing legacy reminders without creating new ones")
    parser.add_argument("--restore-deletion", metavar="TASK_ID",
                        help="restore a private 30-day deletion tombstone")
    parser.add_argument("--dry-run", action="store_true")
    ns = parser.parse_args()
    vault = Path(ns.vault).expanduser().resolve()
    cfg = load_config(vault)
    if not Path(REMINDCTL).exists():
        print(json.dumps({"ok": False, "error": f"remindctl not found at {REMINDCTL}"}))
        return 2
    if ns.status:
        permission = authorization_status()
        if permission.get("error") or permission.get("authorized") is False:
            print(json.dumps({"ok": False, "remindctl": REMINDCTL, "permission": permission,
                              "error": permission.get("error") or "Reminders permission is not granted"}))
            return 2
        print(json.dumps({"ok": True, "remindctl": REMINDCTL, "permission": permission, "lists": list_records()}))
        return 0
    if ns.setup_recommended:
        permission = authorization_status()
        if not ns.dry_run and (permission.get("error") or permission.get("authorized") is False):
            print(json.dumps({"ok": False, "remindctl": REMINDCTL, "permission": permission,
                              "error": permission.get("error") or "Reminders permission is not granted"}))
            return 2
        existing = {str(item.get("name") or item.get("title") or ""): item for item in list_records() if isinstance(item, dict)}
        names = ["Inbox", "Waiting", "Work", "Personal", "House"]
        if not quick_wins_filter(cfg)["enabled"]:
            names.insert(1, "Quick Wins")
        created: list[str] = []
        lists: dict[str, dict[str, Any]] = {}
        for name in names:
            match = existing.get(name)
            if not match and not ns.dry_run:
                match = command([REMINDCTL, "list", name, "--create", "--json"])
                if not match.get("error"):
                    created.append(name)
            lists[name] = match if isinstance(match, dict) else {"name": name}
        print(json.dumps({"ok": True, "created": created, "lists": lists,
                          "quickWins": {"derived": quick_wins_filter(cfg)["enabled"]},
                          "dryRun": ns.dry_run}))
        return 0
    if ns.restore_deletion:
        print(json.dumps(restore_deletion(vault, cfg, ns.restore_deletion, ns.dry_run)))
        return 0
    if not ns.sync and not ns.migrate_legacy:
        print(json.dumps({"ok": False, "error": "choose --status, --setup-recommended, --sync, or --migrate-legacy"}))
        return 2
    if not cfg.get("enabled"):
        print(json.dumps({"ok": True, "skipped": True, "reason": "Reminders sync is disabled in Uptick settings"}))
        return 0
    config_errors = validate_config(cfg)
    if config_errors:
        print(json.dumps({"ok": False, "error": "Invalid Reminders configuration", "details": config_errors}))
        return 2
    inbox = vault / ".obsidian/plugins/life-os/data.json"
    try:
        raw = json.loads(inbox.read_text(encoding="utf-8"))
        task_path = Path(raw.get("config", {}).get("paths", {}).get("taskInbox", "2 Work/Tasks/Task Inbox.md"))
    except (OSError, json.JSONDecodeError):
        task_path = Path("2 Work/Tasks/Task Inbox.md")
    task_file = task_path if task_path.is_absolute() else vault / task_path
    message_task_capture = run_message_task_capture(vault, ns.dry_run) if ns.sync else {"ok": True, "skipped": True}
    email_completion = run_email_completion(vault, ns.dry_run) if ns.sync else {"ok": True, "skipped": True}
    if not email_completion.get("ok") and not email_completion.get("skipped"):
        # The Mail helper owns its own private error event. Reminders sync can
        # still reconcile safely when Mail is unavailable.
        email_completion = {**email_completion, "continued": True}
    text = task_file.read_text(encoding="utf-8") if task_file.exists() else "# Task Inbox\n"
    lines = text.splitlines()
    tasks = parse_tasks(text)
    prepare_waiting_metadata(tasks, cfg)
    category_hints = peer_category_hints(tasks, cfg)
    state = load_state(vault, cfg)
    prune_tombstones(state)
    snapshot = reminder_snapshot(cfg)
    reminder_rows = snapshot["rows"]
    derived_quick_wins = quick_wins_candidates(reminder_rows, cfg)
    list_ids = state.setdefault("listIds", {})
    for row in reminder_rows:
        name, list_id = str(row.get("listName") or ""), str(row.get("listID") or row.get("listId") or "")
        if name and list_id:
            list_ids[name] = list_id
    excluded_ids = {str(r.get("id")) for r in snapshot["excluded"] if r.get("id")}
    flags = reminder_flags([str(reminder.get("id")) for reminder in reminder_rows if reminder.get("id")])
    for reminder in reminder_rows:
        reminder_id = str(reminder.get("id") or "")
        if reminder_id in flags:
            reminder["isFlagged"] = flags[reminder_id]
    reminders = {str(r.get("id")): r for r in reminder_rows if r.get("id")}
    links = state.setdefault("links", {})
    changed = {"created": 0, "updated": 0, "imported": 0, "completed": 0,
               "moved": 0, "conflicts": 0, "skipped": 0, "errors": 0}
    changed["quickWins"] = len(derived_quick_wins)
    state.setdefault("workflow", {})["quickWins"] = {
        "derived": quick_wins_filter(cfg)["enabled"],
        "count": len(derived_quick_wins),
        "updatedAt": now(),
        "reminderIds": [str(item.get("id")) for item in derived_quick_wins if item.get("id")],
    }
    flag_updates: dict[str, bool] = {}
    forced_completed: set[str] = set()
    try:
        create_limit = max(0, int(cfg.get("maxCreatesPerRun", 50)))
    except (TypeError, ValueError):
        create_limit = 50

    # A missing ID is a deletion only after every managed list read succeeded.
    # Repeat IDs are explicitly excluded and therefore preserve their links.
    deleted_ids, held_deletions = remove_deleted_tasks(
        lines, tasks, links, deletion_candidates(tasks, links, reminders, excluded_ids, snapshot["complete"]), state, ns.dry_run
    )
    changed["deleted"] = len(deleted_ids)
    changed["deletionReview"] = len(held_deletions)

    edits: list[tuple[int, int, list[str]]] = []
    # Adopt legacy reminders by their old task ID before importing anything.
    # This turns the existing one-way records into links and prevents duplicate
    # Obsidian tasks during the first two-way run.
    for reminder_id, reminder in reminders.items():
        legacy = re.search(r"(?:^|\s)obsidian_task_id=([^\s]+)", str(reminder.get("notes") or ""))
        if not legacy or legacy.group(1) in links:
            continue
        task_id = legacy.group(1) if legacy.group(1) in tasks else None
        if task_id is None:
            title = clean_title(str(reminder.get("title") or ""))
            exact = [tid for tid, task in tasks.items() if title and title == task["text"]]
            matches = exact or [tid for tid, task in tasks.items()
                                if title and title in task["text"]]
            if len(matches) == 1:
                task_id = matches[0]
        if task_id:
            links[task_id] = {"reminderId": reminder_id, "legacy": True}
    # Adopt reminders created by an earlier bridge run that could not parse
    # the human-readable add output. Exact title/list matching prevents a
    # retry from duplicating those live reminders.
    claimed = {str(link.get("reminderId")) for link in links.values() if link.get("reminderId")}
    for task_id, task in tasks.items():
        if task_id in deleted_ids:
            continue
        if (task_id in links and links[task_id].get("reminderId")) or task.get("completed"):
            continue
        projection = projection_from_task(task, cfg, category_hints.get(str(task.get("text") or "").lower(), ""))
        candidates = [
            rid for rid, reminder in reminders.items()
            if rid not in claimed
            and clean_title(str(reminder.get("title") or "")) == projection["title"]
            and str(reminder.get("listName") or "Inbox") == projection["list"]
        ]
        if len(candidates) == 1:
            links[task_id] = {"reminderId": candidates[0], "recovered": True}
            claimed.add(candidates[0])
    for task_id, task in tasks.items():
        link = links.get(task_id, {})
        reminder = reminders.get(str(link.get("reminderId")))
        projection = projection_from_task(task, cfg, category_hints.get(str(task.get("text") or "").lower(), ""))
        if not projection.get("url"):
            projection["url"] = email_url_for_task(state, task_id)
        if not reminder:
            # Do not backfill historical completed vault tasks into Reminders.
            # Existing links still flow completion/reopening both ways below.
            if task.get("completed"):
                changed["skipped"] += 1
                continue
            if ns.migrate_legacy:
                continue
            if changed["created"] >= create_limit:
                changed["skipped"] += 1
                continue
            parent_link = links.get(str(task.get("parentId") or ""), {})
            parent_id = str(parent_link.get("reminderId") or "")
            created = add_child_reminder(parent_id, projection, ns.dry_run) if parent_id else None
            if not created:
                created = add_reminder(projection, ns.dry_run)
            if created:
                link["reminderId"] = created["id"]
                link["origin"] = "markdown"
                link["detailsManaged"] = False
                reminder = created
                reminders[str(created["id"])] = created
                changed["created"] += 1
            elif ns.dry_run:
                # Keep dry-run output useful without inventing a Reminders ID.
                changed["created"] += 1
                links[task_id] = {"reminderId": None, "projection": projection, "origin": "markdown", "detailsManaged": False, "lastSyncAt": now()}
                continue
            else:
                links[task_id] = {"reminderId": None, "projection": projection, "origin": "markdown", "detailsManaged": False, "lastSyncAt": now()}
                continue
        if not reminder:
            continue
        remote = projection_from_reminder(reminder, cfg)
        previous = link.get("projection", {})
        legacy_link = bool(link.get("legacy"))
        if legacy_link:
            # Legacy records contain implementation metadata and an old title
            # format. Keep the current vault task canonical, while retaining
            # the existing Reminders list as its category during migration.
            merged = dict(projection)
            merged["list"] = remote.get("list") or projection.get("list")
            route_tags = {
                str(route.get("tag")) for route in cfg.get("routes", [])
                if isinstance(route, dict) and route.get("tag")
            }
            merged["tags"] = sorted(set(projection.get("tags") or []) | set(remote.get("tags", [])) & route_tags)
            if merged["list"] == cfg.get("waitingList"):
                merged["tags"] = sorted(set(merged["tags"]) | {str(cfg["tags"].get("blocked", "#blocked"))})
        else:
            merged = {}
            due_source = "reconciled"
            if (previous.get("list") == str(cfg.get("waitingList") or "Waiting")
                    and remote.get("list") == str(cfg.get("waitingList") or "Waiting")
                    and previous.get("followUpDate") == remote.get("reminderDue")):
                # A Waiting reminder uses its single Apple due date for the
                # follow-up while the vault keeps the original commitment.
                remote["due"] = previous.get("due")
            elif (previous.get("list") == str(cfg.get("waitingList") or "Waiting")
                  and remote.get("list") != str(cfg.get("waitingList") or "Waiting")
                  and previous.get("due")):
                # Leaving Waiting restores the original commitment date. The
                # Waiting reminder's due date represented only its follow-up.
                remote["due"] = previous.get("due")
                remote["reminderDue"] = previous.get("due")
            for field in ("title", "details", "due", "reminderDue", "followUpDate",
                          "waitingSince", "list", "tags", "priority", "flagged",
                          "completed", "url"):
                local_value = projection.get(field)
                remote_value = remote.get(field)
                old_value = previous.get(field, local_value)
                remote_changed = remote_value != old_value
                local_changed = local_value != old_value
                # Independent fields merge. For a collision, the configured
                # reminders-wins policy deliberately selects the remote value.
                merged[field] = remote_value if remote_changed else local_value
                if remote_changed and local_changed:
                    changed["conflicts"] += 1
                    merged[field] = remote_value
                if field == "due":
                    if remote_changed:
                        due_source = "reminders"
                    elif local_changed:
                        due_source = "obsidian"
        # Route/status tags are derived from the selected list. Preserve the
        # Inbox safety marker even when an older state snapshot already had it
        # but the live reminder did not receive the prior repair.
        merged_tags = set(merged.get("tags") or [])
        route_names = {
            str(route.get("tag") or "").lower()
            for route in cfg.get("routes", [])
            if isinstance(route, dict) and route.get("tag")
        }
        if merged.get("list") == str(cfg.get("inboxList") or "Inbox"):
            if not any(tag.lower() in route_names for tag in merged_tags):
                merged_tags.add(str(cfg["tags"].get("needsTriage", "#needs-triage")))
        elif merged.get("list") == str(cfg.get("waitingList") or "Waiting"):
            blocked = str(cfg["tags"].get("blocked", "#blocked"))
            dependency = str(cfg["tags"].get("dependency", "#dependency"))
            if blocked not in merged_tags and dependency not in merged_tags:
                merged_tags.add(blocked)
        merged["tags"] = sorted(merged_tags)
        if merged.get("completed"):
            forced_completed.update(descendant_ids(tasks, task_id))
        if task_id in forced_completed:
            merged["completed"] = True
        if previous.get("list") and merged.get("list") != previous.get("list"):
            changed["moved"] = changed.get("moved", 0) + 1
        if previous.get("due") and merged.get("due") != previous.get("due"):
            reschedule(state, task_id, previous.get("due"), merged.get("due"), due_source)
        local_needs_update = merged != projection or set(tag_tokens(task.get("raw", ""))) != set(merged.get("tags") or [])
        persisted_remote_tags = set(tag_tokens(str(reminder.get("notes") or "")))
        remote_needs_update = (merged != remote
                               or persisted_remote_tags != set(merged.get("tags") or [])
                               or legacy_link)
        if local_needs_update:
            edits.append((task["lineIndex"], task["lineIndex"] + 1, [render_task(task_id, merged, task["line"])]))
            if merged.get("details") != task.get("details"):
                child_index = task["lineIndex"] + 1
                has_child = child_index < len(lines) and re.match(r"^\s{2,}(?:[-*]\s+)?Details:", lines[child_index], re.I)
                child = [f"  Details: {merged['details']}"] if merged.get("details") else []
                if has_child or child:
                    edits.append((child_index, child_index + (1 if has_child else 0), child))
            changed["updated"] += 1
            if merged.get("completed") != task.get("completed"):
                changed["completed"] += 1
        if remote_needs_update:
            reminder_id = str(reminder["id"])
            edit_reminder(reminder_id, merged, ns.dry_run)
            if bool(remote.get("flagged")) != bool(merged.get("flagged")):
                flag_updates[reminder_id] = bool(merged.get("flagged"))
            if not local_needs_update:
                changed["updated"] += 1
        link.update({"reminderId": reminder["id"], "projection": merged, "lastSyncAt": now()})
        if (legacy_link or link.get("recovered")) and not ns.dry_run:
            link.pop("legacy", None)
            link.pop("recovered", None)
        links[task_id] = link

    # A completed parent closes every mirrored child, including children that
    # were iterated before their parent. Apply this after reconciliation so the
    # native Reminder and the Obsidian hierarchy cannot diverge by ordering.
    for candidate_id in forced_completed:
        candidate = tasks.get(candidate_id)
        child_link = links.get(candidate_id, {})
        if candidate and not candidate.get("completed"):
            changed["completed"] += 1
        if candidate and not ns.dry_run:
            lines[candidate["lineIndex"]] = re.sub(r"^(\s*- \[)\s(\])", r"\1x\2", lines[candidate["lineIndex"]])
        child_link.setdefault("projection", {})["completed"] = True
        child_reminder_id = str(child_link.get("reminderId") or "")
        if child_reminder_id and not ns.dry_run:
            child_projection = dict(child_link.get("projection") or {})
            child_projection["completed"] = True
            edit_reminder(child_reminder_id, child_projection, False)
        if child_link:
            links[candidate_id] = child_link

    if not ns.dry_run:
        set_flags(flag_updates)

    known_reminder_ids = {str(link.get("reminderId")) for link in links.values()}
    for reminder_id, reminder in reminders.items():
        if reminder_id in known_reminder_ids:
            continue
        if ns.migrate_legacy:
            continue
        rid = task_id_for(reminder_id)
        projection = projection_from_reminder(reminder, cfg)
        tags = projection["tags"] or [str(cfg["tags"].get("notStarted", "#not-started"))]
        projection["tags"] = sorted(set(tags))
        line = render_task(rid, projection)
        if not ns.dry_run:
            task_file.parent.mkdir(parents=True, exist_ok=True)
            lines.extend(line.splitlines())
            if projection["details"]:
                lines.append(f"  Details: {projection['details']}")
        if reminder_id in {str(record.get("reminderId")) for record in state.get("tombstones", {}).values() if isinstance(record, dict)}:
            changed["skipped"] += 1
            continue
        projection = incoming_intake(projection, cfg, vault, state)
        if projection != projection_from_reminder(reminder, cfg):
            edit_reminder(reminder_id, projection, ns.dry_run)
        links[rid] = {"reminderId": reminder_id, "projection": projection,
                      "origin": "reminder", "detailsManaged": bool(projection.get("details")), "lastSyncAt": now()}
        changed["imported"] += 1

    if not ns.dry_run:
        for start, end, replacement in sorted(edits, key=lambda item: item[0], reverse=True):
            lines[start:end] = replacement
        for candidate_id in forced_completed:
            candidate = tasks.get(candidate_id)
            if not candidate:
                continue
            index = candidate["lineIndex"]
            if index < len(lines):
                lines[index] = re.sub(r"^(\s*)- \[[ xX]\]", r"\1- [x]", lines[index])
        task_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        state["version"] = 1
        state["lastSyncAt"] = now()
        activity(state, "sync", result="completed", created=changed["created"],
                 updated=changed["updated"], imported=changed["imported"],
                 completed=changed["completed"], moved=changed["moved"],
                 conflicts=changed["conflicts"], skipped=changed["skipped"],
                 errors=changed["errors"])
        save_state(vault, cfg, state)
    print(json.dumps({"ok": True, "dryRun": ns.dry_run, "partial": bool(snapshot["failed"]),
                      "failedLists": snapshot["failed"], **changed,
                      "messageTaskCapture": message_task_capture,
                      "emailCompletion": email_completion, "taskFile": str(task_file)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
