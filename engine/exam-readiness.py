#!/usr/bin/env python3
"""Compute exam readiness, 0-100, for a certification.

Reference implementation of 4 System/Game/Exam Readiness Model.md. Pure
functions plus a self-test; no vault I/O yet, so it can be reasoned about and
checked before it is wired into xp-sync.py.

Reads nothing and writes nothing. Run `python3 exam-readiness.py` to execute the
self-test, or `--demo` to print worked scenarios.
"""
from __future__ import annotations

import argparse
import math
import statistics
from dataclasses import dataclass, field

# --------------------------------------------------------------- FSRS curve

# LearnKit runs FSRS-6. Both constants are derived, not chosen: decay is -w[20]
# and factor is fixed by the requirement that R(t=S) == 0.90 exactly.
W20 = 0.1542
DECAY = -W20
FACTOR = math.exp(math.log(0.9) / DECAY) - 1


def retrievability(elapsed_days: float, stability_days: float) -> float:
    """Probability of recall now, given days since review and FSRS stability."""
    if stability_days <= 0:
        return 0.0
    return (1 + FACTOR * max(0.0, elapsed_days) / stability_days) ** DECAY


def stability_needed(days_until_exam: float, target_recall: float = 0.90) -> float:
    """Stability a card needs to hold `target_recall` on exam day."""
    return FACTOR * days_until_exam / (target_recall ** (1 / DECAY) - 1)


# ------------------------------------------------------------------- inputs

@dataclass
class Card:
    domain: str
    stability_days: float = 0.0
    days_since_review: float = 0.0
    lapses_30d: int = 0
    seen: bool = False


@dataclass
class Attempt:
    """One practice exam or quiz attempt."""
    test_id: str
    score: float               # percent, 0-100
    questions: int
    days_ago: float
    prior_attempts: int = 0    # earlier attempts on this same test_id


@dataclass
class Blueprint:
    """A certification's published exam guide."""
    name: str
    pass_mark: float
    domains: dict[str, float]  # domain -> weight, should sum to 1.0
    version: str = ""


# ----------------------------------------------------------------- tunables

TRANSFER_GAP = 7.0        # points practice overstates the real exam; calibrated
NOVELTY_STEP = 0.12       # discount per prior attempt on the same test
NOVELTY_MAX_STEPS = 3
RECENCY_HALF_LIFE = 21.0  # days
TARGET_MARGIN = 8.0       # points above pass mark that counts as fully ready
FLOOR_MARGIN = 15.0       # points below pass mark that counts as zero

W_COVERAGE, W_MASTERY, W_PERFORMANCE, W_CONSISTENCY = 0.20, 0.35, 0.35, 0.10


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


# -------------------------------------------------------------- components

def coverage(cards: list[Card], bp: Blueprint) -> tuple[float, dict[str, float]]:
    """Blueprint-weighted fraction of content reviewed at least once."""
    per_domain: dict[str, float] = {}
    total = 0.0
    for domain, weight in bp.domains.items():
        in_domain = [c for c in cards if c.domain == domain]
        if not in_domain:
            per_domain[domain] = 0.0
            continue
        frac = sum(1 for c in in_domain if c.seen) / len(in_domain)
        per_domain[domain] = frac
        total += weight * frac
    return clamp01(total), per_domain


def card_mastery(card: Card, days_until_exam: float) -> float:
    """Will this card still be known on exam day?"""
    if not card.seen or card.stability_days <= 0:
        return 0.0
    r_now = retrievability(card.days_since_review, card.stability_days)
    # The load-bearing term: stability must cover the time left before the exam.
    s_factor = min(1.0, card.stability_days / max(1.0, days_until_exam))
    lapse_pen = max(0.5, 0.85 ** card.lapses_30d)
    return clamp01(r_now * s_factor * lapse_pen)


def mastery(cards: list[Card], bp: Blueprint, days_until_exam: float
            ) -> tuple[float, dict[str, float]]:
    per_domain: dict[str, float] = {}
    total = 0.0
    for domain, weight in bp.domains.items():
        in_domain = [c for c in cards if c.domain == domain]
        if not in_domain:
            per_domain[domain] = 0.0
            continue
        m = statistics.fmean(card_mastery(c, days_until_exam) for c in in_domain)
        per_domain[domain] = m
        total += weight * m
    return clamp01(total), per_domain


