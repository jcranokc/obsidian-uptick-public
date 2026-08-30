# Uptick

A dashboard workspace for Obsidian, with an optional experience layer.

Uptick renders your daily notes, tasks, meetings and reviews as dashboards
instead of walls of Markdown — and, if you want it, turns finishing things into
levels, achievements and a reward bank. Everything is local Markdown. Nothing
leaves your vault.

> **Status:** early. It works well in the vault it was built in, and the
> settings now make it configurable for others, but you are among the first
> people to install it somewhere else. Expect rough edges and file issues.

## What you get

- **Home** — today at a glance: an editable three-item Now plan, next meeting,
  integration freshness, open tasks, unread mail, recent notes, active projects,
  and areas of focus.
- **Daily notes** — a user-controlled three-item plan, priorities, scheduled
  meetings, tasks due, a work log and an end-of-day review, each editable as a
  card rather than a heading.
- **Meetings** — agendas, notes and actions, with recurring series.
- **Tasks** — one canonical Markdown file, with automatic priority and
  difficulty scoring.
- **Experience layer** *(optional)* — XP for finishing work and studying,
  levels, 258 achievements, escalating decay on overdue tasks, a reward bank,
  and an exam-readiness model built on FSRS.

## Install

1. Download `main.js`, `styles.css`, `manifest.json` and `art-bundle.json` from the
   [latest release](../../releases/latest).
2. Put them in `YourVault/.obsidian/plugins/life-os/`.
3. Enable **Uptick** in Settings → Community plugins.
4. Run **Uptick: Set up this vault** from the command palette.

On first launch a **guided walkthrough** opens in the right sidebar. It takes
about ten minutes, moves around the app as it goes, and covers what each page
is for, how tasks are scored, how the experience layer works, and what the
macOS integrations need. Reopen it any time from Settings → Setup.

Setup creates the folders and starter notes it needs. It never overwrites
anything, so it is safe to run again.

### Point it at your own folders

Uptick ships assuming a PARA-ish layout, but every path is a setting. Open
**Settings** in the Uptick sidebar → **Paths**, and point each one at folders
you already use. Anything that does not exist is flagged.

Under **Modules** and **Layout** you can turn off whole features and individual
cards.

## The experience layer needs Python

This is the part to read before deciding whether you want it.

The dashboards work entirely on their own. **XP, levels, achievements, the
reward bank and exam readiness are computed by a Python script that has to run
on a schedule.** Without it those pages render, and stay at zero.

```bash
# once, to check it works
VAULT="/path/to/your/vault" python3 engine/xp-sync.py --vault "$VAULT"
```

Then run it periodically. On macOS, edit and load
`engine/life-os-xp-sync.plist`; anywhere else, a cron entry works:

```cron
0 */3 * * * VAULT="/path/to/vault" /usr/bin/python3 /path/to/engine/xp-sync.py --vault "$VAULT"
```

Requires Python 3.9+. No packages to install.

Why it is not in the plugin: it started as a local script and has not been
ported yet. Porting it is the main thing standing between this and a
one-click install — see [docs/distribution-plan.md](docs/distribution-plan.md).

## Companion plugins

**None is required.** Uptick reads your Markdown directly and every dashboard
renders without any of them. Several pages *link* to what they provide, so a
vault without them has working pages pointing at notes nobody made — which
reads as Uptick being broken rather than a plugin being absent.

Settings → Setup lists them and shows which you already have:

| Plugin | What it adds |
|---|---|
| **Tasks** | Uptick reads and writes its date format (📅 due, ✅ done, ➕ created) |
| **Task List Kanban** | the board the task pages link to |
| **Dataview** | shows `[priority:: N]` / `[difficulty:: N]` as properties |
| **LearnKit** | flashcards and the spaced repetition the study pages are built on |
| **Periodic Notes** | daily/weekly/monthly notes on a schedule |

## Weather

Set a **Visual Crossing API key** and a location under Settings → Panels, then
**Uptick: Fetch the weather**. The free tier allows 1000 requests a day, which
is far more than this needs.

Nothing fetches on its own — run the command, or schedule
`optional/weather-fetch.py`, which writes the same cache. The key lives in your
settings file rather than an environment variable, because Obsidian has no
environment to read and this key is read-only, free and rate-limited. It is
sent to Visual Crossing and nowhere else, and never appears in a notice, an
error or the console.

Weather and the Library are the only two things in Uptick that use the network,
and both are off until you configure them. `structure_test.js` fails if a third
appears.

## Themes

Uptick styles its own pages and **defines its own palette and reading width**,
so it looks the same under any theme. Earlier versions leaned on the Minimal
theme's `cssclasses: max` and on a CSS snippet that existed only in the author's
vault — a fresh install rendered every dashboard in a narrow column with nothing
to explain why.

## `optional/` — macOS scripts, unsupported

