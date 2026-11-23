/**
 * Google Apps Script Bridge für den Cloud Training Coach (GitHub Actions -> Google Calendar & Gmail)
 *
 * EINRICHTUNG:
 * 1. Öffne https://script.google.com (mit deinem Google-Konto) -> "Neues Projekt".
 * 2. Ersetze den Code in Code.gs komplett durch diese Datei und speichere (Cmd+S / Strg+S).
 * 3. Gehe links auf "Projekteinstellungen" -> "Skripteigenschaften" und lege zwei Eigenschaften an:
 *    - GOOGLE_BRIDGE_SECRET : ein langes zufälliges Passwort (identisch zum GitHub Secret / .env)
 *    - COACH_RECIPIENT_EMAIL: deine E-Mail-Adresse (optional; falls leer, wird deine Google-Account-Adresse genutzt)
 * 4. Klicke oben rechts auf "Bereitstellen" -> "Neue Bereitstellung" -> Typ: "Web-App":
 *    - Ausführen als: "Ich"
 *    - Zugriff haben: "Jeder" (abgesichert über GOOGLE_BRIDGE_SECRET im POST-Body)
 *    -> "Bereitstellen" und die generierte Web-App-URL als GOOGLE_BRIDGE_URL in .env & GitHub Secrets eintragen.
 */

const PROPS = PropertiesService.getScriptProperties();
const BRIDGE_SECRET = PROPS.getProperty('GOOGLE_BRIDGE_SECRET') || '';
const TARGET_EMAIL = PROPS.getProperty('COACH_RECIPIENT_EMAIL') || Session.getEffectiveUser().getEmail();

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (!BRIDGE_SECRET || payload.secret !== BRIDGE_SECRET) {
      return jsonResponse({ ok: false, error: 'Unauthorized: Invalid GOOGLE_BRIDGE_SECRET' });
    }

    const cal = CalendarApp.getDefaultCalendar();
    const action = payload.action;

    // 1. Kalender-Termine UND Antworten auf bisherige Briefing-Mails abrufen
    if (action === 'list_events' || action === 'fetch_context') {
      const start = new Date(payload.start);
      const end = new Date(payload.end);
      const events = cal.getEvents(start, end).map(ev => ({
        id: ev.getId().replace(/@google\.com$/, ''),
        full_id: ev.getId(),
        summary: ev.getTitle(),
        description: ev.getDescription() || '',
        location: ev.getLocation() || '',
        start: ev.isAllDayEvent() ? formatDate(ev.getAllDayStartDate()) : ev.getStartTime().toISOString(),
        end: ev.isAllDayEvent() ? formatDate(ev.getAllDayEndDate()) : ev.getEndTime().toISOString(),
        all_day: ev.isAllDayEvent(),
        colorId: ev.getColor() || ''
      }));

      const replies = getBriefingReplies();
      return jsonResponse({ ok: true, events: events, email_replies: replies });
    }

    // 2. Kalender-Aktionen ausführen & E-Mail-Briefing senden
    if (action === 'apply') {
      const results = [];
      const actions = payload.calendar_actions || [];

      for (var i = 0; i < actions.length; i++) {
        var act = actions[i];
        var ev = null;

        if (act.type === 'update' && act.id) {
          ev = findEventById(cal, act.id, act.start);
        }

        if (ev) {
          if (act.summary) ev.setTitle(act.summary);
          if (act.start && act.end) ev.setTime(new Date(act.start), new Date(act.end));
          if (act.description !== undefined) ev.setDescription(act.description);
          if (act.colorId) ev.setColor(String(act.colorId));
          results.push({ type: 'updated', id: ev.getId(), summary: ev.getTitle() });
        } else if (act.type === 'create' || (act.type === 'update' && act.start && act.end && act.summary)) {
          ev = cal.createEvent(act.summary, new Date(act.start), new Date(act.end), {
            description: act.description || ''
          });
          if (act.colorId) ev.setColor(String(act.colorId));
          results.push({ type: 'created', id: ev.getId(), summary: ev.getTitle() });
        }
      }

      var emailSent = false;
      if (payload.email && payload.email.subject && payload.email.html && TARGET_EMAIL) {
        GmailApp.sendEmail(
          TARGET_EMAIL,
          payload.email.subject,
          payload.email.text || 'Bitte HTML-Ansicht aktivieren.',
          {
            htmlBody: payload.email.html,
            name: payload.email.name || 'AI Training Coach'
          }
        );
        emailSent = true;
      }

      return jsonResponse({ ok: true, calendar_results: results, email_sent: emailSent });
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err), stack: err.stack });
  }
}

/**
 * Sucht in Gmail nach Antworten auf "Daily Briefing"- oder "Training Briefing"-Mails der letzten 10 Tage.
 */
function getBriefingReplies() {
  var threads = GmailApp.search('subject:("Daily Briefing" OR "Training Briefing") newer_than:10d', 0, 20);
  var replies = [];

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    if (msgs.length <= 1) continue;

    for (var j = 1; j < msgs.length; j++) {
      var m = msgs[j];
      var plain = (m.getPlainBody() || '').trim();
      var cleaned = stripQuotedEmail(plain);
      if (!cleaned) continue;

      replies.push({
        message_id: m.getId(),
        thread_id: threads[i].getId(),
        from: m.getFrom() || '',
        date: m.getDate().toISOString(),
        subject: m.getSubject(),
        text: cleaned
      });
    }
  }
  return replies;
}

function stripQuotedEmail(text) {
  var lines = text.split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^Am .+ schrieb .+:$/.test(line.trim())) break;
    if (/^On .+ wrote:$/.test(line.trim())) break;
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(line.trim())) break;
    if (/^Von:\s+/i.test(line.trim()) && i > 0) break;
    if (line.trim().indexOf('>') === 0) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

function findEventById(cal, rawId, startIso) {
  var id = String(rawId).replace(/@google\.com$/, '');
  var ev = cal.getEventById(id) || cal.getEventById(id + '@google.com');
  if (ev) return ev;
  if (startIso) {
    var d = new Date(startIso);
    var windowStart = new Date(d.getTime() - 7 * 86400000);
    var windowEnd = new Date(d.getTime() + 7 * 86400000);
    var list = cal.getEvents(windowStart, windowEnd);
    for (var i = 0; i < list.length; i++) {
      if (list[i].getId().indexOf(id) === 0) return list[i];
    }
  }
  return null;
}

function formatDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
