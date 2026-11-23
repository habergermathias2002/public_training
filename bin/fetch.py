#!/usr/bin/env python3
# Homebrew-Python, weil das System-Python (3.9, LibreSSL 2.8) den TLS-Handshake mit Garmin nicht schafft.
"""Zieht Garmin-Daten ueber die Personal API nach data/<bereich>/.

Aufruf:
  bin/fetch.py                 letzte 7 Tage
  bin/fetch.py --days 30       letzte 30 Tage
  bin/fetch.py --start 2026-10-01 --end 2026-10-31
  bin/fetch.py --fit           zusaetzlich die Original-Dateien (.zip mit .FIT) der Aktivitaeten

Nur Python-Standardbibliothek. Holt bei Bedarf ueber bin/token.sh ein neues Token.
Endpunkte aus Garmins Client: github.com/garmin/connect-personal-api-python (client.py).
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TOKEN_FILE = ROOT / ".token"
BASE = "https://personal.connectapi.garmin.com"


def token() -> str:
    """Gibt ein gueltiges Token zurueck; holt ein neues, wenn keins da ist oder es in <10 min ablaeuft."""
    if TOKEN_FILE.exists():
        t = TOKEN_FILE.read_text().strip()
        try:
            payload = t.split(".")[1]
            exp = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["exp"]
            if exp - time.time() > 600:
                return t
        except Exception:
            pass
    subprocess.run([str(ROOT / "bin" / "token.sh")], check=True, stdout=subprocess.DEVNULL)
    return TOKEN_FILE.read_text().strip()


PAUSE = 1.0          # Sekunden zwischen zwei Aufrufen (Garmin drosselt nach ~100 schnellen Aufrufen mit 429)
BACKOFF = [30, 60, 120, 300]
_last_call = 0.0


def get(path: str, params: dict | None = None, accept: str = "application/json") -> bytes:
    """GET mit fester Pause zwischen Aufrufen; bei HTTP 429 wartet es (Retry-After oder Backoff) und versucht neu."""
    global _last_call
    url = BASE + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    for attempt in range(len(BACKOFF) + 1):
        wait = PAUSE - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}", "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == len(BACKOFF):
                raise
            ra = err.headers.get("Retry-After")
            delay = int(ra) if ra and ra.isdigit() else BACKOFF[attempt]
            print(f"  429 von Garmin, warte {delay} s ...", file=sys.stderr, flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt == len(BACKOFF):
                raise
            print(f"  Netzwerkfehler ({type(err).__name__}), neuer Versuch in 10 s ...", file=sys.stderr, flush=True)
            time.sleep(10)
    raise RuntimeError("unerreichbar")


def save(area: str, name: str, raw: bytes) -> Path:
    d = DATA / area
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    if name.endswith(".json"):
        obj = json.loads(raw) if raw else None
        p.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    else:
        p.write_bytes(raw)
    return p


def windows(start: date, end: date, n: int):
    """Zerlegt [start, end] in Fenster von hoechstens n Tagen, als ISO-Datumspaare."""
    while start <= end:
        stop = min(start + timedelta(days=n - 1), end)
        yield start.isoformat(), stop.isoformat()
        start = stop + timedelta(days=1)


def days(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--fit", action="store_true", help="Original-Aktivitaetsdateien (.zip/.FIT) mitladen")
    ap.add_argument("--only", help="nur diese Bereiche, kommagetrennt (z. B. stress,vo2max,activities)")
    a = ap.parse_args()
    only = set(a.only.split(",")) if a.only else None

    def want(area: str) -> bool:
        return only is None or area in only

    end = date.fromisoformat(a.end) if a.end else date.today()
    start = date.fromisoformat(a.start) if a.start else end - timedelta(days=a.days - 1)
    s, e = start.isoformat(), end.isoformat()
    rng = f"{s}_{e}.json"

    # Bereichs-Endpunkte: eine Datei je Zeitraum. chunk=True: Garmin nimmt hoechstens 28 Tage am Stueck
    # (steps/stress antworten sonst mit HTTP 400), also in 28-Tage-Fenstern holen und zusammenfuehren.
    ranged = {
        "daily_summaries": (True, lambda a, b: ("/usersummary-service/v2/dailysummaries", {"startDate": a, "endDate": b})),
        "sleep": (True, lambda a, b: ("/sleep-service/sleep/dailySleepSummariesByDate", {"startDate": a, "endDate": b})),
        "hrv": (True, lambda a, b: (f"/hrv-service/hrv/daily/{a}/{b}", None)),
        "stress": (True, lambda a, b: (f"/usersummary-service/stats/stress/daily/{a}/{b}", None)),
        "steps": (True, lambda a, b: (f"/usersummary-service/stats/steps/daily/{a}/{b}", None)),
        "body_battery": (True, lambda a, b: ("/wellness-service/wellness/bodyBattery/reports/daily", {"startDate": a, "endDate": b})),
        "weight": (False, lambda a, b: (f"/weight-service/weight/range/{a}/{b}", {"includeAll": "true"})),
        "vo2max": (True, lambda a, b: (f"/metrics-service/metrics/maxmet/daily/{a}/{b}", None)),  # >1 Jahr: HTTP 400
    }
    # Tages-Endpunkte (ein Aufruf je Tag)
    per_day = {
        "heart_rate": lambda d: ("/wellness-service/wellness/dailyHeartRate", {"date": d}),
        "spo2": lambda d: (f"/wellness-service/wellness/daily/spo2acclimation/{d}", None),
    }

    ok, failed = [], []

    def run(area: str, name: str, path: str, params: dict | None):
        try:
            save(area, name, get(path, params))
            ok.append(f"{area}/{name}")
        except urllib.error.HTTPError as err:
            failed.append(f"{area}/{name}: HTTP {err.code}")
        except Exception as err:  # noqa: BLE001
            failed.append(f"{area}/{name}: {type(err).__name__}")

    def run_ranged(area: str, chunk: bool, f) -> None:
        parts = list(windows(start, end, 28)) if chunk else [(s, e)]
        merged = None
        try:
            for a_, b_ in parts:
                raw = get(*f(a_, b_))
                o = json.loads(raw) if raw else None
                if o is None:
                    continue
                if merged is None:
                    merged = o
                elif isinstance(merged, list) and isinstance(o, list):
                    merged += o
                elif isinstance(merged, dict) and isinstance(merged.get("data"), list) and isinstance(o, dict):
                    merged["data"] += o.get("data") or []
                else:
                    raise ValueError("Format laesst sich nicht zusammenfuehren")
            save(area, rng, json.dumps(merged).encode())
            ok.append(f"{area}/{rng}")
        except urllib.error.HTTPError as err:
            failed.append(f"{area}/{rng}: HTTP {err.code}")
        except Exception as err:  # noqa: BLE001
            failed.append(f"{area}/{rng}: {type(err).__name__}")

    for area, (chunk, f) in ranged.items():
        if want(area):
            run_ranged(area, chunk, f)
    for area, f in per_day.items():
        for d in (days(start, end) if want(area) else []):
            if (DATA / area / f"{d.isoformat()}.json").exists() and d < date.today() - timedelta(days=2):
                continue  # abgeschlossene Tage nicht neu holen
            path, params = f(d.isoformat())
            run(area, f"{d.isoformat()}.json", path, params)

    # Aktivitaeten: Liste seitenweise, optional die Original-Dateien
    acts: list = []
    page = 0
    while want("activities"):
        try:
            chunk = json.loads(get("/activitylist-service/activities/search/activities",
                                   {"start": page * 100, "limit": 100, "startDate": s, "endDate": e}) or b"[]")
        except urllib.error.HTTPError as err:
            failed.append(f"activities: HTTP {err.code}")
            break
        except Exception as err:  # noqa: BLE001
            failed.append(f"activities: {type(err).__name__}")
            break
        acts += chunk
        if len(chunk) < 100:
            break
        page += 1
    if want("activities") and (acts or not any(x.startswith("activities") for x in failed)):
        save("activities", rng, json.dumps(acts).encode())
        ok.append(f"activities/{rng} ({len(acts)} Aktivitaeten)")
    if a.fit:
        for act in acts:
            aid = act.get("activityId")
            target = DATA / "activities" / "files" / f"{aid}.zip"
            if not aid or target.exists():
                continue
            try:
                save("activities/files", f"{aid}.zip",
                     get(f"/download-service/files/activity/{aid}",
                         accept="application/zip, application/x-zip-compressed, application/octet-stream"))
                ok.append(f"activities/files/{aid}.zip")
            except urllib.error.HTTPError as err:
                failed.append(f"activities/files/{aid}.zip: HTTP {err.code}")

    print(f"Zeitraum {s} bis {e}: {len(ok)} Dateien gespeichert, {len(failed)} Fehler")
    for x in failed:
        print("  FEHLER", x)
    return 1 if failed and not ok else 0


if __name__ == "__main__":
    sys.exit(main())
