#!/usr/bin/env python3
"""Autarker Cloud-Trainings-Coach & Daily Briefing Runner.

Läuft komplett unabhängig vom lokalen Rechner in GitHub Actions (täglich per Cron
oder jederzeit vom Handy per GitHub Mobile App 'Run workflow' inkl. Freitext-Notiz)
sowie optional lokal.

Ablauf:
1. Liest das Repo-Brain (AGENTS.md, framework.md, athlet/profil.md,
   athlet/marker.md, athlet/ziele.md, plan/aktuell.md, plan/soll.json,
   entscheidungen.md) und die aktuellen Auswertungsdaten (kpis, tage,
   aktivitaeten, trends, kalender).
2. Holt die bestehenden Google-Kalender-Termine der nächsten 8 Tage SOWIE
   alle neuen E-Mail-Antworten auf bisherige Briefing-Mails
   (über GOOGLE_BRIDGE_URL in der Cloud oder gcalendar/gmail CLI lokal).
3. Ruft die Gemini API (GEMINI_API_KEY) auf, um:
   - E-Mail-Antworten (Format-Feedback, Rückfragen, Planänderungswünsche)
     direkt zu beantworten, im Plan/Kalender umzusetzen und dauerhaft in
     AGENTS.md / entscheidungen.md / journal/ zu verankern
   - Tagesform & letzte Einheit (Ist vor Soll) wissenschaftlich einzuordnen
   - Google-Calendar-Termine inkl. Color-Coding (Rad=2/10, Swim=7/9, Lauf=5/6)
     und individueller Sperrzeiten aus athlet/profil.md zu planen
   - Das tägliche Briefing im Newsletter-Stil (inkl. Interpretation aller Werte
     CTL/ATL/TSB/Ruhepuls/Schlaf & Deep-Dive Coach-Fazit) zu verfassen.
4. Aktualisiert Dateien, Google Kalender, markiert E-Mail-Antworten als verarbeitet
   (briefings/processed_replies.json) und versendet die Newsletter-E-Mail.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "auswertung"
ENV_FILE = ROOT / ".env"
PROCESSED_REPLIES_FILE = ROOT / "briefings" / "processed_replies.json"


def load_env() -> dict[str, str]:
    env = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            env.setdefault(k.strip(), v.strip().strip("'\""))
    return env


def http_json(url: str, payload: dict, headers: dict | None = None, timeout: int = 120) -> dict:
    hdrs = {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Mozilla/5.0 (compatible; TrainingCoach/1.0)",
    }
    if headers:
        hdrs.update(headers)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        body = ""
        try:
            body = err.read().decode("utf-8", errors="replace")[:400]
        except Exception:
            pass
        print(f"HTTP {err.code} Fehler bei Aufruf ({err.reason}): {body}", file=sys.stderr)
        raise


def load_processed_replies() -> tuple[set[str], list[dict]]:
    if not PROCESSED_REPLIES_FILE.exists():
        return set(), []
    try:
        data = json.loads(PROCESSED_REPLIES_FILE.read_text(encoding="utf-8"))
        ids = set(data.get("processed_ids", []))
        history = data.get("replies", [])
        for r in history:
            if r.get("message_id"):
                ids.add(str(r["message_id"]))
        return ids, history
    except Exception:
        return set(), []


def save_processed_replies(ids: set[str], history: list[dict]) -> None:
    PROCESSED_REPLIES_FILE.parent.mkdir(exist_ok=True)
    PROCESSED_REPLIES_FILE.write_text(
        json.dumps(
            {
                "processed_ids": sorted(ids),
                "updated_at": datetime.now().isoformat(),
                "replies": history,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def strip_quoted_email(text: str) -> str:
    lines = text.splitlines()
    out: list[str] = []
    for i, line in enumerate(lines):
        s = line.strip()
        if re.match(r"^Am .+ schrieb .+:$", s):
            break
        if re.match(r"^On .+ wrote:$", s):
            break
        if re.match(r"^-{3,}\s*Original Message\s*-{3,}", s, re.IGNORECASE):
            break
        if re.match(r"^Von:\s+", s, re.IGNORECASE) and i > 0:
            break
        if s.startswith(">"):
            continue
        out.append(line)
    return "\n".join(out).strip()


def fetch_context(env: dict[str, str], start_d: date, end_d: date) -> tuple[list[dict], list[dict]]:
    """Holt (calendar_events, unprocessed_email_replies)."""
    bridge_url = env.get("GOOGLE_BRIDGE_URL", "").strip()
    bridge_secret = env.get("GOOGLE_BRIDGE_SECRET", "").strip()
    tz_offset = env.get("COACH_TZ_OFFSET", "+01:00").strip() or "+01:00"
    start_iso = f"{start_d.isoformat()}T00:00:00{tz_offset}"
    end_iso = f"{end_d.isoformat()}T23:59:59{tz_offset}"
    processed, _ = load_processed_replies()

    if bridge_url and bridge_secret:
        res = http_json(
            bridge_url,
            {"secret": bridge_secret, "action": "fetch_context", "start": start_iso, "end": end_iso},
        )
        if not res.get("ok"):
            raise RuntimeError(f"Google Bridge Fehler (fetch_context): {res.get('error')}")
        events = res.get("events", [])
        raw_replies = res.get("email_replies", []) or []
        new_replies = [r for r in raw_replies if r.get("message_id") and r["message_id"] not in processed]
        return events, new_replies

    events: list[dict] = []
    if shutil.which("gcalendar"):
        proc = subprocess.run(
            ["gcalendar", "readonly", "events", "--start", start_iso, "--end", end_iso, "--max", "50", "--json"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            events = json.loads(proc.stdout)

    new_replies: list[dict] = []
    if shutil.which("gmail"):
        t_proc = subprocess.run(
            [
                "gmail",
                "readonly",
                "threads",
                'subject:("Daily Briefing" OR "Training Briefing") newer_than:10d',
                "--max",
                "15",
                "--json",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if t_proc.returncode == 0 and t_proc.stdout.strip():
            try:
                threads = json.loads(t_proc.stdout)
                for th in threads if isinstance(threads, list) else []:
                    tid = th.get("id") or th.get("threadId")
                    if not tid:
                        continue
                    gt = subprocess.run(
                        ["gmail", "readonly", "get-thread", str(tid), "--json"],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if gt.returncode == 0 and gt.stdout.strip():
                        t_obj = json.loads(gt.stdout)
                        msgs = t_obj.get("messages", []) if isinstance(t_obj, dict) else []
                        for m in msgs[1:]:
                            mid = str(m.get("id", ""))
                            if not mid or mid in processed:
                                continue
                            body = strip_quoted_email(str(m.get("body") or m.get("snippet") or ""))
                            if body:
                                new_replies.append(
                                    {
                                        "message_id": mid,
                                        "thread_id": str(tid),
                                        "from": str(m.get("from", "")),
                                        "date": str(m.get("date", "")),
                                        "subject": str(m.get("subject", "")),
                                        "text": body,
                                    }
                                )
            except Exception:
                pass

    return events, new_replies


def markdown_to_newsletter_html(md_text: str) -> str:
    """Wandelt das Markdown-Briefing in ein sauberes, mobilfreundliches Newsletter-HTML um."""
    lines = md_text.splitlines()
    body_parts: list[str] = []
    in_list = False

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            body_parts.append("</ul>")
            in_list = False

    def inline_fmt(text: str) -> str:
        t = html.escape(text)
        t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)
        t = re.sub(
            r"`([^`]+)`",
            r'<code style="background:#f1f5f9;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:0.92em;">\1</code>',
            t,
        )
        return t

    for raw in lines:
        line = raw.strip()
        if not line:
            close_list()
            continue
        if line == "---":
            close_list()
            body_parts.append('<hr style="border:0;border-top:1px solid #e2e8f0;margin:22px 0;">')
        elif line.startswith("# "):
            close_list()
            body_parts.append(
                f'<h1 style="font-size:22px;line-height:1.25;margin:0 0 8px;color:#0f172a;">{inline_fmt(line[2:])}</h1>'
            )
        elif line.startswith("## "):
            close_list()
            body_parts.append(
                f'<h2 style="font-size:17px;line-height:1.3;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #0f172a;color:#0f172a;">{inline_fmt(line[3:])}</h2>'
            )
        elif line.startswith("### "):
            close_list()
            body_parts.append(
                f'<h3 style="font-size:15px;line-height:1.35;margin:16px 0 8px;color:#1e293b;">{inline_fmt(line[4:])}</h3>'
            )
        elif line.startswith("> "):
            close_list()
            body_parts.append(
                f'<div style="background:#f8fafc;border-left:4px solid #0f172a;padding:12px 16px;margin:14px 0;border-radius:4px;color:#1e293b;">{inline_fmt(line[2:])}</div>'
            )
        elif line.startswith(("* ", "- ")) or re.match(r"^\d+\.\s+", line):
            if not in_list:
                body_parts.append('<ul style="margin:8px 0 14px;padding-left:20px;color:#1e293b;">')
                in_list = True
            item_text = re.sub(r"^(\*|-|\d+\.)\s+", "", line)
            body_parts.append(f'<li style="margin:6px 0;line-height:1.55;">{inline_fmt(item_text)}</li>')
        else:
            close_list()
            body_parts.append(f'<p style="margin:8px 0;line-height:1.6;color:#1e293b;">{inline_fmt(line)}</p>')

    close_list()
    inner = "\n".join(body_parts)
    return (
        '<div style="max-width:680px;margin:0 auto;padding:20px 18px;font-family:-apple-system,BlinkMacSystemFont,'
        "'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1e293b;background:#ffffff;\">"
        f"{inner}</div>"
    )


def build_prompt(
    heute: date,
    athlete_name: str,
    athlete_note: str,
    email_replies: list[dict],
    calendar_events: list[dict],
    tz_offset: str,
) -> str:
    def read_text(rel: str) -> str:
        p = ROOT / rel
        return p.read_text(encoding="utf-8") if p.exists() else ""

    def read_json_rows(name: str, tail: int | None = None) -> list:
        p = OUT / f"{name}.json"
        if not p.exists():
            return []
        data = json.loads(p.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else data.get("rows", [])
        return rows[-tail:] if tail else rows

    entscheidungen = "\n".join(read_text("entscheidungen.md").splitlines()[:60])
    journal_aktuell = "\n".join(read_text(f"journal/{heute.strftime('%Y-%m')}.md").splitlines()[:50])
    kpis = read_json_rows("kpis")
    tage = read_json_rows("tage", tail=14)
    aktivitaeten = read_json_rows("aktivitaeten", tail=14)
    drift = read_json_rows("drift", tail=10)
    effizienz = read_json_rows("effizienz", tail=10)
    rad_effizienz = read_json_rows("rad_effizienz", tail=10)
    trends = read_json_rows("trends")
    kalender_abgleich = read_json_rows("kalender")

    feedback_sections: list[str] = []
    if athlete_note:
        feedback_sections.append(f"DIREKTER HANDY-INPUT (WORKFLOW DISPATCH):\n>>> {athlete_note}")
    if email_replies:
        replies_formatted = json.dumps(email_replies, ensure_ascii=False, indent=2)
        feedback_sections.append(
            f"NEUE E-MAIL-ANTWORT(EN) VOM ATHLETEN:\n{replies_formatted}\n"
            "WICHTIG: Der Athlet hat direkt per E-Mail geantwortet! Du MUSST:\n"
            "1) Rückfragen oder Feedback ganz oben im neuen Briefing in einer eigenen Box (> **💬 Zu deiner E-Mail-Rückmeldung:** ...) direkt beantworten.\n"
            "2) Falls Planänderungen gewünscht sind, diese (nach kritischer Coaching-Prüfung) in plan/aktuell.md, plan/soll.json, entscheidungen.md und calendar_actions umsetzen.\n"
            "3) Falls Feedback zum Briefing-Format oder dauerhaften Regeln gegeben wurde, dieses als neue Regel in 'agents_md_rule_append' und 'entscheidung_entry' zurückgeben."
        )

    feedback_block = (
        "\n=== AKTUELLES FEEDBACK / RÜCKFRAGEN VOM ATHLETEN ===\n" + "\n\n".join(feedback_sections) + "\n"
        if feedback_sections
        else "\n=== AKTUELLES FEEDBACK / RÜCKFRAGEN VOM ATHLETEN ===\nKeine neuen E-Mail-Antworten oder Handy-Notizen heute.\n"
    )

    return f"""Du bist der persönliche Ausdauer-/Triathlon-Coach und Sparringspartner von {athlete_name} (kein Ja-Sager!).
