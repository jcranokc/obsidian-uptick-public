---
title: Uptick Gamification Design
type: design
status: proposed
created: 2026-08-22
updated: 2026-08-22
tags:
  - life-os
  - gamification
cssclasses:
  - life-os
---

# Uptick Gamification Design

The XP layer that sits on top of the existing Uptick. Tasks already arrive from
Granola, get a `[priority:: N]` from `priority-task-sync.py`, and land in
[[2 Work/Tasks/Task Inbox]]. This adds a second axis — **difficulty** — turns
completion into experience points, and builds levels, streaks, bosses, and
achievements on top of that.

Companion notes: [[4 System/Game/Achievements]] · [[4 System/Game/Character]] ·
[[4 System/Game/Reward Bank]]

## Design principles

1. **Markdown stays the source of truth.** The XP ledger is an append-only
   Markdown file, not plugin state. Same rule the rest of Uptick follows.
2. **Difficulty and priority are independent axes.** Priority answers *should I
   do this now*. Difficulty answers *how much does this cost me*. Collapsing
   them makes both useless.
3. **Deterministic first, AI second.** Difficulty is scored by the same kind of
   rule table `priority()` already uses. An AI pass may refine it at import; a
   human lock always wins.
4. **The penalty must stay recoverable.** Escalating decay is the point, but
   uncapped decay turns the system into a machine that only ever tells you you
   are failing. Every penalty has a ceiling, while level and rank reflect the
   XP you currently hold.
5. **Rituals pay a little; work pays a lot.** If filling in a log entry pays
   like shipping a deployment, the log becomes the game.

## 1. Difficulty

A new inline field written alongside the existing one, so a task line reads:

```
- [ ] ⏫ Update field permissions across the account object 📅 2026-08-25 [priority:: 4] [difficulty:: 4] [ticket:: [ABC-1234](…)] #task ^task-a1b2c3d4e5f6
```

### The scale

| D | Name | Feels like | Base XP |
|---|---|---|---|
| 1 | Trivial | Send an email, forward a thread, book a slot | 10 |
| 2 | Small | One config change, one report, a short call | 25 |
| 3 | Standard | A story: build it, test it, hand it off | 50 |
| 4 | Hard | Multi-step, multi-environment, or someone else is blocked on it | 100 |
| 5 | Epic | Sandbox refresh, permission model rewrite, a release | 200 |

### How it is scored

Deterministic signals, mirroring `priority()`:

- **Base by work type.** Deploy / migration / data load / integration /
  permission-model terms score high. Email, forward, schedule, call, remind
  score low. Build / test / validate / review sit in the middle.
- **Step count.** Clauses joined by `and then`, `;`, or a second imperative verb
  each add a step. Three or more steps cannot be D1.
- **Environment.** `production`, `FullTest`, `INTG`, `sandbox refresh` add one.
- **Ticket attached.** A `REQ-` number means a real sprint item — floor of D3.
- **Blast radius.** Two or more `[[People]]` links, or `all users`, `org-wide`,
  `everyone`, adds one.
- **Length.** A title over ~140 characters is describing a project, not a task.

Clamped to 1–5.

### AI refinement at import

Decided 2026-08-22: the deterministic pass runs first and always, then the
Granola import asks an AI for a second opinion which may move the score by **at
most ±1**. The rules set the range; the AI only nudges inside it. That keeps
the pipeline predictable when the network is down or the call fails — a missing
AI response simply leaves the computed value standing — while letting the
ambiguous cases ("review the provisioning flow and document test steps") land
closer to the truth.

The refined value is written with a marker so it is distinguishable from both a
raw computation and a human lock: `[difficulty:: 4~]`. A later rules-only rerun
may overwrite a `~` value; it may never overwrite a `!` value.

### Overrides

`[difficulty:: 4!]` — the trailing `!` means *set by hand*. The sync script
reads it, respects it, and never recomputes it. This is the escape hatch for
the cases the rules get wrong, and it needs to exist from day one or you will
stop trusting the number.

