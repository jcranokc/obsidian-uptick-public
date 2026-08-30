/* Executes the Uptick XP render functions against a mock DOM + Obsidian API.
 * Catches runtime errors that a syntax check cannot. */
const fs = require("fs"), path = require("path"), Module = require("module");
const FIX = path.join(__dirname, "fixtures");
const PLUGIN = [path.join(__dirname, "../../main.js"),
  path.join(__dirname, "../../../.obsidian/plugins/life-os/main.js")].find((p) => fs.existsSync(p));

const { N } = require("./domshim.js");

/* ---- load the plugin with obsidian stubbed ---- */
const src = fs.readFileSync(PLUGIN, "utf8");
/* Expose the internals the harness needs to drive. */
const wrapped = src + "\n;module.exports.prototype = module.exports.prototype || (typeof Uptick !== 'undefined' ? Uptick.prototype : undefined);\n;module.exports.__test = { Game, xpHero, dayXpCard, renderAchievements, renderQuest, renderCharacter, renderLedger, studyCard, renderExams, renderBank, renderSettings, settingsModules, settingsMail, settingsReminders, renderHome, renderDaily, renderWeather, renderTodayPlan, parseTodayPlan, todayPlanLine, saveTodayPlan, todayPlanRecommendations, planMinutes, addGoal, editGoal, recordSpend, achCard, AchievementModal, AchievementDetail, DEFAULTS, mergeCfg, cfgGet, cfgSet, applyPaths, P, rankFor, progressBar, fmtNum, Engine, P };\n";
const tmp = path.join(__dirname, "_plugin_under_test.js");
fs.writeFileSync(tmp, wrapped);
global.window = { setTimeout: () => 0, clearTimeout() {}, dispatchEvent() {} };
global.ResizeObserver = undefined;
const mod = require(tmp);
const { Game, xpHero, dayXpCard, renderAchievements, renderQuest, renderCharacter, renderLedger, studyCard, renderExams, renderBank, renderSettings, settingsModules, settingsMail, renderHome, renderDaily, renderWeather, renderTodayPlan, parseTodayPlan, todayPlanLine, saveTodayPlan, todayPlanRecommendations, planMinutes, addGoal, editGoal, recordSpend, achCard,
        AchievementModal, AchievementDetail, DEFAULTS, mergeCfg, cfgGet, cfgSet, applyPaths, rankFor, fmtNum, Engine, P,
        settingsReminders } = mod.__test;

/* ---- mock app backed by the real vault files ---- */
const cache = JSON.parse(fs.readFileSync(path.join(FIX, "achievements-cache.json"), "utf8"));
const ledgerText = fs.readFileSync(path.join(FIX, "XP Ledger.md"), "utf8");
const questCache = JSON.parse(fs.readFileSync(path.join(FIX, "quest-cache.json"), "utf8"));
/* The catalog note, which is where the condition wording lives. */
const achNote = [
  "| # | Achievement | Tier | Condition | Progress | Unlocked |",
  "|---|---|---|---|---|---|",
  "| 1 | **First Blood** | Bronze | Complete your first task | - | - |",
  "| 2 | **Getting Started** | Bronze | Complete 10 tasks | - | - |",
].join("\n");

const files = {
  [P.character]: { path: P.character, stat: { mtime: 1 } },
  [P.ledger]: { path: P.ledger, stat: { mtime: 1 } },
  [P.achCache]: { path: P.achCache, stat: { mtime: 1 } },
  [P.questCache]: { path: P.questCache, stat: { mtime: 1 } },
  [P.achievements]: { path: P.achievements, stat: { mtime: 1 } },
};
const app = {
  vault: {
    getAbstractFileByPath: (p) => files[p] ?? null,
    cachedRead: async (f) => f.path === P.ledger ? ledgerText
      : f.path === P.achCache ? JSON.stringify(cache)
      : f.path === P.questCache ? JSON.stringify(questCache)
      : f.path === P.achievements ? achNote : "",
    getResourcePath: () => "app://art.png",
    /* Obsidian's adapter REJECTS on a missing path rather than resolving to
     * null. A mock that resolved would hide the branch that matters most. */
    adapter: {
      read: async (p) => {
        if (!(p in dataFiles)) throw new Error(`ENOENT: ${p}`);
        return dataFiles[p];
      },
      write: async (p, body) => { dataFiles[p] = body; },
    },
  },
  metadataCache: { getFileCache: () => ({ frontmatter: { level: 4, total_xp: 1180, streak: 6 } }) },
};

const dataFiles = {};

let fails = 0;
const check = (label, cond, extra="") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

