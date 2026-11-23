import React, { useState } from 'react';
import { CockpitDataStore } from '../data/useCockpitData';
import { DrawerState, PageId } from '../types';
import { artColor, daysTo, fmtDate, statusLevel } from '../utils/format';

interface EventsPageProps {
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
  navigate: (page: PageId, sub?: string) => void;
  flyToEventOnMap: (eventId: string) => void;
}

export const EventsPage: React.FC<EventsPageProps> = ({
  store,
  openDrawer,
  navigate,
  flyToEventOnMap,
}) => {
  const [pastFilter, setPastFilter] = useState<string>('');

  const upcoming = store.events
    .filter((r) => r.typ === 'anstehend')
    .sort((a, b) => a.datum.localeCompare(b.datum));

  const past = store.events
    .filter((r) => r.typ !== 'anstehend' && (!pastFilter || r.art === pastFilter))
    .sort((a, b) => b.datum.localeCompare(a.datum));

  const radarKeyForEvent = (id: string) => {
    if (id.includes('5k')) return '5k';
    if (id.includes('zwischenziel') || id.includes('trail')) return 'zwischenziel';
    if (id.includes('ironman')) return 'ironman';
    return 'allgemein';
  };

  return (
    <section className="ic-page" id="events">
      <header className="ic-page-head">
        <div>
          <h1>Events &amp; Wettkampf-Historie</h1>
          <p className="ic-lede">
            Anstehende A/B/C-Ziele mit ehrlicher Prognose aus gültigen Markern &amp; vergangene Rennen/Abenteuer (klickbar zu allen Garmin-Aktivitäten)
          </p>
        </div>
      </header>

      {/* Upcoming A / B / C Race Cards */}
      <div className="ic-events">
        {upcoming.map((r) => {
          const lvl = statusLevel(r.status);
          const hasCoords = r.lat != null && String(r.lat) !== '';
          return (
            <article
              key={r.id}
              className="ic-card ic-ev ic-click"
              onClick={() => openDrawer({ type: 'event', id: r.id })}
            >
              <div className="ic-ev-top">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="ic-compass-prio">Prio {r.prio}</span>
                    <h2 className="ic-h2" style={{ margin: 0 }}>
                      {r.name}
                    </h2>
                  </div>
                  <div className="ic-ev-meta" style={{ marginTop: 4 }}>
                    {fmtDate(r.datum)} · {r.ort} · <b>noch {daysTo(r.datum)} Tage</b> ({Math.round(daysTo(r.datum) / 7)} Wochen)
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`ic-pill ic-s-${lvl}`}>{r.status}</span>
                  {hasCoords && (
                    <button
                      type="button"
                      className="ic-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        flyToEventOnMap(r.id);
                      }}
                    >
                      🗺 Auf Weltkarte
                    </button>
                  )}
                  <button
                    type="button"
                    className="ic-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('plan', radarKeyForEvent(r.id));
                    }}
                  >
                    🎯 Zum Coach-Radar
                  </button>
                </div>
              </div>

              <dl className="ic-ev-dl">
                {r.ziel && (
                  <>
                    <dt>Ziel</dt>
                    <dd>
                      <b>{r.ziel}</b>
                    </dd>
                  </>
                )}
                {r.prognose && (
                  <>
                    <dt>Prognose</dt>
                    <dd>
                      <b>{r.prognose}</b> {r.konfidenz ? `(Konfidenz: ${r.konfidenz})` : ''}
                    </dd>
                  </>
                )}
                {r.strecke && (
                  <>
                    <dt>Strecke</dt>
                    <dd>{r.strecke}</dd>
                  </>
                )}
                {r.begruendung && (
                  <>
                    <dt>Grundlage</dt>
                    <dd>{r.begruendung}</dd>
                  </>
                )}
                {r.hebel && (
                  <>
                    <dt>Größter Hebel</dt>
                    <dd>{r.hebel}</dd>
                  </>
                )}
                {r.naechster_check && (
                  <>
                    <dt>Nächster Check</dt>
                    <dd>{r.naechster_check}</dd>
                  </>
                )}
                {r.hinweis && (
                  <>
                    <dt>Hinweis</dt>
                    <dd>{r.hinweis}</dd>
                  </>
                )}
              </dl>
            </article>
          );
        })}
      </div>

      {/* Past Events & Adventures (100% clickable to linked Garmin Activities!) */}
      <div className="ic-card">
        <div className="ic-card-head">
          <div>
            <h2 className="ic-h2">Vergangene Events &amp; Abenteuer (klickbar zu den Garmin-Aufzeichnungen)</h2>
            <p className="ic-note">
              Klick auf eine Zeile öffnet das Event-Dossier inkl. aller verknüpften Garmin-Aktivitäten
            </p>
          </div>
          <div className="ic-seg" role="group" aria-label="Event-Art">
            {(['', 'Lauf', 'Trail', 'Ultra', 'Triathlon', 'Rad'] as const).map((art) => (
              <button key={art} type="button" aria-pressed={pastFilter === art} onClick={() => setPastFilter(art)}>
                {art || 'Alle'}
              </button>
            ))}
          </div>
        </div>

        <div className="ic-scroll">
          <table className="ic-table ic-table-dense">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Art</th>
                <th>Event</th>
                <th>Ort</th>
                <th>Ergebnis</th>
                <th>Garmin-Daten</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {past.map((r) => {
                const actIds = (r.aktivitaeten || '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                const dateStr = fmtDate(r.datum) + (r.datum_bis ? ` – ${fmtDate(r.datum_bis)}` : '');
                return (
                  <tr
                    key={r.id}
                    className="ic-click-row"
                    tabIndex={0}
                    onClick={() => openDrawer({ type: 'event', id: r.id })}
                    onKeyDown={(e) => e.key === 'Enter' && openDrawer({ type: 'event', id: r.id })}
                  >
                    <td style={{ whiteSpace: 'nowrap' }}>{dateStr}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="ic-dot" style={{ background: artColor(r.art) }} />
                      {r.art}
                    </td>
                    <td>
                      <b>{r.name}</b>
                      {r.hinweis && <span className="ic-ev-meta"> · {r.hinweis}</span>}
                    </td>
                    <td>{r.ort}</td>
                    <td>
                      <b>{r.ergebnis}</b>
                    </td>
                    <td>
                      {actIds.length === 1 ? (
                        <button
                          type="button"
                          className="ic-btn ic-btn-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDrawer({ type: 'activity', id: actIds[0] });
                          }}
                        >
                          Direkt zur Einheit ↗
                        </button>
                      ) : actIds.length > 1 ? (
                        <span className="ic-tag">{actIds.length} Etappen / Splits ↗</span>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="num">
                      {r.lat != null && (
                        <button
                          type="button"
                          className="ic-btn ic-btn-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            flyToEventOnMap(r.id);
                          }}
                          title="Auf der Weltkarte anfliegen"
                        >
                          🗺 Karte
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
