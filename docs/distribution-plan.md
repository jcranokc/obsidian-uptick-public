---
title: Uptick Distribution Plan
type: design
status: proposed
created: 2026-08-23
tags:
  - life-os
cssclasses:
  - life-os
---

# Distribution Plan

What it takes to make Uptick something a stranger can install from GitHub.
Written after an audit of the built system, so the blockers below are the real
ones rather than a guess.

## What exists today

| Piece | Size | Distributable as-is |
|---|---|---|
| `main.js` — 25 views, dashboards, game layer, settings | ~6,900 lines | Yes, once paths are configurable — **done** |
| `styles.css` | ~3,400 lines | Yes |
| `xp-sync.py` — the XP engine | ~1,600 lines | **No** — see Python, below |
| `achievements.py` — 258 achievements | ~450 lines | Yes |
| `exam-readiness.py` — FSRS readiness model | ~500 lines | Yes |
| `build-practice-deck.py`, `build-practice-exams.py` | ~600 lines | Yes |
| `priority-task-sync.py` — priority + difficulty | ~500 lines | Yes |
| Apple Mail / Calendar / Messages / Granola / photo importers | ~2,500 lines | **No** — macOS and personal-account specific |

## The four blockers

### 1. Hard-coded vault paths — SOLVED

Thirty paths assumed a PARA layout with this vault's exact folder names.
Someone whose daily notes live in `Journal/` got nothing. Paths are now
settings, resolved through `applyPaths()` at load, with a Paths tab in the
settings page that flags any that do not exist.

### 2. The XP engine is Python on a schedule — OPEN

`xp-sync.py` runs under launchd every few hours. That is fine for one person on
one Mac and unacceptable as an install step for anyone else: it needs Python,
a launchd agent, and a shell.

Three options, in order of preference:

- **Port the engine into the plugin.** It is deterministic file reading and
  arithmetic — everything it does, the plugin can do on an interval. Removes
  Python, launchd, and the platform dependency in one move. Perhaps 1,200 lines
  of TypeScript, and the 46 existing Python tests are the specification.
- **Ship Python as optional.** Core dashboards work without it; the game layer
  needs a setup script. Cheap, but the headline feature becomes advanced-only.
- **Bundle a helper binary.** Rejected — a plugin shipping a binary is a hard
  sell in a community-plugin review, and rightly so.

### 3. macOS-only importers — OPEN

Apple Mail, Apple Calendar, Messages, Granola and the photo gallery are
AppleScript and personal API keys. These are not features of a distributable
plugin; they are this vault's private plumbing.

The fix is a boundary, not a rewrite. Each of these already writes a cache file
that the plugin reads — `calendar-cache.json`, `weather-cache.json`,
`achievements-cache.json`. **Publish the cache formats** and ship the importers
as a separate optional repo. The plugin then depends on a documented file
shape, not on macOS.

### 4. Companion plugin dependency — OPEN

Uptick reads data produced by Dataview, Tasks, Kanban and LearnKit. Obsidian
has no dependency mechanism, so this needs:

- a startup check that names any missing plugin and what breaks without it
- graceful degradation rather than an exception
- a documented list in the README

Nothing here is hard; it is just currently absent.

## Sequence

1. **Settings and configurable paths** — done.
2. **Dependency check and graceful degradation** — small, and it is what stops
   a first run looking broken.
3. **Split the repo**: `life-os` (plugin) and `life-os-importers` (the macOS
   plumbing), with the cache formats documented between them.
4. **Port the XP engine to TypeScript**, using the Python tests as the spec.
5. **First-run setup**: create the folder structure and seed notes from the
   configured paths, so an empty vault is usable immediately.
6. Release workflow, `versions.json`, and a community-plugin submission.

## Honest assessment

Steps 1–3 make this installable by a technical person willing to read a README.
Step 4 is what makes it installable by anyone, and it is the largest single
piece of work left — a real port, not a repackaging.

The gamification layer is the differentiator and it is the part most tied to
Python. That is the tension to resolve before this is worth publishing.
