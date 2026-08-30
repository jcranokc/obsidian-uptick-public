# Public release hardening

Uptick is public code; a vault owner's data and integration identifiers are
not. Keep the following values only in the local, ignored file
`4 System/Automation/.uptick-private.env` (copy
`optional/uptick-private.env.example` as a starting point):

- `UPTICK_CALENDAR_ID` — explicit Calendar target for event creation.
- `UPTICK_REMINDER_LIST_ID` — dedicated task-audit Reminders list.
- `UPTICK_OWNER_PATTERN` and `UPTICK_ASSIGNEE_MARKERS` — local ownership rules.
- `UPTICK_SERIES_RULES_FILE` — optional private recurring-series rules.

Calendar and Reminders writes are disabled until their matching ID is present.
Do not add these values to plugin settings, a tracked environment file, issue,
commit message, release note, or shell history.

Before publishing, run the local checks in `engine/tests/test_public_release_hardening.py`,
the full regression suite, and a local term scan using an ignored
`.uptick-release-audit-terms` file. The release workflow also runs Gitleaks.

Only `main.js`, `styles.css`, `manifest.json`, and `art-bundle.json` belong in
the public plugin release asset set. Optional companions stay in source control
for transparent review but require private configuration before they can write
to external systems.
