"""Load optional, local-only Uptick companion configuration.

The public repository intentionally contains no personal identifiers, account
IDs, or organization-specific rules. A vault owner may keep those values in
``4 System/Automation/.uptick-private.env`` (or a path named by
``UPTICK_CONFIG_FILE``). That file is never executed; only the small allowlist
below is parsed.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path


ALLOWED_ENV_KEYS = {
    "UPTICK_CALENDAR_ID",
    "UPTICK_CALENDAR_MATCH",
    "UPTICK_REMINDER_LIST_ID",
    "UPTICK_OWNER_PATTERN",
    "UPTICK_ASSIGNEE_MARKERS",
    "UPTICK_SERIES_RULES_FILE",
}


def private_env_path(vault: Path) -> Path:
    configured = os.environ.get("UPTICK_CONFIG_FILE", "").strip()
    return Path(configured).expanduser() if configured else vault / "4 System/Automation/.uptick-private.env"


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_private_env(vault: Path) -> Path | None:
    """Load recognised keys without overriding an explicitly exported value."""
    path = private_env_path(vault)
    if not path.is_file():
        return None
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in ALLOWED_ENV_KEYS:
            os.environ.setdefault(key, _unquote(value))
    return path


def load_series_rules(vault: Path) -> tuple[list[tuple[re.Pattern, str]], list[re.Pattern]]:
    """Load private recurring-series merge and skip rules, if configured."""
    configured = os.environ.get("UPTICK_SERIES_RULES_FILE", "").strip()
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = vault / path
    else:
        path = vault / "4 System/Automation/.uptick-series-rules.json"
    if not path.is_file():
        return [], []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid private series rules: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("private series rules must be a JSON object")

    merge: list[tuple[re.Pattern, str]] = []
    for item in data.get("merge", []):
        if not isinstance(item, dict) or not isinstance(item.get("pattern"), str) or not isinstance(item.get("title"), str):
            raise ValueError("each merge rule needs string pattern and title fields")
        try:
            merge.append((re.compile(item["pattern"], re.I), item["title"].strip()))
        except re.error as exc:
            raise ValueError(f"invalid private merge pattern: {exc}") from exc

    skip: list[re.Pattern] = []
    for pattern in data.get("skipTitles", []):
        if not isinstance(pattern, str):
            raise ValueError("each skipTitles entry must be a string")
        try:
            skip.append(re.compile(pattern, re.I))
        except re.error as exc:
            raise ValueError(f"invalid private skip pattern: {exc}") from exc
    return merge, skip
