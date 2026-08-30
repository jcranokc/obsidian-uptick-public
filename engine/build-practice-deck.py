#!/usr/bin/env python3
"""Turn the K2 master test bank into LearnKit MCQ decks, one note per exam domain.

LearnKit card syntax (per its own docs and the plugin's field regex):

    T   | title |
    MCQ | question stem |
    A   | a correct option |
    O   | an incorrect option |
    I   | explanation and references |
    G   | group |

Every field is its own line, opens with `KEY |` and closes with ` |`. Multiple
`A` rows make the card multi-select. Cards are separated by a blank line.
"""
from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

SRC = Path(os.environ.get("BANK",
    "practice-bank.md"))  # a Markdown question bank; see docs/
DEST = Path("$VAULT/3 Reference/Knowledge/"
            "Study Library/Salesforce/Platform Administrator II/Practice Bank")

# Domain -> the scope token used in the certification note's blueprint.
DOMAIN_ORDER = [
    "Security and Access",
    "Process Automation",
    "Objects and Applications",
    "Data and Analytics Management",
    "Cloud Applications",
    "Auditing and Monitoring",
    "Environment Management",
    "Deployment",
]

OPT_RE = re.compile(r"^- ([A-F])\.\s+(.*)$")
ANS_RE = re.compile(r"^\*\*Answer:\*\*\s*(.+)$", re.M)
CHOOSE_RE = re.compile(r"Choose \d+ answers?\.?", re.I)
LINK_RE = re.compile(r"^- \[([^\]]+)\]\(([^)]+)\)\s*$", re.M)


def clean(text: str) -> str:
    """Flatten to one line and neutralise the field delimiter.

    LearnKit splits fields on `|`, so a pipe inside content would silently cut
    the field in half. Replaced rather than escaped, because the escape only
    holds for the pipe delimiter and the setting is user-changeable.
    """
    text = re.sub(r"\s*\n\s*", " ", text)
    text = text.replace("|", "/")
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def parse(src: Path) -> list[dict]:
    text = src.read_text(encoding="utf-8")
    body = text[text.index("## Questions by Exam Domain"):]
    cards: list[dict] = []

    # Split into domains, then into exams, then into questions.
    dom_parts = re.split(r"^## (.+)$", body, flags=re.M)[1:]
    for i in range(0, len(dom_parts), 2):
        domain = dom_parts[i].strip()
        if domain == "Questions by Exam Domain":
            continue
        exam_parts = re.split(r"^### (.+)$", dom_parts[i + 1], flags=re.M)
        chunks = []
        if exam_parts[0].strip():
            chunks.append(("", exam_parts[0]))
        for j in range(1, len(exam_parts), 2):
            chunks.append((exam_parts[j].strip(), exam_parts[j + 1]))

        for exam, chunk in chunks:
            q_parts = re.split(r"^#### (Question \d+)$", chunk, flags=re.M)[1:]
            for k in range(0, len(q_parts), 2):
                qid, qbody = q_parts[k].strip(), q_parts[k + 1]
                card = parse_question(qbody, domain, exam, qid)
                if card:
                    cards.append(card)
    return cards


SENT_RE = re.compile(r"(?<=[.?!])\s+")


def drop_restated_stem(expl: str, stem: str) -> str:
    """Remove the question text the bank repeats at the top of most explanations.

    Nearly every explanation opens by restating one or more sentences of the
    stem. Left in, the card's answer side would repeat its own prompt back at
    you before saying anything useful. Sentences are dropped only from the
    front, and only while they appear verbatim in the stem, so genuine
    explanation text is never touched.
    """
    stem_norm = re.sub(r"\s+", " ", stem).strip()
    sentences = SENT_RE.split(re.sub(r"\s+", " ", expl).strip())
    i = 0
    while i < len(sentences):
        s = sentences[i].strip()
        if s and len(s) > 25 and s in stem_norm:
            i += 1
            continue
        break
    return " ".join(sentences[i:]).strip() or expl


