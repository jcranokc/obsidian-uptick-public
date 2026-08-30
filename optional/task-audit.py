#!/usr/bin/env python3
"""Conservative, local daily action management for an Obsidian vault."""
from __future__ import annotations
import os
import argparse, hashlib, json, os, re, subprocess, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from uptick_private_config import load_private_env


def require_vault_arg() -> Path:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    return Path(parser.parse_known_args()[0].vault).expanduser().resolve()


CONFIG_VAULT = require_vault_arg()
load_private_env(CONFIG_VAULT)

HEADINGS = re.compile(r"^#{1,6}\s*(action items?|next actions?|follow[- ]?ups?|tasks?|to[- ]?dos?|commitments?)\s*:??\s*$", re.I)
BULLET = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.+?)\s*$")
OWNED = re.compile(os.environ.get("UPTICK_OWNER_PATTERN", r"\b(?:you|your|assigned\s+to\s+you)\b"), re.I)
VERB = re.compile(r"\b(send|email|call|schedule|review|prepare|create|update|finish|complete|follow\s*up|confirm|share|write|read|ask|check|coordinate|deliver|submit|build|fix|research|decide|document|meet|contact|reply|respond|approve|renew|buy|book|configure|install|test|verify|pay|file|draft|remind)\b", re.I)
VAGUE = re.compile(r"\b(could|might|maybe|consider|brainstorm|someday|if we|we should|someone should|would be nice)\b", re.I)
MAIL_OWNED = re.compile(os.environ.get("UPTICK_OWNER_PATTERN", r"\b(you|your|please)\b"), re.I)
MAIL_REQUEST = re.compile(r"(?:\bplease\s+(?:send|email|call|review|confirm|reply|respond|complete|provide|submit|approve|sign|schedule|forward)\b|\b(?:can|could|would)\s+you\b|\byou\s+(?:need|are asked|have)\s+to\b|\baction required\b|\bresponse requested\b|\bdeadline\b)", re.I)
MARKER = re.compile(r"<!--\s*daily-action task_id=([^ ]+)\s+source_type=([^ ]+)\s+source_id=(.+?)\s+source_date=([^ ]+)([^>]*)-->")
REMINDER_LIST = os.environ.get("UPTICK_REMINDER_LIST_ID", "").strip()
CALENDAR_TARGET = os.environ.get("UPTICK_CALENDAR_ID", "").strip()

def stamp(): return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", "", s.lower())).strip()
def link(rel): return "[[" + (rel[:-3] if rel.lower().endswith(".md") else rel) + "]]"
def tag(rel):
    context = "#project" if rel.startswith("2 Work/Projects/") else "#person" if rel.startswith("3 Reference/People/") else "#meeting" if rel.startswith("2 Work/Meetings/") else "#source" if rel.startswith("3 Reference/Sources/") else "#inbox"
    return f"#task {context}"

EXCLUDED_PREFIXES = (
    "4 System/", "4 System/Copilot/", "4 System/Archive/", ".agents/", ".claude/",
    ".copilot/", ".opencode/", ".smart-env/", "3 Reference/Sources/Granola Transcripts/",
    "3 Reference/Sources/Email References/"
)

def run_json(cmd, timeout=30):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if p.returncode == 0: return json.loads(p.stdout)
    except Exception: pass
    return None

def helper(vault, name):
    return run_json(["/opt/homebrew/bin/node", str(vault / "4 System/Automation" / name)], 45) or {"error": "helper failed"}

def reminders():
    if not REMINDER_LIST:
        return []
    return run_json(["/opt/homebrew/bin/remindctl", "list", "--list-id", REMINDER_LIST, "--json"], 20) or []

def create_calendar_event(title, start, end):
    if not CALENDAR_TARGET:
        return None
    request = json.dumps({"title": title[:200], "calendar_id": CALENDAR_TARGET,
                          "start": start.astimezone().isoformat(timespec="seconds"),
                          "end": end.astimezone().isoformat(timespec="seconds"),
                          "notes": f"Created from an explicit timed Obsidian task. due_date={start.date().isoformat()}",
                          "location": None, "all_day": False})
    return run_json([os.environ.get("CALENDAR_BRIDGE", ""), "create-calendar-event", request], 20)

