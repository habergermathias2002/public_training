import React, { useMemo, useState } from 'react';
import { CockpitDataStore } from '../data/useCockpitData';
import { DrawerState } from '../types';
import { daysTo, fmtDate, num, sportColor, ZONES_5 } from '../utils/format';

interface AktivitaetenPageProps {
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
}

type SortField = 'datum' | 'dauer_min' | 'distanz_km' | 'puls_avg' | 'puls_max' | 'leistung_np' | 'last' | 'drift' | 'rpe';

export const AktivitaetenPage: React.FC<AktivitaetenPageProps> = ({ store, openDrawer }) => {
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState('');
  const [reiz, setReiz] = useState('');
  const [intensity, setIntensity] = useState<'all' | 'hart' | 'lit'>('all');
  const [zeitraum, setZeitraum] = useState<number>(90);
  const [land, setLand] = useState('');
  const [sortField, setSortField] = useState<SortField>('datum');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (f: SortField) => {
    if (sortField === f) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(f);
      setSortDir('desc');
    }
  };

  const reizTypes = useMemo(() => {
    const s = new Set(store.aktivitaeten.map((a) => a.reiz).filter(Boolean));
    return [...s].sort();
  }, [store.aktivitaeten]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = store.aktivitaeten.filter((r) => {
      if (sport && r.sport !== sport) return false;
      if (reiz && r.reiz !== reiz) return false;
      if (intensity === 'hart' && !r.hart) return false;
      if (intensity === 'lit' && r.hart) return false;
      if (zeitraum > 0 && -daysTo(r.datum) > zeitraum) return false;
      const detail = store.einheitenById.get(String(r.id));
      if (land && detail?.land !== land) return false;
      if (q) {
        const hay = `${r.titel} ${r.sport} ${r.reiz} ${r.datum} ${r.woche} ${detail?.land_de || ''} ${detail?.rpe_notiz || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const da = store.einheitenById.get(String(a.id));
      const db = store.einheitenById.get(String(b.id));
      let cmp = 0;
      if (sortField === 'datum') {
        cmp = (a.datum + (a.start || '')).localeCompare(b.datum + (b.start || ''));
      } else if (sortField === 'drift') {
        cmp = (da?.drift_pct ?? -999) - (db?.drift_pct ?? -999);
      } else if (sortField === 'rpe') {
        cmp = (da?.rpe ?? -1) - (db?.rpe ?? -1);
      } else {
        cmp = (Number(a[sortField]) || 0) - (Number(b[sortField]) || 0);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return rows;
  }, [store.aktivitaeten, store.einheitenById, search, sport, reiz, intensity, zeitraum, land, sortField, sortDir]);

  // Summary metrics for filtered rows
  const summary = useMemo(() => {
    let totalMin = 0;
    let totalKm = 0;
    let totalHm = 0;
    let totalLast = 0;
    let hrSum = 0;
    let hrCnt = 0;
    let zLit = 0;
    let zTot = 0;
    let hardCnt = 0;

    for (const r of filtered) {
      totalMin += r.dauer_min || 0;
      totalKm += r.distanz_km || 0;
      totalHm += r.hm_auf || 0;
      totalLast += r.last || 0;
      if (r.puls_avg) {
        hrSum += r.puls_avg;
        hrCnt++;
      }
      zLit += r.z1_min || 0;
      zTot += (r.z1_min || 0) + (r.z2_min || 0) + (r.z3_min || 0) + (r.z4_min || 0);
      if (r.hart) hardCnt++;
    }
    return {
      count: filtered.length,
      hours: totalMin / 60,
      km: totalKm,
      hm: totalHm,
      last: totalLast,
      avgHr: hrCnt ? Math.round(hrSum / hrCnt) : null,
      litPct: zTot > 0 ? Math.round((100 * zLit) / zTot) : null,
      hardCnt,
    };
  }, [filtered]);

  const sortIndicator = (f: SortField) => (sortField === f ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');

  return (
    <section className="ic-page" id="aktivitaeten">
      <header className="ic-page-head" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Aktivitäten</h1>
          <p className="ic-lede">
            Profi-5-Zonen-Modell (individuell aus athlet/marker.md) · Klick auf jede Zeile öffnet Telemetrie, Runden &amp; RPE
          </p>
        </div>
      </header>

      {/* High-Density Filter & Search Bar */}
      <div className="ic-filter-bar">
        <input
          type="search"
          className="ic-search-input"
          placeholder="Suche nach Titel, Reiz, Woche (z.B. 2026-W47), Datum, Land, Notiz..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="ic-seg" role="group" aria-label="Sportart">
          {(
            [
              ['', 'Alle'],
              ['Lauf', 'Lauf'],
              ['Rad', 'Rad'],
              ['Schwimmen', 'Schwimmen'],
              ['Wandern', 'Wandern'],
              ['Kraft', 'Kraft'],
            ] as const
          ).map(([val, label]) => (
            <button key={val} type="button" aria-pressed={sport === val} onClick={() => setSport(val)}>
              {label}
            </button>
          ))}
        </div>

        <select className="dash-select" value={reiz} onChange={(e) => setReiz(e.target.value)} aria-label="Reiztyp">
          <option value="">Alle Reize</option>
          {reizTypes.map((rz) => (
            <option key={rz} value={rz}>
              Reiz: {rz}
            </option>
          ))}
        </select>

        <div className="ic-seg" role="group" aria-label="Intensität">
          <button type="button" aria-pressed={intensity === 'all'} onClick={() => setIntensity('all')}>
            Alle
          </button>
          <button type="button" aria-pressed={intensity === 'hart'} onClick={() => setIntensity('hart')}>
            🔥 Nur Hart
          </button>
          <button type="button" aria-pressed={intensity === 'lit'} onClick={() => setIntensity('lit')}>
            🟢 Nur LIT
          </button>
        </div>

        <select className="dash-select" value={land} onChange={(e) => setLand(e.target.value)} aria-label="Land">
          <option value="">Alle Länder</option>
          {store.laender.map((l) => (
            <option key={l.land} value={l.land}>
              {l.name_de} ({l.aktivitaeten})
            </option>
          ))}
        </select>

        <div className="ic-seg" role="group" aria-label="Zeitraum">
          {(
            [
              [30, '30T'],
              [90, '90T'],
              [365, '12M'],
              [0, 'Alle'],
            ] as const
          ).map(([val, label]) => (
            <button key={val} type="button" aria-pressed={zeitraum === val} onClick={() => setZeitraum(val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Live Aggregation Ribbon for Filtered Selection */}
      <div className="ic-agg-strip">
        <div>
          <small>Einheiten</small>
          <b>{num(summary.count)}</b>
        </div>
        <div>
          <small>Σ Dauer</small>
          <b>{num(summary.hours, 1)} h</b>
        </div>
        <div>
          <small>Σ Distanz</small>
          <b>{num(summary.km, 1)} km</b>
        </div>
        <div>
          <small>Σ Höhenmeter</small>
          <b>{num(summary.hm)} m</b>
        </div>
        <div>
          <small>Ø Puls</small>
          <b>{summary.avgHr ? `${summary.avgHr} bpm` : '–'}</b>
        </div>
        <div>
          <small>LIT-Anteil (≤ LT1)</small>
          <b style={{ color: summary.litPct != null && summary.litPct >= 75 ? 'var(--color-ok)' : undefined }}>
            {summary.litPct != null ? `${summary.litPct} %` : '–'}
          </b>
        </div>
        <div>
          <small>Harte Reize</small>
          <b>{summary.hardCnt}</b>
        </div>
        <div>
          <small>Σ Trainingslast</small>
          <b>{num(summary.last, 0)}</b>
        </div>
      </div>

      {/* Sortable High-Density Telemetry Table */}
      <div className="ic-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="ic-scroll">
          <table className="ic-table ic-table-dense" id="akt-table">
            <thead>
              <tr>
                <th className="ic-th-sort" onClick={() => toggleSort('datum')}>
                  Datum{sortIndicator('datum')}
                </th>
                <th>Sport</th>
                <th>Einheit</th>
                <th className="num ic-th-sort" onClick={() => toggleSort('dauer_min')}>
                  Min{sortIndicator('dauer_min')}
                </th>
                <th className="num ic-th-sort" onClick={() => toggleSort('distanz_km')}>
                  km{sortIndicator('distanz_km')}
                </th>
                <th>Tempo</th>
                <th className="num ic-th-sort" onClick={() => toggleSort('puls_avg')}>
                  Ø Puls{sortIndicator('puls_avg')}
                </th>
                <th className="num ic-th-sort" onClick={() => toggleSort('puls_max')}>
                  Max{sortIndicator('puls_max')}
                </th>
                <th className="num ic-th-sort" onClick={() => toggleSort('leistung_np')}>
                  NP W{sortIndicator('leistung_np')}
                </th>
                <th>5-Zonen (Z1–Z5)</th>
                <th className="num ic-th-sort" onClick={() => toggleSort('drift')}>
                  Drift{sortIndicator('drift')}
                </th>
                <th>Reiz</th>
                <th className="num ic-th-sort" onClick={() => toggleSort('last')}>
                  Last{sortIndicator('last')}
                </th>
                <th className="num ic-th-sort" onClick={() => toggleSort('rpe')}>
                  RPE{sortIndicator('rpe')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const detail = store.einheitenById.get(String(r.id));
                const z5 = [
                  detail?.z5_1_min ?? 0,
                  detail?.z5_2_min ?? r.z1_min ?? 0,
                  detail?.z5_3_min ?? r.z2_min ?? 0,
                  detail?.z5_4_min ?? r.z3_min ?? 0,
                  detail?.z5_5_min ?? r.z4_min ?? 0,
                ];
                const zTot = z5.reduce((s, v) => s + v, 0);
                const drift = detail?.drift_pct;
                return (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => openDrawer({ type: 'activity', id: r.id })}
                    onKeyDown={(e) => e.key === 'Enter' && openDrawer({ type: 'activity', id: r.id })}
                  >
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <b>{fmtDate(r.datum)}</b>
                      <span className="ic-ev-meta" style={{ marginLeft: 5 }}>
                        {r.tag} {r.start}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                      {r.sport}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <b>{r.titel}</b>
                        {detail?.land_de && detail.land !== 'Germany' && (
                          <span className="ic-tag" style={{ fontSize: 10 }}>
                            {detail.land_de}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">{num(r.dauer_min)}</td>
                    <td className="num">{r.distanz_km ? num(r.distanz_km, 1) : '–'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.tempo || '–'}</td>
                    <td className="num">{num(r.puls_avg)}</td>
                    <td className="num">{num(r.puls_max)}</td>
                    <td className="num">{num(r.leistung_np)}</td>
                    <td style={{ minWidth: 96 }}>
                      {zTot > 0 ? (
                        <div className="ic-zbar-mini" title={ZONES_5.map((z, i) => `${z.short}: ${num(z5[i], 1)} min`).join(' · ')}>
                          {z5.map((val, i) =>
                            val > 0 ? (
                              <span
                                key={i}
                                style={{
                                  width: `${(100 * val) / zTot}%`,
                                  background: ZONES_5[i].color,
                                }}
                              />
                            ) : null
                          )}
                        </div>
                      ) : (
                        <span className="ic-ev-meta">–</span>
                      )}
                    </td>
                    <td className="num">
                      {drift != null ? (
                        <span
                          style={{
                            color:
                              drift <= 5 ? 'var(--color-ok)' : drift <= 7 ? 'var(--color-warn)' : 'var(--color-bad)',
                            fontWeight: 600,
                          }}
                        >
                          {num(drift, 1)} %
                        </span>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td>
                      <span className={`ic-tag ${r.hart ? 'hart' : ''}`}>{r.reiz}</span>
                    </td>
                    <td className="num">{num(r.last)}</td>
                    <td className="num">
                      {detail?.rpe != null ? (
                        <span className="ic-rpe-badge">{detail.rpe}/10</span>
                      ) : (
                        <span className="ic-ev-meta">+</span>
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
