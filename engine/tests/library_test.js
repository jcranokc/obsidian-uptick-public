/* The Library is the only part of Uptick that fetches from the network and
 * writes someone else's files into your vault. These check the guards that
 * make that acceptable: a fixed host, validated paths, size caps, and no way
 * for a hostile registry to reach outside the deck folder. */
const fs = require("fs");
const path = require("path");

const MAIN = [path.join(__dirname, "../../main.js"),
  path.join(__dirname, "../../../.obsidian/plugins/life-os/main.js")]
  .find((p) => fs.existsSync(p));
const tmp = path.join(__dirname, "_library_under_test.js");
fs.writeFileSync(tmp, fs.readFileSync(MAIN, "utf8") +
  "\n;module.exports.__t={Library,libRepoSlug,libSafeFile,libRawUrl,libSafeId," +
  "DEFAULTS,mergeCfg,cfgGet,applyPaths,P,LIB_HOST,LIB_MAX_BYTES," +
  "renderLibrary,ShareDeckModal,licenceText};\n");
global.window = { setTimeout: () => 0, clearTimeout() {}, dispatchEvent() {} };
const { N } = require("./domshim.js");
const mod = require(tmp);
const { Library, libRepoSlug, libSafeFile, libRawUrl, libSafeId,
        DEFAULTS, mergeCfg, cfgGet, applyPaths, LIB_HOST,
        renderLibrary, ShareDeckModal, licenceText } = mod.__t;

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

console.log("Repo URLs — only GitHub is ever contacted");
check("accepts a github repo", libRepoSlug("https://github.com/someone/decks") === "someone/decks");
check("accepts a trailing .git", libRepoSlug("https://github.com/someone/decks.git") === "someone/decks");
for (const bad of ["http://github.com/a/b", "https://evil.com/a/b",
                   "https://github.com.evil.com/a/b", "https://raw.githubusercontent.com/a/b",
                   "file:///etc/passwd", "https://github.com/a", ""]) {
  check(`rejects ${bad || "(empty)"}`, libRepoSlug(bad) === null);
}

console.log("\nFile paths — nothing escapes the deck folder");
check("accepts a markdown path", libSafeFile("decks/a.md") === "decks/a.md");
check("strips a leading ./", libSafeFile("./decks/a.md") === "decks/a.md");
for (const bad of ["../../../etc/passwd", "/etc/hosts", "decks/../../x.md",
                   "a.exe", "a.md.exe", "decks\\a.md", "a<b>.md", ""]) {
  check(`rejects ${JSON.stringify(bad)}`, libSafeFile(bad) === null);
}

console.log("\nFetch URLs are pinned to one host");
const entry = { id: "a-deck", repo: "https://github.com/someone/decks",
                branch: "main", files: ["decks/a.md"], license: "MIT" };
const url = libRawUrl(entry, "decks/a.md");
check("builds a raw.githubusercontent URL", new URL(url).host === LIB_HOST, url);
check("a hostile branch cannot redirect the host",
      new URL(libRawUrl({ ...entry, branch: "../../evil" }, "decks/a.md")).host === LIB_HOST);
check("a hostile repo yields no URL at all",
      libRawUrl({ ...entry, repo: "https://evil.com/x/y" }, "decks/a.md") === null);

console.log("\nDeck ids are folder names, so they are validated");
check("accepts a normal id", libSafeId("salesforce-admin") === "salesforce-admin");
for (const bad of ["../escape", "Has Spaces", "a", "UPPER", "a/b", ""]) {
  check(`rejects ${JSON.stringify(bad)}`, libSafeId(bad) === null);
}

console.log("\nThe module ships off");
const cfg = mergeCfg(DEFAULTS, {});
check("library module defaults to off", cfg.modules.library === false);

console.log("\nInstall plan stays inside the deck folder");
applyPaths(cfg);
const plugin = { cfg, on: () => true, app: { vault: {} } };
const lib = new Library(plugin);
const plan = lib.plan(entry);
check("plans one file", plan.files && plan.files.length === 1);
check("writes under the library folder",
      plan.files[0].to.startsWith(lib.folder + "/a-deck/"), plan.files[0].to);
