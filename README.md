# Uptick

Uptick is a local-first execution workspace for Obsidian. It turns the Markdown
you already own into a focused Home page, an actionable daily note, task and
meeting views, reviews, study context, and an optional experience layer.

Its central question is: **what are my commitments today, what should I do
next, and what can I finish before my next meeting?**

Uptick does not require an account, cloud service, API key, or another plugin
for its core workflow. Your notes remain ordinary Markdown files in your vault.

> **Release status:** Uptick 0.7.0 is an early public release. The core
> dashboard and planning workflow are ready for a fresh vault; macOS companion
> scripts are opt-in local integrations that you configure yourself.

## What Uptick helps with

| Feature | What it does | Problem it addresses |
| --- | --- | --- |
| **Home / Now** | Shows the next meeting, your current Today Plan, one explained next action, and integration freshness. | A dashboard should help you choose work, not make you scan several lists. |
| **Today Plan** | Lets you select, order, replace, clear, finish, defer, or drop up to three commitments. It stores canonical task references, not copies. | A backlog does not make a realistic daily commitment. |
| **Today page** | Provides a morning plan, priorities, work, meetings, work log, and end-of-day review in one daily note. | Planning and reflection otherwise become disconnected rituals. |
| **Canonical tasks** | Uses Markdown checkboxes in one task inbox; tasks can include due dates, priority, difficulty, duration, and source links. | Your task data stays portable instead of becoming a private database. |
| **Now recommender** | Suggests actionable overdue, due-today, explicit-priority, and captured tasks, plus an optional LearnKit review. Every suggestion has a reason and source. | Automation that cannot explain its choice is hard to trust. |
| **Meeting and calendar context** | Reconciles meeting notes and, when configured, reads a local calendar cache for upcoming commitments and available time. | Tasks look possible in isolation even when the calendar says otherwise. |
| **Weekly and monthly reviews** | Builds review pages from daily work, completed tasks, meetings, and notes. | Reflection is most useful when grounded in what actually happened. |
| **LearnKit study context** | Surfaces due reviews, the weakest relevant domain, practice-exam context, and readiness blockers while LearnKit remains the review-state owner. | Study work competes with tasks unless it has a visible daily place. |
| **Experience layer** *(optional)* | Calculates XP, levels, streaks, achievements, overdue decay, and a reward bank from your Markdown activity. | A feedback loop can reinforce an established execution habit. |
| **Integration signals** | Marks Reminders, message capture, Granola, and LearnKit data fresh, stale, disabled, or not yet run. | Silent integrations make a dashboard misleading. |

## Install

### What you need

- Obsidian **1.4.0 or later**
- A vault where **Community plugins** are enabled
- `main.js`, `styles.css`, `manifest.json`, and `art-bundle.json` from the
  [latest Uptick release](../../releases/latest)

Nothing else is required for Home, Today, tasks, reviews, or core XP. You do
not need an API key, Python, another plugin, or an account for the base
installation.

### Standard installation

1. Create `YourVault/.obsidian/plugins/life-os/`.
2. Download the four release assets into that exact folder:

   ```text
   YourVault/.obsidian/plugins/life-os/
   ├── main.js
   ├── styles.css
   ├── manifest.json
   └── art-bundle.json
   ```

3. In Obsidian, open **Settings → Community plugins**, reload Obsidian if
   necessary, then enable **Uptick**.
4. Run **Uptick: Set up this vault** from the command palette.

Setup creates only missing folders, starter notes, and bundled achievement art.
It never overwrites existing files, so it is safe to run again. For an update,
replace the same four release assets and reload Obsidian. Keep `data.json`
local to your vault; it contains settings and is not a release asset.

### Guided installation walkthrough

After a fresh setup, Uptick opens a persistent walkthrough in Obsidian's right
sidebar. It is not a modal, so you can inspect the page a step opens and return
without losing your place.

The walkthrough covers:

1. starter folders or existing paths;
2. Home, Today, the canonical task inbox, and the daily review loop;
3. priority and difficulty metadata;
4. optional AI, mail, meeting, and Messages integrations;
5. recalculating the experience layer;
6. LearnKit, readiness, and the optional deck library; and
7. Modules, Layout, and Paths settings.

