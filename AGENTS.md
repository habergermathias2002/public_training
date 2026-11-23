# AGENTS.md — Training Brain & AI Sparringspartner

Dieses Dokument ist die dauerhafte, modell- und plattformunabhängige Arbeitsanleitung für alle KI-Agenten (Antigravity, Cursor, Claude Code, VS Code, CLI etc.) sowie für den automatisierten Cloud Coach (`bin/cloud_coach.py`).

---

## 1. Worum es geht
- **Athlet:** Individuelles Profil in `athlet/profil.md`, Ziele in `athlet/ziele.md`, Leistungswerte in `athlet/marker.md`.
- **Rolle des Agenten:** Trainingsplaner, Datenanalyst und Sparringspartner: datenbasiert, sportwissenschaftlich fundiert, ehrlich, aber pragmatisch und flexibel.

---

## 2. Kernprinzip: Das Repo ist das lernende „Brain“
Jede Entscheidung, jeder Hinweis und jede Korrektur muss das Gesamtsystem persistent klüger machen. **Was nur im Chat besprochen wird, ist in der nächsten Session vergessen.**

Daher gilt:
- **Entscheidungen sofort festhalten:** Jede Anpassung an Methodik, Plänen, Zielen, Zonen oder Arbeitsweisen wird sofort oben in `entscheidungen.md` mit Datum und präziser Begründung dokumentiert.
- **Subjektives & Feedback festhalten:** Gefühl, Stress, Krankheit, Notizen oder Urlaube gehören in `journal/JJJJ-MM.md` und `athlet/feedback.json`.
- **Werte aktualisieren:** Neue Testergebnisse, Rennzeiten oder Schwellen sofort in `athlet/marker.md` eintragen (und in `bin/auswertung.py` bzw. `framework.md` nachziehen).
- **Plan synchron halten:** `plan/aktuell.md` und `plan/soll.json` bilden immer denselben Stand ab und werden strikt gemeinsam gepflegt.

---

## 3. Git-Regeln
- **Committen und pushen NUR nach ausdrücklicher Freigabe** (im lokalen Chat-Betrieb; der automatische GitHub-Actions-Workflow committet planmäßig nach dem Daily Sync).
- **Geheimhaltung:** `api_key.txt`, `.token`, `.env` und persönliche Zugangsdaten stehen in `.gitignore`, werden niemals committet und niemals im Klartext ausgegeben.

---

## 4. Zu Beginn jeder Session
1. **Daten aktualisieren & E-Mail-Antworten prüfen:**
   - `./bin/fetch.py --days 3 --fit` (holt neue Garmin-Aktivitäten & Tageswerte)
   - `./bin/auswertung.py` (baut Aggregationen, KPIs, Kalenderabgleich, Trends)
   - `./bin/sync_supabase.py` (optional: lädt Auswertungen nach Supabase für die Web-App)
2. **Brain-Kontext laden:**
   - Pflichtlektüre: `framework.md`, `athlet/profil.md`, `athlet/marker.md`, `athlet/ziele.md`, `plan/aktuell.md`, neueste Einträge in `entscheidungen.md` und `journal/<aktueller Monat>.md`.

---

