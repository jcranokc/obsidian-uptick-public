---
title: Exam Readiness Model
type: design
status: proposed
created: 2026-08-22
updated: 2026-08-22
tags:
  - life-os
  - gamification
  - study
cssclasses:
  - life-os
---

# Exam Readiness Model

One number, 0–100, for *am I ready to sit this exam*. Feeds the progress bar on
the Quest Log and gates the certification milestone XP.

Part of [[4 System/Game/Gamification Design]]. Reference implementation:
`4 System/Automation/exam-readiness.py`.

## What LearnKit already gives us

Worth knowing before building anything: **LearnKit already computes a readiness
score**, and it is honest about what it is — its own help text says it "blends
card mastery (FSRS retrievability) with time feasibility for remaining
material," with a projected line assuming you hit your daily targets. Its Coach
also stores an exam date, daily targets, and an on-track status in
`scheduling/coach.db`.

What it does **not** do is take your practice exam results into account. That
is the gap this model fills, and it is the gap that matters — practice test
performance is the single most reliable readiness predictor there is.

So: LearnKit supplies the memory model, this supplies the blueprint weighting,
the exam performance model, and the calibration.

### The data available

Per card, in `scheduling/flashcards.db` → `store_snapshot.payload.states`:

| Field | Meaning |
|---|---|
| `stabilityDays` (S) | Days until recall probability falls to 90% |
| `difficulty` (D) | FSRS difficulty, 1–10 |
| `lastReviewed` | Timestamp of last review |
| `reps`, `lapses` | Total reviews, total forgettings |
| `stage` | new / learning / review / relearning / suspended |

LearnKit runs **FSRS-6**. The forgetting curve, read straight out of the
bundle:

```
decay  = -w[20]                       # default w20 = 0.1542
factor = exp(ln(0.9) / decay) - 1     # = 0.9803
R(t,S) = (1 + factor · t / S) ^ decay
```

Verified numerically: `R(t=S) = 0.90` exactly, as it must.

## The core idea

Retrievability alone is not mastery. A card reviewed five minutes ago has
R ≈ 1.00 and tells you nothing. The question is not *do I know this now*, it is
**will I still know this on exam day**.

That reframing collapses to something clean. Solving the curve for the
stability needed to hold a given recall probability on exam day:

| Recall wanted on exam day | Exam in 7d | 14d | 30d | 60d | 90d |
|---|---|---|---|---|---|
| 90% | S ≥ 7.0 | 14.0 | 30.0 | 60.0 | 90.0 |
| 85% | S ≥ 3.7 | 7.3 | 15.7 | 31.5 | 47.2 |
| 80% | S ≥ 2.1 | 4.2 | 9.0 | 18.1 | 27.1 |

**A card counts as mastered when its stability is at least the number of days
until the exam.** That is the whole rule, and it falls out of the arithmetic
rather than being invented. It also has the right dynamics: as exam day
approaches the bar drops, so cards graduate into "mastered" naturally, and a
card you learned months ago with S = 120 was mastered all along.

## The four components

### 1. Coverage (C) — have you seen it

Per blueprint domain *d* with published weight *w_d*:

```
coverage_d = cards_reviewed_at_least_once_d / cards_total_d
C = Σ w_d × coverage_d
```

Blueprint-weighted, never raw card counts. Mastering all of an 8%-weighted
domain and a fifth of a 17%-weighted one is not "60% covered."

### 2. Mastery (M) — will you still know it

Per card:

```
R_now      = R(days_since_last_review, S)
S_factor   = min(1, S / days_until_exam)
lapse_pen  = max(0.5, 0.85 ^ lapses_in_last_30_days)
mastery    = R_now × S_factor × lapse_pen
```

`M = Σ w_d × mean(mastery over cards in d)`

`S_factor` is the piece doing the real work — it is what stops a freshly-crammed
deck from reading as mastery. `lapse_pen` catches leeches: a card you have
forgotten four times recently is not known, whatever its current R says.

### 3. Performance (P) — practice exams, calibrated

Raw scores are not usable as-is. Four corrections, each grounded in a documented
effect:

**Novelty discount.** Retaking a test you have seen inflates the score through
pattern recognition, even when you believe enough time has passed.

```
novelty = 1 - 0.12 × min(prior_attempts_on_this_testId, 3)
```
First sitting 1.00, second 0.88, third 0.76, fourth and beyond 0.64.

**Recency decay.** A 90% from two months ago is not evidence about today.
Exponential, 21-day half-life.

**Transfer gap.** Most candidates score 5–10 points lower on the real exam than
on practice, from timing pressure, unfamiliar phrasing, and nerves. Subtract
the midpoint: **−7 points**. This constant is the one the model calibrates
against real outcomes (see below).

**Size weight.** A 60-question exam is far stronger evidence than a 10-question
quiz, but not six times stronger. Weight ∝ √(question count).

Then normalise against the exam's own pass mark, targeting a real buffer rather
than a bare pass:

```
P = clamp01( (P_score − (pass − 15)) / ((pass + 8) − (pass − 15)) )
```

0 at fifteen points below the pass mark, 1.0 at eight above it. The +8 target
sits inside the recommended 5–10 point buffer above the passing line.

### 4. Consistency (K) — is it stable

One score is a data point, two is a line, three is a pattern. Readiness depends
on scores that have stopped swinging.

```
K = clamp01(1 − stdev(last 5 adjusted scores) / 12) × trend
trend = 1.1 if improving, 1.0 if flat, 0.85 if declining   (capped at 1.0)
```

## The composite

```
Readiness = 100 × (0.20·C + 0.35·M + 0.35·P + 0.10·K)
```

Memory and demonstrated performance carry equal weight, because they fail
differently: mastery without exam practice misses timing and question phrasing;
exam practice without mastery is pattern-matching a question bank.

