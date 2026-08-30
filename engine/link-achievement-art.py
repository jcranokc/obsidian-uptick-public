#!/usr/bin/env python3
"""Match a folder of generated images to achievements and file them by slug.

USAGE
    link-achievement-art.py SOURCE_DIR [--apply] [--move] [--loose]

WHY
    Uptick shows an achievement's artwork by looking for a file named after its
    slug:  4 System/Game/Achievement Art/<slug>.png

    Images from an image generator rarely come out named that way -- they arrive
    as "First Blood.png", "achievement_001 (1).png", "first blood icon.png" or
    worse. This matches whatever you have against the live catalog and files it
    under the right slug, so the art shows up without renaming 258 files by hand.

MATCHING, strongest first
    1. the filename already IS the slug
    2. the filename slugifies to a slug          "First Blood.png"
    3. the filename slugifies to an achievement NAME
    4. a slug or name appears inside a longer filename
    5. --loose only: best token-overlap match above a threshold

    Anything ambiguous is reported, never guessed. Nothing is written without
    --apply, and an existing file is never overwritten.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
LOOSE_THRESHOLD = 0.60
# Words that appear in generated filenames and carry no identifying signal.
NOISE = {"achievement", "achievements", "icon", "icons", "badge", "badges",
         "art", "image", "img", "final", "copy", "v1", "v2", "new", "uptick"}


def require_vault() -> Path:
    v = os.environ.get("VAULT")
    if not v:
        sys.exit("link-achievement-art: set VAULT to your vault path")
    p = Path(v)
    if not p.is_dir():
        sys.exit(f"link-achievement-art: VAULT is not a directory: {v}")
    return p


def slugify(text: str) -> str:
    text = re.sub(r"['’]", "", str(text).lower())
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def tokens(text: str) -> set:
    return {t for t in slugify(text).split("-") if t and t not in NOISE}


def strip_generator_noise(stem: str) -> str:
    """Drop the decoration image tools add: trailing (1), _final, leading index."""
    s = re.sub(r"\s*\(\d+\)\s*$", "", stem)
    s = re.sub(r"^\d{1,4}[\s._-]+", "", s)
    s = re.sub(r"[\s._-]+(final|copy|v\d+|\d+x\d+)$", "", s, flags=re.I)
    return s.strip()


def load_catalog(vault: Path) -> list[dict]:
    cache = vault / "4 System/Automation/achievements-cache.json"
    try:
        data = json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"link-achievement-art: cannot read {cache}: {e}")
    items = data.get("achievements") or []
    if not items:
        sys.exit("link-achievement-art: catalog is empty")
    return items


def match(stem: str, by_slug: dict, by_name: dict, loose: bool) -> tuple:
    """Return (slug, how, confidence). slug is None when nothing matched."""
    clean = strip_generator_noise(stem)
    s = slugify(clean)

    if s in by_slug:
        return s, "slug", 1.0
    if s in by_name:
        return by_name[s], "name", 1.0

    # a known slug or name embedded in a longer filename
    contained = [v for k, v in list(by_slug.items()) + list(by_name.items())
                 if k and (f"-{k}-" in f"-{s}-")]
    if len(set(contained)) == 1:
        return contained[0], "contained", 0.9
    if len(set(contained)) > 1:
        return None, f"ambiguous ({len(set(contained))} candidates)", 0.0

    if not loose:
        return None, "no match", 0.0

    ft = tokens(clean)
    if not ft:
        return None, "no usable words", 0.0
    best, score = None, 0.0
    for key, slug in list(by_slug.items()) + list(by_name.items()):
        kt = tokens(key)
        if not kt:
            continue
        overlap = len(ft & kt) / len(ft | kt)
        if overlap > score:
            best, score = slug, overlap
    if best and score >= LOOSE_THRESHOLD:
        return best, f"loose {score:.0%}", score
    return None, f"best guess too weak ({score:.0%})", score


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="folder holding the generated images")
    ap.add_argument("--apply", action="store_true", help="actually write files")
    ap.add_argument("--move", action="store_true", help="move instead of copy")
    ap.add_argument("--loose", action="store_true",
                    help="also accept fuzzy token-overlap matches")
    a = ap.parse_args()

    vault = require_vault()
    dest = vault / "4 System/Game/Achievement Art"
    src = Path(a.source).expanduser()
    if not src.is_dir():
        sys.exit(f"link-achievement-art: not a directory: {src}")

    items = load_catalog(vault)
    by_slug = {it["slug"]: it["slug"] for it in items}
    by_name = {slugify(it["name"]): it["slug"] for it in items}

    images = sorted(p for p in src.rglob("*") if p.suffix.lower() in EXTS)
    if not images:
        sys.exit(f"link-achievement-art: no images under {src}")

    # Resolve every file first, then assign strongest-match-first: otherwise a
    # weaker match claims a slug simply by sorting earlier, and the file that
    # was named correctly loses to one that was not.
    resolved = [(p, *match(p.stem, by_slug, by_name, a.loose)) for p in images]
    # Tie-break toward a file that is already named exactly right: two files can
    # both resolve to the same slug with full confidence ("First Blood.png" and
    # "first-blood.png"), and the one that needs no renaming should win.
    resolved.sort(key=lambda r: (-(r[3] or 0), 0 if r[0].stem == r[1] else 1, r[0].name))

    matched, skipped, failed, taken = [], [], [], {}
    for p, slug, how, _conf in resolved:
        if not slug:
            failed.append((p, how))
            continue
        if slug in taken:
            failed.append((p, f"slug already claimed by {taken[slug].name}"))
            continue
        target = dest / f"{slug}{p.suffix.lower()}"
        if target.exists():
            skipped.append((p, slug))
            continue
        taken[slug] = p
        matched.append((p, target, how))

    for p, t, how in matched:
        print(f"  match   {p.name[:44]:<46} -> {t.name}  ({how})")
    for p, slug in skipped:
        print(f"  exists  {p.name[:44]:<46} -> {slug} already has art")
    for p, why in failed:
        print(f"  MISS    {p.name[:44]:<46} {why}")

    if a.apply and matched:
        dest.mkdir(parents=True, exist_ok=True)
        for p, t, _ in matched:
            (shutil.move if a.move else shutil.copy2)(str(p), str(t))

    print(f"\n{len(matched)} matched · {len(skipped)} already present · "
          f"{len(failed)} unmatched · {len(items)} achievements total")
    if not a.apply:
        print("dry run — nothing written. Re-run with --apply.")
    else:
        # Counted after writing, not added to it: the files just copied are
        # already on disk and adding them again reports double.
        have = len({f.stem for f in dest.glob("*") if f.suffix.lower() in EXTS})
        print(f"art folder now covers {have} of {len(items)} achievements")
    if failed and not a.loose:
        print("unmatched files? try --loose for fuzzy name matching")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
