"use strict";
/* The Uptick XP engine, in JavaScript.
 *
 * A faithful port of engine/xp-sync.py so that XP, levels, achievements, the
 * Reward Bank and exam readiness work from a plain plugin install, with no
 * Python and no scheduled job. The Python remains the reference implementation
 * and still runs as a CLI; engine/tests/parity_test.js runs both against the
 * same vault and asserts they produce byte-identical ledgers.
 *
 * Rules carried over from the Python, unchanged:
 *   - Markdown is the source of truth. The ledger is the record; every other
 *     game note is derived and safe to delete.
 *   - This NEVER writes task lines. priority-task-sync owns that format;
 *     difficulty is read from the [difficulty:: N] field it writes.
 *   - Every event carries a deterministic id, so re-running cannot
 *     double-count and a missed day can always be caught up.
 *   - Local only. No network.
 *
 * Pure functions here take plain data, never an Obsidian object, so the whole
 * computation is testable in node with no vault and no app.
 */


/* ------------------------------------------------------------ game config */

const BASE_XP = { 1: 10, 2: 25, 3: 50, 4: 100, 5: 200 };
const DIFF_LABEL = { 1: "Trivial", 2: "Small", 3: "Standard", 4: "Hard", 5: "Epic" };

const EARLY_MULT = 1.25, ONTIME_MULT = 1.0, LATE_MULT = 0.5;
const PRIORITY_BONUS_LEVELS = [1, 2];
const PRIORITY_MULT = 1.25;
const STREAK_STEP = 0.02, STREAK_CAP = 1.3;

const DECAY_RATE = 0.10;        // of base XP, per day overdue
const DECAY_GRACE_DAYS = 1;     // decay starts on the second day overdue
/* Most days this runs on schedule. When it has not, the backlog is forgiven
 * rather than charged in one lump: the system only bills for time it was
 * actually watching. */
const MAX_CATCHUP_DAYS = 7;
const GLOBAL_DECAY_FRACTION = 0.25;   // of the trailing 7-day earn rate

const CARD_XP = { easy: 3, good: 3, hard: 2, again: 1 };
const NOTE_REVIEW_XP = 5;
const SESSION_BONUS_XP = 10;
const SESSION_MIN_CARDS = 10;
const CARD_XP_DAILY_CAP = 400;

const RITUAL_XP = {
  intentions_early: 15, intentions: 10, worklog: 5, eod: 20,
  agenda: 10, weekly: 75, monthly: 200, triaged: 25,
};
const WORKLOG_DAILY_CAP = 4;

const RANKS = [[100, "Ascended"], [75, "Legend"], [60, "Luminary"], [50, "Distinguished"],
               [40, "Principal"], [30, "Architect"], [20, "Specialist"],
               [10, "Technician"], [1, "Operator"]];

const BANK_RATE = 250.0;      // XP per $1
const LEVEL_BONUS = 2.0;      // dollars per level, times the level
const MONTHLY_CEILING = 100.0;
const FREEZES_PER_MONTH = 2;

const TIER_XP = { Bronze: 50, Silver: 150, Gold: 500,
                  Platinum: 1500, Mythic: 5000, Hidden: 0 };

/* Config from the plugin's own settings overrides every rate above, so a
 * number changed in the UI changes what the engine awards. One source of
 * truth, and it is the settings page. */
function applyConfig(cfg) {
  const g = (cfg && cfg.game) || {};
  const out = {
    BASE_XP: { ...BASE_XP }, EARLY_MULT, LATE_MULT, DECAY_RATE,
    DECAY_GRACE_DAYS, MAX_CATCHUP_DAYS, GLOBAL_DECAY_FRACTION,
    CARD_XP: { ...CARD_XP }, NOTE_REVIEW_XP, SESSION_BONUS_XP,
    SESSION_MIN_CARDS, CARD_XP_DAILY_CAP, RITUAL_XP: { ...RITUAL_XP },
    WORKLOG_DAILY_CAP, BANK_RATE, LEVEL_BONUS, MONTHLY_CEILING,
    FREEZES_PER_MONTH, STREAK_STEP, STREAK_CAP, PRIORITY_MULT,
  };
  const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);
  if (g.baseXp) for (const k of [1, 2, 3, 4, 5]) out.BASE_XP[k] = num(g.baseXp[k], out.BASE_XP[k]);
  if (g.cardXp) for (const k of Object.keys(out.CARD_XP)) out.CARD_XP[k] = num(g.cardXp[k], out.CARD_XP[k]);
  if (g.ritualXp) for (const k of Object.keys(out.RITUAL_XP)) out.RITUAL_XP[k] = num(g.ritualXp[k], out.RITUAL_XP[k]);
  for (const k of ["EARLY_MULT", "LATE_MULT", "DECAY_RATE", "DECAY_GRACE_DAYS",
                   "MAX_CATCHUP_DAYS", "GLOBAL_DECAY_FRACTION", "NOTE_REVIEW_XP",
                   "SESSION_BONUS_XP", "SESSION_MIN_CARDS", "CARD_XP_DAILY_CAP",
                   "WORKLOG_DAILY_CAP", "BANK_RATE", "LEVEL_BONUS",
                   "MONTHLY_CEILING", "FREEZES_PER_MONTH", "STREAK_STEP",
                   "STREAK_CAP", "PRIORITY_MULT"]) {
    const camel = k.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[k] = num(g[camel], out[k]);
  }
  return out;
}

/* ------------------------------------------------------------ levels */

/* Total XP required to reach level n. Level 1 is where everyone starts. */
function levelThreshold(n) {
  return n <= 1 ? 0 : 50 * n * n + 50 * n;
}

function levelFor(totalXp) {
  let n = 1;
  while (levelThreshold(n + 1) <= totalXp) n += 1;
  return n;
}

function rankFor(level) {
  for (const [need, name] of RANKS) if (level >= need) return name;
  return "Operator";
}

/* ------------------------------------------------------------ dates
 *
 * Dates are handled as YYYY-MM-DD strings and UTC-noon Date objects. Noon,
 * not midnight, so that a daylight-saving shift cannot move a date across a
 * day boundary and silently change which day an event lands on. */

function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

function isoDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
       + `-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}


/* ------------------------------------------------------------ task parsing */

const TASK_RE = /^- \[([ xX])\] (.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const CREATED_RE = /➕\s*(\d{4}-\d{2}-\d{2})/;
const DIFF_RE = /\[difficulty::\s*([1-5])\s*([!~]?)\s*\]/;
const PRIO_RE = /\[priority::\s*(\d+)\s*\]/;
const ID_RE = /\^(task-[A-Za-z0-9-]+)/;
const TAG_RE = /#[A-Za-z0-9_/-]+/g;
const SOURCE_RE = /Source:\s*\[\[([^\]|]+)/;

function readTasks(inboxText) {
  if (!inboxText) return [];
  const lines = String(inboxText).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = TASK_RE.exec(lines[i]);
    if (!m || !m[2].includes("#task")) continue;
    const body = m[2];
    /* Provenance sits on the lines after the checkbox, up to the next task. */
    const extra = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !TASK_RE.test(lines[j])) {
      extra.push(lines[j]);
      j += 1;
    }
    const segment = [lines[i], ...extra].join("\n");
    const tags = new Set(body.match(TAG_RE) || []);
    const diff = DIFF_RE.exec(body);
    const tid = ID_RE.exec(body);
    const prio = PRIO_RE.exec(body);
    const due = DUE_RE.exec(body);
    const doneOn = DONE_RE.exec(body);
    const created = CREATED_RE.exec(body);
    const source = SOURCE_RE.exec(segment);
    const checked = m[1].toLowerCase() === "x";
    out.push({
      id: tid ? tid[1] : `line-${i}`,
      checked,
      done: tags.has("#done") || checked,
      blocked: tags.has("#blocked") || tags.has("#dependency"),
      tags,
      difficulty: diff ? parseInt(diff[1], 10) : 3,
      difficulty_mark: diff ? diff[2] : "",
      priority: prio ? parseInt(prio[1], 10) : 10,
      due: due ? due[1] : null,
      done_on: doneOn ? doneOn[1] : null,
      created: created ? created[1] : null,
      source: source ? source[1] : null,
      text: body,
      segment,
    });
  }
  return out;
}

/* Clean a task line down to its title, for a ledger detail. The ledger is a
 * permanent record, so the limit is generous: a decay row reading
 * "... update field permissi…" is useless for as long as it exists. */
function short(text, n = 120) {
  let clean = String(text)
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[(?:priority|difficulty|ticket)::[^\]]*\]/g, "")
    .replace(/[📅✅➕⏳🛫]\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\^task-[A-Za-z0-9-]+/g, "")
    .replace(/#[A-Za-z0-9_/-]+/g, "")
    .replace(/[⏫🔼🔽⏬🔺]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}

/* ------------------------------------------------------------ ledger */

const LEDGER_ROW_RE =
  /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([+-]?\d+)\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*`([^`]+)`\s*\|$/;

function readLedger(text) {
  if (!text) return [];
  const events = [];
  for (const line of String(text).split("\n")) {
    const m = LEDGER_ROW_RE.exec(line.trim());
    if (m) {
      events.push({ date: m[1], xp: parseInt(m[2], 10), kind: m[3],
                    detail: m[4], id: m[5] });
    }
  }
  return events;
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function ledgerRow(e) {
  const sign = e.xp >= 0 ? "+" : "-";
  return `| ${e.date} | ${sign}${Math.abs(e.xp)} | ${e.kind} | ${cell(e.detail)} | \`${e.id}\` |`;
}

/* ------------------------------------------------------------ events */

function taskCompletionEvents(tasks, streakOn, C) {
  const out = [];
  for (const t of tasks) {
    if (!t.done || !t.done_on) continue;
    const done = parseDate(t.done_on), due = parseDate(t.due);
    const base = C.BASE_XP[t.difficulty];
    let timing, label;
    if (due === null || done.getTime() === due.getTime()) {
      timing = ONTIME_MULT; label = "on time";
    } else if (done < due) {
      timing = C.EARLY_MULT; label = "early";
    } else {
      timing = C.LATE_MULT; label = "late";
    }
    const prio = PRIORITY_BONUS_LEVELS.includes(t.priority) ? C.PRIORITY_MULT : 1.0;
    const streak = Math.min(C.STREAK_CAP, 1 + C.STREAK_STEP * (streakOn[t.done_on] || 0));
    const xp = Math.floor(base * timing * prio * streak + 0.5);
    out.push({
      date: t.done_on, xp: xp, kind: "task",
      detail: `D${t.difficulty} ${DIFF_LABEL[t.difficulty]} · ${label} · ${short(t.text)}`,
      id: `task:${t.id}`,
    });
  }
  return out;
}

/* One event per overdue task per day, with all three caps applied.
 *
 * `cursor` records the last day already considered for each task and advances
 * whether or not a charge was made. Without it, a task that spent three months
 * blocked would be charged for every one of those days the moment it was
 * unblocked -- the instant debt the design exists to prevent. */
function decayEvents(tasks, today, blockedDays, earnByDay, start, cursor, C) {
  const raw = {};
  for (const t of tasks) {
    if (t.done) continue;
    const due = parseDate(t.due);
    if (!due) continue;
    /* Blocked stops the clock. The cursor still moves, so those days are
     * consumed rather than banked up to be charged on unblock. */
    if (t.blocked) {
      cursor[t.id] = isoDate(today);
      continue;
    }
    const base = C.BASE_XP[t.difficulty];
    const firstMs = Math.max(addDays(due, 1 + C.DECAY_GRACE_DAYS).getTime(), start.getTime());
    const seen = parseDate(cursor[t.id]);
    if (seen === null) {
      /* First sighting. A task starts decaying from the day the engine first
       * observes it, never before -- otherwise importing a task already three
       * weeks late charges three weeks of decay at once, for a delay that
       * happened before the system could see it. */
      cursor[t.id] = isoDate(today);
      continue;
    }
    let day = new Date(Math.max(firstMs, addDays(seen, 1).getTime(),
                                addDays(today, -(C.MAX_CATCHUP_DAYS - 1)).getTime()));
    const blocked = blockedDays[t.id] || 0;
    while (day <= today) {
      /* Escalation is capped by how long the system has been watching. A task
       * already 40 days overdue on day one starts at day one's rate, not day
       * forty's -- the same reason there is no backfill. */
      const observed = daysBetween(start, day) + 1;
      const overdueN = Math.min(daysBetween(due, day) - blocked, observed);
      if (overdueN > C.DECAY_GRACE_DAYS) {
        const amount = Math.min(base,
          Math.ceil(base * C.DECAY_RATE) * (overdueN - C.DECAY_GRACE_DAYS));
        const iso = isoDate(day);
        (raw[iso] = raw[iso] || []).push({
          date: iso, xp: -amount, kind: "decay",
          detail: `${overdueN}d overdue · D${t.difficulty} · ${short(t.text)}`,
          id: `decay:${t.id}:${iso}`,
        });
      }
      day = addDays(day, 1);
    }
    cursor[t.id] = isoDate(today);
  }

  /* Global cap: a bad week cannot erase a good month. */
  const out = [];
  for (const dayIso of Object.keys(raw).sort()) {
    const d = parseDate(dayIso);
    const window = [];
    for (let k = 1; k <= 7; k++) window.push(earnByDay[isoDate(addDays(d, -k))] || 0);
    const avg = window.some((v) => v) ? window.reduce((a, b) => a + b, 0) / 7 : 0;
    const cap = Math.max(10, Math.trunc(avg * C.GLOBAL_DECAY_FRACTION));
    const total = raw[dayIso].reduce((s, e) => s + -e.xp, 0);
    if (total <= cap) {
      out.push(...raw[dayIso]);
      continue;
    }
    const scale = cap / total;
    for (const e of raw[dayIso]) {
      const scaled = Math.max(1, pyRound(-e.xp * scale));
      out.push({ ...e, xp: -scaled, detail: e.detail + " (capped)" });
    }
  }
  return out;
}

/* Python's round() is banker's rounding -- round-half-to-even -- and
 * JavaScript's Math.round is round-half-up. On a .5 the two disagree, which is
 * one XP of drift per capped decay row and a parity failure. */
function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/* ------------------------------------------------------- daily note facts */

/* Bullet items directly under a `## heading`, up to the next heading. */
function sectionItems(text, heading) {
  const esc = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^#{1,6}\\s+${esc}\\s*$`, "im").exec(String(text || ""));
  if (!m) return [];
  const rest = String(text).slice(m.index + m[0].length);
  const stop = /^#{1,6}\s+/m.exec(rest);
  const block = stop ? rest.slice(0, stop.index) : rest;
  return block.split("\n")
    .map((ln) => ln.trim())
    .filter((ln) => ln.startsWith("- ") && ln.slice(2).trim())
    .map((ln) => ln.slice(2).trim());
}

const WORKLOG_TIME_RE = /^`(\d{1,2}):(\d{2})\s*(AM|PM)`/i;

/* Per-day ritual facts, keyed by ISO date. `notes` is {"YYYY-MM-DD": text}. */
function dailyFacts(notes) {
  const facts = {};
  for (const day of Object.keys(notes || {}).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const text = notes[day] || "";
    const priorities = sectionItems(text, "Priorities").concat(sectionItems(text, "Focus"));
    const worklog = sectionItems(text, "Work Log");
    const completed = sectionItems(text, "Completed");
    const tomorrow = sectionItems(text, "Notes for Tomorrow");
    /* "Before 10:00" is judged from the first timestamped work-log entry, the
     * only clock the daily note actually records. */
    let earliest = null;
    for (const entry of worklog) {
      const m = WORKLOG_TIME_RE.exec(entry);
      if (!m) continue;
      const hour = (parseInt(m[1], 10) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
      const stamp = hour * 60 + parseInt(m[2], 10);
      earliest = earliest === null ? stamp : Math.min(earliest, stamp);
    }
    facts[day] = {
      intentions: priorities.length,
      worklog: worklog.length,
      eod: !!(completed.length && tomorrow.length),
      earliest_minute: earliest,
    };
  }
  return facts;
}

/* Dates of review notes that actually contain something. `notes` maps a file
 * stem to its text. */
function reviewDates(notes) {
  const out = new Set();
  for (const stem of Object.keys(notes || {}).sort()) {
    const text = notes[stem] || "";
    let body = text.replace(/^---[\s\S]*?^---/m, "");
    body = body.replace(/```life-os[\s\S]*?```/g, "");
    if (!body.split("\n").some((ln) => ln.trim().startsWith("- "))) continue;
    const m = /(\d{4}-\d{2}-\d{2})/.exec(stem)
           || /date:\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    if (m) out.add(m[1]);
  }
  return out;
}

function ritualEvents(facts, weeklies, monthlies, C) {
  const out = [];
  for (const day of Object.keys(facts).sort()) {
    const f = facts[day];
    if (f.intentions) {
      const early = f.earliest_minute !== null && f.earliest_minute < 10 * 60;
      const key = early ? "intentions_early" : "intentions";
      out.push({ date: day, xp: C.RITUAL_XP[key], kind: "ritual",
                 detail: "what matters today" + (early ? " (before 10:00)" : ""),
                 id: `ritual:${day}:intentions` });
    }
    const n = Math.min(C.WORKLOG_DAILY_CAP, f.worklog);
    if (n) {
      out.push({ date: day, xp: C.RITUAL_XP.worklog * n, kind: "ritual",
                 detail: `${n} work log entr${n === 1 ? "y" : "ies"}`,
                 id: `ritual:${day}:worklog` });
    }
    if (f.eod) {
      out.push({ date: day, xp: C.RITUAL_XP.eod, kind: "ritual",
                 detail: "end of day review", id: `ritual:${day}:eod` });
    }
  }
  for (const day of [...weeklies].sort()) {
    out.push({ date: day, xp: C.RITUAL_XP.weekly, kind: "ritual",
               detail: "weekly review", id: `ritual:${day}:weekly` });
  }
  for (const day of [...monthlies].sort()) {
    out.push({ date: day, xp: C.RITUAL_XP.monthly, kind: "ritual",
               detail: "monthly review", id: `ritual:${day}:monthly` });
  }
  return out;
}

/* ------------------------------------------------------------------ study */

/* Turn LearnKit analytics into XP events, capped per day. */
function studyEvents(events, C) {
  const out = [];
  const cardXpByDay = {};
  const sessionSeen = new Set();

  const sorted = [...(events || [])].sort((a, b) =>
    ((a.at || 0) - (b.at || 0)) || ((a.eventId || 0) - (b.eventId || 0)));

  for (const ev of sorted) {
    const at = ev.at;
    if (!at) continue;
    /* Python uses datetime.fromtimestamp, which is LOCAL time. Using UTC here
     * would move an evening review onto the next day. */
    const d = new Date(at);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
              + `-${String(d.getDate()).padStart(2, "0")}`;
    const eid = ev.eventId;
    const practice = ev.mode === "practice";

    if (ev.kind === "review") {
      const result = String(ev.result || "good").toLowerCase();
      let xp = C.CARD_XP[result] !== undefined ? C.CARD_XP[result] : 1;
      /* Python's // on positive ints floors; Math.trunc matches for these. */
      if (practice) xp = Math.floor(xp / 2);
      if (xp <= 0) continue;
      const used = cardXpByDay[day] || 0;
      const room = C.CARD_XP_DAILY_CAP - used;
      if (room <= 0) continue;
      xp = Math.min(xp, room);
      cardXpByDay[day] = used + xp;
      out.push({ date: day, xp, kind: "study",
                 detail: `card reviewed (${result})`, id: `study:${eid}` });
    } else if (ev.kind === "note-review") {
      out.push({ date: day, xp: C.NOTE_REVIEW_XP, kind: "study",
                 detail: "note reviewed", id: `study:${eid}` });
    } else if (ev.kind === "session") {
      const scope = String(ev.scope || "deck");
      const key = `${day}\u0000${scope}`;
      if (sessionSeen.has(key)) continue;
      sessionSeen.add(key);
      out.push({ date: day, xp: C.SESSION_BONUS_XP, kind: "study",
                 detail: `study session (${scope})`, id: `study:${eid}` });
    } else if (ev.kind === "exam-attempt") {
      const pct = Number(ev.finalPercent || 0);
      const q = parseInt(ev.mcqCount || 0, 10) + parseInt(ev.saqCount || 0, 10);
      let xp, band;
      if (q >= 40) { xp = Math.min(300, pyRound(50 + pct * 2.5)); band = "practice exam"; }
      else if (q >= 15) { xp = Math.min(125, pyRound(25 + pct * 1.0)); band = "test"; }
      else { xp = Math.min(60, pyRound(10 + pct * 0.5)); band = "quiz"; }
      out.push({ date: day, xp, kind: "study",
                 detail: `${band} · ${pctFmt(pct)}% (${q} q)`, id: `study:${eid}` });
    }
  }
  return out;
}

/* Python's f"{pct:.0f}" rounds half to even, so 2.5 formats as "2". */
function pctFmt(pct) {
  return String(pyRound(Number(pct)));
}

/* ----------------------------------------------------------------- streak */

/* [current, longest, freezes spent].
 *
 * A freeze bridges one missing day without breaking the run, but does not
 * itself count as a day earned -- the streak is preserved, not inflated. */
function computeStreak(days, today, freezes) {
  if (!days || !days.length) return [0, 0, 0];
  const active = [...new Set(days)].sort().map(parseDate).filter(Boolean);
  if (!active.length) return [0, 0, 0];

  let longest = 1, run = 1;
  for (let i = 1; i < active.length; i++) {
    run = daysBetween(active[i - 1], active[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const have = new Set(active.map(isoDate));
  const earliest = active[0];
  /* Not having earned yet today should not break yesterday's streak. */
  let cursor = have.has(isoDate(today)) ? today : addDays(today, -1);
  let current = 0, spent = 0;
  while (cursor >= earliest) {
    if (have.has(isoDate(cursor))) current += 1;
    else if (spent < freezes) spent += 1;
    else break;
    cursor = addDays(cursor, -1);
  }
  return [current, Math.max(longest, current), spent];
}

/* ------------------------------------------------------------------ stats */

const SF_TERMS = {
  deploy_tasks: ["deploy", "deployment", "release"],
  sandbox_tasks: ["sandbox", "refresh"],
  permission_tasks: ["permission", "profile", "sharing", "fls", "access"],
  integration_tasks: ["integration", "mulesoft", "api", "endpoint"],
  data_tasks: ["data load", "data remediation", "cleanup", "migration", "soql"],
  bug_tasks: ["bug", "defect", "broken", "not working", "incorrectly"],
};

function longestRun(days) {
  if (!days || !days.length) return 0;
  const ds = [...days].sort().map(parseDate).filter(Boolean);
  if (!ds.length) return 0;
  let best = 1, run = 1;
  for (let i = 1; i < ds.length; i++) {
    run = daysBetween(ds[i - 1], ds[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/* Python's date.isocalendar()[:2] -- ISO year and week. Not the same as a
 * naive week number around New Year, which is the whole reason ISO weeks
 * exist. */
function isoYearWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;          // Monday = 0
  t.setUTCDate(t.getUTCDate() - dayNum + 3);       // nearest Thursday
  const isoYear = t.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
  return `${isoYear}-${week}`;
}

const counter = (items) => {
  const c = {};
  for (const it of items) c[it] = (c[it] || 0) + 1;
  return c;
};
const maxOf = (obj) => {
  const v = Object.values(obj);
  return v.length ? Math.max(...v) : 0;
};

/* Every field the achievement predicates are allowed to look at, with the
 * same defaults as achievements.Stats. Generated from that dataclass and
 * checked against it by parity_test.js, so the two cannot drift.
 *
 * build_stats assigns most of these; the rest stay at their default and
 * exist so a predicate reading one never sees undefined. */
function statsDefaults() {
  return {
  achievements_unlocked: 0,
  after_23: 0,
  all_difficulties_one_day: false,
  bank_lifetime: 0.0,
  beat_longest_streak: false,
  before_6: 0,
  before_8: 0,
  best_exam_pct: 0.0,
  best_full_exam_pct: 0.0,
  bookend_days: 0,
  bug_tasks: 0,
  by_difficulty: {},
  cards_created: 0,
  cards_reviewed: 0,
  certs_first_try: 0,
  certs_passed: 0,
  data_tasks: 0,
  decks_cleared: 0,
  deploy_tasks: 0,
  done_early: 0,
  done_late: 0,
  done_same_day: 0,
  eod_completes: 0,
  epics_done: 0,
  exam_improve_streak: 0,
  full_blueprint_coverage: false,
  full_exams_taken: 0,
  full_house_days: 0,
  full_house_streak: 0,
  full_log_days: 0,
  fully_triaged_days: 0,
  fully_triaged_streak: 0,
  goals_completed: 0,
  graded_again: 0,
  hard_plus_done: 0,
  integration_tasks: 0,
  intention_days: 0,
  intention_streak: 0,
  intentions_before_8: 0,
  longest_streak: 0,
  manual_difficulty: 0,
  mature_cards: 0,
  max_meetings_day: 0,
  max_overdue_cleared_day: 0,
  max_project_tasks: 0,
  max_readiness: 0.0,
  max_tasks_day: 0,
  max_tasks_month: 0,
  max_tasks_one_meeting: 0,
  max_tasks_week: 0,
  meetings_fully_closed: 0,
  meetings_imported: 0,
  meetings_with_agenda: 0,
  monday_tasks_max: 0,
  monthly_review_streak: 0,
  monthly_reviews: 0,
  no_weak_domain: false,
  note_count: 0,
  notes_reviewed: 0,
  overdue_cleared: 0,
  perfect_months: 0,
  perfect_tests: 0,
  perfect_weeks: 0,
  permission_tasks: 0,
  projects_completed: 0,
  quizzes_taken: 0,
  read_the_design: false,
  readiness_no_retakes: false,
  real_exams_sat: 0,
  req_tasks: 0,
  reschedule_max: 0,
  revived_30d: 0,
  revived_90d: 0,
  salesforce_tasks: 0,
  sandbox_tasks: 0,
  saturday_tasks_max: 0,
  scheduled_clear_streak: 0,
  streak: 0,
  streak_freezes_used: 0,
  study_plans: 0,
  tasks_done: 0,
  tasks_done_today: 0,
  tests_taken: 0,
  unblocked_completed: 0,
  vacation_weeks: 0,
  weekend_pairs: 0,
  weekly_review_streak: 0,
  weekly_reviews: 0,
  worklog_entries: 0,
  xp_from_epics: 0,
  zero_overdue_now: false,
  zero_overdue_streak: 0,
  };
}

/* Stats the achievement predicates see.
 *
 * Everything is measured from `startDate` forward. Counts that describe the
 * vault as it already stood -- notes, meetings, cards that existed before the
 * system was switched on -- are measured against `baseline`, so "start at
 * zero" means zero rather than an instant windfall for work done earlier. */
function buildStats(input) {
  const { tasks = [], events = [], states = {}, lkEvents = [], today,
          streak = 0, longest = 0, freezesUsed = 0, readiness = [],
          manual = new Set(), startDate = "0000-00-00", baseline = {},
          meetingNotes = {}, noteCount = 0, readTheDesign = false, C } = input;

  const s = statsDefaults();
  const since = (n, key) => Math.max(0, n - (parseInt(baseline[key], 10) || 0));
  const todayIso = isoDate(today);

  const facts = {};
  for (const [d, f] of Object.entries(input.facts || {})) if (d >= startDate) facts[d] = f;
  const weeklies = new Set([...(input.weeklies || [])].filter((d) => d >= startDate));
  const monthlies = new Set([...(input.monthlies || [])].filter((d) => d >= startDate));
  const lk = lkEvents.filter((e) => {
    if (!e.at) return false;
    const d = new Date(e.at);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
              + `-${String(d.getDate()).padStart(2, "0")}`;
    return iso >= startDate;
  });

  const done = tasks.filter((t) => t.done && t.done_on && t.done_on >= startDate);
  s.tasks_done = done.length;
  const perDay = counter(done.map((t) => t.done_on));
  s.tasks_done_today = perDay[todayIso] || 0;
  s.max_tasks_day = maxOf(perDay);
  s.max_tasks_week = maxOf(counter(done.map((t) => isoYearWeek(parseDate(t.done_on)))));
  s.max_tasks_month = maxOf(counter(done.map((t) => t.done_on.slice(0, 7))));

  s.by_difficulty = counter(done.map((t) => t.difficulty));
  s.hard_plus_done = done.filter((t) => t.difficulty >= 4).length;
  s.epics_done = done.filter((t) => t.difficulty === 5).length;
  s.xp_from_epics = events.filter((e) => e.kind === "task" && ` ${e.detail} `.includes(" D5 "))
    .reduce((a, e) => a + e.xp, 0);

  const byDayDiffs = {};
  for (const t of done) (byDayDiffs[t.done_on] = byDayDiffs[t.done_on] || new Set()).add(t.difficulty);
  s.all_difficulties_one_day = Object.values(byDayDiffs).some((v) => v.size === 5);

  s.done_early = 0; s.done_late = 0; s.revived_30d = 0; s.revived_90d = 0;
  s.overdue_cleared = 0; s.done_same_day = 0;
  for (const t of done) {
    const d = parseDate(t.done_on), u = parseDate(t.due);
    if (u && d) {
      if (d < u) s.done_early += 1;
      else if (d > u) {
        s.done_late += 1;
        const late = daysBetween(u, d);
        if (late > 30) s.revived_30d += 1;
        if (late > 90) s.revived_90d += 1;
        s.overdue_cleared += 1;
      }
    }
    const c = parseDate(t.created);
    if (c && d && c.getTime() === d.getTime()) s.done_same_day += 1;
  }
  s.max_overdue_cleared_day = maxOf(counter(done
    .filter((t) => parseDate(t.due) && parseDate(t.done_on)
                && parseDate(t.done_on) > parseDate(t.due))
    .map((t) => t.done_on)));

  const openTasks = tasks.filter((t) => !t.done);
  s.zero_overdue_now = !openTasks.some((t) =>
    t.due && parseDate(t.due) && parseDate(t.due) < today && !t.blocked);

  s.streak = streak; s.longest_streak = longest; s.streak_freezes_used = freezesUsed;
  const weekend = new Set(Object.keys(perDay)
    .filter((d) => { const w = parseDate(d).getUTCDay(); return w === 6 || w === 0; }));
  s.weekend_pairs = [...weekend].filter((d) =>
    parseDate(d).getUTCDay() === 6 && weekend.has(isoDate(addDays(parseDate(d), 1)))).length;

  s.cards_reviewed = lk.filter((e) => e.kind === "review").length;
  s.graded_again = lk.filter((e) => e.kind === "review"
    && String(e.result).toLowerCase() === "again").length;
  s.notes_reviewed = lk.filter((e) => e.kind === "note-review").length;
  s.cards_created = since(Object.keys(states).length, "cards");
  s.mature_cards = Object.values(states).filter((st) =>
    st && typeof st === "object" && (st.stabilityDays || 0) > 30).length;

  s.full_exams_taken = 0; s.best_full_exam_pct = 0; s.tests_taken = 0;
  s.perfect_tests = 0; s.quizzes_taken = 0; s.best_exam_pct = 0;
  for (const e of lk.filter((x) => x.kind === "exam-attempt")) {
    const q = (parseInt(e.mcqCount || 0, 10)) + (parseInt(e.saqCount || 0, 10));
    const pct = Number(e.finalPercent || 0);
    if (q >= 40) {
      s.full_exams_taken += 1;
      s.best_full_exam_pct = Math.max(s.best_full_exam_pct, pct);
    } else if (q >= 15) {
      s.tests_taken += 1;
      if (pct >= 100) s.perfect_tests += 1;
    } else {
      s.quizzes_taken += 1;
    }
    s.best_exam_pct = Math.max(s.best_exam_pct, pct);
  }

  const factEntries = Object.entries(facts);
  const intentDays = factEntries.filter(([, f]) => f.intentions).map(([d]) => d).sort();
  s.intention_days = intentDays.length;
  s.intention_streak = longestRun(intentDays);
  s.intentions_before_8 = factEntries.filter(([, f]) =>
    f.intentions && f.earliest_minute !== null && f.earliest_minute < 8 * 60).length;
  s.worklog_entries = factEntries.reduce((a, [, f]) => a + f.worklog, 0);
  s.full_log_days = factEntries.filter(([, f]) => f.worklog >= C.WORKLOG_DAILY_CAP).length;
  s.eod_completes = factEntries.filter(([, f]) => f.eod).length;
  const fullHouse = factEntries
    .filter(([, f]) => f.intentions && f.worklog >= C.WORKLOG_DAILY_CAP && f.eod)
    .map(([d]) => d).sort();
  s.full_house_days = fullHouse.length;
  s.full_house_streak = longestRun(fullHouse);

  s.weekly_reviews = weeklies.size;
  s.weekly_review_streak = weeklies.size;
  s.monthly_reviews = monthlies.size;
  s.monthly_review_streak = monthlies.size;

  const meetingPaths = Object.keys(meetingNotes);
  s.meetings_imported = since(meetingPaths.length, "meetings");
  s.meetings_with_agenda = meetingPaths.filter((f) =>
    sectionItems(meetingNotes[f], "Agenda").length).length;

  /* Only meetings whose work was closed since the start date count -- these are
   * achievements for finishing things, not for history already on disk. */
  const closedSince = counter(done.filter((t) => t.source).map((t) => t.source));
  s.max_tasks_one_meeting = maxOf(closedSince);
  const srcOpen = new Set(tasks.filter((t) => t.source && !t.done).map((t) => t.source));
  s.meetings_fully_closed = Object.keys(closedSince).filter((src) => !srcOpen.has(src)).length;

  for (const field of Object.keys(SF_TERMS)) s[field] = 0;
  s.req_tasks = 0; s.salesforce_tasks = 0;
  for (const t of done) {
    const low = t.text.toLowerCase();
    for (const [field, terms] of Object.entries(SF_TERMS)) {
      if (terms.some((term) => low.includes(term))) s[field] += 1;
    }
    if (/\bREQ-\d+\b/i.test(t.text)) s.req_tasks += 1;
    if (t.tags.has("#salesforce") || low.includes("salesforce")) s.salesforce_tasks += 1;
  }

  s.note_count = since(noteCount, "notes");
  s.manual_difficulty = tasks.filter((t) => t.difficulty_mark === "!").length;
  s.achievements_unlocked = manual.size !== undefined ? manual.size : 0;
  s.read_the_design = !!readTheDesign;

  s.max_readiness = 0; s.no_weak_domain = false; s.full_blueprint_coverage = false;
  s.readiness_no_retakes = false; s.study_plans = 0; s.certs_passed = 0;
  s.certs_first_try = 0; s.real_exams_sat = 0;
  if (readiness && readiness.length) {
    s.max_readiness = Math.max(...readiness.map((r) => r.score));
    s.no_weak_domain = readiness.some((r) => r.no_weak_domain);
    s.full_blueprint_coverage = readiness.some((r) => (r.coverage || 0) >= 0.999);
    s.readiness_no_retakes = readiness.some((r) => r.no_retakes && r.score >= 90);
    s.study_plans = readiness.length;
    s.certs_passed = readiness.filter((r) => r.passed).length;
    s.certs_first_try = readiness.filter((r) => r.passed && r.first_try).length;
    s.real_exams_sat = readiness.reduce((a, r) => a + (r.real_attempts || 0), 0);
  }
  return s;
}

/* ------------------------------------------------------------ reward bank */

/* Net-daily-XP banking, monthly ceiling, never negative. */
function bankSummary(events, levelsReached, C, todayIso) {
  const byDay = {};
  for (const e of events) byDay[e.date] = (byDay[e.date] || 0) + e.xp;
  const perMonth = {};
  let total = 0;
  for (const day of Object.keys(byDay).sort()) {
    const net = Math.max(0, byDay[day]);
    const month = day.slice(0, 7);
    const used = perMonth[month] || 0;
    const room = C.MONTHLY_CEILING - used;
    if (room <= 0) continue;
    const amount = Math.min(room, net / C.BANK_RATE);
    perMonth[month] = used + amount;
    total += amount;
  }
  let bonus = 0;
  for (let n = 2; n <= levelsReached; n++) bonus += C.LEVEL_BONUS * n;
  return {
    earned: round2(total),
    level_bonus: round2(bonus),
    total: round2(total + bonus),
    this_month: round2(perMonth[String(todayIso).slice(0, 7)] || 0),
  };
}

/* Python's round(x, 2) is half-to-even on the decimal, and floats make that
 * subtle: round(2.675, 2) is 2.67 in both languages because 2.675 is really
 * 2.67499... This mirrors it by scaling and reusing pyRound. */
function round2(x) {
  const scaled = x * 100;
  /* Guard the representation error that would otherwise turn 1.005 * 100 into
   * 100.49999999999999 and round it down when Python rounds it up. */
  const nudged = Math.abs(scaled - Math.round(scaled)) < 1e-9 ? Math.round(scaled) : scaled;
  return pyRound(nudged) / 100;
}

/* ----------------------------------------------------- achievements */

/* Generated from engine/achievements.py by tools/gen-catalog.py.
 * [slug, name, tier, category, predicate]. A null predicate is a manual
 * award -- something the engine cannot see, granted by hand.
 *
 * Do not edit by hand: parity_test.js evaluates this and the Python
 * catalog over the same Stats and fails on any disagreement.
 */
/* --- BEGIN GENERATED CATALOG --- */
const CATALOG = [
  ["first-blood", "First Blood", "Bronze", "Volume", { t: 1, g: (s) => s.tasks_done }, "Complete your first task"],
  ["getting-started", "Getting Started", "Bronze", "Volume", { t: 10, g: (s) => s.tasks_done }, "Complete 10 tasks"],
  ["warmed-up", "Warmed Up", "Bronze", "Volume", { t: 50, g: (s) => s.tasks_done }, "Complete 50 tasks"],
  ["centurion", "Centurion", "Silver", "Volume", { t: 100, g: (s) => s.tasks_done }, "Complete 100 tasks"],
  ["quarter-thousand", "Quarter Thousand", "Silver", "Volume", { t: 250, g: (s) => s.tasks_done }, "Complete 250 tasks"],
  ["five-hundred", "Five Hundred", "Gold", "Volume", { t: 500, g: (s) => s.tasks_done }, "Complete 500 tasks"],
  ["kilotask", "Kilotask", "Gold", "Volume", { t: 1000, g: (s) => s.tasks_done }, "Complete 1,000 tasks"],
  ["two-thousand", "Two Thousand Strong", "Platinum", "Volume", { t: 2500, g: (s) => s.tasks_done }, "Complete 2,500 tasks"],
  ["five-digits-away", "Five Digits Away", "Platinum", "Volume", { t: 5000, g: (s) => s.tasks_done }, "Complete 5,000 tasks"],
  ["ten-thousand-hours", "Ten Thousand Hours", "Mythic", "Volume", { t: 10000, g: (s) => s.tasks_done }, "Complete 10,000 tasks"],
  ["busy-signal", "Busy Signal", "Bronze", "Volume", { t: 5, g: (s) => s.max_tasks_day }, "Complete 5 tasks in one day"],
  ["double-digits", "Double Digits", "Silver", "Volume", { t: 10, g: (s) => s.max_tasks_day }, "Complete 10 tasks in one day"],
  ["machine-mode", "Machine Mode", "Gold", "Volume", { t: 20, g: (s) => s.max_tasks_day }, "Complete 20 tasks in one day"],
  ["big-week", "Big Week", "Silver", "Volume", { t: 40, g: (s) => s.max_tasks_week }, "Complete 40 tasks in one calendar week"],
  ["big-month", "Big Month", "Gold", "Volume", { t: 150, g: (s) => s.max_tasks_month }, "Complete 150 tasks in one calendar month"],
  ["punching-up", "Punching Up", "Bronze", "Difficulty", { t: 1, g: (s) => (s.by_difficulty[4] || 0) }, "Complete your first D4 (Hard) task"],
  ["epic-slayer", "Epic Slayer", "Silver", "Difficulty", { t: 1, g: (s) => (s.by_difficulty[5] || 0) }, "Complete your first D5 (Epic) task"],
  ["heavy-lifter", "Heavy Lifter", "Silver", "Difficulty", { t: 25, g: (s) => s.hard_plus_done }, "Complete 25 D4-or-higher tasks"],
  ["load-bearing", "Load Bearing", "Gold", "Difficulty", { t: 100, g: (s) => s.hard_plus_done }, "Complete 100 D4-or-higher tasks"],
  ["ten-epics", "Ten Epics", "Gold", "Difficulty", { t: 10, g: (s) => s.epics_done }, "Complete 10 D5 tasks"],
  ["fifty-epics", "Fifty Epics", "Platinum", "Difficulty", { t: 50, g: (s) => s.epics_done }, "Complete 50 D5 tasks"],
  ["escalation", "Escalation", "Silver", "Difficulty", { f: true, g: (s) => s.all_difficulties_one_day }, "Complete a D1, D2, D3, D4 and D5 task in the same day"],
  ["no-small-days", "No Small Days", "Gold", "Difficulty", null, "Complete only D3-or-higher tasks for a full week"],
  ["straight-to-boss", "Straight to the Boss", "Silver", "Difficulty", null, "Make a D5 task the first thing you finish that day"],
  ["sisyphus-rested", "Sisyphus Rested", "Gold", "Difficulty", null, "Complete a D5 task that had been open more than 30 days"],
  ["overqualified", "Overqualified", "Bronze", "Difficulty", null, "Complete 10 D1 tasks in a single day"],
  ["weight-class", "Weight Class", "Platinum", "Difficulty", { t: 10000, g: (s) => s.xp_from_epics }, "Earn 10,000 lifetime XP from D5 tasks alone"],
  ["ahead-of-curve", "Ahead of the Curve", "Bronze", "Timing", { t: 1, g: (s) => s.done_early }, "Complete a task before its due date"],
  ["early-bird", "Early Bird", "Silver", "Timing", { t: 25, g: (s) => s.done_early }, "Complete 25 tasks early"],
  ["precognition", "Precognition", "Gold", "Timing", { t: 100, g: (s) => s.done_early }, "Complete 100 tasks early"],
  ["same-day-service", "Same Day Service", "Bronze", "Timing", { t: 1, g: (s) => s.done_same_day }, "Complete a task on the day it was created"],
  ["inbox-interceptor", "Inbox Interceptor", "Silver", "Timing", { t: 25, g: (s) => s.done_same_day }, "Complete 25 tasks on their creation day"],
  ["clean-sweep", "Clean Sweep", "Silver", "Timing", { f: true, g: (s) => s.zero_overdue_now }, "Finish every task due today, today"],
  ["perfect-week", "Perfect Week", "Gold", "Timing", { t: 1, g: (s) => s.perfect_weeks }, "Finish every task due that week, on time, for a full week"],
  ["perfect-month", "Perfect Month", "Platinum", "Timing", { t: 1, g: (s) => s.perfect_months }, "A full calendar month with zero tasks going overdue"],
  ["deadline-dancer", "Deadline Dancer", "Bronze", "Timing", null, "Complete a task within an hour of its due date"],
  ["buzzer-beater", "Buzzer Beater", "Silver", "Timing", null, "Complete a D4+ task on its due date after 8pm"],
  ["nothing-overdue", "Nothing Overdue", "Silver", "Timing", { f: true, g: (s) => s.zero_overdue_now }, "Reach a state of zero overdue tasks"],
  ["nothing-overdue-2", "Nothing Overdue II", "Gold", "Timing", { t: 14, g: (s) => s.zero_overdue_streak }, "Hold zero overdue tasks for 14 consecutive days"],
  ["nothing-overdue-3", "Nothing Overdue III", "Platinum", "Timing", { t: 60, g: (s) => s.zero_overdue_streak }, "Hold zero overdue tasks for 60 consecutive days"],
  ["fast-follow", "Fast Follow", "Bronze", "Timing", null, "Complete a task created from a meeting within 24 hours of that meeting"],
  ["day-two", "Day Two", "Bronze", "Streaks", { t: 2, g: (s) => s.longest_streak }, "A 2-day streak"],
  ["working-week", "Working Week", "Bronze", "Streaks", { t: 7, g: (s) => s.longest_streak }, "A 7-day streak"],
  ["fortnight", "Fortnight", "Silver", "Streaks", { t: 14, g: (s) => s.longest_streak }, "A 14-day streak"],
  ["full-moon", "Full Moon", "Silver", "Streaks", { t: 30, g: (s) => s.longest_streak }, "A 30-day streak"],
  ["quarter-note", "Quarter Note", "Gold", "Streaks", { t: 90, g: (s) => s.longest_streak }, "A 90-day streak"],
  ["half-year", "Half Year", "Gold", "Streaks", { t: 180, g: (s) => s.longest_streak }, "A 180-day streak"],
  ["annual", "Annual", "Platinum", "Streaks", { t: 365, g: (s) => s.longest_streak }, "A 365-day streak"],
  ["unbroken", "Unbroken", "Mythic", "Streaks", { t: 730, g: (s) => s.longest_streak }, "A 730-day streak"],
  ["maxed-multiplier", "Maxed Multiplier", "Silver", "Streaks", { t: 15, g: (s) => s.longest_streak }, "Reach the +30% streak bonus cap"],
  ["weekend-warrior", "Weekend Warrior", "Bronze", "Streaks", { t: 1, g: (s) => s.weekend_pairs }, "Earn XP on a Saturday and a Sunday in the same weekend"],
  ["four-weekends", "Four Weekends", "Silver", "Streaks", { t: 4, g: (s) => s.weekend_pairs }, "Earn XP on four consecutive weekends"],
  ["freeze-frame", "Freeze Frame", "Bronze", "Streaks", { t: 1, g: (s) => s.streak_freezes_used }, "Have a streak freeze spent on your behalf"],
  ["didnt-need-it", "Didn't Need It", "Silver", "Streaks", null, "Go a full month without spending a streak freeze"],
  ["back-on-horse", "Back on the Horse", "Bronze", "Streaks", null, "Start a new streak the day after breaking one"],
  ["longer-this-time", "Longer This Time", "Silver", "Streaks", { f: true, g: (s) => s.beat_longest_streak }, "Beat your previous longest streak"],
  ["comeback-season", "Comeback Season", "Gold", "Streaks", null, "Return to a 30-day streak after a break of 7+ days"],
  ["debt-collector", "Debt Collector", "Bronze", "Recovery", { t: 1, g: (s) => s.overdue_cleared }, "Clear an overdue task"],
  ["dig-out", "Dig Out", "Silver", "Recovery", { t: 5, g: (s) => s.max_overdue_cleared_day }, "Clear 5 overdue tasks in one day"],
  ["excavation", "Excavation", "Gold", "Recovery", { t: 15, g: (s) => s.max_overdue_cleared_day }, "Clear 15 overdue tasks in one day"],
  ["zero-balance", "Zero Balance", "Silver", "Recovery", null, "Go from 10+ overdue tasks to zero"],
  ["necromancer", "Necromancer", "Silver", "Recovery", { t: 1, g: (s) => s.revived_30d }, "Complete a task that had been overdue more than 30 days"],
  ["archaeologist", "Archaeologist", "Gold", "Recovery", { t: 1, g: (s) => s.revived_90d }, "Complete a task that had been overdue more than 90 days"],
  ["unblocked", "Unblocked", "Bronze", "Recovery", { t: 1, g: (s) => s.unblocked_completed }, "Move a task out of Blocked and complete it the same day"],
  ["unblocker", "Unblocker", "Silver", "Recovery", { t: 10, g: (s) => s.unblocked_completed }, "Unblock and complete 10 tasks"],
  ["cut-the-rope", "Cut the Rope", "Silver", "Recovery", null, "Close out a task blocked for more than 21 days"],
  ["net-positive", "Net Positive", "Silver", "Recovery", null, "End a week with more XP earned than lost, after a week where you didn't"],
  ["damage-control", "Damage Control", "Gold", "Recovery", null, "Recover a full level's worth of XP after decay dropped you below the threshold"],
  ["still-here", "Still Here", "Gold", "Recovery", null, "Earn XP in a month following a month with fewer than 5 active days"],
  ["first-card", "First Card", "Bronze", "Study \u2014 flashcards", { t: 1, g: (s) => s.cards_reviewed }, "Review your first flashcard"],
  ["hundred-cards", "Hundred Cards", "Bronze", "Study \u2014 flashcards", { t: 100, g: (s) => s.cards_reviewed }, "Review 100 cards"],
  ["five-hundred-cards", "Five Hundred Cards", "Silver", "Study \u2014 flashcards", { t: 500, g: (s) => s.cards_reviewed }, "Review 500 cards"],
  ["thousand-cards", "Thousand Cards", "Silver", "Study \u2014 flashcards", { t: 1000, g: (s) => s.cards_reviewed }, "Review 1,000 cards"],
  ["five-thousand-cards", "Five Thousand Cards", "Gold", "Study \u2014 flashcards", { t: 5000, g: (s) => s.cards_reviewed }, "Review 5,000 cards"],
  ["twenty-thousand-cards", "Twenty Thousand Cards", "Platinum", "Study \u2014 flashcards", { t: 20000, g: (s) => s.cards_reviewed }, "Review 20,000 cards"],
  ["daily-driver", "Daily Driver", "Bronze", "Study \u2014 flashcards", { t: 1, g: (s) => s.scheduled_clear_streak }, "Clear your scheduled reviews for the day"],
  ["seven-clean-days", "Seven Clean Days", "Silver", "Study \u2014 flashcards", { t: 7, g: (s) => s.scheduled_clear_streak }, "Clear scheduled reviews 7 days running"],
  ["thirty-clean-days", "Thirty Clean Days", "Gold", "Study \u2014 flashcards", { t: 30, g: (s) => s.scheduled_clear_streak }, "Clear scheduled reviews 30 days running"],
  ["deck-cleared", "Deck Cleared", "Bronze", "Study \u2014 flashcards", { t: 1, g: (s) => s.decks_cleared }, "Take a deck to zero due cards"],
  ["deck-master", "Deck Master", "Silver", "Study \u2014 flashcards", null, "Hold a 90%+ retention rate on a deck of 100+ cards"],
  ["honest-work", "Honest Work", "Bronze", "Study \u2014 flashcards", { t: 1, g: (s) => s.graded_again }, "Grade a card Again \u2014 the system pays you for it"],
  ["hard-mode", "Hard Mode", "Silver", "Study \u2014 flashcards", null, "Review 100 cards graded Hard without abandoning the session"],
  ["mature-collection", "Mature Collection", "Gold", "Study \u2014 flashcards", { t: 500, g: (s) => s.mature_cards }, "Have 500 cards reach a review interval over 30 days"],
  ["card-author", "Card Author", "Bronze", "Study \u2014 flashcards", { t: 1, g: (s) => s.cards_created }, "Create your first flashcard"],
  ["deck-builder", "Deck Builder", "Silver", "Study \u2014 flashcards", { t: 100, g: (s) => s.cards_created }, "Create a deck of 100+ cards"],
  ["curriculum", "Curriculum", "Gold", "Study \u2014 flashcards", { t: 500, g: (s) => s.cards_created }, "Create 500 cards across 5+ decks"],
  ["leech-hunter", "Leech Hunter", "Silver", "Study \u2014 flashcards", null, "Rewrite a card that failed 8+ times, then get it right 3 times running"],
  ["pop-quiz", "Pop Quiz", "Bronze", "Study \u2014 exams", { t: 1, g: (s) => s.quizzes_taken }, "Complete your first quiz"],
  ["test-taker", "Test Taker", "Bronze", "Study \u2014 exams", { t: 1, g: (s) => s.tests_taken }, "Complete your first 15+ question test"],
  ["full-length", "Full Length", "Silver", "Study \u2014 exams", { t: 1, g: (s) => s.full_exams_taken }, "Complete your first 40+ question practice exam"],
  ["passing-grade", "Passing Grade", "Bronze", "Study \u2014 exams", { t: 65, g: (s) => s.best_exam_pct }, "Score 65%+ on any exam"],
  ["comfortable-pass", "Comfortable Pass", "Silver", "Study \u2014 exams", { t: 80, g: (s) => s.best_full_exam_pct }, "Score 80%+ on a practice exam"],
  ["exam-ready", "Exam Ready", "Gold", "Study \u2014 exams", { t: 90, g: (s) => s.best_full_exam_pct }, "Score 90%+ on a 40+ question practice exam"],
  ["perfect-paper", "Perfect Paper", "Gold", "Study \u2014 exams", { t: 1, g: (s) => s.perfect_tests }, "Score 100% on a 15+ question test"],
  ["ten-exams", "Ten Exams", "Silver", "Study \u2014 exams", { t: 10, g: (s) => s.full_exams_taken }, "Complete 10 practice exams"],
  ["fifty-exams", "Fifty Exams", "Gold", "Study \u2014 exams", { t: 50, g: (s) => s.full_exams_taken }, "Complete 50 practice exams"],
  ["trending-up", "Trending Up", "Silver", "Study \u2014 exams", { t: 3, g: (s) => s.exam_improve_streak }, "Beat your previous score on the same exam three times running"],
  ["from-50-to-90", "From 50 to 90", "Gold", "Study \u2014 exams", null, "Take one exam from below 60% to above 90%"],
  ["no-timer-needed", "No Timer Needed", "Silver", "Study \u2014 exams", null, "Finish a practice exam in under half the allotted time and still pass"],
  ["read-the-question", "Read the Question", "Bronze", "Study \u2014 exams", null, "Complete an exam with zero auto-submitted answers"],
  ["marathon", "Marathon", "Silver", "Study \u2014 exams", null, "Complete a 60+ question exam in one sitting"],
  ["enrolled", "Enrolled", "Bronze", "Study \u2014 certifications", { t: 1, g: (s) => s.study_plans }, "Create a study plan with an exam date"],
  ["on-track", "On Track", "Silver", "Study \u2014 certifications", null, "Hit your daily study target 7 days running"],
  ["ahead-of-schedule", "Ahead of Schedule", "Gold", "Study \u2014 certifications", null, "Hit your study plan targets for 30 days running"],
  ["certified", "Certified", "Gold", "Study \u2014 certifications", { t: 1, g: (s) => s.certs_passed }, "Pass a certification (+2,500 XP)"],
  ["double-certified", "Double Certified", "Gold", "Study \u2014 certifications", { t: 2, g: (s) => s.certs_passed }, "Hold 2 active certifications"],
  ["triple-threat", "Triple Threat", "Platinum", "Study \u2014 certifications", { t: 3, g: (s) => s.certs_passed }, "Hold 3 active certifications"],
  ["five-badges", "Five Badges", "Platinum", "Study \u2014 certifications", { t: 5, g: (s) => s.certs_passed }, "Hold 5 active certifications"],
  ["architect-track", "Architect Track", "Mythic", "Study \u2014 certifications", null, "Pass a Salesforce Architect-level certification"],
  ["maintained", "Maintained", "Silver", "Study \u2014 certifications", null, "Complete a certification maintenance module"],
  ["no-lapses", "No Lapses", "Gold", "Study \u2014 certifications", null, "Keep every certification current for a full year"],
  ["first-try", "First Try", "Gold", "Study \u2014 certifications", { t: 1, g: (s) => s.certs_first_try }, "Pass a certification on the first attempt"],
  ["second-times-charm", "Second Time's the Charm", "Silver", "Study \u2014 certifications", null, "Pass a certification after a failed attempt"],
  ["recorded", "Recorded", "Bronze", "Meetings", { t: 1, g: (s) => s.meetings_imported }, "Import your first Granola meeting note"],
  ["fifty-meetings", "Fifty Meetings", "Silver", "Meetings", { t: 50, g: (s) => s.meetings_imported }, "Import 50 meeting notes"],
  ["two-hundred-meetings", "Two Hundred Meetings", "Gold", "Meetings", { t: 200, g: (s) => s.meetings_imported }, "Import 200 meeting notes"],
  ["prepared", "Prepared", "Bronze", "Meetings", { t: 1, g: (s) => s.meetings_with_agenda }, "Have an agenda on a meeting note before the meeting starts"],
  ["always-prepared", "Always Prepared", "Silver", "Meetings", { t: 25, g: (s) => s.meetings_with_agenda }, "Agenda-before-start on 25 meetings"],
  ["action-extractor", "Action Extractor", "Bronze", "Meetings", { t: 5, g: (s) => s.max_tasks_one_meeting }, "Have 5 tasks created from a single meeting"],
  ["ten-out-of-one", "Ten Out of One", "Silver", "Meetings", { t: 10, g: (s) => s.max_tasks_one_meeting }, "Have 10 tasks created from a single meeting"],
  ["meeting-to-done", "Meeting to Done", "Bronze", "Meetings", { t: 1, g: (s) => s.meetings_fully_closed }, "Complete every task from a single meeting"],
  ["clean-slate", "Clean Slate", "Silver", "Meetings", { t: 10, g: (s) => s.meetings_fully_closed }, "Complete every task from 10 consecutive meetings"],
  ["standup-regular", "Standup Regular", "Silver", "Meetings", null, "Attend 30 standups in a recurring series"],
  ["note-taker", "Note Taker", "Silver", "Meetings", null, "Add discussion notes to 50 meeting records"],
  ["follow-through", "Follow Through", "Gold", "Meetings", null, "Complete every task from every meeting in a full week"],
  ["quiet-week", "Quiet Week", "Bronze", "Meetings", null, "A week with fewer than 5 meetings"],
  ["meeting-marathon", "Meeting Marathon", "Bronze", "Meetings", { t: 6, g: (s) => s.max_meetings_day }, "6 or more meetings in one day"],
  ["intentional", "Intentional", "Bronze", "Rituals", { t: 1, g: (s) => s.intention_days }, "Fill in What Matters Today for the first time"],
  ["morning-person", "Morning Person", "Bronze", "Rituals", { t: 1, g: (s) => s.intentions_before_8 }, "Fill it in before 8:00"],
  ["seven-intentions", "Seven Intentions", "Bronze", "Rituals", { t: 7, g: (s) => s.intention_streak }, "Fill it in 7 days running"],
  ["thirty-intentions", "Thirty Intentions", "Silver", "Rituals", { t: 30, g: (s) => s.intention_streak }, "Fill it in 30 days running"],
  ["hundred-intentions", "Hundred Intentions", "Gold", "Rituals", { t: 100, g: (s) => s.intention_streak }, "Fill it in 100 days running"],
  ["logged", "Logged", "Bronze", "Rituals", { t: 1, g: (s) => s.worklog_entries }, "Write your first work log entry"],
  ["hundred-entries", "Hundred Entries", "Silver", "Rituals", { t: 100, g: (s) => s.worklog_entries }, "Write 100 work log entries"],
  ["thousand-entries", "Thousand Entries", "Gold", "Rituals", { t: 1000, g: (s) => s.worklog_entries }, "Write 1,000 work log entries"],
  ["full-log", "Full Log", "Bronze", "Rituals", { t: 1, g: (s) => s.full_log_days }, "Four work log entries in one day"],
  ["closed-loop", "Closed Loop", "Bronze", "Rituals", { t: 1, g: (s) => s.eod_completes }, "Complete an End of Day review"],
  ["thirty-closes", "Thirty Closes", "Silver", "Rituals", { t: 30, g: (s) => s.eod_completes }, "Complete End of Day 30 times"],
  ["hundred-closes", "Hundred Closes", "Gold", "Rituals", { t: 100, g: (s) => s.eod_completes }, "Complete End of Day 100 times"],
  ["full-house", "Full House", "Silver", "Rituals", { t: 1, g: (s) => s.full_house_days }, "In one day: intentions, four log entries, and End of Day"],
  ["perfect-ritual-week", "Perfect Ritual Week", "Gold", "Rituals", { t: 5, g: (s) => s.full_house_streak }, "Full House five working days running"],
  ["reviewer", "Reviewer", "Bronze", "Reviews", { t: 1, g: (s) => s.weekly_reviews }, "Complete your first weekly review"],
  ["four-weeks", "Four Weeks", "Silver", "Reviews", { t: 4, g: (s) => s.weekly_review_streak }, "Complete 4 weekly reviews running"],
  ["twelve-weeks", "Twelve Weeks", "Gold", "Reviews", { t: 12, g: (s) => s.weekly_review_streak }, "Complete 12 weekly reviews running"],
  ["fifty-two", "Fifty Two", "Platinum", "Reviews", { t: 52, g: (s) => s.weekly_reviews }, "Complete 52 weekly reviews"],
  ["monthly-check", "Monthly Check", "Bronze", "Reviews", { t: 1, g: (s) => s.monthly_reviews }, "Complete your first monthly review"],
  ["quarter-reviewed", "Quarter Reviewed", "Silver", "Reviews", { t: 3, g: (s) => s.monthly_review_streak }, "Complete 3 monthly reviews running"],
  ["year-reviewed", "Year Reviewed", "Gold", "Reviews", { t: 12, g: (s) => s.monthly_reviews }, "Complete 12 monthly reviews"],
  ["carry-forward", "Carry Forward", "Bronze", "Reviews", null, "Move a stalled task forward in a weekly review"],
  ["honest-accounting", "Honest Accounting", "Silver", "Reviews", null, "Record a blocker in a weekly review, then clear it the next week"],
  ["nothing-stalled", "Nothing Stalled", "Gold", "Reviews", null, "A weekly review with zero stalled items"],
  ["first-boss", "First Boss", "Bronze", "Projects", { t: 1, g: (s) => s.projects_completed }, "Complete every task in a project"],
  ["boss-rush", "Boss Rush", "Silver", "Projects", { t: 5, g: (s) => s.projects_completed }, "Complete 5 projects"],
  ["campaign", "Campaign", "Gold", "Projects", { t: 20, g: (s) => s.projects_completed }, "Complete 20 projects"],
  ["overkill", "Overkill", "Bronze", "Projects", null, "Deal more than 500 damage to one boss in a single day"],
  ["final-blow", "Final Blow", "Bronze", "Projects", { t: 1, g: (s) => s.projects_completed }, "Land the last task of a project"],
  ["solo-run", "Solo Run", "Silver", "Projects", { t: 15, g: (s) => s.max_project_tasks }, "Complete a project of 15+ tasks"],
  ["raid-boss", "Raid Boss", "Gold", "Projects", { t: 40, g: (s) => s.max_project_tasks }, "Complete a project of 40+ tasks"],
  ["no-retreat", "No Retreat", "Gold", "Projects", null, "Complete a project with zero tasks going overdue"],
  ["long-campaign", "Long Campaign", "Silver", "Projects", null, "Complete a project that ran more than 90 days"],
  ["two-fronts", "Two Fronts", "Silver", "Projects", null, "Advance three different projects in the same day"],
  ["cleared-the-board", "Cleared the Board", "Gold", "Projects", null, "Have zero active projects with overdue tasks"],
  ["scope-cut", "Scope Cut", "Bronze", "Projects", null, "Close a project by deliberately cancelling its remaining tasks"],
  ["deployed", "Deployed", "Bronze", "Salesforce", { t: 1, g: (s) => s.deploy_tasks }, "Complete your first deployment task"],
  ["ten-deploys", "Ten Deploys", "Silver", "Salesforce", { t: 10, g: (s) => s.deploy_tasks }, "Complete 10 deployment tasks"],
  ["fifty-deploys", "Fifty Deploys", "Gold", "Salesforce", { t: 50, g: (s) => s.deploy_tasks }, "Complete 50 deployment tasks"],
  ["sandbox-refreshed", "Sandbox Refreshed", "Silver", "Salesforce", { t: 1, g: (s) => s.sandbox_tasks }, "Complete a sandbox refresh task"],
  ["full-refresh-cycle", "Full Refresh Cycle", "Gold", "Salesforce", null, "Complete a refresh across every sandbox in one cycle"],
  ["permission-surgeon", "Permission Surgeon", "Silver", "Salesforce", { t: 10, g: (s) => s.permission_tasks }, "Complete 10 permission-set tasks"],
  ["least-privilege", "Least Privilege", "Gold", "Salesforce", null, "Complete a permission-model review end to end"],
  ["integration-wrangler", "Integration Wrangler", "Silver", "Salesforce", { t: 10, g: (s) => s.integration_tasks }, "Complete 10 integration tasks"],
  ["data-mover", "Data Mover", "Silver", "Salesforce", { t: 10, g: (s) => s.data_tasks }, "Complete 10 data load or remediation tasks"],
  ["bug-squasher", "Bug Squasher", "Bronze", "Salesforce", { t: 10, g: (s) => s.bug_tasks }, "Complete 10 tasks tagged as bugs"],
  ["exterminator", "Exterminator", "Gold", "Salesforce", { t: 100, g: (s) => s.bug_tasks }, "Complete 100 bug tasks"],
  ["sprint-closer", "Sprint Closer", "Silver", "Salesforce", null, "Complete every REQ ticket in a sprint"],
  ["ticket-to-ride", "Ticket to Ride", "Silver", "Salesforce", { t: 50, g: (s) => s.req_tasks }, "Complete 50 tasks carrying a REQ number"],
  ["production-careful", "Production Careful", "Gold", "Salesforce", null, "Complete 25 production-touching tasks with none reopened"],
  ["release-manager", "Release Manager", "Gold", "Salesforce", null, "Complete a full release cycle: build, test, deploy, verify"],
  ["org-whisperer", "Org Whisperer", "Platinum", "Salesforce", { t: 500, g: (s) => s.salesforce_tasks }, "Complete 500 Salesforce-tagged tasks"],
  ["first-note", "First Note", "Bronze", "Vault", { t: 1, g: (s) => s.note_count }, "Create your first knowledge note"],
  ["hundred-notes", "Hundred Notes", "Silver", "Vault", { t: 100, g: (s) => s.note_count }, "Reach 100 notes in the vault"],
  ["five-hundred-notes", "Five Hundred Notes", "Silver", "Vault", { t: 500, g: (s) => s.note_count }, "Reach 500 notes"],
  ["thousand-notes", "Thousand Notes", "Gold", "Vault", { t: 1000, g: (s) => s.note_count }, "Reach 1,000 notes"],
  ["connected", "Connected", "Bronze", "Vault", null, "Add 10 wikilinks in a day"],
  ["web-weaver", "Web Weaver", "Silver", "Vault", null, "Have a note with 20+ inbound links"],
  ["decided", "Decided", "Bronze", "Vault", null, "Record your first decision note"],
  ["ten-decisions", "Ten Decisions", "Silver", "Vault", null, "Record 10 decision notes"],
  ["inbox-zero", "Inbox Zero", "Bronze", "Vault", null, "Empty the capture inbox"],
  ["inbox-zero-streak", "Inbox Zero Streak", "Silver", "Vault", null, "Empty the capture inbox 7 days running"],
  ["gardener", "Gardener", "Silver", "Vault", null, "Update 20 existing notes in a week without creating a new one"],
  ["no-orphans", "No Orphans", "Gold", "Vault", null, "Zero notes with no inbound or outbound links"],
  ["templated", "Templated", "Bronze", "Vault", null, "Create a new note template"],
  ["automated", "Automated", "Silver", "Vault", null, "Add a new scheduled automation job to the vault"],
  ["dawn-patrol", "Dawn Patrol", "Bronze", "Time of day", { t: 1, g: (s) => s.before_6 }, "Complete a task before 6:00"],
  ["before-the-coffee", "Before the Coffee", "Silver", "Time of day", { t: 25, g: (s) => s.before_8 }, "Complete 25 tasks before 8:00"],
  ["night-owl", "Night Owl", "Bronze", "Time of day", { t: 1, g: (s) => s.after_23 }, "Complete a task after 23:00"],
  ["midnight-oil", "Burning the Midnight Oil", "Silver", "Time of day", { t: 25, g: (s) => s.after_23 }, "Complete 25 tasks after 23:00"],
  ["lunch-break", "Lunch Break", "Bronze", "Time of day", null, "Complete a task between 12:00 and 13:00"],
  ["bookends", "Bookends", "Bronze", "Time of day", { t: 1, g: (s) => s.bookend_days }, "Complete a task before 8:00 and after 20:00 on the same day"],
  ["weekend-shift", "Weekend Shift", "Bronze", "Time of day", { t: 5, g: (s) => s.saturday_tasks_max }, "Complete 5 tasks on a Saturday"],
  ["monday-momentum", "Monday Momentum", "Silver", "Time of day", { t: 10, g: (s) => s.monday_tasks_max }, "Complete 10 tasks on a Monday"],
  ["friday-finisher", "Friday Finisher", "Silver", "Time of day", null, "End 10 consecutive Fridays with zero overdue tasks"],
  ["leap-day", "Leap Day", "Bronze", "Time of day", null, "Earn XP on 29 February"],
  ["new-year-new-task", "New Year, New Task", "Bronze", "Time of day", null, "Complete a task on 1 January"],
  ["birthday-work", "Birthday Work", "Bronze", "Time of day", null, "Earn XP on your birthday"],
  ["holiday-hours", "Holiday Hours", "Bronze", "Time of day", null, "Complete a task on a public holiday"],
  ["quarter-close", "Quarter Close", "Silver", "Time of day", null, "Complete 20 tasks in the last week of a quarter"],
  ["triaged", "Triaged", "Bronze", "Triage", { t: 1, g: (s) => s.manual_difficulty }, "Give a task a difficulty by hand"],
  ["calibrator", "Calibrator", "Silver", "Triage", { t: 25, g: (s) => s.manual_difficulty }, "Hand-set difficulty on 25 tasks"],
  ["trust-the-rules", "Trust the Rules", "Silver", "Triage", null, "Go 30 days without overriding a computed difficulty"],
  ["sorted", "Sorted", "Bronze", "Triage", { t: 1, g: (s) => s.fully_triaged_days }, "Take the Task Inbox to fully triaged"],
  ["sorted-streak", "Sorted Streak", "Silver", "Triage", { t: 7, g: (s) => s.fully_triaged_streak }, "Fully triaged 7 days running"],
  ["pruner", "Pruner", "Bronze", "Triage", null, "Cancel a task you are never going to do"],
  ["ruthless", "Ruthless", "Silver", "Triage", null, "Cancel 25 tasks in one triage pass"],
  ["right-sized", "Right-Sized", "Silver", "Triage", null, "Split a D5 task into three smaller tasks"],
  ["dated", "Dated", "Bronze", "Triage", null, "Give a due date to 20 undated tasks"],
  ["provenance", "Provenance", "Silver", "Triage", null, "Have 100 consecutive tasks arrive with a source link intact"],
  ["handed-off", "Handed Off", "Bronze", "People", null, "Complete a task that unblocks someone else"],
  ["good-teammate", "Good Teammate", "Silver", "People", null, "Complete 25 tasks naming another person"],
  ["fast-reply", "Fast Reply", "Bronze", "People", null, "Complete an email-derived task within 4 hours"],
  ["nobody-waiting", "Nobody Waiting", "Silver", "People", null, "Zero open tasks that name another person as blocked"],
  ["follow-up", "Follow Up", "Bronze", "People", null, "Complete a task that was itself a follow-up"],
  ["chased-it-down", "Chased It Down", "Silver", "People", null, "Complete a follow-up task that had been reopened twice"],
  ["sign-off", "Sign Off", "Silver", "People", null, "Get sign-off on a document you sent for review"],
  ["onboarder", "Onboarder", "Silver", "People", null, "Complete 10 access or provisioning tasks for other people"],
  ["escalated-well", "Escalated Well", "Silver", "People", null, "Move a task to Blocked with a named owner and clear it within a week"],
  ["room-of-ones-own", "Room of One's Own", "Bronze", "People", null, "A full day with zero meetings and 5+ tasks completed"],
  ["tomorrows-problem", "Tomorrow's Problem", "Bronze", "Meta", { t: 3, g: (s) => s.reschedule_max }, "Reschedule the same task three times"],
  ["tomorrows-problem-2", "Tomorrow's Problem II", "Silver", "Meta", { t: 10, g: (s) => s.reschedule_max }, "Reschedule the same task ten times \u2014 and then do it"],
  ["optimist", "Optimist", "Bronze", "Meta", null, "Set 10 tasks due on the same day"],
  ["realist", "Realist", "Silver", "Meta", null, "Complete every task on a day where you set 10"],
  ["yak-shaver", "Yak Shaver", "Bronze", "Meta", null, "Create a task while completing another task"],
  ["scope-creep", "Scope Creep", "Bronze", "Meta", null, "Watch a D2 task get re-rated to D4"],
  ["honest-difficulty", "Honest Difficulty", "Silver", "Meta", null, "Re-rate a task harder rather than easier"],
  ["read-the-manual", "Read the Manual", "Bronze", "Meta", null, "Open the Gamification Design note"],
  ["achievement-hunter", "Achievement Hunter", "Silver", "Meta", { t: 50, g: (s) => s.achievements_unlocked }, "Unlock 50 achievements"],
  ["completionist", "Completionist", "Gold", "Meta", { t: 150, g: (s) => s.achievements_unlocked }, "Unlock 150 achievements"],
  ["full-dex", "Full Dex", "Mythic", "Meta", null, "Unlock every non-hidden achievement"],
  ["touch-grass", "Touch Grass", "Bronze", "Meta", { t: 1, g: (s) => s.vacation_weeks }, "Take a full week of vacation mode"],
  ["ghost-in-machine", "Ghost in the Machine", "Hidden", "Hidden", null, "Complete a task the automation created and you never read"],
  ["exactly-42", "Exactly 42", "Hidden", "Hidden", null, "End a day on exactly 42 XP"],
  ["nice", "Nice", "Hidden", "Hidden", null, "End a day on exactly 69 XP"],
  ["round-numbers", "Round Numbers", "Hidden", "Hidden", null, "Cross a level threshold on exactly the required XP"],
  ["zero-day", "Zero Day", "Hidden", "Hidden", null, "Earn zero XP and lose zero XP on an active day"],
  ["palindrome", "Palindrome", "Hidden", "Hidden", null, "Finish a task on a palindromic date"],
  ["speedrun", "Speedrun", "Hidden", "Hidden", null, "Gain a full level in a single day"],
  ["any-percent", "Any%", "Hidden", "Hidden", null, "Gain two full levels in a single day"],
  ["the-long-game", "The Long Game", "Hidden", "Hidden", null, "Complete a task created more than a year earlier"],
  ["phoenix", "Phoenix", "Hidden", "Hidden", null, "Return to a 30-day streak after a break of 90+ days"],
  ["calibrated", "Calibrated", "Silver", "Exam readiness", null, "Sit an exam the model predicted within 5 points of your actual score"],
  ["green-light", "Green Light", "Silver", "Exam readiness", { t: 90, g: (s) => s.max_readiness }, "Reach 90 readiness on any certification"],
  ["no-weak-domain", "No Weak Domain", "Silver", "Exam readiness", { f: true, g: (s) => s.no_weak_domain }, "Every blueprint domain above 50% mastery at once"],
  ["full-blueprint", "Full Blueprint", "Gold", "Exam readiness", { f: true, g: (s) => s.full_blueprint_coverage }, "100% coverage across every domain of a certification"],
  ["trusted-the-model", "Trusted the Model", "Gold", "Exam readiness", null, "Book the exam within 7 days of hitting 90 readiness, and pass"],
  ["stability", "Stability", "Silver", "Exam readiness", null, "Three consecutive practice exams within 4 points of each other, all above pass+5"],
  ["no-retakes", "No Retakes", "Gold", "Exam readiness", { f: true, g: (s) => s.readiness_no_retakes }, "Reach 90 readiness without re-sitting a single question bank"],
  ["sat-it-anyway", "Sat It Anyway", "Silver", "Exam readiness", null, "Sit an exam below 80 readiness \u2014 and pass"],
  ["back-in", "Back In", "Silver", "Exam readiness", null, "Return to a certification after 30+ days away and recover your readiness"],
];
/* --- END GENERATED CATALOG --- */

/* Newly earned achievements as [slug, name, tier, xp]. */
function evaluateAchievements(stats, already) {
  const earned = [];
  for (const [slug, name, tier, , pred] of CATALOG) {
    if (already.has(slug) || !pred) continue;
    try {
      const v = specValue(pred, stats);
      if (pred.f ? Boolean(v) : v >= pred.t) earned.push([slug, name, tier, TIER_XP[tier]]);
    } catch (e) { /* a predicate that throws is simply not earned */ }
  }
  return earned;
}

function specValue(pred, stats) {
  const raw = pred.g(stats);
  if (pred.f) return raw;
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
}

/* The whole catalog with progress, for the UI to render. `conditions` maps a
 * slug to the human-readable wording from the Achievements note, so the popup
 * and the browser explain an achievement without the text living in two
 * places. */
function achievementSnapshot(stats, unlocked, conditions) {
  return CATALOG.map(([slug, name, tier, category, pred, condition]) => {
    const row = {
      slug, name, tier, category, xp: TIER_XP[tier], manual: !pred,
      /* The note wins -- the wording is meant to be editable -- but the
       * catalog carries a copy so a vault whose note has not been read yet
       * still explains every achievement. */
      condition: (conditions || {})[slug] || condition || "",
      unlocked: (unlocked || {})[slug] === undefined ? null : unlocked[slug],
    };
    if (pred) {
      try {
        let have, need;
        if (pred.f) { have = specValue(pred, stats) ? 1.0 : 0.0; need = 1.0; }
        else { have = Math.min(specValue(pred, stats), pred.t); need = pred.t; }
        row.have = roundTo(have, 2);
        row.need = roundTo(need, 2);
        row.progress = need ? roundTo(Math.min(1.0, have / need), 4) : 0.0;
      } catch (e) {
        row.have = 0; row.need = 1; row.progress = 0.0;
      }
    } else {
      /* A manual award still reports a bar, so the browser can lay every tile
       * out the same way: all or nothing, driven by whether it was granted. */
      row.have = row.unlocked ? 1 : 0;
      row.need = 1;
      row.progress = row.unlocked ? 1.0 : 0.0;
    }
    if (row.unlocked) row.progress = 1.0;
    return row;
  });
}

function roundTo(x, places) {
  const f = Math.pow(10, places);
  const scaled = x * f;
  const nudged = Math.abs(scaled - Math.round(scaled)) < 1e-9 ? Math.round(scaled) : scaled;
  return pyRound(nudged) / f;
}

/* ------------------------------------------------------------ note bodies */

function renderCharacter(todayIso, level, total, streak) {
  return `---
title: Character
type: dashboard
automation: xp-sync
updated: ${todayIso}
level: ${level}
total_xp: ${total}
streak: ${streak}
cssclasses:
  - life-os
  - max
---

# Character

\`\`\`life-os
view: character
\`\`\`

*Derived from [[4 System/Game/XP Ledger]] on every sync. Safe to delete — it
will be rebuilt. Rules: [[4 System/Game/Gamification Design]].*
`;
}

function renderQuest(todayIso) {
  return `---
title: Quest Log
type: dashboard
automation: xp-sync
updated: ${todayIso}
cssclasses:
  - life-os
  - max
---

# Quest Log

\`\`\`life-os
view: quest
\`\`\`

*Rendered by the Uptick plugin. Level, XP and streak come from
[[4 System/Game/Character]]; the full event history is
[[4 System/Game/XP Ledger]].*
`;
}

const LEDGER_HEADER = `---
title: XP Ledger
type: log
automation: xp-sync
cssclasses:
  - life-os
  - max
---

# XP Ledger

\`\`\`life-os
view: ledger
\`\`\`

*Append-only, newest at the bottom. Every row carries a deterministic id, so
re-running the sync can never double-count and a missed day can always be
caught up. Written by \`4 System/Automation/xp-sync.py\` — do not edit by hand,
since [[4 System/Game/Character]] and [[4 System/Game/Quest Log]] are rebuilt
from this file.*

| Date | XP | Kind | Detail | Event id |
| --- | --- | --- | --- | --- |
`;

function writeLedger(events) {
  return LEDGER_HEADER + events.map(ledgerRow).join("\n") + "\n";
}

/* slug -> condition text, read from the catalog note.
 *
 * The wording lives in the note so there is one place to edit it; the unlock
 * popup and the browser both read it from here rather than restating it in
 * code. Without this the cache carries an empty condition for all 258 and the
 * browser cannot say how anything is earned. */
function achievementConditions(noteText) {
  const byName = {};
  for (const [slug, name] of CATALOG) byName[name] = slug;
  const out = {};
  for (const line of String(noteText || "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.length >= 4 && cells[1].startsWith("**")) {
      const slug = byName[cells[1].replace(/\*/g, "")];
      if (slug) out[slug] = cells[3];
    }
  }
  return out;
}

/* Deck counts for the Home study card, so the dashboard can show what is due
 * without the plugin opening LearnKit's SQLite store itself. */
function studyStats(cards, states, today) {
  /* Python builds these from datetime.combine(today, min/max time), which is
   * local. Mirror that rather than using the UTC-noon `today`. */
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate();
  const startOfDay = new Date(y, m, d, 0, 0, 0, 0).getTime();
  const endOfDay = new Date(y, m, d, 23, 59, 59, 999).getTime();

  let total = 0, due = 0, overdue = 0, fresh = 0, mature = 0;
  const byDeck = {};
  for (const [cid, card] of Object.entries(cards || {})) {
    if (!card || typeof card !== "object") continue;
    total += 1;
    const groups = card.groups || [];
    const deck = groups.length ? String(groups[0]) : "Ungrouped";
    const entry = byDeck[deck] || (byDeck[deck] = { deck, cards: 0, due: 0, new: 0 });
    entry.cards += 1;
    const st = (states || {})[cid] || {};
    const stage = String(st.stage || "new");
    const when = st.due;
    if (stage === "new") { fresh += 1; entry.new += 1; }
    if (Number(st.stabilityDays || 0) > 30) mature += 1;
    if (when !== undefined && when !== null && Number(when) <= endOfDay) {
      due += 1;
      entry.due += 1;
      if (Number(when) < startOfDay && stage !== "new") overdue += 1;
    }
  }
  return {
    total, due, overdue, new: fresh, mature, reviewed: total - fresh,
    decks: Object.values(byDeck).sort((a, b) => b.cards - a.cards),
  };
}

/* Everything the Quest Log view draws, in one structured file.
 *
 * The Quest Log note is deliberately thin -- it renders from this, not from
 * Markdown -- so a sync that does not write this leaves the page blank. */
function questCache(tasks, events, today, bank, character, study, certifications, C) {
  const openTasks = tasks.filter((t) => !t.done);
  const overdue = [];
  for (const t of openTasks) {
    const dueOn = parseDate(t.due);
    if (!dueOn || dueOn >= today || t.blocked) continue;
    const days = daysBetween(dueOn, today);
    const base = C.BASE_XP[t.difficulty];
    const cost = Math.min(base,
      Math.ceil(base * C.DECAY_RATE) * Math.max(0, days - C.DECAY_GRACE_DAYS));
    if (cost <= 0) continue;          // still inside the one day of grace
    overdue.push({ text: short(t.text, 90), difficulty: t.difficulty,
                   due: t.due, days, cost, id: t.id });
  }
  overdue.sort((a, b) => b.cost - a.cost);

  /* Python's weekday() is Monday=0; getUTCDay() is Sunday=0. */
  const weekday = (today.getUTCDay() + 6) % 7;
  const weekStart = isoDate(addDays(today, -weekday));
  const monthStart = `${isoDate(today).slice(0, 7)}-01`;

  const byKind = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + e.xp;

  /* A sparkline of the last 30 days of net XP, so the page shows a shape and
   * not just a number. */
  const trail = [];
  for (let k = 29; k >= 0; k--) {
    const d = isoDate(addDays(today, -k));
    trail.push({ date: d, xp: events.filter((e) => e.date === d).reduce((a, e) => a + e.xp, 0) });
  }

  const sum = (pred) => events.filter(pred).reduce((a, e) => a + e.xp, 0);

  return {
    updated: isoDate(today),
    character,
    bank,
    sources: [["task", "Tasks"], ["study", "Study"], ["ritual", "Rituals"],
              ["milestone", "Milestones"], ["achievement", "Achievements"],
              ["decay", "Overdue decay"]]
      .map(([kind, label]) => ({ kind, label, xp: byKind[kind] || 0 })),
    totals: {
      week: sum((e) => e.date >= weekStart),
      month: sum((e) => e.date >= monthStart),
      all: sum(() => true),
    },
    trail,
    ranks: [...RANKS].sort((a, b) => a[0] - b[0]).map(([floor, name]) => ({ floor, name })),
    study,
    certifications: certifications || [],
    tasks: {
      open: openTasks.length,
      blocked: openTasks.filter((t) => t.blocked).length,
      overdue: overdue.length,
    },
    bleeding: overdue.slice(0, 12),
    recent: events.filter((e) => e.kind === "achievement")
      .slice(-10)
      .map((e) => ({ date: e.date, xp: e.xp, detail: e.detail,
                     slug: e.id.replace("ach:", "") })),
  };
}

/* ------------------------------------------------------------ reward bank */

/* Data rows of the first Markdown table under `heading`. */
function tableRows(text, heading) {
  const esc = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^#{1,6}\\s+${esc}\\s*$`, "im").exec(String(text || ""));
  if (!m) return [];
  const rest = String(text).slice(m.index + m[0].length);
  const stop = /^#{1,6}\s+/m.exec(rest);
  const block = stop ? rest.slice(0, stop.index) : rest;
  const rows = [];
  for (const line of block.split("\n")) {
    const rm = /^\|(.+)\|\s*$/.exec(line.trim());
    if (!rm) continue;
    const cells = rm[1].split("|").map((c) => c.trim());
    const isRule = cells.every((c) => /^[-: ]*$/.test(c));
    if (isRule || !cells.some((c) => c)) continue;
    rows.push(cells);
  }
  return rows.length ? rows.slice(1) : [];      // drop the header row
}

/* Dollars a day, from the last 30 days of actual banking.
 *
 * An ETA off two days of data reads "~7470 days", which is arithmetically true
 * and worse than saying nothing, so this waits for a week of history. */
function bankRate(events, today, C) {
  const cutoff = isoDate(addDays(today, -30));
  const recent = {};
  for (const e of events) {
    if (e.date >= cutoff) recent[e.date] = (recent[e.date] || 0) + e.xp;
  }
  const values = Object.values(recent);
  const activeDays = values.filter((v) => v > 0).length;
  const daily = activeDays >= 7
    ? (values.reduce((a, v) => a + Math.max(0, v), 0) / 30.0) / C.BANK_RATE
    : 0.0;
  return { daily, activeDays };
}

function money(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2,
                                             maximumFractionDigits: 2 });
}

/* Goals and spend history, parsed out of the hand-editable bank note.
 *
 * The tables stay the source of truth -- goals are something you type -- so
 * this reads them rather than owning them. */
function bankDetail(noteText, bank, events, today, C) {
  const out = { ...bank, goals: [], ledger: [], spent: 0.0, available: 0.0,
                rate: C.BANK_RATE, ceiling: C.MONTHLY_CEILING,
                level_bonus: C.LEVEL_BONUS, daily: 0.0, active_days: 0 };
  if (!noteText) return out;

  for (const row of tableRows(noteText, "Ledger")) {
    if (row.length < 3 || !row[0]) continue;
    const m = /(-?)\s*\$?([\d,.]+)/.exec(row[1] || "");
    if (!m) continue;
    const amount = parseFloat(m[2].replace(/,/g, "")) * (m[1] ? -1 : 1);
    out.ledger.push({ date: row[0], change: amount, reason: row[2] });
    if (amount < 0) out.spent += -amount;
  }
  out.available = Math.max(0.0, bank.total - out.spent);

  const { daily, activeDays } = bankRate(events, today, C);
  out.daily = daily;
  out.active_days = activeDays;

  let filled = out.available;
  for (const row of tableRows(noteText, "Goals")) {
    if (row.length < 7 || !row[1] || row[1].startsWith("*")) continue;
    const price = /([\d,.]+)/.exec(row[2] || "");
    if (!price) continue;
    const target = parseFloat(price[1].replace(/,/g, ""));
    if (!(target > 0)) continue;
    const got = Math.min(filled, target);
    filled -= got;
    out.goals.push({
      n: row[0], name: row[1], price: target, banked: roundTo(got, 2),
      progress: roundTo(got / target, 4),
      remaining: roundTo(target - got, 2),
      eta_days: (out.daily > 0.005 && got < target)
        ? Math.ceil((target - got) / out.daily) : null,
      status: got >= target ? "Complete" : (got > 0 || filled <= 0 ? "Active" : "Queued"),
    });
  }
  return out;
}

/* Refresh the Balance block and goal progress; leave everything else alone.
 *
 * Goal rows are rewritten in place line by line. An earlier version rebuilt the
 * row from tableRows, which strips cell padding, so the replacement never
 * matched the padded original and the goals silently never filled. */
function updateBankNote(noteText, bank, events, today, C) {
  if (!noteText) return null;

  let spent = 0.0;
  for (const row of tableRows(noteText, "Ledger")) {
    if (row.length < 2) continue;
    const m = /-\s*\$?([\d,.]+)/.exec(row[1] || "");
    if (m) spent += parseFloat(m[1].replace(/,/g, ""));
  }
  const available = Math.max(0.0, bank.total - spent);

  const balance = "| | |\n|---|---|\n"
    + `| Lifetime earned | $${money(bank.total)} |\n`
    + `| Spent | $${money(spent)} |\n`
    + `| **Available** | **$${money(available)}** |\n`
    + `| This month | $${money(bank.this_month)} of $${money(C.MONTHLY_CEILING)} |`;
  let out = noteText.replace(/(## Balance\n\n)\|[\s\S]*?\n\n/,
                             (_m, head) => `${head}${balance}\n\n`);

  const { daily, activeDays } = bankRate(events, today, C);

  const lines = out.split("\n");
  let inGoals = false, filled = available;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) { inGoals = line.trim() === "## Goals"; continue; }
    if (!inGoals || !line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "")
      .split("|").map((c) => c.trim());
    if (cells.length < 7 || !cells[1] || /^[-: ]*$/.test(cells[0])) continue;
    const price = /([\d,.]+)/.exec(cells[2] || "");
    if (!price) continue;
    const target = parseFloat(price[1].replace(/,/g, ""));
    if (!(target > 0)) continue;
    const got = Math.min(filled, target);
    filled -= got;
    const pct = `${Math.round((got / target) * 100)}%`;
    let status, eta;
    if (got >= target) { status = "Complete"; eta = "now"; }
    else {
      status = (got > 0 || filled <= 0) ? "Active" : "Queued";
      eta = daily > 0.005 ? `~${Math.ceil((target - got) / daily)} days`
          : activeDays < 7 ? `needs ${7 - activeDays}d more data` : "\u2014";
    }
    lines[i] = "| " + [cells[0], cells[1], `$${money(target)}`, `$${money(got)}`,
                       pct, eta, status].join(" | ") + " |";
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------ the sync run */

/* Compute one sync from vault contents already read.
 *
 * Deliberately takes plain data rather than reading anything: the caller owns
 * IO, which is what lets the same function run under Obsidian, under node in a
 * test, and against a fixture with no vault at all.
 *
 * Returns { writes, state, summary } -- the caller decides what to persist.
 */
function runSync(input) {
  const C = applyConfig(input.config || {});
  const today = input.today ? parseDate(input.today) : parseDate(isoDate(new Date()));
  const todayIso = isoDate(today);
  const state = { ...(input.state || {}) };

  /* Start at zero, no retroactive credit. Fixed on the first run and then
   * never moved, so history that predates the system cannot leak in later as
   * a sudden windfall. */
  if (!state.start_date) state.start_date = todayIso;
  const startDate = state.start_date;

  const tasks = readTasks(input.taskInbox || "");
  const facts = dailyFacts(input.dailyNotes || {});
  const weeklies = reviewDates(input.weeklyNotes || {});
  const monthlies = reviewDates(input.monthlyNotes || {});
  const lkEvents = input.learnkitEvents || [];
  const states = input.cardStates || {};

  /* The world as it already stood, captured once. Achievements measure the
   * delta from here, not the absolute count. */
  if (!state.baseline) {
    state.baseline = {
      notes: input.noteCount || 0,
      meetings: Object.keys(input.meetingNotes || {}).length,
      cards: Object.keys(states).length,
    };
  }
  const baseline = state.baseline;

  const existing = readLedger(input.ledger || "");
  const known = new Set(existing.map((e) => e.id));

  /* Streak must be known before task XP, because it is a multiplier. It is
   * computed from the ledger as it stands, so today's completions are scored
   * against the streak brought into the day rather than one they create. */
  const priorDays = [...new Set(existing.filter((e) => e.xp > 0).map((e) => e.date))].sort();
  const streakByDay = {};
  let run = 0, prev = null;
  for (const d of priorDays) {
    const cur = parseDate(d);
    run = prev && daysBetween(prev, cur) === 1 ? run + 1 : 1;
    streakByDay[d] = run - 1;
    prev = cur;
  }

  const earnByDay = {};
  for (const e of existing) if (e.xp > 0) earnByDay[e.date] = (earnByDay[e.date] || 0) + e.xp;

  /* Blocked days accumulate in state; a blocked task's clock is stopped. */
  const blockedDays = { ...(state.blocked_days || {}) };
  const blockedSince = { ...(state.blocked_since || {}) };
  const elapsed = state.last_run ? daysBetween(parseDate(state.last_run), today) : 0;
  for (const t of tasks) {
    if (t.blocked) {
      if (!(t.id in blockedSince)) blockedSince[t.id] = todayIso;
      else if (elapsed > 0) blockedDays[t.id] = (blockedDays[t.id] || 0) + elapsed;
    } else {
      delete blockedSince[t.id];
    }
  }

  let candidates = taskCompletionEvents(tasks, streakByDay, C)
    .concat(ritualEvents(facts, weeklies, monthlies, C))
    .concat(studyEvents(lkEvents, C));
  for (const e of candidates) {
    if (e.xp > 0) earnByDay[e.date] = (earnByDay[e.date] || 0) + e.xp;
  }
  const decayCursor = { ...(state.decay_cursor || {}) };
  candidates = candidates.concat(
    decayEvents(tasks, today, blockedDays, earnByDay, parseDate(startDate), decayCursor, C));

  candidates = candidates.filter((e) => e.date >= startDate);
  let newEvents = candidates.filter((e) => !known.has(e.id));
  const sortKey = (e) => `${e.date}\u0000${e.id}`;
  let ledger = existing.concat(
    [...newEvents].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)));

  /* Achievements are evaluated against the world including the new events, and
   * pay their own XP, so they are resolved in a second pass -- and that pass
   * can itself unlock more, which is why it loops. */
  const unlockedDates = {};
  for (const e of ledger) {
    if (e.kind === "achievement") unlockedDates[e.id.split(":").slice(1).join(":")] = e.date;
  }
  let totalDays = [...new Set(ledger.filter((e) => e.xp > 0).map((e) => e.date))].sort();
  let [streak, longest, freezesUsed] = computeStreak(totalDays, today, C.FREEZES_PER_MONTH);

  const statsInput = () => ({
    tasks, events: ledger, facts, weeklies, monthlies, states, lkEvents,
    today, streak, longest, freezesUsed, readiness: input.readiness || [],
    manual: new Set(Object.keys(unlockedDates)), startDate, baseline,
    meetingNotes: input.meetingNotes || {}, noteCount: input.noteCount || 0,
    readTheDesign: !!input.readTheDesign, C,
  });

  const earned = [];
  let stats = buildStats(statsInput());
  for (let pass = 0; pass < 8; pass++) {
    stats = buildStats(statsInput());
    const round = evaluateAchievements(stats, new Set(Object.keys(unlockedDates)));
    if (!round.length) break;
    earned.push(...round);
    const wave = round.map(([slug, name, tier, xp]) => ({
      date: todayIso, xp, kind: "achievement",
      detail: `${name} (${tier})`, id: `ach:${slug}`,
    }));
    newEvents = newEvents.concat(wave);
    ledger = ledger.concat(wave);
    for (const [slug] of round) unlockedDates[slug] = todayIso;
  }

  const total = ledger.reduce((a, e) => a + e.xp, 0);
  /* Level is deliberately derived from the current total, not a historical
   * high-water mark. Decay can therefore lower a level, but never below 1. */
  const level = levelFor(total);
  const bank = bankSummary(ledger, level, C, todayIso);

  const floor = levelThreshold(level);
  const ceil = levelThreshold(level + 1);
  const hero = {
    level, total, rank: rankFor(level), streak, longest,
    into: total - floor, need: ceil - floor,
    streak_bonus: roundTo(Math.min(C.STREAK_CAP, 1 + C.STREAK_STEP * streak), 2),
    freezes_left: C.FREEZES_PER_MONTH - freezesUsed,
    freezes_total: C.FREEZES_PER_MONTH,
    achievements: Object.keys(unlockedDates).length,
    achievements_auto: CATALOG.filter((r) => r[4]).length,
    today: ledger.filter((e) => e.date === todayIso).reduce((a, e) => a + e.xp, 0),
  };

  const snapshot = achievementSnapshot(stats, unlockedDates, input.conditions || {});

  /* Goals are read out of the bank note, so this has to run before the note is
   * rewritten underneath it. */
  const bankFull = bankDetail(input.bankNote, bank, ledger, today, C);
  const bankNote = updateBankNote(input.bankNote, bank, ledger, today, C);

  /* Exam readiness and the card counts come from LearnKit's SQLite store and
   * the certification notes, neither of which is ported. Writing an empty
   * section for them would not mean "you have none" -- it would mean "this
   * sync could not see them", and it would erase what a previous run knew.
   * Carry the old values forward instead, and only replace them when this run
   * actually has the inputs. */
  const prior = input.previousQuestCache || {};
  const study = input.cards
    ? studyStats(input.cards, states, today)
    : (prior.study || studyStats({}, {}, today));
  const certifications = input.certifications
    || prior.certifications || [];

  const writes = {
    ledger: writeLedger(ledger),
    character: renderCharacter(todayIso, level, total, streak),
    quest: renderQuest(todayIso),
    achievementsCache: JSON.stringify({
      updated: todayIso,
      unlocked: snapshot.filter((r) => r.unlocked).length,
      auto_total: hero.achievements_auto,
      total: snapshot.length,
      achievements: snapshot,
    }, null, 1) + "\n",
    /* The Quest Log note is thin and renders from this. A sync that writes the
     * note but not the cache leaves the page blank. */
    questCache: JSON.stringify(
      questCache(tasks, ledger, today, bankFull, hero, study,
                 certifications, C), null, 1) + "\n",
  };
  if (bankNote) writes.bankNote = bankNote;

  return {
    writes,
    state: { ...state, blocked_days: blockedDays, blocked_since: blockedSince,
             decay_cursor: decayCursor, last_run: todayIso },
    hero, bank, stats, snapshot,
    summary: {
      start_date: startDate, baseline,
      total_xp: total, level, rank: rankFor(level), streak,
      bank: bank.total,
      new_events: newEvents.length,
      new_by_kind: counter(newEvents.map((e) => e.kind)),
      ledger_events: ledger.length,
      achievements_unlocked: Object.keys(unlockedDates).length,
      achievements_new: earned.map(([, name]) => name).slice(0, 12),
    },
  };
}

module.exports = {
  BASE_XP, DIFF_LABEL, EARLY_MULT, ONTIME_MULT, LATE_MULT, PRIORITY_BONUS_LEVELS,
  PRIORITY_MULT, STREAK_STEP, STREAK_CAP, DECAY_RATE, DECAY_GRACE_DAYS,
  MAX_CATCHUP_DAYS, GLOBAL_DECAY_FRACTION, CARD_XP, NOTE_REVIEW_XP,
  SESSION_BONUS_XP, SESSION_MIN_CARDS, CARD_XP_DAILY_CAP, RITUAL_XP,
  WORKLOG_DAILY_CAP, RANKS, BANK_RATE, LEVEL_BONUS, MONTHLY_CEILING,
  FREEZES_PER_MONTH, TIER_XP,
  applyConfig, levelThreshold, levelFor, rankFor,
  parseDate, isoDate, addDays, daysBetween,
  readTasks, short, readLedger, cell, ledgerRow,
  sectionItems, dailyFacts, reviewDates, ritualEvents,
  studyEvents, computeStreak, longestRun, isoYearWeek, buildStats,
  bankSummary, round2, SF_TERMS, statsDefaults,
  CATALOG, evaluateAchievements, achievementSnapshot, roundTo,
  renderCharacter, renderQuest, writeLedger, runSync, achievementConditions,
  studyStats, questCache, tableRows, bankDetail, updateBankNote, money,
  taskCompletionEvents, decayEvents, pyRound,
};
