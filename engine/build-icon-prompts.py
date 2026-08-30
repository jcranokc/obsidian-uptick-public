#!/usr/bin/env python3
"""Write image-generation prompts for every achievement icon.

Two things matter more than any individual prompt:

  1. A shared style block, so 258 images read as one set rather than 258
     unrelated pictures. It is emitted once and prepended to every subject.
  2. Legibility at 44px. These render at 160px in the unlock popup and 44px on
     a browser tile, so every subject is a single bold silhouette with no text
     and no fine detail.

`--prompt <slug>` prints one paste-ready prompt with the style block already
attached, which is what you want when generating them one at a time.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).parent
DEST = HERE.parents[1] / "4 System/Game/Achievement Art/Icon Prompts.md"

STYLE = """Flat vector achievement badge icon, centred single subject, bold clean \
silhouette readable at 44 pixels. Limited palette, subtle inner glow, soft rim \
light. Transparent background. No text, no letters, no numbers, no words. \
No borders or frames. Square composition, subject filling roughly 80% of the \
canvas. Modern game-UI emblem style, slightly luminous, dark-theme friendly."""

TIER_STYLE = {
    "Bronze":   "Warm bronze and copper metal, amber highlights, understated.",
    "Silver":   "Cool polished silver and steel, pale blue highlights.",
    "Gold":     "Rich gold and brass, warm yellow glow, more ornate.",
    "Platinum": "Bright platinum and cyan, iridescent sheen, prismatic edges.",
    "Mythic":   "Deep violet and magenta with an intense arcane glow, ornate and rare.",
    "Hidden":   "Dark obsidian and dim violet, mysterious, faintly glowing runes.",
}

# slug -> the thing the icon actually shows. Concrete objects, not concepts:
# "an anvil" survives being shrunk to 44px, "productivity" does not.
SUBJECT = {
    # volume
    "first-blood": "a single droplet falling onto a freshly ticked checkbox",
    "getting-started": "a small seedling sprouting from a checkbox",
    "warmed-up": "a stack of five ticked checkboxes with rising heat lines",
    "centurion": "a Roman centurion helmet with a checkmark crest",
    "quarter-thousand": "a quartered coin with a checkmark stamped in one quarter",
    "five-hundred": "a laurel wreath encircling a solid checkmark",
    "kilotask": "a heavy dumbbell plate stamped with a checkmark",
    "two-thousand": "a fortress tower built from stacked checkboxes",
    "five-digits-away": "a mountain summit flag above a sea of checkmarks",
    "ten-thousand-hours": "an hourglass whose sand has become tiny checkmarks",
    "busy-signal": "five parallel motion lines ending in checkmarks",
    "double-digits": "two interlocking rings of ten small checkmarks",
    "machine-mode": "a clockwork gear whose teeth are checkmarks",
    "big-week": "a seven-column bar chart cresting into a checkmark",
    "big-month": "a calendar page bursting with ticked days",

    # difficulty
    "punching-up": "a small fist striking a much larger boulder",
    "epic-slayer": "a sword driven through a cracked monolith",
    "heavy-lifter": "a figure hoisting an oversized weighted crate",
    "load-bearing": "a stone column carrying an enormous architrave",
    "ten-epics": "ten notches carved into a broadsword blade",
    "fifty-epics": "a broken colossus head at the foot of a blade",
    "escalation": "five ascending blocks of increasing size, a staircase",
    "no-small-days": "a mountain range with no foothills, sheer peaks only",
    "straight-to-boss": "an arrow flying past small targets into a large one",
    "sisyphus-rested": "a boulder finally at rest atop a hill",
    "overqualified": "a sledgehammer poised over a tiny nail",
    "weight-class": "a championship belt buckle with a mountain emblem",

    # timing
    "ahead-of-curve": "an arrow overtaking a clock hand",
    "early-bird": "a bird perched on a sunrise horizon line",
    "precognition": "an eye with a clock iris looking forward",
    "same-day-service": "a paper plane launched and landed within one sun arc",
    "inbox-interceptor": "a hand catching an envelope mid-flight",
    "clean-sweep": "a broom sweeping a line of checkmarks clear",
    "perfect-week": "seven flawless tally marks in a row, all struck through",
    "perfect-month": "a calendar grid entirely filled with soft checkmarks",
    "deadline-dancer": "a figure balanced on a clock hand at the last minute",
    "buzzer-beater": "a ball leaving a hand as a buzzer flashes",
    "nothing-overdue": "an empty inbox tray gleaming",
    "nothing-overdue-2": "an empty tray with a two-week calendar behind it",
    "nothing-overdue-3": "an empty tray on a pedestal, sunburst behind",
    "fast-follow": "two footprints landing close behind a meeting bubble",

    # streaks
    "day-two": "two small flames side by side",
    "working-week": "a flame with seven fuel notches",
    "fortnight": "a crescent moon wrapped in a steady flame",
    "full-moon": "a full moon behind a tall unwavering flame",
    "quarter-note": "a flame shaped like a musical quarter note",
    "half-year": "a flame splitting a circle exactly in half",
    "annual": "a flame encircled by a full ring of twelve marks",
    "unbroken": "an unbroken chain loop with a flame at its centre",
    "maxed-multiplier": "a flame with a rising multiplier arrow at its tip",
    "weekend-warrior": "a flame burning on a two-day calendar block",
    "four-weekends": "four small flames arranged in a square",
    "freeze-frame": "a flame encased in a protective ice crystal",
    "didnt-need-it": "an unused ice crystal set aside beside a strong flame",
    "back-on-horse": "a spark reigniting from a single ember",
    "longer-this-time": "a flame overtaking a shorter shadow of itself",
    "comeback-season": "a phoenix feather catching light again",

    # recovery
    "debt-collector": "a ledger with a red line being struck through",
    "dig-out": "a shovel lifting the last of a buried pile",
    "excavation": "an excavator bucket raising a heap of old papers",
    "zero-balance": "a balance scale settling perfectly level at zero",
    "necromancer": "a hand raising a dusty task card back to life",
    "archaeologist": "a brush revealing an ancient carved checkmark",
    "unblocked": "a boulder rolled aside from a blocked doorway",
    "unblocker": "a key turning in a heavy padlock, chain falling away",
    "cut-the-rope": "shears cutting a taut rope",
    "net-positive": "a scale tipping onto the positive side, upward arrow",
    "damage-control": "a shield deflecting downward red arrows",
    "still-here": "a small candle still burning in the wind",

    # study: flashcards
    "first-card": "a single flashcard being turned over",
    "hundred-cards": "a modest fan of flashcards",
    "five-hundred-cards": "a thick deck of cards bound with a band",
    "thousand-cards": "a tall tower of stacked cards",
    "five-thousand-cards": "a library shelf made of card decks",
    "twenty-thousand-cards": "a vast card archive receding into perspective",
    "daily-driver": "a card deck with a sun above it, day cleared",
    "seven-clean-days": "seven cards laid in a row, each ticked",
    "thirty-clean-days": "a calendar month of tiny ticked cards",
    "deck-cleared": "an empty card tray with a single feather",
    "deck-master": "a card deck crowned with a small laurel",
    "honest-work": "a card marked with an honest X and a small heart",
    "hard-mode": "a card with a steep uphill gradient across it",
    "mature-collection": "a card with deep tree rings visible in its edge",
    "card-author": "a quill writing onto a blank flashcard",
    "deck-builder": "hands assembling cards into a neat deck",
    "curriculum": "five labelled deck spines standing together",
    "leech-hunter": "a magnifying glass over one troublesome card",

    # study: exams
    "pop-quiz": "a small question mark on a torn paper slip",
    "test-taker": "a pencil resting on an answer sheet",
    "full-length": "a long answer sheet unrolling downward",
    "passing-grade": "a checkmark stamped above a pass line",
    "comfortable-pass": "a bar clearing a threshold line with room to spare",
    "exam-ready": "a green traffic light above an answer sheet",
    "perfect-paper": "an answer sheet with every bubble correctly filled",
    "ten-exams": "ten stacked answer sheets",
    "fifty-exams": "a thick ream of completed answer sheets",
    "trending-up": "three ascending score bars with an arrow",
    "from-50-to-90": "a steep line climbing from low to high on a grid",
    "no-timer-needed": "a stopwatch stopped early beside a finished sheet",
    "read-the-question": "an eye carefully tracing a line of a question",
    "marathon": "a long winding track with a finish flag",

    # study: certifications
    "enrolled": "a calendar with a target date circled",
    "on-track": "a train on rails heading toward a distant flag",
    "ahead-of-schedule": "a runner passing a schedule milestone marker",
    "certified": "an official seal with a ribbon",
    "double-certified": "two overlapping seals with ribbons",
    "triple-threat": "three seals arranged in a triangle",
    "five-badges": "five seals arranged in an arc",
    "architect-track": "a drafting compass over a blueprint temple",
    "maintained": "a seal being polished, small sparkle",
    "no-lapses": "an unbroken ring of seals",
    "first-try": "a single arrow dead centre in a bullseye",
    "second-times-charm": "a second arrow landing in the bullseye beside a fallen one",

    # meetings
    "recorded": "a microphone with a soundwave becoming a note page",
    "fifty-meetings": "fifty tally marks around a conference table shape",
    "two-hundred-meetings": "a large round table ringed with many chairs",
    "prepared": "an agenda scroll ready before a clock strikes",
    "always-prepared": "a neat stack of agendas with a ribbon",
    "action-extractor": "a magnet pulling task cards out of a transcript",
    "ten-out-of-one": "one document fanning into ten task cards",
    "meeting-to-done": "a speech bubble transforming into a checkmark",
    "clean-slate": "a wiped slate board with a single tick",
    "standup-regular": "three standing figures in a small circle",
    "note-taker": "a pen writing rapid shorthand lines",
    "follow-through": "an arrow passing cleanly through a ring",
    "quiet-week": "an empty calendar week with a single leaf",
    "meeting-marathon": "six stacked speech bubbles in a column",

    # rituals
    "intentional": "a single arrow placed deliberately at a target centre",
    "morning-person": "a sunrise over a small open notebook",
    "seven-intentions": "seven small arrows in a neat row",
    "thirty-intentions": "a compass rose with thirty fine tick marks",
    "hundred-intentions": "a lighthouse beam over a calm sea",
    "logged": "a single timestamped line in an open logbook",
    "hundred-entries": "an open logbook with many ruled lines filled",
    "thousand-entries": "a shelf of bound logbooks",
    "full-log": "four timestamps stacked on one page",
    "closed-loop": "a circle closing with a small clasp",
    "thirty-closes": "thirty small closed loops in a grid",
    "hundred-closes": "a chain of closed loops forming a ring",
    "full-house": "three ritual symbols aligned in one row: sun, pen, moon",
    "perfect-ritual-week": "five aligned rows of the sun-pen-moon trio",

    # reviews
    "reviewer": "a magnifying glass over a week grid",
    "four-weeks": "four week-grids stacked with a check on each",
    "twelve-weeks": "a quarter-year wheel with twelve segments lit",
    "fifty-two": "a full year ring of fifty-two fine segments",
    "monthly-check": "a month page with a checkmark in the corner",
    "quarter-reviewed": "three month pages fanned with a tick",
    "year-reviewed": "twelve month pages arranged as a sunburst",
    "carry-forward": "an arrow lifting a card from one column to the next",
    "honest-accounting": "a balance scale with an open ledger on one pan",
    "nothing-stalled": "a clear runway with no obstacles",

    # projects and bosses
    "first-boss": "a large cracked monolith with a health bar emptied",
    "boss-rush": "five monolith silhouettes toppling in sequence",
    "campaign": "a war banner planted on conquered ground",
    "overkill": "an oversized hammer striking a small remaining sliver",
    "final-blow": "a blade landing the last strike, sparks flying",
    "solo-run": "a lone figure facing a large silhouette",
    "raid-boss": "an enormous horned silhouette behind a small figure",
    "no-retreat": "a shield planted firmly, no footprints backward",
    "long-campaign": "a long trail winding across a map to a flag",
    "two-fronts": "two arrows advancing from a single point",
    "cleared-the-board": "an empty kanban board, all columns clear",
    "scope-cut": "scissors trimming the tail off a long list",

    # salesforce craft
    "deployed": "a rocket lifting off from a server rack",
    "ten-deploys": "ten small rockets in formation",
    "fifty-deploys": "a launch pad with many contrails overhead",
    "sandbox-refreshed": "a sandbox pail and spade with a refresh arrow",
    "full-refresh-cycle": "four sandboxes in a circular refresh loop",
    "permission-surgeon": "a scalpel over a permission matrix grid",
    "least-privilege": "a small key beside a large lock, precisely fitted",
    "integration-wrangler": "a lasso around two connected system nodes",
    "data-mover": "a pipeline carrying data blocks between two vessels",
    "bug-squasher": "a beetle under a raised boot heel",
    "exterminator": "a spray canister with a hazard-free emblem",
    "sprint-closer": "a finish-line ribbon breaking across a ticket",
    "ticket-to-ride": "a punched railway ticket with a reference code shape",
    "production-careful": "a hand placing a block gently onto a live tower",
    "release-manager": "a conductor's baton over a branching pipeline",
    "org-whisperer": "a cloud silhouette with a soundwave whispering into it",

    # vault
    "first-note": "a single sheet of paper with a folded corner",
    "hundred-notes": "a modest stack of pages",
    "five-hundred-notes": "a filled filing drawer",
    "thousand-notes": "a library wall of small drawers",
    "connected": "ten nodes joined by fresh links",
    "web-weaver": "a spider-web of nodes converging on one bright hub",
    "decided": "a fork in a path with one branch clearly chosen",
    "ten-decisions": "ten signposts along a single road",
    "inbox-zero": "an empty tray with a feather resting in it",
    "inbox-zero-streak": "seven empty trays stacked neatly",
    "gardener": "a watering can tending small growing notes",
    "no-orphans": "a constellation where every star is linked",
    "templated": "a stencil sheet with a shape cut through it",
    "automated": "a small robot arm ticking a checkbox",

    # time of day
    "dawn-patrol": "a thin sunrise line with a single early bird",
    "before-the-coffee": "a steaming cup beside an already-ticked list",
    "night-owl": "an owl perched on a crescent moon",
    "midnight-oil": "an oil lamp burning low beside papers",
    "lunch-break": "a sandwich beside a small ticked note",
    "bookends": "a sunrise and a sunset flanking a single day",
    "weekend-shift": "a hard hat resting on a weekend calendar block",
    "monday-momentum": "a boulder already rolling uphill on a Monday page",
    "friday-finisher": "a closing door with a clear desk behind it",
    "leap-day": "a figure leaping across a calendar gap",
    "new-year-new-task": "a firework above a fresh checkbox",
    "birthday-work": "a single candle on a task card",
    "holiday-hours": "a laptop beside a small palm tree",
    "quarter-close": "a vault door swinging shut on a quarter marker",

    # triage
    "triaged": "a hand placing a weight onto a scale pan",
    "calibrator": "a precision dial being finely adjusted",
    "trust-the-rules": "a rulebook glowing softly, untouched",
    "sorted": "three cards falling into three labelled slots",
    "sorted-streak": "seven neat sorted stacks in a row",
    "pruner": "secateurs snipping a dead branch",
    "ruthless": "a large blade cleaving a tall pile in half",
    "right-sized": "one large block splitting into three even blocks",
    "dated": "a calendar stamp pressing onto a card",
    "provenance": "a chain linking a card back to its source document",

    # people
    "handed-off": "a baton passing cleanly between two hands",
    "good-teammate": "two hands clasped over a shared task card",
    "fast-reply": "an envelope with swift motion lines returning",
    "nobody-waiting": "an empty waiting bench",
    "follow-up": "a curved arrow returning to a conversation bubble",
    "chased-it-down": "footprints pursuing a fleeing envelope",
    "sign-off": "a fountain pen completing a signature flourish",
    "onboarder": "an open door with a welcome key on the threshold",
    "escalated-well": "a flag raised on a clear ladder rung",
    "room-of-ones-own": "a closed door with a quiet lamp behind it",

    # meta
    "tomorrows-problem": "a calendar page being flicked forward three times",
    "tomorrows-problem-2": "a thick wad of calendar pages torn away at once",
    "optimist": "ten cards balanced precariously on one day",
    "realist": "the same ten cards, all standing and ticked",
    "yak-shaver": "a razor shaving a yak that holds another razor",
    "scope-creep": "a small box expanding outward past its outline",
    "honest-difficulty": "a dial being turned deliberately upward",
    "read-the-manual": "an open manual with a small glowing bookmark",
    "achievement-hunter": "a trophy caught in crosshairs",
    "completionist": "a display case of trophies nearly filled",
    "full-dex": "a complete display case, every slot filled and glowing",
    "touch-grass": "a bare foot stepping onto a tuft of grass",

    # hidden
    "ghost-in-machine": "a faint spectral figure inside a gear housing",
    "exactly-42": "a small dark monolith with two faint dots",
    "nice": "a subtly smirking crescent moon",
    "round-numbers": "a perfect circle closing exactly on itself",
    "zero-day": "an empty circle on a blank calendar square",
    "palindrome": "a mirrored arch, identical from both ends",
    "speedrun": "a stopwatch with motion streaks trailing it",
    "any-percent": "a lightning bolt splitting a progress bar in two",
    "the-long-game": "a seed and a full tree joined by a long arc",
    "phoenix": "a phoenix rising from cold ashes",

    # exam readiness
    "calibrated": "a needle settling exactly on a gauge's true mark",
    "green-light": "a green signal lamp glowing clear",
    "no-weak-domain": "eight equal pillars all at full height",
    "full-blueprint": "a complete blueprint with every section inked in",
    "trusted-the-model": "a compass needle and a footprint pointing the same way",
    "stability": "three identical bars perfectly level with each other",
    "no-retakes": "a single unbroken arrow, no second shot nocked",
    "sat-it-anyway": "a figure stepping through a doorway despite a storm",
    "back-in": "a bookmark being placed back into an open book",
}


def load_catalog():
    spec = importlib.util.spec_from_file_location("achievements", HERE / "achievements.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def prompt_for(slug: str, name: str, tier: str, subject: str) -> str:
    return f"{STYLE} {TIER_STYLE.get(tier, '')} Subject: {subject}."


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--prompt", help="print one paste-ready prompt for a slug")
    args = ap.parse_args()

    A = load_catalog()
    by_slug = {s: (s, n, t, c) for s, n, t, c, _p in A.CATALOG}

    missing = [s for s, *_ in by_slug.values() if s not in SUBJECT]
    extra = [s for s in SUBJECT if s not in by_slug]
    # Keep --prompt output clean; it is meant to be copied straight out.
    if not args.prompt:
        print(f"catalog {len(by_slug)} | subjects written {len(SUBJECT)} | "
              f"missing {len(missing)} | orphaned {len(extra)}")
        for s in missing[:10]:
            print("   MISSING SUBJECT:", s)
        for s in extra[:10]:
            print("   ORPHANED SUBJECT:", s)

    if args.prompt:
        entry = by_slug.get(args.prompt)
        if not entry:
            print(f"no such achievement: {args.prompt}")
            return 1
        s, n, t, _c = entry
        print(f"\n# {n} ({t}) -> {s}.png\n")
        print(prompt_for(s, n, t, SUBJECT.get(s, n)))
        return 0

    if not args.write:
        return 0 if not missing else 1

    from collections import OrderedDict
    cats = OrderedDict()
    for s, n, t, c, _p in A.CATALOG:
        cats.setdefault(c, []).append((s, n, t))

    out = [
        "---",
        "title: Achievement Icon Prompts",
        "type: reference",
        f"achievements: {len(by_slug)}",
        "tags:",
        "  - life-os",
        "  - gamification",
        "cssclasses:",
        "  - life-os",
        "---",
        "",
        "# Achievement Icon Prompts",
        "",
        f"One prompt per achievement, {len(by_slug)} in total. Generated by "
        "`4 System/Automation/build-icon-prompts.py` from the live catalog, so it "
        "cannot drift out of step with [[4 System/Game/Achievements]].",
        "",
        "## How to use this",
        "",
        "Every prompt is **style block + tier line + subject**. The style block is "
        "the part that matters: it is what makes 258 separate images read as one "
        "set rather than 258 unrelated pictures. Paste it in front of every "
        "subject, or let the script assemble one for you:",
        "",
        "```bash",
        'python3 "4 System/Automation/build-icon-prompts.py" --prompt epic-slayer',
        "```",
        "",
        "Save each result as `<slug>.png` in this folder. The slug is the filename "
        "column below. Nothing else is required — the plugin picks the file up on "
        "its own, and anything still missing falls back to a tier medallion.",
        "",
        "## Style block",
        "",
        "> [!quote] Prepend this to every subject",
        "> " + STYLE.replace(". ", ".\n> "),
        "",
        "### Why these constraints",
        "",
        "- **No text, letters or numbers.** Image models render text badly, and it "
        "would be illegible at icon size anyway.",
        "- **Readable at 44 pixels.** These appear at roughly 160px in the unlock "
        "popup and 44px on a browser tile. A single bold silhouette survives that; "
        "a detailed scene turns to mud.",
        "- **Transparent background, no frame.** The app draws its own circular "
        "frame and tier colouring behind the art. A baked-in background will show "
        "as a square inside a circle.",
        "- **Subject at ~80% of canvas.** The circular crop eats the corners.",
        "",
        "## Tier treatment",
        "",
        "Appended after the style block so tiers read differently at a glance.",
        "",
        "| Tier | Line |",
        "|---|---|",
    ]
    for t, line in TIER_STYLE.items():
        out.append(f"| {t} | {line} |")
    out += [
        "",
        "## Prompts",
        "",
    ]
    n = 0
    for cat, items in cats.items():
        out.append(f"### {cat}")
        out.append("")
        out.append("| # | Achievement | Tier | File | Subject |")
        out.append("|---|---|---|---|---|")
        for slug, name, tier in items:
            n += 1
            subj = SUBJECT.get(slug, name)
            out.append(f"| {n} | **{name}** | {tier} | `{slug}.png` | {subj} |")
        out.append("")

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {DEST.relative_to(HERE.parents[1])} ({n} prompts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
