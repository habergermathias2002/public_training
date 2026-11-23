#!/usr/bin/env python3
"""Wandelt die Natural-Earth-Länder (world-atlas, TopoJSON) in eine schlanke Kartengrundlage für das Dashboard.

Aufruf: /opt/homebrew/bin/python3 -I bin/karte.py <countries-50m.json>
Quelle: https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json (Natural Earth, gemeinfrei).
Schreibt auswertung/karte.json ({rows, meta}): ein Land je Zeile mit GeoJSON-Geometrie, Koordinaten auf 2 Stellen gerundet.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main(src: str) -> int:
    topo = json.loads(Path(src).read_text())
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((round(x * sx + tx, 2), round(y * sy + ty, 2)))
        arcs.append(pts)

    def ring(idx):
        out = []
        for i in idx:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            for p in (pts if not out else pts[1:]):
                # Punkte, die weniger als 0,1° vom letzten entfernt liegen, weglassen (spart Größe)
                if not out or abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= 0.1:
                    out.append(p)
        if out and out[0] != out[-1]:
            out.append(out[0])
        return [list(p) for p in out] if len(out) >= 4 else None

    def area(r):
        """Ebene Fläche nach der Gaußschen Trapezformel (Länge = x, Breite = y), positiv = gegen den Uhrzeigersinn."""
        return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2

    rows = []
    for g in topo["objects"]["countries"]["geometries"]:
        name = (g.get("properties") or {}).get("name", "")
        if name == "Antarctica" or not g.get("arcs"):
            continue
        if g["type"] == "Polygon":
            polys = [g["arcs"]]
        else:
            polys = g["arcs"]
        coords = []
        for poly in polys:
            rings = [r for r in (ring(r) for r in poly) if r]
            # Umlaufrichtung erzwingen, wie d3 sie erwartet: Außenring im Uhrzeigersinn (Fläche < 0), Löcher gegen.
            # Durch das Vereinfachen kann ein kleiner Ring kippen; d3 malt ihn dann als "ganze Welt außer Ring".
            fixed = []
            for i, r in enumerate(rings):
                if max(p[0] for p in r) - min(p[0] for p in r) > 180:  # über die Datumsgrenze: ebene Fläche taugt nicht
                    fixed.append(r)
                    continue
                a = area(r)
                if abs(a) < 0.01:  # winzige Inseln und Löcher weglassen
                    continue
                if (i == 0 and a > 0) or (i > 0 and a < 0):
                    r = r[::-1]
                fixed.append(r)
                if i == 0 and not fixed:
                    break
            if fixed and (area(fixed[0]) < 0 or max(p[0] for p in fixed[0]) - min(p[0] for p in fixed[0]) > 180):
                coords.append(fixed)
        if coords:
            rows.append({"land": name, "id": g.get("id", ""),
                         "geometry": {"type": "MultiPolygon", "coordinates": coords}})
    meta = [
        {"label": "Stand", "value": datetime.now().strftime("%Y-%m-%d %H:%M")},
        {"label": "Quelle", "value": "Natural Earth 1:50m (gemeinfrei) über world-atlas 2.0.2, Koordinaten auf 0,01° gerundet"},
        {"label": "karte.py", "value": Path(__file__).read_text(), "type": "code", "lang": "python"},
    ]
    out = ROOT / "auswertung" / "karte.json"
    out.write_text(json.dumps({"rows": rows, "meta": meta}, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(rows)} Länder, {out.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