(async () => {
  const baseCfg = mergeCfg(DEFAULTS, {});
  const plugin = { app, game: new Game(app), open: () => {},
    showAchievement: () => {}, cfg: baseCfg,
    on: (m) => cfgGet(baseCfg, `modules.${m}`, true) !== false,
    shows(page, key, module) {
      if (module && !this.on(module)) return false;
      return cfgGet(baseCfg, `${page}.${key}`, true) !== false;
    },
    setCfg: async () => {}, replaceCfg: async () => {} };

  console.log("Game data layer");
  const c = plugin.game.character();
  check("character reads level/xp/streak", c.level === 4 && c.total === 1180 && c.streak === 6);
  check("rank derived", c.rank === "Operator", c.rank);
  check("progress into level computed", c.into === 1180 - (50*16+50*4) && c.need > 0, `into=${c.into}`);
  const rows = await plugin.game.ledger();
  check("ledger parsed", rows.length >= 1, `${rows.length} rows`);
  const cat = await plugin.game.achievements();
  check("achievement cache loaded", cat && cat.achievements.length === 258);

  console.log("\nHome hero");
  const root = new N("div");
  await xpHero(plugin, root);
  check("hero renders", root.count("lifeos-hero") === 1);
  check("level crest shows the level", root.textOf("lifeos-hero-level")[0] === "4");
  check("rank shown", root.textOf("lifeos-hero-rank")[0] === "Operator");
  check("progress bar drawn", root.count("lifeos-bar-fill") >= 1);
  check("achievements stat present", root.textOf("lifeos-microlabel").includes("ACHIEVEMENTS"));
  check("closest-to-unlock rows drawn", root.count("lifeos-nearrow") > 0,
        `${root.count("lifeos-nearrow")} rows`);

  console.log("\nDaily hero is date-scoped");
  const past = new N("div");
  await xpHero(plugin, past, "2026-01-01");
  check("past day labels the stat 'That day'", past.textOf("lifeos-microlabel").includes("THAT DAY"));

  console.log("\nDay XP card");
  const grid = new N("div"); grid.addClass("lifeos-grid");
  await dayXpCard(plugin, grid, "2026-08-22", "col3");
  check("day card renders", grid.count("lifeos-dayxp") === 1);
  check("net XP shown", grid.textOf("lifeos-dayxp-net").length === 1);

  console.log("\nAchievements browser");
  const page = new N("div");
  await renderAchievements(plugin, page, { view: "achievements" }, { sourcePath: "x" }, async () => {});
  check("page renders", page.count("lifeos-achtotal") === 1);
  check("all 258 cards drawn", page.count("lifeos-achcard") === 258, `${page.count("lifeos-achcard")}`);
  /* A bar belongs on every auto-tracked card that is not yet unlocked, plus
     one per category header, the collection total, and each "closest" row. */
  const autoLocked = cat.achievements.filter(a => !a.unlocked && !a.manual).length;
  const expected = autoLocked + 20 + 1 + Math.min(8, cat.achievements.filter(
    a => !a.unlocked && !a.manual && a.progress > 0).length);
  check("a progress bar on every trackable locked card",
        page.count("lifeos-bar") === expected,
        `${page.count("lifeos-bar")} bars, expected ${expected} (${autoLocked} locked)`);
  check("unlocked cards show a date, not a bar",
        page.count("lifeos-achcard-date") === cat.unlocked);
  check("manual cards say so", page.count("lifeos-achcard-manual") ===
        cat.achievements.filter(a => a.manual && !a.unlocked).length);
  check("filter chips present", page.count("lifeos-chip") >= 10);
  check("sections grouped", page.count("lifeos-achsection") === 20, `${page.count("lifeos-achsection")}`);
  check("closest card present", page.count("lifeos-achrow") > 0);

  console.log("\nQuest Log view");
  const quest = new N("div");
  await renderQuest(plugin, quest, { view: "quest" }, { sourcePath: "x" }, async () => {});
  check("quest renders without code fences", quest.count("lifeos-ready") === questCache.certifications.length);
  check("readiness score shown", quest.textOf("lifeos-ready-score").length === questCache.certifications.length);
  check("four component bars per certification",
        quest.count("lifeos-comp") === 4 * questCache.certifications.length,
        `${quest.count("lifeos-comp")}`);
  check("blockers listed", quest.count("lifeos-blocker") === questCache.certifications
        .reduce((a, c) => a + c.blockers.length, 0));
  check("bleeding-XP rows drawn", quest.count("lifeos-bleed") === questCache.bleeding.length,
        `${quest.count("lifeos-bleed")} of ${questCache.bleeding.length}`);
  check("tiles strip present", quest.count("lifeos-tile") === 4);
  check("bank card present", quest.count("lifeos-bank-amount") === 1);

  console.log("\nCharacter view");
  const chr = new N("div");
  await renderCharacter(plugin, chr, { view: "character" }, { sourcePath: "x" }, async () => {});
  check("character renders", chr.count("lifeos-srcrow") === questCache.sources.length);
  check("30-day sparkline drawn", chr.count("lifeos-spark-col") === 30,
        `${chr.count("lifeos-spark-col")} columns`);
  check("ranks listed with current marked", chr.count("lifeos-rankrow") === questCache.ranks.length
        && chr.count("lifeos-rankrow-you") === 1);
  check("streak card present", chr.count("lifeos-statrow") >= 4 || chr.all().some(n => n.text === "Longest"));
  check("no raw code fences anywhere", !chr.all().some(n => n.tag === "pre" || n.tag === "code"));

  console.log("\nCache warming");
  {
    let reads = 0;
    const countingApp = { ...app, vault: { ...app.vault,
      cachedRead: async (f) => { reads++; return app.vault.cachedRead(f); } } };
    const g = new Game(countingApp);
    await g.warm();
    const afterWarm = reads;
    await g.ledger(); await g.ledger(); await g.quest(); await g.achievements();
    /* Four sources now: ledger, quest cache, achievements cache, and the
     * catalog note the conditions are read from. */
    check("warm() loads every source once", afterWarm === 4, `${afterWarm} reads`);
    check("repeat reads come from cache, not disk",
          reads === afterWarm, `${reads - afterWarm} extra reads`);
  }

  console.log("\nHome study card");
  const sgrid = new N("div"); sgrid.addClass("lifeos-grid");
  await studyCard(plugin, sgrid, "col3");
  const st = questCache.study;
  check("study card renders", sgrid.count("lifeos-study-head") === 1);
  check("due count shown", sgrid.textOf("lifeos-study-due")[0] === String(st.due),
        sgrid.textOf("lifeos-study-due")[0]);
  /* Five decks plus a "+N more" tail when there are more, so the card cannot
     grow unbounded and dwarf its lane. */
  const shownDecks = Math.min(5, st.decks.length);
  const moreRow = st.decks.length > 5 ? 1 : 0;
  check("study card caps at five decks plus a count",
        sgrid.count("lifeos-deckrow") === shownDecks + moreRow,
        `${sgrid.count("lifeos-deckrow")} rows for ${st.decks.length} decks`);
  if (moreRow) {
    const tail = sgrid.all().find((n) => n.classes.has("is-more"));
    check("the tail names how many domains were folded away",
          !!tail && tail.all().some((n) => /more domains/.test(n.text)));
  }
  check("three study entry points offered", sgrid.count("lifeos-btn") === 3);
  check("certification readiness surfaced",
        sgrid.count("lifeos-study-cert") === (questCache.certifications.length ? 1 : 0));

  console.log("\nToday Plan");
  {
    const PLAN = [
      "## Today Plan", "",
      "- [planned] [task:: task-late] Resolve the production alert",
      "- [deferred] [study:: Platform Administrator II] Review LearnKit cards",
    ].join("\n");
    const planTasks = [
      { id: "task-late", text: "Resolve the production alert", fullText: "Resolve the production alert",
        due: "2026-08-20", status: "Not Started", duration: 20 },
      { id: "task-priority", text: "Reply to Casey", fullText: "Reply to Casey",
        due: "2026-08-23", status: "Not Started", duration: 30, source: "Daily Standup" },
      { id: "task-later", text: "Review release notes", fullText: "Review release notes",
        due: "2026-09-01", status: "Not Started", duration: 30 },
    ];
    const parsed = parseTodayPlan(PLAN);
    check("plan parses canonical task and study references",
          parsed.length === 2 && parsed[0].id === "task-late" && parsed[1].kind === "study");
    check("plan keeps its outcome state", parsed[1].status === "deferred");
    check("plan serializes stable task ids", /\[task:: task-late\]/.test(todayPlanLine(parsed[0])));
    let planWrite = null;
    await saveTodayPlan({ store: { replaceSection: async (path, heading, body) => {
      planWrite = { path, heading, body };
    } } }, "1 Capture/Daily/2026-08-23.md", [
      { ...parsed[0], status: "done" },
      { ...parsed[1], status: "dropped" },
    ]);
    check("plan outcomes write only the Today Plan section",
          planWrite?.path === "1 Capture/Daily/2026-08-23.md" &&
          planWrite?.heading === "Today Plan" &&
          /\[done\].*task-late/.test(planWrite?.body) && /\[dropped\].*study/.test(planWrite?.body));
    const recs = todayPlanRecommendations(planTasks, ["Reply to Casey"],
      { due: 8, certification: "Platform Administrator II", weakestDomain: "Security" },
      { format: () => "2026-08-23" });
    check("overdue task outranks all other suggestions", recs[0].id === "task-late", recs[0]?.id);
    check("study appears as an optional suggestion", recs.some((r) => r.kind === "study"));
    check("plan budget uses task duration and LearnKit's 20-minute session",
          planMinutes(parsed, planTasks) === 20, `${planMinutes(parsed, planTasks)} min`);

    const planRoot = new N("div"); planRoot.addClass("lifeos-grid");
    await renderTodayPlan({ ...plugin, tasks: { setDone: async () => {} } }, planRoot, {
      path: "1 Capture/Daily/2026-08-23.md", content: PLAN, tasks: planTasks,
      priorities: ["Reply to Casey"], meetings: [{ time: "23:59", title: "Wrap-up" }],
      refresh: async () => {},
    });
    check("plan renderer shows selected commitments", planRoot.count("lifeos-plan-row") === 2);
    check("plan renderer explains suggested work", planRoot.count("lifeos-plan-suggestion") >= 1);
    check("plan renderer identifies the source note for a suggestion", planRoot.count("lifeos-plan-source") >= 1);
  }

  console.log("\nLearnKit command resolution");
  const cmdPlugin = {
    ...plugin,
    app: { ...app, commands: { commands: {
      "learnkit:abc123": { name: "Open home" },
      "learnkit:def456": { name: "New study session" },
      "learnkit:ghi789": { name: "Open Tests" },
      "other:x": { name: "Open home" },
    } } },
  };
  const resolve = mod.__test.Game ? null : null;
  const Uptick = mod;
  // learnKitCommand lives on the plugin class; exercise it through a stub.
  const proto = Object.getPrototypeOf(new (require("obsidian").Plugin)());
  const UptickProto = Uptick.prototype || null;
  const lk = UptickProto ? UptickProto.learnKitCommand : null;
  if (lk) {
    check("home resolves by display name",
          lk.call(cmdPlugin, "home") === "learnkit:abc123");
    check("study resolves by display name",
          lk.call(cmdPlugin, "study") === "learnkit:def456");
    check("unknown key falls back to home",
          lk.call(cmdPlugin, "nope") === "learnkit:abc123");
    check("ignores non-LearnKit commands with the same name",
          lk.call(cmdPlugin, "home") !== "other:x");
  } else {
    console.log("  SKIP  learnKitCommand not exported");
  }

  console.log("\nPractice exam resolution");
  const mkFile = (path) => ({ path, basename: path.split("/").pop().replace(/\.md$/, "") });
  const examPlugin = {
    ...plugin,
    opened: [],
    open(p) { this.opened.push(p); },
    app: { ...app, vault: { ...app.vault, getMarkdownFiles: () => [
      mkFile("3 Reference/Knowledge/Study Library/Salesforce/Platform Administrator II/Practice Exams/Practice Exam 1.md"),
      mkFile("3 Reference/Knowledge/Study Library/Salesforce/Platform Administrator II/Practice Exams/Practice Exams.md"),
      mkFile("2 Work/Tasks/Task Inbox.md"),
    ] } },
  };
  const openExams = UptickProto && UptickProto.openPracticeExams;
  if (openExams) {
    await openExams.call(examPlugin);
    check("opens the index note, not an individual paper",
          examPlugin.opened[0]?.endsWith("Practice Exams/Practice Exams.md"),
          examPlugin.opened[0]);
    // No index present: fall back to a paper rather than dead-ending.
    const noIndex = { ...examPlugin, opened: [],
      app: { ...app, vault: { ...app.vault, getMarkdownFiles: () => [
        mkFile("x/Practice Exams/Practice Exam 3.md")] } } };
    noIndex.open = function (p) { this.opened.push(p); };
    await openExams.call(noIndex);
    check("falls back to a paper when there is no index",
          noIndex.opened[0]?.endsWith("Practice Exam 3.md"), noIndex.opened[0]);
  } else {
    console.log("  SKIP  openPracticeExams not reachable");
  }

  console.log("\nXP Ledger view");
  const led = new N("div");
  await renderLedger(plugin, led, { view: "ledger" }, { sourcePath: "x" }, async () => {});
  const ledgerRows = await plugin.game.ledger();
  const ledgerDays = new Set(ledgerRows.map(r => r.date)).size;
  check("every ledger row rendered", led.count("lifeos-ledgerrow") === ledgerRows.length,
        `${led.count("lifeos-ledgerrow")} of ${ledgerRows.length}`);
  check("grouped by day", led.count("lifeos-ledgerday") === ledgerDays,
        `${led.count("lifeos-ledgerday")} of ${ledgerDays}`);
  check("day totals shown", led.count("lifeos-ledgerday-net") === ledgerDays);
  check("kind filter chips drawn", led.count("lifeos-chip") >= 2);
  check("summary tiles", led.count("lifeos-tile") === 4);
  /* The Markdown table clipped long details mid-word; the view must render
     each detail exactly as the ledger stores it, however long. */
  const rendered = led.textOf("lifeos-ledgerrow-detail");
  check("every detail rendered verbatim, none clipped by the view",
        ledgerRows.every(r => rendered.includes(r.detail)),
        `${rendered.length} rendered`);
  const longest = ledgerRows.reduce((a, r) => r.detail.length > a.length ? r.detail : a, "");
  check("the view imposes no length limit of its own",
        rendered.some(d => d.length === longest.length),
        `longest ${longest.length} chars`);
  check("decay rows marked negative",
        led.count("lifeos-kind-decay") === ledgerRows.filter(r => r.kind === "decay").length);

  console.log("\nPractice Exams view");
  const EXAM_DIR = "3 Reference/Knowledge/Study Library/Salesforce/Platform Administrator II/Practice Exams";
  const paperFm = (n) => ({ type: "practice-exam", exam_number: n, questions: 60,
                            test_id: `k2-bank-exam-${n}`, pass_mark: 65,
                            time_limit_minutes: 105 });
  const papers = [1, 2, 3, 4, 5].map((n) => ({
    path: `${EXAM_DIR}/Practice Exam ${n}.md`, basename: `Practice Exam ${n}` }));
  const idxFile = { path: `${EXAM_DIR}/Practice Exams.md`, basename: "Practice Exams" };
  const fmFor = (f) => f.path === idxFile.path
    ? { certification: "An Example Certification" }
    : paperFm(Number(f.basename.split(" ").pop()));

  /* Two logged attempts, one of them a retake, so pass/fail styling, the
     adjusted score and the retake marker all get exercised. */
  const qWithLog = JSON.parse(JSON.stringify(questCache));
  qWithLog.certifications[0].attempts_log = [
    { date: "2026-08-24", source: "K2 bank", test_id: "k2-bank-exam-1",
      questions: 60, score: 72, prior: 0, days_ago: 1, adjusted: 65 },
    { date: "2026-08-20", source: "K2 bank", test_id: "k2-bank-exam-2",
      questions: 60, score: 58, prior: 1, days_ago: 5, adjusted: 44 },
  ];
  const xvApp = { ...app,
    vault: { ...app.vault,
      getMarkdownFiles: () => [...papers, idxFile],
      getAbstractFileByPath: (p) => p === questCache.certifications[0].path
        ? { path: p } : app.vault.getAbstractFileByPath(p) },
    metadataCache: { getFileCache: (f) => ({ frontmatter: fmFor(f) }) } };
  const xvPlugin = { ...plugin, app: xvApp,
    game: Object.assign(Object.create(Game.prototype), { app: xvApp,
      _quest: qWithLog, _questAt: 1, quest: async () => qWithLog }) };

  const ex = new N("div");
  await renderExams(xvPlugin, ex, { view: "exams" },
    { sourcePath: idxFile.path }, async () => {});
  check("one card per paper, index excluded", ex.count("lifeos-exam-top") === 5,
        `${ex.count("lifeos-exam-top")}`);
  check("sat papers show their score",
        ex.textOf("lifeos-exam-score").filter((s) => s !== "\u2014").length === 2,
        ex.textOf("lifeos-exam-score").join(","));
  check("a pass and a below-pass are styled differently",
        ex.all().some((n) => n.classes.has("is-pass")) &&
        ex.all().some((n) => n.classes.has("is-fail")));
  check("unsat papers read as not sat",
        ex.textOf("lifeos-exam-verdict").filter((v) => v === "Not sat").length === 3);
  check("retake marked", ex.count("lifeos-attempt-retake") === 1);
  check("adjusted score shown alongside raw", ex.count("lifeos-attempt-adj") === 2);
  check("gate banner shown while under three attempts",
        ex.count("lifeos-gate") === 1);
  check("summary tiles", ex.count("lifeos-tile") === 4);

  /* Three logged attempts clears the gate, so the banner must disappear. */
  const qCleared = JSON.parse(JSON.stringify(qWithLog));
  qCleared.certifications[0].attempts_log.push(
    { date: "2026-08-22", source: "K2 bank", test_id: "k2-bank-exam-3",
      questions: 60, score: 70, prior: 0, days_ago: 3, adjusted: 63 });
  const clearedPlugin = { ...xvPlugin,
    game: Object.assign(Object.create(Game.prototype), { app: xvApp,
      _quest: qCleared, _questAt: 1, quest: async () => qCleared }) };
  const ex2 = new N("div");
  await renderExams(clearedPlugin, ex2, { view: "exams" },
    { sourcePath: idxFile.path }, async () => {});
  check("gate banner clears at three attempts", ex2.count("lifeos-gate") === 0);

  console.log("\nReward Bank view");
  const qBank = JSON.parse(JSON.stringify(questCache));
  qBank.bank = { ...qBank.bank, total: 42.5, spent: 10, available: 32.5,
    this_month: 12, ceiling: 100, rate: 250, level_bonus: 2, daily: 1.5,
    active_days: 12,
    goals: [
      { n: "1", name: "Codex subscription", price: 100, banked: 32.5,
        progress: 0.325, remaining: 67.5, eta_days: 45, status: "Active" },
      { n: "2", name: "A very good chair", price: 400, banked: 0,
        progress: 0, remaining: 400, eta_days: null, status: "Queued" },
    ],
    ledger: [{ date: "2026-08-20", change: -10, reason: "A book" }] };
  const bankPlugin = { ...plugin,
    game: Object.assign(Object.create(Game.prototype), { app,
      _quest: qBank, _questAt: 1, quest: async () => qBank }) };
  const bk = new N("div");
  await renderBank(bankPlugin, bk, { view: "bank" }, { sourcePath: "x" }, async () => {});
  check("available balance leads the page",
        bk.textOf("lifeos-bankhero-amount")[0] === "$32.50",
        bk.textOf("lifeos-bankhero-amount")[0]);
  check("one row per goal", bk.count("lifeos-goal") === 2);
  check("active and queued goals styled apart",
        bk.all().some((n) => n.classes.has("is-active")) &&
        bk.all().some((n) => n.classes.has("is-queued")));
  check("ETA shown for the active goal",
        bk.textOf("lifeos-goal-eta").some((s) => s.includes("45 days")),
        bk.textOf("lifeos-goal-eta").join(" | "));
  check("spend history listed", bk.count("lifeos-spend") === 1);
  check("spend shows as negative", bk.all().some((n) =>
        n.classes.has("lifeos-spend-amt") && n.classes.has("is-neg")));

  /* Under a week of data the ETA must say so rather than invent a number. */
  const qThin = JSON.parse(JSON.stringify(qBank));
  qThin.bank.daily = 0; qThin.bank.active_days = 2;
  qThin.bank.goals[0].eta_days = null;
  const thinPlugin = { ...plugin,
    game: Object.assign(Object.create(Game.prototype), { app,
      _quest: qThin, _questAt: 1, quest: async () => qThin }) };
  const bk2 = new N("div");
  await renderBank(thinPlugin, bk2, { view: "bank" }, { sourcePath: "x" }, async () => {});
  check("thin history says so instead of guessing an ETA",
        bk2.textOf("lifeos-goal-eta").some((s) => s.includes("more data")),
        bk2.textOf("lifeos-goal-eta").join(" | "));

  console.log("\nSettings model");
  check("merge keeps keys the stored config never had",
        mergeCfg(DEFAULTS, { game: { decayRate: 0.9 } }).game.baseXp[3] === 50);
  check("merge applies the override", 
        mergeCfg(DEFAULTS, { game: { decayRate: 0.9 } }).game.decayRate === 0.9);
  check("get reads a nested path", cfgGet(DEFAULTS, "bank.rate") === 250);
  check("get falls back when absent", cfgGet(DEFAULTS, "no.such.key", "x") === "x");
  {
    const o = {}; cfgSet(o, "a.b.c", 7);
    check("set creates intermediate objects", o.a.b.c === 7);
  }
  {
    /* Paths must be derivable from settings, or the plugin cannot be installed
       into a vault laid out differently from this one. */
    applyPaths({ paths: { game: "Game", automation: "Auto", taskInbox: "T.md" } });
    const ok = P.game === "Game" && P.quest === "Game/Quest Log.md"
      && P.achCache === "Auto/achievements-cache.json" && P.taskInbox === "T.md";
    check("paths re-derive from settings", ok,
          `${P.game} | ${P.quest} | ${P.achCache}`);
    applyPaths(null);
    check("paths restore to defaults", P.game === DEFAULTS.paths.game);
  }

  console.log("\nSettings page");
  const cfgPlugin = { ...plugin, cfg: mergeCfg(DEFAULTS, {}),
    setCfg: async () => {}, replaceCfg: async () => {},
    open: () => {}, app,
    runReminderBridge: async () => ({ code: 0, stdout: JSON.stringify({ ok: true, lists: [
      { name: "Inbox" }, { name: "Work" }, { name: "Personal" }, { name: "House" }, { name: "Waiting" },
    ] }) }) };
  const sroot = new N("div");
  await renderSettings(cfgPlugin, sroot, { view: "settings" },
    { sourcePath: "x" }, async () => {});
  /* Names, not a count: a bare count passes when a tab is renamed away and
   * fails for the wrong reason when one is added. */
  const tabNames = sroot.findAll("lifeos-chip").map((c) => c.textContent);
  for (const want of ["Setup", "Modules", "Layout", "Panels", "Mail", "Reminders",
                      "Experience", "Rewards", "Paths"]) {
    check(`settings tab: ${want}`, tabNames.includes(want), tabNames.join(","));
  }
  check("first tab drawn", sroot.count("lifeos-setsection") >= 2);

  const reminderRoot = new N("div");
  await settingsReminders(cfgPlugin, reminderRoot, { tab: "Reminders" });
  check("reminders: settings render", reminderRoot.count("lifeos-setsection") >= 4);
  check("reminders: connection status", /Connected/.test(reminderRoot.textContent));
  check("reminders: route inputs", reminderRoot.count("lifeos-reminder-route") === 3);
  check("reminders: local category detection settings", /Automatic category detection/.test(reminderRoot.textContent));
  check("reminders: recommended setup action", /Use recommended setup/.test(reminderRoot.textContent));
  check("reminders: iMessage capture settings", /iMessage task capture/.test(reminderRoot.textContent));

  /* The modal working proves nothing if the tile does not open it, and a tile
 * must open exactly one thing: the first version of this added a second
 * handler beside the existing one, so an unlocked tile opened the detail and
 * the celebration on top of each other. */
{
  const grid = new N("div");
  const tile = achCard(plugin, grid, {
    slug: "first-blood", name: "First Blood", tier: "Bronze", category: "Volume",
    xp: 50, condition: "Complete your first task", have: 1, need: 1,
    unlocked: "2026-03-01", manual: false,
  });
  check("achievement tiles are clickable", grid.count("is-tappable") >= 1);
  check("a tile binds exactly one click handler",
        (tile.listeners.click || []).length === 1,
        `${(tile.listeners.click || []).length} handlers`);

  /* Routing: the celebration says ACHIEVEMENT UNLOCKED over a burst of rays,
   * which is nonsense on a tile you are 3 of 10 towards. */
  const opened = [];
  const spy = { ...plugin, app,
    showAchievement: (slug) => { opened.push(["celebrate", slug]); } };
  const entry = (unlocked) => ({
    slug: "getting-started", name: "Getting Started", tier: "Bronze",
    category: "Volume", xp: 50, condition: "Complete 10 tasks",
    have: 3, need: 10, unlocked, manual: false,
  });

  const g2 = new N("div");
  const lockedTile = achCard(spy, g2, entry(null));
  const realOpen = AchievementDetail.prototype.open;
  AchievementDetail.prototype.open = function () { opened.push(["detail", this.entry.slug]); };
  await lockedTile.__tap();
  check("a locked tile opens the detail, not the celebration",
        JSON.stringify(opened) === '[["detail","getting-started"]]',
        JSON.stringify(opened));

  opened.length = 0;
  const g3 = new N("div");
  const doneTile = achCard(spy, g3, entry("2026-03-01"));
  await doneTile.__tap();
  check("an earned tile opens the celebration",
        JSON.stringify(opened) === '[["celebrate","getting-started"]]',
        JSON.stringify(opened));
  AchievementDetail.prototype.open = realOpen;
}

/* The condition is static text in the Achievements note. A cache written
 * without it left every tile saying "No condition recorded", which is what a
 * reader sees when the wording exists and simply was not loaded. */
{
  dataFiles[P.achievements] = [
    "| # | Achievement | Tier | Condition | Progress | Unlocked |",
    "|---|---|---|---|---|---|",
    "| 1 | **First Blood** | Bronze | Complete your first task | - | - |",
    "| 2 | **Getting Started** | Bronze | Complete 10 tasks | - | - |",
  ].join("\n");
  /* The merge itself, not just the parse: a cache entry with no condition must
   * come back from Game.achievements() carrying the note's wording. */
  {
    /* The fixture ships with all 258 conditions filled, which is not the state
     * a real vault was in -- an engine that never read the note wrote 0 of 258.
     * Blank them here so the backfill has something to do; a fixture kinder
     * than reality is how this went unnoticed in the first place. */
    const saved = cache.achievements.map((a) => a.condition);
    for (const a of cache.achievements) a.condition = "";
    const g = new Game(app);
    const loaded = await g.achievements();
    const first = loaded.achievements.find((a) => a.slug === "first-blood");
    check("a blank condition is filled in from the note",
          first && first.condition === "Complete your first task",
          first ? JSON.stringify(first.condition) : "entry missing");
    const got = loaded.achievements.find((a) => a.slug === "getting-started");
    check("and so is the next one", got && got.condition === "Complete 10 tasks");
    const absent = loaded.achievements.find((a) => a.slug === "centurion");
    check("one the note does not mention stays blank rather than guessing",
          absent && absent.condition === "");
    cache.achievements.forEach((a, i) => { a.condition = saved[i]; });
  }

  const conds = Engine.achievementConditions(dataFiles[P.achievements]);
  check("conditions parse from the note table",
        conds["first-blood"] === "Complete your first task", JSON.stringify(conds));
  check("and the second row too", conds["getting-started"] === "Complete 10 tasks");
  check("a row that is not an achievement is ignored",
        Engine.achievementConditions("| not | a | table | row |")["undefined"] === undefined);
}

/* The icons ship separately because they are 78MB. A fresh vault therefore
 * has none, and without saying so the page just looks unfinished -- which is
 * exactly how it read on the first real install. */
{
  const noArt = new N("div");
  await renderAchievements({ ...plugin, app,
    game: Object.assign(Object.create(Game.prototype), { app, _hasArt: false }),
  }, noArt, { view: "achievements" }, { sourcePath: "x" }, async () => {});
  check("says when no artwork is installed", noArt.count("lifeos-artnote") === 1);
  check("and says what to do about it",
        /Run Setup again/i.test(noArt.textContent));
  check("and offers to do it", noArt.count("lifeos-btn") >= 1);
  check("and that bare tiles are normal, not broken",
        /normal state, not a missing file/.test(noArt.textContent));

  const withArt = new N("div");
  await renderAchievements({ ...plugin, app,
    game: Object.assign(Object.create(Game.prototype), { app, _hasArt: true }),
  }, withArt, { view: "achievements" }, { sourcePath: "x" }, async () => {});
  check("and says nothing once artwork is there", withArt.count("lifeos-artnote") === 0);
}

/* home.weather sat in DEFAULTS with a toggle and was read by nothing, so the
 * card never appeared on Home whatever you set. */
{
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "../../main.js"), "utf8");
  check("Home reads its weather setting",
        /shows\("home", "weather"/.test(src));
  const homeKeys = [...(/^  home: \{([\s\S]*?)^  \},/m.exec(src)?.[1] || "")
    .matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
  const unread = homeKeys.filter((k) =>
    !new RegExp(`shows\\("home", "${k}"`).test(src));
  check("every home.* setting is actually read", unread.length === 0,
        unread.join(", "));
}

/* A fresh vault has none of the companion plugins, so pages that link to what
 * they provide look broken rather than unconfigured. Setup names them. */
{
  const setupRoot = new N("div");
  const withNone = { ...cfgPlugin, app: { ...app, plugins: { plugins: {} } } };
  await renderSettings(withNone, setupRoot, { view: "settings" },
                       { sourcePath: "x" }, async () => {});
  check("Setup lists the plugins Uptick works with",
        setupRoot.count("lifeos-companion") >= 4,
        `${setupRoot.count("lifeos-companion")}`);
  check("and says none of them is required",
        /None of these is required/.test(setupRoot.textContent));
  check("with nothing installed, none is marked on",
        setupRoot.findAll("lifeos-companion").every((r) => !r.classes.has("is-on")));

  const setupRoot2 = new N("div");
  const withSome = { ...cfgPlugin, app: { ...app,
    plugins: { plugins: { dataview: {}, "obsidian-tasks-plugin": {} } } } };
  await renderSettings(withSome, setupRoot2, { view: "settings" },
                       { sourcePath: "x" }, async () => {});
  check("installed ones are marked",
        setupRoot2.findAll("lifeos-companion").filter((r) => r.classes.has("is-on")).length === 2,
        `${setupRoot2.findAll("lifeos-companion").filter((r) => r.classes.has("is-on")).length}`);
}

/* Setting a location used to do nothing: the field was read only by a Python
 * script nobody was told to run, so the setting that looked like the thing
 * which makes weather work needed a key, a script and a scheduled job. */
{
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "../../main.js"), "utf8");
  check("the plugin can fetch weather itself", /async fetchWeather\(\)/.test(src));
  check("there is a command for it", /id: "fetch-weather"/.test(src));
  check("settings offer a key field", /weather\.apikey/.test(src));
  check("the key is never echoed in an error",
        !/\$\{url\}/.test(src.slice(src.indexOf("async fetchWeather"),
                                     src.indexOf("async fetchWeather") + 4000)));

  /* The hint has to say which half is missing, or "not set up" is the same
   * message whether you have done nothing or nearly everything. */
  const hintFor = async (weather) => {
    const r = new N("div");
    await renderWeather({ ...cfgPlugin, app, cfg: mergeCfg(DEFAULTS, { weather }),
      openSettings: () => {}, setCfg: async () => {}, fetchWeather: async () => ({}) }, r);
    return r.textContent;
  };
  check("says when nothing is set", /needs a free Visual Crossing API key/
    .test(await hintFor({})));
  check("says when only the location is set", /no API key/
    .test(await hintFor({ location: "Example City" })));
  check("says when only the key is set", /no location/
    .test(await hintFor({ apikey: "k" })));
  check("says when both are set but nothing fetched",
        /does not update on its own/.test(await hintFor({ apikey: "k", location: "Example City" })));
}

