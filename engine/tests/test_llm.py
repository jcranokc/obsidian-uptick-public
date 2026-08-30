#!/usr/bin/env python3
"""Tests for optional/llm.py.

The things worth pinning are what happens when it is misconfigured, because
that is the state every new user starts in. A stack trace there is the
difference between "I need to set a key" and "this is broken".

No network. Requests are faked at the transport.
"""

import sys
sys.dont_write_bytecode = True

import importlib.util
import json
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FAILS = []


def check(name, got, want):
    if got != want:
        FAILS.append(f"{name}: got {got!r}, want {want!r}")


def ok(name, cond):
    if not cond:
        FAILS.append(name)


with tempfile.TemporaryDirectory() as td:
    V = Path(td) / "vault"
    (V / ".obsidian/plugins/life-os").mkdir(parents=True)
    os.environ["VAULT"] = str(V)
    spec = importlib.util.spec_from_file_location("llm", ROOT / "optional/llm.py")
    llm = importlib.util.module_from_spec(spec)
    sys.modules["llm"] = llm
    spec.loader.exec_module(llm)

    def prov(ai, env=None):
        for k in list(os.environ):
            if k.endswith("_API_KEY"):
                del os.environ[k]
        for k, v in (env or {}).items():
            os.environ[k] = v
        return llm.Provider({"ai": ai}, V)

    # --- every listed provider is usable ----------------------------------
    for name, (kind, base, model, envvar) in llm.PROVIDERS.items():
        if name == "custom":
            continue
        p = prov({"provider": name})
        check(f"{name}: kind", p.kind, kind)
        ok(f"{name}: has a default model or is the CLI", bool(p.model) or kind == "codex")
        ok(f"{name}: has a base url or is the CLI", bool(p.base) or kind == "codex")
    ok("the Chinese providers are all present",
       {"deepseek", "moonshot", "zhipu", "qwen", "minimax"} <= set(llm.PROVIDERS))
    ok("a local option is present", "ollama" in llm.PROVIDERS)

    # --- preflight says what to do ----------------------------------------
    p = prov({"provider": "openai"})
    good, why = p.preflight()
    ok("no key: not ready", not good)
    ok("no key: names the environment variable", "OPENAI_API_KEY" in why)
    ok("no key: says keys are never stored in the vault", "never stores keys" in why)

    p = prov({"provider": "deepseek"}, {"DEEPSEEK_API_KEY": "sk-test"})
    good, why = p.preflight()
    ok("with a key: ready", good)
    ok("with a key: names the model", "deepseek-chat" in why)

    p = prov({"provider": "ollama"})
    ok("a local provider needs no key", p.preflight()[0])

    p = prov({"provider": "codex", "codexBin": "/nope/codex"})
    good, why = p.preflight()
    ok("missing CLI: not ready", not good)
    ok("missing CLI: says how to install it", "npm i -g" in why)
    ok("missing CLI: says how to sign in", "codex login" in why)
    ok("missing CLI: offers another provider", "Settings" in why)

    p = prov({"provider": "custom"})
    ok("no provider chosen: not ready", not p.preflight()[0])
    p = prov({"provider": "openai", "model": ""})
    p.model = ""
    ok("no model: not ready", not p.preflight()[0])

    # --- the key never comes from the vault -------------------------------
    inside = V / "secret.txt"
    inside.write_text("sk-inside")
    p = prov({"provider": "openai", "keyFile": str(inside)})
    try:
        p.key()
        FAILS.append("a key file inside the vault must be refused")
    except llm.LlmError as e:
        ok("refusing a vault key file explains why", "syncs" in str(e))

    outside = Path(td) / "key.txt"
    outside.write_text("  sk-outside\n")
    p = prov({"provider": "openai", "keyFile": str(outside)})
    check("a key file outside the vault is read and stripped", p.key(), "sk-outside")

    p = prov({"provider": "openai"}, {"OPENAI_API_KEY": "sk-env"})
    check("the environment wins when both are set", p.key(), "sk-env")

    stored = {"ai": {"provider": "openai", "apiKey": "sk-should-not-be-used"}}
    (V / ".obsidian/plugins/life-os/data.json").write_text(json.dumps(stored))
    for k in list(os.environ):
        if k.endswith("_API_KEY"):
            del os.environ[k]
    p = llm.Provider.load(V)
    check("a key pasted into data.json is ignored", p.key(), "")
    ok("and such a provider is reported as not ready", not p.preflight()[0])

    # --- request shapes, without a network --------------------------------
    sent = {}

    def fake_post(url, payload, headers):
        sent.clear()
        sent.update(url=url, payload=payload, headers=headers)
        if "anthropic" in url:
            return {"content": [{"type": "text", "text": "hi from claude"}]}
        if "generativelanguage" in url:
            return {"candidates": [{"content": {"parts": [{"text": "hi from gemini"}]}}]}
        return {"choices": [{"message": {"content": "hi from openai"}}]}

    for name, key_env, want_text, want_auth in [
        ("openai", "OPENAI_API_KEY", "hi from openai", "Authorization"),
        ("deepseek", "DEEPSEEK_API_KEY", "hi from openai", "Authorization"),
        ("zhipu", "ZHIPU_API_KEY", "hi from openai", "Authorization"),
        ("qwen", "DASHSCOPE_API_KEY", "hi from openai", "Authorization"),
        ("anthropic", "ANTHROPIC_API_KEY", "hi from claude", "x-api-key"),
        ("google", "GEMINI_API_KEY", "hi from gemini", None),
    ]:
        p = prov({"provider": name}, {key_env: "sk-test"})
        p._post = fake_post
        check(f"{name}: returns the text", p.complete("hello", system="be brief"), want_text)
        ok(f"{name}: posts to its own base url", sent["url"].startswith(p.base))
        if want_auth:
            ok(f"{name}: sends the key in {want_auth}", want_auth in sent["headers"])
        else:
            ok("google: sends the key in the query string", "key=sk-test" in sent["url"])

    p = prov({"provider": "openai"}, {"OPENAI_API_KEY": "k"})
    p._post = fake_post
    p.complete("hello", system="be brief")
    ok("openai: the system prompt is sent as a system message",
       sent["payload"]["messages"][0] == {"role": "system", "content": "be brief"})

    p = prov({"provider": "anthropic"}, {"ANTHROPIC_API_KEY": "k"})
    p._post = fake_post
    p.complete("hello", system="be brief")
    check("anthropic: the system prompt is its own field",
          sent["payload"]["system"], "be brief")
    ok("anthropic: sends the api version header",
       "anthropic-version" in sent["headers"])

    # --- a misconfigured provider never reaches the transport -------------
    reached = []
    p = prov({"provider": "openai"})
    p._post = lambda *a, **k: reached.append(1)
    try:
        p.complete("hello")
        FAILS.append("a provider with no key must raise, not send")
    except llm.LlmError:
        pass
    check("nothing was sent", reached, [])

    # --- parsing what models actually return ------------------------------
    check("plain json", llm.parse_json('{"a": 1}'), {"a": 1})
    check("fenced json", llm.parse_json('```json\n{"a": 1}\n```'), {"a": 1})
    check("bare fence", llm.parse_json('```\n[1, 2]\n```'), [1, 2])
    check("json with a preamble",
          llm.parse_json('Here you go:\n[{"id": "x"}]\nHope that helps.'),
          [{"id": "x"}])
    check("an array wins when both appear",
          llm.parse_json('note {"a":1}\n[1]'), [1])
    try:
        llm.parse_json("no json at all")
        FAILS.append("unparseable text must raise")
    except llm.LlmError:
        pass

if FAILS:
    print(f"llm: {len(FAILS)} checks FAILED")
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1)
print("llm: all checks passed")
