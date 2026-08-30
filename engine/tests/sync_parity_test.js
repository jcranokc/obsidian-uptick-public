/* End-to-end parity: the JS engine and the Python engine must produce the same
 * ledger, byte for byte, from the same vault.
 *
 * The unit-level parity test proves each ported function agrees in isolation.
 * This proves they agree when composed -- which is a different claim, because
 * the composition is where ordering, the achievement resolution loop, and the
 * streak-before-XP dependency live. Those are the parts a per-function test
 * cannot reach.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const E = require("../uptick-engine.js");

const ROOT = path.join(__dirname, "../..");
let fails = 0;

function check(label, cond, extra = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
}

/* A vault with enough in it to exercise every event kind at once. */
const TASKS = [
  "- [x] Ship the integration 📅 2026-03-09 ✅ 2026-03-08 [priority:: 1] [difficulty:: 4] #task ^task-a1",
  "- [x] Fix the broken report 📅 2026-03-08 ✅ 2026-03-09 [priority:: 3] [difficulty:: 2] #task ^task-a2",
  "- [x] Sandbox refresh 📅 2026-03-09 ✅ 2026-03-09 [priority:: 2] [difficulty:: 5] #task ^task-a3",
  "- [x] Tiny thing ✅ 2026-03-09 [priority:: 8] [difficulty:: 1] #task ^task-a4",
  "- [x] Standard job 📅 2026-03-09 ✅ 2026-03-09 [priority:: 4] [difficulty:: 3] #task ^task-a5",
  "- [ ] Overdue and open 📅 2026-03-02 [priority:: 2] [difficulty:: 3] #task ^task-b1",
  "- [ ] Blocked and waiting 📅 2026-02-01 [priority:: 1] [difficulty:: 5] #task #blocked ^task-b2",
  "- [ ] Future work 📅 2026-04-01 [priority:: 5] [difficulty:: 2] #task ^task-b3",
];

const DAILY = {
  "2026-03-08": "## Priorities\n- one\n- two\n\n## Work Log\n- `7:45 AM` early start\n"
              + "- `9:00 AM` more\n- `11:00 AM` more\n- `2:00 PM` more\n\n"
              + "## Completed\n- one\n\n## Notes for Tomorrow\n- next\n",
  "2026-03-09": "## Focus\n- single thing\n\n## Work Log\n- `11:30 AM` late start\n",
  "2026-03-10": "## Priorities\n- today\n",
};
const WEEKLY = { "2026-W10 - 2026-03-08": "## Review\n- a good week\n" };
const MONTHLY = {};

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syncparity-"));
  for (const d of ["2 Work/Tasks", "1 Capture/Daily", "1 Capture/Weekly",
                   "1 Capture/Monthly", "2 Work/Meetings", "4 System/Game/Certifications",
                   "4 System/Automation"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  for (const f of ["xp-sync.py", "achievements.py", "exam-readiness.py"]) {
    fs.copyFileSync(path.join(ROOT, "engine", f), path.join(root, "4 System/Automation", f));
  }
  fs.writeFileSync(path.join(root, "4 System/Game/Gamification Design.md"), "# design\n");
  /* A bank note with a goal in it, so the rewrite has rows to fill and the
   * "goals are read before the note is rewritten" ordering is exercised. */
  fs.writeFileSync(path.join(root, "4 System/Game/Reward Bank.md"), [
    "---", "title: Reward Bank", "---", "",
    "# Reward Bank", "",
    "## Balance", "",
    "| | |", "|---|---|", "| Lifetime earned | $0.00 |", "",
    "## Goals", "",
    "| # | Goal | Price | Banked | % | ETA | Status |",
    "|---|---|---|---|---|---|---|",
    "| 1 | Codex subscription | $100.00 | $0.00 | 0% | — | Queued |",
    "| 2 | Something dearer | $400.00 | $0.00 | 0% | — | Queued |", "",
    "## Ledger", "",
    "| Date | Change | Reason |", "|---|---|---|",
    "| 2026-03-05 | -$12.00 | a small treat |", "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "2 Work/Tasks/Task Inbox.md"),
    "---\ncreated: 2026-01-01\n---\n\n# Task Inbox\n\n" + TASKS.join("\n") + "\n");
  for (const [day, text] of Object.entries(DAILY)) {
    fs.writeFileSync(path.join(root, "1 Capture/Daily", `${day}.md`), text);
  }
  for (const [stem, text] of Object.entries(WEEKLY)) {
    fs.writeFileSync(path.join(root, "1 Capture/Weekly", `${stem}.md`), text);
  }
  return root;
}

function runPython(root, today, extra = []) {
  const out = execFileSync("python3",
    [path.join(root, "4 System/Automation/xp-sync.py"), "--vault", root, "--today", today, ...extra],
    { encoding: "utf8", maxBuffer: 1 << 26,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  return JSON.parse(out);
}

function readIf(p) {
  try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; }
}

function runJs(root, today, state) {
  const dailyNotes = {};
  for (const f of fs.readdirSync(path.join(root, "1 Capture/Daily"))) {
    dailyNotes[f.replace(/\.md$/, "")] = readIf(path.join(root, "1 Capture/Daily", f));
  }
  const weeklyNotes = {};
  for (const f of fs.readdirSync(path.join(root, "1 Capture/Weekly"))) {
    weeklyNotes[f.replace(/\.md$/, "")] = readIf(path.join(root, "1 Capture/Weekly", f));
  }
  /* countable_notes: every .md outside .obsidian and 4 System/Game. */
  let noteCount = 0;
  const walk = (dir, rel = "") => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if ([".obsidian", ".smart-env", ".claudian", ".agents", ".claude"].includes(e.name)) continue;
        walk(path.join(dir, e.name), r);
      } else if (e.name.endsWith(".md") && !r.startsWith("4 System/Game/")) {
        noteCount += 1;
      }
    }
  };
  walk(root);

  return E.runSync({
    today,
    state,
    taskInbox: readIf(path.join(root, "2 Work/Tasks/Task Inbox.md")),
    dailyNotes, weeklyNotes, monthlyNotes: {},
    ledger: readIf(path.join(root, "4 System/Game/XP Ledger.md")),
    bankNote: readIf(path.join(root, "4 System/Game/Reward Bank.md")),
    meetingNotes: {},
    noteCount,
    readTheDesign: true,
    conditions: {},
  });
}

