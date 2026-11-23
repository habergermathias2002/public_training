#!/usr/bin/env python3
"""Baut die Auswertung: Reize je Einheit, Last, Wochen, Tage, KPIs, Kalender, Marker, Events, FTP Builder.

Liest data/ (Garmin-Rohdaten inkl. FIT-Dateien), athlet/marker.md, plan/soll.json,
plan/einschaetzung.json und wissen/zwift-ftp-builder.md.
Schreibt auswertung/<name>.json ({rows, meta}) und auswertung/<name>.csv.
Regeln (Zonen, Reiztypen, Last): framework.md. Nur Python-Standardbibliothek.

Aufruf: bin/auswertung.py            (FIT-Auswertungen werden in auswertung/cache/ zwischengespeichert)
"""

from __future__ import annotations

import csv
import json
import math
import re
import struct
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "auswertung"
CACHE = OUT / "cache"

# Schwellen (athlet/marker.md). Nach eigenen Tests hier anpassen!
LTHR_LAUF = 175       # Beispielwert: Laktatschwellen-Puls Laufen (bpm)
LTHR_RAD = 170        # Beispielwert: Laktatschwellen-Puls Rad (bpm)
HFMAX = 190           # Beispielwert: maximale Herzfrequenz (bpm)
RUHEPULS_STD = 50     # Beispielwert: typischer Ruhepuls (bpm)
FTP = 220             # Beispielwert: Functional Threshold Power (Watt)
VO2_PACE = 255        # s/km: Laufrunden schneller als 4:15/km zählen als VO2max-Tempo
RENNTEMPO = (232, 248)  # s/km: Ziel-Renntempo-Korridor (z. B. 3:52–4:08/km für 5 km)
TEST5K_MAX = 1350     # s: Lauf mit 5-km-Split unter diesem Wert zählt als 5-km-Test
HEUTE = date.today()

HARTE_REIZE = ("VO2max", "Schwelle")


# ---------------------------------------------------------------- FIT lesen

INVALID = {1: 0xFF, 2: 0xFFFF, 4: 0xFFFFFFFF}
FMT = {1: "B", 2: "H", 4: "I"}


def fit_messages(buf: bytes, want=(19, 20)) -> dict[int, list[dict]]:
    """Liest Runden (19) und Messpunkte (20) aus einer FIT-Datei, inkl. komprimierter Zeitstempel."""
    if buf[8:12] != b".FIT":
        raise ValueError("keine FIT-Datei")
    pos, end = buf[0], buf[0] + struct.unpack_from("<I", buf, 4)[0]
    defs: dict[int, tuple] = {}
    out: dict[int, list[dict]] = {g: [] for g in want}
    last_ts = 0
    while pos < end:
        h = buf[pos]
        pos += 1
        comp_ts = None
        if h & 0x80:
            local, is_def, dev = (h >> 5) & 0x3, False, False
            off = h & 0x1F
            comp_ts = (last_ts & ~0x1F) + off + (0x20 if off < (last_ts & 0x1F) else 0)
        else:
            local, is_def, dev = h & 0x0F, bool(h & 0x40), bool(h & 0x20)
        if is_def:
            e = ">" if buf[pos + 1] == 1 else "<"
            g = struct.unpack_from(e + "H", buf, pos + 2)[0]
            n = buf[pos + 4]
            pos += 5
            fields = [(buf[pos + 3 * i], buf[pos + 3 * i + 1]) for i in range(n)]
            pos += 3 * n
            dsz = 0
            if dev:
                nd = buf[pos]
                pos += 1
                dsz = sum(buf[pos + 3 * i + 1] for i in range(nd))
                pos += 3 * nd
            defs[local] = (g, e, fields, dsz)
            continue
        g, e, fields, dsz = defs[local]
        rec = {} if g in out else None
        for num, sz in fields:
            if (rec is not None or num == 253) and sz in FMT:
                v = struct.unpack_from(e + FMT[sz], buf, pos)[0]
                if v != INVALID[sz]:
                    if rec is not None:
                        rec[num] = v
                    if num == 253:
                        last_ts = v
            pos += sz
        pos += dsz
        if comp_ts is not None:
            last_ts = comp_ts
            if rec is not None:
                rec.setdefault(253, comp_ts)
        if rec is not None:
            out[g].append(rec)
    return out


def fit_summary(aid: str) -> dict:
    """Puls- und Leistungs-Histogramm (Sekunden je bpm bzw. Watt) und Runden einer Aktivität, mit Cache."""
    cache = CACHE / f"{aid}.json"
    if cache.exists():
        c = json.loads(cache.read_text())
        if c.get("v") == 3:
            return c
    res: dict = {"v": 3, "hr": {}, "pw": {}, "laps": []}
    z = DATA / "activities" / "files" / f"{aid}.zip"
    try:
        with zipfile.ZipFile(z) as zf:
            name = next(n for n in zf.namelist() if n.lower().endswith(".fit"))
            msgs = fit_messages(zf.read(name))
        recs = sorted((r for r in msgs[20] if 253 in r), key=lambda r: r[253])
        hr: dict[int, int] = {}
        pw: dict[int, int] = {}
        for i, r in enumerate(recs):
            dt = (recs[i + 1][253] - r[253]) if i + 1 < len(recs) else 1
            if dt <= 0:
                continue
            dt = min(dt, 10)  # Pausen nicht mitzählen
            if 30 <= r.get(3, 0) <= 230:
                hr[r[3]] = hr.get(r[3], 0) + dt
            if 7 in r and r[7] < 2000:
                pw[r[7]] = pw.get(r[7], 0) + dt
        laps = []
        for lap in msgs[19]:
            t = lap.get(8, lap.get(7, 0)) / 1000
            laps.append([round(t, 1), round(lap.get(9, 0) / 100, 1), lap.get(110, lap.get(13, 0)) / 1000,
                         lap.get(15), lap.get(16), lap.get(19)])
        # Pulsdrift: Effizienz (Tempo bzw. Leistung je Herzschlag) erste gegen zweite Hälfte der Zeit
        steps = []
        for i, r in enumerate(recs):
            dt = min((recs[i + 1][253] - r[253]) if i + 1 < len(recs) else 1, 10)
            if dt > 0:
                steps.append((dt, r.get(3), r.get(73, r.get(6)), r.get(7)))
        tot = sum(s[0] for s in steps)
        halves = [[0.0, 0.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0, 0.0]]  # Zeit, Puls*Zeit, Weg, Leistung*Zeit, Zeit mit Leistung
        cum = 0.0
        for dt, h, spd, p in steps:
            k = 0 if cum < tot / 2 else 1
            cum += dt
            if h and 30 <= h <= 230:
                hv = halves[k]
                hv[0] += dt
                hv[1] += h * dt
                if spd:
                    hv[2] += spd / 1000 * dt
                if p is not None and p < 2000:
                    hv[3] += p * dt
                    hv[4] += dt
        drift = drift_pw = None
        if all(hv[0] > 600 for hv in halves):
            ef = [(hv[2] / hv[0]) / (hv[1] / hv[0]) for hv in halves]
            if ef[0] > 0 and all(hv[2] > 0 for hv in halves):
                drift = round((ef[0] - ef[1]) / ef[0] * 100, 1)
            if all(hv[4] > 0.8 * hv[0] for hv in halves):
                efp = [(hv[3] / hv[4]) / (hv[1] / hv[0]) for hv in halves]
                if efp[0] > 0:
                    drift_pw = round((efp[0] - efp[1]) / efp[0] * 100, 1)
        res = {"v": 3, "hr": hr, "pw": pw, "laps": laps, "drift": drift, "drift_pw": drift_pw}
    except (FileNotFoundError, StopIteration, ValueError, KeyError, struct.error, zipfile.BadZipFile):
        res["fehler"] = True
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(res))
    return res


# ---------------------------------------------------------------- Rohdaten

def alle_aktivitaeten() -> list[dict]:
    seen: dict = {}
    for f in sorted((DATA / "activities").glob("*.json")):
        for a in json.loads(f.read_text()) or []:
            seen[a["activityId"]] = a
    return sorted(seen.values(), key=lambda a: a["startTimeLocal"])


def tageswerte() -> tuple[dict, dict]:
    ruhe: dict[str, int] = {}
    for f in sorted((DATA / "daily_summaries").glob("*.json")):
        o = json.loads(f.read_text()) or {}
        for x in o.get("data", []):
            v = (x.get("heartRate") or {}).get("restingValue")
            if v:
                ruhe[x["calendarDate"]] = v
    schlaf: dict[str, float] = {}
    for f in sorted((DATA / "sleep").glob("*.json")):
        for x in json.loads(f.read_text()) or []:
            if x.get("sleepTimeSeconds"):
                schlaf[x["calendarDate"]] = round(x["sleepTimeSeconds"] / 3600, 2)
    return ruhe, schlaf


def sport_of(t: str) -> str:
    if "swim" in t:
        return "Schwimmen"
    if "run" in t:
        return "Lauf"
    if any(k in t for k in ("cycl", "bik", "ride")):
        return "Rad"
    if t in ("hiking", "walking", "mountaineering"):
        return "Wandern"
    if "strength" in t:
        return "Kraft"
    return "Sonst"


def titel_of(a: dict, sport: str) -> str:
    """Titel ohne Ortsnamen: nur der Teil nach ' - ', sonst die Sportart."""
    n = (a.get("activityName") or "").strip()
    if n.startswith("Zwift - "):
        return "Zwift: " + n[8:]
    if " - " in n:
        return n.split(" - ", 1)[1]
    if a["activityType"]["typeKey"] == "treadmill_running":
        return "Laufband"
    return {"Lauf": "Lauf", "Rad": "Radfahrt", "Schwimmen": "Schwimmen", "Wandern": "Wandern",
            "Kraft": "Kraft"}.get(sport, "Training")


_HR_STREAM_CACHE: dict[str, list] = {}