Use **Settings → Setup → Continue the walkthrough** to resume it, or run
**Uptick: Restart the guided walkthrough** to start it again.

### First-day configuration

Open **Settings → Uptick → Paths**. Uptick starts with a PARA-style layout, but
every location is configurable: Home, daily/weekly/monthly notes, task inbox,
meetings, reference notes, and game files. Point paths at folders you already
use before moving notes; missing paths are flagged in settings.

The default task inbox is `1 Tasks/Task Inbox.md`. A simple task is normal
Markdown:

```markdown
- [ ] Send the project update 📅 2026-09-02 #task ^task-project-update
  Source: [[Project meeting]]
```

The stable `^task-…` reference lets Today Plan point to this original task
without creating a copy. Completing a planned task updates canonical Markdown,
not a Reminders item or duplicate daily-note line.

Add up to three items to **Today Plan** from the existing-task suggestions,
then reorder or replace them until the plan is realistic. As the day changes,
complete, defer, or drop the plan item and add short work-log entries. Uptick
never reshuffles the plan, creates a task, changes a Reminder, schedules a
calendar event, or writes to LearnKit merely because it recommends something.

Use **Settings → Uptick → Modules** to disable whole areas and **Layout** to
hide individual Home or daily-note cards.

## Experience and study

### Core experience layer: no Python required

**Uptick: Recalculate XP, levels and achievements** calculates XP, levels,
streaks, achievements, overdue decay, and the reward bank locally in JavaScript.
It reads the vault and writes derived local Markdown/cache files. Run it when
you want numbers to catch up; rerunning it is safe.

Python 3.9+ is only needed for optional exam-readiness/card-count refreshes and
the advanced companion scripts. The plugin preserves existing LearnKit-derived
readiness cache data when it performs a local recalculation.

### LearnKit and readiness

Enable **Study** when you use LearnKit. When cards are due, Uptick can offer one
study session as a Today Plan candidate and explain the weakest relevant domain.
It keeps practice exams and readiness gates as context; it does not schedule
study or modify LearnKit's database.

For optional certification readiness/card-count refreshes, run the source-tree
Python engine:

```bash
VAULT="/absolute/path/to/your/vault" python3 engine/xp-sync.py --vault "$VAULT"
```

It has no third-party Python package dependency and needs no schedule unless
you want automatic readiness refreshes.

## Optional Obsidian plugins

Uptick parses its own Markdown and renders without these plugins. Install them
only when you want the capability shown below. **Settings → Uptick → Setup**
shows whether each is installed.

