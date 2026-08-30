---
title: Automation tests
type: reference
cssclasses:
  - life-os
---

# Automation tests

Everything here is local and read-only against the vault except `test_xp.py`,
which builds its own throwaway vault in a temp directory.

| Command | Covers |
|---|---|
| `python3 "4 System/Automation/exam-readiness.py"` | 27 checks — the FSRS curve against its own definition, mastery monotonicity, retake discounting, every readiness gate, milestone XP arithmetic |
| `python3 "4 System/Automation/tests/test_xp.py"` | 19 checks — zero start, escalating decay, the blocked clock, idempotency, the global decay cap, levels never regressing, outage forgiveness |
| `python3 "4 System/Automation/tests/test_reminders_sync.py"` | Pure projection checks for configurable lists, two-way fields, tags, dates, priority, and stable task IDs |
| `node "4 System/Automation/tests/structure_test.js"` | Reads `main.js` itself: every renderer is top-level, every dispatched view has a renderer, braces balance, and no render function is nested inside another |
| `node "4 System/Automation/tests/test_plugin_render.js"` | 27 checks — actually executes the plugin's render functions against a mock DOM: the Home header, the date-scoped daily header, the day XP card, the achievements browser, and the unlock modal |
| `python3 "4 System/Automation/xp-sync.py" --vault "$PWD" --audit` | The catalog note and `achievements.py` name the same 258 achievements, no drift |

The Node test stubs Obsidian's API in `node_modules/obsidian/` and its DOM
extensions in `domshim.js`, so it runs without Obsidian. It catches the class of
bug a syntax check cannot — calling a method that does not exist, or a render
path that throws on real data.

## Why the dashboards are executed

`renderHome` and `renderDaily` are the largest and most-edited functions in the
plugin, and for a long time nothing called them. Two bugs shipped as a result,
both with a fully green suite:

- a patch nested `renderHome` **inside** `renderDaily` — caught now by
  `structure_test.js`
- a patch trapped `const grid` inside an `if` block, so every card after it
  threw `grid is not defined` — caught now by executing the function

Both regressions were re-introduced deliberately to confirm the tests fail on
them. The all-cards-off case is also exercised, since that is exactly when a
variable declared inside a guard goes missing.

## Why the structural test exists

The render suite can only exercise functions it can call, and it never called
`renderHome` or `renderDaily`. When a bad patch nested `renderHome` **inside**
`renderDaily`, all 93 render checks still passed and the Home page threw
`renderHome is not defined` on open. `structure_test.js` reads the file and
would have failed immediately. Run it first — it is the cheapest check here.

Run them all:

```bash
cd "$VAULT" && node "4 System/Automation/tests/structure_test.js" && python3 "4 System/Automation/exam-readiness.py" && python3 "4 System/Automation/tests/test_xp.py" && node "4 System/Automation/tests/test_plugin_render.js"
```
