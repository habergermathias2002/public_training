#!/usr/bin/env python3
"""Zeigt die einzelnen Runden einer Aktivitaet, gelesen aus der Original-FIT-Datei.

Aufruf:
  bin/laps.py              letzte Aktivitaet
  bin/laps.py 25150826731  bestimmte Aktivitaet (ID aus data/activities/*.json)

Fehlt die FIT-Datei in data/activities/files/, wird sie geladen. Kleiner eigener FIT-Leser
(nur Standardbibliothek), liest nur die Runden-Nachrichten (global 19).
"""

from __future__ import annotations

import io
import json
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402

LAP = 19
INTENSITY = {0: "aktiv", 1: "Pause", 2: "Warm-up", 3: "Cool-down", 4: "Erholung", 5: "Intervall", 6: "sonst."}
INVALID = {1: 0xFF, 2: 0xFFFF, 4: 0xFFFFFFFF}


def fit_bytes(aid: str) -> bytes:
    z = fetch.DATA / "activities" / "files" / f"{aid}.zip"
    if not z.exists():
        fetch.save("activities/files", f"{aid}.zip",
                   fetch.get(f"/download-service/files/activity/{aid}",
                             accept="application/zip, application/x-zip-compressed, application/octet-stream"))
    with zipfile.ZipFile(z) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".fit"))
        return zf.read(name)


def laps(buf: bytes) -> list[dict]:
    hsize = buf[0]
    data_size = struct.unpack_from("<I", buf, 4)[0]
    if buf[8:12] != b".FIT":
        raise ValueError("keine FIT-Datei")
    pos, end = hsize, hsize + data_size
    defs: dict[int, tuple] = {}
    out = []
    while pos < end:
        h = buf[pos]
        pos += 1
        if h & 0x80:  # komprimierter Zeitstempel-Header -> Datennachricht
            local, is_def, dev = (h >> 5) & 0x3, False, False
        else:
            local, is_def, dev = h & 0x0F, bool(h & 0x40), bool(h & 0x20)
        if is_def:
            arch = buf[pos + 1]
            e = ">" if arch == 1 else "<"
            gnum = struct.unpack_from(e + "H", buf, pos + 2)[0]
            n = buf[pos + 4]
            pos += 5
            fields = [(buf[pos + 3 * i], buf[pos + 3 * i + 1]) for i in range(n)]
            pos += 3 * n
            dev_size = 0
            if dev:
                nd = buf[pos]
                pos += 1
                dev_size = sum(buf[pos + 3 * i + 1] for i in range(nd))
                pos += 3 * nd
            defs[local] = (gnum, e, fields, dev_size)
            continue
        gnum, e, fields, dev_size = defs[local]
        rec = {}
        for num, size in fields:
            if gnum == LAP and size in (1, 2, 4):
                fmt = {1: "B", 2: "H", 4: "I"}[size]
                v = struct.unpack_from(e + fmt, buf, pos)[0]
                if v != INVALID[size]:
                    rec[num] = v
            pos += size
        pos += dev_size
        if gnum == LAP:
            out.append(rec)
    return out


def mmss(sec: float) -> str:
    sec = round(sec)
    return f"{sec // 60}:{sec % 60:02d}"


def main() -> int:
    if len(sys.argv) > 1:
        aid = sys.argv[1]
        act = json.loads(fetch.get(f"/activity-service/activity/{aid}"))
        name, start = act.get("activityName"), (act.get("summaryDTO") or {}).get("startTimeLocal")
    else:
        act = json.loads(fetch.get("/activitylist-service/activities/search/activities", {"start": 0, "limit": 1}))[0]
        aid, name, start = str(act["activityId"]), act.get("activityName"), act.get("startTimeLocal")

    print(f"{name}  ({start}, ID {aid})\n")
    print(f"{'Rd':>3} {'Typ':<10} {'Zeit':>6} {'km':>6} {'Pace':>6} {'ØHF':>4} {'maxHF':>5} {'spm':>4} {'Hm':>3}")
    for i, r in enumerate(laps(fit_bytes(aid)), 1):
        t = r.get(8, r.get(7, 0)) / 1000            # total_timer_time / total_elapsed_time
        dist = r.get(9, 0) / 100                      # total_distance, m
        spd = r.get(110, r.get(13, 0)) / 1000         # enhanced_avg_speed / avg_speed, m/s
        pace = mmss(1000 / spd) if spd else "-"
        cad = r.get(17)                               # Laufen: Doppelschritte/min
        spm = round(2 * (cad + r.get(80, 0) / 128)) if cad is not None else "-"
        typ = INTENSITY.get(r.get(23), "-")
        print(f"{i:>3} {typ:<10} {mmss(t):>6} {dist / 1000:>6.2f} {pace:>6} "
              f"{r.get(15, '-'):>4} {r.get(16, '-'):>5} {spm:>4} {r.get(21, '-'):>3}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