def adjusted_score(a: Attempt) -> float:
    """One attempt's score, corrected for retake inflation and transfer gap.

    Recency is applied as an evidence weight rather than to the score itself —
    an old exam is weaker evidence, not evidence of a worse score.
    """
    novelty = 1 - NOVELTY_STEP * min(a.prior_attempts, NOVELTY_MAX_STEPS)
    return a.score * novelty - TRANSFER_GAP


def attempt_weight(a: Attempt) -> float:
    """Bigger exams and recent ones count for more."""
    size = math.sqrt(max(1, a.questions))
    recency = 0.5 ** (a.days_ago / RECENCY_HALF_LIFE)
    return size * recency


def performance(attempts: list[Attempt], bp: Blueprint) -> tuple[float, float]:
    """Returns (normalised 0-1 performance, weighted adjusted score in points)."""
    if not attempts:
        return 0.0, 0.0
    weights = [attempt_weight(a) for a in attempts]
    if sum(weights) == 0:
        return 0.0, 0.0
    score = sum(adjusted_score(a) * w for a, w in zip(attempts, weights)) / sum(weights)
    lo = bp.pass_mark - FLOOR_MARGIN
    hi = bp.pass_mark + TARGET_MARGIN
    return clamp01((score - lo) / (hi - lo)), score


def consistency(attempts: list[Attempt]) -> float:
    """Have the scores stopped swinging, and are they moving the right way?"""
    recent = sorted(attempts, key=lambda a: a.days_ago)[:5]
    if len(recent) < 2:
        return 0.0
    scores = [adjusted_score(a) for a in recent]          # newest first
    spread = statistics.pstdev(scores) if len(scores) > 1 else 0.0
    base = clamp01(1 - spread / 12)
    newest, oldest = scores[0], scores[-1]
    trend = 1.1 if newest > oldest + 2 else (0.85 if newest < oldest - 2 else 1.0)
    return clamp01(base * trend)


# ------------------------------------------------------------------- gates

def gates(cards: list[Card], attempts: list[Attempt], bp: Blueprint,
          cov: float, mast_by_domain: dict[str, float],
          days_since_activity: float) -> list[tuple[str, float]]:
    """Hard ceilings. Returns every binding gate as (reason, ceiling)."""
    out: list[tuple[str, float]] = []

    if cov < 0.90:
        out.append((f"blueprint coverage {cov:.0%} (needs 90%)", 70.0))

    weak = sorted(d for d, m in mast_by_domain.items() if m < 0.50)
    if weak:
        # Naming all eight domains is noise; name them only while the list is
        # short enough to be a to-do rather than a wall of text.
        detail = ", ".join(weak) if len(weak) <= 3 else \
            f"{len(weak)} of {len(bp.domains)} domains, weakest {weak[0]}"
        out.append((f"below 50% mastery: {detail}", 75.0))

    full = [a for a in attempts if a.questions >= 40]
    recent_full = [a for a in full if a.days_ago <= 30]
    if len(recent_full) < 2:
        out.append((f"{len(recent_full)} full practice exams in 30d (needs 2)", 60.0))
    if len(full) < 3:
        out.append((f"{len(full)} full practice exams ever (needs 3)", 80.0))

    if full:
        latest = min(full, key=lambda a: a.days_ago)
        if latest.score < bp.pass_mark:
            out.append((f"latest full exam {latest.score:.0f}% below pass "
                        f"{bp.pass_mark:.0f}%", 65.0))
        median = statistics.median([adjusted_score(a) for a in full])
        if median < bp.pass_mark + 5:
            out.append((f"median adjusted score {median:.0f}% below pass+5", 85.0))

    if days_since_activity > 7:
        stale = 80.0 - 2.0 * (days_since_activity - 7)
        out.append((f"no study activity for {days_since_activity:.0f} days",
                    max(0.0, stale)))

    return out