/* ---- day one: both start from an empty vault -------------------------- */
const rootPy = makeVault();
const py1 = runPython(rootPy, "2026-03-10");
const pyLedger1 = readIf(path.join(rootPy, "4 System/Game/XP Ledger.md"));

const rootJs = makeVault();
const js1 = runJs(rootJs, "2026-03-10", {});

check("day 1: total XP", js1.summary.total_xp === py1.total_xp,
      `js=${js1.summary.total_xp} py=${py1.total_xp}`);
check("day 1: level", js1.summary.level === py1.level, `js=${js1.summary.level} py=${py1.level}`);
check("day 1: rank", js1.summary.rank === py1.rank);
check("day 1: streak", js1.summary.streak === py1.streak,
      `js=${js1.summary.streak} py=${py1.streak}`);
check("day 1: event count", js1.summary.new_events === py1.new_events,
      `js=${js1.summary.new_events} py=${py1.new_events}`);
check("day 1: events by kind",
      JSON.stringify(js1.summary.new_by_kind) === JSON.stringify(py1.new_by_kind),
      `js=${JSON.stringify(js1.summary.new_by_kind)} py=${JSON.stringify(py1.new_by_kind)}`);
check("day 1: achievements unlocked",
      js1.summary.achievements_unlocked === py1.achievements_unlocked,
      `js=${js1.summary.achievements_unlocked} py=${py1.achievements_unlocked}`);
check("day 1: bank total", js1.bank.total === py1.bank, `js=${js1.bank.total} py=${py1.bank}`);

/* The ledger is the record. Everything else is derived from it, so byte
 * equality here is the claim that matters. */
const bothLedgers = [js1.writes.ledger, pyLedger1];
check("day 1: ledger is byte-identical", bothLedgers[0] === bothLedgers[1]);
if (bothLedgers[0] !== bothLedgers[1]) {
  const a = bothLedgers[0].split("\n"), b = bothLedgers[1].split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log(`        first difference at line ${i + 1}`);
      console.log(`        js: ${a[i]}`);
      console.log(`        py: ${b[i]}`);
      break;
    }
  }
}

/* ---- day two: both continue from the ledger they wrote ---------------- */
const py2 = runPython(rootPy, "2026-03-12");
const pyLedger2 = readIf(path.join(rootPy, "4 System/Game/XP Ledger.md"));

fs.writeFileSync(path.join(rootJs, "4 System/Game/XP Ledger.md"), js1.writes.ledger);
const js2 = runJs(rootJs, "2026-03-12", js1.state);

check("day 2: decay accrued on both", (py2.new_by_kind.decay || 0) > 0);
check("day 2: total XP", js2.summary.total_xp === py2.total_xp,
      `js=${js2.summary.total_xp} py=${py2.total_xp}`);
check("day 2: events by kind",
      JSON.stringify(js2.summary.new_by_kind) === JSON.stringify(py2.new_by_kind),
      `js=${JSON.stringify(js2.summary.new_by_kind)} py=${JSON.stringify(py2.new_by_kind)}`);
