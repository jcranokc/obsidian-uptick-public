#!/usr/bin/env python3
"""Build achievement-art.zip for a release.

The zip's top-level folder MUST be "Achievement Art", because the whole point
is that a user unzips it into their game folder and the plugin finds the icons
without renaming anything. Zipping art/achievements straight from the repo
produces a folder called "achievements", which unzips beside the real one and
leaves the page still showing bare medallions -- shipped exactly once, and
found only by installing it.

    python3 tools/pack-art.py [--out PATH]
"""

import argparse
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Must match DEFAULTS.paths.game + "/Achievement Art" in main.js.
FOLDER = "Achievement Art"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/achievement-art.zip")
    a = ap.parse_args()

    src = ROOT / "art/achievements"
    icons = sorted(src.glob("*.png"))
    if not icons:
        sys.exit(f"pack-art: no icons in {src}")

    out = Path(a.out)
    out.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory() as td:
        staged = Path(td) / FOLDER
        staged.mkdir()
        for f in icons:
            shutil.copy2(f, staged / f.name)
        readme = ROOT / "art/README.md"
        if readme.exists():
            shutil.copy2(readme, staged / "README.md")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(staged.rglob("*")):
                z.write(f, f.relative_to(td))

    with zipfile.ZipFile(out) as z:
        tops = {n.split("/")[0] for n in z.namelist()}
    if tops != {FOLDER}:
        sys.exit(f"pack-art: expected one top folder {FOLDER!r}, got {sorted(tops)}")
    print(f"pack-art: {out} \u2014 {len(icons)} icons under {FOLDER}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
