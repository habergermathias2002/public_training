import React, { useEffect, useMemo, useState } from 'react';
import { CockpitDataStore } from '../data/useCockpitData';
import { CoachCheck, DrawerState, LapRow, PageId } from '../types';
import {
  DAYS_LONG_MON,
  daysTo,
  fmtDate,
  fmtDurationMmSs,
  fmtPace,
  num,
  nutritionGuideForSession,
  parseIso,
  sportColor,
  statusLevel,
  TODAY_ISO,
  ZONES_5,
} from '../utils/format';

interface SlideOverDrawerProps {
  drawer: DrawerState;
  onClose: () => void;
  openDrawer: (d: DrawerState) => void;
  navigate: (page: PageId, sub?: string) => void;
  flyToEventOnMap: (eventId: string) => void;
  store: CockpitDataStore;
}

export const SlideOverDrawer: React.FC<SlideOverDrawerProps> = ({
  drawer,
  onClose,
  openDrawer,
  navigate,
  flyToEventOnMap,
  store,
}) => {
  const [fullscreen, setFullscreen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, onClose]);

  if (!drawer) return null;

  return (
    <div className="ic-drawer-backdrop" onClick={onClose}>
      <aside
        className={`ic-drawer ${fullscreen ? 'ic-drawer-full' : ''}`}
        onClick={(e) => e.stopPropagation()}
        aria-label="Detail-Ansicht"
      >
        <div className="ic-drawer-topbar">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="ic-btn" onClick={onClose}>
              ✕ Schließen (Esc)
            </button>
            <button
              type="button"
              className="ic-btn"
              onClick={() => setFullscreen((v) => !v)}
              title="Zwischen Slide-Over und Vollbild umschalten"
            >
              {fullscreen ? '⤡ Kompakte Seitenleiste' : '⤢ Vollbild-Ansicht'}
            </button>
          </div>

          {drawer.type === 'activity' && (
            <ActivityPrevNext id={drawer.id} store={store} openDrawer={openDrawer} />
          )}
        </div>

        <div className="ic-drawer-body">
          {drawer.type === 'activity' && (
            <ActivityDetailContent id={drawer.id} store={store} openDrawer={openDrawer} />
          )}
          {drawer.type === 'planned' && (
            <PlannedSessionContent item={drawer.item} store={store} openDrawer={openDrawer} />
          )}
          {drawer.type === 'event' && (
            <EventDetailContent
              id={drawer.id}
              store={store}
              openDrawer={openDrawer}
              navigate={navigate}
              flyToEventOnMap={(id) => {
                onClose();
                flyToEventOnMap(id);
              }}
            />
          )}
          {drawer.type === 'country' && (
            <CountryDetailContent land={drawer.land} store={store} openDrawer={openDrawer} />
          )}
          {drawer.type === 'week' && (
            <WeekDetailContent woche={drawer.woche} store={store} openDrawer={openDrawer} />
          )}
          {drawer.type === 'ftp' && (
            <FtpDetailContent nr={drawer.nr} store={store} openDrawer={openDrawer} />
          )}
          {drawer.type === 'readiness' && (
            <ReadinessCheckinContent initialDate={drawer.datum || TODAY_ISO} store={store} />
          )}
          {drawer.type === 'day' && (
            <DayDetailContent datum={drawer.datum} store={store} openDrawer={openDrawer} />
          )}
        </div>
      </aside>
    </div>
  );
};

// ---------------------------------------------------------------- 1. Activity Prev / Next
const ActivityPrevNext: React.FC<{
  id: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ id, store, openDrawer }) => {
  const sorted = useMemo(
    () =>
      [...store.aktivitaeten].sort((a, b) =>
        (b.datum + (b.start || '')).localeCompare(a.datum + (a.start || ''))
      ),
    [store.aktivitaeten]
  );
  const idx = sorted.findIndex((a) => String(a.id) === String(id));
  const newer = idx > 0 ? sorted[idx - 1] : null;
  const older = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        type="button"
        className="ic-btn"
        disabled={!older}
        onClick={() => older && openDrawer({ type: 'activity', id: older.id })}
        title={older ? `Älter: ${older.titel} (${fmtDate(older.datum)})` : ''}
      >
        ← Älter
      </button>
      <button
        type="button"
        className="ic-btn"
        disabled={!newer}
        onClick={() => newer && openDrawer({ type: 'activity', id: newer.id })}
        title={newer ? `Neuer: ${newer.titel} (${fmtDate(newer.datum)})` : ''}
      >
        Neuer →
      </button>
    </div>
  );
};