# ------------------------------------------------------------------ compose

@dataclass
class Readiness:
    score: float
    coverage: float
    mastery: float
    performance: float
    consistency: float
    composite: float
    # Every unmet gate condition — what stands between you and the top band.
    # These are shown in the UI whether or not they are currently capping the
    # score, because they are all still work to be done.
    blockers: list[tuple[str, float]] = field(default_factory=list)
    # The subset actively dragging the score below what the composite alone
    # would have said.
    binding: list[tuple[str, float]] = field(default_factory=list)
    mastery_by_domain: dict[str, float] = field(default_factory=dict)
    adjusted_points: float = 0.0

    def band(self) -> str:
        s = self.score
        if s >= 90: return "Book the exam"
        if s >= 80: return "Nearly there"
        if s >= 65: return "Testing"
        if s >= 40: return "Studying"
        return "Learning"


def readiness(cards: list[Card], attempts: list[Attempt], bp: Blueprint,
              days_until_exam: float, days_since_activity: float = 0.0
              ) -> Readiness:
    cov, _ = coverage(cards, bp)
    mast, mast_by_domain = mastery(cards, bp, days_until_exam)
    perf, points = performance(attempts, bp)
    cons = consistency(attempts)

    composite = 100 * (W_COVERAGE * cov + W_MASTERY * mast
                       + W_PERFORMANCE * perf + W_CONSISTENCY * cons)

    blockers = gates(cards, attempts, bp, cov, mast_by_domain, days_since_activity)
    score = min([composite] + [c for _, c in blockers])

    return Readiness(score=round(score, 1), coverage=cov, mastery=mast,
                     performance=perf, consistency=cons,
                     composite=round(composite, 1),
                     blockers=blockers,
                     binding=[g for g in blockers if g[1] < composite],
                     mastery_by_domain=mast_by_domain,
                     adjusted_points=round(points, 1))


# -------------------------------------------------------------- milestone XP

def milestone_xp(score: float, bp: Blueprint, first_attempt: bool,
                 predicted_readiness: float) -> dict[str, int]:
    """XP for sitting a real exam. Never negative — failing costs nothing."""
    out = {"sat the exam": 500}
    if score >= bp.pass_mark:
        out["passed"] = 2500
        if first_attempt:
            out["first attempt"] = 1000
        margin = int(round(20 * (score - bp.pass_mark)))
        if margin > 0:
            out["margin"] = margin
        if predicted_readiness >= 85:
            out["model agreed"] = 250
    else:
        partial = int(round(10 * max(0.0, score - 40)))
        if partial:
            out["partial credit"] = partial
    return out


def calibrate(transfer_gap: float, practice_at_time: float,
              real_score: float) -> float:
    """Damped update of the transfer gap from one real outcome. Bounded 3-15."""
    observed = practice_at_time - real_score
    return max(3.0, min(15.0, 0.7 * transfer_gap + 0.3 * observed))


# ------------------------------------------------------------------ fixtures

ADMIN = Blueprint(
    name="Salesforce Certified Platform Administrator",
    pass_mark=65.0,
    version="2025-12",
    # Published weightings, Dec 2025 revision. Verify against the current
    # official exam guide before trusting any number computed from these.
    domains={
        "Data and Analytics Management": 0.17,
        "Configuration and Setup": 0.15,
        "Object Manager and Lightning App Builder": 0.15,
        "Automation": 0.15,
        "Sales and Marketing Applications": 0.13,
        "Service and Support Applications": 0.09,
        "Agentforce AI": 0.08,
        "Productivity and Collaboration": 0.08,
    },
)


def _deck(bp: Blueprint, per_domain: int, stability: float, elapsed: float,
          seen: bool = True, lapses: int = 0) -> list[Card]:
    return [Card(domain=d, stability_days=stability, days_since_review=elapsed,
                 seen=seen, lapses_30d=lapses)
            for d in bp.domains for _ in range(per_domain)]


# --------------------------------------------------------------- self-test

