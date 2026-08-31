/* The guided walkthrough.
 *
 * A tour that describes a feature the reader has switched off, or whose
 * buttons throw, is worse than none — so these check that steps adapt to the
 * configuration and that every action is actually callable. */
const fs = require("fs");
const path = require("path");
const { N } = require("./domshim.js");

const MAIN = [path.join(__dirname, "../../main.js"),
  path.join(__dirname, "../../../.obsidian/plugins/life-os/main.js")]
  .find((p) => fs.existsSync(p));
const tmp = path.join(__dirname, "_tour_under_test.js");
fs.writeFileSync(tmp, fs.readFileSync(MAIN, "utf8") +
  "\n;module.exports.__t={tourSteps,TourView,TOUR_VIEW,DEFAULTS,mergeCfg,cfgGet,applyPaths,P};\n");
global.window = { setTimeout: () => 0, clearTimeout() {}, dispatchEvent() {}, open() {} };
const mod = require(tmp);
const { tourSteps, TourView, TOUR_VIEW, DEFAULTS, mergeCfg, cfgGet, applyPaths, P } = mod.__t;

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const mkPlugin = (over = {}) => {
  const cfg = mergeCfg(DEFAULTS, over);
  applyPaths(cfg);
  const calls = [];
  return {
    cfg, calls,
    on: (m) => cfgGet(cfg, `modules.${m}`, true) !== false,
    setCfg: async (k, v) => { const ks = k.split("."); let n = cfg;
      for (const x of ks.slice(0, -1)) n = n[x] ??= {}; n[ks.at(-1)] = v; },
    open: (p) => calls.push(["open", p]),
    openDaily: () => calls.push(["openDaily"]),
    openSettings: (tab) => calls.push(["openSettings", tab]),
    openLearnKit: (w) => calls.push(["openLearnKit", w]),
    openLibrary: () => calls.push(["openLibrary"]),
    openTour: () => calls.push(["openTour"]),
    runSetup: async () => { calls.push(["runSetup"]); return { folders: [], notes: [] }; },
    recalculate: async () => { calls.push(["recalculate"]); return null; },
    app: { vault: { getAbstractFileByPath: () => null } },
  };
};

console.log("Content");
const plugin = mkPlugin();
const steps = tourSteps(plugin);
check("has a reasonable number of steps", steps.length >= 15 && steps.length <= 30,
      `${steps.length}`);
check("every step has a chapter, title and body",
      steps.every((s) => s.chapter && s.title && Array.isArray(s.body) && s.body.length));
check("covers the topics that were asked for",
      ["Welcome", "The daily loop", "Tasks", "Experience", "Study", "Make it yours"]
        .every((c) => steps.some((s) => s.chapter === c)),
      [...new Set(steps.map((s) => s.chapter))].join(", "));
for (const topic of [/difficult/i, /overdue|decay/i, /achievement/i, /Reward Bank/i,
                     /Codex/i, /Mail|mail/, /Messages/, /readiness/i, /Settings/,
                     /Library/, /Python/]) {
  const hit = steps.some((s) => topic.test(s.title + " " + s.body.join(" ")));
  check(`explains ${topic}`, hit);
}

console.log("\nHonesty");
const macSteps = steps.filter((s) => s.mac);
check("macOS-only steps are marked", macSteps.length >= 3, `${macSteps.length}`);
/* These assertions exist to keep the tour honest about what uses a model, and
 * they have to move when that changes. They used to pin "no equivalent for
 * mail" and "pattern-based, not AI"; both were true and both are now false. */
const ai = steps.find((s) => /Connecting a model/i.test(s.title));
check("there is a step on connecting a model", !!ai);
if (ai) {
  const body = ai.body.join(" ");
  check("it names the two features that use one",
        /mail triage/i.test(body) && /meeting import/i.test(body));
  check("it says nothing else does",
        /Nothing else does/i.test(body));
  check("it is explicit that the key never goes in the vault",
        /never stored in the vault/i.test(body) && /syncs/i.test(body));
  check("it says how to check the setup", /llm\.py/.test(body));
  check("it offers more than one provider",
        /Anthropic/i.test(body) && /DeepSeek/i.test(body) && /Ollama/i.test(body));
}
const mail = steps.find((s) => /Mail →/.test(s.title));
check("the mail step no longer claims extraction is pattern-based",
      mail && !/pattern-based, not AI/i.test(mail.body.join(" ")));