// ---------------------------------------------------------------- 2. Activity Detail Content + Session-RPE Input
const ActivityDetailContent: React.FC<{
  id: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ id, store, openDrawer }) => {
  const r = store.aktivitaeten.find((x) => String(x.id) === String(id));
  const d = store.einheitenById.get(String(id));
  const fulfilledPlan = store.kalender.find((k) => String(k.aktivitaet_id) === String(id));

  const [rpeVal, setRpeVal] = useState<number>(d?.rpe ?? 6);
  const [gefuehl, setGefuehl] = useState<string>(d?.rpe_gefuehl || 'kontrolliert');
  const [notiz, setNotiz] = useState<string>(d?.rpe_notiz || '');
  const [saveMsg, setSaveMsg] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRpeVal(d?.rpe ?? (r?.hart ? 7 : 4));
    setGefuehl(d?.rpe_gefuehl || (r?.hart ? 'kontrolliert' : 'locker'));
    setNotiz(d?.rpe_notiz || '');
    setSaveMsg('');
  }, [id, d, r]);

  if (!r) {
    return <p className="ic-note">Einheit {id} nicht gefunden.</p>;
  }

  const dt = parseIso(r.datum);
  const wd = dt ? (dt.getUTCDay() + 6) % 7 : 0;

  let checks: CoachCheck[] = [];
  try {
    checks = d?.checks ? JSON.parse(d.checks) : [];
  } catch {
    checks = [];
  }

  let laps: LapRow[] = [];
  try {
    laps = d?.runden ? JSON.parse(d.runden) : [];
  } catch {
    laps = [];
  }

  // 5-Zone minutes (Z1..Z5)
  const z5 = [
    d?.z5_1_min ?? 0,
    d?.z5_2_min ?? r.z1_min ?? 0,
    d?.z5_3_min ?? r.z2_min ?? 0,
    d?.z5_4_min ?? r.z3_min ?? 0,
    d?.z5_5_min ?? r.z4_min ?? 0,
  ];
  const zTot = z5.reduce((s, v) => s + v, 0);

  const iconMap: Record<string, string> = { ok: '✓', warn: '!', bad: '✕', info: 'i', neutral: '·' };

  const handleSaveRpe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await store.saveRpe({
      activity_id: String(r.id),
      datum: r.datum,
      titel: r.titel,
      rpe: rpeVal,
      gefuehl,
      notiz,
    });
    setSaving(false);
    setSaveMsg(res.msg);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="ic-detail-head">
        <span className="ic-dot" style={{ width: 13, height: 13, background: sportColor(r.sport) }} />
        <h1>{r.titel}</h1>
        <span className={`ic-tag ${r.hart ? 'hart' : ''}`}>{r.reiz}</span>
        {d?.rpe != null && <span className="ic-rpe-badge">RPE {d.rpe}/10</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="ic-ev-meta">
          {DAYS_LONG_MON[wd]}, {fmtDate(r.datum)}
          {r.start ? `, ${r.start} Uhr` : ''} · {r.sport} · Woche{' '}
          <button
            type="button"
            className="ic-inline-link"
            onClick={() => openDrawer({ type: 'week', woche: r.woche })}
          >
            {r.woche} ↗
          </button>
        </span>
        {d?.land_de && (
          <button
            type="button"
            className="ic-country-pill"
            onClick={() => d.land && openDrawer({ type: 'country', land: d.land })}
          >
            📍 {d.land_de} ↗
          </button>
        )}
        {fulfilledPlan && (
          <span className="ic-pill ic-s-ok">✓ Soll-Reiz erfüllt: {fulfilledPlan.titel}</span>
        )}
      </div>

      {/* Telemetry Metrics Grid */}
      <div className="ic-metrics">
        <div className="ic-metric">
          <small>Dauer</small>
          <b>{num(r.dauer_min)} min</b>
        </div>
        {r.distanz_km > 0 && (
          <div className="ic-metric">
            <small>Distanz</small>
            <b>{num(r.distanz_km, 2)} km</b>
          </div>
        )}
        {r.tempo && (
          <div className="ic-metric">
            <small>Tempo</small>
            <b>{r.tempo}</b>
          </div>
        )}
        {r.puls_avg && (
          <div className="ic-metric">
            <small>Ø Puls</small>
            <b>{r.puls_avg} bpm</b>
          </div>
        )}
        {r.puls_max && (
          <div className="ic-metric">
            <small>Max. Puls</small>
            <b>{r.puls_max} bpm</b>
          </div>
        )}
        {r.leistung_np && (
          <div className="ic-metric">
            <small>Norm. Leistung (NP)</small>
            <b>{r.leistung_np} W</b>
          </div>
        )}
        {r.leistung_np && r.puls_avg && (
          <div className="ic-metric">
            <small>Efficiency Factor</small>
            <b>{num(r.leistung_np / r.puls_avg, 2)} W/bpm</b>
          </div>
        )}
        {d?.drift_pct != null && (
          <div className="ic-metric">
            <small>Pulsdrift (Decoupling)</small>
            <b
              style={{
                color:
                  d.drift_pct <= 5
                    ? 'var(--color-ok)'
                    : d.drift_pct <= 7
                    ? 'var(--color-warn)'
                    : 'var(--color-bad)',
              }}
            >
              {num(d.drift_pct, 1)} %
            </b>
          </div>
        )}
        {r.hm_auf > 0 && (
          <div className="ic-metric">
            <small>Höhenmeter</small>
            <b>
              ↑{r.hm_auf} ↓{r.hm_ab} m
            </b>
          </div>
        )}
        <div className="ic-metric">
          <small>Last ({r.last_quelle})</small>
          <b>{num(r.last)}</b>
        </div>
        {r.split5k && (
          <div className="ic-metric">
            <small>Schnellste 5 km</small>
            <b>{r.split5k}</b>
          </div>
        )}
      </div>

      {/* Coach-Einordnung & Checks */}
      <div className="ic-card ic-coach">
        <div className="ic-card-head">
          <h2 className="ic-h2">Einordnung vom Coach</h2>
        </div>
        {d && (
          <>
            <div className="ic-coach-fazit">
              <span className={`ic-ck ${d.fazit_stufe || ''}`}>{iconMap[d.fazit_stufe] || '·'}</span>
              <span>{d.fazit}</span>
            </div>
            {d.einordnung && <p>{d.einordnung}</p>}
            {checks.length > 0 && (
              <ul className="ic-checks">
                {checks.map((c, i) => (
                  <li key={i}>
                    <span className={`ic-ck ${c.stufe}`}>{iconMap[c.stufe] || '·'}</span>
                    <span>
                      <b>{c.punkt}: </b>
                      {c.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Profi-5-Zonen-Modell (LT1/LT2) */}
      {zTot > 0 && (
        <div className="ic-card">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">
                Profi-5-Zonen-Verteilung ({r.sport === 'Rad' ? 'Rad · individuelle Zonen' : 'Lauf · individuelle Zonen'})
              </h2>
              <p className="ic-note">
                LIT-Anteil (Z1 + Z2 ≤ {r.sport === 'Rad' ? '140' : '145'} bpm):{' '}
                <b>{Math.round((100 * (z5[0] + z5[1])) / zTot)} %</b> ({num(z5[0] + z5[1], 1)} min)
              </p>
            </div>
          </div>

          <div className="ic-zbar" style={{ height: 18 }}>
            {z5.map((min, i) =>
              min > 0 ? (
                <span
                  key={i}
                  style={{ width: `${(100 * min) / zTot}%`, background: ZONES_5[i].color }}
                  title={`${ZONES_5[i].name}: ${num(min, 1)} min`}
                />
              ) : null
            )}
          </div>

          <div className="ic-zone5-grid">
            {ZONES_5.map((z, i) => {
              const min = z5[i];
              const pct = zTot > 0 ? Math.round((100 * min) / zTot) : 0;
              return (
                <div key={z.id} className="ic-zone5-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i style={{ width: 10, height: 10, borderRadius: 2, background: z.color, display: 'inline-block' }} />
                    <b>{z.name}</b>
                    <span className="ic-ev-meta">{r.sport === 'Rad' ? z.bpmBike : z.bpmRun}</span>
                  </div>
                  <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <b>{num(min, 1)} min</b> <span className="ic-ev-meta">({pct} %)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Visual Lap / Interval Chart & Table */}
      {laps.length > 1 && (
        <div className="ic-card">
          <div className="ic-card-head">
            <h2 className="ic-h2">Runden &amp; Intervall-Telemetrie ({laps.length} Runden)</h2>
          </div>

          {/* Visual Bar Chart of Laps */}
          <LapVisualBar laps={laps} isRun={r.sport === 'Lauf'} />

          <div className="ic-scroll" style={{ marginTop: 10 }}>
            <table className="ic-table ic-table-dense">
              <thead>
                <tr>
                  <th>Runde</th>
                  <th className="num">Zeit</th>
                  <th className="num">Distanz</th>
                  <th className="num">{r.sport === 'Lauf' ? 'Tempo' : 'km/h'}</th>
                  <th className="num">Ø Puls</th>
                  <th className="num">Max. Puls</th>
                  <th className="num">Watt</th>
                </tr>
              </thead>
              <tbody>
                {laps.map((l) => {
                  const speed = l.tempo_s
                    ? r.sport === 'Lauf'
                      ? `${fmtPace(l.tempo_s)}/km`
                      : num(3600 / l.tempo_s, 1)
                    : '–';
                  return (
                    <tr key={l.nr}>
                      <td>#{l.nr}</td>
                      <td className="num">{fmtDurationMmSs(l.zeit_s)}</td>
                      <td className="num">{l.distanz_m ? `${num(l.distanz_m / 1000, 2)} km` : '–'}</td>
                      <td className="num">
                        <b>{speed}</b>
                      </td>
                      <td className="num">{l.puls ?? '–'}</td>
                      <td className="num">{l.puls_max ?? '–'}</td>
                      <td className="num">{l.watt ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interactive Session-RPE (1-10) & Notes Widget (Write-Back to Brain & Supabase!) */}
      <form className="ic-card ic-checkin-card" onSubmit={handleSaveRpe}>
        <div className="ic-card-head">
          <div>
            <h2 className="ic-h2">Subjektives Feedback &amp; Session-RPE (1–10)</h2>
            <p className="ic-note">
              Wird direkt in <code>athlet/feedback.json</code>, <code>journal/</code> und Supabase gespeichert (sRPE-Last:{' '}
              <b>{Math.round(rpeVal * r.dauer_min)}</b>)
            </p>
          </div>
          {d?.rpe != null && <span className="ic-pill ic-s-ok">✓ RPE {d.rpe}/10 gespeichert</span>}
        </div>

        <div className="ic-rpe-scale">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
            <button
              key={v}
              type="button"
              className={`ic-rpe-btn ${rpeVal === v ? 'active' : ''} ${v <= 4 ? 'easy' : v <= 7 ? 'mod' : 'hard'}`}
              onClick={() => setRpeVal(v)}
            >
              <b>{v}</b>
              <small>{v <= 3 ? 'Locker' : v <= 5 ? 'Mittel' : v <= 7 ? 'Stark' : v <= 9 ? 'Hart' : 'Max'}</small>
            </button>
          ))}
        </div>

        <div className="ic-checkin-row">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['sehr locker', 'locker', 'kontrolliert', 'fordernd', 'hart / am Limit'] as const).map((g) => (
              <button
                key={g}
                type="button"
                className={`ic-btn ic-btn-xs ${gefuehl === g ? 'ic-btn-accent' : ''}`}
                onClick={() => setGefuehl(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="ic-checkin-row">
          <input
            type="text"
            className="ic-search-input"
            placeholder="Kurze Notiz zur Einheit (z.B. Beine frisch, Intervalle kontrolliert, noch Luft)..."
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
          />
          <button type="submit" className="ic-btn ic-btn-accent" disabled={saving}>
            {saving ? 'Speichere...' : 'RPE im Brain speichern'}
          </button>
        </div>
        {saveMsg && <div className="ic-save-confirm">✓ {saveMsg}</div>}
      </form>
    </div>
  );
};

// Visual Bar Representation of Laps (Pace / Watt + HR)
const LapVisualBar: React.FC<{ laps: LapRow[]; isRun: boolean }> = ({ laps, isRun }) => {
  const valid = laps.filter((l) => l.zeit_s >= 15);
  if (valid.length < 2) return null;

  const speeds = valid.map((l) => (l.watt ? l.watt : l.tempo_s ? 3600 / l.tempo_s : 0));
  const maxSpd = Math.max(...speeds, 1);
  const minSpd = Math.min(...speeds.filter((s) => s > 0), maxSpd * 0.6);

  return (
    <div className="ic-lap-bars">
      {valid.map((l) => {
        const val = l.watt ? l.watt : l.tempo_s ? 3600 / l.tempo_s : 0;
        const pct = maxSpd > minSpd ? 25 + 75 * ((val - minSpd) / (maxSpd - minSpd)) : 60;
        const hr = l.puls || 0;
        const barColor =
          hr > 182
            ? 'var(--zone-5)'
            : hr >= 168
            ? 'var(--zone-4)'
            : hr >= 146
            ? 'var(--zone-3)'
            : 'var(--zone-2)';
        const label = l.watt ? `${l.watt}W` : l.tempo_s && isRun ? fmtPace(l.tempo_s) : '';
        return (
          <div
            key={l.nr}
            className="ic-lap-col"
            title={`Runde #${l.nr}: ${fmtDurationMmSs(l.zeit_s)} · ${label}${hr ? ` · Ø ${hr} bpm` : ''}`}
          >
            <div className="ic-lap-bar-track">
              <div
                className="ic-lap-bar-fill"
                style={{
                  height: `${Math.max(18, Math.min(100, pct))}%`,
                  background: barColor,
                }}
              />
            </div>
            <span className="ic-lap-val">{label}</span>
            <span className="ic-lap-nr">#{l.nr}</span>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------- 3. Planned Session Briefing Content
const PlannedSessionContent: React.FC<{
  item: Extract<DrawerState, { type: 'planned' }>['item'];
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ item, store, openDrawer }) => {
  // Enrich from block_wochen if available
  const bw = store.trainingsplan?.block_wochen.find((w) => w.woche === item.woche);
  const match = bw?.items.find((it) => it.titel === item.titel);
  const zone = item.zone || match?.zone || '';
  const warum = item.warum || match?.warum || '';
  const dauer = Number(item.dauer_min || match?.dauer_min || 60);
  const isHard =
    item.hart ??
    match?.hart ??
    ['VO2max', 'Schwelle', 'Renntempo', 'Test5k', 'hart'].includes(item.reiz);

  const guide = nutritionGuideForSession(item.sport, item.reiz, dauer);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        <span className="ic-dot" style={{ width: 13, height: 13, background: sportColor(item.sport) }} />
        <h1>{item.titel}</h1>
        <span className={`ic-tag ${isHard ? 'hart' : ''}`}>{item.reiz}</span>
        {item.ebene && <span className="ic-compass-prio">Ebene: {item.ebene}</span>}
      </div>

      <div className="ic-ev-meta">
        {item.woche ? `${item.woche}${item.woche_titel ? ` (${item.woche_titel})` : ''} · ` : ''}
        {item.wochentag ? `${item.wochentag} ` : ''}
        {item.datum ? fmtDate(item.datum) : ''}
        {item.zeit ? ` · Start: ${item.zeit} Uhr` : ''} · Geplante Dauer: <b>~{dauer} min</b>
      </div>

      {item.status === 'erledigt' && item.aktivitaet_id && (
        <div className="ic-card" style={{ borderColor: 'var(--color-ok)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ic-ok">✓ Dieser Soll-Reiz wurde am {fmtDate(item.erledigt_am)} erfüllt!</span>
            <button
              type="button"
              className="ic-btn ic-btn-accent"
              onClick={() => openDrawer({ type: 'activity', id: String(item.aktivitaet_id) })}
            >
              Absolvierte Einheit öffnen →
            </button>
          </div>
        </div>
      )}

      {/* Session Structure & Zone Box */}
      <div className="ic-card">
        <h2 className="ic-h2">Session-Vorgabe (Reps × Distanz &amp; 5-Zonen-Steuerung)</h2>
        <p style={{ fontSize: 15, fontWeight: 600, margin: '6px 0 12px', lineHeight: 1.5 }}>{item.details}</p>

        <dl className="ic-ev-dl">
          <dt>Ziel-Pulszone</dt>
          <dd>
            <b>{zone || guide.zielZone}</b>
          </dd>
          <dt>Coaching-Hinweis</dt>
          <dd>{guide.zielZone}</dd>
          {warum && (
            <>
              <dt>Physiologisches „Warum“</dt>
              <dd>{warum}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Pacing & Regeneration Guide */}
      <div className="ic-card">
        <h2 className="ic-h2">Pacing &amp; Regeneration</h2>
        <dl className="ic-ev-dl">
          <dt>Vor der Einheit</dt>
          <dd>{guide.vorher}</dd>
          <dt>Währenddessen</dt>
          <dd>{guide.waehrend}</dd>
          <dt>Recovery danach</dt>
          <dd>{guide.nachher}</dd>
        </dl>
      </div>

      {/* 5-Zone Reference Table for this Sport */}
      {(item.sport === 'Lauf' || item.sport === 'Rad') && (
        <div className="ic-card">
          <h2 className="ic-h2">Deine 5-Zonen-Referenz ({item.sport})</h2>
          <div className="ic-zone5-grid">
            {ZONES_5.map((z) => (
              <div key={z.id} className="ic-zone5-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i style={{ width: 10, height: 10, borderRadius: 2, background: z.color, display: 'inline-block' }} />
                  <b>{z.name}</b>
                </div>
                <span>{item.sport === 'Rad' ? z.bpmBike : z.bpmRun}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- 4. Event Detail Content
const EventDetailContent: React.FC<{
  id: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
  navigate: (page: PageId, sub?: string) => void;
  flyToEventOnMap: (id: string) => void;
}> = ({ id, store, openDrawer, navigate, flyToEventOnMap }) => {
  const ev = store.events.find((e) => e.id === id);
  if (!ev) return <p className="ic-note">Event nicht gefunden.</p>;

  const actIds = (ev.aktivitaeten || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const linkedActs = actIds
    .map((aid) => store.aktivitaeten.find((a) => String(a.id) === aid))
    .filter(Boolean);

  const lvl = statusLevel(ev.status);
  const radarKey = id.includes('5k') || id.includes('nahziel') ? '5k' : id.includes('zwischenziel') || id.includes('trail') ? 'zwischenziel' : id.includes('ironman') || id.includes('hauptziel') ? 'ironman' : 'allgemein';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        {ev.prio && <span className="ic-compass-prio">Prio {ev.prio}</span>}
        <h1>{ev.name}</h1>
        {ev.status && <span className={`ic-pill ic-s-${lvl}`}>{ev.status}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="ic-ev-meta">
          {fmtDate(ev.datum)}
          {ev.datum_bis ? ` – ${fmtDate(ev.datum_bis)}` : ''} · {ev.ort} ({ev.land})
          {ev.typ === 'anstehend' ? ` · noch ${daysTo(ev.datum)} Tage` : ''}
        </span>
        {ev.lat != null && (
          <button type="button" className="ic-btn ic-btn-xs" onClick={() => flyToEventOnMap(ev.id)}>
            🗺 Auf Weltkarte zeigen
          </button>
        )}
        {ev.typ === 'anstehend' && (
          <button
            type="button"
            className="ic-btn ic-btn-xs ic-btn-accent"
            onClick={() => navigate('plan', radarKey)}
          >
            🎯 Coach-Radar für dieses Ziel öffnen
          </button>
        )}
      </div>

      <div className="ic-card">
        <dl className="ic-ev-dl">
          {ev.ergebnis && (
            <>
              <dt>Offizielles Ergebnis</dt>
              <dd>
                <b>{ev.ergebnis}</b>
              </dd>
            </>
          )}
          {ev.ziel && (
            <>
              <dt>Ziel</dt>
              <dd>
                <b>{ev.ziel}</b>
              </dd>
            </>
          )}
          {ev.prognose && (
            <>
              <dt>Aktuelle Prognose</dt>
              <dd>
                <b>{ev.prognose}</b> {ev.konfidenz ? `(Konfidenz: ${ev.konfidenz})` : ''}
              </dd>
            </>
          )}
          {ev.strecke && (
            <>
              <dt>Strecke</dt>
              <dd>{ev.strecke}</dd>
            </>
          )}
          {ev.begruendung && (
            <>
              <dt>Daten-Grundlage</dt>
              <dd>{ev.begruendung}</dd>
            </>
          )}
          {ev.hebel && (
            <>
              <dt>Größter Hebel</dt>
              <dd>{ev.hebel}</dd>
            </>
          )}
          {ev.naechster_check && (
            <>
              <dt>Nächster Check</dt>
              <dd>{ev.naechster_check}</dd>
            </>
          )}
          {ev.hinweis && (
            <>
              <dt>Hinweis</dt>
              <dd>{ev.hinweis}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Linked Garmin Activities */}
      {linkedActs.length > 0 && (
        <div className="ic-card">
          <h2 className="ic-h2">Verknüpfte Garmin-Aufzeichnungen ({linkedActs.length})</h2>
          <div className="ic-bw-list">
            {linkedActs.map((r) => {
              if (!r) return null;
              return (
                <div
                  key={r.id}
                  className="ic-bw-item ic-click"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrawer({ type: 'activity', id: r.id })}
                >
                  <div className="ic-bw-row">
                    <span className="ic-bw-name">
                      <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                      {fmtDate(r.datum)} · {r.titel}
                    </span>
                    <span className="ic-link-hint">Telemetrie &amp; Runden →</span>
                  </div>
                  <div className="ic-ev-row">
                    <span>{num(r.dauer_min)} min</span>
                    {r.distanz_km > 0 && <span>{num(r.distanz_km, 2)} km</span>}
                    {r.tempo && <span>{r.tempo}</span>}
                    {r.puls_avg && <span>Ø {r.puls_avg} bpm</span>}
                    {r.hm_auf > 0 && <span>↑ {r.hm_auf} Hm</span>}
                    <span>Last {num(r.last)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- 5. Country Detail Content
const CountryDetailContent: React.FC<{
  land: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ land, store, openDrawer }) => {
  const info = store.laender.find((l) => l.land === land);
  const acts = useMemo(() => {
    const ids = new Set(
      (info?.aktivitaet_ids || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return store.aktivitaeten
      .filter((a) => ids.has(String(a.id)) || store.einheitenById.get(String(a.id))?.land === land)
      .sort((a, b) => b.datum.localeCompare(a.datum));
  }, [info, land, store.aktivitaeten, store.einheitenById]);

  const totalKm = acts.reduce((s, a) => s + (a.distanz_km || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        <h1>📍 Trainingsland: {info?.name_de || land}</h1>
      </div>

      <div className="ic-metrics">
        <div className="ic-metric">
          <small>Einheiten</small>
          <b>{num(info?.aktivitaeten || acts.length)}</b>
        </div>
        <div className="ic-metric">
          <small>Stunden</small>
          <b>{num(info?.stunden || 0, 1)} h</b>
        </div>
        <div className="ic-metric">
          <small>Gesamtdistanz</small>
          <b>{num(totalKm, 1)} km</b>
        </div>
        {info && (
          <div className="ic-metric">
            <small>Zeitraum</small>
            <b style={{ fontSize: 13 }}>
              {fmtDate(info.erstes)} – {fmtDate(info.letztes)}
            </b>
          </div>
        )}
      </div>

      <div className="ic-card">
        <h2 className="ic-h2">Alle Einheiten in {info?.name_de || land} ({acts.length})</h2>
        <div className="ic-bw-list" style={{ maxHeight: 520, overflowY: 'auto' }}>
          {acts.map((r) => (
            <div
              key={r.id}
              className="ic-bw-item ic-click"
              role="button"
              tabIndex={0}
              onClick={() => openDrawer({ type: 'activity', id: r.id })}
            >
              <div className="ic-bw-row">
                <span className="ic-bw-name">
                  <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                  {fmtDate(r.datum)} · {r.titel}
                </span>
                <span className={`ic-tag ${r.hart ? 'hart' : ''}`}>{r.reiz}</span>
              </div>
              <div className="ic-ev-row">
                <span>{num(r.dauer_min)} min</span>
                {r.distanz_km > 0 && <span>{num(r.distanz_km, 1)} km</span>}
                {r.tempo && <span>{r.tempo}</span>}
                {r.puls_avg && <span>Ø {r.puls_avg} bpm</span>}
                <span className="ic-link-hint" style={{ marginLeft: 'auto' }}>
                  Öffnen →
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- 6. Week Detail Content
const WeekDetailContent: React.FC<{
  woche: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ woche, store, openDrawer }) => {
  const istWeek = store.wochen.find((w) => w.woche === woche || w.start === woche);
  const key = istWeek?.woche || woche;
  const blockWeek = store.trainingsplan?.block_wochen.find((b) => b.woche === key);
  const makroWeek = store.trainingsplan?.makro_wochen.find((m: any) => m.woche === key);
  const acts = store.aktivitaeten
    .filter((a) => a.woche === key)
    .sort((a, b) => (a.datum + (a.start || '')).localeCompare(b.datum + (b.start || '')));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        <h1>
          Woche {key} {blockWeek ? `· ${blockWeek.titel}` : ''}
        </h1>
      </div>

      {blockWeek?.ziel && <p className="ic-lede">{blockWeek.ziel}</p>}
      {makroWeek?.fokus && <p className="ic-lede">Makro-Leitplanke: {makroWeek.fokus}</p>}

      <div className="ic-metrics">
        <div className="ic-metric">
          <small>Gesamt-Stunden</small>
          <b>{num(istWeek?.h_gesamt ?? blockWeek?.h_gesamt ?? makroWeek?.h_gesamt ?? 0, 1)} h</b>
        </div>
        <div className="ic-metric">
          <small>Lauf-km</small>
          <b>{num(istWeek?.km_lauf ?? blockWeek?.km_lauf ?? 0, 1)} km</b>
        </div>
        <div className="ic-metric">
          <small>Harte Reize</small>
          <b>{istWeek?.harte_reize ?? blockWeek?.harte_reize ?? 0}</b>
        </div>
        <div className="ic-metric">
          <small>Schwimmen</small>
          <b>{istWeek?.schwimm_einheiten ?? blockWeek?.schwimm_einheiten ?? 0}×</b>
        </div>
        {istWeek?.last != null && (
          <div className="ic-metric">
            <small>Wochenlast</small>
            <b>{num(istWeek.last, 0)}</b>
          </div>
        )}
      </div>

      {blockWeek && (
        <div className="ic-card">
          <h2 className="ic-h2">
            Geplante Soll-Reize ({blockWeek.erledigt}/{blockWeek.gesamt} erledigt)
          </h2>
          <div className="ic-bw-list">
            {blockWeek.items.map((it, idx) => (
              <div
                key={idx}
                className={`ic-bw-item ic-click ${it.status === 'erledigt' ? 'done' : ''} ${it.hart ? 'hart' : ''}`}
                onClick={() => {
                  if (it.status === 'erledigt' && it.aktivitaet_id) {
                    openDrawer({ type: 'activity', id: String(it.aktivitaet_id) });
                  } else {
                    openDrawer({
                      type: 'planned',
                      item: {
                        woche: blockWeek.woche,
                        woche_titel: blockWeek.titel,
                        datum: it.tag,
                        wochentag: it.wochentag,
                        zeit: it.zeit,
                        sport: it.sport,
                        reiz: it.reiz,
                        titel: it.titel,
                        details: it.details,
                        ebene: it.ebene,
                        dauer_min: it.dauer_min,
                        zone: it.zone,
                        warum: it.warum,
                        hart: it.hart,
                        status: it.status,
                      },
                    });
                  }
                }}
              >
                <div className="ic-bw-row">
                  <span className="ic-bw-name">
                    <span className="ic-dot" style={{ background: sportColor(it.sport) }} />
                    {it.wochentag} {it.zeit} · {it.titel} {it.status === 'erledigt' ? '✓' : ''}
                  </span>
                  <span className="ic-link-hint">{it.status === 'erledigt' ? 'Einheit →' : 'Briefing →'}</span>
                </div>
                <div className="ic-ev-meta">{it.details}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {acts.length > 0 && (
        <div className="ic-card">
          <h2 className="ic-h2">Absolvierte Einheiten in {key} ({acts.length})</h2>
          <div className="ic-bw-list">
            {acts.map((r) => (
              <div
                key={r.id}
                className="ic-bw-item ic-click"
                onClick={() => openDrawer({ type: 'activity', id: r.id })}
              >
                <div className="ic-bw-row">
                  <span className="ic-bw-name">
                    <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                    {r.tag} {fmtDate(r.datum)} · {r.titel}
                  </span>
                  <span className={`ic-tag ${r.hart ? 'hart' : ''}`}>{r.reiz}</span>
                </div>
                <div className="ic-ev-row">
                  <span>{num(r.dauer_min)} min</span>
                  {r.distanz_km > 0 && <span>{num(r.distanz_km, 1)} km</span>}
                  {r.tempo && <span>{r.tempo}</span>}
                  {r.puls_avg && <span>Ø {r.puls_avg} bpm</span>}
                  <span>Last {num(r.last)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- 7. FTP Builder Workout Detail
const FtpDetailContent: React.FC<{
  nr: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ nr, store, openDrawer }) => {
  const p = store.ftpBuilder.find((x) => x.nr === nr);
  if (!p) return <p className="ic-note">Workout nicht gefunden.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        <span className="ic-dot" style={{ width: 13, height: 13, background: 'var(--sport-bike)' }} />
        <h1>
          Zwift FTP Builder: {p.nr} {p.einheit}
        </h1>
        <span className={`ic-tag ${p.hart ? 'hart' : ''}`}>{p.hart ? 'Harter Reiz' : 'Locker / Basis'}</span>
      </div>

      <div className="ic-card">
        <dl className="ic-ev-dl">
          <dt>Status</dt>
          <dd>
            <b>{p.status === 'erledigt' ? `✓ Erledigt am ${fmtDate(p.erledigt_am)}` : p.status}</b>
          </dd>
          <dt>Dauer</dt>
          <dd>{p.dauer_min} min</dd>
          <dt>Workout-Inhalt</dt>
          <dd>{p.inhalt}</dd>
          <dt>Einordnung im Plan</dt>
          <dd>{p.zaehlt_als}</dd>
          <dt>Ziel-Pulszone (Rad)</dt>
          <dd>
            {p.hart
              ? 'Z3/Z4 (141–177 bpm · 88–105 % FTP = 208–248 W)'
              : 'Z2 LIT (126–140 bpm, Zielpunkt ~130–135 bpm · 55–75 % FTP)'}
          </dd>
        </dl>

        {p.aktivitaet_id && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="ic-btn ic-btn-accent"
              onClick={() => openDrawer({ type: 'activity', id: String(p.aktivitaet_id) })}
            >
              Gefahrene Zwift-Einheit öffnen →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- 8. Day Detail Content
const DayDetailContent: React.FC<{
  datum: string;
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}> = ({ datum, store, openDrawer }) => {
  const t = store.tage.find((x) => x.datum === datum);
  const acts = store.aktivitaeten.filter((a) => a.datum === datum);
  const plans = store.kalender.filter((k) => k.datum === datum && k.status !== 'erledigt');
  const tf = store.tagesformByDate.get(datum);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        <h1>Tages-Dossier: {fmtDate(datum)}</h1>
        <button
          type="button"
          className="ic-btn ic-btn-accent"
          onClick={() => openDrawer({ type: 'readiness', datum })}
        >
          {tf ? 'Tagesform bearbeiten' : '+ Tagesform für diesen Tag loggen'}
        </button>
      </div>

      {t && (
        <div className="ic-metrics">
          <div className="ic-metric">
            <small>Tageslast</small>
            <b>{num(t.last, 1)}</b>
          </div>
          <div className="ic-metric">
            <small>Fitness (CTL)</small>
            <b>{num(t.fitness_ctl, 1)}</b>
          </div>
          <div className="ic-metric">
            <small>Ermüdung (ATL)</small>
            <b>{num(t.ermuedung_atl, 1)}</b>
          </div>
          <div className="ic-metric">
            <small>Form (TSB)</small>
            <b>{num(t.form_tsb, 1)}</b>
          </div>
          <div className="ic-metric">
            <small>Ruhepuls</small>
            <b>{t.ruhepuls ? `${t.ruhepuls} bpm` : '–'}</b>
          </div>
          <div className="ic-metric">
            <small>Schlaf</small>
            <b>{t.schlaf_h ? `${num(t.schlaf_h, 1)} h` : '–'}</b>
          </div>
        </div>
      )}

      {tf && (
        <div className="ic-card">
          <h2 className="ic-h2">Subjektiver Check-in</h2>
          <p style={{ margin: 0 }}>
            Beine: <b>{tf.beine}/5</b> · Job-Stress: <b>{tf.stress}/5</b> · Schlafgefühl: <b>{tf.schlaf_qualitaet}/5</b>
            {tf.notiz ? ` — „${tf.notiz}“` : ''}
          </p>
        </div>
      )}

      {acts.length > 0 && (
        <div className="ic-card">
          <h2 className="ic-h2">Absolvierte Einheiten ({acts.length})</h2>
          <div className="ic-bw-list">
            {acts.map((r) => (
              <div
                key={r.id}
                className="ic-bw-item ic-click"
                onClick={() => openDrawer({ type: 'activity', id: r.id })}
              >
                <div className="ic-bw-row">
                  <span className="ic-bw-name">
                    <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                    {r.start} · {r.titel}
                  </span>
                  <span className={`ic-tag ${r.hart ? 'hart' : ''}`}>{r.reiz}</span>
                </div>
                <div className="ic-ev-row">
                  <span>{num(r.dauer_min)} min</span>
                  {r.distanz_km > 0 && <span>{num(r.distanz_km, 2)} km</span>}
                  {r.tempo && <span>{r.tempo}</span>}
                  {r.puls_avg && <span>Ø {r.puls_avg} bpm</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {plans.length > 0 && (
        <div className="ic-card">
          <h2 className="ic-h2">Offene Soll-Reize ({plans.length})</h2>
          <div className="ic-bw-list">
            {plans.map((p, idx) => (
              <div
                key={idx}
                className="ic-bw-item ic-click"
                onClick={() =>
                  openDrawer({
                    type: 'planned',
                    item: {
                      woche: p.woche,
                      woche_titel: p.woche_titel,
                      datum: p.datum,
                      wochentag: p.tag,
                      zeit: p.zeit,
                      sport: p.sport,
                      reiz: p.reiz,
                      titel: p.titel,
                      details: p.details,
                      ebene: p.ebene,
                      dauer_min: p.plan_dauer_min,
                      status: p.status,
                    },
                  })
                }
              >
                <div className="ic-bw-row">
                  <span className="ic-bw-name">
                    <span className="ic-dot" style={{ background: sportColor(p.sport) }} />
                    {p.zeit} · {p.titel}
                  </span>
                  <span className="ic-link-hint">Briefing →</span>
                </div>
                <div className="ic-ev-meta">{p.details}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- 9. Readiness / Tagesform Check-in Content (Write-Back!)
const ReadinessCheckinContent: React.FC<{
  initialDate: string;
  store: CockpitDataStore;
}> = ({ initialDate, store }) => {
  const [datum, setDatum] = useState(initialDate);
  const existing = store.tagesformByDate.get(datum);

  const [beine, setBeine] = useState<number>(existing?.beine ?? 4);
  const [stress, setStress] = useState<number>(existing?.stress ?? 2);
  const [schlafQual, setSchlafQual] = useState<number>(existing?.schlaf_qualitaet ?? 4);
  const [notiz, setNotiz] = useState<string>(existing?.notiz ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    const ex = store.tagesformByDate.get(datum);
    setBeine(ex?.beine ?? 4);
    setStress(ex?.stress ?? 2);
    setSchlafQual(ex?.schlaf_qualitaet ?? 4);
    setNotiz(ex?.notiz ?? '');
    setSaveMsg('');
  }, [datum, store.tagesformByDate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await store.saveTagesform({
      datum,
      beine,
      stress,
      schlaf_qualitaet: schlafQual,
      notiz,
    });
    setSaving(false);
    setSaveMsg(res.msg);
  };

  // Preview traffic light per framework.md §5
  const t0 = store.tage.find((t) => t.datum === datum) || store.tage[store.tage.length - 1];
  const subjWarn = (beine <= 2 ? 1 : 0) + (stress >= 4 ? 1 : 0);
  const previewAmpel = subjWarn >= 2 ? 'rot' : subjWarn === 1 ? 'gelb' : 'grün';

  const history = [...store.tagesformByDate.values()].sort((a, b) => b.datum.localeCompare(a.datum));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ic-detail-head">
        <h1>Tagesform &amp; Readiness Check-in (framework.md §5)</h1>
      </div>

      <p className="ic-lede">
        Da Garmin keine HRV im API-Payload liefert, steuern Ruhepuls, Schlafdauer und dein 3-Punkte-Check (Beine, Job-Stress, Schlafgefühl) die Tagesform-Ampel und den AI-Cloud-Coach.
      </p>

      <form className="ic-card ic-checkin-card" onSubmit={handleSave}>
        <div className="ic-checkin-row" style={{ justifyContent: 'space-between' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            Datum:
            <input
              type="date"
              className="dash-select"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
            />
          </label>
          <span className={`ic-pill ic-s-${previewAmpel === 'grün' ? 'ok' : previewAmpel === 'gelb' ? 'warn' : 'bad'}`}>
            Vorschau Ampel: {previewAmpel.toUpperCase()}
            {t0?.ruhepuls ? ` (RP ${t0.ruhepuls} bpm, Schlaf ${t0.schlaf_h ?? '–'} h)` : ''}
          </span>
        </div>

        {/* 1. Beine / Muskuläre Frische (1-5) */}
        <div>
          <label className="ic-field-label">
            1. Beine &amp; muskuläre Frische: <b>{beine}/5</b> ({beine === 5 ? 'Top frisch' : beine === 4 ? 'Gut / bereit' : beine === 3 ? 'Normal / leicht schwer' : beine === 2 ? 'Müde / schwer' : 'Platt / Schmerz'})
          </label>
          <div className="ic-scale-5">
            {[
              [1, '1 · Platt'],
              [2, '2 · Schwer'],
              [3, '3 · Solide'],
              [4, '4 · Frisch'],
              [5, '5 · Top frisch'],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`ic-scale-btn ${beine === val ? 'active' : ''}`}
                onClick={() => setBeine(Number(val))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Job- & Alltags-Stress (1-5) */}
        <div>
          <label className="ic-field-label">
            2. Job- &amp; Alltags-Stress: <b>{stress}/5</b> ({stress === 1 ? 'Entspannt' : stress === 2 ? 'Normal' : stress === 3 ? 'Fordernd' : stress === 4 ? 'Hoch / Deadline' : 'Maximaler Stress'})
          </label>
          <div className="ic-scale-5">
            {[
              [1, '1 · Niedrig'],
              [2, '2 · Normal'],
              [3, '3 · Mittel'],
              [4, '4 · Hoch'],
              [5, '5 · Extrem'],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`ic-scale-btn ${stress === val ? 'active' : ''}`}
                onClick={() => setStress(Number(val))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Subjektive Schlafqualität (1-5) */}
        <div>
          <label className="ic-field-label">
            3. Subjektive Schlafqualität: <b>{schlafQual}/5</b>
          </label>
          <div className="ic-scale-5">
            {[
              [1, '1 · Schlecht'],
              [2, '2 · Unruhig'],
              [3, '3 · Okay'],
              [4, '4 · Gut'],
              [5, '5 · Tief & erholt'],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`ic-scale-btn ${schlafQual === val ? 'active' : ''}`}
                onClick={() => setSchlafQual(Number(val))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Freitext-Notiz für Journal & Cloud-Coach */}
        <div>
          <label className="ic-field-label">Notiz für Journal &amp; AI-Coach (Logistik, Gefühl, Zeitfenster):</label>
          <input
            type="text"
            className="ic-search-input"
            placeholder="z.B. Heute Homeoffice, Beine top frisch für 5x1000m..."
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
          />
        </div>

        <button type="submit" className="ic-btn ic-btn-accent" disabled={saving}>
          {saving ? 'Speichere...' : 'Tagesform im Brain & Supabase speichern'}
        </button>

        {saveMsg && <div className="ic-save-confirm">✓ {saveMsg}</div>}
      </form>

      {/* History of Check-ins */}
      {history.length > 0 && (
        <div className="ic-card">
          <h2 className="ic-h2">Bisherige Tagesform-Einträge ({history.length})</h2>
          <div className="ic-bw-list">
            {history.map((h) => (
              <div
                key={h.id}
                className="ic-bw-item ic-click"
                onClick={() => setDatum(h.datum)}
              >
                <div className="ic-bw-row">
                  <b>{fmtDate(h.datum)}</b>
                  <span className="ic-bw-pills">
                    <span className="ic-bw-pill">Beine {h.beine}/5</span>
                    <span className="ic-bw-pill">Stress {h.stress}/5</span>
                    <span className="ic-bw-pill">Schlaf {h.schlaf_qualitaet}/5</span>
                  </span>
                </div>
                {h.notiz && <div className="ic-ev-meta">{h.notiz}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
