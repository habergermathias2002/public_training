import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CockpitDataStore } from '../data/useCockpitData';
import { DrawerState, PageId } from '../types';
import {
  artColor,
  daysTo,
  fmtDate,
  num,
  relNext,
  relPast,
  sportColor,
  statusColorVar,
  statusLevel,
  TODAY_ISO,
  TODAY_UTC,
  parseIso,
} from '../utils/format';

interface WorldMapCockpitProps {
  store: CockpitDataStore;
  openDrawer: (d: DrawerState) => void;
  navigate: (page: PageId, sub?: string) => void;
  flyTargetId: string | null;
  onFlyComplete: () => void;
}

export const WorldMapCockpit: React.FC<WorldMapCockpitProps> = ({
  store,
  openDrawer,
  navigate,
  flyTargetId,
  onFlyComplete,
}) => {
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const flyFnRef = useRef<((id: string) => void) | null>(null);
  const [panelTab, setPanelTab] = useState<'events' | 'naechste' | 'letzte' | 'woche'>('events');
  const [trainerExpanded, setTrainerExpanded] = useState(false);

  const landTint = (pct: number) => `color-mix(in oklab, var(--c2) ${pct}%, var(--color-panel))`;

  // Mount & update D3 World Map
  useEffect(() => {
    const box = mapBoxRef.current;
    if (!box || !store.karte.length) return;

    box.replaceChildren();
    box.style.background = `color-mix(in oklab, var(--c0) 20%, var(--color-bg))`;

    const svg = d3
      .select(box)
      .append('svg')
      .attr('role', 'img')
      .attr('aria-label', 'Weltkarte mit Trainingsländern und Events');
    const g = svg.append('g');

    const tools = document.createElement('div');
    tools.className = 'ic-map-tools';
    const mkBtn = (txt: string, label?: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      if (label) b.setAttribute('aria-label', label);
      tools.appendChild(b);
      return b;
    };
    const bEv = mkBtn('Events');
    const bWorld = mkBtn('Welt');
    const bIn = mkBtn('+', 'Hineinzoomen');
    const bOut = mkBtn('−', 'Herauszoomen');

    const tip = document.createElement('div');
    tip.className = 'ic-tip';
    tip.hidden = true;
    box.append(tools, tip);

    let currentK = 1;
    let focusTransform: d3.ZoomTransform | null = null;

    const rescale = () => {
      g.selectAll<SVGCircleElement, any>('circle.pt, circle.halo').attr('r', function () {
        return Number(this.dataset.r) / currentK;
      });
      g.selectAll<SVGGElement, any>('g.scalefix').attr('transform', function () {
        return `translate(${this.dataset.x},${this.dataset.y}) scale(${1 / currentK})`;
      });
    };

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 80])
      .filter((ev) => (!ev.ctrlKey || ev.type === 'wheel') && !ev.button)
      .on('zoom', (ev) => {
        currentK = ev.transform.k;
        g.attr('transform', ev.transform.toString());
        rescale();
        tip.hidden = true;
      });

    svg.call(zoom).on('dblclick.zoom', null);
    bWorld.onclick = () => svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
    bEv.onclick = () => focusTransform && svg.transition().duration(600).call(zoom.transform, focusTransform);
    bIn.onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.8);
    bOut.onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.8);

    const drawMap = (initialFit = false) => {
      const w = Math.max(320, box.clientWidth);
      const h = Math.max(320, box.clientHeight);
      svg.attr('viewBox', `0 0 ${w} ${h}`);

      const sphere: any = { type: 'Sphere' };
      const proj = d3.geoNaturalEarth1().fitSize([w, h], sphere);
      const b = d3.geoPath(proj).bounds(sphere);
      const cover = Math.max(w / (b[1][0] - b[0][0]), h / (b[1][1] - b[0][1]));
      if (cover > 1) proj.scale(proj.scale() * cover).translate([w / 2, h / 2]);
      const path = d3.geoPath(proj);
      zoom.extent([
        [0, 0],
        [w, h],
      ]).translateExtent([
        [0, 0],
        [w, h],
      ]);

      const shapes = store.karte
        .map((r: any) => {
          try {
            const geo = typeof r.geometry === 'string' ? JSON.parse(r.geometry) : JSON.parse(JSON.stringify(r.geometry));
            if (d3.geoArea(geo) > 2 * Math.PI) {
              geo.coordinates = geo.coordinates.map((poly: any) => poly.map((ring: any) => ring.slice().reverse()));
            }
            return { land: r.land, geo };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as { land: string; geo: any }[];

      const counts = new Map(store.laender.map((r) => [r.land, r]));
      const maxC = d3.max(store.laender, (r) => Number(r.aktivitaeten)) || 1;

      g.selectAll('*').remove();
      g.append('path')
        .attr('class', 'grat')
        .style('stroke', `color-mix(in oklab, var(--c0) 35%, var(--color-bg))`)
        .attr('d', path(d3.geoGraticule10()) || '');

      const placeTip = (event: any) => {
        const [px, py] = d3.pointer(event, box);
        tip.hidden = false;
        tip.style.left = Math.min(Math.max(8, px + 14), box.clientWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = Math.max(8, py - tip.offsetHeight - 12) + 'px';
      };
      const hideTip = () => {
        tip.hidden = true;
      };

      // Countries
      g.append('g')
        .selectAll('path')
        .data(shapes)
        .join('path')
        .attr('class', (d) => 'land' + (counts.has(d.land) ? ' visited' : ''))
        .attr('d', (d) => path(d.geo) || '')
        .style('fill', (d) => {
          const c = counts.get(d.land);
          if (!c) return 'color-mix(in oklab, var(--color-fg) 8%, var(--color-panel))';
          const t = Math.log1p(Number(c.aktivitaeten)) / Math.log1p(maxC);
          return landTint(Math.round(32 + 56 * t));
        })
        .on('pointermove', (event, d) => {
          const c = counts.get(d.land);
          if (!c) {
            hideTip();
            return;
          }
          tip.replaceChildren();
          const bEl = document.createElement('b');
          bEl.textContent = `${c.name_de}`;
          const s1 = document.createElement('span');
          s1.textContent = `${num(c.aktivitaeten)} Einheiten · ${num(c.stunden, 1)} h`;
          const s2 = document.createElement('span');
          s2.textContent = `${fmtDate(c.erstes)} bis ${fmtDate(c.letztes)}`;
          const s3 = document.createElement('span');
          s3.className = 'ic-tip-hint';
          s3.textContent = '↗ Klicken für alle Einheiten im Land';
          tip.append(bEl, s1, s2, s3);
          placeTip(event);
        })
        .on('click', (event, d) => {
          const c = counts.get(d.land);
          if (!c) return;
          event.stopPropagation();
          openDrawer({ type: 'country', land: d.land });
        })
        .on('pointerleave', hideTip);

      // Events & Bikepacking Route
      const evs = store.events.filter((r) => r.lat != null && r.lon != null && String(r.lat) !== '' && String(r.lon) !== '');
      const routes = evs
        .filter((r) => r.route)
        .map((r) => {
          let pts: [number, number][] = [];
          try {
            pts = typeof r.route === 'string' ? JSON.parse(r.route) : r.route;
          } catch {
            pts = [];
          }
          return { r, xy: pts.map(([la, lo]) => proj([lo, la])).filter(Boolean) as [number, number][] };
        })
        .filter((x) => x.xy.length > 1);

      routes.forEach(({ r, xy }) => {
        g.append('path')
          .attr('class', 'route')
          .style('stroke', 'var(--sport-bike)')
          .style('cursor', 'pointer')
          .attr('d', d3.line()(xy) || '')
          .on('click', (ev) => {
            ev.stopPropagation();
            openDrawer({ type: 'event', id: r.id });
          });
      });

      const tipForEvent = (r: any) => {
        tip.replaceChildren();
        const bEl = document.createElement('b');
        bEl.textContent = r.name;
        const s1 = document.createElement('span');
        s1.textContent = `${fmtDate(r.datum)} · ${r.ort}`;
        tip.append(bEl, s1);
        if (r.typ === 'anstehend') {
          const s2 = document.createElement('span');
          s2.textContent = `Ziel: ${r.ziel} · Prognose: ${r.prognose}`;
          const s3 = document.createElement('span');
          s3.textContent = `Status: ${r.status} (noch ${daysTo(r.datum)} Tage)`;
          tip.append(s2, s3);
        } else if (r.ergebnis) {
          const s2 = document.createElement('span');
          s2.textContent = r.ergebnis;
          tip.append(s2);
        }
        const sh = document.createElement('span');
        sh.className = 'ic-tip-hint';
        sh.textContent = '↗ Klicken für Event-Details & Aktivitäten';
        tip.append(sh);
      };

      const showAt = (r: any) => {
        tipForEvent(r);
        const t = d3.zoomTransform(svg.node()!);
        const p = proj([Number(r.lon), Number(r.lat)]);
        if (!p) return;
        const [x, y] = t.apply(p);
        tip.hidden = false;
        tip.style.left = Math.min(Math.max(8, x + 14), box.clientWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + 'px';
      };

      const past = evs.filter((r) => r.typ !== 'anstehend' && !r.route);
      const next = evs.filter((r) => r.typ === 'anstehend');
      const xy = (r: any) => proj([Number(r.lon), Number(r.lat)]) || [0, 0];

      g.append('g')
        .selectAll('circle')
        .data(past)
        .join('circle')
        .attr('class', 'pt')
        .attr('data-r', 5.8)
        .style('fill', (r) => artColor(r.art))
        .attr('cx', (r) => xy(r)[0])
        .attr('cy', (r) => xy(r)[1])
        .on('pointerenter', (event, r) => {
          tipForEvent(r);
          placeTip(event);
        })
        .on('click', (event, r) => {
          event.stopPropagation();
          openDrawer({ type: 'event', id: r.id });
        })
        .on('pointerleave', hideTip);

      const gn = g.append('g');
      gn.selectAll('circle.halo')
        .data(next)
        .join('circle')
        .attr('class', 'halo')
        .attr('data-r', 9.5)
        .style('stroke', (r) => statusColorVar(r.status))
        .attr('cx', (r) => xy(r)[0])
        .attr('cy', (r) => xy(r)[1]);

      gn.selectAll('circle.pt')
        .data(next)
        .join('circle')
        .attr('class', 'pt')
        .attr('data-r', 8.2)
        .style('fill', (r) => statusColorVar(r.status))
        .attr('cx', (r) => xy(r)[0])
        .attr('cy', (r) => xy(r)[1])
        .on('pointerenter', (event, r) => {
          tipForEvent(r);
          placeTip(event);
        })
        .on('click', (event, r) => {
          event.stopPropagation();
          openDrawer({ type: 'event', id: r.id });
        })
        .on('pointerleave', hideTip);

      const midOf = (p: [number, number][]) => {
        const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]));
        let half = d3.sum(seg) / 2;
        for (let i = 0; i < seg.length; i++) {
          if (half <= seg[i]) {
            const f = seg[i] ? half / seg[i] : 0;
            return [p[i][0] + f * (p[i + 1][0] - p[i][0]), p[i][1] + f * (p[i + 1][1] - p[i][1])];
          }
          half -= seg[i];
        }
        return p[p.length - 1];
      };

      const gr = g.append('g');
      const fix = (x: number, y: number) =>
        gr.append('g').attr('class', 'scalefix').attr('data-x', x).attr('data-y', y);

      routes.forEach(({ r, xy: p }) => {
        const [startName, endName] = (r.ort || '').split('→').map((x: string) => x.trim());
        const tipRoute = (event: any, label: string) => {
          tipForEvent(r);
          const b = document.createElement('b');
          b.textContent = label;
          tip.prepend(b);
          placeTip(event);
        };
        const bind = (sel: any, label: string) =>
          sel
            .on('pointerenter', (e: any) => tipRoute(e, label))
            .on('click', (e: any) => {
              e.stopPropagation();
              openDrawer({ type: 'event', id: r.id });
            })
            .on('pointerleave', hideTip);

        const a = fix(p[0][0], p[0][1]);
        a.append('circle').attr('r', 6).style('fill', 'var(--color-bg)').style('stroke', 'var(--sport-bike)').attr('stroke-width', 3);
        a.append('text').attr('class', 'mk-l').attr('x', 10).attr('y', 4).text('Start');
        bind(a, `Start: ${startName || ''}`);

        const last = p[p.length - 1];
        const bEl = fix(last[0], last[1]);
        bEl.append('circle').attr('r', 7).style('fill', 'var(--sport-bike)').style('stroke', 'var(--color-bg)').attr('stroke-width', 2);
        bEl.append('text').attr('class', 'mk-l').attr('x', 11).attr('y', 4).text('Ziel');
        bind(bEl, `Ziel: ${endName || ''}`);

        const [mx, my] = midOf(p);
        const c = fix(mx, my);
        c.append('circle').attr('r', 13).style('fill', 'var(--color-panel)').style('stroke', 'var(--sport-bike)').attr('stroke-width', 1.5);
        const bike = c
          .append('g')
          .attr('fill', 'none')
          .style('stroke', 'var(--sport-bike)')
          .attr('stroke-width', 1.4)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round');
        bike.append('circle').attr('cx', -5.5).attr('cy', 3).attr('r', 3.8);
        bike.append('circle').attr('cx', 5.5).attr('cy', 3).attr('r', 3.8);
        bike.append('path').attr('d', 'M-5.5 3 L0 3 L-2 -3.5 Z M-2 -3.5 L4 -3.8 L0 3 M4 -3.8 L5.5 3 M-3.4 -4.6 L-0.8 -4.6 M4 -3.8 L5.8 -4.2 Q7 -4.2 6.6 -2.8');
        bind(c, 'Bikepacking-Route (5 Etappen)');
      });

      const wide = w > 820;
      const pad = wide ? { l: 430, r: 375, t: 40, b: 70 } : { l: 16, r: 56, t: 180, b: 200 };
      const W = Math.max(120, w - pad.l - pad.r);
      const H = Math.max(120, h - pad.t - pad.b);
      const cx = pad.l + W / 2;
      const cy = pad.t + H / 2;

      flyFnRef.current = (id: string) => {
        const r = evs.find((x) => x.id === id);
        if (!r) return;
        const [x, y] = xy(r);
        const t = d3.zoomIdentity.translate(cx, cy).scale(16).translate(-x, -y);
        svg
          .transition()
          .duration(700)
          .call(zoom.transform, t)
          .on('end', () => showAt(r));
      };

      const pts = evs.flatMap((r) => {
        const out = [xy(r)];
        if (r.route) {
          try {
            const parsed = typeof r.route === 'string' ? JSON.parse(r.route) : r.route;
            parsed.forEach(([la, lo]: [number, number]) => {
              const p = proj([lo, la]);
              if (p) out.push(p);
            });
          } catch {
            // ignore
          }
        }
        return out;
      });

      if (pts.length > 0) {
        const [x0, x1] = d3.extent(pts, (p) => p[0]) as [number, number];
        const [y0, y1] = d3.extent(pts, (p) => p[1]) as [number, number];
        const k = Math.max(1, Math.min(60, 0.78 * Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0))));
        focusTransform = d3.zoomIdentity.translate(cx, cy).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      }

      rescale();
      if (initialFit && focusTransform) {
        svg.call(zoom.transform, focusTransform);
      }
    };

    drawMap(true);
    const ro = new ResizeObserver(() => drawMap(false));
    ro.observe(box);
    return () => ro.disconnect();
  }, [store.karte, store.laender, store.events, openDrawer]);

  useEffect(() => {
    if (flyTargetId && flyFnRef.current) {
      flyFnRef.current(flyTargetId);
      onFlyComplete();
    }
  }, [flyTargetId, onFlyComplete]);

  // Derived data for AI-Trainer & Right Panel
  const tagesformKpi = store.kpis.find((k) => k.id === 'tagesform');
  const nextEvent = store.events
    .filter((e) => e.typ === 'anstehend' && daysTo(e.datum) >= 0)
    .sort((a, b) => a.datum.localeCompare(b.datum))[0];

  const trainerStand = store.trainer[0]?.stand ? fmtDate(store.trainer[0].stand) : '–';
  const takeaways = store.trainer.filter((t) => t.abschnitt === 'takeaways');
  const gutList = store.trainer.filter((t) => t.abschnitt === 'gut');
  const schlechtList = store.trainer.filter((t) => t.abschnitt === 'schlecht');
  const fokusList = store.trainer.filter((t) => t.abschnitt === 'fokus');

  const upcomingEvents = store.events
    .filter((r) => r.typ === 'anstehend' && daysTo(r.datum) >= 0)
    .sort((a, b) => a.datum.localeCompare(b.datum));

  const recentActs = [...store.aktivitaeten]
    .sort((x, y) => (y.datum + (y.start || '')).localeCompare(x.datum + (x.start || '')))
    .slice(0, 7);

  const curWeekItems = store.kalender.filter((r) => {
    const s = parseIso(r.woche_start);
    return s && +s <= TODAY_UTC && TODAY_UTC < +s + 7 * 864e5;
  });
  const curWeekDone = curWeekItems.filter((r) => r.status === 'erledigt').length;
  const openPlanned = store.kalender
    .filter((r) => r.status === 'offen' && r.datum && r.datum >= TODAY_ISO)
    .sort((x, y) => (x.datum + (x.zeit || '')).localeCompare(y.datum + (y.zeit || '')))
    .slice(0, 6);

  const weekKpiIds = ['tagesform', 'stunden', 'harte_reize', 'lauf_km', 'schwimmen', 'fitness', 'form', 'ruhepuls'];
  const weekKpis = weekKpiIds.map((id) => store.kpis.find((k) => k.id === id)).filter(Boolean);

  const tfToday = store.tagesformByDate.get(TODAY_ISO) || [...store.tagesformByDate.values()].slice(-1)[0];

  return (
    <section className="ic-page ic-page-map" id="cockpit">
      {/* Interactive D3 Map Stage */}
      <div className="ic-mapstage" ref={mapBoxRef} />

      {/* Left Floating Box: AI-Trainer + Readiness Command Bar */}
      <section className="ic-float ic-glass ic-float-title ic-trainer" aria-label="AI-Trainer">
        <div className="ic-trainer-head">
          <h1>Cockpit</h1>
          <span className="ic-badge">AI-Coach</span>
          <span className="ic-ev-meta">Stand {trainerStand}</span>
          <button
            type="button"
            className="ic-btn ic-btn-xs ic-btn-accent"
            style={{ marginLeft: 'auto' }}
            onClick={() => openDrawer({ type: 'readiness', datum: TODAY_ISO })}
            title="Subjektive Tagesform (Beine, Job-Stress, Schlaf) eintragen"
          >
            {tfToday && tfToday.datum === TODAY_ISO ? `✓ Beine ${tfToday.beine}/5 · Stress ${tfToday.stress}/5` : '+ Tagesform Check-in'}
          </button>
        </div>

        {/* Clickable Readiness & Next Event Status Strip */}
        <div className="ic-cockpit-status-bar">
          <button
            type="button"
            className="ic-status-chip"
            onClick={() => openDrawer({ type: 'readiness', datum: TODAY_ISO })}
          >
            <span className={`ic-status-dot ${tagesformKpi?.bewertung || 'gut'}`} />
            <span>
              Tagesform: <b className="ic-ampel">{tagesformKpi?.wert_text || 'grün'}</b>
            </span>
          </button>
          {nextEvent && (
            <button
              type="button"
              className="ic-status-chip"
              onClick={() => {
                if (nextEvent.lat != null && flyFnRef.current) flyFnRef.current(nextEvent.id);
                openDrawer({ type: 'event', id: nextEvent.id });
              }}
            >
              <span>
                Nächstes Ziel: <b>{nextEvent.name}</b> ({daysTo(nextEvent.datum)} T.)
              </span>
            </button>
          )}
        </div>

        <ol className="ic-takeaways">
          {takeaways.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ol>

        <div className="ic-trainer-actions">
          <button
            type="button"
            className="ic-btn ic-trainer-toggle"
            aria-expanded={trainerExpanded}
            onClick={() => setTrainerExpanded((v) => !v)}
          >
            {trainerExpanded ? 'Weniger anzeigen' : 'Deep-Dive: Stärken, Limiter, Fokus & 14-Tage-Trends'}
          </button>
          <button
            type="button"
            className="ic-btn"
            onClick={() => navigate('plan', 'wochen')}
          >
            W48-Plan →
          </button>
        </div>

        {trainerExpanded && (
          <div className="ic-trainer-more">
            {[
              { key: 'gut', title: 'Läuft gut', color: 'var(--color-ok)', items: gutList },
              { key: 'schlecht', title: 'Limiter / Achtung', color: 'var(--color-bad)', items: schlechtList },
              { key: 'fokus', title: 'Fokus diese Woche', color: 'var(--color-warn)', items: fokusList },
            ].map((grp) => (
              <div key={grp.key} className="ic-tr-group">
                <h3>
                  <i style={{ background: grp.color }} />
                  {grp.title}
                </h3>
                <ul>
                  {grp.items.map((it) => (
                    <li key={it.id}>{it.text}</li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <h3 className="ic-tr-h">
                14-Tage-Trends <span className="ic-ev-meta">gegenüber den 14 Tagen davor (klickbar)</span>
              </h3>
              <div className="ic-trends">
                {store.trends.map((r) => (
                  <div
                    key={r.id}
                    className={`ic-trend ic-tr-${r.richtung} ic-click-row`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate('form', r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate('form', r.id)}
                  >
                    <span>{r.kennzahl}</span>
                    <span className="v">
                      {r.vorher_text} → <b>{r.jetzt_text}</b>
                      {r.einheit ? ' ' + r.einheit : ''}
                    </span>
                    <span className="d">{r.delta_text || '±0'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Right Floating Panel: Events / Nächste / Letzte / Woche */}
      <div className="ic-float-panel">
        <div className="ic-seg ic-glass ic-panel-seg" role="group" aria-label="Cockpit-Ansicht">
          {(
            [
              ['events', 'Events'],
              ['naechste', 'Nächste'],
              ['letzte', 'Letzte'],
              ['woche', 'Woche'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={panelTab === id}
              onClick={() => setPanelTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ic-float-events">
          {panelTab === 'events' &&
            upcomingEvents.map((r) => {
              const onMap = r.lat != null && String(r.lat) !== '';
              const lvl = statusLevel(r.status);
              return (
                <div
                  key={r.id}
                  className="ic-ev ic-glass ic-ev-click"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (onMap && flyFnRef.current) flyFnRef.current(r.id);
                    openDrawer({ type: 'event', id: r.id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (onMap && flyFnRef.current) flyFnRef.current(r.id);
                      openDrawer({ type: 'event', id: r.id });
                    }
                  }}
                >
                  <div className="ic-ev-top">
                    <div>
                      <div className="ic-ev-name">{r.name}</div>
                      <div className="ic-ev-meta">
                        {fmtDate(r.datum)} · Prio {r.prio} · {r.ort}
                      </div>
                    </div>
                    <div className="ic-ev-count">
                      {daysTo(r.datum)}
                      <span className="ic-unit">Tage</span>
                    </div>
                  </div>
                  <div className="ic-ev-row">
                    <span className={`ic-pill ic-s-${lvl}`}>{r.status}</span>
                    <span>
                      Ziel <b>{r.ziel}</b>
                    </span>
                  </div>
                  <div className="ic-ev-row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      Prognose <b>{r.prognose}</b>
                    </span>
                    <span className="ic-link-hint">Details & Radar →</span>
                  </div>
                </div>
              );
            })}

          {panelTab === 'naechste' && (
            <>
              <div
                className="ic-ev ic-glass ic-ev-click"
                role="button"
                tabIndex={0}
                onClick={() => navigate('plan', 'kalender')}
              >
                <div className="ic-ev-top">
                  <div className="ic-ev-name">
                    {curWeekItems.length
                      ? `Diese Woche: ${curWeekDone} von ${curWeekItems.length} Soll-Reizen erledigt`
                      : 'Aktuelle Woche im Kalender öffnen'}
                  </div>
                  <span className="ic-link-hint">Kalender →</span>
                </div>
                {curWeekItems.length > 0 && (
                  <div className="ic-progress-mini">
                    <span style={{ width: `${Math.round((100 * curWeekDone) / curWeekItems.length)}%` }} />
                  </div>
                )}
              </div>

              {openPlanned.map((r, idx) => (
                <div
                  key={`${r.woche}-${r.datum}-${idx}`}
                  className="ic-ev ic-glass ic-ev-click"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    openDrawer({
                      type: 'planned',
                      item: {
                        woche: r.woche,
                        woche_titel: r.woche_titel,
                        datum: r.datum,
                        wochentag: r.tag,
                        zeit: r.zeit,
                        sport: r.sport,
                        reiz: r.reiz,
                        titel: r.titel,
                        details: r.details,
                        ebene: r.ebene,
                        dauer_min: r.plan_dauer_min,
                        status: r.status,
                      },
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      openDrawer({
                        type: 'planned',
                        item: {
                          woche: r.woche,
                          woche_titel: r.woche_titel,
                          datum: r.datum,
                          wochentag: r.tag,
                          zeit: r.zeit,
                          sport: r.sport,
                          reiz: r.reiz,
                          titel: r.titel,
                          details: r.details,
                          ebene: r.ebene,
                          dauer_min: r.plan_dauer_min,
                          status: r.status,
                        },
                      });
                    }
                  }}
                >
                  <div className="ic-li-top">
                    <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                    <span className="ic-ev-name">{r.titel}</span>
                    <span className="ic-ev-meta">
                      {relNext(r.datum)}
                      {r.zeit ? `, ${r.zeit}` : ''}
                    </span>
                  </div>
                  <div className="ic-ev-meta" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {r.details}
                  </div>
                  <div className="ic-ev-row" style={{ justifyContent: 'space-between', marginTop: 2 }}>
                    <span className={`ic-tag ${['VO2max', 'Schwelle', 'Renntempo', 'Test5k', 'hart'].includes(r.reiz) ? 'hart' : ''}`}>
                      {r.reiz}
                    </span>
                    {r.ebene && <span className="ic-ev-meta">Ebene: {r.ebene}</span>}
                    <span className="ic-link-hint">Briefing →</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {panelTab === 'letzte' &&
            recentActs.map((r) => {
              const detail = store.einheitenById.get(String(r.id));
              return (
                <div
                  key={r.id}
                  className="ic-ev ic-glass ic-ev-click"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrawer({ type: 'activity', id: r.id })}
                  onKeyDown={(e) => e.key === 'Enter' && openDrawer({ type: 'activity', id: r.id })}
                >
                  <div className="ic-li-top">
                    <span className="ic-dot" style={{ background: sportColor(r.sport) }} />
                    <span className="ic-ev-name">{r.titel}</span>
                    <span className="ic-ev-meta">
                      {relPast(r.datum)}
                      {r.start ? `, ${r.start}` : ''}
                    </span>
                  </div>
                  <div className="ic-ev-row">
                    <span>{num(r.dauer_min)} min</span>
                    {r.distanz_km > 0 && <span>{num(r.distanz_km, 1)} km</span>}
                    {r.tempo && <span>{r.tempo}</span>}
                    {r.puls_avg && <span>Ø {r.puls_avg} bpm</span>}
                    {r.leistung_np && <span>{r.leistung_np} W</span>}
                    <span className={`ic-tag ${r.hart ? 'hart' : ''}`}>{r.reiz}</span>
                    {detail?.rpe != null && <span className="ic-rpe-badge">RPE {detail.rpe}</span>}
                  </div>
                </div>
              );
            })}

          {panelTab === 'woche' && (
            <div className="ic-ev ic-glass">
              <div className="ic-mini">
                {weekKpis.map((r) => {
                  if (!r) return null;
                  return (
                    <div
                      key={r.id}
                      className="ic-mini-cell ic-ev-click"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (r.id === 'tagesform') openDrawer({ type: 'readiness', datum: TODAY_ISO });
                        else navigate('form', r.id);
                      }}
                    >
                      <small>
                        <i className={r.bewertung} />
                        {r.kpi}
                      </small>
                      <b className={r.id === 'tagesform' ? 'ic-ampel' : ''}>
                        {r.wert_text}
                        {r.einheit ? ' ' + r.einheit : ''}
                      </b>
                      <span>{r.vergleich}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Left Map Legend (Clickable Countries Quick-Badges) */}
      <div className="ic-float ic-glass ic-float-legend">
        <div className="ic-legend-group">
          <span className="ic-legend-title">Vergangene Events</span>
          <span>
            <i style={{ background: 'var(--sport-run)' }} />
            Lauf
          </span>
          <span>
            <i style={{ background: 'var(--sport-trail)' }} />
            Trail
          </span>
          <span>
            <i style={{ background: 'var(--c4)' }} />
            Ultra
          </span>
          <span>
            <i style={{ background: 'var(--sport-swim)' }} />
            Triathlon
          </span>
          <span>
            <i style={{ background: 'var(--sport-bike)' }} />
            Rad-Route
          </span>
        </div>
        <div className="ic-legend-group">
          <span className="ic-legend-title">Anstehend</span>
          <span>
            <i style={{ background: 'var(--color-ok)' }} />
            on track / angemeldet
          </span>
          <span>
            <i style={{ background: 'var(--color-warn)' }} />
            gefährdet / Test offen
          </span>
          <span>
            <i style={{ background: 'var(--color-bad)' }} />
            nicht erreichbar
          </span>
        </div>
        <div className="ic-legend-group">
          <span className="ic-legend-title">Länder ({store.laender.length}, klickbar)</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {store.laender.slice(0, 6).map((l) => (
              <button
                key={l.land}
                type="button"
                className="ic-country-pill"
                onClick={() => openDrawer({ type: 'country', land: l.land })}
              >
                {l.name_de} ({l.aktivitaeten})
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
