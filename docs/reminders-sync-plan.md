---
title: Configurable Obsidian and Apple Reminders Sync
type: design
status: implemented
created: 2026-08-29
tags:
  - life-os
  - reminders
---

# Configurable Obsidian and Apple Reminders Sync

Uptick's Reminders integration is an optional, macOS-only companion feature.
The plugin owns the user-facing configuration; a local helper owns access to
Apple Reminders and Apple Mail. The public repository contains generic code and
defaults only. A user's list IDs, reminder IDs, task content, and Mail locators
remain local.

## Configuration

The saved `reminders` configuration contains:

- `enabled`, `preset`, `inboxList`, `waitingList`, `routes`, `tags`,
  `priorityMap`, `mail`, `statePath`, and `conflictResolution`.
- Routes map an Obsidian category tag to a selected Reminders list. The
  recommended preset maps `#work`, `#personal`, and `#house` to matching lists.
- Work, Personal, and House use `#not-started` and `#in-progress` status tags.
  Waiting uses `#blocked` or `#dependency`; uncertain Inbox items use
  `#needs-triage`.

“Use recommended setup” reuses exact-name lists and creates only missing lists
after confirmation. It never deletes, renames, or moves existing reminders.

## Synchronization contract

The canonical Obsidian task store remains the configured Task Inbox. Each linked
task has a stable block ID and a private mapping to a Reminders ID. The private
state stores the last normalized projection for each field, allowing unrelated
edits to merge. If the same field changed in both applications, the Reminders
value wins. Completion and reopening are symmetric.

The shared projection includes title, details, due date, list/category, status,
duration, phone capability, blocked/dependency state, priority, flag,
completion, and an optional Mail URL. Reminders titles and Notes never contain
internal IDs or source paths.

Exactly one duration tag is emitted: `#10min`, `#20min`, or `#30min`. Highest
Obsidian priority maps to High plus the Reminders flag. Lower priorities map to
High, Medium, or Low using the configured numeric mapping.

## Companion boundary

The local companion uses `remindctl` for list/reminder JSON and AppleScript only
for the flag and opening the original Mail message. It reports missing access,
missing tooling, malformed state, and mobile availability without silently
changing data. The plugin can render and edit configuration without the helper;
connection/setup/sync controls explain when the helper is unavailable.

Apple's supported Reminders automation exposes lists but not visual list
sections. Status is therefore represented with tags rather than attempting to
create “Not Started” and “In Progress” sections.

## Rollout and verification

Implement and test the projection/state layer first, then the companion, then
the settings UI. Run fixture-based two-way sync tests, configuration migration
tests, JavaScript structure/render tests, Python compilation/type checks, and a
manual macOS smoke test. Migrate legacy generated reminders only through a
dry-run-first command and preserve their due dates.

See [`agents/prd.json`](../agents/prd.json) for the executable story list.
