#!/usr/bin/env python3
"""Deal the K2 test bank into non-overlapping 60-question practice exams.

Every question is used exactly once across the set, so re-sitting one exam
never leaks answers into another. Composition is held **identical across
exams** — if one paper were Cloud-heavy and another Security-heavy, the score
difference between them would be composition noise, and the readiness model's
Consistency term reads variance across attempts as a signal about you.

The bank's shape does not match the published blueprint (Cloud Applications and
Data & Analytics are over-represented, the big three under-represented), and no
amount of dealing fixes that. `--blueprint` trades exam count for fidelity: it
emits only as many exams as exact blueprint weights allow, discarding the
surplus. The default uses the whole bank.
"""
from __future__ import annotations

import argparse
import importlib.util
import random
import sys
from pathlib import Path

HERE = Path(__file__).parent
VAULT = HERE.parents[1]
DEST = (VAULT / "3 Reference/Knowledge/Study Library/Salesforce"
        / "Platform Administrator II/Practice Exams")

QUESTIONS = 60          # scored questions on the real exam
MINUTES = 105
PASS_MARK = 65

# Normalized from the Winter '23 exam guide summary. Mirrors the blueprint in
# 4 System/Game/Certifications/Salesforce Platform Administrator II.md — if you
# correct that table against the official guide, correct this too.
BLUEPRINT = {
    "Process Automation": 0.22,
    "Security and Access": 0.22,
    "Objects and Applications": 0.21,
    "Auditing and Monitoring": 0.11,
    "Cloud Applications": 0.08,
    "Data and Analytics Management": 0.08,
    "Deployment": 0.06,
    "Environment Management": 0.02,
}


