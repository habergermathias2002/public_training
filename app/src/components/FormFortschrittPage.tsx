import React, { useEffect, useMemo, useState } from 'react';
import { CockpitDataStore } from '../data/useCockpitData';
import { DrawerState, KPI } from '../types';
import {
  addDays,
  daysTo,
  fmtDate,
  fmtDay,
  fmtPace,
  mondayOf,
  num,
  statusLevel,
  TODAY_ISO,
  TODAY_UTC,
  toIso,
} from '../utils/format';
import { D3Chart } from './D3Chart';

interface FormFortschrittPageProps {
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
  focusSection?: string | null;
}

export const FormFortschrittPage: React.FC<FormFortschrittPageProps> = ({
  store,
  openDrawer,
  focusSection,
}) => {
  const [kpiFilter, setKpiFilter] = useState<'all' | 'recovery' | 'load' | 'eff'>('all');
  const [fitRange, setFitRange] = useState<number>(120);
  const [effRange, setEffRange] = useState<number>(365);
  const [highlightedCard, setHighlightedCard] = useState<string | null>(null);

  const scrollToCard = (cardId: string) => {
    const el = document.getElementById(cardId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedCard(cardId);
      setTimeout(() => setHighlightedCard((prev) => (prev === cardId ? null : prev)), 2200);
    }
  };

  useEffect(() => {
    if (!focusSection) return;
    const map: Record<string, string> = {
      fitness: 'card-pmc',
      form: 'card-pmc',
      stunden: 'card-wochen',
      lauf_km: 'card-wochen',
      harte_reize: 'card-wochen',
      schwimmen: 'card-wochen',
      ruhepuls: 'card-ruhepuls',
      schlaf: 'card-schlaf',
      locker: 'card-eff',
      tempo145: 'card-eff',
      drift: 'card-drift',
      vo2max: 'card-vo2',
      ftp_builder: 'card-ftp',
    };
    const target = map[focusSection];
    if (target) setTimeout(() => scrollToCard(target), 80);
  }, [focusSection]);

  // Combine dashboard KPIs + unique fortschritt KPIs without duplication
  const unifiedKpis = useMemo(() => {
    const list: (KPI & { cluster: 'recovery' | 'load' | 'eff'; targetCard?: string })[] = [];
    const recoveryIds = new Set(['tagesform', 'ruhepuls', 'schlaf', 'form']);
    const loadIds = new Set(['fitness', 'stunden', 'harte_reize', 'lauf_km', 'schwimmen', 'laengster', 'ftp_builder']);

    for (const k of store.kpis) {
      const cluster = recoveryIds.has(k.id) ? 'recovery' : loadIds.has(k.id) ? 'load' : 'eff';
      list.push({ ...k, cluster });
    }
    for (const fk of store.fortschrittKpis) {
      if (!list.some((x) => x.id === fk.id)) {
        list.push({ ...fk, cluster: 'eff' });
      }
    }
    return list;
  }, [store.kpis, store.fortschrittKpis]);

  const visibleKpis = useMemo(
    () => (kpiFilter === 'all' ? unifiedKpis : unifiedKpis.filter((k) => k.cluster === kpiFilter)),
    [unifiedKpis, kpiFilter]
  );

  const handleKpiClick = (k: KPI) => {
    if (k.id === 'tagesform') {
      openDrawer({ type: 'readiness', datum: TODAY_ISO });
      return;
    }
    if (k.id === 'laengster') {
      // Find longest run in last 30 days
      const runs30 = store.aktivitaeten.filter((r) => r.sport === 'Lauf' && -daysTo(r.datum) <= 30);
      if (runs30.length) {
        const longest = [...runs30].sort((a, b) => b.dauer_min - a.dauer_min)[0];
        openDrawer({ type: 'activity', id: longest.id });
        return;
      }
    }
    if (k.id === 'best_lauf_5k') {
      const bw = store.bestwerte.find((b) => b.id === 'lauf_5k');
      if (bw?.jetzt_id || bw?.gesamt_id) {
        openDrawer({ type: 'activity', id: String(bw.jetzt_id || bw.gesamt_id) });
        return;
      }
      scrollToCard('card-best');
      return;
    }
    if (k.id === 'best_rad_20') {
      const bw = store.bestwerte.find((b) => b.id === 'rad_20');
      if (bw?.jetzt_id || bw?.gesamt_id) {
        openDrawer({ type: 'activity', id: String(bw.jetzt_id || bw.gesamt_id) });
        return;
      }
      scrollToCard('card-best');
      return;
    }
    const targetMap: Record<string, string> = {
      fitness: 'card-pmc',
      form: 'card-pmc',
      stunden: 'card-wochen',
      harte_reize: 'card-wochen',
      lauf_km: 'card-wochen',
      schwimmen: 'card-wochen',
      ruhepuls: 'card-ruhepuls',
      schlaf: 'card-schlaf',
      locker: 'card-eff',
      tempo145: 'card-eff',
      drift: 'card-drift',
      vo2max: 'card-vo2',
      ftp_builder: 'card-ftp',
    };
    if (targetMap[k.id]) scrollToCard(targetMap[k.id]);
  };

  // Chart data slices
  const pmcRows = useMemo(
    () => (fitRange > 0 ? store.tage.slice(-fitRange) : store.tage),
    [store.tage, fitRange]
  );

  const wochenRows = useMemo(() => {
    const byStart = new Map(store.wochen.map((r) => [r.start, r]));
    const mon = mondayOf(TODAY_UTC);
    const out = [];
    for (let i = 19; i >= 0; i--) {
      const s = toIso(addDays(mon, -7 * i));
      const existing = byStart.get(s);
      out.push(
        existing || {
          woche: s,
          start: s,
          h_lauf: 0,
          h_rad: 0,
          h_schwimmen: 0,
          h_sonst: 0,
          h_gesamt: 0,
          km_lauf: 0,
          last: 0,
          harte_reize: 0,
          schwimm_einheiten: 0,
          lauf_locker_anteil: null,
        }
      );
    }
    return out;
  }, [store.wochen]);

  const effRows = useMemo(
    () => (effRange > 0 ? store.effizienz.filter((r) => -daysTo(r.datum) <= effRange) : store.effizienz),
    [store.effizienz, effRange]
  );

  const driftRows = useMemo(
    () => store.drift.filter((r) => r.sport === 'Lauf' && -daysTo(r.datum) <= 540),
    [store.drift]
  );

  const nextFtpNr = useMemo(
    () => store.ftpBuilder.find((p) => p.status === 'offen')?.nr || null,
    [store.ftpBuilder]
  );

  return (
    <section className="ic-page" id="form">
      <header className="ic-page-head" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Form &amp; Fortschritt</h1>
          <p className="ic-lede">
            Belastungssteuerung (CTL/ATL/TSB), aerobe Effizienz (LT1 / Drift), Leistungsmarker &amp; Zwift FTP Builder · Alle Punkte &amp; Kacheln sind klickbar
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="ic-seg" role="group" aria-label="KPI-Cluster">
            {(
              [
                ['all', `Alle (${unifiedKpis.length})`],
                ['recovery', 'Recovery & Readiness'],
                ['load', 'Last & Volumen'],
                ['eff', 'Effizienz & Progression'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={kpiFilter === id} onClick={() => setKpiFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ic-btn ic-btn-accent"
            onClick={() => openDrawer({ type: 'readiness', datum: TODAY_ISO })}
          >
            + Tagesform Check-in
          </button>
        </div>
      </header>

      {/* High-Density Clickable KPI Matrix */}
      <div className="ic-tiles">
        {visibleKpis.map((r) => (
          <div
            key={r.id}
            className={`ic-tile ic-${r.bewertung} ic-click`}
            role="button"
            tabIndex={0}
            onClick={() => handleKpiClick(r)}
            onKeyDown={(e) => e.key === 'Enter' && handleKpiClick(r)}
            title={`${r.fenster ? r.fenster + ' · ' : ''}${r.hinweis || 'Klicken für Details'}`}
          >
            <div className="ic-tile-label">
              <i />
              <span style={{ flex: 1 }}>{r.kpi}</span>
              <span className="ic-tile-arrow">↗</span>
            </div>
            <div className="ic-tile-value">
              <span className={r.id === 'tagesform' ? 'ic-ampel' : ''}>{r.wert_text}</span>
              {r.einheit && <span className="ic-unit">{r.einheit}</span>}
            </div>
            <div className="ic-tile-cmp">{r.vergleich}</div>
          </div>
        ))}
      </div>

      {/* SECTION 1: PMC (Fitness, Ermüdung, Form) */}
      <div className={`ic-card ${highlightedCard === 'card-pmc' ? 'ic-card-highlight' : ''}`} id="card-pmc">
        <div className="ic-card-head">
          <div>
            <h2 className="ic-h2">Performance Management Chart: Fitness (CTL), Ermüdung (ATL) &amp; Form (TSB)</h2>
            <p className="ic-note">
              CTL = 42-Tage-Last · ATL = 7-Tage-Last · TSB = Differenz · Klick auf einen Tag öffnet Tages-Details &amp; Einheiten
            </p>
          </div>
          <div className="ic-card-tools">
            <div className="ic-chart-legend" style={{ marginBottom: 0 }}>
              <span>
                <i style={{ background: 'var(--c0)' }} />
                Fitness (CTL)
              </span>
              <span>
                <i style={{ background: 'var(--c1)' }} />
                Ermüdung (ATL)
              </span>
              <span>
                <i style={{ background: 'var(--c2)' }} />
                Form (TSB)
              </span>
            </div>
            <div className="ic-seg" role="group" aria-label="PMC Zeitraum">
              {(
                [
                  [90, '3M'],
                  [180, '6M'],
                  [365, '12M'],
                  [0, 'Alle'],
                ] as const
              ).map(([val, label]) => (
                <button key={val} type="button" aria-pressed={fitRange === val} onClick={() => setFitRange(val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <D3Chart
          rows={pmcRows}
          xKey="datum"
          label="Fitness, Ermüdung und Form über die Zeit"
          height={250}
          include={[0]}
          series={[
            { key: 'fitness_ctl', label: 'Fitness (CTL)', color: 'var(--c0)', width: 2.4, digits: 1 },
            { key: 'ermuedung_atl', label: 'Ermüdung (ATL)', color: 'var(--c1)', width: 1.5, digits: 1 },
            { key: 'form_tsb', label: 'Form (TSB)', color: 'var(--c2)', width: 1.8, digits: 1 },
          ]}
          tipExtra={(r) => (r.last ? `Tageslast: ${num(r.last, 1)} · RP: ${r.ruhepuls ?? '–'} bpm` : null)}
          clickHint="Tag & Einheiten im Drawer öffnen"
          onPointClick={(r) => openDrawer({ type: 'day', datum: r.datum })}
        />
      </div>

      {/* SECTION 2: Aerobe Effizienz & LIT-Drift (2-Column) */}
      <div className="ic-grid2">
        <div className={`ic-card ${highlightedCard === 'card-eff' ? 'ic-card-highlight' : ''}`} id="card-eff">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">Lauf-Effizienz: Tempo bei Puls 145 (LT1)</h2>
              <p className="ic-note">Lockere flache Läufe (30–90 min), normiert auf 145 bpm · Klick auf Punkt öffnet Lauf</p>
            </div>
            <div className="ic-seg" role="group" aria-label="Effizienz Zeitraum">
              <button type="button" aria-pressed={effRange === 365} onClick={() => setEffRange(365)}>
                12M
              </button>
              <button type="button" aria-pressed={effRange === 0} onClick={() => setEffRange(0)}>
                Seit 2024
              </button>
            </div>
          </div>
          <div className="ic-chart-legend">
            <span>
              <i style={{ background: 'var(--sport-run)' }} />
              Trend (4-Wochen-Median)
            </span>
            <span>
              <i style={{ background: 'var(--sport-run)', opacity: 0.5 }} />
              Einzelner Lauf (klickbar)
            </span>
          </div>
          <D3Chart
            rows={effRows}
            xKey="datum"
            label="Tempo bei Puls 145 je lockerem Lauf"
            height={230}
            invert={true}
            yFormat={fmtPace}
            series={[
              { key: 'tempo145_s', label: 'Tempo @ 145 bpm', color: 'var(--sport-run)', dots: true, r: 4.2, opacity: 0.65, fmt: fmtPace, unit: '/km' },
              { key: 'trend145_s', label: '4-Wochen-Trend', color: 'var(--sport-run)', width: 2.4, fmt: fmtPace, unit: '/km' },
            ]}
            tipExtra={(r) => `Ist-Tempo: ${r.tempo_text}/km @ Ø ${r.puls} bpm (${num(r.dauer_min)} min)`}
            clickHint="Laufeinheit im Drawer öffnen"
            onPointClick={(r) => r.id && openDrawer({ type: 'activity', id: String(r.id) })}
          />
        </div>

        <div className={`ic-card ${highlightedCard === 'card-drift' ? 'ic-card-highlight' : ''}`} id="card-drift">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">Pulsdrift LIT-Läufe (≥ 45 min)</h2>
              <p className="ic-note">Aerobic Decoupling (2. vs. 1. Hälfte) · Unter 5 % (gestrichelt) = stabil unter LT1 (≤ 145 bpm)</p>
            </div>
          </div>
          <div className="ic-chart-legend">
            <span>
              <i style={{ background: 'var(--c0)' }} />
              LIT-Lauf ≥ 45 min (klickbar)
            </span>
            <span>
              <i style={{ background: 'var(--cds-chart-reference)' }} />
              5,0 % LT1-Stabilitätsschwelle
            </span>
          </div>
          <D3Chart
            rows={driftRows}
            xKey="datum"
            label="Pulsdrift langer Läufe in Prozent"
            height={230}
            include={[0, 10]}
            refs={[5]}
            yFormat={(v) => `${num(v)} %`}
            series={[
              { key: 'drift_pct', label: 'Pulsdrift', color: 'var(--c0)', dots: true, r: 4.5, opacity: 0.78, digits: 1, unit: '%' },
            ]}
            tipTitle={(r) => `${fmtDate(r.datum)} · ${num(r.dauer_min)} min Lauf`}
            clickHint="Laufeinheit & Zonen öffnen"
            onPointClick={(r) => r.id && openDrawer({ type: 'activity', id: String(r.id) })}
          />
        </div>
      </div>

      {/* SECTION 3: Wochenstunden, Rad-Effizienz, Recovery & VO2max */}
      <div className="ic-grid2">
        <div className={`ic-card ${highlightedCard === 'card-wochen' ? 'ic-card-highlight' : ''}`} id="card-wochen">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">Stunden pro Woche nach Disziplin (20 Wochen)</h2>
              <p className="ic-note">Gestrichelt: 5–7 h Korridor im 5-km-Block · Klick auf Woche öffnet Wochen-Bilanz</p>
            </div>
          </div>
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
              Kraft/Sonst
            </span>
          </div>
          <D3Chart
            rows={wochenRows}
            xKey="start"
            band={true}
            stack={true}
            label="Trainingsstunden pro Woche nach Sportart"
            height={220}
            include={[0, 7]}
            refs={[5, 7]}
            series={[
              { key: 'h_lauf', label: 'Lauf', color: 'var(--sport-run)', digits: 1, unit: 'h' },
              { key: 'h_rad', label: 'Rad', color: 'var(--sport-bike)', digits: 1, unit: 'h' },
              { key: 'h_schwimmen', label: 'Schwimmen', color: 'var(--sport-swim)', digits: 1, unit: 'h' },
              { key: 'h_sonst', label: 'Kraft/Sonst', color: 'var(--sport-strength)', digits: 1, unit: 'h' },
            ]}
            tipTitle={(r) => `${r.woche || 'Woche'} (ab ${fmtDate(r.start)}) · ${num(r.h_gesamt, 1)} h`}
            tipExtra={(r) => `${num(r.km_lauf, 1)} km Lauf · ${r.harte_reize || 0} harte Reize`}
            clickHint="Wochen-Details im Drawer öffnen"
            onPointClick={(r) => r.woche && openDrawer({ type: 'week', woche: r.woche })}
          />
        </div>

        <div className={`ic-card ${highlightedCard === 'card-radeff' ? 'ic-card-highlight' : ''}`} id="card-radeff">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">Rad-Effizienz: Watt je Herzschlag (EF = NP / Ø Puls)</h2>
              <p className="ic-note">Fahrten ab 30 min mit Leistung &amp; Puls (inkl. Garmin-Tagespuls-Fallback) · Klick öffnet Fahrt</p>
            </div>
          </div>
          <div className="ic-chart-legend">
            <span>
              <i style={{ background: 'var(--sport-bike)' }} />
              Efficiency Factor (W/bpm, klickbar)
            </span>
          </div>
          <D3Chart
            rows={store.radEffizienz}
            xKey="datum"
            label="Watt je Herzschlag je Radfahrt"
            height={220}
            series={[
              { key: 'ef', label: 'EF (Watt/bpm)', color: 'var(--sport-bike)', dots: true, r: 4.8, opacity: 0.85, digits: 2, unit: 'W/bpm' },
            ]}
            tipTitle={(r) => `${fmtDate(r.datum)} · ${r.titel}`}
            tipExtra={(r) => `NP ${r.np} W @ Ø ${r.puls} bpm`}
            clickHint="Radeinheit im Drawer öffnen"
            onPointClick={(r) => r.id && openDrawer({ type: 'activity', id: String(r.id) })}
          />
        </div>
      </div>

      <div className="ic-grid3">
        <div className={`ic-card ${highlightedCard === 'card-ruhepuls' ? 'ic-card-highlight' : ''}`} id="card-ruhepuls">
          <div className="ic-card-head">
            <h2 className="ic-h2">Ruhepuls (90 Tage)</h2>
          </div>
          <div className="ic-chart-legend">
            <span>
              <i style={{ background: 'var(--c0)' }} />
              Tag
            </span>
            <span>
              <i style={{ background: 'var(--c1)' }} />
              7-Tage-Mittel
            </span>
          </div>
          <D3Chart
            rows={store.tage.slice(-90)}
            xKey="datum"
            label="Ruhepuls der letzten 90 Tage"
            height={190}
            series={[
              { key: 'ruhepuls', label: 'Ruhepuls', color: 'var(--c0)', width: 1.2, unit: 'bpm' },
              { key: 'ruhepuls_7t', label: '7-Tage-Mittel', color: 'var(--c1)', width: 2.2, digits: 1, unit: 'bpm' },
            ]}
            clickHint="Tag öffnen"
            onPointClick={(r) => openDrawer({ type: 'day', datum: r.datum })}
          />
        </div>

        <div className={`ic-card ${highlightedCard === 'card-schlaf' ? 'ic-card-highlight' : ''}`} id="card-schlaf">
          <div className="ic-card-head">
            <h2 className="ic-h2">Schlaf (90 Tage · Ziel 8 h)</h2>
          </div>
          <div className="ic-chart-legend">
            <span>
              <i style={{ background: 'var(--c0)' }} />
              Stunden je Nacht
            </span>
          </div>
          <D3Chart
            rows={store.tage.slice(-90)}
            xKey="datum"
            bars={true}
            label="Schlafstunden der letzten 90 Tage"
            height={190}
            include={[0, 9]}
            refs={[8]}
            series={[{ key: 'schlaf_h', label: 'Schlaf', color: 'var(--c0)', digits: 1, unit: 'h' }]}
            clickHint="Tag öffnen"
            onPointClick={(r) => openDrawer({ type: 'day', datum: r.datum })}
          />
        </div>

        <div className={`ic-card ${highlightedCard === 'card-vo2' ? 'ic-card-highlight' : ''}`} id="card-vo2">
          <div className="ic-card-head">
            <h2 className="ic-h2">VO2max-Trend (Garmin)</h2>
          </div>
          <div className="ic-chart-legend">
            <span>
              <i style={{ background: 'var(--c2)' }} />
              VO2max-Schätzung
            </span>
          </div>
          <D3Chart
            rows={store.vo2max}
            xKey="datum"
            label="VO2max-Schätzung über die Zeit"
            height={190}
            series={[{ key: 'vo2max', label: 'VO2max', color: 'var(--c2)', width: 2.2, digits: 1 }]}
          />
        </div>
      </div>

      {/* SECTION 4: Bestwerte, Leistungsmarker & Zwift FTP Builder */}
      <div className="ic-grid2">
        {/* Bestwerte (100% clickable to record activities!) */}
        <div className={`ic-card ${highlightedCard === 'card-best' ? 'ic-card-highlight' : ''}`} id="card-best">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">Bestwerte im Training (klickbar zur Rekord-Einheit)</h2>
              <p className="ic-note">Letzte 6 Wochen vs. 6 Wochen davor vs. All-Time seit 2024 · Klick auf einen Wert öffnet die Einheit</p>
            </div>
          </div>
          <div className="ic-scroll">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Kennzahl</th>
                  <th className="num">Letzte 6 Wo.</th>
                  <th className="num">6 Wo. davor</th>
                  <th className="num">Seit 2024</th>
                </tr>
              </thead>
              <tbody>
                {store.bestwerte.map((r) => {
                  const unit = r.einheit && r.einheit !== '/100 m' ? ' ' + r.einheit : r.einheit || '';
                  const jCol =
                    r.richtung === 'besser'
                      ? 'var(--color-ok)'
                      : r.richtung === 'schlechter'
                      ? 'var(--color-bad)'
                      : undefined;
                  return (
                    <tr key={r.id}>
                      <td>
                        <b>{r.kennzahl}</b>
                      </td>
                      <td
                        className={`num ${r.jetzt_id ? 'ic-td-click' : ''}`}
                        onClick={() => r.jetzt_id && openDrawer({ type: 'activity', id: String(r.jetzt_id) })}
                        title={r.jetzt_id ? 'Klicken, um diese Einheit zu öffnen' : undefined}
                      >
                        <b style={{ color: jCol }}>
                          {r.jetzt_text}
                          {r.jetzt_text !== '–' ? unit : ''}
                          {r.jetzt_id ? ' ↗' : ''}
                        </b>
                        {r.jetzt_datum && <div className="ic-ev-meta">{fmtDate(r.jetzt_datum)}</div>}
                      </td>
                      <td
                        className={`num ${r.vorher_id ? 'ic-td-click' : ''}`}
                        onClick={() => r.vorher_id && openDrawer({ type: 'activity', id: String(r.vorher_id) })}
                      >
                        <span>
                          {r.vorher_text}
                          {r.vorher_text !== '–' ? unit : ''}
                          {r.vorher_id ? ' ↗' : ''}
                        </span>
                        {r.vorher_datum && <div className="ic-ev-meta">{fmtDate(r.vorher_datum)}</div>}
                      </td>
                      <td
                        className={`num ${r.gesamt_id ? 'ic-td-click' : ''}`}
                        onClick={() => r.gesamt_id && openDrawer({ type: 'activity', id: String(r.gesamt_id) })}
                      >
                        <b>
                          {r.gesamt_text}
                          {r.gesamt_text !== '–' ? unit : ''}
                          {r.gesamt_id ? ' ↗' : ''}
                        </b>
                        {r.gesamt_datum && <div className="ic-ev-meta">{fmtDate(r.gesamt_datum)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Leistungsmarker (athlet/marker.md) */}
        <div className="ic-card" id="card-marker">
          <div className="ic-card-head">
            <div>
              <h2 className="ic-h2">Leistungsmarker &amp; Schwellen (athlet/marker.md)</h2>
              <p className="ic-note">Aktualitätsregel: Zeiten/Watt gelten 6 Wochen, Pulsschwellen 6 Monate</p>
            </div>
          </div>
          <div className="ic-scroll">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Disziplin</th>
                  <th>Marker</th>
                  <th>Wert</th>
                  <th>Gültigkeit &amp; Status</th>
                </tr>
              </thead>
              <tbody>
                {store.marker.map((r, idx) => {
                  const lvl = statusLevel(r.gueltigkeit);
                  const remDays = r.gueltig_bis ? daysTo(r.gueltig_bis) : null;
                  return (
                    <tr key={idx}>
                      <td>{r.disziplin}</td>
                      <td>
                        <b>{r.marker}</b>
                        {r.datum && r.datum !== '-' && <div className="ic-ev-meta">vom {r.datum} ({r.quelle})</div>}
                      </td>
                      <td>{r.wert}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`ic-pill ic-s-${lvl}`}>{r.gueltigkeit}</span>
                          {remDays != null && remDays >= 0 && (
                            <span className="ic-ev-meta">noch {remDays} T.</span>
                          )}
                        </div>
                        {r.status && <div className="ic-ev-meta" style={{ marginTop: 2 }}>{r.status}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Zwift FTP Builder Board (100% clickable!) */}
      <div className={`ic-card ${highlightedCard === 'card-ftp' ? 'ic-card-highlight' : ''}`} id="card-ftp">
        <div className="ic-card-head">
          <div>
            <h2 className="ic-h2">Zwift FTP Builder (28 Einheiten · Klickbar für Workout-Details &amp; gefahrene Einheiten)</h2>
            <p className="ic-note">
              Erledigte Fahrten öffnen die echte Zwift-Aktivität · Offene Einheiten öffnen das Workout-Briefing (Inhalt, Dauer &amp; Block-Regel)
            </p>
          </div>
        </div>
        <div className="ic-ftp">
          {store.ftpBuilder.map((p) => {
            const isDone = p.status === 'erledigt';
            const isNext = p.nr === nextFtpNr;
            return (
              <div
                key={p.nr}
                className={`ic-ftp-card ic-click ${isDone ? 'done' : ''} ${isNext ? 'next' : ''} ${p.hart ? 'hard' : ''} ${p.optional ? 'opt' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isDone && p.aktivitaet_id) {
                    openDrawer({ type: 'activity', id: String(p.aktivitaet_id) });
                  } else {
                    openDrawer({ type: 'ftp', nr: p.nr });
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                  <b>
                    {p.nr} {p.einheit}
                  </b>
                  <span className="ic-tile-arrow">↗</span>
                </div>
                <div className="ic-ev-meta">
                  {isDone ? `✓ ${fmtDay(p.erledigt_am)}` : isNext ? '● Als Nächstes' : p.status} · {p.dauer_min} min
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
