#!/usr/bin/env python3
"""Cache a short weather forecast for the Uptick dashboard.

Reuses the Visual Crossing key and location already configured in the
`visual-crossing-weather` plugin rather than asking for a second copy — one
subscription, one place to change the location.

The key is read from the plugin's data.json and used only to build the request.
It is never logged, printed, or written into the cache.

Writes 4 System/Automation/weather-cache.json:
    { fetched, location, units, now, today, hours[48], days[15], past[7] }

RECORD COST
    Visual Crossing bills a day-with-hours as 24 records and a day without as
    1. Pulling 15 days *with* hours would be 360 records per run — 1080/day at
    the current three-times-daily schedule, over the free tier. So this makes
    three cheap calls instead: 48 hourly (2 days), 15 daily, 7 historical =
    about 70 records a run, ~210/day.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path


def require_vault() -> str:
    """The vault to operate on. Never guesses — a wrong guess writes into the
    wrong vault, which is worse than refusing to run."""
    v = os.environ.get("VAULT")
    if not v:
        raise SystemExit(
            "Set VAULT to your vault's path, e.g.\n"
            '  VAULT="$HOME/Documents/MyVault" python3 ' + os.path.basename(__file__))
    return v


VAULT = Path(require_vault())
SETTINGS = VAULT / ".obsidian/plugins/visual-crossing-weather/data.json"
CACHE = VAULT / "4 System/Automation/weather-cache.json"
API = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline"


def main() -> int:
    try:
        cfg = json.loads(SETTINGS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "error": f"cannot read plugin settings: {e}"}))
        return 2

    key = cfg.get("apikey") or ""
    location = (cfg.get("location_one") or "").strip()
    units = cfg.get("units") or "us"
    if not key or not location:
        print(json.dumps({"ok": False, "error": "plugin has no API key or location set"}))
        return 2

    def fetch(path: str, params: str) -> dict | None:
        url = (f"{API}/{urllib.parse.quote(location)}/{path}"
               f"?unitGroup={urllib.parse.quote(units)}&{params}"
               f"&key={urllib.parse.quote(key)}&contentType=json")
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            # Never echo the URL — it carries the key.
            return None

    DAY_FIELDS = ("datetime,temp,tempmax,tempmin,feelslike,conditions,icon,"
                  "humidity,windspeed,windgust,precip,precipprob,cloudcover,"
                  "uvindex,sunrise,sunset,pressure,visibility,snow,dew")
    HOUR_FIELDS = ("datetime,temp,feelslike,conditions,icon,humidity,windspeed,"
                   "precip,precipprob,cloudcover,uvindex,dew")

    today_s = datetime.now().strftime("%Y-%m-%d")
    plus1 = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    plus14 = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
    minus7 = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    hourly = fetch(f"{today_s}/{plus1}",
                   f"include=current,hours&elements={HOUR_FIELDS},tempmax,tempmin,sunrise,sunset")
    if hourly is None:
        print(json.dumps({"ok": False, "error": "hourly request failed"}))
        return 1
    daily = fetch(f"{today_s}/{plus14}", f"include=days&elements={DAY_FIELDS}") or {}
    past = fetch(f"{minus7}/{today_s}", f"include=days&elements={DAY_FIELDS}") or {}
    data = hourly

    day = (data.get("days") or [{}])[0]
    cur = data.get("currentConditions") or {}
    def slim_day(d: dict) -> dict:
        return {k: d.get(k) for k in (
            "datetime", "tempmax", "tempmin", "temp", "conditions", "icon",
            "humidity", "windspeed", "precip", "precipprob", "cloudcover",
            "uvindex", "sunrise", "sunset")}

    def slim_hour(h: dict) -> dict:
        return {k: h.get(k) for k in (
            "datetime", "temp", "feelslike", "conditions", "icon", "humidity",
            "windspeed", "precip", "precipprob", "cloudcover", "uvindex")}

    now_iso = datetime.now().strftime("%Y-%m-%dT%H")
    hours: list[dict] = []
    for d in (hourly.get("days") or []):
        for h in (d.get("hours") or []):
            stamp = f"{d.get('datetime')}T{str(h.get('datetime'))[:2]}"
            if stamp >= now_iso:
                hh = slim_hour(h)
                hh["date"] = d.get("datetime")
                hours.append(hh)
    hours = hours[:48]

    out = {
        "fetched": datetime.now().astimezone().isoformat(timespec="seconds"),
        "location": data.get("resolvedAddress") or location,
        "units": units,
        "now": {
            "temp": cur.get("temp"),
            "feelslike": cur.get("feelslike"),
            "conditions": cur.get("conditions"),
            "icon": cur.get("icon"),
            "humidity": cur.get("humidity"),
            "wind": cur.get("windspeed"),
            "uv": cur.get("uvindex"),
            "cloudcover": cur.get("cloudcover"),
            "precipprob": cur.get("precipprob"),
        },
        "today": slim_day(day),
        "hours": hours,
        "days": [slim_day(d) for d in (daily.get("days") or [])][:15],
        "past": [slim_day(d) for d in (past.get("days") or [])][:8],
    }
    CACHE.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "location": out["location"],
                      "temp": out["now"]["temp"], "icon": out["now"]["icon"],
                      "hours": len(out["hours"]), "days": len(out["days"]),
                      "past": len(out["past"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