def tagespuls_im_fenster(a: dict) -> tuple[int | None, int | None, dict[int, int]]:
    """Fallback für Zwift-/Indoor-Einheiten ohne gekoppelten Brustgurt: liest 2-Min-Tagespuls der Garmin-Uhr."""
    gmt = a.get("startTimeGMT")
    dur = a.get("duration") or 0
    if not gmt or dur < 600:
        return None, None, {}
    try:
        dt0 = datetime.strptime(gmt[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None, None, {}
    t0 = int(dt0.timestamp() * 1000)
    t1 = t0 + int(dur * 1000)
    d_loc = a["startTimeLocal"][:10]
    d_next = (date.fromisoformat(d_loc) + timedelta(days=1)).isoformat()
    pts: list[tuple[int, int]] = []
    for ds in (d_loc, d_next):
        if ds not in _HR_STREAM_CACHE:
            p = DATA / "heart_rate" / f"{ds}.json"
            if p.exists():
                raw = json.loads(p.read_text()) or {}
                _HR_STREAM_CACHE[ds] = raw.get("heartRateValues") or []
            else:
                _HR_STREAM_CACHE[ds] = []
        for ts, v in _HR_STREAM_CACHE[ds]:
            if v and t0 <= ts <= t1:
                pts.append((ts, int(v)))
    if len(pts) < 8:
        return None, None, {}
    pts.sort()
    vals = [v for _, v in pts]
    hist: dict[int, int] = {}
    for i, (ts, v) in enumerate(pts):
        dt_s = min(round((pts[i + 1][0] - ts) / 1000), 180) if i + 1 < len(pts) else 120
        hist[v] = hist.get(v, 0) + max(dt_s, 1)
    return round(sum(vals) / len(vals)), max(vals), hist


# ---------------------------------------------------------------- Zonen, Last, Reize

def schwellen_bpm(lthr: int, sport: str = "Lauf") -> tuple[int, int, int]:
    """Empirische Zonengrenzen (LT1, Beginn Z4/LT2, Ende Z4/LT2) nach framework.md Abschnitt 7.
    Lauf (LTHR 179): LIT <= 145 (LT1), Z3 146-167, Z4 168-182, Z5 > 182.
    Rad  (LTHR 174): LIT <= 140 (LT1), Z3 141-160, Z4 161-177, Z5 > 177.
    """
    if sport == "Rad":
        return round(0.805 * lthr), round(0.925 * lthr), round(1.017 * lthr)
    return round(0.81 * lthr), round(0.94 * lthr), round(1.017 * lthr)


def hr_zonen(hist: dict, lthr: int, sport: str = "Lauf") -> list[float]:
    t1, t2, t3 = schwellen_bpm(lthr, sport)
    z = [0.0, 0.0, 0.0, 0.0]
    for b, s in hist.items():
        b = int(b)
        z[0 if b <= t1 else 1 if b < t2 else 2 if b <= t3 else 3] += s
    return [round(x / 60, 1) for x in z]


def hr_zonen_5(hist: dict, lthr: int, sport: str = "Lauf") -> list[float]:
    """Profi-5-Zonen-Modell nach framework.md Abschnitt 7 (Z1 Recovery, Z2 LIT, Z3 Tempo, Z4 Schwelle, Z5 VO2max)."""
    t0 = 125 if sport == "Rad" else 133  # Z1 < 126 (Rad) bzw. < 134 (Lauf)
    t1, t2, t3 = schwellen_bpm(lthr, sport)
    z = [0.0, 0.0, 0.0, 0.0, 0.0]
    for b, s in hist.items():
        b = int(b)
        idx = 0 if b <= t0 else 1 if b <= t1 else 2 if b < t2 else 3 if b <= t3 else 4
        z[idx] += s
    return [round(x / 60, 1) for x in z]


def load_feedback() -> dict:
    p = ROOT / "athlet" / "feedback.json"
    if not p.exists():
        return {"tagesform": {}, "rpe": {}}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return {"tagesform": d.get("tagesform") or {}, "rpe": d.get("rpe") or {}}
    except Exception:
        return {"tagesform": {}, "rpe": {}}


def feedback_rows(fb: dict) -> list[dict]:
    rows: list[dict] = []
    for k, v in sorted((fb.get("tagesform") or {}).items()):
        rows.append({
            "id": f"tf_{k}",
            "typ": "tagesform",
            "datum": v.get("datum", k),
            "activity_id": "",
            "beine": v.get("beine"),
            "stress": v.get("stress"),
            "schlaf_qualitaet": v.get("schlaf_qualitaet"),
            "rpe": None,
            "gefuehl": "",
            "notiz": v.get("notiz", ""),
            "updated_at": v.get("updated_at", ""),
        })
    for k, v in sorted((fb.get("rpe") or {}).items()):
        rows.append({
            "id": f"rpe_{k}",
            "typ": "rpe",
            "datum": v.get("datum", ""),
            "activity_id": str(v.get("activity_id", k)),
            "beine": None,
            "stress": None,
            "schlaf_qualitaet": None,
            "rpe": v.get("rpe"),
            "gefuehl": v.get("gefuehl", ""),
            "notiz": v.get("notiz", ""),
            "updated_at": v.get("updated_at", ""),
        })
    return rows


def pw_minuten(hist: dict) -> tuple[float, float]:
    sw = sum(s for w, s in hist.items() if 0.88 * FTP <= int(w) <= 1.05 * FTP)
    vo2 = sum(s for w, s in hist.items() if int(w) > 1.06 * FTP)
    return round(sw / 60, 1), round(vo2 / 60, 1)


def trimp(hist: dict, rest: float) -> float:
    t = 0.0
    for b, s in hist.items():
        x = min((int(b) - rest) / (HFMAX - rest), 1.0)
        if x > 0:
            t += s / 60 * x * 0.64 * math.exp(1.92 * x)
    return t


def trimp_schwelle(rest: float, lthr: int) -> float:
    x = (lthr - rest) / (HFMAX - rest)
    return 60 * x * 0.64 * math.exp(1.92 * x)


IF_SCHAETZUNG = {"Schwimmen": 0.75, "Lauf": 0.75, "Rad": 0.65, "Wandern": 0.5, "Kraft": 0.6, "Sonst": 0.5}


def last_of(sport, dauer_h, hist_hr, hist_pw, np_, rest) -> tuple[float, str]:
    sek = dauer_h * 3600
    if sport == "Rad" and hist_pw and sum(hist_pw.values()) >= 0.6 * sek and np_:
        return round(dauer_h * (np_ / FTP) ** 2 * 100, 1), "Leistung"
    if hist_hr and sum(hist_hr.values()) >= 0.5 * sek:
        lthr = LTHR_RAD if sport == "Rad" else LTHR_LAUF
        return round(trimp(hist_hr, rest) / trimp_schwelle(rest, lthr) * 100, 1), "Puls"
    return round(dauer_h * IF_SCHAETZUNG.get(sport, 0.5) ** 2 * 100, 1), "Schätzung"


def reiz_of(sport, dauer_min, z, pw_sw, pw_vo2, hm_ab, laps, hat_pw, km=0.0) -> str:
    if sport == "Schwimmen":
        return "Schwimmen"
    if sport == "Kraft":
        return "Kraft"
    if sport == "Lauf":
        schnell = sum(t for t, d, spd, *_ in laps if spd and d >= 200 and 1000 / spd <= VO2_PACE) / 60
        if z[3] >= 8 or schnell >= 6:
            return "VO2max"
        if z[2] + z[3] >= 15:
            return "Schwelle"
        if hm_ab >= 500:
            return "Trail"
        return "lang" if (dauer_min >= 75 or km >= 12.0) else "locker"
    if sport == "Rad":
        if hat_pw:
            if pw_vo2 >= 8:
                return "VO2max"
            if pw_sw + pw_vo2 >= 15:
                return "Schwelle"
        elif z[3] >= 8:
            return "VO2max"
        elif z[2] + z[3] >= 15:
            return "Schwelle"
        return "lang" if dauer_min >= 120 else "locker"
    if sport == "Wandern":
        if hm_ab >= 500:
            return "Trail"
        return "lang" if dauer_min >= 180 else "locker"
    return "locker"


# ---------------------------------------------------------------- Bausteine

def woche_of(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def montag(d: date) -> date:
    return d - timedelta(days=d.weekday())


def mmss(s: float | None) -> str:
    if not s:
        return ""
    s = round(s)
    return f"{s // 60}:{s % 60:02d}"


TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def aktivitaeten_rows(acts, ruhe) -> list[dict]:
    rows = []
    for a in acts:
        aid = str(a["activityId"])
        d = date.fromisoformat(a["startTimeLocal"][:10])
        sport = sport_of(a["activityType"]["typeKey"])
        dauer_min = round((a.get("movingDuration") or a.get("duration") or 0) / 60, 1)
        km = round((a.get("distance") or 0) / 1000, 2)
        fs = fit_summary(aid)
        hist_hr, hist_pw = fs.get("hr") or {}, fs.get("pw") or {}
        puls_avg = round(a["averageHR"]) if a.get("averageHR") else None
        puls_max = round(a["maxHR"]) if a.get("maxHR") else None
        if sport == "Rad" and not puls_avg:
            w_avg, w_max, w_hist = tagespuls_im_fenster(a)
            if w_avg:
                puls_avg, puls_max = w_avg, w_max
                if not hist_hr:
                    hist_hr = w_hist
        lthr = LTHR_RAD if sport == "Rad" else LTHR_LAUF
        z = hr_zonen(hist_hr, lthr, sport) if hist_hr else [0.0, 0.0, 0.0, 0.0]
        pw_sw, pw_vo2 = pw_minuten(hist_pw) if hist_pw else (0.0, 0.0)
        hat_pw = bool(hist_pw) and sum(hist_pw.values()) >= 0.6 * dauer_min * 60
        hm_ab = round(a.get("elevationLoss") or 0)
        rest = ruhe.get(d.isoformat(), RUHEPULS_STD)
        last, quelle = last_of(sport, dauer_min / 60, hist_hr, hist_pw, a.get("normPower"), rest)
        reiz = reiz_of(sport, dauer_min, z, pw_sw, pw_vo2, hm_ab, fs.get("laps") or [], hat_pw, km=km)
        pace = (1000 / a["averageSpeed"]) if sport == "Lauf" and a.get("averageSpeed") else None
        if sport == "Schwimmen" and a.get("distance"):
            pace = (a.get("movingDuration") or a.get("duration")) / (a["distance"] / 100)
        rows.append({
            "id": aid,
            "datum": d.isoformat(),
            "start": a["startTimeLocal"][11:16],
            "dauer_gesamt_min": round((a.get("duration") or 0) / 60),
            "tag": TAGE[d.weekday()],
            "woche": woche_of(d),
            "sport": sport,
            "titel": titel_of(a, sport),
            "dauer_min": dauer_min,
            "distanz_km": km,
            "tempo": mmss(pace) + ("/km" if sport == "Lauf" and pace else "/100 m" if sport == "Schwimmen" and pace else ""),
            "puls_avg": puls_avg,
            "puls_max": puls_max,
            "leistung_np": round(a["normPower"]) if a.get("normPower") else None,
            "hm_auf": round(a.get("elevationGain") or 0),
            "hm_ab": hm_ab,
            "z1_min": z[0], "z2_min": z[1], "z3_min": z[2], "z4_min": z[3],
            "rad_schwelle_min": pw_sw, "rad_vo2_min": pw_vo2,
            "reiz": reiz,
            "hart": reiz in HARTE_REIZE,
            "last": last,
            "last_quelle": quelle,
            "split5k": mmss(a.get("fastestSplit_5000")) if sport == "Lauf" else "",
            "split5k_s": round(a["fastestSplit_5000"]) if sport == "Lauf" and a.get("fastestSplit_5000") else None,
            "renntempo_min": round(sum(t for t, d, spd, *_ in (fs.get("laps") or []) if spd and d >= 200
                                       and RENNTEMPO[0] <= 1000 / spd <= RENNTEMPO[1]) / 60, 1) if sport == "Lauf" else 0,
        })
    return rows


def tage_rows(akt, ruhe, schlaf) -> list[dict]:
    start = date.fromisoformat(min(r["datum"] for r in akt))
    last_by_day: dict[str, float] = {}
    for r in akt:
        last_by_day[r["datum"]] = last_by_day.get(r["datum"], 0) + r["last"]
    rows, ctl, atl = [], 0.0, 0.0
    d = start
    while d <= HEUTE:
        k = d.isoformat()
        tsb = ctl - atl
        load = last_by_day.get(k, 0.0)
        ctl += (load - ctl) / 42
        atl += (load - atl) / 7
        fenster = [ruhe[x] for x in (str(d - timedelta(days=i)) for i in range(7)) if x in ruhe]
        rows.append({
            "datum": k,
            "last": round(load, 1),
            "fitness_ctl": round(ctl, 1),
            "ermuedung_atl": round(atl, 1),
            "form_tsb": round(tsb, 1),
            "ruhepuls": ruhe.get(k),
            "ruhepuls_7t": round(sum(fenster) / len(fenster), 1) if fenster else None,
            "schlaf_h": schlaf.get(k),
        })
        d += timedelta(days=1)
    return rows


def wochen_rows(akt) -> list[dict]:
    w: dict[str, dict] = {}
    for r in akt:
        k = r["woche"]
        x = w.setdefault(k, {"woche": k, "start": montag(date.fromisoformat(r["datum"])).isoformat(),
                             "h_lauf": 0.0, "h_rad": 0.0, "h_schwimmen": 0.0, "h_sonst": 0.0,
                             "km_lauf": 0.0, "last": 0.0, "harte_reize": 0, "schwimm_einheiten": 0,
                             "lauf_z1_min": 0.0, "lauf_min": 0.0})
        h = r["dauer_min"] / 60
        key = {"Lauf": "h_lauf", "Rad": "h_rad", "Schwimmen": "h_schwimmen"}.get(r["sport"], "h_sonst")
        x[key] += h
        x["last"] += r["last"]
        x["harte_reize"] += 1 if r["hart"] else 0
        if r["sport"] == "Lauf":
            x["km_lauf"] += r["distanz_km"]
            x["lauf_z1_min"] += r["z1_min"]
            x["lauf_min"] += r["z1_min"] + r["z2_min"] + r["z3_min"] + r["z4_min"]
        if r["sport"] == "Schwimmen":
            x["schwimm_einheiten"] += 1
    rows = []
    for k in sorted(w):
        x = w[k]
        for f in ("h_lauf", "h_rad", "h_schwimmen", "h_sonst", "km_lauf", "last"):
            x[f] = round(x[f], 1)
        x["h_gesamt"] = round(x["h_lauf"] + x["h_rad"] + x["h_schwimmen"] + x["h_sonst"], 1)
        x["lauf_locker_anteil"] = round(100 * x["lauf_z1_min"] / x["lauf_min"]) if x["lauf_min"] else None
        del x["lauf_z1_min"], x["lauf_min"]
        rows.append(x)
    return rows


# ---------------------------------------------------------------- Plan, Marker, Events, FTP Builder

PASST = {
    "Test5k": lambda r: r["sport"] == "Lauf" and r["split5k_s"] is not None and r["split5k_s"] <= TEST5K_MAX,
    "VO2max": lambda r: r["reiz"] == "VO2max",
    "Schwelle": lambda r: r["reiz"] == "Schwelle",
    "Renntempo": lambda r: r["sport"] == "Lauf" and r["renntempo_min"] >= 6,
    "hart": lambda r: r["reiz"] in HARTE_REIZE,
    "Trail": lambda r: r["reiz"] == "Trail",
    "lang": lambda r: r["reiz"] in ("lang", "Trail"),
    "locker": lambda r: not r["hart"],
    "Schwimmen": lambda r: r["sport"] == "Schwimmen",
    "Kraft": lambda r: r["sport"] == "Kraft",
}
REIHENFOLGE = ["Test5k", "Renntempo", "VO2max", "Schwelle", "hart", "Trail", "lang", "Schwimmen", "Kraft", "locker"]


def kalender_rows(akt) -> list[dict]:
    soll = json.loads((ROOT / "plan" / "soll.json").read_text())
    rows = []
    for wo in soll["wochen"]:
        start = date.fromisoformat(wo["start"])
        ende = start + timedelta(days=6)
        ist = [r for r in akt if start.isoformat() <= r["datum"] <= ende.isoformat()]
        benutzt: set[str] = set()
        items = list(enumerate(wo["items"]))
        status: dict[int, tuple] = {}
        for typ in REIHENFOLGE:
            for i, it in items:
                if i in status or it["reiz"] != typ:
                    continue
                if it.get("status_manuell"):
                    status[i] = (it["status_manuell"], None, None)
                    continue
                kand = [r for r in ist if r["id"] not in benutzt and (it["sport"] in (r["sport"], "egal"))
                        and PASST[typ](r)]
                if it.get("tag"):  # die Einheit am vorgeschlagenen Tag zuerst, dann die nächstgelegene
                    ziel = date.fromisoformat(it["tag"])
                    kand.sort(key=lambda r: abs((date.fromisoformat(r["datum"]) - ziel).days))
                if kand:
                    r = kand[0]
                    benutzt.add(r["id"])
                    status[i] = ("erledigt", r["datum"], r["id"])
        for i, it in items:
            st, am, aid = status.get(i, (None, None, None))
            if st is None:
                st = "verfallen" if ende < HEUTE else "offen"
            tag = it.get("tag")
            rows.append({
                "woche": wo["woche"], "woche_titel": wo["titel"], "woche_start": wo["start"],
                "datum": tag or "", "tag": TAGE[date.fromisoformat(tag).weekday()] if tag else "",
                "sport": it["sport"], "reiz": it["reiz"], "titel": it["titel"], "details": it.get("details", ""),
                "ebene": it.get("ebene", ""), "status": st, "erledigt_am": am or "", "aktivitaet_id": aid or "",
                "zeit": it.get("zeit", ""), "plan_dauer_min": it.get("dauer_min", ""),
            })
    return rows


def marker_rows() -> list[dict]:
    rows, disziplin = [], ""
    for line in (ROOT / "athlet" / "marker.md").read_text().splitlines():
        if line.startswith("## "):
            disziplin = line[3:].strip()
            continue
        if not line.startswith("|") or line.startswith("|---") or line.startswith("| Marker"):
            continue
        c = [x.strip().replace("**", "") for x in line.strip("|").split("|")]
        if len(c) < 6:
            continue
        bis = c[4] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", c[4]) else ""
        gueltig = "offen" if c[1] in ("-", "") else ("gültig" if bis and date.fromisoformat(bis) >= HEUTE
                                                     else "abgelaufen" if bis else "ohne Ablauf")
        rows.append({"disziplin": disziplin, "marker": c[0], "wert": c[1], "datum": c[2], "quelle": c[3],
                     "gueltig_bis": bis, "gueltigkeit": gueltig, "status": c[5]})
    return rows


EVENT_FELDER = ["id", "datum", "datum_bis", "typ", "art", "prio", "name", "ort", "land", "lat", "lon", "ergebnis",
                "ziel", "status", "prognose", "konfidenz", "begruendung", "hebel", "naechster_check", "stand",
                "strecke", "hinweis", "aktivitaeten", "route"]


def event_rows() -> list[dict]:
    rows = []
    for e in json.loads((ROOT / "athlet" / "events.json").read_text()):
        r = {k: e.get(k, "") for k in EVENT_FELDER}
        r["lat"], r["lon"] = e.get("lat"), e.get("lon")
        r["aktivitaeten"] = ",".join(e.get("aktivitaet_ids", []))
        r["route"] = json.dumps(e["route"]) if e.get("route") else ""
        r["tage_bis"] = (date.fromisoformat(e["datum"]) - HEUTE).days
        rows.append(r)
    return sorted(rows, key=lambda e: e["datum"])


def ftp_builder_rows(akt) -> list[dict]:
    plan = []
    for line in (ROOT / "wissen" / "zwift-ftp-builder.md").read_text().splitlines():
        m = re.match(r"\|\s*(W\d-\d)\s*\|\s*([^|]+?)\s*\|\s*(\d+) min\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|", line)
        if m:
            name = re.sub(r"\s*\(optional\)", "", m.group(2))
            plan.append({"nr": m.group(1), "einheit": name, "optional": "optional" in m.group(2),
                         "dauer_min": int(m.group(3)), "inhalt": m.group(4), "zaehlt_als": m.group(5)})
    fahrten = [r for r in akt if r["titel"].startswith("Zwift: ") and r["datum"] >= "2026-11-05"]
    frei = list(range(len(plan)))
    for r in fahrten:
        n = r["titel"][7:]
        hit = next((i for i in frei if plan[i]["einheit"] == n), None)
        if hit is not None:
            frei.remove(hit)
            plan[hit]["erledigt_am"] = r["datum"]
            plan[hit]["aktivitaet_id"] = r["id"]
    for i, p in enumerate(plan):
        p["reihenfolge"] = i + 1
        p["status"] = "erledigt" if p.get("erledigt_am") else "optional" if p["optional"] else "offen"
        p.setdefault("erledigt_am", "")
        p.setdefault("aktivitaet_id", "")
        p["hart"] = p["zaehlt_als"].startswith("**hart")
        p["zaehlt_als"] = p["zaehlt_als"].replace("**", "")
    return plan


# ---------------------------------------------------------------- Länder

LAND_DE = {
    "Germany": "Deutschland", "Italy": "Italien", "Austria": "Österreich", "France": "Frankreich",
    "Belgium": "Belgien", "United Kingdom": "Vereinigtes Königreich", "Spain": "Spanien", "Switzerland": "Schweiz",
    "Croatia": "Kroatien", "United States of America": "USA", "Slovakia": "Slowakei", "New Caledonia": "Neukaledonien",
    "Czechia": "Tschechien", "Netherlands": "Niederlande", "Portugal": "Portugal", "Greece": "Griechenland",
    "Denmark": "Dänemark", "Norway": "Norwegen", "Sweden": "Schweden", "Poland": "Polen", "Hungary": "Ungarn",
    "Slovenia": "Slowenien", "Ireland": "Irland", "Luxembourg": "Luxemburg",
}


def laender_rows(acts) -> tuple[list[dict], dict[str, tuple[str, str]]]:
    """Land je Aktivität aus dem GPS-Startpunkt (Punkt-in-Polygon auf der Kartengrundlage), dann je Land zählen.
    Nur das Land wird ausgegeben, kein Ort."""
    kf = OUT / "karte.json"
    if not kf.exists():
        return [], {}
    polys = []
    for r in json.loads(kf.read_text())["rows"]:
        for poly in r["geometry"]["coordinates"]:
            ring = poly[0]
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            polys.append((r["land"], min(xs), max(xs), min(ys), max(ys), ring))

    def inside(x, y, ring):
        c, j = False, len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
            j = i
        return c

    def land_of(lo, la):
        for dx, dy in ((0, 0), (0.1, 0), (-0.1, 0), (0, 0.1), (0, -0.1), (0.2, 0.2), (-0.2, -0.2)):
            x, y = lo + dx, la + dy  # Küstenpunkte: die Karte ist vereinfacht, deshalb kurz daneben suchen
            hit = next((p[0] for p in polys if p[1] <= x <= p[2] and p[3] <= y <= p[4] and inside(x, y, p[5])), None)
            if hit:
                return hit
        return None

    cnt: dict[str, dict] = {}
    act_land: dict[str, tuple[str, str]] = {}
    for a in acts:
        la, lo = a.get("startLatitude"), a.get("startLongitude")
        if la is None or lo is None:
            continue
        land = land_of(lo, la)
        if not land:
            continue
        aid = str(a["activityId"])
        name_de = LAND_DE.get(land, land)
        act_land[aid] = (land, name_de)
        d = a["startTimeLocal"][:10]
        x = cnt.setdefault(land, {"land": land, "name_de": name_de, "aktivitaeten": 0,
                                  "stunden": 0.0, "erstes": d, "letztes": d, "ids": []})
        x["aktivitaeten"] += 1
        x["stunden"] += (a.get("duration") or 0) / 3600
        x["erstes"], x["letztes"] = min(x["erstes"], d), max(x["letztes"], d)
        x["ids"].append(aid)
    rows = sorted(cnt.values(), key=lambda r: -r["aktivitaeten"])
    for r in rows:
        r["stunden"] = round(r["stunden"], 1)
        r["aktivitaet_ids"] = ",".join(r.pop("ids", []))
    return rows, act_land


# ---------------------------------------------------------------- KPIs

def kpi_rows(akt, tage, wochen, ftp, events, fb: dict | None = None) -> list[dict]:
    rows = []
    heute = HEUTE.isoformat()
    tg = {t["datum"]: t for t in tage}
    t0 = tg.get(heute) or tage[-1]
    t7 = tg.get((HEUTE - timedelta(days=7)).isoformat())
    tf_map = (fb or {}).get("tagesform") or {}
    tf_today = tf_map.get(heute) or (tf_map.get( sorted(tf_map.keys())[-1] ) if tf_map and (HEUTE - date.fromisoformat(sorted(tf_map.keys())[-1])).days <= 1 else None)

    def add(id_, kpi, wert, text, einheit, vergleich, bewertung, fenster, hinweis):
        rows.append({"id": id_, "kpi": kpi, "wert": wert, "wert_text": text, "einheit": einheit,
                     "vergleich": vergleich, "bewertung": bewertung, "fenster": fenster, "hinweis": hinweis})

    # Tagesform (Ampel aus Ruhepuls, Schlaf & subjektivem 3-Punkte-Check nach framework.md Abschnitt 5)
    rp = [t for t in tage[-8:-1] if t["ruhepuls"]]
    basis = sum(t["ruhepuls"] for t in rp) / len(rp) if rp else None
    rp_heute = t0["ruhepuls"]
    schlaf = t0["schlaf_h"] if t0["schlaf_h"] is not None else (tage[-2]["schlaf_h"] if len(tage) > 1 else None)
    abw = (rp_heute - basis) if (rp_heute and basis) else None
    subj_warn = 0
    subj_txt = ""
    if tf_today:
        b_val = tf_today.get("beine")
        s_val = tf_today.get("stress")
        if b_val is not None and b_val <= 2:
            subj_warn += 1
        if s_val is not None and s_val >= 4:
            subj_warn += 1
        parts_s = []
        if b_val is not None:
            parts_s.append(f"Beine {b_val}/5")
        if s_val is not None:
            parts_s.append(f"Stress {s_val}/5")
        if parts_s:
            subj_txt = " · " + ", ".join(parts_s)
    daneben = (abw is not None and abw > 3) + (schlaf is not None and schlaf < 7) + (1 if subj_warn >= 1 else 0)
    if abw is None and schlaf is None and not tf_today:
        ampel = "unbekannt"
    elif (abw is not None and abw >= 7) or daneben >= 2 or subj_warn >= 2:
        ampel = "rot"
    elif daneben == 1:
        ampel = "gelb"
    else:
        ampel = "grün"
    add("tagesform", "Tagesform", None, ampel, "",
        f"Ruhepuls {rp_heute or '–'} (7T-Ø {round(basis, 1) if basis else '–'}), Schlaf {schlaf if schlaf is not None else '–'} h{subj_txt}",
        {"grün": "gut", "gelb": "warn", "rot": "schlecht"}.get(ampel, "neutral"), "heute",
        "Ampel aus framework.md Abschnitt 5 (Ruhepuls, Schlaf & 3-Punkte-Check)")

    ramp = round(t0["fitness_ctl"] - t7["fitness_ctl"], 1) if t7 else None
    add("fitness", "Fitness (CTL)", t0["fitness_ctl"], f"{t0['fitness_ctl']:.0f}", "",
        f"{'+' if (ramp or 0) >= 0 else ''}{ramp} in 7 Tagen" if ramp is not None else "",
        "gut" if ramp is not None and 3 <= ramp <= 6 else "warn" if ramp is not None and ramp > 8 else "neutral",
        "42 Tage", "Ziel-Anstieg +3 bis +6 pro Woche [29]")
    add("form", "Form (TSB)", t0["form_tsb"], f"{t0['form_tsb']:+.0f}", "", f"Ermüdung (ATL) {t0['ermuedung_atl']:.0f}",
        "warn" if t0["form_tsb"] < -25 else "gut" if t0["form_tsb"] > -10 else "neutral", "heute",
        "Fitness minus Ermüdung. Nur als Trend lesen [22, 23]")

    wk = woche_of(HEUTE)
    w_now = next((w for w in wochen if w["woche"] == wk), None)
    prev = [w for w in wochen if w["woche"] < wk][-4:]
    h_now = w_now["h_gesamt"] if w_now else 0.0
    h_avg = round(sum(w["h_gesamt"] for w in prev) / len(prev), 1) if prev else 0
    add("stunden", "Stunden diese Woche", h_now, f"{h_now:.1f}", "h", f"Ø {h_avg} h in den 4 Wochen davor",
        "neutral", f"{wk}, bis heute", "Rahmen im 5-km-Block: 5-7 h")
    hart = w_now["harte_reize"] if w_now else 0
    add("harte_reize", "Harte Reize diese Woche", hart, str(hart), "", "höchstens 3",
        "schlecht" if hart > 3 else "gut", f"{wk}, bis heute", "VO2max und Schwelle, über alle Sportarten")
    km = w_now["km_lauf"] if w_now else 0.0
    add("lauf_km", "Lauf-km diese Woche", km, f"{km:.0f}", "km",
        f"Ø {round(sum(w['km_lauf'] for w in prev) / len(prev), 1) if prev else 0} km in den 4 Wochen davor",
        "neutral", f"{wk}, bis heute", "")

    seit = (HEUTE - timedelta(days=27)).isoformat()
    swims = sum(1 for r in akt if r["sport"] == "Schwimmen" and r["datum"] >= seit)
    add("schwimmen", "Schwimmeinheiten pro Woche", round(swims / 4, 1), f"{swims / 4:.1f}", "",
        "Sockel: mindestens 2, Ziel 3", "gut" if swims / 4 >= 2 else "warn" if swims / 4 >= 1 else "schlecht",
        "letzte 28 Tage", "Schwimmen ist der größte Hebel für den Ironman")

    rp7 = [t["ruhepuls"] for t in tage[-7:] if t["ruhepuls"]]
    rp28 = [t["ruhepuls"] for t in tage[-28:] if t["ruhepuls"]]
    if rp7 and rp28:
        m7, m28 = sum(rp7) / len(rp7), sum(rp28) / len(rp28)
        add("ruhepuls", "Ruhepuls", round(m7, 1), f"{m7:.0f}", "bpm", f"{m7 - m28:+.1f} gegenüber 28-Tage-Mittel {m28:.0f}",
            "warn" if m7 - m28 > 3 else "gut", "Ø letzte 7 Tage", "Steigt er dauerhaft, deutet das auf Stress, Infekt oder Ermüdung")
    sl7 = [t["schlaf_h"] for t in tage[-7:] if t["schlaf_h"]]
    if sl7:
        m = sum(sl7) / len(sl7)
        add("schlaf", "Schlaf", round(m, 1), f"{m:.1f}", "h", f"{len(sl7)} von 7 Nächten gemessen",
            "gut" if m >= 8 else "warn" if m >= 7 else "schlecht", "Ø letzte 7 Tage", "Ziel 8 h+")

    runs28 = [r for r in akt if r["sport"] == "Lauf" and r["datum"] >= seit]
    zt = sum(r["z1_min"] + r["z2_min"] + r["z3_min"] + r["z4_min"] for r in runs28)
    if zt:
        anteil = round(100 * sum(r["z1_min"] for r in runs28) / zt)
        add("locker", "Lockerer Anteil Laufen", anteil, f"{anteil}", "%", "Ziel um 80 % der Zeit",
            "gut" if anteil >= 75 else "warn" if anteil >= 60 else "schlecht", "letzte 28 Tage",
            f"Zeit bis {schwellen_bpm(LTHR_LAUF)[0]} bpm (empirische LT1 = 81 % der LTHR {LTHR_LAUF})")

    seit30 = (HEUTE - timedelta(days=30)).isoformat()
    runs30 = [r for r in akt if r["sport"] == "Lauf" and r["datum"] >= seit30]
    if runs30:
        lg = max(runs30, key=lambda r: r["dauer_min"])
        add("laengster", "Längster Lauf", lg["dauer_min"], f"{lg['dauer_min']:.0f}", "min",
            f"nächster langer Lauf höchstens {lg['dauer_min'] * 1.1:.0f} min", "neutral", "letzte 30 Tage",
            f"am {lg['datum']}, {lg['distanz_km']:.1f} km. 10-%-Regel für einzelne Läufe [28]")

    done = sum(1 for p in ftp if p["status"] == "erledigt")
    add("ftp_builder", "FTP Builder", done, f"{done} von {len(ftp)}", "Einheiten",
        f"nächste: {next((p['nr'] + ' ' + p['einheit'] for p in ftp if p['status'] == 'offen'), '–')}",
        "neutral", "seit 05.11.2026", "Harte Einheiten im 5-km-Block höchstens 1 pro Woche")
    # deutsche Dezimalschreibweise in allen Texten
    for r in rows:
        for f in ("wert_text", "vergleich", "hinweis"):
            r[f] = re.sub(r"(?<=\d)\.(?=\d)", ",", r[f] or "")
    return rows


# ---------------------------------------------------------------- Fortschritt

def tempo_text(s):
    if not s:
        return "–"
    s = round(s)
    return f"{s // 60}:{s % 60:02d}"


def fortschritt(akt, acts) -> dict[str, list[dict]]:
    """Was zeigt, dass der Athlet besser wird: Tempo bei gleichem Puls, Pulsdrift, Bestwerte, VO2max, Rad-Effizienz."""
    raw = {str(a["activityId"]): a for a in acts}
    out: dict[str, list[dict]] = {}

    # 1 Lauf-Effizienz: lockere, flache Läufe 30-90 min mit Ø Puls 130-158, ohne Laufband
    eff = []
    for r in sorted(akt, key=lambda r: (r["datum"], r["start"])):
        a = raw.get(r["id"], {})
        if r["sport"] != "Lauf" or a.get("activityType", {}).get("typeKey") == "treadmill_running" or r["hart"]:
            continue
        if not (30 <= r["dauer_min"] <= 90) or not r["puls_avg"] or not (130 <= r["puls_avg"] <= 158) or r["distanz_km"] <= 0:
            continue
        if r["hm_auf"] / r["distanz_km"] > 12:
            continue
        speed = r["distanz_km"] * 1000 / r["dauer_min"]           # m/min
        ef = speed / r["puls_avg"]
        eff.append({"datum": r["datum"], "id": r["id"], "puls": r["puls_avg"], "tempo_s": round(60000 / speed),
                    "tempo145_s": round(60000 / (ef * 145)), "dauer_min": r["dauer_min"]})
    for i, e in enumerate(eff):
        d = date.fromisoformat(e["datum"])
        win = [x["tempo145_s"] for x in eff[: i + 1] if (d - date.fromisoformat(x["datum"])).days < 28]
        e["trend145_s"] = round(sorted(win)[len(win) // 2]) if len(win) >= 3 else None
        e["tempo_text"] = tempo_text(e["tempo_s"])
        e["tempo145_text"] = tempo_text(e["tempo145_s"])
        e["trend145_text"] = tempo_text(e["trend145_s"])
    out["effizienz"] = eff

    # 2 Pulsdrift auf lockeren Einheiten (Lauf ab 45 min für laufendes LIT-Monitoring, Rad ab 90 min mit Puls)
    drift = []
    for r in akt:
        fs = fit_summary(r["id"])
        if r["hart"]:
            continue
        if r["sport"] == "Lauf" and r["dauer_min"] >= 45 and fs.get("drift") is not None and r["distanz_km"] > 0 \
                and r["hm_auf"] / r["distanz_km"] <= 15:
            drift.append({"datum": r["datum"], "id": r["id"], "sport": "Lauf", "dauer_min": r["dauer_min"], "drift_pct": fs["drift"]})
        if r["sport"] == "Rad" and r["dauer_min"] >= 90 and fs.get("drift_pw") is not None:
            drift.append({"datum": r["datum"], "id": r["id"], "sport": "Rad", "dauer_min": r["dauer_min"], "drift_pct": fs["drift_pw"]})
    out["drift"] = sorted(drift, key=lambda x: x["datum"])

    # 3 Bestwerte: letzte 6 Wochen, 6 Wochen davor, gesamt
    n0, n1 = (HEUTE - timedelta(days=41)).isoformat(), HEUTE.isoformat()
    v0, v1 = (HEUTE - timedelta(days=83)).isoformat(), (HEUTE - timedelta(days=42)).isoformat()

    def best(sport, key, besser, x0="0000", x1="9999"):
        cand = []
        for r in akt:
            if r["sport"] != sport or not (x0 <= r["datum"] <= x1):
                continue
            a = raw.get(r["id"], {})
            if key == "schwimm100":
                if r["distanz_km"] >= 0.8 and a.get("movingDuration"):
                    cand.append((a["movingDuration"] / (a["distance"] / 100), r["datum"], r["id"]))
            elif a.get(key):
                cand.append((a[key], r["datum"], r["id"]))
        if not cand:
            return None, "", ""
        return (min(cand) if besser == "min" else max(cand))

    metr = [("lauf_1k", "Lauf: schnellster 1 km", "Lauf", "fastestSplit_1000", "min", "zeit"),
            ("lauf_5k", "Lauf: schnellste 5 km", "Lauf", "fastestSplit_5000", "min", "zeit"),
            ("lauf_10k", "Lauf: schnellste 10 km", "Lauf", "fastestSplit_10000", "min", "zeit"),
            ("rad_5", "Rad: beste 5 min", "Rad", "maxAvgPower_300", "max", "W"),
            ("rad_20", "Rad: beste 20 min", "Rad", "max20MinPower", "max", "W"),
            ("rad_60", "Rad: beste 60 min", "Rad", "maxAvgPower_3600", "max", "W"),
            ("schwimm", "Schwimmen: bestes Tempo (ab 800 m)", "Schwimmen", "schwimm100", "min", "/100 m")]
    fmt = lambda v, art: "–" if v is None else (tempo_text(v) if art in ("zeit", "/100 m") else f"{round(v)}")
    rows = []
    for id_, name, sport, key, besser, art in metr:
        jv, jd, jid = best(sport, key, besser, n0, n1)
        vv, vd, vid = best(sport, key, besser, v0, v1)
        gv, gd, gid = best(sport, key, besser)
        if jv is None or vv is None:
            richtung = "keine"
        elif abs(jv - vv) < 1e-6:
            richtung = "gleich"
        else:
            richtung = "besser" if (jv < vv if besser == "min" else jv > vv) else "schlechter"
        rows.append({"id": id_, "kennzahl": name, "einheit": "W" if art == "W" else ("/100 m" if art == "/100 m" else ""),
                     "jetzt_text": fmt(jv, art), "jetzt_datum": jd, "jetzt_id": jid,
                     "vorher_text": fmt(vv, art), "vorher_datum": vd, "vorher_id": vid,
                     "gesamt_text": fmt(gv, art), "gesamt_datum": gd, "gesamt_id": gid,
                     "richtung": richtung})
    out["bestwerte"] = rows

    # 4 Garmin-VO2max (nur Trend)
    vo2: dict[str, float] = {}
    for f in sorted((DATA / "vo2max").glob("*.json")):
        for x in json.loads(f.read_text()) or []:
            g = x.get("generic") or {}
            v = g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue")
            if v and g.get("calendarDate"):
                vo2[g["calendarDate"]] = round(v, 1)
    out["vo2max"] = [{"datum": k, "vo2max": v} for k, v in sorted(vo2.items())]

    # 5 Rad-Effizienz: Leistung je Herzschlag (NP / Ø Puls), nur Fahrten mit Leistung und Puls
    out["rad_effizienz"] = [{"datum": r["datum"], "id": r["id"], "titel": r["titel"], "np": r["leistung_np"], "puls": r["puls_avg"],
                             "ef": round(r["leistung_np"] / r["puls_avg"], 2)}
                            for r in akt if r["sport"] == "Rad" and r["leistung_np"] and r["puls_avg"] and r["dauer_min"] >= 30]

    # 6 Kacheln
    tiles = []

    def trend_at(days_ago):
        ziel = (HEUTE - timedelta(days=days_ago)).isoformat()
        vor = [e for e in eff if e["datum"] <= ziel and e["trend145_s"]]
        return vor[-1] if vor else None

    def vgl(diff, wann):
        if diff is None:
            return ""
        if diff == 0:
            return f"gleich wie {wann}"
        return f"{abs(diff)} s/km {'schneller' if diff > 0 else 'langsamer'} als {wann}"

    now, m3, y1 = trend_at(0), trend_at(91), trend_at(365)
    if now:
        diff3 = (m3["trend145_s"] - now["trend145_s"]) if m3 else None
        diff1 = (y1["trend145_s"] - now["trend145_s"]) if y1 else None
        tiles.append({"id": "tempo145", "kpi": "Tempo bei Puls 145", "wert_text": now["trend145_text"], "einheit": "/km",
                      "vergleich": " · ".join(x for x in [vgl(diff3, "vor 3 Monaten"), vgl(diff1, "vor 1 Jahr")] if x),
                      "bewertung": "gut" if diff1 and diff1 > 0 else "neutral", "fenster": "Median der lockeren, flachen Läufe der letzten 4 Wochen",
                      "hinweis": "Je schneller bei gleichem Puls, desto fitter. Hitze, Wind, Schlaf und Stress verschieben den Wert, deshalb gilt der Trend"})
    for b in rows:
        if b["id"] in ("lauf_5k", "rad_20"):
            tiles.append({"id": "best_" + b["id"], "kpi": b["kennzahl"].replace(": ", ", ").replace("Lauf, ", "").replace("Rad, ", "Rad, "),
                          "wert_text": b["jetzt_text"], "einheit": b["einheit"],
                          "vergleich": f"6 Wochen davor {b['vorher_text']}{' ' + b['einheit'] if b['einheit'] and b['vorher_text'] != '–' else ''}",
                          "bewertung": {"besser": "gut", "schlechter": "warn"}.get(b["richtung"], "neutral"),
                          "fenster": "Bestwert im Training der letzten 6 Wochen, kein Test",
                          "hinweis": f"Bestwert gesamt {b['gesamt_text']}{' ' + b['einheit'] if b['einheit'] else ''} am {b['gesamt_datum']}"})
    lauf_drift = [d for d in out["drift"] if d["sport"] == "Lauf"][-3:]
    if lauf_drift:
        med = sorted(d["drift_pct"] for d in lauf_drift)[len(lauf_drift) // 2]
        tiles.append({"id": "drift", "kpi": "Pulsdrift LIT-Läufe (≥ 45 min)", "wert_text": re.sub(r"(?<=\d)\.(?=\d)", ",", f"{med:g}"), "einheit": "%",
                      "vergleich": "unter 5 % heißt stabil unter LT1", "bewertung": "gut" if med <= 5 else "warn",
                      "fenster": f"Median der letzten {len(lauf_drift)} lockeren Läufe ab 45 min",
                      "hinweis": "Wie stark die Effizienz in der zweiten Hälfte nachlässt. Laufendes LIT-Monitoring: über 5 % bedeutet Tempo/Puls drosseln"})
    if out["vo2max"]:
        last = out["vo2max"][-1]
        alt = next((x for x in reversed(out["vo2max"]) if x["datum"] <= (HEUTE - timedelta(days=91)).isoformat()), None)
        tiles.append({"id": "vo2max", "kpi": "VO2max (Garmin)", "wert_text": re.sub(r"(?<=\d)\.(?=\d)", ",", f"{last['vo2max']:g}"), "einheit": "",
                      "vergleich": f"vor 3 Monaten {alt['vo2max']:g}".replace(".", ",") if alt else "", "bewertung": "neutral",
                      "fenster": "Schätzung der Uhr", "hinweis": "Nur als grober Trend: weicht bei Trainierten um mehrere Prozent ab [56]"})
    for t in tiles:
        t["vergleich"] = re.sub(r"(?<=\d)\.(?=\d)", ",", t["vergleich"])
    out["fortschritt"] = tiles
    return out


# ---------------------------------------------------------------- Coach-Einordnung je Einheit

def de_num(v, d=0):
    return f"{v:.{d}f}".replace(".", ",")


def einheiten_rows(akt, kal, acts=None, fb: dict | None = None, act_land: dict | None = None) -> list[dict]:
    """Je Einheit: Runden und eine regelbasierte Coach-Einordnung (Reiz, Puls im erwarteten Bereich, Tempo gehalten,
    Abgleich mit dem Plan). Grundlage: framework.md und wissen/evidenz-2026-11.md (Nummern in [ ])."""
    t1, t2, t3 = schwellen_bpm(LTHR_LAUF)
    soll_by_akt = {k["aktivitaet_id"]: k for k in kal if k["aktivitaet_id"]}
    soll_by_tag: dict[str, list] = {}
    for k in kal:
        if k["datum"]:
            soll_by_tag.setdefault(k["datum"], []).append(k)
    raw_by_id = {str(a["activityId"]): a for a in (acts or [])}
    rpe_map = (fb or {}).get("rpe") or {}
    land_map = act_land or {}
    rows = []
    for r in akt:
        fs = fit_summary(r["id"])
        hist_hr = fs.get("hr") or {}
        if r["sport"] == "Rad" and not hist_hr and r["id"] in raw_by_id:
            _, _, w_hist = tagespuls_im_fenster(raw_by_id[r["id"]])
            if w_hist:
                hist_hr = w_hist
        lthr = LTHR_RAD if r["sport"] == "Rad" else LTHR_LAUF
        z5 = hr_zonen_5(hist_hr, lthr, r["sport"]) if hist_hr else [0.0, 0.0, 0.0, 0.0, 0.0]
        laps = [l + [None] * (6 - len(l)) for l in (fs.get("laps") or [])]
        lap_rows = [{"nr": i + 1, "zeit_s": l[0], "distanz_m": l[1], "tempo_s": round(1000 / l[2]) if l[2] else None,
                     "puls": l[3], "puls_max": l[4], "watt": l[5]} for i, l in enumerate(laps) if l[0]]
        checks = []
        add = lambda punkt, stufe, text: checks.append({"punkt": punkt, "stufe": stufe, "text": text})
        z = [r["z1_min"], r["z2_min"], r["z3_min"], r["z4_min"]]
        ztot = sum(z)
        sport, reiz = r["sport"], r["reiz"]
        einordnung = ""

        # Arbeitsrunden (Intervalle) erkennen: deutlich schneller als der Median oder Puls nah an der Schwelle
        runs = [l for l in lap_rows if l["tempo_s"] and l["distanz_m"] >= 200]
        work = []
        if sport == "Lauf" and len(runs) >= 3:
            med = sorted(l["tempo_s"] for l in runs)[len(runs) // 2]
            work = [l for l in runs if l["tempo_s"] <= med - 20 or ((l["puls"] or 0) >= round(0.93 * LTHR_LAUF) and l["tempo_s"] <= med)]
            if len(work) == len(runs):
                work = []

        if sport == "Lauf":
            if reiz in ("locker", "lang", "Trail"):
                anteil = round(100 * z[0] / ztot) if ztot else None
                einordnung = (f"Reiz: {'lockerer Dauerlauf' if reiz == 'locker' else 'langer Lauf' if reiz == 'lang' else 'Trail-Lauf'}. "
                              "Lockere Einheiten bauen die aerobe Grundlage auf und machen den Großteil eines guten Trainings aus, "
                              "etwa 80 % der Einheiten [2, 7].")
                if anteil is not None:
                    if anteil >= 85:
                        add("Puls", "ok", f"{anteil} % der Zeit bis {t1} bpm (LT1): sauber im LIT-Korridor, so soll es sein.")
                    elif anteil >= 65:
                        add("Puls", "warn", f"Nur {anteil} % der Zeit bis {t1} bpm, {de_num(z[1] + z[2] + z[3])} min darüber (Z3 Grey Zone). "
                                            "Etwas zu flott für einen lockeren Lauf: mehr Ermüdung, kaum mehr Nutzen.")
                    else:
                        add("Puls", "bad", f"Nur {anteil} % der Zeit bis {t1} bpm. Das war kein lockerer Lauf mehr, sondern mittlere Intensität (Z3): "
                                           "ermüdet, ohne den Schwellenreiz richtig zu setzen.")
                if r["dauer_min"] >= 45 and fs.get("drift") is not None:
                    dr = fs["drift"]
                    add("Pulsdrift", "ok" if dr <= 5 else "warn" if dr <= 7 else "bad",
                        f"Aerobic Decoupling (2. vs. 1. Hälfte): {de_num(dr, 1)} %. "
                        + ("Unter 5 %: sauber unter LT1 [63]." if dr <= 5 else "Über 5 %: LT1 leicht überschritten oder Hitze/Ermüdung spielten mit – nächstes Mal 3–5 bpm tiefer anlaufen [63]." if dr <= 7 else "Über 7 %: klare aerobe Entkopplung – Puls konsequent bei ~140 bpm deckeln [63]."))
                if reiz == "Trail":
                    add("Höhenmeter", "ok", f"{r['hm_auf']} Hm hoch, {r['hm_ab']} Hm runter. Bergab belastet die Muskulatur stärker, als der Puls zeigt.")
            elif reiz == "Schwelle":
                einordnung = (f"Reiz: Schwelle (Z4). {de_num(z[2], 1)} min bei {t2}-{t3} bpm (94-102 % deiner LTHR {LTHR_LAUF}), "
                              f"{de_num(z[3], 1)} min darüber. Schwellentraining verbessert, wie lange du ein hohes Tempo halten kannst [38, 40].")
                if z[2] >= 15:
                    add("Umfang", "ok", f"{de_num(z[2], 1)} min im Schwellenbereich: genug für einen vollen Reiz (Ziel 15 bis 40 min).")
                else:
                    add("Umfang", "warn", f"Nur {de_num(z[2], 1)} min im Schwellenbereich: der Reiz ist eher klein (Ziel 15 bis 40 min). "
                                          "Bei kurzen Wiederholungen hinkt der Puls hinterher, dann zählt das Tempo.")
                if z[3] > 0.3 * (z[2] + z[3]):
                    add("Puls", "warn", f"{de_num(z[3], 1)} min über {t3} bpm: teils über der Schwelle. Das ermüdet stärker, ohne den Schwellenreiz zu verbessern.")
                else:
                    add("Puls", "ok", f"Kaum Zeit über {t3} bpm: an der Schwelle geblieben, nicht darüber.")
            elif reiz == "VO2max":
                einordnung = (f"Reiz: VO2max. {de_num(z[3], 1)} min über {t3} bpm (über 102 % LTHR) und {de_num(r['renntempo_min'], 1)} min im 5-km-Zieltempo. "
                              "Intervalle in diesem Bereich heben die maximale Sauerstoffaufnahme, der Kern für schnelle 5 km [49-52].")
                if z[3] >= 8:
                    add("Umfang", "ok", f"{de_num(z[3], 1)} min im VO2max-Bereich: ein voller Reiz (Ziel 8 bis 20 min).")
                else:
                    add("Umfang", "warn", f"{de_num(z[3], 1)} min über {t3} bpm. Bei Intervallen von 3 min und kürzer erreicht der Puls den Bereich oft nicht, "
                                          "dann zählt das Tempo der Wiederholungen.")
            if len(work) >= 2:
                long_work = [l for l in work if l["distanz_m"] >= 400] or work
                spread = max(l["tempo_s"] for l in long_work) - min(l["tempo_s"] for l in long_work)
                tempos = f"{tempo_text(min(l['tempo_s'] for l in long_work))}-{tempo_text(max(l['tempo_s'] for l in long_work))}/km"
                add("Tempo gehalten", "ok" if spread <= 10 else "warn" if spread <= 20 else "bad",
                    f"Intervalle zwischen {tempos}, Spanne {spread} s. "
                    + ("Sehr gleichmäßig." if spread <= 10 else "Spürbare Schwankung: gleichmäßiges Tempo bringt den saubereren Reiz." if spread <= 20
                       else "Große Schwankung: entweder zu schnell begonnen oder hinten eingebrochen."))
                # Wiederholungen = aufeinanderfolgende Arbeitsrunden; verglichen wird der Puls am Ende jeder Wiederholung,
                # weil er zu Beginn einer Wiederholung noch steigt
                reps, cur = [], []
                for l in work:
                    if cur and l["nr"] != cur[-1]["nr"] + 1:
                        reps.append(cur)
                        cur = []
                    cur.append(l)
                if cur:
                    reps.append(cur)
                ends = [rep[-1]["puls"] for rep in reps if rep[-1]["puls"]]
                if len(ends) >= 2:
                    rise = ends[-1] - ends[0]
                    add("Puls über die Intervalle", "ok" if rise <= 6 else "warn",
                        f"Puls am Ende der Wiederholungen: {', '.join(str(x) for x in ends)} bpm. "
                        + ("Stabil: das Tempo war gut dosiert." if rise <= 6 else "Steigt von Wiederholung zu Wiederholung: Ermüdung, Hitze oder zu kurze Pausen."))
        elif sport == "Rad":
            if r["leistung_np"]:
                einordnung = (f"Reiz: {reiz}. Normierte Leistung {r['leistung_np']} W ({round(100 * r['leistung_np'] / FTP)} % der FTP {FTP} W), "
                              f"{de_num(r['rad_schwelle_min'], 1)} min bei 88-105 % FTP, {de_num(r['rad_vo2_min'], 1)} min darüber.")
                if not r["puls_avg"]:
                    add("Puls", "info", "Kein Puls aufgezeichnet: ob die Watt zu deiner Form passen, lässt sich nicht prüfen. Uhr oder Brustgurt mit Zwift verbinden.")
                elif not fs.get("hr"):
                    ef = r["leistung_np"] / r["puls_avg"]
                    add("Puls", "info", f"Puls aus Garmin-Tagesstream ergänzt (Ø {r['puls_avg']} bpm, Max {r['puls_max']} bpm, EF {de_num(ef, 2)} W/bpm). Für sekundengenaues Decoupling Uhr/Gurt direkt mit Zwift koppeln.")
                if reiz == "Schwelle":
                    add("Umfang", "ok" if r["rad_schwelle_min"] >= 20 else "warn",
                        f"{de_num(r['rad_schwelle_min'], 1)} min im Schwellenbereich (Ziel 20 bis 60 min bei Sweet Spot und Tempo).")
            else:
                einordnung = f"Reiz: {reiz}. Ohne Leistungsmesser bewerte ich die Fahrt über den Puls (Rad-Schwelle vorläufig {LTHR_RAD} bpm)."
            if reiz == "lang" and fs.get("drift_pw") is not None:
                dr = fs["drift_pw"]
                add("Pulsdrift", "ok" if dr <= 5 else "warn", f"Watt je Herzschlag in der zweiten Hälfte {de_num(dr, 1)} % schlechter [63].")
        elif sport == "Schwimmen":
            einordnung = (f"Schwimmeinheit, {de_num(r['distanz_km'] * 1000)} m in {r['tempo'] or '–'}. "
                          "Fokus aktuell rein auf Technik, Wasserlage und Kraftausdauer über Zeit (kein harter Tempodruck) [69].")
            add("Häufigkeit", "ok", "Jede Schwimmeinheit zählt: oft und sauber technisch bringt mehr als selten und hart [70].")
        else:
            einordnung = f"Reiz: {reiz}. {de_num(r['dauer_min'])} min."

        # Abgleich mit dem Plan
        plan_text, plan_stufe = "", ""
        if r["id"] in soll_by_akt:
            k = soll_by_akt[r["id"]]
            plan_text, plan_stufe = f"Soll erfüllt: {k['titel']} ({k['details']}).", "ok"
        else:
            offen = [k for k in soll_by_tag.get(r["datum"], []) if k["sport"] == sport and k["status"] != "erledigt"]
            if offen:
                k = offen[0]
                plan_text, plan_stufe = (f"Geplant war {k['titel']} ({k['details']}), die Daten zeigen den Reiz „{reiz}“. "
                                         "Der geplante Reiz ist damit noch offen."), "warn"
        if plan_text:
            add("Plan", plan_stufe, plan_text)

        rpe_entry = rpe_map.get(r["id"]) or {}
        rpe_val = rpe_entry.get("rpe")
        rpe_gef = rpe_entry.get("gefuehl", "")
        rpe_notiz = rpe_entry.get("notiz", "")
        if rpe_val is not None:
            srpe = round(rpe_val * r["dauer_min"])
            add("Subjektiv (RPE)", "ok" if (rpe_val <= 5 and not r["hart"]) or (6 <= rpe_val <= 8 and r["hart"]) else "info",
                f"Session-RPE {rpe_val}/10 ({rpe_gef or 'geloggt'}, sRPE-Load {srpe})" + (f" – „{rpe_notiz}“" if rpe_notiz else "."))

        nb = sum(c["stufe"] == "bad" for c in checks)
        nw = sum(c["stufe"] == "warn" for c in checks)
        if nb:
            fazit, stufe = "Reiz verfehlt oder zu hart: " + next(c["text"] for c in checks if c["stufe"] == "bad"), "bad"
        elif nw:
            fazit, stufe = "Reiz gesetzt, mit Abstrichen: " + next(c["text"] for c in checks if c["stufe"] == "warn"), "warn"
        elif any(c["stufe"] == "ok" for c in checks):
            fazit, stufe = "Saubere Einheit: Reiz getroffen.", "ok"
        else:
            fazit, stufe = "Keine Bewertung möglich.", "neutral"
        land_en, land_de = land_map.get(r["id"], ("", ""))
        rows.append({
            "id": r["id"], "einordnung": einordnung, "fazit": fazit, "fazit_stufe": stufe,
            "checks": json.dumps(checks, ensure_ascii=False), "runden": json.dumps(lap_rows),
            "drift_pct": fs.get("drift"),
            "z5_1_min": z5[0], "z5_2_min": z5[1], "z5_3_min": z5[2], "z5_4_min": z5[3], "z5_5_min": z5[4],
            "land": land_en, "land_de": land_de,
            "rpe": rpe_val, "rpe_gefuehl": rpe_gef, "rpe_notiz": rpe_notiz,
        })
    return rows


# ---------------------------------------------------------------- Veränderungen und Trainer

def trend_rows(akt, tage) -> list[dict]:
    """Letzte 14 Tage gegen die 14 Tage davor (4-Wochen-Fenster würden den Backyard vom 03.10. mitzählen)."""
    a0, a1 = (HEUTE - timedelta(days=13)).isoformat(), HEUTE.isoformat()
    b0, b1 = (HEUTE - timedelta(days=27)).isoformat(), (HEUTE - timedelta(days=14)).isoformat()
    w = lambda x0, x1: [r for r in akt if x0 <= r["datum"] <= x1]
    A, B = w(a0, a1), w(b0, b1)
    tg = {t["datum"]: t for t in tage}

    def mean(field, x0, x1):
        v = [t[field] for t in tage if x0 <= t["datum"] <= x1 and t[field] is not None]
        return round(sum(v) / len(v), 1) if v else None

    def locker(rows):
        runs = [r for r in rows if r["sport"] == "Lauf"]
        zt = sum(r["z1_min"] + r["z2_min"] + r["z3_min"] + r["z4_min"] for r in runs)
        return round(100 * sum(r["z1_min"] for r in runs) / zt) if zt else None

    ctl_now = tg.get(a1, tage[-1])["fitness_ctl"]
    ctl_then = tg.get((HEUTE - timedelta(days=14)).isoformat(), {}).get("fitness_ctl")
    werte = [
        ("fitness", "Fitness (CTL)", ctl_now, ctl_then, "", "hoch", "heute gegen vor 14 Tagen"),
        ("stunden", "Stunden pro Woche", round(sum(r["dauer_min"] for r in A) / 120, 1), round(sum(r["dauer_min"] for r in B) / 120, 1), "h", "hoch", "Ø je Woche"),
        ("lauf_km", "Lauf-km pro Woche", round(sum(r["distanz_km"] for r in A if r["sport"] == "Lauf") / 2, 1),
         round(sum(r["distanz_km"] for r in B if r["sport"] == "Lauf") / 2, 1), "km", "neutral", "Ø je Woche"),
        ("hart", "Harte Reize pro Woche", sum(r["hart"] for r in A) / 2, sum(r["hart"] for r in B) / 2, "", "neutral", "Ø je Woche, Rahmen 2 bis 3"),
        ("schwimmen", "Schwimmen pro Woche", sum(r["sport"] == "Schwimmen" for r in A) / 2, sum(r["sport"] == "Schwimmen" for r in B) / 2, "", "hoch", "Ø je Woche, Sockel mindestens 2"),
        ("kraft", "Kraft pro Woche", sum(r["sport"] == "Kraft" for r in A) / 2, sum(r["sport"] == "Kraft" for r in B) / 2, "", "hoch", "Ø je Woche, Sockel mindestens 1"),
        ("ruhepuls", "Ruhepuls", mean("ruhepuls", (HEUTE - timedelta(days=6)).isoformat(), a1),
         mean("ruhepuls", (HEUTE - timedelta(days=20)).isoformat(), b1), "bpm", "tief", "Ø 7 Tage gegen 7 Tage, 2 Wochen früher"),
        ("schlaf", "Schlaf", mean("schlaf_h", a0, a1), mean("schlaf_h", b0, b1), "h", "hoch", "Ø je gemessener Nacht"),
        ("locker", "Lockerer Anteil Laufen", locker(A), locker(B), "%", "ziel80", f"Anteil der Laufzeit bis {schwellen_bpm(LTHR_LAUF)[0]} bpm (LT1)"),
    ]
    rows = []
    for id_, name, jetzt, vorher, einheit, gut, fenster in werte:
        delta = round(jetzt - vorher, 1) if jetzt is not None and vorher is not None else None
        if delta is None or abs(delta) < 0.05:
            richtung = "gleich"
        elif gut == "hoch":
            richtung = "besser" if delta > 0 else "schlechter"
        elif gut == "tief":
            richtung = "besser" if delta < 0 else "schlechter"
        elif gut == "ziel80":
            richtung = "besser" if abs(jetzt - 80) < abs(vorher - 80) else "schlechter"
        else:
            richtung = "neutral"
        fmt = lambda v: "–" if v is None else re.sub(r"(?<=\d)\.(?=\d)", ",", f"{v:g}")
        rows.append({"id": id_, "kennzahl": name, "jetzt": jetzt, "vorher": vorher, "delta": delta,
                     "jetzt_text": fmt(jetzt), "vorher_text": fmt(vorher),
                     "delta_text": "" if delta is None else ("+" if delta > 0 else "") + fmt(delta),
                     "einheit": einheit, "richtung": richtung, "fenster": fenster})
    return rows


def trainer_rows() -> tuple[list[dict], str]:
    f = ROOT / "briefings" / "trainer.json"
    if not f.exists():
        return [], ""
    t = json.loads(f.read_text())
    rows = []
    for abschnitt in ("takeaways", "gut", "schlecht", "fokus"):
        for i, text in enumerate(t.get(abschnitt, []), 1):
            rows.append({"id": f"{abschnitt}-{i}", "abschnitt": abschnitt, "nr": i, "text": text, "stand": t.get("stand", "")})
    return rows, t.get("stand", "")


def trainingsplan_rows(wochen: list[dict], tage: list[dict], kal: list[dict]) -> list[dict]:
    """Kombiniert plan/roadmap.json, plan/soll.json, Ist-Wochen und Kalender-Status für die Trainingsplan-Seite."""
    rm_file = ROOT / "plan" / "roadmap.json"
    soll_file = ROOT / "plan" / "soll.json"
    if not rm_file.exists() or not soll_file.exists():
        return []
    rm = json.loads(rm_file.read_text(encoding="utf-8"))
    soll = json.loads(soll_file.read_text(encoding="utf-8"))

    ctl_by_date = {t["datum"]: t["fitness_ctl"] for t in tage}
    # Letzte 4 echte Ist-Wochen vor dem aktiven Block (bis einschließlich aktuelle Woche)
    active_starts = {w["start"] for w in soll.get("wochen", []) if w["woche"] >= "2026-W48"}
    first_active = min(active_starts) if active_starts else HEUTE.isoformat()
    ist_wochen = []
    for w in [x for x in wochen if x["start"] < first_active][-4:]:
        end_d = (date.fromisoformat(w["start"]) + timedelta(days=6)).isoformat()
        ctl_end = ctl_by_date.get(end_d) or ctl_by_date.get(HEUTE.isoformat()) or (tage[-1]["fitness_ctl"] if tage else 0)
        ist_wochen.append({
            "woche": w["woche"], "start": w["start"], "phase": 0, "typ": "ist", "deload": False,
            "h_lauf": w["h_lauf"], "h_rad": w["h_rad"], "h_schwimmen": w["h_schwimmen"], "h_sonst": w["h_sonst"],
            "h_gesamt": w["h_gesamt"], "km_lauf": w["km_lauf"], "harte_reize": w["harte_reize"],
            "ctl": round(ctl_end, 1), "fokus": f"Ist-Woche ({w['h_gesamt']} h · {w['km_lauf']} km Lauf · {w['harte_reize']} harte Reize)",
        })

    # Kalender-Status nach (woche, tag, titel) mappen
    kal_by_week: dict[str, list[dict]] = {}
    for k in kal:
        kal_by_week.setdefault(k["woche"], []).append(k)

    harte_typen = {"Test5k", "VO2max", "Schwelle", "Renntempo", "hart"}
    block_wochen = []
    for wo in soll.get("wochen", []):
        if wo["woche"] < "2026-W48":
            continue
        klist = kal_by_week.get(wo["woche"], [])
        items_out = []
        h_sp = {"Lauf": 0.0, "Rad": 0.0, "Schwimmen": 0.0, "Sonst": 0.0}
        km_lauf = 0.0
        harte = 0
        swims = 0
        kraft = 0
        lit_min = 0.0
        z4_min = 0.0
        z5_min = 0.0
        for idx, it in enumerate(wo.get("items", [])):
            km_match = klist[idx] if idx < len(klist) else {}
            dmin = float(it.get("dauer_min") or (60 if it["sport"] == "Rad" else 50 if it["sport"] == "Lauf" else 40 if it["sport"] == "Schwimmen" else 25))
            sp_key = it["sport"] if it["sport"] in ("Lauf", "Rad", "Schwimmen") else "Sonst"
            h_sp[sp_key] += dmin / 60.0
            if it["sport"] == "Lauf":
                km_lauf += float(it.get("distanz_km") or round(dmin / 5.7, 1))
            is_hard = it["reiz"] in harte_typen
            if is_hard:
                harte += 1
            if it["sport"] == "Schwimmen":
                swims += 1
            if it["sport"] == "Kraft":
                kraft += 1
            if it["reiz"] in ("VO2max", "Test5k"):
                z5_min += min(dmin * 0.40, 22)
                lit_min += max(dmin - min(dmin * 0.40, 22), 0)
            elif it["reiz"] in ("Schwelle", "Renntempo", "hart"):
                z4_min += min(dmin * 0.48, 35)
                lit_min += max(dmin - min(dmin * 0.48, 35), 0)
            else:
                lit_min += dmin
            items_out.append({
                "tag": it.get("tag", ""),
                "wochentag": TAGE[date.fromisoformat(it["tag"]).weekday()] if it.get("tag") else "",
                "zeit": it.get("zeit", ""),
                "sport": it["sport"],
                "reiz": it["reiz"],
                "titel": it["titel"],
                "details": it.get("details", ""),
                "ebene": it.get("ebene", ""),
                "dauer_min": round(dmin),
                "distanz_km": it.get("distanz_km"),
                "zone": it.get("zone", ""),
                "warum": it.get("warum", ""),
                "hart": is_hard,
                "status": km_match.get("status", "offen"),
                "erledigt_am": km_match.get("erledigt_am", ""),
                "aktivitaet_id": km_match.get("aktivitaet_id", ""),
            })
        h_ges = round(sum(h_sp.values()), 1)
        block_wochen.append({
            "woche": wo["woche"],
            "start": wo["start"],
            "titel": wo["titel"],
            "phase": wo.get("phase", wo["titel"]),
            "ziel": wo.get("ziel", ""),
            "h_lauf": round(h_sp["Lauf"], 1),
            "h_rad": round(h_sp["Rad"], 1),
            "h_schwimmen": round(h_sp["Schwimmen"], 1),
            "h_sonst": round(h_sp["Sonst"], 1),
            "h_gesamt": h_ges,
            "km_lauf": round(km_lauf, 1),
            "harte_reize": harte,
            "schwimm_einheiten": swims,
            "kraft_einheiten": kraft,
            "quali_lauf_km": wo.get("quali_lauf_km", 0),
            "lit_min": round(lit_min),
            "z4_min": round(z4_min),
            "z5_min": round(z5_min),
            "erledigt": sum(1 for x in items_out if x["status"] == "erledigt"),
            "gesamt": len(items_out),
            "items": items_out,
        })

    makro = []
    for mw in rm.get("makro_wochen", []):
        m = dict(mw)
        m["h_gesamt"] = round(m["h_lauf"] + m["h_rad"] + m["h_schwimmen"] + m["h_sonst"], 1)
        makro.append(m)

    payload = {
        "stand": rm.get("stand", HEUTE.isoformat()),
        "ziele": rm.get("ziele", {}),
        "radar": rm.get("radar", []),
        "ironman_splits": rm.get("ironman_splits", {}),
        "phasen": rm.get("phasen", []),
        "ist_wochen": ist_wochen,
        "makro_wochen": makro,
        "block_wochen": block_wochen,
    }
    return [{"id": "plan", "stand": payload["stand"], "payload": json.dumps(payload, ensure_ascii=False)}]


# ---------------------------------------------------------------- Ausgabe

def schreiben(name: str, rows: list[dict], quellen: str, code: str) -> None:
    OUT.mkdir(exist_ok=True)
    meta = [
        {"label": "Stand", "value": datetime.now().strftime("%Y-%m-%d %H:%M")},
        {"label": "Quellen", "value": quellen},
        {"label": "auswertung.py", "value": code, "type": "code", "lang": "python"},
    ]
    (OUT / f"{name}.json").write_text(json.dumps({"rows": rows, "meta": meta}, ensure_ascii=False))
    if rows:
        with open(OUT / f"{name}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)


def main() -> int:
    code = Path(__file__).read_text()
    acts = alle_aktivitaeten()
    ruhe, schlaf = tageswerte()
    fb = load_feedback()
    akt = aktivitaeten_rows(acts, ruhe)
    tage = tage_rows(akt, ruhe, schlaf)
    wochen = wochen_rows(akt)
    kal = kalender_rows(akt)
    marker = marker_rows()
    events = event_rows()
    ftp = ftp_builder_rows(akt)
    laender, act_land = laender_rows(acts)
    kpis = kpi_rows(akt, tage, wochen, ftp, events, fb)
    g = "Garmin Personal API (data/)"
    schreiben("aktivitaeten", akt, f"{g}, Aktivitäten und FIT-Dateien", code)
    schreiben("tage", tage, f"{g}, Tageswerte, Schlaf und Last aus aktivitaeten", code)
    schreiben("wochen", wochen, "aus aktivitaeten", code)
    schreiben("kalender", kal, "plan/soll.json, abgeglichen mit aktivitaeten", code)
    schreiben("marker", marker, "athlet/marker.md", code)
    schreiben("events", events, "athlet/events.json (Ergebnisse aus Garmin, Einschätzung vom Coach)", code)
    schreiben("ftp_builder", ftp, "wissen/zwift-ftp-builder.md, abgeglichen mit Zwift-Fahrten", code)
    schreiben("kpis", kpis, "aus aktivitaeten, tage, wochen, ftp_builder, feedback", code)
    schreiben("laender", laender, f"{g}, GPS-Startpunkt je Aktivität, nur das Land", code)
    schreiben("trends", trend_rows(akt, tage), "aus aktivitaeten und tage: letzte 14 Tage gegen die 14 davor", code)
    schreiben("einheiten", einheiten_rows(akt, kal, acts, fb, act_land), "aus aktivitaeten, FIT-Runden, 5-Zonen-Modell, Feedback und Plan", code)
    for name, rows in fortschritt(akt, acts).items():
        schreiben(name, rows, "aus aktivitaeten, FIT-Dateien und Garmin-VO2max", code)
    tr, stand = trainer_rows()
    schreiben("trainer", tr, f"briefings/trainer.json, geschrieben vom AI-Coach, Stand {stand}", code)
    tp = trainingsplan_rows(wochen, tage, kal)
    schreiben("trainingsplan", tp, "plan/roadmap.json, plan/soll.json, Ist-Wochen und Kalender-Abgleich", code)
    schreiben("feedback", feedback_rows(fb), "athlet/feedback.json (Subjektive Tagesform & Session-RPE)", code)
    fehler = sum(1 for p in CACHE.glob("*.json") if '"fehler"' in p.read_text()[:2000])
    print(f"{len(akt)} Aktivitäten, {len(tage)} Tage, {len(wochen)} Wochen, {len(kal)} Soll-Reize, "
          f"{len(marker)} Marker, {len(events)} Events, {len(ftp)} FTP-Builder-Einheiten, {len(kpis)} KPIs. "
          f"FIT-Fehler: {fehler}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