Heute ist {heute.strftime('%A, %Y-%m-%d')}.
{feedback_block}
=== STRIKTE PROFI-COACHING-REGELN (ZU JEDER ZEIT EINHALTEN) ===
- **Anti-Sycophancy:** Widersprich offen und datenbasiert, wenn ein Wunsch/Vorschlag gegen Physiologie, Vorbelastung, 48-h-Kraft-Regel oder Framework verstößt. Gib niemals aus Höflichkeit recht.
- **Begründungspflicht:** Begründe jede Trainingsentscheidung und jede Einheit kurz und klar physiologisch.
- **Reps × Distanz + 5-Zonen-Modell:** Lauf-/Schwimm-Intervalle IMMER in `Reps × Distanz` (nie `Reps × Zeit`) plus exakte Ziel-Pulszone aus `athlet/marker.md` und `framework.md`.
- **Kein Kalender-Meta-Gerede im Briefing-Text:** Erwähne in `briefing_markdown` NIEMALS Kalender-Mechanik, Farben oder `colorId`s (z. B. kein „ich habe den Termin auf Dunkelgrün gestellt“) – die Kalender-Synchronisierung läuft stumm im Hintergrund.
- **Aktives Nachfragen:** Wenn dir für eine Top-Entscheidung Infos fehlen (z. B. Beine 1–5, Alltags-Stress 1–5, RPE 1–10 der letzten Einheit, Logistik), stell am Ende des Briefings 1–2 kurze, gezielte Coach-Fragen!

