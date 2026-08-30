#!/usr/bin/env python3
"""Read-only macOS Messages -> Obsidian importer.

The importer never writes to ~/Library/Messages. It opens chat.db with
SQLite's read-only + immutable flags, groups new messages by conversation/day,
and appends them to Markdown notes rendered by Obsidian Chat View.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
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
DB_PATH = Path.home() / "Library/Messages/chat.db"
OUTPUT_ROOT = VAULT / "3 Reference/Sources/Messages"
STATE_PATH = VAULT / "4 System/Automation/messages-sync-state.json"
REPORT_PATH = VAULT / "4 System/Reports/Messages Import Report.md"
CONTACT_ROOT = VAULT / "3 Reference/People/Apple Contacts"
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"schema": 1, "last_rowid": 0, "imported_guids": [], "runs": 0}
    try:
        value = json.loads(STATE_PATH.read_text())
        if isinstance(value, dict):
            value.setdefault("schema", 1)
            value.setdefault("last_rowid", 0)
            value.setdefault("imported_guids", [])
            value.setdefault("runs", 0)
            return value
    except (OSError, json.JSONDecodeError):
        pass
    return {"schema": 1, "last_rowid": 0, "imported_guids": [], "runs": 0}


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def normalize_handle(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().casefold()
    if "@" in value:
        return value
    digits = re.sub(r"\D", "", value)
    return digits[-10:] if len(digits) >= 10 else digits


def parse_frontmatter(text: str, key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, re.M)
    return match.group(1).strip().strip('"') if match else None


def contact_index() -> dict[str, dict]:
    """Map Apple Messages handles to existing Apple Contacts notes."""
    index: dict[str, dict] = {}
    if not CONTACT_ROOT.exists():
        return index
    for path in sorted(CONTACT_ROOT.rglob("*.md")):
        text = path.read_text(errors="ignore")
        name = parse_frontmatter(text, "apple_contact_name")
        if not name:
            continue
        rel = path.relative_to(VAULT).with_suffix("").as_posix()
        record = {"name": name, "rel": rel, "path": path}
        emails = re.findall(r"[-\w.+]+@[-\w.]+", text)
        phones = re.findall(r"\+?\d[\d ()().-]{7,}\d", text)
        keys = {normalize_handle(name), *(normalize_handle(x) for x in emails), *(normalize_handle(x) for x in phones)}
        for key in keys:
            if not key:
                continue
            # Duplicate Apple imports can exist. Prefer the first stable slug.
            index.setdefault(key, record)
    return index


def decode_date(value) -> datetime:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0
    if number > 1e14:  # nanoseconds, including newer macOS exports
        number /= 1_000_000_000
    elif number > 1e11:  # milliseconds, seen in some exports
        number /= 1_000
    return (APPLE_EPOCH + timedelta(seconds=number)).astimezone()


def _typed_length(raw: bytes, position: int) -> tuple[int, int] | None:
    """Read the length prefix used by Apple's typedstream NSString payload."""
    if position >= len(raw):
        return None
    marker = raw[position]
    if 0x01 <= marker <= 0x7F:
        return marker, 1
    if marker == 0x81 and position + 3 <= len(raw):
        return int.from_bytes(raw[position + 1:position + 3], "little"), 3
    if marker == 0x82 and position + 5 <= len(raw):
        return int.from_bytes(raw[position + 1:position + 5], "little"), 5
    if marker == 0x83 and position + 9 <= len(raw):
        length = int.from_bytes(raw[position + 1:position + 9], "little")
        return length, 9
    return None


def _reasonable_message(value: str) -> bool:
    value = value.strip()
    if not value or len(value) > 1_000_000:
        return False
    if any(token in value for token in ("NSObject", "NSDictionary", "NSString", "WHttpURL", "streamtyped", "$classname")):
        return False
    printable = sum(1 for char in value if char.isprintable() or char in "\n\r\t")
    if printable / max(len(value), 1) < 0.85:
        return False
    return any(char.isalnum() for char in value) or value.startswith(("http://", "https://"))


