/* Differential test: the JS engine must agree with the Python engine exactly.
 *
 * parity_oracle.py runs engine/xp-sync.py over a fixed set of inputs and dumps
 * its answers. This feeds the same inputs to engine/uptick-engine.js and
 * compares. Any divergence is a bug in the port, not a difference of opinion --
 * the Python is the reference implementation and stays that way.
 *
 * The inputs are chosen to sit on the boundaries where two languages quietly
 * disagree: rounding at .5 (Python rounds half to even, JS rounds half up),
 * integer division, date arithmetic across a DST boundary, and regex
 * behaviour on unicode.
 */

const { execFileSync } = require("child_process");
const path = require("path");
const E = require("../uptick-engine.js");

const ORACLE = path.join(__dirname, "parity_oracle.py");
let fails = 0;

/* Key order differs between the two dumps -- Python sorts, JS preserves
 * insertion -- and that is not a divergence. Sort recursively so the
 * comparison is about values. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}

function check(label, got, want) {
  const g = JSON.stringify(canon(got)), w = JSON.stringify(canon(want));
  const ok = g === w;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    fails++;
    console.log(`        py: ${w.slice(0, 220)}`);
    console.log(`        js: ${g.slice(0, 220)}`);
  }
}

let py;
try {
  py = JSON.parse(execFileSync("python3", [ORACLE], { encoding: "utf8", maxBuffer: 1 << 24 }));
} catch (e) {
  console.log("  FAIL  could not run the Python oracle");
  console.log(String(e.stderr || e.message).slice(0, 600));
  process.exit(1);
}

/* The fixture comes from the oracle itself. Reconstructing it here -- by
 * scraping the Python source, say -- is how the two halves drift apart and
 * start testing different inputs while both reporting green. */
const F = py._fixture;
const INBOX = F.inbox;
const LEDGER = F.ledger;
const lines = F.task_lines;

const C = E.applyConfig({});

/* ---- pure maths -------------------------------------------------------- */
check("level_threshold curve",
      Array.from({ length: 29 }, (_, i) => E.levelThreshold(i + 1)), py.level_threshold);
check("level_for",
      [0, 1, 99, 100, 199, 200, 599, 600, 1180, 1500, 25000, 500000].map(E.levelFor),
      py.level_for);
check("rank_for",
      [1, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 74, 75, 99, 100, 140].map(E.rankFor),
      py.rank_for);

/* ---- text -------------------------------------------------------------- */
check("short() strips links, fields, dates, tags", lines.map((l) => E.short(l)), py.short);
check("cell() escapes pipes and newlines",
      ["plain", "has | pipe", "has\nnewline", "  padded  "].map(E.cell), py.cell);

/* ---- parsing ----------------------------------------------------------- */
const tasks = E.readTasks(INBOX);
const jsonable = (t) => {
  const o = {};
  for (const k of Object.keys(t)) if (k !== "tags") o[k] = t[k];
  o.tags = [...t.tags].sort();
  return o;
};
check("read_tasks", tasks.map(jsonable), py.read_tasks);
check("read_ledger", E.readLedger(LEDGER), py.read_ledger);

/* ---- events ------------------------------------------------------------ */
/* Every input comes from F. Restating any of them here is how the two halves
 * end up testing different things while both reporting green -- which is
 * exactly what happened when blocked_days was hardcoded on this side. */
const streakOn = F.streak_on;
const earnByDay = F.earn_by_day;
const blockedDays = F.blocked_days;

check("task_completion_events", E.taskCompletionEvents(tasks, streakOn, C),
      py.completion_events);

const today = E.parseDate(F.today);
const start = E.parseDate(F.start);
const baseCursor = F.cursor;

check("decay_events",
      E.decayEvents(tasks, today, blockedDays, earnByDay, start, { ...baseCursor }, C),
      py.decay_events);

const cursorAfter = { ...baseCursor };
E.decayEvents(tasks, today, blockedDays, earnByDay, start, cursorAfter, C);
check("decay advances the cursor even when nothing is charged",
      cursorAfter, py.cursor_after_decay);

/* The global cap binding is a separate scenario: the ordinary fixture never
 * produces enough decay in one day to reach it, so trunc-vs-round in the cap
 * calculation would otherwise never be exercised. */