=== REGELWERK & BRAIN ===
--- AGENTS.md ---
{read_text("AGENTS.md")}

--- framework.md ---
{read_text("framework.md")}

--- athlet/profil.md ---
{read_text("athlet/profil.md")}

--- athlet/ziele.md ---
{read_text("athlet/ziele.md")}

--- athlet/marker.md ---
{read_text("athlet/marker.md")}

--- Neueste Entscheidungen (entscheidungen.md) ---
{entscheidungen}

--- Aktuelles Journal (journal/{heute.strftime('%Y-%m')}.md – Subjektives, RPE, Beine, Stress) ---
{journal_aktuell}

--- Subjektive Cockpit-Checks (athlet/feedback.json – Tagesform & Session-RPE) ---
{read_text("athlet/feedback.json")}

=== AKTUELLER PLAN ===
--- plan/aktuell.md ---
{read_text("plan/aktuell.md")}

--- plan/soll.json ---
{read_text("plan/soll.json")}

=== AKTUELLE DATEN & AUSWERTUNG ===
--- KPIs (auswertung/kpis.json) ---
{json.dumps(kpis, ensure_ascii=False, indent=2)}

--- Letzte 14 Tage (auswertung/tage.json) ---
{json.dumps(tage, ensure_ascii=False, indent=2)}

