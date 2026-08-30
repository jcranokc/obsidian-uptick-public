/* Structural checks on main.js.
 *
 * The render suite exercises functions it can call, but it never called
 * renderHome or renderDaily — so when a patch nested renderHome inside
 * renderDaily, 93 checks still passed and the Home page threw
 * "renderHome is not defined" on open. These checks read the file itself. */
const fs = require("fs");
const path = require("path");
/* Works from either layout: the repo (main.js two levels up) or a vault
   checkout (inside .obsidian/plugins/life-os). */
const CANDIDATES = [
  path.join(__dirname, "../../main.js"),
  path.join(__dirname, "../../../.obsidian/plugins/life-os/main.js"),
];
const MAIN = CANDIDATES.find((p) => fs.existsSync(p));
if (!MAIN) throw new Error("could not find main.js next to the tests");
const src = fs.readFileSync(MAIN, "utf8");
const lines = src.split("\n");

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const topLevel = new Set(
  lines.map((l) => /^(?:async )?function ([A-Za-z_$][\w$]*)/.exec(l))
       .filter(Boolean).map((m) => m[1]));

console.log("Top-level functions");
for (const fn of ["renderHome", "renderDaily", "renderWeekly", "renderMonthly",
                  "renderMeeting", "renderQuest", "renderCharacter", "renderLedger",
                  "renderExams", "renderBank", "renderAchievements", "renderSettings",
                  "greeting", "humanNotes", "authoredOn", "xpHero", "studyCard",
                  "dayXpCard", "applyPaths", "mergeCfg", "cfgGet", "cfgSet"]) {
  check(`${fn} is top-level`, topLevel.has(fn));
}

console.log("\nEvery dispatched view has a renderer");
const dispatched = [...src.matchAll(/case "([a-z-]+)":\s*\n\s*return await (render\w+)\(/g)];
check("dispatch table is non-empty", dispatched.length >= 10, `${dispatched.length}`);
for (const [, view, fn] of dispatched) {
  check(`view "${view}" -> ${fn}`, topLevel.has(fn));
}

console.log("\nNothing personal, nothing unguarded");
/* These are the checks that keep the file publishable. */
/* The registry URL legitimately names the project's own repo — that is the
   canonical index, not a leak. Everything else is. */
const PROJECT_URLS = [
  "https://raw.githubusercontent.com/jcranokc/obsidian-uptick-library/",
  "https://github.com/jcranokc/obsidian-uptick-public",
];
const REGISTRY = PROJECT_URLS[0];
let withoutRegistry = src;
for (const u of PROJECT_URLS) withoutRegistry = withoutRegistry.split(u).join("");
const personal = [...withoutRegistry.matchAll(/\b[A-Z][A-Za-z]+Automation\b|\bcom\.[a-z]+(?:\.[a-z]+)+\b/g)];
check("no user-specific automation identifiers beyond the registry URL", personal.length === 0,
      personal.slice(0, 3).map((m) => m[0]).join(", "));
check("the registry default points at the project index",
      src.includes(REGISTRY));

/* The network surface has to stay small and nameable.
 *
 * It was one class -- the Library. Weather is now a second: setting a location
 * used to do nothing because only a Python script read it, and a dashboard
 * that cannot fetch its own forecast is not honest about being configurable.
 * Both are off unless you turn them on and both are named here, so a third
 * caller appearing is a finding rather than a drift. */
const netCalls = [...src.matchAll(/requestUrl\(/g)];
check("network calls are few and deliberate", netCalls.length <= 5, `${netCalls.length}`);

const SPANS = [
  ["class Library", src.indexOf("class Library {"),
   src.indexOf("\n}", src.indexOf("async install(entry)"))],
  ["fetchWeather", src.indexOf("async fetchWeather()"),
   src.indexOf("\n  }", src.indexOf("async fetchWeather()"))],
];
for (const [name, a, b] of SPANS) {
  check(`${name} is present to hold network calls`, a > 0 && b > a, `${a}-${b}`);
}
const stray = netCalls.filter((m) =>
  !SPANS.some(([, a, b]) => m.index > a && m.index < b));
check("every network call is inside Library or fetchWeather",
      stray.length === 0,
      stray.map((m) => src.slice(Math.max(0, m.index - 60), m.index + 20)
        .split("\n").pop()).join(" | "));

/* Whatever the weather call does, it must not put the key somewhere a user
 * can read it back -- a Notice, the console, or an error message. */
{
  const [, a, b] = SPANS[1];
  const body = src.slice(a, b);
  check("the weather key never reaches a Notice or the console",
        !/new Notice\([^)]*key/i.test(body) && !/console\.[a-z]+\([^)]*key/i.test(body));
  check("and the URL is never surfaced on failure",
        !/(Notice|Error)\([^)]*\$\{url\}/.test(body));
}

/* child_process may exist (this is not going through plugin review) but every
 * use must sit behind the sync module, or an outside install shells out by
 * default. */
const cpUses = [...src.matchAll(/require\("child_process"\)/g)];
check("child_process is used only where expected", cpUses.length <= 4, `${cpUses.length} uses`);
for (const m of cpUses) {
  const before = src.slice(Math.max(0, m.index - 900), m.index);
  check(`a child_process use at ${m.index} is gated by modules.sync`,
        /this\.on\("sync"\)/.test(before) || /runReminderBridge/.test(before));
}
check("sync module ships off", /sync: false/.test(src));
check("granola module ships off", /granola: false/.test(src));
check("sync jobs ship empty", /jobs: \[\]/.test(src));

console.log("\nBrace balance");
let depth = 0, min = 0;
for (const ch of src) {
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth < min) min = depth; }
}
check("file closes every block", depth === 0, `depth ${depth}`);
check("never closes more than it opens", min === 0, `min ${min}`);

