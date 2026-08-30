#!/usr/bin/env python3
"""Backfill summary frontmatter on RSS scheduler/importer notes."""
from __future__ import annotations

import json
import os
import re
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
ROOT = VAULT / "3 Reference/Sources/RSS"


def clean(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value)
    return " ".join(value.replace("&nbsp;", " ").split())[:500]


def main() -> None:
    changed = 0
    for path in ROOT.rglob("*.md"):
        if path.name in {"RSS.md", "RSS Dashboard.md"}:
            continue
        raw = path.read_text(encoding="utf-8")
        if not raw.startswith("---\n"):
            continue
        end = raw.find("\n---\n", 4)
        if end < 0 or re.search(r"^summary:", raw[:end], re.MULTILINE):
            continue
        body = raw[end + 5:]
        heading = re.search(r"^# .+\n\n", body, re.MULTILINE)
        if heading:
            body = body[heading.end():]
        body = re.sub(r"^\[Open original article\]\([^\n]+\)\s*", "", body, count=1)
        summary = clean(body)
        if not summary:
            summary = "Imported article from the configured RSS feed."
        frontmatter = raw[:end]
        insert = f"summary: {json.dumps(summary, ensure_ascii=False)}\n"
        frontmatter = frontmatter + "\n" + insert.rstrip("\n")
        path.write_text(frontmatter + raw[end:], encoding="utf-8")
        changed += 1
    print(f"backfilled={changed}")


if __name__ == "__main__":
    main()
