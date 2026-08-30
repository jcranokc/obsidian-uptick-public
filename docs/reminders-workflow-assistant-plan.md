# Reminders Workflow Assistant

This plan extends Uptick's local-first, two-way Apple Reminders integration. The
existing Reminders sync remains the transport and conflict boundary; this work
adds the review and accountability layer around it.

## Product behavior

- Uncategorized tasks enter a review queue. The existing Uptick AI provider
  setting, including an authenticated Codex CLI, may suggest category, status,
  duration, phone capability, and priority. Suggestions show confidence and
  reasons and require approval. Explicit task tags always win. Corrections are
  private learning signals; local cue inference remains the offline fallback.
- Waiting is a real state for both `#blocked` and `#dependency`. A task keeps
  its original due date, gains a separate follow-up date and reason, and uses
  the existing Waiting reminder with a follow-up tag. Waiting tasks do not lose
  XP to decay. When unblocked, the original due date is restored.
- Every due-date change creates private reschedule history. Rescheduling does
  not reset accrued delay or decay. The activity panel keeps a permanent local
  audit trail until the user explicitly clears it.
- Selected Apple Mail messages and imported email-reference notes produce an
  approval preview. Approved actions become one parent task plus child tasks in
  Obsidian and native Reminders subtasks. Completing a parent completes its
  children in both systems, and message/action identifiers deduplicate repeats.
- The Waiting dashboard groups overdue, upcoming, undated, aging, and
  reason-specific blockers. The weekly assistant presents triage, overdue,
  Waiting, and reschedule recommendations, applies only approved actions, and
  appends a concise record to the configured weekly review note.
- The activity view filters safe event summaries, opens the task inbox for an
  affected item, exports a redacted report, and clears activity only after an
  explicit confirmation. Reschedule history, links, and learning rules remain
  private unless the user deliberately exports a review artifact.
- Sent Apple Mail completion detection is opt-in and runs in the existing
  10-minute sync. It reads only new Sent messages, ignores quoted content,
  requires explicit completion language, and auto-completes only one uniquely
  linked open task. Multiple or uncertain matches enter a private review queue.
- iMessage task capture is an optional local companion that runs before the
  existing Reminders reconciliation. It scans only new incoming messages,
  filters obvious system/reaction traffic, creates actionable requests as a
  parent with child tasks, and applies the same category, priority, duration,
  phone, status, and due-date metadata used by Reminders. Explicit categories
  win; uncertain categories remain in Inbox with `#needs-triage`.

## Technical boundaries

The feature adds versioned workflow-assistant settings and private state beside
the current Reminders link/projection state. IDs, Mail locators, vault paths,
full email bodies, and API keys do not enter public code, Reminder Notes, or
task titles. Cloud triage sends only the minimum fields needed for a suggestion
and uses the already configured provider; no second credential store is added.

The macOS companion uses `remindctl` for standard reminder data and AppleScript
for capabilities not exposed by the CLI, including native parent/subtask
relationships and flags. It is opt-in and desktop-gated; it never installs
dependencies or runs on mobile.

Sent-mail completion uses a separate local AppleScript reader and private cursor
state. It does not send mail, change mail state, or depend on a Shortcut.

The iMessage task companion uses the local Messages database read-only and
keeps its cursor, message associations, and scan activity in private state. It
does not create tasks for outgoing messages, verification codes, reactions, or
ordinary conversation. Model classification is disabled unless explicitly
enabled in settings; local rules remain the fallback when no model is usable.

## Verification and rollout

Add fixtures for migration, triage approval/correction, Waiting transitions,
follow-up dates, rescheduling, conflict resolution, activity events, Mail
capture, hierarchy completion, dashboards, and review-note preservation. Run
the existing JavaScript and Python suites, Python compilation, type/static
checks, and a manual macOS permission and Reminders hierarchy smoke test.

Enable each assistant module independently so an unavailable AI provider,
Mail permission, or Reminders companion does not disable ordinary Uptick task
management.

## Recovery and privacy

The configured Reminders state file is local vault state. It contains the
Obsidian-to-Reminder link map, private workflow history, learning corrections,
and opaque Apple Mail locators. It is never copied into a Reminder title or
Notes field and is not included in the public checkout. Restore that file from
backup before restoring a vault snapshot; if it is missing, the bridge can
recover unlinked reminders by exact title/list matching but cannot guarantee
every historical association. Cloud triage is opt-in, runs only after provider
preflight, and sends cleaned task fields without IDs, vault paths, or Mail
locators.
