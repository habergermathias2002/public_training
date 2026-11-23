# Training Brain — AI-gestütztes Ausdauer- & Triathlon-Coaching-System

Ein modulares, datenbasiertes Trainings- und Coaching-System für Ausdauersportler (Laufen, Radfahren, Schwimmen, Kraft).  
Das Repository fungiert als **persistentes, lernendes „Brain“**: Es zieht deine echten Garmin-Connect-Sensordaten (inkl. `.FIT`-Dateien), berechnet Trainingslast, Pulsdrift und Effizienz vollständig selbst, synchronisiert einen KI-Coach (Gemini) mit **Google Calendar & Gmail** (inkl. bidirektionalem E-Mail-Feedback-Loop) und visualisiert alles in einer **React 19 + TypeScript + D3 Web-App**.

> **Hinweis zum Template-Status:** Dieses Repository ist ein **leeres, anonymisiertes Starter-Template** ohne personenbezogene Daten. Wenn du es später mit deinen eigenen Garmin-Daten und GitHub Actions betreibst, nutze dafür unbedingt ein **privates GitHub-Repository**, da Garmin-Aktivitäten und `.FIT`-Dateien GPS-Koordinaten enthalten können.

---

## Inhaltsverzeichnis

1. [Was dieses Repository macht](#1-was-dieses-repository-macht)
2. [Architektur & Datenfluss](#2-architektur--datenfluss)
3. [Voraussetzungen](#3-voraussetzungen)
4. [Übersicht aller benötigten Keys, Secrets & Dateien](#4-übersicht-aller-benötigten-keys-secrets--dateien)
5. [Schritt-für-Schritt-Einrichtung](#5-schritt-für-schritt-einrichtung)
   - [Schritt 1: Repository & persönliches Profil anlegen](#schritt-1-repository--persönliches-profil-anlegen)
   - [Schritt 2: Garmin Personal API einrichten](#schritt-2-garmin-personal-api-einrichten)
   - [Schritt 3: Lokale `.env` konfigurieren](#schritt-3-lokale-env-konfigurieren)
   - [Schritt 4: Supabase (Datenbank für die Web-App) einrichten](#schritt-4-supabase-datenbank-für-die-web-app-einrichten)
   - [Schritt 5: Gemini API Key erstellen](#schritt-5-gemini-api-key-erstellen)
   - [Schritt 6: Google Apps Script Bridge (Calendar & Gmail)](#schritt-6-google-apps-script-bridge-calendar--gmail)
   - [Schritt 7: Vollautomatischer Cloud-Betrieb via GitHub Actions](#schritt-7-vollautomatischer-cloud-betrieb-via-github-actions)
   - [Schritt 8: Lokale Web-App starten](#schritt-8-lokale-web-app-starten)
6. [Nutzung im Alltag](#6-nutzung-im-alltag)
7. [Verzeichnisstruktur](#7-verzeichnisstruktur)
8. [Sicherheit & Datenschutz](#8-sicherheit--datenschutz)

---

## 1. Was dieses Repository macht

- **Garmin-Daten-Pipeline (`bin/fetch.py` + `bin/token.sh`):**
  Ruft über die offizielle **Garmin Personal API** Tageswerte (`daily_summaries`, `sleep`, `stress`, `steps`, `body_battery`, `weight`, `vo2max`, `heart_rate`, `spo2`, `hrv`) sowie Aktivitäten inkl. Original-`.FIT`-Dateien ab – automatisch rate-limit-konform.
- **Eigene Sportwissenschafts-Auswertung (`bin/auswertung.py`):**
  Reine Python-Standardbibliothek (keine externen Pakete nötig). Parst `.FIT`-Dateien direkt binär, berechnet individuelle 5-Zonen-Verteilungen (LT1/LT2-verankert), TRIMP/TSS, `CTL`/`ATL`/`TSB`, LIT-Pulsdrift (`drift_pct`), Lauf- & Rad-Effizienz (`NP / Ø Puls`), 14-Tage-Trends und einen Soll/Ist-Kalenderabgleich.
- **Autarker AI Cloud Coach (`bin/cloud_coach.py` + `.github/workflows/daily-coach.yml`):**
  Läuft täglich per GitHub Actions (oder manuell per Knopfdruck vom Handy mit optionaler Freitext-Notiz):
  - Bewertet Tagesform & letzte Einheit nach dem Prinzip **„Ist vor Soll“**.
  - Schreibt ein tägliches Briefing im Newsletter-Stil per E-Mail (HTML + Markdown-Archiv in `briefings/`).
  - Plant und aktualisiert Trainingseinheiten im **Google Kalender** inkl. strikter Arbeits-Sperrzeiten und **Color-Coding** (hell = geplant, dunkel = absolviert).
  - **Bidirektionaler E-Mail-Loop:** Antwortest du auf eine Briefing-Mail (z. B. „Morgen keine Zeit zum Laufen, schieb es auf Donnerstag“ oder „Beine 4/5, Stress 3/5“), liest der Coach deine Antwort beim nächsten Lauf automatisch aus, passt Plan & Kalender an und dokumentiert neue Regeln dauerhaft in `AGENTS.md`, `entscheidungen.md` und `journal/`.
- **Performance Cockpit Web-App (`app/`):**
  Lokale High-Density Web-App (React 19, TypeScript, D3, Vite) mit 5 Ansichten (`Cockpit`, `Plan & Kalender`, `Form & Fortschritt`, `Aktivitäten`, `Events`), Detail-Drawer pro Einheit und integriertem Feedback-Rückkanal (`/api/feedback` für Tagesform & Session-RPE).
- **Supabase-Sync (`bin/sync_supabase.py`):**
  Optionaler Sync aller Auswertungen in eine PostgreSQL-Datenbank (Supabase). Ohne Supabase-Konfiguration fällt die Web-App automatisch auf die lokalen JSON-Dateien in `auswertung/` zurück.

---

## 2. Architektur & Datenfluss

```text
Garmin Connect (Personal API)
        │
        ▼  bin/fetch.py (--days 3 --fit)
     data/ (JSON + .FIT)
        │
        ▼  bin/auswertung.py (inkl. athlet/marker.md, plan/soll.json, athlet/feedback.json)
   auswertung/*.json & *.csv
        │
        ├──────────────────────────────┐
        ▼  bin/cloud_coach.py          ▼  bin/sync_supabase.py (optional)
  Gemini API + Google Bridge       Supabase (PostgreSQL)
  (Calendar Sync & Gmail Loop)         │
        │                              ▼
        ▼                        app/ (React 19 + D3 Cockpit)
  briefings/, plan/, journal/,   <── liest aus Supabase oder direkt aus auswertung/
  entscheidungen.md, AGENTS.md
```

---

## 3. Voraussetzungen

- **Python 3.12+** mit **OpenSSL 3.x** (wichtig für den TLS-Handshake mit der Garmin Personal API).
  - *macOS-Hinweis:* Das vorinstallierte Apple-System-Python nutzt LibreSSL und scheitert am Garmin-TLS-Handshake. Installiere Python über Homebrew (`brew install python`) und nutze `/opt/homebrew/bin/python3`.
  - Es werden **keine externen Python-Pakete** (`pip install`) benötigt – alle Python-Skripte nutzen ausschließlich die Standardbibliothek.
- **Node.js 18+ & npm** (nur für die Web-App in `app/`).
- **Accounts (je nach gewünschtem Funktionsumfang):**
  - **Garmin Connect** (Pflicht für echte Sensordaten)
  - **Google AI Studio / Gemini API** (Pflicht für den AI Cloud Coach)
  - **Google-Konto** mit Google Apps Script (Pflicht für Cloud-Sync mit Google Calendar & Gmail)
  - **Supabase** (optional, kostenloser Free-Tier reicht völlig)
  - **GitHub** (optional, für automatische tägliche Ausführung per GitHub Actions)

---

## 4. Übersicht aller benötigten Keys, Secrets & Dateien

| Key / Datei | Pflicht? | Woher bekommst du den Wert? | Wo wird er eingetragen? |
|---|---|---|---|
| `api_key.txt` bzw. `GARMIN_API_KEY` | Ja (für Garmin) | [Garmin Personal API Settings](https://connect.garmin.com/app/settings/personalApiToken) → *Create Key* | Lokal: Datei `api_key.txt` (`chmod 600`) oder macOS-Schlüsselbund · Cloud: GitHub Secret `GARMIN_API_KEY` |
| `GEMINI_API_KEY` | Ja (für AI Coach) | [Google AI Studio](https://aistudio.google.com/apikey) → *Create API Key* | Lokal: `.env` · Cloud: GitHub Secret `GEMINI_API_KEY` |
| `GEMINI_MODEL` | Optional | z. B. `gemini-2.5-flash` (Fallback-Kette ist bereits eingebaut) | Lokal: `.env` · Cloud: GitHub Secret `GEMINI_MODEL` |
| `GOOGLE_BRIDGE_URL` | Ja (für Cloud Calendar/Mail) | Aus dem Web-App-Deployment von `cloud/google_bridge.gs` in Google Apps Script | Lokal: `.env` · Cloud: GitHub Secret `GOOGLE_BRIDGE_URL` |
| `GOOGLE_BRIDGE_SECRET` | Ja (für Cloud Calendar/Mail) | Selbst generiertes langes Zufallspasswort (z. B. `openssl rand -hex 32`) | Google Apps Script Properties **und** `.env` **und** GitHub Secret `GOOGLE_BRIDGE_SECRET` |
| `COACH_RECIPIENT_EMAIL` | Ja (für Briefing-Mails) | Deine eigene E-Mail-Adresse (z. B. `name@gmail.com`) | Google Apps Script Properties **und** `.env` **und** GitHub Secret `COACH_RECIPIENT_EMAIL` |
| `ATHLETE_NAME` | Optional | Dein Vorname / Rufname für den Coach-Prompt (Standard: `Athlet`) | Lokal: `.env` · Cloud: GitHub Secret `ATHLETE_NAME` |
| `COACH_TZ_OFFSET` | Optional | Zeitzonen-Offset für Kalender-Timestamps (Standard: `+01:00`, Sommerzeit `+02:00`) | Lokal: `.env` · Workflow `.github/workflows/daily-coach.yml` |
| `SUPABASE_URL` | Optional (Web-App DB) | Supabase Dashboard → *Project Settings* → *API* → *Project URL* | Lokal: `.env` · Cloud: GitHub Secret `SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | Optional (Web-App DB) | Supabase Dashboard → *Project Settings* → *API* → *anon public* | Lokal: `.env` · Cloud: GitHub Secret `SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (Web-App DB) | Supabase Dashboard → *Project Settings* → *API* → *service_role secret* | Lokal: `.env` · Cloud: GitHub Secret `SUPABASE_SERVICE_ROLE_KEY` |

---

## 5. Schritt-für-Schritt-Einrichtung

### Schritt 1: Repository & persönliches Profil anlegen

1. Klone dieses Template-Repo (oder erstelle ein neues **privates** Repo daraus):
   ```bash
   git clone <deine-repo-url> training
   cd training
   ```
2. Fülle die Starter-Templates im `athlet/`-Ordner mit deinen eigenen Angaben aus:
   - `athlet/profil.md`: Trainingszeiten, Arbeits-Sperrzeiten, Equipment.
   - `athlet/marker.md`: Aktuelle Pulsschwellen (`LT1`, `LTHR`, `HFmax`), FTP, Bestzeiten.
   - `athlet/ziele.md`: Dein Hauptziel (Prio A) und aktuelles Nahziel (Prio B).
   - `athlet/events.json`: Optional vergangene/geplante Wettkämpfe (JSON-Array).
   - `plan/aktuell.md` & `plan/soll.json`: Optional deinen Start-Wochenplan (oder lass ihn im ersten Chat mit einem KI-Agenten auf Basis von `AGENTS.md` generieren).
3. **Wichtig – individuelle Zonen in `bin/auswertung.py` anpassen:**
   Öffne `bin/auswertung.py` und passe ganz oben (ca. Zeile 30–37) die Schwellenwerte an deine eigenen Marker aus `athlet/marker.md` an:
   ```python
   LTHR_LAUF = 175
   LTHR_RAD = 170
   HFMAX = 190
   RUHEPULS_STD = 50
   FTP = 220
   ```

---

### Schritt 2: Garmin Personal API einrichten

1. Öffne [https://connect.garmin.com/app/settings/personalApiToken](https://connect.garmin.com/app/settings/personalApiToken) und klicke auf **Create Key** (Laufzeit z. B. 365 Tage; der Key wird nur einmal angezeigt).
2. Speichere den Key lokal in `api_key.txt` (nur der Key, keine Leerzeilen) und sichere die Dateirechte:
   ```bash
   printf '%s\n' 'DEIN_GARMIN_API_KEY' > api_key.txt
   chmod 600 api_key.txt
   ```
   *(Alternative auf macOS: im Schlüsselbund ablegen via `security add-generic-password -a "$USER" -s garmin-personal-api -w`.)*
3. Teste den Datenabruf und die erste Auswertung:
   ```bash
   ./bin/fetch.py --days 14 --fit
   ./bin/auswertung.py
   ```
   - `bin/fetch.py` holt sich über `bin/token.sh` automatisch ein 24-h-Access-Token (`.token`, `chmod 600`) und respektiert Garmins Rate-Limits (max. 100 Requests/Fenster).
   - Für einen einmaligen historischen Komplettabruf kannst du z. B. `./bin/fetch.py --start 2025-01-01 --fit` nutzen.

---

### Schritt 3: Lokale `.env` konfigurieren

Kopiere die Vorlage und trage deine Keys ein:

```bash
cp .env.example .env
chmod 600 .env
```

Öffne `.env` und fülle mindestens die Variablen für die Module aus, die du nutzen möchtest (siehe Tabelle in [Abschnitt 4](#4-übersicht-aller-benötigten-keys-secrets--dateien)).

---

### Schritt 4: Supabase (Datenbank für die Web-App) einrichten *(optional)*

Die Web-App funktioniert auch **ohne** Supabase (sie liest dann direkt aus `auswertung/*.json`). Wenn du eine zentrale Datenbank willst:

1. Erstelle ein kostenloses Projekt auf [https://supabase.com](https://supabase.com).
2. Öffne im Supabase Dashboard den **SQL Editor**, kopiere den kompletten Inhalt von `supabase/schema.sql` hinein und führe ihn aus (**Run**).
3. Gehe zu **Project Settings → API** und kopiere folgende 3 Werte in deine `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Teste den Sync:
   ```bash
   ./bin/sync_supabase.py
   ```

---

### Schritt 5: Gemini API Key erstellen

1. Öffne [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) und erstelle einen neuen API Key.
2. Trage ihn als `GEMINI_API_KEY` in deiner `.env` ein.

---

### Schritt 6: Google Apps Script Bridge (Calendar & Gmail)

Damit der AI Cloud Coach dauerhaft und ohne ablaufende OAuth-Refresh-Tokens aus GitHub Actions auf deinen Google Kalender und Gmail zugreifen kann, läuft eine kleine, durch ein eigenes Secret geschützte Bridge in deinem Google-Account (`cloud/google_bridge.gs`):

1. Generiere zuerst ein starkes Zufalls-Secret im Terminal:
   ```bash
   openssl rand -hex 32
   ```
2. Öffne [https://script.google.com](https://script.google.com) (mit deinem Google-Konto) und klicke auf **Neues Projekt**.
3. Ersetze den gesamten Inhalt von `Code.gs` durch den Code aus `cloud/google_bridge.gs` und speichere (`Cmd+S` / `Strg+S`).
4. Klicke links auf das Zahnrad (**Projekteinstellungen**) → ganz unten **Skripteigenschaften** → **Skripteigenschaft hinzufügen**:
   - Eigenschaft 1: `GOOGLE_BRIDGE_SECRET` = `<dein generiertes Secret aus Schritt 1>`
   - Eigenschaft 2: `COACH_RECIPIENT_EMAIL` = `<deine E-Mail-Adresse>`
5. Klicke oben rechts auf **Bereitstellen → Neue Bereitstellung**:
   - Typ: **Web-App**
   - Ausführen als: **Ich**
   - Zugriff haben: **Jeder** *(erforderlich für GitHub Actions; jeder Request wird per `GOOGLE_BRIDGE_SECRET` authentifiziert)*
   - Klicke auf **Bereitstellen** und erteile die Google-Berechtigungen für Kalender & Gmail.
6. Kopiere die angezeigte **Web-App-URL** (`https://script.google.com/macros/s/.../exec`) und trage `GOOGLE_BRIDGE_URL` sowie `GOOGLE_BRIDGE_SECRET` in deine `.env` ein.
7. Teste den AI Coach lokal:
   ```bash
   ./bin/cloud_coach.py
   ```

> **Tipp für Updates an `google_bridge.gs`:** Wenn du später Code änderst, gehe auf *Bereitstellen → Bereitstellungen verwalten → Stift-Icon → Version: Neue Version → Bereitstellen*. So bleibt die `GOOGLE_BRIDGE_URL` identisch.

---

### Schritt 7: Vollautomatischer Cloud-Betrieb via GitHub Actions

Der Workflow `.github/workflows/daily-coach.yml` läuft standardmäßig täglich um **06:00 Uhr** und **20:00 Uhr MEZ** (Cron: `0 5,19 * * *`) und lässt sich zusätzlich jederzeit manuell starten (z. B. über die GitHub Mobile App inkl. Freitext-Notiz).

1. Öffne dein GitHub-Repository → **Settings → Secrets and variables → Actions → New repository secret**.
2. Lege folgende **Repository Secrets** an:
   - `GARMIN_API_KEY`
   - `GEMINI_API_KEY`
   - `GOOGLE_BRIDGE_URL`
   - `GOOGLE_BRIDGE_SECRET`
   - `COACH_RECIPIENT_EMAIL`
   - `ATHLETE_NAME` *(optional)*
   - `GEMINI_MODEL` *(optional)*
   - `SUPABASE_URL` *(optional, falls Supabase aktiv)*
   - `SUPABASE_ANON_KEY` *(optional)*
   - `SUPABASE_SERVICE_ROLE_KEY` *(optional)*
3. Prüfe unter **Settings → Actions → General → Workflow permissions**, dass **Read and write permissions** aktiviert sind (damit der Workflow neue Daten, Briefings und Plan-Updates zurück ins Repo committen darf).
4. Starte unter **Actions → Daily Training Coach & Briefing → Run workflow** einen ersten Testlauf.

---

### Schritt 8: Lokale Web-App starten

Installiere einmalig die Frontend-Abhängigkeiten und starte den Dev-Server:

```bash
cd app
npm install
cd ..
./bin/app.sh
```

Öffne danach [http://localhost:5173](http://localhost:5173) im Browser.  
Unten in der Seitenleiste zeigt die App an, ob die Daten aus Supabase oder direkt aus dem lokalen Ordner `auswertung/` geladen wurden.

---

## 6. Nutzung im Alltag

- **Manueller Daten-Sync lokal:**
  ```bash
  ./bin/fetch.py --days 3 --fit
  ./bin/auswertung.py
  ./bin/sync_supabase.py   # optional
  ```
- **Einzelnen Cloud-Coach-Lauf lokal anstoßen (optional mit Hinweis):**
  ```bash
  ./bin/cloud_coach.py --note "Heute müde Beine, bitte locker statt Intervalle"
  ```
- **Direkt auf Briefing-Mails antworten:**
  Antworte einfach in Gmail auf ein erhaltenes *Daily Briefing*. Beim nächsten Durchlauf erkennt `bin/cloud_coach.py` deine Antwort automatisch, setzt gewünschte Planänderungen um, verankert dauerhafte Regeln in `AGENTS.md` / `entscheidungen.md` und loggt die Antwort in `journal/` und `briefings/processed_replies.json`.
- **Subjektives Feedback in der Web-App:**
  Über das Cockpit kannst du Tagesform (Beine/Stress/Schlaf 1–5) und Session-RPE (1–10) erfassen. Der lokale Vite-Server schreibt über `/api/feedback` direkt in `athlet/feedback.json` und `journal/JJJJ-MM.md` und aktualisiert die Auswertung im Hintergrund.
- **Interaktives Coaching mit KI-Coding-Agenten:**
  Öffne das Repo in deinem bevorzugten Agenten (Antigravity, Claude Code, Cursor, VS Code etc.). Der Agent liest automatisch `AGENTS.md` / `CLAUDE.md` und arbeitet direkt auf deinem Trainings-Brain.

---

## 7. Verzeichnisstruktur

```text
.
├── AGENTS.md                   # Einheitliches Regelwerk für KI-Agenten & Cloud Coach
├── CLAUDE.md                   # Einstiegspunkt für Claude Code (verweist auf AGENTS.md)
├── framework.md                # Sportwissenschaftliche Methodik & 5-Zonen-Modell
├── entscheidungen.md           # Chronologisches Log aller Plan- & Methoden-Entscheidungen
├── .env.example                # Vorlage für Umgebungsvariablen (nach .env kopieren)
├── .github/workflows/
│   └── daily-coach.yml         # Automatischer GitHub-Actions-Workflow (2× täglich + manuell)
├── athlet/                     # Persönliches Profil, Marker, Ziele, Events, Feedback
├── plan/                       # Aktueller Wochenplan (aktuell.md + soll.json) & Roadmap
├── briefings/                  # Archivierte Briefings, trainer.json, processed_replies.json
├── journal/                    # Monatliches subjektives Trainingsjournal (JJJJ-MM.md)
├── wissen/                     # Eigene sportwissenschaftliche Notizen & Evidenz
├── data/                       # Garmin-Rohdaten (wird durch bin/fetch.py gefüllt)
├── auswertung/                 # Berechnete JSON/CSV-Tabellen (durch bin/auswertung.py)
├── bin/
│   ├── fetch.py                # Garmin Personal API Downloader
│   ├── token.sh                # Garmin Token-Exchange
│   ├── auswertung.py           # FIT-Parser, Last-, Drift-, Effizienz- & Kalender-Engine
│   ├── cloud_coach.py          # Gemini AI Coach + Google Calendar & Gmail Sync
│   ├── sync_supabase.py        # Upload nach Supabase
│   ├── laps.py                 # Runden-Inspektor für FIT-Dateien
│   ├── karte.py                # Karten-Helfer
│   └── app.sh                  # Startet die lokale React-Web-App
├── cloud/
│   └── google_bridge.gs        # Google Apps Script Bridge (Calendar & Gmail)
├── supabase/
│   └── schema.sql              # PostgreSQL-Tabellen für Supabase
└── app/                        # React 19 + TypeScript + D3 + Vite Performance Cockpit
```

---

## 8. Sicherheit & Datenschutz

- **Niemals Secrets committen:** `.env`, `api_key.txt` und `.token` stehen in `.gitignore`. Prüfe vor jedem `git push`, dass keine Zugangsdaten getrackt sind.
- **Privates Repo für echte Daten:** Sobald `bin/fetch.py` echte Garmin-Daten in `data/` lädt und GitHub Actions diese committet, sollte dein Repository zwingend auf **Private** stehen (FIT-Dateien enthalten GPS-Tracks inkl. Start-/Endpunkt).
- **Garmin API Key erneuern:** Je nach gewählter Laufzeit (30–365 Tage) muss der Key in `api_key.txt` bzw. im GitHub Secret `GARMIN_API_KEY` vor Ablauf ersetzt werden.