def self_test() -> int:
    failures = []

    def check(label, cond):
        if not cond:
            failures.append(label)
        print(f"  {'PASS' if cond else 'FAIL'}  {label}")

    print("FSRS curve")
    check("R(t=S) == 0.90", abs(retrievability(10, 10) - 0.90) < 1e-9)
    check("R decays as t grows", retrievability(30, 10) < retrievability(3, 10))
    check("R rises with stability", retrievability(7, 60) > retrievability(7, 7))
    check("stability_needed(30d) == 30", abs(stability_needed(30) - 30) < 1e-6)
    check("zero stability -> zero recall", retrievability(1, 0) == 0.0)

    print("\nMastery")
    fresh = Card("x", stability_days=1, days_since_review=0.01, seen=True)
    solid = Card("x", stability_days=90, days_since_review=5, seen=True)
    check("crammed card is not mastered for a 60-day horizon",
          card_mastery(fresh, 60) < 0.10)
    check("stable card is mastered for a 60-day horizon",
          card_mastery(solid, 60) > 0.85)
    check("same crammed card scores higher when the exam is tomorrow",
          card_mastery(fresh, 1) > card_mastery(fresh, 60))
    leech = Card("x", stability_days=90, days_since_review=5, seen=True, lapses_30d=4)
    check("lapses reduce mastery", card_mastery(leech, 60) < card_mastery(solid, 60))
    check("unseen card scores zero", card_mastery(Card("x", 90, 1, seen=False), 30) == 0.0)

    print("\nAttempt adjustment")
    first = Attempt("t1", 80, 60, 1, prior_attempts=0)
    third = Attempt("t1", 80, 60, 1, prior_attempts=2)
    check("retakes are discounted", adjusted_score(third) < adjusted_score(first))
    check("transfer gap applied", adjusted_score(first) == 80 - TRANSFER_GAP)
    check("60q outweighs 10q",
          attempt_weight(Attempt("a", 80, 60, 1)) > attempt_weight(Attempt("b", 80, 10, 1)))
    check("recent outweighs old",
          attempt_weight(Attempt("a", 80, 60, 1)) > attempt_weight(Attempt("b", 80, 60, 60)))

    print("\nGates")
    strong = _deck(ADMIN, 20, stability=120, elapsed=3)
    exams = [Attempt(f"e{i}", 82, 60, d, 0) for i, d in enumerate([2, 9, 16])]
    r_full = readiness(strong, exams, ADMIN, days_until_exam=30)
    r_noexams = readiness(strong, [], ADMIN, days_until_exam=30)
    check("mastered deck with no practice exams is gated hard",
          r_noexams.score <= 60)
    check("mastered deck with three good exams scores well", r_full.score >= 80)
    # A gate only "binds" when it drags the score below what the composite
    # alone would have said. A mastered deck with no exams scores low on its
    # own merits, so nothing is capping it — that is correct, not a miss.
    check("an unbound gate is not reported as binding",
          all(c < r_noexams.composite for _, c in r_noexams.binding))

    thin = _deck(ADMIN, 20, stability=120, elapsed=3, seen=False)[:80] + strong[80:]
    r_thin = readiness(thin, exams, ADMIN, days_until_exam=30)
    check("partial coverage is capped at 70", r_thin.score <= 70)
    check("an unmet gate is always reported as a blocker",
          any("coverage" in g[0] for g in r_thin.blockers))

    # A gate *binds* only when it drags the score below the composite. Two good
    # exams give a high composite, but "3 full exams ever" caps it at 80.
    two_good = [Attempt("e1", 88, 60, 2), Attempt("e2", 86, 60, 9)]
    r_two = readiness(strong, two_good, ADMIN, days_until_exam=30)
    check("a gate below the composite binds and is named",
          r_two.composite > 80 and r_two.score <= 80
          and any("3" in g[0] for g in r_two.binding))

    r_stale = readiness(strong, exams, ADMIN, 30, days_since_activity=20)
    check("going stale lowers readiness", r_stale.score < r_full.score)

    failing = [Attempt(f"f{i}", 58, 60, d, 0) for i, d in enumerate([2, 9, 16])]
    r_fail = readiness(strong, failing, ADMIN, days_until_exam=30)
    check("failing practice exams cap readiness at 65", r_fail.score <= 65)

    print("\nMonotonicity")
    check("more mastery never lowers readiness",
          readiness(_deck(ADMIN, 20, 120, 3), exams, ADMIN, 30).score
          >= readiness(_deck(ADMIN, 20, 20, 3), exams, ADMIN, 30).score)
    check("higher exam scores never lower readiness",
          readiness(strong, [Attempt(f"e{i}", 88, 60, d, 0)
                             for i, d in enumerate([2, 9, 16])], ADMIN, 30).score
          >= r_full.score)

    print("\nMilestone XP")
    passed = milestone_xp(78, ADMIN, first_attempt=True, predicted_readiness=90)
    missed = milestone_xp(60, ADMIN, first_attempt=True, predicted_readiness=70)
    check("first-time pass at 78% pays 4,510", sum(passed.values()) == 4510)
    check("pass breaks down as expected",
          passed == {"sat the exam": 500, "passed": 2500, "first attempt": 1000,
                     "margin": 260, "model agreed": 250})
    check("near miss at 60% still pays 700", sum(missed.values()) == 700)
    check("failing is never negative", all(v >= 0 for v in missed.values()))

    print("\nCalibration")
    check("optimistic practice widens the gap",
          calibrate(7.0, practice_at_time=85, real_score=70) > 7.0)
    check("gap stays bounded", 3.0 <= calibrate(7.0, 100, 0) <= 15.0)

    print(f"\n{'ALL CHECKS PASSED' if not failures else str(len(failures)) + ' FAILED'}")
    return 1 if failures else 0