`[difficulty:: 4~]` — refined by AI at import. As built this is **preserved**
too, unless the deterministic rules have since moved two or more bands away, at
which point the old opinion is about a materially different task. (The original
design said a rules-only rerun could overwrite it; preserving is better, or
every scheduled run silently discards the AI's work.)

## 2. Earning XP

### Tasks

```
XP = round( base(difficulty) × timing × priority_bonus × streak_bonus )
```

| Factor | Value |
|---|---|
| `timing` — done before the due date | ×1.25 |
| `timing` — done on the due date | ×1.00 |
| `timing` — done after the due date | ×0.50 |
| `priority_bonus` — priority 1–2 (Critical/Urgent) | ×1.25 |
| `priority_bonus` — priority 3–10 | ×1.00 |
| `streak_bonus` | ×(1 + 0.02 × streak days), capped at ×1.30 |

A D3 task finished early, on a Critical priority, on a 10-day streak:
`50 × 1.25 × 1.25 × 1.20 = 94 XP`. The same task finished three days late with
no streak: `25 XP`. Late work still pays — finishing is always better than not.

### Study — LearnKit

LearnKit records analytics events in
`.obsidian/plugins/learnkit/scheduling/flashcards.db`, in
`store_snapshot.payload.analytics.events`, with kinds `review`, `note-review`,
`session`, and `exam-attempt`. The engine consumes them incrementally by `seq`
and never re-reads history, so the 50,000-event cap in LearnKit cannot silently
rewrite past XP.

| Event | XP |
|---|---|
| Flashcard, scheduled, graded Good or Easy | 3 |
| Flashcard, scheduled, graded Hard | 2 |
| Flashcard, scheduled, graded Again | 1 |
| Flashcard, practice mode | half the above, rounded down |
| Note review | 5 |
| Session of 10+ cards | +10, once per deck per day |
| Quiz — under 15 questions | `10 + percent × 0.5` (max 60) |
| Test — 15 to 39 questions | `25 + percent × 1.0` (max 125) |
| Practice exam — 40+ questions | `50 + percent × 2.5` (max 300) |
| Certification passed (entered by hand) | 2,500 + bonuses |

Two guards. **A grade of Again still pays 1 XP** — the moment being honest with
a flashcard costs you points, you start lying to your own spaced repetition and
the whole study system degrades. And **flashcard XP is capped at 400/day**, so
grinding a deck cannot out-earn a day of real work.

### Certification milestones and readiness

Sitting a real exam pays **on top of** all study XP above: +500 for sitting it
at all, partial credit scaled to the score on a failed attempt, +2,500 for a
pass, plus first-attempt and margin bonuses. **Failing costs nothing** — taxing
a failed attempt teaches you to delay until certain, which is how a
certification slips a year.

Each certification also carries a **readiness score, 0–100**, blending
blueprint-weighted coverage, FSRS card mastery, calibrated practice-exam
performance, and score consistency, capped by hard gates. That is the progress
bar on the Quest Log, and it is a large enough piece of design to live in its
own note: **[[4 System/Game/Exam Readiness Model]]**.

> [!note] Not started yet
> LearnKit's analytics log is currently empty — zero events recorded. The study
> half of this system has nothing to read until the first review session runs.

### Daily rituals

Deliberately small.

| Action | XP |
|---|---|
| *What matters today* filled before 10:00 | 15 |
| *What matters today* filled after 10:00 | 10 |
| Work Log entry | 5 each, max 4/day |
| End of Day completed (a Completed item and a Notes for Tomorrow item) | 20 |
| Meeting note has an agenda before the meeting starts | 10 |
| Weekly review filled in | 75 |
| Monthly review filled in | 200 |
| Task Inbox fully triaged (nothing without a priority) | 25 |

Ceiling is roughly 80 XP/day from rituals — about one and a half standard
tasks. Enough to be worth doing, not enough to be worth faking.

## 3. Losing XP

### Escalating overdue decay

Penalty accrues once per day, per open task, past its due date:

```
daily_penalty = ceil( base(difficulty) × 0.10 ) × charged_overdue_days
```

A D3 task costs 5 XP on its first charged day, then 10 XP, then 15 XP. Linear
escalation makes delayed work materially visible. Three guards still matter:

- **One day of grace.** Decay starts on the second day overdue. A task due
  Friday that you close Monday morning should not be a punishment.
- **Per-task daily cap.** The daily penalty never exceeds the task's own
  completion base XP. A forgotten D5 cannot cost 600 XP/day at day 60.
- **Global daily cap.** Total decay across all tasks is capped at 25% of your
  trailing 7-day average earn rate. A bad week cannot erase a good month.

### Levels follow current XP

If decay drops you below a level threshold, you lose that level—and the rank
that goes with it. Level 1 remains the floor. The grace day, per-task ceiling,
and global daily cap keep that consequence meaningful without turning downtime
or an overwhelming backlog into irrecoverable debt.

### Waiting pauses everything

A task tagged `#blocked` or `#dependency` accrues no penalty and earns no XP.

The design intent was to push the due date forward on unblock, so that a task
which sat for two weeks does not drop you into an instant fourteen-day penalty
debt. **As built it achieves the same thing without touching the due date**,
because `2 Work/Tasks/Task Inbox.md` has exactly one writer and the XP engine
is not it.

Instead the engine keeps a **decay cursor** per task: the last day already
considered. Blocked days advance the cursor without charging, so they are
consumed rather than banked up. Unblocking charges one day, not one per day
spent waiting. Verified by test.

### Two more rules the build added

Both exist for the same reason as the caps — the system must never present a
bill for time it was not actually watching.

- **A task decays only from the day the engine first sees it.** Importing a
  task that is already three weeks late does not charge three weeks of decay.
- **A sync outage is forgiven, not billed.** `MAX_CATCHUP_DAYS = 7` bounds how
  much backlog any single run can charge. If the machine was off for five
  months, the next run charges at most a week.

Blocked days are counted. A task blocked more than 21 cumulative days is
surfaced in the weekly review as *is this actually dead?* — flagged, not fined.

### Rescheduling

Moving a due date is neither free nor punished: already-charged penalty stands,
future accrual resets, and a `reschedule_count` increments. Three or more
reschedules on one task unlocks an achievement, because the honest thing to do
with that pattern is name it.

### Vacation mode

`paused: true` in [[4 System/Game/Character]] halts decay and freezes the
streak. No XP is earned while paused either.

## 4. Levels and ranks

Total XP required to reach level N:

```
threshold(N) = 50N² + 50N
```

| Level | Total XP | Roughly |
|---|---|---|
| 2 | 300 | day 1 |
| 5 | 1,500 | week 1 |
| 10 | 5,500 | week 3 |
| 20 | 21,000 | month 2 |
| 30 | 46,500 | month 5 |
| 50 | 127,500 | year 1 |

At a realistic 300–500 XP/day that curve gives fast early wins and makes level
50 a genuine year-long arc.

### Ranks

Every ten levels renames you. Displayed on the dashboard header.

| Levels | Rank |
|---|---|
| 1–9 | Operator |
| 10–19 | Technician |
| 20–29 | Specialist |
| 30–39 | Architect |
| 40–49 | Principal |
| 50–59 | Distinguished |
| 60–74 | Luminary |
| 75–99 | Legend |
| 100+ | Ascended |

## 5. Level-up rewards

Three rewards run together. Decided 2026-08-22.

### a. Rank and title — every level

Displayed on the dashboard header. Free, visible, and it is the pattern
Trailhead has already conditioned you to respond to. Ranks in section 4.

### b. Cosmetic unlock — every level

A Uptick accent colour, card theme, dashboard banner, or glyph set, unlocked
one per level and switchable from the Quest Log. Costs nothing real, and
Todoist's Karma Enlightenment theme unlock is proof a purely cosmetic carrot
holds up over years.

Unlock order should front-load the good ones — a theme at level 2 that you
actually want to use does more work than ten hoarded at level 40.

### c. The Reward Bank — real money

XP converts to actual money you are allowed to spend on anything, accumulated
against products you name in advance. Full mechanics in
[[4 System/Game/Reward Bank]].

**Conversion.** One rate, one constant, easy to tune:

```
BANK_RATE      = 250      # XP per $1.00
LEVEL_BONUS    = 2.00     # dollars per level, times the level number
MONTHLY_CEILING = 100.00  # dollars, hard cap per calendar month
```

Banking runs on **net daily XP** — the day's earnings minus the day's decay,
floored at zero. At a realistic 300–500 XP/day that is **$1.20–$2.00 a day**,
plus level bonuses, landing around **$45–70 a month** early on and pressing
against the $100 ceiling once levels get expensive.

Three rules that make this safe to actually run:

1. **The bank never goes backwards.** Decay can zero out a day's deposit; it
   can never claw back money already banked. Losing real money you had already
   earned is the fastest way to make a system feel hostile, and it creates a
   genuinely perverse incentive to stop logging honestly.
2. **The monthly ceiling is a hard cap.** Without it, a heavy month is an
   unbudgeted expense, and the correct response to an unbudgeted expense is to
   quietly stop honouring the system.
3. **The money has to be somewhere real.** A notional balance in a Markdown
   file loses its force within about a month. Recommendation: a named savings
   account or a dedicated envelope in whatever you budget with, funded once a
   month from the ledger total. The note is the accounting; the account is the
   reward.

### Goals

You name products in advance and the bank fills toward them. Each goal shows
price, banked, percent, and an ETA computed from your trailing 30-day earn
rate, rendered as a progress bar on the Quest Log.

This is the mechanic that does the real work. "You are 62% of the way to the
thing, about 19 days out at your current pace" is a far stronger pull than a
level number, because the reward is concrete and you chose it yourself.

Goals are **sequential by default** — one active goal fills first, and the
overflow rolls to the next. Splitting the deposit across five goals means all
five crawl, and nothing ever visibly completes.

### Deliberately not doing (yet)

**Capability unlocks** — gating Uptick features behind levels. Fun, but
self-referential, and it means shipping features you then hide from yourself.
Revisit once the rest is running.

## 6. Boss fights

Worth stealing from Habitica, and it fits your actual work better than it fits
Habitica's. A **boss** is a project or a certification:

- Boss HP = the sum of `base(difficulty)` across its member tasks
- Completing a member task deals that task's XP as damage
- The Projects card shows an HP bar

A six-week Salesforce project stops being a list and becomes a thing that is
visibly dying. Certifications work the same way, with study XP as the damage.

## 7. Streaks — and the guard rail

Streak = consecutive days with at least one XP event.

- Bonus: +2% XP per day, capped at +30% (15 days)
- **Two streak freezes banked per month**, spent automatically
- Breaking a streak costs zero XP — it only resets the multiplier

The freeze is not optional. Every documented streak-abandonment problem traces
to the same thing: one missed day makes the record imperfect, and people quit
rather than restart. The freeze absorbs the sick day.

## 8. Where things live

```
4 System/Game/
  Quest Log.md          the dashboard   ```life-os → view: quest```
  Character.md          derived state: level, XP, rank, streak, active bonuses
  XP Ledger.md          append-only, one line per event, stable event ids
  Achievements.md       catalog + unlock state
  Reward Bank.md        money balance, product goals, spend ledger
  Exam Readiness Model.md the 0-100 readiness score
  Certifications/         one note per certification, blueprint + attempts
  Gamification Design.md  this note

4 System/Automation/
  xp-sync.py            the engine
  exam-readiness.py     readiness calculator + self-test (written, passing)
  xp-sync.sh            launchd wrapper (com.lifeos.xp-sync)
  xp-state.json         watermarks: last LearnKit seq, last processed day
```

The engine follows the shape `priority-task-sync.py` already established:
deterministic, local, idempotent, atomic writes, and safe to re-run. It appends
to the ledger and regenerates the derived notes; the plugin only ever reads.

## 9. Settings

Everything configurable lives in one schema, `DEFAULTS` in `main.js`. That
object is also the specification: the settings page is generated from it, and
`xp-sync.py` reads the same stored config, so a rate changed in the UI changes
what the engine awards. There is one source of truth for these numbers and it
is not the Python file.

Six tabs, styled as the dashboards rather than as Obsidian's settings tab:

| Tab | Covers |
|---|---|
| Modules | Whole features on or off, and achievement tiers |
| Layout | Which cards appear on Home and on a daily note |
| Panels | Photos (folder, interval, shuffle, count), weather, study |
| Experience | Base XP per difficulty, multipliers, decay and its guards, ritual and study rewards |
| Rewards | Bank rate, level bonus, monthly ceiling, currency |
| Paths | Every vault path, each flagged if it does not exist |

**Paths are settings, not constants.** Thirty of them were hardcoded to this
vault's folder names, which was the single biggest thing preventing anyone else
from installing this. `applyPaths()` re-derives them on load and on change,
composing the game notes and caches from the configured folders rather than
making someone name eight files when naming one folder will do.

A module that is off hides its cards everywhere *and* its sidebar entries — a
nav that advertises pages which render nothing is worse than no nav.

Distribution: [[4 System/Game/Distribution Plan]].

> [!warning] Editing `main.js` mechanically
> Guards were first applied by global string search, and several markers were
> not unique — `renderReference(plugin, grid, [` appears in two renderers.
> One wrap opened in `renderDaily` and closed in `renderHome`, swallowing three
> top-level functions. Edits to this file are now made through a
> function-scoped patcher that resolves markers within a single function's line
> range and re-verifies the file's top-level function set after every change.

## 9a. The interface

Built in `.obsidian/plugins/life-os/main.js` and `styles.css`. The plugin never
computes XP — it reads `Character.md`, `XP Ledger.md`, and a generated
`achievements-cache.json`, the same arrangement `calendar-cache.json` and
`weather-cache.json` already use. If a number is wrong, it is wrong in the
ledger.

**Goals are edited in the view**, not in the note. The note keeps the Goals and
Ledger tables as the record, but `lifeos-owns-body` hides the note body in
*edit* mode as well as reading mode — so the original "Edit goals" button, which
toggled preview, could never reveal the table it was trying to reach. Add,
edit, remove and record-a-spend now write the rows directly.

**The Reward Bank** is a view: the available balance stated once and large,
goals as progress bars with an ETA from your trailing 30-day rate, the
conversion constants, and spend history. Its Goals and Ledger tables stay
editable Markdown — goals are something you type, so the note owns them and the
view reads them. Under a week of earning data the ETA says so rather than
inventing a number off two days.

**Practice Exams** is a view too. It reads each paper's own frontmatter rather
than a cache, so a regenerated set appears immediately, and pairs it with the
logged attempts from `quest-cache.json`: score per paper, pass or below-pass,
the adjusted score beside the raw one, and a retake marker. It carries a banner
counting down the three full attempts the readiness gate needs, which
disappears once cleared — that gate is the thing most easily missed, since
flashcards alone cannot lift readiness past 60.

Its **Log a score** button appends the attempt row directly into the
certification note's Practice attempts table, in the exact shape the model
parses. Hand-writing that row was the step most likely to be skipped, and a
score that never gets logged does not exist as far as readiness is concerned.

**All five game notes are plugin views** — Quest Log, Character, XP Ledger,
Achievements, Practice Exams, and the Reward Bank. Quest Log and Character are thin carriers; the Ledger and the
catalog keep their Markdown tables as the readable record and the plugin renders
over them.

**The XP Ledger** view groups events by day, newest first, with a sticky date
header carrying that day's net, a colour per source down the left edge, filter
chips per kind with counts, live search, and paging. Detail text **wraps instead
of clipping** — the Markdown table was cutting rows off at
"Update field permissi…", which is the one thing a permanent record must not do.
The write-side limit was raised to 120 characters for the same reason.

**Quest Log** and **Character** are plugin views too (`view: quest`,
`view: character`), not generated Markdown. They were originally written as
Markdown dashboards, which meant every progress bar rendered as a fenced code
block labelled "Plain text" — the numbers were right and the page looked like a
terminal dump. Both notes are now thin carriers for a view block, and the plugin
draws them from `quest-cache.json`: readiness with component bars and named
blockers, what is currently bleeding XP, the bank, XP by source, a 30-day
net-XP sparkline, and the rank ladder with your position marked.

### The dashboards load their data before they draw

Life Preview renders each `life-os` block as one CodeMirror widget, and CM only
keeps the visible viewport in the DOM — everything else is an *estimated*
height. A render that awaits a file read halfway through therefore gets measured
half-built, and every later growth spurt fires a re-measure. Fired mid-scroll,
that re-measure throws the viewport back to the top of the note.

Two changes fix it at the source. `Game.warm()` loads the quest cache, the
achievement cache and the ledger in parallel **before any DOM is written**, so
the panels resolve from memory in a microtask rather than across a real async
gap — the ledger alone was being re-read three times per draw. And the
re-measure now watches the note's scroller and defers while a scroll is in
flight, rather than dropping it, which would leave the height map wrong and the
note blank further down.

**Home** opens with an XP header: a level crest, rank, a bar to the next level,
today's net XP broken into earned-versus-decay, an achievements counter, and the
three achievements you are closest to unlocking. A wall of locked badges says
nothing; *"7 of 10 tasks toward Warmed Up"* is the part that pulls.

**Daily** carries the same header scoped to that note's date — a daily note from
last week shows that week's numbers, not today's — plus an Experience card
listing the day's XP by source and any achievements unlocked that day.

**Achievements** is its own view (`view: achievements`) on the catalog note, so
the Markdown table stays the readable record while the plugin renders over it.
Collection percentage, a "closest to unlocking" card, filter chips by state and
tier, live search, and every achievement grouped by category with a progress
bar on each one that is trackable and not yet earned.

**The unlock celebration** is a modal with a tier-coloured medallion, a slow
ray sweep, and a spring pop. Batches play in sequence rather than stacking.
Seen unlocks are recorded in the plugin's own data — UI state, not a fact about
the world — and the first run after switching the layer on records silently
rather than replaying your whole history at once. Honors
`prefers-reduced-motion`.

**Home** also carries a Study card — cards due, per-deck counts, the active
certification's readiness, and buttons into LearnKit. Its numbers come from
`quest-cache.json` because the plugin cannot read LearnKit's SQLite store
directly; `xp-sync.py` already has it open, so it writes the summary out.

**The sidebar** carries a Study section — LearnKit, Coach, and Practice Exams.
The first two open LearnKit's own views; Practice Exams finds its index note by
pattern rather than a hardcoded path, so a second certification's papers need no
code change. They resolve their commands at runtime rather than
hardcoding ids from another plugin's bundle, and fall back to the Study Hub
note if LearnKit is disabled. Resolution is by
**display name**, not id — LearnKit's ids come out of a minified bundle and are
not stable, but its names are defined in its own i18n and are what the command
palette shows.

> [!warning] LearnKit must stay on Simple sync mode
> Its Full modes scan bare `::`, and Dataview inline fields — `[priority:: N]`,
> `[difficulty:: N]` — match LearnKit's shorthand regex. Full (Normalize) would
> rewrite Task Inbox lines into flashcards, taking the difficulty field the XP
> engine reads with it.

**Artwork** has a written prompt per achievement in
[[4 System/Game/Achievement Art/Icon Prompts]] — a shared style block plus a
per-tier metal treatment plus a concrete subject, generated from the live
catalog. The style block carries the constraints that matter: no text (models
render it badly and it would be illegible at icon size), a single bold
silhouette readable at 44px, and a transparent background with no frame, since
the app draws its own circular frame and tier colouring behind the art.

Artwork stays optional: drop `<slug>.png` into `4 System/Game/Achievement Art/`
and it replaces the medallion in the popup, the browser tile, and the daily
card. Anything without a file falls back to the tier medallion, which is a
normal state rather than a missing-file error.

### Progress required a change to the catalog

Achievements were originally plain predicates — true or false. A progress bar
needs to know *how far along* you are, so conditions are now `T(getter, target)`
threshold specs or `F(getter)` flags, and the engine reports `have`/`need` per
achievement. 150 of the 157 automatic ones became thresholds and can show a bar.

## 10. What is built

All of it, as of 2026-08-22, except boss fights.

| Phase | Contents | State |
|---|---|---|
| 1 | Difficulty field, task XP, levels, ledger, decay, blocked pause | **built** |
| 2 | Dashboard XP strip, difficulty pills, Quest Log | **built** |
| 3 | LearnKit study XP | **built**, no data yet |
| 3b | Exam readiness, certification notes, milestone XP | **built** |
| 4 | Achievement engine + catalog | **built** — 157 of 258 auto-evaluated |
| 5 | Streak freezes | **built** |
| 6 | Reward Bank: money conversion, goals, progress bars | **built** |
| — | Boss fights | not built |

### The pieces

| File | Does |
|---|---|
| `4 System/Automation/priority-task-sync.py` | Scores priority **and difficulty**; the only writer of task lines |
| `4 System/Automation/xp-sync.py` | The engine. Reads everything, writes the game notes |
| `4 System/Automation/achievements.py` | The catalog as evaluable predicates |
| `4 System/Automation/exam-readiness.py` | Readiness calculator, 27 self-test checks |
| `4 System/Automation/xp-sync.sh` | Job wrapper: task sync, then XP sync |
| `engine/life-os-xp-sync.plist` | Schedule — **not installed yet** |

### Verification

- `exam-readiness.py` — 27 self-test checks
- `test_xp.py` — 19 integration checks over a synthetic vault, simulating days
  forward: zero start, escalating decay, the blocked clock, idempotency,
  the global cap, level regression at a threshold, and outage forgiveness
- `xp-sync.py --audit` — confirms this catalog note and `achievements.py` name
  exactly the same 258 achievements, with no drift in either direction

### A bug found on the way

`priority-task-sync.py` computed each task's segment by scanning to the next
**blank line**. Two adjacent tasks with no blank line between them therefore
produced overlapping segments, and the rewrite loop silently skipped the later
ones — four open tasks had never received a `[priority:: N]` at all, and their
provenance was being read from a neighbour. Fixed: a segment now stops at the
next checkbox as well, and the rewrite advances by the original span rather
than the replacement's length.

## Decisions

Settled 2026-08-22.

| Question | Decision |
|---|---|
| Level-up reward | Rank/title **and** cosmetic unlock every level, **and** a real-money Reward Bank with named product goals |
| Grace before decay | **1 day** — decay starts on the second day overdue |
| Backfill | **Start at zero.** No retroactive credit; the early levels unlock fast enough that the climb is its own reward |
| Difficulty assignment | **Deterministic rules + AI refinement**, AI limited to ±1 from the computed value |

### Still open

1. **Bank rate.** `BANK_RATE = 250` XP per dollar and a `$100` monthly ceiling
   are defaults chosen against an estimated 300–500 XP/day. Both want one real
   month of data before being fixed.
2. **Where the money lives.** A separate savings account, a budget envelope, or
   a monthly transfer — the balance needs somewhere real to sit or it stops
   feeling like a reward.
3. **The first goal.** The bank does nothing until there is a product in it
   worth working toward. See [[4 System/Game/Reward Bank]].
