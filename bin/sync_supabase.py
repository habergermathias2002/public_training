#!/usr/bin/env python3
"""Synchronisiert Auswertungsdaten nach Supabase.

Liest auswertung/*.json und führt idempotente Upserts in die entsprechenden
Supabase-Tabellen durch.
Zugangsdaten kommen aus der .env Datei (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY oder SUPABASE_ANON_KEY).

Zwei Wege:
  1. Tabelle `datasets`: jede Datei aus auswertung/ unverändert (rows + meta), in Teilen unter ~700 KB.
     Daraus liest die App (app/src/main.ts) alle Seiten des Cockpits.
  2. Die acht Fachtabellen (activities, daily_metrics, ...): einzelne Datensätze für eigene SQL-Abfragen.

Aufruf:
  bin/sync_supabase.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "auswertung"
ENV_FILE = ROOT / ".env"


def load_env() -> dict[str, str]:
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    return env


def sync_table(base_url: str, key: str, table: str, rows: list[dict], batch_size: int = 100) -> int:
    if not rows:
        return 0
    url = f"{base_url.rstrip('/')}/rest/v1/{table}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        data = json.dumps(batch, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    total += len(batch)
                else:
                    print(f"  Warnung {table}: HTTP {resp.status}", file=sys.stderr)
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            print(f"  Fehler bei {table} (Batch {i}-{i+len(batch)}): HTTP {err.code} - {body}", file=sys.stderr)
            raise
        except Exception as err:
            print(f"  Netzwerkfehler bei {table}: {err}", file=sys.stderr)
            raise
    return total


# Die Kartengrundlage (Natural Earth) liest die App immer aus dem Repo.
NICHT_HOCHLADEN = {"karte"}
TEIL_MAX = 700_000  # Bytes je Zeile in `datasets`, damit kein Request zu groß wird


def _request(url: str, key: str, method: str, body: bytes | None = None, prefer: str | None = None) -> None:
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60):
            pass
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code} - {text}") from None


def teile(rows: list) -> list[list]:
    """Zerlegt die Zeilen in Teile, deren JSON jeweils unter TEIL_MAX bleibt."""
    out, aktuell, groesse = [], [], 2
    for r in rows:
        n = len(json.dumps(r, ensure_ascii=False).encode("utf-8")) + 1
        if aktuell and groesse + n > TEIL_MAX:
            out.append(aktuell)
            aktuell, groesse = [], 2
        aktuell.append(r)
        groesse += n
    out.append(aktuell)  # auch eine leere Quelle bekommt Teil 0, damit die App sie als vorhanden sieht
    return out


def sync_datasets(base_url: str, key: str) -> None:
    base = f"{base_url.rstrip('/')}/rest/v1/datasets"
    for f in sorted(OUT.glob("*.json")):
        name = f.stem
        if name in NICHT_HOCHLADEN:
            continue
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            rows = j if isinstance(j, list) else j.get("rows", [])
            meta = [] if isinstance(j, list) else j.get("meta", [])
            # Quellcode in meta braucht die App nicht
            meta = [m for m in meta if not (isinstance(m, dict) and m.get("type") == "code")]
            parts = teile(rows)
            for nr, part in enumerate(parts):
                body = json.dumps(
                    {"name": name, "part": nr, "rows": part, "meta": meta if nr == 0 else None},
                    ensure_ascii=False,
                ).encode("utf-8")
                _request(base, key, "POST", body, prefer="resolution=merge-duplicates,return=minimal")
            # Teile aus einem früheren, längeren Lauf entfernen
            q = urllib.parse.urlencode({"name": f"eq.{name}", "part": f"gte.{len(parts)}"})
            _request(f"{base}?{q}", key, "DELETE", prefer="return=minimal")
            print(f"  ✓ datasets/{name}: {len(rows)} Zeilen in {len(parts)} Teil(en)")
        except Exception as e:
            print(f"  ✕ datasets/{name}: Fehlgeschlagen ({e})", file=sys.stderr)


def main() -> int:
    env = load_env()
    url = env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = (
        env.get("SUPABASE_SERVICE_ROLE_KEY")
        or env.get("SUPABASE_ANON_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
    )

    if not url or not key or "your-project-id" in url:
        print("Supabase nicht konfiguriert. Bitte trage SUPABASE_URL und Key in .env ein.", file=sys.stderr)
        return 1

    configs = [
        ("aktivitaeten", "activities", None),
        ("tage", "daily_metrics", None),
        ("wochen", "weekly_summaries", None),
        ("kpis", "kpis", None),
        ("events", "events", None),
        ("trainer", "trainer_briefings", None),
    ]

    print("Starte Synchronisation nach Supabase...")
    print("Tabelle datasets (liest die App):")
    sync_datasets(url, key)

    print("Fachtabellen:")
    for json_name, table_name, _ in configs:
        f = OUT / f"{json_name}.json"
        if not f.exists():
            continue
        try:
            content = json.loads(f.read_text(encoding="utf-8"))
            rows = content.get("rows", [])
            # Sanitization for events dates
            if table_name == "events":
                for r in rows:
                    if r.get("datum_bis") == "":
                        r["datum_bis"] = None
                    if r.get("datum") == "":
                        r["datum"] = None
            count = sync_table(url, key, table_name, rows)
            print(f"  ✓ {table_name}: {count} Zeilen synchronisiert")
        except Exception as e:
            print(f"  ✕ {table_name}: Fehlgeschlagen ({e})", file=sys.stderr)

    # Marker mit eindeutiger ID (inkl. Datum / Index)
    f_marker = OUT / "marker.json"
    if f_marker.exists():
        m_rows = json.loads(f_marker.read_text(encoding="utf-8")).get("rows", [])
        for idx, r in enumerate(m_rows):
            d_str = str(r.get("datum") or "").replace("-", "")
            r["id"] = f"{r.get('disziplin', '')}_{r.get('marker', '')}_{d_str}_{idx}".lower().replace(" ", "_")
        try:
            count = sync_table(url, key, "markers", m_rows)
            print(f"  ✓ markers: {count} Zeilen synchronisiert")
        except Exception as e:
            print(f"  ✕ markers: Fehlgeschlagen ({e})", file=sys.stderr)

    # Kalender mit generierter ID & bereinigten Zahlen/Datumsfeldern
    f_kal = OUT / "kalender.json"
    if f_kal.exists():
        k_rows = json.loads(f_kal.read_text(encoding="utf-8")).get("rows", [])
        for idx, r in enumerate(k_rows):
            r["id"] = f"{r.get('woche')}_{r.get('datum') or r.get('tag')}_{idx}"
            if not r.get("datum"):
                r["datum"] = None
            if not r.get("woche_start"):
                r["woche_start"] = None
            if not r.get("aktivitaet_id") or r.get("aktivitaet_id") == "":
                r["aktivitaet_id"] = None
            if not r.get("plan_dauer_min") or r.get("plan_dauer_min") == "":
                r["plan_dauer_min"] = None
        try:
            count = sync_table(url, key, "calendar_plan", k_rows)
            print(f"  ✓ calendar_plan: {count} Zeilen synchronisiert")
        except Exception as e:
            print(f"  ✕ calendar_plan: Fehlgeschlagen ({e})", file=sys.stderr)

    print("Supabase-Synchronisation abgeschlossen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