def update_calendar_event(event_id, title, start, end):
    if not CALENDAR_TARGET:
        return None
    request = json.dumps({"title": title[:200], "start": start.astimezone().isoformat(timespec="seconds"),
                          "end": end.astimezone().isoformat(timespec="seconds"),
                          "notes": f"Created from an explicit timed Obsidian task. due_date={start.date().isoformat()}"})
    return run_json([os.environ.get("CALENDAR_BRIDGE", ""), "update-calendar-event", event_id, request], 20)

def due_date(text):
    m = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if m: return m.group(1)
    local = datetime.now().astimezone()
    if re.search(r"\btomorrow\b", text, re.I): return (local + timedelta(days=1)).date().isoformat()
    if re.search(r"\btoday\b", text, re.I): return local.date().isoformat()
    return None

def due_datetime(text):
    date_value = due_date(text)
    if not date_value: return None
    m = re.search(r"(?:at|~|\b)([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)\b", text, re.I)
    if not m: return None
    hour = int(m.group(1)); minute = int(m.group(2) or 0); meridiem = m.group(3).lower()
    if meridiem == "pm" and hour != 12: hour += 12
    if meridiem == "am" and hour == 12: hour = 0
    start = datetime.fromisoformat(f"{date_value}T{hour:02d}:{minute:02d}:00").astimezone()
    return start, start + timedelta(minutes=30)

def annotate_task_dates(markdown):
    """Add Obsidian Tasks due-date emoji to dated task lines."""
    changed = False; output = []
    for line in markdown.splitlines():
        m = re.match(r"^(\s*- \[[ xX]\]\s+)(.*)$", line)
        if not m:
            output.append(line); continue
        body = m.group(2); due = due_date(body)
        if due and not re.search(r"📅\s*20\d{2}-\d{2}-\d{2}", body):
            marker = re.search(r"\s+(?:\[\^|#\S|\[\[)", body)
            insert_at = marker.start() if marker else len(body)
            body = body[:insert_at].rstrip() + f" 📅 {due}" + body[insert_at:]
            line = m.group(1) + body; changed = True
        output.append(line)
    return "\n".join(output) + ("\n" if markdown.endswith("\n") else ""), changed

def dedup_key(text):
    """Canonical form used on BOTH sides of the duplicate check.

    Strips inline tags, Tasks-plugin dates, block ids and priority markers so
    that the same commitment written twice — once with a tag, once without —
    collapses to one key.
    """
    t = re.sub(r"\s+#\S+", "", str(text))
    t = re.sub(r"\s*\^task-\w+", "", t)
    t = re.sub(r"[⏫🔼🔽⏬🔺]", "", t)
    return norm(clean_task_text(t))