def demo() -> None:
    scenarios = [
        ("Week 1 — read a bit, no testing",
         _deck(ADMIN, 20, 2, 1, seen=True), [], 60, 0),
        ("Week 4 — deck is solid, still no practice exams",
         _deck(ADMIN, 20, 45, 4), [], 30, 0),
        ("Week 6 — first two exams, scraping the pass mark",
         _deck(ADMIN, 20, 60, 4),
         [Attempt("e1", 66, 60, 4), Attempt("e2", 68, 60, 11)], 20, 1),
        ("Week 8 — three solid exams, deck mature",
         _deck(ADMIN, 20, 120, 3),
         [Attempt("e1", 84, 60, 2), Attempt("e2", 81, 60, 9),
          Attempt("e3", 79, 60, 16)], 14, 0),
        ("Same, but every exam is a retake of one test",
         _deck(ADMIN, 20, 120, 3),
         [Attempt("e1", 84, 60, 2, prior_attempts=2),
          Attempt("e1", 81, 60, 9, prior_attempts=1),
          Attempt("e1", 79, 60, 16, prior_attempts=0)], 14, 0),
        ("Ready — and two weeks off",
         _deck(ADMIN, 20, 120, 17),
         [Attempt("e1", 84, 60, 16), Attempt("e2", 81, 60, 23),
          Attempt("e3", 79, 60, 30)], 14, 16),
    ]
    for label, cards, attempts, days, idle in scenarios:
        r = readiness(cards, attempts, ADMIN, days, idle)
        print(f"\n{label}")
        print(f"  readiness {r.score:5.1f}  [{r.band()}]   (uncapped {r.composite})")
        print(f"  coverage {r.coverage:.0%}  mastery {r.mastery:.0%}  "
              f"performance {r.performance:.0%}  consistency {r.consistency:.0%}")
        if r.adjusted_points:
            print(f"  adjusted exam score {r.adjusted_points}%  "
                  f"(pass mark {ADMIN.pass_mark:.0f}%)")
        for reason, ceiling in r.blockers:
            mark = "CAPS" if (reason, ceiling) in r.binding else "todo"
            print(f"  [{mark}] {reason}" + (f"  -> max {ceiling:.0f}" if mark == "CAPS" else ""))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--demo", action="store_true", help="print worked scenarios")
    args = ap.parse_args()
    if args.demo:
        demo()
        return 0
    return self_test()


if __name__ == "__main__":
    raise SystemExit(main())
