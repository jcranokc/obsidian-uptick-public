#!/usr/bin/env python3
"""Move imported Granola content into the meeting template's own sections.

    granola-fill-template.py [--apply]

The Granola sync writes its own headings — Participants, Imported Granola
summary, Explicit commitments — and leaves the template's Context / Agenda /
Discussion / Decisions / Action Items / Follow-up empty. The dashboard reads the
template sections, so every imported meeting rendered blank while the real
content piled up in one long block underneath.

This moves content to where the dashboard already looks:
    Participants           -> attendees: frontmatter (names only; the note keeps
                              the full line with addresses under Provenance)
    Imported Granola summary -> ## Discussion, headings demoted to h3 so they
                              nest under the section instead of competing with
                              the note title
    Explicit commitments   -> ## Action Items as unchecked tasks

Nothing is deleted. Meeting metadata and the participant line move into a
single "## Provenance" block at the end of the note.

Idempotent: a note that already carries the Provenance marker is skipped.
Dry-run by default.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
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
MEETINGS = VAULT / "2 Work/Meetings"
CAL_CACHE = VAULT / "4 System/Automation/calendar-cache.json"
# Granola's own checkpoint records the true start time per granola_id. The note
# itself does not carry one, so without this a title-word match could link a
# late-afternoon ad-hoc recording to an unrelated lunchtime invite.
GRANOLA_STATE = (Path.home() / "Library/Application Support/UptickAutomation"
                 / "granola-sync/granola-sync-state.json")
# How far apart a recording and its invite may start and still be the same
# meeting. Recording usually begins a few minutes late, rarely much more.
MATCH_WINDOW_MIN = 45
MARKER = "## Provenance"

# Sections the meeting template owns. Anything else in an imported note is
# content the importer invented a heading for.
TEMPLATE_SECTIONS = {
    "context", "agenda", "discussion", "decisions", "action items",
    "follow-up", "related knowledge", "provenance", "notes",
}
# Headings the importer uses for work that belongs in a specific template
# section. "Next Steps" is by far the most common and was landing in
# Discussion, which buried the commitments.
ROUTE = {
    "action items": "explicit commitments",
    "next steps": "explicit commitments",
    "explicit commitments": "explicit commitments",
    "commitments": "explicit commitments",
    "follow-ups": "follow-up",
    "follow ups": "follow-up",
    "followups": "follow-up",
    "decisions": "decisions",
}

# The importer sometimes leaks the XML wrapper it reads Granola through.
XML_LEAK_RE = re.compile(
    r"^\s*</?(?:summary|meeting|meetings_data|transcript|note)>\s*$", re.M)

IMPORTED_RE = re.compile(
    r"^##\s+(?!(?:Context|Agenda|Discussion|Decisions|Action Items|Follow-up|"
    r"Related Knowledge|Provenance|Notes)\s*$)\S", re.M | re.I)

STOP = {"the", "a", "an", "and", "or", "for", "with", "to", "of", "on", "in",
        "meeting", "call", "sync", "weekly", "daily", "team", "check", "1", "1:1"}


def words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}", str(s).lower()) if w not in STOP}


def load_granola_times() -> dict[str, str]:
    """granola_id -> ISO start timestamp, from the sync checkpoint."""
    try:
        d = json.loads(GRANOLA_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {m["id"]: m.get("timestamp", "")
            for m in (d.get("remote_meeting_index") or []) if m.get("id")}


def load_calendar() -> list[dict]:
    try:
        d = json.loads(CAL_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return d.get("events", []) if isinstance(d, dict) else (d or [])


def _minutes(ts: str):
    m = re.search(r"T(\d{2}):(\d{2})", str(ts))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def match_event(title: str, date: str, events: list[dict],
                started: str | None = None) -> dict | None:
    """The calendar event this recording actually belongs to.

    Title overlap alone is not enough. Two meetings on the same day can share
    wording — an ad-hoc "permissions" chat at 15:21 and a scheduled
    "permissions review" at 13:00 — and matching on words alone linked the
    recording to the wrong invite and overwrote its time. When Granola knows
    when the recording started, the invite must also start near it.
    """
    tw = words(title)
    if not tw:
        return None
    want = _minutes(started) if started else None

    best, best_score = None, 0
    for e in events:
        if not str(e.get("start", "")).startswith(date):
            continue
        if want is not None:
            got = _minutes(e.get("start", ""))
            if got is None or abs(got - want) > MATCH_WINDOW_MIN:
                continue
        score = len(tw & words(e.get("title", "")))
        if score > best_score:
            best, best_score = e, score
    if best_score < 2:
        return None
    # With no known start time a word match is a guess, so require a strong one
    # rather than silently stamping a time onto the note.
    if want is None and best_score < 3:
        return None
    return best


def split_sections(body: str) -> list[tuple[str, str]]:
    """[(heading_or_None, text)] preserving order; heading is the '## X' line."""
    out, cur, head = [], [], None
    for line in body.split("\n"):
        if re.match(r"^##\s+\S", line):
            out.append((head, "\n".join(cur)))
            head, cur = line, []
        else:
            cur.append(line)
    out.append((head, "\n".join(cur)))
    return out


def clean_participants(raw: str) -> tuple[list[str], str]:
    """-> (display names, original line un-escaped)."""
    text = html.unescape(raw).strip()
    names = []
    for chunk in re.split(r"[;\n]+", text):
        chunk = chunk.strip()
        if not chunk:
            continue
        chunk = re.sub(r"<[^>]*>", "", chunk).strip()
        chunk = re.sub(r"\((?:note creator|organizer)\)", "", chunk, flags=re.I).strip()
        chunk = chunk.strip(" ,")
        if chunk:
            names.append(chunk)
    seen, uniq = set(), []
    for n in names:
        if n.lower() not in seen:
            seen.add(n.lower()); uniq.append(n)
    return uniq, text


def demote(text: str) -> str:
    """Granola emits h1 inside the note; push everything down to h3."""
    out = []
    for line in text.split("\n"):
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        out.append(f"### {m.group(2)}" if m else line)
    return "\n".join(out)


def to_tasks(text: str) -> list[str]:
    """Commitments as checkboxes, with their detail kept as detail.

    Granola writes each commitment as a bullet followed by an indented
    explanation. Turning every line into its own checkbox produced two tasks
    per commitment — the ask, then a fragment of context masquerading as work.
    """
    out = []
    for raw in text.split("\n"):
        if not raw.strip():
            continue
        # Entities survive the import as literal "&apos;" / "&amp;".
        line = html.unescape(raw)
        # Two signals that a line is context rather than a commitment: source
        # indentation, or following a bolded commitment without being bolded
        # itself. Granola always bolds the ask and leaves the detail plain.
        indented = bool(re.match(r"^\s{2,}\S", line)) and not re.match(r"^\s*[-*]\s", line)
        stripped = re.sub(r"^\s*[-*]\s+(\[[ xX]\]\s*)?", "", line).strip()
        if not indented and out and not stripped.startswith("**"):
            prev = out[-1].lstrip()
            if prev.startswith("- [ ] **"):
                indented = True
        s = re.sub(r"^\s*[-*]\s+(\[[ xX]\]\s*)?", "", line).strip()
        if not s:
            continue
        if indented and out:
            # Context for the commitment above, not a task of its own.
            out.append(f"      {s}")
        else:
            out.append(f"- [ ] {s}")
    return out


def process(path: Path, events: list[dict],
            granola_times: dict[str, str] | None = None) -> tuple[bool, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return False, "no frontmatter"
    end = text.find("\n---", 3)
    if end == -1:
        return False, "unterminated frontmatter"
    fm, body = text[3:end], text[end + 4:]
    sections_now = {(h.lstrip("#").strip().lower() if h else None): c
                    for h, c in split_sections(body)}
    discussion_filled = bool(sections_now.get("discussion", "").strip())
    # A note can carry the Provenance marker from an earlier partial run while
    # Discussion is still empty. The marker alone is not proof of migration —
    # the template actually holding content is.
    if MARKER in body and discussion_filled:
        return False, "already migrated"
    # The importer is an LLM and names this section differently almost every
    # run — "Imported Granola summary", "details", "notes", "Curated Summary".
    # Rather than chase labels, treat any non-template section as importable
    # content and migrate whenever the template's own Discussion is still empty.
    if not IMPORTED_RE.search(body):
        return False, "nothing to move"
    if discussion_filled:
        return False, "discussion already filled"

    body = XML_LEAK_RE.sub("", body)
    sections = split_sections(body)
    keep, moved = [], {}
    for head, content in sections:
        if head is None:
            keep.append((head, content)); continue
        name = head.lstrip("#").strip().lower()
        if name in ("participants",):
            moved["participants"] = content
            continue
        if name in ROUTE and content.strip():
            dest = ROUTE[name]
            moved[dest] = (moved.get(dest, "") + "\n" + content).strip()
            continue
        if name in ("meeting metadata", "source", "provenance"):
            moved.setdefault("meeting metadata",
                             (moved.get("meeting metadata", "") + "\n" + content).strip())
            continue
        if name not in TEMPLATE_SECTIONS:
            # Whatever the importer called it, this is meeting content.
            moved["imported granola summary"] = (
                moved.get("imported granola summary", "") + f"\n### {head.lstrip('#').strip()}\n" + content
            )
            continue
        keep.append((head, content))

    names, raw_participants = clean_participants(moved.get("participants", ""))
    summary = moved.get("imported granola summary", "").strip()

    # Granola nests its own headings *inside* the section it writes, at whatever
    # level it likes, so a "Next Steps" block is usually a sub-heading rather
    # than a section of its own. Pull the routable ones out of the summary so
    # commitments do not end up buried in Discussion.
    if summary:
        kept, current, buf = [], None, []

        def flush():
            if current and current in ROUTE:
                dest = ROUTE[current]
                moved[dest] = (moved.get(dest, "") + "\n" + "\n".join(buf)).strip()
            elif buf or current:
                if current:
                    kept.append("#" * 3 + " " + current.title())
                kept.extend(buf)

        for line in summary.split("\n"):
            h = re.match(r"^#{1,6}\s+(.*?)\s*$", line)
            if h:
                flush()
                current, buf = h.group(1).strip().lower(), []
            else:
                buf.append(line)
        flush()
        summary = "\n".join(kept).strip()
    commitments = moved.get("explicit commitments", "").strip()
    metadata = moved.get("meeting metadata", "").strip()

    # merge into the template's sections
    rebuilt = []
    for head, content in keep:
        if head is None:
            rebuilt.append(content); continue
        name = head.lstrip("#").strip().lower()
        if name == "discussion" and summary and not content.strip():
            content = "\n" + demote(summary) + "\n"
        elif name == "decisions" and moved.get("decisions") and not content.strip():
            content = "\n" + moved["decisions"].strip() + "\n"
        elif name == "follow-up" and moved.get("follow-up") and not content.strip():
            content = "\n" + moved["follow-up"].strip() + "\n"
        elif name == "action items" and commitments:
            tasks = to_tasks(commitments)
            existing = [l for l in content.split("\n") if l.strip()]
            if not existing:
                content = "\n" + "\n".join(tasks) + "\n"
        rebuilt.append(head + "\n" + content)

    out_body = "\n".join(rebuilt).rstrip() + "\n"

    if MARKER in out_body:
        out_body = out_body[:out_body.index(MARKER)].rstrip() + "\n"
    prov = ["", MARKER, "",
            "> [!info]- Imported from Granola",
            "> Kept for traceability. The content above was moved into this",
            "> template's own sections by `granola-fill-template.py`."]
    for line in (metadata or "").strip().split("\n"):
        if line.strip():
            prov.append("> " + line.strip())
    if raw_participants:
        prov += ["> ", "> **Participants as imported:** " + raw_participants.replace("\n", "; ")]
    prov.append("")
    out_body += "\n".join(prov)

    # calendar event for the same day, when one lines up
    fm_title = re.search(r'^title:\s*"?(.+?)"?\s*$', fm, re.M)
    fm_date = re.search(r"^meeting_date:\s*(\d{4}-\d{2}-\d{2})", fm, re.M)
    ev = None
    gid = re.search(r"^granola_id:\s*\"?([0-9a-f-]{36})", fm, re.M)
    started = (granola_times or {}).get(gid.group(1)) if gid else None
    if fm_date:
        ev = match_event(fm_title.group(1) if fm_title else path.stem,
                         fm_date.group(1), events, started)
    # The recording's own start time is the truth for this note, whether or not
    # an invite was found.
    if started:
        hhmm = re.search(r"T(\d{2}:\d{2})", started)
        # The key often exists but empty, so "absent" is not the test — "has no
        # value" is.
        if hhmm and not re.search(r"^time:\s*\S", fm, re.M):
            line = f'time: "{hhmm.group(1)}"'
            if re.search(r"^time:\s*$", fm, re.M):
                fm = re.sub(r"^time:\s*$", line, fm, count=1, flags=re.M)
            else:
                fm = fm.rstrip("\n") + "\n" + line + "\n"
    if ev:
        for key, val in (("calendar_event", ev.get("id", "")),
                         ("location", ev.get("location") or ""),
                         ("time", (ev.get("start") or "")[11:16])):
            if not val:
                continue
            line = f'{key}: "{val}"'
            if re.search(rf"^{key}:.*$", fm, re.M):
                fm = re.sub(rf"^{key}:.*$", line, fm, count=1, flags=re.M)
            else:
                fm = fm.rstrip("\n") + "\n" + line + "\n"
        prov_extra = f"> **Matched calendar event:** {ev.get('title','')} "\
                     f"({(ev.get('start') or '')[:16].replace('T', ' ')})"
        out_body = out_body.rstrip("\n") + "\n" + prov_extra + "\n"
        # calendar attendees beat Granola's participant line when present
        # The calendar cache stores attendees as "Name <addr>" strings, though
        # an older shape used objects — handle both rather than assuming.
        cal_people = []
        for a in (ev.get("attendees") or []):
            if isinstance(a, dict):
                cal_people.append(a.get("name") or a.get("email") or "")
            else:
                cal_people.append(str(a))
        cal_people = [c.strip() for c in cal_people if c and c.strip()]
        if cal_people:
            names = cal_people

    # attendees into frontmatter, without disturbing the rest of it
    if names:
        line = "attendees: [" + ", ".join(f'"{n}"' for n in names) + "]"
        if re.search(r"^attendees:.*$", fm, re.M):
            fm = re.sub(r"^attendees:.*$", line, fm, count=1, flags=re.M)
        else:
            fm = fm.rstrip("\n") + "\n" + line + "\n"

    return True, "---" + fm + "\n---\n" + out_body


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    events = load_calendar()
    granola_times = load_granola_times()
    done, skip = [], {}
    for p in sorted(MEETINGS.rglob("*.md")):
        head = p.read_text(encoding="utf-8", errors="replace")[:400]
        if not re.search(r"^type:\s*meeting\s*$", head, re.M):
            continue
        ok, res = process(p, events, granola_times)
        if not ok:
            skip.setdefault(res, []).append(p.stem)
            continue
        done.append(p.stem)
        if a.apply:
            p.write_text(res, encoding="utf-8")

    print(f"=== {'migrated' if a.apply else 'would migrate'}: {len(done)} ===")
    for n in done[:40]:
        print(f"  {n}")
    for k, v in skip.items():
        print(f"\n=== skipped ({k}): {len(v)} ===")
        for n in v[:6]:
            print(f"  {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