console.log("\nNo renderer is nested inside another");
const nested = lines.filter((l) => /^\s+(?:async )?function render[A-Z]/.test(l));
check("no indented render function", nested.length === 0,
      nested.map((l) => l.trim().slice(0, 50)).join(" | "));

/* A "${...}" placeholder inside a STATIC import is not interpolated -- it is a
 * literal path that cannot resolve, and the script dies at load naming the
 * placeholder. A scrub introduced exactly that, and it stayed broken until the
 * script was actually run. Dynamic import() is fine; a static one is not. */
{
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "../../optional");
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith(".mjs") && !f.endsWith(".js")) continue;
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    const bad = body.split("\n").filter((l) =>
      /^\s*import\s[^(]*from\s*["'][^"']*\$\{/.test(l));
    check(`${f}: no placeholder inside a static import`, bad.length === 0,
          bad[0] || "");
  }
}

/* main.js carries an inlined copy of the engine, because Obsidian loads it as
 * a single file. A copy that has drifted from its source is worse than no copy:
 * every parity test would still pass against the source while the plugin ran
 * something else. */
{
  const fs = require("fs"), path = require("path");
  const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  const enginePath = path.join(__dirname, "../uptick-engine.js");
  const engine = fs.readFileSync(enginePath, "utf8");
  const BEGIN = "/* ===================== BEGIN uptick-engine.js ===================== */";
  const END = "/* ====================== END uptick-engine.js ====================== */";
  check("main.js carries the inlined engine",
        main.includes(BEGIN) && main.includes(END));
  if (main.includes(BEGIN) && main.includes(END)) {
    const inlined = main.slice(main.indexOf(BEGIN), main.indexOf(END));
    const cut = engine.indexOf("\nmodule.exports = {");
    const source = engine.slice(0, cut).replace('"use strict";\n', "");
    /* Compare the function bodies, not the wrapper the tool adds. */
    const norm = (t) => t.replace(/\s+/g, " ").trim();
    const missing = source.split("\nfunction ")
      .slice(1)
      .map((chunk) => "function " + chunk.split("\n")[0])
      .filter((sig) => !norm(inlined).includes(norm(sig)));
    check("inlined engine is in step with engine/uptick-engine.js",
          missing.length === 0,
          missing.slice(0, 3).join(" | "));
  }
  check("the engine is wrapped, not dropped into the global scope",
        main.includes("const Engine = (function () {"));
}

/* recalculate() has to write everything a view reads, or the view is blank.
 * The Quest Log renders from quest-cache.json rather than from its own note,
 * so a sync that wrote the note and not the cache left the page empty while
 * every test passed. */
{
  const fs = require("fs"), path = require("path");
  const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  const body = main.slice(main.indexOf("async recalculate()"));
  const fn = body.slice(0, body.indexOf("\n  /* Create or replace"));
  for (const target of ["P.ledger", "P.character", "P.quest", "P.achCache",
                        "P.questCache", "P.xpState"]) {
    check(`recalculate writes ${target}`, fn.includes(target), "");
  }
  check("recalculate reads the bank note before rewriting it",
        fn.indexOf("bankNote: await read(P.bank)") < fn.indexOf("result.writes.bankNote"));
}

/* manifest.version sat at 0.2.0 through the 0.3.0 and 0.4.0 releases, so the
 * plugin reported itself as 0.2.0 forever and Obsidian could never see an
 * update. versions.json had one stale entry, so it also had no idea what any
 * later version required. */
{
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "../..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
  check("versions.json lists the current manifest version",
        Object.prototype.hasOwnProperty.call(versions, manifest.version),
        `manifest ${manifest.version}, versions.json has ${Object.keys(versions).join(", ")}`);
  check("every listed version names a minimum Obsidian",
        Object.values(versions).every((v) => /^\d+\.\d+\.\d+$/.test(v)));
  check("the manifest is the highest version listed",
        Object.keys(versions).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true })).at(-1) === manifest.version,
        manifest.version);
}

/* The dashboards were only full-width because the author's vault used the
 * Minimal theme (which styles `cssclasses: max`) and a CSS snippet that lived
 * nowhere else. A fresh install rendered every one of them in a narrow column
 * with nothing in the plugin to explain why. The plugin owns its width now. */
{
  const fs = require("fs"), path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "../../styles.css"), "utf8");
  check("styles.css overrides the readable-line-length cap",
        /\.life-os[^{]*markdown-preview-sizer[\s\S]{0,200}max-width:\s*none/.test(css));
  check("and does so in edit mode too",
        /mod-cssclass-life-os[\s\S]{0,200}max-width:\s*none/.test(css));
  check("styles.css defines its own palette rather than borrowing a theme's",
        (css.match(/^\s*--los-[a-z0-9-]+\s*:/gm) || []).length >= 10);
}

console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
process.exit(fails ? 1 : 0);