## The gates — why this is accurate

A weighted average alone is not good enough. It lets one strong component mask
a fatal weakness, and it will happily report 72% ready to someone who has never
sat a full practice exam. So the composite is capped:

| Condition | Ceiling |
|---|---|
| Blueprint coverage below 90% | 70 |
| Any single domain's mastery below 50% | 75 |
| Fewer than 2 full practice exams (40+ q) in the last 30 days | 60 |
| Fewer than 3 full practice exams ever | 80 |
| Most recent full exam below the pass mark | 65 |
| Median adjusted score below pass + 5 | 85 |
| No study activity in 7 days | 80, then −2 per further day |

```
Readiness = min(composite, every applicable ceiling)
```

You cannot reach 100 without full blueprint coverage, no weak domain, three or
more practice exams, recent ones consistently above pass + 5, and current
activity.

**Blockers and binding are reported separately**, and the distinction matters:

- **Blockers** — every unmet gate condition, shown whether or not it is
  currently capping the score. This is the to-do list standing between you and
  the top band.
- **Binding** — the subset actually dragging the score below what the composite
  alone would have said. These get the visual warning.

Early on, nothing binds — a beginner's composite is genuinely low on its own
merits and no ceiling is doing any work. The blockers are still the right thing
to show. The bar always says why it is not higher, which is the difference
between a progress bar and a diagnostic.

### Bands

| Readiness | Meaning |
|---|---|
| 0–39 | Learning. Coverage is the bottleneck. |
| 40–64 | Studying. Mastery building, not yet exam-tested. |
| 65–79 | Testing. Sit practice exams; find the weak domains. |
| 80–89 | Nearly there. Close the gap the gates are naming. |
| 90–100 | **Book the exam.** |

## Calibration — the model learns

Every real attempt logs *predicted readiness* against *actual outcome*. After
two or more attempts the transfer-gap constant moves toward reality:

```
observed_gap = mean(practice_score_at_the_time − real_exam_score)
TRANSFER_GAP = 0.7 × TRANSFER_GAP + 0.3 × observed_gap
```

Bounded to 3–15 points. Two exams is not much of a sample, so the update is
deliberately damped — but it means the second certification is predicted better
than the first, which is the only honest way to claim accuracy.

## Milestone XP

Sitting a real certification exam is expensive, scheduled, and genuinely
stressful. All of this pays **on top of** the ordinary study XP from cards,
quizzes, and practice exams.

| Event | XP |
|---|---|
| Sat a real exam, any outcome | **+500** |
| Failed attempt, partial credit | `+10 × max(0, score − 40)` |
| **Passed** | **+2,500** |
| Passed on the first attempt | +1,000 |
| Margin bonus | `+20 × (score − pass_mark)` |
| Passed while the model said ≥85 ready | +250 |

A near-miss at 60% on a 65% exam pays `500 + 200 = 700 XP` — real
acknowledgement that you did the work and sat the thing. A first-time pass at
78%, predicted at 90 readiness, pays
`500 + 2,500 + 1,000 + 260 + 250 = 4,510 XP` — roughly a level and a half, and
about **$18** into the [[4 System/Game/Reward Bank]].

There is **no penalty for failing**. Sitting an exam you might fail is the
behaviour to reinforce; taxing it teaches you to delay until certain, which is
how a certification slips a year.

## Does it behave?

Run `python3 "4 System/Automation/exam-readiness.py" --demo`. Six scenarios
along a realistic study arc:

| Scenario | Readiness | What is holding it back |
|---|---|---|
| Week 1 — read through the deck once | **21** | mastery 3%; nothing retained yet |
| Week 4 — deck solid, no practice exams | **55** | no exam evidence at all |
| Week 6 — two exams, scraping the pass mark | **79** | median adjusted score below pass + 5 |
| Week 8 — three solid exams, mature deck | **99** | nothing. Book it. |
| *Same scores, but all three are retakes of one test* | **79** | retake inflation detected |
| Week 8 ready, then two weeks off | **62** | capped — 16 days without study |

The fifth row is the one worth looking at. Identical raw percentages to the
row above it, twenty points lower, purely because the evidence came from
re-sitting the same question bank. That is the single most common way people
talk themselves into an exam they are not ready for, and it is exactly what
the novelty discount and the consistency term exist to catch.

The last row matters too: an uncapped composite of 98 dropping to 62 after two
idle weeks. Knowing it a fortnight ago is not knowing it now.

The self-test (`python3 exam-readiness.py`, 27 checks) covers the FSRS curve
against its own definition, mastery monotonicity, retake discounting, every
gate, and the milestone XP arithmetic.

## Certification as a boss fight

Each certification is a boss (§6 of the design). HP = the blueprint-weighted
card total; damage = mastery gained, not cards reviewed, so re-reviewing a
card you already know deals nothing. The boss dies when you pass.

## Where it lives

```
4 System/Game/Certifications/
  _Template.md                     blueprint + exam date + attempt log
  <cert-slug>.md                   one per certification
```

Each note holds the domain blueprint copied from the official exam guide, the
mapping from each domain to its LearnKit folder or topic, the exam date, the
pass mark, and the attempt history. **The blueprint is versioned** — Salesforce
revises these (the Platform Administrator exam was reweighted in December
2025), and a stale blueprint silently corrupts every number above it.

Everything else is computed.

## Open questions

1. **Which certification first?** The model needs one real blueprint and one
   real deck to be worth anything.
2. **Where do practice exams come from?** LearnKit's own exam builder, or an
   external bank (Focus on Force, saasguru) whose results get entered by hand.
   External banks are better evidence but need a manual attempt log.
3. **Pass marks vary by exam** (Administrator is 65%). Each cert note carries
   its own.
