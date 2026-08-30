#!/usr/bin/env python3
"""Build art-bundle.json: every achievement icon, small enough to ship.

The full-resolution icons are 78MB and have to be a separate download. That
made artwork a second manual step that a new install had no way to know about,
and the page looked unfinished until someone did it.

These are the same icons at ICON_PX, which is enough for the 44px browser tile
and the ~160px unlock popup on a retina display. At that size the whole set is
a few megabytes -- one more file next to main.js, and Setup writes them into
the vault so artFor finds them with no extra step and you can still replace any
of them by hand.

    python3 tools/build-art-bundle.py
"""

import base64
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICON_PX = 128
LIMIT_MB = 12


def main() -> int:
    src = sorted((ROOT / "art/achievements").glob("*.png"))
    if not src:
        sys.exit("build-art-bundle: no icons found")

    bundle = {}
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        for f in src:
            small = work / f.name
            shutil.copy2(f, small)
            subprocess.run(["sips", "-Z", str(ICON_PX), str(small)],
                           capture_output=True, check=False)
            bundle[f.stem] = base64.b64encode(small.read_bytes()).decode("ascii")

    out = ROOT / "art-bundle.json"
    out.write_text(json.dumps({"px": ICON_PX, "ext": "png", "icons": bundle},
                              separators=(",", ":")) + "\n")
    mb = out.stat().st_size / 1048576
    print(f"build-art-bundle: {len(bundle)} icons at {ICON_PX}px -> {mb:.1f}MB")
    if mb > LIMIT_MB:
        sys.exit(f"build-art-bundle: {mb:.1f}MB is past the {LIMIT_MB}MB limit. "
                 "Lower ICON_PX rather than shipping something this big beside "
                 "a plugin that is otherwise under half a megabyte.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
