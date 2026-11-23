import * as d3 from 'd3';

export const parseIso = d3.utcParse('%Y-%m-%d');
export const fmtDateFull = d3.utcFormat('%d.%m.%Y');
export const fmtDayShort = d3.utcFormat('%d.%m.');

const now = new Date();
export const TODAY_UTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
export const TODAY_ISO = new Date(TODAY_UTC).toISOString().slice(0, 10);

export const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const DAYS_MON_FIRST = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const DAYS_LONG_MON = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function fmtDate(isoStr?: string | null): string {
  if (!isoStr) return '–';
  const d = parseIso(isoStr.slice(0, 10));
  return d ? fmtDateFull(d) : isoStr;
}

export function fmtDay(isoStr?: string | null): string {
  if (!isoStr) return '–';
  const d = parseIso(isoStr.slice(0, 10));
  return d ? fmtDayShort(d) : isoStr;
}

export function daysTo(isoStr?: string | null): number {
  if (!isoStr) return 0;
  const d = parseIso(isoStr.slice(0, 10));
  if (!d) return 0;
  return Math.round((+d - TODAY_UTC) / 864e5);
}

export function toIso(d: Date | number): string {
  return new Date(+d).toISOString().slice(0, 10);
}

export function addDays(d: Date | number, n: number): Date {
  return new Date(+d + n * 864e5);
}

export function mondayOf(d: Date | number): Date {
  const dt = new Date(+d);
  return addDays(dt, -((dt.getUTCDay() + 6) % 7));
}

export function kwOf(d: Date | number): number {
  return +d3.utcFormat('%V')(new Date(+d));
}

export function relPast(isoStr: string): string {
  const n = -daysTo(isoStr);
  if (n === 0) return 'heute';
  if (n === 1) return 'gestern';
  if (n < 0) return `in ${-n} T.`;
  return `vor ${n} T.`;
}

export function relNext(isoStr: string): string {
  const n = daysTo(isoStr);
  const d = parseIso(isoStr);
  if (!d) return isoStr;
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  return `${DAYS_SHORT[d.getUTCDay()]} ${fmtDayShort(d)}`;
}