def load_bank():
    spec = importlib.util.spec_from_file_location(
        "build_practice_deck", HERE / "build-practice-deck.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.parse(mod.SRC)


def deal_whole_bank(by_domain: dict[str, list], n_exams: int, seed: int
                    ) -> list[list[dict]]:
    """Split every domain across the exams as evenly as possible.

    Each domain contributes `n // n_exams` questions to every exam, and its
    remainder is handed out one per exam. The remainders are then balanced so
    each exam lands on exactly QUESTIONS, which works out only because the bank
    divides evenly overall — asserted below rather than assumed.
    """
    rng = random.Random(seed)
    exams: list[list[dict]] = [[] for _ in range(n_exams)]
    extras: list[tuple[str, list]] = []

    for domain in sorted(by_domain, key=lambda d: -len(by_domain[d])):
        pool = by_domain[domain][:]
        rng.shuffle(pool)
        base, rem = divmod(len(pool), n_exams)
        for i in range(n_exams):
            exams[i].extend(pool[i * base:(i + 1) * base])
        if rem:
            extras.append((domain, pool[n_exams * base:]))

    # Hand each domain's leftovers to the exams that are currently smallest, so
    # no exam takes two leftovers from one domain and all end up the same size.
    for _domain, leftover in extras:
        order = sorted(range(n_exams), key=lambda i: len(exams[i]))
        for q, i in zip(leftover, order):
            exams[i].append(q)

    for i, ex in enumerate(exams):
        rng.shuffle(ex)
    return exams


def deal_blueprint(by_domain: dict[str, list], seed: int) -> list[list[dict]]:
    """Exact blueprint weights, as many exams as the scarcest domain allows."""
    rng = random.Random(seed)
    per_exam = {d: round(w * QUESTIONS) for d, w in BLUEPRINT.items()}
    n_exams = min(len(by_domain.get(d, [])) // n for d, n in per_exam.items() if n)
    exams: list[list[dict]] = [[] for _ in range(n_exams)]
    for domain, want in per_exam.items():
        pool = by_domain.get(domain, [])[:]
        rng.shuffle(pool)
        for i in range(n_exams):
            exams[i].extend(pool[i * want:(i + 1) * want])
    for ex in exams:
        rng.shuffle(ex)
    return exams


def letter(i: int) -> str:
    return "ABCDEFGH"[i]


def render(n: int, questions: list[dict], total_exams: int, today: str) -> str:
    from collections import Counter
    mix = Counter(q["domain"] for q in questions)
    test_id = f"k2-bank-exam-{n}"

    out = [
        "---",
        f'title: "Platform Admin II — Practice Exam {n}"',
        "type: practice-exam",
        f"exam_number: {n}",
        f"test_id: {test_id}",
        f"questions: {len(questions)}",
        f"time_limit_minutes: {MINUTES}",
        f"pass_mark: {PASS_MARK}",
        "certification: Salesforce Platform Administrator II",
        f"created: {today}",
        "source: K2 University practice exams 1-5 (master test bank)",
        "tags:",
        "  - study",
        "  - salesforce",
        "  - platform-admin-ii",
        "  - practice-exam",
        "cssclasses:",
        "  - life-os",
        "---",
        "",
        f"# Practice Exam {n}",
        "",
        f"**{len(questions)} questions · {MINUTES} minutes · pass at {PASS_MARK}%** "
        f"({round(QUESTIONS * PASS_MARK / 100)} of {QUESTIONS} correct)",
        "",
        f"Exam {n} of {total_exams}. **No question appears in more than one exam**, "
        "so the set can be sat in any order without leaking answers between papers.",
        "",
        "> [!warning] Sit it properly or the score is worthless",
        f"> Time yourself for {MINUTES} minutes, answer every question before",
        "> scrolling to the key, and do not look anything up. A score from a",
        "> relaxed, open-book run tells the readiness model you are further",
        "> along than you are, and it has no way to know the difference.",
        "",
        "## Domain mix",
        "",
        "| Domain | This exam | Blueprint |",
        "|---|---|---|",
    ]
    for d in BLUEPRINT:
        c = mix.get(d, 0)
        out.append(f"| {d} | {c} ({c / len(questions):.0%}) | {BLUEPRINT[d]:.0%} |")
    out += [
        "",
        "The bank does not match the blueprint — it is short on the three "
        "heavyweight domains and long on Cloud Applications and Data & Analytics. "
        "Every exam in this set carries the same mix, so scores are comparable to "
        "each other even though the mix is not the real exam's.",
        "",
        "## Questions",
        "",
    ]

    for i, q in enumerate(questions, 1):
        n_correct = q["n_correct"]
        out.append(f"### {i}.")
        out.append("")
        out.append(q["stem"])
        out.append("")
        opts = [(t, True) for t in q["correct"]] + [(t, False) for t in q["wrong"]]
        rng = random.Random(f"opt-{n}-{i}")
        rng.shuffle(opts)
        q["_order"] = opts
        for j, (text, _ok) in enumerate(opts):
            out.append(f"- **{letter(j)}.** {text}")
        out.append("")
        out.append(f"*Choose {n_correct}.*" if n_correct > 1 else "*Choose 1.*")
        out.append("")

    out += [
        "---",
        "",
        "## Scoring",
        "",
        f"| Correct | Score | Result |",
        "|---|---|---|",
    ]
    for c in (60, 54, 48, 42, 39, 36, 30):
        pct = round(c / QUESTIONS * 100)
        out.append(f"| {c} | {pct}% | {'Pass' if pct >= PASS_MARK else 'Fail'} |")
    out += [
        "",
        "Then add a row to the **Practice attempts** table in "
        "[[4 System/Game/Certifications/Salesforce Platform Administrator II]]:",
        "",
        "```",
        f"| {today} | K2 bank | {test_id} | {len(questions)} | YOUR_SCORE | 0 | |",
        "```",
        "",
        f"Keep the Test ID as `{test_id}` on every re-sit. It is what tells the "
        "readiness model this is a retake, so the score gets discounted for the "
        "fact that you have seen the questions before.",
        "",
        "---",
        "",
        "> [!success]- Answer key — do not open until you have finished",
        "> Correct answers, with the practice exam's own explanation.",
        ">",
    ]

    # Every line from here to the end of the key must start with "> ". A single
    # blank line closes the callout in Obsidian, which would put the answers in
    # plain sight on the page rather than behind the fold.
    for i, q in enumerate(questions, 1):
        opts = q["_order"]
        correct = [letter(j) for j, (_t, ok) in enumerate(opts) if ok]
        out.append(f"> **{i}. {', '.join(correct)}** — *{q['domain']}*")
        if q["explanation"]:
            out.append(">")
            out.append(f"> {q['explanation']}")
        out.append(">")
    return "\n".join(out) + "\n"


def render_index(exams: list[list[dict]], today: str) -> str:
    """The index note.

    Thin, like the other Uptick dashboards: the plugin renders it from the
    papers' own frontmatter plus the logged attempts, so it looks like the rest
    of the app and shows live progress rather than a static table.
    """
    return "\n".join([
        "---",
        'title: "Platform Admin II — Practice Exams"',
        "type: index",
        f"created: {today}",
        f"exams: {len(exams)}",
        f"questions_each: {QUESTIONS}",
        "certification: Salesforce Platform Administrator II",
        "tags:",
        "  - study",
        "  - platform-admin-ii",
        "cssclasses:",
        "  - life-os",
        "  - max",
        "---",
        "",
        "# Platform Admin II — Practice Exams",
        "",
        "```life-os",
        "view: exams",
        "```",
        "",
        f"*{len(exams)} papers of {QUESTIONS} questions dealt from the "
        f"{sum(len(e) for e in exams)}-question K2 master bank, every question used "
        "exactly once. Rebuild with "
        '`python3 "4 System/Automation/build-practice-exams.py" --write`.*',
        "",
    ]) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--blueprint", action="store_true",
                    help="exact blueprint weights; fewer exams, surplus discarded")
    ap.add_argument("--seed", type=int, default=20260823)
    ap.add_argument("--today", default="2026-08-23")
    args = ap.parse_args()

    cards = load_bank()
    by_domain: dict[str, list] = {}
    for c in cards:
        by_domain.setdefault(c["domain"], []).append(c)

    if args.blueprint:
        exams = deal_blueprint(by_domain, args.seed)
    else:
        n = sum(len(v) for v in by_domain.values()) // QUESTIONS
        exams = deal_whole_bank(by_domain, n, args.seed)

    # Invariants worth failing loudly on: an exam that quietly reuses a question
    # or comes up short is worse than no exam at all.
    seen: dict[int, int] = {}
    for i, ex in enumerate(exams, 1):
        for q in ex:
            key = id(q)
            assert key not in seen, f"question reused in exams {seen[key]} and {i}"
            seen[key] = i
    sizes = [len(e) for e in exams]
    from collections import Counter
    print(f"{len(exams)} exams, sizes {sizes}, {sum(sizes)} questions used "
          f"of {len(cards)} in the bank")
    if not args.blueprint:
        assert all(s == QUESTIONS for s in sizes), f"uneven exams: {sizes}"
        assert sum(sizes) == len(cards), "not every question was dealt"
    print("no question appears in two exams: OK")

    print("\ndomain mix per exam")
    doms = sorted(BLUEPRINT, key=lambda d: -BLUEPRINT[d])
    print(f"{'domain':<32}" + "".join(f"{'E'+str(i+1):>5}" for i in range(len(exams)))
          + f"{'bp':>7}")
    for d in doms:
        counts = [Counter(q["domain"] for q in e).get(d, 0) for e in exams]
        print(f"{d:<32}" + "".join(f"{c:>5}" for c in counts)
              + f"{BLUEPRINT[d]*QUESTIONS:>7.1f}")

    if args.write:
        DEST.mkdir(parents=True, exist_ok=True)
        for i, ex in enumerate(exams, 1):
            path = DEST / f"Practice Exam {i}.md"
            path.write_text(render(i, ex, len(exams), args.today), encoding="utf-8")
            print(f"wrote {path.name}")
        idx = DEST / "Practice Exams.md"
        idx.write_text(render_index(exams, args.today), encoding="utf-8")
        print(f"wrote {idx.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
