#!/usr/bin/env python3
"""Regenerate the JS achievement catalog from engine/achievements.py.

Hand-porting 258 entries invites exactly the silent transcription error a green
test suite would not notice -- a threshold off by a zero, a slug misspelled, a
tier swapped. This reads the Python AST instead, so the two catalogs cannot
disagree, and parity_test.js evaluates both over the same Stats to prove the
predicates behave the same.

Run after changing CATALOG in achievements.py:

    python3 tools/gen-catalog.py

It rewrites the generated block in engine/uptick-engine.js in place, between
the BEGIN and END markers, and touches nothing else.
"""

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The condition wording is written by hand and lives in engine/conditions.json,
# so a fresh vault gets a catalog note that explains every achievement rather
# than 258 rows saying nothing.
CONDITIONS = json.loads((ROOT / "engine/conditions.json").read_text())
BEGIN = "/* --- BEGIN GENERATED CATALOG --- */"
END = "/* --- END GENERATED CATALOG --- */"


def getter_js(body):
    if isinstance(body, ast.Attribute):
        return f"s.{body.attr}"
    if isinstance(body, ast.Call) and getattr(body.func, "id", "") == "_d":
        return f"(s.by_difficulty[{ast.literal_eval(body.args[1])}] || 0)"
    sys.exit(f"gen-catalog: unhandled getter {ast.unparse(body)!r}. "
             "Extend getter_js rather than editing the JS by hand.")


def rows():
    tree = ast.parse((ROOT / "engine/achievements.py").read_text())
    cat = next((n.value for n in ast.walk(tree)
                if isinstance(n, ast.AnnAssign)
                and getattr(n.target, "id", "") == "CATALOG"), None)
    if cat is None:
        sys.exit("gen-catalog: no CATALOG found in achievements.py")

    out = []
    for el in cat.elts:
        slug, name, tier, category = (ast.literal_eval(x) for x in el.elts[:4])
        head = (f'  [{json.dumps(slug)}, {json.dumps(name)}, '
                f'{json.dumps(tier)}, {json.dumps(category)}, ')
        pred = el.elts[4]
        cond = json.dumps(CONDITIONS.get(slug, ""))
        if isinstance(pred, ast.Name) and pred.id == "MANUAL":
            out.append(head + f"null, {cond}],")
            continue
        kind = getattr(pred.func, "id", "")
        g = getter_js(pred.args[0].body)
        if kind == "T":
            out.append(head + f"{{ t: {ast.literal_eval(pred.args[1])}, g: (s) => {g} }}, {cond}],")
        elif kind == "F":
            out.append(head + f"{{ f: true, g: (s) => {g} }}, {cond}],")
        else:
            sys.exit(f"gen-catalog: unhandled predicate {kind!r}")
    return out


def main() -> int:
    target = ROOT / "engine/uptick-engine.js"
    s = target.read_text()
    if BEGIN not in s or END not in s:
        sys.exit("gen-catalog: markers missing from engine/uptick-engine.js")
    body = "const CATALOG = [\n" + "\n".join(rows()) + "\n];"
    start, stop = s.index(BEGIN) + len(BEGIN), s.index(END)
    target.write_text(s[:start] + "\n" + body + "\n" + s[stop:])
    print(f"gen-catalog: wrote {len(rows())} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
