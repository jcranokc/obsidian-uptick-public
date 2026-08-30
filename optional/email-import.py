#!/usr/bin/env python3
"""Import recent Apple Mail messages as reference notes with a summary and actions.

USAGE
    email-import.py [--hours 24] [--dry-run]

WHAT IT WRITES
    3 Reference/Sources/Email References/<date> - <subject>.md
      frontmatter: message_id, subject, sender, date, account, mailbox, meeting
      body:        Summary · Action items · Open original

MESSAGE BODIES ARE STORED
    you asked for the full body verbatim (2026-08-19), so each note carries a
    "## Message" section with the message as received. This reverses the older
    metadata-only stance still described in AGENTS.md and task-audit.py —
    those notes are now out of date. Mail.app remains the system of record and
    "Open original in Mail" still jumps to the real message.

Read-only: the Mail MCP runs under APPLE_MAIL_MCP_SAFETY_PROFILE=safe_readonly,
so nothing is sent, replied to, moved, or marked read.

SUMMARIES ARE EXTRACTIVE, NOT AI-GENERATED. There is no model in this pipeline.
Summary = the most informative sentences already in the message preview.
Actions  = sentences that match request patterns. Both are labelled as such in
the note so they are never mistaken for an authored summary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path


def require_vault() -> str:
    """The vault to operate on. Never guesses — a wrong guess writes into the
    wrong vault, which is worse than refusing to run."""
    v = os.environ.get("VAULT")
    if not v:
        raise SystemExit(
            "Set VAULT to your vault's path, e.g.\n"
            '  VAULT="$HOME/Documents/MyVault" python3 ' + os.path.basename(__file__))
    return v


VAULT = Path(require_vault())
HELPER = VAULT / "4 System/Automation/apple-mail-detail.mjs"
RECIPIENTS = VAULT / "4 System/Automation/mail-recipients.applescript"
OUT = VAULT / "3 Reference/Sources/Email References"
TRIAGE = VAULT / "4 System/Automation/mail-triage-cache.json"
MEETINGS = VAULT / "2 Work/Meetings"
NODE = "/opt/homebrew/bin/node"

# Sentences that read like someone asking for something.
REQUEST = re.compile(
    r"(?:\bplease\s+(?:send|email|call|review|confirm|reply|respond|complete|provide|"
    r"submit|approve|sign|schedule|forward|share|update)\b"
    r"|\b(?:can|could|would)\s+you\b"
    r"|\byou\s+(?:need|are asked|have)\s+to\b"
    r"|\baction required\b|\bresponse requested\b|\bby (?:eod|cob|tomorrow|friday|monday)\b"
    r"|\bdeadline\b|\blet me know\b|\bfollow(?:ing)? up\b)",
    re.I,
)
# Sentences that carry no information about the message itself. The first
# group is Exchange/Outlook safety chrome prepended to external mail — left in,
# it wins the summary slot and every such email reads "You don't often get
# email from ...".
NOISE = re.compile(
    r"(you don't often get email from|learn why this is important"
    r"|caution:? this (?:e-?mail|message) originated|external (?:e-?mail|sender)"
    r"|do not click links or open attachments"
    r"|unsubscribe|view (?:this|in) browser|privacy (?:policy|statement)"
    r"|do not reply|confidential|sent from my|©|all rights reserved)",
    re.I,
)


def strip_reply_chrome(text: str) -> str:
    """Drop quoted history, signatures and footers before summarising."""
    lines = []
    for line in str(text or "").splitlines():
        s = line.strip()
        if s.startswith(">"):
            continue
        if re.match(r"^(on .{0,80}wrote:|from:|sent:|to:|cc:|subject:)", s, re.I):
            break
        if re.match(r"^(--\s*$|__+$|sent from )", s, re.I):
            break
        lines.append(line)
    return "\n".join(lines)


def sentences(text: str) -> list[str]:
    clean = re.sub(r"\s+", " ", strip_reply_chrome(text)).strip()
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", clean)
    return [p.strip() for p in parts if len(p.strip()) >= 12]


def summarise(subject: str, preview: str) -> tuple[str, list[str]]:
    """Extractive summary plus action-like sentences."""
    body = [s for s in sentences(preview) if not NOISE.search(s)]
    actions = [s for s in body if REQUEST.search(s)]
    # Prefer sentences that are not themselves the ask, so the summary adds
    # something beyond the action list.
    context = [s for s in body if s not in actions]
    summary = " ".join((context or body)[:2])[:400]
    if not summary:
        summary = re.sub(r"\s+", " ", subject).strip()[:400]
    return summary, actions[:5]


def slugish(text: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|#^\[\]]+", "-", str(text or "")).strip()
    s = re.sub(r"\s+", " ", s)
    return s[:70].strip(" -.") or "message"


def load_meetings() -> list[dict]:
    out = []
    if not MEETINGS.exists():
        return out
    for p in MEETINGS.rglob("*.md"):
        if "/Recurring/" in str(p) or p.stem in ("Meetings",):
            continue
        try:
            head = p.read_text(encoding="utf-8", errors="replace")[:1200]
        except OSError:
            continue
        if not re.search(r"^type:\s*meeting\s*$", head, re.M):
            continue
        m = re.search(r"^(?:meeting_date|date):\s*(\d{4}-\d{2}-\d{2})", head, re.M)
        date = m.group(1) if m else (p.stem[:10] if re.match(r"\d{4}-\d{2}-\d{2}", p.stem) else None)
        att = re.search(r"^attendees:\s*(.*)$", head, re.M)
        out.append({
            "path": str(p.relative_to(VAULT)),
            "stem": p.stem,
            "date": date,
            "attendees": (att.group(1) if att else ""),
        })
    return out


def match_meeting(msg: dict, date: str, meetings: list[dict]) -> str | None:
    """Link an email to a same-day meeting when the subject or sender lines up."""
    subject = str(msg.get("subject") or "").lower()
    sender = str(msg.get("sender") or "").lower()
    sender_name = re.sub(r"<.*?>", "", sender).strip().strip('"')
    words = {w for w in re.findall(r"[a-z]{4,}", subject)}

    best, best_score = None, 0
    for mt in meetings:
        if mt["date"] != date:
            continue
        title = mt["stem"].lower()
        title_words = {w for w in re.findall(r"[a-z]{4,}", title)}
        score = len(words & title_words)
        # A named attendee in the sender is a strong signal.
        if sender_name and sender_name.split()[0:1]:
            first = sender_name.split()[0]
            if len(first) > 2 and first in mt["attendees"].lower():
                score += 3
        if score > best_score:
            best, best_score = mt, score
    return best["path"] if best and best_score >= 2 else None


def load_recipients(hours: int) -> dict[str, dict]:
    """message_id -> {"to": [...], "cc": [...]}.

    The Mail MCP returns `to` and `cc` on every message but always empty, so the
    addresses come from AppleScript instead. One pass over the mailboxes rather
    than a fetch per message: Mail is slow to answer and this is already the
    second round-trip in the import.
    """
    try:
        p = subprocess.run(["/usr/bin/osascript", str(RECIPIENTS), str(hours)],
                           capture_output=True, text=True, timeout=300)
    except (subprocess.TimeoutExpired, OSError):
        return {}

    out: dict[str, dict] = {}
    for line in (p.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        mid, to_raw, cc_raw = parts[0].strip(), parts[1], parts[2]
        if not mid:
            continue
        out[mid] = {
            "to": [a.strip() for a in to_raw.split(";") if a.strip()],
            "cc": [a.strip() for a in cc_raw.split(";") if a.strip()],
        }
    return out


def load_triage() -> dict:
    """Read mail-triage.py's verdicts, keyed by message_id.

    Absent file means triage is not in use and every message is imported, which
    is the pre-triage behaviour. A message the classifier has not seen is also
    imported: the import is the conservative side of that call.
    """
    try:
        data = json.loads(TRIAGE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    msgs = data.get("messages")
    return msgs if isinstance(msgs, dict) else {}


def task_lines(tasks: list[dict]) -> list[str]:
    """Render classifier tasks as real checkbox tasks the task engine can score.

    difficulty carries a "~" so priority-task-sync treats it as AI-refined and
    leaves it alone unless its own estimate disagrees sharply. priority is
    written unmarked and the engine is free to re-rank it against the rest of
    the vault, which knows things a single email does not.
    """
    out = []
    for t in tasks:
        due = f" \U0001F4C5 {t['due']}" if t.get("due") else ""
        out.append(f"- [ ] {t['text']} [priority:: {t['priority']}] "
                   f"[difficulty:: {t['difficulty']}~]{due} #todo")
    return out


def run_helper(hours: int = 0) -> dict:
    # Fetching each body is a separate AppleScript round-trip and Mail is slow,
    # so this needs a generous budget. MAIL_MAX_DETAIL caps the batch so a large
    # inbox cannot run unbounded.
    # MAIL_HOURS is the helper's own cutoff and it filters BEFORE we do, so a
    # --hours wider than the helper's default silently returned nothing.
    env = {**os.environ, "MAIL_MAX_DETAIL": os.environ.get("MAIL_MAX_DETAIL", "25")}
    if hours:
        env["MAIL_HOURS"] = str(hours)
    try:
        p = subprocess.run([NODE, str(HELPER)], capture_output=True, text=True,
                           timeout=900, env=env)
    except subprocess.TimeoutExpired:
        return {"error": "mail helper timed out — Mail is slow to answer AppleScript. Lower MAIL_MAX_DETAIL or retry when Mail is idle."}
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"error": (p.stderr or p.stdout or "no output").strip()[:400]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all", action="store_true",
                    help="import every message, ignoring mail-triage verdicts")
    ap.add_argument("--refresh", action="store_true",
                    help="rewrite notes that already exist (e.g. to add bodies)")
    a = ap.parse_args()

    data = run_helper(a.hours)
    if data.get("error"):
        print(f"email-import: {data['error']}", file=sys.stderr)
        return 3

    results = data.get("results") or []
    cutoff = datetime.now().astimezone() - timedelta(hours=a.hours)
    meetings = load_meetings()
    # A little slack so a message right at the boundary still gets its people.
    recipients = load_recipients(a.hours + 2)

    triage = {} if a.all else load_triage()
    written, linked, skipped, filtered = 0, 0, 0, 0
    OUT.mkdir(parents=True, exist_ok=True)

    for msg in results:
        mid = str(msg.get("message_id") or "").strip()
        if not mid:
            skipped += 1
            continue

        raw = str(msg.get("date_received") or "").replace(" ", " ").replace(" ", " ")
        raw = re.sub(r"\s+at\s+", " ", raw, flags=re.I)
        try:
            when = datetime.fromisoformat(raw)
        except ValueError:
            try:
                when = datetime.strptime(raw.strip(), "%m/%d/%Y %I:%M:%S %p")
            except ValueError:
                when = datetime.now()
        when = when.astimezone() if when.tzinfo else when.replace(tzinfo=cutoff.tzinfo)
        if when < cutoff:
            continue

        date = when.strftime("%Y-%m-%d")
        subject = str(msg.get("subject") or "(no subject)").strip()
        source_text = str(msg.get("body") or "") or str(msg.get("preview") or "")
        verdict = triage.get(mid) or {}
        if verdict and verdict.get("verdict") != "important":
            # Triaged as routine or spam. Mail.app still has it; the vault does
            # not need it. --all re-imports everything if you disagree.
            filtered += 1
            continue

        summary, actions = summarise(subject, source_text)
        if verdict.get("tasks"):
            actions = task_lines(verdict["tasks"])
        meeting = match_meeting(msg, date, meetings)
        people = recipients.get(mid, {})

        # Distinct messages can share a subject on the same day (four identical
        # "Site Published Successfully" notifications, say). Keying the file on
        # subject alone would let the first win and silently drop the rest, so
        # a colliding-but-different message gets a short message_id suffix.
        # Re-running is idempotent: the same message_id maps to the same file.
        digest = hashlib.sha1(mid.encode("utf-8")).hexdigest()[:6]
        base = f"{date} - {slugish(subject)}"
        path = OUT / f"{base}.md"
        # The dashboard's read flag lives in frontmatter. A --refresh rebuilds
        # the note from scratch, so carry the flag across or a refresh would
        # silently mark everything unread again.
        was_read = False
        if path.exists():
            existing = path.read_text(encoding="utf-8", errors="replace")[:600]
            was_read = re.search(r'^read:\s*"?true"?\s*$', existing, re.M | re.I) is not None
            if mid in existing:
                # Same message. Rewrite in place on --refresh, otherwise leave it.
                if not a.refresh:
                    skipped += 1
                    continue
            else:
                # Different message that happens to share a subject and date.
                path = OUT / f"{base} ({digest}).md"
                if path.exists() and not a.refresh:
                    skipped += 1
                    continue

        body = [
            "---",
            "type: email",
            f"message_id: {json.dumps(mid)}",
            f"subject: {json.dumps(subject)}",
            f"sender: {json.dumps(str(msg.get('sender') or ''))}",
            f"date: {date}",
            f"received: {json.dumps(when.isoformat(timespec='seconds'))}",
            f"account: {json.dumps(str(msg.get('account') or ''))}",
            f"mailbox: {json.dumps(str(msg.get('mailbox') or ''))}",
            f"meeting: {f'[[{meeting[:-3]}]]' if meeting else ''}",
            f"action_count: {len(actions)}",
            f"to: {json.dumps(people.get('to', []), ensure_ascii=False)}",
            f"cc: {json.dumps(people.get('cc', []), ensure_ascii=False)}",
            f'read: "{str(was_read).lower()}"',
            "cssclasses:", "  - life-os", "  - max",
            "---",
            "",
            "```life-os", "view: email", "```",
            "",
            "## Summary",
            "",
            summary,
            "",
            "## Action Items",
            "",
        ]
        body += ([t if t.startswith("- ") else f"- {t}" for t in actions]
                 if actions else ["*None detected.*"])
        body += ["", "## Notes", ""]

        if source_text.strip():
            body += [
                "## Message",
                "",
                "> [!quote]- Full message as received",
            ]
            # Fold into a callout so a long email does not swamp the note, and
            # blockquote every line so Markdown in the mail cannot reformat it.
            for line in source_text.strip().splitlines():
                body.append("> " + line.rstrip())
            body.append("")

        body += [
            "## Source",
            "",
            "Mail.app remains the system of record. **Open original in Mail** on the "
            f"dashboard looks this message up by its reference `{mid}`, falling back "
            "to the subject if it has since moved.",
            "",
        ]

        if a.dry_run:
            print(f"  would write: {path.name}" + (f"  → {meeting}" if meeting else ""))
        else:
            path.write_text("\n".join(body), encoding="utf-8")
        written += 1
        if meeting:
            linked += 1

    print(json.dumps({
        "ok": True, "dry_run": a.dry_run, "scanned": len(results),
        "written": written, "linked_to_meetings": linked, "skipped": skipped,
        "filtered_by_triage": filtered,
        "folder": str(OUT.relative_to(VAULT)),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