--- Letzte 14 Aktivitäten (auswertung/aktivitaeten.json) ---
{json.dumps(aktivitaeten, ensure_ascii=False, indent=2)}

--- LIT-Pulsdrift letzte 10 Einheiten ≥ 45 min (auswertung/drift.json) ---
{json.dumps(drift, ensure_ascii=False, indent=2)}

--- Lauf-Effizienz letzte 10 LIT-Läufe (auswertung/effizienz.json) ---
{json.dumps(effizienz, ensure_ascii=False, indent=2)}

--- Rad-Effizienz letzte 10 Rad-Fahrten (auswertung/rad_effizienz.json) ---
{json.dumps(rad_effizienz, ensure_ascii=False, indent=2)}

--- 14-Tage-Trends (auswertung/trends.json) ---
{json.dumps(trends, ensure_ascii=False, indent=2)}

--- Kalender-Abgleich Soll vs. Ist (auswertung/kalender.json) ---
{json.dumps(kalender_abgleich, ensure_ascii=False, indent=2)}

=== AKTUELLE GOOGLE KALENDER TERMINE (NÄCHSTE 8 TAGE) ===
{json.dumps(calendar_events, ensure_ascii=False, indent=2)}

=== DEINE AUFGABE ===
Erzeuge ein JSON-Objekt (ohne Markdown-Codeblock drumherum, reines JSON) mit exakt diesen Feldern:
1. "briefing_subject": String, z. B. "⚡ Daily Briefing {heute.strftime('%d.%m.%Y')} – 🟢 GRÜN | <Kurz-Fokus & Heutige Einheit>"
2. "briefing_markdown": String (Markdown im Newsletter-Style!). Muss zwingend enthalten:
   - Newsletter-Header mit Datum, Countdown zu den Zielen aus `athlet/ziele.md` und Executive Summary Box (> ...)
   - Falls der Athlet auf die letzte Mail geantwortet hat: Direkt darunter eine Box (> **💬 Zu deiner E-Mail-Rückmeldung:** ...) mit deiner Antwort und Bestätigung der Anpassungen!
   - Sektion 1: Biomarker & Belastungssteuerung (Ruhepuls, Schlaf, CTL, ATL, TSB). KEINE Werte unkommentiert auflisten! Jeder einzelne Wert muss physiologisch und praktisch für den heutigen Tag interpretiert werden.
   - Sektion 2: Ausführliches, wissenschaftlich fundiertes Coach-Fazit zur letzten absolvierten Einheit in drei Unterpunkten: (1) Genauer Reiz & Soll/Ist-Abgleich, (2) Biologische & physiologische Folge (HF-Kinetik, bei LIT-Läufen ≥ 45 min Pulsdrift `drift_pct`, bei Rad Efficiency Factor `NP/Puls`), (3) Einordnung in den aktuellen Trainingsblock. Kein Kalender-/Farben-Meta-Gerede!
   - Sektion 3: Heutige Einheit im Detail (Zeitfenster gemäß `athlet/profil.md`, Reiz, Ebene, `Reps × Distanz`, konkrete Ziel-Pulszone aus dem 5-Zonen-Modell, Pace/Watt, physiologische Begründung & Fokus).
   - Sektion 4: Regeneration & Schlaf-Empfehlung passend zur aktuellen Belastung und Tagesform.
   - Sektion 5: Wochen-Kalender-Übersicht (Sperrzeiten aus `athlet/profil.md` strikt einhalten).
   - Sektion 6 (falls Infos fehlen): **❓ Kurze Coach-Fragen an dich** (1–2 knappe, konkrete Fragen z. B. zu Beinen 1–5, Stress 1–5, RPE oder Logistik – einfach per Reply beantwortbar).
   - Fußzeile am Ende: "*💡 Antworte einfach direkt auf diese E-Mail mit deinen Antworten, Planänderungswünschen oder Rückfragen – beim nächsten Lauf werte ich alles automatisch aus.*"