def clean_task_text(text):
    text = re.sub(r"\s*📅\s*20\d{2}-\d{2}-\d{2}", "", text)
    text = re.sub(r"\s*\[\^https?://[^\]]+\]", "", text)
    text = re.sub(r"\s*https?://app\.notion\.com/\S+", "", text)
    text = re.sub(r"\s+#(?:[0-9a-f]{20,})(?=\s|$)", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()

def source_title(vault, rel):
    """Return the human meeting title used for task context and source links."""
    path = vault / rel
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return Path(rel).stem
    frontmatter = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", text, re.M)
    if frontmatter:
        return re.sub(r"[*:/\\?<>|#]", "", frontmatter.group(1)).strip()
    match = re.search(r"\*\*(.+?)\*\*\s*<mention-date", text)
    if match:
        return re.sub(r"[*:/\\?<>|#]", "", match.group(1)).strip()
    return Path(rel).stem

def contextual_task_text(vault, rel, text):
    """Make generated meeting tasks self-explanatory without raw source URLs."""
    clean = clean_task_text(text)
    if rel.startswith("2 Work/Meetings/"):
        title = source_title(vault, rel)
        if title and title.lower() not in clean.lower():
            clean = f"{title}: {clean}"
    return clean

def atomic_json(path, value):
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f: json.dump(value, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--vault", required=True); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--days", type=int, default=7); a = ap.parse_args()
    vault = Path(a.vault); auto = vault / "4 System/Automation"
    dash = vault / "2 Work/Tasks/Task Inbox.md"
    if not a.dry_run:
        auto.mkdir(parents=True, exist_ok=True)
        dash.parent.mkdir(parents=True, exist_ok=True)
    state_path = auto / "daily-action-state.json"; old = json.loads(state_path.read_text()) if state_path.exists() else {}
    initial = not old.get("initial_seed_complete", False); cutoff = datetime.now().timestamp() - a.days * 86400 if initial else old.get("last_scan_epoch", 0)
    # Granola has its own stable 5-minute launchd runner. Avoid invoking the
    # old iCloud-hosted script here, which could start a duplicate Codex run.
    granola_status = "dry-run-skipped" if a.dry_run else "independent-schedule"
    mail = helper(vault, "apple-mail-recent.mjs")
    dashboard = dash.read_text(encoding="utf-8") if dash.exists() else "# Task Dashboard\n"
    dashboard, dates_changed = annotate_task_dates(dashboard)
    if dates_changed and not a.dry_run:
        dash.write_text(dashboard, encoding="utf-8")
    # Both sides of the duplicate check must be normalised identically.
    # Previously `existing` stripped tags and dates but candidates were compared
    # with bare norm(), so a bullet carrying an inline tag (e.g. "... #done")
    # never matched the task already in the Inbox and got written twice.
    # The task_id hash is not a sufficient guard on its own: it includes the
    # source line number, so editing a meeting note shifts it and re-admits
    # tasks that already exist.
    existing = {dedup_key(m.group(1)) for m in re.finditer(r"^- \[[ xX]\]\s+(.+?)\s*$", dashboard, re.M)}
    existing_ids = {m.group(1) for m in MARKER.finditer(dashboard)}; candidates=[]; scanned=0
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        if "/.obsidian/" in str(path) or path == dash or any(rel.startswith(prefix) for prefix in EXCLUDED_PREFIXES) or (rel.startswith("1 Capture/Daily/") and "Action Review" in path.name) or path.stat().st_mtime < cutoff: continue
        scanned += 1; rel = path.relative_to(vault).as_posix(); active=False
        for i, raw in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines()):
            if HEADINGS.match(raw.strip()): active=True; continue
            if active and re.match(r"^#{1,6}\s+", raw): active=False
            if not active: continue
            m=BULLET.match(raw)
            if not m: continue
            candidate=contextual_task_text(vault, rel, m.group(1)).rstrip(".;")
            if not (8 <= len(candidate) <= 240) or not OWNED.search(candidate) or not VERB.search(candidate) or VAGUE.search(candidate): continue
            tid="task-"+hashlib.sha256(f"{rel}|{i}|{norm(candidate)}".encode()).hexdigest()[:12]
            if tid in existing_ids or dedup_key(candidate) in existing: continue
            candidates.append({"task_id":tid,"text":candidate,"source":rel,"tag":tag(rel),"due":due_date(candidate)})
    # Mail remains read-only. Promote only unusually explicit requests and
    # create a metadata-only reference note; never copy the message body.
    for item in (mail.get("results", []) if isinstance(mail, dict) else []):
        text = " ".join(str(item.get(k) or "") for k in ("subject", "preview"))
        if not MAIL_OWNED.search(text) or not MAIL_REQUEST.search(text) or not VERB.search(text) or VAGUE.search(text): continue
        message_id = str(item.get("message_id") or "")
        if not message_id: continue
        ref = "3 Reference/Sources/Email References/" + re.sub(r"[^A-Za-z0-9_.-]+", "-", message_id) + ".md"
        candidate = re.sub(r"\s+", " ", str(item.get("subject") or "Follow up on email")).strip()
        candidate = "Review and respond: " + candidate if not re.search(r"\b(reply|respond|email|send)\b", candidate, re.I) else candidate
        tid = "task-" + hashlib.sha256(f"email|{message_id}|{norm(candidate)}".encode()).hexdigest()[:12]
        if tid in existing_ids or dedup_key(candidate) in existing: continue
        candidates.append({"task_id":tid,"text":candidate[:240],"source":ref,"tag":"#source","due":due_date(text),"source_type":"email","source_id":message_id,"email":item})
    existing_reminders = reminders(); reminder_by_task={}
    for r in existing_reminders:
        m=re.search(r"obsidian_task_id=([^\s]+)", r.get("notes") or "")
        if m: reminder_by_task[m.group(1)] = r
    reminder_created=[]; reconciled=[]; needs=[]
    if not a.dry_run:
        for marker in MARKER.finditer(dashboard):
            tid=marker.group(1); before=dashboard[:marker.start()].splitlines(); task_line=before[-1] if before else ""
            match=re.match(r"\s*- \[[ xX]\]\s+(.+?)\s+(?:#\S+\s+)*\[\[", task_line)
            if not match or tid not in reminder_by_task: continue
            due=due_date(match.group(1)); reminder=reminder_by_task[tid]
            if due and f"📅 {due}" not in str(reminder.get("title") or ""):
                clean_text = clean_task_text(match.group(1))
                run_json(["/opt/homebrew/bin/remindctl","edit",reminder.get("id", ""),"--title",f"{clean_text} 📅 {due}","--notes",f"{reminder.get('notes','')} due_date={due}","--json"],20)
    date=datetime.now().astimezone().strftime("%Y-%m-%d"); review=vault/"1 Capture/Daily"/f"{date} - Action Review.md"
    if not a.dry_run and candidates:
        block="\n\n## Daily Action Automation\n"
        for c in candidates:
            if c.get("source_type") == "email" and not (vault / c["source"]).exists():
                ref_path = vault / c["source"]; ref_path.parent.mkdir(parents=True, exist_ok=True)
                e = c.get("email", {})
                ref_path.write_text("---\n" + "message_id: " + str(c["source_id"]) + "\nsubject: " + json.dumps(str(e.get("subject") or "")) + "\nsender: " + json.dumps(str(e.get("sender") or "")) + "\ndate_received: " + json.dumps(str(e.get("date_received") or "")) + "\naccount: " + json.dumps(str(e.get("account") or "")) + "\nmailbox: " + json.dumps(str(e.get("mailbox") or "")) + "\nsource_type: apple-mail\n---\n\nRead-only metadata reference. Use the message_id to locate the original in Mail.app.\n", encoding="utf-8")
            # Every task written to the Inbox carries a due date so it lands on a
            # day's dashboard instead of falling into an undated pile. When the
            # text states no date, fall back to the source note's date (its
            # filename prefix) and finally to today.
            #
            # c["due"] stays the EXPLICIT date and is what gates Apple Reminders
            # below — defaulting a date must not start creating reminders for
            # every task, which AGENTS.md restricts to explicit due dates.
            src_stem = Path(c["source"]).stem
            src_match = re.match(r"(\d{4}-\d{2}-\d{2})", src_stem)
            due_effective = c.get("due") or (src_match.group(1) if src_match else date)
            due_label = f" 📅 {due_effective}"
            source_marker = re.sub(r"\s+", "_", source_title(vault, c["source"]))
            block += f"- [ ] {c['text']}{due_label} {c['tag']}\n  Source: {link(c['source'])}\n<!-- daily-action task_id={c['task_id']} source_type={c.get('source_type','obsidian')} source_id={c.get('source_id',c['source'])} source_date={date} source_title={source_marker} -->\n"
        dash.write_text(dashboard.rstrip()+block, encoding="utf-8")
        for c in candidates:
            if REMINDER_LIST and c["due"] and c["task_id"] not in reminder_by_task:
                created=run_json(["/opt/homebrew/bin/remindctl","add","--list-id",REMINDER_LIST,"--title",f"{c['text']} 📅 {c['due']}","--due",c["due"],"--notes",f"obsidian_task_id={c['task_id']} source={c['source']} due_date={c['due']}","--json"],20)
                if created: reminder_created.append(created); reminder_by_task[c["task_id"]]=created
    # Obsidian checkbox completion is authoritative for reminders owned by this job.
    for m in MARKER.finditer(dashboard):
        tid=m.group(1); before=dashboard[:m.start()].splitlines(); task_line=before[-1] if before else ""
        if re.match(r"\s*- \[[xX]\]", task_line) and tid in reminder_by_task and not reminder_by_task[tid].get("isCompleted") and not a.dry_run:
            if run_json(["/opt/homebrew/bin/remindctl","complete",reminder_by_task[tid].get("id","") ,"--json"],20) is not None: reconciled.append(tid)
    cal=helper(vault,"apple-calendar-snapshot.mjs")
    calendar_links = old.get("calendar_event_links", {})
    calendar_created=[]
    seen_event_keys=set(calendar_links)
    for marker in MARKER.finditer(dashboard):
        tid=marker.group(1); before=dashboard[:marker.start()].splitlines(); task_line=before[-1] if before else ""
        match=re.match(r"\s*- \[[ xX]\]\s+(.+?)\s+(?:#\S+\s+)*\[\[", task_line)
        if not match: continue
        task_text=clean_task_text(match.group(1)); timing=due_datetime(task_text)
        if not timing or not CALENDAR_TARGET: continue
        source=re.search(r"source_title=([^ >]+)", marker.group(0)); source_key=source.group(1) if source else "dashboard"
        key=f"{source_key}|{timing[0].isoformat()}"
        if key in seen_event_keys:
            existing = calendar_links.get(key, {})
            if not a.dry_run and existing.get("event_id") and "📅" not in str(existing.get("title", "")):
                updated = update_calendar_event(existing["event_id"], f"{task_text} 📅 {timing[0].date().isoformat()}", *timing)
                if updated: existing["title"] = f"{task_text} 📅 {timing[0].date().isoformat()}"
            continue
        if a.dry_run: continue
        created=create_calendar_event(f"{task_text} 📅 {timing[0].date().isoformat()}", *timing)
        if created and created.get("event_id"):
            calendar_links[key]={"event_id":created["event_id"],"task_id":tid,"title":task_text}
            seen_event_keys.add(key); calendar_created.append(created)
    lines=["# Daily Action Review",f"Generated: {stamp()}","Mode: dry run" if a.dry_run else "Mode: write","","## New Tasks"]
    lines += [f"- {c['text']} {link(c['source'])}" for c in candidates] or ["- None"]
    lines += ["","## Updated Tasks","- None","","## Reminders Created"] + ([f"- {r.get('title','')} {r.get('id','')}" for r in reminder_created] or ["- None (only explicit due dates are promoted)"])
    lines += ["","## Calendar Events Created"] + ([f"- {e.get('title','')} ({e.get('event_id','')})" for e in calendar_created] or ["- None (only explicit date + clock-time tasks are promoted)"]) + ["","## Waiting / Follow-up","- None","","## Needs Review",f"- Calendar target configured: {'yes' if CALENDAR_TARGET else 'no'}.",f"- Reminders target configured: {'yes' if REMINDER_LIST else 'no'}.","","## Completed / Reconciled"] + ([f"- {tid}" for tid in reconciled] or ["- None"])
    lines += ["","## Automation Issues","- Granola synchronization: "+granola_status,"- Apple Mail recent-message scan: "+("ok" if "error" not in mail else "unavailable"),"- Apple Calendar permission/list scan: "+("ok" if "error" not in cal else "unavailable"),""]
    if not a.dry_run:
        review.parent.mkdir(parents=True, exist_ok=True)
        review.write_text("\n".join(lines)+"\n", encoding="utf-8")
    state={"version":3,"last_success_at":stamp(),"last_scan_epoch":datetime.now().timestamp() if not a.dry_run else old.get("last_scan_epoch",0),"initial_seed_complete":(old.get("initial_seed_complete",False) or not a.dry_run),"processed_note_mtimes":{p.relative_to(vault).as_posix():p.stat().st_mtime for p in vault.rglob("*.md") if "/.obsidian/" not in str(p)} if not a.dry_run else old.get("processed_note_mtimes",{}),"processed_mail_ids":[r.get("message_id") for r in (mail.get("results",[]) if isinstance(mail,dict) else []) if r.get("message_id")],"task_links":{c["task_id"]:{"source":c["source"],"reminder_id":(reminder_by_task.get(c["task_id"]) or {}).get("id")} for c in candidates},"calendar_target":CALENDAR_TARGET or old.get("calendar_target"),"calendar_event_links":calendar_links,"reminder_list_id":REMINDER_LIST or old.get("reminder_list_id"),"reminder_list_name":"Uptick Task Audit","granola_state_reference":str(auto/"granola-sync-state.json"),"last_run":{"dry_run":a.dry_run,"notes_scanned":scanned,"tasks_created":0 if a.dry_run else len(candidates),"reminders_created":len(reminder_created),"reconciled":len(reconciled),"calendar_events_created":len(calendar_created),"granola_sync":granola_status,"mail_recent_count":mail.get("count",0),"calendar_status":cal.get("health",{}).get("access_status") if isinstance(cal,dict) else None,"calendar_target_configured":bool(CALENDAR_TARGET),"reminder_target_configured":bool(REMINDER_LIST)}}
    if not a.dry_run: atomic_json(state_path,state)
    print(json.dumps({"mode":"dry-run" if a.dry_run else "write","notes_scanned":scanned,"candidates":len(candidates),"reminders_created":len(reminder_created),"reconciled":len(reconciled),"review":str(review),"mail_recent_count":mail.get("count",0)}))
if __name__ == "__main__": raise SystemExit(main())