| Plugin | Optional capability it adds |
|---|---|
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | Renders Tasks-style due, done, and created dates and query blocks. Uptick can still read the text without it. |
| [Task List Kanban](https://github.com/ryxryx/task-list-kanban) | Provides the Kanban board linked from Uptick task pages. |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | Displays inline fields such as `[priority:: 3]` and `[difficulty:: 2]` as properties. |
| LearnKit | Provides Markdown flashcards, quizzes, and spaced-repetition scheduling. Uptick reads derived study/readiness data; it does not write the LearnKit database. |
| [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) | Creates daily, weekly, and monthly notes on a schedule. Uptick can create/open its own notes without it. |

If LearnKit is absent, turn off the **Study** module or use the Study Hub note
that Uptick creates. No study data is fabricated.

## Weather

Weather is optional. In **Settings → Uptick → Panels → Weather**, enter a
Visual Crossing API key, location, and units, then run **Uptick: Fetch the
weather**. Uptick writes a local cache that dashboards read; it does not fetch
in the background.

The key and location are sent to Visual Crossing only when you explicitly fetch
weather. You can instead schedule `optional/weather-fetch.py` from a source
checkout. The shared deck **Library** is also optional and contacts its
configured public registry only when you enable and use it; it never uploads
notes automatically.

## Themes

Uptick styles its own pages and **defines its own palette and reading width**,
so it looks the same under any theme. Earlier versions leaned on the Minimal
theme's `cssclasses: max` and on a CSS snippet that existed only in the author's
vault — a fresh install rendered every dashboard in a narrow column with nothing
to explain why.

## Advanced macOS companions

The release ZIP contains the plugin assets only. The optional scripts live in
this repository's `optional/` directory, so clone or download the source tree
if you want them:

```bash
git clone https://github.com/jcranokc/obsidian-uptick-public.git
cd obsidian-uptick-public
```

These integrations are intentionally **off by default**. Review each script,
use a status or dry-run mode first where available, and set `VAULT` to the
absolute path of the intended vault. They are not necessary for core planning.

| Integration | Benefit | You install or configure | What becomes automatic after setup |
| --- | --- | --- | --- |
| **Apple Reminders** | Keeps canonical Markdown tasks and chosen Reminders lists aligned, including priority, dates, status, duration, flags, and native tags. | macOS, [`remindctl`](https://github.com/steipete/remindctl), Reminders permission, the native-tag Shortcut, and the one-command scheduler below. | The bridge runs every 10 minutes even when Obsidian is closed; message capture and sent-mail completion can run inside it. |
| **Apple Mail** | Brings important actionable mail into the vault without importing the whole inbox. | macOS Mail permission, Python 3.9+, the companion files, and optionally an AI provider for triage. Enable **Scheduled job control** under Modules. | Uptick imports once when desktop Obsidian opens; **Import today's mail** is always available for a deliberate extra run. |
| **Messages** | Preserves a local read-only message catalogue and optionally turns clear incoming requests into canonical tasks. | macOS, Full Disk Access, Python 3.9+, and explicit **iMessage task capture** enablement in Reminders settings. | Task capture runs inside each configured Reminders sync; it is otherwise inactive. |
| **Granola** | Turns configured meeting imports into curated notes and only explicit commitments into tasks. | A working Codex CLI, authenticated Granola MCP/export access, and a review of `granola-sync.sh`. | Nothing by default. You may schedule the idempotent script after its first successful manual run; it limits remote checks to once per 10 minutes. |
| **Apple Calendar** | Gives Home and Today realistic meeting/time context from a local cache. | macOS Calendar permission and `calendar-export.py`; writes also need private target IDs. | Nothing by default. Schedule cache refresh only after verifying the read-only export. |
| **Photos** | Rotates a small local photo cache without putting full-resolution originals into the vault. | macOS Photos permission, ordinary local albums, and configured album names. | Nothing by default. Schedule only after the first export succeeds. |
| **Weather** | Adds current local weather to Home and daily notes. | Visual Crossing key and location. | Nothing by default; use **Fetch the weather** or schedule the cache job. |
| **Library** | Lets you browse and install shared study decks. | Enable the Library module. | Downloads only when you browse/choose a deck; never uploads. |

The existing `optional/vault-sync.sh` can orchestrate Calendar, Mail, meeting
template, Photos, and weather helpers after you intentionally place and
configure those companions in `4 System/Automation`. It is not enabled or
scheduled by a normal install, because those sources have separate permissions
and data-access decisions.

### Calendar, Messages, Granola, Photos, and weather

Each companion has a deliberately small boundary:

- **Calendar:** Run `calendar-export.py` after granting Calendar permission.
  It writes a local cache that Home and Today read. Event creation is disabled
  until you add a private `UPTICK_CALENDAR_ID`; a read-only export never needs
  that ID.
- **Messages catalogue:** Run `messages-import.py --dry-run` first, then a
  bounded import. This is separate from iMessage task capture and is useful for
  local search/recall. It needs Full Disk Access because the macOS Messages
  database is protected.
- **Granola:** Put `granola-sync.sh` in the automation folder, confirm
  `codex` is available on your PATH and its Granola MCP access is already
  authenticated, then run it once manually. The script records a checkpoint
  and deduplicates by Granola meeting ID, so scheduling it later does not
  backfill or duplicate prior imports.
- **Photos:** Configure `ALBUMS`, `PHOTO_PER_ALBUM`, and `PHOTO_MAX_PX`
  as needed, then run `photo-gallery-sync.sh`. It reads Photos, produces
  downscaled JPEGs in the vault, and leaves the Photos library unchanged.
- **Weather:** Use the built-in **Uptick: Fetch the weather** command after
  setting the Visual Crossing key and location. It is the fastest supported
  path; schedule `weather-fetch.py` only if you need a cache refresh while
  Obsidian is closed.

For any of these helpers, first copy the required source files to
`YourVault/4 System/Automation/` or run them from the source checkout with
`VAULT` set. Do not schedule a helper until its manual run has succeeded and
its requested macOS permission matches the data you intend it to access.

### Mail triage

`optional/mail-triage.py` classifies recent Apple Mail before
`email-import.py` creates vault reference notes. This reduces noisy imports:
mail triage can mark a message **important**, **routine**, or **spam**, and
`email-import.py` imports only the important messages.

The optional workflow is intentionally reviewable. A task can be created only
when the imported message contains an explicit actionable commitment; the
dashboard shows which messages did not expose a usable body, and muted senders
remain visible and reversible in **Settings → Uptick → Mail**.

```bash
export VAULT=/path/to/your/vault
python3 optional/mail-triage.py --hours 24 --explain --dry-run   # look first
python3 optional/mail-triage.py --hours 24                        # then commit
python3 optional/email-import.py --hours 24
```

Senders whose mail is repeatedly not important can stop being analysed:

- an **automated** sender (no-reply address, bulk footer) is muted the first
  time its mail is not important
- a **human** sender needs three non-important messages in a row, because one
  FYI from a colleague says nothing about the request they send next week
- one important message un-mutes a sender completely

Review the muted-sender list regularly. The mail script does not send, delete,
or mark Apple Mail messages.

### Which model

Three optional features can send text to a model — mail triage, meeting import,
and the Reminders workflow assistant. Nothing else in Uptick does; XP, levels,
achievements, task ranking, Today Plan suggestions, and normal dashboards are
local calculations over your own notes.

Pick a provider in **Settings → Modules → AI**. Most speak the same API, so the
list is broad: Anthropic, OpenAI, Google, DeepSeek, Moonshot (Kimi), Zhipu
(GLM), Alibaba (Qwen), MiniMax, xAI, Mistral, Groq, Together, OpenRouter, a
local Ollama or LM Studio, or the Codex CLI if you are already signed in to one.

For a hosted provider, place the key in an environment variable or an
absolute-path key file **outside** the vault, then enter the variable name or
file path in the AI settings. For Codex, install the CLI and sign in. Verify
the configuration from the source tree:

```bash
VAULT="/absolute/path/to/your/vault" python3 optional/llm.py
```

### Apple Reminders (optional, macOS)

Uptick can mirror the configured canonical task inbox and selected Apple
Reminders lists in both directions. The Markdown task remains canonical; the
bridge is the projection that gives you native notifications, widgets, and
mobile access without creating another independent backlog.

### Native Apple Reminders tags

The bridge handles portable fields such as title, due date, list, priority,
status, duration, completion, and flags. Apple's native tag metadata needs one
additional Shortcuts pass. **Uptick Apply Native Reminder Tags** runs after a
successful bridge so the tags are available to Apple's own tag filters and
smart lists.

One-time Mac setup:

1. Install [`remindctl`](https://github.com/steipete/remindctl), then grant
   it access to Reminders when macOS asks.
2. Open this [shared Shortcut](https://www.icloud.com/shortcuts/5a4692ef11c14845a29920ea42e7e953)
   on the Mac that will run the sync. Choose **Add Shortcut** and keep its
   default name: `Uptick Apply Native Reminder Tags`.
3. In Uptick, open **Settings → Reminders**, use **Test connection**, then
   **Use recommended setup** if the default Inbox, Work, Personal, House, and
   Waiting lists suit you. Existing exact-name lists are reused; missing lists
   are created only after confirmation.
4. Enable **two-way sync** and run a **Dry-run sync**. Review the result before
   using **Sync now**.
5. From the public source checkout, install the local scheduler:

   ```bash
   VAULT="/absolute/path/to/your/vault"
   zsh optional/install-uptick-reminders-sync.sh --vault "$VAULT" --install
   ```

The installer copies only its Reminders companions into
`4 System/Automation`, registers `com.uptick.reminders-sync` as a user
LaunchAgent, and starts it every 600 seconds. Each run performs:

```text
canonical Markdown task inbox → Reminders bridge → native-tag Shortcut
```

It logs to `4 System/Logs/uptick-reminders-sync-YYYY-MM-DD.log`. It will not
overwrite modified local companion files without `--upgrade`, and removal is
recoverable:

```bash
zsh optional/install-uptick-reminders-sync.sh --vault "$VAULT" --uninstall
```

Apple must show and receive the user's approval for the Shortcut and Reminders
permission; Uptick can open the Shortcut link but cannot bypass that consent.
If the Shortcut is absent, the bridge still runs and the log records that
native tag application was skipped.

### Routing and optional workflow tools

Explicit category tags always win. If automatic category matching is enabled,
it uses local, editable high-confidence cues; a tie stays in Inbox with
`#needs-triage`. The bridge never sends task text to AI merely to route it.

The optional Workflow Assistant adds a review queue, Waiting follow-up dates,
reschedule history, sync activity, selected/imported Mail capture, and a weekly
review. Cloud suggestions are off until you enable them and require approval
before they change a task. See the
[Reminders workflow assistant plan](docs/reminders-workflow-assistant-plan.md).

When enabled, **iMessage task capture** runs inside the same 10-minute
Reminders sync. It reads new local incoming messages, filters obvious system
noise, and creates only actionable requests in the canonical Task Inbox.
Messages data and the capture cursor stay local. It requires Full Disk Access
and is off by default.

When enabled, **sent-email completion** also runs inside the same sync. It
reads new Sent Mail locally and closes only one uniquely linked task that has a
clear completion phrase; ambiguous matches remain in **Email Completion
Review** for approval.

**Your API key is never stored in the vault.** `data.json` lives in `.obsidian/`
and syncs wherever your vault syncs — a key written there would be a key on
every machine you sync to and in every backup. Uptick reads it from an
environment variable, or a file outside the vault, and **refuses a key file
inside one**. There is no field to paste a key into, deliberately.

```bash
export ANTHROPIC_API_KEY=sk-...          # or whichever provider you chose
VAULT=/path/to/vault python3 optional/llm.py        # what is configured
VAULT=/path/to/vault python3 optional/llm.py --send # actually call it
```

Both scripts refuse before doing any work when the model is unreachable, and
say what to do — the exact `export`, or `npm i -g @openai/codex` and `codex
login` — rather than failing partway through with a stack trace.

**This step is not local.** The classifier sends the configured subject,
sender, and bounded message excerpt for each unclassified message to the model
provider you selected. Muted senders are not sent. Decide whether that is
acceptable for the mailbox you connect, especially if its content is subject to
an organisation's data policy.

Mail content is treated as untrusted input. The companion requires evidence
from the message body before creating a task, deduplicates re-deliveries, and
clamps model output before it reaches the vault. It does not create a task from
a subject line alone.

Everything currently muted is listed under **Settings → Uptick → Mail**, with
an Unmute control. The same local controls are available from the command line:

```bash
python3 optional/mail-triage.py --reset-sender someone@example.com
python3 optional/mail-triage.py --pin-sender always-read@example.com
python3 optional/mail-triage.py --mute-sender never-read@example.com
```

### Private integration configuration

Calendar writes, task-audit Reminders writes, ownership matching, and recurring
series rules are deliberately private configuration. Copy the template below
to your vault and keep it ignored:

```text
optional/uptick-private.env.example
    → YourVault/4 System/Automation/.uptick-private.env
```

Set only the values you need:

```dotenv
UPTICK_CALENDAR_ID=
UPTICK_REMINDER_LIST_ID=
UPTICK_OWNER_PATTERN=
UPTICK_ASSIGNEE_MARKERS=
UPTICK_SERIES_RULES_FILE=
```

Calendar and task-audit writes fail closed when their required target IDs are
missing. Do not put calendar IDs, Reminders IDs, account paths, rules, or API
keys in GitHub, plugin settings, issue text, or public screenshots. See
[public-release hardening](docs/public-release-hardening.md) for release
checks.

## Privacy and data boundaries

- Core Uptick reads and writes local Markdown and local plugin cache/settings
  files only.
- Weather contacts Visual Crossing only after an explicit fetch.
- Library contacts the configured public registry only when enabled and used.
- AI companions send only the text required by their configured operation to
  the provider you choose.
- Apple companions operate through your local macOS permissions.
- Reminders and Calendar writes stay disabled until you configure private
  target IDs.

Review a companion before granting Full Disk Access, Mail, Calendar, Photos, or
Reminders permission. Integration status surfaces freshness, failure, and
disabled states instead of silently presenting stale data as current.

## Development

No build step — `main.js` is plain CommonJS. Edit it, then run
*Reload app without saving* in Obsidian.

```bash
node engine/tests/clean_install_test.js  # empty vault, release files, setup
node engine/tests/tour_test.js           # the walkthrough's content and actions
node engine/tests/library_test.js        # the Library's network and path guards
node engine/tests/structure_test.js      # file shape, no nested renderers
node engine/tests/setup_test.js          # fresh-vault setup, custom paths
node engine/tests/test_plugin_render.js  # executes every view against a mock DOM
python3 engine/exam-readiness.py         # the FSRS readiness model
python3 engine/tests/test_xp.py          # the XP engine on a synthetic vault
python3 engine/tests/test_mail_triage.py # mail triage: muting rules, model-output clamping
python3 engine/tests/test_art_link.py    # achievement art matching and overwrite refusal
python3 engine/tests/test_llm.py         # every provider, and what it says when misconfigured
node engine/tests/parity_test.js         # the JS engine must match the Python exactly
python3 engine/tests/test_public_release_hardening.py # public/private release boundary
```

## Public release hardening

The repository intentionally contains no vault notes, task data, account IDs,
or integration targets. Optional Calendar, Reminders, task-audit, and recurring
series helpers load their targets and local rules from an ignored vault file and
remain non-mutating until configured. See [public release hardening](docs/public-release-hardening.md)
before publishing or configuring those companions.

### The JavaScript engine

`engine/uptick-engine.js` is a port of the Python XP engine, so that XP,
levels, achievements and the Reward Bank work from a plain plugin install with
no Python and no scheduled job. Run it with **Uptick: Recalculate XP, levels
and achievements**.

Still Python-only: exam readiness, the certification notes that feed it, and
the Achievements note table. Everything else — XP, levels, streaks, the 258
achievements, the Reward Bank, and the Quest Log's data — runs in the plugin.

The Python remains the reference implementation. `parity_test.js` runs both
over the same fixture and fails on any difference, because a port is only
worth having if you can prove it did not change any answers — and a one-XP
drift on a rounding boundary would otherwise go unnoticed for months.
Python rounds half to even and JavaScript rounds half up, so the port carries
its own `pyRound`.

The render suite runs without Obsidian and without a vault — it stubs the API
and uses fixtures in `engine/tests/fixtures/`.

## Achievement art

258 icons, one per achievement, and they **ship with the plugin**.
`art-bundle.json` is the fourth release file; **Uptick: Setup** writes the icons
into your vault, and never overwrites one you put there yourself.

They are 128px in the bundle — enough for the 44px browser tile and the ~160px
unlock popup on a retina display — which keeps the release compact. There is no
separate artwork download required for a standard installation.

Uptick finds them by slug: `4 System/Game/Achievement Art/<slug>.png` (`jpg`,
`webp`, `gif` and `svg` work too). Anything without a file falls back to a tier
medallion, which is a normal state rather than a missing-file error — and the
Achievements page says so when the folder is empty, rather than just looking
unfinished.

Generated images rarely arrive named that way. To file a folder of them:

```bash
export VAULT=/path/to/your/vault
python3 engine/link-achievement-art.py ~/Downloads/icons          # dry run
python3 engine/link-achievement-art.py ~/Downloads/icons --apply
```

It matches `First Blood.png`, `023_first-blood_final.png` and
`achievement_007 Centurion icon (1).png` all to the right slug. Add `--loose`
for fuzzy matching. It never overwrites existing art, and refuses to guess when
a filename matches more than one achievement.

`engine/build-icon-prompts.py` writes one generation prompt per achievement,
built from the live catalog so it cannot drift out of step with it.

## Docs

- [Gamification design](docs/gamification-design.md) — XP, decay, levels, the bank
- [Exam readiness model](docs/exam-readiness-model.md) — how readiness is computed
- [Achievements](docs/achievements.md) — all 258
- [Distribution plan](docs/distribution-plan.md) — what is left before this is
  properly installable

## License

MIT — see [LICENSE](LICENSE).
Before publishing, create the ignored `.uptick-release-audit-terms` file locally
with one private term per line, then run:

```bash
python3 engine/release-audit.py
```