3. "trainer_json": Objekt für briefings/trainer.json mit:
   - "stand": "{heute.isoformat()}"
   - "hinweis": "Aktuelle Einschätzung des AI-Trainers für die Trainer-Box im Cockpit. Kurz, mit Zahlen und Datum, nur aus gültigen Werten (athlet/marker.md). Bei jedem Abgleich neu schreiben."
   - "takeaways": Array aus 3 prägnanten Strings
   - "gut": Array aus 3-4 Strings
   - "schlecht": Array aus 3-4 Strings
   - "fokus": Array aus 3-4 Strings
4. "plan_changed": Boolean (true, wenn der Trainingsplan wegen ausgefallener/verschobener Einheit, E-Mail-Antwort oder Handy-Input angepasst werden musste, sonst false).
5. "plan_aktuell_md": String (nur wenn plan_changed=true: der vollständige neue Inhalt von plan/aktuell.md, sonst "").
6. "plan_soll_json": String (nur wenn plan_changed=true: der vollständige neue JSON-String für plan/soll.json, sonst "").
7. "entscheidung_entry": String (wenn plan_changed=true oder der Athlet per E-Mail eine neue Regel/Entscheidung vorgegeben hat: neuer Eintrag "## {heute.isoformat()}: <Was>\\n<Warum>" für entscheidungen.md, sonst "").
8. "agents_md_rule_append": String (nur wenn der Athlet per E-Mail dauerhaftes Format- oder Coaching-Feedback gegeben hat: 1-3 Bulletpoints "- **...:** ...", die dauerhaft in AGENTS.md unter Abschnitt 6 ergänzt werden sollen, sonst "").
9. "journal_entry": String (nur wenn der Athlet per E-Mail oder Handy-Notiz subjektives Befinden, Feedback oder Kontext geschickt hat: "- **{heute.isoformat()}:** <Zusammenfassung>" für journal/{heute.strftime('%Y-%m')}.md, sonst "").
10. "calendar_actions": Array von Kalender-Aktionen für Google Calendar, um geplante oder absolvierte Trainingseinheiten der aktuellen Woche synchron zu halten. WICHTIG: Liefere NUR Aktionen für Termine, die tatsächlich neu angelegt, zeitlich verschoben, auf absolviert (dunkle Farbe + Ist-Daten) umgestellt oder inhaltlich geändert werden müssen – bereits exakt zum Plan synchrone Termine unverändert lassen (ggf. leeres Array `[]`). Jedes Element hat:
   - "type": "create" oder "update"
   - "id": Event-ID aus der obigen Google-Kalender-Liste (bei "update" Pflicht, bei "create" "")
   - "summary": Titel mit passendem Sport-Emoji (🚴, 🏊, 🏃)
   - "start": RFC3339 Timestamp mit {tz_offset} (z. B. "{heute.isoformat()}T18:45:00{tz_offset}") – Sperrzeiten aus `athlet/profil.md` beachten!
   - "end": RFC3339 Timestamp mit {tz_offset}
   - "colorId": STRIKTES COLOR-CODING:
     * Radfahren: geplant = "2", absolviert = "10"
     * Schwimmen: geplant = "7", absolviert = "9"
     * Laufen: geplant = "5", absolviert = "6"
   - "description": Ausführliches Session-Briefing (🎯 TRAININGSREIZ & EBENE, ⏱️ VORGABEN (`Reps × Distanz` & 5-Zonen-Modell), 🔍 FOKUS, 📊 PHYSIOLOGISCHE BEGRÜNDUNG & ZIEL-KONTEXT).