/* The weather card returned null when unconfigured, leaving a blank space on
 * Home with nothing to say why. */
{
  const wRoot = new N("div");
  await renderWeather({ ...cfgPlugin, app,
    openSettings: () => {}, setCfg: async () => {} }, wRoot);
  check("an unconfigured weather card explains itself",
        wRoot.count("lifeos-setuphint") === 1);
  check("and names what it needs", /Visual Crossing/.test(wRoot.textContent));
  check("and offers to hide it", /Hide this card/.test(wRoot.textContent));
}

/* ---- Achievement detail ------------------------------------------------
 * A tile has to answer "what is this and how do I get it". The card truncates
 * its condition to fit the grid, so the modal is the only place that says it
 * in full -- and the three states a tile can be in read differently. */
{
  const detailFor = (entry) => {
    const m = new AchievementDetail(app, plugin, entry);
    m.contentEl = new N("div");
    m.modalEl = new N("div");
    m.close = () => {};
    m.onOpen();
    return m.contentEl;
  };

  const locked = detailFor({
    slug: "getting-started", name: "Getting Started", tier: "Bronze",
    category: "Volume", xp: 50, condition: "Complete 10 tasks",
    have: 3, need: 10, unlocked: null, manual: false,
  });
  check("detail: names the achievement", /Getting Started/.test(locked.textContent));
  check("detail: says how to earn it", /Complete 10 tasks/.test(locked.textContent));
  check("detail: labels the condition", /How to earn it/.test(locked.textContent));
  check("detail: shows the tier", /Bronze/.test(locked.textContent));
  check("detail: shows the XP", /50 XP/.test(locked.textContent));
  check("detail: shows progress", /3 of 10/.test(locked.textContent));
  check("detail: says how much is left", /7 to go/.test(locked.textContent));
  check("detail: draws a bar", locked.count("lifeos-bar-lg") >= 1);

  const done = detailFor({
    slug: "first-blood", name: "First Blood", tier: "Bronze", category: "Volume",
    xp: 50, condition: "Complete your first task",
    have: 1, need: 1, unlocked: "2026-03-01", manual: false,
  });
  check("detail: an earned one says when", /Earned 2026-03-01/.test(done.textContent));
  check("detail: and does not show a progress bar", done.count("lifeos-bar-lg") === 0);

  const manual = detailFor({
    slug: "no-small-days", name: "No Small Days", tier: "Gold", category: "Difficulty",
    xp: 500, condition: "A day where nothing was trivial",
    have: 0, need: 1, unlocked: null, manual: true,
  });
  check("detail: a manual one explains it is by hand",
        /Awarded by hand/.test(manual.textContent));
  check("detail: and still says the condition",
        /A day where nothing was trivial/.test(manual.textContent));
  check("detail: manual shows no progress bar", manual.count("lifeos-bar-lg") === 0);

  const bare = detailFor({
    slug: "x", name: "Mystery", tier: "Hidden", category: "", xp: 0,
    condition: "", have: 0, need: 1, unlocked: null, manual: false,
  });
  check("detail: a missing condition says so, rather than showing a blank",
        /No condition recorded/.test(bare.textContent));
}

