/* Clean-install test.
 *
 * Creates a genuinely empty vault, copies in the three files a release ships,
 * and runs the real `runSetup` through a vault adapter that behaves like
 * Obsidian's — in particular, `createFolder` does NOT create intermediate
 * folders. That last detail is the whole point: a more forgiving mock hid a
 * bug where setup created nothing at all in an empty vault, because every
 * folder in the list has a parent that is not.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "../..");
let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-clean-")) + "/Vault";
fs.mkdirSync(path.join(VAULT, ".obsidian/plugins/life-os"), { recursive: true });
const RELEASE = ["main.js", "styles.css", "manifest.json", "art-bundle.json"];
for (const f of RELEASE) {
  fs.copyFileSync(path.join(REPO, f), path.join(VAULT, ".obsidian/plugins/life-os", f));
}

const MAIN = path.join(VAULT, ".obsidian/plugins/life-os/main.js");
const tmp = path.join(__dirname, "_clean_install_under_test.js");
/* Everything runSetup reaches for. Listed once, exported once, injected once:
 * the previous version named them in three places, so adding a scaffold to
 * Setup broke the test with "not defined" rather than telling you anything. */
const NEEDS = ["homeScaffold", "taskInboxScaffold", "settingsScaffold",
               "achievementsScaffold", "bankScaffold", "Engine", "moment", "installArt",
               "P", "cfgGet"];
fs.writeFileSync(tmp, fs.readFileSync(MAIN, "utf8") +
  `\n;module.exports.__t={DEFAULTS,mergeCfg,applyPaths,${NEEDS.join(",")}};\n`);
global.window = { setTimeout: () => 0, clearTimeout() {}, dispatchEvent() {} };
const mod = require(tmp);
const { DEFAULTS, mergeCfg, cfgGet, applyPaths, P } = mod.__t;

/* Lift the real runSetup off the class. */
const src = fs.readFileSync(MAIN, "utf8");
const SIG = "  async runSetup(opts = {}) {";
const at = src.indexOf(SIG);
if (at < 0) throw new Error("runSetup not found");
const bodyStart = at + SIG.length - 1;
let depth = 0, end = -1;
for (let i = bodyStart; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") { depth--; if (!depth) { end = i + 1; break; } }
}
const runSetup = new Function(...NEEDS,
  `return (async function runSetup(opts = {}) ${src.slice(bodyStart, end)});`
)(...NEEDS.map((n) => mod.__t[n]));

