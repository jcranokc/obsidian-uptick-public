#!/usr/bin/env python3
"""One way to reach a language model, whichever one you use.

Uptick's AI features -- mail triage, meeting import -- shell out to whatever
you have configured rather than binding to one vendor. Three shapes cover
everything:

  openai-compatible   OpenAI, DeepSeek, Moonshot (Kimi), Zhipu (GLM),
                      Alibaba (Qwen), MiniMax, xAI, Mistral, Groq, Together,
                      OpenRouter, and a local Ollama or LM Studio
  anthropic           Claude, which uses its own message shape
  google              Gemini, which uses its own again
  codex               the Codex CLI, already signed in, no key handled here

YOUR KEY IS NEVER STORED IN THE VAULT
    Settings records which provider and model you want and WHERE the key comes
    from -- an environment variable, or a file path outside the vault. The key
    itself is never written to data.json, because that lives in .obsidian/ and
    syncs wherever your vault syncs. A key in a synced folder is a key on every
    machine and in every backup.

USAGE
    from llm import Provider
    p = Provider.load(vault)
    ok, why = p.preflight()          # cheap, no request
    text = p.complete(prompt)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

TIMEOUT = 180

# name -> (kind, base url, default model, env var people usually already have)
PROVIDERS = {
    "codex":      ("codex",  "", "", ""),
    "openai":     ("openai", "https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY"),
    "anthropic":  ("anthropic", "https://api.anthropic.com/v1",
                   "claude-sonnet-4-5", "ANTHROPIC_API_KEY"),
    "google":     ("google", "https://generativelanguage.googleapis.com/v1beta",
                   "gemini-2.0-flash", "GEMINI_API_KEY"),
    "deepseek":   ("openai", "https://api.deepseek.com/v1", "deepseek-chat",
                   "DEEPSEEK_API_KEY"),
    "moonshot":   ("openai", "https://api.moonshot.cn/v1", "moonshot-v1-32k",
                   "MOONSHOT_API_KEY"),
    "zhipu":      ("openai", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash",
                   "ZHIPU_API_KEY"),
    "qwen":       ("openai", "https://dashscope.aliyuncs.com/compatible-mode/v1",
                   "qwen-plus", "DASHSCOPE_API_KEY"),
    "minimax":    ("openai", "https://api.minimax.chat/v1", "abab6.5s-chat",
                   "MINIMAX_API_KEY"),
    "xai":        ("openai", "https://api.x.ai/v1", "grok-2-latest", "XAI_API_KEY"),
    "mistral":    ("openai", "https://api.mistral.ai/v1", "mistral-small-latest",
                   "MISTRAL_API_KEY"),
    "groq":       ("openai", "https://api.groq.com/openai/v1",
                   "llama-3.3-70b-versatile", "GROQ_API_KEY"),
    "together":   ("openai", "https://api.together.xyz/v1",
                   "meta-llama/Llama-3.3-70B-Instruct-Turbo", "TOGETHER_API_KEY"),
    "openrouter": ("openai", "https://openrouter.ai/api/v1",
                   "anthropic/claude-sonnet-4.5", "OPENROUTER_API_KEY"),
    "ollama":     ("openai", "http://localhost:11434/v1", "llama3.1", ""),
    "custom":     ("openai", "", "", ""),
}

# Providers that genuinely need no key: a local server, or a CLI that holds
# its own session.
KEYLESS = {"codex", "ollama"}


class LlmError(RuntimeError):
    """Something the user can act on, phrased so they can."""


class Provider:
    def __init__(self, cfg: dict, vault: Path):
        ai = (cfg.get("ai") or {}) if isinstance(cfg.get("ai"), dict) else {}
        self.vault = vault
        self.name = str(ai.get("provider") or "codex").strip().lower()
        if self.name not in PROVIDERS:
            self.name = "custom"
        kind, base, model, env = PROVIDERS[self.name]
        self.kind = kind
        self.base = str(ai.get("baseUrl") or base).rstrip("/")
        self.model = str(ai.get("model") or model)
        self.key_env = str(ai.get("keyEnv") or env)
        self.key_file = str(ai.get("keyFile") or "")
        self.bin_set = bool(ai.get("codexBin") or os.environ.get("CODEX_BIN"))
        self.bin = str(ai.get("codexBin") or os.environ.get("CODEX_BIN")
                       or "/opt/homebrew/bin/codex")
        self.temperature = ai.get("temperature", 0)

    @classmethod
    def load(cls, vault: Path) -> "Provider":
        p = Path(vault) / ".obsidian/plugins/life-os/data.json"
        try:
            return cls(json.loads(p.read_text(encoding="utf-8")), vault)
        except (OSError, json.JSONDecodeError):
            return cls({}, vault)

    # ------------------------------------------------------------- the key

    def key(self) -> str:
        """The API key, from the environment or a file. Never from the vault."""
        if self.key_env:
            v = os.environ.get(self.key_env, "").strip()
            if v:
                return v
        if self.key_file:
            path = Path(self.key_file).expanduser()
            try:
                # A key file inside the vault would sync; refuse rather than
                # quietly spread it.
                if self.vault and str(path.resolve()).startswith(str(Path(self.vault).resolve())):
                    raise LlmError(
                        f"the key file {path} is inside the vault, which syncs. "
                        "Move it somewhere outside, such as ~/.config/uptick/key.")
                return path.read_text(encoding="utf-8").strip()
            except OSError:
                return ""
        return ""

    # -------------------------------------------------------------- checks

    def preflight(self) -> tuple[bool, str]:
        """Can this run at all? Cheap: no request is made.

        Returns (ok, message). The message is written for someone who has just
        turned the feature on and needs to know what to do next.
        """
        if self.name == "custom" and not self.base:
            return False, ("No provider is configured. Choose one in "
                           "Settings → Modules → AI.")
        if self.kind == "codex":
            found = Path(self.bin).exists()
            if not found and not self.bin_set:
                # Nothing was configured, so the default is only a guess --
                # look on PATH before complaining.
                onpath = shutil.which("codex")
                if onpath:
                    self.bin = onpath
                    found = True
            if not found:
                return False, (
                    f"The Codex CLI was not found at {self.bin}.\n"
                    "  Install it:  npm i -g @openai/codex\n"
                    "  Sign in:     codex login\n"
                    "Or choose a different provider in Settings → Modules → AI.")
            return True, f"Codex CLI at {self.bin}"
        if not self.model:
            return False, (f"No model set for {self.name}. Set one in "
                           "Settings → Modules → AI.")
        if self.name not in KEYLESS and not self.key():
            where = (f"the {self.key_env} environment variable" if self.key_env
                     else "a key file")
            return False, (
                f"No API key found for {self.name}. Uptick looks in {where} and "
                "never stores keys in your vault.\n"
                f"  export {self.key_env or 'YOUR_KEY_ENV'}=sk-...\n"
                "Or point Settings → Modules → AI at a key file outside the vault.")
        return True, f"{self.name} · {self.model}"

    def describe(self) -> dict:
        ok, why = self.preflight()
        return {"provider": self.name, "kind": self.kind, "model": self.model,
                "base": self.base, "ready": ok, "detail": why,
                "key_source": (self.key_env or self.key_file or
                               ("none needed" if self.name in KEYLESS else "not set"))}

    # ------------------------------------------------------------ requests

    def complete(self, prompt: str, *, system: str = "",
                 max_tokens: int = 8000) -> str:
        """Send one prompt, return the text. Raises LlmError with something
        the user can act on."""
        ok, why = self.preflight()
        if not ok:
            raise LlmError(why)
        if self.kind == "codex":
            return self._codex(prompt)
        if self.kind == "anthropic":
            return self._anthropic(prompt, system, max_tokens)
        if self.kind == "google":
            return self._google(prompt, system, max_tokens)
        return self._openai(prompt, system, max_tokens)

    def _post(self, url: str, payload: dict, headers: dict) -> dict:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read().decode("utf-8")).get("error", {})
                detail = detail.get("message", "") if isinstance(detail, dict) else str(detail)
            except Exception:
                pass
            hint = {
                401: "the key was rejected — check it is current and for this provider",
                403: "the key is not allowed to use this model",
                404: f"the model {self.model!r} does not exist at {self.base}",
                429: "rate limited or out of credit",
            }.get(e.code, "")
            raise LlmError(f"{self.name} returned HTTP {e.code}"
                           + (f": {detail}" if detail else "")
                           + (f" ({hint})" if hint else "")) from None
        except urllib.error.URLError as e:
            raise LlmError(
                f"could not reach {self.base} — {e.reason}. "
                + ("Is the local server running?" if "localhost" in self.base
                   else "Check the network and the base URL.")) from None
        except json.JSONDecodeError:
            raise LlmError(f"{self.name} returned something that was not JSON") from None

    def _openai(self, prompt: str, system: str, max_tokens: int) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": prompt}]
        payload = {"model": self.model, "messages": msgs, "max_tokens": max_tokens}
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        key = self.key()
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        data = self._post(f"{self.base}/chat/completions", payload, headers)
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise LlmError(f"{self.name} returned no message content") from None

    def _anthropic(self, prompt: str, system: str, max_tokens: int) -> str:
        payload = {"model": self.model, "max_tokens": max_tokens,
                   "messages": [{"role": "user", "content": prompt}]}
        if system:
            payload["system"] = system
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        data = self._post(f"{self.base}/messages", payload, {
            "x-api-key": self.key(), "anthropic-version": "2023-06-01"})
        try:
            return "".join(b.get("text", "") for b in data["content"]
                           if b.get("type") == "text")
        except (KeyError, TypeError):
            raise LlmError("anthropic returned no text content") from None

    def _google(self, prompt: str, system: str, max_tokens: int) -> str:
        payload = {"contents": [{"parts": [{"text": prompt}]}],
                   "generationConfig": {"maxOutputTokens": max_tokens}}
        if self.temperature is not None:
            payload["generationConfig"]["temperature"] = self.temperature
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        url = f"{self.base}/models/{self.model}:generateContent?key={self.key()}"
        data = self._post(url, payload, {})
        try:
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError):
            raise LlmError("gemini returned no text content") from None

    def _codex(self, prompt: str) -> str:
        """The CLI holds its own session, so nothing here touches a key."""
        try:
            p = subprocess.run(
                [self.bin, "exec", "--cd", str(self.vault),
                 "--sandbox", "workspace-write", "--skip-git-repo-check", prompt],
                capture_output=True, text=True, timeout=TIMEOUT * 4)
        except subprocess.TimeoutExpired:
            raise LlmError("the Codex CLI timed out") from None
        except OSError as e:
            raise LlmError(f"could not run {self.bin}: {e}") from None
        if p.returncode != 0:
            tail = (p.stderr or p.stdout or "").strip()[-400:]
            raise LlmError(
                f"codex exited {p.returncode}"
                + (f": {tail}" if tail else "")
                + "\nIf it says you are not signed in, run: codex login")
        return p.stdout or ""


FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.M)


def parse_json(text: str):
    """Pull a JSON value out of a model response.

    Models wrap JSON in fences, prefix it with "Here is", or add a trailing
    sentence, whatever the prompt says. Strip the usual decorations and, as a
    last resort, take the outermost bracketed span.
    """
    s = FENCE_RE.sub("", str(text or "")).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("[", "]"), ("{", "}")):
        i, j = s.find(opener), s.rfind(closer)
        if i != -1 and j > i:
            try:
                return json.loads(s[i:j + 1])
            except json.JSONDecodeError:
                continue
    raise LlmError("the model did not return usable JSON")


def main() -> int:
    """`python3 llm.py` checks the configured provider and says what is wrong."""
    vault = os.environ.get("VAULT")
    if not vault:
        print("llm: set VAULT to your vault path", file=sys.stderr)
        return 2
    p = Provider.load(Path(vault))
    info = p.describe()
    print(json.dumps(info, indent=2))
    if not info["ready"]:
        return 1
    if "--send" in sys.argv:
        try:
            print(p.complete('Reply with exactly: {"ok": true}').strip()[:200])
        except LlmError as e:
            print(f"llm: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
