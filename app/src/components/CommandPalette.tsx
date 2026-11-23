import React, { useEffect, useMemo, useState } from 'react';
import { CockpitDataStore } from '../data/useCockpitData';
import { DrawerState, PageId } from '../types';
import { fmtDate, num, sportColor, TODAY_ISO } from '../utils/format';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  store: CockpitDataStore;
  navigate: (page: PageId, sub?: string) => void;
  openDrawer: (d: DrawerState) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  store,
  navigate,
  openDrawer,
}) => {
  const [q, setQ] = useState('');

  useEffect(() => {
    if (open) setQ('');
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const items: {
      id: string;
      group: string;
      title: string;
      sub: string;
      color?: string;
      action: () => void;
    }[] = [
      {
        id: 'act-readiness',
        group: 'Schnellaktionen',
        title: '+ Tagesform & Beine Check-in eintragen',
        sub: 'Beine (1–5), Job-Stress (1–5) & Notiz ins Brain/Supabase speichern',
        action: () => openDrawer({ type: 'readiness', datum: TODAY_ISO }),
      },
      {
        id: 'nav-cockpit',
        group: 'Navigation',
        title: '1 · Cockpit (Weltkarte & AI-Coach)',
        sub: 'Startseite mit Weltkarte, Events & Takeaways',
        action: () => navigate('cockpit'),
      },
      {
        id: 'nav-plan',
        group: 'Navigation',
        title: '2 · Plan & Kalender (W48–W53 & 43-Wo.-Roadmap)',
        sub: 'Operativer Kalender, Wochenkarten, Coach-Radar & Sub-11-Splits',
        action: () => navigate('plan'),
      },
      {
        id: 'nav-form',
        group: 'Navigation',
        title: '3 · Form & Fortschritt (CTL, LT1-Tempo, Drift, Marker, FTP Builder)',
        sub: 'Alle Telemetrie-Charts, Bestwerte & Leistungsmarker',
        action: () => navigate('form'),
      },
      {
        id: 'nav-akt',
        group: 'Navigation',
        title: '4 · Aktivitäten (Suche, Filter & 5-Zonen-Logbuch)',
        sub: `${store.aktivitaeten.length} Garmin-Einheiten durchsuchen`,
        action: () => navigate('aktivitaeten'),
      },
      {
        id: 'nav-events',
        group: 'Navigation',
        title: '5 · Events & Wettkampf-Historie',
        sub: 'Anstehende Ziele, Wettkämpfe & vergangene Rennen',
        action: () => navigate('events'),
      },
    ];

    // Events
    for (const ev of store.events) {
      items.push({
        id: `ev-${ev.id}`,
        group: 'Events & Rennen',
        title: ev.name,
        sub: `${fmtDate(ev.datum)} · ${ev.ort} · ${ev.ziel || ev.ergebnis}`,
        action: () => openDrawer({ type: 'event', id: ev.id }),
      });
    }

    // Active block planned sessions
    for (const bw of store.trainingsplan?.block_wochen || []) {
      for (const it of bw.items) {
        items.push({
          id: `plan-${bw.woche}-${it.titel}-${it.tag}`,
          group: 'Geplante Einheiten (W48–W53)',
          title: `${bw.woche} ${it.wochentag}: ${it.titel}`,
          sub: it.details,
          color: sportColor(it.sport),
          action: () =>
            openDrawer({
              type: 'planned',
              item: {
                woche: bw.woche,
                woche_titel: bw.titel,
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
                aktivitaet_id: it.aktivitaet_id,
              },
            }),
        });
      }
    }

    // Recent or matching activities
    const acts = [...store.aktivitaeten].sort((a, b) => b.datum.localeCompare(a.datum));
    for (const a of acts) {
      items.push({
        id: `akt-${a.id}`,
        group: 'Garmin-Aktivitäten',
        title: `${fmtDate(a.datum)} · ${a.titel}`,
        sub: `${a.sport} · ${num(a.dauer_min)} min · ${a.distanz_km ? num(a.distanz_km, 1) + ' km · ' : ''}${a.reiz}`,
        color: sportColor(a.sport),
        action: () => openDrawer({ type: 'activity', id: a.id }),
      });
    }

    if (!query) return items.slice(0, 18);
    return items
      .filter((it) => `${it.title} ${it.sub} ${it.group}`.toLowerCase().includes(query))
      .slice(0, 25);
  }, [q, store.events, store.trainingsplan, store.aktivitaeten, navigate, openDrawer]);

  if (!open) return null;

  return (
    <div className="ic-drawer-backdrop" onClick={onClose} style={{ placeItems: 'start center', paddingTop: '10vh' }}>
      <div className="ic-cmd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ic-cmd-input-wrap">
          <span>⌘K</span>
          <input
            type="search"
            autoFocus
            placeholder="Springe zu Einheit, Woche, Event, Soll-Reiz oder Seite..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && results[0]) {
                results[0].action();
                onClose();
              }
            }}
          />
          <button type="button" className="ic-btn ic-btn-xs" onClick={onClose}>
            Esc
          </button>
        </div>

        <div className="ic-cmd-list">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="ic-cmd-item"
              onClick={() => {
                r.action();
                onClose();
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.color && <span className="ic-dot" style={{ background: r.color }} />}
                <b>{r.title}</b>
                <span className="ic-tag" style={{ marginLeft: 'auto' }}>
                  {r.group}
                </span>
              </div>
              <div className="ic-ev-meta">{r.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
