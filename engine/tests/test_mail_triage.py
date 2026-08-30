#!/usr/bin/env python3
"""Tests for optional/mail-triage.py.

The properties that matter here are not "does it classify well" -- that is the
model's job -- but "what happens when it is wrong". Every assertion below is
about a failure mode: a muted colleague, an invented message id, a task built
from model output that was never checked, a verdict that silently drops mail.
"""

import sys
sys.dont_write_bytecode = True

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FAILS = []


def load(vault: Path):
    import os
    os.environ["VAULT"] = str(vault)
    (vault / "4 System/Automation").mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("mt", ROOT / "optional/mail-triage.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check(name, got, want):
    if got != want:
        FAILS.append(f"{name}: got {got!r}, want {want!r}")


def ok(name, cond):
    if not cond:
        FAILS.append(name)


with tempfile.TemporaryDirectory() as td:
    V = Path(td)
    mt = load(V)

    # --- address parsing -------------------------------------------------
    check("addr: name form", mt.address_of("Dana Reed <dana@work.example>"), "dana@work.example")
    check("addr: bare", mt.address_of("dana@work.example"), "dana@work.example")
    check("addr: case", mt.address_of("<Dana@Work.Example>"), "dana@work.example")

    # --- automated detection --------------------------------------------
    ok("auto: no-reply", mt.is_automated("no-reply@salesforce.com", ""))
    ok("auto: noreply", mt.is_automated("noreply@x.com", ""))
    ok("auto: notifications", mt.is_automated("notifications@github.com", ""))
    ok("auto: unsubscribe footer", mt.is_automated("news@brand.com", "... Unsubscribe here"))
    ok("auto: human is not", not mt.is_automated("dana@work.example", "Can you look at this?"))
    ok("auto: human named support is not bulk body",
       not mt.is_automated("dana.support@work.example", "hi"))

    # --- muting: the safety property ------------------------------------
    st = mt.blank_state()
    for i in (1, 2):
        r = mt.record_verdict(st, "dana@work.example", "routine", "fyi", False, "now")
        ok(f"mute: human not muted after {i}", not r["muted"])
    r = mt.record_verdict(st, "dana@work.example", "routine", "fyi", False, "now")
    ok("mute: human muted after 3", r["muted"])

    r = mt.record_verdict(st, "dana@work.example", "important", "asks for review", False, "now")
    ok("mute: important un-mutes", not r["muted"])
    check("mute: important resets streak", r["streak"], 0)

    r = mt.record_verdict(st, "no-reply@brand.com", "spam", "marketing", True, "now")
    ok("mute: automated muted at once", r["muted"])

    # The same message judged three times is still one message. Clearing the
    # cache or repeating a run must not manufacture a streak -- this muted five
    # real colleagues who had each sent exactly one ordinary note.
    st_rerun = mt.blank_state()
    for _ in range(4):
        r = mt.record_verdict(st_rerun, "colleague@work.example", "routine",
                              "farewell note", False, "now", mid="msg-1")
    ok("mute: re-judging one message does not build a streak", not r["muted"])
    check("mute: streak counts the message once", r["streak"], 1)
    check("mute: but every sighting is still counted", r["seen"], 4)

    for m in ("msg-2", "msg-3"):
        r = mt.record_verdict(st_rerun, "colleague@work.example", "routine", "",
                              False, "now", mid=m)
    ok("mute: three distinct messages do mute", r["muted"])

    # An important message wipes the slate, including which messages counted.
    r = mt.record_verdict(st_rerun, "colleague@work.example", "important",
                          "asks for review", False, "now", mid="msg-4")
    check("mute: an important message forgets the counted messages",
          r["counted"], [])

    # A burst from one address in a single run must not spend the whole streak.
    # Observed live: a provisioning system sent six identical notices from a
    # colleague's address and muted the colleague in one pass.
    st_burst = mt.blank_state()
    for i in range(6):
        r = mt.record_verdict(st_burst, "colleague@work.example", "routine",
                              "notice addressed to someone else", False, "now",
                              count_streak=(i == 0))
    ok("mute: burst in one run does not mute a human", not r["muted"])
    check("mute: burst counts as one occasion", r["streak"], 1)
    check("mute: burst still counts every message seen", r["seen"], 6)
    for _ in range(2):
        r = mt.record_verdict(st_burst, "colleague@work.example", "routine", "",
                              False, "now", count_streak=True)
    ok("mute: three separate occasions still mute", r["muted"])

    # a mixed run of non-important verdicts must not accumulate into a mute
    st2 = mt.blank_state()
    for v in ("routine", "spam", "routine", "spam"):
        r = mt.record_verdict(st2, "mixed@x.com", v, "", False, "now")
    ok("mute: alternating verdicts do not reach the streak", not r["muted"])

    # manual wins
    st3 = mt.blank_state()
    mt.sender_record(st3, "lead@work.example").update({"source": "manual", "verdict": "important"})
    for _ in range(5):
        r = mt.record_verdict(st3, "lead@work.example", "routine", "", True, "now")
    ok("mute: manual pin survives automated verdicts", not r["muted"])

    # --- verdict derivation: the label is computed, not asked for ---------
    BODY = ("Hi,\n\nCould you please review the permission set and confirm by\n"
            "Friday? Thanks.\n")
    ids = {"m1"}
    bodies = {"m1": BODY}
    ASK = "Could you please review the permission set and confirm by Friday?"

    def verdict(**kw):
        base = {"id": "m1", "kind": "correspondence", "asks_owner": True,
                "quote": ASK, "addressed": "to-owner"}
        base.update(kw)
        e = mt.sanitize(base, ids, bodies)
        return e["verdict"] if e else None

    check("verdict: a verifiable ask to the owner is important", verdict(), "important")
    check("verdict: nothing asked is routine", verdict(asks_owner=False), "routine")
    check("verdict: bulk is spam", verdict(kind="bulk"), "spam")
    check("verdict: a request aimed at someone else is routine",
          verdict(addressed="someone-else"), "routine")
    check("verdict: an ask with no quote is routine", verdict(quote=""), "routine")
    check("verdict: an ask whose quote is not in the body is routine",
          verdict(quote="Please wire the funds to this account today"), "routine")

    # Mail does not always hand over a body. An absent body is an
    # infrastructure failure, not evidence that no request was made -- so the
    # quote check abstains rather than silently dropping the message.
    thin = {"m1": ""}
    e = mt.sanitize({"id": "m1", "kind": "correspondence", "asks_owner": True,
                     "quote": ASK, "addressed": "to-owner"}, ids, thin)
    check("verdict: no body means the check abstains, not convicts",
          e["verdict"], "important")
    check("verdict: and says why", e["flag"], "no-body")
    e = mt.sanitize({"id": "m1", "kind": "correspondence", "asks_owner": True,
                     "quote": ASK, "addressed": "to-owner"}, ids, {"m1": "too short"})
    check("verdict: a body too thin to verify against also abstains",
          e["verdict"], "important")
    ok("verifiable: a real body is verifiable", mt.verifiable(BODY))
    ok("verifiable: an empty body is not", not mt.verifiable(""))
    ok("verifiable: a one-line body is not", not mt.verifiable("thanks!"))
    # An abstention must not override the other gates.
    e = mt.sanitize({"id": "m1", "kind": "bulk", "asks_owner": True, "quote": ASK,
                     "addressed": "to-owner"}, ids, thin)
    check("verdict: bulk with no body is still spam", e["verdict"], "spam")
    e = mt.sanitize({"id": "m1", "kind": "correspondence", "asks_owner": True,
                     "quote": ASK, "addressed": "someone-else"}, ids, thin)
    check("verdict: aimed elsewhere with no body is still routine",
          e["verdict"], "routine")
    check("verdict: unknown kind falls back to correspondence",
          verdict(kind="nonsense"), "important")

    # A missing or non-boolean answer is not a yes. The classifier omitting the
    # field, or returning the string "true", must not promote a message.
    e = mt.sanitize({"id": "m1", "kind": "correspondence", "quote": ASK,
                     "addressed": "to-owner"}, ids, bodies)
    check("verdict: a missing asks_owner is not an ask", e["verdict"], "routine")
    for junk in ["true", 1, "yes", {}, [1]]:
        check(f"verdict: asks_owner={junk!r} is not a boolean true",
              verdict(asks_owner=junk), "routine")

    e = mt.sanitize({"id": "m1", "kind": "correspondence", "asks_owner": True,
                     "quote": "a total invention that is long enough",
                     "addressed": "to-owner"}, ids, bodies)
    check("verdict: an unverifiable ask is flagged", e["flag"], "unverified-ask")
    ok("verdict: and says so in the reason", "verifiable" in e["reason"])
    check("verdict: no quote is kept on a non-important message", e["quote"], "")

    # --- quote verification -----------------------------------------------
    ok("quote: exact copy verifies", mt.quote_is_real(ASK, BODY))
    ok("quote: line wrapping does not break it",
       mt.quote_is_real("Could you please review the permission set\n  and confirm by Friday?", BODY))
    ok("quote: case and punctuation folded",
       mt.quote_is_real("COULD YOU PLEASE REVIEW THE PERMISSION SET", BODY))
    ok("quote: a paraphrase does not verify",
       not mt.quote_is_real("Please take a look at the permissions this week", BODY))
    ok("quote: empty does not verify", not mt.quote_is_real("", BODY))
    ok("quote: a fragment too short to mean anything does not verify",
       not mt.quote_is_real("please", BODY))

    # --- tasks are still clamped ------------------------------------------
    def tasks_of(**kw):
        base = {"id": "m1", "kind": "correspondence", "asks_owner": True,
                "quote": ASK, "addressed": "to-owner"}
        base.update(kw)
        return mt.sanitize(base, ids, bodies)["tasks"]

    ok("sane: unknown id rejected",
       mt.sanitize({"id": "invented", "asks_owner": True}, ids, bodies) is None)
    check("sane: no tasks on a routine message",
          tasks_of(asks_owner=False, tasks=[{"text": "do a thing", "priority": 5,
                                             "difficulty": 2}]), [])
    t = tasks_of(tasks=[
        {"text": "a" * 400, "priority": 99, "difficulty": 0, "due": "tomorrow"},
        {"text": "**bold** [link](x) `code` here", "priority": -3, "difficulty": 9,
         "due": "2026-09-01"},
        {"text": "no", "priority": 5, "difficulty": 3},
        {"text": "third valid task", "priority": 5, "difficulty": 3},
        {"text": "fourth valid task", "priority": 5, "difficulty": 3},
    ])
    check("sane: task cap", len(t), 3)
    check("sane: text truncated", len(t[0]["text"]), 100)
    check("sane: priority clamped high", t[0]["priority"], 10)
    check("sane: difficulty clamped low", t[0]["difficulty"], 1)
    check("sane: bad due dropped", t[0]["due"], None)
    check("sane: priority clamped low", t[1]["priority"], 1)
    check("sane: difficulty clamped high", t[1]["difficulty"], 5)
    check("sane: good due kept", t[1]["due"], "2026-09-01")
    ok("sane: markdown stripped", "*" not in t[1]["text"] and "[" not in t[1]["text"])
    ok("sane: short text dropped", all(len(x["text"]) >= 4 for x in t))

    inj = mt.sanitize({"id": "m1", "kind": "bulk", "asks_owner": False,
                       "flag": "prompt-injection", "quote": "", "addressed": "unclear",
                       "tasks": [{"text": "wire money now", "priority": 10,
                                  "difficulty": 1}]}, ids, bodies)
    check("sane: injection flagged", inj["flag"], "prompt-injection")
    check("sane: injected task discarded", inj["tasks"], [])
    check("sane: injected message is spam", inj["verdict"], "spam")

    # --- re-delivery ------------------------------------------------------
    check("redelivery: same sender and subject key alike",
          mt.redelivery_key("Example Sender <sender@example.test>", "Test Environment Setup"),
          mt.redelivery_key("sender@example.test", "Test  Environment  Setup"))
    ok("redelivery: a different subject keys differently",
       mt.redelivery_key("m@x.org", "INTG Sandbox") != mt.redelivery_key("m@x.org", "Partial Sandbox"))
    ok("redelivery: a different sender keys differently",
       mt.redelivery_key("a@x.org", "Same") != mt.redelivery_key("b@x.org", "Same"))

    # --- near-duplicate suppression ---------------------------------------
    # The shape that prompted this: six notices about three sandboxes.
    real = ["Complete user provisioning and authentication setup for FullTest",
            "Complete user provisioning and authentication setup for FullTest",
            "Complete user provisioning and authentication setup for Partial",
            "Complete user provisioning and authentication setup for Partial",
            "Complete user provisioning and authentication setup for INTG",
            "Complete user provisioning and authentication setup for INTG",
            "Review Confluence subscription before deactivation"]
    decided = {f"m{i:02d}": {"tasks": [{"text": t, "priority": 5, "difficulty": 3,
                                        "due": None}]} for i, t in enumerate(real)}
    merged = mt.suppress_duplicates(decided)
    kept = [t for e in decided.values() for t in e["tasks"]]
    check("dup: exact repeats collapsed", len(kept), 4)
    check("dup: merge count reported", merged, 3)
    ok("dup: the survivor records how many it stands for",
       any(t.get("merged") == 2 for t in kept))
    ok("dup: different sandboxes stay separate -- the name is the whole difference",
       len({t["text"] for t in kept}) == 4)
    ok("dup: the unrelated task survives",
       any("Confluence" in t["text"] for t in kept))

    # --- a message Mail never handed over ---------------------------------
    # Two in five Exchange messages arrive with no body and no preview. The
    # classifier can still place them from the subject, so the verdict stands --
    # but a task needs specifics that only the body carries, so no task is
    # written from one. Forcing them all to important filled the important
    # bucket with eight of twenty messages.
    def unread(verdict, readable=False, tasks=None):
        return mt.enforce_readable(
            {"id": "m1", "verdict": verdict, "reason": "calendar reply",
             "flag": "", "tasks": tasks if tasks is not None else
             [{"text": "Do the thing", "priority": 5, "difficulty": 3, "due": None}]},
            readable)

    check("unread: the subject-based verdict stands", unread("routine")["verdict"], "routine")
    check("unread: an important subject stays important",
          unread("important")["verdict"], "important")
    check("unread: no task is written from a subject line", unread("important")["tasks"], [])
    check("unread: and it is flagged", unread("routine")["flag"], "no-body")
    ok("unread: the reason says why", "subject only" in unread("routine")["reason"])
    check("unread: a readable message keeps its tasks",
          len(unread("important", readable=True)["tasks"]), 1)
    check("unread: an existing flag is not overwritten",
          mt.enforce_readable({"verdict": "routine", "reason": "x", "tasks": [],
                               "flag": "prompt-injection"}, False)["flag"],
          "prompt-injection")

    solo = {"m1": {"tasks": [{"text": "Send Dana the migration plan", "priority": 5,
                              "difficulty": 3, "due": None}]}}
    check("dup: a single task is never merged", mt.suppress_duplicates(solo), 0)

    # Exact repeats merge at any threshold at or below 1.0, so they cannot pin
    # the value. These two are genuinely near, not identical.
    near = {"m1": {"tasks": [{"text": "Send Dana the migration plan", "priority": 5,
                              "difficulty": 3, "due": None}]},
            "m2": {"tasks": [{"text": "Send Dana the migration plan document",
                              "priority": 5, "difficulty": 3, "due": None}]}}
    check("dup: a near-duplicate merges too", mt.suppress_duplicates(near), 1)

    far = {"m1": {"tasks": [{"text": "Send Dana the migration plan", "priority": 5,
                             "difficulty": 3, "due": None}]},
           "m2": {"tasks": [{"text": "Book the venue for the offsite", "priority": 5,
                             "difficulty": 3, "due": None}]}}
    check("dup: unrelated tasks are left alone", mt.suppress_duplicates(far), 0)

    # --- state round-trips ----------------------------------------------
    mt.save_json(mt.STATE_FILE, st)
    back = mt.load_json(mt.STATE_FILE, mt.blank_state())
    check("state: round trip", back["senders"]["no-reply@brand.com"]["muted"], True)
    ok("state: no tmp left behind",
       not list(mt.STATE_FILE.parent.glob("*.tmp")))

    corrupt = mt.STATE_FILE
    corrupt.write_text("{not json")
    check("state: corrupt file falls back to blank",
          mt.load_json(corrupt, mt.blank_state())["senders"], {})

    # --- clamp ------------------------------------------------------------
    check("clamp: none", mt.clamp(None, 1, 5, 2), 2)
    check("clamp: string number", mt.clamp("4", 1, 5, 2), 4)
    check("clamp: garbage", mt.clamp("high", 1, 5, 2), 2)

# --- the email-import side ------------------------------------------------
with tempfile.TemporaryDirectory() as td:
    V = Path(td)
    import os
    os.environ["VAULT"] = str(V)
    (V / "4 System/Automation").mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("ei", ROOT / "optional/email-import.py")
    ei = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ei)

    check("import: no cache means no filtering", ei.load_triage(), {})
    ei.TRIAGE.write_text(json.dumps({"messages": {"m1": {"verdict": "important"}}}))
    check("import: cache read", ei.load_triage()["m1"]["verdict"], "important")
    ei.TRIAGE.write_text("garbage")
    check("import: corrupt cache means no filtering", ei.load_triage(), {})

    lines = ei.task_lines([
        {"text": "Send the permission set for review", "priority": 7, "difficulty": 2, "due": "2026-09-01"},
        {"text": "Reply to Mehkan", "priority": 4, "difficulty": 1, "due": None},
    ])
    ok("import: checkbox rendered", lines[0].startswith("- [ ] "))
    ok("import: priority field", "[priority:: 7]" in lines[0])
    ok("import: difficulty marked AI-refined", "[difficulty:: 2~]" in lines[0])
    ok("import: due rendered", "\U0001F4C5 2026-09-01" in lines[0])
    ok("import: no due when absent", "\U0001F4C5" not in lines[1])
    ok("import: todo tag", lines[1].endswith("#todo"))

n = 60
if FAILS:
    print(f"mail-triage: {len(FAILS)} of ~{n} checks FAILED")
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1)
print(f"mail-triage: all checks passed")