def parse_question(qbody: str, domain: str, exam: str, qid: str) -> dict | None:
    lines = qbody.split("\n")
    stem_lines, options = [], []
    for idx, line in enumerate(lines):
        m = OPT_RE.match(line.strip())
        if m:
            options.append((m.group(1), m.group(2).strip()))
        elif not options:
            if line.startswith(("**Answer:", "**Explanation:", "**Relevant links")):
                break
            stem_lines.append(line)
        elif line.startswith(("**Answer:", "**Explanation:", "**Relevant links")):
            break

    am = ANS_RE.search(qbody)
    if not (options and am):
        return None
    correct = set(re.findall(r"\b([A-F])\b", am.group(1).split("(")[0]))
    if not correct:
        return None

    stem = CHOOSE_RE.sub("", "\n".join(stem_lines)).strip()

    expl = ""
    em = re.search(r"\*\*Explanation:\*\*\s*(.*?)(?=\n\*\*|\Z)", qbody, re.S)
    if em:
        expl = CHOOSE_RE.sub("", em.group(1).strip()).strip()
        expl = drop_restated_stem(expl, stem)

    links = [u for _label, u in LINK_RE.findall(qbody)
             if "help.salesforce.com" in u or "trailhead" in u or "developer.salesforce" in u]

    return {
        "domain": domain, "exam": exam, "qid": qid,
        "stem": clean(stem),
        "correct": [clean(t) for L, t in options if L in correct],
        "wrong": [clean(t) for L, t in options if L not in correct],
        "explanation": clean(expl),
        "links": links[:3],
        "n_correct": len(correct),
    }


def render_note(domain: str, cards: list[dict], today: str) -> str:
    slug = domain.lower().replace(" ", "-")
    multi = sum(1 for c in cards if c["n_correct"] > 1)
    out = [
        "---",
        f'title: "Platform Admin II — {domain}"',
        "type: flashcard-deck",
        f"domain: {domain}",
        "certification: Salesforce Platform Administrator II",
        f"cards: {len(cards)}",
        f"imported: {today}",
        "source: K2 University Platform Administrator II practice exams 1–5",
        "tags:",
        "  - study",
        "  - salesforce",
        "  - platform-admin-ii",
        f"  - {slug}",
        "---",
        "",
        f"# Platform Admin II — {domain}",
        "",
        f"**{len(cards)} multiple-choice cards** ({len(cards) - multi} single-answer, "
        f"{multi} multi-answer), transcribed from the K2 University practice exams.",
        "",
        "Answers and explanations come from the practice exam's own checked-answer",
        "feedback — no independently inferred answer key. Source:",
        "[[3 Reference/Knowledge/platform-admin-ii-practice-exam-1-master-test-bank-organized--3babc0c7|master test bank]].",
        "",
        "> [!info] LearnKit deck",
        f"> Every card is grouped as `{domain}`, which is the scope the exam readiness",
        "> model matches against — see [[4 System/Game/Exam Readiness Model]].",
        "",
        "---",
        "",
    ]
    for c in cards:
        title = f"{c['domain']} · {c['exam']} {c['qid']}".strip().replace("|", "/")
        info_bits = [c["explanation"]] if c["explanation"] else []
        if c["links"]:
            info_bits.append("Reference: " + " · ".join(c["links"]))
        info = clean(" ".join(info_bits))
        if c["n_correct"] > 1:
            info = f"({c['n_correct']} correct answers) " + info

        out.append(f"T | {title} |")
        out.append(f"MCQ | {c['stem']} |")
        for a in c["correct"]:
            out.append(f"A | {a} |")
        for w in c["wrong"]:
            out.append(f"O | {w} |")
        if info:
            out.append(f"I | {info} |")
        out.append(f"G | {c['domain']} |")
        out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="cards per deck, for a pilot")
    ap.add_argument("--today", default="2026-08-22")
    args = ap.parse_args()

    cards = parse(SRC)
    by_domain: dict[str, list[dict]] = {d: [] for d in DOMAIN_ORDER}
    for c in cards:
        by_domain.setdefault(c["domain"], []).append(c)

    print(f"parsed {len(cards)} cards")
    for d in DOMAIN_ORDER:
        n = len(by_domain.get(d, []))
        multi = sum(1 for c in by_domain.get(d, []) if c["n_correct"] > 1)
        print(f"  {n:4d}  ({multi:3d} multi)  {d}")

    problems = [c for c in cards if not c["stem"] or not c["correct"]
                or len(c["correct"]) + len(c["wrong"]) < 2]
    print(f"\nmalformed: {len(problems)}")
    for p in problems[:5]:
        print("   ", p["domain"], p["qid"], repr(p["stem"][:60]))

    if args.write:
        DEST.mkdir(parents=True, exist_ok=True)
        for d in DOMAIN_ORDER:
            sel = by_domain.get(d, [])
            if args.limit:
                sel = sel[:args.limit]
            if not sel:
                continue
            path = DEST / f"{d}.md"
            path.write_text(render_note(d, sel, args.today), encoding="utf-8")
            print(f"wrote {path.name}  ({len(sel)} cards)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