check("flattens nested paths to a filename",
      plan.files[0].to.endsWith("/a.md"), plan.files[0].to);
const evil = lib.plan({ ...entry, id: "../../escape" });
check("refuses an escaping id", !!evil.error, JSON.stringify(evil));
const noFiles = lib.plan({ ...entry, files: ["../../x.md", "y.exe"] });
check("refuses when no file survives validation", !!noFiles.error, JSON.stringify(noFiles));

console.log("\nA hostile registry is filtered on read");
(async () => {
  const registry = {
    version: 1,
    decks: [
      entry,
      { ...entry, id: "no-licence", license: "" },
      { ...entry, id: "off-host", repo: "https://evil.com/a/b" },
      { ...entry, id: "traversal", files: ["../../../etc/passwd"] },
      { ...entry, id: "too-many", files: Array(50).fill("a.md") },
      { ...entry, id: "Bad Id" },
    ],
  };
  global.__requestUrl = async () => ({ status: 200, text: JSON.stringify(registry) });
  const l2 = new Library({ cfg, on: () => true, app: { vault: {} } });
  const idx = await l2.index({ force: true });
  check("keeps only the valid entry", idx.decks && idx.decks.length === 1,
        JSON.stringify((idx.decks || []).map((d) => d.id)));
  check("reports how many it dropped", idx.skipped === 5, String(idx.skipped));

  /* A registry that is unreachable is an ordinary state, not a crash. */
  global.__requestUrl = async () => ({ status: 404, text: "" });
  const gone = await l2.index({ force: true });
  check("a missing registry reports rather than throws", !!gone.error, JSON.stringify(gone));
  global.__requestUrl = async () => { throw new Error("offline"); };
  const off = await l2.index({ force: true });
  check("being offline reports rather than throws", !!off.error, JSON.stringify(off));

  /* And with the module off, nothing is fetched at all. */
  const offPlugin = new Library({ cfg, on: () => false, app: { vault: {} } });
  let reached = false;
  global.__requestUrl = async () => { reached = true; return { status: 200, text: "{}" }; };
  const disabled = await offPlugin.index({ force: true });
  check("module off means no request is made", !reached && !!disabled.error);

  console.log("\nThe view renders");
  const app = {
    vault: { getAbstractFileByPath: () => null, getMarkdownFiles: () => [],
             createFolder: async () => {}, create: async () => {}, read: async () => "" },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const mkPlugin = (on) => {
    const pl = { app, cfg, on: () => on, open: async () => {}, setCfg: async () => {} };
    pl.library = new Library(pl);
    return pl;
  };

  global.__requestUrl = async () => ({ status: 200, text: JSON.stringify({ decks: [entry] }) });
  const onRoot = new N("div");
  await renderLibrary(mkPlugin(true), onRoot, { view: "library" },
    { sourcePath: "Library.md" }, async () => {});
  check("renders a card per deck", onRoot.count("lifeos-libcard") === 1);
  check("shows the licence on the card", onRoot.count("lifeos-libcard-licence") === 1);
  check("offers a way to share", onRoot.all().some((n) => n.text === "Share a deck"));

  /* With the module off it must explain itself rather than look broken, and
     must not fetch. */
  let touched = false;
  global.__requestUrl = async () => { touched = true; return { status: 200, text: "{}" }; };
  const offRoot = new N("div");
  await renderLibrary(mkPlugin(false), offRoot, { view: "library" },
    { sourcePath: "Library.md" }, async () => {});
  check("explains itself when off", offRoot.count("lifeos-liboff") === 1);
  check("makes no request when off", !touched);

  console.log("\nLicence files are real");
  for (const id of ["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "MIT"]) {
    const text = licenceText(id, "someone");
    check(`${id} names itself and links the terms`,
          text.length > 100 && /https?:\/\//.test(text) && text.includes("someone"));
  }

  fs.unlinkSync(tmp);
  console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW:", e); try { fs.unlinkSync(tmp); } catch {} process.exit(1); });