The importers that fill this vault from Apple Mail, Calendar, Messages, Granola
and Photos. They are here as **reference, not as a feature**: macOS-only, they
assume tooling you probably do not have, and they are not maintained for anyone
else's setup. Read them before running them.

Each one requires `VAULT` to be set and will refuse to guess.

### Mail triage

`optional/mail-triage.py` decides which mail is worth importing at all.

Without it, `email-import.py` imports everything and runs a regex over each
message looking for request phrases. That approach answers "does this contain a
request?" when the real question is "is a request being made **of me**, that I
now owe?" — which is a question about meaning. On a real inbox the regex fired
on 13% of mail and was right about a third of the time.

Triage runs first, classifies each message as **important / routine / spam**,
and records what it learned about the *sender*. `email-import.py` then imports
only the important ones, and builds its tasks from the classifier's output —
with a priority, a difficulty and a due date — instead of from a regex match.

```bash
export VAULT=/path/to/your/vault
python3 optional/mail-triage.py --hours 24 --explain --dry-run   # look first
python3 optional/mail-triage.py --hours 24                        # then commit
python3 optional/email-import.py --hours 24
```

Senders whose mail is never important stop being analysed:

- an **automated** sender (no-reply address, bulk footer) is muted the first
  time its mail is not important
- a **human** sender needs three non-important messages in a row, because one
  FYI from a colleague says nothing about the request they send next week
- one important message un-mutes a sender completely

So the volume sent to the classifier shrinks as the list learns, and the mail
you actually care about keeps being read.

### Which model

Three optional features can send text to a model — mail triage, the meeting
import, and the Reminders workflow assistant. Nothing else in Uptick does; XP,
levels, all 258 achievements and exam readiness are arithmetic over your own
notes.

Pick a provider in **Settings → Modules → AI**. Most speak the same API, so the
list is broad: Anthropic, OpenAI, Google, DeepSeek, Moonshot (Kimi), Zhipu
(GLM), Alibaba (Qwen), MiniMax, xAI, Mistral, Groq, Together, OpenRouter, a
local Ollama or LM Studio, or the Codex CLI if you are already signed in to one.

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

**This step is not local.** Subject, sender and the first 1500 characters of
each *unclassified* message go to the classifier — everything else in Uptick
is vault I/O on your own machine. Muted senders are never sent at all. Decide
whether that is acceptable for your mail before turning it on; if your inbox is
work mail, that is a question for your employer's data policy, not just for you.

The classifier is never asked whether a message is important. It is asked
narrower questions — is this correspondence or a notification, is the owner
being asked to act, **copy the sentence that asks**, who is it aimed at — and
the verdict is worked out from the answers here, in code. A message is
important only when the owner is asked to act, the request is not aimed at
someone else, and the quoted sentence is genuinely in the body.

That last check does the most work. A model that has decided a message is a
request will produce a plausible-sounding quote for it either way; only the
body settles it. Asking for a straight important/routine label gave two
different answers on the same mail a day apart, and quoting does not drift the
same way.

**Apple Mail cannot always hand over a body.** Roughly two in five Exchange
messages come back with an empty body *and* an empty preview — the signature of
a message synced as headers only, read on another device, whose content this Mac
never downloaded. Retrying does not help; the same copy fails every time.

Two things soften it. Exchange often delivers a message twice, and Mail will
extract one copy cleanly while returning nothing for its twin — so a copy with
no body borrows its twin's. And where nothing can be recovered, the subject
still places the message well enough to classify it, but **no task is ever
written from a subject line**: a task needs specifics that only the body
carries. Those messages are flagged and counted, so the rule can be judged
against what it does.

Re-deliveries are collapsed before classification: two copies of one message,
same sender and subject within two minutes, are judged once.

Near-identical tasks are merged across a run: six notices about three sandboxes
should be three tasks, not six. Comparison is on distinguishing words only, so
"provisioning for FullTest" and "provisioning for INTG" stay separate — the
sandbox name is the whole difference between them. The survivor records how
many it stands for.

Message bodies are untrusted input to a prompt, so the classifier is told to
treat any instructions found inside a message as evidence that the message is
manipulative, and its output is clamped before anything reaches your vault:
tasks are capped and stripped, values clamped, non-ISO dates dropped, and a
message id the classifier invents is discarded.

Everything it has muted is listed under **Settings → Mail**, with an Unmute
button, or from the command line:

```bash
python3 optional/mail-triage.py --reset-sender someone@example.com
python3 optional/mail-triage.py --pin-sender always-read@example.com
python3 optional/mail-triage.py --mute-sender never-read@example.com
```

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
unlock popup on a retina display — which keeps it to a few megabytes beside a
plugin that is otherwise under half a megabyte. The full-resolution 512px set is
`achievement-art.zip` on the same release if you want it:

```bash
unzip achievement-art.zip -d "<your vault>/4 System/Game"
```

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
