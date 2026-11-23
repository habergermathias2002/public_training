# Trainings-Framework

Methodik für datenbasierte Ausdauer- und Triathlon-Trainingssteuerung. Persönliche Leistungswerte gehören nach `athlet/marker.md`, Rahmenbedingungen nach `athlet/profil.md`, konkrete Ziele nach `athlet/ziele.md`.

---

## 1. Ziel-Ebenen
Training wird immer über zwei Ebenen gesteuert:
- **Ebene 1 – Nahziel (Fokusblock, 4–8 Wochen):** Konkrete Detailplanung in `plan/aktuell.md` und `plan/soll.json`, rückwärts vom nächsten Test oder B-Event gerechnet.
- **Ebene 2 – Hauptziel (Saison-Makroplan):** Übergeordnete Leitplanken und progressive Volumen-/Intensitätsentwicklung in `plan/roadmap.json`.

---

## 2. Pflicht-Sockel (wöchentliche Konstanten)
Einheiten, die langfristig den größten Engpass abbauen (z. B. Schwimmtechnik, schweres Krafttraining, langer Grundlagenlauf/-rad), laufen als Sockel stabil neben dem Fokusblock mit.

---

## 3. Reiz-Konto & „Ist vor Soll“
- Jede Einheit hat **genau ein Reizziel** (z. B. `locker` / LIT, `Schwelle`, `VO2max`, `Renntempo`, `lang`, `Schwimmen`, `Kraft`).
- Absolvierte Einheiten werden **anhand der tatsächlichen Sensordaten** (Herzfrequenz-Verteilung, Dauer, Leistung) einem Reiztyp zugeordnet, nicht nach dem geplanten Titel.
- Ausgefallene Einheiten verfallen und werden nicht durch Doppelbelastung „nachgeholt“.

---

## 4. Tagesform-Ampel (Readiness)
Vor jeder harten Einheit prüft der Coach objektive Marker (Ruhepuls-Delta, Schlafdauer, TSB) und subjektives Feedback (`athlet/feedback.json`: Beine 1–5, Stress 1–5, Schlaf 1–5):
- **🟢 GRÜN:** Plan wie vorgesehen.
- **🟡 GELB:** Intensität reduzieren oder Umfang kürzen (z. B. LIT statt Intervalle).
- **🔴 ROT:** Ruhetag oder reine Regeneration (Z1).

---

## 5. Trainingslast (TRIMP / CTL / ATL / TSB)
`bin/auswertung.py` berechnet eigenständig aus den Garmin-FIT-Dateien bzw. Aktivitätsdaten:
- **TRIMP / Last:** Herzfrequenz- und/oder leistungsbasiert (unabhängig von Hersteller-Schätzungen).
- **CTL (Fitness, 42-Tage-EMA):** Langfristige Trainingsbelastung.
- **ATL (Ermüdung, 7-Tage-EMA):** Kurzfristige Belastung.
- **TSB (Form = CTL − ATL):** Positiv = frisch/getapert, stark negativ = akkumulierte Ermüdung.

---

## 6. 5-Zonen-Modell (LT1 / LT2-verankert)
Individuelle Pulszonen richten sich nach **LT1** (aerobe Schwelle, empirisch aus stabilen LIT-Einheiten mit < 5 % Pulsdrift) und **LTHR / LT2** (Laktatschwelle aus 20–30-min-Test oder 5–10-km-All-Out) – **nicht** nach pauschalen `% HFmax`-Formeln.

| Zone | Bezeichnung | Orientierung | Typischer Zweck |
|---|---|---|---|
| **Z1** | Recovery | `< 92 % LT1` | Aktive Erholung, Auslaufen |
| **Z2** | Easy / LIT | `92–100 % LT1` | Grundlagenausdauer, Fettstoffwechsel, Pulsdrift `< 5 %` |
| **Z3** | Tempo / Moderat | `LT1` bis `~94 % LTHR` | Wettkampfspezifisch (Halbmarathon / Mitteldistanz), im Alltag sparsam einsetzen |
| **Z4** | Schwelle (LT2) | `~94–102 % LTHR` | Laktat-Clearance, Schwellen-Intervalle |
| **Z5** | VO2max | `> 102 % LTHR` | Maximale Sauerstoffaufnahme, kurze harte Intervalle (`Pace führt`) |

Trage deine persönlichen Werte in `athlet/marker.md` und oben in `bin/auswertung.py` ein.

---

## 7. Qualitätsregeln für Einheiten
- **Format:** Lauf- und Schwimm-Intervalle immer als **`Reps × Distanz`** inkl. Ziel-Pulszone und Pace-Korridor.
- **LIT-Monitoring:** Bei jedem LIT-Lauf ≥ 45 min werden Pulsdrift (`drift_pct`, Ziel `< 5 %`), Zonen-Disziplin (`% Zeit ≤ LT1`) und aerobe Effizienz (`Pace bei konstantem Puls`) ausgewertet.
- **Rad-Monitoring:** Efficiency Factor (`NP / Ø Puls`) und Variabilitätsindex (`VI = NP / Ø Watt`).
- **48-h-Kraft-Regel:** Schweres Unterkörper-Krafttraining (≥ 80 % 1RM) nicht innerhalb von 48 h vor einem harten Lauftest oder Schlüsselintervallen.
- **Aktualitätsregel für Marker:** Tempos/Watt gelten 6 Wochen, Pulsschwellen (LTHR/HFmax) 6 Monate. Abgelaufene Werte müssen neu getestet werden.