export function num(v: number | string | null | undefined, digits = 0): string {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '–';
  return Number(v).toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPace(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '–';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDurationMmSs(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '–';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Sportarten-Farben: Lauf = Orange, Rad = Grün/Teal, Schwimmen = Blau, Kraft/Wandern/Sonst = Amber
export function sportColor(sport?: string): string {
  switch (sport) {
    case 'Lauf':
      return 'var(--sport-run)';
    case 'Rad':
      return 'var(--sport-bike)';
    case 'Schwimmen':
      return 'var(--sport-swim)';
    case 'Kraft':
      return 'var(--sport-strength)';
    case 'Wandern':
    case 'Trail':
      return 'var(--sport-trail)';
    default:
      return 'var(--sport-other)';
  }
}

export function artColor(art?: string): string {
  switch (art) {
    case 'Lauf':
      return 'var(--sport-run)';
    case 'Rad':
      return 'var(--sport-bike)';
    case 'Triathlon':
      return 'var(--sport-swim)';
    case 'Trail':
      return 'var(--sport-trail)';
    case 'Ultra':
      return 'var(--c4)';
    default:
      return 'var(--sport-run)';
  }
}

// Status-Klassifizierung ("angemeldet / on track" -> ok/grün)
export function statusLevel(status?: string): 'ok' | 'warn' | 'bad' | 'none' {
  if (!status) return 'none';
  const s = status.toLowerCase();
  if (s.includes('on track') || s.includes('ziel hochsetzen') || s === 'gültig' || s === 'gut' || s === 'grün') return 'ok';
  if (s.includes('gefährdet') || s === 'offen' || s === 'warn' || s === 'gelb' || s.includes('vorläufig')) return 'warn';
  if (s.includes('nicht erreichbar') || s === 'abgelaufen' || s === 'schlecht' || s === 'rot') return 'bad';
  return 'none';
}

export function statusColorVar(status?: string): string {
  const lvl = statusLevel(status);
  if (lvl === 'ok') return 'var(--color-ok)';
  if (lvl === 'warn') return 'var(--color-warn)';
  if (lvl === 'bad') return 'var(--color-bad)';
  return 'var(--color-fg-muted)';
}

export interface ZoneDef {
  id: string;
  short: string;
  name: string;
  bpmRun: string;
  bpmBike: string;
  color: string;
  desc: string;
}

// Profi-5-Zonen-Modell nach LT1/LT2 (framework.md Abschnitt 7)
export const ZONES_5: ZoneDef[] = [
  {
    id: 'z1',
    short: 'Z1',
    name: 'Z1 Recovery',
    bpmRun: '< 134 bpm',
    bpmBike: '< 126 bpm',
    color: 'var(--zone-1)',
    desc: 'Aktive Erholung & Shakeout (< 75 % LTHR)',
  },
  {
    id: 'z2',
    short: 'Z2',
    name: 'Z2 Easy / LIT (≤ LT1)',
    bpmRun: '134–145 bpm (Ziel ~140)',
    bpmBike: '126–140 bpm (Ziel ~130–135)',
    color: 'var(--zone-2)',
    desc: 'Aerobe Basis unterhalb LT1 (Drift < 5 %)',
  },
  {
    id: 'z3',
    short: 'Z3',
    name: 'Z3 Tempo (Grey Zone)',
    bpmRun: '146–167 bpm',
    bpmBike: '141–160 bpm',
    color: 'var(--zone-3)',
    desc: 'LT1 bis LT2 – im 5-km-Block meiden, im Ironman Rennspezifisch',
  },
  {
    id: 'z4',
    short: 'Z4',
    name: 'Z4 Schwelle (LT2)',
    bpmRun: '168–182 bpm',
    bpmBike: '161–177 bpm (88–105 % FTP)',
    color: 'var(--zone-4)',
    desc: 'Laktatschwelle / MLSS (94–102 % LTHR)',
  },
  {
    id: 'z5',
    short: 'Z5',
    name: 'Z5 VO2max',
    bpmRun: '> 182 bpm',
    bpmBike: '> 177 bpm (> 106 % FTP)',
    color: 'var(--zone-5)',
    desc: 'Maximale Sauerstoffaufnahme & 5-km-Speed (> 102 % LTHR)',
  },
];

// Pacing- & Regenerations-Hinweise je Reiztyp (generisch, auf eigene Zonen in athlet/marker.md anpassen)
export function nutritionGuideForSession(sport: string, reiz: string, dauerMin = 60): {
  vorher: string;
  waehrend: string;
  nachher: string;
  zielZone: string;
} {
  const isHard = ['VO2max', 'Schwelle', 'Renntempo', 'Test5k', 'hart'].includes(reiz);
  const zielZone =
    sport === 'Schwimmen'
      ? 'Technik & Wasserlage (ruhiger Atemrhythmus, saubere Zuglänge)'
      : sport === 'Kraft'
      ? 'Maximalkraft ≥ 80 % 1RM (schwere Grundübungen + Sprünge, 2–3 min Satzpause)'
      : sport === 'Rad'
      ? isHard
        ? 'Z4 Schwelle: 88–105 % FTP (individuelle LTHR-Zone)'
        : 'Z2 LIT: 55–75 % FTP (unterhalb LT1)'
      : reiz === 'VO2max' || reiz === 'Test5k'
      ? 'Pace führt! Ziel-Endpuls Z5 (Ein-/Auslaufen strikt Z2 unter LT1)'
      : reiz === 'Schwelle' || reiz === 'Renntempo'
      ? 'Z4 Schwelle (Ein-/Auslaufen strikt Z2 unter LT1)'
      : 'Z2 LIT (unterhalb LT1, Pulsdrift < 5 %)';

  if (isHard) {
    return {
      zielZone,
      vorher: 'Ausgeruht starten, 10–15 min lockeres Warm-up inkl. kurzer Steigerungen.',
      waehrend: dauerMin >= 70 ? 'Ausreichend Flüssigkeit & Elektrolyte; gleichmäßiges Pacing ab Intervall 1.' : 'Wasser nach Bedarf; Fokus auf sauberes Pacing ab Intervall 1.',
      nachher: '10 min lockeres Auslaufen/-fahren, zeitnahe Regeneration & ausreichend Schlaf.',
    };
  }
  if (reiz === 'lang' || reiz === 'Trail' || dauerMin >= 75) {
    return {
      zielZone,
      vorher: 'Gut hydriert starten; konservativ anlaufen, um Pulsdrift niedrig zu halten.',
      waehrend: 'Ab 75–90 min regelmäßig Flüssigkeit und Energie zuführen; Puls unter LT1 halten.',
      nachher: 'Flüssigkeit zügig auffüllen und muskuläre Erholung priorisieren.',
    };
  }
  return {
    zielZone,
    vorher: 'Locker einrollen ohne Druck – Fokus auf niedrigen Puls (Z2 ≤ LT1).',
    waehrend: 'Flüssigkeit nach Durst. Konstante Intensität im Grundlagenbereich.',
    nachher: 'Normale Alltagsregeneration & Schlafqualität im Blick behalten.',
  };
}
