/* Fresh-vault setup.
 *
 * The install path for everyone who is not you: an empty vault, no folders,
 * no notes. Until now nothing exercised it, and the sidebar's first link
 * pointed at a note that did not exist. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { N } = require("./domshim.js");

const MAIN = [path.join(__dirname, "../../main.js"),
  path.join(__dirname, "../../../.obsidian/plugins/life-os/main.js")]
  .find((p) => fs.existsSync(p));
const tmp = path.join(__dirname, "_setup_under_test.js");
/* Everything runSetup reaches for, named once. Listing these in three places
 * meant adding a scaffold to Setup failed here with "not defined" instead of
 * saying anything useful. */
const NEEDS = ["homeScaffold", "taskInboxScaffold", "settingsScaffold",
               "achievementsScaffold", "bankScaffold", "Engine", "moment", "installArt",
               "P", "cfgGet"];
fs.writeFileSync(tmp, fs.readFileSync(MAIN, "utf8") +
  "\n;module.exports.__test = { DEFAULTS, mergeCfg, cfgGet, applyPaths, P," +
  ` ${NEEDS.join(",")} };\n`);
global.window = { setTimeout: () => 0, clearTimeout() {}, dispatchEvent() {} };
const mod = require(tmp);
const { DEFAULTS, mergeCfg, cfgGet, applyPaths, P,
        homeScaffold, taskInboxScaffold } = mod.__test;

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

/* An in-memory vault that behaves like Obsidian's: creating a note whose
   parent is missing throws, exactly as it does in the real API. */
function makeVault(existing = []) {
  const files = new Set(existing);
  return {
    files,
    getAbstractFileByPath: (p) => files.has(p) ? { path: p } : null,
    createFolder: async (p) => {
      if (files.has(p)) throw new Error("exists");
      /* Obsidian does not create intermediate folders. Refusing here is what
         makes this mock able to catch a missing-parent bug at all. */
      const parent = p.replace(/\/[^/]+$/, "");
      if (parent !== p && !files.has(parent)) throw new Error("no parent: " + parent);
      files.add(p);
    },
    create: async (p, body) => {
      const parent = p.replace(/\/[^/]+$/, "");
      if (parent !== p && !files.has(parent)) throw new Error("no parent");
      if (files.has(p)) throw new Error("exists");
      files.add(p);
      return { path: p, body };
    },
  };
}

/* The real runSetup, borrowed off the class without constructing a plugin. */
const src = fs.readFileSync(MAIN, "utf8");
const SIG = "  async runSetup(opts = {}) {";
const at = src.indexOf(SIG);
if (at < 0) throw new Error("runSetup not found — did it get renamed?");
/* Start brace-counting at the body's opening brace, not at the `{}` in the
   default parameter, which is what a naive scan finds first. */
const bodyStart = at + SIG.length - 1;
let depth = 0, end = -1;
for (let i = bodyStart; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") { depth--; if (!depth) { end = i + 1; break; } }
}
const runSetup = new Function(...NEEDS,
  `return (async function runSetup(opts = {}) ${src.slice(bodyStart, end)});`
)(...NEEDS.map((n) => mod.__test[n]));

(async () => {
  console.log("Empty vault");
  const cfg = mergeCfg(DEFAULTS, {});
  applyPaths(cfg);
  const vault = makeVault();
  const plugin = { cfg, app: { vault }, on: () => true, open: async () => {} };

  const made = await runSetup.call(plugin, { open: false });
  check("creates folders", made.folders.length > 5, `${made.folders.length}`);
  check("creates parents before children",
        [...vault.files].filter((f) => f.includes("/"))
          .every((f) => vault.files.has(f.replace(/\/[^/]+$/, ""))),
        [...vault.files].find((f) => f.includes("/") && !vault.files.has(f.replace(/\/[^/]+$/, ""))) || "");
  check("creates the top-level folders too", vault.files.has("1 Capture"));
  check("seeds the Home note", vault.files.has(P.home), P.home);
  check("seeds the task inbox", vault.files.has(P.taskInbox), P.taskInbox);
  check("Home note carries the dashboard view",
        /```life-os[\s\S]*view: home/.test(homeScaffold()));
  check("task inbox explains its own format", /#task/.test(taskInboxScaffold()));

  console.log("\nRunning twice is safe");
  const before = vault.files.size;
  const again = await runSetup.call(plugin, { open: false });
  check("creates nothing the second time",
        again.folders.length === 0 && again.notes.length === 0,
        `${again.folders.length} folders, ${again.notes.length} notes`);
  check("nothing removed or duplicated", vault.files.size === before);

  console.log("\nHonours configured paths");
  const custom = mergeCfg(DEFAULTS, {
    paths: { home: "Dashboard.md", daily: "Journal", tasks: "Todo",
             taskInbox: "Todo/Inbox.md", game: "Meta/Game", automation: "Meta/Auto" },
  });
  applyPaths(custom);
  const v2 = makeVault();
  const p2 = { cfg: custom, app: { vault: v2 }, on: () => true, open: async () => {} };
  await runSetup.call(p2, { open: false });
  check("uses the configured Home path", v2.files.has("Dashboard.md"));
  check("uses the configured daily folder", v2.files.has("Journal"));
  check("creates the parent before the note it holds", v2.files.has("Todo/Inbox.md"));
  check("does not create the shipped defaults",
        !v2.files.has("1 Capture/Daily") && !v2.files.has("Uptick.md"));

  applyPaths(null);
  fs.unlinkSync(tmp);
  console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW:", e); try { fs.unlinkSync(tmp); } catch {} process.exit(1); });