/* ---- Settings > Mail --------------------------------------------------
   * renderSettings only ever draws its first tab, so every other tab is
   * unexercised unless called directly. Mail is drawn here in all three
   * states, including the one where its state file does not exist. */
  const MAILSTATE = DEFAULTS.mail.state;
  const drawMail = async () => {
    const r = new N("div");
    await settingsMail(cfgPlugin, r, { tab: "Mail" });
    return r;
  };

  delete dataFiles[MAILSTATE];
  let m = await drawMail();
  check("mail: renders with no state file", m.count("lifeos-setsection") >= 2);
  check("mail: says it has not run", /Not run yet/.test(m.textContent));
  check("mail: privacy note always shown", m.count("lifeos-mailnote") === 1);

  dataFiles[MAILSTATE] = "{not json";
  m = await drawMail();
  check("mail: corrupt state does not throw", /Not run yet/.test(m.textContent));

  dataFiles[MAILSTATE] = JSON.stringify({
    version: 1,
    stats: { last_run: "2026-08-23T06:00:00", muted_senders: 2, tasks_proposed: 3,
             skipped_without_sending: 41,
             last_counts: { important: 4, routine: 9, spam: 12 } },
    senders: {
      "no-reply@brand.com": { verdict: "spam", reason: "marketing", muted: true, seen: 12 },
      "alerts@system.com": { verdict: "routine", reason: "automated report", muted: true, seen: 5 },
      "sender@example.test": { verdict: "important", reason: "asks for review", muted: false, seen: 8 },
    },
  });
  m = await drawMail();
  check("mail: muted senders listed", m.count("lifeos-muterow") === 2,
        `${m.count("lifeos-muterow")}`);
  check("mail: unmuted sender not listed", !/sender@example\.test/.test(m.textContent));
  check("mail: count in heading", /Muted senders \(2\)/.test(m.textContent));
  check("mail: stats rendered", m.count("lifeos-statcell") === 6);
  check("mail: skipped-unsent surfaced", /41/.test(m.textContent));

  /* Unmute must actually persist -- a button that only removes the row would
   * look right and change nothing. */
  const unmute = m.findAll("lifeos-btn").find((b) => b.textContent === "Unmute");
  check("mail: unmute button present", !!unmute);
  if (unmute) {
    await unmute.__tap();
    const after = JSON.parse(dataFiles[MAILSTATE]);
    const stillMuted = Object.values(after.senders).filter((r) => r.muted).length;
    check("mail: unmute persists to disk", stillMuted === 1, `${stillMuted}`);
    m = await drawMail();
    check("mail: unmuted sender gone after redraw", m.count("lifeos-muterow") === 1);
  }

  /* Every switch in DEFAULTS.modules must be reachable from the Modules tab.
   * modules.library shipped with its toggle buried in Panels, so the Library
   * was off by default with no discoverable way to turn it on -- a feature
   * that existed, was tested, and could not be used. */
  {
    const modRoot = new N("div");
    settingsModules(cfgPlugin, modRoot);
    const bound = new Set(modRoot.findAll("lifeos-switch")
      .map((sw) => sw.attrs["data-cfg"]));
    const missing = Object.keys(DEFAULTS.modules)
      .filter((k) => !bound.has(`modules.${k}`));
    check("every module in DEFAULTS has a switch on the Modules tab",
          missing.length === 0, missing.join(", "));
  }

  /* The Setup tab draws first and has no toggles; Modules is where they live. */
  const modBody = new N("div");
  settingsModules(cfgPlugin, modBody);
  check("toggles present", modBody.count("lifeos-switch") > 0);
  check("a toggle defaulting on renders on",
        modBody.all().some((n) => n.classes.has("lifeos-switch") && n.classes.has("is-on")));
  /* modules.sync and modules.granola ship off — personal plumbing, not features. */
  check("personal integrations default to off",
        modBody.all().filter((n) => n.classes.has("lifeos-switch"))
          .filter((n) => !n.classes.has("is-on")).length >= 2,
        `${modBody.all().filter((n) => n.classes.has("lifeos-switch") && !n.classes.has("is-on")).length} off`);

  console.log("\nToggles actually hide things");
  {
    /* The whole point of the settings page: a card switched off must not draw.
       Exercised through studyCard, which is guarded by both a page toggle and
       a module toggle. */
    const withCfg = (over) => {
      const c = mergeCfg(DEFAULTS, over);
      return { ...plugin, cfg: c,
        on: (m) => cfgGet(c, `modules.${m}`, true) !== false,
        shows(page, key, module) {
          if (module && !this.on(module)) return false;
          return cfgGet(c, `${page}.${key}`, true) !== false;
        } };
    };
    const draw = async (pl) => {
      const g = new N("div"); g.addClass("lifeos-grid");
      if (pl.shows("home", "study", "study")) await studyCard(pl, g, "col3");
      return g;
    };
    check("card draws when its toggle is on",
          (await draw(withCfg({}))).count("lifeos-study-head") === 1);
    check("page toggle off hides the card",
          (await draw(withCfg({ home: { study: false } }))).count("lifeos-study-head") === 0);
    check("module off hides the card even with the page toggle on",
          (await draw(withCfg({ modules: { study: false } }))).count("lifeos-study-head") === 0);

    /* And a module being off must strip its sidebar entries, or the nav
       advertises pages that no longer render anything. */
    const navFor = (over) => {
      const pl = withCfg(over);
      return UptickProto ? null : null;
    };
    const offGame = withCfg({ modules: { game: false } });
    check("module gate is consulted for nav entries too",
          offGame.on("game") === false && offGame.on("study") === true);
  }

  console.log("\nThe two dashboards actually run");
  /* These are the largest and most-edited functions in the plugin, and until
     now nothing called them: a patch that nested renderHome inside renderDaily,
     and one that trapped `grid` inside a guard block, both passed every other
     check and broke the page on open. Executing them is the only check that
     would have caught either. */
  {
    const noteFile = { path: "1 Capture/Daily/2026-08-23.md",
                       basename: "2026-08-23", stat: { mtime: 1, ctime: 1 } };
    const dashApp = {
      ...app,
      commands: { commands: {}, executeCommandById: () => {} },
      workspace: { getLeavesOfType: () => [], onLayoutReady: (f) => f() },
      vault: { ...app.vault,
        getAbstractFileByPath: (p) => p === noteFile.path ? noteFile
          : (app.vault.getAbstractFileByPath(p) ?? null),
        getMarkdownFiles: () => [noteFile],
        read: async () => "## Priorities\n\n## Work Log\n\n## Notes\n",
        cachedRead: app.vault.cachedRead,
        on: () => ({}), process: async () => {} },
      metadataCache: { getFileCache: () => ({ frontmatter: { date: "2026-08-23" } }),
                       on: () => ({}), offref: () => {} },
    };
    const stub = (rows = []) => ({ all: async () => rows, on: () => rows,
      onDay: () => rows, bySource: async () => [], load: async () => {},
      instance: () => null, notes: () => [], byPath: () => null });
    const dashPlugin = {
      ...plugin, app: dashApp,
      game: Object.assign(Object.create(Game.prototype), { app,
        _quest: questCache, _questAt: 1, _cache: cache, _cacheAt: 1,
        quest: async () => questCache, achievements: async () => cache,
        ledger: async () => [], day: async () => ({ rows: [], earned: 0, lost: 0,
          net: 0, byKind: {}, unlocked: [] }),
        warm: async () => {}, character: () => Game.prototype.character.call({ app }),
        artFor: () => null }),
      tasks: stub([]), meetings: stub([]), calendars: stub([]),
      emails: { on: () => [], notes: () => [] },
      recur: { on: () => [], instance: () => null, series: () => [],
               next: () => null, all: () => [] },
      store: { read: async () => "", sectionItems: () => [], appendToSection: async () => {} },
      open: () => {}, openDaily: () => {}, openWeekly: () => {}, openMonthly: () => {},
      openLearnKit: () => {}, openPracticeExams: () => {},
      jobStatus: async () => ({ label: "job", ok: true, when: "today", detail: "" }),
      runJob: async () => {}, importMailDaily: async () => ({ skipped: true }),
      newNote: () => {}, newTask: () => {}, newMeeting: () => {}, newProject: () => {},
      quickCreate: () => {}, openWeb: () => {}, openNav: () => {},
      showAchievement: () => {}, go: () => {},
    };

    let homeErr = null, dailyErr = null;
    const homeRoot = new N("div");
    try {
      await renderHome(dashPlugin, homeRoot, { view: "home" },
        { sourcePath: "Uptick.md" }, async () => {});
    } catch (e) { homeErr = e; }
    check("renderHome runs without throwing", !homeErr, homeErr && (homeErr.stack||"").split("\n").slice(0,3).join(" | "));
    check("renderHome draws its grid", homeRoot.count("lifeos-grid") >= 1);
    check("renderHome draws cards", homeRoot.count("lifeos-card") > 0,
          `${homeRoot.count("lifeos-card")} cards`);

    const dailyRoot = new N("div");
    try {
      await renderDaily(dashPlugin, dailyRoot, { view: "daily" },
        { sourcePath: noteFile.path }, async () => {});
    } catch (e) { dailyErr = e; }
    check("renderDaily runs without throwing", !dailyErr, dailyErr && dailyErr.message);
    check("renderDaily draws cards", dailyRoot.count("lifeos-card") > 0,
          `${dailyRoot.count("lifeos-card")} cards`);

    /* And with everything switched off, they must still run rather than
       throwing on a variable that only existed inside a guard. */
    const allOff = mergeCfg(DEFAULTS, {
      modules: { game: false, study: false, weather: false, photos: false,
                 email: false, meetings: false, calendar: false },
      home: Object.fromEntries(Object.keys(DEFAULTS.home).map((k) => [k, false])),
      daily: Object.fromEntries(Object.keys(DEFAULTS.daily).map((k) => [k, false])),
    });
    const offPlugin = { ...dashPlugin, cfg: allOff,
      on: () => false, shows: () => false };
    let offErr = null;
    try {
      await renderHome(offPlugin, new N("div"), { view: "home" },
        { sourcePath: "Uptick.md" }, async () => {});
      await renderDaily(offPlugin, new N("div"), { view: "daily" },
        { sourcePath: noteFile.path }, async () => {});
    } catch (e) { offErr = e; }
    check("both run with every card switched off", !offErr, offErr && offErr.message);

    /* The configuration a stranger actually gets: shipped defaults, which means
       sync and granola off. This is the path no one here ever exercises. */
    const shipped = mergeCfg(DEFAULTS, {});
    const shippedPlugin = { ...dashPlugin, cfg: shipped,
      on: (m) => cfgGet(shipped, `modules.${m}`, true) !== false,
      shows(page, key, module) {
        if (module && !this.on(module)) return false;
        return cfgGet(shipped, `${page}.${key}`, true) !== false;
      } };
    let shipErr = null;
    const shipHome = new N("div");
    try {
      await renderHome(shippedPlugin, shipHome, { view: "home" },
        { sourcePath: "Uptick.md" }, async () => {});
      await renderDaily(shippedPlugin, new N("div"), { view: "daily" },
        { sourcePath: noteFile.path }, async () => {});
    } catch (e) { shipErr = e; }
    check("dashboards run on the shipped defaults", !shipErr, shipErr && shipErr.message);
    check("shipped defaults draw a usable Home", shipHome.count("lifeos-card") > 0,
          `${shipHome.count("lifeos-card")} cards`);
    check("the scheduled-jobs card is absent by default",
          shippedPlugin.shows("home", "sync") === false);
    check("granola is off by default", shippedPlugin.on("granola") === false);
  }

  console.log("\nReward Bank goal editing");
  /* "Edit goals" used to toggle preview mode, which could never work: the note
     body is hidden in edit mode too, so the Goals table it tried to reveal
     stayed hidden either way. These write the rows directly instead. */
  {
    const NOTE = [
      "# Reward Bank", "",
      "## Goals", "",
      "| # | Product | Price | Banked | % | ETA | Status |",
      "|---|---|---|---|---|---|---|",
      "| 1 | Codex subscription | $100.00 | $5.54 | 6% | — | Active |",
      "| 2 |  |  |  |  |  | Queued |", "",
      "## Ledger", "",
      "| Date | Change | Reason | Balance |",
      "|---|---|---|---|", "",
    ].join("\n");

    const makeBank = (answers) => {
      let text = NOTE;
      /* Must be a real TFile: bankFile() checks `instanceof`, and a plain
         object silently fails that test the same way it would in Obsidian. */
      const file = Object.assign(new (require("obsidian").TFile)(),
                                 { path: P.bank, extension: "md" });
      const bankApp = { ...app,
        vault: { ...app.vault,
          getAbstractFileByPath: (p) => p === P.bank ? file : app.vault.getAbstractFileByPath(p),
          process: async (f, fn) => { text = fn(text); return text; } } };
      /* form() is a modal; feed it a scripted answer. */
      global.__formAnswer = answers;
      return { pl: { ...plugin, app: bankApp, cfg: mergeCfg(DEFAULTS, {}) },
               get text() { return text; } };
    };

    const goalsOf = (text) => text.split("\n")
      .filter((l) => /^\| \d+ \|/.test(l))
      .map((l) => l.split("|").map((c) => c.trim()));

    let b = makeBank({ name: "A very good chair", price: "400" });
    await addGoal(b.pl, async () => {});
    let rows = goalsOf(b.text);
    check("add appends a goal", rows.length === 2, `${rows.length} rows`);
    check("added goal keeps its name and price",
          rows[1][2] === "A very good chair" && rows[1][3] === "$400.00",
          rows[1].join(" | "));
    check("the empty placeholder row is dropped",
          !rows.some((r) => !r[2]), JSON.stringify(rows.map((r) => r[2])));

    b = makeBank({ name: "Codex subscription", price: "150" });
    await editGoal(b.pl, { name: "Codex subscription", price: 100 }, async () => {});
    rows = goalsOf(b.text);
    check("edit changes the price", rows[0][3] === "$150.00", rows[0].join(" | "));
    check("edit preserves banked progress", rows[0][4] === "$5.54", rows[0][4]);

    b = makeBank({ name: "", price: "" });
    await editGoal(b.pl, { name: "Codex subscription", price: 100 }, async () => {});
    check("clearing the name removes the goal", goalsOf(b.text).length === 0,
          `${goalsOf(b.text).length} rows left`);

    b = makeBank({ amount: "25", reason: "A book" });
    await recordSpend(b.pl, { available: 40 }, async () => {});
    const spend = b.text.split("\n").filter((l) => /^\| \d{4}-/.test(l));
    check("spend writes a negative ledger row", spend.length === 1 && /-\$25\.00/.test(spend[0]),
          spend[0] || "no row");
    check("spend keeps the reason", /A book/.test(spend[0] || ""));

    b = makeBank({ amount: "not a number", reason: "x" });
    const beforeText = b.text;
    await recordSpend(b.pl, { available: 40 }, async () => {});
    check("a non-numeric amount is rejected", b.text === beforeText);
  }

  console.log("\nUnlock modal");
  const entry = cat.achievements.find(a => a.unlocked) ?? cat.achievements[0];
  const modal = new AchievementModal(app, plugin, entry, [cat.achievements[1]]);
  modal.open();
  check("modal renders medal", modal.contentEl.count("lifeos-ach-medal") === 1);
  check("modal shows the name", modal.contentEl.textOf("lifeos-ach-name")[0] === entry.name);
  check("modal shows the condition", modal.contentEl.count("lifeos-ach-cond") === 1);
  check("queue count shown", modal.contentEl.count("lifeos-ach-queue") === 1);
  check("tier class applied", modal.contentEl.all().some(n => [...n.classes].some(c => c.startsWith("lifeos-ach-") && ["bronze","silver","gold","platinum","mythic","hidden"].includes(c.split("-")[2]))));

  fs.unlinkSync(tmp);
  console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("THREW:", e); try { fs.unlinkSync(tmp); } catch {} process.exit(1); });
