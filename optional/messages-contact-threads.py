#!/usr/bin/env python3
"""Build contact-level Apple Messages views from imported date notes.

This is intentionally a vault-only projection. The date-grouped notes remain
the canonical imported records; these contact pages are regenerated from them
and never read or write the Messages database.
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import datetime
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
SOURCE_ROOT = VAULT / "3 Reference/Sources/Messages"
THREAD_ROOT = SOURCE_ROOT / "Contacts"
CONTACT_ROOT = VAULT / "3 Reference/People/Apple Contacts"
CONTACT_LINK_PREFIX = "3 Reference/People/Apple Contacts/"


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def safe_slug(value: str) -> str:
    value = value.casefold().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:90] or "contact"


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value[1:-1]
    return value


def contact_records() -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for path in sorted(CONTACT_ROOT.rglob("*.md")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"^apple_contact_name:\s*(.+)$", text, re.M)
        if not match:
            continue
        name = unquote(match.group(1))
        rel = path.relative_to(VAULT).with_suffix("").as_posix()
        result[name.casefold()] = {"name": name, "rel": rel, "path": str(path)}
    return result


def parse_note(path: Path) -> tuple[dict, list[dict], list[tuple[str, str]]]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    frontmatter: dict[str, str] = {}
    in_frontmatter = False
    for line in text.splitlines():
        if line.strip() == "---":
            if not in_frontmatter:
                in_frontmatter = True
                continue
            break
        if in_frontmatter:
            match = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
            if match:
                frontmatter[match.group(1)] = unquote(match.group(2))

    links = [(target, label) for target, label in re.findall(
        r"\[\[([^]|]+)\|@([^]]+)\]\]", text
    ) if target.startswith(CONTACT_LINK_PREFIX)]
    messages: list[dict] = []
    last_message: dict | None = None
    for line in text.splitlines():
        id_match = re.match(r"^<!-- message_id:\s*([^ ]+)\s+rowid:\s*(\d+) -->$", line.strip())
        if id_match:
            if last_message is not None:
                last_message["message_id"] = id_match.group(1)
            continue
        bubble = re.match(r"^\{\{([^|\n]*)\|([\s\S]*?)\|([^|\n]*)\}\}$", line.strip())
        if not bubble:
            continue
        sender, body, stamp = bubble.groups()
        messages.append({
            "sender": sender.strip(),
            "body": body.strip(),
            "stamp": stamp.strip(),
            "message_id": "",
            "source": path.relative_to(VAULT).with_suffix("").as_posix(),
            "source_title": path.stem,
        })
        last_message = messages[-1]
    return frontmatter, messages, links


def escape_body(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("{{", "\\{\\{").replace("}}", "\\}\\}")


def message_sort_key(item: dict) -> tuple:
    try:
        return (datetime.strptime(item["stamp"][:19], "%Y-%m-%d %I:%M %p"), item["source"], item["message_id"])
    except (ValueError, TypeError):
        return (datetime.max, item.get("source", ""), item.get("message_id", ""))


def build_thread(name: str, record: dict[str, str], messages: list[dict], sources: list[str]) -> str:
    messages.sort(key=message_sort_key)
    source_links = sorted(set(sources))
    lines = [
        "---",
        "source: Apple Messages",
        "source_of_truth: Apple Messages",
        "message_service: iMessage",
        "view: contact-thread",
        f"contact: {yaml_quote('@' + name)}",
        f"contact_note: {yaml_quote(record['rel'])}",
        f"message_count: {len(messages)}",
        f"source_note_count: {len(source_links)}",
        "ai_index: false",
        "tags:",
        "  - source/messages",
        "  - messages/contact-thread",
        "---",
        "",
        f"# {name} — Messages",
        "",
        f"**Contact:** [[{record['rel']}|@{name}]]",
        "",
        f"**Direct messages:** {len(messages)}",
        "",
        "```chat",
        "> Me",
    ]
    for item in messages:
        lines.append(f"{{{{{item['sender']}|{escape_body(item['body'])}|{item['stamp']}}}}}")
        if item["message_id"]:
            lines.append(f"<!-- message_id: {item['message_id']} -->")
    lines += ["```", "", "## Source notes", ""]
    for source in source_links:
        lines.append(f"- [[{source}|{Path(source).name}]]")
    lines += ["", "## Message IDs", "", "<!-- This section is machine-maintained; do not edit message IDs. -->"]
    for item in messages:
        if item["message_id"]:
            lines.append(f"- `{item['message_id']}` — {item['stamp']}")
    return "\n".join(lines) + "\n"


def append_contact_link(record: dict[str, str], thread_rel: str) -> bool:
    path = Path(record["path"])
    text = path.read_text(encoding="utf-8", errors="ignore")
    marker = "## Apple Messages"
    link = f"[[{thread_rel}|Open Messages thread]]"
    if link in text:
        return False
    addition = f"\n\n{marker}\n\n{link}\n"
    atomic_write(path, text.rstrip() + addition)
    return True


def build_index(generated_pages: list[tuple[str, str, int]]) -> str:
    lines = [
        "---",
        "title: Contact message threads",
        "source: Apple Messages",
        "ai_index: false",
        "tags:",
        "  - source/messages",
        "  - system/index",
        "---",
        "",
        "# Contact message threads",
        "",
        "Generated one-person views of direct Apple Messages history. The dated conversation notes remain the canonical source.",
        "",
    ]
    for name, rel, count in sorted(generated_pages, key=lambda item: item[0].casefold()):
        lines.append(f"- [[{rel}|@{name}]] — {count} direct messages")
    return "\n".join(lines) + "\n"


def main() -> int:
    records = contact_records()
    direct_by_contact: dict[str, list[dict]] = defaultdict(list)
    sources_by_contact: dict[str, set[str]] = defaultdict(set)
    scanned = 0
    for path in sorted(SOURCE_ROOT.rglob("*.md")):
        if path.is_relative_to(THREAD_ROOT) or path.name == "Messages.md":
            continue
        frontmatter, messages, links = parse_note(path)
        if not messages or not links:
            continue
        scanned += 1
        conversation_key = frontmatter.get("conversation_key", "")
        # Contact pages contain direct one-to-one messages. Group chats remain
        # discoverable through their original source notes and are not copied
        # into a misleading one-person transcript.
        is_direct = not conversation_key.startswith("chat") and len(links) == 1
        if not is_direct:
            continue
        target, label = links[0]
        name = label.lstrip("@")
        record = records.get(name.casefold())
        if not record:
            continue
        direct_by_contact[name.casefold()].extend(messages)
        sources_by_contact[name.casefold()].add(path.relative_to(VAULT).with_suffix("").as_posix())

    THREAD_ROOT.mkdir(parents=True, exist_ok=True)
    generated = 0
    linked = 0
    generated_pages: list[tuple[str, str, int]] = []
    for key, messages in sorted(direct_by_contact.items()):
        record = records.get(key)
        if not record:
            continue
        name = record["name"]
        thread_path = THREAD_ROOT / f"{safe_slug(name)}.md"
        thread_rel = thread_path.relative_to(VAULT).with_suffix("").as_posix()
        atomic_write(thread_path, build_thread(name, record, messages, sorted(sources_by_contact[key])))
        generated += 1
        generated_pages.append((name, thread_rel, len(messages)))
        if append_contact_link(record, thread_rel):
            linked += 1
    atomic_write(THREAD_ROOT / "Contacts.md", build_index(generated_pages))
    print(f"contact_threads={generated} contact_notes_linked={linked} direct_source_notes={scanned}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