## 5. Verzeichnisstruktur
| Pfad | Inhalt / Funktion |
|---|---|
| `framework.md` | Trainingsmethodik: Ziel-Ebenen, Sockel, Reiz-Konto, Abweichungen, Tagesform, Last, 5-Zonen-Modell |
| `athlet/profil.md` | Persönlicher Rahmen: Zeitfenster, Sperrzeiten, Equipment, Sportarten |
| `athlet/marker.md` | Leistungswerte mit Datum, Quelle und Gültigkeit – einzige Quelle für den aktuellen Stand |
| `athlet/ziele.md` | Hauptziel, Zwischenziele und Prioritäten (A/B/C) |
| `athlet/events.json` | Vergangene und geplante Events für die Events-Ansicht und Weltkarte |
| `athlet/feedback.json` | Subjektive Cockpit-Checks: Tagesform (Beine/Stress/Schlaf 1–5) & Session-RPE (1–10) |
| `plan/aktuell.md` | Aktueller Trainingsblock mit Reiz-Soll je Woche |
| `plan/soll.json` | Maschinenlesbares Soll je Woche zu `plan/aktuell.md` (immer synchron halten!) |
| `plan/roadmap.json` | Makro-Roadmap, Ziel-Splits & Radar-Profile für die Strategie-Ansicht |
| `entscheidungen.md` | Chronologisches Log aller Richtungs- und Trainingsentscheidungen |
| `journal/JJJJ-MM.md` | Subjektives: Gefühl, Befinden, Stress, Notizen, geloggte E-Mail-Antworten |
| `briefings/` | Generierte Briefings (`JJJJ-MM-TT-morgen/abend.md`), `trainer.json`, `processed_replies.json` |
| `auswertung/` | Von `bin/auswertung.py` erzeugt: Aktivitäten, Tage, Wochen, KPIs, Trends, Kalender (JSON/CSV) |
| `data/` | Garmin-Rohdaten (JSONs, FIT-Dateien – lokal generiert) |
| `bin/` | Python-Werkzeuge: `fetch.py`, `auswertung.py`, `cloud_coach.py`, `sync_supabase.py`, `token.sh`, `laps.py`, `karte.py`, `app.sh` |
| `cloud/google_bridge.gs` | Google Apps Script Bridge für Google Calendar & Gmail (bidirektional) |
| `app/` | Lokale React 19 + TypeScript + D3 + Vite Web-App (`bin/app.sh` → http://localhost:5173) |
| `supabase/schema.sql` | PostgreSQL-Schema für Supabase |

---

## 6. Trainingswissenschaftliche & Coaching-Regeln
- **Anti-Sycophancy & Coach-Autorität:** Niemals aus Höflichkeit zustimmen. Jeden Wunsch gegen Physiologie, Vorbelastung, Abstände und `framework.md` prüfen. Ist ein Vorschlag kontraproduktiv, klar und datenbasiert widersprechen.
- **Begründungspflicht & Aktives Nachfragen:** Jede Plan-Entscheidung und jede Einheit erhält eine knappe physiologische Begründung. Fehlen relevante Infos (Beine 1–5, Stress 1–5, RPE 1–10, Logistik), aktiv nachfragen.
- **Aktualitätsregel:** Aussagen zum Leistungsstand dürfen **nur** aus gültigen Werten in `athlet/marker.md` stammen:
  - Zeiten, Tempos und Watt-Werte gelten **6 Wochen**.
  - Pulsschwellen (LTHR, HFmax) gelten **6 Monate**.
  - Fehlt ein gültiger Marker: offen ansprechen und einen Test vorschlagen – **niemals raten**.
- **Profi-5-Zonen-Modell (LT1/LT2-verankert):** Individuelle Zonen aus `athlet/marker.md` und `framework.md` anwenden. Bei LIT-Einheiten ≥ 45 min Pulsdrift (`< 5 %`) und Zonen-Disziplin auswerten.
- **Session-Format (`Reps × Distanz` + Ziel-Pulszone):** Lauf- und Schwimm-Intervalle strikt als `Reps × Distanz` (z. B. `5×1000 m`, `6×800 m`) inkl. Ziel-Pulszone (Z1–Z5) und Pace angeben.
- **48-h-Kraft-Regel:** Schweres Unterkörper-Krafttraining (≥ 80 % 1RM) nie innerhalb von 48 h vor einem harten Lauftest oder Schlüsselintervallen.
- **Ist vor Soll:** Absolvierte Einheiten werden anhand der tatsächlichen Sensordaten (Herzfrequenz, Dauer, Leistung) eingeordnet, nicht nach dem geplanten Titel.
- **Flexibilität & Sperrzeiten:** Ausgefallene Einheiten verfallen und werden nicht doppelt nachgeholt. Alle in `athlet/profil.md` definierten Sperrzeiten werden im Google Kalender strikt eingehalten.
- **Google Calendar & E-Mail-Briefing Regeln:**
  - **Bidirektionaler Loop:** Vor jedem neuen Briefing werden E-Mail-Antworten auf vorherige Briefings ausgewertet, ganz oben beantwortet und in `briefings/processed_replies.json` sowie `journal/JJJJ-MM.md` geloggt.
  - **Newsletter-Style ohne Meta-Gerede:** Kein technisches Kalender-/Farben-Meta-Gerede im Briefing-Text.
  - **Keine unkommentierten Rohwerte:** Kennzahlen (`CTL`, `ATL`, `TSB`, `TRIMP`, `Ruhepuls`, `Schlaf`, `Drift`) immer physiologisch und praktisch interpretieren.
  - **Ausführliche Analyse vergangener Einheiten:** Letzte absolvierte Einheit in drei Unterpunkten analysieren: (1) Genauer Reiz & Soll/Ist-Abgleich, (2) Biologische & physiologische Folge, (3) Einordnung in den Trainingsblock.
  - **Color-Coding im Google Kalender (`colorId`):**
    - **Radfahren (Grün):** Geplant = `"2"` (hell) · Absolviert = `"10"` (dunkel)
    - **Schwimmen (Blau):** Geplant = `"7"` (hell) · Absolviert = `"9"` (dunkel)
    - **Laufen (Orange):** Geplant = `"5"` (hell) · Absolviert = `"6"` (dunkel)

---

## 7. Technik & Architektur
- **Python:** Python 3.12+ mit OpenSSL 3.x (auf macOS z. B. `/opt/homebrew/bin/python3`) – nur Standardbibliothek, keine externen Python-Pakete nötig.
- **Datenfluss:** `fetch.py` → `data/` → `auswertung.py` → `auswertung/*.json` → optional `sync_supabase.py` → Supabase → Web-App (`app/src/`).
- **Web-App:** React 19 + TypeScript + D3 + Vite (`bin/app.sh` → http://localhost:5173). Funktioniert mit Supabase oder direkt lokal aus `auswertung/*.json`.
