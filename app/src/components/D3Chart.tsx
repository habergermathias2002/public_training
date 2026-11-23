import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { fmtDate, fmtDay, num, parseIso } from '../utils/format';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  width?: number;
  dots?: boolean;
  r?: number;
  opacity?: number;
  digits?: number;
  unit?: string;
  fmt?: (v: any) => string;
}

export interface D3ChartProps {
  rows: any[];
  xKey: string;
  label: string;
  height?: number;
  band?: boolean;
  stack?: boolean;
  bars?: boolean;
  invert?: boolean;
  include?: number[];
  refs?: number[];
  yFormat?: (v: number) => string;
  series: ChartSeries[];
  tipTitle?: (row: any) => string;
  tipExtra?: (row: any) => string | null;
  onPointClick?: (row: any) => void;
  clickHint?: string;
  selectedX?: string | null;
}

export const D3Chart: React.FC<D3ChartProps> = ({
  rows,
  xKey,
  label,
  height = 225,
  band = false,
  stack = false,
  bars = false,
  invert = false,
  include = [],
  refs = [],
  yFormat,
  series,
  tipTitle,
  tipExtra,
  onPointClick,
  clickHint = 'Klicken für Details',
  selectedX,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(Math.max(280, el.clientWidth));
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(280, Math.round(e.contentRect.width));
        setWidth((prev) => (Math.abs(prev - w) > 2 ? w : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.replaceChildren();
    if (!rows || rows.length === 0) {
      const p = document.createElement('p');
      p.className = 'ic-note';
      p.textContent = 'Keine Daten für diesen Zeitraum vorhanden.';
      box.appendChild(p);
      return;
    }

    const w = Math.max(280, width);
    const h = height;
    const wrap = document.createElement('div');
    wrap.className = 'ic-chart' + (onPointClick ? ' ic-chart-clickable' : '');
    box.appendChild(wrap);

    const svg = d3
      .select(wrap)
      .append('svg')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .attr('role', 'img')
      .attr('aria-label', label);

    const tip = document.createElement('div');
    tip.className = 'ic-tip';
    tip.hidden = true;
    wrap.appendChild(tip);

    const xs = rows.map((r) => parseIso(String(r[xKey]).slice(0, 10))).filter(Boolean) as Date[];
    const vals = stack
      ? rows.map((r) => series.reduce((sum, s) => sum + (Number(r[s.key]) || 0), 0))
      : rows.flatMap((r) => series.map((s) => r[s.key])).filter((v) => v != null && v !== '' && !Number.isNaN(Number(v))).map(Number);

    const domainVals = vals.concat(include);
    const ext = d3.extent(domainVals) as [number, number];
    const y = d3.scaleLinear().domain([ext[0] ?? 0, ext[1] ?? 10]).nice();
    if (invert) y.domain(y.domain().slice().reverse());

    const yFmt = yFormat || ((v: number) => num(v));
    const probe = svg.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(yFmt as any));
    let lw = 0;
    probe.selectAll('text').each(function () {
      lw = Math.max(lw, (this as SVGTextElement).getComputedTextLength());
    });
    probe.remove();

    const m = { t: 10, r: 12, b: 24, l: Math.ceil(lw) + 12 };
    const xBand = band
      ? d3.scaleBand<string>().domain(rows.map((r) => String(r[xKey]))).padding(0.24).range([m.l, w - m.r])
      : null;
    const xUtc = !band
      ? d3.scaleUtc().domain(d3.extent(xs) as [Date, Date]).range([m.l, w - m.r])
      : null;

    y.range([h - m.b, m.t]);

    // Grid & Y Axis
    svg
      .append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-(w - m.l - m.r))
          .tickFormat('' as any)
      )
      .call((g) => g.select('.domain').remove());

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(yFmt as any))
      .call((g) => g.select('.domain').remove());

    // X Axis
    const xAxis = band && xBand
      ? d3
          .axisBottom(xBand)
          .tickValues(
            rows
              .map((r) => String(r[xKey]))
              .filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / Math.max(2, Math.floor(w / 68)))) === 0)
          )
          .tickFormat((v) => fmtDay(String(v)))
      : (() => {
          const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
          const [a, b2] = xUtc!.domain();
          const span = (+b2 - +a) / 864e5;
          const maxT = Math.max(2, Math.floor(w / 78));
          if (span > 100) {
            const step = Math.max(1, Math.ceil(span / 30.4 / maxT));
            return d3
              .axisBottom(xUtc!)
              .ticks(d3.utcMonth.every(step))
              .tickFormat((d: any) => `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`);
          }
          const step = Math.max(1, Math.ceil(span / 7 / maxT));
          return d3
            .axisBottom(xUtc!)
            .ticks(d3.utcMonday.every(step))
            .tickFormat((d: any) => fmtDay(d.toISOString().slice(0, 10)));
        })();

    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - m.b})`).call(xAxis as any);

    if (y.domain()[0] < 0 && y.domain()[1] > 0) {
      svg
        .append('line')
        .attr('class', 'zero')
        .attr('x1', m.l)
        .attr('x2', w - m.r)
        .attr('y1', y(0))
        .attr('y2', y(0));
    }
    refs.forEach((v) => {
      svg
        .append('line')
        .attr('class', 'rule')
        .attr('x1', m.l)
        .attr('x2', w - m.r)
        .attr('y1', y(v))
        .attr('y2', y(v));
    });

    if (stack && xBand) {
      const st = d3
        .stack<any>()
        .keys(series.map((s) => s.key))
        .value((r, k) => Number(r[k]) || 0)(rows);
      st.forEach((layer, i) => {
        svg
          .append('g')
          .selectAll('rect')
          .data(layer)
          .join('rect')
          .attr('x', (p) => xBand(String(p.data[xKey])) ?? 0)
          .attr('width', xBand.bandwidth())
          .attr('y', (p) => y(p[1]))
          .attr('height', (p) => Math.max(0, y(p[0]) - y(p[1])))
          .attr('rx', 1.5)
          .style('fill', series[i].color)
          .style('opacity', (p) => (selectedX && String(p.data[xKey]) !== selectedX ? 0.45 : 0.92));
      });
    } else if (bars && xUtc) {
      const s0 = series[0];
      const bw = Math.max(1.5, (w - m.l - m.r) / rows.length - 1);
      svg
        .append('g')
        .selectAll('rect')
        .data(rows.filter((r) => r[s0.key] != null))
        .join('rect')
        .attr('x', (r) => xUtc(parseIso(String(r[xKey]).slice(0, 10))!) - bw / 2)
        .attr('width', bw)
        .attr('y', (r) => y(Number(r[s0.key])))
        .attr('height', (r) => Math.max(0, y(y.domain()[0]) - y(Number(r[s0.key]))))
        .attr('rx', 1)
        .style('fill', s0.color);
    } else if (xUtc) {
      series.forEach((s) => {
        if (s.dots) {
          svg
            .append('g')
            .selectAll('circle')
            .data(rows.filter((r) => r[s.key] != null && r[s.key] !== ''))
            .join('circle')
            .attr('cx', (r) => xUtc(parseIso(String(r[xKey]).slice(0, 10))!))
            .attr('cy', (r) => y(Number(r[s.key])))
            .attr('r', s.r || 3.8)
            .style('fill', s.color)
            .style('opacity', s.opacity ?? 0.65)
            .style('stroke', 'var(--color-panel)')
            .style('stroke-width', 1);
          return;
        }
        svg
          .append('path')
          .attr('fill', 'none')
          .style('stroke', s.color)
          .attr('stroke-width', s.width || 2)
          .attr(
            'd',
            d3
              .line<any>()
              .defined((r) => r[s.key] != null && r[s.key] !== '')
              .x((r) => xUtc(parseIso(String(r[xKey]).slice(0, 10))!))
              .y((r) => y(Number(r[s.key])))(rows) || ''
          );
      });
    }

    const rule = svg.append('line').attr('class', 'rule').attr('y1', m.t).attr('y2', h - m.b).style('opacity', 0);
    const hoverDot = svg
      .append('circle')
      .attr('r', 5)
      .attr('fill', series[0]?.color || 'var(--color-fg)')
      .attr('stroke', 'var(--color-bg)')
      .attr('stroke-width', 2)
      .style('opacity', 0)
      .style('pointer-events', 'none');

    const pos = (r: any) =>
      band && xBand
        ? (xBand(String(r[xKey])) ?? 0) + xBand.bandwidth() / 2
        : xUtc!(parseIso(String(r[xKey]).slice(0, 10))!);

    const findBest = (mx: number) => {
      let best = rows[0];
      let bd = Infinity;
      for (const r of rows) {
        const dd = Math.abs(pos(r) - mx);
        if (dd < bd) {
          bd = dd;
          best = r;
        }
      }
      return best;
    };

    svg
      .append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', Math.max(10, w - m.l - m.r))
      .attr('height', Math.max(10, h - m.t - m.b))
      .attr('fill', 'transparent')
      .style('cursor', onPointClick ? 'pointer' : 'crosshair')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        const best = findBest(mx);
        if (!best) return;
        const px = pos(best);
        rule.attr('x1', px).attr('x2', px).style('opacity', 1);

        const firstVal = best[series[0]?.key];
        if (!band && firstVal != null && firstVal !== '') {
          hoverDot.attr('cx', px).attr('cy', y(Number(firstVal))).style('opacity', 1);
        } else {
          hoverDot.style('opacity', 0);
        }

        tip.replaceChildren();
        const b = document.createElement('b');
        b.textContent = tipTitle ? tipTitle(best) : fmtDate(String(best[xKey]));
        tip.appendChild(b);

        series.forEach((s) => {
          const val = best[s.key];
          if (val == null || val === '') return;
          const sp = document.createElement('span');
          const formatted = s.fmt ? s.fmt(val) : num(val, s.digits ?? 0);
          sp.textContent = `${s.label}: ${formatted}${s.unit ? ' ' + s.unit : ''}`;
          tip.appendChild(sp);
        });

        if (tipExtra) {
          const extra = tipExtra(best);
          if (extra) {
            const sp = document.createElement('span');
            sp.className = 'ic-tip-extra';
            sp.textContent = extra;
            tip.appendChild(sp);
          }
        }

        if (onPointClick) {
          const hint = document.createElement('span');
          hint.className = 'ic-tip-hint';
          hint.textContent = `↗ ${clickHint}`;
          tip.appendChild(hint);
        }

        tip.hidden = false;
        const scale = wrap.clientWidth / w;
        tip.style.left = Math.min(Math.max(4, px * scale + 12), Math.max(4, wrap.clientWidth - tip.offsetWidth - 6)) + 'px';
        tip.style.top = '4px';
      })
      .on('click', (event) => {
        if (!onPointClick) return;
        const [mx] = d3.pointer(event);
        const best = findBest(mx);
        if (best) onPointClick(best);
      })
      .on('pointerleave', () => {
        tip.hidden = true;
        rule.style('opacity', 0);
        hoverDot.style('opacity', 0);
      });
  }, [rows, xKey, label, height, band, stack, bars, invert, include, refs, yFormat, series, tipTitle, tipExtra, onPointClick, clickHint, width, selectedX]);

  return <div ref={boxRef} />;
};
