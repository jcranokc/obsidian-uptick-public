#!/usr/bin/env python3
"""Check the tracked Uptick release payload against local-only audit terms."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TERMS_FILE = Path(os.environ.get("UPTICK_RELEASE_AUDIT_TERMS_FILE", ROOT / ".uptick-release-audit-terms"))


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    )
    return [ROOT / item for item in result.stdout.decode("utf-8").split("\0") if item]


def main() -> int:
    terms: list[str] = []
    if TERMS_FILE.is_file():
        terms = [line.strip() for line in TERMS_FILE.read_text(encoding="utf-8").splitlines()
                 if line.strip() and not line.lstrip().startswith("#")]
    else:
        print("No local audit-term file found; running tracked payload checks only.")

    findings: list[Path] = []
    for path in tracked_files():
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if any(term in text for term in terms):
            findings.append(path.relative_to(ROOT))

    if findings:
        print("Release audit failed: local audit terms matched tracked files:")
        for path in findings:
            print(f"- {path}")
        return 1
    print(f"Release audit passed ({len(terms)} local terms checked; tracked payload only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