def decode_attributed_body(blob) -> str:
    """Extract the visible NSString from Apple's NSAttributedString typed stream."""
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
        # A small framing region follows the class marker. Scan it for the
        # length prefix rather than assuming a single fixed offset: macOS has
        # used several typedstream layouts over time.
        for position in range(cursor, min(cursor + 32, len(raw))):
            parsed = _typed_length(raw, position)
            if not parsed:
                continue
            length, width = parsed
            payload_start = position + width
            payload_end = payload_start + length
            if length < 1 or payload_end > len(raw):
                continue
            try:
                value = raw[payload_start:payload_end].decode("utf-8")
            except UnicodeDecodeError:
                continue
            value = value.strip()
            if _reasonable_message(value):
                candidates.append(value)
        start = hit + 1
    if candidates:
        return max(candidates, key=len)

    # Older records sometimes expose an almost-readable UTF-8 segment without
    # a usable length prefix. Keep this fallback conservative so metadata such
    # as NSObject/WHttpURL is never presented as message text.
    decoded = raw.decode("utf-8", errors="ignore").replace("\x00", "")
    fallback = [part.strip() for part in re.findall(r"[\x20-\x7e\u00a0-\uffff]{2,}", decoded)]
    fallback = [part for part in fallback if _reasonable_message(part)]
    return max(fallback, key=len) if fallback else ""


def message_text(row: sqlite3.Row) -> str:
    text = (row["text"] or "").strip() if "text" in row.keys() else ""
    if text and _reasonable_message(text):
        return re.sub(r"^\+(?=[A-Za-z])", "", text)
    decoded = decode_attributed_body(row["attributedBody"] if "attributedBody" in row.keys() else None).strip()
    value = decoded or text
    return re.sub(r"^\+(?=[A-Za-z])", "", value)


def sqlite_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def open_database(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f"Messages database not found: {path}")
    # immutable=1 prevents SQLite from taking locks or creating sidecars.
    uri = f"file:{path.as_posix()}?mode=ro&immutable=1"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def read_rows(conn: sqlite3.Connection, state: dict, all_history: bool, days: int, limit: int | None, rebuild: bool = False):
    message_cols = sqlite_columns(conn, "message")
    handle_cols = sqlite_columns(conn, "handle")
    chat_cols = sqlite_columns(conn, "chat")
    # ROWID is an implicit SQLite column and is not returned by PRAGMA table_info.
    required = {"guid", "date", "is_from_me", "handle_id"}
    if not required.issubset(message_cols):
        raise RuntimeError(f"Unsupported Messages schema; missing {sorted(required - message_cols)}")
    text_expr = "m.text" if "text" in message_cols else "NULL"
    body_expr = "m.attributedBody" if "attributedBody" in message_cols else "NULL"
    handle_expr = "h.uncanonicalized_id" if "uncanonicalized_id" in handle_cols else "h.id"
    chat_name = "c.display_name" if "display_name" in chat_cols else "NULL"
    chat_identifier = "c.chat_identifier" if "chat_identifier" in chat_cols else "NULL"
    chat_room = "c.room_name" if "room_name" in chat_cols else "NULL"
    since = None if all_history else (datetime.now().astimezone() - timedelta(days=days)).timestamp()
    # Apple stores dates relative to 2001-01-01; compare in SQL only when a
    # bounded initial import is requested. The Python filter handles both
    # seconds and nanoseconds robustly below.
    sql = f"""
        SELECT m.ROWID AS rowid, m.guid AS guid, {text_expr} AS text,
               {body_expr} AS attributedBody, m.date AS date,
               m.is_from_me AS is_from_me, m.handle_id AS handle_id,
               {handle_expr} AS handle_value, cmj.chat_id AS chat_id,
               {chat_name} AS chat_name, {chat_identifier} AS chat_identifier,
               {chat_room} AS chat_room
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.ROWID > ?
        ORDER BY m.ROWID ASC
    """
    params = [0 if rebuild else int(state.get("last_rowid", 0) or 0)]
    rows = []
    for row in conn.execute(sql, params):
        when = decode_date(row["date"])
        if since is not None and when.timestamp() < since:
            continue
        if not row["guid"]:
            continue
        rows.append(row)
        if limit and len(rows) >= limit:
            break
    return rows


def chat_handles(conn: sqlite3.Connection) -> dict[int, list[str]]:
    result: dict[int, list[str]] = defaultdict(list)
    try:
        query = """
            SELECT chj.chat_id, h.uncanonicalized_id
            FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id
        """
        for row in conn.execute(query):
            value = row[1]
            if value:
                result[int(row[0])].append(value)
    except sqlite3.Error:
        # Older schemas may not expose chat_handle_join. Sender handles still
        # provide useful participant data, so continue without this table.
        pass
    return result


def safe_slug(value: str) -> str:
    value = value.casefold().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:90] or "conversation"


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def contact_label(raw: str | None, index: dict[str, dict]) -> tuple[str, str | None]:
    record = index.get(normalize_handle(raw))
    if record:
        return f"@{record['name']}", f"[[{record['rel']}|@{record['name']}]]"
    value = raw or "Unknown"
    return value, None


