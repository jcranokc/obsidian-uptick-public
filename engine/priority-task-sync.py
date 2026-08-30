#!/usr/bin/env python3
"""Assign stable task priorities and difficulties, and render the Homepage view.

The Task Inbox remains the only source of truth. This script deliberately uses
deterministic rules so a new task can be inserted into the existing P01, P02,
P03... sequence without creating a second database or requiring an AI call.

Two independent axes are written as inline fields:

    [priority:: N]    1..10, how important — should I do this now
    [difficulty:: N]  1..5,  how much it costs — feeds the XP layer

This script is the ONLY writer of Task Inbox lines. `xp-sync.py` reads the
difficulty field and never writes back here, so there is exactly one owner of
the line format.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import date, datetime
from pathlib import Path


TASK_RE = re.compile(r"^(?P<prefix>- \[)(?P<state>[ xX])(?P<close>\] )(?P<body>.*)$")
DATE_RE = re.compile(r"(?:📅\s*|due(?: date)?[: ]+|deployment due date[: ]+)(20\d{2}-\d{2}-\d{2})", re.I)
BLOCK_RE = re.compile(r"\s+\^(task-[a-z0-9-]+)$", re.I)
RANK_RE = re.compile(r"(?:^|\s)P(\d{2})(?:\s+—|\s|$)", re.I)
FIELD_RE = re.compile(r"\s*\[(?:priority|difficulty|ticket)::[^\]]*(?:\[[^\]]*\]\([^)]*\))?[^\]]*\]")
# A trailing "!" means set by hand and must never be recomputed. A "~" means an
# AI refined it at import; that survives too, unless the rules have since moved
# far enough that the old opinion is stale.
DIFFICULTY_FIELD_RE = re.compile(r"\[difficulty::\s*([1-5])\s*([!~]?)\s*\]")
TICKET_RE = re.compile(r"Ticket:\s*\[([^\]]+)\]\(([^)]+)\)", re.I)
# A leading "REQ-106519 — " on a task title. The number belongs in the ticket
# field, not repeated in the name.
REQ_PREFIX_RE = re.compile(r"^(REQ-\d+)\s*[—–-]\s*")
# The ticket field this script previously wrote, so a rerun can recover it.
TICKET_FIELD_RE = re.compile(r"\[ticket::\s*(?:\[([^\]]+)\]\(([^)]+)\)|([^\]]+?))\s*\]")
SOURCE_RE = re.compile(r"^\s*Source:\s*(\[\[[^\n]+?\]\])\s*$", re.M)
TAG_RE = re.compile(r"#[A-Za-z0-9_-]+")
ICON_RE = re.compile(r"^(?:🔺|⏫|🔼|🔽|⏬)\s*")

ENHANCEMENT_TERMS = (
    "enhancement", "feature", "quick action", "form update", "picklist",
    "lookup filter", "format phone", "add wd project", "new project",
)
TEST_TERMS = (
    "test", "testing", "validate", "validation", "fulltest", "partial",
    "smoke", "deployment", "deploy",
)
RISK_TERMS = (
    "bug", "deactivation", "security", "permission", "access", "fls",
    "production-impact", "user impact", "incorrectly",
)
DATA_TERMS = (
    "data load", "data remediation", "delete deprecated", "cleanup",
    "marketing cloud", "sync", "soql", "report creation", "report",
)
FAMILY_TERMS = (
    "wife", "spouse", "sydney", "son", "oliver", "baby", "child",
    "family", "couples counseling", "therapy", "doctor", "medical",
)
SCHEDULE_TERMS = ("appointment", "schedule", "calendar", "counseling", "therapy")


def atomic_write_if_changed(path: Path, content: str) -> bool:
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        Path(temp_name).replace(path)
    finally:
        temp = Path(temp_name)
        if temp.exists():
            temp.unlink()
    return True


def clean_name(body: str) -> str:
    body = BLOCK_RE.sub("", body).strip()
    body = ICON_RE.sub("", body)
    # Legacy "P09 — " prefix, from before priority became a field.
    body = re.sub(r"^P\d{2}\s+—\s*", "", body, flags=re.I)
    # Strip the inline fields this script writes, or they would be re-appended
    # to the title on every run and compound.
    body = re.sub(r"\s*\[ticket::\s*\[[^\]]*\]\([^)]*\)\s*\]", "", body)
    body = re.sub(r"\s*\[(?:priority|difficulty|ticket)::[^\]]*\]", "", body)
    body = re.sub(r"\s+📅\s*20\d{2}-\d{2}-\d{2}", "", body)
    body = TAG_RE.sub("", body)
    body = re.sub(r"[*_]+", "", body)
    return re.sub(r"\s+", " ", body).strip()


def due_date(raw: str) -> str | None:
    match = DATE_RE.search(raw)
    return match.group(1) if match else None


def source_link(raw: str) -> str | None:
    source = SOURCE_RE.search(raw)
    if source:
        return source.group(1)
    ticket = TICKET_RE.search(raw)
    if ticket:
        return f"[{ticket.group(1)}]({ticket.group(2)})"
    return None


def source_label(link: str | None) -> str:
    if not link:
        return "—"
    if link.startswith("[["):
        target = link[2:].split("|", 1)[0].rstrip("]")
        title = Path(target).stem
        title = re.sub(r"^\d{4}-\d{2}-\d{2}\s*-\s*", "", title)
        title = re.sub(r"^\d{4}-\d{2}-\d{2}\s+", "", title)
        title = re.sub(r"\s+", " ", title).strip()
        if len(title) > 48:
            title = title[:45].rstrip() + "…"
        return f"[[{target}|{title}]]"
    return link


def table_cell(value: str) -> str:
    """Escape pipes so a wikilink alias cannot split the Markdown table.

    `[[path|Title]]` inside a table cell is parsed as a column break, which
    shifts every later column left by one. Obsidian renders `\\|` inside a
    wikilink as a normal alias separator.
    """
    return value.replace("|", "\\|")


def task_id(name: str, raw: str) -> str:
    ticket = TICKET_RE.search(raw)
    stable = ticket.group(1) if ticket else name
    digest = hashlib.sha1(stable.encode("utf-8")).hexdigest()[:12]
    return f"task-{digest}"


def priority(info: dict) -> tuple[int, str, str]:
    """Score a task, then express it as a level from 1 (most important) to 10.

    The score is built from three independent signals so that ten levels are
    actually distinguishable. The previous version produced only four distinct
    scores, which collapsed a ten-point scale onto four values.

        base      what kind of work it is
        urgency   how close the due date is
        progress  work already started outranks work not begun
    """
    text = info["raw"].lower()
    name = info["name"].lower()
    combined = f"{name}\n{text}"
    is_salesforce = ("#salesforce" in combined
                     or bool(re.search(r"\bREQ-\d+\b", combined))
                     or "salesforce" in combined)

    if is_salesforce:
        enhancement = any(term in combined for term in ENHANCEMENT_TERMS)
        needs_testing = any(term in combined for term in TEST_TERMS)
        risk = any(term in combined for term in RISK_TERMS)
        data_work = any(term in combined for term in DATA_TERMS)
        if enhancement and needs_testing:
            base = 95
        elif enhancement:
            base = 85
        elif risk:
            base = 80
        elif data_work:
            base = 40
        else:
            base = 65
    elif any(term in combined for term in FAMILY_TERMS):
        base = 100
    elif any(term in combined for term in SCHEDULE_TERMS):
        base = 75
    else:
        base = 60

    urgency = 0
    due = info.get("due")
    if due:
        try:
            days = (date.fromisoformat(due) - date.today()).days
            if days < 0:
                urgency = 30          # overdue outranks everything else
            elif days == 0:
                urgency = 22
            elif days <= 2:
                urgency = 16
            elif days <= 7:
                urgency = 9
            elif days <= 14:
                urgency = 4
        except ValueError:
            pass

    # Finishing something already in flight beats starting something new.
    progress = 6 if "#doing" in combined else 0

    score = base + urgency + progress
    level = level_for(score)
    return score, LEVEL_LABEL[level], LEVEL_ICON[level]


# Priority is expressed as 1..10, where 1 is most important. The bands are
# absolute — a level means the same thing today as next week — rather than a
# position in today's list, so "priority 3" does not silently change meaning
# when a task is added or closed.
LEVEL_BANDS = (
    (125, 1), (115, 2), (105, 3), (95, 4), (85, 5),
    (75, 6), (65, 7), (55, 8), (45, 9),
)

# A human-readable name per level, kept so the Kanban pill and the Triage line
# still read in words rather than only as a number.
LEVEL_LABEL = {1: "Critical", 2: "Urgent", 3: "High", 4: "High", 5: "Medium",
               6: "Medium", 7: "Normal", 8: "Low", 9: "Low", 10: "Lowest"}

# The Tasks plugin only understands five levels, so ten map onto its five
# icons. The icon keeps Tasks' own sorting and the Kanban's pill working;
# the precise level lives in the `priority` field.
LEVEL_ICON = {1: "🔺", 2: "🔺", 3: "⏫", 4: "⏫", 5: "🔼",
              6: "🔼", 7: "🔽", 8: "🔽", 9: "⏬", 10: "⏬"}


def level_for(score: int) -> int:
    for threshold, level in LEVEL_BANDS:
        if score >= threshold:
            return level
    return 10


# ------------------------------------------------------------------ difficulty

# Difficulty answers "how much does this cost me", independently of priority.
# A trivial task can be critical (send the email now) and an epic one can be
# low priority (rewrite the sharing model, someday). Collapsing the two axes
# makes both useless, so these term lists deliberately do NOT reuse the
# priority ones.
#
# The leading verb decides the class, and everything else only modifies within
# it. That ordering matters: "clarify with Sam whether the service account needs
# View All on every JDS object" is a question you ask someone, not a permission
# rewrite, however many heavy nouns it contains. Scoring the whole sentence
# equally rated exactly that task a 5.

# Ordered longest-first so "follow up" wins over "follow", "look into" over
# "look". Matched against the START of the task name only.
VERB_CLASSES = (
    ("communicate", 16, (
        "follow up with", "follow-up with", "follow up on", "follow up", "check with",
        "check in with", "reach out to", "reach out", "let ", "loop in", "circle back",
        "ask", "clarify", "confirm", "send", "email", "forward", "reply", "respond",
        "call", "brief", "align", "notify", "share", "tell", "remind", "schedule",
        "book", "invite", "ping", "discuss", "chase", "nudge", "thank", "introduce",
    )),
    ("investigate", 38, (
        "investigate", "look into", "research", "analyse", "analyze", "review",
        "audit", "assess", "evaluate", "determine", "identify", "run query",
        "run a query", "run the query", "verify", "validate", "compare",
        "troubleshoot", "diagnose", "figure out", "find out", "check whether",
        "check if", "check ", "document", "write up", "draft", "summarise",
        "summarize", "outline", "map out", "estimate", "plan",
    )),
    ("config", 42, (
        "add", "update", "change", "set up", "set ", "configure", "adjust",
        "rename", "enable", "disable", "format", "populate", "assign", "grant",
        "remove", "delete", "clean up", "cleanup", "correct", "fix", "tweak",
        "apply", "move", "copy", "import", "export", "schedule a job",
    )),
    ("build", 60, (
        "build", "implement", "develop", "create", "write", "design", "author",
        "construct", "extend", "integrate", "automate", "refactor", "rewrite",
        "redesign", "rebuild", "convert", "replace",
    )),
    ("heavy", 82, (
        "deploy", "release", "migrate", "refresh", "provision", "deactivate",
        "cut over", "cutover", "roll out", "rollout", "upgrade", "install",
        "restore", "reinstall", "load data", "data load", "remediate",
    )),
)
DEFAULT_CLASS_SCORE = 40

# Small, well-understood Salesforce config. Named nouns rather than verbs,
# because "add a picklist value" and "create a lookup filter" are the same
# size of job whatever verb introduces them.
DIFF_SMALL_NOUNS = (
    "picklist", "lookup filter", "quick action", "checkbox", "list view",
    "page layout", "layout", "field label", "help text", "validation rule",
    "email template", "dashboard", "custom label", "phone number",
    "form update", "rename", "description", "tab", "app menu",
)
# Work that is inherently multi-step, risky, or slow, wherever it appears.
DIFF_HEAVY_NOUNS = (
    "sandbox", "migration", "data load", "integration", "permission model",
    "sharing model", "sharing rule", "managed package", "apex", "trigger",
    "lwc", "sso", "mfa", "single sign", "cutover", "remediation", "architecture",
    "provisioning", "deactivation", "flow builder", "record type",
)
# Scope words that turn a small change into a large one.
DIFF_SCOPE_TERMS = (
    "all fields", "all users", "all profiles", "all objects", "every user",
    "every field", "org-wide", "orgwide", "company-wide", "all records",
    "for all", "across all", "bulk",
)
DIFF_ENV_TERMS = (
    "production", "fulltest", "full test", "intg", "uat", "live org",
)
# Clause separators that signal "this is really several tasks". Deliberately
# narrow: a comma-separated list of people is not a list of steps.
DIFF_STEP_RE = re.compile(r"\band then\b|;\s|\bafter that\b|\bonce .{3,30} is\b", re.I)

# Score bands, high to low. Deliberately absolute: a difficulty means the same
# thing next month as it does today.
DIFF_BANDS = ((86, 5), (64, 4), (40, 3), (22, 2))
DIFF_LABEL = {1: "Trivial", 2: "Small", 3: "Standard", 4: "Hard", 5: "Epic"}
# Base XP per difficulty. Mirrored in xp-sync.py, which reads the field rather
# than recomputing it.
DIFF_BASE_XP = {1: 10, 2: 25, 3: 50, 4: 100, 5: 200}

# "Long Meeting Name: do the thing" -> "do the thing". The same rule the Uptick
# plugin uses to display a task; the meeting title is context, not the work.
MEETING_PREFIX_RE = re.compile(r"^(.{18,}?):\s+(\S.*)$", re.S)
WIKILINK_ALIAS_RE = re.compile(r"\[\[[^\]|]*\|([^\]]*)\]\]")
WIKILINK_RE = re.compile(r"\[\[([^\]]*)\]\]")


def difficulty_text(name: str) -> str:
    """The words that describe the work, with context stripped out.

    Drops the meeting-title prefix and reduces wikilinks to their display text,
    so a task is scored on what it asks for rather than on where it came from
    or how many people it happens to name.
    """
    text = WIKILINK_ALIAS_RE.sub(r"\1", name)
    text = WIKILINK_RE.sub(r"\1", text)
    match = MEETING_PREFIX_RE.match(text)
    if match:
        text = match.group(2)
    # A trailing local marker is an assignee label, not part of the work.
    markers = [m.strip() for m in os.environ.get(
        "UPTICK_ASSIGNEE_MARKERS", "you,me,owner,assignee").split(",") if m.strip()]
    if markers:
        text = re.sub(r"\s*\((?:" + "|".join(re.escape(m) for m in markers) + r")\)\s*$", "", text, flags=re.I)
    return text.strip()


def difficulty_band(score: int) -> int:
    for threshold, level in DIFF_BANDS:
        if score >= threshold:
            return level
    return 1


def classify_verb(text: str) -> tuple[str, int]:
    """Class and base score from the leading verb, longest phrase wins."""
    head = text.lower().lstrip("*_ ")
    # "BUG: auto deactivation of active users" — the label sets the class.
    if head.startswith(("bug:", "bug -", "issue:", "defect:")):
        return "investigate", 46
    best = None
    for name, base, terms in VERB_CLASSES:
        for term in terms:
            if head.startswith(term) and (best is None or len(term) > best[2]):
                best = (name, base, len(term))
    if best:
        return best[0], best[1]
    # No leading verb: the task is titled rather than phrased as an instruction.
    # Look for a verb early in the string and take it at a discount, since a
    # verb in the middle is weaker evidence than one at the front.
    window = head[:70]
    fallback = None
    for name, base, terms in VERB_CLASSES:
        for term in terms:
            pos = window.find(term)
            if pos > 0 and (fallback is None or len(term) > fallback[2]):
                fallback = (name, int(base * 0.85), len(term))
    if fallback:
        return fallback[0], fallback[1]
    return "unknown", DEFAULT_CLASS_SCORE


def difficulty(info: dict) -> tuple[int, str]:
    """Score a task 1..5 for effort. Returns (level, marker).

    marker is "" for a computed value, "!" for a human lock, "~" for an AI
    refinement. A locked value is returned untouched. An AI-refined value
    survives unless the computed base has moved two or more bands away, at
    which point the old opinion is about a materially different task.
    """
    existing = DIFFICULTY_FIELD_RE.search(info["body"])
    prev_level = int(existing.group(1)) if existing else None
    prev_mark = existing.group(2) if existing else ""

    if prev_mark == "!" and prev_level is not None:
        return prev_level, "!"

    text = difficulty_text(info["name"])
    low = text.lower()
    verb_class, score = classify_verb(text)

    # Nouns adjust within the class rather than overriding it. A communication
    # task about a sandbox is still a conversation.
    if any(n in low for n in DIFF_HEAVY_NOUNS):
        score += 20 if verb_class in ("config", "build", "heavy", "unknown") else 6
    if any(n in low for n in DIFF_SMALL_NOUNS):
        score -= 14
    if any(s in low for s in DIFF_SCOPE_TERMS):
        # Changing one field is config; changing every field is a project.
        score += 12 if verb_class == "communicate" else 24
    if any(e in low for e in DIFF_ENV_TERMS):
        score += 8

    score += min(24, 8 * len(DIFF_STEP_RE.findall(text)))

    if len(text) > 220:
        score += 12
    elif len(text) > 120:
        score += 6

    level = difficulty_band(score)

    # A tracked sprint item is never trivial, whatever its wording.
    if re.search(r"\bREQ-\d+\b", f"{info['name']}\n{info['raw']}", re.I):
        level = max(level, 3)

    if prev_mark == "~" and prev_level is not None:
        return (prev_level, "~") if abs(prev_level - level) < 2 else (level, "")

    return level, ""


def parse_tasks(lines: list[str]) -> list[dict]:
    tasks = []
    for index, line in enumerate(lines):
        match = TASK_RE.match(line)
        if not match or "#task" not in match.group("body"):
            continue
        end = index + 1
        # Stop at a blank line OR the next task. Scanning only to the blank line
        # made adjacent tasks overlap, and the later ones were then skipped
        # entirely by the rewrite loop below.
        while end < len(lines) and lines[end].strip() and not TASK_RE.match(lines[end]):
            end += 1
        segment = "\n".join(lines[index:end])
        body = match.group("body")
        old_rank = RANK_RE.search(body)
        tasks.append({
            "start": index,
            "end": end,
            "state": match.group("state"),
            "body": body,
            "raw": segment,
            "name": clean_name(body),
            "old_rank": int(old_rank.group(1)) if old_rank else 999,
            "ticket_field": TICKET_FIELD_RE.search(body),
            "due": due_date(segment),
            "source": source_link(segment),
            "done_tag": "#done" in body,
        })
    return tasks


def update_segment(task: dict, rank: int, label: str, icon: str) -> list[str]:
    lines = task["raw"].split("\n")
    body = task["body"]
    tags = TAG_RE.findall(body)
    if "#task" not in tags:
        tags.insert(0, "#task")
    tags = list(dict.fromkeys(tags))
    block = BLOCK_RE.search(body)
    block_id = block.group(1) if block else task_id(task["name"], task["raw"])
    date_part = f" 📅 {task['due']}" if task.get("due") else ""
    tag_part = " " + " ".join(tags) if tags else ""
    level = level_for(task["score"])

    # The name used to carry a "P09 — " prefix, which put ranking noise in the
    # middle of every task title and shifted whenever anything was reprioritised.
    # Priority is now a field, so the title stays the title.
    fields = [f"[priority:: {level}]",
              f"[difficulty:: {task['difficulty']}{task['difficulty_mark']}]"]
    ticket = TICKET_RE.search(task["raw"])
    prev = task.get("ticket_field")
    name = task["name"]
    req = REQ_PREFIX_RE.match(name)
    if ticket:
        # A clickable field on the Kanban card, rather than buried in the body.
        fields.append(f"[ticket:: [{ticket.group(1)}]({ticket.group(2)})]")
    elif prev:
        # Recovered from the previous run — the title no longer carries it.
        if prev.group(1):
            fields.append(f"[ticket:: [{prev.group(1)}]({prev.group(2)})]")
        else:
            fields.append(f"[ticket:: {prev.group(3).strip()}]")
    elif req:
        # No URL known yet — keep the number as a field so it survives being
        # stripped from the title.
        fields.append(f"[ticket:: {req.group(1)}]")
    if req:
        name = name[req.end():].strip()
    field_part = " " + " ".join(fields)

    lines[0] = f"- [ ] {icon} {name}{date_part}{field_part}{tag_part} ^{block_id}"

    diff = task["difficulty"]
    diff_note = {"!": " (set by hand)", "~": " (AI-refined)"}.get(task["difficulty_mark"], "")
    priority_line = (f"Triage priority: {level} of 10 — {label} · "
                     f"difficulty {diff} of 5 — {DIFF_LABEL[diff]}{diff_note}")
    found = next((i for i, line in enumerate(lines) if re.match(r"^\s*Triage priority:", line, re.I)), None)
    if found is None:
        lines.insert(1, priority_line)
    else:
        lines[found] = priority_line
    task["rank"] = rank
    task["level"] = level
    task["base_xp"] = DIFF_BASE_XP[diff]
    task["ticket_md"] = next((f[len("[ticket:: "):-1] for f in fields
                              if f.startswith("[ticket:: ")), None)
    task["label"] = label
    task["icon"] = icon
    task["block_id"] = block_id
    # Keep the normalized task name independent of the Markdown checkbox
    # prefix; the report links to the task block, while this text stays clean.
    task["name"] = clean_name(body)
    task["source"] = source_link("\n".join(lines)) or task.get("source")
    return lines


def render_report(tasks: list[dict], total: int) -> str:
    today = datetime.now().astimezone().strftime("%Y-%m-%d")
    rows = [
        "---",
        "type: task-view",
        f"updated: {today}",
        "automation: priority-task-sync",
        # Regenerated on every run, so the theme class has to be emitted here —
        # editing the file by hand would be overwritten.
        "cssclasses:",
        "  - life-os",
        "---",
        "",
        f"Five highest-priority open tasks in the Kanban's Uncategorized or Doing columns. {total} open tasks are being assessed automatically.",
        "",
        "| Priority | Difficulty | Task | Ticket | Date | Related source |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for task in tasks[:5]:
        task_link = table_cell(f"[[2 Work/Tasks/Task Inbox#^{task['block_id']}|{task['name']}]]")
        related = table_cell(source_label(task.get("source")))
        ticket = task.get("ticket_md") or "—"
        diff = task.get("difficulty", 3)
        rows.append(f"| **{task['level']} · {task['label']}** "
                    f"| {diff} · {DIFF_LABEL[diff]} ({DIFF_BASE_XP[diff]} XP) "
                    f"| {task_link} | {ticket} "
                    f"| {task.get('due') or '—'} | {related} |")
    if not tasks:
        rows.append("| — | — | No open tasks | — | — | — |")
    rows += ["",
             "Priority runs 1 (most important) to 10 (least). The score combines what "
             "kind of work it is, how close the due date is, and whether it is already "
             "in progress. Salesforce enhancements needing testing rise first; "
             "production bugs and access work follow; data loads and cleanup rank "
             "lower. Family, child-care, health, and appointment commitments are "
             "treated as urgent. Overdue work outranks everything.",
             "",
             "Difficulty runs 1 (trivial) to 5 (epic) and is a separate axis: it is "
             "what the task costs, not how important it is. It sets the XP a "
             "completed task pays — see [[4 System/Game/Gamification Design]]. Append "
             "\"!\" to a difficulty to set it by hand and stop it being recomputed.",
             ""]
    return "\n".join(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    vault = Path(args.vault)
    inbox = vault / "2 Work/Tasks/Task Inbox.md"
    report = vault / "2 Work/Tasks/Priority Active Tasks.md"
    lines = inbox.read_text(encoding="utf-8").splitlines()
    tasks = parse_tasks(lines)
    active = [task for task in tasks if task["state"] == " " and not task["done_tag"]]
    for task in active:
        task["score"], task["label"], task["icon"] = priority(task)
        task["difficulty"], task["difficulty_mark"] = difficulty(task)
    ranked = sorted(active, key=lambda task: (-task["score"], task.get("due") or "9999-99-99", task["old_rank"], task["start"]))

    replacements: dict[int, tuple[int, list[str]]] = {}
    for rank, task in enumerate(ranked, start=1):
        span = task["end"] - task["start"]
        replacements[task["start"]] = (span, update_segment(task, rank, task["label"], task["icon"]))
    new_lines: list[str] = []
    index = 0
    while index < len(lines):
        if index in replacements:
            span, replacement = replacements[index]
            new_lines.extend(replacement)
            # Advance by what was consumed from the ORIGINAL, not by the length
            # of the replacement — they differ whenever a Triage line is added.
            index += span
        else:
            new_lines.append(lines[index])
            index += 1
    new_inbox = "\n".join(new_lines) + "\n"
    new_report = render_report(ranked, len(active))

    if not args.dry_run:
        inbox_changed = atomic_write_if_changed(inbox, new_inbox)
        report_changed = atomic_write_if_changed(report, new_report)
    else:
        inbox_changed = report_changed = False
    print(json.dumps({
        "mode": "dry-run" if args.dry_run else "write",
        "active_tasks": len(active),
        "top5": [{"rank": t["rank"], "name": t["name"], "label": t["label"],
                  "difficulty": t["difficulty"]} for t in ranked[:5]],
        "difficulty_spread": {str(d): sum(1 for t in active if t["difficulty"] == d)
                              for d in (1, 2, 3, 4, 5)},
        "inbox_changed": inbox_changed,
        "report_changed": report_changed,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
