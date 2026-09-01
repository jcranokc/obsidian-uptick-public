/* Uptick — dashboard workspace for this vault.
 *
 * Plain CommonJS on purpose: no bundler, no node_modules, no build step. Edit
 * this file and run "Reload app without saving" to see changes.
 *
 * Principles this file must keep to (see AGENTS.md):
 *   - Markdown is the source of truth. Every panel reads from, and writes back
 *     to, real notes. Nothing is stored only in the plugin.
 *   - 2 Work/Tasks/Task Inbox.md is the ONLY task store. Task writes append in
 *     the existing canonical format and never create a parallel copy.
 *   - No network. Everything here is local vault I/O.
 */

const {
  MarkdownRenderChild, Plugin, ItemView, Notice, TFile, Modal, moment,
  requestUrl } = require("obsidian");

const NAV_VIEW = "life-os-nav";
/* ---------------------------------------------------------------- settings */

/* Every configurable value, with the shipped default.
 *
 * This is also the schema: the settings page is generated from it, and
 * xp-sync.py reads the same file, so a rate changed here changes what the
 * engine awards. Paths are settings rather than constants because another
 * vault will not be laid out like this one — that is the single biggest thing
 * standing between this plugin and being installable by anyone else. */
const DEFAULTS = {
  paths: {
    home: "Uptick.md",
    daily: "1 Capture/Daily",
    weekly: "1 Capture/Weekly",
    monthly: "1 Capture/Monthly",
    inbox: "1 Capture/Inbox",
    meetings: "2 Work/Meetings",
    recurring: "2 Work/Meetings/Recurring",
    tasks: "2 Work/Tasks",
    taskInbox: "2 Work/Tasks/Task Inbox.md",
    kanban: "2 Work/Tasks/Task List Kanban.md",
    projects: "2 Work/Projects",
    areas: "2 Work/Areas",
    knowledge: "3 Reference/Knowledge",
    sources: "3 Reference/Sources",
    contacts: "3 Reference/People/Apple Contacts",
    emails: "3 Reference/Sources/Email References",
    game: "4 System/Game",
    logs: "4 System/Logs",
    photos: "4 System/Photo Cache",
    automation: "4 System/Automation",
    studyHub: "3 Reference/Knowledge/LearnKit Study Hub.md",
    guides: "4 System/Guides",
    /* Where a meeting note's verbatim transcript lives, if you keep them. */
    transcripts: "3 Reference/Sources/Granola Transcripts",
  },
  /* Folders whose contents are machine output rather than notes a person
   * wrote. Only used for the "notes created" counts, which were wildly
   * inflated by imported mail, transcripts and RSS. */
  noteCount: {
    exclude: [".obsidian/", "Sources/Messages/", "Sources/Transcripts/",
              "Sources/RSS/", "Sources/Email References/", "Task Inbox"],
  },
  modules: {
    game: true, study: true, weather: true, photos: true,
    email: true, meetings: true, calendar: true,
    /* Off by default. Both shell out to, or assume, tooling that only exists
     * on the machine this was built on. */
    sync: false,
    granola: false,
    /* The only feature that touches the network. Off by default so the
     * "everything is local vault I/O" promise holds unless you opt in. */
    library: false,
  },
  tour: {
    /* Where the walkthrough left off, and whether it has been finished. */
    step: 0,
    done: false,
  },
  library: {
    /* The community index. Point it anywhere you like — it is only a JSON file
     * of pointers, and running your own is a fork away. */
    registry: "https://raw.githubusercontent.com/jcranokc/obsidian-uptick-library/main/library.json",
    /* Where installed decks land, relative to the study folder. */
    folder: "Library",
  },
  sync: {
    /* launchd labels and their log prefixes. Empty by default — these are
     * whatever jobs you happen to run, not something the plugin provides. */
    jobs: [],
  },
  reminders: {
    version: 1,
    enabled: false,
    preset: "custom",
    inboxList: "",
    quickWinsList: "Quick Wins",
    waitingList: "",
    quickWinsFilter: {
      enabled: true,
      durationTags: ["#10min", "#10-minute"],
      includePastDue: true,
      includeCompleted: false,
      excludeLists: ["Waiting", "Repeat"],
    },
    routes: [
      { tag: "#work", list: "Work", listId: "" },
      { tag: "#personal", list: "Personal", listId: "" },
      { tag: "#house", list: "House", listId: "" },
    ],
    categoryInference: {
      enabled: true,
      minMatches: 1,
      cues: {
        "#work": "salesforce, mulesoft, azure, workday, sharepoint, crm, jira, sprint, rollout, release notes, sso, client, integration, trailhead, all hands",
        "#personal": "therapy, counseling, therapist, doctor, nurse, medical, health, prayer, retreat, relationship, couples, family, medication",
        "#house": "grocery, groceries, trash, laundry, dishwasher, dishes, dog, pet, household, home repair, lawn, garden, utilities",
      },
      phoneCues: "self-port cli, codex, email, text, call, message",
      notPhoneCues: "deploy, deployment, install, xcode, in person",
    },
    tags: {
      notStarted: "#not-started",
      inProgress: "#in-progress",
      blocked: "#blocked",
      dependency: "#dependency",
      needsTriage: "#needs-triage",
      duration10: "#10min",
      duration20: "#20min",
      duration30: "#30min",
      onPhone: "#on-phone",
      followUp: "#follow-up",
    },
    priorityMap: { highest: 1, high: 3, medium: 5, low: 8 },
    mail: { enabled: false, shortcutName: "Open Obsidian Task Email" },
    statePath: "4 System/Automation/reminders-sync-state.json",
    conflictResolution: "reminders-wins",
  },
  messagesTaskCapture: {
    enabled: false,
    scanIncoming: true,
    intervalMinutes: 10,
    autoCreate: true,
    localRulesFirst: true,
    modelEnabled: false,
    excludeSystemMessages: true,
    excludedChats: "",
    excludedSenders: "",
    statePath: "4 System/Automation/reminders-sync-state.json",
  },
  workflowAssistant: {
    version: 1,
    enabled: false,
    triage: { enabled: true, cloud: true, requireApproval: true },
    waiting: { enabled: true, followUpTag: "#follow-up", defaultDays: 7 },
    activity: { enabled: true, retention: "permanent" },
    email: { enabled: true, previewRequired: true, parentTasks: true },
    emailCompletion: {
      enabled: false, scanSentMail: true, autoCompleteUnique: true,
      reviewAmbiguous: true, lookbackHours: 48, maxMessagesPerRun: 100,
      explicitPhrases: "completed, done, finished, resolved, handled, taken care of, submitted, sent",
      negativePhrases: "not done, still working, not yet, will complete, plan to complete, need to finish",
    },
    weeklyReview: { enabled: true, guided: true, noteSection: "Uptick workflow review" },
  },
  granola: {
    /* Whose turns in a transcript are "you". Was hardcoded. */
    speakerName: "Me",
  },
  ai: {
    /* Which model the AI features use. The KEY IS NEVER STORED HERE -- this
     * file lives in .obsidian/ and syncs wherever the vault syncs, and a key
     * in a synced folder is a key on every machine and in every backup.
     * `keyEnv` names an environment variable; `keyFile` points at a file
     * outside the vault. */
    provider: "codex",
    model: "",
    baseUrl: "",
    keyEnv: "",
    keyFile: "",
    codexBin: "",
    temperature: 0,
  },
  mail: {
    /* Triage is run by optional/mail-triage.py, not by the plugin. These are
     * the settings that script reads, plus the switch that surfaces its
     * results here. The plugin itself never sends mail anywhere. */
    triage: false,
    ownerAddresses: "",
    state: "4 System/Automation/mail-triage.json",
  },
  home: {
    xp: true, tiles: true, now: true, today: true,
    calendar: true, upcoming: true, capture: true, projects: true,
    recurring: true, email: true, notes: true, areas: true, study: true,
    sync: false, reference: true, web: true,
  },
  daily: {
    xp: true, weather: true, tiles: true, plan: true, priorities: true, photos: true,
    meetings: true, tasks: true, worklog: true, eod: true, experience: true,
    email: true, reference: true,
  },
  photos: {
    intervalSeconds: 12,
    shuffle: true,
    max: 40,
  },
  weather: {
    /* Visual Crossing's free tier. Kept here rather than in an environment
     * variable because Obsidian has no environment to read, and unlike a model
     * key this one is read-only, rate-limited and free -- the stakes of it
     * sitting in a synced settings file are small. It is still yours: Uptick
     * sends it to Visual Crossing and nowhere else. */
    apikey: "",
    location: "",
    units: "imperial",
  },
  game: {
    baseXp: { 1: 10, 2: 25, 3: 50, 4: 100, 5: 200 },
    earlyMultiplier: 1.25,
    lateMultiplier: 0.5,
    priorityBonus: 1.25,
    streakStep: 0.02,
    streakCap: 1.3,
    decayRate: 0.10,
    decayGraceDays: 1,
    maxCatchupDays: 7,
    globalDecayFraction: 0.25,
    freezesPerMonth: 2,
    ritualXp: {
      intentionsEarly: 15, intentions: 10, worklog: 5, eod: 20,
      agenda: 10, weekly: 75, monthly: 200, triaged: 25,
    },
    cardXp: { easy: 3, good: 3, hard: 2, again: 1 },
    noteReviewXp: 5,
    sessionBonusXp: 10,
    cardXpDailyCap: 400,
  },
  bank: {
    enabled: true,
    currency: "$",
    rate: 250,
    levelBonus: 2,
    monthlyCeiling: 100,
  },
  achievements: {
    enabled: true,
    popup: true,
    tierXp: { Bronze: 50, Silver: 150, Gold: 500, Platinum: 1500, Mythic: 5000, Hidden: 0 },
  },
};

/* Deep merge of stored settings over the defaults, so a config written by an
 * older version never loses a key that was added since. */
function mergeCfg(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = (v && typeof v === "object" && !Array.isArray(v) && base?.[k])
      ? mergeCfg(base[k], v) : v;
  }
  return out;
}

/* cfgGet(cfg, "game.baseXp.3") */
function cfgGet(obj, path, fallback) {
  const v = String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  return v === undefined ? fallback : v;
}

function cfgSet(obj, path, value) {
  const keys = String(path).split(".");
  const last = keys.pop();
  let node = obj;
  for (const k of keys) node = (node[k] ??= {});
  node[last] = value;
  return obj;
}





/* Resolved vault paths.
 *
 * Mutable on purpose: `applyPaths` rewrites it from settings on load and
 * whenever they change, so every call site keeps reading `P.taskInbox` and
 * gets whatever the user configured. Derived paths (the game notes, the
 * caches) are composed from the configured folders rather than being set
 * independently — there is no reason to make someone name eight files when
 * naming one folder will do. */
const P = {};

function applyPaths(cfg) {
  const c = mergeCfg(DEFAULTS, cfg || {}).paths;
  Object.assign(P, c, {
    quest: `${c.game}/Quest Log.md`,
    character: `${c.game}/Character.md`,
    ledger: `${c.game}/XP Ledger.md`,
    achievements: `${c.game}/Achievements.md`,
    bank: `${c.game}/Reward Bank.md`,
    achArt: `${c.game}/Achievement Art`,
    certs: `${c.game}/Certifications`,
    settings: `${c.game}/Settings.md`,
    achCache: `${c.automation}/achievements-cache.json`,
    /* The engine's own bookkeeping: the start date, the decay cursor, and how
     * long each blocked task has had its clock stopped. Not a note -- deleting
     * it resets when the system considers itself switched on. */
    xpState: `${c.automation}/xp-state.json`,
    questCache: `${c.automation}/quest-cache.json`,
    calendarCache: `${c.automation}/calendar-cache.json`,
    weatherCache: `${c.automation}/weather-cache.json`,
    weatherPage: `${c.automation.replace(/\/Automation$/, "/Reports")}/Weather.md`,
  });
  return P;
}

applyPaths(null);


/* Web apps opened in Obsidian's Web viewer from the sidebar and header. */
const WEB_APPS = {
  copilot: {
    label: "Copilot",
    url: "https://m365.cloud.microsoft/chat/",
    hint: "Microsoft 365 Copilot",
  },
};

/* Scheduled jobs the Sync card can report on and re-run. Supplied by the user
 * in settings — the plugin ships none, because which jobs exist is entirely a
 * property of the machine it is running on. */
function syncJobs(plugin) {
  const jobs = cfgGet(plugin?.cfg, "sync.jobs", []);
  return Array.isArray(jobs) ? jobs.filter((j) => j && j.label) : [];
}



/* Section headings the daily dashboard reads and writes. Changing these renames
 * the headings in daily notes, so keep them in step with the daily template. */
const DAILY_SECTIONS = {
  plan: "Today Plan",
  priorities: "Priorities",
  focus: "Focus",
  worklog: "Work Log",
  tasks: "Tasks",
  notes: "Notes",
  endOfDay: "End of Day",
};

/* Sub-headings under End of Day. Each collects its own entries. */
const EOD_BUCKETS = ["Completed", "Carry Forward", "Blockers", "Notes for Tomorrow"];

/* ------------------------------------------------------------------ utils */

/* Wait for Obsidian to re-index a file we just wrote.
 *
 * A fixed sleep is not enough: body edits land in the cache quickly, but a
 * frontmatter change can take longer, and a panel that redraws too early shows
 * the old value (attendees reading 0 straight after saving them). Waits for the
 * actual `changed` event, with a timeout so a missed event cannot hang the UI. */
function afterMetadata(app, path, ms = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      app.metadataCache.offref(ref);
      resolve();
    };
    const ref = app.metadataCache.on("changed", (f) => {
      if (f?.path === path) window.setTimeout(finish, 20);
    });
    window.setTimeout(finish, ms);
  });
}

/* Format a time for display as 12-hour.
 *
 * Display only. Series frontmatter keeps `time:` in 24-hour form — it is data,
 * it sorts correctly as a string, and the series editor asks for it that way.
 * Accepts an "HH:mm" string or anything moment can parse; unrecognised input is
 * returned untouched rather than silently becoming "Invalid date".
 */
function fmtTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const m = moment(value, ["HH:mm", "H:mm", "HH:mm:ss", "h:mm A", "h:mmA"], true);
    if (m.isValid()) return m.format("h:mm A");
    /* Calendar events carry a full ISO timestamp rather than a clock time, and
     * the strict parse above rejects it — without this the raw
     * "2026-08-19T10:30:00-05:00" was rendered straight into the row. */
    const iso = moment(value, moment.ISO_8601);
    if (iso.isValid()) return iso.format("h:mm A");
    return value;
  }
  const m = moment(value);
  return m.isValid() ? m.format("h:mm A") : null;
}

function el(parent, tag, cls, text) {
  const node = parent.createEl(tag, cls ? { cls } : undefined);
  if (text != null) node.setText(text);
  return node;
}

function toArray(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function esc(s) {
  return String(s).replace(/[|\[\]]/g, "\\$&");
}

/* ------------------------------------------------------------- recurrence */

const WEEKDAY = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5,
  saturday: 6, sat: 6, sunday: 7, sun: 7,
};

class Recurrence {
  constructor(app) {
    this.app = app;
  }

  /** Every series note under the recurring folder. */
  series() {
    const out = [];
    const folder = this.app.vault.getAbstractFileByPath(P.recurring);
    if (!folder || !folder.children) return out;
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const fm = this.app.metadataCache.getFileCache(child)?.frontmatter;
      if (!fm || fm.type !== "recurring-meeting") continue;
      out.push({ file: child, fm });
    }
    return out;
  }

  weekdayNumbers(v) {
    return toArray(v)
      .map((x) => WEEKDAY[String(x).trim().toLowerCase()])
      .filter((n) => Number.isFinite(n));
  }

  /** Does `s` occur on `day` (a moment)? */
  occursOn(s, day) {
    const fm = s.fm;
    if (String(fm.status ?? "active").toLowerCase() === "paused") return false;
    if (fm.starts && day.isBefore(moment(fm.starts), "day")) return false;
    if (fm.ends && day.isAfter(moment(fm.ends), "day")) return false;

    const cadence = String(fm.cadence ?? "").toLowerCase();
    const dow = day.isoWeekday();
    const days = this.weekdayNumbers(fm.weekdays);

    switch (cadence) {
      case "daily":
        return true;
      case "weekdays":
        return dow <= 5;
      case "weekly":
        return days.length ? days.includes(dow) : false;
      case "biweekly": {
        if (days.length && !days.includes(dow)) return false;
        if (!fm.anchor) return false;
        const weeks = day.clone().startOf("isoWeek")
          .diff(moment(fm.anchor).startOf("isoWeek"), "weeks");
        return Math.abs(weeks) % 2 === 0;
      }
      case "monthly": {
        const dom = Number(fm.day_of_month);
        if (Number.isFinite(dom)) return day.date() === dom;
        /* Nth weekday of the month — Exchange writes this as BYDAY=3WE for
         * "third Wednesday". `nth: -1` is the last one in the month, which is
         * how Exchange's "5th <weekday>" behaves in months that lack a fifth. */
        const nth = Number(fm.nth);
        if (!Number.isFinite(nth) || !days.includes(dow)) return false;
        if (nth === -1) return day.clone().add(7, "day").month() !== day.month();
        return Math.ceil(day.date() / 7) === nth;
      }
      default:
        return false;
    }
  }

  /** Series occurring on `day`, sorted by time. */
  on(day) {
    return this.series()
      .filter((s) => this.occursOn(s, day))
      .sort((a, b) =>
        String(a.fm.time ?? "99:99").localeCompare(String(b.fm.time ?? "99:99"))
      );
  }

  /** First day in [from, from+horizon] the series occurs, else null. */
  next(s, from, horizon = 90) {
    const d = from.clone();
    for (let i = 0; i <= horizon; i++) {
      if (this.occursOn(s, d)) return d.clone();
      d.add(1, "day");
    }
    return null;
  }

  /** Why a series can never resolve, or null when coherent. */
  problem(s) {
    const fm = s.fm;
    const cadence = String(fm.cadence ?? "").toLowerCase();
    if (!cadence) return "no cadence set";
    if (!["daily", "weekdays", "weekly", "biweekly", "monthly"].includes(cadence))
      return `unrecognised cadence "${cadence}"`;
    if (cadence === "weekly" && !this.weekdayNumbers(fm.weekdays).length)
      return "weekly needs at least one weekday";
    if (cadence === "biweekly" && !fm.anchor) return "biweekly needs an anchor date";
    if (cadence === "monthly" && !Number.isFinite(Number(fm.day_of_month)))
      return "monthly needs a numeric day_of_month";
    return null;
  }

  /** The occurrence note for a series on a day, if one has been written.
   *
   * Matches on `series` first, then falls back to date + title. The fallback
   * matters: the Granola importer writes real meeting notes without a `series`
   * field, and without it every imported meeting would look "missing" and get
   * a duplicate created alongside it. */
  instance(series, day) {
    const key = String(series?.fm?.series ?? "").toLowerCase();
    /* Slug comparison — Granola filenames are slugified, series titles are not. */
    const name = slug(series?.fm?.series ?? series?.file?.basename ?? "");
    const iso = day.format("YYYY-MM-DD");

    let byTitle = null;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(P.meetings + "/")) continue;
      if (f.path.startsWith(P.recurring + "/")) continue;

      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const md = fm.meeting_date ?? fm.date;
      const sameDay = md
        ? moment(String(md)).format("YYYY-MM-DD") === iso
        : f.basename.startsWith(iso);
      if (!sameDay) continue;

      if (key && String(fm.series ?? "").toLowerCase() === key) return f;
      if (name && slug(f.basename).includes(name)) byTitle = byTitle ?? f;
    }
    return byTitle;
  }
}

/* -------------------------------------------------------------- vault I/O */

/* Matches a heading at any level, with the title escaped so punctuation in a
 * section name ("Follow-up") cannot behave as a regex. */
function headingRe(heading) {
  const safe = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,6}\\s+${safe}\\s*$`, "i");
}

class Store {
  constructor(app) {
    this.app = app;
  }

  async ensureFolder(path) {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path).catch(() => {});
    }
  }

  /** Read a markdown file, or null. */
  async read(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return null;
    return this.app.vault.read(f);
  }

  /** Append a line under `## heading`, creating the heading if missing. */
  async appendToSection(path, heading, line) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`Not found: ${path}`);

    await this.app.vault.process(f, (data) => {
      const lines = data.split("\n");
      const re = headingRe(heading);
      let start = lines.findIndex((l) => re.test(l));

      if (start === -1) {
        // No such section — add one at the end.
        const tail = lines[lines.length - 1] === "" ? "" : "\n";
        return `${data}${tail}\n## ${heading}\n\n${line}\n`;
      }

      // End of the section: the next h1/h2, or EOF. Deeper headings are
      // content belonging to this section, not the start of a new one.
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,2}\s/.test(lines[i])) {
          end = i;
          break;
        }
      }

      // Insert after the last non-empty line in the section so we don't
      // accumulate blank lines between entries.
      let insert = end;
      while (insert > start + 1 && lines[insert - 1].trim() === "") insert--;

      lines.splice(insert, 0, line);
      return lines.join("\n");
    });
  }

  /** Replace the body of `## heading` wholesale. */
  async replaceSection(path, heading, body) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`Not found: ${path}`);

    await this.app.vault.process(f, (data) => {
      const lines = data.split("\n");
      const re = headingRe(heading);
      const start = lines.findIndex((l) => re.test(l));
      if (start === -1) return `${data}\n\n## ${heading}\n\n${body}\n`;

      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,2}\s/.test(lines[i])) {
          end = i;
          break;
        }
      }
      const next = lines.slice(0, start + 1)
        .concat("", body.split("\n"), "")
        .concat(lines.slice(end));
      return next.join("\n");
    });
  }

  /** Section body as raw lines. */
  sectionLines(content, heading) {
    if (!content) return [];
    const lines = content.split("\n");
    const re = headingRe(heading);
    const start = lines.findIndex((l) => re.test(l));
    if (start === -1) return [];
    const out = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,2}\s/.test(lines[i])) break;
      out.push(lines[i]);
    }
    return out;
  }

  /** Bullet/checkbox items under a section, as display strings. */
  sectionItems(content, heading) {
    return this.sectionLines(content, heading)
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+(\[[ xX]\]\s+)?/, ""))
      .filter((l) => l.length && l !== "");
  }
}

/* ----------------------------------------------------------- today plan */

/* The daily plan is deliberately a tiny, UI-owned Markdown section. Task
 * entries keep the Task Inbox's stable id rather than a duplicate task body,
 * so checking a plan item always changes the canonical task. Study entries are
 * a local record of intent only; LearnKit remains the review-state owner. */
const TODAY_PLAN_STATES = new Set(["planned", "done", "deferred", "dropped"]);
const TODAY_PLAN_LINE = /^\s*-\s*\[(planned|done|deferred|dropped)\]\s+\[(task|study)::\s*([^\]]+)\]\s*(.*)$/i;

function cleanPlanLabel(value) {
  return String(value ?? "").replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

function parseTodayPlan(content) {
  const seen = new Set();
  const out = [];
  for (const line of String(content ?? "").split("\n")) {
    const m = TODAY_PLAN_LINE.exec(line);
    if (!m) continue;
    const status = m[1].toLowerCase();
    const kind = m[2].toLowerCase();
    const id = m[3].trim();
    if (!TODAY_PLAN_STATES.has(status) || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ status, kind, id, label: cleanPlanLabel(m[4]) });
  }
  return out;
}

function todayPlanLine(entry) {
  const status = TODAY_PLAN_STATES.has(entry?.status) ? entry.status : "planned";
  const kind = entry?.kind === "study" ? "study" : "task";
  const id = String(entry?.id ?? "").replace(/[\]\r\n]/g, "").trim();
  if (!id) throw new Error("Today Plan item needs an id");
  return `- [${status}] [${kind}:: ${id}] ${cleanPlanLabel(entry?.label)}`.trimEnd();
}

async function saveTodayPlan(plugin, path, entries) {
  await plugin.store.replaceSection(path, DAILY_SECTIONS.plan,
    entries.map(todayPlanLine).join("\n"));
}

function planPriorityMatch(task, priorities) {
  const text = String(task?.fullText ?? task?.text ?? "").toLowerCase();
  return priorities.some((priority) => {
    const p = cleanPlanLabel(priority).toLowerCase();
    return p.length >= 6 && (text.includes(p) || p.includes(text));
  });
}

function planCaptureLabel(task) {
  const source = String(task?.source ?? "");
  if (/messages?/i.test(source)) return "Captured from a message";
  if (/email|mail/i.test(source)) return "Captured from email";
  if (/granola|transcript/i.test(source)) return "Captured from a meeting";
  return null;
}

/* A suggestion is a reasoned shortlist, never an automatic plan. The user
 * selects the three items and that order remains stable until they change it. */
function todayPlanRecommendations(tasks, priorities, study, day = moment()) {
  const iso = day.format("YYYY-MM-DD");
  const ranked = [];
  for (const task of tasks ?? []) {
    if (task.done || task.status === "Blocked" || !task.id) continue;
    const capture = planCaptureLabel(task);
    const priority = planPriorityMatch(task, priorities ?? []);
    const overdue = task.due && task.due < iso;
    const dueToday = task.due === iso;
    const urgent = Number(task.level) && Number(task.level) <= 3;
    if (!(overdue || dueToday || priority || capture || urgent)) continue;
    let score = 0;
    let reason = "Open task";
    if (overdue) {
      score += 1000 + moment(iso).diff(moment(task.due), "days");
      reason = `${moment(iso).diff(moment(task.due), "days")}d overdue`;
    } else if (dueToday) {
      score += 800;
      reason = "Due today";
    } else if (priority) {
      score += 650;
      reason = "Matches today's priority";
    } else if (capture) {
      score += 500;
      reason = capture;
    } else if (urgent) {
      score += 350;
      reason = `Priority P${task.level}`;
    }
    if (priority && reason !== "Matches today's priority") score += 80;
    if (capture && reason !== capture) score += 40;
    score += Math.max(0, 10 - (Number(task.level) || 10));
    ranked.push({ kind: "task", id: task.id, label: task.text, task, reason, source: task.source,
      duration: Number(task.duration) || 30, score });
  }
  if (study?.due > 0) {
    const cert = study.certification ?? "Current certification";
    ranked.push({ kind: "study", id: String(cert),
      label: `Review ${study.due} LearnKit card${study.due === 1 ? "" : "s"}`,
      reason: study.weakestDomain ? `Strengthen ${study.weakestDomain}` : "LearnKit reviews due",
      duration: 20, score: 620, study });
  }
  return ranked.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function planMinutes(entries, tasks) {
  const byId = new Map((tasks ?? []).map((task) => [task.id, task]));
  return entries.filter((entry) => entry.status === "planned").reduce((total, entry) => {
    const task = entry.kind === "task" ? byId.get(entry.id) : null;
    return total + (entry.kind === "study" ? 20 : (Number(task?.duration) || 30));
  }, 0);
}

async function integrationSignals(plugin) {
  const adapter = plugin.app.vault.adapter;
  const freshness = async (label, enabled, path, target) => {
    if (!enabled) return { label, state: "disabled", detail: "Disabled", target };
    try {
      const stat = await adapter.stat?.(path);
      if (!stat?.mtime) return { label, state: "missing", detail: "Not run yet", target };
      const hours = (Date.now() - stat.mtime) / 36e5;
      return hours <= 24
        ? { label, state: "fresh", detail: "Fresh", target }
        : { label, state: "stale", detail: `Stale (${Math.floor(hours)}h)`, target };
    } catch (_) {
      return { label, state: "missing", detail: "Not run yet", target };
    }
  };
  const cfg = plugin.cfg ?? {};
  return Promise.all([
    freshness("Reminders", !!cfg.reminders?.enabled, cfg.reminders?.statePath, () => plugin.go("settings")),
    freshness("Message capture", !!cfg.messagesTaskCapture?.enabled,
      cfg.messagesTaskCapture?.statePath, () => plugin.open(P.taskInbox)),
    freshness("Granola", plugin.on("granola"), `${P.transcripts}/.uptick-state.json`,
      () => plugin.go("settings")),
    freshness("LearnKit", plugin.on("study"), P.questCache, () => plugin.openLearnKit("home")),
  ]);
}

/* ------------------------------------------------------------------ tasks */

/* Task Inbox is canonical. We only ever APPEND, in the existing format:
 *
 *   - [ ] Text 📅 YYYY-MM-DD #task ^task-<id>
 *     Source: [[Some note]]
 */
class Tasks {
  constructor(app, store) {
    this.app = app;
    this.store = store;
  }

  async all() {
    const content = await this.store.read(P.taskInbox);
    if (!content) return [];
    const out = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const m = raw.match(/^\s*-\s*\[([ xX])\]\s+(.*)$/);
      if (!m) continue;
      const checked = m[1].toLowerCase() === "x";
      let text = m[2];
      if (!/#task\b/.test(text)) continue;

      /* Status follows the configurable Reminders/Kanban model. A #done tag
       * counts as finished even when the box was never ticked — without that,
       * closed work kept surfacing as upcoming. */
      const tagged = /#done\b/.test(text);
      const done = checked || tagged;
      const status = done ? "Done"
        : (/#blocked\b|#dependency\b/.test(text) ? "Blocked"
          : (/#in-progress\b/.test(text) ? "In Progress" : "Not Started"));

      /* Provenance lives on the line(s) after the checkbox, e.g.
       *   Source: [[2 Work/Meetings/… ]] */
      let source = null;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/^\s*-\s*\[[ xX]\]/.test(lines[j])) break;
        const s = lines[j].match(/Source:\s*\[\[([^\]|]+)/);
        if (s) { source = s[1].trim(); break; }
      }

      const due = text.match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const doneOn = text.match(/✅\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const id = text.match(/\^(task-[A-Za-z0-9]+)/)?.[1] ?? null;
      /* Inline fields written by priority-task-sync.py. They are data, not part
       * of the title, so they are lifted out here and rendered as their own
       * elements rather than left as raw "[priority:: 4]" markup in the text. */
      const level = Number(text.match(/\[priority::\s*(\d+)\s*\]/)?.[1]) || null;
      /* Difficulty is the XP axis, written by priority-task-sync.py. A trailing
       * "!" means a human set it and the rules must not recompute it; "~" means
       * an AI refined it at import. */
      const dm = text.match(/\[difficulty::\s*([1-5])\s*([!~]?)\s*\]/);
      const difficulty = dm ? Number(dm[1]) : null;
      const difficultyMark = dm ? dm[2] : "";
      /* Duration tags are already part of the Reminders vocabulary. The plan
       * uses them for a conservative time check and otherwise assumes 30 min. */
      const duration = Number(text.match(/#(10|20|30)min\b/i)?.[1]) || 30;
      const tm = text.match(/\[ticket::\s*\[([^\]]+)\]\(([^)]+)\)\s*\]/)
             || text.match(/\[ticket::\s*([^\]]+?)\s*\]/);
      const ticket = tm ? { id: tm[1].trim(), url: tm[2] ?? null } : null;

      const display0 = text
        .replace(/\[ticket::\s*\[[^\]]*\]\([^)]*\)\s*\]/g, "")
        .replace(/\[(?:priority|difficulty|ticket)::[^\]]*\]/g, "")
        .replace(/[📅✅➕⏳🛫]\s*\d{4}-\d{2}-\d{2}/g, "")
        .replace(/\^task-[A-Za-z0-9]+/g, "")
        .replace(/#\S+/g, "")
        .replace(/[⏫🔼🔽⏬🔺]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      /* "Long Meeting Name: do the thing (Sam)" -> "do the thing (Sam)".
       * Only when the prefix is long enough to be a title rather than part of
       * the sentence, so "Bug: fix login" survives intact. */
      const prefix = display0.match(/^(.{18,}?):\s+(\S.*)$/);
      const display = prefix ? prefix[2] : display0;

      out.push({ done, status, checked, due, doneOn, id, source, level, ticket,
                 difficulty, difficultyMark, duration,
                 text: display, fullText: display0 });
    }
    return out;
  }

  /** Tasks whose Source link points at `basename` (or its full path). */
  async bySource(basename) {
    const key = String(basename).toLowerCase();
    return (await this.all()).filter((t) => {
      if (!t.source) return false;
      const s = t.source.toLowerCase();
      return s === key || s.endsWith("/" + key);
    });
  }

  async add(text, opts = {}) {
    const clean = String(text).trim();
    if (!clean) throw new Error("Task text is empty");

    const existing = await this.all();
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    if (existing.some((t) => !t.done && norm(t.text) === norm(clean))) {
      throw new Error("An open task with that text already exists");
    }

    const id = `task-${Math.random().toString(16).slice(2, 14)}`;
    /* Every task gets a due date. An undated task never surfaces on a daily
     * dashboard, so "no date" is the same as "invisible" in this system. */
    const dueOn = opts.due || moment().format("YYYY-MM-DD");
    let line = `- [ ] ${clean} 📅 ${dueOn} #task ^${id}`;
    if (opts.source) line += `\n  Source: [[${opts.source}]]`;

    const f = this.app.vault.getAbstractFileByPath(P.taskInbox);
    if (!(f instanceof TFile)) throw new Error("Task Inbox not found");
    await this.app.vault.process(f, (data) => {
      const tail = data.endsWith("\n") ? "" : "\n";
      return `${data}${tail}${line}\n`;
    });
    return id;
  }

  /** Update the canonical checkbox so every consumer, including Kanban, sees
   * the same completion state. The task id makes this safe even when titles
   * are duplicated. */
  async setDone(task, done = true) {
    if (!task?.id) throw new Error("Task has no stable id");
    const f = this.app.vault.getAbstractFileByPath(P.taskInbox);
    if (!(f instanceof TFile)) throw new Error("Task Inbox not found");
    const idPattern = new RegExp(`\\^${task.id}(?:\\s|$)`);
    let changed = false;
    await this.app.vault.process(f, (data) => {
      const lines = data.split("\n");
      const next = lines.map((line) => {
        if (!idPattern.test(line)) return line;
        changed = true;
        let updated = line.replace(/^(\s*-\s*)\[[ xX]\]/, `$1[${done ? "x" : " "}]`);
        updated = updated.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/g, "");
        if (done) updated = updated.replace(/(\s+\^task-[A-Za-z0-9]+)(\s*)$/, ` ✅ ${moment().format("YYYY-MM-DD")}$1$2`);
        return updated;
      });
      return next.join("\n");
    });
    if (!changed) throw new Error("Task was not found in Task Inbox");
  }
}

/* ----------------------------------------------------------------- emails */

/* Email reference notes written by 4 System/Automation/email-import.py.
 *
 * These hold metadata, a derived summary, extracted action items, and the full
 * message body (stored since 2026-08-19). Mail.app stays the system of record,
 * and "Open original in Mail" looks the message up there. */
class Emails {
  constructor(app) {
    this.app = app;
  }

  notes() {
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(P.emails + "/"));
  }

  info(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    return {
      file,
      subject: String(fm.subject ?? file.basename),
      sender: String(fm.sender ?? ""),
      date: String(fm.date ?? ""),
      received: fm.received ? moment(String(fm.received)) : null,
      account: String(fm.account ?? ""),
      messageId: String(fm.message_id ?? ""),
      meeting: fm.meeting ? String(fm.meeting) : null,
      to: toArray(fm.to).map(String).filter(Boolean),
      cc: toArray(fm.cc).map(String).filter(Boolean),
      /* Distinguishes "imported and there were none" from "never imported".
       * The importer always writes both keys, so their presence is the tell. */
      hasRecipientData: fm.to !== undefined || fm.cc !== undefined,
      actionCount: Number(fm.action_count ?? 0) || 0,
      /* Vault-local only. This never touches Mail.app's own read state —
       * AGENTS.md keeps the Mail MCP read-only, so marking one read here
       * hides the row on the dashboard and changes nothing in Mail. */
      read: fm.read === true || String(fm.read).toLowerCase() === "true",
    };
  }

  all() {
    return this.notes()
      .map((f) => this.info(f))
      .sort((a, b) => String(b.received ?? b.date).localeCompare(String(a.received ?? a.date)));
  }

  on(day) {
    const iso = day.format("YYYY-MM-DD");
    return this.all().filter((e) => e.date === iso);
  }

  /** Flip the vault-local read flag. Does not touch Mail.app. */
  async setRead(file, value) {
    await setFrontMatter(this.app, file, "read", value ? "true" : "false");
  }

  /** Emails linked to a meeting note, matched on its basename. */
  forMeeting(basename) {
    const key = String(basename).toLowerCase();
    return this.all().filter((e) => {
      if (!e.meeting) return false;
      const t = e.meeting.replace(/^\[\[|\]\]$/g, "").toLowerCase();
      return t === key || t.endsWith("/" + key);
    });
  }

}

function emailRow(plugin, parent, e, onChange, isRead) {
  const row = el(parent, "div", `lifeos-email${isRead ? " is-read" : ""}`);
  const main = el(row, "div", "lifeos-email-main");
  el(main, "div", "lifeos-email-subject", e.subject);
  el(main, "div", "lifeos-email-sub",
    [e.sender.replace(/<.*?>/, "").trim() || e.account,
     e.received ? fmtTime(e.received) : e.date].filter(Boolean).join(" · "));
  if (e.actionCount) {
    el(row, "span", "lifeos-badge lifeos-badge-warn", `${e.actionCount} action${e.actionCount === 1 ? "" : "s"}`);
  }
  const acts = el(row, "div", "lifeos-meeting-actions");
  mkBtn(acts, isRead ? "Unread" : "Mark read", async () => {
    await plugin.emails.setRead(e.file, !isRead);
    await afterMetadata(plugin.app, e.file.path);
    if (onChange) await onChange();
  });
  mkBtn(acts, "Open", () => plugin.open(e.file.path));
  onTap(main, () => plugin.open(e.file.path));
}

/* On-demand sync.
 *
 * The buttons do not run the scripts directly — they kick the same launchd
 * jobs the scheduler runs. That keeps one code path for both, so a manual run
 * cannot drift from the automatic one, and the job's own lock file stops a
 * hand-triggered run colliding with a scheduled one. The schedule is never
 * touched; this is in addition to it, not instead of it. */
async function renderSync(plugin, grid, redraw, cls = "col3") {
  /* Every button here kicks a launchd job, which does not exist on a phone. */
  if (isMobile()) return null;
  const c = card(grid, "Sync", "⟳", cls);
  const list = el(c, "div", "lifeos-synclist");

  for (const job of syncJobs(plugin)) {
    const row = el(list, "div", "lifeos-syncrow");
    const main = el(row, "div", "lifeos-syncmain");
    el(main, "div", "lifeos-syncname", job.title);
    const status = await plugin.jobStatus(job.log, job.logDir);
    el(main, "div", `lifeos-syncstate is-${status.state}`, status.text);
    el(main, "div", "lifeos-syncsched", `Automatic: ${job.schedule}`);

    const acts = el(row, "div", "lifeos-meeting-actions");
    const btn = mkBtn(acts, status.state === "running" ? "Running…" : "Sync now", async () => {
      btn.disabled = true;
      btn.setText("Starting…");
      const res = await plugin.kickJob(job.label);
      if (!res.ok) {
        new Notice(`Could not start ${job.title}: ${res.error}`);
        btn.disabled = false;
        btn.setText("Sync now");
        return;
      }
      new Notice(res.note === "already running"
        ? `${job.title} is already running`
        : `${job.title} started — this runs in the background`);
      /* The job outlives this render, so poll its log and refresh when the
       * status actually changes rather than pretending it finished. */
      let ticks = 0;
      const poll = window.setInterval(async () => {
        ticks += 1;
        const s = await plugin.jobStatus(job.log, job.logDir);
        if (s.state !== "running" || ticks > 60) {
          window.clearInterval(poll);
          await redraw();
        }
      }, 10000);
    });
    if (status.state === "running") btn.disabled = true;
  }

  el(c, "div", "lifeos-microlabel",
    "ON-DEMAND RUNS USE THE SAME JOBS AS THE SCHEDULE");
  return c;
}

/* ---- weather charts -------------------------------------------------------
 *
 * Temperature and precipitation are different measures on different scales, so
 * they are two stacked plots sharing one x-axis rather than a dual-axis
 * overlay. Each plot is a single series, so neither needs a legend — the
 * heading names it.
 *
 * The two hues were validated against the dark surface for lightness band,
 * chroma, CVD separation and contrast before being used:
 *   temperature #c07f00 · precipitation #2b86c9   (worst-case CVD ΔE 23.4) */
const WX_TEMP = "#c07f00";
const WX_RAIN = "#2b86c9";

function svgEl(parent, tag, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent.appendChild(n);
  return n;
}

/* Hourly temperature as an area+line, with a crosshair readout. */
function wxHourlyChart(parent, hours) {
  const W = 900, H = 190, PAD = { t: 14, r: 14, b: 26, l: 34 };
  const temps = hours.map((h) => Number(h.temp)).filter(Number.isFinite);
  if (temps.length < 2) return;
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const pad = Math.max(2, (hi - lo) * 0.15);
  const yMin = Math.floor(lo - pad), yMax = Math.ceil(hi + pad);

  const box = el(parent, "div", "lifeos-wx-plot");
  const svg = svgEl(box, "svg", {
    viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none",
    role: "img", "aria-label": "Hourly temperature",
  });
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / (hours.length - 1);
  const y = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);

  /* recessive grid */
  for (let g = 0; g <= 3; g++) {
    const v = yMin + ((yMax - yMin) * g) / 3;
    svgEl(svg, "line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v),
      stroke: "currentColor", "stroke-width": 1, opacity: 0.12 });
    const lb = svgEl(svg, "text", { x: 4, y: y(v) + 3, "font-size": 9,
      fill: "currentColor", opacity: 0.5 });
    lb.textContent = `${Math.round(v)}°`;
  }

  const pts = hours.map((h, i) => `${x(i)},${y(Number(h.temp))}`).join(" ");
  svgEl(svg, "polygon", {
    points: `${PAD.l},${H - PAD.b} ${pts} ${x(hours.length - 1)},${H - PAD.b}`,
    fill: WX_TEMP, opacity: 0.16,
  });
  svgEl(svg, "polyline", { points: pts, fill: "none", stroke: WX_TEMP,
    "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });

  /* hour ticks every 3 hours, so labels never collide */
  hours.forEach((h, i) => {
    if (i % 3) return;
    const hr = Number(String(h.datetime).slice(0, 2));
    const lb = svgEl(svg, "text", { x: x(i), y: H - 8, "font-size": 9,
      fill: "currentColor", opacity: 0.5, "text-anchor": "middle" });
    lb.textContent = `${((hr + 11) % 12) + 1}${hr < 12 ? "a" : "p"}`;
  });

  /* crosshair + readout */
  const cross = svgEl(svg, "line", { y1: PAD.t, y2: H - PAD.b, stroke: "currentColor",
    "stroke-width": 1, opacity: 0, "stroke-dasharray": "3 3" });
  const dot = svgEl(svg, "circle", { r: 4, fill: WX_TEMP, opacity: 0 });
  const out = el(box, "div", "lifeos-wx-readout");
  box.onmousemove = (ev) => {
    const r = box.getBoundingClientRect();
    const i = Math.round(((ev.clientX - r.left) / r.width * W - PAD.l)
      / ((W - PAD.l - PAD.r) / (hours.length - 1)));
    const h = hours[Math.max(0, Math.min(hours.length - 1, i))];
    if (!h) return;
    const px = x(Math.max(0, Math.min(hours.length - 1, i)));
    cross.setAttribute("x1", px); cross.setAttribute("x2", px);
    cross.setAttribute("opacity", 0.35);
    dot.setAttribute("cx", px); dot.setAttribute("cy", y(Number(h.temp)));
    dot.setAttribute("opacity", 1);
    const hr = Number(String(h.datetime).slice(0, 2));
    out.setText(`${((hr + 11) % 12) + 1}${hr < 12 ? "am" : "pm"} · ${Math.round(h.temp)}° · `
      + `${h.conditions ?? ""} · ${Math.round(h.precipprob ?? 0)}% rain · ${Math.round(h.humidity ?? 0)}% humidity`);
  };
  box.onmouseleave = () => {
    cross.setAttribute("opacity", 0);
    dot.setAttribute("opacity", 0);
    out.setText("");
  };
}

/* Precipitation chance for the same hours — its own plot, same x-axis. */
function wxPrecipChart(parent, hours) {
  const W = 900, H = 70, PAD = { t: 6, r: 14, b: 16, l: 34 };
  const box = el(parent, "div", "lifeos-wx-plot is-short");
  const svg = svgEl(box, "svg", {
    viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none",
    role: "img", "aria-label": "Chance of precipitation by hour",
  });
  const slot = (W - PAD.l - PAD.r) / hours.length;
  hours.forEach((h, i) => {
    const v = Math.max(0, Math.min(100, Number(h.precipprob) || 0));
    const hgt = (v / 100) * (H - PAD.t - PAD.b);
    if (hgt < 1) return;
    /* 2px gap between bars so adjacent fills never touch */
    svgEl(svg, "rect", {
      x: PAD.l + i * slot + 1, y: H - PAD.b - hgt,
      width: Math.max(1, slot - 2), height: hgt,
      rx: Math.min(4, slot / 2), fill: WX_RAIN,
    });
  });
  svgEl(svg, "line", { x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b,
    stroke: "currentColor", "stroke-width": 1, opacity: 0.15 });
  const lb = svgEl(svg, "text", { x: 4, y: PAD.t + 8, "font-size": 9,
    fill: "currentColor", opacity: 0.5 });
  lb.textContent = "100%";
}

/* 15 days as floating range bars: each day's low to its high on one scale. */
function wxRangeChart(parent, days) {
  const rows = days.filter((d) => Number.isFinite(Number(d.tempmax)));
  if (!rows.length) return;
  const lo = Math.min(...rows.map((d) => Number(d.tempmin)));
  const hi = Math.max(...rows.map((d) => Number(d.tempmax)));
  const span = Math.max(1, hi - lo);
  const wrap = el(parent, "div", "lifeos-wx-days");
  for (const d of rows) {
    const row = el(wrap, "div", "lifeos-wx-day");
    const m = moment(d.datetime, "YYYY-MM-DD");
    el(row, "div", "lifeos-wx-dayname",
      m.isSame(moment(), "day") ? "Today" : m.format("ddd D"));
    el(row, "div", "lifeos-wx-daycond", d.conditions ?? "");
    el(row, "div", "lifeos-wx-lo", `${Math.round(d.tempmin)}°`);
    const track = el(row, "div", "lifeos-wx-track");
    const bar = el(track, "div", "lifeos-wx-bar");
    bar.style.left = `${((Number(d.tempmin) - lo) / span) * 100}%`;
    bar.style.width = `${Math.max(3, ((Number(d.tempmax) - Number(d.tempmin)) / span) * 100)}%`;
    el(row, "div", "lifeos-wx-hi", `${Math.round(d.tempmax)}°`);
    const pop = Math.round(Number(d.precipprob) || 0);
    el(row, "div", "lifeos-wx-pop" + (pop ? "" : " is-none"), pop ? `${pop}%` : "—");
  }
}

/* Weather, drawn as a sky rather than a widget.
 *
 * A slim band under the day title whose background animates to the current
 * conditions — drifting cloud, falling rain, a slow sun glow. It reads as part
 * of the page header instead of adding another card to a page that already has
 * plenty. Data comes from weather-fetch.py, which reuses the Visual Crossing
 * key already configured in the weather plugin. */
/* Why the weather card is empty, and what to do about it. */
function weatherSetupHint(plugin, root) {
  const box = el(root, "div", "lifeos-setuphint");
  el(box, "div", "lifeos-setuphint-title", "Weather is not set up");
  const hasKey = !!cfgGet(plugin.cfg, "weather.apikey", "");
  const hasLoc = !!cfgGet(plugin.cfg, "weather.location", "");
  el(box, "div", "lifeos-setuphint-body",
    !hasLoc && !hasKey
      ? "Weather needs a free Visual Crossing API key and a location. Nothing "
        + "is fetched until you ask for it."
    : !hasKey
      ? "A location is set, but no API key. Visual Crossing's free tier covers "
        + "1000 requests a day, which is far more than this needs."
    : !hasLoc
      ? "A key is set, but no location."
      : "Everything is configured; nothing has been fetched yet. Weather does "
        + "not update on its own.");
  const row = el(box, "div", "lifeos-setuphint-actions");
  const ready = cfgGet(plugin.cfg, "weather.apikey", "")
    && cfgGet(plugin.cfg, "weather.location", "");
  if (ready) {
    mkBtn(row, "Fetch now", async () => {
      const r = await plugin.fetchWeather();
      new Notice(r.ok ? `Weather updated for ${r.location}` : `Weather: ${r.error}`,
                 r.ok ? 4000 : 8000);
    }, "primary");
  }
  mkBtn(row, ready ? "Settings" : "Add a key and location",
        () => plugin.openSettings("Panels"));
  mkBtn(row, "Hide this card", async () => {
    await plugin.setCfg("home.weather", false);
    await plugin.setCfg("daily.weather", false);
    new Notice("Weather card hidden. Turn it back on under Layout.");
  });
  return box;
}

const SKY = {
  "clear-day": "sun", "clear-night": "stars",
  "partly-cloudy-day": "cloud", "partly-cloudy-night": "cloud",
  "cloudy": "cloud", "wind": "cloud", "fog": "fog",
  "rain": "rain", "showers-day": "rain", "showers-night": "rain",
  "thunder-rain": "rain", "thunder-showers-day": "rain",
  "thunder-showers-night": "rain",
  "snow": "snow", "snow-showers-day": "snow", "snow-showers-night": "snow",
  "sleet": "snow",
};
const SKY_GLYPH = {
  sun: "☀", stars: "☾", cloud: "☁", fog: "≋", rain: "☂", snow: "❄",
};

async function renderWeather(plugin, root) {
  const f = plugin.app.vault.getAbstractFileByPath(P.weatherCache);
  let w = null;
  if (f instanceof TFile) {
    try { w = JSON.parse(await plugin.app.vault.cachedRead(f)); } catch (e) { w = null; }
  }
  if (!w?.now) {
    /* Returning null here left a blank space on Home with nothing to say why,
     * so the card looked broken rather than unconfigured. Weather is the one
     * dashboard piece that needs a key and a job -- say so once. */
    return weatherSetupHint(plugin, root);
  }

  const kind = SKY[w.now.icon] ?? SKY[w.today?.icon] ?? "cloud";
  const band = el(root, "div", `lifeos-sky is-${kind}`);
  el(band, "div", "lifeos-sky-fx");

  const left = el(band, "div", "lifeos-sky-left");
  el(left, "span", "lifeos-sky-glyph", SKY_GLYPH[kind] ?? "☁");
  const nowBox = el(left, "div", "lifeos-sky-now");
  const deg = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}°`);
  el(nowBox, "div", "lifeos-sky-temp", deg(w.now.temp));
  el(nowBox, "div", "lifeos-sky-cond",
    [w.now.conditions, w.now.feelslike != null && Math.round(w.now.feelslike) !== Math.round(w.now.temp)
      ? `feels ${deg(w.now.feelslike)}` : null].filter(Boolean).join(" · "));

  const mid = el(band, "div", "lifeos-sky-range");
  /* The cache carries Visual Crossing's own field names. `precip` is rainfall
   * amount and `precipprob` is the chance of it — using the former behind a
   * "% rain" label would have reported inches as a percentage. */
  el(mid, "span", "lifeos-sky-hi", `H ${deg(w.today?.tempmax)}`);
  el(mid, "span", "lifeos-sky-lo", `L ${deg(w.today?.tempmin)}`);
  if (w.today?.precipprob) {
    el(mid, "span", "lifeos-sky-pop", `${Math.round(w.today.precipprob)}% rain`);
  }

  /* Next few hours as a small run of temperatures — enough to answer "is it
   * getting worse" without opening anything. */
  if (w.hours?.length) {
    const strip = el(band, "div", "lifeos-sky-hours");
    for (const h of w.hours.slice(0, 6)) {
      const cell = el(strip, "div", "lifeos-sky-hour");
      const hr = Number(String(h.datetime).slice(0, 2));
      el(cell, "div", "lifeos-sky-hourlabel",
        `${((hr + 11) % 12) + 1}${hr < 12 ? "a" : "p"}`);
      el(cell, "div", "lifeos-sky-hourtemp", deg(h.temp));
    }
  }

  band.title = "Open the full forecast";
  band.addClass("is-clickable");
  onTap(band, () => plugin.openOrCreate(P.weatherPage, weatherPageScaffold, "the Weather page"));
  return band;
}

/* Rotating photo gallery.
 *
 * Reads whatever `photo-gallery-sync.sh` last exported from Apple Photos —
 * already downscaled, since the vault syncs. The card holds one image at a
 * time and cross-fades; preloading the next one keeps the swap from flashing.
 * The interval is cleared when the view is torn down, or a redraw would leave
 * a timer running against a detached element. */
async function renderPhotos(plugin, grid, cls = "col3") {
  const folder = plugin.app.vault.getAbstractFileByPath(P.photos);
  const files = (folder?.children ?? [])
    .filter((f) => f instanceof TFile && /^(jpe?g|png|webp)$/i.test(f.extension));

  const c = card(grid, "Family", "❤", cls);
  if (!files.length) {
    el(c, "div", "lifeos-empty",
      `No images in ${P.photos}. Point the photo folder somewhere else in Settings, `
      + "or drop some images in.");
    return c;
  }

  /* Shuffle so the order differs between openings rather than always
   * starting at the same picture. */
  const max = Math.max(1, Number(cfgGet(plugin.cfg, "photos.max", 40)) || 40);
  let order = files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, max);
  if (cfgGet(plugin.cfg, "photos.shuffle", true) !== false) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  const frame = el(c, "div", "lifeos-photoframe");
  const img = frame.createEl("img", { cls: "lifeos-photo" });
  const caption = el(c, "div", "lifeos-photocap");

  let i = 0;
  const srcFor = (f) => plugin.app.vault.getResourcePath(f);
  const show = (n) => {
    i = (n + order.length) % order.length;
    img.addClass("is-fading");
    window.setTimeout(() => {
      img.src = srcFor(order[i]);
      img.removeClass("is-fading");
    }, 180);
    caption.setText(`${i + 1} of ${order.length}`);
    /* Warm the next image so the swap is instant. */
    const next = new Image();
    next.src = srcFor(order[(i + 1) % order.length]);
  };
  img.src = srcFor(order[0]);
  caption.setText(`1 of ${order.length}`);

  onTap(img, () => show(i + 1));
  img.title = "Click for the next photo";

  /* Rotation is ambient on a desktop the dashboard sits open on. On a phone it
   * is a timer and an image decode competing with scrolling, for a card that is
   * usually off-screen — so it holds still and advances on tap. */
  const everyMs = Math.max(2, Number(cfgGet(plugin.cfg, "photos.intervalSeconds", 12)) || 12) * 1000;
  let timer = isMobile() ? null : window.setInterval(() => show(i + 1), everyMs);
  /* Manual navigation stops the rotation — if someone is clicking through,
   * having it jump on its own is fighting them. */
  const stop = () => { if (timer) { window.clearInterval(timer); timer = null; } };

  const bar = el(c, "div", "lifeos-inline-actions");
  mkBtn(bar, "‹", () => { stop(); show(i - 1); });
  mkBtn(bar, "›", () => { stop(); show(i + 1); });
  /* Obsidian tears the block down on re-render; without this the timer keeps
   * firing against an element no longer in the document. */
  if (timer) plugin.registerInterval(timer);

  return c;
}

/* Render a day's email. Read mail is collapsed behind a disclosure rather than
 * dropped — the row stays reachable, it just stops competing for attention.
 * `limit` caps only the unread list; everything read stays inside the fold. */
function renderEmailRows(plugin, parent, list, empty, onChange, limit = 0) {
  if (!list.length) {
    el(parent, "div", "lifeos-empty", empty);
    return;
  }

  const unread = list.filter((e) => !e.read);
  const read = list.filter((e) => e.read);
  const shown = limit ? unread.slice(0, limit) : unread;

  for (const e of shown) emailRow(plugin, parent, e, onChange, false);

  if (unread.length > shown.length) {
    el(parent, "div", "lifeos-microlabel",
      `+ ${unread.length - shown.length} MORE UNREAD`);
  }
  if (!unread.length) {
    el(parent, "div", "lifeos-empty", "All caught up — nothing unread.");
  }

  if (read.length) {
    const det = parent.createEl("details", { cls: "lifeos-readmail" });
    const sum = det.createEl("summary", { cls: "lifeos-readmail-summary" });
    el(sum, "span", null, `${read.length} read`);
    for (const e of read) emailRow(plugin, det, e, onChange, true);
  }
}

/* --------------------------------------------------------------- contacts */

/* Attendees are stored as wikilinks to contact notes, never as loose strings.
 *
 * The note is the single source of truth for the address (Apple Contacts feeds
 * it, per AGENTS.md), so the meeting record shows a name while the email stays
 * resolvable at sync time. Renaming or re-syncing a contact does not strand a
 * stale address inside a meeting note. */
class Contacts {
  constructor(app) {
    this.app = app;
  }

  notes() {
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(P.contacts + "/"));
  }

  info(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const emails = toArray(fm.emails).map(String).filter(Boolean);
    const aliases = toArray(fm.aliases).map(String).filter(Boolean);
    return {
      file,
      name: String(fm.apple_contact_name || aliases[0] || file.basename),
      email: emails[0] ?? null,
      emails,
      org: fm.organization ? String(fm.organization) : null,
      aliases,
    };
  }

  all() {
    return this.notes().map((f) => this.info(f));
  }

  /** Contacts matching a query, addressable ones first. */
  search(q, limit = 40) {
    const needle = String(q ?? "").trim().toLowerCase();
    const scored = [];
    for (const c of this.all()) {
      const hay = [c.name, c.org ?? "", ...c.aliases, ...c.emails].join(" ").toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      /* Prefer a name-prefix hit, then anyone with an address. */
      let score = 0;
      if (needle && c.name.toLowerCase().startsWith(needle)) score -= 3;
      if (c.email) score -= 1;
      scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
    return scored.slice(0, limit).map((s) => s.c);
  }

  /** Resolve a stored attendee entry ("[[link|Alias]]" or a bare name). */
  resolve(entry) {
    const raw = String(entry ?? "").trim();
    const link = raw.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (!link) return { name: raw, email: null, file: null, unresolved: true };
    const target = link[1].trim();
    const hit = this.app.metadataCache.getFirstLinkpathDest(target, P.contacts + "/x.md");
    if (!hit) return { name: link[2] ?? target, email: null, file: null, unresolved: true };
    const info = this.info(hit);
    return { ...info, name: link[2] ?? info.name, unresolved: false };
  }
}

/* Modal: search contacts, toggle them on, save. */
class AttendeeModal extends Modal {
  constructor(app, contacts, current, resolve) {
    super(app);
    this.contacts = contacts;
    this.selected = new Map(); // path -> info
    this.resolveFn = resolve;
    this.done = false;
    for (const entry of current) {
      const r = contacts.resolve(entry);
      if (r.file) this.selected.set(r.file.path, r);
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("lifeos-modal");
    el(contentEl, "h3", "lifeos-modal-title", "Attendees");
    el(contentEl, "div", "lifeos-modal-help",
      "Type to find a contact. Names are stored as links, so the email is resolved " +
      "from the contact note when the meeting syncs to Calendar.");

    const chips = el(contentEl, "div", "lifeos-chips");
    const search = contentEl.createEl("input", { cls: "lifeos-input" });
    search.placeholder = "@ search contacts…";
    const results = el(contentEl, "div", "lifeos-results");

    const drawChips = () => {
      chips.empty();
      if (!this.selected.size) {
        el(chips, "span", "lifeos-empty", "No attendees yet.");
        return;
      }
      for (const [path, c] of this.selected) {
        const chip = el(chips, "span", "lifeos-attendee");
        el(chip, "span", null, c.name);
        if (!c.email) el(chip, "span", "lifeos-attendee-warn", "no email");
        const x = el(chip, "span", "lifeos-attendee-x", "×");
        x.onclick = () => { this.selected.delete(path); drawChips(); };
      }
    };

    const drawResults = () => {
      results.empty();
      const q = search.value.trim();
      const list = this.contacts.search(q, q ? 30 : 12);
      if (!list.length) {
        el(results, "div", "lifeos-empty", q ? `No contact matching “${q}”.` : "No contacts.");
        return;
      }
      for (const c of list) {
        const row = el(results, "div", "lifeos-result");
        const main = el(row, "div", "lifeos-result-main");
        el(main, "div", "lifeos-result-name", c.name);
        el(main, "div", "lifeos-result-sub",
          [c.email ?? "no email on file", c.org].filter(Boolean).join(" · "));
        if (this.selected.has(c.file.path)) row.addClass("is-on");
        row.onclick = () => {
          if (this.selected.has(c.file.path)) this.selected.delete(c.file.path);
          else this.selected.set(c.file.path, c);
          drawChips();
          drawResults();
        };
      }
    };

    search.oninput = drawResults;
    search.onkeydown = (e) => { if (e.key === "Escape") this.finish(null); };

    const bar = el(contentEl, "div", "lifeos-capture-bar");
    el(bar, "button", "lifeos-btn", "Cancel").onclick = () => this.finish(null);
    el(bar, "button", "lifeos-btn lifeos-btn-primary", "Save attendees").onclick = () =>
      this.finish([...this.selected.values()]);

    drawChips();
    drawResults();
    window.setTimeout(() => search.focus(), 20);
  }

  finish(v) {
    if (this.done) return;
    this.done = true;
    this.resolveFn(v);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.done) { this.done = true; this.resolveFn(null); }
  }
}

function pickAttendees(app, contacts, current) {
  return new Promise((res) => new AttendeeModal(app, contacts, current, res).open());
}

/* --------------------------------------------------------------- calendar */

/* Apple Calendar events, read from the cache written by
 * 4 System/Automation/calendar-export.py.
 *
 * Read-only by design: the dashboard shows events, and never creates, edits or
 * deletes one. A plugin cannot call an MCP server, and reading Calendar.app
 * over AppleScript takes minutes, so a cache is the only workable path. */
class Calendars {
  constructor(app) {
    this.app = app;
    this.cache = null;
    this.loadedAt = 0;
  }

  async load(force = false) {
    /* Re-read at most twice a minute; every panel asks for it. */
    if (!force && this.cache && Date.now() - this.loadedAt < 30000) return this.cache;
    const f = this.app.vault.getAbstractFileByPath(P.calendarCache);
    if (!(f instanceof TFile)) {
      this.cache = null;
      this.loadedAt = Date.now();
      return null;
    }
    try {
      this.cache = JSON.parse(await this.app.vault.read(f));
    } catch (e) {
      console.error("Uptick: calendar cache is not valid JSON", e);
      this.cache = null;
    }
    this.loadedAt = Date.now();
    return this.cache;
  }

  /** Events on a day, sorted; [] when no cache exists. */
  on(day) {
    if (!this.cache || !Array.isArray(this.cache.events)) return [];
    const iso = day.format("YYYY-MM-DD");
    return this.cache.events
      .filter((e) => moment(e.start).format("YYYY-MM-DD") === iso)
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  /** How stale the cache is, in hours; null when absent. */
  ageHours() {
    if (!this.cache?.generated) return null;
    return moment().diff(moment(this.cache.generated), "hours", true);
  }

  status() {
    if (!this.cache) {
      return {
        ok: false,
        text: "Calendar not connected. Run 4 System/Automation/calendar-export.py to build the cache.",
      };
    }
    const age = this.ageHours();
    if (age != null && age > 24) {
      return { ok: true, stale: true, text: `Calendar cache is ${Math.round(age)}h old.` };
    }
    return { ok: true, stale: false, text: null };
  }
}

/* --------------------------------------------------------------- meetings */

/* Reconciles meeting notes — including everything the Granola importer writes —
 * with the recurring series, and makes each one render as a Uptick meeting
 * record.
 *
 * Non-destructive by rule: imported content is never rewritten, reordered, or
 * remapped. We only ADD frontmatter, the view block, and any missing standard
 * headings. Granola's own headings stay exactly as imported and are surfaced
 * by the meeting view under "Imported notes". */
class Meetings {
  constructor(app, store, recur) {
    this.app = app;
    this.store = store;
    this.recur = recur;
  }

  /* Is this an actual meeting record? Folder indexes and series definitions
   * live in the same tree and must never be normalized into meeting notes.
   * Every entry point uses this — reconcileAll AND the create handler. */
  isMeetingNote(file) {
    if (!file || file.extension !== "md") return false;
    if (!file.path.startsWith(P.meetings + "/")) return false;
    if (file.path.startsWith(P.recurring + "/")) return false;
    if (file.basename === "Meetings") return false;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    if (String(fm.type ?? "") === "folder-index") return false;
    return true;
  }

  /** Every meeting note, excluding indexes and series definitions. */
  notes() {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isMeetingNote(f));
  }

  dateOf(file, fm) {
    const raw = fm?.meeting_date ?? fm?.date;
    if (raw) {
      const m = moment(String(raw), "YYYY-MM-DD", true);
      if (m.isValid()) return m;
      const loose = moment(String(raw));
      if (loose.isValid()) return loose;
    }
    const fromName = String(file.basename).match(/^(\d{4}-\d{2}-\d{2})/);
    if (fromName) {
      const m = moment(fromName[1], "YYYY-MM-DD", true);
      if (m.isValid()) return m;
    }
    return null;
  }

  /** Series this note belongs to, by explicit key then by title. */
  matchSeries(file, fm) {
    const all = this.recur.series();
    const key = String(fm?.series ?? "").toLowerCase();
    if (key) {
      const hit = all.find((s) => String(s.fm.series ?? "").toLowerCase() === key);
      if (hit) return hit;
    }
    /* Compare slugs, not raw titles. Granola writes both
     *   "2026-08-18 - Team Daily Standup"  and
     *   "salesforce-team-daily-standup-2026-08-17--ab9ef4f5"
     * for the same meeting; only a slug comparison matches both. */
    const base = slug(file.basename);
    /* Longest series name first, so a series whose slug contains another's
     * does not lose to the shorter one. */
    return (
      [...all]
        .sort((a, b) => b.file.basename.length - a.file.basename.length)
        .find((s) => {
          const key = slug(s.fm.series ?? s.file.basename);
          return key && base.includes(key);
        }) ?? null
    );
  }

  /** Headings already present in the note. */
  headings(content) {
    return (content.match(/^##\s+(.+)$/gm) ?? []).map((h) =>
      h.replace(/^##\s+/, "").trim()
    );
  }

  /** Standard sections missing from the note. */
  missingSections(content) {
    const have = this.headings(content).map((h) => h.toLowerCase());
    return Object.values(MEETING_SECTIONS).filter(
      (h) => !have.includes(h.toLowerCase())
    );
  }

  /** Headings that are not part of the Uptick template (i.e. imported). */
  importedSections(content) {
    const std = Object.values(MEETING_SECTIONS).map((h) => h.toLowerCase());
    /* Provenance has its own card, so it is not "leftover" imported content. */
    std.push("provenance");
    return this.headings(content).filter((h) => !std.includes(h.toLowerCase()));
  }

  /**
   * Make one note a Uptick meeting record. Returns what changed.
   * Safe to run repeatedly.
   */
  async normalize(file) {
    const changed = [];
    const cache = this.app.metadataCache.getFileCache(file);
    const fm0 = cache?.frontmatter ?? {};
    const day = this.dateOf(file, fm0);
    const series = this.matchSeries(file, fm0);

    /* Frontmatter is edited by INSERTING LINES, never via processFrontMatter.
     *
     * processFrontMatter re-serializes the whole block, and YAML reads an
     * unquoted wikilink as a nested sequence — so Granola's
     *   transcript: [[2026-08-18 - Standup]]
     * came back as
     *   transcript:
     *     - - 2026-08-18 - Standup
     * silently corrupting the link. Lines we do not own are now left byte for
     * byte as the importer wrote them. */
    const add = [];
    if (fm0.type !== "meeting" && !("type" in fm0)) add.push(["type", "meeting"]);
    if (day && !fm0.meeting_date) add.push(["meeting_date", day.format("YYYY-MM-DD")]);
    if (series && !fm0.series) {
      add.push(["series", series.fm.series ?? slug(series.file.basename)]);
    }
    if (series && !fm0.time && series.fm.time) add.push(["time", `"${series.fm.time}"`]);

    const cls = toArray(fm0.cssclasses).map(String);
    const needCls = !cls.includes("life-os") || !cls.includes("max");

    if (add.length || needCls) {
      await this.app.vault.process(file, (data) => {
        if (!data.startsWith("---")) {
          const head = ["---", ...add.map(([k, v]) => `${k}: ${v}`),
            "cssclasses:", "  - life-os", "  - max", "---", ""].join("\n");
          return head + data;
        }
        const end = data.indexOf("\n---", 3);
        if (end === -1) return data;

        /* See setFrontMatter: keep block's leading newline and rest's closing
         * fence so the delimiters survive round-tripping. */
        let block = data.slice(3, end);
        const rest = data.slice(end);

        for (const [k, v] of add) {
          if (!new RegExp(`^${k}\\s*:`, "m").test(block)) block += `\n${k}: ${v}`;
        }

        if (needCls) {
          const merged = [...new Set([...cls, "life-os", "max"])];
          const yaml = ["cssclasses:", ...merged.map((c) => `  - ${c}`)].join("\n");
          block = /^cssclasses\s*:/m.test(block)
            ? block.replace(/^cssclasses\s*:(?:.*)(?:\n[ \t]+-.*)*/m, yaml)
            : block + "\n" + yaml;
        }

        return "---" + block + rest;
      });
      changed.push(...add.map(([k]) => k));
      if (needCls) changed.push("cssclasses");
    }

    const content = await this.app.vault.read(file);
    const needsBlock = !/```life-os[\s\S]*?```/.test(content);
    const missing = this.missingSections(content);

    if (needsBlock || missing.length) {
      await this.app.vault.process(file, (data) => {
        let out = data;

        if (needsBlock) {
          /* Insert directly after frontmatter so the dashboard is the first
           * thing in the note, above the imported body. */
          const fmEnd = out.startsWith("---") ? out.indexOf("\n---", 3) : -1;
          const block = "\n```life-os\nview: meeting\n```\n";
          if (fmEnd !== -1) {
            const cut = out.indexOf("\n", fmEnd + 1) + 1;
            out = out.slice(0, cut) + block + out.slice(cut);
          } else {
            out = block + "\n" + out;
          }
          changed.push("view block");
        }

        if (missing.length) {
          const tail = out.endsWith("\n") ? "" : "\n";
          out += tail + "\n" + missing.map((h) => `## ${h}\n`).join("\n");
          changed.push(`${missing.length} sections`);
        }
        return out;
      });
    }

    return { file, series, day, changed };
  }

  /** Normalize every meeting note. Returns a summary. */
  async reconcileAll() {
    const results = [];
    for (const f of this.notes()) {
      try {
        const r = await this.normalize(f);
        if (r.changed.length) results.push(r);
      } catch (e) {
        console.error("Uptick: failed to normalize", f.path, e);
      }
    }
    return results;
  }

  /** Meeting notes for a given day, with their matched series (if any). */
  onDay(day) {
    const iso = day.format("YYYY-MM-DD");
    const out = [];
    for (const f of this.notes()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const d = this.dateOf(f, fm);
      if (!d || d.format("YYYY-MM-DD") !== iso) continue;
      out.push({ file: f, fm, series: this.matchSeries(f, fm) });
    }
    return out;
  }
}

/* ----------------------------------------------------------------- modals */

/* Sidebar buttons and section editors need input from outside a rendered
 * block, where inline forms are unreliable — Live Preview re-renders code
 * blocks on its own schedule and would discard them mid-typing. */
class PromptModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.done = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("lifeos-modal");
    el(contentEl, "h3", "lifeos-modal-title", this.opts.title);
    if (this.opts.help) el(contentEl, "div", "lifeos-modal-help", this.opts.help);

    const multi = !!this.opts.multiline;
    const field = multi
      ? contentEl.createEl("textarea", { cls: "lifeos-textarea" })
      : contentEl.createEl("input", { cls: "lifeos-input" });
    field.placeholder = this.opts.placeholder ?? "";
    field.value = this.opts.value ?? "";
    if (multi) field.style.minHeight = "150px";

    const bar = el(contentEl, "div", "lifeos-capture-bar");
    const cancel = el(bar, "button", "lifeos-btn", "Cancel");
    const ok = el(bar, "button", "lifeos-btn lifeos-btn-primary", this.opts.cta ?? "Save");

    const finish = (v) => {
      if (this.done) return;
      this.done = true;
      this.resolve(v);
      this.close();
    };

    ok.onclick = () => finish(field.value);
    cancel.onclick = () => finish(null);
    field.onkeydown = (e) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter" && (!multi || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(field.value);
      }
    };

    window.setTimeout(() => field.focus(), 20);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.done) {
      this.done = true;
      this.resolve(null);
    }
  }
}

function prompt(app, opts) {
  return new Promise((resolve) => new PromptModal(app, opts, resolve).open());
}

/* A small multi-field form. Field types: text, number, select, weekdays.
 * Resolves to an object of values, or null when cancelled. */
class FormModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.done = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("lifeos-modal");
    el(contentEl, "h3", "lifeos-modal-title", this.opts.title);
    if (this.opts.help) el(contentEl, "div", "lifeos-modal-help", this.opts.help);

    const state = {};
    const rows = el(contentEl, "div", "lifeos-form");

    for (const f of this.opts.fields) {
      const row = el(rows, "div", "lifeos-formrow");
      el(row, "label", "lifeos-formlabel", f.label);
      state[f.key] = f.value ?? "";

      if (f.type === "select") {
        const sel = row.createEl("select", { cls: "lifeos-input" });
        for (const o of f.options) {
          const opt = sel.createEl("option", { text: o });
          opt.value = o;
        }
        sel.value = String(f.value ?? f.options[0]);
        sel.onchange = () => {
          state[f.key] = sel.value;
          if (f.onChange) f.onChange(sel.value, rows);
        };
      } else if (f.type === "weekdays") {
        const chips = el(row, "div", "lifeos-daypick");
        const chosen = new Set(toArray(f.value).map((d) => String(d).toLowerCase()));
        for (const d of ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]) {
          const c = el(chips, "span", "lifeos-daychip", d.slice(0, 3).toUpperCase());
          if (chosen.has(d)) c.addClass("is-on");
          c.onclick = () => {
            if (chosen.has(d)) { chosen.delete(d); c.removeClass("is-on"); }
            else { chosen.add(d); c.addClass("is-on"); }
            state[f.key] = [...chosen];
          };
        }
        state[f.key] = [...chosen];
      } else {
        const inp = row.createEl("input", { cls: "lifeos-input" });
        inp.type = f.type === "number" ? "number" : "text";
        inp.placeholder = f.placeholder ?? "";
        inp.value = String(f.value ?? "");
        inp.oninput = () => { state[f.key] = inp.value; };
      }

      if (f.help) el(row, "div", "lifeos-formhelp", f.help);
    }

    const bar = el(contentEl, "div", "lifeos-capture-bar");
    const cancel = el(bar, "button", "lifeos-btn", "Cancel");
    const ok = el(bar, "button", "lifeos-btn lifeos-btn-primary", this.opts.cta ?? "Save");

    const finish = (v) => {
      if (this.done) return;
      this.done = true;
      this.resolve(v);
      this.close();
    };
    ok.onclick = () => finish(state);
    cancel.onclick = () => finish(null);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.done) { this.done = true; this.resolve(null); }
  }
}

function form(app, opts) {
  return new Promise((resolve) => new FormModal(app, opts, resolve).open());
}

/* ------------------------------------------------------------ header bar */

function renderHeader(plugin, root, crumbs) {
  const bar = el(root, "div", "lifeos-topbar");

  const brand = el(bar, "div", "lifeos-topbrand");
  el(brand, "div", "lifeos-nav-mark", "OS");
  const bt = el(brand, "div", null);
  el(bt, "div", "lifeos-topbrand-title", "Uptick");
  el(bt, "div", "lifeos-topbrand-sub", "Local workspace");

  const search = el(bar, "div", "lifeos-topsearch");
  const input = search.createEl("input", { cls: "lifeos-input" });
  input.placeholder = "Search Uptick…";
  input.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const q = input.value.trim();
    if (!q) return;
    /* Hand off to Obsidian's own search rather than reimplementing it. */
    const leaf = plugin.app.workspace.getLeavesOfType("search")[0];
    if (leaf) {
      plugin.app.workspace.revealLeaf(leaf);
      leaf.view.setQuery?.(q);
    } else {
      plugin.app.internalPlugins?.getPluginById("global-search")
        ?.instance?.openGlobalSearch?.(q);
    }
  };
  mkBtn(search, "Launcher", () =>
    plugin.app.commands.executeCommandById("command-palette:open"));

  const acts = el(bar, "div", "lifeos-topacts");
  mkBtn(acts, "Home", () => plugin.go("home"));
  mkBtn(acts, "Today", () => plugin.go("today"));
  mkBtn(acts, "Create", () => plugin.quickCreate());
  mkBtn(acts, "Reviews", () => plugin.open(`${P.weekly}/Weekly.md`));
  mkBtn(acts, WEB_APPS.copilot.label, () => plugin.openWeb(WEB_APPS.copilot.url));

  if (crumbs && crumbs.length) {
    const cb = el(root, "div", "lifeos-crumbs");
    crumbs.forEach((c, i) => {
      if (i) el(cb, "span", "lifeos-crumb-sep", "›");
      const node = el(cb, "span", i === crumbs.length - 1 ? "lifeos-crumb-cur" : "lifeos-crumb", c.label);
      if (c.path) onTap(node, () => plugin.open(c.path));
    });
  }
}

/* -------------------------------------------------------------- nav panel */

const NAV = [
  { section: null, items: [
    { label: "Today", icon: "sun", action: "today" },
    { label: "Home", icon: "home", action: "home" },
  ]},
  { section: "Plan", items: [
    { label: "Daily", icon: "calendar", action: "daily" },
    { label: "Tasks", icon: "check-circle", action: "tasks" },
    { label: "Quest Log", icon: "trophy", action: "quest" },
    { label: "Achievements", icon: "medal", action: "achievements" },
    { label: "Reward Bank", icon: "coin", action: "bank" },
  ]},
  { section: "Study", items: [
    { label: "LearnKit", icon: "cards", action: "learnkit" },
    { label: "Coach", icon: "target", action: "coach" },
    { label: "Practice Exams", icon: "exam", action: "exams" },
    { label: "Library", icon: "library", action: "library" },
  ]},
  { section: "Work", items: [
    { label: "Projects", icon: "target", action: "projects" },
    { label: "Areas", icon: "layers", action: "areas" },
  ]},
  { section: "Knowledge", items: [
    { label: "Notes", icon: "file-text", action: "knowledge" },
    { label: "Resources", icon: "bar-chart", action: "sources" },
  ]},
  { section: "Web", items: [
    { label: "Copilot", icon: "sparkle", action: "web-copilot" },
  ]},
  { section: null, items: [
    { label: "Settings", icon: "settings", action: "settings" },
  ]},
];

/* Sidebar entries that only make sense while their module is on. */
const NAV_MODULE = {
  quest: "game", achievements: "game", bank: "game",
  learnkit: "study", coach: "study", exams: "study",
  /* Library stays visible when off — the view explains what turning it on does. */
};

const QUICK = [
  { group: "Work", items: [
    { label: "New Project", icon: "target", action: "new-project" },
    { label: "New Meeting Note", icon: "users", action: "new-meeting" },
  ]},
  { group: "Knowledge", items: [
    { label: "New Note", icon: "file-plus", action: "new-note" },
  ]},
];


/* ---------------------------------------------------------------- the tour */

/* A guided walkthrough, hosted in the right sidebar rather than a modal.
 *
 * The whole point is that it can take you to a page and stay visible while you
 * look at it — a modal would have to close to show you anything, which is how
 * most product tours end up being read rather than followed.
 *
 * Steps describe what exists. Where something needs setup that Uptick cannot
 * do for you (a macOS importer, a scheduled job), the step says so plainly
 * rather than implying a button will handle it. */

const TOUR_VIEW = "life-os-tour";
const NATIVE_TAG_SHORTCUT_URL = "https://www.icloud.com/shortcuts/5a4692ef11c14845a29920ea42e7e953";

function tourSteps(plugin) {
  const cfg = plugin.cfg;
  const p = cfg.paths;
  return [
    // ---- what this is
    {
      chapter: "Welcome",
      title: "Uptick",
      body: [
        "A workspace for your day: dashboards over the notes you already keep, "
        + "tasks in one file, and an optional layer that turns finishing things "
        + "into levels and achievements.",
        "Everything is plain Markdown in your vault. Core dashboards are "
        + "local-first; optional Weather, Library, and AI companions make "
        + "network requests only when you configure and use them.",
        "This walkthrough takes about ten minutes and moves around the app as "
        + "it goes. You can leave and come back — it remembers where you were.",
      ],
    },
    {
      chapter: "Welcome",
      title: "Make the folders",
      body: [
        "Uptick needs somewhere to keep daily notes, tasks and meetings. Setup "
        + "creates those folders and a Home note, and never overwrites anything.",
        "If you already have folders you use, skip this and point Uptick at "
        + "them instead — Settings → Paths. Either works.",
      ],
      actions: [
        { label: "Run setup", run: async () => {
          const made = await plugin.runSetup({ open: true });
          new Notice(made.folders.length || made.notes.length || made.icons
            ? `Created ${made.folders.length} folders, ${made.notes.length} notes`
              + (made.icons ? ` and ${made.icons} achievement icons` : "")
            : "Everything was already here");
        } },
        { label: "I already have folders", run: () => plugin.openSettings("Paths") },
      ],
    },

    // ---- the daily loop
    {
      chapter: "The daily loop",
      title: "Home",
      configurable: "Layout",
      body: [
        "Home answers one question: what does today look like. Open tasks, "
        + "today's meetings, unread mail, what you finished this week.",
        "Every card here can be switched off. If a card is empty it usually "
        + "means there are no notes of that kind yet, not that something broke.",
      ],
      action: { label: "Open Home", run: () => plugin.open(P.home) },
    },
    {
      chapter: "The daily loop",
      title: "Today",
      configurable: "Layout",
      body: [
        "Each day gets a note. Rather than editing headings, you fill cards: "
        + "what matters today, a work log as you go, and an end-of-day review.",
        "The work log is the one people underrate. Two lines a day gives you a "
        + "record of where the time actually went, which is the raw material "
        + "for every weekly review you will ever write.",
      ],
      action: { label: "Open today", run: () => plugin.openDaily(moment()) },
    },
    {
      chapter: "The daily loop",
      title: "One task file",
      body: [
        `Every task lives in ${p.taskInbox} as a Markdown checkbox tagged `
        + "#task. The board, the dashboards and the counters are all views over "
        + "that one file.",
        "That matters because it means your tasks stay yours: plain text, "
        + "greppable, diffable, and readable if you never open this plugin again.",
      ],
      action: { label: "Open the task inbox", run: () => plugin.open(P.taskInbox) },
    },

    // ---- how tasks get scored
    {
      chapter: "Tasks",
      title: "Two axes, not one",
      configurable: "Experience",
      body: [
        "Tasks are scored on two independent things. **Priority** (1–10) is "
        + "should I do this now. **Difficulty** (1–5) is what it costs me.",
        "They are deliberately separate. A trivial task can be critical — send "
        + "the email now — and an epic one can be low priority. Collapsing them "
        + "into a single number makes both useless.",
        "Scoring is deterministic: rules over the task's own words, not an AI "
        + "call. The same task scores the same way tomorrow.",
      ],
    },
    {
      chapter: "Tasks",
      title: "How difficulty is scored",
      configurable: "Experience",
      body: [
        "The leading verb decides the class, and everything else adjusts within "
        + "it. \"Follow up with Sam about the migration\" is a question you ask "
        + "someone, however many heavy nouns follow it.",
        "Difficulty sets what a finished task is worth: 10, 25, 50, 100 or 200 XP.",
        "When the rules get it wrong, write `[difficulty:: 4!]`. The trailing "
        + "`!` means you set it by hand, and nothing will recompute it.",
      ],
    },
    {
      chapter: "Tasks",
      title: "Where tasks come from",
      body: [
        "You can write them yourself — Quick Capture on Home, or the task file "
        + "directly.",
        "They can also be extracted for you, from meeting notes and from mail. "
        + "That part is macOS-only and needs setting up outside Obsidian; the "
        + "next few steps explain what is involved before you decide.",
        "None of it is required. Uptick works fine with tasks you type.",
      ],
    },
    {
      chapter: "Tasks",
      title: "Connecting a model",
      body: [
        "Three optional features send text to a language model: mail triage, "
        + "the meeting import, and the Reminders workflow assistant. **Nothing else does.** XP, levels, all 258 "
        + "achievements and exam readiness are arithmetic over your own notes "
        + "and work with none of this set up.",
        "Bring whichever provider you already pay for. Settings \u2192 Modules "
        + "\u2192 AI lists Anthropic, OpenAI, Google, DeepSeek, Moonshot, "
        + "Zhipu, Qwen, MiniMax, Groq, Mistral, xAI, OpenRouter, a local "
        + "Ollama, or the Codex CLI if you are already signed in to one.",
        "**Your key is never stored in the vault.** That settings file lives "
        + "in .obsidian/ and syncs wherever your vault syncs \u2014 a key "
        + "written there would be a key on every machine and in every backup. "
        + "Uptick reads it from an environment variable, or a file outside the "
        + "vault, and refuses a key file inside one.",
        "Check it before relying on it: `VAULT=\"<your vault>\" python3 "
        + "optional/llm.py` prints what is configured and what is missing.",
      ],
      actions: [
        { label: "Set up a model", run: () => plugin.openSettings("Modules") },
        { label: "What triage decided", run: () => plugin.openSettings("Mail") },
      ],
    },
    {
      chapter: "Tasks",
      title: "Mail → tasks (macOS)",
      mac: true,
      body: [
        "`optional/email-import.py` reads Apple Mail through AppleScript, "
        + "**read-only**, and writes each message as a reference note with a "
        + "summary and any action items it can find.",
        "Without triage, a phrase match cannot reliably distinguish an action "
        + "asked of you from a request aimed at someone else. Run "
        + "`optional/mail-triage.py` first: it classifies mail before import, "
        + "so only important messages are considered for vault references and "
        + "explicit action items.",
        "It needs Python and permission for Mail. It never sends, deletes or "
        + "marks anything.",
      ],
      action: { label: "See the script", run: () => window.open(
        "https://github.com/jcranokc/obsidian-uptick-public/blob/main/optional/email-import.py", "_blank") },
    },
    {
      chapter: "Tasks",
      title: "Reading the triage",
      mac: true,
      body: [
        "Settings \u2192 Mail shows what the last run decided, and \u2014 more "
        + "usefully \u2014 what it could not read. Some Apple Mail messages expose "
        + "no usable body; those can be noted for review but never create a "
        + "task from a subject line alone.",
        "It also lists every sender it has stopped reading. A sender is muted "
        + "after three separate unimportant messages, or immediately if it is "
        + "an automated address. One important message un-mutes them.",
        "**Check that list occasionally.** Muting is the part that can quietly "
        + "lose you something, so it is always visible and always reversible.",
      ],
      actions: [
        { label: "Open Mail settings", run: () => plugin.openSettings("Mail") },
      ],
    },
    {
      chapter: "Tasks",
      title: "Meetings → tasks",
      mac: true,
      body: [
        "`optional/granola-sync.sh` imports newly finished meetings and creates "
        + "tasks only for explicit commitments.",
        "The prompt is the safety mechanism: it is told to preserve human "
        + "writing, deduplicate on the meeting id, and make no changes when "
        + "nothing is new. Read it before you run it.",
        "It uses the Codex CLI and your configured Granola MCP access. Those "
        + "are separate from Uptick's optional AI settings, so verify the "
        + "command can run successfully before scheduling it.",
      ],
      action: { label: "See the script", run: () => window.open(
        "https://github.com/jcranokc/obsidian-uptick-public/blob/main/optional/granola-sync.sh", "_blank") },
    },
    {
      chapter: "Tasks",
      title: "Messages (macOS)",
      mac: true,
      body: [
        "`optional/messages-import.py` reads your local iMessage database and "
        + "writes a browsable, read-only catalogue of threads into the vault.",
        "Optional task capture is separate and disabled until you enable it. "
        + "Both need Full Disk Access, which is a real permission to weigh — "
        + "the importer can read messages on the machine.",
      ],
    },
    {
      chapter: "Tasks",
      title: "Native Reminders tags (macOS)",
      mac: true,
      body: [
        "The Reminders bridge keeps the portable task projection in sync. "
        + "Apple's native tag metadata needs a Shortcuts step after that bridge "
        + "finishes, so tags remain useful in Apple Reminders itself.",
        "Install the shared **Uptick Apply Native Reminder Tags** Shortcut on "
        + "your Mac, then run the one-command scheduler installer from the "
        + "public source checkout. It runs the bridge first and the Shortcut "
        + "second every ten minutes, even while Obsidian is closed.",
        "Apple shows the Shortcut installation prompt and Reminders permission "
        + "request itself. Uptick can open the link and verify the local setup, "
        + "but it cannot accept those permissions for you.",
      ],
      actions: [
        { label: "Install the tag Shortcut", run: () => window.open(NATIVE_TAG_SHORTCUT_URL, "_blank") },
        { label: "Open Reminders settings", run: () => plugin.openSettings("Reminders") },
      ],
    },

    // ---- experience
    {
      chapter: "Experience",
      title: "What earns XP",
      configurable: "Experience",
      body: [
        "Finishing a task pays its difficulty in XP, times a bit more if you "
        + "were early and a bit less if you were late. Late still pays — "
        + "finishing is always better than not.",
        "Studying pays per card. Filling in what matters today, writing a work "
        + "log entry, closing out the day: small amounts, deliberately. If a log "
        + "entry paid like shipping a deployment, the log becomes the game.",
      ],
      module: "game",
    },
    {
      chapter: "Experience",
      title: "Levels and ranks",
      body: [
        "XP accumulates into levels on a curve that makes the first few quick "
        + "and level 50 a year-long arc. Every ten levels renames you: Operator, "
        + "Technician, Specialist, Architect, and up.",
        "Your Character page shows where the XP came from and a thirty-day trend.",
      ],
      module: "game",
      action: { label: "Open Character", run: () => plugin.open(P.character) },
    },
    {
      chapter: "Experience",
      title: "Overdue costs you",
      configurable: "Experience",
      body: [
        "A task past its due date loses XP daily, escalating. That is the "
        + "incentive, and it needs guards or it becomes a machine that only ever "
        + "tells you you are failing.",
        "So: one day of grace, a per-task ceiling, and a daily cap tied to what you "
        + "have been earning. Your level and rank are derived from current XP, so "
        + "decay can lower them when it crosses a threshold.",
        "Tag a task #blocked or #dependency and its clock stops — no decay, no XP, and "
        + "unblocking costs one day rather than every day it waited.",
      ],
      module: "game",
    },
    {
      chapter: "Experience",
      title: "258 achievements",
      body: [
        "Some are volume, some are timing, some are craft. A few reward honesty "
        + "rather than performance — grading a flashcard \"Again\", re-rating a "
        + "task harder, cancelling work you are never going to do.",
        "None of them pay for opening the app. The usual failure of badge "
        + "systems is rewarding presence.",
        "Unlocks pop up with artwork if you add any; otherwise a tier medallion.",
      ],
      module: "game",
      action: { label: "Open Achievements", run: () => plugin.open(P.achievements) },
    },
    {
      chapter: "Experience",
      title: "Reading an achievement",
      body: [
        "Click any tile and it tells you what it is, how it is earned, and how "
        + "far along you are. Locked ones show a bar; earned ones replay the "
        + "unlock.",
        "About a hundred are marked *by hand* \u2014 the engine cannot see "
        + "them, so you award them yourself in the Achievements note. That is "
        + "deliberate: some of the things worth rewarding are not things a "
        + "script can measure.",
        "Achievement art ships in `art-bundle.json`, the fourth release asset. "
        + "Setup writes bundled icons without overwriting your own. A missing "
        + "icon falls back to a tier medallion, which is a normal state rather "
        + "than a broken one.",
      ],
      module: "game",
      actions: [
        { label: "Browse achievements", run: () => plugin.open(P.achievements) },
      ],
    },
    {
      chapter: "Experience",
      title: "The Reward Bank",
      configurable: "Rewards",
      body: [
        "XP converts to a money figure you have earned the right to spend, "
        + "filling toward goals you name. Nothing here moves money — it is a "
        + "scoreboard and a permission slip.",
        "Banking runs on net daily XP floored at zero, so a bad day banks "
        + "nothing and the balance never goes backwards.",
      ],
      module: "game",
      action: { label: "Open the Reward Bank", run: () => plugin.open(P.bank) },
    },
    {
      chapter: "Experience",
      title: "Making it count",
      body: [
        "None of that happens on its own. **Recalculate** reads your tasks and "
        + "notes, works out what you have earned, and writes it down. Run it "
        + "when you want your numbers to catch up \u2014 end of the day is a "
        + "natural time.",
        "It is safe to run twice. Every event carries an id, so a second run "
        + "adds nothing it has already counted.",
        "Two things still need Python on a schedule: exam readiness, and the "
        + "card counts on Home. Everything else \u2014 XP, levels, streaks, all "
        + "258 achievements, the Reward Bank \u2014 runs here.",
      ],
      module: "game",
      actions: [
        { label: "Recalculate now", run: async () => { await plugin.recalculate(); } },
        { label: "Open the Quest Log", run: () => plugin.open(P.quest) },
      ],
    },

    // ---- study
    {
      chapter: "Study",
      title: "Flashcards and decks",
      body: [
        "If you have the LearnKit plugin, Uptick reads its decks and pays XP "
        + "for reviews. Cards live in your notes as Markdown; LearnKit schedules "
        + "them with FSRS.",
        "Uptick adds what LearnKit does not: blueprint weighting and exam "
        + "performance.",
      ],
      module: "study",
      action: { label: "Open LearnKit", run: () => plugin.openLearnKit("home") },
    },
    {
      chapter: "Study",
      title: "Exam readiness",
      body: [
        "For a certification, Uptick blends four things into one number: how "
        + "much of the blueprint you have covered, whether your cards will still "
        + "be remembered on exam day, how you score on practice exams, and how "
        + "consistent those scores are.",
        "Practice scores are adjusted before they count — retakes of the same "
        + "test are discounted, old attempts weigh less, and seven points come "
        + "off for the gap between practice and the real thing.",
        "Hard gates stop it flattering you: without three full practice exams it "
        + "will not go above 60, whatever your cards say.",
      ],
      module: "study",
      action: { label: "Open the Quest Log", run: () => plugin.open(P.quest) },
    },
    {
      chapter: "Study",
      title: "Shared decks",
      body: [
        "The Library is an index of decks other people have written. Install one "
        + "in a click; publish your own with a guided export that writes the "
        + "licence and README for you.",
        "It is off until you turn it on. Weather and optional AI companions also "
        + "use the network only after you configure them. Nothing is uploaded "
        + "without you doing it deliberately.",
      ],
      module: null,
      actions: [
        { label: "Turn it on", run: () => plugin.openSettings("Modules") },
        { label: "Open the Library", run: () => plugin.openLibrary() },
      ],
    },

    // ---- configure
    {
      chapter: "Make it yours",
      title: "Settings, tab by tab",
      body: [
        "**Paths** matters most if your vault is already laid out differently \u2014 "
        + "point each folder at what you use rather than moving anything.",
        "**Modules** turns whole features off, and holds the AI and Library "
        + "switches. **Layout** hides individual cards on Home and daily notes. "
        + "**Mail** shows what triage decided and which senders it has stopped "
        + "reading. **Experience** and **Rewards** let you rewrite every XP "
        + "rate \u2014 the engine reads the same numbers you see there.",
        "Nothing here is destructive. Every tab changes what Uptick reads or "
        + "shows; none of it edits your notes.",
      ],
      actions: [
        { label: "Paths", run: () => plugin.openSettings("Paths") },
        { label: "Modules", run: () => plugin.openSettings("Modules") },
        { label: "Experience", run: () => plugin.openSettings("Experience") },
      ],
    },
    {
      chapter: "Make it yours",
      title: "What runs automatically",
      body: [
        "The base dashboards do not run background jobs. After you install a "
        + "companion, its behavior is explicit: the Reminders scheduler runs "
        + "every ten minutes; iMessage capture and sent-mail completion run "
        + "inside that sync when enabled.",
        "Mail import runs once when desktop Obsidian opens, and you can run "
        + "Import today's mail again from the command palette. Calendar, "
        + "Granola, Photos, and scheduled weather refreshes stay opt-in because "
        + "they need separate permissions, local app setup, or an API key.",
        "Integration signals say whether a source is fresh, stale, disabled, "
        + "or has never run. A missing signal is a setup prompt, not evidence "
        + "that data was imported.",
      ],
      action: { label: "Open Modules", run: () => plugin.openSettings("Modules") },
    },
    {
      chapter: "Make it yours",
      title: "That is the tour",
      body: [
        "A reasonable first week: write tasks, fill in what matters today, and "
        + "keep a work log. Add the experience layer once the daily habit is "
        + "there — it rewards a loop that already exists rather than creating one.",
        "You can reopen this from Settings → Setup, or the command palette.",
      ],
      action: { label: "Finish", run: async () => {
        await plugin.setCfg("tour.done", true);
        new Notice("Tour finished. Reopen it any time from Settings.");
      } },
    },
  ];
}

class TourView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return TOUR_VIEW; }
  getDisplayText() { return "Uptick tour"; }
  getIcon() { return "compass"; }
  async onOpen() { this.render(); }

  get index() {
    const n = Number(cfgGet(this.plugin.cfg, "tour.step", 0)) || 0;
    return Math.max(0, Math.min(n, this.steps().length - 1));
  }

  steps() {
    const all = tourSteps(this.plugin);
    /* Steps for a module that is off would describe something the reader
     * cannot see. Skipped rather than shown greyed out. */
    return all.filter((s) => !s.module || this.plugin.on(s.module));
  }

  async go(n) {
    await this.plugin.setCfg("tour.step", n);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lifeos-tour");

    const steps = this.steps();
    const i = this.index;
    const step = steps[i];
    if (!step) return;

    const head = el(root, "div", "lifeos-tour-head");
    el(head, "div", "lifeos-tour-chapter", step.chapter.toUpperCase());
    el(head, "div", "lifeos-tour-count", `${i + 1} / ${steps.length}`);

    const track = el(root, "div", "lifeos-bar lifeos-bar-sm");
    el(track, "div", "lifeos-bar-fill").style.width =
      `${((i + 1) / steps.length) * 100}%`;

    el(root, "h2", "lifeos-tour-title", step.title);
    if (step.mac) el(root, "div", "lifeos-tour-mac", "macOS only \u00B7 needs setup outside Obsidian");

    for (const para of step.body) {
      const d = el(root, "div", "lifeos-tour-para");
      setRich(d, para);
    }

    /* A step may offer several destinations: the thing it describes, and the
     * place you change it. One button per step meant the second was written
     * out as a sentence and never followed. */
    const actions = [...(step.actions || (step.action ? [step.action] : []))];
    /* Any step that describes behaviour you can change gets a link to the tab
     * that changes it, without every step restating where that is. */
    if (step.configurable) {
      actions.push({ label: `Change this \u2192 ${step.configurable}`,
                     run: () => this.plugin.openSettings(step.configurable) });
    }
    if (actions.length) {
      const bar = el(root, "div", "lifeos-tour-action");
      actions.forEach((a, n) => mkBtn(bar, a.label, () => a.run(),
                                      n === 0 ? "primary" : undefined));
    }

    const nav = el(root, "div", "lifeos-tour-nav");
    if (i > 0) mkBtn(nav, "Back", () => this.go(i - 1));
    if (i < steps.length - 1) {
      mkBtn(nav, "Next", () => this.go(i + 1), "primary");
    } else {
      mkBtn(nav, "Close", async () => {
        await this.plugin.setCfg("tour.done", true);
        this.leaf.detach();
      }, "primary");
    }

    const foot = el(root, "div", "lifeos-tour-foot");
    const chapters = [...new Set(steps.map((s) => s.chapter))];
    for (const c of chapters) {
      const at = steps.findIndex((s) => s.chapter === c);
      const chip = el(foot, "span",
        `lifeos-tour-jump${c === step.chapter ? " is-on" : ""}`, c);
      onTap(chip, () => this.go(at));
    }
    const skip = el(root, "div", "lifeos-tour-skip", "Skip the tour");
    onTap(skip, async () => {
      await this.plugin.setCfg("tour.done", true);
      this.leaf.detach();
    });
  }
}

class NavView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return NAV_VIEW; }
  getDisplayText() { return "Uptick"; }
  getIcon() { return "layout-dashboard"; }

  async onOpen() { this.render(); }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lifeos-nav");

    const brand = el(root, "div", "lifeos-nav-brand");
    el(brand, "div", "lifeos-nav-mark", "OS");
    const bt = el(brand, "div", "lifeos-nav-brandtext");
    el(bt, "div", "lifeos-nav-title", "Uptick");
    el(bt, "div", "lifeos-nav-sub", this.app.vault.getName());

    for (const group of NAV) {
      const items = group.items.filter((i) =>
        !NAV_MODULE[i.action] || this.plugin.on(NAV_MODULE[i.action]));
      if (!items.length) continue;
      if (group.section) el(root, "div", "lifeos-nav-section", group.section.toUpperCase());
      for (const item of items) {
        const b = el(root, "div", "lifeos-nav-item");
        el(b, "span", "lifeos-nav-icon").setText(iconFor(item.icon));
        el(b, "span", "lifeos-nav-label", item.label);
        b.onclick = () => this.plugin.go(item.action);
      }
    }

    el(root, "div", "lifeos-nav-spacer");
    el(root, "div", "lifeos-nav-section", "QUICK CREATE");
    for (const group of QUICK) {
      el(root, "div", "lifeos-nav-subsection", group.group.toUpperCase());
      for (const item of group.items) {
        const b = el(root, "div", "lifeos-nav-quick");
        el(b, "span", "lifeos-nav-icon").setText(iconFor(item.icon));
        el(b, "span", "lifeos-nav-label", item.label);
        b.onclick = () => this.plugin.go(item.action);
      }
    }
  }
}

/* Text glyphs rather than Obsidian's icon set: keeps the sidebar legible at
 * small sizes and avoids depending on internal icon names. */
function iconFor(name) {
  return {
    sun: "☀", home: "⌂", calendar: "▤", "check-circle": "◎", target: "◈",
    layers: "▧", "file-text": "▤", "bar-chart": "▥", users: "◐",
    "file-plus": "＋", settings: "⚙", sparkle: "✦", trophy: "♦", medal: "◉",
    cards: "▭", book: "▤", award: "✧", exam: "▣", coin: "◈", library: "▥",
  }[name] ?? "•";
}

/* ------------------------------------------------------------------ plugin */

/* ===================== BEGIN uptick-engine.js ===================== */
/* Generated by tools/inline-engine.py from engine/uptick-engine.js.
 * Do not edit here. Edit the engine, re-run the tool, and let
 * parity_test.js and sync_parity_test.js confirm nothing moved.
 *
 * Wrapped in an IIFE because main.js has its own RANKS, rankFor and
 * levelThreshold for the view layer, and the engine's would collide. */
const Engine = (function () {
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

return {
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
})();
/* ====================== END uptick-engine.js ====================== */

module.exports = class Uptick extends Plugin {
  async onload() {
    this.store = new Store(this.app);
    this.recur = new Recurrence(this.app);
    this.tasks = new Tasks(this.app, this.store);
    this.meetings = new Meetings(this.app, this.store, this.recur);
    this.calendars = new Calendars(this.app);
    this.contacts = new Contacts(this.app);
    this.emails = new Emails(this.app);
    this.game = new Game(this.app);
    this.library = new Library(this);
    /* data.json is shared with the mail importer, so every write merges rather
     * than replaces. */
    this.settings = (await this.loadData()) ?? {};
    this.cfg = mergeCfg(DEFAULTS, this.settings.config || {});
    /* Persist the merged shape once so existing installs gain the new
     * workflow/reminder defaults without touching unrelated top-level data. */
    if (JSON.stringify(this.settings.config || {}) !== JSON.stringify(this.cfg)) {
      this.settings = { ...this.settings, config: this.cfg };
      await this.saveData(this.settings);
    }
    applyPaths(this.cfg);

    this.registerView(NAV_VIEW, (leaf) => new NavView(leaf, this));
    this.registerView(TOUR_VIEW, (leaf) => new TourView(leaf, this));

    /* Celebrate anything unlocked while Obsidian was closed, and again when the
     * scheduled sync rewrites the cache. Layout-ready first, or the modal races
     * the workspace and opens behind it. */
    this.app.workspace.onLayoutReady(() => {
      /* A vault with no Home note has never run setup. Do it once rather than
       * leaving the sidebar's first link pointing at nothing — that is the
       * whole first-run experience for someone installing this. */
      if (!this.app.vault.getAbstractFileByPath(P.home)) {
        this.runSetup({ open: false })
          .then(async (made) => {
            if (made.folders.length || made.notes.length) {
              new Notice("Uptick set up this vault.");
            }
            if (!cfgGet(this.cfg, "tour.done", false)) await this.openTour();
          })
          .catch(() => {});
      }
      window.setTimeout(() => this.drainUnlockQueue().catch(() => {}), 1200);
    });
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (f?.path !== P.achCache) return;
      window.clearTimeout(this._achTimer);
      this._achTimer = window.setTimeout(() => this.drainUnlockQueue().catch(() => {}), 800);
    }));

    this.addRibbonIcon("layout-dashboard", "Uptick", () => this.openNav());

    this.addCommand({
      id: "open-nav", name: "Open sidebar", callback: () => this.openNav(),
    });
    this.addCommand({
      id: "recalculate",
      name: "Recalculate XP, levels and achievements",
      callback: () => this.recalculate(),
    });
    this.addCommand({
      id: "fetch-weather",
      name: "Fetch the weather",
      callback: async () => {
        const r = await this.fetchWeather();
        new Notice(r.ok ? `Weather updated for ${r.location}` : `Weather: ${r.error}`,
                   r.ok ? 4000 : 8000);
        if (r.ok) this.refresh();
      },
    });
    this.addCommand({
      id: "open-home", name: "Open Home dashboard", callback: () => this.go("home"),
    });
    this.addCommand({
      id: "tour",
      name: "Open the guided walkthrough",
      callback: () => this.openTour(),
    });
    this.addCommand({
      id: "tour-restart",
      name: "Restart the guided walkthrough",
      callback: () => this.openTour({ restart: true }),
    });
    this.addCommand({
      id: "setup",
      name: "Set up this vault",
      callback: async () => {
        const made = await this.runSetup();
        new Notice(made.folders.length || made.notes.length
          ? `Uptick ready \u2014 ${made.folders.length} folders, ${made.notes.length} notes created`
          : "Everything Uptick needs is already here");
      },
    });
    this.addCommand({
      id: "open-achievements", name: "Open Achievements",
      callback: () => this.go("achievements"),
    });
    this.addCommand({
      id: "replay-achievement",
      name: "Replay the most recent achievement unlock",
      callback: async () => {
        const cat = await this.game.achievements();
        const got = (cat?.achievements ?? []).filter((a) => a.unlocked);
        if (!got.length) return new Notice("Nothing unlocked yet.");
        got.sort((a, b) => String(b.unlocked).localeCompare(String(a.unlocked)));
        new AchievementModal(this.app, this, got[0], []).open();
      },
    });
    this.addCommand({
      id: "open-today", name: "Open today's dashboard", callback: () => this.go("today"),
    });
    this.addCommand({
      id: "open-triage-queue", name: "Open Reminders triage queue",
      callback: () => this.openWorkflowView("triage", "Triage Queue"),
    });
    this.addCommand({
      id: "open-waiting-dashboard", name: "Open Waiting dashboard",
      callback: () => this.openWorkflowView("waiting-dashboard", "Waiting Dashboard"),
    });
    this.addCommand({
      id: "open-sync-activity", name: "Open Reminders sync activity",
      callback: () => this.openWorkflowView("sync-activity", "Sync Activity"),
    });
    this.addCommand({
      id: "open-weekly-workflow-review", name: "Open weekly workflow review",
      callback: () => this.openWorkflowView("weekly-workflow-review", "Weekly Workflow Review"),
    });
    this.addCommand({
      id: "capture-email-task", name: "Capture task from current email note",
      callback: () => this.captureEmailTask(),
    });
    this.addCommand({
      id: "capture-selected-mail-task", name: "Capture task from selected Apple Mail message",
      callback: () => this.captureSelectedEmailTask(),
    });
    this.addCommand({
      id: "open-email-completion-review", name: "Open sent email completion review",
      callback: () => this.openWorkflowView("email-completions", "Email Completion Review"),
    });
    this.addCommand({
      id: "install-native-reminder-tag-shortcut",
      name: "Install the native Reminders tag Shortcut",
      callback: () => window.open(NATIVE_TAG_SHORTCUT_URL, "_blank"),
    });

    this.addCommand({
      id: "import-mail",
      name: "Import today's mail",
      callback: async () => {
        new Notice("Importing mail… this can take a minute");
        await this.importMailDaily(true);
      },
    });

    this.addCommand({
      id: "reconcile-meetings",
      name: "Reconcile meeting notes with recurring series",
      callback: () => this.reconcileMeetings(true),
    });

    this.registerMarkdownCodeBlockProcessor("life-os", (src, elm, ctx) =>
      this.renderBlock(src, elm, ctx)
    );

    this.pendingMeetings = new Set();

    this.app.workspace.onLayoutReady(async () => {
      this.openNav(false);

      /* Register the create handler ONLY after layout is ready. Obsidian
       * replays a `create` event for every existing file while it builds its
       * index, so registering in onload would hand us the whole vault on every
       * start and normalize files that were never imported. */
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (!(file instanceof TFile)) return;
          if (!this.meetings.isMeetingNote(file)) return;
          this.pendingMeetings.add(file.path);
          window.clearTimeout(this._meetingTimer);
          this._meetingTimer = window.setTimeout(() => this.drainMeetings(), 2500);
        })
      );

      /* Catch anything imported while Obsidian was closed. */
      window.setTimeout(() => this.reconcileMeetings(false), 4000);
      /* Mail is slow to answer AppleScript; let the workspace settle first. */
      window.setTimeout(() => this.importMailDaily(false), 15000);
    });
  }

  onunload() {
    window.clearTimeout(this._meetingTimer);
    this.app.workspace.detachLeavesOfType(NAV_VIEW);
  }

  /** Normalize newly imported meeting notes. */
  /* Import today's mail, at most once a day.
   *
   * Deliberately not a launchd job: keeping it in the plugin means no system
   * changes, and it can never drift out of step with the vault it writes to.
   * The importer only looks back --hours (24 by default), so this brings in
   * today's mail going forward rather than backfilling an archive.
   *
   * `force` skips the once-a-day guard for the manual command. */
  async importMailDaily(force = false) {
    const today = moment().format("YYYY-MM-DD");
    const state = (await this.loadData()) ?? {};
    if (!force && state.lastMailImport === today) return { skipped: true };

    /* Stamp before running: a slow or failed run must not retrigger on every
     * window focus. The manual command is always available. */
    await this.saveData({ ...state, lastMailImport: today });

    const res = await this.runScript("email-import.py", []);
    let out = null;
    try {
      out = JSON.parse(res.stdout || "{}");
    } catch (e) {
      /* reported below */
    }

    if (out?.ok) {
      if (out.written) {
        new Notice(`Uptick: imported ${out.written} email${out.written === 1 ? "" : "s"}` +
          (out.linked_to_meetings ? `, ${out.linked_to_meetings} linked to meetings` : ""));
      }
      return out;
    }

    const why = (res.stderr || res.stdout || "unknown error").trim().split("\n")[0];
    console.warn("Uptick: mail import failed —", why);
    if (force) new Notice(`Mail import failed: ${why.slice(0, 150)}`);
    /* Let a failed run try again later today rather than waiting for tomorrow. */
    await this.saveData({ ...state, lastMailImport: state.lastMailImport ?? null });
    return { ok: false, error: why };
  }

  async drainMeetings() {
    const paths = [...this.pendingMeetings];
    this.pendingMeetings.clear();
    let n = 0;
    for (const p of paths) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile)) continue;
      /* Re-check at drain time: frontmatter may have been written between the
       * create event and now (Granola writes the file, then its metadata). */
      if (!this.meetings.isMeetingNote(f)) continue;
      try {
        const r = await this.meetings.normalize(f);
        if (r.changed.length) n++;
      } catch (e) {
        console.error("Uptick: normalize failed", p, e);
      }
    }
    if (n) new Notice(`Uptick: prepared ${n} imported meeting note${n === 1 ? "" : "s"}`);
  }

  async reconcileMeetings(loud) {
    const results = await this.meetings.reconcileAll();
    const linked = results.filter((r) => r.changed.includes("series")).length;
    if (loud) {
      new Notice(
        results.length
          ? `Uptick: updated ${results.length} meeting note${results.length === 1 ? "" : "s"}` +
            (linked ? `, ${linked} linked to a series` : "")
          : "Uptick: all meeting notes already reconciled"
      );
    } else if (results.length) {
      console.log("Uptick reconciled meeting notes:", results.map((r) => r.file.path));
    }
    return results;
  }

  async openNav(reveal = true) {
    const existing = this.app.workspace.getLeavesOfType(NAV_VIEW);
    if (existing.length) {
      if (reveal) this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeftLeaf(false);
    await leaf.setViewState({ type: NAV_VIEW, active: false });
    if (reveal) this.app.workspace.revealLeaf(leaf);
  }

  /* Open a URL in Obsidian's built-in Web viewer.
   *
   * A real webview, not an iframe: Microsoft 365 sends frame-ancestors headers
   * that block embedding, so an <iframe> inside a note renders blank. The
   * webview keeps its own session, so a sign-in persists between launches.
   * It follows the OS appearance, so it renders dark on a dark Mac. */
  /* Run one of this vault's automation scripts and capture its output.
   *
   * Desktop only — child_process does not exist on mobile, so callers get a
   * clear error rather than a crash. VAULT is exported so the script targets
   * this vault rather than its own default. */
  runScript(name, args = [], options = {}) {
    /* Shelling out is a personal-integration feature and ships off. An
     * install that never turns it on never reaches child_process at all. */
    const workflowAllowed = options.allowWorkflow === true && this.on("workflowAssistant");
    const messagesAllowed = options.allowMessages === true && cfgGet(this.cfg, "messagesTaskCapture.enabled", false);
    if (!this.on("sync") && !workflowAllowed && !messagesAllowed) {
      return Promise.resolve({ code: -1, stdout: "",
                               stderr: "Scheduled job control is turned off" });
    }
    return new Promise((resolve) => {
      let execFile;
      try {
        ({ execFile } = require("child_process"));
      } catch (e) {
        resolve({ code: -1, stdout: "", stderr: "Not available on mobile" });
        return;
      }
      const vaultPath = this.app.vault.adapter.basePath ?? this.app.vault.adapter.getBasePath?.();
      const fs = require("fs");
      const local = `${vaultPath}/4 System/Automation/${name}`;
      const bundled = `${this.manifest.dir}/optional/${name}`;
      const script = fs.existsSync(local) ? local : bundled;
      if (!fs.existsSync(script)) {
        resolve({ code: -1, stdout: "", stderr: `Optional companion is not installed: ${name}` });
        return;
      }
      execFile(
        "/usr/bin/python3",
        [script, ...args],
        { env: { ...process.env, VAULT: vaultPath }, timeout: 90000 },
        (err, stdout, stderr) =>
          resolve({ code: err?.code ?? 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") })
      );
    });
  }

  /* Run the bundled Reminders bridge. It is deliberately separate from the
   * generic scheduler runner: checking/configuring an integration is an
   * explicit settings action and should work before scheduled sync is enabled.
   * The installed vault copy is preferred so a local setup can pin its helper;
   * the repository copy is the fallback used by a fresh plugin checkout. */
  runReminderBridge(args = []) {
    return new Promise((resolve) => {
      let execFile;
      try { ({ execFile } = require("child_process")); }
      catch (e) { resolve({ code: -1, stdout: "", stderr: "Not available on mobile" }); return; }
      const base = this.app.vault.adapter.basePath ?? this.app.vault.adapter.getBasePath?.();
      const fs = require("fs");
      const local = `${base}/4 System/Automation/reminders-sync.py`;
      const bundled = `${this.manifest.dir}/optional/reminders-sync.py`;
      const script = fs.existsSync(local) ? local : bundled;
      if (!fs.existsSync(script)) {
        resolve({ code: -1, stdout: "", stderr: "Reminders companion is not installed" });
        return;
      }
      execFile("/usr/bin/python3", [script, "--vault", base, ...args],
        { env: { ...process.env, VAULT: base }, timeout: 90000 },
        (err, stdout, stderr) => resolve({ code: err?.code ?? 0,
          stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
    });
  }

  runWorkflowScript(args = []) {
    if (!cfgGet(this.cfg, "workflowAssistant.enabled", false)) {
      return Promise.resolve({ code: -1, stdout: "", stderr: "Workflow assistant is turned off" });
    }
    return this.runScript("workflow-assistant.py", args, { allowWorkflow: true });
  }

  runEmailTaskScript(args = []) {
    if (!cfgGet(this.cfg, "workflowAssistant.enabled", false)
        || !cfgGet(this.cfg, "workflowAssistant.email.enabled", false)) {
      return Promise.resolve({ code: -1, stdout: "", stderr: "Email task capture is turned off" });
    }
    return this.runScript("email-task-capture.py", args, { allowWorkflow: true });
  }

  runEmailCompletionScript(args = []) {
    if (!cfgGet(this.cfg, "workflowAssistant.enabled", false)) {
      return Promise.resolve({ code: -1, stdout: "", stderr: "Workflow assistant is turned off" });
    }
    return this.runScript("email-completion.py", args, { allowWorkflow: true });
  }

  runMessageTaskCapture(args = []) {
    if (!cfgGet(this.cfg, "messagesTaskCapture.enabled", false)) {
      return Promise.resolve({ code: -1, stdout: "", stderr: "iMessage task capture is turned off" });
    }
    return this.runScript("messages-task-capture.py", args, { allowMessages: true });
  }

  async openWorkflowView(view, title) {
    const path = `${P.automation}/Reports/${title}.md`;
    const scaffold = () => `# ${title}\n\n\`\`\`life-os\nview: ${view}\n\`\`\`\n`;
    return this.openOrCreate(path, scaffold, `the ${title}`);
  }

  async openWorkflowTaskDetail(taskId) {
    const taskFile = this.app.vault.getAbstractFileByPath(P.taskInbox);
    const body = taskFile instanceof TFile ? await this.app.vault.read(taskFile) : "";
    const line = body.split("\n").find((value) => value.includes(`^${taskId}`)) || "Task not found in the Task Inbox.";
    const state = await workflowState(this);
    const history = state.workflow?.reschedules?.[taskId] || [];
    const activity = (state.workflow?.activity || []).filter((event) => event.task === taskId);
    const reportPath = `${P.automation}/Reports/Task ${taskId}.md`;
    const content = [
      `# Task detail`, "", `Source: [[${P.taskInbox}#^${taskId}]]`, "", "## Current task", "", line,
      "", "## Reschedule history", "", ...(history.length ? history.map((event) => `- ${event.at || ""}: ${event.old || "undated"} → ${event.new || "undated"} (${event.source || "unknown"})`) : ["- No reschedules recorded."]),
      "", "## Activity", "", ...(activity.length ? activity.slice(-20).map((event) => `- ${event.at || ""}: ${event.kind || "event"}`) : ["- No task-specific activity recorded."]), "",
    ].join("\n");
    await this.store.ensureFolder(`${P.automation}/Reports`);
    const existing = this.app.vault.getAbstractFileByPath(reportPath);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(reportPath, content);
    return this.open(reportPath);
  }

  /* Kick a scheduled job so an on-demand run is the SAME run the scheduler
   * makes — same script, same logging, same lock file. Spawning a parallel
   * copy would race the scheduled one and could double-import.
   *
   * `launchctl kickstart` starts the job now; it returns immediately, so the
   * caller polls the job's log rather than waiting on the process. */
  kickJob(label) {
    if (!this.on("sync")) {
      return Promise.resolve({ ok: false,
                               error: "Scheduled job control is turned off" });
    }
    return new Promise((resolve) => {
      let execFile;
      try {
        ({ execFile } = require("child_process"));
      } catch (e) {
        resolve({ ok: false, error: "Not available on mobile" });
        return;
      }
      const uid = typeof process?.getuid === "function" ? process.getuid() : null;
      if (uid === null) { resolve({ ok: false, error: "Cannot resolve user id" }); return; }
      execFile("/bin/launchctl", ["kickstart", `gui/${uid}/${label}`], { timeout: 15000 },
        (err, stdout, stderr) => {
          const msg = String(stderr ?? "").trim() || String(stdout ?? "").trim();
          /* "already running" is a success from the user's point of view — the
           * work they asked for is in flight. */
          if (err && !/already|in progress/i.test(msg)) {
            resolve({ ok: false, error: msg || `launchctl exited ${err.code}` });
          } else {
            resolve({ ok: true, note: /already/i.test(msg) ? "already running" : null });
          }
        });
    });
  }

  /* Read a job's log for today and report where it got to. */
  async jobStatus(prefix, logDir = null) {
    if (!this.on("sync")) return { state: "off", text: "Sync jobs are turned off" };
    const name = `${prefix}-${moment().format("YYYY-MM-DD")}.log`;
    let text = "";
    if (logDir) {
      /* Outside the vault, so the vault adapter cannot see it. */
      try {
        const fs = require("fs");
        const os = require("os");
        const dir = logDir.replace(/^~/, os.homedir());
        text = fs.readFileSync(`${dir}/${name}`, "utf8");
      } catch (e) {
        return { state: "idle", text: "No run yet today" };
      }
    } else {
      const f = this.app.vault.getAbstractFileByPath(`${P.logs}/${name}`);
      if (!(f instanceof TFile)) return { state: "idle", text: "No run yet today" };
      try { text = await this.app.vault.cachedRead(f); }
      catch (e) { return { state: "idle", text: "Log unreadable" }; }
    }
    const lines = text.trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const done = [...text.matchAll(/^(\S+) completed status=(\d+)/gm)].pop();
    const started = [...text.matchAll(/^(\S+) started/gm)].pop();
    const stamp = (s) => {
      const m = moment(s, moment.ISO_8601);
      return m.isValid() ? m.format("h:mm A") : s;
    };
    if (started && (!done || started[1] > done[1])) {
      const step = [...text.matchAll(/\[(\w+)\] running/g)].pop();
      return { state: "running", text: `Running since ${stamp(started[1])}${step ? ` — ${step[1]}` : ""}` };
    }
    if (done) {
      return {
        state: done[2] === "0" ? "ok" : "failed",
        text: `${done[2] === "0" ? "Last sync" : "Last sync failed"} ${stamp(done[1])}`,
      };
    }
    return { state: "idle", text: last.slice(0, 60) || "No run yet today" };
  }

  /* Run an AppleScript helper from 4 System/Automation. Desktop only. */
  runOsa(name, args = []) {
    if (!this.on("sync")) {
      return Promise.resolve({ code: -1, stdout: "",
                               stderr: "Scheduled job control is turned off" });
    }
    return new Promise((resolve) => {
      let execFile;
      try {
        ({ execFile } = require("child_process"));
      } catch (e) {
        resolve({ code: -1, stdout: "", stderr: "Not available on mobile" });
        return;
      }
      const base = this.app.vault.adapter.basePath ?? this.app.vault.adapter.getBasePath?.();
      execFile(
        "/usr/bin/osascript",
        [`${base}/4 System/Automation/${name}`, ...args],
        { timeout: 60000 },
        (err, stdout, stderr) =>
          resolve({ code: err?.code ?? 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") })
      );
    });
  }

  async openWeb(url, sameTab = false) {
    const leaf = this.app.workspace.getLeaf(sameTab ? false : "tab");
    try {
      await leaf.setViewState({ type: "webviewer", active: true, state: { url } });
      this.app.workspace.revealLeaf(leaf);
      return true;
    } catch (e) {
      console.error("Uptick: web viewer failed", e);
      new Notice("Web viewer unavailable — enable it in Settings → Core plugins");
      return false;
    }
  }

  /* Clicking a task opens the board, not the Markdown file. The Inbox is the
   * store; the Kanban is where work is actually looked at and moved. It cannot
   * anchor to a single card, so this opens the board itself. */
  async openTask() {
    return this.openOrCreate(P.kanban, kanbanScaffold, "the Kanban board");
  }

  /* The Inbox line for one task, for when the raw record is what is wanted. */
  async openTaskSource(task) {
    if (task?.id) {
      await this.app.workspace.openLinkText(
        `${P.taskInbox.replace(/\.md$/, "")}#^${task.id}`, "", false);
      return true;
    }
    return this.open(P.taskInbox);
  }

  /* Resolve an Upcoming row to the most specific thing that exists: the
   * meeting's own note for that day, then the series definition, then the day
   * itself. Clicking a meeting should land on the meeting, not on a date. */
  async openMeetingFor(m) {
    const notes = this.meetings.onDay(m.d);
    const want = String(m.title).toLowerCase();
    const words = new Set(want.match(/[a-z0-9]{3,}/g) ?? []);
    let best = null, bestScore = 0;
    for (const n of notes) {
      const have = n.file.basename.toLowerCase();
      if (have.includes(want) || want.includes(have.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, ""))) {
        best = n; break;
      }
      const score = [...words].filter((w) => have.includes(w)).length;
      if (score > bestScore) { best = n; bestScore = score; }
    }
    if (best && (bestScore >= 2 || best === notes[0])) return this.open(best.file.path);
    if (m.series) return this.open(m.series.file.path);
    return this.openDaily(m.d);
  }

  async open(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(f);
      return true;
    }
    /* A button that silently does nothing is worse than one that explains
     * itself. Periodic notes should go through openDaily/Weekly/Monthly, which
     * create on demand. */
    new Notice(`Not found: ${path}`);
    return false;
  }

  /* Open the celebration for one achievement. `browse` means the user asked
   * for it, so it opens even when already seen. */
  async showAchievement(slug, browse = false) {
    const cat = await this.game.achievements();
    const entry = cat?.achievements?.find((a) => a.slug === slug);
    if (!entry) return;
    if (!browse && (this.settings.shownAchievements ?? []).includes(slug)) return;
    new AchievementModal(this.app, this, entry, []).open();
    await this.markAchievementsShown([slug]);
  }

  /* Anything unlocked since the last time the celebration ran. Queued rather
   * than fired at once, so a batch plays in sequence instead of stacking
   * modals. Seen slugs persist in the plugin's own data, not the vault — this
   * is UI state, not a fact about the world. */
  async drainUnlockQueue() {
    const cat = await this.game.achievements();
    if (!cat) return;
    const seen = new Set(this.settings.shownAchievements ?? []);
    const fresh = cat.achievements.filter((a) => a.unlocked && !seen.has(a.slug));
    if (!fresh.length) return;
    /* First run after switching the layer on would replay every unlock at
     * once. Record them silently and start celebrating from here. */
    if (!this.settings.achievementsSeeded) {
      this.settings.achievementsSeeded = true;
      await this.markAchievementsShown(fresh.map((a) => a.slug));
      return;
    }
    fresh.sort((a, b) => String(a.unlocked).localeCompare(String(b.unlocked)));
    const [first, ...rest] = fresh;
    new AchievementModal(this.app, this, first, rest).open();
    await this.markAchievementsShown(fresh.map((a) => a.slug));
  }

  /* Write one setting through and re-resolve anything derived from it. */
  async setCfg(path, value) {
    cfgSet(this.cfg, path, value);
    const current = (await this.loadData()) ?? {};
    this.settings = { ...current, ...this.settings, config: this.cfg };
    await this.saveData(this.settings);
    if (String(path).startsWith("paths.")) applyPaths(this.cfg);
    this.refreshNav();
    return this.cfg;
  }

  async replaceCfg(next) {
    this.cfg = mergeCfg(DEFAULTS, next || {});
    const current = (await this.loadData()) ?? {};
    this.settings = { ...current, ...this.settings, config: this.cfg };
    await this.saveData(this.settings);
    applyPaths(this.cfg);
    this.refreshNav();
    return this.cfg;
  }

  /* Whether a module is on. Read at render time so toggling one takes effect
   * on the next redraw without a reload. */
  on(module) {
    return cfgGet(this.cfg, `modules.${module}`, true) !== false;
  }

  /* Whether a card should be drawn on a given page. A card belonging to a
   * module that is off never draws, whatever the per-page toggle says. */
  shows(page, key, module) {
    if (module && !this.on(module)) return false;
    return cfgGet(this.cfg, `${page}.${key}`, true) !== false;
  }

  refreshNav() {
    for (const leaf of this.app.workspace.getLeavesOfType(NAV_VIEW)) {
      if (typeof leaf.view?.render === "function") leaf.view.render();
    }
  }

  /* First-run setup.
   *
   * Creates the configured folders and seeds the notes the dashboards need.
   * Idempotent: anything that already exists is left alone, so it is safe to
   * run again after changing paths in settings. Returns what it made, which is
   * what the Settings page reports back. */
  /* Run the XP engine over the vault and write what it produced.
   *
   * This is the whole reason the engine was ported: the experience layer used
   * to need Python and a scheduled job, so a plain install got dashboards and
   * nothing behind them. Everything here is vault I/O -- the computation is
   * Engine.runSync, which touches no files and is proven against the Python
   * by engine/tests/sync_parity_test.js.
   */
  async recalculate() {
    const notice = new Notice("Uptick: recalculating…", 0);
    try {
      const c = this.cfg.paths;
      const read = async (path) => {
        const f = this.app.vault.getAbstractFileByPath(path);
        return f && "extension" in f ? await this.app.vault.cachedRead(f) : "";
      };
      const folder = async (dir) => {
        const out = {};
        if (!dir) return out;
        for (const f of this.app.vault.getMarkdownFiles()) {
          if (f.path.startsWith(dir + "/")) {
            out[f.basename] = await this.app.vault.cachedRead(f);
          }
        }
        return out;
      };

      /* countable_notes: what a human wrote. The game folder is this engine's
       * own output, and counting it would unlock note achievements the moment
       * it first ran. */
      const noteCount = this.app.vault.getMarkdownFiles()
        .filter((f) => !f.path.startsWith(c.game + "/")).length;

      let state = {};
      try {
        state = JSON.parse(await this.app.vault.adapter.read(P.xpState));
      } catch (e) { state = {}; }

      const result = Engine.runSync({
        config: this.cfg,
        taskInbox: await read(P.taskInbox),
        ledger: await read(P.ledger),
        dailyNotes: await folder(c.daily),
        weeklyNotes: await folder(c.weekly),
        monthlyNotes: await folder(c.monthly),
        meetingNotes: await folder(c.meetings),
        noteCount,
        readTheDesign: !!this.app.vault.getAbstractFileByPath(`${c.game}/Gamification Design.md`),
        state,
        /* Goals live in the bank note and are typed by hand, so the engine
         * reads them rather than owning them. */
        bankNote: await read(P.bank),
        /* Readiness and card counts come from LearnKit's store and the
         * certification notes, which only the Python engine reads. Hand the
         * old cache back so this run preserves them instead of erasing them. */
        previousQuestCache: await (async () => {
          try { return JSON.parse(await this.app.vault.adapter.read(P.questCache)); }
          catch (e) { return null; }
        })(),
        /* The condition wording lives in the Achievements note, so the browser
         * can say how each one is earned without restating 258 phrasings in
         * code. */
        conditions: Engine.achievementConditions(await read(P.achievements)),
      });

      await this.writeNote(P.ledger, result.writes.ledger);
      await this.writeNote(P.character, result.writes.character);
      await this.writeNote(P.quest, result.writes.quest);
      await this.app.vault.adapter.write(P.achCache, result.writes.achievementsCache);
      /* The Quest Log note is thin and renders from this cache, so writing the
       * note without the cache leaves the page blank. */
      await this.app.vault.adapter.write(P.questCache, result.writes.questCache);
      if (result.writes.bankNote) await this.writeNote(P.bank, result.writes.bankNote);
      await this.app.vault.adapter.write(P.xpState, JSON.stringify(result.state, null, 2) + "\n");

      const s = result.summary;
      notice.hide();
      new Notice(`Uptick: level ${s.level} · ${fmtNum(s.total_xp)} XP · `
        + `${s.new_events} new event${s.new_events === 1 ? "" : "s"}`
        + (s.achievements_new.length ? ` · ${s.achievements_new.length} unlocked` : ""), 6000);
      this.refresh();
      return result;
    } catch (err) {
      notice.hide();
      new Notice(`Uptick: recalculate failed — ${err.message ?? err}`, 8000);
      console.error("Uptick: recalculate failed", err);
      return null;
    }
  }

  /* Fetch the forecast and write the cache the weather views read.
   *
   * Setting a location did nothing before this: the location field was read
   * only by optional/weather-fetch.py, so the setting that looked like the
   * thing which makes weather work needed a Python script and a scheduled job
   * that nobody was told about. The cache written here is the same shape the
   * script writes, so either can produce it and the views cannot tell.
   */
  async fetchWeather() {
    const cfg = this.cfg.weather || {};
    const key = String(cfg.apikey || "").trim();
    const location = String(cfg.location || "").trim();
    if (!key || !location) {
      return { ok: false, error: !location ? "no location set" : "no API key set" };
    }
    const units = cfg.units === "metric" ? "metric" : "us";
    const iso = (d) => d.toISOString().slice(0, 10);
    const now = new Date();
    const day = (n) => iso(new Date(now.getTime() + n * 86400000));

    const DAY_FIELDS = "datetime,temp,tempmax,tempmin,feelslike,conditions,icon,"
      + "humidity,windspeed,windgust,precip,precipprob,cloudcover,uvindex,"
      + "sunrise,sunset,pressure,visibility,snow,dew";
    const HOUR_FIELDS = "datetime,temp,feelslike,conditions,icon,humidity,"
      + "windspeed,precip,precipprob,cloudcover,uvindex,dew";
    const API = "https://weather.visualcrossing.com/VisualCrossingWebServices"
      + "/rest/services/timeline";

    const get = async (range, params) => {
      const url = `${API}/${encodeURIComponent(location)}/${range}`
        + `?unitGroup=${units}&${params}&key=${encodeURIComponent(key)}`
        + "&contentType=json";
      const res = await requestUrl({ url, method: "GET", throw: false });
      /* Never surface the URL on failure -- it carries the key. */
      if (res.status === 401) throw new Error("the API key was rejected");
      if (res.status === 400) throw new Error(`Visual Crossing did not recognise "${location}"`);
      if (res.status === 429) throw new Error("out of free requests for today");
      if (res.status !== 200) throw new Error(`Visual Crossing returned ${res.status}`);
      return JSON.parse(res.text);
    };

    let hourly, daily = {}, past = {};
    try {
      hourly = await get(`${day(0)}/${day(1)}`,
        `include=current,hours&elements=${HOUR_FIELDS},tempmax,tempmin,sunrise,sunset`);
      daily = await get(`${day(0)}/${day(14)}`, `include=days&elements=${DAY_FIELDS}`);
      past = await get(`${day(-7)}/${day(0)}`, `include=days&elements=${DAY_FIELDS}`);
    } catch (e) {
      return { ok: false, error: e.message ?? String(e) };
    }

    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
    const slimDay = (d) => pick(d, ["datetime", "tempmax", "tempmin", "temp",
      "conditions", "icon", "humidity", "windspeed", "precip", "precipprob",
      "cloudcover", "uvindex", "sunrise", "sunset"]);
    const slimHour = (h) => pick(h, ["datetime", "temp", "feelslike", "conditions",
      "icon", "humidity", "windspeed", "precip", "precipprob", "cloudcover", "uvindex"]);

    const pad = (n) => String(n).padStart(2, "0");
    const nowStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
      + `-${pad(now.getDate())}T${pad(now.getHours())}`;
    const hours = [];
    for (const d of hourly.days || []) {
      for (const h of d.hours || []) {
        const stamp = `${d.datetime}T${String(h.datetime).slice(0, 2)}`;
        if (stamp >= nowStamp) hours.push({ ...slimHour(h), date: d.datetime });
      }
    }

    const cur = hourly.currentConditions || {};
    const out = {
      fetched: new Date().toISOString(),
      location: hourly.resolvedAddress || location,
      units,
      now: {
        temp: cur.temp, feelslike: cur.feelslike, conditions: cur.conditions,
        icon: cur.icon, humidity: cur.humidity, wind: cur.windspeed,
        uv: cur.uvindex, cloudcover: cur.cloudcover, precipprob: cur.precipprob,
      },
      today: slimDay((hourly.days || [{}])[0]),
      hours: hours.slice(0, 48),
      days: (daily.days || []).map(slimDay).slice(0, 15),
      past: (past.days || []).map(slimDay).slice(0, 8),
    };
    await this.app.vault.adapter.write(P.weatherCache,
      JSON.stringify(out, null, 2) + "\n");
    return { ok: true, location: out.location };
  }

  /* Open a note, offering to create it when it is not there.
   *
   * plugin.open on a missing path shows Obsidian's "Not found: <path>" and
   * stops, which is what a Kanban board link did on every fresh install --
   * a working button pointing at a note nothing had made. A link that can
   * repair itself is better than one that reports a filename.
   */
  async openOrCreate(path, scaffold, label) {
    if (this.app.vault.getAbstractFileByPath(path)) return this.open(path);
    try {
      await this.writeNote(path, scaffold());
      new Notice(`Created ${label}`);
    } catch (e) {
      new Notice(`Could not create ${label}: ${e.message ?? e}`);
      return null;
    }
    return this.open(path);
  }

  /* Create or replace a note the engine owns. */
  async writeNote(path, body) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f && "extension" in f) return this.app.vault.modify(f, body);
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir).catch(() => {});
    }
    return this.app.vault.create(path, body);
  }

  async runSetup(opts = {}) {
    const made = { folders: [], notes: [], icons: 0, skipped: 0 };
    const c = this.cfg.paths;

    const folders = [c.daily, c.weekly, c.monthly, c.inbox, c.meetings,
                     c.recurring, c.tasks, c.projects, c.areas, c.knowledge,
                     c.sources, c.game, c.automation];
    if (this.on("game")) folders.push(`${c.game}/Certifications`, `${c.game}/Achievement Art`);
    if (this.on("photos")) folders.push(c.photos);

    /* Obsidian's createFolder does NOT create intermediate folders, and the
     * list above is full of nested paths whose parents are not in it — so
     * "1 Capture/Daily" fails outright in an empty vault unless "1 Capture" is
     * made first. Expand every path into its ancestor chain and create
     * shallowest-first. */
    const wanted = new Set();
    for (const f of folders.filter(Boolean)) {
      const parts = f.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) wanted.add(parts.slice(0, i).join("/"));
    }
    for (const f of [...wanted].sort((a, b) => a.split("/").length - b.split("/").length)) {
      if (this.app.vault.getAbstractFileByPath(f)) { made.skipped++; continue; }
      try {
        await this.app.vault.createFolder(f);
        made.folders.push(f);
      } catch (e) { /* raced, or already there */ }
    }

    if (this.on("game")) made.icons = await installArt(this);

    const notes = [[P.home, homeScaffold()], [P.taskInbox, taskInboxScaffold()]];
    if (this.on("game")) {
      /* Every game note the sidebar and the walkthrough link to. Setup used to
       * make three notes while six were linked, so a fresh vault answered
       * "Not found" to half its own navigation. Character, Quest Log and the
       * ledger are rebuilt by Recalculate; these are their empty state. */
      notes.push([P.settings, settingsScaffold()],
                 [P.achievements, achievementsScaffold()],
                 [P.bank, bankScaffold()],
                 [P.character, Engine.renderCharacter(moment().format("YYYY-MM-DD"), 1, 0, 0)],
                 [P.quest, Engine.renderQuest(moment().format("YYYY-MM-DD"))],
                 [P.ledger, Engine.writeLedger([])]);
    }
    for (const [path, body] of notes) {
      if (!path || this.app.vault.getAbstractFileByPath(path)) { made.skipped++; continue; }
      /* Same rule for a note's folder: every ancestor, shallowest first. */
      const parent = path.replace(/\/[^/]+$/, "");
      if (parent && parent !== path) {
        const parts = parent.split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
          const dir = parts.slice(0, i).join("/");
          if (this.app.vault.getAbstractFileByPath(dir)) continue;
          try { await this.app.vault.createFolder(dir); } catch (e) { /* exists */ }
        }
      }
      try {
        await this.app.vault.create(path, body);
        made.notes.push(path);
      } catch (e) { /* exists */ }
    }

    if (opts.open !== false && this.app.vault.getAbstractFileByPath(P.home)) {
      await this.open(P.home);
    }
    return made;
  }

  async openLibrary() {
    const path = `${this.cfg.paths.game}/Library.md`;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      const parent = path.replace(/\/[^/]+$/, "");
      for (const part of parent.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))) {
        if (this.app.vault.getAbstractFileByPath(part)) continue;
        try { await this.app.vault.createFolder(part); } catch (e) { /* exists */ }
      }
      await this.app.vault.create(path, libraryScaffold());
    }
    return this.open(path);
  }

  /* The tour lives in the right sidebar so it can send you to a page and stay
   * visible while you look at it. A modal would have to close to show anything,
   * which is how a walkthrough ends up being read instead of followed. */
  async openTour({ restart = false } = {}) {
    if (restart) {
      await this.setCfg("tour.step", 0);
      await this.setCfg("tour.done", false);
    }
    const existing = this.app.workspace.getLeavesOfType(TOUR_VIEW);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      if (typeof existing[0].view?.render === "function") existing[0].view.render();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: TOUR_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openSettings(tab) {
    /* `tab` lands the reader on the control being described. Sending someone
     * to a seven-tab page and telling them to find it themselves is where a
     * walkthrough stops being one. */
    this._settingsTab = tab || null;
    const path = P.settings;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      const folder = path.replace(/\/[^/]+$/, "");
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        try { await this.app.vault.createFolder(folder); } catch (e) { /* exists */ }
      }
      await this.app.vault.create(path, settingsScaffold());
    }
    return this.open(path);
  }

  async markAchievementsShown(slugs) {
    const current = (await this.loadData()) ?? {};
    const seen = new Set([...(current.shownAchievements ?? []),
                          ...(this.settings.shownAchievements ?? []), ...slugs]);
    this.settings = {
      ...current,
      ...this.settings,
      shownAchievements: [...seen],
      achievementsSeeded: this.settings.achievementsSeeded ?? current.achievementsSeeded ?? false,
    };
    await this.saveData(this.settings);
  }

  /* LearnKit is a separate plugin, so its command ids are its own business and
   * could change. Resolve one at runtime in preference order rather than
   * hardcoding, and fall back to the Study Hub note if LearnKit is not
   * installed or enabled. */
  async openLearnKit(which = "home") {
    const id = this.learnKitCommand(which);
    if (id) return this.app.commands.executeCommandById(id);
    new Notice("LearnKit is not enabled — opening the Study Hub instead");
    return this.openOrCreate(P.studyHub, studyHubScaffold, "the Study Hub");
  }

  /* LearnKit's command ids come out of a minified bundle and are not stable
   * enough to hardcode, but its display names are defined in its own i18n and
   * are what the command palette shows. Match on the name, fall back to any
   * LearnKit command at all. */
  learnKitCommand(which = "home") {
    const wanted = {
      home: /open home/i,
      study: /new study session/i,
      tests: /open tests/i,
      coach: /open coach/i,
      sync: /sync all flashcards/i,
    }[which] ?? /open home/i;
    const cmds = this.app.commands?.commands ?? {};
    const keys = Object.keys(cmds).filter((k) => k.startsWith("learnkit:"));
    return keys.find((k) => wanted.test(cmds[k]?.name ?? ""))
        ?? keys.find((k) => /open home/i.test(cmds[k]?.name ?? ""))
        ?? keys[0]
        ?? null;
  }

  /* Practice exam papers live beside the study material rather than in the
   * game folder, and there will be a set per certification. Found by their
   * index note rather than a hardcoded path, so adding a second certification
   * needs no change here. */
  async openPracticeExams() {
    const indexes = this.app.vault.getMarkdownFiles()
      .filter((f) => /\/Practice Exams\/Practice Exams\.md$/.test(f.path))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (indexes.length === 1) return this.open(indexes[0].path);
    if (indexes.length > 1) {
      const pick = await prompt(this.app, {
        title: "Practice exams",
        help: indexes.map((f, i) => `${i + 1}. ${certOf(f.path)}`).join("\n"),
        placeholder: "1",
        cta: "Open",
      });
      const idx = Number(pick) - 1;
      return this.open(indexes[Number.isFinite(idx) && indexes[idx] ? idx : 0].path);
    }

    /* No index note: fall back to any single paper, then to the study hub, so
     * the entry is never a dead end. */
    const papers = this.app.vault.getMarkdownFiles()
      .filter((f) => /\/Practice Exams\//.test(f.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (papers.length) return this.open(papers[0].path);
    new Notice("No practice exams found — build them with build-practice-exams.py");
    return this.openOrCreate(P.studyHub, studyHubScaffold, "the Study Hub");
  }

  async go(action) {
    switch (action) {
      case "home": return this.open(P.home);
      case "today": case "daily": return this.openDaily(moment());
      case "tasks": return this.openOrCreate(P.kanban, kanbanScaffold, "the Kanban board");
      case "quest": return this.open(P.quest);
      case "achievements": return this.open(P.achievements);
      case "bank": return this.open(P.bank);
      case "settings": return this.openSettings();
      case "triage": return this.openWorkflowView("triage", "Triage Queue");
      case "waiting-dashboard": return this.openWorkflowView("waiting-dashboard", "Waiting Dashboard");
      case "sync-activity": return this.openWorkflowView("sync-activity", "Sync Activity");
      case "weekly-workflow-review": return this.openWorkflowView("weekly-workflow-review", "Weekly Workflow Review");
      case "learnkit": return this.openLearnKit("home");
      case "coach": return this.openLearnKit("coach");
      case "exams": return this.openPracticeExams();
      case "library": return this.openLibrary();
      case "projects": return this.open(`${P.projects}/Projects.md`);
      case "areas": return this.open(`${P.areas}/Areas.md`);
      case "knowledge": return this.open(`${P.knowledge}/Knowledge.md`);
      case "sources": return this.open(`${P.sources}/Sources.md`);
      case "web-copilot": return this.openWeb(WEB_APPS.copilot.url);
      case "new-meeting": return this.newMeeting();
      case "new-note": return this.newNote();
      case "new-project": return this.newProject();
    }
  }

  async quickCreate() {
    const kind = await prompt(this.app, {
      title: "Create",
      help: "Type note, task, meeting, or project.",
      placeholder: "note | task | meeting | project",
      cta: "Go",
    });
    if (!kind) return;
    const k = kind.trim().toLowerCase();
    if (k.startsWith("t")) return this.newTask();
    if (k.startsWith("m")) return this.newMeeting();
    if (k.startsWith("p")) return this.newProject();
    return this.newNote();
  }

  async newTask() {
    const text = await prompt(this.app, {
      title: "New task",
      help: `Appended to ${P.taskInbox} — the only task store.`,
      placeholder: "What needs doing?",
      cta: "Add task",
    });
    if (!text || !text.trim()) return;
    try {
      await this.tasks.add(text.trim(), { source: "Uptick" });
      new Notice("Added to Task Inbox");
    } catch (e) {
      new Notice(String(e.message ?? e));
    }
  }

  async confirmEmailTaskCapture(args, label = "email") {
    const previewResult = await this.runEmailTaskScript([...args, "--preview"]);
    let preview = null;
    try { preview = JSON.parse(previewResult.stdout || "{}"); } catch (e) { preview = null; }
    if (!preview?.ok) return new Notice((preview?.error || previewResult.stderr || `Could not preview ${label}`).slice(0, 180));
    const actions = Array.isArray(preview.actions) ? preview.actions.filter(Boolean) : [];
    if (!actions.length) return new Notice("No action items were detected.");
    const help = [`Subject: ${preview.subject || "Selected message"}`, "", "Actions to create:",
      ...actions.map((item, index) => `${index + 1}. ${item}`), "",
      "Type CAPTURE to create these actions, or replace them with actions separated by |."].join("\n");
    const approval = await prompt(this.app, { title: `Preview ${label} task`, help,
      placeholder: "CAPTURE or action 1 | action 2", cta: "Create tasks" });
    const approvalText = String(approval || "").trim();
    if (!approvalText) return;
    const selectedActions = approvalText.toUpperCase() === "CAPTURE"
      ? actions : approvalText.split("|").map((item) => item.trim()).filter(Boolean);
    if (!selectedActions.length) return new Notice("Enter at least one action.");
    const finalArgs = [...args];
    if (!finalArgs.includes("--action")) selectedActions.forEach((action) => finalArgs.push("--action", action));
    const result = await this.runEmailTaskScript(finalArgs);
    if (result.code) return new Notice((result.stderr || "Email capture failed").slice(0, 180));
    new Notice("Email parent task and subtasks added to the Task Inbox.");
  }

  async captureEmailTask() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return new Notice("Open an imported email note first.");
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    if (String(fm.type || "").toLowerCase() !== "email" || !fm.message_id) {
      return new Notice("The active note is not an imported email reference.");
    }
    const body = await this.app.vault.cachedRead(file);
    const section = body.match(/##\s+Action Items\s*\n([\s\S]*?)(?=\n##\s|$)/i)?.[1] || "";
    const actions = section.split("\n").map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
      .filter((line) => line && !/^\*None detected\.?$/i.test(line));
    if (!actions.length) return new Notice("No action items were detected in this email note.");
    const args = ["--message-id", String(fm.message_id), "--subject", String(fm.subject || file.basename)];
    if (fm.url) args.push("--url", String(fm.url));
    actions.forEach((action) => args.push("--action", action));
    return this.confirmEmailTaskCapture(args, "email note");
  }

  async captureSelectedEmailTask() {
    return this.confirmEmailTaskCapture(["--selected"], "selected Apple Mail message");
  }

  async newNote() {
    const title = await prompt(this.app, {
      title: "New note",
      help: `Created in ${P.inbox}.`,
      placeholder: "Note title",
      cta: "Create",
    });
    if (!title || !title.trim()) return;
    const name = safeName(title);
    const path = `${P.inbox}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice("A note with that name already exists");
      return this.open(path);
    }
    await this.store.ensureFolder(P.inbox);
    await this.app.vault.create(path, [
      "---", "type: note", `created: ${moment().format("YYYY-MM-DD")}`, "---",
      "", `# ${name}`, "",
    ].join("\n"));
    return this.open(path);
  }

  async newProject() {
    const title = await prompt(this.app, {
      title: "New project",
      help: `Created in ${P.projects}.`,
      placeholder: "Project name",
      cta: "Create",
    });
    if (!title || !title.trim()) return;
    const name = safeName(title);
    const path = `${P.projects}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice("A project with that name already exists");
      return this.open(path);
    }
    await this.app.vault.create(path, [
      "---", "type: project", "status: active", "area:",
      `created: ${moment().format("YYYY-MM-DD")}`,
      "cssclasses:", "  - life-os", "  - max", "---",
      "", `# ${name}`, "",
      "## Objective", "", "## Current Status", "", "## Next Actions", "",
      "## Decisions", "", "## People", "", "## Meetings", "", "## Resources", "",
    ].join("\n"));
    return this.open(path);
  }

  /** New meeting note, optionally attached to a recurring series. */
  async newMeeting() {
    const series = this.recur.series();
    const help = series.length
      ? `Leave blank for a one-off. Series: ${series.map((s) => s.file.basename).join(", ")}`
      : "No recurring series defined yet.";
    const title = await prompt(this.app, {
      title: "New meeting note",
      help,
      placeholder: "Meeting title (or an existing series name)",
      cta: "Create",
    });
    if (!title || !title.trim()) return;

    const match = series.find(
      (s) => s.file.basename.toLowerCase() === title.trim().toLowerCase()
    );
    if (match) {
      return this.open(await createMeetingNote(this, match, moment()));
    }

    const iso = moment().format("YYYY-MM-DD");
    const name = safeName(`${iso} - ${title}`);
    const path = `${P.meetings}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) return this.open(path);
    await this.app.vault.create(path, meetingScaffold(name, iso, null, null));
    return this.open(path);
  }

  /** Open (creating if needed) the daily note for a moment. */
  async openDaily(day) {
    const path = `${P.daily}/${day.format("YYYY-MM-DD")}.md`;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.store.ensureFolder(P.daily);
      await this.app.vault.create(path, dailyScaffold(day));
    }
    return this.open(path);
  }

  async openWeekly(day) {
    const w = day.clone().startOf("isoWeek");
    const path = `${P.weekly}/${w.format("GGGG-[W]WW")}.md`;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.store.ensureFolder(P.weekly);
      await this.app.vault.create(path, weeklyScaffold(w));
    }
    return this.open(path);
  }

  async openMonthly(day) {
    const m = day.clone().startOf("month");
    const path = `${P.monthly}/${m.format("YYYY-MM")}.md`;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.store.ensureFolder(P.monthly);
      await this.app.vault.create(path, monthlyScaffold(m));
    }
    return this.open(path);
  }

  /* Dispatch for ```life-os blocks. The body is `view: <name>`. */
  async renderBlock(src, elm, ctx) {
    const cfg = {};
    for (const line of src.split("\n")) {
      const m = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
      if (m) cfg[m[1]] = m[2].trim();
    }
    /* Daily, weekly and monthly notes hold their sections purely as storage —
     * each one is surfaced and edited through the cards above. Left visible
     * they render below the dashboard as a tail of empty headings. Email notes
     * are folded for the opposite reason: every section, body included, is
     * rendered as a card, so the raw copy is pure duplication. Either way the
     * file itself is one click away in the page header. */
    if (["daily", "weekly", "monthly", "email", "meeting", "achievements",
         "quest", "character", "ledger", "exams", "bank",
         "settings", "library", "triage", "waiting-dashboard", "sync-activity",
         "weekly-workflow-review", "email-completions"].includes(cfg.view)) {
      elm.addClass("lifeos-owns-body");
    }

    const root = el(elm, "div", "lifeos");

    /* Panels re-read the note after every write. Re-running the renderer into
     * the same container is the only reliable refresh: Live Preview re-renders
     * code blocks on its own schedule, so we cannot rely on that happening. */
    const draw = async () => {
      root.empty();
      try {
        switch (cfg.view) {
          case "daily":
            return await renderDaily(this, root, cfg, ctx, draw);
          case "home":
            return await renderHome(this, root, cfg, ctx, draw);
          case "weekly":
            return await renderWeekly(this, root, cfg, ctx, draw);
          case "monthly":
            return await renderMonthly(this, root, cfg, ctx, draw);
          case "meeting":
            return await renderMeeting(this, root, cfg, ctx, draw);
          case "series":
            return await renderSeriesView(this, root, cfg, ctx, draw);
          case "email":
            return await renderEmail(this, root, cfg, ctx, draw);
          case "weather":
            return await renderWeatherPage(this, root, cfg, ctx, draw);
          case "achievements":
            return await renderAchievements(this, root, cfg, ctx, draw);
          case "quest":
            return await renderQuest(this, root, cfg, ctx, draw);
          case "character":
            return await renderCharacter(this, root, cfg, ctx, draw);
          case "ledger":
            return await renderLedger(this, root, cfg, ctx, draw);
          case "exams":
            return await renderExams(this, root, cfg, ctx, draw);
          case "bank":
            return await renderBank(this, root, cfg, ctx, draw);
          case "settings":
            return await renderSettings(this, root, cfg, ctx, draw);
          case "library":
            return await renderLibrary(this, root, cfg, ctx, draw);
          case "triage":
            return await renderWorkflowTriage(this, root, cfg, ctx, draw);
          case "waiting-dashboard":
            return await renderWaitingDashboard(this, root, cfg, ctx, draw);
          case "sync-activity":
            return await renderSyncActivity(this, root, cfg, ctx, draw);
          case "weekly-workflow-review":
            return await renderWeeklyWorkflowReview(this, root, cfg, ctx, draw);
          case "email-completions":
            return await renderEmailCompletionReview(this, root, cfg, ctx, draw);
          default:
            el(root, "div", "lifeos-empty",
              `Unknown Uptick view: "${cfg.view ?? "(none)"}"`);
        }
      } catch (e) {
        const box = el(root, "div", "lifeos-error");
        el(box, "div", null, "Uptick failed to render this view.");
        el(box, "pre", null, String(e && e.stack ? e.stack : e));
      }
    };

    await draw();

    /* Live Preview renders this block as one widget inside CodeMirror, and CM6
     * only keeps the visible viewport in the DOM — everything else is an
     * ESTIMATED height. Because draw() is async the widget is momentarily
     * empty, so CM measures it at roughly zero and then never learns it grew to
     * several thousand pixels. Scroll far enough and the viewport lands outside
     * every block CM believes exists, and the page renders blank.
     *
     * Watching the container and telling the editor to re-measure whenever its
     * height actually changes keeps CM's height map honest. Debounced, and only
     * on a real change, so this cannot feed back into itself. */
    let lastH = 0;
    let poke = null;
    let lastScroll = 0;

    /* A re-measure during a scroll is exactly when it is felt: the editor
     * recomputes its height map mid-gesture and throws the viewport back to the
     * top of the note. Watch the scroller and wait for it to settle. */
    const scroller = elm.closest(".cm-scroller") || elm.closest(".markdown-preview-view");
    const noteScroll = () => { lastScroll = Date.now(); };
    if (scroller) scroller.addEventListener("scroll", noteScroll, { passive: true });

    const SETTLE_MS = 450;
    const fire = () => {
      const since = Date.now() - lastScroll;
      if (since < SETTLE_MS) {
        /* Still scrolling. Come back once it has stopped rather than dropping
         * the re-measure, or the height map stays wrong and the note goes
         * blank further down. */
        poke = window.setTimeout(fire, SETTLE_MS - since);
        return;
      }
      /* Obsidian recomputes CodeMirror's measurements on a window resize;
       * there is no public API to invalidate the height map directly. */
      window.dispatchEvent(new Event("resize"));
    };

    const remeasure = () => {
      const h = root.offsetHeight;
      if (Math.abs(h - lastH) < 24) return;
      lastH = h;
      window.clearTimeout(poke);
      poke = window.setTimeout(fire, isMobile() ? 200 : 60);
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(remeasure);
      ro.observe(root);
      /* Torn down with the block, or the observer outlives the element. */
      ctx.addChild(new (class extends MarkdownRenderChild {
        onunload() {
          ro.disconnect();
          window.clearTimeout(poke);
          if (scroller) scroller.removeEventListener("scroll", noteScroll);
        }
      })(elm));
    }
  }
};





/* What is due, and the way in. Counts come from quest-cache.json because the
 * plugin cannot read LearnKit's SQLite store directly; xp-sync.py already has
 * it open, so it writes the summary out. */
async function studyCard(plugin, grid, cls = "col3") {
  const q = await plugin.game.quest();
  const s = q?.study;
  if (!s || !s.total) return;

  const c = card(grid, "Study", "\u25AD", cls);

  const head = el(c, "div", "lifeos-study-head");
  el(head, "div", "lifeos-study-due", String(s.due));
  el(head, "div", "lifeos-study-duelabel",
    s.due === 1 ? "card due" : "cards due");
  el(head, "div", "lifeos-study-sub",
    `${s.reviewed} of ${s.total} seen \u00B7 ${s.mature} mature`);

  progressBar(c, s.total ? s.reviewed / s.total : 0);

  const decks = s.decks ?? [];
  for (const d of decks.slice(0, 5)) {
    const row = el(c, "div", "lifeos-deckrow");
    el(row, "span", "lifeos-deckrow-name", d.deck);
    el(row, "span", "lifeos-deckrow-due", d.due ? `${d.due} due` : "clear");
    el(row, "span", "lifeos-deckrow-count", `${d.cards}`);
  }
  if (decks.length > 5) {
    const rest = decks.slice(5);
    const row = el(c, "div", "lifeos-deckrow is-more");
    el(row, "span", "lifeos-deckrow-name", `+ ${rest.length} more domains`);
    el(row, "span", "lifeos-deckrow-count",
      String(rest.reduce((a, d) => a + d.cards, 0)));
  }

  const actions = el(c, "div", "lifeos-study-actions");
  mkBtn(actions, "Open LearnKit", () => plugin.openLearnKit("home"), "primary");
  mkBtn(actions, "Study now", () => plugin.openLearnKit("study"));
  /* Points at the built papers rather than LearnKit's Tests view, which is an
   * AI generator and needs a provider key that is not configured. */
  mkBtn(actions, "Practice exams", () => plugin.openPracticeExams());

  /* Readiness for whatever certification is active, since studying is in
   * service of an exam rather than an end in itself. */
  const cert = (q.certifications ?? [])[0];
  if (cert) {
    const r = el(c, "div", "lifeos-study-cert");
    const rh = el(r, "div", "lifeos-study-certhead");
    el(rh, "span", "lifeos-study-certname", cert.name);
    el(rh, "span", "lifeos-study-certpct", `${Math.round(cert.score)}%`);
    progressBar(r, cert.score / 100, "lifeos-bar-sm");
    onTap(r, () => plugin.open(P.quest));
  }
}




/* ------------------------------------------------------------ the library */

/* Fetching and installing shared decks.
 *
 * This is the only part of Uptick that touches the network, and the only part
 * that writes files someone else authored into your vault. Everything below is
 * built around that: the host is fixed, paths are validated before use, sizes
 * are capped, and you are shown exactly what will be written before it is.
 *
 * The registry is an index of pointers. Deck content lives in its author's own
 * repository and is fetched from raw.githubusercontent.com — no other host is
 * contacted, whatever the index says. */

const LIB_HOST = "raw.githubusercontent.com";
const LIB_MAX_BYTES = 2 * 1024 * 1024;      // one deck file
const LIB_MAX_FILES = 20;

/* A GitHub repo URL -> owner/name, or null if it is not one. Anything that
 * fails this is never fetched, which is what stops a malicious index pointing
 * the plugin at an arbitrary server. */
function libRepoSlug(url) {
  const m = String(url || "").match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/* A path inside a repo, or null. Rejects traversal, absolute paths, anything
 * that is not Markdown, and anything with a character that has no business in
 * a vault filename. */
function libSafeFile(file) {
  const f = String(file || "").trim().replace(/^\.\//, "");
  if (!f || f.startsWith("/") || f.includes("..") || f.includes("\\")) return null;
  if (!/\.md$/i.test(f)) return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(f)) return null;
  return f;
}

function libRawUrl(entry, file) {
  const slug = libRepoSlug(entry.repo);
  const safe = libSafeFile(file);
  if (!slug || !safe) return null;
  const branch = /^[\w.\/-]{1,64}$/.test(String(entry.branch || "main"))
    ? String(entry.branch || "main") : "main";
  return `https://${LIB_HOST}/${slug}/${branch}/${safe.split("/").map(encodeURIComponent).join("/")}`;
}

/* An id is used as a folder name, so it is validated as strictly as the
 * registry validates it. */
function libSafeId(id) {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(String(id || "")) ? String(id) : null;
}

class Library {
  constructor(plugin) {
    this.plugin = plugin;
    this._index = null;
    this._at = 0;
  }

  get folder() {
    const base = cfgGet(this.plugin.cfg, "paths.knowledge", DEFAULTS.paths.knowledge);
    const sub = cfgGet(this.plugin.cfg, "library.folder", "Library");
    return `${base}/${sub}`;
  }

  /* The index, cached for the session. Errors are returned rather than thrown:
   * a registry being unreachable is an ordinary state, not a fault. */
  async index({ force = false } = {}) {
    if (!this.plugin.on("library")) return { error: "The Library is turned off in settings." };
    if (!force && this._index && Date.now() - this._at < 10 * 60 * 1000) return this._index;

    const url = cfgGet(this.plugin.cfg, "library.registry", "");
    if (!/^https:\/\//.test(url)) return { error: "The registry URL must be https." };
    try {
      const res = await requestUrl({ url, method: "GET", throw: false });
      if (res.status !== 200) return { error: `Registry returned ${res.status}.` };
      const data = JSON.parse(res.text);
      const decks = Array.isArray(data.decks) ? data.decks.filter((d) =>
        libSafeId(d.id) && libRepoSlug(d.repo) && Array.isArray(d.files)
        && d.files.length && d.files.length <= LIB_MAX_FILES
        && d.files.every((f) => libSafeFile(f)) && String(d.license || "").trim()) : [];
      this._index = { decks, updated: data.updated, skipped: (data.decks?.length ?? 0) - decks.length };
      this._at = Date.now();
      return this._index;
    } catch (e) {
      return { error: `Could not read the registry: ${e.message ?? e}` };
    }
  }

  /* What installing would write. Shown before anything is fetched, because a
   * deck is someone else's file landing in your vault. */
  plan(entry) {
    const id = libSafeId(entry.id);
    if (!id) return { error: "That deck has an unusable id." };
    const files = (entry.files || []).map((f) => {
      const safe = libSafeFile(f);
      return safe ? { from: libRawUrl(entry, safe), to: `${this.folder}/${id}/${safe.split("/").pop()}` } : null;
    }).filter(Boolean);
    if (!files.length) return { error: "That deck lists no usable files." };
    return { id, files };
  }

  async install(entry) {
    const plan = this.plan(entry);
    if (plan.error) return plan;
    const vault = this.plugin.app.vault;

    for (const part of [this.folder, `${this.folder}/${plan.id}`]) {
      const chain = part.split("/").filter(Boolean);
      for (let i = 1; i <= chain.length; i++) {
        const dir = chain.slice(0, i).join("/");
        if (vault.getAbstractFileByPath(dir)) continue;
        try { await vault.createFolder(dir); } catch (e) { /* exists */ }
      }
    }

    const written = [];
    for (const f of plan.files) {
      const res = await requestUrl({ url: f.from, method: "GET", throw: false });
      if (res.status !== 200) return { error: `${f.from} returned ${res.status}`, written };
      if ((res.text?.length ?? 0) > LIB_MAX_BYTES) {
        return { error: `${f.to} is larger than the ${Math.round(LIB_MAX_BYTES / 1024)}KB limit`, written };
      }
      /* Provenance is written into the file itself. Six months from now the
       * only way to know where a deck came from is if it says so. */
      const header = [
        "---",
        `library_id: ${plan.id}`,
        `source: ${entry.repo}`,
        `author: ${entry.author ?? "unknown"}`,
        `license: ${entry.license ?? "unstated"}`,
        `installed: ${moment().format("YYYY-MM-DD")}`,
        "---",
        "",
      ].join("\n");
      const existing = vault.getAbstractFileByPath(f.to);
      if (existing instanceof TFile) {
        await vault.modify(existing, header + res.text);
      } else {
        await vault.create(f.to, header + res.text);
      }
      written.push(f.to);
    }
    return { written, id: plan.id };
  }
}



/* A guided walkthrough for publishing a deck.
 *
 * Sharing is four steps, and every one of them is somewhere a person gives up:
 * choosing a file, writing a licence, filling in JSON by hand, and finding the
 * right repo to open a PR against. This does the parts a machine can do —
 * it copies your deck out with a licence and a README attached, and generates
 * the registry entry — and hands you a link for the parts it cannot. */
class ShareDeckModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 0;
    this.state = { file: null, name: "", description: "", topic: "",
                   certification: "", license: "CC-BY-4.0", author: "",
                   repo: "", type: "flashcards" };
  }

  onOpen() {
    this.modalEl.addClass("lifeos-sharemodal");
    this.draw();
  }

  /* Decks are notes containing LearnKit cards or generated exam questions. */
  candidates() {
    const study = cfgGet(this.plugin.cfg, "paths.knowledge", DEFAULTS.paths.knowledge);
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(study + "/"))
      .filter((f) => {
        const c = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
        return c.type === "flashcard-deck" || c.type === "practice-exam" || c.cards;
      })
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  draw() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lifeos-modal");
    el(contentEl, "h3", "lifeos-modal-title", "Share a deck");

    const steps = el(contentEl, "div", "lifeos-sharesteps");
    ["Pick", "Describe", "Licence", "Publish"].forEach((s, i) => {
      const chip = el(steps, "span",
        `lifeos-sharestep${i === this.step ? " is-on" : ""}${i < this.step ? " is-done" : ""}`,
        `${i + 1}. ${s}`);
      if (i < this.step) onTap(chip, () => { this.step = i; this.draw(); });
    });

    [() => this.stepPick(contentEl), () => this.stepDescribe(contentEl),
     () => this.stepLicence(contentEl), () => this.stepPublish(contentEl)][this.step]();
  }

  nav(parent, { back = true, next = null, nextLabel = "Next" } = {}) {
    const bar = el(parent, "div", "lifeos-modal-actions");
    if (back && this.step > 0) mkBtn(bar, "Back", () => { this.step--; this.draw(); });
    mkBtn(bar, "Close", () => this.close());
    if (next) mkBtn(bar, nextLabel, next, "primary");
  }

  stepPick(root) {
    el(root, "div", "lifeos-modal-help",
      "Which deck do you want to share? Only decks you wrote should be shared \u2014 "
      + "questions copied from a paid exam bank are not yours to redistribute.");
    const list = this.candidates();
    if (!list.length) {
      el(root, "div", "lifeos-empty",
        `No decks found under ${cfgGet(this.plugin.cfg, "paths.knowledge", "")}. `
        + "A deck is a note with flashcards or exam questions in it.");
      this.nav(root, { back: false });
      return;
    }
    const box = el(root, "div", "lifeos-sharelist");
    for (const f of list) {
      const row = el(box, "div",
        `lifeos-sharerow${this.state.file === f.path ? " is-on" : ""}`);
      el(row, "span", "lifeos-sharerow-name", f.basename);
      el(row, "span", "lifeos-sharerow-path", f.parent?.name ?? "");
      onTap(row, () => {
        this.state.file = f.path;
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
        this.state.name ||= String(fm.title ?? f.basename);
        this.state.certification ||= String(fm.certification ?? "");
        this.state.type = fm.type === "practice-exam" ? "exam" : "flashcards";
        this.step = 1;
        this.draw();
      });
    }
    this.nav(root, { back: false });
  }

  stepDescribe(root) {
    el(root, "div", "lifeos-modal-help",
      "How it will appear in the library. Be honest about scope \u2014 people "
      + "decide whether to spend hours on a deck from these three lines.");
    const rows = el(root, "div", "lifeos-form");
    const field = (key, label, placeholder) => {
      const row = el(rows, "div", "lifeos-formrow");
      el(row, "label", "lifeos-formlabel", label);
      const i = row.createEl("input", { cls: "lifeos-input", type: "text" });
      i.value = this.state[key] ?? "";
      i.placeholder = placeholder ?? "";
      i.addEventListener("input", () => { this.state[key] = i.value; });
    };
    field("name", "Name", "Salesforce Administrator — Fundamentals");
    field("description", "One line", "Core admin concepts, written from the public exam guide.");
    field("topic", "Topic", "Salesforce");
    field("certification", "Certification (optional)", "Salesforce Certified Administrator");
    field("author", "Your GitHub username", "your-username");
    this.nav(root, { next: () => {
      if (!this.state.name.trim() || !this.state.topic.trim() || !this.state.author.trim()) {
        return new Notice("Name, topic and username are needed.");
      }
      this.step = 2;
      this.draw();
    } });
  }

  stepLicence(root) {
    el(root, "div", "lifeos-modal-help",
      "A licence tells people what they may do with your work. Without one, "
      + "strictly nobody may reuse it \u2014 and the library will not list it.");
    const box = el(root, "div", "lifeos-licences");
    for (const [id, label, why] of [
      ["CC-BY-4.0", "CC BY 4.0", "Anyone may use and adapt it, as long as they credit you. The usual choice for study material."],
      ["CC-BY-SA-4.0", "CC BY-SA 4.0", "Same, but derivatives must share alike. Keeps improvements open."],
      ["CC0-1.0", "CC0", "Public domain. No credit required, no strings."],
      ["MIT", "MIT", "Permissive and familiar, though written for code rather than content."],
    ]) {
      const row = el(box, "div", `lifeos-licence${this.state.license === id ? " is-on" : ""}`);
      el(row, "div", "lifeos-licence-name", label);
      el(row, "div", "lifeos-licence-why", why);
      onTap(row, () => { this.state.license = id; this.draw(); });
    }
    const warn = el(root, "div", "lifeos-sharewarn");
    el(warn, "div", null,
      "By publishing you are asserting this is your own work, or that you have "
      + "the right to share it under this licence. Questions transcribed from a "
      + "paid course or exam bank are neither.");
    this.nav(root, { next: () => { this.step = 3; this.draw(); } });
  }

  async stepPublish(root) {
    el(root, "div", "lifeos-modal-help",
      "Everything that can be prepared for you has been. Two steps left, both "
      + "on GitHub.");

    const entry = this.entry();
    const steps = el(root, "div", "lifeos-publish");

    const one = el(steps, "div", "lifeos-publishstep");
    el(one, "div", "lifeos-publishstep-n", "1");
    const oneBody = el(one, "div", "lifeos-publishstep-body");
    el(oneBody, "div", "lifeos-publishstep-title", "Export the deck");
    el(oneBody, "div", "lifeos-publishstep-text",
      "Writes your deck, a LICENSE and a README into a folder ready to push.");
    mkBtn(oneBody, "Export to a folder", () => this.exportDeck(), "primary");

    const two = el(steps, "div", "lifeos-publishstep");
    el(two, "div", "lifeos-publishstep-n", "2");
    const twoBody = el(two, "div", "lifeos-publishstep-body");
    el(twoBody, "div", "lifeos-publishstep-title", "Push it to a public GitHub repo");
    el(twoBody, "div", "lifeos-publishstep-text",
      "Any public repo will do. Drag the folder's files in through the web UI if "
      + "you would rather not use git.");
    mkBtn(twoBody, "Create a repo on GitHub", () => window.open("https://github.com/new", "_blank"));

    const three = el(steps, "div", "lifeos-publishstep");
    el(three, "div", "lifeos-publishstep-n", "3");
    const threeBody = el(three, "div", "lifeos-publishstep-body");
    el(threeBody, "div", "lifeos-publishstep-title", "Add this entry to the library");
    el(threeBody, "div", "lifeos-publishstep-text",
      "Set `repo` to the URL of the repo you just made, then open a pull request "
      + "adding it to library.json.");
    const pre = el(threeBody, "pre", "lifeos-publishjson");
    pre.setText(JSON.stringify(entry, null, 2));
    const row = el(threeBody, "div", "lifeos-inline-actions");
    mkBtn(row, "Copy this entry", async () => {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      new Notice("Copied. Paste it into library.json in your fork.");
    }, "primary");
    mkBtn(row, "Open the library repo", () =>
      window.open(this.registryRepo() + "/edit/main/library.json", "_blank"));

    this.nav(root, { nextLabel: "Done", next: () => this.close() });
  }

  registryRepo() {
    const url = cfgGet(this.plugin.cfg, "library.registry", "");
    const m = String(url).match(/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\//);
    return m ? `https://github.com/${m[1]}/${m[2]}` : "https://github.com";
  }

  entry() {
    const s = this.state;
    const file = s.file ? s.file.split("/").pop() : "deck.md";
    const slug = (s.name || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 64) || "deck";
    const cards = this.countCards();
    return {
      id: slug,
      name: s.name,
      description: s.description,
      type: s.type,
      topic: s.topic,
      ...(s.certification ? { certification: s.certification } : {}),
      author: s.author,
      repo: `https://github.com/${s.author}/REPLACE-WITH-YOUR-REPO`,
      branch: "main",
      files: [file],
      cards,
      license: s.license,
      original: true,
      tags: [s.topic.toLowerCase()].filter(Boolean),
      added: moment().format("YYYY-MM-DD"),
    };
  }

  countCards() {
    const f = this.state.file && this.app.vault.getAbstractFileByPath(this.state.file);
    const fm = f ? this.app.metadataCache.getFileCache(f)?.frontmatter ?? {} : {};
    return Number(fm.cards) || Number(fm.questions) || 0;
  }

  /* Writes the deck plus the two files a shareable repo needs. Kept inside the
   * vault so nothing is written anywhere the user has not already trusted. */
  async exportDeck() {
    const src = this.state.file && this.app.vault.getAbstractFileByPath(this.state.file);
    if (!(src instanceof TFile)) return new Notice("Pick a deck first.");
    const entry = this.entry();
    const base = `${this.plugin.library.folder}/_share/${entry.id}`;

    for (const part of base.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))) {
      if (this.app.vault.getAbstractFileByPath(part)) continue;
      try { await this.app.vault.createFolder(part); } catch (e) { /* exists */ }
    }

    const body = await this.app.vault.read(src);
    const name = src.name;
    const write = async (path, text) => {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.modify(existing, text);
      else await this.app.vault.create(path, text);
    };

    await write(`${base}/${name}`, body);
    await write(`${base}/LICENSE.md`, licenceText(entry.license, entry.author));
    await write(`${base}/README.md`, [
      `# ${entry.name}`, "",
      entry.description || "", "",
      `- **Topic:** ${entry.topic}`,
      entry.certification ? `- **Certification:** ${entry.certification}` : "",
      `- **Cards:** ${entry.cards || "see the file"}`,
      `- **Licence:** ${entry.license}`,
      `- **Author:** ${entry.author}`, "",
      "## Using this deck", "",
      "It is a plain Markdown file. Copy it into your vault, or install it from",
      "the Uptick Library.", "",
      "## Provenance", "",
      "Written by the author. Not transcribed from any paid course or",
      "commercial exam bank.", "",
    ].filter((l) => l !== "").join("\n") + "\n");

    new Notice(`Exported to ${base}. Push those three files to a public repo.`);
    await this.plugin.open(`${base}/README.md`);
  }
}

function licenceText(id, author) {
  const year = moment().format("YYYY");
  if (id === "MIT") {
    return `MIT License\n\nCopyright (c) ${year} ${author}\n\n`
      + "Permission is hereby granted, free of charge, to any person obtaining a copy\n"
      + "of this software and associated documentation files (the \"Software\"), to deal\n"
      + "in the Software without restriction...\n\nSee https://opensource.org/licenses/MIT\n";
  }
  const names = {
    "CC-BY-4.0": ["Creative Commons Attribution 4.0 International",
                  "https://creativecommons.org/licenses/by/4.0/"],
    "CC-BY-SA-4.0": ["Creative Commons Attribution-ShareAlike 4.0 International",
                     "https://creativecommons.org/licenses/by-sa/4.0/"],
    "CC0-1.0": ["CC0 1.0 Universal (public domain dedication)",
                "https://creativecommons.org/publicdomain/zero/1.0/"],
  };
  const [full, url] = names[id] ?? names["CC-BY-4.0"];
  return `# ${full}\n\nCopyright (c) ${year} ${author}\n\n`
    + `This work is licensed under ${full}.\n\nFull text: ${url}\n\n`
    + "You are free to share and adapt this material, provided you give\n"
    + "appropriate credit.\n";
}

/* -------------------------------------------------------------- library UI */

async function renderLibrary(plugin, root, cfg, ctx, redraw) {
  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: "Library" }]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Library");
  el(ht, "div", "lifeos-sub",
    "Flashcard decks and practice exams shared by other people. Each one lives "
    + "in its author's own repository \u2014 this is an index, not a store.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Share a deck", () => new ShareDeckModal(plugin.app, plugin).open(), "primary");
  mkBtn(nav, "Refresh", async () => { await plugin.library.index({ force: true }); await redraw(); });

  if (!plugin.on("library")) {
    const off = el(root, "div", "lifeos-liboff");
    el(off, "div", "lifeos-liboff-title", "The Library is turned off");
    el(off, "div", "lifeos-liboff-text",
      "Uptick does not touch the network unless you let it. Turning this on "
      + "lets it read the community index and download decks you choose. "
      + "Nothing is uploaded, and nothing else in the plugin makes requests.");
    mkBtn(off, "Turn on the Library", async () => {
      await plugin.setCfg("modules.library", true);
      await redraw();
    }, "primary");
    return;
  }

  const idx = await plugin.library.index();
  if (idx.error) {
    const box = el(root, "div", "lifeos-empty");
    el(box, "div", null, idx.error);
    mkBtn(box, "Try again", async () => { await plugin.library.index({ force: true }); await redraw(); });
    return;
  }

  const decks = idx.decks ?? [];
  const installed = new Set();
  const folder = plugin.app.vault.getAbstractFileByPath(plugin.library.folder);
  for (const child of folder?.children ?? []) installed.add(child.name);

  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Decks", decks.length, "in the index", "\u25AD");
  tile(strip, "Installed", installed.size, "in your vault", "\u2713");
  tile(strip, "Topics", new Set(decks.map((d) => d.topic)).size, "covered", "\u25CE");
  tile(strip, "Share yours", "\u2192", "it takes a few minutes", "\u2726",
    () => new ShareDeckModal(plugin.app, plugin).open());

  if (idx.skipped) {
    el(root, "div", "lifeos-libnote",
      `${idx.skipped} entr${idx.skipped === 1 ? "y was" : "ies were"} ignored for `
      + "failing validation \u2014 a missing licence, or a file path that could not be trusted.");
  }

  if (!decks.length) {
    const box = el(root, "div", "lifeos-empty");
    el(box, "div", null,
      "Nothing in the index yet. If you have a deck worth sharing, it could be the first.");
    mkBtn(box, "Share a deck", () => new ShareDeckModal(plugin.app, plugin).open(), "primary");
    return;
  }

  const filters = el(root, "div", "lifeos-achfilters");
  const search = filters.createEl("input", { cls: "lifeos-achsearch", type: "text" });
  search.placeholder = "Filter by name, topic or certification\u2026";
  const chips = el(filters, "div", "lifeos-achchips");
  const listHost = el(root, "div", "lifeos-libgrid");
  const state = { topic: "all", q: "" };

  const draw = () => {
    listHost.empty();
    const q = state.q.trim().toLowerCase();
    const shown = decks.filter((d) =>
      (state.topic === "all" || d.topic === state.topic) &&
      (!q || `${d.name} ${d.topic} ${d.certification ?? ""} ${(d.tags ?? []).join(" ")}`
        .toLowerCase().includes(q)));
    if (!shown.length) {
      el(listHost, "div", "lifeos-empty", "Nothing matches that filter.");
      return;
    }
    for (const d of shown) libCard(plugin, listHost, d, installed.has(d.id), redraw);
  };

  for (const [key, label] of [["all", "All"],
      ...[...new Set(decks.map((d) => d.topic))].sort().map((x) => [x, x])]) {
    const chip = el(chips, "span", `lifeos-chip${key === "all" ? " is-on" : ""}`, label);
    onTap(chip, () => {
      state.topic = key;
      chips.findAll(".lifeos-chip").forEach((c) => c.removeClass("is-on"));
      chip.addClass("is-on");
      draw();
    });
  }
  search.addEventListener("input", () => { state.q = search.value; draw(); });
  draw();
}

function libCard(plugin, parent, d, isInstalled, redraw) {
  const box = el(parent, "div", `lifeos-libcard${isInstalled ? " is-installed" : ""}`);
  const top = el(box, "div", "lifeos-libcard-top");
  el(top, "span", "lifeos-libcard-name", d.name);
  el(top, "span", "lifeos-libcard-count", `${d.cards ?? "?"} cards`);
  el(box, "div", "lifeos-libcard-desc", d.description ?? "");

  const meta = el(box, "div", "lifeos-libcard-meta");
  if (d.certification) el(meta, "span", "lifeos-libcard-cert", d.certification);
  el(meta, "span", "lifeos-libcard-author", `by ${d.author}`);
  el(meta, "span", "lifeos-libcard-licence", d.license);

  const acts = el(box, "div", "lifeos-libcard-actions");
  if (isInstalled) {
    el(acts, "span", "lifeos-libcard-done", "\u2713 installed");
    mkBtn(acts, "Update", () => libInstall(plugin, d, redraw));
  } else {
    mkBtn(acts, "Install", () => libInstall(plugin, d, redraw), "primary");
  }
  mkBtn(acts, "View source", () => window.open(d.repo, "_blank"));
  return box;
}

/* Installing writes someone else's file into your vault, so it says what it is
 * about to do and waits for a yes. */
async function libInstall(plugin, entry, redraw) {
  const plan = plugin.library.plan(entry);
  if (plan.error) return new Notice(plan.error);

  const ok = await prompt(plugin.app, {
    title: `Install "${entry.name}"?`,
    help: [
      `From: ${entry.repo}`,
      `Licence: ${entry.license}`,
      "",
      `${plan.files.length} file(s) will be written to:`,
      ...plan.files.map((f) => `  ${f.to}`),
      "",
      "Type INSTALL to continue.",
    ].join("\n"),
    placeholder: "INSTALL",
    cta: "Install",
  });
  if (String(ok).trim().toUpperCase() !== "INSTALL") return;

  new Notice(`Fetching "${entry.name}"\u2026`);
  const res = await plugin.library.install(entry);
  if (res.error) return new Notice(`Install failed: ${res.error}`);
  new Notice(`Installed ${res.written.length} file(s) into ${plugin.library.folder}/${res.id}`);
  await redraw();
}

/* ------------------------------------------------ workflow assistant views */

async function workflowState(plugin) {
  const configured = String(cfgGet(plugin.cfg, "reminders.statePath",
    "4 System/Automation/reminders-sync-state.json"));
  try {
    const base = plugin.app.vault.adapter.basePath ?? "";
    const relative = base && configured.startsWith(`${base}/`)
      ? configured.slice(base.length + 1) : configured;
    return JSON.parse(await plugin.app.vault.adapter.read(relative));
  } catch (e) {
    return { workflow: { triageQueue: {}, activity: [], reschedules: {} } };
  }
}

function workflowHeader(plugin, root, title, subtitle) {
  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: title }]);
  const head = el(root, "div", "lifeos-head");
  const text = el(head, "div", "lifeos-head-text");
  el(text, "h1", "lifeos-h1", title);
  el(text, "div", "lifeos-sub", subtitle);
  return head;
}

async function renderWorkflowTriage(plugin, root, cfg, ctx, redraw) {
  const head = workflowHeader(plugin, root, "Triage queue",
    "Review uncertain tasks before they enter a Reminders category.");
  mkBtn(head, "Refresh", async () => { await plugin.runWorkflowScript(["--triage"]); await redraw(); }, "primary");
  mkBtn(head, "Cloud suggestions", async () => {
    const out = await plugin.runWorkflowScript(["--triage", "--send"]);
    if (out.code) new Notice((out.stderr || "Triage provider unavailable").slice(0, 180));
    await redraw();
  });
  const state = await workflowState(plugin);
  const queue = Object.values(state.workflow?.triageQueue || {});
  const box = el(root, "div", "lifeos-grid");
  if (!queue.length) {
    el(box, "div", "lifeos-empty", "No tasks are waiting for triage.");
    return;
  }
  for (const item of queue) {
    const cardEl = card(box, item.title || "Task", "◎", "col1");
    const suggestion = item.suggestion || {};
    detail(cardEl, "Suggested category", suggestion.category || "Inbox / needs triage");
    detail(cardEl, "Suggested status", suggestion.status || "#not-started");
    detail(cardEl, "Suggested duration", suggestion.duration || "#20min");
    detail(cardEl, "Phone capable", suggestion.phone ? "Yes" : "No");
    detail(cardEl, "Priority", suggestion.priority || "medium");
    detail(cardEl, "Source", suggestion.source === "cloud" ? "Configured AI provider" : "Local cues / learning");
    detail(cardEl, "Confidence", suggestion.confidence || "low");
    detail(cardEl, "Why", suggestion.reason || "No clear evidence");
    const actions = el(cardEl, "div", "lifeos-inline-actions");
    mkBtn(actions, "Approve suggestion", async () => {
      if (!suggestion.category) return new Notice("No category suggestion to approve.");
      const approved = await plugin.runWorkflowScript(["--approve", item.taskId, String(suggestion.category), String(item.title || "")]);
      if (approved.code) return new Notice((approved.stderr || "Triage approval failed").slice(0, 180));
      new Notice("Triage approved and learned locally.");
      await redraw();
    }, "primary");
    mkBtn(actions, "Keep in Inbox", async () => {
      await plugin.runWorkflowScript(["--approve", item.taskId, "", ""]);
      new Notice("Kept in Inbox for later review.");
      await redraw();
    });
  }
}

function waitingLine(parent, item, label) {
  const row = el(parent, "div", "lifeos-task");
  el(row, "span", "lifeos-task-dot");
  el(row, "span", "lifeos-task-text", item.title || item.text || item.id);
  el(row, "span", "lifeos-task-due", label || item.followUpDate || "no follow-up");
  return row;
}

async function runWaitingAction(plugin, item, action, redraw) {
  let value = "";
  if (action === "follow-up" || action === "reschedule") {
    value = await prompt(plugin.app, { title: action === "follow-up" ? "Set follow-up date" : "Reschedule task",
      help: "Use YYYY-MM-DD. The change is written to Obsidian and applied to Reminders on the next sync.",
      placeholder: "YYYY-MM-DD", cta: "Save" });
    if (!value) return;
  } else {
    const phrase = action === "archive" ? "ARCHIVE" : action === "unblock" ? "UNBLOCK" : "CONFIRM";
    const ok = await prompt(plugin.app, { title: `${action[0].toUpperCase()}${action.slice(1)} waiting task?`,
      help: action === "archive" ? "This completes the task and adds #archived; it remains recoverable in the Task Inbox." : "Type the confirmation word to continue.",
      placeholder: phrase, cta: action });
    if (String(ok).trim().toUpperCase() !== phrase) return;
  }
  const out = await plugin.runWorkflowScript(["--waiting-action", item.id, action, value || ""]);
  if (out.code) new Notice((out.stderr || "Waiting action failed").slice(0, 180));
  else new Notice(`${action} saved; run Reminders sync to publish it.`);
  await redraw();
}

async function renderWaitingDashboard(plugin, root, cfg, ctx, redraw) {
  const head = workflowHeader(plugin, root, "Waiting dashboard",
    "Blocked and dependency work, with the next person or date to follow up.");
  mkBtn(head, "Refresh", async () => { await redraw(); }, "primary");
  const out = await plugin.runWorkflowScript(["--waiting-dashboard"]);
  let data = null; try { data = JSON.parse(out.stdout || "{}"); } catch (e) { data = null; }
  if (!data?.ok) return el(root, "div", "lifeos-error", out.stderr || "Waiting data unavailable");
  const grid = el(root, "div", "lifeos-grid");
  for (const [key, title, glyph] of [["overdue", "Overdue follow-ups", "!"], ["upcoming", "Upcoming", "→"], ["undated", "Needs a date", "?"], ["aging", "Aging blockers", "◷"]]) {
    const c = card(grid, title, glyph, "col1");
    const items = data[key] || [];
    if (!items.length) el(c, "div", "lifeos-empty", "Nothing here.");
    for (const item of items.slice(0, 30)) {
      const row = waitingLine(c, item);
      onTap(row, () => plugin.openWorkflowTaskDetail(item.id));
      const actions = el(c, "div", "lifeos-inline-actions");
      mkBtn(actions, "Details", () => plugin.openWorkflowTaskDetail(item.id));
      mkBtn(actions, "Follow up", () => runWaitingAction(plugin, item, "follow-up", redraw));
      mkBtn(actions, "Reschedule", () => runWaitingAction(plugin, item, "reschedule", redraw));
      mkBtn(actions, "Unblock", () => runWaitingAction(plugin, item, "unblock", redraw));
      mkBtn(actions, "Archive", () => runWaitingAction(plugin, item, "archive", redraw));
    }
  }
  const reasons = card(grid, "Waiting by reason", "⊙", "span3");
  for (const [key, title] of [["blocked", "Blocked"], ["dependency", "Dependency"]]) {
    const section = el(reasons, "div", "lifeos-subsection");
    el(section, "div", "lifeos-setrow-label", `${title} (${(data.byReason?.[key] || []).length})`);
    for (const item of (data.byReason?.[key] || []).slice(0, 20)) waitingLine(section, item);
  }
}

async function renderSyncActivity(plugin, root, cfg, ctx, redraw) {
  const head = workflowHeader(plugin, root, "Sync activity", "A permanent local audit of workflow and Reminders changes.");
  mkBtn(head, "Refresh", redraw, "primary");
  const filter = head.createEl("select", { cls: "lifeos-setselect" });
  for (const value of ["all", "sync", "reminder-deleted", "reminder-restored", "reminder-deletion-review", "triage", "reschedule", "waiting-action", "email-completion", "error"]) {
    const option = filter.createEl("option", { text: value === "all" ? "All events" : value });
    option.value = value;
  }
  const exportActivity = async () => {
    const state = await workflowState(plugin);
    const rows = (state.workflow?.activity || []).map((event) => {
      const safe = Object.entries(event).filter(([key]) => !["at", "kind", "task", "parent", "reminderId", "mailId", "url"].includes(key))
        .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`).join("; ");
      return `- ${event.at || ""} · ${event.kind || "event"}${safe ? ` · ${safe}` : ""}`;
    });
    const path = `${P.automation}/Reports/Sync Activity Export.md`;
    await plugin.store.ensureFolder(`${P.automation}/Reports`);
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    const body = `# Sync Activity Export\n\n${rows.join("\n") || "No activity recorded."}\n`;
    if (existing instanceof TFile) await plugin.app.vault.modify(existing, body);
    else await plugin.app.vault.create(path, body);
    new Notice("Activity export written to the private vault.");
  };
  mkBtn(head, "Export", exportActivity);
  mkBtn(head, "Clear history", async () => {
    const ok = await prompt(plugin.app, { title: "Clear activity history?", help: "This clears activity events only. Task links, learning, and reschedule history remain.", placeholder: "CLEAR", cta: "Clear" });
    if (String(ok).trim().toUpperCase() !== "CLEAR") return;
    const out = await plugin.runWorkflowScript(["--clear-activity"]);
    if (out.code) new Notice((out.stderr || "Could not clear activity").slice(0, 180));
    await redraw();
  });
  const state = await workflowState(plugin);
  const selected = filter.value || "all";
  const events = [...(state.workflow?.activity || [])].reverse().filter((event) => selected === "all" || event.kind === selected || (selected === "error" && /error|fail/i.test(String(event.kind))));
  filter.addEventListener("change", redraw);
  const c = card(root, "Recent activity", "◌", "span3");
  if (!events.length) return el(c, "div", "lifeos-empty", "No activity recorded yet.");
  for (const event of events.slice(0, 100)) {
    const row = el(c, "div", "lifeos-linkrow");
    el(row, "span", "lifeos-ellipsis", `${event.at || ""} · ${event.kind || "event"}`);
    const summary = Object.entries(event).filter(([key]) => !["at", "kind", "task", "parent", "reminderId", "mailId", "url"].includes(key)).map(([key, value]) => `${key}: ${String(value).slice(0, 140)}`).join(" · ");
    el(row, "span", "lifeos-task-due", summary.slice(0, 140));
    if (event.task) mkBtn(row, "Open task", () => plugin.openWorkflowTaskDetail(event.task));
    if (event.kind === "reminder-deleted" && event.task) mkBtn(row, "Restore", async () => {
      const ok = await prompt(plugin.app, { title: "Restore deleted Reminder task?",
        help: "Restores the private 30-day tombstone and recreates the Apple Reminder.", placeholder: "RESTORE", cta: "Restore" });
      if (String(ok).trim().toUpperCase() !== "RESTORE") return;
      const out = await plugin.runReminderBridge(["--restore-deletion", String(event.task)]);
      if (out.code) return new Notice((out.stderr || "Could not restore deletion").slice(0, 180));
      new Notice("Reminder task restored."); await redraw();
    });
  }
}

async function renderEmailCompletionReview(plugin, root, cfg, ctx, redraw) {
  const head = workflowHeader(plugin, root, "Email completion review",
    "Only clear, uniquely linked sent emails close tasks automatically. Review the rest here.");
  mkBtn(head, "Refresh", redraw, "primary");
  const state = await workflowState(plugin);
  const queue = state.workflow?.emailCompletionReview || [];
  const tasks = await plugin.tasks.all();
  const titles = new Map(tasks.map((task) => [task.id, task.text]));
  const box = el(root, "div", "lifeos-grid");
  if (!queue.length) return el(box, "div", "lifeos-empty", "No sent-email completions need review.");
  for (const item of queue.slice().reverse()) {
    const panel = card(box, item.subject || "Sent email", "✉", "col1");
    detail(panel, "Reason", item.reason || "Ambiguous match");
    const candidates = item.taskIds || [];
    if (!candidates.length) el(panel, "div", "lifeos-muted", "No linked task was found. Link the task and rescan the message.");
    const actions = el(panel, "div", "lifeos-inline-actions");
    for (const id of candidates) {
      mkBtn(actions, `Complete: ${titles.get(id) || "Task"}`, async () => {
        const ok = await prompt(plugin.app, { title: "Complete this task from sent email?",
          help: "This marks the selected Obsidian task complete and the next Reminders sync mirrors it.",
          placeholder: "COMPLETE", cta: "Complete" });
        if (String(ok).trim().toUpperCase() !== "COMPLETE") return;
        const out = await plugin.runEmailCompletionScript(["--review-action", String(item.messageId), String(id), "approve"]);
        if (out.code) return new Notice((out.stderr || "Could not complete task").slice(0, 180));
        new Notice("Task completed from sent email review.");
        await redraw();
      }, "primary");
    }
    mkBtn(actions, "Reject", async () => {
      const ok = await prompt(plugin.app, { title: "Ignore this completion signal?",
        help: "The task remains open and this message will not be offered again.", placeholder: "REJECT", cta: "Ignore" });
      if (String(ok).trim().toUpperCase() !== "REJECT") return;
      const out = await plugin.runEmailCompletionScript(["--review-action", String(item.messageId), "", "reject"]);
      if (out.code) return new Notice((out.stderr || "Could not reject review item").slice(0, 180));
      await redraw();
    });
  }
}

async function renderWeeklyWorkflowReview(plugin, root, cfg, ctx, redraw) {
  const head = workflowHeader(plugin, root, "Weekly workflow review", "Approve the small set of decisions that keep work moving.");
  mkBtn(head, "Refresh", redraw, "primary");
  const state = await workflowState(plugin);
  const triage = Object.values(state.workflow?.triageQueue || {});
  const reschedules = Object.values(state.workflow?.reschedules || {}).flat();
  const grid = el(root, "div", "lifeos-grid");
  const t = card(grid, "Triage to review", "◎", "col1");
  el(t, "div", "lifeos-statcell-value", String(triage.length));
  el(t, "div", "lifeos-muted", "Open the triage queue to approve or keep items in Inbox.");
  mkBtn(t, "Open triage", () => plugin.openWorkflowView("triage", "Triage Queue"));
  const r = card(grid, "Reschedules", "↻", "col1");
  el(r, "div", "lifeos-statcell-value", String(reschedules.length));
  el(r, "div", "lifeos-muted", "Dates changed are retained as private history; decay is preserved.");
  const w = card(grid, "Weekly note", "▤", "col1");
  el(w, "div", "lifeos-muted", "Approved outcomes are appended to the existing weekly review note.");
  mkBtn(w, "Open this week", () => plugin.openWeekly(moment()), "primary");
  mkBtn(w, "Record review", async () => {
    const path = `${P.weekly}/${moment().startOf("isoWeek").format("GGGG-[W]WW")}.md`;
    if (!plugin.app.vault.getAbstractFileByPath(path)) await plugin.openWeekly(moment());
    await plugin.store.appendToSection(path,
      cfgGet(plugin.cfg, "workflowAssistant.weeklyReview.noteSection", "Uptick workflow review"),
      `- ${moment().format("YYYY-MM-DD")}: ${triage.length} triage item${triage.length === 1 ? "" : "s"}, ${reschedules.length} reschedule event${reschedules.length === 1 ? "" : "s"}; Waiting follow-ups reviewed.`);
    new Notice("Workflow review recorded in this week's note.");
  });
  const out = await plugin.runWorkflowScript(["--weekly-review"]);
  let review = null; try { review = JSON.parse(out.stdout || "{}"); } catch (e) { review = null; }
  const recommendations = card(root, "Recommendations", "✓", "span3");
  if (!review?.ok || !review.recommendations?.length) {
    el(recommendations, "div", "lifeos-empty", "No recommendations right now.");
  } else {
    for (const item of review.recommendations.slice(0, 30)) {
      const row = el(recommendations, "div", "lifeos-linkrow");
      el(row, "span", "lifeos-ellipsis", `${item.kind}: ${item.title || "Task"}`);
      el(row, "span", "lifeos-task-due", item.reason || "Review needed");
      if (item.kind === "triage") mkBtn(row, "Review", () => plugin.openWorkflowView("triage", "Triage Queue"));
      if (item.kind === "overdue") mkBtn(row, "Reschedule", () => runWaitingAction(plugin, item, "reschedule", redraw));
      if (item.kind === "waiting") mkBtn(row, "Set follow-up", () => runWaitingAction(plugin, item, "follow-up", redraw));
      if (item.kind === "reschedule-pattern") mkBtn(row, "Open task", () => plugin.openWorkflowTaskDetail(item.id));
    }
  }
}

/* ------------------------------------------------------------ settings UI */

/* Form primitives, styled to match the dashboards rather than Obsidian's own
 * settings tab. Each writes straight through to the stored config and saves,
 * so there is no Apply button to forget. */

function setRow(parent, label, help) {
  const row = el(parent, "div", "lifeos-setrow");
  const txt = el(row, "div", "lifeos-setrow-text");
  el(txt, "div", "lifeos-setrow-label", label);
  if (help) el(txt, "div", "lifeos-setrow-help", help);
  const ctl = el(row, "div", "lifeos-setrow-ctl");
  return ctl;
}

function setToggle(plugin, parent, path, label, help) {
  const ctl = setRow(parent, label, help);
  const on = !!cfgGet(plugin.cfg, path, false);
  const sw = el(ctl, "div", `lifeos-switch${on ? " is-on" : ""}`);
  /* The setting this switch binds to, so a test can ask whether a given
   * setting is reachable rather than counting anonymous switches. */
  sw.setAttr("data-cfg", path);
  el(sw, "div", "lifeos-switch-knob");
  onTap(sw, async () => {
    const next = !sw.hasClass("is-on");
    sw.toggleClass("is-on", next);
    await plugin.setCfg(path, next);
  });
  return sw;
}

function setText(plugin, parent, path, label, help, placeholder) {
  const ctl = setRow(parent, label, help);
  const input = ctl.createEl("input", { cls: "lifeos-setinput", type: "text" });
  input.value = String(cfgGet(plugin.cfg, path, "") ?? "");
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("change", async () => {
    await plugin.setCfg(path, input.value.trim());
  });
  return input;
}

function setNumber(plugin, parent, path, label, help, opts = {}) {
  const ctl = setRow(parent, label, help);
  const input = ctl.createEl("input", { cls: "lifeos-setinput is-num", type: "number" });
  input.value = String(cfgGet(plugin.cfg, path, 0));
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.step = String(opts.step ?? 1);
  input.addEventListener("change", async () => {
    let v = Number(input.value);
    if (!Number.isFinite(v)) v = cfgGet(DEFAULTS, path, 0);
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    input.value = String(v);
    await plugin.setCfg(path, v);
  });
  return input;
}

function setSelect(plugin, parent, path, label, help, options) {
  const ctl = setRow(parent, label, help);
  const sel = ctl.createEl("select", { cls: "lifeos-setselect" });
  for (const [value, text] of options) {
    const o = sel.createEl("option", { text });
    o.value = value;
  }
  sel.value = String(cfgGet(plugin.cfg, path, options[0][0]));
  sel.addEventListener("change", async () => { await plugin.setCfg(path, sel.value); });
  return sel;
}

/* A folder path with a warning when it does not exist. Wrong paths are the
 * most likely misconfiguration in another vault, and silence about it is how
 * someone concludes the plugin is broken. */
function setPath(plugin, parent, key, label, help, isFile = false) {
  const ctl = setRow(parent, label, help);
  const wrap = el(ctl, "div", "lifeos-setpath");
  const input = wrap.createEl("input", { cls: "lifeos-setinput", type: "text" });
  input.value = String(cfgGet(plugin.cfg, `paths.${key}`, "") ?? "");
  const flag = el(wrap, "span", "lifeos-setpath-flag");

  const verify = () => {
    const v = input.value.trim();
    const f = plugin.app.vault.getAbstractFileByPath(v);
    const ok = !!f && (isFile ? "extension" in f : !("extension" in f));
    flag.setText(!v ? "" : ok ? "\u2713" : "not found");
    flag.toggleClass("is-ok", ok);
    flag.toggleClass("is-bad", !!v && !ok);
  };
  verify();
  input.addEventListener("change", async () => {
    await plugin.setCfg(`paths.${key}`, input.value.trim());
    verify();
  });
  return input;
}

function setSection(root, title, help) {
  const sec = el(root, "div", "lifeos-setsection");
  const head = el(sec, "div", "lifeos-setsection-head");
  el(head, "div", "lifeos-setsection-title", title);
  if (help) el(head, "div", "lifeos-setsection-help", help);
  return el(sec, "div", "lifeos-setsection-body");
}

const TAB_NAMES = ["Setup", "Modules", "Layout", "Panels", "Mail",
                   "Reminders", "Experience", "Rewards", "Paths"];

function reminderConfigIssues(cfg) {
  const reminders = cfg?.reminders || {};
  const issues = [];
  const routes = Array.isArray(reminders.routes) ? reminders.routes : [];
  const routeTags = new Set();
  for (const route of routes) {
    const tag = String(route?.tag || "").trim().toLowerCase();
    if (!/^#[a-z0-9][a-z0-9-]*$/.test(tag) || !String(route?.list || "").trim())
      issues.push("Each route needs a valid #tag and list name.");
    if (routeTags.has(tag)) issues.push(`Duplicate category route tag: ${tag}`);
    routeTags.add(tag);
  }
  const tags = reminders.tags || {};
  const managed = ["notStarted", "inProgress", "blocked", "dependency",
    "needsTriage", "duration10", "duration20", "duration30", "onPhone", "followUp"];
  const seen = new Set();
  for (const key of managed) {
    const tag = String(tags[key] || "").trim().toLowerCase();
    if (!/^#[a-z0-9][a-z0-9-]*$/.test(tag)) issues.push(`Invalid ${key} tag.`);
    if (seen.has(tag)) issues.push(`Duplicate managed tag: ${tag}`);
    seen.add(tag);
  }
  if (reminders.enabled && (!String(reminders.inboxList || "").trim() || !String(reminders.waitingList || "").trim()))
    issues.push("Enabled sync needs both an Inbox list and a Waiting list.");
  return [...new Set(issues)];
}

async function renderSettings(plugin, root, cfg, ctx, redraw) {
  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: "Settings" }]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Settings");
  el(ht, "div", "lifeos-sub",
    "Everything Uptick reads. Changes save immediately \u2014 reopen a dashboard to see them.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Home", () => plugin.open(P.home));
  mkBtn(nav, "Reset all", async () => {
    const sure = await prompt(plugin.app, {
      title: "Reset every setting?",
      help: "Type RESET to restore the shipped defaults. Your notes are untouched.",
      placeholder: "RESET", cta: "Reset",
    });
    if (String(sure).trim().toUpperCase() !== "RESET") return;
    await plugin.replaceCfg({});
    new Notice("Settings reset to defaults");
    await redraw();
  });

  const tabs = TAB_NAMES;
  /* Opens on Setup: in a vault that has not been prepared, that is the only
   * tab that matters, and in one that has it reports everything present. */
  const state = { tab: TAB_NAMES.includes(plugin._settingsTab) ? plugin._settingsTab : "Setup" };
  plugin._settingsTab = null;
  const chips = el(root, "div", "lifeos-achchips lifeos-settabs");
  const body = el(root, "div", "lifeos-setbody");

  const draw = () => {
    body.empty();
    ({
      Setup: () => settingsSetup(plugin, body, redraw),
      Modules: () => settingsModules(plugin, body),
      Layout: () => settingsLayout(plugin, body),
      Panels: () => settingsPanels(plugin, body),
      Mail: () => settingsMail(plugin, body, state),
      Reminders: () => settingsReminders(plugin, body, state),
      Experience: () => settingsExperience(plugin, body),
      Rewards: () => settingsRewards(plugin, body),
      Paths: () => settingsPaths(plugin, body),
    })[state.tab]();
  };

  for (const name of tabs) {
    const chip = el(chips, "span",
      `lifeos-chip${name === state.tab ? " is-on" : ""}`, name);
    onTap(chip, () => {
      state.tab = name;
      chips.findAll(".lifeos-chip").forEach((c) => c.removeClass("is-on"));
      chip.addClass("is-on");
      draw();
    });
  }
  draw();
}

function settingsSetup(plugin, root, redraw) {
  const s = setSection(root, "Vault setup",
    "Creates the folders and starter notes Uptick reads. Safe to run again \u2014 "
    + "nothing that already exists is touched or overwritten.");

  const c = plugin.cfg.paths;
  const wanted = [
    ["Home note", P.home, true], ["Task inbox", P.taskInbox, true],
    ["Daily notes", c.daily, false], ["Weekly notes", c.weekly, false],
    ["Monthly notes", c.monthly, false], ["Capture inbox", c.inbox, false],
    ["Meetings", c.meetings, false], ["Tasks", c.tasks, false],
    ["Projects", c.projects, false], ["Areas", c.areas, false],
    ["Knowledge", c.knowledge, false], ["Sources", c.sources, false],
    ["Game folder", c.game, false], ["Automation", c.automation, false],
  ];
  const missing = wanted.filter(([, path]) => path && !plugin.app.vault.getAbstractFileByPath(path));

  const head = el(s, "div", "lifeos-setupstate");
  if (missing.length) {
    el(head, "div", "lifeos-setupstate-count is-missing", String(missing.length));
    el(head, "div", "lifeos-setupstate-label",
      missing.length === 1 ? "thing missing" : "things missing");
  } else {
    el(head, "div", "lifeos-setupstate-count is-ok", "\u2713");
    el(head, "div", "lifeos-setupstate-label", "everything is in place");
  }

  const list = el(s, "div", "lifeos-setuplist");
  for (const [label, path, isFile] of wanted) {
    if (!path) continue;
    const found = !!plugin.app.vault.getAbstractFileByPath(path);
    const row = el(list, "div", `lifeos-setuprow${found ? " is-ok" : " is-missing"}`);
    el(row, "span", "lifeos-setuprow-mark", found ? "\u2713" : "\u25CB");
    el(row, "span", "lifeos-setuprow-label", label);
    el(row, "span", "lifeos-setuprow-path", path + (isFile ? "" : "/"));
  }

  const actions = el(s, "div", "lifeos-setupactions");
  mkBtn(actions, missing.length ? `Create ${missing.length} missing` : "Run setup again",
    async () => {
      const made = await plugin.runSetup({ open: false });
      new Notice(made.folders.length || made.notes.length || made.icons
        ? `Created ${made.folders.length} folders, ${made.notes.length} notes`
          + (made.icons ? ` and ${made.icons} achievement icons` : "")
        : "Nothing to create");
      await redraw();
    }, missing.length ? "primary" : undefined);
  mkBtn(actions, "Open Home", () => plugin.open(P.home));
  mkBtn(actions, cfgGet(plugin.cfg, "tour.done", false) ? "Replay the walkthrough"
        : "Continue the walkthrough", () => plugin.openTour());

  settingsCompanions(plugin, root);

  const help = setSection(root, "Getting started",
    "Uptick reads Markdown you already have. Nothing is imported and nothing "
    + "leaves the vault.");
  const steps = el(help, "div", "lifeos-setupsteps");
  for (const [n, txt] of [
    ["1", "Run setup above, or point the Paths tab at folders you already use."],
    ["2", "Open Home. Empty cards are normal until there are notes for them."],
    ["3", "Turn off what you do not want under Modules and Layout."],
    ["4", "Run Recalculate when you want core XP, levels, and achievements to "
        + "catch up. Python is optional and only refreshes certification readiness."],
  ]) {
    const row = el(steps, "div", "lifeos-setupstep");
    el(row, "span", "lifeos-setupstep-n", n);
    el(row, "span", "lifeos-setupstep-text", txt);
  }
}

/* Obsidian plugins Uptick works alongside.
 *
 * None is required -- Uptick parses the Markdown itself, and every dashboard
 * renders without any of them. But several pages LINK to things these provide,
 * so a vault without them has working pages pointing at notes that were never
 * made, which reads as Uptick being broken rather than as a plugin being
 * absent. Naming them is the honest fix; installing them is not something a
 * plugin can do for you.
 */
const COMPANIONS = [
  { id: "obsidian-tasks-plugin", name: "Tasks",
    why: "Uptick reads and writes the Tasks date format \u2014 \u{1F4C5} due, "
       + "\u2705 done, \u2795 created. Without it those still work, they just "
       + "render as plain text and you lose the query blocks." },
  { id: "task-list-kanban", name: "Task List Kanban",
    why: "The board Uptick links to from the task pages. Without it that link "
       + "goes nowhere." },
  { id: "dataview", name: "Dataview",
    why: "Shows the [priority:: N] and [difficulty:: N] fields as properties "
       + "rather than raw text. Uptick reads them either way." },
  { id: "learnkit", name: "LearnKit",
    why: "Flashcards, quizzes and the spaced repetition Uptick's study pages "
       + "and exam readiness are built on." },
  { id: "periodic-notes", name: "Periodic Notes",
    why: "Creates daily, weekly and monthly notes on a schedule. Uptick can "
       + "make them itself, but this handles the calendar side." },
];

function settingsCompanions(plugin, root) {
  const s = setSection(root, "Works well with",
    "None of these is required \u2014 Uptick reads your Markdown directly and "
    + "every page renders without them. They are what some pages link to.");

  const installed = new Set(
    Object.keys(plugin.app?.plugins?.plugins || {}));
  const list = el(s, "div", "lifeos-companions");
  for (const c of COMPANIONS) {
    const have = installed.has(c.id);
    const row = el(list, "div", `lifeos-companion${have ? " is-on" : ""}`);
    const head = el(row, "div", "lifeos-companion-head");
    el(head, "span", "lifeos-companion-mark", have ? "\u2713" : "\u25CB");
    el(head, "span", "lifeos-companion-name", c.name);
    el(head, "span", "lifeos-companion-state", have ? "installed" : "not installed");
    el(row, "div", "lifeos-companion-why", c.why);
  }
  el(s, "div", "lifeos-setuphint-body",
    "Install any of them from Settings \u2192 Community plugins \u2192 Browse. "
    + "Uptick cannot install them for you, and does not need to.");
}

function settingsModules(plugin, root) {
  const s = setSection(root, "Modules",
    "Turn whole features off. A module that is off costs nothing to render and "
    + "hides its cards everywhere.");
  setToggle(plugin, s, "modules.game", "Experience and levels",
    "XP, streaks, decay, the Quest Log and Character pages.");
  setToggle(plugin, s, "modules.study", "Study",
    "LearnKit decks, exam readiness, and the practice exam pages.");
  setToggle(plugin, s, "modules.weather", "Weather",
    "The weather band on Home and the daily note.");
  setToggle(plugin, s, "modules.photos", "Photos",
    "The rotating photo card.");
  setToggle(plugin, s, "modules.email", "Email",
    "Imported mail panels.");
  setToggle(plugin, s, "modules.meetings", "Meetings",
    "Meeting records and recurring series.");
  setToggle(plugin, s, "modules.calendar", "Calendar",
    "Events read from the calendar cache.");

  const personal = setSection(root, "Personal integrations",
    "Off by default. These assume tooling that exists on the machine Uptick "
    + "was built on, not something the plugin provides.");
  setToggle(plugin, personal, "modules.sync", "Scheduled job control",
    "Adds a card that reports on and re-runs scheduled jobs. Requires a "
    + "desktop Obsidian and jobs you have set up yourself \u2014 it shells out to "
    + "run them, so leave it off unless that is what you want.");
  setToggle(plugin, personal, "modules.granola", "Meeting transcripts",
    "Renders a verbatim transcript alongside a meeting note, when one exists.");
  setText(plugin, personal, "granola.speakerName", "Your name in transcripts",
    "How your own turns are labelled.", "Me");
  setPath(plugin, personal, "transcripts", "Transcript folder", "");

  const net = setSection(root, "Network",
    "The shared Library reads a public registry only when you turn it on and "
    + "use it. Weather and optional AI companions have their own explicit "
    + "configuration; core dashboards stay local to your vault.");
  setToggle(plugin, net, "modules.library", "Library",
    "Reads a public index of shared decks and downloads the ones you pick. "
    + "Nothing is ever uploaded. Its settings are under Panels.");

  settingsAi(plugin, root);

  const a = setSection(root, "Achievements", "");
  setToggle(plugin, a, "achievements.enabled", "Track achievements", "");
  setToggle(plugin, a, "achievements.popup", "Celebrate unlocks",
    "Show the popup when something is unlocked. Turn off for a quieter system; "
    + "unlocks are still recorded.");
  for (const tier of ["Bronze", "Silver", "Gold", "Platinum", "Mythic"]) {
    setNumber(plugin, a, `achievements.tierXp.${tier}`, `${tier} reward`,
      "", { min: 0, max: 100000, step: 10 });
  }
}

/* Which model the AI features use, and where its key comes from.
 *
 * Three optional features use one: mail triage, the Granola meeting import,
 * and the Reminders workflow assistant. Everything
 * else in Uptick -- XP, levels, all 258 achievements, exam readiness -- is
 * arithmetic and works with none of this configured. */
function settingsAi(plugin, root) {
  const s = setSection(root, "AI",
    "Mail triage, the meeting import, and the Reminders workflow assistant send text to a model. Nothing else in "
    + "Uptick does. Bring whichever provider you already pay for.");

  setSelect(plugin, s, "ai.provider", "Provider",
    "Most of these speak the same API, so the list is easy to extend.",
    AI_PROVIDERS.map((p) => [p.id, p.label]));
  setText(plugin, s, "ai.model", "Model",
    "Leave blank to use the provider's default.", "");
  setText(plugin, s, "ai.baseUrl", "Base URL",
    "Only for a self-hosted or unlisted endpoint. Blank uses the provider's own.",
    "https://...");

  const note = el(s, "div", "lifeos-mailnote");
  el(note, "div", "lifeos-mailnote-title", "Your key is never stored in the vault");
  el(note, "div", "lifeos-mailnote-body",
    "This settings file lives in .obsidian/ and syncs wherever your vault syncs. "
    + "A key written here would be a key on every machine you sync to and in "
    + "every backup. Uptick reads it from an environment variable or a file "
    + "outside the vault instead, and never writes it anywhere.");

  setText(plugin, s, "ai.keyEnv", "Key from environment variable",
    "The name of the variable, not the key itself.", "ANTHROPIC_API_KEY");
  setText(plugin, s, "ai.keyFile", "or from a file",
    "An absolute path OUTSIDE the vault. A path inside is refused.",
    "~/.config/uptick/key");
  setText(plugin, s, "ai.codexBin", "Codex CLI path",
    "Only used by the Codex provider. Blank searches your PATH.",
    "/opt/homebrew/bin/codex");

  const help = el(s, "div", "lifeos-aihelp");
  el(help, "div", "lifeos-achdet-label", "Setting one up");
  const steps = el(help, "div", "lifeos-aisteps");
  for (const [what, how] of [
    ["Codex CLI", "npm i -g @openai/codex  ·  then  codex login"],
    ["Anthropic, OpenAI, Google, DeepSeek, Moonshot, Zhipu, Qwen, MiniMax",
     "create a key with the provider, then export it in your shell profile"],
    ["Ollama, LM Studio", "run it locally — no key needed"],
  ]) {
    const row = el(steps, "div", "lifeos-aistep");
    el(row, "div", "lifeos-aistep-what", what);
    el(row, "code", "lifeos-aistep-how", how);
  }
  el(help, "div", "lifeos-aistep-how",
    "Then check it with:  VAULT=\"<your vault>\" python3 optional/llm.py");
}

const AI_PROVIDERS = [
  ["codex", "Codex CLI (no key — uses your signed-in session)"],
  ["anthropic", "Anthropic — Claude"],
  ["openai", "OpenAI"],
  ["google", "Google — Gemini"],
  ["deepseek", "DeepSeek"],
  ["moonshot", "Moonshot — Kimi"],
  ["zhipu", "Zhipu — GLM"],
  ["qwen", "Alibaba — Qwen"],
  ["minimax", "MiniMax"],
  ["xai", "xAI — Grok"],
  ["mistral", "Mistral"],
  ["groq", "Groq"],
  ["together", "Together"],
  ["openrouter", "OpenRouter — any of the above"],
  ["ollama", "Ollama (local, no key)"],
  ["custom", "Custom — set the base URL yourself"],
].map(([id, label]) => ({ id, label }));

function settingsLayout(plugin, root) {
  const h = setSection(root, "Home page",
    "Which cards appear on the Home dashboard.");
  for (const [key, label] of [
    ["xp", "Experience header"], ["tiles", "Counters strip"],
    ["now", "Now and integration signals"],
    ["today", "Today at a glance"], ["calendar", "Calendar"],
    ["upcoming", "Upcoming"], ["capture", "Quick capture"],
    ["projects", "Active projects"], ["recurring", "Recurring series"],
    ["email", "Email"], ["notes", "Recent notes"], ["areas", "Areas of focus"],
    ["study", "Study"], ["sync", "Scheduled jobs"], ["reference", "Reference links"],
    ["web", "Web apps"],
  ]) setToggle(plugin, h, `home.${key}`, label, "");

  const d = setSection(root, "Daily page",
    "Which cards appear on a daily note.");
  for (const [key, label] of [
    ["xp", "Experience header"], ["weather", "Weather band"],
    ["tiles", "Counters strip"], ["plan", "Today Plan"], ["priorities", "What matters today"],
    ["photos", "Photo"], ["meetings", "Scheduled meetings"],
    ["tasks", "Tasks"], ["worklog", "Work log"], ["eod", "End of day"],
    ["experience", "Experience breakdown"], ["email", "Email"],
    ["reference", "Reference links"],
  ]) setToggle(plugin, d, `daily.${key}`, label, "");
}

function settingsPanels(plugin, root) {
  const ph = setSection(root, "Photos",
    "The rotating photo card. Point it at any folder of images in the vault.");
  setPath(plugin, ph, "photos", "Photo folder",
    "A vault folder holding image files.");
  setNumber(plugin, ph, "photos.intervalSeconds", "Seconds per photo",
    "How long each photo stays up before the next one.", { min: 2, max: 600 });
  setToggle(plugin, ph, "photos.shuffle", "Shuffle",
    "Off shows them in filename order.");
  setNumber(plugin, ph, "photos.max", "Photos to cycle",
    "How many of the most recent to rotate through.", { min: 1, max: 500 });

  const w = setSection(root, "Weather",
    "Read from a cache written by the weather job, so the dashboard never "
    + "waits on the network.");
  setText(plugin, w, "weather.apikey", "Visual Crossing API key",
    "Free tier, 1000 requests a day. Sent to Visual Crossing and nowhere else. "
    + "Unlike a model key this one lives in your settings file, because "
    + "Obsidian has no environment to read and this key is read-only, free and "
    + "rate-limited.", "");
  setText(plugin, w, "weather.location", "Location",
    "City name or latitude,longitude. Used by the fetch job.", "Austin, TX");
  setSelect(plugin, w, "weather.units", "Units", "",
    [["imperial", "Fahrenheit"], ["metric", "Celsius"]]);

  const wrow = setRow(w, "Forecast",
    "Fetches now and writes the cache the dashboards read. Run it whenever "
    + "you want; nothing fetches on its own.");
  mkBtn(wrow, "Fetch now", async () => {
    const r = await plugin.fetchWeather();
    new Notice(r.ok ? `Weather updated for ${r.location}`
                    : `Weather: ${r.error}`, r.ok ? 4000 : 8000);
  }, "primary");

  const lib = setSection(root, "Library",
    "Settings for the Library. The switch that turns it on is under Modules, "
    + "with the other modules.");
  setText(plugin, lib, "library.registry", "Registry URL",
    "The index to read. Point it at a fork to use your own.",
    "https://raw.githubusercontent.com/...");
  setText(plugin, lib, "library.folder", "Install decks into",
    "A folder under your knowledge path.", "Library");

  const st = setSection(root, "Study", "");
  setPath(plugin, st, "studyHub", "Study hub note",
    "Opened when LearnKit is not available.", true);
  setPath(plugin, st, "game", "Game folder",
    "Holds the Quest Log, Character, Achievements, Reward Bank and "
    + "certifications. Everything under it is derived from this one path.");
}

async function settingsMail(plugin, root, state) {
  /* Triage runs outside the plugin -- optional/mail-triage.py classifies mail
   * and records what it learned about each sender. This tab is the window onto
   * that: what it decided, and which senders it has stopped looking at.
   *
   * The muted list is the reason this screen exists. A filter that silently
   * stops showing you mail from someone is only safe if you can see who, and
   * undo it. */
  const s1 = setSection(root, "Email triage",
    "Classifies incoming mail as important, routine or spam, and imports only "
    + "the important ones. Senders whose mail is never important stop being "
    + "analysed at all, so less of your mail is sent anywhere over time.");
  setToggle(plugin, s1, "mail.triage", "Show triage results",
    "Turn on once mail-triage.py has run at least once.");
  setText(plugin, s1, "mail.ownerAddresses", "Your email addresses",
    "Comma separated. The classifier uses these to tell a request aimed at you "
    + "from one you were only copied on.", "you@work.com, you@home.com");

  const note = el(s1, "div", "lifeos-mailnote");
  el(note, "div", "lifeos-mailnote-title", "This step is not local");
  el(note, "div", "lifeos-mailnote-body",
    "Subject, sender and the first 1500 characters of each unclassified message "
    + "go to the classifier. Everything else in Uptick stays on this machine. "
    + "Muted senders are never sent at all.");

  const provider = cfgGet(plugin.cfg, "ai.provider", "codex");
  const model = cfgGet(plugin.cfg, "ai.model", "");
  const keyEnv = cfgGet(plugin.cfg, "ai.keyEnv", "");
  const keyFile = cfgGet(plugin.cfg, "ai.keyFile", "");
  const row = setRow(s1, "Classifier",
    "Change it under Modules \u2192 AI. Uptick cannot read your key from here, "
    + "so this reports what is configured, not whether it works \u2014 check "
    + "that with optional/llm.py.");
  el(row, "span", "lifeos-mailprov",
    `${provider}${model ? " \u00B7 " + model : ""}`
    + (provider === "codex" || provider === "ollama" ? " \u00B7 no key needed"
       : keyEnv ? ` \u00B7 key from $${keyEnv}`
       : keyFile ? " \u00B7 key from a file"
       : " \u00B7 no key source set"));

  const path = cfgGet(plugin.cfg, "mail.state", "4 System/Automation/mail-triage.json");
  let data = null;
  try {
    data = JSON.parse(await plugin.app.vault.adapter.read(path));
  } catch (e) { data = null; }
  if (state && state.tab !== "Mail") return;   // tab changed while reading

  if (!data) {
    const s2 = setSection(root, "Not run yet",
      "No triage state found at " + path + ".");
    el(s2, "div", "lifeos-setempty",
      "Run optional/mail-triage.py once and this tab will show what it decided "
      + "and which senders it has learned to skip.");
    return;
  }

  const stats = data.stats || {};
  const counts = stats.last_counts || {};
  const s2 = setSection(root, "Last run",
    stats.last_run ? String(stats.last_run).replace("T", " ").slice(0, 16) : "unknown");
  const grid = el(s2, "div", "lifeos-statgrid");
  const stat = (label, value, tone) => {
    const cell = el(grid, "div", "lifeos-statcell");
    el(cell, "div", `lifeos-statcell-value${tone ? " " + tone : ""}`, String(value ?? 0));
    el(cell, "div", "lifeos-statcell-label", label);
  };
  stat("important", counts.important, "is-good");
  stat("routine", counts.routine);
  stat("spam", counts.spam, "is-dim");
  stat("tasks proposed", stats.tasks_proposed, "is-good");
  stat("skipped unsent", stats.skipped_without_sending, "is-dim");
  stat("senders muted", stats.muted_senders, "is-dim");

  /* The counts above say what it decided. These say how much it could not see,
   * which is the difference between "your mail is calm" and "the run was
   * mostly blind". Apple Mail returns no body for a good share of Exchange
   * messages, and a triage that hides that is lying by omission. */
  const quality = [
    ["duplicates merged", stats.duplicates_merged,
     "near-identical tasks collapsed into one"],
    ["subject only", stats.no_body,
     "Mail returned no body, so these were judged from the subject line and "
     + "produced no tasks"],
    ["re-deliveries", stats.redeliveries,
     "the same message delivered twice, judged once"],
    ["unverified asks", stats.unverified_asks,
     "claimed a request but could not quote it, so treated as routine"],
  ].filter(([, v]) => v);
  if (quality.length) {
    const q = el(s2, "div", "lifeos-mailquality");
    for (const [label, value, why] of quality) {
      const row = el(q, "div", "lifeos-mailquality-row");
      el(row, "span", "lifeos-mailquality-n", String(value));
      const t = el(row, "div", "lifeos-mailquality-text");
      el(t, "div", "lifeos-mailquality-label", label);
      el(t, "div", "lifeos-mailquality-why", why);
    }
  }

  const senders = data.senders || {};
  const muted = Object.entries(senders)
    .filter(([, r]) => r && r.muted)
    .sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0));

  const s3 = setSection(root, `Muted senders (${muted.length})`,
    "Mail from these addresses is skipped without being read or sent anywhere. "
    + "Unmute one and its next message is classified normally again.");

  if (!muted.length) {
    el(s3, "div", "lifeos-setempty", "Nothing muted yet.");
  } else {
    const list = el(s3, "div", "lifeos-mutelist");
    for (const [addr, rec] of muted) {
      const row = el(list, "div", "lifeos-muterow");
      const left = el(row, "div", "lifeos-muterow-text");
      el(left, "div", "lifeos-muterow-addr", addr);
      el(left, "div", "lifeos-muterow-why",
        `${rec.verdict || "muted"}${rec.reason ? " \u00B7 " + rec.reason : ""}`
        + `${rec.seen ? " \u00B7 " + rec.seen + " seen" : ""}`
        + `${rec.source === "manual" ? " \u00B7 set by you" : ""}`);
      mkBtn(row, "Unmute", async () => {
        rec.muted = false;
        rec.streak = 0;
        rec.source = "manual";
        rec.verdict = "";
        await plugin.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
        new Notice(`${addr} will be classified again`);
        row.remove();
      });
    }
  }
}

async function settingsReminders(plugin, root, state) {
  const intro = setSection(root, "Apple Reminders",
    "Optional, desktop-only two-way sync. Your list names and reminder data stay on this machine.");
  setToggle(plugin, intro, "reminders.enabled", "Enable two-way sync",
    "Syncs the canonical task inbox with the configured Reminders lists.");

  const status = setRow(intro, "Connection", "The helper uses remindctl and requires Reminders permission.");
  const statusText = el(status, "span", "lifeos-mailprov", "Checking…");
  const issues = reminderConfigIssues(plugin.cfg);
  if (issues.length) el(intro, "div", "lifeos-setwarning", issues.join(" "));
  const result = await plugin.runReminderBridge(["--status"]);
  if (state && state.tab !== "Reminders") return;
  let payload = null;
  try { payload = JSON.parse(result.stdout || "{}"); } catch (e) { payload = null; }
  const error = payload?.error || result.stderr?.trim();
  statusText.setText(error ? `Unavailable · ${error.slice(0, 120)}` : "Connected");
  statusText.toggleClass("is-bad", !!error);
  statusText.toggleClass("is-good", !error);

  const lists = Array.isArray(payload?.lists) ? payload.lists : [];
  const available = lists.map((item) => String(item.name || item.title || item.listName || ""))
    .filter(Boolean);
  const listOptions = (current) => [...new Set([String(current || ""), ...available].filter(Boolean))]
    .map((name) => [name, name]);
  const setReminderList = (parent, path, label, help, fallback) => {
    const current = cfgGet(plugin.cfg, path, fallback);
    const options = listOptions(current);
    if (!options.length) return setText(plugin, parent, label, path, help, fallback);
    return setSelect(plugin, parent, path, label, help, options);
  };
  setReminderList(intro, "reminders.inboxList", "Inbox list",
    "New or uncertain tasks remain here until you classify them.", "Inbox");
  setReminderList(intro, "reminders.quickWinsList", "Quick Wins list",
    "Derived view: source reminders stay in their original list and appear here when tagged #10min or #10-minute, due today or overdue, and not in Waiting or Repeat.", "Quick Wins");
  setReminderList(intro, "reminders.waitingList", "Waiting list",
    "Blocked and dependency tasks are routed here.", "Waiting");
  el(intro, "div", "lifeos-setwarning", "Synced lists: Inbox, Quick Wins, Waiting, Work, Personal, and House. Repeat remains Apple-only and is never imported, edited, tagged, or deletion-scanned.");

  const intake = setSection(root, "Automatic intake cleanup", "New Inbox and Quick Wins reminders are cleaned locally. High-confidence routing is automatic; model rewording runs only when a configured provider passes preflight and agrees with local routing.");
  setToggle(plugin, intake, "reminders.autoIntake.enabled", "Enable automatic intake cleanup", "Never invents due dates, assignees, commitments, or recurrence.");
  setToggle(plugin, intake, "reminders.autoIntake.aiEnabled", "Use configured provider for high-confidence rewording", "Credentials stay outside the vault and LaunchAgent plist; unavailable providers fall back to deterministic cleanup.");

  const routes = setSection(root, "Category routes",
    "A category tag selects the Reminders list. Add your own routes for a different setup.");
  const routeList = el(routes, "div", "lifeos-reminder-routes");
  const drawRoutes = () => {
    routeList.empty();
    const current = Array.isArray(plugin.cfg.reminders?.routes) ? plugin.cfg.reminders.routes : [];
    current.forEach((route, index) => {
      const row = el(routeList, "div", "lifeos-reminder-route");
      const tag = row.createEl("input", { cls: "lifeos-setinput", type: "text" });
      tag.value = String(route.tag || ""); tag.placeholder = "#work";
      const list = row.createEl("select", { cls: "lifeos-setselect" });
      const options = listOptions(route.list);
      for (const [value, label] of options) {
        const option = list.createEl("option", { text: label });
        option.value = value;
      }
      list.value = String(route.list || "");
      const save = async () => {
        const next = (Array.isArray(plugin.cfg.reminders?.routes) ? plugin.cfg.reminders.routes : [])
          .map((item, i) => i === index ? { ...item, tag: tag.value.trim(), list: list.value.trim(), listId: "" } : item)
          .filter((item) => item.tag && item.list);
        await plugin.setCfg("reminders.routes", next); drawRoutes();
      };
      tag.addEventListener("change", save); list.addEventListener("change", save);
      mkBtn(row, "Remove", async () => {
        const next = (plugin.cfg.reminders.routes || []).filter((_, i) => i !== index);
        await plugin.setCfg("reminders.routes", next); drawRoutes();
      });
    });
    mkBtn(routes, "Add route", async () => {
      const next = [...(plugin.cfg.reminders?.routes || []), { tag: "#", list: "", listId: "" }];
      await plugin.setCfg("reminders.routes", next); drawRoutes();
    });
  };
  drawRoutes();

  const inference = setSection(root, "Automatic category detection",
    "Local-only high-confidence matching for untagged tasks. Explicit category tags always win; a tie stays in Inbox with needs-triage.");
  setToggle(plugin, inference, "reminders.categoryInference.enabled", "Categorize untagged tasks",
    "Uses the route-specific cues below. No task text is sent to an AI service.");
  setText(plugin, inference, "reminders.categoryInference.minMatches", "Minimum matching cues",
    "Require more than one cue for a stricter setup. Ties always remain in Inbox.", "1");
  const routeCues = plugin.cfg.reminders?.categoryInference?.cues || {};
  for (const route of (plugin.cfg.reminders?.routes || [])) {
    const tag = String(route?.tag || "").trim();
    if (!/^#[a-z0-9][a-z0-9-]*$/i.test(tag)) continue;
    setText(plugin, inference, `reminders.categoryInference.cues.${tag}`,
      `${tag} cues`, "Comma-separated words or phrases that are strong evidence for this category.",
      String(routeCues[tag] || routeCues[tag.toLowerCase()] || ""));
  }

  const tags = setSection(root, "Tags and metadata", "These names are written as Apple Reminders tags and read back into Obsidian.");
  for (const [key, label, help, placeholder] of [
    ["notStarted", "Not started tag", "Default active state.", "#not-started"],
    ["inProgress", "In progress tag", "Use when work moves into progress.", "#in-progress"],
    ["blocked", "Blocked tag", "Routes a task to Waiting.", "#blocked"],
    ["dependency", "Dependency tag", "Distinguishes dependency waiting.", "#dependency"],
    ["duration10", "10-minute tag", "Exactly one duration tag is emitted.", "#10min"],
    ["duration20", "20-minute tag", "Exactly one duration tag is emitted.", "#20min"],
    ["duration30", "30-minute tag", "Exactly one duration tag is emitted.", "#30min"],
    ["onPhone", "Phone tag", "Marks work that can be completed from a phone.", "#on-phone"],
    ["followUp", "Follow-up tag", "Marks a Waiting reminder with a follow-up date.", "#follow-up"],
  ]) setText(plugin, tags, `reminders.tags.${key}`, label, help, placeholder);
  setToggle(plugin, tags, "reminders.mail.enabled", "Add Apple Mail links",
    "Adds a local link that opens the original message in Mail.");
  setText(plugin, tags, "reminders.mail.shortcutName", "Mail Shortcut name",
    "The local Shortcut used by linked reminders.", "Open Obsidian Task Email");

  const actions = setSection(root, "Actions", "Run these manually while setting up or diagnosing the integration.");
  mkBtn(actions, "Use recommended setup", async () => {
    const sure = await prompt(plugin.app, { title: "Prepare the recommended lists?",
      help: "Existing exact-name lists are reused. Missing source lists are created; derived Quick Wins does not move or duplicate reminders.",
      placeholder: "SETUP", cta: "Create / reuse" });
    if (String(sure).trim().toUpperCase() !== "SETUP") return;
    const out = await plugin.runReminderBridge(["--setup-recommended"]);
    let data = null; try { data = JSON.parse(out.stdout || "{}"); } catch (e) { data = null; }
    if (!data?.ok) { new Notice(`Reminders setup failed: ${(data?.error || out.stderr || "unknown error").slice(0, 160)}`); return; }
    await plugin.setCfg("reminders.preset", "recommended");
    await plugin.setCfg("reminders.inboxList", "Inbox");
    await plugin.setCfg("reminders.quickWinsList", "Quick Wins");
    await plugin.setCfg("reminders.waitingList", "Waiting");
    new Notice(data.created?.length ? `Created ${data.created.join(", ")}` : "Recommended lists are ready");
  }, "primary");
  mkBtn(actions, "Test connection", async () => {
    const out = await plugin.runReminderBridge(["--status"]);
    new Notice(out.code === 0 ? "Apple Reminders is available" : (out.stderr || "Reminders unavailable").slice(0, 160));
  });
  mkBtn(actions, "Dry-run sync", async () => {
    const out = await plugin.runReminderBridge(["--sync", "--dry-run"]);
    new Notice((out.stdout || out.stderr || "No sync result").trim().slice(0, 180));
  });
  mkBtn(actions, "Sync now", async () => {
    if (!plugin.cfg.reminders.enabled) { new Notice("Enable two-way sync first"); return; }
    const out = await plugin.runReminderBridge(["--sync"]);
    new Notice((out.stdout || out.stderr || "No sync result").trim().slice(0, 180));
  }, "primary");

  const nativeTags = setSection(root, "Native Apple Reminders tags",
    "The bridge syncs the portable task fields. This optional Shortcut runs after "
    + "a successful bridge to apply native Apple Reminders tags, so tags are "
    + "available in Apple's own tag filters and smart lists.");
  el(nativeTags, "div", "lifeos-setwarning",
    "Install the Shortcut once in macOS, then run the public source installer to "
    + "schedule bridge → tags every ten minutes. The scheduler runs while Obsidian is closed.");
  const nativeActions = el(nativeTags, "div", "lifeos-setactions");
  mkBtn(nativeActions, "Install the tag Shortcut",
    () => window.open(NATIVE_TAG_SHORTCUT_URL, "_blank"), "primary");
  mkBtn(nativeActions, "Open installation guide",
    () => window.open("https://github.com/jcranokc/obsidian-uptick-public#native-apple-reminders-tags", "_blank"));

  const assistant = setSection(root, "Workflow assistant",
    "Review uncertain routing, Waiting follow-ups, history, and weekly decisions.");
  setToggle(plugin, assistant, "workflowAssistant.enabled", "Enable workflow assistant",
    "Keeps its queue, history, and activity in the private Reminders state file.");
  setToggle(plugin, assistant, "workflowAssistant.triage.enabled", "Triage learning queue",
    "Suggestions require approval and use the existing AI provider when requested.");
  setToggle(plugin, assistant, "workflowAssistant.triage.cloud", "Allow cloud suggestions",
    "Uses the configured Uptick provider or Codex subscription; task fields are disclosed before sending.");
  setToggle(plugin, assistant, "workflowAssistant.waiting.enabled", "Waiting follow-up dates",
    "Waiting uses the existing reminder due date for the next follow-up and pauses XP decay.");
  setText(plugin, assistant, "workflowAssistant.waiting.followUpTag", "Follow-up tag",
    "Applied to Waiting reminders with a follow-up date.", "#follow-up");
  setNumber(plugin, assistant, "workflowAssistant.waiting.defaultDays", "Default follow-up days",
    "Used when a Waiting task has no explicit follow-up date.", { min: 1, max: 365 });
  setToggle(plugin, assistant, "workflowAssistant.email.enabled", "Email task capture",
    "Creates an approved parent reminder with native subtasks.");
  const messages = setSection(assistant, "iMessage task capture",
    "Scans new incoming Messages locally and creates actionable tasks in the canonical Task Inbox. The next Reminders sync projects them to lists.");
  setToggle(plugin, messages, "messagesTaskCapture.enabled", "Enable automatic iMessage task capture",
    "Runs with the existing 10-minute sync wrapper. Ordinary conversation and system messages are filtered out.");
  setToggle(plugin, messages, "messagesTaskCapture.autoCreate", "Create detected tasks automatically",
    "Detected actionable messages are written without an approval step, as configured for this workflow.");
  setToggle(plugin, messages, "messagesTaskCapture.modelEnabled", "Allow configured model classification",
    "Local rules run first. A configured model may improve category, priority, duration, and phone classification.");
  setText(plugin, messages, "messagesTaskCapture.excludedChats", "Excluded chats",
    "Comma-separated chat identifiers that should never create tasks.", "group-or-chat-id");
  setText(plugin, messages, "messagesTaskCapture.excludedSenders", "Excluded senders",
    "Comma-separated phone numbers or addresses that should never create tasks.", "+15551234567");
  const messageActions = el(messages, "div", "lifeos-inline-actions");
  mkBtn(messageActions, "Check iMessage capture", async () => {
    const out = await plugin.runMessageTaskCapture(["--status"]);
    new Notice((out.stdout || out.stderr || "No iMessage capture status").trim().slice(0, 180));
  });
  mkBtn(messageActions, "Preview new messages", async () => {
    const out = await plugin.runMessageTaskCapture(["--scan", "--dry-run"]);
    new Notice((out.stdout || out.stderr || "No iMessage preview").trim().slice(0, 180));
  });
  const completion = setSection(assistant, "Sent email completion",
    "Optionally closes one uniquely linked task when a sent Apple Mail message explicitly says the work is complete. Ambiguous matches go to review.");
  setToggle(plugin, completion, "workflowAssistant.emailCompletion.enabled", "Enable sent email completion",
    "Opt-in and local-first. It runs with the existing 10-minute Reminders sync.");
  setToggle(plugin, completion, "workflowAssistant.emailCompletion.scanSentMail", "Scan Sent Mail",
    "Reads only new Sent messages after a private cursor; it never sends or modifies email.");
  setToggle(plugin, completion, "workflowAssistant.emailCompletion.autoCompleteUnique", "Auto-complete one clear match",
    "Only one uniquely linked open task can be completed automatically.");
  setNumber(plugin, completion, "workflowAssistant.emailCompletion.lookbackHours", "Initial lookback hours",
    "Used when no private scan cursor exists.", { min: 1, max: 720 });
  setNumber(plugin, completion, "workflowAssistant.emailCompletion.maxMessagesPerRun", "Maximum messages per run",
    "Limits background work per sync.", { min: 1, max: 500 });
  setText(plugin, completion, "workflowAssistant.emailCompletion.explicitPhrases", "Completion phrases",
    "Comma-separated positive phrases such as completed, done, or resolved.", "completed, done, finished");
  setText(plugin, completion, "workflowAssistant.emailCompletion.negativePhrases", "Excluded phrases",
    "Comma-separated phrases such as not done, still working, or will complete.", "not done, still working, not yet");
  const completionActions = el(completion, "div", "lifeos-inline-actions");
  mkBtn(completionActions, "Review queue", () => plugin.openWorkflowView("email-completions", "Email Completion Review"));
  mkBtn(completionActions, "Scan now", async () => {
    const out = await plugin.runEmailCompletionScript(["--scan"]);
    new Notice((out.stdout || out.stderr || "No sent-email result").trim().slice(0, 180));
  });
  setToggle(plugin, assistant, "workflowAssistant.weeklyReview.enabled", "Weekly review assistant",
    "Shows guided recommendations and writes only approved outcomes.");
  el(assistant, "div", "lifeos-mailnote-body",
    "Cloud triage uses the existing AI settings under Modules → AI. API keys, Reminder IDs, Mail locators, and activity data never enter public GitHub files.");
  const workflowActions = el(assistant, "div", "lifeos-inline-actions");
  mkBtn(workflowActions, "Triage queue", () => plugin.openWorkflowView("triage", "Triage Queue"));
  mkBtn(workflowActions, "Waiting dashboard", () => plugin.openWorkflowView("waiting-dashboard", "Waiting Dashboard"));
  mkBtn(workflowActions, "Sync activity", () => plugin.openWorkflowView("sync-activity", "Sync Activity"));
  mkBtn(workflowActions, "Weekly review", () => plugin.openWorkflowView("weekly-workflow-review", "Weekly Workflow Review"));
  mkBtn(workflowActions, "Email completions", () => plugin.openWorkflowView("email-completions", "Email Completion Review"));
}

function settingsExperience(plugin, root) {
  const b = setSection(root, "Task rewards",
    "What a completed task is worth, by difficulty. These are read by the XP "
    + "engine as well as shown here, so a change here changes what you earn.");
  for (const [d, name] of [[1, "Trivial"], [2, "Small"], [3, "Standard"],
                           [4, "Hard"], [5, "Epic"]]) {
    setNumber(plugin, b, `game.baseXp.${d}`, `D${d} \u00B7 ${name}`, "",
      { min: 0, max: 10000, step: 5 });
  }

  const m = setSection(root, "Multipliers", "");
  setNumber(plugin, m, "game.earlyMultiplier", "Finished early",
    "Applied when a task is completed before its due date.",
    { min: 1, max: 3, step: 0.05 });
  setNumber(plugin, m, "game.lateMultiplier", "Finished late",
    "Late work still pays \u2014 finishing is always better than not.",
    { min: 0, max: 1, step: 0.05 });
  setNumber(plugin, m, "game.priorityBonus", "Critical or urgent",
    "Applied to priority 1 and 2 tasks.", { min: 1, max: 3, step: 0.05 });
  setNumber(plugin, m, "game.streakStep", "Streak bonus per day",
    "0.02 is +2% per consecutive day.", { min: 0, max: 0.2, step: 0.01 });
  setNumber(plugin, m, "game.streakCap", "Streak bonus cap",
    "1.3 caps the bonus at +30%.", { min: 1, max: 3, step: 0.05 });
  setNumber(plugin, m, "game.freezesPerMonth", "Streak freezes per month",
    "A freeze bridges one missed day without breaking the run. Set to 0 for a "
    + "strict streak \u2014 but a missed sick day is the usual reason people quit.",
    { min: 0, max: 10 });

  const dc = setSection(root, "Overdue decay",
    "What an overdue task costs per day, and the guards that stop it becoming "
    + "a punishment machine.");
  setNumber(plugin, dc, "game.decayRate", "Daily rate",
    "0.10 charges 10% of the task's base XP, escalating each day overdue.",
    { min: 0, max: 1, step: 0.01 });
  setNumber(plugin, dc, "game.decayGraceDays", "Grace days",
    "Days overdue before anything is charged.", { min: 0, max: 14 });
  setNumber(plugin, dc, "game.globalDecayFraction", "Daily cap",
    "Total decay in a day, as a fraction of your trailing 7-day earn rate. "
    + "A bad week cannot erase a good month.", { min: 0.05, max: 2, step: 0.05 });
  setNumber(plugin, dc, "game.maxCatchupDays", "Catch-up limit",
    "Most days the sync runs on schedule. When it has not, this bounds how "
    + "much backlog one run can charge.", { min: 1, max: 60 });

  const r = setSection(root, "Rituals",
    "Deliberately small. If filling in a log entry pays like shipping a "
    + "deployment, the log becomes the game.");
  for (const [key, label] of [
    ["intentionsEarly", "What matters today, before 10:00"],
    ["intentions", "What matters today"],
    ["worklog", "Each work log entry"],
    ["eod", "End of day review"],
    ["agenda", "Meeting agenda written in advance"],
    ["weekly", "Weekly review"],
    ["monthly", "Monthly review"],
    ["triaged", "Task inbox fully triaged"],
  ]) setNumber(plugin, r, `game.ritualXp.${key}`, label, "", { min: 0, max: 5000, step: 5 });

  const s = setSection(root, "Study rewards", "");
  for (const [key, label] of [["easy", "Card graded Easy"], ["good", "Card graded Good"],
                              ["hard", "Card graded Hard"], ["again", "Card graded Again"]]) {
    setNumber(plugin, s, `game.cardXp.${key}`, label,
      key === "again"
        ? "Kept above zero on purpose: the moment honesty costs points, you start "
          + "lying to your own flashcards."
        : "", { min: 0, max: 100 });
  }
  setNumber(plugin, s, "game.noteReviewXp", "Note review", "", { min: 0, max: 500 });
  setNumber(plugin, s, "game.sessionBonusXp", "Session bonus", "", { min: 0, max: 500 });
  setNumber(plugin, s, "game.cardXpDailyCap", "Daily card XP cap",
    "Stops grinding a deck out-earning a day of real work.", { min: 0, max: 10000, step: 25 });
}

function settingsRewards(plugin, root) {
  const b = setSection(root, "Reward Bank",
    "XP converted into a figure you have earned the right to spend. Nothing "
    + "here moves money \u2014 it is a scoreboard and a permission slip.");
  setToggle(plugin, b, "bank.enabled", "Enable the Reward Bank", "");
  setText(plugin, b, "bank.currency", "Currency symbol", "", "$");
  setNumber(plugin, b, "bank.rate", "XP per unit of currency",
    "250 means 250 XP banks 1.00.", { min: 1, max: 100000, step: 25 });
  setNumber(plugin, b, "bank.levelBonus", "Level-up bonus",
    "Multiplied by the level reached.", { min: 0, max: 1000, step: 0.5 });
  setNumber(plugin, b, "bank.monthlyCeiling", "Monthly ceiling",
    "A hard cap per calendar month. Without one, a heavy month is an "
    + "unbudgeted expense, and that is how the system stops being honoured.",
    { min: 0, max: 100000, step: 5 });

  const g = setSection(root, "Goals",
    "Goals themselves live in the Reward Bank note, because they are something "
    + "you write. They fill in order, one at a time.");
  const open = el(g, "div", "lifeos-setnote");
  el(open, "div", null,
    "Add a product and a price to the Goals table, and the bank fills toward it.");
  mkBtn(open, "Open Reward Bank", () => plugin.open(P.bank), "primary");
}

function settingsPaths(plugin, root) {
  const s = setSection(root, "Vault paths",
    "Where Uptick looks for things. These are the settings to change first in "
    + "a vault that is not laid out like the one this was built in.");
  const rows = [
    ["home", "Home note", true], ["daily", "Daily notes", false],
    ["weekly", "Weekly notes", false], ["monthly", "Monthly notes", false],
    ["inbox", "Capture inbox", false], ["meetings", "Meetings", false],
    ["recurring", "Recurring series", false], ["tasks", "Tasks folder", false],
    ["taskInbox", "Task inbox note", true], ["kanban", "Kanban board", true],
    ["projects", "Projects", false], ["areas", "Areas", false],
    ["knowledge", "Knowledge", false], ["sources", "Sources", false],
    ["contacts", "Contacts", false], ["emails", "Email references", false],
    ["game", "Game folder", false], ["automation", "Automation folder", false],
    ["logs", "Logs", false], ["photos", "Photos", false],
  ];
  for (const [key, label, isFile] of rows) setPath(plugin, s, key, label, "", isFile);
}

/* ----------------------------------------------------------- reward bank */

async function renderBank(plugin, root, cfg, ctx, redraw) {
  const q = await plugin.game.quest();
  const b = q?.bank;

  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: "Reward Bank" }]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Reward Bank");
  el(ht, "div", "lifeos-sub",
    "XP you have converted into money you have earned the right to spend.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Quest Log", () => plugin.open(P.quest));
  mkBtn(nav, "Add goal", () => addGoal(plugin, redraw), "primary");
  mkBtn(nav, "Record a spend", () => recordSpend(plugin, b, redraw));

  if (!b) {
    el(root, "div", "lifeos-empty", "No cache yet. Run the XP sync, then reopen.");
    return;
  }

  /* The balance, stated once and large. Everything else on the page explains
   * or spends it. */
  const hero = el(root, "div", "lifeos-bankhero");
  const amount = el(hero, "div", "lifeos-bankhero-main");
  el(amount, "div", "lifeos-bankhero-amount", `$${b.available.toFixed(2)}`);
  el(amount, "div", "lifeos-bankhero-label", "AVAILABLE TO SPEND");
  const side = el(hero, "div", "lifeos-bankhero-side");
  bankStat(side, "Lifetime", `$${Number(b.total ?? 0).toFixed(2)}`);
  bankStat(side, "Spent", `$${Number(b.spent ?? 0).toFixed(2)}`);
  bankStat(side, "This month",
    `$${Number(b.this_month ?? 0).toFixed(2)}`, `of $${Number(b.ceiling ?? 100).toFixed(0)}`);
  const monthPct = Number(b.ceiling) ? Number(b.this_month ?? 0) / Number(b.ceiling) : 0;
  progressBar(hero, monthPct, "lifeos-bar-sm");

  const grid = el(root, "div", "lifeos-grid");

  /* goals */
  const goals = b.goals ?? [];
  const gc = card(grid, "Goals", "\u25CE", "span2");
  if (!goals.length) {
    const none = el(gc, "div", "lifeos-empty");
    el(none, "div", null,
      "No goal set. The bank does nothing until there is something worth "
      + "working toward.");
    mkBtn(none, "Add your first goal", () => addGoal(plugin, redraw), "primary");
  } else {
    for (const g of goals) {
      const row = el(gc, "div", `lifeos-goal is-${g.status.toLowerCase()}`);
      const gh = el(row, "div", "lifeos-goal-head");
      el(gh, "span", "lifeos-goal-name", g.name);
      el(gh, "span", "lifeos-goal-price",
        `$${g.banked.toFixed(2)} / $${g.price.toFixed(2)}`);
      progressBar(row, g.progress, "lifeos-bar-lg");
      /* Editing a goal in the note means finding a Markdown table behind a
       * hidden body. Editing it here is the same write, without the hunt. */
      onTap(gh, () => editGoal(plugin, g, redraw));
      gh.setAttribute("title", "Edit or remove this goal");
      const gf = el(row, "div", "lifeos-goal-foot");
      el(gf, "span", `lifeos-goal-status is-${g.status.toLowerCase()}`, g.status);
      if (g.status === "Complete") {
        el(gf, "span", "lifeos-goal-eta", "Go and buy it.");
      } else if (g.eta_days) {
        el(gf, "span", "lifeos-goal-eta",
          `$${g.remaining.toFixed(2)} to go \u00B7 about ${g.eta_days} days at your current rate`);
      } else {
        el(gf, "span", "lifeos-goal-eta",
          `$${g.remaining.toFixed(2)} to go \u00B7 ${
            (b.active_days ?? 0) < 7
              ? `needs ${7 - (b.active_days ?? 0)}d more data for an estimate`
              : "no estimate yet"}`);
      }
    }
    el(gc, "div", "lifeos-goal-note",
      "Goals fill in order, one at a time, with the overflow rolling to the next. "
      + "Split across several and they all crawl. Click a goal to edit it.");
  }

  /* how the money is earned */
  const rc = card(grid, "Conversion", "\u25D1", "col3");
  statRow(rc, "Rate", `${b.rate ?? 250} XP = $1.00`);
  statRow(rc, "Level bonus", `$${Number(b.level_bonus ?? 2).toFixed(2)} \u00D7 level`);
  statRow(rc, "Monthly cap", `$${Number(b.ceiling ?? 100).toFixed(2)}`);
  if (b.daily > 0.005) statRow(rc, "Earning", `$${b.daily.toFixed(2)} / day`);
  el(rc, "div", "lifeos-bank-note",
    "Banking runs on net daily XP, floored at zero. A bad day banks nothing, and "
    + "the balance never goes backwards.");

  /* spend history */
  const lc = card(grid, "History", "\u25A4", "col3");
  const rows = (b.ledger ?? []).slice().reverse();
  if (!rows.length) {
    el(lc, "div", "lifeos-empty",
      "Nothing spent yet. Add a row with a negative amount when you buy something.");
  } else {
    for (const r of rows.slice(0, 12)) {
      const row = el(lc, "div", "lifeos-spend");
      el(row, "span", "lifeos-spend-date", r.date);
      el(row, "span", "lifeos-spend-reason", r.reason);
      el(row, "span", `lifeos-spend-amt${r.change < 0 ? " is-neg" : ""}`,
        `${r.change < 0 ? "\u2212" : "+"}$${Math.abs(r.change).toFixed(2)}`);
    }
  }
}

function bankStat(parent, label, value, sub) {
  const box = el(parent, "div", "lifeos-bankstat");
  el(box, "div", "lifeos-microlabel", label.toUpperCase());
  el(box, "div", "lifeos-bankstat-value", value);
  if (sub) el(box, "div", "lifeos-bankstat-sub", sub);
  return box;
}


/* ---- goal editing -------------------------------------------------------
 *
 * The Reward Bank note keeps the Goals and Ledger tables as the record, but its
 * body is hidden by `lifeos-owns-body`, so there is no way to reach them by
 * hand from this page. These three write the rows directly. */

function bankFile(plugin) {
  const f = plugin.app.vault.getAbstractFileByPath(P.bank);
  return f instanceof TFile ? f : null;
}

/* Rewrite the rows of one Markdown table, found by its header. */
async function editBankTable(plugin, heading, mutate) {
  const file = bankFile(plugin);
  if (!file) {
    new Notice("Reward Bank note not found");
    return false;
  }
  let ok = false;
  await plugin.app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const head = lines.findIndex((l) =>
      new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l.trim()));
    if (head < 0) return data;
    let a = head + 1;
    while (a < lines.length && !lines[a].trim().startsWith("|")) a++;
    if (a >= lines.length) return data;
    let b = a;
    while (b < lines.length && lines[b].trim().startsWith("|")) b++;
    const header = lines.slice(a, Math.min(a + 2, b));   // header + separator
    const rows = lines.slice(a + 2, b);
    const next = mutate(rows);
    if (next === null) return data;
    ok = true;
    return [...lines.slice(0, a), ...header, ...next, ...lines.slice(b)].join("\n");
  });
  return ok;
}

function moneyOf(raw) {
  const m = String(raw ?? "").match(/([\d,.]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : NaN;
}

async function addGoal(plugin, redraw) {
  const res = await form(plugin.app, {
    title: "Add a goal",
    help: "Something you already want and currently feel vaguely guilty about "
        + "buying. Spending banked money is what removes the guilt.",
    fields: [
      { key: "name", label: "What is it", placeholder: "Codex subscription" },
      { key: "price", label: "Price", placeholder: "100" },
    ],
    cta: "Add",
  });
  if (!res || !String(res.name || "").trim()) return;
  const price = moneyOf(res.price);
  if (!Number.isFinite(price) || price <= 0) return new Notice("Price must be a number");
  const sym = cfgGet(plugin.cfg, "bank.currency", "$");

  const ok = await editBankTable(plugin, "Goals", (rows) => {
    const filled = rows.filter((r) => {
      const c = r.split("|").map((x) => x.trim());
      return c[2] && !c[2].startsWith("*");
    });
    const n = filled.length + 1;
    filled.push(`| ${n} | ${res.name.trim()} | ${sym}${price.toFixed(2)} | ${sym}0.00 | 0% | — | Queued |`);
    return filled;
  });
  if (!ok) return new Notice("Could not find the Goals table");
  new Notice(`Added "${res.name.trim()}". Run the XP sync to fill it.`);
  await redraw();
}

async function editGoal(plugin, goal, redraw) {
  const sym = cfgGet(plugin.cfg, "bank.currency", "$");
  const res = await form(plugin.app, {
    title: `Edit "${goal.name}"`,
    help: "Leave the name empty to remove this goal.",
    fields: [
      { key: "name", label: "What is it", value: goal.name },
      { key: "price", label: "Price", value: String(goal.price) },
    ],
    cta: "Save",
  });
  if (!res) return;
  const name = String(res.name || "").trim();
  const price = moneyOf(res.price);

  const ok = await editBankTable(plugin, "Goals", (rows) => {
    const out = [];
    let n = 0;
    for (const r of rows) {
      const c = r.split("|").map((x) => x.trim());
      const isThis = c[2] === goal.name;
      if (isThis && !name) continue;                 // removed
      if (!c[2] || c[2].startsWith("*")) continue;   // drop placeholder rows
      n++;
      if (isThis) {
        const p = Number.isFinite(price) && price > 0 ? price : goal.price;
        out.push(`| ${n} | ${name} | ${sym}${p.toFixed(2)} | ${c[4] ?? sym + "0.00"} | ${c[5] ?? "0%"} | ${c[6] ?? "—"} | ${c[7] ?? "Queued"} |`);
      } else {
        out.push(`| ${n} |` + r.split("|").slice(2).join("|"));
      }
    }
    return out;
  });
  if (!ok) return new Notice("Could not find the Goals table");
  new Notice(name ? `Updated "${name}"` : `Removed "${goal.name}"`);
  await redraw();
}

async function recordSpend(plugin, bank, redraw) {
  const sym = cfgGet(plugin.cfg, "bank.currency", "$");
  const res = await form(plugin.app, {
    title: "Record a spend",
    help: `${sym}${Number(bank?.available ?? 0).toFixed(2)} available. This only `
        + "writes it down — no money moves.",
    fields: [
      { key: "amount", label: "Amount", placeholder: "25" },
      { key: "reason", label: "What for", placeholder: "A book" },
    ],
    cta: "Record",
  });
  if (!res) return;
  const amount = moneyOf(res.amount);
  if (!Number.isFinite(amount) || amount <= 0) return new Notice("Amount must be a number");
  const reason = String(res.reason || "").trim() || "Spent";
  const when = moment().format("YYYY-MM-DD");

  const ok = await editBankTable(plugin, "Ledger", (rows) => {
    const keep = rows.filter((r) => {
      const c = r.split("|").map((x) => x.trim());
      return c[1] && !c[1].startsWith("*");
    });
    keep.push(`| ${when} | -${sym}${amount.toFixed(2)} | ${reason} | |`);
    return keep;
  });
  if (!ok) return new Notice("Could not find the Ledger table");
  new Notice(`Recorded ${sym}${amount.toFixed(2)}. Run the XP sync to update the balance.`);
  await redraw();
}

/* --------------------------------------------------------- practice exams */

async function renderExams(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  const here = app.vault.getAbstractFileByPath(ctx.sourcePath);
  const folder = ctx.sourcePath.replace(/\/[^/]+$/, "");
  const q = await plugin.game.quest();

  /* Papers are read from their own frontmatter rather than a cache, so a
   * regenerated set shows up without waiting for the next sync. */
  const papers = app.vault.getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder + "/") && f.path !== ctx.sourcePath)
    .map((f) => ({ f, fm: app.metadataCache.getFileCache(f)?.frontmatter ?? {} }))
    .filter((x) => String(x.fm.type ?? "") === "practice-exam")
    .sort((a, b) => (Number(a.fm.exam_number) || 0) - (Number(b.fm.exam_number) || 0));

  const certName = here && app.metadataCache.getFileCache(here)?.frontmatter?.certification;
  const cert = (q?.certifications ?? []).find((c) => !certName || c.name.includes("Advanced")
    || c.name === certName) ?? (q?.certifications ?? [])[0];
  const log = cert?.attempts_log ?? [];
  const passMark = Number(papers[0]?.fm.pass_mark) || cert?.pass_mark || 65;

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Practice Exams" },
  ]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Practice Exams");
  el(ht, "div", "lifeos-sub",
    papers.length
      ? `${papers.length} papers \u00B7 every question used exactly once, so they can be sat in any order`
      : "No papers found in this folder.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Quest Log", () => plugin.open(P.quest));
  if (cert) mkBtn(nav, "Certification", () => plugin.open(cert.path ?? P.quest));

  if (!papers.length) {
    el(root, "div", "lifeos-empty",
      "Build them with 4 System/Automation/build-practice-exams.py --write");
    return;
  }

  /* attempts keyed by the paper's test id */
  const byTest = {};
  for (const a of log) (byTest[a.test_id] ??= []).push(a);

  const sat = papers.filter((x) => (byTest[x.fm.test_id] ?? []).length).length;
  const scores = log.map((a) => a.score);
  const best = scores.length ? Math.max(...scores) : null;
  const full = log.filter((a) => a.questions >= 40).length;

  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Papers", papers.length, `${papers.length * (Number(papers[0].fm.questions) || 60)} questions`, "\u25A3");
  tile(strip, "Sat", `${sat}`, `of ${papers.length}`, "\u2713");
  tile(strip, "Best score", best === null ? "\u2014" : `${Math.round(best)}%`,
    `pass at ${Math.round(passMark)}%`, "\u2726");
  tile(strip, "Toward the gate", `${Math.min(3, full)} / 3`,
    "full attempts logged", "\u25CE");

  /* The gate is the thing people miss: cards alone cannot lift readiness past
   * 60, and nothing on this page says so unless it is said here. */
  if (full < 3) {
    const note = el(root, "div", "lifeos-gate");
    el(note, "span", "lifeos-gate-glyph", "\u25D4");
    const body = el(note, "div", "lifeos-gate-body");
    el(body, "div", "lifeos-gate-title",
      `${3 - full} more full attempt${3 - full === 1 ? "" : "s"} to clear the readiness gate`);
    el(body, "div", "lifeos-gate-text",
      "Flashcards alone cap readiness at 60. Three logged attempts of 40+ questions lift the ceiling to 80, and two of them within the last 30 days lift it off 60.");
    progressBar(body, Math.min(1, full / 3), "lifeos-bar-sm");
    onTap(note, () => plugin.open(P.quest));
  }

  const grid = el(root, "div", "lifeos-grid");

  for (const { f, fm } of papers) {
    const attempts = (byTest[fm.test_id] ?? []).slice().sort((a, b) => a.days_ago - b.days_ago);
    const c = card(grid, `Exam ${fm.exam_number ?? "?"}`, "\u25A3", "col3");

    const top = el(c, "div", "lifeos-exam-top");
    if (attempts.length) {
      const latest = attempts[0];
      const passed = latest.score >= passMark;
      el(top, "div", `lifeos-exam-score ${passed ? "is-pass" : "is-fail"}`,
        `${Math.round(latest.score)}%`);
      el(top, "div", "lifeos-exam-verdict", passed ? "Pass" : "Below pass");
    } else {
      el(top, "div", "lifeos-exam-score is-unsat", "\u2014");
      el(top, "div", "lifeos-exam-verdict", "Not sat");
    }

    const meta = el(c, "div", "lifeos-exam-meta");
    el(meta, "span", null,
      `${fm.questions ?? 60} questions \u00B7 ${fm.time_limit_minutes ?? 105} min`);
    el(meta, "code", "lifeos-exam-id", String(fm.test_id ?? ""));

    if (attempts.length) {
      progressBar(c, Math.min(1, attempts[0].score / 100));
      for (const a of attempts) {
        const r = el(c, "div", "lifeos-attempt");
        el(r, "span", "lifeos-attempt-date", a.date);
        el(r, "span", "lifeos-attempt-raw", `${Math.round(a.score)}%`);
        el(r, "span", "lifeos-attempt-adj", `adj ${Math.round(a.adjusted)}%`);
        if (a.prior) el(r, "span", "lifeos-attempt-retake", `retake \u00D7${a.prior}`);
      }
    } else {
      el(c, "div", "lifeos-empty", "Not attempted yet.");
    }

    const acts = el(c, "div", "lifeos-exam-actions");
    mkBtn(acts, attempts.length ? "Re-sit" : "Open paper", () => plugin.open(f.path),
      attempts.length ? undefined : "primary");
    mkBtn(acts, "Log a score", () => logAttempt(plugin, cert, fm, redraw));
  }
}

/* Writing the attempt row by hand is the step most likely to be skipped, and a
 * score that never gets logged does not exist as far as readiness is concerned.
 * This appends the row in the exact shape the model parses. */
async function logAttempt(plugin, cert, fm, redraw) {
  if (!cert?.path) return new Notice("No certification note found to log against");
  const file = plugin.app.vault.getAbstractFileByPath(cert.path);
  if (!(file instanceof TFile)) return new Notice("Certification note not found");

  const raw = await prompt(plugin.app, {
    title: `Log a score for exam ${fm.exam_number}`,
    help: `Out of ${fm.questions ?? 60} questions. Enter the percentage, or the raw number correct.`,
    placeholder: "72",
    cta: "Log",
  });
  if (!raw) return;
  let n = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return new Notice("Not a number");
  const total = Number(fm.questions) || 60;
  /* "39" out of 60 is a raw count, not 39%. Anything at or below the question
   * count is read as a count unless it is also a plausible percentage. */
  if (n <= total && n <= 100 && String(raw).indexOf("%") === -1 && n <= total) {
    n = Math.round((n / total) * 1000) / 10;
  }
  const pct = Math.max(0, Math.min(100, n));

  const today = moment().format("YYYY-MM-DD");
  const prior = (cert.attempts_log ?? []).filter((a) => a.test_id === fm.test_id).length;
  const row = `| ${today} | K2 bank | ${fm.test_id} | ${total} | ${pct} | ${prior} | |`;

  await plugin.app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const head = lines.findIndex((l) => /^\|\s*Date\s*\|\s*Source\s*\|\s*Test ID/i.test(l));
    if (head < 0) return data;
    let at = head + 2;                       // header, then the separator row
    while (at < lines.length && lines[at].trim().startsWith("|")) at++;
    lines.splice(at, 0, row);
    return lines.join("\n");
  });
  new Notice(`Logged ${pct}% for ${fm.test_id}. Run the XP sync to update readiness.`);
  await redraw();
}

/* ------------------------------------------------------------- xp ledger */

const LEDGER_KINDS = [
  ["task", "Tasks", "\u2611"],
  ["study", "Study", "\u25AD"],
  ["ritual", "Rituals", "\u25CB"],
  ["milestone", "Milestones", "\u2726"],
  ["achievement", "Achievements", "\u25C6"],
  ["decay", "Decay", "\u25BC"],
];

async function renderLedger(plugin, root, cfg, ctx, redraw) {
  const rows = await plugin.game.ledger();
  const cat = await plugin.game.achievements();

  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: "XP Ledger" }]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "XP Ledger");
  el(ht, "div", "lifeos-sub",
    "Every XP event, newest first. Append-only \u2014 an edit here rewrites your history.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Quest Log", () => plugin.open(P.quest));
  mkBtn(nav, "Character", () => plugin.open(P.character));

  if (!rows.length) {
    el(root, "div", "lifeos-empty", "Nothing recorded yet.");
    return;
  }

  const earned = rows.filter((r) => r.xp > 0).reduce((a, r) => a + r.xp, 0);
  const lost = rows.filter((r) => r.xp < 0).reduce((a, r) => a + r.xp, 0);
  const byDay = {};
  for (const r of rows) byDay[r.date] = (byDay[r.date] ?? 0) + r.xp;
  const days = Object.keys(byDay).sort();
  const best = days.reduce((a, d) => (byDay[d] > (byDay[a] ?? -Infinity) ? d : a), days[0]);

  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Net XP", fmtSigned(earned + lost), `${rows.length} events`, "\u25CE");
  tile(strip, "Earned", `+${earned.toLocaleString()}`, "all time", "\u25B2");
  tile(strip, "Lost", lost ? lost.toLocaleString() : "0", "overdue decay", "\u25BC");
  tile(strip, "Best day", fmtSigned(byDay[best] ?? 0), best ?? "\u2014", "\u2726");

  /* Filters mirror the achievement browser's, so the two pages behave alike. */
  const filters = el(root, "div", "lifeos-achfilters");
  const search = filters.createEl("input", { cls: "lifeos-achsearch", type: "text" });
  search.placeholder = "Filter by detail\u2026";
  const chips = el(filters, "div", "lifeos-achchips");

  const state = { kind: "all", q: "", limit: 120 };
  const listHost = el(root, "div", "lifeos-ledger");

  const draw = () => {
    listHost.empty();
    const q = state.q.trim().toLowerCase();
    const shown = rows.filter((r) =>
      (state.kind === "all" || r.kind === state.kind) &&
      (!q || r.detail.toLowerCase().includes(q)));

    if (!shown.length) {
      el(listHost, "div", "lifeos-empty", "Nothing matches that filter.");
      return;
    }

    /* Newest first: a ledger is read from the top, not scrolled to the end. */
    const grouped = {};
    for (const r of shown) (grouped[r.date] ??= []).push(r);
    const dates = Object.keys(grouped).sort().reverse();

    let drawn = 0;
    for (const date of dates) {
      if (drawn >= state.limit) break;
      const dayRows = grouped[date];
      const net = dayRows.reduce((a, r) => a + r.xp, 0);
      const sec = el(listHost, "div", "lifeos-ledgerday");
      const sh = el(sec, "div", "lifeos-ledgerday-head");
      el(sh, "span", "lifeos-ledgerday-date", date);
      el(sh, "span", "lifeos-ledgerday-count",
        `${dayRows.length} event${dayRows.length === 1 ? "" : "s"}`);
      el(sh, "span", `lifeos-ledgerday-net${net < 0 ? " is-neg" : ""}`, fmtSigned(net));

      for (const r of dayRows) {
        if (drawn >= state.limit) break;
        drawn++;
        const row = el(sec, "div", `lifeos-ledgerrow lifeos-kind-${r.kind}`);
        const glyph = (LEDGER_KINDS.find((k) => k[0] === r.kind) ?? [, , "\u25CB"])[2];
        el(row, "span", "lifeos-ledgerrow-glyph", glyph);
        const body = el(row, "div", "lifeos-ledgerrow-body");
        el(body, "div", "lifeos-ledgerrow-detail", r.detail);
        el(body, "div", "lifeos-ledgerrow-kind", r.kind);
        el(row, "span", `lifeos-ledgerrow-xp${r.xp < 0 ? " is-neg" : ""}`, fmtSigned(r.xp));
        /* Achievement rows open their celebration; everything else is a record. */
        if (r.kind === "achievement" && cat) {
          row.addClass("is-clickable");
          onTap(row, () => plugin.showAchievement(r.id.replace(/^ach:/, ""), true));
        }
      }
    }

    if (shown.length > drawn) {
      const more = el(listHost, "div", "lifeos-ledgermore");
      mkBtn(more, `Show ${Math.min(200, shown.length - drawn)} more of ${shown.length - drawn}`,
        () => { state.limit += 200; draw(); });
    }
  };

  for (const [key, label] of [["all", "All"], ...LEDGER_KINDS.map((k) => [k[0], k[1]])]) {
    const n = key === "all" ? rows.length : rows.filter((r) => r.kind === key).length;
    if (key !== "all" && !n) continue;          // no empty filters
    const chip = el(chips, "span", `lifeos-chip ${key === "all" ? "is-on" : ""}`.trim(),
      `${label} ${n}`);
    onTap(chip, () => {
      state.kind = key;
      state.limit = 120;
      chips.findAll(".lifeos-chip").forEach((c) => c.removeClass("is-on"));
      chip.addClass("is-on");
      draw();
    });
  }
  search.addEventListener("input", () => { state.q = search.value; state.limit = 120; draw(); });
  draw();
}

/* ------------------------------------------------------------- quest log */

async function renderQuest(plugin, root, cfg, ctx, redraw) {
  const q = await plugin.game.quest();
  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: "Quest Log" }]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Quest Log");
  el(ht, "div", "lifeos-sub", "Readiness, what is bleeding XP, and what it is buying.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Character", () => plugin.open(P.character));
  mkBtn(nav, "Achievements", () => plugin.open(P.achievements));
  mkBtn(nav, "Reward Bank", () => plugin.open(P.bank));

  if (!q) {
    el(root, "div", "lifeos-empty", "No quest cache yet. Run the XP sync, then reopen.");
    return;
  }

  await xpHero(plugin, root);

  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Open tasks", q.tasks.open, `${q.tasks.blocked} blocked`, "\u2611",
    () => plugin.openOrCreate(P.kanban, kanbanScaffold, "the Kanban board"), "Open the Kanban board");
  tile(strip, "Overdue", q.tasks.overdue,
    q.tasks.overdue ? "losing XP daily" : "nothing overdue", "\u25D4");
  tile(strip, "Banked", `$${Number(q.bank.total ?? 0).toFixed(2)}`,
    `$${Number(q.bank.this_month ?? 0).toFixed(2)} this month`, "\u25C8",
    () => plugin.open(P.bank));
  tile(strip, "This week", fmtSigned(q.totals.week), "XP", "\u25CE");

  const grid = el(root, "div", "lifeos-grid");

  /* readiness, one card per certification */
  for (const c of q.certifications ?? []) {
    const card_ = card(grid, c.name, "\u25CE", "span3");
    const band = el(card_, "div", "lifeos-ready");
    const bh = el(band, "div", "lifeos-ready-head");
    el(bh, "span", "lifeos-ready-score", `${Math.round(c.score)}%`);
    el(bh, "span", `lifeos-ready-band ${bandClass(c.score)}`, c.band);
    const meta = c.exam_date ? `${c.days_left} days away` : "no exam date set";
    el(bh, "span", "lifeos-ready-meta",
      `${meta} \u00B7 pass ${Math.round(c.pass_mark)}% \u00B7 ${c.cards} cards \u00B7 ${c.attempts} attempts`);
    progressBar(band, c.score / 100, "lifeos-bar-lg");

    const comps = el(card_, "div", "lifeos-comps");
    for (const [label, key] of [["Coverage", "coverage"], ["Mastery", "mastery"],
                                ["Performance", "performance"], ["Consistency", "consistency"]]) {
      const box = el(comps, "div", "lifeos-comp");
      const ch = el(box, "div", "lifeos-comp-head");
      el(ch, "span", "lifeos-comp-name", label);
      el(ch, "span", "lifeos-comp-pct", `${Math.round((c[key] ?? 0) * 100)}%`);
      progressBar(box, c[key] ?? 0, "lifeos-bar-sm");
    }

    if (c.blockers?.length) {
      el(card_, "div", "lifeos-microlabel lifeos-blockhead", "WHAT IS HOLDING IT BACK");
      for (const b of c.blockers) {
        const r = el(card_, "div", `lifeos-blocker${b.binding ? " is-binding" : ""}`);
        el(r, "span", "lifeos-blocker-dot", b.binding ? "\u25C6" : "\u25C7");
        el(r, "span", "lifeos-blocker-text", b.reason);
        if (b.binding) el(r, "span", "lifeos-blocker-cap", `caps at ${Math.round(b.ceiling)}`);
      }
    } else {
      el(card_, "div", "lifeos-ready-clear", "Nothing is holding it back. Book the exam.");
    }
    if (c.domains?.length) {
      el(card_, "div", "lifeos-microlabel lifeos-blockhead", "WEAKEST DOMAINS");
      for (const d of c.domains.slice(0, 4)) {
        const r = el(card_, "div", "lifeos-domrow");
        el(r, "span", "lifeos-domrow-name", d.name);
        progressBar(r, d.mastery, "lifeos-bar-sm");
        el(r, "span", "lifeos-domrow-pct", `${Math.round(d.mastery * 100)}%`);
      }
    }
  }

  /* what is costing XP right now */
  const bleed = card(grid, "Bleeding XP", "\u25BC", "span2");
  if (!q.bleeding?.length) {
    el(bleed, "div", "lifeos-empty", "Nothing overdue. Nothing is costing you.");
  } else {
    for (const b of q.bleeding) {
      const r = el(bleed, "div", "lifeos-bleed");
      el(r, "span", `lifeos-diff lifeos-diff-${b.difficulty}`).setText(`D${b.difficulty}`);
      const body = el(r, "div", "lifeos-bleed-body");
      el(body, "div", "lifeos-bleed-text", b.text);
      el(body, "div", "lifeos-bleed-meta", `due ${b.due} \u00B7 ${b.days} days over`);
      el(r, "span", "lifeos-bleed-cost", `\u2212${b.cost}`);
    }
    onTap(bleed, () => plugin.openOrCreate(P.kanban, kanbanScaffold, "the Kanban board"));
  }

  /* the bank and its active goal */
  const bank = card(grid, "Reward Bank", "\u25C8", "col3");
  const bb = el(bank, "div", "lifeos-bankhead");
  el(bb, "div", "lifeos-bank-amount", `$${Number(q.bank.total ?? 0).toFixed(2)}`);
  el(bb, "div", "lifeos-bank-sub",
    `$${Number(q.bank.this_month ?? 0).toFixed(2)} of $100 this month`);
  el(bank, "div", "lifeos-bank-note",
    "Goals and spending live in the Reward Bank note.");
  mkBtn(bank, "Open Reward Bank", () => plugin.open(P.bank));

  /* recent unlocks */
  const rec = card(grid, "Recently unlocked", "\u25C6", "col3");
  if (!q.recent?.length) {
    el(rec, "div", "lifeos-empty", "Nothing unlocked yet.");
  } else {
    for (const a of [...q.recent].reverse()) {
      const row = el(rec, "div", "lifeos-dayach");
      const badge = el(row, "div", "lifeos-dayach-badge");
      const art = plugin.game.artFor(a.slug);
      if (art) {
        const img = badge.createEl("img", { cls: "lifeos-dayach-img" });
        img.src = art;
      } else {
        el(badge, "span", null, "\u25C6");
      }
      const txt = el(row, "div", "lifeos-dayach-text");
      el(txt, "div", "lifeos-dayach-name", a.detail.replace(/\s*\([^)]*\)\s*$/, ""));
      el(txt, "div", "lifeos-dayach-cond", `${a.date} \u00B7 +${a.xp} XP`);
      onTap(row, () => plugin.showAchievement(a.slug, true));
    }
  }
}

/* "…/Platform Administrator II/Practice Exams/Practice Exams.md" -> the
 * certification folder name, which is what distinguishes one set from another. */
function certOf(path) {
  const parts = String(path).split("/");
  return parts[parts.length - 3] ?? path;
}

function fmtSigned(n) {
  const v = Number(n) || 0;
  return v >= 0 ? `+${v.toLocaleString()}` : v.toLocaleString();
}

function bandClass(score) {
  if (score >= 90) return "is-ready";
  if (score >= 80) return "is-close";
  if (score >= 65) return "is-testing";
  if (score >= 40) return "is-studying";
  return "is-learning";
}

/* -------------------------------------------------------------- character */

async function renderCharacter(plugin, root, cfg, ctx, redraw) {
  const q = await plugin.game.quest();
  renderHeader(plugin, root, [{ label: "Uptick", path: P.home }, { label: "Character" }]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Character");
  el(ht, "div", "lifeos-sub",
    "Derived from the XP Ledger on every sync. Safe to delete \u2014 it rebuilds.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Quest Log", () => plugin.open(P.quest));
  mkBtn(nav, "Achievements", () => plugin.open(P.achievements));
  mkBtn(nav, "XP Ledger", () => plugin.open(P.ledger));

  if (!q) {
    el(root, "div", "lifeos-empty", "No cache yet. Run the XP sync, then reopen.");
    return;
  }
  const c = q.character;

  await xpHero(plugin, root);

  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Today", fmtSigned(c.today), "XP", "\u25CB");
  tile(strip, "This week", fmtSigned(q.totals.week), "XP", "\u25CE");
  tile(strip, "This month", fmtSigned(q.totals.month), "XP", "\u25CD");
  tile(strip, "Achievements", `${c.achievements}`, `of ${c.achievements_auto} tracked`,
    "\u25C6", () => plugin.open(P.achievements));

  const grid = el(root, "div", "lifeos-grid");

  /* thirty days of net XP, so the page shows a shape and not just a number */
  const trend = card(grid, "Last 30 days", "\u25E9", "span2");
  sparkline(trend, q.trail ?? []);

  const src = card(grid, "Where the XP came from", "\u25D1", "col3");
  const max = Math.max(1, ...(q.sources ?? []).map((s) => Math.abs(s.xp)));
  for (const s of q.sources ?? []) {
    const r = el(src, "div", "lifeos-srcrow");
    const rh = el(r, "div", "lifeos-srcrow-head");
    el(rh, "span", "lifeos-srcrow-name", s.label);
    el(rh, "span", `lifeos-srcrow-xp${s.xp < 0 ? " is-neg" : ""}`, fmtSigned(s.xp));
    const track = el(r, "div", "lifeos-bar lifeos-bar-sm");
    const fill = el(track, "div", `lifeos-bar-fill${s.xp < 0 ? " is-neg" : ""}`);
    fill.style.width = `${(Math.abs(s.xp) / max) * 100}%`;
  }
  const tot = el(src, "div", "lifeos-srctotal");
  el(tot, "span", null, "Total");
  el(tot, "span", `lifeos-srcrow-xp${(q.totals.all ?? 0) < 0 ? " is-neg" : ""}`,
    fmtSigned(q.totals.all));

  const st = card(grid, "Streak", "\u25D5", "col3");
  statRow(st, "Current", `${c.streak} day${c.streak === 1 ? "" : "s"}`);
  statRow(st, "Longest", `${c.longest}`);
  statRow(st, "XP multiplier", `\u00D7${Number(c.streak_bonus).toFixed(2)}`);
  statRow(st, "Freezes left", `${c.freezes_left} of ${c.freezes_total}`);

  /* ranks, with the current one called out */
  const ranks = card(grid, "Ranks", "\u2726", "span2");
  const list = q.ranks ?? [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const nextFloor = list[i + 1]?.floor;
    const span = nextFloor ? `${r.floor}\u2013${nextFloor - 1}` : `${r.floor}+`;
    const here = r.name === c.rank;
    const row = el(ranks, "div", `lifeos-rankrow${here ? " is-here" : ""}`);
    el(row, "span", "lifeos-rankrow-span", span);
    el(row, "span", "lifeos-rankrow-name", r.name);
    if (here) el(row, "span", "lifeos-rankrow-you", "you are here");
  }
}

/* A bar-per-day strip of net XP. Negative days hang below the baseline, which
 * is the whole point — a month with three red days reads differently from a
 * month with none. */
function sparkline(parent, trail) {
  const max = Math.max(1, ...trail.map((d) => Math.abs(d.xp)));
  const wrap = el(parent, "div", "lifeos-spark");
  for (const d of trail) {
    const col = el(wrap, "div", "lifeos-spark-col");
    col.setAttribute("title", `${d.date}: ${fmtSigned(d.xp)} XP`);
    const up = el(col, "div", "lifeos-spark-up");
    const down = el(col, "div", "lifeos-spark-down");
    if (d.xp >= 0) up.style.height = `${(d.xp / max) * 100}%`;
    else down.style.height = `${(Math.abs(d.xp) / max) * 100}%`;
  }
  const legend = el(parent, "div", "lifeos-spark-legend");
  el(legend, "span", null, trail[0]?.date ?? "");
  el(legend, "span", null, trail[trail.length - 1]?.date ?? "");
}

/* --------------------------------------------------------- achievements UI */

async function renderAchievements(plugin, root, cfg, ctx, redraw) {
  const cat = await plugin.game.achievements();
  const c = plugin.game.character();

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Achievements" },
  ]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Achievements");
  el(ht, "div", "lifeos-sub",
    cat ? `${cat.unlocked} unlocked of ${cat.total} \u00B7 ${cat.auto_total} tracked automatically`
        : "Waiting for the first sync.");
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "Quest Log", () => plugin.open(P.quest));
  mkBtn(nav, "Character", () => plugin.open(P.character));

  if (!cat) {
    const empty = el(root, "div", "lifeos-empty");
    el(empty, "div", null,
      "Nothing has been worked out yet. Recalculate reads your tasks and notes "
      + "and fills this page in.");
    mkBtn(empty, "Recalculate", async () => {
      await plugin.recalculate();
      await redraw();
    }, "primary");
    return;
  }

  /* The icons are a separate download because they are 78MB -- too much to
   * carry in a plugin that is otherwise 450KB. Without this the page just
   * looks unfinished and gives no clue that art exists at all. */
  if (!plugin.game.hasArt()) {
    const hint = el(root, "div", "lifeos-artnote");
    el(hint, "div", "lifeos-artnote-title", "No artwork installed");
    el(hint, "div", "lifeos-artnote-body",
      "Icons ship with Uptick and are written into your vault by Setup. If "
      + "this is showing, either Setup has not run since you installed, or "
      + `art-bundle.json is missing from the plugin folder. Run Setup again `
      + `\u2014 it only adds what is not there. The tier medallions below are a `
      + "normal state, not a missing file.");
    mkBtn(hint, "Run setup", async () => {
      const made = await plugin.runSetup({ open: false });
      new Notice(made.icons ? `Wrote ${made.icons} icons` : "No icons to write");
      await redraw();
    });
  }

  const rows = cat.achievements;
  const unlocked = rows.filter((a) => a.unlocked);
  const inProgress = rows.filter((a) => !a.unlocked && !a.manual && a.progress > 0);
  const manual = rows.filter((a) => !a.unlocked && a.manual);

  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Unlocked", unlocked.length, `of ${rows.length}`, "\u25C6");
  tile(strip, "In progress", inProgress.length, "partly earned", "\u25D0");
  tile(strip, "Tracked", cat.auto_total, "auto-evaluated", "\u25CE");
  tile(strip, "By hand", manual.length, "tick when earned", "\u25CB");

  /* Overall completion, so the page opens with one honest number. */
  const doneBox = el(root, "div", "lifeos-achtotal");
  const dh = el(doneBox, "div", "lifeos-achtotal-head");
  el(dh, "span", "lifeos-achtotal-label", "Collection");
  el(dh, "span", "lifeos-achtotal-pct",
    `${Math.round((unlocked.length / Math.max(1, rows.length)) * 100)}%`);
  progressBar(doneBox, unlocked.length / Math.max(1, rows.length), "lifeos-bar-lg");

  /* Closest first — the useful ordering for deciding what to go and do. */
  if (inProgress.length) {
    const nearCard = card(el(root, "div", "lifeos-grid lifeos-grid-1"),
      "Closest to unlocking", "\u25D0", "span3");
    for (const a of inProgress.sort((x, y) => y.progress - x.progress).slice(0, 8)) {
      achRow(plugin, nearCard, a, true);
    }
  }

  const filters = el(root, "div", "lifeos-achfilters");
  const state = { tier: "all", show: "all", q: "" };
  const search = filters.createEl("input", { cls: "lifeos-achsearch", type: "text" });
  search.placeholder = "Filter by name or condition\u2026";

  const chips = el(filters, "div", "lifeos-achchips");
  const listHost = el(root, "div", "lifeos-achlist");

  const draw = () => {
    listHost.empty();
    const q = state.q.trim().toLowerCase();
    const byCat = {};
    for (const a of rows) {
      if (state.tier !== "all" && a.tier !== state.tier) continue;
      if (state.show === "unlocked" && !a.unlocked) continue;
      if (state.show === "progress" && (a.unlocked || a.manual || !a.progress)) continue;
      if (state.show === "locked" && a.unlocked) continue;
      if (q && !(`${a.name} ${a.condition}`.toLowerCase().includes(q))) continue;
      (byCat[a.category] ??= []).push(a);
    }
    const names = Object.keys(byCat);
    if (!names.length) {
      el(listHost, "div", "lifeos-empty", "Nothing matches that filter.");
      return;
    }
    for (const name of names) {
      const list = byCat[name];
      const got = list.filter((a) => a.unlocked).length;
      const sec = el(listHost, "div", "lifeos-achsection");
      const sh = el(sec, "div", "lifeos-achsection-head");
      el(sh, "span", "lifeos-achsection-name", name);
      el(sh, "span", "lifeos-achsection-count", `${got} / ${list.length}`);
      progressBar(sh, got / list.length, "lifeos-bar-sm");
      const gridEl = el(sec, "div", "lifeos-achgrid");
      for (const a of list) achCard(plugin, gridEl, a);
    }
  };

  for (const [key, label] of [["all", "All"], ["progress", "In progress"],
                              ["unlocked", "Unlocked"], ["locked", "Locked"]]) {
    const chip = el(chips, "span", `lifeos-chip ${key === "all" ? "is-on" : ""}`.trim(), label);
    onTap(chip, () => {
      state.show = key;
      chips.findAll(".lifeos-chip").forEach((n) => n.removeClass("is-on"));
      chip.addClass("is-on");
      draw();
    });
  }
  const tierChips = el(filters, "div", "lifeos-achchips");
  for (const tier of ["all", ...TIER_ORDER]) {
    const chip = el(tierChips, "span",
      `lifeos-chip lifeos-chip-tier ${tier === "all" ? "is-on" : ""}`.trim(),
      tier === "all" ? "Any tier" : tier);
    onTap(chip, () => {
      state.tier = tier;
      tierChips.findAll(".lifeos-chip").forEach((n) => n.removeClass("is-on"));
      chip.addClass("is-on");
      draw();
    });
  }
  search.addEventListener("input", () => { state.q = search.value; draw(); });
  draw();
}

/* A compact tile in the browser grid. */
function achCard(plugin, parent, a) {
  const box = el(parent, "div",
    `lifeos-achcard lifeos-tier-${(a.tier || "").toLowerCase()}` +
    (a.unlocked ? " is-unlocked" : a.manual ? " is-manual" : " is-locked"));

  const badge = el(box, "div", "lifeos-achcard-badge");
  const art = plugin.game.artFor(a.slug);
  if (art) {
    const img = badge.createEl("img", { cls: "lifeos-achcard-img" });
    img.src = art;
    img.alt = "";
  } else {
    el(badge, "span", "lifeos-achcard-glyph", TIER_GLYPH[a.tier] ?? "\u25C6");
  }
  const body = el(box, "div", "lifeos-achcard-body");
  el(body, "div", "lifeos-achcard-name", a.name);
  el(body, "div", "lifeos-achcard-cond", a.condition || "");
  const foot = el(body, "div", "lifeos-achcard-foot");
  if (a.unlocked) {
    el(foot, "span", "lifeos-achcard-date", `\u2713 ${a.unlocked}`);
  } else if (a.manual) {
    el(foot, "span", "lifeos-achcard-manual", "by hand");
  } else {
    el(foot, "span", "lifeos-achcard-prog", `${fmtNum(a.have)} / ${fmtNum(a.need)}`);
    progressBar(foot, a.progress, "lifeos-bar-sm");
  }
  el(box, "div", "lifeos-achcard-tier", a.tier);
  onTap(box, () => openAchievement(plugin, a));
  return box;
}

/* What a tile opens.
 *
 * The celebration is for something you earned -- it says ACHIEVEMENT UNLOCKED
 * over a burst of rays, which is nonsense on a tile you are 3 of 10 towards.
 * Locked ones open the detail instead: what it is, how it is earned, and how
 * far along you are.
 */
function openAchievement(plugin, a) {
  if (a.unlocked) return plugin.showAchievement(a.slug, true);
  new AchievementDetail(plugin.app, plugin, a).open();
}

/* A single row in the "closest" card. */
function achRow(plugin, parent, a, showBar) {
  const row = el(parent, "div", "lifeos-achrow");
  el(row, "span", "lifeos-achrow-glyph", TIER_GLYPH[a.tier] ?? "\u25C6");
  const body = el(row, "div", "lifeos-achrow-body");
  const head = el(body, "div", "lifeos-achrow-head");
  el(head, "span", "lifeos-achrow-name", a.name);
  el(head, "span", "lifeos-achrow-count", `${fmtNum(a.have)} / ${fmtNum(a.need)}`);
  if (showBar) progressBar(body, a.progress);
  el(body, "div", "lifeos-achrow-cond", a.condition || "");
  onTap(row, () => openAchievement(plugin, a));
  return row;
}

/* --------------------------------------------------------------- scaffold */

function homeScaffold() {
  return [
    "---",
    "title: Uptick",
    "type: dashboard",
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "# Uptick",
    "",
    "```life-os",
    "view: home",
    "```",
    "",
    "*The dashboard is rendered above. This note only carries the view — its",
    "content comes from your daily notes, tasks and meetings.*",
    "",
  ].join("\n");
}

/* The Kanban board.
 *
 * Task List Kanban reads a plain note and groups the vault's tasks by tag, so
 * this works as an ordinary note without the plugin and becomes a board with
 * it. Uptick does not own the task data either way -- the Task Inbox does. */
/* The full weather page the Home and Today bands link to. */
function weatherPageScaffold() {
  return [
    "---",
    "title: Weather",
    "type: dashboard",
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "# Weather",
    "",
    "```life-os",
    "view: weather",
    "```",
    "",
    "*Rendered from a cache written by `optional/weather-fetch.py`. Uptick never",
    "fetches this itself, so no dashboard talks to the network. Set your",
    "location under Settings \u2192 Panels.*",
    "",
  ].join("\n");
}

/* Where the study pages point when LearnKit is not installed. */
function studyHubScaffold() {
  return [
    "---",
    "title: LearnKit Study Hub",
    "type: dashboard",
    "cssclasses:",
    "  - life-os",
    "---",
    "",
    "# Study Hub",
    "",
    "Uptick's study pages and exam readiness are built on **LearnKit** \u2014 a",
    "separate community plugin that holds the cards and does the spaced",
    "repetition. Install it from Settings \u2192 Community plugins \u2192 Browse,",
    "and this page becomes its home.",
    "",
    "Without it, everything else in Uptick still works. Only the study and",
    "readiness pages need it.",
    "",
  ].join("\n");
}

function kanbanScaffold() {
  return [
    "---",
    "kanban-plugin: board",
    "cssclasses:",
    "  - life-os",
    "---",
    "",
    "# Task List Kanban",
    "",
    "A board over the tasks in [[" + P.taskInbox.replace(/\.md$/, "") + "]].",
    "",
    "Install the **Task List Kanban** community plugin to see it as columns.",
    "Without it this stays a normal note and nothing is lost \u2014 the tasks",
    "themselves live in the Task Inbox, not here.",
    "",
    "| Column | Tag |",
    "|---|---|",
    "| Not Started | `#not-started` |",
    "| In Progress | `#in-progress` |",
    "| Blocked / Dependency | `#blocked` or `#dependency` |",
    "| Done | a checked box, or `#done` |",
    "",
  ].join("\n");
}

function taskInboxScaffold() {
  return [
    "---",
    "created: " + moment().format("YYYY-MM-DD"),
    "purpose: canonical-task-records",
    'status_model: "#not-started=Not Started; #in-progress=In Progress; #blocked/#dependency=Blocked; checked=Done"',
    "cssclasses:",
    "  - life-os",
    "---",
    "",
    "# Task Inbox",
    "",
    "Every task lives here as a Markdown checkbox tagged `#task`. Uptick reads",
    "and writes this one file; the board and the dashboards are views over it.",
    "",
    "A task looks like this:",
    "",
    "- [ ] An example task \u{1F4C5} " + moment().format("YYYY-MM-DD") + " #task",
    "",
  ].join("\n");
}

function libraryScaffold() {
  return [
    "---", "title: Library", "type: dashboard",
    "cssclasses:", "  - life-os", "  - max", "---", "",
    "# Library", "", "```life-os", "view: library", "```", "",
    "*Shared decks and practice exams. Each lives in its author's own",
    "repository — this is an index, not a store.*", "",
  ].join("\n");
}

/* The achievement catalog, generated from the engine's own list.
 *
 * The condition wording is read back out of this note, so the note has to
 * exist before anything can explain how an achievement is earned. Setup did
 * not create it, which is why a fresh vault opened the Achievements page to
 * 258 tiles that all said "No condition recorded for this one yet" -- and why
 * the walkthrough's link to it landed on "Not found".
 *
 * Hand-editable: the Unlocked column is where you award the ones the engine
 * cannot see. */
/* Write the shipped achievement icons into the vault.
 *
 * They live in the vault rather than the plugin so artFor finds them with no
 * special case and you can replace any of them by hand. The bundle sits beside
 * main.js as one more file to download, which is the whole point: artwork used
 * to be a separate 78MB archive that a new install had no way to know about,
 * and the page looked unfinished until someone found it.
 *
 * A free function rather than a method so it can be driven without a plugin
 * instance. Never overwrites -- your own icon always wins.
 */
async function installArt(plugin) {
  let bundle;
  try {
    const raw = await plugin.app.vault.adapter.read(
      `${plugin.manifest.dir}/art-bundle.json`);
    bundle = JSON.parse(raw);
  } catch (e) {
    return 0;   // no bundle shipped, or unreadable: art stays optional
  }
  const icons = bundle && bundle.icons;
  if (!icons) return 0;

  const ext = bundle.ext || "png";
  let written = 0;
  for (const [slug, b64] of Object.entries(icons)) {
    const path = `${P.achArt}/${slug}.${ext}`;
    if (plugin.app.vault.getAbstractFileByPath(path)) continue;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await plugin.app.vault.adapter.writeBinary(path, bytes.buffer);
      written += 1;
    } catch (e) { /* one bad icon should not stop the rest */ }
  }
  return written;
}

function achievementsScaffold() {
  const rows = Engine.CATALOG.map(([slug, name, tier, category, pred, condition], i) =>
    `| ${i + 1} | **${name}** | ${tier} | ${condition || conditionFor(pred)} `
    + `| ${"\u2591".repeat(6)} 0% | \u2014 |`);
  return [
    "---",
    "title: Achievements",
    "type: reference",
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "# Achievements",
    "",
    "```life-os",
    "view: achievements",
    "```",
    "",
    "The catalog. **Condition** is the wording Uptick shows when you click a",
    "tile, so edit it here and the app follows. **Unlocked** is written by the",
    "engine for the ones it can see, and by you for the ones it cannot.",
    "",
    "| # | Achievement | Tier | Condition | Progress | Unlocked |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/* A readable condition for an achievement the note does not describe yet.
 * Better than a blank cell, and it is only a fallback -- the wording in the
 * note wins. */
function conditionFor(pred) {
  if (!pred) return "Awarded by hand";
  if (pred.f) return "A one-off condition the engine checks";
  return `Reach ${fmtNum(pred.t)}`;
}


function bankScaffold() {
  return [
    "---",
    "title: Reward Bank",
    "type: dashboard",
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "# Reward Bank",
    "",
    "```life-os",
    "view: bank",
    "```",
    "",
    "Earning XP banks real money towards things you actually want. Uptick only",
    "does the arithmetic \u2014 it never touches an account, and the money stays",
    "wherever you keep it.",
    "",
    "## Balance",
    "",
    "| | |",
    "|---|---|",
    "| Lifetime earned | $0.00 |",
    "",
    "## Goals",
    "",
    "Type what you are saving for. The rest of the row is filled in for you.",
    "",
    "| # | Goal | Price | Banked | % | ETA | Status |",
    "|---|---|---|---|---|---|---|",
    "| 1 | *Something you want* | $100.00 | $0.00 | 0% | \u2014 | Queued |",
    "",
    "## Ledger",
    "",
    "Record a spend as a negative change, and the balance follows.",
    "",
    "| Date | Change | Reason |",
    "|---|---|---|",
    "",
  ].join("\n");
}

function settingsScaffold() {
  return [
    "---",
    "title: Uptick Settings",
    "type: settings",
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "# Uptick Settings",
    "",
    "```life-os",
    "view: settings",
    "```",
    "",
    "*Settings are stored with the plugin, not in this note. This page is the",
    "editor for them; deleting it loses nothing.*",
    "",
  ].join("\n");
}

function dailyScaffold(day) {
  const iso = day.format("YYYY-MM-DD");
  return [
    "---",
    "type: daily",
    `date: ${iso}`,
    `created: ${moment().format("YYYY-MM-DD")}`,
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "```life-os",
    "view: daily",
    "```",
    "",
    `## ${DAILY_SECTIONS.plan}`,
    "",
    `## ${DAILY_SECTIONS.priorities}`,
    "",
    `## ${DAILY_SECTIONS.focus}`,
    "",
    `## ${DAILY_SECTIONS.worklog}`,
    "",
    `## ${DAILY_SECTIONS.tasks}`,
    "",
    `## ${DAILY_SECTIONS.notes}`,
    "",
    `## ${DAILY_SECTIONS.endOfDay}`,
    "",
    ...EOD_BUCKETS.flatMap((b) => [`### ${b}`, ""]),
  ].join("\n");
}

function weeklyScaffold(w) {
  const end = w.clone().endOf("isoWeek");
  return [
    "---",
    "type: weekly",
    `date: ${w.format("YYYY-MM-DD")}`,
    `week_start: ${w.format("YYYY-MM-DD")}`,
    `week_end: ${end.format("YYYY-MM-DD")}`,
    "tags:", "  - periodic/weekly",
    "cssclasses:", "  - life-os", "  - max",
    "---",
    "",
    "```life-os", "view: weekly", "```",
    "",
    `## ${REVIEW_SECTIONS.priorities}`, "",
    `## ${REVIEW_SECTIONS.moved}`, "",
    `## ${REVIEW_SECTIONS.stalled}`, "",
    `## ${REVIEW_SECTIONS.carry}`, "",
  ].join("\n");
}

function monthlyScaffold(m) {
  return [
    "---",
    "type: monthly",
    `date: ${m.format("YYYY-MM-DD")}`,
    `month_start: ${m.format("YYYY-MM-DD")}`,
    `month_end: ${m.clone().endOf("month").format("YYYY-MM-DD")}`,
    "tags:", "  - periodic/monthly",
    "cssclasses:", "  - life-os", "  - max",
    "---",
    "",
    "```life-os", "view: monthly", "```",
    "",
    `## ${REVIEW_SECTIONS.outcomes}`, "",
    `## ${REVIEW_SECTIONS.priorities}`, "",
    `## ${REVIEW_SECTIONS.carry}`, "",
  ].join("\n");
}

function planStudySummary(quest) {
  const due = Number(quest?.study?.due) || 0;
  if (!due) return null;
  const cert = (quest?.certifications ?? [])[0] ?? {};
  const weakest = [...(cert.domains ?? [])]
    .sort((a, b) => Number(a.mastery ?? 1) - Number(b.mastery ?? 1))[0];
  return { due, certification: cert.name ?? "Current certification",
    weakestDomain: weakest?.name ?? null };
}

function minutesUntilMeeting(value, now = moment()) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = moment(String(value), ["HH:mm", "H:mm", "HH:mm:ss", "h:mm A", "h:mmA"], true);
  if (!parsed.isValid()) return null;
  const target = now.clone().hour(parsed.hour()).minute(parsed.minute()).second(0);
  const minutes = target.diff(now, "minutes");
  return minutes >= 0 ? minutes : null;
}

function nextMeeting(meetings, now = moment()) {
  return (meetings ?? []).map((meeting) => ({ meeting,
    minutes: minutesUntilMeeting(meeting.time, now) }))
    .filter((item) => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes)[0] ?? null;
}

function planEntryLabel(entry, taskById) {
  if (entry.kind === "study") return entry.label || "Study LearnKit";
  return taskById.get(entry.id)?.text || entry.label || "Task no longer in Task Inbox";
}

/* The editable plan is intentionally shared by Home and Daily. Home answers
 * what is next; Daily owns changing the three commitments and their outcomes. */
async function renderTodayPlan(plugin, parent, opts) {
  const { path, content, tasks, priorities, meetings, refresh, compact = false } = opts;
  const entries = parseTodayPlan(content);
  const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));
  const quest = await plugin.game.quest();
  const study = planStudySummary(quest);
  const suggestions = todayPlanRecommendations(tasks, priorities, study);
  const plannedKeys = new Set(entries.map((entry) => `${entry.kind}:${entry.id}`));
  const next = nextMeeting(meetings);
  const totalMinutes = planMinutes(entries, tasks);
  const plan = card(parent, compact ? "Now" : "Today Plan", "◉", compact ? "lifeos-now" : "span2 lifeos-today-plan");

  const top = el(plan, "div", "lifeos-plan-top");
  const copy = el(top, "div", null);
  el(copy, "div", "lifeos-plan-count", `${entries.length} / 3 commitments`);
  if (next) {
    el(copy, "div", "lifeos-plan-next", `Next meeting: ${fmtTime(next.meeting.time) ?? "—"} ${next.meeting.title}`);
  }
  if (next && totalMinutes > next.minutes) {
    const warning = el(plan, "div", "lifeos-plan-warning");
    warning.setText(`${totalMinutes} min planned before a meeting in ${next.minutes} min.`);
  }

  const change = async (index, status, completeTask = false) => {
    const current = entries[index];
    if (!current) return;
    try {
      if (completeTask && current.kind === "task") {
        const task = taskById.get(current.id);
        if (!task) throw new Error("Task no longer exists in Task Inbox");
        await plugin.tasks.setDone(task, true);
      }
      entries[index] = { ...current, status };
      await saveTodayPlan(plugin, path, entries);
      await refresh();
    } catch (err) {
      new Notice(String(err.message ?? err));
    }
  };
  const remove = async (index) => {
    entries.splice(index, 1);
    await saveTodayPlan(plugin, path, entries);
    await refresh();
  };
  const move = async (index, direction) => {
    const other = index + direction;
    if (other < 0 || other >= entries.length) return;
    [entries[index], entries[other]] = [entries[other], entries[index]];
    await saveTodayPlan(plugin, path, entries);
    await refresh();
  };

  if (!entries.length) {
    el(plan, "div", "lifeos-empty", compact
      ? "No Today Plan yet. Open Today to choose three commitments."
      : "Choose up to three commitments. Suggestions never change your plan on their own.");
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const row = el(plan, "div", `lifeos-plan-row is-${entry.status}`);
    const body = el(row, "div", "lifeos-plan-body");
    el(body, "div", "lifeos-plan-label", planEntryLabel(entry, taskById));
    const detail = el(body, "div", "lifeos-plan-detail");
    el(detail, "span", `lifeos-plan-status is-${entry.status}`, entry.status);
    if (entry.kind === "task" && taskById.get(entry.id)?.source) {
      el(detail, "span", "lifeos-plan-source", taskById.get(entry.id).source);
    }
    if (!compact) {
      const actions = el(row, "div", "lifeos-plan-actions");
      if (entry.status === "planned") {
        mkBtn(actions, entry.kind === "task" ? "Complete" : "Studied", () => change(i, "done", entry.kind === "task"), "primary");
        mkBtn(actions, "Defer", () => change(i, "deferred"));
        mkBtn(actions, "Drop", () => change(i, "dropped"));
      }
      mkBtn(actions, "↑", () => move(i, -1));
      mkBtn(actions, "↓", () => move(i, 1));
      mkBtn(actions, "Clear", () => remove(i));
    }
  }

  if (compact) {
    const action = entries.find((entry) => entry.status === "planned")
      ?? suggestions.find((item) => !plannedKeys.has(`${item.kind}:${item.id}`));
    if (action) {
      const task = action.kind === "task" ? taskById.get(action.id) : null;
      const reason = task ? todayPlanRecommendations([task], priorities, null)[0]?.reason : action.reason;
      const recommended = el(plan, "div", "lifeos-plan-recommended");
      el(recommended, "div", "lifeos-microlabel", "RECOMMENDED NEXT");
      el(recommended, "div", "lifeos-plan-recommended-label", planEntryLabel(action, taskById));
      if (reason) el(recommended, "div", "lifeos-plan-reason", reason);
    }
    const open = el(plan, "div", "lifeos-inline-actions lifeos-actions-left");
    mkBtn(open, "Open Today", () => plugin.openDaily(moment()), "primary");
    return;
  }

  const suggestionsBox = el(plan, "div", "lifeos-plan-suggestions");
  el(suggestionsBox, "div", "lifeos-microlabel", "SUGGESTED — YOU DECIDE");
  const available = suggestions.filter((item) => !plannedKeys.has(`${item.kind}:${item.id}`));
  if (!available.length) {
    el(suggestionsBox, "div", "lifeos-empty", "No actionable suggestions right now.");
  } else {
    for (const item of available.slice(0, 5)) {
      const row = el(suggestionsBox, "div", "lifeos-plan-suggestion");
      const body = el(row, "div", "lifeos-plan-body");
      el(body, "div", "lifeos-plan-label", item.label);
      el(body, "div", "lifeos-plan-reason", item.reason);
      if (item.source) el(body, "div", "lifeos-plan-source", `Source: ${item.source}`);
      const add = () => {
        if (entries.length >= 3) { new Notice("Today Plan already has three commitments"); return; }
        entries.push({ kind: item.kind, id: item.id, label: item.label, status: "planned" });
        saveTodayPlan(plugin, path, entries).then(refresh).catch((err) => new Notice(String(err.message ?? err)));
      };
      mkBtn(row, "Add", add, "primary");
    }
  }

  const unplanned = (tasks ?? []).filter((task) => !task.done && task.id && !plannedKeys.has(`task:${task.id}`));
  if (unplanned.length) {
    const manual = el(plan, "div", "lifeos-plan-manual");
    const picker = manual.createEl("select", { cls: "lifeos-setselect" });
    picker.createEl("option", { text: "Add another open task…", value: "" });
    for (const task of unplanned.sort((a, b) => String(a.due ?? "9999").localeCompare(String(b.due ?? "9999"))).slice(0, 50)) {
      picker.createEl("option", { text: task.text, value: task.id });
    }
    mkBtn(manual, "Add task", async () => {
      const task = taskById.get(picker.value);
      if (!task) return;
      if (entries.length >= 3) { new Notice("Today Plan already has three commitments"); return; }
      entries.push({ kind: "task", id: task.id, label: task.text, status: "planned" });
      await saveTodayPlan(plugin, path, entries);
      await refresh();
    });
  }
}

async function renderNowCard(plugin, root, data) {
  const band = el(root, "div", "lifeos-now-band");
  await renderTodayPlan(plugin, band, { ...data, compact: true });
  const signals = await integrationSignals(plugin);
  const trust = el(band, "div", "lifeos-trust-signals");
  for (const signal of signals) {
    const row = el(trust, "div", `lifeos-trust-signal is-${signal.state}`);
    el(row, "span", "lifeos-trust-name", signal.label);
    el(row, "span", "lifeos-trust-detail", signal.detail);
    if (signal.target) onTap(row, signal.target);
  }
}

/* ---------------------------------------------------------------- daily UI */

async function renderDaily(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  await plugin.game.warm();
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const day = moment(fm.date ?? file.basename, "YYYY-MM-DD");
  const content = await app.vault.read(file);

  /* The day's meetings are the recurring occurrences PLUS any one-off note
   * recorded for that date (a Granola import of an ad-hoc call, for example).
   * A note already matched to a series is not listed twice. */
  const recurring = plugin.recur.on(day).map((s) => ({
    kind: "series",
    series: s,
    time: s.fm.time ?? null,
    title: s.file.basename,
    note: plugin.recur.instance(s, day),
    status: s.fm.status,
  }));
  const claimed = new Set(recurring.map((m) => m.note?.path).filter(Boolean));
  const oneOffs = plugin.meetings
    .onDay(day)
    .filter((m) => !claimed.has(m.file.path) && !m.series)
    .map((m) => ({
      kind: "one-off",
      series: null,
      time: m.fm.time ?? null,
      /* Imported notes are filed as "2026-08-19 - Real Title". The date is
       * already the page you are on, so show the meeting's own title and let
       * the row read like every other one: time, then name. */
      title: String(m.fm.title ?? m.file.basename)
        .replace(/^\d{4}-\d{2}-\d{2}\s*[-–—]\s*/, "")
        .trim() || m.file.basename,
      note: m.file,
      fm: m.fm,
      status: null,
    }));
  /* Calendar events are a third kind. An event whose title matches a series or
   * an existing note is dropped rather than listed twice. */
  await plugin.calendars.load();
  const known = [...recurring, ...oneOffs].map((m) => slug(m.title));
  /* A Granola note and its invite are the same meeting. Slug containment only
   * catches near-identical titles, so an event is also dropped when a note
   * explicitly links to it (`calendar_event`) or shares two significant words
   * with it — Granola names a meeting from what was said, not from the invite. */
  const linkedEvents = new Set(
    [...recurring, ...oneOffs]
      .map((m) => m.fm?.calendar_event)
      .filter(Boolean)
      .map(String)
  );
  const sigWords = (s) => new Set(
    (String(s).toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
      .filter((w) => !["meeting", "review", "sync", "call", "with", "and", "the"].includes(w))
  );
  const knownWords = [...recurring, ...oneOffs].map((m) => sigWords(m.title));
  const calEvents = plugin.calendars
    .on(day)
    .filter((e) => {
      if (e.id && linkedEvents.has(String(e.id))) return false;
      const s = slug(e.title);
      if (known.some((k) => k && (k.includes(s) || s.includes(k)))) return false;
      const ew = sigWords(e.title);
      return !knownWords.some((kw) => [...kw].filter((w) => ew.has(w)).length >= 2);
    })
    .map((e) => ({
      kind: "calendar",
      series: null,
      time: e.all_day ? null : moment(e.start).format("HH:mm"),
      title: e.title,
      note: null,
      status: null,
      event: e,
    }));

  for (const o of oneOffs) {
    if (!o.time && o.fm?.time) o.time = String(o.fm.time);
  }

  const meetings = [...recurring, ...oneOffs, ...calEvents].sort((a, b) =>
    String(a.time ?? "99:99").localeCompare(String(b.time ?? "99:99"))
  );

  const allTasks = await plugin.tasks.all();
  const iso = day.format("YYYY-MM-DD");
  const dueToday = allTasks.filter((t) => !t.done && t.due && t.due <= iso);
  const priorities = plugin.store.sectionItems(content, DAILY_SECTIONS.priorities);
  const focus = plugin.store.sectionItems(content, DAILY_SECTIONS.focus);
  const worklog = plugin.store.sectionItems(content, DAILY_SECTIONS.worklog);
  const notes = plugin.store.sectionItems(content, DAILY_SECTIONS.notes);
  const todayPlan = parseTodayPlan(content);

  /* Obsidian's metadata cache lags a vault write by a tick; wait for the file
   * to settle before re-reading, or the panel redraws with stale content. */
  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath);
    await redraw();
  };

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Daily", path: `${P.daily}/Daily.md` },
    { label: day.format("YYYY-MM-DD") },
  ]);

  /* header */
  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", day.format("dddd, MMMM D, YYYY"));
  el(ht, "div", "lifeos-sub", `Week ${day.format("W")} • ${day.format("dddd")}`);
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, `← ${day.clone().subtract(1, "day").format("YYYY-MM-DD")}`, () =>
    plugin.openDaily(day.clone().subtract(1, "day")));
  mkBtn(nav, `Week ${day.format("W")} Review`, () => plugin.openWeekly(day));
  mkBtn(nav, day.format("MMMM YYYY"), () => plugin.openMonthly(day));
  mkBtn(nav, `${day.clone().add(1, "day").format("YYYY-MM-DD")} →`, () =>
    plugin.openDaily(day.clone().add(1, "day")));
  mkBtn(nav, "Open Source Note", () =>
    app.commands.executeCommandById("markdown:toggle-preview"));

  if (plugin.shows("daily", "xp", "game")) await xpHero(plugin, root, iso);

  if (plugin.shows("daily", "weather", "weather")) await renderWeather(plugin, root);

  /* The page is ordered the way the day runs — set up, do, wind down — rather
   * than grouped by record type. Counts sit in a strip above the cards so the
   * shape of the day reads before any single card does. */
  if (plugin.shows("daily", "tiles")) {
    const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
    tile(strip, "Meetings", meetings.length, "scheduled", "▦",
      () => plugin.open(`${P.recurring}/Recurring Meetings.md`), "Manage recurring series");
    tile(strip, "Tasks due", dueToday.length, "today", "☑",
      () => plugin.openOrCreate(P.kanban, kanbanScaffold, "the Kanban board"), "Open the Kanban board");
    tile(strip, "Priorities", priorities.length, "set", "◎");
    tile(strip, "Notes", notes.length, "captured", "▤");
  }


  const grid = el(root, "div", "lifeos-grid lifeos-grid-daily");

  if (plugin.shows("daily", "plan")) {
    await renderTodayPlan(plugin, grid, {
      path: ctx.sourcePath, content, tasks: allTasks, priorities: [...priorities, ...focus],
      meetings, refresh,
    });
  }

  /* What matters today — priorities and focus asked the same question in two
   * cards, and both were usually empty. One card, one question. */
  if (plugin.shows("daily", "priorities")) {
    const pr = card(grid, "What matters today", "◎", "col1 span2");
    listOrEmpty(pr, [...priorities, ...focus], "Nothing set yet. Name one thing.");
    addRow(pr, "+ Add", "What matters most today?", async (v) => {
      await plugin.store.appendToSection(ctx.sourcePath, DAILY_SECTIONS.priorities, `- ${v}`);
      await refresh();
    });

    /* Photo sits in the opening band, opposite the day's shape. */
  }

  if (plugin.shows("daily", "photos", "photos")) await renderPhotos(plugin, grid, "col3");

  if (plugin.shows("daily", "meetings", "meetings")) {
    /* meetings */
    const mt = card(grid, "Scheduled Meetings", "▦", "col2 span2");
    if (!meetings.length) {
      el(mt, "div", "lifeos-empty", "Nothing recurring today.");
    } else {
      for (const m of meetings) {
        const note = m.note;
        const row = el(mt, "div", "lifeos-meeting");
        const top = el(row, "div", "lifeos-meeting-top");
        el(top, "div", "lifeos-time", fmtTime(m.time) ?? "—");
        el(top, "div", "lifeos-meeting-name", m.title);
        if (m.kind === "series") {
          el(top, "span", "lifeos-badge", "Recurring");
          if (String(m.status ?? "").toLowerCase() === "needs-confirmation") {
            el(top, "span", "lifeos-badge lifeos-badge-warn", "unconfirmed");
          }
        } else if (m.kind === "calendar") {
          el(top, "span", "lifeos-badge lifeos-badge-cal",
            m.event.all_day ? "All day" : "Calendar");
          if (m.event.calendar) el(top, "span", "lifeos-muted", m.event.calendar);
        } else {
          el(top, "span", "lifeos-badge lifeos-badge-alt", "One-off");
        }
        const act = el(top, "div", "lifeos-meeting-actions");
        if (note) {
          mkBtn(act, "View Note", () => plugin.open(note.path));
        } else if (m.kind === "calendar") {
          /* Calendar is read-only, but an event can still get a meeting record. */
          mkBtn(act, "Create Note", async () => {
            const name = safeName(`${day.format("YYYY-MM-DD")} - ${m.title}`);
            const path = `${P.meetings}/${name}.md`;
            if (!app.vault.getAbstractFileByPath(path)) {
              await app.vault.create(path, meetingScaffold(name, day.format("YYYY-MM-DD"), null, null));
              if (m.time) await setFrontMatter(app, app.vault.getAbstractFileByPath(path), "time", m.time);
            }
            await plugin.open(path);
          });
        } else {
          mkBtn(act, "Create Note", async () => {
            const path = await createMeetingNote(plugin, m.series, day);
            await plugin.open(path);
          }, "primary");
        }
        /* Counts only when a note exists AND holds something. A meeting with no
         * record was rendering three columns of em-dashes — roughly half the row
         * height spent saying "nothing here", four times over. */
        let counts = null;
        if (note) {
          const body = await app.vault.read(note);
          const c = {
            Agenda: plugin.store.sectionItems(body, MEETING_SECTIONS.agenda).length,
            Notes: plugin.store.sectionItems(body, MEETING_SECTIONS.discussion).length,
            Actions: (await plugin.tasks.bySource(note.basename)).length,
          };
          if (c.Agenda || c.Notes || c.Actions) counts = c;
        }
        if (counts) {
          const cols = el(row, "div", "lifeos-meeting-cols");
          for (const label of ["Agenda", "Notes", "Actions"]) {
            const c = el(cols, "div", "lifeos-meeting-col");
            el(c, "div", "lifeos-microlabel", label.toUpperCase());
            const v = counts[label];
            el(c, "div", v ? "lifeos-colcount" : "lifeos-muted", String(v));
          }
        }
      }
    }
  }


  if (plugin.shows("daily", "tasks")) {
    /* tasks */
    /* Keep tasks in the primary wide lane directly below Scheduled Meetings.
     * Long task titles should use the available width instead of making the
     * narrow sidebar unnecessarily tall. */
    const tk = card(grid, "Tasks", "☑", "span2");
    if (!dueToday.length) {
      el(tk, "div", "lifeos-empty", "Nothing due today.");
    } else {
      for (const t of dueToday) {
        const r = el(tk, "div", "lifeos-task");
        const checkbox = r.createEl("input", { cls: "lifeos-task-checkbox", type: "checkbox" });
        checkbox.checked = false;
        checkbox.setAttribute("aria-label", `Mark task complete: ${t.text}`);
        checkbox.addEventListener("change", async () => {
          checkbox.disabled = true;
          try {
            await plugin.tasks.setDone(t, checkbox.checked);
            new Notice("Task completed and synced to Kanban");
            await refresh();
          } catch (err) {
            checkbox.checked = false;
            new Notice(String(err.message ?? err));
            checkbox.disabled = false;
          }
        });
        el(r, "span", "lifeos-task-dot");
        el(r, "span", "lifeos-task-text", t.text);
        diffPill(r, t);
        if (t.due) el(r, "span", "lifeos-task-due", t.due);
      }
    }
    addRow(tk, "+ Add Task", "New task (goes to Task Inbox)", async (v) => {
      await plugin.tasks.add(v, { due: iso, source: file.basename });
      new Notice("Added to Task Inbox");
      await refresh();
    });
  }


  if (plugin.shows("daily", "worklog")) {
    /* work log — what actually happened, kept next to the end-of-day review it
     * feeds rather than up with the plan for the day */
    const wl = card(grid, "Work Log", "◷", "col1 span2");
    listOrEmpty(wl, worklog, "No log entries yet.");
    addRow(wl, "+ Add Log Entry", "What did you just work on?", async (v) => {
      const stamp = moment().format("h:mm A");
      await plugin.store.appendToSection(ctx.sourcePath, DAILY_SECTIONS.worklog, `- \`${stamp}\` ${v}`);
      await refresh();
    });
  }


  if (plugin.shows("daily", "eod")) {
    /* end of day — four buckets, each collecting its own entries */
    const eod = card(grid, "End of Day", "✻", "col3");
    if (todayPlan.length) {
      const review = el(eod, "div", "lifeos-plan-review");
      el(review, "div", "lifeos-eodname", "Today Plan review");
      for (const status of ["done", "deferred", "dropped", "planned"]) {
        const count = todayPlan.filter((entry) => entry.status === status).length;
        if (count) el(review, "div", "lifeos-plan-review-row", `${count} ${status}`);
      }
    }
    for (const bucket of EOD_BUCKETS) {
      const items = plugin.store.sectionItems(content, bucket);
      const b = el(eod, "div", "lifeos-eodbucket");
      const bh = el(b, "div", "lifeos-eodhead");
      el(bh, "span", "lifeos-eodname", bucket);
      el(bh, "span", "lifeos-eodcount", String(items.length));
      for (const i of items) el(b, "div", "lifeos-listitem", i);
      addRow(b, "+ Add", bucket, async (v) => {
        await plugin.store.appendToSection(ctx.sourcePath, bucket, `- ${v}`);
        await refresh();
      });
    }
  }


  if (plugin.shows("daily", "experience", "game")) await dayXpCard(plugin, grid, iso, "col3");

  if (plugin.shows("daily", "email", "email")) {
    /* email received today */
    const emailsDay = plugin.emails.on(day);
    const ec = card(grid, "Email", "✉", "col3");
    renderEmailRows(plugin, ec, emailsDay, "No email imported for this day.", redraw, 6);
  }


  /* reference — the same card Home carries, so the two pages end alike */
  if (plugin.shows("daily", "reference")) {
    renderReference(plugin, grid, [
      [`Week ${day.format("W")} review`, () => plugin.openWeekly(day), "this week's review note"],
      [day.format("MMMM YYYY"), () => plugin.openMonthly(day), "this month's review note"],
      ["Uptick", "Uptick", "the main dashboard"],
      ["Recurring series", `${P.recurring}/Recurring Meetings`, "standing meetings and their cadence"],
      ["Task dashboard", `${P.tasks}/Task Dashboard`, "every open task, grouped"],
      ["Task Inbox", P.taskInbox.replace(/\.md$/, ""), "the canonical task store"],
    ], "col1 span2");
  }


  /* notes */
  const nt = el(root, "div", "lifeos-card lifeos-notes");
  cardHead(nt, "Today's Notes", "▤");
  listOrEmpty(nt, notes, "No notes captured yet.");
  const box = el(nt, "div", "lifeos-capture");
  const tools = el(box, "div", "lifeos-toolbar");
  const ta = box.createEl("textarea", { cls: "lifeos-textarea" });
  ta.placeholder = "Quick thought…";

  /* Wrap the selection, or drop a prefix on the current line. */
  const wrap = (before, after) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    ta.value = ta.value.slice(0, s) + before + sel + (after ?? "") + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + sel.length;
  };
  const prefix = (p) => {
    const s = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
    ta.value = ta.value.slice(0, lineStart) + p + ta.value.slice(lineStart);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + p.length;
  };

  for (const [label, fn, title] of [
    ["B", () => wrap("**", "**"), "Bold"],
    ["I", () => wrap("*", "*"), "Italic"],
    ["H", () => prefix("### "), "Heading"],
    ["•", () => prefix("- "), "Bullet"],
    ["☐", () => prefix("- [ ] "), "Checkbox"],
    ["{ }", () => wrap("`", "`"), "Code"],
  ]) {
    const b = el(tools, "button", "lifeos-tool", label);
    b.title = title;
    b.onclick = (ev) => { ev.preventDefault(); fn(); };
  }

  const bar = el(box, "div", "lifeos-capture-bar");
  mkBtn(bar, "Add to Today's Notes", async () => {
    const v = ta.value.trim();
    if (!v) return;
    for (const line of v.split("\n").filter((x) => x.trim())) {
      const t = line.trim();
      /* Keep list/checkbox markers the writer typed; only add one when absent. */
      await plugin.store.appendToSection(
        ctx.sourcePath, DAILY_SECTIONS.notes,
        /^([-*]|\d+[.)])\s/.test(t) ? t : `- ${t}`
      );
    }
    ta.value = "";
    await refresh();
  }, "primary");
}

/* Flip one checklist line in place. Matched on exact text so we never touch a
 * different line that happens to look similar. */
async function toggleChecklistLine(app, path, line) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return;
  await app.vault.process(f, (data) => {
    const lines = data.split("\n");
    const i = lines.indexOf(line);
    if (i === -1) return data;
    lines[i] = /^\s*-\s*\[ \]/.test(line)
      ? line.replace(/^(\s*-\s*)\[ \]/, "$1[x]")
      : line.replace(/^(\s*-\s*)\[[xX]\]/, "$1[ ]");
    return lines.join("\n");
  });
}

/* Set or replace ONE frontmatter field, leaving every other line untouched.
 * Never use processFrontMatter on imported notes — see Meetings.normalize. */
async function setFrontMatter(app, file, key, rawValue) {
  const value = JSON.stringify(String(rawValue)); // always quoted → YAML-safe
  await app.vault.process(file, (data) => {
    const line = `${key}: ${value}`;
    if (!data.startsWith("---")) return `---\n${line}\n---\n\n${data}`;
    const end = data.indexOf("\n---", 3);
    if (end === -1) return data;
    /* end points at the "\n" before the closing "---".
     * block keeps its LEADING newline and rest keeps the closing fence, so
     * "---" + block + rest reproduces the file exactly. Slicing at 4 / end+1
     * ate both newlines and welded the fences onto the first and last keys. */
    let block = data.slice(3, end);
    const rest = data.slice(end);
    const re = new RegExp(`^${key}\\s*:.*$`, "m");
    block = re.test(block) ? block.replace(re, line) : `${block}\n${line}`;
    return "---" + block + rest;
  });
}

function safeName(s) {
  return String(s).slice(0, 80).replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();
}

const MEETING_SECTIONS = {
  context: "Context",
  agenda: "Agenda",
  discussion: "Discussion",
  decisions: "Decisions",
  actions: "Action Items",
  followup: "Follow-up",
  related: "Related Knowledge",
};

function meetingScaffold(title, iso, seriesKey, series) {
  const fm = series?.fm ?? {};
  return [
    "---",
    "type: meeting",
    `series: ${seriesKey ?? ""}`,
    `meeting_date: ${iso}`,
    `date: ${iso}`,
    `attendees: ${JSON.stringify(toArray(fm.attendees))}`,
    fm.time ? `time: "${fm.time}"` : "time:",
    fm.duration ? `duration: ${fm.duration}` : "duration:",
    "location:",
    "objective:",
    "status: open",
    "cssclasses:",
    "  - life-os",
    "  - max",
    "---",
    "",
    "```life-os",
    "view: meeting",
    "```",
    "",
    ...Object.values(MEETING_SECTIONS).flatMap((h) => [`## ${h}`, ""]),
  ].join("\n");
}

async function createMeetingNote(plugin, series, day) {
  /* Never create a second record for a meeting that already has one — an
   * imported Granola note counts. */
  const existing = plugin.recur.instance(series, day);
  if (existing) {
    new Notice(`Opening the existing note for this meeting`);
    return existing.path;
  }

  const iso = day.format("YYYY-MM-DD");
  const name = safeName(`${iso} - ${series.file.basename}`);
  const path = `${P.meetings}/${name}.md`;
  if (plugin.app.vault.getAbstractFileByPath(path)) return path;

  const key = series.fm.series ?? slug(series.file.basename);
  await plugin.app.vault.create(path, meetingScaffold(name, iso, key, series));
  new Notice(`Created ${name}`);
  return path;
}

/* ----------------------------------------------------------------- home UI */

function greeting(h) {
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Markdown files a human would consider "notes", excluding machine output. */
function humanNotes(app, plugin) {
  /* The system and automation folders are always excluded because they hold
   * this plugin's own output; the rest comes from settings, since another
   * vault will not have the same import folders. */
  const extra = cfgGet(plugin?.cfg, "noteCount.exclude", DEFAULTS.noteCount.exclude);
  const skip = [`${P.automation}/`, `${P.game}/`, `${P.logs}/`,
                ...(Array.isArray(extra) ? extra : [])];
  return app.vault.getMarkdownFiles()
    .filter((f) => !skip.some((s) => s && (f.path.startsWith(s) || f.path.includes(s))));
}

/* When a note was authored, according to the note itself.
 *
 * file.stat.ctime is NOT usable in this vault: the 2026-08-18 migration copied
 * every file, so filesystem creation time is the migration date for thousands
 * of notes. Only a date the note states about itself is trustworthy; notes
 * without one are simply not counted rather than silently inflating totals. */
function authoredOn(app, file) {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const raw = fm?.created ?? fm?.date ?? fm?.meeting_date;
  if (raw) {
    const m = moment(String(raw), "YYYY-MM-DD", true);
    if (m.isValid()) return m;
  }
  const fromName = String(file.basename).match(/^(\d{4}-\d{2}-\d{2})/);
  if (fromName) {
    const m = moment(fromName[1], "YYYY-MM-DD", true);
    if (m.isValid()) return m;
  }
  return null;
}

async function renderHome(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  await plugin.game.warm();
  const now = moment();
  const today = now.clone().startOf("day");

  await plugin.calendars.load();
  const emailsToday = plugin.emails.on(today);

  /* Home must agree with the Daily view, which merges calendar events into the
   * day's meetings. Counting only recurring series here made the same day read
   * 3 on Home and 4 on Daily. Events already covered by a series are dropped so
   * nothing is counted twice. */
  const seriesToday = plugin.recur.on(today);
  const seriesSlugs = seriesToday.map((s) => slug(s.file.basename));
  const calToday = plugin.calendars.on(today).filter((e) => {
    const s = slug(e.title);
    return !seriesSlugs.some((k) => k && (k.includes(s) || s.includes(k)));
  });
  const meetingsToday = [
    ...seriesToday.map((s) => ({ kind: "series", time: s.fm.time ?? null,
      title: s.file.basename, series: s })),
    ...calToday.map((e) => ({ kind: "calendar",
      time: e.all_day ? null : moment(e.start).format("HH:mm"),
      title: e.title, event: e })),
  ].sort((a, b) => String(a.time ?? "99:99").localeCompare(String(b.time ?? "99:99")));
  const allTasks = await plugin.tasks.all();
  const iso = today.format("YYYY-MM-DD");
  const openTasks = allTasks.filter((t) => !t.done);
  const doneToday = allTasks.filter((t) => t.done && t.doneOn === iso);
  const dueSoon = openTasks
    .filter((t) => t.due)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 6);
  const todayPath = `${P.daily}/${iso}.md`;
  const todayNote = app.vault.getAbstractFileByPath(todayPath);
  const todayContent = todayNote ? await app.vault.read(todayNote) : "";
  const todayPriorities = plugin.store.sectionItems(todayContent, DAILY_SECTIONS.priorities)
    .concat(plugin.store.sectionItems(todayContent, DAILY_SECTIONS.focus));

  const weekStart = today.clone().startOf("isoWeek");
  const notes = humanNotes(app, plugin);
  const notesThisWeek = notes.filter((f) => {
    const c = authoredOn(app, f);
    return c && c.isSameOrAfter(weekStart);
  });
  const doneThisWeek = allTasks.filter(
    (t) => t.done && t.doneOn && moment(t.doneOn).isSameOrAfter(weekStart)
  );

  const projects = app.vault.getMarkdownFiles()
    .filter((f) => f.path.startsWith(P.projects + "/"))
    .map((f) => ({ f, fm: app.metadataCache.getFileCache(f)?.frontmatter ?? {} }))
    .filter((x) => String(x.fm.status ?? "").toLowerCase() === "active");

  const meetingNotes = app.vault.getMarkdownFiles()
    .filter((f) => f.path.startsWith(P.meetings + "/") && !f.path.startsWith(P.recurring + "/"))
    .map((f) => ({ f, fm: app.metadataCache.getFileCache(f)?.frontmatter ?? {} }))
    .filter((x) => x.fm.meeting_date || x.fm.date)
    .sort((a, b) =>
      String(b.fm.meeting_date ?? b.fm.date).localeCompare(String(a.fm.meeting_date ?? a.fm.date))
    )
    .slice(0, 5);

  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath);
    await redraw();
  };

  renderHeader(plugin, root, [{ label: "Uptick" }, { label: "Home" }]);

  /* ---- greeting ---- */
  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", `${greeting(now.hour())} 👋`);
  el(ht, "div", "lifeos-sub", "Discipline today, freedom tomorrow.");
  const hr = el(head, "div", "lifeos-head-right");
  el(hr, "div", "lifeos-date", now.format("dddd, MMMM D, YYYY"));
  el(hr, "div", "lifeos-sub", `Week ${now.format("W")} of ${now.format("YYYY")}`);

  if (plugin.shows("home", "now")) {
    await renderNowCard(plugin, root, {
      path: todayPath, content: todayContent, tasks: allTasks, priorities: todayPriorities,
      meetings: meetingsToday, refresh,
    });
  }

  if (plugin.shows("home", "xp", "game")) await xpHero(plugin, root);
  /* home.weather has been in DEFAULTS since the first version and was read by
   * nothing: the setting existed, its toggle existed, and the card never
   * appeared on Home no matter what you set it to. */
  if (plugin.shows("home", "weather", "weather")) await renderWeather(plugin, root);

  if (plugin.shows("home", "tiles")) {
    /* ---- tiles ---- */
    const tiles = el(root, "div", "lifeos-tiles");
    tile(tiles, "Open tasks", openTasks.length, `${doneToday.length} done today`, "☑",
      () => plugin.openOrCreate(P.kanban, kanbanScaffold, "the Kanban board"), "Open the Kanban board");
    tile(tiles, "Meetings", meetingsToday.length, "today", "▦",
      () => plugin.openDaily(today), "Open today");
    /* Counts unread, to match what the Email card lists — read mail is folded
     * away there, so counting all of it would contradict the panel. */
    const unreadToday = emailsToday.filter((e) => !e.read);
    tile(tiles, "Unread mail", unreadToday.length,
      `${unreadToday.reduce((n, e) => n + e.actionCount, 0)} with actions`, "✉",
      () => plugin.open(`${P.emails}/Email References.md`), "Open today's email");
    tile(tiles, "Done", doneThisWeek.length, "this week", "✓",
      () => plugin.openWeekly(now), "Open the week review");
  }

  const grid = el(root, "div", "lifeos-grid lifeos-grid-home");


  if (plugin.shows("home", "today")) {
    /* ---- today at a glance ---- */
    const glance = card(grid, "Today at a Glance", "◉", "col1 span2");

    /* The question a dashboard is actually opened to answer is "what is next",
     * not "what is the whole day" — the day view already answers that. The next
     * item gets its own line above the schedule, with how long until it, so the
     * answer is readable without parsing a list. */
    const nowHM2 = moment().format("HH:mm");
    const asHM = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const s = String(v);
      const hm = s.match(/^(\d{1,2}):(\d{2})/);
      if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;
      const iso = moment(s, moment.ISO_8601);
      return iso.isValid() ? iso.format("HH:mm") : null;
    };
    const nextUp = meetingsToday
      .map((m) => ({ m, hm: asHM(m.time) }))
      .filter((x) => x.hm && x.hm >= nowHM2)
      .sort((a, b) => a.hm.localeCompare(b.hm))[0];

    const nx = el(glance, "div", "lifeos-nextup");
    if (nextUp) {
      const mins = moment(nextUp.hm, "HH:mm").diff(moment(nowHM2, "HH:mm"), "minutes");
      const away = mins <= 0 ? "now"
        : mins < 60 ? `in ${mins} min`
        : `in ${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim();
      el(nx, "div", "lifeos-nextup-label", "NEXT UP");
      const line = el(nx, "div", "lifeos-nextup-line");
      el(line, "span", "lifeos-nextup-time", fmtTime(nextUp.m.time) ?? "—");
      el(line, "span", "lifeos-nextup-name", nextUp.m.title);
      el(line, "span", "lifeos-nextup-away", away);
      onTap(nx, () => plugin.openDaily(today));
      nx.title = "Open today";
      nx.addClass("is-clickable");
    } else {
      el(nx, "div", "lifeos-nextup-label", "NEXT UP");
      el(nx, "div", "lifeos-nextup-line").setText(
        meetingsToday.length ? "Nothing left today." : "Nothing scheduled today.");
    }

    const gh = el(glance, "div", "lifeos-inline-actions lifeos-actions-left");
    mkBtn(gh, "Open Today", () => plugin.openDaily(today));

    el(glance, "div", "lifeos-microlabel", "REST OF THE DAY");
    if (!meetingsToday.length) {
      el(glance, "div", "lifeos-empty", "Nothing scheduled today.");
    } else {
      for (const m of meetingsToday) {
        const note = m.kind === "series" ? plugin.recur.instance(m.series, today) : null;
        const r = el(glance, "div", "lifeos-schedrow");
        el(r, "span", "lifeos-time", fmtTime(m.time) ?? "—");
        el(r, "span", "lifeos-schedname", m.title);
        if (m.kind === "calendar") el(r, "span", "lifeos-badge lifeos-badge-cal", "Calendar");
        const act = el(r, "span", "lifeos-schedact");
        if (note) mkBtn(act, "View Note", () => plugin.open(note.path));
        else if (m.kind === "series") mkBtn(act, "Create Note", async () => {
          await plugin.open(await createMeetingNote(plugin, m.series, today));
        });
        else mkBtn(act, "Open day", () => plugin.openDaily(today));
      }
    }

    /* Upcoming tasks live in the tabbed Upcoming card below — not repeated here. */

    el(glance, "div", "lifeos-microlabel", "TODAY'S PRIORITIES");
    listOrEmpty(glance, todayPriorities, "No priorities set for today.");
  }


  if (plugin.shows("home", "calendar", "calendar")) {
    /* ---- calendar ---- */
    const cal = card(grid, now.format("MMMM YYYY"), "▤", "col3");
    renderCalendar(cal, now, plugin, meetingsToday);
  }


  if (plugin.shows("home", "upcoming")) {
    /* ---- upcoming, tabbed ---- */
    const up = card(grid, "Upcoming", "↗", "col1 span2");
    const tabs = el(up, "div", "lifeos-tabs");
    const body = el(up, "div", "lifeos-tabbody");

    const upcomingMeetings = [];
    for (let i = 0; i < 14 && upcomingMeetings.length < 8; i++) {
      const d = today.clone().add(i, "day");
      for (const s of plugin.recur.on(d)) upcomingMeetings.push({ d, s });
    }

    /* One list, not two. "Meetings" and "Events" split the same question — what
     * am I in next — by where the record happened to come from, which is an
     * implementation detail. They are merged and badged by source instead. */
    const sortTime = (v) => {
      if (v === null || v === undefined || v === "") return "99:99";
      const s = String(v);
      const hhmm = s.match(/^(\d{1,2}):(\d{2})/);
      if (hhmm) return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
      const iso = moment(s, moment.ISO_8601);
      return iso.isValid() ? iso.format("HH:mm") : "99:99";
    };
    const upcomingAll = [];
    const nowHM = moment().format("HH:mm");
    /* "Upcoming" should mean still to come. A meeting whose start time has passed
     * today drops off this list — Today at a Glance remains the full day's
     * schedule, so nothing is lost, it just stops competing for attention here.
     * All-day entries and entries with no time survive, since neither can be
     * shown to have finished. */
    const stillAhead = (d, time, allDay) => {
      if (!d.isSame(today, "day")) return true;
      if (allDay || time === null || time === undefined || time === "") return true;
      return sortTime(time) >= nowHM;
    };
    for (let i = 0; i < 14; i++) {
      const d = today.clone().add(i, "day");
      for (const s of plugin.recur.on(d)) {
        const time = s.fm.time ?? null;
        if (!stillAhead(d, time, false)) continue;
        upcomingAll.push({ d, kind: "series", title: s.file.basename, time, series: s });
      }
      for (const e of plugin.calendars.on(d)) {
        const time = e.all_day ? null : e.start;
        if (!stillAhead(d, time, e.all_day)) continue;
        upcomingAll.push({ d, kind: "calendar", title: e.title, time, allDay: e.all_day });
      }
    }
    upcomingAll.sort((a, b) =>
      a.d.valueOf() - b.d.valueOf() ||
      sortTime(a.time).localeCompare(sortTime(b.time)));

    const panels = {
      Tasks: () => {
        if (!dueSoon.length) return el(body, "div", "lifeos-empty", "Nothing with a due date.");
        for (const t of dueSoon) {
          const r = el(body, "div", "lifeos-task is-clickable");
          el(r, "span", `lifeos-task-dot is-${t.status.toLowerCase()}`);
          el(r, "span", "lifeos-task-text", t.text);
          if (t.level) el(r, "span", "lifeos-badge lifeos-prio", `P${t.level}`);
          if (t.ticket) {
            const tk = el(r, "span", "lifeos-badge lifeos-ticket", t.ticket.id);
            if (t.ticket.url) {
              tk.addClass("is-link");
              tk.title = "Open in Salesforce";
              tk.onclick = (ev) => {
                ev.stopPropagation();          // do not also open the task
                window.open(t.ticket.url, "_blank");
              };
            }
          }
          el(r, "span", `lifeos-badge lifeos-status-${t.status.toLowerCase()}`, t.status);
          el(r, "span", "lifeos-task-due", t.due);
          onTap(r, () => plugin.openTask());
          r.title = "Open the Kanban board";
        }
      },
      Meetings: () => {
        const st = plugin.calendars.status();
        if (st.stale || !st.ok) el(body, "div", "lifeos-microlabel", st.text.toUpperCase());
        if (!upcomingAll.length) {
          return el(body, "div", "lifeos-empty", "Nothing scheduled in the next two weeks.");
        }
        for (const m of upcomingAll.slice(0, 12)) {
          const r = el(body, "div", "lifeos-schedrow is-clickable");
          el(r, "span", "lifeos-task-due",
            m.d.isSame(today, "day") ? "today" : m.d.format("ddd D"));
          el(r, "span", "lifeos-time", m.allDay ? "all day" : (fmtTime(m.time) ?? "—"));
          el(r, "span", "lifeos-ellipsis", m.title);
          el(r, "span", `lifeos-badge ${m.kind === "calendar" ? "lifeos-badge-cal" : "lifeos-badge-series"}`,
            m.kind === "calendar" ? "Calendar" : "Series");
          /* Prefer the meeting's own note; fall back to the series definition,
           * then to the day it sits on. */
          onTap(r, () => plugin.openMeetingFor(m));
          r.title = "Open this meeting";
        }
      },
    };

    let active = "Tasks";
    const drawTab = () => {
      body.empty();
      for (const t of tabs.children) t.toggleClass("is-on", t.getText() === active);
      panels[active]();
    };
    for (const name of Object.keys(panels)) {
      const t = el(tabs, "span", "lifeos-tab", name);
      t.onclick = () => { active = name; drawTab(); };
    }
    drawTab();
  }


  if (plugin.shows("home", "capture")) {
    /* ---- quick capture ---- */
    const qc = card(grid, "Quick Capture", "✎", "col1 span2");
    const input = qc.createEl("input", { cls: "lifeos-input lifeos-capture-input" });
    input.placeholder = "Capture a thought, note, task, meeting, or reference…";
    const qbar = el(qc, "div", "lifeos-capture-bar lifeos-capture-bar-left");

    const capture = async (kind) => {
      const v = input.value.trim();
      if (!v) { new Notice("Nothing to capture"); return; }

      if (kind === "task") {
        await plugin.tasks.add(v, { source: "Uptick" });
        new Notice("Added to Task Inbox");
      } else if (kind === "meeting") {
        const name = safeName(`${iso} - ${v}`);
        const path = `${P.meetings}/${name}.md`;
        if (!app.vault.getAbstractFileByPath(path)) {
          await app.vault.create(path, meetingScaffold(name, iso, null, null));
        }
        new Notice(`Created meeting note`);
        await plugin.open(path);
      } else {
        const folder = kind === "reference" ? P.knowledge : P.inbox;
        const name = safeName(v);
        const path = `${folder}/${name}.md`;
        if (app.vault.getAbstractFileByPath(path)) throw new Error("A note with that name exists");
        await plugin.store.ensureFolder(folder);
        await app.vault.create(path, [
          "---", `type: ${kind === "reference" ? "reference" : "note"}`,
          `created: ${iso}`, "---", "", `# ${name}`, "",
        ].join("\n"));
        new Notice(`Created in ${folder}`);
      }
      input.value = "";
      await refresh();
    };

    mkBtn(qbar, "Note", () => capture("note"));
    mkBtn(qbar, "Task", () => capture("task"), "primary");
    mkBtn(qbar, "Meeting", () => capture("meeting"));
    mkBtn(qbar, "Reference", () => capture("reference"));
  }


  if (plugin.shows("home", "email", "email")) {
    /* ---- today's email ---- */
    const em = card(grid, "Email today", "✉", "col3");
    renderEmailRows(plugin, em, emailsToday, "No email imported for today.", redraw, 8);
    const ema = el(em, "div", "lifeos-inline-actions");
    mkBtn(ema, "Import mail", async () => {
      new Notice("Importing mail… this can take a minute");
      await plugin.importMailDaily(true);
      await refresh();
    });
  }


  if (plugin.shows("home", "study", "study")) await studyCard(plugin, grid, "col3");

  /* ---- embedded web app: full width, under the capture row ---- */

  if (plugin.shows("home", "recurring", "meetings")) {
    /* ---- recent meetings ---- */
    const rm = card(grid, "Recent Meetings", "◐", "col3");
    if (!meetingNotes.length) el(rm, "div", "lifeos-empty", "No meeting notes yet.");
    for (const m of meetingNotes) {
      const r = el(rm, "div", "lifeos-linkrow");
      el(r, "span", "lifeos-ellipsis", m.f.basename);
      el(r, "span", "lifeos-task-due", String(m.fm.meeting_date ?? m.fm.date));
      onTap(r, () => plugin.open(m.f.path));
    }
  }


  if (plugin.shows("home", "projects")) {
    /* ---- active projects ---- */
    const ap = card(grid, "Active Projects", "◈", "col1");
    if (!projects.length) el(ap, "div", "lifeos-empty", "No active projects.");
    for (const p of projects.slice(0, 8)) {
      const r = el(ap, "div", "lifeos-linkrow");
      el(r, "span", "lifeos-ellipsis", p.f.basename);
      el(r, "span", "lifeos-chev", "›");
      onTap(r, () => plugin.open(p.f.path));
    }
  }


  if (plugin.shows("home", "recurring", "meetings")) {
    /* ---- recurring series ---- */
    const rs = card(grid, "Recurring Series", "↻", "col2");
    /* Importing the Exchange calendar took this from 3 series to 24, which turned
     * the card into a full-page list. Show the ones coming up soonest; the rest
     * are one click away in the manager. */
    const allSeries = plugin.recur.series()
      .map((s) => ({ s, next: plugin.recur.next(s, today), problem: plugin.recur.problem(s) }))
      .sort((a, b) => {
        if (a.problem !== b.problem) return a.problem ? 1 : -1;
        if (!a.next) return 1;
        if (!b.next) return -1;
        return a.next.valueOf() - b.next.valueOf();
      });
    const SERIES_SHOWN = 6;
    for (const { s, next, problem } of allSeries.slice(0, SERIES_SHOWN)) {
      const r = el(rs, "div", "lifeos-linkrow");
      el(r, "span", "lifeos-ellipsis", s.file.basename);
      el(r, "span", "lifeos-task-due",
        problem ? "misconfigured" :
        !next ? "—" :
        next.isSame(today, "day") ? "today" :
        next.isSame(today.clone().add(1, "day"), "day") ? "tomorrow" :
        next.format("ddd D MMM"));
      onTap(r, () => plugin.open(s.file.path));
    }
    if (allSeries.length > SERIES_SHOWN) {
      el(rs, "div", "lifeos-microlabel",
        `+ ${allSeries.length - SERIES_SHOWN} MORE`);
    }
    const rsa = el(rs, "div", "lifeos-inline-actions");
    mkBtn(rsa, `Manage all ${allSeries.length}`,
      () => plugin.open(`${P.recurring}/Recurring Meetings.md`));
  }


  if (plugin.shows("home", "notes")) {
    /* ---- recent notes ---- */
    const rn = card(grid, "Recent Notes", "▤", "col2");
    const recent = [...notes]
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 8);
    if (!recent.length) el(rn, "div", "lifeos-empty", "No notes yet.");
    for (const f of recent) {
      const r = el(rn, "div", "lifeos-linkrow");
      el(r, "span", "lifeos-ellipsis", f.basename);
      el(r, "span", "lifeos-task-due", moment(f.stat.mtime).format("D MMM"));
      onTap(r, () => plugin.open(f.path));
    }
    const rna = el(rn, "div", "lifeos-inline-actions");
    mkBtn(rna, "All notes →", () => plugin.open(`${P.knowledge}/Knowledge.md`));
  }


  if (plugin.shows("home", "areas")) {
    /* ---- areas of focus ---- */
    const areas = app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(P.areas + "/") && f.basename !== "Areas")
      .map((f) => ({ f, fm: app.metadataCache.getFileCache(f)?.frontmatter ?? {} }))
      .filter((x) => String(x.fm.status ?? "active").toLowerCase() !== "archived")
      .sort((a, b) => b.f.stat.mtime - a.f.stat.mtime);

    const ar = card(grid, "Areas of Focus", "▧", "col1");
    if (!areas.length) el(ar, "div", "lifeos-empty", "No areas configured yet.");
    for (const a of areas.slice(0, 8)) {
      const r = el(ar, "div", "lifeos-linkrow");
      el(r, "span", "lifeos-ellipsis", a.f.basename);
      el(r, "span", "lifeos-chev", "›");
      onTap(r, () => plugin.open(a.f.path));
    }
    if (areas.length > 8) {
      el(ar, "div", "lifeos-microlabel", `+ ${areas.length - 8} MORE`);
    }
    const ara = el(ar, "div", "lifeos-inline-actions");
    mkBtn(ara, "All areas →", () => plugin.open(`${P.areas}/Areas.md`));
  }


  /* ---- this week ---- */
  const tw = card(grid, "This Week", "▥", "col3");
  statRow(tw, "Tasks completed", doneThisWeek.length);
  statRow(tw, "Notes created", notesThisWeek.length);
  statRow(tw, "Meetings scheduled", countWeekMeetings(plugin, weekStart));
  statRow(tw, "Open tasks", openTasks.length);
  const twa = el(tw, "div", "lifeos-inline-actions");
  mkBtn(twa, `Week ${now.format("W")} review`, () => plugin.openWeekly(now));
  mkBtn(twa, now.format("MMM YYYY"), () => plugin.openMonthly(now));

  /* Reference. These links used to live as raw Markdown below the dashboard,
   * where they rendered in the default note style and read as a different
   * page. As a card they match everything above them. */
  if (plugin.shows("home", "reference")) {
    renderReference(plugin, grid, [
      ["Recurring series", `${P.recurring}/Recurring Meetings`, "standing meetings and their cadence"],
      ["Task dashboard", `${P.tasks}/Task Dashboard`, "every open task, grouped"],
      ["Kanban board", "2 Work/Tasks/Task List Kanban", "the same tasks as a board"],
      ["Task Inbox", P.taskInbox.replace(/\.md$/, ""), "the canonical task store"],
      ["Plugin reference", `${P.guides}/Obsidian Plugin Reference`, "how this vault's plugins are set up"],
      ["Second Brain guide", `${P.guides}/Second Brain`, "the operating manual"],
      ["Navigation page", "Home", "the original index"],
    ]);
  }


  if (plugin.shows("home", "sync")) await renderSync(plugin, grid, redraw, "col3");

  /* Last, and full width. A band closes the current row, so anywhere earlier
   * it would strand whichever lane was shorter. */
  if (plugin.shows("home", "web")) renderWebCard(plugin, grid, WEB_APPS.copilot, "span3");
}

/* Shared by Home and the daily view so both footers look identical. */
function renderReference(plugin, grid, links, cls = "col2") {
  const rf = card(grid, "Reference", "❯", cls);
  const list = el(rf, "div", "lifeos-reflist");
  for (const [label, target, hint] of links) {
    const row = el(list, "div", "lifeos-refitem");
    onTap(row, typeof target === "function"
      ? target
      : () => plugin.open(`${target}.md`));
    el(row, "span", "lifeos-refname", label);
    if (hint) el(row, "span", "lifeos-refhint", hint);
  }
}

function countWeekMeetings(plugin, weekStart) {
  let n = 0;
  for (let i = 0; i < 7; i++) n += plugin.recur.on(weekStart.clone().add(i, "day")).length;
  return n;
}

function renderCalendar(parent, day, plugin, todaysMeetings, opts = {}) {
  const today = moment().startOf("day");
  const grid = el(parent, "div", "lifeos-cal");
  for (const d of ["S", "M", "T", "W", "T", "F", "S"]) {
    el(grid, "div", "lifeos-cal-dow", d);
  }
  const first = day.clone().startOf("month");
  const lead = first.day(); // 0 = Sunday
  for (let i = 0; i < lead; i++) el(grid, "div", "lifeos-cal-pad");

  const week = opts.highlightWeek ? opts.highlightWeek.clone().startOf("isoWeek") : null;
  const days = day.daysInMonth();
  for (let n = 1; n <= days; n++) {
    const d = day.clone().date(n);
    const cell = el(grid, "div", "lifeos-cal-day", String(n));
    if (d.isSame(today, "day")) cell.addClass("is-today");
    if (week && d.isSame(week, "isoWeek")) cell.addClass("in-week");
    if (plugin.recur.on(d).length) cell.addClass("has-events");
    onTap(cell, () => plugin.openDaily(d));
  }

  if (todaysMeetings.length) {
    /* Accepts the merged {time,title} shape used by Home, and tolerates a raw
     * series object so other callers do not have to pre-flatten. */
    const list = el(parent, "div", "lifeos-cal-list");
    for (const m of todaysMeetings) {
      const time = m.time ?? m.fm?.time ?? null;
      const title = m.title ?? m.file?.basename ?? "—";
      const r = el(list, "div", "lifeos-schedrow");
      el(r, "span", "lifeos-time", fmtTime(time) ?? "—");
      el(r, "span", "lifeos-ellipsis", title);
      if (m.kind === "calendar") el(r, "span", "lifeos-badge lifeos-badge-cal", "Calendar");
    }
  }
}

/* A stat tile. Pass `onClick` to make it open the view behind the number, or
 * an editor for a value the number represents. `hint` becomes the tooltip and
 * replaces the sub-label on hover so the action is discoverable. */
/* Base XP by difficulty. Mirrors DIFF_BASE_XP in priority-task-sync.py and
 * BASE_XP in xp-sync.py; those two own the numbers, this only displays them. */
const DIFF_XP = { 1: 10, 2: 25, 3: 50, 4: 100, 5: 200 };
const DIFF_NAME = { 1: "Trivial", 2: "Small", 3: "Standard", 4: "Hard", 5: "Epic" };

/* The "D3 · 50 XP" chip on a task row. Silent when a task has no difficulty
 * yet, rather than guessing one. */
function diffPill(parent, task) {
  const d = task?.difficulty;
  if (!d) return null;
  const pill = el(parent, "span", `lifeos-diff lifeos-diff-${d}`);
  el(pill, "span", "lifeos-diff-level", `D${d}`);
  el(pill, "span", "lifeos-diff-xp", `${DIFF_XP[d]} XP`);
  const mark = task.difficultyMark === "!" ? " (set by hand)"
             : task.difficultyMark === "~" ? " (AI-refined)" : "";
  pill.setAttribute("aria-label", `Difficulty ${d} of 5, ${DIFF_NAME[d]}${mark}`);
  pill.setAttribute("title", `${DIFF_NAME[d]} — worth ${DIFF_XP[d]} XP${mark}`);
  return pill;
}



/* ------------------------------------------------------------------- game */

/* The XP layer's read side. Everything here is derived by xp-sync.py and
 * written to Markdown (plus one generated JSON cache, the same arrangement
 * calendar-cache.json and weather-cache.json already use). The plugin never
 * computes XP — if a number is wrong, it is wrong in the ledger. */
class Game {
  constructor(app) {
    this.app = app;
    this._cache = null;
    this._cacheAt = 0;
  }

  /* Level, total XP and streak, from Character.md's frontmatter. */
  character() {
    const f = this.app.vault.getAbstractFileByPath(P.character);
    if (!f) return null;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const level = Number(fm.level) || 1;
    const total = Number(fm.total_xp) || 0;
    const floor = level <= 1 ? 0 : 50 * level * level + 50 * level;
    const next = 50 * (level + 1) * (level + 1) + 50 * (level + 1);
    return {
      level, total,
      streak: Number(fm.streak) || 0,
      rank: rankFor(level),
      floor, next,
      into: Math.max(0, total - floor),
      need: Math.max(1, next - floor),
    };
  }

  /* Every ledger row, cached against the file's mtime. Several panels ask for
   * it in one draw, and each uncached read was another async gap for the
   * editor to measure a half-built widget across. */
  async ledger() {
    const f = this.app.vault.getAbstractFileByPath(P.ledger);
    if (!f) return [];
    if (this._ledger && this._ledgerAt === f.stat.mtime) return this._ledger;
    const raw = await this.app.vault.cachedRead(f);
    const out = [];
    for (const line of raw.split("\n")) {
      const m = line.trim().match(
        /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([+-]?\d+)\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*`([^`]+)`\s*\|$/);
      if (m) out.push({ date: m[1], xp: Number(m[2]), kind: m[3], detail: m[4], id: m[5] });
    }
    this._ledger = out;
    this._ledgerAt = f.stat.mtime;
    return out;
  }

  /* Load everything the dashboards read, in parallel, before any DOM is built.
   *
   * The panels below still await, but against a warm cache those resolve in a
   * microtask rather than a file read. That matters more than it sounds: each
   * real async gap mid-render let CodeMirror measure a partially-built widget,
   * and every later growth spurt fired a re-measure that threw the scroll
   * position back to the top of the note. */
  async warm() {
    await Promise.all([this.quest(), this.achievements(), this.ledger()]);
  }

  /* One day's slice: what it earned, what it lost, and what it unlocked. */
  async day(iso) {
    const rows = (await this.ledger()).filter((e) => e.date === iso);
    const earned = rows.filter((e) => e.xp > 0).reduce((a, e) => a + e.xp, 0);
    const lost = rows.filter((e) => e.xp < 0).reduce((a, e) => a + e.xp, 0);
    const byKind = {};
    for (const e of rows) byKind[e.kind] = (byKind[e.kind] ?? 0) + e.xp;
    return {
      rows, earned, lost, net: earned + lost, byKind,
      unlocked: rows.filter((e) => e.kind === "achievement"),
    };
  }

  /* The catalog with progress, written by xp-sync.py. Re-read when the file
   * changes rather than on every redraw — this is the one big blob. */
  async achievements() {
    const f = this.app.vault.getAbstractFileByPath(P.achCache);
    if (!f) return null;
    if (this._cache && this._cacheAt === f.stat.mtime) return this._cache;
    try {
      this._cache = JSON.parse(await this.app.vault.cachedRead(f));
      this._cacheAt = f.stat.mtime;
    } catch (e) {
      return null;
    }
    /* Condition wording is static text that lives in the Achievements note.
     * Baking it into the cache means a cache written before the note -- or by
     * an engine that did not read it -- leaves every tile saying nothing about
     * how it is earned. Read it here instead, so it is right whatever wrote
     * the cache and whenever. */
    const conditions = await this.conditions();
    if (conditions && this._cache?.achievements) {
      for (const a of this._cache.achievements) {
        if (!a.condition && conditions[a.slug]) a.condition = conditions[a.slug];
      }
    }
    return this._cache;
  }

  /* slug -> how it is earned, parsed from the catalog note. */
  async conditions() {
    const f = this.app.vault.getAbstractFileByPath(P.achievements);
    if (!f) return null;
    if (this._cond && this._condAt === f.stat.mtime) return this._cond;
    try {
      this._cond = Engine.achievementConditions(await this.app.vault.cachedRead(f));
      this._condAt = f.stat.mtime;
    } catch (e) {
      return null;
    }
    return this._cond;
  }

  /* Readiness, bank, overdue and XP-by-source, written by xp-sync.py. */
  async quest() {
    const f = this.app.vault.getAbstractFileByPath(P.questCache);
    if (!f) return null;
    if (this._quest && this._questAt === f.stat.mtime) return this._quest;
    try {
      this._quest = JSON.parse(await this.app.vault.cachedRead(f));
      this._questAt = f.stat.mtime;
    } catch (e) {
      return null;
    }
    return this._quest;
  }

  /* Artwork is optional and supplied by hand at 4 System/Game/Achievement Art/
   * <slug>.<ext>. Missing art is normal, not an error — the popup falls back
   * to a tier medallion. */
  /* Is any artwork installed at all? Cached: this is asked once per render and
   * the answer only changes when someone unzips a folder. */
  hasArt() {
    if (this._hasArt === undefined) {
      const folder = this.app.vault.getAbstractFileByPath(P.achArt);
      this._hasArt = !!(folder && folder.children
        && folder.children.some((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name || "")));
    }
    return this._hasArt;
  }

  artFor(slug) {
    for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "svg"]) {
      const f = this.app.vault.getAbstractFileByPath(`${P.achArt}/${slug}.${ext}`);
      if (f) return this.app.vault.getResourcePath(f);
    }
    return null;
  }
}

const RANKS = [[100, "Ascended"], [75, "Legend"], [60, "Luminary"], [50, "Distinguished"],
               [40, "Principal"], [30, "Architect"], [20, "Specialist"],
               [10, "Technician"], [1, "Operator"]];

function rankFor(level) {
  for (const [floor, name] of RANKS) if (level >= floor) return name;
  return "Operator";
}

const TIER_ORDER = ["Bronze", "Silver", "Gold", "Platinum", "Mythic", "Hidden"];
const TIER_GLYPH = { Bronze: "\u25C6", Silver: "\u25C6", Gold: "\u25C6",
                     Platinum: "\u2726", Mythic: "\u2739", Hidden: "\u25C7" };

/* A progress bar. Shared by the XP header, the day card, and the browser so
 * they cannot drift apart visually. */
function progressBar(parent, fraction, cls = "") {
  const track = el(parent, "div", `lifeos-bar ${cls}`.trim());
  const fill = el(track, "div", "lifeos-bar-fill");
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return track;
}


/* The XP header on Home: rank, level, bar to next, and the day's standing.
 * Wide by design — it is the first thing the page says. */
async function xpHero(plugin, root, iso = null) {
  const c = plugin.game.character();
  if (!c) return;
  /* Scoped to a date so a daily note from last week shows that week's numbers
   * rather than today's. Level and streak are always current — they are state,
   * not something a past day can own. */
  const target = iso ?? moment().format("YYYY-MM-DD");
  const isToday = target === moment().format("YYYY-MM-DD");
  const day = await plugin.game.day(target);
  const cat = await plugin.game.achievements();

  const hero = el(root, "div", "lifeos-hero");

  const left = el(hero, "div", "lifeos-hero-main");
  const crest = el(left, "div", "lifeos-hero-crest");
  el(crest, "div", "lifeos-hero-level", String(c.level));
  el(crest, "div", "lifeos-hero-levellabel", "LEVEL");

  const body = el(left, "div", "lifeos-hero-body");
  const top = el(body, "div", "lifeos-hero-top");
  el(top, "span", "lifeos-hero-rank", c.rank);
  el(top, "span", "lifeos-hero-total", `${c.total.toLocaleString()} XP`);
  if (c.streak) el(top, "span", "lifeos-hero-streak", `${c.streak}-day streak`);
  progressBar(body, c.into / c.need, "lifeos-bar-lg");
  el(body, "div", "lifeos-hero-sub",
    `${c.into.toLocaleString()} / ${c.need.toLocaleString()} to level ${c.level + 1}`);

  /* Today reads as a ledger line rather than a single number: a day that
   * earned 120 and lost 40 is a different day from one that earned 80. */
  const stats = el(hero, "div", "lifeos-hero-stats");
  heroStat(stats, isToday ? "Today" : "That day", day.net >= 0 ? `+${day.net}` : String(day.net),
    day.lost ? `+${day.earned} earned, ${day.lost} decay` : "XP", day.net < 0 ? "neg" : "");
  const total = cat?.total ?? 0;
  const got = cat?.unlocked ?? 0;
  heroStat(stats, "Achievements", `${got}`, `of ${total}`, "", () => plugin.open(P.achievements));
  heroStat(stats, "Quest Log", "\u2192", "readiness & goals", "", () => plugin.open(P.quest));

  onTap(crest, () => plugin.open(P.character));

  /* The three nearest achievements. A wall of locked badges says nothing;
   * "you are 7 tasks from Warmed Up" is the part that pulls. */
  if (cat) {
    const near = cat.achievements
      .filter((a) => !a.unlocked && !a.manual && a.progress > 0 && a.progress < 1)
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 3);
    if (near.length) {
      const strip = el(hero, "div", "lifeos-hero-near");
      el(strip, "div", "lifeos-microlabel", "CLOSEST");
      for (const a of near) {
        const row = el(strip, "div", "lifeos-nearrow");
        const head = el(row, "div", "lifeos-nearhead");
        el(head, "span", "lifeos-nearname", a.name);
        el(head, "span", "lifeos-nearpct",
          `${fmtNum(a.have)} / ${fmtNum(a.need)}`);
        progressBar(row, a.progress);
      }
      onTap(strip, () => plugin.open(P.achievements));
    }
  }
}

function heroStat(parent, label, value, sub, cls = "", onClick) {
  const box = el(parent, "div", `lifeos-herostat ${cls}`.trim());
  el(box, "div", "lifeos-microlabel", label.toUpperCase());
  el(box, "div", "lifeos-herostat-value", value);
  el(box, "div", "lifeos-herostat-sub", sub);
  if (onClick) {
    box.addClass("is-clickable");
    onTap(box, onClick);
  }
  return box;
}

function fmtNum(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 10) / 10);
}

/* The day's XP on a daily note: what it earned, where from, and what it
 * unlocked. Scoped to that date, so past days keep their own numbers. */
async function dayXpCard(plugin, grid, iso, cls = "col3") {
  const day = await plugin.game.day(iso);
  const cat = await plugin.game.achievements();
  const c = card(grid, "Experience", "\u25C6", cls);

  const head = el(c, "div", "lifeos-dayxp");
  el(head, "div", `lifeos-dayxp-net ${day.net < 0 ? "is-neg" : ""}`.trim(),
    day.net >= 0 ? `+${day.net}` : String(day.net));
  el(head, "div", "lifeos-dayxp-label", "XP this day");

  if (!day.rows.length) {
    el(c, "div", "lifeos-empty", "Nothing earned yet on this day.");
  } else {
    const order = ["task", "study", "ritual", "milestone", "achievement", "decay"];
    const label = { task: "Tasks", study: "Study", ritual: "Rituals",
                    milestone: "Milestones", achievement: "Achievements",
                    decay: "Overdue decay" };
    for (const kind of order) {
      const v = day.byKind[kind];
      if (!v) continue;
      const r = el(c, "div", "lifeos-dayxp-row");
      el(r, "span", "lifeos-dayxp-kind", label[kind]);
      el(r, "span", `lifeos-dayxp-amt ${v < 0 ? "is-neg" : ""}`.trim(),
        v > 0 ? `+${v}` : String(v));
    }
  }

  if (day.unlocked.length) {
    el(c, "div", "lifeos-microlabel lifeos-dayxp-achhead", "UNLOCKED THIS DAY");
    for (const a of day.unlocked) {
      const slug = a.id.replace(/^ach:/, "");
      const row = el(c, "div", "lifeos-dayach");
      const art = plugin.game.artFor(slug);
      const badge = el(row, "div", "lifeos-dayach-badge");
      if (art) {
        const img = badge.createEl("img", { cls: "lifeos-dayach-img" });
        img.src = art;
      } else {
        el(badge, "span", null, "\u25C6");
      }
      const txt = el(row, "div", "lifeos-dayach-text");
      el(txt, "div", "lifeos-dayach-name", a.detail.replace(/\s*\([^)]*\)\s*$/, ""));
      const meta = cat?.achievements?.find((x) => x.slug === slug);
      el(txt, "div", "lifeos-dayach-cond", meta?.condition ?? "");
      onTap(row, () => plugin.showAchievement(slug));
    }
  }
}

/* The unlock celebration. Artwork if it exists, a tier medallion if not. */
/* What an achievement is and how it is earned.
 *
 * Distinct from AchievementModal, which celebrates a fresh unlock and says
 * "ACHIEVEMENT UNLOCKED" over a burst of rays. That is the wrong frame for
 * browsing something you have not earned. */
class AchievementDetail extends Modal {
  constructor(app, plugin, entry) {
    super(app);
    this.plugin = plugin;
    this.entry = entry;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("lifeos-achdetail");
    contentEl.empty();
    const a = this.entry;
    const tier = (a.tier || "Bronze").toLowerCase();

    const head = el(contentEl, "div", `lifeos-achdet-head lifeos-tier-${tier}`);
    const medal = el(head, "div",
      `lifeos-achdet-medal${a.unlocked ? " is-unlocked" : ""}`);
    const art = this.plugin.game.artFor(a.slug);
    if (art) {
      const img = medal.createEl("img", { cls: "lifeos-achdet-art" });
      img.src = art;
      img.alt = "";
    } else {
      el(medal, "span", "lifeos-achdet-glyph", TIER_GLYPH[a.tier] ?? "\u25C6");
    }
    const ht = el(head, "div", "lifeos-achdet-headtext");
    el(ht, "h2", "lifeos-achdet-name", a.name);
    const meta = el(ht, "div", "lifeos-achdet-meta");
    el(meta, "span", `lifeos-achdet-tier is-${tier}`, a.tier || "");
    if (a.category) el(meta, "span", "lifeos-achdet-cat", a.category);
    if (a.xp) el(meta, "span", "lifeos-achdet-xp", `+${fmtNum(a.xp)} XP`);

    el(contentEl, "div", "lifeos-achdet-label", "How to earn it");
    el(contentEl, "div", "lifeos-achdet-cond",
      a.condition || "No condition recorded for this one yet.");

    if (a.unlocked) {
      const won = el(contentEl, "div", "lifeos-achdet-won");
      el(won, "span", "lifeos-achdet-tick", "\u2713");
      el(won, "span", null, `Earned ${a.unlocked}`);
    } else if (a.manual) {
      const man = el(contentEl, "div", "lifeos-achdet-manual");
      el(man, "div", "lifeos-achdet-label", "Awarded by hand");
      el(man, "div", null,
        "The engine cannot see this one. Add it to the Unlocked column in the "
        + "Achievements note when you have earned it \u2014 it is on the honour "
        + "system by design.");
    } else {
      el(contentEl, "div", "lifeos-achdet-label", "Progress");
      const need = Number(a.need || 0);
      const have = Number(a.have || 0);
      progressBar(contentEl, need ? Math.min(1, have / need) : 0, "lifeos-bar-lg");
      const row = el(contentEl, "div", "lifeos-achdet-progrow");
      el(row, "span", "lifeos-achdet-count", `${fmtNum(have)} of ${fmtNum(need)}`);
      const left = Math.max(0, need - have);
      el(row, "span", "lifeos-achdet-left",
        left > 0 ? `${fmtNum(left)} to go` : "ready to unlock");
    }

    const actions = el(contentEl, "div", "lifeos-ach-actions");
    mkBtn(actions, "Open the catalog", () => {
      this.close();
      this.plugin.open(P.achievements);
    });
    mkBtn(actions, "Close", () => this.close(), "primary");
  }

  onClose() { this.contentEl.empty(); }
}

class AchievementModal extends Modal {
  constructor(app, plugin, entry, queue = []) {
    super(app);
    this.plugin = plugin;
    this.entry = entry;
    this.queue = queue;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("lifeos-achmodal");
    contentEl.empty();
    const a = this.entry;

    const wrap = el(contentEl, "div", `lifeos-ach-burst lifeos-ach-${(a.tier || "Bronze").toLowerCase()}`);
    el(wrap, "div", "lifeos-ach-rays");

    const art = this.plugin.game.artFor(a.slug);
    const medal = el(wrap, "div", "lifeos-ach-medal");
    if (art) {
      const img = medal.createEl("img", { cls: "lifeos-ach-art" });
      img.src = art;
      img.alt = a.name;
    } else {
      el(medal, "div", "lifeos-ach-glyph", TIER_GLYPH[a.tier] ?? "\u25C6");
    }

    el(wrap, "div", "lifeos-ach-eyebrow", "ACHIEVEMENT UNLOCKED");
    el(wrap, "h2", "lifeos-ach-name", a.name);
    el(wrap, "div", "lifeos-ach-tier", `${a.tier}${a.xp ? ` \u00B7 +${a.xp} XP` : ""}`);
    if (a.condition) el(wrap, "div", "lifeos-ach-cond", a.condition);

    const actions = el(contentEl, "div", "lifeos-ach-actions");
    if (this.queue.length) {
      el(actions, "div", "lifeos-ach-queue",
        `${this.queue.length} more unlocked`);
    }
    mkBtn(actions, "See all achievements", () => {
      this.close();
      this.plugin.open(P.achievements);
    });
    mkBtn(actions, this.queue.length ? "Next" : "Nice", () => this.close(), "primary");
  }

  onClose() {
    this.contentEl.empty();
    /* Chain the rest of the queue so a batch of unlocks plays one after the
     * other rather than stacking modals on top of each other. */
    if (this.queue.length) {
      const [next, ...rest] = this.queue;
      window.setTimeout(() => new AchievementModal(this.app, this.plugin, next, rest).open(), 180);
    }
  }
}

function tile(parent, label, value, sub, glyph, onClick, hint) {
  const t = el(parent, "div", "lifeos-tile");
  const h = el(t, "div", "lifeos-tile-head");
  el(h, "span", "lifeos-tile-glyph", glyph ?? "•");
  el(h, "span", "lifeos-tile-label", label);
  el(t, "div", "lifeos-tile-value", String(value));
  el(t, "div", "lifeos-tile-sub", sub);

  if (onClick) {
    t.addClass("is-clickable");
    if (hint) {
      t.setAttr("title", hint);
      el(t, "div", "lifeos-tile-hint", hint);
    }
    t.onclick = async () => {
      try {
        await onClick();
      } catch (e) {
        new Notice(String(e.message ?? e));
      }
    };
  }
  return t;
}

/* A label/value row. `onClick` makes the whole row open something. */
function statRow(parent, label, value, onClick) {
  const r = el(parent, "div", "lifeos-stat");
  el(r, "span", "lifeos-stat-label", label);
  el(r, "span", "lifeos-stat-value", String(value));
  if (onClick) {
    r.addClass("is-clickable");
    r.onclick = async () => {
      try {
        await onClick();
      } catch (e) {
        new Notice(String(e.message ?? e));
      }
    };
  }
  return r;
}

/* ---------------------------------------------------------- series editor */

const CADENCES = ["daily", "weekdays", "weekly", "biweekly", "monthly"];
const STATUSES = ["active", "needs-confirmation", "paused"];

/** Edit an existing series, or create one when `series` is null. */
async function editSeries(plugin, series) {
  const app = plugin.app;
  const fm = series?.fm ?? {};

  const values = await form(app, {
    title: series ? `Edit “${series.file.basename}”` : "New recurring series",
    help:
      "Cadence drives the agenda. `weekly` and `biweekly` need weekdays; " +
      "`monthly` needs a day of month; `biweekly` needs an anchor date in an “on” week.",
    cta: series ? "Save series" : "Create series",
    fields: [
      ...(series ? [] : [{ key: "name", label: "Name", type: "text",
        placeholder: "e.g. Team Daily Standup" }]),
      { key: "cadence", label: "Cadence", type: "select", options: CADENCES,
        value: String(fm.cadence ?? "weekly") },
      { key: "weekdays", label: "Weekdays", type: "weekdays", value: toArray(fm.weekdays),
        help: "Used by weekly, biweekly, and to narrow weekdays." },
      { key: "time", label: "Time", type: "text", value: String(fm.time ?? ""),
        placeholder: "07:30", help: "24-hour. Leave blank if it has no fixed time." },
      { key: "duration", label: "Duration (min)", type: "number",
        value: fm.duration ?? "" },
      { key: "attendees", label: "Attendees", type: "text",
        value: toArray(fm.attendees).join(", "), placeholder: "Comma separated" },
      { key: "day_of_month", label: "Day of month", type: "number",
        value: fm.day_of_month ?? "", help: "Monthly only." },
      { key: "anchor", label: "Anchor date", type: "text", value: String(fm.anchor ?? ""),
        placeholder: "YYYY-MM-DD", help: "Biweekly only — any date in an “on” week." },
      { key: "status", label: "Status", type: "select", options: STATUSES,
        value: String(fm.status ?? "active") },
    ],
  });
  if (!values) return null;

  const attendees = String(values.attendees ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const weekdays = toArray(values.weekdays);

  const fields = {
    type: "recurring-meeting",
    cadence: values.cadence,
    weekdays: `[${weekdays.join(", ")}]`,
    time: values.time ? `"${values.time}"` : "",
    duration: values.duration || "",
    attendees: `[${attendees.map((a) => JSON.stringify(a)).join(", ")}]`,
    day_of_month: values.day_of_month || "",
    anchor: values.anchor || "",
    status: values.status,
  };

  let file = series?.file;
  if (!file) {
    const name = safeName(values.name ?? "");
    if (!name) { new Notice("A series needs a name"); return null; }
    const path = `${P.recurring}/${name}.md`;
    if (app.vault.getAbstractFileByPath(path)) {
      new Notice("A series with that name already exists");
      return null;
    }
    await plugin.store.ensureFolder(P.recurring);
    file = await app.vault.create(path, [
      "---",
      "type: recurring-meeting",
      `series: ${slug(name)}`,
      ...Object.entries(fields)
        .filter(([k]) => k !== "type")
        .map(([k, v]) => `${k}: ${v}`),
      "project:",
      "cssclasses:", "  - life-os", "  - max",
      "---",
      "", `# ${name}`, "",
      "Standing series definition. Occurrences get their own notes; this note only",
      "describes when the meeting repeats.", "",
      "## Standing agenda", "", "## Notes", "",
    ].join("\n"));
    new Notice(`Created series “${name}”`);
  } else {
    for (const [k, v] of Object.entries(fields)) {
      await setFrontMatterRaw(app, file, k, v);
    }
    new Notice("Series updated");
  }
  return file;
}

/* Like setFrontMatter but writes the value verbatim (already YAML-formatted),
 * and REMOVES the key when the value is empty so stale fields don't linger. */
async function setFrontMatterRaw(app, file, key, rawValue) {
  const value = String(rawValue ?? "").trim();
  await app.vault.process(file, (data) => {
    if (!data.startsWith("---")) return data;
    const end = data.indexOf("\n---", 3);
    if (end === -1) return data;
    /* end points at the "\n" before the closing "---".
     * block keeps its LEADING newline and rest keeps the closing fence, so
     * "---" + block + rest reproduces the file exactly. Slicing at 4 / end+1
     * ate both newlines and welded the fences onto the first and last keys. */
    let block = data.slice(3, end);
    const rest = data.slice(end);
    /* Match the key plus any indented list lines that belong to it. */
    const re = new RegExp(`^${key}\\s*:.*(?:\\n[ \\t]+-.*)*$`, "m");
    if (value === "" || value === "[]") {
      block = re.test(block) ? block.replace(re, `${key}:`) : block;
    } else {
      block = re.test(block) ? block.replace(re, `${key}: ${value}`) : `${block}\n${key}: ${value}`;
    }
    return "---" + block + rest;
  });
}

async function renderSeriesView(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  const today = moment().startOf("day");
  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath, 800);
    await redraw();
  };

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Meetings", path: `${P.meetings}/Meetings.md` },
    { label: "Recurring series" },
  ]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", "Recurring series");
  el(ht, "div", "lifeos-sub",
    "Standing meetings. These drive the agenda on every daily and weekly view.");
  const acts = el(head, "div", "lifeos-head-actions");
  mkBtn(acts, "+ New series", async () => {
    const f = await editSeries(plugin, null);
    if (f) await refresh();
  }, "primary");

  const all = plugin.recur.series();
  if (!all.length) {
    el(root, "div", "lifeos-empty", "No recurring series yet.");
    return;
  }

  const unconfirmed = all.filter(
    (s) => String(s.fm.status ?? "").toLowerCase() === "needs-confirmation"
  );
  if (unconfirmed.length) {
    const warn = el(root, "div", "lifeos-callout");
    el(warn, "div", "lifeos-callout-title",
      `${unconfirmed.length} series still need confirming`);
    el(warn, "div", null,
      "Cadence and times were inferred from existing notes, not from a calendar. " +
      "Open each one, check the time and weekdays, then set status to active.");
  }

  const tiles = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(tiles, "Series", all.length, "defined", "↻",
    async () => { const f = await editSeries(plugin, null); if (f) await refresh(); },
    "Create a series");
  tile(tiles, "Active", all.filter((s) => String(s.fm.status ?? "active").toLowerCase() === "active").length, "on the agenda", "✓");
  tile(tiles, "Unconfirmed", unconfirmed.length, "need review", "⚠");
  tile(tiles, "Paused", all.filter((s) => String(s.fm.status ?? "").toLowerCase() === "paused").length, "hidden", "⏸");

  for (const s of all) {
    const problem = plugin.recur.problem(s);
    const next = problem ? null : plugin.recur.next(s, today);
    const status = String(s.fm.status ?? "active").toLowerCase();

    const c = el(root, "div", "lifeos-card lifeos-seriescard");
    const h = el(c, "div", "lifeos-cardhead");
    el(h, "span", "lifeos-cardglyph", "↻");
    el(h, "span", "lifeos-seriesname", s.file.basename);
    if (status === "needs-confirmation") {
      el(h, "span", "lifeos-badge lifeos-badge-warn", "unconfirmed");
    } else if (status === "paused") {
      el(h, "span", "lifeos-badge lifeos-badge-alt", "paused");
    }
    const ha = el(h, "div", "lifeos-meeting-actions");
    mkBtn(ha, "Edit", async () => {
      const f = await editSeries(plugin, s);
      if (f) await refresh();
    }, "primary");
    mkBtn(ha, status === "paused" ? "Resume" : "Pause", async () => {
      await setFrontMatterRaw(app, s.file, "status", status === "paused" ? "active" : "paused");
      await refresh();
    });
    mkBtn(ha, "Open", () => plugin.open(s.file.path));

    const dg = el(c, "div", "lifeos-detailgrid");
    detail(dg, "Cadence", s.fm.cadence ?? "—");
    detail(dg, "Weekdays", toArray(s.fm.weekdays).join(", ") || "—");
    detail(dg, "Time", fmtTime(s.fm.time) ?? "—");
    detail(dg, "Duration", s.fm.duration ? `${s.fm.duration} min` : "—");
    detail(dg, "Attendees", toArray(s.fm.attendees).join(", ") || "—");
    detail(dg, "Next", problem ? "never" :
      !next ? "—" :
      next.isSame(today, "day") ? "today" :
      next.isSame(today.clone().add(1, "day"), "day") ? "tomorrow" :
      next.format("ddd D MMM"));

    if (problem) {
      el(c, "div", "lifeos-inlinewarn", `Will never appear on an agenda — ${problem}.`);
    }
  }
}

/* ------------------------------------------------------- weekly / monthly */

const REVIEW_SECTIONS = {
  priorities: "Priorities",
  outcomes: "Outcomes",
  moved: "What moved forward",
  stalled: "What stalled",
  carry: "Carry forward",
};

/** Shared review-section editor used by both weekly and monthly. */
function reviewCard(plugin, grid, ctx, content, heading, glyph, cls, empty, refresh) {
  const c = card(grid, heading, glyph, cls);
  listOrEmpty(c, plugin.store.sectionItems(content, heading), empty);
  addRow(c, "+ Add", heading, async (v) => {
    await plugin.store.appendToSection(ctx.sourcePath, heading, `- ${v}`);
    await refresh();
  });
  return c;
}

async function renderWeekly(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const content = await app.vault.read(file);

  /* Prefer the filename (2026-W34) — it is the identity of the note. */
  let start = moment(file.basename, "GGGG-[W]WW", true);
  if (!start.isValid() && fm.week_start) start = moment(fm.week_start);
  if (!start.isValid()) start = moment();
  start = start.startOf("isoWeek");
  const end = start.clone().endOf("isoWeek");

  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath);
    await redraw();
  };

  await plugin.calendars.load();
  const tasks = await plugin.tasks.all();
  const inRange = (d) => d && d >= start.format("YYYY-MM-DD") && d <= end.format("YYYY-MM-DD");
  const done = tasks.filter((t) => t.done && inRange(t.doneOn));
  const open = tasks.filter((t) => !t.done);
  const openDue = open.filter((t) => t.due && t.due <= end.format("YYYY-MM-DD"));

  let meetingCount = 0;
  for (let i = 0; i < 7; i++) meetingCount += plugin.recur.on(start.clone().add(i, "day")).length;

  const notes = humanNotes(app, plugin).filter((f) => {
    const c = authoredOn(app, f);
    return c && c.isBetween(start, end, "day", "[]");
  });

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Weekly", path: `${P.weekly}/Weekly.md` },
    { label: file.basename },
  ]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", `Week ${start.format("W")} · ${start.format("GGGG")}`);
  el(ht, "div", "lifeos-sub", `${start.format("D MMM")} – ${end.format("D MMM YYYY")}`);
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "← Previous", () => plugin.openWeekly(start.clone().subtract(1, "week")));
  mkBtn(nav, start.format("MMMM YYYY"), () => plugin.openMonthly(start));
  mkBtn(nav, "Next →", () => plugin.openWeekly(start.clone().add(1, "week")));

  const tiles = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(tiles, "Completed", done.length, "this week", "✓",
    () => plugin.open(`${P.tasks}/Task Dashboard.md`), "Open task dashboard");
  tile(tiles, "Meetings", meetingCount, "scheduled", "▦",
    () => plugin.open(`${P.recurring}/Recurring Meetings.md`), "Manage series");
  tile(tiles, "Notes", notes.length, "written", "▤",
    () => plugin.open(`${P.knowledge}/Knowledge.md`), "Open knowledge");
  tile(tiles, "Open loops", openDue.length, "due by Sunday", "☑",
    () => plugin.open(P.taskInbox), "Open Task Inbox");

  const grid = el(root, "div", "lifeos-grid");

  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.priorities, "◎", "col1",
    "No priorities set for the week.", refresh);

  /* days */
  const days = card(grid, "The week", "▦", "col2 span2");
  for (let i = 0; i < 7; i++) {
    const d = start.clone().add(i, "day");
    const list = plugin.recur.on(d);
    const row = el(days, "div", "lifeos-weekday");
    const lab = el(row, "div", "lifeos-weekday-label");
    el(lab, "span", null, d.format("ddd D MMM"));
    if (d.isSame(moment(), "day")) el(lab, "span", "lifeos-badge", "today");
    const dl = el(row, "div", "lifeos-weekday-items");
    const evs = plugin.calendars.on(d);
    if (!list.length && !evs.length) el(dl, "span", "lifeos-muted", "—");
    for (const s of list) {
      const chip = el(dl, "span", "lifeos-chip", `${fmtTime(s.fm.time) ?? "—"} ${s.file.basename}`);
      onTap(chip, () => plugin.open(s.file.path));
    }
    for (const e of evs) {
      el(dl, "span", "lifeos-chip lifeos-chip-cal",
        `${e.all_day ? "all day" : fmtTime(e.start)} ${e.title}`);
    }
    onTap(row, (e) => { if (e.target === row || e.target === lab) plugin.openDaily(d); });
  }

  /* completed */
  const dc = card(grid, "Completed this week", "✓", "col1");
  if (!done.length) el(dc, "div", "lifeos-empty", "Nothing completed yet.");
  for (const t of done.slice(0, 12)) {
    const r = el(dc, "div", "lifeos-task");
    el(r, "span", "lifeos-task-dot").style.background = "var(--los-faint)";
    el(r, "span", "lifeos-task-text", t.text);
    el(r, "span", "lifeos-task-due", t.doneOn);
  }

  /* open loops */
  const ol = card(grid, "Open loops", "☑", "col2");
  if (!openDue.length) el(ol, "div", "lifeos-empty", "Nothing due this week.");
  for (const t of openDue.slice(0, 12)) {
    const r = el(ol, "div", "lifeos-task");
    el(r, "span", "lifeos-task-dot");
    el(r, "span", "lifeos-task-text", t.text);
    el(r, "span", "lifeos-task-due", t.due);
  }

  /* month calendar, with this week highlighted */
  const cal = card(grid, start.format("MMMM YYYY"), "▤", "col3");
  renderCalendar(cal, start, plugin, [], { highlightWeek: start });

  /* daily notes */
  const dn = card(grid, "Daily notes", "▤", "col3");
  for (let i = 0; i < 7; i++) {
    const d = start.clone().add(i, "day");
    const path = `${P.daily}/${d.format("YYYY-MM-DD")}.md`;
    const exists = !!app.vault.getAbstractFileByPath(path);
    const r = el(dn, "div", "lifeos-linkrow");
    el(r, "span", "lifeos-ellipsis", d.format("ddd D MMM"));
    el(r, "span", exists ? "lifeos-chev" : "lifeos-muted", exists ? "›" : "create");
    onTap(r, () => plugin.openDaily(d));
  }

  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.moved, "↗", "col1",
    "Nothing recorded.", refresh);
  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.stalled, "⏸", "col2",
    "Nothing recorded.", refresh);
  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.carry, "→", "col3",
    "Nothing to carry forward.", refresh);
}

async function renderMonthly(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  const content = await app.vault.read(file);

  let start = moment(file.basename, "YYYY-MM", true);
  if (!start.isValid()) start = moment().startOf("month");
  start = start.startOf("month");
  const end = start.clone().endOf("month");

  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath);
    await redraw();
  };

  const tasks = await plugin.tasks.all();
  const inRange = (d) => d && d >= start.format("YYYY-MM-DD") && d <= end.format("YYYY-MM-DD");
  const done = tasks.filter((t) => t.done && inRange(t.doneOn));

  const notes = humanNotes(app, plugin).filter((f) => {
    const c = authoredOn(app, f);
    return c && c.isBetween(start, end, "day", "[]");
  });

  /* meeting load per series across the month */
  const load = new Map();
  let total = 0;
  for (let d = start.clone(); d.isSameOrBefore(end, "day"); d.add(1, "day")) {
    for (const s of plugin.recur.on(d)) {
      load.set(s.file.basename, (load.get(s.file.basename) ?? 0) + 1);
      total++;
    }
  }
  const loadRows = [...load.entries()].sort((a, b) => b[1] - a[1]);

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Monthly", path: `${P.monthly}/Monthly.md` },
    { label: file.basename },
  ]);

  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", start.format("MMMM YYYY"));
  el(ht, "div", "lifeos-sub", `${start.format("D MMM")} – ${end.format("D MMM")}`);
  const nav = el(head, "div", "lifeos-head-actions");
  mkBtn(nav, "← Previous", () => plugin.openMonthly(start.clone().subtract(1, "month")));
  mkBtn(nav, "Next →", () => plugin.openMonthly(start.clone().add(1, "month")));

  const tiles = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(tiles, "Completed", done.length, "this month", "✓",
    () => plugin.open(`${P.tasks}/Task Dashboard.md`), "Open task dashboard");
  tile(tiles, "Meetings", total, "scheduled", "▦",
    () => plugin.open(`${P.recurring}/Recurring Meetings.md`), "Manage series");
  tile(tiles, "Notes", notes.length, "written", "▤",
    () => plugin.open(`${P.knowledge}/Knowledge.md`), "Open knowledge");
  tile(tiles, "Series", loadRows.length, "active", "↻",
    () => plugin.open(`${P.recurring}/Recurring Meetings.md`), "Manage series");

  const grid = el(root, "div", "lifeos-grid");

  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.outcomes, "◈", "col1",
    "No outcomes recorded.", refresh);
  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.priorities, "◎", "col2",
    "No priorities set.", refresh);

  const ml = card(grid, "Meeting load by series", "▦", "col3");
  if (!loadRows.length) el(ml, "div", "lifeos-empty", "No recurring meetings this month.");
  for (const [name, n] of loadRows) statRow(ml, name, n);

  const wk = card(grid, "Weeks", "▤", "col1");
  const firstWeek = start.clone().startOf("isoWeek");
  for (let w = firstWeek.clone(); w.isSameOrBefore(end, "day"); w.add(1, "week")) {
    const week = w.clone(); // capture: `w` is mutated by the loop
    const r = el(wk, "div", "lifeos-linkrow");
    el(r, "span", "lifeos-ellipsis", `Week ${week.format("W")} · ${week.format("D MMM")}`);
    el(r, "span", "lifeos-chev", "›");
    onTap(r, () => plugin.openWeekly(week));
  }

  const dc = card(grid, "Completed this month", "✓", "col2 span2");
  if (!done.length) el(dc, "div", "lifeos-empty", "Nothing completed yet.");
  for (const t of done.slice(0, 20)) {
    const r = el(dc, "div", "lifeos-task");
    el(r, "span", "lifeos-task-dot").style.background = "var(--los-faint)";
    el(r, "span", "lifeos-task-text", t.text);
    el(r, "span", "lifeos-task-due", t.doneOn);
  }

  reviewCard(plugin, grid, ctx, content, REVIEW_SECTIONS.carry, "→", "col1",
    "Nothing to carry forward.", refresh);
}

/* ---------------------------------------------------------------- email UI */

async function renderEmail(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  const info = plugin.emails.info(file);
  const content = await app.vault.read(file);
  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath);
    await redraw();
  };

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Email" },
    { label: info.subject },
  ]);

  const banner = el(root, "div", "lifeos-banner");
  const bl = el(banner, "div", null);
  el(bl, "div", "lifeos-banner-kicker", "EMAIL REFERENCE");
  el(bl, "h1", "lifeos-h1", info.subject);
  el(bl, "div", "lifeos-sub",
    [info.sender, info.received ? info.received.format("ddd D MMM, HH:mm") : info.date]
      .filter(Boolean).join(" · "));

  const br = el(banner, "div", "lifeos-banner-actions");
  if (info.messageId) {
    /* Not a message:// URL — the stored id is the MCP's synthetic
     * "Account|Mailbox|id", which Mail cannot resolve (error 1030). AppleScript
     * looks the message up directly, falling back to the subject. */
    mkBtn(br, "Open original in Mail", async () => {
      const res = await plugin.runOsa("mail-open.applescript", [info.messageId, info.subject]);
      const out = (res.stdout || "").trim();
      if (!out.startsWith("opened")) {
        new Notice(out === "not found"
          ? "Mail could not find that message — it may have been moved or deleted"
          : (res.stderr || "Could not open Mail").slice(0, 150));
      }
    }, "primary");
  }
  if (info.meeting) {
    mkBtn(br, "Open meeting", () => {
      const t = info.meeting.replace(/^\[\[|\]\]$/g, "");
      const hit = app.metadataCache.getFirstLinkpathDest(t, file.path);
      if (hit) plugin.open(hit.path);
      else new Notice("Linked meeting not found");
    });
  }
  if (info.date) {
    mkBtn(br, "Open that day", () => plugin.openDaily(moment(info.date, "YYYY-MM-DD")));
  }
  /* Vault-local flag; Mail.app's own read state is untouched. */
  mkBtn(br, info.read ? "Mark unread" : "Mark read", async () => {
    await plugin.emails.setRead(file, !info.read);
    await refresh();
  });

  const actions = plugin.store.sectionItems(content, "Action Items")
    .filter((a) => !/^\*?none detected/i.test(a));

  const tiles = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(tiles, "Received", info.received ? info.received.format("MMM D") : info.date,
    info.received ? fmtTime(info.received) : "", "▤");
  tile(tiles, "From", info.sender.replace(/<.*?>/, "").trim() || "—", info.account, "◐");
  tile(tiles, "Actions", actions.length, "detected", "☑",
    async () => {
      const v = await prompt(app, {
        title: "Add action item",
        help: `Written to ${P.taskInbox}, sourced from this email.`,
        placeholder: "What needs doing?",
        cta: "Add to Task Inbox",
      });
      if (!v || !v.trim()) return;
      await plugin.tasks.add(v.trim(), { source: file.basename });
      new Notice("Added to Task Inbox");
      await refresh();
    }, "Add an action item");
  tile(tiles, "Meeting", info.meeting ? "linked" : "—",
    info.meeting ? info.meeting.replace(/^\[\[|\]\]$/g, "") : "not linked", "▦");

  const sum = card(root, "Summary", "◈");
  el(sum, "div", "lifeos-microlabel", "EXTRACTED FROM THE MESSAGE — NOT AN AUTHORED SUMMARY");
  const summary = plugin.store.sectionLines(content, "Summary").join("\n").trim();
  if (summary) el(sum, "div", "lifeos-prose", summary);
  else el(sum, "div", "lifeos-empty", "No summary captured.");

  renderPeople(root, info);

  const grid = el(root, "div", "lifeos-grid lifeos-grid-2");

  const ac = card(grid, "Action Items", "☑");
  listOrEmpty(ac, actions, "No action items detected.");
  addRow(ac, "+ Send to Task Inbox", "Task text", async (v) => {
    await plugin.tasks.add(v, { source: file.basename });
    new Notice("Added to Task Inbox");
    await refresh();
  });

  const nc = card(grid, "Notes", "▤");
  listOrEmpty(nc, plugin.store.sectionItems(content, "Notes"), "No notes yet.");
  addRow(nc, "+ Add Note", "Your note on this email", async (v) => {
    await plugin.store.appendToSection(ctx.sourcePath, "Notes", `- ${v}`);
    await refresh();
  });

  /* The body is stored under "## Message" as a blockquote callout so the raw
   * note stays readable on its own. Strip the callout marker and the quote
   * prefixes to get the message back exactly as it arrived. */
  const messageBody = plugin.store.sectionLines(content, "Message")
    .filter((l) => !/^>\s*\[!\w+\]/.test(l.trim()))
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .replace(/^\s*\n+|\n+\s*$/g, "");

  const msg = card(root, "Message", "✉");
  if (messageBody) {
    el(msg, "div", "lifeos-microlabel", "FULL MESSAGE AS RECEIVED");
    renderMessageBody(msg, messageBody);
  } else {
    el(msg, "div", "lifeos-empty",
      "No message body stored. Re-run the mail import to fetch it.");
  }

  /* Provenance used to be its own card saying only that the body lived
   * elsewhere. It now sits under the body it describes. */
  const foot = el(msg, "div", "lifeos-messagefoot");
  el(foot, "span", null, "Mail.app remains the system of record.");
  if (info.messageId) el(foot, "span", "lifeos-microlabel", `MAIL REFERENCE ${info.messageId}`);
}

/* Who was on the message. Mail hands recipients over as "Display Name <addr>"
 * or, when there is no display name, just the address — so the name falls back
 * to the local part rather than showing an empty chip. */
function personChip(parent, raw) {
  const s = String(raw).trim();
  const m = s.match(/^(.*?)\s*<([^>]*)>$/);
  let name = (m ? m[1] : s).trim().replace(/^"|"$/g, "");
  const addr = (m ? m[2] : "").trim();
  if (!name) name = addr.split("@")[0] || addr;
  const chip = el(parent, "div", "lifeos-person");
  el(chip, "span", "lifeos-person-name", name);
  if (addr && addr.toLowerCase() !== name.toLowerCase()) {
    el(chip, "span", "lifeos-person-addr", addr);
  }
}

function peopleRow(parent, label, list) {
  if (!list.length) return;
  const row = el(parent, "div", "lifeos-people-row");
  el(row, "div", "lifeos-people-label", label);
  const wrap = el(row, "div", "lifeos-people-list");
  for (const r of list) personChip(wrap, r);
}

function renderPeople(root, info) {
  const anyone = info.sender || info.to.length || info.cc.length;
  const c = card(root, "People", "◍");
  if (!anyone) {
    el(c, "div", "lifeos-empty", "No recipients recorded for this message.");
    return c;
  }
  peopleRow(c, "FROM", info.sender ? [info.sender] : []);
  peopleRow(c, "TO", info.to);
  peopleRow(c, "CC", info.cc);
  if (!info.to.length && !info.cc.length) {
    /* Bulk and list mail arrives with no To header at all, so an empty list is
     * the honest answer rather than a missing import. */
    el(c, "div", "lifeos-microlabel", info.hasRecipientData
      ? "NO NAMED RECIPIENTS — SENT AS BULK OR BCC"
      : "RECIPIENTS NOT CAPTURED — RE-RUN THE MAIL IMPORT");
  }
  return c;
}

/* Render a section that carries "###" subheadings, keeping the grouping.
 * Imported meeting summaries arrive as headed groups of bullets; flattening
 * them into one list loses the structure that makes them readable. Falls back
 * to a plain list when the section has no subheadings. */
function renderGrouped(parent, lines, empty) {
  const groups = [];
  let cur = null;
  for (const raw of lines) {
    const line = String(raw);
    const h = line.match(/^#{3,6}\s+(.*)$/);
    if (h) {
      cur = { head: h[1].trim(), items: [] };
      groups.push(cur);
      continue;
    }
    const s = line.trim();
    if (!s) continue;
    const item = s.replace(/^[-*]\s+(\[[ xX]\]\s*)?/, "");
    if (!item) continue;
    const indented = /^\s+[-*]\s/.test(line);
    if (!cur) { cur = { head: null, items: [] }; groups.push(cur); }
    cur.items.push({ text: item, sub: indented });
  }
  const any = groups.some((g) => g.items.length);
  if (!any) {
    el(parent, "div", "lifeos-empty", empty);
    return;
  }
  for (const g of groups) {
    if (!g.items.length) continue;
    if (g.head) el(parent, "div", "lifeos-groophead", g.head);
    const list = el(parent, "div", "lifeos-list");
    for (const i of g.items) {
      setRich(el(list, "div", `lifeos-listitem${i.sub ? " is-sub" : ""}`), i.text);
    }
  }
}

/* Lay a raw email body out readably.
 *
 * This is presentation only — the note on disk keeps the message verbatim.
 * Mail hands us plain text with the structure already flattened, which reads
 * badly dumped into a single block:
 *   - U+FFFC is the object-replacement character left where an inline image
 *     was; rendered it shows as a stray box in the middle of a sentence.
 *   - Runs of blank lines open holes; a run of short lines (a flattened table)
 *     needs to stay together instead.
 *   - Bare tracking URLs are hundreds of characters and blow out the column.
 *
 * Blank lines separate paragraphs; consecutive lines stay in one block with
 * their breaks intact, which suits both prose mail and flattened tables.
 *
 * URLs are deliberately rendered as inert text, not links. This is untrusted
 * content from outside the vault, and a one-click link out of a dashboard is
 * exactly how a phishing address gets followed by accident. Select and copy. */
function renderMessageBody(parent, raw) {
  const box = el(parent, "div", "lifeos-messagebody");
  const cleaned = String(raw)
    .replace(/\uFFFC/g, "")
    .replace(/[ \t]+$/gm, "");

  let block = [];
  let quoted = false;

  const flush = () => {
    if (!block.length) return;
    const text = block.join("\n").replace(/^\s+|\s+$/g, "");
    const wasQuoted = quoted;
    block = [];
    if (!text) return;
    if (wasQuoted) {
      el(box, "div", "lifeos-msg-quote", text.replace(/^>+\s?/gm, ""));
      return;
    }
    if (/^https?:\/\/\S+$/.test(text)) {
      el(box, "div", "lifeos-msg-url", text);
      return;
    }
    el(box, "p", "lifeos-msg-p", text);
  };

  for (const line of cleaned.split("\n")) {
    if (!line.trim()) { flush(); continue; }
    const isQuote = /^>+\s?/.test(line);
    /* A change of kind ends the block, so quoted and plain never merge. */
    if (block.length && isQuote !== quoted) flush();
    quoted = isQuote;
    block.push(line);
  }
  flush();

  if (!box.childElementCount) el(box, "div", "lifeos-empty", "Message body is empty.");
  return box;
}

/* ---- transcript ----------------------------------------------------------
 *
 * Granola stores the transcript as a JSON blob pasted into the note, with the
 * spoken text as one escaped string inside it — thousands of words on a single
 * line, \u0027 instead of an apostrophe. Rendered raw it is unreadable, which
 * is why it lived behind a link.
 *
 * This pulls the string out, unescapes it, and splits it back into turns on the
 * speaker labels Granola uses ("Me:" for the note-taker, "Them:" for anyone
 * unidentified, or a name when it knows one). */
function parseTranscript(raw) {
  const text = String(raw ?? "");
  let body = null;

  const m = text.match(/"transcript"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      body = JSON.parse(`"${m[1]}"`);
    } catch (e) {
      body = m[1].replace(/\\u0027/g, "'").replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
  }
  if (!body) {
    /* Not a JSON blob — treat the note body after the frontmatter as prose. */
    const after = text.replace(/^---[\s\S]*?\n---\n/, "");
    body = after.replace(/^#.*$/gm, "").trim();
  }
  if (!body) return [];

  const turns = [];
  const re = /(^|\s)(Me|Them|[A-Z][a-z]+(?: [A-Z][a-z]+)?):\s+/g;
  let last = 0, cur = null, mm;
  while ((mm = re.exec(body)) !== null) {
    if (cur) {
      cur.text = body.slice(last, mm.index).trim();
      if (cur.text) turns.push(cur);
    }
    cur = { speaker: mm[2], text: "" };
    last = re.lastIndex;
  }
  if (cur) {
    cur.text = body.slice(last).trim();
    if (cur.text) turns.push(cur);
  }
  if (!turns.length) turns.push({ speaker: null, text: body.trim() });

  /* Granola often exports the whole meeting as ONE turn — 3,000 words on a
   * single line with a lone "Them:" at the front. There is no speaker
   * structure to recover, so the only thing that helps is breaking the wall
   * into paragraphs at sentence boundaries. Roughly five sentences each keeps
   * it scannable without inventing structure that is not in the data. */
  const out = [];
  for (const turn of turns) {
    const words = turn.text.split(/\s+/).length;
    if (words < 160) { out.push(turn); continue; }
    const sentences = turn.text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [turn.text];
    for (let i = 0; i < sentences.length; i += 5) {
      const chunk = sentences.slice(i, i + 5).join("").trim();
      if (chunk) out.push({ speaker: i === 0 ? turn.speaker : null, text: chunk });
    }
  }
  return out;
}

async function renderTranscript(plugin, parent, file, fm) {
  const link = fm?.transcript ? String(fm.transcript).replace(/^"|"$/g, "").replace(/^\[\[|\]\]$/g, "") : null;
  if (!link) return null;
  const base = link.split("/").pop();
  let tf = plugin.app.vault.getAbstractFileByPath(
    `${P.transcripts}/${base}.md`);
  if (!(tf instanceof TFile)) {
    const hit = plugin.app.metadataCache.getFirstLinkpathDest(link, file.path);
    tf = hit && hit.path !== file.path ? hit : null;
  }
  if (!(tf instanceof TFile)) return null;

  const raw = await plugin.app.vault.cachedRead(tf);
  const turns = parseTranscript(raw);
  if (!turns.length) return null;

  const c = card(parent, "Transcript", "❝", "col1 span2");
  const words = turns.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  el(c, "div", "lifeos-microlabel",
    `${turns.length} turn${turns.length === 1 ? "" : "s"} · ~${words.toLocaleString()} words · verbatim`);

  /* Long by nature, so it opens closed and scrolls in its own box rather than
   * pushing every other card off the page. */
  const det = c.createEl("details", { cls: "lifeos-tsc" });
  const sum = det.createEl("summary", { cls: "lifeos-tsc-summary" });
  el(sum, "span", null, "Read the transcript");

  const box = el(det, "div", "lifeos-tsc-body");
  let prev = null;
  for (const turn of turns) {
    const row = el(box, "div", "lifeos-tsc-turn");
    if (turn.speaker && turn.speaker !== prev) {
      const me = cfgGet(plugin?.cfg, "granola.speakerName", "Me");
      const who = turn.speaker === "Me" ? me
        : turn.speaker === "Them" ? "Someone else" : turn.speaker;
      el(row, "div", `lifeos-tsc-who${turn.speaker === "Me" ? " is-me" : ""}`, who);
    }
    el(row, "div", "lifeos-tsc-text", turn.text);
    prev = turn.speaker;
  }

  const bar = el(c, "div", "lifeos-inline-actions lifeos-actions-left");
  mkBtn(bar, "Open transcript note", () => plugin.open(tf.path));
  return c;
}

/* -------------------------------------------------------------- weather UI */

async function renderWeatherPage(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Weather" },
  ]);

  const f = app.vault.getAbstractFileByPath(P.weatherCache);
  let w = null;
  if (f instanceof TFile) {
    try { w = JSON.parse(await app.vault.cachedRead(f)); } catch (e) { w = null; }
  }
  if (!w?.now) {
    const c = card(root, "Weather", "☀");
    el(c, "div", "lifeos-empty",
      "No forecast cached yet. Run 4 System/Automation/weather-fetch.py, or wait for the next sync.");
    return;
  }

  const deg = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}°`);
  const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

  /* header: the single most characteristic fact, large */
  const head = el(root, "div", "lifeos-head");
  const ht = el(head, "div", "lifeos-head-text");
  el(ht, "h1", "lifeos-h1", `${deg(w.now.temp)} ${w.now.conditions ?? ""}`.trim());
  el(ht, "div", "lifeos-sub",
    `${w.location} · updated ${moment(w.fetched).format("h:mm A")}`);
  const hact = el(head, "div", "lifeos-head-actions");
  mkBtn(hact, "Refresh", async () => {
    new Notice("Fetching forecast…");
    const r = await plugin.runScript("weather-fetch.py", []);
    if (r.code !== 0) new Notice("Could not reach the weather service");
    await afterMetadata(app, P.weatherCache);
    await redraw();
  });
  mkBtn(hact, "Back to Today", () => plugin.openDaily(moment()));

  /* conditions now */
  const strip = el(root, "div", "lifeos-tiles lifeos-tiles-4");
  tile(strip, "Feels like", deg(w.now.feelslike), w.now.conditions ?? "", "◐");
  tile(strip, "Humidity", pct(w.now.humidity), "relative", "◍");
  tile(strip, "Wind", `${Math.round(w.now.wind ?? 0)}`,
    w.units === "us" ? "mph" : "km/h", "≋");
  tile(strip, "UV index", String(Math.round(w.now.uv ?? 0)),
    (w.now.uv ?? 0) >= 8 ? "very high" : (w.now.uv ?? 0) >= 6 ? "high" : "moderate", "☀");

  const grid = el(root, "div", "lifeos-grid lifeos-grid-2");

  /* next 48 hours — two plots, one x-axis */
  const hc = card(grid, "Next 48 hours", "◷", "col1 span2");
  if (w.hours?.length) {
    el(hc, "div", "lifeos-microlabel", "TEMPERATURE");
    wxHourlyChart(hc, w.hours);
    el(hc, "div", "lifeos-microlabel", "CHANCE OF PRECIPITATION");
    wxPrecipChart(hc, w.hours);
    el(hc, "div", "lifeos-wx-hint", "Hover the curve for conditions at that hour.");
  } else {
    el(hc, "div", "lifeos-empty", "No hourly data in the cache.");
  }

  /* 15-day outlook */
  const dc = card(grid, `Next ${w.days?.length ?? 0} days`, "▦", "col1 span2");
  if (w.days?.length) {
    const legend = el(dc, "div", "lifeos-wx-legend");
    el(legend, "span", "lifeos-wx-swatch");
    el(legend, "span", null, "each bar spans that day's low to its high");
    wxRangeChart(dc, w.days);
  } else {
    el(dc, "div", "lifeos-empty", "No daily forecast in the cache.");
  }

  /* the past week, for comparison */
  const pc = card(grid, "The past week", "↩", "col1 span2");
  if (w.past?.length) {
    el(pc, "div", "lifeos-microlabel", "WHAT ACTUALLY HAPPENED — SAME SCALE AS THE FORECAST");
    wxRangeChart(pc, w.past);
  } else {
    el(pc, "div", "lifeos-empty", "No history in the cache.");
  }

  /* the numbers, for anyone who would rather read them */
  const tc = card(grid, "Hour by hour", "▤", "col1 span2");
  const tbl = el(tc, "div", "lifeos-wx-table");
  const hdr = el(tbl, "div", "lifeos-wx-trow is-head");
  for (const h of ["Hour", "Temp", "Feels", "Rain", "Humidity", "Wind", "Conditions"]) {
    el(hdr, "div", "lifeos-wx-cell", h);
  }
  for (const h of (w.hours ?? []).slice(0, 24)) {
    const r = el(tbl, "div", "lifeos-wx-trow");
    const hr = Number(String(h.datetime).slice(0, 2));
    el(r, "div", "lifeos-wx-cell", `${((hr + 11) % 12) + 1}${hr < 12 ? "am" : "pm"}`);
    el(r, "div", "lifeos-wx-cell", deg(h.temp));
    el(r, "div", "lifeos-wx-cell", deg(h.feelslike));
    el(r, "div", "lifeos-wx-cell", pct(h.precipprob));
    el(r, "div", "lifeos-wx-cell", pct(h.humidity));
    el(r, "div", "lifeos-wx-cell", `${Math.round(h.windspeed ?? 0)}`);
    el(r, "div", "lifeos-wx-cell", h.conditions ?? "");
  }
}

/* -------------------------------------------------------------- meeting UI */

async function renderMeeting(plugin, root, cfg, ctx, redraw) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const content = await app.vault.read(file);
  const S = MEETING_SECTIONS;

  const day = moment(fm.meeting_date ?? fm.date ?? file.basename.slice(0, 10), "YYYY-MM-DD");
  const attendees = toArray(fm.attendees).filter(Boolean);
  const agenda = plugin.store.sectionItems(content, S.agenda);
  const decisions = plugin.store.sectionItems(content, S.decisions);
  const discussion = plugin.store.sectionItems(content, S.discussion);
  const followup = plugin.store.sectionItems(content, S.followup);
  const related = plugin.store.sectionItems(content, S.related);
  const contextTxt = plugin.store.sectionLines(content, S.context).join("\n").trim();
  const actions = await plugin.tasks.bySource(file.basename);

  const refresh = async () => {
    await afterMetadata(app, ctx.sourcePath);
    await redraw();
  };

  const series = plugin.recur.series()
    .find((s) => String(s.fm.series ?? "") === String(fm.series ?? "___"));

  renderHeader(plugin, root, [
    { label: "Uptick", path: P.home },
    { label: "Meetings", path: `${P.meetings}/Meetings.md` },
    { label: file.basename },
  ]);

  /* ---- title banner ---- */
  const banner = el(root, "div", "lifeos-banner");
  const bl = el(banner, "div", null);
  el(bl, "div", "lifeos-banner-kicker", "UPTICK MEETING RECORD");
  el(bl, "h1", "lifeos-h1", fm.title ?? file.basename);
  const br = el(banner, "div", "lifeos-banner-actions");

  mkBtn(br, "+ Note", async () => {
    const v = await prompt(app, { title: "Discussion note", placeholder: "What was said?" });
    if (!v || !v.trim()) return;
    await plugin.store.appendToSection(ctx.sourcePath, S.discussion, `- ${v.trim()}`);
    await refresh();
  }, "primary");

  /* "Process" turns the imported bullets into tasks. Granola writes its
   * next-steps under its own headings, so this is the bridge from an imported
   * note to Task Inbox — with a confirmation, never automatically. */
  mkBtn(br, "Process", async () => {
    const candidates = [];
    for (const h of plugin.meetings.importedSections(content)) {
      if (!/next step|action|follow|todo|task/i.test(h)) continue;
      for (const i of plugin.store.sectionItems(content, h)) candidates.push(i);
    }
    for (const i of plugin.store.sectionItems(content, S.actions)) candidates.push(i);

    if (!candidates.length) {
      new Notice("No action-like bullets found in this note");
      return;
    }
    /* Some importers write next-steps with an owner prefix ("Sam: move CRM
     * tickets forward") while the stored task drops it. Compare on a key that
     * removes the prefix and punctuation, and treat containment either way as
     * a match — creating a near-duplicate task is worse than skipping one. */
    const key = (s) =>
      String(s)
        .toLowerCase()
        .replace(/^[a-z][\w .'-]{0,30}:\s*/i, "")
        .replace(/[^a-z0-9 ]+/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const existing = (await plugin.tasks.bySource(file.basename)).map((t) => key(t.text));
    const seen = new Set();
    const fresh = candidates.filter((c) => {
      const k = key(c);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return !existing.some((e) => e === k || e.includes(k) || k.includes(e));
    });
    if (!fresh.length) {
      new Notice("Every action here is already in Task Inbox");
      return;
    }
    const go = await prompt(app, {
      title: `Create ${fresh.length} task${fresh.length === 1 ? "" : "s"}?`,
      help: fresh.map((f) => `• ${f}`).join("\n"),
      placeholder: 'Type "yes" to confirm',
      cta: "Create tasks",
    });
    if (!go || !/^y/i.test(go.trim())) return;
    for (const f of fresh) {
      try {
        await plugin.tasks.add(f, {
          source: file.basename,
          due: day.isValid() ? day.format("YYYY-MM-DD") : undefined,
        });
      } catch (e) { /* duplicate — skip */ }
    }
    new Notice(`Added ${fresh.length} to Task Inbox`);
    await refresh();
  });

  mkBtn(br, "Context", async () => {
    const v = await prompt(app, {
      title: "Context", multiline: true, value: contextTxt,
      help: "Why this meeting is happening and what came before it.",
    });
    if (v == null) return;
    await plugin.store.replaceSection(ctx.sourcePath, S.context, v.trim());
    await refresh();
  });

  mkBtn(br, "Archive", async () => {
    const v = await prompt(app, {
      title: "Archive this meeting?",
      help: "Sets status to archived. The note stays where it is — nothing is moved or deleted.",
      placeholder: 'Type "yes" to confirm',
      cta: "Archive",
    });
    if (!v || !/^y/i.test(v.trim())) return;
    await setFrontMatter(app, file, "status", "archived");
    await refresh();
  });

  /* Push to Calendar. The script is the gatekeeper: it verifies the target
   * calendar and refuses to guess, so this button always dry-runs first and
   * shows exactly what would be created before anything is written. */
  mkBtn(br, "Push to Calendar", async () => {
    const rel = ctx.sourcePath;
    const dry = await plugin.runScript("calendar-push.py", ["--note", rel]);
    let parsed = null;
    try { parsed = JSON.parse(dry.stdout || "{}"); } catch (e) { /* shown raw below */ }

    if (!parsed || parsed.ok === false) {
      const why = parsed?.blocked ?? (dry.stderr || dry.stdout || "unknown error");
      await prompt(app, {
        title: "Cannot push to Calendar",
        help: String(why).slice(0, 700),
        multiline: true,
        value: JSON.stringify(parsed?.would_create ?? {}, null, 2),
        cta: "Close",
      });
      return;
    }
    if (parsed.skipped) {
      new Notice("Already pushed to Calendar");
      return;
    }

    const plan = parsed.would_create ?? {};
    const invited = (plan.attendees ?? []);
    const missing = parsed.no_email ?? [];
    const go = await prompt(app, {
      title: "Create this Calendar event?",
      help:
        `${plan.title}\n${plan.start} → ${plan.end}\n` +
        `Calendar: ${parsed.target?.title ?? plan.calendar_id}\n` +
        `Invites: ${invited.length ? invited.join(", ") : "none"}` +
        (missing.length ? `\nNo email on file (will not be invited): ${missing.join(", ")}` : ""),
      placeholder: 'Type "yes" to create',
      cta: "Create event",
    });
    if (!go || !/^y/i.test(go.trim())) return;

    const res = await plugin.runScript("calendar-push.py", ["--note", rel, "--apply"]);
    let out = null;
    try { out = JSON.parse(res.stdout || "{}"); } catch (e) { /* fall through */ }
    if (out?.ok) {
      new Notice("Event created in Calendar");
      await refresh();
    } else {
      new Notice(`Push failed: ${(res.stderr || res.stdout || "unknown").slice(0, 160)}`);
    }
  });

  mkBtn(br, "← Back to Daily", () => plugin.openDaily(day));
  if (series) mkBtn(br, "Open Series", () => plugin.open(series.file.path));

  /* ---- stat tiles ---- */
  const tiles = el(root, "div", "lifeos-tiles lifeos-tiles-4");

  tile(tiles, "Date", day.isValid() ? day.format("MMM D, YYYY") : "—", "", "▤",
    () => (day.isValid() ? plugin.openDaily(day) : new Notice("No valid meeting date")),
    "Open that day");

  /* Attendees live in frontmatter, so this tile is an editor. */
  const resolved = attendees.map((a) => plugin.contacts.resolve(a));
  const missingEmail = resolved.filter((r) => !r.email).length;
  tile(tiles, "Attendees", resolved.length,
    resolved.map((r) => r.name).join(", ") || "none recorded", "◐",
    async () => {
      const picked = await pickAttendees(app, plugin.contacts, attendees);
      if (picked == null) return;
      /* Stored as links so the address always comes from the contact note. */
      const yaml = picked
        .map((c) => JSON.stringify(`[[${c.file.basename}|${c.name}]]`))
        .join(", ");
      await setFrontMatterRaw(app, file, "attendees", `[${yaml}]`);
      await refresh();
    }, missingEmail ? `${missingEmail} without an email` : "Add attendees");

  tile(tiles, "Decisions", decisions.length, "recorded", "✓",
    async () => {
      const v = await prompt(app, {
        title: "Record a decision",
        help: "Decided, not discussed. One line.",
        placeholder: "What was decided?",
        cta: "Add decision",
      });
      if (!v || !v.trim()) return;
      await plugin.store.appendToSection(ctx.sourcePath, S.decisions, `- ${v.trim()}`);
      await refresh();
    }, "Add a decision");

  tile(tiles, "Actions", actions.length, "in Task Inbox", "☑",
    async () => {
      const v = await prompt(app, {
        title: "Add action item",
        help: `Written to ${P.taskInbox}, dated to this meeting, sourced from this note.`,
        placeholder: "Who does what?",
        cta: "Add to Task Inbox",
      });
      if (!v || !v.trim()) return;
      await plugin.tasks.add(v.trim(), {
        source: file.basename,
        due: day.isValid() ? day.format("YYYY-MM-DD") : undefined,
      });
      new Notice("Added to Task Inbox");
      await refresh();
    }, "Add an action item");

  /* ---- context ---- */
  const ctxCard = card(root, "Context", "◈");
  editHead(ctxCard, async () => {
    const v = await prompt(app, {
      title: "Context",
      help: "Why this meeting is happening and what came before it.",
      multiline: true,
      value: contextTxt,
    });
    if (v == null) return;
    await plugin.store.replaceSection(ctx.sourcePath, S.context, v.trim());
    await refresh();
  });
  if (contextTxt) el(ctxCard, "div", "lifeos-prose", contextTxt);
  else el(ctxCard, "div", "lifeos-empty", "No context assigned");

  /* ---- details ---- */
  const det = card(root, "Meeting Details", "✎");
  const dg = el(det, "div", "lifeos-detailgrid");
  detail(dg, "Objective", fm.objective || "No objective captured.");
  detail(dg, "Attendees", resolved.map((r) => r.name).join(", ") || "No attendees captured.");
  detail(dg, "Time", fm.time || "—");
  detail(dg, "Duration", fm.duration ? `${fm.duration} min` : "—");
  detail(dg, "Location", fm.location || "—");
  detail(dg, "Status", fm.status || "open");
  const da = el(det, "div", "lifeos-inline-actions");
  mkBtn(da, "Set objective", async () => {
    const v = await prompt(app, {
      title: "Objective", placeholder: "What is this meeting for?",
      value: String(fm.objective ?? ""),
    });
    if (v == null) return;
    await setFrontMatter(app, file, "objective", v.trim());
    await refresh();
  });
  mkBtn(da, "Mark closed", async () => {
    await setFrontMatter(app, file, "status", "closed");
    await refresh();
  });

  /* ---- agenda ---- */
  const ag = card(root, "Agenda", "▤");
  listOrEmpty(ag, agenda, "No agenda items yet.");
  addRow(ag, "+ Add Agenda Item", "Agenda item", async (v) => {
    await plugin.store.appendToSection(ctx.sourcePath, S.agenda, `- ${v}`);
    await refresh();
  });

  /* ---- discussion grid ---- */
  const grid = el(root, "div", "lifeos-grid lifeos-grid-2");

  const notesCard = card(grid, "Discussion Notes", "▤");
  const discussionLines = plugin.store.sectionLines(content, S.discussion);
  editHead(notesCard, async () => {
    const v = await prompt(app, {
      title: "Discussion notes", multiline: true,
      help: "Replaces the whole section. \"### Heading\" starts a group.",
      value: discussionLines.join("\n").trim(),
    });
    if (v == null) return;
    await plugin.store.replaceSection(ctx.sourcePath, S.discussion, v.trim());
    await refresh();
  });
  renderGrouped(notesCard, discussionLines, "No discussion notes yet.");
  addRow(notesCard, "+ Add Note", "What was discussed?", async (v) => {
    await plugin.store.appendToSection(ctx.sourcePath, S.discussion, `- ${v}`);
    await refresh();
  });

  const decCard = card(grid, "Decisions", "✓");
  listOrEmpty(decCard, decisions, "No decisions recorded.");
  addRow(decCard, "+ Decision", "What was decided?", async (v) => {
    await plugin.store.appendToSection(ctx.sourcePath, S.decisions, `- ${v}`);
    await refresh();
  });

  /* Action items are NOT stored here: Task Inbox is the only task store, so we
   * write there with this note as the source and read them back by source. */
  const actCard = card(grid, "Action Items", "☑");
  if (!actions.length) {
    el(actCard, "div", "lifeos-empty", "No action items.");
  } else {
    for (const t of actions) {
      const r = el(actCard, "div", "lifeos-task");
      el(r, "span", "lifeos-task-dot").style.background =
        t.done ? "var(--los-faint)" : "var(--los-accent-3)";
      const txt = el(r, "span", "lifeos-task-text", t.text);
      if (t.done) txt.style.textDecoration = "line-through";
      if (t.due) el(r, "span", "lifeos-task-due", t.due);
      r.addClass("is-clickable");
      r.title = "Open the Kanban board";
      onTap(r, () => plugin.openTask());
    }
  }
  el(actCard, "div", "lifeos-microlabel", "STORED IN TASK INBOX — CLICK TO OPEN THE BOARD");
  addRow(actCard, "+ Action Item", "Who does what?", async (v) => {
    /* Dated to the meeting so it lands on that day's dashboard. */
    await plugin.tasks.add(v, {
      source: file.basename,
      due: day.isValid() ? day.format("YYYY-MM-DD") : undefined,
    });
    new Notice("Added to Task Inbox");
    await refresh();
  });

  const fuCard = card(grid, "Follow-up", "↗");
  editHead(fuCard, async () => {
    const v = await prompt(app, {
      title: "Follow-up", multiline: true,
      help: "Open threads that are not yet anyone's task. One per line.",
      value: followup.map((d) => `- ${d}`).join("\n"),
    });
    if (v == null) return;
    await plugin.store.replaceSection(ctx.sourcePath, S.followup, v.trim());
    await refresh();
  });
  listOrEmpty(fuCard, followup, "No follow-up notes.");
  addRow(fuCard, "+ Follow-up", "Open thread, not yet a task", async (v) => {
    await plugin.store.appendToSection(ctx.sourcePath, S.followup, `- ${v}`);
    await refresh();
  });

  /* ---- provenance ----
   * Granola's own headings used to be rendered verbatim here while the
   * template's sections sat empty above them, so every imported meeting read
   * as a wall of text under a row of blank cards. The content now lives in the
   * template sections (see granola-fill-template.py) and what remains here is
   * just the import trail: where it came from, and a way back to the source. */
  const provenance = plugin.store.sectionLines(content, "Provenance")
    .map((l) => l.replace(/^>\s?/, "").trim())
    .filter((l) => l && !/^\[!\w+\]/.test(l))
    /* Plain text nodes, so Markdown emphasis would otherwise show as literal
     * asterisks. */
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/, ""));
  const imported = plugin.meetings.importedSections(content);

  if (provenance.length || imported.length || fm.transcript) {
    const imp = card(root, "Provenance", "⤓");
    el(imp, "div", "lifeos-microlabel",
      `${fm.source ? String(fm.source).toUpperCase() + " — " : ""}IMPORT TRAIL`);
    const box = el(imp, "div", "lifeos-provenance");
    for (const line of provenance) el(box, "div", "lifeos-provline", line);

    /* Anything not yet migrated still renders, so an un-migrated note is
     * never silently blank. */
    for (const h of imported) {
      const sec = el(imp, "div", "lifeos-importsec");
      el(sec, "div", "lifeos-importhead", h);
      const items = plugin.store.sectionItems(content, h);
      if (!items.length) el(sec, "div", "lifeos-empty", "—");
      for (const i of items) el(sec, "div", "lifeos-listitem", i);
    }
    if (fm.transcript) {
      const ta = el(imp, "div", "lifeos-inline-actions lifeos-actions-left");
      mkBtn(ta, "Open transcript", () => {
        const link = String(fm.transcript).replace(/^"|"$/g, "").replace(/^\[\[|\]\]$/g, "");
        /* The transcript and the meeting note share a basename, so resolving
         * the bare link from the note's own folder finds the note itself and
         * "opening" it does nothing visible. Look in the transcripts folder
         * first, and only then fall back to Obsidian's own resolution. */
        const base = link.split("/").pop();
        const direct = app.vault.getAbstractFileByPath(
          `${P.transcripts}/${base}.md`);
        if (direct instanceof TFile) { plugin.open(direct.path); return; }
        const hit = app.metadataCache.getFirstLinkpathDest(link, file.path);
        if (hit && hit.path !== file.path) { plugin.open(hit.path); return; }
        new Notice("Transcript not found");
      });
    }
  }

  await renderTranscript(plugin, grid, file, fm);

  /* ---- email linked to this meeting ---- */
  const linkedMail = plugin.emails.forMeeting(file.basename);
  if (linkedMail.length) {
    const mc = card(root, "Email about this meeting", "✉");
    renderEmailRows(plugin, mc, linkedMail, "None.", redraw);
  }

  /* ---- related knowledge ---- */
  const rel = card(root, "Related Knowledge", "◈");
  listOrEmpty(rel, related, "Nothing linked yet.");
  const ra = el(rel, "div", "lifeos-inline-actions lifeos-actions-left");
  mkBtn(ra, "🔗 Link Existing Note", async () => {
    const q = await prompt(app, {
      title: "Link existing note",
      help: "Type part of a note name.",
      placeholder: "Note name",
    });
    if (!q || !q.trim()) return;
    const needle = q.trim().toLowerCase();
    const hit = humanNotes(this.app, this).find((f) => f.basename.toLowerCase().includes(needle));
    if (!hit) { new Notice(`No note matching "${q}"`); return; }
    await plugin.store.appendToSection(ctx.sourcePath, S.related, `- [[${hit.basename}]]`);
    await refresh();
  });
  mkBtn(ra, "+ Create Related Note", async () => {
    const t = await prompt(app, {
      title: "Create related note",
      help: `Created in ${P.knowledge} and linked here.`,
      placeholder: "Note title",
    });
    if (!t || !t.trim()) return;
    const name = safeName(t);
    const path = `${P.knowledge}/${name}.md`;
    if (!app.vault.getAbstractFileByPath(path)) {
      await plugin.store.ensureFolder(P.knowledge);
      await app.vault.create(path, [
        "---", "type: note", `created: ${moment().format("YYYY-MM-DD")}`, "---",
        "", `# ${name}`, "",
        `Related to [[${file.basename}]].`, "",
      ].join("\n"));
    }
    await plugin.store.appendToSection(ctx.sourcePath, S.related, `- [[${name}]]`);
    await refresh();
  }, "primary");
}

/* A web app embedded directly in the dashboard.
 *
 * Uses Electron's <webview>, NOT an <iframe>. Microsoft 365 sends
 * frame-ancestors headers that refuse framing, so an iframe renders blank; a
 * webview is its own browsing context (like a tab) and is unaffected. No
 * `partition` is set on purpose — it shares Obsidian's default session, so
 * signing in here and in the Web viewer tab are the same session.
 *
 * Loads on demand rather than on every dashboard render: this is a full
 * browser, and paying that cost each time Home opens is not worth it. */
/* The virtual viewport the embedded page believes it has. A 16:10 laptop, so
 * the site serves its desktop layout rather than a cramped mobile one. */
const LAPTOP_W = 1440;
const LAPTOP_H = 900;

function renderWebCard(plugin, grid, appDef, cls) {
  /* An embedded browser inside a dashboard is the heaviest thing on the page.
   * On a phone it competes with the app itself for memory and makes scrolling
   * stutter, so the card becomes a plain link out. */
  if (isMobile()) {
    const c = card(grid, appDef.label, "✦", cls);
    el(c, "div", "lifeos-empty", `Opens ${appDef.hint} in your browser.`);
    const bar = el(c, "div", "lifeos-inline-actions lifeos-actions-left");
    mkBtn(bar, `Open ${appDef.label}`, () => window.open(appDef.url, "_blank"));
    return c;
  }
  const c = card(grid, appDef.label, "✦", cls);
  const bar = el(c, "div", "lifeos-webbar");
  const zoom = el(bar, "span", "lifeos-webzoom");
  const body = el(c, "div", "lifeos-webbody");

  let view = null;
  let observer = null;

  const teardown = () => {
    observer?.disconnect();
    observer = null;
    view = null;
  };

  const placeholder = () => {
    teardown();
    body.empty();
    zoom.setText("");
    const ph = el(body, "div", "lifeos-webph");
    el(ph, "div", "lifeos-muted", appDef.hint);
    el(ph, "div", "lifeos-webph-sub", `Renders at ${LAPTOP_W}×${LAPTOP_H}, scaled to fit.`);
    mkBtn(ph, `Load ${appDef.label}`, () => mount(), "primary");
  };

  const mount = () => {
    teardown();
    body.empty();
    try {
      /* The frame is laid out at full laptop size and then transform-scaled
       * down, so the whole page is visible instead of the card cropping into
       * a corner of it. The site still sees a 1440x900 viewport. */
      const wrap = el(body, "div", "lifeos-webwrap");
      view = wrap.createEl("webview");
      view.addClass("lifeos-webframe");
      view.setAttribute("src", appDef.url);
      view.setAttribute("allowpopups", "true");

      const fit = () => {
        const w = wrap.clientWidth;
        if (!w) return;
        const scale = Math.min(1, w / LAPTOP_W);
        wrap.style.setProperty("--los-web-scale", String(scale));
        wrap.style.height = `${Math.round(LAPTOP_H * scale)}px`;
        zoom.setText(`${Math.round(scale * 100)}% of ${LAPTOP_W}×${LAPTOP_H}`);
      };

      observer = new ResizeObserver(fit);
      observer.observe(wrap);
      fit();

      /* A disabled webview tag stays a zero-height unknown element. */
      window.setTimeout(() => {
        if (view && view.clientHeight < 20) {
          new Notice("Embedded web view unavailable — opening in a tab instead");
          placeholder();
          plugin.openWeb(appDef.url);
        }
      }, 2500);
    } catch (e) {
      console.error("Uptick: webview failed", e);
      placeholder();
    }
  };

  mkBtn(bar, "Reload", () => (view ? view.reload?.() : mount()));
  mkBtn(bar, "Open in tab", () => plugin.openWeb(appDef.url));
  mkBtn(bar, "Close", () => placeholder());

  placeholder();
  return c;
}

function detail(parent, label, value) {
  const d = el(parent, "div", "lifeos-detail");
  el(d, "div", "lifeos-microlabel", label.toUpperCase());
  el(d, "div", "lifeos-detailval", String(value));
}

function editHead(cardEl, onEdit) {
  const head = cardEl.querySelector(".lifeos-cardhead");
  if (!head) return;
  const b = el(head, "button", "lifeos-btn lifeos-edit", "✎ Edit");
  b.onclick = async () => {
    try { await onEdit(); } catch (e) { new Notice(String(e.message ?? e)); }
  };
}

/* ------------------------------------------------------------- UI helpers */

/* Route a card into a packing lane rather than a fixed grid column, so a short
 * card no longer leaves a void stretching down beside a tall neighbour.
 *   span3          full-width band; breaks the row
 *   col3           narrow sidebar lane
 *   span2          wide lane, full width of that lane
 *   col1 / col2    wide lane, paired two-across
 * A grid that passes no class at all (the meeting and email views) gets the
 * pair behaviour, which is the two-column layout those views already wanted. */
function newRow(grid) {
  const row = el(grid, "div", "lifeos-row");
  grid._lanes = {
    wide: el(row, "div", "lifeos-lane lifeos-lane-wide"),
    narrow: el(row, "div", "lifeos-lane lifeos-lane-narrow"),
    pair: null,
  };
  return grid._lanes;
}

function cardHost(grid, cls) {
  if (!grid?.classList?.contains("lifeos-grid")) return grid;
  const c = String(cls ?? "");
  const lanes = grid._lanes ?? newRow(grid);

  if (c.includes("span3")) {
    const band = el(grid, "div", "lifeos-band");
    newRow(grid);
    return band;
  }
  if (c.includes("col3")) return lanes.narrow;
  if (c.includes("span2")) {
    lanes.pair = null;
    return lanes.wide;
  }
  if (!lanes.pair || lanes.pair.childElementCount >= 2) {
    lanes.pair = el(lanes.wide, "div", "lifeos-pair");
  }
  return lanes.pair;
}

function card(parent, title, glyph, cls) {
  const c = el(cardHost(parent, cls), "div", `lifeos-card ${cls ?? ""}`);
  cardHead(c, title, glyph);
  return c;
}

function cardHead(c, title, glyph) {
  const h = el(c, "div", "lifeos-cardhead");
  if (glyph) el(h, "span", "lifeos-cardglyph", glyph);
  el(h, "span", "lifeos-cardtitle", title.toUpperCase());
  return h;
}

/* Set text that may carry light Markdown, without a full renderer.
 *
 * These strings come from imported notes, so **bold**, *italic*, `code` and
 * [links](url) all turn up in them. setText would print the markers literally
 * — which is what was happening in Discussion Notes. Only these four are
 * handled, and every value goes in as text, never as HTML, so nothing from an
 * imported note can inject markup. */
function setRich(node, raw) {
  const s = String(raw ?? "");
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  node.empty();
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) node.appendText(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      node.createEl("strong", { text: tok.slice(2, -2) });
    } else if (tok.startsWith("`")) {
      node.createEl("code", { text: tok.slice(1, -1) });
    } else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      node.createEl("span", { cls: "lifeos-inlinelink", text: tok.slice(1, cut) });
    } else {
      node.createEl("em", { text: tok.slice(1, -1) });
    }
    last = re.lastIndex;
  }
  if (last < s.length) node.appendText(s.slice(last));
  return node;
}

/* Treat a tap as a tap, not as the end of a scroll.
 *
 * On a touch screen a flick that STARTS on a row still fires `click` when the
 * finger lifts, so scrolling a list of meetings would open whichever one the
 * scroll began on. Rows are large scroll targets, which is exactly why they
 * are the ones that misfire — this is the "it jumps to another page" bug.
 *
 * A pointer that moved more than a few pixels, or was held down long enough to
 * be a press rather than a tap, is not a tap. Buttons keep plain onclick: they
 * are small, deliberate targets and were never the problem. */
/* Obsidian sets Platform.isMobile on phones and tablets alike. Several panels
 * shell out to launchd, AppleScript or python, none of which exist there — and
 * a button that cannot work is worse than one that is absent. */
function isMobile() {
  try {
    const { Platform } = require("obsidian");
    return Boolean(Platform?.isMobile);
  } catch (e) {
    return document.body.classList.contains("is-mobile");
  }
}

function onTap(node, fn) {
  let sx = 0, sy = 0, st = 0, moved = false;
  node.addEventListener("pointerdown", (ev) => {
    sx = ev.clientX; sy = ev.clientY; st = Date.now(); moved = false;
  }, { passive: true });
  node.addEventListener("pointermove", (ev) => {
    if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) moved = true;
  }, { passive: true });
  node.addEventListener("click", (ev) => {
    if (moved || Date.now() - st > 700) return;
    fn(ev);
  });
  node.addClass("is-tappable");
  return node;
}

function listOrEmpty(parent, items, empty) {
  if (!items.length) {
    el(parent, "div", "lifeos-empty", empty);
    return;
  }
  const ul = el(parent, "div", "lifeos-list");
  for (const i of items) setRich(el(ul, "div", "lifeos-listitem"), i);
}

function linkRow(parent, label, onClick) {
  const r = el(parent, "div", "lifeos-linkrow");
  el(r, "span", null, label);
  el(r, "span", "lifeos-chev", "›");
  onTap(r, onClick);
}

function mkBtn(parent, label, onClick, variant) {
  const b = el(parent, "button", `lifeos-btn${variant ? " lifeos-btn-" + variant : ""}`, label);
  b.onclick = async (e) => {
    e.preventDefault();
    b.disabled = true;
    try {
      await onClick();
    } catch (err) {
      new Notice(String(err.message ?? err));
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

/* An "+ Add X" affordance that expands into a single-line input. */
function addRow(parent, label, placeholder, onSubmit) {
  const wrap = el(parent, "div", "lifeos-add");
  const trigger = el(wrap, "button", "lifeos-add-trigger", label);
  const form = el(wrap, "div", "lifeos-add-form");
  form.style.display = "none";
  const input = form.createEl("input", { cls: "lifeos-input" });
  input.placeholder = placeholder;

  const submit = async () => {
    const v = input.value.trim();
    if (!v) return;
    try {
      await onSubmit(v);
      input.value = "";
      form.style.display = "none";
      trigger.style.display = "";
    } catch (e) {
      new Notice(String(e.message ?? e));
    }
  };

  trigger.onclick = () => {
    trigger.style.display = "none";
    form.style.display = "";
    input.focus();
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      form.style.display = "none";
      trigger.style.display = "";
    }
  };
  const go = el(form, "button", "lifeos-btn lifeos-btn-primary", "Add");
  go.onclick = submit;
  return wrap;
}