def escape_chat_body(text: str) -> str:
    text = text.replace("\\", "\\\\").replace("|", "\\|")
    text = text.replace("{{", "\\{\\{").replace("}}", "\\}\\}")
    return text.strip() or "[attachment or reaction]"


def build_note(title: str, day: str, messages: list[dict], participants: dict[str, tuple[str, str | None]],
               chat_key: str) -> str:
    messages.sort(key=lambda item: (item["when"], item["rowid"]))
    start = messages[0]["when"].isoformat()
    end = messages[-1]["when"].isoformat()
    participant_names = sorted({display for display, _ in participants.values()}, key=str.casefold)
    links = sorted({link for _, link in participants.values() if link}, key=str.casefold)
    lines = [
        "---",
        "source: Apple Messages",
        "source_of_truth: Apple Messages",
        "message_service: iMessage",
        f"conversation_key: {yaml_quote(chat_key)}",
        f"conversation_date: {day}",
        f"first_message: {yaml_quote(start)}",
        f"last_message: {yaml_quote(end)}",
        f"message_count: {len(messages)}",
        "ai_index: false",
        "tags:",
        "  - source/messages",
        "  - messages",
        "participants:",
    ]
    for name in participant_names:
        lines.append(f"  - {yaml_quote(name)}")
    lines += ["---", "", f"# {title} — {day}", "", "**Participants:** " + ", ".join(links or participant_names), "", f"**Messages:** {len(messages)}", "", "```chat"]
    if any(item["is_from_me"] for item in messages):
        lines.append("> Me")
    for item in messages:
        sender = item["sender"]
        body = escape_chat_body(item["body"])
        stamp = item["when"].astimezone().strftime("%Y-%m-%d %I:%M %p %Z")
        message_id = item["guid"].replace("--", "")
        alignment = "> " if item["is_from_me"] else ""
        # Chat View requires the bubble line to end immediately after `}}`.
        # Keep provenance on its own HTML-comment line so the renderer can
        # parse the bubble while the importer can still recover message IDs.
        lines.append(f"{{{{{sender}|{body}|{stamp}}}}}")
        lines.append(f"<!-- message_id: {message_id} rowid: {item['rowid']} -->")
    lines += ["```", "", "## Message IDs", "", "<!-- This section is machine-maintained; do not edit message IDs. -->"]
    for item in messages:
        lines.append(f"- `{item['guid']}` — {item['when'].astimezone().isoformat()}")
    return "\n".join(lines) + "\n"


def write_report(status: str, detail: str, imported: int, notes: int, last_rowid: int) -> None:
    content = f"""---
title: Messages Import Report
source: Apple Messages
updated: {datetime.now().astimezone().isoformat()}
---

# Messages importer

- Status: **{status}**
- Messages imported this run: {imported}
- Conversation-day notes changed: {notes}
- Last processed rowid: {last_rowid}
- Database: `~/Library/Messages/chat.db`
- Output: `3 Reference/Sources/Messages/`
- AI indexing: excluded from Smart Connections by default

{detail}
"""
    atomic_write(REPORT_PATH, content)