check("day 2: ledger is byte-identical", js2.writes.ledger === pyLedger2);
if (js2.writes.ledger !== pyLedger2) {
  const a = js2.writes.ledger.split("\n"), b = pyLedger2.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log(`        first difference at line ${i + 1}`);
      console.log(`        js: ${a[i]}`);
      console.log(`        py: ${b[i]}`);
      break;
    }
  }
}

/* ---- the derived notes ------------------------------------------------ */
check("Character note is byte-identical",
      js2.writes.character === readIf(path.join(rootPy, "4 System/Game/Character.md")));
check("Quest Log note is byte-identical",
      js2.writes.quest === readIf(path.join(rootPy, "4 System/Game/Quest Log.md")));

/* The Quest Log renders from the cache, not the note, so the note matching
 * while the cache is missing or different is exactly the failure that left the
 * page blank. */
{
  /* The ledger is compared byte for byte because a person reads it. This is a
   * machine-read cache, and the two languages cannot agree on its bytes:
   * Python distinguishes int from float and writes 2.0 where JSON.stringify
   * writes 2. Neither is wrong and JSON.parse cannot tell them apart, so the
   * bar here is that every value matches, not every byte. */
  const pyCache = readIf(path.join(rootPy, "4 System/Automation/quest-cache.json"));
  check("quest-cache.json is written at all", !!js2.writes.questCache);
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : (v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v);
  const jsCache = js2.writes.questCache ? JSON.parse(js2.writes.questCache) : null;
  const pyParsed = pyCache ? JSON.parse(pyCache) : null;
  check("quest-cache.json matches value for value", same(jsCache, pyParsed));
  if (jsCache && pyParsed && !same(jsCache, pyParsed)) {
    for (const k of new Set([...Object.keys(jsCache), ...Object.keys(pyParsed)])) {
      if (!same(jsCache[k], pyParsed[k])) {
        console.log(`        differs at "${k}"`);
        console.log(`        js: ${JSON.stringify(jsCache[k]).slice(0, 160)}`);
        console.log(`        py: ${JSON.stringify(pyParsed[k]).slice(0, 160)}`);
      }
    }
  }
  const pyBank = readIf(path.join(rootPy, "4 System/Game/Reward Bank.md"));
  check("the Reward Bank note is rewritten", !!js2.writes.bankNote);
  check("the Reward Bank note is byte-identical", js2.writes.bankNote === pyBank);
  if (js2.writes.bankNote !== pyBank && pyBank) {
    const a = (js2.writes.bankNote || "").split("\n"), b = pyBank.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`        first difference at line ${i + 1}`);
        console.log(`        js: ${a[i]}`);
        console.log(`        py: ${b[i]}`);
        break;
      }
    }
  }
}

/* ---- a sync must not erase what it cannot compute ---------------------- */
/* Readiness and card counts come from LearnKit and the certification notes,
 * which the JS engine does not read. Writing an empty section for them would
 * not mean "you have none", it would mean "this run could not see them" -- and
 * it would wipe what the Python engine had already worked out. */
{
  const prior = {
    certifications: [{ name: "Admin II", score: 71.5, band: "Nearly" }],
    study: { total: 300, due: 12, overdue: 3, new: 5, mature: 40,
             reviewed: 295, decks: [{ deck: "Security", cards: 55, due: 4, new: 1 }] },
  };
  const kept = E.runSync({
    today: "2026-03-12", state: js1.state,
    taskInbox: readIf(path.join(rootJs, "2 Work/Tasks/Task Inbox.md")),
    ledger: js1.writes.ledger,
    previousQuestCache: prior,
  });
  const qc = JSON.parse(kept.writes.questCache);
  check("a run with no LearnKit data keeps the certifications it found before",
        JSON.stringify(qc.certifications) === JSON.stringify(prior.certifications),
        JSON.stringify(qc.certifications));
  check("and keeps the study counts",
        JSON.stringify(qc.study) === JSON.stringify(prior.study),
        JSON.stringify(qc.study));

  /* But real inputs must win over the old cache, or a stale count would
   * outlive the data it came from. */
  const fresh = E.runSync({
    today: "2026-03-12", state: js1.state,
    taskInbox: readIf(path.join(rootJs, "2 Work/Tasks/Task Inbox.md")),
    ledger: js1.writes.ledger,
    previousQuestCache: prior,
    cards: { c1: { groups: ["Security"] } },
    cardStates: { c1: { stage: "new" } },
    certifications: [],
  });
  const fq = JSON.parse(fresh.writes.questCache);
  check("real card data replaces the old counts", fq.study.total === 1,
        JSON.stringify(fq.study));
  check("an explicitly empty certification list is honoured",
        fq.certifications.length === 0);
}

fs.rmSync(rootPy, { recursive: true, force: true });
fs.rmSync(rootJs, { recursive: true, force: true });

console.log(fails ? `\n${fails} FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
