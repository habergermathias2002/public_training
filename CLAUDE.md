# CLAUDE.md

Dieses Repository verwendet [AGENTS.md](./AGENTS.md) als einheitlichen, modell- und plattformunabhängigen Standard.

**Bitte lies zuerst [AGENTS.md](./AGENTS.md)** – alle dort definierten Regeln, Workflows, Trainingsprinzipien und Git-Vorgaben sind verbindlich.

### Kurzüberblick:
- **Repo als Brain:** Jede Entscheidung, Korrektur und jedes Feedback sofort persistent in `entscheidungen.md`, `journal/` oder `athlet/marker.md` festhalten.
- **Git:** Im lokalen Chat-Betrieb nur committen und pushen, wenn ausdrücklich gewünscht.
- **Session-Start:** `./bin/fetch.py --days 3 --fit`, danach `./bin/auswertung.py`. Pflichtdateien lesen (`framework.md`, `athlet/profil.md`, `athlet/marker.md`, `plan/aktuell.md`, `entscheidungen.md`).
- **Aktualitätsregel:** Keine Schätzungen – nur gültige Marker aus `athlet/marker.md` (Paces/Watt 6 Wochen, Puls 6 Monate).
