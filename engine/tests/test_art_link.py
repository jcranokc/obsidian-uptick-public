#!/usr/bin/env python3
"""Tests for engine/link-achievement-art.py.

Art filing is destructive-adjacent -- it copies files into the vault under new
names -- so the properties worth pinning are about what it REFUSES to do:
never overwrite, never guess between two candidates, never let a weak match
claim a slug a strong one wanted.
"""

import importlib.util, json, os, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FAILS = []


def check(name, got, want):
    if got != want:
        FAILS.append(f"{name}: got {got!r}, want {want!r}")


def ok(name, cond):
    if not cond:
        FAILS.append(name)


with tempfile.TemporaryDirectory() as td:
    V = Path(td) / "vault"
    (V / "4 System/Automation").mkdir(parents=True)
    (V / "4 System/Game/Achievement Art").mkdir(parents=True)
    (V / "4 System/Automation/achievements-cache.json").write_text(json.dumps({
        "achievements": [
            {"slug": "first-blood", "name": "First Blood"},
            {"slug": "epic-slayer", "name": "Epic Slayer"},
            {"slug": "tomorrows-problem", "name": "Tomorrow's Problem"},
            {"slug": "centurion", "name": "Centurion"},
            {"slug": "green-light", "name": "Green Light"},
            {"slug": "red-light", "name": "Red Light"},
        ]}))
    os.environ["VAULT"] = str(V)
    spec = importlib.util.spec_from_file_location("al", ROOT / "engine/link-achievement-art.py")
    al = importlib.util.module_from_spec(spec); spec.loader.exec_module(al)

    items = al.load_catalog(V)
    by_slug = {i["slug"]: i["slug"] for i in items}
    by_name = {al.slugify(i["name"]): i["slug"] for i in items}
    m = lambda stem, loose=False: al.match(stem, by_slug, by_name, loose)[0]

    # --- slugify -----------------------------------------------------------
    check("slugify: spaces", al.slugify("First Blood"), "first-blood")
    check("slugify: apostrophe", al.slugify("Tomorrow's Problem"), "tomorrows-problem")
    check("slugify: curly apostrophe", al.slugify("Tomorrow’s Problem"), "tomorrows-problem")
    check("slugify: punctuation", al.slugify("Green  Light!!"), "green-light")

    # --- the shapes image generators actually produce -----------------------
    check("match: exact slug", m("first-blood"), "first-blood")
    check("match: display name", m("First Blood"), "first-blood")
    check("match: apostrophe name", m("Tomorrow's Problem"), "tomorrows-problem")
    check("match: leading index", m("023_epic-slayer"), "epic-slayer")
    check("match: trailing dup marker", m("centurion (1)"), "centurion")
    check("match: _final suffix", m("centurion_final"), "centurion")
    check("match: embedded in noise", m("achievement_007 Centurion icon"), "centurion")
    check("match: unrelated", m("a photo of my dog"), None)

    # --- it must not guess ---------------------------------------------------
    check("match: noise-only filename", m("achievement icon final"), None)
    check("match: weak overlap refused under --loose", m("light", loose=True), None)
    check("match: two candidates refused, not guessed",
          m("green-light-and-red-light"), None)
    ok("match: ambiguity is reported as such",
       "ambiguous" in al.match("green-light-and-red-light", by_slug, by_name, False)[1])
    check("match: strong overlap accepted under --loose",
          m("green light achievement", loose=True), "green-light")

    # --- assignment: strongest match claims the slug -------------------------
    src = Path(td) / "src"; src.mkdir()
    contents = {"First Blood.png": b"WRONGLY-NAMED", "first-blood.png": b"CORRECTLY-NAMED",
                "Epic Slayer.png": b"epic", "a photo of my dog.png": b"dog"}
    for f, body in contents.items():
        (src / f).write_bytes(body)
    dest = V / "4 System/Game/Achievement Art"

    sys.argv = ["x", str(src)]
    al.main()
    ok("apply: dry run writes nothing", not list(dest.glob("*.png")))

    sys.argv = ["x", str(src), "--apply"]
    al.main()
    check("apply: files written", sorted(p.name for p in dest.glob("*.png")),
          ["epic-slayer.png", "first-blood.png"])
    check("apply: coverage count is not doubled",
          len(list(dest.glob("*.png"))), 2)
    check("apply: correctly-named file won the slug",
          (dest / "first-blood.png").read_bytes(), b"CORRECTLY-NAMED")
    ok("apply: source kept when copying", (src / "first-blood.png").exists())
    ok("apply: losing duplicate not written anywhere",
       b"WRONGLY-NAMED" not in b"".join(f.read_bytes() for f in dest.glob("*.png")))

    # --- never overwrite ------------------------------------------------------
    (dest / "first-blood.png").write_bytes(b"ORIGINAL")
    sys.argv = ["x", str(src), "--apply"]
    al.main()
    check("apply: existing art never overwritten",
          (dest / "first-blood.png").read_bytes(), b"ORIGINAL")

if FAILS:
    print(f"art-link: {len(FAILS)} checks FAILED")
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1)
print("art-link: all checks passed")
