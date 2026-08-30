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

| Integration | Additional requirement | What it does | First safe check |
| --- | --- | --- | --- |
| **Apple Reminders** | macOS, [`remindctl`](https://github.com/steipete/remindctl), and Reminders permission | Optional two-way projection between canonical Markdown tasks and selected Reminders lists. | `python3 optional/reminders-sync.py --vault "$VAULT" --status` |
| **Apple Calendar** | macOS and Calendar automation permission | Reads a local Calendar cache for dashboard context; writes require a private configured target ID. | `VAULT="$VAULT" python3 optional/calendar-export.py` |
| **Apple Mail** | macOS, Python 3.9+, Mail automation permission; optional model configuration for triage | Imports mail references and can create tasks from explicit workflow rules. | `VAULT="$VAULT" python3 optional/mail-triage.py --hours 24 --dry-run` |
| **Messages** | macOS, Python 3.9+, and Full Disk Access | Imports a local read-only Messages catalogue. Task capture remains disabled until explicitly enabled. | `VAULT="$VAULT" python3 optional/messages-import.py --days 7 --dry-run` |
| **Granola** | A locally configured Granola export/MCP workflow and, for AI extraction, model configuration | Imports meeting material and can create tasks only for explicit commitments. | Review `optional/granola-sync.sh` before running it. |
| **Photos** | macOS and Photos automation permission | Exports a downscaled local photo-gallery cache for the rotating photo card. | Review `optional/photo-gallery-sync.sh` before running it. |
| **Scheduled jobs** | macOS desktop plus jobs you configured yourself | Displays and optionally re-runs your own jobs; Uptick does not install a scheduler. | Leave the module off until jobs already work outside Obsidian. |

For the full local sync sequence, inspect `optional/vault-sync.sh`. It
orchestrates only tools you choose to configure; it is not part of normal
installation.

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

The workflow assistant extension is described in the
[Reminders workflow assistant plan](docs/reminders-workflow-assistant-plan.md).

Uptick can optionally synchronize tasks in both directions with Apple
Reminders. Open **Settings → Reminders** to choose your lists and tags, test
the local macOS companion, or apply the recommended setup. The companion uses
`remindctl`, requires Reminders permission, and is off until you enable it.
For a manual install, include `optional/reminders-sync.py`,
`optional/reminders-flag.applescript`, and
`optional/open-mail-message.applescript`,
`optional/reminders-hierarchy.applescript`,
`optional/mail-selected-task.applescript`,
`optional/email-task-capture.py`, and
`optional/workflow-assistant.py`, `optional/email-completion.py`, and
`optional/mail-sent-completions.applescript` with the plugin. Dragging an Apple
Mail message URL into an Obsidian task lets the bridge place it in the
Reminder URL field; clicking it opens Mail. Uptick never installs `remindctl`
or changes macOS permissions for you.

The recommended setup maps Work, Personal, House, Waiting, and Inbox and uses
status tags rather than visual Reminder sections. It never publishes reminder
content, list IDs, or Mail identifiers. See
[`docs/reminders-sync-plan.md`](docs/reminders-sync-plan.md).

For tasks that arrive without a category tag, the normal sync applies a local,
high-confidence category match using editable route-specific cues. Explicit
tags always win, and ambiguous tasks remain in Inbox with the configured
needs-triage tag. The optional Workflow assistant can send only the fields
needed for a triage suggestion to the already configured AI provider, after an
explicit user action; it requires approval before changing a task. Configure
both in **Settings → Reminders**.

The workflow assistant also provides a triage learning queue, Waiting follow-up
dates, a Waiting dashboard, private reschedule history, filtered/exportable sync
activity, an approval preview for imported or selected Apple Mail messages, and
a guided weekly review. Use **Capture task from selected Apple Mail message**
from the command palette or open an imported email reference note first. The
private state file is the recovery boundary: back it up before changing paths,
and use the activity export or clear-history controls from the in-vault reports;
no state file is part of the public checkout.

The optional iMessage task capture companion reads new incoming Messages
locally during the same sync. It filters obvious system messages, creates
actionable requests in the canonical Task Inbox, and applies the same category,
priority, duration, phone, status, and due-date metadata used by Reminders.
Enable it in **Settings → Reminders → iMessage task capture**. Category tags
route directly; unresolved categories remain in Inbox with `#needs-triage`.
The capture cursor and message associations stay in private state, and the
feature never requires Shortcuts.

The optional sent-email completion feature runs with the existing 10-minute
sync. It reads only new messages in Apple Mail's Sent mailbox and requires an
explicit completion phrase such as “completed” or “done”. One uniquely linked
task may be completed automatically; ambiguous matches appear in **Email
Completion Review** and require approval. It is off by default, stores its
cursor and match evidence locally, and does not require Shortcuts.

For a macOS scheduled wrapper, import the bundled
[`optional/Uptick Apply Native Reminder Tags.shortcut`](optional/Uptick%20Apply%20Native%20Reminder%20Tags.shortcut)
into Shortcuts, then set `UPTICK_NATIVE_TAG_SHORTCUT` to its exact name. The
wrapper runs that Shortcut only after the Reminders bridge succeeds, verifies
that the Shortcut exists, logs its result, and leaves the setting empty by
default for other installations.

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