check("and explains why phrase matching is not enough",
      mail && /phrase match/i.test(mail.body.join(" ")) &&
        /request aimed at someone else/i.test(mail.body.join(" ")));
/* This used to pin "the XP layer needs Python on a schedule", which was true
 * and is not any more. What has to stay honest is the remaining gap: two
 * things still need it, and the step should say which. */
const recalc = steps.find((s) => /Making it count/i.test(s.title));
check("there is a step on making the numbers update", !!recalc);
if (recalc) {
  const body = recalc.body.join(" ");
  check("it says running twice is safe", /safe to run twice/i.test(body));
  check("it names what still needs Python",
        /Python/.test(body) && /readiness/i.test(body));
  check("it offers to run it", (recalc.actions || []).some((a) => /Recalculate/i.test(a.label)));
}

console.log("\nAdapts to configuration");
const noGame = mkPlugin({ modules: { game: false } });
const viewNoGame = new TourView({ }, noGame);
check("game steps disappear when the module is off",
      viewNoGame.steps().every((s) => s.module !== "game"));
check("the tour still has content without the game layer",
      viewNoGame.steps().length >= 10, `${viewNoGame.steps().length}`);
const noStudy = new TourView({}, mkPlugin({ modules: { study: false } }));
check("study steps disappear too",
      noStudy.steps().every((s) => s.module !== "study"));

console.log("\nEvery action is callable");
(async () => {
  /* Steps carry either one action or several. Driving only the singular form
   * left every multi-destination step untested, which is most of them now. */
  let ran = 0;
  for (const s of steps) {
    const list = s.actions || (s.action ? [s.action] : []);
    for (const a of list) {
      try {
        await a.run();
        ran += 1;
      } catch (e) {
        check(`action "${a.label}" on "${s.title}" runs`, false, e.message);
      }
    }
  }
  check("no action threw", true);
  check("every step's actions were driven", ran >= 20, `${ran} run`);
  check("actions navigate somewhere", plugin.calls.length >= 5,
        `${plugin.calls.length} calls`);

  /* A settings link that names a tab which does not exist silently lands on
   * Setup, which is the wrong page and gives no sign of being wrong. */
  const TABS = ["Setup", "Modules", "Layout", "Panels", "Mail", "Reminders",
                "Experience", "Rewards", "Paths"];
  const bad = [];
  for (const s of steps) {
    if (s.configurable && !TABS.includes(s.configurable)) {
      bad.push(`${s.title} -> ${s.configurable}`);
    }
  }
  check("every 'change this' link names a real settings tab",
        bad.length === 0, bad.join(", "));

  const badTabs = plugin.calls
    .filter((c) => c[0] === "openSettings")
    .map((c) => c[1])
    .filter((t) => t !== undefined && !TABS.includes(t));
  check("every settings action opens a real tab", badTabs.length === 0,
        badTabs.join(", "));

  console.log("\nRendering and progress");
  const p2 = mkPlugin();
  const view = new TourView({ detach() {} }, p2);
  view.contentEl = new N("div");
  view.render();
  check("renders a title", view.contentEl.count("lifeos-tour-title") === 1);
  check("renders a progress bar", view.contentEl.count("lifeos-bar-fill") === 1);
  check("renders chapter jumps", view.contentEl.count("lifeos-tour-jump") >= 5);
  check("first step has no Back", !view.contentEl.all().some((n) => n.text === "Back"));

  await view.go(3);
  check("remembers the step", cfgGet(p2.cfg, "tour.step") === 3);
  view.contentEl = new N("div");
  view.render();
  check("a later step offers Back", view.contentEl.all().some((n) => n.text === "Back"));

  await view.go(9999);
  check("clamps past the end", view.index === view.steps().length - 1);

  fs.unlinkSync(tmp);
  console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW:", e); try { fs.unlinkSync(tmp); } catch {} process.exit(1); });
