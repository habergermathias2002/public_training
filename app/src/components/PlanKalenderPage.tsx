import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CockpitDataStore } from '../data/useCockpitData';
import { Activity, CalendarPlanItem, DrawerState } from '../types';
import {
  addDays,
  DAYS_LONG_MON,
  DAYS_MON_FIRST,
  daysTo,
  fmtDate,
  fmtDay,
  kwOf,
  mondayOf,
  MONTHS_DE,
  num,
  parseIso,
  sportColor,
  TODAY_ISO,
  TODAY_UTC,
  toIso,
} from '../utils/format';

interface PlanKalenderPageProps {
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
  initialSubTab?: string | null;
}

export const PlanKalenderPage: React.FC<PlanKalenderPageProps> = ({
  store,
  openDrawer,
  initialSubTab,
}) => {
  const [subTab, setSubTab] = useState<'kalender' | 'wochen' | 'strategie'>('kalender');
  const [calView, setCalView] = useState<'woche' | 'monat' | 'tag' | 'liste'>('woche');
  const [calDateIso, setCalDateIso] = useState<string>(TODAY_ISO);
  const [radarId, setRadarId] = useState<'allgemein' | '5k' | 'zwischenziel' | 'ironman'>('allgemein');
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>('block-1');
  const [overloadView, setOverloadView] = useState<'saison' | 'block'>('saison');

  useEffect(() => {
    if (initialSubTab === 'wochen' || initialSubTab === 'kalender' || initialSubTab === 'strategie') {
      setSubTab(initialSubTab);
    } else if (initialSubTab && ['allgemein', '5k', 'zwischenziel', 'ironman'].includes(initialSubTab)) {
      setSubTab('strategie');
      setRadarId(initialSubTab as any);
    }
  }, [initialSubTab]);

  const plan = store.trainingsplan;

  // Index activities and planned items by date
  const calIndex = useMemo(() => {
    const actsByDate = new Map<string, Activity[]>();
    for (const r of store.aktivitaeten) {
      if (!actsByDate.has(r.datum)) actsByDate.set(r.datum, []);
      actsByDate.get(r.datum)!.push(r);
    }
    actsByDate.forEach((list) => list.sort((a, b) => (a.start || '').localeCompare(b.start || '')));

    const planByDate = new Map<string, CalendarPlanItem[]>();
    for (const r of store.kalender) {
      if (r.datum && r.status !== 'erledigt') {
        if (!planByDate.has(r.datum)) planByDate.set(r.datum, []);
        planByDate.get(r.datum)!.push(r);
      }
    }
    const fulfilledIds = new Set(store.kalender.filter((r) => r.aktivitaet_id).map((r) => String(r.aktivitaet_id)));
    return { actsByDate, planByDate, fulfilledIds };
  }, [store.aktivitaeten, store.kalender]);

  // Active / upcoming week summary
  const activeWeekSummary = useMemo(() => {
    const curMon = toIso(mondayOf(TODAY_UTC));
    const nextMon = toIso(addDays(mondayOf(TODAY_UTC), 7));
    const bws = plan?.block_wochen || [];
    return bws.find((b) => b.start === curMon) || bws.find((b) => b.start === nextMon) || bws[0] || null;
  }, [plan]);

  const calDate = useMemo(() => parseIso(calDateIso) || new Date(TODAY_UTC), [calDateIso]);

  const stepCalDate = (step: number) => {
    if (step === 0) {
      setCalDateIso(TODAY_ISO);
      return;
    }
    let d = calDate;
    if (calView === 'tag') d = addDays(d, step);
    else if (calView === 'monat') d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1));
    else d = addDays(d, 7 * step);
    setCalDateIso(toIso(d));
  };

  const calLabel = useMemo(() => {
    if (calView === 'liste') return 'Aktiver Fokusblock (Wochenübersicht)';
    if (calView === 'monat') return `${MONTHS_DE[calDate.getUTCMonth()]} ${calDate.getUTCFullYear()}`;
    if (calView === 'tag') {
      const wd = (calDate.getUTCDay() + 6) % 7;
      return `${DAYS_LONG_MON[wd]}, ${fmtDate(calDateIso)}`;
    }
    const m = mondayOf(calDate);
    return `KW ${kwOf(m)} · ${fmtDay(toIso(m))}–${fmtDate(toIso(addDays(m, 6)))}`;
  }, [calView, calDate, calDateIso]);

  const openPlannedItem = (p: CalendarPlanItem) => {
    if (p.status === 'erledigt' && p.aktivitaet_id) {
      openDrawer({ type: 'activity', id: String(p.aktivitaet_id) });
      return;
    }
    // Check if we have richer Warum/Zone info in trainingsplan.block_wochen
    const bw = plan?.block_wochen.find((w) => w.woche === p.woche);
    const match = bw?.items.find((it) => it.titel === p.titel && (it.tag === p.datum || !it.tag));
    openDrawer({
      type: 'planned',
      item: {
        woche: p.woche,
        woche_titel: p.woche_titel,
        datum: p.datum,
        wochentag: p.tag,
        zeit: p.zeit || match?.zeit,
        sport: p.sport,
        reiz: p.reiz,
        titel: p.titel,
        details: p.details,
        ebene: p.ebene || match?.ebene,
        dauer_min: p.plan_dauer_min || match?.dauer_min,
        distanz_km: match?.distanz_km,
        zone: match?.zone,
        warum: match?.warum,
        hart: match?.hart,
        status: p.status,
        erledigt_am: p.erledigt_am,
        aktivitaet_id: p.aktivitaet_id,
      },
    });
  };

  return (
    <section className="ic-page" id="plan">
      {/* Header & Top Goal Compass Strip */}
      <header className="ic-page-head" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Plan &amp; Kalender</h1>
          <p className="ic-lede">
            Zwei-Ebenen-Steuerung: Aktiver Fokusblock im Detail &amp; Saison-Roadmap
          </p>
        </div>

        {/* Main Sub-Tab Switcher */}
        <div className="ic-seg" role="group" aria-label="Plan-Modus">
          <button
            type="button"
            aria-pressed={subTab === 'kalender'}
            onClick={() => setSubTab('kalender')}
          >
            Kalender (Soll vs. Ist)
          </button>
          <button
            type="button"
            aria-pressed={subTab === 'wochen'}
            onClick={() => setSubTab('wochen')}
          >
            Aktiver Block (W48–W53)
          </button>
          <button
            type="button"
            aria-pressed={subTab === 'strategie'}
            onClick={() => setSubTab('strategie')}
          >
            Strategie, Radar &amp; 43-Wo.-Roadmap
          </button>
        </div>
      </header>

      {/* Compact Clickable Goal Compass Bar */}
      {plan && (
        <div className="ic-plan-compass">
          <div
            className="ic-compass-card prio-b ic-click"
            role="button"
            tabIndex={0}
            onClick={() => openDrawer({ type: 'event', id: 'nahziel' })}
          >
            <div className="ic-compass-top">
              <span className="ic-compass-prio">Aktiver Fokusblock · Prio B</span>
              <span className="ic-compass-count">noch {Math.max(0, daysTo(plan.ziele.nahziel.datum))} Tage</span>
            </div>
            <h3 className="ic-compass-title">
              {plan.ziele.nahziel.name} · {plan.ziele.nahziel.ziel}
            </h3>
            <div className="ic-compass-meta">
              {plan.ziele.nahziel.block}: {plan.ziele.nahziel.mission}
            </div>
            <div className="ic-compass-pill" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Nächster Check: {plan.ziele.nahziel.naechster_check}</span>
              <span className="ic-link-hint">Event-Detail →</span>
            </div>
          </div>

          <div
            className="ic-compass-card prio-a ic-click"
            role="button"
            tabIndex={0}
            onClick={() => openDrawer({ type: 'event', id: 'hauptziel' })}
          >
            <div className="ic-compass-top">
              <span className="ic-compass-prio">Hauptziel · Prio A</span>
              <span className="ic-compass-count">
                noch {Math.round(Math.max(0, daysTo(plan.ziele.langzeit.datum)) / 7)} Wo. ({Math.max(0, daysTo(plan.ziele.langzeit.datum))} T.)
              </span>
            </div>
            <h3 className="ic-compass-title">
              {plan.ziele.langzeit.name} · {plan.ziele.langzeit.ziel}
            </h3>
            <div className="ic-compass-meta">
              Sa {fmtDate(plan.ziele.langzeit.datum)} · Größter Hebel: {plan.ziele.langzeit.hebel}
            </div>
            <div className="ic-compass-pill" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Ziel-Splits: {plan.ziele.langzeit.splits_ziel}</span>
              <span className="ic-link-hint">Sub-11 Analyse →</span>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 1: KALENDER */}
      {subTab === 'kalender' && (
        <div className="ic-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ic-kbar">
            <div className="ic-kbar-left">
              {calView !== 'liste' && (
                <span className="ic-knav">
                  <button type="button" className="ic-btn" onClick={() => stepCalDate(-1)} aria-label="Zurück">
                    ‹
                  </button>
                  <button type="button" className="ic-btn" onClick={() => stepCalDate(0)}>
                    Heute
                  </button>
                  <button type="button" className="ic-btn" onClick={() => stepCalDate(1)} aria-label="Weiter">
                    ›
                  </button>
                </span>
              )}
              <span className="ic-klabel">{calLabel}</span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="ic-chart-legend" style={{ marginBottom: 0 }}>
                <span>
                  <i style={{ background: 'var(--sport-run)' }} />
                  Lauf
                </span>
                <span>
                  <i style={{ background: 'var(--sport-bike)' }} />
                  Rad
                </span>
                <span>
                  <i style={{ background: 'var(--sport-swim)' }} />
                  Schwimmen
                </span>
                <span>
                  <i style={{ background: 'var(--sport-strength)' }} />
                  Kraft/Sonst
                </span>
              </div>
              <div className="ic-seg" role="group" aria-label="Kalender-Ansicht">
                {(
                  [
                    ['tag', 'Tag'],
                    ['woche', 'Woche'],
                    ['monat', 'Monat'],
                    ['liste', 'Block-Liste'],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={calView === v} onClick={() => setCalView(v)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Calendar Week / Day TimeGrid */}
          {(calView === 'woche' || calView === 'tag') && (
            <TimeGridView
              days={
                calView === 'tag'
                  ? [calDate]
                  : Array.from({ length: 7 }, (_, i) => addDays(mondayOf(calDate), i))
              }
              calIndex={calIndex}
              store={store}
              onSelectDay={(iso) => {
                setCalDateIso(iso);
                setCalView('tag');
              }}
              onOpenActivity={(id) => openDrawer({ type: 'activity', id })}
              onOpenPlanned={openPlannedItem}
            />
          )}

          {/* Calendar Month View */}
          {calView === 'monat' && (
            <MonthGridView
              date={calDate}
              calIndex={calIndex}
              onSelectDay={(iso) => {
                setCalDateIso(iso);
                setCalView('tag');
              }}
              onOpenActivity={(id) => openDrawer({ type: 'activity', id })}
              onOpenPlanned={openPlannedItem}
            />
          )}

          {/* Calendar Block List View */}
          {calView === 'liste' && (
            <BlockListView
              store={store}
              calIndex={calIndex}
              onOpenActivity={(id) => openDrawer({ type: 'activity', id })}
              onOpenPlanned={openPlannedItem}
            />
          )}
        </div>
      )}

      {/* SUB-TAB 2: AKTIVER BLOCK (W48-W53) */}
      {subTab === 'wochen' && plan && (
        <>
          <div className="ic-card">
            <div className="ic-card-head">
              <div>
                <h2 className="ic-h2">Intensitäts- &amp; Schlüssellauf-Progression (Block 1: W48–W53)</h2>
                <p className="ic-note">
                  Geplante Minuten in LIT (Z1/Z2 ≤ 145 bpm), Schwelle (Z4) und VO2max/Renntempo (Z5) · Klick auf eine Woche öffnet das Wochen-Briefing
                </p>
              </div>
              <div className="ic-chart-legend" style={{ marginBottom: 0 }}>
                <span>
                  <i style={{ background: 'var(--color-ok)' }} />
                  LIT (Z1/Z2 locker)
                </span>
                <span>
                  <i style={{ background: 'var(--color-warn)' }} />
                  Schwelle / Tempo (Z4)
                </span>
                <span>
                  <i style={{ background: 'var(--color-bad)' }} />
                  VO2max / Renntempo (Z5)
                </span>
              </div>
            </div>
            <IntensityProgressionChart
              blockWochen={plan.block_wochen}
              onSelectWeek={(woche) => openDrawer({ type: 'week', woche })}
            />
          </div>

          <div className="ic-bw-grid">
            {plan.block_wochen.map((b) => {
              const isCur = activeWeekSummary?.woche === b.woche;
              return (
                <div key={b.woche} className={`ic-bw-card ${isCur ? 'cur' : ''}`}>
                  <div className="ic-bw-head">
                    <div>
                      <h3 className="ic-bw-title">
                        {b.woche} · {b.titel}
                      </h3>
                      <p className="ic-bw-goal">{b.ziel}</p>
                    </div>
                    <button
                      type="button"
                      className="ic-bw-phase ic-click"
                      onClick={() => openDrawer({ type: 'week', woche: b.woche })}
                    >
                      {b.phase} · ab {fmtDay(b.start)} ↗
                    </button>
                  </div>

                  <div className="ic-bw-stats">
                    <span>⏱ {num(b.h_gesamt, 1)} h</span>
                    <span>🏃 {num(b.km_lauf, 0)} km</span>
                    <span>🔥 {b.harte_reize}/3 hart</span>
                    <span>🏊 {b.schwimm_einheiten}×</span>
                    <span>🏋️ {b.kraft_einheiten}×</span>
                    <span>
                      ✓ {b.erledigt}/{b.gesamt} erledigt
                    </span>
                  </div>

                  <div className="ic-bw-list">
                    {b.items.map((it, idx) => (
                      <div
                        key={`${b.woche}-${idx}`}
                        className={`ic-bw-item ic-click ${it.status === 'erledigt' ? 'done' : ''} ${it.hart ? 'hart' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (it.status === 'erledigt' && it.aktivitaet_id) {
                            openDrawer({ type: 'activity', id: String(it.aktivitaet_id) });
                          } else {
                            openDrawer({
                              type: 'planned',
                              item: {
                                woche: b.woche,
                                woche_titel: b.titel,
                                datum: it.tag,
                                wochentag: it.wochentag,
                                zeit: it.zeit,
                                sport: it.sport,
                                reiz: it.reiz,
                                titel: it.titel,
                                details: it.details,
                                ebene: it.ebene,
                                dauer_min: it.dauer_min,
                                distanz_km: it.distanz_km,
                                zone: it.zone,
                                warum: it.warum,
                                hart: it.hart,
                                status: it.status,
                                erledigt_am: it.erledigt_am,
                                aktivitaet_id: it.aktivitaet_id,
                              },
                            });
                          }
                        }}
                      >
                        <div className="ic-bw-row">
                          <span className="ic-bw-name">
                            <span className="ic-dot" style={{ background: sportColor(it.sport) }} />
                            {it.wochentag} {it.zeit ? `${it.zeit} ` : ''}· {it.titel}
                            {it.status === 'erledigt' ? ' ✓' : ''}
                          </span>
                          <span className="ic-bw-pills">
                            {it.zone && <span className="ic-bw-pill">{it.zone}</span>}
                            {it.ebene && (
                              <span className={`ic-bw-pill ${it.ebene === 'Fokus' ? 'fokus' : ''}`}>{it.ebene}</span>
                            )}
                            <span className="ic-link-hint">{it.status === 'erledigt' ? 'Analyse →' : 'Briefing →'}</span>
                          </span>
                        </div>
                        <div className="ic-ev-meta">{it.details}</div>
                        {it.warum && <div className="ic-bw-why">💡 {it.warum}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* SUB-TAB 3: STRATEGIE, RADAR & 43-WOCHEN-ROADMAP */}
      {subTab === 'strategie' && plan && (
        <>
          {/* 1. Coach-Radar */}
          <div className="ic-card">
            <div className="ic-card-head">
              <div>
                <h2 className="ic-h2">Athleten- &amp; Wettbewerbs-Profil (Coach-Radar)</h2>
                <div className="ic-chart-legend" style={{ marginBottom: 0, marginTop: 4 }}>
                  <span>
                    <i style={{ background: '#3b82f6' }} />
                    Heute (Ist)
                  </span>
                  <span>
                    <i style={{ background: '#22c55e' }} />
                    Projektion Renntag
                  </span>
                  <span>
                    <i style={{ background: '#ef4444' }} />
                    Ziel-Anforderung
                  </span>
                </div>
              </div>
              <div className="ic-seg" role="group" aria-label="Radar-Ansicht">
                {(
                  [
                    ['allgemein', 'Allgemein'],
                    ['5k', 'Nahziel'],
                    ['zwischenziel', 'Zwischenziel'],
                    ['ironman', 'Hauptziel'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={radarId === id} onClick={() => setRadarId(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <CoachRadarSection plan={plan} radarId={radarId} />
          </div>

          {/* 2. Ironman Sub-11 Split-Prognose */}
          <div className="ic-card">
            <div className="ic-card-head">
              <div>
                <h2 className="ic-h2">Hauptziel: Heute vs. Extrapoliert vs. Ziel</h2>
                <p className="ic-note">{plan.ironman_splits.hinweis}</p>
              </div>
              <div className="ic-chart-legend" style={{ marginBottom: 0 }}>
                <span>
                  <i style={{ background: 'var(--sport-swim)' }} />
                  Schwimmen (3,8 km)
                </span>
                <span>
                  <i style={{ background: 'var(--sport-bike)' }} />
                  Rad (180 km)
                </span>
                <span>
                  <i style={{ background: 'var(--sport-run)' }} />
                  Marathon (42,2 km)
                </span>
                <span>
                  <i style={{ background: 'var(--sport-strength)' }} />
                  Wechsel (T1+T2)
                </span>
              </div>
            </div>
            <IronmanSplitsSection splits={plan.ironman_splits} />
          </div>

          {/* 3. 43-Wochen-Phasen & Progressive Overload */}
          <div className="ic-card">
            <div className="ic-card-head">
              <div>
                <h2 className="ic-h2">Trainingsphasen &amp; Progressive Overload</h2>
                <p className="ic-note">
                  Klick auf eine Phase zeigt die Wochenstruktur · Klick auf einen Wochenbalken öffnet die Woche im Detail-Drawer
                </p>
              </div>
              <div className="ic-seg" role="group" aria-label="Zeitraum Progressive Overload">
                <button
                  type="button"
                  aria-pressed={overloadView === 'saison'}
                  onClick={() => setOverloadView('saison')}
                >
                  Gesamte Saison
                </button>
                <button
                  type="button"
                  aria-pressed={overloadView === 'block'}
                  onClick={() => setOverloadView('block')}
                >
                  Aktiver Block (W44–W53)
                </button>
              </div>
            </div>

            {/* Phase Ribbon */}
            <div className="ic-phase-ribbon">
              {plan.phasen.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`ic-phase-btn ${p.status}`}
                  style={{ flex: `${Math.max(p.wochen, 4)} 1 0` }}
                  aria-pressed={selectedPhaseId === p.id}
                  onClick={() => setSelectedPhaseId(p.id)}
                >
                  <div className="ph-top">
                    <span>{p.wochen} Wo.</span>
                    <span>{p.status === 'aktiv' ? '● aktiv' : '◌ Leitplanke'}</span>
                  </div>
                  <div className="ph-name">{p.name}</div>
                  <div className="ph-vol">
                    {p.volumen_h} · CTL {p.ctl_ziel}
                  </div>
                </button>
              ))}
            </div>

            {/* Phase Detail Box */}
            {(() => {
              const sel = plan.phasen.find((p) => p.id === selectedPhaseId) || plan.phasen[0];
              if (!sel) return null;
              return (
                <div className="ic-phase-detail">
                  <div>
                    <h4>Ziel &amp; Fokus · {sel.name}</h4>
                    <p>{sel.fokus}</p>
                  </div>
                  <div>
                    <h4>Wochenstruktur (Alltag &amp; Wochenende)</h4>
                    <p>{sel.alltag_70h}</p>
                  </div>
                  <div>
                    <h4>
                      Intensität &amp; Progression (Volumen {sel.volumen_h} · CTL {sel.ctl_ziel})
                    </h4>
                    <p>{sel.intensitaet}</p>
                  </div>
                  <div>
                    <h4>Meilensteine ({sel.zeitraum})</h4>
                    <div className="ic-phase-pins">
                      {sel.meilensteine.map((m, i) => (
                        <span key={i}>{m}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{ marginTop: 16 }}>
              <div className="ic-chart-legend">
                <span>
                  <i style={{ background: 'var(--sport-run)' }} />
                  Lauf
                </span>
                <span>
                  <i style={{ background: 'var(--sport-bike)' }} />
                  Rad
                </span>
                <span>
                  <i style={{ background: 'var(--sport-swim)' }} />
                  Schwimmen
                </span>
                <span>
                  <i style={{ background: 'var(--sport-strength)' }} />
                  Kraft / Sonst
                </span>
                <span>
                  <i style={{ background: 'var(--color-fg)' }} />
                  Fitness-Kurve (CTL)
                </span>
              </div>
              <ProgressiveOverloadChart
                plan={plan}
                mode={overloadView}
                selectedPhaseNr={plan.phasen.find((p) => p.id === selectedPhaseId)?.nr || null}
                onSelectWeek={(woche) => openDrawer({ type: 'week', woche })}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------- Sub-Components

const TimeGridView: React.FC<{
  days: Date[];
  calIndex: {
    actsByDate: Map<string, Activity[]>;
    planByDate: Map<string, CalendarPlanItem[]>;
    fulfilledIds: Set<string>;
  };
  store: CockpitDataStore;
  onSelectDay: (iso: string) => void;
  onOpenActivity: (id: string) => void;
  onOpenPlanned: (p: CalendarPlanItem) => void;
}> = ({ days, calIndex, store, onSelectDay, onOpenActivity, onOpenPlanned }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const H0 = 5;
  const H1 = 23;
  const HPX = 42;
  const height = (H1 - H0) * HPX;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (6.5 - H0) * HPX;
    }
  }, [days.length]);

  const weekStartIso = toIso(mondayOf(days[0]));
  const weekItems = store.kalender.filter((r) => r.woche_start === weekStartIso);
  const weekDone = weekItems.filter((r) => r.status === 'erledigt').length;

  return (
    <div>
      {weekItems.length > 0 && (
        <div className="ic-week-banner">
          <span>
            <b>{weekItems[0].woche_titel}:</b> {weekDone} von {weekItems.length} Soll-Reizen erledigt
          </span>
          <span className="ic-ev-meta">
            Schraffiert Mo–Fr 08:30–18:30 Uhr = Kern-Arbeitszeit (keine Sessions) · Klick auf jeden Block öffnet Details/Briefing
          </span>
        </div>
      )}

      <div className="ic-tg-wrap">
        <div className={`ic-tg ${days.length === 1 ? 'one' : ''}`} style={{ ['--n' as any]: days.length }}>
          {/* Day Headers */}
          <div className="ic-tg-row ic-tg-head">
            <div />
            {days.map((d) => {
              const iso = toIso(d);
              const wd = (d.getUTCDay() + 6) % 7;
              const isToday = +d === TODAY_UTC;
              return (
                <div
                  key={iso}
                  className={isToday ? 'today' : ''}
                  onClick={() => onSelectDay(iso)}
                  title="Tagesansicht öffnen"
                >
                  {DAYS_MON_FIRST[wd]}
                  <b>{d.getUTCDate()}</b>
                </div>
              );
            })}
          </div>

          {/* All-day / unscheduled Soll-Reize row */}
          <div className="ic-tg-row ic-tg-allday">
            <div>Soll</div>
            {days.map((d) => {
              const iso = toIso(d);
              const unscheduled = (calIndex.planByDate.get(iso) || []).filter((p) => !p.zeit);
              return (
                <div key={iso}>
                  {unscheduled.map((p, idx) => (
                    <div
                      key={idx}
                      className={`ic-chip plan ic-click ${p.status === 'verfallen' ? 'verfallen' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenPlanned(p)}
                    >
                      <div className="ic-chip-top">
                        <span className="ic-dot" style={{ background: sportColor(p.sport) }} />
                        {p.titel}
                      </div>
                      <span className="ic-chip-sub">{p.details}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Hourly Grid */}
          <div className="ic-tg-scroll" ref={scrollRef}>
            <div className="ic-tg-row ic-tg-body">
              <div style={{ height }}>
                {Array.from({ length: H1 - H0 }, (_, i) => H0 + i + 1).map((hh) => (
                  <span key={hh} className="ic-tg-hlabel" style={{ top: (hh - H0) * HPX }}>
                    {String(hh).padStart(2, '0')}:00
                  </span>
                ))}
              </div>

              {days.map((d) => {
                const iso = toIso(d);
                const wd = (d.getUTCDay() + 6) % 7;
                const isWeekday = wd < 5;
                const list = (calIndex.actsByDate.get(iso) || []).filter((r) => r.start);
                const timedPlan = (calIndex.planByDate.get(iso) || []).filter((p) => p.zeit);

                const lanes: number[] = [];
                const placed = list.map((r) => {
                  const [h, m] = r.start.split(':').map(Number);
                  const s = Math.max(H0 * 60, Math.min(H1 * 60 - 20, h * 60 + m));
                  const e = Math.min(H1 * 60, s + Math.max(25, Number(r.dauer_gesamt_min) || Number(r.dauer_min) || 35));
                  let lane = lanes.findIndex((end) => end <= s);
                  if (lane < 0) {
                    lane = lanes.length;
                    lanes.push(e);
                  } else {
                    lanes[lane] = e;
                  }
                  return { r, s, e, lane };
                });

                return (
                  <div key={iso} style={{ height }}>
                    {/* Work Blocking Zone Mo-Fr 08:30 - 18:30 */}
                    {isWeekday && (
                      <div
                        className="ic-tg-workzone"
                        style={{
                          top: ((8.5 - H0) * HPX) + 'px',
                          height: ((18.5 - 8.5) * HPX) + 'px',
                        }}
                        title="Sperrzeit Arbeit (08:30–18:30 Uhr)"
                      />
                    )}

                    {Array.from({ length: H1 - H0 - 1 }, (_, i) => H0 + i + 1).map((hh) => (
                      <div key={hh} className="ic-tg-hour" style={{ top: (hh - H0) * HPX }} />
                    ))}

                    {/* Completed Activities */}
                    {placed.map(({ r, s, e, lane }) => {
                      const n = lanes.length;
                      const c = sportColor(r.sport);
                      const detail = store.einheitenById.get(String(r.id));
                      return (
                        <div
                          key={r.id}
                          className="ic-blk ic-click"
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpenActivity(r.id)}
                          style={{
                            top: ((s - H0 * 60) / 60) * HPX,
                            height: Math.max(22, ((e - s) / 60) * HPX - 2),
                            left: `calc(${(100 / n) * lane}% + 3px)`,
                            right: `calc(${100 - (100 / n) * (lane + 1)}% + 3px)`,
                            background: `color-mix(in oklab, ${c} 24%, var(--color-panel))`,
                            borderLeftColor: c,
                          }}
                        >
                          <b>
                            {calIndex.fulfilledIds.has(String(r.id)) ? '✓ ' : ''}
                            {r.titel}
                            {detail?.rpe != null ? ` · RPE ${detail.rpe}` : ''}
                          </b>
                          <span>
                            {r.start} · {num(r.dauer_min)} min · {r.reiz}
                          </span>
                          {r.distanz_km > 0 && (
                            <span>
                              {num(r.distanz_km, 1)} km{r.puls_avg ? ` · Ø ${r.puls_avg} bpm` : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Timed Planned Sessions (Clickable!) */}
                    {timedPlan.map((p, idx) => {
                      const [h, m] = p.zeit.split(':').map(Number);
                      const s = Math.max(H0 * 60, h * 60 + m);
                      const e = Math.min(H1 * 60, s + (Number(p.plan_dauer_min) || 60));
                      return (
                        <div
                          key={`plan-${idx}`}
                          className="ic-blk plan ic-click"
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpenPlanned(p)}
                          style={{
                            top: ((s - H0 * 60) / 60) * HPX,
                            height: Math.max(24, ((e - s) / 60) * HPX - 2),
                            borderLeftColor: sportColor(p.sport),
                          }}
                        >
                          <b>{p.titel} ↗</b>
                          <span>
                            {p.zeit} · {p.details}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MonthGridView: React.FC<{
  date: Date;
  calIndex: {
    actsByDate: Map<string, Activity[]>;
    planByDate: Map<string, CalendarPlanItem[]>;
    fulfilledIds: Set<string>;
  };
  onSelectDay: (iso: string) => void;
  onOpenActivity: (id: string) => void;
  onOpenPlanned: (p: CalendarPlanItem) => void;
}> = ({ date, calIndex, onSelectDay, onOpenActivity, onOpenPlanned }) => {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const month = first.getUTCMonth();
  const start = mondayOf(first);

  const weeks: Date[][] = [];
  for (let wk = 0; wk < 6; wk++) {
    const ws = addDays(start, wk * 7);
    if (wk > 3 && ws.getUTCMonth() !== month) break;
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(ws, i)));
  }

  return (
    <div className="ic-month">
      <div className="ic-month-row ic-month-head">
        {DAYS_MON_FIRST.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="ic-month-row">
          {week.map((d) => {
            const key = toIso(d);
            const isOther = d.getUTCMonth() !== month;
            const isToday = +d === TODAY_UTC;
            const acts = calIndex.actsByDate.get(key) || [];
            const plans = calIndex.planByDate.get(key) || [];

            return (
              <div
                key={key}
                className={`ic-mcell ${isOther ? 'other' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => onSelectDay(key)}
              >
                <span className="ic-mnum">{d.getUTCDate()}</span>
                {acts.slice(0, 3).map((r) => {
                  const c = sportColor(r.sport);
                  return (
                    <div
                      key={r.id}
                      className="ic-mev ic-click"
                      style={{ background: `color-mix(in oklab, ${c} 24%, var(--color-panel))` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenActivity(r.id);
                      }}
                    >
                      <span className="ic-dot" style={{ background: c, marginRight: 0 }} />
                      {r.start && <span className="t">{r.start}</span>}
                      <span>
                        {calIndex.fulfilledIds.has(String(r.id)) ? '✓ ' : ''}
                        {r.titel}
                      </span>
                    </div>
                  );
                })}
                {plans.slice(0, Math.max(0, 3 - acts.length)).map((p, idx) => {
                  const c = sportColor(p.sport);
                  return (
                    <div
                      key={`p-${idx}`}
                      className="ic-mev plan ic-click"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPlanned(p);
                      }}
                    >
                      <span className="ic-dot" style={{ background: c, marginRight: 0 }} />
                      {p.zeit && <span className="t">{p.zeit}</span>}
                      <span>{p.titel}</span>
                    </div>
                  );
                })}
                {acts.length + plans.length > 3 && (
                  <span className="ic-mmore">+{acts.length + plans.length - 3} weitere</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const BlockListView: React.FC<{
  store: CockpitDataStore;
  calIndex: {
    actsByDate: Map<string, Activity[]>;
    planByDate: Map<string, CalendarPlanItem[]>;
    fulfilledIds: Set<string>;
  };
  onOpenActivity: (id: string) => void;
  onOpenPlanned: (p: CalendarPlanItem) => void;
}> = ({ store, calIndex, onOpenActivity, onOpenPlanned }) => {
  const weeks = useMemo(() => d3.groups(store.kalender, (r) => r.woche), [store.kalender]);

  return (
    <div className="ic-events">
      {weeks.map(([woche, items]) => {
        const start = parseIso(items[0].woche_start) || new Date(TODAY_UTC);
        const done = items.filter((i) => i.status === 'erledigt').length;
        return (
          <div key={woche} className="ic-week">
            <div className="ic-week-head">
              <span className="ic-week-title">
                KW {kwOf(start)} · {items[0].woche_titel}
              </span>
              <span className="ic-ev-meta">
                {fmtDay(toIso(start))}–{fmtDay(toIso(addDays(start, 6)))} · {done} von {items.length} Soll-Reizen erledigt
              </span>
            </div>
            <div className="ic-days">
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDays(start, i);
                const key = toIso(day);
                const acts = calIndex.actsByDate.get(key) || [];
                const plans = calIndex.planByDate.get(key) || [];
                return (
                  <div
                    key={key}
                    className={`ic-day ${+day === TODAY_UTC ? 'today' : ''} ${!acts.length && !plans.length ? 'empty' : ''}`}
                  >
                    <div className="ic-day-label">
                      <span>{DAYS_MON_FIRST[i]}</span>
                      <span>{fmtDay(key)}</span>
                    </div>
                    {acts.map((r) => (
                      <div
                        key={r.id}
                        className="ic-chip ic-click"
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenActivity(r.id)}
                      >
                        <div className="ic-chip-top">
                          <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                          <span>{r.titel}</span>
                          {calIndex.fulfilledIds.has(String(r.id)) && <span className="ic-ok">✓</span>}
                        </div>
                        <span className="ic-chip-sub">
                          {r.start || ''} · {num(r.dauer_min)} min · {r.reiz}
                        </span>
                      </div>
                    ))}
                    {plans.map((p, idx) => (
                      <div
                        key={`p-${idx}`}
                        className={`ic-chip plan ic-click ${p.status === 'verfallen' ? 'verfallen' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenPlanned(p)}
                      >
                        <div className="ic-chip-top">
                          <span className="ic-dot" style={{ background: sportColor(p.sport) }} />
                          <span>{p.titel}</span>
                        </div>
                        <span className="ic-chip-sub">
                          {p.zeit ? `${p.zeit} · ` : ''}
                          {p.details}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const IntensityProgressionChart: React.FC<{
  blockWochen: any[];
  onSelectWeek: (woche: string) => void;
}> = ({ blockWochen, onSelectWeek }) => {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !blockWochen.length) return;
    box.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'ic-chart ic-chart-clickable';
    wrap.style.minHeight = '185px';
    const tip = document.createElement('div');
    tip.className = 'ic-tip';
    tip.hidden = true;
    wrap.appendChild(tip);

    const w = 780;
    const h = 185;
    const m = { t: 16, r: 20, b: 28, l: 44 };
    const svg = d3
      .select(wrap)
      .append('svg')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .attr('role', 'img')
      .attr('aria-label', 'Intensitätsverteilung pro Woche im Block');

    const x = d3
      .scaleBand<string>()
      .domain(blockWochen.map((b) => b.woche))
      .range([m.l, w - m.r])
      .padding(0.28);
    const maxM = Math.max(420, (d3.max(blockWochen, (b) => b.lit_min + b.z4_min + b.z5_min) || 300) + 25);
    const y = d3.scaleLinear().domain([0, maxM]).nice().range([h - m.b, m.t]);

    svg
      .append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(y.ticks(4))
      .join('line')
      .attr('x1', m.l)
      .attr('x2', w - m.r)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => `${d} m` as any)
          .tickSize(0)
          .tickPadding(6)
      );

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(
        d3
          .axisBottom(x)
          .tickFormat((wk) => {
            const b = blockWochen.find((q) => q.woche === wk);
            return b ? `${wk.slice(5)} · ${b.phase}` : wk;
          })
          .tickSize(0)
          .tickPadding(8)
      );

    const keys = ['lit_min', 'z4_min', 'z5_min'];
    const cols = ['var(--color-ok)', 'var(--color-warn)', 'var(--color-bad)'];
    d3.stack<any>().keys(keys)(blockWochen).forEach((layer, idx) => {
      svg
        .append('g')
        .selectAll('rect')
        .data(layer)
        .join('rect')
        .attr('x', (p) => x(p.data.woche) ?? 0)
        .attr('width', x.bandwidth())
        .attr('y', (p) => y(p[1]))
        .attr('height', (p) => Math.max(0, y(p[0]) - y(p[1])))
        .attr('rx', 2)
        .attr('fill', cols[idx])
        .attr('fill-opacity', 0.88);
    });

    blockWochen.forEach((b) => {
      const tot = b.lit_min + b.z4_min + b.z5_min;
      const pct = tot ? Math.round((100 * b.lit_min) / tot) : 0;
      svg
        .append('text')
        .attr('x', (x(b.woche) ?? 0) + x.bandwidth() / 2)
        .attr('y', y(tot) - 5)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('font-weight', 600)
        .attr('fill', 'var(--color-fg-muted)')
        .text(`${pct}% LIT`);
    });

    const rule = svg.append('line').attr('class', 'rule').attr('y1', m.t).attr('y2', h - m.b).style('opacity', 0);
    svg
      .append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', w - m.l - m.r)
      .attr('height', h - m.t - m.b)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        let best = blockWochen[0];
        let bd = Infinity;
        blockWochen.forEach((b) => {
          const d = Math.abs((x(b.woche) ?? 0) + x.bandwidth() / 2 - mx);
          if (d < bd) {
            bd = d;
            best = b;
          }
        });
        const px = (x(best.woche) ?? 0) + x.bandwidth() / 2;
        rule.attr('x1', px).attr('x2', px).style('opacity', 1);
        tip.replaceChildren();
        const bEl = document.createElement('b');
        bEl.textContent = `${best.woche} – ${best.titel}`;
        const s1 = document.createElement('span');
        s1.textContent = `LIT: ${best.lit_min} min · Z4: ${best.z4_min} min · Z5: ${best.z5_min} min`;
        const s2 = document.createElement('span');
        s2.textContent = `Harte Reize: ${best.harte_reize} · Quali-Lauf: ${num(best.quali_lauf_km, 1)} km`;
        const sh = document.createElement('span');
        sh.className = 'ic-tip-hint';
        sh.textContent = '↗ Klicken für Wochen-Details';
        tip.append(bEl, s1, s2, sh);
        tip.hidden = false;
        const scale = wrap.clientWidth / w;
        tip.style.left = Math.min(px * scale + 12, Math.max(4, wrap.clientWidth - tip.offsetWidth - 4)) + 'px';
        tip.style.top = '4px';
      })
      .on('click', (event) => {
        const [mx] = d3.pointer(event);
        let best = blockWochen[0];
        let bd = Infinity;
        blockWochen.forEach((b) => {
          const d = Math.abs((x(b.woche) ?? 0) + x.bandwidth() / 2 - mx);
          if (d < bd) {
            bd = d;
            best = b;
          }
        });
        if (best) onSelectWeek(best.woche);
      })
      .on('pointerleave', () => {
        tip.hidden = true;
        rule.style('opacity', 0);
      });

    box.appendChild(wrap);
  }, [blockWochen, onSelectWeek]);

  return (
    <div>
      <div ref={boxRef} />
      <div className="ic-ladder">
        {blockWochen.map((b) => {
          const keysRun = b.items
            .filter((it: any) => it.sport === 'Lauf' && it.hart)
            .map((it: any) => it.titel)
            .join(' + ');
          return (
            <div
              key={b.woche}
              className="ic-lad-step ic-click"
              role="button"
              tabIndex={0}
              onClick={() => onSelectWeek(b.woche)}
            >
              <span className="lad-q">
                {b.woche.slice(5)} · {b.phase}
              </span>
              <b>{keysRun || 'Locker / Taper'}</b>
              <span className="lad-q">
                {num(b.km_lauf, 0)} km Lauf · {b.harte_reize} hart ↗
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CoachRadarSection: React.FC<{ plan: any; radarId: string }> = ({ plan, radarId }) => {
  const radarBoxRef = useRef<HTMLDivElement>(null);
  const prof = plan.radar.find((r: any) => r.id === radarId) || plan.radar[0];

  useEffect(() => {
    const left = radarBoxRef.current;
    if (!left || !prof) return;
    left.replaceChildren();

    const tip = document.createElement('div');
    tip.className = 'ic-tip';
    tip.hidden = true;
    left.appendChild(tip);

    const size = 360;
    const cx = size / 2;
    const cy = size / 2;
    const R = 115;
    const axes = prof.achsen;
    const N = axes.length;
    const ang = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2;
    const pt = (i: number, val: number) => [
      cx + ((R * val) / 100) * Math.cos(ang(i)),
      cy + ((R * val) / 100) * Math.sin(ang(i)),
    ];

    const svg = d3
      .select(left)
      .append('svg')
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('role', 'img')
      .attr('aria-label', prof.titel);

    [25, 50, 75, 100].forEach((rv) => {
      const pts = axes.map((_: any, i: number) => pt(i, rv).join(',')).join(' ');
      svg
        .append('polygon')
        .attr('points', pts)
        .attr('fill', 'none')
        .attr('stroke', 'var(--cds-chart-grid)')
        .attr('stroke-width', rv === 100 ? 1.3 : 1);
      svg
        .append('text')
        .attr('x', cx)
        .attr('y', cy - (R * rv) / 100 + 11)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9.5)
        .attr('fill', 'var(--cds-text-secondary)')
        .text(rv);
    });

    axes.forEach((a: any, i: number) => {
      const [x2, y2] = pt(i, 100);
      svg
        .append('line')
        .attr('x1', cx)
        .attr('y1', cy)
        .attr('x2', x2)
        .attr('y2', y2)
        .attr('stroke', 'var(--cds-chart-grid)')
        .attr('stroke-width', 1);
      const [lx, ly] = pt(i, 123);
      const anc = Math.abs(lx - cx) < 12 ? 'middle' : lx > cx ? 'start' : 'end';
      svg
        .append('text')
        .attr('x', lx)
        .attr('y', ly + 4)
        .attr('text-anchor', anc)
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .attr('fill', 'var(--color-fg)')
        .text(a.name);
    });

    const series = [
      { key: 'ziel', color: '#ef4444', fillOp: 0.08, dash: '5 3', w: 1.8 },
      { key: 'proj', color: '#22c55e', fillOp: 0.14, dash: '', w: 2.1 },
      { key: 'ist', color: '#3b82f6', fillOp: 0.22, dash: '', w: 2.5 },
    ];

    series.forEach((s) => {
      const pts = axes.map((a: any, i: number) => pt(i, a[s.key]).join(',')).join(' ');
      svg
        .append('polygon')
        .attr('points', pts)
        .attr('fill', s.color)
        .attr('fill-opacity', s.fillOp)
        .attr('stroke', s.color)
        .attr('stroke-width', s.w)
        .attr('stroke-dasharray', s.dash || null);
      axes.forEach((a: any, i: number) => {
        const [px, py] = pt(i, a[s.key]);
        svg
          .append('circle')
          .attr('cx', px)
          .attr('cy', py)
          .attr('r', 4.5)
          .attr('fill', s.color)
          .attr('stroke', 'var(--color-panel)')
          .attr('stroke-width', 1.2)
          .style('cursor', 'pointer')
          .on('pointerenter', () => {
            tip.replaceChildren();
            const b = document.createElement('b');
            b.textContent = `${a.name} (${a.einheit})`;
            const s1 = document.createElement('span');
            s1.textContent = `Heute: ${a.ist}/100`;
            const s2 = document.createElement('span');
            s2.textContent = `Projektion: ${a.proj}/100`;
            const s3 = document.createElement('span');
            s3.textContent = `Ziel: ${a.ziel}/100`;
            tip.append(b, s1, s2, s3);
            tip.hidden = false;
            tip.style.left = Math.min(Math.max(px - 60, 4), size - 150) + 'px';
            tip.style.top = Math.max(py - 68, 4) + 'px';
          })
          .on('pointerleave', () => {
            tip.hidden = true;
          });
      });
    });
  }, [prof]);

  if (!prof) return null;

  return (
    <div className="ic-radar-grid">
      <div className="ic-radar-box" ref={radarBoxRef} />
      <div className="ic-diag-list">
        <div className="ic-compass-meta">{prof.untertitel}</div>
        <div className="ic-diag-item bad">
          <h4>Schwäche / Limiter</h4>
          <p>{prof.diagnose.schwaeche}</p>
        </div>
        <div className="ic-diag-item warn">
          <h4>Größter Hebel</h4>
          <p>{prof.diagnose.hebel}</p>
        </div>
        <div className="ic-diag-item ok">
          <h4>Stärke / Fundament</h4>
          <p>{prof.diagnose.staerke}</p>
        </div>
        <div className="ic-diag-foot">Datenbasis: {prof.datenbasis}</div>
      </div>
    </div>
  );
};

const IronmanSplitsSection: React.FC<{ splits: any }> = ({ splits }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const rows = splits?.szenarien || [];

  useEffect(() => {
    const box = chartRef.current;
    if (!box || !rows.length) return;
    box.replaceChildren();

    const w = 780;
    const h = 152;
    const m = { t: 18, r: 96, b: 26, l: 175 };
    const svg = d3
      .select(box)
      .append('svg')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .attr('role', 'img')
      .attr('aria-label', 'Ironman Split-Vergleich');

    const maxMin = Math.max(730, (d3.max(rows, (r: any) => Number(r.gesamt_min)) || 700) + 15);
    const x = d3.scaleLinear().domain([0, maxMin]).range([m.l, w - m.r]);
    const y = d3
      .scaleBand<string>()
      .domain(rows.map((r: any) => r.label))
      .range([m.t, h - m.b])
      .padding(0.28);

    const ticks = [0, 120, 240, 360, 480, 600, 660, 720];
    svg
      .append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(ticks)
      .join('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', m.t)
      .attr('y2', h - m.b);

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(ticks)
          .tickFormat((d) => `${Number(d) / 60} h` as any)
          .tickSize(0)
          .tickPadding(6)
      );

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).tickSize(0).tickPadding(8));

    svg
      .append('line')
      .attr('x1', x(660))
      .attr('x2', x(660))
      .attr('y1', m.t - 6)
      .attr('y2', h - m.b)
      .attr('stroke', 'var(--color-warn)')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '4 3');
    svg
      .append('text')
      .attr('x', x(660))
      .attr('y', m.t - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10.5)
      .attr('font-weight', 700)
      .attr('fill', 'var(--color-warn)')
      .text('11:00 h');

    const segDefs: [string, string][] = [
      ['swim', 'var(--sport-swim)'],
      ['t1', 'var(--sport-strength)'],
      ['bike', 'var(--sport-bike)'],
      ['t2', 'var(--sport-strength)'],
      ['run', 'var(--sport-run)'],
    ];

    rows.forEach((r: any) => {
      let acc = 0;
      const ry = y(r.label) ?? 0;
      const bh = y.bandwidth();
      segDefs.forEach(([k, color]) => {
        const seg = r.splits[k];
        const x0 = x(acc);
        const bw = Math.max(0, x(acc + seg.min) - x0);
        acc += seg.min;
        svg
          .append('rect')
          .attr('x', x0)
          .attr('y', ry)
          .attr('width', bw)
          .attr('height', bh)
          .attr('fill', color)
          .attr('fill-opacity', r.id === 'ziel' ? 0.65 : 0.92)
          .attr('rx', 2);
        if (bw > 44) {
          svg
            .append('text')
            .attr('x', x0 + bw / 2)
            .attr('y', ry + bh / 2 + 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', 11)
            .attr('font-weight', 600)
            .attr('fill', '#ffffff')
            .text(seg.text);
        }
      });
      const colTxt =
        r.bewertung === 'ok' ? 'var(--color-ok)' : r.bewertung === 'bad' ? 'var(--color-bad)' : 'var(--color-fg)';
      svg
        .append('text')
        .attr('x', x(r.gesamt_min) + 8)
        .attr('y', ry + bh / 2 + 4)
        .attr('font-size', 12.5)
        .attr('font-weight', 700)
        .attr('fill', colTxt)
        .text(r.gesamt_text);
    });
  }, [rows]);

  return (
    <div>
      <div className="ic-chart" style={{ minHeight: 152 }} ref={chartRef} />
      <div className="ic-scroll" style={{ marginTop: 10 }}>
        <table className="ic-table">
          <thead>
            <tr>
              <th>Szenario</th>
              <th>Schwimmen (3,8 km)</th>
              <th>Rad (180 km)</th>
              <th>Marathon (42,2 km)</th>
              <th>Wechsel</th>
              <th className="num">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <b>{r.label}</b>
                </td>
                <td>
                  <b>{r.splits.swim.text}</b> <span className="ic-ev-meta">{r.splits.swim.detail}</span>
                </td>
                <td>
                  <b>{r.splits.bike.text}</b> <span className="ic-ev-meta">{r.splits.bike.detail}</span>
                </td>
                <td>
                  <b>{r.splits.run.text}</b> <span className="ic-ev-meta">{r.splits.run.detail}</span>
                </td>
                <td>
                  {r.splits.t1.text} + {r.splits.t2.text}
                </td>
                <td className="num">
                  <b>{r.gesamt_text}</b>
                  <div className="ic-ev-meta">{r.spanne}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ProgressiveOverloadChart: React.FC<{
  plan: any;
  mode: 'saison' | 'block';
  selectedPhaseNr: number | null;
  onSelectWeek: (woche: string) => void;
}> = ({ plan, mode, selectedPhaseNr, onSelectWeek }) => {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.replaceChildren();

    const rows =
      mode === 'block'
        ? [...(plan.ist_wochen || []), ...(plan.makro_wochen || []).filter((w: any) => w.typ === 'aktiv')]
        : [...(plan.ist_wochen || []), ...(plan.makro_wochen || [])];

    const wrap = document.createElement('div');
    wrap.className = 'ic-chart ic-chart-clickable';
    const tip = document.createElement('div');
    tip.className = 'ic-tip';
    tip.hidden = true;
    wrap.appendChild(tip);

    const w = 820;
    const h = 270;
    const m = { t: 24, r: 44, b: 34, l: 38 };
    const svg = d3
      .select(wrap)
      .append('svg')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .attr('role', 'img')
      .attr('aria-label', 'Progressive Overload Volumen und CTL');

    const x = d3
      .scaleBand<string>()
      .domain(rows.map((r: any) => r.woche))
      .range([m.l, w - m.r])
      .padding(mode === 'block' ? 0.24 : 0.18);
    const maxH = Math.max(mode === 'block' ? 8 : 16, (d3.max(rows, (r: any) => Number(r.h_gesamt)) || 10) + 1);
    const y = d3.scaleLinear().domain([0, maxH]).nice().range([h - m.b, m.t]);
    const maxCtl = Math.max(mode === 'block' ? 55 : 98, (d3.max(rows, (r: any) => Number(r.ctl)) || 60) + 6);
    const yCtl = d3.scaleLinear().domain([20, maxCtl]).range([h - m.b, m.t]);

    svg
      .append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(y.ticks(5))
      .join('line')
      .attr('x1', m.l)
      .attr('x2', w - m.r)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((d) => `${d}h` as any)
          .tickSize(0)
          .tickPadding(6)
      );

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${w - m.r},0)`)
      .call(
        d3
          .axisRight(yCtl)
          .ticks(5)
          .tickFormat((d) => `CTL ${d}` as any)
          .tickSize(0)
          .tickPadding(6)
      );

    const step = mode === 'block' ? 1 : 4;
    const tickVals = rows.filter((_: any, i: number) => i % step === 0 || i === rows.length - 1).map((r: any) => r.woche);
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(tickVals)
          .tickFormat((wk) => {
            const r = rows.find((q: any) => q.woche === wk);
            return r ? fmtDay(r.start) : wk;
          })
          .tickSize(0)
          .tickPadding(8)
      );

    const firstPlan = rows.find((r: any) => r.typ !== 'ist');
    if (firstPlan) {
      const px = (x(firstPlan.woche) ?? 0) - (x.step() * x.padding()) / 2;
      svg
        .append('line')
        .attr('x1', px)
        .attr('x2', px)
        .attr('y1', m.t)
        .attr('y2', h - m.b)
        .attr('stroke', 'var(--color-fg-muted)')
        .attr('stroke-dasharray', '3 3');
      svg
        .append('text')
        .attr('x', px + 4)
        .attr('y', m.t + 10)
        .attr('font-size', 9.5)
        .attr('fill', 'var(--color-fg-muted)')
        .text('ab hier Plan →');
    }

    const keys = ['h_lauf', 'h_rad', 'h_schwimmen', 'h_sonst'];
    const colors = ['var(--sport-run)', 'var(--sport-bike)', 'var(--sport-swim)', 'var(--sport-strength)'];
    d3.stack<any>().keys(keys)(rows).forEach((layer, idx) => {
      svg
        .append('g')
        .selectAll('rect')
        .data(layer)
        .join('rect')
        .attr('x', (p) => x(p.data.woche) ?? 0)
        .attr('width', x.bandwidth())
        .attr('y', (p) => y(p[1]))
        .attr('height', (p) => Math.max(0, y(p[0]) - y(p[1])))
        .attr('fill', colors[idx])
        .attr('fill-opacity', (p) => {
          if (selectedPhaseNr && p.data.phase && p.data.phase !== selectedPhaseNr && mode === 'saison') return 0.25;
          return p.data.deload ? 0.45 : p.data.typ === 'leitplanke' ? 0.72 : 0.95;
        });
    });

    const line = d3
      .line<any>()
      .x((r) => (x(r.woche) ?? 0) + x.bandwidth() / 2)
      .y((r) => yCtl(r.ctl));
    svg
      .append('path')
      .datum(rows)
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-fg)')
      .attr('stroke-width', 2.2)
      .attr('d', line);

    rows
      .filter((r: any) => r.pin)
      .forEach((r: any) => {
        const cx = (x(r.woche) ?? 0) + x.bandwidth() / 2;
        svg
          .append('circle')
          .attr('cx', cx)
          .attr('cy', yCtl(r.ctl))
          .attr('r', 3.8)
          .attr('fill', 'var(--color-warn)')
          .attr('stroke', 'var(--color-panel)')
          .attr('stroke-width', 1.2);
        svg
          .append('text')
          .attr('x', cx)
          .attr('y', m.t - 6)
          .attr('text-anchor', 'middle')
          .attr('font-size', 9.5)
          .attr('font-weight', 700)
          .attr('fill', 'var(--color-warn)')
          .text(r.pin);
      });

    const rule = svg.append('line').attr('class', 'rule').attr('y1', m.t).attr('y2', h - m.b).style('opacity', 0);
    svg
      .append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', w - m.l - m.r)
      .attr('height', h - m.t - m.b)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        let best = rows[0];
        let bd = Infinity;
        rows.forEach((r: any) => {
          const d = Math.abs((x(r.woche) ?? 0) + x.bandwidth() / 2 - mx);
          if (d < bd) {
            bd = d;
            best = r;
          }
        });
        const px = (x(best.woche) ?? 0) + x.bandwidth() / 2;
        rule.attr('x1', px).attr('x2', px).style('opacity', 1);
        const tag =
          best.typ === 'ist'
            ? 'IST'
            : best.deload
            ? 'DELOAD/TAPER'
            : best.typ === 'aktiv'
            ? 'AKTIV GEPLANT'
            : 'LEITPLANKE';
        tip.replaceChildren();
        const b = document.createElement('b');
        b.textContent = `${best.woche} (ab ${fmtDay(best.start)}) · ${tag}`;
        const s1 = document.createElement('span');
        s1.textContent = `Gesamt: ${num(best.h_gesamt, 1)} h · CTL: ${num(best.ctl, 0)}`;
        const s2 = document.createElement('span');
        s2.textContent = `Lauf ${num(best.h_lauf, 1)} h · Rad ${num(best.h_rad, 1)} h · Swim ${num(best.h_schwimmen, 1)} h · Kraft ${num(best.h_sonst, 1)} h`;
        const s3 = document.createElement('span');
        s3.textContent = best.fokus || '';
        const sh = document.createElement('span');
        sh.className = 'ic-tip-hint';
        sh.textContent = '↗ Klicken für Wochen-Details';
        tip.append(b, s1, s2, s3, sh);
        tip.hidden = false;
        const scale = wrap.clientWidth / w;
        tip.style.left = Math.min(px * scale + 12, Math.max(4, wrap.clientWidth - tip.offsetWidth - 4)) + 'px';
        tip.style.top = '4px';
      })
      .on('click', (event) => {
        const [mx] = d3.pointer(event);
        let best = rows[0];
        let bd = Infinity;
        rows.forEach((r: any) => {
          const d = Math.abs((x(r.woche) ?? 0) + x.bandwidth() / 2 - mx);
          if (d < bd) {
            bd = d;
            best = r;
          }
        });
        if (best) onSelectWeek(best.woche);
      })
      .on('pointerleave', () => {
        tip.hidden = true;
        rule.style('opacity', 0);
      });

    box.appendChild(wrap);
  }, [plan, mode, selectedPhaseNr, onSelectWeek]);

  return <div ref={boxRef} />;
};