const capTasks = E.readTasks(F.cap_inbox);
const capCursor = {};
for (const t of capTasks) capCursor[t.id] = "2026-03-09";
check("decay_events with the global cap binding",
      E.decayEvents(capTasks, E.parseDate("2026-03-10"), {}, F.cap_earn,
                    E.parseDate("2026-03-04"), capCursor, C),
      py.decay_events_capped);

/* ---- daily notes, rituals, study, streaks ------------------------------ */
for (const [h, want] of Object.entries(py.section_items)) {
  check(`section_items: ${h}`, E.sectionItems(F.daily_notes["2026-03-01"], h), want);
}

const facts = E.dailyFacts(F.daily_notes);
check("daily_facts", facts, py.daily_facts);
check("review_dates: weekly", [...E.reviewDates(F.weekly_notes)].sort(), py.weekly_dates);
check("review_dates: monthly", [...E.reviewDates(F.monthly_notes)].sort(), py.monthly_dates);
check("ritual_events",
      E.ritualEvents(facts, E.reviewDates(F.weekly_notes),
                     E.reviewDates(F.monthly_notes), C),
      py.ritual_events);

check("study_events", E.studyEvents(F.study, C), py.study_events);

check("compute_streak",
      F.streaks.map(([d, t, f]) => E.computeStreak(d, E.parseDate(t), f)),
      py.streaks);

/* ---- stats and the reward bank ----------------------------------------- */
/* The defaults are generated from achievements.Stats. Checking them here is
 * what stops the generated copy drifting when a field is added to the Python. */
check("stats defaults match the Python dataclass", E.statsDefaults(), py.stats_defaults);

check("longest_run", F.streaks.map(([d]) => E.longestRun(d)), py.longest_run);
check("iso year and week",
      ["2026-01-01", "2025-12-29", "2026-12-31", "2027-01-03", "2026-03-09",
       "2024-12-30", "2021-01-01"].map((d) => E.isoYearWeek(E.parseDate(d)).split("-").map(Number)),
      py.iso_year_week);

const statsFacts = E.dailyFacts(F.daily_notes);
const statsWeeklies = E.reviewDates(F.weekly_notes);
const statsMonthlies = E.reviewDates(F.monthly_notes);
const statsEvents = E.taskCompletionEvents(tasks, {}, C)
  .concat(E.ritualEvents(statsFacts, statsWeeklies, statsMonthlies, C))
  .concat(E.studyEvents(F.study, C));

check("build_stats", E.buildStats({
  tasks, events: statsEvents, facts: statsFacts,
  weeklies: statsWeeklies, monthlies: statsMonthlies,
  states: F.stats_states, lkEvents: F.study,
  today: E.parseDate("2026-03-10"), streak: 4, longest: 9, freezesUsed: 1,
  readiness: F.stats_readiness, manual: new Set(F.stats_manual),
  startDate: F.stats_start, baseline: F.stats_baseline,
  meetingNotes: F.stats_meetings, noteCount: F.stats_note_count,
  readTheDesign: true, C,
}), py.stats);

check("bank_summary",
      F.bank_cases.map(([e, n]) => E.bankSummary(e, n, C, "2026-08-24")),
      py.bank.map((b) => ({ ...b, this_month: b.this_month })));

/* ---- achievements ------------------------------------------------------ */
/* The JS catalog is generated from the Python one by tools/gen-catalog.py.
 * Comparing shape catches a stale generated block; comparing evaluate() and
 * snapshot() over the same Stats catches a predicate that was translated but
 * behaves differently. */
check("catalog shape", E.CATALOG.map(([slug, name, tier, cat, pred]) =>
  [slug, name, tier, cat, pred === null ? null : (pred.f ? { f: true } : { t: pred.t })]),
  py.catalog);

const statsFrom = (v) => Object.assign(E.statsDefaults(), v);

check("evaluate: newly earned achievements",
      F.ach_cases.map(([v, already]) =>
        E.evaluateAchievements(statsFrom(v), new Set(already))),
      py.evaluate);

check("snapshot: the whole catalog with progress",
      F.snap_cases.map(([v, unlocked]) =>
        E.achievementSnapshot(statsFrom(v), unlocked,
                              { "first-blood": "Complete your first task" })),
      py.snapshot);

/* ---- rounding, where two languages quietly disagree -------------------- */
check("banker's rounding matches Python",
      [0.5, 1.5, 2.5, 3.5, -0.5, 2.4, 2.6, 100.5, 101.5].map(E.pyRound),
      [0, 2, 2, 4, -0, 2, 3, 100, 102]);

console.log(fails ? `\n${fails} FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