def run(args: argparse.Namespace) -> int:
    state = load_state()
    contacts = contact_index()
    try:
        conn = open_database(DB_PATH)
        handles_by_chat = chat_handles(conn)
        rows = read_rows(conn, state, args.all_history, args.days, args.limit, args.rebuild)
    except (OSError, sqlite3.Error, RuntimeError) as exc:
        detail = (
            f"The importer could not read the database: `{exc}`\n\n"
            "Grant Full Disk Access to the process that runs this importer (normally `/bin/zsh` or the configured launcher) in System Settings → Privacy & Security → Full Disk Access, then rerun it. No Messages data was changed."
        )
        write_report("blocked", detail, 0, 0, int(state.get("last_rowid", 0) or 0))
        print(detail, file=sys.stderr)
        return 2

    if not rows:
        write_report("no-change", "No new messages matched the configured window.", 0, 0, int(state.get("last_rowid", 0) or 0))
        print("no new messages")
        return 0

    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    participant_maps: dict[tuple[str, str], dict[str, tuple[str, str | None]]] = defaultdict(dict)
    max_rowid = int(state.get("last_rowid", 0) or 0)
    # A rebuild intentionally reprocesses the selected window, even when the
    # normal incremental state already contains those GUIDs.
    imported_guids = set() if args.rebuild else set(state.get("imported_guids", []))
    for row in rows:
        guid = str(row["guid"])
        if guid in imported_guids:
            max_rowid = max(max_rowid, int(row["rowid"]))
            continue
        when = decode_date(row["date"])
        chat_id = row["chat_id"]
        raw_handle = row["handle_value"]
        sender, sender_link = ("Me", None) if row["is_from_me"] else contact_label(raw_handle, contacts)
        chat_key = str(row["chat_identifier"] or row["chat_room"] or chat_id or normalize_handle(raw_handle) or "unknown")
        chat_participant_values = handles_by_chat.get(int(chat_id or 0), [])
        named_participants = [contact_label(value, contacts)[0].lstrip("@") for value in chat_participant_values]
        title = str(row["chat_name"] or (named_participants[0] if len(named_participants) == 1 else "") or (sender if sender != "Me" else "") or row["chat_identifier"] or row["chat_room"] or chat_id or "Messages")
        day = when.astimezone().date().isoformat()
        key = (chat_key, day)
        grouped[key].append({
            "guid": guid, "rowid": int(row["rowid"]), "when": when,
            "is_from_me": bool(row["is_from_me"]), "sender": sender,
            "body": message_text(row), "title": title,
        })
        participant_maps[key][sender] = (sender, sender_link)
        for participant in handles_by_chat.get(int(chat_id or 0), []):
            label, link = contact_label(participant, contacts)
            participant_maps[key][label] = (label, link)
        max_rowid = max(max_rowid, int(row["rowid"]))

    if args.dry_run:
        count = sum(len(items) for items in grouped.values())
        print(f"dry-run: {count} messages in {len(grouped)} conversation-days; last_rowid={max_rowid}")
        return 0

    changed_notes = 0
    for (chat_key, day), messages in grouped.items():
        title = str(messages[0].get("title") or chat_key)
        note_path = OUTPUT_ROOT / day[:4] / day[5:7] / f"{day} - {safe_slug(chat_key)}.md"
        existing = "" if args.rebuild else (note_path.read_text(errors="ignore") if note_path.exists() else "")
        # The first import writes a complete note. Subsequent runs append only
        # new Chat View bubbles and IDs to the existing note.
        if existing:
            existing_ids = set(re.findall(r"<!-- message_id: ([^ ]+)", existing))
            messages = [m for m in messages if m["guid"].replace("--", "") not in existing_ids]
            if not messages:
                continue
            # Preserve the original note's title/frontmatter and append bubbles.
            body_marker = "```chat"
            close = existing.rfind("```")
            if close < 0:
                continue
            append = []
            for item in sorted(messages, key=lambda x: (x["when"], x["rowid"])):
                stamp = item["when"].astimezone().strftime("%Y-%m-%d %I:%M %p %Z")
                append.append(f"{{{{{item['sender']}|{escape_chat_body(item['body'])}|{stamp}}}}}")
                append.append(f"<!-- message_id: {item['guid'].replace('--','')} rowid: {item['rowid']} -->")
            updated = existing[:close] + "\n" + "\n".join(append) + "\n" + existing[close:]
            updated = updated.replace("- `" + messages[0]["guid"] + "`", "- `" + messages[0]["guid"] + "`")
            updated += "\n" + "\n".join(f"- `{m['guid']}` — {m['when'].astimezone().isoformat()}" for m in messages) + "\n"
        else:
            # Use the stable chat identifier for the title when display_name
            # is unavailable; this avoids leaking raw content into filenames.
            updated = build_note(title, day, messages, participant_maps[(chat_key, day)], chat_key)
        atomic_write(note_path, updated)
        changed_notes += 1

    imported = sum(len(items) for items in grouped.values())
    state["last_rowid"] = max_rowid
    state["imported_guids"] = list((set(state.get("imported_guids", [])) | {m["guid"] for items in grouped.values() for m in items}))[-20000:]
    state["runs"] = int(state.get("runs", 0) or 0) + 1
    state["last_run"] = datetime.now().astimezone().isoformat()
    atomic_write(STATE_PATH, json.dumps(state, indent=2, ensure_ascii=False) + "\n")
    write_report("ok", "Read-only import completed. Contact links use existing Apple Contacts notes; no contact notes were created or overwritten.", imported, changed_notes, max_rowid)
    print(f"imported={imported} notes_changed={changed_notes} last_rowid={max_rowid}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all-history", action="store_true", help="Import all available history instead of the default 90-day window")
    parser.add_argument("--days", type=int, default=90, help="Initial bounded import window (default: 90)")
    parser.add_argument("--limit", type=int, default=None, help="Limit messages for a controlled smoke test")
    parser.add_argument("--rebuild", action="store_true", help="Recreate importer-owned notes from the selected history window")
    parser.add_argument("--dry-run", action="store_true", help="Read and report counts without writing notes or state")
    return run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