(async () => {
  console.log("Release contents");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(VAULT, ".obsidian/plugins/life-os/manifest.json"), "utf8"));
  check("manifest declares an id", manifest.id === "life-os");
  check("manifest has a version", !!manifest.version, manifest.version);
  check("the art bundle ships too",
        fs.existsSync(path.join(VAULT, ".obsidian/plugins/life-os/art-bundle.json")));
  check("all three required files present",
        ["main.js", "styles.css", "manifest.json"].every((f) =>
          fs.existsSync(path.join(VAULT, ".obsidian/plugins/life-os", f))));

  console.log("\nSetup on an empty vault");
  const cfg = mergeCfg(DEFAULTS, {});
  applyPaths(cfg);
  const vault = {
    getAbstractFileByPath: (p) =>
      fs.existsSync(path.join(VAULT, p)) ? { path: p } : null,
    adapter: {
      read: async (p) => fs.readFileSync(path.join(VAULT, p), "utf8"),
      writeBinary: async (p, buf) =>
        fs.writeFileSync(path.join(VAULT, p), Buffer.from(buf)),
    },
    /* Deliberately NOT recursive — this is what Obsidian does. */
    createFolder: async (p) => { fs.mkdirSync(path.join(VAULT, p)); },
    create: async (p, body) => {
      fs.writeFileSync(path.join(VAULT, p), body);
      return { path: p };
    },
  };
  const plugin = { cfg, app: { vault }, on: () => true, open: async () => {},
                   manifest: { dir: ".obsidian/plugins/life-os" } };
  const made = await runSetup.call(plugin, { open: false });

  check("creates folders", made.folders.length > 5, `${made.folders.length}`);
  check("creates notes", made.notes.length >= 2, `${made.notes.length}`);
  check("Home note exists", fs.existsSync(path.join(VAULT, "Uptick.md")));
  check("Home note carries the dashboard view",
        /view: home/.test(fs.readFileSync(path.join(VAULT, "Uptick.md"), "utf8")));
  check("task inbox exists",
        fs.existsSync(path.join(VAULT, "2 Work/Tasks/Task Inbox.md")));
  check("nested folders were created",
        fs.existsSync(path.join(VAULT, "1 Capture/Daily")));

  console.log("\nSecond run changes nothing");
  const again = await runSetup.call(plugin, { open: false });
  check("idempotent", again.folders.length === 0 && again.notes.length === 0,
        `${again.folders.length} folders, ${again.notes.length} notes`);

  fs.unlinkSync(tmp);
  /* Artwork used to be a separate 78MB download a new install had no way to
   * know about, so the Achievements page looked unfinished until someone found
   * it. The icons now ship beside main.js and Setup writes them in. */
  check("setup reports the icons it wrote", made.icons > 200, `${made.icons}`);
  check("the icons are really in the vault",
        fs.existsSync(path.join(VAULT, "4 System/Game/Achievement Art/first-blood.png")));
  const iconBytes = fs.statSync(
    path.join(VAULT, "4 System/Game/Achievement Art/first-blood.png")).size;
  check("and are real images, not empty files", iconBytes > 2000, `${iconBytes} bytes`);
  check("every catalog slug got one",
        fs.readdirSync(path.join(VAULT, "4 System/Game/Achievement Art"))
          .filter((f) => f.endsWith(".png")).length >= 258);

  /* Every note ANY page links to with a bare open() must exist after Setup.
   *
   * The earlier version of this checked only the walkthrough, so a Kanban link
   * on the task pages -- a working button pointing at a note nothing had made
   * -- shipped and reported "Not found: 2 Work/Tasks/Task List Kanban.md" on
   * every fresh install. A link that may point at nothing has to go through
   * openOrCreate, which makes the note instead of naming it. */
  {
    const bare = [...new Set([...src.matchAll(/(?:plugin|this)\.open\(P\.([a-zA-Z]+)\)/g)]
      .map((m) => m[1]))];
    const dangling = bare.filter((key) => {
      const target = P[key];
      return target && !fs.existsSync(path.join(VAULT, target));
    });
    check("no page opens a note that setup did not create",
          dangling.length === 0,
          dangling.map((k) => `${k} (${P[k]})`).join(", "));
  }

  /* Every note the WALKTHROUGH links to must exist after Setup.
   *
   * Setup created three notes while six were linked, so a fresh vault answered
   * "Not found: 4 System/Game/Achievements.md" to its own navigation. Nothing
   * failed -- the link simply went nowhere, which no test was looking for.
   *
   * Scoped to tourSteps: the views open plenty of notes that are meant to be
   * absent until you make them. */
  const tourSrc = src.slice(src.indexOf("function tourSteps"),
                            src.indexOf("class TourView"));
  const linked = [...new Set([...tourSrc.matchAll(/plugin\.open\(P\.([a-zA-Z]+)\)/g)]
    .map((m) => m[1]))];
  const missing = linked.filter((key) => {
    const target = P[key];
    return target && !fs.existsSync(path.join(VAULT, target));
  });
  check("every note the walkthrough links to exists after setup",
        missing.length === 0, missing.map((k) => `${k} (${P[k]})`).join(", "));
  check("the walkthrough links to several notes", linked.length >= 5,
        `${linked.length}`);

  fs.rmSync(path.dirname(VAULT), { recursive: true, force: true });
  console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error("THREW:", e);
  try { fs.unlinkSync(tmp); } catch {}
  process.exit(1);
});