"""


GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
]


def _extract_json_text(res: dict) -> str:
    parts = res["candidates"][0]["content"]["parts"]
    texts = [p["text"] for p in parts if isinstance(p, dict) and not p.get("thought") and p.get("text")]
    raw = (texts[-1] if texts else parts[0]["text"]).strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def call_gemini(api_key: str, prompt: str, models: list[str] | None = None) -> dict:
    chain = models or GEMINI_MODELS
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
        },
    }
    last_err: Exception | None = None
    for attempt in range(2):
        for model in chain:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            try:
                res = http_json(url, payload, timeout=180)
                parsed = json.loads(_extract_json_text(res))
                print(f"Gemini Modell erfolgreich: {model}")
                return parsed
            except urllib.error.HTTPError as err:
                last_err = err
                if err.code in (404, 429, 500, 503):
                    print(f"Warnung: {model} HTTP {err.code}, wechsle auf nächstes Modell...", file=sys.stderr)
                    continue
                raise
            except (KeyError, IndexError, json.JSONDecodeError) as err:
                last_err = err
                print(f"Warnung: {model} ungültige Antwort ({err}), wechsle auf nächstes Modell...", file=sys.stderr)
                continue
        if attempt == 0:
            print("Alle Modelle vorübergehend ausgelastet, warte 8 s für zweiten Versuch...", file=sys.stderr)
            time.sleep(8)
    raise RuntimeError(f"Kein Gemini-Modell erreichbar (letzter Fehler: {last_err})")


def apply_calendar_and_email(
    env: dict[str, str],
    result: dict,
    md_path: Path,
) -> None:
    bridge_url = env.get("GOOGLE_BRIDGE_URL", "").strip()
    bridge_secret = env.get("GOOGLE_BRIDGE_SECRET", "").strip()
    recipient_email = env.get("COACH_RECIPIENT_EMAIL", "").strip()
    actions = result.get("calendar_actions", []) or []
    subject = result.get("briefing_subject", f"⚡ Daily Briefing {date.today().strftime('%d.%m.%Y')}")
    md_text = result.get("briefing_markdown", "")
    html_body = markdown_to_newsletter_html(md_text)

    if bridge_url and bridge_secret:
        email_payload: dict = {
            "subject": subject,
            "text": md_text,
            "html": html_body,
        }
        if recipient_email:
            email_payload["to"] = recipient_email
        res = http_json(
            bridge_url,
            {
                "secret": bridge_secret,
                "action": "apply",
                "calendar_actions": actions,
                "email": email_payload,
            },
        )
        if not res.get("ok"):
            raise RuntimeError(f"Google Bridge Fehler (apply): {res.get('error')}")
        print(
            f"Google Bridge: {len(res.get('calendar_results', []))} Kalender-Aktionen, "
            f"E-Mail gesendet: {res.get('email_sent')}"
        )
        return

    # Lokaler Fallback über gcalendar & gmail CLI
    if shutil.which("gcalendar"):
        for act in actions:
            cmd = ["gcalendar", "mutate"]
            if act.get("type") == "update" and act.get("id"):
                cmd += ["update", str(act["id"])]
            else:
                cmd += ["create"]
            if act.get("summary"):
                cmd += ["--summary", act["summary"]]
            if act.get("start"):
                cmd += ["--start", act["start"]]
            if act.get("end"):
                cmd += ["--end", act["end"]]
            if act.get("colorId"):
                cmd += ["--color", str(act["colorId"])]
            if act.get("description") is not None:
                cmd += ["--description", act["description"]]
            subprocess.run(cmd, check=False)

    if shutil.which("gmail") and recipient_email:
        send_proc = subprocess.run(
            [
                "gmail",
                "mutate",
                "send",
                "--to",
                recipient_email,
                "--subject",
                subject,
                "--body-file",
                str(md_path),
                "--md",
            ],
            check=False,
        )
        if send_proc.returncode != 0:
            subprocess.run(
                [
                    "gmail",
                    "mutate",
                    "create-draft",
                    "--to",
                    recipient_email,
                    "--subject",
                    subject,
                    "--body-file",
                    str(md_path),
                    "--md",
                ],
                check=False,
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Cloud Training Coach & Daily Briefing")
    parser.add_argument("--note", default="", help="Optionale Nachricht/Anpassung vom Athleten")
    args = parser.parse_args()

    env = load_env()
    gemini_key = env.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        print("Fehler: GEMINI_API_KEY fehlt in .env bzw. Environment Secrets.", file=sys.stderr)
        return 1

    athlete_name = env.get("ATHLETE_NAME", "").strip() or "Athlet"
    tz_offset = env.get("COACH_TZ_OFFSET", "+01:00").strip() or "+01:00"
    custom_model = env.get("GEMINI_MODEL", "").strip()
    models = [custom_model] + [m for m in GEMINI_MODELS if m != custom_model] if custom_model else GEMINI_MODELS

    athlete_note = (args.note or env.get("ATHLETE_NOTE", "")).strip()
    heute = date.today()
    cal_events, email_replies = fetch_context(env, heute, heute + timedelta(days=8))
    print(f"Kontext geladen: {len(cal_events)} Kalender-Termine, {len(email_replies)} neue E-Mail-Antwort(en).")

    prompt = build_prompt(heute, athlete_name, athlete_note, email_replies, cal_events, tz_offset)
    print("Rufe Gemini AI Coach auf...")
    result = call_gemini(gemini_key, prompt, models=models)

    # 1. Briefing speichern (morgens vs. abends getrennt loggen)
    briefings_dir = ROOT / "briefings"
    briefings_dir.mkdir(exist_ok=True)
    slot = "morgen" if datetime.now().hour < 14 else "abend"
    md_path = briefings_dir / f"{heute.isoformat()}-{slot}.md"
    md_path.write_text(result["briefing_markdown"], encoding="utf-8")
    print(f"Briefing gespeichert: {md_path}")

    # 2. trainer.json aktualisieren
    if result.get("trainer_json"):
        (briefings_dir / "trainer.json").write_text(
            json.dumps(result["trainer_json"], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print("briefings/trainer.json aktualisiert.")

    # 3. Plan-Änderungen speichern (falls plan_changed)
    if result.get("plan_changed"):
        if result.get("plan_aktuell_md"):
            (ROOT / "plan" / "aktuell.md").write_text(result["plan_aktuell_md"], encoding="utf-8")
        if result.get("plan_soll_json"):
            parsed_soll = json.loads(result["plan_soll_json"])
            (ROOT / "plan" / "soll.json").write_text(
                json.dumps(parsed_soll, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        print("Trainingsplan (aktuell.md + soll.json) wurde angepasst.")

    # 4. Entscheidungen / Brain-Lernen aus E-Mail-Antworten speichern
    if result.get("entscheidung_entry"):
        ent_file = ROOT / "entscheidungen.md"
        old_ent = ent_file.read_text(encoding="utf-8") if ent_file.exists() else ""
        marker = "Format: `## JJJJ-MM-TT: <was>`, darunter 1-3 Zeilen Warum.\n"
        if marker in old_ent:
            new_ent = old_ent.replace(marker, marker + "\n" + result["entscheidung_entry"].strip() + "\n", 1)
        else:
            new_ent = result["entscheidung_entry"].strip() + "\n\n" + old_ent
        ent_file.write_text(new_ent, encoding="utf-8")
        print("Neuer Eintrag in entscheidungen.md gespeichert.")

    if result.get("agents_md_rule_append"):
        agents_file = ROOT / "AGENTS.md"
        if agents_file.exists():
            old_agents = agents_file.read_text(encoding="utf-8")
            target_header = "## 7. Technik & Architektur"
            rule_text = result["agents_md_rule_append"].strip()
            if target_header in old_agents and rule_text not in old_agents:
                new_agents = old_agents.replace(target_header, f"{rule_text}\n\n---\n\n{target_header}", 1)
                agents_file.write_text(new_agents, encoding="utf-8")
                print("Neue Regel aus E-Mail-Feedback dauerhaft in AGENTS.md verankert.")

    if result.get("journal_entry"):
        journal_dir = ROOT / "journal"
        journal_dir.mkdir(exist_ok=True)
        j_file = journal_dir / f"{heute.strftime('%Y-%m')}.md"
        entry = result["journal_entry"].strip()
        if j_file.exists():
            j_file.write_text(j_file.read_text(encoding="utf-8").rstrip() + "\n" + entry + "\n", encoding="utf-8")
        else:
            j_file.write_text(f"# Journal {heute.strftime('%Y-%m')}\n\n{entry}\n", encoding="utf-8")
        print(f"Journal-Eintrag gespeichert in {j_file}.")

    # 5. Kalender & E-Mail anwenden
    apply_calendar_and_email(env, result, md_path)

    # 6. Verarbeitete E-Mail-Antworten deterministisch mit vollem Wortlaut loggen (JSON + Journal)
    if email_replies:
        processed, history = load_processed_replies()
        journal_dir = ROOT / "journal"
        journal_dir.mkdir(exist_ok=True)
        j_file = journal_dir / f"{heute.strftime('%Y-%m')}.md"
        if not j_file.exists():
            j_file.write_text(f"# Journal {heute.strftime('%Y-%m')}\n\n", encoding="utf-8")

        journal_lines: list[str] = []
        now_iso = datetime.now().isoformat(timespec="seconds")
        for r in email_replies:
            mid = str(r.get("message_id", ""))
            if mid and mid not in processed:
                processed.add(mid)
                history.append(
                    {
                        "message_id": mid,
                        "thread_id": r.get("thread_id", ""),
                        "date": r.get("date", ""),
                        "subject": r.get("subject", ""),
                        "text": r.get("text", ""),
                        "processed_at": now_iso,
                        "briefing_file": f"briefings/{md_path.name}",
                    }
                )
                clean_txt = str(r.get("text", "")).replace("\n", " ").strip()
                journal_lines.append(
                    f"- **{heute.isoformat()} (E-Mail-Antwort auf `{r.get('subject', 'Briefing')}`):** „{clean_txt}“"
                )

        save_processed_replies(processed, history)
        if journal_lines:
            j_file.write_text(
                j_file.read_text(encoding="utf-8").rstrip() + "\n" + "\n".join(journal_lines) + "\n",
                encoding="utf-8",
            )
        print(
            f"{len(email_replies)} E-Mail-Antwort(en) vollständig in briefings/processed_replies.json und {j_file.name} geloggt."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
